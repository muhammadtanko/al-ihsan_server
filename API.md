# AL-IHSAN API reference

Base URL: `http://localhost:4000/api/v1` · JSON in, JSON out (file uploads use `multipart/form-data`).

## Conventions

**Envelope.** Every response is one of

```jsonc
{ "ok": true,  "payLoad": <data> }
{ "ok": false, "message": "what went wrong" }
```

**Status codes.** `200` OK · `201` created · `400` invalid input (the message lists each field, e.g. `contact.email: Enter a valid email address`) · `401` missing/invalid token or a disabled account · `403` signed in but not allowed · `404` not found · `409` conflicts with current state (e.g. already decided, duplicate) · `500` unexpected.

**Authentication.** `POST /auth/login` returns a JWT. Send it on every other request (except `/public/*` and `/health`):

```
Authorization: Bearer <token>
```

**Page access (screens).** Each person has a list of pages they may open: their role's defaults, plus anything an administrator changed in Access Control. Routes below say which page they need ("**page:** `claims`"). Some also need a role ("**role:** administrator"). A page grant alone never unlocks a role-restricted action. The list is re-read from the database on every request, so changes apply immediately.

| Role | Default pages |
| --- | --- |
| `administrator` | all pages |
| `desk-officer` | `requests`, `enrollees` |
| `medical-officer` | `queue`, `claims` |
| `hr-staff` | none |
| `finance-officer` | none |
| `facility` | `requests`, `facility-portal` |

**The `audit` page is administrators-only:** it can't be granted to anyone else (`PUT /access/:userId` answers `400` if you try), and administrators always keep it.

Pages: `dashboard` `requests` `queue` `claims` `enrollees` `facilities` `transactions` `hr` `notifications` `facility-portal` `investigation-prices` `access` `approved-claims` `audit`.

**IDs.** Human-readable strings: users `ST-01` / `FA-01`, facilities `F1`, code requests `CR-1001`, claims `CL-3001`, authorisation codes `000001`, investigations `INV-3-2`, plans `P1`, website enrollments `AIH-2026-482913`.

**Money** is whole naira (integers). **Dates** are ISO-8601 strings.

---

## Health

| | |
| --- | --- |
| `GET /health` | No auth. → `{ "status": "up" }` |

---

## Auth

### `POST /auth/login` — no auth
Body: `{ "email": string, "password": string }` (both required).
→ `{ "token": string, "user": User }` · `401` wrong email/password (same message for both) · `403` account disabled.
Failed and blocked sign-ins are recorded in the audit log.

### `GET /auth/me` — any signed-in user
→ `User`.

**`User`** (returned by login, `/auth/me`, `/user`, `/access`):
```jsonc
{
  "id": "ST-01", "name": "K. Suleiman", "email": "k.suleiman@alihsan.example",
  "role": "administrator",            // administrator | desk-officer | medical-officer | hr-staff | finance-officer | facility
  "title": "Administrator", "dept": "Operations",
  "status": "Active",                 // Active | On leave | Disabled
  "facilityId": null,                 // set on facility accounts
  "accessOverride": null,             // administrator's custom page list, or null = role defaults
  "defaultScreens": ["dashboard", "..."],
  "screens": ["dashboard", "..."]     // what this person can open right now
}
```

---

## Public (no sign-in) — the website's Enroll Now flow

### `GET /public/plans`
→ `[{ id: "individual"|"family", name, price, priceLabel, description, benefits: string[] }]`

### `GET /public/facilities`
→ facilities offered for enrollment: `[Facility]` (see Facilities below).

### `GET /public/payment-account`
The one account everyone pays into for bank transfer. → `{ "bankName": "Zenith Bank", "accountNumber": "12345678908", "accountName": "Alihsan Health Service" }` (configurable with `PAYMENT_*` env vars).

### `POST /public/enrollment`
Body (all fields required unless noted):
```jsonc
{
  "personal": { "firstName": "", "lastName": "", "middleName": "" /* optional */,
                "dateOfBirth": "1990-01-31", "gender": "Male|Female",
                "maritalStatus": "Single|Married|Divorced|Widowed" },
  "contact":  { "email": "valid@email", "phone": "", "address": "", "lga": "" },
  "nextOfKin": { "fullName": "", "relationship": "Spouse|Parent|Sibling|Child|Other", "phone": "" },
  "planId": "individual|family",
  "facilityId": "F7",                 // must be a facility returned by /public/facilities
  "payment": { "method": "card", "cardNumber": "12–19 digits/spaces", "expiryDate": "MM/YY",
               "cvv": "3–4 digits", "cardholderName": "" }
           // or { "method": "transfer" }  — no bank details; everyone pays into the account above
}
```
→ `201` `{ enrollmentNumber, membershipNumber, enrolledAt, fullName, plan, facility }`.
Payment is **simulated** (details are validated, never stored); a confirmed Premium transaction is recorded.

---

## Users, access & facilities

### `GET /user` — **page:** `hr` or `access`
→ `[User]`

### `POST /user` — **page:** `hr`
Body: `{ email, role, password (min 6), name?, dept?, facilityId? }`.
- `name` is required for staff roles; for `facility` it defaults to the facility's name.
- `facilityId` is required when `role` is `facility`, and **a facility can have only one login** (`409` if it already has one, even a disabled one).
- `409` if the email already exists.

→ `201` `User`.

### `GET /user/:id/kpi` — **page:** `hr`
A medical officer's performance, for their info window — `{ codes: ReviewerKpi, claims: ReviewerKpi }` (code requests and claims they decided).
```jsonc
{ "decided": 7, "approved": 4, "rejected": 3, "approvalRate": 57,    // a Paid claim counts as approved
  "underReview": 1, "oldestUnderReviewHours": 5.2,                    // picked up by them, not yet decided
  "turnaround": { "sample": 7, "avgHours": 0.4, "medianHours": 0.1, "fastestHours": 0, "slowestHours": 1.5 },
  "reviewTime": { "sample": 5, "avgHours": 0.2, "medianHours": 0.1, "fastestHours": 0, "slowestHours": 0.6 },
  "within24hRate": 100,                                               // % decided within 24 h of being created
  "last7Days": 4, "last30Days": 4,
  "daily": [{ "date": "2026-11-04", "count": 2 }, "…14 days, oldest first"] }
```
`turnaround` runs from the item being **created** to the decision (it includes time spent waiting in the queue); `reviewTime` from the officer **picking it up** (start review) to the decision, and is only known for items reviewed since start times were recorded. Figures are `null` until there is something to measure. `404` for an unknown user.

### `GET /user/:id/codes` — **page:** `hr`
The approved and rejected authorisation codes tied to one person, for their info window. Every code request is linked to the account that **recorded** it and the account that **decided** it.
```jsonc
{ "requested": { "stats": CodeStats, "items": [CodeSummary] },   // requests they recorded (desk officer, facility account)
  "decided":   { "stats": CodeStats, "items": [CodeSummary] } }  // requests they approved or rejected (medical officer)
```
`404` for an unknown user.

**`CodeStats`**: `{ total, pending, underReview, approved, rejected, decided, approvalRate, rejectionRate }`. The rates are whole percentages of the **decided** requests (`approvalRate + rejectionRate = 100`) and are `null` until something has been decided.
**`CodeSummary`** (approved and rejected requests only, newest decision first, up to 200): `{ id, name, kad, dx, proc, status: "Approved"|"Rejected", code, reason, refId, refName, recvId, recvName, createdBy, createdById, createdAt, reviewedBy, reviewedById, reviewedAt }`.

### `PATCH /user/:id/status` — **page:** `hr`
Body: `{ "status": "Active" | "On leave" | "Disabled" }`.
A disabled user can't sign in and their open session ends on its next request. You can't disable yourself (`400`); only an administrator can change an administrator (`403`). → `User`.

### `PUT /access/:userId` — **page:** `access`
Body: `{ "screens": ScreenId[] }` — the pages this person should have. Stored only if it differs from the role default. Administrators always keep `access` and `audit`; `audit` can't be given to anyone else (`400`). → `User`.

### `DELETE /access/:userId` — **page:** `access`
Resets one person to their role's defaults. → `User`.

### `POST /access/reset-all` — **page:** `access`
No body. → `[User]` (everyone, reset).

### `GET /facility` — any signed-in user
→ `[Facility]`:
```jsonc
{ "id": "F1", "code": "FAC-0113", "name": "", "tier": "Primary|Secondary|Tertiary", "lga": "", "phone": "",
  "services": "", "status": "Accredited|Pending|Suspended", "address": null, "ward": null,
  "primaryCare": true, "secondaryCare": false }
```

### `GET /facility/:id/codes` — **page:** `facilities`
The approved and rejected codes tied to a facility, with the share of each, for its info window.
```jsonc
{ "requested": { "stats": CodeStats, "items": [CodeSummary] },   // codes this facility asked for (it is the referring facility)
  "received":  { "stats": CodeStats, "items": [CodeSummary] } }  // codes issued for patients it is receiving
```
`stats.approvalRate` / `rejectionRate` are the percentages of its decided requests that were approved or rejected. `404` for an unknown facility.

### `POST /facility` — **page:** `facilities`
Body: `{ name (required), code?, tier? = "Primary", lga?, phone? }`. Created as `Pending`. → `201` `Facility`.

---

## Reference data

| | |
| --- | --- |
| `GET /plan` | any signed-in user. → `[{ id, partner, name, premium, items: [[benefitName, tariff], …] }]` (KADCHMA plans) |
| `GET /diagnosis` | any signed-in user. → `[{ id, name, category }]` (sample diagnoses for the code-request form) |
| `GET /investigation` | any signed-in user. → `[{ id, category, service, baseline, approved }]` (the KADCHMA price list) |

### `PUT /investigation/:id` — **page:** `investigation-prices`
Body (at least one): `{ service?, category?, baseline? (int ≥ 0), approved? (int > 0) }`. → `Investigation`.

---

## Enrollees

### `GET /enrollee` — **page:** `enrollees`
Everyone enrolled, **one list**, newest first. Query: `source=KADCHMA|Website` (optional) to narrow it.

`source` says where each person came from: **KADCHMA** (on the KADCHMA register; the number is administered outside the system and captured as entered) or **Website** (signed up through Enroll Now; we issue the numbers and take payment). Fields a source doesn't collect are `null`.

```jsonc
[{ "id": "E1",                       // KADCHMA: E1…  ·  Website: the enrollment number
   "source": "KADCHMA",              // KADCHMA | Website
   "name": "Hauwa Ibrahim", "firstName": null, "middleName": null, "lastName": null,
   "kad": "KAD-104-2271",            // the enrollee number: their KADCHMA number, or the number issued to a website sign-up
   "enrollmentNumber": null,         // AIH-2026-482913 for website sign-ups
   "phone": "", "email": null, "address": null, "lga": null,
   "dateOfBirth": null, "gender": null, "maritalStatus": null,
   "kinName": null, "kinRelationship": null, "kinPhone": null,
   "planId": "P1", "healthPlanId": null,                    // a KADCHMA plan, or a website plan
   "planName": "Formal Sector Standard", "planPartner": "KADCHMA State Scheme", "planPrice": "₦12,000 / yr",
   "facilityId": null, "facilityName": null, "facilityAddress": null,   // primary facility (website)
   "status": "Active",               // Pending Payment | Active | Expiring | Expired — see below
   "enrolledAt": "", "expiresAt": "",
   "paymentMethod": null, "amount": null, "paymentRef": null,           // website sign-ups
   "createdAt": "",
   "transactions": [Transaction] }]   // this person's payments
```

**Status** follows the expiry date for everyone: past it = `Expired`, within 30 days = `Expiring`, otherwise `Active`. `Pending Payment` is stored (the policy hasn't started). Payments are linked to the enrollee by id; older or manual entries that name the person (and no one else) are included too.

### `GET /enrollee/verify/:kad` — **page:** `enrollees`, `requests` or `facility-portal`
Is this **enrollee number** on file here (not case-sensitive)? Used by the code-request and claim forms, which fill in the person's details when it matches.
→ `{ "kad": "KAD-104-2271", "verified": true, "enrollee": { "kad", "name", "phone", "planId", "planName", "status" } | null }`.
`planId` is their KADCHMA plan, when they hold one.

---

## Code requests (pre-authorisation)

Status flow: `Pending → Under Review → Approved | Rejected`.

**`CodeRequest`**:
```jsonc
{ "id": "CR-1001", "name": "", "kad": "", "phone": "", "dx": "", "proc": "", "planId": "P1",
  "refId": "F3", "recvId": "F1", "status": "Pending", "code": null, "reason": null,
  "createdBy": "S. Bello (Desk Officer)", "createdAt": "", "reviewedBy": null, "reviewedAt": null,
  "sent": "Not sent",            // Not sent | Sent — manual
  "verified": true }             // the enrollee number matches a known enrollee
```

### `GET /request` — **page:** `requests`, `queue` or `dashboard`
→ `[CodeRequest]`, newest first. **Facility accounts only see requests their facility sent or is receiving.**

### `GET /request/codes` — **page:** `facility-portal`
For facility accounts: approved codes where this facility is the receiving one (what can be linked to a claim). → `[{ id, code, name, kad, dx, proc }]` (empty for other roles).

### `POST /request` — **page:** `requests` · **role:** administrator, desk-officer or facility
Body: `{ name, kad, dx, proc, planId, refId, recvId (all required), phone? }`.
Facility accounts always request as their own facility (`refId` is overridden) and can't choose themselves as `recvId` (`400`). → `201` `CodeRequest` (status `Pending`).

### `POST /request/:id/start-review` — **page:** `queue` · **role:** administrator or medical-officer
No body. Only from `Pending` (`409` otherwise). → `CodeRequest`.

### `POST /request/:id/approve` — same access
No body. Only from `Under Review`. Allocates the next 6-digit authorisation code. → `CodeRequest` with `code`.

### `POST /request/:id/reject` — same access
Body: `{ "reason"?: string }` (a default reason is used if blank). Only from `Under Review`. → `CodeRequest`.

### `POST /request/:id/sent` — **page:** `requests` or `queue` · **role:** administrator, desk-officer or medical-officer
No body. Records that the decision was relayed to the facility (manual WhatsApp channel) and logs a delivery. `409` if there is no decision yet or it was already marked. → `CodeRequest`.

---

## Claims

Status flow: `Submitted → Under Review → Approved | Rejected`, then `Approved → Paid`.

**`Claim`**:
```jsonc
{ "id": "CL-3001", "name": "", "kad": "", "facId": "F1", "dx": "service names", "amount": 5500,
  "linked": "CR-1003 / 000002",          // or "—"
  "status": "Submitted", "reason": null, "submittedBy": "", "date": "", "reviewedBy": null, "reviewedAt": null,
  "docs": [{ "id": "uuid", "file": "bill.pdf", "size": "2 KB", "kind": "supporting|payment-proof",
             "uploadedBy": null, "uploadedAt": "", "downloadable": true }],
  "investigations": [{ "id": "CL-3001-INV-1", "investigationId": "INV-7-1", "name": "", "amount": 2625 }],
  "verified": true, "planId": "P1" }     // enrollee match and the KADCHMA plan they hold (or null)
```

### `GET /claim` — **page:** `claims`, `queue`, `dashboard` or `facility-portal`
→ `[Claim]`, newest first. Facility accounts only see their own facility's claims.

### `POST /claim` — **page:** `facility-portal` · **role:** facility
JSON or `multipart/form-data`:

| field | |
| --- | --- |
| `name`, `kad` | required |
| `investigations` | required, at least one: `[{ "investigationId": "INV-7-1", "amount"?: int > 0 }]` (JSON string when multipart). Amount defaults to the KADCHMA approved price |
| `linked` | optional authorisation code (e.g. `"000466"`); must be an approved code for this facility (`400` otherwise) |
| `document` | optional file (PDF / PNG / JPG / WebP, ≤ 10 MB) |

→ `201` `Claim`.

### `POST /claim/:id/start-review` · `POST /claim/:id/approve` — **page:** `queue` · **role:** administrator or medical-officer
No body. `start-review` only from `Submitted`; `approve` only from `Under Review` (`409` otherwise). → `Claim`.

### `POST /claim/:id/reject` — same access
Body: `{ "reason"?: string }`. Only from `Under Review` (`409` otherwise). → `Claim`.

### `PATCH /claim/:id/investigation/:itemId` — same access
Body: `{ "amount": int > 0 }`. Only while `Submitted`/`Under Review`; the claim total follows. → `Claim`.

### `DELETE /claim/:id/investigation/:itemId` — same access
Cancels a line (a claim must keep at least one). → `Claim`.

### `POST /claim/:id/pay` — **page:** `claims` · **role:** administrator
Only from `Approved`. Records a Facility payment transaction. JSON `{}` or `multipart/form-data` with optional **`proofs`** files (up to 5; PDF/image, ≤ 10 MB each) as proof of payment. → `Claim` (`Paid`).

### `POST /claim/:id/payment-proof` — same access
`multipart/form-data` with **`proofs`** files (at least one). Only on a `Paid` claim. → `201` `Claim`.

### `DELETE /claim/:id/document/:docId` — same access
Removes a **payment proof** (the claim's own supporting documents can't be removed, `403`). → `Claim`.

### `GET /claim/:id/document/:docId` — **page:** `claims`, `queue` or `facility-portal`
Downloads the file (needs the token, so fetch it with the header rather than a plain link). Facility accounts can only open their own claims' files. Each download is audited.

---

## Transactions, notifications, dashboard, reports

### `GET /transaction` — **page:** `transactions`
→ `[{ ref, who, type /* Premium|Premium refund|Facility payment */, amount, status /* Pending|Confirmed|Failed */, date }]`

### `POST /transaction` — **page:** `transactions`
Body: `{ who (required), amount (int > 0), type: "Premium"|"Premium refund"|"Facility payment" }`. Recorded as `Confirmed`. → `201` `Transaction`.

### `GET /notification/templates` — **page:** `notifications`
→ `[{ name, ch /* Email|WhatsApp */, event, body }]`

### `GET /notification/deliveries` — **page:** `notifications`
→ `[{ time, to, ch, tmpl, status /* Delivered|Sent|Sent — manual|Queued|Failed */ }]`

### `GET /analytics/reviewers` — **page:** `dashboard`
Every medical officer (and anyone else who has decided something), side by side. → `[{ id, name, role, status, title, codes: ReviewerKpi, claims: ReviewerKpi }]` — same figures as `GET /user/:id/kpi`.

### `GET /analytics/dashboard` — **page:** `dashboard`
```jsonc
{ "enrollees": { total, active, expired, pendingPayment, viaWebsite, newLast30Days, expiringWithinDays,
                 "expiring": [{ name, ref, expiresAt, source: "KADCHMA|Website" }], "byPlan": [{ plan, count }] },
  "review":   { queueSize, pendingRequests, pendingClaims, claimsPipeline },
  "codes":    { approved, rejected, approvalRate } }
```

### `GET /report/approved-claims` — **page:** `approved-claims`
Approved **and** paid claims with totals. Query (all optional): `from`, `to` (ISO; filters the **approval** date, `to` exclusive), `facilityId`, `format=csv`.
```jsonc
{ "rows": [{ id, name, kad, facilityId, facilityName, facilityCode, services, amount, linked,
             status /* Approved|Paid */, approvedBy, approvedAt, submittedAt, paymentProofs }],
  "totals": { count, amount, paidAmount, awaitingPaymentAmount,
              "byFacility": [{ facilityId, facilityName, count, amount }] } }
```
`format=csv` returns a spreadsheet-friendly file (UTF-8 with BOM) of the same filtered rows plus a totals block. `400` if `from` ≥ `to`, `404` for an unknown facility.

---

## Audit log

Every successful action is recorded (who, what, which record, a readable summary, time, IP), plus failed/blocked sign-ins, document downloads and exports. Request bodies are never stored, so passwords and card numbers can't appear. The log is append-only: there is no way to edit or delete entries.

**`AuditEntry`**:
```jsonc
{ "id": 1, "at": "2026-11-04T12:56:00.000Z",
  "actorId": "ST-02", "actorName": "Dr. M. Hassan", "actorRole": "medical-officer",   // actorId null for the public website / unknown sign-ins
  "action": "claim.approve", "entityType": "claim", "entityId": "CL-3001",
  "summary": "Approved claim CL-3001 for abba — ₦5,500", "metadata": { "amount": 5500 }, "ip": "::1" }
```

Recorded actions: `auth.login` `auth.login_failed` `auth.login_blocked` · `user.register` `user.disable` `user.enable` `user.status` · `access.set` `access.reset` `access.reset_all` · `facility.add` · `investigation.update` · `transaction.record` · `request.create` `request.start_review` `request.approve` `request.reject` `request.mark_sent` · `claim.create` `claim.start_review` `claim.approve` `claim.reject` `claim.edit_line` `claim.remove_line` `claim.pay` `claim.proof_add` `claim.proof_remove` `claim.document_download` · `enrollment.create` · `report.export` `audit.export`.

### `GET /audit` — **page:** `audit` · **role:** administrator
Query (all optional): `from` (inclusive) · `to` (exclusive) · `actorId` · `entityType` (area: `auth` `user` `access` `facility` `investigation` `transaction` `request` `claim` `enrollment` `report` `audit`) · `action` (exact) · `entityId` · `q` (text in summary / record / person / action) · `page` (default 1) · `pageSize` (default 50, max 200) · `format=csv`.
→ `{ rows: [AuditEntry], total, page, pageSize, pages }`, newest first. `format=csv` exports the matching entries (newest 10,000) and records the export itself.

### `GET /audit/options` — **page:** `audit` · **role:** administrator
What the filter dropdowns offer. → `{ actors: [{ id, name }], actions: string[], entityTypes: string[] }`
