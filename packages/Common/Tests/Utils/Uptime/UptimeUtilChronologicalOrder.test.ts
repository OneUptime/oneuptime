import UptimeUtil, { UptimeWindow } from "../../../Utils/Uptime/UptimeUtil";
import Event from "../../../Utils/Uptime/Event";
import MonitorEvent from "../../../Utils/Uptime/MonitorEvent";
import { Green, Red } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";

/*
 * Regression tests for the grey bars at the end of status.chainflip.io (root cause 1).
 *
 * Three flapping monitors (lp, auctions, scan) write most of their status transitions within
 * the same wall-clock second: Offline at 12:47:40.326, back to Operational at 12:47:40.540.
 * The server sends the timeline rows newest-first (startsAt DESC). Before the fix,
 * UptimeUtil.getMonitorEventsForId sorted them with OneUptimeDate.isAfter, which compares at
 * SECOND granularity, so the two rows compared as equal and the (stable) sort left them in
 * the server's newest-first order. The still-open Operational row then came BEFORE the
 * Offline row, took that row's startsAt as its own end, and produced the event
 * 12:47:40.540 -> 12:47:40.326 - an event that ends before it starts. The monitor's current
 * status never reached "now", so today's bar had no events and was painted the page's
 * default (grey) colour while the monitor was up.
 *
 * Every assertion here is relative to a pinned "now" so the numbers are stable whatever day
 * or time zone the suite runs in; all timestamps are UTC ISO strings.
 */
const NOW: Date = new Date("2026-09-22T09:00:00.000Z");

const LP_MONITOR_ID: ObjectID = new ObjectID(
  "5a5a5a5a-1111-4111-8111-111111111111",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "5a5a5a5a-2222-4222-8222-222222222222",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "5a5a5a5a-3333-4333-8333-333333333333",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "5a5a5a5a-4444-4444-8444-444444444444",
);

const offlineStatus: MonitorStatus = new MonitorStatus();
offlineStatus.id = OFFLINE_STATUS_ID;
offlineStatus.name = "Offline";
offlineStatus.priority = 2;
offlineStatus.color = Red;

// Degraded + Offline are the page's downtime statuses; only Offline appears in these rows.
const downtimeStatuses: Array<MonitorStatus> = [offlineStatus];

type StatusName = "Offline" | "Operational";

interface TimelineData {
  status: StatusName;
  startsAt: string;
  endsAt?: string | undefined;
  monitorId?: ObjectID | undefined;
  // leave the dates as strings, the way a JSON payload looks before it is turned into Dates.
  keepDatesAsStrings?: boolean | undefined;
}

type CreateTimelineFunction = (data: TimelineData) => MonitorStatusTimeline;

const createTimeline: CreateTimelineFunction = (
  data: TimelineData,
): MonitorStatusTimeline => {
  const isOffline: boolean = data.status === "Offline";

  const monitorStatus: MonitorStatus = new MonitorStatus();
  monitorStatus.id = isOffline ? OFFLINE_STATUS_ID : OPERATIONAL_STATUS_ID;
  monitorStatus.name = data.status;
  monitorStatus.priority = isOffline ? 2 : 1;
  monitorStatus.color = isOffline ? Red : Green;

  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = data.monitorId || LP_MONITOR_ID;
  timeline.monitorStatusId = monitorStatus.id;
  timeline.monitorStatus = monitorStatus;

  timeline.startsAt = data.keepDatesAsStrings
    ? (data.startsAt as unknown as Date)
    : new Date(data.startsAt);

  // endsAt is left unset for open rows, which is what the current status looks like in the database.
  if (data.endsAt) {
    timeline.endsAt = data.keepDatesAsStrings
      ? (data.endsAt as unknown as Date)
      : new Date(data.endsAt);
  }

  return timeline;
};

type StatusTimelineFunction = (
  startsAt: string,
  endsAt?: string | undefined,
  monitorId?: ObjectID | undefined,
) => MonitorStatusTimeline;

const offline: StatusTimelineFunction = (
  startsAt: string,
  endsAt?: string | undefined,
  monitorId?: ObjectID | undefined,
): MonitorStatusTimeline => {
  return createTimeline({ status: "Offline", startsAt, endsAt, monitorId });
};

const operational: StatusTimelineFunction = (
  startsAt: string,
  endsAt?: string | undefined,
  monitorId?: ObjectID | undefined,
): MonitorStatusTimeline => {
  return createTimeline({ status: "Operational", startsAt, endsAt, monitorId });
};

type ToIsoFunction = (date: Date | string) => string;

// events can carry string dates when the rows did, so normalise before printing.
const toIso: ToIsoFunction = (date: Date | string): string => {
  return OneUptimeDate.fromString(date).toISOString();
};

type DescribeEventsFunction = (events: Array<Event>) => Array<string>;

/*
 * One readable line per event, so a failure prints the whole timeline rather than a single
 * mismatching field.
 */
const describeEvents: DescribeEventsFunction = (
  events: Array<Event>,
): Array<string> => {
  return events.map((event: Event): string => {
    return `${toIso(event.startDate)} -> ${toIso(event.endDate)} ${event.label}`;
  });
};

type EventCheckFunction = (events: Array<Event>) => void;

const expectNoEventEndsBeforeItStarts: EventCheckFunction = (
  events: Array<Event>,
): void => {
  const backwardsEvents: Array<string> = describeEvents(
    events.filter((event: Event): boolean => {
      return (
        OneUptimeDate.fromString(event.endDate).getTime() <
        OneUptimeDate.fromString(event.startDate).getTime()
      );
    }),
  );

  expect(backwardsEvents).toEqual([]);
};

// each event must pick up exactly where the one before it left off - no gaps, no overlaps.
const expectContiguous: EventCheckFunction = (events: Array<Event>): void => {
  for (let i: number = 1; i < events.length; i++) {
    expect(toIso(events[i]!.startDate)).toBe(toIso(events[i - 1]!.endDate));
  }
};

const expectStartsInChronologicalOrder: EventCheckFunction = (
  events: Array<Event>,
): void => {
  const startTimes: Array<number> = events.map((event: Event): number => {
    return OneUptimeDate.fromString(event.startDate).getTime();
  });

  const sortedStartTimes: Array<number> = [...startTimes].sort(
    (a: number, b: number): number => {
      return a - b;
    },
  );

  expect(startTimes).toEqual(sortedStartTimes);
};

type PermutationsFunction = (
  items: Array<MonitorStatusTimeline>,
) => Array<Array<MonitorStatusTimeline>>;

const getAllPermutations: PermutationsFunction = (
  items: Array<MonitorStatusTimeline>,
): Array<Array<MonitorStatusTimeline>> => {
  if (items.length <= 1) {
    return [[...items]];
  }

  const permutations: Array<Array<MonitorStatusTimeline>> = [];

  for (let i: number = 0; i < items.length; i++) {
    const rest: Array<MonitorStatusTimeline> = [
      ...items.slice(0, i),
      ...items.slice(i + 1),
    ];

    for (const permutation of getAllPermutations(rest)) {
      permutations.push([items[i]!, ...permutation]);
    }
  }

  return permutations;
};

type ShuffleFunction = (
  items: Array<MonitorStatusTimeline>,
  seed: number,
) => Array<MonitorStatusTimeline>;

/*
 * Fisher-Yates driven by a Park-Miller generator, so every run shuffles the same way. The
 * products stay well below 2^53, so plain arithmetic is exact.
 */
const shuffleDeterministically: ShuffleFunction = (
  items: Array<MonitorStatusTimeline>,
  seed: number,
): Array<MonitorStatusTimeline> => {
  const modulus: number = 2147483647;
  const shuffled: Array<MonitorStatusTimeline> = [...items];

  let state: number = seed % modulus;

  if (state <= 0) {
    state += modulus - 1;
  }

  for (let i: number = shuffled.length - 1; i > 0; i--) {
    state = (state * 16807) % modulus;
    const j: number = state % (i + 1);
    const temp: MonitorStatusTimeline = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }

  return shuffled;
};

type PreFixCompareFunction = (
  a: MonitorStatusTimeline,
  b: MonitorStatusTimeline,
) => number;

/*
 * A verbatim copy of the comparator getMonitorEventsForId used BEFORE the fix. It is used only
 * to prove the fixtures below really trigger the bug; the code under test no longer uses it.
 */
const preFixCompare: PreFixCompareFunction = (
  a: MonitorStatusTimeline,
  b: MonitorStatusTimeline,
): number => {
  if (!a.startsAt || !b.startsAt) {
    return 0;
  }

  if (OneUptimeDate.isAfter(a.startsAt!, b.startsAt!)) {
    return 1;
  }

  if (OneUptimeDate.isAfter(b.startsAt!, a.startsAt!)) {
    return -1;
  }

  return 0;
};

/*
 * The last six timeline rows of lp.chainflip.io, as they are in production (all on 2026-09-21
 * UTC). They are written oldest-first here for readability and handed to the code
 * newest-first below, which is the order the status page API returns them in.
 */
const LP_TAIL_OLDEST_FIRST: Array<MonitorStatusTimeline> = [
  offline("2026-09-21T12:46:25.880Z", "2026-09-21T12:46:26.077Z"),
  operational("2026-09-21T12:46:26.077Z", "2026-09-21T12:47:35.727Z"),
  offline("2026-09-21T12:47:35.727Z", "2026-09-21T12:47:36.178Z"),
  operational("2026-09-21T12:47:36.178Z", "2026-09-21T12:47:40.326Z"),
  offline("2026-09-21T12:47:40.326Z", "2026-09-21T12:47:40.540Z"),
  // the current status: still open.
  operational("2026-09-21T12:47:40.540Z"),
];

const LP_TAIL_NEWEST_FIRST: Array<MonitorStatusTimeline> = [
  ...LP_TAIL_OLDEST_FIRST,
].reverse();

const LP_TAIL_EXPECTED_EVENTS: Array<string> = [
  "2026-09-21T12:46:25.880Z -> 2026-09-21T12:46:26.077Z Offline",
  "2026-09-21T12:46:26.077Z -> 2026-09-21T12:47:35.727Z Operational",
  "2026-09-21T12:47:35.727Z -> 2026-09-21T12:47:36.178Z Offline",
  "2026-09-21T12:47:36.178Z -> 2026-09-21T12:47:40.326Z Operational",
  "2026-09-21T12:47:40.326Z -> 2026-09-21T12:47:40.540Z Offline",
  "2026-09-21T12:47:40.540Z -> 2026-09-22T09:00:00.000Z Operational",
];

/*
 * A flapping monitor: Operational, then a 200 ms Offline blip, 500 times. Each blip and its
 * recovery sit inside one wall-clock second (Offline at :x0.300, Operational at :x0.500), ten
 * seconds apart. 1 + 500 * 2 = 1001 rows; the final Operational row is the current status.
 */
const FLAP_BASE_MS: number = new Date("2026-09-21T00:00:00.000Z").getTime();
const FLAP_CYCLES: number = 500;
const FLAP_CYCLE_MS: number = 10000;
const FLAP_OFFLINE_OFFSET_MS: number = 300;
const FLAP_RECOVERY_OFFSET_MS: number = 500;
const FLAP_BLIP_SECONDS: number = 0.2;

// first row (2026-09-21T00:00:00Z) -> NOW (2026-09-22T09:00:00Z) is 33 hours.
const FLAP_PERIOD_SECONDS: number = 33 * 60 * 60;

type BuildFlappingRowsFunction = (data: {
  closeRows: boolean;
}) => Array<MonitorStatusTimeline>;

/*
 * closeRows: true is the production shape - every row but the current one carries the endsAt
 * the service wrote when the next row opened. closeRows: false leaves every endsAt unset, so
 * each row's end comes from the start of the next row in sort order.
 */
const buildFlappingRowsNewestFirst: BuildFlappingRowsFunction = (data: {
  closeRows: boolean;
}): Array<MonitorStatusTimeline> => {
  const starts: Array<{ status: StatusName; startMs: number }> = [
    { status: "Operational", startMs: FLAP_BASE_MS },
  ];

  for (let cycle: number = 1; cycle <= FLAP_CYCLES; cycle++) {
    const secondStartMs: number = FLAP_BASE_MS + cycle * FLAP_CYCLE_MS;

    starts.push({
      status: "Offline",
      startMs: secondStartMs + FLAP_OFFLINE_OFFSET_MS,
    });
    starts.push({
      status: "Operational",
      startMs: secondStartMs + FLAP_RECOVERY_OFFSET_MS,
    });
  }

  const rowsOldestFirst: Array<MonitorStatusTimeline> = starts.map(
    (
      start: { status: StatusName; startMs: number },
      index: number,
    ): MonitorStatusTimeline => {
      const next: { status: StatusName; startMs: number } | undefined =
        starts[index + 1];

      return createTimeline({
        status: start.status,
        startsAt: new Date(start.startMs).toISOString(),
        endsAt:
          data.closeRows && next
            ? new Date(next.startMs).toISOString()
            : undefined,
      });
    },
  );

  // the server's order.
  return rowsOldestFirst.reverse();
};

describe("UptimeUtil chronological order (grey bars at the end of the status page)", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  /*
   * compareTimelinesChronologically did not exist before the fix (this whole block fails to
   * compile against the old code). What it replaced - the isAfter comparator - returned 0 for
   * every pair below that starts within one second.
   */
  describe("compareTimelinesChronologically", () => {
    it("orders rows that start within the same second by their milliseconds", () => {
      const earlier: MonitorStatusTimeline = offline(
        "2026-09-21T12:47:40.326Z",
        "2026-09-21T12:47:40.540Z",
      );
      const later: MonitorStatusTimeline = operational(
        "2026-09-21T12:47:40.540Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(earlier, later),
      ).toBeLessThan(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(later, earlier),
      ).toBeGreaterThan(0);

      // one millisecond apart is still apart.
      const oneMillisecondLater: MonitorStatusTimeline = operational(
        "2026-09-21T12:47:40.327Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(
          earlier,
          oneMillisecondLater,
        ),
      ).toBeLessThan(0);

      // the comparator the fix replaced could not tell these apart.
      expect(preFixCompare(earlier, later)).toBe(0);
      expect(preFixCompare(later, earlier)).toBe(0);
    });

    it("still orders rows in different seconds, and treats identical closed rows as equal", () => {
      const first: MonitorStatusTimeline = offline(
        "2026-09-21T12:46:25.880Z",
        "2026-09-21T12:46:26.077Z",
      );
      const second: MonitorStatusTimeline = operational(
        "2026-09-21T12:46:26.077Z",
        "2026-09-21T12:47:35.727Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(first, second),
      ).toBeLessThan(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(second, first),
      ).toBeGreaterThan(0);

      const copyOfFirst: MonitorStatusTimeline = offline(
        "2026-09-21T12:46:25.880Z",
        "2026-09-21T12:46:26.077Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(first, copyOfFirst),
      ).toBe(0);
    });

    it("puts the closed row before the open row on an exact startsAt tie, whichever way round they are passed", () => {
      /*
       * The open row must be the one that runs on to the next row or to now. If the closed
       * (here zero-length) row sorted after it, the open row would take the closed row's
       * startsAt as its end and stop dead - the same "never reaches now" failure as the
       * same-second case. Server-side this is `ORDER BY startsAt, endsAt NULLS LAST`.
       */
      const closedRow: MonitorStatusTimeline = offline(
        "2026-09-21T12:47:40.540Z",
        "2026-09-21T12:47:40.540Z",
      );
      const openRow: MonitorStatusTimeline = operational(
        "2026-09-21T12:47:40.540Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(closedRow, openRow),
      ).toBeLessThan(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(openRow, closedRow),
      ).toBeGreaterThan(0);

      // a closed row that runs for hours still sorts before an open row with the same start.
      const longClosedRow: MonitorStatusTimeline = offline(
        "2026-09-21T12:47:40.540Z",
        "2026-09-21T18:00:00.000Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(longClosedRow, openRow),
      ).toBeLessThan(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(openRow, longClosedRow),
      ).toBeGreaterThan(0);
    });

    it("treats two open rows with the same startsAt as equal", () => {
      const openOperational: MonitorStatusTimeline = operational(
        "2026-09-21T12:47:40.540Z",
      );
      const openOffline: MonitorStatusTimeline = offline(
        "2026-09-21T12:47:40.540Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(
          openOperational,
          openOffline,
        ),
      ).toBe(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(
          openOffline,
          openOperational,
        ),
      ).toBe(0);
    });

    it("orders two closed rows with the same startsAt by their endsAt", () => {
      const endsFirst: MonitorStatusTimeline = offline(
        "2026-09-21T12:47:40.326Z",
        "2026-09-21T12:47:40.326Z",
      );
      const endsLater: MonitorStatusTimeline = operational(
        "2026-09-21T12:47:40.326Z",
        "2026-09-21T12:47:40.540Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(endsFirst, endsLater),
      ).toBeLessThan(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(endsLater, endsFirst),
      ).toBeGreaterThan(0);

      // to the millisecond, and equal ends are a tie.
      const endsOneMillisecondLater: MonitorStatusTimeline = operational(
        "2026-09-21T12:47:40.326Z",
        "2026-09-21T12:47:40.327Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(
          endsFirst,
          endsOneMillisecondLater,
        ),
      ).toBeLessThan(0);

      const sameEnd: MonitorStatusTimeline = operational(
        "2026-09-21T12:47:40.326Z",
        "2026-09-21T12:47:40.540Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(endsLater, sameEnd),
      ).toBe(0);
    });

    it("accepts string dates, the way a JSON payload carries them", () => {
      const earlier: MonitorStatusTimeline = createTimeline({
        status: "Offline",
        startsAt: "2026-09-21T12:47:40.326Z",
        endsAt: "2026-09-21T12:47:40.540Z",
        keepDatesAsStrings: true,
      });
      const later: MonitorStatusTimeline = createTimeline({
        status: "Operational",
        startsAt: "2026-09-21T12:47:40.540Z",
        keepDatesAsStrings: true,
      });

      // the fixture really does carry strings.
      expect(typeof earlier.startsAt).toBe("string");

      expect(
        UptimeUtil.compareTimelinesChronologically(earlier, later),
      ).toBeLessThan(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(later, earlier),
      ).toBeGreaterThan(0);

      // a string on one side and a Date on the other compare the same way.
      const laterAsDate: MonitorStatusTimeline = operational(
        "2026-09-21T12:47:40.540Z",
      );

      expect(
        UptimeUtil.compareTimelinesChronologically(earlier, laterAsDate),
      ).toBeLessThan(0);

      // string endsAt on a tie is honoured too.
      const tiedClosed: MonitorStatusTimeline = createTimeline({
        status: "Offline",
        startsAt: "2026-09-21T12:47:40.540Z",
        endsAt: "2026-09-21T12:47:40.600Z",
        keepDatesAsStrings: true,
      });
      const tiedClosedLater: MonitorStatusTimeline = createTimeline({
        status: "Offline",
        startsAt: "2026-09-21T12:47:40.540Z",
        endsAt: "2026-09-21T12:47:40.700Z",
        keepDatesAsStrings: true,
      });

      expect(
        UptimeUtil.compareTimelinesChronologically(tiedClosed, tiedClosedLater),
      ).toBeLessThan(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(tiedClosed, later),
      ).toBeLessThan(0);
    });

    it("returns 0 when either row has no startsAt", () => {
      const withStart: MonitorStatusTimeline = operational(
        "2026-09-21T12:47:40.540Z",
      );
      const withoutStart: MonitorStatusTimeline = new MonitorStatusTimeline();
      withoutStart.monitorId = LP_MONITOR_ID;

      expect(
        UptimeUtil.compareTimelinesChronologically(withStart, withoutStart),
      ).toBe(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(withoutStart, withStart),
      ).toBe(0);
      expect(
        UptimeUtil.compareTimelinesChronologically(withoutStart, withoutStart),
      ).toBe(0);
    });

    it("sorts the lp tail chronologically, where the pre-fix comparator left the open row before the Offline row", () => {
      const sortedByFix: Array<MonitorStatusTimeline> = [
        ...LP_TAIL_NEWEST_FIRST,
      ].sort((a: MonitorStatusTimeline, b: MonitorStatusTimeline): number => {
        return UptimeUtil.compareTimelinesChronologically(a, b);
      });

      expect(sortedByFix).toEqual(LP_TAIL_OLDEST_FIRST);

      /*
       * The root cause, pinned: with second granularity the last two rows (12:47:40.326 and
       * 12:47:40.540) tie, the sort is stable, and they keep the server's newest-first order -
       * so the open Operational row is NOT last. If this ever stops holding, the fixture no
       * longer reproduces the production bug and the tests below prove nothing.
       */
      const sortedPreFix: Array<MonitorStatusTimeline> = [
        ...LP_TAIL_NEWEST_FIRST,
      ].sort(preFixCompare);

      expect(sortedPreFix[sortedPreFix.length - 1]).toBe(
        LP_TAIL_OLDEST_FIRST[4],
      );
      expect(sortedPreFix[sortedPreFix.length - 2]).toBe(
        LP_TAIL_OLDEST_FIRST[5],
      );
    });
  });

  describe("compareEventsByStartDate", () => {
    type CreateEventFunction = (startDate: string) => Event;

    const createEvent: CreateEventFunction = (startDate: string): Event => {
      return {
        startDate: new Date(startDate),
        endDate: NOW,
        label: "Operational",
        priority: 1,
        color: Green,
        eventStatusId: OPERATIONAL_STATUS_ID,
      };
    };

    it("orders events that start within the same second by their milliseconds", () => {
      const earlier: Event = createEvent("2026-09-21T12:47:40.326Z");
      const later: Event = createEvent("2026-09-21T12:47:40.540Z");

      expect(UptimeUtil.compareEventsByStartDate(earlier, later)).toBe(-214);
      expect(UptimeUtil.compareEventsByStartDate(later, earlier)).toBe(214);
      expect(
        UptimeUtil.compareEventsByStartDate(
          earlier,
          createEvent("2026-09-21T12:47:40.326Z"),
        ),
      ).toBe(0);
    });

    it("accepts string start dates", () => {
      const earlier: Event = {
        ...createEvent("2026-09-21T12:47:40.326Z"),
        startDate: "2026-09-21T12:47:40.326Z" as unknown as Date,
      };
      const later: Event = createEvent("2026-09-21T12:47:40.540Z");

      expect(UptimeUtil.compareEventsByStartDate(earlier, later)).toBe(-214);
      expect(UptimeUtil.compareEventsByStartDate(later, earlier)).toBe(214);
    });
  });

  describe("the real production tail of lp.chainflip.io", () => {
    /*
     * Pre-fix, both calls below produced
     *   ... 12:47:40.540 -> 12:47:40.326 Operational, 12:47:40.326 -> 12:47:40.540 Offline
     * i.e. a backwards Operational event followed by the Offline blip as the LAST event, so
     * nothing ran to now.
     */
    it("ends with the monitor Operational from 12:47:40.540 up to now", () => {
      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEventsForId(
        LP_MONITOR_ID,
        LP_TAIL_NEWEST_FIRST,
      );

      expect(describeEvents(events)).toEqual(LP_TAIL_EXPECTED_EVENTS);

      const lastEvent: MonitorEvent = events[events.length - 1]!;

      expect(lastEvent.label).toBe("Operational");
      expect(lastEvent.eventStatusId.toString()).toBe(
        OPERATIONAL_STATUS_ID.toString(),
      );
      expect(lastEvent.monitorId.toString()).toBe(LP_MONITOR_ID.toString());
      expect(toIso(lastEvent.startDate)).toBe("2026-09-21T12:47:40.540Z");
      expect(toIso(lastEvent.endDate)).toBe(NOW.toISOString());
    });

    it("produces one event per row, none of which ends before it starts", () => {
      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEventsForId(
        LP_MONITOR_ID,
        LP_TAIL_NEWEST_FIRST,
      );

      expect(events).toHaveLength(LP_TAIL_NEWEST_FIRST.length);
      expectNoEventEndsBeforeItStarts(events);
      expectContiguous(events);
    });

    it("gives the same answer through getNonOverlappingMonitorEvents", () => {
      /*
       * Pre-fix the overlap splitter was fed the backwards event and the Offline blip in the
       * wrong order; the count of events drifted away from the count of rows (in production
       * 3336 rows became 4367 events).
       */
      const events: Array<Event> =
        UptimeUtil.getNonOverlappingMonitorEvents(LP_TAIL_NEWEST_FIRST);

      expect(describeEvents(events)).toEqual(LP_TAIL_EXPECTED_EVENTS);
      expect(events).toHaveLength(LP_TAIL_NEWEST_FIRST.length);
      expectNoEventEndsBeforeItStarts(events);
      expectContiguous(events);
    });

    it("gives the same events whatever order the rows are supplied in (all 720 orders)", () => {
      const permutations: Array<Array<MonitorStatusTimeline>> =
        getAllPermutations(LP_TAIL_NEWEST_FIRST);

      expect(permutations).toHaveLength(720);

      for (const permutation of permutations) {
        expect(
          describeEvents(
            UptimeUtil.getMonitorEventsForId(LP_MONITOR_ID, permutation),
          ),
        ).toEqual(LP_TAIL_EXPECTED_EVENTS);

        expect(
          describeEvents(
            UptimeUtil.getNonOverlappingMonitorEvents(permutation),
          ),
        ).toEqual(LP_TAIL_EXPECTED_EVENTS);
      }
    });

    it("gives the same events for deterministic shuffles of the rows", () => {
      for (const seed of [1, 7, 42, 1234, 99991, 2147483646]) {
        const shuffled: Array<MonitorStatusTimeline> = shuffleDeterministically(
          LP_TAIL_NEWEST_FIRST,
          seed,
        );

        expect(
          describeEvents(UptimeUtil.getNonOverlappingMonitorEvents(shuffled)),
        ).toEqual(LP_TAIL_EXPECTED_EVENTS);
      }
    });

    it("keeps the open Operational row inside a 60 day window", () => {
      const window: UptimeWindow = {
        startDate: OneUptimeDate.addRemoveDays(NOW, -60),
        endDate: NOW,
      };

      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEventsForId(
        LP_MONITOR_ID,
        LP_TAIL_NEWEST_FIRST,
        window,
      );

      /*
       * Pre-fix the backwards Operational event had <= 0 seconds and the window path dropped
       * it, leaving 5 events that stopped at 12:47:40.540.
       */
      expect(describeEvents(events)).toEqual(LP_TAIL_EXPECTED_EVENTS);
      expect(
        describeEvents(
          UptimeUtil.getNonOverlappingMonitorEvents(
            LP_TAIL_NEWEST_FIRST,
            window,
          ),
        ),
      ).toEqual(LP_TAIL_EXPECTED_EVENTS);
    });

    it("gives today's bar an Operational event (it had none, and was painted grey)", () => {
      // today, 2026-09-22 UTC; now is 09:00.
      const today: UptimeWindow = {
        startDate: new Date("2026-09-22T00:00:00.000Z"),
        endDate: new Date("2026-09-22T23:59:59.999Z"),
      };

      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEvents(
        LP_TAIL_NEWEST_FIRST,
        today,
      );

      // pre-fix: [] - no row reached today at all.
      expect(describeEvents(events)).toEqual([
        "2026-09-22T00:00:00.000Z -> 2026-09-22T09:00:00.000Z Operational",
      ]);

      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(
          LP_TAIL_NEWEST_FIRST,
          downtimeStatuses,
          today,
        );

      expect(totalDowntimeInSeconds).toBe(0);
      expect(totalSecondsInTimePeriod).toBe(9 * 60 * 60);
    });

    it("counts exactly the three Offline blips as downtime", () => {
      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(
          LP_TAIL_NEWEST_FIRST,
          downtimeStatuses,
        );

      // 0.197 + 0.451 + 0.214 seconds.
      expect(totalDowntimeInSeconds).toBeCloseTo(0.862, 9);

      // first row (12:46:25.880 on the 21st) -> now (09:00 on the 22nd).
      expect(totalSecondsInTimePeriod).toBeCloseTo(
        (NOW.getTime() - new Date("2026-09-21T12:46:25.880Z").getTime()) / 1000,
        9,
      );
    });
  });

  describe("a flapping monitor that recovers within the same second, 500 times", () => {
    const window: UptimeWindow = {
      startDate: new Date(FLAP_BASE_MS),
      endDate: NOW,
    };

    // (118800 - 100) / 118800 = 99.91582...%
    const expectedUptimePercentage: number =
      ((FLAP_PERIOD_SECONDS - FLAP_CYCLES * FLAP_BLIP_SECONDS) /
        FLAP_PERIOD_SECONDS) *
      100;

    it("counts exactly 500 x 0.2 s of downtime when each row's end comes from the next row", () => {
      /*
       * Pre-fix, inside every second the Operational row (:x0.500) sorted before the Offline
       * row (:x0.300). Each Offline row then ran on to the NEXT cycle's Operational row
       * (10.2 s instead of 0.2 s) and the last one ran to now - over 30 hours of downtime
       * instead of 100 seconds.
       */
      const rows: Array<MonitorStatusTimeline> = buildFlappingRowsNewestFirst({
        closeRows: false,
      });

      expect(rows).toHaveLength(1 + FLAP_CYCLES * 2);

      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(rows, downtimeStatuses);

      expect(totalDowntimeInSeconds).toBeCloseTo(
        FLAP_CYCLES * FLAP_BLIP_SECONDS,
        6,
      );
      expect(totalSecondsInTimePeriod).toBe(FLAP_PERIOD_SECONDS);

      const uptimePercentage: number = UptimeUtil.calculateUptimePercentage(
        rows,
        UptimePrecision.THREE_DECIMAL,
        downtimeStatuses,
      );

      expect(uptimePercentage).toBe(99.915);
      expect(uptimePercentage).toBe(
        UptimeUtil.roundToPrecision({
          number: expectedUptimePercentage,
          precision: UptimePrecision.THREE_DECIMAL,
        }),
      );

      // and the same inside a window that covers the whole history.
      const windowed: {
        totalDowntimeInSeconds: number;
        totalSecondsInTimePeriod: number;
      } = UptimeUtil.getTotalDowntimeInSeconds(rows, downtimeStatuses, window);

      expect(windowed.totalDowntimeInSeconds).toBeCloseTo(
        FLAP_CYCLES * FLAP_BLIP_SECONDS,
        6,
      );
      expect(windowed.totalSecondsInTimePeriod).toBe(FLAP_PERIOD_SECONDS);

      expect(
        UptimeUtil.calculateUptimePercentage(
          rows,
          UptimePrecision.THREE_DECIMAL,
          downtimeStatuses,
          window,
        ),
      ).toBe(99.915);
    });

    it("turns every row into exactly one event, back to back, ending Operational at now", () => {
      const rows: Array<MonitorStatusTimeline> = buildFlappingRowsNewestFirst({
        closeRows: false,
      });

      const events: Array<Event> =
        UptimeUtil.getNonOverlappingMonitorEvents(rows);

      expect(events).toHaveLength(rows.length);
      expectNoEventEndsBeforeItStarts(events);
      expectContiguous(events);

      const offlineEvents: Array<Event> = events.filter(
        (event: Event): boolean => {
          return event.label === "Offline";
        },
      );

      expect(offlineEvents).toHaveLength(FLAP_CYCLES);

      for (const offlineEvent of offlineEvents) {
        expect(
          OneUptimeDate.getSecondsBetweenDates(
            offlineEvent.startDate,
            offlineEvent.endDate,
          ),
        ).toBeCloseTo(FLAP_BLIP_SECONDS, 9);
      }

      const lastEvent: Event = events[events.length - 1]!;

      expect(lastEvent.label).toBe("Operational");
      expect(toIso(lastEvent.startDate)).toBe(
        new Date(
          FLAP_BASE_MS + FLAP_CYCLES * FLAP_CYCLE_MS + FLAP_RECOVERY_OFFSET_MS,
        ).toISOString(),
      );
      expect(toIso(lastEvent.endDate)).toBe(NOW.toISOString());
    });

    it("does the same for the production shape, where every row but the current one is closed", () => {
      /*
       * Here the downtime happened to come out right before the fix (each Offline row carries
       * its own 0.2 s endsAt), but the events did not: every second produced a backwards
       * Operational event plus a split-off remainder (1500 events for 1001 rows), and the
       * open row ended at the last Offline row's start, so nothing reached now.
       */
      const rows: Array<MonitorStatusTimeline> = buildFlappingRowsNewestFirst({
        closeRows: true,
      });

      const monitorEvents: Array<MonitorEvent> =
        UptimeUtil.getMonitorEventsForId(LP_MONITOR_ID, rows);

      expect(monitorEvents).toHaveLength(rows.length);
      expectNoEventEndsBeforeItStarts(monitorEvents);
      expectContiguous(monitorEvents);

      const events: Array<Event> =
        UptimeUtil.getNonOverlappingMonitorEvents(rows);

      expect(events).toHaveLength(rows.length);
      expectNoEventEndsBeforeItStarts(events);
      expectContiguous(events);
      expect(describeEvents(events)).toEqual(describeEvents(monitorEvents));

      const lastEvent: Event = events[events.length - 1]!;

      expect(lastEvent.label).toBe("Operational");
      expect(toIso(lastEvent.endDate)).toBe(NOW.toISOString());

      expect(
        UptimeUtil.getTotalDowntimeInSeconds(rows, downtimeStatuses)
          .totalDowntimeInSeconds,
      ).toBeCloseTo(FLAP_CYCLES * FLAP_BLIP_SECONDS, 6);

      expect(
        UptimeUtil.calculateUptimePercentage(
          rows,
          UptimePrecision.THREE_DECIMAL,
          downtimeStatuses,
          window,
        ),
      ).toBe(99.915);
    });

    it("gives the same events and downtime whatever order the rows arrive in", () => {
      for (const closeRows of [false, true]) {
        const newestFirst: Array<MonitorStatusTimeline> =
          buildFlappingRowsNewestFirst({ closeRows });

        const expectedEvents: Array<string> = describeEvents(
          UptimeUtil.getNonOverlappingMonitorEvents(newestFirst),
        );

        const orders: Array<Array<MonitorStatusTimeline>> = [
          [...newestFirst].reverse(),
          shuffleDeterministically(newestFirst, 3),
          shuffleDeterministically(newestFirst, 2026),
          shuffleDeterministically(newestFirst, 424242),
        ];

        for (const order of orders) {
          expect(
            describeEvents(UptimeUtil.getNonOverlappingMonitorEvents(order)),
          ).toEqual(expectedEvents);

          expect(
            UptimeUtil.getTotalDowntimeInSeconds(order, downtimeStatuses)
              .totalDowntimeInSeconds,
          ).toBeCloseTo(FLAP_CYCLES * FLAP_BLIP_SECONDS, 6);
        }
      }
    });
  });

  describe("a row whose endsAt is before its startsAt", () => {
    const window: UptimeWindow = {
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: NOW,
    };

    it("produces no event, with or without a window", () => {
      /*
       * Pre-fix the no-window path kept such a row as a backwards event (the window path
       * already dropped anything <= 0 seconds). Includes an inversion inside one second.
       */
      const corruptRows: Array<MonitorStatusTimeline> = [
        offline("2026-09-21T12:00:00.000Z", "2026-09-21T11:00:00.000Z"),
        offline("2026-09-21T12:47:40.540Z", "2026-09-21T12:47:40.326Z"),
      ];

      for (const corruptRow of corruptRows) {
        expect(
          UptimeUtil.getMonitorEventsForId(LP_MONITOR_ID, [corruptRow]),
        ).toEqual([]);
        expect(
          UptimeUtil.getMonitorEventsForId(LP_MONITOR_ID, [corruptRow], window),
        ).toEqual([]);
        expect(UptimeUtil.getNonOverlappingMonitorEvents([corruptRow])).toEqual(
          [],
        );
      }
    });

    it("does not subtract its negative length from the downtime", () => {
      const corruptRow: MonitorStatusTimeline = offline(
        "2026-09-21T12:00:00.000Z",
        "2026-09-21T11:00:00.000Z",
      );

      // pre-fix: totalDowntimeInSeconds was -3600.
      expect(
        UptimeUtil.getTotalDowntimeInSeconds([corruptRow], downtimeStatuses),
      ).toEqual({
        totalDowntimeInSeconds: 0,
        totalSecondsInTimePeriod: 1,
      });
    });

    it("leaves the rows around it intact and lets the open row run to now", () => {
      const rowsNewestFirst: Array<MonitorStatusTimeline> = [
        operational("2026-09-21T12:00:00.000Z"),
        offline("2026-09-21T12:00:00.000Z", "2026-09-21T11:00:00.000Z"),
        operational("2026-09-21T10:00:00.000Z", "2026-09-21T12:00:00.000Z"),
      ];

      const expectedEvents: Array<string> = [
        "2026-09-21T10:00:00.000Z -> 2026-09-21T12:00:00.000Z Operational",
        "2026-09-21T12:00:00.000Z -> 2026-09-22T09:00:00.000Z Operational",
      ];

      expect(
        describeEvents(
          UptimeUtil.getMonitorEventsForId(LP_MONITOR_ID, rowsNewestFirst),
        ),
      ).toEqual(expectedEvents);

      expect(
        describeEvents(
          UptimeUtil.getMonitorEventsForId(
            LP_MONITOR_ID,
            rowsNewestFirst,
            window,
          ),
        ),
      ).toEqual(expectedEvents);

      /*
       * pre-fix: the open row sorted before the corrupt row (same second), ended at its start
       * (zero length), and the corrupt row counted -3600 s of "downtime".
       */
      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(rowsNewestFirst, downtimeStatuses);

      expect(totalDowntimeInSeconds).toBe(0);
      expect(totalSecondsInTimePeriod).toBe(23 * 60 * 60);

      expect(
        UptimeUtil.calculateUptimePercentage(
          rowsNewestFirst,
          UptimePrecision.THREE_DECIMAL,
          downtimeStatuses,
        ),
      ).toBe(100);
    });
  });

  describe("rows from several monitors interleaving within one second", () => {
    /*
     * A monitor group: two monitors flap within the same second. Newest-first, as the server
     * sends them - which also makes the OTHER monitor the first one getMonitorEvents meets.
     */
    const rowsNewestFirst: Array<MonitorStatusTimeline> = [
      operational("2026-09-21T12:00:00.400Z", undefined, OTHER_MONITOR_ID),
      operational("2026-09-21T12:00:00.300Z", undefined, LP_MONITOR_ID),
      offline(
        "2026-09-21T12:00:00.200Z",
        "2026-09-21T12:00:00.400Z",
        OTHER_MONITOR_ID,
      ),
      offline(
        "2026-09-21T12:00:00.100Z",
        "2026-09-21T12:00:00.300Z",
        LP_MONITOR_ID,
      ),
    ];

    it("getMonitorEvents returns them in millisecond order", () => {
      /*
       * Pre-fix the events were collected monitor by monitor (OTHER first) and the
       * second-granularity sort kept that order: .200, .400, .100, .300.
       */
      const events: Array<MonitorEvent> =
        UptimeUtil.getMonitorEvents(rowsNewestFirst);

      expect(
        events.map((event: MonitorEvent): string => {
          return `${toIso(event.startDate)} ${event.monitorId.toString()} ${event.label}`;
        }),
      ).toEqual([
        `2026-09-21T12:00:00.100Z ${LP_MONITOR_ID.toString()} Offline`,
        `2026-09-21T12:00:00.200Z ${OTHER_MONITOR_ID.toString()} Offline`,
        `2026-09-21T12:00:00.300Z ${LP_MONITOR_ID.toString()} Operational`,
        `2026-09-21T12:00:00.400Z ${OTHER_MONITOR_ID.toString()} Operational`,
      ]);

      expectNoEventEndsBeforeItStarts(events);

      // both current statuses run to now.
      expect(toIso(events[2]!.endDate)).toBe(NOW.toISOString());
      expect(toIso(events[3]!.endDate)).toBe(NOW.toISOString());
    });

    it("getNonOverlappingMonitorEvents keeps millisecond order and ends at now", () => {
      /*
       * Pre-fix the splitter met the events as .100, .300, .200, .400 and cut the LP
       * Operational event back to .300 -> .200.
       */
      for (const order of [
        rowsNewestFirst,
        [...rowsNewestFirst].reverse(),
        shuffleDeterministically(rowsNewestFirst, 5),
      ]) {
        const events: Array<Event> =
          UptimeUtil.getNonOverlappingMonitorEvents(order);

        expectStartsInChronologicalOrder(events);
        expectNoEventEndsBeforeItStarts(events);

        expect(toIso(events[0]!.startDate)).toBe("2026-09-21T12:00:00.100Z");

        const lastEvent: Event = events[events.length - 1]!;

        expect(lastEvent.label).toBe("Operational");
        expect(toIso(lastEvent.startDate)).toBe("2026-09-21T12:00:00.400Z");
        expect(toIso(lastEvent.endDate)).toBe(NOW.toISOString());
      }
    });
  });

  describe("an exact startsAt tie between a zero-length closed row and the open row", () => {
    const closedZeroLength: MonitorStatusTimeline = offline(
      "2026-09-21T12:47:40.540Z",
      "2026-09-21T12:47:40.540Z",
    );
    const openRow: MonitorStatusTimeline = operational(
      "2026-09-21T12:47:40.540Z",
    );
    const before: MonitorStatusTimeline = operational(
      "2026-09-21T12:00:00.000Z",
      "2026-09-21T12:47:40.540Z",
    );

    it("still runs the open row to now, whichever of the two the server sends first", () => {
      /*
       * Pre-fix the tie was left in arrival order; with the open row first it ended at the
       * zero-length row's start and nothing reached now.
       */
      for (const rows of [
        [openRow, closedZeroLength, before],
        [closedZeroLength, openRow, before],
        [before, openRow, closedZeroLength],
      ]) {
        const events: Array<MonitorEvent> = UptimeUtil.getMonitorEventsForId(
          LP_MONITOR_ID,
          rows,
        );

        // the zero-length row is kept on the no-window path (it does not end before it starts).
        expect(describeEvents(events)).toEqual([
          "2026-09-21T12:00:00.000Z -> 2026-09-21T12:47:40.540Z Operational",
          "2026-09-21T12:47:40.540Z -> 2026-09-21T12:47:40.540Z Offline",
          "2026-09-21T12:47:40.540Z -> 2026-09-22T09:00:00.000Z Operational",
        ]);

        const lastNonOverlappingEvent: Event =
          UptimeUtil.getNonOverlappingMonitorEvents(rows).pop()!;

        expect(lastNonOverlappingEvent.label).toBe("Operational");
        expect(toIso(lastNonOverlappingEvent.startDate)).toBe(
          "2026-09-21T12:47:40.540Z",
        );
        expect(toIso(lastNonOverlappingEvent.endDate)).toBe(NOW.toISOString());
      }
    });

    it("drops the zero-length row on the window path and keeps the open row", () => {
      const window: UptimeWindow = {
        startDate: new Date("2026-09-21T00:00:00.000Z"),
        endDate: NOW,
      };

      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEventsForId(
        LP_MONITOR_ID,
        [openRow, closedZeroLength, before],
        window,
      );

      expect(describeEvents(events)).toEqual([
        "2026-09-21T12:00:00.000Z -> 2026-09-21T12:47:40.540Z Operational",
        "2026-09-21T12:47:40.540Z -> 2026-09-22T09:00:00.000Z Operational",
      ]);
    });

    it("counts no downtime for the zero-length Offline row", () => {
      expect(
        UptimeUtil.getTotalDowntimeInSeconds(
          [openRow, closedZeroLength, before],
          downtimeStatuses,
        ).totalDowntimeInSeconds,
      ).toBe(0);
    });
  });

  describe("rows whose dates are still strings", () => {
    it("produce the same events as rows with Date objects", () => {
      const stringRowsNewestFirst: Array<MonitorStatusTimeline> =
        LP_TAIL_NEWEST_FIRST.map(
          (row: MonitorStatusTimeline): MonitorStatusTimeline => {
            return createTimeline({
              status: row.monitorStatus!.name as StatusName,
              startsAt: row.startsAt!.toISOString(),
              endsAt: row.endsAt ? row.endsAt.toISOString() : undefined,
              keepDatesAsStrings: true,
            });
          },
        );

      expect(
        describeEvents(
          UptimeUtil.getNonOverlappingMonitorEvents(stringRowsNewestFirst),
        ),
      ).toEqual(LP_TAIL_EXPECTED_EVENTS);
    });
  });
});
