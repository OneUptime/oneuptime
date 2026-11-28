import {
  MINIMUM_GROUP_STATUS_SECONDS,
  MonitorGroupDailyUptimeRow,
  Service as MonitorStatusTimelineServiceType,
  UptimeDailyAggregateRow,
} from "../../../Server/Services/MonitorStatusTimelineService";
import MonitorPausedBy from "../../../Types/Monitor/MonitorPausedBy";
import { MonitorUptimeSummary } from "../../../Types/Monitor/MonitorUptimeSummary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  UptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import MonitorUptimeSummaryUtil from "../../../Utils/Monitor/MonitorUptimeSummaryUtil";
import UptimeDailyAggregateUtil from "../../../Utils/StatusPage/UptimeDailyAggregateUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * TIME A PAUSE LEFT OUT, COUNTED APART IN THE DAY BUCKETS (issue #11433).
 *
 * A day's time with monitoring off (monitoringOffSeconds) holds both the
 * time someone turned monitoring off and the time an incident declared by
 * hand or scheduled maintenance paused the monitor with no status set - so
 * every reader of it counts that time as it always has. Of it, the paused
 * part comes back apart (pausedSeconds), with what paused it (pausedBy), so
 * the bars can say "paused", and why. Here the shaping steps that read the
 * statements' rows, and the payloads the status page and the Dashboard
 * send the buckets in; the statements themselves run against Postgres in
 * MaintenancePausedTimeUptimePostgres.
 */

const MONITOR_A: string = "11433000-0000-4000-8000-0000000000a1";
const STATUS_UP: string = "11433000-0000-4000-8000-0000000000b1";
const GROUP_X: string = "11433000-0000-4000-8000-0000000000c1";
const HOUR: number = 3600;
const DAY: number = 24 * HOUR;

function row(data: {
  day: string;
  statusId?: string | null;
  seconds: number;
  isMonitoringOff?: boolean;
  pausedBy?: string | null;
}): UptimeDailyAggregateRow {
  const start: Date = new Date(`${data.day}T00:00:00.000Z`);

  return {
    monitorId: MONITOR_A,
    bucketStart: start,
    bucketEnd: new Date(start.getTime() + DAY * 1000),
    daySeconds: String(DAY),
    monitorStatusId: data.statusId === undefined ? null : data.statusId,
    seconds: String(data.seconds),
    isMonitoringOff: data.isMonitoringOff,
    pausedBy: data.pausedBy,
  };
}

function bucketOf(rows: Array<UptimeDailyAggregateRow>): UptimeDayBucket {
  const aggregate: UptimeDailyAggregate =
    MonitorStatusTimelineServiceType.toUptimeDailyAggregate(rows);

  return aggregate.monitors[0]!.buckets[0]!;
}

describe("a monitor's day: toUptimeDailyAggregate", () => {
  test("a day paused for maintenance: all of it off, all of it paused, and why", () => {
    const bucket: UptimeDayBucket = bucketOf([
      row({
        day: "2026-11-05",
        seconds: DAY,
        isMonitoringOff: true,
        pausedBy: MonitorPausedBy.ScheduledMaintenance,
      }),
    ]);

    expect(bucket.coveredSeconds).toBe(0);
    expect(bucket.statusDurations).toEqual([]);
    expect(bucket.monitoringOffSeconds).toBe(DAY);
    expect(bucket.pausedSeconds).toBe(DAY);
    expect(bucket.pausedBy).toBe(MonitorPausedBy.ScheduledMaintenance);
  });

  test("monitoring turned off: off, but nothing paused - as a bucket always read", () => {
    const bucket: UptimeDayBucket = bucketOf([
      row({ day: "2026-11-05", seconds: DAY, isMonitoringOff: true }),
    ]);

    expect(bucket.monitoringOffSeconds).toBe(DAY);
    expect(bucket).not.toHaveProperty("pausedSeconds");
    expect(bucket).not.toHaveProperty("pausedBy");
  });

  test("an incident's pause, maintenance's and monitoring off on one day: each counted, the reasons joined", () => {
    const bucket: UptimeDayBucket = bucketOf([
      row({ day: "2026-11-05", statusId: STATUS_UP, seconds: 6 * HOUR }),
      row({
        day: "2026-11-05",
        seconds: 4 * HOUR,
        isMonitoringOff: true,
        pausedBy: MonitorPausedBy.Incident,
      }),
      row({
        day: "2026-11-05",
        seconds: 8 * HOUR,
        isMonitoringOff: true,
        pausedBy: MonitorPausedBy.ScheduledMaintenance,
      }),
      row({
        day: "2026-11-05",
        seconds: 6 * HOUR,
        isMonitoringOff: true,
        pausedBy: null,
      }),
    ]);

    expect(bucket.coveredSeconds).toBe(6 * HOUR);
    expect(bucket.monitoringOffSeconds).toBe(18 * HOUR);
    expect(bucket.pausedSeconds).toBe(12 * HOUR);
    expect(bucket.pausedBy).toBe(
      MonitorPausedBy.IncidentAndScheduledMaintenance,
    );
  });

  test("a reason no release knows is no pause, and a row with no seconds adds nothing", () => {
    const bucket: UptimeDayBucket = bucketOf([
      row({
        day: "2026-11-05",
        seconds: 3 * HOUR,
        isMonitoringOff: true,
        pausedBy: "Holiday",
      }),
      row({
        day: "2026-11-05",
        seconds: 0,
        isMonitoringOff: true,
        pausedBy: MonitorPausedBy.Incident,
      }),
    ]);

    expect(bucket.monitoringOffSeconds).toBe(3 * HOUR);
    expect(bucket).not.toHaveProperty("pausedSeconds");
  });

  test("rows shaped before pausedBy existed read as monitoring off", () => {
    const old: UptimeDailyAggregateRow = row({
      day: "2026-11-05",
      seconds: DAY,
      isMonitoringOff: true,
    });
    delete (old as Partial<UptimeDailyAggregateRow>).pausedBy;

    const bucket: UptimeDayBucket = bucketOf([old]);

    expect(bucket.monitoringOffSeconds).toBe(DAY);
    expect(bucket).not.toHaveProperty("pausedSeconds");
  });
});

describe("a monitor group's day: toMonitorGroupUptimeDailyAggregate", () => {
  const RANKED: Array<string> = [STATUS_UP];

  function groupDay(
    data: Partial<MonitorGroupDailyUptimeRow>,
  ): UptimeDayBucket {
    return MonitorStatusTimelineServiceType.toMonitorGroupUptimeDailyAggregate({
      rows: [
        {
          groupKey: 1,
          bucketStart: new Date("2026-11-05T00:00:00.000Z"),
          bucketEnd: new Date("2026-11-06T00:00:00.000Z"),
          daySeconds: DAY,
          unions: [0],
          ...data,
        },
      ],
      monitorGroupIds: [new ObjectID(GROUP_X)],
      rankedMonitorStatusIds: RANKED,
      timezone: "UTC",
    }).monitorGroups[0]!.buckets[0]!;
  }

  test("every monitor that was there paused for maintenance: the group's day paused, and why", () => {
    const bucket: UptimeDayBucket = groupDay({
      unions: [0],
      unionWithMonitoringOff: DAY,
      unionWithPaused: DAY,
      pausedByIncident: false,
      pausedForMaintenance: true,
    });

    expect(bucket.monitoringOffSeconds).toBe(DAY);
    expect(bucket.pausedSeconds).toBe(DAY);
    expect(bucket.pausedBy).toBe(MonitorPausedBy.ScheduledMaintenance);
  });

  test("checked for part of the day, paused and off for the rest: the paused time is the union's beyond the checked time", () => {
    const bucket: UptimeDayBucket = groupDay({
      unions: [10 * HOUR],
      unionWithMonitoringOff: DAY,
      unionWithPaused: 18 * HOUR,
      pausedByIncident: true,
      pausedForMaintenance: true,
    });

    expect(bucket.coveredSeconds).toBe(10 * HOUR);
    expect(bucket.monitoringOffSeconds).toBe(14 * HOUR);
    expect(bucket.pausedSeconds).toBe(8 * HOUR);
    expect(bucket.pausedBy).toBe(
      MonitorPausedBy.IncidentAndScheduledMaintenance,
    );
  });

  test("monitoring off for all of them, nothing paused: off, as before", () => {
    const bucket: UptimeDayBucket = groupDay({
      unions: [0],
      unionWithMonitoringOff: DAY,
      unionWithPaused: 0,
      pausedByIncident: false,
      pausedForMaintenance: false,
    });

    expect(bucket.monitoringOffSeconds).toBe(DAY);
    expect(bucket).not.toHaveProperty("pausedSeconds");
    expect(bucket).not.toHaveProperty("pausedBy");
  });

  test("a sliver below a microsecond is no paused time, and paused time is never more than the time off", () => {
    expect(
      groupDay({
        unions: [DAY - HOUR],
        unionWithMonitoringOff: DAY,
        unionWithPaused: DAY - HOUR + MINIMUM_GROUP_STATUS_SECONDS / 2,
        pausedForMaintenance: true,
      }),
    ).not.toHaveProperty("pausedSeconds");

    expect(
      groupDay({
        unions: [0],
        unionWithMonitoringOff: 6 * HOUR,
        // Sums of doubles can come out a hair over the union of everything.
        unionWithPaused: 6 * HOUR + 0.000001,
        pausedByIncident: true,
      }).pausedSeconds,
    ).toBe(6 * HOUR);
  });

  test("rows shaped before the paused union existed read as monitoring off", () => {
    expect(
      groupDay({ unions: [0], unionWithMonitoringOff: DAY }),
    ).not.toHaveProperty("pausedSeconds");
  });
});

describe("the payloads the buckets travel in", () => {
  const PAUSED_DAY: UptimeDayBucket = {
    bucketStart: new Date("2026-11-05T00:00:00.000Z"),
    bucketEnd: new Date("2026-11-06T00:00:00.000Z"),
    daySeconds: DAY,
    coveredSeconds: 6 * HOUR,
    statusDurations: [
      { monitorStatusId: new ObjectID(STATUS_UP), seconds: 6 * HOUR },
    ],
    monitoringOffSeconds: 18 * HOUR,
    pausedSeconds: 12 * HOUR,
    pausedBy: MonitorPausedBy.Incident,
  };

  const OFF_DAY: UptimeDayBucket = {
    bucketStart: new Date("2026-11-06T00:00:00.000Z"),
    bucketEnd: new Date("2026-11-07T00:00:00.000Z"),
    daySeconds: DAY,
    coveredSeconds: 0,
    statusDurations: [],
    monitoringOffSeconds: DAY,
  };

  test("the status page's: a paused day comes back as it went, a day off with nothing paused too", () => {
    const back: Array<UptimeDayBucket> =
      UptimeDailyAggregateUtil.bucketsFromJSON(
        UptimeDailyAggregateUtil.bucketsToJSON([PAUSED_DAY, OFF_DAY]),
      );

    expect(back[0]).toEqual(PAUSED_DAY);
    expect(back[1]).toEqual(OFF_DAY);
    expect(back[1]).not.toHaveProperty("pausedSeconds");

    // Nothing paused sends nothing more.
    expect(
      UptimeDailyAggregateUtil.bucketsToJSON([OFF_DAY])[0] as JSONObject,
    ).not.toHaveProperty("pausedSeconds");
  });

  test("a payload that says more paused time than time off, or no reason, is read as it can be", () => {
    const back: Array<UptimeDayBucket> =
      UptimeDailyAggregateUtil.bucketsFromJSON([
        {
          ...(UptimeDailyAggregateUtil.bucketsToJSON([
            OFF_DAY,
          ])[0] as JSONObject),
          pausedSeconds: 2 * DAY,
          pausedBy: MonitorPausedBy.ScheduledMaintenance,
        },
        {
          ...(UptimeDailyAggregateUtil.bucketsToJSON([
            OFF_DAY,
          ])[0] as JSONObject),
          pausedSeconds: DAY,
        },
        {
          ...(UptimeDailyAggregateUtil.bucketsToJSON([
            OFF_DAY,
          ])[0] as JSONObject),
          pausedSeconds: DAY,
          pausedBy: "Holiday",
        },
      ]);

    expect(back[0]!.pausedSeconds).toBe(DAY);
    expect(back[0]!.pausedBy).toBe(MonitorPausedBy.ScheduledMaintenance);
    expect(back[1]).not.toHaveProperty("pausedSeconds");
    expect(back[2]).not.toHaveProperty("pausedSeconds");
  });

  test("the Dashboard's monitor summary: a paused day comes back as it went", () => {
    const summary: MonitorUptimeSummary = {
      monitorId: new ObjectID(MONITOR_A),
      timezone: "UTC",
      generatedAt: new Date("2026-11-07T00:00:00.000Z"),
      startDate: new Date("2026-11-05T00:00:00.000Z"),
      endDate: new Date("2026-11-07T00:00:00.000Z"),
      buckets: [PAUSED_DAY, OFF_DAY],
      windows: [],
      isComplete: true,
      completeFrom: null,
      statuses: [],
      downtimeStatusIds: [],
    } as unknown as MonitorUptimeSummary;

    const back: MonitorUptimeSummary | null = MonitorUptimeSummaryUtil.fromJSON(
      MonitorUptimeSummaryUtil.toJSON(summary),
    );

    if (!back) {
      throw new Error("The summary did not read back");
    }

    expect(back.buckets[0]).toEqual(PAUSED_DAY);
    expect(back.buckets[1]).toEqual(OFF_DAY);
    expect(back.buckets[1]).not.toHaveProperty("pausedBy");
  });
});
