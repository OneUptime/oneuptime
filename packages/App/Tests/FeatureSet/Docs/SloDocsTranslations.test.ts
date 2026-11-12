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
  drawnArchiveCardTitle,
  drawnBudgetFigure,
  drawnCreateButton,
  drawnDashboardLabel,
  drawnTextWithFigures,
  isDashboardLabel,
} from "./DocsDashboardLabels";
import {
  CARD_LINE,
  anchorProblems,
  boldSpans,
  cardLines,
  cardTargets,
  comparableFence,
  escapeRegExp,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { isPermissionTitleKeptInEnglish } from "./DocsRoleNames";
import {
  SLO_RECOMMENDED_POLICY_TIERS,
  SloRecommendedPolicyTier,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 18a: the SLO pages - SLOs Overview, Monitors and
 * Monitor Rules, Error Budgets, Burn Rate Alerts and Incidents, Error Budget
 * Policy, SLO Metrics and Dashboards, SLO Feed and Audit Logs, and Label and
 * Owner Rules - in every docs language. Each translation says what the English page says:
 * the same sections, steps, tables, lists, cards, code and diagrams, links
 * that land on the heading the English link means, a title that is the nav
 * link's, and every screen named the way that language's Dashboard draws it.
 *
 * "The way the Dashboard draws it" is the rule a reader can check against the
 * screen, Persian included, as on every page since the on-call pages: a bold
 * label on the English page that is a Dashboard label is, on the translated
 * page, its value in that language's Dashboard locale, or English where the
 * locale has no wording of its own (drawnDashboardLabel). A table's create
 * button is drawn from the name the table gives its rows (drawnCreateButton),
 * and the Settings page's Archive card's title as the card draws it
 * (ARCHIVE_CARD_TITLES, drawnArchiveCardTitle, #7195).
 *
 * Some bold names stay in English on purpose, by list:
 *
 *   - KEPT_IN_ENGLISH: permissions and plans, as the role pickers and the
 *     billing pages name them; the names OneUptime itself gives a new SLO's
 *     rules (Fast burn, Slow burn, Slow leak), the tiers of the recommended
 *     error budget policy (Caution, Reliability first, Budget exhausted) and
 *     the rule the upgrade creates; and the
 *     widget titles the SLO Dashboard template writes into a new dashboard.
 *     All of them are data or names the API and Terraform use too, so they
 *     read the same whatever the reader's language.
 *   - SHOWN_IN_ENGLISH: what the SLO pages quote in English in every
 *     language, because the Dashboard has no label of that exact text: the
 *     banners' titles, the SLO Dashboard template's charts, and so on. The
 *     runway and budget words of the Overview's tiles, the first day's
 *     window chip and the Metrics page's SLO Metrics and Error Budget
 *     History tabs are worded in every language since #6658, so each page
 *     names them as its language's Dashboard draws them.
 *   - DRAWN_WITH_FIGURES: the Overview's texts with figures in them - the
 *     window chip "Window 23% full", the error budget tile's lines and a
 *     runway - which the Dashboard has drawn in every language since #6658:
 *     each page quotes them as its language's Dashboard draws them, words,
 *     units and digits (drawnTextWithFigures, #6696). The Settings page's
 *     Error Budget line too, since #6925.
 *   - BUDGET_FIGURES: the Error Budgets page's table of targets and budgets
 *     and the 31-day month's budget under it, which each page writes as its
 *     language's Dashboard writes a percentage and a duration
 *     (drawnBudgetFigure, #6925): "99,9 %" and "43 Min., 12 Sek." in German.
 *
 * Bold words that are Dashboard labels only by coincidence are PROSE; the
 * pages' own bold leads are PROSE_LEADS. A new bold word on these English
 * pages fails "know every bold word" until it is put in one of the lists.
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

const INTRODUCTION: string = "slo/introduction";
const MONITOR_RULES: string = "slo/monitor-rules";
const ERROR_BUDGET: string = "slo/error-budget";
const BURN_RATE: string = "slo/burn-rate-alerts";
const ERROR_BUDGET_POLICY: string = "slo/error-budget-policy";
const METRICS: string = "slo/metrics";
const FEED: string = "slo/feed-and-audit-logs";
const LABEL_RULES: string = "slo/label-and-owner-rules";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: INTRODUCTION, navTitle: "SLOs Overview" },
  { page: MONITOR_RULES, navTitle: "Monitors and Monitor Rules" },
  { page: ERROR_BUDGET, navTitle: "Error Budgets" },
  { page: BURN_RATE, navTitle: "Burn Rate Alerts and Incidents" },
  { page: ERROR_BUDGET_POLICY, navTitle: "Error Budget Policy" },
  { page: METRICS, navTitle: "SLO Metrics and Dashboards" },
  { page: FEED, navTitle: "SLO Feed and Audit Logs" },
  { page: LABEL_RULES, navTitle: "Label and Owner Rules" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

/*
 * Names that read the same in every language, by page: permissions and
 * plans, names OneUptime gives records itself, and the titles the SLO
 * Dashboard template writes into a dashboard.
 */
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  // The default burn rate rules every new SLO is given, by these names.
  [INTRODUCTION]: ["Fast burn", "Slow burn", "Slow leak"],
  [BURN_RATE]: ["Fast burn", "Slow burn", "Slow leak"],
  /*
   * The tiers Use the recommended policy creates, by these names, and the
   * tiers' permissions, as a role's permission list names them.
   */
  [ERROR_BUDGET_POLICY]: [
    ...SLO_RECOMMENDED_POLICY_TIERS.map(
      (tier: SloRecommendedPolicyTier): string => {
        return tier.name;
      },
    ),
    "Read SLO Error Budget Policy Tier",
    "Create SLO Error Budget Policy Tier",
    "Edit SLO Error Budget Policy Tier",
    "Delete SLO Error Budget Policy Tier",
  ],
  // The rule the upgrade creates from the old setting (SloDocs pins it).
  [MONITOR_RULES]: ["Auto-add monitors with labels"],
  /*
   * The widget titles the SLO Dashboard template creates. Error Budget
   * History is one of them, and also the SLO's Metrics tab: the tab is
   * worded in each language, the chart's title in a new dashboard is not.
   */
  [METRICS]: [
    "Service Level Objectives",
    "SLI",
    "Error Budget Remaining",
    "Burn Rate",
    "Error Budget History",
  ],
  // The plan audit logs need.
  [FEED]: ["Enterprise"],
  // Permissions, as a role's permission list names them.
  [LABEL_RULES]: [
    "Create SLO Label Rule",
    "Edit SLO Label Rule",
    "Delete SLO Label Rule",
    "Read SLO Label Rule",
    "Create SLO Owner Rule",
    "Edit SLO Owner Rule",
    "Delete SLO Owner Rule",
    "Read SLO Owner Rule",
    "Edit Service Level Objective",
    "Create SLO User Owner",
    "Create SLO Team Owner",
  ],
};

/*
 * The permission names above that the page also names as a button: the
 * create buttons of the two rule tables, drawn in the reader's language
 * where they are buttons.
 */
const PERMISSIONS_THAT_ARE_BUTTONS: Array<string> = [
  "Create SLO Label Rule",
  "Create SLO Owner Rule",
  "Create SLO Error Budget Policy Tier",
];

/*
 * The Settings page's Archive card, which titles itself "Archive
 * {{itemName}}" with the name the page hands it (#7195): no locale has the
 * title as a key, and each page names it as its language's card draws it
 * (drawnArchiveCardTitle).
 */
interface ArchiveCardTitle {
  label: string;
  singularName: string;
}

const ARCHIVE_CARD_TITLES: Record<string, Array<ArchiveCardTitle>> = {
  [INTRODUCTION]: [{ label: "Archive SLO", singularName: "SLO" }],
};

function archiveCardTitles(page: string): Array<string> {
  return (ARCHIVE_CARD_TITLES[page] || []).map(
    (entry: ArchiveCardTitle): string => {
      return entry.label;
    },
  );
}

// Names the SLO pages draw in English in every language: the Dashboard has no wording for them.
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [INTRODUCTION]: [
    "Waiting for SLO evaluation",
    "Measurement is paused",
    "The target is out of range",
    "This SLO is disabled",
    "This SLO is archived",
  ],
  [MONITOR_RULES]: ["Auto-Add Monitors With Labels"],
  [METRICS]: [
    "Monitor Metric Retention (Days)",
    "Follow SLO Variable",
    "SLO Dashboard",
    "Error Budget & Burn Rate",
    "Lowest Error Budget Remaining",
    "Least Error Budget Time Left",
    "Peak Burn Rate",
    "Error Budget Remaining by SLO",
    "Burn Rate by SLO",
    "Selected SLO",
    "SLI History",
    "Burn Rate History",
  ],
  [FEED]: ["Edit Audit Log Settings", "Audit logging is off"],
};

/*
 * Bold words that are Dashboard labels by coincidence but are words of the
 * page here: the terms the Key concepts table defines.
 */
const PROSE: Record<string, Array<string>> = {
  [INTRODUCTION]: ["SLI", "SLO", "Error budget", "Burn rate"],
};

// The bold leads of the pages' own lists and tables: no label at all, so a translation words them.
const PROSE_LEADS: Record<string, Array<string>> = {
  [INTRODUCTION]: ["The summary", "The headline numbers"],
  [MONITOR_RULES]: [
    "An SLO with no monitor rules",
    "An SLO that has monitor rules",
    "Creating the first monitor rule",
  ],
  [BURN_RATE]: [
    "long window",
    "short window",
    "Resolution follows the long window.",
    "Auto-resolve off.",
    "Re-fire suppression.",
  ],
  [METRICS]: ["30 days"],
  [FEED]: ["Evaluation results.", "Changes OneUptime makes itself"],
  [LABEL_RULES]: [
    "label rule",
    "owner rule",
    "When an SLO is created",
    "When you run a rule",
  ],
};

/*
 * A table's create button, which the Dashboard draws from the name the table
 * gives its rows (drawnCreateButton): "Create" and the model's singular name.
 */
const TABLE_CREATE_BUTTONS: Record<string, Array<string>> = {
  [INTRODUCTION]: ["Create Service Level Objective"],
  [MONITOR_RULES]: ["Create SLO Monitor Rule"],
  [BURN_RATE]: ["Create SLO Burn Rate Rule"],
  [ERROR_BUDGET_POLICY]: [
    "Create SLO Error Budget Policy Tier",
    // The SLOs' Slack, Microsoft Teams and Mattermost rules.
    "Create SLO Notification Rule",
  ],
  [LABEL_RULES]: ["Create SLO Label Rule", "Create SLO Owner Rule"],
};

/*
 * The Overview's texts with figures in them, which the Dashboard draws in
 * the reader's language: what this language's Dashboard draws for each is
 * drawnTextWithFigures's answer, from the Dashboard's own helpers.
 */
const DRAWN_WITH_FIGURES: Record<string, Array<string>> = {
  [INTRODUCTION]: [
    "12m 30s left of 43m 12s",
    "Window 23% full",
    // The Settings page's Error Budget line (describeSloErrorBudget).
    "43m 12s of downtime per 30-day window",
  ],
  [ERROR_BUDGET]: [
    "31m 4s left of 43m 12s",
    "4d 23m over budget · 5m 47s allowed",
    "~2d 5h",
    "Window 23% full",
    // The Settings page's Error Budget line (describeSloErrorBudget).
    "43m 12s of downtime per 30-day window",
  ],
};

/*
 * The figures of the Error Budgets page's budget table - its targets and the
 * budget each allows over each window, worked out from the formula - and
 * the 31-day month's budget in the sentence under it. Each page writes them
 * as its language's Dashboard writes a percentage and a duration
 * (drawnBudgetFigure): they used to stay "99.9%" and "43m 12s" on every
 * page, beside a Settings page that wrote "0,1 %" and "43 Min., 12 Sek."
 * (#6925).
 */
const BUDGET_TABLE_SECTION: string = "How the budget is calculated";

const BUDGET_FIGURES_IN_PROSE: Record<string, Array<string>> = {
  [ERROR_BUDGET]: ["44m 38s"],
};

// An English compact unit right after its figure: "43m", "12s".
const ENGLISH_UNIT: RegExp = /\d[dhms]\b/;

/*
 * What the pages print as they are whatever the reader's language.
 */
const PRINTED_AS_IS: Record<string, Array<string>> = {
  /*
   * What the recommended policy's tiers say the team does, which OneUptime
   * writes into each tier in English and the confirmation lists as written.
   */
  [ERROR_BUDGET_POLICY]: SLO_RECOMMENDED_POLICY_TIERS.map(
    (tier: SloRecommendedPolicyTier): string => {
      return tier.whatWeDo;
    },
  ),
};

/*
 * The values of the pages' examples, which the translations keep as they
 * are: label names, monitor types and the seeded statuses, as a project
 * stores them.
 */
const VALUES_AS_IS: Record<string, Array<string>> = {
  [INTRODUCTION]: ["Degraded", "Offline"],
  [MONITOR_RULES]: ["_Production_", "_API_", "_Manual_", "_Staging_"],
  [LABEL_RULES]: ["_Checkout_", "_Production_", "_Staging_"],
};

/*
 * Numbers each page states, which every translation states too - read with
 * Persian digits as Latin ones and thousands separators dropped.
 */
const NUMBERS: Record<string, Array<string>> = {
  [INTRODUCTION]: ["5", "99.9", "30", "20", "366", "43", "12", "60", "6"],
  [MONITOR_RULES]: [],
  [ERROR_BUDGET]: [
    "43",
    "30",
    "99.9",
    "129",
    "31",
    "60",
    "400",
    "25",
    "2",
    "20",
  ],
  [BURN_RATE]: [
    "14.4",
    "6",
    "3.36",
    "1.4",
    "13.44",
    "5.6",
    "43.2",
    "18",
    "50",
    "500",
    "50000",
    "5",
    // Slow leak: 10% of the budget, a day of quiet, and its windows below 30 days.
    "10",
    "24",
    "16.8",
    "84",
    "2.8",
    // The most SLOs one bulk request of the recommended rules names.
    "100",
  ],
  // The recommended tiers, the margins to leave a tier, and the limits.
  [ERROR_BUDGET_POLICY]: [
    "50",
    "25",
    "0",
    "30",
    "10",
    "2",
    "5",
    "100",
    "10000",
  ],
  [METRICS]: ["5", "30", "400", "60"],
  [FEED]: ["14", "30", "7", "180"],
  [LABEL_RULES]: [],
};

/*
 * The names a rule is given from its picks, on the label and owner rules
 * page: the form's sentence, in each language's words, around the page's
 * example picks.
 */
const NAMED_FROM_PICKS: Array<{
  template: string;
  slot: string;
  value: string;
}> = [
  {
    template: "Add {{labels}}",
    slot: "{{labels}}",
    value: "Checkout, Production",
  },
  {
    template: "Add {{owners}} as owners",
    slot: "{{owners}}",
    value: "Checkout team",
  },
];

const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
const THOUSANDS: RegExp = /(\d)[,.\u066c\u00a0\u202f '](?=\d{3}\b)/g;
// The Arabic decimal separator (U+066B) Persian writes inside a number.
const ARABIC_DECIMAL_SEPARATOR: RegExp = /(\d)\u066b(?=\d)/g;
// A decimal comma, as German and French write "99,9": one or two digits after it.
const DECIMAL_COMMA: RegExp = /(\d),(\d{1,2})(?!\d)/g;
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const RIGHT_ARROW: string = "→";
/*
 * The no-break spaces a language's Dashboard writes inside a figure - French
 * "12 min 30 s" - which a page may write as plain spaces: they read the same.
 */
const NO_BREAK_SPACES: RegExp = new RegExp(
  `[${String.fromCharCode(0xa0)}${String.fromCharCode(0x202f)}]`,
  "g",
);

// A text as a reader sees it, its no-break spaces as spaces.
function asRead(text: string): string {
  return text.replace(NO_BREAK_SPACES, " ");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed(
  lists: Record<string, Array<string>>,
  page: string,
): Array<string> {
  return lists[page] || [];
}

// How many times a text holds a piece of text.
function occurrences(text: string, needle: string): number {
  return needle ? text.split(needle).length - 1 : 0;
}

// The bold spans of a page's prose, once each.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown));
}

function isPermissionOrPlan(name: string): boolean {
  return name === "Enterprise" || isPermissionTitleKeptInEnglish(name);
}

// How this language's Dashboard draws a bold label of a page.
function drawnLabel(language: string, page: string, label: string): string {
  const archiveCard: ArchiveCardTitle | undefined = (
    ARCHIVE_CARD_TITLES[page] || []
  ).find((entry: ArchiveCardTitle): boolean => {
    return entry.label === label;
  });

  if (archiveCard) {
    return drawnArchiveCardTitle(language, archiveCard.singularName);
  }

  return listed(TABLE_CREATE_BUTTONS, page).includes(label)
    ? drawnCreateButton(language, label)
    : drawnDashboardLabel(language, label);
}

/*
 * Whether a bold word of a page is one the Dashboard draws: a label of its
 * locales, a table's create button, or the Archive card's title.
 */
function isDrawnLabel(page: string, label: string): boolean {
  return (
    isDashboardLabel(label) ||
    listed(TABLE_CREATE_BUTTONS, page).includes(label) ||
    archiveCardTitles(page).includes(label)
  );
}

/*
 * The labels of a page that are not drawn by the Dashboard here: kept in
 * English, shown in English, prose and leads, each checked its own way.
 */
function notDashboardLabels(page: string): Array<string> {
  return [
    ...listed(KEPT_IN_ENGLISH, page).filter((name: string): boolean => {
      return !PERMISSIONS_THAT_ARE_BUTTONS.includes(name);
    }),
    ...listed(SHOWN_IN_ENGLISH, page),
    ...listed(PROSE, page),
    ...listed(PROSE_LEADS, page),
  ];
}

// Every number a page's prose states, as Latin digits without separators.
function statedNumbers(markdown: string): Set<string> {
  const text: string = toLatinDigits(prose(markdown))
    .replace(ARABIC_DECIMAL_SEPARATOR, "$1.")
    .replace(THOUSANDS, "$1")
    .replace(DECIMAL_COMMA, "$1.$2");

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
 * The body rows of the Error Budgets page's budget table, cell by cell: the
 * first table of the section that sits where the English page's "How the
 * budget is calculated" sits, minus its header and delimiter rows. None on
 * any other page.
 */
function budgetTableRows(page: string, markdown: string): Array<Array<string>> {
  if (page !== ERROR_BUDGET) {
    return [];
  }

  const index: number = sections(englishPage(ERROR_BUDGET)).findIndex(
    (heading: DocsHeading): boolean => {
      return heading.text === BUDGET_TABLE_SECTION;
    },
  );
  const headings: Array<DocsHeading> = sections(markdown);
  const heading: DocsHeading | undefined =
    index < 0 ? undefined : headings[index];

  if (!heading) {
    return [];
  }

  const next: DocsHeading | undefined = headings[index + 1];
  const lines: Array<string> = markdown
    .split("\n")
    .slice(heading.line, next ? next.line - 1 : undefined);
  const rows: Array<Array<string>> = [];

  for (const line of lines) {
    if (!line.startsWith("|")) {
      if (rows.length > 0) {
        break;
      }

      continue;
    }

    rows.push(
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows.slice(2);
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

// The tab labels of every :::tabs block of a page, in order.
function tabCounts(markdown: string): Array<number> {
  return scanMarkdown(markdown)
    .containers.filter((container: { name: string }): boolean => {
      return container.name === "tabs";
    })
    .map((container: { tabs: Array<string> }): number => {
      return container.tabs.length;
    });
}

// The name a rule is given from its picks, as this language's Dashboard words it.
function namedFromPicks(
  language: string,
  entry: { template: string; slot: string; value: string },
): string {
  return drawnDashboardLabel(language, entry.template).replace(
    entry.slot,
    entry.value,
  );
}

// An italic span around a text, written with underscores or asterisks.
function italicPattern(text: string): RegExp {
  return new RegExp(`[_*]${escapeRegExp(text)}[_*]`);
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      KEPT_IN_ENGLISH,
      SHOWN_IN_ENGLISH,
      PROSE,
      PROSE_LEADS,
      TABLE_CREATE_BUTTONS,
      DRAWN_WITH_FIGURES,
      PRINTED_AS_IS,
      VALUES_AS_IS,
      NUMBERS,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("list only bold words the English page has", () => {
    for (const lists of [
      KEPT_IN_ENGLISH,
      SHOWN_IN_ENGLISH,
      PROSE,
      PROSE_LEADS,
      TABLE_CREATE_BUTTONS,
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

  it("keep in English only permissions, plans, names OneUptime gives records, and the template's widget titles", () => {
    for (const name of listed(KEPT_IN_ENGLISH, LABEL_RULES)) {
      expect({ name, permission: true }).toEqual({
        name,
        permission: isPermissionOrPlan(name),
      });
    }

    expect(isPermissionOrPlan("Enterprise")).toBe(true);
  });

  it("call shown in English only names the Dashboard has no wording for", () => {
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
  });

  it("draw the Archive card's title as the English page writes it, and worded anew in every language (#7195)", () => {
    for (const page of Object.keys(ARCHIVE_CARD_TITLES)) {
      expect(PAGE_NAMES).toContain(page);

      const labels: Array<string> = boldLabels(englishPage(page));

      for (const entry of ARCHIVE_CARD_TITLES[
        page
      ] as Array<ArchiveCardTitle>) {
        expect(labels).toContain(entry.label);
        expect(drawnArchiveCardTitle("en", entry.singularName)).toBe(
          entry.label,
        );
        // No locale has the title itself: it is drawn, not looked up.
        expect(isDashboardLabel(entry.label)).toBe(false);

        for (const language of LANGUAGES) {
          expect({
            language,
            drawn: drawnArchiveCardTitle(language, entry.singularName),
          }).not.toEqual({ language, drawn: entry.label });
        }
      }
    }
  });

  it("draw a table's create button from the model's name", () => {
    for (const page of Object.keys(TABLE_CREATE_BUTTONS)) {
      for (const button of TABLE_CREATE_BUTTONS[page] as Array<string>) {
        expect(button.startsWith("Create ")).toBe(true);
        expect(drawnCreateButton("en", button)).toBe(button);
      }
    }
  });

  it("know every bold word on the English pages", () => {
    for (const page of PAGE_NAMES) {
      const known: Array<string> = [
        ...notDashboardLabels(page),
        ...listed(KEPT_IN_ENGLISH, page),
        ...listed(TABLE_CREATE_BUTTONS, page),
        ...listed(DRAWN_WITH_FIGURES, page),
      ];
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !isDrawnLabel(page, span) && !known.includes(span);
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("quote what the product prints, values and numbers the English pages really have", () => {
    for (const lists of [PRINTED_AS_IS, VALUES_AS_IS]) {
      for (const page of Object.keys(lists)) {
        for (const text of lists[page] as Array<string>) {
          expect({ page, text, quoted: true }).toEqual({
            page,
            text,
            quoted: englishPage(page).includes(text),
          });
        }
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

    for (const entry of NAMED_FROM_PICKS) {
      expect(englishPage(LABEL_RULES)).toMatch(
        italicPattern(namedFromPicks("en", entry)),
      );
    }
  });

  it("quote the Overview's texts with figures as the English Dashboard draws them, worded anew in every language", () => {
    for (const page of Object.keys(DRAWN_WITH_FIGURES)) {
      for (const text of DRAWN_WITH_FIGURES[page] as Array<string>) {
        expect({ page, text, quoted: true, drawnInEnglish: text }).toEqual({
          page,
          text,
          quoted: englishPage(page).includes(text),
          drawnInEnglish: drawnTextWithFigures("en", text),
        });

        // Every docs language's Dashboard words it: none reads it in English.
        for (const language of LANGUAGES) {
          expect({ language, text, inEnglish: false }).toEqual({
            language,
            text,
            inEnglish: drawnTextWithFigures(language, text) === text,
          });
        }
      }
    }
  });

  it("find the Error Budgets page's budget table, every figure of it one the English Dashboard writes as the page does", () => {
    const rows: Array<Array<string>> = budgetTableRows(
      ERROR_BUDGET,
      englishPage(ERROR_BUDGET),
    );

    // No other page of the group has the table.
    expect(budgetTableRows(INTRODUCTION, englishPage(INTRODUCTION))).toEqual(
      [],
    );

    // Five targets, each with its budget over 7, 28, 30 and 90 days.
    expect(rows.length).toBe(5);

    for (const row of rows) {
      expect(row.length).toBe(5);

      for (const cell of row) {
        expect({ cell, drawnInEnglish: cell }).toEqual({
          cell,
          drawnInEnglish: drawnBudgetFigure("en", cell),
        });
      }
    }

    for (const page of Object.keys(BUDGET_FIGURES_IN_PROSE)) {
      for (const text of BUDGET_FIGURES_IN_PROSE[page] as Array<string>) {
        expect({ page, text, quoted: true, drawnInEnglish: text }).toEqual({
          page,
          text,
          quoted: prose(englishPage(page)).includes(text),
          drawnInEnglish: drawnBudgetFigure("en", text),
        });
      }
    }
  });

  it("write the budget table's durations in every docs language's own units, none of them in English", () => {
    const durations: Array<string> = [
      ...budgetTableRows(ERROR_BUDGET, englishPage(ERROR_BUDGET)).flatMap(
        (row: Array<string>): Array<string> => {
          return row.slice(1);
        },
      ),
      ...listed(BUDGET_FIGURES_IN_PROSE, ERROR_BUDGET),
    ];

    expect(durations.length).toBe(21);

    for (const language of LANGUAGES) {
      for (const duration of durations) {
        const drawn: string | null = drawnBudgetFigure(language, duration);

        expect({ language, duration, drawn: true, inEnglish: false }).toEqual({
          language,
          duration,
          drawn: drawn !== null,
          inEnglish: drawn === duration || ENGLISH_UNIT.test(drawn || ""),
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

  it.each(PAGES)(
    "$page draws a diagram with a caption, and walks what you do in steps",
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

      // The Error Budgets page explains; the others walk a procedure.
      if (entry.page !== ERROR_BUDGET) {
        expect(markdown).toContain(":::steps");
      }
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

    it("has the English page's headings, steps, tabs, tables and list items", () => {
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
      expect(tabCounts(translated)).toEqual(tabCounts(english));
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
            isDrawnLabel(entry.page, label) &&
            !exceptions.includes(label) &&
            !listed(KEPT_IN_ENGLISH, entry.page).includes(label)
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
     * (a step, and the troubleshooting that sends the reader back to it) is
     * named in both, so neither can drift to other words.
     */
    it("names each Dashboard label as often as the English page does", () => {
      const translated: string = prose(readPage(language, entry.page));
      const source: string = prose(english);
      const exceptions: Array<string> = notDashboardLabels(entry.page);
      const tooFew: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return (
            isDrawnLabel(entry.page, label) &&
            !exceptions.includes(label) &&
            !listed(KEPT_IN_ENGLISH, entry.page).includes(label)
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

    it("keeps in English what stays English: permissions, plans, names OneUptime gives records, and what the pages draw in English", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(KEPT_IN_ENGLISH, entry.page),
        ...listed(SHOWN_IN_ENGLISH, entry.page),
      ].filter((name: string): boolean => {
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

    it("quotes what the product prints, the examples' values and the English page's numbers as they are", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(PRINTED_AS_IS, entry.page),
        ...listed(VALUES_AS_IS, entry.page).map((value: string): string => {
          // An italic value may be written *value* where a script needs it.
          return value.replace(/^_(.*)_$/, "$1");
        }),
      ].filter((text: string): boolean => {
        return !translated.includes(text);
      });

      expect(missing).toEqual([]);

      const stated: Set<string> = statedNumbers(translated);

      for (const value of listed(NUMBERS, entry.page)) {
        expect({ value, stated: true }).toEqual({
          value,
          stated: stated.has(value),
        });
      }
    });

    it("quotes the Overview's texts with figures as this language's Dashboard draws them (#6696)", () => {
      const translated: string = asRead(readPage(language, entry.page));
      const problems: Array<string> = [];

      for (const text of listed(DRAWN_WITH_FIGURES, entry.page)) {
        const drawn: string = asRead(
          drawnTextWithFigures(language, text) || text,
        );

        // As often as the English page quotes it, and bold where it is bold.
        if (occurrences(translated, drawn) < occurrences(english, text)) {
          problems.push(`${text} -> ${drawn}: not quoted`);
        }

        if (
          occurrences(translated, `**${drawn}**`) <
          occurrences(english, `**${text}**`)
        ) {
          problems.push(`${text} -> ${drawn}: not bold`);
        }

        // No page still quotes the English its Dashboard no longer draws.
        if (translated.includes(text)) {
          problems.push(`${text}: still in English`);
        }
      }

      expect(problems).toEqual([]);
    });

    it("writes the budget table's and the 31-day month's figures as this language's Dashboard writes a percentage and a duration (#6925)", () => {
      const translated: string = readPage(language, entry.page);
      const englishRows: Array<Array<string>> = budgetTableRows(
        entry.page,
        english,
      );
      const problems: Array<string> = [];

      // Cell by cell: each target and budget as the language writes it.
      expect(
        budgetTableRows(entry.page, translated).map(
          (row: Array<string>): Array<string> => {
            return row.map(asRead);
          },
        ),
      ).toEqual(
        englishRows.map((row: Array<string>): Array<string> => {
          return row.map((cell: string): string => {
            return asRead(drawnBudgetFigure(language, cell) || cell);
          });
        }),
      );

      // The month's budget in the sentence under the table.
      for (const text of listed(BUDGET_FIGURES_IN_PROSE, entry.page)) {
        const drawn: string = asRead(drawnBudgetFigure(language, text) || text);

        if (
          occurrences(asRead(prose(translated)), drawn) <
          occurrences(prose(english), text)
        ) {
          problems.push(`${text} -> ${drawn}: not written`);
        }

        if (translated.includes(text)) {
          problems.push(`${text}: still in English`);
        }
      }

      expect(problems).toEqual([]);
    });

    it("writes menu paths the way its script reads them", () => {
      const translated: string = prose(readPage(language, entry.page));

      // Persian is read right to left, where "→" points back; it writes ">".
      if (language === "fa") {
        expect(translated.includes(RIGHT_ARROW)).toBe(false);
      } else {
        expect(
          occurrences(translated, RIGHT_ARROW) + occurrences(translated, " > "),
        ).toBe(occurrences(prose(english), RIGHT_ARROW));
      }
    });

    if (entry.page === ERROR_BUDGET_POLICY) {
      it("names the tier table's create button as this language's Dashboard draws it, and the permission in English", () => {
        const translated: string = readPage(language, entry.page);
        const button: string = "Create SLO Error Budget Policy Tier";

        expect(translated).toContain(
          `**${drawnCreateButton(language, button)}**`,
        );
        expect(translated).toContain(`| **${button}** |`);
      });
    }

    if (entry.page === LABEL_RULES) {
      it("names a rule after its picks as this language's Dashboard words the name", () => {
        const translated: string = readPage(language, entry.page);

        for (const pick of NAMED_FROM_PICKS) {
          expect({
            name: namedFromPicks(language, pick),
            found: italicPattern(namedFromPicks(language, pick)).test(
              translated,
            ),
          }).toEqual({ name: namedFromPicks(language, pick), found: true });
        }
      });
    }
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these check
 * the page-specific readers.
 */
describe("the helpers, on these pages' shapes", () => {
  it("count the tabs of every tab set, and only of tab sets", () => {
    expect(
      tabCounts(
        [
          ":::tabs",
          "@tab Rolling",
          "One.",
          "@tab Calendar Month",
          "Two.",
          ":::",
          ":::steps",
          "### A step",
          ":::",
        ].join("\n"),
      ),
    ).toEqual([2]);
  });

  it("read numbers in any digits, without thousands separators", () => {
    expect(
      Array.from(
        statedNumbers(
          "Bis zu 50.000 Zeichen, ۱۴٫۴ و 99.9 und 1,000, 99,9 % oder 3,36.",
        ),
      ),
    ).toEqual(["50000", "14.4", "99.9", "1000", "3.36"]);
  });

  it("find a rule's name in either italic", () => {
    expect(
      italicPattern("Add Checkout, Production").test(
        "_Add Checkout, Production_",
      ),
    ).toBe(true);
    expect(
      italicPattern("Checkout, Production を追加").test(
        "*Checkout, Production を追加*",
      ),
    ).toBe(true);
    expect(italicPattern("Add Checkout").test("Add Checkout")).toBe(false);
  });

  it("draw a rule's name from the language's own sentence", () => {
    expect(
      namedFromPicks(
        "de",
        NAMED_FROM_PICKS[0] as {
          template: string;
          slot: string;
          value: string;
        },
      ),
    ).toBe("Checkout, Production hinzufügen");
    expect(
      namedFromPicks(
        "en",
        NAMED_FROM_PICKS[1] as {
          template: string;
          slot: string;
          value: string;
        },
      ),
    ).toBe("Add Checkout team as owners");
  });

  it("draw the Overview's texts with figures as each language's Dashboard draws them", () => {
    // The window chip: the locale's "Window {{percent}}% full", 23 put in.
    expect(drawnTextWithFigures("de", "Window 23% full")).toBe(
      "Fenster zu 23 % gefüllt",
    );
    // Persian writes its own digits, as its Dashboard does.
    expect(drawnTextWithFigures("fa", "Window 23% full")).toBe(
      "۲۳٪ بازه پر شده",
    );
    // The budget lines and the runway, in the language's own units.
    expect(drawnTextWithFigures("de", "31m 4s left of 43m 12s")).toBe(
      "Noch 31 Min., 4 Sek. von 43 Min., 12 Sek.",
    );
    expect(
      drawnTextWithFigures("de", "4d 23m over budget · 5m 47s allowed"),
    ).toBe("4 Tg., 23 Min. über dem Budget · 5 Min., 47 Sek. erlaubt");
    expect(drawnTextWithFigures("ko", "~2d 5h")).toBe("~2일 5시간");
    // Persian punctuates the line with its own separator.
    expect(
      drawnTextWithFigures("fa", "4d 23m over budget · 5m 47s allowed"),
    ).toBe("۴ روز ۲۳ دقیقه بیش از بودجه • ۵ دقیقه ۴۷ ثانیه مجاز");

    // In English, each reads exactly as written.
    for (const texts of Object.values(DRAWN_WITH_FIGURES)) {
      for (const text of texts) {
        expect(drawnTextWithFigures("en", text)).toBe(text);
      }
    }
  });

  it("draw nothing for a text the Dashboard does not draw from figures", () => {
    // A label with no figure in it: drawnDashboardLabel's.
    expect(drawnTextWithFigures("de", "Budget exceeded")).toBeNull();
    // A percentage the chip never writes: it floors to a whole percent.
    expect(drawnTextWithFigures("de", "Window 23.5% full")).toBeNull();
    // Durations the Dashboard never writes: "1m", never "60s"; no "0h".
    expect(drawnTextWithFigures("de", "60s left of 43m 12s")).toBeNull();
    expect(
      drawnTextWithFigures("de", "4d 0h 23m over budget · 5m 47s allowed"),
    ).toBeNull();
    // Not a duration at all.
    expect(drawnTextWithFigures("de", "~2 days")).toBeNull();
  });

  it("draw the Settings page's Error Budget line as each language's Settings page draws it (#6925)", () => {
    const line: string = "43m 12s of downtime per 30-day window";

    expect(drawnTextWithFigures("en", line)).toBe(line);
    expect(asRead(drawnTextWithFigures("de", line) || "")).toBe(
      "43 Min., 12 Sek. Ausfallzeit pro Zeitfenster von 30 Tagen",
    );
    // Persian digits and units, as its Settings page writes them.
    expect(drawnTextWithFigures("fa", line)).toBe(
      "۴۳ دقیقه ۱۲ ثانیه زمان قطعی در هر بازه ۳۰ روزه",
    );
    // The same budget the Overview's tile names, in the same words.
    expect(drawnTextWithFigures("de", line)).toContain(
      (drawnTextWithFigures("de", "31m 4s left of 43m 12s") || "").replace(
        /^.* von /,
        "",
      ),
    );
    // A budget no target leaves in that window, or no window at all.
    expect(
      drawnTextWithFigures("de", "43m 12s of downtime per 0-day window"),
    ).toBeNull();
    // "1m", never "60s": the Settings page never writes it.
    expect(
      drawnTextWithFigures("de", "60s of downtime per 30-day window"),
    ).toBeNull();
  });

  it("draw the budget table's figures as each language's Dashboard writes a percentage and a duration (#6925)", () => {
    // A target with the language's decimal separator and percent.
    expect(asRead(drawnBudgetFigure("de", "99.9%") || "")).toBe("99,9 %");
    expect(asRead(drawnBudgetFigure("fr", "99.95%") || "")).toBe("99,95 %");
    expect(drawnBudgetFigure("fa", "99.9%")).toBe("۹۹٫۹٪");
    expect(drawnBudgetFigure("ja", "99.99%")).toBe("99.99%");
    expect(asRead(drawnBudgetFigure("de", "99.999%") || "")).toBe("99,999 %");

    // A budget with the units the Dashboard names a duration's parts with.
    expect(asRead(drawnBudgetFigure("de", "43m 12s") || "")).toBe(
      "43 Min., 12 Sek.",
    );
    expect(drawnBudgetFigure("fa", "44m 38s")).toBe("۴۴ دقیقه ۳۸ ثانیه");
    expect(asRead(drawnBudgetFigure("es", "7h 12m") || "")).toBe("7 h 12 min");

    // Two parts read exactly as the Dashboard's own compact duration.
    for (const language of ["de", "fa", "ar", "ja", "ru", "zh-CN"]) {
      expect({
        language,
        drawn: drawnBudgetFigure(language, "43m 12s"),
      }).toEqual({
        language,
        drawn: formatDurationCompactInLanguage(43 * 60 + 12, language),
      });
    }

    // The table keeps a third part and a zero part the Dashboard leaves out.
    expect(asRead(drawnBudgetFigure("de", "1h 40m 48s") || "")).toBe(
      "1 Std., 40 Min. und 48 Sek.",
    );
    expect(asRead(drawnBudgetFigure("de", "1m 0s") || "")).toBe(
      "1 Min., 0 Sek.",
    );
    expect(drawnBudgetFigure("fa", "2h 9m 36s")).toBe(
      "۲ ساعت ۹ دقیقه ۳۶ ثانیه",
    );

    // In English, each reads exactly as written.
    for (const figure of ["99%", "99.95%", "1h 40m 48s", "1m 0s", "44m 38s"]) {
      expect(drawnBudgetFigure("en", figure)).toBe(figure);
    }

    // Nothing for what is no target or budget of the table.
    for (const text of [
      "",
      "99.9",
      "99.9 %",
      "Target",
      "1h40m",
      "43m  12s",
      "43 m",
      "5w",
      "43m 12s of downtime per 30-day window",
    ]) {
      expect({ text, drawn: drawnBudgetFigure("de", text) }).toEqual({
        text,
        drawn: null,
      });
    }
  });
});
