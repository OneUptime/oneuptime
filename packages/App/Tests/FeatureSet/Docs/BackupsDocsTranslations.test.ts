import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  BACKUPS_ADMIN_PATH_KEYS,
  BACKUPS_DIAGRAM_KIND,
  BACKUPS_NAMES,
  BACKUPS_NAV_AFTER,
  BACKUPS_NAV_BEFORE,
  BACKUPS_NAV_GROUP,
  BACKUPS_NAV_TITLE,
  BACKUPS_PAGE,
  BACKUPS_PROSE_LEADS,
  BACKUPS_WIDEST_DIAGRAM_LINE,
} from "./BackupsDocsPage";
import {
  DocsHeading,
  DocsLink,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { adminDashboardLabel, drawnAdminPath } from "./DocsAdminDashboard";
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
import { PERSIAN_PATH_SEPARATOR } from "./DocsProductsMenu";
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
import fs from "fs";
import path from "path";

/*
 * The Backups page (docs/installation/backups) in every docs language.
 * BackupsDocsFacts holds the English page to the product; this suite holds
 * each translation to the English page:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and step on the English one's line, so a later
 *     English edit shows where it lands in every language;
 *   - the diagram built the same way (its nodes and arrows), with label
 *     lines short enough for the 590px docs column, laid out in the order
 *     the language reads;
 *   - the same code blocks, inline code (file names, the policy's actions,
 *     the confirmation word, addresses), tables and the numbers their rows
 *     state, lists, steps and cards, and every link on the English one's
 *     line, its anchor naming the heading in the English heading's place;
 *   - every line of prose translated, and a title that is the nav link's.
 *
 * It names the Admin Dashboard the way each language's Admin Dashboard
 * draws it: every bold label of the page is a key of the Admin Dashboard's
 * locale (the Backups page's words, the destinations' fields), drawn by
 * adminDashboardLabel; the page's path, Settings then Backups, is one bold
 * span joined by " → " (in Persian a bold span per segment, joined by
 * " > "). The page's own bold leads (BACKUPS_PROSE_LEADS) are worded
 * freely. A new bold word on the English page fails "know every bold word"
 * until it is an Admin Dashboard label or a listed lead.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const ADMIN_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/AdminDashboard/src/Locales",
);

const NAMES_LONGEST_FIRST: Array<string> = [...BACKUPS_NAMES].sort(
  (a: string, b: string): number => {
    return b.length - a.length;
  },
);

const ONLY_CODE: RegExp = /^`[^`]+`$/;
// A number as a table states it: 30, 3650, 02:00 as 02 and 00.
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
// \s takes the no-break spaces French and others group digits with.
const DIGIT_GROUP: RegExp = /(\d)[\s.,'٬](\d{3})(?!\d)/g;
const RIGHT_ARROW: string = "→";
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const LINK_TARGET: RegExp = /\]\([^)\s]*\)/g;
// A word of four Latin letters or more: what an untranslated line is made of.
const LATIN_WORD: RegExp = /[A-Za-z]{4,}/g;
const FENCE_LINE: RegExp = /^\s*```/;
const CAPTIONED_DIAGRAM: RegExp = /title="[^"]+"/;
const OWN_SECTION_CARD: RegExp = /^- \[[^\]]+\]\(#[^)]+\): /;
const RELATIVE_MARKDOWN_LINK: RegExp = /\]\((?:\.{1,2}\/|[^)#:]*\.md)/;

function english(): string {
  return readPage("en", BACKUPS_PAGE);
}

function translatedPage(language: string): string {
  return readPage(language, BACKUPS_PAGE);
}

// The English Admin Dashboard's own words, keyed by themselves (translationKey).
const ADMIN_ENGLISH: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(ADMIN_LOCALES_DIR, "en.json"), "utf8"),
) as Record<string, unknown>;

// Whether the Admin Dashboard draws a label by a key that is its English text.
function isAdminLabel(label: string): boolean {
  return ADMIN_ENGLISH[label] === label;
}

function isCodeSpan(span: string): boolean {
  return ONLY_CODE.test(span);
}

function isProseLead(span: string): boolean {
  return BACKUPS_PROSE_LEADS.includes(span);
}

// The Admin Dashboard labels the page names: every bold label but its own leads.
function adminLabels(): Array<string> {
  return boldLabels(english()).filter((label: string): boolean => {
    return !isCodeSpan(label) && !isProseLead(label);
  });
}

/*
 * Every bold label and path of the Admin Dashboard that the English page
 * names, as the English page writes it and as a page in the language must:
 * [English bold, drawn bold]. A Persian path is one bold span per segment.
 */
function englishBoldDrawings(language: string): Array<[string, string]> {
  const labels: Array<string> = Array.from(new Set(adminLabels()));

  return [
    ...labels.map((label: string): [string, string] => {
      return [`**${label}**`, `**${adminDashboardLabel(language, label)}**`];
    }),
    ...boldPaths(english()).map((): [string, string] => {
      return [
        drawnAdminPath("en", BACKUPS_ADMIN_PATH_KEYS),
        drawnAdminPath(language, BACKUPS_ADMIN_PATH_KEYS),
      ];
    }),
  ];
}

/*
 * A text outside its bold spans. The numbers it states are there; a bold
 * span is a label the label checks hold, drawn as the Admin Dashboard draws
 * it - which can write a number the English words ("Every hour" is
 * "1 時間ごと" in Japanese).
 */
function outsideBold(text: string): string {
  return boldSpans(text).reduce((rest: string, span: string): string => {
    return rest.split(`**${span}**`).join(" ");
  }, text);
}

// A table row's text outside its bold spans.
function outsideBoldSpans(row: Array<string>): string {
  return outsideBold(row.join(" | "));
}

/*
 * A text with its numbers' digit groups joined: 1,000 to 1000. One pass
 * joins every other group, so it runs until nothing changes.
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

// The numbers a text states, code left out, in Latin digits.
function numbersIn(text: string): Array<string> {
  return Array.from(
    withoutDigitGroups(
      toLatinDigits(text.replace(INLINE_CODE_SPAN, " ")),
    ).matchAll(NUMBER),
  )
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .sort();
}

// The widest label line of each of the page's diagrams, in this language.
function widestDiagramLines(language: string): Array<number> {
  return scanMarkdown(translatedPage(language))
    .fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === "mermaid";
    })
    .map((fence: { code: string }): number => {
      return Math.max(...diagramLabelLines(fence.code).map(labelLineWidth));
    });
}

function headingLevels(markdown: string): Array<number> {
  return scanMarkdown(markdown).headings.map((heading: DocsHeading) => {
    return heading.level;
  });
}

/*
 * A link as a translation must write it on the English one's line: the same
 * page, and the anchor of the heading in the English heading's place in the
 * reader's language. The page's own anchors ("#x") open the page itself.
 * It answers decoded: "#مقصدها" rather than "#%D9%85...".
 */
function expectedLink(language: string, target: string): string {
  const ownAnchor: boolean = target.startsWith("#");
  const parsed: { page: string; anchor: string | null } | null = ownAnchor
    ? { page: BACKUPS_PAGE, anchor: target.slice(1) }
    : parseDocsLink(target);

  if (!parsed || !parsed.anchor) {
    return decodeURIComponent(target);
  }

  const served: string = hasPage(language, parsed.page) ? language : "en";
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
 * names and the labels this language's Admin Dashboard still draws in
 * English are taken out.
 */
function untranslatedLines(language: string): Array<string> {
  const englishLines: Array<string> = english().split("\n");
  const translated: Array<string> = translatedPage(language).split("\n");
  const drawnInEnglish: Array<string> = englishBoldDrawings(language)
    .filter((drawing: [string, string]): boolean => {
      return drawing[0] === drawing[1];
    })
    .map((drawing: [string, string]): string => {
      return drawing[0];
    });
  const found: Array<string> = [];
  let inFence: boolean = false;

  englishLines.forEach((line: string, index: number): void => {
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

    for (const kept of drawnInEnglish) {
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
  it("list the page in the Installation group, after Upgrading", () => {
    const links: Array<NavLink> = navGroup(BACKUPS_NAV_GROUP).links;
    const index: number = links.findIndex((link: NavLink): boolean => {
      return link.url === `/docs/${BACKUPS_PAGE}`;
    });

    expect(index).toBeGreaterThan(0);
    expect(links[index]?.title).toBe(BACKUPS_NAV_TITLE);
    expect(links[index - 1]?.title).toBe(BACKUPS_NAV_AFTER);
    expect(links[index + 1]?.title).toBe(BACKUPS_NAV_BEFORE);
  });

  it("know every bold word on the English page: an Admin Dashboard label or path, or one of its leads", () => {
    const unlisted: Array<string> = [
      ...boldLabels(english()).filter((span: string): boolean => {
        return !isCodeSpan(span) && !isProseLead(span) && !isAdminLabel(span);
      }),
      ...boldPaths(english())
        .map((segments: Array<string>): string => {
          return segments.join(PATH_SEPARATOR);
        })
        .filter((written: string): boolean => {
          return (
            `**${written}**` !== drawnAdminPath("en", BACKUPS_ADMIN_PATH_KEYS)
          );
        }),
    ];

    expect(unlisted).toEqual([]);
  });

  it("list only leads the English page has, none of them an Admin Dashboard label", () => {
    const labels: Array<string> = boldLabels(english());

    for (const lead of BACKUPS_PROSE_LEADS) {
      expect({ lead, onPage: labels.includes(lead) }).toEqual({
        lead,
        onPage: true,
      });
      expect({ lead, label: isAdminLabel(lead) }).toEqual({
        lead,
        label: false,
      });
    }
  });

  it("draw the page's path from the Admin Dashboard's breadcrumb", () => {
    expect(drawnAdminPath("en", BACKUPS_ADMIN_PATH_KEYS)).toBe(
      "**Settings → Backups**",
    );
    expect(boldPaths(english())).toEqual([["Settings", "Backups"]]);
    // Persian bolds each segment, joined by " > ".
    expect(drawnAdminPath("fa", BACKUPS_ADMIN_PATH_KEYS)).toContain(
      PERSIAN_PATH_SEPARATOR,
    );
  });
});

describe("the English page", () => {
  it("is titled with its nav link", () => {
    expect(english().split("\n")[0]).toBe(`# ${BACKUPS_NAV_TITLE}`);
  });

  it("draws one captioned diagram of a backup's steps, top to bottom", () => {
    const diagrams: Array<{ info: string; code: string }> = scanMarkdown(
      english(),
    ).fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === "mermaid";
    });

    expect(diagrams).toHaveLength(1);
    expect(diagrams[0]?.info).toMatch(CAPTIONED_DIAGRAM);
    expect(diagrams[0]?.code.trim().split("\n")[0]?.trim()).toBe(
      BACKUPS_DIAGRAM_KIND,
    );
  });

  it("opens with cards to its own sections and ends on a Next steps section of cards", () => {
    const markdown: string = english();
    const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
    const last: DocsHeading = headings[headings.length - 1] as DocsHeading;
    const opening: Array<string> = cardLines(
      markdown.slice(0, markdown.indexOf("\n## ")),
    );

    expect(opening.length).toBeGreaterThanOrEqual(3);

    for (const line of opening) {
      expect(line).toMatch(OWN_SECTION_CARD);
    }

    expect(last).toEqual(expect.objectContaining({ level: 2 }));
    expect(last.text).toBe("Next steps");
    expect(markdown.split(":::cards").length - 1).toBe(2);
    expect(
      cardLines(markdown.slice(markdown.lastIndexOf("\n## Next steps\n")))
        .length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("has a Before you begin section and a Troubleshooting section of collapsible answers", () => {
    const headings: Array<string> = scanMarkdown(english()).headings.map(
      (heading: DocsHeading): string => {
        return heading.text;
      },
    );
    const troubleshooting: string = english().slice(
      english().indexOf("\n## Troubleshooting\n"),
      english().indexOf("\n## Next steps\n"),
    );

    expect(headings).toContain("Before you begin");
    expect(headings).toContain("Troubleshooting");
    expect(troubleshooting.split(":::details ").length - 1).toBeGreaterThan(1);
  });

  it("breaks its diagram's labels to fit the 590px docs column", () => {
    expect(widestDiagramLines("en")[0]).toBeLessThanOrEqual(
      BACKUPS_WIDEST_DIAGRAM_LINE,
    );
  });

  it("has no two headings with the same anchor, and skips no level", () => {
    const headings: Array<DocsHeading> = scanMarkdown(english()).headings;
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
  });

  it("closes every bold and code span it opens", () => {
    expect(unbalancedLines(english())).toEqual([]);
  });

  it("links with /docs/ paths and its own anchors only, never a relative one", () => {
    expect(english()).not.toMatch(RELATIVE_MARKDOWN_LINK);

    for (const link of scanMarkdown(english()).links) {
      expect({
        link: link.target,
        absolute:
          link.target.startsWith("#") || link.target.startsWith("/docs/"),
      }).toEqual({ link: link.target, absolute: true });
    }
  });

  it("writes the Admin Dashboard path as one bold path with arrows, never with '>'", () => {
    const oldPaths: Array<string> = boldSpans(prose(english())).filter(
      (span: string): boolean => {
        return span.includes(" > ") && !isCodeSpan(span);
      },
    );

    expect(oldPaths).toEqual([]);
  });

  it("has no tabs: nothing on it is a choice between alternatives", () => {
    expect(tabLabels(english())).toEqual([]);
  });
});

describe.each(LANGUAGES)("%s", (language: string) => {
  it("is translated, under the nav link's title", () => {
    expect(hasPage(language, BACKUPS_PAGE)).toBe(true);

    const title: string = navTitle(language, BACKUPS_NAV_TITLE);

    expect(translatedPage(language)).not.toEqual(english());
    expect(typeof title).toBe("string");
    expect(title.trim()).not.toBe("");
    expect(translatedPage(language).split("\n")[0]).toBe(`# ${title}`);
  });

  it("lies line for line beside the English page: headings, table rows, fences and components on the same lines", () => {
    expect(lineShape(translatedPage(language))).toEqual(lineShape(english()));
  });

  it("translates every line of prose", () => {
    expect(untranslatedLines(language)).toEqual([]);
  });

  it("builds the diagram the same way, and keeps every other code block exactly", () => {
    expect(
      scanMarkdown(translatedPage(language)).fences.map(comparableFence),
    ).toEqual(scanMarkdown(english()).fences.map(comparableFence));

    const codeBlocks: (markdown: string) => Array<string> = (
      markdown: string,
    ): Array<string> => {
      return scanMarkdown(markdown)
        .fences.filter((fence: { lang: string }): boolean => {
          return fence.lang !== "mermaid";
        })
        .map((fence: { code: string }): string => {
          return fence.code;
        });
    };

    expect(codeBlocks(translatedPage(language))).toEqual(codeBlocks(english()));
  });

  it("breaks its diagram's labels into lines short enough for the 590px docs column", () => {
    for (const width of widestDiagramLines(language)) {
      expect(width).toBeLessThanOrEqual(BACKUPS_WIDEST_DIAGRAM_LINE);
    }
  });

  it("keeps every piece of inline code: file names, addresses, actions and the word a restore is confirmed with", () => {
    expect(inlineCode(translatedPage(language))).toEqual(inlineCode(english()));
  });

  it("keeps the numbers every table row states, such as the days backups are kept", () => {
    const translated: Array<Array<Array<string>>> = tables(
      translatedPage(language),
    );

    tables(english()).forEach((table: Array<Array<string>>, index: number) => {
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

  it("states every number the English prose states, outside the labels it draws", () => {
    expect(numbersIn(outsideBold(prose(translatedPage(language))))).toEqual(
      numbersIn(outsideBold(prose(english()))),
    );
  });

  it("closes every bold and code span it opens", () => {
    expect(unbalancedLines(translatedPage(language))).toEqual([]);
  });

  it("draws every bold and italic span, with no asterisks or underscores left on the page", async () => {
    expect(await strayMarkers(translatedPage(language), language)).toEqual([]);
  });

  it("has the English page's headings, steps, tables and list items", () => {
    const translated: string = translatedPage(language);

    expect(headingLevels(translated)).toEqual(headingLevels(english()));
    expect(stepCount(translated)).toBe(stepCount(english()));
    expect(tableShape(translated)).toEqual(tableShape(english()));
    expect(listItemCount(translated)).toBe(listItemCount(english()));
    expect(tabLabels(translated)).toEqual([]);
  });

  it("writes its cards with an ASCII ': ' after the link, to the English cards' pages", () => {
    const translated: Array<string> = cardLines(translatedPage(language));

    expect(translated.length).toBe(cardLines(english()).length);

    for (const line of translated) {
      expect({ line, ascii: CARD_LINE.test(line) }).toEqual({
        line,
        ascii: true,
      });
    }

    expect(cardTargets(translated)).toEqual(cardTargets(cardLines(english())));
  });

  it("names each Next steps card by its page's nav title in this language", () => {
    const translated: string = translatedPage(language);
    const nextSteps: Array<string> = cardLines(
      translated.slice(translated.lastIndexOf("\n## ")),
    );
    const englishNextSteps: Array<string> = cardLines(
      english().slice(english().lastIndexOf("\n## Next steps\n")),
    );

    expect(nextSteps.length).toBe(englishNextSteps.length);

    englishNextSteps.forEach((line: string, index: number): void => {
      const englishTitle: string = line.slice(3, line.indexOf("]("));

      expect({
        card: nextSteps[index],
        named: nextSteps[index]?.startsWith(
          `- [${navTitle(language, englishTitle)}](`,
        ),
      }).toEqual({ card: nextSteps[index], named: true });
    });
  });

  it("links only to anchors that are headings of the page they open", () => {
    expect(anchorProblems(language, BACKUPS_PAGE)).toEqual([]);
  });

  it("has every link on the English one's line, its anchor naming the heading in the English heading's place", () => {
    const translated: Array<string> = linksByLine(translatedPage(language));
    const original: Array<DocsLink> = scanMarkdown(english()).links;

    expect(translated).toHaveLength(original.length);

    original.forEach((link: DocsLink, index: number): void => {
      expect(translated[index]).toBe(
        `${link.line}: ${expectedLink(language, link.target)}`,
      );
    });
  });

  it("names every Admin Dashboard label and the page's path as this language's Admin Dashboard draws them", () => {
    const translated: string = translatedPage(language);
    const missing: Array<string> = englishBoldDrawings(language)
      .map((drawing: [string, string]): string => {
        return drawing[1];
      })
      .filter((drawn: string): boolean => {
        return !translated.includes(drawn);
      });

    expect(missing).toEqual([]);
  });

  it("leaves no Admin Dashboard label in English where this language's Admin Dashboard draws it otherwise", () => {
    const translated: string = translatedPage(language);
    const drawnHere: Array<[string, string]> = englishBoldDrawings(language);
    const meant: Set<string> = new Set(
      drawnHere.map((drawing: [string, string]): string => {
        return drawing[1];
      }),
    );
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

  if (language === "fa") {
    it("joins the Admin Dashboard path with ' > ', leaving no '→' in its prose", () => {
      const text: string = prose(translatedPage(language)).replace(
        INLINE_CODE_SPAN,
        " ",
      );

      expect(text.split(RIGHT_ARROW).length - 1).toBe(0);
    });
  }

  it("lays out every diagram line in the order it reads: right to left on a right-to-left page", () => {
    expect(
      linesLaidOutBackwards(
        translatedPage(language),
        getDocsLanguageDirection(language),
      ),
    ).toEqual([]);
  });
});

describe("the helpers, on this page's shape", () => {
  it("tell an Admin Dashboard label from the page's own leads", () => {
    expect(isAdminLabel("Set up backups")).toBe(true);
    expect(isAdminLabel("Keep backups for (days)")).toBe(true);
    // A destination field, from the catalog.
    expect(isAdminLabel("Secret access key")).toBe(true);
    expect(isAdminLabel("Consistent.")).toBe(false);
    expect(adminLabels()).toContain("Test the destination");
    expect(adminLabels()).not.toContain("Encrypted.");
  });

  it("read the numbers a row states, in any digits, code left out", () => {
    expect(
      numbersIn("`us-east-1` from 1 to 3,650 days, 30 by default"),
    ).toEqual(["1", "30", "3650"]);
    expect(numbersIn("از ۱ تا ۳۶۵۰ روز")).toEqual(["1", "3650"]);
  });

  it("find an untranslated line of prose, but not a line of names or code", () => {
    let names: string =
      "Amazon S3, Cloudflare R2, Backblaze B2, Google Cloud Storage, Azure Blob Storage";

    for (const name of NAMES_LONGEST_FIRST) {
      names = names.split(name).join(" ");
    }

    expect((names.match(LATIN_WORD) || []).length).toBeLessThan(3);
  });

  it("name a link's anchor by the heading in the English heading's place, in the reader's language", () => {
    expect(expectedLink("en", "#set-up-backups")).toBe("#set-up-backups");
    // An anchor that names no heading is kept as written, not made "#null".
    expect(expectedLink("de", "#no-such-heading")).toBe("#no-such-heading");
    expect(expectedLink("de", "#set-up-backups")).toBe("#backups-einrichten");
  });
});
