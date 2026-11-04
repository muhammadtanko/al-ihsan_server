import { Router } from "express";
import transactionController from "../controllers/transaction.controller";
import { authenticate, requireScreen } from "../middlewares/auth.middleware";
import { naira } from "../utils/audit";
import { handle } from "../utils/http";

export default () => {
  const api = Router();
  api.use(authenticate);

  api.get("/", requireScreen("transactions"), handle(() => transactionController.list()));
  api.post(
    "/",
    requireScreen("transactions"),
    handle(
      (req) => transactionController.record(req.body),
      (_req, t) => ({
        action: "transaction.record",
        entityType: "transaction",
        entityId: t.ref,
        summary: `Recorded ${t.type} ${t.ref} — ${naira(t.amount)} for ${t.who}`,
        metadata: { type: t.type, amount: t.amount },
      }),
    ),
  );

  return api;
};
