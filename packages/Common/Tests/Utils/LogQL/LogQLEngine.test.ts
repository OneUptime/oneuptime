import LogQLEngine, {
  LogQLBucketCount,
  LogQLBucketsRequest,
  LogQLDirection,
  LogQLLinesRequest,
  LogQLLogRow,
  LogQLLogSource,
  LogQLResult,
  LogQLSamplesRequest,
  LogQLStream,
  ceilingMilliseconds,
  sourceLineFilters,
} from "../../../Utils/LogQL/LogQLEngine";
import { LogQLStage } from "../../../Utils/LogQL/LogQLAst";
import { LogQLPipeline } from "../../../Utils/LogQL/LogQLPipeline";
import {
  PromQLMatrixResultSeries,
  PromQLResultType,
  PromQLVectorResultSample,
} from "../../../Utils/PromQL/PromQLEngineTypes";
import PromQLError from "../../../Utils/PromQL/PromQLError";
import {
  PromQLLabels,
  formatPromQLLabels,
  promQLLabelsKey,
} from "../../../Utils/PromQL/PromQLLabels";
import { describe, expect, test } from "@jest/globals";

/*
 * LogQL evaluated as Loki evaluates it (issue #7700), over logs held here.
 * Every expected value is worked out by hand from the logs below and
 * Loki's own rules: a range aggregation at time t reads the logs after
 * t - range up to and with t; a log query reads from its start, with it,
 * up to its end, without it; rate is per second; the unwrapped label is
 * taken off a series' labels; a metric query refuses a log with an error
 * left on it.
 */

const T0_MS: number = Date.UTC(2026, 10, 20, 10, 0, 0);

const nanoseconds: (secondsAfterT0: number, extraNs: number) => string = (
  secondsAfterT0: number,
  extraNs: number,
): string => {
  return (
    BigInt(T0_MS + secondsAfterT0 * 1000) * BigInt(1000000) +
    BigInt(extraNs)
  ).toString();
};

const log: (
  secondsAfterT0: number,
  labels: PromQLLabels,
  line: string,
  extraNs?: number,
) => LogQLLogRow = (
  secondsAfterT0: number,
  labels: PromQLLabels,
  line: string,
  extraNs: number = 0,
): LogQLLogRow => {
  return { timeNs: nanoseconds(secondsAfterT0, extraNs), labels, line };
};

const API: PromQLLabels = { job: "api", env: "prod" };
const WEB: PromQLLabels = { job: "web", env: "prod" };

const LOGS: Array<LogQLLogRow> = [
  log(5, API, "level=info route=/a status=200 latency=0.1 took=100ms"),
  log(15, API, "level=error route=/a status=500 latency=0.9 took=900ms"),
  log(25, API, "level=info route=/b status=200 latency=0.3 took=300ms"),
  log(45, API, "level=error route=/b status=503 latency=1.2 took=1.2s"),
  log(60, API, "level=info route=/a status=200 latency=0.2 took=200ms"),
  log(75, API, "level=warn route=/a status=429 latency=0.4 took=400ms"),
  log(90, API, "level=error route=/a status=500 latency=0.6 took=600ms"),
  log(
    10,
    WEB,
    '{"level":"info","req":{"method":"GET","path":"/"},"status":200}',
  ),
  log(
    50,
    WEB,
    '{"level":"error","req":{"method":"POST","path":"/login"},"status":500}',
  ),
  log(55, WEB, "not json"),
];

/*
 * Logs held in memory, read the way a source must: what the selector's
 * matchers and its source line filters keep, in the range, in the order
 * and up to the limit asked for.
 */
class HeldLogs implements LogQLLogSource {
  public readonly rows: Array<LogQLLogRow>;
  public readonly linesRequests: Array<LogQLLinesRequest> = [];
  public countBuckets:
    | ((request: LogQLBucketsRequest) => Promise<{
        groups: Array<LogQLBucketCount>;
        reachedLimit: boolean;
      }>)
    | undefined;

  public constructor(rows: Array<LogQLLogRow>, countsAtSource: boolean) {
    this.rows = rows;
    this.countBuckets = countsAtSource
      ? (request: LogQLBucketsRequest) => {
          return this.count(request);
        }
      : undefined;
  }

  private kept(selector: LogQLLinesRequest["selector"]): Array<LogQLLogRow> {
    const pipeline: LogQLPipeline = new LogQLPipeline({
      kind: "LogSelector",
      matchers: selector.matchers,
      stages: sourceLineFilters(selector) as Array<LogQLStage>,
    });

    return this.rows.filter((row: LogQLLogRow): boolean => {
      return pipeline.run({ line: row.line, labels: row.labels }) !== null;
    });
  }

  public async readLines(request: LogQLLinesRequest): Promise<{
    rows: Array<LogQLLogRow>;
    reachedLimit: boolean;
  }> {
    this.linesRequests.push(request);
    const rows: Array<LogQLLogRow> = this.kept(request.selector)
      .filter((row: LogQLLogRow): boolean => {
        const at: bigint = BigInt(row.timeNs);
        return at >= request.startNs && at < request.endNs;
      })
      .sort((a: LogQLLogRow, b: LogQLLogRow): number => {
        const order: number = BigInt(a.timeNs) < BigInt(b.timeNs) ? -1 : 1;
        return request.direction === LogQLDirection.Forward ? order : -order;
      });

    return {
      rows: rows.slice(0, request.limit),
      reachedLimit: rows.length > request.limit,
    };
  }

  public async readSamples(request: LogQLSamplesRequest): Promise<{
    rows: Array<LogQLLogRow>;
    reachedLimit: boolean;
  }> {
    const rows: Array<LogQLLogRow> = this.kept(request.selector).filter(
      (row: LogQLLogRow): boolean => {
        const at: bigint = BigInt(row.timeNs);
        return at > request.startNs && at <= request.endNs;
      },
    );

    return { rows: rows.slice(0, request.limit), reachedLimit: false };
  }

  private async count(request: LogQLBucketsRequest): Promise<{
    groups: Array<LogQLBucketCount>;
    reachedLimit: boolean;
  }> {
    const groups: Map<string, LogQLBucketCount> = new Map();

    for (const row of this.kept(request.selector)) {
      const at: bigint = BigInt(row.timeNs);

      if (at <= request.originNs || at > request.endNs) {
        continue;
      }

      const bucket: number =
        Number((at - request.originNs - BigInt(1)) / request.bucketNs) + 1;
      const labels: PromQLLabels = {};

      for (const name of Object.keys(row.labels)) {
        if (!request.labels || request.labels.includes(name)) {
          labels[name] = row.labels[name]!;
        }
      }

      const key: string = `${bucket}:${promQLLabelsKey(labels)}`;
      const group: LogQLBucketCount = groups.get(key) || {
        labels,
        bucket,
        count: 0,
        bytes: 0,
      };
      group.count++;
      group.bytes += Buffer.byteLength(row.line, "utf8");
      groups.set(key, group);
    }

    return { groups: Array.from(groups.values()), reachedLimit: false };
  }
}

const vectorAt: (
  query: string,
  secondsAfterT0: number,
  countsAtSource?: boolean,
) => Promise<Record<string, number>> = async (
  query: string,
  secondsAfterT0: number,
  countsAtSource: boolean = true,
): Promise<Record<string, number>> => {
  const result: LogQLResult = await new LogQLEngine(
    new HeldLogs(LOGS, countsAtSource),
  ).instantQuery({ query, timeMs: T0_MS + secondsAfterT0 * 1000 });

  if (
    result.resultType !== "metric" ||
    result.result.resultType !== PromQLResultType.Vector
  ) {
    throw new Error("not a vector");
  }

  const samples: Record<string, number> = {};

  for (const sample of result.result
    .samples as Array<PromQLVectorResultSample>) {
    samples[formatPromQLLabels(sample.labels)] = sample.value;
  }

  return samples;
};

const streamsOf: (result: LogQLResult) => Array<LogQLStream> = (
  result: LogQLResult,
): Array<LogQLStream> => {
  if (result.resultType !== "streams") {
    throw new Error("not streams");
  }

  return result.streams;
};

describe("range aggregations, at one time", () => {
  test.each([true, false])(
    "count_over_time counts the logs after t - range, up to and with t (counted at the source: %s)",
    async (countsAtSource: boolean) => {
      // (10:00:00, 10:01:00]: the api's logs at 5, 15, 25, 45 and 60 seconds.
      expect(
        await vectorAt('count_over_time({job="api"}[1m])', 60, countsAtSource),
      ).toEqual({ '{env="prod", job="api"}': 5 });
    },
  );

  test.each([true, false])(
    "a line filter counts the lines that hold it (counted at the source: %s)",
    async (countsAtSource: boolean) => {
      expect(
        await vectorAt(
          'count_over_time({job="api"} |= "level=error" [1m])',
          60,
          countsAtSource,
        ),
      ).toEqual({ '{env="prod", job="api"}': 2 });
      expect(
        await vectorAt(
          'count_over_time({env="prod"} |~ "status=5\\\\d\\\\d" != "503" [1m])',
          60,
          countsAtSource,
        ),
      ).toEqual({ '{env="prod", job="api"}': 1 });
    },
  );

  test.each([true, false])(
    "rate is per second, bytes_over_time and bytes_rate count the lines' bytes (counted at the source: %s)",
    async (countsAtSource: boolean) => {
      const bytes: number = LOGS.slice(0, 5).reduce(
        (sum: number, row: LogQLLogRow): number => {
          return sum + Buffer.byteLength(row.line, "utf8");
        },
        0,
      );

      expect(
        await vectorAt('rate({job="api"}[1m])', 60, countsAtSource),
      ).toEqual({ '{env="prod", job="api"}': 5 / 60 });
      expect(
        await vectorAt('bytes_over_time({job="api"}[1m])', 60, countsAtSource),
      ).toEqual({ '{env="prod", job="api"}': bytes });
      expect(
        await vectorAt('bytes_rate({job="api"}[1m])', 60, countsAtSource),
      ).toEqual({ '{env="prod", job="api"}': bytes / 60 });
    },
  );

  test("the window is open at its start and closed at its end, to the nanosecond", async () => {
    const engine: LogQLEngine = new LogQLEngine(
      new HeldLogs(
        [
          log(0, API, "at the start, out"),
          log(0, API, "a nanosecond after the start, in", 1),
          log(60, API, "at the end, in"),
          log(60, API, "a nanosecond after the end, out", 1),
        ],
        false,
      ),
    );
    const result: LogQLResult = await engine.instantQuery({
      query: 'count_over_time({job="api"}[1m])',
      timeMs: T0_MS + 60000,
    });

    expect(
      result.resultType === "metric" &&
        result.result.resultType === PromQLResultType.Vector
        ? result.result.samples.map((sample: PromQLVectorResultSample) => {
            return sample.value;
          })
        : [],
    ).toEqual([2]);
    expect(ceilingMilliseconds(nanoseconds(60, 1))).toBe(T0_MS + 60001);
    expect(ceilingMilliseconds(nanoseconds(60, 0))).toBe(T0_MS + 60000);
  });

  test("sum by a parsed label adds each label set's counts", async () => {
    expect(
      await vectorAt(
        'sum by (level) (count_over_time({job="api"} | logfmt [1m]))',
        60,
      ),
    ).toEqual({ '{level="error"}': 2, '{level="info"}': 3 });
  });

  test("offset moves the window back", async () => {
    // At 90s, offset 30s: (0, 60], the same five logs as at 60s.
    expect(
      await vectorAt('count_over_time({job="api"}[1m] offset 30s)', 90),
    ).toEqual({ '{env="prod", job="api"}': 5 });
  });

  test("absent_over_time is 1 for nothing, named by the selector", async () => {
    expect(await vectorAt('absent_over_time({job="nope"}[1m])', 60)).toEqual({
      '{job="nope"}': 1,
    });
    expect(await vectorAt('absent_over_time({job="api"}[1m])', 60)).toEqual({});
  });

  test("topk and binary operators are PromQL's", async () => {
    expect(
      await vectorAt(
        'topk(1, sum by (job) (count_over_time({env="prod"}[1m])))',
        60,
      ),
    ).toEqual({ '{job="api"}': 5 });
    // 2 errors in 5 lines.
    expect(
      await vectorAt(
        'sum(count_over_time({job="api"} |= "level=error" [1m])) / sum(count_over_time({job="api"}[1m]))',
        60,
      ),
    ).toEqual({ "{}": 0.4 });
    expect(
      await vectorAt('sum(count_over_time({job="nope"}[1m])) or vector(0)', 60),
    ).toEqual({ "{}": 0 });
  });
});

describe("unwrapped range aggregations", () => {
  test("sum_over_time of a logfmt field, by route", async () => {
    // /a: 0.1 + 0.9 + 0.2; /b: 0.3 + 1.2.
    const samples: Record<string, number> = await vectorAt(
      'sum by (route) (sum_over_time({job="api"} | logfmt | unwrap latency [1m]))',
      60,
    );

    expect(samples['{route="/a"}']).toBeCloseTo(1.2, 12);
    expect(samples['{route="/b"}']).toBeCloseTo(1.5, 12);
  });

  test("avg_over_time of a duration, grouped in the range aggregation", async () => {
    // /a: (0.1 + 0.9 + 0.2) / 3; /b: (0.3 + 1.2) / 2.
    const samples: Record<string, number> = await vectorAt(
      'avg_over_time({job="api"} | logfmt | unwrap duration(took) [1m]) by (route)',
      60,
    );

    expect(samples['{route="/a"}']).toBeCloseTo(0.4, 12);
    expect(samples['{route="/b"}']).toBeCloseTo(0.75, 12);
  });

  test("quantile_over_time, min, max, first and last, as Prometheus computes them", async () => {
    // 0.1, 0.9, 0.3, 1.2, 0.2 in time order; sorted the median is 0.3.
    expect(
      await vectorAt(
        'quantile_over_time(0.5, {job="api"} | logfmt | unwrap latency [1m]) by (job)',
        60,
      ),
    ).toEqual({ '{job="api"}': 0.3 });

    for (const [operation, expected] of [
      ["min_over_time", 0.1],
      ["max_over_time", 1.2],
      ["first_over_time", 0.1],
      ["last_over_time", 0.2],
    ] as Array<[string, number]>) {
      expect(
        await vectorAt(
          `${operation}({job="api"} | logfmt | unwrap latency [1m]) by (job)`,
          60,
        ),
      ).toEqual({ '{job="api"}': expected });
    }
  });

  test("the unwrapped label leaves the series' labels", async () => {
    const samples: Record<string, number> = await vectorAt(
      'sum_over_time({job="api"} | logfmt | keep job, latency | unwrap latency [1m])',
      60,
    );

    expect(samples['{job="api"}']).toBeCloseTo(2.7, 12);
  });

  test("a log a parser could not read fails the query, as Loki's does", async () => {
    await expect(
      vectorAt(
        'sum(sum_over_time({job="web"} | json | unwrap status [1m]))',
        60,
      ),
    ).rejects.toThrow(
      /^pipeline error: 'JSONParserErr' for series: .* Use a label filter to intentionally skip this error/,
    );
  });

  test("a filter after the parser, or after the unwrap, leaves such logs out", async () => {
    expect(
      await vectorAt(
        'sum(sum_over_time({job="web"} | json | __error__="" | unwrap status [1m]))',
        60,
      ),
    ).toEqual({ "{}": 700 });
    expect(
      await vectorAt(
        'sum(sum_over_time({job="web"} | json | unwrap status | __error__="" [1m]))',
        60,
      ),
    ).toEqual({ "{}": 700 });
  });
});

describe("a metric query over a range", () => {
  test.each([true, false])(
    "each step's window, the same counted at the source or here (%s)",
    async (countsAtSource: boolean) => {
      const result: LogQLResult = await new LogQLEngine(
        new HeldLogs(LOGS, countsAtSource),
      ).rangeQuery({
        query: 'count_over_time({job="api"}[1m])',
        startMs: T0_MS + 30000,
        endMs: T0_MS + 90000,
        stepMs: 30000,
        limit: 100,
        direction: LogQLDirection.Backward,
      });

      expect(result.resultType).toBe("metric");

      const series: Array<PromQLMatrixResultSeries> =
        result.resultType === "metric" &&
        result.result.resultType === PromQLResultType.Matrix
          ? result.result.series
          : [];

      // 30s: 5, 15, 25. 60s: 5 .. 60. 90s: 45, 60, 75, 90.
      expect(series).toHaveLength(1);
      expect(series[0]!.points).toEqual([
        { timestampMs: T0_MS + 30000, value: 3 },
        { timestampMs: T0_MS + 60000, value: 5 },
        { timestampMs: T0_MS + 90000, value: 4 },
      ]);
    },
  );

  test("a step whose window holds nothing has no point", async () => {
    const result: LogQLResult = await new LogQLEngine(
      new HeldLogs(LOGS, true),
    ).rangeQuery({
      query: 'count_over_time({job="web"}[10s])',
      startMs: T0_MS + 10000,
      endMs: T0_MS + 60000,
      stepMs: 10000,
      limit: 100,
      direction: LogQLDirection.Backward,
    });

    const series: Array<PromQLMatrixResultSeries> =
      result.resultType === "metric" &&
      result.result.resultType === PromQLResultType.Matrix
        ? result.result.series
        : [];

    // Web's logs at 10, 50 and 55 seconds: windows ending 10, 50 and 60.
    expect(
      series[0]!.points.map((point: { timestampMs: number }): number => {
        return (point.timestampMs - T0_MS) / 1000;
      }),
    ).toEqual([10, 50, 60]);
  });

  test("more series than allowed are refused in Loki's words", async () => {
    await expect(
      new LogQLEngine(new HeldLogs(LOGS, true), { maxSeries: 1 }).instantQuery({
        query: 'count_over_time({env="prod"}[1m])',
        timeMs: T0_MS + 60000,
      }),
    ).rejects.toThrow("maximum of series (1) reached for a single query");
  });

  test("too many steps are refused in Loki's words", async () => {
    await expect(
      new LogQLEngine(new HeldLogs(LOGS, true)).rangeQuery({
        query: 'count_over_time({env="prod"}[1m])',
        startMs: T0_MS,
        endMs: T0_MS + 12000 * 1000,
        stepMs: 1000,
        limit: 100,
        direction: LogQLDirection.Backward,
      }),
    ).rejects.toThrow(
      "exceeded maximum resolution of 11,000 points per timeseries",
    );
  });

  test("a read over its line limit is refused, never cut short", async () => {
    await expect(
      new LogQLEngine(new HeldLogs(LOGS, false), {
        maxSampleLines: 3,
      }).instantQuery({
        query: 'count_over_time({job="api"} | logfmt [1m])',
        timeMs: T0_MS + 60000,
      }),
    ).rejects.toThrow("the query reads more than 3 log lines");
  });
});

describe("a log query", () => {
  const run: (
    query: string,
    direction: LogQLDirection,
    limit: number,
    source?: HeldLogs,
  ) => Promise<Array<LogQLStream>> = async (
    query: string,
    direction: LogQLDirection,
    limit: number,
    source: HeldLogs = new HeldLogs(LOGS, true),
  ): Promise<Array<LogQLStream>> => {
    return streamsOf(
      await new LogQLEngine(source).rangeQuery({
        query,
        startMs: T0_MS,
        endMs: T0_MS + 120000,
        stepMs: 15000,
        limit,
        direction,
      }),
    );
  };

  test("newest first by default, up to the limit, in one stream per label set", async () => {
    expect(
      await run('{job="api"} |= "level=error"', LogQLDirection.Backward, 2),
    ).toEqual([
      {
        labels: API,
        values: [
          [
            nanoseconds(90, 0),
            "level=error route=/a status=500 latency=0.6 took=600ms",
          ],
          [
            nanoseconds(45, 0),
            "level=error route=/b status=503 latency=1.2 took=1.2s",
          ],
        ],
      },
    ]);
  });

  test("oldest first going forward", async () => {
    const streams: Array<LogQLStream> = await run(
      '{job="api"} |= "level=error"',
      LogQLDirection.Forward,
      2,
    );

    expect(
      streams[0]!.values.map((value: [string, string]): string => {
        return value[0];
      }),
    ).toEqual([nanoseconds(15, 0), nanoseconds(45, 0)]);
  });

  test("json's fields are labels, nested ones joined with _, and filter the lines", async () => {
    expect(
      await run(
        '{job="web"} | json | __error__="" | status >= 500',
        LogQLDirection.Backward,
        100,
      ),
    ).toEqual([
      {
        labels: {
          ...WEB,
          level: "error",
          req_method: "POST",
          req_path: "/login",
          status: "500",
        },
        values: [
          [
            nanoseconds(50, 0),
            '{"level":"error","req":{"method":"POST","path":"/login"},"status":500}',
          ],
        ],
      },
    ]);
  });

  test("a line a parser cannot read keeps the error on it, to be filtered", async () => {
    const withErrors: Array<LogQLStream> = await run(
      '{job="web"} | json | status > 100',
      LogQLDirection.Backward,
      100,
    );
    const errored: LogQLStream | undefined = withErrors.find(
      (stream: LogQLStream): boolean => {
        return stream.labels["__error__"] === "JSONParserErr";
      },
    );

    expect(withErrors).toHaveLength(3);
    expect(errored?.values).toEqual([[nanoseconds(55, 0), "not json"]]);
    expect(errored?.labels["__error_details__"]).toBeTruthy();
    expect(
      await run(
        '{job="web"} | json | __error__="" | status > 100',
        LogQLDirection.Backward,
        100,
      ),
    ).toHaveLength(2);
  });

  test("line_format rewrites each line from its labels", async () => {
    expect(
      await run(
        '{job="api"} | logfmt | level="warn" | line_format "{{.route}} took {{.took}}"',
        LogQLDirection.Backward,
        100,
      ),
    ).toEqual([
      {
        labels: {
          ...API,
          latency: "0.4",
          level: "warn",
          route: "/a",
          status: "429",
          took: "400ms",
        },
        values: [[nanoseconds(75, 0), "/a took 400ms"]],
      },
    ]);
  });

  test("a label filter past the source reads more lines than it answers", async () => {
    const source: HeldLogs = new HeldLogs(LOGS, true);

    await run(
      '{job="api"} | logfmt | level="warn"',
      LogQLDirection.Backward,
      1,
      source,
    );
    await run(
      '{job="api"} |= "level=warn"',
      LogQLDirection.Backward,
      1,
      source,
    );

    expect(source.linesRequests[0]!.limit).toBe(20000);
    expect(source.linesRequests[1]!.limit).toBe(1);
  });

  test("an instant log query is refused, as Loki refuses it", async () => {
    await expect(
      new LogQLEngine(new HeldLogs(LOGS, true)).instantQuery({
        query: '{job="api"}',
        timeMs: T0_MS,
      }),
    ).rejects.toThrow(
      "log queries are not supported as an instant query type, please change your query to a range query type",
    );
  });

  test("a bad query is a PromQLError, to be answered 400", async () => {
    await expect(
      run('{job="api"} | unknown_stage', LogQLDirection.Backward, 10),
    ).rejects.toThrow(PromQLError);
  });
});
