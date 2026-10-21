import fs from "fs";
import path from "path";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * StorageArray:CleanupStaleResources is the inventory sweeper for the
 * Storage Arrays product: the only scheduled caller of
 * StorageArrayService.markDisconnectedArrays, and the only thing that ever
 * prunes StorageArrayResource rows (volumes, hosts, pods, hardware, drives,
 * controllers, network interfaces, directories, file systems, buckets) once
 * the array stops reporting them. These tests drive one full tick and pin
 * the contract the job's header comment promises:
 *
 *   1. markDisconnectedArrays runs FIRST and in its own try — its failure is
 *      logged and the prune still runs;
 *   2. the prune scans only arrays still marked "connected" (disconnected
 *      ones keep their last-known inventory on purpose);
 *   3. BOTH cutoffs handed to deleteStaleForArray — the regular one and the
 *      longer one for the slowly scraped directories — are the array's OWN
 *      lastSeenAt minus the threshold (anchored, not wall-clock), and an
 *      array with no lastSeenAt yet falls back to the clock;
 *   4. one array's prune failure is logged and the loop continues;
 *   5. the handler never throws, whatever fails underneath it;
 *   6. the worker Index actually imports the job — a job file that is not
 *      imported never registers.
 *
 * The job registers itself via RunCron at import time and exports nothing,
 * so the Cron util is mocked to capture the handler — the same recorder the
 * other App/Tests/Workers/Jobs suites use. Both services are replaced with
 * factories so no DatabaseService (and so no Postgres / Redis / BullMQ) is
 * loaded. The resource service's env parsing
 * (STORAGE_ARRAY_INVENTORY_STALE_MINUTES) and threshold arithmetic belong to
 * the Common service tests; the mocks here echo fixed 15- and 90-minute
 * windows so the anchor wiring is observable end to end.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
}

/*
 * Captured cron handlers and options, keyed by job name. Declared before
 * the job import below so the mock factory closure can see them.
 */
const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCapturedOptions: Record<string, CronOptions> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCapturedOptions[jobName] = options;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/StorageArrayService", () => {
  return {
    __esModule: true,
    default: {
      markDisconnectedArrays: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/StorageArrayResourceService", () => {
  return {
    __esModule: true,
    default: {
      getStaleThresholdDate: jest.fn(),
      getSlowScrapeStaleThresholdDate: jest.fn(),
      deleteStaleForArray: jest.fn(),
    },
  };
});

import StorageArrayService from "Common/Server/Services/StorageArrayService";
import StorageArrayResourceService from "Common/Server/Services/StorageArrayResourceService";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/StorageArray/CleanupStaleResources";

const JOB_NAME: string = "StorageArray:CleanupStaleResources";
const THRESHOLD_MS: number = 15 * 60 * 1000;
const SLOW_SCRAPE_THRESHOLD_MS: number = 90 * 60 * 1000;
const NOW: Date = new Date("2026-10-05T10:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const ARRAY_A_ID: ObjectID = new ObjectID("array-a");
const ARRAY_B_ID: ObjectID = new ObjectID("array-b");

interface ArrayServiceMock {
  markDisconnectedArrays: jest.Mock;
  findBy: jest.Mock;
}

interface ResourceServiceMock {
  getStaleThresholdDate: jest.Mock;
  getSlowScrapeStaleThresholdDate: jest.Mock;
  deleteStaleForArray: jest.Mock;
}

interface LoggerMock {
  debug: jest.Mock;
  error: jest.Mock;
}

interface FindByArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  skip: number;
  props: Record<string, unknown>;
}

interface DeleteStaleArgs {
  storageArrayId: ObjectID;
  olderThan: Date;
  slowScrapeOlderThan: Date;
}

const arrayService: ArrayServiceMock =
  StorageArrayService as unknown as ArrayServiceMock;
const resourceService: ResourceServiceMock =
  StorageArrayResourceService as unknown as ResourceServiceMock;
const mockedLogger: LoggerMock = logger as unknown as LoggerMock;

/*
 * Stand-ins for the real helpers: anchor minus a fixed window, wall clock
 * when no anchor is given. Re-primed in beforeEach because resetAllMocks
 * drops every implementation.
 */
function thresholdFor(nowOverride?: Date): Date {
  const anchor: Date = nowOverride || new Date(NOW);
  return new Date(anchor.getTime() - THRESHOLD_MS);
}

function slowScrapeThresholdFor(nowOverride?: Date): Date {
  const anchor: Date = nowOverride || new Date(NOW);
  return new Date(anchor.getTime() - SLOW_SCRAPE_THRESHOLD_MS);
}

function makeArray(data: {
  id: ObjectID | undefined;
  lastSeenAt?: Date | undefined;
}): StorageArray {
  const array: StorageArray = new StorageArray();
  // findBy returns _id as the raw string column, which is what the job reads.
  if (data.id) {
    array._id = data.id.toString();
  }
  array.projectId = PROJECT_ID;
  if (data.lastSeenAt) {
    array.lastSeenAt = data.lastSeenAt;
  }
  return array;
}

function deleteCalls(): Array<DeleteStaleArgs> {
  return resourceService.deleteStaleForArray.mock.calls.map(
    (call: Array<unknown>): DeleteStaleArgs => {
      return call[0] as DeleteStaleArgs;
    },
  );
}

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];
  if (!handler) {
    throw new Error(
      `Cron handler ${JOB_NAME} was not registered - the RunCron mock never saw it.`,
    );
  }
  await handler();
}

function readSource(...segments: Array<string>): string {
  return fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", ...segments),
    "utf8",
  );
}

beforeEach(() => {
  /*
   * resetAllMocks (not clearAllMocks) so a *Once value queued by one test
   * can never leak into the next; every default is re-primed below.
   */
  jest.resetAllMocks();
  arrayService.markDisconnectedArrays.mockResolvedValue(undefined);
  arrayService.findBy.mockResolvedValue([]);
  resourceService.getStaleThresholdDate.mockImplementation(thresholdFor);
  resourceService.getSlowScrapeStaleThresholdDate.mockImplementation(
    slowScrapeThresholdFor,
  );
  resourceService.deleteStaleForArray.mockResolvedValue(0);
});

describe("the cron registers itself", () => {
  test("under its documented name, every five minutes, and not on startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    });
  });

  test("is the only StorageArray job this file registers", () => {
    const storageArrayJobs: Array<string> = Object.keys(
      mockCapturedJobs,
    ).filter((name: string): boolean => {
      return name.startsWith("StorageArray:");
    });
    expect(storageArrayJobs).toEqual([JOB_NAME]);
  });

  test("is imported by the worker Index — an unimported job never registers", () => {
    const source: string = readSource("FeatureSet", "Workers", "Index.ts");

    expect(source).toContain(
      'import "./Jobs/StorageArray/CleanupStaleResources";',
    );
  });

  test("is imported by the worker Index next to the Ceph sweeper it mirrors", () => {
    const source: string = readSource("FeatureSet", "Workers", "Index.ts");

    const cephIndex: number = source.indexOf(
      'import "./Jobs/Ceph/CleanupStaleResources";',
    );
    const storageArrayIndex: number = source.indexOf(
      'import "./Jobs/StorageArray/CleanupStaleResources";',
    );
    expect(cephIndex).toBeGreaterThanOrEqual(0);
    expect(storageArrayIndex).toBeGreaterThan(cephIndex);
  });
});

describe("step 1: the disconnect sweep", () => {
  test("marks stale arrays disconnected BEFORE scanning for connected ones", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(arrayService.markDisconnectedArrays).toHaveBeenCalledTimes(1);
    // Step 2 must see step 1's status flips, so the order is load-bearing.
    expect(
      arrayService.markDisconnectedArrays.mock.invocationCallOrder[0],
    ).toBeLessThan(arrayService.findBy.mock.invocationCallOrder[0]!);
  });

  test("runs the disconnect sweep even when no array is connected", async () => {
    await runTick();

    expect(arrayService.markDisconnectedArrays).toHaveBeenCalledTimes(1);
    expect(arrayService.findBy).toHaveBeenCalledTimes(1);
  });

  test("a failing disconnect sweep is logged and the prune still runs", async () => {
    arrayService.markDisconnectedArrays.mockRejectedValue(
      new Error("redis exploded"),
    );
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
    ]);

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("markDisconnectedArrays failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("redis exploded"),
    );
    expect(arrayService.findBy).toHaveBeenCalledTimes(1);
    expect(deleteCalls()).toHaveLength(1);
  });

  test("a non-Error rejection from the disconnect sweep is stringified, not swallowed silently", async () => {
    arrayService.markDisconnectedArrays.mockRejectedValue(
      "plain string failure",
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("plain string failure"),
    );
  });
});

describe("step 2: which arrays are pruned", () => {
  test("scans only arrays still marked connected, as root, across the whole table", async () => {
    await runTick();

    const args: FindByArgs = arrayService.findBy.mock
      .calls[0]![0] as FindByArgs;

    // Disconnected arrays are never queried, so their inventory survives.
    expect(args.query).toEqual({ otelCollectorStatus: "connected" });
    expect(args.props).toEqual({ isRoot: true });
    expect(args.limit).toBe(LIMIT_MAX);
    expect(args.skip).toBe(0);
    expect(args.select).toEqual({
      _id: true,
      projectId: true,
      lastSeenAt: true,
    });
  });

  test("prunes nothing when no array is connected", async () => {
    await runTick();

    expect(resourceService.getStaleThresholdDate).not.toHaveBeenCalled();
    expect(
      resourceService.getSlowScrapeStaleThresholdDate,
    ).not.toHaveBeenCalled();
    expect(resourceService.deleteStaleForArray).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("prunes every connected array it was handed, by id, under the storageArrayId key", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
      makeArray({ id: ARRAY_B_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    const calls: Array<DeleteStaleArgs> = deleteCalls();
    expect(
      calls.map((call: DeleteStaleArgs): string => {
        return call.storageArrayId.toString();
      }),
    ).toEqual([ARRAY_A_ID.toString(), ARRAY_B_ID.toString()]);
    // The service takes an ObjectID, not the raw string column findBy returns.
    for (const call of calls) {
      expect(call.storageArrayId).toBeInstanceOf(ObjectID);
      expect(Object.keys(call).sort()).toEqual([
        "olderThan",
        "slowScrapeOlderThan",
        "storageArrayId",
      ]);
    }
  });

  test("skips a row that came back without an id", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: undefined, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(resourceService.getStaleThresholdDate).not.toHaveBeenCalled();
    expect(resourceService.deleteStaleForArray).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("skips the id-less row but still prunes the others in the same tick", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: undefined, lastSeenAt: NOW }),
      makeArray({ id: ARRAY_B_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(
      deleteCalls().map((call: DeleteStaleArgs): string => {
        return call.storageArrayId.toString();
      }),
    ).toEqual([ARRAY_B_ID.toString()]);
  });
});

describe("the prune cutoffs", () => {
  test("are anchored to each array's OWN lastSeenAt minus the threshold, not the wall clock", async () => {
    const seenA: Date = new Date("2026-10-05T09:58:00.000Z");
    const seenB: Date = new Date("2026-10-05T09:50:00.000Z");
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: seenA }),
      makeArray({ id: ARRAY_B_ID, lastSeenAt: seenB }),
    ]);

    await runTick();

    // The anchor handed to both service helpers is the row's lastSeenAt...
    expect(resourceService.getStaleThresholdDate).toHaveBeenCalledTimes(2);
    expect(resourceService.getStaleThresholdDate).toHaveBeenNthCalledWith(
      1,
      seenA,
    );
    expect(resourceService.getStaleThresholdDate).toHaveBeenNthCalledWith(
      2,
      seenB,
    );
    expect(
      resourceService.getSlowScrapeStaleThresholdDate,
    ).toHaveBeenCalledTimes(2);
    expect(
      resourceService.getSlowScrapeStaleThresholdDate,
    ).toHaveBeenNthCalledWith(1, seenA);
    expect(
      resourceService.getSlowScrapeStaleThresholdDate,
    ).toHaveBeenNthCalledWith(2, seenB);

    // ...and the cutoffs that reach the delete are that anchor minus each window.
    const calls: Array<DeleteStaleArgs> = deleteCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.olderThan.getTime()).toBe(seenA.getTime() - THRESHOLD_MS);
    expect(calls[0]!.slowScrapeOlderThan.getTime()).toBe(
      seenA.getTime() - SLOW_SCRAPE_THRESHOLD_MS,
    );
    expect(calls[1]!.olderThan.getTime()).toBe(seenB.getTime() - THRESHOLD_MS);
    expect(calls[1]!.slowScrapeOlderThan.getTime()).toBe(
      seenB.getTime() - SLOW_SCRAPE_THRESHOLD_MS,
    );
    // Neither cutoff is the wall-clock one.
    expect(calls[0]!.olderThan.getTime()).not.toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
    expect(calls[1]!.slowScrapeOlderThan.getTime()).not.toBe(
      NOW.getTime() - SLOW_SCRAPE_THRESHOLD_MS,
    );
  });

  test("the slow-scrape cutoff (directories) is never later than the regular one", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    const call: DeleteStaleArgs = deleteCalls()[0]!;
    expect(call.slowScrapeOlderThan.getTime()).toBeLessThan(
      call.olderThan.getTime(),
    );
  });

  test("hands the service's own cutoffs through untouched — the cron carries no threshold policy", async () => {
    const serviceCutoff: Date = new Date("2026-10-05T09:00:00.000Z");
    const serviceSlowCutoff: Date = new Date("2026-10-05T07:00:00.000Z");
    resourceService.getStaleThresholdDate.mockReturnValue(serviceCutoff);
    resourceService.getSlowScrapeStaleThresholdDate.mockReturnValue(
      serviceSlowCutoff,
    );
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(deleteCalls()[0]!.olderThan).toBe(serviceCutoff);
    expect(deleteCalls()[0]!.slowScrapeOlderThan).toBe(serviceSlowCutoff);
  });

  test("falls back to the wall clock for an array that has no lastSeenAt yet", async () => {
    arrayService.findBy.mockResolvedValue([makeArray({ id: ARRAY_A_ID })]);

    await runTick();

    expect(resourceService.getStaleThresholdDate).toHaveBeenCalledWith(
      undefined,
    );
    expect(
      resourceService.getSlowScrapeStaleThresholdDate,
    ).toHaveBeenCalledWith(undefined);
    expect(deleteCalls()[0]!.olderThan.getTime()).toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
    expect(deleteCalls()[0]!.slowScrapeOlderThan.getTime()).toBe(
      NOW.getTime() - SLOW_SCRAPE_THRESHOLD_MS,
    );
  });
});

describe("resilience", () => {
  test("one array's prune failure is logged and the loop continues to the next", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
      makeArray({ id: ARRAY_B_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForArray.mockImplementation(
      (args: DeleteStaleArgs): Promise<number> => {
        if (args.storageArrayId.toString() === ARRAY_A_ID.toString()) {
          return Promise.reject(new Error("db connection reset"));
        }
        return Promise.resolve(1);
      },
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(deleteCalls()).toHaveLength(2);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("deleteStaleForArray failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(ARRAY_A_ID.toString()),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(PROJECT_ID.toString()),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("db connection reset"),
    );
  });

  test("a prune failure on the LAST array still lets the earlier deletes count", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
      makeArray({ id: ARRAY_B_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForArray
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new Error("statement timeout"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("pruned 4 "),
    );
  });

  test("a failing connected-array scan is logged and never thrown", async () => {
    arrayService.findBy.mockRejectedValue(new Error("postgres down"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("cron failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("postgres down"),
    );
    expect(resourceService.deleteStaleForArray).not.toHaveBeenCalled();
  });

  test("a throwing threshold helper is caught by the outer guard and never thrown", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
    ]);
    resourceService.getSlowScrapeStaleThresholdDate.mockImplementation(
      (): Date => {
        throw new Error("bad env");
      },
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("cron failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("bad env"),
    );
    expect(resourceService.deleteStaleForArray).not.toHaveBeenCalled();
  });

  test("a failing disconnect sweep AND a failing prune together still never throw", async () => {
    arrayService.markDisconnectedArrays.mockRejectedValue(
      new Error("redis exploded"),
    );
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForArray.mockRejectedValue(
      new Error("db connection reset"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
  });

  test("a tick that fails is isolated — the next tick starts clean", async () => {
    arrayService.findBy.mockRejectedValueOnce(new Error("postgres down"));
    await expect(runTick()).resolves.toBeUndefined();

    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
    ]);
    await expect(runTick()).resolves.toBeUndefined();

    expect(arrayService.markDisconnectedArrays).toHaveBeenCalledTimes(2);
    expect(deleteCalls()).toHaveLength(1);
  });
});

describe("reporting", () => {
  test("logs one debug line with the total pruned across all connected arrays", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
      makeArray({ id: ARRAY_B_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForArray
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining(JOB_NAME),
    );
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("pruned 5 "),
    );
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("StorageArrayResource"),
    );
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("2 connected storage array(s)"),
    );
  });

  test("stays quiet when nothing was pruned", async () => {
    arrayService.findBy.mockResolvedValue([
      makeArray({ id: ARRAY_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(mockedLogger.debug).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("never mentions Ceph concepts — this is the storage array sweeper", async () => {
    const source: string = readSource(
      "FeatureSet",
      "Workers",
      "Jobs",
      "StorageArray",
      "CleanupStaleResources.ts",
    );

    expect(source).toContain('"StorageArray:CleanupStaleResources"');
    expect(source).toContain("StorageArrayService.markDisconnectedArrays");
    expect(source).toContain("StorageArrayResourceService.deleteStaleForArray");
    expect(source).toContain(
      "StorageArrayResourceService.getSlowScrapeStaleThresholdDate",
    );
    expect(source).toContain("STORAGE_ARRAY_INVENTORY_STALE_MINUTES");
    expect(source).not.toMatch(/CephCluster|CephResource|CEPH_|ceph_/);
  });
});
