import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
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
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  tableShape,
} from "./DocsTranslationChecks";
import {
  CUSTOM_DOMAIN_STATUS,
  CustomDomainCopy,
} from "../../../FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 10: the Logs, Metrics, Traces, Exceptions and Profiles
 * monitor pages, and the status page Resources & Groups and Branding &
 * Domains pages, in every docs language. Each translation says what the
 * English page says - the same sections, steps, tables, lists, cards, code
 * and diagrams, links that land on the heading the English link means, a
 * title that is the nav link's - and names the product the way that
 * language's product draws it.
 *
 * "The way the product draws it" has more sources here than on the other
 * monitor pages:
 *
 *   - A bold Dashboard label is drawnActionLabel (DocsDashboardLabels), as on
 *     every translated monitor page: the label's value in that language's
 *     Dashboard locale, Persian included, or the Create/Add/Edit template
 *     filled with the item's name where a create button or a model's own
 *     edit button draws it that way.
 *   - Some buttons and menu items are drawn from their whole text alone: a
 *     Button, a MoreMenuItem and a Modal translate their text with one flat
 *     lookup (translateString), and an edit button given its own text
 *     (editButtonText) passes it to a Button as it is. Where that locale has
 *     no wording of its own - its value is missing or the English - the
 *     screen shows the English, never the Edit template. FLAT_LOOKUP lists
 *     them with the source line that draws each, and the translations name
 *     them as the flat lookup draws them.
 *   - Criteria filters and conditions (Log Count, Greater Than), several
 *     dropdown options (Past 1 Minute, Treat As Zero, Any Value) and two
 *     dialog titles built from template literals have no locale key at all:
 *     every language shows them in English (SHOWN_IN_ENGLISH).
 *   - Plan names and permission titles stay in English, as on the workflow
 *     and runbook pages (KEPT_IN_ENGLISH): the plans are product names, and
 *     the permissions are what the API, Terraform and the team pages call
 *     them.
 *   - One navigator button is a sentence with numbers in it ("Show N more of
 *     M"), and two empty tables say a whole sentence: TEMPLATES and MESSAGES
 *     name each as that language's locale words it.
 *   - The Traces page's trace-pipeline recipe is held, sentence by sentence,
 *     by TracesMonitorSpanStatusDocs; here its menu path and filter are
 *     checked to be drawn segment by segment.
 *
 * Bold words that are Dashboard labels only by coincidence are PROSE; bold
 * words that are neither labels nor shown in English are the pages' own
 * leads (PROSE_LEADS), which a translation words freely. A new bold name on
 * these pages fails below until it is put in one of the lists.
 */

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

const LOGS_MONITOR: string = "monitor/logs-monitor";
const METRICS_MONITOR: string = "monitor/metrics-monitor";
const TRACES_MONITOR: string = "monitor/traces-monitor";
const EXCEPTIONS_MONITOR: string = "monitor/exceptions-monitor";
const PROFILES_MONITOR: string = "monitor/profiles-monitor";
const RESOURCES_AND_GROUPS: string = "status-pages/resources-and-groups";
const BRANDING_AND_DOMAINS: string = "status-pages/branding-and-domains";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: LOGS_MONITOR, navTitle: "Logs Monitor" },
  { page: METRICS_MONITOR, navTitle: "Metrics Monitor" },
  { page: TRACES_MONITOR, navTitle: "Traces Monitor" },
  { page: EXCEPTIONS_MONITOR, navTitle: "Exceptions Monitor" },
  { page: PROFILES_MONITOR, navTitle: "Profiles Monitor" },
  {
    page: RESOURCES_AND_GROUPS,
    navTitle: "Status Page Resources & Groups",
  },
  {
    page: BRANDING_AND_DOMAINS,
    navTitle: "Status Page Branding & Domains",
  },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

const TELEMETRY_MONITOR_PAGES: Array<string> = [
  LOGS_MONITOR,
  METRICS_MONITOR,
  TRACES_MONITOR,
  EXCEPTIONS_MONITOR,
  PROFILES_MONITOR,
];

// The threshold conditions of a count, which no locale has a key for.
const COUNT_CONDITIONS: Array<string> = [
  "Greater Than",
  "Greater Than Or Equal To",
  "Less Than",
  "Less Than Or Equal To",
  "Equal To",
];

// The anomaly conditions of a log count, a span count and a metric value.
const ANOMALY_CONDITIONS: Array<string> = [
  "Anomalously High",
  "Anomalously Low",
  "Anomalous",
];

/*
 * Bold names every language's Dashboard shows in English, because its
 * locale has no key for them, by page. A translation keeps each one bold and
 * in English, so the reader finds it as the screen shows it.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [LOGS_MONITOR]: [
    // The criteria filter (CheckOn) and its conditions (FilterType).
    "Log Count",
    ...COUNT_CONDITIONS,
    ...ANOMALY_CONDITIONS,
    // "Equal To 0 and Less Than criteria": the condition, with its value.
    "Equal To 0",
  ],
  [METRICS_MONITOR]: [
    // The Time Range options without a locale key (the others have one).
    "Past 1 Minute",
    "Past 10 Minutes",
    "Past 6 Hours",
    "Past 12 Hours",
    "Past 3 Days",
    "Past 7 Days",
    "Past 14 Days",
    "Past 30 Days",
    "Past 60 Days",
    "Past 90 Days",
    "Past 180 Days",
    "Past 365 Days",
    // If No Data's options, but Trigger, which has a key.
    "Ignore",
    "Treat As Zero",
    "Metric Value",
    ...COUNT_CONDITIONS,
    ...ANOMALY_CONDITIONS,
    // The criteria's aggregations without a key (Average has one).
    "Any Value",
    "All Values",
  ],
  [TRACES_MONITOR]: [
    // OpenTelemetry's span status codes, as TracesMonitorSpanStatusDocs keeps them.
    "ERROR",
    "UNSET",
    "Span Count",
    ...COUNT_CONDITIONS,
    ...ANOMALY_CONDITIONS,
  ],
  [EXCEPTIONS_MONITOR]: [
    "Exception Count",
    ...COUNT_CONDITIONS,
    "Not Equal To",
  ],
  [PROFILES_MONITOR]: ["Profile Count", ...COUNT_CONDITIONS, "Not Equal To"],
  [RESOURCES_AND_GROUPS]: [
    // Titles built from a template literal, which no lookup can find.
    "Add a monitor to {group}",
    "Search in {group}...",
    // The bulk add summary's heading, drawn as written (no translator).
    "Already Added",
  ],
};

const PLANS: Array<string> = ["Growth", "Scale"];

/*
 * Bold names the translations keep in English on purpose, by page: a plan
 * or a permission ("the lists this test keeps" checks which).
 */
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  [BRANDING_AND_DOMAINS]: [
    "Growth",
    "Scale",
    "Edit Status Page Domain",
    "Read Status Page Domain",
  ],
};

interface FlatLookupLabel {
  label: string;
  // The source that draws it, from the packages folder.
  file: string;
  // How that source hands the text over, as written there.
  literal: RegExp;
}

/*
 * Labels drawn from their whole text by one flat lookup, by page: the
 * source line that draws each passes it to a Button, a MoreMenuItem or a
 * Modal, which translate their text with translateString alone.
 */
const FLAT_LOOKUP: Record<string, Array<FlatLookupLabel>> = {
  [LOGS_MONITOR]: [
    {
      label: "Edit Monitoring Criteria",
      file: "App/FeatureSet/Dashboard/src/Pages/Monitor/View/Criteria.tsx",
      literal: /editButtonText="Edit Monitoring Criteria"/,
    },
  ],
  [TRACES_MONITOR]: [
    {
      label: "Edit Monitoring Criteria",
      file: "App/FeatureSet/Dashboard/src/Pages/Monitor/View/Criteria.tsx",
      literal: /editButtonText="Edit Monitoring Criteria"/,
    },
  ],
  [EXCEPTIONS_MONITOR]: [
    {
      label: "Edit Monitoring Criteria",
      file: "App/FeatureSet/Dashboard/src/Pages/Monitor/View/Criteria.tsx",
      literal: /editButtonText="Edit Monitoring Criteria"/,
    },
  ],
  [RESOURCES_AND_GROUPS]: [
    {
      label: "Edit Group",
      file: "App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourcePanel.tsx",
      literal: /title="Edit Group"/,
    },
    {
      label: "Edit group",
      file: "Common/UI/Components/StatusPage/ResourceGroupNavigator.tsx",
      literal: /text="Edit group"/,
    },
    {
      label: "Delete group",
      file: "Common/UI/Components/StatusPage/ResourceGroupNavigator.tsx",
      literal: /text="Delete group"/,
    },
    {
      label: "Edit Status Page Group",
      file: "App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Resources.tsx",
      literal:
        /title=\{\s*groupFormMode === GroupFormMode\.Create\s*\?\s*"Create New Status Page Group"\s*:\s*"Edit Status Page Group"\s*\}/,
    },
    {
      label: "Add Row",
      file: "App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Resources.tsx",
      literal: /addButtonLabel="Add Row"/,
    },
  ],
  [BRANDING_AND_DOMAINS]: [
    {
      label: "Edit Images",
      file: "App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Branding.tsx",
      literal: /editButtonText=\{"Edit Images"\}/,
    },
    {
      label: "Edit Favicon",
      file: "App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Branding.tsx",
      literal: /editButtonText=\{"Edit Favicon"\}/,
    },
    {
      label: "Edit Default Bar Color",
      file: "App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Branding.tsx",
      literal: /editButtonText=\{"Edit Default Bar Color"\}/,
    },
  ],
};

/*
 * How each kind of component draws its text: one flat lookup of the whole
 * text, and an edit button with text of its own hands it to the card's
 * Button as it is.
 */
const FLAT_LOOKUP_COMPONENTS: ReadonlyArray<{ file: string; draws: string }> = [
  {
    file: "Common/UI/Components/Button/Button.tsx",
    draws: "translateString(title)",
  },
  {
    file: "Common/UI/Components/MoreMenu/MoreMenuItem.tsx",
    draws: "translateString(props.text)",
  },
  {
    file: "Common/UI/Components/Modal/Modal.tsx",
    draws: "translateString(props.title)",
  },
  {
    file: "Common/UI/Components/ModelDetail/CardModelDetail.tsx",
    draws: "title: props.editButtonText || editTitle",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Components/StatusPage/AxisValuesInput.tsx",
    draws: 'title={props.addButtonLabel || "Add value"}',
  },
];

interface TemplateLabel {
  english: string;
  // The locale key the screen draws it from.
  key: string;
  // How the English page writes each placeholder of the key.
  values: Record<string, string>;
}

// Bold names drawn from a translated template, with the page's placeholders in it.
const TEMPLATES: Record<string, Array<TemplateLabel>> = {
  [RESOURCES_AND_GROUPS]: [
    {
      english: "Show N more of M",
      key: "Show {{shown}} more of {{total}}",
      values: { shown: "N", total: "M" },
    },
  ],
};

interface MessageLabel {
  english: string;
  // The table's message, a whole sentence in the locale.
  key: string;
}

// Empty tables' messages, which the page quotes without their full stop.
const MESSAGES: Record<string, Array<MessageLabel>> = {
  [BRANDING_AND_DOMAINS]: [
    {
      english: "No status header link for this status page",
      key: "No status header link for this status page.",
    },
    {
      english: "No custom domains found",
      key: "No custom domains found.",
    },
  ],
};

/*
 * Sentences the Branding page quotes in plain text, which the Dashboard
 * translates: what DNS Setup says once the record is found, what the folded
 * More fields of a new domain says about its certificate, and the empty
 * Footer Links table. A translation quotes each as its language's Dashboard
 * words it.
 */
const QUOTED_SENTENCES: Record<string, Array<string>> = {
  [BRANDING_AND_DOMAINS]: [
    CustomDomainCopy.dnsSetupVerified,
    CustomDomainCopy.advancedSummaryFreeCertificate,
    "No status footer link for this status page.",
  ],
};

// The Branding page's table of what the domain Status column says.
const STATUS_COLUMN_SECTION: string = "Reading the domain Status column";

/*
 * The Traces page's trace-pipeline recipe: a menu path written with ">" and
 * a filter written "Field = Value", each drawn part by part.
 */
const RECIPE_PATH: Array<string> = ["Traces", "Settings", "Pipelines"];
const RECIPE_FILTER: Array<string> = ["Status", "Unset"];

/*
 * Bold words that are Dashboard labels by coincidence but are prose where the
 * English page uses them, which a translation words as its language needs.
 */
const PROSE: Record<string, Array<string>> = {};

/*
 * The bold leads of the pages' own lists and sentences, and names of screens
 * that are gone. They are neither Dashboard labels nor shown in English, so a
 * translation words them freely; listing them makes a new bold name on these
 * pages fail below until it is put in a list.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [LOGS_MONITOR]: [
    "Every minute.",
    "One number per evaluation.",
    "No logs is a count of 0.",
    "OneUptime's own downtime is not silence.",
    "Criteria from top to bottom.",
    "one alert for the whole monitor",
    "second, separate alert",
    "empty value",
    "100 groups",
    "Every criteria is evaluated",
    "A group only exists when it logged something in the time window.",
    "Anomaly detection",
  ],
  [METRICS_MONITOR]: [
    "Every minute.",
    "Queries, then formulas.",
    "Then the criteria's aggregation.",
    "Criteria from top to bottom.",
    "No data is not zero.",
    "OneUptime's own downtime is not silence.",
    "one alert (or incident) per breaching host",
    "one alert for the whole monitor",
    "Setting Group By is how you get per-host alerts.",
    "Grouped monitors evaluate every criteria.",
    "order the criteria most severe first",
    "Ungrouped monitors stop at the first matching criteria.",
  ],
  [TRACES_MONITOR]: [
    "Every minute.",
    "One number per evaluation.",
    "No spans is a count of 0.",
    "OneUptime's own downtime is not silence.",
    "Criteria from top to bottom.",
  ],
  [EXCEPTIONS_MONITOR]: [
    "Every minute.",
    "Occurrences, not exception types.",
    "Resolved and archived exceptions are left out.",
    "No exceptions is a count of 0.",
    "OneUptime's own downtime is not silence.",
    "Criteria from top to bottom.",
  ],
  [PROFILES_MONITOR]: [
    "Every minute.",
    "One number per evaluation.",
    "No profiles is a count of 0.",
    "OneUptime's own downtime is not silence.",
    "Criteria from top to bottom.",
  ],
  [RESOURCES_AND_GROUPS]: [
    // A resource's name as a customer would say it.
    "Checkout API",
    "Archived monitors are not shown.",
    "Resources decide which incidents the page shows.",
    "A monitor group row stands for every monitor in it, for subscribers too.",
    // The parts of the Resources screen, named for what they are.
    "Group navigator",
    "Resource pane",
    "Empty states tell you what to do.",
    "Precision is a judgment call.",
    "Two cases where dragging is off.",
  ],
  [BRANDING_AND_DOMAINS]: [
    // The screens the Branding page replaced, which no longer exist.
    "Essential Branding",
    "Header",
    "Footer",
    "Overview Page",
    // A card that is now a row of another card.
    "Overall Uptime Percent",
    "History chart colors.",
    "Languages.",
    "Search Engine Indexing.",
    "There is no theme picker.",
    "Add the domain",
    "Add its CNAME record",
    "The free SSL certificate is issued automatically",
    "The parent domain must be verified.",
    "Your installation needs a status page CNAME record.",
    "The record is not found yet.",
    "The record is found.",
  ],
};

/*
 * Links from other pages to a heading of these pages. Each language's copy
 * of the page that links must name the heading of the same place in that
 * language's copy of the page it links to: the anchors are made from the
 * translated heading text.
 */
interface LinkIntoPage {
  from: string;
  to: string;
  anchor: string;
}

const LINKS_INTO_THESE_PAGES: ReadonlyArray<LinkIntoPage> = [
  {
    // Group By on a Logs monitor is the counterpart of a metric's.
    from: LOGS_MONITOR,
    to: METRICS_MONITOR,
    anchor: "per-series-alerting-group-by",
  },
  {
    from: "telemetry/log-pipelines",
    to: LOGS_MONITOR,
    anchor: "per-group-alerting-group-by",
  },
  {
    from: "monitor/network-vendor-guides",
    to: LOGS_MONITOR,
    anchor: "per-group-alerting-group-by",
  },
  {
    from: "telemetry/log-recording-rules",
    to: METRICS_MONITOR,
    anchor: "per-series-alerting-group-by",
  },
  {
    from: "telemetry/queues",
    to: METRICS_MONITOR,
    anchor: "per-series-alerting-group-by",
  },
];

const PATH_SEPARATOR: string = " → ";

// A bold span that is a Dashboard path, some of whose parts are placeholders.
const PLACEHOLDER_SEGMENT: string = "[^*→\\n]+?";

// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;

// Code in rendered HTML: a code block or an inline code span.
const RENDERED_CODE: RegExp = /<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/g;

// A rendered HTML tag, whose attributes may hold underscores of their own.
const HTML_TAG: RegExp = /<[^>]*>/g;

// A Mermaid diagram's fenced source.
const MERMAID_BLOCK: RegExp =
  /^ {0,3}```mermaid[^\n]*\n[\s\S]*?^ {0,3}```[^\n]*$/gm;

// The full stop that ends a sentence, in each script the locales write.
const FULL_STOP: RegExp = /[.。．।]$/;

const REGEX_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function englishPage(page: string): string {
  return readPage("en", page);
}

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

// The bold spans of a page that are one label, not a path.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown)).filter((span: string): boolean => {
    return !span.includes(PATH_SEPARATOR);
  });
}

// The bold spans of a page that are a path, as their parts.
function boldPaths(markdown: string): Array<Array<string>> {
  return boldSpans(prose(markdown))
    .filter((span: string): boolean => {
      return span.includes(PATH_SEPARATOR);
    })
    .map((span: string): Array<string> => {
      return span.split(PATH_SEPARATOR).map((segment: string): string => {
        return segment.trim();
      });
    });
}

// The paths whose every part is a Dashboard label.
function menuPaths(markdown: string): Array<Array<string>> {
  return boldPaths(markdown).filter((segments: Array<string>): boolean => {
    return segments.every((segment: string): boolean => {
      return isActionLabel(segment);
    });
  });
}

// The paths with a part that is not a label: "your page", "your dashboard".
function placeholderPaths(markdown: string): Array<Array<string>> {
  return boldPaths(markdown).filter((segments: Array<string>): boolean => {
    return !segments.every((segment: string): boolean => {
      return isActionLabel(segment);
    });
  });
}

// The labels of a page drawn by a flat lookup.
function flatLabels(page: string): Array<string> {
  return (FLAT_LOOKUP[page] || []).map((entry: FlatLookupLabel): string => {
    return entry.label;
  });
}

/*
 * What one flat lookup of the whole text draws: the locale's wording, or
 * the English where it has none.
 */
function flatLabel(language: string, english: string): string {
  const value: unknown = dashboardLocale(language)[english];

  return typeof value === "string" && value.trim() ? value : english;
}

function fillPlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  let filled: string = template;

  for (const [name, value] of Object.entries(values)) {
    filled = filled.split(`{{${name}}}`).join(value);
  }

  return filled;
}

// A template label as this language's locale draws it, with the page's placeholders.
function drawnTemplate(language: string, entry: TemplateLabel): string {
  return fillPlaceholders(flatLabel(language, entry.key), entry.values);
}

// A table message as this language's locale words it, without its full stop.
function drawnMessage(language: string, entry: MessageLabel): string {
  return flatLabel(language, entry.key).trim().replace(FULL_STOP, "");
}

function isPermissionOrRole(name: string): boolean {
  return PermissionHelper.getAllPermissionProps().some(
    (props: { title: string }): boolean => {
      return props.title === name;
    },
  );
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
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
 * A page as the docs route draws it, without its title line, and the
 * emphasis markers left in its text: a bold or italic span CommonMark did
 * not close. A bold span that ends in punctuation and runs straight into a
 * letter, as in "**超时。**脚本", is not closed, and its asterisks show. An
 * underscore never closes inside a word, so "_之后_的" shows both
 * underscores. A diagram is drawn from its source, which Markdown never
 * reads (`con_name` is a node's words, not emphasis), so diagrams are left
 * out.
 */
async function strayMarkers(
  markdown: string,
  language: string,
): Promise<Array<string>> {
  const withoutDiagrams: string = markdown.replace(MERMAID_BLOCK, "");
  const html: string = await DocsRender.render(
    DocsPlaceholders.render(
      withoutDiagrams.split("\n").slice(1).join("\n"),
      language,
    ),
  );

  return html
    .replace(RENDERED_CODE, "")
    .split("\n")
    .map((line: string): string => {
      return line.replace(HTML_TAG, "");
    })
    .filter((line: string): boolean => {
      return line.includes("**") || line.includes("_");
    });
}

/*
 * The steps of every :::steps block on a page: the headings inside them, at
 * whatever level the section puts them.
 */
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

    if (inSteps && line.startsWith("#")) {
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

  const translated: Array<DocsHeading> = sections(readPage(language, page));

  return translated[index]?.slug || null;
}

/*
 * What the Branding page's Status column table lists, in a language: the
 * first cell of each row of the first table under the heading that sits
 * where the English page's "Reading the domain Status column" sits.
 */
function statusColumnStates(language: string): Array<string> {
  const index: number = sections(englishPage(BRANDING_AND_DOMAINS)).findIndex(
    (heading: DocsHeading): boolean => {
      return heading.text === STATUS_COLUMN_SECTION;
    },
  );
  const markdown: string = readPage(language, BRANDING_AND_DOMAINS);
  const heading: DocsHeading | undefined = sections(markdown)[index];

  if (index < 0 || !heading) {
    return [];
  }

  const below: Array<string> = markdown.split("\n").slice(heading.line);
  const start: number = below.findIndex((line: string): boolean => {
    return line.startsWith("|");
  });
  const states: Array<string> = [];

  // Past the header row and the delimiter row, to the end of the table.
  for (const line of below.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    states.push((line.split("|")[1] || "").trim());
  }

  return states;
}

/*
 * The links of a page that name a heading of this page or of another page
 * in this group, in order, as "page#anchor". The anchors of another group's
 * page are that page's business: anchorProblems checks they land.
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

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      SHOWN_IN_ENGLISH,
      KEPT_IN_ENGLISH,
      FLAT_LOOKUP,
      TEMPLATES,
      MESSAGES,
      PROSE,
      PROSE_LEADS,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("call prose only bold Dashboard labels the English page has", () => {
    for (const page of Object.keys(PROSE)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const label of PROSE[page] as Array<string>) {
        expect({ page: page, label: label, ok: true }).toEqual({
          page: page,
          label: label,
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

      for (const name of SHOWN_IN_ENGLISH[page] as Array<string>) {
        expect({ page: page, name: name, bold: true, label: false }).toEqual({
          page: page,
          name: name,
          bold: labels.includes(name),
          label: isActionLabel(name),
        });
      }
    }
  });

  it("keep in English on purpose only plans and permissions the English page bolds", () => {
    for (const page of Object.keys(KEPT_IN_ENGLISH)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const name of KEPT_IN_ENGLISH[page] as Array<string>) {
        expect({ page, name, bold: true, why: true }).toEqual({
          page,
          name,
          bold: labels.includes(name),
          why: PLANS.includes(name) || isPermissionOrRole(name),
        });
      }
    }

    // The two the branding page names are what the server checks.
    expect(PermissionHelper.getTitle(Permission.EditStatusPageDomain)).toBe(
      "Edit Status Page Domain",
    );
    expect(PermissionHelper.getTitle(Permission.ReadStatusPageDomain)).toBe(
      "Read Status Page Domain",
    );
  });

  it("draw by a flat lookup only labels a source passes as they are, to a component that looks them up whole", () => {
    for (const page of Object.keys(FLAT_LOOKUP)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const entry of FLAT_LOOKUP[page] as Array<FlatLookupLabel>) {
        expect({
          page,
          label: entry.label,
          bold: true,
          isLabel: true,
          drawnThere: true,
        }).toEqual({
          page,
          label: entry.label,
          bold: labels.includes(entry.label),
          isLabel: isActionLabel(entry.label),
          drawnThere: entry.literal.test(readSource(entry.file)),
        });
      }
    }

    for (const component of FLAT_LOOKUP_COMPONENTS) {
      expect({ ...component, found: true }).toEqual({
        ...component,
        found: readSource(component.file).includes(component.draws),
      });
    }
  });

  /*
   * The list is only needed where the flat lookup and the template disagree
   * in some language; a label that agrees everywhere does not belong here.
   */
  it("list as flat lookups only labels the template would draw otherwise somewhere", () => {
    for (const page of Object.keys(FLAT_LOOKUP)) {
      for (const label of flatLabels(page)) {
        const differs: boolean = LANGUAGES.some((language: string): boolean => {
          return (
            flatLabel(language, label) !== drawnActionLabel(language, label)
          );
        });

        expect({ page, label, differs }).toEqual({
          page,
          label,
          differs: true,
        });
      }
    }
  });

  it("name templates and messages the locale has, as the English page bolds them", () => {
    for (const page of Object.keys(TEMPLATES)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const entry of TEMPLATES[page] as Array<TemplateLabel>) {
        expect({ page, entry, bold: true, key: entry.key }).toEqual({
          page,
          entry,
          bold: labels.includes(entry.english),
          key: dashboardLocale("en")[entry.key],
        });
        expect(fillPlaceholders(entry.key, entry.values)).toBe(entry.english);
      }
    }

    for (const page of Object.keys(MESSAGES)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const entry of MESSAGES[page] as Array<MessageLabel>) {
        expect({ page, entry, bold: true, key: entry.key }).toEqual({
          page,
          entry,
          bold: labels.includes(entry.english),
          key: dashboardLocale("en")[entry.key],
        });
        expect(drawnMessage("en", entry)).toBe(entry.english);
      }
    }
  });

  it("know every bold word on the English pages: a label, shown or kept in English, a template, a message or a lead", () => {
    for (const page of PAGE_NAMES) {
      const known: Array<string> = [
        ...(SHOWN_IN_ENGLISH[page] || []),
        ...(KEPT_IN_ENGLISH[page] || []),
        ...(PROSE_LEADS[page] || []),
        ...(TEMPLATES[page] || []).map((entry: TemplateLabel): string => {
          return entry.english;
        }),
        ...(MESSAGES[page] || []).map((entry: MessageLabel): string => {
          return entry.english;
        }),
      ];
      const recipe: Array<string> =
        page === TRACES_MONITOR
          ? [RECIPE_PATH.join(" > "), RECIPE_FILTER.join(" = ")]
          : [];
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isActionLabel(span) &&
            !known.includes(span) &&
            !recipe.includes(span)
          );
        },
      );

      expect({ page: page, unlisted: unlisted }).toEqual({
        page: page,
        unlisted: [],
      });
    }
  });

  it("list as leads only bold words the English page has", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const spans: Array<string> = boldLabels(englishPage(page));

      for (const lead of PROSE_LEADS[page] as Array<string>) {
        expect({ page: page, lead: lead, found: true, label: false }).toEqual({
          page: page,
          lead: lead,
          found: spans.includes(lead),
          label: isActionLabel(lead),
        });
      }
    }
  });

  it("find plenty to check", () => {
    let labels: number = 0;

    for (const page of PAGE_NAMES) {
      const onPage: number = boldLabels(englishPage(page)).filter(
        (label: string): boolean => {
          return isActionLabel(label);
        },
      ).length;

      // The Profiles page is made in the API, so it names few screens.
      expect({ page: page, enough: onPage >= 5 }).toEqual({
        page: page,
        enough: true,
      });

      labels += onPage;
    }

    expect(labels).toBeGreaterThanOrEqual(250);
  });

  it("name links that the English pages really have, to headings the English pages really have", () => {
    for (const link of LINKS_INTO_THESE_PAGES) {
      expect({ link: link, linked: true, heading: true }).toEqual({
        link: link,
        linked: englishPage(link.from).includes(
          `](/docs/${link.to}#${link.anchor})`,
        ),
        heading: anchorInLanguage("en", link.to, link.anchor) === link.anchor,
      });
    }
  });

  it("quote sentences the English Branding page really quotes, and the Status column's every state", () => {
    for (const page of Object.keys(QUOTED_SENTENCES)) {
      for (const sentence of QUOTED_SENTENCES[page] as Array<string>) {
        expect({ page, sentence, quoted: true, key: sentence }).toEqual({
          page,
          sentence,
          quoted: englishPage(page).includes(sentence),
          key: dashboardLocale("en")[sentence],
        });
      }
    }

    expect([...statusColumnStates("en")].sort()).toEqual(
      Object.values(CUSTOM_DOMAIN_STATUS).sort(),
    );
  });

  it("has the trace-pipeline recipe the Traces page bolds", () => {
    const labels: Array<string> = boldLabels(englishPage(TRACES_MONITOR));

    expect(labels).toContain(RECIPE_PATH.join(" > "));
    expect(labels).toContain(RECIPE_FILTER.join(" = "));

    for (const part of [...RECIPE_PATH, ...RECIPE_FILTER]) {
      expect({ part, label: isActionLabel(part) }).toEqual({
        part,
        label: true,
      });
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
      const scanned: ScannedPage = scanMarkdown(englishPage(entry.page));
      const last: DocsHeading = scanned.headings[
        scanned.headings.length - 1
      ] as DocsHeading;

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(cardLines(englishPage(entry.page)).length).toBeGreaterThan(0);
    },
  );

  /*
   * The Branding page answers its domain questions where they come up, as
   * folded entries under the Status column, rather than in a section of
   * their own.
   */
  it.each(
    PAGES.filter((entry: TranslatedPage): boolean => {
      return entry.page !== BRANDING_AND_DOMAINS;
    }),
  )(
    "$page has a Troubleshooting section before Next steps",
    (entry: TranslatedPage) => {
      const headings: Array<string> = scanMarkdown(
        englishPage(entry.page),
      ).headings.map((heading: DocsHeading): string => {
        return `${"#".repeat(heading.level)} ${heading.text}`;
      });

      expect(headings).toContain("## Troubleshooting");
      expect(headings.indexOf("## Troubleshooting")).toBeLessThan(
        headings.indexOf("## Next steps"),
      );
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(PAGES)(
    "$page walks a procedure in steps",
    (entry: TranslatedPage) => {
      expect(stepCount(englishPage(entry.page))).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(TELEMETRY_MONITOR_PAGES)(
    "%s says a check waits through OneUptime's own downtime, and links the page that explains it",
    (page: string) => {
      const markdown: string = englishPage(page);

      expect(markdown).toContain(
        "**OneUptime's own downtime is not silence.**",
      );
      expect(markdown).toContain(
        "(/docs/monitor/when-oneuptime-is-not-receiving)",
      );
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
      expect(title).not.toBe(entry.navTitle);
      expect(translated.split("\n")[0]).toBe(`# ${title}`);
    });

    it("keeps every code block, and builds every diagram the same way", () => {
      const translated: ScannedPage = scanMarkdown(
        readPage(language, entry.page),
      );

      expect(translated.fences.map(comparableFence)).toEqual(
        scanMarkdown(english).fences.map(comparableFence),
      );
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
        expect({ line: line, ascii: CARD_LINE.test(line) }).toEqual({
          line: line,
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
      const exceptions: Array<string> = [
        ...(PROSE[entry.page] || []),
        ...(KEPT_IN_ENGLISH[entry.page] || []),
        ...flatLabels(entry.page),
      ];
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

    it("names the labels a component looks up whole as that lookup draws them", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = flatLabels(entry.page)
        .map((label: string): string => {
          return flatLabel(language, label);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(`**${drawn}**`);
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .map((segments: Array<string>): string => {
          return segments
            .map((segment: string): string => {
              return drawnActionLabel(language, segment);
            })
            .join(PATH_SEPARATOR);
        })
        .filter((localized: string): boolean => {
          return !translated.includes(`**${localized}**`);
        });

      expect(missing).toEqual([]);
    });

    it("draws the labels of a path with a placeholder in it, and words the placeholder in its own language", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = placeholderPaths(english)
        .map((segments: Array<string>): RegExp => {
          return new RegExp(
            `\\*\\*${segments
              .map((segment: string): string => {
                return isActionLabel(segment)
                  ? escapeRegex(drawnActionLabel(language, segment))
                  : PLACEHOLDER_SEGMENT;
              })
              .join(escapeRegex(PATH_SEPARATOR))}\\*\\*`,
          );
        })
        .filter((pattern: RegExp): boolean => {
          return !pattern.test(translated);
        })
        .map((pattern: RegExp): string => {
          return pattern.source;
        });

      expect(missing).toEqual([]);
    });

    it("names in English what every Dashboard shows in English, and the plans and permissions", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...(SHOWN_IN_ENGLISH[entry.page] || []),
        ...(KEPT_IN_ENGLISH[entry.page] || []),
      ].filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });

    it("words the templates and the table messages as this language's locale does", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...(TEMPLATES[entry.page] || []).map(
          (template: TemplateLabel): string => {
            return drawnTemplate(language, template);
          },
        ),
        ...(MESSAGES[entry.page] || []).map((message: MessageLabel): string => {
          return drawnMessage(language, message);
        }),
      ].filter((drawn: string): boolean => {
        return !translated.includes(`**${drawn}**`);
      });

      expect(missing).toEqual([]);
    });
  });

  describe("the custom domain Status column and the sentences the Branding page quotes", () => {
    it("names every state of the Status column as this language's Dashboard draws it, in the English order", () => {
      expect(statusColumnStates(language)).toEqual(
        statusColumnStates("en").map((state: string): string => {
          return flatLabel(language, state);
        }),
      );
    });

    it("quotes each sentence as this language's Dashboard words it", () => {
      for (const page of Object.keys(QUOTED_SENTENCES)) {
        const translated: string = readPage(language, page);
        const missing: Array<string> = (QUOTED_SENTENCES[page] as Array<string>)
          .map((sentence: string): string => {
            return flatLabel(language, sentence);
          })
          .filter((drawn: string): boolean => {
            return !translated.includes(drawn);
          });

        expect({ page, missing }).toEqual({ page, missing: [] });
      }
    });
  });

  describe("the trace-pipeline recipe", () => {
    it("names its menu path and its filter as this language's Dashboard draws them", () => {
      const translated: string = readPage(language, TRACES_MONITOR);
      const recipePath: string = RECIPE_PATH.map((part: string): string => {
        return drawnActionLabel(language, part);
      }).join(" > ");
      const recipeFilter: string = RECIPE_FILTER.map((part: string): string => {
        return drawnActionLabel(language, part);
      }).join(" = ");

      expect(translated).toContain(`**${recipePath}**`);
      expect(translated).toContain(`**${recipeFilter}**`);
    });
  });

  describe("links into these pages from other pages", () => {
    it.each(LINKS_INTO_THESE_PAGES)(
      "$from links to the heading of $to it means ($anchor)",
      (link: LinkIntoPage) => {
        if (!hasPage(language, link.from)) {
          // Served in English, whose link names the English heading.
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
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add flat lookups, templates, messages and paths with a placeholder in
 * them.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label, and a path with a placeholder from one without", () => {
    const markdown: string =
      "**Resources → Monitor Rules**, **Status Pages → your page → Branding → Branding** and **Show Uptime %**";

    expect(menuPaths(markdown)).toEqual([["Resources", "Monitor Rules"]]);
    expect(placeholderPaths(markdown)).toEqual([
      ["Status Pages", "your page", "Branding", "Branding"],
    ]);
    expect(boldLabels(markdown)).toEqual(["Show Uptime %"]);
  });

  it("read a flat lookup as the locale's wording, or the English where it has none", () => {
    // Translated in German, left in English in Danish.
    expect(flatLabel("de", "Edit Monitoring Criteria")).toBe(
      "Überwachungskriterien bearbeiten",
    );
    expect(flatLabel("da", "Edit Monitoring Criteria")).toBe(
      "Edit Monitoring Criteria",
    );
    // Where the template would have drawn something else.
    expect(drawnActionLabel("da", "Edit Monitoring Criteria")).not.toBe(
      "Edit Monitoring Criteria",
    );
    // No locale has the whole of Add Row.
    expect(flatLabel("fr", "Add Row")).toBe("Add Row");
  });

  it("fill a template with the page's placeholders and drop a message's full stop", () => {
    expect(
      fillPlaceholders("Show {{shown}} more of {{total}}", {
        shown: "N",
        total: "M",
      }),
    ).toBe("Show N more of M");
    expect(
      drawnMessage("en", {
        english: "No custom domains found",
        key: "No custom domains found.",
      }),
    ).toBe("No custom domains found");
    expect("見つかりません。".replace(FULL_STOP, "")).toBe("見つかりません");
  });

  it("count the steps of every :::steps block, at any heading level, and only those", () => {
    const markdown: string = [
      "# Page",
      "## Create it",
      ":::steps",
      "### One",
      "```javascript",
      "### not a step",
      "```",
      "### Two",
      ":::",
      "### Adding a domain",
      ":::steps",
      "#### Three",
      ":::",
      "### After the steps",
      ":::steps",
      "1. A numbered step is not a heading",
      ":::",
    ].join("\n");

    expect(stepCount(markdown)).toBe(3);
  });

  it("find the links that name a heading of this group, in order", () => {
    const markdown: string = [
      "# Logs Monitor",
      "See [Criteria](#criteria) and [Group By](/docs/monitor/metrics-monitor#per-series-alerting-group-by).",
      "A [parser](/docs/telemetry/log-pipelines#keyvalue-parser) and [a page](/docs/monitor/traces-monitor).",
    ].join("\n");

    expect(groupAnchorLinks(LOGS_MONITOR, markdown)).toEqual([
      "monitor/logs-monitor#criteria",
      "monitor/metrics-monitor#per-series-alerting-group-by",
    ]);
  });

  it("leave a diagram's words alone: an underscore in a node is not emphasis", async () => {
    const diagram: string = [
      "# Title",
      "",
      '```mermaid title="Without and with Group By"',
      "flowchart TB",
      '    subgraph With["Group by con_name"]',
      "    end",
      "```",
    ].join("\n");

    expect(await strayMarkers(diagram, "de")).toEqual([]);
    // The same words in the text would show their underscore.
    expect(
      await strayMarkers("# Title\n\nGroup by con_name.", "de"),
    ).toHaveLength(1);
  });

  it("read the Status column of the English page as the Dashboard's states", () => {
    expect(statusColumnStates("en")).toContain(
      "Waiting for DNS: add the CNAME record.",
    );
    expect(statusColumnStates("en")).toHaveLength(
      Object.keys(CUSTOM_DOMAIN_STATUS).length,
    );
  });

  it("find asterisks the renderer leaves when a bold span ends in punctuation and runs into a letter", async () => {
    expect(
      await strayMarkers("# Title\n\n- **每分钟。**一次。", "zh-CN"),
    ).toHaveLength(1);
    expect(
      await strayMarkers("# Title\n\n- **每分钟。** 一次。", "zh-CN"),
    ).toEqual([]);
  });
});
