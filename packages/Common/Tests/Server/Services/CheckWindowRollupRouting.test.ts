import "../TestingUtils/Init";
import { MetricService } from "../../../Server/Services/MetricService";
import SpanService from "../../../Server/Services/SpanService";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import MinuteRollupRange from "../../../Server/Utils/AnalyticsDatabase/MinuteRollupRange";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Span from "../../../Models/AnalyticsModels/Span";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import TelemetryCheckWindow from "../../../Types/Monitor/TelemetryCheckWindow";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A ONE-MINUTE ROLLUP SERVES A TELEMETRY CHECK'S WINDOW ONLY EXACTLY (issue
 * #11334).
 *
 * The span projection and the metric rollups keep whole minutes. A chart's
 * range, which holds both its ends, is still read from them, rounded to the
 * minute. A check's window leaves out its end and starts where the check
 * before it ended, at the monitor's own moment, so its ends are almost
 * never whole minutes:
 *
 *   - a Traces check of a service's error spans counted the projection's
 *     minutes from 10:00 to 10:01:59 for its window of 10:00:07 to
 *     10:01:07, and the minute it shared with the next check twice;
 *   - a Metrics or Host check of one metric read the one rollup bucket
 *     starting inside its window, 10:01 to 10:02, which mostly lies after
 *     it, and the rest of each minute was judged by no check.
 *
 * Now a check's window is read from the raw rows, as `time >= start AND
 * time < end`, unless both its ends are whole minutes, when its whole
 * buckets are exactly the window and the rollup still serves it, with its
 * end left out.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();

// A window at a monitor's own moment: 10:00:07.123 up to 10:01:07.123.
const DUE_AT: Date = new Date("2026-11-27T10:01:07.123Z");
const unalignedWindow: () => InBetween<Date> = (): InBetween<Date> => {
  return TelemetryCheckWindow.ofSeconds(60, DUE_AT);
};

// A window whose ends are whole minutes: 10:00 up to 10:05.
const ALIGNED_START: Date = new Date("2026-11-27T10:00:00.000Z");
const ALIGNED_END: Date = new Date("2026-11-27T10:05:00.000Z");
const alignedWindow: () => InBetween<Date> = (): InBetween<Date> => {
  return TelemetryCheckWindow.from(ALIGNED_START, ALIGNED_END);
};

// A chart's range, both ends held: as rollups always read it.
const chartRange: () => InBetween<Date> = (): InBetween<Date> => {
  return new InBetween<Date>(
    new Date(DUE_AT.getTime() - 60000),
    new Date(DUE_AT.getTime()),
  );
};

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
      text =
        text.slice(0, at) + JSON.stringify(value) + text.slice(close + 1);
    }
  }

  return text.split(/\s+/).join(" ").trim();
}

describe("MinuteRollupRange", () => {
  test("a range that holds both its ends is served, rounded, as before", () => {
    expect(MinuteRollupRange.canServe(chartRange())).toBe(true);
    expect(MinuteRollupRange.getEndOperator(chartRange())).toBe("<=");
  });

  test("a check's window whose ends are not whole minutes is not", () => {
    expect(MinuteRollupRange.canServe(unalignedWindow())).toBe(false);
  });

  test("a check's window of whole minutes is, with its end left out", () => {
    expect(MinuteRollupRange.canServe(alignedWindow())).toBe(true);
    expect(MinuteRollupRange.getEndOperator(alignedWindow())).toBe("<");
  });

  test("one end off a whole minute, by a second or a millisecond, is enough to read the rows", () => {
    for (const [start, end] of [
      ["2026-11-27T10:00:00.000Z", "2026-11-27T10:05:00.001Z"],
      ["2026-11-27T10:00:00.001Z", "2026-11-27T10:05:00.000Z"],
      ["2026-11-27T10:00:01.000Z", "2026-11-27T10:05:00.000Z"],
      ["2026-11-27T10:00:00.000Z", "2026-11-27T10:04:59.000Z"],
    ] as Array<[string, string]>) {
      expect(
        MinuteRollupRange.canServe(
          TelemetryCheckWindow.from(new Date(start), new Date(end)),
        ),
      ).toBe(false);
    }
  });

  test("reads ends that crossed JSON as text, and ends it cannot read as no whole minute", () => {
    expect(
      MinuteRollupRange.canServe(
        new InBetween<string>(
          "2026-11-27T10:00:00.000Z",
          "2026-11-27T10:05:00.000Z",
          { includesEnd: false },
        ),
      ),
    ).toBe(true);
    expect(
      MinuteRollupRange.canServe(
        new InBetween<string>("not a date", "2026-11-27T10:05:00.000Z", {
          includesEnd: false,
        }),
      ),
    ).toBe(false);
  });
});

describe("a Traces check's count of a service's spans", () => {
  const countSql: (startTime: InBetween<Date>) => string = (
    startTime: InBetween<Date>,
  ): string => {
    return inline(
      SpanService.toCountStatement({
        query: {
          projectId: projectId,
          primaryEntityId: new Includes([serviceId]),
          startTime: startTime,
        } as never,
        props: { isRoot: true },
      }),
    );
  };

  test("a chart's range still rides the minute-rounded projection, both ends held", () => {
    const sql: string = countSql(chartRange());

    expect(sql).toContain("optimize_use_projections = 1");
    expect(sql).toContain(
      'toStartOfMinute(startTime) >= toStartOfMinute("2026-11-27 10:00:07") AND toStartOfMinute(startTime) <= toStartOfMinute("2026-11-27 10:01:07")',
    );
  });

  test("REGRESSION: a check's window is counted from the rows, its end left out, never rounded to the minute", () => {
    const sql: string = countSql(unalignedWindow());

    expect(sql).not.toContain("toStartOfMinute");
    expect(sql).not.toContain("optimize_use_projections");
    expect(sql).toContain(
      '"startTime" >= "2026-11-27 10:00:07.123000000" AND "startTime" < "2026-11-27 10:01:07.123000000"',
    );
  });

  test("a check's window of whole minutes rides the projection, which is exact there, its end left out", () => {
    const sql: string = countSql(alignedWindow());

    expect(sql).toContain("optimize_use_projections = 1");
    expect(sql).toContain(
      'toStartOfMinute(startTime) >= toStartOfMinute("2026-11-27 10:00:00") AND toStartOfMinute(startTime) < toStartOfMinute("2026-11-27 10:05:00")',
    );
    expect(sql).not.toContain("toStartOfMinute(startTime) <=");
  });

  test("an exact count is read from the rows whatever the range, as before", () => {
    const sql: string = inline(
      SpanService.toCountStatement({
        query: { projectId: projectId, startTime: alignedWindow() } as never,
        props: { isRoot: true },
        exact: true,
      }),
    );

    expect(sql).not.toContain("toStartOfMinute");
    expect(sql).toContain(
      '"startTime" >= "2026-11-27 10:00:00.000000000" AND "startTime" < "2026-11-27 10:05:00.000000000"',
    );
  });
});

describe("a span aggregate over a check's window", () => {
  const aggregateSql: (startTime: InBetween<Date>) => string = (
    startTime: InBetween<Date>,
  ): string => {
    const aggregateBy: AggregateBy<Span> = {
      query: {
        projectId: projectId,
        primaryEntityId: new Includes([serviceId]),
        startTime: startTime,
      } as AggregateBy<Span>["query"],
      aggregationType: AggregationType.Count,
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

  test("a chart's range rides the projection, both ends held, as before", () => {
    const sql: string = aggregateSql(chartRange());

    expect(sql).toContain("toStartOfMinute(s.startTime) >= toStartOfMinute(");
    expect(sql).toContain("toStartOfMinute(s.startTime) <= toStartOfMinute(");
  });

  test("a check's window is aggregated from the rows, its end left out", () => {
    const sql: string = aggregateSql(unalignedWindow());

    expect(sql).not.toContain("toStartOfMinute(s.startTime)");
    expect(sql).toContain(
      '"SpanItemV3"."startTime" >= "2026-11-27 10:00:07.123000000" AND "SpanItemV3"."startTime" < "2026-11-27 10:01:07.123000000"',
    );
  });

  test("a check's window of whole minutes rides the projection, its end left out", () => {
    const sql: string = aggregateSql(alignedWindow());

    expect(sql).toContain(
      'toStartOfMinute(s.startTime) >= toStartOfMinute("2026-11-27 10:00:00") AND toStartOfMinute(s.startTime) < toStartOfMinute("2026-11-27 10:05:00")',
    );
  });
});

describe("a Metrics or infrastructure check's read of one metric", () => {
  let service: MetricService;

  beforeEach(() => {
    service = new MetricService();
  });

  const aggregateSql: (
    time: InBetween<Date>,
    attributes?: Record<string, string>,
  ) => string = (
    time: InBetween<Date>,
    attributes?: Record<string, string>,
  ): string => {
    const aggregateBy: AggregateBy<Metric> = {
      query: {
        projectId: projectId,
        name: "system.cpu.utilization",
        time: time,
        ...(attributes ? { attributes: attributes } : {}),
      } as AggregateBy<Metric>["query"],
      aggregationType: AggregationType.Avg,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: new Date(time.startValue),
      endTimestamp: new Date(time.endValue),
      limit: 10000,
      skip: 0,
      sort: { time: SortOrder.Ascending } as AggregateBy<Metric>["sort"],
      props: { isRoot: true },
    };

    return inline(service.toAggregateStatement(aggregateBy).statement);
  };

  test("a chart's range reads the one-minute rollup, both ends held, as before", () => {
    const sql: string = aggregateSql(chartRange());

    expect(sql).toContain("MetricItemAggMV1m");
    expect(sql).toContain(
      "bucketTime >= toDateTime('2026-11-27 10:00:07') AND bucketTime <= toDateTime('2026-11-27 10:01:07')",
    );
  });

  test("REGRESSION: a check's window reads the raw rows, its end left out, never the bucket starting inside it", () => {
    const sql: string = aggregateSql(unalignedWindow());

    expect(sql).not.toContain("MetricItemAggMV1m");
    expect(sql).not.toContain("bucketTime");
    expect(sql).toContain(
      '"MetricItemV3"."time" >= "2026-11-27 10:00:07.123000000" AND "MetricItemV3"."time" < "2026-11-27 10:01:07.123000000"',
    );
  });

  test("a check's window of whole minutes reads the rollup's whole buckets, its end left out", () => {
    const sql: string = aggregateSql(alignedWindow());

    expect(sql).toContain("MetricItemAggMV1m");
    expect(sql).toContain(
      "bucketTime >= toDateTime('2026-11-27 10:00:00') AND bucketTime < toDateTime('2026-11-27 10:05:00')",
    );
    expect(sql).not.toContain("bucketTime <=");
  });

  test("a host's chart reads the per-host rollup, as before", () => {
    const sql: string = aggregateSql(chartRange(), {
      "resource.host.name": "web-01",
    });

    expect(sql).toContain("MetricItemAggMV1mByHostV2");
    expect(sql).toContain("bucketTime <= toDateTime('2026-11-27 10:01:07')");
  });

  test("REGRESSION: a Host check's window reads the raw rows of its host, not the per-host rollup", () => {
    const sql: string = aggregateSql(unalignedWindow(), {
      "resource.host.name": "web-01",
    });

    expect(sql).not.toContain("MetricItemAggMV1mByHostV2");
    expect(sql).not.toContain("bucketTime");
    expect(sql).toContain('"time" < "2026-11-27 10:01:07.123000000"');
  });

  test("a Host check's window of whole minutes reads the per-host rollup, its end left out", () => {
    const sql: string = aggregateSql(alignedWindow(), {
      "resource.host.name": "web-01",
    });

    expect(sql).toContain("MetricItemAggMV1mByHostV2");
    expect(sql).toContain(
      "bucketTime >= toDateTime('2026-11-27 10:00:00') AND bucketTime < toDateTime('2026-11-27 10:05:00')",
    );
  });

  test("a read with no time range still reads the rollup as before", () => {
    const aggregateBy: AggregateBy<Metric> = {
      query: {
        projectId: projectId,
        name: "system.cpu.utilization",
      } as AggregateBy<Metric>["query"],
      aggregationType: AggregationType.Avg,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: new Date(DUE_AT.getTime() - 60000),
      endTimestamp: DUE_AT,
      limit: 10000,
      skip: 0,
      sort: { time: SortOrder.Ascending } as AggregateBy<Metric>["sort"],
      props: { isRoot: true },
    };

    const sql: string = inline(
      service.toAggregateStatement(aggregateBy).statement,
    );

    expect(sql).toContain("MetricItemAggMV1m");
    expect(sql).toContain("bucketTime <= toDateTime(");
  });
});
