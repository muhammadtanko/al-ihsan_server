import { Router } from "express";
import userController from "../controllers/user.controller";
import { authenticate, requireScreen } from "../middlewares/auth.middleware";
import { ROLE_LABEL } from "../utils/access";
import { handle, param } from "../utils/http";

export default () => {
  const api = Router();
  api.use(authenticate);

  // HR / Staff lists everyone; Access Control needs the same list.
  api.get("/", requireScreen("hr", "access"), handle(() => userController.list()));
  // Medical-officer performance: decisions, approval rate and turnaround times.
  api.get("/:id/kpi", requireScreen("hr"), handle((req) => userController.kpi(param(req, "id"))));

  // The approved and rejected codes tied to one person — shown on their info window.
  api.get("/:id/codes", requireScreen("hr"), handle((req) => userController.codes(param(req, "id"))));

  api.post(
    "/",
    requireScreen("hr"),
    handle(
      (req) => userController.register(req.body),
      (_req, u) => ({
        action: "user.register",
        entityType: "user",
        entityId: u.id,
        summary: `Registered ${ROLE_LABEL[u.role]} ${u.name} (${u.id}, ${u.email})`,
        metadata: { role: u.role, facilityId: u.facilityId },
      }),
    ),
  );
  api.patch(
    "/:id/status",
    requireScreen("hr"),
    handle(
      (req) => userController.setStatus(param(req, "id"), req.body, req.user!),
      (_req, u) => ({
        action: u.status === "Disabled" ? "user.disable" : u.status === "Active" ? "user.enable" : "user.status",
        entityType: "user",
        entityId: u.id,
        summary:
          u.status === "Disabled"
            ? `Disabled ${u.name} (${u.id}) — they can no longer sign in`
            : u.status === "Active"
              ? `Re-enabled ${u.name} (${u.id})`
              : `Marked ${u.name} (${u.id}) as ${u.status}`,
        metadata: { status: u.status },
      }),
    ),
  );

  return api;
};
