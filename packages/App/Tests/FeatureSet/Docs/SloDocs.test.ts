import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import SloMetricType from "Common/Types/ServiceLevelObjective/SloMetricType";
import {
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  SLO_BURN_RATE_TEMPLATE_VARIABLES,
  SloBurnRateTemplateVariableDefinition,
} from "Common/Utils/Slo/SloBurnRateTemplate";
import SloMetricTypeUtil from "Common/Utils/Slo/SloMetricType";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The SLO docs against the product they describe.
 *
 * Markdown is not compiled, so nothing else notices when the worker starts
 * posting a new oneuptime.slo.* series the metrics page never lists, a burn
 * rate template variable is added without the docs table following, the SLO
 * side menu gains a page the overview never explains, or the Persian pages
 * fall behind the English ones. Each test reads the source of truth - the
 * metric catalog, the template catalog, the side menu, the upgrade migration,
 * the nav - and checks the shipped pages still tell the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const SLO_VIEW_SIDE_MENU_FILE: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Slo/View/SideMenu.tsx",
);
const SLO_METRIC_UTIL_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Utils/Slo/SloMetricUtil.ts",
);
const MONITOR_RULE_BACKFILL_MIGRATION_FILE: string = path.join(
  REPO_ROOT,
  "Common/Server/Infrastructure/Postgres/SchemaMigrations/1793200000000-BackfillSloMonitorRulesAndAffectedResources.ts",
);

const NAV_GROUP_TITLE: string = "SLOs";

const INTRODUCTION_PAGE: string = "slo/introduction";
const MONITOR_RULES_PAGE: string = "slo/monitor-rules";
const BURN_RATE_ALERTS_PAGE: string = "slo/burn-rate-alerts";
const METRICS_PAGE: string = "slo/metrics";

interface ExpectedPage {
  title: string;
  page: string;
}

// Reading order: what an SLO is, what it measures, then what it does with it.
const EXPECTED_PAGES: ReadonlyArray<ExpectedPage> = [
  { title: "SLOs Overview", page: INTRODUCTION_PAGE },
  { title: "Monitors and Monitor Rules", page: MONITOR_RULES_PAGE },
  { title: "Error Budgets", page: "slo/error-budget" },
  { title: "Burn Rate Alerts and Incidents", page: BURN_RATE_ALERTS_PAGE },
  { title: "SLO Metrics and Dashboards", page: METRICS_PAGE },
  { title: "SLO Feed and Audit Logs", page: "slo/feed-and-audit-logs" },
  { title: "Label and Owner Rules", page: "slo/label-and-owner-rules" },
];

/*
 * Every language directory that ships the SLO pages. `fa` is the only
 * translated corpus (every other language falls back to English per page at
 * request time), so a new translation only has to be added here.
 */
const TRANSLATED_LANGUAGES: ReadonlyArray<string> = ["fa"];

const FENCE_LINE: RegExp = /^\s*```/;
// Arabic-script letters, which every Persian sentence contains.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;

type PageFileFunction = (language: string, relative: string) => string;

const pageFile: PageFileFunction = (
  language: string,
  relative: string,
): string => {
  return path.join(CONTENT_DIR, language, `${relative}.md`);
};

type ReadPageFunction = (relative: string, language?: string) => string;

const readPage: ReadPageFunction = (
  relative: string,
  language: string = "en",
): string => {
  return fs.readFileSync(pageFile(language, relative), "utf8");
};

type SplitMarkdownFunction = (markdown: string) => {
  prose: Array<string>;
  codeBlocks: Array<string>;
};

// Prose lines and fenced code blocks, kept apart so headings and inline code are never read out of a fence.
const splitMarkdown: SplitMarkdownFunction = (
  markdown: string,
): { prose: Array<string>; codeBlocks: Array<string> } => {
  const prose: Array<string> = [];
  const codeBlocks: Array<string> = [];
  let current: Array<string> | null = null;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (current) {
        codeBlocks.push(current.join("\n"));
        current = null;
      } else {
        current = [];
      }
      continue;
    }

    if (current) {
      current.push(line);
    } else {
      prose.push(line);
    }
  }

  return { prose: prose, codeBlocks: codeBlocks };
};

type HeadingCountsFunction = (markdown: string) => {
  h2: number;
  h3: number;
};

const headingCounts: HeadingCountsFunction = (
  markdown: string,
): { h2: number; h3: number } => {
  const prose: Array<string> = splitMarkdown(markdown).prose;

  return {
    h2: prose.filter((line: string): boolean => {
      return line.startsWith("## ");
    }).length,
    h3: prose.filter((line: string): boolean => {
      return line.startsWith("### ");
    }).length,
  };
};

type TitleOfFunction = (markdown: string) => string;

const titleOf: TitleOfFunction = (markdown: string): string => {
  const firstLine: string = markdown.split("\n")[0] || "";

  expect(firstLine.startsWith("# ")).toBe(true);

  return firstLine.slice(2).trim();
};

type InlineCodeFunction = (markdown: string) => Set<string>;

const inlineCode: InlineCodeFunction = (markdown: string): Set<string> => {
  const prose: string = splitMarkdown(markdown).prose.join("\n");

  return new Set<string>(
    Array.from(prose.matchAll(/`([^`\n]+)`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

type DocsLinksFunction = (markdown: string) => Set<string>;

// Every /docs/ link target, without its #anchor.
const docsLinks: DocsLinksFunction = (markdown: string): Set<string> => {
  return new Set<string>(
    Array.from(markdown.matchAll(/\]\((\/docs\/[^)#\s]+)(?:#[^)\s]*)?\)/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

type SloGroupFunction = () => NavGroup;

const sloGroup: SloGroupFunction = (): NavGroup => {
  const group: NavGroup | undefined = DocsNav.find(
    (item: NavGroup): boolean => {
      return item.title === NAV_GROUP_TITLE;
    },
  );

  expect(group).toBeDefined();

  return group as NavGroup;
};

type TableRowStartingWithFunction = (
  markdown: string,
  firstCell: string,
) => string | undefined;

const tableRowStartingWith: TableRowStartingWithFunction = (
  markdown: string,
  firstCell: string,
): string | undefined => {
  return markdown.split("\n").find((line: string): boolean => {
    return new RegExp(
      `^\\|\\s*${firstCell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`,
    ).test(line);
  });
};

describe("SLO docs", () => {
  describe("navigation", () => {
    it("lists the SLO pages in reading order", () => {
      expect(
        sloGroup().links.map((link: NavLink): NavLink => {
          return { title: link.title, url: link.url };
        }),
      ).toEqual(
        EXPECTED_PAGES.map((expected: ExpectedPage): NavLink => {
          return { title: expected.title, url: `/docs/${expected.page}` };
        }),
      );
    });

    it("has an English page for every link, titled like its nav entry", () => {
      for (const expected of EXPECTED_PAGES) {
        expect({
          page: expected.page,
          title: titleOf(readPage(expected.page)),
        }).toEqual({ page: expected.page, title: expected.title });
      }
    });

    it("ships a real translation of every SLO page", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          expect({
            language: language,
            page: expected.page,
            exists: fs.existsSync(pageFile(language, expected.page)),
          }).toEqual({
            language: language,
            page: expected.page,
            exists: true,
          });

          const translated: string = readPage(expected.page, language);

          expect(PERSIAN_LETTER.test(titleOf(translated))).toBe(true);
          expect(translated).not.toEqual(readPage(expected.page));
        }
      }
    });
  });

  describe("links", () => {
    it("points every /docs/slo link, in every language, at a page that exists", () => {
      for (const language of ["en", ...TRANSLATED_LANGUAGES]) {
        for (const expected of EXPECTED_PAGES) {
          for (const link of docsLinks(readPage(expected.page, language))) {
            if (!link.startsWith("/docs/slo/")) {
              continue;
            }

            const relative: string = link.slice("/docs/".length);

            expect({
              language: language,
              page: expected.page,
              link: link,
              exists: fs.existsSync(pageFile("en", relative)),
            }).toEqual({
              language: language,
              page: expected.page,
              link: link,
              exists: true,
            });
          }
        }
      }
    });

    it("keeps the same docs links in every translation", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          expect({
            language: language,
            page: expected.page,
            links: Array.from(
              docsLinks(readPage(expected.page, language)),
            ).sort(),
          }).toEqual({
            language: language,
            page: expected.page,
            links: Array.from(docsLinks(readPage(expected.page))).sort(),
          });
        }
      }
    });
  });

  describe("translations", () => {
    it("mirror the English heading structure", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          expect({
            language: language,
            page: expected.page,
            headings: headingCounts(readPage(expected.page, language)),
          }).toEqual({
            language: language,
            page: expected.page,
            headings: headingCounts(readPage(expected.page)),
          });
        }
      }
    });

    it("keep every English code identifier and code block intact", () => {
      for (const language of TRANSLATED_LANGUAGES) {
        for (const expected of EXPECTED_PAGES) {
          const english: string = readPage(expected.page);
          const translated: string = readPage(expected.page, language);
          const translatedCode: Set<string> = inlineCode(translated);

          for (const identifier of inlineCode(english)) {
            expect({
              language: language,
              page: expected.page,
              identifier: identifier,
              present: translatedCode.has(identifier),
            }).toEqual({
              language: language,
              page: expected.page,
              identifier: identifier,
              present: true,
            });
          }

          expect(splitMarkdown(translated).codeBlocks).toEqual(
            splitMarkdown(english).codeBlocks,
          );
        }
      }
    });
  });

  describe("SLOs Overview", () => {
    /*
     * The side menu's link titles, read from source: the page is a React
     * component that a plain-node test must not import.
     */
    const sideMenuTitles: Array<string> = Array.from(
      fs
        .readFileSync(SLO_VIEW_SIDE_MENU_FILE, "utf8")
        .matchAll(/title:\s*"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    it("reads the SLO side menu's pages", () => {
      expect(sideMenuTitles).toEqual(
        expect.arrayContaining([
          "Overview",
          "Monitors",
          "Monitor Rules",
          "Burn Rate Rules",
          "Settings",
          "Delete SLO",
        ]),
      );
    });

    it("explains every page in the SLO side menu, in every language", () => {
      for (const language of ["en", ...TRANSLATED_LANGUAGES]) {
        const markdown: string = readPage(INTRODUCTION_PAGE, language);

        for (const title of sideMenuTitles) {
          expect({
            language: language,
            page: title,
            documented: Boolean(tableRowStartingWith(markdown, `**${title}**`)),
          }).toEqual({ language: language, page: title, documented: true });
        }
      }
    });
  });

  describe("SLO Metrics and Dashboards", () => {
    const markdown: string = readPage(METRICS_PAGE);

    it("documents every oneuptime.slo.* metric with its unit and aggregation", () => {
      for (const metricType of Object.values(SloMetricType)) {
        const row: string | undefined = tableRowStartingWith(
          markdown,
          `\`${metricType}\``,
        );

        expect({ metricType: metricType, documented: Boolean(row) }).toEqual({
          metricType: metricType,
          documented: true,
        });

        const cells: Array<string> = (row as string)
          .split("|")
          .map((cell: string): string => {
            return cell.trim();
          });

        const unit: string = SloMetricTypeUtil.getUnit(metricType);
        const aggregation: AggregationType =
          SloMetricTypeUtil.getAggregationType(metricType);

        expect([AggregationType.Avg, AggregationType.Max]).toContain(
          aggregation,
        );

        expect({
          metricType: metricType,
          unit: cells[2],
          aggregation: cells[3],
        }).toEqual({
          metricType: metricType,
          unit: unit ? `\`${unit}\`` : "—",
          aggregation: aggregation === AggregationType.Max ? "Max" : "Avg",
        });
      }
    });

    it("documents no oneuptime.slo.* metric the worker does not post", () => {
      const posted: Array<string> = Object.values(SloMetricType);

      for (const match of markdown.matchAll(/`(oneuptime\.slo\.[a-z.]+)`/g)) {
        expect(posted).toContain(match[1]);
      }
    });

    it("states the retention default the emitter falls back to", () => {
      const match: RegExpMatchArray | null = fs
        .readFileSync(SLO_METRIC_UTIL_FILE, "utf8")
        .match(/DEFAULT_RETENTION_DAYS:\s*number\s*=\s*(\d+)/);

      expect(match).not.toBeNull();
      expect(markdown).toContain(`**${(match as RegExpMatchArray)[1]} days**`);
    });
  });

  describe("Burn Rate Alerts and Incidents", () => {
    const markdown: string = readPage(BURN_RATE_ALERTS_PAGE);

    it("lists exactly the template variables the worker fills in, in catalog order", () => {
      const documentedKeys: Array<string> = Array.from(
        markdown.matchAll(/^\|\s*`\{\{(\w+)\}\}`\s*\|/gm),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(documentedKeys).toEqual(
        SLO_BURN_RATE_TEMPLATE_VARIABLES.map(
          (variable: SloBurnRateTemplateVariableDefinition): string => {
            return variable.key;
          },
        ),
      );
    });

    it("describes each variable the way the dashboard help does", () => {
      for (const variable of SLO_BURN_RATE_TEMPLATE_VARIABLES) {
        const row: string = tableRowStartingWith(
          markdown,
          `\`{{${variable.key}}}\``,
        ) as string;

        expect(row).toContain(variable.description);
        expect(row).toContain(variable.example);
      }
    });

    it("shows the built-in title", () => {
      expect(markdown).toContain(DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE);
    });
  });

  describe("Monitors and Monitor Rules", () => {
    it("names the rule the upgrade creates from Auto-Add Monitors With Labels, in every language", () => {
      const match: RegExpMatchArray | null = fs
        .readFileSync(MONITOR_RULE_BACKFILL_MIGRATION_FILE, "utf8")
        .match(/MIGRATED_MONITOR_RULE_NAME:\s*string\s*=\s*"([^"]+)"/);

      expect(match).not.toBeNull();

      for (const language of ["en", ...TRANSLATED_LANGUAGES]) {
        expect(readPage(MONITOR_RULES_PAGE, language)).toContain(
          `**${(match as RegExpMatchArray)[1]}**`,
        );
      }
    });
  });
});
