import { z } from "zod";

const positiveInt = z.coerce.number().int().positive();

// Sent as JSON, or as multipart/form-data where `investigations` is a JSON string.
export const newClaimSchema = z.object({
  name: z.string().trim().min(1, "Enrollee name is required"),
  kad: z.string().trim().min(1, "Enrollee number is required"),
  linked: z.string().trim().optional(),
  // Name of a document when no file is uploaded (the prototype's text stand-in).
  doc: z.string().trim().optional(),
  investigations: z
    .preprocess(
      (v) => (typeof v === "string" ? JSON.parse(v) : v),
      z
        .array(
          z.object({
            investigationId: z.string().min(1),
            // Defaults to the KADCHMA approved price when omitted.
            amount: positiveInt.optional(),
          }),
        )
        .min(1, "Add at least one investigation"),
    ),
});

export const setAmountSchema = z.object({ amount: positiveInt });
