import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsHeading,
  DocsLink,
  anchorsOf,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  drawnActionLabel,
  drawnCreateButton,
  drawnDashboardLabel,
  isActionLabel,
} from "./DocsDashboardLabels";
import {
  boldLabels,
  boldPaths,
  lineShape,
  stepCount,
  tabLabels,
  tables,
  unbalancedLines,
} from "./DocsPageShape";
import {
  drawnMenuGroup,
  drawnMenuItem,
  drawnPath,
  drawnPathSegment,
} from "./DocsProductsMenu";
import {
  CARD_LINE,
  anchorProblems,
  cardLines,
  cardTargets,
  comparableFence,
  diagramLabelLines,
  inlineCode,
  labelLineWidth,
  linesLaidOutBackwards,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { anchorInLanguage } from "./NetworkDocsLabels";
import {
  BROWSER_SETUP,
  CREATE_BUTTONS,
  KEPT_AS_WRITTEN,
  MOBILE_SETUP,
  PROSE,
  RUM_INDEX,
  RUM_SETUP_PAGES,
  RumDocsPageEntry,
  WEB_VITALS,
} from "./RumDocsPages";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 25a: the RUM Overview, Browser Setup, Mobile Setup and
 * Core Web Vitals pages, in every docs language. RumDocsFacts holds the
 * English pages to the product; this suite holds each translation to its
 * English page:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and tab on the English one's line, so a later
 *     English edit shows where it lands in every language;
 *   - the same code, diagrams (by their nodes and arrows, with label lines
 *     short enough for the 590px docs column), inline code, tables and the
 *     numbers of their rows, lists, steps, tabs and cards, and every link on
 *     the English one's line, its anchor naming the heading in the English
 *     heading's place;
 *   - every line of prose translated, and a title that is the nav link's.
 *
 * And it names the Dashboard the way that language's Dashboard draws it,
 * Persian included: a bold label by drawnActionLabel, the Telemetry
 * Ingestion Keys table's create button by drawnCreateButton, and a menu path
 * segment by segment (drawnPath: one bold span joined by " → "; in Persian a
 * bold span per segment joined by " > ", with no "→" left in the prose). A
 * path through the Products menu draws its group and product from the
 * menu's own keys (DocsProductsMenu). What every Dashboard draws in English
 * stays English (KEPT_AS_WRITTEN in RumDocsPages), and a bold word that is
 * emphasis is translated freely (PROSE). A new bold word on these English
 * pages fails "know every bold word" until it is a Dashboard label or listed.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE_NAMES: Array<string> = RUM_SETUP_PAGES.map(
  (entry: RumDocsPageEntry): string => {
    return entry.page;
  },
);

/*
 * Each page's diagrams fit the 590px docs column, measured in a browser with
 * the docs' own font, in every language: their label lines are broken
 * (<br/>) to be no wider than this, counting a Chinese, Japanese or Korean
 * character twice. Each cap is the widest line the 17 languages drew when
 * they were measured. A label put back on one line runs its diagram off the
 * column, and the docs scroll it rather than shrink it.
 */
const WIDEST_DIAGRAM_LINE: Record<string, number> = {
  [RUM_INDEX]: 30,
  [BROWSER_SETUP]: 30,
  [MOBILE_SETUP]: 30,
  [WEB_VITALS]: 30,
};

/*
 * Tab labels that are a platform's or a library's name, kept as written so
 * a reader's pick follows them from page to page; the other tab labels are
 * words, which a translation translates.
 */
const NAME_TABS: ReadonlyArray<string> = [
  "Android",
  "iOS",
  "React Native",
  "Vue Router",
  "React Router",
];

/*
 * Names a translation writes as the English does, in prose too: products,
 * platforms, browsers, the web standard a heading is named after, and the
 * vitals' own names, which Google's tools and most translations keep in
 * English. A line made of them alone is not a line left untranslated.
 */
const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime",
  "OpenTelemetry",
  "React Native",
  "Core Web Vitals",
  "Content Security Policy",
  "Chromium",
  "Safari",
  "Firefox",
  "Android",
  "Largest Contentful Paint",
  "Interaction to Next Paint",
  "Cumulative Layout Shift",
  "First Contentful Paint",
  "Time to First Byte",
];

/*
 * The Dashboard words a collapsible entry's title quotes, by page, in the
 * order the English titles name them: the Products menu's "Services", the
 * product, its Clients page and status, and the vitals card's empty state.
 * Each is drawn as that language's Dashboard draws it.
 */
const DETAILS_WORDS: Record<
  string,
  Array<{ english: string; drawn: (language: string) => string }>
> = {
  [BROWSER_SETUP]: [
    {
      english: "Services",
      drawn: (language: string): string => {
        return drawnMenuItem(language, "Services");
      },
    },
    {
      english: "Real User Monitoring",
      drawn: (language: string): string => {
        return drawnMenuItem(language, "Real User Monitoring");
      },
    },
    {
      english: "Clients",
      drawn: (language: string): string => {
        return drawnDashboardLabel(language, "Clients");
      },
    },
  ],
  [MOBILE_SETUP]: [
    {
      english: "Services",
      drawn: (language: string): string => {
        return drawnMenuItem(language, "Services");
      },
    },
    {
      english: "Real User Monitoring",
      drawn: (language: string): string => {
        return drawnMenuItem(language, "Real User Monitoring");
      },
    },
    {
      english: "Clients",
      drawn: (language: string): string => {
        return drawnDashboardLabel(language, "Clients");
      },
    },
    {
      english: "Disconnected",
      drawn: (language: string): string => {
        return drawnDashboardLabel(language, "Disconnected");
      },
    },
  ],
  [WEB_VITALS]: [
    {
      english: "No web vitals reported yet",
      drawn: (language: string): string => {
        return drawnDashboardLabel(language, "No web vitals reported yet");
      },
    },
  ],
};

const ONLY_CODE: RegExp = /^`[^`]+`$/;
/*
 * A number as a table states it: 5, 1.5. A translation may write its
 * language's decimal mark or digit group.
 */
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
// \s takes the no-break spaces French and others group digits with.
const DIGIT_GROUP: RegExp = /(\d)[\s.,'٬](\d{3})(?!\d)/g;
const DECIMAL_MARK: RegExp = /(\d)[,٫](\d)/g;
const RIGHT_ARROW: string = "→";
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const LINK_TARGET: RegExp = /\]\([^)\s]*\)/g;
// A word of four Latin letters or more: what an untranslated line is made of.
const LATIN_WORD: RegExp = /[A-Za-z]{4,}/g;
const FENCE_LINE: RegExp = /^\s*```/;
const DETAILS_LINE: string = ":::details ";

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed(
  lists: Readonly<Record<string, ReadonlyArray<string>>>,
  page: string,
): Array<string> {
  return [...(lists[page] || [])];
}

// Whether a list accounts for a bold English word on a page.
function accountedFor(page: string, span: string): boolean {
  return (
    listed(KEPT_AS_WRITTEN, page).includes(span) ||
    listed(CREATE_BUTTONS, page).includes(span) ||
    listed(PROSE, page).includes(span)
  );
}

/*
 * The Dashboard labels a page names that drawnActionLabel draws: every bold
 * label but the ones a list draws, keeps or translates freely.
 */
function dashboardLabels(page: string): Array<string> {
  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    return isActionLabel(label) && !accountedFor(page, label);
  });
}

/*
 * Every bold label, create button and menu path of the English page, as the
 * English page writes it and as a page in the language must:
 * [English bold, drawn bold]. A Persian path is one bold span per segment.
 */
function englishBoldDrawings(
  language: string,
  page: string,
): Array<[string, string]> {
  return [
    ...dashboardLabels(page).map((label: string): [string, string] => {
      return [`**${label}**`, `**${drawnActionLabel(language, label)}**`];
    }),
    ...listed(CREATE_BUTTONS, page).map((button: string): [string, string] => {
      return [`**${button}**`, `**${drawnCreateButton(language, button)}**`];
    }),
    ...boldPaths(englishPage(page)).map(
      (segments: Array<string>): [string, string] => {
        return [drawnPath("en", segments), drawnPath(language, segments)];
      },
    ),
  ];
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

// The widest line of any label of the page's diagrams, in this language.
function widestDiagramLine(language: string, page: string): number {
  return Math.max(
    ...scanMarkdown(readPage(language, page))
      .fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      })
      .flatMap((fence: { code: string }): Array<string> => {
        return diagramLabelLines(fence.code);
      })
      .map(labelLineWidth),
  );
}

/*
 * Whether a page's copy in a language has the English page's headings, level
 * for level, so the heading in an English heading's place means the same.
 */
function inEnglishShape(language: string, page: string): boolean {
  const levels: (markdown: string) => Array<number> = (
    markdown: string,
  ): Array<number> => {
    return scanMarkdown(markdown).headings.map((heading: DocsHeading) => {
      return heading.level;
    });
  };

  return (
    language === "en" ||
    JSON.stringify(levels(readPage(language, page))) ===
      JSON.stringify(levels(englishPage(page)))
  );
}

/*
 * A link as a translation must write it on the English one's line: the same
 * page, and the anchor of the heading in the English heading's place in the
 * reader's language. The page's own anchors ("#x") open the page itself.
 *
 * A page whose copy in this language still has its old shape (the Persian
 * Session Replay page, until it is translated again) has no heading in the
 * English one's place: a link into it keeps the page, and either drops the
 * anchor or names a heading that page has (anchorProblems holds it to one).
 * The result is null when either is fine.
 */
function expectedLink(
  language: string,
  page: string,
  target: string,
): string | null {
  const ownAnchor: boolean = target.startsWith("#");
  const parsed: { page: string; anchor: string | null } | null = ownAnchor
    ? { page: page, anchor: target.slice(1) }
    : parseDocsLink(target);

  if (!parsed || !parsed.anchor) {
    return target;
  }

  const served: string = hasPage(language, parsed.page) ? language : "en";

  if (!inEnglishShape(served, parsed.page)) {
    return null;
  }

  const anchor: string | null = anchorInLanguage(
    served,
    parsed.page,
    decodeURIComponent(parsed.anchor),
  );

  return ownAnchor ? `#${anchor}` : `${target.split("#")[0]}#${anchor}`;
}

// Every link of a page, line by line: "line: target".
function linksByLine(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return `${link.line}: ${decodeURIComponent(link.target)}`;
  });
}

/*
 * The prose lines of a translation that are still the English line in their
 * place: three or more Latin words of four letters, once code, link targets,
 * product names and the bold words a page keeps in English are taken out.
 */
function untranslatedLines(language: string, page: string): Array<string> {
  const english: Array<string> = englishPage(page).split("\n");
  const translated: Array<string> = readPage(language, page).split("\n");
  const found: Array<string> = [];
  let inFence: boolean = false;

  english.forEach((line: string, index: number): void => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return;
    }

    if (inFence || index === 0 || line !== translated[index]) {
      return;
    }

    let text: string = line
      .replace(INLINE_CODE_SPAN, " ")
      .replace(LINK_TARGET, "]");

    for (const kept of listed(KEPT_AS_WRITTEN, page)) {
      text = text.split(`**${kept}**`).join(" ");
    }

    for (const name of PRODUCT_NAMES) {
      text = text.split(name).join(" ");
    }

    if ((text.match(LATIN_WORD) || []).length >= 3) {
      found.push(`${index + 1}: ${line}`);
    }
  });

  return found;
}

// The titles of a page's collapsible entries, in order.
function detailsTitles(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith(DETAILS_LINE);
    })
    .map((line: string): string => {
      return line.slice(DETAILS_LINE.length);
    });
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      CREATE_BUTTONS,
      KEPT_AS_WRITTEN,
      PROSE,
      WIDEST_DIAGRAM_LINE,
      DETAILS_WORDS,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("know every bold word on the English pages: a label, a path, or a listed word", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !isActionLabel(span) && !accountedFor(page, span);
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("list only bold words the English pages have", () => {
    for (const page of PAGE_NAMES) {
      const english: Array<string> = boldLabels(englishPage(page));
      const stale: Array<string> = [
        ...listed(KEPT_AS_WRITTEN, page),
        ...listed(CREATE_BUTTONS, page),
        ...listed(PROSE, page),
      ].filter((span: string): boolean => {
        return !english.includes(span);
      });

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });

  it("keep in English only what no Dashboard locale has as a label, or a permission's name", () => {
    for (const page of PAGE_NAMES) {
      for (const name of listed(KEPT_AS_WRITTEN, page)) {
        // A permission's title reads as a create button would; it is not one.
        const permission: boolean = name === "Create Telemetry Ingestion Key";

        expect({ page, name, label: isActionLabel(name) }).toEqual({
          page,
          name,
          label: permission,
        });
      }
    }
  });

  it("draw the create buttons the English pages name as the English Dashboard does", () => {
    for (const page of PAGE_NAMES) {
      for (const button of listed(CREATE_BUTTONS, page)) {
        expect(drawnCreateButton("en", button)).toBe(button);
      }
    }
  });

  it("keep product names as tab labels only where the English pages have them", () => {
    const english: Array<string> = PAGE_NAMES.flatMap(
      (page: string): Array<string> => {
        return tabLabels(englishPage(page));
      },
    );

    for (const tab of NAME_TABS) {
      expect({ tab, onAPage: english.includes(tab) }).toEqual({
        tab,
        onAPage: true,
      });
    }
  });

  it("quote, in each collapsible entry's title, the Dashboard words the English titles name", () => {
    for (const page of Object.keys(DETAILS_WORDS)) {
      const titles: string = detailsTitles(englishPage(page)).join("\n");

      for (const word of DETAILS_WORDS[page] || []) {
        expect({ page, word: word.english, named: titles.includes(word.english) }).toEqual({
          page,
          word: word.english,
          named: true,
        });
      }
    }
  });
});

describe("the English pages", () => {
  it.each(RUM_SETUP_PAGES)(
    "$page draws at least one diagram, with a caption",
    (entry: RumDocsPageEntry) => {
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

  it.each(RUM_SETUP_PAGES)(
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: RumDocsPageEntry) => {
      const markdown: string = englishPage(entry.page);
      const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
      const last: DocsHeading = headings[headings.length - 1] as DocsHeading;
      const firstSection: number = markdown.indexOf("\n## ");
      const opening: Array<string> = cardLines(markdown.slice(0, firstSection));

      expect(opening.length).toBeGreaterThanOrEqual(3);

      for (const line of opening) {
        expect(line).toMatch(/^- \[[^\]]+\]\(#[^)]+\): /);
      }

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      // Two blocks of cards: the opening one and Next steps.
      expect(markdown.split(":::cards").length - 1).toBe(2);
      expect(
        cardLines(markdown.slice(markdown.lastIndexOf("\n## Next steps\n")))
          .length,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each([BROWSER_SETUP, MOBILE_SETUP, WEB_VITALS])(
    "%s, a setup page, has a Before you begin section and a Troubleshooting section of collapsible entries",
    (page: string) => {
      const markdown: string = englishPage(page);
      const texts: Array<string> = scanMarkdown(markdown).headings.map(
        (heading: DocsHeading): string => {
          return heading.text;
        },
      );
      const troubleshooting: string = markdown.slice(
        markdown.indexOf("\n## Troubleshooting\n"),
        markdown.indexOf("\n## Next steps\n"),
      );

      expect(texts).toContain("Before you begin");
      expect(texts).toContain("Troubleshooting");
      expect(troubleshooting.split(":::details ").length - 1).toBeGreaterThan(
        2,
      );
    },
  );

  it("the overview gets a reader started in steps, and points at troubleshooting", () => {
    const markdown: string = englishPage(RUM_INDEX);
    const getStarted: string = markdown.slice(
      markdown.indexOf("\n## Get started\n"),
      markdown.indexOf("\n## Next steps\n"),
    );

    expect(stepCount(getStarted)).toBe(4);
    expect(getStarted).toContain("(/docs/rum/troubleshooting)");
  });

  it.each(RUM_SETUP_PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: RumDocsPageEntry) => {
      expect(widestDiagramLine("en", entry.page)).toBeLessThanOrEqual(
        WIDEST_DIAGRAM_LINE[entry.page] as number,
      );
    },
  );

  it.each(RUM_SETUP_PAGES)(
    "$page has no two headings with the same anchor",
    (entry: RumDocsPageEntry) => {
      const slugs: Array<string> = scanMarkdown(
        englishPage(entry.page),
      ).headings.map((heading: DocsHeading): string => {
        return heading.slug;
      });

      expect(slugs.length).toBe(new Set(slugs).size);
    },
  );

  it.each(RUM_SETUP_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: RumDocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(RUM_SETUP_PAGES)(
    "$page says no 'left navigation': products open from the Products menu",
    (entry: RumDocsPageEntry) => {
      expect(englishPage(entry.page)).not.toMatch(/left nav/i);
    },
  );
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(RUM_SETUP_PAGES)("$page", (entry: RumDocsPageEntry) => {
    const english: string = englishPage(entry.page);

    it("is translated, under the nav link's title", () => {
      expect(hasPage(language, entry.page)).toBe(true);

      const translated: string = readPage(language, entry.page);
      const title: string = navTitle(language, entry.navTitle);

      expect(translated).not.toEqual(english);
      expect(typeof title).toBe("string");
      expect(translated.split("\n")[0]).toBe(`# ${title}`);
    });

    it("lies line for line beside the English page: headings, table rows, fences, components and tabs on the same lines", () => {
      expect(lineShape(readPage(language, entry.page))).toEqual(
        lineShape(english),
      );
    });

    it("translates every line of prose", () => {
      expect(untranslatedLines(language, entry.page)).toEqual([]);
    });

    it("keeps every code block, and builds every diagram the same way", () => {
      expect(
        scanMarkdown(readPage(language, entry.page)).fences.map(
          comparableFence,
        ),
      ).toEqual(scanMarkdown(english).fences.map(comparableFence));
    });

    it("breaks its diagrams' labels into lines short enough for the 590px docs column", () => {
      const widest: number = widestDiagramLine(language, entry.page);

      expect({
        widest: widest,
        fits: widest <= (WIDEST_DIAGRAM_LINE[entry.page] as number),
      }).toEqual({ widest: widest, fits: true });
    });

    it("keeps every piece of inline code: the attributes, metric names, settings and values", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the tab labels that name a platform or a library, and translates the others", () => {
      const translated: Array<string> = tabLabels(
        readPage(language, entry.page),
      );
      const original: Array<string> = tabLabels(english);

      expect(translated.length).toBe(original.length);

      original.forEach((tab: string, index: number) => {
        if (NAME_TABS.includes(tab)) {
          expect({ index, tab: translated[index] }).toEqual({ index, tab });
        } else {
          expect({ index, translated: translated[index] !== tab }).toEqual({
            index,
            translated: true,
          });
        }
      });
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

    it("has every link on the English one's line, its anchor naming the heading in the English heading's place", () => {
      const translated: Array<string> = linksByLine(
        readPage(language, entry.page),
      );
      const original: Array<DocsLink> = scanMarkdown(english).links;

      expect(translated).toHaveLength(original.length);

      original.forEach((link: DocsLink, index: number): void => {
        const expected: string | null = expectedLink(
          language,
          entry.page,
          link.target,
        );
        const written: string = translated[index] as string;

        if (expected !== null) {
          expect(written).toBe(`${link.line}: ${expected}`);
          return;
        }

        // A stale page: the page is kept, with or without one of its anchors.
        expect(written.split("#")[0]).toBe(
          `${link.line}: ${link.target.split("#")[0]}`,
        );
      });
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...dashboardLabels(entry.page).map((label: string): string => {
          return drawnActionLabel(language, label);
        }),
        ...listed(CREATE_BUTTONS, entry.page).map((button: string): string => {
          return drawnCreateButton(language, button);
        }),
      ].filter((drawn: string): boolean => {
        return !translated.includes(`**${drawn}**`);
      });

      expect(missing).toEqual([]);
    });

    it("leaves no label, button or path in English where this language's Dashboard draws it otherwise", () => {
      const translated: string = readPage(language, entry.page);
      const drawnHere: Array<[string, string]> = englishBoldDrawings(
        language,
        entry.page,
      );
      /*
       * A word this page writes in bold on purpose: drawn so, kept as
       * written, or a segment of a Persian path, which is bold on its own.
       */
      const meant: Set<string> = new Set([
        ...drawnHere.map((drawing: [string, string]): string => {
          return drawing[1];
        }),
        ...listed(KEPT_AS_WRITTEN, entry.page).map((name: string): string => {
          return `**${name}**`;
        }),
        ...(language === "fa"
          ? boldPaths(english).flatMap(
              (segments: Array<string>): Array<string> => {
                return segments.map(
                  (_segment: string, index: number): string => {
                    return `**${drawnPathSegment(language, segments, index)}**`;
                  },
                );
              },
            )
          : []),
      ]);
      const leftover: Array<string> = drawnHere
        .filter((drawing: [string, string]): boolean => {
          const [englishBold, drawnBold] = drawing;

          return (
            englishBold !== drawnBold &&
            !meant.has(englishBold) &&
            translated.includes(englishBold)
          );
        })
        .map((drawing: [string, string]): string => {
          return drawing[0];
        });

      expect(leftover).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = boldPaths(english)
        .map((segments: Array<string>): string => {
          return drawnPath(language, segments);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(drawn);
        });

      expect(missing).toEqual([]);
    });

    it("keeps in English what every Dashboard draws in English: a permission, the vitals card's words, P75 and the recommendations", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = listed(KEPT_AS_WRITTEN, entry.page).filter(
        (name: string): boolean => {
          return !translated.includes(`**${name}**`);
        },
      );

      expect(missing).toEqual([]);
    });

    it("quotes the Dashboard in its collapsible entries' titles as this language draws it", () => {
      const titles: Array<string> = detailsTitles(
        readPage(language, entry.page),
      );
      const englishTitles: Array<string> = detailsTitles(english);
      const missing: Array<string> = (DETAILS_WORDS[entry.page] || [])
        .filter(
          (word: { english: string; drawn: (l: string) => string }): boolean => {
            const index: number = englishTitles.findIndex(
              (title: string): boolean => {
                return title.includes(word.english);
              },
            );

            return !(titles[index] || "").includes(word.drawn(language));
          },
        )
        .map(
          (word: { english: string; drawn: (l: string) => string }): string => {
            return `${word.english} -> ${word.drawn(language)}`;
          },
        );

      expect(titles).toHaveLength(englishTitles.length);
      expect(missing).toEqual([]);
    });

    if (language === "fa") {
      it("joins its menu paths with ' > ', leaving no '→' in its prose", () => {
        expect(
          prose(readPage(language, entry.page)).split(RIGHT_ARROW).length - 1,
        ).toBe(0);
      });
    }

    it("lays out every diagram line in the order it reads: right to left on a right-to-left page", () => {
      expect(
        linesLaidOutBackwards(
          readPage(language, entry.page),
          getDocsLanguageDirection(language),
        ),
      ).toEqual([]);
    });
  });
});

describe("the helpers, on these pages' shapes", () => {
  it("draw a path through the Products menu's Resources group from the menu's keys", () => {
    const segments: Array<string> = [
      "Products",
      "Resources",
      "Real User Monitoring",
    ];

    expect(drawnPath("en", segments)).toBe(
      "**Products → Resources → Real User Monitoring**",
    );
    // The Dutch menu names the group "Bronnen"; a Resources label elsewhere reads "Middelen".
    expect(drawnPathSegment("nl", segments, 1)).toBe(
      drawnMenuGroup("nl", "Resources"),
    );
    expect(drawnMenuGroup("nl", "Resources")).not.toBe(
      drawnDashboardLabel("nl", "Resources"),
    );
    // The Russian menu names Services "Сервисы"; a Services label reads "Службы".
    expect(drawnPathSegment("ru", ["Products", "Services"], 1)).toBe(
      drawnMenuItem("ru", "Services"),
    );
    expect(drawnMenuItem("ru", "Services")).not.toBe(
      drawnDashboardLabel("ru", "Services"),
    );
    expect(drawnPath("fa", segments)).toBe(
      `**${drawnDashboardLabel("fa", "Products")}** > **${drawnMenuGroup("fa", "Resources")}** > **${drawnMenuItem("fa", "Real User Monitoring")}**`,
    );
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups", () => {
    expect(numbersIn("below 2500 ms")).toEqual(["2500"]);
    expect(numbersIn("کمتر از ۲۵۰۰ ms")).toEqual(["2500"]);
    expect(numbersIn("6 000 requêtes et 0,25")).toEqual(["0.25", "6000"]);
  });

  it("find an untranslated line of prose, but not a line of code or names", () => {
    const english: Array<string> = englishPage(BROWSER_SETUP).split("\n");
    const proseLine: number = english.findIndex((line: string): boolean => {
      return line.startsWith("The SDK runs in your visitors' browsers.");
    });

    expect(proseLine).toBeGreaterThan(0);
    expect(
      (english[proseLine] as string).match(LATIN_WORD)!.length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      "| `telemetry.sdk.language` | No | |"
        .replace(INLINE_CODE_SPAN, " ")
        .match(LATIN_WORD)?.length || 0,
    ).toBeLessThan(3);
  });

  it("name every link's anchor by the heading in the English heading's place, and tolerate a stale page", () => {
    expect(expectedLink("en", WEB_VITALS, "#single-page-apps")).toBe(
      "#single-page-apps",
    );
    expect(
      expectedLink("en", RUM_INDEX, "/docs/rum/web-vitals#single-page-apps"),
    ).toBe("/docs/rum/web-vitals#single-page-apps");
    expect(expectedLink("en", RUM_INDEX, "/docs/rum/web-vitals")).toBe(
      "/docs/rum/web-vitals",
    );
    // The Persian Session Replay page keeps its old shape for now.
    expect(inEnglishShape("fa", "telemetry/session-replay")).toBe(false);
    expect(
      expectedLink(
        "fa",
        MOBILE_SETUP,
        "/docs/telemetry/session-replay#install-in-react-native",
      ),
    ).toBeNull();
    expect(
      anchorsOf("fa", "telemetry/session-replay").size,
    ).toBeGreaterThan(0);
  });
});
