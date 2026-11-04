import { z } from "zod";
import { prisma } from "../connections/prisma.conn";
import { ok } from "../utils/http";
import { enrolleeStatus } from "../utils/enrollee-status";
import { enrolleeDto, transactionDto } from "../utils/mappers";

const listQuerySchema = z.object({ source: z.enum(["KADCHMA", "Website"]).optional() });

class EnrolleeController {
  // Everyone enrolled — KADCHMA register and website sign-ups alike — newest first.
  // `?source=KADCHMA|Website` narrows it.
  async list(rawQuery: unknown = {}) {
    const { source } = listQuerySchema.parse(rawQuery);
    const [enrollees, transactions] = await Promise.all([
      prisma.enrollee.findMany({
        where: source ? { source } : {},
        include: { plan: true, healthPlan: true, facility: true },
        orderBy: [{ enrolledAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      }),
      prisma.transaction.findMany({ orderBy: { date: "desc" } }),
    ]);
    // Each person's own payments travel with them, so seeing an enrollee never
    // requires access to the full Transactions ledger. Payments are linked by id;
    // older or manual entries that name the person (and no one else) count too.
    const paymentsOf = (e: { id: string; name: string }) =>
      transactions.filter((t) => (t.enrolleeId ? t.enrolleeId === e.id : t.who === e.name)).map(transactionDto);
    return ok(enrollees.map((e) => ({ ...enrolleeDto(e), transactions: paymentsOf(e) })));
  }

  // Is this enrollee number on file here? If so, the basics the request and claim forms
  // fill in for you: name, phone and plan.
  async verify(kad: string) {
    const number = kad.trim();
    const found = number
      ? await prisma.enrollee.findFirst({
          where: { kad: { equals: number, mode: "insensitive" } },
          include: { plan: true, healthPlan: true },
        })
      : null;
    return ok({
      kad: number,
      verified: !!found,
      enrollee: found
        ? {
            kad: found.kad,
            name: found.name,
            phone: found.phone,
            planId: found.planId, // the KADCHMA plan, when they hold one
            planName: found.plan?.name ?? found.healthPlan?.name ?? "—",
            status: enrolleeStatus(found),
          }
        : null,
    });
  }
}

export default new EnrolleeController();
