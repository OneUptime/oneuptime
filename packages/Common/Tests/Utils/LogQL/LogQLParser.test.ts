import {
  LogQLComparison,
  LogQLLineFilterOperator,
  LogQLLogQuery,
  LogQLMetricQuery,
  LogQLQuery,
  LogQLRangeOperation,
  LogQLUnwrapConversion,
  LogQLValueKind,
} from "../../../Utils/LogQL/LogQLAst";
import { parseLogQL } from "../../../Utils/LogQL/LogQLParser";
import {
  parseLogQLBytes,
  parseLogQLDuration,
} from "../../../Utils/LogQL/LogQLValues";
import {
  PromQLAggregateOperator,
  PromQLBinaryOperator,
  PromQLMatchType,
  PromQLNodeKind,
  PromQLVectorMatchCardinality,
} from "../../../Utils/PromQL/PromQLAst";
import PromQLError from "../../../Utils/PromQL/PromQLError";
import { describe, expect, test } from "@jest/globals";

/*
 * LogQL read as Loki reads it (issue #7700): the queries Grafana's Loki
 * dashboards and its Explore hold.
 */

const logQuery: (query: string) => LogQLLogQuery = (
  query: string,
): LogQLLogQuery => {
  const parsed: LogQLQuery = parseLogQL(query);

  if (parsed.kind !== "LogQuery") {
    throw new Error(`not a log query: ${query}`);
  }

  return parsed;
};

const metricQuery: (query: string) => LogQLMetricQuery = (
  query: string,
): LogQLMetricQuery => {
  const parsed: LogQLQuery = parseLogQL(query);

  if (parsed.kind !== "MetricQuery") {
    throw new Error(`not a metric query: ${query}`);
  }

  return parsed;
};

describe("a log query", () => {
  test("a stream selector with every matcher", () => {
    expect(
      logQuery('{app="api", env!="dev", pod=~"api-.+", region!~"eu.*"}')
        .selector.matchers,
    ).toEqual([
      { name: "app", type: PromQLMatchType.Equal, value: "api" },
      { name: "env", type: PromQLMatchType.NotEqual, value: "dev" },
      { name: "pod", type: PromQLMatchType.RegexMatch, value: "api-.+" },
      { name: "region", type: PromQLMatchType.RegexNoMatch, value: "eu.*" },
    ]);
  });

  test("line filters, with or, raw strings and escapes", () => {
    expect(
      logQuery(
        '{app="api"} |= "error" or "fatal" != `health` |~ "time(out|d out)" !~ "\\\\d{3} OK"',
      ).selector.stages,
    ).toEqual([
      {
        kind: "LineFilter",
        operator: LogQLLineFilterOperator.Contains,
        values: ["error", "fatal"],
      },
      {
        kind: "LineFilter",
        operator: LogQLLineFilterOperator.NotContains,
        values: ["health"],
      },
      {
        kind: "LineFilter",
        operator: LogQLLineFilterOperator.Matches,
        values: ["time(out|d out)"],
      },
      {
        kind: "LineFilter",
        operator: LogQLLineFilterOperator.NotMatches,
        values: ["\\d{3} OK"],
      },
    ]);
  });

  test("parsers, label filters, line_format, drop, keep and decolorize", () => {
    expect(
      logQuery(
        '{app="api"} | json | status >= 500 and method="GET" | duration > 1.5s, size <= 20MB | line_format "{{.method}} {{ .status }}" | drop __error__, __error_details__ | keep app, status | decolorize | logfmt',
      ).selector.stages,
    ).toEqual([
      { kind: "Parser", parser: "json" },
      {
        kind: "LabelFilter",
        expression: {
          kind: "And",
          left: {
            kind: "Compare",
            label: "status",
            comparison: LogQLComparison.GreaterOrEqual,
            value: 500,
            valueKind: LogQLValueKind.Number,
          },
          right: {
            kind: "Match",
            matcher: {
              name: "method",
              type: PromQLMatchType.Equal,
              value: "GET",
            },
          },
        },
      },
      {
        kind: "LabelFilter",
        expression: {
          kind: "And",
          left: {
            kind: "Compare",
            label: "duration",
            comparison: LogQLComparison.Greater,
            value: 1.5,
            valueKind: LogQLValueKind.Duration,
          },
          right: {
            kind: "Compare",
            label: "size",
            comparison: LogQLComparison.LessOrEqual,
            value: 20000000,
            valueKind: LogQLValueKind.Bytes,
          },
        },
      },
      {
        kind: "LineFormat",
        parts: [{ label: "method" }, { text: " " }, { label: "status" }],
      },
      { kind: "Drop", labels: ["__error__", "__error_details__"] },
      { kind: "Keep", labels: ["app", "status"] },
      { kind: "Decolorize" },
      { kind: "Parser", parser: "logfmt" },
    ]);
  });

  test("or binds looser than and, and parentheses group", () => {
    const stages: LogQLLogQuery["selector"]["stages"] = logQuery(
      '{app="api"} | level="error" or level="warn" and code=500 | (a="1" or b="2") and c="3"',
    ).selector.stages;

    expect(stages[0]).toMatchObject({
      kind: "LabelFilter",
      expression: { kind: "Or", right: { kind: "And" } },
    });
    expect(stages[1]).toMatchObject({
      kind: "LabelFilter",
      expression: { kind: "And", left: { kind: "Or" } },
    });
  });

  test("a numeric equality is ==, = or != against a number", () => {
    expect(
      logQuery('{app="api"} | status = 200 | code != 5').selector.stages,
    ).toEqual([
      {
        kind: "LabelFilter",
        expression: {
          kind: "Compare",
          label: "status",
          comparison: LogQLComparison.Equal,
          value: 200,
          valueKind: LogQLValueKind.Number,
        },
      },
      {
        kind: "LabelFilter",
        expression: {
          kind: "Compare",
          label: "code",
          comparison: LogQLComparison.NotEqual,
          value: 5,
          valueKind: LogQLValueKind.Number,
        },
      },
    ]);
  });
});

describe("a metric query", () => {
  test("numbers and vector() alone are one, as Grafana's health check sends", () => {
    expect(metricQuery("vector(1)+vector(1)").ranges).toEqual([]);
    expect(metricQuery("5").ranges).toEqual([]);
  });

  test("a selector narrowed by one matcher may hold others that match empty", () => {
    expect(parseLogQL('{app="api", env=~".*", team!="x"}').kind).toBe(
      "LogQuery",
    );
    expect(parseLogQL('{app=~"api|web"}').kind).toBe("LogQuery");
  });

  test("a range aggregation is a series of its own in the PromQL half", () => {
    const query: LogQLMetricQuery = metricQuery(
      'sum by (level) (count_over_time({app="api"} |= "error" [5m]))',
    );

    expect(query.ranges).toHaveLength(1);
    expect(query.ranges[0]).toMatchObject({
      seriesName: "__logql_range_0",
      operation: LogQLRangeOperation.CountOverTime,
      rangeMs: 300000,
      offsetMs: 0,
      unwrap: undefined,
    });
    expect(query.expression).toMatchObject({
      kind: PromQLNodeKind.Aggregate,
      operator: PromQLAggregateOperator.Sum,
      grouping: ["level"],
      without: false,
      expression: {
        kind: PromQLNodeKind.VectorSelector,
        name: "__logql_range_0",
      },
    });
  });

  test("the range may follow the selector, before the pipeline", () => {
    const query: LogQLMetricQuery = metricQuery(
      'rate({app="api"}[1m] |= "error")',
    );

    expect(query.ranges[0]!.selector.stages).toEqual([
      {
        kind: "LineFilter",
        operator: LogQLLineFilterOperator.Contains,
        values: ["error"],
      },
    ]);
    expect(query.ranges[0]!.rangeMs).toBe(60000);
  });

  test("unwrap, its conversion, its filters, grouping and offset", () => {
    const query: LogQLMetricQuery = metricQuery(
      'quantile_over_time(0.99, {app="api"} | logfmt | unwrap duration(took) | __error__="" [5m] offset 1h) by (route)',
    );

    expect(query.ranges[0]).toMatchObject({
      operation: LogQLRangeOperation.QuantileOverTime,
      parameter: 0.99,
      rangeMs: 300000,
      offsetMs: 3600000,
      unwrap: {
        label: "took",
        conversion: LogQLUnwrapConversion.Duration,
        stages: [
          {
            kind: "LabelFilter",
            expression: {
              kind: "Match",
              matcher: {
                name: "__error__",
                type: PromQLMatchType.Equal,
                value: "",
              },
            },
          },
        ],
      },
      grouping: { labels: ["route"], without: false },
    });
  });

  test("binary operators between metric queries and numbers, with matching", () => {
    const query: LogQLMetricQuery = metricQuery(
      'sum by (app) (count_over_time({env="prod"} |= "error" [5m])) / on (app) group_left sum by (app) (count_over_time({env="prod"}[5m])) * 100 > bool 5',
    );

    expect(query.ranges).toHaveLength(2);
    expect(query.expression).toMatchObject({
      kind: PromQLNodeKind.Binary,
      operator: PromQLBinaryOperator.Gtr,
      returnBool: true,
      matching: undefined,
      lhs: {
        kind: PromQLNodeKind.Binary,
        operator: PromQLBinaryOperator.Mul,
        lhs: {
          kind: PromQLNodeKind.Binary,
          operator: PromQLBinaryOperator.Div,
          matching: {
            cardinality: PromQLVectorMatchCardinality.ManyToOne,
            on: true,
            matchingLabels: ["app"],
          },
        },
      },
    });
  });

  test("topk, a grouping after the parentheses, sort, vector and label_replace", () => {
    expect(
      metricQuery('topk(5, sum(rate({app="api"}[1m])) by (pod))').expression,
    ).toMatchObject({
      kind: PromQLNodeKind.Aggregate,
      operator: PromQLAggregateOperator.Topk,
      parameter: { kind: PromQLNodeKind.NumberLiteral, value: 5 },
      expression: {
        kind: PromQLNodeKind.Aggregate,
        grouping: ["pod"],
      },
    });
    expect(
      metricQuery('sort_desc(count_over_time({app="api"}[1m]))').expression,
    ).toMatchObject({ kind: PromQLNodeKind.Call, functionName: "sort_desc" });
    expect(
      metricQuery('sum(count_over_time({app="api"}[1m])) or vector(0)')
        .expression,
    ).toMatchObject({
      kind: PromQLNodeKind.Binary,
      operator: PromQLBinaryOperator.Or,
      rhs: { kind: PromQLNodeKind.Call, functionName: "vector" },
    });
    expect(
      metricQuery(
        'label_replace(count_over_time({app="api"}[1m]), "dst", "$1", "app", "(.*)")',
      ).expression,
    ).toMatchObject({
      kind: PromQLNodeKind.Call,
      functionName: "label_replace",
    });
  });
});

describe("what is refused, and how it is said", () => {
  test.each([
    ["", /the query is empty/],
    ["{}", /at least one regexp or equality matcher/],
    ['{app="api"}[5m]', /belongs inside a range aggregation/],
    ['count_over_time({app="api"})', /expected a range such as \[5m\]/],
    ['sum({app="api"})', /needs a range aggregation around it/],
    ['sum_over_time({app="api"}[5m])', /add \| unwrap <label>/],
    ['count_over_time({app="api"} | unwrap x [5m])', /leave out \| unwrap x/],
    ['count_over_time({app="api"}[5m]) by (job)', /needs an unwrapped label/],
    ['{app="api"} | label_format a="b"', /label_format is not supported yet/],
    ['{app="api"} | pattern "<ip>"', /pattern is not supported yet/],
    ['{app="api"} | json a="b"', /json with expressions is not supported yet/],
    [
      '{app="api"} |= ip("10.0.0.1")',
      /ip\(\) line filters are not supported yet/,
    ],
    [
      '{app="api"} | line_format "{{ .a | upper }}"',
      /reads \{\{\.label\}\} only/,
    ],
    ['{app="api"} |~ "("', /is not a valid regular expression/],
    ['{app="api" "x"}', /expected "," or "}"/],
    ['{app="api"} |= "unclosed', /no closing quote/],
    ["1 > 0", /needs the bool modifier/],
    ['up{job="x"}', /a metric query is built of range aggregations/],
    // Loki's rule: one matcher at least that a log without its label fails.
    ['{app=~".*"}', /at least one regexp or equality matcher/],
    ['{app!="api"}', /at least one regexp or equality matcher/],
    ['{app=""}', /at least one regexp or equality matcher/],
  ])("%j", (query: string, message: RegExp) => {
    let thrown: unknown;

    try {
      parseLogQL(query);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PromQLError);
    expect((thrown as PromQLError).message).toMatch(message);
  });

  test("an error says where, as Loki says it", () => {
    expect(() => {
      return parseLogQL('{app="api"} | json\n| status >');
    }).toThrow(
      /^parse error at line 2, col 11: syntax error: unexpected end of query, /,
    );
  });
});

describe("a label's duration and size", () => {
  test.each([
    ["1.5s", 1.5],
    ["250ms", 0.25],
    ["1h30m", 5400],
    ["100us", 0.0001],
    ["2µs", 0.000002],
    ["-2m", -120],
    ["0", 0],
  ])("the duration %s is %d seconds", (text: string, seconds: number) => {
    expect(parseLogQLDuration(text)).toBeCloseTo(seconds, 12);
  });

  test.each(["", "5", "1d", "s", "1.5"])(
    "%j is no duration",
    (text: string) => {
      expect(parseLogQLDuration(text)).toBeUndefined();
    },
  );

  test.each([
    ["20MB", 20000000],
    ["1.5KiB", 1536],
    ["512", 512],
    ["4 kb", 4000],
    ["1GiB", 1073741824],
    ["3b", 3],
  ])("the size %s is %d bytes", (text: string, bytes: number) => {
    expect(parseLogQLBytes(text)).toBe(bytes);
  });

  test.each(["", "MB", "20XB", "1,5MB"])("%j is no size", (text: string) => {
    expect(parseLogQLBytes(text)).toBeUndefined();
  });
});
