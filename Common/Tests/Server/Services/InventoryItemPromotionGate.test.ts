import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemService from "../../../Server/Services/InventoryItemService";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceService from "../../../Server/Services/ServiceService";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import { ExtractedEntity } from "../../../Server/Utils/Telemetry/TelemetryEntity";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What may become a row in the Inventory registry.
 *
 * Two gates decide it, and they answer different questions. The TYPE gate asks
 * whether this kind of thing belongs in the registry at all — containers,
 * processes, service instances and SDKs are high-churn, so their keys travel on
 * signals but never mint rows. The per-entity `membershipOnly` flag asks
 * whether this particular observation is the resource's entity of that type or
 * a duplicate the producer sent alongside it: one OTLP resource describes one
 * pod, on one node, in one cluster, but nothing stops a producer emitting two
 * `entity_refs` of the same type, and promoting both put two rows in Inventory
 * from a single batch.
 *
 * `reconcileEntities` is public, so it repeats both gates rather than trusting
 * its caller — the cost of a missed gate here is a row that should never have
 * existed, and once created nothing removes it until its TTL expires.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ROW_ID: ObjectID = ObjectID.generate();

let createdRows: Array<InventoryItem>;
let bumps: Array<ObjectID>;

function entity(
  entityType: EntityType,
  overrides: Partial<ExtractedEntity> = {},
): ExtractedEntity {
  return {
    entityType,
    entityKey: "0123456789abcdef",
    identifyingAttributes: { "some.name": "thing" },
    ...overrides,
  };
}

function reconcile(entities: Array<ExtractedEntity>): Promise<void> {
  return InventoryItemService.reconcileEntities({
    projectId: PROJECT_ID,
    entities,
  });
}

beforeEach(() => {
  createdRows = [];
  bumps = [];

  // Both fences open, so every reconcile actually does its work.
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(async () => {
      return true;
    });
  jest.spyOn(GlobalCache, "deleteKey").mockImplementation(async () => {
    return undefined as never;
  });

  const serviceRow: Service = new Service();
  serviceRow.id = SERVICE_ROW_ID;
  serviceRow._id = SERVICE_ROW_ID.toString();
  jest
    .spyOn(ServiceService, "findOneBy")
    .mockImplementation(async (): Promise<Service | null> => {
      return serviceRow;
    });

  jest
    .spyOn(InventoryItemService, "findOneBy")
    .mockImplementation(async (): Promise<InventoryItem | null> => {
      return null;
    });

  jest
    .spyOn(InventoryItemService, "countBy")
    .mockImplementation(async (): Promise<PositiveNumber> => {
      return new PositiveNumber(0);
    });

  jest
    .spyOn(InventoryItemService, "create")
    .mockImplementation(async (createBy: unknown): Promise<InventoryItem> => {
      const data: InventoryItem = (createBy as { data: InventoryItem }).data;
      createdRows.push(data);
      return data;
    });

  jest
    .spyOn(InventoryItemService, "updateColumnsByIdIfUnlockedWithoutHooks")
    .mockImplementation(async (data: unknown): Promise<boolean> => {
      bumps.push((data as { id: ObjectID }).id);
      return true;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("membership-only entities never become rows", () => {
  test.each([
    EntityType.Container,
    EntityType.Process,
    EntityType.ServiceInstance,
    EntityType.TelemetrySdk,
  ])("%s is not promoted by type", async (entityType: EntityType) => {
    await reconcile([entity(entityType)]);

    expect(createdRows).toHaveLength(0);
    expect(bumps).toHaveLength(0);
  });

  test.each([
    EntityType.KubernetesPod,
    EntityType.KubernetesNode,
    EntityType.Service,
    EntityType.Host,
  ])(
    "%s flagged membershipOnly is not promoted even though its type is",
    async (entityType: EntityType) => {
      await reconcile([entity(entityType, { membershipOnly: true })]);

      expect(createdRows).toHaveLength(0);
      expect(bumps).toHaveLength(0);
    },
  );

  test("a demoted duplicate does not suppress the promoted entity beside it", async () => {
    /*
     * The shape `entitiesFromRefs` produces when a producer sends two refs of
     * one type: the first is the entity, the rest are membership keys.
     */
    await reconcile([
      entity(EntityType.KubernetesPod, { entityKey: "aaaaaaaaaaaaaaaa" }),
      entity(EntityType.KubernetesPod, {
        entityKey: "bbbbbbbbbbbbbbbb",
        membershipOnly: true,
      }),
    ]);

    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]!.entityKey).toBe("aaaaaaaaaaaaaaaa");
  });
});

describe("promoted entities still become rows", () => {
  test.each([
    EntityType.Service,
    EntityType.Host,
    EntityType.KubernetesPod,
    EntityType.KubernetesNode,
    EntityType.KubernetesCluster,
    EntityType.KubernetesNamespace,
    EntityType.KubernetesDeployment,
    EntityType.ProxmoxCluster,
    EntityType.CephCluster,
    EntityType.DockerSwarmCluster,
  ])("%s is created as a discovered row", async (entityType: EntityType) => {
    await reconcile([entity(entityType)]);

    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]!.source).toBe(EntitySource.Discovered);
    expect(createdRows[0]!.entityType).toBe(entityType);
  });
});
