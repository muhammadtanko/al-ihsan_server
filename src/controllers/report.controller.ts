import { Prisma } from "@prisma/client";
import { prisma } from "../connections/prisma.conn";
import { approvedClaimsQuerySchema, type ApprovedClaimsQuery } from "../models/report.model";
import { notFound } from "../utils/errors";
import { toCsv } from "../utils/csv";
import { ok } from "../utils/http";

const DAY = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

// Management reports. Approved claims = everything a medical officer has
// approved, whether or not it has been paid yet.
class ReportController {
  private async approvedClaims(query: ApprovedClaimsQuery) {
    if (query.facilityId && !(await prisma.facility.findUnique({ where: { id: query.facilityId } }))) {
      throw notFound("Facility not found");
    }
    const where: Prisma.ClaimWhereInput = {
      status: { in: ["Approved", "Paid"] },
      reviewedAt: { not: null, ...(query.from && { gte: query.from }), ...(query.to && { lt: query.to }) },
      ...(query.facilityId && { facilityId: query.facilityId }),
    };
    const claims = await prisma.claim.findMany({
      where,
      include: { facility: true, docs: { select: { kind: true } } },
      orderBy: { reviewedAt: "desc" },
    });

    const rows = claims.map((c) => ({
      id: c.id,
      name: c.name,
      kad: c.kad,
      facilityId: c.facilityId,
      facilityName: c.facility.name,
      facilityCode: c.facility.code,
      services: c.dx,
      amount: c.amount,
      linked: c.linked,
      status: c.status,
      approvedBy: c.reviewedBy,
      approvedAt: c.reviewedAt,
      paymentProofs: c.docs.filter((d) => d.kind === "payment-proof").length,
      submittedAt: c.createdAt,
    }));

    const sum = (list: { amount: number }[]) => list.reduce((a, r) => a + r.amount, 0);
    const byFacility = Object.values(
      rows.reduce<Record<string, { facilityId: string; facilityName: string; count: number; amount: number }>>((acc, r) => {
        const entry = (acc[r.facilityId] ??= { facilityId: r.facilityId, facilityName: r.facilityName, count: 0, amount: 0 });
        entry.count += 1;
        entry.amount += r.amount;
        return acc;
      }, {}),
    ).sort((a, b) => b.amount - a.amount);

    return {
      rows,
      totals: {
        count: rows.length,
        amount: sum(rows),
        paidAmount: sum(rows.filter((r) => r.status === "Paid")),
        awaitingPaymentAmount: sum(rows.filter((r) => r.status === "Approved")),
        byFacility,
      },
    };
  }

  async approvedClaimsReport(rawQuery: unknown) {
    const query = approvedClaimsQuerySchema.parse(rawQuery);
    return ok(await this.approvedClaims(query));
  }

  // The same report as a spreadsheet-friendly CSV (UTF-8 with BOM so Excel reads ₦ and accents).
  async approvedClaimsCsv(rawQuery: unknown) {
    const query = approvedClaimsQuerySchema.parse(rawQuery);
    const { rows, totals } = await this.approvedClaims(query);

    const lines: (string | number | null)[][] = [
      ["Claim", "Enrollee", "Enrollee number", "Facility", "Facility code", "Services", "Amount (NGN)", "Linked code", "Status", "Approved by", "Approved on", "Submitted on", "Payment proofs"],
      ...rows.map((r) => [r.id, r.name, r.kad, r.facilityName, r.facilityCode, r.services, r.amount, r.linked, r.status, r.approvedBy, DAY(r.approvedAt), DAY(r.submittedAt), r.paymentProofs]),
      [],
      ["Claims", totals.count],
      ["Total approved (NGN)", totals.amount],
      ["Paid (NGN)", totals.paidAmount],
      ["Awaiting payment (NGN)", totals.awaitingPaymentAmount],
    ];
    const body = toCsv(lines);

    const facility = query.facilityId ? `-${query.facilityId}` : "";
    const range = query.from || query.to ? `-${DAY(query.from ?? null) || "start"}_to_${DAY(query.to ?? null) || "now"}` : "-all-time";
    return { body, filename: `approved-claims${facility}${range}.csv` };
  }
}

export default new ReportController();
