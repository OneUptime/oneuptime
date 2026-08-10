/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * OtelIngestMaintenanceFenceRelease.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
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

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import CephClusterService from "Common/Server/Services/CephClusterService";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import HostService from "Common/Server/Services/HostService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import LabelService from "Common/Server/Services/LabelService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumApplicationClientService from "Common/Server/Services/RumApplicationClientService";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The shared entity-id L1 memo in front of the eleven autoDiscover* Redis
 * caches.
 *
 * Every autoDiscover* method resolves "(projectId, natural key) -> Postgres
 * row id" through GlobalCache — a pure Redis client with no in-process
 * layer — so one discovered entity per resource block per job was one
 * serialized Redis GET, hundreds per hostmetrics payload, for ids that
 * change never. The L1 collapses the steady state to zero round trips.
 *
 * What is pinned here, per method:
 *
 *   1. COLD: one Redis GET, one findOrCreate*, one Redis SET, id returned.
 *   2. STEADY STATE: a repeat discovery issues NO further Redis GET and NO
 *      findOrCreate — the whole point of the change.
 *   3. CROSS-POD WARMTH still works: a Redis-warm/process-cold key costs
 *      one GET and no findOrCreate, and populates the L1 for next time.
 *   4. A warmed L1 keeps resolving through a Redis OUTAGE (the cold path's
 *      throw-on-outage behaviour is unchanged and lives with the caller).
 *   5. The L1 expires on its 60s TTL and falls back to Redis (not to
 *      Postgres — Redis holds the id for 24h).
 *
 * The maintenance fences are held open (SET NX -> true) so the discovery
 * paths run their full shape; the fence's own memo has its own suite.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RESOURCE_ID: string = "55555555-5555-4555-8555-555555555555";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

type DiscoverCase = {
  /** describe() title. */
  name: string;
  /** The autoDiscover* method under test. */
  method: string;
  /** The Redis namespace its entity-id cache lives under. */
  namespace: string;
  /** Resource attributes that route a batch to this method. */
  attributes: JSONArray;
  /** The Postgres resolution seam the cold path must reach exactly once. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findOrCreate: { service: any; method: string };
  /** The gated maintenance write, mocked so the full shape runs. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maintenance: { service: any; method: string };
};

const DISCOVER_CASES: Array<DiscoverCase> = [
  {
    name: "autoDiscoverKubernetesCluster",
    method: "autoDiscoverKubernetesCluster",
    namespace: "k8s-cluster-id",
    attributes: [stringAttribute("k8s.cluster.name", "prod-eu")] as JSONArray,
    findOrCreate: {
      service: KubernetesClusterService,
      method: "findOrCreateByClusterIdentifier",
    },
    maintenance: {
      service: KubernetesClusterService,
      method: "updateLastSeen",
    },
  },
  {
    name: "autoDiscoverProxmoxCluster",
    method: "autoDiscoverProxmoxCluster",
    namespace: "proxmox-cluster-id",
    attributes: [stringAttribute("proxmox.cluster.name", "pve-1")] as JSONArray,
    findOrCreate: {
      service: ProxmoxClusterService,
      method: "findOrCreateByName",
    },
    maintenance: { service: ProxmoxClusterService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverIoTFleet",
    method: "autoDiscoverIoTFleet",
    namespace: "iot-fleet-id",
    attributes: [stringAttribute("iot.fleet.name", "sensors-eu")] as JSONArray,
    findOrCreate: { service: IoTFleetService, method: "findOrCreateByName" },
    maintenance: { service: IoTFleetService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverDockerSwarmCluster",
    method: "autoDiscoverDockerSwarmCluster",
    namespace: "docker-swarm-cluster-id",
    attributes: [
      stringAttribute("docker.swarm.cluster.name", "swarm-1"),
    ] as JSONArray,
    findOrCreate: {
      service: DockerSwarmClusterService,
      method: "findOrCreateByName",
    },
    maintenance: {
      service: DockerSwarmClusterService,
      method: "updateLastSeen",
    },
  },
  {
    name: "autoDiscoverCephCluster",
    method: "autoDiscoverCephCluster",
    namespace: "ceph-cluster-id",
    attributes: [stringAttribute("ceph.cluster.name", "ceph-1")] as JSONArray,
    findOrCreate: { service: CephClusterService, method: "findOrCreateByName" },
    maintenance: { service: CephClusterService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverServerless",
    method: "autoDiscoverServerless",
    namespace: "serverless-function-id",
    /*
     * No faas.instance on purpose: the instance-inventory fence is not what
     * is under test, and omitting it keeps this case symmetric with the
     * others.
     */
    attributes: [stringAttribute("faas.name", "checkout-handler")] as JSONArray,
    findOrCreate: {
      service: ServerlessFunctionService,
      method: "findOrCreateByFunctionIdentifier",
    },
    maintenance: {
      service: ServerlessFunctionService,
      method: "updateLastSeen",
    },
  },
  {
    name: "autoDiscoverCloudResource",
    method: "autoDiscoverCloudResource",
    namespace: "cloud-resource-id",
    // No service.instance.id: same reasoning as the serverless case.
    attributes: [
      stringAttribute("cloud.platform", "aws_ecs"),
      stringAttribute("cloud.region", "eu-central-1"),
    ] as JSONArray,
    findOrCreate: {
      service: CloudResourceService,
      method: "findOrCreateByResourceIdentifier",
    },
    maintenance: { service: CloudResourceService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverRum",
    method: "autoDiscoverRum",
    namespace: "rum-application-id",
    attributes: [
      stringAttribute("browser.platform", "macOS"),
      stringAttribute("service.name", "storefront"),
    ] as JSONArray,
    findOrCreate: {
      service: RumApplicationService,
      method: "findOrCreateByAppIdentifier",
    },
    maintenance: { service: RumApplicationService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverDockerHost",
    method: "autoDiscoverDockerHost",
    namespace: "docker-host-id",
    attributes: [
      stringAttribute("container.runtime", "docker"),
      stringAttribute("host.name", "docker-host-1"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    findOrCreate: {
      service: DockerHostService,
      method: "findOrCreateByHostIdentifier",
    },
    maintenance: { service: DockerHostService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverPodmanHost",
    method: "autoDiscoverPodmanHost",
    namespace: "podman-host-id",
    attributes: [
      stringAttribute("container.runtime", "podman"),
      stringAttribute("host.name", "podman-host-1"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    findOrCreate: {
      service: PodmanHostService,
      method: "findOrCreateByHostIdentifier",
    },
    maintenance: { service: PodmanHostService, method: "updateLastSeen" },
  },
  {
    name: "autoDiscoverHost",
    method: "autoDiscoverHost",
    namespace: "host-id",
    attributes: [
      stringAttribute("host.name", "vm-1"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    findOrCreate: {
      service: HostService,
      method: "findOrCreateByHostIdentifier",
    },
    maintenance: { service: HostService, method: "updateLastSeen" },
  },
];

describe.each(DISCOVER_CASES)(
  "$name entity-id L1 memo",
  ({
    method,
    namespace,
    attributes,
    findOrCreate,
    maintenance,
  }: DiscoverCase) => {
    /** Stands in for Redis, keyed `namespace:key` like the real client. */
    let fakeRedis: Map<string, string>;
    let nowMs: number;

    function entityGetCalls(): number {
      return (GlobalCache.getString as jest.Mock).mock.calls.filter(
        (call: Array<unknown>) => {
          return call[0] === namespace;
        },
      ).length;
    }

    function entitySetCalls(): number {
      return (GlobalCache.setString as jest.Mock).mock.calls.filter(
        (call: Array<unknown>) => {
          return call[0] === namespace;
        },
      ).length;
    }

    function findOrCreateCalls(): number {
      return (findOrCreate.service[findOrCreate.method] as jest.Mock).mock.calls
        .length;
    }

    async function discover(): Promise<ObjectID | null> {
      return (await baseService[method]({
        projectId: PROJECT_ID,
        attributes: attributes,
      })) as ObjectID | null;
    }

    beforeEach(() => {
      fakeRedis = new Map<string, string>();
      nowMs = 1_700_000_000_000;

      /*
       * Both in-process memos (entity ids + fence refusals) survive across
       * tests inside one process; treat their TTLs as expired between
       * cases, the same way fakeRedis is rebuilt.
       */
      OtelIngestBaseService.clearInProcessMemos();

      jest.spyOn(Date, "now").mockImplementation(() => {
        return nowMs;
      });

      jest
        .spyOn(GlobalCache, "getString")
        .mockImplementation(async (ns: string, key: string) => {
          return fakeRedis.get(`${ns}:${key}`) ?? null;
        });
      jest
        .spyOn(GlobalCache, "setString")
        .mockImplementation(async (ns: string, key: string, value: string) => {
          fakeRedis.set(`${ns}:${key}`, value);
        });
      // Fences held open so each discovery runs its full maintenance shape.
      jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
      jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);

      /*
       * Postgres resolution seam: returns a row with the well-known id.
       * Both spellings are carried because the methods are split on which
       * they read — IoT goes through the `id` ObjectID getter, the other
       * ten read `_id` directly.
       */
      jest.spyOn(findOrCreate.service, findOrCreate.method).mockResolvedValue({
        _id: RESOURCE_ID,
        id: new ObjectID(RESOURCE_ID),
      });

      // Gated maintenance work, mocked out — not what is under test.
      jest
        .spyOn(maintenance.service, maintenance.method)
        .mockResolvedValue(undefined);
      jest
        .spyOn(LabelService, "findOrCreateLabelsByNames")
        .mockResolvedValue([]);
      jest
        .spyOn(RumApplicationClientService, "recordClient")
        .mockResolvedValue(undefined);
      jest
        .spyOn(baseService, "tryLinkHostToProxmoxGuest")
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      OtelIngestBaseService.clearInProcessMemos();
    });

    test("cold discovery: one Redis GET, one findOrCreate, one Redis SET", async () => {
      const discovered: ObjectID | null = await discover();

      expect(discovered?.toString()).toBe(RESOURCE_ID);
      expect(entityGetCalls()).toBe(1);
      expect(findOrCreateCalls()).toBe(1);
      expect(entitySetCalls()).toBe(1);
    });

    /*
     * THE assertion: the steady state — same entity, next resource block or
     * next job — must cost zero network round trips.
     */
    test("repeat discovery inside the TTL issues no Redis GET and no findOrCreate", async () => {
      await discover();
      const getsAfterCold: number = entityGetCalls();
      const findsAfterCold: number = findOrCreateCalls();

      const second: ObjectID | null = await discover();
      const third: ObjectID | null = await discover();

      expect(second?.toString()).toBe(RESOURCE_ID);
      expect(third?.toString()).toBe(RESOURCE_ID);
      expect(entityGetCalls()).toBe(getsAfterCold);
      expect(findOrCreateCalls()).toBe(findsAfterCold);
    });

    test("a Redis-warm, process-cold key costs one GET and no findOrCreate — and warms the L1", async () => {
      // Another pod resolved this entity and warmed Redis.
      const seededKey: string | undefined = await (async (): Promise<
        string | undefined
      > => {
        await discover();
        // Steal the key the cold path just used, then reset the process.
        const setCall: Array<unknown> | undefined = (
          GlobalCache.setString as jest.Mock
        ).mock.calls.find((call: Array<unknown>) => {
          return call[0] === namespace;
        });
        return setCall ? (setCall[1] as string) : undefined;
      })();
      expect(seededKey).toBeDefined();

      OtelIngestBaseService.clearInProcessMemos();
      (GlobalCache.getString as jest.Mock).mockClear();
      (findOrCreate.service[findOrCreate.method] as jest.Mock).mockClear();

      const first: ObjectID | null = await discover();
      expect(first?.toString()).toBe(RESOURCE_ID);
      expect(entityGetCalls()).toBe(1);
      expect(findOrCreateCalls()).toBe(0);

      // The L2 read populated the L1: the next call is free.
      await discover();
      expect(entityGetCalls()).toBe(1);
    });

    test("a warmed L1 keeps resolving through a Redis outage", async () => {
      await discover();

      jest
        .spyOn(GlobalCache, "getString")
        .mockRejectedValue(new Error("redis down"));

      const resolved: ObjectID | null = await discover();

      expect(resolved?.toString()).toBe(RESOURCE_ID);
      expect(findOrCreateCalls()).toBe(1);
    });

    test("the L1 expires on its TTL and falls back to Redis, not Postgres", async () => {
      await discover();
      const getsAfterCold: number = entityGetCalls();

      nowMs += 61 * 1000;
      const resolved: ObjectID | null = await discover();

      expect(resolved?.toString()).toBe(RESOURCE_ID);
      // Redis still holds the id (24h TTL there), so no findOrCreate.
      expect(entityGetCalls()).toBe(getsAfterCold + 1);
      expect(findOrCreateCalls()).toBe(1);
    });
  },
);

describe("entity-id L1 memo coverage", () => {
  test("every autoDiscover* method is covered", () => {
    /*
     * A twelfth resource type resolving its id through GlobalCache belongs
     * in DISCOVER_CASES — an autoDiscover* that quietly keeps paying one
     * Redis GET per resource block is exactly the regression this suite
     * exists to catch.
     */
    const covered: Array<string> = DISCOVER_CASES.map((c: DiscoverCase) => {
      return c.method;
    });

    const declared: Array<string> = Object.getOwnPropertyNames(
      OtelIngestBaseService,
    ).filter((property: string) => {
      return property.startsWith("autoDiscover");
    });

    expect(declared.length).toBeGreaterThan(0);
    expect(covered.sort()).toEqual(declared.sort());
  });
});
