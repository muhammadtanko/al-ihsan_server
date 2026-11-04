import type { CodeRequest } from "@prisma/client";
import { prisma } from "../connections/prisma.conn";
import type { AuthUser } from "../middlewares/auth.middleware";
import { newRequestSchema, rejectSchema } from "../models/request.model";
import { badRequest, conflict, notFound } from "../utils/errors";
import { created, ok } from "../utils/http";
import { nextSeq, pad } from "../utils/ids";
import { lookupKads } from "../utils/enrollment-lookup";
import { requestDto } from "../utils/mappers";

// Pre-authorisation: Pending -> Under Review -> Approved | Rejected,
// plus whether the decision has been relayed to the facility.
class RequestController {
  private async many(rows: CodeRequest[]) {
    const lookup = await lookupKads(rows.map((r) => r.kad));
    return rows.map((r) => ({ ...requestDto(r), verified: lookup.verified(r.kad) }));
  }

  private async one(row: CodeRequest) {
    return (await this.many([row]))[0];
  }

  // Facility accounts only see requests their facility sent or is receiving the patient for.
  async list(user: AuthUser) {
    const own = user.role === "facility" ? user.facilityId ?? "none" : null;
    const requests = await prisma.codeRequest.findMany({
      where: own ? { OR: [{ refFacilityId: own }, { recvFacilityId: own }] } : {},
      orderBy: { createdAt: "desc" },
    });
    return ok(await this.many(requests));
  }

  // The authorisation codes a facility account can attach to a claim: approved
  // requests where this facility is the one receiving the patient.
  async approvedCodes(user: AuthUser) {
    if (user.role !== "facility" || !user.facilityId) return ok([]);
    const rows = await prisma.codeRequest.findMany({
      where: { status: "Approved", recvFacilityId: user.facilityId, code: { not: null } },
      orderBy: { reviewedAt: "desc" },
    });
    return ok(
      rows.map((r) => ({ id: r.id, code: r.code!, name: r.name, kad: r.kad, dx: r.dx, proc: r.proc })),
    );
  }

  async create(body: unknown, user: AuthUser) {
    const parsed = newRequestSchema.parse(body);
    // A facility account always requests on its own behalf, whatever the form says.
    if (user.role === "facility" && !user.facilityId) {
      throw badRequest("This account isn't linked to a facility, so it can't submit code requests.");
    }
    const input = user.role === "facility" ? { ...parsed, refId: user.facilityId! } : parsed;
    const [plan, ref, recv] = await Promise.all([
      prisma.plan.findUnique({ where: { id: input.planId } }),
      prisma.facility.findUnique({ where: { id: input.refId } }),
      prisma.facility.findUnique({ where: { id: input.recvId } }),
    ]);
    if (!plan) throw badRequest("Select a valid insurance plan");
    if (!ref || !recv) throw badRequest("Select valid referring and receiving facilities");
    if (user.role === "facility" && ref.id === recv.id) throw badRequest("Choose a different facility to receive the patient.");

    const request = await prisma.$transaction(async (tx) => {
      const n = await nextSeq("CR", tx);
      return tx.codeRequest.create({
        data: {
          id: `CR-${n}`,
          name: input.name,
          kad: input.kad,
          phone: input.phone || "—",
          dx: input.dx,
          proc: input.proc,
          planId: plan.id,
          refFacilityId: ref.id,
          recvFacilityId: recv.id,
          status: "Pending",
          createdBy: `${user.name} (${user.title})`,
          createdById: user.id,
        },
      });
    });
    return created(await this.one(request));
  }

  private async load(id: string) {
    const request = await prisma.codeRequest.findUnique({ where: { id } });
    if (!request) throw notFound("Code request not found");
    return request;
  }

  async startReview(id: string, user: AuthUser) {
    const request = await this.load(id);
    if (request.status !== "Pending") throw conflict("Only a pending request can be moved to review");
    const updated = await prisma.codeRequest.update({
      where: { id },
      data: { status: "Under Review", reviewedBy: user.name, reviewedById: user.id, reviewStartedAt: new Date() },
    });
    return ok(await this.one(updated));
  }

  // Allocates the next authorisation code from the sequence (000469, 000470 …).
  async approve(id: string, user: AuthUser) {
    const updated = await prisma.$transaction(async (tx) => {
      const request = await tx.codeRequest.findUnique({ where: { id } });
      if (!request) throw notFound("Code request not found");
      if (request.status !== "Under Review") throw conflict("Only a request under review can be approved");
      const code = pad(await nextSeq("code", tx), 6);
      return tx.codeRequest.update({
        where: { id },
        data: { status: "Approved", code, reviewedBy: user.name, reviewedById: user.id, reviewedAt: new Date() },
      });
    });
    return ok(await this.one(updated));
  }

  async reject(id: string, body: unknown, user: AuthUser) {
    const { reason } = rejectSchema.parse(body ?? {});
    const request = await this.load(id);
    if (request.status !== "Under Review") throw conflict("Only a request under review can be rejected");
    const updated = await prisma.codeRequest.update({
      where: { id },
      data: {
        status: "Rejected",
        reason: reason || "Not clinically justified against the enrollee plan.",
        reviewedBy: user.name,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });
    return ok(await this.one(updated));
  }

  // Records that the decision was relayed to the facility (manual WhatsApp channel).
  async markSent(id: string) {
    const request = await this.load(id);
    if (request.status !== "Approved" && request.status !== "Rejected") {
      throw conflict("There is no decision to send yet");
    }
    if (request.sent !== "Not sent") throw conflict("This response has already been marked as sent");

    const facility = await prisma.facility.findUnique({ where: { id: request.recvFacilityId } });
    const [updated] = await prisma.$transaction([
      prisma.codeRequest.update({ where: { id }, data: { sent: "Sent — manual" } }),
      prisma.delivery.create({
        data: {
          to: `${facility?.phone ?? "—"} (facility)`,
          channel: "WhatsApp",
          template: request.status === "Approved" ? "Code approved" : "Code rejected",
          status: "Sent — manual",
        },
      }),
    ]);
    return ok(await this.one(updated));
  }
}

export default new RequestController();
