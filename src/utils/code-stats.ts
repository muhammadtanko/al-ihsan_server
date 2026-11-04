import type { CodeRequest } from "@prisma/client";
import { prisma } from "../connections/prisma.conn";

// Approved and rejected authorisation codes, counted and as percentages. A request
// that is still Pending or Under Review has no outcome yet, so the percentages are
// shares of the *decided* ones (null when nothing has been decided).

export interface CodeStats {
  total: number;
  pending: number;
  underReview: number;
  approved: number;
  rejected: number;
  decided: number;
  approvalRate: number | null; // % of decided requests that were approved
  rejectionRate: number | null; // % of decided requests that were rejected (100 - approvalRate)
}

export async function codeStats(where: object): Promise<CodeStats> {
  const groups = await prisma.codeRequest.groupBy({ by: ["status"], where, _count: { _all: true } });
  const n = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const approved = n("Approved");
  const rejected = n("Rejected");
  const decided = approved + rejected;
  const approvalRate = decided ? Math.round((approved / decided) * 100) : null;
  return {
    total: groups.reduce((a, g) => a + g._count._all, 0),
    pending: n("Pending"),
    underReview: n("Under Review"),
    approved,
    rejected,
    decided,
    approvalRate,
    rejectionRate: approvalRate === null ? null : 100 - approvalRate,
  };
}

export type CodeRow = CodeRequest & { refFacility: { name: string }; recvFacility: { name: string } };

// One approved or rejected request, as listed on a user's or a facility's info window.
export const codeSummaryDto = (r: CodeRow) => ({
  id: r.id,
  name: r.name,
  kad: r.kad,
  dx: r.dx,
  proc: r.proc,
  status: r.status as "Approved" | "Rejected",
  code: r.code,
  reason: r.reason,
  refId: r.refFacilityId,
  refName: r.refFacility.name,
  recvId: r.recvFacilityId,
  recvName: r.recvFacility.name,
  createdBy: r.createdBy,
  createdById: r.createdById,
  createdAt: r.createdAt,
  reviewedBy: r.reviewedBy,
  reviewedById: r.reviewedById,
  reviewedAt: r.reviewedAt,
});

// The decided (approved or rejected) requests matching `where`, newest decision first.
export async function decidedCodes(where: object, limit = 200) {
  const rows = await prisma.codeRequest.findMany({
    where: { ...where, status: { in: ["Approved", "Rejected"] } },
    include: { refFacility: { select: { name: true } }, recvFacility: { select: { name: true } } },
    orderBy: [{ reviewedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: limit,
  });
  return rows.map(codeSummaryDto);
}
