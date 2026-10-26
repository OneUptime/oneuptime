import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { INVENTORY_ASSET_FIELD_LABELS } from "../../../FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetLabels";
import { CUSTOM_FIELD_TYPE_LABELS } from "../../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import {
  INVENTORY_SOURCE_ORDER,
  getInventorySourceLabel,
} from "../../../FeatureSet/Dashboard/src/Components/Inventory/InventorySource";
import {
  API_REFERENCE,
  API_REFERENCE_PAGES,
  ASSET_DETAILS_HEADING,
  CMDB_SYNC,
  CREATE_BUTTONS,
  INVENTORY_AND_API_PAGES,
  INVENTORY_CUSTOM_FIELDS,
  INVENTORY_OVERVIEW,
  INVENTORY_PAGES,
  InventoryAndApiDocsPageEntry,
  KEPT_AS_WRITTEN,
  PERMISSION_NAMES,
  PLAN_NAMES,
  PRODUCT_NAMES,
  PROSE,
  WHOLE_LABELS,
} from "./InventoryAndApiDocsPages";
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
import { anchorInLanguage, sectionInLanguage } from "./NetworkDocsLabels";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import {
  INVENTORY_ASSET_FIELDS,
  InventoryAssetField,
} from "Common/Utils/Inventory/InventoryAssetDetails";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 26b: the Inventory pages - Inventory Overview,
 * Inventory Custom Fields and Exporting to a CMDB - and the OneUptime API
 * Reference, in every docs language. InventoryDocsFacts and
 * ApiReferenceDocsFacts hold the English pages to the product; this suite
 * holds each translation to its English page:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and tab on the English one's line, so a later
 *     English edit shows where it lands in every language;
 *   - the same code (the server's messages the API reference quotes
 *     included), diagrams (by their nodes and arrows, with label lines short
 *     enough for the 590px docs column), inline code, tables and the
 *     numbers of their rows, lists, steps and cards, and every link on the
 *     English one's line, its anchor naming the heading in the English
 *     heading's place;
 *   - every line of prose translated, and a title that is the nav link's.
 *
 * And it names the Dashboard the way that language's Dashboard draws it,
 * Persian included: a bold label by drawnLabel (a side menu item that is a
 * whole phrase by the locale's whole string, any other by
 * drawnActionLabel), a table's create button by drawnTableButton, a menu
 * path segment by segment (drawnPath: one bold span joined by " → "; in
 * Persian a bold span per segment joined by " > ", with no "→" left in the
 * prose), and the Asset Details facts, an item's sources and the custom
 * field types by the labels the Dashboard draws for them. What every
 * Dashboard draws in English stays English (KEPT_AS_WRITTEN, the
 * permission names and the plans). A bold word that is emphasis is
 * translated freely (PROSE). A new bold word on these English pages fails
 * "know every bold word" until it is a Dashboard label or listed.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE_NAMES: Array<string> = INVENTORY_AND_API_PAGES.map(
  (entry: InventoryAndApiDocsPageEntry): string => {
    return entry.page;
  },
);

/*
 * The labels the Dashboard draws by looking their whole text up, on any of
 * the pages (WHOLE_LABELS): where a locale has no wording of its own for
 * "Delete Item", the menu reads the English - it is not filled into a
 * "Delete {{itemName}}" template as a Settings card's action is.
 */
const WHOLE_LABEL_SET: Set<string> = new Set<string>(
  Object.values(WHOLE_LABELS).flatMap(
    (labels: ReadonlyArray<string>): Array<string> => {
      return [...labels];
    },
  ),
);

/*
 * Each page's diagrams fit the 590px docs column, in every language: their
 * label lines are broken (<br/>) to be no wider than this, counting a
 * Chinese, Japanese or Korean character twice. Each cap is the widest line
 * the 17 languages drew. A label put back on one line runs its diagram off
 * the column, and the docs scroll it rather than shrink it.
 */
const WIDEST_DIAGRAM_LINE: Record<string, number> = {
  [INVENTORY_OVERVIEW]: 26,
  [INVENTORY_CUSTOM_FIELDS]: 21,
  [CMDB_SYNC]: 25,
  [API_REFERENCE]: 24,
};

/*
 * The names, longest first: "Docker Swarm" goes before "Docker" takes its
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
/*
 * The comma a language lists items with: ", " in Latin, Cyrillic and
 * Devanagari text, "、" or the full-width "，" in Chinese and Japanese,
 * "، " in Persian.
 */
const LIST_ITEM_SEPARATOR: RegExp = /, |\u{3001}|\u{FF0C}|\u{060C} /u;
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const LINK_TARGET: RegExp = /\]\([^)\s]*\)/g;
// A word of four Latin letters or more: what an untranslated line is made of.
const LATIN_WORD: RegExp = /[A-Za-z]{4,}/g;
const FENCE_LINE: RegExp = /^\s*```/;
const LEFT_NAVIGATION: RegExp = /left nav/i;
const CAPTIONED_DIAGRAM: RegExp = /title="[^"]+"/;
const OWN_SECTION_CARD: RegExp = /^- \[[^\]]+\]\(#[^)]+\): /;

// The custom field types, in the picker's order.
const FIELD_TYPE_LABELS: Array<string> = Object.values(CustomFieldType).map(
  (type: CustomFieldType): string => {
    return CUSTOM_FIELD_TYPE_LABELS[type];
  },
);

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
    listed(PERMISSION_NAMES, page).includes(span) ||
    listed(PLAN_NAMES, page).includes(span) ||
    listed(PROSE, page).includes(span)
  );
}

// The bold words a page keeps as written in every language.
function keptBold(page: string): Array<string> {
  return [
    ...listed(KEPT_AS_WRITTEN, page),
    ...listed(PERMISSION_NAMES, page),
    ...listed(PLAN_NAMES, page),
  ];
}

/*
 * What this language's Dashboard draws for a bold label: a side menu item
 * that is a whole phrase draws the locale's value for its whole text, the
 * English where the locale holds the English (drawnDashboardLabel); any
 * other label is drawn as a named action would be (drawnActionLabel).
 */
function drawnLabel(language: string, label: string): string {
  return WHOLE_LABEL_SET.has(label)
    ? drawnDashboardLabel(language, label)
    : drawnActionLabel(language, label);
}

/*
 * The Dashboard labels a page names that drawnLabel draws: every bold
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
      return [`**${label}**`, `**${drawnLabel(language, label)}**`];
    }),
    ...listed(CREATE_BUTTONS, page).map((button: string): [string, string] => {
      return [`**${button}**`, `**${drawnTableButton(language, button)}**`];
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
 * there; a bold span is a Dashboard label another test holds.
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

function numbersIn(text: string): Array<string> {
  return Array.from(
    withoutDigitGroups(toLatinDigits(text))
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
 * Like linksByLine, it answers decoded: "#وضعیت" rather than "#%D9%88...".
 * An anchor that names no heading of the English page is kept as written.
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

    for (const kept of keptBold(page)) {
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

// The cells of a table's first column, header left out.
function firstColumn(table: Array<Array<string>> | undefined): Array<string> {
  return (table || []).slice(1).map((row: Array<string>): string => {
    return row[0] || "";
  });
}

/*
 * The table under a heading of a page in a language: the first table of
 * the section in the English section's place.
 */
function tableUnder(
  language: string,
  page: string,
  englishHeading: string,
): Array<Array<string>> | undefined {
  return tables(sectionInLanguage(language, page, englishHeading))[0];
}

function navGroup(title: string): NavGroup {
  return DocsNav.find((group: NavGroup): boolean => {
    return group.title === title;
  }) as NavGroup;
}

describe("the lists this test keeps", () => {
  it("name only pages of these groups", () => {
    for (const lists of [
      CREATE_BUTTONS,
      WHOLE_LABELS,
      KEPT_AS_WRITTEN,
      PERMISSION_NAMES,
      PLAN_NAMES,
      PROSE,
      WIDEST_DIAGRAM_LINE,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("follow the Inventory and API Reference nav groups, page for page", () => {
    for (const [group, entries] of [
      ["Inventory", INVENTORY_PAGES],
      ["API Reference", API_REFERENCE_PAGES],
    ] as Array<[string, ReadonlyArray<InventoryAndApiDocsPageEntry>]>) {
      expect(
        navGroup(group).links.map((link: NavLink): Array<string> => {
          return [link.url, link.title];
        }),
      ).toEqual(
        entries.map((entry: InventoryAndApiDocsPageEntry): Array<string> => {
          return [`/docs/${entry.page}`, entry.navTitle];
        }),
      );
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
        ...keptBold(page),
        ...listed(CREATE_BUTTONS, page),
        ...listed(WHOLE_LABELS, page),
        ...listed(PROSE, page),
      ].filter((span: string): boolean => {
        return !english.includes(span);
      });

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });

  it("keep in English only what no Dashboard locale has as a label", () => {
    for (const page of PAGE_NAMES) {
      for (const name of listed(KEPT_AS_WRITTEN, page)) {
        expect({ page, name, label: isActionLabel(name) }).toEqual({
          page,
          name,
          label: false,
        });
      }
    }
  });

  it("keep a permission's name as the permission pickers list it", () => {
    // Some enum values (session markers) have no title: they name nothing.
    const titles: Array<string> = Object.values(Permission).flatMap(
      (permission: Permission): Array<string> => {
        try {
          return [PermissionHelper.getTitle(permission)];
        } catch {
          return [];
        }
      },
    );

    for (const page of PAGE_NAMES) {
      for (const name of listed(PERMISSION_NAMES, page)) {
        expect({ page, name, permission: titles.includes(name) }).toEqual({
          page,
          name,
          permission: true,
        });
      }
    }
  });

  it("keep only the plans' own names", () => {
    for (const page of PAGE_NAMES) {
      for (const plan of listed(PLAN_NAMES, page)) {
        expect(Object.values(PlanType)).toContain(plan);
      }
    }
  });

  it("draw the table buttons the English pages name as the English Dashboard does", () => {
    for (const page of PAGE_NAMES) {
      for (const button of listed(CREATE_BUTTONS, page)) {
        expect(drawnTableButton("en", button)).toBe(button);
      }
    }
  });

  it("draw the labels it reads whole as the English Dashboard does, each a label of the Dashboard", () => {
    for (const page of PAGE_NAMES) {
      for (const label of listed(WHOLE_LABELS, page)) {
        expect(drawnDashboardLabel("en", label)).toBe(label);
        expect({ page, label, isLabel: isActionLabel(label) }).toEqual({
          page,
          label,
          isLabel: true,
        });
      }
    }
  });
});

describe("the English pages", () => {
  it.each(INVENTORY_AND_API_PAGES)(
    "$page is titled with its nav link",
    (entry: InventoryAndApiDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(INVENTORY_AND_API_PAGES)(
    "$page draws at least one diagram, with a caption",
    (entry: InventoryAndApiDocsPageEntry) => {
      const diagrams: Array<{ info: string }> = scanMarkdown(
        englishPage(entry.page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(CAPTIONED_DIAGRAM);
      }
    },
  );

  it.each(INVENTORY_AND_API_PAGES)(
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: InventoryAndApiDocsPageEntry) => {
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

  it.each(INVENTORY_AND_API_PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: InventoryAndApiDocsPageEntry) => {
      expect(widestDiagramLine("en", entry.page)).toBeLessThanOrEqual(
        WIDEST_DIAGRAM_LINE[entry.page] as number,
      );
    },
  );

  /*
   * A sequence diagram draws each participant 150px wide with 50px between
   * them, so three of them overrun the column whatever their labels say,
   * and a flowchart laid out left to right puts every step of a chain side
   * by side. The pages draw top to bottom, one step under the next.
   */
  it.each(INVENTORY_AND_API_PAGES)(
    "$page draws every diagram as a flowchart read top to bottom",
    (entry: InventoryAndApiDocsPageEntry) => {
      const kinds: Array<string> = scanMarkdown(englishPage(entry.page))
        .fences.filter((fence: { lang: string }): boolean => {
          return fence.lang === "mermaid";
        })
        .map((fence: { code: string }): string => {
          return fence.code.trim().split("\n")[0]?.trim() || "";
        });

      expect(kinds.length).toBeGreaterThan(0);
      expect(
        kinds.filter((kind: string): boolean => {
          return kind !== "flowchart TB";
        }),
      ).toEqual([]);
    },
  );

  it.each(INVENTORY_AND_API_PAGES)(
    "$page has no two headings with the same anchor, and skips no level",
    (entry: InventoryAndApiDocsPageEntry) => {
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

  it.each(INVENTORY_AND_API_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: InventoryAndApiDocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(INVENTORY_AND_API_PAGES)(
    "$page says no 'left navigation': products open from the Products menu",
    (entry: InventoryAndApiDocsPageEntry) => {
      expect(englishPage(entry.page)).not.toMatch(LEFT_NAVIGATION);
    },
  );

  it("the API reference's last heading but the troubleshooting and next steps is the endpoint reference, which is no longer a second 'API Reference'", () => {
    const headings: Array<string> = scanMarkdown(
      englishPage(API_REFERENCE),
    ).headings.map((heading: DocsHeading): string => {
      return heading.text;
    });

    expect(headings.slice(-3)).toEqual([
      "The full endpoint reference",
      "Troubleshooting",
      "Next steps",
    ]);
    expect(
      headings.filter((text: string): boolean => {
        return text.toLowerCase().includes("api reference");
      }),
    ).toEqual(["OneUptime API Reference"]);
  });
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(INVENTORY_AND_API_PAGES)(
    "$page",
    (entry: InventoryAndApiDocsPageEntry) => {
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

      it("keeps every piece of inline code: the fields, headers, endpoints and values", () => {
        expect(inlineCode(readPage(language, entry.page))).toEqual(
          inlineCode(english),
        );
      });

      it("has no tabs, as the English page has none", () => {
        expect(tabLabels(readPage(language, entry.page))).toEqual(
          tabLabels(english),
        );
      });

      it("keeps the code in the first column of every table, row by row, and the numbers every row states", () => {
        const translated: Array<Array<Array<string>>> = tables(
          readPage(language, entry.page),
        );

        tables(english).forEach(
          (table: Array<Array<string>>, index: number) => {
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
          },
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

        expect(cardTargets(translated)).toEqual(
          cardTargets(cardLines(english)),
        );
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

      it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
        const translated: string = readPage(language, entry.page);
        const missing: Array<string> = [
          ...dashboardLabels(entry.page).map((label: string): string => {
            return drawnLabel(language, label);
          }),
          ...listed(CREATE_BUTTONS, entry.page).map(
            (button: string): string => {
              return drawnTableButton(language, button);
            },
          ),
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
          ...keptBold(entry.page).map((name: string): string => {
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

      it("keeps in English what every Dashboard draws in English: the ⋯ menu, the Owned scope, workflow triggers, permissions and plans", () => {
        const translated: string = readPage(language, entry.page);
        const missing: Array<string> = keptBold(entry.page).filter(
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
    },
  );

  describe("what the pages name from the Dashboard, in its words", () => {
    it("the overview's sources table names each source as the list's Source column draws it", () => {
      expect(
        firstColumn(
          tableUnder(
            language,
            INVENTORY_OVERVIEW,
            "## How items get into Inventory",
          ),
        ),
      ).toEqual(
        INVENTORY_SOURCE_ORDER.map((source: string): string => {
          return `**${drawnLabel(language, getInventorySourceLabel(source))}**`;
        }),
      );
    });

    it("the custom fields page lists every field type as the Field Type picker draws it, in the picker's order", () => {
      expect(
        firstColumn(
          tableUnder(language, INVENTORY_CUSTOM_FIELDS, "## Defining Fields"),
        ),
      ).toEqual(
        FIELD_TYPE_LABELS.map((label: string): string => {
          return `**${drawnLabel(language, label)}**`;
        }),
      );
    });

    /*
     * The comparisons a chip offers are words the Dashboard does not always
     * draw as a phrase ("is" draws as a colon in Japanese and Korean), so
     * a translation words them freely; it keeps how many there are, for the
     * same field types.
     */
    it("the custom fields page lists as many comparisons as English for each field type, the types named as the picker draws them", () => {
      const translated: Array<Array<string>> = (
        tableUnder(language, INVENTORY_CUSTOM_FIELDS, "## Filter the list") ||
        []
      ).slice(1);
      const english: Array<Array<string>> = (
        tableUnder("en", INVENTORY_CUSTOM_FIELDS, "## Filter the list") || []
      ).slice(1);

      expect(translated.length).toBe(english.length);

      english.forEach((row: Array<string>, index: number): void => {
        const translatedRow: Array<string> = translated[index] || [];

        expect({
          row: index,
          types: boldSpans(translatedRow[0] || ""),
          comparisons: (translatedRow[1] || "").split(LIST_ITEM_SEPARATOR)
            .length,
        }).toEqual({
          row: index,
          types: boldSpans(row[0] as string).map((label: string): string => {
            return drawnLabel(language, label);
          }),
          comparisons: (row[1] as string).split(LIST_ITEM_SEPARATOR).length,
        });
      });
    });

    it("the CMDB page's Asset Details table names each fact as the Asset Details card labels it, in the card's order", () => {
      const facts: Array<string> = firstColumn(
        tableUnder(language, CMDB_SYNC, ASSET_DETAILS_HEADING),
      ).map((cell: string): string => {
        return cell.toLocaleLowerCase(language);
      });

      expect(facts).toEqual(
        INVENTORY_ASSET_FIELDS.map((field: InventoryAssetField): string => {
          return drawnDashboardLabel(
            language,
            INVENTORY_ASSET_FIELD_LABELS[field],
          ).toLocaleLowerCase(language);
        }),
      );
    });
  });
});

describe("the helpers, on these pages' shapes", () => {
  it("draw the Inventory product from the Products menu's key, and a side menu item from its whole text", () => {
    expect(drawnPath("en", ["Products", "Resources", "Inventory"])).toBe(
      "**Products → Resources → Inventory**",
    );
    // The Persian menu reads موجودی, from its own key; the flat label now reads the same.
    expect(
      drawnPathSegment("fa", ["Products", "Resources", "Inventory"], 2),
    ).toBe("موجودی");
    expect(drawnDashboardLabel("fa", "Inventory")).toBe("موجودی");
    // A side menu item is looked up whole: no "Delete {{itemName}}" is filled in.
    expect(drawnLabel("fa", "Delete Item")).toBe(
      drawnDashboardLabel("fa", "Delete Item"),
    );
  });

  it("draw a table's Add button from its verb's template", () => {
    expect(drawnTableButton("en", "Add Item")).toBe("Add Item");
    expect(drawnTableButton("de", "Add Item")).toBe("Element hinzufügen");
    expect(drawnTableButton("de", "Create API Key")).toBe(
      "API-Schlüssel erstellen",
    );
    expect(() => {
      return drawnTableButton("de", "Archive Item");
    }).toThrow();
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups", () => {
    expect(numbersIn("100,000 connections")).toEqual(["100000"]);
    expect(numbersIn("۱۰۰٬۰۰۰ اتصال")).toEqual(["100000"]);
    expect(numbersIn("30 Minuten und 1,5")).toEqual(["1.5", "30"]);
    // Every group of a number, however many it has, in any separator.
    expect(numbersIn("1,000,000 rows")).toEqual(["1000000"]);
    expect(numbersIn("1 000 000 lignes")).toEqual(["1000000"]);
    expect(numbersIn("1.000.000 Zeilen und 2,5")).toEqual(["1000000", "2.5"]);
  });

  it("find an untranslated line of prose, but not a line of names or code", () => {
    const english: Array<string> = englishPage(CMDB_SYNC).split("\n");
    const proseLine: number = english.findIndex((line: string): boolean => {
      return line.startsWith("If you already run a CMDB");
    });

    expect(proseLine).toBeGreaterThan(0);
    expect(
      (english[proseLine] as string).match(LATIN_WORD)!.length,
    ).toBeGreaterThanOrEqual(3);

    let names: string = "Cisco IOS, Junos OS, Arista EOS, Linux";

    for (const name of NAMES_LONGEST_FIRST) {
      names = names.split(name).join(" ");
    }

    expect((names.match(LATIN_WORD) || []).length).toBeLessThan(3);
  });

  it("name every link's anchor by the heading in the English heading's place, in the reader's language", () => {
    expect(expectedLink("en", API_REFERENCE, "#records-a-request-names")).toBe(
      "#records-a-request-names",
    );
    expect(
      expectedLink(
        "en",
        INVENTORY_OVERVIEW,
        "/docs/inventory/cmdb-sync#asset-details",
      ),
    ).toBe("/docs/inventory/cmdb-sync#asset-details");
    expect(
      expectedLink("en", INVENTORY_OVERVIEW, "/docs/inventory/custom-fields"),
    ).toBe("/docs/inventory/custom-fields");
    // An anchor that names no heading is kept as written, not made "#null".
    expect(expectedLink("fa", API_REFERENCE, "#no-such-heading")).toBe(
      "#no-such-heading",
    );
    expect(
      expectedLink(
        "fa",
        INVENTORY_OVERVIEW,
        "/docs/inventory/cmdb-sync#nowhere",
      ),
    ).toBe("/docs/inventory/cmdb-sync#nowhere");

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
