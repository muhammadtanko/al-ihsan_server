// Public (no login) endpoints behind the website's Enroll Now flow.
import { Prisma } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../connections/prisma.conn";
import { enrollmentSchema } from "../models/enrollment.model";
import { badRequest, notFound } from "../utils/errors";
import { created, ok } from "../utils/http";
import { generateEnrollmentNumber, generateMembershipNumber, generateRef } from "../utils/ids";
import { facilityDto, healthPlanDto } from "../utils/mappers";

class EnrollmentController {
  async plans() {
    const plans = await prisma.healthPlan.findMany({ orderBy: { sortOrder: "asc" } });
    return ok(plans.map(healthPlanDto));
  }

  // Where bank-transfer payments go (the same account for everyone).
  async paymentAccount() {
    return ok(config.paymentAccount);
  }

  async facilities() {
    const facilities = await prisma.facility.findMany({
      where: { enrollmentListed: true },
      orderBy: { id: "asc" },
    });
    return ok(facilities.map(facilityDto));
  }

  // Payment is simulated until a gateway is chosen: card details are
  // validated but never stored, and a SIM- reference stands in for the gateway's.
  async enroll(body: unknown) {
    const input = enrollmentSchema.parse(body);

    const [plan, facility] = await Promise.all([
      prisma.healthPlan.findUnique({ where: { id: input.planId } }),
      prisma.facility.findUnique({ where: { id: input.facilityId } }),
    ]);
    if (!plan) throw notFound("That plan doesn't exist");
    if (!facility || !facility.enrollmentListed) throw badRequest("Choose a facility from the list");

    const fullName = [input.personal.firstName, input.personal.middleName, input.personal.lastName]
      .filter(Boolean)
      .join(" ");

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const enrollment = await prisma.$transaction(async (tx) => {
          const enrolledAt = new Date();
          const expiresAt = new Date(enrolledAt);
          expiresAt.setFullYear(expiresAt.getFullYear() + 1); // a website policy runs for one year
          const enrollmentNumber = generateEnrollmentNumber();
          const row = await tx.enrollee.create({
            data: {
              id: enrollmentNumber,
              enrollmentNumber,
              source: "Website",
              name: fullName,
              kad: generateMembershipNumber(),
              firstName: input.personal.firstName,
              middleName: input.personal.middleName || null,
              lastName: input.personal.lastName,
              dateOfBirth: input.personal.dateOfBirth,
              gender: input.personal.gender,
              maritalStatus: input.personal.maritalStatus,
              email: input.contact.email.toLowerCase(),
              phone: input.contact.phone,
              address: input.contact.address,
              lga: input.contact.lga,
              kinName: input.nextOfKin.fullName,
              kinRelationship: input.nextOfKin.relationship,
              kinPhone: input.nextOfKin.phone,
              healthPlanId: plan.id,
              facilityId: facility.id,
              status: "Active", // paid; the status then follows the expiry date
              enrolledAt,
              expiresAt,
              paymentMethod: input.payment.method,
              amount: plan.price,
              paymentRef: generateRef("SIM"),
            },
          });
          await tx.transaction.create({
            data: {
              ref: row.paymentRef!,
              who: fullName,
              enrolleeId: row.id,
              type: "Premium",
              amount: plan.price,
              status: "Confirmed",
            },
          });
          return row;
        });

        return created({
          enrollmentNumber: enrollment.id,
          membershipNumber: enrollment.kad,
          enrolledAt: enrollment.enrolledAt,
          fullName,
          plan: healthPlanDto(plan),
          facility: facilityDto(facility),
        });
      } catch (err) {
        // Random enrollment/membership/payment number collided — try fresh ones.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }
    throw new Error("Could not generate a unique enrollment number, please retry");
  }
}

export default new EnrollmentController();
