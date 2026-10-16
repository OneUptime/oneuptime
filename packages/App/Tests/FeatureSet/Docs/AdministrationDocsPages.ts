/*
 * The four pages docs overhaul task 39 added to the Administration section -
 * Inviting People, Project Settings, Billing & Usage and Audit Logs - by the
 * paths their suites name them with, where each sits in the nav, and the
 * words a translation keeps as written or words freely.
 *
 * AdministrationDocsFacts holds the English pages to the Dashboard, the
 * models and the server; AdministrationDocsTranslations holds every
 * translation to its English page. They read the lists from here, never
 * from each other: importing a .test.ts file runs its tests.
 */

export interface AdministrationDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
  // The nav group it is listed in, and the links right before and after it.
  navGroup: string;
  // Null for the first link of its group: the category's own address opens it.
  after: string | null;
  before: string;
}

export const INVITING_PEOPLE: string = "permissions/inviting-people";
export const PROJECT_SETTINGS: string = "configuration/project-settings";
export const BILLING: string = "configuration/billing";
export const AUDIT_LOGS: string = "configuration/audit-logs";

/*
 * Where a reader meets each page in the Administration section:
 *
 *   - Inviting People right after Users, Teams & Permissions, which explains
 *     what the team an invitation names lets someone do, and before the
 *     Permission Reference;
 *   - Project Settings first in Configuration: it maps every page of
 *     Project Settings, so /docs/configuration opens on it (the category's
 *     own address opens its first page);
 *   - Billing & Usage and Audit Logs right after it, the two sections of
 *     Project Settings that have a page of their own here, before the
 *     reference pages (IP Addresses, the label rules) that were there first.
 */
export const ADMINISTRATION_PAGES: ReadonlyArray<AdministrationDocsPageEntry> =
  [
    {
      page: INVITING_PEOPLE,
      navTitle: "Inviting People",
      navGroup: "Users & Permissions",
      after: "Users, Teams & Permissions",
      before: "Permission Reference",
    },
    {
      page: PROJECT_SETTINGS,
      navTitle: "Project Settings",
      navGroup: "Configuration",
      after: null,
      before: "Billing & Usage",
    },
    {
      page: BILLING,
      navTitle: "Billing & Usage",
      navGroup: "Configuration",
      after: "Project Settings",
      before: "Audit Logs",
    },
    {
      page: AUDIT_LOGS,
      navTitle: "Audit Logs",
      navGroup: "Configuration",
      after: "Billing & Usage",
      before: "IP Addresses",
    },
  ];

/*
 * Bold words every language writes as the English does, by page: what the
 * product shows in English in every language. The row menu's "⋯", the
 * buttons of the invitation email (emails are written in English), and the
 * Enterprise Edition's audit log settings button, which no Dashboard locale
 * words. AdministrationDocsFacts holds that they are still not keys of the
 * Dashboard's English locale.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [INVITING_PEOPLE]: ["Create Your Account", "Sign In to OneUptime", "⋯"],
    [BILLING]: ["⋯"],
    [AUDIT_LOGS]: ["Edit Audit Log Settings"],
  };

/*
 * Bold words that are the title of a permission or a role, by page. The
 * Dashboard draws those titles as they are in every language (its
 * permission picker and its role cards draw a permission's own title), so
 * every language writes them in English too - even where the same words
 * are a button somewhere else ("Create Payment Method", "Edit Invoices").
 * AdministrationDocsFacts holds each one to the permission it names.
 */
export const PERMISSION_TITLES: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [INVITING_PEOPLE]: ["Invite New Members"],
  [PROJECT_SETTINGS]: ["Billing Admin", "Manage Billing"],
  [BILLING]: [
    "Manage Billing",
    "Billing Admin",
    "Billing Member",
    "Billing Viewer",
    "Read Invoices",
    "Create Payment Method",
    "Edit Invoices",
  ],
  [AUDIT_LOGS]: ["Read Audit Log"],
};

/*
 * Bold words that are a list item's lead, not a label of the Dashboard: a
 * translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [INVITING_PEOPLE]: [
    "Their team decides what they can do.",
    "Nothing is granted until they accept.",
    "One acceptance covers the project.",
    "A role that invites people.",
    "On OneUptime Cloud, room in your plan.",
    "No SCIM Push Groups.",
    "Single sign-on.",
    "SCIM.",
    "The Admin Dashboard.",
  ],
  [PROJECT_SETTINGS]: [
    "A role that changes the project.",
    "On OneUptime Cloud, the plan that includes a setting.",
  ],
  [BILLING]: ["OneUptime Cloud.", "A role that reads billing."],
  [AUDIT_LOGS]: [
    "It starts off.",
    "It records what people do.",
    "Entries cannot be changed.",
    "On OneUptime Cloud, the Enterprise plan.",
    "When you self-host, the Enterprise Edition",
    "A role that reads the audit log.",
    "On OneUptime Cloud",
    "When you self-host",
  ],
};

// The kind of diagram each page draws: each reads top to bottom, to fit the column.
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [INVITING_PEOPLE]: "flowchart TB",
  [PROJECT_SETTINGS]: "flowchart TB",
  [BILLING]: "flowchart TB",
  [AUDIT_LOGS]: "flowchart TB",
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, editions, plans, marketplaces and protocols. A line made of them
 * alone is not a line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime AI",
  "OneUptime",
  "Admin Dashboard",
  "Enterprise Edition",
  "AWS Marketplace",
  "Microsoft Marketplace",
  "Google Cloud Marketplace",
  "Microsoft Teams",
  "Slack",
  "Twilio",
  "Terraform",
  "WhatsApp",
  "Telegram",
  "SCIM Push Groups",
  "SCIM",
  "SSO",
  "OIDC",
  "MCP",
  "SMTP",
  "LLM",
  "API",
  "CLI",
  "PDF",
  "VAT",
  "iOS",
  "Android",
  "Growth",
  "Scale",
  "Enterprise",
  "Free",
  "Project Owner",
  "Project Admin",
  "Settings Admin",
];

/*
 * The project's permissions a page's "Who can do what" table names, row by
 * row, as the English Billing & Usage page writes them: each row's bold
 * names and plain role names, in the page's order. AdministrationDocsFacts
 * holds each row to the list the server checks.
 */
export const BILLING_ACCESS_ROWS: ReadonlyArray<string> = [
  "Read the billing pages: the plan, invoices, usage, balances and payment methods",
  "Download an invoice",
  "Change the billing address and invoice email",
  "Turn SMS, calls, WhatsApp or Telegram on or off",
  "Add a payment method",
  "Pay an invoice",
  "Change the plan, recharge a balance or change Auto Recharge",
];
