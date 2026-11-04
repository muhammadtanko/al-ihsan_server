import { prisma } from "../connections/prisma.conn";
import { ok } from "../utils/http";
import { deliveryDto, templateDto } from "../utils/mappers";

class NotificationController {
  async templates() {
    return ok((await prisma.messageTemplate.findMany({ orderBy: { id: "asc" } })).map(templateDto));
  }

  async deliveries() {
    return ok((await prisma.delivery.findMany({ orderBy: { time: "desc" } })).map(deliveryDto));
  }
}

export default new NotificationController();
