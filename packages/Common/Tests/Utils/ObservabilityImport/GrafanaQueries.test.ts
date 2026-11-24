import { describe, expect, test } from "@jest/globals";
import {
  ConvertedQuery,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportQueryLanguage,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import {
  LOGQL_DOES_NOT_PARSE,
  LOGQL_GROUPING_LEFT_OUT,
  LOGQL_LINE_FILTER_LEFT_OUT,
  LOGQL_METRIC_NOT_COUNT,
  LOGQL_PIPELINE_LEFT_OUT,
  ConvertedLokiQuery,
  convertLokiCountQuery,
  convertLokiLogQuery,
  looksLikeLogQL,
} from "../../../Utils/ObservabilityImport/Grafana/GrafanaLoki";
import {
  PERCENTAGE_THRESHOLDS_NOT_KEPT,
  THRESHOLDS_NOT_KEPT,
  UNIT_NOT_KEPT,
  convertGrafanaLegacyThresholds,
  convertGrafanaThresholds,
  convertGrafanaUnit,
  scaleQuery,
} from "../../../Utils/ObservabilityImport/Grafana/GrafanaUnits";
import {
  GrafanaQueryVariables,
  QUERY_DOES_NOT_PARSE,
  QUERY_EMPTY,
  QUERY_IS_RANGE_VECTOR,
  QUERY_MIN_INTERVAL,
  QUERY_NAMES_UNKNOWN_VARIABLE,
  QUERY_USES_TIME_MACRO,
  QUERY_VARIABLE_FORMAT,
  convertGrafanaPromQL,
} from "../../../Utils/ObservabilityImport/PromQLImportQuery";

/*
 * The rules a Grafana panel's queries, units and thresholds are read by
 * (issue #7697), one at a time.
 */

const VARIABLES: GrafanaQueryVariables = {
  dashboardVariables: new Set<string>(["job", "instance", "window"]),
  sampleValues: new Map<string, string>([["window", "5m"]]),
  constants: new Map<string, string>([["cluster", "prod-eu"]]),
};

const promQL: (expr: string, minInterval?: string) => ConvertedQuery = (
  expr: string,
  minInterval?: string,
): ConvertedQuery => {
  return convertGrafanaPromQL({ expr, variables: VARIABLES, minInterval });
};

const texts: (notes: ReadonlyArray<ImportNote>) => Array<string> = (
  notes: ReadonlyArray<ImportNote>,
): Array<string> => {
  return notes.map((note: ImportNote): string => {
    return note.text;
  });
};

describe("a Grafana panel's PromQL", () => {
  test("each way Grafana names a variable is the dashboard's {{name}}; a constant is written in", () => {
    const converted: ConvertedQuery = promQL(
      'up{job="$job", instance=~"${instance}", cluster="$cluster"} + on() up{job="[[job]]"}',
    );

    expect(converted.status).toBe(ImportItemStatus.Exact);
    expect(converted.promQL).toBe(
      'up{job="{{job}}", instance=~"{{instance}}", cluster="prod-eu"} + on() up{job="{{job}}"}',
    );
  });

  test("an interval variable in a range is read with a value it takes", () => {
    const converted: ConvertedQuery = promQL("rate(x[$window])");

    expect(converted.status).toBe(ImportItemStatus.Exact);
    expect(converted.promQL).toBe("rate(x[{{window}}])");
  });

  test("Grafana's interval and range macros are kept, for the widget to fill as Grafana does", () => {
    expect(promQL("rate(x[$__rate_interval]) * $__range_s").promQL).toBe(
      "rate(x[$__rate_interval]) * $__range_s",
    );
  });

  test("a minimum interval on a query of $__interval is said: OneUptime picks its own step", () => {
    const converted: ConvertedQuery = promQL("rate(x[$__interval])", "1m");

    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(converted.notes).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: QUERY_MIN_INTERVAL,
        values: { interval: "1m" },
      },
    ]);
  });

  test("a format other than a plain value is said", () => {
    const converted: ConvertedQuery = promQL('up{job=~"${job:csv}"}');

    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(converted.notes).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: QUERY_VARIABLE_FORMAT,
        values: { name: "job", format: "csv" },
      },
    ]);
  });

  test("$1 in label_replace is no variable", () => {
    expect(
      promQL('label_replace(up, "host", "$1", "instance", "(.*):.*")').status,
    ).toBe(ImportItemStatus.Exact);
  });

  test("a query reading the dashboard's time or naming no variable it has is not converted, nor offered to AI", () => {
    for (const [expr, reason] of [
      ["x offset ${__from:date}", QUERY_USES_TIME_MACRO],
      ['up{shard="$shard"}', QUERY_NAMES_UNKNOWN_VARIABLE],
      ["", QUERY_EMPTY],
    ] as Array<[string, string]>) {
      const converted: ConvertedQuery = promQL(expr);

      expect(converted.status).toBe(ImportItemStatus.NotConverted);
      expect(texts(converted.notes)).toEqual([reason]);
      expect(converted.aiCandidate).toBeUndefined();
    }
  });

  test("a query OneUptime's PromQL does not read, or that returns a range, is offered to AI", () => {
    const unparsed: ConvertedQuery = promQL(
      'histogram_avg(rate(x{job="$job"}[5m]))',
    );

    expect(texts(unparsed.notes)).toEqual([QUERY_DOES_NOT_PARSE]);
    expect(unparsed.aiCandidate).toEqual({
      language: ImportQueryLanguage.PromQL,
      query: 'histogram_avg(rate(x{job="{{job}}"}[5m]))',
      variableNames: ["job", "instance", "window"],
    });

    const range: ConvertedQuery = promQL("x[5m]");

    expect(texts(range.notes)).toEqual([QUERY_IS_RANGE_VECTOR]);
    expect(range.aiCandidate).toBeDefined();
  });
});

describe("a Loki query as a log widget", () => {
  const keys: ReadonlyMap<string, string> = new Map<string, string>([
    ["app", "app"],
    ["level", "severity"],
  ]);

  test("its labels and first line filter, in the log search's words", () => {
    const converted: ConvertedLokiQuery = convertLokiLogQuery({
      expr: '{env="prod", namespace=~"shop|checkout", host!="db-1"} |= "timeout"',
      variableKeys: keys,
    });

    expect(converted.status).toBe(ImportItemStatus.Exact);
    expect(converted.filters).toEqual({
      bodyContains: "timeout",
      attributeFilterQuery:
        "@env:prod @namespace:(shop OR checkout) -@host:db-1",
      attributeFilters: { env: "prod" },
    });
  });

  test("a matcher on a variable's own attribute is left to the variable", () => {
    const converted: ConvertedLokiQuery = convertLokiLogQuery({
      expr: '{app="$app", env="prod"}',
      variableKeys: keys,
    });

    expect(converted.filters?.attributeFilterQuery).toBe("@env:prod");
  });

  test("a second line filter and a pipeline are left out, and said", () => {
    const converted: ConvertedLokiQuery = convertLokiLogQuery({
      expr: '{env="prod"} |= "error" != "debug" | json | level="error"',
      variableKeys: keys,
    });

    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(converted.filters?.bodyContains).toBe("error");
    expect(texts(converted.notes)).toEqual(
      expect.arrayContaining([
        LOGQL_LINE_FILTER_LEFT_OUT,
        LOGQL_PIPELINE_LEFT_OUT,
      ]),
    );
  });

  test("a count of logs over time is a Log Chart; its grouping is said", () => {
    const converted: ConvertedLokiQuery = convertLokiCountQuery({
      expr: 'sum by (level) (count_over_time({env="prod"} |= "error" [5m]))',
      variableKeys: keys,
    });

    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(converted.filters?.attributeFilters).toEqual({ env: "prod" });
    expect(converted.filters?.bodyContains).toBe("error");
    expect(texts(converted.notes)).toContain(LOGQL_GROUPING_LEFT_OUT);
  });

  test("a metric that is no count of logs, and what does not parse, are not converted", () => {
    expect(
      texts(
        convertLokiLogQuery({
          expr: 'rate({env="prod"}[5m])',
          variableKeys: keys,
        }).notes,
      ),
    ).toEqual([LOGQL_METRIC_NOT_COUNT]);
    expect(
      texts(
        convertLokiCountQuery({
          expr: 'quantile_over_time(0.9, {env="prod"} | unwrap latency [5m])',
          variableKeys: keys,
        }).notes,
      ),
    ).toEqual([LOGQL_METRIC_NOT_COUNT]);
    expect(
      texts(
        convertLokiLogQuery({ expr: '{env="prod"', variableKeys: keys }).notes,
      ),
    ).toEqual([LOGQL_DOES_NOT_PARSE]);
  });

  test("LogQL is told from PromQL", () => {
    expect(looksLikeLogQL('{app="checkout"} |= "error"')).toBe(true);
    expect(looksLikeLogQL('sum(count_over_time({app="x"}[5m]))')).toBe(true);
    expect(looksLikeLogQL('sum(rate(http_requests_total{app="x"}[5m]))')).toBe(
      false,
    );
  });
});

describe("a panel's unit", () => {
  test.each([
    ["percent", "%", 1],
    ["percentunit", "%", 100],
    ["bytes", "bytes", 1],
    ["kbytes", "bytes", 1024],
    ["decmbytes", "bytes", 1000000],
    ["ms", "ms", 1],
    ["m", "s", 60],
    ["reqps", "req/s", 1],
    ["suffix: jobs", "jobs", 1],
    ["short", "", 1],
  ])(
    "%s reads as %s, multiplied by %d",
    (id: string, unit: string, by: number) => {
      expect(convertGrafanaUnit(id)).toEqual({ unit, multiplyBy: by });
    },
  );

  test("a unit OneUptime has no like of is left off, and said", () => {
    expect(convertGrafanaUnit("lengthmm").note).toEqual({
      kind: ImportNoteKind.Approximation,
      text: UNIT_NOT_KEPT,
      values: { unit: "lengthmm" },
    });
  });

  test("a scaled query multiplies the whole of it", () => {
    expect(scaleQuery("a / b", 100)).toBe("100 * (a / b)");
    expect(scaleQuery("a / b", 1)).toBe("a / b");
  });
});

describe("a panel's thresholds", () => {
  const panel: (
    steps: Array<{ color: string; value: number | null }>,
    mode?: string,
  ) => Record<string, unknown> = (
    steps: Array<{ color: string; value: number | null }>,
    mode?: string,
  ): Record<string, unknown> => {
    return {
      fieldConfig: {
        defaults: {
          thresholds: { mode: mode || "absolute", steps },
        },
      },
    };
  };

  test("the first orange step is the warning, the first red the critical, in the widget's unit", () => {
    expect(
      convertGrafanaThresholds({
        panel: panel([
          { color: "green", value: null },
          { color: "orange", value: 0.7 },
          { color: "red", value: 0.9 },
        ]),
        multiplyBy: 100,
      }),
    ).toEqual({ warning: 70, critical: 90 });
  });

  test("thresholds that colour low values bad, or percentages of the range, are not set, and said", () => {
    expect(
      convertGrafanaThresholds({
        panel: panel([
          { color: "red", value: null },
          { color: "green", value: 10 },
        ]),
        multiplyBy: 1,
      }).note?.text,
    ).toBe(THRESHOLDS_NOT_KEPT);
    expect(
      convertGrafanaThresholds({
        panel: panel(
          [
            { color: "green", value: null },
            { color: "red", value: 80 },
          ],
          "percentage",
        ),
        multiplyBy: 1,
      }).note?.text,
    ).toBe(PERCENTAGE_THRESHOLDS_NOT_KEPT);
  });

  test("an old singlestat's thresholds and colours", () => {
    expect(
      convertGrafanaLegacyThresholds({
        panel: {
          thresholds: "80,90",
          colors: ["#299c46", "rgba(237, 129, 40, 0.89)", "#d44a3a"],
        },
        multiplyBy: 1,
      }),
    ).toEqual({ warning: 80, critical: 90 });
  });
});
