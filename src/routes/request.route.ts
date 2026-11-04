import { Router } from "express";
import requestController from "../controllers/request.controller";
import { authenticate, requireRole, requireScreen } from "../middlewares/auth.middleware";
import { handle, param } from "../utils/http";

export default () => {
  const api = Router();
  api.use(authenticate);

  api.get("/", requireScreen("requests", "queue", "dashboard"), handle((req) => requestController.list(req.user!)));

  // Facility accounts: the approved codes they can link to a claim.
  api.get("/codes", requireScreen("facility-portal"), handle((req) => requestController.approvedCodes(req.user!)));

  // Desk officers (and administrators) record requests relayed from facilities;
  // facility accounts can also send their own.
  api.post(
    "/",
    requireScreen("requests"),
    requireRole("administrator", "desk-officer", "facility"),
    handle(
      (req) => requestController.create(req.body, req.user!),
      (_req, r) => ({
        action: "request.create",
        entityType: "request",
        entityId: r.id,
        summary: `Created code request ${r.id} for ${r.name} (${r.kad}) — ${r.proc}`,
        metadata: { referringFacilityId: r.refId, receivingFacilityId: r.recvId },
      }),
    ),
  );

  // Clinical review is for medical officers (and administrators).
  const review = [requireScreen("queue"), requireRole("administrator", "medical-officer")];
  api.post(
    "/:id/start-review",
    ...review,
    handle(
      (req) => requestController.startReview(param(req, "id"), req.user!),
      (_req, r) => ({ action: "request.start_review", entityType: "request", entityId: r.id, summary: `Started review of code request ${r.id} (${r.name})` }),
    ),
  );
  api.post(
    "/:id/approve",
    ...review,
    handle(
      (req) => requestController.approve(param(req, "id"), req.user!),
      (_req, r) => ({
        action: "request.approve",
        entityType: "request",
        entityId: r.id,
        summary: `Approved code request ${r.id} for ${r.name} — code ${r.code}`,
        metadata: { code: r.code },
      }),
    ),
  );
  api.post(
    "/:id/reject",
    ...review,
    handle(
      (req) => requestController.reject(param(req, "id"), req.body, req.user!),
      (_req, r) => ({
        action: "request.reject",
        entityType: "request",
        entityId: r.id,
        summary: `Rejected code request ${r.id} for ${r.name}: ${r.reason ?? "no reason given"}`,
        metadata: { reason: r.reason },
      }),
    ),
  );

  // Relaying the decision to the facility is the desk's job, not the facility's.
  api.post(
    "/:id/sent",
    requireScreen("requests", "queue"),
    requireRole("administrator", "desk-officer", "medical-officer"),
    handle(
      (req) => requestController.markSent(param(req, "id")),
      (_req, r) => ({ action: "request.mark_sent", entityType: "request", entityId: r.id, summary: `Marked the response for code request ${r.id} as sent to the facility` }),
    ),
  );

  return api;
};
