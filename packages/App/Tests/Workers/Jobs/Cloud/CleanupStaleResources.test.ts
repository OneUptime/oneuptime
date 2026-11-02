import fs from "fs";
import path from "path";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";

/*
 * Cloud:CleanupStaleResources is the sweeper every other inventory pillar
 * already had and the cloud pillar lacked: CloudResourceService
 * .markDisconnectedResources existed but nothing scheduled it, so every
 * cloud environment read "Connected" forever, and CloudResourceInstance
 * rows were never pruned, so the Instances tab counted every task that
 * ever existed. These tests drive one full tick and pin the contract the
 * job's header comment promises:
 *
 *   1. markDisconnectedResources runs FIRST and in its own try — its
 *      failure is logged and the prune still runs;
 *   2. the prune scans only environments still marked "connected"
 *      (disconnected ones keep their last-known inventory on purpose);
 *   3. the cutoff handed to deleteStaleForResource is the environment's
 *      OWN lastSeenAt minus the threshold — anchored, not wall-clock —
 *      and an environment with no lastSeenAt yet falls back to the clock;
 *   4. one environment's prune failure is logged and the loop continues;
 *   5. the handler never throws, whatever fails underneath it;
 *   6. the worker Index actually imports the job — a job file that is not
 *      imported never registers, which is the exact latent bug this fixes;
 *   7. on the first tick of each hour only, App Platforms' apps and their
 *      revisions that sent nothing for the retention window are removed,
 *      anchored to each environment's own lastSeenAt, one environment's
 *      failure never stopping the next or the instance prune.
 *
 * The clock is pinned to a tick that is not the first of its hour, so the
 * hourly step stays out of the way of the others' tests; its own tests
 * move it to the top of the hour.
 *
 * The job registers itself via RunCron at import time and exports nothing,
 * so the Cron util is mocked to capture the handler — the same recorder the
 * other App/Tests/Workers/Jobs suites use. Both services are replaced with
 * factories so no DatabaseService (and so no Postgres / Redis / BullMQ) is
 * loaded. The instance service's env parsing and threshold arithmetic are
 * pinned in Common/Tests/Server/Services/CloudResourceInstanceStalePrune
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

jest.mock("Common/Server/Services/CloudResourceService", () => {
  return {
    __esModule: true,
    default: {
      markDisconnectedResources: jest.fn(),
      markUnreportedMonitoredResources: jest.fn(),
      restoreReportingMonitoredResources: jest.fn(),
      archiveUnseenMonitoredResources: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/CloudResourceInstanceService", () => {
  return {
    __esModule: true,
    default: {
      getStaleThresholdDate: jest.fn(),
      deleteStaleForResource: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/CloudAppService", () => {
  return {
    __esModule: true,
    default: {
      getUnseenThresholdDate: jest.fn(),
      getRetentionDays: jest.fn(),
      deleteUnseenForResource: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/CloudAppRevisionService", () => {
  return {
    __esModule: true,
    default: {
      deleteUnseenForResource: jest.fn(),
    },
  };
});

import CloudResourceService from "Common/Server/Services/CloudResourceService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import CloudAppService from "Common/Server/Services/CloudAppService";
import CloudAppRevisionService from "Common/Server/Services/CloudAppRevisionService";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";

// Imported for its side effect: RunCron (mocked above) records the handler.
import { isAppPruneTick } from "../../../../FeatureSet/Workers/Jobs/Cloud/CleanupStaleResources";

const JOB_NAME: string = "Cloud:CleanupStaleResources";
const THRESHOLD_MS: number = 15 * 60 * 1000;
const NOW: Date = new Date("2026-09-08T10:00:00.000Z");
// A tick that is not the first of its hour, and one that is.
const MID_HOUR_TICK: Date = new Date("2026-09-08T10:05:00.000Z");
const TOP_OF_HOUR_TICK: Date = new Date("2026-09-08T11:00:00.000Z");
const APP_RETENTION_MS: number = 30 * 24 * 60 * 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const RESOURCE_A_ID: ObjectID = new ObjectID("cloud-env-a");
const RESOURCE_B_ID: ObjectID = new ObjectID("cloud-env-b");

interface ResourceServiceMock {
  markDisconnectedResources: jest.Mock;
  markUnreportedMonitoredResources: jest.Mock;
  restoreReportingMonitoredResources: jest.Mock;
  archiveUnseenMonitoredResources: jest.Mock;
  findBy: jest.Mock;
}

interface InstanceServiceMock {
  getStaleThresholdDate: jest.Mock;
  deleteStaleForResource: jest.Mock;
}

interface AppServiceMock {
  getUnseenThresholdDate: jest.Mock;
  getRetentionDays: jest.Mock;
  deleteUnseenForResource: jest.Mock;
}

interface RevisionServiceMock {
  deleteUnseenForResource: jest.Mock;
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
  cloudResourceId: ObjectID;
  olderThan: Date;
}

const resourceService: ResourceServiceMock =
  CloudResourceService as unknown as ResourceServiceMock;
const instanceService: InstanceServiceMock =
  CloudResourceInstanceService as unknown as InstanceServiceMock;
const mockedLogger: LoggerMock = logger as unknown as LoggerMock;
const appService: AppServiceMock = CloudAppService as unknown as AppServiceMock;
const revisionService: RevisionServiceMock =
  CloudAppRevisionService as unknown as RevisionServiceMock;

/*
 * Stand-in for the real helper: anchor minus a fixed 15 minutes, wall
 * clock when no anchor is given. Re-primed in beforeEach because
 * resetAllMocks drops every implementation.
 */
function thresholdFor(nowOverride?: Date): Date {
  const anchor: Date = nowOverride || new Date(NOW);
  return new Date(anchor.getTime() - THRESHOLD_MS);
}

function makeResource(data: {
  id: ObjectID | undefined;
  lastSeenAt?: Date | undefined;
}): CloudResource {
  const resource: CloudResource = new CloudResource();
  // findBy returns _id as the raw string column, which is what the job reads.
  if (data.id) {
    resource._id = data.id.toString();
  }
  resource.projectId = PROJECT_ID;
  if (data.lastSeenAt) {
    resource.lastSeenAt = data.lastSeenAt;
  }
  return resource;
}

function deleteCalls(): Array<DeleteStaleArgs> {
  return instanceService.deleteStaleForResource.mock.calls.map(
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
  resourceService.markDisconnectedResources.mockResolvedValue(undefined);
  resourceService.markUnreportedMonitoredResources.mockResolvedValue(0);
  resourceService.restoreReportingMonitoredResources.mockResolvedValue(0);
  resourceService.archiveUnseenMonitoredResources.mockResolvedValue(0);
  resourceService.findBy.mockResolvedValue([]);
  instanceService.getStaleThresholdDate.mockImplementation(thresholdFor);
  instanceService.deleteStaleForResource.mockResolvedValue(0);
  appService.getUnseenThresholdDate.mockImplementation((anchor: Date): Date => {
    return new Date(anchor.getTime() - APP_RETENTION_MS);
  });
  appService.getRetentionDays.mockReturnValue(30);
  appService.deleteUnseenForResource.mockResolvedValue(0);
  revisionService.deleteUnseenForResource.mockResolvedValue(0);
  // resetAllMocks reset this spy too: re-pin the clock every test.
  jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockReturnValue(new Date(MID_HOUR_TICK));
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

    expect(source).toContain('import "./Jobs/Cloud/CleanupStaleResources";');
  });
});

describe("step 1: the disconnect sweep", () => {
  test("marks stale environments disconnected BEFORE scanning for connected ones", async () => {
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(resourceService.markDisconnectedResources).toHaveBeenCalledTimes(1);
    // Step 2 must see step 1's status flips, so the order is load-bearing.
    expect(
      resourceService.markDisconnectedResources.mock.invocationCallOrder[0],
    ).toBeLessThan(resourceService.findBy.mock.invocationCallOrder[0]!);
  });

  test("a failing disconnect sweep is logged and the prune still runs", async () => {
    resourceService.markDisconnectedResources.mockRejectedValue(
      new Error("redis exploded"),
    );
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW }),
    ]);

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("markDisconnectedResources failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("redis exploded"),
    );
    expect(resourceService.findBy).toHaveBeenCalledTimes(1);
    expect(deleteCalls()).toHaveLength(1);
  });
});

describe("step 2: which environments are pruned", () => {
  test("scans only environments still marked connected, as root, across the whole table", async () => {
    await runTick();

    const args: FindByArgs = resourceService.findBy.mock
      .calls[0]![0] as FindByArgs;

    // Only environments have instances: resources are never scanned here.
    expect(args.query).toEqual({
      cloudResourceKind: CloudResourceKind.Environment,
      otelCollectorStatus: "connected",
    });
    expect(args.props).toEqual({ isRoot: true });
    expect(args.limit).toBe(LIMIT_MAX);
    expect(args.skip).toBe(0);
    expect(args.select).toEqual({
      _id: true,
      projectId: true,
      lastSeenAt: true,
    });
  });

  test("prunes nothing when no environment is connected", async () => {
    await runTick();

    expect(instanceService.deleteStaleForResource).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("prunes every connected environment it was handed, by id", async () => {
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW }),
      makeResource({ id: RESOURCE_B_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(
      deleteCalls().map((call: DeleteStaleArgs): string => {
        return call.cloudResourceId.toString();
      }),
    ).toEqual([RESOURCE_A_ID.toString(), RESOURCE_B_ID.toString()]);
  });

  test("skips a row that came back without an id", async () => {
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: undefined, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(instanceService.deleteStaleForResource).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});

describe("the prune cutoff", () => {
  test("is anchored to each environment's OWN lastSeenAt minus the threshold, not the wall clock", async () => {
    const seenA: Date = new Date("2026-09-08T09:58:00.000Z");
    const seenB: Date = new Date("2026-09-08T09:50:00.000Z");
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: RESOURCE_A_ID, lastSeenAt: seenA }),
      makeResource({ id: RESOURCE_B_ID, lastSeenAt: seenB }),
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

  test("falls back to the wall clock for an environment that has no lastSeenAt yet", async () => {
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: RESOURCE_A_ID }),
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
  test("one environment's prune failure is logged and the loop continues to the next", async () => {
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW }),
      makeResource({ id: RESOURCE_B_ID, lastSeenAt: NOW }),
    ]);
    instanceService.deleteStaleForResource.mockImplementation(
      (args: DeleteStaleArgs): Promise<number> => {
        if (args.cloudResourceId.toString() === RESOURCE_A_ID.toString()) {
          return Promise.reject(new Error("db connection reset"));
        }
        return Promise.resolve(1);
      },
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(deleteCalls()).toHaveLength(2);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(RESOURCE_A_ID.toString()),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("db connection reset"),
    );
  });

  test("a failing connected-environment scan is logged and never thrown", async () => {
    resourceService.findBy.mockRejectedValue(new Error("postgres down"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("cron failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("postgres down"),
    );
    expect(instanceService.deleteStaleForResource).not.toHaveBeenCalled();
  });

  test("a failing disconnect sweep AND a failing prune together still never throw", async () => {
    resourceService.markDisconnectedResources.mockRejectedValue(
      new Error("redis exploded"),
    );
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW }),
    ]);
    instanceService.deleteStaleForResource.mockRejectedValue(
      new Error("db connection reset"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
  });
});

describe("reporting", () => {
  test("logs one debug line with the total pruned across all connected environments", async () => {
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW }),
      makeResource({ id: RESOURCE_B_ID, lastSeenAt: NOW }),
    ]);
    instanceService.deleteStaleForResource
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("pruned 5 "),
    );
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("2 connected cloud environment(s)"),
    );
  });

  test("stays quiet when nothing was pruned", async () => {
    resourceService.findBy.mockResolvedValue([
      makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });
});

/*
 * Steps 3 and 4: the Cloud Resources discovered from cloud monitoring
 * (CloudResourceKind.Resource). Their status window, archive and restore
 * live in CloudResourceService (pinned in Common/Tests/Server/Services/
 * CloudResourceServiceMonitoredResources.test.ts); here, that the tick runs
 * them, in an order that cannot archive a row the same tick should restore,
 * and that none of them can take the others down.
 */
describe("steps 3 and 4: cloud resources", () => {
  test("every tick marks unreported resources, then restores the reporting ones, then archives the silent ones", async () => {
    await runTick();

    expect(
      resourceService.markUnreportedMonitoredResources,
    ).toHaveBeenCalledTimes(1);
    expect(
      resourceService.restoreReportingMonitoredResources,
    ).toHaveBeenCalledTimes(1);
    expect(
      resourceService.archiveUnseenMonitoredResources,
    ).toHaveBeenCalledTimes(1);

    const order: Array<number> = [
      resourceService.markDisconnectedResources.mock.invocationCallOrder[0]!,
      resourceService.markUnreportedMonitoredResources.mock
        .invocationCallOrder[0]!,
      resourceService.restoreReportingMonitoredResources.mock
        .invocationCallOrder[0]!,
      resourceService.archiveUnseenMonitoredResources.mock
        .invocationCallOrder[0]!,
      resourceService.findBy.mock.invocationCallOrder[0]!,
    ];
    expect(
      [...order].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(order);
  });

  test("a failing status sweep is logged, and archiving and the prune still run", async () => {
    resourceService.markUnreportedMonitoredResources.mockRejectedValue(
      new Error("statement timeout"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("markUnreportedMonitoredResources failed"),
    );
    expect(
      resourceService.archiveUnseenMonitoredResources,
    ).toHaveBeenCalledTimes(1);
    expect(resourceService.findBy).toHaveBeenCalledTimes(1);
  });

  test("a failing archive pass is logged and the prune still runs", async () => {
    resourceService.archiveUnseenMonitoredResources.mockRejectedValue(
      new Error("deadlock detected"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("cloud resource auto-archive failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("deadlock detected"),
    );
    expect(resourceService.findBy).toHaveBeenCalledTimes(1);
  });

  test("says how many resources it restored and archived, and only when it did", async () => {
    resourceService.restoreReportingMonitoredResources.mockResolvedValue(2);
    resourceService.archiveUnseenMonitoredResources.mockResolvedValue(7);

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("restored 2 and archived 7 cloud resource(s)"),
    );
  });
});

/*
 * Step 5: App Platforms' apps and their revisions. The retention window and
 * the deletes live in CloudAppService and CloudAppRevisionService (pinned in
 * Common/Tests/Server/Services/CloudAppService.test.ts and
 * CloudAppRevisionService.test.ts); here, that the tick runs them once an
 * hour, for every environment, anchored to its own last telemetry, and that
 * no failure there stops the rest.
 */
describe("step 5: apps and revisions that sent nothing", () => {
  function appPruneCalls(): Array<{
    cloudResourceId: ObjectID;
    olderThan: Date;
  }> {
    return appService.deleteUnseenForResource.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as { cloudResourceId: ObjectID; olderThan: Date };
      },
    );
  }

  // The environments the prune reads, and the connected ones step 2 does.
  function answerEnvironments(data: {
    all: Array<CloudResource>;
    connected?: Array<CloudResource>;
  }): void {
    resourceService.findBy.mockImplementation(async (args: FindByArgs) => {
      return args.query["otelCollectorStatus"] === "connected"
        ? data.connected || []
        : data.all;
    });
  }

  test("isAppPruneTick: the first five-minute tick of each hour, in UTC", () => {
    expect(isAppPruneTick(new Date("2026-09-08T11:00:00.000Z"))).toBe(true);
    expect(isAppPruneTick(new Date("2026-09-08T11:04:59.999Z"))).toBe(true);
    expect(isAppPruneTick(new Date("2026-09-08T11:05:00.000Z"))).toBe(false);
    expect(isAppPruneTick(new Date("2026-09-08T11:59:00.000Z"))).toBe(false);
  });

  test("runs on the first tick of an hour, and on no other", async () => {
    answerEnvironments({
      all: [makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW })],
    });

    await runTick();

    expect(appService.deleteUnseenForResource).not.toHaveBeenCalled();
    expect(revisionService.deleteUnseenForResource).not.toHaveBeenCalled();

    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(TOP_OF_HOUR_TICK));

    await runTick();

    expect(appService.deleteUnseenForResource).toHaveBeenCalledTimes(1);
    expect(revisionService.deleteUnseenForResource).toHaveBeenCalledTimes(1);
  });

  test("prunes every environment's apps and revisions, anchored to its own lastSeenAt, as root", async () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(TOP_OF_HOUR_TICK));
    const seenA: Date = new Date("2026-09-08T09:58:00.000Z");
    const seenB: Date = new Date("2026-08-01T00:00:00.000Z");
    answerEnvironments({
      all: [
        makeResource({ id: RESOURCE_A_ID, lastSeenAt: seenA }),
        // Disconnected for weeks: its apps are kept until it reports again.
        makeResource({ id: RESOURCE_B_ID, lastSeenAt: seenB }),
        // Never reported: nothing of it to prune.
        makeResource({ id: new ObjectID("cloud-env-c") }),
        makeResource({ id: undefined, lastSeenAt: seenA }),
      ],
    });

    await runTick();

    // Every environment, connected or not, read as root across the table.
    const pruneRead: FindByArgs = resourceService.findBy.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return !(call[0] as FindByArgs).query["otelCollectorStatus"];
      },
    )![0] as FindByArgs;
    expect(pruneRead.query).toEqual({
      cloudResourceKind: CloudResourceKind.Environment,
    });
    expect(pruneRead.select).toEqual({ _id: true, lastSeenAt: true });
    expect(pruneRead.props).toEqual({ isRoot: true });
    expect(pruneRead.limit).toBe(LIMIT_MAX);

    expect(appService.getUnseenThresholdDate).toHaveBeenNthCalledWith(1, seenA);
    expect(appService.getUnseenThresholdDate).toHaveBeenNthCalledWith(2, seenB);

    const calls: Array<{ cloudResourceId: ObjectID; olderThan: Date }> =
      appPruneCalls();
    expect(
      calls.map((call: { cloudResourceId: ObjectID }): string => {
        return call.cloudResourceId.toString();
      }),
    ).toEqual([RESOURCE_A_ID.toString(), RESOURCE_B_ID.toString()]);
    expect(calls[0]!.olderThan.getTime()).toBe(
      seenA.getTime() - APP_RETENTION_MS,
    );
    expect(calls[1]!.olderThan.getTime()).toBe(
      seenB.getTime() - APP_RETENTION_MS,
    );
    // The revisions of the same environments, with the same cutoffs.
    expect(revisionService.deleteUnseenForResource.mock.calls).toEqual(
      appService.deleteUnseenForResource.mock.calls,
    );
  });

  test("one environment's failure is logged, and the next environment and the instance prune still run", async () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(TOP_OF_HOUR_TICK));
    answerEnvironments({
      all: [
        makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW }),
        makeResource({ id: RESOURCE_B_ID, lastSeenAt: NOW }),
      ],
      connected: [makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW })],
    });
    appService.deleteUnseenForResource
      .mockRejectedValueOnce(new Error("db connection reset"))
      .mockResolvedValueOnce(2);
    revisionService.deleteUnseenForResource.mockResolvedValue(5);

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `app prune failed for cloud environment ${RESOURCE_A_ID.toString()}`,
      ),
    );
    expect(appPruneCalls()).toHaveLength(2);
    expect(deleteCalls()).toHaveLength(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        "removed 2 app(s) and 5 revision(s) that sent nothing for 30 days",
      ),
    );
  });

  test("a failing read of the environments is logged, and the instance prune still runs", async () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(TOP_OF_HOUR_TICK));
    resourceService.findBy.mockImplementation(async (args: FindByArgs) => {
      if (!args.query["otelCollectorStatus"]) {
        throw new Error("postgres went away");
      }
      return [makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW })];
    });

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("app prune failed: postgres went away"),
    );
    expect(deleteCalls()).toHaveLength(1);
  });

  test("stays quiet when nothing was removed", async () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date(TOP_OF_HOUR_TICK));
    answerEnvironments({
      all: [makeResource({ id: RESOURCE_A_ID, lastSeenAt: NOW })],
    });

    await runTick();

    expect(appPruneCalls()).toHaveLength(1);
    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });
});
