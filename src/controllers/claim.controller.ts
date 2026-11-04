import path from "path";
import type { Claim, ClaimDocument, ClaimInvestigation } from "@prisma/client";
import { prisma } from "../connections/prisma.conn";
import { config } from "../config";
import type { AuthUser } from "../middlewares/auth.middleware";
import { formatSize, removeUploaded } from "../middlewares/upload.middleware";
import { newClaimSchema, setAmountSchema } from "../models/claim.model";
import { rejectSchema } from "../models/request.model";
import { badRequest, conflict, forbidden, notFound } from "../utils/errors";
import { created, ok } from "../utils/http";
import { generateRef, nextSeq } from "../utils/ids";
import { lookupKads } from "../utils/enrollment-lookup";
import { claimDto } from "../utils/mappers";

const include = { investigations: true, docs: true } as const;
const REVIEWABLE = ["Submitted", "Under Review"];

type ClaimRow = Claim & { investigations: ClaimInvestigation[]; docs: ClaimDocument[] };

// Submitted -> Under Review -> Approved | Rejected -> Paid
class ClaimController {
  // Adds what a reviewer needs to see without access to the Enrollees page.
  private async many(rows: ClaimRow[]) {
    const lookup = await lookupKads(rows.map((c) => c.kad));
    return rows.map((c) => ({ ...claimDto(c), verified: lookup.verified(c.kad), planId: lookup.planId(c.kad) }));
  }

  private async one(row: ClaimRow) {
    return (await this.many([row]))[0];
  }

  // Facility accounts only ever see their own facility's claims.
  async list(user: AuthUser) {
    const claims = await prisma.claim.findMany({
      where: user.role === "facility" ? { facilityId: user.facilityId ?? "none" } : {},
      include,
      orderBy: { createdAt: "desc" },
    });
    return ok(await this.many(claims));
  }

  // JSON or multipart (with an optional `document` file). Each line takes the
  // KADCHMA approved price unless the facility states a different amount.
  async create(body: unknown, file: Express.Multer.File | undefined, user: AuthUser) {
    try {
      const input = newClaimSchema.parse(body);
      if (!user.facilityId) throw badRequest("This account isn't linked to a facility, so it can't submit claims.");
      const facility = await prisma.facility.findUnique({ where: { id: user.facilityId } });
      if (!facility) throw badRequest("The facility linked to this account no longer exists.");

      // A linked authorisation code must be an approved one for this facility.
      let linked = "—";
      if (input.linked) {
        const request = await prisma.codeRequest.findFirst({
          where: { code: input.linked, status: "Approved", recvFacilityId: facility.id },
        });
        if (!request) throw badRequest("That authorisation code isn't approved for this facility.");
        linked = `${request.id} / ${request.code}`;
      }

      const prices = await prisma.investigation.findMany({
        where: { id: { in: input.investigations.map((i) => i.investigationId) } },
      });
      const lines = input.investigations.map((row) => {
        const inv = prices.find((p) => p.id === row.investigationId);
        if (!inv) throw badRequest(`Unknown investigation: ${row.investigationId}`);
        return { investigationId: inv.id, name: inv.service, amount: row.amount ?? inv.approved };
      });

      const docName = file?.originalname ?? input.doc;
      const claim = await prisma.$transaction(async (tx) => {
        const id = `CL-${await nextSeq("CL", tx)}`;
        return tx.claim.create({
          data: {
            id,
            name: input.name,
            kad: input.kad,
            facilityId: facility.id,
            dx: lines.map((l) => l.name).join(", "),
            amount: lines.reduce((a, l) => a + l.amount, 0),
            linked,
            status: "Submitted",
            submittedBy: `${facility.name} (facility portal)`,
            investigations: {
              create: lines.map((l, i) => ({ id: `${id}-INV-${i + 1}`, position: i, ...l })),
            },
            docs: docName
              ? {
                  create: [
                    {
                      file: docName,
                      size: file ? formatSize(file.size) : "—",
                      storedName: file?.filename ?? null,
                    },
                  ],
                }
              : undefined,
          },
          include,
        });
      });
      return created(await this.one(claim));
    } catch (err) {
      removeUploaded(file?.filename); // don't leave an orphaned upload behind
      throw err;
    }
  }

  private async loadReviewable(id: string) {
    const claim = await prisma.claim.findUnique({ where: { id }, include });
    if (!claim) throw notFound("Claim not found");
    if (!REVIEWABLE.includes(claim.status)) throw conflict("This claim has already been decided");
    return claim;
  }

  async startReview(id: string, user: AuthUser) {
    const claim = await prisma.claim.findUnique({ where: { id } });
    if (!claim) throw notFound("Claim not found");
    if (claim.status !== "Submitted") throw conflict("Only a submitted claim can be moved to review");
    const updated = await prisma.claim.update({
      where: { id },
      data: { status: "Under Review", reviewedBy: user.name, reviewedById: user.id, reviewStartedAt: new Date() },
      include,
    });
    return ok(await this.one(updated));
  }

  async approve(id: string, user: AuthUser) {
    const claim = await prisma.claim.findUnique({ where: { id } });
    if (!claim) throw notFound("Claim not found");
    if (claim.status !== "Under Review") throw conflict("Only a claim under review can be approved");
    const updated = await prisma.claim.update({
      where: { id },
      data: { status: "Approved", reviewedBy: user.name, reviewedById: user.id, reviewedAt: new Date() },
      include,
    });
    return ok(await this.one(updated));
  }

  async reject(id: string, body: unknown, user: AuthUser) {
    const { reason } = rejectSchema.parse(body ?? {});
    const claim = await prisma.claim.findUnique({ where: { id } });
    if (!claim) throw notFound("Claim not found");
    if (claim.status !== "Under Review") throw conflict("Only a claim under review can be rejected");
    const updated = await prisma.claim.update({
      where: { id },
      data: {
        status: "Rejected",
        reason: reason || "Not clinically justified against the enrollee plan.",
        reviewedBy: user.name,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
      include,
    });
    return ok(await this.one(updated));
  }

  // Medical officer review: adjust what one investigation is worth…
  async setItemAmount(id: string, itemId: string, body: unknown) {
    const { amount } = setAmountSchema.parse(body);
    const claim = await this.loadReviewable(id);
    if (!claim.investigations.some((i) => i.id === itemId)) throw notFound("Investigation not found on this claim");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.claimInvestigation.update({ where: { id: itemId }, data: { amount } });
      const total = await tx.claimInvestigation.aggregate({ where: { claimId: id }, _sum: { amount: true } });
      return tx.claim.update({ where: { id }, data: { amount: total._sum.amount ?? 0 }, include });
    });
    return ok(await this.one(updated));
  }

  // …or cancel it (a claim always keeps at least one).
  async removeItem(id: string, itemId: string) {
    const claim = await this.loadReviewable(id);
    if (!claim.investigations.some((i) => i.id === itemId)) throw notFound("Investigation not found on this claim");
    if (claim.investigations.length <= 1) throw conflict("A claim needs at least one investigation");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.claimInvestigation.delete({ where: { id: itemId } });
      const remaining = await tx.claimInvestigation.findMany({ where: { claimId: id }, orderBy: { position: "asc" } });
      return tx.claim.update({
        where: { id },
        data: {
          amount: remaining.reduce((a, i) => a + i.amount, 0),
          dx: remaining.map((i) => i.name).join(", "),
        },
        include,
      });
    });
    return ok(await this.one(updated));
  }

  // Pays an approved claim and records the facility payment.
  private async proofRows(files: Express.Multer.File[], user: AuthUser) {
    return files.map((f) => ({
      file: f.originalname,
      size: formatSize(f.size),
      storedName: f.filename,
      kind: "payment-proof",
      uploadedBy: user.name,
    }));
  }

  // Records payment. Proof of payment (receipt, transfer confirmation …) can be attached now or later.
  async pay(id: string, files: Express.Multer.File[] = [], user: AuthUser) {
    try {
      return await this.payWithProof(id, files, user);
    } catch (err) {
      files.forEach((f) => removeUploaded(f.filename)); // don't leave orphans on disk
      throw err;
    }
  }

  private async payWithProof(id: string, files: Express.Multer.File[], user: AuthUser) {
    const updated = await prisma.$transaction(async (tx) => {
      const claim = await tx.claim.findUnique({ where: { id }, include: { facility: true } });
      if (!claim) throw notFound("Claim not found");
      if (claim.status !== "Approved") throw conflict("Only an approved claim can be paid");
      await tx.transaction.create({
        data: {
          ref: generateRef("RMT"),
          who: `${claim.facility.name} (${claim.id})`,
          type: "Facility payment",
          amount: claim.amount,
          status: "Confirmed",
        },
      });
      return tx.claim.update({
        where: { id },
        data: { status: "Paid", docs: { create: await this.proofRows(files, user) } },
        include,
      });
    });
    return ok(await this.one(updated));
  }

  async addPaymentProof(id: string, files: Express.Multer.File[] = [], user: AuthUser) {
    try {
      if (files.length === 0) throw badRequest("Choose at least one file to attach");
      const claim = await prisma.claim.findUnique({ where: { id } });
      if (!claim) throw notFound("Claim not found");
      if (claim.status !== "Paid") throw conflict("Proof of payment can only be attached once the claim is paid");
      const updated = await prisma.claim.update({
        where: { id },
        data: { docs: { create: await this.proofRows(files, user) } },
        include,
      });
      return created(await this.one(updated));
    } catch (err) {
      files.forEach((f) => removeUploaded(f.filename));
      throw err;
    }
  }

  // Only proof of payment can be removed (e.g. the wrong file was attached); the claim's own documents can't.
  async removePaymentProof(id: string, docId: string) {
    const doc = await prisma.claimDocument.findFirst({ where: { id: docId, claimId: id } });
    if (!doc) throw notFound("Document not found");
    if (doc.kind !== "payment-proof") throw forbidden("Only proof of payment can be removed");
    await prisma.claimDocument.delete({ where: { id: docId } });
    removeUploaded(doc.storedName);
    const claim = await prisma.claim.findUniqueOrThrow({ where: { id }, include });
    return ok(await this.one(claim));
  }

  // Resolves a stored document for download, enforcing facility ownership.
  async documentPath(id: string, docId: string, user: AuthUser) {
    const claim = await prisma.claim.findUnique({ where: { id }, include: { docs: true } });
    if (!claim) throw notFound("Claim not found");
    if (user.role === "facility" && claim.facilityId !== user.facilityId) throw forbidden();
    const doc = claim.docs.find((d) => d.id === docId);
    if (!doc?.storedName) throw notFound("No file was uploaded for this document");
    return { filePath: path.join(config.uploadDir, doc.storedName), fileName: doc.file };
  }
}

export default new ClaimController();
