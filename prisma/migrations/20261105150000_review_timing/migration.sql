-- Reviewer performance: record when review started, and link claims to the account that decided them.
ALTER TABLE "code_requests" ADD COLUMN "reviewStartedAt" TIMESTAMP(3);
ALTER TABLE "claims" ADD COLUMN "reviewedById" TEXT, ADD COLUMN "reviewStartedAt" TIMESTAMP(3);

-- Claims named their reviewer by text only: link where exactly one account has that name.
UPDATE "claims" c SET "reviewedById" = u."id"
FROM "users" u
WHERE c."reviewedBy" = u."name"
  AND (SELECT count(*) FROM "users" x WHERE x."name" = c."reviewedBy") = 1;

CREATE INDEX "claims_reviewedById_idx" ON "claims"("reviewedById");
ALTER TABLE "claims" ADD CONSTRAINT "claims_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
