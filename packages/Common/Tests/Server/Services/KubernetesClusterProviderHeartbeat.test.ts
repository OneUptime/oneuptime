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

import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
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
 * The platform ingest reads off a Kubernetes cluster's telemetry
 * (getKubernetesClusterProvider) reaches the cluster's Provider through the
 * same gated heartbeat as its agent version. These pin that:
 *
 *   - the platform lands on the row, with the agent version in the same write;
 *   - a heartbeat that names no platform never blanks the one stored (absent
 *     keys are not written), so a cluster whose telemetry stops naming it
 *     keeps showing it;
 *   - an empty platform is never written;
 *   - liveness never waits on it.
 *
 * Redis is an in-memory map with the real gate semantics; Postgres is the
 * hook-free write the heartbeat makes, recorded.
 */

const CLUSTER_ID: ObjectID = ObjectID.generate();

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

// Every gate key has a TTL of one window; let it pass.
function letTheWindowPass(): void {
  cache.clear();
  SingleFlight.clear();
  ResourceHeartbeat.clearRecentHeartbeatMemo();
}

function providerWrites(): Array<WriteCall> {
  return writes.filter((write: WriteCall): boolean => {
    return "provider" in write.data;
  });
}

describe("KubernetesClusterService.updateLastSeen writes the cluster's platform", () => {
  beforeEach(() => {
    writes = [];
    cache = new Map<string, string>();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    mockCache();
    jest
      .spyOn(
        KubernetesClusterService,
        "updateColumnsByIdIfUnlockedWithoutHooks",
      )
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

  test("the platform the telemetry names lands on the cluster's row", async () => {
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      provider: "OpenShift",
    });

    expect(providerWrites()).toHaveLength(1);
    expect(providerWrites()[0]!.data["provider"]).toBe("OpenShift");
    expect(providerWrites()[0]!.id.toString()).toBe(CLUSTER_ID.toString());
  });

  test("it travels with the agent version, in one write", async () => {
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      agentVersion: "14.0.98",
      provider: "OpenShift",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["provider"]).toBe("OpenShift");
    expect(writes[0]!.data["agentVersion"]).toBe("14.0.98");
    expect(writes[0]!.data["otelCollectorStatus"]).toBe("connected");
    expect(writes[0]!.data["lastSeenAt"]).toBeInstanceOf(Date);
  });

  test("a heartbeat that names no platform never blanks the one stored", async () => {
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      provider: "OpenShift",
    });
    letTheWindowPass();
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      agentVersion: "14.0.98",
    });
    letTheWindowPass();
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID);

    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(providerWrites()).toHaveLength(1);
    for (const write of writes.slice(1)) {
      expect("provider" in write.data).toBe(false);
    }
  });

  test("an empty platform is never written", async () => {
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      provider: "",
    });

    expect(providerWrites()).toHaveLength(0);
    // The heartbeat itself still lands.
    expect(writes).toHaveLength(1);
    expect(writes[0]!.data["otelCollectorStatus"]).toBe("connected");
  });

  test("an unchanged platform costs nothing more within the window", async () => {
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      provider: "OpenShift",
    });
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      provider: "OpenShift",
    });

    expect(providerWrites()).toHaveLength(1);
  });

  test("a platform first named moments after a write waits one window at most, then lands", async () => {
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      agentVersion: "14.0.98",
    });
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    // Moments later, the first batch that names it: the window's write is spent.
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      agentVersion: "14.0.98",
      provider: "OpenShift",
    });
    expect(providerWrites()).toHaveLength(0);

    letTheWindowPass();
    await KubernetesClusterService.updateLastSeen(CLUSTER_ID, {
      agentVersion: "14.0.98",
      provider: "OpenShift",
    });

    expect(providerWrites()).toHaveLength(1);
    expect(providerWrites()[0]!.data["provider"]).toBe("OpenShift");
  });
});
