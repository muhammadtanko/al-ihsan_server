import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { config } from "../config";
import { AppError } from "../utils/errors";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ ok: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, message: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return res.status(409).json({ ok: false, message: "That record already exists" });
  }
  // multer errors (file too large, wrong type)
  if (err instanceof Error && /file|upload/i.test(err.message) && (err as { code?: string }).code?.startsWith("LIMIT")) {
    return res.status(400).json({ ok: false, message: err.message });
  }
  console.error(err);
  res.status(500).json({
    ok: false,
    message: config.isProd ? "Something went wrong" : err instanceof Error ? err.message : "Unknown error",
  });
}
