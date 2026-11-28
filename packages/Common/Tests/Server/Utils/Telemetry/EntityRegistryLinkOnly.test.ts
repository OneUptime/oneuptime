import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import HostService from "../../../../Server/Services/HostService";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import InventoryItemRelationshipService from "../../../../Server/Services/InventoryItemRelationshipService";
import logger from "../../../../Server/Utils/Logger";
import {
  reconcileEntityRegistryThrottled,
  retireEntityRegistryIdentitiesBestEffort,
} from "../../../../Server/Utils/Telemetry/EntityRegistry";
import InventoryItem, {
  EntityExtractionResult,
  ExtractedEntity,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import ObjectID from "../../../../Types/ObjectID";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { EntityRelationshipEdge } from "../../../../Utils/Telemetry/EntityRelationship";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A link-only entity (ExtractedEntity.linkOnly, issue #11257) never mints or
 * refreshes a registry row, and is linked to only when the registry already
 * holds its key - registered by an observation that proves it, the Host a
 * machine's own collector registered. So an app in a pod makes no Host item,
 * while an app on a monitored machine is still drawn running on it.
 * Nothing reaches Postgres or Redis.
 */

const PROJECT: ObjectID = ObjectID.generate();

function extract(attributes: Record<string, string>): EntityExtractionResult {
  return InventoryItem.extractEntitiesWithRetirements({
    projectId: PROJECT.toString(),
    attributes,
  });
}

// An app on db-01, through its SDK: service + link-only host.
const APP_ON_MACHINE: Record<string, string> = {
  "service.name": "billing",
  "telemetry.sdk.name": "opentelemetry",
  "telemetry.sdk.language": "go",
  "host.name": "db-01",
  "os.type": "linux",
};

let registeredKeys: Array<{ entityType: EntityType; entityKey: string }> = [];

beforeEach(() => {
  registeredKeys = [];
  jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
  jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
  jest.spyOn(HostService, "findOneBy").mockResolvedValue(null);
  jest.spyOn(InventoryItemService, "hardDeleteBy").mockResolvedValue(0);
  jest
    .spyOn(InventoryItemRelationshipService, "hardDeleteBy")
    .mockResolvedValue(0);
  jest
    .spyOn(InventoryItemService, "reconcileEntities")
    .mockResolvedValue(undefined);
  jest.spyOn(InventoryItemService, "findBy").mockImplementation((async () => {
    return registeredKeys;
  }) as never);
  jest
    .spyOn(InventoryItemRelationshipService, "reconcileRelationships")
    .mockResolvedValue(undefined);
  jest.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function reconciledEntities(): Array<ExtractedEntity> {
  const calls: Array<Array<unknown>> = (
    InventoryItemService.reconcileEntities as jest.Mock
  ).mock.calls;

  return calls.flatMap((call: Array<unknown>): Array<ExtractedEntity> => {
    return (call[0] as { entities: Array<ExtractedEntity> }).entities;
  });
}

function reconciledEdges(): Array<EntityRelationshipEdge> {
  const calls: Array<Array<unknown>> = (
    InventoryItemRelationshipService.reconcileRelationships as jest.Mock
  ).mock.calls;

  return calls.flatMap(
    (call: Array<unknown>): Array<EntityRelationshipEdge> => {
      return (call[0] as { edges: Array<EntityRelationshipEdge> }).edges;
    },
  );
}

describe("reconcileEntityRegistryThrottled with a link-only Host", () => {
  test("never creates or refreshes the Host's row", async () => {
    const result: EntityExtractionResult = extract(APP_ON_MACHINE);

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT,
      entities: result.entities,
    });

    const types: Array<EntityType> = reconciledEntities().map(
      (entity: ExtractedEntity) => {
        return entity.entityType;
      },
    );
    expect(types).toContain(EntityType.Service);
    expect(types).not.toContain(EntityType.Host);
  });

  test("links the app to the Host its machine's collector registered", async () => {
    const result: EntityExtractionResult = extract(APP_ON_MACHINE);
    const host: ExtractedEntity = result.entities.find(
      (entity: ExtractedEntity) => {
        return entity.entityType === EntityType.Host;
      },
    )!;
    registeredKeys = [
      { entityType: EntityType.Host, entityKey: host.entityKey },
    ];

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT,
      entities: result.entities,
    });

    expect(InventoryItemService.findBy).toHaveBeenCalledTimes(1);
    const edges: Array<EntityRelationshipEdge> = reconciledEdges();
    expect(
      edges.some((edge: EntityRelationshipEdge) => {
        return (
          edge.toEntityKey === host.entityKey &&
          edge.relationshipType === EntityRelationshipType.HostedOn
        );
      }),
    ).toBe(true);
  });

  test("links nothing to a Host nobody registered - an app's pod", async () => {
    const result: EntityExtractionResult = extract({
      ...APP_ON_MACHINE,
      "host.name": "shop-worker-6748887dc-2wr95",
    });
    const host: ExtractedEntity = result.entities.find(
      (entity: ExtractedEntity) => {
        return entity.entityType === EntityType.Host;
      },
    )!;

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT,
      entities: result.entities,
    });

    expect(
      reconciledEdges().some((edge: EntityRelationshipEdge) => {
        return (
          edge.toEntityKey === host.entityKey ||
          edge.fromEntityKey === host.entityKey
        );
      }),
    ).toBe(false);
  });

  test("a failed registry read links nothing, and fails nothing", async () => {
    (InventoryItemService.findBy as jest.Mock).mockImplementation((async () => {
      throw new Error("registry unavailable");
    }) as never);

    const result: EntityExtractionResult = extract(APP_ON_MACHINE);

    await expect(
      reconcileEntityRegistryThrottled({
        projectId: PROJECT,
        entities: result.entities,
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  test("a resource of link-only entities alone still reconciles its links", async () => {
    // A Docker Agent container: membership-only container, link-only host.
    const result: EntityExtractionResult = extract({
      "container.id": "8cb880203d29",
      "container.runtime": "docker",
      "host.name": "web-shop-01",
      "os.type": "linux",
    });

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT,
      entities: result.entities,
    });

    expect(InventoryItemService.findBy).toHaveBeenCalledTimes(1);
    expect(reconciledEntities()).toEqual([]);
  });
});

describe("retireEntityRegistryIdentitiesBestEffort and archived Hosts", () => {
  test("asks only for a Host that is not archived to vouch for the row", async () => {
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT,
      retiredEntities: extract({
        "container.runtime": "docker",
        "host.name": "web-shop-01",
      }).retiredEntities!,
    });

    expect(HostService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: PROJECT,
          isArchived: false,
        }),
      }),
    );
    // None is found: the discovered Host row goes.
    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledTimes(1);
  });

  test("a real Host of that name keeps the row", async () => {
    (HostService.findOneBy as jest.Mock).mockResolvedValueOnce({
      _id: ObjectID.generate().toString(),
    } as never);

    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT,
      retiredEntities: extract({
        "service.name": "billing",
        "telemetry.sdk.language": "go",
        "host.name": "db-01",
      }).retiredEntities!,
    });

    expect(InventoryItemService.hardDeleteBy).not.toHaveBeenCalled();
  });
});
