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
import { otherChangesItems } from "./UpgradingDocsNotes";
import { PermissionHelper } from "Common/Types/Permission";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 16: the upgrade guide (installation/upgrading) in every
 * docs language. Each translation says what the English page says - the same
 * sections, steps, tables, lists, cards, code and diagram, every note of
 * "Other changes in 14" in the English order with the English note's code
 * and links, a title that is the nav link's - and names each screen the way
 * the screen the reader is on draws it in their language.
 *
 * "The way it is drawn" has two sources on this page:
 *
 *   - The Dashboard, Persian included: a label, a menu path segment by
 *     segment, a "Mark as <state>" button filled from its template.
 *   - The Admin Dashboard: its breadcrumbs and its OneUptime Health page,
 *     and the names it draws in English in every language - "This
 *     installation" (no key of its locale) and the Health dashboards and the
 *     Query Console, which its own translated sentences keep in English.
 *
 * Other names stay in English on purpose, each list with its reason below:
 * roles and permissions, plans, the Slack, Microsoft Teams and mobile app
 * buttons, the workflow builder, metric names, the names people give their
 * own states, settings that no longer exist, the rules the upgrade adds,
 * product names and what a script or the server prints. A bold word that is
 * a Dashboard label by coincidence is PROSE; the page's own bold leads are
 * PROSE_LEADS. A new bold word on the English page fails "know every bold
 * word" until it is put in one of the lists.
 *
 * A link into another page keeps its English anchor's place: where the
 * other page is translated in the English shape, the link names the heading
 * in the English heading's place there (what docs:localize-anchors writes);
 * where it is not yet, the link opens the page, and this suite says which
 * anchor to put back once it is.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const PAGE: string = "installation/upgrading";
const NAV_TITLE: string = "Upgrading";

// Roles and permissions, as the role pickers and the API name them.
const ROLES_AND_PERMISSIONS: Array<string> = [
  "Project Admin",
  "Project Owner",
  "Viewer",
  "Settings Admin",
  "Settings Member",
  "Settings Viewer",
  "Read Probe",
  "Read AI Agent",
  "Read Incoming Call Policy",
  "Read Status Page SSO",
  "Read Status Page OIDC",
  "Manage Billing",
  "Create Team",
  "Create Incident State Timeline",
  "Edit Incident",
  "Edit Alert",
  "Create Alert State Timeline",
  "Create On-Call Duty Policy Execution Log",
  "Create Runbook Execution",
  "Edit Auto Remediation Rule",
];

/*
 * A family of permissions, named by what its members share: "Read All
 * Operational Resources", "Edit All Operational Resources" and the rest.
 */
const PERMISSION_FAMILIES: Array<string> = ["All Operational Resources"];

// Plans, as billing and the API name them.
const PLANS: Array<string> = ["Growth", "Scale"];

/*
 * The buttons of the Slack and Microsoft Teams apps and of the mobile app,
 * which draw them in English.
 */
const CHAT_AND_MOBILE_BUTTONS: Array<string> = [
  "Acknowledge",
  "Resolve",
  "Change State",
  "Mark as Complete",
  "Add Note",
  "Escalate",
];

// The workflow builder's triggers, steps, settings and outputs.
const WORKFLOW_BUILDER: Array<string> = [
  "On Update",
  "Listen on",
  "Create One Incident",
  "JSON Object",
  "Incident Template",
  "Error",
];

// Example states a project might add: names people give.
const EXAMPLE_STATES: Array<string> = ["Closed", "Investigating"];

// Metric names, as the metrics are named.
const METRIC_NAMES: Array<string> = ["Time to Acknowledge", "Time in State"];

// Switches and settings that no longer exist, named as they were.
const REMOVED_SETTINGS: Array<string> = [
  "Enable Auto-Remediation",
  "Enable AI Command Execution (for Runners)",
  "Enable AI Command Execution",
  "AI command execution",
];

// The names the upgrade gives the rules it adds.
const RULES_THE_UPGRADE_ADDS: Array<string> = [
  "Fix every incident with OneUptime AI",
  "Fix every alert with OneUptime AI",
];

// Products and components, by their names.
const PRODUCT_NAMES: Array<string> = [
  "OneUptime Enterprise Edition",
  "Runbook Agent",
  "AI Agent",
  "OneUptime Runner",
];

// What a script prints.
const SCRIPT_OUTPUT: Array<string> = ["OneUptime is up!"];

/*
 * Names the Admin Dashboard draws in English in every language: the edition
 * label's "This installation" has no key of its locale, and its own
 * translated sentences keep the Health dashboards and the Query Console in
 * English (ADMIN_SENTENCE_KEEPING_THEM).
 */
const ADMIN_DRAWN_IN_ENGLISH: Array<string> = [
  "This installation",
  "Health",
  "Query Console",
];

const ADMIN_SENTENCE_KEEPING_THEM: string =
  "The live OneUptime Health dashboards and the query console need an Enterprise license that includes instance health, and this installation's license is missing, expired or does not include it. Activate or renew the license from the Enterprise Edition badge at the top of the Admin Dashboard. While the license is missing or expired, SCIM provisioning and audit logging are off too; they come back with these screens as soon as a license is activated. ClickHouse capacity, the instance log, Global Probes, Migrations and the Support Bundle keep working without it; find them in the menu on the left.";

const KEPT_IN_ENGLISH: Array<string> = [
  ...ROLES_AND_PERMISSIONS,
  ...PERMISSION_FAMILIES,
  ...PLANS,
  ...CHAT_AND_MOBILE_BUTTONS,
  ...WORKFLOW_BUILDER,
  ...EXAMPLE_STATES,
  ...METRIC_NAMES,
  ...REMOVED_SETTINGS,
  ...RULES_THE_UPGRADE_ADDS,
  ...PRODUCT_NAMES,
  ...SCRIPT_OUTPUT,
  ...ADMIN_DRAWN_IN_ENGLISH,
];

/*
 * Dashboard labels the page names in two places of different screens: some
 * of their mentions stay in English (the count here), the rest are drawn
 * by the Dashboard. "Settings" is the Settings roles once and a page three
 * times; "Execute On-Call Policy" is a Slack and Microsoft Teams picker and
 * button twice and a record's action in the Dashboard once.
 */
const KEPT_IN_ENGLISH_SOME_TIMES: Record<string, number> = {
  Settings: 1,
  "Execute On-Call Policy": 2,
};

/*
 * "Mark as <state>" buttons, which a scheduled maintenance event's header
 * draws from the template "Mark as {{state}}" with the state's name; the
 * count is how many mentions are the Slack and Microsoft Teams button of
 * the same name, which stays in English.
 */
const MARK_AS: Record<string, { state: string; keptInEnglish: number }> = {
  "Mark as Ended": { state: "Ended", keptInEnglish: 0 },
  "Mark as Ongoing": { state: "Ongoing", keptInEnglish: 1 },
};

const MARK_AS_TEMPLATE: string = "Mark as {{state}}";

/*
 * The Admin Dashboard's words: its breadcrumb and its OneUptime Health page,
 * by the key each is drawn with ("Valkey" is drawn as it is).
 */
const ADMIN_KEYS: Record<string, string> = {
  "Admin Dashboard": "breadcrumbs.adminDashboard",
  "OneUptime Health": "OneUptime Health",
};

// The page's bold paths through the Admin Dashboard.
const ADMIN_PATHS: Array<string> = [
  "Admin Dashboard → OneUptime Health → Valkey",
];

// Bold words that are Dashboard labels by coincidence: words of the page.
const PROSE: Array<string> = ["teams"];

/*
 * The bold leads of the page's own lists, steps and sentences. They are
 * neither labels nor kept in English, so a translation words them; listing
 * them makes a new bold word fail until it is put in a list.
 */
const PROSE_LEADS: Array<string> = [
  "Upgrade one major version at a time",
  "Skip minor and patch releases as you like",
  "Back up before every upgrade",
  "Community Edition without SCIM:",
  "Helm with `image.type: enterprise-edition`:",
  "Docker Compose with `IS_ENTERPRISE_EDITION=true`:",
  "refuses to start",
  "Community image with SCIM already configured:",
  "An install with a license key",
  "An install with no license",
  "If you use SCIM or audit logging, activate a license before the trial ends.",
  "Air-gapped installs",
  "Decide which edition this install runs.",
  "On Helm, set the edition in your values file:",
  "On Docker Compose, set `APP_TAG=enterprise-release`",
  "On the Enterprise Edition, activate a license.",
  "If this install will run the Community Edition while your identity provider deprovisions users through SCIM, review who has access before you upgrade.",
  "If you monitor IPv6 addresses with Ping, Port or SSL monitors, re-save those monitors after the upgrade.",
  "A license that expires",
  "After the trial, or after that grace period",
  "Nothing is deleted, and core monitoring is never affected.",
  "A license key you already have is accepted",
  "A key whose expiry this install never recorded",
  "`npm run update` moves `APP_TAG` while `IS_ENTERPRISE_EDITION=true`",
  "Pulling images by hand skips that",
  "To move to the Community Edition deliberately",
  "An install already on `image.type: enterprise-edition` needs no values change.",
  "`image.tag: release` is the default",
  "`IS_ENTERPRISE_EDITION` is still emitted by the chart",
  "Chart probes honor `probes.<key>.allowPrivateNetworkMonitors` again",
  "OTLP ingest acknowledges a batch only after the queue accepts it.",
  "The Admin Dashboard Health dashboards and the Query Console need the Enterprise Edition",
  "HTTPS monitors that reach an IP address through a probe's proxy work again.",
  "The `oneuptime` CLI reports its real version",
  "A new alert or episode starts in the state its create names.",
  "A record created already acknowledged or resolved pages no one.",
  "A state after your resolved state counts as resolved everywhere.",
  "A state after your acknowledged state counts as acknowledged everywhere.",
  "Episodes move through their states by the rule incidents and alerts follow.",
  "A write of a record's current state follows the same rule.",
  "Change State in Slack and Microsoft Teams offers only the states a record may move into next.",
  "The error for a scheduled maintenance event moved back up its list reads like the others:",
  "Resolving an incident gives back only the monitors it holds.",
  "An incident's or alert's episode is set by the episode's members only.",
  "New incoming call escalation rules ring for 20 seconds, not 30.",
  "Slack and Microsoft Teams summaries keep their time of day when the clocks change.",
  'An incident\'s or alert\'s "updated" feed entry records only what changed.',
  'A scheduled maintenance event\'s or a monitor\'s "updated" feed entry records only what changed, too.',
  "A maintenance event in a state of your own before Ongoing starts at its time, and is listed as coming up.",
  "A maintenance event in a state of your own after Ongoing counts as in progress everywhere.",
  "Saving a secret back as it is changes nothing.",
  "On OneUptime Cloud, API keys stop working below their plan, and SCIM only removes people.",
  "A switch written as text is the switch that is stored, and a save that changes nothing starts nothing.",
  "Runners moved from Project Settings into Runbooks.",
  "Live updates end with the sign-in that opened them, and ask what every request asks.",
  "Turning a project's SSO provider off, or deleting it, ends the sign-ins it gave.",
  "Global and status page SSO providers end their sign-ins the same way, and turning on Require SSO for Login needs a provider.",
  "Creating a project follows the SSO rules too, and changes that let people sign in reach every app server at once.",
  "Saving Require SSO for Login on again is checked as turning it on is.",
  "A record you may not read can no longer be changed or deleted, and a change by ID that reaches nothing says so.",
  "A record read through another one is created only under a record its creator may read.",
  "Owned",
  "A record moved under another one, or given more records in a list, gets only records its editor may read, and a create permission restricted to labels or to Owned scope holds the record it creates.",
  "The one record a write names, and a change of a record's labels, keep to the caller's permissions too.",
  "What a subscription, a rule's Run Now, an LLM provider list and an AI plan's approval reach stays within what they are allowed.",
  "Who owns a resource, and a setting that holds credentials, are named only by someone who may read them.",
  "Every grant and scope narrows what it reaches, and a read by ID of a record you may not read answers `404`.",
  "Runbook Member runs runbooks and builds none.",
  "The billing roles do what they say.",
  "The owners' emails follow team blocks.",
  "Every role's description says what the role does.",
  "Connecting Slack, Microsoft Teams or GitHub that does not finish says why, on the page it started from.",
  "A server admin is held to no plan inside a project.",
  "Changing a state takes the state timeline's permission, and nothing more.",
  "Acknowledging alerts as you declare an incident takes what acknowledging them takes anywhere else.",
  "An incoming call policy's phone numbers follow the policy's roles.",
  "Slack and Microsoft Teams forms act as the OneUptime member who uses them.",
  "Slack and Microsoft Teams buttons act as the OneUptime member who presses them.",
  "Ask AI's actions are made as the person who asked.",
  "An SSH credential reaches a Runner that runs OneUptime AI's commands only through someone who may read runbook credentials.",
  "An LLM provider's Additional Parameters are read like its API key, and its Base URL is changed only by those who may read them.",
  "Probes and AI agents are read only by members of their project.",
  "An update or a delete names its project.",
  "A database statement the app stops waiting for is cancelled.",
  "re-open each IPv6 Ping, Port and SSL monitor after the upgrade and save it again",
  "Upgrade the OneUptime server before the chart.",
  "Mirror the image, or opt out, if your upgrades wait.",
  "`aiAccess` settings carry over.",
  "Cluster AI settings are kept",
  "To downgrade the chart, use `helm rollback`",
  "Settings you chose stay.",
  "A configuration that names them wins.",
  "Nothing chosen yet: the agent's defaults.",
  "edition label in the Admin Dashboard header",
  "Compose:",
  "Helm:",
  "Docker Compose:",
  "Every old name still works",
  "You point OneUptime at a cache you run yourself",
  "You have dashboards, alerts, network policies or scripts keyed on the Kubernetes object names:",
  "The cache restarts once",
  "Use `--remove-orphans` if you run compose by hand.",
  "Your `config.env` is not rewritten.",
  "No values change is needed.",
  "Nothing rotates.",
  "Both old Secrets are kept.",
  "Object names change.",
  "If you had `persistence.enabled: true`",
  "`extraEnv` overrides stop reaching the cache — this one fails silently.",
  "The API keeps its shape.",
  "Redis-protocol vocabulary:",
  "The default hostname is still `redis`",
  "capabilities",
  "Everyone:",
  "You installed Runbook Agents on your hosts:",
  "one security-relevant step",
  "API keys that were granted agent permissions directly:",
  "team",
  "Runbook Agent containers you have not redeployed yet keep heartbeating and executing Bash and JavaScript steps",
  "SSH and Kubernetes steps (new in v12) fail on old agents.",
  "before",
  "unchanged",
  "silently ignored",
  "Important — set `ONEUPTIME_RUNNER_KEY` to a random value.",
  "not",
  "Remove the orphaned `ai-agent` container.",
  "fails validation",
  "directly to an API key",
  "SCIM provisioning and team compliance settings moved to the Enterprise Edition",
  "The ClickHouse telemetry storage was rebuilt",
  "SCIM user provisioning",
  "Team compliance settings",
  "What you'll see after upgrading:",
  "preserved in the database",
  "Availability:",
  "Self-hosted:",
  "OneUptime Cloud:",
  "If you rely on SCIM and self-host",
  "if you query the OneUptime analytics API directly with `serviceId`/`serviceType` filters, update them to the new names.",
  "forward-only",
  "dropped automatically",
  "Already on 11.0.0 or 11.0.1?",
  "drops them at boot",
  "Fresh installations:",
  "Upgrades that don't need pre-upgrade telemetry in the UI:",
  "Upgrades that want pre-upgrade telemetry visible:",
  "before the upgrade",
  "after the upgrade has fully booted",
  "re-running a statement that failed partway is safe",
  "same",
  "per-host",
];

/*
 * Bold leads that may read the same in a translation: names of products and
 * deployment paths. Every other lead is the page's own English, which a
 * translation translates.
 */
const LEADS_THE_SAME_IN_EVERY_LANGUAGE: Array<string> = [
  "Compose:",
  "Helm:",
  "Docker Compose:",
  "OneUptime Cloud:",
  "Self-hosted:",
];

/*
 * What the server, the API or a log prints in English, whatever the reader's
 * language: the page quotes it as it is printed.
 */
const SERVER_MESSAGES: Array<string> = [
  '"... is already acknowledged."',
  '"Episode cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of incident states."',
  '"There is no later state to move this incident to."',
  '"Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."',
  '"All labels removed."',
  '"No other affected resources."',
  '"Looking up phone numbers needs permission to read incoming call policies and call and SMS settings."',
  '"This OneUptime server does not have the Kubernetes AI agent API"',
  '"Project Settings > Runners"',
];

/*
 * Setting names the page quotes in running text, kept as the edition notes
 * of every docs language name them (EnterpriseEditionDocs).
 */
const QUOTED_SETTING_NAMES: Array<string> = [
  "Require SSO for login",
  "Require SSO for Login",
];

const REGEX_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;
const PATH_SEPARATOR: RegExp = / (?:→|>) /;
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
// A number, but not a part of a version such as 13.0.8 or 8.1.
const NUMBER: RegExp = /(?<!\d|\d\.)\d+(?!\d|\.\d)/g;
const THOUSANDS: RegExp = /(\d)[,.٬   '](?=\d{3}\b)/g;
const LIST_MARKER: RegExp = /^\s*(?:[-*]|\d+\.)\s/;
const BLOCK_START: RegExp = /^\s*(?:#|:::|@tab|\||>)/;
const FENCE_LINE: RegExp = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_LINE: RegExp = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const SPACES: RegExp = /\s+/;

function englishPage(): string {
  return readPage("en", PAGE);
}

function translatedPage(language: string): string {
  return readPage(language, PAGE);
}

/*
 * The English page with every wrapped paragraph and list item on one line,
 * as the translations are written, so a bold span that wraps is one span.
 */
function unwrapped(markdown: string): string {
  const lines: Array<string> = [];

  for (const line of prose(markdown).split("\n")) {
    const previous: string | undefined = lines[lines.length - 1];
    const continues: boolean =
      previous !== undefined &&
      previous.trim() !== "" &&
      line.trim() !== "" &&
      !LIST_MARKER.test(line) &&
      !BLOCK_START.test(line) &&
      !BLOCK_START.test(previous);

    if (continues) {
      lines[lines.length - 1] = `${previous} ${line.trim()}`;
      continue;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

// The bold spans of a page's prose, once each.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(unwrapped(markdown));
}

// How many times a text holds a piece of text.
function occurrences(text: string, needle: string): number {
  return needle ? text.split(needle).length - 1 : 0;
}

function boldCount(markdown: string, label: string): number {
  return occurrences(unwrapped(markdown), `**${label}**`);
}

function isPermissionOrRole(name: string): boolean {
  return PermissionHelper.getAllPermissionProps().some(
    (props: { title: string }): boolean => {
      return props.title === name;
    },
  );
}

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
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

// A value of a locale: a flat key, or a dotted path of nested keys.
function localeValue(
  locale: Record<string, unknown>,
  key: string,
): string | null {
  const flat: unknown = locale[key];

  if (typeof flat === "string" && flat.trim()) {
    return flat;
  }

  let value: unknown = locale;

  for (const part of key.split(".")) {
    if (!value || typeof value !== "object") {
      return null;
    }

    value = (value as Record<string, unknown>)[part];
  }

  return typeof value === "string" && value.trim() ? value : null;
}

// How the Admin Dashboard draws one of its words, as it is where it has none.
function adminLabel(language: string, english: string): string {
  const key: string | undefined = ADMIN_KEYS[english];

  if (!key) {
    return english;
  }

  return localeValue(adminLocale(language), key) || english;
}

// "Mark as <state>", as a scheduled maintenance event's header draws it.
function drawnMarkAs(language: string, label: string): string {
  const state: string = MARK_AS[label]!.state;

  if (language === "en") {
    return label;
  }

  const template: string =
    localeValue(dashboardLocale(language), MARK_AS_TEMPLATE) ||
    MARK_AS_TEMPLATE;

  return template.replace("{{state}}", drawnDashboardLabel(language, state));
}

// The bold spans of the English page that are menu paths.
function pathsOf(markdown: string): Array<string> {
  return boldLabels(markdown).filter((span: string): boolean => {
    return PATH_SEPARATOR.test(span);
  });
}

// A path's segments, as the screen it runs through draws them.
function drawnSegments(language: string, english: string): Array<string> {
  const isAdmin: boolean = ADMIN_PATHS.includes(english);

  return english.split(PATH_SEPARATOR).map((segment: string): string => {
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
 * The Dashboard labels of the English page that a translation draws as the
 * Dashboard does: every bold label that is not a path, not kept in English,
 * not prose and not a "Mark as" button.
 */
function drawnLabels(): Array<string> {
  return boldLabels(englishPage()).filter((label: string): boolean => {
    return (
      isDashboardLabel(label) &&
      !KEPT_IN_ENGLISH.includes(label) &&
      !PROSE.includes(label) &&
      !PATH_SEPARATOR.test(label)
    );
  });
}

/*
 * Every number some text states outside its code, as Latin digits without
 * thousands separators ("10,000", "10.000" and "10 000" are one number).
 */
function statedNumbers(text: string): Array<string> {
  return (toLatinDigits(text.replace(INLINE_CODE_SPAN, " "))
    .replace(THOUSANDS, "$1")
    .match(NUMBER) || []) as Array<string>;
}

// The items of a multiset that another lacks.
function missingFrom(
  expected: Array<string>,
  actual: Array<string>,
): Array<string> {
  const left: Array<string> = [...actual];
  const missing: Array<string> = [];

  for (const value of expected) {
    const at: number = left.indexOf(value);

    if (at < 0) {
      missing.push(value);
      continue;
    }

    left.splice(at, 1);
  }

  return missing;
}

// The pages some Markdown links to, in order, anchors left out.
function linkedPages(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return link.target.split("#")[0]!;
  });
}

/*
 * A page's sections, as the text between one heading and the next, in
 * order; the part above the first heading first.
 */
function sectionsOf(markdown: string): Array<string> {
  const sections: Array<Array<string>> = [[]];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    if (!inFence && HEADING_LINE.test(line)) {
      sections.push([]);
    }

    sections[sections.length - 1]!.push(line);
  }

  return sections.map((section: Array<string>): string => {
    return section.join("\n");
  });
}

/*
 * A page's headings, title included, with the code languages under each:
 * what docs:localize-anchors compares to decide whether a translation has
 * the English page's shape.
 */
interface ShapedHeading {
  anchor: string;
  level: number;
  code: Array<string>;
}

function shapedHeadings(markdown: string): Array<ShapedHeading> {
  const headings: Array<ShapedHeading> = [];
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    const fenceMatch: RegExpMatchArray | null = line.match(FENCE_LINE);

    if (fenceMatch) {
      const marker: string = fenceMatch[1]!;

      if (fence === null) {
        fence = marker;
        const language: string =
          (fenceMatch[2] || "").trim().split(SPACES)[0] || "";

        headings[headings.length - 1]?.code.push(language.toLowerCase());
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }

      continue;
    }

    if (fence !== null) {
      continue;
    }

    const heading: RegExpMatchArray | null = line.match(HEADING_LINE);

    if (heading) {
      headings.push({
        anchor: slugifyMarkdownHeading(heading[2]!.trim()),
        level: heading[1]!.length,
        code: [],
      });
    }
  }

  return headings;
}

function shapeOf(headings: Array<ShapedHeading>): string {
  return headings
    .map((heading: ShapedHeading): string => {
      return `${heading.level}[${heading.code.join(",")}]`;
    })
    .join(" ");
}

/*
 * The anchor a translation's link to another page's English anchor must
 * name: the heading in the English heading's place, when that page has the
 * English shape in this language; null when it is not translated in that
 * shape yet (the link then opens the page, or a heading it has).
 */
function expectedAnchor(
  language: string,
  page: string,
  englishAnchor: string,
): string | null {
  if (!hasPage(language, page)) {
    // The docs serve the English page, whose anchors the link keeps.
    return englishAnchor;
  }

  const english: Array<ShapedHeading> = shapedHeadings(readPage("en", page));
  const translated: Array<ShapedHeading> = shapedHeadings(
    readPage(language, page),
  );

  if (shapeOf(english) !== shapeOf(translated)) {
    return null;
  }

  const index: number = english.findIndex(
    (heading: ShapedHeading): boolean => {
      return heading.anchor === englishAnchor;
    },
  );

  return index < 0 ? null : translated[index]!.anchor;
}

// The links of a page, in order, as page and anchor ("" for an in-page link).
function linksOf(
  markdown: string,
): Array<{ page: string; anchor: string | null }> {
  return scanMarkdown(markdown)
    .links.map((link: DocsLink): { page: string; anchor: string | null } => {
      if (link.target.startsWith("#")) {
        return { page: "", anchor: decodeURIComponent(link.target.slice(1)) };
      }

      const target: { page: string; anchor: string | null } | null =
        parseDocsLink(link.target);

      if (!target) {
        return { page: link.target, anchor: null };
      }

      return {
        page: target.page,
        anchor: target.anchor ? decodeURIComponent(target.anchor) : null,
      };
    })
    .filter((link: { page: string; anchor: string | null }): boolean => {
      return !link.page.startsWith("http") && !link.page.startsWith("mailto");
    });
}

// The page's headings below its title.
function sections(markdown: string): Array<DocsHeading> {
  return scanMarkdown(markdown).headings.filter(
    (heading: DocsHeading): boolean => {
      return heading.line !== 1;
    },
  );
}

describe("the lists this test keeps", () => {
  it("keep in English only what the lists say they are", () => {
    for (const name of ROLES_AND_PERMISSIONS) {
      expect({ name, permission: true }).toEqual({
        name,
        permission: isPermissionOrRole(name),
      });
    }

    for (const family of PERMISSION_FAMILIES) {
      for (const verb of ["Read", "Edit", "Delete", "Create"]) {
        expect({ family, verb, permission: true }).toEqual({
          family,
          verb,
          permission: isPermissionOrRole(`${verb} ${family}`),
        });
      }
    }

    // Example states and metric names are no permission, and the plans are plans.
    for (const name of [...EXAMPLE_STATES, ...METRIC_NAMES]) {
      expect({ name, permission: false }).toEqual({
        name,
        permission: isPermissionOrRole(name),
      });
    }
  });

  it("draw the Admin Dashboard's English names as it draws them", () => {
    // "This installation" is no key of any Admin Dashboard locale.
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        key: localeValue(adminLocale(language), "This installation"),
      }).toEqual({ language, key: null });
    }

    // Its translated sentences keep the Health dashboards and the Query Console.
    for (const language of LANGUAGES) {
      const sentence: string =
        localeValue(adminLocale(language), ADMIN_SENTENCE_KEEPING_THEM) || "";

      expect({
        language,
        translated: sentence !== ADMIN_SENTENCE_KEEPING_THEM,
        health: sentence.includes("Health"),
        console: sentence.includes("Query Console"),
      }).toEqual({ language, translated: true, health: true, console: true });
    }

    // The Admin Dashboard's own keys say what the page writes in English.
    for (const [english, key] of Object.entries(ADMIN_KEYS)) {
      expect({ english, value: localeValue(adminLocale("en"), key) }).toEqual({
        english,
        value: english,
      });
    }
  });

  it("draw the Health page's path as the Admin Dashboard's code names it", () => {
    const navBar: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App/FeatureSet/AdminDashboard/src/Components/NavBar/NavBar.tsx",
      ),
      "utf8",
    );
    const healthPage: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App/FeatureSet/AdminDashboard/src/Pages/Health/HealthPage.tsx",
      ),
      "utf8",
    );
    const valkey: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "App/FeatureSet/AdminDashboard/src/Pages/Health/Redis.tsx",
      ),
      "utf8",
    );

    expect(navBar).toContain('title: "OneUptime Health"');
    expect(healthPage).toContain('t("breadcrumbs.adminDashboard")');
    expect(healthPage).toContain('title: "OneUptime Health"');
    expect(valkey).toContain('title="Valkey"');

    for (const path_ of ADMIN_PATHS) {
      for (const segment of path_.split(PATH_SEPARATOR)) {
        expect({ segment, known: true }).toEqual({
          segment,
          known: segment === "Valkey" || Boolean(ADMIN_KEYS[segment]),
        });
      }
    }
  });

  it("call shown-some-times and Mark as only labels the page names", () => {
    const labels: Array<string> = boldLabels(englishPage());

    for (const [label, kept] of Object.entries(KEPT_IN_ENGLISH_SOME_TIMES)) {
      expect({ label, isLabel: true, known: true }).toEqual({
        label,
        isLabel: isDashboardLabel(label),
        known: labels.includes(label),
      });
      expect(kept).toBeLessThan(boldCount(englishPage(), label));
    }

    for (const [label, markAs] of Object.entries(MARK_AS)) {
      expect({ label, known: true, isLabel: true }).toEqual({
        label,
        known: labels.includes(label),
        isLabel: isDashboardLabel(markAs.state),
      });
      expect(markAs.keptInEnglish).toBeLessThan(
        boldCount(englishPage(), label),
      );
    }

    expect(isDashboardLabel(MARK_AS_TEMPLATE)).toBe(true);
  });

  it("call prose only Dashboard labels, and leads only what is no label at all", () => {
    for (const label of PROSE) {
      expect({ label, isLabel: true }).toEqual({
        label,
        isLabel: isDashboardLabel(label),
      });
    }

    for (const lead of PROSE_LEADS) {
      expect({ lead, isLabel: false }).toEqual({
        lead,
        isLabel: isDashboardLabel(lead),
      });
    }

    for (const lead of LEADS_THE_SAME_IN_EVERY_LANGUAGE) {
      expect(PROSE_LEADS).toContain(lead);
    }
  });

  it("list only bold words the English page has", () => {
    const labels: Array<string> = boldLabels(englishPage());

    for (const name of [
      ...KEPT_IN_ENGLISH,
      ...PROSE,
      ...PROSE_LEADS,
      ...ADMIN_PATHS,
      ...Object.keys(MARK_AS),
      ...Object.keys(KEPT_IN_ENGLISH_SOME_TIMES),
    ]) {
      expect({ name, bold: true }).toEqual({
        name,
        bold: labels.includes(name),
      });
    }
  });

  it("know every bold word on the English page", () => {
    const known: Array<string> = [
      ...KEPT_IN_ENGLISH,
      ...PROSE,
      ...PROSE_LEADS,
      ...ADMIN_PATHS,
      ...Object.keys(MARK_AS),
    ];
    const unlisted: Array<string> = boldLabels(englishPage()).filter(
      (span: string): boolean => {
        return (
          !known.includes(span) &&
          !isDashboardLabel(span) &&
          !PATH_SEPARATOR.test(span)
        );
      },
    );

    expect(unlisted).toEqual([]);
  });

  it("draw every Dashboard path's segments from the Dashboard's locale", () => {
    for (const english of pathsOf(englishPage())) {
      if (ADMIN_PATHS.includes(english)) {
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
  });

  it("quote messages and setting names the English page really has", () => {
    const english: string = unwrapped(englishPage());

    for (const message of SERVER_MESSAGES) {
      expect({ message, quoted: true }).toEqual({
        message,
        quoted: english.includes(message),
      });
    }

    for (const name of QUOTED_SETTING_NAMES) {
      expect(occurrences(english, name)).toBeGreaterThan(0);
    }
  });
});

describe("the English page", () => {
  it("is titled as its nav link", () => {
    expect(englishPage().split("\n")[0]).toBe(`# ${NAV_TITLE}`);
  });

  it("ends on a Next steps section of cards", () => {
    const scanned: ScannedPage = scanMarkdown(englishPage());
    const last: DocsHeading = scanned.headings[
      scanned.headings.length - 1
    ] as DocsHeading;

    expect(last).toEqual(expect.objectContaining({ level: 2 }));
    expect(last.text).toBe("Next steps");
    expect(cardLines(englishPage()).length).toBeGreaterThan(0);
  });

  it("draws the upgrade loop as a diagram with a caption, and walks it in steps", () => {
    const diagrams: Array<{ info: string }> = scanMarkdown(
      englishPage(),
    ).fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === "mermaid";
    });

    expect(diagrams.length).toBeGreaterThan(0);

    for (const diagram of diagrams) {
      expect(diagram.info).toMatch(/title="[^"]+"/);
    }

    expect(englishPage()).toContain(":::steps");
    expect(englishPage()).toContain(":::tabs");
  });

  it("has no comment a reader would see as text", () => {
    expect(englishPage()).not.toContain("<!--");
    expect(englishPage()).not.toContain("TODO(i18n)");
  });
});

describe.each(LANGUAGES)("the %s upgrade guide", (language: string) => {
  const english: string = englishPage();

  it("is translated, under the nav link's title", () => {
    expect(hasPage(language, PAGE)).toBe(true);

    const translated: string = translatedPage(language);
    const title: string = navTitle(language, NAV_TITLE);

    expect(translated).not.toEqual(english);
    expect(typeof title).toBe("string");
    expect(translated.split("\n")[0]).toBe(`# ${title}`);
  });

  it("is translated in full, with no comment a reader would see as text", () => {
    const translated: string = translatedPage(language);

    expect(translated).not.toContain("TODO(i18n)");
    expect(translated).not.toContain("<!--");
  });

  it("keeps every code block, and builds the diagram the same way", () => {
    expect(
      scanMarkdown(translatedPage(language)).fences.map(comparableFence),
    ).toEqual(scanMarkdown(english).fences.map(comparableFence));
  });

  it("keeps every piece of inline code, section by section", () => {
    const translated: Array<string> = sectionsOf(translatedPage(language));
    const source: Array<string> = sectionsOf(english);

    expect(translated.length).toBe(source.length);

    const differing: Array<string> = source
      .map((section: string, index: number): string | null => {
        const expected: Array<string> = inlineCode(unwrapped(section));
        const actual: Array<string> = inlineCode(
          unwrapped(translated[index] || ""),
        );

        return JSON.stringify(expected) === JSON.stringify(actual)
          ? null
          : `section ${index}: missing ${JSON.stringify(
              missingFrom(expected, actual),
            )}, extra ${JSON.stringify(missingFrom(actual, expected))}`;
      })
      .filter((problem: string | null): problem is string => {
        return problem !== null;
      });

    expect(differing).toEqual([]);
  });

  it("closes every bold and code span it opens", () => {
    const unbalanced: Array<string> = prose(translatedPage(language))
      .split("\n")
      .filter((line: string): boolean => {
        const ticks: number = line.split("`").length - 1;
        const outsideCode: string = line.replace(INLINE_CODE_SPAN, "");
        const stars: number = outsideCode.split("**").length - 1;

        return ticks % 2 !== 0 || stars % 2 !== 0;
      });

    expect(unbalanced).toEqual([]);
  });

  it("draws every bold and italic span, with no asterisks or underscores left on the page", async () => {
    expect(await strayMarkers(translatedPage(language), language)).toEqual(
      [],
    );
  });

  it("has the English page's headings, steps, tables and list items", () => {
    const translated: string = translatedPage(language);

    expect(
      scanMarkdown(translated).headings.map((heading: DocsHeading) => {
        return heading.level;
      }),
    ).toEqual(
      scanMarkdown(english).headings.map((heading: DocsHeading) => {
        return heading.level;
      }),
    );
    expect(
      scanMarkdown(translated).containers.map(
        (container: { name: string; tabs: Array<string>; steps: number }) => {
          return [container.name, container.tabs.length, container.steps];
        },
      ),
    ).toEqual(
      scanMarkdown(english).containers.map(
        (container: { name: string; tabs: Array<string>; steps: number }) => {
          return [container.name, container.tabs.length, container.steps];
        },
      ),
    );
    expect(tableShape(translated)).toEqual(tableShape(english));
    expect(listItemCount(translated)).toBe(listItemCount(english));
  });

  /*
   * Every note of "Other changes in 14", in the English order: the same
   * code, the same pages linked and the same numbers, note by note, so no
   * note is dropped, merged or cut short.
   */
  it("carries every note of the 13 → 14 changes, in order, with its code, links and numbers", () => {
    const source: Array<string> = otherChangesItems("en");
    const translated: Array<string> = otherChangesItems(language);

    expect(translated.length).toBe(source.length);

    const problems: Array<string> = [];

    source.forEach((wrapped: string, index: number) => {
      // A note wraps in English: a code span or a link may span two lines.
      const note: string = unwrapped(wrapped);
      const other: string = unwrapped(translated[index] || "");
      const missingCode: Array<string> = missingFrom(
        inlineCode(note),
        inlineCode(other),
      );
      const extraCode: Array<string> = missingFrom(
        inlineCode(other),
        inlineCode(note),
      );
      const missingNumbers: Array<string> = missingFrom(
        statedNumbers(note),
        statedNumbers(other),
      );

      if (missingCode.length > 0 || extraCode.length > 0) {
        problems.push(
          `note ${index}: code missing ${JSON.stringify(missingCode)}, extra ${JSON.stringify(extraCode)}`,
        );
      }

      if (
        JSON.stringify(linkedPages(note)) !== JSON.stringify(linkedPages(other))
      ) {
        problems.push(`note ${index}: links ${linkedPages(other).join(" ")}`);
      }

      if (missingNumbers.length > 0) {
        problems.push(
          `note ${index}: numbers missing ${JSON.stringify(missingNumbers)}`,
        );
      }
    });

    expect(problems).toEqual([]);
  });

  it("writes its cards with an ASCII ': ' after the link, to the English cards' pages", () => {
    const translated: Array<string> = cardLines(translatedPage(language));

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
    expect(anchorProblems(language, PAGE)).toEqual([]);
  });

  /*
   * In order, every link names the page the English link names, and the
   * heading in the English heading's place: on this page always, on
   * another page wherever that page is translated in the English shape.
   */
  it("points every link at the heading the English link means", () => {
    const source: Array<{ page: string; anchor: string | null }> =
      linksOf(unwrapped(english));
    const translated: Array<{ page: string; anchor: string | null }> =
      linksOf(unwrapped(translatedPage(language)));

    expect(translated.map((link: { page: string }) => link.page)).toEqual(
      source.map((link: { page: string }) => link.page),
    );

    const englishSections: Array<DocsHeading> = sections(english);
    const translatedSections: Array<DocsHeading> = sections(
      translatedPage(language),
    );
    const problems: Array<string> = [];

    source.forEach((link: { page: string; anchor: string | null }, index) => {
      const other: { page: string; anchor: string | null } = translated[
        index
      ]!;

      if (link.anchor === null) {
        if (other.anchor !== null) {
          problems.push(`link ${index} to ${link.page}: an anchor English has not`);
        }

        return;
      }

      if (link.page === "") {
        const at: number = englishSections.findIndex(
          (heading: DocsHeading): boolean => {
            return heading.slug === link.anchor;
          },
        );
        const expected: string | undefined = translatedSections[at]?.slug;

        if (other.anchor !== expected) {
          problems.push(
            `link ${index} #${link.anchor}: #${other.anchor} should be #${expected}`,
          );
        }

        return;
      }

      const expected: string | null = expectedAnchor(
        language,
        link.page,
        link.anchor,
      );

      if (expected !== null && other.anchor !== expected) {
        problems.push(
          `link ${index} to ${link.page}#${link.anchor}: write #${expected} (the ${language} page now has the English shape)`,
        );
      }
    });

    expect(problems).toEqual([]);
  });

  it("names every Dashboard label as this language's Dashboard draws it, as often as the English page does", () => {
    const translated: string = translatedPage(language);
    const tooFew: Array<string> = drawnLabels()
      .map((label: string): [string, string, number] => {
        const kept: number = KEPT_IN_ENGLISH_SOME_TIMES[label] || 0;

        return [
          label,
          drawnDashboardLabel(language, label),
          boldCount(english, label) - kept,
        ];
      })
      .filter(([label, drawn, needed]: [string, string, number]): boolean => {
        const kept: number = KEPT_IN_ENGLISH_SOME_TIMES[label] || 0;

        if (drawn === label) {
          return boldCount(translated, drawn) < needed + kept;
        }

        return (
          boldCount(translated, drawn) < needed ||
          boldCount(translated, label) < kept
        );
      })
      .map(([label, drawn, needed]: [string, string, number]): string => {
        return `${label} -> ${drawn}: ${boldCount(translated, drawn)} of ${needed}`;
      });

    expect(tooFew).toEqual([]);
  });

  it("names each Mark as button as the event's header draws it, and the chat buttons in English", () => {
    const translated: string = translatedPage(language);
    const problems: Array<string> = [];

    for (const [label, markAs] of Object.entries(MARK_AS)) {
      const drawn: string = drawnMarkAs(language, label);
      const needed: number = boldCount(english, label) - markAs.keptInEnglish;

      if (boldCount(translated, drawn) < needed) {
        problems.push(`${label} -> ${drawn}: ${boldCount(translated, drawn)} of ${needed}`);
      }

      if (boldCount(translated, label) < markAs.keptInEnglish) {
        problems.push(`${label} in English: ${boldCount(translated, label)} of ${markAs.keptInEnglish}`);
      }
    }

    expect(problems).toEqual([]);
  });

  it("writes every menu path segment by segment, as the screens draw them", () => {
    const translated: string = translatedPage(language);
    const missing: Array<string> = pathsOf(english)
      .map((path_: string): Array<string> => {
        return drawnSegments(language, path_);
      })
      .filter((segments: Array<string>): boolean => {
        return !pathPattern(segments).test(translated);
      })
      .map((segments: Array<string>): string => {
        return segments.join(" > ");
      });

    expect(missing).toEqual([]);
  });

  it("keeps in English what stays English, as often as the English page names it", () => {
    const translated: string = translatedPage(language);
    const missing: Array<string> = KEPT_IN_ENGLISH.filter(
      (name: string): boolean => {
        return boldCount(translated, name) < boldCount(english, name);
      },
    );

    expect(missing).toEqual([]);
  });

  it("translates the page's own bold leads", () => {
    const translated: string = translatedPage(language);
    const untranslated: Array<string> = PROSE_LEADS.filter(
      (lead: string): boolean => {
        return (
          !LEADS_THE_SAME_IN_EVERY_LANGUAGE.includes(lead) &&
          translated.includes(`**${lead}**`)
        );
      },
    );

    expect(untranslated).toEqual([]);
  });

  it("quotes what the server prints as it prints it, and the setting names as the edition notes keep them", () => {
    const translated: string = unwrapped(translatedPage(language));

    for (const message of SERVER_MESSAGES) {
      expect({ message, quoted: true }).toEqual({
        message,
        quoted: translated.includes(message),
      });
    }

    for (const name of QUOTED_SETTING_NAMES) {
      expect({ name, times: occurrences(translated, name) }).toEqual({
        name,
        times: occurrences(unwrapped(english), name),
      });
    }
  });

  it("states the English page's numbers", () => {
    const missing: Array<string> = missingFrom(
      Array.from(new Set(statedNumbers(unwrapped(english)))),
      Array.from(new Set(statedNumbers(translatedPage(language)))),
    );

    expect(missing).toEqual([]);
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these check
 * the page-specific readers.
 */
describe("the helpers, on this page's shapes", () => {
  it("read a wrapped paragraph and list item as one line", () => {
    expect(
      unwrapped(
        [
          "- **A lead that",
          "  wraps.** And its text",
          "  goes on.",
          "- Next",
          "",
          "| a | b |",
          "| --- | --- |",
        ].join("\n"),
      ),
    ).toBe(
      [
        "- **A lead that wraps.** And its text goes on.",
        "- Next",
        "",
        "| a | b |",
        "| --- | --- |",
      ].join("\n"),
    );
  });

  it("draw a path in one span or a span a segment, joined by → or >", () => {
    const pattern: RegExp = pathPattern(["Runbooks", "Runbook-Agents"]);

    expect(pattern.test("**Runbooks → Runbook-Agents**")).toBe(true);
    expect(pattern.test("**Runbooks** > **Runbook-Agents**")).toBe(true);
    expect(pattern.test("**Runbook-Agents → Runbooks**")).toBe(false);
  });

  it("fill a Mark as button from the language's template and state", () => {
    expect(drawnMarkAs("en", "Mark as Ended")).toBe("Mark as Ended");
    expect(drawnMarkAs("de", "Mark as Ended")).toBe(
      String(dashboardLocale("de")[MARK_AS_TEMPLATE]).replace(
        "{{state}}",
        String(dashboardLocale("de")["Ended"]),
      ),
    );
  });

  it("draw the Admin Dashboard's path from its own locale", () => {
    expect(
      drawnSegments("de", "Admin Dashboard → OneUptime Health → Valkey"),
    ).toEqual([
      String(localeValue(adminLocale("de"), "breadcrumbs.adminDashboard")),
      String(localeValue(adminLocale("de"), "OneUptime Health")),
      "Valkey",
    ]);
  });

  it("read numbers in any digits, leaving code out", () => {
    expect(statedNumbers("Bis zu 30 Tage, ۱۴ روز, `404` und 5")).toEqual([
      "30",
      "14",
      "5",
    ]);
  });

  it("map an anchor into a page only when its translation has the English shape", () => {
    expect(expectedAnchor("de", PAGE, "how-to-upgrade")).toBe(
      sections(translatedPage("de"))[0]!.slug,
    );
  });
});
