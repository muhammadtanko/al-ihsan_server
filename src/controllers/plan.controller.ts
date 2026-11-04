import { prisma } from "../connections/prisma.conn";
import { ok } from "../utils/http";
import { planDto } from "../utils/mappers";

class PlanController {
  async list() {
    const plans = await prisma.plan.findMany({ include: { benefits: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
    return ok(plans.map(planDto));
  }
}

export default new PlanController();
