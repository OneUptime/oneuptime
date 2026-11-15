import PromQLEngine from "../../../Utils/PromQL/PromQLEngine";
import {
  PromQLMatrixResultSeries,
  PromQLQueryResult,
  PromQLResultType,
  PromQLSeries,
  PromQLSeriesSelection,
  PromQLSeriesSource,
  PromQLVectorResultSample,
} from "../../../Utils/PromQL/PromQLEngineTypes";
import {
  PromQLLabels,
  dropMetricName,
  formatPromQLLabels,
  matchesPromQLMatchers,
  promQLMatchSignature,
} from "../../../Utils/PromQL/PromQLLabels";
import { attributesToPromQLLabels } from "../../../Utils/PromQL/PromQLMetricNames";
import { parsePrometheusResult } from "../../../Utils/PromQL/PrometheusResponse";
import { readOwnValue } from "../../../Utils/LookupTable";
import { describe, expect, test } from "@jest/globals";

/*
 * A label named __proto__ is a label like any other (issue #8025).
 *
 * Prometheus reserves names that start with "__" for its own use, but it
 * stores and answers with any label a series or a query gives, and an OTLP
 * attribute has no such rule: OneUptime's metrics become PromQL series
 * with one label per attribute. The engine kept label sets in plain
 * objects, copied with a spread (Object.assign, on this code's ES2017
 * target) and written with assignments, and both drop a key named
 * __proto__: label_replace and label_join wrote nothing, count_values lost
 * the value label, absent() named nothing, and every copy - rate()'s
 * dropping of the metric name, `without (...)`, histogram_quantile's
 * grouping, an operator's result - lost a __proto__ label a series had.
 *
 * Every expected answer here is what Prometheus' own engine gives for the
 * same series: it treats __proto__ as an ordinary label name.
 */

interface TestSeries {
  labels: PromQLLabels;
  // [seconds, value]
  samples: Array<[number, number]>;
}

/*
 * A label set as a source hands it over: JSON, so __proto__ is its own key.
 * (In an object literal here a __proto__ key is written computed,
 * `["__proto__"]: ...`: written plainly it sets the literal's prototype.)
 */
const labelsOf: (record: Record<string, string>) => PromQLLabels = (
  record: Record<string, string>,
): PromQLLabels => {
  return JSON.parse(JSON.stringify(record)) as PromQLLabels;
};

class MemorySource implements PromQLSeriesSource {
  public constructor(private readonly data: Array<TestSeries>) {}

  public async select(
    selection: PromQLSeriesSelection,
  ): Promise<Array<PromQLSeries>> {
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

const DATA: Array<TestSeries> = [
  {
    labels: labelsOf({ __name__: "up", job: "api", instance: "a" }),
    samples: [[600, 1]],
  },
  {
    labels: labelsOf({ __name__: "up", job: "web", instance: "b" }),
    samples: [[600, 0]],
  },
  // Series that carry a __proto__ label of their own.
  {
    labels: labelsOf({
      __name__: "requests_total",
      ["__proto__"]: "eu",
      instance: "a",
    }),
    samples: every(60, 60, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]),
  },
  {
    labels: labelsOf({
      __name__: "requests_total",
      ["__proto__"]: "us",
      instance: "b",
    }),
    samples: every(60, 60, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]),
  },
  {
    labels: labelsOf({ __name__: "requests_total", instance: "c" }),
    samples: every(60, 60, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  },
  {
    labels: labelsOf({
      __name__: "region_info",
      instance: "a",
      ["__proto__"]: "eu",
    }),
    samples: [[600, 1]],
  },
  {
    labels: labelsOf({
      __name__: "region_info",
      instance: "b",
      ["__proto__"]: "us",
    }),
    samples: [[600, 1]],
  },
  {
    labels: labelsOf({ __name__: "region_info", instance: "c" }),
    samples: [[600, 1]],
  },
  // A classic histogram whose buckets carry a __proto__ label.
  ...[
    ["0.1", 10],
    ["0.5", 20],
    ["+Inf", 40],
  ].map(([le, count]: Array<string | number>): TestSeries => {
    return {
      labels: labelsOf({
        __name__: "latency_bucket",
        ["__proto__"]: "eu",
        le: String(le),
      }),
      samples: [[600, Number(count)]],
    };
  }),
];

const query: (text: string) => Promise<PromQLQueryResult> = (
  text: string,
): Promise<PromQLQueryResult> => {
  return new PromQLEngine(new MemorySource(DATA)).instantQuery(
    text,
    600 * 1000,
  );
};

const samplesOf: (
  text: string,
) => Promise<Array<PromQLVectorResultSample>> = async (
  text: string,
): Promise<Array<PromQLVectorResultSample>> => {
  const result: PromQLQueryResult = await query(text);

  if (result.resultType !== PromQLResultType.Vector) {
    throw new Error(`Expected a vector, got ${result.resultType}.`);
  }

  return result.samples;
};

// The vector as { 'labels': value }, and each answer's labels as own keys.
const vector: (text: string) => Promise<Record<string, number>> = async (
  text: string,
): Promise<Record<string, number>> => {
  const values: Record<string, number> = {};

  for (const sample of await samplesOf(text)) {
    expect(Object.getPrototypeOf(sample.labels)).toBe(Object.prototype);
    values[formatPromQLLabels(sample.labels)] = sample.value;
  }

  return values;
};

// The value of each answer's __proto__ label, as the answer's own key.
const protoValues: (
  text: string,
) => Promise<Array<string | undefined>> = async (
  text: string,
): Promise<Array<string | undefined>> => {
  return (await samplesOf(text))
    .map((sample: PromQLVectorResultSample): string | undefined => {
      return readOwnValue(sample.labels, "__proto__");
    })
    .sort();
};

const key: (record: Record<string, string>) => string = (
  record: Record<string, string>,
): string => {
  return formatPromQLLabels(labelsOf(record));
};

describe("PromQL: a label named __proto__ (issue #8025)", () => {
  test("label_replace writes it, as the issue's query asks", async () => {
    expect(
      await vector('label_replace(up, "__proto__", "$1", "job", "(.*)")'),
    ).toEqual({
      [key({
        __name__: "up",
        ["__proto__"]: "api",
        instance: "a",
        job: "api",
      })]: 1,
      [key({
        __name__: "up",
        ["__proto__"]: "web",
        instance: "b",
        job: "web",
      })]: 0,
    });
    expect(
      await protoValues('label_replace(up, "__proto__", "$1", "job", "(.*)")'),
    ).toEqual(["api", "web"]);
  });

  test("label_replace replaces a series' own __proto__, and an empty replacement removes it", async () => {
    expect(
      await protoValues(
        'label_replace(requests_total, "__proto__", "x-$1", "__proto__", "(.+)")',
      ),
    ).toEqual(["x-eu", "x-us", undefined]);
    expect(
      await protoValues(
        'label_replace(requests_total, "__proto__", "", "instance", "(.*)")',
      ),
    ).toEqual([undefined, undefined, undefined]);
  });

  test("label_join writes it, from the sources it names", async () => {
    expect(
      await vector('label_join(up, "__proto__", "-", "job", "instance")'),
    ).toEqual({
      [key({
        __name__: "up",
        ["__proto__"]: "api-a",
        instance: "a",
        job: "api",
      })]: 1,
      [key({
        __name__: "up",
        ["__proto__"]: "web-b",
        instance: "b",
        job: "web",
      })]: 0,
    });
  });

  test("count_values writes each value into it, as the issue's query asks", async () => {
    expect(await vector('count_values("__proto__", up)')).toEqual({
      [key({ ["__proto__"]: "1" })]: 1,
      [key({ ["__proto__"]: "0" })]: 1,
    });
    expect(await vector('count_values by (job) ("__proto__", up)')).toEqual({
      [key({ job: "api", ["__proto__"]: "1" })]: 1,
      [key({ job: "web", ["__proto__"]: "0" })]: 1,
    });
  });

  test("absent() names it when its selector pins it", async () => {
    expect(await vector('absent(nonexistent{__proto__="x"})')).toEqual({
      [key({ ["__proto__"]: "x" })]: 1,
    });
    expect(
      await vector('absent(nonexistent{__proto__="x", job="api"})'),
    ).toEqual({ [key({ ["__proto__"]: "x", job: "api" })]: 1 });
  });

  test("a selector matches on it", async () => {
    expect(await protoValues('requests_total{__proto__="eu"}')).toEqual(["eu"]);
    expect(await protoValues('requests_total{__proto__=""}')).toEqual([
      undefined,
    ]);
    expect(await protoValues('requests_total{__proto__=~"e.|u."}')).toEqual([
      "eu",
      "us",
    ]);
  });

  test("a function that drops the metric name keeps it", async () => {
    const rates: Record<string, number> = await vector(
      "rate(requests_total[5m])",
    );

    expect(Object.keys(rates).sort()).toEqual(
      [
        key({ ["__proto__"]: "eu", instance: "a" }),
        key({ ["__proto__"]: "us", instance: "b" }),
        key({ instance: "c" }),
      ].sort(),
    );
    expect(rates[key({ ["__proto__"]: "eu", instance: "a" })]).toBeCloseTo(
      10 / 60,
      12,
    );
    expect(rates[key({ ["__proto__"]: "us", instance: "b" })]).toBeCloseTo(
      5 / 60,
      12,
    );
    expect(await protoValues("abs(requests_total)")).toEqual([
      "eu",
      "us",
      undefined,
    ]);
  });

  test("by (__proto__) groups by it, and without (...) keeps it", async () => {
    expect(await vector("sum by (__proto__) (requests_total)")).toEqual({
      [key({ ["__proto__"]: "eu" })]: 100,
      [key({ ["__proto__"]: "us" })]: 50,
      "{}": 10,
    });
    expect(await vector("sum without (instance) (requests_total)")).toEqual({
      [key({ ["__proto__"]: "eu" })]: 100,
      [key({ ["__proto__"]: "us" })]: 50,
      "{}": 10,
    });
    expect(
      await vector("sum without (__proto__, instance) (requests_total)"),
    ).toEqual({ "{}": 160 });
  });

  test("histogram_quantile keeps it on the series it groups", async () => {
    expect(
      await protoValues("histogram_quantile(0.5, latency_bucket)"),
    ).toEqual(["eu"]);
  });

  test("on (__proto__) matches on it, ignoring (...) keeps it in the signature, and group_left copies it", async () => {
    expect(
      await vector(
        'requests_total + on (__proto__) group_left region_info{instance!="c"}',
      ),
    ).toEqual({
      [key({ ["__proto__"]: "eu", instance: "a" })]: 101,
      [key({ ["__proto__"]: "us", instance: "b" })]: 51,
    });
    expect(
      await vector(
        "requests_total * on (instance) group_left (__proto__) region_info",
      ),
    ).toEqual({
      [key({ ["__proto__"]: "eu", instance: "a" })]: 100,
      [key({ ["__proto__"]: "us", instance: "b" })]: 50,
      [key({ instance: "c" })]: 10,
    });
    /*
     * Two series apart only by __proto__ are two, with ignoring (...) too:
     * its signature left __proto__ out, so they were one match group of
     * two series and the query failed.
     */
    expect(
      await vector("requests_total - ignoring (instance) requests_total"),
    ).toEqual({
      [key({ ["__proto__"]: "eu" })]: 0,
      [key({ ["__proto__"]: "us" })]: 0,
      "{}": 0,
    });
  });

  test("a range query's series keep it", async () => {
    const result: PromQLQueryResult = await new PromQLEngine(
      new MemorySource(DATA),
    ).rangeQuery(
      'label_replace(up, "__proto__", "$1", "job", "(.*)")',
      540 * 1000,
      600 * 1000,
      60 * 1000,
    );

    expect(result.resultType).toBe(PromQLResultType.Matrix);
    expect(
      (result.resultType === PromQLResultType.Matrix ? result.series : [])
        .map((series: PromQLMatrixResultSeries): string | undefined => {
          return readOwnValue(series.labels, "__proto__");
        })
        .sort(),
    ).toEqual(["api", "web"]);
  });
});

describe("PromQL's label helpers keep a label named __proto__ (issue #8025)", () => {
  test("dropMetricName copies it", () => {
    const labels: PromQLLabels = dropMetricName(
      labelsOf({ __name__: "x", ["__proto__"]: "eu", job: "api" }),
    );

    expect(Object.keys(labels)).toEqual(["__proto__", "job"]);
    expect(readOwnValue(labels, "__proto__")).toBe("eu");
    expect(Object.getPrototypeOf(labels)).toBe(Object.prototype);
  });

  test("promQLMatchSignature tells two series apart by it, matched on or not", () => {
    const eu: PromQLLabels = labelsOf({ ["__proto__"]: "eu", job: "api" });
    const us: PromQLLabels = labelsOf({ ["__proto__"]: "us", job: "api" });

    expect(promQLMatchSignature(eu, false, [])).not.toBe(
      promQLMatchSignature(us, false, []),
    );
    expect(promQLMatchSignature(eu, true, ["__proto__"])).not.toBe(
      promQLMatchSignature(us, true, ["__proto__"]),
    );
    expect(promQLMatchSignature(eu, false, ["__proto__"])).toBe(
      promQLMatchSignature(us, false, ["__proto__"]),
    );
  });

  test("attributesToPromQLLabels makes an attribute named __proto__ a label", () => {
    const labels: PromQLLabels = attributesToPromQLLabels(
      JSON.parse('{"__proto__":"eu","resource.service.name":"api"}') as Record<
        string,
        unknown
      >,
    );

    expect(readOwnValue(labels, "__proto__")).toBe("eu");
    expect(readOwnValue(labels, "job")).toBe("api");
    expect(Object.getPrototypeOf(labels)).toBe(Object.prototype);
  });

  test("a Prometheus answer read back keeps it", () => {
    const parsed: ReturnType<typeof parsePrometheusResult> =
      parsePrometheusResult(
        JSON.parse(
          '{"resultType":"vector","result":[{"metric":{"__name__":"up","__proto__":"eu"},"value":[600,"1"]}]}',
        ),
      );

    expect(parsed).toBeDefined();

    const labels: PromQLLabels | undefined =
      parsed && parsed.resultType === "vector"
        ? parsed.series[0]?.labels
        : undefined;

    expect(readOwnValue(labels, "__proto__")).toBe("eu");
    expect(readOwnValue(labels, "__name__")).toBe("up");
    expect(Object.getPrototypeOf(labels)).toBe(Object.prototype);
  });
});
