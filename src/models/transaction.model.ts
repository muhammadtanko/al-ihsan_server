import { z } from "zod";

export const recordTransactionSchema = z.object({
  who: z.string().trim().min(1, "Counterparty is required"),
  amount: z.coerce.number().int().positive("Amount must be greater than zero"),
  type: z.enum(["Premium", "Premium refund", "Facility payment"]),
});
