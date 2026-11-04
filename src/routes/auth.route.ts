import { Router } from "express";
import authController from "../controllers/auth.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { handle } from "../utils/http";

export default () => {
  const api = Router();

  api.post(
    "/login",
    handle(
      (req) => authController.login(req.body, req),
      (_req, r) => ({
        action: "auth.login",
        entityType: "auth",
        entityId: r.user.id,
        summary: "Signed in",
        actor: { id: r.user.id, name: r.user.name, role: r.user.role },
      }),
    ),
  );
  api.get("/me", authenticate, handle((req) => authController.me(req.user!)));

  return api;
};
