import { prisma } from "../connections/prisma.conn";

// Medical-officer performance: how many codes / claims a person decided, how they
// were decided, and how long it took.
//
//   turnaround   — from the item being created to the decision. It includes the time it
//                  waited in the queue, so it measures the service the facility got.
//   review time  — from the officer picking it up to deciding. This is their own handling
//                  time. It is only known for items reviewed since start times were recorded.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Timing {
  sample: number; // how many decisions the figures are based on
  avgHours: number | null;
  medianHours: number | null;
  fastestHours: number | null;
  slowestHours: number | null;
}

export interface ReviewerKpi {
  decided: number;
  approved: number;
  rejected: number;
  approvalRate: number | null; // % of decided
  underReview: number; // picked up by them, not yet decided
  oldestUnderReviewHours: number | null;
  turnaround: Timing;
  reviewTime: Timing;
  within24hRate: number | null; // % of decided items decided within 24 h of being created
  last7Days: number;
  last30Days: number;
  daily: { date: string; count: number }[]; // decisions per day, last 14 days (oldest first)
}

export interface ReviewerKpis {
  codes: ReviewerKpi;
  claims: ReviewerKpi;
}

interface Item {
  status: string;
  createdAt: Date;
  reviewStartedAt: Date | null;
  reviewedAt: Date | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function timing(hours: number[]): Timing {
  if (hours.length === 0) return { sample: 0, avgHours: null, medianHours: null, fastestHours: null, slowestHours: null };
  const sorted = [...hours].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    sample: sorted.length,
    avgHours: round1(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    medianHours: round1(median),
    fastestHours: round1(sorted[0]),
    slowestHours: round1(sorted[sorted.length - 1]),
  };
}

// Approved, Paid (an approved claim that has been paid) and Rejected are decisions.
const APPROVED = ["Approved", "Paid"];
const DECIDED = [...APPROVED, "Rejected"];

export function computeKpi(items: Item[], now = Date.now()): ReviewerKpi {
  const decided = items.filter((i) => DECIDED.includes(i.status) && i.reviewedAt);
  const approved = decided.filter((i) => APPROVED.includes(i.status)).length;
  const rejected = decided.length - approved;
  const waiting = items.filter((i) => i.status === "Under Review");

  const hours = (from: Date, to: Date) => Math.max(0, to.getTime() - from.getTime()) / HOUR;
  const turnaround = decided.map((i) => hours(i.createdAt, i.reviewedAt!));
  const review = decided.filter((i) => i.reviewStartedAt).map((i) => hours(i.reviewStartedAt!, i.reviewedAt!));

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const daily = Array.from({ length: 14 }, (_, k) => {
    const day = new Date(startOfToday.getTime() - (13 - k) * DAY);
    const next = day.getTime() + DAY;
    return {
      date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
      count: decided.filter((i) => i.reviewedAt!.getTime() >= day.getTime() && i.reviewedAt!.getTime() < next).length,
    };
  });

  return {
    decided: decided.length,
    approved,
    rejected,
    approvalRate: decided.length ? Math.round((approved / decided.length) * 100) : null,
    underReview: waiting.length,
    oldestUnderReviewHours: waiting.length
      ? round1(Math.max(...waiting.map((i) => (i.reviewStartedAt ? hours(i.reviewStartedAt, new Date(now)) : hours(i.createdAt, new Date(now))))))
      : null,
    turnaround: timing(turnaround),
    reviewTime: timing(review),
    within24hRate: decided.length ? Math.round((turnaround.filter((h) => h <= 24).length / decided.length) * 100) : null,
    last7Days: decided.filter((i) => now - i.reviewedAt!.getTime() <= 7 * DAY).length,
    last30Days: decided.filter((i) => now - i.reviewedAt!.getTime() <= 30 * DAY).length,
    daily,
  };
}

const select = { status: true, createdAt: true, reviewStartedAt: true, reviewedAt: true } as const;

export async function reviewerKpis(userId: string): Promise<ReviewerKpis> {
  const [codes, claims] = await Promise.all([
    prisma.codeRequest.findMany({ where: { reviewedById: userId }, select }),
    prisma.claim.findMany({ where: { reviewedById: userId }, select }),
  ]);
  return { codes: computeKpi(codes), claims: computeKpi(claims) };
}
