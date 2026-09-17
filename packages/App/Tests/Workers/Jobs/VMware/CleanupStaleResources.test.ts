import fs from "fs";
import path from "path";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * VMware:CleanupStaleResources is the inventory sweeper for the VMware
 * product: the only scheduled caller of
 * VMwareVCenterService.markDisconnectedVCenters, and the only thing that
 * ever prunes VMwareResource rows (ESXi hosts, virtual machines,
 * datastores, clusters, resource pools, datacenters) once the vcenter
 * receiver stops reporting them. These tests drive one full tick and
 * pin the contract the job's header comment promises:
 *
 *   1. markDisconnectedVCenters runs FIRST and in its own try — its
 *      failure is logged and the prune still runs;
 *   2. the prune scans only vCenters still marked "connected"
 *      (disconnected ones keep their last-known inventory on purpose);
 *   3. the cutoff handed to deleteStaleForVCenter is the vCenter's OWN
 *      lastSeenAt minus the threshold — anchored, not wall-clock — and a
 *      vCenter with no lastSeenAt yet falls back to the clock;
 *   4. one vCenter's prune failure is logged and the loop continues;
 *   5. the handler never throws, whatever fails underneath it;
 *   6. the worker Index actually imports the job — a job file that is not
 *      imported never registers.
 *
 * The job registers itself via RunCron at import time and exports nothing,
 * so the Cron util is mocked to capture the handler — the same recorder the
 * other App/Tests/Workers/Jobs suites use. Both services are replaced with
 * factories so no DatabaseService (and so no Postgres / Redis / BullMQ) is
 * loaded. The resource service's env parsing (VMWARE_INVENTORY_STALE_MINUTES)
 * and threshold arithmetic belong to the Common service tests; the mock
 * here echoes a fixed 15-minute window so the anchor wiring is observable
 * end to end.
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

jest.mock("Common/Server/Services/VMwareVCenterService", () => {
  return {
    __esModule: true,
    default: {
      markDisconnectedVCenters: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/VMwareResourceService", () => {
  return {
    __esModule: true,
    default: {
      getStaleThresholdDate: jest.fn(),
      deleteStaleForVCenter: jest.fn(),
    },
  };
});

import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import VMwareResourceService from "Common/Server/Services/VMwareResourceService";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/VMware/CleanupStaleResources";

const JOB_NAME: string = "VMware:CleanupStaleResources";
const THRESHOLD_MS: number = 15 * 60 * 1000;
const NOW: Date = new Date("2026-09-09T10:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const VCENTER_A_ID: ObjectID = new ObjectID("vcenter-a");
const VCENTER_B_ID: ObjectID = new ObjectID("vcenter-b");

interface VCenterServiceMock {
  markDisconnectedVCenters: jest.Mock;
  findBy: jest.Mock;
}

interface ResourceServiceMock {
  getStaleThresholdDate: jest.Mock;
  deleteStaleForVCenter: jest.Mock;
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
  vmwareVCenterId: ObjectID;
  olderThan: Date;
}

const vcenterService: VCenterServiceMock =
  VMwareVCenterService as unknown as VCenterServiceMock;
const resourceService: ResourceServiceMock =
  VMwareResourceService as unknown as ResourceServiceMock;
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

function makeVCenter(data: {
  id: ObjectID | undefined;
  lastSeenAt?: Date | undefined;
}): VMwareVCenter {
  const vcenter: VMwareVCenter = new VMwareVCenter();
  // findBy returns _id as the raw string column, which is what the job reads.
  if (data.id) {
    vcenter._id = data.id.toString();
  }
  vcenter.projectId = PROJECT_ID;
  if (data.lastSeenAt) {
    vcenter.lastSeenAt = data.lastSeenAt;
  }
  return vcenter;
}

function deleteCalls(): Array<DeleteStaleArgs> {
  return resourceService.deleteStaleForVCenter.mock.calls.map(
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
  vcenterService.markDisconnectedVCenters.mockResolvedValue(undefined);
  vcenterService.findBy.mockResolvedValue([]);
  resourceService.getStaleThresholdDate.mockImplementation(thresholdFor);
  resourceService.deleteStaleForVCenter.mockResolvedValue(0);
});

describe("the cron registers itself", () => {
  test("under its documented name, every five minutes, and not on startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    });
  });

  test("is the only VMware job this file registers", () => {
    const vmwareJobs: Array<string> = Object.keys(mockCapturedJobs).filter(
      (name: string): boolean => {
        return name.startsWith("VMware:");
      },
    );
    expect(vmwareJobs).toEqual([JOB_NAME]);
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

    expect(source).toContain('import "./Jobs/VMware/CleanupStaleResources";');
  });

  test("is imported by the worker Index next to the Proxmox sweeper it mirrors", () => {
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

    const proxmoxIndex: number = source.indexOf(
      'import "./Jobs/Proxmox/CleanupStaleResources";',
    );
    const vmwareIndex: number = source.indexOf(
      'import "./Jobs/VMware/CleanupStaleResources";',
    );
    expect(proxmoxIndex).toBeGreaterThanOrEqual(0);
    expect(vmwareIndex).toBeGreaterThan(proxmoxIndex);
  });
});

describe("step 1: the disconnect sweep", () => {
  test("marks stale vCenters disconnected BEFORE scanning for connected ones", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(vcenterService.markDisconnectedVCenters).toHaveBeenCalledTimes(1);
    // Step 2 must see step 1's status flips, so the order is load-bearing.
    expect(
      vcenterService.markDisconnectedVCenters.mock.invocationCallOrder[0],
    ).toBeLessThan(vcenterService.findBy.mock.invocationCallOrder[0]!);
  });

  test("runs the disconnect sweep even when no vCenter is connected", async () => {
    await runTick();

    expect(vcenterService.markDisconnectedVCenters).toHaveBeenCalledTimes(1);
    expect(vcenterService.findBy).toHaveBeenCalledTimes(1);
  });

  test("a failing disconnect sweep is logged and the prune still runs", async () => {
    vcenterService.markDisconnectedVCenters.mockRejectedValue(
      new Error("redis exploded"),
    );
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
    ]);

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("markDisconnectedVCenters failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("redis exploded"),
    );
    expect(vcenterService.findBy).toHaveBeenCalledTimes(1);
    expect(deleteCalls()).toHaveLength(1);
  });

  test("a non-Error rejection from the disconnect sweep is stringified, not swallowed silently", async () => {
    vcenterService.markDisconnectedVCenters.mockRejectedValue(
      "plain string failure",
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("plain string failure"),
    );
  });
});

describe("step 2: which vCenters are pruned", () => {
  test("scans only vCenters still marked connected, as root, across the whole table", async () => {
    await runTick();

    const args: FindByArgs = vcenterService.findBy.mock
      .calls[0]![0] as FindByArgs;

    // Disconnected vCenters are never queried, so their inventory survives.
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

  test("prunes nothing when no vCenter is connected", async () => {
    await runTick();

    expect(resourceService.getStaleThresholdDate).not.toHaveBeenCalled();
    expect(resourceService.deleteStaleForVCenter).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("prunes every connected vCenter it was handed, by id, under the vmwareVCenterId key", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
      makeVCenter({ id: VCENTER_B_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    const calls: Array<DeleteStaleArgs> = deleteCalls();
    expect(
      calls.map((call: DeleteStaleArgs): string => {
        return call.vmwareVCenterId.toString();
      }),
    ).toEqual([VCENTER_A_ID.toString(), VCENTER_B_ID.toString()]);
    // The service takes an ObjectID, not the raw string column findBy returns.
    for (const call of calls) {
      expect(call.vmwareVCenterId).toBeInstanceOf(ObjectID);
      expect(Object.keys(call).sort()).toEqual([
        "olderThan",
        "vmwareVCenterId",
      ]);
    }
  });

  test("skips a row that came back without an id", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: undefined, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(resourceService.getStaleThresholdDate).not.toHaveBeenCalled();
    expect(resourceService.deleteStaleForVCenter).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("skips the id-less row but still prunes the others in the same tick", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: undefined, lastSeenAt: NOW }),
      makeVCenter({ id: VCENTER_B_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(
      deleteCalls().map((call: DeleteStaleArgs): string => {
        return call.vmwareVCenterId.toString();
      }),
    ).toEqual([VCENTER_B_ID.toString()]);
  });
});

describe("the prune cutoff", () => {
  test("is anchored to each vCenter's OWN lastSeenAt minus the threshold, not the wall clock", async () => {
    const seenA: Date = new Date("2026-09-09T09:58:00.000Z");
    const seenB: Date = new Date("2026-09-09T09:50:00.000Z");
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: seenA }),
      makeVCenter({ id: VCENTER_B_ID, lastSeenAt: seenB }),
    ]);

    await runTick();

    // The anchor handed to the service helper is the row's lastSeenAt...
    expect(resourceService.getStaleThresholdDate).toHaveBeenCalledTimes(2);
    expect(resourceService.getStaleThresholdDate).toHaveBeenNthCalledWith(
      1,
      seenA,
    );
    expect(resourceService.getStaleThresholdDate).toHaveBeenNthCalledWith(
      2,
      seenB,
    );

    // ...and the cutoff that reaches the delete is that anchor minus the threshold.
    const calls: Array<DeleteStaleArgs> = deleteCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.olderThan.getTime()).toBe(seenA.getTime() - THRESHOLD_MS);
    expect(calls[1]!.olderThan.getTime()).toBe(seenB.getTime() - THRESHOLD_MS);
    // Neither cutoff is the wall-clock one.
    expect(calls[0]!.olderThan.getTime()).not.toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
    expect(calls[1]!.olderThan.getTime()).not.toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
  });

  test("hands the service's own cutoff through untouched — the cron carries no threshold policy", async () => {
    const serviceCutoff: Date = new Date("2026-09-09T09:00:00.000Z");
    resourceService.getStaleThresholdDate.mockReturnValue(serviceCutoff);
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(deleteCalls()[0]!.olderThan).toBe(serviceCutoff);
  });

  test("falls back to the wall clock for a vCenter that has no lastSeenAt yet", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID }),
    ]);

    await runTick();

    expect(resourceService.getStaleThresholdDate).toHaveBeenCalledWith(
      undefined,
    );
    expect(deleteCalls()[0]!.olderThan.getTime()).toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
  });
});

describe("resilience", () => {
  test("one vCenter's prune failure is logged and the loop continues to the next", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
      makeVCenter({ id: VCENTER_B_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForVCenter.mockImplementation(
      (args: DeleteStaleArgs): Promise<number> => {
        if (args.vmwareVCenterId.toString() === VCENTER_A_ID.toString()) {
          return Promise.reject(new Error("db connection reset"));
        }
        return Promise.resolve(1);
      },
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(deleteCalls()).toHaveLength(2);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("deleteStaleForVCenter failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(VCENTER_A_ID.toString()),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(PROJECT_ID.toString()),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("db connection reset"),
    );
  });

  test("a prune failure on the LAST vCenter still lets the earlier deletes count", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
      makeVCenter({ id: VCENTER_B_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForVCenter
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new Error("statement timeout"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("pruned 4 "),
    );
  });

  test("a failing connected-vCenter scan is logged and never thrown", async () => {
    vcenterService.findBy.mockRejectedValue(new Error("postgres down"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("cron failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("postgres down"),
    );
    expect(resourceService.deleteStaleForVCenter).not.toHaveBeenCalled();
  });

  test("a throwing threshold helper is caught by the outer guard and never thrown", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
    ]);
    resourceService.getStaleThresholdDate.mockImplementation((): Date => {
      throw new Error("bad env");
    });

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("cron failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("bad env"),
    );
    expect(resourceService.deleteStaleForVCenter).not.toHaveBeenCalled();
  });

  test("a failing disconnect sweep AND a failing prune together still never throw", async () => {
    vcenterService.markDisconnectedVCenters.mockRejectedValue(
      new Error("redis exploded"),
    );
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForVCenter.mockRejectedValue(
      new Error("db connection reset"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
  });

  test("a tick that fails is isolated — the next tick starts clean", async () => {
    vcenterService.findBy.mockRejectedValueOnce(new Error("postgres down"));
    await expect(runTick()).resolves.toBeUndefined();

    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
    ]);
    await expect(runTick()).resolves.toBeUndefined();

    expect(vcenterService.markDisconnectedVCenters).toHaveBeenCalledTimes(2);
    expect(deleteCalls()).toHaveLength(1);
  });
});

describe("reporting", () => {
  test("logs one debug line with the total pruned across all connected vCenters", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
      makeVCenter({ id: VCENTER_B_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForVCenter
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
      expect.stringContaining("VMwareResource"),
    );
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("2 connected vCenter(s)"),
    );
  });

  test("stays quiet when nothing was pruned", async () => {
    vcenterService.findBy.mockResolvedValue([
      makeVCenter({ id: VCENTER_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(mockedLogger.debug).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("never mentions Proxmox concepts — this is the vSphere sweeper", async () => {
    const jobPath: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "FeatureSet",
      "Workers",
      "Jobs",
      "VMware",
      "CleanupStaleResources.ts",
    );
    const source: string = fs.readFileSync(jobPath, "utf8");

    expect(source).toContain('"VMware:CleanupStaleResources"');
    expect(source).toContain("VMwareVCenterService.markDisconnectedVCenters");
    expect(source).toContain("VMwareResourceService.deleteStaleForVCenter");
    expect(source).toContain("VMWARE_INVENTORY_STALE_MINUTES");
    expect(source).not.toMatch(/PVE_|pve|ProxmoxCluster|ProxmoxResource/);
  });
});
