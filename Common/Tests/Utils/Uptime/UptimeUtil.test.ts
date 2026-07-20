import UptimeUtil, { UptimeWindow } from "../../../Utils/Uptime/UptimeUtil";
import Event from "../../../Utils/Uptime/Event";
import MonitorEvent from "../../../Utils/Uptime/MonitorEvent";
import { Green, Red } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";

/*
 * Every assertion in this file is relative to a pinned "now" so the numbers are stable. The bug this
 * file guards against is precisely that the uptime percentage used to drift with wall clock time.
 */
const NOW: Date = new Date("2026-07-19T00:00:00.000Z");

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SECONDS_IN_DAY: number = 86400;

const offlineStatus: MonitorStatus = new MonitorStatus();
offlineStatus.id = OFFLINE_STATUS_ID;
offlineStatus.name = "Offline";
offlineStatus.priority = 2;
offlineStatus.color = Red;

const downtimeStatuses: Array<MonitorStatus> = [offlineStatus];

type CreateTimelineFunction = (data: {
  statusId: ObjectID;
  name: string;
  priority: number;
  startsAt: string;
  endsAt?: string | undefined;
  monitorId?: ObjectID | undefined;
}) => MonitorStatusTimeline;

const createTimeline: CreateTimelineFunction = (data: {
  statusId: ObjectID;
  name: string;
  priority: number;
  startsAt: string;
  endsAt?: string | undefined;
  monitorId?: ObjectID | undefined;
}): MonitorStatusTimeline => {
  const monitorStatus: MonitorStatus = new MonitorStatus();
  monitorStatus.id = data.statusId;
  monitorStatus.name = data.name;
  monitorStatus.priority = data.priority;
  monitorStatus.color = data.name === "Offline" ? Red : Green;

  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = data.monitorId || MONITOR_ID;
  timeline.monitorStatusId = data.statusId;
  timeline.monitorStatus = monitorStatus;
  timeline.startsAt = new Date(data.startsAt);

  // endsAt is left unset for open rows, which is what the orphaned rows look like in the database.
  if (data.endsAt) {
    timeline.endsAt = new Date(data.endsAt);
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
  return createTimeline({
    statusId: OFFLINE_STATUS_ID,
    name: "Offline",
    priority: 2,
    startsAt,
    endsAt,
    monitorId,
  });
};

const operational: StatusTimelineFunction = (
  startsAt: string,
  endsAt?: string | undefined,
  monitorId?: ObjectID | undefined,
): MonitorStatusTimeline => {
  return createTimeline({
    statusId: OPERATIONAL_STATUS_ID,
    name: "Operational",
    priority: 1,
    startsAt,
    endsAt,
    monitorId,
  });
};

describe("UptimeUtil", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe("the production incident: an orphaned endsAt = null row from months ago", () => {
    /*
     * Two rows for the same monitor, both with endsAt = null. The Offline row was orphaned by a race
     * in MonitorStatusTimelineService and never closed. The customer report window is a 31 day window
     * five months later, and it rendered 113 days of downtime and 43.76% uptime.
     */
    const timelines: Array<MonitorStatusTimeline> = [
      offline("2025-12-11T18:03:00.955Z"),
      operational("2026-04-04T00:19:20.189Z"),
    ];

    const window: UptimeWindow = {
      startDate: new Date("2026-05-31T00:00:00.000Z"),
      endDate: new Date("2026-07-01T00:00:00.000Z"),
    };

    it("reproduces the bug when no window is supplied", () => {
      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(timelines, downtimeStatuses);

      /*
       * The orphaned Offline row swallows everything up to the next event, which is 113 days,
       * 6 hours and 16 minutes later. This is the number the customer saw on their report.
       */
      expect(totalDowntimeInSeconds).toBe(9785779.234);
      expect(Math.floor(totalDowntimeInSeconds / SECONDS_IN_DAY)).toBe(113);

      // and the denominator is "first event -> now", which is why the number drifted daily.
      expect(totalSecondsInTimePeriod).toBe(18943019.045);

      const uptimePercentage: number = UptimeUtil.calculateUptimePercentage(
        timelines,
        UptimePrecision.TWO_DECIMAL,
        downtimeStatuses,
      );

      expect(uptimePercentage).toBe(48.34);
      expect(uptimePercentage).toBeLessThan(100);
    });

    it("reports zero downtime and 100% uptime when the window is supplied", () => {
      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(
          timelines,
          downtimeStatuses,
          window,
        );

      expect(totalDowntimeInSeconds).toBe(0);

      // the denominator is the 31 day window, not "first event -> now".
      expect(totalSecondsInTimePeriod).toBe(31 * SECONDS_IN_DAY);

      expect(
        UptimeUtil.calculateUptimePercentage(
          timelines,
          UptimePrecision.TWO_DECIMAL,
          downtimeStatuses,
          window,
        ),
      ).toBe(100);
    });

    it("drops the orphaned row and clips the surviving event to the window", () => {
      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEvents(
        timelines,
        window,
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.label).toBe("Operational");
      expect(events[0]!.startDate.toISOString()).toBe(
        window.startDate.toISOString(),
      );
      expect(events[0]!.endDate.toISOString()).toBe(
        window.endDate.toISOString(),
      );
    });

    it("does not drift as wall clock time moves forward", () => {
      const uptimeToday: number = UptimeUtil.calculateUptimePercentage(
        timelines,
        UptimePrecision.THREE_DECIMAL,
        downtimeStatuses,
        window,
      );

      jest.setSystemTime(new Date("2026-09-19T00:00:00.000Z"));

      const uptimeTwoMonthsLater: number = UptimeUtil.calculateUptimePercentage(
        timelines,
        UptimePrecision.THREE_DECIMAL,
        downtimeStatuses,
        window,
      );

      jest.setSystemTime(NOW);

      expect(uptimeTwoMonthsLater).toBe(uptimeToday);
    });
  });

  describe("clipping events to the window", () => {
    const window: UptimeWindow = {
      startDate: new Date("2026-05-31T00:00:00.000Z"),
      endDate: new Date("2026-07-01T00:00:00.000Z"),
    };

    it("counts an event that spans the whole window as full downtime", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-01-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z"),
      ];

      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(
          timelines,
          downtimeStatuses,
          window,
        );

      expect(totalDowntimeInSeconds).toBe(31 * SECONDS_IN_DAY);
      expect(totalSecondsInTimePeriod).toBe(31 * SECONDS_IN_DAY);

      expect(
        UptimeUtil.calculateUptimePercentage(
          timelines,
          UptimePrecision.TWO_DECIMAL,
          downtimeStatuses,
          window,
        ),
      ).toBe(0);
    });

    it("clips an event that overlaps the start of the window", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-05-20T00:00:00.000Z", "2026-06-05T00:00:00.000Z"),
      ];

      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEvents(
        timelines,
        window,
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.startDate.toISOString()).toBe(
        window.startDate.toISOString(),
      );
      expect(events[0]!.endDate.toISOString()).toBe("2026-06-05T00:00:00.000Z");

      // 31 May -> 5 June is 5 days.
      expect(
        UptimeUtil.getTotalDowntimeInSeconds(
          timelines,
          downtimeStatuses,
          window,
        ).totalDowntimeInSeconds,
      ).toBe(5 * SECONDS_IN_DAY);
    });

    it("clips an event that overlaps the end of the window", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-06-25T00:00:00.000Z", "2026-07-10T00:00:00.000Z"),
      ];

      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEvents(
        timelines,
        window,
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.startDate.toISOString()).toBe(
        "2026-06-25T00:00:00.000Z",
      );
      expect(events[0]!.endDate.toISOString()).toBe(
        window.endDate.toISOString(),
      );

      // 25 June -> 1 July is 6 days.
      expect(
        UptimeUtil.getTotalDowntimeInSeconds(
          timelines,
          downtimeStatuses,
          window,
        ).totalDowntimeInSeconds,
      ).toBe(6 * SECONDS_IN_DAY);
    });

    it("drops an event that ends before the window starts", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"),
      ];

      expect(UptimeUtil.getMonitorEvents(timelines, window)).toHaveLength(0);

      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(
          timelines,
          downtimeStatuses,
          window,
        );

      expect(totalDowntimeInSeconds).toBe(0);
      expect(totalSecondsInTimePeriod).toBe(31 * SECONDS_IN_DAY);
    });

    it("drops an event that starts after the window ends", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z"),
      ];

      expect(UptimeUtil.getMonitorEvents(timelines, window)).toHaveLength(0);
      expect(
        UptimeUtil.getTotalDowntimeInSeconds(
          timelines,
          downtimeStatuses,
          window,
        ).totalDowntimeInSeconds,
      ).toBe(0);
    });

    it("drops an event that only touches the window edge", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-05-01T00:00:00.000Z", "2026-05-31T00:00:00.000Z"),
      ];

      expect(UptimeUtil.getMonitorEvents(timelines, window)).toHaveLength(0);
    });

    it("clips events for every monitor and keeps them attributed correctly", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-01-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z"),
        offline(
          "2026-06-20T00:00:00.000Z",
          "2026-09-01T00:00:00.000Z",
          OTHER_MONITOR_ID,
        ),
      ];

      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEvents(
        timelines,
        window,
      );

      expect(events).toHaveLength(2);

      const firstEvent: MonitorEvent = events[0]!;
      const secondEvent: MonitorEvent = events[1]!;

      expect(firstEvent.monitorId.toString()).toBe(MONITOR_ID.toString());
      expect(firstEvent.startDate.toISOString()).toBe(
        window.startDate.toISOString(),
      );
      expect(firstEvent.endDate.toISOString()).toBe("2026-06-02T00:00:00.000Z");

      expect(secondEvent.monitorId.toString()).toBe(
        OTHER_MONITOR_ID.toString(),
      );
      expect(secondEvent.endDate.toISOString()).toBe(
        window.endDate.toISOString(),
      );
    });

    it("clips correctly no matter what order the rows arrive in", () => {
      const inOrder: Array<MonitorStatusTimeline> = [
        offline("2026-06-01T00:00:00.000Z", "2026-06-03T00:00:00.000Z"),
        operational("2026-06-03T00:00:00.000Z", "2026-06-10T00:00:00.000Z"),
      ];

      const outOfOrder: Array<MonitorStatusTimeline> = [
        inOrder[1]!,
        inOrder[0]!,
      ];

      expect(
        UptimeUtil.getTotalDowntimeInSeconds(inOrder, downtimeStatuses, window)
          .totalDowntimeInSeconds,
      ).toBe(
        UptimeUtil.getTotalDowntimeInSeconds(
          outOfOrder,
          downtimeStatuses,
          window,
        ).totalDowntimeInSeconds,
      );

      expect(
        UptimeUtil.getTotalDowntimeInSeconds(inOrder, downtimeStatuses, window)
          .totalDowntimeInSeconds,
      ).toBe(2 * SECONDS_IN_DAY);
    });
  });

  describe("open (endsAt = null) rows", () => {
    it("runs a single open row up to now and no further", () => {
      // window ends in the future. now is 19 July.
      const window: UptimeWindow = {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-08-01T00:00:00.000Z"),
      };

      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-07-17T00:00:00.000Z"),
      ];

      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(
          timelines,
          downtimeStatuses,
          window,
        );

      // 17 July -> now (19 July) is 2 days. The open row must not run to the window end.
      expect(totalDowntimeInSeconds).toBe(2 * SECONDS_IN_DAY);

      // and the denominator is clipped to now too, so it is 1 July -> 19 July.
      expect(totalSecondsInTimePeriod).toBe(18 * SECONDS_IN_DAY);

      expect(
        UptimeUtil.calculateUptimePercentage(
          timelines,
          UptimePrecision.TWO_DECIMAL,
          downtimeStatuses,
          window,
        ),
      ).toBe(88.88);
    });

    it("closes an open row at the start of the next row for the same monitor", () => {
      const window: UptimeWindow = {
        startDate: new Date("2026-06-01T00:00:00.000Z"),
        endDate: new Date("2026-07-01T00:00:00.000Z"),
      };

      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-06-05T00:00:00.000Z"),
        operational("2026-06-08T00:00:00.000Z"),
      ];

      expect(
        UptimeUtil.getTotalDowntimeInSeconds(
          timelines,
          downtimeStatuses,
          window,
        ).totalDowntimeInSeconds,
      ).toBe(3 * SECONDS_IN_DAY);
    });
  });

  describe("degenerate inputs", () => {
    const window: UptimeWindow = {
      startDate: new Date("2026-05-31T00:00:00.000Z"),
      endDate: new Date("2026-07-01T00:00:00.000Z"),
    };

    it("handles an empty timeline with and without a window", () => {
      expect(UptimeUtil.getMonitorEvents([])).toHaveLength(0);
      expect(UptimeUtil.getMonitorEvents([], window)).toHaveLength(0);
      expect(
        UptimeUtil.getNonOverlappingMonitorEvents([], window),
      ).toHaveLength(0);

      expect(
        UptimeUtil.getTotalDowntimeInSeconds([], downtimeStatuses),
      ).toEqual({
        totalDowntimeInSeconds: 0,
        totalSecondsInTimePeriod: 1,
      });

      expect(
        UptimeUtil.getTotalDowntimeInSeconds([], downtimeStatuses, window),
      ).toEqual({
        totalDowntimeInSeconds: 0,
        totalSecondsInTimePeriod: 31 * SECONDS_IN_DAY,
      });

      expect(
        UptimeUtil.calculateUptimePercentage(
          [],
          UptimePrecision.TWO_DECIMAL,
          downtimeStatuses,
          window,
        ),
      ).toBe(100);
    });

    it("never returns a zero or negative denominator", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-06-05T00:00:00.000Z", "2026-06-06T00:00:00.000Z"),
      ];

      const zeroLengthWindow: UptimeWindow = {
        startDate: new Date("2026-06-01T00:00:00.000Z"),
        endDate: new Date("2026-06-01T00:00:00.000Z"),
      };

      const invertedWindow: UptimeWindow = {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-06-01T00:00:00.000Z"),
      };

      const futureWindow: UptimeWindow = {
        startDate: new Date("2027-01-01T00:00:00.000Z"),
        endDate: new Date("2027-02-01T00:00:00.000Z"),
      };

      for (const badWindow of [
        zeroLengthWindow,
        invertedWindow,
        futureWindow,
      ]) {
        for (const items of [timelines, []]) {
          const { totalSecondsInTimePeriod } =
            UptimeUtil.getTotalDowntimeInSeconds(
              items,
              downtimeStatuses,
              badWindow,
            );

          expect(totalSecondsInTimePeriod).toBeGreaterThan(0);
        }
      }
    });

    it("never returns an uptime percentage outside [0, 100]", () => {
      /*
       * A row closed in the future (2026-07-31) against a window that also ends in the future
       * (2026-08-01), evaluated at now = 2026-07-19. Both the numerator (the clipped event) and the
       * denominator (the window) are capped at now, so they agree: the event covers the whole
       * elapsed period, downtime equals the period, and uptime is a correct 0% - not a value the
       * clamp had to rescue. The [0, 100] clamp remains in the code as defence in depth.
       */
      const window: UptimeWindow = {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-08-01T00:00:00.000Z"),
      };

      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-07-01T00:00:00.000Z", "2026-07-31T00:00:00.000Z"),
      ];

      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(
          timelines,
          downtimeStatuses,
          window,
        );

      /*
       * Numerator is clipped to now, so it can never exceed the denominator (also capped at now).
       * Here the offline row covers the entire elapsed period, so the two are equal.
       */
      expect(totalDowntimeInSeconds).toBeLessThanOrEqual(
        totalSecondsInTimePeriod,
      );
      expect(totalDowntimeInSeconds).toBe(totalSecondsInTimePeriod);

      for (const precision of [
        UptimePrecision.NO_DECIMAL,
        UptimePrecision.ONE_DECIMAL,
        UptimePrecision.TWO_DECIMAL,
        UptimePrecision.THREE_DECIMAL,
      ]) {
        const uptimePercentage: number = UptimeUtil.calculateUptimePercentage(
          timelines,
          precision,
          downtimeStatuses,
          window,
        );

        expect(uptimePercentage).toBeGreaterThanOrEqual(0);
        expect(uptimePercentage).toBeLessThanOrEqual(100);
      }

      expect(
        UptimeUtil.calculateUptimePercentage(
          timelines,
          UptimePrecision.TWO_DECIMAL,
          downtimeStatuses,
          window,
        ),
      ).toBe(0);
    });
  });

  describe("behaviour without a window is unchanged", () => {
    it("keeps counting closed events from the first event to now", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        operational("2026-07-09T00:00:00.000Z", "2026-07-17T00:00:00.000Z"),
        offline("2026-07-17T00:00:00.000Z", "2026-07-18T00:00:00.000Z"),
        operational("2026-07-18T00:00:00.000Z"),
      ];

      const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
        UptimeUtil.getTotalDowntimeInSeconds(timelines, downtimeStatuses);

      // 9 July -> now (19 July) is 10 days, of which 1 day is downtime.
      expect(totalDowntimeInSeconds).toBe(SECONDS_IN_DAY);
      expect(totalSecondsInTimePeriod).toBe(10 * SECONDS_IN_DAY);

      expect(
        UptimeUtil.calculateUptimePercentage(
          timelines,
          UptimePrecision.NO_DECIMAL,
          downtimeStatuses,
        ),
      ).toBe(90);
    });

    it("still returns a period of 1 second when every event is in the future", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        offline("2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z"),
      ];

      expect(
        UptimeUtil.getTotalDowntimeInSeconds(timelines, downtimeStatuses),
      ).toEqual({
        totalDowntimeInSeconds: 0,
        totalSecondsInTimePeriod: 1,
      });
    });

    it("splits overlapping events by priority the same way as before", () => {
      const timelines: Array<MonitorStatusTimeline> = [
        operational("2026-07-10T00:00:00.000Z", "2026-07-16T00:00:00.000Z"),
        offline(
          "2026-07-12T00:00:00.000Z",
          "2026-07-14T00:00:00.000Z",
          OTHER_MONITOR_ID,
        ),
      ];

      const events: Array<Event> =
        UptimeUtil.getNonOverlappingMonitorEvents(timelines);

      expect(
        events.map((event: Event) => {
          return event.label;
        }),
      ).toEqual(["Operational", "Offline", "Operational"]);

      expect(
        UptimeUtil.getTotalDowntimeInSeconds(timelines, downtimeStatuses)
          .totalDowntimeInSeconds,
      ).toBe(2 * SECONDS_IN_DAY);
    });
  });

  describe("roundToPrecision", () => {
    it("floors to the requested precision", () => {
      expect(
        UptimeUtil.roundToPrecision({
          number: 99.9999,
          precision: UptimePrecision.NO_DECIMAL,
        }),
      ).toBe(99);

      expect(
        UptimeUtil.roundToPrecision({
          number: 99.9999,
          precision: UptimePrecision.TWO_DECIMAL,
        }),
      ).toBe(99.99);
    });
  });
});
