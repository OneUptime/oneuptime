/*
 * THE STATUS PAGE'S STATUS EVENTS CARRY THE MONITORING SWITCH (issue #6480).
 *
 * A status page's overview ships its monitors' status events
 * (StatusPageService.getMonitorStatusTimelineForStatusPage). Its day bars and
 * uptime are measured by the database, but a monitor's uptime falls back to
 * these rows when the database has no reading for it
 * (UptimeUtil.calculateUptimePercentage, MonitorOverview), and they are the
 * overview's documented public answer. The time a monitor's monitoring was
 * off is left out only if the rows say which time that was: so they are read
 * with isMonitoringOff, as recorded.
 *
 * All service reads are spied on - no database is touched.
 */

import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import { Green, Red } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const MONITOR_ID: ObjectID = new ObjectID(
  "64860000-0000-4000-8000-000000000001",
);

type FindBySpy = SpyInstance<typeof MonitorStatusTimelineService.findBy>;

const DAY_MS: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-07-19T00:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function makeStatus(data: {
  id: string;
  name: string;
  priority: number;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(data.id);
  status.name = data.name;
  status.priority = data.priority;
  status.color = data.name === "Offline" ? Red : Green;
  return status;
}

const OPERATIONAL: MonitorStatus = makeStatus({
  id: "64870000-0000-4000-8000-000000000001",
  name: "Operational",
  priority: 1,
});
const OFFLINE: MonitorStatus = makeStatus({
  id: "64870000-0000-4000-8000-000000000002",
  name: "Offline",
  priority: 2,
});

// Rows as the database answers the select: the flag only when it is asked for.
function storedRows(
  select: Record<string, unknown>,
): Array<MonitorStatusTimeline> {
  const rows: Array<{
    status: MonitorStatus;
    startsAt: Date;
    endsAt?: Date | undefined;
    isMonitoringOff: boolean;
  }> = [
    {
      status: OPERATIONAL,
      startsAt: daysAgo(60),
      endsAt: daysAgo(10),
      isMonitoringOff: false,
    },
    {
      status: OFFLINE,
      startsAt: daysAgo(10),
      endsAt: daysAgo(7),
      isMonitoringOff: false,
    },
    // Turned off while Offline a week ago.
    { status: OFFLINE, startsAt: daysAgo(7), isMonitoringOff: true },
  ];

  return rows.map(
    (row: {
      status: MonitorStatus;
      startsAt: Date;
      endsAt?: Date | undefined;
      isMonitoringOff: boolean;
    }): MonitorStatusTimeline => {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      timeline.monitorId = MONITOR_ID;
      timeline.monitorStatusId = row.status.id!;
      timeline.monitorStatus = row.status;
      timeline.startsAt = row.startsAt;

      if (row.endsAt) {
        timeline.endsAt = row.endsAt;
      }

      if (select["isMonitoringOff"] === true) {
        timeline.isMonitoringOff = row.isMonitoringOff;
      }

      return timeline;
    },
  );
}

describe("StatusPageService.getMonitorStatusTimelineForStatusPage and the monitoring switch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function spyOnFindBy(): FindBySpy {
    return jest
      .spyOn(MonitorStatusTimelineService, "findBy")
      .mockImplementation(
        async (findBy: {
          select?: unknown;
        }): Promise<Array<MonitorStatusTimeline>> => {
          return storedRows((findBy.select || {}) as Record<string, unknown>);
        },
      );
  }

  test("reads each status event's isMonitoringOff, beside the status it holds", async () => {
    const findBy: FindBySpy = spyOnFindBy();

    await StatusPageService.getMonitorStatusTimelineForStatusPage({
      monitorIds: [MONITOR_ID],
      startDate: daysAgo(30),
      endDate: NOW,
    });

    expect(findBy).toHaveBeenCalledTimes(1);

    const select: Record<string, unknown> = findBy.mock.calls[0]![0]
      .select as Record<string, unknown>;

    expect(select["isMonitoringOff"]).toBe(true);
    expect(select["monitorStatus"]).toMatchObject({ _id: true });
  });

  test("so the uptime worked out from them leaves out the week off: three Offline days of the 23 checked, not ten of 30", async () => {
    jest.useFakeTimers({ now: NOW });

    try {
      spyOnFindBy();

      const rows: Array<MonitorStatusTimeline> =
        await StatusPageService.getMonitorStatusTimelineForStatusPage({
          monitorIds: [MONITOR_ID],
          startDate: daysAgo(30),
          endDate: NOW,
        });

      expect(
        UptimeUtil.calculateUptimePercentage(
          rows,
          UptimePrecision.THREE_DECIMAL,
          [OFFLINE],
          { startDate: daysAgo(30), endDate: NOW },
        ),
      ).toBeCloseTo((20 / 23) * 100, 2);
    } finally {
      jest.useRealTimers();
    }
  });

  test("nothing is read for a page with no monitors", async () => {
    const findBy: FindBySpy = spyOnFindBy();

    expect(
      await StatusPageService.getMonitorStatusTimelineForStatusPage({
        monitorIds: [],
        startDate: daysAgo(30),
        endDate: NOW,
      }),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });
});
