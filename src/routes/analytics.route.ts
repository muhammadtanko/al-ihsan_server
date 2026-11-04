import { Router } from "express";
import analyticsController from "../controllers/analytics.controller";
import { authenticate, requireScreen } from "../middlewares/auth.middleware";
import { handle } from "../utils/http";

export default () => {
  const api = Router();
  api.get("/dashboard", authenticate, requireScreen("dashboard"), handle(() => analyticsController.dashboard()));
  // Medical-officer performance, side by side.
  api.get("/reviewers", authenticate, requireScreen("dashboard"), handle(() => analyticsController.reviewers()));
  return api;
};
