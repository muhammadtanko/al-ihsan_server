// An enrollee's policy status, one rule for everyone whatever their source.
//
// "Pending Payment" is stored (the policy hasn't started). Otherwise the status
// follows the expiry date: past it = Expired, within 30 days = Expiring, else Active.
// Working it out from the date keeps it correct without anything having to update it.

export const EXPIRY_WARNING_DAYS = 30;
const DAY = 86_400_000;

export type EnrolleeStatus = "Pending Payment" | "Active" | "Expiring" | "Expired";

export function enrolleeStatus(e: { status: string; expiresAt: Date | null }, now = Date.now()): EnrolleeStatus {
  if (e.status === "Pending Payment" || !e.expiresAt) return e.status as EnrolleeStatus;
  const left = e.expiresAt.getTime() - now;
  if (left < 0) return "Expired";
  return left <= EXPIRY_WARNING_DAYS * DAY ? "Expiring" : "Active";
}
