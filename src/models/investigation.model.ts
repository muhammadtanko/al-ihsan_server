import { z } from "zod";

export const updateInvestigationSchema = z
  .object({
    service: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    baseline: z.coerce.number().int().min(0).optional(),
    approved: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
