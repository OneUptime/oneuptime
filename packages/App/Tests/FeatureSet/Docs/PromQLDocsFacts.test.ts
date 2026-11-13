import {
  readPage,
  scanMarkdown,
  TRANSLATED_LANGUAGES,
} from "./DocsContentSupport";
import {
  DOCS_CORPUS,
  DocsReader,
  DocsRuleFailure,
  DocsRuleId,
  ruleById,
} from "./DocsContentRules";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { comparableFence } from "./DocsTranslationChecks";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  PROMQL_DEFAULT_LOOKBACK_DELTA_MS,
  PROMQL_DEFAULT_MAX_SAMPLES,
  PROMQL_DEFAULT_SUBQUERY_STEP_MS,
  PROMQL_DEFAULT_TIMEOUT_MS,
  PROMQL_MAX_POINTS_PER_SERIES,
} from "Common/Utils/PromQL/PromQLEngine";
import {
  PROMQL_DEFAULT_MAX_ROWS,
  PROMQL_QUERY_TIMEOUT_SECONDS,
} from "Common/Server/Utils/PromQL/PromQLMetricSeriesSource";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE PROMQL PAGE SAYS WHAT THE PRODUCT DOES (issue #6796).
 *
 * docs/telemetry/promql tells a reader how to query metrics with PromQL on
 * the Metrics page and from Grafana, how OpenTelemetry names read in PromQL,
 * and what a query may read. Each claim is held here to the code that makes
 * it true, and every language's copy to the shape of the English page, so a
 * page and a product that drift apart fail the suite.
 */

const PAGE: string = "telemetry/promql";
const ENGLISH: string = readPage("en", PAGE);

const API_SOURCE: string = fs.readFileSync(
  path.resolve(__dirname, "../../../../Common/Server/API/PrometheusAPI.ts"),
  "utf8",
);

const formatCount: (value: number) => string = (value: number): string => {
  return value.toLocaleString("en-US");
};

// The row of the Limits table whose first cell is `name`.
const limitRow: (name: string) => string = (name: string): string => {
  const row: string | undefined = ENGLISH.split("\n").find(
    (line: string): boolean => {
      return line.startsWith(`| ${name} |`);
    },
  );

  if (!row) {
    throw new Error(`The Limits table has no row "${name}".`);
  }

  return row;
};

describe("PromQL docs: where the page lives", () => {
  test("is in the Telemetry nav, after the reference pages the explorers share", () => {
    const telemetry: NavGroup | undefined = DocsNav.find(
      (group: NavGroup): boolean => {
        return group.title === "Telemetry";
      },
    );
    const urls: Array<string> = (telemetry?.links || []).map(
      (link: NavLink): string => {
        return link.url;
      },
    );

    expect(urls).toContain("/docs/telemetry/promql");
    expect(urls.indexOf("/docs/telemetry/promql")).toBe(
      urls.indexOf("/docs/telemetry/charts-and-time-ranges") + 1,
    );
  });

  test("is linked from the Metrics Explorer page's tab table", () => {
    expect(readPage("en", "telemetry/metrics-explorer")).toContain(
      "| **PromQL** |",
    );
    expect(readPage("en", "telemetry/metrics-explorer")).toContain(
      "(/docs/telemetry/promql)",
    );
  });
});

describe("PromQL docs: the limits are the engine's", () => {
  test.each([
    [
      "Points in one series of a range query",
      formatCount(PROMQL_MAX_POINTS_PER_SERIES),
    ],
    [
      "Samples one query may read and hold",
      formatCount(PROMQL_DEFAULT_MAX_SAMPLES),
    ],
    [
      "Metric points one selector may read",
      formatCount(PROMQL_DEFAULT_MAX_ROWS),
    ],
    ["Time a read may take", `${PROMQL_QUERY_TIMEOUT_SECONDS} seconds`],
    ["Time evaluating may take", `${PROMQL_DEFAULT_TIMEOUT_MS / 1000} seconds`],
    [
      "How far back a selector looks for a series' latest sample",
      `${PROMQL_DEFAULT_LOOKBACK_DELTA_MS / 60000} minutes`,
    ],
    [
      "A subquery's step, when the query leaves it out",
      `${PROMQL_DEFAULT_SUBQUERY_STEP_MS / 60000} minute`,
    ],
  ])("%s: %s", (name: string, value: string) => {
    expect(limitRow(name)).toBe(`| ${name} | ${value} |`);
  });

  test("the troubleshooting entry quotes the row limit the source says", () => {
    expect(ENGLISH).toContain(
      `"The query reads more than ${formatCount(PROMQL_DEFAULT_MAX_ROWS)} metric points"`,
    );
  });
});

describe("PromQL docs: the API is the one the server serves", () => {
  test("Grafana is pointed at /api/prometheus, under which the routes live", () => {
    expect(API_SOURCE).toContain(
      'export const PROMETHEUS_API_PATH: string = "/prometheus/api/v1";',
    );
    expect(ENGLISH).toContain("`https://oneuptime.com/api/prometheus`");
  });

  test.each([
    "query",
    "query_range",
    "series",
    "labels",
    "label/:labelName/values",
    "metadata",
  ])("the server serves /api/v1/%s, which the page lists", (route: string) => {
    expect(API_SOURCE).toContain(
      route === "label/:labelName/values"
        ? "`${PROMETHEUS_API_PATH}/label/:labelName/values`"
        : `\`\${PROMETHEUS_API_PATH}/${route}\``,
    );
    expect(ENGLISH).toContain(
      `| \`/api/v1/${route.replace(":labelName", "<name>")}\` |`,
    );
  });

  test("a key is taken as a bearer token or a basic-auth password, as the page says", () => {
    expect(API_SOURCE).toContain('scheme.toLowerCase() === "bearer"');
    expect(API_SOURCE).toContain('scheme.toLowerCase() === "basic"');
    expect(ENGLISH).toContain(
      "any user name, with the API key as the password",
    );
  });
});

describe("PromQL docs: the words on the PromQL tab", () => {
  test.each([
    "PromQL",
    "Run Query",
    "Graph",
    "Table",
    "Examples",
    "Add a metric name",
  ])("**%s** is drawn by the Dashboard", (label: string) => {
    expect(ENGLISH).toContain(`**${label}**`);

    const dashboardSources: string = [
      "Components/Metrics/PromQL/PromQLQueryView.tsx",
      "Components/Metrics/MetricsNavTabs.tsx",
    ]
      .map((file: string): string => {
        return fs.readFileSync(
          path.resolve(__dirname, "../../../FeatureSet/Dashboard/src", file),
          "utf8",
        );
      })
      .join("\n");

    expect(dashboardSources).toContain(`"${label}"`);
  });

  test("**Create API Key** is the API Keys table's own button, in every language", () => {
    const view: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../FeatureSet/Dashboard/src/Components/Metrics/PromQL/PromQLQueryView.tsx",
      ),
      "utf8",
    );

    expect(ENGLISH).toContain("**Create API Key**");
    // Named the way the table names its create button, not a phrase of its own.
    expect(view).toContain("translateCreateAction(translator, {");
    expect(view).toContain('itemName: "API Key"');
    expect(view).not.toContain('"Create API Key"');

    for (const lang of TRANSLATED_LANGUAGES) {
      expect(readPage(lang, PAGE)).toContain(
        `**${drawnDashboardLabel(lang, "Create API Key")}**`,
      );
    }
  });

  test.each(TRANSLATED_LANGUAGES)(
    "%s writes the tab and its buttons as the Dashboard draws them",
    (lang: string) => {
      const page: string = readPage(lang, PAGE);

      for (const label of ["PromQL", "Run Query", "Graph", "Table"]) {
        expect(page).toContain(`**${drawnDashboardLabel(lang, label)}**`);
      }
    },
  );
});

describe("PromQL docs: code reads the same in every language", () => {
  /*
   * A query, a curl line and their comments are copied as written, so every
   * language shows the English page's code blocks. Only the diagram is
   * translated, and it keeps the English diagram's shape.
   */
  test.each(TRANSLATED_LANGUAGES)(
    "%s keeps the English code blocks, and the diagram's shape",
    (lang: string) => {
      expect(
        scanMarkdown(readPage(lang, PAGE)).fences.map(comparableFence),
      ).toEqual(scanMarkdown(ENGLISH).fences.map(comparableFence));
    },
  );
});

/*
 * The docs' own rules (DocsContentRules), run for this page alone so a
 * translation is checked in seconds: the content rules that read the
 * Markdown, and the shape every translation keeps.
 */
const RULES: Array<DocsRuleId> = [
  "title",
  "components",
  "codeClosed",
  "codeLanguage",
  "headingLevels",
  "uniqueHeadings",
  "pageLinks",
  "inPageAnchors",
  "sameShape",
];

describe("PromQL docs: every language keeps the docs' rules", () => {
  const docs: DocsReader = new DocsReader(DOCS_CORPUS);

  test.each(["en", ...TRANSLATED_LANGUAGES])(
    "%s has the page, and it passes the content rules",
    async (lang: string) => {
      expect(docs.hasPage(lang, PAGE)).toBe(true);

      const failures: Array<string> = [];

      for (const id of RULES) {
        if (id === "sameShape" && lang === "en") {
          continue;
        }

        const found: Array<DocsRuleFailure> = await ruleById(id).check(
          docs,
          lang,
        );

        for (const failure of found) {
          if (failure.page === PAGE) {
            failures.push(
              `${id}: line ${failure.line ?? "-"}: ${failure.detail}`,
            );
          }
        }
      }

      expect(failures).toEqual([]);
    },
  );
});
