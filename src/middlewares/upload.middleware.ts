import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { badRequest } from "../utils/errors";

// Local-disk counterpart of the sample's Cloudflare R2 upload middleware.
// Files get an unguessable name and are only served through an authenticated
// route (see claim.route.ts) — claim documents contain health information.

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/jpg", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID().replace(/-/g, "")}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(badRequest("Invalid file type. Only PDF and images are allowed."));
    }
    cb(null, true);
  },
});

// Accepts an optional single file in `fieldName`. JSON requests pass straight through.
export const uploadFile = (fieldName: string) => (req: Request, res: Response, next: NextFunction) =>
  upload.single(fieldName)(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(badRequest(err.code === "LIMIT_FILE_SIZE" ? "File exceeds the 10MB limit" : err.message));
    }
    next(err as Error | undefined);
  });

// Accepts up to `max` optional files in `fieldName`. JSON requests pass straight through.
export const uploadFiles = (fieldName: string, max = 5) => (req: Request, res: Response, next: NextFunction) =>
  upload.array(fieldName, max)(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Each file must be 10MB or smaller"
          : err.code === "LIMIT_UNEXPECTED_FILE"
            ? `Attach at most ${max} files`
            : err.message;
      return next(badRequest(message));
    }
    next(err as Error | undefined);
  });

export const removeUploaded = (storedName: string | null | undefined) => {
  if (!storedName) return;
  fs.promises.unlink(path.join(config.uploadDir, storedName)).catch(() => undefined);
};

export const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
