/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * OtelIngestEntityIdL1Memo.test.ts in this directory.
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
import StorageArrayService from "Common/Server/Services/StorageArrayService";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import HostService from "Common/Server/Services/HostService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import LabelService from "Common/Server/Services/LabelService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumApplicationClientService from "Common/Server/Services/RumApplicationClientService";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import DiscoveredResourceIdCache, {
  DiscoveredResourceKind,
  DiscoveredResourceKinds,
} from "Common/Server/Utils/Telemetry/DiscoveredResourceIdCache";
import { ResourceHeartbeatResult } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "Common/Server/Utils/SingleFlight";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A DISCOVERED RESOURCE DELETED WHILE ITS AGENT KEEPS SENDING COMES BACK
 * (issue #5214), for every kind ingest discovers.
 *
 * The customer deleted a Docker host; its id stayed in the ingest caches for
 * a day, so every batch wrote against the deleted id - the heartbeat updated
 * nothing, the containers were refused by the foreign key - and the host
 * never came back. What is pinned here, per autoDiscover* kind:
 *
 *   1. A deleted resource (DatabaseService tells DiscoveredResourceIdCache)
 *      is resolved again on the agent's next batch: Postgres is asked, and
 *      the batch carries the row that answers - a new one, created as on
 *      first contact.
 *   2. An id cached before the delete (another worker's, or Redis from
 *      before this fix) is caught the moment its heartbeat finds the row
 *      gone: the id is forgotten in both layers, the resource resolved again
 *      past every memo, and the heartbeat and labels written to the new row.
 *   3. Later batches go straight to the new row - no Postgres, no Redis.
 *   4. A write of the resource's rows (containers, inventory, instances)
 *      refused by its foreign key is retried once against the row that
 *      answers now; an id this process never resolved, and any other
 *      failure, are thrown as before.
 *   5. Resolutions that meet in one process share one lookup.
 *
 * Redis is a Map with GlobalCache's semantics, fences are held open, and the
 * services' find-or-create and heartbeat are the seams.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6c8b5e0e-8f3a-4c51-9b52-0a6f2a1d4b10",
);
const GONE_ID: string = "11111111-1111-4111-8111-111111111111";
const NEW_ID: string = "22222222-2222-4222-8222-222222222222";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

type DiscoverCase = {
  name: string;
  method: string;
  kind: DiscoveredResourceKind;
  // What the batch's telemetry reports, as the key folds it.
  identity: string;
  attributes: JSONArray;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findOrCreate: { service: any; method: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  heartbeat: { service: any; method: string };
};

const DISCOVER_CASES: Array<DiscoverCase> = [
  {
    name: "Kubernetes cluster",
    method: "autoDiscoverKubernetesCluster",
    kind: DiscoveredResourceKinds.KubernetesCluster,
    identity: "prod-eu",
    attributes: [stringAttribute("k8s.cluster.name", "prod-eu")] as JSONArray,
    findOrCreate: {
      service: KubernetesClusterService,
      method: "findOrCreateByClusterIdentifier",
    },
    heartbeat: { service: KubernetesClusterService, method: "updateLastSeen" },
  },
  {
    name: "Proxmox cluster",
    method: "autoDiscoverProxmoxCluster",
    kind: DiscoveredResourceKinds.ProxmoxCluster,
    identity: "pve-1",
    attributes: [stringAttribute("proxmox.cluster.name", "pve-1")] as JSONArray,
    findOrCreate: {
      service: ProxmoxClusterService,
      method: "findOrCreateByName",
    },
    heartbeat: { service: ProxmoxClusterService, method: "updateLastSeen" },
  },
  {
    name: "vCenter",
    method: "autoDiscoverVMwareVCenter",
    kind: DiscoveredResourceKinds.VMwareVCenter,
    identity: "vcsa-prod",
    attributes: [
      stringAttribute("vmware.vcenter.name", "vcsa-prod"),
    ] as JSONArray,
    findOrCreate: {
      service: VMwareVCenterService,
      method: "findOrCreateByName",
    },
    heartbeat: { service: VMwareVCenterService, method: "updateLastSeen" },
  },
  {
    name: "IoT fleet",
    method: "autoDiscoverIoTFleet",
    kind: DiscoveredResourceKinds.IoTFleet,
    identity: "sensors-eu",
    attributes: [stringAttribute("iot.fleet.name", "sensors-eu")] as JSONArray,
    findOrCreate: { service: IoTFleetService, method: "findOrCreateByName" },
    heartbeat: { service: IoTFleetService, method: "updateLastSeen" },
  },
  {
    name: "Docker Swarm cluster",
    method: "autoDiscoverDockerSwarmCluster",
    kind: DiscoveredResourceKinds.DockerSwarmCluster,
    identity: "swarm-1",
    attributes: [
      stringAttribute("docker.swarm.cluster.name", "swarm-1"),
    ] as JSONArray,
    findOrCreate: {
      service: DockerSwarmClusterService,
      method: "findOrCreateByName",
    },
    heartbeat: { service: DockerSwarmClusterService, method: "updateLastSeen" },
  },
  {
    name: "Ceph cluster",
    method: "autoDiscoverCephCluster",
    kind: DiscoveredResourceKinds.CephCluster,
    identity: "ceph-1",
    attributes: [stringAttribute("ceph.cluster.name", "ceph-1")] as JSONArray,
    findOrCreate: { service: CephClusterService, method: "findOrCreateByName" },
    heartbeat: { service: CephClusterService, method: "updateLastSeen" },
  },
  {
    name: "storage array",
    method: "autoDiscoverStorageArray",
    kind: DiscoveredResourceKinds.StorageArray,
    identity: "pure-prod-01",
    attributes: [
      stringAttribute("storage.array.name", "pure-prod-01"),
    ] as JSONArray,
    findOrCreate: {
      service: StorageArrayService,
      method: "findOrCreateByName",
    },
    heartbeat: { service: StorageArrayService, method: "updateLastSeen" },
  },
  {
    name: "serverless function",
    method: "autoDiscoverServerless",
    kind: DiscoveredResourceKinds.ServerlessFunction,
    identity: "checkout-handler",
    attributes: [stringAttribute("faas.name", "checkout-handler")] as JSONArray,
    findOrCreate: {
      service: ServerlessFunctionService,
      method: "findOrCreateByFunctionIdentifier",
    },
    heartbeat: { service: ServerlessFunctionService, method: "updateLastSeen" },
  },
  {
    name: "cloud environment",
    method: "autoDiscoverCloudResource",
    kind: DiscoveredResourceKinds.CloudResource,
    identity: "aws_ecs||eu-central-1",
    attributes: [
      stringAttribute("cloud.platform", "aws_ecs"),
      stringAttribute("cloud.region", "eu-central-1"),
    ] as JSONArray,
    findOrCreate: {
      service: CloudResourceService,
      method: "findOrCreateByResourceIdentifier",
    },
    heartbeat: { service: CloudResourceService, method: "updateLastSeen" },
  },
  {
    name: "RUM application",
    method: "autoDiscoverRum",
    kind: DiscoveredResourceKinds.RumApplication,
    identity: "storefront",
    attributes: [
      stringAttribute("browser.platform", "macOS"),
      stringAttribute("service.name", "storefront"),
    ] as JSONArray,
    findOrCreate: {
      service: RumApplicationService,
      method: "findOrCreateByAppIdentifier",
    },
    heartbeat: { service: RumApplicationService, method: "updateLastSeen" },
  },
  {
    name: "Docker host",
    method: "autoDiscoverDockerHost",
    kind: DiscoveredResourceKinds.DockerHost,
    identity: "test01",
    attributes: [
      stringAttribute("container.runtime", "docker"),
      stringAttribute("host.name", "test01"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    findOrCreate: {
      service: DockerHostService,
      method: "findOrCreateByHostIdentifier",
    },
    heartbeat: { service: DockerHostService, method: "updateLastSeen" },
  },
  {
    name: "Podman host",
    method: "autoDiscoverPodmanHost",
    kind: DiscoveredResourceKinds.PodmanHost,
    identity: "podman-host-1",
    attributes: [
      stringAttribute("container.runtime", "podman"),
      stringAttribute("host.name", "podman-host-1"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    findOrCreate: {
      service: PodmanHostService,
      method: "findOrCreateByHostIdentifier",
    },
    heartbeat: { service: PodmanHostService, method: "updateLastSeen" },
  },
  {
    name: "host",
    method: "autoDiscoverHost",
    kind: DiscoveredResourceKinds.Host,
    identity: "vm-1",
    attributes: [
      stringAttribute("host.name", "vm-1"),
      stringAttribute("os.type", "linux"),
    ] as JSONArray,
    findOrCreate: {
      service: HostService,
      method: "findOrCreateByHostIdentifier",
    },
    heartbeat: { service: HostService, method: "updateLastSeen" },
  },
];

const foreignKeyRefusal: (table: string, id: string) => Error = (
  table: string,
  id: string,
): Error => {
  return Object.assign(
    new Error(
      `insert or update on table "X" violates foreign key constraint "FK_x"`,
    ),
    {
      code: "23503",
      detail: `Key (parentId)=(${id}) is not present in table "${table}".`,
    },
  );
};

describe.each(DISCOVER_CASES)(
  "$name: deleted while its agent keeps sending",
  ({
    method,
    kind,
    identity,
    attributes,
    findOrCreate,
    heartbeat,
  }: DiscoverCase) => {
    let redis: Map<string, string>;
    // The ids Postgres no longer has.
    let goneIds: Set<string>;
    // What find-or-create answers, in order.
    let rows: Array<string>;
    let heartbeats: Array<string>;

    const key: string = DiscoveredResourceIdCache.keyFor(PROJECT_ID, identity);
    const redisKey: string = `${kind.namespace}:${key}`;

    function findOrCreateMock(): jest.Mock {
      return findOrCreate.service[findOrCreate.method] as jest.Mock;
    }

    async function discover(): Promise<string | null> {
      const id: ObjectID | null = (await baseService[method]({
        projectId: PROJECT_ID,
        attributes: attributes,
      })) as ObjectID | null;

      return id ? id.toString() : null;
    }

    beforeEach(() => {
      redis = new Map<string, string>();
      goneIds = new Set<string>();
      rows = [GONE_ID, NEW_ID];
      heartbeats = [];

      OtelIngestBaseService.clearInProcessMemos();
      SingleFlight.clear();

      jest
        .spyOn(GlobalCache, "getString")
        .mockImplementation(async (ns: string, k: string) => {
          return redis.get(`${ns}:${k}`) ?? null;
        });
      jest
        .spyOn(GlobalCache, "setString")
        .mockImplementation(async (ns: string, k: string, value: string) => {
          redis.set(`${ns}:${k}`, value);
        });
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockImplementation(async (ns: string, k: string) => {
          redis.delete(`${ns}:${k}`);
        });
      jest
        .spyOn(GlobalCache, "deleteKeyIfValue")
        .mockImplementation(async (ns: string, k: string, value: string) => {
          if (redis.get(`${ns}:${k}`) !== value) {
            return false;
          }
          redis.delete(`${ns}:${k}`);
          return true;
        });
      // Fences open: every discovery runs its maintenance.
      jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);

      jest
        .spyOn(findOrCreate.service, findOrCreate.method)
        .mockImplementation(async () => {
          const id: string = rows.shift() || NEW_ID;
          return { _id: id, id: new ObjectID(id) };
        });

      jest
        .spyOn(heartbeat.service, heartbeat.method)
        .mockImplementation(
          async (id: unknown): Promise<ResourceHeartbeatResult> => {
            const idStr: string = (id as ObjectID).toString();
            heartbeats.push(idStr);
            return { isRowGone: goneIds.has(idStr) };
          },
        );

      jest
        .spyOn(LabelService, "findOrCreateLabelsByNames")
        .mockResolvedValue([]);
      jest
        .spyOn(RumApplicationClientService, "recordClient")
        .mockResolvedValue(undefined);
      jest
        .spyOn(baseService, "tryLinkHostToProxmoxGuest")
        .mockResolvedValue(undefined);
      jest.spyOn(logger, "info").mockImplementation(() => {
        return undefined as never;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      OtelIngestBaseService.clearInProcessMemos();
      SingleFlight.clear();
    });

    test("a deleted resource is found or created again on the next batch, and the batch carries it", async () => {
      await expect(discover()).resolves.toBe(GONE_ID);
      expect(redis.get(redisKey)).toBe(GONE_ID);

      // The person deletes it: DatabaseService tells the cache.
      goneIds.add(GONE_ID);
      await DiscoveredResourceIdCache.afterDelete({
        tableName: kind.tableName,
        rows: [
          {
            _id: GONE_ID,
            projectId: PROJECT_ID,
            [kind.identityColumn!]: identity.toUpperCase(),
          },
        ],
      });
      expect(redis.has(redisKey)).toBe(false);

      await expect(discover()).resolves.toBe(NEW_ID);

      expect(findOrCreateMock()).toHaveBeenCalledTimes(2);
      expect(redis.get(redisKey)).toBe(NEW_ID);
      // Its heartbeat goes to the row that answers now.
      expect(heartbeats[heartbeats.length - 1]).toBe(NEW_ID);
    });

    test("an id cached before the delete is caught by its heartbeat, forgotten and resolved again", async () => {
      // Redis still holds the deleted row's id, as it did for a day before.
      redis.set(redisKey, GONE_ID);
      goneIds.add(GONE_ID);
      rows = [NEW_ID];

      await expect(discover()).resolves.toBe(NEW_ID);

      // The gone row's heartbeat, then the new row's - in the same batch.
      expect(heartbeats).toEqual([GONE_ID, NEW_ID]);
      expect(findOrCreateMock()).toHaveBeenCalledTimes(1);
      expect(redis.get(redisKey)).toBe(NEW_ID);
    });

    test("later batches go straight to the new row: no Postgres, no Redis read", async () => {
      redis.set(redisKey, GONE_ID);
      goneIds.add(GONE_ID);
      rows = [NEW_ID];

      await discover();

      (GlobalCache.getString as jest.Mock).mockClear();
      findOrCreateMock().mockClear();

      await expect(discover()).resolves.toBe(NEW_ID);
      await expect(discover()).resolves.toBe(NEW_ID);

      expect(findOrCreateMock()).not.toHaveBeenCalled();
      expect(GlobalCache.getString).not.toHaveBeenCalled();
    });

    test("a resource whose row is there keeps its id: nothing is resolved again", async () => {
      redis.set(redisKey, GONE_ID);

      await expect(discover()).resolves.toBe(GONE_ID);

      expect(findOrCreateMock()).not.toHaveBeenCalled();
      expect(redis.get(redisKey)).toBe(GONE_ID);
      expect(heartbeats).toEqual([GONE_ID]);
    });

    test("an id another worker already resolved again is left in Redis", async () => {
      redis.set(redisKey, GONE_ID);
      goneIds.add(GONE_ID);
      rows = [NEW_ID];

      // Another worker re-pointed the key between this batch's read and its heartbeat.
      (heartbeat.service[heartbeat.method] as jest.Mock).mockImplementationOnce(
        async (): Promise<ResourceHeartbeatResult> => {
          heartbeats.push(GONE_ID);
          redis.set(redisKey, NEW_ID);
          return { isRowGone: true };
        },
      );

      await expect(discover()).resolves.toBe(NEW_ID);

      expect(GlobalCache.deleteKeyIfValue).toHaveBeenCalledWith(
        kind.namespace,
        key,
        GONE_ID,
      );
      expect(redis.get(redisKey)).toBe(NEW_ID);
    });

    test("a write refused by the foreign key to the gone row is retried once, against the row that answers now", async () => {
      redis.set(redisKey, GONE_ID);
      // The fence is held by another worker: no heartbeat this batch.
      jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(false);
      rows = [NEW_ID];

      await expect(discover()).resolves.toBe(GONE_ID);

      const writes: Array<string> = [];

      const landedOn: string = await baseService["writeForDiscoveredResource"]({
        kind: kind,
        id: GONE_ID,
        write: async (id: ObjectID): Promise<void> => {
          writes.push(id.toString());
          if (id.toString() === GONE_ID) {
            throw foreignKeyRefusal(kind.tableName, GONE_ID);
          }
        },
      });

      expect(landedOn).toBe(NEW_ID);
      expect(writes).toEqual([GONE_ID, NEW_ID]);
      expect(redis.get(redisKey)).toBe(NEW_ID);

      // The next write of the same batch goes to the new row at once.
      const again: string = await baseService["writeForDiscoveredResource"]({
        kind: kind,
        id: GONE_ID,
        write: async (id: ObjectID): Promise<void> => {
          writes.push(id.toString());
          if (id.toString() === GONE_ID) {
            throw foreignKeyRefusal(kind.tableName, GONE_ID);
          }
        },
      });

      expect(again).toBe(NEW_ID);
      expect(findOrCreateMock()).toHaveBeenCalledTimes(1);
    });

    test("an id this process never resolved is not guessed: the refusal is thrown as before", async () => {
      const refusal: Error = foreignKeyRefusal(kind.tableName, GONE_ID);

      await expect(
        baseService["writeForDiscoveredResource"]({
          kind: kind,
          id: GONE_ID,
          write: async (): Promise<void> => {
            throw refusal;
          },
        }),
      ).rejects.toBe(refusal);

      expect(findOrCreateMock()).not.toHaveBeenCalled();
    });

    test("a fresh lookup that answers with the refused id itself is no replacement: the refusal is thrown, the id is not written to again or cached", async () => {
      redis.set(redisKey, GONE_ID);
      jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(false);
      await discover();

      // Postgres answers with the very id the write was refused for.
      rows = [GONE_ID];
      const refusal: Error = foreignKeyRefusal(kind.tableName, GONE_ID);
      const writes: Array<string> = [];

      await expect(
        baseService["writeForDiscoveredResource"]({
          kind: kind,
          id: GONE_ID,
          write: async (id: ObjectID): Promise<void> => {
            writes.push(id.toString());
            throw refusal;
          },
        }),
      ).rejects.toBe(refusal);

      expect(writes).toEqual([GONE_ID]);
      expect(findOrCreateMock()).toHaveBeenCalledTimes(1);
      expect(redis.has(redisKey)).toBe(false);
    });

    test("a heartbeat that finds the row gone, and a lookup that answers with the same id, carries nothing this batch", async () => {
      redis.set(redisKey, GONE_ID);
      goneIds.add(GONE_ID);
      rows = [GONE_ID];

      await expect(discover()).resolves.toBeNull();

      // No second heartbeat against the id, and it is not cached again.
      expect(heartbeats).toEqual([GONE_ID]);
      expect(redis.has(redisKey)).toBe(false);
    });

    test("any other failure - another table's missing row included - is thrown as before", async () => {
      redis.set(redisKey, GONE_ID);
      jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(false);
      await discover();

      const timeout: Error = new Error("Query read timeout");
      await expect(
        baseService["writeForDiscoveredResource"]({
          kind: kind,
          id: GONE_ID,
          write: async (): Promise<void> => {
            throw timeout;
          },
        }),
      ).rejects.toBe(timeout);

      const projectGone: Error = foreignKeyRefusal("Project", GONE_ID);
      await expect(
        baseService["writeForDiscoveredResource"]({
          kind: kind,
          id: GONE_ID,
          write: async (): Promise<void> => {
            throw projectGone;
          },
        }),
      ).rejects.toBe(projectGone);

      expect(findOrCreateMock()).not.toHaveBeenCalled();
    });

    test("writes that find the row gone together resolve it once", async () => {
      redis.set(redisKey, GONE_ID);
      jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(false);
      rows = [NEW_ID];
      await discover();

      const write: (id: ObjectID) => Promise<void> = async (
        id: ObjectID,
      ): Promise<void> => {
        if (id.toString() === GONE_ID) {
          throw foreignKeyRefusal(kind.tableName, GONE_ID);
        }
      };

      const landed: Array<string> = await Promise.all(
        [1, 2, 3].map(async (): Promise<string> => {
          return await baseService["writeForDiscoveredResource"]({
            kind: kind,
            id: GONE_ID,
            write: write,
          });
        }),
      );

      expect(landed).toEqual([NEW_ID, NEW_ID, NEW_ID]);
      expect(findOrCreateMock()).toHaveBeenCalledTimes(1);
    });

    test("every casing the telemetry reports is one key: a new resource is resolved once", async () => {
      await discover();

      OtelIngestBaseService.clearInProcessMemos();

      const shouted: JSONArray = (attributes as Array<JSONObject>).map(
        (attribute: JSONObject): JSONObject => {
          const value: JSONObject = attribute["value"] as JSONObject;
          return {
            ...attribute,
            value: {
              stringValue: String(value["stringValue"]).toUpperCase(),
            },
          };
        },
      ) as JSONArray;

      /*
       * Only the identity matters here; a platform written in capitals still
       * names the same platform after normalisation.
       */
      await baseService[method]({
        projectId: PROJECT_ID,
        attributes: shouted,
      });

      expect(findOrCreateMock()).toHaveBeenCalledTimes(1);
    });
  },
);

describe("a gone host is resolved past HostService's own memo", () => {
  beforeEach(() => {
    OtelIngestBaseService.clearInProcessMemos();
    SingleFlight.clear();

    const redis: Map<string, string> = new Map<string, string>([
      [
        `host-id:${DiscoveredResourceIdCache.keyFor(PROJECT_ID, "vm-1")}`,
        GONE_ID,
      ],
    ]);

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (ns: string, k: string) => {
        return redis.get(`${ns}:${k}`) ?? null;
      });
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(async (ns: string, k: string, value: string) => {
        redis.set(`${ns}:${k}`, value);
      });
    jest.spyOn(GlobalCache, "deleteKeyIfValue").mockResolvedValue(true);
    jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
    jest
      .spyOn(HostService, "updateLastSeen")
      .mockImplementation(
        async (id: ObjectID): Promise<ResourceHeartbeatResult> => {
          return { isRowGone: id.toString() === GONE_ID };
        },
      );
    jest
      .spyOn(baseService, "tryLinkHostToProxmoxGuest")
      .mockResolvedValue(undefined);
    jest.spyOn(logger, "info").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OtelIngestBaseService.clearInProcessMemos();
  });

  test("the fresh lookup asks with bypassMemo, and nothing else does", async () => {
    const findOrCreate: jest.SpyInstance = jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockResolvedValue({ _id: NEW_ID } as never);

    const id: ObjectID | null = await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: [
        stringAttribute("host.name", "vm-1"),
        stringAttribute("os.type", "linux"),
      ],
    });

    expect(id?.toString()).toBe(NEW_ID);
    expect(findOrCreate).toHaveBeenCalledTimes(1);
    expect(findOrCreate.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      hostIdentifier: "vm-1",
      bypassMemo: true,
    });
  });

  test("the proxmox guest link is written for the row that answers, never for the gone one", async () => {
    jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockResolvedValue({ _id: NEW_ID } as never);

    await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: [
        stringAttribute("host.name", "vm-1"),
        stringAttribute("os.type", "linux"),
      ],
    });

    const linked: Array<string> = (
      baseService["tryLinkHostToProxmoxGuest"] as jest.Mock
    ).mock.calls.map((call: Array<unknown>): string => {
      return ((call[0] as { hostId: ObjectID }).hostId as ObjectID).toString();
    });

    expect(linked).toEqual([NEW_ID]);
  });
});
