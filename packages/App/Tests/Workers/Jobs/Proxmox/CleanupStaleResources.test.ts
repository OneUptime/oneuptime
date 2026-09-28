import fs from "fs";
import path from "path";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * Proxmox:CleanupStaleResources is the inventory sweeper for the Proxmox
 * product: the only scheduled caller of
 * ProxmoxClusterService.markDisconnectedClusters, and the only thing that
 * ever prunes ProxmoxResource rows (nodes, guests, storage) once nothing
 * reports them any more. These tests drive whole ticks and pin the
 * contract the job's header comment promises:
 *
 *   1. markDisconnectedClusters runs FIRST and in its own try — its
 *      failure is logged and the prune still runs, and a cluster it
 *      flips is not pruned in the same tick;
 *   2. the prune scans only clusters still marked "connected"
 *      (disconnected ones keep their last-known inventory on purpose);
 *   3. the cutoff handed to deleteStaleForCluster is the cluster's OWN
 *      lastSeenAt minus the stale threshold — anchored, not wall-clock —
 *      and a cluster with no lastSeenAt yet falls back to the clock;
 *   4. one cluster's prune failure is logged and the loop continues;
 *   5. the handler never throws, whatever fails underneath it;
 *   6. the worker Index actually imports the job — a job file that is not
 *      imported never registers;
 *   7. the Proxmox VE native-push exception — a Node row the native push
 *      wrote (isNativePush) outlives the cutoff for the retention window,
 *      marked Offline or not yet, because those rows are the cluster's
 *      roster — is a rule of ProxmoxResourceService.deleteStaleForCluster,
 *      not of this cron: the cron still hands over only the cluster id and
 *      the anchored cutoff, and its header documents the rule. The rule
 *      holds only while silent-node detection is on: switched off
 *      (PVE_NATIVE_NODE_SILENCE_DETECTION=false) nothing marks a silent
 *      node Offline, so the service drops the keep and every row goes on
 *      the stale cutoff, as before the native push had one.
 *
 * The job registers itself via RunCron at import time and exports nothing,
 * so the Cron util is mocked to capture the handler — the same recorder the
 * other App/Tests/Workers/Jobs suites use. Both services are replaced with
 * factories so no DatabaseService (and so no Postgres / Redis / BullMQ) is
 * loaded, and so is GlobalCache: the timeline below runs only the pure
 * functions of the node-liveness module. The service's env parsing
 * (PVE_INVENTORY_STALE_MINUTES, PVE_SILENT_NODE_RETENTION_HOURS) and its
 * SQL belong to the Common service tests; the mock here echoes a fixed
 * 15-minute window so the anchor wiring is observable end to end.
 *
 * The last blocks ("timeline") replay days of a native-push cluster
 * through the REAL handler against a small in-memory model of the
 * inventory — the service's delete predicate (with its retention cutoff),
 * bulkUpsert, getNodeRoster, markNodesNotReporting's UPDATE, the cluster
 * heartbeat fence and markDisconnectedClusters, each mirrored from the
 * service — driven by the REAL node-liveness rules
 * (nextProxmoxNodeLiveness, decideProxmoxSilentNodes,
 * isProxmoxSilentNodeDetectionEnabled). They show that the cutoff this
 * cron chooses keeps a native-push node for the whole retention window —
 * through a OneUptime ingest outage or a whole-cluster power cut and the
 * warm-up after it, when nobody reports and the node may not even be
 * marked Offline yet — lets it go on the first tick past that window,
 * leaves the agent's rows on the 15-minute prune, keeps a node that was
 * already Offline when its cluster moved from the agent to the native
 * push (or since before isNativePush existed) once its first report marks
 * it native, never prunes a cluster that went dark as a whole, and — with
 * silent-node detection switched off — prunes a dead native node at the
 * stale cutoff like any other row. PVE_NATIVE_NODE_SILENCE_DETECTION is
 * the one env switch the timeline sets for real (saved and restored
 * around each test that does), since both the ingest and the delete
 * mirrors read it through the real isProxmoxSilentNodeDetectionEnabled.
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

jest.mock("Common/Server/Services/ProxmoxClusterService", () => {
  return {
    __esModule: true,
    default: {
      markDisconnectedClusters: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProxmoxResourceService", () => {
  return {
    __esModule: true,
    default: {
      getStaleThresholdDate: jest.fn(),
      deleteStaleForCluster: jest.fn(),
    },
  };
});

/*
 * The node-liveness module imports GlobalCache for its Redis-backed entry
 * point, which the timeline never calls: an empty stand-in keeps Redis
 * unloaded.
 */
jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {},
  };
});

import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import ProxmoxResourceService from "Common/Server/Services/ProxmoxResourceService";
import logger from "Common/Server/Utils/Logger";
import {
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
  ProxmoxNodeLiveness,
  ProxmoxRosterNode,
  ProxmoxSilentNodeDecision,
  decideProxmoxSilentNodes,
  isAliveProxmoxNode,
  isEligibleProxmoxReporter,
  isProxmoxSilentNodeDetectionEnabled,
  nextProxmoxNodeLiveness,
  parseProxmoxNodeLiveness,
  serializeProxmoxNodeLiveness,
} from "Common/Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Proxmox/CleanupStaleResources";

const JOB_NAME: string = "Proxmox:CleanupStaleResources";
const MINUTE_MS: number = 60 * 1000;
const THRESHOLD_MS: number = 15 * MINUTE_MS;
const NOW: Date = new Date("2026-09-09T10:00:00.000Z");

const CLUSTER_A_ID: ObjectID = new ObjectID("cluster-a");
const CLUSTER_B_ID: ObjectID = new ObjectID("cluster-b");
const CLUSTER_C_ID: ObjectID = new ObjectID("cluster-c");

const APP_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const JOB_SOURCE_PATH: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Workers",
  "Jobs",
  "Proxmox",
  "CleanupStaleResources.ts",
);
const WORKER_INDEX_PATH: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Workers",
  "Index.ts",
);

interface ClusterServiceMock {
  markDisconnectedClusters: jest.Mock;
  findBy: jest.Mock;
}

interface ResourceServiceMock {
  getStaleThresholdDate: jest.Mock;
  deleteStaleForCluster: jest.Mock;
}

interface LoggerMock {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
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
  proxmoxClusterId: ObjectID;
  olderThan: Date;
  // The service's retention clock; the cron leaves it to the wall clock.
  now?: Date | undefined;
}

const clusterService: ClusterServiceMock =
  ProxmoxClusterService as unknown as ClusterServiceMock;
const resourceService: ResourceServiceMock =
  ProxmoxResourceService as unknown as ResourceServiceMock;
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

function makeCluster(data: {
  id: ObjectID | undefined;
  lastSeenAt?: Date | null | undefined;
}): ProxmoxCluster {
  const cluster: ProxmoxCluster = new ProxmoxCluster();
  // findBy returns _id as the raw string column, which is what the job reads.
  if (data.id) {
    cluster._id = data.id.toString();
  }
  if (data.lastSeenAt !== undefined) {
    /*
     * findBy hands back NULL for a cluster that has never been seen; the
     * model types the column as Date | undefined, hence the cast.
     */
    (cluster as unknown as { lastSeenAt: Date | null }).lastSeenAt =
      data.lastSeenAt;
  }
  return cluster;
}

function deleteCalls(): Array<DeleteStaleArgs> {
  return resourceService.deleteStaleForCluster.mock.calls.map(
    (call: Array<unknown>): DeleteStaleArgs => {
      return call[0] as DeleteStaleArgs;
    },
  );
}

function prunedClusterIds(): Array<string> {
  return deleteCalls().map((call: DeleteStaleArgs): string => {
    return call.proxmoxClusterId.toString();
  });
}

function findByArgs(): FindByArgs {
  return clusterService.findBy.mock.calls[0]![0] as FindByArgs;
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

function readJobSource(): string {
  return fs.readFileSync(JOB_SOURCE_PATH, "utf8");
}

// The job's leading block comment, folded onto one line for phrase matching.
function readJobHeader(): string {
  const source: string = readJobSource();
  const match: RegExpMatchArray | null = source.match(/\/\*[\s\S]*?\*\//);
  if (!match) {
    throw new Error("The job has no header comment.");
  }
  return match[0]
    .replace(/\n\s*\*\s?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The job's executable code, with every comment removed.
function readJobCode(): string {
  return readJobSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

beforeEach(() => {
  /*
   * resetAllMocks (not clearAllMocks) so a *Once value queued by one test
   * can never leak into the next; every default is re-primed below.
   */
  jest.resetAllMocks();
  clusterService.markDisconnectedClusters.mockResolvedValue(undefined);
  clusterService.findBy.mockResolvedValue([]);
  resourceService.getStaleThresholdDate.mockImplementation(thresholdFor);
  resourceService.deleteStaleForCluster.mockResolvedValue(0);
});

describe("the cron registers itself", () => {
  test("under its documented name, every five minutes, and not on startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    });
  });

  test("is the only job this file registers", () => {
    expect(Object.keys(mockCapturedJobs)).toEqual([JOB_NAME]);
  });

  test("is imported by the worker Index — an unimported job never registers", () => {
    const source: string = fs.readFileSync(WORKER_INDEX_PATH, "utf8");

    // A whole line of its own: not commented out, not a lookalike path.
    expect(source).toMatch(
      /^import "\.\/Jobs\/Proxmox\/CleanupStaleResources";$/m,
    );
  });

  test("the job file this suite reads is the one it imports", () => {
    expect(fs.existsSync(JOB_SOURCE_PATH)).toBe(true);
    expect(readJobSource()).toContain(`"${JOB_NAME}"`);
  });
});

describe("step 1: the disconnect sweep", () => {
  test("marks stale clusters disconnected BEFORE scanning for connected ones", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(clusterService.markDisconnectedClusters).toHaveBeenCalledTimes(1);
    expect(clusterService.markDisconnectedClusters).toHaveBeenCalledWith();
    // Step 2 must see step 1's status flips, so the order is load-bearing.
    expect(
      clusterService.markDisconnectedClusters.mock.invocationCallOrder[0],
    ).toBeLessThan(clusterService.findBy.mock.invocationCallOrder[0]!);
    expect(
      clusterService.markDisconnectedClusters.mock.invocationCallOrder[0],
    ).toBeLessThan(
      resourceService.deleteStaleForCluster.mock.invocationCallOrder[0]!,
    );
  });

  test("a cluster the sweep flips to disconnected is not pruned in the same tick", async () => {
    const status: Record<string, string> = {
      [CLUSTER_A_ID.toString()]: "connected",
      [CLUSTER_B_ID.toString()]: "connected",
    };
    // The sweep finds cluster B stale...
    clusterService.markDisconnectedClusters.mockImplementation(
      (): Promise<void> => {
        status[CLUSTER_B_ID.toString()] = "disconnected";
        return Promise.resolve();
      },
    );
    // ...and the connected scan reads the table after it.
    clusterService.findBy.mockImplementation(
      (args: FindByArgs): Promise<Array<ProxmoxCluster>> => {
        return Promise.resolve(
          [CLUSTER_A_ID, CLUSTER_B_ID]
            .filter((id: ObjectID): boolean => {
              return (
                status[id.toString()] === args.query["otelCollectorStatus"]
              );
            })
            .map((id: ObjectID): ProxmoxCluster => {
              return makeCluster({ id, lastSeenAt: NOW });
            }),
        );
      },
    );

    await runTick();

    expect(prunedClusterIds()).toEqual([CLUSTER_A_ID.toString()]);
  });

  test("runs the disconnect sweep even when no cluster is connected", async () => {
    await runTick();

    expect(clusterService.markDisconnectedClusters).toHaveBeenCalledTimes(1);
    expect(clusterService.findBy).toHaveBeenCalledTimes(1);
  });

  test("a failing disconnect sweep is logged and the prune still runs", async () => {
    clusterService.markDisconnectedClusters.mockRejectedValue(
      new Error("redis exploded"),
    );
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
    ]);

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(`${JOB_NAME}: markDisconnectedClusters failed`),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("redis exploded"),
    );
    expect(clusterService.findBy).toHaveBeenCalledTimes(1);
    expect(prunedClusterIds()).toEqual([CLUSTER_A_ID.toString()]);
  });

  test("a non-Error rejection from the disconnect sweep is stringified, not swallowed silently", async () => {
    clusterService.markDisconnectedClusters.mockRejectedValue(
      "plain string failure",
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("plain string failure"),
    );
  });
});

describe("step 2: which clusters are pruned", () => {
  test("scans only clusters still marked connected, as root, across the whole table", async () => {
    await runTick();

    const args: FindByArgs = findByArgs();

    // Disconnected clusters are never queried, so their inventory survives.
    expect(args.query).toEqual({ otelCollectorStatus: "connected" });
    expect(args.props).toEqual({ isRoot: true });
    expect(args.limit).toBe(LIMIT_MAX);
    expect(args.skip).toBe(0);
    // lastSeenAt is selected because it anchors the cutoff.
    expect(args.select).toEqual({ _id: true, lastSeenAt: true });
  });

  test("prunes nothing when no cluster is connected", async () => {
    await runTick();

    expect(resourceService.getStaleThresholdDate).not.toHaveBeenCalled();
    expect(resourceService.deleteStaleForCluster).not.toHaveBeenCalled();
    expect(mockedLogger.debug).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("prunes every connected cluster it was handed, in order, by id, under the proxmoxClusterId key", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
      makeCluster({ id: CLUSTER_B_ID, lastSeenAt: NOW }),
      makeCluster({ id: CLUSTER_C_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(prunedClusterIds()).toEqual([
      CLUSTER_A_ID.toString(),
      CLUSTER_B_ID.toString(),
      CLUSTER_C_ID.toString(),
    ]);
    for (const call of deleteCalls()) {
      // The service takes an ObjectID, not the raw string column findBy returns.
      expect(call.proxmoxClusterId).toBeInstanceOf(ObjectID);
      expect(call.olderThan).toBeInstanceOf(Date);
    }
  });

  test("hands over only the cluster id and the cutoff — the silent-node keep rule stays in the service", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    /*
     * No kind / isUp / isNativePush / retention argument, and no `now`
     * either — the retention cutoff stays on the service's wall clock:
     * the rule that keeps a native-push Node row lives in
     * deleteStaleForCluster itself, so every caller gets it.
     */
    expect(resourceService.deleteStaleForCluster).toHaveBeenCalledTimes(1);
    expect(Object.keys(deleteCalls()[0]!).sort()).toEqual([
      "olderThan",
      "proxmoxClusterId",
    ]);
  });

  test("skips a row that came back without an id", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: undefined, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(resourceService.getStaleThresholdDate).not.toHaveBeenCalled();
    expect(resourceService.deleteStaleForCluster).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("skips the id-less row but still prunes the others in the same tick", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
      makeCluster({ id: undefined, lastSeenAt: NOW }),
      makeCluster({ id: CLUSTER_B_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(prunedClusterIds()).toEqual([
      CLUSTER_A_ID.toString(),
      CLUSTER_B_ID.toString(),
    ]);
  });
});

describe("the prune cutoff", () => {
  test("is anchored to each cluster's OWN lastSeenAt minus the threshold, not the wall clock", async () => {
    const seenA: Date = new Date("2026-09-09T09:58:00.000Z");
    const seenB: Date = new Date("2026-09-09T09:50:00.000Z");
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: seenA }),
      makeCluster({ id: CLUSTER_B_ID, lastSeenAt: seenB }),
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
    expect(calls[0]!.proxmoxClusterId.toString()).toBe(CLUSTER_A_ID.toString());
    expect(calls[0]!.olderThan.getTime()).toBe(seenA.getTime() - THRESHOLD_MS);
    expect(calls[1]!.proxmoxClusterId.toString()).toBe(CLUSTER_B_ID.toString());
    expect(calls[1]!.olderThan.getTime()).toBe(seenB.getTime() - THRESHOLD_MS);
    // Neither cutoff is the wall-clock one.
    expect(calls[0]!.olderThan.getTime()).not.toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
    expect(calls[1]!.olderThan.getTime()).not.toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
  });

  test("freezes the prune clock late in an outage: a connected cluster last seen 14 minutes ago keeps rows from 20 minutes ago", async () => {
    const seen: Date = new Date(NOW.getTime() - 14 * MINUTE_MS);
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: seen }),
    ]);

    await runTick();

    const cutoff: Date = deleteCalls()[0]!.olderThan;
    // 29 minutes back on the wall clock, so a row seen 20 minutes ago is kept.
    expect(cutoff.getTime()).toBe(NOW.getTime() - 29 * MINUTE_MS);
    expect(NOW.getTime() - 20 * MINUTE_MS).toBeGreaterThan(cutoff.getTime());
  });

  test("hands the service's own cutoff through untouched — the cron carries no threshold policy", async () => {
    const serviceCutoff: Date = new Date("2026-09-09T09:00:00.000Z");
    resourceService.getStaleThresholdDate.mockReturnValue(serviceCutoff);
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(deleteCalls()[0]!.olderThan).toBe(serviceCutoff);
  });

  test("falls back to the wall clock for a cluster that has no lastSeenAt yet", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID }),
    ]);

    await runTick();

    expect(resourceService.getStaleThresholdDate).toHaveBeenCalledWith(
      undefined,
    );
    expect(deleteCalls()[0]!.olderThan.getTime()).toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
  });

  test("a NULL lastSeenAt from the database reaches the helper as undefined, never as null", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: null }),
    ]);

    await runTick();

    const anchor: unknown =
      resourceService.getStaleThresholdDate.mock.calls[0]![0];
    expect(anchor).toBeUndefined();
    expect(anchor).not.toBeNull();
    expect(deleteCalls()[0]!.olderThan.getTime()).toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
  });

  test("computes a fresh cutoff per cluster, so one cluster's anchor never leaks into the next", async () => {
    const seenA: Date = new Date("2026-09-09T09:40:00.000Z");
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: seenA }),
      makeCluster({ id: CLUSTER_B_ID }),
    ]);

    await runTick();

    expect(resourceService.getStaleThresholdDate).toHaveBeenNthCalledWith(
      1,
      seenA,
    );
    expect(resourceService.getStaleThresholdDate).toHaveBeenNthCalledWith(
      2,
      undefined,
    );
    expect(deleteCalls()[1]!.olderThan.getTime()).toBe(
      NOW.getTime() - THRESHOLD_MS,
    );
  });
});

describe("resilience", () => {
  test("one cluster's prune failure is logged and the loop continues to the next", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
      makeCluster({ id: CLUSTER_B_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForCluster.mockImplementation(
      (args: DeleteStaleArgs): Promise<number> => {
        if (args.proxmoxClusterId.toString() === CLUSTER_A_ID.toString()) {
          return Promise.reject(new Error("db connection reset"));
        }
        return Promise.resolve(1);
      },
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(prunedClusterIds()).toEqual([
      CLUSTER_A_ID.toString(),
      CLUSTER_B_ID.toString(),
    ]);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `stale inventory delete failed for cluster ${CLUSTER_A_ID.toString()}`,
      ),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("db connection reset"),
    );
    // The surviving cluster's delete still counts.
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("pruned 1 "),
    );
  });

  test("a failure in the MIDDLE cluster isolates it: the ones before and after are pruned", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
      makeCluster({ id: CLUSTER_B_ID, lastSeenAt: NOW }),
      makeCluster({ id: CLUSTER_C_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForCluster
      .mockResolvedValueOnce(2)
      .mockRejectedValueOnce(new Error("statement timeout"))
      .mockResolvedValueOnce(3);

    await expect(runTick()).resolves.toBeUndefined();

    expect(prunedClusterIds()).toEqual([
      CLUSTER_A_ID.toString(),
      CLUSTER_B_ID.toString(),
      CLUSTER_C_ID.toString(),
    ]);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(CLUSTER_B_ID.toString()),
    );
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("pruned 5 "),
    );
  });

  test("a prune failure on the LAST cluster still lets the earlier deletes count", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
      makeCluster({ id: CLUSTER_B_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForCluster
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new Error("statement timeout"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("pruned 4 "),
    );
  });

  test("a non-Error rejection from a prune is stringified into the log", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForCluster.mockRejectedValue("disk full");

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("disk full"),
    );
  });

  test("a failing connected-cluster scan is logged and never thrown", async () => {
    clusterService.findBy.mockRejectedValue(new Error("postgres down"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(`${JOB_NAME} cron failed`),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("postgres down"),
    );
    expect(resourceService.deleteStaleForCluster).not.toHaveBeenCalled();
  });

  test("a non-Error rejection from the connected-cluster scan is stringified too", async () => {
    clusterService.findBy.mockRejectedValue("connection refused");

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("connection refused"),
    );
  });

  test("a throwing threshold helper is caught by the outer guard and never thrown", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
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
    expect(resourceService.deleteStaleForCluster).not.toHaveBeenCalled();
  });

  test("a failing disconnect sweep AND a failing prune together still never throw", async () => {
    clusterService.markDisconnectedClusters.mockRejectedValue(
      new Error("redis exploded"),
    );
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForCluster.mockRejectedValue(
      new Error("db connection reset"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
  });

  test("everything failing at once still resolves", async () => {
    clusterService.markDisconnectedClusters.mockRejectedValue(
      new Error("redis exploded"),
    );
    clusterService.findBy.mockRejectedValue(new Error("postgres down"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
  });

  test("a tick that fails is isolated — the next tick starts clean", async () => {
    clusterService.findBy.mockRejectedValueOnce(new Error("postgres down"));
    await expect(runTick()).resolves.toBeUndefined();

    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
    ]);
    await expect(runTick()).resolves.toBeUndefined();

    expect(clusterService.markDisconnectedClusters).toHaveBeenCalledTimes(2);
    expect(prunedClusterIds()).toEqual([CLUSTER_A_ID.toString()]);
  });
});

describe("reporting", () => {
  test("logs one debug line with the total pruned across all connected clusters", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
      makeCluster({ id: CLUSTER_B_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForCluster
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      `${JOB_NAME}: pruned 5 stale ProxmoxResource row(s) across 2 cluster(s)`,
    );
  });

  test("stays quiet when nothing was pruned", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
    ]);

    await runTick();

    expect(mockedLogger.debug).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("never logs at info or warn level — a normal sweep is not news", async () => {
    clusterService.findBy.mockResolvedValue([
      makeCluster({ id: CLUSTER_A_ID, lastSeenAt: NOW }),
    ]);
    resourceService.deleteStaleForCluster.mockResolvedValue(10);

    await runTick();

    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });
});

describe("the job source", () => {
  test("documents the native-push exception: the native Node rows are the roster, so deleteStaleForCluster keeps them for the retention window", () => {
    const header: string = readJobHeader();

    expect(header).toContain(
      "Proxmox VE native OpenTelemetry push (isNativePush)",
    );
    expect(header).toContain("the Node rows ARE the cluster's membership");
    expect(header).toContain("ProxmoxResourceService.getNodeRoster");
    expect(header).toContain("ProxmoxResourceService.markNodesNotReporting");
    expect(header).toContain(
      "deleteStaleForCluster keeps a native-push Node row for the retention window whatever its state",
    );
    expect(header).toContain("The keep rule lives in the service, not here");
  });

  test("documents why the keep cannot wait for the Offline mark: a node that died around an outage or a power cut is marked only after the two-minute warm-up", () => {
    const header: string = readJobHeader();

    expect(header).toContain("marked Offline or not yet");
    expect(header).toContain("OneUptime ingest outage");
    expect(header).toContain("the whole cluster lost power");
    expect(header).toContain("two minutes");
    expect(header).toContain("a tick in those two minutes must not drop it");
  });

  test("documents when such a node stops being kept: it returns, the 7-day retention window passes, or a user removes it", () => {
    const header: string = readJobHeader();

    expect(header).toContain("when the node comes back");
    expect(header).toContain("7 days by default");
    expect(header).toContain("PVE_SILENT_NODE_RETENTION_HOURS");
    expect(header).toContain(
      "ProxmoxResourceService.getSilentNodeRetentionHours",
    );
    expect(header).toContain(
      "ProxmoxResourceService.getSilentNodeRetentionCutoff",
    );
    expect(header).toContain("the first connected tick afterwards prunes it");
    expect(header).toContain("when a user removes it");
    expect(header).toContain("ProxmoxResourceService.removeOfflineNode");
  });

  test("documents that switching silent-node detection off switches the keep off too: nothing would mark the node, so it would show Online all week", () => {
    const header: string = readJobHeader();

    expect(header).toContain(
      "None of this holds while silent-node detection is switched off (PVE_NATIVE_NODE_SILENCE_DETECTION=false)",
    );
    expect(header).toContain("nothing marks a silent node Offline then");
    expect(header).toContain(
      "a kept row would show a dead node Online for the whole window",
    );
    expect(header).toContain(
      "deleteStaleForCluster drops the keep and prunes a native-push Node row at the stale cutoff like every other row",
    );
  });

  test("documents that everything else keeps the 15-minute prune: the agent's rows, rows from before the column, every guest and storage row", () => {
    const header: string = readJobHeader();

    expect(header).toContain(
      "Everything else keeps the 15-minute prune, Offline or not",
    );
    expect(header).toContain("isNativePush false");
    expect(header).toContain("before the column existed (NULL)");
    expect(header).toContain("every guest and storage row, native push or not");
  });

  test("still documents why disconnected clusters are skipped and why the cutoff is anchored", () => {
    const header: string = readJobHeader();

    expect(header).toContain("Skipping disconnected clusters is deliberate");
    expect(header).toContain("anchored to each cluster's own lastSeenAt");
    expect(header).toContain("PVE_INVENTORY_STALE_MINUTES");
  });

  test("the code carries no silent-node policy of its own — the keep rule lives in the service", () => {
    const code: string = readJobCode();

    expect(code).toContain("ProxmoxClusterService.markDisconnectedClusters");
    expect(code).toContain("ProxmoxResourceService.getStaleThresholdDate");
    expect(code).toContain("ProxmoxResourceService.deleteStaleForCluster");
    expect(code).not.toMatch(
      /markNodesNotReporting|removeOfflineNode|getSilentNodeRetentionHours|getSilentNodeRetentionCutoff|getNodeRoster/,
    );
    expect(code).not.toMatch(
      /isUp|updatedAt|isNativePush|isProxmoxSilentNodeDetectionEnabled|"Node"|'Node'|PVE_/,
    );
  });

  test("never mentions VMware concepts — this is the Proxmox sweeper", () => {
    expect(readJobSource()).not.toMatch(/VMware|vCenter|VMWARE_/);
  });
});

/*
 * ------------------------------------------------------------------
 * Timeline: a Proxmox VE native-push cluster, replayed through the
 * real handler.
 *
 * Each processed push is ingested in turn, as OtelMetricsIngestService
 * does it:
 *   - appendProxmoxSilentNodeReports (native push only, and only while
 *     the REAL isProxmoxSilentNodeDetectionEnabled says so — switched off,
 *     it returns before recording anything): the node's
 *     liveness key is advanced with the REAL nextProxmoxNodeLiveness and
 *     stored as GlobalCache.setString would store it (serialized,
 *     expiring PROXMOX_NODE_SILENCE_MS after the write), then the REAL
 *     decideProxmoxSilentNodes picks the siblings to report, from the
 *     roster (getNodeRoster: the Node rows seen within the retention
 *     window) and the keys that have not expired. So who reports is the
 *     module's own rule: every live node, once some node is established
 *     — pushing for two minutes with its streak unbroken now, its last
 *     push at most PROXMOX_NODE_STREAK_GAP_MS old;
 *   - the flush: bulkUpsert refreshes the node's own rows (lastSeenAt,
 *     updatedAt, isUp = true, isNativePush = whether the batch came from
 *     the native push) and re-creates any that were pruned; the cluster
 *     heartbeat is refreshed at most once per 5-minute maintenance fence
 *     while anything pushes, and a push reconnects a disconnected
 *     cluster; then the reported nodes turn Offline —
 *     markNodesNotReporting's UPDATE: isUp = false, isNativePush = true
 *     (a node the native pushes report belongs to a native-push cluster,
 *     whoever wrote its row last) and updatedAt, never lastSeenAt, only on
 *     a row last seen before the report's own time minus the silence
 *     window and not already both Offline and native — isUp IS DISTINCT
 *     FROM false OR isNativePush IS DISTINCT FROM true (so the ingest's
 *     30-second mark fence changes nothing here);
 *   - markDisconnectedClusters: connected and not seen for 15 minutes;
 *   - deleteStaleForCluster: lastSeenAt < cutoff, except — while
 *     silent-node detection is on — a Node with isNativePush IS TRUE and
 *     lastSeenAt within the retention window
 *     (getSilentNodeRetentionCutoff, on the service's clock — the cron
 *     passes no `now`); switched off, the plain lastSeenAt < cutoff.
 * One clock (the PVE clocks and OneUptime's agree here), 30-second steps
 * unless a test asks for finer ones, the cron on every 5-minute boundary.
 * A OneUptime ingest outage is a stretch in which nothing is processed:
 * pushing [], exactly as for a cluster gone dark. On the agent
 * (nativePush false) "pushing" is the nodes pve-exporter still lists as
 * up and "listedDown" the ones it still lists as down, and nobody
 * reports anybody: pve-exporter already speaks for every node.
 * ------------------------------------------------------------------
 */

const SECOND_MS: number = 1000;
const STEP_MS: number = 30 * SECOND_MS;
const TICK_MS: number = 5 * MINUTE_MS;
const HEARTBEAT_FENCE_MS: number = 5 * MINUTE_MS;
const DISCONNECT_AFTER_MS: number = 15 * MINUTE_MS;
const SILENCE_MS: number = PROXMOX_NODE_SILENCE_MS;
const RETENTION_MS: number = 7 * 24 * 60 * MINUTE_MS;
// GlobalCache.setString's expiry for a liveness key.
const LIVENESS_KEY_TTL_MS: number = Math.ceil(SILENCE_MS / 1000) * 1000;

/*
 * A node that dies at NOW is still alive for SILENCE_MS; the first step
 * after that is the first report, the one that marks it Offline.
 */
const FIRST_REPORT_MS: number = NOW.getTime() + SILENCE_MS + STEP_MS;

interface WorldRowTemplate {
  kind: string; // Node | Guest | Storage
  externalId: string;
  nodeName: string; // the node whose own push carries this row
}

interface WorldRow extends WorldRowTemplate {
  isUp: boolean | null;
  lastSeenAt: Date;
  updatedAt: Date;
  /*
   * Where the batch that wrote the row last came from: the native push
   * (true) or the agent (false); NULL from before the column existed.
   */
  isNativePush: boolean | null;
}

// A node's liveness key in Redis, on OneUptime's receive clock.
interface WorldLivenessKey {
  value: string; // serializeProxmoxNodeLiveness
  expiresAtMs: number;
}

interface World {
  clockMs: number;
  clusterId: ObjectID;
  clusterStatus: string;
  clusterLastSeenAt: Date;
  // What getStaleThresholdDate subtracts (PVE_INVENTORY_STALE_MINUTES).
  staleThresholdMs: number;
  // Where the batches come from: the Proxmox VE native push, or the agent.
  nativePush: boolean;
  catalog: Array<WorldRowTemplate>;
  rows: Array<WorldRow>;
  livenessKeys: Map<string, WorldLivenessKey>;
  // The clock of every moment at which a live node reported a silent one.
  reportedAtMs: Array<number>;
  // externalId -> clock of every tick that deleted it
  prunedAtMs: Map<string, Array<number>>;
}

interface TickRecord {
  atMs: number;
  clusterStatus: string;
  present: Set<string>;
  // The Node rows that were Offline (isUp = false) when the tick ran.
  offline: Set<string>;
  pruned: boolean;
  // The cutoff this tick handed to deleteStaleForCluster, if it pruned.
  cutoffMs: number | null;
}

const CATALOG: Array<WorldRowTemplate> = [
  { kind: "Node", externalId: "node/pve1", nodeName: "pve1" },
  { kind: "Node", externalId: "node/pve2", nodeName: "pve2" },
  { kind: "Node", externalId: "node/pve3", nodeName: "pve3" },
  { kind: "Guest", externalId: "qemu/101", nodeName: "pve1" },
  { kind: "Guest", externalId: "lxc/102", nodeName: "pve2" },
  { kind: "Guest", externalId: "qemu/103", nodeName: "pve3" },
  { kind: "Storage", externalId: "storage/pve3/local", nodeName: "pve3" },
];

const ALL_NODES: Array<string> = ["pve1", "pve2", "pve3"];
const SURVIVORS: Array<string> = ["pve1", "pve2"];
const SURVIVOR_ROWS: Array<string> = [
  "node/pve1",
  "node/pve2",
  "qemu/101",
  "lxc/102",
];
// What only pve3's own push carries besides its Node row.
const PVE3_GUEST_AND_STORAGE: Array<string> = [
  "qemu/103",
  "storage/pve3/local",
];

// GlobalCache.setString with the liveness key's expiry.
function writeLiveness(
  world: World,
  nodeName: string,
  liveness: ProxmoxNodeLiveness,
): void {
  world.livenessKeys.set(nodeName, {
    value: serializeProxmoxNodeLiveness(liveness),
    expiresAtMs: world.clockMs + LIVENESS_KEY_TTL_MS,
  });
}

// GlobalCache.getString(s): a key past its expiry is gone.
function readLiveness(
  world: World,
  nodeName: string,
  atMs?: number | undefined,
): ProxmoxNodeLiveness | null {
  const key: WorldLivenessKey | undefined = world.livenessKeys.get(nodeName);
  if (!key || (atMs ?? world.clockMs) > key.expiresAtMs) {
    return null;
  }
  return parseProxmoxNodeLiveness(key.value);
}

function createWorld(options?: {
  staleThresholdMs?: number | undefined;
  // How long before NOW the cluster heartbeat was last written.
  heartbeatAgeMs?: number | undefined;
  // false: the batches come from the Proxmox Agent (pve-exporter).
  nativePush?: boolean | undefined;
  // The rows' isNativePush when the timeline starts; the source's by default.
  rowsNativePush?: boolean | null | undefined;
}): World {
  const nativePush: boolean = options?.nativePush !== false;
  const rowsNativePush: boolean | null =
    options?.rowsNativePush !== undefined ? options.rowsNativePush : nativePush;
  const world: World = {
    clockMs: NOW.getTime(),
    clusterId: CLUSTER_A_ID,
    clusterStatus: "connected",
    clusterLastSeenAt: new Date(NOW.getTime() - (options?.heartbeatAgeMs || 0)),
    staleThresholdMs: options?.staleThresholdMs || THRESHOLD_MS,
    nativePush,
    catalog: CATALOG,
    rows: CATALOG.map((template: WorldRowTemplate): WorldRow => {
      return {
        ...template,
        isUp: true,
        lastSeenAt: new Date(NOW),
        updatedAt: new Date(NOW),
        isNativePush: rowsNativePush,
      };
    }),
    livenessKeys: new Map<string, WorldLivenessKey>(),
    reportedAtMs: [],
    prunedAtMs: new Map<string, Array<number>>(),
  };
  if (nativePush) {
    // Every node has pushed for an hour up to NOW: all established.
    for (const nodeName of ALL_NODES) {
      writeLiveness(world, nodeName, {
        streakStartMs: NOW.getTime() - 60 * MINUTE_MS,
        lastPushMs: NOW.getTime(),
      });
    }
  }
  return world;
}

function rowOf(world: World, externalId: string): WorldRow | undefined {
  return world.rows.find((row: WorldRow): boolean => {
    return row.externalId === externalId;
  });
}

// Point the mocked services at the model.
function installWorld(world: World): void {
  clusterService.markDisconnectedClusters.mockImplementation(
    (): Promise<void> => {
      if (
        world.clusterStatus === "connected" &&
        world.clusterLastSeenAt.getTime() < world.clockMs - DISCONNECT_AFTER_MS
      ) {
        world.clusterStatus = "disconnected";
      }
      return Promise.resolve();
    },
  );

  clusterService.findBy.mockImplementation(
    (args: FindByArgs): Promise<Array<ProxmoxCluster>> => {
      if (args.query["otelCollectorStatus"] !== world.clusterStatus) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        makeCluster({
          id: world.clusterId,
          lastSeenAt: new Date(world.clusterLastSeenAt),
        }),
      ]);
    },
  );

  resourceService.getStaleThresholdDate.mockImplementation(
    (anchor?: Date): Date => {
      return new Date(
        (anchor ? anchor.getTime() : world.clockMs) - world.staleThresholdMs,
      );
    },
  );

  resourceService.deleteStaleForCluster.mockImplementation(
    (args: DeleteStaleArgs): Promise<number> => {
      if (args.proxmoxClusterId.toString() !== world.clusterId.toString()) {
        return Promise.resolve(0);
      }
      const cutoffMs: number = args.olderThan.getTime();
      /*
       * Switched off, the service runs the plain statement
       * ("lastSeenAt" < $2) and never computes a retention cutoff.
       */
      const keepsNativeNodes: boolean = isProxmoxSilentNodeDetectionEnabled();
      // getSilentNodeRetentionCutoff: `now` (the wall clock) minus the window.
      const retentionCutoffMs: number =
        (args.now ? args.now.getTime() : world.clockMs) - RETENTION_MS;
      const kept: Array<WorldRow> = [];
      let deleted: number = 0;
      for (const row of world.rows) {
        // AND NOT ("kind" = 'Node' AND "isNativePush" IS TRUE AND "lastSeenAt" >= $3)
        const keptAsNativeNode: boolean =
          keepsNativeNodes &&
          row.kind === "Node" &&
          row.isNativePush === true &&
          row.lastSeenAt.getTime() >= retentionCutoffMs;
        if (row.lastSeenAt.getTime() < cutoffMs && !keptAsNativeNode) {
          const history: Array<number> =
            world.prunedAtMs.get(row.externalId) || [];
          history.push(world.clockMs);
          world.prunedAtMs.set(row.externalId, history);
          deleted++;
        } else {
          kept.push(row);
        }
      }
      world.rows = kept;
      return Promise.resolve(deleted);
    },
  );
}

// getNodeRoster: the Node rows seen within the retention window.
function nodeRoster(world: World): Array<ProxmoxRosterNode> {
  const seenSinceMs: number = world.clockMs - RETENTION_MS;
  return world.rows
    .filter((row: WorldRow): boolean => {
      return row.kind === "Node" && row.lastSeenAt.getTime() >= seenSinceMs;
    })
    .map((row: WorldRow): ProxmoxRosterNode => {
      return { nodeName: row.nodeName, lastSeenAt: new Date(row.lastSeenAt) };
    });
}

/*
 * recordProxmoxNodePushAndFindSilentNodes, on the model's key store:
 * advance this node's key, then decide with the real rule.
 */
function recordPushAndFindSilentNodes(
  world: World,
  selfNode: string,
): ProxmoxSilentNodeDecision | null {
  const current: ProxmoxNodeLiveness = nextProxmoxNodeLiveness(
    readLiveness(world, selfNode),
    world.clockMs,
  );
  writeLiveness(world, selfNode, current);

  const roster: Array<ProxmoxRosterNode> = nodeRoster(world);
  const liveness: Map<string, ProxmoxNodeLiveness | null> = new Map<
    string,
    ProxmoxNodeLiveness | null
  >();
  liveness.set(selfNode, current);
  for (const node of roster) {
    if (node.nodeName !== selfNode) {
      liveness.set(node.nodeName, readLiveness(world, node.nodeName));
    }
  }
  return decideProxmoxSilentNodes({
    selfNode,
    reporterTimeMs: world.clockMs,
    nowMs: world.clockMs,
    roster,
    liveness,
  });
}

/*
 * bulkUpsert of the node's own rows, plus the cluster heartbeat. isUp is
 * what the batch says: always up for a native push (a node that is down
 * pushes nothing), down for a node pve-exporter still lists as down.
 */
function upsertOwnRows(world: World, nodeName: string, isUp: boolean): void {
  const now: Date = new Date(world.clockMs);
  for (const template of world.catalog) {
    if (template.nodeName !== nodeName) {
      continue;
    }
    let row: WorldRow | undefined = rowOf(world, template.externalId);
    if (!row) {
      row = {
        ...template,
        isUp: null,
        lastSeenAt: now,
        updatedAt: now,
        isNativePush: null,
      };
      world.rows.push(row);
    }
    row.isUp = isUp;
    row.lastSeenAt = now;
    row.updatedAt = now;
    row.isNativePush = world.nativePush;
  }

  if (world.clusterStatus !== "connected") {
    world.clusterStatus = "connected";
    world.clusterLastSeenAt = now;
  } else if (
    world.clockMs - world.clusterLastSeenAt.getTime() >=
    HEARTBEAT_FENCE_MS
  ) {
    world.clusterLastSeenAt = now;
  }
}

/*
 * markNodesNotReporting's UPDATE: SET isUp = false, isNativePush = true,
 * updatedAt — never lastSeenAt — WHERE "lastSeenAt" < $4 AND ("isUp" IS
 * DISTINCT FROM false OR "isNativePush" IS DISTINCT FROM true).
 */
function markNodesNotReporting(
  world: World,
  nodeNames: Array<string>,
  silentBeforeMs: number,
): void {
  for (const row of world.rows) {
    if (
      row.kind === "Node" &&
      nodeNames.includes(row.nodeName) &&
      row.lastSeenAt.getTime() < silentBeforeMs &&
      (row.isUp !== false || row.isNativePush !== true)
    ) {
      row.isUp = false;
      row.isNativePush = true;
      row.updatedAt = new Date(world.clockMs);
    }
  }
}

/*
 * One node's push, from the scan to the flush. Only a native push with
 * silent-node detection on records liveness and may report siblings.
 */
function ingestPush(world: World, nodeName: string): void {
  const decision: ProxmoxSilentNodeDecision | null =
    world.nativePush && isProxmoxSilentNodeDetectionEnabled()
      ? recordPushAndFindSilentNodes(world, nodeName)
      : null;
  upsertOwnRows(world, nodeName, true);
  if (!decision) {
    return;
  }
  if (world.reportedAtMs[world.reportedAtMs.length - 1] !== world.clockMs) {
    world.reportedAtMs.push(world.clockMs);
  }
  markNodesNotReporting(
    world,
    decision.silentNodes,
    world.clockMs - SILENCE_MS,
  );
}

async function runModelTick(world: World): Promise<TickRecord> {
  const deletesBefore: number =
    resourceService.deleteStaleForCluster.mock.calls.length;
  await runTick();
  const calls: Array<DeleteStaleArgs> = deleteCalls();
  const pruned: boolean = calls.length > deletesBefore;
  return {
    atMs: world.clockMs,
    clusterStatus: world.clusterStatus,
    present: new Set<string>(
      world.rows.map((row: WorldRow): string => {
        return row.externalId;
      }),
    ),
    offline: new Set<string>(
      world.rows
        .filter((row: WorldRow): boolean => {
          return row.kind === "Node" && row.isUp === false;
        })
        .map((row: WorldRow): string => {
          return row.externalId;
        }),
    ),
    pruned,
    cutoffMs: pruned ? calls[calls.length - 1]!.olderThan.getTime() : null,
  };
}

/*
 * Moves the clock step by step. At each step every node in `pushing`
 * pushes, processed in the order given, and then — on the agent only —
 * pve-exporter lists every node in `listedDown` as down; the cron ticks
 * on every 5-minute boundary — after that step's pushes when a step lands
 * on it, at its own time when it falls between two steps.
 */
async function advance(
  world: World,
  data: {
    durationMs: number;
    pushing: Array<string>;
    listedDown?: Array<string> | undefined;
    stepMs?: number | undefined;
  },
): Promise<Array<TickRecord>> {
  const listedDown: Array<string> = data.listedDown || [];
  if (listedDown.length > 0 && world.nativePush) {
    // A node that is down pushes nothing: only the agent lists it.
    throw new Error("Only the agent lists a node as down.");
  }
  const stepMs: number = data.stepMs || STEP_MS;
  const endMs: number = world.clockMs + data.durationMs;
  const ticks: Array<TickRecord> = [];
  while (world.clockMs < endMs) {
    const stepAtMs: number = Math.min(world.clockMs + stepMs, endMs);
    let tickAtMs: number = (Math.floor(world.clockMs / TICK_MS) + 1) * TICK_MS;
    while (tickAtMs < stepAtMs) {
      world.clockMs = tickAtMs;
      ticks.push(await runModelTick(world));
      tickAtMs += TICK_MS;
    }
    world.clockMs = stepAtMs;
    for (const nodeName of data.pushing) {
      ingestPush(world, nodeName);
    }
    for (const nodeName of listedDown) {
      upsertOwnRows(world, nodeName, false);
    }
    if (world.clockMs % TICK_MS === 0) {
      ticks.push(await runModelTick(world));
    }
  }
  return ticks;
}

function ticksWhere(
  ticks: Array<TickRecord>,
  externalId: string,
  present: boolean,
): Array<number> {
  return ticks
    .filter((tick: TickRecord): boolean => {
      return tick.present.has(externalId) === present;
    })
    .map((tick: TickRecord): number => {
      return tick.atMs;
    });
}

function reportsAfter(world: World, afterMs: number): Array<number> {
  return world.reportedAtMs.filter((atMs: number): boolean => {
    return atMs > afterMs;
  });
}

describe("timeline: a native-push node that dies while its siblings keep pushing", () => {
  test("the model starts on a cron boundary, so ticks land every five minutes", () => {
    expect(NOW.getTime() % TICK_MS).toBe(0);
  });

  test("the model runs on the liveness module's own windows: silent after 2 minutes, a streak broken by a 1-minute gap", () => {
    // The step arithmetic below (FIRST_REPORT_MS, the warm-ups) rests on these.
    expect(PROXMOX_NODE_SILENCE_MS).toBe(2 * MINUTE_MS);
    expect(PROXMOX_NODE_STREAK_GAP_MS).toBe(MINUTE_MS);
    expect(SILENCE_MS % STEP_MS).toBe(0);
  });

  test("its Node row survives every tick as Offline, marked once, while its lastSeenAt never moves", async () => {
    const world: World = createWorld();
    installWorld(world);

    // pve3 dies at NOW; pve1 and pve2 push on for two hours.
    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 2 * 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    expect(ticks).toHaveLength(24);
    // The cluster stayed connected, so every tick pruned it.
    for (const tick of ticks) {
      expect(tick.clusterStatus).toBe("connected");
      expect(tick.pruned).toBe(true);
    }
    expect(ticksWhere(ticks, "node/pve3", false)).toEqual([]);
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);

    const pve3: WorldRow | undefined = rowOf(world, "node/pve3");
    expect(pve3).toBeDefined();
    expect(pve3!.isUp).toBe(false);
    expect(pve3!.isNativePush).toBe(true);
    expect(pve3!.lastSeenAt.getTime()).toBe(NOW.getTime());
    /*
     * Written once, by the first report: the UPDATE skips a row already
     * Offline and native, and the keep never needed the row rewritten.
     */
    expect(pve3!.updatedAt.getTime()).toBe(FIRST_REPORT_MS);
    expect(world.reportedAtMs[0]).toBe(FIRST_REPORT_MS);
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      world.clockMs,
    );
    // Offline on every tick from the first report on.
    for (const tick of ticks) {
      expect(tick.offline.has("node/pve3")).toBe(tick.atMs >= FIRST_REPORT_MS);
    }

    // The live nodes and their guests are untouched.
    for (const externalId of SURVIVOR_ROWS) {
      expect(ticksWhere(ticks, externalId, false)).toEqual([]);
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isUp).toBe(true);
    }
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("only the Node row is kept: the dead node's guests and storage age out like any other row, though the native push wrote them too", async () => {
    const world: World = createWorld();
    installWorld(world);
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      expect(rowOf(world, externalId)!.isNativePush).toBe(true);
    }

    await advance(world, {
      durationMs: 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      const prunedAt: Array<number> | undefined =
        world.prunedAtMs.get(externalId);
      expect(prunedAt).toHaveLength(1);
      // Not before the stale threshold, and within a threshold plus a fence and a tick.
      expect(prunedAt![0]!).toBeGreaterThan(NOW.getTime() + THRESHOLD_MS);
      expect(prunedAt![0]!).toBeLessThanOrEqual(
        NOW.getTime() + THRESHOLD_MS + HEARTBEAT_FENCE_MS + TICK_MS,
      );
    }
    expect(rowOf(world, "node/pve3")).toBeDefined();
  });

  test("when the node comes back its own push makes the row live again — it was never deleted", async () => {
    const world: World = createWorld();
    installWorld(world);

    await advance(world, { durationMs: 60 * MINUTE_MS, pushing: SURVIVORS });
    expect(rowOf(world, "node/pve3")!.isUp).toBe(false);
    const backAtMs: number = world.clockMs + STEP_MS;

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 60 * MINUTE_MS,
      pushing: ALL_NODES,
    });

    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(true);
    expect(pve3.isNativePush).toBe(true);
    expect(pve3.lastSeenAt.getTime()).toBe(world.clockMs);
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    /*
     * Nobody reports it once its own push is in. (The pushes of pve1 and
     * pve2 processed just ahead of its first one, in the same step, still
     * may: each push is handled in turn.)
     */
    expect(reportsAfter(world, backAtMs)).toEqual([]);
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]!).toBe(backAtMs);
    // Its guests come back with it and stay.
    expect(rowOf(world, "qemu/103")).toBeDefined();
    for (const tick of ticks) {
      expect(tick.present.size).toBe(CATALOG.length);
      expect(tick.offline.size).toBe(0);
    }
  });

  test("the node is kept for the whole 7-day retention window, then goes on the first tick past it — when its siblings stop reporting it", async () => {
    const world: World = createWorld();
    installWorld(world);

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: RETENTION_MS + 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    const retentionEndMs: number = NOW.getTime() + RETENTION_MS;
    const present: Array<number> = ticksWhere(ticks, "node/pve3", true);
    const missing: Array<number> = ticksWhere(ticks, "node/pve3", false);

    // Present on every tick of the retention window, its last one included...
    expect(present).toHaveLength(RETENTION_MS / TICK_MS);
    expect(present[present.length - 1]).toBe(retentionEndMs);

    // ...reported up to that moment and no longer (it is off the roster)...
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      retentionEndMs,
    );

    /*
     * ...and gone on the very next tick, for good: the keep ends with the
     * window itself, not a stale threshold after the last report.
     */
    expect(missing[0]).toBe(retentionEndMs + TICK_MS);
    expect(missing).toHaveLength(ticks.length - present.length);
    expect(world.prunedAtMs.get("node/pve3")).toEqual([
      retentionEndMs + TICK_MS,
    ]);

    // The live nodes were never touched in the whole week.
    expect(world.prunedAtMs.has("node/pve1")).toBe(false);
    expect(world.prunedAtMs.has("node/pve2")).toBe(false);
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("even at the 5-minute floor of PVE_INVENTORY_STALE_MINUTES, with the heartbeat at its stalest, the dead node survives every tick", async () => {
    /*
     * The tightest cutoff the service allows, and a cluster heartbeat
     * written 30 s after each tick, so every tick anchors on a lastSeenAt
     * that is 4.5 minutes old: the cutoff sits 9.5 minutes back, past
     * the node's own last push and its one mark within the first
     * quarter hour — the keep rests on isNativePush and the retention
     * window alone.
     */
    const minimumThresholdMs: number = 5 * MINUTE_MS;
    const world: World = createWorld({
      staleThresholdMs: minimumThresholdMs,
      heartbeatAgeMs: HEARTBEAT_FENCE_MS - STEP_MS,
    });
    installWorld(world);

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 2 * 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    // One prune per tick, each cutoff 4.5 + 5 minutes behind its tick.
    const calls: Array<DeleteStaleArgs> = deleteCalls();
    expect(calls).toHaveLength(ticks.length);
    calls.forEach((call: DeleteStaleArgs, index: number): void => {
      expect(call.olderThan.getTime()).toBe(
        ticks[index]!.atMs -
          (HEARTBEAT_FENCE_MS - STEP_MS) -
          minimumThresholdMs,
      );
    });
    expect(ticksWhere(ticks, "node/pve3", false)).toEqual([]);
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    // The last cutoff lies an hour and more past that one mark.
    expect(pve3.updatedAt.getTime()).toBe(FIRST_REPORT_MS);
    expect(calls[calls.length - 1]!.olderThan.getTime()).toBeGreaterThan(
      FIRST_REPORT_MS + 60 * MINUTE_MS,
    );
    // The live nodes' rows ride the push, far inside any cutoff.
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
    }
    // The dead node's guest still goes, sooner under the tighter threshold.
    expect(world.prunedAtMs.get("qemu/103")).toHaveLength(1);
  });

  test("a Node row already Offline and native is left alone by the reports and kept all the same", async () => {
    /*
     * pve3 died ten minutes before NOW and was marked then (say, before
     * a worker restart): its key is gone and its row Offline and native.
     */
    const world: World = createWorld();
    const diedAtMs: number = NOW.getTime() - 10 * MINUTE_MS;
    const markedAtMs: number = diedAtMs + SILENCE_MS + STEP_MS;
    world.livenessKeys.delete("pve3");
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    pve3.isUp = false;
    pve3.lastSeenAt = new Date(diedAtMs);
    pve3.updatedAt = new Date(markedAtMs);
    expect(pve3.isNativePush).toBe(true);
    installWorld(world);

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 2 * 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    // Reported on every step, yet the UPDATE never writes the row again.
    expect(world.reportedAtMs[0]).toBe(NOW.getTime() + STEP_MS);
    expect(world.reportedAtMs).toHaveLength((2 * 60 * MINUTE_MS) / STEP_MS);
    expect(pve3.isUp).toBe(false);
    expect(pve3.isNativePush).toBe(true);
    expect(pve3.updatedAt.getTime()).toBe(markedAtMs);
    expect(pve3.lastSeenAt.getTime()).toBe(diedAtMs);
    expect(ticksWhere(ticks, "node/pve3", false)).toEqual([]);
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
  });

  test("a Node row marked Offline before isNativePush existed (NULL) is written once more by its first report — made native — and kept, while its guests seen at the same moment go on the normal cutoff", async () => {
    /*
     * As above, but pve3 was marked before the column existed: every row
     * reads NULL. pve1's and pve2's own pushes make theirs native; nothing
     * but a report can make pve3's, and it is already Offline.
     */
    const world: World = createWorld({ rowsNativePush: null });
    const diedAtMs: number = NOW.getTime() - 10 * MINUTE_MS;
    const markedAtMs: number = diedAtMs + SILENCE_MS + STEP_MS;
    world.livenessKeys.delete("pve3");
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    pve3.isUp = false;
    pve3.lastSeenAt = new Date(diedAtMs);
    pve3.updatedAt = new Date(markedAtMs);
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      rowOf(world, externalId)!.lastSeenAt = new Date(diedAtMs);
    }
    installWorld(world);

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 2 * 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    const firstReportMs: number = NOW.getTime() + STEP_MS;

    // The first report writes it — isNativePush was not true — and no later one does.
    expect(world.reportedAtMs[0]).toBe(firstReportMs);
    expect(world.reportedAtMs).toHaveLength((2 * 60 * MINUTE_MS) / STEP_MS);
    expect(pve3.isUp).toBe(false);
    expect(pve3.isNativePush).toBe(true);
    expect(pve3.updatedAt.getTime()).toBe(firstReportMs);
    expect(pve3.lastSeenAt.getTime()).toBe(diedAtMs);

    /*
     * Its guest and storage, NULL and last seen at the same moment, go on
     * the first tick whose cutoff passes that moment — where the Node row
     * would have gone too, had the report left it NULL.
     */
    const firstPastCutoff: TickRecord | undefined = ticks.find(
      (tick: TickRecord): boolean => {
        return tick.cutoffMs !== null && tick.cutoffMs > diedAtMs;
      },
    );
    expect(firstPastCutoff).toBeDefined();
    expect(firstPastCutoff!.atMs).toBeGreaterThan(firstReportMs);
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      expect(world.prunedAtMs.get(externalId)).toEqual([firstPastCutoff!.atMs]);
    }
    expect(firstPastCutoff!.present.has("node/pve3")).toBe(true);

    // Kept, Offline, on every tick.
    expect(ticksWhere(ticks, "node/pve3", false)).toEqual([]);
    for (const tick of ticks) {
      expect(tick.offline.has("node/pve3")).toBe(true);
    }
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isNativePush).toBe(true);
    }
  });

  test("a native-push node that drops off the roster (seen before the retention window) goes on the very next tick", async () => {
    const world: World = createWorld();
    installWorld(world);

    // Reported Offline for a while...
    await advance(world, { durationMs: 30 * MINUTE_MS, pushing: SURVIVORS });
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    const lastReportMs: number =
      world.reportedAtMs[world.reportedAtMs.length - 1]!;
    expect(lastReportMs).toBe(world.clockMs);

    /*
     * ...then its last sighting falls out of the retention window: model
     * it by moving lastSeenAt back past the window.
     */
    pve3.lastSeenAt = new Date(world.clockMs - RETENTION_MS - MINUTE_MS);

    await advance(world, { durationMs: 30 * MINUTE_MS, pushing: SURVIVORS });

    /*
     * Gone on the first tick, though it was reported a step before:
     * isNativePush keeps a row only within the window.
     */
    expect(world.prunedAtMs.get("node/pve3")).toEqual([lastReportMs + TICK_MS]);
    expect(reportsAfter(world, lastReportMs)).toEqual([]);
  });
});

describe("timeline: the Proxmox Agent keeps the 15-minute prune", () => {
  test("a Node row pve-exporter stops refreshing goes with its guests, Offline or not, and nobody reports it", async () => {
    /*
     * pve3 left the cluster: pve-exporter, which asks the cluster about
     * every node, lists only pve1 and pve2 from NOW on. Its last scrape
     * already said it was down.
     */
    const world: World = createWorld({ nativePush: false });
    rowOf(world, "node/pve3")!.isUp = false;
    installWorld(world);

    await advance(world, { durationMs: 60 * MINUTE_MS, pushing: SURVIVORS });

    expect(world.reportedAtMs).toEqual([]);
    const prunedAt: Array<number> | undefined =
      world.prunedAtMs.get("node/pve3");
    expect(prunedAt).toHaveLength(1);
    expect(prunedAt![0]!).toBeGreaterThan(NOW.getTime() + THRESHOLD_MS);
    expect(prunedAt![0]!).toBeLessThanOrEqual(
      NOW.getTime() + THRESHOLD_MS + HEARTBEAT_FENCE_MS + TICK_MS,
    );
    // The same tick as its guest, seen at the same moment.
    expect(prunedAt).toEqual(world.prunedAtMs.get("qemu/103"));
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isNativePush).toBe(false);
    }
  });

  test("so does a Node row untouched since before isNativePush existed (NULL)", async () => {
    const world: World = createWorld({
      nativePush: false,
      rowsNativePush: null,
    });
    installWorld(world);

    await advance(world, { durationMs: 60 * MINUTE_MS, pushing: SURVIVORS });

    // The rows the agent still refreshes are its own now...
    for (const externalId of SURVIVOR_ROWS) {
      expect(rowOf(world, externalId)!.isNativePush).toBe(false);
    }
    // ...and the one it no longer lists ages out on the normal cutoff.
    const prunedAt: Array<number> | undefined =
      world.prunedAtMs.get("node/pve3");
    expect(prunedAt).toHaveLength(1);
    expect(prunedAt![0]!).toBeLessThanOrEqual(
      NOW.getTime() + THRESHOLD_MS + HEARTBEAT_FENCE_MS + TICK_MS,
    );
    expect(prunedAt).toEqual(world.prunedAtMs.get("qemu/103"));
  });

  test("a cluster moved from the agent to the native push follows it: a node that dies after the move is kept and reported", async () => {
    const world: World = createWorld({ nativePush: false });
    installWorld(world);
    await advance(world, { durationMs: 10 * MINUTE_MS, pushing: ALL_NODES });
    expect(rowOf(world, "node/pve3")!.isNativePush).toBe(false);

    // The metric server replaces the agent; every node pushes natively.
    world.nativePush = true;
    await advance(world, { durationMs: 10 * MINUTE_MS, pushing: ALL_NODES });
    const movedAtMs: number = world.clockMs;
    for (const template of CATALOG) {
      expect(rowOf(world, template.externalId)!.isNativePush).toBe(true);
    }
    expect(world.reportedAtMs).toEqual([]);

    // pve3 dies.
    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    expect(world.reportedAtMs[0]).toBe(movedAtMs + SILENCE_MS + STEP_MS);
    expect(ticksWhere(ticks, "node/pve3", false)).toEqual([]);
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    expect(rowOf(world, "node/pve3")!.isUp).toBe(false);
    // Its guest is not kept, native push or not.
    expect(world.prunedAtMs.get("qemu/103")).toHaveLength(1);
  });

  test("a node already Offline under the agent when the cluster moves to the native push is reported, marked native, kept, and pruned only after the retention window", async () => {
    /*
     * pve3 is down but still a member: pve-exporter, which asks the
     * cluster about every node, keeps listing it — as down.
     */
    const world: World = createWorld({ nativePush: false });
    for (const row of world.rows) {
      if (row.nodeName === "pve3") {
        row.isUp = false;
      }
    }
    installWorld(world);

    const agentTicks: Array<TickRecord> = await advance(world, {
      durationMs: 30 * MINUTE_MS,
      pushing: SURVIVORS,
      listedDown: ["pve3"],
    });

    // Under the agent it is kept by its own scrapes, Offline, and nobody reports it.
    expect(world.reportedAtMs).toEqual([]);
    for (const tick of agentTicks) {
      expect(tick.present.size).toBe(CATALOG.length);
      expect(tick.offline.has("node/pve3")).toBe(true);
    }
    const lastScrapeMs: number = world.clockMs;
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    expect(pve3.isNativePush).toBe(false);
    expect(pve3.lastSeenAt.getTime()).toBe(lastScrapeMs);

    /*
     * The metric server replaces the agent: pve1 and pve2 push natively
     * from the next step on; pve3, down, pushes nothing, and nothing
     * lists it any more.
     */
    world.nativePush = true;
    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: RETENTION_MS + 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    const firstReportMs: number = lastScrapeMs + STEP_MS + SILENCE_MS;
    const retentionEndMs: number = lastScrapeMs + RETENTION_MS;

    // Reported once pve1 is established; that first report marks it native.
    expect(world.reportedAtMs[0]).toBe(firstReportMs);
    expect(pve3.isUp).toBe(false);
    expect(pve3.isNativePush).toBe(true);
    // Written by that report alone; its lastSeenAt is still the agent's last scrape.
    expect(pve3.updatedAt.getTime()).toBe(firstReportMs);
    expect(pve3.lastSeenAt.getTime()).toBe(lastScrapeMs);

    /*
     * The mark lands before the first tick whose cutoff passes that last
     * scrape. That tick takes pve3's guest and storage — agent rows
     * scraped at the same moment — and would have taken its Node row too,
     * left isNativePush false, dropping it off the roster while down.
     */
    const firstPastCutoff: TickRecord | undefined = ticks.find(
      (tick: TickRecord): boolean => {
        return tick.cutoffMs !== null && tick.cutoffMs > lastScrapeMs;
      },
    );
    expect(firstPastCutoff).toBeDefined();
    expect(firstPastCutoff!.atMs).toBeGreaterThan(firstReportMs);
    expect(firstPastCutoff!.atMs).toBeLessThanOrEqual(
      lastScrapeMs + THRESHOLD_MS + HEARTBEAT_FENCE_MS + TICK_MS,
    );
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      expect(world.prunedAtMs.get(externalId)).toEqual([firstPastCutoff!.atMs]);
    }
    expect(firstPastCutoff!.present.has("node/pve3")).toBe(true);

    // Kept, and Offline, on every tick of the retention window counted from that scrape...
    const present: Array<number> = ticksWhere(ticks, "node/pve3", true);
    expect(present).toHaveLength(RETENTION_MS / TICK_MS);
    expect(present[present.length - 1]).toBe(retentionEndMs);
    for (const tick of ticks) {
      if (tick.present.has("node/pve3")) {
        expect(tick.offline.has("node/pve3")).toBe(true);
      }
    }
    // ...reported to its end and no longer...
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      retentionEndMs,
    );
    expect(reportsAfter(world, retentionEndMs)).toEqual([]);
    // ...and gone on the first tick past it, for good.
    expect(world.prunedAtMs.get("node/pve3")).toEqual([
      retentionEndMs + TICK_MS,
    ]);
    expect(ticksWhere(ticks, "node/pve3", false)[0]).toBe(
      retentionEndMs + TICK_MS,
    );
    expect(ticksWhere(ticks, "node/pve3", false)).toHaveLength(
      ticks.length - present.length,
    );

    // The live nodes are the native push's own now, and never touched.
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isNativePush).toBe(true);
    }
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});

describe("timeline: a OneUptime ingest outage around a native-push node's death", () => {
  test("an Offline row outlives a 20-minute outage and a tick in the 2-minute warm-up after it, though nobody reports it in between", async () => {
    const world: World = createWorld();
    installWorld(world);

    // pve3 dies at NOW and is reported from FIRST_REPORT_MS on.
    await advance(world, { durationMs: 29 * MINUTE_MS, pushing: SURVIVORS });
    expect(rowOf(world, "node/pve3")!.updatedAt.getTime()).toBe(
      FIRST_REPORT_MS,
    );
    const lastReportBeforeMs: number = world.clockMs;
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      lastReportBeforeMs,
    );

    // OneUptime processes nothing for 20 minutes: no push, no heartbeat, no report.
    const outageTicks: Array<TickRecord> = await advance(world, {
      durationMs: 20 * MINUTE_MS,
      pushing: [],
    });
    const outageEndMs: number = world.clockMs;

    // Step 1 turns the cluster Disconnected 15-20 minutes into the outage.
    const disconnectedAtMs: Array<number> = outageTicks
      .filter((tick: TickRecord): boolean => {
        return tick.clusterStatus === "disconnected";
      })
      .map((tick: TickRecord): number => {
        return tick.atMs;
      });
    expect(disconnectedAtMs).toEqual([NOW.getTime() + 45 * MINUTE_MS]);
    expect(disconnectedAtMs[0]! - lastReportBeforeMs).toBeGreaterThan(
      DISCONNECT_AFTER_MS,
    );
    expect(disconnectedAtMs[0]! - lastReportBeforeMs).toBeLessThanOrEqual(
      DISCONNECT_AFTER_MS + HEARTBEAT_FENCE_MS,
    );

    // The pushes resume: the first one reconnects the cluster at once...
    const resumeTicks: Array<TickRecord> = await advance(world, {
      durationMs: 31 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    const resumedAtMs: number = outageEndMs + STEP_MS;

    // ...and the first tick after the resume prunes it again.
    const warmUpTick: TickRecord = resumeTicks[0]!;
    expect(warmUpTick.atMs).toBe(NOW.getTime() + 50 * MINUTE_MS);
    expect(warmUpTick.atMs).toBeGreaterThanOrEqual(resumedAtMs);
    expect(warmUpTick.clusterStatus).toBe("connected");
    expect(warmUpTick.pruned).toBe(true);

    /*
     * Its cutoff is anchored on the reconnect, so it lies past the last
     * report before the outage: a keep that needed a report since the
     * cutoff would drop the row here — and with it every later report,
     * since a node off the inventory is off the roster.
     */
    expect(warmUpTick.cutoffMs).toBe(resumedAtMs - THRESHOLD_MS);
    expect(warmUpTick.cutoffMs!).toBeGreaterThan(lastReportBeforeMs);
    expect(warmUpTick.present.has("node/pve3")).toBe(true);

    /*
     * That tick fell in the warm-up: nobody is established for two
     * minutes after the resume, so nobody had reported the node since
     * before the outage.
     */
    const reportsSince: Array<number> = reportsAfter(world, lastReportBeforeMs);
    expect(reportsSince[0]).toBe(resumedAtMs + SILENCE_MS);
    expect(warmUpTick.atMs).toBeLessThan(reportsSince[0]!);

    // Kept on every tick, still Offline since the first report.
    for (const tick of [...outageTicks, ...resumeTicks]) {
      expect(tick.present.has("node/pve3")).toBe(true);
      expect(tick.offline.has("node/pve3")).toBe(true);
    }
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    expect(pve3.lastSeenAt.getTime()).toBe(NOW.getTime());
    expect(pve3.updatedAt.getTime()).toBe(FIRST_REPORT_MS);

    // Reported again, to the end, once its siblings are re-established.
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      world.clockMs,
    );

    // The live nodes and their guests were never touched.
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
    }
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a node that dies as a 20-minute outage begins is not even marked at the warm-up tick — it is kept all the same, then reported and marked Offline once a node is established", async () => {
    const world: World = createWorld();
    installWorld(world);

    // All three push for 29 minutes; pve3's last push is the last before the outage.
    await advance(world, { durationMs: 29 * MINUTE_MS, pushing: ALL_NODES });
    const diedAtMs: number = world.clockMs;
    expect(world.reportedAtMs).toEqual([]);
    expect(rowOf(world, "node/pve3")!.isUp).toBe(true);

    const outageTicks: Array<TickRecord> = await advance(world, {
      durationMs: 20 * MINUTE_MS,
      pushing: [],
    });
    const outageEndMs: number = world.clockMs;
    // Nobody left to report during the outage; the cluster went Disconnected.
    expect(world.reportedAtMs).toEqual([]);
    expect(outageTicks[outageTicks.length - 1]!.clusterStatus).toBe(
      "disconnected",
    );

    // pve1 and pve2 resume; pve3 does not.
    const resumeTicks: Array<TickRecord> = await advance(world, {
      durationMs: 31 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    const resumedAtMs: number = outageEndMs + STEP_MS;
    const establishedAtMs: number = resumedAtMs + SILENCE_MS;

    // The first tick after the resume falls inside the 2-minute warm-up...
    const warmUpTick: TickRecord = resumeTicks[0]!;
    expect(warmUpTick.atMs).toBeGreaterThanOrEqual(resumedAtMs);
    expect(warmUpTick.atMs).toBeLessThan(establishedAtMs);
    expect(warmUpTick.clusterStatus).toBe("connected");
    expect(warmUpTick.pruned).toBe(true);
    // ...with a cutoff anchored on the reconnect, past pve3's last push...
    expect(warmUpTick.cutoffMs).toBe(resumedAtMs - THRESHOLD_MS);
    expect(warmUpTick.cutoffMs!).toBeGreaterThan(diedAtMs);
    /*
     * ...while pve3 was never reported, so never marked: a keep that
     * waited for the Offline mark would have pruned it here, and nobody
     * would ever have reported it. isNativePush keeps it.
     */
    expect(warmUpTick.present.has("node/pve3")).toBe(true);
    expect(warmUpTick.offline.has("node/pve3")).toBe(false);
    // Its guest and storage are not kept: they go on this very tick.
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      expect(world.prunedAtMs.get(externalId)).toEqual([warmUpTick.atMs]);
    }

    // Once pve1 has pushed for two minutes it reports pve3, which turns Offline.
    expect(world.reportedAtMs[0]).toBe(establishedAtMs);
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    expect(pve3.updatedAt.getTime()).toBe(establishedAtMs);
    expect(pve3.lastSeenAt.getTime()).toBe(diedAtMs);
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      world.clockMs,
    );

    // Kept on every tick, Offline on every tick after the warm-up.
    for (const tick of [...outageTicks, ...resumeTicks]) {
      expect(tick.present.has("node/pve3")).toBe(true);
      expect(tick.offline.has("node/pve3")).toBe(tick.atMs >= establishedAtMs);
    }
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isUp).toBe(true);
    }
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a node silent for longer than the retention window by the time the pushes resume goes on the first tick after them, warm-up or not", async () => {
    const world: World = createWorld();
    installWorld(world);
    const retentionEndMs: number = NOW.getTime() + RETENTION_MS;

    // pve3 is reported for all but the last 16 minutes of its window...
    await advance(world, {
      durationMs: RETENTION_MS - 16 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    expect(rowOf(world, "node/pve3")!.updatedAt.getTime()).toBe(
      FIRST_REPORT_MS,
    );

    // ...when OneUptime stops processing for 20 minutes, across its end.
    const outageTicks: Array<TickRecord> = await advance(world, {
      durationMs: 20 * MINUTE_MS,
      pushing: [],
    });
    const outageEndMs: number = world.clockMs;
    expect(outageEndMs).toBeGreaterThan(retentionEndMs);

    // Kept while the cluster was connected; skipped once it was not.
    for (const tick of outageTicks) {
      expect(tick.present.has("node/pve3")).toBe(true);
    }
    const lastOutageTick: TickRecord = outageTicks[outageTicks.length - 1]!;
    expect(lastOutageTick.atMs).toBe(retentionEndMs);
    expect(lastOutageTick.clusterStatus).toBe("disconnected");

    const resumeTicks: Array<TickRecord> = await advance(world, {
      durationMs: 30 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    const resumedAtMs: number = outageEndMs + STEP_MS;

    // The first tick after the resume, in the warm-up and past the window.
    const firstTick: TickRecord = resumeTicks[0]!;
    expect(firstTick.atMs).toBe(retentionEndMs + TICK_MS);
    expect(firstTick.atMs).toBeLessThan(resumedAtMs + SILENCE_MS);
    expect(firstTick.clusterStatus).toBe("connected");
    expect(firstTick.present.has("node/pve3")).toBe(false);
    expect(world.prunedAtMs.get("node/pve3")).toEqual([firstTick.atMs]);

    // Off the roster, it is never reported again, and never comes back.
    expect(reportsAfter(world, outageEndMs)).toEqual([]);
    for (const tick of resumeTicks) {
      expect(tick.present.has("node/pve3")).toBe(false);
    }

    // The live nodes and their guests were never touched.
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
    }
  });

  test("an outage a little shorter than the silence window marks nobody Offline: a sibling's pre-outage key is still alive but no longer vouches", async () => {
    const world: World = createWorld();
    installWorld(world);

    /*
     * Every node pushed at NOW; pve1's and pve2's next pushes land 8 s
     * later, pve3's would two seconds after that — but OneUptime stops
     * processing in between, for 117 s.
     */
    await advance(world, {
      durationMs: 8 * SECOND_MS,
      stepMs: 8 * SECOND_MS,
      pushing: SURVIVORS,
    });
    await advance(world, { durationMs: 112 * SECOND_MS, pushing: [] });
    const resumeAtMs: number = world.clockMs + 5 * SECOND_MS;

    /*
     * What the first push processed afterwards (pve1's) finds: pve2's key
     * is still alive and its streak is over an hour long — yet its last
     * push is more than a streak gap old, so it is not established — and
     * pve3's key has just expired, although pve3 is fine.
     */
    const pve2: ProxmoxNodeLiveness | null = readLiveness(
      world,
      "pve2",
      resumeAtMs,
    );
    expect(pve2).not.toBeNull();
    expect(isAliveProxmoxNode(pve2, resumeAtMs)).toBe(true);
    expect(resumeAtMs - pve2!.streakStartMs).toBeGreaterThanOrEqual(SILENCE_MS);
    expect(resumeAtMs - pve2!.lastPushMs).toBeGreaterThan(
      PROXMOX_NODE_STREAK_GAP_MS,
    );
    expect(isEligibleProxmoxReporter(pve2, resumeAtMs)).toBe(false);
    expect(readLiveness(world, "pve3", resumeAtMs)).toBeNull();

    // Every node's pushes resume, pve1's processed first in each round.
    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 15 * MINUTE_MS - 2 * MINUTE_MS,
      stepMs: 5 * SECOND_MS,
      pushing: ALL_NODES,
    });

    // Nobody was reported, nothing turned Offline, and nothing was pruned.
    expect(world.reportedAtMs).toEqual([]);
    expect(
      ticks.map((tick: TickRecord): number => {
        return tick.atMs;
      }),
    ).toEqual([
      NOW.getTime() + 5 * MINUTE_MS,
      NOW.getTime() + 10 * MINUTE_MS,
      NOW.getTime() + 15 * MINUTE_MS,
    ]);
    for (const tick of ticks) {
      expect(tick.clusterStatus).toBe("connected");
      expect(tick.offline.size).toBe(0);
      expect(tick.present.size).toBe(CATALOG.length);
    }
    for (const nodeName of ALL_NODES) {
      expect(rowOf(world, `node/${nodeName}`)!.isUp).toBe(true);
    }
    expect(world.prunedAtMs.size).toBe(0);
  });
});

describe("timeline: a whole native-push cluster that goes dark", () => {
  test("turns Disconnected in step 1, is never pruned, and nobody is reported Offline", async () => {
    const world: World = createWorld();
    installWorld(world);

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 2 * 24 * 60 * MINUTE_MS,
      pushing: [],
    });

    const connectedTicks: Array<TickRecord> = ticks.filter(
      (tick: TickRecord): boolean => {
        return tick.clusterStatus === "connected";
      },
    );
    // Step 1 flips it on the first tick more than 15 minutes after the last heartbeat.
    expect(
      connectedTicks.map((tick: TickRecord): number => {
        return tick.atMs;
      }),
    ).toEqual([
      NOW.getTime() + 5 * MINUTE_MS,
      NOW.getTime() + 10 * MINUTE_MS,
      NOW.getTime() + 15 * MINUTE_MS,
    ]);
    // Pruned (to no effect) only while still connected; never after the flip.
    for (const tick of ticks) {
      expect(tick.pruned).toBe(tick.clusterStatus === "connected");
      expect(tick.present.size).toBe(CATALOG.length);
    }
    expect(world.prunedAtMs.size).toBe(0);
    expect(world.clusterStatus).toBe("disconnected");

    // No live node was left to speak for the others: nothing turned Offline.
    expect(world.reportedAtMs).toEqual([]);
    for (const nodeName of ALL_NODES) {
      expect(rowOf(world, `node/${nodeName}`)!.isUp).not.toBe(false);
    }
  });

  test("when it comes back after two days the whole last-known inventory is still there and stays", async () => {
    const world: World = createWorld();
    installWorld(world);

    await advance(world, {
      durationMs: 2 * 24 * 60 * MINUTE_MS,
      pushing: [],
    });
    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 60 * MINUTE_MS,
      pushing: ALL_NODES,
    });

    expect(world.clusterStatus).toBe("connected");
    expect(world.prunedAtMs.size).toBe(0);
    for (const tick of ticks) {
      expect(tick.clusterStatus).toBe("connected");
      expect(tick.pruned).toBe(true);
      expect(tick.present.size).toBe(CATALOG.length);
    }
    // Every node is back before any is established: nobody is reported.
    expect(world.reportedAtMs).toEqual([]);
  });

  test("after a 2-hour power cut only pve1 and pve2 come back: pve3 survives the warm-up tick unmarked, then is reported and marked Offline", async () => {
    const world: World = createWorld();
    installWorld(world);

    // Dark from NOW; the first push afterwards is processed two hours on.
    const darkTicks: Array<TickRecord> = await advance(world, {
      durationMs: 2 * 60 * MINUTE_MS - STEP_MS,
      pushing: [],
    });
    expect(world.clusterStatus).toBe("disconnected");
    expect(world.reportedAtMs).toEqual([]);
    for (const tick of darkTicks) {
      expect(tick.present.size).toBe(CATALOG.length);
    }

    const resumeTicks: Array<TickRecord> = await advance(world, {
      durationMs: 30 * MINUTE_MS + STEP_MS,
      pushing: SURVIVORS,
    });
    const resumedAtMs: number = NOW.getTime() + 2 * 60 * MINUTE_MS;
    const establishedAtMs: number = resumedAtMs + SILENCE_MS;

    /*
     * The tick right after the first push: reconnected, so pruned, with a
     * cutoff anchored on that push — two hours past pve3's last one —
     * and nobody established yet, so pve3 is not marked. Kept.
     */
    const warmUpTick: TickRecord = resumeTicks[0]!;
    expect(warmUpTick.atMs).toBe(resumedAtMs);
    expect(warmUpTick.clusterStatus).toBe("connected");
    expect(warmUpTick.pruned).toBe(true);
    expect(warmUpTick.cutoffMs).toBe(resumedAtMs - THRESHOLD_MS);
    expect(warmUpTick.cutoffMs!).toBeGreaterThan(NOW.getTime());
    expect(warmUpTick.present.has("node/pve3")).toBe(true);
    expect(warmUpTick.offline.has("node/pve3")).toBe(false);
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      expect(world.prunedAtMs.get(externalId)).toEqual([resumedAtMs]);
    }

    // Two minutes on, the nodes that are back report it.
    expect(world.reportedAtMs[0]).toBe(establishedAtMs);
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    expect(pve3.updatedAt.getTime()).toBe(establishedAtMs);
    expect(pve3.lastSeenAt.getTime()).toBe(NOW.getTime());
    for (const tick of resumeTicks) {
      expect(tick.present.has("node/pve3")).toBe(true);
      expect(tick.offline.has("node/pve3")).toBe(tick.atMs >= establishedAtMs);
    }
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isUp).toBe(true);
    }
  });

  test("if pve3 never comes back after the power cut it is let go on the first tick past 7 days after its own last push, not after the mark", async () => {
    const world: World = createWorld();
    installWorld(world);
    const resumedAtMs: number = NOW.getTime() + 2 * 60 * MINUTE_MS;
    const retentionEndMs: number = NOW.getTime() + RETENTION_MS;

    await advance(world, {
      durationMs: 2 * 60 * MINUTE_MS - STEP_MS,
      pushing: [],
    });
    const firstTicks: Array<TickRecord> = await advance(world, {
      durationMs: 5 * MINUTE_MS + STEP_MS,
      pushing: SURVIVORS,
    });

    // Marked two hours and two minutes after its last push...
    expect(rowOf(world, "node/pve3")!.updatedAt.getTime()).toBe(
      resumedAtMs + SILENCE_MS,
    );

    const ticks: Array<TickRecord> = [
      ...firstTicks,
      ...(await advance(world, {
        durationMs: RETENTION_MS - 2 * 60 * MINUTE_MS - 5 * MINUTE_MS,
        pushing: SURVIVORS,
      })),
      ...(await advance(world, {
        durationMs: 60 * MINUTE_MS,
        pushing: SURVIVORS,
      })),
    ];

    // ...kept and reported to the end of the window counted from that push...
    const present: Array<number> = ticksWhere(ticks, "node/pve3", true);
    expect(present[present.length - 1]).toBe(retentionEndMs);
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      retentionEndMs,
    );
    // ...and gone on the first tick past it, for good.
    expect(world.prunedAtMs.get("node/pve3")).toEqual([
      retentionEndMs + TICK_MS,
    ]);
    expect(ticksWhere(ticks, "node/pve3", false)[0]).toBe(
      retentionEndMs + TICK_MS,
    );
    expect(reportsAfter(world, retentionEndMs)).toEqual([]);
    expect(world.prunedAtMs.has("node/pve1")).toBe(false);
    expect(world.prunedAtMs.has("node/pve2")).toBe(false);
  });

  test("a standalone host (a one-node cluster) going dark is the same case: kept, never reported", async () => {
    const world: World = createWorld();
    world.catalog = CATALOG.filter((template: WorldRowTemplate): boolean => {
      return template.nodeName === "pve1";
    });
    world.rows = world.rows.filter((row: WorldRow): boolean => {
      return row.nodeName === "pve1";
    });
    installWorld(world);

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 24 * 60 * MINUTE_MS,
      pushing: [],
    });

    expect(world.clusterStatus).toBe("disconnected");
    expect(world.prunedAtMs.size).toBe(0);
    expect(rowOf(world, "node/pve1")!.isUp).not.toBe(false);
    expect(world.reportedAtMs).toEqual([]);
    for (const tick of ticks) {
      expect(tick.present.size).toBe(2);
    }
  });
});

describe("timeline: with silent-node detection switched off (PVE_NATIVE_NODE_SILENCE_DETECTION=false)", () => {
  const DETECTION_ENV: string = "PVE_NATIVE_NODE_SILENCE_DETECTION";
  let savedDetection: string | undefined;

  beforeEach(() => {
    savedDetection = process.env[DETECTION_ENV];
  });

  afterEach(() => {
    if (savedDetection === undefined) {
      delete process.env[DETECTION_ENV];
    } else {
      process.env[DETECTION_ENV] = savedDetection;
    }
  });

  function switchDetection(on: boolean): void {
    process.env[DETECTION_ENV] = on ? "true" : "false";
    // The model reads the same switch the ingest and the service read.
    expect(isProxmoxSilentNodeDetectionEnabled()).toBe(on);
  }

  test("a native-push node that dies is never reported nor marked, and goes with its guests on the normal cutoff — the prune from before the keep", async () => {
    switchDetection(false);
    const world: World = createWorld();
    installWorld(world);
    expect(rowOf(world, "node/pve3")!.isNativePush).toBe(true);

    // pve3 dies at NOW; pve1 and pve2 push on for an hour.
    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    // The ingest records no liveness and reports nobody.
    expect(world.reportedAtMs).toEqual([]);
    for (const nodeName of ALL_NODES) {
      expect(readLiveness(world, nodeName)).toBeNull();
    }

    /*
     * Its native Node row goes on the first tick whose cutoff passes its
     * last push, together with its guest and storage, seen at the same
     * moment: no retention window.
     */
    const firstPastCutoff: TickRecord | undefined = ticks.find(
      (tick: TickRecord): boolean => {
        return tick.cutoffMs !== null && tick.cutoffMs > NOW.getTime();
      },
    );
    expect(firstPastCutoff).toBeDefined();
    const prunedAt: Array<number> | undefined =
      world.prunedAtMs.get("node/pve3");
    expect(prunedAt).toEqual([firstPastCutoff!.atMs]);
    expect(prunedAt![0]!).toBeGreaterThan(NOW.getTime() + THRESHOLD_MS);
    expect(prunedAt![0]!).toBeLessThanOrEqual(
      NOW.getTime() + THRESHOLD_MS + HEARTBEAT_FENCE_MS + TICK_MS,
    );
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      expect(world.prunedAtMs.get(externalId)).toEqual(prunedAt);
    }

    // Never shown Offline; present up to the prune, gone for good after it.
    for (const tick of ticks) {
      expect(tick.offline.size).toBe(0);
      expect(tick.present.has("node/pve3")).toBe(tick.atMs < prunedAt![0]!);
    }

    // The live nodes' rows ride their own pushes, native and untouched.
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isUp).toBe(true);
      expect(rowOf(world, externalId)!.isNativePush).toBe(true);
    }
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("switched off while a node is being kept, the keep goes with it: the next tick prunes the row at the normal cutoff and the reports stop", async () => {
    switchDetection(true);
    const world: World = createWorld();
    installWorld(world);

    // With detection on, pve3 dies at NOW and is kept, Offline, for an hour.
    const onTicks: Array<TickRecord> = await advance(world, {
      durationMs: 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    for (const tick of onTicks) {
      expect(tick.present.has("node/pve3")).toBe(true);
    }
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    expect(pve3.isNativePush).toBe(true);
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    const switchedOffAtMs: number = world.clockMs;
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      switchedOffAtMs,
    );

    switchDetection(false);
    const offTicks: Array<TickRecord> = await advance(world, {
      durationMs: 30 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    // Its last push is long past the cutoff: the very next tick takes it.
    expect(offTicks[0]!.atMs).toBe(switchedOffAtMs + TICK_MS);
    expect(offTicks[0]!.cutoffMs!).toBeGreaterThan(NOW.getTime());
    expect(world.prunedAtMs.get("node/pve3")).toEqual([offTicks[0]!.atMs]);
    for (const tick of offTicks) {
      expect(tick.present.has("node/pve3")).toBe(false);
    }
    expect(reportsAfter(world, switchedOffAtMs)).toEqual([]);

    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
    }
  });
});
