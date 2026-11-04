import { prisma } from "../connections/prisma.conn";
import { enrolleeStatus, EXPIRY_WARNING_DAYS } from "../utils/enrollee-status";
import { ok } from "../utils/http";
import { reviewerKpis } from "../utils/reviewer-kpi";

const DAY = 86_400_000;

type Status = "Active" | "Expiring" | "Expired" | "Pending Payment";
interface Row {
  name: string;
  ref: string;
  plan: string;
  status: string;
  expiresAt: Date | null;
  enrolledAt: Date | null;
  source: "KADCHMA" | "Website";
}

// Numbers behind the console dashboard.
class AnalyticsController {
  // How each medical officer is doing: every medical officer, plus anyone else who has decided something.
  async reviewers() {
    const people = await prisma.user.findMany({
      where: {
        OR: [{ role: "medical-officer" }, { reviewedRequests: { some: {} } }, { reviewedClaims: { some: {} } }],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, status: true, title: true },
    });
    const rows = await Promise.all(people.map(async (p) => ({ ...p, ...(await reviewerKpis(p.id)) })));
    return ok(rows);
  }

  async dashboard() {
    const now = Date.now();
    const [enrollees, requests, claims] = await Promise.all([
      prisma.enrollee.findMany({ include: { plan: true, healthPlan: true } }),
      prisma.codeRequest.findMany({ select: { status: true } }),
      prisma.claim.findMany({ select: { status: true, amount: true } }),
    ]);

    // One list for everyone, whatever their source; the status follows the expiry date.
    const all: Row[] = enrollees.map((e) => ({
      name: e.name,
      ref: e.kad,
      plan: e.plan?.name ?? e.healthPlan?.name ?? "—",
      status: enrolleeStatus(e, now),
      expiresAt: e.expiresAt,
      enrolledAt: e.enrolledAt,
      source: e.source as "KADCHMA" | "Website",
    }));
    const websiteRows = all.filter((r) => r.source === "Website");
    const count = (s: Status) => all.filter((r) => r.status === s).length;

    const byPlan = Object.entries(
      all.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.plan]: (acc[r.plan] ?? 0) + 1 }), {}),
    )
      .map(([plan, n]) => ({ plan, count: n }))
      .sort((a, b) => b.count - a.count);

    const pendingRequests = requests.filter((r) => r.status === "Pending" || r.status === "Under Review").length;
    const pendingClaims = claims.filter((c) => c.status === "Submitted" || c.status === "Under Review").length;
    const approved = requests.filter((r) => r.status === "Approved").length;
    const rejected = requests.filter((r) => r.status === "Rejected").length;

    return ok({
      enrollees: {
        total: all.length,
        active: count("Active"),
        expired: count("Expired"),
        pendingPayment: count("Pending Payment"),
        viaWebsite: websiteRows.length,
        newLast30Days: all.filter(
          (r) => r.enrolledAt && r.enrolledAt.getTime() <= now && now - r.enrolledAt.getTime() <= 30 * DAY,
        ).length,
        expiringWithinDays: EXPIRY_WARNING_DAYS,
        expiring: all
          .filter((r) => r.status === "Expiring")
          .map((r) => ({ name: r.name, ref: r.ref, expiresAt: r.expiresAt, source: r.source })),
        byPlan,
      },
      review: {
        queueSize: pendingRequests + pendingClaims,
        pendingRequests,
        pendingClaims,
        claimsPipeline: claims
          .filter((c) => ["Submitted", "Under Review", "Approved"].includes(c.status))
          .reduce((a, c) => a + c.amount, 0),
      },
      codes: {
        approved,
        rejected,
        approvalRate: approved + rejected ? Math.round((approved / (approved + rejected)) * 100) : 0,
      },
    });
  }
}

export default new AnalyticsController();
