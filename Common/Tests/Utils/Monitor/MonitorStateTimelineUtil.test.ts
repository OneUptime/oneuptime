/** @timezone UTC */
import { describe, expect, jest, test } from "@jest/globals";
import MonitorStateTimelineUtil, {
  MonitorStateTimelineAxisTick,
  MonitorStateTimelineLegendItem,
  MonitorStateTimelineRow,
  MonitorStateTimelineSegment,
} from "../../../Utils/Monitor/MonitorStateTimelineUtil";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";

/*
 * MonitorStateTimelineUtil turns MonitorStatusTimeline rows into the geometry
 * a state-timeline widget draws. Everything asserted here is arithmetic the
 * renderer cannot check for itself: a bar in the wrong place, a bar of the
 * wrong width, or an uptime figure that disagrees with the bars is a silent
 * wrong answer on a wall display, not a crash.
 *
 * "Now" is pinned, because the util resolves open (endsAt = null) rows against
 * the wall clock through UptimeUtil, and a floating clock would make every
 * percentage in this file drift.
 */

const NOW: Date = new Date("2026-09-01T12:00:00.000Z");

// A one-hour window ending at "now" — the dashboard's default range.
const WINDOW_START: Date = new Date("2026-09-01T11:00:00.000Z");
const WINDOW_END: Date = NOW;

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";

const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const DEGRADED_STATUS_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

interface StatusSpec {
  id: ObjectID;
  name: string;
  color: Color;
  priority: number;
  isOperationalState: boolean;
}

const OPERATIONAL: StatusSpec = {
  id: OPERATIONAL_STATUS_ID,
  name: "Operational",
  color: Green,
  priority: 1,
  isOperationalState: true,
};

const DEGRADED: StatusSpec = {
  id: DEGRADED_STATUS_ID,
  name: "Degraded",
  color: Yellow,
  priority: 2,
  isOperationalState: false,
};

const OFFLINE: StatusSpec = {
  id: OFFLINE_STATUS_ID,
  name: "Offline",
  color: Red,
  priority: 3,
  isOperationalState: false,
};

type CreateTimelineFunction = (data: {
  monitorId: string;
  status: StatusSpec;
  startsAt: string;
  endsAt?: string | undefined;
  omitStatusRelation?: boolean | undefined;
}) => MonitorStatusTimeline;

const createTimeline: CreateTimelineFunction = (data: {
  monitorId: string;
  status: StatusSpec;
  startsAt: string;
  endsAt?: string | undefined;
  omitStatusRelation?: boolean | undefined;
}): MonitorStatusTimeline => {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = new ObjectID(data.monitorId);
  timeline.monitorStatusId = data.status.id;
  timeline.startsAt = new Date(data.startsAt);

  // endsAt is left unset for the live row, which is how the database stores it.
  if (data.endsAt) {
    timeline.endsAt = new Date(data.endsAt);
  }

  if (!data.omitStatusRelation) {
    const monitorStatus: MonitorStatus = new MonitorStatus();
    monitorStatus.id = data.status.id;
    monitorStatus.name = data.status.name;
    monitorStatus.color = data.status.color;
    monitorStatus.priority = data.status.priority;
    monitorStatus.isOperationalState = data.status.isOperationalState;
    timeline.monitorStatus = monitorStatus;
  }

  return timeline;
};

type BuildSegmentsFunction = (
  statusTimelines: Array<MonitorStatusTimeline>,
  monitorId?: string | undefined,
) => Array<MonitorStateTimelineSegment>;

const buildSegments: BuildSegmentsFunction = (
  statusTimelines: Array<MonitorStatusTimeline>,
  monitorId?: string | undefined,
): Array<MonitorStateTimelineSegment> => {
  return MonitorStateTimelineUtil.buildSegments({
    monitorId: monitorId || MONITOR_A,
    statusTimelines: statusTimelines,
    startDate: WINDOW_START,
    endDate: WINDOW_END,
  });
};

describe("MonitorStateTimelineUtil", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe("isWindowValid", () => {
    test("accepts a window whose end is after its start", () => {
      expect(
        MonitorStateTimelineUtil.isWindowValid(WINDOW_START, WINDOW_END),
      ).toBe(true);
    });

    test("rejects a zero-length window", () => {
      /*
       * A zero-length window is what the CUSTOM range resolves to before the
       * user has picked anything; every percentage would divide by zero.
       */
      expect(MonitorStateTimelineUtil.isWindowValid(NOW, NOW)).toBe(false);
    });

    test("rejects an inverted window", () => {
      expect(
        MonitorStateTimelineUtil.isWindowValid(WINDOW_END, WINDOW_START),
      ).toBe(false);
    });
  });

  describe("getPercentOfWindow", () => {
    type PercentFunction = (date: Date) => number;

    const percentOf: PercentFunction = (date: Date): number => {
      return MonitorStateTimelineUtil.getPercentOfWindow({
        date: date,
        startDate: WINDOW_START,
        endDate: WINDOW_END,
      });
    };

    test("puts the window start at 0 and the window end at 100", () => {
      expect(percentOf(WINDOW_START)).toBe(0);
      expect(percentOf(WINDOW_END)).toBe(100);
    });

    test("puts the midpoint at 50", () => {
      expect(percentOf(new Date("2026-09-01T11:30:00.000Z"))).toBe(50);
    });

    test("is linear across the window", () => {
      expect(percentOf(new Date("2026-09-01T11:15:00.000Z"))).toBe(25);
      expect(percentOf(new Date("2026-09-01T11:45:00.000Z"))).toBe(75);
    });

    test("clamps a date before the window to 0", () => {
      /*
       * Callers pass event dates that UptimeUtil has already clipped, but a
       * clamp here is what guarantees the renderer never receives a negative
       * left offset — which CSS would draw outside the lane.
       */
      expect(percentOf(new Date("2020-01-01T00:00:00.000Z"))).toBe(0);
    });

    test("clamps a date after the window to 100", () => {
      expect(percentOf(new Date("2030-01-01T00:00:00.000Z"))).toBe(100);
    });

    test("returns 0 for every date when the window is degenerate", () => {
      expect(
        MonitorStateTimelineUtil.getPercentOfWindow({
          date: NOW,
          startDate: NOW,
          endDate: NOW,
        }),
      ).toBe(0);
    });
  });

  describe("getDowntimeStatuses", () => {
    test("collects the statuses explicitly marked non-operational", () => {
      const statuses: Array<MonitorStatus> =
        MonitorStateTimelineUtil.getDowntimeStatuses([
          createTimeline({
            monitorId: MONITOR_A,
            status: OPERATIONAL,
            startsAt: "2026-09-01T11:00:00.000Z",
            endsAt: "2026-09-01T11:30:00.000Z",
          }),
          createTimeline({
            monitorId: MONITOR_A,
            status: OFFLINE,
            startsAt: "2026-09-01T11:30:00.000Z",
          }),
        ]);

      expect(
        statuses.map((status: MonitorStatus) => {
          return status.name;
        }),
      ).toEqual(["Offline"]);
    });

    test("returns one entry per status however many rows carry it", () => {
      const statuses: Array<MonitorStatus> =
        MonitorStateTimelineUtil.getDowntimeStatuses([
          createTimeline({
            monitorId: MONITOR_A,
            status: OFFLINE,
            startsAt: "2026-09-01T11:05:00.000Z",
            endsAt: "2026-09-01T11:10:00.000Z",
          }),
          createTimeline({
            monitorId: MONITOR_B,
            status: OFFLINE,
            startsAt: "2026-09-01T11:20:00.000Z",
            endsAt: "2026-09-01T11:25:00.000Z",
          }),
        ]);

      /*
       * UptimeUtil matches an event against this list by id, so duplicates
       * would only make the match slower — but a dashboard showing 25 flapping
       * monitors would build a list hundreds of entries long.
       */
      expect(statuses).toHaveLength(1);
    });

    test("treats a status with an unselected isOperationalState as operational", () => {
      const timeline: MonitorStatusTimeline = createTimeline({
        monitorId: MONITOR_A,
        status: OFFLINE,
        startsAt: "2026-09-01T11:00:00.000Z",
      });
      delete timeline.monitorStatus?.isOperationalState;

      /*
       * Under-reporting downtime is the safe direction: inventing an outage
       * from a column that simply was not selected would page someone.
       */
      expect(MonitorStateTimelineUtil.getDowntimeStatuses([timeline])).toEqual(
        [],
      );
    });

    test("ignores rows whose status did not come back joined", () => {
      expect(
        MonitorStateTimelineUtil.getDowntimeStatuses([
          createTimeline({
            monitorId: MONITOR_A,
            status: OFFLINE,
            startsAt: "2026-09-01T11:00:00.000Z",
            omitStatusRelation: true,
          }),
        ]),
      ).toEqual([]);
    });
  });

  describe("getTimelinesForMonitor", () => {
    const rows: Array<MonitorStatusTimeline> = [
      createTimeline({
        monitorId: MONITOR_A,
        status: OPERATIONAL,
        startsAt: "2026-09-01T11:00:00.000Z",
      }),
      createTimeline({
        monitorId: MONITOR_B,
        status: OPERATIONAL,
        startsAt: "2026-09-01T11:00:00.000Z",
      }),
    ];

    test("keeps only the rows belonging to the requested monitor", () => {
      expect(
        MonitorStateTimelineUtil.getTimelinesForMonitor(rows, MONITOR_A),
      ).toHaveLength(1);
      expect(
        MonitorStateTimelineUtil.getTimelinesForMonitor(
          rows,
          MONITOR_A,
        )[0]?.monitorId?.toString(),
      ).toBe(MONITOR_A);
    });

    test("returns nothing for a monitor with no rows", () => {
      expect(
        MonitorStateTimelineUtil.getTimelinesForMonitor(
          rows,
          "99999999-9999-4999-8999-999999999999",
        ),
      ).toEqual([]);
    });

    test("drops a row whose status relation is missing", () => {
      /*
       * UptimeUtil dereferences `monitorStatus.id` without a guard, so one
       * such row thrown at it takes down the whole widget. This filter is the
       * only thing standing between a deleted MonitorStatus and a blank tile.
       */
      expect(
        MonitorStateTimelineUtil.getTimelinesForMonitor(
          [
            createTimeline({
              monitorId: MONITOR_A,
              status: OPERATIONAL,
              startsAt: "2026-09-01T11:00:00.000Z",
              omitStatusRelation: true,
            }),
          ],
          MONITOR_A,
        ),
      ).toEqual([]);
    });
  });

  describe("buildSegments", () => {
    test("places a segment that spans the whole window across the whole lane", () => {
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:00:00.000Z",
        }),
      ]);

      expect(segments).toHaveLength(1);
      expect(segments[0]?.startPercent).toBe(0);
      expect(segments[0]?.widthPercent).toBe(100);
      expect(segments[0]?.label).toBe("Operational");
    });

    test("clips a row that started before the window to the window's left edge", () => {
      /*
       * The single most important case for this widget: a device that went
       * Offline yesterday has exactly ONE row, and it starts in the past. If
       * it were not clipped in, the lane would render empty for the device
       * that has been down the entire time.
       */
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-08-30T09:00:00.000Z",
        }),
      ]);

      expect(segments).toHaveLength(1);
      expect(segments[0]?.startPercent).toBe(0);
      expect(segments[0]?.widthPercent).toBe(100);
      expect(segments[0]?.startDate).toEqual(WINDOW_START);
    });

    test("positions and sizes a segment that starts inside the window", () => {
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:00:00.000Z",
          endsAt: "2026-09-01T11:30:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T11:30:00.000Z",
          endsAt: "2026-09-01T11:45:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:45:00.000Z",
        }),
      ]);

      expect(
        segments.map((segment: MonitorStateTimelineSegment) => {
          return [segment.label, segment.startPercent, segment.widthPercent];
        }),
      ).toEqual([
        ["Operational", 0, 50],
        ["Offline", 50, 25],
        ["Operational", 75, 25],
      ]);
    });

    test("runs the live (endsAt = null) row up to now", () => {
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T11:45:00.000Z",
        }),
      ]);

      expect(segments).toHaveLength(1);
      expect(segments[0]?.endDate).toEqual(NOW);
      expect(segments[0]?.widthPercent).toBe(25);
    });

    test("closes an orphaned open row at its successor rather than running it to now", () => {
      /*
       * A documented production hazard: a write race left ~67.5k rows with
       * endsAt = NULL and a later successor. Rendered naively, that stale row
       * paints the entire lane with a status the monitor left long ago.
       */
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T11:00:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:30:00.000Z",
        }),
      ]);

      expect(
        segments.map((segment: MonitorStateTimelineSegment) => {
          return [segment.label, segment.startPercent, segment.widthPercent];
        }),
      ).toEqual([
        ["Offline", 0, 50],
        ["Operational", 50, 50],
      ]);
    });

    test("drops a row that ends before the window opens", () => {
      expect(
        buildSegments([
          createTimeline({
            monitorId: MONITOR_A,
            status: OFFLINE,
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-08-01T01:00:00.000Z",
          }),
        ]),
      ).toEqual([]);
    });

    test("ignores rows belonging to another monitor", () => {
      expect(
        buildSegments([
          createTimeline({
            monitorId: MONITOR_B,
            status: OFFLINE,
            startsAt: "2026-09-01T11:00:00.000Z",
          }),
        ]),
      ).toEqual([]);
    });

    test("returns nothing for a degenerate window", () => {
      expect(
        MonitorStateTimelineUtil.buildSegments({
          monitorId: MONITOR_A,
          statusTimelines: [
            createTimeline({
              monitorId: MONITOR_A,
              status: OPERATIONAL,
              startsAt: "2026-09-01T11:00:00.000Z",
            }),
          ],
          startDate: NOW,
          endDate: NOW,
        }),
      ).toEqual([]);
    });

    test("carries the configured status colour through, not a hardcoded one", () => {
      /*
       * Monitor status colours are a per-project setting. The widget's whole
       * colour scheme is whatever the operator configured there, so a literal
       * leaking in here would silently override their choice.
       */
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: DEGRADED,
          startsAt: "2026-09-01T11:00:00.000Z",
        }),
      ]);

      expect(segments[0]?.color).toBe(Yellow.toString());
      expect(segments[0]?.monitorStatusId).toBe(DEGRADED_STATUS_ID.toString());
    });

    test("reports each segment's real duration in seconds", () => {
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:00:00.000Z",
          endsAt: "2026-09-01T11:30:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T11:30:00.000Z",
        }),
      ]);

      expect(segments[0]?.durationInSeconds).toBe(1800);
      expect(segments[1]?.durationInSeconds).toBe(1800);
    });

    test("returns segments in chronological order whatever order the rows arrive in", () => {
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T11:30:00.000Z",
          endsAt: "2026-09-01T11:45:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:00:00.000Z",
          endsAt: "2026-09-01T11:30:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:45:00.000Z",
        }),
      ]);

      /*
       * Order is not cosmetic: the renderer takes the LAST segment as the
       * monitor's current status and as the moment it last changed.
       */
      expect(
        segments.map((segment: MonitorStateTimelineSegment) => {
          return segment.startPercent;
        }),
      ).toEqual([0, 50, 75]);
    });

    test("never emits a zero-width segment", () => {
      /*
       * A row that ends exactly when the window opens overlaps it by nothing.
       * The server's overlap predicate is inclusive and returns such a row, so
       * the geometry has to be the thing that discards it.
       */
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:00:00.000Z",
        }),
      ]);

      for (const segment of segments) {
        expect(segment.widthPercent).toBeGreaterThan(0);
      }
      expect(
        segments.map((segment: MonitorStateTimelineSegment) => {
          return segment.label;
        }),
      ).toEqual(["Operational"]);
    });

    test("segments tile the window without gaps or overlap", () => {
      const segments: Array<MonitorStateTimelineSegment> = buildSegments([
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:12:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: DEGRADED,
          startsAt: "2026-09-01T11:12:00.000Z",
          endsAt: "2026-09-01T11:36:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T11:36:00.000Z",
        }),
      ]);

      let cursor: number = 0;
      for (const segment of segments) {
        expect(segment.startPercent).toBeCloseTo(cursor, 6);
        cursor = segment.startPercent + segment.widthPercent;
      }
      expect(cursor).toBeCloseTo(100, 6);
    });
  });

  describe("buildRows", () => {
    type BuildRowsFunction = (
      statusTimelines: Array<MonitorStatusTimeline>,
    ) => Array<MonitorStateTimelineRow>;

    const buildTwoLanes: BuildRowsFunction = (
      statusTimelines: Array<MonitorStatusTimeline>,
    ): Array<MonitorStateTimelineRow> => {
      return MonitorStateTimelineUtil.buildRows({
        monitors: [
          { monitorId: MONITOR_A, monitorName: "core-switch-01" },
          { monitorId: MONITOR_B, monitorName: "ap-lobby-02" },
        ],
        statusTimelines: statusTimelines,
        startDate: WINDOW_START,
        endDate: WINDOW_END,
      });
    };

    test("emits one lane per monitor, in the order the monitors were given", () => {
      const rows: Array<MonitorStateTimelineRow> = buildTwoLanes([]);

      expect(
        rows.map((row: MonitorStateTimelineRow) => {
          return row.monitorName;
        }),
      ).toEqual(["core-switch-01", "ap-lobby-02"]);
    });

    test("gives a monitor with no history an empty lane and no uptime figure", () => {
      const rows: Array<MonitorStateTimelineRow> = buildTwoLanes([]);

      /*
       * null, not 0 and not 100: "we have no data for this device in this
       * window" is a third answer, and rendering it as either number would be
       * a claim the data does not support.
       */
      expect(rows[0]?.segments).toEqual([]);
      expect(rows[0]?.uptimePercent).toBeNull();
      expect(rows[0]?.currentStatusName).toBeUndefined();
      expect(rows[0]?.lastStatusChangeAt).toBeNull();
    });

    test("keeps each monitor's rows in its own lane", () => {
      const rows: Array<MonitorStateTimelineRow> = buildTwoLanes([
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:00:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_B,
          status: OFFLINE,
          startsAt: "2026-09-01T11:00:00.000Z",
        }),
      ]);

      expect(rows[0]?.currentStatusName).toBe("Operational");
      expect(rows[1]?.currentStatusName).toBe("Offline");
    });

    test("reports 100% uptime for a monitor that was operational throughout", () => {
      const rows: Array<MonitorStateTimelineRow> = buildTwoLanes([
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T10:00:00.000Z",
        }),
      ]);

      expect(rows[0]?.uptimePercent).toBe(100);
    });

    test("reports uptime that matches the share of the window spent down", () => {
      const rows: Array<MonitorStateTimelineRow> = buildTwoLanes([
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:45:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T11:45:00.000Z",
        }),
      ]);

      // 15 minutes offline out of a 60 minute window.
      expect(rows[0]?.uptimePercent).toBe(75);
    });

    test("counts only non-operational statuses as downtime", () => {
      const rows: Array<MonitorStateTimelineRow> = buildTwoLanes([
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:30:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: DEGRADED,
          startsAt: "2026-09-01T11:30:00.000Z",
        }),
      ]);

      /*
       * Degraded is seeded as a non-operational state, so half a window spent
       * degraded is half a window of downtime.
       */
      expect(rows[0]?.uptimePercent).toBe(50);
    });

    test("honours the requested uptime precision", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:59:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T11:59:00.000Z",
        }),
      ];

      const twoDecimals: Array<MonitorStateTimelineRow> =
        MonitorStateTimelineUtil.buildRows({
          monitors: [{ monitorId: MONITOR_A, monitorName: "core-switch-01" }],
          statusTimelines: timelines,
          startDate: WINDOW_START,
          endDate: WINDOW_END,
        });

      const noDecimals: Array<MonitorStateTimelineRow> =
        MonitorStateTimelineUtil.buildRows({
          monitors: [{ monitorId: MONITOR_A, monitorName: "core-switch-01" }],
          statusTimelines: timelines,
          startDate: WINDOW_START,
          endDate: WINDOW_END,
          uptimePrecision: UptimePrecision.NO_DECIMAL,
        });

      expect(twoDecimals[0]?.uptimePercent).toBe(98.33);
      expect(noDecimals[0]?.uptimePercent).toBe(98);
    });

    test("takes the current status and last change from the final segment", () => {
      const rows: Array<MonitorStateTimelineRow> = buildTwoLanes([
        createTimeline({
          monitorId: MONITOR_A,
          status: OPERATIONAL,
          startsAt: "2026-09-01T11:00:00.000Z",
          endsAt: "2026-09-01T11:20:00.000Z",
        }),
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-09-01T11:20:00.000Z",
        }),
      ]);

      expect(rows[0]?.currentStatusName).toBe("Offline");
      expect(rows[0]?.currentStatusColor).toBe(Red.toString());
      expect(rows[0]?.lastStatusChangeAt).toEqual(
        new Date("2026-09-01T11:20:00.000Z"),
      );
    });

    test("reports the CLIPPED change time when the status last changed before the window", () => {
      const rows: Array<MonitorStateTimelineRow> = buildTwoLanes([
        createTimeline({
          monitorId: MONITOR_A,
          status: OFFLINE,
          startsAt: "2026-08-30T09:00:00.000Z",
        }),
      ]);

      /*
       * Everything in a lane is expressed in the window's own terms, so the
       * "last change" a viewer reads matches the bar they are looking at
       * rather than a moment off the left of the chart.
       */
      expect(rows[0]?.lastStatusChangeAt).toEqual(WINDOW_START);
    });

    test("does not report uptime when the window is degenerate", () => {
      const rows: Array<MonitorStateTimelineRow> =
        MonitorStateTimelineUtil.buildRows({
          monitors: [{ monitorId: MONITOR_A, monitorName: "core-switch-01" }],
          statusTimelines: [
            createTimeline({
              monitorId: MONITOR_A,
              status: OFFLINE,
              startsAt: "2026-09-01T10:00:00.000Z",
            }),
          ],
          startDate: NOW,
          endDate: NOW,
        });

      expect(rows[0]?.segments).toEqual([]);
      expect(rows[0]?.uptimePercent).toBeNull();
    });

    test("survives a row whose status was deleted out from under it", () => {
      expect(() => {
        return buildTwoLanes([
          createTimeline({
            monitorId: MONITOR_A,
            status: OPERATIONAL,
            startsAt: "2026-09-01T11:00:00.000Z",
            omitStatusRelation: true,
          }),
        ]);
      }).not.toThrow();
    });
  });

  describe("getAxisTicks", () => {
    test("returns the requested number of ticks, spanning both edges", () => {
      const ticks: Array<MonitorStateTimelineAxisTick> =
        MonitorStateTimelineUtil.getAxisTicks({
          startDate: WINDOW_START,
          endDate: WINDOW_END,
          tickCount: 5,
        });

      expect(ticks).toHaveLength(5);
      expect(ticks[0]?.percent).toBe(0);
      expect(ticks[4]?.percent).toBe(100);
      expect(ticks[0]?.date).toEqual(WINDOW_START);
      expect(ticks[4]?.date).toEqual(WINDOW_END);
    });

    test("spaces the ticks evenly", () => {
      const ticks: Array<MonitorStateTimelineAxisTick> =
        MonitorStateTimelineUtil.getAxisTicks({
          startDate: WINDOW_START,
          endDate: WINDOW_END,
          tickCount: 3,
        });

      expect(
        ticks.map((tick: MonitorStateTimelineAxisTick) => {
          return tick.percent;
        }),
      ).toEqual([0, 50, 100]);
      expect(ticks[1]?.date).toEqual(new Date("2026-09-01T11:30:00.000Z"));
    });

    test("returns nothing when asked for fewer than two ticks", () => {
      /*
       * One tick has no defined position — the fraction would divide by zero —
       * and an axis of one label is not an axis.
       */
      expect(
        MonitorStateTimelineUtil.getAxisTicks({
          startDate: WINDOW_START,
          endDate: WINDOW_END,
          tickCount: 1,
        }),
      ).toEqual([]);
      expect(
        MonitorStateTimelineUtil.getAxisTicks({
          startDate: WINDOW_START,
          endDate: WINDOW_END,
          tickCount: 0,
        }),
      ).toEqual([]);
    });

    test("returns nothing for a degenerate window", () => {
      expect(
        MonitorStateTimelineUtil.getAxisTicks({
          startDate: NOW,
          endDate: NOW,
          tickCount: 4,
        }),
      ).toEqual([]);
    });
  });

  describe("getLegend", () => {
    test("lists each distinct status once, in first-appearance order", () => {
      const rows: Array<MonitorStateTimelineRow> =
        MonitorStateTimelineUtil.buildRows({
          monitors: [
            { monitorId: MONITOR_A, monitorName: "core-switch-01" },
            { monitorId: MONITOR_B, monitorName: "ap-lobby-02" },
          ],
          statusTimelines: [
            createTimeline({
              monitorId: MONITOR_A,
              status: OPERATIONAL,
              startsAt: "2026-09-01T11:00:00.000Z",
              endsAt: "2026-09-01T11:30:00.000Z",
            }),
            createTimeline({
              monitorId: MONITOR_A,
              status: OFFLINE,
              startsAt: "2026-09-01T11:30:00.000Z",
            }),
            createTimeline({
              monitorId: MONITOR_B,
              status: OFFLINE,
              startsAt: "2026-09-01T11:00:00.000Z",
              endsAt: "2026-09-01T11:15:00.000Z",
            }),
            createTimeline({
              monitorId: MONITOR_B,
              status: DEGRADED,
              startsAt: "2026-09-01T11:15:00.000Z",
            }),
          ],
          startDate: WINDOW_START,
          endDate: WINDOW_END,
        });

      expect(
        MonitorStateTimelineUtil.getLegend(rows).map(
          (item: MonitorStateTimelineLegendItem) => {
            return item.label;
          },
        ),
      ).toEqual(["Operational", "Offline", "Degraded"]);
    });

    test("carries each status's configured colour", () => {
      const rows: Array<MonitorStateTimelineRow> =
        MonitorStateTimelineUtil.buildRows({
          monitors: [{ monitorId: MONITOR_A, monitorName: "core-switch-01" }],
          statusTimelines: [
            createTimeline({
              monitorId: MONITOR_A,
              status: OFFLINE,
              startsAt: "2026-09-01T11:00:00.000Z",
            }),
          ],
          startDate: WINDOW_START,
          endDate: WINDOW_END,
        });

      expect(MonitorStateTimelineUtil.getLegend(rows)).toEqual([
        {
          monitorStatusId: OFFLINE_STATUS_ID.toString(),
          label: "Offline",
          color: Red.toString(),
        },
      ]);
    });

    test("explains nothing when nothing is drawn", () => {
      expect(MonitorStateTimelineUtil.getLegend([])).toEqual([]);
    });
  });
});
