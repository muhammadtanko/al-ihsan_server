import { Router } from "express";
import accessController from "../controllers/access.controller";
import { authenticate, requireScreen } from "../middlewares/auth.middleware";
import { ROLE_LABEL } from "../utils/access";
import { handle, param } from "../utils/http";

export default () => {
  const api = Router();
  api.use(authenticate, requireScreen("access"));

  api.post(
    "/reset-all",
    handle(
      () => accessController.resetAll(),
      () => ({ action: "access.reset_all", entityType: "access", summary: "Reset everyone's pages to their role defaults" }),
    ),
  );
  api.put(
    "/:userId",
    handle(
      (req) => accessController.set(param(req, "userId"), req.body),
      (_req, u) => ({
        action: "access.set",
        entityType: "access",
        entityId: u.id,
        summary: `Changed the pages ${u.name} (${u.id}) can open — now ${u.screens.length ? u.screens.join(", ") : "none"}`,
        metadata: { screens: u.screens, role: u.role },
      }),
    ),
  );
  api.delete(
    "/:userId",
    handle(
      (req) => accessController.reset(param(req, "userId")),
      (_req, u) => ({
        action: "access.reset",
        entityType: "access",
        entityId: u.id,
        summary: `Reset ${u.name} (${u.id}) to the ${ROLE_LABEL[u.role]} default pages`,
        metadata: { screens: u.screens },
      }),
    ),
  );

  return api;
};
