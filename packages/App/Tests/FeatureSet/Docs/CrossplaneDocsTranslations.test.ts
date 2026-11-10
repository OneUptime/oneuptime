import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER } from "../../../FeatureSet/Docs/Utils/Placeholders";
import {
  CROSSPLANE_GROUP_URLS,
  CROSSPLANE_NAV_GROUP,
  CROSSPLANE_OVERVIEW,
  CROSSPLANE_PAGES,
  CrossplaneDocsPageEntry,
  MANAGING_RESOURCES,
  PRODUCT_NAMES,
  PROSE,
} from "./CrossplaneDocsPages";
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
  boldLabels,
  boldPaths,
  lineShape,
  stepCount,
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
  inlineCode,
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
 * The Crossplane provider's pages (issue #6587), in every docs language.
 * CrossplaneDocsFacts holds the English pages to the provider; this suite
 * holds each translation to its English page:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence and component line on the English one's line, so a later
 *     English edit shows where it lands in every language;
 *   - the same YAML and commands, word for word: they are what a reader
 *     applies and runs, in every language;
 *   - the same inline code (kinds, fields, values and kubectl's output),
 *     the {{CROSSPLANE_PROVIDER_VERSION}} placeholder on the English one's
 *     lines, tables and the code their rows start with, lists, steps and
 *     cards, and every link on the English one's line, its anchor naming
 *     the heading in the English heading's place;
 *   - every line of prose translated, and a title that is the nav link's.
 *
 * And it names the product the way that language's Dashboard draws it,
 * Persian included: a status by drawnActionLabel, a menu path segment by
 * segment (drawnPath: one bold span joined by " → "; in Persian a bold
 * span per segment joined by " > ", with no "→" left in the prose). The
 * Growth plan's name stays as it is. A bold word that is emphasis is
 * translated freely (PROSE). A new bold word on these English pages fails
 * "know every bold word" until it is a label or listed.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE_NAMES: Array<string> = CROSSPLANE_PAGES.map(
  (entry: CrossplaneDocsPageEntry): string => {
    return entry.page;
  },
);

// The plan API keys need: a plan's name, which every language writes so.
const GROWTH_PLAN: string = "Growth";

/*
 * The names, longest first: "OneUptime Cloud" goes before "OneUptime"
 * takes its first word.
 */
const NAMES_LONGEST_FIRST: Array<string> = [...PRODUCT_NAMES].sort(
  (a: string, b: string): number => {
    return b.length - a.length;
  },
);

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
const LEFT_NAVIGATION: RegExp = /left nav/i;
const OWN_SECTION_CARD: RegExp = /^- \[[^\]]+\]\(#[^)]+\): /;
const PLACEHOLDER: RegExp = /\{\{CROSSPLANE_PROVIDER_[A-Z]+\}\}/g;
// The package, as a reader pulls it: a registry, the repository and a tag.
const PACKAGE_REFERENCE: RegExp = /provider-oneuptime:(\S+)/g;

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
  return isCodeSpan(span) || listed(PROSE, page).includes(span);
}

/*
 * The Dashboard labels a page names that drawnActionLabel draws: every bold
 * label but the ones PROSE translates freely.
 */
function dashboardLabels(page: string): Array<string> {
  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    return isActionLabel(label) && !accountedFor(page, label);
  });
}

/*
 * Every bold label and menu path of the English page that a language draws
 * in its own words, as the English page writes it and as a page in the
 * language must: [English bold, drawn bold]. A Persian path is one bold
 * span per segment.
 */
function englishBoldDrawings(
  language: string,
  page: string,
): Array<[string, string]> {
  return [
    ...dashboardLabels(page).map((label: string): [string, string] => {
      return [`**${label}**`, `**${drawnActionLabel(language, label)}**`];
    }),
    ...boldPaths(englishPage(page)).map(
      (segments: Array<string>): [string, string] => {
        return [drawnPath("en", segments), drawnPath(language, segments)];
      },
    ),
  ];
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

// The numbers a text states, code and placeholders left out.
function numbersIn(text: string): Array<string> {
  return Array.from(
    withoutDigitGroups(
      toLatinDigits(
        text.replace(INLINE_CODE_SPAN, " ").replace(PLACEHOLDER, " "),
      ),
    )
      .replace(DECIMAL_MARK, "$1.$2")
      .matchAll(NUMBER),
  )
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .sort();
}

// The inline code a table row holds, cell by cell.
function rowCode(row: Array<string>): Array<Array<string>> {
  return row.map((cell: string): Array<string> => {
    return Array.from(cell.matchAll(INLINE_CODE_SPAN)).map(
      (match: RegExpMatchArray): string => {
        return match[0];
      },
    );
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

// The placeholders of each line, in order: "line: {{TOKEN}}".
function placeholdersByLine(markdown: string): Array<string> {
  return markdown.split("\n").flatMap((line: string, index: number) => {
    return Array.from(line.matchAll(PLACEHOLDER)).map(
      (match: RegExpMatchArray): string => {
        return `${index + 1}: ${match[0]}`;
      },
    );
  });
}

/*
 * The prose lines of a translation that are still the English line in their
 * place: three or more Latin words of four letters, once code, link targets
 * and names are taken out.
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

    if (isUntranslatedText(line)) {
      found.push(`${index + 1}: ${line}`);
    }
  });

  return found;
}

// Whether a line of prose reads as English: three Latin words of four letters.
function isUntranslatedText(line: string): boolean {
  let text: string = line
    .replace(INLINE_CODE_SPAN, " ")
    .replace(LINK_TARGET, "]");

  for (const name of NAMES_LONGEST_FIRST) {
    text = text.split(name).join(" ");
  }

  return (text.match(LATIN_WORD) || []).length >= 3;
}

function navGroup(title: string): NavGroup {
  return DocsNav.find((group: NavGroup): boolean => {
    return group.title === title;
  }) as NavGroup;
}

describe("the lists this test keeps", () => {
  it("name only pages of the Crossplane group", () => {
    for (const page of Object.keys(PROSE)) {
      expect(PAGE_NAMES).toContain(page);
    }
  });

  it("follow the Crossplane nav group, which has these pages and no others", () => {
    const links: Array<NavLink> = navGroup(CROSSPLANE_NAV_GROUP).links;

    expect(
      links.map((link: NavLink): string => {
        return link.url;
      }),
    ).toEqual([...CROSSPLANE_GROUP_URLS]);
    expect(
      links.map((link: NavLink): Array<string> => {
        return [link.url, link.title];
      }),
    ).toEqual(
      CROSSPLANE_PAGES.map((entry: CrossplaneDocsPageEntry): Array<string> => {
        return [`/docs/${entry.page}`, entry.navTitle];
      }),
    );
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
      const stale: Array<string> = listed(PROSE, page).filter(
        (span: string): boolean => {
          return !english.includes(span);
        },
      );

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });
});

describe("the English pages", () => {
  it.each(CROSSPLANE_PAGES)(
    "$page is titled with its nav link",
    (entry: CrossplaneDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(CROSSPLANE_PAGES)(
    "$page opens with cards to its own sections",
    (entry: CrossplaneDocsPageEntry) => {
      const markdown: string = englishPage(entry.page);
      const firstSection: number = markdown.indexOf("\n## ");
      const opening: Array<string> = cardLines(markdown.slice(0, firstSection));
      const slugs: Array<string> = scanMarkdown(markdown).headings.map(
        (heading: DocsHeading): string => {
          return heading.slug;
        },
      );

      expect(opening.length).toBeGreaterThanOrEqual(3);

      for (const line of opening) {
        expect(line).toMatch(OWN_SECTION_CARD);
        expect(slugs).toContain(
          (line.match(/\]\(#([^)]+)\)/) as RegExpMatchArray)[1],
        );
      }
    },
  );

  it.each(CROSSPLANE_PAGES)(
    "$page has no two headings with the same anchor, and skips no level",
    (entry: CrossplaneDocsPageEntry) => {
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

  it.each(CROSSPLANE_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: CrossplaneDocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(CROSSPLANE_PAGES)(
    "$page says no 'left navigation', and links with /docs/ paths, never a relative one",
    (entry: CrossplaneDocsPageEntry) => {
      expect(englishPage(entry.page)).not.toMatch(LEFT_NAVIGATION);

      for (const link of scanMarkdown(englishPage(entry.page)).links) {
        const absolute: boolean =
          link.target.startsWith("#") ||
          link.target.startsWith("/docs/") ||
          new URL(link.target, "https://docs.invalid").origin !==
            "https://docs.invalid";

        expect({ link: link.target, absolute }).toEqual({
          link: link.target,
          absolute: true,
        });
      }
    },
  );

  it.each(CROSSPLANE_PAGES)(
    "$page writes a menu path as one bold path with arrows, never with '>'",
    (entry: CrossplaneDocsPageEntry) => {
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

  it("name the package's tag with the placeholder, never a version written down", () => {
    const tags: Array<string> = PAGE_NAMES.flatMap(
      (page: string): Array<string> => {
        return Array.from(englishPage(page).matchAll(PACKAGE_REFERENCE)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        );
      },
    );

    // The overview installs it, and the other page adds a runtime config and verifies it.
    expect(tags.length).toBeGreaterThanOrEqual(3);

    for (const tag of tags) {
      expect(tag).toBe(CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER);
    }

    expect(englishPage(CROSSPLANE_OVERVIEW)).toContain(
      `package: ghcr.io/oneuptime/provider-oneuptime:${CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER}`,
    );
    expect(englishPage(MANAGING_RESOURCES)).toContain(
      `cosign verify ghcr.io/oneuptime/provider-oneuptime:${CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER}`,
    );
  });
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(CROSSPLANE_PAGES)("$page", (entry: CrossplaneDocsPageEntry) => {
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

    it("keeps every manifest and command word for word", () => {
      expect(
        scanMarkdown(readPage(language, entry.page)).fences.map(
          comparableFence,
        ),
      ).toEqual(scanMarkdown(english).fences.map(comparableFence));
    });

    it("keeps every piece of inline code: kinds, fields, values and kubectl's output", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the package's version placeholder on the English one's lines", () => {
      expect(placeholdersByLine(readPage(language, entry.page))).toEqual(
        placeholdersByLine(english),
      );
    });

    it("keeps the code of every table cell, row by row, and the numbers every row states", () => {
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
            code: rowCode(translatedRow),
            numbers: numbersIn(outsideBoldSpans(translatedRow)),
          }).toEqual({
            table: index,
            row: rowIndex,
            code: rowCode(row),
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

    it("names every status and path the English page names, as this language's product draws it", () => {
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

    it("leaves no status or path in English where this language's product draws it otherwise", () => {
      const translated: string = readPage(language, entry.page);
      const drawnHere: Array<[string, string]> = englishBoldDrawings(
        language,
        entry.page,
      );
      /*
       * A word this page writes in bold on purpose: drawn so, or a
       * segment of a Persian path, which is bold on its own.
       */
      const meant: Set<string> = new Set([
        ...drawnHere.map((drawing: [string, string]): string => {
          return drawing[1];
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

    it("keeps the Growth plan's name as every language writes it", () => {
      const translatedLines: Array<string> = readPage(
        language,
        entry.page,
      ).split("\n");

      english.split("\n").forEach((line: string, index: number): void => {
        if (line.includes(GROWTH_PLAN)) {
          expect({
            line: index + 1,
            kept: (translatedLines[index] || "").includes(GROWTH_PLAN),
          }).toEqual({ line: index + 1, kept: true });
        }
      });
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
  });
});

describe("the helpers, on these pages' shapes", () => {
  it("draw the API keys path and the Developer page's path from the Dashboard's own keys", () => {
    expect(drawnPath("en", ["Project Settings", "Advanced", "API Keys"])).toBe(
      "**Project Settings → Advanced → API Keys**",
    );
    expect(drawnPath("en", ["Developer", "Terraform"])).toBe(
      "**Developer → Terraform**",
    );
    // A Persian path is a bold span per segment.
    expect(drawnPath("fa", ["Developer", "Terraform"])).toBe(
      ["Developer", "Terraform"]
        .map((_segment: string, index: number): string => {
          return `**${drawnPathSegment("fa", ["Developer", "Terraform"], index)}**`;
        })
        .join(" > "),
    );
  });

  it("draw the statuses the overview names as Dashboard labels", () => {
    expect(dashboardLabels(CROSSPLANE_OVERVIEW)).toEqual([
      "Offline",
      "Operational",
    ]);
    expect(dashboardLabels(MANAGING_RESOURCES)).toEqual([]);
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups, code and placeholders left out", () => {
    expect(numbersIn("over 400 kinds")).toEqual(["400"]);
    expect(numbersIn("بیش از ۴۰۰")).toEqual(["400"]);
    expect(numbersIn("bis zu 60.000")).toEqual(["60000"]);
    expect(numbersIn("`--poll=1m` every 10 minutes")).toEqual(["10"]);
    expect(
      numbersIn(
        `provider-oneuptime:${CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER}`,
      ),
    ).toEqual([]);
  });

  it("read the code of each cell of a row", () => {
    expect(
      rowCode(["`Monitor`", "A monitor", "`oneuptime_monitor`, `x`"]),
    ).toEqual([["`Monitor`"], [], ["`oneuptime_monitor`", "`x`"]]);
  });

  it("find an untranslated line of prose, but not a line of names or code", () => {
    expect(
      isUntranslatedText(
        "Put the key in a Secret of the namespace your resources will live in.",
      ),
    ).toBe(true);
    expect(
      isUntranslatedText(
        "`kubectl api-resources --api-group=crossplane.oneuptime.com` OneUptime Cloud, Kubernetes, Crossplane",
      ),
    ).toBe(false);
  });

  it("find the placeholders of each line", () => {
    expect(
      placeholdersByLine(
        `a\npackage: ghcr.io/oneuptime/provider-oneuptime:${CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER}`,
      ),
    ).toEqual([`2: ${CROSSPLANE_PROVIDER_VERSION_PLACEHOLDER}`]);
  });

  it("name every link's anchor by the heading in the English heading's place, in the reader's language", () => {
    expect(
      expectedLink("en", CROSSPLANE_OVERVIEW, "#how-the-provider-works"),
    ).toBe("#how-the-provider-works");
    expect(
      expectedLink(
        "de",
        CROSSPLANE_OVERVIEW,
        "/docs/terraform/quick-start#create-a-project-api-key",
      ),
    ).toBe(
      `/docs/terraform/quick-start#${anchorInLanguage(
        "de",
        "terraform/quick-start",
        "create-a-project-api-key",
      )}`,
    );
    // An anchor that names no heading is kept as written, not made "#null".
    expect(expectedLink("fa", CROSSPLANE_OVERVIEW, "#no-such-heading")).toBe(
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
