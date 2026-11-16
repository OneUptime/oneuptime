import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorTurnedOff, {
  MonitorTurnedOffResult,
} from "Common/Server/Utils/Monitor/MonitorTurnedOff";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ResolveWhatMonitorsTurnedOffWouldHaveResolved from "../../../FeatureSet/Workers/DataMigrations/ResolveWhatMonitorsTurnedOffWouldHaveResolved";
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
 * ResolveWhatMonitorsTurnedOffWouldHaveResolved resolves, once, what the
 * monitors whose monitoring was already off left open (issue #6479):
 * turning monitoring off resolves the incidents and alerts a monitor's own
 * criteria opened with Auto resolve on (issue #6400), but only from on to
 * off, so a monitor turned off before kept them open for good.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an
 *      unregistered migration never runs), once, after
 *      RecordMonitoringOffOnStatusTimelines and before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. it reads the monitors that are not archived and whose monitoring is
 *      off, as root, their ids only, page by page on a stable id order, to
 *      the last short page - never every monitor at once;
 *   3. it hands each one to MonitorTurnedOff as an upgrade (isUpgrade), so
 *      what a person has worked on stays open and each resolve says it
 *      happened at the upgrade, and it says how many it resolved and left;
 *   4. a monitor that fails is logged and the rest go on: the run does not
 *      fail, so it never holds back the migrations after it;
 *   5. run twice, it resolves nothing more; rollback changes nothing.
 *
 * Which records MonitorTurnedOff resolves, and that it leaves what a person
 * has worked on when upgrading, is pinned in Common's MonitorTurnedOff
 * suite.
 */

const MIGRATION_NAME: string = "ResolveWhatMonitorsTurnedOffWouldHaveResolved";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function monitorId(n: number): ObjectID {
  return new ObjectID(`64790000-0000-4000-8000-${String(n).padStart(12, "0")}`);
}

function monitors(from: number, count: number): Array<Monitor> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    const monitor: Monitor = new Monitor();
    monitor.id = monitorId(from + index);
    return monitor;
  });
}

function nothingResolved(): MonitorTurnedOffResult {
  return {
    resolvedIncidentIds: [],
    resolvedAlertIds: [],
    leftForAPersonIncidentIds: [],
    leftForAPersonAlertIds: [],
  };
}

type FindBy = typeof MonitorService.findBy;
type Resolve = typeof MonitorTurnedOff.resolveWhatItWouldHaveResolved;

describe("ResolveWhatMonitorsTurnedOffWouldHaveResolved", () => {
  let pages: Array<Array<Monitor>>;
  let findBy: SpyInstance<FindBy>;
  let resolve: SpyInstance<Resolve>;
  let infoLogs: Array<string>;
  let errorLogs: Array<unknown>;

  beforeEach(() => {
    pages = [];
    infoLogs = [];
    errorLogs = [];

    findBy = jest
      .spyOn(MonitorService, "findBy")
      .mockImplementation(async (): Promise<Array<Monitor>> => {
        return pages.shift() || [];
      });

    resolve = jest
      .spyOn(MonitorTurnedOff, "resolveWhatItWouldHaveResolved")
      .mockImplementation(async (): Promise<MonitorTurnedOffResult> => {
        return nothingResolved();
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

  function resolvedMonitorIds(): Array<string> {
    return resolve.mock.calls.map((call: Parameters<Resolve>): string => {
      return call[0].monitorId.toString();
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
        .matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
  }

  test("is registered once, after RecordMonitoringOffOnStatusTimelines and before the last slot", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    /*
     * After it: the status a resolve gives a monitor back starts its
     * current status, held as time with monitoring off.
     */
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("RecordMonitoringOffOnStatusTimelines"),
    );
  });

  test("has the name it is recorded under", () => {
    expect(new ResolveWhatMonitorsTurnedOffWouldHaveResolved().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("runs in cluster mode too: it reads and writes Postgres only", () => {
    expect(
      new ResolveWhatMonitorsTurnedOffWouldHaveResolved().runsInClusterMode(),
    ).toBe(true);
  });

  test("reads the monitors not archived whose monitoring is off, as root, their ids only, on a stable id order", async () => {
    pages = [monitors(1, 2)];

    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toEqual({
      query: { disableActiveMonitoring: true, isArchived: false },
      select: { _id: true },
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  });

  test("hands each monitor to MonitorTurnedOff as an upgrade, naming no person", async () => {
    pages = [monitors(1, 3)];

    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    expect(resolve.mock.calls).toEqual([
      [{ monitorId: monitorId(1), isUpgrade: true }],
      [{ monitorId: monitorId(2), isUpgrade: true }],
      [{ monitorId: monitorId(3), isUpgrade: true }],
    ]);
  });

  test("says how many incidents and alerts it resolved, of how many monitors, and how many it left to a person", async () => {
    pages = [monitors(1, 3)];

    resolve.mockImplementation(
      async (data: Parameters<Resolve>[0]): Promise<MonitorTurnedOffResult> => {
        const n: string = data.monitorId.toString().slice(-1);

        if (n === "1") {
          return {
            resolvedIncidentIds: ["i1", "i2"],
            resolvedAlertIds: ["a1"],
            leftForAPersonIncidentIds: ["i3"],
            leftForAPersonAlertIds: [],
          };
        }

        if (n === "2") {
          return {
            resolvedIncidentIds: ["i4"],
            resolvedAlertIds: [],
            leftForAPersonIncidentIds: [],
            leftForAPersonAlertIds: ["a2", "a3"],
          };
        }

        return nothingResolved();
      },
    );

    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    expect(infoLogs).toEqual([
      "ResolveWhatMonitorsTurnedOffWouldHaveResolved: resolved 3 incident(s) and 1 alert(s) of 3 monitor(s) whose monitoring is off; left 1 incident(s) and 2 alert(s) a person has worked on open.",
    ]);
  });

  test("reads page after page while a page comes back full, to the last short one", async () => {
    pages = [
      monitors(1, LIMIT_PER_PROJECT),
      monitors(1 + LIMIT_PER_PROJECT, LIMIT_PER_PROJECT),
      monitors(1 + 2 * LIMIT_PER_PROJECT, 7),
    ];

    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    expect(
      findBy.mock.calls.map((call: Parameters<FindBy>): unknown => {
        return call[0].skip;
      }),
    ).toEqual([0, LIMIT_PER_PROJECT, 2 * LIMIT_PER_PROJECT]);

    const total: number = 2 * LIMIT_PER_PROJECT + 7;
    expect(resolvedMonitorIds()).toEqual(
      Array.from({ length: total }, (_: unknown, index: number) => {
        return monitorId(index + 1).toString();
      }),
    );
  });

  test("a full last page is followed by one more read, which comes back empty", async () => {
    pages = [monitors(1, LIMIT_PER_PROJECT)];

    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    expect(findBy).toHaveBeenCalledTimes(2);
    expect(findBy.mock.calls[1]![0].skip).toBe(LIMIT_PER_PROJECT);
    expect(resolve).toHaveBeenCalledTimes(LIMIT_PER_PROJECT);
  });

  test("no monitor with monitoring off: one read, nothing resolved", async () => {
    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
    expect(infoLogs).toEqual([
      "ResolveWhatMonitorsTurnedOffWouldHaveResolved: resolved 0 incident(s) and 0 alert(s) of 0 monitor(s) whose monitoring is off; left 0 incident(s) and 0 alert(s) a person has worked on open.",
    ]);
  });

  test("run a second time, it resolves nothing more: what it resolved is no longer open", async () => {
    const stillOpen: Set<string> = new Set<string>([
      monitorId(1).toString(),
      monitorId(2).toString(),
    ]);

    resolve.mockImplementation(
      async (data: Parameters<Resolve>[0]): Promise<MonitorTurnedOffResult> => {
        if (!stillOpen.delete(data.monitorId.toString())) {
          return nothingResolved();
        }

        return {
          ...nothingResolved(),
          resolvedIncidentIds: [`incident-of-${data.monitorId.toString()}`],
        };
      },
    );

    pages = [monitors(1, 2)];
    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    pages = [monitors(1, 2)];
    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    expect(infoLogs).toEqual([
      "ResolveWhatMonitorsTurnedOffWouldHaveResolved: resolved 2 incident(s) and 0 alert(s) of 2 monitor(s) whose monitoring is off; left 0 incident(s) and 0 alert(s) a person has worked on open.",
      "ResolveWhatMonitorsTurnedOffWouldHaveResolved: resolved 0 incident(s) and 0 alert(s) of 2 monitor(s) whose monitoring is off; left 0 incident(s) and 0 alert(s) a person has worked on open.",
    ]);
  });

  test("a monitor it cannot resolve for is logged, and the rest go on; the run does not fail", async () => {
    pages = [monitors(1, 3)];

    const failure: Error = new Error("connection reset");

    resolve.mockImplementation(
      async (data: Parameters<Resolve>[0]): Promise<MonitorTurnedOffResult> => {
        if (data.monitorId.toString() === monitorId(2).toString()) {
          throw failure;
        }

        return {
          ...nothingResolved(),
          resolvedIncidentIds: ["one"],
        };
      },
    );

    await expect(
      new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate(),
    ).resolves.toBeUndefined();

    expect(resolvedMonitorIds()).toEqual([
      monitorId(1).toString(),
      monitorId(2).toString(),
      monitorId(3).toString(),
    ]);
    expect(errorLogs).toEqual([
      `ResolveWhatMonitorsTurnedOffWouldHaveResolved: could not resolve what monitor ${monitorId(2).toString()} left open:`,
      failure,
    ]);
    expect(infoLogs).toEqual([
      "ResolveWhatMonitorsTurnedOffWouldHaveResolved: resolved 2 incident(s) and 0 alert(s) of 3 monitor(s) whose monitoring is off; left 0 incident(s) and 0 alert(s) a person has worked on open.",
    ]);
  });

  test("a result without the upgrade's lists still counts", async () => {
    pages = [monitors(1, 1)];

    resolve.mockResolvedValue({
      resolvedIncidentIds: ["i1"],
      resolvedAlertIds: ["a1"],
    });

    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    expect(infoLogs).toEqual([
      "ResolveWhatMonitorsTurnedOffWouldHaveResolved: resolved 1 incident(s) and 1 alert(s) of 1 monitor(s) whose monitoring is off; left 0 incident(s) and 0 alert(s) a person has worked on open.",
    ]);
  });

  test("a monitor read without an id is passed over", async () => {
    const withoutId: Monitor = new Monitor();
    pages = [[withoutId, ...monitors(1, 1)]];

    await new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate();

    expect(resolvedMonitorIds()).toEqual([monitorId(1).toString()]);
  });

  test("a failing read of the monitors is not swallowed: the runner stops the chain and runs it again", async () => {
    findBy.mockRejectedValue(new Error("connection terminated"));

    await expect(
      new ResolveWhatMonitorsTurnedOffWouldHaveResolved().migrate(),
    ).rejects.toThrow("connection terminated");
    expect(resolve).not.toHaveBeenCalled();
  });

  test("has nothing to roll back", async () => {
    await expect(
      new ResolveWhatMonitorsTurnedOffWouldHaveResolved().rollback(),
    ).resolves.toBeUndefined();
    expect(findBy).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});
