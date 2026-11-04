-- A facility can have at most one login. Staff accounts have no facility (NULL), which a unique index allows many times.
CREATE UNIQUE INDEX "users_facilityId_key" ON "users"("facilityId");
