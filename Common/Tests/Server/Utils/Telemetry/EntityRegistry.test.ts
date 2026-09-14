import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import InventoryItemRelationshipService from "../../../../Server/Services/InventoryItemRelationshipService";
import logger from "../../../../Server/Utils/Logger";
import {
  DEFAULT_ENTITY_BUDGET,
  FALLBACK_ENTITY_BUDGET,
  REGISTRY_PROMOTED_TYPES,
  getEntityBudget,
  reconcileByNaturalKey,
  reconcileEntityRegistryThrottled,
  shouldWarnEntityBudgetOnce,
} from "../../../../Server/Utils/Telemetry/EntityRegistry";
import { ExtractedEntity } from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import ObjectID from "../../../../Types/ObjectID";
import EntityType from "../../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
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
 * The row fence (EntityRegistryRowFence) and the legacy Host retirement
 * (EntityRegistryRetirement) have their own suites. This one pins the rest of
 * the registry's decision logic: which entity types are promoted, the per-type
 * budgets, the budget-warning fence, the set-level fence and promotion gate in
 * reconcileEntityRegistryThrottled, and the select / bump composition in
 * reconcileByNaturalKey. Postgres and Redis are mocked throughout.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

function entity(
  entityType: EntityType,
  entityKey: string,
  extra: Partial<ExtractedEntity> = {},
): ExtractedEntity {
  return {
    entityType,
    entityKey,
    identifyingAttributes: { id: entityKey },
    ...extra,
  };
}

beforeEach(() => {
  jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);
  jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
  jest
    .spyOn(InventoryItemService, "reconcileEntities")
    .mockResolvedValue(undefined);
  jest
    .spyOn(InventoryItemRelationshipService, "reconcileRelationships")
    .mockResolvedValue(undefined);
  jest.spyOn(InventoryItemService, "hardDeleteBy").mockResolvedValue(0);
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "warn").mockImplementation(() => {});
  jest.spyOn(logger, "debug").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("REGISTRY_PROMOTED_TYPES", () => {
  test.each([
    EntityType.Container,
    EntityType.Process,
    EntityType.ServiceInstance,
    EntityType.TelemetrySdk,
  ])("high-churn type %s is membership-only", (entityType: EntityType) => {
    expect(REGISTRY_PROMOTED_TYPES.has(entityType)).toBe(false);
  });

  test("every other entity type is promoted", () => {
    const membershipOnly: Array<EntityType> = [
      EntityType.Container,
      EntityType.Process,
      EntityType.ServiceInstance,
      EntityType.TelemetrySdk,
    ];

    for (const entityType of Object.values(EntityType)) {
      expect(REGISTRY_PROMOTED_TYPES.has(entityType)).toBe(
        !membershipOnly.includes(entityType),
      );
    }

    expect(REGISTRY_PROMOTED_TYPES.size).toBe(
      Object.values(EntityType).length - membershipOnly.length,
    );
  });
});

describe("getEntityBudget", () => {
  test("uses the declared budget for each configured type", () => {
    for (const [entityType, budget] of DEFAULT_ENTITY_BUDGET) {
      expect(getEntityBudget(entityType)).toBe(budget);
    }
  });

  test.each([
    [EntityType.Service, 10000],
    [EntityType.KubernetesNode, 1000],
    [EntityType.KubernetesPod, 5000],
    [EntityType.VMwareHost, 2000],
  ])("%s has a budget of %d", (entityType: EntityType, budget: number) => {
    expect(getEntityBudget(entityType)).toBe(budget);
  });

  test("types without a declared budget use the fallback", () => {
    expect(DEFAULT_ENTITY_BUDGET.has(EntityType.DockerSwarmTask)).toBe(false);
    expect(getEntityBudget(EntityType.DockerSwarmTask)).toBe(
      FALLBACK_ENTITY_BUDGET,
    );
    expect(FALLBACK_ENTITY_BUDGET).toBe(5000);
  });

  test("every declared budget is a positive integer on a promoted type", () => {
    for (const [entityType, budget] of DEFAULT_ENTITY_BUDGET) {
      expect(Number.isInteger(budget)).toBe(true);
      expect(budget).toBeGreaterThan(0);
      expect(REGISTRY_PROMOTED_TYPES.has(entityType)).toBe(true);
    }
  });
});

describe("shouldWarnEntityBudgetOnce", () => {
  test("claims a fence scoped to project and entity type", async () => {
    await expect(
      shouldWarnEntityBudgetOnce({
        projectId: PROJECT_ID,
        entityType: EntityType.KubernetesPod,
      }),
    ).resolves.toBe(true);

    const call: Array<unknown> = (GlobalCache.setStringIfNotExists as jest.Mock)
      .mock.calls[0]!;
    expect(call[0]).toBe("otel-maintenance-fence");
    expect(call[1]).toBe(
      `entity-budget-warn:${PROJECT_ID.toString()}:${EntityType.KubernetesPod}`,
    );
    expect(call[2]).toBe("1");
    const ttl: number = (call[3] as { expiresInSeconds: number })
      .expiresInSeconds;
    // 5 minutes, with up to 25% jitter.
    expect(ttl).toBeGreaterThanOrEqual(300);
    expect(ttl).toBeLessThanOrEqual(375);
  });

  test("returns false once the window is already claimed", async () => {
    (GlobalCache.setStringIfNotExists as jest.Mock).mockResolvedValueOnce(
      false as never,
    );

    await expect(
      shouldWarnEntityBudgetOnce({
        projectId: PROJECT_ID,
        entityType: EntityType.Host,
      }),
    ).resolves.toBe(false);
  });

  test("a cache outage defaults to warning", async () => {
    (GlobalCache.setStringIfNotExists as jest.Mock).mockRejectedValueOnce(
      new Error("redis down") as never,
    );

    await expect(
      shouldWarnEntityBudgetOnce({
        projectId: PROJECT_ID,
        entityType: EntityType.Host,
      }),
    ).resolves.toBe(true);
  });
});

describe("reconcileEntityRegistryThrottled — promotion gate", () => {
  test("nothing to promote means no fence claim and no writes", async () => {
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [
        entity(EntityType.Container, "c1"),
        entity(EntityType.Process, "p1"),
        entity(EntityType.Host, "h1", { membershipOnly: true }),
      ],
    });

    expect(GlobalCache.setStringIfNotExists).not.toHaveBeenCalled();
    expect(InventoryItemService.reconcileEntities).not.toHaveBeenCalled();
    expect(
      InventoryItemRelationshipService.reconcileRelationships,
    ).not.toHaveBeenCalled();
  });

  test("an empty batch is a no-op", async () => {
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [],
    });

    expect(GlobalCache.setStringIfNotExists).not.toHaveBeenCalled();
  });

  test("only promoted, non-membership-only entities are reconciled", async () => {
    const pod: ExtractedEntity = entity(EntityType.KubernetesPod, "pod");
    const duplicatePod: ExtractedEntity = entity(
      EntityType.KubernetesPod,
      "pod-dup",
      { membershipOnly: true },
    );
    const host: ExtractedEntity = entity(EntityType.Host, "host", {
      membershipOnly: false,
    });

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [
        entity(EntityType.Container, "container"),
        pod,
        duplicatePod,
        host,
        entity(EntityType.TelemetrySdk, "sdk"),
      ],
    });

    expect(InventoryItemService.reconcileEntities).toHaveBeenCalledTimes(1);
    expect(InventoryItemService.reconcileEntities).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      entities: [pod, host],
    });
  });

  test("non-Host retirements are ignored entirely", async () => {
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [],
      retiredEntities: [
        {
          entityType: EntityType.KubernetesPod,
          entityKey: "pod",
          identifyingAttributes: { "host.name": "x" },
        },
      ],
    });

    expect(GlobalCache.setStringIfNotExists).not.toHaveBeenCalled();
    expect(InventoryItemService.hardDeleteBy).not.toHaveBeenCalled();
  });
});

describe("reconcileEntityRegistryThrottled — set-level fence", () => {
  function fenceKeyOfCall(index: number): string {
    return (GlobalCache.setStringIfNotExists as jest.Mock).mock.calls[
      index
    ]![1] as string;
  }

  test("a claimed fence skips all writes", async () => {
    (GlobalCache.setStringIfNotExists as jest.Mock).mockResolvedValue(
      false as never,
    );

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [
        entity(EntityType.KubernetesPod, "pod"),
        entity(EntityType.KubernetesNode, "node"),
      ],
    });

    expect(InventoryItemService.reconcileEntities).not.toHaveBeenCalled();
    expect(
      InventoryItemRelationshipService.reconcileRelationships,
    ).not.toHaveBeenCalled();
  });

  test("a cache outage fails open and reconciles", async () => {
    (GlobalCache.setStringIfNotExists as jest.Mock).mockRejectedValue(
      new Error("redis down") as never,
    );

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [entity(EntityType.Host, "host")],
    });

    expect(InventoryItemService.reconcileEntities).toHaveBeenCalledTimes(1);
  });

  test("the fence key is a fixed-width hash in the shared namespace", async () => {
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [entity(EntityType.Host, "k".repeat(4000))],
    });

    const call: Array<unknown> = (GlobalCache.setStringIfNotExists as jest.Mock)
      .mock.calls[0]!;
    expect(call[0]).toBe("otel-maintenance-fence");
    expect(call[1]).toMatch(/^entity-reconcile:[0-9a-f]{40}$/);
  });

  test("entity order does not change the fence", async () => {
    const a: ExtractedEntity = entity(EntityType.Host, "aaa");
    const b: ExtractedEntity = entity(EntityType.KubernetesNode, "bbb");

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [a, b],
    });
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [b, a],
    });

    expect(fenceKeyOfCall(0)).toBe(fenceKeyOfCall(1));
  });

  test("membership-only churn does not change the fence", async () => {
    const pod: ExtractedEntity = entity(EntityType.KubernetesPod, "pod");

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [pod, entity(EntityType.Container, "container-run-1")],
    });
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [pod, entity(EntityType.Container, "container-run-2")],
    });

    expect(fenceKeyOfCall(0)).toBe(fenceKeyOfCall(1));
  });

  test("a changed promoted set changes the fence", async () => {
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [entity(EntityType.KubernetesPod, "pod-1")],
    });
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [entity(EntityType.KubernetesPod, "pod-2")],
    });

    expect(fenceKeyOfCall(0)).not.toBe(fenceKeyOfCall(1));
  });

  test("the same set in another project has its own fence", async () => {
    const pod: ExtractedEntity = entity(EntityType.KubernetesPod, "pod");

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [pod],
    });
    await reconcileEntityRegistryThrottled({
      projectId: ObjectID.generate(),
      entities: [pod],
    });

    expect(fenceKeyOfCall(0)).not.toBe(fenceKeyOfCall(1));
  });
});

describe("reconcileEntityRegistryThrottled — topology edges", () => {
  test("derives co-occurrence edges among promoted entities only", async () => {
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [
        entity(EntityType.KubernetesPod, "pod"),
        entity(EntityType.KubernetesNode, "node"),
        entity(EntityType.KubernetesCluster, "cluster"),
        // Container → pod would be a PartOf edge, but containers never promote.
        entity(EntityType.Container, "container"),
      ],
    });

    expect(
      InventoryItemRelationshipService.reconcileRelationships,
    ).toHaveBeenCalledTimes(1);

    const edges: Array<EntityRelationshipEdge> = (
      (InventoryItemRelationshipService.reconcileRelationships as jest.Mock)
        .mock.calls[0]![0] as { edges: Array<EntityRelationshipEdge> }
    ).edges;

    const summary: Array<string> = edges
      .map((edge: EntityRelationshipEdge): string => {
        return `${edge.fromEntityKey}-${edge.relationshipType}->${edge.toEntityKey}`;
      })
      .sort();

    expect(summary).toEqual(
      [
        `node-${EntityRelationshipType.MemberOf}->cluster`,
        `pod-${EntityRelationshipType.MemberOf}->cluster`,
        `pod-${EntityRelationshipType.RunsOn}->node`,
      ].sort(),
    );
    for (const edge of edges) {
      expect(edge.fromEntityKey).not.toBe("container");
      expect(edge.toEntityKey).not.toBe("container");
    }
  });

  test("a set with no related type pairs writes no relationships", async () => {
    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [
        entity(EntityType.Host, "host"),
        entity(EntityType.CephCluster, "ceph"),
      ],
    });

    expect(InventoryItemService.reconcileEntities).toHaveBeenCalledTimes(1);
    expect(
      InventoryItemRelationshipService.reconcileRelationships,
    ).not.toHaveBeenCalled();
  });

  test("edges are reconciled after the entities they reference", async () => {
    const order: Array<string> = [];
    (InventoryItemService.reconcileEntities as jest.Mock).mockImplementation(
      async (): Promise<void> => {
        order.push("entities");
      },
    );
    (
      InventoryItemRelationshipService.reconcileRelationships as jest.Mock
    ).mockImplementation(async (): Promise<void> => {
      order.push("edges");
    });

    await reconcileEntityRegistryThrottled({
      projectId: PROJECT_ID,
      entities: [
        entity(EntityType.Service, "svc"),
        entity(EntityType.Host, "host"),
      ],
    });

    expect(order).toEqual(["entities", "edges"]);
  });

  test("a registry failure is swallowed and logged, and skips the edges", async () => {
    (InventoryItemService.reconcileEntities as jest.Mock).mockRejectedValue(
      new Error("postgres down") as never,
    );

    await expect(
      reconcileEntityRegistryThrottled({
        projectId: PROJECT_ID,
        entities: [
          entity(EntityType.Service, "svc"),
          entity(EntityType.Host, "host"),
        ],
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
    expect(
      InventoryItemRelationshipService.reconcileRelationships,
    ).not.toHaveBeenCalled();
  });

  test("a relationship failure is swallowed too", async () => {
    (
      InventoryItemRelationshipService.reconcileRelationships as jest.Mock
    ).mockRejectedValue(new Error("unique violation") as never);

    await expect(
      reconcileEntityRegistryThrottled({
        projectId: PROJECT_ID,
        entities: [
          entity(EntityType.Service, "svc"),
          entity(EntityType.Host, "host"),
        ],
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("reconcileByNaturalKey — select and bump composition", () => {
  const ROW_ID: ObjectID = ObjectID.generate();

  function row(): InventoryItem {
    const item: InventoryItem = new InventoryItem();
    item.id = ROW_ID;
    item._id = ROW_ID.toString();
    item.displayName = "old";
    return item;
  }

  beforeEach(() => {
    jest
      .spyOn(InventoryItemService, "findOneBy")
      .mockResolvedValue(row() as never);
    jest
      .spyOn(InventoryItemService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockResolvedValue(true as never);
    jest
      .spyOn(InventoryItemService, "create")
      .mockImplementation(async (input: any): Promise<any> => {
        return input.data;
      });
  });

  test("always selects _id and merges caller-supplied columns", async () => {
    await reconcileByNaturalKey<InventoryItem>({
      service: InventoryItemService,
      query: { projectId: PROJECT_ID, entityKey: "k" },
      lastSeenAt: new Date(),
      describe: "entity k",
      rowFenceId: "p:k",
      select: { displayName: true, descriptiveAttributes: true },
      buildModel: row,
    });

    expect(InventoryItemService.findOneBy).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID, entityKey: "k" },
      select: { _id: true, displayName: true, descriptiveAttributes: true },
      props: { isRoot: true },
    });
  });

  test("without buildUpdate the bump is lastSeenAt only", async () => {
    const lastSeenAt: Date = new Date("2026-09-13T12:00:00.000Z");

    await reconcileByNaturalKey<InventoryItem>({
      service: InventoryItemService,
      query: { projectId: PROJECT_ID, entityKey: "k" },
      lastSeenAt,
      describe: "entity k",
      rowFenceId: "p:k",
      buildModel: row,
    });

    expect(
      InventoryItemService.updateColumnsByIdIfUnlockedWithoutHooks,
    ).toHaveBeenCalledWith({ id: ROW_ID, data: { lastSeenAt } });
  });

  test("buildUpdate receives the existing row and its fields join the bump", async () => {
    const lastSeenAt: Date = new Date("2026-09-13T12:00:00.000Z");
    const seen: Array<string | undefined> = [];

    await reconcileByNaturalKey<InventoryItem>({
      service: InventoryItemService,
      query: { projectId: PROJECT_ID, entityKey: "k" },
      lastSeenAt,
      describe: "entity k",
      rowFenceId: "p:k",
      buildModel: row,
      buildUpdate: (existing: InventoryItem): any => {
        seen.push(existing.displayName);
        return { displayName: "new" };
      },
    });

    expect(seen).toEqual(["old"]);
    expect(
      InventoryItemService.updateColumnsByIdIfUnlockedWithoutHooks,
    ).toHaveBeenCalledWith({
      id: ROW_ID,
      data: { lastSeenAt, displayName: "new" },
    });
  });

  test("beforeCreate is never consulted for an existing row", async () => {
    let gateCalls: number = 0;
    const beforeCreate: () => Promise<boolean> = async (): Promise<boolean> => {
      gateCalls++;
      return false;
    };

    await reconcileByNaturalKey<InventoryItem>({
      service: InventoryItemService,
      query: { projectId: PROJECT_ID, entityKey: "k" },
      lastSeenAt: new Date(),
      describe: "entity k",
      rowFenceId: "p:k",
      buildModel: row,
      beforeCreate,
    });

    expect(gateCalls).toBe(0);
    expect(InventoryItemService.create).not.toHaveBeenCalled();
  });

  test("a missing row is created from buildModel with root props once the gate passes", async () => {
    (InventoryItemService.findOneBy as jest.Mock).mockResolvedValue(
      null as never,
    );
    const model: InventoryItem = row();

    await reconcileByNaturalKey<InventoryItem>({
      service: InventoryItemService,
      query: { projectId: PROJECT_ID, entityKey: "k" },
      lastSeenAt: new Date(),
      describe: "entity k",
      rowFenceId: "p:k",
      buildModel: (): InventoryItem => {
        return model;
      },
      beforeCreate: async (): Promise<boolean> => {
        return true;
      },
    });

    expect(InventoryItemService.create).toHaveBeenCalledWith({
      data: model,
      props: { isRoot: true },
    });
    expect(
      InventoryItemService.updateColumnsByIdIfUnlockedWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(GlobalCache.deleteKey).not.toHaveBeenCalled();
  });

  test("an over-budget gate creates nothing", async () => {
    (InventoryItemService.findOneBy as jest.Mock).mockResolvedValue(
      null as never,
    );
    let builds: number = 0;
    const buildModel: () => InventoryItem = (): InventoryItem => {
      builds++;
      return row();
    };

    await reconcileByNaturalKey<InventoryItem>({
      service: InventoryItemService,
      query: { projectId: PROJECT_ID, entityKey: "k" },
      lastSeenAt: new Date(),
      describe: "entity k",
      rowFenceId: "p:k",
      buildModel,
      beforeCreate: async (): Promise<boolean> => {
        return false;
      },
    });

    expect(builds).toBe(0);
    expect(InventoryItemService.create).not.toHaveBeenCalled();
  });

  test("an invalid create is logged at warn with the row description", async () => {
    (InventoryItemService.findOneBy as jest.Mock).mockResolvedValue(
      null as never,
    );
    (InventoryItemService.create as jest.Mock).mockRejectedValue(
      new Error("not-null violation") as never,
    );

    await expect(
      reconcileByNaturalKey<InventoryItem>({
        service: InventoryItemService,
        query: { projectId: PROJECT_ID, entityKey: "k" },
        lastSeenAt: new Date(),
        describe: "entity host/abc",
        rowFenceId: "p:k",
        buildModel: row,
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "EntityRegistry: create failed for entity host/abc:",
    );
  });

  test("a lost create race applies buildUpdate to the winning row", async () => {
    const lastSeenAt: Date = new Date("2026-09-13T12:00:00.000Z");
    const winner: InventoryItem = row();
    winner.displayName = "winner";

    (InventoryItemService.findOneBy as jest.Mock)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(winner as never);
    (InventoryItemService.create as jest.Mock).mockRejectedValue(
      new Error("duplicate key") as never,
    );

    await reconcileByNaturalKey<InventoryItem>({
      service: InventoryItemService,
      query: { projectId: PROJECT_ID, entityKey: "k" },
      lastSeenAt,
      describe: "entity k",
      rowFenceId: "p:k",
      buildModel: row,
      buildUpdate: (existing: InventoryItem): any => {
        return { displayName: `${existing.displayName}!` };
      },
    });

    expect(
      InventoryItemService.updateColumnsByIdIfUnlockedWithoutHooks,
    ).toHaveBeenCalledWith({
      id: ROW_ID,
      data: { lastSeenAt, displayName: "winner!" },
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
