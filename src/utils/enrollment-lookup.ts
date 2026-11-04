import { prisma } from "../connections/prisma.conn";

// Matches the enrollee numbers on requests/claims against known enrollees — the
// KADCHMA register and people who enrolled through the website (the number we issue
// them is their `kad`) — so a reviewer sees "verified" without needing access
// to the Enrollees page.
export async function lookupKads(kads: string[]) {
  const unique = [...new Set(kads.map((k) => k.trim()).filter(Boolean))];
  const enrollees = unique.length
    ? await prisma.enrollee.findMany({ where: { kad: { in: unique } }, select: { kad: true, planId: true } })
    : [];
  const plans = new Map(enrollees.map((e) => [e.kad, e.planId]));
  return {
    verified: (kad: string) => plans.has(kad.trim()),
    // The KADCHMA plan the enrollee holds (website sign-ups hold a website plan instead).
    planId: (kad: string): string | null => plans.get(kad.trim()) ?? null,
  };
}
