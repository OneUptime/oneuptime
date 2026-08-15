import {
  CrossSignalQueryParams,
  TelemetryCrossSignalScope,
  toLogsExplorerQueryParams,
  toMetricsExplorerQueryParams,
  toTracesExplorerQueryParams,
} from "../../../Utils/Telemetry/CrossSignalScope";
import MetricExplorerUrl, {
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import TimeRange from "../../../Types/Time/TimeRange";
import { describe, expect, test } from "@jest/globals";

/*
 * These tests pin the serializers to the URL grammars the explorers parse:
 *
 *  - Logs:    App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer.tsx
 *             (readInitialUrlState — `filters` is Array<[facetKey, values[]]>,
 *             Custom range needs `range` + `start` + `end`).
 *  - Traces:  App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer.tsx
 *             (readInitialUrlState + parseSearch — `search` DSL and
 *             `filters` as Array<[facetKey, value]> pairs).
 *  - Metrics: Common/Utils/Metrics/MetricExplorerUrl.ts (`metricQueries`
 *             JSON + absolute `startTime`/`endTime`).
 */

const START: Date = new Date("2026-08-14T10:00:00.000Z");
const END: Date = new Date("2026-08-14T11:00:00.000Z");

function fullScope(): TelemetryCrossSignalScope {
  return {
    serviceIds: ["651a000000000000000000aa", "651a000000000000000000bb"],
    attributes: {
      "http.method": "GET",
      "resource.host.name": "prod-01",
    },
    traceIds: ["trace-1", "trace-2"],
    spanIds: ["span-1"],
    severityTexts: ["error", "Warning"],
    startTime: START,
    endTime: END,
  };
}

/*
 * Minimal replica of the traces explorer's search parsing — the tokenizer
 * regex, quote merging, `@attr:value` / `field:value` branches and the `~`
 * contains marker are copied from TracesViewer.tsx parseSearch (~L515-624)
 * so a grammar drift over there fails these fixtures instead of silently
 * breaking deep links.
 */
interface ParsedTraceSearch {
  fieldFilters: Record<string, Array<string>>;
  attributes: Record<string, string>;
  attributeSearches: Record<string, string>;
  freeText: Array<string>;
}

const TRACE_KNOWN_FIELD_KEYS: Record<string, string> = {
  service: "primaryEntityId",
  trace: "traceId",
  span: "spanId",
};

function parseTraceSearchReplica(raw: string): ParsedTraceSearch {
  const result: ParsedTraceSearch = {
    fieldFilters: {},
    attributes: {},
    attributeSearches: {},
    freeText: [],
  };

  const rawTokens: Array<string> =
    raw.match(/@?\S+:~?"[^"]*"|@\S+:[^\s]+|\S+/g) || [];

  const stripQuotes: (s: string) => string = (s: string): string => {
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1);
    }
    return s;
  };

  for (const token of rawTokens) {
    const attrMatch: RegExpMatchArray | null = token.match(/^@([^:]+):(.*)$/);

    if (attrMatch) {
      const attrValue: string = stripQuotes(attrMatch[2]!);

      if (attrValue.startsWith("~")) {
        result.attributeSearches[attrMatch[1]!] = stripQuotes(
          attrValue.substring(1),
        );
      } else if (attrValue.length > 0) {
        result.attributes[attrMatch[1]!] = attrValue;
      }
      continue;
    }

    const fieldMatch: RegExpMatchArray | null = token.match(/^([^:]+):(.*)$/);

    if (fieldMatch) {
      const fieldName: string = fieldMatch[1]!.toLowerCase();
      const fieldValue: string = stripQuotes(fieldMatch[2]!);
      const backendField: string | undefined =
        TRACE_KNOWN_FIELD_KEYS[fieldName];

      if (backendField && fieldValue.length > 0) {
        if (!result.fieldFilters[backendField]) {
          result.fieldFilters[backendField] = [];
        }
        result.fieldFilters[backendField]!.push(fieldValue);
        continue;
      }
    }

    result.freeText.push(token);
  }

  return result;
}

/*
 * TracesViewer.readInitialUrlState decodes `search` a SECOND time
 * (decodeURIComponent on the already-decoded param, falling back to the
 * raw value when that throws). Serialized search strings must survive
 * that round trip unchanged — which is why values containing "%" are
 * routed to the JSON `filters` param instead.
 */
function tracesViewerSearchRoundTrip(search: string): string {
  const query: string = new URLSearchParams({ search }).toString();
  const decodedOnce: string = new URLSearchParams(query).get("search") || "";

  try {
    return decodeURIComponent(decodedOnce);
  } catch {
    return decodedOnce;
  }
}

describe("toLogsExplorerQueryParams", () => {
  describe("Full scope", () => {
    test("emits the filters tuples the logs explorer parses, in stable order", () => {
      const result: CrossSignalQueryParams =
        toLogsExplorerQueryParams(fullScope());

      // Shape: Array<[facetKey, values[]]> — LogsViewer.readInitialUrlState.
      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["severityText", ["Error", "Warning"]],
        [
          "primaryEntityId",
          ["651a000000000000000000aa", "651a000000000000000000bb"],
        ],
        ["traceId", ["trace-1", "trace-2"]],
        ["spanId", ["span-1"]],
        ["attributes.http.method", ["GET"]],
        ["attributes.resource.host.name", ["prod-01"]],
      ]);

      expect(result.dropped).toEqual([]);
    });

    test("emits the Custom time-range convention (range + start + end)", () => {
      const result: CrossSignalQueryParams =
        toLogsExplorerQueryParams(fullScope());

      expect(result.params["range"]).toBe(TimeRange.CUSTOM);
      expect(result.params["range"]).toBe("Custom");
      expect(result.params["start"]).toBe("2026-08-14T10:00:00.000Z");
      expect(result.params["end"]).toBe("2026-08-14T11:00:00.000Z");
    });

    test("every scope field is expressible in the logs grammar", () => {
      expect(toLogsExplorerQueryParams(fullScope()).dropped).toEqual([]);
    });
  });

  describe("Empty and absent scope fields", () => {
    test("empty scope emits no params and drops nothing", () => {
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({});

      expect(result.params).toEqual({});
      expect(result.dropped).toEqual([]);
    });

    test("empty arrays and empty attribute maps emit no filters param", () => {
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        serviceIds: [],
        traceIds: [],
        spanIds: [],
        severityTexts: [],
        attributes: {},
      });

      expect(result.params["filters"]).toBeUndefined();
      expect(result.dropped).toEqual([]);
    });

    test("blank values and blank attribute entries are ignored, not emitted", () => {
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        traceIds: ["", "trace-1", ""],
        attributes: { "": "orphan-value", "orphan.key": "" },
      });

      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["traceId", ["trace-1"]],
      ]);
      expect(result.dropped).toEqual([]);
    });

    test("duplicate values are deduplicated, order preserved", () => {
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        traceIds: ["b", "a", "b"],
      });

      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["traceId", ["b", "a"]],
      ]);
    });

    test("time-only scope emits range params and no filters", () => {
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        startTime: START,
        endTime: END,
      });

      expect(result.params["filters"]).toBeUndefined();
      expect(result.params["range"]).toBe("Custom");
    });
  });

  describe("Severity canonicalization", () => {
    test("normalizes to the database's title-case values like the logs search DSL does", () => {
      /*
       * Same table as Common/Types/Log/LogQueryToFilter.ts — the URL
       * filters path applies NO normalization, so params must carry the
       * exact stored casing.
       */
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        severityTexts: ["error", "WARN", "info", "Fatal", "custom-level"],
      });

      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        [
          "severityText",
          ["Error", "Warning", "Information", "Fatal", "custom-level"],
        ],
      ]);
    });

    test("values that only differ in case collapse after normalization", () => {
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        severityTexts: ["error", "Error", "ERROR"],
      });

      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["severityText", ["Error"]],
      ]);
    });
  });

  describe("Escaping via JSON", () => {
    test("quotes, colons, spaces, unicode and @ survive the filters JSON round trip", () => {
      const trickyValue: string = ' spaced "quoted" @at:colon 100% ünïcødé ';
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        attributes: { "deploy.note": trickyValue },
      });

      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["attributes.deploy.note", [trickyValue]],
      ]);
    });

    test("attribute keys with dots keep the single attributes. prefix", () => {
      /*
       * LogsViewer strips only the first "attributes." prefix
       * (substring("attributes.".length)), so dotted keys survive.
       */
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        attributes: { "resource.k8s.cluster.name": "prod" },
      });

      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["attributes.resource.k8s.cluster.name", ["prod"]],
      ]);
    });
  });

  describe("Time window edge cases", () => {
    test("a lone startTime is dropped instead of emitting a half window", () => {
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        startTime: START,
      });

      expect(result.params).toEqual({});
      expect(result.dropped).toEqual(["startTime"]);
    });

    test("a lone endTime is dropped instead of emitting a half window", () => {
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        endTime: END,
      });

      expect(result.params).toEqual({});
      expect(result.dropped).toEqual(["endTime"]);
    });

    test("invalid Date objects are treated as absent", () => {
      const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
        startTime: new Date("not a date"),
        endTime: END,
      });

      expect(result.params).toEqual({});
      expect(result.dropped).toEqual(["endTime"]);
    });
  });
});

describe("toTracesExplorerQueryParams", () => {
  describe("Full scope", () => {
    test("splits scope between search tokens and filter chips", () => {
      const result: CrossSignalQueryParams =
        toTracesExplorerQueryParams(fullScope());

      expect(result.params["search"]).toBe(
        "@http.method:GET @resource.host.name:prod-01 trace:trace-1 trace:trace-2 span:span-1",
      );

      // Shape: Array<[facetKey, value]> pairs — TracesViewer.readInitialUrlState.
      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["primaryEntityId", "651a000000000000000000aa"],
        ["primaryEntityId", "651a000000000000000000bb"],
      ]);

      expect(result.params["range"]).toBe("Custom");
      expect(result.params["start"]).toBe("2026-08-14T10:00:00.000Z");
      expect(result.params["end"]).toBe("2026-08-14T11:00:00.000Z");
    });

    test("severityTexts are reported dropped — spans have no severity", () => {
      expect(toTracesExplorerQueryParams(fullScope()).dropped).toEqual([
        "severityTexts",
      ]);
    });

    test("the emitted search string parses back to the same scope under the traces DSL", () => {
      const result: CrossSignalQueryParams =
        toTracesExplorerQueryParams(fullScope());

      const parsed: ParsedTraceSearch = parseTraceSearchReplica(
        result.params["search"] as string,
      );

      expect(parsed.attributes).toEqual({
        "http.method": "GET",
        "resource.host.name": "prod-01",
      });
      expect(parsed.fieldFilters).toEqual({
        traceId: ["trace-1", "trace-2"],
        spanId: ["span-1"],
      });
      expect(parsed.attributeSearches).toEqual({});
      expect(parsed.freeText).toEqual([]);
    });
  });

  describe("Empty and absent scope fields", () => {
    test("empty scope emits no params and drops nothing", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({});

      expect(result.params).toEqual({});
      expect(result.dropped).toEqual([]);
    });

    test("empty severityTexts array is not reported dropped", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        severityTexts: [],
      });

      expect(result.dropped).toEqual([]);
    });

    test("blank-only severityTexts are not reported dropped", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        severityTexts: [""],
      });

      expect(result.dropped).toEqual([]);
    });
  });

  describe("Search token escaping", () => {
    test("values with spaces are double-quoted (the tokenizer's quoted branch)", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        attributes: { "db.statement": "SELECT wp_options" },
      });

      expect(result.params["search"]).toBe('@db.statement:"SELECT wp_options"');

      const parsed: ParsedTraceSearch = parseTraceSearchReplica(
        result.params["search"] as string,
      );

      expect(parsed.attributes).toEqual({
        "db.statement": "SELECT wp_options",
      });
    });

    test("values with colons ride unquoted tokens intact", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        attributes: { "url.full": "https://oneuptime.com:443/status" },
      });

      expect(result.params["search"]).toBe(
        "@url.full:https://oneuptime.com:443/status",
      );

      const parsed: ParsedTraceSearch = parseTraceSearchReplica(
        result.params["search"] as string,
      );

      expect(parsed.attributes).toEqual({
        "url.full": "https://oneuptime.com:443/status",
      });
    });

    test("unicode and @ inside values are token-safe", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        attributes: { "user.email": "ünïcødé@example.com" },
      });

      expect(result.params["search"]).toBe("@user.email:ünïcødé@example.com");

      const parsed: ParsedTraceSearch = parseTraceSearchReplica(
        result.params["search"] as string,
      );

      expect(parsed.attributes).toEqual({
        "user.email": "ünïcødé@example.com",
      });
    });

    test("values containing a double quote fall back to a filters chip (the DSL has no escape)", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        attributes: { "db.statement": 'SELECT "id" FROM users' },
      });

      expect(result.params["search"]).toBeUndefined();
      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["attributes.db.statement", 'SELECT "id" FROM users'],
      ]);
      // A fallback is a carried filter, not a dropped one.
      expect(result.dropped).toEqual([]);
    });

    test("values starting with ~ fall back to a chip (quoting cannot protect the contains marker)", () => {
      /*
       * parseSearch strips quotes BEFORE the startsWith("~") check
       * (TracesViewer.tsx), so `@home:"~/dir"` would flip the exact match
       * into a contains match on "/dir".
       */
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        attributes: { "file.path": "~/logs/app.log" },
      });

      expect(result.params["search"]).toBeUndefined();
      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["attributes.file.path", "~/logs/app.log"],
      ]);
    });

    test("values containing % fall back to a chip (the viewer double-decodes search)", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        attributes: { "cache.hit.ratio": "99%" },
      });

      expect(result.params["search"]).toBeUndefined();
      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["attributes.cache.hit.ratio", "99%"],
      ]);
    });

    test("attribute keys with colon, whitespace, quote, leading @ or leading - use chips", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        attributes: {
          "weird:key": "v1",
          "spaced key": "v2",
          '"quoted"': "v3",
          "@at-key": "v4",
          "-dash-key": "v5",
        },
      });

      expect(result.params["search"]).toBeUndefined();
      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["attributes.weird:key", "v1"],
        ["attributes.spaced key", "v2"],
        ['attributes."quoted"', "v3"],
        ["attributes.@at-key", "v4"],
        ["attributes.-dash-key", "v5"],
      ]);
    });

    test("trace ids with spaces are quoted; ids with quotes fall back to chips", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        traceIds: ["spaced trace", 'quoted"trace'],
        spanIds: ["span-ok"],
      });

      expect(result.params["search"]).toBe('trace:"spaced trace" span:span-ok');
      expect(JSON.parse(result.params["filters"] as string)).toEqual([
        ["traceId", 'quoted"trace'],
      ]);

      const parsed: ParsedTraceSearch = parseTraceSearchReplica(
        result.params["search"] as string,
      );
      expect(parsed.fieldFilters).toEqual({
        traceId: ["spaced trace"],
        spanId: ["span-ok"],
      });
    });

    test("emitted search strings survive the viewer's double-decode quirk unchanged", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        attributes: {
          "http.method": "GET",
          "db.statement": "SELECT wp_options",
          "user.email": "ünïcødé@example.com",
        },
        traceIds: ["trace-1"],
      });

      const search: string = result.params["search"] as string;

      expect(tracesViewerSearchRoundTrip(search)).toBe(search);
    });
  });

  describe("Time window edge cases", () => {
    test("a lone time endpoint is reported dropped alongside severity", () => {
      const result: CrossSignalQueryParams = toTracesExplorerQueryParams({
        severityTexts: ["Error"],
        startTime: START,
      });

      expect(result.params).toEqual({});
      expect(result.dropped).toEqual(["severityTexts", "startTime"]);
    });
  });
});

describe("toMetricsExplorerQueryParams", () => {
  describe("Full scope", () => {
    test("emits metricQueries JSON plus the absolute startTime/endTime pair", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams(
        fullScope(),
        "container.cpu.time",
      );

      expect(JSON.parse(result.params["metricQueries"] as string)).toEqual([
        {
          metricName: "container.cpu.time",
          attributes: {
            "http.method": "GET",
            "resource.host.name": "prod-01",
          },
        },
      ]);

      expect(result.params["startTime"]).toBe("2026-08-14T10:00:00.000Z");
      expect(result.params["endTime"]).toBe("2026-08-14T11:00:00.000Z");
      /*
       * A pinned Custom window is represented by the absolute params
       * alone — no `range` token (see MetricExplorerUrl).
       */
      expect(result.params["range"]).toBeUndefined();
    });

    test("the emitted metricQueries param round-trips through the explorer's own parser", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams(
        fullScope(),
        "container.cpu.time",
      );

      const parsed: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(
          result.params["metricQueries"] as string,
        );

      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.metricName).toBe("container.cpu.time");
      expect(parsed[0]!.attributes).toEqual({
        "http.method": "GET",
        "resource.host.name": "prod-01",
      });
    });

    test("reports the signal-specific fields the metric grammar cannot express", () => {
      expect(
        toMetricsExplorerQueryParams(fullScope(), "container.cpu.time").dropped,
      ).toEqual(["serviceIds", "traceIds", "spanIds", "severityTexts"]);
    });
  });

  describe("Partial scopes", () => {
    test("attributes without a metric name still form a meaningful query", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams({
        attributes: { "k8s.pod.name": "web-1" },
      });

      expect(JSON.parse(result.params["metricQueries"] as string)).toEqual([
        { metricName: "", attributes: { "k8s.pod.name": "web-1" } },
      ]);
    });

    test("a metric name alone forms a meaningful query", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams(
        {},
        "system.disk.io",
      );

      expect(JSON.parse(result.params["metricQueries"] as string)).toEqual([
        { metricName: "system.disk.io", attributes: {} },
      ]);
    });

    test("no name and no attributes emits no metricQueries param at all", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams({
        startTime: START,
        endTime: END,
      });

      expect(result.params["metricQueries"]).toBeUndefined();
      expect(result.params["startTime"]).toBe("2026-08-14T10:00:00.000Z");
    });

    test("empty scope emits no params and drops nothing", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams({});

      expect(result.params).toEqual({});
      expect(result.dropped).toEqual([]);
    });
  });

  describe("Escaping and malformed input", () => {
    test("attribute values with quotes, colons and unicode survive the JSON round trip", () => {
      const trickyValue: string = 'a "b" : 100% ünïcødé';
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams({
        attributes: { "deploy.note": trickyValue },
      });

      const parsed: Array<SerializedMetricQuery> =
        MetricExplorerUrl.parseMetricQueriesParam(
          result.params["metricQueries"] as string,
        );

      expect(parsed[0]!.attributes).toEqual({ "deploy.note": trickyValue });
    });

    test("blank attribute entries are ignored", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams({
        attributes: { "": "v", k: "" },
      });

      expect(result.params["metricQueries"]).toBeUndefined();
    });

    test("a lone time endpoint is dropped", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams({
        endTime: END,
      });

      expect(result.params).toEqual({});
      expect(result.dropped).toEqual(["endTime"]);
    });
  });

  describe("Dropped-field reporting is value-sensitive", () => {
    test("unsupported fields with only blank values are not reported", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams({
        serviceIds: [""],
        traceIds: [],
        severityTexts: [""],
      });

      expect(result.dropped).toEqual([]);
    });

    test("unsupported fields with real values are reported", () => {
      const result: CrossSignalQueryParams = toMetricsExplorerQueryParams({
        spanIds: ["span-1"],
      });

      expect(result.dropped).toEqual(["spanIds"]);
    });
  });
});
