import type { NextFunction, Request, RequestHandler, Response } from "express";
import { recordAudit, type AuditEntry } from "./audit";

// Every response uses the sample's envelope: { ok, payLoad } or { ok:false, message }.
export interface Result<T> {
  payLoad: T;
  status?: number;
}

export const created = <T>(payLoad: T): Result<T> => ({ payLoad, status: 201 });
export const ok = <T>(payLoad: T): Result<T> => ({ payLoad });

// Wraps a controller call so routes stay one-liners and errors reach the error middleware.
// Pass `audit` to record the action in the audit trail once it has succeeded; it
// receives the controller's result so the entry can say what actually happened.
export const handle =
  <T>(
    fn: (req: Request, res: Response) => Promise<Result<T> | void>,
    audit?: (req: Request, payload: T) => AuditEntry,
  ): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await fn(req, res);
      if (result && audit) await recordAudit(req, audit(req, result.payLoad));
      if (result) res.status(result.status ?? 200).json({ ok: true, payLoad: result.payLoad });
    } catch (err) {
      next(err);
    }
  };

export const param = (req: Request, name: string): string => String(req.params[name]);
