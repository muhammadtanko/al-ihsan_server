-- Link every code request to the account that created it and the account that decided it.
ALTER TABLE "code_requests" ADD COLUMN "createdById" TEXT, ADD COLUMN "reviewedById" TEXT;

-- Backfill from the names already on the rows. Requests recorded as "<name> (<title>)".
UPDATE "code_requests" c SET "createdById" = u."id"
FROM "users" u
WHERE c."createdBy" = u."name" || ' (' || u."title" || ')'
  AND (SELECT count(*) FROM "users" x WHERE x."name" || ' (' || x."title" || ')' = c."createdBy") = 1;

-- Reviewers were stored by name only: link where exactly one account has that name.
UPDATE "code_requests" c SET "reviewedById" = u."id"
FROM "users" u
WHERE c."reviewedBy" = u."name"
  AND (SELECT count(*) FROM "users" x WHERE x."name" = c."reviewedBy") = 1;

CREATE INDEX "code_requests_createdById_idx" ON "code_requests"("createdById");
CREATE INDEX "code_requests_reviewedById_idx" ON "code_requests"("reviewedById");

ALTER TABLE "code_requests" ADD CONSTRAINT "code_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "code_requests" ADD CONSTRAINT "code_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
