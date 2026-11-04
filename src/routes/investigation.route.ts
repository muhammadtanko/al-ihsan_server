import { Router } from "express";
import investigationController from "../controllers/investigation.controller";
import { authenticate, requireScreen } from "../middlewares/auth.middleware";
import { naira } from "../utils/audit";
import { handle, param } from "../utils/http";

export default () => {
  const api = Router();
  api.use(authenticate);

  // Facilities read the price list when building a claim.
  api.get("/", handle(() => investigationController.list()));
  api.put(
    "/:id",
    requireScreen("investigation-prices"),
    handle(
      (req) => investigationController.update(param(req, "id"), req.body),
      (req, i) => ({
        action: "investigation.update",
        entityType: "investigation",
        entityId: i.id,
        summary: `Updated price list entry "${i.service}" — approved price ${naira(i.approved)}, baseline ${naira(i.baseline)}`,
        metadata: { changed: Object.keys((req.body as object) ?? {}), approved: i.approved, baseline: i.baseline },
      }),
    ),
  );

  return api;
};
