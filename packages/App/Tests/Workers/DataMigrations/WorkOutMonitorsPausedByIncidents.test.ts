import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentService from "Common/Server/Services/IncidentService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import WorkOutMonitorsPausedByIncidents from "../../../FeatureSet/Workers/DataMigrations/WorkOutMonitorsPausedByIncidents";
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
 * WorkOutMonitorsPausedByIncidents works out, once, every monitor an
 * incident declared by hand has paused (issue #11141), as the open incidents
 * on it now say - what a resolve does to a monitor it gives back
 * (IncidentService.markMonitorsActiveForMonitoring):
 *
 *   - one no open incident pauses is resumed: a reopened incident, which
 *     holds nothing, used to keep a monitor paused for good once the
 *     incident that had paused it was resolved;
 *   - one paused by incidents that put it in no status has its time left
 *     out of uptime from the upgrade on.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts once, before the two
 *      slots kept last;
 *   2. it lists the paused monitors first, as root, page by page on a
 *      stable id order, to the last short page - and only then works them
 *      out, since resuming one changes the column the list is read by;
 *   3. it hands each monitor, with its project, to the resolve's give-back;
 *   4. a monitor that fails is logged and the rest go on: the run never
 *      fails, so it never holds back the migrations after it;
 *   5. rollback changes nothing.
 *
 * What the give-back does to a monitor is pinned against Postgres in
 * Common's MonitorIncidentPausePostgres.
 */

const MIGRATION_NAME: string = "WorkOutMonitorsPausedByIncidents";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "11141b00-0000-4000-8000-000000000001",
);

function monitorId(n: number): ObjectID {
  return new ObjectID(`11141b00-0000-4000-8000-${String(n).padStart(12, "0")}`);
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
type GiveBack = typeof IncidentService.markMonitorsActiveForMonitoring;

describe("WorkOutMonitorsPausedByIncidents", () => {
  let pages: Array<Array<Monitor>>;
  let stillPaused: number;
  let findBy: SpyInstance<FindBy>;
  let giveBack: SpyInstance<GiveBack>;
  let infoLogs: Array<string>;
  let errorLogs: Array<unknown>;
  let order: Array<string>;

  beforeEach(() => {
    pages = [];
    stillPaused = 0;
    infoLogs = [];
    errorLogs = [];
    order = [];

    findBy = jest
      .spyOn(MonitorService, "findBy")
      .mockImplementation(async (): Promise<Array<Monitor>> => {
        order.push("list");
        return pages.shift() || [];
      });

    jest
      .spyOn(MonitorService, "countBy")
      .mockImplementation(async (): Promise<PositiveNumber> => {
        return new PositiveNumber(stillPaused);
      });

    giveBack = jest
      .spyOn(IncidentService, "markMonitorsActiveForMonitoring")
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
    return giveBack.mock.calls.map((call: Parameters<GiveBack>): string => {
      return call[1][0]!.id!.toString();
    });
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
  });

  test("has the name it is recorded under, and runs in cluster mode: it reads and writes Postgres only", () => {
    expect(new WorkOutMonitorsPausedByIncidents().name).toBe(MIGRATION_NAME);
    expect(new WorkOutMonitorsPausedByIncidents().runsInClusterMode()).toBe(
      true,
    );
  });

  test("lists the monitors paused by an incident, as root, their ids and projects, on a stable id order", async () => {
    pages = [pausedMonitors(1, 2)];

    await new WorkOutMonitorsPausedByIncidents().migrate();

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toEqual({
      query: { disableActiveMonitoringBecauseOfManualIncident: true },
      select: { _id: true, projectId: true },
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  });

  test("lists every page before it works any monitor out: resuming one changes what the list reads", async () => {
    pages = [
      pausedMonitors(1, LIMIT_PER_PROJECT),
      pausedMonitors(LIMIT_PER_PROJECT + 1, 3),
    ];

    await new WorkOutMonitorsPausedByIncidents().migrate();

    expect(findBy).toHaveBeenCalledTimes(2);
    expect(
      (findBy.mock.calls[1]![0] as { skip: number }).skip,
    ).toBe(LIMIT_PER_PROJECT);
    expect(order.indexOf("work out")).toBe(2);
    expect(order.lastIndexOf("list")).toBe(1);
    expect(giveBack).toHaveBeenCalledTimes(LIMIT_PER_PROJECT + 3);
  });

  test("hands each monitor, with its project, to what a resolve does to a monitor it gives back", async () => {
    pages = [pausedMonitors(1, 3)];

    await new WorkOutMonitorsPausedByIncidents().migrate();

    expect(workedOutMonitorIds()).toEqual([
      monitorId(1).toString(),
      monitorId(2).toString(),
      monitorId(3).toString(),
    ]);

    for (const call of giveBack.mock.calls) {
      expect(call[0].toString()).toBe(PROJECT_ID.toString());
      expect(call[1]).toHaveLength(1);
      // No time of its own: the status it may be given starts now.
      expect(call[2]).toBeUndefined();
    }
  });

  test("a monitor that fails is logged, and the rest are still worked out", async () => {
    pages = [pausedMonitors(1, 3)];
    giveBack.mockImplementationOnce(async (): Promise<void> => {
      throw new Error("The monitor's row is locked");
    });

    await expect(
      new WorkOutMonitorsPausedByIncidents().migrate(),
    ).resolves.toBeUndefined();

    expect(giveBack).toHaveBeenCalledTimes(3);
    expect(String(errorLogs[0])).toContain(monitorId(1).toString());
  });

  test("a row read without its id or project is skipped", async () => {
    const monitors: Array<Monitor> = pausedMonitors(1, 2);
    monitors[0]!.projectId = undefined;
    pages = [monitors];

    await new WorkOutMonitorsPausedByIncidents().migrate();

    expect(workedOutMonitorIds()).toEqual([monitorId(2).toString()]);
  });

  test("says how many it worked out and how many it resumed", async () => {
    pages = [pausedMonitors(1, 4)];
    stillPaused = 1;

    await new WorkOutMonitorsPausedByIncidents().migrate();

    expect(infoLogs).toEqual([
      "WorkOutMonitorsPausedByIncidents: worked out 4 of 4 monitor(s) paused by an incident declared by hand; 3 resumed, as no open incident pauses them any more.",
    ]);
  });

  test("with no monitor paused, it works nothing out", async () => {
    await new WorkOutMonitorsPausedByIncidents().migrate();

    expect(giveBack).not.toHaveBeenCalled();
  });

  test("rollback changes nothing", async () => {
    await new WorkOutMonitorsPausedByIncidents().rollback();

    expect(findBy).not.toHaveBeenCalled();
    expect(giveBack).not.toHaveBeenCalled();
  });
});
