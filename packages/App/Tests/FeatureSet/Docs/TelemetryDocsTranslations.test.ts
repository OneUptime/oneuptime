import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
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
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 11: the telemetry pages - Search Syntax, Zooming Into a
 * Time Range, Log Pipelines, Continuous Profiling, Source Maps and Log
 * Recording Rules - in every docs language. Each translation says what the
 * English page says: the same sections, steps, tabs, tables, lists, cards,
 * code and diagrams, the same numbers, links that land on a heading in the
 * reader's language, a title that is the nav link's, and the product named
 * the way that language's product draws it.
 *
 * "The way the product draws it" has these sources on these pages:
 *
 *   - A bold Dashboard label is its value in that language's Dashboard
 *     locale, Persian included (drawnActionLabel). A field written as a
 *     lead ("**Name:** SD-WAN gateway latency") is the label and a colon.
 *   - A menu path ("Logs → Settings → Pipelines") is drawn segment by
 *     segment. After "Products", the product is the Products menu's own
 *     title for it (its navbar.items key): "Products → Performance
 *     Profiles" is "Produkte → Performance-Profile" in German, while the
 *     profiles page itself is titled "Leistungsprofile".
 *   - The log pipeline processor types are named as the Processor Type
 *     picker draws them, in the processor table and as the headings of
 *     their sections. Key=Value Parser has no translation anywhere, so its
 *     heading - and the #keyvalue-parser anchor other pages link to - is
 *     the same in every language.
 *   - A form field the Dashboard labels "(optional)" (Target Prefix) is
 *     named as the start of its drawn label, without the parenthesis.
 *   - The charts' "double-click to reset" is the second half of the hint
 *     the volume charts draw (" · double-click to reset").
 *   - A permission is named as Permission.ts titles it: the team and API key
 *     permission pickers list those titles untranslated in every language,
 *     so every translation keeps them in English (PERMISSIONS). "Create Log
 *     Pipeline" is both a permission and a button on its page, so the page
 *     has it both ways.
 *   - Names the Dashboard draws in English everywhere - a tab with no
 *     locale key, the aggregation option "Count of logs", the criteria
 *     names - and the docs' own tab names stay in English (SHOWN_IN_ENGLISH).
 *     When the Dashboard gains a key for one, a test below fails until the
 *     pages name it as drawn.
 *
 * Bold words that are Dashboard labels only by coincidence are PROSE, with
 * why; bold words that are neither labels nor shown in English are the
 * pages' own leads (PROSE_LEADS), which a translation words freely.
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

const SEARCH: string = "telemetry/search-syntax";
const ZOOM: string = "telemetry/charts-and-time-ranges";
const PIPELINES: string = "telemetry/log-pipelines";
const PROFILES: string = "telemetry/profiles";
const SOURCE_MAPS: string = "telemetry/source-maps";
const RECORDING_RULES: string = "telemetry/log-recording-rules";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: SEARCH, navTitle: "Search Syntax" },
  { page: ZOOM, navTitle: "Zooming Into a Time Range" },
  { page: PIPELINES, navTitle: "Log Pipelines" },
  { page: PROFILES, navTitle: "Continuous Profiling" },
  { page: SOURCE_MAPS, navTitle: "Source Maps" },
  { page: RECORDING_RULES, navTitle: "Log Recording Rules" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

/*
 * Permission names, as Permission.ts titles them and the team and API key
 * permission pickers list them, untranslated, in every language.
 */
const PERMISSIONS: Record<string, Array<string>> = {
  [PIPELINES]: ["Create Log Pipeline", "Create Log Pipeline Processor"],
  [SOURCE_MAPS]: ["Read Telemetry Source Map"],
  [RECORDING_RULES]: ["Create / Edit Log Recording Rule"],
};

/*
 * Permission names that are also a button on the same page, so the page
 * names them both ways: "click **Create Log Pipeline**" is the button, as
 * drawn; "the **Create Log Pipeline** ... permissions" is the permission.
 */
const ALSO_A_BUTTON: Record<string, Array<string>> = {
  [PIPELINES]: ["Create Log Pipeline"],
};

/*
 * Bold names every language shows in English, because the Dashboard's
 * locales have no key for them or because they are the docs' own tab names
 * (a product's name), by page.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [PROFILES]: [
    // The profile page's third tab, which has no locale key.
    "Diff vs. baseline",
    // The page's own tabs: products, named as their makers name them.
    "Grafana Alloy",
    ".NET",
  ],
  [RECORDING_RULES]: [
    // The editor's aggregation option, which has no locale key.
    "Count of logs",
    // A metrics monitor's aggregation strategy and condition.
    "All Values",
    "Greater Than",
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where the
 * English page uses them, which a translation words as its language needs.
 */
const PROSE: Record<string, Array<string>> = {
  /*
   * "A pipeline has a **filter** that decides which logs it applies to",
   * "**Keys** start with a letter" and the "**Limits:**" lead of the
   * parsing rules: the words, not the screens that share them.
   */
  [PIPELINES]: ["filter", "Keys", "Limits:"],
  // "**Ruby** and **Rust** work like Go": the languages.
  [PROFILES]: ["Ruby", "Rust"],
};

/*
 * The bold leads of the pages' own lists and sentences. They are neither
 * Dashboard labels nor shown in English, so a translation words them
 * freely; listing them makes a new bold name on these pages fail below
 * until it is put in SHOWN_IN_ENGLISH, PERMISSIONS or here.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [SEARCH]: ["every filter must match", "spaces", "not", "between", "keys"],
  [ZOOM]: [
    "Drag across the spike",
    "Double-click any chart",
    "Zoom as deep as you like; one reset climbs all the way out.",
    "Any chart can reset any zoom.",
    "Picking a range yourself starts over.",
    "A zoomed window is fixed.",
    "A zoom never runs past now.",
    "You can let go of the mouse outside the chart",
    "You don't have to wait for the charts to load to go back.",
    "Double-clicking a page that isn't zoomed does nothing.",
    "On line, area and bar charts, a plain click is not a zoom.",
    "On the explorers' volume charts, a click on one bar zooms into that bar.",
  ],
  [PIPELINES]: [
    "processors",
    "Pipelines run in order",
    "Processors run in order too",
    "Processing happens at ingest.",
    "A processor never drops or blanks a log.",
    "Only enabled pipelines and processors run.",
    "Quoted values",
    "Unquoted values",
    "Empty values",
    "Values are always text.",
    "A repeated key keeps its first value",
  ],
  [PROFILES]: ["Pyroscope-compatible ingest API", "password", "not"],
  [SOURCE_MAPS]: [
    "never fetched from your site",
    "whole request body",
    "lowered",
  ],
  [RECORDING_RULES]: [
    "One point per minute, per series.",
    "Computed 30 seconds after the minute ends.",
    "No gaps, no double counting.",
    "A count with no group by never has gaps.",
    "Written like any other derived metric.",
    "skipped",
    "definition",
    "Metric query:",
    "Rolling time window:",
    "Aggregation strategy:",
    "Timestamps come from the logs.",
    "No backfill.",
    "Deleting a rule",
    "Recording rules run with the project's full view of logs.",
  ],
};

/*
 * Bold names whose Dashboard label carries more than the page writes: the
 * form labels the field "Target Prefix (optional)", and a translation names
 * the start of that label as drawn.
 */
const DRAWN_WITH_MORE: Record<string, string> = {
  "Target Prefix": "Target Prefix (optional)",
};

// The hint whose second half the zoom page quotes on its own.
const RESET_HINT_KEY: string = " · double-click to reset";
const RESET_HINT_PART: string = "double-click to reset";
const RESET_HINT_SEPARATOR: RegExp = /^\s*·\s*/;

// The log pipeline processor types, as the Processor Type picker lists them.
const PROCESSOR_TYPES: Array<string> = [
  "Grok Parser",
  "Key=Value Parser",
  "Severity Remapper",
  "Attribute Remapper",
  "Category Processor",
];

/*
 * The numbers each page states in its prose - limits, defaults, windows and
 * versions - which every translation states too.
 */
const NUMBERS: Record<string, Array<string>> = {
  [SEARCH]: ["100"],
  [ZOOM]: ["30"],
  [PIPELINES]: ["8", "32", "100", "256", "3164", "4096"],
  [PROFILES]: ["0.14", "1.0", "1.5", "15", "16"],
  [SOURCE_MAPS]: ["50", "90", "1000"],
  [RECORDING_RULES]: ["5", "10", "15", "30", "60", "100", "1000"],
};

const PATH_SEPARATOR: string = " → ";

const PRODUCTS: string = "Products";

/*
 * The Products menu's own titles for the products a path opens after
 * "Products": the menu draws each from its navbar.items key, not the flat
 * label key.
 */
const PRODUCTS_MENU_KEYS: Record<string, string> = {
  "Performance Profiles": "performanceProfilesTitle",
  "Project Settings": "projectSettingsTitle",
  Services: "servicesTitle",
};

// A bold span that leads a list item with a field's name: "**Name:**".
const FIELD_LEAD: RegExp = /:$/;

// Where a drawn "(optional)" label's name ends: at its parenthesis.
const OPTION_DETAIL: RegExp = /\s*[(（].*$/;

// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;

// Code in rendered HTML: a code block or an inline code span.
const RENDERED_CODE: RegExp = /<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/g;

// A rendered HTML tag, whose attributes may hold underscores of their own.
const HTML_TAG: RegExp = /<[^>]*>/g;

/*
 * A name written with underscores outside code: CommonMark never reads an
 * underscore between two letters as emphasis, so it is the name, not a
 * marker left over.
 */
const UNDERSCORED_NAME: RegExp = /[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+/g;

// A tab of a :::tabs block.
const TAB_LINE: RegExp = /^@tab\s+(.+)$/;

/*
 * A number as prose states it: 15, 4,096, 1.5. A translation may group
 * thousands its own way (4.096, 4 096, ۴٬۰۹۶) and write Persian digits.
 */
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
const THOUSANDS_SEPARATOR: RegExp = /(\d)[,.\s  '٬](?=\d{3}(?!\d))/g;
const PERSIAN_DECIMAL_MARK: RegExp = /(\d)٫(\d)/g;

const REGEXP_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;

function englishPage(page: string): string {
  return readPage("en", page);
}

function escapeRegExp(text: string): string {
  return text.replace(REGEXP_SPECIAL, "\\$&");
}

// The bold spans of a page that are one label, not a path.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown)).filter((span: string): boolean => {
    return !span.includes(PATH_SEPARATOR);
  });
}

// A bold span without the colon of a field lead: "Name:" is "Name".
function withoutFieldColon(span: string): string {
  return span.replace(FIELD_LEAD, "");
}

// The bold spans of a page that are a path of Dashboard labels.
function menuPaths(markdown: string): Array<Array<string>> {
  return boldSpans(prose(markdown))
    .filter((span: string): boolean => {
      return span.includes(PATH_SEPARATOR);
    })
    .map((span: string): Array<string> => {
      return span.split(PATH_SEPARATOR).map((segment: string): string => {
        return segment.trim();
      });
    })
    .filter((segments: Array<string>): boolean => {
      return segments.every((segment: string): boolean => {
        return isActionLabel(segment);
      });
    });
}

/*
 * A menu path's segment as that language draws it: the product after
 * "Products" is the Products menu's own title for it.
 */
function drawnPathSegment(
  language: string,
  segments: Array<string>,
  index: number,
): string {
  const segment: string = segments[index] as string;
  const key: string | undefined = PRODUCTS_MENU_KEYS[segment];

  if (language !== "en" && segments[0] === PRODUCTS && index === 1 && key) {
    const navbar: unknown = dashboardLocale(language)["navbar"];
    const items: unknown = (navbar as Record<string, unknown> | undefined)?.[
      "items"
    ];
    const title: unknown = (items as Record<string, unknown> | undefined)?.[
      key
    ];

    if (typeof title === "string" && title.trim()) {
      return title;
    }
  }

  return drawnActionLabel(language, segment);
}

function drawnPath(language: string, segments: Array<string>): string {
  return segments
    .map((_segment: string, index: number): string => {
      return drawnPathSegment(language, segments, index);
    })
    .join(PATH_SEPARATOR);
}

/*
 * A label a page names, as that language draws it: the label itself, the
 * start of a longer drawn label, or the quoted half of a hint.
 */
function drawnName(language: string, english: string): string {
  if (english === RESET_HINT_PART) {
    return drawnActionLabel(language, RESET_HINT_KEY).replace(
      RESET_HINT_SEPARATOR,
      "",
    );
  }

  const longer: string | undefined = DRAWN_WITH_MORE[english];

  if (longer) {
    return drawnActionLabel(language, longer).replace(OPTION_DETAIL, "");
  }

  return drawnActionLabel(language, english);
}

/*
 * Whether a page names the label, bold: "**Pipelines**", or, for a field
 * lead, "**Pipelines:**" with the colon its language writes.
 */
function namesBold(
  markdown: string,
  drawn: string,
  isFieldLead: boolean,
): boolean {
  if (!isFieldLead) {
    return markdown.includes(`**${drawn}**`);
  }

  return new RegExp(`\\*\\*${escapeRegExp(drawn)}\\s?[:：]\\*\\*`).test(
    markdown,
  );
}

// The bold spans the label checks hold to the Dashboard, by page.
function checkedLabels(page: string): Array<string> {
  const proseWords: Array<string> = PROSE[page] || [];
  const permissionOnly: Array<string> = (PERMISSIONS[page] || []).filter(
    (name: string): boolean => {
      return !(ALSO_A_BUTTON[page] || []).includes(name);
    },
  );

  return boldLabels(englishPage(page)).filter((span: string): boolean => {
    const label: string = withoutFieldColon(span);

    return (
      (isActionLabel(label) ||
        label === RESET_HINT_PART ||
        DRAWN_WITH_MORE[label] !== undefined) &&
      !proseWords.includes(span) &&
      !permissionOnly.includes(span) &&
      !(PROSE_LEADS[page] || []).includes(span)
    );
  });
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
 * letter, as in "**（任意）**を", is not closed, and its asterisks show. An
 * underscore never closes inside a word, so "_之后_的" shows both.
 */
async function strayMarkers(
  markdown: string,
  language: string,
): Promise<Array<string>> {
  const html: string = await DocsRender.render(
    DocsPlaceholders.render(markdown.split("\n").slice(1).join("\n"), language),
  );

  return html
    .replace(RENDERED_CODE, "")
    .split("\n")
    .map((line: string): string => {
      return line.replace(HTML_TAG, "");
    })
    .filter((line: string): boolean => {
      return (
        line.includes("**") || line.replace(UNDERSCORED_NAME, "").includes("_")
      );
    });
}

// The components of a page, in order, with their tab and step counts.
function componentShape(markdown: string): Array<string> {
  return scanMarkdown(markdown).containers.map(
    (use: DocsContainerUse): string => {
      return `${use.name} tabs=${use.tabs.length} steps=${use.steps}`;
    },
  );
}

// The tab names of every :::tabs block, in order.
function tabNames(markdown: string): Array<string> {
  return prose(markdown)
    .split("\n")
    .map((line: string): string => {
      return TAB_LINE.exec(line.trim())?.[1]?.trim() || "";
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });
}

// The numbers a page's prose states, outside code, as Latin digits.
function numbersIn(markdown: string): Set<string> {
  const text: string = toLatinDigits(
    prose(markdown).replace(INLINE_CODE_SPAN, " "),
  )
    .replace(PERSIAN_DECIMAL_MARK, "$1.$2")
    .replace(THOUSANDS_SEPARATOR, "$1");

  return new Set(
    Array.from(text.matchAll(NUMBER), (match: RegExpMatchArray): string => {
      return match[0];
    }),
  );
}

// The headings of a page, in order.
function headings(markdown: string): Array<DocsHeading> {
  return scanMarkdown(markdown).headings;
}

/*
 * Where the processor types' own sections are among the English log
 * pipelines page's headings: "## Grok Parser" and the rest.
 */
function processorHeadingIndexes(): Array<{ index: number; name: string }> {
  return headings(englishPage(PIPELINES))
    .map((heading: DocsHeading, index: number) => {
      return { index: index, name: heading.text };
    })
    .filter((entry: { index: number; name: string }): boolean => {
      return PROCESSOR_TYPES.includes(entry.name);
    });
}

// The first cell of each body row of the first table of a section.
function firstColumnOfTableUnder(
  markdown: string,
  headingIndex: number,
): Array<string> {
  const scanned: ScannedPage = scanMarkdown(markdown);
  const start: number = (scanned.headings[headingIndex] as DocsHeading).line;
  const next: DocsHeading | undefined = scanned.headings[headingIndex + 1];
  const end: number = next ? next.line : scanned.lines.length + 1;
  const rows: Array<string> = scanned.lines
    .slice(start, end - 1)
    .filter((line: string): boolean => {
      return line.startsWith("|");
    });

  return rows.slice(2).map((row: string): string => {
    return (row.split("|")[1] || "").trim();
  });
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      PERMISSIONS,
      ALSO_A_BUTTON,
      SHOWN_IN_ENGLISH,
      PROSE,
      PROSE_LEADS,
      NUMBERS,
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
          ok: labels.includes(label) && isActionLabel(withoutFieldColon(label)),
        });
      }
    }
  });

  /*
   * A name the Dashboard shows in English today and translates tomorrow
   * fails here: then every translation names it as drawn, and it leaves the
   * list. The docs' own tab names are bold product names, never labels.
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

  it("keep in English only permissions Permission.ts titles, and bold on the English page", () => {
    const titles: Array<string> = PermissionHelper.getAllPermissionProps().map(
      (props: { title: string }): string => {
        return props.title;
      },
    );

    for (const page of Object.keys(PERMISSIONS)) {
      const spans: Array<string> = boldLabels(englishPage(page));

      for (const name of PERMISSIONS[page] as Array<string>) {
        const named: Array<string> = name.startsWith("Create / Edit ")
          ? [
              name.replace("Create / Edit ", "Create "),
              name.replace("Create / Edit ", "Edit "),
            ]
          : [name];

        expect({ page: page, name: name, bold: true }).toEqual({
          page: page,
          name: name,
          bold: spans.includes(name),
        });

        for (const title of named) {
          expect({ page: page, title: title, permission: true }).toEqual({
            page: page,
            title: title,
            permission: titles.includes(title),
          });
        }
      }
    }
  });

  it("know every bold word on the English pages: a label, shown in English, a permission, or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          const label: string = withoutFieldColon(span);

          return (
            !isActionLabel(label) &&
            label !== RESET_HINT_PART &&
            DRAWN_WITH_MORE[label] === undefined &&
            !(SHOWN_IN_ENGLISH[page] || []).includes(span) &&
            !(PERMISSIONS[page] || []).includes(span) &&
            !(PROSE_LEADS[page] || []).includes(span)
          );
        },
      );

      expect({ page: page, unlisted: unlisted }).toEqual({
        page: page,
        unlisted: [],
      });
    }
  });

  it("list as leads only bold words the English page has, and no labels", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const spans: Array<string> = boldLabels(englishPage(page));

      for (const lead of PROSE_LEADS[page] as Array<string>) {
        expect({ page: page, lead: lead, found: true, label: false }).toEqual({
          page: page,
          lead: lead,
          found: spans.includes(lead),
          label: isActionLabel(withoutFieldColon(lead)),
        });
      }
    }
  });

  it("know the hint, the optional field and the processor types the Dashboard draws", () => {
    expect(isActionLabel(RESET_HINT_KEY)).toBe(true);
    expect(boldLabels(englishPage(ZOOM))).toContain(RESET_HINT_PART);

    for (const longer of Object.values(DRAWN_WITH_MORE)) {
      expect(isActionLabel(longer)).toBe(true);
    }

    for (const type of PROCESSOR_TYPES) {
      expect(isActionLabel(type)).toBe(true);
    }

    expect(
      processorHeadingIndexes().map((entry: { name: string }): string => {
        return entry.name;
      }),
    ).toEqual([
      "Key=Value Parser",
      "Grok Parser",
      "Severity Remapper",
      "Attribute Remapper",
      "Category Processor",
    ]);
  });

  it("find plenty to check on every page", () => {
    for (const page of PAGE_NAMES) {
      expect({ page: page, labels: checkedLabels(page).length > 0 }).toEqual({
        page: page,
        labels: true,
      });
    }

    expect(checkedLabels(PIPELINES).length).toBeGreaterThanOrEqual(25);
    expect(checkedLabels(PROFILES).length).toBeGreaterThanOrEqual(20);
    expect(checkedLabels(RECORDING_RULES).length).toBeGreaterThanOrEqual(15);
  });

  it("state the numbers they list in the English prose", () => {
    for (const page of PAGE_NAMES) {
      const stated: Set<string> = numbersIn(englishPage(page));

      for (const number of NUMBERS[page] || []) {
        expect({ page: page, number: number, stated: true }).toEqual({
          page: page,
          number: number,
          stated: stated.has(number),
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
    "$page opens with cards to its own sections, and ends on a Next steps section of cards",
    (entry: TranslatedPage) => {
      const english: string = englishPage(entry.page);
      const scanned: ScannedPage = scanMarkdown(english);
      const last: DocsHeading = scanned.headings[
        scanned.headings.length - 1
      ] as DocsHeading;

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");

      const cards: Array<string> = cardLines(english);
      const inPage: Array<string> = cards.filter((line: string): boolean => {
        return line.includes("](#");
      });

      expect(inPage.length).toBeGreaterThanOrEqual(3);
      expect(cards.length).toBeGreaterThan(inPage.length);
    },
  );

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
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
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

    it("has the English page's headings, components, tables and list items", () => {
      const translated: string = readPage(language, entry.page);

      expect(
        headings(translated).map((heading: DocsHeading): number => {
          return heading.level;
        }),
      ).toEqual(
        headings(english).map((heading: DocsHeading): number => {
          return heading.level;
        }),
      );
      expect(componentShape(translated)).toEqual(componentShape(english));
      expect(scanMarkdown(translated).alerts).toEqual(
        scanMarkdown(english).alerts,
      );
      expect(tableShape(translated)).toEqual(tableShape(english));
      expect(listItemCount(translated)).toBe(listItemCount(english));
    });

    it("names its tabs as the English page does", () => {
      expect(tabNames(readPage(language, entry.page))).toEqual(
        tabNames(english),
      );
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

    it("states every number the English page states", () => {
      const stated: Set<string> = numbersIn(readPage(language, entry.page));
      const missing: Array<string> = (NUMBERS[entry.page] || []).filter(
        (number: string): boolean => {
          return !stated.has(number);
        },
      );

      expect(missing).toEqual([]);
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = checkedLabels(entry.page)
        .filter((span: string): boolean => {
          const label: string = withoutFieldColon(span);

          return !namesBold(
            translated,
            drawnName(language, label),
            label !== span,
          );
        })
        .map((span: string): string => {
          return `${span} -> ${drawnName(language, withoutFieldColon(span))}`;
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .map((segments: Array<string>): string => {
          return drawnPath(language, segments);
        })
        .filter((localized: string): boolean => {
          return !translated.includes(`**${localized}**`);
        });

      expect(missing).toEqual([]);
    });

    it("names in English what every Dashboard shows in English, and every permission", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...(SHOWN_IN_ENGLISH[entry.page] || []),
        ...(PERMISSIONS[entry.page] || []),
      ].filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });
  });

  it("names each log pipeline processor type as the Processor Type picker draws it, in its heading and in the table", () => {
    const translated: string = readPage(language, PIPELINES);
    const translatedHeadings: Array<DocsHeading> = headings(translated);

    for (const entry of processorHeadingIndexes()) {
      expect({
        type: entry.name,
        heading: translatedHeadings[entry.index]?.text,
      }).toEqual({
        type: entry.name,
        heading: drawnActionLabel(language, entry.name),
      });
    }

    // The Processor Types table, under the section that lists them.
    const tableHeading: number = headings(englishPage(PIPELINES)).findIndex(
      (heading: DocsHeading): boolean => {
        return heading.text === "Processor Types";
      },
    );

    expect(firstColumnOfTableUnder(translated, tableHeading)).toEqual(
      firstColumnOfTableUnder(englishPage(PIPELINES), tableHeading).map(
        (type: string): string => {
          return drawnActionLabel(language, type);
        },
      ),
    );
  });

  it("links from the recording rules page to the Key=Value Parser's own section", () => {
    const pipelines: Array<DocsHeading> = headings(
      readPage(language, PIPELINES),
    );
    const keyValue: DocsHeading | undefined = pipelines.find(
      (heading: DocsHeading): boolean => {
        return heading.text === "Key=Value Parser";
      },
    );

    expect(keyValue?.slug).toBe("keyvalue-parser");
    expect(readPage(language, RECORDING_RULES)).toContain(
      "(/docs/telemetry/log-pipelines#keyvalue-parser)",
    );
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add menu paths through the Products menu, field leads, labels drawn with
 * more than the page names, and the numbers the prose states.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Logs → Settings → Pipelines** and **Create Log Pipeline**";

    expect(menuPaths(markdown)).toEqual([["Logs", "Settings", "Pipelines"]]);
    expect(boldLabels(markdown)).toEqual(["Create Log Pipeline"]);
  });

  it("draw a product after Products as the Products menu does, the rest as labels", () => {
    expect(drawnPath("de", ["Products", "Performance Profiles"])).toBe(
      "Produkte → Performance-Profile",
    );
    expect(drawnActionLabel("de", "Performance Profiles")).toBe(
      "Leistungsprofile",
    );
    // Not after Products: a label like any other.
    expect(drawnPath("de", ["Logs", "Settings", "Pipelines"])).toBe(
      "Protokolle → Einstellungen → Pipelines",
    );
    expect(drawnPath("en", ["Products", "Performance Profiles"])).toBe(
      "Products → Performance Profiles",
    );
  });

  it("name a field lead by its label and a colon, in the language's own way", () => {
    expect(namesBold("- **Nom :** SD-WAN", "Nom", true)).toBe(true);
    expect(namesBold("- **名前：** SD-WAN", "名前", true)).toBe(true);
    expect(namesBold("- **Name:** SD-WAN", "Name", true)).toBe(true);
    expect(namesBold("- **Name** SD-WAN", "Name", true)).toBe(false);
    expect(namesBold("click **Name**", "Name", false)).toBe(true);
  });

  it("name an optional field by the start of its drawn label, and the reset hint by its half", () => {
    expect(drawnName("ja", "Target Prefix")).toBe("ターゲットのプレフィックス");
    expect(drawnName("de", "Target Prefix")).toBe("Zielpräfix");
    expect(drawnName("en", "Target Prefix")).toBe("Target Prefix");
    expect(drawnName("de", RESET_HINT_PART)).toBe(
      "Doppelklick zum Zurücksetzen",
    );
    expect(drawnName("en", RESET_HINT_PART)).toBe(RESET_HINT_PART);
  });

  it("read the numbers prose states, however a language groups and writes them", () => {
    expect(
      Array.from(numbersIn("Werte über 4.096 Zeichen; `8 KiB` ist Code.")),
    ).toEqual(["4096"]);
    expect(Array.from(numbersIn("au plus 1 000 séries"))).toEqual([
      "1000",
    ]);
    expect(Array.from(numbersIn("حداکثر ۱٬۰۰۰ سری و نسخه ۱٫۵"))).toEqual([
      "1000",
      "1.5",
    ]);
    // A version keeps its point: 1.5 is not a thousand.
    expect(Array.from(numbersIn("from v0.14 and 1.5"))).toEqual(["0.14", "1.5"]);
  });

  it("find a line whose code span is closed by asterisks", () => {
    const broken: string = "**Source Field** / `body** in the log";
    const whole: string = "**Source Field** / `body` in the log";

    expect(unbalancedLines(broken)).toEqual([broken]);
    expect(unbalancedLines(whole)).toEqual([]);
    expect(unbalancedLines("Use `a ** b` here.")).toEqual([]);
  });

  it("find asterisks the renderer leaves when a bold span runs into a letter", async () => {
    expect(
      await strayMarkers("# Title\n\n**ターゲット（任意）**を設定します。", "ja"),
    ).toHaveLength(1);
    expect(
      await strayMarkers("# Title\n\n**ターゲット（任意）** を設定します。", "ja"),
    ).toEqual([]);
  });

  it("find underscores the renderer leaves when an italic span sits inside a word", async () => {
    expect(
      await strayMarkers("# Title\n\n名为_SD-WAN gateway latency_的规则。", "zh-CN"),
    ).toHaveLength(1);
    expect(
      await strayMarkers("# Title\n\n名为 *SD-WAN gateway latency* 的规则。", "zh-CN"),
    ).toEqual([]);
  });

  it("read a page's tabs and components, with their tab and step counts", () => {
    const markdown: string = [
      "# Page",
      ":::tabs",
      "@tab Grafana Alloy",
      "Text.",
      "@tab Go",
      "```go",
      "@tab not a tab",
      "```",
      ":::",
      ":::steps",
      "### One",
      "### Two",
      ":::",
    ].join("\n");

    expect(tabNames(markdown)).toEqual(["Grafana Alloy", "Go"]);
    expect(componentShape(markdown)).toEqual([
      "tabs tabs=2 steps=0",
      "steps tabs=0 steps=2",
    ]);
  });

  it("read the first column of the table under a heading", () => {
    const markdown: string = [
      "# Page",
      "## Processor Types",
      "",
      "| Processor | What it does |",
      "| --- | --- |",
      "| Grok Parser | Pulls fields. |",
      "| Key=Value Parser | Splits pairs. |",
      "",
      "## Next",
    ].join("\n");

    expect(firstColumnOfTableUnder(markdown, 1)).toEqual([
      "Grok Parser",
      "Key=Value Parser",
    ]);
  });

  it("compare a flowchart by its nodes and arrows, not its words", () => {
    const englishChart: string = [
      "flowchart TB",
      '    arrive["Log arrives"] --> drop{"Matches a drop filter?"}',
    ].join("\n");
    const translatedChart: string = [
      "flowchart TB",
      '    arrive["Log trifft ein"] --> drop{"Passt ein Drop-Filter?"}',
    ].join("\n");
    const rewired: string = [
      "flowchart TB",
      '    drop{"Passt ein Drop-Filter?"} --> arrive["Log trifft ein"]',
    ].join("\n");

    expect(diagramSkeleton(translatedChart)).toBe(diagramSkeleton(englishChart));
    expect(diagramSkeleton(rewired)).not.toBe(diagramSkeleton(englishChart));
  });
});
