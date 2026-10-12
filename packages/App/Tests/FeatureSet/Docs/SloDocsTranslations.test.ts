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
  escapeRegExp,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 18a: the seven SLO pages - SLOs Overview, Monitors and
 * Monitor Rules, Error Budgets, Burn Rate Alerts and Incidents, SLO Metrics
 * and Dashboards, SLO Feed and Audit Logs, and Label and Owner Rules - in
 * every docs language. Each translation says what the English page says:
 * the same sections, steps, tables, lists, cards, code and diagrams, links
 * that land on the heading the English link means, a title that is the nav
 * link's, and every screen named the way that language's Dashboard draws it.
 *
 * "The way the Dashboard draws it" is the rule a reader can check against the
 * screen, Persian included, as on every page since the on-call pages: a bold
 * label on the English page that is a Dashboard label is, on the translated
 * page, its value in that language's Dashboard locale, or English where the
 * locale has no wording of its own (drawnDashboardLabel). A table's create
 * button is drawn from the name the table gives its rows (drawnCreateButton).
 *
 * Some bold names stay in English on purpose, by list:
 *
 *   - KEPT_IN_ENGLISH: permissions and plans, as the role pickers and the
 *     billing pages name them; the names OneUptime itself gives a new SLO's
 *     rules (Fast burn, Slow burn) and the rule the upgrade creates; and the
 *     widget titles the SLO Dashboard template writes into a new dashboard.
 *     All of them are data or names the API and Terraform use too, so they
 *     read the same whatever the reader's language.
 *   - SHOWN_IN_ENGLISH: what the SLO pages draw in English in every language,
 *     because the Dashboard has no wording for it: the runway and budget
 *     words of the Overview's tiles, the banners' titles, the window-fill
 *     chip, the Metrics page's tabs, and so on.
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
const METRICS: string = "slo/metrics";
const FEED: string = "slo/feed-and-audit-logs";
const LABEL_RULES: string = "slo/label-and-owner-rules";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: INTRODUCTION, navTitle: "SLOs Overview" },
  { page: MONITOR_RULES, navTitle: "Monitors and Monitor Rules" },
  { page: ERROR_BUDGET, navTitle: "Error Budgets" },
  { page: BURN_RATE, navTitle: "Burn Rate Alerts and Incidents" },
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
  [INTRODUCTION]: ["Fast burn", "Slow burn"],
  [BURN_RATE]: ["Fast burn", "Slow burn"],
  // The rule the upgrade creates from the old setting (SloDocs pins it).
  [MONITOR_RULES]: ["Auto-add monitors with labels"],
  // The widget titles the SLO Dashboard template creates.
  [METRICS]: [
    "Service Level Objectives",
    "SLI",
    "Error Budget Remaining",
    "Burn Rate",
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
];

// Names the SLO pages draw in English in every language: the Dashboard has no wording for them.
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [INTRODUCTION]: [
    "Calendar Month",
    "Budget exceeded",
    "Archive SLO",
    "Window 23% full",
    "Window under 1% full",
    "Waiting for SLO evaluation",
    "Measurement is paused",
    "The target is out of range",
    "This SLO is disabled",
    "This SLO is archived",
  ],
  [MONITOR_RULES]: ["Auto-Add Monitors With Labels"],
  [ERROR_BUDGET]: [
    "No budget left",
    "Budget exceeded",
    "~2d 5h",
    "Under 1m",
    "Not burning",
    "Sustainable",
    "Lasts until reset",
    "Overspent",
    "Error Budget History",
    "Window 23% full",
  ],
  [METRICS]: [
    "SLO Metrics",
    "Error Budget History",
    "Monitor Metric Retention (Days)",
    "Follow SLO Variable",
    "Telemetry Attribute",
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
  [LABEL_RULES]: ["Create SLO Label Rule", "Create SLO Owner Rule"],
};

/*
 * What the product prints in English whatever the reader's language: the
 * Overview tile's budget lines and the budget durations of the tables, which
 * every translation quotes as they are.
 */
const PRINTED_AS_IS: Record<string, Array<string>> = {
  [INTRODUCTION]: ["12m 30s left of 43m 12s"],
  [ERROR_BUDGET]: [
    "1h 40m 48s",
    "6h 43m 12s",
    "7h 12m",
    "21h 36m",
    "50m 24s",
    "3h 21m 36s",
    "3h 36m",
    "10h 48m",
    "10m 5s",
    "40m 19s",
    "43m 12s",
    "2h 9m 36s",
    "5m 2s",
    "20m 10s",
    "21m 36s",
    "1h 4m 48s",
    "1m 0s",
    "4m 2s",
    "4m 19s",
    "12m 58s",
    "44m 38s",
    "31m 4s left of 43m 12s",
    "4d 23m over budget · 5m 47s allowed",
  ],
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
  [INTRODUCTION]: ["5", "99.9", "30", "20", "366", "43", "12", "60"],
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
  return (
    name === "Enterprise" ||
    PermissionHelper.getAllPermissionProps().some(
      (props: PermissionProps): boolean => {
        return props.title === name;
      },
    )
  );
}

// How this language's Dashboard draws a bold label of a page.
function drawnLabel(language: string, page: string, label: string): string {
  return listed(TABLE_CREATE_BUTTONS, page).includes(label)
    ? drawnCreateButton(language, label)
    : drawnDashboardLabel(language, label);
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
      ];
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !isDashboardLabel(span) && !known.includes(span);
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
            (isDashboardLabel(label) ||
              listed(TABLE_CREATE_BUTTONS, entry.page).includes(label)) &&
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
            (isDashboardLabel(label) ||
              listed(TABLE_CREATE_BUTTONS, entry.page).includes(label)) &&
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
});
