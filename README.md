# AL-IHSAN API

REST API behind the public enrollment website and the staff **TPA Operations Console**.

Node 22 · Express 5 · TypeScript · Prisma 6 · PostgreSQL 16 · zod · JWT

```
src/
  config.ts          environment → typed config
  connections/       Prisma client
  controllers/       business logic (class instances returning ok()/created())
  routes/            one router factory per resource
  middlewares/       auth (JWT + page access), uploads, error handling
  models/            zod request schemas
  utils/             errors, ids, access rules, DTO mappers
  tests/             end-to-end API tests (node:test)
prisma/
  schema.prisma      data model
  seed.ts            demo data (facilities, plans, enrollees, claims, users …)
```

## Run it

```bash
cp .env.example .env            # defaults work with the docker-compose Postgres
docker compose up -d postgres   # from the repo root
npm install
npx prisma migrate deploy       # create tables
npm run db:seed                 # load demo data (wipes the database!)
npm run dev                     # http://localhost:4000
```

Or run everything with Docker from the repo root: `docker compose up --build`
(the backend image applies migrations on start). The production image has no
seed tooling, so load the demo data once from your machine against the
compose database: `npm run db:seed` with the default `DATABASE_URL`.

### Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_PORT` | `4000` | |
| `NODE_ENV` | `development` | `production` disables request logging |
| `DATABASE_URL` | – | PostgreSQL connection string |
| `JWT_KEY` | – | signing secret for sessions — change it |
| `JWT_EXPIRES_IN` | `8h` | |
| `CORS_ORIGINS` | `http://localhost:5173` | comma separated |
| `UPLOAD_DIR` | `uploads` | claim documents are stored here (a docker volume in compose) |
| `SEED_PASSWORD` | `Console123!` | password given to every seeded account |
| `PAYMENT_BANK_NAME`, `PAYMENT_ACCOUNT_NUMBER`, `PAYMENT_ACCOUNT_NAME` | Zenith Bank, 12345678908, Alihsan Health Service | the one account bank-transfer enrollments pay into |

### Demo accounts

All use the password in `SEED_PASSWORD`.

| Email | Role |
| --- | --- |
| `k.suleiman@alihsan.example` | Administrator (all pages) |
| `m.hassan@alihsan.example` | Medical officer |
| `s.bello@alihsan.example` | Desk officer |
| `f.adamu@alihsan.example` | HR staff |
| `portal@alihsan.example` | Facility account (Ummah Mamuda Memorial Hospital) |

> **Full reference with request and response payloads for every endpoint: [API.md](API.md).**

## Conventions

* Base path `/api/v1`. Success: `{ "ok": true, "payLoad": … }`. Failure:
  `{ "ok": false, "message": "…" }` with a 400/401/403/404/409 status.
* Authenticated routes take `Authorization: Bearer <token>` from `POST /auth/login`.
* **Page access is enforced on the server.** Each role has default pages; an
  administrator can grant or remove pages per person (`/access`). Routes check
  the caller's pages (and, for state changes, role) on every request, reloaded
  from the database, so changes take effect immediately. Administrators always
  keep the `access` page.

## Endpoints

Public (no token)

| | |
| --- | --- |
| `GET /public/plans` | website health plans |
| `GET /public/payment-account` | the account bank-transfer payers are told to pay into |
| `GET /public/facilities` | facilities listed for enrollment |
| `POST /public/enrollment` | submit an enrollment (payment is simulated, no card data stored) |

Auth / people

| | page |
| --- | --- |
| `POST /auth/login`, `GET /auth/me` | – |
| `GET /user` | `hr` or `access` |
| `POST /user` | `hr` — register a staff or facility account. A facility can have only one login (409 if it already has one, even a disabled one). |
| `GET /user/:id/kpi` | `hr` — a medical officer's decisions, approval rate and turnaround/review times |
| `GET /user/:id/codes` | `hr` — the approved and rejected codes tied to a person (requested / decided), with counts and percentages |
| `PATCH /user/:id/status` | `hr` — set a user `Active`, `On leave` or `Disabled`. A disabled user can't sign in and their open session ends on its next request. You can't disable yourself, and only an administrator can change an administrator. |
| `PUT /access/:userId`, `DELETE /access/:userId`, `POST /access/reset-all` | `access` |

Operations

| | page / role |
| --- | --- |
| `GET /facility`, `GET /plan`, `GET /investigation`, `GET /diagnosis` | any signed-in user |
| `POST /facility` | `facilities` |
| `GET /facility/:id/codes` | `facilities` — the approved and rejected codes tied to a facility (requested / received), with approval and rejection percentages |
| `PUT /investigation/:id` | `investigation-prices` — edit the approved price |
| `GET /enrollee` | `enrollees` — everyone enrolled in one list; each has a `source` (KADCHMA or Website) and their payments. `?source=` filters. |
| `GET /enrollee/verify/:kad` | `enrollees` or `requests` — is this enrollee number on file? Returns their name/plan to autofill forms. |
| `GET /request` | `requests`, `queue` or `dashboard` (each row says whether its enrollee is `verified`) |
| `POST /request` | `requests`; desk officer / administrator |
| `POST /request/:id/start-review`, `/approve`, `/reject` | `queue`; medical officer / administrator |
| `POST /request/:id/sent` | `requests` or `queue` — marks the code as sent manually |
| `GET /claim` | `claims`, `queue`, `dashboard` or `facility-portal` (facility accounts see only their own) |
| `POST /claim` | multipart, `facility-portal`; facility accounts |
| `POST /claim/:id/start-review`, `/approve`, `/reject` | `queue`; medical officer / administrator |
| `PATCH /claim/:id/investigation/:itemId`, `DELETE …` | `queue`; edit or cancel a line while in review |
| `POST /claim/:id/pay` | `claims`; administrator — optionally multipart with up to 5 `proofs` files (PDF/image, 10 MB each) as proof of payment |
| `POST /claim/:id/payment-proof` | `claims`; administrator — attach more proof to an already-paid claim |
| `DELETE /claim/:id/document/:docId` | `claims`; administrator — remove a proof of payment (supporting documents can't be removed) |
| `GET /claim/:id/document/:docId` | authenticated download of an uploaded document |
| `GET /transaction`, `POST /transaction` | `transactions` |
| `GET /notification/templates`, `/deliveries` | `notifications` |
| `GET /analytics/dashboard` | `dashboard` |
| `GET /audit`, `GET /audit/options` | `audit` (administrators only, can't be granted to anyone else) — the audit trail: who did what, with filters (`from`, `to`, `actorId`, `entityType`, `action`, `entityId`, `q`), paging, and `format=csv` |
| `GET /analytics/reviewers` | `dashboard` — every medical officer's KPIs side by side |
| `GET /report/approved-claims` | `approved-claims` — approved + paid claims with totals; filter by `from`/`to` (approval date, `to` exclusive) and `facilityId`; add `format=csv` to export |

## Tests

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/al_ihsan_test?schema=public" npm test
```

`npm test` migrates and **re-seeds** the database it points at, so it only runs
against a database whose name ends in `_test`; it refuses anything else.
