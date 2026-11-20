import { describe, expect, test } from "@jest/globals";
import { SearchValueOperator } from "../../../Types/Telemetry/TelemetrySearchQuery";
import {
  SLO_METRIC_COUNTER_AS_HISTOGRAM_REASON,
  SLO_METRIC_GAUGE_REASON,
  SLO_METRIC_HISTOGRAM_AS_COUNTER_REASON,
  SLO_METRIC_UNCOUNTABLE_REASON,
  getSloMetricQueryError,
  getSloMetricQueryFingerprintParts,
  getSloMetricQueryProblem,
  getSloMetricUncountedReason,
  normalizeSloMetricQueryConfig,
  ParsedSloMetricSearch,
  parseSloMetricSearch,
  SLO_METRIC_FILTER_MAX_LENGTH,
  SLO_METRIC_FILTER_MAX_TERMS,
  SLO_METRIC_NAME_MAX_LENGTH,
  SLO_METRIC_QUERY_ERRORS,
  SLO_METRIC_QUERY_NOT_AN_OBJECT_ERROR,
  SloMetricKind,
  SloMetricQueryConfig,
  SloMetricQueryPart,
  SloMetricQueryProblem,
} from "../../../Utils/Slo/SloMetricSli";

/*
 * A Metric SLO's configuration (#8445): a counter whose good events match
 * a condition, or a histogram whose good observations are at or under a
 * value, either narrowed by a filter. These pin how a configuration is
 * read, what makes one unusable and which part the form shows that on,
 * and what the counting's fingerprint is made of.
 */

const COUNTER: SloMetricQueryConfig = {
  metricName: "http_requests_total",
  kind: SloMetricKind.Counter,
  goodFilter: "@http.response.status_code:<500",
};

const HISTOGRAM: SloMetricQueryConfig = {
  metricName: "http.server.request.duration",
  kind: SloMetricKind.Histogram,
  goodAtOrUnder: 0.3,
};

function problemOf(raw: unknown): SloMetricQueryProblem | null {
  return getSloMetricQueryProblem(normalizeSloMetricQueryConfig(raw));
}

describe("normalizeSloMetricQueryConfig", () => {
  test.each([undefined, null, "", 42, "http_requests_total", [COUNTER]])(
    "%p is no configuration",
    (raw: unknown) => {
      expect(normalizeSloMetricQueryConfig(raw)).toBeNull();
    },
  );

  test("trims what is typed, and keeps a counter's good condition", () => {
    expect(
      normalizeSloMetricQueryConfig({
        metricName: "  http_requests_total ",
        kind: "Counter",
        goodFilter: " @http.response.status_code:<500 ",
        filter: "  @http.route:/checkout*  ",
      }),
    ).toEqual({
      metricName: "http_requests_total",
      kind: SloMetricKind.Counter,
      goodFilter: "@http.response.status_code:<500",
      filter: "@http.route:/checkout*",
    });
  });

  test("reads a histogram's value as a number, from a string too", () => {
    expect(
      normalizeSloMetricQueryConfig({ ...HISTOGRAM, goodAtOrUnder: "0.25" }),
    ).toEqual({ ...HISTOGRAM, goodAtOrUnder: 0.25 });
  });

  test("keeps only what its kind reads: a histogram has no good condition, a counter no value", () => {
    expect(
      normalizeSloMetricQueryConfig({
        ...HISTOGRAM,
        goodFilter: "@http.response.status_code:<500",
      }),
    ).toEqual(HISTOGRAM);
    expect(
      normalizeSloMetricQueryConfig({ ...COUNTER, goodAtOrUnder: 0.3 }),
    ).toEqual(COUNTER);
  });

  test("an empty filter is no filter", () => {
    expect(
      normalizeSloMetricQueryConfig({ ...COUNTER, filter: "   " }),
    ).toEqual(COUNTER);
  });

  test("an unknown kind is kept unknown, for the problem to name", () => {
    expect(
      normalizeSloMetricQueryConfig({ metricName: "m", kind: "Gauge" })?.kind,
    ).toBeUndefined();
  });
});

describe("parseSloMetricSearch", () => {
  test("no search has no terms and no problem", () => {
    expect(parseSloMetricSearch("")).toEqual({ terms: [], problem: null });
    expect(parseSloMetricSearch(undefined)).toEqual({
      terms: [],
      problem: null,
    });
  });

  test("an attribute with a comparison, as the explorer reads it", () => {
    const parsed: ParsedSloMetricSearch = parseSloMetricSearch(
      "@http.response.status_code:<500",
    );

    expect(parsed.problem).toBeNull();
    expect(parsed.terms).toHaveLength(1);
    expect(parsed.terms[0]).toMatchObject({
      key: "http.response.status_code",
      predicate: { operator: SearchValueOperator.LessThan, value: "500" },
    });
  });

  test("a bare key:value is an attribute too, and a leading - leaves it out", () => {
    const parsed: ParsedSloMetricSearch = parseSloMetricSearch(
      "code:200 -@http.route:/health",
    );

    expect(parsed.problem).toBeNull();
    expect(
      parsed.terms.map((term: { key: string }): string => {
        return term.key;
      }),
    ).toEqual(["code", "http.route"]);
    expect(parsed.terms[1]!.predicate.operator).toBe(
      SearchValueOperator.NotEquals,
    );
  });

  test("free text is refused, naming it", () => {
    expect(parseSloMetricSearch("@k:v checkout").problem).toEqual({
      template: SLO_METRIC_QUERY_ERRORS.freeText,
      values: { text: "checkout" },
    });
  });

  test(`at most ${SLO_METRIC_FILTER_MAX_LENGTH} characters and ${SLO_METRIC_FILTER_MAX_TERMS} terms`, () => {
    expect(
      parseSloMetricSearch(`@k:${"a".repeat(SLO_METRIC_FILTER_MAX_LENGTH)}`)
        .problem?.template,
    ).toBe(SLO_METRIC_QUERY_ERRORS.filterTooLong);

    const terms: string = Array.from(
      { length: SLO_METRIC_FILTER_MAX_TERMS + 1 },
      (_: unknown, index: number): string => {
        return `@k${index}:v`;
      },
    ).join(" ");

    expect(parseSloMetricSearch(terms).problem).toEqual({
      template: SLO_METRIC_QUERY_ERRORS.filterTooManyTerms,
      values: { max: SLO_METRIC_FILTER_MAX_TERMS },
    });
  });
});

describe("getSloMetricQueryProblem", () => {
  test("a counter with a good condition, and a histogram with a value, count", () => {
    expect(getSloMetricQueryProblem(COUNTER)).toBeNull();
    expect(getSloMetricQueryProblem(HISTOGRAM)).toBeNull();
    expect(
      getSloMetricQueryProblem({
        ...COUNTER,
        filter: "@http.route:/checkout*",
      }),
    ).toBeNull();
  });

  test.each<[string, unknown, SloMetricQueryPart, string]>([
    [
      "nothing at all",
      null,
      SloMetricQueryPart.MetricName,
      SLO_METRIC_QUERY_ERRORS.noMetricName,
    ],
    [
      "no metric",
      { kind: "Counter", goodFilter: "@k:v" },
      SloMetricQueryPart.MetricName,
      SLO_METRIC_QUERY_ERRORS.noMetricName,
    ],
    [
      "one of OneUptime's own metrics",
      { ...COUNTER, metricName: "oneuptime.slo.sli.percent" },
      SloMetricQueryPart.MetricName,
      SLO_METRIC_QUERY_ERRORS.reservedMetricName,
    ],
    [
      "no kind",
      { metricName: "m" },
      SloMetricQueryPart.Kind,
      SLO_METRIC_QUERY_ERRORS.noKind,
    ],
    [
      "a counter with no good condition",
      { metricName: "m", kind: "Counter" },
      SloMetricQueryPart.GoodFilter,
      SLO_METRIC_QUERY_ERRORS.noGoodFilter,
    ],
    [
      "a counter whose good condition is free text",
      { ...COUNTER, goodFilter: "ok" },
      SloMetricQueryPart.GoodFilter,
      SLO_METRIC_QUERY_ERRORS.freeText,
    ],
    [
      "a histogram with no value",
      { metricName: "m", kind: "Histogram" },
      SloMetricQueryPart.GoodAtOrUnder,
      SLO_METRIC_QUERY_ERRORS.noGoodAtOrUnder,
    ],
    [
      "a histogram at or under 0",
      { ...HISTOGRAM, goodAtOrUnder: 0 },
      SloMetricQueryPart.GoodAtOrUnder,
      SLO_METRIC_QUERY_ERRORS.noGoodAtOrUnder,
    ],
    [
      "a histogram at or under a negative value",
      { ...HISTOGRAM, goodAtOrUnder: -1 },
      SloMetricQueryPart.GoodAtOrUnder,
      SLO_METRIC_QUERY_ERRORS.noGoodAtOrUnder,
    ],
    [
      "a filter of free text",
      { ...HISTOGRAM, filter: "checkout" },
      SloMetricQueryPart.Filter,
      SLO_METRIC_QUERY_ERRORS.freeText,
    ],
  ])(
    "%s is a problem with its %s",
    (
      _label: string,
      raw: unknown,
      part: SloMetricQueryPart,
      template: string,
    ) => {
      expect(problemOf(raw)).toMatchObject({ part: part, template: template });
    },
  );

  test(`a metric name of more than ${SLO_METRIC_NAME_MAX_LENGTH} characters is refused`, () => {
    expect(
      problemOf({
        ...COUNTER,
        metricName: "m".repeat(SLO_METRIC_NAME_MAX_LENGTH + 1),
      }),
    ).toEqual({
      part: SloMetricQueryPart.MetricName,
      template: SLO_METRIC_QUERY_ERRORS.metricNameTooLong,
      values: { max: SLO_METRIC_NAME_MAX_LENGTH },
    });
  });
});

describe("getSloMetricQueryError", () => {
  test("a configuration OneUptime can count with has none", () => {
    expect(getSloMetricQueryError(COUNTER)).toBeNull();
    expect(getSloMetricQueryError(HISTOGRAM)).toBeNull();
  });

  test("says what is wrong in English, its figures filled in", () => {
    expect(getSloMetricQueryError({ metricName: "m", kind: "Counter" })).toBe(
      "Say which of the counter's events are good, such as @http.response.status_code:<500.",
    );
    expect(
      getSloMetricQueryError({
        ...COUNTER,
        filter: `@k:${"a".repeat(SLO_METRIC_FILTER_MAX_LENGTH)}`,
      }),
    ).toBe("A metric search can be at most 500 characters long.");
  });

  test.each(["http_requests_total", 42, true, [COUNTER]])(
    "%p is not a configuration, and the API says what one looks like",
    (raw: unknown) => {
      expect(getSloMetricQueryError(raw)).toBe(
        SLO_METRIC_QUERY_NOT_AN_OBJECT_ERROR,
      );
    },
  );
});

describe("getSloMetricQueryFingerprintParts", () => {
  test("reads only what the kind counts, in a fixed order", () => {
    expect(getSloMetricQueryFingerprintParts(COUNTER)).toEqual({
      metricName: "http_requests_total",
      kind: SloMetricKind.Counter,
      goodFilter: "@http.response.status_code:<500",
      goodAtOrUnder: null,
      filter: null,
    });
    expect(JSON.stringify(getSloMetricQueryFingerprintParts(HISTOGRAM))).toBe(
      '{"metricName":"http.server.request.duration","kind":"Histogram","goodFilter":null,"goodAtOrUnder":0.3,"filter":null}',
    );
  });
});

/*
 * #10027: why a Metric SLO counted nothing, when its metric's newest point
 * says so - the sentence its feed is told.
 */
describe("getSloMetricUncountedReason", () => {
  test("a gauge, which every cloud metric is, has no events to count", () => {
    for (const kind of [SloMetricKind.Counter, SloMetricKind.Histogram]) {
      expect(
        getSloMetricUncountedReason({ metricPointType: "Gauge", kind }),
      ).toBe(SLO_METRIC_GAUGE_REASON);
    }

    expect(SLO_METRIC_GAUGE_REASON).toContain("every cloud metric");
    expect(SLO_METRIC_GAUGE_REASON).toContain("monitor's uptime");
  });

  test("a summary or an exponential histogram is neither a counter nor a histogram", () => {
    for (const metricPointType of ["Summary", "ExponentialHistogram"]) {
      expect(
        getSloMetricUncountedReason({
          metricPointType,
          kind: SloMetricKind.Counter,
        }),
      ).toBe(SLO_METRIC_UNCOUNTABLE_REASON);
    }
  });

  test("a histogram counted as a counter, or a counter as a histogram, says which to choose", () => {
    expect(
      getSloMetricUncountedReason({
        metricPointType: "Histogram",
        kind: SloMetricKind.Counter,
      }),
    ).toBe(SLO_METRIC_HISTOGRAM_AS_COUNTER_REASON);
    expect(
      getSloMetricUncountedReason({
        metricPointType: "Sum",
        kind: SloMetricKind.Histogram,
      }),
    ).toBe(SLO_METRIC_COUNTER_AS_HISTOGRAM_REASON);
    expect(SLO_METRIC_HISTOGRAM_AS_COUNTER_REASON).toContain(
      '"A histogram, by a value"',
    );
    expect(SLO_METRIC_COUNTER_AS_HISTOGRAM_REASON).toContain(
      '"A counter, by a condition"',
    );
  });

  test("a counter or a histogram counted as itself, or no point at all, says nothing new", () => {
    expect(
      getSloMetricUncountedReason({
        metricPointType: "Sum",
        kind: SloMetricKind.Counter,
      }),
    ).toBeNull();
    expect(
      getSloMetricUncountedReason({
        metricPointType: "Histogram",
        kind: SloMetricKind.Histogram,
      }),
    ).toBeNull();

    for (const metricPointType of [null, undefined, ""]) {
      expect(
        getSloMetricUncountedReason({
          metricPointType,
          kind: SloMetricKind.Counter,
        }),
      ).toBeNull();
    }
  });
});
