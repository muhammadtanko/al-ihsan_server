import type { Request } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../connections/prisma.conn";
import { signToken, type AuthUser } from "../middlewares/auth.middleware";
import { loginSchema } from "../models/auth.model";
import { recordAudit } from "../utils/audit";
import { forbidden, notFound, unauthorized } from "../utils/errors";
import { ok } from "../utils/http";
import { userDto } from "../utils/mappers";

class AuthController {
  async login(body: unknown, req?: Request) {
    const { email, password } = loginSchema.parse(body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Same message whether the email or the password is wrong.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      // Failed attempts are worth seeing (guessing, typos). The password is never logged.
      await recordAudit(req, {
        action: "auth.login_failed",
        entityType: "auth",
        entityId: user?.id ?? null,
        summary: `Failed sign-in for ${email.toLowerCase()}${user ? "" : " (no such account)"}`,
        actor: { id: user?.id ?? null, name: user?.name ?? email.toLowerCase(), role: user?.role ?? null },
      });
      throw unauthorized("Email or password is incorrect.");
    }
    if (user.status === "Disabled") {
      await recordAudit(req, {
        action: "auth.login_blocked",
        entityType: "auth",
        entityId: user.id,
        summary: `Sign-in refused — ${user.name}'s account is disabled`,
        actor: { id: user.id, name: user.name, role: user.role },
      });
      throw forbidden("This account has been disabled.");
    }
    return ok({ token: signToken(user.id, user.role), user: userDto(user) });
  }

  async me(auth: AuthUser) {
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw notFound("Account not found");
    return ok(userDto(user));
  }
}

export default new AuthController();
