import bcrypt from "bcryptjs";
import { prisma } from "../connections/prisma.conn";
import type { AuthUser } from "../middlewares/auth.middleware";
import { registerUserSchema, setStatusSchema } from "../models/user.model";
import { ROLE_DEPT, ROLE_LABEL } from "../utils/access";
import { badRequest, conflict, forbidden, notFound } from "../utils/errors";
import { created, ok } from "../utils/http";
import { nextSeq, pad } from "../utils/ids";
import { codeStats, decidedCodes } from "../utils/code-stats";
import { reviewerKpis } from "../utils/reviewer-kpi";
import { userDto } from "../utils/mappers";

class UserController {
  async list() {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    return ok(users.map(userDto));
  }

  // Decision counts, approval rate and how long they take — for a medical officer's info window.
  async kpi(id: string) {
    if (!(await prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw notFound("User not found");
    return ok(await reviewerKpis(id));
  }

  // The approved and rejected authorisation codes tied to this person: the requests they
  // recorded (a desk officer or a facility account) and the ones they decided (a medical officer).
  async codes(id: string) {
    if (!(await prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw notFound("User not found");
    const [requestedStats, requested, decidedStats, decided] = await Promise.all([
      codeStats({ createdById: id }),
      decidedCodes({ createdById: id }),
      codeStats({ reviewedById: id }),
      decidedCodes({ reviewedById: id }),
    ]);
    return ok({ requested: { stats: requestedStats, items: requested }, decided: { stats: decidedStats, items: decided } });
  }

  // Disable (can no longer sign in — existing sessions end on their next request), re-enable, or mark on leave.
  async setStatus(id: string, body: unknown, actor: AuthUser) {
    const { status } = setStatusSchema.parse(body);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound("User not found");
    if (target.id === actor.id && status === "Disabled") throw badRequest("You can't disable your own account.");
    // Only an administrator can change another administrator's account.
    if (target.role === "administrator" && actor.role !== "administrator") {
      throw forbidden("Only an administrator can change an administrator's account.");
    }
    const updated = await prisma.user.update({ where: { id }, data: { status } });
    return ok(userDto(updated));
  }

  // Register a staff member (or a facility account) from HR / Staff.
  async register(body: unknown) {
    const input = registerUserSchema.parse(body);
    const email = input.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) {
      throw conflict("A user with that email already exists.");
    }

    const isFacility = input.role === "facility";
    const facility = isFacility
      ? await prisma.facility.findUnique({ where: { id: input.facilityId! } })
      : null;
    if (isFacility && !facility) throw badRequest("That facility doesn't exist.");
    if (facility) {
      // One login per facility, counting disabled ones (re-enable that one instead).
      const existing = await prisma.user.findFirst({ where: { facilityId: facility.id } });
      if (existing) {
        throw conflict(`${facility.name} already has a login (${existing.email}). A facility can only have one user.`);
      }
    }

    const user = await prisma.$transaction(async (tx) => {
      const n = await nextSeq(isFacility ? "FA" : "ST", tx);
      return tx.user.create({
        data: {
          id: `${isFacility ? "FA" : "ST"}-${pad(n, 2)}`,
          name: input.name || facility!.name,
          email,
          passwordHash: await bcrypt.hash(input.password, 10),
          role: input.role,
          title: isFacility ? "Facility — claims portal" : ROLE_LABEL[input.role],
          dept: isFacility ? facility!.name : input.dept || ROLE_DEPT[input.role] || "—",
          facilityId: isFacility ? facility!.id : null,
        },
      });
    });
    return created(userDto(user));
  }
}

export default new UserController();
