import { prisma } from "../connections/prisma.conn";
import { updateInvestigationSchema } from "../models/investigation.model";
import { notFound } from "../utils/errors";
import { ok } from "../utils/http";
import { investigationDto } from "../utils/mappers";

// The system-wide KADCHMA tariff (baseline vs. approved price per service).
class InvestigationController {
  async list() {
    const rows = await prisma.investigation.findMany({ orderBy: { sortOrder: "asc" } });
    return ok(rows.map(investigationDto));
  }

  async update(id: string, body: unknown) {
    const patch = updateInvestigationSchema.parse(body);
    if (!(await prisma.investigation.findUnique({ where: { id } }))) throw notFound("Investigation not found");
    return ok(investigationDto(await prisma.investigation.update({ where: { id }, data: patch })));
  }
}

export default new InvestigationController();
