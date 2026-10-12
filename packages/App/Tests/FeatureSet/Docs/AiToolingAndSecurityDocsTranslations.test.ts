import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  AI_GATEWAYS,
  AI_TOOLING_PAGES,
  CIRCUIT_BREAKER,
  DocsPageEntry,
  GEMINI_COPILOT,
  SECURITY_EVENTS,
  SECURITY_PAGES,
  THREAT_INTELLIGENCE,
} from "./AiObservabilityDocsPages";
import {
  DocsHeading,
  DocsLink,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  drawnActionLabel,
  drawnCreateButton,
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
  PRODUCTS_MENU_ITEM_KEYS,
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
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 24b: the rest of the AI Observability group (Gemini
 * CLI & GitHub Copilot, AI Gateways, AI Agent Circuit Breakers) and the
 * Security group (Security Events, Threat Intelligence), in every docs
 * language. AiToolingDocsFacts and SecurityDocsFacts hold the English pages
 * to the product; this suite holds each translation to its English page:
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
 * Persian included: a bold label by drawnActionLabel, a table's create
 * button by drawnCreateButton (CREATE_BUTTONS), a product opened from the
 * Products menu by the menu's own key (MENU_ITEMS, DocsProductsMenu), and a
 * menu path segment by segment (drawnPath: one bold span joined by " → ";
 * in Persian a bold span per segment joined by " > ", with no "→" left in
 * the prose). Every diagram line reads in the order it is written, laid out
 * the way its page lays it out (linesLaidOutBackwards, DocsTranslationChecks).
 *
 * What every Dashboard draws in English stays English (KEPT_AS_WRITTEN): a
 * workflow step's own names (its title, settings and dots, as the workflow
 * pages keep them), the monitor criteria's filter types and conditions, and
 * the value picker's glyph. A new bold word on these English pages fails
 * "know every bold word" until it is a Dashboard label or listed here.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGES: ReadonlyArray<DocsPageEntry> = [
  ...AI_TOOLING_PAGES,
  ...SECURITY_PAGES,
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: DocsPageEntry): string => {
  return entry.page;
});

/*
 * Each page's diagrams fit the 590px docs column, measured in a browser with
 * the docs' own font, in every language: their label lines are broken
 * (<br/>) to be no wider than this, counting a Chinese, Japanese or Korean
 * character twice. Each cap is the widest line the 17 languages drew when
 * they were measured; the widest diagram of all, the Italian security
 * sources, drew 566px. A label put back on one line runs its diagram off the
 * column, and the docs scroll it rather than shrink it.
 */
const WIDEST_DIAGRAM_LINE: Record<string, number> = {
  [GEMINI_COPILOT]: 28,
  [AI_GATEWAYS]: 25,
  [CIRCUIT_BREAKER]: 26,
  [SECURITY_EVENTS]: 29,
  [THREAT_INTELLIGENCE]: 28,
};

// Bold words that name a product opened from the Products menu.
const MENU_ITEMS: Record<string, Array<string>> = {
  [AI_GATEWAYS]: ["Traces"],
  [CIRCUIT_BREAKER]: ["Monitors", "Alerts"],
};

// A table's create button, drawn as translateNamedAction draws it.
const CREATE_BUTTONS: Record<string, Array<string>> = {
  [GEMINI_COPILOT]: ["Create Ingestion Key"],
  [AI_GATEWAYS]: ["Create Ingestion Key"],
  [CIRCUIT_BREAKER]: ["Create LLM Cost Budget"],
  [SECURITY_EVENTS]: ["Create Ingestion Key", "Create Detection Rule"],
  [THREAT_INTELLIGENCE]: ["Create Threat Intel Feed"],
};

/*
 * A workflow step's own names, which the workflow builder draws as the step
 * names them and the workflow pages keep in English: the trigger and the
 * blocks the circuit breaker uses, their settings, and their dots. "Error"
 * is also a span status on that page, which a translation draws as its
 * Dashboard does; the dot keeps it in English. AiToolingDocsFacts holds
 * each to the workflow components that define it.
 */
export const WORKFLOW_STEP_NAMES: Record<string, Array<string>> = {
  [CIRCUIT_BREAKER]: [
    "On Create Alert",
    "Select Fields",
    "If / Else",
    "Value to check",
    "Comparison",
    "Compare with",
    "API Post (JSON)",
    "URL",
    "Request Headers",
    "Request Body",
    "Send Message to Slack",
    "Send Email",
    "Success",
    "Yes",
    "No",
    "Error",
  ],
};

/*
 * The monitor criteria's filter types and conditions (CheckOn, FilterType),
 * which no Dashboard locale translates. AiToolingDocsFacts and
 * SecurityDocsFacts hold each to its enum.
 */
export const CRITERIA_NAMES: Record<string, Array<string>> = {
  [CIRCUIT_BREAKER]: ["Greater Than Or Equal To", "Span Count", "Greater Than"],
  [SECURITY_EVENTS]: ["Security Event Count"],
};

// The workflow value picker's button, a glyph.
const GLYPHS: Record<string, Array<string>> = {
  [CIRCUIT_BREAKER]: ["{ }"],
};

/*
 * Tab labels that are a product's or a format's name, kept as written so a
 * reader's pick follows them from page to page; the other tab labels are
 * words, which a translation translates.
 */
const NAME_TABS: ReadonlyArray<string> = [
  "Docker",
  "pip",
  "VS Code",
  "Copilot CLI",
  "OCSF",
  "Google UDM",
  "Generic JSON",
];

/*
 * Names a translation writes as the English does, in prose too: products and
 * tools. A line made of them alone, such as the header of the table that
 * sets Gemini CLI beside GitHub Copilot, is not a line left untranslated.
 */
const PRODUCT_NAMES: ReadonlyArray<string> = [
  "Gemini CLI",
  "GitHub Copilot",
  "Copilot CLI",
  "Copilot SDK",
  "VS Code",
  "LiteLLM Proxy",
  "OneUptime",
  "OpenTelemetry",
];

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

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed(
  lists: Record<string, Array<string>>,
  page: string,
): Array<string> {
  return lists[page] || [];
}

// Bold words a translation keeps exactly as the English page writes them.
function keptAsWritten(page: string): Array<string> {
  return [
    ...listed(WORKFLOW_STEP_NAMES, page),
    ...listed(CRITERIA_NAMES, page),
    ...listed(GLYPHS, page),
  ];
}

// Whether a list accounts for a bold English word on a page.
function accountedFor(page: string, span: string): boolean {
  return (
    keptAsWritten(page).includes(span) ||
    listed(MENU_ITEMS, page).includes(span) ||
    listed(CREATE_BUTTONS, page).includes(span)
  );
}

/*
 * The Dashboard labels a page names that drawnActionLabel draws: every bold
 * label but the ones a list draws or keeps.
 */
function dashboardLabels(page: string): Array<string> {
  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    return isActionLabel(label) && !accountedFor(page, label);
  });
}

/*
 * Every bold label, create button, menu item and menu path of the English
 * page, as the English page writes it and as a page in the language must:
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
    ...listed(MENU_ITEMS, page).map((item: string): [string, string] => {
      return [`**${item}**`, `**${drawnMenuItem(language, item)}**`];
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
 * A link as a translation must write it on the English one's line: the same
 * page, and the anchor of the heading in the English heading's place in the
 * reader's language. The page's own anchors ("#x") open the page itself.
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
  const anchor: string | null = anchorInLanguage(
    served,
    parsed.page,
    decodeURIComponent(parsed.anchor),
  );

  if (anchor === null) {
    return null;
  }

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
 * The title is the
 * nav link's, which some languages keep as the English writes it ("Gemini
 * CLI & GitHub Copilot"), and is held to it on its own.
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

    for (const kept of keptAsWritten(page)) {
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

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      MENU_ITEMS,
      CREATE_BUTTONS,
      WORKFLOW_STEP_NAMES,
      CRITERIA_NAMES,
      GLYPHS,
      WIDEST_DIAGRAM_LINE,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("know every bold word on the English pages: a label, a path, or a name kept in English", () => {
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
        ...keptAsWritten(page),
        ...listed(MENU_ITEMS, page),
        ...listed(CREATE_BUTTONS, page),
      ].filter((span: string): boolean => {
        return !english.includes(span);
      });

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });

  it("keep in English only what no Dashboard locale has as a label, or a step's own name", () => {
    for (const page of PAGE_NAMES) {
      for (const name of [
        ...listed(CRITERIA_NAMES, page),
        ...listed(GLYPHS, page),
      ]) {
        expect({ page, name, label: isActionLabel(name) }).toEqual({
          page,
          name,
          label: false,
        });
      }
    }
  });

  it("draw the menu items from keys the Products menu has", () => {
    for (const page of PAGE_NAMES) {
      for (const item of listed(MENU_ITEMS, page)) {
        expect(PRODUCTS_MENU_ITEM_KEYS[item]).toBeDefined();
        expect(drawnMenuItem("en", item)).toBe(item);
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
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: DocsPageEntry) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it.each(PAGES)(
    "$page draws at least one diagram, with a caption",
    (entry: DocsPageEntry) => {
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
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: DocsPageEntry) => {
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

  it.each(PAGES)(
    "$page has a Before you begin section and a Troubleshooting section of collapsible entries",
    (entry: DocsPageEntry) => {
      const markdown: string = englishPage(entry.page);
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

  it.each(PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: DocsPageEntry) => {
      expect(widestDiagramLine("en", entry.page)).toBeLessThanOrEqual(
        WIDEST_DIAGRAM_LINE[entry.page] as number,
      );
    },
  );

  it.each(PAGES)(
    "$page has no two headings with the same anchor",
    (entry: DocsPageEntry) => {
      const slugs: Array<string> = scanMarkdown(
        englishPage(entry.page),
      ).headings.map((heading: DocsHeading): string => {
        return heading.slug;
      });

      expect(slugs.length).toBe(new Set(slugs).size);
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: DocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(PAGES)(
    "$page says no 'left navigation': products open from the Products menu",
    (entry: DocsPageEntry) => {
      expect(englishPage(entry.page)).not.toMatch(/left nav/i);
    },
  );
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(PAGES)("$page", (entry: DocsPageEntry) => {
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

    it("keeps every piece of inline code: the settings, attributes, metrics and values", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the tab labels that name a product or a format, and translates the others", () => {
      const translated: Array<string> = tabLabels(
        readPage(language, entry.page),
      );
      const original: Array<string> = tabLabels(english);

      expect(translated.length).toBe(original.length);

      original.forEach((tab: string, index: number) => {
        if (NAME_TABS.includes(tab)) {
          expect({ index, tab: translated[index] }).toEqual({ index, tab });
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
      const expected: Array<string> = scanMarkdown(english).links.map(
        (link: DocsLink): string => {
          return `${link.line}: ${expectedLink(language, entry.page, link.target)}`;
        },
      );

      expect(linksByLine(readPage(language, entry.page))).toEqual(expected);
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
        ...listed(MENU_ITEMS, entry.page).map((item: string): string => {
          return drawnMenuItem(language, item);
        }),
      ].filter((drawn: string): boolean => {
        return !translated.includes(`**${drawn}**`);
      });

      expect(missing).toEqual([]);
    });

    it("leaves no label, button, menu item or path in English where this language's Dashboard draws it otherwise", () => {
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
        ...keptAsWritten(entry.page).map((name: string): string => {
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

    it("keeps in English a workflow step's own names, the criteria's filter types and conditions, and the picker's glyph", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = keptAsWritten(entry.page).filter(
        (name: string): boolean => {
          return !translated.includes(`**${name}**`);
        },
      );

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
  it("draw a path through the Products menu from the menu's keys, and a span per segment in Persian", () => {
    const segments: Array<string> = ["Products", "Security Events", "Events"];

    expect(drawnPath("en", segments)).toBe(
      "**Products → Security Events → Events**",
    );
    expect(drawnPath("fa", ["Security Events", "Monitors"])).toBe(
      `**${drawnMenuItem("fa", "Security Events")}** > **${drawnActionLabel("fa", "Monitors")}**`,
    );
    // A tab of Security Events is a label; the product is the menu's item.
    expect(drawnPathSegment("da", ["Security Events", "Monitors"], 1)).toBe(
      drawnActionLabel("da", "Monitors"),
    );
    expect(drawnPathSegment("da", ["Monitors", "Create Monitor"], 0)).toBe(
      drawnMenuItem("da", "Monitors"),
    );
    expect(drawnMenuItem("da", "Monitors")).not.toBe(
      drawnActionLabel("da", "Monitors"),
    );
  });

  it("find an untranslated line of prose, but not a line of code, names or kept words", () => {
    const english: Array<string> = englishPage(CIRCUIT_BREAKER).split("\n");
    const proseLine: number = english.findIndex((line: string): boolean => {
      return line.startsWith("The breaker watches the OpenTelemetry");
    });

    expect(proseLine).toBeGreaterThan(0);
    expect(
      (english[proseLine] as string).match(LATIN_WORD)!.length,
    ).toBeGreaterThanOrEqual(3);
    // A line of a table that is all code and short words is not prose to translate.
    expect(
      "| `oneuptime.threat.feed_id` | The feed |"
        .replace(INLINE_CODE_SPAN, " ")
        .match(LATIN_WORD)?.length || 0,
    ).toBeLessThan(3);
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups", () => {
    expect(numbersIn("Up to 15 minutes, plus a minute")).toEqual(["15"]);
    expect(numbersIn("تا ۱۵ دقیقه")).toEqual(["15"]);
    expect(numbersIn("1 to 1000000")).toEqual(["1", "1000000"]);
    expect(numbersIn("10 000 et 1,5")).toEqual(["1.5", "10000"]);
  });

  it("name every link's anchor by the heading in the English heading's place", () => {
    expect(expectedLink("en", THREAT_INTELLIGENCE, "#subscribe-a-feed")).toBe(
      "#subscribe-a-feed",
    );
    expect(
      expectedLink(
        "en",
        THREAT_INTELLIGENCE,
        "/docs/telemetry/security-events#retention-and-billing",
      ),
    ).toBe("/docs/telemetry/security-events#retention-and-billing");
    expect(
      expectedLink(
        "en",
        THREAT_INTELLIGENCE,
        "/docs/telemetry/security-events",
      ),
    ).toBe("/docs/telemetry/security-events");
    expect(expectedLink("en", THREAT_INTELLIGENCE, "#no-such-heading")).toBe(
      null,
    );
  });
});
