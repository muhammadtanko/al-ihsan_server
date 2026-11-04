// Which console pages a person can open.
//
// A role only supplies the *default* pages. An administrator can then grant or
// revoke any page for any individual (User.accessOverride). This mirrors the
// frontend's Access Control page, and the API enforces it on every route.

export const CONSOLE_ROLES = [
  "administrator",
  "desk-officer",
  "medical-officer",
  "hr-staff",
  "finance-officer",
  "facility",
] as const;
export type ConsoleRole = (typeof CONSOLE_ROLES)[number];

// Same order as the console sidebar (frontend src/console/data/nav.ts).
export const SCREENS = [
  "dashboard",
  "requests",
  "queue",
  "claims",
  "enrollees",
  "facilities",
  "transactions",
  "hr",
  "notifications",
  "facility-portal",
  "investigation-prices",
  "access",
  "approved-claims",
  "audit",
] as const;
export type ScreenId = (typeof SCREENS)[number];

export const ROLE_SCREENS: Record<ConsoleRole, ScreenId[]> = {
  administrator: [...SCREENS],
  "desk-officer": ["requests", "enrollees"],
  "medical-officer": ["queue", "claims"],
  "hr-staff": [],
  "finance-officer": [],
  // Code requests (their own) and claims.
  facility: ["requests", "facility-portal"],
};

export const ROLE_LABEL: Record<ConsoleRole, string> = {
  administrator: "Administrator",
  "desk-officer": "Desk Officer",
  "medical-officer": "Medical Officer",
  "hr-staff": "HR Staff",
  "finance-officer": "Finance Officer",
  facility: "Facility",
};

export const ROLE_DEPT: Partial<Record<ConsoleRole, string>> = {
  administrator: "Operations",
  "medical-officer": "Clinical Review",
  "desk-officer": "Front Desk",
  "hr-staff": "Human Resources",
  "finance-officer": "Finance",
};

const inNavOrder = (screens: Iterable<ScreenId>): ScreenId[] => {
  const set = new Set(screens);
  return SCREENS.filter((s) => set.has(s));
};

export const defaultScreens = (role: ConsoleRole): ScreenId[] => inNavOrder(ROLE_SCREENS[role]);

export function parseOverride(value: unknown): ScreenId[] | null {
  if (!Array.isArray(value)) return null;
  return inNavOrder(value.filter((v): v is ScreenId => SCREENS.includes(v as ScreenId)));
}

// Pages only administrators can ever have: they can't be granted to anyone else in
// Access Control, and an administrator can't be taken off them.
export const ADMIN_ONLY_SCREENS: ScreenId[] = ["audit"];

// Administrators can never lock themselves out of Access Control or the audit log.
export function effectiveScreens(user: { role: string; accessOverride: unknown }): ScreenId[] {
  const role = user.role as ConsoleRole;
  const chosen = parseOverride(user.accessOverride) ?? ROLE_SCREENS[role] ?? [];
  const screens = new Set(chosen);
  if (role === "administrator") {
    screens.add("access");
    ADMIN_ONLY_SCREENS.forEach((s) => screens.add(s));
  } else {
    ADMIN_ONLY_SCREENS.forEach((s) => screens.delete(s)); // even if one was stored earlier
  }
  return inNavOrder(screens);
}
