/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import CephClusterService from "../../../Server/Services/CephClusterService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import HostService from "../../../Server/Services/HostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import StorageArrayService, {
  StorageArraySnapshotExtras,
} from "../../../Server/Services/StorageArrayService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The agent version a host's, Proxmox cluster's, Ceph cluster's, vCenter's
 * or storage array's collector stamps reaches the resource's row through the
 * same gated heartbeat as everything else ingest learns about it
 * (ResourceHeartbeat). Two callers write each row: the metrics snapshot
 * (counts, every batch) and the fenced maintenance pass, which carries the
 * version. These pin what that means for the version:
 *
 *   - the version lands, and a later snapshot write without it never
 *     blanks it (absent keys are not written);
 *   - when the snapshot wrote moments before, the version waits at most one
 *     window and then lands - it is never lost;
 *   - a host's two paths now report the same facts, version included, so
 *     their heartbeats agree instead of taking turns.
 *
 * Redis is an in-memory map with the real gate semantics; Postgres is the
 * hook-free write the heartbeat makes, recorded.
 */

const ROW_ID: ObjectID = ObjectID.generate();
const VERSION: string = "0.161.0";

type WriteCall = { id: ObjectID; data: Record<string, unknown> };

let writes: Array<WriteCall>;
let cache: Map<string, string>;

function mockCache(): void {
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(async (ns: string, key: string, value: string) => {
      const full: string = `${ns}:${key}`;
      if (cache.has(full)) {
        return false;
      }
      cache.set(full, value);
      return true;
    });
  jest
    .spyOn(GlobalCache, "setStringIfChanged")
    .mockImplementation(async (ns: string, key: string, value: string) => {
      const full: string = `${ns}:${key}`;
      if (cache.get(full) === value) {
        return false;
      }
      cache.set(full, value);
      return true;
    });
  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (ns: string, key: string) => {
      cache.delete(`${ns}:${key}`);
    });
}

/*
 * Every gate key has a TTL of one window; let it pass. The in-process memo
 * and single-flight are per window too.
 */
function letTheWindowPass(): void {
  cache.clear();
  SingleFlight.clear();
  ResourceHeartbeat.clearRecentHeartbeatMemo();
}

function versionWrites(): Array<WriteCall> {
  return writes.filter((write: WriteCall): boolean => {
    return "agentVersion" in write.data;
  });
}

type ServiceCase = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  // What the metrics snapshot (or batch) path writes, without a version.
  snapshot: Record<string, unknown>;
};

const CASES: Array<ServiceCase> = [
  {
    name: "ProxmoxClusterService",
    service: ProxmoxClusterService,
    snapshot: { pveVersion: "8.2.4", nodeCount: 3, onlineNodeCount: 3 },
  },
  {
    name: "CephClusterService",
    service: CephClusterService,
    snapshot: { cephVersion: "18.2.4", osdCount: 6, osdUpCount: 6 },
  },
  {
    name: "VMwareVCenterService",
    service: VMwareVCenterService,
    snapshot: { hostCount: 8, vmCount: 120 },
  },
  {
    name: "DockerSwarmClusterService",
    service: DockerSwarmClusterService,
    snapshot: { nodeCount: 3, serviceCount: 12 },
  },
  {
    name: "HostService",
    service: HostService,
    snapshot: { osType: "linux", hostArch: "amd64" },
  },
];

describe.each(CASES)("$name", ({ service, snapshot }: ServiceCase) => {
  beforeEach(() => {
    writes = [];
    cache = new Map<string, string>();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    mockCache();
    jest
      .spyOn(service, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(async (input: unknown) => {
        const call: { id: ObjectID; data: unknown } = input as {
          id: ObjectID;
          data: unknown;
        };
        writes.push({
          id: call.id,
          data: { ...(call.data as Record<string, unknown>) },
        });
        return true;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
  });

  test("the version the collector reports lands on the row", async () => {
    await service.updateLastSeen(ROW_ID, { agentVersion: VERSION });

    expect(versionWrites()).toHaveLength(1);
    expect(versionWrites()[0]!.data["agentVersion"]).toBe(VERSION);
    expect(versionWrites()[0]!.id.toString()).toBe(ROW_ID.toString());
  });

  test("a snapshot write without a version never blanks it", async () => {
    await service.updateLastSeen(ROW_ID, { agentVersion: VERSION });
    letTheWindowPass();
    await service.updateLastSeen(ROW_ID, snapshot);

    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect("agentVersion" in writes[writes.length - 1]!.data).toBe(false);
  });

  test("an empty version is never written: an install from before the pin reads Not reported", async () => {
    await service.updateLastSeen(ROW_ID, { agentVersion: "" });

    expect(versionWrites()).toHaveLength(0);
  });

  test("a version reported right after a snapshot write waits one window at most, then lands", async () => {
    await service.updateLastSeen(ROW_ID, snapshot);
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    // The maintenance pass, moments later: the window's write is spent.
    await service.updateLastSeen(ROW_ID, { agentVersion: VERSION });
    // Rate-limited: one enrichment write per row per window.
    expect(versionWrites()).toHaveLength(0);

    // The next maintenance pass, a window later, writes it.
    letTheWindowPass();
    await service.updateLastSeen(ROW_ID, { agentVersion: VERSION });

    expect(versionWrites()).toHaveLength(1);
    expect(versionWrites()[0]!.data["agentVersion"]).toBe(VERSION);
  });
});

/*
 * A storage array keys its heartbeat by the SHAPE of the extras - each of
 * its scrape jobs' batches carries a different one (StorageArrayService.
 * updateLastSeen) - so the maintenance pass's version, a shape of its own,
 * has a window of its own: it never waits behind a snapshot's write.
 */
describe("StorageArrayService", () => {
  // What the array endpoint's snapshot writes, without a version.
  const SNAPSHOT: StorageArraySnapshotExtras = {
    storageSystem: "purestorage.flasharray",
    capacityBytes: 100_000_000_000,
    usedBytes: 40_000_000_000,
    healthStatus: 0,
  };

  beforeEach(() => {
    writes = [];
    cache = new Map<string, string>();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    mockCache();
    jest
      .spyOn(StorageArrayService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(async (input: unknown) => {
        const call: { id: ObjectID; data: unknown } = input as {
          id: ObjectID;
          data: unknown;
        };
        writes.push({
          id: call.id,
          data: { ...(call.data as Record<string, unknown>) },
        });
        return true;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
  });

  test("the version the collector reports lands on the row", async () => {
    await StorageArrayService.updateLastSeen(ROW_ID, { agentVersion: VERSION });

    expect(versionWrites()).toHaveLength(1);
    expect(versionWrites()[0]!.data["agentVersion"]).toBe(VERSION);
    expect(versionWrites()[0]!.id.toString()).toBe(ROW_ID.toString());
  });

  test("a snapshot write without a version never blanks it", async () => {
    await StorageArrayService.updateLastSeen(ROW_ID, { agentVersion: VERSION });
    letTheWindowPass();
    await StorageArrayService.updateLastSeen(ROW_ID, SNAPSHOT);

    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect("agentVersion" in writes[writes.length - 1]!.data).toBe(false);
  });

  test("an empty version is never written: an install from before the stamp reads Not reported", async () => {
    for (const blank of ["", "   "]) {
      await StorageArrayService.updateLastSeen(ROW_ID, { agentVersion: blank });
      letTheWindowPass();
    }

    expect(versionWrites()).toHaveLength(0);
  });

  test("a version reported right after a snapshot write lands at once, in a window of its own", async () => {
    await StorageArrayService.updateLastSeen(ROW_ID, SNAPSHOT);
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    // The maintenance pass, moments later: another shape, another window.
    await StorageArrayService.updateLastSeen(ROW_ID, { agentVersion: VERSION });

    expect(versionWrites()).toHaveLength(1);
    expect(versionWrites()[0]!.data["agentVersion"]).toBe(VERSION);
    // Each write carried its own columns only.
    expect("agentVersion" in writes[0]!.data).toBe(false);
    expect(writes[0]!.data["capacityBytes"]).toBe(SNAPSHOT.capacityBytes);

    // The same version again inside the window costs nothing more.
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    await StorageArrayService.updateLastSeen(ROW_ID, { agentVersion: VERSION });
    expect(versionWrites()).toHaveLength(1);
  });
});

describe("a host's batch and maintenance paths report the same facts", () => {
  beforeEach(() => {
    writes = [];
    cache = new Map<string, string>();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    mockCache();
    jest
      .spyOn(HostService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(async (input: unknown) => {
        const call: { id: ObjectID; data: unknown } = input as {
          id: ObjectID;
          data: unknown;
        };
        writes.push({
          id: call.id,
          data: { ...(call.data as Record<string, unknown>) },
        });
        return true;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
  });

  test("the batch path's write carries the version, and the maintenance pass with the same facts costs nothing more", async () => {
    const facts: Record<string, unknown> = {
      osType: "linux",
      osVersion: "Ubuntu 24.04",
      hostArch: "amd64",
      agentVersion: VERSION,
    };

    // runBatchHostEnrichment: the version rides the batch's one write.
    await HostService.updateLastSeen(ROW_ID, {
      ...facts,
      cpuCores: 8,
    } as Parameters<typeof HostService.updateLastSeen>[1]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["agentVersion"]).toBe(VERSION);

    // autoDiscoverHost's maintenance pass, same batch: same fingerprint.
    SingleFlight.clear();
    await HostService.updateLastSeen(
      ROW_ID,
      facts as Parameters<typeof HostService.updateLastSeen>[1],
    );
    expect(writes).toHaveLength(1);
  });
});
