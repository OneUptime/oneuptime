import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  ALERTS_NAV_GROUP,
  ALERTS_OVERVIEW,
  ALERT_EPISODES,
  ALERT_PAGES,
  ALERT_SETTINGS,
  ALERT_STATES,
  AlertDocsPageEntry,
  DIAGRAM_KINDS,
  KEPT_AS_WRITTEN,
  PRODUCT_NAMES,
  PROSE,
  SEEDED_TEXT,
} from "./AlertDocsPages";
import {
  DocsHeading,
  DocsLink,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { drawnActionLabel, isActionLabel } from "./DocsDashboardLabels";
import {
  PATH_SEPARATOR,
  boldLabels,
  boldPaths,
  lineShape,
  stepCount,
  tabLabels,
  tables,
  unbalancedLines,
} from "./DocsPageShape";
import { drawnPath, drawnPathSegment } from "./DocsProductsMenu";
import {
  CARD_LINE,
  anchorProblems,
  boldSpans,
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
 * Docs overhaul task 32: the Alerts pages - the overview, alert states and
 * severities, episodes and grouping rules, and alert rules and settings - in
 * every docs language. AlertDocsFacts holds the English pages to the
 * product; this suite holds each translation to its English page:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and step on the English one's line, so a later
 *     English edit shows where it lands in every language;
 *   - diagrams built the same way (by their nodes and arrows), with label
 *     lines short enough for the 590px docs column;
 *   - the same inline code (addresses, models, flags and template
 *     variables), tables and the numbers of their rows (orders, minutes),
 *     lists, steps and cards, and every link on the English one's line, its
 *     anchor naming the heading in the English heading's place;
 *   - every line of prose translated, and a title that is the nav link's.
 *
 * It names the Dashboard the way each language's Dashboard draws it,
 * Persian included: a bold label by drawnActionLabel, a menu path segment by
 * segment (drawnPath: one bold span joined by " → "; in Persian a bold span
 * per segment joined by " > ", with no "→" left in the prose). The words a
 * page keeps as written - the workflow components' and roles' names, which
 * the Dashboard writes in English, and "⋯" - stay in English
 * (KEPT_AS_WRITTEN). A bold word that is a list item's lead or a table row's
 * own name is translated freely (PROSE). A new bold word on these English
 * pages fails "know every bold word" until it is a label or listed.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE_NAMES: Array<string> = ALERT_PAGES.map(
  (entry: AlertDocsPageEntry): string => {
    return entry.page;
  },
);

/*
 * Each diagram reads as it is written, in every language: its label lines
 * are broken (<br/>) to be no wider than its cap, counting a Chinese,
 * Japanese or Korean character twice. A page's caps are its diagrams', in
 * order: the widest line the 17 languages drew, measured in a browser in
 * the font Mermaid draws labels in, none wider than about 185px. Mermaid
 * breaks a line wider than 200px again inside its node, leaving a word
 * alone on a line, and the narrow diagram it draws is scaled up to the
 * 590px docs column. Every diagram fits the column without scrolling.
 */
const WIDEST_DIAGRAM_LINE: Record<string, ReadonlyArray<number>> = {
  [ALERTS_OVERVIEW]: [25],
  [ALERT_STATES]: [21],
  [ALERT_EPISODES]: [25, 26],
  [ALERT_SETTINGS]: [25],
};

/*
 * The names, longest first: "OneUptime AI" goes before "OneUptime" takes
 * its first word.
 */
const NAMES_LONGEST_FIRST: Array<string> = [...PRODUCT_NAMES].sort(
  (a: string, b: string): number => {
    return b.length - a.length;
  },
);

const ONLY_CODE: RegExp = /^`[^`]+`$/;
// A number as a table states it: 30, 1.5. A translation may write its digits.
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
const LEFT_NAVIGATION: RegExp = /left nav/i;
const CAPTIONED_DIAGRAM: RegExp = /title="[^"]+"/;
const OWN_SECTION_CARD: RegExp = /^- \[[^\]]+\]\(#[^)]+\): /;
const RELATIVE_MARKDOWN_LINK: RegExp = /\]\((?:\.{1,2}\/|[^)#:]*\.md)/;

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed(
  lists: Readonly<Record<string, ReadonlyArray<string>>>,
  page: string,
): Array<string> {
  return [...(lists[page] || [])];
}

// A bold span that is nothing but inline code.
function isCodeSpan(span: string): boolean {
  return ONLY_CODE.test(span);
}

// Whether a list accounts for a bold English word on a page.
function accountedFor(page: string, span: string): boolean {
  return (
    isCodeSpan(span) ||
    listed(KEPT_AS_WRITTEN, page).includes(span) ||
    listed(PROSE, page).includes(span)
  );
}

/*
 * The Dashboard labels a page names that drawnActionLabel draws: every bold
 * label but the ones a list keeps, or translates freely.
 */
function dashboardLabels(page: string): Array<string> {
  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    return isActionLabel(label) && !accountedFor(page, label);
  });
}

// The menu paths of a page, every one of them the Dashboard's.
function dashboardPaths(page: string): Array<Array<string>> {
  return boldPaths(englishPage(page));
}

/*
 * Every bold label and menu path of the Dashboard that the English page
 * names, as the English page writes it and as a page in the language must:
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
    ...dashboardPaths(page).map((segments: Array<string>): [string, string] => {
      return [drawnPath("en", segments), drawnPath(language, segments)];
    }),
  ];
}

// How a page in any language writes the words it keeps: as the English does.
function keptWords(page: string): Array<string> {
  return listed(KEPT_AS_WRITTEN, page).map((word: string): string => {
    return `**${word}**`;
  });
}

/*
 * A table row's text outside its bold spans. The numbers a row states are
 * there; a bold span is a label another test holds.
 */
function outsideBoldSpans(row: Array<string>): string {
  const text: string = row.join(" | ");

  return boldSpans(text).reduce((rest: string, span: string): string => {
    return rest.split(`**${span}**`).join(" ");
  }, text);
}

/*
 * A text with its numbers' digit groups joined: 1,000,000 to 1000000. One
 * pass joins every other group (a match takes the digit the next one
 * needs), so it runs until nothing changes.
 */
function withoutDigitGroups(text: string): string {
  let joined: string = text;
  let previous: string = "";

  while (joined !== previous) {
    previous = joined;
    joined = joined.replace(DIGIT_GROUP, "$1$2");
  }

  return joined;
}

// The numbers a text states, code left out.
function numbersIn(text: string): Array<string> {
  return Array.from(
    withoutDigitGroups(toLatinDigits(text.replace(INLINE_CODE_SPAN, " ")))
      .replace(DECIMAL_MARK, "$1.$2")
      .matchAll(NUMBER),
  )
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .sort();
}

// The widest label line of each of the page's diagrams, in this language.
function widestDiagramLines(language: string, page: string): Array<number> {
  return scanMarkdown(readPage(language, page))
    .fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === "mermaid";
    })
    .map((fence: { code: string }): number => {
      return Math.max(...diagramLabelLines(fence.code).map(labelLineWidth));
    });
}

/*
 * The diagrams that run past their caps: "diagram n: widest > cap". Empty
 * when every diagram fits, and when the page has as many caps as diagrams.
 */
function diagramsTooWide(language: string, page: string): Array<string> {
  const caps: ReadonlyArray<number> = WIDEST_DIAGRAM_LINE[page] || [];
  const widest: Array<number> = widestDiagramLines(language, page);

  if (widest.length !== caps.length) {
    return [`${widest.length} diagrams, ${caps.length} caps`];
  }

  return widest
    .map((width: number, index: number): string | null => {
      return width > (caps[index] as number)
        ? `diagram ${index + 1}: ${width} > ${caps[index]}`
        : null;
    })
    .filter((problem: string | null): problem is string => {
      return problem !== null;
    });
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
 * A page whose copy in this language still has its old shape (a page of
 * another group a translation has not caught up with) has no heading in the
 * English one's place: a link into it keeps the page, and either drops the
 * anchor or names a heading that page has (anchorProblems holds it to one).
 * The result is null when either is fine.
 *
 * It answers decoded: "#وضعیت" rather than "#%D9%88...". An anchor that
 * names no heading of the English page is kept as written.
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
    return decodeURIComponent(target);
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

  if (anchor === null) {
    return decodeURIComponent(target);
  }

  return ownAnchor
    ? `#${anchor}`
    : `${decodeURIComponent(target.split("#")[0] as string)}#${anchor}`;
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
 * names and the words kept in English are taken out.
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

    for (const kept of [...keptWords(page), ...listed(SEEDED_TEXT, page)]) {
      text = text.split(kept).join(" ");
    }

    for (const name of NAMES_LONGEST_FIRST) {
      text = text.split(name).join(" ");
    }

    if ((text.match(LATIN_WORD) || []).length >= 3) {
      found.push(`${index + 1}: ${line}`);
    }
  });

  return found;
}

function navGroup(title: string): NavGroup {
  return DocsNav.find((group: NavGroup): boolean => {
    return group.title === title;
  }) as NavGroup;
}

describe("the lists this test keeps", () => {
  it("name only pages of the Alerts group", () => {
    for (const lists of [
      KEPT_AS_WRITTEN,
      SEEDED_TEXT,
      PROSE,
      DIAGRAM_KINDS,
      WIDEST_DIAGRAM_LINE,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("follow the Alerts nav group, page for page", () => {
    expect(
      navGroup(ALERTS_NAV_GROUP).links.map((link: NavLink): Array<string> => {
        return [link.url, link.title];
      }),
    ).toEqual(
      ALERT_PAGES.map((entry: AlertDocsPageEntry): Array<string> => {
        return [`/docs/${entry.page}`, entry.navTitle];
      }),
    );
  });

  it("know every bold word on the English pages: a Dashboard label or path, or a listed word", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = [
        ...boldLabels(englishPage(page)).filter((span: string): boolean => {
          return !isActionLabel(span) && !accountedFor(page, span);
        }),
        ...dashboardPaths(page)
          .map((segments: Array<string>): string => {
            return segments.join(PATH_SEPARATOR);
          })
          .filter((path: string): boolean => {
            return !path
              .split(PATH_SEPARATOR)
              .every((segment: string): boolean => {
                return isActionLabel(segment);
              });
          }),
      ];

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("list only bold words the English pages have", () => {
    for (const page of PAGE_NAMES) {
      const english: Array<string> = boldLabels(englishPage(page));
      const stale: Array<string> = [
        ...listed(KEPT_AS_WRITTEN, page),
        ...listed(PROSE, page),
      ].filter((span: string): boolean => {
        return !english.includes(span);
      });

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });

  it("keep only seeded text an English page shows, outside its bold spans", () => {
    for (const page of PAGE_NAMES) {
      const english: string = englishPage(page);
      const stale: Array<string> = listed(SEEDED_TEXT, page).filter(
        (text: string): boolean => {
          return !english.includes(text) || english.includes(`**${text}**`);
        },
      );

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });

  it("put each bold word in one list only, and keep no Dashboard label as prose", () => {
    for (const page of PAGE_NAMES) {
      const all: Array<string> = [
        ...listed(KEPT_AS_WRITTEN, page),
        ...listed(PROSE, page),
      ];

      expect({ page, twice: all.length - new Set(all).size }).toEqual({
        page,
        twice: 0,
      });

      // A label the Dashboard draws is held to its drawing, not listed.
      expect({
        page,
        labels: listed(PROSE, page).filter((span: string): boolean => {
          return isActionLabel(span);
        }),
      }).toEqual({ page, labels: [] });
    }
  });
});

describe("the English pages", () => {
  it.each(ALERT_PAGES)(
    "$page is titled with its nav link",
    (entry: AlertDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(ALERT_PAGES)(
    "$page draws at least one diagram, with a caption, of the kind the page draws",
    (entry: AlertDocsPageEntry) => {
      const diagrams: Array<{ info: string; code: string }> = scanMarkdown(
        englishPage(entry.page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(CAPTIONED_DIAGRAM);
        expect(diagram.code.trim().split("\n")[0]?.trim()).toBe(
          DIAGRAM_KINDS[entry.page],
        );
      }
    },
  );

  it.each(ALERT_PAGES)(
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: AlertDocsPageEntry) => {
      const markdown: string = englishPage(entry.page);
      const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
      const last: DocsHeading = headings[headings.length - 1] as DocsHeading;
      const firstSection: number = markdown.indexOf("\n## ");
      const opening: Array<string> = cardLines(markdown.slice(0, firstSection));

      expect(opening.length).toBeGreaterThanOrEqual(3);

      for (const line of opening) {
        expect(line).toMatch(OWN_SECTION_CARD);
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

  it.each(ALERT_PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: AlertDocsPageEntry) => {
      expect(diagramsTooWide("en", entry.page)).toEqual([]);
    },
  );

  it.each(ALERT_PAGES)(
    "$page has no two headings with the same anchor, and skips no level",
    (entry: AlertDocsPageEntry) => {
      const headings: Array<DocsHeading> = scanMarkdown(
        englishPage(entry.page),
      ).headings;
      const slugs: Array<string> = headings.map(
        (heading: DocsHeading): string => {
          return heading.slug;
        },
      );

      expect(slugs.length).toBe(new Set(slugs).size);

      headings.forEach((heading: DocsHeading, index: number): void => {
        const previous: number =
          index === 0 ? 1 : (headings[index - 1] as DocsHeading).level;

        expect({
          heading: heading.text,
          skips: heading.level > previous + 1,
        }).toEqual({ heading: heading.text, skips: false });
      });
    },
  );

  it.each(ALERT_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: AlertDocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(ALERT_PAGES)(
    "$page says no 'left navigation', and links with /docs/ paths only, never a relative one",
    (entry: AlertDocsPageEntry) => {
      expect(englishPage(entry.page)).not.toMatch(LEFT_NAVIGATION);
      expect(englishPage(entry.page)).not.toMatch(RELATIVE_MARKDOWN_LINK);

      for (const link of scanMarkdown(englishPage(entry.page)).links) {
        expect({
          link: link.target,
          absolute:
            link.target.startsWith("#") || link.target.startsWith("/docs/"),
        }).toEqual({ link: link.target, absolute: true });
      }
    },
  );

  it.each(ALERT_PAGES)(
    "$page writes a menu path as one bold path with arrows, never with '>'",
    (entry: AlertDocsPageEntry) => {
      const oldPaths: Array<string> = boldSpans(prose(englishPage(entry.page)))
        .filter((span: string): boolean => {
          return span.includes(" > ");
        })
        .filter((span: string): boolean => {
          return !isCodeSpan(span);
        });

      expect(oldPaths).toEqual([]);
    },
  );

  it.each(ALERT_PAGES)(
    "$page has no tabs: nothing on it is a choice between alternatives",
    (entry: AlertDocsPageEntry) => {
      expect(tabLabels(englishPage(entry.page))).toEqual([]);
    },
  );
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(ALERT_PAGES)("$page", (entry: AlertDocsPageEntry) => {
    const english: string = englishPage(entry.page);

    it("is translated, under the nav link's title", () => {
      expect(hasPage(language, entry.page)).toBe(true);

      const translated: string = readPage(language, entry.page);
      const title: string = navTitle(language, entry.navTitle);

      expect(translated).not.toEqual(english);
      expect(typeof title).toBe("string");
      expect(translated.split("\n")[0]).toBe(`# ${title}`);
    });

    it("lies line for line beside the English page: headings, table rows, fences and components on the same lines", () => {
      expect(lineShape(readPage(language, entry.page))).toEqual(
        lineShape(english),
      );
    });

    it("translates every line of prose", () => {
      expect(untranslatedLines(language, entry.page)).toEqual([]);
    });

    it("builds every diagram the same way", () => {
      expect(
        scanMarkdown(readPage(language, entry.page)).fences.map(
          comparableFence,
        ),
      ).toEqual(scanMarkdown(english).fences.map(comparableFence));
    });

    it("breaks its diagrams' labels into lines short enough for the 590px docs column", () => {
      expect(diagramsTooWide(language, entry.page)).toEqual([]);
    });

    it("keeps every piece of inline code: addresses, models, flags and template variables", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the numbers every table row states, such as orders and minutes", () => {
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
            numbers: numbersIn(outsideBoldSpans(translatedRow)),
          }).toEqual({
            table: index,
            row: rowIndex,
            numbers: numbersIn(outsideBoldSpans(row)),
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
      expect(tabLabels(translated)).toEqual([]);
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
          `${link.line}: ${decodeURIComponent(link.target.split("#")[0] as string)}`,
        );
      });
    });

    it("names every Dashboard label and path the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = englishBoldDrawings(language, entry.page)
        .map((drawing: [string, string]): string => {
          return drawing[1];
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(drawn);
        });

      expect(missing).toEqual([]);
    });

    it("leaves no Dashboard label or path in English where this language's Dashboard draws it otherwise", () => {
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
        ...keptWords(entry.page),
        ...(language === "fa"
          ? dashboardPaths(entry.page).flatMap(
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

    it("keeps the workflow components' and roles' names, and the menu's '⋯', as written", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = keptWords(entry.page).filter(
        (kept: string): boolean => {
          return !translated.includes(kept);
        },
      );

      expect(missing).toEqual([]);
    });

    it("keeps the text a new project is seeded with in English, word for word, as the Dashboard shows it", () => {
      const translated: string = readPage(language, entry.page);

      expect(
        listed(SEEDED_TEXT, entry.page).filter((text: string): boolean => {
          return !translated.includes(text);
        }),
      ).toEqual([]);
    });

    if (language === "fa") {
      it("joins its menu paths with ' > ', leaving no '→' in its prose", () => {
        const text: string = prose(readPage(language, entry.page)).replace(
          INLINE_CODE_SPAN,
          " ",
        );

        expect(text.split(RIGHT_ARROW).length - 1).toBe(0);
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
  it("draw the Dashboard's paths from its own keys, the product from the Products menu", () => {
    expect(drawnPath("en", ["Alerts", "Rules", "Grouping Rules"])).toBe(
      "**Alerts → Rules → Grouping Rules**",
    );
    expect(drawnPath("de", ["Alerts", "Rules", "Grouping Rules"])).not.toBe(
      "**Alerts → Rules → Grouping Rules**",
    );
    // Persian bolds each segment, joined by " > ".
    expect(drawnPath("fa", ["Alerts", "Rules"])).toContain(" > ");
  });

  it("tell the Dashboard's labels from the words a page keeps or words freely", () => {
    // "⋯" opens a menu; it is no label of the Dashboard's.
    expect(dashboardLabels(ALERT_STATES)).not.toContain("⋯");
    // "Mark Alert as {{state}}" is the confirmation's own title.
    expect(dashboardLabels(ALERT_STATES)).toContain("Mark Alert as {{state}}");
    // A list item's lead is prose.
    expect(dashboardLabels(ALERT_EPISODES)).not.toContain("The grouping key");
    // The workflow components keep their English names.
    expect(dashboardLabels(ALERT_SETTINGS)).not.toContain("On Create Alert");
    expect(
      dashboardPaths(ALERT_SETTINGS).map((segments: Array<string>): string => {
        return segments.join(PATH_SEPARATOR);
      }),
    ).toContain("Alerts → Rules → On-Call Rules");
  });

  it("read the numbers a row states, in any digits, code left out", () => {
    expect(numbersIn("30 minutes, then `1` and 2 more")).toEqual(["2", "30"]);
    expect(numbersIn("۳۰ دقیقه")).toEqual(["30"]);
  });

  it("find an untranslated line of prose, but not a line of names or code", () => {
    let names: string = "OneUptime AI, Slack, Microsoft Teams, Terraform";

    for (const name of NAMES_LONGEST_FIRST) {
      names = names.split(name).join(" ");
    }

    expect((names.match(LATIN_WORD) || []).length).toBeLessThan(3);
  });

  it("name every link's anchor by the heading in the English heading's place, in the reader's language", () => {
    expect(expectedLink("en", ALERTS_OVERVIEW, "#private-alerts")).toBe(
      "#private-alerts",
    );
    // An anchor that names no heading is kept as written, not made "#null".
    expect(expectedLink("fa", ALERTS_OVERVIEW, "#no-such-heading")).toBe(
      "#no-such-heading",
    );

    // Every copy of these pages has its English page's headings.
    for (const language of LANGUAGES) {
      for (const page of PAGE_NAMES) {
        if (hasPage(language, page)) {
          expect({
            language,
            page,
            inShape: inEnglishShape(language, page),
          }).toEqual({ language, page, inShape: true });
        }
      }
    }
  });
});
