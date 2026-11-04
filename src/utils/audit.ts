import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../connections/prisma.conn";

// The audit trail: one row per thing that happened, written by the route layer
// (see `handle` in utils/http.ts) right after an action succeeds, so every entry
// is something that really took effect. Request bodies are never stored — only
// the short summary and a few deliberately chosen facts — so passwords, card
// numbers and the like can't end up in the log.

export interface AuditEntry {
  action: string; // area.verb, e.g. "claim.approve"
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  // For actions with no signed-in user (public enrollment, failed sign-ins).
  actor?: { id?: string | null; name: string; role?: string | null };
}

export const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

// Never throws: failing to write an audit row must not undo or block the action it describes.
export async function recordAudit(req: Request | undefined, entry: AuditEntry): Promise<void> {
  try {
    const user = req?.user;
    const actor = entry.actor ?? (user ? { id: user.id, name: user.name, role: user.role } : { name: "Unknown" });
    await prisma.auditLog.create({
      data: {
        actorId: actor.id ?? null,
        actorName: actor.name,
        actorRole: actor.role ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        metadata: (entry.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        ip: req?.ip ?? null,
      },
    });
  } catch (err) {
    console.error("Could not write audit log entry:", err);
  }
}
