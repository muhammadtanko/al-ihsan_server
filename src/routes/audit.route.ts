import { Router } from "express";
import auditController from "../controllers/audit.controller";
import { authenticate, requireRole, requireScreen } from "../middlewares/auth.middleware";
import { handle } from "../utils/http";
import { recordAudit } from "../utils/audit";

export default () => {
  const api = Router();
  // Administrators only — the page can't be granted to anyone else, and the role is checked too.
  api.use(authenticate, requireScreen("audit"), requireRole("administrator"));

  api.get("/options", handle(() => auditController.options()));

  // Search the trail (JSON), or `format=csv` to export what the filters match.
  api.get("/", async (req, res, next) => {
    try {
      if (req.query.format === "csv") {
        const { body, filename, count } = await auditController.csv(req.query);
        await recordAudit(req, {
          action: "audit.export",
          entityType: "audit",
          summary: `Exported ${count} audit log ${count === 1 ? "entry" : "entries"} as CSV`,
          metadata: { filters: { ...req.query, format: undefined } },
        });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(body);
        return;
      }
      await handle(() => auditController.list(req.query))(req, res, next);
    } catch (err) {
      next(err);
    }
  });

  return api;
};
