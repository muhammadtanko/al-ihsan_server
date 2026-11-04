import { z } from "zod";

const required = (label: string) => z.string().trim().min(1, `${label} is required`);

// Matches the seven steps of the public Enroll Now flow.
export const enrollmentSchema = z
  .object({
    personal: z.object({
      firstName: required("First name"),
      lastName: required("Last name"),
      middleName: z.string().trim().optional(),
      dateOfBirth: required("Date of birth"),
      gender: z.enum(["Male", "Female"]),
      maritalStatus: z.enum(["Single", "Married", "Divorced", "Widowed"]),
    }),
    contact: z.object({
      email: z.string().trim().email("Enter a valid email address"),
      phone: required("Phone number"),
      address: required("Residential address"),
      lga: required("LGA"),
    }),
    nextOfKin: z.object({
      fullName: required("Next of kin name"),
      relationship: z.enum(["Spouse", "Parent", "Sibling", "Child", "Other"]),
      phone: required("Next of kin phone"),
    }),
    planId: z.enum(["individual", "family"]),
    facilityId: required("Facility"),
    payment: z.discriminatedUnion("method", [
      z.object({
        method: z.literal("card"),
        cardNumber: z.string().regex(/^[\d ]{12,19}$/, "Enter a valid card number"),
        expiryDate: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "Expiry must be MM/YY"),
        cvv: z.string().regex(/^\d{3,4}$/, "Enter a valid CVV"),
        cardholderName: required("Cardholder name"),
      }),
      // Everyone pays into the one account from GET /public/payment-account, so
      // there are no bank details to collect.
      z.object({ method: z.literal("transfer") }),
    ]),
  });

export type EnrollmentInput = z.infer<typeof enrollmentSchema>;
