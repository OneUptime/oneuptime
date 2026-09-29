import fs from "fs";
import path from "path";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * Serverless:CleanupStaleResources is the sweeper every other inventory
 * pillar already had and the serverless pillar lacked:
 * ServerlessFunctionService.markDisconnectedFunctions existed but nothing
 * scheduled it, so every function read "Connected" forever, and
 * ServerlessFunctionInstance rows were never pruned, so the Instances tab
 * counted every warm environment that ever ran the function. These tests
 * drive one full tick and pin the contract the job's header comment
 * promises:
 *
 *   1. markDisconnectedFunctions runs FIRST and in its own try — its
 *      failure is logged and the prune still runs;
 *   2. the prune scans only functions still marked "connected" (an idle
 *      function keeps its last-known inventory on purpose);
 *   3. the cutoff handed to deleteStaleForFunction is the function's OWN
 *      lastSeenAt minus the threshold — anchored, not wall-clock — and a
 *      function with no lastSeenAt yet falls back to the clock;
 *   4. one function's prune failure is logged and the loop continues;
 *   5. the handler never throws, whatever fails underneath it;
 *   6. the worker Index actually imports the job — a job file that is not
 *      imported never registers, which is the exact latent bug this fixes.
 *
 * The job registers itself via RunCron at import time and exports nothing,
 * so the Cron util is mocked to capture the handler — the same recorder the
 * other App/Tests/Workers/Jobs suites use. Both services are replaced with
 * factories so no DatabaseService (and so no Postgres / Redis / BullMQ) is
 * loaded. The instance service's env parsing and threshold arithmetic are
 * pinned in Common/Tests/Server/Services/ServerlessFunctionInstanceStalePrune
 * .test.ts; the mock here echoes a fixed 15-minute window so the anchor
 * wiring is observable end to end.
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

jest.mock("Common/Server/Services/ServerlessFunctionService", () => {
  return {
    __esModule: true,
    default: {
      markDisconnectedFunctions: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ServerlessFunctionInstanceService", () => {
  return {
    __esModule: true,
    default: {
      getStaleThresholdDate: jest.fn(),
      deleteStaleForFunction: jest.fn(),
    },
  };
});

import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import ServerlessFunctionInstanceService from "Common/Server/Services/ServerlessFunctionInstanceService";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Serverless/CleanupStaleResources";

const JOB_NAME: string = "Serverless:CleanupStaleResources";
const THRESHOLD_MS: number = 15 * 60 * 1000;
const NOW: Date = new Date("2026-09-08T10:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const FUNCTION_A_ID: ObjectID = new ObjectID("fn-a");
const FUNCTION_B_ID: ObjectID = new ObjectID("fn-b");

interface FunctionServiceMock {
  markDisconnectedFunctions: jest.Mock;
  findBy: jest.Mock;
}

interface InstanceServiceMock {
  getStaleThresholdDate: jest.Mock;
  deleteStaleForFunction: jest.Mock;
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
  serverlessFunctionId: ObjectID;
  olderThan: Date;
}

const functionService: FunctionServiceMock =
  ServerlessFunctionService as unknown as FunctionServiceMock;
const instanceService: InstanceServiceMock =
  ServerlessFunctionInstanceService as unknown as InstanceServiceMock;
const mockedLogger: LoggerMock = logger as unknown as LoggerMock;

/*
 * Stand-in for the real helper: anchor minus a fixed 15 minutes, wall
 * clock when no anchor is given. Re-primed in beforeEach because
 * resetAllMocks drops every implementation.
 */
function thresholdFor(nowOverride?: Date): Date {
  const anchor: Date = nowOverride || new Date(NOW);
  return new Date(anchor.getTime() - THRESHOLD_MS);
}

function makeFunction(data: {
  id: ObjectID | undefined;
  lastSeenAt?: Date | undefined;
}): ServerlessFunction {
  const serverlessFunction: ServerlessFunction = new ServerlessFunction();
  // findBy returns _id as the raw string column, which is what the job reads.
  if (data.id) {
    serverlessFunction._id = data.id.toString();
  }
  serverlessFunction.projectId = PROJECT_ID;
  if (data.lastSeenAt) {
    serverlessFunction.lastSeenAt = data.lastSeenAt;
  }
  return serverlessFunction;
}

function deleteCalls(): Array<DeleteStaleArgs> {
  return instanceService.deleteStaleForFunction.mock.calls.map(
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

beforeEach(() => {
  /*
   * resetAllMocks (not clearAllMocks) so a *Once value queued by one test
   * can never leak into the next; every default is re-primed below.
   */
  jest.resetAllMocks();
  functionService.markDisconnectedFunctions.mockResolvedValue(undefined);
  functionService.findBy.mockResolvedValue([]);
  instanceService.getStaleThresholdDate.mockImplementation(thresholdFor);
  instanceService.deleteStaleForFunction.mockResolvedValue(0);
});

describe("the cron registers itself", () => {
  test("under its documented name, every five minutes, and not on startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    });
  });

  test("is imported by the worker Index — an unimported job never registers", () => {
    const indexPath: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "FeatureSet",
      "Workers",
      "Index.ts",
    );
    const source: string = fs.readFileSync(indexPath, "utf8");

    expect(source).toContain(
      'import "./Jobs/Serverless/CleanupStaleResources";',
    );
  });
});

describe("step 1: the disconnect sweep", () => {
  test("marks stale functions disconnected BEFORE scanning for connected ones", async () => {
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: FUNCTION_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(functionService.markDisconnectedFunctions).toHaveBeenCalledTimes(1);
    // Step 2 must see step 1's status flips, so the order is load-bearing.
    expect(
      functionService.markDisconnectedFunctions.mock.invocationCallOrder[0],
    ).toBeLessThan(functionService.findBy.mock.invocationCallOrder[0]!);
  });

  test("a failing disconnect sweep is logged and the prune still runs", async () => {
    functionService.markDisconnectedFunctions.mockRejectedValue(
      new Error("redis exploded"),
    );
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: FUNCTION_A_ID, lastSeenAt: NOW }),
    ]);

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("markDisconnectedFunctions failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("redis exploded"),
    );
    expect(functionService.findBy).toHaveBeenCalledTimes(1);
    expect(deleteCalls()).toHaveLength(1);
  });
});

describe("step 2: which functions are pruned", () => {
  test("scans only functions still marked connected, as root, across the whole table", async () => {
    await runTick();

    const args: FindByArgs = functionService.findBy.mock
      .calls[0]![0] as FindByArgs;

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

  test("prunes nothing when no function is connected", async () => {
    await runTick();

    expect(instanceService.deleteStaleForFunction).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("prunes every connected function it was handed, by id", async () => {
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: FUNCTION_A_ID, lastSeenAt: NOW }),
      makeFunction({ id: FUNCTION_B_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(
      deleteCalls().map((call: DeleteStaleArgs): string => {
        return call.serverlessFunctionId.toString();
      }),
    ).toEqual([FUNCTION_A_ID.toString(), FUNCTION_B_ID.toString()]);
  });

  test("skips a row that came back without an id", async () => {
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: undefined, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(instanceService.deleteStaleForFunction).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});

describe("the prune cutoff", () => {
  test("is anchored to each function's OWN lastSeenAt minus the threshold, not the wall clock", async () => {
    const seenA: Date = new Date("2026-09-08T09:58:00.000Z");
    const seenB: Date = new Date("2026-09-08T09:50:00.000Z");
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: FUNCTION_A_ID, lastSeenAt: seenA }),
      makeFunction({ id: FUNCTION_B_ID, lastSeenAt: seenB }),
    ]);

    await runTick();

    // The anchor handed to the service helper is the row's lastSeenAt...
    expect(instanceService.getStaleThresholdDate).toHaveBeenNthCalledWith(
      1,
      seenA,
    );
    expect(instanceService.getStaleThresholdDate).toHaveBeenNthCalledWith(
      2,
      seenB,
    );

    // ...and the cutoff that reaches the delete is that anchor minus the threshold.
    const calls: Array<DeleteStaleArgs> = deleteCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.olderThan.getTime()).toBe(seenA.getTime() - THRESHOLD_MS);
    expect(calls[1]!.olderThan.getTime()).toBe(seenB.getTime() - THRESHOLD_MS);
  });

  test("falls back to the wall clock for a function that has no lastSeenAt yet", async () => {
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: FUNCTION_A_ID }),
    ]);

    await runTick();

    expect(instanceService.getStaleThresholdDate).toHaveBeenCalledWith(
      undefined,
    );
    expect(deleteCalls()[0]!.olderThan.getTime()).toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
  });
});

describe("resilience", () => {
  test("one function's prune failure is logged and the loop continues to the next", async () => {
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: FUNCTION_A_ID, lastSeenAt: NOW }),
      makeFunction({ id: FUNCTION_B_ID, lastSeenAt: NOW }),
    ]);
    instanceService.deleteStaleForFunction.mockImplementation(
      (args: DeleteStaleArgs): Promise<number> => {
        if (args.serverlessFunctionId.toString() === FUNCTION_A_ID.toString()) {
          return Promise.reject(new Error("db connection reset"));
        }
        return Promise.resolve(1);
      },
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(deleteCalls()).toHaveLength(2);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(FUNCTION_A_ID.toString()),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("db connection reset"),
    );
  });

  test("a failing connected-function scan is logged and never thrown", async () => {
    functionService.findBy.mockRejectedValue(new Error("postgres down"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("cron failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("postgres down"),
    );
    expect(instanceService.deleteStaleForFunction).not.toHaveBeenCalled();
  });

  test("a failing disconnect sweep AND a failing prune together still never throw", async () => {
    functionService.markDisconnectedFunctions.mockRejectedValue(
      new Error("redis exploded"),
    );
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: FUNCTION_A_ID, lastSeenAt: NOW }),
    ]);
    instanceService.deleteStaleForFunction.mockRejectedValue(
      new Error("db connection reset"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
  });
});

describe("reporting", () => {
  test("logs one debug line with the total pruned across all connected functions", async () => {
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: FUNCTION_A_ID, lastSeenAt: NOW }),
      makeFunction({ id: FUNCTION_B_ID, lastSeenAt: NOW }),
    ]);
    instanceService.deleteStaleForFunction
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("pruned 5 "),
    );
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("2 connected serverless function(s)"),
    );
  });

  test("stays quiet when nothing was pruned", async () => {
    functionService.findBy.mockResolvedValue([
      makeFunction({ id: FUNCTION_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });
});
