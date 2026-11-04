import { z } from "zod";

export const newRequestSchema = z.object({
  name: z.string().trim().min(1, "Enrollee name is required"),
  kad: z.string().trim().min(1, "Enrollee number is required"),
  phone: z.string().trim().optional(),
  dx: z.string().trim().min(1, "Diagnosis is required"),
  proc: z.string().trim().min(1, "Procedure is required"),
  planId: z.string().min(1),
  refId: z.string().min(1),
  recvId: z.string().min(1),
});

export const rejectSchema = z.object({
  reason: z.string().trim().optional(),
});
