import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsHeading,
  DocsLink,
  ScannedPage,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  dashboardLocale,
  drawnActionLabel,
  isActionLabel,
} from "./DocsDashboardLabels";
import {
  CARD_LINE,
  anchorProblems,
  boldSpans,
  cardLines,
  cardTargets,
  comparableFence,
  diagramSkeleton,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 13: the Permission Reference, SSO, Global SSO, SCIM and
 * IP Addresses pages, in every docs language. Each translation says what the
 * English page says - the same sections, steps, tables, lists, cards, code
 * and diagrams, links that land on the heading the English link means, a
 * title that is the nav link's - and names each screen the way the screen
 * the reader is on draws it in their language.
 *
 * These pages name four products, so "the way it is drawn" has four sources:
 *
 *   - The Dashboard (project settings, SSO/OIDC/SCIM pages, a team's
 *     permissions): a bold label is drawnActionLabel (DocsDashboardLabels),
 *     Persian included.
 *   - The Admin Dashboard, where a master admin sets up global providers and
 *     the instance-wide Require SSO for Login: it looks a label up whole in
 *     its own locale (AdminDashboard/src/Locales, nested keys off) and shows
 *     the English where that locale has no wording, which is most of the
 *     global provider screens (ADMIN_LABELS). Its side menu and top bar use
 *     keys of their own (ADMIN_KEYS).
 *   - The sign-in pages (Accounts): "Login with SSO" is the Accounts
 *     locale's sso.title, and "Admin Settings" in the user menu is the
 *     Dashboard's userProfile.adminSettings.
 *   - The docs themselves: the permission tables' column names and values
 *     come from the docs locale's ui.permissions* strings (DOCS_CHROME), so
 *     the page names them as the generated tables do.
 *
 * Other things stay in English on purpose: an identity provider's own
 * console (Keycloak, Microsoft Entra ID, Okta), whose language OneUptime
 * cannot know (IDENTITY_PROVIDER_LABELS); plans, roles and permission names,
 * which the API, Terraform and the role pickers name in English; text the
 * product writes in English whatever the language - the sign-in pages'
 * messages, the SCIM dialog's field names, the docs' empty IP list
 * (KEPT_IN_ENGLISH, SERVER_MESSAGES). Bold words that are Dashboard labels
 * only by coincidence are PROSE; the pages' own bold leads are PROSE_LEADS.
 * A new bold word on these English pages fails "know every bold word" until
 * it is put in one of the lists.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");

interface TranslatedPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

const REFERENCE: string = "permissions/reference";
const SSO: string = "identity/sso";
const GLOBAL_SSO: string = "identity/global-sso";
const SCIM: string = "identity/scim";
const IP_ADDRESSES: string = "configuration/ip-addresses";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: REFERENCE, navTitle: "Permission Reference" },
  { page: SSO, navTitle: "SSO" },
  { page: GLOBAL_SSO, navTitle: "Global SSO" },
  { page: SCIM, navTitle: "SCIM" },
  { page: IP_ADDRESSES, navTitle: "IP Addresses" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// Keycloak's, Microsoft Entra ID's and Okta's own fields, tabs and buttons.
const KEYCLOAK_LABELS: Array<string> = [
  "Realm settings",
  "Keys",
  "Certificate",
  "Clients",
  "Client Protocol",
  "Client ID",
  "Root URL",
  "Valid Redirect URIs",
  "Assertion Consumer Service POST Binding URL",
  "Name ID Format",
  "Force Name ID Format",
  "Client signature required",
  "Signing keys config",
];

const ENTRA_SSO_LABELS: Array<string> = [
  "Identity",
  "Applications",
  "Enterprise applications",
  "+ New application",
  "+ Create your own application",
  "Integrate any other application you don't find in the gallery (Non-gallery)",
  "Create",
  "Single sign-on",
  "SAML",
  "SAML Certificates",
  "Certificate (Base64)",
  "Set up OneUptime",
  "Login URL",
  "Microsoft Entra Identifier",
  "Azure AD Identifier",
  "Basic SAML Configuration",
  "Edit",
  "Identifier (Entity ID)",
  "Reply URL (Assertion Consumer Service URL)",
  "Save",
  "Attributes & Claims",
  "Unique User Identifier (Name ID)",
  "Name identifier format",
  "Users and groups",
  "+ Add user/group",
  "Assign",
  "Base64",
];

const OKTA_SSO_LABELS: Array<string> = [
  "Create App Integration",
  "SAML 2.0",
  "Next",
  "App name",
  "Single sign-on URL",
  "Audience URI (SP Entity ID)",
  "Name ID format",
  "Application username",
  "I'm an Okta customer adding an internal app",
  "Finish",
  "Sign On",
  "SAML Signing Certificates",
  "Actions",
  "View IdP metadata",
  "Download certificate",
  "General",
  "SAML Settings",
  "Assignments",
  "Assign to People",
  "Assign to Groups",
  "Done",
  "Audience URI",
  // The "Other" tab, in any identity provider's terms.
  "Assertion Consumer Service URL / Reply URL",
  "Entity ID / Audience URI",
];

/*
 * Labels of another product's console, by page. A translation keeps each
 * one bold and in English: OneUptime cannot know which language that
 * console is set to, and its English names are the ones its own docs and
 * search use.
 */
const IDENTITY_PROVIDER_LABELS: Record<string, Array<string>> = {
  [SSO]: [...KEYCLOAK_LABELS, ...ENTRA_SSO_LABELS, ...OKTA_SSO_LABELS],
  [SCIM]: [
    // Microsoft Entra ID.
    "Identity",
    "Applications",
    "Enterprise applications",
    "+ New application",
    "+ Create your own application",
    "Integrate any other application you don't find in the gallery (Non-gallery)",
    "Create",
    "Provisioning",
    "Get started",
    "Provisioning Mode",
    "Automatic",
    "Admin Credentials",
    "Tenant URL",
    "Secret Token",
    "Test Connection",
    "Save",
    "Mappings",
    "Provision Azure Active Directory Users",
    "Provision Azure Active Directory Groups",
    "Enabled",
    "Yes",
    "Users and groups",
    "+ Add user/group",
    "Assign",
    "Overview",
    "Start provisioning",
    "Provisioning logs",
    // Okta.
    "Create App Integration",
    "SAML 2.0",
    "General",
    "App Settings",
    "Edit",
    "Integration",
    "Configure API Integration",
    "Enable API integration",
    "SCIM connector base URL",
    "Unique identifier field for users",
    "Supported provisioning actions",
    "Authentication Mode",
    "HTTP Header",
    "Authorization",
    "Test API Credentials",
    "To App",
    "Create Users",
    "Update User Attributes",
    "Deactivate Users",
    "Attribute Mappings",
    "Push Groups",
    "+ Push Groups",
    "Find groups by name",
    "Find groups by rule",
    "Assignments",
    "Assign to People",
    "Assign to Groups",
    "Done",
    "Reports",
    "System Log",
  ],
};

/*
 * Bold names the translations keep in English, by page: plans; roles and
 * permissions, as the API, Terraform and the role pickers name them;
 * products; "Admin", the Admin Dashboard in a path; and what the product
 * writes in English in every language - the SCIM dialogs' field names (JSX
 * text, never looked up: SOURCE_TEXT) and the docs' own empty IP list
 * (Utils/Placeholders).
 */
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  [SSO]: [
    "Scale",
    "Project Owner",
    "Project Admin",
    "Create Project SSO",
    "Create Project OIDC",
    "Edit Project",
    "Admin",
  ],
  [GLOBAL_SSO]: ["Admin"],
  [SCIM]: [
    "Scale",
    "OneUptime Cloud",
    "Microsoft Entra ID",
    "Okta",
    "SCIM Base URL",
    "Bearer Token",
  ],
  [IP_ADDRESSES]: ["No IP addresses configured."],
};

// The plan and role names KEPT_IN_ENGLISH may hold, besides the product's own text.
const PLANS: Array<string> = ["Growth", "Scale"];

const PRODUCT_TEXT_IN_ENGLISH: Record<string, Array<string>> = {
  [SSO]: ["Admin"],
  [GLOBAL_SSO]: ["Admin"],
  [SCIM]: [
    "OneUptime Cloud",
    "Microsoft Entra ID",
    "Okta",
    "SCIM Base URL",
    "Bearer Token",
  ],
  [IP_ADDRESSES]: ["No IP addresses configured."],
};

/*
 * Where the product draws text from its source as it is, never looked up:
 * the file (from the repository root) and the literal. A front end that
 * starts translating one of them fails here, and the pages follow it.
 */
interface SourceText {
  text: string;
  file: string;
  literal: RegExp;
}

const SOURCE_TEXT: ReadonlyArray<SourceText> = [
  {
    text: "SCIM Base URL",
    file: "ee/Dashboard/Identity/Pages/Settings/SCIM.tsx",
    literal: /\n\s*SCIM Base URL:\n/,
  },
  {
    text: "Bearer Token",
    file: "ee/Dashboard/Identity/Pages/Settings/SCIM.tsx",
    literal: /\n\s*Bearer Token:\n/,
  },
  {
    text: "SCIM Base URL",
    file: "ee/Dashboard/Identity/Pages/StatusPages/SCIM.tsx",
    literal: /<strong>SCIM Base URL:<\/strong>/,
  },
  {
    text: "Bearer Token",
    file: "ee/Dashboard/Identity/Pages/StatusPages/SCIM.tsx",
    literal: /<strong>Bearer Token:<\/strong>/,
  },
  {
    text: "No IP addresses configured.",
    file: "packages/App/FeatureSet/Docs/Utils/Placeholders.ts",
    literal: /return "- No IP addresses configured\.";/,
  },
];

/*
 * The Admin Dashboard's labels, by page: it shows a label as its locale
 * words the whole text, or in English. Settings and Authentication come
 * from its top bar's and side menu's own keys (ADMIN_KEYS).
 */
const ADMIN_LABELS: Record<string, Array<string>> = {
  [SSO]: ["Settings", "Authentication", "Require SSO for Login"],
  [GLOBAL_SSO]: [
    "Settings",
    "Authentication",
    "Global SSO",
    "Global OIDC",
    "Create Global SSO",
    "Create Global OIDC",
    "Name",
    "Sign On URL",
    "Issuer",
    "Public Certificate",
    "More fields",
    "Signature Method",
    "Digest Method",
    "Issuer URL",
    "Client ID",
    "Client Secret",
    "Discovery URL",
    "Scopes",
    "Identity Provider URLs",
    "ACS URL (Assertion Consumer Service / Reply URL)",
    "Issuer (Entity ID)",
    "Identity Provider URL",
    "Redirect URI (Callback URL)",
    "Edit Configuration",
    "Enabled",
    "Test this SSO provider",
    "Test this OIDC provider",
    "Attached Projects",
    "Disable Sign Up with SSO",
    "Restrict to Attached Projects",
    "Require SSO for Login",
  ],
};

const ADMIN_KEYS: Record<string, string> = {
  Settings: "navbar.settings",
  Authentication: "sideMenu.settingsAuthentication",
};

/*
 * Admin Dashboard labels a page also names as the Dashboard draws them: the
 * SSO page's project switch is the Dashboard's Require SSO for Login, its
 * server-wide one the Admin Dashboard's.
 */
const ALSO_DASHBOARD_LABELS: Record<string, Array<string>> = {
  [SSO]: ["Require SSO for Login"],
};

// The user menu's way into the Admin Dashboard, a key of the Dashboard's.
const USER_MENU_LABELS: Record<string, Record<string, string>> = {
  [GLOBAL_SSO]: { "Admin Settings": "userProfile.adminSettings" },
};

// The sign-in pages' labels, keys of the Accounts locale.
const ACCOUNTS_LABELS: Record<string, Record<string, string>> = {
  [SSO]: { "Login with SSO": "sso.title" },
};

/*
 * The SSO Configuration dialog's field names, which it looks up with their
 * colon ("Identifier (Entity ID):") and the page writes without it, and the
 * short name of the reply URL: the drawn name up to its parenthesis.
 */
const DIALOG_LABELS: Record<string, Record<string, string>> = {
  [SSO]: {
    "Identifier (Entity ID)": "Identifier (Entity ID):",
    "Reply URL (Assertion Consumer Service URL)":
      "Reply URL (Assertion Consumer Service URL):",
  },
};

const SHORT_DIALOG_LABELS: Record<string, Record<string, string>> = {
  [SSO]: { "Reply URL": "Reply URL (Assertion Consumer Service URL):" },
};

/*
 * The permission tables' column names and values, keys of the docs locale's
 * ui: the generated tables draw them in the reader's language, and the page
 * names them the same way - in bold for a column, in code for a value.
 */
const DOCS_CHROME: Record<string, Record<string, string>> = {
  [REFERENCE]: {
    Role: "permissionsColRole",
    Permission: "permissionsColPermission",
    "Permission Key": "permissionsColKey",
    Scope: "permissionsColScope",
    "Restrict by labels": "permissionsColLabels",
    Description: "permissionsColDescription",
  },
};

const DOCS_CHROME_CODE: Record<string, Record<string, string>> = {
  [REFERENCE]: {
    "All, Owned or Labels": "permissionsScopeSelectable",
    "Project-wide only": "permissionsScopeProjectWide",
    Yes: "permissionsYes",
  },
};

// The four roles the Permission Reference names, as the tables name them.
const WHOLE_PROJECT_ROLES: Array<string> = [
  "Project Owner",
  "Project Admin",
  "Project Member",
  "Viewer",
];

/*
 * Bold words that are Dashboard labels by coincidence but are words of the
 * page here, which a translation words as its language needs.
 */
const PROSE: Record<string, Array<string>> = {
  [SSO]: [
    // A step of the page, not a button.
    "Create SSO Configuration",
  ],
  [SCIM]: [
    // The two kinds of connection, as the FAQ calls them.
    "Project SCIM",
    "Status Page SCIM",
  ],
};

/*
 * The bold leads of the pages' own lists, steps and sentences. They are
 * neither labels nor kept in English, so a translation words them freely;
 * listing them makes a new bold word fail until it is put in a list.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [SSO]: [
    "Edition:",
    "Navigate to Project Settings",
    "Get OneUptime SSO Metadata",
    "Test the provider",
    "Collect your realm's values",
    "Create the provider in OneUptime",
    "Create the Keycloak client",
    "Adjust the client settings",
    "Turn the provider on and test it",
    "Create an enterprise application in Entra ID",
    "Copy Entra ID's SAML values",
    "Give Entra ID OneUptime's URLs",
    "Send the email as the Name ID",
    "Assign users and groups",
    "Create a SAML application in Okta",
    "Copy Okta's SAML values",
    "Give Okta OneUptime's URLs",
    "Assign people",
  ],
  [GLOBAL_SSO]: [
    "instance administrator",
    "once",
    "No projects attached (default-all / invite-first):",
    "any project they are already a member of",
    "not",
    "Projects attached (auto-provisioning):",
    "auto-provisioned",
    "Per project:",
    "Instance-wide:",
  ],
  [SCIM]: [
    "Edition:",
    "Automated user provisioning",
    "Automated user deprovisioning",
    "User attribute synchronization",
    "Centralized access management",
    "Navigate to Project Settings",
    "Configure SCIM Settings",
    "Configure Your Identity Provider",
    "Navigate to Status Page Settings",
    "Still works:",
    "Refused:",
    "A removal that also changes a profile",
    "A request that changes nothing is answered as usual",
    "Self-hosted",
    "invited",
  ],
};

/*
 * Messages the sign-in pages and the server show in English in every
 * language, which the pages quote as they appear: the titles of the
 * troubleshooting entries, and two refusals Global SSO quotes in its text.
 */
const SERVER_MESSAGES: Record<string, Array<string>> = {
  [SSO]: [
    ':::details "SSO Config not found"',
    ':::details "No teams added."',
    ':::details "Issuer URL does not match"',
    ':::details "Encrypted SAML Responses are not supported"',
    ':::details "SAML response did not include a valid email address"',
  ],
  [GLOBAL_SSO]: [
    ':::details "You must be invited to a project on this OneUptime instance before you can sign in with SSO"',
    ':::details "This SSO provider does not grant access to any project you are a member of"',
    ':::details "You are not a member of any project on this OneUptime instance"',
    ':::details "Issuer URL does not match"',
    '"Another change to who can sign in with SSO is being saved. Try again in a moment."',
    '"The server\'s SSO settings are being changed. Create the project again in a moment."',
  ],
};

/*
 * Numbers each page states, which every translation states too - read
 * with Persian digits as Latin ones and thousands separators dropped.
 */
const NUMBERS: Record<string, Array<string>> = {
  [SSO]: ["24", "17", "700016", "404"],
  [SCIM]: ["14", "30", "40", "200", "1000", "400", "401", "402"],
};

const REGEX_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;
const DIALOG_COLON: RegExp = /\s*[:：]\s*$/;
const NUMBER: RegExp = /\d+/g;
const THOUSANDS: RegExp = /(\d)[,.\u066c\u00a0\u202f '](?=\d{3}\b)/g;
// A prose line that opens a bold or code span and never closes it.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;

function englishPage(page: string): string {
  return readPage("en", page);
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_DIR, relativePath), "utf8");
}

function readLocale(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

// A value of a locale, by a dotted path of nested keys.
function nestedValue(
  locale: Record<string, unknown>,
  dotted: string,
): string | null {
  let value: unknown = locale;

  for (const part of dotted.split(".")) {
    if (!value || typeof value !== "object") {
      return null;
    }

    value = (value as Record<string, unknown>)[part];
  }

  return typeof value === "string" && value.trim() ? value : null;
}

const localeCache: Map<string, Record<string, unknown>> = new Map();

function appLocale(app: string, language: string): Record<string, unknown> {
  const key: string = `${app}/${language}`;
  const cached: Record<string, unknown> | undefined = localeCache.get(key);

  if (cached) {
    return cached;
  }

  const file: string =
    app === "Docs"
      ? path.join(
          PACKAGES_DIR,
          "App/FeatureSet/Docs/Locales",
          `${language}.json`,
        )
      : path.join(
          PACKAGES_DIR,
          `App/FeatureSet/${app}/src/Locales`,
          `${language}.json`,
        );
  const locale: Record<string, unknown> = readLocale(file);

  localeCache.set(key, locale);

  return locale;
}

/*
 * How the Admin Dashboard draws a label: its top bar's and side menu's own
 * keys, else one lookup of the whole text in its locale, else the English.
 */
function adminLabel(language: string, english: string): string {
  const locale: Record<string, unknown> = appLocale("AdminDashboard", language);
  const keyed: string | undefined = ADMIN_KEYS[english];

  if (keyed) {
    return nestedValue(locale, keyed) || english;
  }

  const value: unknown = locale[english];

  return typeof value === "string" && value.trim() ? value : english;
}

// One flat lookup of the whole text in the Dashboard's locale, or the English.
function flatDashboardLabel(language: string, english: string): string {
  const value: unknown = dashboardLocale(language)[english];

  return typeof value === "string" && value.trim() ? value : english;
}

// A dialog field name as the dialog draws it, without its colon.
function dialogLabel(language: string, key: string): string {
  return flatDashboardLabel(language, key).replace(DIALOG_COLON, "");
}

// The name a dialog field goes by for short: the drawn name up to "(".
function shortDialogLabel(language: string, key: string): string {
  const drawn: string = dialogLabel(language, key);
  const parenthesis: number = drawn.search(/\s*[(（]/);

  return parenthesis > 0 ? drawn.slice(0, parenthesis) : drawn;
}

function docsUi(language: string, key: string): string {
  return nestedValue(appLocale("Docs", language), `ui.${key}`) as string;
}

// The bold spans of a page's prose, once each.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown));
}

function isPermissionOrRole(name: string): boolean {
  return PermissionHelper.getAllPermissionProps().some(
    (props: { title: string }): boolean => {
      return props.title === name;
    },
  );
}

function listed(
  lists: Record<string, Array<string>>,
  page: string,
): Array<string> {
  return lists[page] || [];
}

function keysOf(
  lists: Record<string, Record<string, string>>,
  page: string,
): Array<string> {
  return Object.keys(lists[page] || {});
}

/*
 * The labels of a page that are not drawn by the Dashboard here: another
 * product's, kept in English, the Admin Dashboard's, the docs' own, the
 * sign-in pages' and the prose.
 */
function notDashboardLabels(page: string): Array<string> {
  const admin: Array<string> = listed(ADMIN_LABELS, page).filter(
    (label: string): boolean => {
      return !listed(ALSO_DASHBOARD_LABELS, page).includes(label);
    },
  );

  return [
    ...listed(IDENTITY_PROVIDER_LABELS, page),
    ...listed(KEPT_IN_ENGLISH, page),
    ...listed(PROSE, page),
    ...admin,
    ...keysOf(DOCS_CHROME, page),
    ...keysOf(USER_MENU_LABELS, page),
    ...keysOf(ACCOUNTS_LABELS, page),
    ...keysOf(DIALOG_LABELS, page),
    ...keysOf(SHORT_DIALOG_LABELS, page),
  ];
}

// Every number a page's prose states, as Latin digits without separators.
function statedNumbers(markdown: string): Set<string> {
  const text: string = toLatinDigits(prose(markdown)).replace(THOUSANDS, "$1");

  return new Set(text.match(NUMBER) || []);
}

/*
 * The prose lines that open a bold span or an inline code span and never
 * close it.
 */
function unbalancedLines(markdown: string): Array<string> {
  return prose(markdown)
    .split("\n")
    .filter((line: string): boolean => {
      const ticks: number = line.split("`").length - 1;
      const outsideCode: string = line.replace(INLINE_CODE_SPAN, "");
      const stars: number = outsideCode.split("**").length - 1;

      return ticks % 2 !== 0 || stars % 2 !== 0;
    });
}

/*
 * The steps of every :::steps block on a page: the headings inside them, at
 * whatever level the section puts them.
 */
function stepCount(markdown: string): number {
  let depth: number = 0;
  let inFence: boolean = false;
  let steps: number = 0;
  const stack: Array<boolean> = [];

  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const trimmed: string = line.trim();

    if (trimmed.startsWith(":::") && trimmed !== ":::") {
      stack.push(trimmed === ":::steps");
      depth += trimmed === ":::steps" ? 1 : 0;
      continue;
    }

    if (trimmed === ":::") {
      const wasSteps: boolean | undefined = stack.pop();
      depth -= wasSteps ? 1 : 0;
      continue;
    }

    if (depth > 0 && line.startsWith("#")) {
      steps++;
    }
  }

  return steps;
}

// The headings of a page below its title, in order.
function sections(markdown: string): Array<DocsHeading> {
  return scanMarkdown(markdown).headings.filter(
    (heading: DocsHeading): boolean => {
      return heading.line !== 1;
    },
  );
}

/*
 * The anchor of the heading of a page in a language that sits where the
 * English page's heading with this anchor sits, or null when the English
 * page has no such heading.
 */
function anchorInLanguage(
  language: string,
  page: string,
  englishAnchor: string,
): string | null {
  const english: Array<DocsHeading> = sections(englishPage(page));
  const index: number = english.findIndex((heading: DocsHeading): boolean => {
    return heading.slug === englishAnchor;
  });

  if (index < 0) {
    return null;
  }

  return sections(readPage(language, page))[index]?.slug || null;
}

/*
 * The links of a page that name a heading of this page or of another page
 * of this group, in order, as "page#anchor".
 */
function groupAnchorLinks(page: string, markdown: string): Array<string> {
  return scanMarkdown(markdown)
    .links.map((link: DocsLink): string | null => {
      if (link.target.startsWith("#")) {
        return `${page}${link.target}`;
      }

      const target: { page: string; anchor: string | null } | null =
        parseDocsLink(link.target);

      if (!target || !target.anchor || !PAGE_NAMES.includes(target.page)) {
        return null;
      }

      return `${target.page}#${decodeURIComponent(target.anchor)}`;
    })
    .filter((link: string | null): link is string => {
      return link !== null;
    });
}

// The inline code a translation of a page must have: the English page's, the table values translated.
function expectedInlineCode(language: string, page: string): Array<string> {
  const chrome: Record<string, string> = DOCS_CHROME_CODE[page] || {};

  return inlineCode(englishPage(page))
    .map((code: string): string => {
      const key: string | undefined = chrome[code];

      return key ? docsUi(language, key) : code;
    })
    .sort();
}

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      IDENTITY_PROVIDER_LABELS,
      KEPT_IN_ENGLISH,
      PRODUCT_TEXT_IN_ENGLISH,
      ADMIN_LABELS,
      ALSO_DASHBOARD_LABELS,
      USER_MENU_LABELS,
      ACCOUNTS_LABELS,
      DIALOG_LABELS,
      SHORT_DIALOG_LABELS,
      DOCS_CHROME,
      DOCS_CHROME_CODE,
      PROSE,
      PROSE_LEADS,
      SERVER_MESSAGES,
      NUMBERS,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("list only bold words the English page has", () => {
    for (const lists of [
      IDENTITY_PROVIDER_LABELS,
      KEPT_IN_ENGLISH,
      ADMIN_LABELS,
      PROSE,
      PROSE_LEADS,
    ]) {
      for (const page of Object.keys(lists)) {
        const labels: Array<string> = boldLabels(englishPage(page));

        for (const label of lists[page] as Array<string>) {
          expect({ page, label, bold: true }).toEqual({
            page,
            label,
            bold: labels.includes(label),
          });
        }
      }
    }

    for (const lists of [
      USER_MENU_LABELS,
      ACCOUNTS_LABELS,
      DIALOG_LABELS,
      SHORT_DIALOG_LABELS,
      DOCS_CHROME,
    ]) {
      for (const page of Object.keys(lists)) {
        const labels: Array<string> = boldLabels(englishPage(page));

        for (const label of keysOf(lists, page)) {
          expect({ page, label, bold: true }).toEqual({
            page,
            label,
            bold: labels.includes(label),
          });
        }
      }
    }
  });

  it("keep in English only plans, roles and permissions, and the product's own English text", () => {
    for (const page of Object.keys(KEPT_IN_ENGLISH)) {
      for (const name of KEPT_IN_ENGLISH[page] as Array<string>) {
        expect({ page, name, why: true }).toEqual({
          page,
          name,
          why:
            PLANS.includes(name) ||
            isPermissionOrRole(name) ||
            listed(PRODUCT_TEXT_IN_ENGLISH, page).includes(name),
        });
      }
    }
  });

  it("call prose only Dashboard labels, and leads only what is no label at all", () => {
    for (const page of Object.keys(PROSE)) {
      for (const label of PROSE[page] as Array<string>) {
        expect({ page, label, isLabel: true }).toEqual({
          page,
          label,
          isLabel: isActionLabel(label),
        });
      }
    }

    for (const page of Object.keys(PROSE_LEADS)) {
      for (const lead of PROSE_LEADS[page] as Array<string>) {
        expect({ page, lead, isLabel: false }).toEqual({
          page,
          lead,
          isLabel: isActionLabel(lead),
        });
      }
    }
  });

  it("name keys the locales have", () => {
    for (const page of Object.keys(USER_MENU_LABELS)) {
      for (const [english, key] of Object.entries(
        USER_MENU_LABELS[page] as Record<string, string>,
      )) {
        expect(nestedValue(dashboardLocale("en"), key)).toBe(english);
      }
    }

    for (const page of Object.keys(ACCOUNTS_LABELS)) {
      for (const [english, key] of Object.entries(
        ACCOUNTS_LABELS[page] as Record<string, string>,
      )) {
        expect(nestedValue(appLocale("Accounts", "en"), key)).toBe(english);
      }
    }

    for (const page of Object.keys(DIALOG_LABELS)) {
      for (const [english, key] of Object.entries({
        ...(DIALOG_LABELS[page] as Record<string, string>),
        ...(SHORT_DIALOG_LABELS[page] || {}),
      })) {
        expect(dashboardLocale("en")[key]).toBe(key);
        expect(key.startsWith(english)).toBe(true);
      }
    }

    for (const page of Object.keys(DOCS_CHROME)) {
      for (const [english, key] of Object.entries({
        ...(DOCS_CHROME[page] as Record<string, string>),
        ...(DOCS_CHROME_CODE[page] || {}),
      })) {
        expect(docsUi("en", key)).toBe(english);
      }
    }

    for (const [english, key] of Object.entries(ADMIN_KEYS)) {
      expect(nestedValue(appLocale("AdminDashboard", "en"), key)).toBe(english);
    }
  });

  it("keep the Admin Dashboard's labels it has no wording for out of its locale, and the ones it has in it", () => {
    const adminEnglish: Record<string, unknown> = appLocale(
      "AdminDashboard",
      "en",
    );

    // Translated there: these are the labels a translation names in its language.
    for (const label of [
      "Name",
      "Enabled",
      "More fields",
      "Require SSO for Login",
    ]) {
      expect({ label, inLocale: adminEnglish[label] }).toEqual({
        label,
        inLocale: label,
      });
    }

    // Drawn in English there, in every language.
    for (const label of [
      "Global SSO",
      "Create Global SSO",
      "Sign On URL",
      "Attached Projects",
      "Edit Configuration",
      "Restrict to Attached Projects",
    ]) {
      expect({ label, inLocale: adminEnglish[label] }).toEqual({
        label,
        inLocale: undefined,
      });
    }
  });

  it("find the product's own English text where the lists say it is drawn", () => {
    for (const entry of SOURCE_TEXT) {
      const file: string = path.join(REPO_DIR, entry.file);

      // Common and App CI run without ee/: what is drawn there is checked where it is.
      if (!fs.existsSync(file)) {
        continue;
      }

      expect({ ...entry, found: true }).toEqual({
        ...entry,
        found: entry.literal.test(readRepoFile(entry.file)),
      });
    }
  });

  it("know every bold word on the English pages", () => {
    for (const page of PAGE_NAMES) {
      const known: Array<string> = [
        ...notDashboardLabels(page),
        ...listed(PROSE_LEADS, page),
      ];
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !isActionLabel(span) && !known.includes(span);
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("quote messages and numbers the English pages really have", () => {
    for (const page of Object.keys(SERVER_MESSAGES)) {
      for (const message of SERVER_MESSAGES[page] as Array<string>) {
        expect({ page, message, quoted: true }).toEqual({
          page,
          message,
          quoted: englishPage(page).includes(message),
        });
      }
    }

    for (const page of Object.keys(NUMBERS)) {
      const stated: Set<string> = statedNumbers(englishPage(page));

      for (const value of NUMBERS[page] as Array<string>) {
        expect({ page, value, stated: true }).toEqual({
          page,
          value,
          stated: stated.has(value),
        });
      }
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: TranslatedPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it.each(PAGES)(
    "$page ends on a Next steps section of cards",
    (entry: TranslatedPage) => {
      const scanned: ScannedPage = scanMarkdown(englishPage(entry.page));
      const last: DocsHeading = scanned.headings[
        scanned.headings.length - 1
      ] as DocsHeading;

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(cardLines(englishPage(entry.page)).length).toBeGreaterThan(0);
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each([SSO, GLOBAL_SSO, SCIM])(
    "%s draws its flows as diagrams, with captions",
    (page: string) => {
      const diagrams: Array<{ info: string }> = scanMarkdown(
        englishPage(page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }
    },
  );

  it.each([SSO, GLOBAL_SSO, SCIM])(
    "%s walks its set-up in steps and answers what goes wrong",
    (page: string) => {
      const markdown: string = englishPage(page);

      expect(markdown).toContain(":::steps");
      expect(
        scanMarkdown(markdown).headings.map((heading: DocsHeading): string => {
          return heading.text;
        }),
      ).toContain("Troubleshooting");
    },
  );

  it("the Permission Reference names the four roles that reach the whole project", () => {
    for (const role of WHOLE_PROJECT_ROLES) {
      expect(englishPage(REFERENCE)).toContain(role);
    }
  });
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(PAGES)("$page", (entry: TranslatedPage) => {
    const english: string = englishPage(entry.page);

    it("is translated, under the nav link's title", () => {
      expect(hasPage(language, entry.page)).toBe(true);

      const translated: string = readPage(language, entry.page);
      const title: string = navTitle(language, entry.navTitle);

      expect(translated).not.toEqual(english);
      expect(typeof title).toBe("string");
      expect(translated.split("\n")[0]).toBe(`# ${title}`);
    });

    it("keeps every code block, and builds every diagram the same way", () => {
      expect(
        scanMarkdown(readPage(language, entry.page)).fences.map(
          comparableFence,
        ),
      ).toEqual(scanMarkdown(english).fences.map(comparableFence));
    });

    it("keeps every piece of inline code, with the tables' values as the tables draw them", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        expectedInlineCode(language, entry.page),
      );
    });

    it("closes every bold and code span it opens", () => {
      expect(unbalancedLines(readPage(language, entry.page))).toEqual([]);
    });

    it("draws every bold and italic span, with no asterisks or underscores left on the page", async () => {
      expect(
        await strayMarkers(readPage(language, entry.page), language),
      ).toEqual([]);
    });

    it("has the English page's headings, steps, tables and list items", () => {
      const translated: string = readPage(language, entry.page);

      expect(
        scanMarkdown(translated).headings.map((heading: DocsHeading) => {
          return heading.level;
        }),
      ).toEqual(
        scanMarkdown(english).headings.map((heading: DocsHeading) => {
          return heading.level;
        }),
      );
      expect(stepCount(translated)).toBe(stepCount(english));
      expect(tableShape(translated)).toEqual(tableShape(english));
      expect(listItemCount(translated)).toBe(listItemCount(english));
    });

    it("writes its cards with an ASCII ': ' after the link, to the English cards' pages", () => {
      const translated: Array<string> = cardLines(
        readPage(language, entry.page),
      );

      expect(translated.length).toBe(cardLines(english).length);

      for (const line of translated) {
        expect({ line, ascii: CARD_LINE.test(line) }).toEqual({
          line,
          ascii: true,
        });
      }

      expect(cardTargets(translated)).toEqual(cardTargets(cardLines(english)));
    });

    it("links only to anchors that are headings of the page they open", () => {
      expect(anchorProblems(language, entry.page)).toEqual([]);
    });

    it("points every link into this group at the heading the English link means", () => {
      const expected: Array<string> = groupAnchorLinks(entry.page, english).map(
        (link: string): string => {
          const [page, anchor] = link.split("#") as [string, string];

          return `${page}#${anchorInLanguage(language, page, anchor) || "?"}`;
        },
      );

      expect(
        groupAnchorLinks(entry.page, readPage(language, entry.page)),
      ).toEqual(expected);
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const exceptions: Array<string> = notDashboardLabels(entry.page);
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return isActionLabel(label) && !exceptions.includes(label);
        })
        .filter((label: string): boolean => {
          return !translated.includes(
            `**${drawnActionLabel(language, label)}**`,
          );
        })
        .map((label: string): string => {
          return `${label} -> ${drawnActionLabel(language, label)}`;
        });

      expect(missing).toEqual([]);
    });

    it("names the Admin Dashboard, the user menu and the sign-in pages as they draw themselves", () => {
      const translated: string = readPage(language, entry.page);
      const drawn: Array<string> = [
        ...listed(ADMIN_LABELS, entry.page).map((label: string): string => {
          return adminLabel(language, label);
        }),
        ...Object.values(USER_MENU_LABELS[entry.page] || {}).map(
          (key: string): string => {
            return nestedValue(dashboardLocale(language), key) as string;
          },
        ),
        ...Object.values(ACCOUNTS_LABELS[entry.page] || {}).map(
          (key: string): string => {
            return nestedValue(appLocale("Accounts", language), key) as string;
          },
        ),
        ...Object.values(DIALOG_LABELS[entry.page] || {}).map(
          (key: string): string => {
            return dialogLabel(language, key);
          },
        ),
        ...Object.values(SHORT_DIALOG_LABELS[entry.page] || {}).map(
          (key: string): string => {
            return shortDialogLabel(language, key);
          },
        ),
        ...Object.values(DOCS_CHROME[entry.page] || {}).map(
          (key: string): string => {
            return docsUi(language, key);
          },
        ),
      ];
      const missing: Array<string> = drawn.filter((label: string): boolean => {
        return !translated.includes(`**${label}**`);
      });

      expect(missing).toEqual([]);
    });

    it("keeps in English what stays English: other consoles, plans, roles and the product's English text", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(IDENTITY_PROVIDER_LABELS, entry.page),
        ...listed(KEPT_IN_ENGLISH, entry.page),
      ].filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });

    it("quotes the server's messages as it sends them, and states the English page's numbers", () => {
      const translated: string = readPage(language, entry.page);

      for (const message of listed(SERVER_MESSAGES, entry.page)) {
        expect({ message, quoted: true }).toEqual({
          message,
          quoted: translated.includes(message),
        });
      }

      const stated: Set<string> = statedNumbers(translated);

      for (const value of listed(NUMBERS, entry.page)) {
        expect({ value, stated: true }).toEqual({
          value,
          stated: stated.has(value),
        });
      }
    });
  });

  it("names the roles that reach the whole project as the permission tables do", () => {
    const translated: string = readPage(language, REFERENCE);

    for (const role of WHOLE_PROJECT_ROLES) {
      expect({ role, named: true }).toEqual({
        role,
        named: translated.includes(role),
      });
    }
  });

  it("writes the Admin Dashboard's paths segment by segment, as it draws them", () => {
    for (const page of [SSO, GLOBAL_SSO]) {
      const translated: string = readPage(language, page);
      const settings: string = adminLabel(language, "Settings");
      const authentication: string = adminLabel(language, "Authentication");
      const path: RegExp = new RegExp(
        `\\*\\*Admin\\*\\* > \\*\\*${escapeRegex(settings)}\\*\\* > \\*\\*${escapeRegex(authentication)}\\*\\*`,
      );

      expect({ page, path: true }).toEqual({
        page,
        path: path.test(translated),
      });
    }
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these check
 * the page-specific readers.
 */
describe("the helpers, on these pages' shapes", () => {
  it("read the Admin Dashboard's labels from its own locale, or in English", () => {
    expect(adminLabel("de", "Require SSO for Login")).toBe(
      "SSO für die Anmeldung erfordern",
    );
    // The Dashboard words the project's switch differently.
    expect(drawnActionLabel("de", "Require SSO for Login")).toBe(
      "SSO für die Anmeldung erzwingen",
    );
    expect(adminLabel("de", "Settings")).toBe("Einstellungen");
    expect(adminLabel("ja", "Attached Projects")).toBe("Attached Projects");
  });

  it("read a dialog's field name without its colon, in any script", () => {
    expect(dialogLabel("fr", "Identifier (Entity ID):")).toBe(
      "Identifiant (Entity ID)",
    );
    expect(dialogLabel("ja", "Identifier (Entity ID):")).toBe(
      "識別子（エンティティ ID）",
    );
    expect(
      shortDialogLabel("de", "Reply URL (Assertion Consumer Service URL):"),
    ).toBe("Antwort-URL");
    expect(
      shortDialogLabel("ja", "Reply URL (Assertion Consumer Service URL):"),
    ).toBe("応答 URL");
  });

  it("read numbers in any digits, without thousands separators", () => {
    expect(
      Array.from(
        statedNumbers("Bis zu 1.000 Operationen, ۴۰ دقیقه, 1,000 and 1 000."),
      ),
    ).toEqual(["1000", "40"]);
  });

  it("let a translation name a sequence diagram's actor, but not change who it is", () => {
    const english: string = [
      "sequenceDiagram",
      "    actor U as Person",
      "    participant I as Identity provider",
      "    U->>I: Credentials and MFA",
    ].join("\n");
    const translated: string = [
      "sequenceDiagram",
      "    actor U as Personne",
      "    participant I as Fournisseur d'identité",
      "    U->>I: Identifiants et MFA",
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(translated.replace("actor U", "actor V"))).not.toBe(
      diagramSkeleton(english),
    );
    expect(
      diagramSkeleton(translated.replace("actor U", "participant U")),
    ).not.toBe(diagramSkeleton(english));
  });

  it("count the steps of nested :::steps blocks, and only theirs", () => {
    const markdown: string = [
      "# Page",
      ":::steps",
      "### One",
      ":::tabs",
      "@tab A",
      "Text",
      ":::",
      "### Two",
      ":::",
      "### After",
      ":::tabs",
      "@tab B",
      ":::steps",
      "#### Three",
      ":::",
      ":::",
    ].join("\n");

    expect(stepCount(markdown)).toBe(3);
  });
});
