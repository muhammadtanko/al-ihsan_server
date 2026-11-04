// Seeds the database with the demo data the console was prototyped against, the
// real KADCHMA tariff, and one login per demo persona.
//
//   npm run db:seed
//
// It wipes and re-creates everything, so it refuses to run in production
// unless SEED_FORCE=1.

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import pricing from "./data/kadchma_pricing_structure.json";
import { diagnosisGroups } from "./data/diagnoses";

dotenv.config();
const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? "Console123!";

// "Aug 1, 08:41" / "Jan 12, 2026" -> Date (demo data lives in 2026).
function at(text: string): Date {
  const hasYear = /\d{4}/.test(text);
  const [datePart, timePart] = text.split(/,\s(?=\d{1,2}:\d{2})/);
  const date = hasYear ? datePart : `${datePart}, 2026`;
  return new Date(`${date}${timePart ? ` ${timePart}` : ""}`);
}

const facilities = [
  { id: "F1", code: "FAC-0113", name: "Ummah Mamuda Memorial Hospital", tier: "Secondary", lga: "Central LGA", phone: "0803 214 5501", services: "General medicine, surgery, maternity", status: "Accredited" },
  { id: "F2", code: "FAC-0087", name: "General Hospital North", tier: "Secondary", lga: "North LGA", phone: "0805 991 2270", services: "General medicine, paediatrics", status: "Accredited" },
  { id: "F3", code: "FAC-0031", name: "City Clinic Central", tier: "Primary", lga: "Central LGA", phone: "0812 400 7738", services: "Outpatient, antenatal, laboratory", status: "Accredited" },
  { id: "F4", code: "FAC-0155", name: "Crescent Specialist Hospital", tier: "Tertiary", lga: "South LGA", phone: "0809 330 1184", services: "Surgery, radiology, ICU", status: "Accredited" },
  { id: "F5", code: "FAC-0162", name: "Community Health Centre East", tier: "Primary", lga: "East LGA", phone: "0816 772 9045", services: "Outpatient, immunisation", status: "Pending" },
  { id: "F6", code: "FAC-0009", name: "Federal Teaching Hospital", tier: "Tertiary", lga: "North LGA", phone: "0802 118 6633", services: "All specialties, referral centre", status: "Accredited" },
];

// Facilities offered on the public enrollment page.
const enrollmentFacilities: [name: string, address: string, lga: string, ward: string, secondary: boolean][] = [
  ["Barau Dikko Teaching Hospital", "Independence Way, Kawo", "Kaduna North", "Kawo", true],
  ["Yusuf Dantsoho Memorial Hospital", "Sokoto Road, Tudun Wada", "Kaduna South", "Tudun Wada", true],
  ["St. Gerard's Catholic Hospital", "Ahmadu Bello Way", "Kaduna North", "Badarawa", false],
  ["General Hospital, Zaria", "Hospital Road", "Zaria", "Tudun Wada", true],
  ["Ahmadu Bello University Teaching Hospital", "Shika Road", "Giwa", "Shika", true],
  ["General Hospital, Kachia", "Kaduna Road", "Kachia", "Kachia Central", false],
  ["Primary Health Centre, Chikun", "Sabon Tasha Junction", "Chikun", "Sabon Tasha", false],
  ["General Hospital, Sabon Gari", "Samaru Road", "Sabon Gari", "Samaru", true],
  ["Comprehensive Health Centre, Jema'a", "Kafanchan Road", "Jema'a", "Kafanchan", false],
  ["General Hospital, Kagarko", "Katugal Road", "Kagarko", "Katugal", false],
  ["Primary Health Centre, Igabi", "Turunku Road", "Igabi", "Turunku", false],
  ["General Hospital, Makarfi", "Zaria Road", "Makarfi", "Makarfi Central", true],
];

const plans = [
  { id: "P1", partner: "KADCHMA State Scheme", name: "Formal Sector Standard", premium: 12000, items: [["GP consultation", 1500], ["Malaria treatment (uncomplicated)", 3200], ["Antenatal visit", 2500], ["Normal delivery", 18000], ["Caesarean section (emergency)", 85000], ["Appendectomy", 95000], ["Laboratory — full blood count", 2000]] },
  { id: "P2", partner: "KADCHMA State Scheme", name: "Informal Sector Basic", premium: 8500, items: [["GP consultation", 1200], ["Malaria treatment (uncomplicated)", 3200], ["Antenatal visit", 2000], ["Normal delivery", 15000], ["Caesarean section (emergency)", 85000], ["Laboratory — full blood count", 2000]] },
  { id: "P3", partner: "Institutional Partners", name: "Corporate Plus", premium: 25000, items: [["GP consultation", 2500], ["Specialist consultation", 6000], ["Caesarean section", 185000], ["Appendectomy", 110000], ["MRI scan (single region)", 48000], ["Physiotherapy session", 4500]] },
] as const;

const healthPlans = [
  {
    id: "individual", name: "Individual Plan", price: 10650, priceLabel: "₦10,650/year", sortOrder: 1,
    description: "Essential cover for one person — consultations, basic diagnostics and emergency care.",
    benefits: ["Outpatient consultations", "Basic laboratory tests", "Emergency care", "Prescribed medications (generic)", "Access to accredited primary facilities"],
  },
  {
    id: "family", name: "Family Plan", price: 57990, priceLabel: "₦57,990/year", sortOrder: 2,
    description: "Comprehensive coverage for you and your dependents across our accredited network.",
    benefits: ["Everything in the Individual Plan", "Covers spouse and up to 4 children", "Antenatal and delivery care", "Specialist consultations", "Minor surgeries"],
  },
];

// Policy dates are relative to the day you seed, so there is always someone about to expire
// (an enrollee's status follows their expiry date — see src/utils/enrollee-status.ts).
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);
const enrollees = [
  { id: "E1", name: "Hauwa Ibrahim", kad: "KAD-104-2271", phone: "0803 555 0114", planId: "P1", status: "Active", enrolledAt: daysFromNow(-120), expiresAt: daysFromNow(245) },
  { id: "E2", name: "Daniel Okoro", kad: "KAD-104-2519", phone: "0805 555 0921", planId: "P3", status: "Active", enrolledAt: daysFromNow(-90), expiresAt: daysFromNow(275) },
  { id: "E3", name: "Amina Sadiq", kad: "KAD-102-1187", phone: "0812 555 3307", planId: "P2", status: "Active", enrolledAt: daysFromNow(-353), expiresAt: daysFromNow(12) }, // expiring soon
  { id: "E4", name: "Peter Audu", kad: "KAD-101-0934", phone: "0809 555 7742", planId: "P1", status: "Active", enrolledAt: daysFromNow(-60), expiresAt: daysFromNow(305) },
  { id: "E5", name: "Zainab Lawal", kad: "KAD-103-3310", phone: "0816 555 2280", planId: "P2", status: "Pending Payment", enrolledAt: null, expiresAt: null },
  { id: "E6", name: "Grace Danjuma", kad: "KAD-100-0451", phone: "0802 555 6614", planId: "P1", status: "Active", enrolledAt: daysFromNow(-385), expiresAt: daysFromNow(-20) }, // lapsed
  { id: "E7", name: "Musa Garba", kad: "KAD-105-4402", phone: "0808 555 1190", planId: "P2", status: "Active", enrolledAt: daysFromNow(-100), expiresAt: daysFromNow(265) },
  { id: "E8", name: "Blessing Eze", kad: "KAD-104-2903", phone: "0813 555 8845", planId: "P3", status: "Active", enrolledAt: daysFromNow(-95), expiresAt: daysFromNow(270) },
];

type Req = { id: string; name: string; kad: string; phone: string; dx: string; proc: string; planId: string; ref: string; recv: string; status: string; code: string | null; reason: string | null; createdBy: string; createdAt: string; reviewedBy: string | null; reviewedAt: string | null; sent: string };
const requests: Req[] = [
  { id: "CR-1023", name: "Sarah Musa", kad: "KAD-108-7719", phone: "0810 555 4471", dx: "Threatened abortion, 14 weeks", proc: "Obstetric ultrasound + admission", planId: "P1", ref: "F5", recv: "F1", status: "Pending", code: null, reason: null, createdBy: "S. Bello (Desk Officer)", createdAt: "Aug 1, 08:41", reviewedBy: null, reviewedAt: null, sent: "Not sent" },
  { id: "CR-1022", name: "Peter Audu", kad: "KAD-101-0934", phone: "0809 555 7742", dx: "Suspected typhoid fever", proc: "Widal test + blood culture", planId: "P1", ref: "F3", recv: "F2", status: "Pending", code: null, reason: null, createdBy: "R. Adeyemi (Desk Officer)", createdAt: "Aug 1, 08:05", reviewedBy: null, reviewedAt: null, sent: "Not sent" },
  { id: "CR-1021", name: "Blessing Eze", kad: "KAD-104-2903", phone: "0813 555 8845", dx: "Right inguinal hernia", proc: "Herniorrhaphy", planId: "P3", ref: "F3", recv: "F4", status: "Under Review", code: null, reason: null, createdBy: "S. Bello (Desk Officer)", createdAt: "Jul 31, 16:20", reviewedBy: "Dr. M. Hassan", reviewedAt: null, sent: "Not sent" },
  { id: "CR-1020", name: "Musa Garba", kad: "KAD-105-4402", phone: "0808 555 1190", dx: "Severe malaria with anaemia", proc: "Admission + IV artesunate", planId: "P2", ref: "F5", recv: "F2", status: "Approved", code: "000468", reason: null, createdBy: "R. Adeyemi (Desk Officer)", createdAt: "Jul 31, 11:52", reviewedBy: "Dr. L. Yusuf", reviewedAt: "Jul 31, 13:10", sent: "Not sent" },
  { id: "CR-1019", name: "Ibrahim Kalu", kad: "KAD-099-8817", phone: "0806 555 3358", dx: "Chronic lower back pain", proc: "MRI scan (lumbar spine)", planId: "P2", ref: "F3", recv: "F6", status: "Rejected", code: null, reason: "Requested investigation is not covered under Informal Sector Basic; refer for physiotherapy assessment first.", createdBy: "S. Bello (Desk Officer)", createdAt: "Jul 29, 10:33", reviewedBy: "Dr. M. Hassan", reviewedAt: "Jul 29, 12:05", sent: "Sent — manual" },
  { id: "CR-1018", name: "Amina Sadiq", kad: "KAD-102-1187", phone: "0812 555 3307", dx: "Prolonged obstructed labour", proc: "Emergency caesarean section", planId: "P2", ref: "F5", recv: "F4", status: "Approved", code: "000467", reason: null, createdBy: "R. Adeyemi (Desk Officer)", createdAt: "Jul 28, 04:18", reviewedBy: "Dr. M. Hassan", reviewedAt: "Jul 28, 04:41", sent: "Sent — manual" },
  { id: "CR-1017", name: "Hauwa Ibrahim", kad: "KAD-104-2271", phone: "0803 555 0114", dx: "Acute appendicitis", proc: "Appendectomy", planId: "P1", ref: "F3", recv: "F1", status: "Approved", code: "000466", reason: null, createdBy: "S. Bello (Desk Officer)", createdAt: "Jul 26, 09:14", reviewedBy: "Dr. M. Hassan", reviewedAt: "Jul 26, 10:02", sent: "Sent — manual" },
];

type Clm = { id: string; name: string; kad: string; fac: string; dx: string; amount: number; linked: string; status: string; reason: string | null; docs: [string, string][]; submittedBy: string; date: string; reviewedBy: string | null; reviewedAt: string | null };
const claims: Clm[] = [
  { id: "CL-3006", name: "Grace Danjuma", kad: "KAD-100-0451", fac: "F3", dx: "Antenatal registration visit", amount: 9600, linked: "—", status: "Submitted", reason: null, docs: [["anc-visit-bill.pdf", "184 KB"]], submittedBy: "City Clinic Central (desk relay)", date: "Aug 1, 09:02", reviewedBy: null, reviewedAt: null },
  { id: "CL-3004", name: "Musa Garba", kad: "KAD-105-4402", fac: "F2", dx: "Malaria admission — 4 nights", amount: 28400, linked: "CR-1020 / 000468", status: "Submitted", reason: null, docs: [["admission-notes.pdf", "412 KB"], ["itemised-bill.pdf", "96 KB"]], submittedBy: "General Hospital North (desk relay)", date: "Aug 1, 08:20", reviewedBy: null, reviewedAt: null },
  { id: "CL-3003", name: "Daniel Okoro", kad: "KAD-104-2519", fac: "F6", dx: "Specialist consultation + MRI (single region)", amount: 54000, linked: "—", status: "Under Review", reason: null, docs: [["referral-letter.pdf", "220 KB"], ["mri-report.pdf", "1.2 MB"]], submittedBy: "Federal Teaching Hospital (desk relay)", date: "Jul 31, 15:44", reviewedBy: "Dr. L. Yusuf", reviewedAt: null },
  { id: "CL-3002", name: "Amina Sadiq", kad: "KAD-102-1187", fac: "F4", dx: "Emergency caesarean section", amount: 85000, linked: "CR-1018 / 000467", status: "Approved", reason: null, docs: [["theatre-notes.pdf", "540 KB"], ["itemised-bill.pdf", "112 KB"]], submittedBy: "Crescent Specialist Hospital (desk relay)", date: "Jul 30, 10:15", reviewedBy: "Dr. M. Hassan", reviewedAt: "Jul 31, 09:30" },
  { id: "CL-3005", name: "Ibrahim Kalu", kad: "KAD-099-8817", fac: "F6", dx: "MRI scan (lumbar spine)", amount: 48000, linked: "—", status: "Rejected", reason: "No matching authorisation code; service not covered under enrollee plan.", docs: [["mri-invoice.pdf", "88 KB"]], submittedBy: "Federal Teaching Hospital (desk relay)", date: "Jul 30, 09:50", reviewedBy: "Dr. M. Hassan", reviewedAt: "Jul 30, 14:22" },
  { id: "CL-3001", name: "Hauwa Ibrahim", kad: "KAD-104-2271", fac: "F1", dx: "Appendectomy — post-operative", amount: 95000, linked: "CR-1017 / 000466", status: "Paid", reason: null, docs: [["discharge-summary.pdf", "310 KB"], ["itemised-bill.pdf", "104 KB"]], submittedBy: "Ummah Mamuda Memorial (desk relay)", date: "Jul 29, 12:40", reviewedBy: "Dr. M. Hassan", reviewedAt: "Jul 29, 16:05" },
];

const transactions = [
  { ref: "PSK-88213", who: "Zainab Lawal", type: "Premium", amount: 8500, status: "Pending", date: "Aug 1, 2026" },
  { ref: "PSK-88104", who: "Blessing Eze", type: "Premium", amount: 25000, status: "Confirmed", date: "Jul 30, 2026" },
  { ref: "RMT-40911", who: "Ummah Mamuda Memorial (CL-3001)", type: "Facility payment", amount: 95000, status: "Confirmed", date: "Jul 30, 2026" },
  { ref: "PSK-87990", who: "Hauwa Ibrahim", type: "Premium", amount: 12000, status: "Confirmed", date: "Jul 28, 2026" },
  { ref: "PSK-87781", who: "Musa Garba", type: "Premium", amount: 8500, status: "Confirmed", date: "Jul 25, 2026" },
  { ref: "PSK-87615", who: "Daniel Okoro", type: "Premium", amount: 25000, status: "Confirmed", date: "Jul 22, 2026" },
  { ref: "PSK-87433", who: "Grace Danjuma", type: "Premium", amount: 12000, status: "Failed", date: "Jul 20, 2026" },
];

const users = [
  { id: "ST-01", name: "K. Suleiman", email: "k.suleiman@alihsan.example", role: "administrator", title: "Administrator", dept: "Operations", status: "Active" },
  { id: "ST-02", name: "Dr. M. Hassan", email: "m.hassan@alihsan.example", role: "medical-officer", title: "Medical Officer", dept: "Clinical Review", status: "Active" },
  { id: "ST-03", name: "Dr. L. Yusuf", email: "l.yusuf@alihsan.example", role: "medical-officer", title: "Medical Officer", dept: "Clinical Review", status: "Active" },
  { id: "ST-04", name: "S. Bello", email: "s.bello@alihsan.example", role: "desk-officer", title: "Desk Officer", dept: "Front Desk", status: "Active" },
  { id: "ST-05", name: "R. Adeyemi", email: "r.adeyemi@alihsan.example", role: "desk-officer", title: "Desk Officer", dept: "Front Desk", status: "Active" },
  { id: "ST-06", name: "F. Adamu", email: "f.adamu@alihsan.example", role: "hr-staff", title: "HR Staff", dept: "Human Resources", status: "Active" },
  { id: "ST-07", name: "J. Obi", email: "j.obi@alihsan.example", role: "finance-officer", title: "Finance Officer", dept: "Finance", status: "On leave" },
  { id: "FA-01", name: "Ummah Mamuda Memorial Hospital", email: "portal@alihsan.example", role: "facility", title: "Facility — claims portal", dept: "Ummah Mamuda Memorial Hospital", status: "Active", facilityId: "F1" },
];

const templates = [
  { name: "Policy activated", channel: "Email", event: "policy.activated", body: "Dear {first_name}, your {plan_name} policy is now active until {expiry_date}." },
  { name: "Policy expiring — 30 days", channel: "Email", event: "policy.expiring", body: "Dear {first_name}, your policy expires on {expiry_date}. Renew to stay covered." },
  { name: "Payment confirmed", channel: "Email", event: "payment.confirmed", body: "We received N{amount} for {plan_name}. Reference {gateway_ref}." },
  { name: "Code approved", channel: "WhatsApp", event: "code.approved", body: "{scheme} {tpa}/{receiving_facility}/{code_number}/{decision}" },
  { name: "Code rejected", channel: "WhatsApp", event: "code.rejected", body: "Request for {enrollee_name} ({enrollee_no}) declined: {reason}" },
];

const deliveries = [
  { time: "Jul 31, 17:05", to: "Musa Garba", channel: "Email", template: "Payment confirmed", status: "Delivered" },
  { time: "Jul 30, 11:20", to: "Blessing Eze", channel: "Email", template: "Policy activated", status: "Delivered" },
  { time: "Jul 30, 09:41", to: "Zainab Lawal", channel: "Email", template: "Payment confirmed", status: "Queued" },
  { time: "Jul 29, 12:10", to: "0803 214 5501 (facility)", channel: "WhatsApp", template: "Code rejected", status: "Sent — manual" },
  { time: "Jul 28, 08:00", to: "Amina Sadiq", channel: "Email", template: "Policy expiring — 30 days", status: "Sent" },
  { time: "Jul 20, 14:30", to: "Grace Danjuma", channel: "Email", template: "Policy activated", status: "Failed" },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "1") {
    throw new Error("Refusing to wipe and seed a production database. Set SEED_FORCE=1 to override.");
  }
  if (process.env.NODE_ENV === "test" && !/_test(\?|$)/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("NODE_ENV=test only seeds a database whose name ends in _test.");
  }
  console.log("Seeding database…");

  // Wipe in dependency order.
  await prisma.claimDocument.deleteMany();
  await prisma.claimInvestigation.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.codeRequest.deleteMany();
  await prisma.transaction.deleteMany(); // before enrollees: payments point at them
  await prisma.enrollee.deleteMany();
  await prisma.planBenefit.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.healthPlan.deleteMany();
  await prisma.user.deleteMany();
  await prisma.facility.deleteMany();
  await prisma.investigation.deleteMany();
  await prisma.diagnosis.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.messageTemplate.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.auditLog.deleteMany();

  await prisma.facility.createMany({ data: facilities });
  await prisma.facility.createMany({
    data: enrollmentFacilities.map(([name, address, lga, ward, secondary], i) => ({
      id: `F${7 + i}`,
      code: `FAC-${String(201 + i).padStart(4, "0")}`,
      name,
      address,
      lga,
      ward,
      tier: secondary ? "Secondary" : "Primary",
      primaryCare: true,
      secondaryCare: secondary,
      status: "Accredited",
      enrollmentListed: true,
    })),
  });

  for (const p of plans) {
    await prisma.plan.create({
      data: {
        id: p.id,
        partner: p.partner,
        name: p.name,
        premium: p.premium,
        benefits: { create: p.items.map(([name, tariff]) => ({ name, tariff })) },
      },
    });
  }
  await prisma.healthPlan.createMany({ data: healthPlans });

  await prisma.enrollee.createMany({ data: enrollees.map((e) => ({ ...e, source: "KADCHMA" })) });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await prisma.user.createMany({ data: users.map((u) => ({ ...u, passwordHash })) });

  // Demo requests name who recorded and who decided them; link those names to the accounts.
  const userIdByName = new Map(users.map((u) => [u.name, u.id]));
  await prisma.codeRequest.createMany({
    data: requests.map(({ ref, recv, createdAt, reviewedAt, ...r }) => ({
      ...r,
      createdById: userIdByName.get(r.createdBy.replace(/ \(.*\)$/, "")) ?? null,
      reviewedById: r.reviewedBy ? (userIdByName.get(r.reviewedBy) ?? null) : null,
      // Picked up some way between being recorded and decided (demo data has no real start time).
      reviewStartedAt: r.reviewedBy && reviewedAt ? new Date(at(createdAt).getTime() + (at(reviewedAt).getTime() - at(createdAt).getTime()) * 0.4) : null,
      refFacilityId: ref,
      recvFacilityId: recv,
      createdAt: at(createdAt),
      reviewedAt: reviewedAt ? at(reviewedAt) : null,
    })),
  });

  for (const c of claims) {
    await prisma.claim.create({
      data: {
        id: c.id,
        name: c.name,
        kad: c.kad,
        facilityId: c.fac,
        dx: c.dx,
        amount: c.amount,
        linked: c.linked,
        status: c.status,
        reason: c.reason,
        submittedBy: c.submittedBy,
        reviewedBy: c.reviewedBy,
        reviewedById: c.reviewedBy ? (userIdByName.get(c.reviewedBy) ?? null) : null,
        reviewStartedAt: c.reviewedBy && c.reviewedAt ? new Date(at(c.date).getTime() + (at(c.reviewedAt).getTime() - at(c.date).getTime()) * 0.4) : null,
        createdAt: at(c.date),
        reviewedAt: c.reviewedAt ? at(c.reviewedAt) : null,
        docs: { create: c.docs.map(([file, size]) => ({ file, size })) },
      },
    });
  }

  await prisma.investigation.createMany({
    data: pricing.categories.flatMap((category, ci) =>
      category.items.map((item, ii) => ({
        id: `INV-${ci + 1}-${ii + 1}`,
        category: category.name,
        service: item.service,
        baseline: item.baseline,
        approved: item.approved,
        sortOrder: ci * 100 + ii,
      })),
    ),
  });

  await prisma.diagnosis.createMany({
    data: diagnosisGroups.flatMap(([category, names], ci) =>
      names.map((name, ni) => ({ id: `DX-${String(ci * 20 + ni + 1).padStart(2, "0")}`, category, name, sortOrder: ci * 100 + ni })),
    ),
  });

  // Premium payments are linked to the enrollee they belong to.
  const enrolleeByName = new Map(enrollees.map((e) => [e.name, e.id]));
  await prisma.transaction.createMany({
    data: transactions.map((t) => ({ ...t, date: at(t.date), enrolleeId: t.type === "Premium" ? (enrolleeByName.get(t.who) ?? null) : null })),
  });
  await prisma.messageTemplate.createMany({ data: templates });
  await prisma.delivery.createMany({ data: deliveries.map((d) => ({ ...d, time: at(d.time) })) });

  await prisma.counter.createMany({
    data: [
      { key: "ST", value: 7 },
      { key: "FA", value: 1 },
      { key: "F", value: 6 + enrollmentFacilities.length },
      { key: "CR", value: 1023 },
      { key: "CL", value: 3006 },
      { key: "code", value: 468 },
    ],
  });

  console.log(`Done. ${users.length} login accounts created with password "${PASSWORD}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
