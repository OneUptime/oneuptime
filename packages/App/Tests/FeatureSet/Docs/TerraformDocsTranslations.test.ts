import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER,
  TERRAFORM_PROVIDER_VERSION_PLACEHOLDER,
} from "../../../FeatureSet/Docs/Utils/Placeholders";
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
  drawnTableButton,
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
import {
  COMPLETE_GUIDE,
  CREATE_BUTTONS,
  DIAGRAM_KINDS,
  EXAMPLES,
  MONITOR_STEPS,
  OPTIONAL_FIELDS,
  OTHER_NAMES,
  PRODUCT_NAMES,
  PROSE,
  QUICK_START,
  TERRAFORM_GROUP_URLS,
  TERRAFORM_OVERVIEW,
  TERRAFORM_PAGES,
  TRANSLATED_TABS,
  TerraformDocsPageEntry,
} from "./TerraformDocsPages";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 30a: the Terraform overview, quick start, complete
 * guide, monitor steps and examples, in every docs language.
 * TerraformDocsFacts holds the English pages to the provider; this suite
 * holds each translation to its English page:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and tab on the English one's line, so a later
 *     English edit shows where it lands in every language;
 *   - the same code, word for word - HCL, commands, YAML and the API's JSON
 *     are what a reader copies, in every language - and diagrams built the
 *     same way (by their nodes and arrows), with label lines short enough
 *     for the 590px docs column;
 *   - the same inline code (attribute names, values, outputs and errors),
 *     the same {{TERRAFORM_PROVIDER_...}} placeholders on each line, tables
 *     and the numbers of their rows, lists, steps and cards, and every link
 *     on the English one's line, its anchor naming the heading in the
 *     English heading's place;
 *   - every line of prose translated, and a title that is the nav link's.
 *
 * And it names the product the way that language's Dashboard draws it,
 * Persian included: a bold label by drawnActionLabel, the API keys table's
 * create button by drawnTableButton, a form field without its "(Optional)"
 * (OPTIONAL_FIELDS), a menu path segment by segment (drawnPath: one bold
 * span joined by " → "; in Persian a bold span per segment joined by " > ",
 * with no "→" left in the prose). What every language keeps as written
 * stays so: GitHub's own menu path (OTHER_NAMES) and the Growth plan's
 * name. A bold word that is emphasis is translated freely (PROSE). A new
 * bold word on these English pages fails "know every bold word" until it is
 * a label or listed.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE_NAMES: Array<string> = TERRAFORM_PAGES.map(
  (entry: TerraformDocsPageEntry): string => {
    return entry.page;
  },
);

/*
 * Each page's diagrams fit the 590px docs column, in every language: their
 * label lines are broken (<br/>) to be no wider than this, counting a
 * Chinese, Japanese or Korean character twice. Each cap is the widest line
 * the 17 languages drew, every diagram drawn in a browser at the column's
 * width without scrolling (the widest, the monitor_steps parts diagram in
 * English, drew 578px: its last three nodes sit side by side, so their
 * labels break sooner than one node's would). A label put back on one line
 * runs its diagram off the column, and the docs scroll it rather than
 * shrink it.
 */
const WIDEST_DIAGRAM_LINE: Record<string, number> = {
  [TERRAFORM_OVERVIEW]: 25,
  [QUICK_START]: 27,
  [COMPLETE_GUIDE]: 30,
  [MONITOR_STEPS]: 27,
  [EXAMPLES]: 28,
};

// The plan API keys need: a plan's name, which every language writes so.
const GROWTH_PLAN: string = "Growth";

/*
 * The names, longest first: "GitHub Actions" goes before "GitHub" takes its
 * first word.
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
const CAPTIONED_DIAGRAM: RegExp = /title="[^"]+"/;
const OWN_SECTION_CARD: RegExp = /^- \[[^\]]+\]\(#[^)]+\): /;
// A form field's "(Optional)", in ASCII or full-width brackets.
const OPTIONAL_MARK: RegExp = /\s*[(（][^)）]*[)）]\s*$/;
const PLACEHOLDER: RegExp = /\{\{TERRAFORM_PROVIDER_[A-Z]+\}\}/g;

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed(
  lists: Readonly<Record<string, ReadonlyArray<string>>>,
  page: string,
): Array<string> {
  return [...(lists[page] || [])];
}

// A page's form fields named without "(Optional)": [the page's word, the field's title].
function optionalFields(page: string): Array<[string, string]> {
  return Object.entries(OPTIONAL_FIELDS[page] || {});
}

// How a language's Dashboard draws a form field, its "(Optional)" left off.
function drawnFieldWithoutMark(language: string, title: string): string {
  return drawnDashboardLabel(language, title).replace(OPTIONAL_MARK, "");
}

// A bold span that is nothing but inline code.
function isCodeSpan(span: string): boolean {
  return ONLY_CODE.test(span);
}

// Whether a list accounts for a bold English word on a page.
function accountedFor(page: string, span: string): boolean {
  return (
    isCodeSpan(span) ||
    listed(OTHER_NAMES, page).includes(span) ||
    listed(CREATE_BUTTONS, page).includes(span) ||
    listed(PROSE, page).includes(span) ||
    optionalFields(page).some(([word]: [string, string]): boolean => {
      return word === span;
    })
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

// The menu paths of a page that the Dashboard draws (not another product's).
function dashboardPaths(page: string): Array<Array<string>> {
  return boldPaths(englishPage(page)).filter(
    (segments: Array<string>): boolean => {
      return !listed(OTHER_NAMES, page).includes(segments.join(" → "));
    },
  );
}

/*
 * Every bold label, create button, form field and menu path of the English
 * page that a language draws in its own words, as the English page writes
 * it and as a page in the language must: [English bold, drawn bold]. A
 * Persian path is one bold span per segment.
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
      return [`**${button}**`, `**${drawnTableButton(language, button)}**`];
    }),
    ...optionalFields(page).map(
      ([word, title]: [string, string]): [string, string] => {
        return [`**${word}**`, `**${drawnFieldWithoutMark(language, title)}**`];
      },
    ),
    ...dashboardPaths(page).map((segments: Array<string>): [string, string] => {
      return [drawnPath("en", segments), drawnPath(language, segments)];
    }),
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
 * place: three or more Latin words of four letters, once code, link targets,
 * names and the bold words a page keeps in English are taken out.
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

    for (const kept of listed(OTHER_NAMES, page)) {
      text = text.split(`**${kept}**`).join(" ");
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
  it("name only pages of this task", () => {
    for (const lists of [
      CREATE_BUTTONS,
      OTHER_NAMES,
      PROSE,
      OPTIONAL_FIELDS,
      TRANSLATED_TABS,
      DIAGRAM_KINDS,
      WIDEST_DIAGRAM_LINE,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("follow the Terraform nav group, which opens with these pages", () => {
    const links: Array<NavLink> = navGroup("Terraform Provider").links;

    expect(
      links.map((link: NavLink): string => {
        return link.url;
      }),
    ).toEqual([...TERRAFORM_GROUP_URLS]);
    expect(
      links.slice(0, TERRAFORM_PAGES.length).map((link: NavLink) => {
        return [link.url, link.title];
      }),
    ).toEqual(
      TERRAFORM_PAGES.map((entry: TerraformDocsPageEntry): Array<string> => {
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
      const english: Array<string> = [
        ...boldLabels(englishPage(page)),
        ...boldPaths(englishPage(page)).map(
          (segments: Array<string>): string => {
            return segments.join(" → ");
          },
        ),
      ];
      const stale: Array<string> = [
        ...listed(OTHER_NAMES, page),
        ...listed(CREATE_BUTTONS, page),
        ...listed(PROSE, page),
        ...optionalFields(page).map(([word]: [string, string]): string => {
          return word;
        }),
      ].filter((span: string): boolean => {
        return !english.includes(span);
      });

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });

  it("draw the table buttons and form fields the English pages name as the English Dashboard does", () => {
    for (const page of PAGE_NAMES) {
      for (const button of listed(CREATE_BUTTONS, page)) {
        expect(drawnTableButton("en", button)).toBe(button);
      }

      for (const [word, title] of optionalFields(page)) {
        expect(drawnFieldWithoutMark("en", title)).toBe(word);
      }
    }
  });

  it("keep in English only what no Dashboard locale draws as a label of OneUptime's", () => {
    // GitHub's menu path is GitHub's: its first segment is no path of ours.
    for (const page of PAGE_NAMES) {
      for (const name of listed(OTHER_NAMES, page)) {
        expect(name.split(" → ")[0]).toBe("Settings");
      }
    }
  });
});

describe("the English pages", () => {
  it.each(TERRAFORM_PAGES)(
    "$page is titled with its nav link",
    (entry: TerraformDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(TERRAFORM_PAGES)(
    "$page draws at least one diagram, with a caption, of the kind the page draws",
    (entry: TerraformDocsPageEntry) => {
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

  it.each(TERRAFORM_PAGES)(
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: TerraformDocsPageEntry) => {
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

  it.each(TERRAFORM_PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: TerraformDocsPageEntry) => {
      expect(widestDiagramLine("en", entry.page)).toBeLessThanOrEqual(
        WIDEST_DIAGRAM_LINE[entry.page] as number,
      );
    },
  );

  it.each(TERRAFORM_PAGES)(
    "$page has no two headings with the same anchor, and skips no level",
    (entry: TerraformDocsPageEntry) => {
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

  it.each(TERRAFORM_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TerraformDocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(TERRAFORM_PAGES)(
    "$page says no 'left navigation', and links with /docs/ paths, never a relative one",
    (entry: TerraformDocsPageEntry) => {
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

  it.each(TERRAFORM_PAGES)(
    "$page writes a menu path as one bold path with arrows, never with '>'",
    (entry: TerraformDocsPageEntry) => {
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

  it("pin the provider's version with the placeholder, never a number written down", () => {
    for (const page of [TERRAFORM_OVERVIEW, QUICK_START, EXAMPLES]) {
      expect(englishPage(page)).toContain(
        `version = "${TERRAFORM_PROVIDER_VERSION_PLACEHOLDER}"`,
      );
    }

    expect(englishPage(TERRAFORM_OVERVIEW)).toContain(
      `provider ${TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER}.x is made from OneUptime ${TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER}.x`,
    );
  });
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(TERRAFORM_PAGES)("$page", (entry: TerraformDocsPageEntry) => {
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

    it("keeps every HCL block, command and file word for word, and builds every diagram the same way", () => {
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

    it("keeps every piece of inline code: attributes, values, outputs and errors", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the provider's version placeholders on the English one's lines", () => {
      expect(placeholdersByLine(readPage(language, entry.page))).toEqual(
        placeholdersByLine(english),
      );
    });

    it("keeps the tabs' labels that name products and systems, and words the others", () => {
      const translated: Array<string> = tabLabels(
        readPage(language, entry.page),
      );
      const worded: Array<string> = listed(TRANSLATED_TABS, entry.page);

      expect(translated).toHaveLength(tabLabels(english).length);

      tabLabels(english).forEach((label: string, index: number): void => {
        if (worded.includes(label)) {
          expect({ label, translated: translated[index] !== label }).toEqual({
            label,
            translated: true,
          });
          return;
        }

        expect(translated[index]).toBe(label);
      });
    });

    it("keeps the code in the first column of every table, row by row, and the numbers every row states", () => {
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
            numbers: numbersIn(outsideBoldSpans(translatedRow)),
          }).toEqual({
            table: index,
            row: rowIndex,
            code: ONLY_CODE.test(row[0] as string) ? row[0] : undefined,
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

    it("names every label, button, field and path the English page names, as this language's product draws it", () => {
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

    it("leaves no label, button or path in English where this language's product draws it otherwise", () => {
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
        ...listed(OTHER_NAMES, entry.page).map((name: string): string => {
          return `**${name}**`;
        }),
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

    it("keeps in English what every language keeps: GitHub's menu path and the Growth plan's name", () => {
      const translated: string = readPage(language, entry.page);
      const translatedLines: Array<string> = translated.split("\n");
      const missing: Array<string> = listed(OTHER_NAMES, entry.page).filter(
        (name: string): boolean => {
          return !translated.includes(`**${name}**`);
        },
      );

      expect(missing).toEqual([]);

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
        const kept: Array<string> = listed(OTHER_NAMES, entry.page).filter(
          (name: string): boolean => {
            return name.includes(RIGHT_ARROW);
          },
        );
        let text: string = prose(readPage(language, entry.page)).replace(
          INLINE_CODE_SPAN,
          " ",
        );

        for (const name of kept) {
          text = text.split(`**${name}**`).join(" ");
        }

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
  it("draw the API keys path, the table's button and the field path from the Dashboard's own keys", () => {
    expect(drawnPath("en", ["Project Settings", "Advanced", "API Keys"])).toBe(
      "**Project Settings → Advanced → API Keys**",
    );
    expect(drawnTableButton("en", "Create API Key")).toBe("Create API Key");
    expect(drawnFieldWithoutMark("en", "Field Path (Optional)")).toBe(
      "Field Path",
    );
    // A full-width "(Optional)" comes off too.
    expect(drawnFieldWithoutMark("ja", "Field Path (Optional)")).not.toMatch(
      OPTIONAL_MARK,
    );
    // A Persian path is a bold span per segment.
    expect(drawnPath("fa", ["Project Settings", "Advanced", "API Keys"])).toBe(
      ["Project Settings", "Advanced", "API Keys"]
        .map((_segment: string, index: number): string => {
          return `**${drawnPathSegment(
            "fa",
            ["Project Settings", "Advanced", "API Keys"],
            index,
          )}**`;
        })
        .join(" > "),
    );
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups, code and placeholders left out", () => {
    expect(numbersIn("up to 60,000")).toEqual(["60000"]);
    expect(numbersIn("تا ۶۰٬۰۰۰")).toEqual(["60000"]);
    expect(numbersIn("bis zu 60.000")).toEqual(["60000"]);
    expect(numbersIn("`port = 443` gives 2 checks")).toEqual(["2"]);
    expect(numbersIn("RFC 3339 and {{TERRAFORM_PROVIDER_MAJOR}}.x")).toEqual([
      "3339",
    ]);
  });

  it("find an untranslated line of prose, but not a line of names or code", () => {
    let names: string =
      "Terraform Registry, OpenTofu Registry, GitHub Actions, PowerShell";

    for (const name of NAMES_LONGEST_FIRST) {
      names = names.split(name).join(" ");
    }

    expect((names.match(LATIN_WORD) || []).length).toBeLessThan(3);
  });

  it("find the placeholders of each line", () => {
    expect(
      placeholdersByLine(
        `a\nversion = "${TERRAFORM_PROVIDER_VERSION_PLACEHOLDER}"\n${TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER}.x`,
      ),
    ).toEqual([
      `2: ${TERRAFORM_PROVIDER_VERSION_PLACEHOLDER}`,
      `3: ${TERRAFORM_PROVIDER_MAJOR_PLACEHOLDER}`,
    ]);
  });

  it("name every link's anchor by the heading in the English heading's place, in the reader's language", () => {
    expect(
      expectedLink("en", TERRAFORM_OVERVIEW, "#how-the-provider-works"),
    ).toBe("#how-the-provider-works");
    // An anchor that names no heading is kept as written, not made "#null".
    expect(expectedLink("fa", TERRAFORM_OVERVIEW, "#no-such-heading")).toBe(
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
