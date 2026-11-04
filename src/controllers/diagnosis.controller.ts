import { prisma } from "../connections/prisma.conn";
import { ok } from "../utils/http";

// Sample diagnoses offered as suggestions when recording a code request.
class DiagnosisController {
  async list() {
    const rows = await prisma.diagnosis.findMany({ orderBy: { sortOrder: "asc" } });
    return ok(rows.map((d) => ({ id: d.id, name: d.name, category: d.category })));
  }
}

export default new DiagnosisController();
