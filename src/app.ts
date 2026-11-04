import cors from "cors";
import express from "express";
import morgan from "morgan";
import { config } from "./config";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware";
import accessRoutes from "./routes/access.route";
import analyticsRoutes from "./routes/analytics.route";
import authRoutes from "./routes/auth.route";
import claimRoutes from "./routes/claim.route";
import enrolleeRoutes from "./routes/enrollee.route";
import facilityRoutes from "./routes/facility.route";
import diagnosisRoutes from "./routes/diagnosis.route";
import auditRoutes from "./routes/audit.route";
import reportRoutes from "./routes/report.route";
import investigationRoutes from "./routes/investigation.route";
import notificationRoutes from "./routes/notification.route";
import planRoutes from "./routes/plan.route";
import publicRoutes from "./routes/public.route";
import requestRoutes from "./routes/request.route";
import transactionRoutes from "./routes/transaction.route";
import userRoutes from "./routes/user.route";

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  if (config.nodeEnv === "development") app.use(morgan("dev"));

  app.get("/api/v1/health", (_req, res) => res.json({ ok: true, payLoad: { status: "up" } }));

  app.use("/api/v1/auth", authRoutes());
  app.use("/api/v1/public", publicRoutes());
  app.use("/api/v1/user", userRoutes());
  app.use("/api/v1/access", accessRoutes());
  app.use("/api/v1/facility", facilityRoutes());
  app.use("/api/v1/plan", planRoutes());
  app.use("/api/v1/enrollee", enrolleeRoutes());
  app.use("/api/v1/request", requestRoutes());
  app.use("/api/v1/claim", claimRoutes());
  app.use("/api/v1/diagnosis", diagnosisRoutes());
  app.use("/api/v1/investigation", investigationRoutes());
  app.use("/api/v1/transaction", transactionRoutes());
  app.use("/api/v1/notification", notificationRoutes());
  app.use("/api/v1/audit", auditRoutes());
  app.use("/api/v1/report", reportRoutes());
  app.use("/api/v1/analytics", analyticsRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
