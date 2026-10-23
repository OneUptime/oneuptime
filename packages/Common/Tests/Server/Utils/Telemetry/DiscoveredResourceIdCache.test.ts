import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import DiscoveredResourceIdCache, {
  DISCOVERED_RESOURCE_ID_L1_TTL_IN_MS,
  DiscoveredResourceKind,
  DiscoveredResourceKinds,
} from "../../../../Server/Utils/Telemetry/DiscoveredResourceIdCache";
import logger from "../../../../Server/Utils/Logger";
import Models from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../../Types/ObjectID";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE IDS OF DISCOVERED RESOURCES, AND WHEN ONE STOPS BEING TRUE (issue
 * #5214): a Docker host deleted while its agent kept sending stayed in the
 * ingest caches for a day, so every batch was written against the deleted id
 * and the host never came back. What is pinned here:
 *
 *   - a key folds the reported value as Postgres compares it, so a row's key
 *     can be worked out from the row;
 *   - the two layers (this process's L1, Redis) answer as they always did;
 *   - forgetting a key takes it out of both - in Redis only while it still
 *     names the gone row;
 *   - a delete forgets the ids of the rows it removes, for every kind and
 *     every layer this process can reach (the memos services keep included);
 *   - a change of what a resource is matched on forgets the old key and the
 *     new one; an edit that sends the value back unchanged forgets nothing;
 *   - the catalog names real tables and columns, and the namespaces the
 *     caches always used (so an upgrade keeps every id already cached).
 *
 * Redis is a Map with the GlobalCache semantics the module relies on:
 * deleteKeyIfValue deletes only on a matching value.
 */

const PROJECT_ID: string = "6c8b5e0e-8f3a-4c51-9b52-0a6f2a1d4b10";
const OTHER_PROJECT_ID: string = "0b0f8f3e-5d2c-4a7e-8f1b-9c6d2e3f4a5b";
const HOST_ID: string = "1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b";
const OTHER_HOST_ID: string = "2a3b4c5d-6e7f-4801-9234-56789abcdef0";

let redis: Map<string, string>;
let nowMs: number;

function redisKey(namespace: string, key: string): string {
  return `${namespace}-${key}`;
}

function row(values: Record<string, unknown>): Record<string, unknown> {
  return { ...values };
}

describe("DiscoveredResourceIdCache", () => {
  beforeEach(() => {
    redis = new Map<string, string>();
    nowMs = 1_800_000_000_000;

    DiscoveredResourceIdCache.clearInProcessMemo();

    jest.spyOn(Date, "now").mockImplementation((): number => {
      return nowMs;
    });

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(
        async (namespace: string, key: string): Promise<string | null> => {
          return redis.get(redisKey(namespace, key)) ?? null;
        },
      );
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          redis.set(redisKey(namespace, key), value);
        },
      );
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (namespace: string, key: string) => {
        redis.delete(redisKey(namespace, key));
      });
    jest
      .spyOn(GlobalCache, "deleteKeyIfValue")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
        ): Promise<boolean> => {
          if (redis.get(redisKey(namespace, key)) !== value) {
            return false;
          }
          redis.delete(redisKey(namespace, key));
          return true;
        },
      );
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    DiscoveredResourceIdCache.clearInProcessMemo();
  });

  describe("a key", () => {
    test("is the project and the reported value, folded as findWithSameText folds it", () => {
      expect(DiscoveredResourceIdCache.keyFor(PROJECT_ID, "test01")).toBe(
        `${PROJECT_ID}:test01`,
      );
      expect(
        DiscoveredResourceIdCache.keyFor(new ObjectID(PROJECT_ID), "  TeSt01 "),
      ).toBe(`${PROJECT_ID}:test01`);
    });

    test("is the same for every casing of one host - the casings one row answers for", () => {
      const keys: Set<string> = new Set(
        ["PRIMARY01", "primary01", "Primary01", " primary01\t"].map(
          (name: string): string => {
            return DiscoveredResourceIdCache.keyFor(PROJECT_ID, name);
          },
        ),
      );

      expect(keys.size).toBe(1);
    });

    test("folds exactly what findWithSameText folds: case and the spaces around, nothing inside", () => {
      const folded: unknown = (
        QueryHelper.findWithSameText("  Web 01 ") as unknown as {
          _objectLiteralParameters?: Record<string, unknown>;
          objectLiteralParameters?: Record<string, unknown>;
        }
      ).objectLiteralParameters;

      const parameter: unknown = Object.values(
        (folded as Record<string, unknown>) || {},
      )[0];

      expect(parameter).toBe("web 01");
      expect(DiscoveredResourceIdCache.keyFor(PROJECT_ID, "  Web 01 ")).toBe(
        `${PROJECT_ID}:${parameter}`,
      );
    });

    test("tells projects apart", () => {
      expect(DiscoveredResourceIdCache.keyFor(PROJECT_ID, "test01")).not.toBe(
        DiscoveredResourceIdCache.keyFor(OTHER_PROJECT_ID, "test01"),
      );
    });
  });

  describe("reading and keeping an id", () => {
    const namespace: string = DiscoveredResourceKinds.DockerHost.namespace;
    const key: string = DiscoveredResourceIdCache.keyFor(PROJECT_ID, "test01");

    test("a miss in both layers is null", async () => {
      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        null,
      );
    });

    test("an id kept is read back from the L1, without Redis", async () => {
      await DiscoveredResourceIdCache.set(namespace, key, HOST_ID, 3600);

      expect(GlobalCache.setString).toHaveBeenCalledWith(
        namespace,
        key,
        HOST_ID,
        { expiresInSeconds: 3600 },
      );

      (GlobalCache.getString as jest.Mock).mockClear();

      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        HOST_ID,
      );
      expect(GlobalCache.getString).not.toHaveBeenCalled();
    });

    test("a Redis hit fills the L1, and the L1 keeps answering through a Redis outage", async () => {
      redis.set(redisKey(namespace, key), HOST_ID);

      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        HOST_ID,
      );

      jest
        .spyOn(GlobalCache, "getString")
        .mockRejectedValue(new Error("redis down"));

      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        HOST_ID,
      );
    });

    test("the L1 runs out after a minute and Redis is asked again", async () => {
      redis.set(redisKey(namespace, key), HOST_ID);
      await DiscoveredResourceIdCache.get(namespace, key);

      redis.set(redisKey(namespace, key), OTHER_HOST_ID);

      nowMs += DISCOVERED_RESOURCE_ID_L1_TTL_IN_MS - 1;
      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        HOST_ID,
      );

      nowMs += 2;
      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        OTHER_HOST_ID,
      );
    });

    test("a Redis error with nothing in the L1 is thrown, as GlobalCache throws it", async () => {
      jest
        .spyOn(GlobalCache, "getString")
        .mockRejectedValue(new Error("redis down"));

      await expect(
        DiscoveredResourceIdCache.get(namespace, key),
      ).rejects.toThrow("redis down");
    });

    test("a Redis outage while keeping still leaves this process the id", async () => {
      jest
        .spyOn(GlobalCache, "setString")
        .mockRejectedValue(new Error("redis down"));

      await expect(
        DiscoveredResourceIdCache.set(namespace, key, HOST_ID, 3600),
      ).rejects.toThrow("redis down");

      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        HOST_ID,
      );
    });
  });

  describe("forgetting a key", () => {
    const namespace: string = DiscoveredResourceKinds.DockerHost.namespace;
    const key: string = DiscoveredResourceIdCache.keyFor(PROJECT_ID, "test01");

    test("takes it out of Redis and the L1 while it names the gone row", async () => {
      await DiscoveredResourceIdCache.set(namespace, key, HOST_ID, 3600);

      await DiscoveredResourceIdCache.forget({ namespace, key, id: HOST_ID });

      expect(redis.has(redisKey(namespace, key))).toBe(false);
      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        null,
      );
    });

    test("leaves a key another worker already pointed at the row that answers now", async () => {
      await DiscoveredResourceIdCache.set(namespace, key, OTHER_HOST_ID, 3600);

      await DiscoveredResourceIdCache.forget({ namespace, key, id: HOST_ID });

      expect(redis.get(redisKey(namespace, key))).toBe(OTHER_HOST_ID);
      (GlobalCache.getString as jest.Mock).mockClear();
      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        OTHER_HOST_ID,
      );
      // Still answered by the L1: its entry named another row.
      expect(GlobalCache.getString).not.toHaveBeenCalled();
    });

    test("without an id, takes it out whatever it holds", async () => {
      await DiscoveredResourceIdCache.set(namespace, key, OTHER_HOST_ID, 3600);

      await DiscoveredResourceIdCache.forget({ namespace, key });

      expect(redis.has(redisKey(namespace, key))).toBe(false);
      expect(GlobalCache.deleteKey).toHaveBeenCalledWith(namespace, key);
      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        null,
      );
    });

    test("a cache that keeps more than the id is forgotten whatever it holds", async () => {
      redis.set(
        redisKey("service-resolution", key),
        JSON.stringify({ serviceId: HOST_ID }),
      );

      await DiscoveredResourceIdCache.forget({
        namespace: "service-resolution",
        key,
        id: HOST_ID,
        storesId: false,
      });

      expect(redis.has(redisKey("service-resolution", key))).toBe(false);
      expect(GlobalCache.deleteKeyIfValue).not.toHaveBeenCalled();
    });

    test("a Redis outage is logged, never thrown, and the L1 is forgotten anyway", async () => {
      await DiscoveredResourceIdCache.set(namespace, key, HOST_ID, 3600);

      jest
        .spyOn(GlobalCache, "deleteKeyIfValue")
        .mockRejectedValue(new Error("redis down"));

      await expect(
        DiscoveredResourceIdCache.forget({ namespace, key, id: HOST_ID }),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalled();

      // The L1 no longer answers; Redis (still holding it) does.
      (GlobalCache.getString as jest.Mock).mockClear();
      await DiscoveredResourceIdCache.get(namespace, key);
      expect(GlobalCache.getString).toHaveBeenCalledTimes(1);
    });
  });

  describe("after a delete", () => {
    test("the deleted Docker host's id is forgotten in Redis and the L1", async () => {
      const namespace: string = DiscoveredResourceKinds.DockerHost.namespace;
      const key: string = DiscoveredResourceIdCache.keyFor(
        PROJECT_ID,
        "test01",
      );
      await DiscoveredResourceIdCache.set(namespace, key, HOST_ID, 3600);

      await DiscoveredResourceIdCache.afterDelete({
        tableName: "DockerHost",
        rows: [
          row({
            _id: HOST_ID,
            projectId: new ObjectID(PROJECT_ID),
            hostIdentifier: "test01",
          }),
        ],
      });

      expect(redis.has(redisKey(namespace, key))).toBe(false);
      await expect(DiscoveredResourceIdCache.get(namespace, key)).resolves.toBe(
        null,
      );
    });

    test("a row stored with another casing forgets the key every casing shares", async () => {
      const namespace: string = DiscoveredResourceKinds.Host.namespace;
      const key: string = DiscoveredResourceIdCache.keyFor(
        PROJECT_ID,
        "primary01",
      );
      redis.set(redisKey(namespace, key), HOST_ID);

      await DiscoveredResourceIdCache.afterDelete({
        tableName: "Host",
        rows: [
          row({
            _id: HOST_ID,
            projectId: PROJECT_ID,
            hostIdentifier: "PRIMARY01",
          }),
        ],
      });

      expect(redis.has(redisKey(namespace, key))).toBe(false);
    });

    test("a key that already names another row - one created since - is left alone", async () => {
      const namespace: string = DiscoveredResourceKinds.DockerHost.namespace;
      const key: string = DiscoveredResourceIdCache.keyFor(
        PROJECT_ID,
        "test01",
      );
      redis.set(redisKey(namespace, key), OTHER_HOST_ID);

      await DiscoveredResourceIdCache.afterDelete({
        tableName: "DockerHost",
        rows: [
          row({
            _id: HOST_ID,
            projectId: PROJECT_ID,
            hostIdentifier: "test01",
          }),
        ],
      });

      expect(redis.get(redisKey(namespace, key))).toBe(OTHER_HOST_ID);
    });

    test("a cloud resource is forgotten as an environment and as a monitored resource", async () => {
      const key: string = DiscoveredResourceIdCache.keyFor(
        PROJECT_ID,
        "aws_ecs|123456789012|us-east-1",
      );
      redis.set(redisKey("cloud-resource-id", key), HOST_ID);
      redis.set(redisKey("cloud-monitored-resource-id", key), HOST_ID);

      await DiscoveredResourceIdCache.afterDelete({
        tableName: "CloudResource",
        rows: [
          row({
            _id: HOST_ID,
            projectId: PROJECT_ID,
            resourceIdentifier: "aws_ecs|123456789012|us-east-1",
          }),
        ],
      });

      expect(redis.has(redisKey("cloud-resource-id", key))).toBe(false);
      expect(redis.has(redisKey("cloud-monitored-resource-id", key))).toBe(
        false,
      );
    });

    test.each(
      Object.entries(DiscoveredResourceKinds).filter(
        ([, kind]: [string, DiscoveredResourceKind]): boolean => {
          return Boolean(kind.identityColumn);
        },
      ),
    )(
      "%s: the key a deleted row's identity makes is forgotten",
      async (_name: string, kind: DiscoveredResourceKind) => {
        const key: string = DiscoveredResourceIdCache.keyFor(
          PROJECT_ID,
          "Resource-1",
        );
        redis.set(
          redisKey(kind.namespace, key),
          kind.storesId ? HOST_ID : JSON.stringify({ serviceId: HOST_ID }),
        );

        await DiscoveredResourceIdCache.afterDelete({
          tableName: kind.tableName,
          rows: [
            row({
              _id: HOST_ID,
              projectId: PROJECT_ID,
              [kind.identityColumn!]: "resource-1",
            }),
          ],
        });

        expect(redis.has(redisKey(kind.namespace, key))).toBe(false);
      },
    );

    test("a database, found by any of its endpoints, is not forgotten by key - nothing is deleted", async () => {
      redis.set(redisKey("database-server-id", `${PROJECT_ID}:x`), HOST_ID);

      await DiscoveredResourceIdCache.afterDelete({
        tableName: "DatabaseServer",
        rows: [row({ _id: HOST_ID, projectId: PROJECT_ID, name: "x" })],
      });

      expect(GlobalCache.deleteKey).not.toHaveBeenCalled();
      expect(GlobalCache.deleteKeyIfValue).not.toHaveBeenCalled();
    });

    test("any other table costs nothing", async () => {
      await DiscoveredResourceIdCache.afterDelete({
        tableName: "Monitor",
        rows: [row({ _id: HOST_ID, projectId: PROJECT_ID, name: "test01" })],
      });

      await DiscoveredResourceIdCache.afterDelete({
        tableName: undefined,
        rows: [row({ _id: HOST_ID })],
      });

      expect(GlobalCache.deleteKey).not.toHaveBeenCalled();
      expect(GlobalCache.deleteKeyIfValue).not.toHaveBeenCalled();
    });

    test("a row without its identity, project or id is skipped, and the others are still forgotten", async () => {
      const namespace: string = DiscoveredResourceKinds.DockerHost.namespace;
      const key: string = DiscoveredResourceIdCache.keyFor(
        PROJECT_ID,
        "test02",
      );
      redis.set(redisKey(namespace, key), OTHER_HOST_ID);

      await DiscoveredResourceIdCache.afterDelete({
        tableName: "DockerHost",
        rows: [
          row({ _id: HOST_ID, projectId: PROJECT_ID }),
          row({ _id: HOST_ID, hostIdentifier: "test01" }),
          row({ projectId: PROJECT_ID, hostIdentifier: "test01" }),
          row({ _id: HOST_ID, projectId: PROJECT_ID, hostIdentifier: "   " }),
          null,
          row({
            _id: OTHER_HOST_ID,
            projectId: PROJECT_ID,
            hostIdentifier: "test02",
          }),
        ],
      });

      expect(GlobalCache.deleteKeyIfValue).toHaveBeenCalledTimes(1);
      expect(redis.has(redisKey(namespace, key))).toBe(false);
    });

    test("the memos services keep of their own are told, and one that throws stops none of the others", async () => {
      const told: Array<string> = [];

      DiscoveredResourceIdCache.registerLocalLayer("PodmanHost", (): void => {
        throw new Error("a memo that throws");
      });
      DiscoveredResourceIdCache.registerLocalLayer(
        "PodmanHost",
        (entry: { projectId: string; identity: string }): void => {
          told.push(`${entry.projectId}/${entry.identity}`);
        },
      );

      await DiscoveredResourceIdCache.afterDelete({
        tableName: "PodmanHost",
        rows: [
          row({
            _id: HOST_ID,
            projectId: PROJECT_ID,
            hostIdentifier: "podman-1",
          }),
        ],
      });

      expect(told).toEqual([`${PROJECT_ID}/podman-1`]);
      expect(logger.warn).toHaveBeenCalled();
    });

    test("a delete never fails because Redis cannot be told", async () => {
      jest
        .spyOn(GlobalCache, "deleteKeyIfValue")
        .mockRejectedValue(new Error("redis down"));

      await expect(
        DiscoveredResourceIdCache.afterDelete({
          tableName: "DockerHost",
          rows: [
            row({
              _id: HOST_ID,
              projectId: PROJECT_ID,
              hostIdentifier: "test01",
            }),
          ],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("after an update", () => {
    const namespace: string = DiscoveredResourceKinds.DockerHost.namespace;
    const oldKey: string = DiscoveredResourceIdCache.keyFor(
      PROJECT_ID,
      "test01",
    );
    const newKey: string = DiscoveredResourceIdCache.keyFor(
      PROJECT_ID,
      "test02",
    );

    test("a new identity forgets the old key and whatever the new one resolved to", async () => {
      redis.set(redisKey(namespace, oldKey), HOST_ID);
      redis.set(redisKey(namespace, newKey), OTHER_HOST_ID);

      await DiscoveredResourceIdCache.afterUpdate({
        tableName: "DockerHost",
        rowsBefore: [
          row({
            _id: HOST_ID,
            projectId: PROJECT_ID,
            hostIdentifier: "test01",
          }),
        ],
        written: { hostIdentifier: "test02" },
      });

      expect(redis.has(redisKey(namespace, oldKey))).toBe(false);
      expect(redis.has(redisKey(namespace, newKey))).toBe(false);
    });

    test("the same identity sent back - an edit form saves every field - forgets nothing", async () => {
      redis.set(redisKey(namespace, oldKey), HOST_ID);

      await DiscoveredResourceIdCache.afterUpdate({
        tableName: "DockerHost",
        rowsBefore: [
          row({
            _id: HOST_ID,
            projectId: PROJECT_ID,
            hostIdentifier: "test01",
          }),
        ],
        written: { hostIdentifier: " TEST01 ", description: "edge box" },
      });

      expect(redis.get(redisKey(namespace, oldKey))).toBe(HOST_ID);
      expect(GlobalCache.deleteKey).not.toHaveBeenCalled();
      expect(GlobalCache.deleteKeyIfValue).not.toHaveBeenCalled();
    });

    test("a write without the identity forgets nothing", async () => {
      redis.set(redisKey(namespace, oldKey), HOST_ID);

      await DiscoveredResourceIdCache.afterUpdate({
        tableName: "DockerHost",
        rowsBefore: [
          row({
            _id: HOST_ID,
            projectId: PROJECT_ID,
            hostIdentifier: "test01",
          }),
        ],
        written: { lastSeenAt: new Date(), otelCollectorStatus: "connected" },
      });

      expect(redis.get(redisKey(namespace, oldKey))).toBe(HOST_ID);
    });

    test("a renamed cluster matched on its name forgets its old name's key", async () => {
      const kind: DiscoveredResourceKind = DiscoveredResourceKinds.CephCluster;
      const key: string = DiscoveredResourceIdCache.keyFor(PROJECT_ID, "ceph");
      redis.set(redisKey(kind.namespace, key), HOST_ID);

      await DiscoveredResourceIdCache.afterUpdate({
        tableName: "CephCluster",
        rowsBefore: [
          row({ _id: HOST_ID, projectId: PROJECT_ID, name: "ceph" }),
        ],
        written: { name: "Production Ceph" },
      });

      expect(redis.has(redisKey(kind.namespace, key))).toBe(false);
    });

    test("the memos services keep are told the old and the new identity", async () => {
      const told: Array<string> = [];

      DiscoveredResourceIdCache.registerLocalLayer(
        "ProxmoxCluster",
        (entry: { projectId: string; identity: string }): void => {
          told.push(entry.identity);
        },
      );

      await DiscoveredResourceIdCache.afterUpdate({
        tableName: "ProxmoxCluster",
        rowsBefore: [row({ _id: HOST_ID, projectId: PROJECT_ID, name: "pve" })],
        written: { name: "pve-eu" },
      });

      expect(told).toEqual(["pve", "pve-eu"]);
    });

    test("any other table costs nothing", async () => {
      await DiscoveredResourceIdCache.afterUpdate({
        tableName: "Incident",
        rowsBefore: [row({ _id: HOST_ID, projectId: PROJECT_ID })],
        written: { title: "x" },
      });

      expect(GlobalCache.deleteKey).not.toHaveBeenCalled();
      expect(GlobalCache.deleteKeyIfValue).not.toHaveBeenCalled();
    });
  });

  describe("what a delete reads", () => {
    test("the identity column of each kind its table is", () => {
      expect(DiscoveredResourceIdCache.getColumnsToRead("DockerHost")).toEqual([
        "hostIdentifier",
      ]);
      expect(
        DiscoveredResourceIdCache.getColumnsToRead("KubernetesCluster"),
      ).toEqual(["clusterIdentifier"]);
      expect(
        DiscoveredResourceIdCache.getColumnsToRead("CloudResource"),
      ).toEqual(["resourceIdentifier"]);
      expect(DiscoveredResourceIdCache.getColumnsToRead("Service")).toEqual([
        "name",
      ]);
    });

    test("nothing for a database, another table or none", () => {
      expect(
        DiscoveredResourceIdCache.getColumnsToRead("DatabaseServer"),
      ).toEqual([]);
      expect(DiscoveredResourceIdCache.getColumnsToRead("Monitor")).toEqual([]);
      expect(DiscoveredResourceIdCache.getColumnsToRead(null)).toEqual([]);
    });
  });

  describe("the catalog", () => {
    const modelsByTable: Map<string, BaseModel> = new Map<string, BaseModel>(
      Models.map((modelType: { new (): BaseModel }): [string, BaseModel] => {
        const model: BaseModel = new modelType();
        return [model.tableName || "", model];
      }),
    );

    test.each(Object.entries(DiscoveredResourceKinds))(
      "%s names a real table, and a real column of it",
      (_name: string, kind: DiscoveredResourceKind) => {
        const model: BaseModel | undefined = modelsByTable.get(kind.tableName);

        expect(model).toBeDefined();

        if (kind.identityColumn) {
          expect(
            model!.getTableColumnMetadata(kind.identityColumn),
          ).toBeDefined();
        }
      },
    );

    test("keeps the namespaces the caches always used, one per kind", () => {
      expect(
        Object.fromEntries(
          Object.entries(DiscoveredResourceKinds).map(
            ([name, kind]: [string, DiscoveredResourceKind]): [
              string,
              string,
            ] => {
              return [name, kind.namespace];
            },
          ),
        ),
      ).toEqual({
        KubernetesCluster: "k8s-cluster-id",
        ProxmoxCluster: "proxmox-cluster-id",
        VMwareVCenter: "vmware-vcenter-id",
        IoTFleet: "iot-fleet-id",
        DockerSwarmCluster: "docker-swarm-cluster-id",
        CephCluster: "ceph-cluster-id",
        StorageArray: "storage-array-id",
        ServerlessFunction: "serverless-function-id",
        CloudResource: "cloud-resource-id",
        CloudMonitoredResource: "cloud-monitored-resource-id",
        DatabaseServer: "database-server-id",
        RumApplication: "rum-application-id",
        DockerHost: "docker-host-id",
        PodmanHost: "podman-host-id",
        Host: "host-id",
        Service: "service-resolution",
      });

      const namespaces: Array<string> = Object.values(
        DiscoveredResourceKinds,
      ).map((kind: DiscoveredResourceKind): string => {
        return kind.namespace;
      });

      expect(new Set(namespaces).size).toBe(namespaces.length);
    });

    test("keeps a day in Redis, an hour for a database and five minutes for a service", () => {
      for (const [name, kind] of Object.entries(DiscoveredResourceKinds)) {
        const expected: number =
          name === "DatabaseServer"
            ? 60 * 60
            : name === "Service"
              ? 5 * 60
              : 24 * 60 * 60;

        expect([name, kind.expiresInSeconds]).toEqual([name, expected]);
      }
    });

    test("keeps ids in the L1 for a minute", () => {
      expect(DISCOVERED_RESOURCE_ID_L1_TTL_IN_MS).toBe(60 * 1000);
    });
  });
});
