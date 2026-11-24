import { afterEach, describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import Query from "Common/Types/BaseDatabase/Query";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import Timezone from "Common/Types/Timezone";
import { HistogramBucket } from "Common/UI/Components/TelemetryViewer/types";
import { getHistogramSelectionWindow } from "Common/UI/Components/Charts/Utils/HistogramSelection";
import {
  SecurityEventVolume,
  buildSecurityEventVolume,
  buildSecurityEventVolumeAggregateBy,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventVolume";

/*
 * THE SECURITY EVENTS VOLUME ON THE READER'S DAYS (issue #7923).
 *
 * The volume chart asked for UTC's days on purpose: it lays a window of days
 * out on a grid and snaps each row onto it, and the grid was the epoch's.
 * So a day bar ran 19:00 to 19:00 in New York, while every other chart of
 * days starts at the reader's midnight. The viewer now hands it the reader's
 * zone (AggregationIntervalUtil.getReaderTimezone of the window): the
 * aggregate asks for that zone's days, and the grid is laid out on the same
 * calendar - one slot a New York day, from New York's midnight, 25 hours on
 * 1 November - so every count stays on its own day, and a click on a day's
 * bar opens exactly that day.
 */

const NEW_YORK: Timezone = Timezone.AmericaNew_York;

const query: Query<SecurityEvent> = {
  projectId: new ObjectID("7d00000000000000000000e1"),
} as Query<SecurityEvent>;

// Forty days across New York's clocks going back on 1 November.
const WINDOW: { startDate: Date; endDate: Date } = {
  startDate: new Date("2026-10-10T16:00:00.000Z"),
  endDate: new Date("2026-11-19T16:00:00.000Z"),
};

function row(
  time: string,
  severity: OcsfSeverity,
  count: number,
): AggregatedModel {
  return {
    timestamp: new Date(time),
    value: count,
    severityName: severity,
  } as unknown as AggregatedModel;
}

function slotTimes(volume: SecurityEventVolume): Array<string> {
  return Array.from(
    new Set(
      volume.buckets.map((bucket: HistogramBucket): string => {
        return bucket.time;
      }),
    ),
  );
}

function nonEmpty(volume: SecurityEventVolume): Array<HistogramBucket> {
  return volume.buckets.filter((bucket: HistogramBucket): boolean => {
    return bucket.count > 0;
  });
}

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
});

describe("the aggregate the volume asks for", () => {
  test("handed the reader's zone, asks for their days", () => {
    const aggregateBy: AggregateBy<SecurityEvent> =
      buildSecurityEventVolumeAggregateBy({
        query: query,
        ...WINDOW,
        timezone: NEW_YORK,
      });

    expect(aggregateBy.timezone).toBe(NEW_YORK);
    // What AnalyticsModelAPI.aggregate sends: the zone named is kept.
    expect(
      AggregationIntervalUtil.withReaderTimezone(aggregateBy).timezone,
    ).toBe(NEW_YORK);
  });

  test("the zone the viewer hands it is the reader's for a window of days, and none for a window of hours", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    expect(AggregationIntervalUtil.getReaderTimezone(WINDOW)).toBe(
      Timezone.AsiaKolkata,
    );
    expect(
      AggregationIntervalUtil.getReaderTimezone({
        startDate: new Date("2026-11-19T10:00:00.000Z"),
        endDate: new Date("2026-11-19T16:00:00.000Z"),
      }),
    ).toBeUndefined();
  });
});

describe("the volume, laid out on the reader's days", () => {
  test("one slot per New York day, each at New York's midnight, the 25-hour 1 November included", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      ...WINDOW,
      timezone: NEW_YORK,
    });
    const slots: Array<string> = slotTimes(volume);

    expect(volume.interval).toBe(AggregationInterval.Day);
    expect(volume.bucketTimezone).toBe(NEW_YORK);
    // 10 October to 19 November, New York's days.
    expect(slots).toHaveLength(41);
    expect(slots[0]).toBe("2026-10-10T04:00:00.000Z");
    expect(slots).toContain("2026-10-31T04:00:00.000Z");
    expect(slots).toContain("2026-11-01T04:00:00.000Z");
    // The day after the clocks went back starts an hour later in UTC.
    expect(slots).toContain("2026-11-02T05:00:00.000Z");
    expect(slots[slots.length - 1]).toBe("2026-11-19T05:00:00.000Z");
    expect(new Set(slots).size).toBe(slots.length);
  });

  test("the counts the server cut at New York's midnights stay on their own days", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [
        row("2026-11-01T04:00:00.000Z", OcsfSeverity.High, 3),
        row("2026-11-02T05:00:00.000Z", OcsfSeverity.Low, 2),
      ],
      ...WINDOW,
      timezone: NEW_YORK,
    });

    expect(nonEmpty(volume)).toEqual([
      { time: "2026-11-01T04:00:00.000Z", series: OcsfSeverity.High, count: 3 },
      { time: "2026-11-02T05:00:00.000Z", series: OcsfSeverity.Low, count: 2 },
    ]);
    expect(volume.total).toBe(5);
  });

  test("a click on 1 November's bar opens its 25 hours, to 2 November's midnight", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      ...WINDOW,
      timezone: NEW_YORK,
    });

    expect(
      getHistogramSelectionWindow({
        fromBucket: "2026-11-01T04:00:00.000Z",
        toBucket: "2026-11-01T04:00:00.000Z",
        bucketIntervalMs: volume.intervalMs,
        bucketTimezone: volume.bucketTimezone,
      }),
    ).toEqual({
      startTime: new Date("2026-11-01T04:00:00.000Z"),
      endTime: new Date("2026-11-02T05:00:00.000Z"),
    });
  });

  test("handed no zone, the days are UTC's, as before", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      ...WINDOW,
    });
    const slots: Array<string> = slotTimes(volume);

    expect(volume.bucketTimezone).toBe(Timezone.UTC);
    for (const slot of slots) {
      expect(slot.slice(11)).toBe("00:00:00.000Z");
    }
  });

  test("a window of hours names no zone: its buckets are the same instants everywhere", () => {
    const volume: SecurityEventVolume = buildSecurityEventVolume({
      rows: [],
      startDate: new Date("2026-11-19T10:00:00.000Z"),
      endDate: new Date("2026-11-19T16:00:00.000Z"),
      timezone: NEW_YORK,
    });

    expect(volume.interval).not.toBe(AggregationInterval.Day);
    expect(volume.bucketTimezone).toBeUndefined();
  });
});
