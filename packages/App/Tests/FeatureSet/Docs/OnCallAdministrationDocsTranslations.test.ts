import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DIAGRAM_KINDS,
  KEPT_AS_WRITTEN,
  LINKS_ADDED_TO_EXISTING_PAGES,
  NAV_TITLES_FROM_THE_DASHBOARD,
  NEW_ON_CALL_PAGES,
  ON_CALL_GROUP_PAGES,
  ON_CALL_NAV_GROUP,
  ON_CALL_OVERVIEW,
  ON_CALL_POLICIES,
  OnCallDocsPageEntry,
  PRODUCT_NAMES,
  PROSE,
  READINESS_AND_REPORTS,
  USER_OVERRIDES,
} from "./OnCallAdministrationDocsPages";
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
  drawnDashboardLabel,
  isActionLabel,
} from "./DocsDashboardLabels";
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
 * Docs overhaul task 34: the On Call group's new pages - the overview,
 * on-call policies, user overrides, and readiness & reports - in every docs
 * language. OnCallAdministrationDocsFacts holds the English pages to the
 * product; this suite holds each translation to its English page:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and step on the English one's line, so a later
 *     English edit shows where it lands in every language;
 *   - diagrams built the same way (by their nodes and arrows), with label
 *     lines short enough for the 590px docs column;
 *   - the same inline code (addresses, API fields, the email subject's
 *     start), the API example exactly, tables and the numbers of their rows,
 *     lists, steps and cards, and every link on the English one's line, its
 *     anchor naming the heading in the English heading's place;
 *   - every line of prose translated, and a title that is the nav link's.
 *
 * It names the Dashboard the way each language's Dashboard draws it,
 * Persian included: a bold label by drawnActionLabel, a menu path segment by
 * segment (drawnPath: one bold span joined by " → "; in Persian a bold span
 * per segment joined by " > ", with no "→" left in the prose). Where a
 * language's Dashboard still draws a label in English, the page writes it in
 * English too. The words a page keeps as written - "Level 1", the execution
 * statuses the Dashboard shows in English, the workflow step's name, and
 * role and permission names - stay in English (KEPT_AS_WRITTEN). A new bold
 * word on these English pages fails "know every bold word" until it is a
 * label or listed.
 *
 * It also holds what the task changed on pages that were there before: the
 * links the older On Call pages gained into these pages and the
 * Notifications group, and the On-call cards of Getting Started and Core
 * Concepts, in every language.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE_NAMES: Array<string> = NEW_ON_CALL_PAGES.map(
  (entry: OnCallDocsPageEntry): string => {
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
  [ON_CALL_OVERVIEW]: [24],
  [ON_CALL_POLICIES]: [24],
  [USER_OVERRIDES]: [23],
  [READINESS_AND_REPORTS]: [26],
};

/*
 * The names, longest first: "OneUptime Cloud" goes before "OneUptime" takes
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
 * A page whose copy in this language still has its old shape has no heading
 * in the English one's place: a link into it keeps the page, and either
 * drops the anchor or names a heading that page has (anchorProblems holds it
 * to one). The result is null when either is fine.
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
 * names, the words kept in English and the labels this language's Dashboard
 * still draws in English are taken out. A table row that is nothing but
 * such a label and its API field is translated as far as it can be.
 */
function untranslatedLines(language: string, page: string): Array<string> {
  const english: Array<string> = englishPage(page).split("\n");
  const translated: Array<string> = readPage(language, page).split("\n");
  const found: Array<string> = [];
  const drawnInEnglish: Array<string> = englishBoldDrawings(language, page)
    .filter((drawing: [string, string]): boolean => {
      return drawing[0] === drawing[1];
    })
    .map((drawing: [string, string]): string => {
      return drawing[0];
    });
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

    for (const kept of [...keptWords(page), ...drawnInEnglish]) {
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

// The pages a page links to, anchors left off, in order.
function linkedPages(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return decodeURIComponent(link.target.split("#")[0] as string);
  });
}

describe("the lists this test keeps", () => {
  it("name only pages of the On Call group", () => {
    for (const lists of [
      KEPT_AS_WRITTEN,
      PROSE,
      DIAGRAM_KINDS,
      WIDEST_DIAGRAM_LINE,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }

    for (const page of Object.keys(LINKS_ADDED_TO_EXISTING_PAGES)) {
      expect(
        ON_CALL_GROUP_PAGES.map((entry: OnCallDocsPageEntry): string => {
          return entry.page;
        }),
      ).toContain(page);
      expect(PAGE_NAMES).not.toContain(page);
    }
  });

  it("follow the On Call nav group, page for page", () => {
    expect(
      navGroup(ON_CALL_NAV_GROUP).links.map((link: NavLink): Array<string> => {
        return [link.url, link.title];
      }),
    ).toEqual(
      ON_CALL_GROUP_PAGES.map((entry: OnCallDocsPageEntry): Array<string> => {
        return [`/docs/${entry.page}`, entry.navTitle];
      }),
    );

    for (const entry of NEW_ON_CALL_PAGES) {
      expect(ON_CALL_GROUP_PAGES).toContainEqual(entry);
    }
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
  it.each(NEW_ON_CALL_PAGES)(
    "$page is titled with its nav link",
    (entry: OnCallDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(NEW_ON_CALL_PAGES)(
    "$page draws at least one diagram, with a caption, of the kind the page draws",
    (entry: OnCallDocsPageEntry) => {
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

  it.each(NEW_ON_CALL_PAGES)(
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: OnCallDocsPageEntry) => {
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

  it.each(NEW_ON_CALL_PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: OnCallDocsPageEntry) => {
      expect(diagramsTooWide("en", entry.page)).toEqual([]);
    },
  );

  it.each(NEW_ON_CALL_PAGES)(
    "$page has no two headings with the same anchor, and skips no level",
    (entry: OnCallDocsPageEntry) => {
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

  it.each(NEW_ON_CALL_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: OnCallDocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(NEW_ON_CALL_PAGES)(
    "$page says no 'left navigation', and links with /docs/ paths only, never a relative one",
    (entry: OnCallDocsPageEntry) => {
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

  it.each(NEW_ON_CALL_PAGES)(
    "$page writes a menu path as one bold path with arrows, never with '>'",
    (entry: OnCallDocsPageEntry) => {
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

  it.each(NEW_ON_CALL_PAGES)(
    "$page has no tabs: nothing on it is a choice between alternatives",
    (entry: OnCallDocsPageEntry) => {
      expect(tabLabels(englishPage(entry.page))).toEqual([]);
    },
  );
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(NEW_ON_CALL_PAGES)("$page", (entry: OnCallDocsPageEntry) => {
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

    it("keeps every piece of inline code: addresses, API fields and values", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the numbers every table row states, such as defaults", () => {
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

    it("keeps the words the product shows in English as written: roles, permissions, statuses, Level 1", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = keptWords(entry.page).filter(
        (kept: string): boolean => {
          return !translated.includes(kept);
        },
      );

      expect(missing).toEqual([]);
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

  it("titles the pages that document an On-Call Duty menu entry as this language's Dashboard names the entry", () => {
    for (const title of NAV_TITLES_FROM_THE_DASHBOARD) {
      expect({ title, nav: navTitle(language, title) }).toEqual({
        title,
        nav: drawnDashboardLabel(language, title),
      });
    }
  });

  describe("the older On Call pages", () => {
    it.each(Object.keys(LINKS_ADDED_TO_EXISTING_PAGES))(
      "%s links where the English page now does: into the new pages and the Notifications group",
      (page: string) => {
        const translated: Array<string> = linkedPages(readPage(language, page));
        const english: Array<string> = linkedPages(englishPage(page));

        for (const target of LINKS_ADDED_TO_EXISTING_PAGES[page] || []) {
          const targetPage: string = target.split("#")[0] as string;

          expect({ page, target: targetPage, en: english }).toEqual(
            expect.objectContaining({
              en: expect.arrayContaining([targetPage]),
            }),
          );
          expect({ page, target: targetPage, linked: translated }).toEqual(
            expect.objectContaining({
              linked: expect.arrayContaining([targetPage]),
            }),
          );
        }

        // The same pages as the English page links, and as often.
        expect([...translated].sort()).toEqual([...english].sort());
        expect(anchorProblems(language, page)).toEqual([]);
      },
    );
  });

  describe("the introduction pages", () => {
    it("Getting Started opens the On Call group at its overview, right before Notifications", () => {
      const lines: Array<string> = readPage(
        language,
        "introduction/getting-started",
      ).split("\n");
      const onCall: number = lines.findIndex((line: string): boolean => {
        return line.startsWith("- [") && line.includes("(/docs/on-call/index)");
      });

      expect(onCall).toBeGreaterThan(0);
      expect(CARD_LINE.test(lines[onCall] as string)).toBe(true);
      expect(lines[onCall + 1] || "").toContain("(/docs/notifications/index)");
      expect(
        lines.filter((line: string): boolean => {
          return line.includes("(/docs/on-call/schedules)");
        }),
      ).toEqual([]);
    });

    it("Core Concepts opens its on-call cards with the overview, by the overview's title", () => {
      const lines: Array<string> = readPage(
        language,
        "introduction/core-concepts",
      ).split("\n");
      const overview: number = lines.findIndex((line: string): boolean => {
        return line.startsWith("- [") && line.includes("(/docs/on-call/index)");
      });

      expect(overview).toBeGreaterThan(0);
      expect(lines[overview - 1]).toBe(":::cards");
      expect(
        (lines[overview] as string).startsWith(
          `- [${navTitle(language, "On-Call Overview")}](/docs/on-call/index): `,
        ),
      ).toBe(true);
      expect(lines[overview + 1] || "").toContain(
        "(/docs/on-call/escalation-rules)",
      );
    });
  });
});

describe("the helpers, on these pages' shapes", () => {
  it("draw the Dashboard's paths from its own keys", () => {
    expect(
      drawnPath("en", ["On-Call Duty", "Advanced", "User Overrides"]),
    ).toBe("**On-Call Duty → Advanced → User Overrides**");
    expect(
      drawnPath("de", ["On-Call Duty", "Advanced", "User Overrides"]),
    ).toBe("**Bereitschaftsdienst → Erweitert → Benutzerüberschreibungen**");
    // Persian bolds each segment, joined by " > ".
    expect(drawnPath("fa", ["On-Call Duty", "Readiness"])).toContain(" > ");
  });

  it("tell the Dashboard's labels from the words a page keeps", () => {
    // A role's name is drawn, as the role pickers draw it.
    expect(dashboardLabels(ON_CALL_POLICIES)).toContain("Project Admin");
    // A status the Dashboard shows in English is kept.
    expect(dashboardLabels(ON_CALL_POLICIES)).not.toContain(
      "Execution Completed",
    );
    // A status its locales hold is drawn.
    expect(dashboardLabels(ON_CALL_POLICIES)).toContain("Scheduled");
    // An add button is drawn from "Add {{itemName}}".
    expect(dashboardLabels(USER_OVERRIDES)).toContain("Add User Override");
    expect(drawnActionLabel("de", "Add User Override")).not.toBe(
      "Add User Override",
    );
    expect(
      dashboardPaths(READINESS_AND_REPORTS).map(
        (segments: Array<string>): string => {
          return segments.join(PATH_SEPARATOR);
        },
      ),
    ).toContain("On-Call Duty → Reports → User On Call Time");
  });

  it("read the numbers a row states, in any digits, code left out", () => {
    expect(numbersIn("After 5 minutes, then `10` and 30 more")).toEqual([
      "30",
      "5",
    ]);
    expect(numbersIn("۳۰ دقیقه")).toEqual(["30"]);
  });

  it("find an untranslated line of prose, but not a line of names or code", () => {
    let names: string = "OneUptime Cloud, Slack, Microsoft Teams, Telegram";

    for (const name of NAMES_LONGEST_FIRST) {
      names = names.split(name).join(" ");
    }

    expect((names.match(LATIN_WORD) || []).length).toBeLessThan(3);
  });

  it("take a label a language's Dashboard draws in English for drawn, not for a line left untranslated", () => {
    const row: string = "| **Name** | `name` |";

    expect(englishPage(ON_CALL_POLICIES).split("\n")).toContain(row);
    // The German Dashboard draws the field as English writes it; the Japanese one does not.
    expect(englishBoldDrawings("de", ON_CALL_POLICIES)).toContainEqual([
      "**Name**",
      "**Name**",
    ]);
    expect(englishBoldDrawings("ja", ON_CALL_POLICIES)).toContainEqual([
      "**Name**",
      "**名前**",
    ]);
    // So the German page keeps the row as written, and that is not a miss.
    expect(readPage("de", ON_CALL_POLICIES).split("\n")).toContain(row);
    expect(untranslatedLines("de", ON_CALL_POLICIES)).toEqual([]);
    expect(readPage("ja", ON_CALL_POLICIES).split("\n")).not.toContain(row);
  });

  it("name every link's anchor by the heading in the English heading's place, in the reader's language", () => {
    expect(
      expectedLink("en", ON_CALL_OVERVIEW, "#how-a-page-reaches-someone"),
    ).toBe("#how-a-page-reaches-someone");
    // An anchor that names no heading is kept as written, not made "#null".
    expect(expectedLink("fa", ON_CALL_OVERVIEW, "#no-such-heading")).toBe(
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
