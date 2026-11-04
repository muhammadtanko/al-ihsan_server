import { Prisma } from "@prisma/client";
import { prisma } from "../connections/prisma.conn";
import { auditQuerySchema, type AuditQuery } from "../models/audit.model";
import { toCsv } from "../utils/csv";
import { ok } from "../utils/http";

const EXPORT_LIMIT = 10_000;

const auditDto = (r: Prisma.AuditLogGetPayload<object>) => ({
  id: r.id,
  at: r.at,
  actorId: r.actorId,
  actorName: r.actorName,
  actorRole: r.actorRole,
  action: r.action,
  entityType: r.entityType,
  entityId: r.entityId,
  summary: r.summary,
  metadata: r.metadata,
  ip: r.ip,
});

function whereFor(q: AuditQuery): Prisma.AuditLogWhereInput {
  return {
    ...((q.from || q.to) && { at: { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) } }),
    ...(q.actorId && { actorId: q.actorId }),
    ...(q.entityType && { entityType: q.entityType }),
    ...(q.action && { action: q.action }),
    ...(q.entityId && { entityId: q.entityId }),
    ...(q.q && {
      OR: [
        { summary: { contains: q.q, mode: "insensitive" } },
        { entityId: { contains: q.q, mode: "insensitive" } },
        { actorName: { contains: q.q, mode: "insensitive" } },
        { action: { contains: q.q, mode: "insensitive" } },
      ],
    }),
  };
}

// Read-only: the audit trail can be searched and exported, never edited or deleted.
class AuditController {
  async list(rawQuery: unknown) {
    const q = auditQuerySchema.parse(rawQuery);
    const where = whereFor(q);
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ at: "desc" }, { id: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return ok({ rows: rows.map(auditDto), total, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) });
  }

  // What the filter dropdowns offer: the people, areas and actions that appear in the trail.
  async options() {
    const [actors, actions, entityTypes] = await Promise.all([
      prisma.auditLog.groupBy({ by: ["actorId", "actorName"], where: { actorId: { not: null } }, orderBy: { actorName: "asc" } }),
      prisma.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } }),
      prisma.auditLog.groupBy({ by: ["entityType"], orderBy: { entityType: "asc" } }),
    ]);
    return ok({
      actors: actors.map((a) => ({ id: a.actorId!, name: a.actorName })),
      actions: actions.map((a) => a.action),
      entityTypes: entityTypes.map((e) => e.entityType),
    });
  }

  // The same filtered view as a CSV (newest first, capped at 10,000 rows).
  async csv(rawQuery: unknown) {
    const q = auditQuerySchema.parse(rawQuery);
    const where = whereFor(q);
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], take: EXPORT_LIMIT }),
    ]);
    const lines: (string | number | null)[][] = [
      ["When (UTC)", "Who", "Role", "Action", "Area", "Record", "Details", "IP address"],
      ...rows.map((r) => [r.at.toISOString().replace("T", " ").slice(0, 19), r.actorName, r.actorRole, r.action, r.entityType, r.entityId, r.summary, r.ip]),
    ];
    if (total > rows.length) lines.push([], [`Showing the newest ${rows.length} of ${total} matching entries`]);
    const day = (d?: Date) => (d ? d.toISOString().slice(0, 10) : "");
    const range = q.from || q.to ? `-${day(q.from) || "start"}_to_${day(q.to) || "now"}` : "";
    return { body: toCsv(lines), filename: `audit-log${range}.csv`, count: rows.length };
  }
}

export default new AuditController();
