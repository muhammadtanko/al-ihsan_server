import { Router } from "express";
import facilityController from "../controllers/facility.controller";
import { authenticate, requireScreen } from "../middlewares/auth.middleware";
import { handle, param } from "../utils/http";

export default () => {
  const api = Router();
  api.use(authenticate);

  api.get("/", handle(() => facilityController.list()));
  // The approved and rejected codes tied to one facility, with approval/rejection percentages.
  api.get("/:id/codes", requireScreen("facilities"), handle((req) => facilityController.codes(param(req, "id"))));

  api.post(
    "/",
    requireScreen("facilities"),
    handle(
      (req) => facilityController.add(req.body),
      (_req, f) => ({
        action: "facility.add",
        entityType: "facility",
        entityId: f.id,
        summary: `Added facility ${f.name} (${f.code}, ${f.tier})`,
        metadata: { code: f.code, tier: f.tier },
      }),
    ),
  );

  return api;
};
