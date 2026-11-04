import { Router } from "express";
import reportController from "../controllers/report.controller";
import { authenticate, requireScreen } from "../middlewares/auth.middleware";
import { recordAudit } from "../utils/audit";
import { handle } from "../utils/http";

export default () => {
  const api = Router();
  api.use(authenticate);

  api.get("/approved-claims", requireScreen("approved-claims"), async (req, res, next) => {
    try {
      if (req.query.format === "csv") {
        const { body, filename } = await reportController.approvedClaimsCsv(req.query);
        await recordAudit(req, {
          action: "report.export",
          entityType: "report",
          summary: `Exported the approved-claims report (${filename})`,
          metadata: { filters: { ...req.query, format: undefined } },
        });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(body);
        return;
      }
      await handle(() => reportController.approvedClaimsReport(req.query))(req, res, next);
    } catch (err) {
      next(err);
    }
  });

  return api;
};
