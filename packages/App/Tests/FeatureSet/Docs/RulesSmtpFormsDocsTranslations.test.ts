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
import { dashboardLocale, isDashboardLabel } from "./DocsDashboardLabels";
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
import Form from "Common/Models/DatabaseModels/Form";
import MonitorLabelRule from "Common/Models/DatabaseModels/MonitorLabelRule";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import { PermissionHelper } from "Common/Types/Permission";
import {
  DEFAULT_LANGUAGE,
  createTranslator,
  toSentenceTerm,
  translateNamedAction,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  INHERITING_LABEL_RULE_ADDS_NOTHING_MESSAGE,
  INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE,
  LABEL_RULE_ADDS_NOTHING_MESSAGE,
  OWNER_RULE_ADDS_NOTHING_MESSAGE,
} from "Common/Utils/Rules/RuleAction";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 14: Label and Owner Rules, Import and Export Label
 * Rules, Run Rules on Existing Resources, SMTP and Forms Overview, in every
 * docs language. Each translation says what the English page says - the
 * same sections, steps, tables, lists, cards, code and diagrams, links that
 * land on the heading the English link means, a title that is the nav
 * link's - and names each screen the way the screen the reader is on draws
 * it in their language.
 *
 * "The way it is drawn" has four sources on these pages:
 *
 *   - The Dashboard, Persian included, as on the on-call, runbook,
 *     workflow and identity pages, read with the Dashboard's own translator
 *     the way each control draws itself (drawnLabel): a menu item, a tab, a
 *     field, a pill or a plain button looks its text up whole and shows the
 *     English where the locale has no wording of its own; a table's create
 *     button ("Create SMTP Config") is the whole phrase, or else the
 *     "Create {{itemName}}" template with the model's name in it
 *     (translateCreateAction: MODEL_CREATE_BUTTONS). A menu path written in
 *     one bold span ("Monitors → Settings → Label Rules") is drawn segment
 *     by segment, in one span or one span a segment, joined by the English
 *     arrow or by ">" (Persian writes ">", which right-to-left text mirrors;
 *     "→" it would not).
 *   - The Admin Dashboard, where a self-hosted installation sets its own
 *     mail server: its top bar, side menu and Email page cards use keys of
 *     their own, and its form fields are looked up whole in its locale
 *     (ADMIN_KEYS, ADMIN_FLAT).
 *   - The public form page (Accounts), whose Submit button is the Accounts
 *     locale's common.submit (ACCOUNTS_KEYS).
 *   - Words the Dashboard writes from a template: the import button counts
 *     the rules (PLURAL_BUTTONS), and a new rule is named after what it adds
 *     or inherits ("Add Production", "Inherit labels from monitors, hosts"),
 *     in the creator's language (AUTO_NAMES, read with the Dashboard's own
 *     translator).
 *
 * Other names stay in English on purpose (KEPT_IN_ENGLISH): plans, roles
 * and permissions, as the API, Terraform and the role pickers name them;
 * the permission group the generated reference heads in English; workflow
 * components, which the workflow builder names in English; the labels a
 * form's default questions are stored with; option values the dropdowns
 * show as stored; and Microsoft's and Google's own consoles, whose language
 * OneUptime cannot know (EXTERNAL_CONSOLE_LABELS). What the server answers
 * in English is quoted as it is (SERVER_MESSAGES). Bold words that are
 * Dashboard labels only by coincidence are PROSE; the pages' own bold leads
 * are PROSE_LEADS. A new bold word on these English pages fails "know every
 * bold word" until it is put in one of the lists.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

interface TranslatedPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

const RULES: string = "configuration/label-and-owner-rules";
const IMPORT: string = "configuration/label-rule-import-export";
const RUN: string = "configuration/run-rules-now";
const SMTP: string = "emails/smtp";
const FORMS: string = "forms/index";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: RULES, navTitle: "Label and Owner Rules" },
  { page: IMPORT, navTitle: "Import and Export Label Rules" },
  { page: RUN, navTitle: "Run Rules on Existing Resources" },
  { page: SMTP, navTitle: "SMTP" },
  { page: FORMS, navTitle: "Forms Overview" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

const PLANS: Array<string> = ["Growth", "Scale"];

/*
 * Bold names the translations keep in English, by page, each for one of
 * the reasons the suite's opening comment gives ("keep in English only..."
 * checks which).
 */
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  [RUN]: [
    // Permissions, as the role pickers and the API name them.
    "Edit Network Device",
    "Create Network Device",
    "Create Monitor",
  ],
  [SMTP]: [
    // Roles, permissions and the plan of Send Test Email (TestSendDocs).
    "Project Owner",
    "Project Admin",
    "Create SMTP Config",
    "Read SMTP Config",
    "Growth",
    // A transport, named as the Transport dropdown and the API name it.
    "Microsoft Graph.",
    // The OAuth Provider Type options, as the dropdown shows them.
    "Client Credentials",
    "JWT Bearer",
    // Microsoft's application permissions.
    "Mail.Send",
    "SMTP.SendAsApp",
  ],
  [FORMS]: [
    "Growth",
    "Scale",
    // The Form permissions, as the role pickers name them.
    "Create Form",
    "Edit Form",
    "Delete Form",
    "Read Form",
    "Read Form Submission",
    "Delete Form Submission",
    // The group the generated Permission Reference heads them with.
    "Form",
    // Workflow components, which the workflow builder names in English.
    "On Create Form",
    "On Update Form",
    "On Create Incident",
    "On Create Scheduled Maintenance",
    // The questions an upgraded incident form got, stored with these labels.
    "Your Name",
    "Your Email",
    // The old product's screens and permissions, by the names they had.
    "Incident Forms",
    "Incident Form",
  ],
};

/*
 * Kept in English as a permission, and also a button or a page the
 * Dashboard draws: the translation names both, one for each use.
 */
const ALSO_DRAWN: Record<string, Array<string>> = {
  [SMTP]: ["Create SMTP Config"],
  [FORMS]: ["Create Form", "Delete Form"],
};

/*
 * A table's create button, by page: drawn from the "Create {{itemName}}"
 * template with the model's name when the locale has no wording for the
 * whole phrase (ModelTable's translateCreateAction).
 */
const MODEL_CREATE_BUTTONS: Record<string, Array<string>> = {
  [RULES]: ["Create Monitor Label Rule"],
  [SMTP]: ["Create SMTP Config"],
  [FORMS]: ["Create Form"],
};

const CREATE_PREFIX: string = "Create ";

// Workflow components a model gets, named after it.
const WORKFLOW_COMPONENTS: Array<string> = [
  "On Create Form",
  "On Update Form",
  "On Create Incident",
  "On Create Scheduled Maintenance",
];

// Labels a form's default questions are stored with (FormField.ts).
const STORED_QUESTION_LABELS: Array<string> = ["Your Name", "Your Email"];

// What the upgrade replaced, named as it was.
const LEGACY_NAMES: Array<string> = ["Incident Forms", "Incident Form"];

// Option values the dropdowns show as the API stores them.
const OPTION_VALUES: Array<string> = [
  "Microsoft Graph.",
  "Client Credentials",
  "JWT Bearer",
];

// Microsoft's application permissions, as Entra lists them.
const MICROSOFT_PERMISSIONS: Array<string> = ["Mail.Send", "SMTP.SendAsApp"];

/*
 * The labels of Microsoft Entra, the Google Cloud console and the Google
 * Workspace Admin console the SMTP walkthroughs click through. A translation
 * keeps each one bold and in English: OneUptime cannot know which language
 * those consoles are set to, and their English names are the ones their own
 * docs and search use.
 */
const EXTERNAL_CONSOLE_LABELS: Record<string, Array<string>> = {
  [SMTP]: [
    // Microsoft Entra admin center.
    "Identity",
    "Applications",
    "App registrations",
    "New registration",
    "Redirect URI",
    "Register",
    "Overview",
    "Application (client) ID",
    "Directory (tenant) ID",
    "Certificates & secrets",
    "New client secret",
    "Add",
    "API permissions",
    "Add a permission",
    "APIs my organization uses",
    "Office 365 Exchange Online",
    "Application permissions",
    "Add permissions",
    "Grant admin consent for [your organization]",
    // Google Cloud console.
    "New Project",
    "Create",
    "APIs & Services",
    "Library",
    "Gmail API",
    "Enable",
    "Credentials",
    "Create Credentials",
    "Service account",
    "Create and Continue",
    "Done",
    "Keys",
    "Add Key",
    "Create new key",
    "JSON",
    "Show Advanced Settings",
    "Client ID",
    "Enable Google Workspace Domain-wide Delegation",
    "Save",
    // Google Workspace Admin console.
    "Security",
    "Access and data control",
    "API Controls",
    "Manage Domain Wide Delegation",
    "Add new",
    "OAuth Scopes",
    "Authorize",
  ],
};

/*
 * The Admin Dashboard's words on the SMTP page: its top bar, side menu and
 * Email page cards, by key, and the Email Server Type field, looked up whole
 * (the Admin Dashboard's own lookup, nested keys off).
 */
const ADMIN_KEYS: Record<string, string> = {
  Settings: "navbar.settings",
  Notifications: "sideMenu.settingsNotifications",
  Emails: "sideMenu.settingsEmails",
  "Email Server Settings": "pages.settings.email.serverCardTitle",
  "Edit Server": "pages.settings.email.serverEditButton",
  "Custom Email and SMTP Settings": "pages.settings.email.smtpCardTitle",
  "Edit SMTP Config": "pages.settings.email.smtpEditButton",
};

const ADMIN_FLAT: Array<string> = ["Email Server Type"];

// The bold words of the SMTP page that name the Admin Dashboard.
const ADMIN_LABELS: Record<string, Array<string>> = {
  [SMTP]: [
    "Custom Email and SMTP Settings",
    "Settings",
    "Notifications",
    "Email Server Settings",
    "Edit Server",
    "Email Server Type",
    "Edit SMTP Config",
  ],
};

// The public form page's words, keys of the Accounts locale.
const ACCOUNTS_KEYS: Record<string, Record<string, string>> = {
  [FORMS]: { Submit: "common.submit" },
};

/*
 * The shorthand a list writes for an Inherit switch after naming the first
 * one in full, and the switch it stands for: a translation names each switch
 * in full, as its language's Dashboard draws it.
 */
const SWITCH_SHORTHAND: Record<string, Record<string, string>> = {
  [RULES]: {
    "… From Kubernetes Clusters": "Inherit Labels From Kubernetes Clusters",
    "… From Docker Hosts": "Inherit Labels From Docker Hosts",
    "… From Podman Hosts": "Inherit Labels From Podman Hosts",
    "… From Services": "Inherit Labels From Services",
  },
};

interface PluralButton {
  one: string;
  other: string;
  count: number;
}

// Buttons the Dashboard words from a count: the import dialog's.
const PLURAL_BUTTONS: Record<string, Record<string, PluralButton>> = {
  [IMPORT]: {
    "Import 2 rules": {
      one: "Import {{count}} rule",
      other: "Import {{count}} rules",
      count: 2,
    },
  },
};

/*
 * Bold words that are Dashboard labels by coincidence but are words of the
 * page here, which a translation words as its language needs.
 */
const PROSE: Record<string, Array<string>> = {
  [FORMS]: [
    // What a submission creates, said in the lead's own sentence.
    "incident",
    "scheduled maintenance event",
  ],
  [SMTP]: [
    // The authentication methods, said in the lead's list.
    "None",
  ],
};

/*
 * The bold leads of the pages' own lists, steps and sentences. They are
 * neither labels nor kept in English, so a translation words them freely;
 * listing them makes a new bold word fail until it is put in a list.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [RULES]: ["label rule", "owner rule"],
  [IMPORT]: ["⋯"],
  [RUN]: [
    "created",
    "and",
    "⋯",
    "It only adds.",
    "Every resource in the project is evaluated",
    "Existing owners are skipped",
    "Only your project's own labels are added.",
    "The rule is applied the same way as on creation",
    "Disabled rules do not run.",
    "Status page monitor rules",
    "A single run covers up to 100,000 resources.",
  ],
  [SMTP]: [
    "Username and Password",
    "OAuth 2.0",
    "OAuth fields",
    "Copy the secret value immediately",
    "service account",
    "service account email",
    "Rotate secrets regularly.",
    "Use dedicated credentials.",
    "Grant the least privilege.",
    "Monitor usage.",
    "Store secrets securely.",
  ],
  [FORMS]: [
    "A product of its own",
    "No account needed",
    "A builder, not a settings page",
    "You decide where every value comes from",
    "Hidden until someone publishes it",
    "Protected in layers",
    "Every submission kept",
    "Your own branding",
    "Templates for common cases",
    "Planned Maintenance",
    "Hidden questions",
    "A plan that includes forms.",
    "Permission to create forms.",
    "For an incident form, a severity.",
  ],
};

/*
 * What the server answers in English, whatever the reader's language, which
 * the pages quote as it is sent: the refusals of a rule that adds nothing
 * (RuleAction), the SMTP test's and the egress guard's answers, and an
 * upload outside one's project.
 */
const SERVER_MESSAGES: Record<string, Array<string>> = {
  [RULES]: [
    `| ${LABEL_RULE_ADDS_NOTHING_MESSAGE} |`,
    `| ${INHERITING_LABEL_RULE_ADDS_NOTHING_MESSAGE} |`,
    `| ${OWNER_RULE_ADDS_NOTHING_MESSAGE} |`,
    `| ${INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE} |`,
  ],
  [SMTP]: [
    ':::details "Cannot send email. Please check your SMTP config."',
    ':::details "Cannot send email with OAuth authentication"',
    ':::details "Microsoft Graph send failed"',
    ':::details "SMTP server host … could not be reached"',
  ],
  [FORMS]: ['"You can upload files only to a project you are a member of."'],
};

/*
 * Numbers each page states, which every translation states too - read
 * with Persian digits as Latin ones and thousands separators dropped.
 */
const NUMBERS: Record<string, Array<string>> = {
  [IMPORT]: ["10", "2"],
  [RUN]: ["100000"],
  [SMTP]: ["587", "465", "24"],
  [FORMS]: ["512", "128", "100", "50"],
};

// The English names a rule is filled in with, and how the Dashboard words them.
interface AutoName {
  english: string;
  name: (translator: Translator) => string;
}

const INHERIT_LABELS_TEMPLATE: string = "Inherit labels from {{sources}}";

// A rule that only inherits, named as ResourceRuleForm.getInheritingRuleName names it.
function inheritingName(
  translator: Translator,
  terms: Array<string>,
): string {
  const isTranslated: boolean = translator.hasTranslation(
    INHERIT_LABELS_TEMPLATE,
  );
  // The sources are in English when the sentence is (getInheritingRuleName).
  const sources: string = terms
    .map((term: string): string => {
      return isTranslated
        ? translator.translateTerm(term, { inSentence: true })
        : toSentenceTerm(term, DEFAULT_LANGUAGE);
    })
    .join(", ");

  return translator.translateTemplate(INHERIT_LABELS_TEMPLATE, {
    sources: sources,
  });
}

const AUTO_NAMES: Record<string, Array<AutoName>> = {
  [RULES]: [
    {
      english: "Add Production",
      name: (translator: Translator): string => {
        return translator.translateTemplate("Add {{labels}}", {
          labels: "Production",
        });
      },
    },
    {
      english: "Add Platform as owners",
      name: (translator: Translator): string => {
        return translator.translateTemplate("Add {{owners}} as owners", {
          owners: "Platform",
        });
      },
    },
    {
      english: "Inherit labels from monitors",
      name: (translator: Translator): string => {
        return inheritingName(translator, ["Monitors"]);
      },
    },
    {
      english: "Inherit labels from monitors, hosts",
      name: (translator: Translator): string => {
        return inheritingName(translator, ["Monitors", "Hosts"]);
      },
    },
    {
      english: "Inherit labels from monitor",
      name: (translator: Translator): string => {
        return inheritingName(translator, ["Monitor"]);
      },
    },
  ],
};

const REGEX_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;
const NUMBER: RegExp = /\d+/g;
const THOUSANDS: RegExp = /(\d)[,.٬   '](?=\d{3}\b)/g;
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
// A menu path in one bold span: "Monitors → Settings → Label Rules".
const PATH_SEPARATOR: RegExp = / (?:→|>) /;
const ITALIC_NAME: RegExp = /(?:^|[^\w*])[_*]([^_*\n]+)[_*](?![\w*])/g;

function englishPage(page: string): string {
  return readPage("en", page);
}

function readLocale(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

const localeCache: Map<string, Record<string, unknown>> = new Map();

function appLocale(app: string, language: string): Record<string, unknown> {
  const key: string = `${app}/${language}`;
  const cached: Record<string, unknown> | undefined = localeCache.get(key);

  if (cached) {
    return cached;
  }

  const locale: Record<string, unknown> = readLocale(
    path.join(PACKAGES_DIR, `App/FeatureSet/${app}/src/Locales`, `${language}.json`),
  );

  localeCache.set(key, locale);

  return locale;
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

// How the Admin Dashboard draws one of the SMTP page's words.
function adminLabel(language: string, english: string): string {
  const locale: Record<string, unknown> = appLocale("AdminDashboard", language);
  const key: string | undefined = ADMIN_KEYS[english];

  if (key) {
    return nestedValue(locale, key) || english;
  }

  const value: unknown = locale[english];

  return typeof value === "string" && value.trim() ? value : english;
}

// The Dashboard's own translator, as it runs in this language.
function dashboardTranslator(language: string): Translator {
  const locale: Record<string, unknown> = dashboardLocale(language);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, language);
}

/*
 * How the Dashboard draws a label of a page in this language: a table's
 * create button as translateCreateAction draws it, everything else looked
 * up whole, in English where the locale has no wording of its own.
 */
function drawnLabel(language: string, page: string, english: string): string {
  const translator: Translator = dashboardTranslator(language);

  if (listed(MODEL_CREATE_BUTTONS, page).includes(english)) {
    return translateNamedAction(translator, {
      template: "Create {{itemName}}",
      itemName: english.slice(CREATE_PREFIX.length),
    });
  }

  return translator.translateText(english) || english;
}

// How the Dashboard words a counted button in this language.
function pluralButton(language: string, button: PluralButton): string {
  return dashboardTranslator(language).translatePlural(
    { one: button.one, other: button.other },
    button.count,
  );
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

function keysOf<T>(lists: Record<string, Record<string, T>>, page: string): Array<string> {
  return Object.keys(lists[page] || {});
}

// The bold spans of a page that are menu paths.
function pathsOf(page: string): Array<string> {
  return boldLabels(englishPage(page)).filter((span: string): boolean => {
    return PATH_SEPARATOR.test(span);
  });
}

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

/*
 * A path's segments, as the screen it runs through draws them: the Admin
 * Dashboard's own words after "Admin Dashboard" (and on the SMTP page's
 * "Notifications > Emails", which the Admin Dashboard's side menu holds),
 * the Dashboard's otherwise.
 */
function drawnSegments(language: string, page: string, english: string): Array<string> {
  const segments: Array<string> = english.split(PATH_SEPARATOR);
  const isAdmin: boolean =
    segments[0] === "Admin Dashboard" ||
    (page === SMTP && english === "Notifications > Emails");

  return segments.map((segment: string): string => {
    if (segment === "Admin Dashboard" || segment === "⋯") {
      return segment;
    }

    return isAdmin
      ? adminLabel(language, segment)
      : drawnLabel(language, page, segment);
  });
}

/*
 * A path drawn in a translation: its segments in order, in one bold span or
 * one span a segment, joined by "→" or ">".
 */
function pathPattern(segments: Array<string>): RegExp {
  return new RegExp(
    `\\*\\*${segments
      .map((segment: string): string => {
        return escapeRegex(segment);
      })
      .join("(?:\\*\\* | )(?:→|>)(?: \\*\\*| )")}\\*\\*`,
  );
}

/*
 * The labels of a page that are not drawn by the Dashboard here: another
 * product's, kept in English, the Admin Dashboard's, the public page's, the
 * prose, the paths and the shorthand, which are checked their own ways.
 */
function notDashboardLabels(page: string): Array<string> {
  return [
    ...listed(EXTERNAL_CONSOLE_LABELS, page),
    ...listed(KEPT_IN_ENGLISH, page).filter((name: string): boolean => {
      return !listed(ALSO_DRAWN, page).includes(name);
    }),
    ...listed(PROSE, page),
    ...listed(ADMIN_LABELS, page),
    ...keysOf(ACCOUNTS_KEYS, page),
    ...keysOf(SWITCH_SHORTHAND, page),
    ...keysOf(PLURAL_BUTTONS, page),
    ...pathsOf(page),
  ];
}

// Every number a page's prose states, as Latin digits without separators.
function statedNumbers(markdown: string): Set<string> {
  const text: string = toLatinDigits(prose(markdown)).replace(THOUSANDS, "$1");

  return new Set(text.match(NUMBER) || []);
}

// The prose lines that open a bold or code span and never close it.
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

// The steps of every :::steps block: the headings inside them.
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

// The names a page writes in italics, as written.
function italicNames(markdown: string): Array<string> {
  return Array.from(prose(markdown).matchAll(ITALIC_NAME)).map(
    (match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    },
  );
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      KEPT_IN_ENGLISH,
      ALSO_DRAWN,
      EXTERNAL_CONSOLE_LABELS,
      ADMIN_LABELS,
      ACCOUNTS_KEYS,
      SWITCH_SHORTHAND,
      PLURAL_BUTTONS,
      PROSE,
      PROSE_LEADS,
      SERVER_MESSAGES,
      NUMBERS,
      AUTO_NAMES,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("list only bold words the English page has", () => {
    for (const lists of [
      KEPT_IN_ENGLISH,
      ALSO_DRAWN,
      EXTERNAL_CONSOLE_LABELS,
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

    for (const lists of [ACCOUNTS_KEYS, SWITCH_SHORTHAND, PLURAL_BUTTONS]) {
      for (const page of Object.keys(lists)) {
        const labels: Array<string> = boldLabels(englishPage(page));

        for (const label of keysOf(
          lists as Record<string, Record<string, unknown>>,
          page,
        )) {
          expect({ page, label, bold: true }).toEqual({
            page,
            label,
            bold: labels.includes(label),
          });
        }
      }
    }
  });

  it("keep in English only plans, roles and permissions, and names the product keeps in English", () => {
    for (const page of Object.keys(KEPT_IN_ENGLISH)) {
      for (const name of KEPT_IN_ENGLISH[page] as Array<string>) {
        expect({ page, name, why: true }).toEqual({
          page,
          name,
          why:
            PLANS.includes(name) ||
            isPermissionOrRole(name) ||
            name === "Form" ||
            WORKFLOW_COMPONENTS.includes(name) ||
            STORED_QUESTION_LABELS.includes(name) ||
            LEGACY_NAMES.includes(name) ||
            OPTION_VALUES.includes(name) ||
            MICROSOFT_PERMISSIONS.includes(name),
        });
      }
    }

    // A label kept in English for one use and drawn for another is both.
    for (const page of Object.keys(ALSO_DRAWN)) {
      for (const name of ALSO_DRAWN[page] as Array<string>) {
        expect(listed(KEPT_IN_ENGLISH, page)).toContain(name);
        expect({ name, permission: true, label: true }).toEqual({
          name,
          permission: isPermissionOrRole(name),
          label: isDashboardLabel(name),
        });
      }
    }
  });

  it("name as create buttons only the tables' create buttons, after the models they create", () => {
    expect(listed(MODEL_CREATE_BUTTONS, RULES)).toEqual([
      `${CREATE_PREFIX}${new MonitorLabelRule().singularName}`,
    ]);
    expect(listed(MODEL_CREATE_BUTTONS, SMTP)).toEqual([
      `${CREATE_PREFIX}${new ProjectSmtpConfig().singularName}`,
    ]);
    expect(listed(MODEL_CREATE_BUTTONS, FORMS)).toEqual([
      `${CREATE_PREFIX}${new Form().singularName}`,
    ]);

    for (const page of Object.keys(MODEL_CREATE_BUTTONS)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const button of MODEL_CREATE_BUTTONS[page] as Array<string>) {
        expect({ page, button, bold: true }).toEqual({
          page,
          button,
          bold: labels.includes(button),
        });
        expect(isDashboardLabel(button)).toBe(true);
      }
    }
  });

  it("name the workflow components the Form model gets, and the questions' stored labels as the code stores them", () => {
    const form: Form = new Form();

    expect(form.enableWorkflowOn).toEqual(
      expect.objectContaining({ create: true, update: true }),
    );
    expect(WORKFLOW_COMPONENTS).toContain(`On Create ${form.singularName}`);
    expect(WORKFLOW_COMPONENTS).toContain(`On Update ${form.singularName}`);

    const formField: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "Common/Types/Form/FormField.ts"),
      "utf8",
    );

    for (const label of STORED_QUESTION_LABELS) {
      expect(formField).toContain(`defaultLabel: "${label}",`);
    }

    // The group the generated reference heads the Form permissions with.
    expect(
      PermissionHelper.getAllPermissionProps().some(
        (props: { title: string; group: string }): boolean => {
          return props.title === "Create Form" && props.group === "Form";
        },
      ),
    ).toBe(true);
  });

  it("call prose only Dashboard labels, and leads only what is no label at all", () => {
    for (const page of Object.keys(PROSE)) {
      for (const label of PROSE[page] as Array<string>) {
        expect({ page, label, isLabel: true }).toEqual({
          page,
          label,
          isLabel: isDashboardLabel(label),
        });
      }
    }

    for (const page of Object.keys(PROSE_LEADS)) {
      for (const lead of PROSE_LEADS[page] as Array<string>) {
        expect({ page, lead, isLabel: false }).toEqual({
          page,
          lead,
          isLabel: isDashboardLabel(lead),
        });
      }
    }
  });

  it("name keys the locales have, and the switches the shorthand stands for", () => {
    for (const [english, key] of Object.entries(ADMIN_KEYS)) {
      expect({
        english,
        value: nestedValue(appLocale("AdminDashboard", "en"), key),
      }).toEqual({ english, value: english });
    }

    for (const english of ADMIN_FLAT) {
      expect(appLocale("AdminDashboard", "en")[english]).toBe(english);
    }

    for (const page of Object.keys(ADMIN_LABELS)) {
      for (const label of ADMIN_LABELS[page] as Array<string>) {
        expect({ label, known: true }).toEqual({
          label,
          known: Boolean(ADMIN_KEYS[label]) || ADMIN_FLAT.includes(label),
        });
      }
    }

    for (const page of Object.keys(ACCOUNTS_KEYS)) {
      for (const [english, key] of Object.entries(
        ACCOUNTS_KEYS[page] as Record<string, string>,
      )) {
        expect(nestedValue(appLocale("Accounts", "en"), key)).toBe(english);
      }
    }

    for (const page of Object.keys(SWITCH_SHORTHAND)) {
      for (const [shorthand, full] of Object.entries(
        SWITCH_SHORTHAND[page] as Record<string, string>,
      )) {
        expect(isDashboardLabel(full)).toBe(true);
        expect(full.endsWith(shorthand.replace("… ", " "))).toBe(true);
      }
    }

    for (const page of Object.keys(PLURAL_BUTTONS)) {
      for (const [english, button] of Object.entries(
        PLURAL_BUTTONS[page] as Record<string, PluralButton>,
      )) {
        expect(dashboardLocale("en")[button.other]).toBe(button.other);
        expect(pluralButton("en", button)).toBe(english);
      }
    }
  });

  it("draw every path's segments from a locale that has them", () => {
    for (const page of PAGE_NAMES) {
      for (const english of pathsOf(page)) {
        for (const segment of drawnSegments("en", page, english)) {
          expect({ english, segment, known: true }).toEqual({
            english,
            segment,
            known:
              segment === "Admin Dashboard" ||
              segment === "⋯" ||
              isDashboardLabel(segment) ||
              Boolean(ADMIN_KEYS[segment]),
          });
        }
      }
    }
  });

  it("know every bold word on the English pages", () => {
    for (const page of PAGE_NAMES) {
      const known: Array<string> = [
        ...notDashboardLabels(page),
        ...listed(KEPT_IN_ENGLISH, page),
        ...listed(PROSE_LEADS, page),
      ];
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !isDashboardLabel(span) && !known.includes(span);
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("quote messages, numbers and names the English pages really have", () => {
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

    const english: Translator = dashboardTranslator("en");

    for (const page of Object.keys(AUTO_NAMES)) {
      const italics: Array<string> = italicNames(englishPage(page));

      for (const entry of AUTO_NAMES[page] as Array<AutoName>) {
        expect(entry.name(english)).toBe(entry.english);
        expect(italics).toContain(entry.english);
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

  it.each(PAGES)(
    "$page draws its flow as a diagram with a caption, and walks its set-up in steps",
    (entry: TranslatedPage) => {
      const markdown: string = englishPage(entry.page);
      const diagrams: Array<{ info: string }> = scanMarkdown(
        markdown,
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }

      expect(markdown).toContain(":::steps");
    },
  );
});

describe.each(LANGUAGES)("%s translation", (language: string) => {
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

    it("keeps every piece of inline code", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
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
          return isDashboardLabel(label) && !exceptions.includes(label);
        })
        .filter((label: string): boolean => {
          return !translated.includes(
            `**${drawnLabel(language, entry.page, label)}**`,
          );
        })
        .map((label: string): string => {
          return `${label} -> ${drawnLabel(language, entry.page, label)}`;
        });

      expect(missing).toEqual([]);
    });

    it("writes every menu path segment by segment, as the screens draw them", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = pathsOf(entry.page)
        .map((english: string): Array<string> => {
          return drawnSegments(language, entry.page, english);
        })
        .filter((segments: Array<string>): boolean => {
          return !pathPattern(segments).test(translated);
        })
        .map((segments: Array<string>): string => {
          return segments.join(" > ");
        });

      expect(missing).toEqual([]);
    });

    it("names the Admin Dashboard, the public form page, the full switches and the counted buttons as they draw themselves", () => {
      const translated: string = readPage(language, entry.page);
      const drawn: Array<string> = [
        ...listed(ADMIN_LABELS, entry.page).map((label: string): string => {
          return adminLabel(language, label);
        }),
        ...Object.values(ACCOUNTS_KEYS[entry.page] || {}).map(
          (key: string): string => {
            return nestedValue(appLocale("Accounts", language), key) as string;
          },
        ),
        ...Object.values(SWITCH_SHORTHAND[entry.page] || {}).map(
          (full: string): string => {
            return drawnLabel(language, entry.page, full);
          },
        ),
      ];
      const missing: Array<string> = drawn.filter((label: string): boolean => {
        return !translated.includes(`**${label}**`);
      });

      for (const button of Object.values(PLURAL_BUTTONS[entry.page] || {})) {
        const label: string = pluralButton(language, button);

        if (!toLatinDigits(translated).includes(`**${toLatinDigits(label)}**`)) {
          missing.push(label);
        }
      }

      expect(missing).toEqual([]);
    });

    it("names a rule the way the Dashboard fills its name in, in this language", () => {
      const translator: Translator = dashboardTranslator(language);
      const italics: Array<string> = italicNames(readPage(language, entry.page));
      const missing: Array<string> = (AUTO_NAMES[entry.page] || [])
        .map((name: AutoName): string => {
          return name.name(translator);
        })
        .filter((name: string): boolean => {
          return !italics.includes(name);
        });

      expect(missing).toEqual([]);
    });

    it("keeps in English what stays English: other consoles, plans, roles, permissions and stored names", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(EXTERNAL_CONSOLE_LABELS, entry.page),
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
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these check
 * the page-specific readers.
 */
describe("the helpers, on these pages' shapes", () => {
  it("draw a path in one span or a span a segment, joined by → or >", () => {
    const pattern: RegExp = pathPattern(["Überwachung", "Einstellungen"]);

    expect(pattern.test("**Überwachung → Einstellungen**")).toBe(true);
    expect(pattern.test("**Überwachung** > **Einstellungen**")).toBe(true);
    expect(pattern.test("**Überwachung** → **Einstellungen**")).toBe(true);
    expect(pattern.test("**Einstellungen → Überwachung**")).toBe(false);
    expect(pattern.test("**Überwachung**, **Einstellungen**")).toBe(false);
  });

  it("draw a table's create button from the template where the phrase has no wording, and a plain button as its locale has it", () => {
    // Italian has no wording for "Create SMTP Config": the template is filled.
    expect(dashboardLocale("it")["Create SMTP Config"]).toBeUndefined();
    expect(drawnLabel("it", SMTP, "Create SMTP Config")).toBe(
      "Crea: SMTP Configurazione",
    );
    // A whole phrase the locale words is taken as it is.
    expect(drawnLabel("de", FORMS, "Create Form")).toBe("Formular erstellen");
    // A plain button the locale leaves in English is drawn in English.
    expect(dashboardLocale("it")["Export JSON"]).toBe("Export JSON");
    expect(drawnLabel("it", IMPORT, "Export JSON")).toBe("Export JSON");
    expect(drawnLabel("de", IMPORT, "Export JSON")).toBe("JSON exportieren");
  });

  it("read the Admin Dashboard's words from its own locale", () => {
    expect(adminLabel("de", "Emails")).toBe("E-Mails");
    expect(adminLabel("de", "Edit Server")).toBe("Server bearbeiten");
    expect(adminLabel("ja", "Email Server Type")).toBe("メールサーバーの種類");
    expect(drawnSegments("de", SMTP, "Admin Dashboard > Settings > Notifications > Emails")).toEqual([
      "Admin Dashboard",
      "Einstellungen",
      "Benachrichtigungen",
      "E-Mails",
    ]);
  });

  it("count the import button the way the Dashboard does, its own digits included", () => {
    const button: PluralButton = {
      one: "Import {{count}} rule",
      other: "Import {{count}} rules",
      count: 2,
    };

    expect(pluralButton("en", button)).toBe("Import 2 rules");
    expect(pluralButton("ja", button)).toBe("2 件のルールをインポート");
    expect(toLatinDigits(pluralButton("fa", button))).toBe("Import 2 rules");
  });

  it("name a rule that only inherits in the creator's language, and in English where the sentence is", () => {
    const german: Translator = dashboardTranslator("de");

    expect(inheritingName(german, ["Monitors", "Hosts"])).toBe(
      "Beschriftungen erben von: Monitore, Hosts",
    );
    expect(inheritingName(dashboardTranslator("en"), ["Monitors", "Hosts"])).toBe(
      "Inherit labels from monitors, hosts",
    );
  });

  it("read italic names written with underscores or asterisks", () => {
    expect(
      italicNames("Named _Add Production_ or *Production hinzufügen*, never x_y_z."),
    ).toEqual(["Add Production", "Production hinzufügen"]);
  });

  it("read numbers in any digits, without thousands separators", () => {
    expect(
      Array.from(statedNumbers("Bis zu 100.000 Ressourcen, ۵۸۷ و 1,000.")),
    ).toEqual(["100000", "587", "1000"]);
  });
});
