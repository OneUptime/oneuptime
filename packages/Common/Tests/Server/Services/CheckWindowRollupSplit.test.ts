import "../TestingUtils/Init";
import { MetricService } from "../../../Server/Services/MetricService";
import SpanService from "../../../Server/Services/SpanService";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import MinuteRollupRange, {
  MinuteRollupEdge,
  MinuteRollupSplit,
} from "../../../Server/Utils/AnalyticsDatabase/MinuteRollupRange";
import {
  METRIC_ROLLUP_BUCKET_FROM_RAW_ROWS,
  METRIC_ROLLUP_STATES_FROM_RAW_ROWS,
} from "../../../Server/Utils/AnalyticsDatabase/MetricRollupStates";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Span from "../../../Models/AnalyticsModels/Span";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import TelemetryCheckWindow from "../../../Types/Monitor/TelemetryCheckWindow";
import ObjectID from "../../../Types/ObjectID";
import { keyForHost } from "../../../Utils/Telemetry/EntityKey";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A LONG TELEMETRY CHECK READS ITS WHOLE MINUTES FROM THE ROLLUPS AND ONLY
 * ITS EDGES FROM THE RAW ROWS (issue #11373).
 *
 * Since #11334 a check's window holds its start and not its end, and a
 * one-minute rollup serves it whole only when both its ends are whole
 * minutes (CheckWindowRollupRouting). A check's window ends at its
 * monitor's own moment, so its ends almost never are, and every long
 * ungrouped check read its whole window from the raw rows: an ungrouped
 * Host check over the past hour read the hour's points of its metric.
 *
 * Now such a window is split (MinuteRollupRange.split): its whole minutes
 * from the rollup's buckets, the partial minute at each end from the raw
 * rows - from its start, up to its end - and the parts follow on, so each
 * record is read once and the one on the window's end by none. A metric
 * read rolls the edges' rows up into the states the rollups' views store
 * and merges the three parts as one rollup, at any bucket interval; a
 * span count adds the projection's count of the whole minutes to the
 * edges'; a span aggregate in minute buckets puts the edges' buckets
 * beside the projection's. TelemetryMonitorWindowEdgesClickhouse runs them
 * against a real ClickHouse.
 */

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;

const projectId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();

// A check due at a monitor's own moment: 11:00:07.123.
const DUE_AT: Date = new Date("2026-11-27T11:00:07.123Z");

function pastHour(): InBetween<Date> {
  return TelemetryCheckWindow.ofSeconds(3600, DUE_AT);
}

// The statement with its parameters written in, spaces collapsed.
function inline(statement: Statement): string {
  let text: string = statement.query;
  const params: Record<string, unknown> = statement.query_params as Record<
    string,
    unknown
  >;

  for (const [name, value] of Object.entries(params)) {
    const marker: string = `{${name}:`;

    for (
      let at: number = text.indexOf(marker);
      at !== -1;
      at = text.indexOf(marker)
    ) {
      const close: number = text.indexOf("}", at);
      text = text.slice(0, at) + JSON.stringify(value) + text.slice(close + 1);
    }
  }

  return text.split(/\s+/).join(" ").trim();
}

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("MinuteRollupRange.split", () => {
  test("an hour's window at a monitor's moment: its 59 whole minutes, and the partial minute at each end", () => {
    const split: MinuteRollupSplit | null = MinuteRollupRange.split(pastHour());

    expect(split).toEqual({
      start: new Date("2026-11-27T10:00:07.123Z"),
      wholeFrom: new Date("2026-11-27T10:01:00.000Z"),
      wholeTo: new Date("2026-11-27T11:00:00.000Z"),
      end: new Date("2026-11-27T11:00:07.123Z"),
    });
    expect(MinuteRollupRange.getEdges(split!)).toEqual([
      {
        from: new Date("2026-11-27T10:00:07.123Z"),
        to: new Date("2026-11-27T10:01:00.000Z"),
      },
      {
        from: new Date("2026-11-27T11:00:00.000Z"),
        to: new Date("2026-11-27T11:00:07.123Z"),
      },
    ]);
  });

  test("a range the rollup serves whole is not split: a chart's, both ends held, or a window of whole minutes", () => {
    expect(
      MinuteRollupRange.split(
        new InBetween<Date>(
          new Date("2026-11-27T10:00:07.123Z"),
          new Date("2026-11-27T11:00:07.123Z"),
        ),
      ),
    ).toBeNull();
    expect(
      MinuteRollupRange.split(
        TelemetryCheckWindow.from(
          new Date("2026-11-27T10:00:00.000Z"),
          new Date("2026-11-27T11:00:00.000Z"),
        ),
      ),
    ).toBeNull();
  });

  test("a window that holds no whole minute is read from the rows: a minute's at a monitor's moment, and shorter ones", () => {
    for (const seconds of [1, 30, 52, 60]) {
      expect(
        MinuteRollupRange.split(
          TelemetryCheckWindow.ofSeconds(seconds, DUE_AT),
        ),
      ).toBeNull();
    }
  });

  /*
   * Measured on a busy project (TelemetryMonitorLongWindowsClickhouse): a
   * shorter window's raw read is small already, and the split's reads of
   * its two edges read as much or a granule more.
   */
  test("a window shorter than half an hour is read from the rows: 2, 5, 15 and 29 minutes", () => {
    for (const minutes of [2, 5, 15, 29]) {
      expect(
        MinuteRollupRange.split(
          TelemetryCheckWindow.ofSeconds(minutes * 60, DUE_AT),
        ),
      ).toBeNull();
    }
  });

  test("a window of half an hour is split: its 29 whole minutes, and 53 s and 7 s of its edges", () => {
    const split: MinuteRollupSplit | null = MinuteRollupRange.split(
      TelemetryCheckWindow.ofSeconds(
        30 * 60,
        new Date("2026-11-27T10:30:07.000Z"),
      ),
    );

    expect(MinuteRollupRange.MIN_WINDOW_TO_SPLIT_MS).toBe(30 * MINUTE_MS);
    expect(split?.wholeFrom).toEqual(new Date("2026-11-27T10:01:00.000Z"));
    expect(split?.wholeTo).toEqual(new Date("2026-11-27T10:30:00.000Z"));
    expect(MinuteRollupSplit_edgesMs(split!)).toEqual([53000, 7000]);
  });

  test("a window with one whole end has one edge: the other", () => {
    const fromWhole: MinuteRollupSplit | null = MinuteRollupRange.split(
      TelemetryCheckWindow.from(
        new Date("2026-11-27T10:00:00.000Z"),
        new Date("2026-11-27T11:00:07.123Z"),
      ),
    );
    const toWhole: MinuteRollupSplit | null = MinuteRollupRange.split(
      TelemetryCheckWindow.from(
        new Date("2026-11-27T10:00:07.123Z"),
        new Date("2026-11-27T11:00:00.000Z"),
      ),
    );

    expect(MinuteRollupRange.getEdges(fromWhole!)).toEqual([
      {
        from: new Date("2026-11-27T11:00:00.000Z"),
        to: new Date("2026-11-27T11:00:07.123Z"),
      },
    ]);
    expect(MinuteRollupRange.getEdges(toWhole!)).toEqual([
      {
        from: new Date("2026-11-27T10:00:07.123Z"),
        to: new Date("2026-11-27T10:01:00.000Z"),
      },
    ]);
  });

  test("ends that crossed JSON as text are read; ends it cannot read are not split", () => {
    expect(
      MinuteRollupRange.split(
        new InBetween<string>(
          "2026-11-27T10:00:07.123Z",
          "2026-11-27T11:00:07.123Z",
          { includesEnd: false },
        ),
      )?.wholeFrom,
    ).toEqual(new Date("2026-11-27T10:01:00.000Z"));
    expect(
      MinuteRollupRange.split(
        new InBetween<string>("not a date", "2026-11-27T11:00:07.123Z", {
          includesEnd: false,
        }),
      ),
    ).toBeNull();
  });

  /*
   * Over windows of many lengths and moments: every instant of a window is
   * in exactly one part, its end in none, and the parts are its whole
   * minutes and no more than a minute at each end.
   */
  test("every instant of a split window is in exactly one part, and its end in none", () => {
    const random: SeededRandom = seededRandom(11373);
    let windows: number = 0;

    for (let index: number = 0; index < 2000; index++) {
      const endMs: number =
        Date.UTC(2026, 10, 27, 10) + random(24 * 60 * MINUTE_MS);
      const lengthMs: number = 1 + random(4 * 60 * MINUTE_MS);
      const window: InBetween<Date> = TelemetryCheckWindow.from(
        new Date(endMs - lengthMs),
        new Date(endMs),
      );
      const split: MinuteRollupSplit | null = MinuteRollupRange.split(window);

      if (!split) {
        // Whole from the rollup, or too short a window to split.
        expect(
          MinuteRollupRange.canServe(window) ||
            lengthMs < MinuteRollupRange.MIN_WINDOW_TO_SPLIT_MS,
        ).toBe(true);
        continue;
      }

      windows++;

      const edges: Array<MinuteRollupEdge> = MinuteRollupRange.getEdges(split);
      const partsOf: (atMs: number) => number = (atMs: number): number => {
        const inWhole: boolean =
          atMs >= split.wholeFrom.getTime() && atMs < split.wholeTo.getTime();
        const inEdges: number = edges.filter(
          (edge: MinuteRollupEdge): boolean => {
            return atMs >= edge.from.getTime() && atMs < edge.to.getTime();
          },
        ).length;

        return (inWhole ? 1 : 0) + inEdges;
      };

      expect(split.wholeFrom.getTime() % MINUTE_MS).toBe(0);
      expect(split.wholeTo.getTime() % MINUTE_MS).toBe(0);

      for (const edge of edges) {
        expect(edge.to.getTime() - edge.from.getTime()).toBeLessThan(MINUTE_MS);
      }

      const startMs: number = window.startValue.getTime();
      const probes: Array<number> = [
        startMs,
        split.wholeFrom.getTime() - 1,
        split.wholeFrom.getTime(),
        split.wholeTo.getTime() - 1,
        split.wholeTo.getTime(),
        endMs - 1,
        startMs + random(lengthMs),
      ].filter((atMs: number): boolean => {
        return atMs >= startMs && atMs < endMs;
      });

      for (const atMs of probes) {
        expect({ atMs, parts: partsOf(atMs) }).toEqual({ atMs, parts: 1 });
      }

      expect(partsOf(endMs)).toBe(0);
      expect(partsOf(startMs - 1)).toBe(0);
    }

    // Most of the windows drawn are half an hour or more, at their own moment.
    expect(windows).toBeGreaterThan(1500);
  });
});

// The partial minutes of a split, as their lengths.
function MinuteRollupSplit_edgesMs(split: MinuteRollupSplit): Array<number> {
  return MinuteRollupRange.getEdges(split).map(
    (edge: MinuteRollupEdge): number => {
      return edge.to.getTime() - edge.from.getTime();
    },
  );
}

describe("a Metrics or infrastructure check's read of one metric over a long window", () => {
  let service: MetricService;

  beforeEach(() => {
    service = new MetricService();
  });

  const aggregateSql: (data: {
    time: InBetween<Date>;
    aggregationType?: AggregationType;
    attributes?: Record<string, string>;
  }) => string = (data: {
    time: InBetween<Date>;
    aggregationType?: AggregationType;
    attributes?: Record<string, string>;
  }): string => {
    const aggregateBy: AggregateBy<Metric> = {
      query: {
        projectId: projectId,
        name: "system.cpu.utilization",
        time: data.time,
        ...(data.attributes ? { attributes: data.attributes } : {}),
      } as AggregateBy<Metric>["query"],
      aggregationType: data.aggregationType || AggregationType.Avg,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: new Date(data.time.startValue),
      endTimestamp: new Date(data.time.endValue),
      limit: 10000,
      skip: 0,
      sort: { time: SortOrder.Ascending } as AggregateBy<Metric>["sort"],
      props: { isRoot: true },
    };

    return inline(service.toAggregateStatement(aggregateBy).statement);
  };

  test("reads its whole minutes from the one-minute rollup, its end left out", () => {
    const sql: string = aggregateSql({ time: pastHour() });

    expect(sql).toContain(
      "FROM (SELECT bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState FROM",
    );
    expect(sql).toContain(
      ".MetricItemAggMV1m WHERE bucketTime >= toDateTime('2026-11-27 10:01:00') AND bucketTime < toDateTime('2026-11-27 11:00:00') AND retentionDate >= now()",
    );
    expect(sql).not.toContain("bucketTime <=");
  });

  test("reads only the partial minute at each end from the raw rows, from the window's start and up to its end, rolled up as the rollup's view rolls them", () => {
    const sql: string = aggregateSql({ time: pastHour() });

    expect(countOf(sql, " UNION ALL SELECT ")).toBe(2);
    expect(sql).toContain(
      `UNION ALL SELECT ${METRIC_ROLLUP_BUCKET_FROM_RAW_ROWS}, ${METRIC_ROLLUP_STATES_FROM_RAW_ROWS.join(", ")} FROM`,
    );
    expect(sql).toContain(
      '.MetricItemV3 WHERE TRUE AND "time" >= "2026-11-27 10:00:07.123000000" AND "time" < "2026-11-27 10:01:00.000000000" AND retentionDate >= now()',
    );
    expect(sql).toContain(
      '.MetricItemV3 WHERE TRUE AND "time" >= "2026-11-27 11:00:00.000000000" AND "time" < "2026-11-27 11:00:07.123000000" AND retentionDate >= now()',
    );
    expect(countOf(sql, "GROUP BY bucketTime")).toBe(2);
    // No part reads the whole window from the rows.
    expect(sql).not.toContain(
      '"time" >= "2026-11-27 10:00:07.123000000" AND "time" < "2026-11-27 11:00:07.123000000"',
    );
  });

  test("filters every part by the read's own project and metric", () => {
    const sql: string = aggregateSql({ time: pastHour() });

    expect(countOf(sql, `"projectId" = "${projectId.toString()}"`)).toBe(3);
    expect(countOf(sql, '"name" = "system.cpu.utilization"')).toBe(3);
  });

  test.each([
    [AggregationType.Sum, "sumMerge(valueSumState) as value"],
    [AggregationType.Count, "countMerge(valueCountState) as value"],
    [AggregationType.Min, "minMerge(valueMinState) as value"],
    [AggregationType.Max, "maxMerge(valueMaxState) as value"],
    [
      AggregationType.Avg,
      "if(countMerge(valueCountState) = 0, 0, sumMerge(valueSumState) / countMerge(valueCountState)) as value",
    ],
  ])(
    "%s merges the parts' states as one rollup, by the minute's bucket",
    (aggregationType: AggregationType, merged: string) => {
      const sql: string = aggregateSql({
        time: pastHour(),
        aggregationType: aggregationType,
      });

      expect(sql.startsWith(`SELECT ${merged}, `)).toBe(true);
      expect(sql).toContain(") GROUP BY time ORDER BY");
    },
  );

  test("a window long enough for five-minute buckets is split all the same: the parts merge by state into the bucket an edge minute shares", () => {
    const sql: string = aggregateSql({
      time: TelemetryCheckWindow.ofSeconds(6 * 3600, DUE_AT),
    });

    expect(sql).toContain("toStartOfInterval(bucketTime, INTERVAL 5 MINUTE)");
    expect(sql).toContain(
      "bucketTime >= toDateTime('2026-11-27 05:01:00') AND bucketTime < toDateTime('2026-11-27 11:00:00')",
    );
    expect(countOf(sql, " UNION ALL SELECT ")).toBe(2);
  });

  test("a host's check reads the per-host rollup's whole minutes and its host's raw rows of the edges, both by the host's key", () => {
    const sql: string = aggregateSql({
      time: pastHour(),
      attributes: { "resource.host.name": "web-01" },
    });
    const key: string = keyForHost(projectId.toString(), "web-01");

    expect(sql).toContain(
      ".MetricItemAggMV1mByHostV2 WHERE bucketTime >= toDateTime('2026-11-27 10:01:00') AND bucketTime < toDateTime('2026-11-27 11:00:00')",
    );
    expect(countOf(sql, `AND hostEntityKey = "${key}"`)).toBe(3);
    expect(countOf(sql, ".MetricItemV3 WHERE TRUE")).toBe(2);
    // The rollup's rows of the host: by its key, as its view rolled them, not by the attribute.
    expect(sql).not.toContain("resource.host.name");
  });

  test("a minute's window at a monitor's moment still reads the raw rows alone, as since #11334", () => {
    const sql: string = aggregateSql({
      time: TelemetryCheckWindow.ofSeconds(60, DUE_AT),
    });

    expect(sql).not.toContain("MetricItemAggMV1m");
    expect(sql).not.toContain("UNION ALL");
  });

  test("a chart's range and a window of whole minutes read the rollup alone, as before", () => {
    const chart: string = aggregateSql({
      time: new InBetween<Date>(
        new Date("2026-11-27T10:00:07.123Z"),
        new Date("2026-11-27T11:00:07.123Z"),
      ),
    });
    const whole: string = aggregateSql({
      time: TelemetryCheckWindow.from(
        new Date("2026-11-27T10:00:00.000Z"),
        new Date("2026-11-27T11:00:00.000Z"),
      ),
    });

    for (const sql of [chart, whole]) {
      expect(sql).toContain("MetricItemAggMV1m WHERE bucketTime >=");
      expect(sql).not.toContain("UNION ALL");
      expect(sql).not.toContain("MetricItemV3");
    }
  });
});

describe("a Traces check's count of a service's spans over a long window", () => {
  const countSql: (startTime: InBetween<Date>) => string = (
    startTime: InBetween<Date>,
  ): string => {
    return inline(
      SpanService.toCountStatement({
        query: {
          projectId: projectId,
          primaryEntityId: new Includes([serviceId]),
          statusCode: new Includes([2]),
          startTime: startTime,
        } as never,
        props: { isRoot: true },
      }),
    );
  };

  test("adds the projection's count of its whole minutes to the rows' count of each partial minute", () => {
    const sql: string = countSql(pastHour());

    expect(
      sql.startsWith(
        "SELECT sum(part) AS count FROM (SELECT count() AS part FROM",
      ),
    ).toBe(true);
    expect(sql).toContain(
      'toStartOfMinute(startTime) >= toStartOfMinute("2026-11-27 10:01:00") AND toStartOfMinute(startTime) < toStartOfMinute("2026-11-27 11:00:00")',
    );
    expect(sql).toContain(
      `AND primaryEntityId IN (["${serviceId.toString()}"]) AND statusCode IN ([2])`,
    );
    expect(countOf(sql, "UNION ALL SELECT count() AS part FROM")).toBe(2);
    expect(sql).toContain(
      '"startTime" >= "2026-11-27 10:00:07.123000000" AND "startTime" < "2026-11-27 10:01:00.000000000"',
    );
    expect(sql).toContain(
      '"startTime" >= "2026-11-27 11:00:00.000000000" AND "startTime" < "2026-11-27 11:00:07.123000000"',
    );
    expect(countOf(sql, "AND retentionDate >= now()")).toBe(2);
    expect(sql).toContain("optimize_use_projections = 1");
  });

  test("filters the rows' parts by the read's own filters", () => {
    const sql: string = countSql(pastHour());

    expect(countOf(sql, `"projectId" = "${projectId.toString()}"`)).toBe(2);
    expect(
      countOf(sql, `"primaryEntityId" IN ["${serviceId.toString()}"]`),
    ).toBe(2);
    expect(countOf(sql, '"statusCode" IN [2]')).toBe(2);
  });

  test("a minute's window at a monitor's moment is counted from the rows alone, as since #11334", () => {
    const sql: string = countSql(TelemetryCheckWindow.ofSeconds(60, DUE_AT));

    expect(sql).not.toContain("toStartOfMinute");
    expect(sql).not.toContain("UNION ALL");
  });
});

describe("a span aggregate over a long window", () => {
  const aggregateSql: (
    startTime: InBetween<Date>,
    aggregationType?: AggregationType,
  ) => string = (
    startTime: InBetween<Date>,
    aggregationType?: AggregationType,
  ): string => {
    const aggregateBy: AggregateBy<Span> = {
      query: {
        projectId: projectId,
        primaryEntityId: new Includes([serviceId]),
        startTime: startTime,
      } as AggregateBy<Span>["query"],
      aggregationType: aggregationType || AggregationType.Count,
      aggregateColumnName: "durationUnixNano",
      aggregationTimestampColumnName: "startTime",
      startTimestamp: new Date(startTime.startValue),
      endTimestamp: new Date(startTime.endValue),
      limit: 1000,
      skip: 0,
      sort: { startTime: SortOrder.Ascending } as AggregateBy<Span>["sort"],
      props: { isRoot: true },
    };

    return inline(SpanService.toAggregateStatement(aggregateBy).statement);
  };

  test.each([
    [AggregationType.Count, "count()"],
    [AggregationType.Avg, "avg(durationUnixNano)"],
    [AggregationType.P99, "quantile(0.99)(durationUnixNano)"],
  ])(
    "%s in minute buckets: the projection's buckets of the whole minutes, beside a bucket of each partial minute from the rows",
    (aggregationType: AggregationType, expression: string) => {
      const sql: string = aggregateSql(pastHour(), aggregationType);

      expect(
        sql.startsWith("SELECT durationUnixNano, startTime FROM (SELECT "),
      ).toBe(true);
      expect(sql).toContain(
        'toStartOfMinute(s.startTime) >= toStartOfMinute("2026-11-27 10:01:00") AND toStartOfMinute(s.startTime) < toStartOfMinute("2026-11-27 11:00:00")',
      );
      expect(
        countOf(sql, `UNION ALL SELECT ${expression} as durationUnixNano`),
      ).toBe(2);
      expect(sql).toContain(
        '"s"."startTime" >= "2026-11-27 10:00:07.123000000" AND "s"."startTime" < "2026-11-27 10:01:00.000000000"',
      );
      expect(sql).toContain(
        '"s"."startTime" >= "2026-11-27 11:00:00.000000000" AND "s"."startTime" < "2026-11-27 11:00:07.123000000"',
      );
      expect(sql).toContain(") ORDER BY startTime ASC LIMIT");
      expect(sql).toContain("optimize_use_projections = 1");
    },
  );

  test("in five-minute buckets an edge minute would share a bucket with whole ones: such a window is read from the rows, as since #11334", () => {
    const sql: string = aggregateSql(
      TelemetryCheckWindow.ofSeconds(6 * 3600, DUE_AT),
    );

    expect(sql).not.toContain("toStartOfMinute(s.startTime) >=");
    expect(sql).not.toContain("UNION ALL");
  });
});
