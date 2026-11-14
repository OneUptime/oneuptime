import {
  PROMETHEUS_DEFAULT_METADATA_WINDOW_MS,
  PROMETHEUS_METADATA_LIMIT,
  PrometheusErrorAnswer,
  PrometheusQueryData,
  formatPrometheusQueryResult,
  labelNamesOf,
  labelValuesOf,
  listPrometheusSeries,
  parsePrometheusDuration,
  parsePrometheusTime,
  readMatchSelectors,
  readMetadataLimit,
  readMetadataWindow,
  runPrometheusInstantQuery,
  runPrometheusRangeQuery,
  toPrometheusErrorAnswer,
} from "../../../../Server/Utils/PromQL/PrometheusHttpApi";
import { JSONObject } from "../../../../Types/JSON";
import PromQLEngine from "../../../../Utils/PromQL/PromQLEngine";
import {
  PromQLResultType,
  PromQLSeries,
  PromQLSeriesSelection,
  PromQLSeriesSource,
} from "../../../../Utils/PromQL/PromQLEngineTypes";
import PromQLError, {
  PromQLErrorType,
} from "../../../../Utils/PromQL/PromQLError";
import {
  PromQLLabels,
  matchesPromQLMatchers,
} from "../../../../Utils/PromQL/PromQLLabels";
import { describe, expect, test } from "@jest/globals";

/*
 * The Prometheus HTTP API's formats (issue #6796), as Grafana and every
 * other Prometheus client read them: Unix seconds, values as strings,
 * `match[]` sent many times, and errors with Prometheus' errorType.
 */

const memorySource: (
  series: Array<{ labels: PromQLLabels; samples: Array<[number, number]> }>,
) => PromQLSeriesSource = (
  series: Array<{ labels: PromQLLabels; samples: Array<[number, number]> }>,
): PromQLSeriesSource => {
  return {
    select: async (
      selection: PromQLSeriesSelection,
    ): Promise<Array<PromQLSeries>> => {
      return series
        .filter((item: { labels: PromQLLabels }): boolean => {
          return matchesPromQLMatchers(item.labels, selection.matchers);
        })
        .map(
          (item: {
            labels: PromQLLabels;
            samples: Array<[number, number]>;
          }): PromQLSeries => {
            const inWindow: Array<[number, number]> = item.samples.filter(
              (sample: [number, number]): boolean => {
                return (
                  sample[0] * 1000 > selection.startTimeMs &&
                  sample[0] * 1000 <= selection.endTimeMs
                );
              },
            );

            return {
              labels: item.labels,
              timestampsMs: inWindow.map((sample: [number, number]): number => {
                return sample[0] * 1000;
              }),
              values: inWindow.map((sample: [number, number]): number => {
                return sample[1];
              }),
            };
          },
        )
        .filter((item: PromQLSeries): boolean => {
          return item.values.length > 0;
        });
    },
  };
};

const SOURCE: PromQLSeriesSource = memorySource([
  {
    labels: { __name__: "up", job: "api", instance: "a" },
    samples: [
      [60, 1],
      [120, 1],
      [180, 0],
    ],
  },
  {
    labels: { __name__: "up", job: "web", instance: "b" },
    samples: [
      [60, 1],
      [120, 1],
      [180, 1],
    ],
  },
]);

const errorOf: (run: () => unknown) => Promise<PromQLError> = async (
  run: () => unknown,
): Promise<PromQLError> => {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof PromQLError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected an error.");
};

describe("reading parameters", () => {
  test.each([
    ["1700000000", 1700000000000],
    ["1700000000.123", 1700000000123],
    ["2023-11-14T22:13:20Z", 1700000000000],
    ["2023-11-14T22:13:20.500Z", 1700000000500],
  ])("the time %s is %d", (text: string, expected: number) => {
    expect(parsePrometheusTime(text, "time", 0)).toBe(expected);
  });

  test("a missing time is the default", () => {
    expect(parsePrometheusTime(undefined, "time", 42)).toBe(42);
    expect(parsePrometheusTime("", "time", 42)).toBe(42);
  });

  test("a time that is not one says how to write one", async () => {
    expect(
      (
        await errorOf(() => {
          return parsePrometheusTime("yesterday", "start", 0);
        })
      ).message,
    ).toContain('The start parameter "yesterday" is not a time.');
  });

  test.each([
    ["15", 15000],
    ["0.5", 500],
    ["15s", 15000],
    ["1m30s", 90000],
  ])("the duration %s is %d milliseconds", (text: string, expected: number) => {
    expect(parsePrometheusDuration(text, "step")).toBe(expected);
  });

  test("a duration that is not one is refused", async () => {
    expect(
      (
        await errorOf(() => {
          return parsePrometheusDuration("soon", "step");
        })
      ).message,
    ).toContain('The step parameter "soon" is not a duration.');
  });

  test("match[] may come once, many times, or as a form's array", () => {
    expect(readMatchSelectors({ "match[]": "up" })).toHaveLength(1);
    expect(
      readMatchSelectors({ "match[]": ['up{job="api"}', "down"] }),
    ).toHaveLength(2);
    expect(readMatchSelectors({ match: ["up", "down"] })).toHaveLength(2);
    expect(readMatchSelectors({})).toHaveLength(0);
  });

  test("match[] takes selectors only", async () => {
    expect(
      (
        await errorOf(() => {
          return readMatchSelectors({ "match[]": "sum(up)" });
        })
      ).message,
    ).toContain("match[] takes series selectors");
  });

  test("a metadata window defaults to the last hour", () => {
    expect(readMetadataWindow({}, 7200000)).toEqual({
      startTimeMs: 7200000 - PROMETHEUS_DEFAULT_METADATA_WINDOW_MS,
      endTimeMs: 7200000,
    });
    expect(readMetadataWindow({ start: "60", end: "120" }, 0)).toEqual({
      startTimeMs: 60000,
      endTimeMs: 120000,
    });
  });

  test("a limit is a whole number, at most the metadata limit", async () => {
    expect(readMetadataLimit({})).toBe(PROMETHEUS_METADATA_LIMIT);
    expect(readMetadataLimit({ limit: "5" })).toBe(5);
    expect(readMetadataLimit({ limit: "0" })).toBe(PROMETHEUS_METADATA_LIMIT);
    expect(readMetadataLimit({ limit: "99999999" })).toBe(
      PROMETHEUS_METADATA_LIMIT,
    );
    expect(
      (
        await errorOf(() => {
          return readMetadataLimit({ limit: "-1" });
        })
      ).message,
    ).toContain("whole number");
  });
});

describe("writing results", () => {
  test("a vector: Unix seconds and string values", () => {
    expect(
      formatPrometheusQueryResult({
        resultType: PromQLResultType.Vector,
        samples: [
          {
            labels: { __name__: "up", job: "api" },
            timestampMs: 1700000000500,
            value: 1,
          },
        ],
      }),
    ).toEqual({
      resultType: "vector",
      result: [
        { metric: { __name__: "up", job: "api" }, value: [1700000000.5, "1"] },
      ],
    });
  });

  test("a matrix, with Prometheus' spelling of special values", () => {
    const data: PrometheusQueryData = formatPrometheusQueryResult({
      resultType: PromQLResultType.Matrix,
      series: [
        {
          labels: { job: "api" },
          points: [
            { timestampMs: 60000, value: NaN },
            { timestampMs: 120000, value: Infinity },
            { timestampMs: 180000, value: 1e-7 },
          ],
        },
      ],
    });

    expect(data).toEqual({
      resultType: "matrix",
      result: [
        {
          metric: { job: "api" },
          values: [
            [60, "NaN"],
            [120, "+Inf"],
            [180, "0.0000001"],
          ],
        },
      ],
    });
  });

  test("a scalar and a string", () => {
    expect(
      formatPrometheusQueryResult({
        resultType: PromQLResultType.Scalar,
        timestampMs: 1000,
        value: 2,
      }),
    ).toEqual({ resultType: "scalar", result: [1, "2"] });
    expect(
      formatPrometheusQueryResult({
        resultType: PromQLResultType.String,
        timestampMs: 1000,
        value: "hi",
      }),
    ).toEqual({ resultType: "string", result: [1, "hi"] });
  });
});

describe("errors", () => {
  test.each([
    [PromQLErrorType.BadData, 400],
    [PromQLErrorType.Execution, 422],
    [PromQLErrorType.Timeout, 503],
  ])("a %s error answers %d", (errorType: PromQLErrorType, status: number) => {
    const answer: PrometheusErrorAnswer | undefined = toPrometheusErrorAnswer(
      new PromQLError("Something specific went wrong.", errorType),
    );

    expect(answer).toEqual({
      statusCode: status,
      body: {
        status: "error",
        errorType,
        error: "Something specific went wrong.",
      },
    });
  });

  test("any other error is left to the server's own handling", () => {
    expect(toPrometheusErrorAnswer(new Error("boom"))).toBeUndefined();
  });

  // What the PromQL tab and Grafana are answered for a query.
  const answerFor: (
    run: () => unknown,
  ) => Promise<PrometheusErrorAnswer | undefined> = async (
    run: () => unknown,
  ): Promise<PrometheusErrorAnswer | undefined> => {
    return toPrometheusErrorAnswer(await errorOf(run));
  };

  const BACK_REFERENCE: string =
    "refers back to what an earlier group matched (\\1 or \\k<name>). Patterns are run in time that grows only in line with the text they read, which a back-reference cannot do. Write the pattern without it.";

  test("a matcher's pattern the linear-time matcher cannot run is a bad query, told in a sentence", async () => {
    const engine: PromQLEngine = new PromQLEngine(SOURCE);
    const expected: PrometheusErrorAnswer = {
      statusCode: 400,
      body: {
        status: "error",
        errorType: "bad_data",
        error: `The pattern "(a)\\1" for the label "job" ${BACK_REFERENCE}`,
      },
    };

    expect(
      await answerFor(() => {
        return runPrometheusInstantQuery({
          engine,
          params: { query: 'up{job=~"(a)\\\\1"}', time: "180" },
          nowMs: 0,
        });
      }),
    ).toEqual(expected);
    expect(
      await answerFor(() => {
        return readMatchSelectors({ "match[]": 'up{job=~"(a)\\\\1"}' });
      }),
    ).toEqual(expected);
  });

  test("label_replace's pattern the linear-time matcher cannot run is a query that cannot run, told in a sentence", async () => {
    const engine: PromQLEngine = new PromQLEngine(SOURCE);

    expect(
      await answerFor(() => {
        return runPrometheusInstantQuery({
          engine,
          params: {
            query: 'label_replace(up, "x", "$1", "job", "(a)\\\\1")',
            time: "180",
          },
          nowMs: 0,
        });
      }),
    ).toEqual({
      statusCode: 422,
      body: {
        status: "error",
        errorType: "execution",
        error: `The pattern "(a)\\1" in label_replace() ${BACK_REFERENCE}`,
      },
    });
  });
});

describe("running queries", () => {
  const engine: PromQLEngine = new PromQLEngine(SOURCE);

  test("an instant query", async () => {
    const answer: JSONObject = await runPrometheusInstantQuery({
      engine,
      params: { query: "sum(up)", time: "180" },
      nowMs: 0,
    });

    expect(answer).toEqual({
      status: "success",
      data: {
        resultType: "vector",
        result: [{ metric: {}, value: [180, "1"] }],
      },
    });
  });

  test("an instant query defaults to now", async () => {
    const answer: JSONObject = await runPrometheusInstantQuery({
      engine,
      params: { query: "time()" },
      nowMs: 120000,
    });

    expect(answer).toEqual({
      status: "success",
      data: { resultType: "scalar", result: [120, "120"] },
    });
  });

  test("a range query", async () => {
    const answer: JSONObject = await runPrometheusRangeQuery({
      engine,
      params: { query: 'up{job="api"}', start: "60", end: "180", step: "60s" },
    });

    expect(answer).toEqual({
      status: "success",
      data: {
        resultType: "matrix",
        result: [
          {
            metric: { __name__: "up", instance: "a", job: "api" },
            values: [
              [60, "1"],
              [120, "1"],
              [180, "0"],
            ],
          },
        ],
      },
    });
  });

  test.each([
    [{ start: "0", end: "1", step: "1" }, "The query parameter is required."],
    [{ query: "up", end: "1", step: "1" }, "The start parameter is required."],
    [{ query: "up", start: "0", step: "1" }, "The end parameter is required."],
    [{ query: "up", start: "0", end: "1" }, "The step parameter is required"],
  ])(
    "a range query without everything it needs is refused",
    async (params: Record<string, string>, message: string) => {
      const error: PromQLError = await errorOf(() => {
        return runPrometheusRangeQuery({ engine, params });
      });

      expect(error.message).toContain(message);
      expect(error.errorType).toBe(PromQLErrorType.BadData);
    },
  );
});

describe("series, label names and label values", () => {
  test("the series match[] selects, once each, sorted", async () => {
    const series: Array<PromQLLabels> = await listPrometheusSeries({
      source: SOURCE,
      selectors: readMatchSelectors({ "match[]": ["up", 'up{job="api"}'] }),
      startTimeMs: 0,
      endTimeMs: 200000,
      limit: 100,
    });

    expect(series).toEqual([
      { __name__: "up", instance: "a", job: "api" },
      { __name__: "up", instance: "b", job: "web" },
    ]);
    expect(labelNamesOf(series)).toEqual(["__name__", "instance", "job"]);
    expect(labelValuesOf(series, "job")).toEqual(["api", "web"]);
  });

  test("the series list stops at the limit", async () => {
    expect(
      await listPrometheusSeries({
        source: SOURCE,
        selectors: readMatchSelectors({ "match[]": "up" }),
        startTimeMs: 0,
        endTimeMs: 200000,
        limit: 1,
      }),
    ).toHaveLength(1);
  });
});
