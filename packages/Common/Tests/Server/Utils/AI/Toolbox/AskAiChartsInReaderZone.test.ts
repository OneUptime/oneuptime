import "../../../TestingUtils/Init";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import HostService from "../../../../../Server/Services/HostService";
import MetricBaselineService from "../../../../../Server/Services/MetricBaselineService";
import MetricService from "../../../../../Server/Services/MetricService";
import AggregateBy from "../../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import ModelPermission from "../../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import { describeBucketCalendar } from "../../../../../Server/Utils/AI/Toolbox/GroupedMetricSeries";
import {
  BaselineAnomalyTool,
  QueryMetricsTool,
} from "../../../../../Server/Utils/AI/Toolbox/MetricTools";
import { QueryResourceTelemetryTool } from "../../../../../Server/Utils/AI/Toolbox/ResourceTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AIResourceType } from "../../../../../Types/AI/AIResourceContext";
import {
  getChartBucketTimezone,
  isDrawnOnAnotherCalendar,
  toReaderCalendarDate,
} from "../../../../../Types/AI/AIChatChartCalendar";
import {
  AIChatWidgetPoint,
  AIChatWidgetSeries,
} from "../../../../../Types/AI/AIChatTypes";
import AggregatedModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate, { CalendarUnit } from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import Timezone from "../../../../../Types/Timezone";
import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
} from "../../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "../../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import DataPointUtil from "../../../../../UI/Components/Charts/Utils/DataPoint";

/*
 * ASK AI'S CHARTS CUT THEIR DAYS AT THE ASKER'S MIDNIGHT (issue #7922).
 *
 * The dashboard asks for every chart's day, week, month and year buckets in
 * the reader's zone since issue #7277, and draws them on the reader's
 * calendar. Ask AI's charts are read on the server, through the tools, and
 * their requests carried no zone: a chat chart over more than a week cut its
 * days at UTC midnight, which is 19:00 the evening before in New York, so
 * each day's total sat under the day before. The chat now sends the asker's
 * zone (ToolContext.readerTimezone), and every tool that charts a window
 * asks for its calendar buckets in it (AggregationIntervalUtil.withTimezone),
 * as the browser asks for the dashboard's. Slack, Microsoft Teams and the
 * autonomous investigations have no reader, and keep UTC's days.
 *
 * The server is played here by a fake that buckets the samples it is given
 * as the real statements do (pinned against ClickHouse by
 * DayBucketsInReaderZoneClickhouse and AskAiChartsInReaderZoneClickhouse):
 * a day starts at the request's zone's midnight, UTC's when it names none.
 * The day each sample falls on is worked out on the platform's own clock
 * (Intl), and the chat's chart is drawn through the dashboard's own slot
 * walk (DataPointUtil), in the reader's zone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "79227922-7922-4922-8922-792279227922",
);
const HOST_ID: ObjectID = new ObjectID("79220000-0000-4000-8000-000000000001");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
// 10:00 on 15 November in New York; a month back holds its 1 November.
const NOW: Date = new Date("2026-11-15T15:00:00.000Z");
const METRIC: string = "checkout.orders";

function memberProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: new ObjectID("79220000-0000-4000-8000-0000000000aa"),
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public],
      projectIds: [PROJECT_ID],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        _type: "UserTenantAccessPermission",
        permissions: [
          {
            permission: Permission.ProjectMember,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          },
        ],
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

// A person's Ask AI turn, in the zone their Dashboard reads in.
function askedIn(timezone: Timezone): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: memberProps(),
    readerTimezone: timezone,
  };
}

// A run with no reader: Slack, Microsoft Teams, an autonomous investigation.
function noReader(): ToolContext {
  return { projectId: PROJECT_ID, props: memberProps() };
}

function windowArgs(days: number, end: Date = NOW): JSONObject {
  return {
    startTime: new Date(end.getTime() - days * DAY).toISOString(),
    endTime: end.toISOString(),
  };
}

// The date an instant falls on in `timezone`, as the platform's clock has it.
function platformDay(ms: number, timezone: string): string {
  const parts: Array<Intl.DateTimeFormatPart> = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).formatToParts(new Date(ms));
  const part: (type: string) => string = (type: string): string => {
    return parts.find((item: Intl.DateTimeFormatPart): boolean => {
      return item.type === type;
    })!.value;
  };

  return `${part("year")}-${part("month")}-${part("day")}`;
}

// ---- The server, as its statements bucket.

interface Sample {
  time: number;
  value: number;
  attributes: Record<string, string>;
}

let requests: Array<AggregateBy<Metric>>;
let samples: Array<Sample>;

// The start of the bucket `ms` is in, as the server cuts it for `request`.
function bucketOf(ms: number, request: AggregateBy<Metric>): number {
  const interval: AggregationInterval =
    AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: request.startTimestamp,
      endDate: request.endTimestamp,
      aggregationInterval: request.aggregationInterval,
    });

  if (interval === AggregationInterval.Total) {
    return request.startTimestamp.getTime();
  }

  const unit: CalendarUnit | undefined =
    AggregationIntervalUtil.getCalendarUnit(interval);

  if (unit) {
    // A zone moves only a day, a week, a month and a year.
    return OneUptimeDate.getStartOfCalendarUnit(
      new Date(ms),
      unit,
      request.timezone || Timezone.UTC,
    ).getTime();
  }

  const width: number =
    AggregationIntervalUtil.getAggregationIntervalMs(interval);
  return Math.floor(ms / width) * width;
}

function serve(request: AggregateBy<Metric>): AggregatedResult {
  const groupBy: Array<string> = request.groupByAttributeKeys || [];
  const buckets: Map<
    string,
    { timestamp: number; attributes: JSONObject; values: Array<number> }
  > = new Map();

  for (const sample of samples) {
    if (
      sample.time < request.startTimestamp.getTime() ||
      sample.time > request.endTimestamp.getTime()
    ) {
      continue;
    }

    const timestamp: number = bucketOf(sample.time, request);
    const attributes: JSONObject = {};

    for (const key of groupBy) {
      attributes[key] = sample.attributes[key] || "";
    }

    const key: string = `${timestamp}|${JSON.stringify(attributes)}`;
    const bucket: {
      timestamp: number;
      attributes: JSONObject;
      values: Array<number>;
    } = buckets.get(key) || { timestamp, attributes, values: [] };

    bucket.values.push(sample.value);
    buckets.set(key, bucket);
  }

  const data: Array<AggregatedModel> = Array.from(buckets.values())
    .sort((a: { timestamp: number }, b: { timestamp: number }): number => {
      return a.timestamp - b.timestamp;
    })
    .map(
      (bucket: {
        timestamp: number;
        attributes: JSONObject;
        values: Array<number>;
      }): AggregatedModel => {
        const sum: number = bucket.values.reduce(
          (total: number, value: number): number => {
            return total + value;
          },
          0,
        );
        const value: number =
          request.aggregationType === AggregationType.Count
            ? bucket.values.length
            : request.aggregationType === AggregationType.Sum
              ? sum
              : sum / bucket.values.length;

        return {
          timestamp: new Date(bucket.timestamp),
          value,
          ...(groupBy.length > 0 ? { attributes: bucket.attributes } : {}),
        } as AggregatedModel;
      },
    );

  return { data };
}

/*
 * A sample every hour of the month before NOW. Its value tells its New York
 * day apart from the next: the day's number of the month, so a bucket that
 * mixes two days (a UTC day read in New York) sums to neither.
 */
function seedHourly(
  timezone: string,
  attributes: Record<string, string> = {},
): void {
  samples = [];
  const start: number = NOW.getTime() - 32 * DAY;

  for (let time: number = start; time <= NOW.getTime(); time += HOUR) {
    samples.push({
      time,
      value: Number(platformDay(time, timezone).slice(8, 10)),
      attributes,
    });
  }
}

// What each of the reader's days holds, summed, as the platform has it.
function expectedDailySums(
  timezone: string,
  from: number,
  to: number,
): Map<string, number> {
  const sums: Map<string, number> = new Map();

  for (const sample of samples) {
    if (sample.time >= from && sample.time <= to) {
      const day: string = platformDay(sample.time, timezone);
      sums.set(day, (sums.get(day) || 0) + sample.value);
    }
  }

  return sums;
}

beforeEach(() => {
  requests = [];
  samples = [];
  jest
    .spyOn(MetricService, "aggregateBy")
    .mockImplementation(
      async (request: AggregateBy<Metric>): Promise<AggregatedResult> => {
        requests.push(request);
        return serve(request);
      },
    );
});

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

// ---- The chat's chart, as the Dashboard draws it.

const Y_AXIS: YAxis = {
  legend: "",
  options: {
    type: YAxisType.Number,
    min: "auto",
    max: "auto",
    precision: YAxisPrecision.TwoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

/*
 * The rows the chat's chart draws from a widget's series (ChartWidget): an
 * axis from the first point to the last, each line averaged in its slot.
 */
function chatChartOf(series: AIChatWidgetSeries): Array<ChartDataPoint> {
  const points: SeriesPoints = {
    seriesName: series.name,
    data: series.points
      .filter((point: AIChatWidgetPoint): boolean => {
        return point.y !== null && point.y !== undefined;
      })
      .map((point: AIChatWidgetPoint): { x: Date; y: number } => {
        return { x: OneUptimeDate.fromString(point.x), y: point.y as number };
      }),
  };
  const times: Array<number> = points.data.map((point: { x: Date }): number => {
    return point.x.getTime();
  });
  const xAxis: XAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: new Date(Math.min(...times)),
      max: new Date(Math.max(...times)),
      aggregateType: XAxisAggregateType.Average,
    },
  };

  return DataPointUtil.getChartDataPoints({
    seriesPoints: [points],
    xAxis: xAxis,
    yAxis: Y_AXIS,
  });
}

function onlySeries(result: ToolExecutionResult): AIChatWidgetSeries {
  const series: Array<AIChatWidgetSeries> = (result.widget?.data["series"] ||
    []) as Array<AIChatWidgetSeries>;
  expect(series).toHaveLength(1);
  return series[0]!;
}

const READERS: Array<[string, Timezone]> = [
  [
    "New York, west of UTC, over its 1 November change",
    Timezone.AmericaNew_York,
  ],
  ["London, over its 25 October change", Timezone.EuropeLondon],
  ["Kolkata, half an hour off UTC's hours", Timezone.AsiaKolkata],
  ["Kathmandu, 45 minutes off UTC's hours", Timezone.AsiaKathmandu],
  ["Tokyo, east of UTC", Timezone.AsiaTokyo],
];

describe("query_metrics over more than a week", () => {
  test("a New York reader's read of 30 days asks for its days in New York", async () => {
    seedHourly(Timezone.AmericaNew_York);

    await QueryMetricsTool.execute(
      { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
      askedIn(Timezone.AmericaNew_York),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.timezone).toBe(Timezone.AmericaNew_York);
    // The interval stays the window's own: days.
    expect(requests[0]!.aggregationInterval).toBeUndefined();
    expect(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate: requests[0]!.startTimestamp,
        endDate: requests[0]!.endTimestamp,
      }),
    ).toBe(AggregationInterval.Day);
  });

  test("asked for 3 months, the window is held to 30 days, still days in New York", async () => {
    seedHourly(Timezone.AmericaNew_York);

    await QueryMetricsTool.execute(
      { metricName: METRIC, aggregationType: "Sum", ...windowArgs(90) },
      askedIn(Timezone.AmericaNew_York),
    );

    expect(requests).toHaveLength(1);
    expect(
      requests[0]!.endTimestamp.getTime() -
        requests[0]!.startTimestamp.getTime(),
    ).toBe(30 * DAY);
    expect(requests[0]!.timezone).toBe(Timezone.AmericaNew_York);
  });

  test("with no reader - a Slack run - the read names no zone, and its days are UTC's", async () => {
    seedHourly(Timezone.UTC);

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
      noReader(),
    );

    expect(requests).toHaveLength(1);
    expect("timezone" in requests[0]!).toBe(false);
    for (const point of onlySeries(result).points) {
      expect(point.x.endsWith("T00:00:00.000Z")).toBe(true);
    }
  });

  test.each([1, 3, 7])(
    "a read of %s days is hours or shorter: no zone, the request exactly as before",
    async (days: number) => {
      seedHourly(Timezone.UTC);

      await QueryMetricsTool.execute(
        { metricName: METRIC, ...windowArgs(days) },
        askedIn(Timezone.AmericaNew_York),
      );
      await QueryMetricsTool.execute(
        { metricName: METRIC, ...windowArgs(days) },
        noReader(),
      );

      expect(requests).toHaveLength(2);
      expect("timezone" in requests[0]!).toBe(false);
      expect({ ...requests[0]!, props: null }).toEqual({
        ...requests[1]!,
        props: null,
      });
    },
  );

  describe.each(READERS)(
    "a reader in %s",
    (_name: string, timezone: Timezone) => {
      test("each daily point of the chat's chart starts at the reader's midnight", async () => {
        seedHourly(timezone);

        const result: ToolExecutionResult = await QueryMetricsTool.execute(
          { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
          askedIn(timezone),
        );
        const points: Array<AIChatWidgetPoint> = onlySeries(result).points;

        expect(points.length).toBeGreaterThanOrEqual(30);

        for (let index: number = 0; index < points.length; index++) {
          const startMs: number = Date.parse(points[index]!.x);
          const day: string = platformDay(startMs, timezone);

          // A midnight there: a millisecond before is the day before.
          expect(platformDay(startMs - 1, timezone)).not.toBe(day);

          if (index > 0) {
            expect(day).not.toBe(
              platformDay(Date.parse(points[index - 1]!.x), timezone),
            );
          }
        }
      });

      test("drawn on the reader's calendar, each day's total sits under its own day", async () => {
        seedHourly(timezone);
        OneUptimeDate.setUserTimezone(timezone);

        const result: ToolExecutionResult = await QueryMetricsTool.execute(
          { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
          askedIn(timezone),
        );
        const series: AIChatWidgetSeries = onlySeries(result);
        const expected: Map<string, number> = expectedDailySums(
          timezone,
          NOW.getTime() - 30 * DAY,
          NOW.getTime(),
        );
        const rows: Array<ChartDataPoint> = chatChartOf(series);
        let checked: number = 0;

        for (const row of rows) {
          const day: string = platformDay(
            Number(row[CHART_DATA_POINT_DATE_KEY]),
            timezone,
          );

          if (row[series.name] === undefined) {
            continue;
          }

          expect({ day, total: row[series.name] }).toEqual({
            day,
            total: expected.get(day),
          });
          checked++;
        }

        // Every day of the window is drawn, each under its own date.
        expect(checked).toBe(expected.size);
      });

      test("the model is told each bucket is a day in the reader's zone", async () => {
        seedHourly(timezone);

        const result: ToolExecutionResult = await QueryMetricsTool.execute(
          { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
          askedIn(timezone),
        );

        expect(result.dataForLlm).toContain(
          describeBucketCalendar({
            interval: AggregationInterval.Day,
            timezone: timezone,
          }),
        );
        expect(result.dataForLlm).toContain(
          `Each 1-day bucket is a day in ${timezone}`,
        );
      });
    },
  );

  test("in UTC's days, a New York reader saw each day's total under the day before", async () => {
    /*
     * What the chat drew before: the same read without the zone, drawn in
     * New York. Each UTC day starts at 19:00 or 20:00 the evening before
     * there, so its slot is the day before, and it holds parts of two days.
     */
    seedHourly(Timezone.AmericaNew_York);
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
      noReader(),
    );
    const series: AIChatWidgetSeries = onlySeries(result);
    const expected: Map<string, number> = expectedDailySums(
      Timezone.AmericaNew_York,
      NOW.getTime() - 30 * DAY,
      NOW.getTime(),
    );
    let wrong: number = 0;

    for (const row of chatChartOf(series)) {
      const day: string = platformDay(
        Number(row[CHART_DATA_POINT_DATE_KEY]),
        Timezone.AmericaNew_York,
      );

      if (
        row[series.name] !== undefined &&
        row[series.name] !== expected.get(day)
      ) {
        wrong++;
      }
    }

    expect(wrong).toBeGreaterThanOrEqual(29);
  });

  test("with no reader the model is told the buckets are UTC days", async () => {
    seedHourly(Timezone.UTC);

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: METRIC, ...windowArgs(30) },
      noReader(),
    );

    expect(result.dataForLlm).toContain(
      "Each 1-day bucket is a UTC day, from midnight UTC.",
    );
  });

  test("a zone the list does not name is never asked for, and the model is told UTC's days", async () => {
    seedHourly(Timezone.UTC, { "resource.container.name": "api" });
    const odd: ToolContext = {
      ...noReader(),
      readerTimezone: "Mars/Olympus_Mons" as Timezone,
    };

    const ungrouped: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: METRIC, ...windowArgs(30) },
      odd,
    );
    const grouped: ToolExecutionResult = await QueryMetricsTool.execute(
      {
        metricName: METRIC,
        groupBy: ["resource.container.name"],
        ...windowArgs(30),
      },
      odd,
    );

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect("timezone" in request).toBe(false);
    }
    for (const result of [ungrouped, grouped]) {
      expect(result.dataForLlm).toContain(
        "Each 1-day bucket is a UTC day, from midnight UTC.",
      );
      expect(result.dataForLlm).not.toContain("Mars");
    }
  });

  test("a read of hours says nothing of days", async () => {
    seedHourly(Timezone.UTC);

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: METRIC, ...windowArgs(2) },
      askedIn(Timezone.AmericaNew_York),
    );

    expect(result.dataForLlm).not.toContain("bucket is a");
  });
});

describe("query_metrics read one series per attribute value", () => {
  test("over 30 days both the values and their counts are read in the reader's days", async () => {
    seedHourly(Timezone.AmericaNew_York, { "resource.container.name": "api" });

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      {
        metricName: METRIC,
        aggregationType: "Sum",
        groupBy: ["resource.container.name"],
        ...windowArgs(30),
      },
      askedIn(Timezone.AmericaNew_York),
    );

    // The value read and the count read beside it.
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.aggregationInterval).toBe(AggregationInterval.Day);
      expect(request.timezone).toBe(Timezone.AmericaNew_York);
    }

    for (const point of onlySeries(result).points) {
      const startMs: number = Date.parse(point.x);
      expect(platformDay(startMs - 1, Timezone.AmericaNew_York)).not.toBe(
        platformDay(startMs, Timezone.AmericaNew_York),
      );
    }

    expect(result.dataForLlm).toContain(
      `Each 1-day bucket is a day in ${Timezone.AmericaNew_York}`,
    );
  });

  test("with no reader the grouped reads name no zone", async () => {
    seedHourly(Timezone.UTC, { "resource.container.name": "api" });

    await QueryMetricsTool.execute(
      {
        metricName: METRIC,
        groupBy: ["resource.container.name"],
        ...windowArgs(30),
      },
      noReader(),
    );

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect("timezone" in request).toBe(false);
    }
  });

  test("over a day the trend is in half hours, and names no zone", async () => {
    seedHourly(Timezone.UTC, { "resource.container.name": "api" });

    await QueryMetricsTool.execute(
      {
        metricName: METRIC,
        groupBy: ["resource.container.name"],
        ...windowArgs(1),
      },
      askedIn(Timezone.AmericaNew_York),
    );

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.aggregationInterval).toBe(
        AggregationInterval.ThirtyMinutes,
      );
      expect("timezone" in request).toBe(false);
    }
  });
});

describe("baseline_anomaly", () => {
  test("its reads are 15 minutes and 6 hours: never days, so never a zone", async () => {
    jest.spyOn(ModelPermission, "getReadScope").mockResolvedValue({
      readableIds: null,
      blockedIds: [],
    });
    jest.spyOn(MetricBaselineService, "getBaseline").mockResolvedValue({
      sampleCount: 50,
      mean: 10,
      stddev: 1,
      median: 10,
      p95: 12,
      minObserved: 7,
      maxObserved: 13,
      isReliable: true,
      windowDays: 14,
      hourOfWeek: 10,
    });
    jest
      .spyOn(MetricBaselineService, "getBandSeries")
      .mockResolvedValue([
        { time: NOW, expectedLow: 7, expectedHigh: 13, mean: 10 } as never,
      ]);
    seedHourly(Timezone.UTC);

    await BaselineAnomalyTool.execute(
      { metricName: METRIC, atTime: NOW.toISOString() },
      askedIn(Timezone.AmericaNew_York),
    );

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect("timezone" in request).toBe(false);
    }
  });
});

describe("query_resource_telemetry's metric trend", () => {
  function resourceArgs(extra: JSONObject): JSONObject {
    return {
      resourceType: AIResourceType.Host,
      resourceId: HOST_ID.toString(),
      signal: "metrics",
      ...windowArgs(30),
      ...extra,
    };
  }

  beforeEach(() => {
    jest.spyOn(HostService, "findBy").mockResolvedValue([
      {
        _id: HOST_ID.toString(),
        name: "web-1",
        hostIdentifier: "web-1",
        lastSeenAt: NOW,
        otelCollectorStatus: "Connected",
        isArchived: false,
      },
    ] as never);
    jest.spyOn(ModelPermission, "getReadScope").mockResolvedValue({
      readableIds: null,
      blockedIds: [],
    });
  });

  test("a trend over 30 days reads its days, and their counts, in New York", async () => {
    seedHourly(Timezone.AmericaNew_York);

    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        resourceArgs({ metricName: METRIC, aggregationType: "Sum" }),
        askedIn(Timezone.AmericaNew_York),
      );

    // The value read and the count read beside it.
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.aggregationInterval).toBe(AggregationInterval.Day);
      expect(request.timezone).toBe(Timezone.AmericaNew_York);
    }

    for (const point of onlySeries(result).points) {
      const startMs: number = Date.parse(point.x);
      expect(platformDay(startMs - 1, Timezone.AmericaNew_York)).not.toBe(
        platformDay(startMs, Timezone.AmericaNew_York),
      );
    }

    expect(result.dataForLlm).toContain(
      `Each 1-day bucket is a day in ${Timezone.AmericaNew_York}`,
    );
  });

  test("a trend by attribute reads in New York too", async () => {
    seedHourly(Timezone.AmericaNew_York, { state: "user" });

    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        resourceArgs({ metricName: METRIC, groupBy: ["state"] }),
        askedIn(Timezone.AmericaNew_York),
      );

    expect(requests.length).toBeGreaterThanOrEqual(1);
    for (const request of requests) {
      expect(request.aggregationInterval).toBe(AggregationInterval.Day);
      expect(request.timezone).toBe(Timezone.AmericaNew_York);
    }
    expect(result.dataForLlm).toContain(
      `Each 1-day bucket is a day in ${Timezone.AmericaNew_York}`,
    );
  });

  test("a summary is one whole-window bucket: no zone", async () => {
    seedHourly(Timezone.UTC);

    await QueryResourceTelemetryTool.execute(
      resourceArgs({ metricName: METRIC, mode: "summary" }),
      askedIn(Timezone.AmericaNew_York),
    );

    expect(requests.length).toBeGreaterThanOrEqual(1);
    for (const request of requests) {
      expect(request.aggregationInterval).toBe(AggregationInterval.Total);
      expect("timezone" in request).toBe(false);
    }
  });

  test("the metric names a resource reports are counted over the window: no zone", async () => {
    seedHourly(Timezone.UTC);

    await QueryResourceTelemetryTool.execute(
      resourceArgs({}),
      askedIn(Timezone.AmericaNew_York),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.aggregationInterval).toBe(AggregationInterval.Total);
    expect("timezone" in requests[0]!).toBe(false);
  });

  test("with no reader the trend's days are UTC's", async () => {
    seedHourly(Timezone.UTC);

    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        resourceArgs({ metricName: METRIC }),
        noReader(),
      );

    for (const request of requests) {
      expect("timezone" in request).toBe(false);
    }
    expect(result.dataForLlm).toContain(
      "Each 1-day bucket is a UTC day, from midnight UTC.",
    );
  });
});

describe("describeBucketCalendar", () => {
  test.each([
    [
      AggregationInterval.Day,
      "a day in America/New_York",
      "from midnight there",
    ],
    [
      AggregationInterval.Week,
      "a week in America/New_York",
      "from midnight on Monday there",
    ],
    [
      AggregationInterval.Month,
      "a month in America/New_York",
      "from midnight on the 1st there",
    ],
    [
      AggregationInterval.Year,
      "a year in America/New_York",
      "from midnight on 1 January there",
    ],
  ] as Array<[AggregationInterval, string, string]>)(
    "a %s bucket in a zone names the zone and where it starts",
    (interval: AggregationInterval, unit: string, start: string) => {
      const sentence: string = describeBucketCalendar({
        interval,
        timezone: Timezone.AmericaNew_York,
      });

      expect(sentence).toContain(unit);
      expect(sentence).toContain(start);
      expect(sentence).toContain("written in UTC");
    },
  );

  test("with no zone, a UTC day", () => {
    expect(
      describeBucketCalendar({
        interval: AggregationInterval.Week,
        timezone: undefined,
      }),
    ).toBe("Each 1-week bucket is a UTC week, from midnight on Monday UTC.");
  });

  test.each([
    AggregationInterval.Minute,
    AggregationInterval.FiveMinutes,
    AggregationInterval.FifteenMinutes,
    AggregationInterval.ThirtyMinutes,
    AggregationInterval.Hour,
    AggregationInterval.Total,
  ])(
    "a %s bucket is the same everywhere: nothing to say",
    (interval: AggregationInterval) => {
      expect(
        describeBucketCalendar({
          interval,
          timezone: Timezone.AmericaNew_York,
        }),
      ).toBe("");
      expect(describeBucketCalendar({ interval, timezone: undefined })).toBe(
        "",
      );
    },
  );
});

/*
 * A CHART KEEPS THE ZONE ITS DAYS WERE CUT IN, AND IS DRAWN IN THOSE DAYS
 * (issue #8206).
 *
 * A chat chart is a snapshot, read later by whoever opens it: every
 * responder of an incident's shared investigation thread, wherever they
 * are, and everyone who reads an autonomous investigation's evidence,
 * whose days are UTC's. Drawn at its instants on the reader's calendar, a
 * day a responder asked for in New York - from 05:00 UTC - sat under the
 * day before in Los Angeles, where 05:00 UTC is 21:00 the evening before,
 * and each UTC day of an investigation's chart sat under the day before in
 * New York. The widget records the zone its days were cut in
 * (AIChatWidgetData.bucketTimezone), and the chart draws each bucket at the
 * start of the same day on the reader's calendar (AIChatChartCalendar), so
 * every reader sees each total under the day it counted.
 */
describe("a chart keeps the zone its days were cut in", () => {
  function resourceArgs(extra: JSONObject): JSONObject {
    return {
      resourceType: AIResourceType.Host,
      resourceId: HOST_ID.toString(),
      signal: "metrics",
      ...windowArgs(30),
      ...extra,
    };
  }

  function bucketTimezoneOf(result: ToolExecutionResult): unknown {
    return result.widget?.data.bucketTimezone;
  }

  // The rows ChartWidget draws: each bucket on its own day, on the reader's calendar.
  function drawnChartOf(result: ToolExecutionResult): Array<ChartDataPoint> {
    const series: AIChatWidgetSeries = onlySeries(result);
    const bucketTimezone: Timezone | undefined = getChartBucketTimezone(
      result.widget?.data,
    );

    return chatChartOf({
      ...series,
      points: series.points.map(
        (point: AIChatWidgetPoint): AIChatWidgetPoint => {
          return {
            ...point,
            x: toReaderCalendarDate(
              OneUptimeDate.fromString(point.x),
              bucketTimezone,
            ).toISOString(),
          };
        },
      ),
    });
  }

  // Each drawn total, under the day of the reader's calendar it is drawn on.
  function drawnTotals(
    rows: Array<ChartDataPoint>,
    seriesName: string,
    readerTimezone: string,
  ): Map<string, number> {
    const totals: Map<string, number> = new Map();

    for (const row of rows) {
      if (row[seriesName] !== undefined) {
        totals.set(
          platformDay(Number(row[CHART_DATA_POINT_DATE_KEY]), readerTimezone),
          row[seriesName] as number,
        );
      }
    }

    return totals;
  }

  // How many days a drawing puts a total the day did not count under.
  function misplacedDays(
    drawn: Map<string, number>,
    expected: Map<string, number>,
  ): number {
    return Array.from(drawn.entries()).filter(
      ([day, total]: [string, number]): boolean => {
        return expected.get(day) !== total;
      },
    ).length;
  }

  function instantsOf(series: AIChatWidgetSeries): Array<Date> {
    return series.points.map((point: AIChatWidgetPoint): Date => {
      return OneUptimeDate.fromString(point.x);
    });
  }

  beforeEach(() => {
    jest.spyOn(HostService, "findBy").mockResolvedValue([
      {
        _id: HOST_ID.toString(),
        name: "web-1",
        hostIdentifier: "web-1",
        lastSeenAt: NOW,
        otelCollectorStatus: "Connected",
        isArchived: false,
      },
    ] as never);
    jest.spyOn(ModelPermission, "getReadScope").mockResolvedValue({
      readableIds: null,
      blockedIds: [],
    });
  });

  describe.each(READERS)("asked in %s", (_name: string, timezone: Timezone) => {
    test("query_metrics' chart of 30 days names the asker's zone", async () => {
      seedHourly(timezone);

      const result: ToolExecutionResult = await QueryMetricsTool.execute(
        { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
        askedIn(timezone),
      );

      expect(bucketTimezoneOf(result)).toBe(timezone);
    });

    test("a chart by attribute names it too", async () => {
      seedHourly(timezone, { "resource.container.name": "api" });

      const result: ToolExecutionResult = await QueryMetricsTool.execute(
        {
          metricName: METRIC,
          aggregationType: "Sum",
          groupBy: ["resource.container.name"],
          ...windowArgs(30),
        },
        askedIn(timezone),
      );

      expect(bucketTimezoneOf(result)).toBe(timezone);
    });

    test("query_resource_telemetry's trend names it, alone and by attribute", async () => {
      seedHourly(timezone, { state: "user" });

      const alone: ToolExecutionResult =
        await QueryResourceTelemetryTool.execute(
          resourceArgs({ metricName: METRIC, aggregationType: "Sum" }),
          askedIn(timezone),
        );
      const byState: ToolExecutionResult =
        await QueryResourceTelemetryTool.execute(
          resourceArgs({ metricName: METRIC, groupBy: ["state"] }),
          askedIn(timezone),
        );

      expect(bucketTimezoneOf(alone)).toBe(timezone);
      expect(bucketTimezoneOf(byState)).toBe(timezone);
    });
  });

  test("a run with no reader - an autonomous investigation, Slack - names UTC, where its days were cut", async () => {
    seedHourly(Timezone.UTC, { state: "user" });

    const metrics: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: METRIC, ...windowArgs(30) },
      noReader(),
    );
    const resource: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        resourceArgs({ metricName: METRIC }),
        noReader(),
      );

    expect(bucketTimezoneOf(metrics)).toBe(Timezone.UTC);
    expect(bucketTimezoneOf(resource)).toBe(Timezone.UTC);
  });

  test("a zone the list does not name is never asked for: the days are UTC's, and the chart says UTC", async () => {
    seedHourly(Timezone.UTC);

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: METRIC, ...windowArgs(30) },
      { ...noReader(), readerTimezone: "Mars/Olympus_Mons" as Timezone },
    );

    expect(bucketTimezoneOf(result)).toBe(Timezone.UTC);
  });

  test.each([1, 3, 7])(
    "a chart of %s days is hours or shorter, the same instants everywhere: no zone kept",
    async (days: number) => {
      seedHourly(Timezone.UTC);

      const result: ToolExecutionResult = await QueryMetricsTool.execute(
        { metricName: METRIC, ...windowArgs(days) },
        askedIn(Timezone.AmericaNew_York),
      );

      expect(result.widget).toBeDefined();
      expect("bucketTimezone" in result.widget!.data).toBe(false);
    },
  );

  test("a chart by attribute keeps a zone exactly when its buckets are days", async () => {
    seedHourly(Timezone.UTC, { "resource.container.name": "api" });

    const groupedOver: (days: number) => Promise<ToolExecutionResult> = (
      days: number,
    ): Promise<ToolExecutionResult> => {
      return QueryMetricsTool.execute(
        {
          metricName: METRIC,
          groupBy: ["resource.container.name"],
          ...windowArgs(days),
        },
        askedIn(Timezone.AmericaNew_York),
      );
    };

    // A day in half hours; three days and a week in days (at most 49 buckets).
    expect("bucketTimezone" in (await groupedOver(1)).widget!.data).toBe(false);
    expect(bucketTimezoneOf(await groupedOver(3))).toBe(
      Timezone.AmericaNew_York,
    );
    expect(bucketTimezoneOf(await groupedOver(7))).toBe(
      Timezone.AmericaNew_York,
    );
  });

  const SHARED_READS: Array<[string, Timezone, Timezone, boolean]> = [
    // West of the asker: drawn at its instant, each day sat under the day before.
    [
      "asked in New York, read in Los Angeles",
      Timezone.AmericaNew_York,
      Timezone.AmericaLos_Angeles,
      true,
    ],
    [
      "asked in Kathmandu, read in Kolkata, 15 minutes west",
      Timezone.AsiaKathmandu,
      Timezone.AsiaKolkata,
      true,
    ],
    [
      "asked in London, read in New York, over both their autumn changes",
      Timezone.EuropeLondon,
      Timezone.AmericaNew_York,
      true,
    ],
    // East of it, by less than a day: the day stayed the same.
    [
      "asked in New York, read in Tokyo",
      Timezone.AmericaNew_York,
      Timezone.AsiaTokyo,
      false,
    ],
    [
      "asked in Kolkata, read on Lord Howe Island",
      Timezone.AsiaKolkata,
      Timezone.AustraliaLord_Howe,
      false,
    ],
  ];

  test.each(SHARED_READS)(
    "a shared thread %s: each day's total sits under the asker's day it counted",
    async (
      _name: string,
      asker: Timezone,
      reader: Timezone,
      wasUnderTheDayBefore: boolean,
    ) => {
      seedHourly(asker);

      const result: ToolExecutionResult = await QueryMetricsTool.execute(
        { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
        askedIn(asker),
      );
      const series: AIChatWidgetSeries = onlySeries(result);
      const expected: Map<string, number> = expectedDailySums(
        asker,
        NOW.getTime() - 30 * DAY,
        NOW.getTime(),
      );

      OneUptimeDate.setUserTimezone(reader);

      expect(drawnTotals(drawnChartOf(result), series.name, reader)).toEqual(
        expected,
      );

      // As it was drawn before: at its instants, on the reader's calendar.
      const before: number = misplacedDays(
        drawnTotals(chatChartOf(series), series.name, reader),
        expected,
      );

      if (wasUnderTheDayBefore) {
        expect(before).toBeGreaterThanOrEqual(29);
      } else {
        expect(before).toBe(0);
      }
    },
  );

  test.each<[string, Timezone, boolean]>([
    ["New York", Timezone.AmericaNew_York, true],
    ["Los Angeles", Timezone.AmericaLos_Angeles, true],
    ["St John's, half an hour off the hour", Timezone.AmericaSt_Johns, true],
    ["Kathmandu", Timezone.AsiaKathmandu, false],
    ["Lord Howe Island", Timezone.AustraliaLord_Howe, false],
  ])(
    "an investigation's UTC days read in %s: each UTC day's total under its own date",
    async (_name: string, reader: Timezone, wasUnderTheDayBefore: boolean) => {
      seedHourly(Timezone.UTC);

      const result: ToolExecutionResult = await QueryMetricsTool.execute(
        { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
        noReader(),
      );
      const series: AIChatWidgetSeries = onlySeries(result);
      const expected: Map<string, number> = expectedDailySums(
        Timezone.UTC,
        NOW.getTime() - 30 * DAY,
        NOW.getTime(),
      );

      OneUptimeDate.setUserTimezone(reader);

      expect(drawnTotals(drawnChartOf(result), series.name, reader)).toEqual(
        expected,
      );
      expect(
        isDrawnOnAnotherCalendar(
          instantsOf(series),
          getChartBucketTimezone(result.widget?.data),
        ),
      ).toBe(true);

      const before: number = misplacedDays(
        drawnTotals(chatChartOf(series), series.name, reader),
        expected,
      );

      if (wasUnderTheDayBefore) {
        expect(before).toBeGreaterThanOrEqual(29);
      } else {
        expect(before).toBe(0);
      }
    },
  );

  test("read in the asker's own zone, nothing moves and nothing is said", async () => {
    seedHourly(Timezone.AmericaNew_York);

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: METRIC, aggregationType: "Sum", ...windowArgs(30) },
      askedIn(Timezone.AmericaNew_York),
    );
    const series: AIChatWidgetSeries = onlySeries(result);

    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    expect(drawnChartOf(result)).toEqual(chatChartOf(series));
    expect(
      isDrawnOnAnotherCalendar(
        instantsOf(series),
        getChartBucketTimezone(result.widget?.data),
      ),
    ).toBe(false);
  });
});
