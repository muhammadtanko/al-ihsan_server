import { prisma } from "../connections/prisma.conn";
import { codeStats, decidedCodes } from "../utils/code-stats";
import { notFound } from "../utils/errors";
import { addFacilitySchema } from "../models/facility.model";
import { created, ok } from "../utils/http";
import { nextSeq, pad } from "../utils/ids";
import { facilityDto } from "../utils/mappers";

class FacilityController {
  async list() {
    const facilities = await prisma.facility.findMany({ orderBy: { createdAt: "asc" } });
    return ok(facilities.map(facilityDto));
  }

  // The approved and rejected authorisation codes tied to a facility, with the share of each:
  // `requested` — codes this facility asked for (it is the referring facility);
  // `received` — codes issued for patients it is receiving.
  async codes(id: string) {
    if (!(await prisma.facility.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Facility not found");
    const [requestedStats, requested, receivedStats, received] = await Promise.all([
      codeStats({ refFacilityId: id }),
      decidedCodes({ refFacilityId: id }),
      codeStats({ recvFacilityId: id }),
      decidedCodes({ recvFacilityId: id }),
    ]);
    return ok({ requested: { stats: requestedStats, items: requested }, received: { stats: receivedStats, items: received } });
  }

  // New facilities start as Pending affiliation until accredited.
  async add(body: unknown) {
    const input = addFacilitySchema.parse(body);
    const facility = await prisma.$transaction(async (tx) => {
      const n = await nextSeq("F", tx);
      return tx.facility.create({
        data: {
          id: `F${n}`,
          code: input.code || `FAC-${pad(194 + n, 4)}`,
          name: input.name,
          tier: input.tier,
          lga: input.lga || "—",
          phone: input.phone || "—",
          status: "Pending",
        },
      });
    });
    return created(facilityDto(facility));
  }
}

export default new FacilityController();
