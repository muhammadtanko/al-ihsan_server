// No login needed: what the public Enroll Now page uses.
import { Router } from "express";
import enrollmentController from "../controllers/enrollment.controller";
import { handle } from "../utils/http";

export default () => {
  const api = Router();

  api.get("/plans", handle(() => enrollmentController.plans()));
  api.get("/payment-account", handle(() => enrollmentController.paymentAccount()));
  api.get("/facilities", handle(() => enrollmentController.facilities()));
  api.post(
    "/enrollment",
    handle(
      (req) => enrollmentController.enroll(req.body),
      (_req, e) => ({
        action: "enrollment.create",
        entityType: "enrollment",
        entityId: e.enrollmentNumber,
        summary: `${e.fullName} enrolled through the website — ${e.plan.name}, ${e.facility.name} (${e.membershipNumber})`,
        metadata: { planId: e.plan.id, facilityId: e.facility.id, membershipNumber: e.membershipNumber },
        actor: { name: "Website visitor", role: "public" },
      }),
    ),
  );

  return api;
};
