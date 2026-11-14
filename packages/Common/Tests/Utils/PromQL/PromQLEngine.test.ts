import PromQLEngine from "../../../Utils/PromQL/PromQLEngine";
import {
  PromQLEngineOptions,
  PromQLMatrixResultSeries,
  PromQLQueryResult,
  PromQLResultType,
  PromQLSeries,
  PromQLSeriesSelection,
  PromQLSeriesSource,
  PromQLVectorResultSample,
} from "../../../Utils/PromQL/PromQLEngineTypes";
import PromQLError, {
  PromQLErrorType,
} from "../../../Utils/PromQL/PromQLError";
import {
  PromQLLabels,
  formatPromQLLabels,
  formatPromQLValue,
  matchesPromQLMatchers,
} from "../../../Utils/PromQL/PromQLLabels";
import * as PatternCache from "../../../Utils/LinearRegExp/PatternCache";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The PromQL engine (issue #6796), against series held in memory.
 *
 * Every expected value here is worked out by hand from Prometheus'
 * algorithms (promql/engine.go and functions.go), so a change that makes
 * OneUptime answer differently from Prometheus fails a test.
 */

interface TestSeries {
  labels: PromQLLabels;
  // [seconds, value]
  samples: Array<[number, number]>;
}

class MemorySource implements PromQLSeriesSource {
  public readonly selections: Array<PromQLSeriesSelection> = [];

  public constructor(private readonly data: Array<TestSeries>) {}

  public async select(
    selection: PromQLSeriesSelection,
  ): Promise<Array<PromQLSeries>> {
    this.selections.push(selection);
    const result: Array<PromQLSeries> = [];

    for (const item of this.data) {
      if (!matchesPromQLMatchers(item.labels, selection.matchers)) {
        continue;
      }

      const inWindow: Array<[number, number]> = item.samples.filter(
        (sample: [number, number]): boolean => {
          const timeMs: number = sample[0] * 1000;
          return (
            timeMs > selection.startTimeMs && timeMs <= selection.endTimeMs
          );
        },
      );

      if (inWindow.length === 0) {
        continue;
      }

      result.push({
        labels: item.labels,
        timestampsMs: inWindow.map((sample: [number, number]): number => {
          return sample[0] * 1000;
        }),
        values: inWindow.map((sample: [number, number]): number => {
          return sample[1];
        }),
      });
    }

    return result;
  }
}

// Samples every `stepSeconds` from `startSeconds`, one per value.
const every: (
  startSeconds: number,
  stepSeconds: number,
  values: Array<number>,
) => Array<[number, number]> = (
  startSeconds: number,
  stepSeconds: number,
  values: Array<number>,
): Array<[number, number]> => {
  return values.map((value: number, index: number): [number, number] => {
    return [startSeconds + index * stepSeconds, value];
  });
};

const range: (from: number, to: number, step: number) => Array<number> = (
  from: number,
  to: number,
  step: number,
): Array<number> => {
  const values: Array<number> = [];

  for (let value: number = from; value <= to; value += step) {
    values.push(value);
  }

  return values;
};

const DATA: Array<TestSeries> = [
  // Counters, scraped every minute from 60s to 600s.
  {
    labels: {
      __name__: "http_requests_total",
      job: "api",
      instance: "a",
      code: "200",
    },
    samples: every(60, 60, range(10, 100, 10)),
  },
  {
    labels: {
      __name__: "http_requests_total",
      job: "api",
      instance: "b",
      code: "200",
    },
    samples: every(60, 60, range(5, 50, 5)),
  },
  {
    labels: {
      __name__: "http_requests_total",
      job: "api",
      instance: "a",
      code: "500",
    },
    samples: every(60, 60, range(1, 10, 1)),
  },
  {
    labels: {
      __name__: "http_requests_total",
      job: "web",
      instance: "c",
      code: "200",
    },
    samples: every(60, 60, range(100, 1000, 100)),
  },
  // A counter that restarted at 540s.
  {
    labels: { __name__: "restarts_total", job: "api" },
    samples: every(360, 60, [10, 20, 30, 5, 15]),
  },
  // A gauge.
  {
    labels: { __name__: "temperature", room: "a" },
    samples: every(360, 60, [5, 3, 8, 6, 10]),
  },
  // A gauge that rises 1/6 per second.
  {
    labels: { __name__: "linear" },
    samples: every(60, 60, range(10, 100, 10)),
  },
  // Exactly three points for double exponential smoothing.
  {
    labels: { __name__: "smoothing" },
    samples: every(480, 60, [1, 2, 4]),
  },
  // One team per instance, for group_left.
  {
    labels: { __name__: "team_info", instance: "a", team: "alpha" },
    samples: every(60, 60, Array(10).fill(1)),
  },
  {
    labels: { __name__: "team_info", instance: "b", team: "beta" },
    samples: every(60, 60, Array(10).fill(1)),
  },
  {
    labels: { __name__: "team_info", instance: "c", team: "gamma" },
    samples: every(60, 60, Array(10).fill(1)),
  },
  // A classic histogram's cumulative buckets.
  {
    labels: {
      __name__: "request_duration_seconds_bucket",
      job: "api",
      le: "0.1",
    },
    samples: [[600, 10]],
  },
  {
    labels: {
      __name__: "request_duration_seconds_bucket",
      job: "api",
      le: "0.5",
    },
    samples: [[600, 20]],
  },
  {
    labels: {
      __name__: "request_duration_seconds_bucket",
      job: "api",
      le: "1",
    },
    samples: [[600, 30]],
  },
  {
    labels: {
      __name__: "request_duration_seconds_bucket",
      job: "api",
      le: "+Inf",
    },
    samples: [[600, 40]],
  },
  // Build info, for count_values.
  {
    labels: { __name__: "build_info", version: "1.0", instance: "x" },
    samples: [[600, 1]],
  },
  {
    labels: { __name__: "build_info", version: "1.1", instance: "y" },
    samples: [[600, 1]],
  },
  {
    labels: { __name__: "build_info", version: "1.0", instance: "z" },
    samples: [[600, 1]],
  },
  // Two metrics whose labels are the same once the name is gone.
  {
    labels: { __name__: "dup_a", x: "1" },
    samples: every(360, 60, [1, 2, 3, 4, 5]),
  },
  {
    labels: { __name__: "dup_b", x: "1" },
    samples: every(360, 60, [1, 2, 3, 4, 5]),
  },
  {
    labels: { __name__: "up", instance: "host-1:9100", job: "node" },
    samples: [[600, 1]],
  },
];

const engine: (options?: PromQLEngineOptions) => {
  engine: PromQLEngine;
  source: MemorySource;
} = (
  options?: PromQLEngineOptions,
): { engine: PromQLEngine; source: MemorySource } => {
  const source: MemorySource = new MemorySource(DATA);
  return { engine: new PromQLEngine(source, options), source };
};

const instant: (
  query: string,
  timeSeconds?: number,
) => Promise<PromQLQueryResult> = async (
  query: string,
  timeSeconds: number = 600,
): Promise<PromQLQueryResult> => {
  return engine().engine.instantQuery(query, timeSeconds * 1000);
};

// An instant vector as { 'labels': value }.
const vector: (
  query: string,
  timeSeconds?: number,
) => Promise<Record<string, number>> = async (
  query: string,
  timeSeconds: number = 600,
): Promise<Record<string, number>> => {
  const result: PromQLQueryResult = await instant(query, timeSeconds);

  if (result.resultType !== PromQLResultType.Vector) {
    throw new Error(`Expected a vector, got ${result.resultType}.`);
  }

  const values: Record<string, number> = {};

  for (const sample of result.samples) {
    values[formatPromQLLabels(sample.labels)] = sample.value;
  }

  return values;
};

const single: (query: string, timeSeconds?: number) => Promise<number> = async (
  query: string,
  timeSeconds: number = 600,
): Promise<number> => {
  const values: Record<string, number> = await vector(query, timeSeconds);
  const entries: Array<number> = Object.values(values);

  if (entries.length !== 1) {
    throw new Error(
      `Expected one sample from ${query}, got ${JSON.stringify(values)}.`,
    );
  }

  return entries[0]!;
};

const scalar: (query: string, timeSeconds?: number) => Promise<number> = async (
  query: string,
  timeSeconds: number = 600,
): Promise<number> => {
  const result: PromQLQueryResult = await instant(query, timeSeconds);

  if (result.resultType !== PromQLResultType.Scalar) {
    throw new Error(`Expected a scalar, got ${result.resultType}.`);
  }

  return result.value;
};

const queryError: (
  run: () => Promise<unknown>,
) => Promise<PromQLError> = async (
  run: () => Promise<unknown>,
): Promise<PromQLError> => {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof PromQLError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the query to fail.");
};

describe("instant selectors", () => {
  test("select every matching series' latest sample", async () => {
    expect(await vector('http_requests_total{job="api"}')).toEqual({
      'http_requests_total{code="200", instance="a", job="api"}': 100,
      'http_requests_total{code="200", instance="b", job="api"}': 50,
      'http_requests_total{code="500", instance="a", job="api"}': 10,
    });
  });

  test("look back five minutes, the start of the window left out", async () => {
    expect(await single('http_requests_total{instance="c"}', 899)).toBe(1000);
    expect(await vector('http_requests_total{instance="c"}', 900)).toEqual({});
  });

  test("read every matcher type", async () => {
    expect(
      Object.keys(
        await vector(
          'http_requests_total{job=~"a.+", code!="500", instance!~"b"}',
        ),
      ),
    ).toEqual(['http_requests_total{code="200", instance="a", job="api"}']);
  });

  test("a label named like an Object member is read from the series' own labels", async () => {
    // up has no label named constructor or toString: each reads "".
    const up: string = 'up{instance="host-1:9100", job="node"}';

    expect(Object.keys(await vector('up{constructor=""}'))).toEqual([up]);
    expect(Object.keys(await vector('up{constructor=~""}'))).toEqual([up]);
    expect(Object.keys(await vector('up{constructor!~".+"}'))).toEqual([up]);
    expect(Object.keys(await vector('up{toString!=""}'))).toEqual([]);
    expect(
      Object.keys(
        await vector('label_replace(up, "x", "[$1]", "constructor", "(.*)")'),
      ),
    ).toEqual(['up{instance="host-1:9100", job="node", x="[]"}']);
  });

  test("an offset moves the selector back in time", async () => {
    expect(await single('http_requests_total{instance="c"} offset 2m')).toBe(
      800,
    );
  });

  test("@ pins the selector to a time", async () => {
    expect(await single('http_requests_total{instance="c"} @ 300')).toBe(500);
    expect(
      await single('http_requests_total{instance="c"} @ 300 offset 1m'),
    ).toBe(400);
  });

  test("a range selector in an instant query returns the raw samples", async () => {
    const result: PromQLQueryResult = await instant(
      'http_requests_total{instance="c"}[2m]',
    );

    expect(result.resultType).toBe(PromQLResultType.Matrix);
    const series: Array<PromQLMatrixResultSeries> =
      result.resultType === PromQLResultType.Matrix ? result.series : [];

    // The range (480s, 600s] holds the samples at 540s and 600s.
    expect(series[0]!.points).toEqual([
      { timestampMs: 540000, value: 900 },
      { timestampMs: 600000, value: 1000 },
    ]);
    expect(series[0]!.labels["__name__"]).toBe("http_requests_total");
  });
});

describe("counter functions", () => {
  test("rate() extrapolates to the range's edges, as Prometheus does", async () => {
    // (300s, 600s] holds 60..100 at 360..600: 40 over 240s, extrapolated by 60s.
    expect(
      await single('rate(http_requests_total{instance="a", code="200"}[5m])'),
    ).toBeCloseTo(1 / 6, 10);
  });

  test("increase() is the extrapolated increase", async () => {
    expect(
      await single(
        'increase(http_requests_total{instance="a", code="200"}[5m])',
      ),
    ).toBeCloseTo(50, 10);
  });

  test("rate() with an offset reads an earlier range", async () => {
    expect(
      await single(
        'rate(http_requests_total{instance="a", code="200"}[5m] offset 2m)',
      ),
    ).toBeCloseTo(1 / 6, 10);
  });

  test("a counter reset is added back", async () => {
    // 10, 20, 30, 5, 15: 5 + the 30 lost at the reset, extrapolated by 1.25.
    expect(await single("increase(restarts_total[5m])")).toBeCloseTo(43.75, 10);
    expect(await single("rate(restarts_total[5m])")).toBeCloseTo(
      43.75 / 300,
      10,
    );
    expect(await single("resets(restarts_total[5m])")).toBe(1);
  });

  test("irate() reads the last two samples", async () => {
    expect(
      await single('irate(http_requests_total{instance="a", code="200"}[5m])'),
    ).toBeCloseTo(1 / 6, 10);
    // 5 then 15 is no reset: (15 - 5) / 60s.
    expect(await single("irate(restarts_total[5m])")).toBeCloseTo(10 / 60, 10);
  });

  test("rate() needs two samples in the range", async () => {
    expect(
      await vector('rate(http_requests_total{instance="c"}[30s])'),
    ).toEqual({});
  });

  test("functions drop the metric name", async () => {
    expect(
      Object.keys(await vector('rate(http_requests_total{instance="c"}[5m])')),
    ).toEqual(['{code="200", instance="c", job="web"}']);
  });
});

describe("gauge functions over time", () => {
  test.each([
    ["delta(temperature[5m])", 6.25],
    ["idelta(temperature[5m])", 4],
    ["avg_over_time(temperature[5m])", 6.4],
    ["min_over_time(temperature[5m])", 3],
    ["max_over_time(temperature[5m])", 10],
    ["sum_over_time(temperature[5m])", 32],
    ["count_over_time(temperature[5m])", 5],
    ["last_over_time(temperature[5m])", 10],
    ["present_over_time(temperature[5m])", 1],
    ["stdvar_over_time(temperature[5m])", 5.84],
    ["stddev_over_time(temperature[5m])", Math.sqrt(5.84)],
    ["quantile_over_time(0.5, temperature[5m])", 6],
    ["quantile_over_time(0.9, temperature[5m])", 9.2],
    ["mad_over_time(temperature[5m])", 2],
    ["changes(temperature[5m])", 4],
    ["deriv(linear[5m])", 1 / 6],
    ["predict_linear(linear[5m], 60)", 110],
    ["holt_winters(smoothing[5m], 0.5, 0.5)", 3.5],
    ["double_exponential_smoothing(smoothing[5m], 0.5, 0.5)", 3.5],
  ])("%s is %d", async (query: string, expected: number) => {
    expect(await single(query)).toBeCloseTo(expected, 10);
  });

  test("last_over_time() keeps the metric name; the others drop it", async () => {
    expect(
      Object.keys(await vector("last_over_time(temperature[5m])")),
    ).toEqual(['temperature{room="a"}']);
    expect(Object.keys(await vector("max_over_time(temperature[5m])"))).toEqual(
      ['{room="a"}'],
    );
  });

  test("a smoothing factor outside (0, 1) is refused", async () => {
    const error: PromQLError = await queryError(() => {
      return instant("holt_winters(smoothing[5m], 1.5, 0.5)");
    });

    expect(error.message).toContain("must be between 0 and 1");
    expect(error.errorType).toBe(PromQLErrorType.Execution);
  });
});

describe("aggregations", () => {
  test("sum, by and without", async () => {
    expect(await single("sum(http_requests_total)")).toBe(1160);
    expect(await vector("sum by (job) (http_requests_total)")).toEqual({
      '{job="api"}': 160,
      '{job="web"}': 1000,
    });
    expect(
      await vector("sum without (instance, code) (http_requests_total)"),
    ).toEqual({ '{job="api"}': 160, '{job="web"}': 1000 });
  });

  test.each([
    ['count(http_requests_total{job="api"})', 3],
    ['avg(http_requests_total{job="api"})', 160 / 3],
    ['min(http_requests_total{job="api"})', 10],
    ['max(http_requests_total{job="api"})', 100],
    ['group(http_requests_total{job="api"})', 1],
    ["quantile(0.5, http_requests_total)", 75],
    [
      'stdvar(http_requests_total{job="api"})',
      ((100 - 160 / 3) ** 2 + (50 - 160 / 3) ** 2 + (10 - 160 / 3) ** 2) / 3,
    ],
  ])("%s is %d", async (query: string, expected: number) => {
    expect(await single(query)).toBeCloseTo(expected, 10);
  });

  test("topk and bottomk keep the series' own labels", async () => {
    expect(await vector("topk(2, http_requests_total)")).toEqual({
      'http_requests_total{code="200", instance="c", job="web"}': 1000,
      'http_requests_total{code="200", instance="a", job="api"}': 100,
    });
    expect(await vector("bottomk by (job) (1, http_requests_total)")).toEqual({
      'http_requests_total{code="500", instance="a", job="api"}': 10,
      'http_requests_total{code="200", instance="c", job="web"}': 1000,
    });
    expect(await vector("topk(0, http_requests_total)")).toEqual({});
  });

  test("count_values writes each value into a label", async () => {
    expect(await vector('count_values("value", build_info)')).toEqual({
      '{value="1"}': 3,
    });
    expect(await vector("count by (version) (build_info)")).toEqual({
      '{version="1.0"}': 2,
      '{version="1.1"}': 1,
    });
  });
});

describe("binary operators", () => {
  test("arithmetic with a number drops the metric name", async () => {
    expect(
      await vector('http_requests_total{instance="a", code="200"} * 2'),
    ).toEqual({ '{code="200", instance="a", job="api"}': 200 });
    expect(
      await vector('2 * http_requests_total{instance="a", code="200"}'),
    ).toEqual({ '{code="200", instance="a", job="api"}': 200 });
  });

  test("a comparison filters and keeps the vector's value", async () => {
    expect(await vector("http_requests_total > 60")).toEqual({
      'http_requests_total{code="200", instance="a", job="api"}': 100,
      'http_requests_total{code="200", instance="c", job="web"}': 1000,
    });
    expect(await vector("60 < http_requests_total")).toEqual({
      'http_requests_total{code="200", instance="a", job="api"}': 100,
      'http_requests_total{code="200", instance="c", job="web"}': 1000,
    });
  });

  test("bool answers 1 or 0 and drops the metric name", async () => {
    expect(await vector('http_requests_total{job="api"} > bool 60')).toEqual({
      '{code="200", instance="a", job="api"}': 1,
      '{code="200", instance="b", job="api"}': 0,
      '{code="500", instance="a", job="api"}': 0,
    });
    expect(await scalar("2 > bool 1")).toBe(1);
  });

  test("numbers: precedence, ^ from the right, %, and the unary minus", async () => {
    expect(await scalar("1 + 2 * 3")).toBe(7);
    expect(await scalar("2 ^ 3 ^ 2")).toBe(512);
    expect(await scalar("-2 ^ 2")).toBe(-4);
    expect(await scalar("7 % 3")).toBe(1);
    expect(await single("vector(1) atan2 vector(1)")).toBeCloseTo(
      Math.PI / 4,
      10,
    );
  });

  test("one-to-one matching ignores the metric name and ignoring()'s labels", async () => {
    expect(
      await vector(
        'http_requests_total{code="500"} / ignoring (code) http_requests_total{code="200"}',
      ),
    ).toEqual({ '{instance="a", job="api"}': 0.1 });
  });

  test("on() keeps only its labels", async () => {
    expect(
      await vector(
        'http_requests_total{code="500"} / on (instance) http_requests_total{code="200"}',
      ),
    ).toEqual({ '{instance="a"}': 0.1 });
  });

  test("group_left copies the listed labels from the one side", async () => {
    expect(
      await vector(
        "http_requests_total * on (instance) group_left (team) team_info",
      ),
    ).toEqual({
      '{code="200", instance="a", job="api", team="alpha"}': 100,
      '{code="500", instance="a", job="api", team="alpha"}': 10,
      '{code="200", instance="b", job="api", team="beta"}': 50,
      '{code="200", instance="c", job="web", team="gamma"}': 1000,
    });
  });

  test("group_right is group_left from the other side", async () => {
    expect(
      await vector(
        'team_info * on (instance) group_right (team) http_requests_total{job="web"}',
      ),
    ).toEqual({ '{code="200", instance="c", job="web", team="gamma"}': 1000 });
  });

  test("group_left divides each series by its group's total", async () => {
    expect(
      await vector(
        'http_requests_total{job="api"} / on (job) group_left sum by (job) (http_requests_total)',
      ),
    ).toEqual({
      '{code="200", instance="a", job="api"}': 0.625,
      '{code="200", instance="b", job="api"}': 0.3125,
      '{code="500", instance="a", job="api"}': 0.0625,
    });
  });

  test("many matches without group_left are refused", async () => {
    const error: PromQLError = await queryError(() => {
      return instant(
        'http_requests_total{job="api"} / on (job) sum by (job) (http_requests_total)',
      );
    });

    expect(error.message).toContain("Say which side has many");
  });

  test("duplicates on the one side are refused", async () => {
    const error: PromQLError = await queryError(() => {
      return instant("http_requests_total / on (job) http_requests_total");
    });

    expect(error.message).toContain("More than one series on the right side");
  });

  test("and, or and unless match on labels and keep the metric name", async () => {
    expect(
      Object.keys(
        await vector(
          'http_requests_total and on (instance) team_info{team="alpha"}',
        ),
      ),
    ).toEqual([
      'http_requests_total{code="200", instance="a", job="api"}',
      'http_requests_total{code="500", instance="a", job="api"}',
    ]);
    expect(
      Object.keys(
        await vector(
          'http_requests_total{job="web"} or http_requests_total{code="500"}',
        ),
      ),
    ).toEqual([
      'http_requests_total{code="200", instance="c", job="web"}',
      'http_requests_total{code="500", instance="a", job="api"}',
    ]);
    expect(
      Object.keys(
        await vector(
          'http_requests_total unless on (job) http_requests_total{job="web"}',
        ),
      ),
    ).toHaveLength(3);
  });

  test("or leaves out the right side's series the left side already has", async () => {
    expect(
      await vector(
        'http_requests_total{instance="c"} or label_replace(http_requests_total{instance="c"}, "__name__", "other", "", "")',
      ),
    ).toEqual({
      'http_requests_total{code="200", instance="c", job="web"}': 1000,
    });
  });

  test("a negated vector drops the metric name", async () => {
    expect(await vector('-http_requests_total{instance="c"}')).toEqual({
      '{code="200", instance="c", job="web"}': -1000,
    });
  });
});

describe("other functions", () => {
  test("histogram_quantile reads classic buckets", async () => {
    expect(
      await vector("histogram_quantile(0.5, request_duration_seconds_bucket)"),
    ).toEqual({ '{job="api"}': 0.5 });
    expect(
      await single("histogram_quantile(0.9, request_duration_seconds_bucket)"),
    ).toBe(1);
    expect(
      await single("histogram_quantile(0.25, request_duration_seconds_bucket)"),
    ).toBeCloseTo(0.1, 10);
  });

  test("label_replace and label_join", async () => {
    expect(
      Object.keys(
        await vector('label_replace(up, "host", "$1", "instance", "(.*):.*")'),
      ),
    ).toEqual(['up{host="host-1", instance="host-1:9100", job="node"}']);
    expect(
      Object.keys(
        await vector(
          'label_replace(up, "host", "${1}x", "instance", "(.*):.*")',
        ),
      ),
    ).toEqual(['up{host="host-1x", instance="host-1:9100", job="node"}']);
    expect(
      Object.keys(
        await vector('label_replace(up, "job", "", "instance", ".*")'),
      ),
    ).toEqual(['up{instance="host-1:9100"}']);
    expect(
      Object.keys(
        await vector('label_join(up, "both", "/", "job", "instance")'),
      ),
    ).toEqual([
      'up{both="node/host-1:9100", instance="host-1:9100", job="node"}',
    ]);
  });

  test("label_replace reads RE2's named groups, whatever their names", async () => {
    const replaced: string =
      'up{host="host-1", instance="host-1:9100", job="node"}';

    expect(
      Object.keys(
        await vector(
          'label_replace(up, "host", "${host}", "instance", "(?P<host>[^:]+):.*")',
        ),
      ),
    ).toEqual([replaced]);
    expect(
      Object.keys(
        await vector(
          'label_replace(up, "host", "$constructor", "instance", "(?P<constructor>[^:]+):.*")',
        ),
      ),
    ).toEqual([replaced]);
    expect(
      Object.keys(
        await vector(
          'label_replace(up, "host", "$0", "instance", "[[:alpha:]]+-[[:digit:]]+:.*")',
        ),
      ),
    ).toEqual(['up{host="host-1:9100", instance="host-1:9100", job="node"}']);
    // A name no group has is empty, as in Go: the label is left out.
    expect(
      Object.keys(
        await vector(
          'label_replace(up, "host", "$toString", "instance", "(.*)")',
        ),
      ),
    ).toEqual(['up{instance="host-1:9100", job="node"}']);
  });

  test("label_replace is anchored, as Prometheus anchors it: a pattern that matches part of the value leaves the series alone", async () => {
    expect(
      Object.keys(
        await vector('label_replace(up, "host", "$1", "instance", "(host)")'),
      ),
    ).toEqual(['up{instance="host-1:9100", job="node"}']);
  });

  test("label_replace compiles its pattern once, for every series", async () => {
    const compiles: SpyInstance<typeof PatternCache.getLinearRegExp> =
      jest.spyOn(PatternCache, "getLinearRegExp");

    try {
      const values: Record<string, number> = await vector(
        'label_replace(http_requests_total, "host", "$1", "instance", "(.+)")',
      );

      expect(Object.keys(values)).toHaveLength(4);
      expect(compiles).toHaveBeenCalledTimes(1);
    } finally {
      compiles.mockRestore();
    }
  });

  test.each([
    [
      'label_replace(up, "host", "$1", "instance", "(")',
      '"(" in label_replace() is not a regular expression.',
    ],
    [
      'label_replace(up, "host", "$1", "instance", "(a)\\\\1")',
      'The pattern "(a)\\1" in label_replace() refers back to what an earlier group matched (\\1 or \\k<name>). Patterns are run in time that grows only in line with the text they read, which a back-reference cannot do. Write the pattern without it.',
    ],
    [
      'label_replace(up, "host", "$1", "instance", "(.{0,50000})")',
      'The pattern "(.{0,50000})" in label_replace() is too large to run. Shorten it, or repeat its parts fewer times.',
    ],
  ])(
    "label_replace refuses %s with a sentence",
    async (query: string, message: string) => {
      const error: PromQLError = await queryError(() => {
        return instant(query);
      });

      expect(error.message).toBe(message);
      expect(error.errorType).toBe(PromQLErrorType.Execution);
    },
  );

  test("absent() names the labels the selector pins", async () => {
    expect(
      await vector('absent(nonexistent{job="api", instance=~"a.*"})'),
    ).toEqual({ '{job="api"}': 1 });
    expect(await vector("absent(up)")).toEqual({});
    expect(await vector('absent_over_time(nonexistent{job="x"}[5m])')).toEqual({
      '{job="x"}': 1,
    });
  });

  test("scalar(), vector() and time()", async () => {
    expect(await scalar('scalar(http_requests_total{instance="c"})')).toBe(
      1000,
    );
    expect(Number.isNaN(await scalar("scalar(http_requests_total)"))).toBe(
      true,
    );
    expect(await vector("vector(5)")).toEqual({ "{}": 5 });
    expect(await scalar("time()")).toBe(600);
  });

  test("timestamp() answers when the sample was taken", async () => {
    expect(
      await single('timestamp(http_requests_total{instance="c"})', 650),
    ).toBe(600);
  });

  test.each([
    ["hour(vector(1700000000))", 22],
    ["minute(vector(1700000000))", 13],
    ["day_of_month(vector(1700000000))", 14],
    ["day_of_week(vector(1700000000))", 2],
    ["day_of_year(vector(1700000000))", 318],
    ["days_in_month(vector(1700000000))", 30],
    ["month(vector(1700000000))", 11],
    ["year(vector(1700000000))", 2023],
    ["abs(vector(-2))", 2],
    ["sqrt(vector(16))", 4],
    ["ln(vector(1))", 0],
    ["exp(vector(0))", 1],
    ["ceil(vector(1.2))", 2],
    ["floor(vector(1.8))", 1],
    ["sgn(vector(-3))", -1],
    ["log2(vector(8))", 3],
    ["log10(vector(1000))", 3],
    ["deg(vector(pi()))", 180],
    ["round(vector(2.5))", 3],
    ["round(vector(-2.5))", -2],
    ["round(vector(2.345), 0.1)", 2.3],
    ["clamp(temperature, 4, 7)", 7],
    ["clamp_max(temperature, 4)", 4],
    ["clamp_min(temperature, 40)", 40],
  ])("%s is %d", async (query: string, expected: number) => {
    expect(await single(query)).toBeCloseTo(expected, 10);
  });

  test("hour() with no argument reads the evaluation time", async () => {
    expect(await single("hour()", 7200)).toBe(2);
  });

  test("clamp() with max below min answers nothing", async () => {
    expect(await vector("clamp(temperature, 5, 1)")).toEqual({});
  });

  test("sort_desc keeps its order; other answers are sorted by labels", async () => {
    const sorted: PromQLQueryResult = await instant(
      'sort_desc(http_requests_total{job="api"})',
    );
    const values: Array<number> =
      sorted.resultType === PromQLResultType.Vector
        ? sorted.samples.map((sample: PromQLVectorResultSample): number => {
            return sample.value;
          })
        : [];

    expect(values).toEqual([100, 50, 10]);

    const ascending: PromQLQueryResult = await instant(
      'sort(http_requests_total{job="api"})',
    );

    expect(
      ascending.resultType === PromQLResultType.Vector
        ? ascending.samples.map((sample: PromQLVectorResultSample): number => {
            return sample.value;
          })
        : [],
    ).toEqual([10, 50, 100]);
  });

  test("two series with the same labels after a function are refused", async () => {
    const error: PromQLError = await queryError(() => {
      return instant('rate({__name__=~"dup_a|dup_b"}[5m])');
    });

    expect(error.message).toContain(
      "Two series in the result have the same labels",
    );
    expect(error.errorType).toBe(PromQLErrorType.Execution);
  });
});

describe("subqueries", () => {
  test("evaluate the inner query at aligned steps", async () => {
    // Steps 360, 420, 480, 540 and 600 fall in (300s, 600s].
    expect(await single("count_over_time(vector(1)[5m:1m])")).toBe(5);
    // At 630s the range (330s, 630s] still holds five whole minutes.
    expect(await single("count_over_time(vector(1)[5m:1m])", 630)).toBe(5);
  });

  test("max of a rate over the last five minutes", async () => {
    expect(
      await single(
        'max_over_time(rate(http_requests_total{instance="c"}[2m])[5m:1m])',
      ),
    ).toBeCloseTo(100 / 60, 10);
  });

  test("a subquery without a step uses one minute", async () => {
    expect(await single("count_over_time(vector(1)[5m:])")).toBe(5);
  });
});

describe("range queries", () => {
  test("evaluate at every step and keep a series per label set", async () => {
    const result: PromQLQueryResult = await engine().engine.rangeQuery(
      'http_requests_total{instance="c"}',
      300000,
      900000,
      300000,
    );

    expect(result.resultType).toBe(PromQLResultType.Matrix);
    const series: Array<PromQLMatrixResultSeries> =
      result.resultType === PromQLResultType.Matrix ? result.series : [];

    expect(series).toHaveLength(1);
    // At 900s the last sample (600s) is out of the five-minute lookback.
    expect(series[0]!.points).toEqual([
      { timestampMs: 300000, value: 500 },
      { timestampMs: 600000, value: 1000 },
    ]);
  });

  test("a number becomes a series with no labels", async () => {
    const result: PromQLQueryResult = await engine().engine.rangeQuery(
      "1 + 1",
      0,
      120000,
      60000,
    );

    expect(result).toEqual({
      resultType: PromQLResultType.Matrix,
      series: [
        {
          labels: {},
          points: [
            { timestampMs: 0, value: 2 },
            { timestampMs: 60000, value: 2 },
            { timestampMs: 120000, value: 2 },
          ],
        },
      ],
    });
  });

  test("@ start() holds one value for the whole range", async () => {
    const result: PromQLQueryResult = await engine().engine.rangeQuery(
      'http_requests_total{instance="c"} @ start()',
      300000,
      600000,
      150000,
    );
    const points: Array<number> =
      result.resultType === PromQLResultType.Matrix
        ? result.series[0]!.points.map((point: { value: number }): number => {
            return point.value;
          })
        : [];

    expect(points).toEqual([500, 500, 500]);
  });

  test("a range vector cannot be charted", async () => {
    const error: PromQLError = await queryError(() => {
      return engine().engine.rangeQuery(
        "http_requests_total[5m]",
        0,
        600000,
        60000,
      );
    });

    expect(error.message).toContain("Wrap it in a function such as rate");
  });

  test("more than 11,000 points per series is refused", async () => {
    const error: PromQLError = await queryError(() => {
      return engine().engine.rangeQuery("up", 0, 11001000, 1000);
    });

    expect(error.message).toContain("more than the 11,000 allowed");
    expect(error.errorType).toBe(PromQLErrorType.BadData);
  });

  test("a step of zero is refused", async () => {
    const error: PromQLError = await queryError(() => {
      return engine().engine.rangeQuery("up", 0, 1000, 0);
    });

    expect(error.message).toContain("The step must be longer than zero");
  });
});

describe("limits and reads", () => {
  test("a query that reads too many samples is refused", async () => {
    const error: PromQLError = await queryError(() => {
      return engine({ maxSamples: 3 }).engine.instantQuery(
        "http_requests_total",
        600000,
      );
    });

    expect(error.message).toContain("more than 3 samples");
    expect(error.errorType).toBe(PromQLErrorType.Execution);
  });

  test("a query that runs too long times out", async () => {
    let clock: number = 0;
    const error: PromQLError = await queryError(() => {
      return engine({
        timeoutMs: 10,
        now: (): number => {
          clock += 5;
          return clock;
        },
      }).engine.rangeQuery("vector(1)", 0, 600000, 1000);
    });

    expect(error.errorType).toBe(PromQLErrorType.Timeout);
    expect(error.message).toContain("took longer than");
  });

  test("reads each selector once, for every sample a step can need", async () => {
    const { engine: queryEngine, source } = engine();

    await queryEngine.instantQuery(
      "rate(http_requests_total[5m]) / rate(http_requests_total[5m])",
      600000,
    );

    expect(source.selections).toHaveLength(1);
    expect(source.selections[0]).toMatchObject({
      metricName: "http_requests_total",
      startTimeMs: 300000,
      endTimeMs: 600000,
    });
  });

  test("an offset and the lookback widen the read", async () => {
    const { engine: queryEngine, source } = engine();

    await queryEngine.rangeQuery(
      "http_requests_total offset 1h",
      7200000,
      10800000,
      60000,
    );

    expect(source.selections[0]).toMatchObject({
      startTimeMs: 7200000 - 3600000 - 300000,
      endTimeMs: 10800000 - 3600000,
    });
  });

  test("a subquery reads its range before the first step", async () => {
    const { engine: queryEngine, source } = engine();

    await queryEngine.instantQuery(
      "max_over_time(rate(http_requests_total[1m])[10m:1m])",
      600000,
    );

    expect(source.selections[0]).toMatchObject({
      startTimeMs: 600000 - 600000 - 60000,
      endTimeMs: 600000,
    });
  });
});

describe("a question the linear-time matcher stops at its work limit", () => {
  // A thousand a's and b's, then a "Q".
  const longValue: () => string = (): string => {
    const random: SeededRandom = seededRandom(31);
    let text: string = "";

    for (let index: number = 0; index < 1000; index++) {
      text += random(2) === 0 ? "a" : "b";
    }

    return `${text}Q`;
  };

  // A pattern that needs many steps for each character of a long value.
  const PATTERN: string = ".*(?:[ab]*a[ab]{14}|[ab]{0,2000})Q";

  const engineOver: (labels: PromQLLabels) => PromQLEngine = (
    labels: PromQLLabels,
  ): PromQLEngine => {
    return new PromQLEngine(
      new MemorySource([{ labels, samples: [[600, 1]] }]),
    );
  };

  test("refuses a selector's query with a sentence, rather than answering without it", async () => {
    const error: PromQLError = await queryError(() => {
      return engineOver({ __name__: "x", path: longValue() }).instantQuery(
        `x{path=~"${PATTERN}"}`,
        600 * 1000,
      );
    });

    expect(error.message).toBe(
      `The pattern "${PATTERN}" for the label "path" needed more work to match one of the label's values than the value's length allows. Write a simpler pattern.`,
    );
    expect(error.errorType).toBe(PromQLErrorType.Execution);
  });

  test("refuses label_replace's with a sentence", async () => {
    const error: PromQLError = await queryError(() => {
      return engineOver({ __name__: "x", path: longValue() }).instantQuery(
        `label_replace(x, "y", "$1", "path", "${PATTERN}")`,
        600 * 1000,
      );
    });

    expect(error.message).toBe(
      `The pattern "${PATTERN}" in label_replace() needed more work to match a value of the label "path" than the value's length allows. Write a simpler pattern.`,
    );
    expect(error.errorType).toBe(PromQLErrorType.Execution);
  });

  test("the same pattern answers a short value", async () => {
    const result: PromQLQueryResult = await engineOver({
      __name__: "x",
      path: "abQ",
    }).instantQuery(`x{path=~"${PATTERN}"}`, 600 * 1000);

    expect(
      result.resultType === PromQLResultType.Vector
        ? result.samples.length
        : -1,
    ).toBe(1);
  });
});

describe("the API's number format", () => {
  test.each([
    [1.5, "1.5"],
    [NaN, "NaN"],
    [Infinity, "+Inf"],
    [-Infinity, "-Inf"],
    [1e21, "1000000000000000000000"],
    [1.5e-7, "0.00000015"],
    [-2.5e-8, "-0.000000025"],
    [0, "0"],
  ])("%d is written %s", (value: number, text: string) => {
    expect(formatPromQLValue(value)).toBe(text);
  });
});
