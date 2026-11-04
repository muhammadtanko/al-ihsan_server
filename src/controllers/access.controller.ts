import { Prisma } from "@prisma/client";
import { prisma } from "../connections/prisma.conn";
import { setAccessSchema } from "../models/access.model";
import { ADMIN_ONLY_SCREENS, ConsoleRole, defaultScreens, SCREENS } from "../utils/access";
import { badRequest, notFound } from "../utils/errors";
import { ok } from "../utils/http";
import { userDto } from "../utils/mappers";

// Per-person page access. Only the difference from the role's defaults is stored.
class AccessController {
  async set(userId: string, body: unknown) {
    const { screens } = setAccessSchema.parse(body);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    if (user.role !== "administrator" && screens.some((s) => ADMIN_ONLY_SCREENS.includes(s))) {
      throw badRequest("The audit log is for administrators only and can't be given to anyone else.");
    }

    const wanted = SCREENS.filter((s) => screens.includes(s));
    const defaults = defaultScreens(user.role as ConsoleRole);
    const sameAsDefault = wanted.length === defaults.length && wanted.every((s, i) => s === defaults[i]);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { accessOverride: sameAsDefault ? Prisma.DbNull : wanted },
    });
    return ok(userDto(updated));
  }

  async reset(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    const updated = await prisma.user.update({ where: { id: userId }, data: { accessOverride: Prisma.DbNull } });
    return ok(userDto(updated));
  }

  async resetAll() {
    await prisma.user.updateMany({ data: { accessOverride: Prisma.DbNull } });
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    return ok(users.map(userDto));
  }
}

export default new AccessController();
