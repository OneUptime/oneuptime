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
  formatPromQLLabels,
  matchesPromQLMatchers,
} from "../../../Utils/PromQL/PromQLLabels";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * absent() and sort_by_label() as Prometheus answers them (issue #8027).
 *
 * Every answer marked as Prometheus' is what Prometheus 3.16.0 (revision
 * e2e28adeee2c) answered over its HTTP API, run with
 * --enable-feature=promql-experimental-functions over these same series:
 * stored in its TSDB with `promtool tsdb create-blocks-from openmetrics`,
 * one sample each, and asked 60 seconds after it.
 */

interface TestSeries {
  labels: PromQLLabels;
}

// Each series has one sample, at 600 seconds; every query is asked at 660.
const SAMPLE_SECONDS: number = 600;
const QUERY_MS: number = 660 * 1000;

class MemorySource implements PromQLSeriesSource {
  public constructor(private readonly data: ReadonlyArray<TestSeries>) {}

  public async select(
    selection: PromQLSeriesSelection,
  ): Promise<Array<PromQLSeries>> {
    const sampleMs: number = SAMPLE_SECONDS * 1000;

    if (
      !(sampleMs > selection.startTimeMs && sampleMs <= selection.endTimeMs)
    ) {
      return [];
    }

    return this.data
      .filter((item: TestSeries): boolean => {
        return matchesPromQLMatchers(item.labels, selection.matchers);
      })
      .map((item: TestSeries): PromQLSeries => {
        return { labels: item.labels, timestampsMs: [sampleMs], values: [1] };
      });
  }
}

const named: (
  name: string,
  labels: Array<PromQLLabels>,
) => Array<TestSeries> = (
  name: string,
  labels: Array<PromQLLabels>,
): Array<TestSeries> => {
  return labels.map((item: PromQLLabels): TestSeries => {
    return { labels: { __name__: name, ...item } };
  });
};

// Ties on the label sorted by, which the whole label set breaks.
const TIE: Array<TestSeries> = named("tie", [
  { g: "1", a: "z" },
  { g: "1", b: "a" },
  { g: "1" },
  { g: "1", h: "x" },
  { g: "1", i: "x" },
  { g: "1", i: "xy" },
  { g: "1", A: "1" },
  { g: "0", v: "�" },
  { g: "0", v: "\u{1F600}" },
  { g: "0", v: "~" },
  { g: "2", job: "x", instance: "b" },
  { g: "2", job: "x", instance: "a" },
  { g: "2", job: "y", instance: "a" },
]);

// Values in natural order, as Prometheus sorts them.
const NATURAL_ORDER: Array<string> = [
  "0",
  "1.9",
  "1.10",
  "9",
  "10",
  "100",
  "A",
  "B",
  "Z",
  "_",
  "a",
  "a9",
  "a10",
  "a100a",
  "a100b",
  "a b",
  "a-b",
  "a_b",
  "ab",
  "b",
  "e",
  "f",
  "v1.2.9",
  "v1.2.10",
  "v1.10.0",
  "x-1",
  "x.1",
  "x_1",
  "z",
  "ä",
  "é",
  "�",
  "\u{1F600}",
];

// The same values in the order the series were stored in.
const NAT: Array<TestSeries> = named(
  "nat",
  [
    "a",
    "B",
    "b",
    "A",
    "_",
    "Z",
    "z",
    "x-1",
    "x_1",
    "x.1",
    "1.10",
    "1.9",
    "a9",
    "a10",
    "a100b",
    "a100a",
    "9",
    "10",
    "100",
    "é",
    "e",
    "f",
    "�",
    "\u{1F600}",
    "ä",
    "a b",
    "ab",
    "a-b",
    "a_b",
    "0",
    "v1.2.10",
    "v1.2.9",
    "v1.10.0",
  ].map((v: string): PromQLLabels => {
    return { v };
  }),
);

// Past int64, natsort compares a run of digits as text.
const OVERFLOW: Array<TestSeries> = [
  ...named("ovf", [{ v: "5" }, { v: "10000000000000000000000" }]),
  ...named("ovf2", [{ v: "95" }, { v: "9223372036854775808" }]),
  ...named("ovf3", [{ v: "95" }, { v: "9223372036854775807" }]),
];

// Where Prometheus' comparison says "after" (or "before") both ways round.
const GAP: Array<TestSeries> = named("gap", [
  { i: "1", k: "b" },
  { i: "2", k: "a" },
  { i: "3" },
  { i: "4", k: "c" },
]);

const ZEROS: Array<TestSeries> = named("zeros", [
  { i: "1", k: "1" },
  { i: "2", k: "01" },
  { i: "3", k: "001" },
  { i: "4", k: "2" },
]);

/*
 * More series than an insertion sort handles (Go's sort switches to pdqsort
 * past 12), with ties on k1 and on k2, and labels some have and others not.
 */
const BIG_LABELS: Array<PromQLLabels> = [
  { k1: "z", k2: "10", k3: "q" },
  { k1: "A", k2: "10" },
  { k1: "é", k2: "2", k3: "q" },
  { k1: "a1", k2: "1" },
  { k1: "é", k2: "x", k3: "q" },
  { k1: "a2", k2: "2", k3: "q", extra: "m" },
  { k1: "e", k2: "2", k3: "q", extra: "mm" },
  { k1: "A", k2: "1", k3: "q" },
  { k1: "é", k2: "2" },
  { k1: "a1", k2: "10", extra: "m" },
  { k1: "z", k2: "x" },
  { k1: "z", k2: "2" },
  { k1: "e", k2: "x" },
  { k1: "Z", k2: "2" },
  { k1: "1.9", k2: "10", k3: "p" },
  { k1: "_x", k2: "x", k3: "q", extra: "m" },
  { k1: "1.10", k2: "10", k3: "q", extra: "m" },
  { k1: "B", k2: "1", k3: "p" },
  { k1: "9", k2: "x", extra: "n" },
  { k1: "A", k2: "x", extra: "mm" },
  { k1: "1.10", k2: "1" },
  { k1: "A", k2: "2" },
  { k1: "10", k2: "x", k3: "q", extra: "m" },
  { k1: "a", k2: "1", extra: "n" },
  { k1: "1.10", k2: "x", extra: "n" },
  { k1: "e", k2: "10", k3: "p", extra: "mm" },
  { k1: "z", k2: "1", k3: "q", extra: "mm" },
  { k1: "a1", k2: "1", extra: "n" },
  { k1: "B", k2: "x" },
  { k1: "1.10", k2: "2", k3: "q" },
  { k1: "a", k2: "x", extra: "n" },
  { k1: "b", k2: "1" },
  { k1: "1.9", k2: "2" },
  { k1: "Z", k2: "x", k3: "q" },
  { k1: "B", k2: "1", extra: "m" },
  { k1: "9", k2: "10", k3: "q" },
  { k1: "z", k2: "2", extra: "n" },
  { k1: "a1", k2: "x" },
  { k1: "z", k2: "1", k3: "p" },
  { k1: "b", k2: "2" },
  { k1: "1.9", k2: "x", extra: "n" },
  { k1: "_x", k2: "x", k3: "p" },
  { k1: "1.9", k2: "1", k3: "q" },
  { k1: "a", k2: "2", k3: "q", extra: "mm" },
  { k1: "a10", k2: "10", extra: "m" },
  { k1: "e", k2: "x", k3: "q" },
  { k1: "e", k2: "10" },
  { k1: "a10", k2: "2", k3: "q" },
];

const BIG: Array<TestSeries> = named("big", BIG_LABELS);

// Prometheus' order for each query, as places in BIG_LABELS.
const BIG_ORDERS: Array<[string, Array<number>]> = [
  [
    'sort_by_label(big, "k1")',
    [
      40, 42, 14, 32, 16, 24, 20, 29, 18, 35, 22, 19, 7, 1, 21, 34, 17, 28, 13,
      33, 15, 41, 43, 23, 30, 9, 27, 3, 37, 5, 44, 47, 31, 39, 25, 6, 46, 12,
      45, 26, 36, 38, 0, 11, 10, 8, 2, 4,
    ],
  ],
  [
    'sort_by_label(big, "k2")',
    [
      34, 26, 23, 27, 20, 42, 7, 17, 3, 31, 38, 5, 43, 6, 36, 29, 32, 21, 13,
      47, 39, 11, 8, 2, 16, 9, 44, 25, 14, 35, 1, 46, 0, 22, 15, 19, 24, 40, 18,
      30, 28, 33, 41, 37, 12, 45, 10, 4,
    ],
  ],
  [
    'sort_by_label(big, "k2", "k1")',
    [
      42, 20, 7, 34, 17, 23, 27, 3, 31, 26, 38, 32, 29, 21, 13, 43, 5, 47, 39,
      6, 36, 11, 8, 2, 14, 16, 35, 1, 9, 44, 25, 46, 0, 40, 24, 18, 22, 19, 28,
      33, 15, 41, 30, 37, 12, 45, 10, 4,
    ],
  ],
  [
    'sort_by_label(big, "k1", "k2")',
    [
      42, 32, 14, 40, 20, 29, 16, 24, 35, 18, 22, 7, 21, 1, 19, 34, 17, 28, 13,
      33, 15, 41, 23, 43, 30, 27, 3, 9, 37, 5, 47, 44, 31, 39, 6, 25, 46, 12,
      45, 26, 38, 36, 11, 0, 10, 8, 2, 4,
    ],
  ],
  [
    'sort_by_label_desc(big, "k1")',
    [
      4, 2, 8, 10, 11, 0, 38, 36, 26, 45, 12, 46, 6, 25, 39, 31, 47, 44, 5, 37,
      3, 27, 9, 30, 23, 43, 41, 15, 33, 13, 28, 17, 34, 21, 1, 7, 19, 22, 35,
      18, 29, 20, 24, 16, 32, 14, 42, 40,
    ],
  ],
  [
    'sort_by_label_desc(big, "k2", "k1")',
    [
      4, 10, 45, 12, 37, 30, 41, 15, 33, 28, 19, 22, 18, 24, 40, 0, 46, 25, 44,
      9, 1, 35, 16, 14, 2, 8, 11, 36, 6, 39, 47, 5, 43, 13, 21, 29, 32, 38, 26,
      31, 3, 27, 23, 17, 34, 7, 20, 42,
    ],
  ],
  [
    'sort_by_label(big, "nolabel")',
    [
      16, 22, 34, 15, 9, 44, 5, 19, 43, 25, 6, 26, 24, 40, 18, 23, 30, 27, 36,
      20, 29, 42, 14, 32, 35, 7, 1, 21, 17, 28, 13, 33, 41, 3, 37, 47, 31, 39,
      46, 12, 45, 38, 0, 11, 10, 8, 2, 4,
    ],
  ],
  [
    'sort_by_label_desc(big, "nolabel")',
    [
      4, 2, 8, 10, 11, 0, 38, 45, 12, 46, 39, 31, 47, 37, 3, 41, 33, 13, 28, 17,
      21, 1, 7, 35, 32, 14, 42, 29, 20, 36, 27, 30, 23, 18, 40, 24, 26, 6, 25,
      43, 19, 5, 44, 9, 15, 34, 22, 16,
    ],
  ],
  [
    'sort_by_label(big, "__name__", "k2")',
    [
      34, 26, 23, 27, 20, 42, 7, 17, 3, 31, 38, 5, 43, 6, 36, 29, 32, 21, 13,
      47, 39, 11, 8, 2, 16, 9, 44, 25, 14, 35, 1, 46, 0, 22, 15, 19, 24, 40, 18,
      30, 28, 33, 41, 37, 12, 45, 10, 4,
    ],
  ],
];

const ALL: Array<TestSeries> = [
  ...TIE,
  ...NAT,
  ...OVERFLOW,
  ...BIG,
  ...GAP,
  ...ZEROS,
];

const instantOver: (
  data: ReadonlyArray<TestSeries>,
  query: string,
) => Promise<PromQLQueryResult> = async (
  data: ReadonlyArray<TestSeries>,
  query: string,
): Promise<PromQLQueryResult> => {
  return new PromQLEngine(new MemorySource(data)).instantQuery(query, QUERY_MS);
};

// An instant vector's label sets, in the order the engine answered them.
const orderOver: (
  data: ReadonlyArray<TestSeries>,
  query: string,
) => Promise<Array<string>> = async (
  data: ReadonlyArray<TestSeries>,
  query: string,
): Promise<Array<string>> => {
  const result: PromQLQueryResult = await instantOver(data, query);

  if (result.resultType !== PromQLResultType.Vector) {
    throw new Error(`Expected a vector, got ${result.resultType}.`);
  }

  return result.samples.map((sample: PromQLVectorResultSample): string => {
    return formatPromQLLabels(sample.labels);
  });
};

const order: (query: string) => Promise<Array<string>> = async (
  query: string,
): Promise<Array<string>> => {
  return orderOver(ALL, query);
};

// absent()'s one label set, or null for no answer.
const absentAnswer: (query: string) => Promise<string | null> = async (
  query: string,
): Promise<string | null> => {
  const labels: Array<string> = await order(query);

  if (labels.length > 1) {
    throw new Error(`absent() answered ${labels.length} samples.`);
  }

  return labels[0] ?? null;
};

describe("absent() and absent_over_time() name the labels Prometheus names", () => {
  test("a label pinned by = and then matched by != is left out (the issue's first case)", async () => {
    expect(await absentAnswer('absent(nonexistent{job="a", job!="b"})')).toBe(
      "{}",
    );
    expect(
      await absentAnswer(
        'absent_over_time(nonexistent{job="a", job!="b"}[5m])',
      ),
    ).toBe("{}");
  });

  /*
   * The issue expected {job="a"} here, from reading createLabelsForAbsentFunction
   * alone: the != first deletes a label not set yet, and the = sets it. But a
   * Prometheus with data reads the selector from its TSDB first, which sorts
   * the matchers in place, = before the != that takes series away, and
   * absent() reads them after that: Prometheus 3.16.0 answered {}.
   */
  test("so is one matched by != and then pinned by =, as the TSDB reorders them", async () => {
    expect(await absentAnswer('absent(nonexistent{job!="b", job="a"})')).toBe(
      "{}",
    );
    expect(await absentAnswer('absent(nonexistent{job!~"b", job="a"})')).toBe(
      "{}",
    );
    expect(
      await absentAnswer(
        'absent_over_time(nonexistent{job!="b", job="a"}[5m])',
      ),
    ).toBe("{}");
  });

  test("a matcher that only picks series out keeps its place: =~ then = names the label", async () => {
    expect(await absentAnswer('absent(nonexistent{job=~"a", job="a"})')).toBe(
      '{job="a"}',
    );
    expect(await absentAnswer('absent(nonexistent{job="a", job=~"a"})')).toBe(
      "{}",
    );
    expect(await absentAnswer('absent(nonexistent{job!="", job="a"})')).toBe(
      '{job="a"}',
    );
    expect(await absentAnswer('absent(nonexistent{job="a", job!=""})')).toBe(
      "{}",
    );
  });

  test("a label pinned twice is left out, whatever the values and other matchers", async () => {
    expect(await absentAnswer('absent(nonexistent{job="a", job="b"})')).toBe(
      "{}",
    );
    expect(await absentAnswer('absent(nonexistent{job="a", job="a"})')).toBe(
      "{}",
    );
    expect(
      await absentAnswer('absent(nonexistent{job="a", job!="b", job="c"})'),
    ).toBe("{}");
  });

  test("parentheses around the selector are read through", async () => {
    expect(await absentAnswer('absent((nonexistent{job="a"}))')).toBe(
      '{job="a"}',
    );
    expect(
      await absentAnswer('absent_over_time((nonexistent{job="a"}[5m]))'),
    ).toBe('{job="a"}');
  });

  test("the metric name, __type__ and __unit__ are never named", async () => {
    expect(
      await absentAnswer('absent({__name__="nonexistent", job="a"})'),
    ).toBe('{job="a"}');
    expect(
      await absentAnswer('absent(nonexistent{__type__="counter", job="a"})'),
    ).toBe('{job="a"}');
    expect(
      await absentAnswer('absent(nonexistent{__unit__="seconds", job="a"})'),
    ).toBe('{job="a"}');
  });

  test("a selector that finds series answers nothing", async () => {
    expect(await absentAnswer("absent(tie)")).toBeNull();
    expect(await absentAnswer('absent(tie{g="1", g!="2"})')).toBeNull();
    expect(await absentAnswer('absent(tie{g!="2", g="1"})')).toBeNull();
    expect(await absentAnswer("absent_over_time(tie[5m])")).toBeNull();
  });

  // Every query here was asked of Prometheus 3.16.0, and answered so.
  test.each([
    ['absent(nonexistent{job="a", job!="b"})', "{}"],
    ['absent(nonexistent{job!="b", job="a"})', "{}"],
    ['absent(nonexistent{job="a", job=~"a"})', "{}"],
    ['absent(nonexistent{job=~"a", job="a"})', '{job="a"}'],
    ['absent(nonexistent{job="a", job!~"b"})', "{}"],
    ['absent(nonexistent{job!~"b", job="a"})', "{}"],
    ['absent(nonexistent{job="a", job="a"})', "{}"],
    ['absent(nonexistent{job="a", job="b"})', "{}"],
    ['absent(nonexistent{job!="x", job="a", job="b"})', "{}"],
    ['absent(nonexistent{job="a", job!="b", job="c"})', "{}"],
    ['absent(nonexistent{job=~"x", job!~"y", job="a"})', "{}"],
    ['absent(nonexistent{job="", job="a"})', "{}"],
    ['absent(nonexistent{job="a", job=""})', "{}"],
    ['absent(nonexistent{job="", instance="i"})', '{instance="i"}'],
    ['absent(nonexistent{job="a", job!=""})', "{}"],
    ['absent(nonexistent{job!="", job="a"})', '{job="a"}'],
    [
      'absent(nonexistent{job="a", instance!="x", instance="i", env="p", env=~"p", zone=~"z", zone="z"})',
      '{job="a", zone="z"}',
    ],
    [
      'absent(nonexistent{a="1", b!="2", c=~"3", d!~"4", e="5"})',
      '{a="1", e="5"}',
    ],
    ['absent(nonexistent{job=~"a|b"})', "{}"],
    ['absent({__name__="nonexistent", job="a"})', '{job="a"}'],
    ['absent({__name__=~"nonexist.*", job="a", job!="b"})', "{}"],
    ['absent(nonexistent{__type__="counter", job="a"})', '{job="a"}'],
    ['absent(nonexistent{__unit__="seconds", job="a"})', '{job="a"}'],
    ['absent((nonexistent{job="a"}))', '{job="a"}'],
    ['absent(((nonexistent{job="a", job!="b"})))', "{}"],
    ['absent(((nonexistent{job!="b", job="a"})))', "{}"],
    ['absent(nonexistent{job="a"} offset 5m)', '{job="a"}'],
    ['absent(nonexistent{job="a", job!="b"} @ 100)', "{}"],
    ['absent(-nonexistent{job="a"})', "{}"],
    ['absent(sum(nonexistent{job="a"}))', "{}"],
    ['absent(tie{g="1", g!="2"})', null],
    ['absent(tie{g!="2", g="1"})', null],
    ['absent(tie{g="1", g!="1"})', "{}"],
    ['absent(tie{g!="1", g="1"})', "{}"],
    ['absent_over_time(nonexistent{job="a", job!="b"}[5m])', "{}"],
    ['absent_over_time(nonexistent{job!="b", job="a"}[5m])', "{}"],
    [
      'absent_over_time(nonexistent{job="a", job=~"a", instance="i"}[5m])',
      '{instance="i"}',
    ],
    ['absent_over_time(nonexistent{job="a"}[5m:1m])', "{}"],
    ['absent_over_time((nonexistent{job="a"}[5m]))', '{job="a"}'],
    ['absent_over_time(tie{g="1", g!="2"}[5m])', null],
    ['absent(nonexistent{job=~"a|", job="a"})', '{job="a"}'],
    ['absent(nonexistent{job!~"", job="a"})', '{job="a"}'],
    ['absent(nonexistent{job!~"a|", job="a"})', '{job="a"}'],
    ['absent(nonexistent{job=~".*", job="a"})', '{job="a"}'],
    ['absent(nonexistent{job!="b", job=~".+", job="a"})', "{}"],
    ['absent(nonexistent{env!="x", job="a"})', '{job="a"}'],
    ['absent(nonexistent{env=~".*", job="a"})', '{job="a"}'],
    ['absent(nonexistent{env=~".*", env="e", job="a"})', '{env="e", job="a"}'],
    ['absent(nonexistent{job="a", job="a", instance="i"})', '{instance="i"}'],
    ['absent(nonexistent{job=""})', "{}"],
    ['absent(nonexistent{job!="x", job!="y", job="a"})', "{}"],
    ['absent(nonexistent{job=~"a", job=~"b"})', "{}"],
    ['absent(nonexistent{job!="b"})', "{}"],
    ['absent({job="a", job!="b"})', "{}"],
    ['absent({job!="b", job="a"})', "{}"],
    [
      'absent({job!="b", job="a", instance=~"i.*", instance="i1"})',
      '{instance="i1"}',
    ],
    ['absent(nonexistent{job="a", job!~"a"})', "{}"],
    ['absent(nonexistent{job!~"a", job="a"})', "{}"],
    ['absent(nonexistent{job=~"(?i)A", job="a"})', '{job="a"}'],
    ['absent(nonexistent{job="a", job=~"(?i)A"})', "{}"],
    ['absent(nonexistent{job!~".*", job="a"})', '{job="a"}'],
    ['absent(nonexistent{job!="", job!~"z", job="a"})', "{}"],
    ["absent(nonexistent)", "{}"],
    ["absent(tie)", null],
    ['absent(tie{g="9"})', '{g="9"}'],
    ['absent(tie{g!="9", g="9"})', "{}"],
    ["absent_over_time(tie[5m])", null],
    [
      'absent_over_time(nonexistent{job!="b", job="a", instance="i"}[5m] offset 1m)',
      '{instance="i"}',
    ],
  ] as Array<[string, string | null]>)(
    "%s answers %s, as Prometheus does",
    async (query: string, expected: string | null) => {
      expect(await absentAnswer(query)).toBe(expected);
    },
  );

  test("a range query names the same labels at every step", async () => {
    const result: PromQLQueryResult = await new PromQLEngine(
      new MemorySource(ALL),
    ).rangeQuery(
      'absent(nonexistent{job!="b", job="a", instance="i", zone=~"z", zone="z"})',
      QUERY_MS - 120 * 1000,
      QUERY_MS,
      60 * 1000,
    );

    if (result.resultType !== PromQLResultType.Matrix) {
      throw new Error(`Expected a matrix, got ${result.resultType}.`);
    }

    expect(
      result.series.map((series: PromQLMatrixResultSeries): string => {
        return `${formatPromQLLabels(series.labels)} x${series.points.length}`;
      }),
    ).toEqual(['{instance="i", zone="z"} x3']);
  });
});

describe("sort_by_label() and sort_by_label_desc() sort as Prometheus sorts", () => {
  const TIE_ORDER: Array<string> = [
    'tie{g="0", v="~"}',
    'tie{g="0", v="�"}',
    'tie{g="0", v="\u{1F600}"}',
    'tie{A="1", g="1"}',
    'tie{a="z", g="1"}',
    'tie{b="a", g="1"}',
    'tie{g="1"}',
    'tie{g="1", h="x"}',
    'tie{g="1", i="x"}',
    'tie{g="1", i="xy"}',
    'tie{g="2", instance="a", job="x"}',
    'tie{g="2", instance="a", job="y"}',
    'tie{g="2", instance="b", job="x"}',
  ];

  test("series equal on the label sorted by come in the order of their whole label sets (the issue's second case)", async () => {
    expect(await order('sort_by_label(tie, "g")')).toEqual(TIE_ORDER);
    expect(await order('sort_by_label(tie, "g", "g")')).toEqual(TIE_ORDER);
  });

  test("sort_by_label_desc gives the same order backwards, its ties included", async () => {
    expect(await order('sort_by_label_desc(tie, "g")')).toEqual(
      [...TIE_ORDER].reverse(),
    );
  });

  test("a label no series has leaves the whole label sets to decide", async () => {
    const byLabelSet: Array<string> = [
      'tie{A="1", g="1"}',
      'tie{a="z", g="1"}',
      'tie{b="a", g="1"}',
      'tie{g="0", v="~"}',
      'tie{g="0", v="�"}',
      'tie{g="0", v="\u{1F600}"}',
      'tie{g="1"}',
      'tie{g="1", h="x"}',
      'tie{g="1", i="x"}',
      'tie{g="1", i="xy"}',
      'tie{g="2", instance="a", job="x"}',
      'tie{g="2", instance="a", job="y"}',
      'tie{g="2", instance="b", job="x"}',
    ];

    expect(await order('sort_by_label(tie, "nolabel")')).toEqual(byLabelSet);
    expect(await order('sort_by_label_desc(tie, "nolabel")')).toEqual(
      [...byLabelSet].reverse(),
    );
  });

  test("ties on one label are broken by the whole label set, not by the input order", async () => {
    expect(await order('sort_by_label(tie{g="2"}, "job")')).toEqual([
      'tie{g="2", instance="a", job="x"}',
      'tie{g="2", instance="b", job="x"}',
      'tie{g="2", instance="a", job="y"}',
    ]);
    expect(await order('sort_by_label_desc(tie{g="2"}, "job")')).toEqual([
      'tie{g="2", instance="a", job="y"}',
      'tie{g="2", instance="b", job="x"}',
      'tie{g="2", instance="a", job="x"}',
    ]);
  });

  test("values sort in natsort's natural order: numbers as numbers, text by its bytes", async () => {
    const expected: Array<string> = NATURAL_ORDER.map((v: string): string => {
      return formatPromQLLabels({ __name__: "nat", v });
    });

    expect(await order('sort_by_label(nat, "v")')).toEqual(expected);
    expect(await order('sort_by_label_desc(nat, "v")')).toEqual(
      [...expected].reverse(),
    );
  });

  test("a run of digits past int64 sorts as text, as natsort sorts it", async () => {
    expect(await order('sort_by_label(ovf, "v")')).toEqual([
      'ovf{v="10000000000000000000000"}',
      'ovf{v="5"}',
    ]);
    expect(await order('sort_by_label(ovf2, "v")')).toEqual([
      'ovf2{v="9223372036854775808"}',
      'ovf2{v="95"}',
    ]);
    expect(await order('sort_by_label(ovf3, "v")')).toEqual([
      'ovf3{v="95"}',
      'ovf3{v="9223372036854775807"}',
    ]);
  });

  test.each(BIG_ORDERS)(
    "%s sorts many series as Prometheus does",
    async (query: string, places: Array<number>) => {
      const expected: Array<string> = places.map((place: number): string => {
        return formatPromQLLabels(BIG[place]!.labels);
      });

      expect(await order(query)).toEqual(expected);
    },
  );

  test("gives the same order whatever order the series come in", async () => {
    const random: SeededRandom = seededRandom(8027);

    for (let round: number = 0; round < 10; round++) {
      const data: Array<TestSeries> = shuffled(ALL, random);

      for (const [query, places] of BIG_ORDERS) {
        expect(await orderOver(data, query)).toEqual(
          places.map((place: number): string => {
            return formatPromQLLabels(BIG[place]!.labels);
          }),
        );
      }

      expect(await orderOver(data, 'sort_by_label(tie, "g")')).toEqual(
        TIE_ORDER,
      );
    }
  });

  test("an empty vector sorts to an empty vector", async () => {
    expect(await order('sort_by_label(nonexistent, "v")')).toEqual([]);
    expect(await order('sort_by_label_desc(nonexistent, "v")')).toEqual([]);
  });

  /*
   * natsort answers false both ways round for "" and any other value, so
   * Prometheus' order for a series without the label is the order the series
   * came in, with Go's sort. From its TSDB, Prometheus 3.16.0 answered
   * gap{i="2", k="a"}, gap{i="1", k="b"}, gap{i="3"}, gap{i="4", k="c"}
   * here, and gap{i="4", k="c"}, gap{i="3"}, gap{i="1", k="b"},
   * gap{i="2", k="a"} for sort_by_label_desc: in each, the series without the
   * label stayed in place, and a series stored before or after it would move
   * it. OneUptime puts it first, as "" sorts before any other text, and last
   * descending.
   */
  test("a series without the label comes first, and last descending, whatever order the series come in", async () => {
    const ascending: Array<string> = [
      'gap{i="3"}',
      'gap{i="2", k="a"}',
      'gap{i="1", k="b"}',
      'gap{i="4", k="c"}',
    ];

    for (let seed: number = 1; seed <= 10; seed++) {
      const data: Array<TestSeries> = shuffled(GAP, seededRandom(seed));

      expect(await orderOver(data, 'sort_by_label(gap, "k")')).toEqual(
        ascending,
      );
      expect(await orderOver(data, 'sort_by_label_desc(gap, "k")')).toEqual(
        [...ascending].reverse(),
      );
    }
  });

  /*
   * natsort answers true both ways round for "01" and "1". Prometheus 3.16.0
   * answered 001, 01, 1, 2 here, and the reverse descending: the order of
   * their text, which is OneUptime's for any input order.
   */
  test("values natsort cannot tell apart, such as 01 and 1, sort by their text", async () => {
    const ascending: Array<string> = [
      'zeros{i="3", k="001"}',
      'zeros{i="2", k="01"}',
      'zeros{i="1", k="1"}',
      'zeros{i="4", k="2"}',
    ];

    for (let seed: number = 1; seed <= 10; seed++) {
      const data: Array<TestSeries> = shuffled(ZEROS, seededRandom(seed));

      expect(await orderOver(data, 'sort_by_label(zeros, "k")')).toEqual(
        ascending,
      );
      expect(await orderOver(data, 'sort_by_label_desc(zeros, "k")')).toEqual(
        [...ascending].reverse(),
      );
    }
  });

  test("keeps each sample's value and metric name", async () => {
    const result: PromQLQueryResult = await instantOver(
      TIE,
      'sort_by_label(tie{g="2"}, "instance")',
    );

    expect(
      result.resultType === PromQLResultType.Vector
        ? result.samples.map((sample: PromQLVectorResultSample): string => {
            return `${formatPromQLLabels(sample.labels)} ${sample.value}`;
          })
        : [],
    ).toEqual([
      'tie{g="2", instance="a", job="x"} 1',
      'tie{g="2", instance="a", job="y"} 1',
      'tie{g="2", instance="b", job="x"} 1',
    ]);
  });
});
