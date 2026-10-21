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
 * bulkUpsert (with its lastSeenAt guard, its updatedAt on the database's
 * own clock, and the not-reporting mark it clears), getNodeRoster (with
 * each row's isUp and notReportingMarkedAt, and — where a test turns it
 * on — the ingest's 30-second roster cache, which keeps the moment it
 * read the roster), the ingest's 30-second mark fence and
 * markNodesNotReporting's UPDATE (its mark, notReportingMarkedAt, written
 * on the ingest worker's clock, with its once-a-minute refresh of an
 * Offline row's mark, and its updatedAt on the database's), the
 * native-push adoption (its 10-minute fence and adoptNodesAsNativePush's
 * UPDATE, which sets isNativePush alone, seenUpTo guard included), the
 * cluster heartbeat fence and markDisconnectedClusters, each mirrored from
 * the ingest or the service — driven by the REAL node-liveness rules
 * (nextProxmoxNodeLiveness, decideProxmoxSilentNodes,
 * isProxmoxSilentNodeDetectionEnabled). They show that the cutoff this
 * cron chooses keeps a native-push node for the whole retention window —
 * through a OneUptime ingest outage or a whole-cluster power cut and the
 * warm-up after it, when nobody reports and the node may not even be
 * marked Offline yet — lets it go on the first tick past that window
 * (counted from its own last push, however fresh its mark), leaves the
 * agent's rows on the 15-minute prune, keeps a node that was
 * already Offline when its cluster moved from the agent to the native
 * push (or since before isNativePush existed) once the first native flush
 * adopts it, never lets a native batch processed late — after the cluster
 * moved back to the agent — adopt the agent's newer rows, never prunes a
 * cluster that went dark as a whole, and — with silent-node detection
 * switched off — prunes a dead native node at the stale cutoff like any
 * other row. Along the way they pin who reports across a gap: with no
 * node established, an Offline node keeps being reported only while its
 * own row carries a mark (notReportingMarkedAt) made within the monitors'
 * 5 minutes of the moment the roster was read — so every push served by
 * one cached roster decides alike, and a report that re-marked the row is
 * never followed by one that drops it — a mark in Postgres that those
 * reports keep fresh, so it outlives a Redis failover and a lone
 * survivor's gaps, and ages out over a longer outage; written on the
 * ingest worker's clock, the one it is judged against, whatever the
 * database's clock says (updatedAt, which bulkUpsert writes on the
 * database's clock too, never stands in for it); never taken from an
 * adoption or an agent scrape, which mark nothing — with every node not
 * reported counted as live.
 * PVE_NATIVE_NODE_SILENCE_DETECTION is the one env switch the timeline
 * sets for real (saved and restored around each test that does), since
 * both the ingest and the delete mirrors read it through the real
 * isProxmoxSilentNodeDetectionEnabled.
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
 * point, which the timeline never calls — it mirrors that entry point, and
 * the ingest's Redis fences, on the model's own key store: an empty
 * stand-in keeps Redis unloaded.
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
  PROXMOX_MONITOR_WINDOW_MS,
  PROXMOX_NODE_SILENCE_MS,
  PROXMOX_NODE_STREAK_GAP_MS,
  PROXMOX_ROSTER_CACHE_TTL_MS,
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
      /isUp|updatedAt|notReportingMarkedAt|isNativePush|isProxmoxSilentNodeDetectionEnabled|"Node"|'Node'|PVE_/,
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
 *     expiring PROXMOX_NODE_SILENCE_MS after the write); a roster
 *     (getNodeRoster: the Node rows seen within the retention window,
 *     with their isUp and notReportingMarkedAt — read afresh for every
 *     push, unless the test turns on the ingest's roster cache: one ingest
 *     worker's in-process cache, a roster read on a miss reused, together
 *     with the moment it was read, for PROXMOX_ROSTER_CACHE_TTL_MS) with
 *     no sibling on it reports nothing; otherwise the REAL
 *     decideProxmoxSilentNodes picks the siblings to report from the
 *     roster, the moment it was read (rosterReadAtMs) and the keys that
 *     have not expired — nothing else: no Redis key but the liveness keys
 *     takes part. So who reports is the module's own rule: every live
 *     node, once some node is established — pushing for two minutes with
 *     its streak unbroken now, its last push at most
 *     PROXMOX_NODE_STREAK_GAP_MS old; before that, only the nodes already
 *     Offline whose row carries a mark (notReportingMarkedAt) at most
 *     PROXMOX_MONITOR_WINDOW_MS (the monitors' 5 minutes) older than the
 *     moment the roster was read — the push's own on a fresh read, the
 *     earlier push's that read it on a cached one. Each report counts
 *     every node not reported as live (reporterCount);
 *   - the flush: bulkUpsert refreshes the node's own rows (lastSeenAt =
 *     the batch's own observation, updatedAt = the database's now(),
 *     notReportingMarkedAt = NULL — the node's own observation clears the
 *     mark — isUp = true, isNativePush = whether the batch came from the
 *     native push) where that observation is no older than the row's
 *     lastSeenAt — a batch processed late never rolls a row back — and
 *     re-creates any that were pruned; a native batch then adopts the
 *     cluster's Node rows (adoptProxmoxNodesAsNativePush): fenced to once
 *     per 10 minutes per cluster (no fence is held when a timeline
 *     starts), then adoptNodesAsNativePush's UPDATE — isNativePush = true,
 *     and nothing else (an adoption is not a mark: the row's
 *     notReportingMarkedAt, and its updatedAt, are left as they were), on
 *     every Node row not yet native and last seen no later than the
 *     batch's newest observation (seenUpTo); the cluster heartbeat is
 *     refreshed at most once per 5-minute maintenance fence while
 *     anything pushes, and a push reconnects a disconnected cluster; then
 *     the reported nodes turn Offline — the ingest's mark fence
 *     (markProxmoxSilentNodesOffline: setStringIfNotExists, 30 s per
 *     cluster and set of nodes, no fence held when a timeline starts),
 *     then markNodesNotReporting's UPDATE with markedAt = the ingest
 *     worker's now: isUp = false, isNativePush = true (a node the native
 *     pushes report belongs to a native-push cluster, whoever wrote its
 *     row last), notReportingMarkedAt = markedAt and updatedAt = the
 *     database's now(), never lastSeenAt, only on a row last seen before
 *     the report's own time minus the silence window and not already
 *     Offline, native and marked within the last minute — isUp IS
 *     DISTINCT FROM false OR isNativePush IS DISTINCT FROM true OR
 *     notReportingMarkedAt IS NULL OR notReportingMarkedAt < markedAt -
 *     60 s. So a node reported on every 30-second step is re-marked every
 *     two minutes (MARK_CADENCE_MS): the fence lets one UPDATE through a
 *     minute, and the guard writes every other one;
 *   - markDisconnectedClusters: connected and not seen for 15 minutes;
 *   - deleteStaleForCluster: lastSeenAt < cutoff, except — while
 *     silent-node detection is on — a Node with isNativePush IS TRUE and
 *     lastSeenAt within the retention window
 *     (getSilentNodeRetentionCutoff, on the service's clock — the cron
 *     passes no `now`); switched off, the plain lastSeenAt < cutoff.
 * One clock (the PVE clocks and OneUptime's agree here) — but for the
 * database's now(), which a test may set apart (dbClockAheadMs); it
 * reaches nothing but the updatedAt that bulkUpsert and
 * markNodesNotReporting write, which nothing reads back as a mark —
 * 30-second steps unless a test asks for finer ones, the cron on every
 * 5-minute boundary.
 * Every push is its own batch, observed when it is processed — except a
 * late native batch (ingestLateNativePush), processed now but observed
 * earlier. A OneUptime ingest outage is a stretch in which nothing is
 * processed: pushing [], exactly as for a cluster gone dark. A Redis
 * failover (loseRedisKeys) empties the model's key store — every liveness
 * key and both fences — and leaves the inventory (and the worker's
 * in-process roster cache) as it is. On the agent
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
// The ingest's adoption fence (setStringIfNotExists, 600 s).
const ADOPT_FENCE_TTL_MS: number = 10 * MINUTE_MS;
// The ingest's mark fence (setStringIfNotExists, 30 s).
const MARK_FENCE_TTL_MS: number = 30 * SECOND_MS;
/*
 * markNodesNotReporting rewrites a row already Offline and native only
 * once its mark is older than this, on the worker's clock
 * ("notReportingMarkedAt" < $6, markedAt minus 60 s) — or when it carries
 * none ("notReportingMarkedAt" IS NULL).
 */
const MARK_REFRESH_AFTER_MS: number = MINUTE_MS;
/*
 * What those two make of a node reported on every 30-second step: the
 * fence, taken at t, is still there at t + 30 s, so an UPDATE runs at t,
 * t + 1 min, t + 2 min...; the one at t + 1 min finds a mark exactly a
 * minute old — not older — and writes nothing, the one at t + 2 min
 * re-marks the row. Well inside PROXMOX_MONITOR_WINDOW_MS.
 */
const MARK_CADENCE_MS: number = 2 * MINUTE_MS;

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
  // Written by bulkUpsert and markNodesNotReporting, on the database's clock.
  updatedAt: Date;
  /*
   * When the live nodes last reported this node as not reporting, on the
   * ingest worker's clock (markNodesNotReporting); cleared by the node's
   * own next observation (bulkUpsert). Null: never reported down since.
   */
  notReportingMarkedAt: Date | null;
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

// One push's report: what decideProxmoxSilentNodes returned for it.
interface WorldReport {
  atMs: number;
  reporter: string;
  silentNodes: Array<string>;
  // L: the nodes not reported, each counted as live.
  reporterCount: number;
}

// One adoptNodesAsNativePush UPDATE — one the fence let through.
interface WorldAdoption {
  atMs: number;
  seenUpToMs: number;
  // The Node rows it flagged, in row order.
  adopted: Array<string>;
}

// One markNodesNotReporting UPDATE — one the mark fence let through.
interface WorldMark {
  atMs: number;
  nodeNames: Array<string>;
  /*
   * The Node rows it wrote, in row order: none when each was already
   * Offline, native and marked within the last minute.
   */
  written: Array<string>;
}

/*
 * The roster a push decides on, and when it was read — what the marks'
 * age is taken against (decideProxmoxSilentNodes' rosterReadAtMs).
 */
interface WorldRosterRead {
  roster: Array<ProxmoxRosterNode>;
  readAtMs: number;
}

// One ingest worker's in-process roster cache entry: {roster, readAtMs}.
interface WorldCachedRoster extends WorldRosterRead {
  // Reused while the clock is at or before this (InMemoryTTLCache.get).
  expiresAtMs: number;
}

interface World {
  // The ingest workers' clock (and the cron's, and the PVE nodes').
  clockMs: number;
  /*
   * How far the database's now() runs ahead of the workers' clock
   * (negative: behind). Only the updatedAt that bulkUpsert and
   * markNodesNotReporting write reads it.
   */
  dbClockAheadMs: number;
  clusterId: ObjectID;
  clusterStatus: string;
  clusterLastSeenAt: Date;
  // What getStaleThresholdDate subtracts (PVE_INVENTORY_STALE_MINUTES).
  staleThresholdMs: number;
  /*
   * The ingest's roster cache lifetime; 0 leaves it out, and every push
   * reads the roster afresh.
   */
  rosterCacheTtlMs: number;
  rosterCache: WorldCachedRoster | null;
  // The clock of every getNodeRoster read (a cache miss).
  rosterReadsAtMs: Array<number>;
  // Where the batches come from: the Proxmox VE native push, or the agent.
  nativePush: boolean;
  catalog: Array<WorldRowTemplate>;
  rows: Array<WorldRow>;
  livenessKeys: Map<string, WorldLivenessKey>;
  // When the "proxmox-native-adopt" fence expires; null: never taken.
  adoptFenceExpiresAtMs: number | null;
  /*
   * When each "proxmox-silent-node-mark" fence expires, by cluster and
   * set of nodes.
   */
  markFenceExpiresAtMs: Map<string, number>;
  // The clock of every moment at which a live node reported a silent one.
  reportedAtMs: Array<number>;
  // Every report, push by push.
  reports: Array<WorldReport>;
  adoptions: Array<WorldAdoption>;
  marks: Array<WorldMark>;
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

// A key of the model's store is there until its expiry has passed.
function isKeyPresent(expiresAtMs: number | null, atMs: number): boolean {
  return expiresAtMs !== null && atMs <= expiresAtMs;
}

interface WorldOptions {
  staleThresholdMs?: number | undefined;
  // How long before NOW the cluster heartbeat was last written.
  heartbeatAgeMs?: number | undefined;
  // false: the batches come from the Proxmox Agent (pve-exporter).
  nativePush?: boolean | undefined;
  // The rows' isNativePush when the timeline starts; the source's by default.
  rowsNativePush?: boolean | null | undefined;
  // The database's clock against the workers'; in step by default.
  dbClockAheadMs?: number | undefined;
  // The ingest's roster cache lifetime; left out (0) by default.
  rosterCacheTtlMs?: number | undefined;
}

function createWorld(options?: WorldOptions): World {
  const nativePush: boolean = options?.nativePush !== false;
  const rowsNativePush: boolean | null =
    options?.rowsNativePush !== undefined ? options.rowsNativePush : nativePush;
  const dbClockAheadMs: number = options?.dbClockAheadMs || 0;
  const world: World = {
    clockMs: NOW.getTime(),
    dbClockAheadMs,
    clusterId: CLUSTER_A_ID,
    clusterStatus: "connected",
    clusterLastSeenAt: new Date(NOW.getTime() - (options?.heartbeatAgeMs || 0)),
    staleThresholdMs: options?.staleThresholdMs || THRESHOLD_MS,
    rosterCacheTtlMs: options?.rosterCacheTtlMs || 0,
    rosterCache: null,
    rosterReadsAtMs: [],
    nativePush,
    catalog: CATALOG,
    rows: CATALOG.map((template: WorldRowTemplate): WorldRow => {
      return {
        ...template,
        isUp: true,
        lastSeenAt: new Date(NOW),
        // Written by bulkUpsert, on the database's clock.
        updatedAt: new Date(NOW.getTime() + dbClockAheadMs),
        // Every node pushed itself at NOW, which clears the mark.
        notReportingMarkedAt: null,
        isNativePush: rowsNativePush,
      };
    }),
    livenessKeys: new Map<string, WorldLivenessKey>(),
    adoptFenceExpiresAtMs: null,
    markFenceExpiresAtMs: new Map<string, number>(),
    reportedAtMs: [],
    reports: [],
    adoptions: [],
    marks: [],
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

/*
 * A Redis failover that lost every key: the liveness keys and the
 * ingest's fences. The inventory — every row's isUp and
 * notReportingMarkedAt — is in Postgres and stays, and so does the
 * worker's in-process roster cache.
 */
function loseRedisKeys(world: World): void {
  world.livenessKeys.clear();
  world.adoptFenceExpiresAtMs = null;
  world.markFenceExpiresAtMs.clear();
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
      return {
        nodeName: row.nodeName,
        lastSeenAt: new Date(row.lastSeenAt),
        isUp: row.isUp,
        notReportingMarkedAt: row.notReportingMarkedAt
          ? new Date(row.notReportingMarkedAt)
          : null,
      };
    });
}

/*
 * The roster a push decides on, with the moment it was read: from the
 * worker's roster cache while its entry lasts (InMemoryTTLCache: until the
 * clock passes its expiry) — the read time the entry was cached with —
 * else read afresh, now, and cached for rosterCacheTtlMs when the cache is
 * on.
 */
function rosterFor(world: World): WorldRosterRead {
  if (world.rosterCache && world.clockMs <= world.rosterCache.expiresAtMs) {
    return {
      roster: world.rosterCache.roster,
      readAtMs: world.rosterCache.readAtMs,
    };
  }
  const read: WorldRosterRead = {
    roster: nodeRoster(world),
    readAtMs: world.clockMs,
  };
  world.rosterReadsAtMs.push(world.clockMs);
  world.rosterCache =
    world.rosterCacheTtlMs > 0
      ? { ...read, expiresAtMs: world.clockMs + world.rosterCacheTtlMs }
      : null;
  return read;
}

/*
 * recordProxmoxNodePushAndFindSilentNodes, on the model's key store:
 * advance this node's key; with no sibling on the roster report nothing;
 * otherwise decide with the real rule, from the roster, the moment it was
 * read and the keys alone.
 */
function recordPushAndFindSilentNodes(
  world: World,
  selfNode: string,
  reporterTimeMs: number,
): ProxmoxSilentNodeDecision | null {
  const nowMs: number = world.clockMs;
  const current: ProxmoxNodeLiveness = nextProxmoxNodeLiveness(
    readLiveness(world, selfNode),
    nowMs,
  );
  writeLiveness(world, selfNode, current);

  const read: WorldRosterRead = rosterFor(world);
  const roster: Array<ProxmoxRosterNode> = read.roster;
  const siblings: Array<string> = roster
    .map((node: ProxmoxRosterNode): string => {
      return node.nodeName;
    })
    .filter((nodeName: string): boolean => {
      return nodeName !== selfNode;
    });
  if (siblings.length === 0) {
    return null;
  }

  const liveness: Map<string, ProxmoxNodeLiveness | null> = new Map<
    string,
    ProxmoxNodeLiveness | null
  >();
  liveness.set(selfNode, current);
  for (const nodeName of siblings) {
    liveness.set(nodeName, readLiveness(world, nodeName));
  }

  return decideProxmoxSilentNodes({
    selfNode,
    reporterTimeMs,
    nowMs,
    roster,
    liveness,
    rosterReadAtMs: read.readAtMs,
  });
}

/*
 * bulkUpsert of the node's own rows, plus the cluster heartbeat. isUp is
 * what the batch says: always up for a native push (a node that is down
 * pushes nothing), down for a node pve-exporter still lists as down.
 * ON CONFLICT ... WHERE EXCLUDED."lastSeenAt" >= "lastSeenAt": a row seen
 * after the batch's own observation is left as it is. A newer observation
 * clears the not-reporting mark (notReportingMarkedAt = NULL), whatever
 * the batch's source — an agent scrape never marks. updatedAt is the
 * database's now(); the heartbeat is written on the worker's clock.
 */
function upsertOwnRows(
  world: World,
  nodeName: string,
  batch: { isUp: boolean; isNativePush: boolean; observedAtMs: number },
): void {
  const now: Date = new Date(world.clockMs);
  const dbNow: Date = new Date(world.clockMs + world.dbClockAheadMs);
  const seenAt: Date = new Date(batch.observedAtMs);
  for (const template of world.catalog) {
    if (template.nodeName !== nodeName) {
      continue;
    }
    const row: WorldRow | undefined = rowOf(world, template.externalId);
    if (!row) {
      world.rows.push({
        ...template,
        isUp: batch.isUp,
        lastSeenAt: seenAt,
        updatedAt: dbNow,
        notReportingMarkedAt: null,
        isNativePush: batch.isNativePush,
      });
      continue;
    }
    if (seenAt.getTime() < row.lastSeenAt.getTime()) {
      continue;
    }
    row.isUp = batch.isUp;
    row.lastSeenAt = seenAt;
    row.updatedAt = dbNow;
    row.notReportingMarkedAt = null;
    row.isNativePush = batch.isNativePush;
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
 * markNodesNotReporting's UPDATE, with markedAt the ingest worker's now:
 * SET isUp = false, isNativePush = true, notReportingMarkedAt = markedAt
 * ($5) — never lastSeenAt, never the database's now() — and updatedAt =
 * the database's now() WHERE "lastSeenAt" < $4 AND ("isUp" IS DISTINCT
 * FROM false OR "isNativePush" IS DISTINCT FROM true OR
 * "notReportingMarkedAt" IS NULL OR "notReportingMarkedAt" < markedAt -
 * 60 s ($6)).
 */
function markNodesNotReporting(
  world: World,
  nodeNames: Array<string>,
  silentBeforeMs: number,
  markedAtMs: number,
): void {
  const refreshBeforeMs: number = markedAtMs - MARK_REFRESH_AFTER_MS;
  const dbNow: Date = new Date(world.clockMs + world.dbClockAheadMs);
  const written: Array<string> = [];
  for (const row of world.rows) {
    if (
      row.kind === "Node" &&
      nodeNames.includes(row.nodeName) &&
      row.lastSeenAt.getTime() < silentBeforeMs &&
      (row.isUp !== false ||
        row.isNativePush !== true ||
        row.notReportingMarkedAt === null ||
        row.notReportingMarkedAt.getTime() < refreshBeforeMs)
    ) {
      row.isUp = false;
      row.isNativePush = true;
      row.notReportingMarkedAt = new Date(markedAtMs);
      row.updatedAt = dbNow;
      written.push(row.externalId);
    }
  }
  world.marks.push({
    atMs: markedAtMs,
    nodeNames: [...nodeNames],
    written,
  });
}

/*
 * markProxmoxSilentNodesOffline: the fence (setStringIfNotExists, 30 s
 * per cluster and sorted set of nodes — the ingest keys it by a hash of
 * that set), then markNodesNotReporting with markedAt = the worker's now
 * (OneUptimeDate.getCurrentDate()).
 */
function markSilentNodesOffline(
  world: World,
  nodeNames: Array<string>,
  silentBeforeMs: number,
): void {
  const sorted: Array<string> = [...nodeNames].sort();
  const fenceKey: string = `${world.clusterId.toString()}:${sorted.join("\n")}`;
  const fenceExpiresAtMs: number | undefined =
    world.markFenceExpiresAtMs.get(fenceKey);
  if (isKeyPresent(fenceExpiresAtMs ?? null, world.clockMs)) {
    return;
  }
  world.markFenceExpiresAtMs.set(fenceKey, world.clockMs + MARK_FENCE_TTL_MS);
  markNodesNotReporting(world, sorted, silentBeforeMs, world.clockMs);
}

// The clock of every mark UPDATE that wrote this Node row.
function markWritesOf(world: World, externalId: string): Array<number> {
  return world.marks
    .filter((mark: WorldMark): boolean => {
      return mark.written.includes(externalId);
    })
    .map((mark: WorldMark): number => {
      return mark.atMs;
    });
}

// fromMs, then every periodMs after it, up to toMs.
function timesEvery(
  periodMs: number,
  fromMs: number,
  toMs: number,
): Array<number> {
  const times: Array<number> = [];
  for (let atMs: number = fromMs; atMs <= toMs; atMs += periodMs) {
    times.push(atMs);
  }
  return times;
}

/*
 * The re-marks of a node reported on every 30-second step from its first
 * mark at fromMs up to toMs.
 */
function markCadence(fromMs: number, toMs: number): Array<number> {
  return timesEvery(MARK_CADENCE_MS, fromMs, toMs);
}

/*
 * adoptProxmoxNodesAsNativePush: the fence (setStringIfNotExists, 10
 * minutes per cluster), then adoptNodesAsNativePush's UPDATE — SET
 * isNativePush = true (only: notReportingMarkedAt, and updatedAt, are left
 * alone — an adoption marks nothing) WHERE kind = 'Node' AND isNativePush
 * IS DISTINCT FROM true AND lastSeenAt <= seenUpTo.
 */
function adoptNodesAsNativePush(world: World, seenUpToMs: number): void {
  if (isKeyPresent(world.adoptFenceExpiresAtMs, world.clockMs)) {
    return;
  }
  world.adoptFenceExpiresAtMs = world.clockMs + ADOPT_FENCE_TTL_MS;
  const adopted: Array<string> = [];
  for (const row of world.rows) {
    if (
      row.kind === "Node" &&
      row.isNativePush !== true &&
      row.lastSeenAt.getTime() <= seenUpToMs
    ) {
      row.isNativePush = true;
      adopted.push(row.externalId);
    }
  }
  world.adoptions.push({ atMs: world.clockMs, seenUpToMs, adopted });
}

/*
 * One node's batch, from the scan to the flush, processed now and
 * observed at observedAtMs. Only a native push with silent-node detection
 * on records liveness and may report siblings; every native batch adopts
 * (the adoption does not depend on the switch).
 */
function ingestBatch(
  world: World,
  nodeName: string,
  batch: { nativePush: boolean; observedAtMs: number },
): void {
  const decision: ProxmoxSilentNodeDecision | null =
    batch.nativePush && isProxmoxSilentNodeDetectionEnabled()
      ? recordPushAndFindSilentNodes(world, nodeName, batch.observedAtMs)
      : null;
  upsertOwnRows(world, nodeName, {
    isUp: true,
    isNativePush: batch.nativePush,
    observedAtMs: batch.observedAtMs,
  });
  if (batch.nativePush) {
    // A node-status batch always carries the node's own row.
    adoptNodesAsNativePush(world, batch.observedAtMs);
  }
  if (!decision) {
    return;
  }
  world.reports.push({
    atMs: world.clockMs,
    reporter: nodeName,
    silentNodes: [...decision.silentNodes],
    reporterCount: decision.reporterCount,
  });
  if (world.reportedAtMs[world.reportedAtMs.length - 1] !== world.clockMs) {
    world.reportedAtMs.push(world.clockMs);
  }
  markSilentNodesOffline(
    world,
    decision.silentNodes,
    batch.observedAtMs - SILENCE_MS,
  );
}

// A push processed as it arrives, from wherever the batches come from now.
function ingestPush(world: World, nodeName: string): void {
  ingestBatch(world, nodeName, {
    nativePush: world.nativePush,
    observedAtMs: world.clockMs,
  });
}

/*
 * A native push observed at observedAtMs but processed only now — held up
 * in the ingest backlog — whatever the batches come from by then.
 */
function ingestLateNativePush(
  world: World,
  nodeName: string,
  observedAtMs: number,
): void {
  ingestBatch(world, nodeName, { nativePush: true, observedAtMs });
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
      upsertOwnRows(world, nodeName, {
        isUp: false,
        isNativePush: false,
        observedAtMs: world.clockMs,
      });
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

  test("the model's continuation window is the liveness module's own: the monitors' 5 minutes, a whole number of steps, counted from the moment the roster was read — one 30-second roster cache lifetime, one step — and well past the re-mark cadence", () => {
    // The short-outage arithmetic below rests on this.
    expect(PROXMOX_MONITOR_WINDOW_MS).toBe(5 * MINUTE_MS);
    expect(PROXMOX_MONITOR_WINDOW_MS % STEP_MS).toBe(0);
    /*
     * The window carries no slack of its own: a mark's age is taken when
     * the roster was read, and a roster cached at a step is reused, at
     * most, by the pushes of the next — which decide as the push that read
     * it did.
     */
    expect(PROXMOX_ROSTER_CACHE_TTL_MS).toBe(30 * SECOND_MS);
    expect(PROXMOX_ROSTER_CACHE_TTL_MS).toBe(STEP_MS);
    /*
     * The mark fence is one step long and the re-mark cadence (pinned by
     * the next test) a whole number of steps, which leaves three minutes
     * of the window after a node's last re-mark.
     */
    expect(MARK_FENCE_TTL_MS).toBe(STEP_MS);
    expect(MARK_CADENCE_MS % STEP_MS).toBe(0);
    expect(MARK_CADENCE_MS).toBeGreaterThan(MARK_REFRESH_AFTER_MS);
    expect(PROXMOX_MONITOR_WINDOW_MS - MARK_CADENCE_MS).toBe(3 * MINUTE_MS);
  });

  test("its Node row survives every tick as Offline, re-marked every two minutes while reported, while its lastSeenAt never moves", async () => {
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
     * Marked by the first report, then re-marked every two minutes: the
     * mark fence lets one UPDATE through a minute — the first push of
     * that step takes it, its sibling's is fenced — and the UPDATE writes
     * a row already Offline and native only once its mark is more than a
     * minute old. So every other UPDATE writes nothing, and the mark is
     * never older than the cadence when a report reads it.
     */
    expect(
      world.marks.map((mark: WorldMark): number => {
        return mark.atMs;
      }),
    ).toEqual(timesEvery(MINUTE_MS, FIRST_REPORT_MS, world.clockMs));
    expect(markWritesOf(world, "node/pve3")).toEqual(
      markCadence(FIRST_REPORT_MS, world.clockMs),
    );
    for (const mark of world.marks) {
      expect(mark.nodeNames).toEqual(["pve3"]);
      expect(mark.written).toEqual(
        (mark.atMs - FIRST_REPORT_MS) % MARK_CADENCE_MS === 0
          ? ["node/pve3"]
          : [],
      );
    }
    expect(pve3!.notReportingMarkedAt!.getTime()).toBe(
      markWritesOf(world, "node/pve3").pop(),
    );
    expect(world.clockMs - pve3!.notReportingMarkedAt!.getTime()).toBeLessThan(
      MARK_CADENCE_MS,
    );
    expect(world.reportedAtMs[0]).toBe(FIRST_REPORT_MS);
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      world.clockMs,
    );
    // Offline on every tick from the first report on.
    for (const tick of ticks) {
      expect(tick.offline.has("node/pve3")).toBe(tick.atMs >= FIRST_REPORT_MS);
    }
    // Both survivors report it on every push, each counting L = 2 live nodes.
    expect(world.reports).toHaveLength(2 * world.reportedAtMs.length);
    for (const report of world.reports) {
      expect(report.silentNodes).toEqual(["pve3"]);
      expect(report.reporterCount).toBe(2);
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
     * the node's own last push within the first quarter hour — the keep
     * rests on isNativePush and the retention window alone. (The reports
     * re-mark the row, but the mark is notReportingMarkedAt, which the
     * delete never reads.)
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
    // The last cutoff lies an hour and more past that last push.
    expect(pve3.lastSeenAt.getTime()).toBe(NOW.getTime());
    expect(calls[calls.length - 1]!.olderThan.getTime()).toBeGreaterThan(
      NOW.getTime() + 60 * MINUTE_MS,
    );
    // The live nodes' rows ride the push, far inside any cutoff.
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
    }
    // The dead node's guest still goes, sooner under the tighter threshold.
    expect(world.prunedAtMs.get("qemu/103")).toHaveLength(1);
  });

  test("a Node row already Offline and native is only re-marked by the reports — notReportingMarkedAt, never lastSeenAt — and kept all the same", async () => {
    /*
     * pve3 died ten minutes before NOW and was marked then (say, before
     * a worker restart): its key is gone and its row Offline, native and
     * marked.
     */
    const world: World = createWorld();
    const diedAtMs: number = NOW.getTime() - 10 * MINUTE_MS;
    const markedAtMs: number = diedAtMs + SILENCE_MS + STEP_MS;
    world.livenessKeys.delete("pve3");
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    pve3.isUp = false;
    pve3.lastSeenAt = new Date(diedAtMs);
    pve3.updatedAt = new Date(markedAtMs);
    pve3.notReportingMarkedAt = new Date(markedAtMs);
    expect(pve3.isNativePush).toBe(true);
    installWorld(world);

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 2 * 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    /*
     * Reported on every step. The first report finds a mark more than a
     * minute old and re-marks the row; from then on the UPDATE writes it
     * every two minutes — its notReportingMarkedAt alone: it stays
     * Offline and native, and its lastSeenAt never moves.
     */
    const firstReportMs: number = NOW.getTime() + STEP_MS;
    expect(world.reportedAtMs[0]).toBe(firstReportMs);
    expect(world.reportedAtMs).toHaveLength((2 * 60 * MINUTE_MS) / STEP_MS);
    expect(firstReportMs - markedAtMs).toBeGreaterThan(MARK_REFRESH_AFTER_MS);
    expect(markWritesOf(world, "node/pve3")).toEqual(
      markCadence(firstReportMs, world.clockMs),
    );
    expect(pve3.isUp).toBe(false);
    expect(pve3.isNativePush).toBe(true);
    expect(pve3.notReportingMarkedAt!.getTime()).toBe(
      markWritesOf(world, "node/pve3").pop(),
    );
    expect(pve3.lastSeenAt.getTime()).toBe(diedAtMs);
    expect(ticksWhere(ticks, "node/pve3", false)).toEqual([]);
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
  });

  test("a Node row marked Offline before isNativePush and notReportingMarkedAt existed (both NULL) is adopted — made native, left unmarked — by the flush that first reports it, marked by that report, and kept, while its guests seen at the same moment go on the normal cutoff", async () => {
    /*
     * As above, but pve3 was marked Offline before the columns existed —
     * one migration adds both: every row reads NULL for isNativePush, and
     * for the mark too (its updatedAt still shows when it was marked).
     * pve1's and pve2's own pushes make theirs native; only the adoption
     * (or a report) can make pve3's, and it is already Offline.
     */
    const world: World = createWorld({ rowsNativePush: null });
    const diedAtMs: number = NOW.getTime() - 10 * MINUTE_MS;
    const markedAtMs: number = diedAtMs + SILENCE_MS + STEP_MS;
    world.livenessKeys.delete("pve3");
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    pve3.isUp = false;
    pve3.lastSeenAt = new Date(diedAtMs);
    pve3.updatedAt = new Date(markedAtMs);
    expect(pve3.notReportingMarkedAt).toBeNull();
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      rowOf(world, externalId)!.lastSeenAt = new Date(diedAtMs);
    }
    installWorld(world);

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 2 * 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    const firstReportMs: number = NOW.getTime() + STEP_MS;

    /*
     * The first native flush — pve1's, the one that first reports pve3 —
     * adopts the NULL Node rows: isNativePush was not true. The adoption
     * sets that flag alone and leaves pve3 unmarked — so the report in
     * the same flush, finding the row Offline and native but with no
     * mark, marks it. The later reports re-mark it every two minutes from
     * then on — its notReportingMarkedAt alone.
     */
    expect(world.adoptions[0]).toEqual({
      atMs: firstReportMs,
      seenUpToMs: firstReportMs,
      adopted: ["node/pve2", "node/pve3"],
    });
    expect(world.reportedAtMs[0]).toBe(firstReportMs);
    expect(world.reportedAtMs).toHaveLength((2 * 60 * MINUTE_MS) / STEP_MS);
    expect(world.marks[0]).toEqual({
      atMs: firstReportMs,
      nodeNames: ["pve3"],
      written: ["node/pve3"],
    });
    expect(markWritesOf(world, "node/pve3")).toEqual(
      markCadence(firstReportMs, world.clockMs),
    );
    expect(pve3.isUp).toBe(false);
    expect(pve3.isNativePush).toBe(true);
    expect(pve3.notReportingMarkedAt!.getTime()).toBe(
      markWritesOf(world, "node/pve3").pop(),
    );
    expect(pve3.lastSeenAt.getTime()).toBe(diedAtMs);

    /*
     * Its guest and storage, NULL and last seen at the same moment, go on
     * the first tick whose cutoff passes that moment — where the Node row
     * would have gone too, had nothing made it native. (The adoption takes
     * Node rows only.)
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

  test("a node already Offline under the agent when the cluster moves to the native push is adopted by the first native flush, reported, kept, and pruned only after the retention window", async () => {
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
    expect(pve3.updatedAt.getTime()).toBe(lastScrapeMs);
    // Down by the agent's own word, and never marked: a scrape is not a mark.
    expect(pve3.notReportingMarkedAt).toBeNull();

    /*
     * The metric server replaces the agent: pve1 and pve2 push natively
     * from the next step on; pve3, down, pushes nothing, and nothing
     * lists it any more.
     */
    world.nativePush = true;
    const firstStepTicks: Array<TickRecord> = await advance(world, {
      durationMs: STEP_MS,
      pushing: SURVIVORS,
    });
    const adoptedAtMs: number = lastScrapeMs + STEP_MS;
    /*
     * The first native step adopts pve3's row: native now, still Offline,
     * still unmarked, and its updatedAt still the agent's last scrape — an
     * adoption is not a mark.
     */
    expect(
      world.adoptions.map((adoption: WorldAdoption): number => {
        return adoption.atMs;
      }),
    ).toEqual([adoptedAtMs]);
    expect(pve3.isNativePush).toBe(true);
    expect(pve3.isUp).toBe(false);
    expect(pve3.notReportingMarkedAt).toBeNull();
    expect(pve3.updatedAt.getTime()).toBe(lastScrapeMs);
    expect(world.marks).toEqual([]);
    const ticks: Array<TickRecord> = [
      ...firstStepTicks,
      ...(await advance(world, {
        durationMs: RETENTION_MS + 60 * MINUTE_MS - STEP_MS,
        pushing: SURVIVORS,
      })),
    ];
    const firstReportMs: number = lastScrapeMs + STEP_MS + SILENCE_MS;
    const retentionEndMs: number = lastScrapeMs + RETENTION_MS;

    /*
     * The first native flush — pve1's, two minutes before anyone is
     * established — adopts the agent's Node rows it has seen past: pve3's,
     * and pve2's, which pve2's own push in the same step makes native
     * anyway. The fence holds off every later flush for ten minutes, and
     * no later adoption finds anything left to take.
     */
    expect(world.adoptions[0]).toEqual({
      atMs: adoptedAtMs,
      seenUpToMs: adoptedAtMs,
      adopted: ["node/pve2", "node/pve3"],
    });
    expect(world.adoptions[1]!.atMs).toBe(
      adoptedAtMs + ADOPT_FENCE_TTL_MS + STEP_MS,
    );
    for (const adoption of world.adoptions.slice(1)) {
      expect(adoption.adopted).toEqual([]);
    }

    // Reported once pve1 is established, already Offline and native.
    expect(world.reportedAtMs[0]).toBe(firstReportMs);
    expect(pve3.isUp).toBe(false);
    expect(pve3.isNativePush).toBe(true);
    /*
     * Adopted first; the first report, two minutes on, finds the row
     * unmarked — the agent never marks, and the adoption left it so — and
     * marks it, and the reports go on re-marking it every two minutes —
     * its notReportingMarkedAt alone: its lastSeenAt is still the agent's
     * last scrape.
     */
    expect(world.marks[0]).toEqual({
      atMs: firstReportMs,
      nodeNames: ["pve3"],
      written: ["node/pve3"],
    });
    expect(markWritesOf(world, "node/pve3")).toEqual(
      markCadence(firstReportMs, retentionEndMs),
    );
    expect(pve3.notReportingMarkedAt!.getTime()).toBe(
      markWritesOf(world, "node/pve3").pop(),
    );
    expect(pve3.lastSeenAt.getTime()).toBe(lastScrapeMs);

    /*
     * The adoption — and the first report too — land before the first
     * tick whose cutoff passes that last scrape. That tick takes pve3's
     * guest and storage — agent rows scraped at the same moment — and
     * would have taken its Node row too, left isNativePush false, dropping
     * it off the roster while down.
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

  test("a late native batch after the cluster moved back to the agent does not re-adopt the agent rows, so a node the agent stopped listing is pruned at the normal cutoff", async () => {
    const world: World = createWorld();
    installWorld(world);

    // Twenty minutes on the native push, every node pushing.
    await advance(world, { durationMs: 20 * MINUTE_MS, pushing: ALL_NODES });
    const lastNativeMs: number = world.clockMs;
    /*
     * pve1's next native push, observed ten seconds later, as the metric
     * server is being removed, is held up in the ingest backlog.
     */
    const lateObservedAtMs: number = lastNativeMs + 10 * SECOND_MS;

    // The agent takes over and lists every node for ten minutes...
    world.nativePush = false;
    await advance(world, { durationMs: 10 * MINUTE_MS, pushing: ALL_NODES });
    const lastListedMs: number = world.clockMs;
    for (const template of CATALOG) {
      expect(rowOf(world, template.externalId)!.isNativePush).toBe(false);
    }

    // ...then pve3 leaves the cluster: pve-exporter lists pve1 and pve2 only.
    await advance(world, { durationMs: 3 * MINUTE_MS, pushing: SURVIVORS });
    const lateAtMs: number = world.clockMs;

    /*
     * The rows an adoption without its seenUpTo guard would take now:
     * every agent Node row, pve3's among them — kept for a week, with
     * nothing left to report it.
     */
    expect(
      world.rows
        .filter((row: WorldRow): boolean => {
          return row.kind === "Node" && row.isNativePush !== true;
        })
        .map((row: WorldRow): string => {
          return row.externalId;
        })
        .sort(),
    ).toEqual(["node/pve1", "node/pve2", "node/pve3"]);

    // The late batch is processed at last.
    ingestLateNativePush(world, "pve1", lateObservedAtMs);

    /*
     * Its adoption runs — the fence, last taken eleven minutes into the
     * native push, has long expired — and takes nothing: every Node row
     * was last seen after the batch's own observation.
     */
    expect(
      world.adoptions.map((adoption: WorldAdoption): number => {
        return adoption.atMs;
      }),
    ).toEqual([
      NOW.getTime() + STEP_MS,
      NOW.getTime() + 11 * MINUTE_MS,
      lateAtMs,
    ]);
    expect(world.adoptions[2]).toEqual({
      atMs: lateAtMs,
      seenUpToMs: lateObservedAtMs,
      adopted: [],
    });
    expect(rowOf(world, "node/pve3")!.isNativePush).toBe(false);
    expect(rowOf(world, "node/pve3")!.lastSeenAt.getTime()).toBe(lastListedMs);
    // Nor does its bulkUpsert roll pve1's newer agent rows back.
    for (const externalId of ["node/pve1", "qemu/101"]) {
      expect(rowOf(world, externalId)!.isNativePush).toBe(false);
      expect(rowOf(world, externalId)!.lastSeenAt.getTime()).toBe(lateAtMs);
    }
    // And it reports nobody.
    expect(world.reportedAtMs).toEqual([]);

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 60 * MINUTE_MS,
      pushing: SURVIVORS,
    });

    /*
     * pve3's Node row goes on the first tick whose cutoff passes its last
     * listing, together with its guest and storage listed at the same
     * moment — the agent's 15-minute prune.
     */
    const firstPastCutoff: TickRecord | undefined = ticks.find(
      (tick: TickRecord): boolean => {
        return tick.cutoffMs !== null && tick.cutoffMs > lastListedMs;
      },
    );
    expect(firstPastCutoff).toBeDefined();
    const prunedAt: Array<number> | undefined =
      world.prunedAtMs.get("node/pve3");
    expect(prunedAt).toEqual([firstPastCutoff!.atMs]);
    expect(prunedAt![0]!).toBeGreaterThan(lastListedMs + THRESHOLD_MS);
    expect(prunedAt![0]!).toBeLessThanOrEqual(
      lastListedMs + THRESHOLD_MS + HEARTBEAT_FENCE_MS + TICK_MS,
    );
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      expect(world.prunedAtMs.get(externalId)).toEqual(prunedAt);
    }

    // The agent's live rows ride its scrapes, untouched and still its own.
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isNativePush).toBe(false);
    }
    expect(world.reportedAtMs).toEqual([]);
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});

describe("timeline: a OneUptime ingest outage around a native-push node's death", () => {
  test("an Offline row outlives a 20-minute outage and a tick in the 2-minute warm-up after it, though nobody reports it in between", async () => {
    const world: World = createWorld();
    installWorld(world);

    // pve3 dies at NOW and is reported from FIRST_REPORT_MS on.
    await advance(world, { durationMs: 29 * MINUTE_MS, pushing: SURVIVORS });
    const lastReportBeforeMs: number = world.clockMs;
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      lastReportBeforeMs,
    );
    // Re-marked every two minutes since the first report, the last time within the cadence.
    const marksBefore: Array<number> = markCadence(
      FIRST_REPORT_MS,
      lastReportBeforeMs,
    );
    expect(markWritesOf(world, "node/pve3")).toEqual(marksBefore);
    const lastMarkBeforeMs: number = marksBefore[marksBefore.length - 1]!;
    expect(rowOf(world, "node/pve3")!.notReportingMarkedAt!.getTime()).toBe(
      lastMarkBeforeMs,
    );
    expect(lastReportBeforeMs - lastMarkBeforeMs).toBeLessThan(MARK_CADENCE_MS);

    // OneUptime processes nothing for 20 minutes: no push, no heartbeat, no report.
    const outageTicks: Array<TickRecord> = await advance(world, {
      durationMs: 20 * MINUTE_MS,
      pushing: [],
    });
    const outageEndMs: number = world.clockMs;
    // ...and no mark: the row still carries the last one from before.
    expect(rowOf(world, "node/pve3")!.notReportingMarkedAt!.getTime()).toBe(
      lastMarkBeforeMs,
    );

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
     * minutes after the resume, and the outage outlasted the monitors'
     * 5-minute window — the row's last mark was older than that when the
     * roster was read — so no report of the Offline node continued
     * through it either: nobody had reported the node since before the
     * outage.
     */
    expect(resumedAtMs - lastMarkBeforeMs).toBeGreaterThan(
      PROXMOX_MONITOR_WINDOW_MS,
    );
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

    /*
     * Reported again, to the end, once its siblings are re-established —
     * and re-marked from that first report back on.
     */
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      world.clockMs,
    );
    expect(markWritesOf(world, "node/pve3")).toEqual([
      ...marksBefore,
      ...markCadence(reportsSince[0]!, world.clockMs),
    ]);
    expect(pve3.notReportingMarkedAt!.getTime()).toBe(
      markWritesOf(world, "node/pve3").pop(),
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
    expect(markWritesOf(world, "node/pve3")[0]!).toBeGreaterThan(
      warmUpTick.atMs,
    );
    // Its guest and storage are not kept: they go on this very tick.
    for (const externalId of PVE3_GUEST_AND_STORAGE) {
      expect(world.prunedAtMs.get(externalId)).toEqual([warmUpTick.atMs]);
    }

    /*
     * Once pve1 has pushed for two minutes it reports pve3, which turns
     * Offline — marked by that first report, re-marked every two minutes
     * after it.
     */
    expect(world.reportedAtMs[0]).toBe(establishedAtMs);
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    expect(markWritesOf(world, "node/pve3")).toEqual(
      markCadence(establishedAtMs, world.clockMs),
    );
    expect(pve3.notReportingMarkedAt!.getTime()).toBe(
      markWritesOf(world, "node/pve3").pop(),
    );
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

    /*
     * pve3 is reported — and re-marked every two minutes — for all but the
     * last 16 minutes of its window...
     */
    await advance(world, {
      durationMs: RETENTION_MS - 16 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(world.clockMs - pve3.notReportingMarkedAt!.getTime()).toBeLessThan(
      MARK_CADENCE_MS,
    );
    expect(pve3.lastSeenAt.getTime()).toBe(NOW.getTime());

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

  /*
   * pve3 dies at NOW and is reported, and marked, from FIRST_REPORT_MS on;
   * 29 minutes in, OneUptime stops processing for `outageMs`. The marks
   * are checked on the workers' clock, whatever the database's.
   */
  interface OutageSetup {
    world: World;
    lastReportBeforeMs: number;
    // The row's last mark before the outage: what a report reads after it.
    lastMarkBeforeMs: number;
    outageTicks: Array<TickRecord>;
    // The first step after the outage.
    resumedAtMs: number;
  }

  async function offlineNodeThroughOutage(
    outageMs: number,
    options?: WorldOptions,
  ): Promise<OutageSetup> {
    const world: World = createWorld(options);
    installWorld(world);
    await advance(world, { durationMs: 29 * MINUTE_MS, pushing: SURVIVORS });
    const lastReportBeforeMs: number = world.clockMs;
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      lastReportBeforeMs,
    );
    expect(rowOf(world, "node/pve3")!.isUp).toBe(false);
    // Re-marked every two minutes: the last time half a minute before the outage.
    const marksBefore: Array<number> = markCadence(
      FIRST_REPORT_MS,
      lastReportBeforeMs,
    );
    expect(markWritesOf(world, "node/pve3")).toEqual(marksBefore);
    const lastMarkBeforeMs: number = marksBefore[marksBefore.length - 1]!;
    expect(lastMarkBeforeMs).toBe(lastReportBeforeMs - STEP_MS);

    const outageTicks: Array<TickRecord> = await advance(world, {
      durationMs: outageMs,
      pushing: [],
    });
    const resumedAtMs: number = world.clockMs + STEP_MS;
    // Longer than the silence window: every liveness key has expired.
    for (const nodeName of ALL_NODES) {
      expect(readLiveness(world, nodeName, resumedAtMs)).toBeNull();
    }
    // Nothing re-marked the row during the outage.
    expect(rowOf(world, "node/pve3")!.notReportingMarkedAt!.getTime()).toBe(
      lastMarkBeforeMs,
    );
    return {
      world,
      lastReportBeforeMs,
      lastMarkBeforeMs,
      outageTicks,
      resumedAtMs,
    };
  }

  test("an Offline row through a 3-minute outage — its last mark still inside the monitors' 5-minute window — is reported again by the very first push after it, before anyone is established, each report counting the sibling not yet back as live", async () => {
    const {
      world,
      lastReportBeforeMs,
      lastMarkBeforeMs,
      outageTicks,
      resumedAtMs,
    }: OutageSetup = await offlineNodeThroughOutage(3 * MINUTE_MS);
    // The row's last mark, from before the outage, is still within the window.
    expect(resumedAtMs - lastMarkBeforeMs).toBeLessThanOrEqual(
      PROXMOX_MONITOR_WINDOW_MS,
    );

    const resumeTicks: Array<TickRecord> = await advance(world, {
      durationMs: 30 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    const establishedAtMs: number = resumedAtMs + SILENCE_MS;

    /*
     * The first push processed afterwards — pve1's, with pve2's own still
     * to come and its key gone — already reports pve3, which was Offline
     * before the gap, two minutes before anyone is established. pve2,
     * silent by its row too but never reported Offline, is held back and
     * counted with pve1 as live: L = 2, not 1, so Quorum at Risk reads
     * 2 of 3 up, as before the gap.
     */
    const reportsSince: Array<number> = reportsAfter(world, lastReportBeforeMs);
    expect(reportsSince[0]).toBe(resumedAtMs);
    expect(reportsSince[0]!).toBeLessThan(establishedAtMs);
    const firstReportBack: WorldReport | undefined = world.reports.find(
      (report: WorldReport): boolean => {
        return report.atMs > lastReportBeforeMs;
      },
    );
    expect(firstReportBack).toEqual({
      atMs: resumedAtMs,
      reporter: "pve1",
      silentNodes: ["pve3"],
      reporterCount: 2,
    });

    // Every step from then on reports it — no gap in the reports...
    expect(reportsSince).toHaveLength((30 * MINUTE_MS) / STEP_MS);
    for (const report of world.reports) {
      expect(report.silentNodes).toEqual(["pve3"]);
      expect(report.reporterCount).toBe(2);
    }

    /*
     * ...and the row is kept, Offline, on every tick. The first report
     * back re-marks it at once — its mark was more than a minute old, and
     * the fence had long expired — and the reports keep re-marking it
     * every two minutes, through the warm-up too: the continuation keeps
     * its own mark fresh.
     */
    for (const tick of [...outageTicks, ...resumeTicks]) {
      expect(tick.clusterStatus).toBe("connected");
      expect(tick.present.has("node/pve3")).toBe(true);
      expect(tick.offline.has("node/pve3")).toBe(true);
    }
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(markWritesOf(world, "node/pve3")).toEqual([
      ...markCadence(FIRST_REPORT_MS, lastMarkBeforeMs),
      ...markCadence(resumedAtMs, world.clockMs),
    ]);
    expect(pve3.notReportingMarkedAt!.getTime()).toBe(
      markWritesOf(world, "node/pve3").pop(),
    );
    expect(pve3.lastSeenAt.getTime()).toBe(NOW.getTime());
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isUp).toBe(true);
    }
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a node that came back during a 6-minute outage — its last mark past the monitors' window — is not reported by the siblings processed just ahead of its own first push", async () => {
    const {
      world,
      lastReportBeforeMs,
      lastMarkBeforeMs,
      outageTicks,
      resumedAtMs,
    }: OutageSetup = await offlineNodeThroughOutage(6 * MINUTE_MS);
    // The row's last mark aged out of the window during the outage.
    expect(resumedAtMs - lastMarkBeforeMs).toBeGreaterThan(
      PROXMOX_MONITOR_WINDOW_MS,
    );

    /*
     * pve3 is back: all three push again, pve1's and pve2's processed ahead
     * of pve3's in every step. Its row still reads Offline, and it is
     * silent by that row, when pve1's first push is processed.
     */
    const resumeTicks: Array<TickRecord> = await advance(world, {
      durationMs: 30 * MINUTE_MS,
      pushing: ALL_NODES,
    });

    // Nobody reports it: no continuation after the window, and it is back.
    expect(reportsAfter(world, lastReportBeforeMs)).toEqual([]);
    expect(markWritesOf(world, "node/pve3")).toEqual(
      markCadence(FIRST_REPORT_MS, lastMarkBeforeMs),
    );
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(true);
    expect(pve3.isNativePush).toBe(true);
    expect(pve3.lastSeenAt.getTime()).toBe(world.clockMs);
    // Its own first push cleared the mark.
    expect(pve3.notReportingMarkedAt).toBeNull();

    // Kept throughout: Offline until its own first push, Online after.
    for (const tick of outageTicks) {
      expect(tick.clusterStatus).toBe("connected");
      expect(tick.present.has("node/pve3")).toBe(true);
      expect(tick.offline.has("node/pve3")).toBe(true);
    }
    for (const tick of resumeTicks) {
      expect(tick.clusterStatus).toBe("connected");
      expect(tick.present.size).toBe(CATALOG.length);
      expect(tick.offline.size).toBe(0);
    }
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
  });

  test("the window counts from the row's last mark, not from the last report: after a 4-minute outage the first push reports the Offline node, after 4.5 minutes — the last report exactly 5 minutes old, the mark half a minute more — it waits for an established node", async () => {
    /*
     * The last report before the outage is half a minute after the last
     * mark. A 4-minute outage resumes exactly one monitors' window after
     * that mark — still inside it; a 4.5-minute one exactly one monitors'
     * window after that last report, but half a minute past the window of
     * the mark; a 5-minute one past both.
     */
    interface OutageCase {
      outageMs: number;
      // How old the row's last mark is when the pushes resume.
      markAgeAtResumeMs: number;
      // How old the last report before the outage is then.
      lastReportAgeAtResumeMs: number;
      // When the first report back lands, after the resume.
      firstReportBackAfterMs: number;
    }
    const cases: Array<OutageCase> = [
      {
        outageMs: 4 * MINUTE_MS,
        markAgeAtResumeMs: PROXMOX_MONITOR_WINDOW_MS,
        lastReportAgeAtResumeMs: PROXMOX_MONITOR_WINDOW_MS - STEP_MS,
        firstReportBackAfterMs: 0,
      },
      {
        outageMs: 4 * MINUTE_MS + STEP_MS,
        markAgeAtResumeMs: PROXMOX_MONITOR_WINDOW_MS + STEP_MS,
        lastReportAgeAtResumeMs: PROXMOX_MONITOR_WINDOW_MS,
        firstReportBackAfterMs: SILENCE_MS,
      },
      {
        outageMs: 5 * MINUTE_MS,
        markAgeAtResumeMs: PROXMOX_MONITOR_WINDOW_MS + 2 * STEP_MS,
        lastReportAgeAtResumeMs: PROXMOX_MONITOR_WINDOW_MS + STEP_MS,
        firstReportBackAfterMs: SILENCE_MS,
      },
    ];
    for (const outageCase of cases) {
      const {
        world,
        lastReportBeforeMs,
        lastMarkBeforeMs,
        outageTicks,
        resumedAtMs,
      }: OutageSetup = await offlineNodeThroughOutage(outageCase.outageMs);
      expect(resumedAtMs - lastReportBeforeMs).toBe(
        outageCase.lastReportAgeAtResumeMs,
      );
      expect(resumedAtMs - lastMarkBeforeMs).toBe(outageCase.markAgeAtResumeMs);
      // No roster cache here: each push reads the roster, at its own time.
      expect(world.rosterCacheTtlMs).toBe(0);

      const resumeTicks: Array<TickRecord> = await advance(world, {
        durationMs: 10 * MINUTE_MS,
        pushing: SURVIVORS,
      });

      /*
       * Reported from the first push back (a continuation), or only once
       * pve1 has pushed for two minutes; then on every step to the end,
       * and re-marked from that first report back on.
       */
      const firstReportBackMs: number =
        resumedAtMs + outageCase.firstReportBackAfterMs;
      expect(reportsAfter(world, lastReportBeforeMs)).toEqual(
        timesEvery(STEP_MS, firstReportBackMs, world.clockMs),
      );
      expect(markWritesOf(world, "node/pve3")).toEqual([
        ...markCadence(FIRST_REPORT_MS, lastMarkBeforeMs),
        ...markCadence(firstReportBackMs, world.clockMs),
      ]);
      for (const report of world.reports) {
        expect(report.silentNodes).toEqual(["pve3"]);
        expect(report.reporterCount).toBe(2);
      }

      // Kept, and Offline, on every tick either way.
      for (const tick of [...outageTicks, ...resumeTicks]) {
        expect(tick.present.has("node/pve3")).toBe(true);
        expect(tick.offline.has("node/pve3")).toBe(true);
      }
      expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    }
  });

  test("through the ingest's 30-second roster cache: after a 4-minute outage the pushes of the step after the first report back decide on the roster it read, judged at the moment it was read — so they still report the Offline node, though their own clock is by then half a minute past the mark's window", async () => {
    const {
      world,
      lastReportBeforeMs,
      lastMarkBeforeMs,
      outageTicks,
      resumedAtMs,
    }: OutageSetup = await offlineNodeThroughOutage(4 * MINUTE_MS, {
      rosterCacheTtlMs: PROXMOX_ROSTER_CACHE_TTL_MS,
    });
    // The first push back finds the mark exactly one monitors' window old...
    expect(resumedAtMs - lastMarkBeforeMs).toBe(PROXMOX_MONITOR_WINDOW_MS);
    // ...on a roster read afresh: the cache entry expired in the outage.
    expect(world.rosterCache).not.toBeNull();
    expect(world.rosterCache!.expiresAtMs).toBeLessThan(resumedAtMs);
    const readsBefore: number = world.rosterReadsAtMs.length;

    // The first two steps back: pve1's and pve2's pushes in each.
    const firstTicks: Array<TickRecord> = await advance(world, {
      durationMs: 2 * STEP_MS,
      pushing: SURVIVORS,
    });
    const nextStepMs: number = resumedAtMs + STEP_MS;
    expect(world.clockMs).toBe(nextStepMs);

    /*
     * pve1's first push back reads the roster, reports pve3 as a
     * continuation and re-marks its row. Every push up to the cache
     * entry's expiry — pve2's in that step, both of the next — decides on
     * that same roster, which still shows the mark from before the outage,
     * and on the moment it was read: the mark's age is one monitors'
     * window for each of them, though the next step's clock is half a
     * minute past it. Nobody is established yet.
     */
    expect(world.rosterReadsAtMs.slice(readsBefore)).toEqual([resumedAtMs]);
    const cached: WorldCachedRoster = world.rosterCache!;
    expect(cached.readAtMs).toBe(resumedAtMs);
    expect(cached.expiresAtMs).toBe(nextStepMs);
    expect(
      cached.roster
        .find((node: ProxmoxRosterNode): boolean => {
          return node.nodeName === "pve3";
        })!
        .notReportingMarkedAt!.getTime(),
    ).toBe(lastMarkBeforeMs);
    expect(nextStepMs - lastMarkBeforeMs).toBe(
      PROXMOX_MONITOR_WINDOW_MS + STEP_MS,
    );
    const liveness: Map<string, ProxmoxNodeLiveness | null> = new Map<
      string,
      ProxmoxNodeLiveness | null
    >();
    for (const nodeName of ALL_NODES) {
      liveness.set(nodeName, readLiveness(world, nodeName));
    }
    for (const nodeName of SURVIVORS) {
      expect(
        isEligibleProxmoxReporter(liveness.get(nodeName) || null, nextStepMs),
      ).toBe(false);
    }
    expect(
      world.reports.filter((report: WorldReport): boolean => {
        return report.atMs === nextStepMs;
      }),
    ).toEqual([
      {
        atMs: nextStepMs,
        reporter: "pve1",
        silentNodes: ["pve3"],
        reporterCount: 2,
      },
      {
        atMs: nextStepMs,
        reporter: "pve2",
        silentNodes: ["pve3"],
        reporterCount: 2,
      },
    ]);
    /*
     * Judged at their own time instead, those pushes would have dropped
     * the report — a step after one that re-marked the row — until the
     * next fresh read brought it back: the hole the read time closes.
     */
    expect(
      decideProxmoxSilentNodes({
        selfNode: "pve1",
        reporterTimeMs: nextStepMs,
        nowMs: nextStepMs,
        roster: cached.roster,
        liveness,
      }),
    ).toBeNull();
    expect(
      decideProxmoxSilentNodes({
        selfNode: "pve1",
        reporterTimeMs: nextStepMs,
        nowMs: nextStepMs,
        roster: cached.roster,
        liveness,
        rosterReadAtMs: cached.readAtMs,
      }),
    ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });

    const resumeTicks: Array<TickRecord> = [
      ...firstTicks,
      ...(await advance(world, {
        durationMs: 10 * MINUTE_MS - 2 * STEP_MS,
        pushing: SURVIVORS,
      })),
    ];

    /*
     * The roster is read afresh every other step from then on, and shows
     * the reports' own fresh marks.
     */
    expect(world.rosterReadsAtMs.slice(readsBefore)).toEqual(
      timesEvery(MINUTE_MS, resumedAtMs, world.clockMs),
    );

    // So no step after the outage goes without a report...
    expect(reportsAfter(world, lastReportBeforeMs)).toEqual(
      timesEvery(STEP_MS, resumedAtMs, world.clockMs),
    );
    for (const report of world.reports) {
      expect(report.silentNodes).toEqual(["pve3"]);
      expect(report.reporterCount).toBe(2);
    }
    // ...the marks run on from the first report back...
    expect(markWritesOf(world, "node/pve3")).toEqual([
      ...markCadence(FIRST_REPORT_MS, lastMarkBeforeMs),
      ...markCadence(resumedAtMs, world.clockMs),
    ]);
    // ...and the row is kept, Offline, on every tick.
    for (const tick of [...outageTicks, ...resumeTicks]) {
      expect(tick.present.has("node/pve3")).toBe(true);
      expect(tick.offline.has("node/pve3")).toBe(true);
    }
    expect(world.prunedAtMs.has("node/pve3")).toBe(false);
  });

  test("the marks are written and judged on the ingest workers' clock, whatever the database's: 10 minutes ahead, a node back after a 6-minute outage is not reported; 10 minutes behind, an Offline row through a 3-minute outage is, from the first push back", async () => {
    interface SkewCase {
      // The database's now() against the workers' clock.
      dbClockAheadMs: number;
      outageMs: number;
      // Who pushes after the outage (pve3 too: it came back).
      pushing: Array<string>;
      // When the first report back lands, after the resume; null: never.
      firstReportBackAfterMs: number | null;
    }
    const cases: Array<SkewCase> = [
      {
        dbClockAheadMs: 10 * MINUTE_MS,
        outageMs: 6 * MINUTE_MS,
        pushing: ALL_NODES,
        firstReportBackAfterMs: null,
      },
      {
        dbClockAheadMs: -10 * MINUTE_MS,
        outageMs: 3 * MINUTE_MS,
        pushing: SURVIVORS,
        firstReportBackAfterMs: 0,
      },
    ];
    for (const skewCase of cases) {
      /*
       * The helper already found pve3 marked every two minutes on the
       * workers' clock, its row's notReportingMarkedAt the last of those
       * marks.
       */
      const {
        world,
        lastReportBeforeMs,
        lastMarkBeforeMs,
        resumedAtMs,
      }: OutageSetup = await offlineNodeThroughOutage(skewCase.outageMs, {
        dbClockAheadMs: skewCase.dbClockAheadMs,
      });
      /*
       * Every updatedAt carries the database's clock — the one bulkUpsert
       * writes on pve1's row, and the one the mark's own UPDATE writes on
       * pve3's, beside the mark...
       */
      expect(rowOf(world, "node/pve1")!.updatedAt.getTime()).toBe(
        lastReportBeforeMs + skewCase.dbClockAheadMs,
      );
      const pve3Before: WorldRow = rowOf(world, "node/pve3")!;
      expect(pve3Before.updatedAt.getTime()).toBe(
        lastMarkBeforeMs + skewCase.dbClockAheadMs,
      );
      /*
       * ...which would put the mark on the other side of the monitors'
       * window, had it been taken from updatedAt.
       */
      const markAgeAtResumeMs: number =
        resumedAtMs - pve3Before.notReportingMarkedAt!.getTime();
      expect(markAgeAtResumeMs).toBe(resumedAtMs - lastMarkBeforeMs);
      const dbMarkAgeAtResumeMs: number =
        resumedAtMs - pve3Before.updatedAt.getTime();
      if (skewCase.firstReportBackAfterMs === null) {
        expect(markAgeAtResumeMs).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
        expect(dbMarkAgeAtResumeMs).toBeLessThanOrEqual(
          PROXMOX_MONITOR_WINDOW_MS,
        );
      } else {
        expect(markAgeAtResumeMs).toBeLessThanOrEqual(
          PROXMOX_MONITOR_WINDOW_MS,
        );
        expect(dbMarkAgeAtResumeMs).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);
      }

      await advance(world, {
        durationMs: 10 * MINUTE_MS,
        pushing: skewCase.pushing,
      });

      const pve3: WorldRow = rowOf(world, "node/pve3")!;
      if (skewCase.firstReportBackAfterMs === null) {
        /*
         * The mark aged out on the workers' clock: pve1's and pve2's first
         * pushes back, processed ahead of pve3's, do not report it.
         */
        expect(reportsAfter(world, lastReportBeforeMs)).toEqual([]);
        expect(markWritesOf(world, "node/pve3")).toEqual(
          markCadence(FIRST_REPORT_MS, lastMarkBeforeMs),
        );
        expect(pve3.isUp).toBe(true);
        expect(pve3.notReportingMarkedAt).toBeNull();
      } else {
        /*
         * The mark is fresh on the workers' clock: the first push back
         * reports pve3, and the reports re-mark it on that clock.
         */
        const firstReportBackMs: number =
          resumedAtMs + skewCase.firstReportBackAfterMs;
        expect(reportsAfter(world, lastReportBeforeMs)).toEqual(
          timesEvery(STEP_MS, firstReportBackMs, world.clockMs),
        );
        expect(markWritesOf(world, "node/pve3")).toEqual([
          ...markCadence(FIRST_REPORT_MS, lastMarkBeforeMs),
          ...markCadence(firstReportBackMs, world.clockMs),
        ]);
        expect(pve3.isUp).toBe(false);
        const lastMarkMs: number = markWritesOf(world, "node/pve3").pop()!;
        expect(pve3.notReportingMarkedAt!.getTime()).toBe(lastMarkMs);
        expect(pve3.updatedAt.getTime()).toBe(
          lastMarkMs + skewCase.dbClockAheadMs,
        );
      }
      expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    }
  });
});

describe("timeline: an Offline node's reports carry on through a gap on its row's own mark", () => {
  test("a Redis failover that loses every key does not interrupt them: the first push after it still reports the Offline node, the mark being in Postgres", async () => {
    const world: World = createWorld();
    installWorld(world);

    // pve3 dies at NOW and is reported, and re-marked, for ten minutes.
    await advance(world, { durationMs: 10 * MINUTE_MS, pushing: SURVIVORS });
    const lostAtMs: number = world.clockMs;
    const marksBefore: Array<number> = markCadence(FIRST_REPORT_MS, lostAtMs);
    expect(markWritesOf(world, "node/pve3")).toEqual(marksBefore);

    // Redis fails over and comes back empty; the inventory is untouched.
    loseRedisKeys(world);
    for (const nodeName of ALL_NODES) {
      expect(readLiveness(world, nodeName)).toBeNull();
    }
    expect(rowOf(world, "node/pve3")!.notReportingMarkedAt!.getTime()).toBe(
      marksBefore[marksBefore.length - 1],
    );

    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 20 * MINUTE_MS,
      pushing: SURVIVORS,
    });
    const nextStepMs: number = lostAtMs + STEP_MS;

    /*
     * The first push after the failover — pve1's, a new streak, with
     * pve2's key gone too — is two minutes from being established, and
     * still reports pve3: Offline, marked two minutes before. It counts
     * pve2 as live (L = 2), so Quorum at Risk holds too. No step of the
     * whole timeline goes without a report.
     */
    const firstReportAfter: WorldReport | undefined = world.reports.find(
      (report: WorldReport): boolean => {
        return report.atMs > lostAtMs;
      },
    );
    expect(firstReportAfter).toEqual({
      atMs: nextStepMs,
      reporter: "pve1",
      silentNodes: ["pve3"],
      reporterCount: 2,
    });
    expect(world.reportedAtMs).toEqual(
      timesEvery(STEP_MS, FIRST_REPORT_MS, world.clockMs),
    );
    for (const report of world.reports) {
      expect(report.silentNodes).toEqual(["pve3"]);
      expect(report.reporterCount).toBe(2);
    }

    /*
     * The mark fence went with Redis: that first report re-marks the row
     * at once (its mark was more than a minute old), and the cadence
     * resumes from there.
     */
    expect(markWritesOf(world, "node/pve3")).toEqual([
      ...marksBefore,
      ...markCadence(nextStepMs, world.clockMs),
    ]);

    // Kept, and Offline, on every tick; the live nodes untouched.
    for (const tick of ticks) {
      expect(tick.present.has("node/pve3")).toBe(true);
      expect(tick.offline.has("node/pve3")).toBe(true);
    }
    for (const externalId of SURVIVOR_ROWS) {
      expect(world.prunedAtMs.has(externalId)).toBe(false);
      expect(rowOf(world, externalId)!.isUp).toBe(true);
    }
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("a lone survivor whose pushes are processed only every 3 minutes — never established again — keeps reporting both dead siblings: each report re-marks them", async () => {
    const world: World = createWorld();
    installWorld(world);

    // pve2 and pve3 die at NOW; pve1 pushes on alone, every step, for ten minutes.
    await advance(world, { durationMs: 10 * MINUTE_MS, pushing: ["pve1"] });
    const burstsFromMs: number = world.clockMs;
    expect(world.reportedAtMs).toEqual(
      timesEvery(STEP_MS, FIRST_REPORT_MS, burstsFromMs),
    );
    for (const externalId of ["node/pve2", "node/pve3"]) {
      expect(markWritesOf(world, externalId)).toEqual(
        markCadence(FIRST_REPORT_MS, burstsFromMs),
      );
    }

    /*
     * From then on its pushes are processed only every three minutes: its
     * key has expired by each one, so each starts a new streak and pve1
     * is never established again.
     */
    const burstMs: number = 3 * MINUTE_MS;
    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 60 * MINUTE_MS,
      stepMs: burstMs,
      pushing: ["pve1"],
    });
    expect(burstMs).toBeGreaterThan(LIVENESS_KEY_TTL_MS);

    /*
     * Every one of those pushes still reports both: each finds their rows
     * Offline and marked at most three minutes before — by the report
     * before it, which re-marked them (a mark more than a minute old,
     * behind an expired fence). L = 1: pve1 alone speaks for the cluster.
     */
    const pushesMs: Array<number> = timesEvery(
      burstMs,
      burstsFromMs + burstMs,
      world.clockMs,
    );
    expect(reportsAfter(world, burstsFromMs)).toEqual(pushesMs);
    for (const report of world.reports) {
      expect(report.reporter).toBe("pve1");
      expect(report.silentNodes).toEqual(["pve2", "pve3"]);
      expect(report.reporterCount).toBe(1);
    }
    for (const externalId of ["node/pve2", "node/pve3"]) {
      expect(markWritesOf(world, externalId)).toEqual([
        ...markCadence(FIRST_REPORT_MS, burstsFromMs),
        ...pushesMs,
      ]);
      expect(rowOf(world, externalId)!.lastSeenAt.getTime()).toBe(
        NOW.getTime(),
      );
    }

    // Both kept, and Offline, on every tick; the survivor untouched.
    for (const tick of ticks) {
      expect(tick.clusterStatus).toBe("connected");
      expect(tick.present.has("node/pve2")).toBe(true);
      expect(tick.present.has("node/pve3")).toBe(true);
      expect(tick.offline.has("node/pve2")).toBe(true);
      expect(tick.offline.has("node/pve3")).toBe(true);
    }
    expect(world.prunedAtMs.has("node/pve1")).toBe(false);
    expect(rowOf(world, "node/pve1")!.isUp).toBe(true);
  });

  test("an adoption is not a mark: a row Offline for half an hour, and never marked, when the first native flush adopts it is not reported by the siblings processed ahead of its own first push — pve3 came back during the switch", async () => {
    interface AdoptionCase {
      name: string;
      // The world just before the first native step, pve3's row Offline.
      setUp: () => Promise<World>;
    }
    const cases: Array<AdoptionCase> = [
      {
        /*
         * Every row from before isNativePush and notReportingMarkedAt
         * existed (both NULL), pve3's turned Offline 30 minutes ago;
         * nobody has a liveness key yet.
         */
        name: "rows from before the columns",
        setUp: (): Promise<World> => {
          const world: World = createWorld({ rowsNativePush: null });
          world.livenessKeys.clear();
          const pve3: WorldRow = rowOf(world, "node/pve3")!;
          pve3.isUp = false;
          pve3.lastSeenAt = new Date(
            NOW.getTime() - 30 * MINUTE_MS - SILENCE_MS - STEP_MS,
          );
          pve3.updatedAt = new Date(NOW.getTime() - 30 * MINUTE_MS);
          installWorld(world);
          return Promise.resolve(world);
        },
      },
      {
        /*
         * The agent listed pve3 as down for ten minutes, then was removed;
         * the metric server's pushes start 30 minutes later.
         */
        name: "the agent's rows, after a 30-minute gap in the switch",
        setUp: async (): Promise<World> => {
          const world: World = createWorld({ nativePush: false });
          for (const row of world.rows) {
            if (row.nodeName === "pve3") {
              row.isUp = false;
            }
          }
          installWorld(world);
          await advance(world, {
            durationMs: 10 * MINUTE_MS,
            pushing: SURVIVORS,
            listedDown: ["pve3"],
          });
          await advance(world, { durationMs: 30 * MINUTE_MS, pushing: [] });
          world.nativePush = true;
          return world;
        },
      },
    ];

    for (const adoptionCase of cases) {
      const world: World = await adoptionCase.setUp();
      const pve3: WorldRow = rowOf(world, "node/pve3")!;
      expect(pve3.isUp).toBe(false);
      expect(pve3.isNativePush).not.toBe(true);
      // Offline, but never marked: nothing reported it as not reporting.
      expect(pve3.notReportingMarkedAt).toBeNull();
      const updatedAtBeforeMs: number = pve3.updatedAt.getTime();
      expect(world.adoptions).toEqual([]);
      for (const nodeName of ALL_NODES) {
        expect(readLiveness(world, nodeName)).toBeNull();
      }

      /*
       * The first native step, driven push by push (off the cron's
       * boundaries): all three push, pve3's processed last.
       */
      world.clockMs += STEP_MS;
      const firstStepMs: number = world.clockMs;
      expect(firstStepMs % TICK_MS).not.toBe(0);
      expect(firstStepMs - updatedAtBeforeMs).toBeGreaterThan(
        PROXMOX_MONITOR_WINDOW_MS,
      );

      /*
       * pve1's flush adopts the Node rows not yet native — pve3's
       * included — and leaves pve3 unmarked, its updatedAt as it was.
       */
      ingestPush(world, "pve1");
      expect(world.adoptions).toEqual([
        {
          atMs: firstStepMs,
          seenUpToMs: firstStepMs,
          adopted: ["node/pve2", "node/pve3"],
        },
      ]);
      expect(pve3.isNativePush).toBe(true);
      expect(pve3.isUp).toBe(false);
      expect(pve3.notReportingMarkedAt).toBeNull();
      expect(pve3.updatedAt.getTime()).toBe(updatedAtBeforeMs);

      /*
       * pve2's push finds pve3 silent by its row, Offline and native, and
       * nobody established: only a mark within the monitors' window would
       * carry a report, and the row carries none.
       */
      ingestPush(world, "pve2");
      expect(world.reports).toEqual([]);
      /*
       * The very same decision, on a roster whose pve3 mark read the
       * adoption's time, would have reported it.
       */
      const stampedRoster: Array<ProxmoxRosterNode> = nodeRoster(world).map(
        (node: ProxmoxRosterNode): ProxmoxRosterNode => {
          return node.nodeName === "pve3"
            ? { ...node, notReportingMarkedAt: new Date(firstStepMs) }
            : node;
        },
      );
      const liveness: Map<string, ProxmoxNodeLiveness | null> = new Map<
        string,
        ProxmoxNodeLiveness | null
      >();
      for (const nodeName of ALL_NODES) {
        liveness.set(nodeName, readLiveness(world, nodeName));
      }
      expect(
        decideProxmoxSilentNodes({
          selfNode: "pve2",
          reporterTimeMs: firstStepMs,
          nowMs: firstStepMs,
          roster: stampedRoster,
          liveness,
        }),
      ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });

      // pve3's own push brings its row back.
      ingestPush(world, "pve3");
      expect(pve3.isUp).toBe(true);
      expect(pve3.lastSeenAt.getTime()).toBe(firstStepMs);

      // Nor is it reported later: the half hour on, pve3 always last.
      const ticks: Array<TickRecord> = await advance(world, {
        durationMs: 30 * MINUTE_MS,
        pushing: ALL_NODES,
      });
      expect(world.reports).toEqual([]);
      expect(world.marks).toEqual([]);
      expect(ticks.length).toBeGreaterThan(0);
      for (const tick of ticks) {
        expect(tick.clusterStatus).toBe("connected");
        expect(tick.present.size).toBe(CATALOG.length);
        expect(tick.offline.size).toBe(0);
      }
      for (const nodeName of ALL_NODES) {
        expect(rowOf(world, `node/${nodeName}`)!.isNativePush).toBe(true);
      }
      expect(world.prunedAtMs.has("node/pve3")).toBe(false);
    }
  });

  test("nor is an agent scrape on a database clock that runs ahead: 10 minutes ahead, the Offline row pve-exporter wrote 6 minutes before the switch reads as written in the future, yet the siblings processed ahead of pve3's own first push do not report it — no continuation without a mark", async () => {
    const dbClockAheadMs: number = 10 * MINUTE_MS;
    const world: World = createWorld({ nativePush: false, dbClockAheadMs });
    for (const row of world.rows) {
      if (row.nodeName === "pve3") {
        row.isUp = false;
      }
    }
    installWorld(world);

    // pve-exporter lists pve3 as down for ten minutes...
    await advance(world, {
      durationMs: 10 * MINUTE_MS,
      pushing: SURVIVORS,
      listedDown: ["pve3"],
    });
    const lastScrapeMs: number = world.clockMs;
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    expect(pve3.isNativePush).toBe(false);
    expect(pve3.lastSeenAt.getTime()).toBe(lastScrapeMs);
    // ...its row written on the database's clock, and never marked.
    expect(pve3.updatedAt.getTime()).toBe(lastScrapeMs + dbClockAheadMs);
    expect(pve3.notReportingMarkedAt).toBeNull();

    /*
     * ...then the agent is removed, and the metric server's pushes start
     * six minutes later. Nobody has a liveness key: the agent records
     * none.
     */
    await advance(world, { durationMs: 6 * MINUTE_MS, pushing: [] });
    world.nativePush = true;
    for (const nodeName of ALL_NODES) {
      expect(readLiveness(world, nodeName)).toBeNull();
    }

    /*
     * The first native step, driven push by push (off the cron's
     * boundaries): all three push — pve3 came back during the switch —
     * pve3's processed last.
     */
    world.clockMs += STEP_MS;
    const firstStepMs: number = world.clockMs;
    expect(firstStepMs % TICK_MS).not.toBe(0);
    // pve3 is silent by its row...
    expect(firstStepMs - pve3.lastSeenAt.getTime()).toBeGreaterThan(SILENCE_MS);
    /*
     * ...and its updatedAt, read on the workers' clock, lies 3.5 minutes
     * in the future: taken for a mark, it would sit inside the monitors'
     * window — which, with the database's clock in step, it would not.
     */
    expect(pve3.updatedAt.getTime() - firstStepMs).toBe(
      dbClockAheadMs - 6 * MINUTE_MS - STEP_MS,
    );
    expect(firstStepMs - pve3.updatedAt.getTime()).toBeLessThanOrEqual(
      PROXMOX_MONITOR_WINDOW_MS,
    );
    expect(
      firstStepMs - (pve3.updatedAt.getTime() - dbClockAheadMs),
    ).toBeGreaterThan(PROXMOX_MONITOR_WINDOW_MS);

    // pve1's flush adopts the Node rows not yet native, pve3's unmarked...
    ingestPush(world, "pve1");
    expect(world.adoptions).toEqual([
      {
        atMs: firstStepMs,
        seenUpToMs: firstStepMs,
        adopted: ["node/pve2", "node/pve3"],
      },
    ]);
    expect(pve3.isNativePush).toBe(true);
    expect(pve3.isUp).toBe(false);
    expect(pve3.notReportingMarkedAt).toBeNull();

    /*
     * ...and neither pve1's push nor pve2's reports pve3: nobody is
     * established, and the row carries no mark.
     */
    ingestPush(world, "pve2");
    expect(world.reports).toEqual([]);
    expect(world.marks).toEqual([]);

    /*
     * The very same decision, on a roster whose pve3 mark read the row's
     * updatedAt, would have reported it: a false Node Offline for a node
     * that is back.
     */
    const updatedAtAsMark: Array<ProxmoxRosterNode> = nodeRoster(world).map(
      (node: ProxmoxRosterNode): ProxmoxRosterNode => {
        return node.nodeName === "pve3"
          ? { ...node, notReportingMarkedAt: new Date(pve3.updatedAt) }
          : node;
      },
    );
    const liveness: Map<string, ProxmoxNodeLiveness | null> = new Map<
      string,
      ProxmoxNodeLiveness | null
    >();
    for (const nodeName of ALL_NODES) {
      liveness.set(nodeName, readLiveness(world, nodeName));
    }
    expect(
      decideProxmoxSilentNodes({
        selfNode: "pve2",
        reporterTimeMs: firstStepMs,
        nowMs: firstStepMs,
        roster: updatedAtAsMark,
        liveness,
      }),
    ).toEqual({ silentNodes: ["pve3"], reporterCount: 2 });

    // pve3's own push brings its row back.
    ingestPush(world, "pve3");
    expect(pve3.isUp).toBe(true);
    expect(pve3.lastSeenAt.getTime()).toBe(firstStepMs);
    expect(pve3.notReportingMarkedAt).toBeNull();

    // Nor is it reported later: the half hour on, pve3 always last.
    const ticks: Array<TickRecord> = await advance(world, {
      durationMs: 30 * MINUTE_MS,
      pushing: ALL_NODES,
    });
    expect(world.reports).toEqual([]);
    expect(world.marks).toEqual([]);
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick.clusterStatus).toBe("connected");
      expect(tick.present.size).toBe(CATALOG.length);
      expect(tick.offline.size).toBe(0);
    }
    for (const nodeName of ALL_NODES) {
      expect(rowOf(world, `node/${nodeName}`)!.isNativePush).toBe(true);
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

    /*
     * Two minutes on, the nodes that are back report it — and mark it,
     * then re-mark it every two minutes.
     */
    expect(world.reportedAtMs[0]).toBe(establishedAtMs);
    const pve3: WorldRow = rowOf(world, "node/pve3")!;
    expect(pve3.isUp).toBe(false);
    expect(markWritesOf(world, "node/pve3")).toEqual(
      markCadence(establishedAtMs, world.clockMs),
    );
    expect(pve3.notReportingMarkedAt!.getTime()).toBe(
      markWritesOf(world, "node/pve3").pop(),
    );
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
    expect(markWritesOf(world, "node/pve3")[0]).toBe(resumedAtMs + SILENCE_MS);

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

    /*
     * ...kept and reported to the end of the window counted from that
     * push — re-marked every two minutes all week, the last time within
     * two minutes of that end: however fresh, the mark keeps nothing...
     */
    const present: Array<number> = ticksWhere(ticks, "node/pve3", true);
    expect(present[present.length - 1]).toBe(retentionEndMs);
    expect(world.reportedAtMs[world.reportedAtMs.length - 1]).toBe(
      retentionEndMs,
    );
    expect(markWritesOf(world, "node/pve3")).toEqual(
      markCadence(resumedAtMs + SILENCE_MS, retentionEndMs),
    );
    const lastMarkMs: number | undefined = markWritesOf(
      world,
      "node/pve3",
    ).pop();
    expect(retentionEndMs - lastMarkMs!).toBeLessThan(MARK_CADENCE_MS);
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
