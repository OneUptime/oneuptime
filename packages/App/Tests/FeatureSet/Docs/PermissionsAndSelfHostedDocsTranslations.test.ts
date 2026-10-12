import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsContainerUse,
  DocsHeading,
  ScannedPage,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  dashboardLocale,
  drawnActionLabel,
  drawnCreateButton,
  isActionLabel,
} from "./DocsDashboardLabels";
import {
  CARD_LINE,
  anchorProblems,
  boldSpans,
  cardLines,
  cardTargets,
  comparableFence,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { anchorInLanguage } from "./NetworkDocsLabels";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 20: Users, Teams & Permissions and five Self Hosted
 * pages (Push Notifications, SendGrid Inbound Email, Private Network Access,
 * Architecture, Enterprise Edition) in every docs language. Each
 * translation says what the English page says:
 *
 *   - line for line: each heading, table row and code fence on the English
 *     one's line, so the two can be laid side by side and a later English
 *     edit shows where it lands;
 *   - the same code, diagrams (by their nodes and arrows), inline code,
 *     tables (and the numbers in them), lists, steps, tabs and cards, and
 *     links that land on a heading in the reader's language;
 *   - a title that is the nav link's, in that language's docs locale;
 *   - the product named the way that language's product draws it.
 *
 * "The way the product draws it", on these pages:
 *
 *   - A bold Dashboard label is its value in that language's Dashboard
 *     locale, Persian included (drawnActionLabel); a table's create button
 *     as the table draws it (drawnCreateButton). A label of the Admin
 *     Dashboard is its value in the Admin Dashboard's locale (ADMIN_LABELS).
 *   - A menu path is drawn segment by segment, with " > " between the
 *     segments: in one bold span where the English page writes one, or a
 *     bold span per segment where it writes those; Persian, written right to
 *     left, always writes a bold span per segment.
 *   - What every Dashboard shows in English stays English: permission
 *     titles, which the permission picker shows untranslated (PERMISSIONS);
 *     the teams and roles a project is created with, which are records with
 *     English names (RECORD_NAMES); and labels with no locale key
 *     (SHOWN_IN_ENGLISH). So do the names of editions, products and apps
 *     (NAMES), the labels of other products' consoles - the mobile app's,
 *     the phone's own settings, SendGrid's (OTHER_CONSOLES) - workflow block
 *     names, which the workflow canvas draws untranslated (WORKFLOW_BLOCKS),
 *     and the words the server writes into a record (SERVER_MESSAGES).
 *
 * The pages' own bold leads are PROSE_LEADS, and bold words that are a
 * Dashboard label only by coincidence are PROSE: a translation words both
 * freely. A new bold word on these English pages fails "know every bold
 * word" until it is in one of the lists.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

interface TranslatedPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const PERMISSIONS_PAGE: string = "permissions/index";
export const PUSH_PAGE: string = "self-hosted/push-notifications";
export const INBOUND_EMAIL_PAGE: string = "self-hosted/sendgrid-inbound-email";
export const PRIVATE_NETWORK_PAGE: string =
  "self-hosted/private-network-access";
export const ARCHITECTURE_PAGE: string = "self-hosted/architecture";
export const ENTERPRISE_PAGE: string = "self-hosted/enterprise";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: PERMISSIONS_PAGE, navTitle: "Users, Teams & Permissions" },
  { page: PUSH_PAGE, navTitle: "Push Notifications" },
  { page: INBOUND_EMAIL_PAGE, navTitle: "SendGrid Inbound Email" },
  { page: PRIVATE_NETWORK_PAGE, navTitle: "Private Network Access" },
  { page: ARCHITECTURE_PAGE, navTitle: "Architecture" },
  { page: ENTERPRISE_PAGE, navTitle: "Enterprise Edition" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// Bold names every language's Dashboard shows in English: no locale key.
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  // The monitor type picker's title, which has no locale key.
  [PRIVATE_NETWORK_PAGE]: ["Custom JavaScript Code"],
  // The edition label's button, which has no locale key.
  [ENTERPRISE_PAGE]: ["Refresh license"],
};

// Permission titles, which the permission picker shows in English.
const PERMISSIONS: Record<string, Array<string>> = {
  [PERMISSIONS_PAGE]: [
    "Billing Admin",
    "Manage Billing",
    "Create Incident State Timeline",
    "Create Alert State Timeline",
    "Create Alert Episode State Timeline",
    "Create Incident Episode State Timeline",
    "Create Scheduled Maintenance State Timeline",
    "Create Monitor Status Timeline",
    "Edit Incident",
    "Edit Alert",
    "All Operational Resources",
    "Watch Session Replays",
    "List Session Replays",
    "Read Telemetry Service Log",
    "Read Telemetry Service Traces",
    "Read Telemetry Service Metrics",
    "Read Runbook Credential",
  ],
};

/*
 * Records a project is created with, under English names in every
 * language: the Owners, Admin and Members teams, and the Admin, Member and
 * Viewer levels every area's roles are named after (Monitor Admin, Incident
 * Member, Status Page Viewer).
 */
const RECORD_NAMES: Record<string, Array<string>> = {
  [PERMISSIONS_PAGE]: ["Owners", "Admin", "Members", "Member", "Viewer"],
};

// Names of editions, products and apps, kept as written.
const NAMES: Record<string, Array<string>> = {
  [PUSH_PAGE]: ["OneUptime On-Call", "Expo Push"],
  [ENTERPRISE_PAGE]: [
    "Community Edition",
    "Enterprise Edition",
    // The Admin Dashboard's enterprise screens, named as the edition table names them.
    "Health",
    "Query Console",
  ],
};

/*
 * Labels and paths of other products' consoles, shown in English whatever
 * the language of these pages: the OneUptime On-Call app, whose screens are
 * English; a phone's own settings; SendGrid's dashboard.
 */
const OTHER_CONSOLES: Record<string, Array<string>> = {
  [PUSH_PAGE]: [
    "Settings > Notifications > Critical On-Call Alerts",
    "Settings > Notifications > OneUptime On-Call",
    "Settings > Notifications > Do Not Disturb access",
    "Critical Alerts",
  ],
  [INBOUND_EMAIL_PAGE]: [
    "Settings",
    "Sender Authentication",
    "Authenticate Your Domain",
    "Inbound Parse",
    "Add Host & URL",
    "Add",
    "Receiving Domain",
    "Destination URL",
    "Check incoming emails for spam",
    "Send raw, full MIME message",
    "POST the raw, full MIME message",
  ],
};

// Workflow blocks, which the workflow canvas names in English.
const WORKFLOW_BLOCKS: Record<string, Array<string>> = {
  [PRIVATE_NETWORK_PAGE]: ["API", "Custom JavaScript", "Email"],
};

// What the server writes into a record, quoted as it is written.
const SERVER_MESSAGES: Record<string, Array<string>> = {
  [PUSH_PAGE]: ["Push notification not delivered"],
};

// Symbols, written as the screen draws them.
const SYMBOLS: Record<string, Array<string>> = {
  [PERMISSIONS_PAGE]: ["⋯"],
};

/*
 * Labels of the Admin Dashboard, by the key of its locale that draws them:
 * a translation names them as the Admin Dashboard draws them in its
 * language.
 */
const ADMIN_LABELS: Record<string, Record<string, string>> = {
  [PERMISSIONS_PAGE]: {
    "Add to Project": "pages.userProjects.addToProject",
  },
  [PRIVATE_NETWORK_PAGE]: {
    Settings: "breadcrumbs.settings",
    "Global LLM Providers": "breadcrumbs.globalLlmProviders",
  },
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * the English page uses them.
 */
const PROSE: Record<string, Array<string>> = {
  [PERMISSIONS_PAGE]: ["project", "teams", "Labels", "All resources", "All"],
  [PRIVATE_NETWORK_PAGE]: ["monitors", "probe", "Private"],
  [ARCHITECTURE_PAGE]: ["Probes"],
  [ENTERPRISE_PAGE]: ["read-only"],
};

/*
 * The bold leads of the pages' own lists and sentences: neither Dashboard
 * labels nor shown in English, so a translation words them freely.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [PERMISSIONS_PAGE]: [
    "users",
    "permissions",
    "Users never hold permissions directly.",
    "at least one team",
    "after they accept the invitation.",
    "Creating a team",
    "Block always wins.",
    "Owned",
    "Acting on the whole project takes a permission that reaches it.",
    "Notification.",
    "Access, when you ask for it.",
    "at least one",
    "block permissions",
    "label restrictions",
    "not",
    "Creating a key",
    "A team that only watches.",
    "On-call engineers who manage their own services.",
    "Contractors kept away from production.",
    "block permission",
    "A CI pipeline that only reports deployments.",
    "Someone who should not change billing or see invoices.",
  ],
  [PUSH_PAGE]: [
    "The responder turned it on for that device.",
    "The server marks the page critical.",
    "The operating system allows it",
    "version 1.5.0",
    "fails to sign",
    "alarm",
    "that",
    "iOS",
    "Android",
  ],
  [INBOUND_EMAIL_PAGE]: [
    "Incoming Email Monitor",
    "Check DNS propagation:",
    "Verify SendGrid Inbound Parse settings:",
    "Check OneUptime logs:",
    "Check the public webhook route:",
    "Check firewall rules:",
    "Verify the SSL certificate:",
    "Verify the criteria:",
    "Check the monitor:",
    "Review the monitor's summary:",
    "Use HTTPS:",
    "Webhook Secret:",
    "Domain Verification:",
    "Restrict Access:",
    "Monitor Logs:",
  ],
  [PRIVATE_NETWORK_PAGE]: [
    "API server",
    "Forbidden",
    "user webhooks",
    "Not",
    "status page subscriber webhooks",
    "without a DNS check",
    "Never put `169.254.169.254`, or any range containing it, in the allowlist.",
    "allows",
    "probe process from its own environment",
    "global probes",
    "every project on the instance",
    "not",
    "hostname",
    "Prefer the allowlist to the blanket boolean.",
    "Anyone who can author a workflow or an API, Website, External Status Page or Custom JavaScript Code monitor can reach anything you allowed.",
    "The response body comes back.",
    "Redirects are never followed",
    "Scope by probe rather than instance-wide where you can.",
  ],
  [ARCHITECTURE_PAGE]: ["ingress", "app"],
  [ENTERPRISE_PAGE]: [
    "Single sign-on is in every edition.",
    "and",
    "not",
    "refuses to start",
    "14-day trial",
    "edition label",
    "signed license token",
    "instance ID",
    "Offline activation needs a release that trusts OneUptime's license signing key.",
    "SHA-256 hash",
    "master admins",
    "SCIM, audit logging and retention overrides stop",
    "Valid license",
    "Trial or grace period",
    "After the trial or grace period",
    "stop",
    "SCIM provisioning stops.",
    "Audit logging stops recording.",
    "Retention overrides stop applying.",
    "Single sign-on.",
    "Core monitoring is never affected",
    "Master admins can always sign in with their password.",
    "Nothing is deleted.",
    "Everything resumes as soon as a license is activated",
    "If your identity provider deprovisions users through SCIM, activate a license before the trial or grace period ends.",
    "SCIM stops.",
    "SCIM team locks are lifted",
    "Audit logging stops.",
    "Enterprise settings pages show an upgrade prompt.",
    "The enterprise Health dashboards, the Query Console, and the PostgreSQL and Valkey health alerts stop.",
    "Before you switch an install whose identity provider deprovisions users through SCIM to the Community image, review who has access.",
  ],
};

/*
 * Menu paths other suites hold to the words another page writes them in:
 * the Notification Settings and AI Credits pages, which every language
 * names as its own status page Subscribers page does
 * (NotificationChannelsWhoCanDocs, ProjectBalanceWhoCanDocs).
 */
const PATHS_HELD_ELSEWHERE: Record<string, Array<string>> = {
  [PERMISSIONS_PAGE]: [
    "Project Settings > Notifications > Notification Settings",
    "Project Settings > AI > AI Credits",
  ],
};

// The pages that open on a block of cards.
const OPENS_ON_CARDS: Array<string> = [
  PUSH_PAGE,
  INBOUND_EMAIL_PAGE,
  PRIVATE_NETWORK_PAGE,
  ENTERPRISE_PAGE,
];

export const PATH_SEPARATOR: string = " > ";

// A run of bold segments with " > " between them: "**A** > **B** > **C**".
const SEGMENTED_PATH: RegExp = /\*\*[^*\n]+\*\*(?: > \*\*[^*\n]+\*\*)+/g;
const BOLD_SEGMENT: RegExp = /\*\*([^*\n]+)\*\*/g;

interface MenuPath {
  segments: Array<string>;
  // Written as one bold span, or a bold span per segment.
  segmented: boolean;
}

const TAB_LINE: RegExp = /^@tab\s+(.+)$/;
const ONLY_CODE: RegExp = /^`[^`]+`$/;
const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
/*
 * A number as a table states it: 443, 1.5. A translation may write its
 * language's decimal mark or digit group.
 */
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
// \s takes the no-break spaces French and others group digits with.
const DIGIT_GROUP: RegExp = /(\d)[\s.,'\u066c](\d{3})(?!\d)/g;
const DECIMAL_MARK: RegExp = /(\d)[,٫](\d)/g;
// A line that starts a list item, a table row, a heading, a component, an image or a quote.
const NOT_PARAGRAPH_TEXT: RegExp = /^\s*(?:[-*>|#:@]|\d+\.|!\[)/;

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed(
  lists: Record<string, Array<string>>,
  page: string,
): Array<string> {
  return lists[page] || [];
}

function adminKeys(page: string): Record<string, string> {
  return ADMIN_LABELS[page] || {};
}

function isParagraphText(line: string): boolean {
  return line.trim().length > 0 && !NOT_PARAGRAPH_TEXT.test(line);
}

// The menu paths a page names, in either way of writing them.
function menuPaths(markdown: string): Array<MenuPath> {
  const text: string = prose(markdown);
  const paths: Array<MenuPath> = [];
  const seen: Set<string> = new Set<string>();

  const add: (found: MenuPath) => void = (found: MenuPath): void => {
    const key: string = `${found.segmented}:${found.segments.join(PATH_SEPARATOR)}`;

    if (!seen.has(key)) {
      seen.add(key);
      paths.push(found);
    }
  };

  for (const match of Array.from(text.matchAll(SEGMENTED_PATH))) {
    add({
      segments: Array.from((match[0] as string).matchAll(BOLD_SEGMENT)).map(
        (segment: RegExpMatchArray): string => {
          return (segment[1] as string).trim();
        },
      ),
      segmented: true,
    });
  }

  for (const span of boldSpans(text)) {
    if (span.includes(PATH_SEPARATOR)) {
      add({
        segments: span.split(PATH_SEPARATOR).map((segment: string): string => {
          return segment.trim();
        }),
        segmented: false,
      });
    }
  }

  return paths;
}

function pathText(found: MenuPath): string {
  return found.segments.join(PATH_SEPARATOR);
}

// The bold spans of a page that are one label, not a path written in one span.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown)).filter((span: string): boolean => {
    return !span.includes(PATH_SEPARATOR);
  });
}

function isCreateButton(english: string): boolean {
  return english.startsWith("Create ") && isActionLabel(english);
}

// What a translation writes in bold for a Dashboard label written in English.
export function drawnLabel(language: string, english: string): string {
  if (isCreateButton(english)) {
    return drawnCreateButton(language, english);
  }

  return drawnActionLabel(language, english);
}

// A value of a locale file by its dotted key, or null.
function nestedValue(
  locale: Record<string, unknown>,
  key: string,
): string | null {
  let value: unknown = locale;

  for (const part of key.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[part];
  }

  return typeof value === "string" && value.trim() ? value : null;
}

const adminLocales: Map<string, Record<string, unknown>> = new Map();

function adminLocale(language: string): Record<string, unknown> {
  const cached: Record<string, unknown> | undefined =
    adminLocales.get(language);

  if (cached) {
    return cached;
  }

  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.join(
        REPO_ROOT,
        "App/FeatureSet/AdminDashboard/src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  adminLocales.set(language, locale);

  return locale;
}

// How the Admin Dashboard draws a label, by its locale key, in a language.
function adminLabel(language: string, key: string): string {
  return (
    nestedValue(adminLocale(language), key) ||
    (nestedValue(adminLocale("en"), key) as string)
  );
}

// A menu path, as a page in a language writes it.
export function drawnPath(language: string, found: MenuPath): string {
  const drawn: Array<string> = found.segments.map((segment: string): string => {
    return drawnLabel(language, segment);
  });

  if (found.segmented || language === "fa") {
    return drawn
      .map((segment: string): string => {
        return `**${segment}**`;
      })
      .join(PATH_SEPARATOR);
  }

  return `**${drawn.join(PATH_SEPARATOR)}**`;
}

// Bold words a translation keeps exactly as the English page writes them.
function keptAsWritten(page: string): Array<string> {
  return [
    ...listed(SHOWN_IN_ENGLISH, page),
    ...listed(PERMISSIONS, page),
    ...listed(RECORD_NAMES, page),
    ...listed(NAMES, page),
    ...listed(OTHER_CONSOLES, page),
    ...listed(WORKFLOW_BLOCKS, page),
    ...listed(SERVER_MESSAGES, page),
    ...listed(SYMBOLS, page),
  ];
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

// The number of :::steps steps on a page: the H3s inside its steps blocks.
function stepCount(markdown: string): number {
  let inSteps: boolean = false;
  let inFence: boolean = false;
  let steps: number = 0;

  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (line.trim() === ":::steps") {
      inSteps = true;
      continue;
    }

    if (inSteps && line.trim() === ":::") {
      inSteps = false;
      continue;
    }

    if (inSteps && line.startsWith("### ")) {
      steps++;
    }
  }

  return steps;
}

/*
 * What each line is, where it matters for laying a translation beside its
 * English page: a heading of a level, a table row, a fence, or text.
 */
function lineShape(markdown: string): Array<string> {
  return markdown.split("\n").map((line: string): string => {
    const heading: RegExpMatchArray | null = line.match(HEADING_LINE);

    if (FENCE_LINE.test(line)) {
      return "```";
    }

    if (heading) {
      return heading[1] as string;
    }

    if (line.startsWith("|")) {
      return "|";
    }

    return "";
  });
}

// Every table of a page, in order, as rows of trimmed cells (header first).
function tables(markdown: string): Array<Array<Array<string>>> {
  const found: Array<Array<Array<string>>> = [];
  let current: Array<Array<string>> | null = null;

  for (const line of prose(markdown).split("\n")) {
    if (!line.startsWith("|")) {
      current = null;
      continue;
    }

    if (!current) {
      current = [];
      found.push(current);
    }

    if (TABLE_DELIMITER_ROW.test(line)) {
      continue;
    }

    current.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return found;
}

function numbersIn(text: string): Array<string> {
  return Array.from(
    toLatinDigits(text)
      .replace(DIGIT_GROUP, "$1$2")
      .replace(DECIMAL_MARK, "$1.$2")
      .matchAll(NUMBER),
  )
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .sort();
}

function tabLabels(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .map((line: string): RegExpMatchArray | null => {
      return line.match(TAB_LINE);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    })
    .map((match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    });
}

function containersOf(markdown: string): Array<string> {
  return scanMarkdown(markdown).containers.map(
    (container: DocsContainerUse): string => {
      return container.name;
    },
  );
}

function sections(markdown: string): Array<DocsHeading> {
  return scanMarkdown(markdown).headings.filter(
    (heading: DocsHeading): boolean => {
      return heading.line !== 1;
    },
  );
}

// Whether a bold English word is a Dashboard label a translation draws.
function isDrawnLabel(page: string, english: string): boolean {
  return (
    isActionLabel(english) &&
    !keptAsWritten(page).includes(english) &&
    !listed(PROSE, page).includes(english) &&
    adminKeys(page)[english] === undefined
  );
}

/*
 * Whether a segment of a menu path is a Dashboard label a translation draws:
 * a path names the Dashboard's own screens, whatever the same word means
 * elsewhere on the page.
 */
function isDrawnSegment(page: string, segment: string): boolean {
  return (
    isActionLabel(segment) &&
    !listed(OTHER_CONSOLES, page).includes(segment) &&
    adminKeys(page)[segment] === undefined
  );
}

interface LinkIntoPage {
  from: string;
  to: string;
  anchor: string;
}

/*
 * Links into these pages from other pages: in every language they name the
 * heading in the English section's place.
 */
const LINKS_INTO_THESE_PAGES: ReadonlyArray<LinkIntoPage> = [
  {
    from: "incidents/linked-alerts",
    to: PERMISSIONS_PAGE,
    anchor: "changing-a-state",
  },
  {
    from: "incidents/states-and-severities",
    to: PERMISSIONS_PAGE,
    anchor: "changing-a-state",
  },
  {
    from: "installation/upgrading",
    to: PERMISSIONS_PAGE,
    anchor: "changing-a-state",
  },
  {
    from: "installation/upgrading",
    to: ENTERPRISE_PAGE,
    anchor: "switching-from-enterprise-to-community",
  },
  {
    from: "installation/upgrading",
    to: ENTERPRISE_PAGE,
    anchor: "when-a-license-expires-or-is-missing",
  },
  {
    from: "installation/upgrading",
    to: ENTERPRISE_PAGE,
    anchor: "offline-activation-air-gapped-installs",
  },
  {
    from: "installation/upgrading",
    to: ENTERPRISE_PAGE,
    anchor: "licensing",
  },
  {
    from: "slo/feed-and-audit-logs",
    to: ENTERPRISE_PAGE,
    anchor: "when-a-license-expires-or-is-missing",
  },
];

/*
 * The Products menu items these pages send the reader to, drawn from the
 * menu's own keys, which the pages name by the words of the flat keys.
 */
const PRODUCTS_MENU_ITEMS: ReadonlyArray<{ flat: string; key: string }> = [
  { flat: "Users", key: "navbar.items.usersTitle" },
  { flat: "Teams", key: "navbar.items.teamsTitle" },
  { flat: "Project Settings", key: "navbar.items.projectSettingsTitle" },
  { flat: "Settings", key: "navbar.categories.settings" },
];

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      SHOWN_IN_ENGLISH,
      PERMISSIONS,
      RECORD_NAMES,
      NAMES,
      OTHER_CONSOLES,
      WORKFLOW_BLOCKS,
      SERVER_MESSAGES,
      SYMBOLS,
      PROSE,
      PROSE_LEADS,
      PATHS_HELD_ELSEWHERE,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }

    for (const page of Object.keys(ADMIN_LABELS)) {
      expect(PAGE_NAMES).toContain(page);
    }
  });

  it("call prose only bold Dashboard labels the English page has", () => {
    for (const page of Object.keys(PROSE)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const label of listed(PROSE, page)) {
        expect({ page, label, ok: true }).toEqual({
          page,
          label,
          ok: labels.includes(label) && isActionLabel(label),
        });
      }
    }
  });

  /*
   * A name the Dashboard shows in English today and translates tomorrow
   * fails here: then every translation names it as drawn, and it leaves the
   * list.
   */
  it("keep in English only bold names the Dashboard has no translation for", () => {
    for (const page of Object.keys(SHOWN_IN_ENGLISH)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const name of listed(SHOWN_IN_ENGLISH, page)) {
        expect({ page, name, bold: true, label: false }).toEqual({
          page,
          name,
          bold: labels.includes(name),
          label: isActionLabel(name),
        });
      }
    }
  });

  it("list kept names, permissions and other consoles' labels the English pages really make bold", () => {
    for (const lists of [
      PERMISSIONS,
      RECORD_NAMES,
      NAMES,
      OTHER_CONSOLES,
      WORKFLOW_BLOCKS,
      SERVER_MESSAGES,
      SYMBOLS,
    ]) {
      for (const page of Object.keys(lists)) {
        const spans: Array<string> = boldSpans(prose(englishPage(page)));

        for (const name of listed(lists, page)) {
          expect({ page, name, bold: spans.includes(name) }).toEqual({
            page,
            name,
            bold: true,
          });
        }
      }
    }
  });

  it("read every Admin Dashboard label from a key the Admin Dashboard has, in English as the page writes it", () => {
    for (const page of Object.keys(ADMIN_LABELS)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const [english, key] of Object.entries(adminKeys(page))) {
        expect({ page, english, bold: true, drawn: english }).toEqual({
          page,
          english,
          bold: labels.includes(english),
          drawn: adminLabel("en", key),
        });
      }
    }
  });

  it("know every bold word on the English pages: a label, kept as written, the Admin Dashboard's, prose or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isActionLabel(span) &&
            !keptAsWritten(page).includes(span) &&
            adminKeys(page)[span] === undefined &&
            !listed(PROSE_LEADS, page).includes(span)
          );
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("list as leads only bold words the English page has, that are no Dashboard label", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const spans: Array<string> = boldLabels(englishPage(page));

      for (const lead of listed(PROSE_LEADS, page)) {
        expect({ page, lead, found: true, label: false }).toEqual({
          page,
          lead,
          found: spans.includes(lead),
          label: isActionLabel(lead),
        });
      }
    }
  });

  it("know every path on the English pages as a path of Dashboard labels, another console's, or one held elsewhere", () => {
    for (const page of PAGE_NAMES) {
      const unknown: Array<string> = menuPaths(englishPage(page))
        .filter((found: MenuPath): boolean => {
          return (
            !listed(OTHER_CONSOLES, page).includes(pathText(found)) &&
            !listed(PATHS_HELD_ELSEWHERE, page).includes(pathText(found))
          );
        })
        .filter((found: MenuPath): boolean => {
          return !found.segments.every((segment: string): boolean => {
            return (
              isDrawnSegment(page, segment) ||
              adminKeys(page)[segment] !== undefined ||
              listed(OTHER_CONSOLES, page).includes(segment)
            );
          });
        })
        .map(pathText);

      expect({ page, unknown }).toEqual({ page, unknown: [] });
    }
  });

  it("name links that the English pages really have, to headings the English pages really have", () => {
    for (const link of LINKS_INTO_THESE_PAGES) {
      expect({
        link,
        linked: englishPage(link.from).includes(
          `](/docs/${link.to}#${link.anchor})`,
        ),
        heading: anchorInLanguage("en", link.to, link.anchor),
      }).toEqual({ link, linked: true, heading: link.anchor });
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: TranslatedPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it.each(PAGES)(
    "$page draws at least one diagram, with a caption",
    (entry: TranslatedPage) => {
      const diagrams: Array<{ info: string }> = scanMarkdown(
        englishPage(entry.page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }
    },
  );

  it.each(PAGES)(
    "$page ends on a Next steps section of cards",
    (entry: TranslatedPage) => {
      const markdown: string = englishPage(entry.page);
      const scanned: ScannedPage = scanMarkdown(markdown);
      const last: DocsHeading = scanned.headings[
        scanned.headings.length - 1
      ] as DocsHeading;
      const nextSteps: string = markdown.slice(
        markdown.lastIndexOf("\n## Next steps\n"),
      );

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(cardLines(nextSteps).length).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(OPENS_ON_CARDS)(
    "%s opens on cards to its own sections",
    (page: string) => {
      const markdown: string = englishPage(page);
      const firstHeadingLine: number = (sections(markdown)[0] as DocsHeading)
        .line;
      const opening: Array<string> = cardLines(
        markdown.split("\n").slice(0, firstHeadingLine).join("\n"),
      );

      expect(opening.length).toBeGreaterThanOrEqual(3);

      for (const line of opening) {
        expect(line).toMatch(/^- \[[^\]]+\]\(#[^)]+\): /);
      }
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(PAGES)(
    "$page writes every paragraph on one line, so a translation can match it line for line",
    (entry: TranslatedPage) => {
      const wrapped: Array<string> = [];
      const lines: Array<string> = prose(englishPage(entry.page)).split("\n");

      lines.forEach((line: string, index: number): void => {
        if (isParagraphText(line) && isParagraphText(lines[index + 1] || "")) {
          wrapped.push(line);
        }
      });

      expect(wrapped).toEqual([]);
    },
  );
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

    it("lies line for line beside the English page: headings, table rows and fences on the same lines", () => {
      expect(lineShape(readPage(language, entry.page))).toEqual(
        lineShape(english),
      );
    });

    it("keeps every code block, and builds every diagram the same way", () => {
      expect(
        scanMarkdown(readPage(language, entry.page)).fences.map(
          comparableFence,
        ),
      ).toEqual(scanMarkdown(english).fences.map(comparableFence));
    });

    it("keeps every piece of inline code", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the components, and the tab labels, which are product names", () => {
      const translated: string = readPage(language, entry.page);

      expect(containersOf(translated)).toEqual(containersOf(english));
      expect(tabLabels(translated)).toEqual(tabLabels(english));
    });

    it("keeps the code in the first column of every table, row by row, and the numbers of every row", () => {
      const translated: Array<Array<Array<string>>> = tables(
        readPage(language, entry.page),
      );

      tables(english).forEach((table: Array<Array<string>>, index: number) => {
        table.forEach((row: Array<string>, rowIndex: number) => {
          const translatedRow: Array<string> =
            translated[index]?.[rowIndex] || [];

          expect({
            table: index,
            row: rowIndex,
            code: ONLY_CODE.test(row[0] as string)
              ? translatedRow[0]
              : undefined,
            numbers: numbersIn(translatedRow.join(" | ")),
          }).toEqual({
            table: index,
            row: rowIndex,
            code: ONLY_CODE.test(row[0] as string) ? row[0] : undefined,
            numbers: numbersIn(row.join(" | ")),
          });
        });
      });
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

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return isDrawnLabel(entry.page, label);
        })
        .filter((label: string): boolean => {
          return !translated.includes(`**${drawnLabel(language, label)}**`);
        })
        .map((label: string): string => {
          return `${label} -> ${drawnLabel(language, label)}`;
        });

      expect(missing).toEqual([]);
    });

    it("names every Admin Dashboard label as this language's Admin Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = Object.values(adminKeys(entry.page))
        .map((key: string): string => {
          return adminLabel(language, key);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(`**${drawn}**`);
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .filter((found: MenuPath): boolean => {
          return (
            !listed(OTHER_CONSOLES, entry.page).includes(pathText(found)) &&
            !listed(PATHS_HELD_ELSEWHERE, entry.page).includes(
              pathText(found),
            ) &&
            found.segments.every((segment: string): boolean => {
              return isDrawnSegment(entry.page, segment);
            })
          );
        })
        .map((found: MenuPath): string => {
          return drawnPath(language, found);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(drawn);
        });

      expect(missing).toEqual([]);
    });

    it("keeps in English what every Dashboard, and other consoles, show in English, and names, as written", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = keptAsWritten(entry.page).filter(
        (name: string): boolean => {
          return !translated.includes(`**${name}**`);
        },
      );

      expect(missing).toEqual([]);
    });
  });

  describe("links into these pages from other pages", () => {
    it.each(LINKS_INTO_THESE_PAGES)(
      "$from links to the heading of $to it means ($anchor)",
      (link: LinkIntoPage) => {
        if (!hasPage(language, link.from)) {
          return;
        }

        const anchor: string | null = anchorInLanguage(
          language,
          link.to,
          link.anchor,
        );

        expect(anchor).not.toBeNull();
        expect(readPage(language, link.from)).toContain(
          `](/docs/${link.to}#${anchor})`,
        );
      },
    );
  });

  it("draws the Products menu items these pages name with the flat keys' words", () => {
    const locale: Record<string, unknown> = dashboardLocale(language);

    for (const item of PRODUCTS_MENU_ITEMS) {
      expect({ item: item.flat, drawn: nestedValue(locale, item.key) }).toEqual(
        {
          item: item.flat,
          drawn: drawnActionLabel(language, item.flat),
        },
      );
    }
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add line-for-line shape, menu paths in two ways of writing them, the
 * Admin Dashboard's own labels, and links into them.
 */
describe("the helpers, on these pages' shapes", () => {
  it("find a path written in one bold span, and one written a span per segment", () => {
    const markdown: string =
      "Open **Project Settings > Basic > Labels**, or **Project Settings** > **Basic** > **Import from another tool**, and click **Add Role**.";

    expect(menuPaths(markdown)).toEqual([
      {
        segments: ["Project Settings", "Basic", "Import from another tool"],
        segmented: true,
      },
      { segments: ["Project Settings", "Basic", "Labels"], segmented: false },
    ]);
    expect(boldLabels(markdown)).toEqual([
      "Project Settings",
      "Basic",
      "Import from another tool",
      "Add Role",
    ]);
  });

  it("draw a path in the English page's way, and a bold span per segment in Persian", () => {
    const oneSpan: MenuPath = {
      segments: ["Project Settings", "Basic", "Labels"],
      segmented: false,
    };

    expect(drawnPath("en", oneSpan)).toBe(
      "**Project Settings > Basic > Labels**",
    );
    expect(drawnPath("de", oneSpan)).toBe(
      `**${[
        drawnActionLabel("de", "Project Settings"),
        drawnActionLabel("de", "Basic"),
        drawnActionLabel("de", "Labels"),
      ].join(PATH_SEPARATOR)}**`,
    );
    expect(drawnPath("fa", oneSpan)).toBe(
      [
        drawnActionLabel("fa", "Project Settings"),
        drawnActionLabel("fa", "Basic"),
        drawnActionLabel("fa", "Labels"),
      ]
        .map((segment: string): string => {
          return `**${segment}**`;
        })
        .join(PATH_SEPARATOR),
    );
  });

  it("draw a table's create button as the table does", () => {
    expect(drawnLabel("en", "Create Team")).toBe("Create Team");
    expect(drawnLabel("de", "Create Team")).toBe(
      drawnCreateButton("de", "Create Team"),
    );
    expect(drawnLabel("de", "Add Role")).toBe(
      drawnActionLabel("de", "Add Role"),
    );
  });

  it("read an Admin Dashboard label by its key", () => {
    expect(adminLabel("en", "pages.userProjects.addToProject")).toBe(
      "Add to Project",
    );
    expect(adminLabel("de", "breadcrumbs.globalLlmProviders")).not.toBe("");
  });

  it("lay a translation beside its English page by what each line is", () => {
    const page: string = ["# Title", "", "| A | B |", "| --- | --- |"].join(
      "\n",
    );
    const shifted: string = [
      "# Titel",
      "",
      "",
      "| A | B |",
      "| --- | --- |",
    ].join("\n");

    expect(lineShape(page)).toEqual(["#", "", "|", "|"]);
    expect(lineShape(shifted)).not.toEqual(lineShape(page));
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups", () => {
    expect(numbersIn("TCP 5228–5230 and 443")).toEqual(["443", "5228", "5230"]);
    expect(numbersIn("TCP ۵۲۲۸–۵۲۳۰ و ۴۴۳")).toEqual(["443", "5228", "5230"]);
    expect(numbersIn("version 1,5.0")).toEqual(["1.5", "0"].sort());
  });

  it("find a line whose code span is closed by asterisks", () => {
    const broken: string = "**Probe** / `161** on the device";

    expect(unbalancedLines(broken)).toEqual([broken]);
    expect(unbalancedLines("Use `a ** b` here.")).toEqual([]);
  });

  it("count the steps of every :::steps block, and only those", () => {
    const markdown: string = [
      "# Page",
      ":::steps",
      "### One",
      "```bash",
      "### not a step",
      "```",
      "### Two",
      ":::",
      "### After the steps",
    ].join("\n");

    expect(stepCount(markdown)).toBe(2);
  });

  it("read the tab labels of a page", () => {
    expect(
      tabLabels(
        [":::tabs", "@tab Docker Compose", "x", "@tab Kubernetes", ":::"].join(
          "\n",
        ),
      ),
    ).toEqual(["Docker Compose", "Kubernetes"]);
  });
});
