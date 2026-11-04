import { Router } from "express";
import notificationController from "../controllers/notification.controller";
import { authenticate, requireScreen } from "../middlewares/auth.middleware";
import { handle } from "../utils/http";

export default () => {
  const api = Router();
  api.use(authenticate, requireScreen("notifications"));

  api.get("/templates", handle(() => notificationController.templates()));
  api.get("/deliveries", handle(() => notificationController.deliveries()));

  return api;
};
