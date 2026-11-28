import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorIncidentPause from "Common/Server/Utils/Monitor/MonitorIncidentPause";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime from "../../../FeatureSet/Workers/DataMigrations/LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime works out, once, what
 * the time of every monitor a scheduled maintenance event in progress
 * pauses counts as from the upgrade on (issue #11301), as an event's start
 * does (MonitorIncidentPause.syncMonitors): a monitor that the events and
 * incidents pausing it put in no status has its time left out of uptime,
 * status pages and SLOs from now; one an event puts in a status counts it,
 * as before. The time before the upgrade counts as it did.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts once, before the two
 *      slots kept last;
 *   2. it lists the monitors maintenance pauses first, as root, page by
 *      page on a stable id order, to the last short page - and only then
 *      works them out;
 *   3. it hands each monitor, with its project, to what an event's start
 *      does to its monitors' time;
 *   4. a monitor that fails is logged and the rest go on: the run never
 *      fails, so it never holds back the migrations after it;
 *   5. rollback changes nothing.
 *
 * What that does to a monitor's time is pinned against Postgres in Common's
 * MaintenancePausedTimeUptimePostgres.
 */

const MIGRATION_NAME: string =
  "LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "11301b00-0000-4000-8000-000000000001",
);

function monitorId(n: number): ObjectID {
  return new ObjectID(`11301b00-0000-4000-8000-${String(n).padStart(12, "0")}`);
}

function pausedMonitors(from: number, count: number): Array<Monitor> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    const monitor: Monitor = new Monitor();
    monitor.id = monitorId(from + index);
    monitor.projectId = PROJECT_ID;
    return monitor;
  });
}

type FindBy = typeof MonitorService.findBy;
type SyncMonitors = typeof MonitorIncidentPause.syncMonitors;

describe("LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime", () => {
  let pages: Array<Array<Monitor>>;
  let findBy: SpyInstance<FindBy>;
  let syncMonitors: SpyInstance<SyncMonitors>;
  let infoLogs: Array<string>;
  let errorLogs: Array<unknown>;
  let order: Array<string>;

  beforeEach(() => {
    pages = [];
    infoLogs = [];
    errorLogs = [];
    order = [];

    findBy = jest
      .spyOn(MonitorService, "findBy")
      .mockImplementation(async (): Promise<Array<Monitor>> => {
        order.push("list");
        return pages.shift() || [];
      });

    syncMonitors = jest
      .spyOn(MonitorIncidentPause, "syncMonitors")
      .mockImplementation(async (): Promise<void> => {
        order.push("work out");
      });

    jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
      infoLogs.push(String(message));
    });
    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errorLogs.push(message);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function workedOutMonitorIds(): Array<string> {
    return syncMonitors.mock.calls.flatMap(
      (call: Parameters<SyncMonitors>): Array<string> => {
        return call[0].monitorIds.map((id: ObjectID): string => {
          return id.toString();
        });
      },
    );
  }

  function registeredMigrations(): Array<string> {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    return Array.from(
      index
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
        .matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
  }

  test("is registered once, before the two slots kept last", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 2,
    );
    // After the one that works out the incidents' pauses (#11141).
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("WorkOutMonitorsPausedByIncidents"),
    );
  });

  test("has the name it is recorded under, and runs in cluster mode: it reads and writes Postgres only", () => {
    expect(new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().name).toBe(
      MIGRATION_NAME,
    );
    expect(
      new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().runsInClusterMode(),
    ).toBe(true);
  });

  test("lists the monitors scheduled maintenance pauses, as root, their ids and projects, on a stable id order", async () => {
    pages = [pausedMonitors(1, 2)];

    await new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().migrate();

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toEqual({
      query: {
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      },
      select: { _id: true, projectId: true },
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  });

  test("lists every page before it works any monitor out", async () => {
    pages = [
      pausedMonitors(1, LIMIT_PER_PROJECT),
      pausedMonitors(LIMIT_PER_PROJECT + 1, 3),
    ];

    await new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().migrate();

    expect(findBy).toHaveBeenCalledTimes(2);
    expect((findBy.mock.calls[1]![0] as { skip: number }).skip).toBe(
      LIMIT_PER_PROJECT,
    );
    expect(order.indexOf("work out")).toBe(2);
    expect(order.lastIndexOf("list")).toBe(1);
    expect(syncMonitors).toHaveBeenCalledTimes(LIMIT_PER_PROJECT + 3);
  });

  test("hands each monitor, with its project, to what an event's start does to its monitors' time", async () => {
    pages = [pausedMonitors(1, 3)];

    await new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().migrate();

    expect(workedOutMonitorIds()).toEqual([
      monitorId(1).toString(),
      monitorId(2).toString(),
      monitorId(3).toString(),
    ]);

    for (const call of syncMonitors.mock.calls) {
      expect(call[0].projectId.toString()).toBe(PROJECT_ID.toString());
      expect(call[0].monitorIds).toHaveLength(1);
    }
  });

  test("a monitor that fails is logged, and the rest are still worked out", async () => {
    pages = [pausedMonitors(1, 3)];
    syncMonitors.mockImplementationOnce(async (): Promise<void> => {
      throw new Error("The monitor's row is locked");
    });

    await expect(
      new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().migrate(),
    ).resolves.toBeUndefined();

    expect(syncMonitors).toHaveBeenCalledTimes(3);
    expect(String(errorLogs[0])).toContain(monitorId(1).toString());
  });

  test("a row read without its id or project is skipped", async () => {
    const monitors: Array<Monitor> = pausedMonitors(1, 2);
    delete monitors[0]!.projectId;
    pages = [monitors];

    await new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().migrate();

    expect(workedOutMonitorIds()).toEqual([monitorId(2).toString()]);
  });

  test("says how many it worked out", async () => {
    pages = [pausedMonitors(1, 4)];

    await new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().migrate();

    expect(infoLogs).toEqual([
      "LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime: worked out what the time of 4 of 4 monitor(s) paused by scheduled maintenance counts as from now.",
    ]);
  });

  test("with no monitor paused, it works nothing out", async () => {
    await new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().migrate();

    expect(syncMonitors).not.toHaveBeenCalled();
  });

  test("rollback changes nothing", async () => {
    await new LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime().rollback();

    expect(findBy).not.toHaveBeenCalled();
    expect(syncMonitors).not.toHaveBeenCalled();
  });
});
