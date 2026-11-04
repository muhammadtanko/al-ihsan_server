import { Router } from "express";
import enrolleeController from "../controllers/enrollee.controller";
import { authenticate, requireScreen } from "../middlewares/auth.middleware";
import { handle, param } from "../utils/http";

export default () => {
  const api = Router();
  api.get("/", authenticate, requireScreen("enrollees"), handle((req) => enrolleeController.list(req.query)));
  api.get("/verify/:kad", authenticate, requireScreen("enrollees", "requests", "facility-portal"), handle((req) => enrolleeController.verify(param(req, "kad"))));
  return api;
};
