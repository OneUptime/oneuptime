import FormMessage from "../../../FeatureSet/Accounts/src/Utils/FormMessage";
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
import { TEST_NOTIFICATION_PERMISSION_MESSAGE } from "Common/Server/API/TestSendAccess";
import { FORM_FOREIGN_PAGE_MESSAGE, FORM_SUBMISSION_BODY_MESSAGE } from "Common/Server/API/FormAPI";
import { getFormSubmissionNote } from "Common/Server/Utils/Form/FormSubmissionNote";
import MicrosoftTeamsIncidentActions from "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsOnCallDutyActions from "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/OnCallDutyPolicy";
import { MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE } from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import SlackIncidentActions from "Common/Server/Utils/Workspace/Slack/Actions/Incident";
import WorkspaceActionAuthorization from "Common/Server/Utils/Workspace/WorkspaceActionAuthorization";
import {
  FORM_FAVICON_NOT_FOUND_MESSAGE,
  FORM_FAVICON_TOO_LARGE_MESSAGE,
  FORM_FAVICON_TYPE_MESSAGE,
  FORM_LOGO_NOT_FOUND_MESSAGE,
  FORM_LOGO_TOO_LARGE_MESSAGE,
  FORM_LOGO_TYPE_MESSAGE,
} from "Common/Types/Form/FormBranding";
import { PermissionHelper } from "Common/Types/Permission";
import {
  TemplateValues,
  Translator,
  createTranslator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 19: the Slack, Microsoft Teams and Video Calls pages,
 * and Building a Form, What a Submission Creates and Sharing & Security, in
 * every docs language. Each translation says what the English page says,
 * line for line - the same sections, steps, tables, lists, cards, callouts,
 * code and diagrams, each on the English one's line, links that land on a
 * heading in the reader's language, a title that is the nav link's - and
 * names each screen the way the screen the reader is on draws it in their
 * language.
 *
 * "The way it is drawn" has these sources on these pages:
 *
 *   - The Dashboard, Persian included (drawnActionLabel): a bold label is
 *     its value in that language's Dashboard locale, or the English where
 *     the locale has none. A table's create button is the whole phrase, or
 *     else the "Create {{itemName}}" template with the row's name in it
 *     (drawnCreateButton). A label the Dashboard fills from a template - "Use
 *     your own Zoom app", "Start a video call for the incident" - is filled
 *     the same way (TEMPLATE_LABELS), and a question's badge or a template's
 *     chip is put together from its parts (COMPOSED_LABELS). A menu path
 *     ("**Incidents** > **Workspace** > **Slack**") is drawn segment by
 *     segment, a product by the Products menu's own title for it.
 *   - The public form page (Accounts): its labels and the sentences it shows
 *     a submitter, from its own locale (ACCOUNTS_LABELS, PUBLIC_PAGE_MESSAGES).
 *
 * Other names stay in English on purpose (KEPT_IN_ENGLISH, by page): roles,
 * permissions and plans, as the role pickers and the API name them; the
 * Slack and Microsoft Teams apps' own buttons and controls, and the bot's
 * replies, which they show in English; the consoles of Zoom, Google and
 * Microsoft the video call guides click through, whose language OneUptime
 * cannot know; brand names; workflow components; a state's name as the
 * project stores it; and the private note the server writes. Labels every
 * Dashboard shows in English because it has no key for them are
 * SHOWN_IN_ENGLISH. What a server or a chat bot answers in English is quoted
 * as it is sent (SERVER_MESSAGES).
 *
 * Bold words that are Dashboard labels by coincidence are PROSE; the pages'
 * own bold leads are PROSE_LEADS. A new bold word on these English pages
 * fails "know every bold word" until it is put in one of the lists.
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

const SLACK: string = "workspace-connections/slack";
const TEAMS: string = "workspace-connections/microsoft-teams";
const VIDEO: string = "workspace-connections/video-calls";
const BUILDING: string = "forms/building";
const ON_SUBMIT: string = "forms/on-submit";
const SHARING: string = "forms/sharing-and-security";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: SLACK, navTitle: "Slack" },
  { page: TEAMS, navTitle: "Microsoft Teams" },
  { page: VIDEO, navTitle: "Video Calls" },
  { page: BUILDING, navTitle: "Building a Form" },
  { page: ON_SUBMIT, navTitle: "What a Submission Creates" },
  { page: SHARING, navTitle: "Sharing & Security" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// The pages the group's links point into, besides its own.
const FORMS_OVERVIEW: string = "forms/index";

const PLANS: Array<string> = ["Growth", "Scale"];

/*
 * The Slack and Microsoft Teams buttons and pickers on OneUptime's messages
 * and cards, which the apps draw in English whatever the reader's language.
 */
const CHAT_BUTTONS: Array<string> = [
  "Acknowledge",
  "Resolve",
  "Change State",
  "Add Note",
  "Execute On-Call Policy",
  "Mark as Ongoing",
  "Mark as Complete",
];

// Microsoft Teams cards' own Escalate, and the lead of the bullet about it.
const TEAMS_CARD_BUTTONS: Array<string> = ["Escalate", "Escalate."];

// Slack's own controls and the app's shortcuts, by the names Slack shows.
const SLACK_CONTROLS: Array<string> = [
  "Pin to channel",
  "Create New Incident",
  "Create Scheduled Event",
];

// Microsoft Teams' own menus and buttons, as Teams names them.
const TEAMS_CONTROLS: Array<string> = [
  "Manage team",
  "Apps",
  "More apps",
  "OneUptime",
  "Add",
  "Add to a team",
  "Manage channel",
  "Add an app",
];

/*
 * The consoles of Zoom, Google and Microsoft that the video call guides
 * click through, and the scopes and permissions they grant, as each console
 * names them.
 */
const PROVIDER_CONSOLES: Array<string> = [
  // Zoom App Marketplace.
  "Server-to-Server OAuth",
  "Develop",
  "Build App",
  "Scopes",
  "meeting:write:meeting:admin",
  "meeting:write:admin",
  "Activate",
  "Account ID",
  "Client ID",
  "Client secret",
  "App Credentials",
  "Waiting room",
  "General App",
  "Basic Information",
  "Development",
  "Production",
  "Deauthorization Notification",
  "Features",
  "Access",
  "Secret Token",
  // Google Cloud console and Google Admin console.
  "Google Meet REST API",
  "IAM & Admin",
  "Service accounts",
  "Keys",
  "Add key",
  "Create new key",
  "JSON",
  "Security",
  "Access and data control",
  "API controls",
  "Manage Domain Wide Delegation",
  "Add new",
  "Google Auth Platform",
  "Web application",
  // Microsoft Entra admin center and My Apps.
  "My Apps",
  "Enterprise applications",
  "Admin consent requests",
  "App registrations",
  "New registration",
  "Directory (tenant) ID",
  "Application (client) ID",
  "API permissions",
  "application",
  "OnlineMeetings.ReadWrite.All",
  "Grant admin consent",
  "Certificates & secrets",
  "Value",
  "Object ID",
  "Users",
  "Accounts in any organizational directory",
  "Web",
];

// Brand names.
const BRANDS: Array<string> = ["Zoom", "Google Meet"];

const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  [SLACK]: ["Growth", ...CHAT_BUTTONS, ...SLACK_CONTROLS],
  [TEAMS]: ["Growth", ...CHAT_BUTTONS, ...TEAMS_CARD_BUTTONS, ...TEAMS_CONTROLS],
  [VIDEO]: [...PROVIDER_CONSOLES, ...BRANDS],
  [BUILDING]: [],
  [ON_SUBMIT]: [
    // A workflow component, as the workflow builder names it.
    "On Create Incident",
    // A state's name as the project stores it.
    "Scheduled",
    // The private note, word for word as the server writes it.
    "Report a Problem",
    "Which office are you in?",
    "Application Outage",
  ],
  [SHARING]: [...PLANS],
};

/*
 * Named two ways on one page: kept in English (or drawn by the public form
 * page) for one use, and drawn by the Dashboard for another. The
 * translation names it the Dashboard's way at least once.
 */
const ALSO_DRAWN: Record<string, Array<string>> = {
  // Zoom's App Credentials field, and the connection form's field.
  [VIDEO]: ["Client secret"],
  // The public page's button, and the preview's.
  [BUILDING]: ["Submit"],
};

/*
 * Labels the Dashboard shows in English in every language, because its
 * locales have no key for them.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [SLACK]: [
    "Connect my account with Slack",
    "Post to Existing Slack Channel",
    "Create Slack Channel",
    "New Slack Channel Name",
  ],
  [TEAMS]: ["New Microsoft Teams Channel Name"],
  [VIDEO]: [
    "Who can join",
    "Who skips the lobby",
    "People in your organization join directly, others ask to join",
    "Anyone with the link joins directly",
    "People in your organization skip the lobby",
    "Everyone skips the lobby",
    "Meeting host",
    "Service account JSON key",
    "Create meetings as",
    "Organizer object ID",
  ],
};

interface TemplateLabel {
  template: string;
  values: TemplateValues;
}

// Labels the Dashboard fills from a template, with what it fills in.
const TEMPLATE_LABELS: Record<string, Record<string, TemplateLabel>> = {
  [VIDEO]: {
    "Start a video call for the incident": {
      template: "Start a video call for the {{eventNoun}}",
      values: {
        eventNoun: translatableTerm("incident", { inSentence: true }),
      },
    },
    "Continue to Zoom": {
      template: "Continue to {{signInWith}}",
      values: { signInWith: "Zoom" },
    },
    "Use your own Zoom app": {
      template: "Use your own {{provider}} app",
      values: { provider: "Zoom" },
    },
  },
};

/*
 * A question's badge and a template's chip, put together from a label and
 * a name: each part a Dashboard label, or null for a name somebody gave -
 * a custom field's, a question's - which a translation words its own way.
 */
const COMPOSED_LABELS: Record<string, Record<string, Array<string | null>>> =
  {
    [BUILDING]: {
      "Incident · Severity": ["Incident", "Severity"],
      "Custom Field · Region": ["Custom Field", null],
      "Submitter · Email": ["Submitter", "Email"],
      "Scheduled Maintenance Date · Hidden": [null, "Hidden"],
      // Duplicate names the copy after the template, with a number.
      "Application Outage 2": ["Application Outage 2"],
    },
  };

const COMPOSED_SEPARATOR: string = " · ";

// A table's create button: the Dashboard draws it from the row's name.
const TABLE_CREATE_BUTTONS: Record<string, Array<string>> = {};

// The public form page's labels, by the Accounts locale key it draws them with.
const ACCOUNTS_LABELS: Record<string, Record<string, string>> = {
  [BUILDING]: {
    "Start from a template": "form.templateLabel",
    "Submit another response": "form.submitAnother",
    Submit: "common.submit",
  },
};

/*
 * Bold words that are Dashboard labels by coincidence but are words of the
 * page here, which a translation words as its language needs.
 */
const PROSE: Record<string, Array<string>> = {
  [ON_SUBMIT]: [
    // What a submission creates, said in the lead's own sentence.
    "incident",
    "scheduled maintenance event",
  ],
};

/*
 * The bold leads of the pages' own lists, steps and sentences. They are
 * neither labels nor kept in English, so a translation words them freely.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [SLACK]: [
    "The project's connection",
    "Each person's own connection",
    "A role that may connect the project:",
    "A Slack workspace",
    "The Growth plan on OneUptime Cloud",
    "On a self-hosted server,",
    "Who may use them.",
    "What a form offers.",
    "What a form may name.",
    "Which records.",
    "What Change State offers.",
  ],
  [TEAMS]: [
    "The project's connection",
    "The OneUptime app in each team",
    "Each person's own connection",
    "A role that may connect the project:",
    "A Microsoft 365 administrator",
    "The Growth plan on OneUptime Cloud",
    "On a self-hosted server,",
    "team name",
    "Private channels",
    "Shared channels",
    "Who may use them.",
    "What a form offers.",
    "What a form may name.",
    "Which records.",
    "What Change State offers.",
  ],
  [VIDEO]: [],
  [BUILDING]: [
    "The form's header",
    "The questions",
    "Limits.",
    "Choices Offered.",
    "The incident's Description",
    "A custom field your workflows or rules read",
    "A question of the form's own",
    "Planned Maintenance",
    // The first of the picker's choices, which it draws with the setting.
    "Form default",
  ],
  [ON_SUBMIT]: [
    "No severity, no incident.",
    "Mind the monitors.",
    "Hidden from status pages.",
    "Declared by nobody.",
    "Its owners are told.",
    "A private note records the submission",
    "Mentions notify nobody.",
    "Images become links.",
    "Diagrams become code.",
    "The title is plain text.",
  ],
  [SHARING]: ["Opening a form", "Submitting, per address", "Submitting, per form"],
};

/*
 * What a server or a chat bot answers in English, whatever the reader's
 * language, which the pages quote as it is sent.
 */
const SERVER_MESSAGES: Record<string, Array<string>> = {
  [SLACK]: [
    TEST_NOTIFICATION_PERMISSION_MESSAGE,
    WorkspaceActionAuthorization.NOT_FOUND_OR_NOT_READABLE,
    SlackIncidentActions.NO_STATES_MESSAGE,
    "There is no later state to move this incident to.",
  ],
  [TEAMS]: [
    TEST_NOTIFICATION_PERMISSION_MESSAGE,
    WorkspaceActionAuthorization.NOT_FOUND_OR_NOT_READABLE,
    MicrosoftTeamsIncidentActions.NO_STATES_MESSAGE,
    "There is no later state to move this incident to.",
    MicrosoftTeamsOnCallDutyActions.ESCALATE_NEEDS_RECORD_MESSAGE,
    MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE.split("(")[0]!.trim(),
    "Please pick it again.",
  ],
  [BUILDING]: [
    FORM_LOGO_TYPE_MESSAGE,
    FORM_LOGO_TOO_LARGE_MESSAGE,
    FORM_LOGO_NOT_FOUND_MESSAGE,
    FORM_FAVICON_TYPE_MESSAGE,
    FORM_FAVICON_TOO_LARGE_MESSAGE,
    FORM_FAVICON_NOT_FOUND_MESSAGE,
  ],
  [ON_SUBMIT]: [
    getFormSubmissionNote({ formName: "Report a Problem" }),
    "Started from the template **Application Outage**.",
  ],
  [SHARING]: [FORM_FOREIGN_PAGE_MESSAGE, FORM_SUBMISSION_BODY_MESSAGE],
};

/*
 * The sentences the public form page shows a submitter, in their language:
 * flat keys of the Accounts locale (FormMessage), or a nested key with what
 * the page fills in.
 */
interface PublicPageMessage {
  key: string;
  values?: Record<string, string>;
}

const PUBLIC_PAGE_MESSAGES: Record<string, Array<PublicPageMessage>> = {
  [BUILDING]: [
    { key: "form.successTitle" },
    { key: "form.reference", values: { reference: "INC-42" } },
  ],
  [ON_SUBMIT]: [{ key: FormMessage.NoSeverity }],
  [SHARING]: [
    { key: FormMessage.NotAvailable },
    { key: FormMessage.NetworkNotAllowed },
    { key: FormMessage.TooManyRequests },
    { key: FormMessage.TooManySubmissions },
    { key: FormMessage.FormBusy },
    { key: FormMessage.SubmissionsUnavailable },
    { key: FormMessage.CaptchaFailed },
    { key: "form.successTitle" },
  ],
};

/*
 * Numbers each page states, which every translation states too - read
 * with Persian digits as Latin ones and thousands separators dropped.
 */
const NUMBERS: Record<string, Array<string>> = {
  [SLACK]: ["7"],
  [TEAMS]: ["7"],
  [VIDEO]: ["40", "30"],
  [BUILDING]: ["50", "100", "500", "20000", "10000", "512", "128"],
  [SHARING]: ["429", "503"],
};

// The products a menu path starts with, by their Products menu key.
const PRODUCTS_MENU_KEYS: Record<string, string> = {
  Incidents: "incidentsTitle",
  Alerts: "alertsTitle",
  "Scheduled Maintenance": "scheduledMaintenanceTitle",
  Monitors: "monitorsTitle",
  "On-Call Duty": "onCallDutyTitle",
};

const PATH_SEPARATOR: string = " > ";
// A menu path: bold segments joined by " > ".
const MENU_PATH: RegExp = /\*\*[^*\n]+\*\*(?: > \*\*[^*\n]+\*\*)+/g;
const REGEX_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;
const NUMBER: RegExp = /\d+/g;
const THOUSANDS: RegExp = /(\d)[,.٬   '](?=\d{3}\b)/g;
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const LIST_ITEM_LINE: RegExp = /^(\s*)(?:[-*]|\d+\.)\s/;
const CONTAINER_LINE: RegExp = /^\s*(:::.*|@tab\b.*)$/;
const ALERT_LINE: RegExp = /^>\s*\[!([A-Z]+)\]/;

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed<T>(lists: Record<string, Array<T>>, page: string): Array<T> {
  return lists[page] || [];
}

function keysOf<T>(
  lists: Record<string, Record<string, T>>,
  page: string,
): Array<string> {
  return Object.keys(lists[page] || {});
}

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

function isPermissionOrRole(name: string): boolean {
  return PermissionHelper.getAllPermissionProps().some(
    (props: { title: string }): boolean => {
      return props.title === name;
    },
  );
}

// The bold spans of a page's prose, once each.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown));
}

// How many times a text holds a piece of text.
function occurrences(text: string, needle: string): number {
  return needle ? text.split(needle).length - 1 : 0;
}

// The Dashboard's own translator, as it runs in this language.
function dashboardTranslator(language: string): Translator {
  const locale: Record<string, unknown> = dashboardLocale(language);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, language);
}

const accountsCache: Map<string, Record<string, unknown>> = new Map();

function accountsLocale(language: string): Record<string, unknown> {
  const cached: Record<string, unknown> | undefined =
    accountsCache.get(language);

  if (cached) {
    return cached;
  }

  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App/FeatureSet/Accounts/src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  accountsCache.set(language, locale);

  return locale;
}

/*
 * A sentence or a label of the public form page in this language: a nested
 * key, else a flat one (the page's own lookup), else the English.
 */
function accountsText(
  language: string,
  key: string,
  values?: Record<string, string>,
): string {
  const locale: Record<string, unknown> = accountsLocale(language);
  let value: unknown = locale;

  for (const part of key.split(".")) {
    value =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[part]
        : undefined;
  }

  const flat: unknown = locale[key];
  let text: string =
    typeof value === "string" && value.trim()
      ? value
      : typeof flat === "string" && flat.trim()
        ? flat
        : key;

  for (const [name, filled] of Object.entries(values || {})) {
    text = text.replace(`{{${name}}}`, filled);
  }

  return text;
}

// A product's title in the Products menu, in this language.
function productsMenuTitle(language: string, product: string): string {
  const key: string = PRODUCTS_MENU_KEYS[product] as string;
  const navbar: unknown = dashboardLocale(language)["navbar"];
  const items: unknown = (navbar as Record<string, unknown> | undefined)?.[
    "items"
  ];
  const title: unknown = (items as Record<string, unknown> | undefined)?.[key];

  return typeof title === "string" && title.trim()
    ? title
    : drawnActionLabel(language, product);
}

// How this language's Dashboard draws a bold label of a page.
function drawnLabel(language: string, page: string, english: string): string {
  if (listed(TABLE_CREATE_BUTTONS, page).includes(english)) {
    return drawnCreateButton(language, english);
  }

  const template: TemplateLabel | undefined = (TEMPLATE_LABELS[page] || {})[
    english
  ];

  if (template) {
    return dashboardTranslator(language).translateTemplate(
      template.template,
      template.values,
    );
  }

  return drawnActionLabel(language, english);
}

// The menu paths of a page, as their segments.
function menuPaths(markdown: string): Array<Array<string>> {
  return Array.from(prose(markdown).matchAll(MENU_PATH)).map(
    (match: RegExpMatchArray): Array<string> => {
      return (match[0] as string)
        .split(PATH_SEPARATOR)
        .map((segment: string): string => {
          return segment.replace(/^\*\*|\*\*$/g, "");
        });
    },
  );
}

/*
 * A path's segments as this language draws them: its first segment, a
 * product, by the Products menu's title for it.
 */
function drawnPath(
  language: string,
  page: string,
  segments: Array<string>,
): Array<string> {
  return segments.map((segment: string, index: number): string => {
    if (index === 0 && PRODUCTS_MENU_KEYS[segment]) {
      return productsMenuTitle(language, segment);
    }

    if (isKeptInEnglish(page, segment)) {
      return segment;
    }

    return drawnLabel(language, page, segment);
  });
}

function pathText(segments: Array<string>): string {
  return segments
    .map((segment: string): string => {
      return `**${segment}**`;
    })
    .join(PATH_SEPARATOR);
}

// A composed label as this language draws it: a pattern, names left free.
function composedPattern(
  language: string,
  parts: Array<string | null>,
): RegExp {
  return new RegExp(
    `\\*\\*${parts
      .map((part: string | null): string => {
        if (part === null) {
          return "[^*\\n]+";
        }

        // "Application Outage 2": the template's name, then its number.
        const numbered: RegExpMatchArray | null = part.match(/^(.*) (\d+)$/);

        if (numbered) {
          return `${escapeRegex(
            drawnActionLabel(language, numbered[1] as string),
          )} ${numbered[2] as string}`;
        }

        return escapeRegex(drawnActionLabel(language, part));
      })
      .join(escapeRegex(COMPOSED_SEPARATOR))}\\*\\*`,
  );
}

function isKeptInEnglish(page: string, name: string): boolean {
  return (
    listed(KEPT_IN_ENGLISH, page).includes(name) ||
    listed(SHOWN_IN_ENGLISH, page).includes(name) ||
    isPermissionOrRole(name)
  );
}

/*
 * The bold labels of a page a translation must draw as its Dashboard does:
 * every Dashboard label that is not kept in English, prose, a composed
 * label or a label of the public page.
 */
function drawnLabelsOf(page: string): Array<string> {
  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    if (keysOf(TEMPLATE_LABELS, page).includes(label)) {
      return true;
    }

    if (listed(ALSO_DRAWN, page).includes(label)) {
      return true;
    }

    return (
      isActionLabel(label) &&
      !isKeptInEnglish(page, label) &&
      !listed(PROSE, page).includes(label) &&
      !keysOf(COMPOSED_LABELS, page).includes(label) &&
      !keysOf(ACCOUNTS_LABELS, page).includes(label)
    );
  });
}

// The labels of the public form page a page names, as that page draws them.
function accountsLabelsOf(
  language: string,
  page: string,
): Array<[string, string]> {
  return Object.entries(ACCOUNTS_LABELS[page] || {}).map(
    ([english, key]: [string, string]): [string, string] => {
      return [english, accountsText(language, key)];
    },
  );
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

/*
 * What each line is, where it matters for laying a translation beside its
 * English page: a heading of a level, a table row, a fence, a list item at
 * its depth, a component's line, a callout's marker, a blank line, or text.
 */
function lineShape(markdown: string): Array<string> {
  let inFence: boolean = false;

  return markdown.split("\n").map((line: string): string => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return "```";
    }

    if (inFence) {
      return "code";
    }

    const heading: RegExpMatchArray | null = line.match(HEADING_LINE);

    if (heading) {
      return heading[1] as string;
    }

    if (line.startsWith("|")) {
      return "|";
    }

    const container: RegExpMatchArray | null = line.match(CONTAINER_LINE);

    if (container) {
      return line.trim().startsWith("@tab") ? "@tab" : line.trim().split(" ")[0]!;
    }

    const alert: RegExpMatchArray | null = line.match(ALERT_LINE);

    if (alert) {
      return `> [!${alert[1] as string}]`;
    }

    if (line.startsWith(">")) {
      return ">";
    }

    const item: RegExpMatchArray | null = line.match(LIST_ITEM_LINE);

    if (item) {
      return `item${(item[1] as string).length}`;
    }

    return line.trim() === "" ? "" : "text";
  });
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
        return `${page}${decodeURIComponent(link.target)}`;
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

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      KEPT_IN_ENGLISH,
      ALSO_DRAWN,
      SHOWN_IN_ENGLISH,
      TEMPLATE_LABELS,
      COMPOSED_LABELS,
      TABLE_CREATE_BUTTONS,
      ACCOUNTS_LABELS,
      PROSE,
      PROSE_LEADS,
      SERVER_MESSAGES,
      PUBLIC_PAGE_MESSAGES,
      NUMBERS,
    ] as Array<Record<string, unknown>>) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("list only bold words the English pages have", () => {
    for (const lists of [
      KEPT_IN_ENGLISH,
      ALSO_DRAWN,
      SHOWN_IN_ENGLISH,
      TABLE_CREATE_BUTTONS,
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
      TEMPLATE_LABELS,
      COMPOSED_LABELS,
      ACCOUNTS_LABELS,
    ] as Array<Record<string, Record<string, unknown>>>) {
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

  it("keep in English roles, permissions, plans and other products' names only, and never a name a role list holds", () => {
    const external: Array<string> = [
      ...PLANS,
      ...CHAT_BUTTONS,
      ...TEAMS_CARD_BUTTONS,
      ...SLACK_CONTROLS,
      ...TEAMS_CONTROLS,
      ...PROVIDER_CONSOLES,
      ...BRANDS,
      ...listed(KEPT_IN_ENGLISH, ON_SUBMIT),
    ];

    for (const page of Object.keys(KEPT_IN_ENGLISH)) {
      for (const name of KEPT_IN_ENGLISH[page] as Array<string>) {
        expect({ page, name, why: true }).toEqual({
          page,
          name,
          why: external.includes(name),
        });

        // Roles and permissions are found on their own; listing one hides it.
        expect({ page, name, permission: false }).toEqual({
          page,
          name,
          permission: isPermissionOrRole(name),
        });
      }
    }

    for (const page of Object.keys(ALSO_DRAWN)) {
      for (const name of ALSO_DRAWN[page] as Array<string>) {
        expect({ page, name, other: true }).toEqual({
          page,
          name,
          other:
            listed(KEPT_IN_ENGLISH, page).includes(name) ||
            keysOf(ACCOUNTS_LABELS, page).includes(name),
        });
        expect(isActionLabel(name)).toBe(true);
      }
    }
  });

  it("show in English only labels no Dashboard locale has", () => {
    for (const page of Object.keys(SHOWN_IN_ENGLISH)) {
      for (const label of SHOWN_IN_ENGLISH[page] as Array<string>) {
        expect({ page, label, isLabel: false }).toEqual({
          page,
          label,
          isLabel: isActionLabel(label),
        });
      }
    }
  });

  it("fill every template label the way the English Dashboard draws it", () => {
    for (const page of Object.keys(TEMPLATE_LABELS)) {
      for (const label of keysOf(TEMPLATE_LABELS, page)) {
        expect(drawnLabel("en", page, label)).toBe(label);
        expect(
          isActionLabel(
            (TEMPLATE_LABELS[page] as Record<string, TemplateLabel>)[label]!
              .template,
          ),
        ).toBe(true);
      }
    }
  });

  it("put composed labels together from Dashboard labels", () => {
    for (const page of Object.keys(COMPOSED_LABELS)) {
      for (const [label, parts] of Object.entries(
        COMPOSED_LABELS[page] as Record<string, Array<string | null>>,
      )) {
        expect(composedPattern("en", parts).test(`**${label}**`)).toBe(true);

        for (const part of parts) {
          if (part !== null) {
            expect(isActionLabel(part.replace(/ \d+$/, ""))).toBe(true);
          }
        }
      }
    }
  });

  it("name keys the public page's locale has", () => {
    for (const page of Object.keys(ACCOUNTS_LABELS)) {
      for (const [english, key] of Object.entries(
        ACCOUNTS_LABELS[page] as Record<string, string>,
      )) {
        expect(accountsText("en", key)).toBe(english);
      }
    }

    for (const page of Object.keys(PUBLIC_PAGE_MESSAGES)) {
      for (const message of PUBLIC_PAGE_MESSAGES[page] as Array<PublicPageMessage>) {
        const english: string = accountsText("en", message.key, message.values);

        expect({ page, english, quoted: true }).toEqual({
          page,
          english,
          quoted: englishPage(page).includes(`"${english}"`),
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

  it("know every bold word on the English pages", () => {
    for (const page of PAGE_NAMES) {
      const known: Array<string> = [
        ...drawnLabelsOf(page),
        ...listed(KEPT_IN_ENGLISH, page),
        ...listed(SHOWN_IN_ENGLISH, page),
        ...keysOf(COMPOSED_LABELS, page),
        ...keysOf(ACCOUNTS_LABELS, page),
        ...listed(PROSE, page),
        ...listed(PROSE_LEADS, page),
      ];
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !known.includes(span) && !isPermissionOrRole(span);
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

  it("start every menu path from a product the Products menu titles, or a page the Dashboard names", () => {
    for (const page of PAGE_NAMES) {
      for (const segments of menuPaths(englishPage(page))) {
        for (const segment of segments) {
          expect({ page, segment, known: true }).toEqual({
            page,
            segment,
            known:
              Boolean(PRODUCTS_MENU_KEYS[segment]) ||
              isActionLabel(segment) ||
              isKeptInEnglish(page, segment),
          });
        }
      }
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: TranslatedPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it.each(PAGES)(
    "$page opens on cards, draws a captioned diagram, walks a procedure in steps and ends on Next steps",
    (entry: TranslatedPage) => {
      const markdown: string = englishPage(entry.page);
      const scanned: ScannedPage = scanMarkdown(markdown);
      const last: DocsHeading = scanned.headings[
        scanned.headings.length - 1
      ] as DocsHeading;

      expect(scanned.containers[0]?.name).toBe("cards");
      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(cardLines(markdown).length).toBeGreaterThan(0);

      const diagrams: Array<{ info: string }> = scanned.fences.filter(
        (fence: { lang: string }): boolean => {
          return fence.lang === "mermaid";
        },
      );

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }

      expect(
        scanned.containers.some((use: { name: string }): boolean => {
          return use.name === "steps";
        }),
      ).toBe(true);
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it("link each page of the group from another of them", () => {
    for (const page of PAGE_NAMES) {
      const linkedFrom: Array<string> = PAGE_NAMES.filter(
        (other: string): boolean => {
          return (
            other !== page &&
            scanMarkdown(englishPage(other)).links.some(
              (link: DocsLink): boolean => {
                return parseDocsLink(link.target)?.page === page;
              },
            )
          );
        },
      );

      expect({ page, linked: linkedFrom.length > 0 }).toEqual({
        page,
        linked: true,
      });
    }

    // The Forms pages are reached from the Forms overview, too.
    expect(englishPage(FORMS_OVERVIEW)).toContain("/docs/forms/building");
  });
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

    it("lays out line for line with the English page", () => {
      const translated: Array<string> = lineShape(readPage(language, entry.page));
      const source: Array<string> = lineShape(english);
      const differences: Array<string> = [];

      for (
        let index: number = 0;
        index < Math.max(translated.length, source.length);
        index++
      ) {
        if (translated[index] !== source[index]) {
          differences.push(
            `line ${index + 1}: ${source[index]} -> ${translated[index]}`,
          );
        }
      }

      expect(differences.slice(0, 5)).toEqual([]);
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

    it("has the English page's headings, components, tables and list items", () => {
      const translated: ScannedPage = scanMarkdown(
        readPage(language, entry.page),
      );
      const source: ScannedPage = scanMarkdown(english);

      expect(
        translated.headings.map((heading: DocsHeading): number => {
          return heading.level;
        }),
      ).toEqual(
        source.headings.map((heading: DocsHeading): number => {
          return heading.level;
        }),
      );
      expect(
        translated.containers.map(
          (use: { name: string; steps: number }): string => {
            return `${use.name}:${use.steps}`;
          },
        ),
      ).toEqual(
        source.containers.map((use: { name: string; steps: number }): string => {
          return `${use.name}:${use.steps}`;
        }),
      );
      expect(translated.alerts).toEqual(source.alerts);
      expect(tableShape(readPage(language, entry.page))).toEqual(
        tableShape(english),
      );
      expect(listItemCount(readPage(language, entry.page))).toBe(
        listItemCount(english),
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

    it("names every Dashboard label the English page names, as this language's Dashboard draws it, as often", () => {
      const translated: string = prose(readPage(language, entry.page));
      const source: string = prose(english);
      const missing: Array<string> = drawnLabelsOf(entry.page)
        .map((label: string): [string, string] => {
          return [label, drawnLabel(language, entry.page, label)];
        })
        .filter(([label, drawn]: [string, string]): boolean => {
          // A label named two ways is named the Dashboard's way at least once.
          const needed: number = listed(ALSO_DRAWN, entry.page).includes(label)
            ? 1
            : occurrences(source, `**${label}**`);

          return occurrences(translated, `**${drawn}**`) < needed;
        })
        .map(([label, drawn]: [string, string]): string => {
          return `${label} -> ${drawn}: ${occurrences(
            translated,
            `**${drawn}**`,
          )} of ${occurrences(source, `**${label}**`)}`;
        });

      expect(missing).toEqual([]);
    });

    it("writes every menu path segment by segment, as the screens draw them", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .map((segments: Array<string>): string => {
          return pathText(drawnPath(language, entry.page, segments));
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(drawn);
        });

      expect(missing).toEqual([]);
    });

    it("puts badges and chips together as the Dashboard does", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = Object.entries(
        COMPOSED_LABELS[entry.page] || {},
      )
        .filter(([, parts]: [string, Array<string | null>]): boolean => {
          return !composedPattern(language, parts).test(translated);
        })
        .map(([label]: [string, Array<string | null>]): string => {
          return label;
        });

      expect(missing).toEqual([]);
    });

    it("names the public form page's labels and sentences as it shows them", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...accountsLabelsOf(language, entry.page)
          .map(([, drawn]: [string, string]): string => {
            return `**${drawn}**`;
          })
          .filter((label: string): boolean => {
            return !translated.includes(label);
          }),
        ...(PUBLIC_PAGE_MESSAGES[entry.page] || [])
          .map((message: PublicPageMessage): string => {
            return accountsText(language, message.key, message.values);
          })
          .filter((sentence: string): boolean => {
            return !translated.includes(sentence);
          }),
      ];

      expect(missing).toEqual([]);
    });

    it("keeps in English what stays English: roles, permissions, plans, other apps' and consoles' names", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = boldLabels(english)
        .filter((name: string): boolean => {
          return (
            isKeptInEnglish(entry.page, name) &&
            !listed(ALSO_DRAWN, entry.page).includes(name)
          );
        })
        .filter((name: string): boolean => {
          return !translated.includes(`**${name}**`);
        });

      expect(missing).toEqual([]);
    });

    it("translates the page's own bold leads", () => {
      const translated: string = readPage(language, entry.page);
      const untranslated: Array<string> = listed(
        PROSE_LEADS,
        entry.page,
      ).filter((lead: string): boolean => {
        return translated.includes(`**${lead}**`);
      });

      expect(untranslated).toEqual([]);
    });

    it("quotes the server's and the bots' messages as they send them, and states the English page's numbers", () => {
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
  it("read a menu path's segments, and draw its product as the Products menu titles it", () => {
    expect(menuPaths("Go to **Incidents** > **Workspace** > **Slack**.")).toEqual(
      [["Incidents", "Workspace", "Slack"]],
    );
    expect(menuPaths("**A** and **B**")).toEqual([]);
    expect(
      drawnPath("de", SLACK, ["Incidents", "Workspace", "Slack"])[0],
    ).toBe(productsMenuTitle("de", "Incidents"));
  });

  it("lay a page out by its kinds of line", () => {
    expect(
      lineShape(
        [
          "# Title",
          "",
          ":::steps",
          "### Step",
          "1. One",
          "   - nested",
          "> [!NOTE]",
          "> text",
          "| a |",
          "```bash",
          "# not a heading",
          "```",
          "@tab Linux",
          "Words.",
        ].join("\n"),
      ),
    ).toEqual([
      "#",
      "",
      ":::steps",
      "###",
      "item0",
      "item3",
      "> [!NOTE]",
      ">",
      "|",
      "```",
      "code",
      "```",
      "@tab",
      "text",
    ]);
  });

  it("match a composed label with its parts, a name left free", () => {
    expect(
      composedPattern("en", ["Custom Field", null]).test(
        "**Custom Field · Region**",
      ),
    ).toBe(true);
    expect(
      composedPattern("en", ["Custom Field", null]).test("**Region · Custom Field**"),
    ).toBe(false);
    expect(
      composedPattern("en", ["Application Outage 2"]).test(
        "**Application Outage 2**",
      ),
    ).toBe(true);
  });

  it("read the public page's words from its own locale, filled in", () => {
    expect(
      accountsText("en", "form.reference", { reference: "INC-42" }),
    ).toBe("Your reference number is INC-42.");
    expect(accountsText("en", FormMessage.CaptchaFailed)).toBe(
      FormMessage.CaptchaFailed,
    );
  });
});
