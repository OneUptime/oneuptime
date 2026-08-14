import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import HostService from "../../../../Server/Services/HostService";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import InventoryItemRelationshipService from "../../../../Server/Services/InventoryItemRelationshipService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import logger from "../../../../Server/Utils/Logger";
import {
  reconcileEntityRegistryThrottled,
  retireEntityRegistryIdentitiesBestEffort,
} from "../../../../Server/Utils/Telemetry/EntityRegistry";
import {
  ExtractedEntity,
  RetiredEntityIdentity,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import ObjectID from "../../../../Types/ObjectID";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A retirement is a destructive repair, so these tests pin every narrowing
 * predicate at the database boundary. Nothing reaches Postgres or Redis.
 */

const PROJECT_A: ObjectID = ObjectID.generate();
const PROJECT_B: ObjectID = ObjectID.generate();
const LEGACY_HOST_KEY: string = "1111111111111111";

function retiredHost(
  entityKey: string = LEGACY_HOST_KEY,
  hostName: string = "checkout-7d9f",
): RetiredEntityIdentity {
  return {
    entityType: EntityType.Host,
    entityKey,
    identifyingAttributes: { "host.name": hostName },
  };
}

function podEntity(): ExtractedEntity {
  return {
    entityType: EntityType.KubernetesPod,
    entityKey: "2222222222222222",
    identifyingAttributes: { "k8s.pod.uid": "pod-uid-1" },
  };
}

beforeEach(() => {
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
  jest
    .spyOn(InventoryItemRelationshipService, "reconcileRelationships")
    .mockResolvedValue(undefined);
  jest.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("retireEntityRegistryIdentitiesBestEffort", () => {
  test("deletes only the exact discovered Host in the exact project", async () => {
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [retiredHost()],
    });

    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledWith({
      query: {
        projectId: PROJECT_A,
        entityType: EntityType.Host,
        entityKey: LEGACY_HOST_KEY,
        source: EntitySource.Discovered,
      },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("preserves the discovered Host when the same canonical typed Host exists", async () => {
    const findWithSameTextSpy = jest.spyOn(QueryHelper, "findWithSameText");
    (HostService.findOneBy as jest.Mock).mockResolvedValueOnce({
      _id: ObjectID.generate().toString(),
    });

    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [retiredHost(LEGACY_HOST_KEY, "  CHECKOUT-7D9F  ")],
    });

    expect(findWithSameTextSpy).toHaveBeenCalledWith("checkout-7d9f");
    expect(HostService.findOneBy).toHaveBeenCalledWith({
      query: {
        projectId: PROJECT_A,
        hostIdentifier: expect.anything(),
      },
      select: { _id: true },
      props: { isRoot: true },
    });
    expect(InventoryItemService.hardDeleteBy).not.toHaveBeenCalled();
    expect(
      InventoryItemRelationshipService.hardDeleteBy,
    ).not.toHaveBeenCalled();
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      "legacy-kubernetes-host-retirement-completed",
      `${PROJECT_A.toString()}:${LEGACY_HOST_KEY}`,
      "1",
      { expiresInSeconds: 24 * 60 * 60 },
    );
  });

  test("fails closed when the typed Host lookup errors", async () => {
    (HostService.findOneBy as jest.Mock).mockRejectedValueOnce(
      new Error("host table unavailable"),
    );

    await expect(
      retireEntityRegistryIdentitiesBestEffort({
        projectId: PROJECT_A,
        retiredEntities: [retiredHost()],
      }),
    ).resolves.toBeUndefined();

    expect(InventoryItemService.hardDeleteBy).not.toHaveBeenCalled();
    expect(
      InventoryItemRelationshipService.hardDeleteBy,
    ).not.toHaveBeenCalled();
    expect(GlobalCache.setString).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("typed Host lookup failed"),
    );
  });

  test("fails closed when canonical host.name proof is missing", async () => {
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [
        {
          entityType: EntityType.Host,
          entityKey: LEGACY_HOST_KEY,
          identifyingAttributes: {},
        },
      ],
    });

    expect(HostService.findOneBy).not.toHaveBeenCalled();
    expect(InventoryItemService.hardDeleteBy).not.toHaveBeenCalled();
    expect(GlobalCache.setString).not.toHaveBeenCalled();
  });

  test("a completed retirement is fenced for 24 hours", async () => {
    (GlobalCache.getString as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("1");

    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [retiredHost()],
    });
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [retiredHost()],
    });

    expect(HostService.findOneBy).toHaveBeenCalledTimes(1);
    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(InventoryItemRelationshipService.hardDeleteBy).toHaveBeenCalledTimes(
      2,
    );
    expect(GlobalCache.setString).toHaveBeenCalledTimes(1);
  });

  test("a cached Host retirement does not block another identity", async () => {
    const otherHostKey: string = "3333333333333333";
    (GlobalCache.getString as jest.Mock).mockImplementation(
      async (_namespace: unknown, key: unknown): Promise<string | null> => {
        return key === `${PROJECT_A.toString()}:${LEGACY_HOST_KEY}`
          ? "1"
          : null;
      },
    );

    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [
        retiredHost(),
        retiredHost(otherHostKey, "checkout-new-abc"),
      ],
    });

    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ entityKey: otherHostKey }),
      }),
    );
    expect(GlobalCache.setString).toHaveBeenCalledWith(
      "legacy-kubernetes-host-retirement-completed",
      `${PROJECT_A.toString()}:${otherHostKey}`,
      "1",
      { expiresInSeconds: 24 * 60 * 60 },
    );
  });

  test("a cached retirement in one project does not block the same key in another", async () => {
    (GlobalCache.getString as jest.Mock).mockImplementation(
      async (_namespace: unknown, key: unknown): Promise<string | null> => {
        return key === `${PROJECT_A.toString()}:${LEGACY_HOST_KEY}`
          ? "1"
          : null;
      },
    );

    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [retiredHost()],
    });
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_B,
      retiredEntities: [retiredHost()],
    });

    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ projectId: PROJECT_B }),
      }),
    );
  });

  test("a retirement cache read error fails open", async () => {
    (GlobalCache.getString as jest.Mock).mockRejectedValueOnce(
      new Error("redis unavailable"),
    );

    await expect(
      retireEntityRegistryIdentitiesBestEffort({
        projectId: PROJECT_A,
        retiredEntities: [retiredHost()],
      }),
    ).resolves.toBeUndefined();

    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("proceeding with repair"),
    );
  });

  test("a retirement cache write error is swallowed after successful repair", async () => {
    (GlobalCache.setString as jest.Mock).mockRejectedValueOnce(
      new Error("redis unavailable"),
    );

    await expect(
      retireEntityRegistryIdentitiesBestEffort({
        projectId: PROJECT_A,
        retiredEntities: [retiredHost()],
      }),
    ).resolves.toBeUndefined();

    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to cache completed"),
    );
  });

  test("removes both outgoing and incoming discovered edges for that key", async () => {
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [retiredHost()],
    });

    expect(InventoryItemRelationshipService.hardDeleteBy).toHaveBeenCalledTimes(
      2,
    );
    expect(InventoryItemRelationshipService.hardDeleteBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: PROJECT_A,
          fromEntityKey: LEGACY_HOST_KEY,
          source: EntitySource.Discovered,
        },
      }),
    );
    expect(InventoryItemRelationshipService.hardDeleteBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: PROJECT_A,
          toEntityKey: LEGACY_HOST_KEY,
          source: EntitySource.Discovered,
        },
      }),
    );
  });

  test("never accepts a retirement for a non-Host type", async () => {
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [
        {
          entityType: EntityType.Service,
          entityKey: LEGACY_HOST_KEY,
          identifyingAttributes: { "service.name": "checkout" },
        },
      ],
    });

    expect(InventoryItemService.hardDeleteBy).not.toHaveBeenCalled();
    expect(
      InventoryItemRelationshipService.hardDeleteBy,
    ).not.toHaveBeenCalled();
  });

  test("deduplicates repeated proof for the same Host key", async () => {
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [retiredHost(), retiredHost(), retiredHost()],
    });

    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(InventoryItemRelationshipService.hardDeleteBy).toHaveBeenCalledTimes(
      2,
    );
  });

  test("keeps projects isolated even when their short entity keys match", async () => {
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [retiredHost()],
    });
    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_B,
      retiredEntities: [retiredHost()],
    });

    const queries: Array<Record<string, unknown>> = (
      InventoryItemService.hardDeleteBy as jest.Mock
    ).mock.calls.map((call: Array<unknown>) => {
      return (call[0] as { query: Record<string, unknown> }).query;
    });
    expect(
      queries.map((query: Record<string, unknown>) => query["projectId"]),
    ).toEqual([PROJECT_A, PROJECT_B]);
  });

  test("an endpoint delete failure is swallowed and preserves its edges", async () => {
    (InventoryItemService.hardDeleteBy as jest.Mock).mockRejectedValueOnce(
      new Error("postgres unavailable"),
    );

    await expect(
      retireEntityRegistryIdentitiesBestEffort({
        projectId: PROJECT_A,
        retiredEntities: [retiredHost()],
      }),
    ).resolves.toBeUndefined();

    expect(
      InventoryItemRelationshipService.hardDeleteBy,
    ).not.toHaveBeenCalled();
    expect(GlobalCache.setString).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  test("an outgoing-edge failure does not prevent incoming-edge cleanup", async () => {
    (InventoryItemRelationshipService.hardDeleteBy as jest.Mock)
      .mockRejectedValueOnce(new Error("outgoing delete failed"))
      .mockResolvedValue(0);

    await expect(
      retireEntityRegistryIdentitiesBestEffort({
        projectId: PROJECT_A,
        retiredEntities: [retiredHost()],
      }),
    ).resolves.toBeUndefined();

    expect(InventoryItemRelationshipService.hardDeleteBy).toHaveBeenCalledTimes(
      2,
    );
    expect(
      (InventoryItemRelationshipService.hardDeleteBy as jest.Mock).mock
        .calls[1]![0],
    ).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({
          toEntityKey: LEGACY_HOST_KEY,
        }),
      }),
    );
    expect(GlobalCache.setString).not.toHaveBeenCalled();
  });

  test("batches relationship deletion until no matching edge remains", async () => {
    (InventoryItemRelationshipService.hardDeleteBy as jest.Mock)
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await retireEntityRegistryIdentitiesBestEffort({
      projectId: PROJECT_A,
      retiredEntities: [retiredHost()],
    });

    expect(InventoryItemRelationshipService.hardDeleteBy).toHaveBeenCalledTimes(
      3,
    );
  });
});

describe("reconcileEntityRegistryThrottled retirement plumbing", () => {
  test("retires before reconciling the live Kubernetes entities", async () => {
    const order: Array<string> = [];
    (InventoryItemService.hardDeleteBy as jest.Mock).mockImplementation(
      async (): Promise<number> => {
        order.push("retire");
        return 0;
      },
    );
    (InventoryItemService.reconcileEntities as jest.Mock).mockImplementation(
      async (): Promise<void> => {
        order.push("reconcile");
      },
    );

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_A,
      entities: [podEntity()],
      retiredEntities: [retiredHost()],
    });

    expect(order).toEqual(["retire", "reconcile"]);
  });

  test("a retirement failure cannot block live entity reconciliation", async () => {
    (InventoryItemService.hardDeleteBy as jest.Mock).mockRejectedValueOnce(
      new Error("delete failed"),
    );

    await expect(
      reconcileEntityRegistryThrottled({
        projectId: PROJECT_A,
        entities: [podEntity()],
        retiredEntities: [retiredHost()],
      }),
    ).resolves.toBeUndefined();

    expect(InventoryItemService.reconcileEntities).toHaveBeenCalledWith({
      projectId: PROJECT_A,
      entities: [podEntity()],
    });
  });

  test("a retirement-only observation is still processed", async () => {
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_A,
      entities: [],
      retiredEntities: [retiredHost()],
    });

    expect(InventoryItemService.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(InventoryItemService.reconcileEntities).not.toHaveBeenCalled();
  });

  test("a retirement changes the set fence for the same live entities", async () => {
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_A,
      entities: [podEntity()],
    });

    const fenceWithoutRetirement: string = (
      GlobalCache.setStringIfNotExists as jest.Mock
    ).mock.calls[0]![1] as string;
    (GlobalCache.setStringIfNotExists as jest.Mock).mockClear();

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_A,
      entities: [podEntity()],
      retiredEntities: [retiredHost()],
    });

    const fenceWithRetirement: string = (
      GlobalCache.setStringIfNotExists as jest.Mock
    ).mock.calls[0]![1] as string;
    expect(fenceWithoutRetirement).toMatch(/^entity-reconcile:[0-9a-f]{40}$/);
    expect(fenceWithRetirement).toMatch(/^entity-reconcile:[0-9a-f]{40}$/);
    expect(fenceWithRetirement).not.toBe(fenceWithoutRetirement);
    expect(GlobalCache.setStringIfNotExists).toHaveBeenCalledTimes(1);
  });

  test("no retirement means standalone Host behavior stays unchanged", async () => {
    const standaloneHost: ExtractedEntity = {
      entityType: EntityType.Host,
      entityKey: LEGACY_HOST_KEY,
      identifyingAttributes: { "host.name": "web-1" },
    };

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_A,
      entities: [standaloneHost],
    });

    expect(InventoryItemService.hardDeleteBy).not.toHaveBeenCalled();
    expect(InventoryItemService.reconcileEntities).toHaveBeenCalledWith({
      projectId: PROJECT_A,
      entities: [standaloneHost],
    });
  });
});
