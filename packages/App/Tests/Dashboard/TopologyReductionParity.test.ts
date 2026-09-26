import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  TopologyApiLimits,
  TopologyInfrastructureNodeJSON,
} from "Common/Types/Topology/TopologyApi";
import {
  FLAT_TYPES,
  SeededRandom,
  generateEstate,
} from "Common/Tests/Server/Utils/Topology/TopologyEstateGenerator";
import {
  ReferenceEstate,
  ReferenceInfrastructureResponse,
  ReferenceItem,
  ReferenceRelationship,
  ReferenceScope,
  ReferenceServiceMapResponse,
  referenceInfrastructure,
  referenceServiceMap,
} from "Common/Tests/Server/Utils/Topology/TopologyReference";
import { isDeepStrictEqual } from "util";

/*
 * The architecture's central claim, checked by brute force: the maps the
 * Dashboard builds from the Topology API's reduced payloads are EXACTLY the
 * maps it used to build from the whole inventory.
 *
 * For thousands of seeded random estates this suite builds each map twice
 * with the current view models:
 *
 *   original  every non-archived item and every in-range relationship of the
 *             project, in the old list order — what the old UseTopologyData
 *             handed the maps (buildTopologyInventoryItemQuery + an in-range
 *             relationship query, soft-deleted rows excluded by the ORM);
 *   reduced   the reference server output (TopologyReference, written from
 *             the spec independently of the SQL) run through the real
 *             decoders, decodeServiceMapResponse / decodeInfrastructureResponse,
 *             exactly as the page receives it;
 *
 * and compares a canonical projection of the two, with inactive resources
 * hidden and shown. The Postgres differential suite
 * (Common/Tests/Server/Utils/Topology/TopologyQueriesDifferentialPostgres)
 * closes the loop by proving the real SQL returns what the reference does.
 *
 * Collections are the one intentional difference: a flat type too large to
 * ship becomes one node with counts. Estates with a collection are compared
 * after folding the original map's items of that type into the node the
 * collection should be, and do not place services on those items (a
 * collection never carries placements — by design).
 */

jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

import {
  InfrastructureNode,
  InfrastructureServiceCall,
  InfrastructureTopologyModel,
  InfrastructureTrafficLink,
  buildInfrastructureTopologyModel,
  collectMapCards,
  computeInfrastructureTraffic,
  collectionName,
  collectionNodeId,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import {
  ServiceMapEdge,
  ServiceMapEntry,
  ServiceMapModel,
  TrafficTotals,
  buildServiceMapModel,
  summarizeRunsOn,
} from "../../FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";
import {
  decodeInfrastructureResponse,
  decodeServiceMapResponse,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyApi";
import {
  InfrastructureData,
  ServiceMapData,
  TopologyEntity,
  TopologyRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";

const PROJECT_ID: string = "5f0c3a9e-8d7b-4c2a-9e1f-0a1b2c3d4e5f";
const OTHER_PROJECT_ID: string = "6a1d4b0f-9e8c-4d3b-8f20-1b2c3d4e5f60";
/* Minute-aligned: the old client did not floor, the server does. */
const RANGE_START: Date = new Date("2026-09-20T10:00:00.000Z");
const GENERATED_AT: string = "2026-09-20T13:00:00.000Z";

const INCLUDE_INACTIVE: Array<boolean> = [false, true];

// ------------------------------------------------------ the old snapshot

/* The old list API's order: createdAt DESC, _id ASC. */
function compareListOrder(
  left: { createdAt: Date; id: string },
  right: { createdAt: Date; id: string },
): number {
  return (
    right.createdAt.getTime() - left.createdAt.getTime() ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

interface OriginalSnapshot {
  entities: Array<TopologyEntity>;
  relationships: Array<TopologyRelationship>;
}

/*
 * What the old UseTopologyData loaded: the project's non-archived items
 * (buildTopologyInventoryItemQuery) and its relationships seen since the
 * range start, soft-deleted rows excluded by the ORM, both in list order.
 */
function originalSnapshot(estate: ReferenceEstate): OriginalSnapshot {
  const entities: Array<TopologyEntity> = estate.items
    .filter((item: ReferenceItem): boolean => {
      return item.projectId === PROJECT_ID && !item.isArchived && !item.deleted;
    })
    .sort(compareListOrder)
    .map((item: ReferenceItem): TopologyEntity => {
      const entity: TopologyEntity = {
        entityKey: item.key,
        entityType: item.type,
        source: item.source,
      };
      if (item.name !== null) {
        entity.displayName = item.name;
      }
      if (item.lastSeenAt !== null) {
        entity.lastSeenAt = item.lastSeenAt;
      }
      if (item.descriptiveAttributes !== null) {
        entity.descriptiveAttributes = item.descriptiveAttributes as JSONObject;
      }
      if (item.identifyingAttributes !== null) {
        entity.identifyingAttributes = item.identifyingAttributes as JSONObject;
      }
      return entity;
    });

  const relationships: Array<TopologyRelationship> = estate.relationships
    .filter((relationship: ReferenceRelationship): boolean => {
      return (
        relationship.projectId === PROJECT_ID &&
        !relationship.deleted &&
        relationship.lastSeenAt !== null &&
        relationship.lastSeenAt.getTime() >= RANGE_START.getTime()
      );
    })
    .sort(compareListOrder)
    .map((relationship: ReferenceRelationship): TopologyRelationship => {
      const row: TopologyRelationship = {
        fromEntityKey: relationship.from,
        toEntityKey: relationship.to,
        relationshipType: relationship.type,
      };
      if (relationship.callCount !== null) {
        row.callCount = relationship.callCount;
      }
      if (relationship.errorCount !== null) {
        row.errorCount = relationship.errorCount;
      }
      if (relationship.avgDurationMs !== null) {
        row.avgDurationMs = relationship.avgDurationMs;
      }
      return row;
    });

  return { entities, relationships };
}

// -------------------------------------------------- canonical projections

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1e6) / 1e6;
}

function roundTotals(totals: TrafficTotals): TrafficTotals {
  return {
    calls: totals.calls,
    errors: totals.errors,
    avgDurationMs: round(totals.avgDurationMs),
  };
}

interface NodeProjection {
  id: string;
  kind: string;
  name: string;
  entityType: string | null;
  parentId: string | null;
  childIds: Array<string>;
  resourceCount: number;
  countsByType: Array<[string, number]>;
  serviceKeys: Array<string>;
  isActive: boolean;
  lastSeenAt: number | null;
}

interface InfrastructureProjection {
  nodes: Array<NodeProjection>;
  rootIds: Array<string>;
  resourceCount: number;
  inactiveCount: number;
  groupCount: number;
  serviceCalls: Array<JSONObject>;
  /* The traffic the overview map draws between its cards. */
  traffic: Array<JSONObject>;
}

function projectCall(call: InfrastructureServiceCall): JSONObject {
  return {
    from: call.from,
    to: call.to,
    calls: call.calls,
    errors: call.errors,
    avgDurationMs: round(call.avgDurationMs),
  };
}

/*
 * Only cards that run a service can carry traffic, and a collection never
 * does, so the overview's lines are comparable even where the original map
 * drew a collection's items one by one.
 */
function projectTraffic(model: InfrastructureTopologyModel): Array<JSONObject> {
  return computeInfrastructureTraffic(model, collectMapCards(model, null))
    .links.map((link: InfrastructureTrafficLink): JSONObject => {
      return {
        from: link.from,
        to: link.to,
        calls: link.calls,
        errors: link.errors,
        avgDurationMs: round(link.avgDurationMs),
        health: link.health,
        serviceCalls: link.serviceCalls.map(projectCall),
      };
    })
    .sort((left: JSONObject, right: JSONObject): number => {
      const a: string = `${left["from"]}\u0000${left["to"]}`;
      const b: string = `${right["from"]}\u0000${right["to"]}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
}

function sortedCounts(counts: Map<string, number>): Array<[string, number]> {
  return Array.from(counts.entries()).sort(
    (left: [string, number], right: [string, number]): number => {
      return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
    },
  );
}

function projectNode(node: InfrastructureNode): NodeProjection {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    entityType: node.entityType,
    parentId: node.parentId,
    childIds: [...node.childIds].sort(),
    resourceCount: node.resourceCount,
    countsByType: sortedCounts(node.countsByType),
    serviceKeys: [...node.serviceKeys],
    isActive: node.isActive,
    lastSeenAt: node.lastSeenAt ? node.lastSeenAt.getTime() : null,
  };
}

/*
 * The model as a plain value. `collectedTypes` folds a model built from ALL
 * items into what the reduced model shows instead: the items of each
 * collected (flat, never nested, never grouped) type leave their category
 * and one collection node with their count, activity and recency takes
 * their place.
 */
function projectInfrastructure(
  model: InfrastructureTopologyModel,
  collectedTypes: Set<string> = new Set<string>(),
): InfrastructureProjection {
  const folded: Map<string, NodeProjection> = new Map<string, NodeProjection>();
  const replacement: Map<string, string> = new Map<string, string>();
  for (const node of model.nodes.values()) {
    if (
      node.kind !== "resource" ||
      !collectedTypes.has(node.entityType || "")
    ) {
      continue;
    }
    const id: string = collectionNodeId(node.entityType!);
    replacement.set(node.id, id);
    let collection: NodeProjection | undefined = folded.get(id);
    if (!collection) {
      collection = {
        id,
        kind: "collection",
        name: collectionName(node.entityType!),
        entityType: node.entityType,
        parentId: node.parentId,
        childIds: [],
        resourceCount: 0,
        countsByType: [[node.entityType!, 0]],
        serviceKeys: [],
        isActive: false,
        lastSeenAt: null,
      };
      folded.set(id, collection);
    }
    collection.resourceCount++;
    collection.countsByType[0]![1]++;
    collection.isActive = collection.isActive || node.isActive;
    const lastSeen: number | null = node.lastSeenAt
      ? node.lastSeenAt.getTime()
      : null;
    if (
      lastSeen !== null &&
      (collection.lastSeenAt === null || lastSeen > collection.lastSeenAt)
    ) {
      collection.lastSeenAt = lastSeen;
    }
  }

  const nodes: Array<NodeProjection> = [];
  for (const node of model.nodes.values()) {
    if (replacement.has(node.id)) {
      continue;
    }
    const projection: NodeProjection = projectNode(node);
    if (replacement.size > 0) {
      projection.childIds = Array.from(
        new Set<string>(
          projection.childIds.map((id: string): string => {
            return replacement.get(id) || id;
          }),
        ),
      ).sort();
    }
    nodes.push(projection);
  }
  nodes.push(...folded.values());
  nodes.sort((left: NodeProjection, right: NodeProjection): number => {
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  return {
    nodes,
    rootIds: [...model.rootIds],
    resourceCount: model.resourceCount,
    inactiveCount: model.inactiveCount,
    groupCount: model.groupCount,
    serviceCalls: model.serviceCalls.map(projectCall),
    traffic: projectTraffic(model),
  };
}

interface ServiceMapProjection {
  entries: Array<JSONObject>;
  edges: Array<JSONObject>;
  inactiveServiceCount: number;
}

function projectServiceMap(model: ServiceMapModel): ServiceMapProjection {
  return {
    entries: model.entries.map((entry: ServiceMapEntry): JSONObject => {
      return {
        key: entry.key,
        label: entry.label,
        kind: entry.kind,
        typeLabel: entry.typeLabel,
        detailLabel: entry.detailLabel,
        inbound: roundTotals(entry.inbound) as unknown as JSONObject,
        outbound: roundTotals(entry.outbound) as unknown as JSONObject,
        callers: entry.callers,
        dependencies: entry.dependencies,
        health: entry.health,
        status: entry.status,
        needsAttention: entry.needsAttention,
        runsOn: entry.runsOn as unknown as JSONObject,
        runsOnSummary: summarizeRunsOn(entry.runsOn),
      };
    }),
    edges: model.edges.map((edge: ServiceMapEdge): JSONObject => {
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        calls: edge.calls,
        errors: edge.errors,
        avgDurationMs: round(edge.avgDurationMs),
        health: edge.health,
      };
    }),
    inactiveServiceCount: model.inactiveServiceCount,
  };
}

// ------------------------------------------------------------- the check

interface ParityCoverage {
  estates: number;
  dependencyEdges: number;
  runsOnEntries: number;
  detailLabels: number;
  inactiveServices: number;
  nestedNodes: number;
  activeFallbacks: number;
  noActiveFallback: number;
  cycles: number;
  groups: number;
  hiddenResources: number;
  collections: number;
  silentCollections: number;
  serviceCalls: number;
  trafficLinks: number;
}

function emptyCoverage(): ParityCoverage {
  return {
    estates: 0,
    dependencyEdges: 0,
    runsOnEntries: 0,
    detailLabels: 0,
    inactiveServices: 0,
    nestedNodes: 0,
    activeFallbacks: 0,
    noActiveFallback: 0,
    cycles: 0,
    groups: 0,
    hiddenResources: 0,
    collections: 0,
    silentCollections: 0,
    serviceCalls: 0,
    trafficLinks: 0,
  };
}

/* Whether following `parent` from some node returns to it. */
function hasContainmentCycle(
  response: ReferenceInfrastructureResponse,
): boolean {
  for (let start: number = 0; start < response.nodes.length; start++) {
    const seen: Set<number> = new Set<number>();
    let cursor: number | undefined = start;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        return true;
      }
      seen.add(cursor);
      cursor = response.nodes[cursor]!.parent;
    }
  }
  return false;
}

/*
 * Builds both maps both ways for one estate and fails with the seed and a
 * diff on the first difference.
 */
function checkParity(
  label: string,
  estate: ReferenceEstate,
  coverage: ParityCoverage,
): void {
  const scope: ReferenceScope = {
    projectId: PROJECT_ID,
    rangeStart: RANGE_START,
  };
  const original: OriginalSnapshot = originalSnapshot(estate);

  const serviceMapJson: ReferenceServiceMapResponse = referenceServiceMap(
    estate,
    scope,
  );
  const serviceMap: ServiceMapData = decodeServiceMapResponse({
    ...serviceMapJson,
    generatedAt: GENERATED_AT,
  } as unknown as JSONObject);
  const infrastructureJson: ReferenceInfrastructureResponse =
    referenceInfrastructure(estate, scope);
  const infrastructure: InfrastructureData = decodeInfrastructureResponse({
    ...infrastructureJson,
    generatedAt: GENERATED_AT,
  } as unknown as JSONObject);
  expect(serviceMap.rangeStart.getTime()).toBe(RANGE_START.getTime());
  expect(infrastructure.rangeStart.getTime()).toBe(RANGE_START.getTime());

  const collectedTypes: Set<string> = new Set<string>(
    infrastructure.collections.map(
      (collection: { entityType: string }): string => {
        return collection.entityType;
      },
    ),
  );

  coverage.estates++;
  coverage.collections += collectedTypes.size;
  for (const collection of infrastructure.collections) {
    if (collection.active === 0) {
      coverage.silentCollections++;
    }
  }
  if (hasContainmentCycle(infrastructureJson)) {
    coverage.cycles++;
  }
  for (const node of infrastructureJson.nodes) {
    if (node.parent !== undefined) {
      coverage.nestedNodes++;
    }
    if (node.activeParent !== undefined) {
      if (node.activeParent >= 0) {
        coverage.activeFallbacks++;
      } else {
        coverage.noActiveFallback++;
      }
    }
  }

  for (const includeInactive of INCLUDE_INACTIVE) {
    const expectedServiceMap: ServiceMapProjection = projectServiceMap(
      buildServiceMapModel(original.entities, original.relationships, {
        rangeStart: RANGE_START,
        includeInactive,
      }),
    );
    const reducedServiceMapModel: ServiceMapModel = buildServiceMapModel(
      serviceMap.entities,
      serviceMap.relationships,
      {
        rangeStart: serviceMap.rangeStart,
        includeInactive,
        runsOnCounts: serviceMap.runsOnCounts,
      },
    );
    const actualServiceMap: ServiceMapProjection = projectServiceMap(
      reducedServiceMapModel,
    );
    if (!isDeepStrictEqual(actualServiceMap, expectedServiceMap)) {
      expect({
        estate: label,
        view: "Service Map",
        includeInactive,
        map: actualServiceMap,
      }).toEqual({
        estate: label,
        view: "Service Map",
        includeInactive,
        map: expectedServiceMap,
      });
    }
    coverage.dependencyEdges += reducedServiceMapModel.edges.length;
    coverage.inactiveServices += reducedServiceMapModel.inactiveServiceCount;
    for (const entry of reducedServiceMapModel.entries) {
      if (entry.runsOn.length > 0) {
        coverage.runsOnEntries++;
      }
      if (entry.detailLabel) {
        coverage.detailLabels++;
      }
    }

    const expectedInfrastructure: InfrastructureProjection =
      projectInfrastructure(
        buildInfrastructureTopologyModel(
          original.entities,
          original.relationships,
          { rangeStart: RANGE_START, includeInactive },
        ),
        collectedTypes,
      );
    const reducedInfrastructureModel: InfrastructureTopologyModel =
      buildInfrastructureTopologyModel(
        infrastructure.entities,
        infrastructure.relationships,
        {
          rangeStart: infrastructure.rangeStart,
          includeInactive,
          collections: infrastructure.collections,
        },
      );
    const actualInfrastructure: InfrastructureProjection =
      projectInfrastructure(reducedInfrastructureModel);
    if (!isDeepStrictEqual(actualInfrastructure, expectedInfrastructure)) {
      expect({
        estate: label,
        view: "Infrastructure",
        includeInactive,
        map: actualInfrastructure,
      }).toEqual({
        estate: label,
        view: "Infrastructure",
        includeInactive,
        map: expectedInfrastructure,
      });
    }
    coverage.groups += reducedInfrastructureModel.groupCount;
    coverage.hiddenResources += reducedInfrastructureModel.inactiveCount;
    coverage.serviceCalls += reducedInfrastructureModel.serviceCalls.length;
    coverage.trafficLinks += actualInfrastructure.traffic.length;
  }
}

// ----------------------------------------------------------------- tests

describe("Topology reduction parity: reduced payloads draw the maps the whole inventory drew", () => {
  test("thousands of random estates, inactive resources hidden and shown", () => {
    const coverage: ParityCoverage = emptyCoverage();
    for (let seed: number = 1; seed <= 3000; seed++) {
      const random: SeededRandom = new SeededRandom(seed);
      const estate: ReferenceEstate = generateEstate(random, {
        projectId: PROJECT_ID,
        otherProjectId: OTHER_PROJECT_ID,
        rangeStart: RANGE_START,
        size: seed % 10 === 0 ? 120 : 40,
        liveDuplicateKeys: false,
      });
      checkParity(`seed ${seed}`, estate, coverage);
    }

    /* The estates really exercised what the claim is about. */
    expect(coverage.estates).toBe(3000);
    expect(coverage.dependencyEdges).toBeGreaterThan(1000);
    expect(coverage.runsOnEntries).toBeGreaterThan(500);
    expect(coverage.detailLabels).toBeGreaterThan(500);
    expect(coverage.inactiveServices).toBeGreaterThan(100);
    expect(coverage.nestedNodes).toBeGreaterThan(5000);
    expect(coverage.activeFallbacks).toBeGreaterThan(200);
    expect(coverage.noActiveFallback).toBeGreaterThan(200);
    expect(coverage.cycles).toBeGreaterThan(100);
    expect(coverage.groups).toBeGreaterThan(50);
    expect(coverage.hiddenResources).toBeGreaterThan(1000);
    expect(coverage.collections).toBe(0);
    expect(coverage.serviceCalls).toBeGreaterThan(300);
    expect(coverage.trafficLinks).toBeGreaterThan(750);
  });

  test("estates with a flat type above the inline budget: equal once its items are folded into the collection", () => {
    const coverage: ParityCoverage = emptyCoverage();
    for (let seed: number = 1; seed <= 24; seed++) {
      const random: SeededRandom = new SeededRandom(100_000 + seed);
      /* Every other estate sits exactly on the budget: not a collection. */
      const extra: number = seed % 2 === 0 ? random.int(1, 150) : 0;
      const collectionType: string = FLAT_TYPES[seed % FLAT_TYPES.length]!;
      const estate: ReferenceEstate = generateEstate(random, {
        projectId: PROJECT_ID,
        otherProjectId: OTHER_PROJECT_ID,
        rangeStart: RANGE_START,
        size: 60,
        liveDuplicateKeys: false,
        collectionType,
        collectionCount: TopologyApiLimits.InlineFlatItemsPerType + extra,
        placementsOntoCollection: false,
      });
      /*
       * Now and then nothing of the type reported in range: with inactive
       * resources hidden the collection disappears and all of it is counted
       * as hidden.
       */
      if (seed % 4 === 0) {
        for (const item of estate.items) {
          if (item.type === collectionType) {
            item.source = EntitySource.Discovered;
            item.lastSeenAt = new Date(RANGE_START.getTime() - 86_400_000);
          }
        }
      }
      checkParity(`collection seed ${seed}`, estate, coverage);
    }
    /*
     * Hidden, archived and other-project rows of the type are generated
     * too, so an estate "on the budget" may or may not cross it; most of
     * the ones with extra items do.
     */
    expect(coverage.collections).toBeGreaterThanOrEqual(10);
    expect(coverage.silentCollections).toBeGreaterThanOrEqual(3);
  });

  /*
   * Containment ties are broken by the container's key in COLLATE "C" order
   * on the server (spec, semantics 4) — code-point order on a UTF-8
   * database — and the Dashboard now breaks them the same way
   * (InfrastructureNesting.computeInfraParenting uses compareCodePoints).
   * UTF-16 code-unit order (`<`) agrees for every key up to U+FFFF but not
   * where a character beyond it meets one in U+E000..U+FFFF: with candidate
   * containers keyed "node-\uFFFD" and "node-\u{1F600}" (same relationship
   * priority, same type), code points pick "node-\uFFFD" (U+FFFD < U+1F600)
   * while code units picked "node-\u{1F600}" (0xD83D < 0xFFFD). The server
   * ships only the container it picked, so a code-unit client used to nest
   * the pod under a different node than the whole inventory gave it.
   */
  test("a container tie between a key beyond the BMP and one in U+E000..U+FFFF is broken by code point, as on the server", () => {
    const at: Date = new Date(RANGE_START.getTime() + 60_000);
    const item: (key: string, type: string) => ReferenceItem = (
      key: string,
      type: string,
    ): ReferenceItem => {
      return {
        id: `00000000-0000-4000-a000-${String(key.length).padStart(12, "0")}`,
        projectId: PROJECT_ID,
        key,
        type,
        name: key,
        source: EntitySource.Discovered,
        lastSeenAt: at,
        firstSeenAt: null,
        createdAt: at,
        isArchived: false,
        deleted: false,
        descriptiveAttributes: null,
        identifyingAttributes: null,
        resourceType: null,
        resourceId: null,
      };
    };
    const partOf: (
      from: string,
      to: string,
      id: string,
    ) => ReferenceRelationship = (
      from: string,
      to: string,
      id: string,
    ): ReferenceRelationship => {
      return {
        id,
        projectId: PROJECT_ID,
        from,
        to,
        type: EntityRelationshipType.PartOf,
        lastSeenAt: at,
        createdAt: at,
        deleted: false,
        callCount: null,
        errorCount: null,
        avgDurationMs: null,
      };
    };
    const inPlane: string = "node-\uFFFD";
    const beyondPlane: string = "node-\u{1F600}";
    const estate: ReferenceEstate = {
      items: [
        item("pod", EntityType.KubernetesPod),
        item(inPlane, EntityType.KubernetesNode),
        item(beyondPlane, EntityType.KubernetesNode),
      ],
      relationships: [
        partOf("pod", inPlane, "00000000-0000-4000-a000-000000000001"),
        partOf("pod", beyondPlane, "00000000-0000-4000-a000-000000000002"),
      ],
    };
    checkParity("non-BMP container tie", estate, emptyCoverage());

    /* Whichever order the relationships arrive in. */
    checkParity(
      "non-BMP container tie, relationships reversed",
      { ...estate, relationships: [...estate.relationships].reverse() },
      emptyCoverage(),
    );

    /* And the winner is the server's: the pod nests under U+FFFD's node. */
    const original: OriginalSnapshot = originalSnapshot(estate);
    for (const relationships of [
      original.relationships,
      [...original.relationships].reverse(),
    ]) {
      const model: InfrastructureTopologyModel =
        buildInfrastructureTopologyModel(original.entities, relationships, {
          rangeStart: RANGE_START,
        });
      expect(model.nodes.get("pod")?.parentId).toBe(inPlane);
    }
    const shipped: ReferenceInfrastructureResponse = referenceInfrastructure(
      estate,
      { projectId: PROJECT_ID, rangeStart: RANGE_START },
    );
    const pod: TopologyInfrastructureNodeJSON | undefined = shipped.nodes.find(
      (node: TopologyInfrastructureNodeJSON): boolean => {
        return node.key === "pod";
      },
    );
    expect(pod?.parent).toBeDefined();
    expect(shipped.nodes[pod!.parent!]?.key).toBe(inPlane);
  });
});
