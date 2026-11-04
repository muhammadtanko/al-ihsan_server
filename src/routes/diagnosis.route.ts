import { Router } from "express";
import diagnosisController from "../controllers/diagnosis.controller";
import { authenticate } from "../middlewares/auth.middleware";
import { handle } from "../utils/http";

export default () => {
  const api = Router();
  api.get("/", authenticate, handle(() => diagnosisController.list()));
  return api;
};
