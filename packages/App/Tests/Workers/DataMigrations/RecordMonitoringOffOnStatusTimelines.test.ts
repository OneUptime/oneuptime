import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import RecordMonitoringOffOnStatusTimelines from "../../../FeatureSet/Workers/DataMigrations/RecordMonitoringOffOnStatusTimelines";
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
 * RecordMonitoringOffOnStatusTimelines marks, once, on the status timeline
 * of every monitor whose monitoring was already off when OneUptime started
 * to leave that time out of uptime, status pages and SLOs (issue #6480),
 * that its monitoring is off - from now on. Without it such a monitor's
 * frozen status would go on counting until someone turned it on and off
 * again.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an
 *      unregistered migration never runs), once, before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. it reads the monitors whose monitoring is off, as root, their ids
 *      only, page by page on a stable id order, to the last short page;
 *   3. it marks each one through MonitorStatusTimelineService.
 *      recordMonitoringSwitch - which writes nothing for a monitor already
 *      marked, so a second run marks nothing - and says how many it marked;
 *   4. a monitor it cannot mark is logged and the rest are still marked;
 *   5. rollback changes nothing.
 *
 * What recordMonitoringSwitch writes, and that it writes nothing twice, is
 * pinned in Common's MonitorStatusTimelineMonitoringSwitch suite.
 */

const MIGRATION_NAME: string = "RecordMonitoringOffOnStatusTimelines";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function monitorId(n: number): ObjectID {
  return new ObjectID(`64850000-0000-4000-8000-${String(n).padStart(12, "0")}`);
}

function monitors(from: number, count: number): Array<Monitor> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    const monitor: Monitor = new Monitor();
    monitor.id = monitorId(from + index);
    return monitor;
  });
}

type FindBy = typeof MonitorService.findBy;
type RecordMonitoringSwitch =
  typeof MonitorStatusTimelineService.recordMonitoringSwitch;

describe("RecordMonitoringOffOnStatusTimelines", () => {
  let pages: Array<Array<Monitor>>;
  let findBy: SpyInstance<FindBy>;
  let recordMonitoringSwitch: SpyInstance<RecordMonitoringSwitch>;
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

    recordMonitoringSwitch = jest
      .spyOn(MonitorStatusTimelineService, "recordMonitoringSwitch")
      .mockImplementation(async (): Promise<MonitorStatusTimeline | null> => {
        return new MonitorStatusTimeline();
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

  function markedIds(): Array<string> {
    return recordMonitoringSwitch.mock.calls.map(
      (call: Parameters<RecordMonitoringSwitch>): string => {
        return call[0].monitorId.toString();
      },
    );
  }

  test("is registered once, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

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
  });

  test("has the name it is recorded under", () => {
    expect(new RecordMonitoringOffOnStatusTimelines().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("reads the monitors whose monitoring is off, as root, their ids only, on a stable id order", async () => {
    pages = [monitors(1, 2)];

    await new RecordMonitoringOffOnStatusTimelines().migrate();

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toEqual({
      query: { disableActiveMonitoring: true },
      select: { _id: true },
      sort: { _id: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  });

  test("marks each of them off, with the status it holds, from now", async () => {
    pages = [monitors(1, 3)];

    await new RecordMonitoringOffOnStatusTimelines().migrate();

    expect(recordMonitoringSwitch.mock.calls).toEqual([
      [{ monitorId: monitorId(1), isMonitoringOff: true }],
      [{ monitorId: monitorId(2), isMonitoringOff: true }],
      [{ monitorId: monitorId(3), isMonitoringOff: true }],
    ]);
    expect(infoLogs).toEqual([
      "RecordMonitoringOffOnStatusTimelines: marked monitoring off on the status timelines of 3 monitor(s).",
    ]);
  });

  test("reads page after page while a page comes back full, to the last short one", async () => {
    pages = [
      monitors(1, LIMIT_PER_PROJECT),
      monitors(1 + LIMIT_PER_PROJECT, LIMIT_PER_PROJECT),
      monitors(1 + 2 * LIMIT_PER_PROJECT, 7),
    ];

    await new RecordMonitoringOffOnStatusTimelines().migrate();

    expect(
      findBy.mock.calls.map((call: Parameters<FindBy>): unknown => {
        return call[0].skip;
      }),
    ).toEqual([0, LIMIT_PER_PROJECT, 2 * LIMIT_PER_PROJECT]);

    const total: number = 2 * LIMIT_PER_PROJECT + 7;
    expect(markedIds()).toEqual(
      Array.from({ length: total }, (_: unknown, index: number) => {
        return monitorId(index + 1).toString();
      }),
    );
    expect(infoLogs).toEqual([
      `RecordMonitoringOffOnStatusTimelines: marked monitoring off on the status timelines of ${total} monitor(s).`,
    ]);
  });

  test("a full last page is followed by one more read, which comes back empty", async () => {
    pages = [monitors(1, LIMIT_PER_PROJECT)];

    await new RecordMonitoringOffOnStatusTimelines().migrate();

    expect(findBy).toHaveBeenCalledTimes(2);
    expect(findBy.mock.calls[1]![0].skip).toBe(LIMIT_PER_PROJECT);
    expect(recordMonitoringSwitch).toHaveBeenCalledTimes(LIMIT_PER_PROJECT);
  });

  test("no monitor with monitoring off: one read, nothing marked", async () => {
    await new RecordMonitoringOffOnStatusTimelines().migrate();

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(recordMonitoringSwitch).not.toHaveBeenCalled();
    expect(infoLogs).toEqual([
      "RecordMonitoringOffOnStatusTimelines: marked monitoring off on the status timelines of 0 monitor(s).",
    ]);
  });

  test("counts only the monitors it wrote a status event for: one already marked, or with no status yet, is not counted", async () => {
    pages = [monitors(1, 4)];

    recordMonitoringSwitch.mockImplementation(
      async (
        data: Parameters<RecordMonitoringSwitch>[0],
      ): Promise<MonitorStatusTimeline | null> => {
        // Monitors 2 and 4 are marked already (a second run, or a switch since).
        return ["2", "4"].includes(data.monitorId.toString().slice(-1))
          ? null
          : new MonitorStatusTimeline();
      },
    );

    await new RecordMonitoringOffOnStatusTimelines().migrate();

    expect(recordMonitoringSwitch).toHaveBeenCalledTimes(4);
    expect(infoLogs).toEqual([
      "RecordMonitoringOffOnStatusTimelines: marked monitoring off on the status timelines of 2 monitor(s).",
    ]);
  });

  test("run a second time, it marks nothing: every monitor's latest status event already says its monitoring is off", async () => {
    const marked: Set<string> = new Set<string>();

    recordMonitoringSwitch.mockImplementation(
      async (
        data: Parameters<RecordMonitoringSwitch>[0],
      ): Promise<MonitorStatusTimeline | null> => {
        if (marked.has(data.monitorId.toString())) {
          return null;
        }

        marked.add(data.monitorId.toString());
        return new MonitorStatusTimeline();
      },
    );

    pages = [monitors(1, 3)];
    await new RecordMonitoringOffOnStatusTimelines().migrate();

    pages = [monitors(1, 3)];
    await new RecordMonitoringOffOnStatusTimelines().migrate();

    expect(infoLogs).toEqual([
      "RecordMonitoringOffOnStatusTimelines: marked monitoring off on the status timelines of 3 monitor(s).",
      "RecordMonitoringOffOnStatusTimelines: marked monitoring off on the status timelines of 0 monitor(s).",
    ]);
  });

  test("a monitor it cannot mark is logged, and the rest are still marked; the run does not fail", async () => {
    pages = [monitors(1, 3)];

    const failure: Error = new Error("could not obtain lock");

    recordMonitoringSwitch.mockImplementation(
      async (
        data: Parameters<RecordMonitoringSwitch>[0],
      ): Promise<MonitorStatusTimeline | null> => {
        if (data.monitorId.toString() === monitorId(2).toString()) {
          throw failure;
        }

        return new MonitorStatusTimeline();
      },
    );

    await expect(
      new RecordMonitoringOffOnStatusTimelines().migrate(),
    ).resolves.toBeUndefined();

    expect(markedIds()).toEqual([
      monitorId(1).toString(),
      monitorId(2).toString(),
      monitorId(3).toString(),
    ]);
    expect(errorLogs).toEqual([
      `RecordMonitoringOffOnStatusTimelines: could not mark monitoring off on the status timeline of monitor ${monitorId(2).toString()}:`,
      failure,
    ]);
    expect(infoLogs).toEqual([
      "RecordMonitoringOffOnStatusTimelines: marked monitoring off on the status timelines of 2 monitor(s).",
    ]);
  });

  test("a monitor read without an id is passed over", async () => {
    const withoutId: Monitor = new Monitor();
    pages = [[withoutId, ...monitors(1, 1)]];

    await new RecordMonitoringOffOnStatusTimelines().migrate();

    expect(markedIds()).toEqual([monitorId(1).toString()]);
  });

  test("a failing read is not swallowed: the runner stops the chain and runs it again", async () => {
    findBy.mockRejectedValue(new Error("connection terminated"));

    await expect(
      new RecordMonitoringOffOnStatusTimelines().migrate(),
    ).rejects.toThrow("connection terminated");
    expect(recordMonitoringSwitch).not.toHaveBeenCalled();
  });

  test("has nothing to roll back", async () => {
    await expect(
      new RecordMonitoringOffOnStatusTimelines().rollback(),
    ).resolves.toBeUndefined();
    expect(findBy).not.toHaveBeenCalled();
    expect(recordMonitoringSwitch).not.toHaveBeenCalled();
  });
});
