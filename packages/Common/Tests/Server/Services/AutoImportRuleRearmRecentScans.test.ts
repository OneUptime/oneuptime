/*
 * Contract under test — the THIRD way a discovery scan's stored results
 * become importable, alongside a new upload and a manual "Run Now": the
 * project's rules changed (OneUptime issue #3487).
 *
 * The auto-import sweep is driven entirely by the autoImportProcessedAt
 * marker, so results it has already evaluated are finished with — which
 * silently makes a NEW rule reach nothing at all until the next scan reports.
 * In a project whose scans are one-shot that is never, and the operator is
 * left pressing Run Now by hand for work the product calls automatic. Which
 * is what the issue reported as "auto import rules have no schedule".
 *
 * rearmRecentScansForRuleChange closes that gap by clearing the marker, and
 * every one of its boundaries fails silently if it drifts:
 *
 *   - WHICH scans: only this project's, only importable ones, only ones
 *     already stamped, and only results still inside the freshness horizon
 *     the automatic path itself enforces — re-arming an older scan would
 *     merely have the sweep retire it again, one pointless write and one
 *     warning per scan;
 *   - HOW the marker is cleared: the hook-free single statement, and
 *     WITHOUT refreshing updatedAt, which on an In Progress scan is the
 *     "has this probe gone silent" clock the stale-scan reaper reads;
 *   - WHAT ELSE it writes: nothing. It hands work to the worker rather than
 *     importing inside a rule save.
 *
 * The collaborating singleton services are stubbed at the MODULE level
 * before the engine is imported: their real files reach Postgres through
 * DatabaseService (and PasswordHash, the local-only ts-jest compile
 * failure), and nothing here should touch any of it.
 */

jest.mock("../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      getDevicesByHostnames: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/NetworkDeviceDiscoveryScanService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/NetworkDeviceAutoImportRuleService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/MonitorTemplateService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import NetworkDeviceAutoImportRuleEngineService, {
  MAX_RESULT_AGE_IN_HOURS,
  MAX_SCANS_REARMED_PER_RULE_WRITE,
} from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import logger from "../../../Server/Utils/Logger";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { beforeEach, describe, expect, it } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const scanFindByMock: jest.Mock =
  NetworkDeviceDiscoveryScanService.findBy as unknown as jest.Mock;
const scanUpdateMock: jest.Mock =
  NetworkDeviceDiscoveryScanService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;
const deviceCreateMock: jest.Mock =
  NetworkDeviceService.create as unknown as jest.Mock;
const loggerInfoMock: jest.Mock = logger.info as unknown as jest.Mock;

/*
 * The SQL a QueryHelper filter generates. QueryHelper builds raw TypeORM
 * FindOperators, so a test can only say what a filter MEANS by rendering it —
 * "is not null" and "or is null" are the whole point of two of these, and an
 * expect(...).toBeDefined() would pass for either of them and for their
 * opposites.
 */
function sqlFor(filter: unknown): string {
  const generator: (alias: string) => string = (
    filter as { getSql: (alias: string) => string }
  ).getSql;

  return generator("column");
}

/*
 * The values bound behind a raw filter — the status list of a
 * QueryHelper.any(), or the cutoff date of a comparison.
 */
function parametersOf(filter: unknown): Array<unknown> {
  const parameters: Record<string, unknown> = (
    filter as { objectLiteralParameters?: Record<string, unknown> }
  ).objectLiteralParameters!;

  return Object.values(parameters);
}

function makeScanStub(id: string): NetworkDeviceDiscoveryScan {
  return {
    id: new ObjectID(id),
    _id: id,
  } as unknown as NetworkDeviceDiscoveryScan;
}

const SCAN_ONE: string = "33333333-3333-4333-8333-333333333333";
const SCAN_TWO: string = "44444444-4444-4444-8444-444444444444";

describe("NetworkDeviceAutoImportRuleEngineService.rearmRecentScansForRuleChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scanFindByMock.mockResolvedValue([]);
    scanUpdateMock.mockResolvedValue(undefined);
  });

  it("asks only for this project's stamped, importable, still-fresh scans", async () => {
    const beforeCall: number = OneUptimeDate.getCurrentDate().getTime();

    await NetworkDeviceAutoImportRuleEngineService.rearmRecentScansForRuleChange(
      {
        projectId: PROJECT_ID,
      },
    );

    expect(scanFindByMock).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      sort: Record<string, string>;
      limit: number;
      skip: number;
      props: Record<string, boolean>;
    } = scanFindByMock.mock.calls[0]![0];

    expect(findBy.query["projectId"]).toEqual(PROJECT_ID);

    /*
     * A scan that is still SWEEPING counts as much as a finished one: its
     * partial results are hosts the probe has already found, and waiting for
     * the whole range is the delay issue #3599 was about.
     */
    expect(parametersOf(findBy.query["status"])[0]).toEqual([
      "Completed",
      "In Progress",
    ]);

    // Already-armed scans are queued as they stand; re-clearing changes nothing.
    expect(sqlFor(findBy.query["autoImportProcessedAt"])).toContain(
      "IS NOT NULL",
    );

    /*
     * Fresh results only, and "still sweeping" (completedAt NULL) counts as
     * the freshest of all.
     */
    const completedAtSql: string = sqlFor(findBy.query["completedAt"]);
    expect(completedAtSql).toContain(">=");
    expect(completedAtSql).toContain("IS NULL");

    const cutoff: Date = parametersOf(findBy.query["completedAt"])[0] as Date;
    const expectedCutoff: number =
      beforeCall - MAX_RESULT_AGE_IN_HOURS * 60 * 60 * 1000;

    // The engine's own horizon, not a second one that could drift from it.
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(10_000);

    // Newest results first, so a capped re-arm keeps the ones that matter.
    expect(findBy.sort["completedAt"]).toBe(SortOrder.Descending);
    expect(findBy.limit).toBe(MAX_SCANS_REARMED_PER_RULE_WRITE);
    expect(findBy.skip).toBe(0);
    expect(findBy.props["isRoot"]).toBe(true);
  });

  it("clears the marker on every scan it found, without refreshing updatedAt", async () => {
    scanFindByMock.mockResolvedValue([
      makeScanStub(SCAN_ONE),
      makeScanStub(SCAN_TWO),
    ]);

    const rearmed: number =
      await NetworkDeviceAutoImportRuleEngineService.rearmRecentScansForRuleChange(
        {
          projectId: PROJECT_ID,
        },
      );

    expect(rearmed).toBe(2);
    expect(scanUpdateMock).toHaveBeenCalledTimes(2);

    for (const scanId of [SCAN_ONE, SCAN_TWO]) {
      const call: {
        id: ObjectID;
        data: Record<string, unknown>;
        skipUpdateDateColumn?: boolean;
      } = scanUpdateMock.mock.calls
        .map((args: Array<unknown>) => {
          return args[0] as {
            id: ObjectID;
            data: Record<string, unknown>;
            skipUpdateDateColumn?: boolean;
          };
        })
        .find((candidate: { id: ObjectID }): boolean => {
          return candidate.id.toString() === scanId;
        })!;

      expect(call).toBeDefined();
      expect(call.data["autoImportProcessedAt"]).toBeNull();

      /*
       * updatedAt is the stale-scan reaper's "the probe has gone silent"
       * clock (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans).
       * A rule save is not the probe saying something, and bumping it would
       * postpone the rescue of a scan whose probe had already died.
       */
      expect(call.skipUpdateDateColumn).toBe(true);
    }
  });

  it("writes the marker and nothing else — no results, no counters, no devices", async () => {
    scanFindByMock.mockResolvedValue([makeScanStub(SCAN_ONE)]);

    await NetworkDeviceAutoImportRuleEngineService.rearmRecentScansForRuleChange(
      {
        projectId: PROJECT_ID,
      },
    );

    const payload: Record<string, unknown> = scanUpdateMock.mock.calls[0]![0]
      .data as Record<string, unknown>;

    /*
     * The importing itself belongs to the worker, where minutes of paced
     * creates survive a restart. A rule save must stay a rule save.
     */
    expect(Object.keys(payload)).toEqual(["autoImportProcessedAt"]);
    expect(deviceCreateMock).not.toHaveBeenCalled();
  });

  it("writes nothing when the project has no re-armable results", async () => {
    scanFindByMock.mockResolvedValue([]);

    const rearmed: number =
      await NetworkDeviceAutoImportRuleEngineService.rearmRecentScansForRuleChange(
        {
          projectId: PROJECT_ID,
        },
      );

    expect(rearmed).toBe(0);
    expect(scanUpdateMock).not.toHaveBeenCalled();
    // Nothing happened, so nothing is announced.
    expect(loggerInfoMock).not.toHaveBeenCalled();
  });

  it("says how many results it re-armed", async () => {
    scanFindByMock.mockResolvedValue([
      makeScanStub(SCAN_ONE),
      makeScanStub(SCAN_TWO),
    ]);

    await NetworkDeviceAutoImportRuleEngineService.rearmRecentScansForRuleChange(
      {
        projectId: PROJECT_ID,
      },
    );

    expect(loggerInfoMock).toHaveBeenCalledTimes(1);
    expect(String(loggerInfoMock.mock.calls[0]![0])).toContain("2 recent");
  });

  it("surfaces a database failure to its caller instead of half-re-arming in silence", async () => {
    scanFindByMock.mockRejectedValue(new Error("connection terminated"));

    await expect(
      NetworkDeviceAutoImportRuleEngineService.rearmRecentScansForRuleChange({
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("connection terminated");
  });
});
