import { z } from "zod";
import { CONSOLE_ROLES } from "../utils/access";

export const USER_STATUSES = ["Active", "On leave", "Disabled"] as const;
export const setStatusSchema = z.object({ status: z.enum(USER_STATUSES) });

export const registerUserSchema = z
  .object({
    name: z.string().trim().optional(),
    email: z.string().trim().email("Enter a valid email address"),
    role: z.enum(CONSOLE_ROLES),
    dept: z.string().trim().optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    // Required when role = facility: the facility this account submits claims for.
    facilityId: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === "facility") {
      if (!v.facilityId) ctx.addIssue({ code: "custom", path: ["facilityId"], message: "Select the facility this account belongs to" });
    } else if (!v.name) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "Full name is required" });
    }
  });

export type RegisterUserInput = z.infer<typeof registerUserSchema>;
