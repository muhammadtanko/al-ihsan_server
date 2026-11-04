import { Router } from "express";
import planController from "../controllers/plan.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { handle } from "../utils/http";

export default () => {
  const api = Router();
  api.get("/", authenticate, handle(() => planController.list()));
  return api;
};
