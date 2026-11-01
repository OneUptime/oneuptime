import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DYNAMICS,
  FIRST_TASK_PAGE_COUNT,
  INTEGRATIONS_PAGES,
  IRC,
  IntegrationsDocsPageEntry,
  JIRA,
  KEPT_AS_WRITTEN,
  OTHER_NAMES,
  OVERVIEW,
  PLAN_NAMES,
  PRODUCT_NAMES,
  PROSE,
  STEP_NAMES,
  TELEGRAM,
  TEMPLATE_NAMES,
  ZABBIX,
} from "./IntegrationsDocsPages";
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
import {
  PERSIAN_PATH_SEPARATOR,
  PRODUCTS_MENU,
  drawnPath,
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
import { leadOf } from "./InventoryAndApiDocsSupport";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 28a: the Integrations Overview and the Zabbix, Jira,
 * PagerDuty, Opsgenie, ServiceNow and Microsoft Dynamics 365 pages, in
 * every docs language; and task 28b: the Prometheus Alertmanager, Grafana
 * and Datadog pages, and the Google SecOps, Microsoft Sentinel, Microsoft
 * Defender XDR and CrowdStrike Falcon connection pages; and task 28c: the
 * Splunk Enterprise Security, Elastic Security, AWS Security Hub and Okta
 * System Log connection pages, and the GitHub, GitLab, Discord and
 * Telegram pages. IntegrationsDocsFacts, AlertingIntegrationsDocsFacts,
 * SecurityConnectionsDocsFacts, SplunkElasticAwsOktaDocsFacts and
 * IssueAndChatIntegrationsDocsFacts hold the English pages to the product;
 * this suite holds each translation to its English page:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and tab on the English one's line, so a later
 *     English edit shows where it lands in every language;
 *   - the same code, diagrams (by their nodes and arrows, with label lines
 *     short enough for the 590px docs column), inline code, tab labels,
 *     tables and the numbers of their rows, lists, steps and cards, and
 *     every link on the English one's line, its anchor naming the heading
 *     in the English heading's place;
 *   - every line of prose translated, and a title that is the nav link's.
 *
 * And it names OneUptime the way that language's Dashboard draws it,
 * Persian included: a bold label by drawnActionLabel, a menu path segment
 * by segment, one bold span joined by " → " (in Persian a bold span per
 * segment joined by " > ", with no "→" left in the prose). A path that
 * opens a product from the Products menu draws it as the menu does
 * (drawnPath), as the Security Events pages do. What every
 * language keeps as written stays so: what a workflow step defines (its
 * title, settings, outputs and comparisons, as the workflow pages keep
 * them), the templates' names and settings, which the Dashboard shows in
 * English, other products' screens and buttons, plans, and the few words
 * the product writes in English. A bold word that is emphasis is translated
 * freely (PROSE). A new bold word on these English pages fails "know every
 * bold word" until it is a Dashboard label or listed in
 * IntegrationsDocsPages.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const PAGE_NAMES: Array<string> = INTEGRATIONS_PAGES.map(
  (entry: IntegrationsDocsPageEntry): string => {
    return entry.page;
  },
);

/*
 * Each page's diagram fits the 590px docs column, in every language: its
 * label lines are broken (<br/>) to be no wider than this, counting a
 * Chinese, Japanese or Korean character twice. Each cap is the widest line
 * the 17 languages drew. A label put back on one line runs its diagram off
 * the column, and the docs scroll it rather than shrink it.
 */
const WIDEST_DIAGRAM_LINE: Record<string, number> = {
  "integrations/index": 23,
  "integrations/zabbix": 23,
  "integrations/jira": 22,
  "integrations/pagerduty": 22,
  "integrations/opsgenie": 20,
  "integrations/servicenow": 24,
  "integrations/microsoft-dynamics-365": 24,
  "integrations/prometheus-alertmanager": 22,
  "integrations/grafana": 23,
  "integrations/datadog": 22,
  "integrations/google-secops": 23,
  "integrations/microsoft-sentinel": 22,
  "integrations/microsoft-defender-xdr": 22,
  "integrations/crowdstrike-falcon": 21,
  "integrations/splunk": 22,
  "integrations/elastic-security": 21,
  "integrations/aws-security-hub": 22,
  "integrations/okta": 23,
  "integrations/microsoft-entra-id": 23,
  "integrations/google-workspace": 23,
  "integrations/github": 21,
  "integrations/gitlab": 20,
  "integrations/discord": 20,
  "integrations/telegram": 18,
};

/*
 * Tab labels that are words, not a product's name: how a workflow is built,
 * on the Discord and Telegram pages, as on the IRC page. A reader's pick of
 * a tab is remembered by its label, from page to page, so each language
 * words these as its IRC page does, and the pick follows the reader from
 * one chat's page to the next. Every other tab label names a product, and
 * stays as written.
 */
const WORDED_TAB_LABELS: ReadonlyArray<string> = [
  "From the template",
  "From scratch",
];

// A tab's label as a page in this language writes it.
function drawnTabLabel(language: string, english: string): string {
  if (!WORDED_TAB_LABELS.includes(english)) {
    return english;
  }

  const englishLabels: Array<string> = tabLabels(readPage("en", IRC));
  const labels: Array<string> = tabLabels(readPage(language, IRC));
  const drawn: string | undefined = labels[englishLabels.indexOf(english)];

  if (!drawn) {
    throw new Error(`The ${language} IRC page has no tab for ${english}`);
  }

  return drawn;
}

// The names, longest first: "Jira Cloud" goes before "Jira" takes its first word.
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
// A component's opening, ":::details": its name is no word of prose.
const COMPONENT_OPENING: RegExp = /^:::[a-z]+/;
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

// A bold span that is nothing but inline code, such as **`webhook-1`**.
function isCodeSpan(span: string): boolean {
  return ONLY_CODE.test(span);
}

// The bold words a page keeps as written in every language.
function keptBold(page: string): Array<string> {
  return [
    ...listed(STEP_NAMES, page),
    ...listed(TEMPLATE_NAMES, page),
    ...listed(OTHER_NAMES, page),
    ...listed(KEPT_AS_WRITTEN, page),
    ...listed(PLAN_NAMES, page),
  ];
}

// Whether a list accounts for a bold English word on a page.
function accountedFor(page: string, span: string): boolean {
  return (
    isCodeSpan(span) ||
    keptBold(page).includes(span) ||
    listed(PROSE, page).includes(span)
  );
}

/*
 * The Dashboard labels a page names that drawnActionLabel draws: every bold
 * label but the ones a list keeps or translates freely.
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
      return !accountedFor(page, segments.join(PATH_SEPARATOR));
    },
  );
}

/*
 * A path through the Dashboard's menus, as a page in a language writes it:
 * each segment as the Dashboard draws it, in one bold span joined by " → ";
 * in Persian, a bold span per segment joined by " > ". A path from the
 * Products menu names its product as the menu draws it, which some
 * languages word apart from the flat label: the Persian menu reads the
 * Security Events product in Persian where its flat label is English.
 */
function drawnMenuPath(language: string, segments: Array<string>): string {
  if (segments[0] === PRODUCTS_MENU) {
    return drawnPath(language, segments);
  }

  const drawn: Array<string> = segments.map((segment: string): string => {
    return drawnActionLabel(language, segment);
  });

  if (language === "fa") {
    return drawn
      .map((segment: string): string => {
        return `**${segment}**`;
      })
      .join(PERSIAN_PATH_SEPARATOR);
  }

  return `**${drawn.join(PATH_SEPARATOR)}**`;
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
    ...dashboardPaths(page).map((segments: Array<string>): [string, string] => {
      return [drawnMenuPath("en", segments), drawnMenuPath(language, segments)];
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
 * a component's name, the names a page keeps in English and the products'
 * names are taken out. A troubleshooting entry titled with an HTTP status,
 * "429 Too Many Requests", is the status, as every language writes it.
 */
function untranslatedLines(language: string, page: string): Array<string> {
  const english: Array<string> = englishPage(page).split("\n");
  const translated: Array<string> = readPage(language, page).split("\n");
  const found: Array<string> = [];
  const drawnBolds: Array<string> = englishBoldDrawings(language, page).map(
    (drawing: [string, string]): string => {
      return drawing[1];
    },
  );
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
      .replace(COMPONENT_OPENING, " ")
      .replace(INLINE_CODE_SPAN, " ")
      .replace(LINK_TARGET, "]");

    for (const kept of keptBold(page)) {
      text = text.split(kept).join(" ");
    }

    // A label this language's Dashboard draws in English is drawn so here too.
    for (const drawn of drawnBolds) {
      text = text.split(drawn).join(" ");
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
  it("name only pages this task wrote", () => {
    for (const lists of [
      STEP_NAMES,
      TEMPLATE_NAMES,
      OTHER_NAMES,
      KEPT_AS_WRITTEN,
      PLAN_NAMES,
      PROSE,
      WIDEST_DIAGRAM_LINE,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("follow the Integrations nav group's order, task 28a's pages first", () => {
    const links: Array<Array<string>> = navGroup("Integrations").links.map(
      (link: NavLink): Array<string> => {
        return [link.url, link.title];
      },
    );
    const listed: Array<Array<string>> = INTEGRATIONS_PAGES.map(
      (entry: IntegrationsDocsPageEntry): Array<string> => {
        return [`/docs/${entry.page}`, entry.navTitle];
      },
    );

    // Every page, under its nav title, in the nav's order.
    expect(
      links.filter((link: Array<string>): boolean => {
        return listed.some((entry: Array<string>): boolean => {
          return entry[0] === link[0];
        });
      }),
    ).toEqual(listed);
    // Task 28a's pages are the group's first links.
    expect(links.slice(0, FIRST_TASK_PAGE_COUNT)).toEqual(
      listed.slice(0, FIRST_TASK_PAGE_COUNT),
    );
  });

  it("know every bold word on the English pages: a label, a path, or a listed word", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !isActionLabel(span) && !accountedFor(page, span);
        },
      );
      const unknownPaths: Array<string> = boldPaths(englishPage(page))
        .filter((segments: Array<string>): boolean => {
          return (
            !accountedFor(page, segments.join(PATH_SEPARATOR)) &&
            !segments.every((segment: string): boolean => {
              return isActionLabel(segment);
            })
          );
        })
        .map((segments: Array<string>): string => {
          return segments.join(PATH_SEPARATOR);
        });

      expect({ page, unlisted, unknownPaths }).toEqual({
        page,
        unlisted: [],
        unknownPaths: [],
      });
    }
  });

  it("list only bold words the English pages have", () => {
    for (const page of PAGE_NAMES) {
      const english: Array<string> = [
        ...boldLabels(englishPage(page)),
        ...boldPaths(englishPage(page)).map(
          (segments: Array<string>): string => {
            return segments.join(PATH_SEPARATOR);
          },
        ),
      ];
      const stale: Array<string> = [
        ...keptBold(page),
        ...listed(PROSE, page),
      ].filter((span: string): boolean => {
        return !english.includes(span);
      });

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });

  it("list each word once per page, in one list", () => {
    for (const page of PAGE_NAMES) {
      const all: Array<string> = [...keptBold(page), ...listed(PROSE, page)];
      const twice: Array<string> = all.filter(
        (span: string, index: number): boolean => {
          return all.indexOf(span) !== index;
        },
      );

      expect({ page, twice }).toEqual({ page, twice: [] });
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

  it("keep only the plans' own names", () => {
    for (const page of PAGE_NAMES) {
      for (const plan of listed(PLAN_NAMES, page)) {
        expect(Object.values(PlanType)).toContain(plan);
      }
    }
  });

  it("draw the menu paths the English pages name as the English Dashboard does", () => {
    for (const page of PAGE_NAMES) {
      for (const segments of dashboardPaths(page)) {
        expect(drawnMenuPath("en", segments)).toBe(
          `**${segments.join(PATH_SEPARATOR)}**`,
        );
      }
    }
  });
});

describe("the English pages", () => {
  it.each(INTEGRATIONS_PAGES)(
    "$page is titled with its nav link",
    (entry: IntegrationsDocsPageEntry) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(INTEGRATIONS_PAGES)(
    "$page draws one diagram, with a caption, read top to bottom",
    (entry: IntegrationsDocsPageEntry) => {
      const diagrams: Array<{ info: string; code: string }> = scanMarkdown(
        englishPage(entry.page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams).toHaveLength(1);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(CAPTIONED_DIAGRAM);
        expect(diagram.code.trim().split("\n")[0]?.trim()).toBe("flowchart TB");
      }
    },
  );

  it.each(INTEGRATIONS_PAGES)(
    "$page opens with cards to its own sections and ends on a Next steps section of cards",
    (entry: IntegrationsDocsPageEntry) => {
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

  it.each(INTEGRATIONS_PAGES)(
    "$page breaks its diagrams' labels to fit the 590px docs column",
    (entry: IntegrationsDocsPageEntry) => {
      expect(widestDiagramLine("en", entry.page)).toBeLessThanOrEqual(
        WIDEST_DIAGRAM_LINE[entry.page] as number,
      );
    },
  );

  it.each(INTEGRATIONS_PAGES)(
    "$page has no two headings with the same anchor, and skips no level",
    (entry: IntegrationsDocsPageEntry) => {
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

  it.each(INTEGRATIONS_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: IntegrationsDocsPageEntry) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(INTEGRATIONS_PAGES)(
    "$page says no 'left navigation', and writes a menu path with arrows, never with '>'",
    (entry: IntegrationsDocsPageEntry) => {
      expect(englishPage(entry.page)).not.toMatch(LEFT_NAVIGATION);

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
  describe.each(INTEGRATIONS_PAGES)(
    "$page",
    (entry: IntegrationsDocsPageEntry) => {
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

      it("keeps every piece of inline code: the references, settings, fields and values", () => {
        expect(inlineCode(readPage(language, entry.page))).toEqual(
          inlineCode(english),
        );
      });

      it("keeps the tabs' labels that name products, and words the others as the IRC page does", () => {
        expect(tabLabels(readPage(language, entry.page))).toEqual(
          tabLabels(english).map((label: string): string => {
            return drawnTabLabel(language, label);
          }),
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

      it("names every label and path the English page names, as this language's Dashboard draws it", () => {
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

      it("leaves no label or path in English where this language's Dashboard draws it otherwise", () => {
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
                  return segments.map((segment: string): string => {
                    return `**${drawnActionLabel(language, segment)}**`;
                  });
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

      it("keeps as written what every language keeps: step names, template names and settings, other products' words and plans", () => {
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
          const kept: Array<string> = keptBold(entry.page).filter(
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
    },
  );
});

describe("the Integrations Overview's catalog, in every language", () => {
  // The rows of the catalog's tables that open a docs page, as "title | url".
  function catalogRows(language: string): Array<string> {
    return tables(readPage(language, OVERVIEW))
      .filter((table: Array<Array<string>>): boolean => {
        return table[0]?.length === 3;
      })
      .flatMap((table: Array<Array<string>>): Array<Array<string>> => {
        return table.slice(1);
      })
      .map((row: Array<string>): string => {
        return row[0] as string;
      })
      .filter((cell: string): boolean => {
        return cell.startsWith("[");
      });
  }

  it.each(LANGUAGES)(
    "%s lists every tool the English catalog lists, in its order, under its own name",
    (language: string) => {
      expect(catalogRows(language)).toEqual(catalogRows("en"));
    },
  );

  /*
   * The words each language's Telegram page writes in its lead for an
   * alert and for an incident: "when an alert fires or an incident opens".
   * The catalog's Telegram row says what Telegram's one template sends, a
   * message when an alert fires (IssueAndChatIntegrationsDocsFacts holds
   * the English row to the template), so in every language it names the
   * alert in its Telegram page's own word, and no incident. It said
   * "incident updates", in every language.
   */
  const TELEGRAM_LEAD_WORDS: Record<
    string,
    { alert: string; incident: string }
  > = {
    en: { alert: "alert", incident: "incident" },
    de: { alert: "Warnung", incident: "Vorfall" },
    fr: { alert: "alerte", incident: "incident" },
    es: { alert: "alerta", incident: "incidente" },
    it: { alert: "avviso", incident: "incident" },
    pt: { alert: "alerta", incident: "incidente" },
    nl: { alert: "waarschuwing", incident: "incident" },
    da: { alert: "advarsel", incident: "hændelse" },
    no: { alert: "varsel", incident: "hendelse" },
    sv: { alert: "larm", incident: "incident" },
    ru: { alert: "оповещени", incident: "инцидент" },
    ja: { alert: "アラート", incident: "インシデント" },
    ko: { alert: "알림", incident: "인시던트" },
    "zh-CN": { alert: "警报", incident: "事件" },
    "zh-TW": { alert: "警示", incident: "事件" },
    hi: { alert: "अलर्ट", incident: "घटना" },
    fa: { alert: "هشدار", incident: "حادثه" },
  };

  // A row's description, by the docs page its first cell opens.
  function catalogDescription(language: string, page: string): string {
    const row: Array<string> | undefined = tables(readPage(language, OVERVIEW))
      .flatMap((table: Array<Array<string>>): Array<Array<string>> => {
        return table;
      })
      .find((candidate: Array<string>): boolean => {
        return (candidate[0] || "").endsWith(`](/docs/${page})`);
      });

    if (!row) {
      throw new Error(`The ${language} catalog has no row for ${page}`);
    }

    return row[2] as string;
  }

  it("knows the Telegram page's words in every docs language", () => {
    expect(Object.keys(TELEGRAM_LEAD_WORDS)).toEqual([
      ...SUPPORTED_DOCS_LANGUAGE_CODES,
    ]);
  });

  it.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
    "%s words Telegram's row by the alert its template sends, as its Telegram page does, and names no incident",
    (language: string) => {
      const words: { alert: string; incident: string } = TELEGRAM_LEAD_WORDS[
        language
      ] as { alert: string; incident: string };
      const lead: string = leadOf(readPage(language, TELEGRAM)).toLowerCase();
      const description: string = catalogDescription(
        language,
        TELEGRAM,
      ).toLowerCase();

      // Both words are the page's own, from the sentence that names both.
      expect(lead).toContain(words.alert.toLowerCase());
      expect(lead).toContain(words.incident.toLowerCase());
      expect({
        language,
        description,
        alert: description.includes(words.alert.toLowerCase()),
        incident: description.includes(words.incident.toLowerCase()),
      }).toEqual({ language, description, alert: true, incident: false });
    },
  );
});

describe("the helpers, on these pages' shapes", () => {
  it("draw a menu path from the Dashboard's labels, a Persian one segment by segment", () => {
    expect(drawnMenuPath("en", ["Workflows", "Global Variables"])).toBe(
      "**Workflows → Global Variables**",
    );
    expect(drawnMenuPath("fa", ["Logs", "Runs"])).toBe(
      `**${drawnActionLabel("fa", "Logs")}** > **${drawnActionLabel("fa", "Runs")}**`,
    );
  });

  it("read the numbers a row states, in any digits, decimal mark or digit groups, code left out", () => {
    expect(numbersIn("100,000 characters")).toEqual(["100000"]);
    expect(numbersIn("۱۰۰٬۰۰۰ نویسه")).toEqual(["100000"]);
    expect(numbersIn("`2000` Merged, 200 and 2000")).toEqual(["200", "2000"]);
  });

  it("find an untranslated line of prose, but not a line of names or code", () => {
    let names: string =
      "Jira Cloud, Microsoft Dynamics 365, ServiceNow, Zabbix";

    for (const name of NAMES_LONGEST_FIRST) {
      names = names.split(name).join(" ");
    }

    expect((names.match(LATIN_WORD) || []).length).toBeLessThan(3);
  });

  it("name every link's anchor by the heading in the English heading's place, in the reader's language", () => {
    expect(expectedLink("en", JIRA, "#limitations")).toBe("#limitations");
    // An anchor that names no heading is kept as written, not made "#null".
    expect(expectedLink("fa", ZABBIX, "#no-such-heading")).toBe(
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

  it("word a tab that names no product as the IRC page does, and keep every other as written", () => {
    expect(drawnTabLabel("en", "From the template")).toBe("From the template");
    expect(drawnTabLabel("de", "Zabbix 7.0")).toBe("Zabbix 7.0");

    for (const language of LANGUAGES) {
      for (const label of WORDED_TAB_LABELS) {
        expect({
          language,
          label,
          worded: drawnTabLabel(language, label) !== label,
        }).toEqual({
          language,
          label,
          worded: true,
        });
      }
    }
  });

  it("keep the Dynamics 365 page's two Scope fields apart: only Power Automate's is bold", () => {
    expect(listed(OTHER_NAMES, DYNAMICS)).toContain("Scope");
    expect(englishPage(DYNAMICS)).toContain("set the scope to `https://");
  });
});
