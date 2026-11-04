import { z } from "zod";

// Filters for the audit log. `from` is inclusive, `to` exclusive.
export const auditQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    actorId: z.string().trim().min(1).optional(),
    entityType: z.string().trim().min(1).optional(),
    action: z.string().trim().min(1).optional(),
    entityId: z.string().trim().min(1).optional(),
    q: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    format: z.enum(["json", "csv"]).default("json"),
  })
  .refine((v) => !v.from || !v.to || v.from < v.to, { message: "`from` must be before `to`", path: ["from"] });

export type AuditQuery = z.infer<typeof auditQuerySchema>;
