import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { CUSTOM_DOMAIN_STATUS } from "../../../FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy";
import {
  AUTHORING,
  CONFIGURATION,
  CREATE_BUTTONS,
  DASHBOARDS_INDEX,
  DASHBOARDS_PAGES,
  DATA_SOURCES,
  DashboardsDocsPageEntry,
  KEPT_AS_WRITTEN,
  MENU_ITEM_LABELS,
  NAME_TABS,
  PERMISSION_NAMES,
  PLAYLISTS,
  PRODUCT_NAMES,
  PROSE,
  SHARING,
  TEMPLATE_CATEGORIES,
  VARIABLES,
  WIDGETS,
} from "./DashboardsDocsPages";
import {
  DocsHeading,
  DocsLink,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  dashboardLocale,
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
import { drawnMenuItem, drawnPath, drawnPathSegment } from "./DocsProductsMenu";
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
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 26a: the Dashboards group - Dashboards Overview,
 * Authoring a Dashboard, Dashboard Widgets, Dashboard Variables & Filters,
 * External Data Sources, Sharing & Public Dashboards, Dashboard Playlists
 * (#5235) and Dashboard Configuration & Permissions - in every docs
 * language. DashboardsDocsFacts
 * holds the English pages to the product; this suite holds each translation
 * to its English page:
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
 * Persian included: a bold label by drawnLabel (a menu item's by the
 * locale's whole phrase, any other by drawnActionLabel), a table's create
 * button by drawnCreateButton, a menu path segment by segment (drawnPath:
 * one bold span joined by " → "; in Persian a bold span per segment joined
 * by " > ", with no "→" left in the prose), the custom domain's Status
 * column and the lines the sharing page quotes from the Dashboard by the
 * language's own wording. What every Dashboard draws in English stays
 * English (KEPT_AS_WRITTEN, PERMISSION_NAMES and the plans), and so do the
 * messages the server and the public dashboard write in English
 * (ENGLISH_QUOTES). A bold word that is emphasis is translated freely
 * (PROSE). A new bold word on these English pages fails "know every bold
 * word" until it is a Dashboard label or listed.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE_NAMES: Array<string> = DASHBOARDS_PAGES.map(
  (entry: DashboardsDocsPageEntry): string => {
    return entry.page;
  },
);

/*
 * The plans the pages name. The Dashboard shows a plan's name as written
 * (a plan-gated choice names the plan it needs), although some locales hold
 * a translation of the same English word as a label ("Scale" as a verb).
 */
const PLAN_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [DATA_SOURCES]: [PlanType.Growth],
  [SHARING]: [PlanType.Growth, PlanType.Scale],
};

/*
 * Each page's diagrams fit the 590px docs column, measured in a browser with
 * the docs' own font, in every language: their label lines are broken
 * (<br/>) to be no wider than this, counting a Chinese, Japanese or Korean
 * character twice. Each cap is the widest line the 17 languages drew when
 * they were measured. A label put back on one line runs its diagram off the
 * column, and the docs scroll it rather than shrink it.
 */
const WIDEST_DIAGRAM_LINE: Record<string, number> = {
  [DASHBOARDS_INDEX]: 25,
  [AUTHORING]: 23,
  [WIDGETS]: 23,
  [VARIABLES]: 26,
  [DATA_SOURCES]: 26,
  [SHARING]: 25,
  [PLAYLISTS]: 25,
  [CONFIGURATION]: 24,
};

/*
 * Lines the pages quote from the Dashboard: a folded section's summary and
 * a dialog's answer. Every language quotes them as its Dashboard words them.
 */
const DASHBOARD_QUOTES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [SHARING]: [
    "We issue a free SSL certificate for this domain and renew it automatically.",
    "Your CNAME record is verified.",
  ],
};

/*
 * Text every language quotes in English: what the server and the public
 * dashboard write (they have no locale), the names a template gives a
 * dashboard and a copy, and the words the widget catalog's search matches,
 * which are its English labels and keywords.
 */
const ENGLISH_QUOTES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [AUTHORING]: ["Kubernetes Dashboard 2", '"error budget"', '"pods"'],
  [DATA_SOURCES]: [
    "Only read-only queries are allowed",
    "Only a single SQL statement is allowed per query.",
    "Query contains a keyword that is not allowed",
  ],
  [SHARING]: [
    "The logo's file could not be found. Upload the logo again.",
    "The dark theme logo's file could not be found. Upload the dark theme logo again.",
    "The favicon's file could not be found. Upload the favicon again.",
    "Custom Domains not enabled for this OneUptime installation",
  ],
  [CONFIGURATION]: ["Dashboard not found", "Checkout API 2", "Checkout API 3"],
};

/*
 * The names, longest first: "Kubernetes Cost Dashboard" goes before
 * "Kubernetes" takes its first word.
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
 * What this language's Dashboard draws for a bold label: a menu item draws
 * the locale's value for its whole text, the English where the locale holds
 * the English (drawnDashboardLabel); a named action fills the locale's
 * template with the model's name where the locale has no phrase of its own
 * (drawnActionLabel).
 */
function drawnLabel(language: string, label: string): string {
  return MENU_ITEM_LABELS.includes(label)
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
      return [`**${button}**`, `**${drawnCreateButton(language, button)}**`];
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
 * A page whose copy in this language still has its old shape (a page of
 * another group a translation has not caught up with) has no heading in the
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

    for (const quote of listed(ENGLISH_QUOTES, page)) {
      text = text.split(quote).join(" ");
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

// A flat key of the Dashboard's locale in a language, or its English.
function localeValue(language: string, english: string): string {
  const value: unknown = dashboardLocale(language)[english];

  return typeof value === "string" && value.trim() ? value : english;
}

// The first cells of the sharing page's custom domain Status table.
function statusColumn(markdown: string): Array<string> {
  const statusTables: Array<Array<Array<string>>> = tables(markdown).filter(
    (table: Array<Array<string>>): boolean => {
      return table.length === Object.keys(CUSTOM_DOMAIN_STATUS).length + 1;
    },
  );

  return (statusTables[0] || []).slice(1).map((row: Array<string>): string => {
    return row[0] as string;
  });
}

function dashboardsNavGroup(): NavGroup {
  return DocsNav.find((group: NavGroup): boolean => {
    return group.title === "Dashboards";
  }) as NavGroup;
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      CREATE_BUTTONS,
      KEPT_AS_WRITTEN,
      PERMISSION_NAMES,
      PLAN_NAMES,
      PROSE,
      WIDEST_DIAGRAM_LINE,
      DASHBOARD_QUOTES,
      ENGLISH_QUOTES,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("follow the Dashboards nav group, page for page", () => {
    expect(
      dashboardsNavGroup().links.map((link: NavLink): Array<string> => {
        return [link.url, link.title];
      }),
    ).toEqual(
      DASHBOARDS_PAGES.map((entry: DashboardsDocsPageEntry): Array<string> => {
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
      const stale: Array<string> = [
        ...keptBold(page),
        ...listed(CREATE_BUTTONS, page),
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

  it("draw the create buttons the English pages name as the English Dashboard does", () => {
    for (const page of PAGE_NAMES) {
      for (const button of listed(CREATE_BUTTONS, page)) {
        expect(drawnCreateButton("en", button)).toBe(button);
      }
    }
  });

  it("keep system names as tab labels only where the English pages have them", () => {
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

  it("quote only what the English pages quote, the Dashboard's lines as its English locale has them", () => {
    for (const page of PAGE_NAMES) {
      for (const quote of [
        ...listed(DASHBOARD_QUOTES, page),
        ...listed(ENGLISH_QUOTES, page),
      ]) {
        expect({
          page,
          quote,
          quoted: englishPage(page).includes(quote),
        }).toEqual({ page, quote, quoted: true });
      }

      for (const quote of listed(DASHBOARD_QUOTES, page)) {
        expect(dashboardLocale("en")[quote]).toBe(quote);
      }
    }
  });
});

describe("the English pages", () => {
  it.each(DASHBOARDS_PAGES)(
    "$page is titled with its nav link",
    (entry: DashboardsDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(DASHBOARDS_PAGES)(
    "$page draws at least one diagram, with a caption",
    (entry: DashboardsDocsPageEntry) => {
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

  it.each(DASHBOARDS_PAGES)(
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: DashboardsDocsPageEntry) => {
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

  it.each(DASHBOARDS_PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: DashboardsDocsPageEntry) => {
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
  it.each(DASHBOARDS_PAGES)(
    "$page draws every diagram as a flowchart read top to bottom",
    (entry: DashboardsDocsPageEntry) => {
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

  it.each(DASHBOARDS_PAGES)(
    "$page has no two headings with the same anchor",
    (entry: DashboardsDocsPageEntry) => {
      const slugs: Array<string> = scanMarkdown(
        englishPage(entry.page),
      ).headings.map((heading: DocsHeading): string => {
        return heading.slug;
      });

      expect(slugs.length).toBe(new Set(slugs).size);
    },
  );

  it.each(DASHBOARDS_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: DashboardsDocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(DASHBOARDS_PAGES)(
    "$page says no 'left navigation': products open from the Products menu",
    (entry: DashboardsDocsPageEntry) => {
      expect(englishPage(entry.page)).not.toMatch(LEFT_NAVIGATION);
    },
  );

  it("the custom domain Status table is the Dashboard's own column, row for row", () => {
    expect([...statusColumn(englishPage(SHARING))].sort()).toEqual(
      Object.values(CUSTOM_DOMAIN_STATUS).sort(),
    );
  });
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(DASHBOARDS_PAGES)("$page", (entry: DashboardsDocsPageEntry) => {
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

    it("keeps every piece of inline code: the attributes, settings, macros and values", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the tab labels that name a system, and translates the others", () => {
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
          `${link.line}: ${link.target.split("#")[0]}`,
        );
      });
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...dashboardLabels(entry.page).map((label: string): string => {
          return drawnLabel(language, label);
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

    it("keeps in English what every Dashboard draws in English: the template cards, untranslated settings, permissions and plans", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = keptBold(entry.page).filter(
        (name: string): boolean => {
          return !translated.includes(`**${name}**`);
        },
      );

      expect(missing).toEqual([]);
    });

    it("quotes the server's and the public dashboard's messages in English, and the Dashboard's lines as this language's Dashboard words them", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(ENGLISH_QUOTES, entry.page),
        ...listed(DASHBOARD_QUOTES, entry.page).map((quote: string): string => {
          return localeValue(language, quote);
        }),
      ].filter((quote: string): boolean => {
        return !translated.includes(quote);
      });

      expect(missing).toEqual([]);
    });

    if (entry.page === SHARING) {
      it("lists the custom domain Status column as this language's Dashboard words it", () => {
        expect(statusColumn(readPage(language, SHARING))).toEqual(
          statusColumn(english).map((status: string): string => {
            return localeValue(language, status);
          }),
        );
      });
    }

    if (entry.page === AUTHORING) {
      /*
       * Create a dashboard's category select looks its categories up, so a
       * category reads as this language's Dashboard draws it; the templates
       * are catalog content, written in English in every picker.
       */
      it("files every template under its category as the category select draws it, the templates in English", () => {
        const translated: string = readPage(language, AUTHORING);
        const englishRows: Array<Array<string>> =
          tables(english)[0]?.slice(1) || [];

        expect(
          englishRows.map((row: Array<string>): string => {
            return row[0] as string;
          }),
        ).toEqual([...TEMPLATE_CATEGORIES]);
        expect(tables(translated)[0]?.slice(1)).toEqual(
          englishRows.map((row: Array<string>): Array<string> => {
            return [
              drawnDashboardLabel(language, row[0] as string),
              ...row.slice(1),
            ];
          }),
        );
      });

      it("names the recommended templates in English, after Recommended as this language's Dashboard draws it", () => {
        const translated: string = readPage(language, AUTHORING);
        const recommended: string = `**${drawnDashboardLabel(
          language,
          "Recommended",
        )}**`;
        const line: string | undefined = translated
          .split("\n")
          .find((candidate: string): boolean => {
            return (
              candidate.includes(recommended) &&
              candidate.includes("Metrics Dashboard")
            );
          });

        expect(line).toBeDefined();

        for (const name of [
          "Monitor Dashboard",
          "Incident Dashboard",
          "Alert Dashboard",
          "Kubernetes Dashboard",
          "Hosts Dashboard",
          "Metrics Dashboard",
        ]) {
          expect({ name, named: (line || "").includes(name) }).toEqual({
            name,
            named: true,
          });
        }
      });
    }

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
  it("draw a path through the Products menu from the menu's keys: the Russian menu's Dashboards, not the page title's", () => {
    expect(drawnPath("en", ["Products", "Dashboards"])).toBe(
      "**Products → Dashboards**",
    );
    expect(drawnPathSegment("ru", ["Products", "Dashboards"], 1)).toBe(
      "Дашборды",
    );
    expect(drawnActionLabel("ru", "Dashboards")).toBe("Панели");
    expect(drawnPath("fa", ["Products", "Teams"])).toBe(
      `**${drawnActionLabel("fa", "Products")}** > **${drawnMenuItem("fa", "Teams")}**`,
    );
  });

  it("draw a menu item as the locale holds its whole text, and a Settings card's action from its template", () => {
    /*
     * The Italian locale words "Edit Dashboard" and "Export JSON" whole
     * (the menu's export words left English in 12 languages until #5248's
     * follow-up translated them).
     */
    expect(drawnLabel("it", "Edit Dashboard")).toBe("Modifica dashboard");
    expect(drawnLabel("it", "Export JSON")).toBe("Esporta JSON");
    expect(drawnLabel("de", "Edit Dashboard")).toBe(
      drawnDashboardLabel("de", "Edit Dashboard"),
    );
    // DuplicateModel draws "Duplicate {{itemName}}" with the model's name.
    expect(drawnLabel("it", "Duplicate Dashboard")).toBe("Duplica: Dashboard");
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups", () => {
    expect(numbersIn("11,000 points")).toEqual(["11000"]);
    expect(numbersIn("۱۱٬۰۰۰ نقطه")).toEqual(["11000"]);
    expect(numbersIn("20 MB et 0,25")).toEqual(["0.25", "20"]);
  });

  it("find an untranslated line of prose, but not a line of names or code", () => {
    const english: Array<string> = englishPage(DATA_SOURCES).split("\n");
    const proseLine: number = english.findIndex((line: string): boolean => {
      return line.startsWith("An external data source connects");
    });
    const namesLine: number = english.findIndex((line: string): boolean => {
      return line.startsWith("| Prometheus | PromQL |");
    });

    expect(proseLine).toBeGreaterThan(0);
    expect(namesLine).toBeGreaterThan(0);
    expect(
      (english[proseLine] as string).match(LATIN_WORD)!.length,
    ).toBeGreaterThanOrEqual(3);

    let names: string = english[namesLine] as string;

    for (const name of NAMES_LONGEST_FIRST) {
      names = names.split(name).join(" ");
    }

    expect((names.match(LATIN_WORD) || []).length).toBeLessThan(3);
  });

  it("read the Status column out of the sharing page's table", () => {
    expect(statusColumn(englishPage(SHARING))).toHaveLength(
      Object.keys(CUSTOM_DOMAIN_STATUS).length,
    );
  });

  it("name every link's anchor by the heading in the English heading's place, in the reader's language", () => {
    expect(expectedLink("en", WIDGETS, "#which-widget-should-i-use")).toBe(
      "#which-widget-should-i-use",
    );
    expect(expectedLink("en", VARIABLES, "/docs/dashboards/widgets#slo")).toBe(
      "/docs/dashboards/widgets#slo",
    );
    expect(expectedLink("en", VARIABLES, "/docs/dashboards/widgets")).toBe(
      "/docs/dashboards/widgets",
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
