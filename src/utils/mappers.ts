// Database rows -> the JSON the API returns. Passwords never leave this file's reach.
import type {
  Claim,
  ClaimDocument,
  ClaimInvestigation,
  CodeRequest,
  Delivery,
  Enrollee,
  Facility,
  HealthPlan,
  Investigation,
  MessageTemplate,
  Plan,
  PlanBenefit,
  Transaction,
  User,
} from "@prisma/client";
import { enrolleeStatus } from "./enrollee-status";
import { defaultScreens, effectiveScreens, parseOverride, type ConsoleRole } from "./access";

export const facilityDto = (f: Facility) => ({
  id: f.id,
  code: f.code,
  name: f.name,
  tier: f.tier,
  lga: f.lga,
  phone: f.phone,
  services: f.services,
  status: f.status,
  address: f.address,
  ward: f.ward,
  primaryCare: f.primaryCare,
  secondaryCare: f.secondaryCare,
});

export const planDto = (p: Plan & { benefits: PlanBenefit[] }) => ({
  id: p.id,
  partner: p.partner,
  name: p.name,
  premium: p.premium,
  items: p.benefits.map((b) => [b.name, b.tariff] as [string, number]),
});

export const healthPlanDto = (p: HealthPlan) => ({
  id: p.id,
  name: p.name,
  price: p.price,
  priceLabel: p.priceLabel,
  description: p.description,
  benefits: p.benefits,
});

export type EnrolleeRow = Enrollee & {
  plan: (Plan & { benefits?: PlanBenefit[] }) | null;
  healthPlan: HealthPlan | null;
  facility: Facility | null;
};

// One shape for everyone enrolled — `source` says where they came from. Fields the
// source doesn't collect are null (KADCHMA entries have no address, next of kin, etc.).
export const enrolleeDto = (e: EnrolleeRow) => ({
  id: e.id,
  source: e.source as "KADCHMA" | "Website",
  name: e.name,
  firstName: e.firstName,
  middleName: e.middleName,
  lastName: e.lastName,
  kad: e.kad,
  enrollmentNumber: e.enrollmentNumber,
  phone: e.phone,
  email: e.email,
  address: e.address,
  lga: e.lga,
  dateOfBirth: e.dateOfBirth,
  gender: e.gender,
  maritalStatus: e.maritalStatus,
  kinName: e.kinName,
  kinRelationship: e.kinRelationship,
  kinPhone: e.kinPhone,
  // The plan they hold: a KADCHMA plan, or one of the website's plans.
  planId: e.planId,
  healthPlanId: e.healthPlanId,
  planName: e.plan?.name ?? e.healthPlan?.name ?? "—",
  planPartner: e.plan?.partner ?? (e.healthPlan ? "Website enrollment" : "—"),
  planPrice: e.plan ? `₦${e.plan.premium.toLocaleString("en-NG")} / yr` : (e.healthPlan?.priceLabel ?? "—"),
  facilityId: e.facilityId,
  facilityName: e.facility?.name ?? null,
  facilityAddress: e.facility ? [e.facility.address, e.facility.ward, e.facility.lga].filter(Boolean).join(", ") : null,
  status: enrolleeStatus(e),
  enrolledAt: e.enrolledAt,
  expiresAt: e.expiresAt,
  paymentMethod: e.paymentMethod as "card" | "transfer" | null,
  amount: e.amount,
  paymentRef: e.paymentRef,
  createdAt: e.createdAt,
});

export const requestDto = (r: CodeRequest) => ({
  id: r.id,
  name: r.name,
  kad: r.kad,
  phone: r.phone,
  dx: r.dx,
  proc: r.proc,
  planId: r.planId,
  refId: r.refFacilityId,
  recvId: r.recvFacilityId,
  status: r.status,
  code: r.code,
  reason: r.reason,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  reviewedBy: r.reviewedBy,
  reviewedAt: r.reviewedAt,
  sent: r.sent,
});

export const claimDto = (c: Claim & { investigations: ClaimInvestigation[]; docs: ClaimDocument[] }) => ({
  id: c.id,
  name: c.name,
  kad: c.kad,
  facId: c.facilityId,
  dx: c.dx,
  amount: c.amount,
  linked: c.linked,
  status: c.status,
  reason: c.reason,
  submittedBy: c.submittedBy,
  date: c.createdAt,
  reviewedBy: c.reviewedBy,
  reviewedAt: c.reviewedAt,
  docs: c.docs.map((d) => ({
    id: d.id,
    file: d.file,
    size: d.size,
    kind: d.kind,
    uploadedBy: d.uploadedBy,
    uploadedAt: d.uploadedAt,
    downloadable: !!d.storedName,
  })),
  investigations: [...c.investigations]
    .sort((a, b) => a.position - b.position)
    .map((i) => ({ id: i.id, investigationId: i.investigationId, name: i.name, amount: i.amount })),
});

export const userDto = (u: User) => {
  const role = u.role as ConsoleRole;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role,
    title: u.title,
    dept: u.dept,
    status: u.status,
    facilityId: u.facilityId,
    accessOverride: parseOverride(u.accessOverride),
    defaultScreens: defaultScreens(role),
    screens: effectiveScreens(u),
  };
};

export const investigationDto = (i: Investigation) => ({
  id: i.id,
  category: i.category,
  service: i.service,
  baseline: i.baseline,
  approved: i.approved,
});

export const transactionDto = (t: Transaction) => ({
  ref: t.ref,
  who: t.who,
  type: t.type,
  amount: t.amount,
  status: t.status,
  date: t.date,
});

export const templateDto = (t: MessageTemplate) => ({
  name: t.name,
  ch: t.channel,
  event: t.event,
  body: t.body,
});

export const deliveryDto = (d: Delivery) => ({
  time: d.time,
  to: d.to,
  ch: d.channel,
  tmpl: d.template,
  status: d.status,
});
