import { readPage } from "./DocsContentSupport";
import { describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import Search from "Common/Types/BaseDatabase/Search";
import { toLikePattern } from "Common/Types/BaseDatabase/WildcardPattern";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import LogSeverity from "Common/Types/Log/LogSeverity";
import {
  LOG_FIELD_ALIASES,
  queryStringToFilter,
  LogFilter,
} from "Common/Types/Log/LogQueryToFilter";
import { JSONObject } from "Common/Types/JSON";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import TelemetrySourceMap from "Common/Models/DatabaseModels/TelemetrySourceMap";
import ErrorClass from "Common/Types/Telemetry/ErrorClass";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
} from "Common/Types/Telemetry/TelemetryIngestSurface";
import {
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  SearchValuePredicate,
  parseSearchQuery,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  DEFAULT_KEY_VALUE_DELIMITER,
  MAX_KEY_VALUE_DELIMITER_LENGTH,
  parseKeyValuePairs,
  resolveKeyValueParserOptions,
} from "Common/Utils/Log/KeyValueParser";
import {
  SourceMapMaxBytesPerResolve,
  SourceMapMaxFileSizeInBytes,
  SourceMapMaxFilesPerRequest,
  SourceMapMaxMapsPerRelease,
  SourceMapRetentionInDays,
} from "Common/Server/EnvironmentConfig";
import LogPipelineService, {
  LoadedPipeline,
} from "../../../FeatureSet/Telemetry/Services/LogPipelineService";
import { compileFilter } from "../../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import OtelProfilesIngestService from "../../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import SourceMapIngestService from "../../../FeatureSet/Telemetry/Services/SourceMapIngestService";
import {
  EXPLICIT_INGEST_TOKEN_HEADERS,
  extractIngestTokenFromAuthorizationHeader,
} from "../../../FeatureSet/Telemetry/Utils/PyroscopeAuthorization";
import {
  SPAN_KIND_VALUE_MAP,
  TRACE_FIELD_ALIAS_MAP,
  ParsedTraceSearch,
  parseTraceSearch,
  toSpanStatusCode,
  toTraceDurationFilter,
} from "../../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";
import {
  METRICS_FIELD_ALIAS_MAP,
  ParsedMetricsSearch,
  parseMetricsSearch,
} from "../../../FeatureSet/Dashboard/src/Components/Metrics/MetricsSearchQuery";
import {
  EXCEPTION_FIELD_ALIASES,
  ExceptionSearchFilters,
  ResolvedExceptionServices,
  parseExceptionSearch,
  resolveExceptionServiceIds,
} from "../../../FeatureSet/Dashboard/src/Utils/ExceptionsSearchQuery";
import ProfileUtil from "../../../FeatureSet/Dashboard/src/Utils/ProfileUtil";

/*
 * What the English telemetry pages say about the product, held to the code
 * that makes it true. Docs task 11 audited Search Syntax, Continuous
 * Profiling, Source Maps and Log Pipelines against the code and rewrote what
 * had drifted; these tests keep them from drifting again:
 *
 *   - Search Syntax: every row of the value, exclusion and field tables, run
 *     through the shared grammar and each explorer's own compiler.
 *   - Continuous Profiling: the ingest routes, the three ways to pass the
 *     key, which keys may send profiles, the ingress body limit, the sample
 *     type a profile is stored under, the profile type table and the
 *     default retention.
 *   - Source Maps: the five settings and their defaults (code, Helm chart and
 *     page agree), which two can only be lowered, the ingress body limit, the
 *     bundle path rule, which keys may upload, and who reads raw map content.
 *   - Log Pipelines: the processors' defaults and rules, run through the real
 *     pipeline engine.
 *
 * The zoom page has ChartTimeRangeZoomDocs and ZoomDocsPromises, the
 * recording rules page LogRecordingRulesDocs, the Key=Value Parser's
 * ceilings and its Sophos and Fortinet examples LogPipelinesDocs, and the
 * translations TelemetryDocsTranslations.
 */

/*
 * The service modules pull in the per-signal queue services, which load
 * BullMQ at import time. Nothing queue-side is checked here.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

const SEARCH: string = "telemetry/search-syntax";
const PROFILES: string = "telemetry/profiles";
const SOURCE_MAPS: string = "telemetry/source-maps";
const PIPELINES: string = "telemetry/log-pipelines";

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_DIR, relativePath), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

// The rows of the first Markdown table whose header row is `header`.
function tableAfter(page: string, header: string): Array<Array<string>> {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.replace(/\s+/g, " ").trim() === header;
  });

  expect({ header, found: start >= 0 }).toEqual({ header, found: true });

  const rows: Array<Array<string>> = [];

  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows;
}

// The rows of the table that follows a heading, whatever its header.
function tableUnder(page: string, heading: string): Array<Array<string>> {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const header: string | undefined = lines
    .slice(start + 1)
    .find((line: string): boolean => {
      return line.startsWith("|");
    });

  return tableAfter(
    lines.slice(start).join("\n"),
    (header as string).replace(/\s+/g, " ").trim(),
  );
}

// The code spans of a table cell, in order.
function codeSpans(cell: string): Array<string> {
  return Array.from(cell.matchAll(/`([^`]+)`/g), (match: RegExpMatchArray) => {
    return match[1] as string;
  });
}

// The one token a query parses to.
function onlyToken(query: string): SearchToken {
  const tokens: Array<SearchToken> = parseSearchQuery(query);

  expect({ query, tokens: tokens.length }).toEqual({ query, tokens: 1 });

  return tokens[0] as SearchToken;
}

// What a token filters, without the raw text it was typed as.
function meaning(query: string): Array<Omit<SearchToken, "raw">> {
  return parseSearchQuery(query).map(
    (token: SearchToken): Omit<SearchToken, "raw"> => {
      return {
        type: token.type,
        key: token.key,
        predicate: token.predicate,
        negated: token.negated,
      };
    },
  );
}

describe("Search Syntax", () => {
  const page: string = englishPage(SEARCH);

  describe("the Matching values table, through the shared grammar", () => {
    /*
     * The operator each row's example parses to. A row added to the table
     * without an entry here fails, and so does a row whose example the
     * grammar reads differently.
     */
    const EXPECTED: Record<string, Partial<SearchValuePredicate>> = {
      "@k:abc": { operator: SearchValueOperator.Equals, value: "abc" },
      "@k:a*": { operator: SearchValueOperator.Wildcard, values: ["a*"] },
      "@k:*c": { operator: SearchValueOperator.Wildcard, values: ["*c"] },
      "@k:a*c": { operator: SearchValueOperator.Wildcard, values: ["a*c"] },
      "@k:a?c": { operator: SearchValueOperator.Wildcard, values: ["a?c"] },
      "@k:*": { operator: SearchValueOperator.Exists },
      "@k:~abc": { operator: SearchValueOperator.Contains, value: "abc" },
      "@k:!abc": { operator: SearchValueOperator.NotEquals, value: "abc" },
      "@k:>100": { operator: SearchValueOperator.GreaterThan, value: "100" },
      "@k:(a OR b)": { operator: SearchValueOperator.In, values: ["a", "b"] },
      "@k:(a* OR b*)": {
        operator: SearchValueOperator.Wildcard,
        values: ["a*", "b*"],
      },
    };

    const rows: Array<Array<string>> = tableAfter(
      page,
      "| You type | It matches |",
    );

    it("documents exactly the forms checked here", () => {
      expect(
        rows.map((row: Array<string>): string => {
          return codeSpans(row[0] as string)[0] as string;
        }),
      ).toEqual(Object.keys(EXPECTED));
    });

    it.each(Object.entries(EXPECTED))(
      "reads %s as the page says",
      (query: string, expected: Partial<SearchValuePredicate>) => {
        const token: SearchToken = onlyToken(query);

        expect(token.type).toBe(SearchTokenType.Attribute);
        expect(token.key).toBe("k");
        expect(token.negated).toBe(false);
        expect(token.predicate).toEqual(expect.objectContaining(expected));
      },
    );

    it("takes >=, < and <= as comparisons too", () => {
      expect(onlyToken("@k:>=100").predicate.operator).toBe(
        SearchValueOperator.GreaterThanOrEqual,
      );
      expect(onlyToken("@k:<100").predicate.operator).toBe(
        SearchValueOperator.LessThan,
      );
      expect(onlyToken("@k:<=100").predicate.operator).toBe(
        SearchValueOperator.LessThanOrEqual,
      );
      expect(page).toContain("Also `>=`, `<`, `<=`");
    });

    it("reads `@k:[a, b]` as the same thing as `@k:(a OR b)`", () => {
      expect(onlyToken("@k:[a, b]").predicate).toEqual(
        onlyToken("@k:(a OR b)").predicate,
      );
      expect(page).toContain("`@k:[a, b]` is the same thing");
    });

    /*
     * A glob reaches the database as a LIKE pattern: `*` is any run of
     * characters and `?` exactly one, so `a*` starts with a, `*c` ends with
     * c and `a?c` is a, one character, c.
     */
    it("matches the globs the way the table explains them", () => {
      expect(toLikePattern("a*")).toBe("a%");
      expect(toLikePattern("*c")).toBe("%c");
      expect(toLikePattern("a*c")).toBe("a%c");
      expect(toLikePattern("a?c")).toBe("a_c");
      expect(page).toContain(
        "`?` is exactly one character — `abc`, `axc`, but not `ac`",
      );
    });
  });

  it("lets quotes protect spaces but not wildcards", () => {
    expect(onlyToken('@k:"a b*"').predicate).toEqual(
      expect.objectContaining({
        operator: SearchValueOperator.Wildcard,
        values: ["a b*"],
      }),
    );
    expect(toLikePattern("a b*")).toBe("a b%");
    expect(page).toContain(
      'Quotes protect **spaces**, not wildcards — `@k:"a b*"` still matches anything starting with `a b`.',
    );
  });

  it("makes the character after a backslash literal, as the escapes table says", () => {
    const rows: Array<Array<string>> = tableUnder(
      page,
      "### Literal `*`, `?` and other punctuation",
    );

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const typed: string = codeSpans(row[0] as string)[0] as string;
      const literal: string = codeSpans(row[1] as string)[0] as string;

      expect({ typed, predicate: onlyToken(typed).predicate }).toEqual({
        typed,
        predicate: expect.objectContaining({
          operator: SearchValueOperator.Equals,
          value: literal,
        }),
      });
    }
  });

  it("inverts any filter with a leading -, as the Excluding table lists", () => {
    // Each row's filter, turned around.
    const INVERTED: Record<string, SearchValueOperator> = {
      "-severity:debug": SearchValueOperator.NotEquals,
      "-@platform.team:a*": SearchValueOperator.NotWildcard,
      "-@k:*": SearchValueOperator.NotExists,
      "-@k:(a OR b)": SearchValueOperator.NotIn,
      "-@k:>100": SearchValueOperator.LessThanOrEqual,
      "-@k:~abc": SearchValueOperator.NotContains,
    };

    const rows: Array<Array<string>> = tableUnder(page, "## Excluding");

    expect(
      rows.map((row: Array<string>): string => {
        return codeSpans(row[0] as string)[0] as string;
      }),
    ).toEqual(Object.keys(INVERTED));

    for (const [typed, operator] of Object.entries(INVERTED)) {
      const token: SearchToken = onlyToken(typed);

      expect({
        typed,
        negated: token.negated,
        operator: token.predicate.operator,
      }).toEqual({ typed, negated: true, operator });
    }

    expect(onlyToken("-@k:>100").predicate.value).toBe("100");
    expect(onlyToken("-@k:(a OR b)").predicate.values).toEqual(["a", "b"]);
  });

  it("keeps text that merely contains a colon as text", () => {
    for (const text of ["https://example.com", "12:30"]) {
      expect({ text, type: onlyToken(text).type }).toEqual({
        text,
        type: SearchTokenType.FreeText,
      });
      expect(page).toContain(`\`${text}\``);
    }
  });

  it("treats a bare key:value whose key is no field as an attribute", () => {
    expect(queryStringToFilter("k8s.pod:api-0")).toEqual(
      queryStringToFilter("@k8s.pod:api-0"),
    );
    expect(queryStringToFilter("k8s.pod:api-0").attributes).toEqual({
      "k8s.pod": "api-0",
    });
    expect(page).toContain(
      "so `k8s.pod:api-0` and `@k8s.pod:api-0` mean the same thing",
    );
  });

  it("skips AND, OR and NOT between filters", () => {
    expect(meaning("severity:error AND service:api")).toEqual(
      meaning("severity:error service:api"),
    );
    expect(meaning("NOT severity:debug")).toEqual(meaning("severity:debug"));
    expect(meaning("severity:error OR service:api")).toEqual(
      meaning("severity:error service:api"),
    );
    expect(page).toContain(
      "`OR` and `NOT` written there are skipped, so `NOT severity:debug` means the same as `severity:debug`",
    );
  });

  it("ANDs two filters on the same key, which is how a range is written", () => {
    const filter: LogFilter = queryStringToFilter(
      "@http.status_code:>=500 @http.status_code:<=599",
    );

    expect(filter.attributes?.["http.status_code"]).toHaveLength(2);
    expect(page).toContain("@http.status_code:>=500 @http.status_code:<=599");
  });

  describe("the Logs fields", () => {
    const rows: Array<Array<string>> = tableUnder(page, "### Logs");

    it("names each field and alias the logs compiler maps, and no other", () => {
      const documented: Record<string, Array<string>> = {};

      for (const row of rows) {
        const field: string = codeSpans(row[0] as string)[0] as string;

        documented[field] = codeSpans(row[1] as string);
      }

      for (const [field, aliases] of Object.entries(documented)) {
        const column: string | undefined = LOG_FIELD_ALIASES[field];

        expect({ field, mapped: column !== undefined }).toEqual({
          field,
          mapped: true,
        });

        for (const alias of aliases) {
          expect({ field, alias, column: LOG_FIELD_ALIASES[alias] }).toEqual({
            field,
            alias,
            column,
          });
        }
      }

      expect(Object.keys(documented)).toEqual([
        "severity",
        "service",
        "trace",
        "span",
        "message",
      ]);
      expect(documented["severity"]).toEqual(["level"]);
      expect(documented["message"]).toEqual(["msg", "log", "body"]);
    });

    it("accepts every severity spelling the page lists, in any casing", () => {
      const severityRow: Array<string> = rows.find((row: Array<string>) => {
        return (row[0] as string).includes("`severity`");
      }) as Array<string>;
      const spellings: Array<string> = codeSpans(severityRow[2] as string);

      expect(spellings).toEqual([
        "fatal",
        "error",
        "warning",
        "warn",
        "info",
        "information",
        "debug",
        "trace",
        "unspecified",
      ]);

      const stored: Array<string> = Object.values(LogSeverity);

      for (const spelling of spellings) {
        for (const typed of [spelling, spelling.toUpperCase()]) {
          const severity: unknown = queryStringToFilter(
            `severity:${typed}`,
          ).severityText;

          expect({
            typed,
            stored: stored.includes(severity as string),
          }).toEqual({ typed, stored: true });
        }
      }

      expect(queryStringToFilter("severity:warn").severityText).toBe(
        LogSeverity.Warning,
      );
      expect(queryStringToFilter("level:info").severityText).toBe(
        LogSeverity.Information,
      );
    });

    it("searches the message with bare words, and the attributes with @", () => {
      expect(queryStringToFilter("timeout").body).toBeInstanceOf(Search);
      expect(queryStringToFilter("@body:x").attributes).toEqual({ body: "x" });
      expect(queryStringToFilter("@body:x").body).toBeUndefined();
    });

    it("finds a service by its whole name, in any casing", () => {
      /*
       * The shared logs viewer turns `service:<name>` into the service's id
       * by comparing whole lowercased names: no fragment match.
       */
      const viewer: string = readSource(
        "Common/UI/Components/LogsViewer/LogsViewer.tsx",
      );

      expect(viewer).toContain("service.name.toLowerCase() === lowerName");
      expect(
        rows.find((row: Array<string>) => {
          return (row[0] as string).includes("`service`");
        })?.[2],
      ).toBe("Service name, written in full, in any casing");
    });
  });

  describe("the Traces fields", () => {
    const rows: Array<Array<string>> = tableUnder(page, "### Traces");

    it("names exactly the fields the traces compiler knows", () => {
      const documented: Array<string> = rows.flatMap(
        (row: Array<string>): Array<string> => {
          return codeSpans(row[0] as string);
        },
      );

      expect(
        documented
          .map((field: string): string => {
            return field.toLowerCase();
          })
          .sort(),
      ).toEqual(Object.keys(TRACE_FIELD_ALIAS_MAP).sort());
    });

    it("reads field names in any casing", () => {
      expect(parseTraceSearch("statusMessage:boom").fieldFilters).toEqual(
        parseTraceSearch("statusmessage:boom").fieldFilters,
      );
      expect(page).toContain(
        "`statusMessage:` and `statusmessage:` are the same field",
      );
    });

    it("maps the status values the page lists", () => {
      const statusRow: Array<string> = rows.find((row: Array<string>) => {
        return (row[0] as string) === "`status`";
      }) as Array<string>;

      expect(codeSpans(statusRow[1] as string)).toEqual([
        "ok",
        "error",
        "unset",
      ]);
      expect(toSpanStatusCode("ok")).toBe(SpanStatus.Ok);
      expect(toSpanStatusCode("error")).toBe(SpanStatus.Error);
      expect(toSpanStatusCode("unset")).toBe(SpanStatus.Unset);
    });

    it("maps the kind values the page lists", () => {
      const kindRow: Array<string> = rows.find((row: Array<string>) => {
        return (row[0] as string) === "`kind`";
      }) as Array<string>;

      expect(codeSpans(kindRow[1] as string)).toEqual(
        Object.keys(SPAN_KIND_VALUE_MAP),
      );
    });

    it("reads duration in milliseconds, with > and < bounds", () => {
      expect(toTraceDurationFilter(">500")).toEqual({
        minDurationNano: 500 * 1_000_000,
      });
      expect(toTraceDurationFilter("<200")).toEqual({
        maxDurationNano: 200 * 1_000_000,
      });
      expect(toTraceDurationFilter("500")).toEqual({
        exactDurationNano: 500 * 1_000_000,
      });
      expect(page).toContain(
        "Milliseconds: `duration:>500`, `duration:<200` or an exact value",
      );
    });

    it("takes an any-of list, and reads an excluded field as text", () => {
      const list: ParsedTraceSearch = parseTraceSearch("status:(ok OR unset)");

      expect(list.fieldFilters["statusCode"]).toEqual(["ok", "unset"]);

      const excluded: ParsedTraceSearch = parseTraceSearch("-status:error");

      expect(excluded.fieldFilters).toEqual({});
      expect(excluded.freeText).toBe("-status:error");
      expect(page).toContain(
        "`-status:error` is read as text to find in span names, and finds nothing",
      );
    });

    it("matches a single name or status message value as any part of it", () => {
      const viewer: string = readSource(
        "App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer.tsx",
      );

      expect(viewer).toMatch(
        /TEXT_CHIP_FIELDS: Set<string> = new Set\(\["name", "statusMessage"\]\)/,
      );
      expect(viewer).toMatch(
        /TEXT_CHIP_FIELDS\.has\(key\) && values\.length === 1\)[\s\S]{0,120}new Search\(values\[0\]!\)/,
      );
    });
  });

  describe("the Metrics fields", () => {
    const rows: Array<Array<string>> = tableUnder(page, "### Metrics");

    it("names exactly the fields the metrics compiler knows", () => {
      expect(
        rows.map((row: Array<string>): string => {
          return codeSpans(row[0] as string)[0] as string;
        }),
      ).toEqual(Object.keys(METRICS_FIELD_ALIAS_MAP));
    });

    it("matches a plain name or service value as any part of it", () => {
      const byName: ParsedMetricsSearch =
        parseMetricsSearch("name:http.server");

      expect(byName.nameFilter?.matches("http.server.request.duration")).toBe(
        true,
      );
      expect(byName.nameFilter?.matches("db.client.duration")).toBe(false);

      const byService: ParsedMetricsSearch =
        parseMetricsSearch("service:check");

      expect(byService.serviceMatcher?.("checkout")).toBe(true);
      expect(byService.serviceMatcher?.("payments")).toBe(false);

      // Bare words search the metric name too.
      expect(
        parseMetricsSearch("http.server").nameFilter?.matches(
          "http.server.request.duration",
        ),
      ).toBe(true);
    });
  });

  describe("the Exceptions fields", () => {
    const rows: Array<Array<string>> = tableUnder(page, "### Exceptions");

    it("names each field and alias the exceptions compiler maps, and no other", () => {
      const documented: Array<string> = [];

      for (const row of rows) {
        const field: string = codeSpans(row[0] as string)[0] as string;
        const aliases: Array<string> = codeSpans(row[1] as string);

        documented.push(field, ...aliases);

        for (const alias of aliases) {
          expect({
            field,
            alias,
            column: EXCEPTION_FIELD_ALIASES[alias.toLowerCase()],
          }).toEqual({
            field,
            alias,
            column: EXCEPTION_FIELD_ALIASES[field],
          });
        }
      }

      /*
       * `primaryEntityId`, the column's own name, works as well; the page
       * leaves it out because the column holds an id, not a name.
       */
      expect(
        documented
          .map((key: string): string => {
            return key.toLowerCase();
          })
          .sort(),
      ).toEqual(
        Object.keys(EXCEPTION_FIELD_ALIASES)
          .filter((key: string): boolean => {
            return key !== "primaryentityid";
          })
          .sort(),
      );
    });

    it("lists the error classes the class field takes", () => {
      const classRow: Array<string> = rows.find((row: Array<string>) => {
        return (row[0] as string) === "`class`";
      }) as Array<string>;

      expect(codeSpans(classRow[2] as string)).toEqual(
        Object.values(ErrorClass),
      );
    });

    it("filters the fields with @ too, and searches the message with bare words", () => {
      for (const key of ["type", "service", "env", "class"]) {
        const parsed: ExceptionSearchFilters = parseExceptionSearch(
          `@${key}:x`,
        );

        expect({ key, attributes: parsed.attributePredicates }).toEqual({
          key,
          attributes: {},
        });
        expect(
          parsed.fieldPredicates[EXCEPTION_FIELD_ALIASES[key] as string],
        ).toHaveLength(1);
      }

      expect(parseExceptionSearch("connection refused").freeText).toBe(
        "connection refused",
      );
      expect(page).toContain(
        "`@type:`, `@service:`, `@env:` and `@class:` still filter those fields",
      );
    });

    it("matches a plain service value as any part of the name", () => {
      const resolved: ResolvedExceptionServices = resolveExceptionServiceIds({
        predicates: parseExceptionSearch("service:check").fieldPredicates[
          "primaryEntityId"
        ] as Array<SearchValuePredicate>,
        services: [
          { id: "1", name: "Checkout" },
          { id: "2", name: "payments" },
        ],
      });

      expect(resolved.serviceIds).toEqual(["1"]);
    });
  });
});

describe("Continuous Profiling", () => {
  const page: string = englishPage(PROFILES);

  it("takes profiles on the two Pyroscope routes the page names", () => {
    const routes: string = readSource(
      "App/FeatureSet/Telemetry/API/Pyroscope.ts",
    );

    for (const route of [
      "/pyroscope/ingest",
      "/pyroscope/push.v1.PusherService/Push",
    ]) {
      expect(routes).toContain(`"${route}"`);
      expect(page).toContain(`\`${route.replace("/pyroscope", "")}\``);
    }
  });

  it("reads the key from the header, a Bearer token or the basic-auth password", () => {
    const key: string = "a4b1e6a2-6b7e-4c41-9d8a-5c0d2b8e1f3a";

    expect(EXPLICIT_INGEST_TOKEN_HEADERS).toContain("x-oneuptime-token");
    expect(extractIngestTokenFromAuthorizationHeader(`Bearer ${key}`)).toBe(
      key,
    );
    expect(
      extractIngestTokenFromAuthorizationHeader(
        `Basic ${Buffer.from(`oneuptime:${key}`).toString("base64")}`,
      ),
    ).toBe(key);

    const methods: Array<string> = tableAfter(
      page,
      "| Method | When to use it |",
    ).map((row: Array<string>): string => {
      return row[0] as string;
    });

    expect(methods).toEqual([
      "`x-oneuptime-token` header",
      "`Authorization: Bearer <token>`",
      "HTTP basic auth, with the token as the **password** (any user name)",
    ]);
  });

  it("needs a Server key: a Browser key cannot send profiles", () => {
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.Pyroscope),
    ).toBe(false);
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.OtelProfiles),
    ).toBe(false);
    expect(page).toContain("You need a **Server** telemetry ingestion key.");
    expect(page).toContain(
      "a Browser key is valid too, but cannot send profiles",
    );
  });

  it("states the ingress body limit on /pyroscope", () => {
    const nginx: string = readSource("Nginx/default.conf.template");
    const location: string = nginx.slice(
      nginx.indexOf("location /pyroscope {"),
      nginx.indexOf("location /source-maps {"),
    );

    expect(location).toContain("client_max_body_size 16M;");
    expect(page).toContain(
      "OneUptime's own ingress accepts up to 16 MB on `/pyroscope`",
    );
  });

  it("validates a key the way the page says", () => {
    const ingest: string = readSource(
      "App/FeatureSet/Telemetry/API/OTelIngest.ts",
    );
    const validate: string = ingest.slice(
      ingest.indexOf('"/otlp/v1/validate"'),
    );

    // The key type is reported, and a dead key answers 401.
    expect(validate).toContain("keyType: policy.keyType");
    expect(validate).toContain("policy.isEnabled === false || isExpired");
    expect(validate).toContain("new StatusCode(401)");
    expect(page).toContain(
      'A valid token returns `200` with `{"valid": true, ...}`, and its `keyType` must be `Server`',
    );
    expect(page).toContain(
      "An unknown, revoked, disabled or expired token returns `401`.",
    );
  });

  it("stores a profile under CPU time, then wall time, then in-use and allocated bytes, then the first type", () => {
    type SampleTypePicker = (
      sampleTypes: Array<JSONObject>,
      stringTable: Array<string>,
    ) => number;

    const pick: SampleTypePicker = (
      OtelProfilesIngestService as unknown as {
        selectCanonicalSampleTypeIndex: SampleTypePicker;
      }
    ).selectCanonicalSampleTypeIndex.bind(OtelProfilesIngestService);

    const strings: Array<string> = [
      "",
      "samples",
      "count",
      "cpu",
      "nanoseconds",
      "wall",
      "inuse_space",
      "bytes",
      "alloc_space",
      "custom",
    ];

    function types(...pairs: Array<[number, number]>): Array<JSONObject> {
      return pairs.map((pair: [number, number]): JSONObject => {
        return { type: pair[0], unit: pair[1] };
      });
    }

    // samples/count, cpu/nanoseconds: Go puts CPU second.
    expect(pick(types([1, 2], [3, 4]), strings)).toBe(1);
    expect(pick(types([1, 2], [5, 4]), strings)).toBe(1);
    expect(pick(types([8, 7], [6, 7]), strings)).toBe(1);
    expect(pick(types([9, 2], [8, 7]), strings)).toBe(1);
    expect(pick(types([9, 2], [1, 2]), strings)).toBe(0);

    expect(page).toContain(
      "CPU time (`cpu` in nanoseconds) if it has it, otherwise wall time, otherwise in-use then allocated bytes, otherwise the first type it declares",
    );
  });

  it("groups, names and measures each profile type as the table says", () => {
    const CATEGORY: Record<string, string> = {
      "CPU time": "cpu",
      "Wall time": "wall",
      "Memory (bytes)": "memory",
      "Memory (object counts)": "memory",
      "Lock contention": "locks",
      "Goroutines (Go)": "goroutines",
    };
    const UNIT: Record<string, string> = {
      nanoseconds: "nanoseconds",
      bytes: "bytes",
      count: "count",
    };

    const rows: Array<Array<string>> = tableUnder(
      page,
      "## Supported Profile Types",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[1] as string;
      }),
    ).toEqual(Object.keys(CATEGORY));

    for (const row of rows) {
      for (const type of codeSpans(row[0] as string)) {
        expect({
          type,
          category: ProfileUtil.getProfileCategory(type),
          unit: ProfileUtil.getProfileTypeUnit(type),
        }).toEqual({
          type,
          category: CATEGORY[row[1] as string],
          unit: UNIT[row[2] as string],
        });
      }
    }

    // Anything else is "Other", under its raw name.
    expect(
      ProfileUtil.getCategoryDisplayName(
        ProfileUtil.getProfileCategory("my_custom_type"),
      ),
    ).toBe("Other");
    expect(ProfileUtil.getProfileTypeDisplayName("my_custom_type")).toBe(
      "my_custom_type",
    );
    expect(page).toContain('appears under "Other" with its raw name');
  });

  it("keeps profiles for the project's retention, 15 days unless changed", () => {
    const project: string = readSource(
      "Common/Models/DatabaseModels/Project.ts",
    );

    expect(project).toMatch(
      /default: 15,\s*\}\)\s*public defaultTelemetryRetentionInDays\?: number/,
    );

    const settings: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/Settings/TelemetrySettings.tsx",
    );

    expect(settings).toContain('title: "Default Retention (Days)"');
    expect(page).toContain(
      "sets the **Default Retention (Days)**, 15 days unless you change it",
    );
  });
});

// The environment config module, re-read under other environment variables.
type EnvironmentConfigModule = typeof import("Common/Server/EnvironmentConfig");

describe("Source Maps", () => {
  const page: string = englishPage(SOURCE_MAPS);

  interface SourceMapSetting {
    valuesKey: string;
    envVar: string;
    fallback: number;
    value: number;
  }

  const SETTINGS: Array<SourceMapSetting> = [
    {
      valuesKey: "maxMapsPerRelease",
      envVar: "SOURCE_MAP_MAX_MAPS_PER_RELEASE",
      fallback: 1000,
      value: SourceMapMaxMapsPerRelease,
    },
    {
      valuesKey: "maxFilesPerRequest",
      envVar: "SOURCE_MAP_MAX_FILES_PER_REQUEST",
      fallback: 50,
      value: SourceMapMaxFilesPerRequest,
    },
    {
      valuesKey: "maxFileSizeBytes",
      envVar: "SOURCE_MAP_MAX_FILE_SIZE_BYTES",
      fallback: 52428800,
      value: SourceMapMaxFileSizeInBytes,
    },
    {
      valuesKey: "maxBytesPerResolve",
      envVar: "SOURCE_MAP_MAX_BYTES_PER_RESOLVE",
      fallback: 536870912,
      value: SourceMapMaxBytesPerResolve,
    },
    {
      valuesKey: "retentionDays",
      envVar: "SOURCE_MAP_RETENTION_DAYS",
      fallback: 90,
      value: SourceMapRetentionInDays,
    },
  ];

  it("lists the five settings with the defaults the code, the chart and the example config use", () => {
    const rows: Array<Array<string>> = tableAfter(
      page,
      "| `values.yaml` | Environment variable | Default |",
    );

    expect(
      rows.map((row: Array<string>) => {
        return row.map((cell: string): string => {
          return codeSpans(cell)[0] as string;
        });
      }),
    ).toEqual(
      SETTINGS.map((setting: SourceMapSetting): Array<string> => {
        return [
          `sourceMaps.${setting.valuesKey}`,
          setting.envVar,
          String(setting.fallback),
        ];
      }),
    );

    const helpers: string = readRepoFile(
      "HelmChart/Public/oneuptime/templates/_helpers.tpl",
    );
    const values: string = readRepoFile(
      "HelmChart/Public/oneuptime/values.yaml",
    );
    const valuesBlock: string = values.slice(values.indexOf("\nsourceMaps:"));
    const exampleEnv: string = readRepoFile("config.example.env");

    for (const setting of SETTINGS) {
      // The default the App uses when nothing is set.
      expect({ env: setting.envVar, value: setting.value }).toEqual({
        env: setting.envVar,
        value: setting.fallback,
      });
      // The chart passes its value through under the same default.
      expect(helpers).toContain(
        `- name: ${setting.envVar}\n  value: {{ default ${setting.fallback} $.Values.sourceMaps.${setting.valuesKey} | int64 | squote }}`,
      );
      expect(valuesBlock).toMatch(
        new RegExp(`\\n  ${setting.valuesKey}: ${setting.fallback}\\n`),
      );
      expect(exampleEnv).toContain(`${setting.envVar}=${setting.fallback}`);
    }
  });

  it("only lowers the per-request file count and the per-file size", () => {
    const keys: Array<string> = [
      "SOURCE_MAP_MAX_FILES_PER_REQUEST",
      "SOURCE_MAP_MAX_FILE_SIZE_BYTES",
      "SOURCE_MAP_MAX_MAPS_PER_RELEASE",
    ];
    const saved: Record<string, string | undefined> = {};

    for (const key of keys) {
      saved[key] = process.env[key];
    }

    try {
      process.env["SOURCE_MAP_MAX_FILES_PER_REQUEST"] = "500";
      process.env["SOURCE_MAP_MAX_FILE_SIZE_BYTES"] = String(200 * 1024 * 1024);
      process.env["SOURCE_MAP_MAX_MAPS_PER_RELEASE"] = "2000";

      jest.isolateModules(() => {
        const raised: EnvironmentConfigModule = jest.requireActual(
          "Common/Server/EnvironmentConfig",
        ) as EnvironmentConfigModule;

        expect(raised.SourceMapMaxFilesPerRequest).toBe(50);
        expect(raised.SourceMapMaxFileSizeInBytes).toBe(50 * 1024 * 1024);
        // The per-release ceiling is the one to raise.
        expect(raised.SourceMapMaxMapsPerRelease).toBe(2000);
      });

      process.env["SOURCE_MAP_MAX_FILES_PER_REQUEST"] = "10";
      process.env["SOURCE_MAP_MAX_FILE_SIZE_BYTES"] = String(1024 * 1024);

      jest.isolateModules(() => {
        const lowered: EnvironmentConfigModule = jest.requireActual(
          "Common/Server/EnvironmentConfig",
        ) as EnvironmentConfigModule;

        expect(lowered.SourceMapMaxFilesPerRequest).toBe(10);
        expect(lowered.SourceMapMaxFileSizeInBytes).toBe(1024 * 1024);
      });
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }
    }

    expect(page).toContain(
      "`maxFilesPerRequest` and `maxFileSizeBytes` can only be **lowered**",
    );
    expect(page).toContain(
      "`maxMapsPerRelease` is the one to raise if your build outgrows the default",
    );
  });

  it("states the ingress cap on the whole request body", () => {
    const nginx: string = readSource("Nginx/default.conf.template");
    const start: number = nginx.indexOf("location /source-maps {");
    const location: string = nginx.slice(
      start,
      nginx.indexOf("\n    location ", start + 1),
    );

    expect(location).toContain("client_max_body_size 50M;");
    expect(page).toContain(
      "the ingress also caps the **whole request body** at 50 MB",
    );
  });

  it("uploads on the documented route, with the bearer header as an alternative", () => {
    const routes: string = readSource(
      "App/FeatureSet/Telemetry/API/SourceMapIngest.ts",
    );

    expect(routes).toContain('"/source-maps/v1/upload"');
    expect(routes).toContain("mapBearerTokenMiddleware");
    expect(routes).toContain("TelemetryIngestionDisabled.middleware");
    expect(page).toContain("https://oneuptime.com/source-maps/v1/upload");
    expect(page).toContain(
      "`Authorization: Bearer YOUR_KEY` is accepted as an alternative to the `x-oneuptime-token` header",
    );
  });

  it("names a map's bundle after its file, without the trailing .map", () => {
    expect(
      SourceMapIngestService.bundlePathFromFileName("main.a8f1b2.js.map"),
    ).toBe("main.a8f1b2.js");
    expect(page).toContain("`main.a8f1b2.js.map` becomes `main.a8f1b2.js`");
  });

  it("takes uploads from Server keys only", () => {
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.SourceMap),
    ).toBe(false);
    expect(page).toContain("A **Server** telemetry ingestion key");
  });

  it("lets only owners, admins and the Read Telemetry Source Map permission read raw map content", () => {
    const access: Array<Permission> =
      new TelemetrySourceMap().getColumnAccessControlFor("content")?.read || [];

    expect([...access].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ReadTelemetrySourceMap,
      ].sort(),
    );
    expect(PermissionHelper.getTitle(Permission.ReadTelemetrySourceMap)).toBe(
      "Read Telemetry Source Map",
    );
    expect(page).toContain(
      "can only be read back by project owners and admins, and by anyone given the **Read Telemetry Source Map** permission",
    );
  });

  it("keeps maps for the retention the code applies", () => {
    expect(page).toContain(
      `Source maps are kept for ${SourceMapRetentionInDays} days after upload`,
    );
  });
});

describe("Log Pipelines", () => {
  const page: string = englishPage(PIPELINES);

  type ProcessorSpec = {
    processorType: LogPipelineProcessorType;
    configuration: JSONObject;
  };

  function pipeline(
    processors: Array<ProcessorSpec>,
    filterQuery?: string,
  ): LoadedPipeline {
    return {
      pipeline: { name: "docs" },
      compiledFilter: compileFilter(filterQuery || ""),
      processors: processors.map((processor: ProcessorSpec) => {
        return {
          name: "docs",
          processorType: processor.processorType,
          configuration: processor.configuration,
        };
      }),
    } as unknown as LoadedPipeline;
  }

  function attributesAfter(
    row: JSONObject,
    pipelines: Array<LoadedPipeline>,
  ): JSONObject {
    return (LogPipelineService.processLog(row, pipelines)["attributes"] ||
      {}) as JSONObject;
  }

  describe("the Key=Value Parser", () => {
    const rows: Array<Array<string>> = tableUnder(page, "### Configuration");

    function defaultOf(setting: string): string {
      return (
        rows.find((row: Array<string>) => {
          return row[0] === setting;
        }) as Array<string>
      )[1] as string;
    }

    it("defaults to any whitespace between pairs and = between key and value", () => {
      expect(resolveKeyValueParserOptions()).toEqual({
        pairDelimiter: null,
        keyValueDelimiter: DEFAULT_KEY_VALUE_DELIMITER,
      });
      expect(defaultOf("Pair Delimiter")).toBe("any whitespace");
      expect(defaultOf("Key-Value Delimiter")).toBe(
        `\`${DEFAULT_KEY_VALUE_DELIMITER}\``,
      );
      expect(defaultOf("Source Field")).toBe("`body`");
      expect(defaultOf("Target Prefix")).toBe("none");
      expect(defaultOf("Override on Conflict")).toBe("off");
    });

    it("refuses the delimiters the page says it refuses", () => {
      const tooLong: string = "x".repeat(MAX_KEY_VALUE_DELIMITER_LENGTH + 1);

      expect(() => {
        return resolveKeyValueParserOptions({ pairDelimiter: tooLong });
      }).toThrow();
      expect(() => {
        return resolveKeyValueParserOptions({
          pairDelimiter: ",",
          keyValueDelimiter: ",",
        });
      }).toThrow();
      expect(() => {
        return resolveKeyValueParserOptions({
          pairDelimiter: ",=",
          keyValueDelimiter: "=",
        });
      }).toThrow();
      expect(() => {
        return resolveKeyValueParserOptions({ pairDelimiter: '"' });
      }).toThrow();
      expect(() => {
        return resolveKeyValueParserOptions({ keyValueDelimiter: "\\" });
      }).toThrow();
      expect(
        resolveKeyValueParserOptions({
          pairDelimiter: "x".repeat(MAX_KEY_VALUE_DELIMITER_LENGTH),
        }).pairDelimiter,
      ).toHaveLength(MAX_KEY_VALUE_DELIMITER_LENGTH);
      expect(page).toContain(
        `each is at most ${MAX_KEY_VALUE_DELIMITER_LENGTH} characters long`,
      );
    });

    it("parses by the rules the page lists", () => {
      // Quoted values keep spaces; \" is a literal quote.
      expect(
        parseKeyValuePairs('message="IPSec Connection HQ-Branch1 terminated"'),
      ).toEqual({ message: "IPSec Connection HQ-Branch1 terminated" });
      expect(parseKeyValuePairs("a='x y'")).toEqual({ a: "x y" });
      expect(parseKeyValuePairs('a="say \\"hi\\""')).toEqual({
        a: 'say "hi"',
      });
      // An unclosed quote runs to the end of the line.
      expect(parseKeyValuePairs('a=1 msg="cut off here')).toEqual({
        a: "1",
        msg: "cut off here",
      });
      // Unquoted values run to the next pair delimiter, keeping their =.
      expect(parseKeyValuePairs("url=https://example.com/?a=b next=1")).toEqual(
        { url: "https://example.com/?a=b", next: "1" },
      );
      // Empty values are empty strings.
      expect(parseKeyValuePairs('a= b="" c=1')).toEqual({
        a: "",
        b: "",
        c: "1",
      });
      // Values are text.
      expect(parseKeyValuePairs("latency=11")).toEqual({ latency: "11" });
      /*
       * A header before the first pair and stray words are skipped; a
       * syslog priority glued to the first key is dropped.
       */
      expect(
        parseKeyValuePairs(
          'May  2 11:03:12 fw01 <30>device_name="SFW" stray log_type="Event"',
        ),
      ).toEqual({ device_name: "SFW", log_type: "Event" });
      // A repeated key keeps its first value.
      expect(parseKeyValuePairs("a=1 a=2")).toEqual({ a: "1" });

      for (const lead of [
        "**Quoted values**",
        "**Unquoted values**",
        "**Empty values**",
        "**Values are always text.**",
        "**A repeated key keeps its first value**",
      ]) {
        expect(page).toContain(lead);
      }
    });

    it("namespaces keys under the prefix, adding a separator unless it ends in one", () => {
      const line: JSONObject = { body: 'con_name="HQ" status=up' };

      function keysWith(prefix: string): Array<string> {
        return Object.keys(
          attributesAfter(line, [
            pipeline([
              {
                processorType: LogPipelineProcessorType.KeyValueParser,
                configuration: { source: "body", targetPrefix: prefix },
              },
            ]),
          ]),
        ).sort();
      }

      expect(keysWith("sophos")).toEqual(["sophos.con_name", "sophos.status"]);

      for (const separator of [".", "_", "-", ":"]) {
        expect(keysWith(`sophos${separator}`)).toEqual([
          `sophos${separator}con_name`,
          `sophos${separator}status`,
        ]);
      }

      expect(page).toContain(
        "`sophos` stores `con_name` as `sophos.con_name`. A separator is added unless the prefix already ends in `.`, `_`, `-` or `:`.",
      );
    });

    it("leaves an attribute the log already has alone unless told to override it", () => {
      const row: JSONObject = {
        body: 'device="from-the-line"',
        attributes: { device: "set-at-ingest" },
      };

      function deviceAfter(configuration: JSONObject): unknown {
        return attributesAfter(row, [
          pipeline([
            {
              processorType: LogPipelineProcessorType.KeyValueParser,
              configuration,
            },
          ]),
        ])["device"];
      }

      expect(deviceAfter({ source: "body" })).toBe("set-at-ingest");
      expect(deviceAfter({ source: "body", overrideOnConflict: true })).toBe(
        "from-the-line",
      );
    });
  });

  it("renames by default with the Attribute Remapper, and replaces a target that exists", () => {
    const row: JSONObject = {
      body: "x",
      attributes: { src_ip: "10.0.0.1", source_ip: "old" },
    };

    function remap(configuration: JSONObject): JSONObject {
      return attributesAfter(row, [
        pipeline([
          {
            processorType: LogPipelineProcessorType.AttributeRemapper,
            configuration: {
              sourceKey: "src_ip",
              targetKey: "source_ip",
              ...configuration,
            },
          },
        ]),
      ]);
    }

    // Defaults: Preserve Source off, Override on Conflict on.
    expect(remap({})).toEqual({ source_ip: "10.0.0.1" });
    expect(remap({ preserveSource: true })).toEqual({
      src_ip: "10.0.0.1",
      source_ip: "10.0.0.1",
    });
    expect(remap({ overrideOnConflict: false })).toEqual({
      src_ip: "10.0.0.1",
      source_ip: "old",
    });

    const rows: Array<Array<string>> = tableUnder(
      page,
      "## Attribute Remapper",
    );

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [row[0] as string, row[1] as string];
      }),
    ).toEqual([
      ["**Preserve Source**", "off"],
      ["**Override on Conflict**", "on"],
    ]);
  });

  it("maps severities ignoring case, and leaves an unmapped value alone", () => {
    const remapper: LoadedPipeline = pipeline([
      {
        processorType: LogPipelineProcessorType.SeverityRemapper,
        configuration: {
          sourceKey: "level",
          mappings: [
            { matchValue: "warn", severityText: "Warning", severityNumber: 13 },
          ],
        },
      },
    ]);

    function severityAfter(level: string): unknown {
      return LogPipelineService.processLog(
        {
          body: "x",
          severityText: LogSeverity.Information,
          attributes: { level },
        },
        [remapper],
      )["severityText"];
    }

    expect(severityAfter("WARN")).toBe(LogSeverity.Warning);
    expect(severityAfter("verbose")).toBe(LogSeverity.Information);
    expect(page).toContain("Matching ignores case.");
  });

  it("stores the first matching category, and leaves a log no rule matches alone", () => {
    const categorize: LoadedPipeline = pipeline([
      {
        processorType: LogPipelineProcessorType.CategoryProcessor,
        configuration: {
          targetKey: "category",
          categories: [
            { name: "Payment Error", filterQuery: "body LIKE '%payment%'" },
            { name: "Any Error", filterQuery: "body LIKE '%error%'" },
          ],
        },
      },
    ]);

    expect(
      attributesAfter({ body: "payment error" }, [categorize])["category"],
    ).toBe("Payment Error");
    expect(
      attributesAfter({ body: "disk error" }, [categorize])["category"],
    ).toBe("Any Error");
    expect(
      attributesAfter({ body: "all good" }, [categorize])["category"],
    ).toBeUndefined();
    expect(page).toContain(
      "The first matching rule wins; a log that matches none is left unchanged.",
    );
  });

  it("runs every matching pipeline in order, each seeing the last one's changes", () => {
    const parse: LoadedPipeline = pipeline([
      {
        processorType: LogPipelineProcessorType.KeyValueParser,
        configuration: { source: "body" },
      },
    ]);
    // Matches only once the first pipeline has extracted `status`.
    const tag: LoadedPipeline = pipeline(
      [
        {
          processorType: LogPipelineProcessorType.CategoryProcessor,
          configuration: {
            targetKey: "category",
            categories: [{ name: "Down", filterQuery: "" }],
          },
        },
      ],
      "attributes.status = 'down'",
    );

    const after: JSONObject = attributesAfter({ body: "status=down" }, [
      parse,
      tag,
    ]);

    expect(after).toEqual({ status: "down", category: "Down" });
    expect(page).toContain(
      "A later pipeline's filter also sees what earlier pipelines changed.",
    );
  });

  it("never drops or blanks a log a parser cannot read", () => {
    const row: JSONObject = { body: "no pairs here at all" };
    const after: JSONObject = LogPipelineService.processLog(row, [
      pipeline([
        {
          processorType: LogPipelineProcessorType.KeyValueParser,
          configuration: { source: "body" },
        },
        {
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: { source: "body", pattern: "%{IPV4:client_ip}" },
        },
      ]),
    ]);

    expect(after["body"]).toBe("no pairs here at all");
    expect(page).toContain(
      "A line a parser cannot read passes through unchanged.",
    );
  });

  it("applies a change within about a minute, the pipeline cache's lifetime", () => {
    const service: string = readSource(
      "App/FeatureSet/Telemetry/Services/LogPipelineService.ts",
    );

    expect(service).toContain(
      "const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds",
    );
    expect(page).toContain(
      "Changing a pipeline affects the logs that arrive afterwards, within about a minute",
    );
  });

  it("opens the processor form on the defaults the page gives", () => {
    const form: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/LogPipeline/ProcessorForm.tsx",
    );

    for (const declaration of [
      'const [grokSource, setGrokSource] = useState<string>("body")',
      'const [keyValueSource, setKeyValueSource] = useState<string>("body")',
      'useState<string>("level")',
      "const [preserveSource, setPreserveSource] = useState<boolean>(false)",
      "const [overrideOnConflict, setOverrideOnConflict] = useState<boolean>(true)",
      'useState<string>("category")',
    ]) {
      expect({ declaration, found: form.includes(declaration) }).toEqual({
        declaration,
        found: true,
      });
    }

    expect(form).toMatch(
      /keyValueOverrideOnConflict, setKeyValueOverrideOnConflict\] =\s*useState<boolean>\(false\)/,
    );
    expect(page).toContain(
      "Set **Source Attribute** to the attribute that holds the level (`level` by default)",
    );
    expect(page).toContain("Set **Target Attribute** (`category` by default)");
  });

  it("lists the grok capture types the parser takes", () => {
    const grok: string = readSource("Common/Utils/Grok/Grok.ts");

    expect(grok).toContain(
      "Supported types are: int, long, float, double, boolean, string.",
    );
    expect(page).toContain(
      "The types are `int`, `long`, `float`, `double`, `boolean` and `string`.",
    );
  });

  it("lists the severity values the log store holds", () => {
    const sentence: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("Severity values are ");
      });

    expect(sentence).toBeDefined();

    const listed: Array<string> = codeSpans(
      (sentence as string).split(" — ")[0] as string,
    );

    expect([...listed].sort()).toEqual([...Object.values(LogSeverity)].sort());
  });

  it("matches filter operators the way the page says", () => {
    const row: JSONObject = {
      body: "Connection TIMEOUT",
      severityText: "Error",
    };

    function matches(filterQuery: string): boolean {
      const tagged: JSONObject = attributesAfter(row, [
        pipeline(
          [
            {
              processorType: LogPipelineProcessorType.CategoryProcessor,
              configuration: {
                targetKey: "hit",
                categories: [{ name: "yes", filterQuery: "" }],
              },
            },
          ],
          filterQuery,
        ),
      ]);

      return tagged["hit"] === "yes";
    }

    // equals and does-not-equal are exact and case-sensitive.
    expect(matches("severityText = 'Error'")).toBe(true);
    expect(matches("severityText = 'ERROR'")).toBe(false);
    expect(matches("severityText != 'ERROR'")).toBe(true);
    // contains ignores case, and % is a wildcard.
    expect(matches("body LIKE 'timeout'")).toBe(true);
    expect(matches("body LIKE 'conn%out'")).toBe(true);
    // is one of: a list of exact values.
    expect(matches("severityText IN ('Warning', 'Error')")).toBe(true);
    expect(matches("severityText IN ('Warning', 'Fatal')")).toBe(false);

    expect(page).toContain(
      "so `severityText = 'Error'` matches and `'ERROR'` never will",
    );
  });
});
