import { z } from "zod";

export const addFacilitySchema = z.object({
  name: z.string().trim().min(1, "Facility name is required"),
  code: z.string().trim().optional(),
  tier: z.enum(["Primary", "Secondary", "Tertiary"]).default("Primary"),
  lga: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});
