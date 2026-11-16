import DataMigration from "../../../../Models/DatabaseModels/DataMigration";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import DataMigrationService from "../../../../Server/Services/DataMigrationService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import MonitorMeasuredFrom from "../../../../Server/Utils/Monitor/MonitorMeasuredFrom";
import { FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME } from "../../../../Server/Utils/Monitor/UptimeHistoryMigration";
import { fetchPerMonitorTimelines } from "../../../../Server/Utils/Slo/SloMonitorTimelines";
import { Green, Red } from "../../../../Types/BrandColors";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { MeasuredFrom } from "../../../../Utils/Monitor/MonitorFirstCheck";
import SloUtil, {
  MonitorTimelineSet,
  TimeSliResult,
} from "../../../../Utils/Slo/SloUtil";
import SloMultiMonitorMode from "../../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * WHAT AN SLO READS OF ITS MONITORS, AND FROM WHEN (issue #9031).
 *
 * fetchPerMonitorTimelines reads each monitor's status timeline over the
 * window, as it always did, and hands it over with the time before the
 * monitor's first check marked as not monitored - the time status pages
 * leave out of uptime since #8960 - so the evaluation worker, the release
 * check and the monthly report leave it out of the SLI.
 *
 * It reads when each monitor was first checked only once the upgrade has
 * put Monitor.firstMeasuredAt right for history (the DataMigrations row of
 * BackfillMonitorFirstMeasuredAtForUptimeHistory). Until then the rows come
 * back exactly as they were read: a result that came back during the
 * upgrade stamped its monitor with the upgrade's time, and read then, the
 * SLO would see no history at all.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");
const DAY_MS: number = 86400 * 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "90313000-0000-4000-8000-000000000001",
);
const CHECKED: ObjectID = new ObjectID("90313000-0000-4000-8000-0000000000a1");
const NEVER_CHECKED: ObjectID = new ObjectID(
  "90313000-0000-4000-8000-0000000000b2",
);
const MANUAL: ObjectID = new ObjectID("90313000-0000-4000-8000-0000000000c3");
const CHECKED_LATE: ObjectID = new ObjectID(
  "90313000-0000-4000-8000-0000000000d4",
);
const NOT_FOUND: ObjectID = new ObjectID(
  "90313000-0000-4000-8000-0000000000e5",
);

function makeStatus(
  id: string,
  name: string,
  isOperationalState: boolean,
): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus(new ObjectID(id));
  status.name = name;
  status.priority = isOperationalState ? 1 : 2;
  status.color = isOperationalState ? Green : Red;
  status.isOperationalState = isOperationalState;
  status.isOfflineState = !isOperationalState;
  return status;
}

const OPERATIONAL: MonitorStatus = makeStatus(
  "90313000-0000-4000-8000-0000000000f1",
  "Operational",
  true,
);
const OFFLINE: MonitorStatus = makeStatus(
  "90313000-0000-4000-8000-0000000000f2",
  "Offline",
  false,
);

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

// Each monitor created 40 days ago, up since, down for a day 5 days ago.
function rowsOf(monitorId: ObjectID): Array<MonitorStatusTimeline> {
  const row: (
    status: MonitorStatus,
    from: number,
    to?: number,
  ) => MonitorStatusTimeline = (
    status: MonitorStatus,
    from: number,
    to?: number,
  ): MonitorStatusTimeline => {
    const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
    timeline.monitorId = monitorId;
    timeline.projectId = PROJECT_ID;
    timeline.monitorStatusId = status.id!;
    timeline.monitorStatus = status;
    timeline.startsAt = daysAgo(from);
    timeline.isMonitoringOff = false;

    if (to !== undefined) {
      timeline.endsAt = daysAgo(to);
    }

    return timeline;
  };

  if (monitorId.toString() === NEVER_CHECKED.toString()) {
    return [row(OPERATIONAL, 40)];
  }

  return [row(OPERATIONAL, 40, 5), row(OFFLINE, 5, 4), row(OPERATIONAL, 4)];
}

function monitorRow(data: {
  id: ObjectID;
  monitorType: MonitorType;
  firstMeasuredAt: Date | null;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id);
  monitor.monitorType = data.monitorType;
  /*
   * As the database hands it back: null when nothing has measured the
   * monitor (MonitorFirstCheck.isNeverMeasured).
   */
  (monitor as unknown as { firstMeasuredAt: Date | null }).firstMeasuredAt =
    data.firstMeasuredAt;
  return monitor;
}

const MONITORS: Array<Monitor> = [
  // Measured before the upgrade: stamped with the time it was created.
  monitorRow({
    id: CHECKED,
    monitorType: MonitorType.Website,
    firstMeasuredAt: new Date(daysAgo(40).getTime() - 250),
  }),
  monitorRow({
    id: NEVER_CHECKED,
    monitorType: MonitorType.Website,
    firstMeasuredAt: null,
  }),
  monitorRow({
    id: MANUAL,
    monitorType: MonitorType.Manual,
    firstMeasuredAt: null,
  }),
  // Its probe connected ten days ago.
  monitorRow({
    id: CHECKED_LATE,
    monitorType: MonitorType.API,
    firstMeasuredAt: daysAgo(10),
  }),
];

const EVERY_MONITOR_ID: Array<ObjectID> = [
  CHECKED,
  NEVER_CHECKED,
  MANUAL,
  CHECKED_LATE,
  NOT_FOUND,
];

describe("fetchPerMonitorTimelines and the time before a monitor's first check", () => {
  let migrationReads: SpyInstance<typeof DataMigrationService.findOneBy>;
  let monitorReads: SpyInstance<typeof MonitorService.findBy>;
  let timelineReads: SpyInstance<typeof MonitorStatusTimelineService.findAllBy>;

  function historyReady(isReady: boolean): void {
    migrationReads.mockResolvedValue(
      isReady
        ? new DataMigration(
            new ObjectID("90313000-0000-4000-8000-0000000000ff"),
          )
        : null,
    );
  }

  async function fetch(
    monitorIds: Array<ObjectID> = EVERY_MONITOR_ID,
  ): Promise<Array<MonitorTimelineSet>> {
    return await fetchPerMonitorTimelines({
      projectId: PROJECT_ID,
      monitorIds: monitorIds,
      windowStart: daysAgo(30),
      windowEnd: NOW,
    });
  }

  function setOf(
    sets: Array<MonitorTimelineSet>,
    monitorId: ObjectID,
  ): MonitorTimelineSet {
    return sets.find((set: MonitorTimelineSet): boolean => {
      return set.monitorId.toString() === monitorId.toString();
    })!;
  }

  // The SLI of one monitor's set over the last 30 days, in days.
  function sliOf(set: MonitorTimelineSet): {
    badDays: number;
    totalDays: number;
  } {
    const result: TimeSliResult = SloUtil.computeTimeSli({
      perMonitorTimelines: [set],
      downtimeStatuses: [OFFLINE],
      window: { startDate: daysAgo(30), endDate: NOW },
      mode: SloMultiMonitorMode.AnyDown,
    });

    return {
      badDays: result.badSeconds / (DAY_MS / 1000),
      totalDays: result.totalSeconds / (DAY_MS / 1000),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });

    migrationReads = jest.spyOn(DataMigrationService, "findOneBy");
    historyReady(true);

    monitorReads = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue(MONITORS);

    timelineReads = jest
      .spyOn(MonitorStatusTimelineService, "findAllBy")
      .mockImplementation(
        async (data: {
          query: Record<string, unknown>;
        }): Promise<Array<MonitorStatusTimeline>> => {
          return rowsOf(data.query["monitorId"] as ObjectID);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("asks whether the upgrade has put the history right by the migration's own name", async () => {
    await fetch();

    expect(migrationReads).toHaveBeenCalledTimes(1);
    expect(migrationReads.mock.calls[0]![0].query).toEqual({
      name: FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME,
      executed: true,
    });
    expect(FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME).toBe(
      "BackfillMonitorFirstMeasuredAtForUptimeHistory",
    );
  });

  test("reads the monitors once, with their type and first check, in the SLO's project", async () => {
    await fetch();

    expect(monitorReads).toHaveBeenCalledTimes(1);
    const read: Parameters<typeof MonitorService.findBy>[0] =
      monitorReads.mock.calls[0]![0];
    expect(read.query["projectId"]).toEqual(PROJECT_ID);
    expect(read.select).toEqual({
      _id: true,
      monitorType: true,
      firstMeasuredAt: true,
    });
  });

  test("reads whether each status is one a monitor starts in", async () => {
    await fetch([CHECKED]);

    const select: Record<string, unknown> = timelineReads.mock.calls[0]![0]
      .select as Record<string, unknown>;

    expect(select["isMonitoringOff"]).toBe(true);
    expect(select["monitorStatus"]).toMatchObject({
      isOperationalState: true,
      isOfflineState: true,
    });
  });

  test("a monitor measured before the upgrade, stamped with its creation, comes back exactly as read", async () => {
    const sets: Array<MonitorTimelineSet> = await fetch();
    const read: Array<MonitorStatusTimeline> =
      await timelineReads.mock.results[0]!.value;

    expect(setOf(sets, CHECKED).timelines).toBe(read);
    expect(sliOf(setOf(sets, CHECKED))).toEqual({ badDays: 1, totalDays: 30 });
  });

  test("a monitor nothing has checked yet measures no time", async () => {
    const sets: Array<MonitorTimelineSet> = await fetch();

    expect(sliOf(setOf(sets, NEVER_CHECKED))).toEqual({
      badDays: 0,
      totalDays: 0,
    });
  });

  test("a monitor first checked ten days ago is measured from then", async () => {
    const sets: Array<MonitorTimelineSet> = await fetch();

    expect(sliOf(setOf(sets, CHECKED_LATE))).toEqual({
      badDays: 1,
      totalDays: 10,
    });
  });

  test("a manual monitor, and one the project does not hold, count from the start", async () => {
    const sets: Array<MonitorTimelineSet> = await fetch();

    expect(sliOf(setOf(sets, MANUAL))).toEqual({ badDays: 1, totalDays: 30 });
    expect(sliOf(setOf(sets, NOT_FOUND))).toEqual({
      badDays: 1,
      totalDays: 30,
    });
  });

  test("before the upgrade has put the history right, every monitor comes back exactly as read, and no monitor is read", async () => {
    historyReady(false);

    const sets: Array<MonitorTimelineSet> = await fetch();

    expect(monitorReads).not.toHaveBeenCalled();

    for (let index: number = 0; index < sets.length; index++) {
      expect(sets[index]!.timelines).toBe(
        await timelineReads.mock.results[index]!.value,
      );
    }

    expect(sliOf(setOf(sets, NEVER_CHECKED))).toEqual({
      badDays: 0,
      totalDays: 30,
    });
  });

  test("an SLO with no monitors reads nothing at all", async () => {
    expect(await fetch([])).toEqual([]);
    expect(migrationReads).not.toHaveBeenCalled();
    expect(monitorReads).not.toHaveBeenCalled();
  });

  test("a read that fails fails the measurement, rather than measuring the monitor the other way this once", async () => {
    migrationReads.mockRejectedValue(new Error("connection reset"));

    await expect(fetch()).rejects.toThrow("connection reset");
  });
});

describe("MonitorMeasuredFrom.getMeasuredFromByMonitorId", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("maps each monitor read to when its time starts to count", async () => {
    jest
      .spyOn(DataMigrationService, "findOneBy")
      .mockResolvedValue(new DataMigration());
    jest.spyOn(MonitorService, "findBy").mockResolvedValue(MONITORS);

    const measuredFrom: Map<string, MeasuredFrom> =
      await MonitorMeasuredFrom.getMeasuredFromByMonitorId({
        projectId: PROJECT_ID,
        monitorIds: EVERY_MONITOR_ID,
      });

    expect(measuredFrom.get(CHECKED.toString())).toEqual(
      new Date(daysAgo(40).getTime() - 250),
    );
    expect(measuredFrom.get(NEVER_CHECKED.toString())).toBeNull();
    expect(measuredFrom.get(MANUAL.toString())).toBeUndefined();
    expect(measuredFrom.get(CHECKED_LATE.toString())).toEqual(daysAgo(10));
    expect(measuredFrom.has(NOT_FOUND.toString())).toBe(false);
  });
});
