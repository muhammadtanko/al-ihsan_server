import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../connections/prisma.conn";
import { effectiveScreens, type ConsoleRole, type ScreenId } from "../utils/access";
import { forbidden, unauthorized } from "../utils/errors";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  title: string;
  role: ConsoleRole;
  facilityId: string | null;
  screens: ScreenId[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: string, role: string): string {
  return jwt.sign({ sub: userId, role }, config.webToken.secretKey, {
    expiresIn: config.webToken.expiresIn as jwt.SignOptions["expiresIn"],
  });
}

// Verifies the bearer token, then loads the person fresh from the database so a
// role change, a disabled account or an Access Control edit takes effect at once.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized("Missing or malformed Authorization header");

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7).trim(), config.webToken.secretKey) as jwt.JwtPayload;
    } catch {
      throw unauthorized("Invalid or expired token");
    }

    const user = await prisma.user.findUnique({ where: { id: String(payload.sub) } });
    if (!user || user.status === "Disabled") throw unauthorized("This account is no longer active");

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      title: user.title,
      role: user.role as ConsoleRole,
      facilityId: user.facilityId,
      screens: effectiveScreens(user),
    };
    next();
  } catch (err) {
    next(err);
  }
}

// The caller must have been granted at least one of these pages.
export const requireScreen =
  (...screens: ScreenId[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!screens.some((s) => req.user!.screens.includes(s))) {
      return next(forbidden("Your account hasn't been given access to this page"));
    }
    next();
  };

// Some actions (approve, pay, register a request) also depend on the person's role,
// exactly as the console UI does — a page grant alone doesn't unlock them.
export const requireRole =
  (...roles: ConsoleRole[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden("Your role can't perform this action"));
    next();
  };
