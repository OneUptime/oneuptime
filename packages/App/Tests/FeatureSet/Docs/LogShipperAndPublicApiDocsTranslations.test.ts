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
  toLatinDigits,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 12: the log shipper pages (Serilog, Fluent Bit,
 * Fluentd, Syslog) and the status page Public API page, in every docs
 * language. Each translation says what the English page says - the same
 * sections, steps, tables, lists, cards, code and diagrams, links that land
 * on the heading the English link means, a title that is the nav link's -
 * and names the Dashboard the way that language's Dashboard draws it.
 *
 *   - A bold Dashboard label is drawnActionLabel (DocsDashboardLabels): the
 *     label's value in that language's Dashboard locale, Persian included,
 *     or the Create template filled with the item's name, the way the
 *     Ingestion Keys table draws its Create Ingestion Key button.
 *   - A menu path ("Products → Project Settings") is drawn segment by
 *     segment.
 *   - The display card's "Show the last N days" sentence is a template
 *     (TEMPLATES): a translation words it as its locale does, with the
 *     page's "…" for the number.
 *   - Bold words that are neither labels nor templates are the pages' own
 *     leads (PROSE_LEADS), which a translation words freely. A new bold
 *     name on these pages fails below until it is put in a list.
 *
 * The four shippers are named after the tools they set up, so their nav
 * titles (BRAND_TITLES) read the same in every language; the Public API
 * page's title is translated.
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

const SERILOG: string = "telemetry/serilog";
const FLUENT_BIT: string = "telemetry/fluentbit";
const FLUENTD: string = "telemetry/fluentd";
const SYSLOG: string = "telemetry/syslog";
const PUBLIC_API: string = "status-pages/public-api";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: SERILOG, navTitle: "Serilog (.NET)" },
  { page: FLUENT_BIT, navTitle: "Fluent Bit" },
  { page: FLUENTD, navTitle: "Fluentd" },
  { page: SYSLOG, navTitle: "Syslog" },
  { page: PUBLIC_API, navTitle: "Public API" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// The nav titles that are a tool's own name, the same in every language.
const BRAND_TITLES: Array<string> = [
  "Serilog (.NET)",
  "Fluent Bit",
  "Fluentd",
  "Syslog",
];

const SHIPPER_PAGES: Array<string> = [SERILOG, FLUENT_BIT, FLUENTD, SYSLOG];

// Tab labels that name a tool or a file, which no language translates.
const TOOL_TABS: Array<string> = [
  "curl",
  "Node.js",
  "Python",
  "appsettings.json",
  "ASP.NET Core",
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
  [PUBLIC_API]: [
    {
      // The display card's days sentence, under each list's switch.
      english: "Show the last … days",
      key: "Show the last {{count}} days",
      values: { count: "…" },
    },
  ],
};

/*
 * The bold leads of the pages' own lists and sentences. They are not
 * Dashboard labels, so a translation words them freely; listing them makes
 * a new bold name on these pages fail below until it is put in a list.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [FLUENT_BIT]: [
    "Install Fluent Bit",
    "A OneUptime project.",
    "A telemetry ingestion key.",
  ],
  [FLUENTD]: [
    "Install Fluentd",
    "A OneUptime project.",
    "A telemetry ingestion key.",
  ],
  [SYSLOG]: [
    "A OneUptime project",
    "Telemetry ingestion key",
    "Syslog forwarder",
    "Service name (optional)",
    // A tool's name, which leads its own list item.
    "syslog-ng",
  ],
  [PUBLIC_API]: [
    "The status page ID.",
    "The base URL.",
    "Which incidents a page returns.",
    "RSS.",
    "llms.txt.",
    "MCP.",
    "The REST API.",
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * the English page uses them, which a translation words as its language
 * needs. None on these pages: every bold label names what is on screen.
 */
const PROSE: Record<string, Array<string>> = {};

/*
 * The limits and defaults the pages give in their text rather than in code:
 * Fluentd's 10-second flush, and the status page API's 14-day lists,
 * 15-second overview and 90-day uptime range. A translation writes each as
 * often as the English page does, in its own digits (the Persian pages
 * write Persian ones). The 1 MB the Syslog and Fluentd pages give is not
 * held here: several languages write "one" as 1 ("1 つのリクエスト"), so the
 * count says nothing; the facts suite holds it to the ingress instead.
 */
const PROSE_NUMBERS: Record<string, Array<string>> = {
  [FLUENTD]: ["10"],
  [PUBLIC_API]: ["14", "15", "90"],
};

// A number written on its own, not inside a longer number or a word.
const STANDALONE_NUMBER: RegExp = /(?<![\d.,])\d+(?![\d.,]\d)/g;

// How many times a page's text, outside code, writes this number.
function proseNumberCount(markdown: string, number: string): number {
  const text: string = toLatinDigits(
    prose(markdown).replace(INLINE_CODE_SPAN, ""),
  );

  return Array.from(text.matchAll(STANDALONE_NUMBER)).filter(
    (match: RegExpMatchArray): boolean => {
      return match[0] === number;
    },
  ).length;
}

const PATH_SEPARATOR: string = " → ";

// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;

// Code in rendered HTML: a code block or an inline code span.
const RENDERED_CODE: RegExp = /<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/g;

// A Mermaid diagram's fenced source.
const MERMAID_BLOCK: RegExp =
  /^ {0,3}```mermaid[^\n]*\n[\s\S]*?^ {0,3}```[^\n]*$/gm;

function englishPage(page: string): string {
  return readPage("en", page);
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

/*
 * What one lookup of a locale key draws: the locale's wording, or the
 * English where it has none.
 */
function flatLabel(language: string, english: string): string {
  const value: unknown = dashboardLocale(language)[english];

  return typeof value === "string" && value.trim() ? value : english;
}

// A template label as this language's locale draws it, with the page's placeholders.
function drawnTemplate(language: string, entry: TemplateLabel): string {
  return fillPlaceholders(flatLabel(language, entry.key), entry.values);
}

/*
 * HTML with its tags taken out, by walking it once: everything from a "<"
 * to the next ">" is a tag. A single pass of a tag pattern can leave a new
 * tag behind ("<scr<b>ipt>"); this reads every character once and never
 * re-joins what it skipped.
 */
export function withoutHtmlTags(html: string): string {
  let text: string = "";
  let inTag: boolean = false;

  for (const character of html) {
    if (inTag) {
      inTag = character !== ">";
      continue;
    }

    if (character === "<") {
      inTag = true;
      continue;
    }

    text += character;
  }

  return text;
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
 * underscores. Code is left out (`x-oneuptime-token` is code, not
 * emphasis), and so are diagrams, which Markdown never reads.
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
      return withoutHtmlTags(line);
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

// The :::details summaries of a page, in order.
function detailsCount(markdown: string): number {
  return prose(markdown)
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith(":::details ");
    }).length;
}

// The headings of a page below its title, in order.
function sections(markdown: string): Array<DocsHeading> {
  return scanMarkdown(markdown).headings.filter(
    (heading: DocsHeading): boolean => {
      return heading.line !== 1;
    },
  );
}

function headingLevels(markdown: string): Array<number> {
  return sections(markdown).map((heading: DocsHeading): number => {
    return heading.level;
  });
}

/*
 * The anchor of the heading of a page in a language that sits where the
 * English page's heading with this anchor sits, or null when the English
 * page has no such heading.
 *
 * A page whose translation keeps the English page's headings is read by
 * position. One whose translation predates its English page's rewrite
 * (status-pages/index, until docs task 18b translates it again) is read by
 * its H2s: the sections these pages link to are H2s that its old
 * translation has in the same order.
 */
function anchorInLanguage(
  language: string,
  page: string,
  englishAnchor: string,
): string | null {
  const englishMarkdown: string = englishPage(page);
  const english: Array<DocsHeading> = sections(englishMarkdown);
  const index: number = english.findIndex((heading: DocsHeading): boolean => {
    return heading.slug === englishAnchor;
  });

  if (index < 0) {
    return null;
  }

  if (!hasPage(language, page)) {
    return englishAnchor;
  }

  const translatedMarkdown: string = readPage(language, page);
  const translated: Array<DocsHeading> = sections(translatedMarkdown);
  const inShape: boolean =
    JSON.stringify(headingLevels(translatedMarkdown)) ===
    JSON.stringify(headingLevels(englishMarkdown));

  if (inShape) {
    return translated[index]?.slug || null;
  }

  const target: DocsHeading = english[index] as DocsHeading;

  if (target.level !== 2) {
    return null;
  }

  const ordinal: number = english
    .filter((heading: DocsHeading): boolean => {
      return heading.level === 2;
    })
    .indexOf(target);

  return (
    translated.filter((heading: DocsHeading): boolean => {
      return heading.level === 2;
    })[ordinal]?.slug || null
  );
}

/*
 * The links of a page that name a heading, as "page#anchor", in order: its
 * own sections (cards, "see") and the sections of other pages.
 */
function anchorLinks(page: string, markdown: string): Array<string> {
  return scanMarkdown(markdown)
    .links.map((link: DocsLink): string | null => {
      if (link.target.startsWith("#")) {
        return `${page}${decodeURIComponent(link.target)}`;
      }

      const target: { page: string; anchor: string | null } | null =
        parseDocsLink(link.target);

      if (!target || !target.anchor) {
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
    for (const lists of [TEMPLATES, PROSE, PROSE_LEADS, PROSE_NUMBERS]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("hold only numbers the English text gives", () => {
    for (const page of Object.keys(PROSE_NUMBERS)) {
      for (const number of PROSE_NUMBERS[page] as Array<string>) {
        expect({
          page,
          number,
          given: proseNumberCount(englishPage(page), number) > 0,
        }).toEqual({ page, number, given: true });
      }
    }
  });

  it("call prose only bold Dashboard labels the English page has", () => {
    for (const page of Object.keys(PROSE)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const label of PROSE[page] as Array<string>) {
        expect({ page, label, ok: true }).toEqual({
          page,
          label,
          ok: labels.includes(label) && isActionLabel(label),
        });
      }
    }
  });

  it("list as leads only bold words the English page has, none of them a Dashboard label", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const spans: Array<string> = boldLabels(englishPage(page));

      for (const lead of PROSE_LEADS[page] as Array<string>) {
        expect({ page, lead, found: true, label: false }).toEqual({
          page,
          lead,
          found: spans.includes(lead),
          label: isActionLabel(lead),
        });
      }
    }
  });

  it("name templates the locale has, as the English page bolds them", () => {
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
  });

  it("know every bold word on the English pages: a label, a template or a lead", () => {
    for (const page of PAGE_NAMES) {
      const known: Array<string> = [
        ...(PROSE_LEADS[page] || []),
        ...(TEMPLATES[page] || []).map((entry: TemplateLabel): string => {
          return entry.english;
        }),
      ];
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !isActionLabel(span) && !known.includes(span);
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("find plenty to check", () => {
    let labels: number = 0;

    for (const page of PAGE_NAMES) {
      const onPage: number =
        boldLabels(englishPage(page)).filter((label: string): boolean => {
          return isActionLabel(label);
        }).length + boldPaths(englishPage(page)).length;

      expect({ page, enough: onPage >= 5 }).toEqual({ page, enough: true });

      labels += onPage;
    }

    expect(labels).toBeGreaterThanOrEqual(40);
  });

  it("name every menu path's parts as Dashboard labels", () => {
    for (const page of PAGE_NAMES) {
      for (const segments of boldPaths(englishPage(page))) {
        for (const segment of segments) {
          expect({ page, segment, label: isActionLabel(segment) }).toEqual({
            page,
            segment,
            label: true,
          });
        }
      }
    }
  });

  it("keep the shippers' nav titles as the tools name themselves, in every language", () => {
    for (const title of BRAND_TITLES) {
      for (const language of LANGUAGES) {
        expect({ language, title: navTitle(language, title) }).toEqual({
          language,
          title,
        });
      }
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: TranslatedPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
    expect(navTitle("en", entry.navTitle)).toBe(entry.navTitle);
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

  it.each(PAGES.filter((entry: TranslatedPage): boolean => {
    return entry.page !== PUBLIC_API;
  }))(
    "$page has a Troubleshooting section of folded answers before Next steps",
    (entry: TranslatedPage) => {
      const markdown: string = englishPage(entry.page);
      const headings: Array<string> = sections(markdown).map(
        (heading: DocsHeading): string => {
          return `${"#".repeat(heading.level)} ${heading.text}`;
        },
      );

      expect(headings).toContain("## Troubleshooting");
      expect(headings.indexOf("## Troubleshooting")).toBeLessThan(
        headings.indexOf("## Next steps"),
      );
      expect(detailsCount(markdown)).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  /*
   * A shipper is set up in steps. The Public API page is a reference: its
   * one procedure is a single request, shown per language in tabs.
   */
  it.each(SHIPPER_PAGES)("%s walks its setup in steps", (page: string) => {
    expect(stepCount(englishPage(page))).toBeGreaterThanOrEqual(3);
  });

  it("shows the Public API page's requests in curl, Node.js and Python", () => {
    const tabs: Array<Array<string>> = scanMarkdown(englishPage(PUBLIC_API))
      .containers.filter((container: { name: string }): boolean => {
        return container.name === "tabs";
      })
      .map((container: { tabs: Array<string> }): Array<string> => {
        return container.tabs;
      });

    expect(tabs.length).toBeGreaterThanOrEqual(3);

    for (const labels of tabs) {
      expect(labels).toEqual(["curl", "Node.js", "Python"]);
    }
  });

  /*
   * Every shipper sends with an ingestion key, so each one says how to get
   * one, and what the refusals for a key and a plan mean.
   */
  it.each(SHIPPER_PAGES)(
    "%s names the ingestion key it sends, and the 401, 402 and 422 answers",
    (page: string) => {
      const markdown: string = englishPage(page);

      expect(markdown).toContain("**Secret Key**");
      expect(markdown).toContain("`x-oneuptime-token`");
      expect(markdown).toContain(
        "**Products → Project Settings",
      );
      expect(markdown).toContain(
        "a project on the Free plan needs a payment method before it can send telemetry",
      );
      expect(markdown).toContain("missing, unknown or expired");
      expect(markdown).toContain(
        "`402`: on OneUptime Cloud, the project is on the Free plan and has no payment method.",
      );
      expect(markdown).toContain(
        "`422`: the key is disabled, or it is a Browser key.",
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
      expect(translated.split("\n")[0]).toBe(`# ${title}`);

      if (!BRAND_TITLES.includes(entry.navTitle)) {
        expect(title).not.toBe(entry.navTitle);
      }
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

    it("has the English page's headings, steps, folded answers, tables and list items", () => {
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
      expect(detailsCount(translated)).toBe(detailsCount(english));
      expect(tableShape(translated)).toEqual(tableShape(english));
      expect(listItemCount(translated)).toBe(listItemCount(english));
    });

    /*
     * A tab named after a tool or a file keeps its name, so a reader's pick
     * carries over to every page with the same tab (the docs remember it by
     * label).
     */
    it("keeps the tabs named after a tool or a file as they are named", () => {
      const tabsOf: (markdown: string) => Array<Array<string>> = (
        markdown: string,
      ): Array<Array<string>> => {
        return scanMarkdown(markdown)
          .containers.filter((container: { name: string }): boolean => {
            return container.name === "tabs";
          })
          .map((container: { tabs: Array<string> }): Array<string> => {
            return container.tabs;
          });
      };
      const englishTabs: Array<Array<string>> = tabsOf(english);
      const translatedTabs: Array<Array<string>> = tabsOf(
        readPage(language, entry.page),
      );

      expect(translatedTabs.length).toBe(englishTabs.length);

      englishTabs.forEach((labels: Array<string>, index: number): void => {
        expect(
          (translatedTabs[index] || []).filter(
            (_label: string, at: number): boolean => {
              return TOOL_TABS.includes(labels[at] as string);
            },
          ),
        ).toEqual(
          labels.filter((label: string): boolean => {
            return TOOL_TABS.includes(label);
          }),
        );
      });
    });

    /*
     * A step heading and a section heading can translate to the same words
     * ("Configurer le sink" twice) and then share one anchor.
     */
    it("gives every heading an anchor of its own", () => {
      const slugs: Array<string> = sections(readPage(language, entry.page)).map(
        (heading: DocsHeading): string => {
          return heading.slug;
        },
      );

      expect(
        slugs.filter((slug: string, index: number): boolean => {
          return slugs.indexOf(slug) !== index;
        }),
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

    it("titles its cards to other pages as those pages' nav links", () => {
      const translated: Array<string> = cardLines(
        readPage(language, entry.page),
      );

      cardLines(english).forEach((line: string, index: number): void => {
        const target: string = cardTargets([line])[0] as string;

        if (!target.startsWith("/docs/")) {
          return;
        }

        const englishTitle: string = (line.match(/^- \[([^\]]+)\]/)?.[1] ||
          "") as string;
        const translatedTitle: string = ((translated[index] || "").match(
          /^- \[([^\]]+)\]/,
        )?.[1] || "") as string;
        const localized: string | undefined = navTitle(language, englishTitle);

        if (localized === undefined) {
          // A card titled for what it links to, not the page's nav title.
          return;
        }

        expect({ target, title: translatedTitle }).toEqual({
          target,
          title: localized,
        });
      });
    });

    it("links only to anchors that are headings of the page they open", () => {
      expect(anchorProblems(language, entry.page)).toEqual([]);
    });

    it("points every link at the heading the English link means", () => {
      const expected: Array<string> = anchorLinks(entry.page, english).map(
        (link: string): string => {
          const [page, anchor] = link.split("#") as [string, string];

          return `${page}#${anchorInLanguage(language, page, anchor) || "?"}`;
        },
      );

      expect(anchorLinks(entry.page, readPage(language, entry.page))).toEqual(
        expected,
      );
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const exceptions: Array<string> = PROSE[entry.page] || [];
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

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = boldPaths(english)
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

    it("words the templates as this language's locale does", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = (TEMPLATES[entry.page] || [])
        .map((template: TemplateLabel): string => {
          return drawnTemplate(language, template);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(`**${drawn}**`);
        });

      expect(missing).toEqual([]);
    });

    it("keeps the limits and defaults the English text gives, in its own digits", () => {
      const translated: string = readPage(language, entry.page);

      for (const number of PROSE_NUMBERS[entry.page] || []) {
        expect({ number, times: proseNumberCount(translated, number) }).toEqual({
          number,
          times: proseNumberCount(english, number),
        });
      }
    });
  });
});

describe("the helpers, on these pages' shapes", () => {
  it("strip HTML tags by walking the text once, leaving no tag rebuilt from the pieces", () => {
    expect(withoutHtmlTags("<p>One <strong>two</strong></p>")).toBe("One two");
    expect(withoutHtmlTags("<scr<b>ipt>alert(1)</scr</b>ipt>")).toBe(
      "ipt>alert(1)ipt>",
    );
    expect(withoutHtmlTags("<scr<b>ipt>")).not.toContain("<script>");
    expect(withoutHtmlTags("a < b")).toBe("a ");
  });

  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Products → Project Settings**, **Secret Key** and **AI → MCP**";

    expect(boldPaths(markdown)).toEqual([
      ["Products", "Project Settings"],
      ["AI", "MCP"],
    ]);
    expect(boldLabels(markdown)).toEqual(["Secret Key"]);
  });

  it("fill a template with the page's placeholders", () => {
    expect(
      fillPlaceholders("Show the last {{count}} days", { count: "…" }),
    ).toBe("Show the last … days");
    expect(
      drawnTemplate("de", {
        english: "Show the last … days",
        key: "Show the last {{count}} days",
        values: { count: "…" },
      }),
    ).toBe("Die letzten … Tage anzeigen");
  });

  it("count the steps of every :::steps block, and the folded answers", () => {
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
      ":::details Why?",
      "Because.",
      ":::",
    ].join("\n");

    expect(stepCount(markdown)).toBe(2);
    expect(detailsCount(markdown)).toBe(1);
  });

  it("read a heading of a page whose translation predates its English page by its H2s", () => {
    // German status-pages/index is still in its old shape.
    expect(
      anchorInLanguage(
        "de",
        "status-pages/index",
        "restricting-who-can-see-the-page",
      ),
    ).toBe("einschränken-wer-die-seite-sehen-darf");
    expect(
      anchorInLanguage(
        "de",
        "status-pages/index",
        "the-embeddable-badge-and-the-rss-feed",
      ),
    ).toBe("das-einbettbare-badge-und-der-rss-feed");
  });

  it("read a heading of a page whose translation keeps its English shape by position", () => {
    expect(
      anchorInLanguage("de", "telemetry/open-telemetry", "quickstart"),
    ).toBe("schnellstart");
  });

  it("find the links that name a heading, in order", () => {
    const markdown: string = [
      "# Serilog (.NET)",
      "See [Exceptions](#exceptions) and [Exceptions from logs](/docs/telemetry/open-telemetry#exceptions-from-logs).",
      "A [page](/docs/telemetry/log-pipelines).",
    ].join("\n");

    expect(anchorLinks(SERILOG, markdown)).toEqual([
      "telemetry/serilog#exceptions",
      "telemetry/open-telemetry#exceptions-from-logs",
    ]);
  });

  it("find asterisks the renderer leaves when a bold span ends in punctuation and runs into a letter", async () => {
    expect(
      await strayMarkers("# Title\n\n- **请求体。**发送。", "zh-CN"),
    ).toHaveLength(1);
    expect(
      await strayMarkers("# Title\n\n- **请求体。** 发送。", "zh-CN"),
    ).toEqual([]);
  });
});
