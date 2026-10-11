import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { getConnectCallbackMessageKey } from "../../../FeatureSet/Dashboard/src/Utils/Workspace/ConnectCallbackMessage";
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
  drawnCreateButton,
  drawnDashboardLabel,
  isDashboardLabel,
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
import { PermissionHelper } from "Common/Types/Permission";
import {
  ConnectCallbackError,
  ConnectProvider,
} from "Common/Types/Workspace/ConnectCallback";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 15: Local Development, Docker Compose, Sizing &
 * Capacity Planning, and the self-hosted Slack, Microsoft Teams, Twilio and
 * GitHub integration guides, in every docs language. Each translation says
 * what the English page says - the same sections, steps, tables, lists,
 * cards, code and diagrams, links that land on the heading the English link
 * means, a title that is the nav link's - and names each screen the way the
 * screen the reader is on draws it in their language.
 *
 * "The way it is drawn" has three sources on these pages:
 *
 *   - The Dashboard, Persian included, as on every page since the on-call
 *     pages: a menu item, a card, a field or a button is looked up whole in
 *     the Dashboard's locale, and shown in English where the locale has no
 *     wording of its own (drawnDashboardLabel). A menu path written in one
 *     bold span ("Project Settings > Workspace > Slack") is drawn segment by
 *     segment, in one span or one span a segment, joined by ">" or "→"
 *     (Persian writes ">", which right-to-left text mirrors).
 *   - The Admin Dashboard, where a self-hosted installation turns sign-up
 *     off, sets its mail server and its Twilio account and sees its probes:
 *     its top bar, side menu, switch and status words are keys of its own
 *     locale (ADMIN_KEYS).
 *   - The sentence a Slack, Microsoft Teams or Code Repositories page shows
 *     when a connection comes back unmade (ConnectCallbackMessage): each
 *     guide quotes the first sentence of every one its callback answers with
 *     (ConnectCallbackDocs holds the English), and a translation quotes it as
 *     that language's Dashboard words it (CONNECT_CODES).
 *
 * Other names stay in English on purpose: roles and permissions, as the API,
 * Terraform and the role pickers name them (KEPT_IN_ENGLISH); the consoles of
 * Slack, Microsoft Azure and Teams, GitHub and Twilio, whose language
 * OneUptime cannot know and whose English names their own docs and search use
 * (EXTERNAL_CONSOLE_LABELS); Microsoft Graph and Teams permission names;
 * labels the Dashboard draws in English because it has no wording for them
 * (SHOWN_IN_ENGLISH); and what a script, a server or another product prints
 * in English (SERVER_MESSAGES). Bold words that are Dashboard labels only by
 * coincidence are PROSE; the pages' own bold leads are PROSE_LEADS. A new bold
 * word on these English pages fails "know every bold word" until it is put in
 * one of the lists.
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

const LOCAL: string = "installation/local-development";
const COMPOSE: string = "installation/docker-compose";
const SIZING: string = "installation/sizing";
const SLACK: string = "self-hosted/slack-integration";
const TEAMS: string = "self-hosted/microsoft-teams-integration";
const TWILIO: string = "self-hosted/twilio-integration";
const GITHUB: string = "self-hosted/github-integration";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: LOCAL, navTitle: "Local Development" },
  { page: COMPOSE, navTitle: "Docker Compose" },
  { page: SIZING, navTitle: "Sizing & Capacity Planning" },
  { page: SLACK, navTitle: "Slack Integration" },
  { page: TEAMS, navTitle: "Microsoft Teams Integration" },
  { page: TWILIO, navTitle: "Twilio Integration" },
  { page: GITHUB, navTitle: "GitHub Integration" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// Roles and permissions, as the role pickers and the API name them.
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  [SLACK]: ["Project Owner", "Project Admin", "Project Member"],
  [TEAMS]: ["Project Owner", "Project Admin", "Project Member"],
  [TWILIO]: [
    "Project Owner",
    "Project Admin",
    "Create Call and SMS",
    "Read Call and SMS",
    "Billing Admin",
    "Manage Billing",
  ],
  [GITHUB]: [
    "Project Owner",
    "Project Admin",
    "Project Member",
    "Settings Admin",
    "Settings Member",
    "Create Code Repository",
  ],
};

/*
 * Labels the Dashboard draws in English in every language: they are not
 * keys of its locale (a button title built in code, a form field named after
 * the workspace).
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [SLACK]: ["Connect my account with Slack"],
  [TEAMS]: ["Create Microsoft Teams Channel"],
};

/*
 * The consoles the guides click through, kept bold and in English: Slack's
 * app settings and the shortcuts OneUptime's own Slack manifest names,
 * Microsoft Entra ID, the Azure portal and the Teams client, GitHub's app
 * settings, and the Twilio Console.
 */
const EXTERNAL_CONSOLE_LABELS: Record<string, Array<string>> = {
  [SLACK]: [
    "Basic Information",
    "App Credentials",
    "Client ID",
    "Client Secret",
    "Signing Secret",
    "Event Subscriptions",
    "Create New Incident",
    "Create Scheduled Event",
    "OAuth & Permissions > Bot Token Scopes",
  ],
  [TEAMS]: [
    "App registrations",
    "New registration",
    "Name:",
    "Supported account types:",
    "Redirect URI:",
    "Register",
    "Application (client) ID",
    "Directory (tenant) ID",
    "API permissions",
    "Add a permission",
    "Microsoft Graph",
    "Grant admin consent",
    "Certificates & secrets",
    "New client secret",
    "Add",
    "Value",
    "Secret ID",
    "Azure Bot",
    "Bot handle:",
    "Subscription",
    "Resource group:",
    "Pricing tier:",
    "Type of App:",
    "Review + create",
    "Create",
    "Configuration",
    "Messaging endpoint",
    "Channels",
    "Microsoft Teams",
    "Apps > Manage your apps",
    "Upload an app",
    "Upload a custom app",
    "Manage team",
    "Apps",
    "More apps",
    "OneUptime",
    "Manage channel",
    "Add an app",
    "Manage team > Apps > More apps",
    "Teams apps > Manage apps",
    "Setup policies",
    "Manage team > Apps",
  ],
  [TWILIO]: ["Account SID", "Auth Token"],
  [GITHUB]: [
    "New GitHub App",
    "GitHub App name",
    "Homepage URL",
    "Callback URL",
    "Request user authorization (OAuth) during installation",
    "Setup URL",
    "Redirect on update",
    "Webhook URL",
    "Active",
    "Webhook secret",
    "Permissions & events",
    "Repository permissions",
    "Issue comment",
    "Issues",
    "Pull request",
    "Pull request review",
    "Pull request review comment",
    "Push",
    "Workflow run",
    "Where can this GitHub App be installed?",
    "Only on this account",
    "Any account",
    "Create GitHub App",
    "App ID",
    "Client ID",
    "About",
    "Client secrets",
    "Generate a new client secret",
    "Private keys",
    "Generate a private key",
    "All repositories",
    "Only select repositories",
    "Install",
    "Save",
    "Advanced",
    "Recent Deliveries",
    "Advanced > Recent Deliveries",
    "Issues: Read and write",
  ],
};

// What a script prints, quoted bold as it prints it.
const SCRIPT_OUTPUT: Record<string, Array<string>> = {
  [COMPOSE]: ["OneUptime is up!"],
};

// Microsoft Graph application and delegated permissions, and the Teams app's own.
const MICROSOFT_PERMISSIONS: Record<string, Array<string>> = {
  [TEAMS]: [
    "User.Read",
    "Team.ReadBasic.All",
    "Channel.ReadBasic.All",
    "ChannelMessage.Send",
    "TeamsAppInstallation.ReadForTeam.All",
    "Chat.ReadBasic.WhereInstalled",
    "ChatSettings.Read.Chat",
    "ChannelMessage.Send.Group",
    "ChannelMessage.Read.Group",
    "Channel.Create.Group",
    "ChatMessage.Read.Chat",
    "ChatMember.Read.Chat",
    "TeamsAppInstallation.Read.Group",
  ],
};

/*
 * The Admin Dashboard's words: its top bar, side menu, the sign-up switch
 * and a probe's status, by the key each is drawn with.
 */
const ADMIN_KEYS: Record<string, string> = {
  Settings: "navbar.settings",
  Authentication: "sideMenu.settingsAuthentication",
  Notifications: "sideMenu.settingsNotifications",
  Emails: "sideMenu.settingsEmails",
  "Call and SMS": "sideMenu.settingsCallSms",
  Monitoring: "sideMenu.settingsMonitoring",
  "Global Probes": "sideMenu.settingsGlobalProbes",
  "Let people sign up": "pages.settings.authentication.signUpSwitchTitle",
  Disconnected: "common.disconnected",
};

// The bold words of a page that name the Admin Dashboard, paths included.
const ADMIN_LABELS: Record<string, Array<string>> = {
  [COMPOSE]: [
    "Settings > Authentication",
    "Let people sign up",
    "Settings > Notifications > Emails",
    "Settings > Monitoring > Global Probes",
  ],
  [TWILIO]: ["Admin Dashboard > Settings > Call and SMS"],
};

/*
 * Every connect callback answer a guide quotes, by page: the codes its
 * provider's callback can answer with (ConnectCallbackDocs holds the
 * English quotes to the same codes).
 */
interface ConnectQuotes {
  provider: ConnectProvider;
  codes: Array<ConnectCallbackError>;
}

const CONNECT_CODES: Record<string, ConnectQuotes> = {
  [SLACK]: {
    provider: ConnectProvider.Slack,
    codes: [
      ConnectCallbackError.LinkInvalid,
      ConnectCallbackError.NoPermission,
      ConnectCallbackError.NotAMember,
      ConnectCallbackError.SlackNotInstalled,
      ConnectCallbackError.SlackOtherWorkspace,
      ConnectCallbackError.Cancelled,
      ConnectCallbackError.NotConfigured,
      ConnectCallbackError.CouldNotFinish,
    ],
  },
  [TEAMS]: {
    provider: ConnectProvider.MicrosoftTeams,
    codes: [
      ConnectCallbackError.LinkInvalid,
      ConnectCallbackError.NoPermission,
      ConnectCallbackError.NotAMember,
      ConnectCallbackError.TeamsOtherTenant,
      ConnectCallbackError.TeamsNoTeams,
      ConnectCallbackError.Cancelled,
      ConnectCallbackError.NotConfigured,
      ConnectCallbackError.CouldNotFinish,
    ],
  },
  [GITHUB]: {
    provider: ConnectProvider.GitHub,
    codes: [
      ConnectCallbackError.LinkInvalid,
      ConnectCallbackError.NoPermission,
      ConnectCallbackError.GitHubNoAuthorization,
      ConnectCallbackError.GitHubNotVerified,
      ConnectCallbackError.GitHubNoInstallation,
      ConnectCallbackError.NotConfigured,
      ConnectCallbackError.CouldNotFinish,
    ],
  },
};

/*
 * The Code Repositories card's own sentence for a plan it does not have
 * (GitHubConnectLock), quoted with "..." for the plan's name.
 */
const GITHUB_PLAN_SENTENCE: string =
  "Connecting GitHub needs the {{planName}} plan.";
const PLAN_NAME_SLOT: string = "{{planName}}";

/*
 * Bold words that are Dashboard labels by coincidence but are words of the
 * page here: table row heads and products named in a list.
 */
const PROSE: Record<string, Array<string>> = {
  [LOCAL]: ["Docker"],
  [COMPOSE]: [
    "Memory",
    "CPU",
    "Disk",
    "System",
    "Architecture",
    "Docker",
    "Settings",
    "Secrets",
    "Email",
  ],
  [TEAMS]: ["No", "Yes"],
  [GITHUB]: ["Required"],
};

/*
 * The bold leads of the pages' own lists, tables, steps and sentences. They
 * are neither labels nor kept in English, so a translation words them;
 * listing them makes a new bold word fail until it is put in a list.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [LOCAL]: [
    "Node.js 26 or later, and npm",
    "Git",
    "sudo access",
    "Ports 80 and 443 free",
  ],
  [COMPOSE]: [
    "Docker Compose v2",
    "Git",
    "Node.js and npm",
    "Ports 80 and 443",
    "TLS ends at",
    "You need",
    "Status pages on custom domains",
    "HTTPS",
    "Sign-ups",
    "Firewall",
    "Backups",
    "Updates",
    "High availability",
  ],
  [SIZING]: [
    "ClickHouse",
    "PostgreSQL",
    "Valkey",
    "no CPU or memory requests or limits",
    "25 Gi",
    "ingest rate × retention",
    "Entity count and history",
    "Queue depth and active sessions",
    "cardinality",
    "10 clusters",
    "50–150 GB of raw logs per cluster over 30 days",
    "5–15 GB a day of compressed telemetry",
    "~0.4–1.2 TB",
    "~1.2–3.5 TB",
    "linearly with retention",
    "Use NVMe or SSD.",
    "Give ClickHouse generous memory.",
    "Police metric cardinality.",
    "PgBouncer",
    "memory-bound",
    "off by default",
    "no resource requests or limits",
    "KEDA",
    "Small / PoC",
    "Medium / Production fleet",
    "Large / Multi-fleet",
    "sharded",
    "Retention assumed",
    "single instances",
    "3 instances",
    "2 or more replicas per shard",
    "3 nodes",
    "ClickHouse TTL counted in days",
    "retention days + 1",
    "not",
    "collect from your environment for at least four weeks",
  ],
  [SLACK]: ["Outbound", "Inbound"],
  [TEAMS]: [
    "Why single tenant:",
    "Add Delegated Permissions",
    "Add Application Permissions",
    "Verify the endpoint before you move on.",
    "body is the only thing that tells you who produced it",
    "405",
    '404 with a JSON body of `{"message":"Page not found - /api/microsoft-bot/messages"}`',
    "404 with an HTML error page",
    "A TLS error, a timeout or a connection refusal",
    "you",
    "not",
    "team name",
    "different",
    "Private channels",
    "Shared channels",
    "Azure Bot Service cannot deliver authenticated activities to your messaging endpoint",
    "Diagnose it in this order:",
    "Look for the POST, not for 404s.",
    "Call the endpoint from outside your network,",
    "Check the certificate chain.",
    "Check that the host is publicly resolvable.",
    "Confirm the endpoint on the Azure Bot resource",
    "A 404 on `GET /api/microsoft-bot/messages` is not the bug, and it is not evidence Azure could not reach you.",
    "bot id",
    "Step 9",
    "The app in the team is a different package.",
    "Step 5",
    "The Azure Bot has no Microsoft Teams channel.",
    "The app is installed for you, or in a chat, but not in the team.",
    "The channel is private.",
  ],
  [GITHUB]: [
    "For an organization:",
    "For a personal account:",
    "It is required",
    'Why "Request user authorization (OAuth) during installation" is required.',
    "including on pull requests",
    "Issues: Read and write is what makes the app interactive.",
    "Repository synchronisation",
    "The interactive app",
    "and",
    "Who can connect.",
    "Finish within 15 minutes, in the same browser.",
    "Rotate secrets regularly.",
    "Keep the webhook secret set.",
    "Limit repository access.",
    "Watch webhook deliveries.",
    "Keep private keys out of version control.",
  ],
};

/*
 * Bold leads that may read the same in a translation: names of products and
 * tools, sizes and status codes, and words several languages borrow from
 * English (Firewall, Backups, Updates; "clusters", "instances" and "nodes"
 * after a number in French, Portuguese and Dutch). Every other lead is the
 * page's own English, which a translation translates.
 */
const LEADS_THE_SAME_IN_EVERY_LANGUAGE: Array<string> = [
  "Git",
  "HTTPS",
  "Docker Compose v2",
  "Firewall",
  "Backups",
  "Updates",
  "10 clusters",
  "3 instances",
  "3 nodes",
  "ClickHouse",
  "PostgreSQL",
  "Valkey",
  "25 Gi",
  "~0.4–1.2 TB",
  "~1.2–3.5 TB",
  "PgBouncer",
  "KEDA",
  "405",
];

/*
 * What a script, the server or another product prints in English, whatever
 * the reader's language: the pages quote it as it is printed.
 */
const SERVER_MESSAGES: Record<string, Array<string>> = {
  [COMPOSE]: [
    "**OneUptime is up!**",
    '"permission denied"',
    '"Maximum retries reached"',
    "`CoreSSL:EnsurePrimaryHostCertificate`",
  ],
  [TEAMS]: [
    '"Unable to reach app"',
    '### "The OneUptime app is not installed in the Microsoft Teams team ..."',
    '### "Microsoft Teams refused the message ... because the OneUptime bot is not a member of that conversation"',
    `### "Sorry, I couldn't find your project configuration"`,
    '### "This Microsoft 365 organization is connected to more than one OneUptime project"',
    '### "Microsoft Teams App Client ID must be a valid GUID"',
    "`BotNotInConversationRoster`",
  ],
  [GITHUB]: ['"Invalid webhook signature"'],
};

/*
 * Numbers each page states, which every translation states too - read
 * with Persian digits as Latin ones and thousands separators dropped.
 */
const NUMBERS: Record<string, Array<string>> = {
  [LOCAL]: ["26", "80", "443", "5400", "8189", "9034", "6310"],
  [COMPOSE]: [
    "16",
    "8",
    "400",
    "20",
    "4",
    "80",
    "443",
    "5400",
    "3874",
    "3876",
    "30",
    "1000",
    "13",
    "14",
  ],
  [SIZING]: ["25", "95", "50", "500", "16", "15", "30", "90", "2", "8"],
  [SLACK]: ["443", "15"],
  [TEAMS]: ["405", "404", "58", "24", "443", "15"],
  [TWILIO]: ["443", "164"],
  [GITHUB]: ["15", "443"],
};

/*
 * Headings that name a Dashboard button in quotes: a translation's heading
 * quotes it as the language's Dashboard draws it.
 */
const QUOTED_HEADING_LABELS: Record<string, Array<string>> = {
  [TEAMS]: ["Test Rule"],
};

// A details title naming a word of the Admin Dashboard, in the Admin's words.
const ADMIN_DETAILS_WORDS: Record<string, Array<string>> = {
  [COMPOSE]: ["Disconnected"],
};

/*
 * A table's create button, which the Dashboard draws from the name the table
 * gives its rows - "Create" and "Twilio Config" - rather than looking the
 * phrase up whole, so a locale that still holds the phrase as the English
 * draws the template with its own word for a config (drawnCreateButton).
 */
const TABLE_CREATE_BUTTONS: Record<string, Array<string>> = {
  // The Twilio Config card on Notification Settings (CallSMSConfigTable).
  [TWILIO]: ["Create Twilio Config"],
};

// The table that draws each of those buttons, and the name it gives its rows.
const CREATE_BUTTON_TABLES: Record<string, { file: string; rows: string }> = {
  "Create Twilio Config": {
    file: "App/FeatureSet/Dashboard/src/Components/CallSMS/CallSMSConfigTable.tsx",
    rows: "Twilio Config",
  },
};

const REGEX_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;
const NUMBER: RegExp = /\d+/g;
const THOUSANDS: RegExp = /(\d)[,.\u066c\u00a0\u202f '](?=\d{3}\b)/g;
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
// A menu path in one bold span: "Project Settings > Workspace > Slack".
const PATH_SEPARATOR: RegExp = / (?:→|>) /;
// Where a quoted sentence ends: Latin, CJK and Devanagari full stops.
const SENTENCE_END: RegExp = /(\. |。|।)/;
const DETAILS_TITLE: RegExp = /^:::details\s+(.*)$/;
const HEADING_TEXT: RegExp = /^#{2,6}\s+(.*)$/;

function englishPage(page: string): string {
  return readPage("en", page);
}

function readLocale(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

const adminLocaleCache: Map<string, Record<string, unknown>> = new Map();

function adminLocale(language: string): Record<string, unknown> {
  const cached: Record<string, unknown> | undefined =
    adminLocaleCache.get(language);

  if (cached) {
    return cached;
  }

  const locale: Record<string, unknown> = readLocale(
    path.join(
      PACKAGES_DIR,
      "App/FeatureSet/AdminDashboard/src/Locales",
      `${language}.json`,
    ),
  );

  adminLocaleCache.set(language, locale);

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

// How this language's Dashboard draws a bold label of a page.
function drawnLabel(language: string, page: string, label: string): string {
  return listed(TABLE_CREATE_BUTTONS, page).includes(label)
    ? drawnCreateButton(language, label)
    : drawnDashboardLabel(language, label);
}

// How the Admin Dashboard draws one of its words, in English where it has none.
function adminLabel(language: string, english: string): string {
  const key: string | undefined = ADMIN_KEYS[english];

  if (!key) {
    return english;
  }

  return nestedValue(adminLocale(language), key) || english;
}

// The bold spans of a page's prose, once each.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown));
}

// How many times a text holds a piece of text.
function occurrences(text: string, needle: string): number {
  return needle ? text.split(needle).length - 1 : 0;
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

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

// A connect answer quoted on a page: it starts with a double quote.
function isQuote(span: string): boolean {
  return span.startsWith('"');
}

/*
 * The bold spans of a page that are menu paths of OneUptime's own screens:
 * the Dashboard's, and the Admin Dashboard's (another product's are kept as
 * they are).
 */
function pathsOf(page: string): Array<string> {
  return boldLabels(englishPage(page)).filter((span: string): boolean => {
    return (
      PATH_SEPARATOR.test(span) &&
      !listed(EXTERNAL_CONSOLE_LABELS, page).includes(span) &&
      !isQuote(span)
    );
  });
}

/*
 * A path's segments, as the screen it runs through draws them: the Admin
 * Dashboard's words for the Admin Dashboard's paths, the Dashboard's
 * otherwise. "Admin Dashboard" itself is the product's name.
 */
function drawnSegments(
  language: string,
  page: string,
  english: string,
): Array<string> {
  const segments: Array<string> = english.split(PATH_SEPARATOR);
  const isAdmin: boolean = listed(ADMIN_LABELS, page).includes(english);

  return segments.map((segment: string): string => {
    if (segment === "Admin Dashboard") {
      return segment;
    }

    return isAdmin
      ? adminLabel(language, segment)
      : drawnDashboardLabel(language, segment);
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
 * product's, kept in English, the Admin Dashboard's, the prose, the paths
 * and the quoted answers, which are checked their own ways.
 */
function notDashboardLabels(page: string): Array<string> {
  return [
    ...listed(EXTERNAL_CONSOLE_LABELS, page),
    ...listed(MICROSOFT_PERMISSIONS, page),
    ...listed(KEPT_IN_ENGLISH, page),
    ...listed(SHOWN_IN_ENGLISH, page),
    ...listed(SCRIPT_OUTPUT, page),
    ...listed(PROSE, page),
    ...listed(ADMIN_LABELS, page),
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

// The steps of every :::steps block: the headings and numbered items inside them.
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

/*
 * The sentence a page shows for a connect answer, in a language: the
 * Dashboard's wording of it, or the English where the locale has none.
 */
function connectSentence(
  language: string,
  provider: ConnectProvider,
  code: ConnectCallbackError,
): string {
  const key: string =
    provider === ConnectProvider.GitHub &&
    code === ConnectCallbackError.PlanRequired
      ? GITHUB_PLAN_SENTENCE
      : getConnectCallbackMessageKey(provider, code);

  return drawnDashboardLabel(language, key);
}

// The first sentence of a page's sentence, as a guide quotes it.
function firstSentence(sentence: string): string {
  const match: RegExpExecArray | null = SENTENCE_END.exec(sentence);

  if (!match) {
    return sentence;
  }

  return sentence.slice(0, match.index + match[1]!.trimEnd().length);
}

// The quotes a guide must open, in a language: one per answer it lists.
function connectQuotes(language: string, page: string): Array<string> {
  const quotes: ConnectQuotes | undefined = CONNECT_CODES[page];

  if (!quotes) {
    return [];
  }

  const opened: Array<string> = quotes.codes.map(
    (code: ConnectCallbackError): string => {
      return `**"${firstSentence(connectSentence(language, quotes.provider, code))}`;
    },
  );

  if (page === GITHUB) {
    opened.push(
      `**"${drawnDashboardLabel(language, GITHUB_PLAN_SENTENCE).replace(PLAN_NAME_SLOT, "...")}"**`,
    );
  }

  return opened;
}

// The details titles of a page, in order.
function detailsTitles(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .map((line: string): string | null => {
      return DETAILS_TITLE.exec(line)?.[1] || null;
    })
    .filter((title: string | null): title is string => {
      return title !== null;
    });
}

// The headings of a page below its title, as written.
function headingTexts(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .map((line: string): string | null => {
      return HEADING_TEXT.exec(line)?.[1] || null;
    })
    .filter((text: string | null): text is string => {
      return text !== null;
    });
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      KEPT_IN_ENGLISH,
      SHOWN_IN_ENGLISH,
      SCRIPT_OUTPUT,
      EXTERNAL_CONSOLE_LABELS,
      MICROSOFT_PERMISSIONS,
      ADMIN_LABELS,
      CONNECT_CODES,
      PROSE,
      PROSE_LEADS,
      SERVER_MESSAGES,
      NUMBERS,
      QUOTED_HEADING_LABELS,
      ADMIN_DETAILS_WORDS,
      TABLE_CREATE_BUTTONS,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("draw a table's create button from the name its table gives its rows", () => {
    for (const page of Object.keys(TABLE_CREATE_BUTTONS)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const button of TABLE_CREATE_BUTTONS[page] as Array<string>) {
        const table: { file: string; rows: string } | undefined =
          CREATE_BUTTON_TABLES[button];

        expect({ button, table: Boolean(table) }).toEqual({
          button,
          table: true,
        });

        const source: string = fs.readFileSync(
          path.join(PACKAGES_DIR, table!.file),
          "utf8",
        );

        expect(button).toBe(`Create ${table!.rows}`);
        expect(source).toContain(`singularName="${table!.rows}"`);
        // A verb of its own is drawn before the rows' name.
        expect(source).not.toContain("createVerb=");
        expect(labels).toContain(button);
        expect(isDashboardLabel(button)).toBe(true);
        expect(drawnCreateButton("en", button)).toBe(button);
      }
    }
  });

  it("list only bold words the English page has", () => {
    for (const lists of [
      KEPT_IN_ENGLISH,
      SHOWN_IN_ENGLISH,
      SCRIPT_OUTPUT,
      EXTERNAL_CONSOLE_LABELS,
      MICROSOFT_PERMISSIONS,
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
  });

  it("keep in English only roles and permissions", () => {
    for (const page of Object.keys(KEPT_IN_ENGLISH)) {
      for (const name of KEPT_IN_ENGLISH[page] as Array<string>) {
        expect({ page, name, permission: true }).toEqual({
          page,
          name,
          permission: isPermissionOrRole(name),
        });
      }
    }
  });

  it("call shown in English only labels the Dashboard has no wording for", () => {
    for (const page of Object.keys(SHOWN_IN_ENGLISH)) {
      for (const label of SHOWN_IN_ENGLISH[page] as Array<string>) {
        expect({ label, isLabel: false }).toEqual({
          label,
          isLabel: isDashboardLabel(label),
        });

        for (const language of LANGUAGES) {
          expect(drawnDashboardLabel(language, label)).toBe(label);
        }
      }
    }
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

    // A lead that reads the same everywhere is a lead of some page.
    for (const lead of LEADS_THE_SAME_IN_EVERY_LANGUAGE) {
      expect(
        Object.values(PROSE_LEADS).some((leads: Array<string>): boolean => {
          return leads.includes(lead);
        }),
      ).toBe(true);
    }
  });

  it("name Admin Dashboard keys its English locale has", () => {
    for (const [english, key] of Object.entries(ADMIN_KEYS)) {
      expect({ english, value: nestedValue(adminLocale("en"), key) }).toEqual({
        english,
        value: english,
      });
    }

    for (const page of Object.keys(ADMIN_LABELS)) {
      for (const label of ADMIN_LABELS[page] as Array<string>) {
        for (const segment of label.split(PATH_SEPARATOR)) {
          expect({ label, segment, known: true }).toEqual({
            label,
            segment,
            known:
              segment === "Admin Dashboard" || Boolean(ADMIN_KEYS[segment]),
          });
        }
      }
    }
  });

  it("draw every Dashboard path's segments from the Dashboard's locale", () => {
    for (const page of PAGE_NAMES) {
      for (const english of pathsOf(page)) {
        if (listed(ADMIN_LABELS, page).includes(english)) {
          continue;
        }

        for (const segment of english.split(PATH_SEPARATOR)) {
          expect({ english, segment, known: true }).toEqual({
            english,
            segment,
            known: isDashboardLabel(segment),
          });
        }
      }
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
          return (
            !isDashboardLabel(span) && !known.includes(span) && !isQuote(span)
          );
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("quote, in English, every answer of a connect callback the guides list", () => {
    for (const page of Object.keys(CONNECT_CODES)) {
      const english: string = englishPage(page);

      for (const quote of connectQuotes("en", page)) {
        expect({ page, quote, quoted: english.includes(quote) }).toEqual({
          page,
          quote,
          quoted: true,
        });
      }

      // And no quote it does not explain.
      const quoted: Array<string> = boldLabels(english).filter(isQuote);

      expect(quoted.length).toBeLessThanOrEqual(
        (CONNECT_CODES[page] as ConnectQuotes).codes.length +
          (page === GITHUB ? 1 : 0),
      );
    }
  });

  it("quote messages, headings, details and numbers the English pages really have", () => {
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

    for (const page of Object.keys(QUOTED_HEADING_LABELS)) {
      const headings: Array<string> = headingTexts(englishPage(page));

      for (const label of QUOTED_HEADING_LABELS[page] as Array<string>) {
        expect(isDashboardLabel(label)).toBe(true);
        expect(
          headings.some((heading: string): boolean => {
            return heading.includes(`"${label}"`);
          }),
        ).toBe(true);
      }
    }

    for (const page of Object.keys(ADMIN_DETAILS_WORDS)) {
      const titles: Array<string> = detailsTitles(englishPage(page));

      for (const word of ADMIN_DETAILS_WORDS[page] as Array<string>) {
        expect(ADMIN_KEYS[word]).toBeDefined();
        expect(
          titles.some((title: string): boolean => {
            return title.includes(word);
          }),
        ).toBe(true);
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
          return (
            isDashboardLabel(label) &&
            !exceptions.includes(label) &&
            !isQuote(label)
          );
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

    /*
     * As often as the English page does, too: a label named in two places
     * (a step and the troubleshooting that sends the reader back to it) is
     * named in both, so one of them cannot drift to other words.
     */
    it("names each Dashboard label as often as the English page does", () => {
      const translated: string = prose(readPage(language, entry.page));
      const source: string = prose(english);
      const exceptions: Array<string> = notDashboardLabels(entry.page);
      const tooFew: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return (
            isDashboardLabel(label) &&
            !exceptions.includes(label) &&
            !isQuote(label)
          );
        })
        .map((label: string): [string, string] => {
          return [label, drawnLabel(language, entry.page, label)];
        })
        .filter(([label, drawn]: [string, string]): boolean => {
          return (
            occurrences(translated, `**${drawn}**`) <
            occurrences(source, `**${label}**`)
          );
        })
        .map(([label, drawn]: [string, string]): string => {
          return `${label} -> ${drawn}: ${occurrences(
            translated,
            `**${drawn}**`,
          )} of ${occurrences(source, `**${label}**`)}`;
        });

      expect(tooFew).toEqual([]);
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

    it("names the Admin Dashboard's switch and status as it draws them", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = listed(ADMIN_LABELS, entry.page)
        .filter((label: string): boolean => {
          return !PATH_SEPARATOR.test(label);
        })
        .map((label: string): string => {
          return adminLabel(language, label);
        })
        .filter((label: string): boolean => {
          return !translated.includes(`**${label}**`);
        });

      const titles: Array<string> = detailsTitles(translated);

      for (const word of listed(ADMIN_DETAILS_WORDS, entry.page)) {
        const drawn: string = adminLabel(language, word);

        if (
          !titles.some((title: string): boolean => {
            return title.includes(drawn);
          })
        ) {
          missing.push(drawn);
        }
      }

      expect(missing).toEqual([]);
    });

    it("quotes the sentence the page shows for every connect answer, as this language's Dashboard words it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = connectQuotes(language, entry.page).filter(
        (quote: string): boolean => {
          return !translated.includes(quote);
        },
      );

      expect(missing).toEqual([]);
    });

    it("quotes in its headings the buttons the English headings quote, as this language draws them", () => {
      const headings: Array<string> = headingTexts(
        readPage(language, entry.page),
      );
      const missing: Array<string> = listed(QUOTED_HEADING_LABELS, entry.page)
        .map((label: string): string => {
          return drawnDashboardLabel(language, label);
        })
        .filter((drawn: string): boolean => {
          return !headings.some((heading: string): boolean => {
            return heading.includes(`"${drawn}"`);
          });
        });

      expect(missing).toEqual([]);
    });

    /*
     * The leads, not the PROSE words: those are single words a language may
     * write as English does.
     */
    it("translates the page's own bold leads", () => {
      const translated: string = readPage(language, entry.page);
      const untranslated: Array<string> = listed(PROSE_LEADS, entry.page)
        .filter((lead: string): boolean => {
          return !LEADS_THE_SAME_IN_EVERY_LANGUAGE.includes(lead);
        })
        .filter((lead: string): boolean => {
          return translated.includes(`**${lead}**`);
        });

      expect(untranslated).toEqual([]);
    });

    it("keeps in English what stays English: roles, permissions, other consoles and labels the Dashboard draws in English", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(KEPT_IN_ENGLISH, entry.page),
        ...listed(SHOWN_IN_ENGLISH, entry.page),
        ...listed(SCRIPT_OUTPUT, entry.page),
        ...listed(EXTERNAL_CONSOLE_LABELS, entry.page),
        ...listed(MICROSOFT_PERMISSIONS, entry.page),
      ].filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });

    it("quotes what a script, the server or another product prints as it prints it, and states the English page's numbers", () => {
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
    const pattern: RegExp = pathPattern([
      "Projekteinstellungen",
      "Arbeitsbereich",
      "Slack",
    ]);

    expect(
      pattern.test("**Projekteinstellungen > Arbeitsbereich > Slack**"),
    ).toBe(true);
    expect(
      pattern.test("**Projekteinstellungen** > **Arbeitsbereich** > **Slack**"),
    ).toBe(true);
    expect(
      pattern.test("**Arbeitsbereich > Projekteinstellungen > Slack**"),
    ).toBe(false);
  });

  it("draw the Admin Dashboard's paths from its own locale, and the Dashboard's from the Dashboard's", () => {
    expect(
      drawnSegments("de", COMPOSE, "Settings > Notifications > Emails"),
    ).toEqual(["Einstellungen", "Benachrichtigungen", "E-Mails"]);
    expect(
      drawnSegments("de", TWILIO, "Admin Dashboard > Settings > Call and SMS"),
    ).toEqual(["Admin Dashboard", "Einstellungen", "Anrufe und SMS"]);
    expect(
      drawnSegments("de", SLACK, "Project Settings > Workspace > Slack"),
    ).toEqual(["Projekteinstellungen", "Arbeitsbereich", "Slack"]);
  });

  it("quote the first sentence of a connect answer in any script", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstSentence("一つ目です。二つ目です。")).toBe("一つ目です。");
    expect(firstSentence("पहला। दूसरा।")).toBe("पहला।");
    expect(firstSentence("Only one.")).toBe("Only one.");
  });

  it("quote a connect answer as the language's Dashboard words it", () => {
    expect(
      connectSentence(
        "de",
        ConnectProvider.Slack,
        ConnectCallbackError.Cancelled,
      ),
    ).toBe(
      dashboardLocale("de")[
        getConnectCallbackMessageKey(
          ConnectProvider.Slack,
          ConnectCallbackError.Cancelled,
        )
      ],
    );
    expect(connectQuotes("en", GITHUB)).toContain(
      '**"Connecting GitHub needs the ... plan."**',
    );
  });

  it("read numbers in any digits, without thousands separators", () => {
    expect(
      Array.from(statedNumbers("Bis zu 100.000 Zeilen, ۵۴۰۰ و 1,000.")),
    ).toEqual(["100000", "5400", "1000"]);
  });
});
