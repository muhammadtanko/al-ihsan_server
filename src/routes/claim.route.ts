import { Router } from "express";
import claimController from "../controllers/claim.controller";
import { authenticate, requireRole, requireScreen } from "../middlewares/auth.middleware";
import { uploadFile, uploadFiles } from "../middlewares/upload.middleware";
import { naira, recordAudit } from "../utils/audit";
import { handle, param } from "../utils/http";

const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;

export default () => {
  const api = Router();
  api.use(authenticate);

  api.get(
    "/",
    requireScreen("claims", "queue", "dashboard", "facility-portal"),
    handle((req) => claimController.list(req.user!)),
  );

  // Only a facility account can submit — the claim is filed for its own facility.
  api.post(
    "/",
    requireScreen("facility-portal"),
    requireRole("facility"),
    uploadFile("document"),
    handle(
      (req) => claimController.create(req.body, req.file, req.user!),
      (_req, c) => ({
        action: "claim.create",
        entityType: "claim",
        entityId: c.id,
        summary: `Submitted claim ${c.id} for ${c.name} (${c.kad}) — ${naira(c.amount)}${c.linked !== "—" ? `, linked to ${c.linked}` : ""}`,
        metadata: { amount: c.amount, facilityId: c.facId, lines: c.investigations.length, documents: c.docs.length },
      }),
    ),
  );

  // Clinical review is for medical officers (and administrators).
  const review = [requireScreen("queue"), requireRole("administrator", "medical-officer")];
  api.post(
    "/:id/start-review",
    ...review,
    handle(
      (req) => claimController.startReview(param(req, "id"), req.user!),
      (_req, c) => ({ action: "claim.start_review", entityType: "claim", entityId: c.id, summary: `Started review of claim ${c.id} (${c.name})` }),
    ),
  );
  api.post(
    "/:id/approve",
    ...review,
    handle(
      (req) => claimController.approve(param(req, "id"), req.user!),
      (_req, c) => ({
        action: "claim.approve",
        entityType: "claim",
        entityId: c.id,
        summary: `Approved claim ${c.id} for ${c.name} — ${naira(c.amount)}`,
        metadata: { amount: c.amount, facilityId: c.facId },
      }),
    ),
  );
  api.post(
    "/:id/reject",
    ...review,
    handle(
      (req) => claimController.reject(param(req, "id"), req.body, req.user!),
      (_req, c) => ({
        action: "claim.reject",
        entityType: "claim",
        entityId: c.id,
        summary: `Rejected claim ${c.id} for ${c.name}: ${c.reason ?? "no reason given"}`,
        metadata: { reason: c.reason },
      }),
    ),
  );
  api.patch(
    "/:id/investigation/:itemId",
    ...review,
    handle(
      (req) => claimController.setItemAmount(param(req, "id"), param(req, "itemId"), req.body),
      (req, c) => {
        const line = c.investigations.find((i) => i.id === req.params.itemId);
        return {
          action: "claim.edit_line",
          entityType: "claim",
          entityId: c.id,
          summary: `Changed ${line?.name ?? "a line"} on claim ${c.id} to ${naira(line?.amount ?? 0)} (claim total ${naira(c.amount)})`,
          metadata: { itemId: req.params.itemId, amount: line?.amount, claimTotal: c.amount },
        };
      },
    ),
  );
  api.delete(
    "/:id/investigation/:itemId",
    ...review,
    handle(
      (req) => claimController.removeItem(param(req, "id"), param(req, "itemId")),
      (req, c) => ({
        action: "claim.remove_line",
        entityType: "claim",
        entityId: c.id,
        summary: `Cancelled line ${req.params.itemId} on claim ${c.id} (claim total now ${naira(c.amount)})`,
        metadata: { itemId: req.params.itemId, claimTotal: c.amount },
      }),
    ),
  );

  // Payment is recorded by administrators.
  // Proof of payment (receipts, transfer confirmations) can come with it or be added afterwards.
  const payment = [requireScreen("claims"), requireRole("administrator")];
  api.post(
    "/:id/pay",
    ...payment,
    uploadFiles("proofs"),
    handle(
      (req) => claimController.pay(param(req, "id"), req.files as Express.Multer.File[] | undefined, req.user!),
      (_req, c) => {
        const proofs = c.docs.filter((d) => d.kind === "payment-proof").length;
        return {
          action: "claim.pay",
          entityType: "claim",
          entityId: c.id,
          summary: `Recorded payment of claim ${c.id} — ${naira(c.amount)} to the facility${proofs ? `, with ${files(proofs)} as proof of payment` : ""}`,
          metadata: { amount: c.amount, facilityId: c.facId, proofs },
        };
      },
    ),
  );
  api.post(
    "/:id/payment-proof",
    ...payment,
    uploadFiles("proofs"),
    handle(
      (req) => claimController.addPaymentProof(param(req, "id"), req.files as Express.Multer.File[] | undefined, req.user!),
      (req, c) => ({
        action: "claim.proof_add",
        entityType: "claim",
        entityId: c.id,
        summary: `Attached ${files((req.files as unknown[] | undefined)?.length ?? 0)} as proof of payment to claim ${c.id}`,
        metadata: { names: ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => f.originalname) },
      }),
    ),
  );
  api.delete(
    "/:id/document/:docId",
    ...payment,
    handle(
      (req) => claimController.removePaymentProof(param(req, "id"), param(req, "docId")),
      (req, c) => ({
        action: "claim.proof_remove",
        entityType: "claim",
        entityId: c.id,
        summary: `Removed a proof of payment from claim ${c.id}`,
        metadata: { documentId: req.params.docId },
      }),
    ),
  );

  // Uploaded documents are private: streamed only to people allowed to see the claim.
  api.get("/:id/document/:docId", requireScreen("claims", "queue", "facility-portal"), async (req, res, next) => {
    try {
      const { filePath, fileName } = await claimController.documentPath(param(req, "id"), param(req, "docId"), req.user!);
      await recordAudit(req, {
        action: "claim.document_download",
        entityType: "claim",
        entityId: param(req, "id"),
        summary: `Downloaded "${fileName}" from claim ${param(req, "id")}`,
        metadata: { documentId: param(req, "docId") },
      });
      res.download(filePath, fileName);
    } catch (err) {
      next(err);
    }
  });

  return api;
};
