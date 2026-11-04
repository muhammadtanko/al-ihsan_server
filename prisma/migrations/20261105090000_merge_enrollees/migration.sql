-- Merge website_enrollments into enrollees. One table now holds everyone enrolled,
-- with `source` saying where they came from (KADCHMA | Website).

-- 1. Widen enrollees to hold the website enrollment form.
ALTER TABLE "enrollees"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'KADCHMA',
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "middleName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "enrollmentNumber" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "lga" TEXT,
  ADD COLUMN "dateOfBirth" TEXT,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "maritalStatus" TEXT,
  ADD COLUMN "kinName" TEXT,
  ADD COLUMN "kinRelationship" TEXT,
  ADD COLUMN "kinPhone" TEXT,
  ADD COLUMN "healthPlanId" TEXT,
  ADD COLUMN "facilityId" TEXT,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "amount" INTEGER,
  ADD COLUMN "paymentRef" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "planId" DROP NOT NULL;

-- 2. Copy every website enrollment in. They have paid, and run for one year.
INSERT INTO "enrollees" (
  "id", "source", "name", "firstName", "middleName", "lastName", "kad", "enrollmentNumber", "phone", "email",
  "address", "lga", "dateOfBirth", "gender", "maritalStatus", "kinName", "kinRelationship", "kinPhone",
  "healthPlanId", "facilityId", "status", "enrolledAt", "expiresAt", "paymentMethod", "amount", "paymentRef", "createdAt"
)
SELECT
  w."id", 'Website', concat_ws(' ', w."firstName", w."middleName", w."lastName"), w."firstName", w."middleName", w."lastName",
  w."membershipNumber", w."id", w."phone", w."email", w."address", w."lga", w."dateOfBirth", w."gender", w."maritalStatus",
  w."kinName", w."kinRelationship", w."kinPhone", w."healthPlanId", w."facilityId", 'Active', w."enrolledAt",
  w."enrolledAt" + INTERVAL '1 year', w."paymentMethod", w."amount", w."paymentRef", w."enrolledAt"
FROM "website_enrollments" w;

-- 3. Link payments to the person by id instead of by name.
ALTER TABLE "transactions" ADD COLUMN "enrolleeId" TEXT;
UPDATE "transactions" t SET "enrolleeId" = e."id" FROM "enrollees" e WHERE e."paymentRef" = t."ref";
-- Older premiums were only tied to a name: link those where exactly one enrollee has it.
UPDATE "transactions" t SET "enrolleeId" = e."id"
FROM "enrollees" e
WHERE t."enrolleeId" IS NULL AND t."type" = 'Premium' AND e."name" = t."who"
  AND (SELECT count(*) FROM "enrollees" x WHERE x."name" = t."who") = 1;

-- 4. The old table is no longer needed.
DROP TABLE "website_enrollments";

-- 5. Constraints and indexes.
CREATE UNIQUE INDEX "enrollees_enrollmentNumber_key" ON "enrollees"("enrollmentNumber");
CREATE INDEX "enrollees_source_idx" ON "enrollees"("source");

ALTER TABLE "enrollees" DROP CONSTRAINT "enrollees_planId_fkey";
ALTER TABLE "enrollees" ADD CONSTRAINT "enrollees_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enrollees" ADD CONSTRAINT "enrollees_healthPlanId_fkey" FOREIGN KEY ("healthPlanId") REFERENCES "health_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enrollees" ADD CONSTRAINT "enrollees_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_enrolleeId_fkey" FOREIGN KEY ("enrolleeId") REFERENCES "enrollees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
