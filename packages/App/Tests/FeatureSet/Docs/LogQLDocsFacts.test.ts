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
import { comparableFence } from "./DocsTranslationChecks";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  LOGQL_DEFAULT_MAX_SAMPLE_LINES,
  LOGQL_DEFAULT_MAX_SCANNED_LINES,
  LOGQL_DEFAULT_MAX_SERIES,
  LOGQL_MAX_POINTS_PER_SERIES,
} from "Common/Utils/LogQL/LogQLEngine";
import {
  LOGQL_MAX_RESULT_BYTES,
  LOGQL_QUERY_TIMEOUT_SECONDS,
} from "Common/Server/Utils/LogQL/LogQLClickhouseSource";
import {
  LOKI_DEFAULT_LIMIT,
  LOKI_MAX_ENTRIES_LIMIT,
} from "Common/Server/Utils/LogQL/LokiHttpApi";
import { COMPATIBLE_QUERY_DEFAULT_LIMIT_PER_MINUTE } from "Common/Server/Middleware/CompatibleQueryRateLimit";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE LOGQL PAGE SAYS WHAT THE PRODUCT DOES (issue #7700).
 *
 * docs/telemetry/logql tells a reader how to point Grafana's Loki data
 * source at OneUptime, how a log's attributes read as LogQL labels, what
 * LogQL covers and what a query may read. Each claim is held here to the
 * code that makes it true, and every language's copy to the shape of the
 * English page, so a page and a product that drift apart fail the suite.
 */

const PAGE: string = "telemetry/logql";
const ENGLISH: string = readPage("en", PAGE);

const API_SOURCE: string = fs.readFileSync(
  path.resolve(__dirname, "../../../../Common/Server/API/LokiAPI.ts"),
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

describe("LogQL docs: where the page lives", () => {
  test("is in the Telemetry nav, right after PromQL", () => {
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

    expect(urls.indexOf("/docs/telemetry/logql")).toBe(
      urls.indexOf("/docs/telemetry/promql") + 1,
    );
  });

  test("the PromQL page links to it", () => {
    expect(readPage("en", "telemetry/promql")).toContain(
      "(/docs/telemetry/logql)",
    );
  });
});

describe("LogQL docs: the limits are the code's", () => {
  test.each([
    ["Lines a log query answers", formatCount(LOKI_MAX_ENTRIES_LIMIT)],
    [
      "Logs a log query reads, when filters past its parsers drop some",
      formatCount(LOGQL_DEFAULT_MAX_SCANNED_LINES),
    ],
    [
      "Logs a metric query reads itself, when ClickHouse cannot count them",
      formatCount(LOGQL_DEFAULT_MAX_SAMPLE_LINES),
    ],
    ["Series a metric query answers", formatCount(LOGQL_DEFAULT_MAX_SERIES)],
    [
      "Points in one series of a range query",
      formatCount(LOGQL_MAX_POINTS_PER_SERIES),
    ],
    ["Logs one read hands back", `${LOGQL_MAX_RESULT_BYTES / 1024 / 1024} MB`],
    ["Time a read may take", `${LOGQL_QUERY_TIMEOUT_SECONDS} seconds`],
    [
      "Queries a project may send each minute",
      formatCount(COMPATIBLE_QUERY_DEFAULT_LIMIT_PER_MINUTE),
    ],
  ])("%s: %s", (name: string, value: string) => {
    expect(limitRow(name)).toBe(`| ${name} | ${value} |`);
  });

  test("a log query's default limit is the API's", () => {
    expect(ENGLISH).toContain(
      `A log query answers \`limit\` lines, ${LOKI_DEFAULT_LIMIT} by default`,
    );
  });
});

describe("LogQL docs: the API is the one the server serves", () => {
  test("Grafana is pointed at /api/loki, under which Loki's own paths live", () => {
    expect(API_SOURCE).toContain(
      'export const LOKI_API_PATH: string = "/loki/loki/api/v1";',
    );
    expect(ENGLISH).toContain("`https://oneuptime.com/api/loki`");
  });

  test.each([
    "query",
    "query_range",
    "labels",
    "label/:labelName/values",
    "series",
  ])(
    "the server serves /loki/api/v1/%s, which the page lists",
    (route: string) => {
      expect(API_SOURCE).toContain(`\`\${LOKI_API_PATH}/${route}\``);
      expect(ENGLISH).toContain(
        `| \`/loki/api/v1/${route.replace(":labelName", "<name>")}\` |`,
      );
    },
  );
});

describe("LogQL docs: code reads the same in every language", () => {
  test.each(TRANSLATED_LANGUAGES)(
    "%s keeps the English code blocks, and the diagram's shape",
    (lang: string) => {
      expect(
        scanMarkdown(readPage(lang, PAGE)).fences.map(comparableFence),
      ).toEqual(scanMarkdown(ENGLISH).fences.map(comparableFence));
    },
  );
});

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

describe("LogQL docs: every language keeps the docs' rules", () => {
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
