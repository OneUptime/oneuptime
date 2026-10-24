import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  ACCOUNTS_LABELS,
  ADMIN_PATHS,
  AI_PAGES,
  AI_CONTEXT,
  AI_SRE,
  ASK_AI,
  AiDocsPageEntry,
  CREATE_BUTTONS,
  CODE_PAGE,
  EXTERNAL_MCP_SERVERS,
  GITHUB_APP,
  INFRASTRUCTURE_AI_AGENTS,
  KEPT_AS_WRITTEN,
  LLM_PROVIDERS,
  MCP_SERVER,
  MICROSOFT_FOUNDRY,
  OTHER_NAMES,
  PERMISSION_NAMES,
  PLAN_NAMES,
  PRODUCT_NAMES,
  PROSE,
  TEMPLATED_LABELS,
} from "./AiDocsPages";
import { drawnAdminPath } from "./DocsAdminDashboard";
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
import {
  drawnMenuGroup,
  drawnMenuItem,
  drawnPath,
  drawnPathSegment,
} from "./DocsProductsMenu";
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
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 27: the AI pages - Ask AI, AI SRE, Infrastructure AI
 * Agents, Fix Tasks, GitHub App, LLM Providers and MCP Server - in every
 * docs language, and External MCP Servers, which a later task wrote to the
 * same rules. AiDocsFacts holds the English pages to the product; this
 * suite holds each translation to its English page:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and tab on the English one's line, so a later
 *     English edit shows where it lands in every language;
 *   - the same code, diagrams (by their nodes and arrows, with label lines
 *     short enough for the 590px docs column), inline code, tables and the
 *     numbers of their rows, lists, steps and cards, and every link on the
 *     English one's line, its anchor naming the heading in the English
 *     heading's place;
 *   - every line of prose translated, and a title that is the nav link's.
 *
 * And it names the product the way that language's product draws it,
 * Persian included: a bold Dashboard label by drawnActionLabel, a table's
 * create button by drawnTableButton, a menu path segment by segment
 * (drawnPath: one bold span joined by " → "; in Persian a bold span per
 * segment joined by " > ", with no "→" left in the prose), an Admin
 * Dashboard path from its own locale (drawnAdminPath), the MCP consent
 * page's choices from the Accounts app's locale, and the conversation's
 * "Show 6 earlier messages" from its template. What every language keeps
 * as written stays so: roles and permissions, plans, the server's own
 * English text, and what other products draw (KEPT_AS_WRITTEN,
 * OTHER_NAMES). A bold word that is emphasis is translated freely (PROSE).
 * A new bold word on these English pages fails "know every bold word"
 * until it is a label or listed.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE_NAMES: Array<string> = AI_PAGES.map(
  (entry: AiDocsPageEntry): string => {
    return entry.page;
  },
);

const ACCOUNTS_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Accounts/src/Locales",
);

/*
 * Each page's diagrams fit the 590px docs column, in every language: their
 * label lines are broken (<br/>) to be no wider than this, counting a
 * Chinese, Japanese or Korean character twice. Each cap is the widest line
 * the 17 languages drew. A label put back on one line runs its diagram off
 * the column, and the docs scroll it rather than shrink it.
 */
const WIDEST_DIAGRAM_LINE: Record<string, number> = {
  [ASK_AI]: 23,
  [AI_SRE]: 24,
  [AI_CONTEXT]: 24,
  [INFRASTRUCTURE_AI_AGENTS]: 26,
  [CODE_PAGE]: 25,
  [GITHUB_APP]: 25,
  [LLM_PROVIDERS]: 25,
  [EXTERNAL_MCP_SERVERS]: 19,
  [MCP_SERVER]: 24,
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
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const LINK_TARGET: RegExp = /\]\([^)\s]*\)/g;
// A word of four Latin letters or more: what an untranslated line is made of.
const LATIN_WORD: RegExp = /[A-Za-z]{4,}/g;
const FENCE_LINE: RegExp = /^\s*```/;
const LEFT_NAVIGATION: RegExp = /left nav/i;
const CAPTIONED_DIAGRAM: RegExp = /title="[^"]+"/;
const OWN_SECTION_CARD: RegExp = /^- \[[^\]]+\]\(#[^)]+\): /;
const TEMPLATE_VALUE: RegExp = /\{\{(\w+)\}\}/g;

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed(
  lists: Readonly<Record<string, ReadonlyArray<string>>>,
  page: string,
): Array<string> {
  return [...(lists[page] || [])];
}

// A bold span that is nothing but inline code, such as **`oneuptime_help`**.
function isCodeSpan(span: string): boolean {
  return ONLY_CODE.test(span);
}

// Whether a list accounts for a bold English word on a page.
function accountedFor(page: string, span: string): boolean {
  return (
    isCodeSpan(span) ||
    listed(KEPT_AS_WRITTEN, page).includes(span) ||
    listed(OTHER_NAMES, page).includes(span) ||
    listed(CREATE_BUTTONS, page).includes(span) ||
    listed(PERMISSION_NAMES, page).includes(span) ||
    listed(PLAN_NAMES, page).includes(span) ||
    listed(PROSE, page).includes(span) ||
    ACCOUNTS_LABELS[span] !== undefined ||
    TEMPLATED_LABELS[span] !== undefined
  );
}

// The bold words a page keeps as written in every language.
function keptBold(page: string): Array<string> {
  return [
    ...listed(KEPT_AS_WRITTEN, page),
    ...listed(OTHER_NAMES, page),
    ...listed(PERMISSION_NAMES, page),
    ...listed(PLAN_NAMES, page),
  ];
}

// A value of the Accounts app's locale by its dotted key.
function accountsLabel(language: string, key: string): string {
  let value: unknown = JSON.parse(
    fs.readFileSync(
      path.join(ACCOUNTS_LOCALES_DIR, `${language}.json`),
      "utf8",
    ),
  );

  for (const part of key.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[part];
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return language === "en" ? key : accountsLabel("en", key);
}

// A label the Dashboard draws from a template with values in it.
function templatedLabel(language: string, english: string): string {
  const templated: { template: string; values: Record<string, string> } =
    TEMPLATED_LABELS[english] as {
      template: string;
      values: Record<string, string>;
    };
  const value: unknown = dashboardLocale(language)[templated.template];
  const template: string =
    typeof value === "string" && value.trim() ? value : templated.template;

  return template.replace(TEMPLATE_VALUE, (_match: string, name: string) => {
    return templated.values[name] || "";
  });
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

// The menu paths of a page that the Dashboard draws (not another app's).
function dashboardPaths(page: string): Array<Array<string>> {
  return boldPaths(englishPage(page)).filter(
    (segments: Array<string>): boolean => {
      const path: string = segments.join(" → ");

      return (
        ADMIN_PATHS[path] === undefined &&
        !listed(OTHER_NAMES, page).includes(path)
      );
    },
  );
}

// The Admin Dashboard paths of a page.
function adminPaths(page: string): Array<string> {
  return boldPaths(englishPage(page))
    .map((segments: Array<string>): string => {
      return segments.join(" → ");
    })
    .filter((path: string): boolean => {
      return ADMIN_PATHS[path] !== undefined;
    });
}

/*
 * Every bold label, create button and menu path of the English page that a
 * language draws in its own words, as the English page writes it and as a
 * page in the language must: [English bold, drawn bold]. A Persian path is
 * one bold span per segment.
 */
function englishBoldDrawings(
  language: string,
  page: string,
): Array<[string, string]> {
  const english: string = englishPage(page);
  const spans: Array<string> = boldLabels(english);

  return [
    ...dashboardLabels(page).map((label: string): [string, string] => {
      return [`**${label}**`, `**${drawnActionLabel(language, label)}**`];
    }),
    ...listed(CREATE_BUTTONS, page).map((button: string): [string, string] => {
      return [`**${button}**`, `**${drawnTableButton(language, button)}**`];
    }),
    ...spans
      .filter((span: string): boolean => {
        return ACCOUNTS_LABELS[span] !== undefined;
      })
      .map((span: string): [string, string] => {
        return [
          `**${span}**`,
          `**${accountsLabel(language, ACCOUNTS_LABELS[span] as string)}**`,
        ];
      }),
    ...spans
      .filter((span: string): boolean => {
        return TEMPLATED_LABELS[span] !== undefined;
      })
      .map((span: string): [string, string] => {
        return [`**${span}**`, `**${templatedLabel(language, span)}**`];
      }),
    ...dashboardPaths(page).map((segments: Array<string>): [string, string] => {
      return [drawnPath("en", segments), drawnPath(language, segments)];
    }),
    ...adminPaths(page).map((path: string): [string, string] => {
      return [
        drawnAdminPath("en", ADMIN_PATHS[path] as ReadonlyArray<string>),
        drawnAdminPath(language, ADMIN_PATHS[path] as ReadonlyArray<string>),
      ];
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

function navGroup(title: string): NavGroup {
  return DocsNav.find((group: NavGroup): boolean => {
    return group.title === title;
  }) as NavGroup;
}

describe("the lists this test keeps", () => {
  it("name only pages of the AI group this task wrote", () => {
    for (const lists of [
      CREATE_BUTTONS,
      KEPT_AS_WRITTEN,
      OTHER_NAMES,
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

  it("follow the AI nav group, page for page, Microsoft Foundry aside", () => {
    // Microsoft Foundry follows LLM Providers, the page it is a provider of.
    const foundryAt: number =
      AI_PAGES.findIndex((entry: AiDocsPageEntry): boolean => {
        return entry.page === LLM_PROVIDERS;
      }) + 1;

    expect(foundryAt).toBeGreaterThan(0);
    expect(
      navGroup("AI").links.map((link: NavLink): Array<string> => {
        return [link.url, link.title];
      }),
    ).toEqual(
      [
        ...AI_PAGES.slice(0, foundryAt),
        MICROSOFT_FOUNDRY,
        ...AI_PAGES.slice(foundryAt),
      ].map((entry: AiDocsPageEntry): Array<string> => {
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

  it("keep a role's or a permission's name as the pickers list it", () => {
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

  it("draw the consent page's words, the Admin Dashboard's paths and the templated labels as English draws them", () => {
    for (const [english, key] of Object.entries(ACCOUNTS_LABELS)) {
      expect(accountsLabel("en", key)).toBe(english);
    }

    for (const [english, keys] of Object.entries(ADMIN_PATHS)) {
      expect(drawnAdminPath("en", keys)).toBe(`**${english}**`);
    }

    for (const english of Object.keys(TEMPLATED_LABELS)) {
      expect(templatedLabel("en", english)).toBe(english);
    }
  });
});

describe("the English pages", () => {
  it.each(AI_PAGES)(
    "$page is titled with its nav link",
    (entry: AiDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(AI_PAGES)(
    "$page draws at least one diagram, with a caption",
    (entry: AiDocsPageEntry) => {
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

  it.each(AI_PAGES)(
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: AiDocsPageEntry) => {
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

  it.each(AI_PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: AiDocsPageEntry) => {
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
  it.each(AI_PAGES)(
    "$page draws every diagram as a flowchart read top to bottom",
    (entry: AiDocsPageEntry) => {
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

  it.each(AI_PAGES)(
    "$page has no two headings with the same anchor, and skips no level",
    (entry: AiDocsPageEntry) => {
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

  it.each(AI_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: AiDocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(AI_PAGES)(
    "$page says no 'left navigation': products open from the Products menu",
    (entry: AiDocsPageEntry) => {
      expect(englishPage(entry.page)).not.toMatch(LEFT_NAVIGATION);
    },
  );

  it.each(AI_PAGES)(
    "$page writes a menu path as one bold path with arrows, never with '>'",
    (entry: AiDocsPageEntry) => {
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
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(AI_PAGES)("$page", (entry: AiDocsPageEntry) => {
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

    it("keeps every piece of inline code: the commands, variables, fields and values", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the tabs' labels, which name products", () => {
      expect(tabLabels(readPage(language, entry.page))).toEqual(
        tabLabels(english),
      );
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

    it("names every label, button and path the English page names, as this language's product draws it", () => {
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
        ...keptBold(entry.page).map((name: string): string => {
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

    it("keeps in English what every language keeps: roles and permissions, plans, the server's own text and other products' names", () => {
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
  it("draw the AI and Code products from the Products menu's own keys", () => {
    expect(drawnPath("en", ["Products", "AI", "Chat"])).toBe(
      "**Products → AI → Chat**",
    );
    expect(drawnPath("en", ["Products", "Code"])).toBe("**Products → Code**");
    // The German menu reads "Chat" where no flat label of it exists.
    expect(drawnPathSegment("de", ["Products", "AI", "Chat"], 2)).toBe("Chat");
    // A Persian path is a bold span per segment.
    expect(drawnPath("fa", ["Products", "Code"])).toBe(
      `**${drawnPathSegment("fa", ["Products", "Code"], 0)}** > **${drawnPathSegment("fa", ["Products", "Code"], 1)}**`,
    );
  });

  /*
   * "Products → Code" names the menu's Code group, and Code, its one
   * product: a page names the two as one only while every menu reads them
   * alike.
   */
  it("read the Code group and its one product alike in every language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        product: drawnMenuItem(language, "Code"),
      }).toEqual({ language, product: drawnMenuGroup(language, "Code") });
    }
  });

  it("draw the consent page's choices from the Accounts app's locale", () => {
    expect(accountsLabel("de", "mcpAuthorize.accessWriteTitle")).toBe(
      "Lesen und Schreiben",
    );
    expect(accountsLabel("en", "mcpAuthorize.authorizeButton")).toBe(
      "Authorize",
    );
  });

  it("draw the conversation's count into its template", () => {
    expect(templatedLabel("en", "Show 6 earlier messages")).toBe(
      "Show 6 earlier messages",
    );
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups, code left out", () => {
    expect(numbersIn("100,000 output tokens")).toEqual(["100000"]);
    expect(numbersIn("۱۰۰٬۰۰۰ توکن")).toEqual(["100000"]);
    expect(numbersIn("30 Minuten und 1,5")).toEqual(["1.5", "30"]);
    expect(numbersIn("`-t 30` is fine, 2 times")).toEqual(["2"]);
  });

  it("find an untranslated line of prose, but not a line of names or code", () => {
    let names: string = "OneUptime Cloud, Docker Swarm, Kubernetes, Linux";

    for (const name of NAMES_LONGEST_FIRST) {
      names = names.split(name).join(" ");
    }

    expect((names.match(LATIN_WORD) || []).length).toBeLessThan(3);
  });

  it("name every link's anchor by the heading in the English heading's place, in the reader's language", () => {
    expect(expectedLink("en", ASK_AI, "#actions-are-made-as-you")).toBe(
      "#actions-are-made-as-you",
    );
    // An anchor that names no heading is kept as written, not made "#null".
    expect(expectedLink("fa", ASK_AI, "#no-such-heading")).toBe(
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
