import { z } from "zod";

// Filters for the approved-claims report. `from` is inclusive and `to` exclusive,
// both matched against the day the claim was approved.
export const approvedClaimsQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    facilityId: z.string().trim().min(1).optional(),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .refine((q) => !q.from || !q.to || q.from < q.to, { message: "`from` must be before `to`", path: ["from"] });

export type ApprovedClaimsQuery = z.infer<typeof approvedClaimsQuerySchema>;
