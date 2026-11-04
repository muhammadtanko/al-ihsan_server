// End-to-end API test: walks every flow the console and the public site use.
//
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/al_ihsan_test?schema=public npm test
//
// `npm test` re-seeds first and refuses to run unless DATABASE_URL names a
// database ending in _test, because the tests create records.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../app";
import { connectDb, disconnectDb } from "../connections/prisma.conn";
import { computeKpi } from "../utils/reviewer-kpi";

const PASSWORD = process.env.SEED_PASSWORD ?? "Console123!";
let base = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

interface Res<T = any> {
  status: number;
  body: { ok: boolean; payLoad?: T; message?: string };
}

async function call<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: RequestInit["body"];
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${base}/api/v1${path}`, { method, headers, body });
  return { status: res.status, body: (await res.json()) as Res<T>["body"] };
}

async function login(email: string, password = PASSWORD) {
  const res = await call<{ token: string; user: any }>("POST", "/auth/login", { body: { email, password } });
  assert.equal(res.status, 200, `login ${email}: ${res.body.message}`);
  return { token: res.body.payLoad!.token, user: res.body.payLoad!.user };
}

const validEnrollment = (overrides: Record<string, unknown> = {}) => ({
  personal: { firstName: "Test", lastName: "Person", middleName: "", dateOfBirth: "1990-01-01", gender: "Female", maritalStatus: "Single" },
  contact: { email: "test.person@example.com", phone: "08030000000", address: "1 Test Road", lga: "Zaria" },
  nextOfKin: { fullName: "Next Kin", relationship: "Parent", phone: "08031111111" },
  planId: "family",
  facilityId: "F7",
  payment: { method: "card", cardNumber: "4111111111111111", expiryDate: "12/28", cvv: "123", cardholderName: "Test Person" },
  ...overrides,
});

before(async () => {
  if (!/_test(\?|$)/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to run: DATABASE_URL must name a database ending in _test");
  }
  await connectDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await disconnectDb();
});

describe("authentication", () => {
  it("rejects a wrong password and unknown email with the same message", async () => {
    const a = await call("POST", "/auth/login", { body: { email: "k.suleiman@alihsan.example", password: "nope" } });
    const b = await call("POST", "/auth/login", { body: { email: "ghost@alihsan.example", password: "nope" } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.message, b.body.message);
  });

  it("logs in, returns effective screens and never the password hash", async () => {
    const { token, user } = await login("S.Bello@alihsan.example"); // email is case-insensitive
    assert.deepEqual(user.screens, ["requests", "enrollees"]);
    assert.equal("passwordHash" in user, false);
    const me = await call("GET", "/auth/me", { token });
    assert.equal(me.body.payLoad.id, "ST-04");
  });

  it("requires a valid token on protected routes", async () => {
    assert.equal((await call("GET", "/facility")).status, 401);
    assert.equal((await call("GET", "/facility", { token: "garbage" })).status, 401);
  });
});

describe("public enrollment", () => {
  it("lists plans and enrollment facilities without logging in", async () => {
    const plans = await call("GET", "/public/plans");
    assert.deepEqual(plans.body.payLoad.map((p: any) => p.id), ["individual", "family"]);
    const facilities = await call("GET", "/public/facilities");
    assert.equal(facilities.body.payLoad.length, 12);
    assert.ok(facilities.body.payLoad.every((f: any) => f.ward && f.address));
  });

  it("enrolls someone, generates numbers, and records a premium transaction", async () => {
    const res = await call("POST", "/public/enrollment", { body: validEnrollment() });
    assert.equal(res.status, 201);
    const p = res.body.payLoad;
    assert.match(p.enrollmentNumber, /^AIH-\d{4}-\d{6}$/);
    assert.match(p.membershipNumber, /^KAD-\d{3}-\d{4}$/);
    assert.equal(p.plan.price, 57990);

    const admin = await login("k.suleiman@alihsan.example");
    const enrollees = await call("GET", "/enrollee", { token: admin.token });
    assert.ok(enrollees.body.payLoad.some((w: any) => w.source === "Website" && w.enrollmentNumber === p.enrollmentNumber && w.name === "Test Person"));
    const txns = await call("GET", "/transaction", { token: admin.token });
    assert.ok(txns.body.payLoad.some((t: any) => t.who === "Test Person" && t.amount === 57990 && t.type === "Premium"));
    const mine = enrollees.body.payLoad.find((w: any) => w.enrollmentNumber === p.enrollmentNumber);
    assert.equal(mine.kad, p.membershipNumber);
    assert.equal(mine.status, "Active");
    assert.equal(mine.planName, "Family Plan");
    assert.equal(mine.transactions[0].amount, 57990); // each person's payments ride along on /enrollee
    assert.equal(mine.dateOfBirth, "1990-01-01"); // the full form is available to staff
    assert.equal(mine.kinName, "Next Kin");
    assert.equal(mine.paymentMethod, "card");
    assert.equal(mine.amount, 57990);
    assert.ok(!JSON.stringify(mine).includes("4111")); // never any card data
    const hauwa = enrollees.body.payLoad.find((e: any) => e.source === "KADCHMA" && e.name === "Hauwa Ibrahim");
    assert.deepEqual(hauwa.transactions.map((t: any) => t.ref), ["PSK-87990"]);
  });

  it("keeps one enrollees table: both sources side by side, filterable, with status following the expiry date", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const all = (await call("GET", "/enrollee", { token: admin.token })).body.payLoad;
    assert.ok(all.some((e: any) => e.source === "KADCHMA") && all.some((e: any) => e.source === "Website"));
    assert.ok(all.every((e: any) => ["KADCHMA", "Website"].includes(e.source)));

    const kad = (await call("GET", "/enrollee?source=KADCHMA", { token: admin.token })).body.payLoad;
    assert.ok(kad.length >= 8 && kad.every((e: any) => e.source === "KADCHMA"));
    const web = (await call("GET", "/enrollee?source=Website", { token: admin.token })).body.payLoad;
    assert.ok(web.length >= 1 && web.every((e: any) => e.source === "Website" && e.enrollmentNumber && e.dateOfBirth));
    assert.equal(kad.length + web.length, all.length);
    assert.equal((await call("GET", "/enrollee?source=Nope", { token: admin.token })).status, 400);

    const byName = (n: string) => all.find((e: any) => e.name === n);
    assert.equal(byName("Amina Sadiq").status, "Expiring"); // expires within 30 days
    assert.equal(byName("Grace Danjuma").status, "Expired"); // past its expiry date
    assert.equal(byName("Zainab Lawal").status, "Pending Payment");
    assert.equal(byName("Hauwa Ibrahim").status, "Active");
    assert.equal(byName("Hauwa Ibrahim").planName, "Formal Sector Standard");
    assert.equal(byName("Hauwa Ibrahim").address, null); // KADCHMA entries carry only a few details
  });

  it("links payments to the enrollee by id, so two people with the same name never share them", async () => {
    const res = await call("POST", "/public/enrollment", {
      body: validEnrollment({
        personal: { firstName: "Hauwa", lastName: "Ibrahim", middleName: "", dateOfBirth: "1991-02-02", gender: "Female", maritalStatus: "Single" },
        contact: { email: "hauwa.web@example.com", phone: "08032222222", address: "9 Test Road", lga: "Zaria" },
        planId: "individual",
        payment: { method: "transfer" },
      }),
    });
    assert.equal(res.status, 201);
    const admin = await login("k.suleiman@alihsan.example");
    const all = (await call("GET", "/enrollee", { token: admin.token })).body.payLoad;
    const web = all.find((e: any) => e.enrollmentNumber === res.body.payLoad.enrollmentNumber);
    const kadchma = all.find((e: any) => e.source === "KADCHMA" && e.name === "Hauwa Ibrahim");
    assert.equal(web.transactions.length, 1);
    assert.equal(web.transactions[0].amount, 10650);
    assert.equal(web.paymentMethod, "transfer");
    assert.deepEqual(kadchma.transactions.map((t: any) => t.ref), ["PSK-87990"]); // not the website Hauwa's payment
    // a website member's membership number verifies requests and claims
    assert.equal((await call("GET", `/enrollee/verify/${res.body.payLoad.membershipNumber}`, { token: admin.token })).body.payLoad.verified, true);
  });

  it("validates the payload and never stores card data", async () => {
    const bad = await call("POST", "/public/enrollment", {
      body: validEnrollment({ payment: { method: "card", cardNumber: "1", expiryDate: "13/99", cvv: "1", cardholderName: "" } }),
    });
    assert.equal(bad.status, 400);
    const noFacility = await call("POST", "/public/enrollment", { body: validEnrollment({ facilityId: "F1" }) });
    assert.equal(noFacility.status, 400); // F1 isn't offered for enrollment
  });

  it("serves the single bank-transfer account, and a transfer enrollment needs no bank details", async () => {
    const account = await call("GET", "/public/payment-account");
    assert.equal(account.status, 200);
    assert.deepEqual(account.body.payLoad, { bankName: "Zenith Bank", accountNumber: "12345678908", accountName: "Alihsan Health Service" });

    const res = await call("POST", "/public/enrollment", {
      body: validEnrollment({ contact: { email: "transfer.person@example.com", phone: "08030000001", address: "2 Test Road", lga: "Zaria" }, payment: { method: "transfer" } }),
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.payLoad.enrollmentNumber);
  });
});

describe("page access is enforced per person", () => {
  it("blocks pages a person hasn't been given", async () => {
    const desk = await login("s.bello@alihsan.example");
    assert.equal((await call("GET", "/claim", { token: desk.token })).status, 403);
    assert.equal((await call("GET", "/analytics/dashboard", { token: desk.token })).status, 403);
    assert.equal((await call("GET", "/transaction", { token: desk.token })).status, 403);
    assert.equal((await call("GET", "/request", { token: desk.token })).status, 200);
  });

  it("an administrator can grant and revoke pages, taking effect immediately", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const desk = await login("s.bello@alihsan.example");

    const grant = await call("PUT", "/access/ST-04", { token: admin.token, body: { screens: ["requests", "enrollees", "claims"] } });
    assert.deepEqual(grant.body.payLoad.screens, ["requests", "claims", "enrollees"]);
    assert.equal((await call("GET", "/claim", { token: desk.token })).status, 200); // same token, new access

    // pages granted outside the role don't unlock role-gated actions
    assert.equal((await call("POST", "/claim/CL-3004/pay", { token: desk.token })).status, 403);

    const reset = await call("DELETE", "/access/ST-04", { token: admin.token });
    assert.equal(reset.body.payLoad.accessOverride, null);
    assert.equal((await call("GET", "/claim", { token: desk.token })).status, 403);
  });

  it("only people with Access Control can edit access, and admins can't lock themselves out", async () => {
    const desk = await login("s.bello@alihsan.example");
    assert.equal((await call("PUT", "/access/ST-04", { token: desk.token, body: { screens: [] } })).status, 403);

    const admin = await login("k.suleiman@alihsan.example");
    const res = await call("PUT", "/access/ST-01", { token: admin.token, body: { screens: [] } });
    assert.deepEqual(res.body.payLoad.screens, ["access", "audit"]); // an administrator always keeps these two
    await call("DELETE", "/access/ST-01", { token: admin.token });
  });
});

describe("registering users from HR / Staff", () => {
  it("registers a staff member who can log in with the role's default pages", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const res = await call("POST", "/user", {
      token: admin.token,
      body: { name: "A. Musa", email: "a.musa@alihsan.example", role: "medical-officer", password: "Secret123" },
    });
    assert.equal(res.status, 201);
    assert.match(res.body.payLoad.id, /^ST-\d+$/);
    const { user } = await login("a.musa@alihsan.example", "Secret123");
    assert.deepEqual(user.screens, ["queue", "claims"]);
  });

  it("rejects a duplicate email and a facility account without a facility", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const dup = await call("POST", "/user", { token: admin.token, body: { name: "X", email: "A.MUSA@alihsan.example", role: "desk-officer", password: "Secret123" } });
    assert.equal(dup.status, 409);
    // a facility that already has a login cannot get a second one (even if the first is disabled)
    const second = await call("POST", "/user", { token: admin.token, body: { email: "second.portal@alihsan.example", role: "facility", facilityId: "F1", password: "Secret123" } });
    assert.equal(second.status, 409);
    assert.match(second.body.message ?? "", /already has a login/);
    const portal = (await call("GET", "/user", { token: admin.token })).body.payLoad.find((u: any) => u.email === "portal@alihsan.example");
    await call("PATCH", `/user/${portal.id}/status`, { token: admin.token, body: { status: "Disabled" } });
    assert.equal((await call("POST", "/user", { token: admin.token, body: { email: "second.portal@alihsan.example", role: "facility", facilityId: "F1", password: "Secret123" } })).status, 409);
    await call("PATCH", `/user/${portal.id}/status`, { token: admin.token, body: { status: "Active" } });

    const noFac = await call("POST", "/user", { token: admin.token, body: { email: "f@alihsan.example", role: "facility", password: "Secret123" } });
    assert.equal(noFac.status, 400);
  });

  it("registers a facility account linked to a facility, scoped to that facility's claims", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const res = await call("POST", "/user", { token: admin.token, body: { email: "north@alihsan.example", role: "facility", facilityId: "F2", password: "Secret123" } });
    assert.equal(res.status, 201);
    assert.equal(res.body.payLoad.name, "General Hospital North");
    const north = await login("north@alihsan.example", "Secret123");
    const claims = await call("GET", "/claim", { token: north.token });
    assert.ok(claims.body.payLoad.length > 0);
    assert.ok(claims.body.payLoad.every((c: any) => c.facId === "F2"));
  });

  it("every new facility account gets Code Requests and Submit Claims by default", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const res = await call("POST", "/user", { token: admin.token, body: { email: "south@alihsan.example", role: "facility", facilityId: "F4", password: "Secret123" } });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.payLoad.screens, ["requests", "facility-portal"]);
    assert.deepEqual(res.body.payLoad.defaultScreens, ["requests", "facility-portal"]);
    assert.equal(res.body.payLoad.accessOverride, null); // it's the default, not a custom grant
    const south = await login("south@alihsan.example", "Secret123");
    assert.deepEqual(south.user.screens, ["requests", "facility-portal"]);
  });
});

describe("facilities and code requests", () => {
  it("a facility sees only the requests it sent or is receiving", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const all = await call("GET", "/request", { token: admin.token });
    const fac = await login("portal@alihsan.example"); // F1
    const mine = await call("GET", "/request", { token: fac.token });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.payLoad.length > 0 && mine.body.payLoad.length < all.body.payLoad.length);
    assert.ok(mine.body.payLoad.every((r: any) => r.refId === "F1" || r.recvId === "F1"));
  });

  it("a facility sends a request as itself, and can't act on the desk's or reviewer's side", async () => {
    const fac = await login("portal@alihsan.example"); // F1
    const res = await call("POST", "/request", {
      token: fac.token,
      body: { name: "Own Request", kad: "KAD-104-2271", dx: "d", proc: "p", planId: "P1", refId: "F5", recvId: "F2" }, // tries to pose as F5
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.payLoad.refId, "F1"); // forced to its own facility
    assert.equal(res.body.payLoad.status, "Pending");

    const toSelf = await call("POST", "/request", {
      token: fac.token,
      body: { name: "Self", kad: "K", dx: "d", proc: "p", planId: "P1", refId: "F1", recvId: "F1" },
    });
    assert.equal(toSelf.status, 400);

    const id = res.body.payLoad.id;
    assert.equal((await call("POST", `/request/${id}/start-review`, { token: fac.token })).status, 403);
    assert.equal((await call("POST", `/request/${id}/sent`, { token: fac.token })).status, 403);

    const north = await login("north@alihsan.example", "Secret123"); // F2 is the receiving facility
    const theirs = await call("GET", "/request", { token: north.token });
    assert.ok(theirs.body.payLoad.some((r: any) => r.id === id));
    const south = await login("south@alihsan.example", "Secret123"); // F4 has nothing to do with it
    const unrelated = await call("GET", "/request", { token: south.token });
    assert.ok(!unrelated.body.payLoad.some((r: any) => r.id === id));
  });
});

describe("disabling users", () => {
  it("a disabled user can't sign in, their live session ends, and they can be re-enabled", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const made = await call("POST", "/user", { token: admin.token, body: { name: "Temp Desk", email: "temp.desk@alihsan.example", role: "desk-officer", password: "Secret123" } });
    assert.equal(made.status, 201);
    const id = made.body.payLoad.id;
    assert.equal(made.body.payLoad.status, "Active");
    const session = await login("temp.desk@alihsan.example", "Secret123");
    assert.equal((await call("GET", "/request", { token: session.token })).status, 200);

    const off = await call("PATCH", `/user/${id}/status`, { token: admin.token, body: { status: "Disabled" } });
    assert.equal(off.status, 200);
    assert.equal(off.body.payLoad.status, "Disabled");

    const denied = await call("POST", "/auth/login", { body: { email: "temp.desk@alihsan.example", password: "Secret123" } });
    assert.equal(denied.status, 403);
    assert.match(denied.body.message ?? "", /disabled/i);
    assert.equal((await call("GET", "/request", { token: session.token })).status, 401); // the token they already held stops working

    const on = await call("PATCH", `/user/${id}/status`, { token: admin.token, body: { status: "Active" } });
    assert.equal(on.body.payLoad.status, "Active");
    assert.equal((await call("GET", "/request", { token: session.token })).status, 200);
    await login("temp.desk@alihsan.example", "Secret123");
  });

  it("guards: no self-disabling, valid statuses only, unknown users, and only people with the HR page", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    assert.equal((await call("PATCH", `/user/${admin.user.id}/status`, { token: admin.token, body: { status: "Disabled" } })).status, 400);
    assert.equal((await call("PATCH", `/user/${admin.user.id}/status`, { token: admin.token, body: { status: "Banned" } })).status, 400);
    assert.equal((await call("PATCH", `/user/NOPE/status`, { token: admin.token, body: { status: "Disabled" } })).status, 404);
    const desk = await login("s.bello@alihsan.example");
    assert.equal((await call("PATCH", `/user/${admin.user.id}/status`, { token: desk.token, body: { status: "Disabled" } })).status, 403);
  });

  it("HR staff can disable staff but not an administrator", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const hr = await login("f.adamu@alihsan.example");
    await call("PUT", `/access/${hr.user.id}`, { token: admin.token, body: { screens: ["hr"] } });
    assert.equal((await call("PATCH", `/user/${admin.user.id}/status`, { token: hr.token, body: { status: "Disabled" } })).status, 403);
    const desk = await login("r.adeyemi@alihsan.example");
    assert.equal((await call("PATCH", `/user/${desk.user.id}/status`, { token: hr.token, body: { status: "On leave" } })).status, 200);
    await call("PATCH", `/user/${desk.user.id}/status`, { token: hr.token, body: { status: "Active" } });
    await call("DELETE", `/access/${hr.user.id}`, { token: admin.token });
  });
});

describe("code request flow: desk -> medical officer -> response sent", () => {
  let requestId = "";

  it("a desk officer records a request, which starts Pending", async () => {
    const desk = await login("s.bello@alihsan.example");
    const res = await call("POST", "/request", {
      token: desk.token,
      body: { name: "Flow Test", kad: "KAD-999-0001", phone: "0800", dx: "Test dx", proc: "Chest X-ray", planId: "P1", refId: "F3", recvId: "F1" },
    });
    assert.equal(res.status, 201);
    requestId = res.body.payLoad.id;
    assert.equal(res.body.payLoad.status, "Pending");
    assert.equal(res.body.payLoad.createdBy, "S. Bello (Desk Officer)");
  });

  it("flags whether the enrollee number matches a known enrollee, without needing the Enrollees page", async () => {
    const medical = await login("m.hassan@alihsan.example"); // no `enrollees` page
    const list = await call("GET", "/request", { token: medical.token });
    assert.equal(list.status, 200);
    const unknown = list.body.payLoad.find((r: any) => r.id === requestId);
    assert.equal(unknown.verified, false);
    const known = list.body.payLoad.find((r: any) => r.kad === "KAD-104-2271");
    assert.equal(known.verified, true);

    const desk = await login("s.bello@alihsan.example");
    const yes = await call("GET", "/enrollee/verify/KAD-104-2271", { token: desk.token });
    assert.equal(yes.body.payLoad.verified, true);
    const no = await call("GET", "/enrollee/verify/KAD-000-0000", { token: desk.token });
    assert.equal(no.body.payLoad.verified, false);
    assert.equal((await call("GET", "/enrollee/verify/KAD-104-2271", { token: medical.token })).status, 403);
  });

  it("looks an enrollee up by number so forms can fill in their details", async () => {
    const desk = await login("s.bello@alihsan.example");
    const hit = (await call("GET", "/enrollee/verify/kad-104-2271", { token: desk.token })).body.payLoad; // not case-sensitive
    assert.equal(hit.verified, true);
    assert.deepEqual(hit.enrollee, { kad: "KAD-104-2271", name: "Hauwa Ibrahim", phone: "0803 555 0114", planId: "P1", planName: "Formal Sector Standard", status: "Active" });

    const miss = (await call("GET", "/enrollee/verify/KAD-000-0000", { token: desk.token })).body.payLoad;
    assert.equal(miss.verified, false);
    assert.equal(miss.enrollee, null);

    // a facility account can look people up too, and gets the same details to fill its forms
    const fac = await login("portal@alihsan.example");
    const viaFacility = await call("GET", "/enrollee/verify/KAD-104-2271", { token: fac.token });
    assert.equal(viaFacility.status, 200);
    assert.equal(viaFacility.body.payLoad.enrollee.name, "Hauwa Ibrahim");
    assert.equal(viaFacility.body.payLoad.enrollee.phone, "0803 555 0114");
    assert.equal((await call("GET", "/enrollee/verify/KAD-104-2271")).status, 401);
  });

  it("a desk officer can't review or approve", async () => {
    const desk = await login("s.bello@alihsan.example");
    assert.equal((await call("POST", `/request/${requestId}/start-review`, { token: desk.token })).status, 403);
  });

  it("the medical officer reviews, approves, and gets the next code in sequence", async () => {
    const doc = await login("m.hassan@alihsan.example");
    // can't skip straight to approve
    assert.equal((await call("POST", `/request/${requestId}/approve`, { token: doc.token })).status, 409);
    const started = await call("POST", `/request/${requestId}/start-review`, { token: doc.token });
    assert.equal(started.body.payLoad.status, "Under Review");
    const approved = await call("POST", `/request/${requestId}/approve`, { token: doc.token });
    assert.equal(approved.body.payLoad.status, "Approved");
    assert.match(approved.body.payLoad.code, /^0004\d\d$/);
    assert.ok(Number(approved.body.payLoad.code) >= 469);
    assert.equal((await call("POST", `/request/${requestId}/approve`, { token: doc.token })).status, 409); // not twice
  });

  it("marking the response sent logs a delivery, once", async () => {
    const desk = await login("s.bello@alihsan.example");
    const sent = await call("POST", `/request/${requestId}/sent`, { token: desk.token });
    assert.equal(sent.body.payLoad.sent, "Sent — manual");
    assert.equal((await call("POST", `/request/${requestId}/sent`, { token: desk.token })).status, 409);
    const admin = await login("k.suleiman@alihsan.example");
    const deliveries = await call("GET", "/notification/deliveries", { token: admin.token });
    assert.equal(deliveries.body.payLoad[0].tmpl, "Code approved");
  });

  it("rejection records a default reason when none is given", async () => {
    const desk = await login("s.bello@alihsan.example");
    const doc = await login("m.hassan@alihsan.example");
    const created = await call("POST", "/request", { token: desk.token, body: { name: "R", kad: "K", dx: "d", proc: "p", planId: "P2", refId: "F3", recvId: "F2" } });
    const id = created.body.payLoad.id;
    await call("POST", `/request/${id}/start-review`, { token: doc.token });
    const rejected = await call("POST", `/request/${id}/reject`, { token: doc.token, body: {} });
    assert.equal(rejected.body.payLoad.status, "Rejected");
    assert.match(rejected.body.payLoad.reason, /Not clinically justified/);
  });

  it("rejects requests that reference unknown plans or facilities", async () => {
    const desk = await login("s.bello@alihsan.example");
    const res = await call("POST", "/request", { token: desk.token, body: { name: "R", kad: "K", dx: "d", proc: "p", planId: "NOPE", refId: "F3", recvId: "F2" } });
    assert.equal(res.status, 400);
  });
});

describe("claim flow: facility -> medical officer -> admin pays", () => {
  let claimId = "";
  let items: { id: string; name: string; amount: number }[] = [];

  it("only a facility account can submit; each line defaults to the approved price", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const denied = await call("POST", "/claim", { token: admin.token, body: { name: "N", kad: "K", investigations: [{ investigationId: "INV-7-1" }] } });
    assert.equal(denied.status, 403);

    const fac = await login("portal@alihsan.example");
    const res = await call("POST", "/claim", {
      token: fac.token,
      body: { name: "Claim Test", kad: "KAD-104-2271", linked: "000466", investigations: [{ investigationId: "INV-7-1" }, { investigationId: "INV-5-3", amount: 4000 }] },
    });
    assert.equal(res.status, 201);
    const c = res.body.payLoad;
    claimId = c.id;
    items = c.investigations;
    assert.equal(c.status, "Submitted");
    assert.equal(c.facId, "F1");
    assert.equal(c.linked, "CR-1017 / 000466");
    assert.equal(c.dx, "FBC, Thorax");
    assert.deepEqual(items.map((i) => i.amount), [2625, 4000]);
    assert.equal(c.amount, 6625);
  });

  it("a facility sees only the approved codes it receives, and can't link anyone else's", async () => {
    const fac = await login("portal@alihsan.example"); // Ummah Mamuda (F1)
    const codes = await call("GET", "/request/codes", { token: fac.token });
    assert.equal(codes.status, 200);
    const received = codes.body.payLoad.map((c: any) => c.code);
    assert.ok(received.includes("000466"));
    assert.ok(!received.includes("000468") && !received.includes("000467")); // approved for other facilities
    assert.equal(codes.body.payLoad.find((c: any) => c.code === "000466").kad, "KAD-104-2271");

    const wrong = await call("POST", "/claim", {
      token: fac.token,
      body: { name: "X", kad: "K", linked: "000468", investigations: [{ investigationId: "INV-7-1" }] }, // approved for F2, not F1
    });
    assert.equal(wrong.status, 400);
    const unknown = await call("POST", "/claim", {
      token: fac.token,
      body: { name: "X", kad: "K", linked: "999999", investigations: [{ investigationId: "INV-7-1" }] },
    });
    assert.equal(unknown.status, 400);

    const desk = await login("s.bello@alihsan.example");
    assert.equal((await call("GET", "/request/codes", { token: desk.token })).status, 403);
  });

  it("accepts a real file upload and serves it only to people allowed to see the claim", async () => {
    const fac = await login("portal@alihsan.example");
    const form = new FormData();
    form.set("name", "Upload Test");
    form.set("kad", "KAD-1");
    form.set("investigations", JSON.stringify([{ investigationId: "INV-7-2" }]));
    form.set("document", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "bill.pdf");
    const res = await call("POST", "/claim", { token: fac.token, form });
    assert.equal(res.status, 201);
    const claim = res.body.payLoad;
    assert.equal(claim.docs[0].file, "bill.pdf");
    assert.equal(claim.docs[0].downloadable, true);

    const own = await fetch(`${base}/api/v1/claim/${claim.id}/document/${claim.docs[0].id}`, { headers: { Authorization: `Bearer ${fac.token}` } });
    assert.equal(own.status, 200);
    assert.equal(await own.text(), "%PDF-1.4 test");

    const anon = await fetch(`${base}/api/v1/claim/${claim.id}/document/${claim.docs[0].id}`);
    assert.equal(anon.status, 401);
    const north = await login("north@alihsan.example", "Secret123"); // a different facility
    const other = await fetch(`${base}/api/v1/claim/${claim.id}/document/${claim.docs[0].id}`, { headers: { Authorization: `Bearer ${north.token}` } });
    assert.ok(other.status === 403 || other.status === 401);
  });

  it("rejects disallowed file types and empty investigation lists", async () => {
    const fac = await login("portal@alihsan.example");
    const form = new FormData();
    form.set("name", "N");
    form.set("kad", "K");
    form.set("investigations", JSON.stringify([{ investigationId: "INV-7-2" }]));
    form.set("document", new Blob(["x"], { type: "application/x-msdownload" }), "virus.exe");
    assert.equal((await call("POST", "/claim", { token: fac.token, form })).status, 400);
    assert.equal((await call("POST", "/claim", { token: fac.token, body: { name: "N", kad: "K", investigations: [] } })).status, 400);
  });

  it("the facility only sees its own claims", async () => {
    const fac = await login("portal@alihsan.example");
    const claims = await call("GET", "/claim", { token: fac.token });
    assert.ok(claims.body.payLoad.length >= 2);
    assert.ok(claims.body.payLoad.every((c: any) => c.facId === "F1"));
  });

  it("the medical officer edits one line and cancels another; totals follow", async () => {
    const doc = await login("m.hassan@alihsan.example");
    const edited = await call("PATCH", `/claim/${claimId}/investigation/${items[1].id}`, { token: doc.token, body: { amount: 3500 } });
    assert.equal(edited.body.payLoad.amount, 6125);

    const removed = await call("DELETE", `/claim/${claimId}/investigation/${items[0].id}`, { token: doc.token });
    assert.equal(removed.body.payLoad.amount, 3500);
    assert.equal(removed.body.payLoad.dx, "Thorax");

    // the last line can't be cancelled
    assert.equal((await call("DELETE", `/claim/${claimId}/investigation/${items[1].id}`, { token: doc.token })).status, 409);
  });

  it("the facility can't review its own claim", async () => {
    const fac = await login("portal@alihsan.example");
    assert.equal((await call("POST", `/claim/${claimId}/approve`, { token: fac.token })).status, 403);
    assert.equal((await call("PATCH", `/claim/${claimId}/investigation/${items[1].id}`, { token: fac.token, body: { amount: 1 } })).status, 403);
  });

  it("review is locked once decided; only an administrator can pay, creating a transaction", async () => {
    const doc = await login("m.hassan@alihsan.example");
    await call("POST", `/claim/${claimId}/start-review`, { token: doc.token });
    const approved = await call("POST", `/claim/${claimId}/approve`, { token: doc.token });
    assert.equal(approved.body.payLoad.status, "Approved");
    assert.equal((await call("PATCH", `/claim/${claimId}/investigation/${items[1].id}`, { token: doc.token, body: { amount: 9 } })).status, 409);

    assert.equal((await call("POST", `/claim/${claimId}/pay`, { token: doc.token })).status, 403);
    const admin = await login("k.suleiman@alihsan.example");
    const paid = await call("POST", `/claim/${claimId}/pay`, { token: admin.token });
    assert.equal(paid.body.payLoad.status, "Paid");
    assert.equal((await call("POST", `/claim/${claimId}/pay`, { token: admin.token })).status, 409);
    const txns = await call("GET", "/transaction", { token: admin.token });
    assert.ok(txns.body.payLoad.some((t: any) => t.who.includes(claimId) && t.amount === 3500 && t.type === "Facility payment"));
  });

  it("a claim can be rejected with a reason", async () => {
    const doc = await login("m.hassan@alihsan.example");
    await call("POST", "/claim/CL-3006/start-review", { token: doc.token });
    const res = await call("POST", "/claim/CL-3006/reject", { token: doc.token, body: { reason: "Not covered" } });
    assert.equal(res.body.payLoad.status, "Rejected");
    assert.equal(res.body.payLoad.reason, "Not covered");
  });
});

describe("approved claims report", () => {
  const july = "from=2026-07-01T00:00:00Z&to=2026-08-01T00:00:00Z";

  it("lists approved and paid claims with totals, newest approval first", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const res = await call("GET", `/report/approved-claims?${july}`, { token: admin.token });
    assert.equal(res.status, 200);
    const { rows, totals } = res.body.payLoad;
    assert.deepEqual(rows.map((r: any) => r.id).sort(), ["CL-3001", "CL-3002"]); // Rejected / pending ones are excluded
    assert.equal(totals.count, 2);
    assert.equal(totals.amount, 95000 + 85000);
    assert.equal(totals.paidAmount, 95000);
    assert.equal(totals.awaitingPaymentAmount, 85000);
    assert.equal(totals.byFacility.length, 2);
    assert.ok(new Date(rows[0].approvedAt) >= new Date(rows[1].approvedAt));
  });

  it("filters by facility and by date range", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const f1 = await call("GET", `/report/approved-claims?${july}&facilityId=F1`, { token: admin.token });
    assert.deepEqual(f1.body.payLoad.rows.map((r: any) => r.id), ["CL-3001"]);
    assert.equal(f1.body.payLoad.totals.amount, 95000);

    const august = await call("GET", "/report/approved-claims?from=2026-08-01T00:00:00Z&to=2026-08-08T00:00:00Z", { token: admin.token });
    assert.equal(august.body.payLoad.totals.count, 0);
    assert.equal(august.body.payLoad.totals.amount, 0);

    assert.equal((await call("GET", `/report/approved-claims?facilityId=NOPE`, { token: admin.token })).status, 404);
    assert.equal((await call("GET", `/report/approved-claims?from=2026-09-01&to=2026-08-01`, { token: admin.token })).status, 400);
  });

  it("exports the same report as CSV, with a total and spreadsheet-safe cells", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const res = await fetch(`${base}/api/v1/report/approved-claims?${july}&format=csv`, { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /approved-claims-2026-07-01_to_2026-08-01\.csv/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM so Excel reads it correctly
    const text = new TextDecoder().decode(bytes);
    assert.ok(text.includes("Claim,Enrollee,Enrollee number"));
    assert.ok(text.includes("CL-3001") && text.includes("CL-3002"));
    assert.ok(text.includes("Total approved (NGN),180000"));
  });

  it("is only for people who have the page", async () => {
    assert.equal((await call("GET", "/report/approved-claims")).status, 401);
    for (const email of ["m.hassan@alihsan.example", "s.bello@alihsan.example", "portal@alihsan.example"]) {
      const who = await login(email);
      assert.equal((await call("GET", "/report/approved-claims", { token: who.token })).status, 403, email);
    }
  });
});

describe("proof of payment on paid claims", () => {
  const authed = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
  let claimId = "";

  it("an administrator pays with proof attached, and the facility can download it", async () => {
    const fac = await login("portal@alihsan.example");
    const made = await call("POST", "/claim", { token: fac.token, body: { name: "Proof Test", kad: "KAD-9", investigations: [{ investigationId: "INV-7-1" }] } });
    claimId = made.body.payLoad.id;
    const med = await login("m.hassan@alihsan.example");
    await call("POST", `/claim/${claimId}/start-review`, { token: med.token });
    await call("POST", `/claim/${claimId}/approve`, { token: med.token });

    const admin = await login("k.suleiman@alihsan.example");
    const form = new FormData();
    form.append("proofs", new Blob(["%PDF receipt"], { type: "application/pdf" }), "receipt.pdf");
    form.append("proofs", new Blob(["PNGDATA"], { type: "image/png" }), "transfer.png");
    const paid = await call("POST", `/claim/${claimId}/pay`, { token: admin.token, form });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.payLoad.status, "Paid");
    const proofs = paid.body.payLoad.docs.filter((d: any) => d.kind === "payment-proof");
    assert.deepEqual(proofs.map((d: any) => d.file).sort(), ["receipt.pdf", "transfer.png"]);
    assert.ok(proofs.every((d: any) => d.downloadable && d.uploadedBy === "K. Suleiman"));

    const download = await fetch(`${base}/api/v1/claim/${claimId}/document/${proofs.find((d: any) => d.file === "receipt.pdf").id}`, authed(fac.token));
    assert.equal(download.status, 200);
    assert.equal(await download.text(), "%PDF receipt");

    const north = await login("north@alihsan.example", "Secret123"); // another facility
    const denied = await fetch(`${base}/api/v1/claim/${claimId}/document/${proofs[0].id}`, authed(north.token));
    assert.ok(denied.status === 403 || denied.status === 401);
  });

  it("proof can be added later, only to a paid claim, only as PDF/images, and only by an administrator", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const file = (name: string, type: string) => {
      const form = new FormData();
      form.append("proofs", new Blob(["x"], { type }), name);
      return form;
    };
    const added = await call("POST", `/claim/${claimId}/payment-proof`, { token: admin.token, form: file("bank-slip.jpg", "image/jpeg") });
    assert.equal(added.status, 201);
    assert.equal(added.body.payLoad.docs.filter((d: any) => d.kind === "payment-proof").length, 3);

    assert.equal((await call("POST", `/claim/${claimId}/payment-proof`, { token: admin.token, form: file("virus.exe", "application/octet-stream") })).status, 400);
    assert.equal((await call("POST", `/claim/${claimId}/payment-proof`, { token: admin.token, form: new FormData() })).status, 400);
    assert.equal((await call("POST", `/claim/CL-3004/payment-proof`, { token: admin.token, form: file("a.pdf", "application/pdf") })).status, 409); // not paid yet

    const med = await login("m.hassan@alihsan.example");
    assert.equal((await call("POST", `/claim/${claimId}/payment-proof`, { token: med.token, form: file("a.pdf", "application/pdf") })).status, 403);
  });

  it("proof can be removed, but the claim's own supporting documents can't", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const list = await call("GET", "/claim", { token: admin.token });
    const claim = list.body.payLoad.find((c: any) => c.id === claimId);
    const proof = claim.docs.find((d: any) => d.kind === "payment-proof");
    const removed = await call("DELETE", `/claim/${claimId}/document/${proof.id}`, { token: admin.token });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.payLoad.docs.filter((d: any) => d.kind === "payment-proof").length, 2);

    const withDoc = list.body.payLoad.find((c: any) => c.docs.some((d: any) => d.kind === "supporting"));
    const supporting = withDoc.docs.find((d: any) => d.kind === "supporting");
    assert.equal((await call("DELETE", `/claim/${withDoc.id}/document/${supporting.id}`, { token: admin.token })).status, 403);
  });

  it("the approved-claims report counts the proofs", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const report = await call("GET", "/report/approved-claims", { token: admin.token });
    assert.equal(report.body.payLoad.rows.find((r: any) => r.id === claimId).paymentProofs, 2);
  });
});

describe("approved and rejected codes tied to users and facilities", () => {
  it("links every request to who recorded it and who decided it, as real accounts", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const users = (await call("GET", "/user", { token: admin.token })).body.payLoad;
    const hassan = users.find((u: any) => u.email === "m.hassan@alihsan.example");
    const bello = users.find((u: any) => u.email === "s.bello@alihsan.example");

    const res = await call("GET", `/user/${hassan.id}/codes`, { token: admin.token });
    assert.equal(res.status, 200);
    const { decided, requested } = res.body.payLoad;
    assert.ok(decided.items.length > 0 && decided.items.every((r: any) => r.reviewedById === hassan.id && ["Approved", "Rejected"].includes(r.status)));
    assert.equal(decided.stats.approved + decided.stats.rejected, decided.stats.decided);
    assert.equal(decided.stats.approvalRate, Math.round((decided.stats.approved / decided.stats.decided) * 100));
    assert.equal(decided.stats.approvalRate + decided.stats.rejectionRate, 100);
    assert.equal(requested.stats.total, 0); // a medical officer records nothing

    const desk = (await call("GET", `/user/${bello.id}/codes`, { token: admin.token })).body.payLoad;
    assert.ok(desk.requested.stats.total > 0);
    assert.ok(desk.requested.items.every((r: any) => r.createdById === bello.id));
    assert.equal(desk.decided.stats.total, 0);
    const approved = desk.requested.items.find((r: any) => r.status === "Approved");
    assert.match(approved.code, /^\d{6}$/);
    assert.ok(approved.refName && approved.recvName);
  });

  it("new decisions are linked to the person who made them", async () => {
    const desk = await login("s.bello@alihsan.example");
    const made = await call("POST", "/request", { token: desk.token, body: { name: "Link Test", kad: "KAD-LINK", dx: "d", proc: "p", planId: "P1", refId: "F3", recvId: "F2" } });
    const id = made.body.payLoad.id;
    const med = await login("m.hassan@alihsan.example");
    await call("POST", `/request/${id}/start-review`, { token: med.token });
    await call("POST", `/request/${id}/reject`, { token: med.token, body: { reason: "Not covered" } });

    const admin = await login("k.suleiman@alihsan.example");
    const mine = (await call("GET", `/user/${med.user.id}/codes`, { token: admin.token })).body.payLoad.decided;
    const row = mine.items.find((r: any) => r.id === id);
    assert.equal(row.status, "Rejected");
    assert.equal(row.reason, "Not covered");
    assert.equal(row.reviewedById, med.user.id);
    const bello = (await call("GET", `/user/${desk.user.id}/codes`, { token: admin.token })).body.payLoad.requested;
    assert.ok(bello.items.some((r: any) => r.id === id && r.createdById === desk.user.id));
  });

  it("shows a facility's approved and rejected codes with the percentages", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const res = await call("GET", "/facility/F3/codes", { token: admin.token });
    assert.equal(res.status, 200);
    const { requested, received } = res.body.payLoad;
    const s = requested.stats;
    assert.ok(s.approved >= 1 && s.rejected >= 1);
    assert.equal(s.decided, s.approved + s.rejected);
    assert.equal(s.approvalRate, Math.round((s.approved / s.decided) * 100));
    assert.equal(s.approvalRate + s.rejectionRate, 100);
    assert.equal(s.total, s.pending + s.underReview + s.decided);
    assert.ok(requested.items.every((r: any) => r.refId === "F3" && ["Approved", "Rejected"].includes(r.status)));
    assert.equal(requested.items.filter((r: any) => r.status === "Approved").length, s.approved);
    assert.ok(received.items.every((r: any) => r.recvId === "F3"));

    // a facility nothing was ever decided for has no percentages, rather than 0%
    const none = (await call("GET", "/facility/F18/codes", { token: admin.token })).body.payLoad;
    assert.equal(none.requested.stats.decided, 0);
    assert.equal(none.requested.stats.approvalRate, null);
    assert.equal(none.requested.stats.rejectionRate, null);
    assert.deepEqual(none.requested.items, []);
  });

  it("is only for people with the HR / Facilities pages, and 404s unknown ids", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    assert.equal((await call("GET", "/user/NOPE/codes", { token: admin.token })).status, 404);
    assert.equal((await call("GET", "/facility/NOPE/codes", { token: admin.token })).status, 404);
    for (const email of ["m.hassan@alihsan.example", "s.bello@alihsan.example", "portal@alihsan.example"]) {
      const who = await login(email);
      assert.equal((await call("GET", "/user/ST-01/codes", { token: who.token })).status, 403, email);
      assert.equal((await call("GET", "/facility/F1/codes", { token: who.token })).status, 403, email);
    }
    assert.equal((await call("GET", "/facility/F1/codes")).status, 401);
  });
});

describe("medical-officer KPIs", () => {
  const H = 3_600_000;
  const now = new Date("2026-11-10T12:00:00Z").getTime();
  const at = (hoursAgo: number) => new Date(now - hoursAgo * H);

  it("works out counts, rates and timings exactly", () => {
    const k = computeKpi(
      [
        // created 30h ago, picked up 10h ago, decided 6h ago -> turnaround 24h, review time 4h
        { status: "Approved", createdAt: at(30), reviewStartedAt: at(10), reviewedAt: at(6) },
        // created 20h ago, decided 8h ago, no start time recorded -> turnaround 12h
        { status: "Rejected", createdAt: at(20), reviewStartedAt: null, reviewedAt: at(8) },
        // a paid claim is an approved one: created 100h ago, picked up 60h ago, decided 48h ago -> 52h / 12h
        { status: "Paid", createdAt: at(100), reviewStartedAt: at(60), reviewedAt: at(48) },
        // still with them: picked up 5h ago
        { status: "Under Review", createdAt: at(9), reviewStartedAt: at(5), reviewedAt: null },
      ],
      now,
    );
    assert.equal(k.decided, 3);
    assert.equal(k.approved, 2);
    assert.equal(k.rejected, 1);
    assert.equal(k.approvalRate, 67);
    assert.equal(k.underReview, 1);
    assert.equal(k.oldestUnderReviewHours, 5);
    assert.deepEqual(k.turnaround, { sample: 3, avgHours: 29.3, medianHours: 24, fastestHours: 12, slowestHours: 52 });
    assert.deepEqual(k.reviewTime, { sample: 2, avgHours: 8, medianHours: 8, fastestHours: 4, slowestHours: 12 }); // the rejected one has no start time
    assert.equal(k.within24hRate, 67); // 24h and 12h are within a day, 52h is not
    assert.equal(k.last7Days, 3);
    assert.equal(k.daily.length, 14);
    assert.equal(k.daily.reduce((a, d) => a + d.count, 0), 3);
  });

  it("has no figures, rather than zeros, before anything is decided", () => {
    const k = computeKpi([], now);
    assert.equal(k.decided, 0);
    assert.equal(k.approvalRate, null);
    assert.equal(k.within24hRate, null);
    assert.equal(k.turnaround.avgHours, null);
    assert.equal(k.reviewTime.sample, 0);
    assert.equal(k.oldestUnderReviewHours, null);
  });

  it("records when review starts, so a new decision has a review time", async () => {
    const desk = await login("s.bello@alihsan.example");
    const made = await call("POST", "/request", { token: desk.token, body: { name: "KPI Test", kad: "KAD-KPI", dx: "d", proc: "p", planId: "P1", refId: "F3", recvId: "F2" } });
    const id = made.body.payLoad.id;
    const med = await login("m.hassan@alihsan.example");
    const admin = await login("k.suleiman@alihsan.example");
    const before = (await call("GET", `/user/${med.user.id}/kpi`, { token: admin.token })).body.payLoad.codes;
    await call("POST", `/request/${id}/start-review`, { token: med.token });
    await new Promise((r) => setTimeout(r, 30));
    await call("POST", `/request/${id}/approve`, { token: med.token });
    const after = (await call("GET", `/user/${med.user.id}/kpi`, { token: admin.token })).body.payLoad.codes;
    assert.equal(after.decided, before.decided + 1);
    assert.equal(after.approved, before.approved + 1);
    assert.equal(after.reviewTime.sample, before.reviewTime.sample + 1);
    assert.ok(after.last7Days >= 1);
    assert.equal(after.daily[13].count >= 1, true); // decided today
  });

  it("agrees with the codes list, covers claims too, and lines the officers up on the dashboard", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const med = await login("m.hassan@alihsan.example");
    const kpi = (await call("GET", `/user/${med.user.id}/kpi`, { token: admin.token })).body.payLoad;
    const codes = (await call("GET", `/user/${med.user.id}/codes`, { token: admin.token })).body.payLoad.decided.stats;
    assert.equal(kpi.codes.decided, codes.decided);
    assert.equal(kpi.codes.approved, codes.approved);
    assert.equal(kpi.codes.approvalRate, codes.approvalRate);
    assert.ok(kpi.claims.decided > 0); // claims decided by this officer count too

    const team = (await call("GET", "/analytics/reviewers", { token: admin.token })).body.payLoad;
    const row = team.find((r: any) => r.id === med.user.id);
    assert.equal(row.name, "Dr. M. Hassan");
    assert.equal(row.codes.decided, kpi.codes.decided);
    assert.ok(team.every((r: any) => r.role === "medical-officer" || r.codes.decided + r.claims.decided > 0));
  });

  it("is for HR / the dashboard only, and 404s unknown people", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    assert.equal((await call("GET", "/user/NOPE/kpi", { token: admin.token })).status, 404);
    for (const email of ["m.hassan@alihsan.example", "s.bello@alihsan.example", "portal@alihsan.example"]) {
      const who = await login(email);
      assert.equal((await call("GET", "/user/ST-02/kpi", { token: who.token })).status, 403, email);
      assert.equal((await call("GET", "/analytics/reviewers", { token: who.token })).status, 403, email);
    }
    assert.equal((await call("GET", "/analytics/reviewers")).status, 401);
  });
});

describe("investigation prices", () => {
  it("everyone signed in can read the tariff; only admins with the page can edit it", async () => {
    const fac = await login("portal@alihsan.example");
    const list = await call("GET", "/investigation", { token: fac.token });
    assert.equal(list.body.payLoad.length, 35);
    assert.equal((await call("PUT", "/investigation/INV-7-1", { token: fac.token, body: { approved: 1 } })).status, 403);

    const admin = await login("k.suleiman@alihsan.example");
    const res = await call("PUT", "/investigation/INV-7-1", { token: admin.token, body: { approved: 3000, baseline: 1600 } });
    assert.equal(res.body.payLoad.approved, 3000);
    assert.equal((await call("PUT", "/investigation/INV-7-1", { token: admin.token, body: {} })).status, 400);
    assert.equal((await call("PUT", "/investigation/NOPE", { token: admin.token, body: { approved: 1 } })).status, 404);

    // new claims pick up the new price, old ones keep their snapshot
    const newClaim = await call("POST", "/claim", { token: fac.token, body: { name: "P", kad: "K", investigations: [{ investigationId: "INV-7-1" }] } });
    assert.equal(newClaim.body.payLoad.amount, 3000);
  });
});

describe("audit trail", () => {
  it("records who did what for the actions taken earlier in this run", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const all = await call("GET", "/audit?pageSize=200", { token: admin.token });
    assert.equal(all.status, 200);
    const actions = new Set(all.body.payLoad.rows.map((r: any) => r.action));
    for (const a of [
      "auth.login", "auth.login_failed", "enrollment.create", "user.register", "user.disable", "user.enable", "access.set", "access.reset",
      "request.create", "request.approve", "request.reject", "request.mark_sent", "claim.create", "claim.start_review", "claim.approve",
      "claim.edit_line", "claim.pay", "claim.proof_add", "claim.proof_remove", "claim.document_download", "investigation.update",
    ]) {
      assert.ok(actions.has(a), `missing audit action ${a}`);
    }
    const approval = all.body.payLoad.rows.find((r: any) => r.action === "claim.approve");
    assert.equal(approval.actorName, "Dr. M. Hassan");
    assert.equal(approval.actorRole, "medical-officer");
    assert.equal(approval.entityType, "claim");
    assert.match(approval.summary, /Approved claim CL-\d+ .* — ₦/);
    const web = all.body.payLoad.rows.find((r: any) => r.action === "enrollment.create");
    assert.equal(web.actorName, "Website visitor");
    assert.equal(web.actorId, null);
  });

  it("records adding a facility and a manual transaction", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    await call("POST", "/facility", { token: admin.token, body: { name: "Audit Test Clinic", tier: "Primary" } });
    await call("POST", "/transaction", { token: admin.token, body: { who: "Audit Person", amount: 1234, type: "Premium" } });
    const rows = (await call("GET", "/audit?pageSize=10", { token: admin.token })).body.payLoad.rows;
    assert.ok(rows.some((r: any) => r.action === "transaction.record" && /₦1,234/.test(r.summary) && /Audit Person/.test(r.summary)));
    assert.ok(rows.some((r: any) => r.action === "facility.add" && /Audit Test Clinic/.test(r.summary)));
  });

  it("filters by person, area, action, record, text and date", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const get = async (qs: string) => (await call("GET", `/audit?pageSize=200&${qs}`, { token: admin.token })).body.payLoad;

    const med = (await call("GET", "/user", { token: admin.token })).body.payLoad.find((u: any) => u.email === "m.hassan@alihsan.example");
    const byActor = await get(`actorId=${med.id}`);
    assert.ok(byActor.rows.length > 0 && byActor.rows.every((r: any) => r.actorId === med.id));

    const claims = await get("entityType=claim");
    assert.ok(claims.rows.length > 0 && claims.rows.every((r: any) => r.entityType === "claim"));

    const pays = await get("action=claim.pay");
    assert.ok(pays.rows.length > 0 && pays.rows.every((r: any) => r.action === "claim.pay"));

    const one = pays.rows[0].entityId;
    const byRecord = await get(`entityId=${one}`);
    assert.ok(byRecord.rows.length >= 2 && byRecord.rows.every((r: any) => r.entityId === one));

    const search = await get("q=audit%20person");
    assert.ok(search.rows.length >= 1 && search.rows.every((r: any) => /audit person/i.test(r.summary)));
    assert.equal((await get("q=zzz-nothing-matches-this")).total, 0);

    const future = await get("from=2099-01-01T00:00:00Z");
    assert.equal(future.total, 0);
    const past = await get("to=2000-01-01T00:00:00Z");
    assert.equal(past.total, 0);
    const today = await get(`from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`);
    assert.equal(today.total, (await get("")).total);

    assert.equal((await call("GET", "/audit?from=2026-09-01&to=2026-08-01", { token: admin.token })).status, 400);

    const both = await get(`actorId=${med.id}&entityType=request`);
    assert.ok(both.rows.every((r: any) => r.actorId === med.id && r.entityType === "request"));
  });

  it("pages newest first, and offers the filter options", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const p1 = (await call("GET", "/audit?pageSize=5&page=1", { token: admin.token })).body.payLoad;
    const p2 = (await call("GET", "/audit?pageSize=5&page=2", { token: admin.token })).body.payLoad;
    assert.equal(p1.rows.length, 5);
    assert.equal(p1.pages, Math.ceil(p1.total / 5));
    assert.ok(p1.rows.every((r: any) => !p2.rows.some((x: any) => x.id === r.id)));
    const times = p1.rows.map((r: any) => new Date(r.at).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.ok(new Date(p1.rows[4].at) >= new Date(p2.rows[0].at));

    const options = (await call("GET", "/audit/options", { token: admin.token })).body.payLoad;
    assert.ok(options.actors.some((a: any) => a.name === "K. Suleiman"));
    assert.ok(options.actions.includes("claim.approve"));
    assert.ok(options.entityTypes.includes("claim") && options.entityTypes.includes("user"));
  });

  it("never stores passwords, card numbers or hashes", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    await call("POST", "/auth/login", { body: { email: "k.suleiman@alihsan.example", password: "TotallyWrongPassword1" } });
    const all = (await call("GET", "/audit?pageSize=200", { token: admin.token })).body.payLoad.rows;
    const text = JSON.stringify(all);
    assert.ok(!text.includes("TotallyWrongPassword1"));
    assert.ok(!text.includes("Secret123"));
    assert.ok(!text.includes("4111111111111111") && !text.includes("4111 1111"));
    assert.ok(!text.includes("$2a$") && !text.includes("$2b$"));
    const failed = all.find((r: any) => r.action === "auth.login_failed" && /k\.suleiman/.test(r.summary));
    assert.ok(failed);
    assert.ok(all.some((r: any) => r.action === "auth.login_blocked" && /disabled/.test(r.summary))); // the earlier disabled-user test
  });

  it("is only for people with the Audit Log page, and is read-only", async () => {
    assert.equal((await call("GET", "/audit")).status, 401);
    for (const email of ["m.hassan@alihsan.example", "s.bello@alihsan.example", "f.adamu@alihsan.example", "portal@alihsan.example"]) {
      const who = await login(email);
      assert.equal((await call("GET", "/audit", { token: who.token })).status, 403, email);
      assert.equal((await call("GET", "/audit/options", { token: who.token })).status, 403, email);
    }
    const admin = await login("k.suleiman@alihsan.example");

    // It can't be handed to anyone else — not by an administrator, not even for HR.
    const hr = await login("f.adamu@alihsan.example");
    const grant = await call("PUT", `/access/${hr.user.id}`, { token: admin.token, body: { screens: ["hr", "audit"] } });
    assert.equal(grant.status, 400);
    assert.match(grant.body.message ?? "", /administrators only/);
    assert.equal((await call("GET", "/audit", { token: hr.token })).status, 403);
    assert.ok(!(await login("f.adamu@alihsan.example")).user.screens.includes("audit"));
    // and an administrator always keeps it
    assert.ok(admin.user.screens.includes("audit"));
    const stripped = await call("PUT", `/access/${admin.user.id}`, { token: admin.token, body: { screens: ["dashboard"] } });
    assert.ok(stripped.body.payLoad.screens.includes("audit") && stripped.body.payLoad.screens.includes("access"));
    await call("DELETE", `/access/${admin.user.id}`, { token: admin.token });

    const first = (await call("GET", "/audit?pageSize=1", { token: admin.token })).body.payLoad.rows[0];
    for (const method of ["PUT", "PATCH", "DELETE", "POST"]) {
      const res = await call(method, `/audit/${first.id}`, { token: admin.token, body: {} });
      assert.ok([404, 405].includes(res.status), `${method} /audit/:id should not exist`);
    }
    assert.equal((await call("DELETE", "/audit", { token: admin.token })).status, 404);
  });

  it("exports the filtered view as CSV, and the export itself is recorded", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const res = await fetch(`${base}/api/v1/audit?format=csv&entityType=claim`, { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /audit-log.*\.csv/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    assert.ok(text.includes("When (UTC),Who,Role,Action,Area,Record,Details,IP address"));
    assert.ok(text.includes("claim.approve"));
    assert.ok(!text.includes(",user.register,")); // only the claim area was exported
    const log = (await call("GET", "/audit?action=audit.export", { token: admin.token })).body.payLoad;
    assert.ok(log.total >= 1);
    assert.match(log.rows[0].summary, /Exported \d+ audit log entr/);
  });
});

describe("facilities, transactions and the rest of the console", () => {
  it("adds a facility as Pending with generated id and code", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const res = await call("POST", "/facility", { token: admin.token, body: { name: "New Clinic", tier: "Primary", lga: "Zaria" } });
    assert.equal(res.status, 201);
    assert.equal(res.body.payLoad.status, "Pending");
    assert.match(res.body.payLoad.id, /^F\d+$/);
    const desk = await login("s.bello@alihsan.example");
    assert.equal((await call("POST", "/facility", { token: desk.token, body: { name: "x" } })).status, 403);
  });

  it("records a manual transaction and validates it", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const res = await call("POST", "/transaction", { token: admin.token, body: { who: "Someone", amount: 5000, type: "Premium refund" } });
    assert.equal(res.status, 201);
    assert.match(res.body.payLoad.ref, /^MAN-\d{5}$/);
    assert.equal((await call("POST", "/transaction", { token: admin.token, body: { who: "", amount: -1, type: "Premium" } })).status, 400);
  });

  it("serves plans, templates and the dashboard numbers", async () => {
    const admin = await login("k.suleiman@alihsan.example");
    const plans = await call("GET", "/plan", { token: admin.token });
    assert.equal(plans.body.payLoad.length, 3);
    assert.ok(Array.isArray(plans.body.payLoad[0].items[0]));
    const templates = await call("GET", "/notification/templates", { token: admin.token });
    assert.equal(templates.body.payLoad.length, 5);

    const dash = await call("GET", "/analytics/dashboard", { token: admin.token });
    const d = dash.body.payLoad;
    assert.ok(d.enrollees.total >= 9); // 8 KADCHMA + website enrolments
    assert.ok(d.enrollees.viaWebsite >= 1);
    assert.equal(d.enrollees.expiring.length >= 1, true);
    assert.ok(d.review.queueSize >= 1);
    assert.ok(d.codes.approved >= 4);
    assert.ok(d.enrollees.byPlan.some((p: any) => p.plan === "Family Plan"));
  });

  it("lists the sample diagnoses for signed-in users only", async () => {
    assert.equal((await call("GET", "/diagnosis")).status, 401);
    const desk = await login("s.bello@alihsan.example");
    const res = await call("GET", "/diagnosis", { token: desk.token });
    assert.equal(res.status, 200);
    assert.ok(res.body.payLoad.length >= 20);
    assert.ok(res.body.payLoad.some((d: any) => d.name === "Acute appendicitis" && d.category === "Surgical"));
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await call("GET", "/nope");
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
  });
});
