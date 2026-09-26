import { describe, expect, test } from "@jest/globals";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import { SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS } from "Common/Types/Topology/TopologyTypeRules";
import { ServiceOperationalStatus } from "../../FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay";
import {
  ServiceMapEdge,
  ServiceMapEntry,
  ServiceMapLayout,
  ServiceMapModel,
  ServiceMapRunsOn,
  ServiceMapVisibility,
  buildServiceMapModel,
  detailLabelForEntity,
  kindForEntityType,
  layoutServiceMap,
  nounForType,
  resolveServiceMapVisibility,
  summarizeRunsOn,
} from "../../FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";
import {
  TopologyEntity,
  TopologyRelationship,
  TopologyRunsOnCount,
  TopologyRunsOnCounts,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * The Service Map view model decides what the map says about every node:
 * which nodes exist (services and what they call), how healthy each one is,
 * where it runs, and what survives a search or focus.
 *
 * It is fed the lean rows of the Topology API (TopologyEntity /
 * TopologyRelationship) plus the server's per-type "runs on" counts; full
 * inventory rows still satisfy the same shapes.
 */

const NOW: Date = new Date("2026-09-07T10:00:00Z");
const RANGE_START: Date = new Date("2026-09-06T10:00:00Z");
const LONG_AGO: Date = new Date("2026-08-01T00:00:00Z");

function entity(
  key: string,
  type: EntityType | string,
  overrides: Partial<TopologyEntity> = {},
): TopologyEntity {
  return {
    entityKey: key,
    displayName: key,
    entityType: type,
    source: EntitySource.Discovered,
    lastSeenAt: NOW,
    ...overrides,
  };
}

function calls(
  from: string,
  to: string,
  callCount?: number,
  errorCount?: number,
  avgDurationMs?: number,
): TopologyRelationship {
  const edge: TopologyRelationship = {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: EntityRelationshipType.DependsOn,
  };
  if (callCount !== undefined) {
    edge.callCount = callCount;
  }
  if (errorCount !== undefined) {
    edge.errorCount = errorCount;
  }
  if (avgDurationMs !== undefined) {
    edge.avgDurationMs = avgDurationMs;
  }
  return edge;
}

function placed(
  from: string,
  to: string,
  type: EntityRelationshipType = EntityRelationshipType.RunsOn,
): TopologyRelationship {
  return { fromEntityKey: from, toEntityKey: to, relationshipType: type };
}

function runsOnCount(
  entityType: string,
  active: number,
  total: number,
): TopologyRunsOnCount {
  return { entityType, active, total };
}

const ENTITIES: Array<TopologyEntity> = [
  entity("web", EntityType.Service, {
    descriptiveAttributes: { "telemetry.sdk.language": "webjs" },
  }),
  entity("api", EntityType.Service, {
    descriptiveAttributes: { "telemetry.sdk.language": "nodejs" },
  }),
  entity("worker", EntityType.Service),
  entity("postgres", EntityType.Database, {
    descriptiveAttributes: { "db.system.name": "postgresql" },
  }),
  entity("stripe", EntityType.RemoteService, {
    descriptiveAttributes: { "network.protocol.name": "http" },
  }),
  entity("pod-1", EntityType.KubernetesPod),
  entity("pod-2", EntityType.KubernetesPod),
  entity("old-host", EntityType.Host, { lastSeenAt: LONG_AGO }),
];

const RELATIONSHIPS: Array<TopologyRelationship> = [
  calls("web", "api", 1000, 5, 100),
  calls("api", "postgres", 3000, 0, 4),
  calls("api", "stripe", 100, 20, 300),
  placed("api", "pod-1"),
  placed("api", "pod-2"),
  placed("api", "old-host", EntityRelationshipType.HostedOn),
];

function model(
  entities: Array<TopologyEntity> = ENTITIES,
  relationships: Array<TopologyRelationship> = RELATIONSHIPS,
  options: Parameters<typeof buildServiceMapModel>[2] = {
    rangeStart: RANGE_START,
  },
): ServiceMapModel {
  return buildServiceMapModel(entities, relationships, options);
}

function entry(result: ServiceMapModel, key: string): ServiceMapEntry {
  return result.entryByKey.get(key)!;
}

function edgeIds(result: ServiceMapModel): Array<string> {
  return result.edges.map((edge: ServiceMapEdge): string => {
    return edge.id;
  });
}

describe("nodes", () => {
  test("include every active service and everything services call", () => {
    const result: ServiceMapModel = model();
    expect(
      result.entries
        .map((item: ServiceMapEntry) => {
          return item.key;
        })
        .sort(),
    ).toEqual(["api", "postgres", "stripe", "web", "worker"]);
    expect(entry(result, "postgres").kind).toBe("database");
    expect(entry(result, "stripe").kind).toBe("remote");
  });

  test("never include infrastructure, even when a service runs on it", () => {
    expect(model().entryByKey.has("pod-1")).toBe(false);
  });

  test("a dependency nothing calls is not drawn", () => {
    const result: ServiceMapModel = model(ENTITIES, [
      calls("web", "api", 10, 0, 1),
    ]);
    expect(result.entryByKey.has("postgres")).toBe(false);
  });

  test("describe language, database engine and protocol in plain words", () => {
    const result: ServiceMapModel = model();
    expect(entry(result, "api").detailLabel).toBe("Node.js");
    expect(entry(result, "web").detailLabel).toBe("Browser");
    expect(entry(result, "postgres").detailLabel).toBe("PostgreSQL");
    expect(entry(result, "stripe").detailLabel).toBe("HTTP");
    expect(entry(result, "worker").detailLabel).toBeNull();
    expect(entry(result, "postgres").typeLabel).toBe("Database");
  });

  test("an unnamed node gets a name that says what it is", () => {
    const result: ServiceMapModel = model(
      [
        entity("svc", EntityType.Service, { displayName: undefined }),
        entity("db", EntityType.Database, { displayName: undefined }),
      ],
      [calls("svc", "db", 1, 0, 1)],
    );
    expect(entry(result, "svc").label).toBe("Unnamed service");
    expect(entry(result, "db").label).toBe("Unnamed dependency");
  });

  test("full inventory rows still build the same map", () => {
    const toItem: (lean: TopologyEntity) => InventoryItem = (
      lean: TopologyEntity,
    ): InventoryItem => {
      const item: InventoryItem = new InventoryItem();
      Object.assign(item, lean);
      return item;
    };
    const toRelationship: (
      lean: TopologyRelationship,
    ) => InventoryItemRelationship = (
      lean: TopologyRelationship,
    ): InventoryItemRelationship => {
      const row: InventoryItemRelationship = new InventoryItemRelationship();
      Object.assign(row, lean);
      return row;
    };
    const full: ServiceMapModel = buildServiceMapModel(
      ENTITIES.map(toItem),
      RELATIONSHIPS.map(toRelationship),
      { rangeStart: RANGE_START },
    );
    const lean: ServiceMapModel = model();
    expect(edgeIds(full)).toEqual(edgeIds(lean));
    expect(entry(full, "api").runsOn).toEqual(entry(lean, "api").runsOn);
    expect(entry(full, "api").detailLabel).toBe("Node.js");
  });
});

describe("traffic and status", () => {
  test("totals calls answered and made, with call-weighted latency", () => {
    const api: ServiceMapEntry = entry(model(), "api");
    expect(api.inbound).toEqual({ calls: 1000, errors: 5, avgDurationMs: 100 });
    expect(api.outbound.calls).toBe(3100);
    expect(api.outbound.errors).toBe(20);
    expect(api.outbound.avgDurationMs).toBeCloseTo(
      (3000 * 4 + 100 * 300) / 3100,
    );
    expect(api.callers).toBe(1);
    expect(api.dependencies).toBe(2);
  });

  test("a node that only makes calls is an entry point, not unknown", () => {
    const web: ServiceMapEntry = entry(model(), "web");
    expect(web.status).toBe("entry");
    expect(web.health).toBe("unknown");
    expect(web.needsAttention).toBe(false);
  });

  test("a small error rate stays healthy; a high one is critical", () => {
    const result: ServiceMapModel = model();
    expect(entry(result, "api").status).toBe("healthy"); // 0.5%
    expect(entry(result, "postgres").status).toBe("healthy"); // 0%
    expect(entry(result, "stripe").status).toBe("critical"); // 20%
    expect(entry(result, "stripe").needsAttention).toBe(true);
  });

  test("an error rate between the tolerance and 5% is degraded", () => {
    const result: ServiceMapModel = model(ENTITIES, [
      calls("web", "api", 1000, 30, 10),
    ]);
    expect(entry(result, "api").status).toBe("degraded");
    expect(result.edges[0]!.health).toBe("degraded");
  });

  test("a service with no calls at all is isolated", () => {
    expect(entry(model(), "worker").status).toBe("isolated");
  });

  test("a call without counts still marks its callee as called", () => {
    const result: ServiceMapModel = model(ENTITIES, [calls("web", "api")]);
    expect(entry(result, "api").status).toBe("healthy");
    expect(entry(result, "api").callers).toBe(1);
  });

  test("incidents and alerts need attention and sort first", () => {
    const statuses: Map<string, ServiceOperationalStatus> = new Map();
    statuses.set("worker", {
      serviceId: "worker-id",
      activeIncidentCount: 1,
      worstIncidentSeverityName: "Critical",
      worstIncidentSeverityColor: "#ff0000",
      incidents: [],
      activeAlertCount: 0,
      worstAlertSeverityName: null,
      worstAlertSeverityColor: null,
      alerts: [],
    });
    const result: ServiceMapModel = model(ENTITIES, RELATIONSHIPS, {
      rangeStart: RANGE_START,
      statuses,
    });
    expect(result.entries[0]!.key).toBe("worker");
    expect(entry(result, "worker").incidentColor).toBe("#ff0000");
    expect(entry(result, "worker").needsAttention).toBe(true);
  });

  test("operational status never applies to a dependency with a service's name", () => {
    const statuses: Map<string, ServiceOperationalStatus> = new Map();
    statuses.set("postgres", {
      serviceId: "x",
      activeIncidentCount: 3,
      worstIncidentSeverityName: null,
      worstIncidentSeverityColor: null,
      incidents: [],
      activeAlertCount: 0,
      worstAlertSeverityName: null,
      worstAlertSeverityColor: null,
      alerts: [],
    });
    const result: ServiceMapModel = model(ENTITIES, RELATIONSHIPS, {
      rangeStart: RANGE_START,
      statuses,
    });
    expect(entry(result, "postgres").incidentCount).toBe(0);
  });
});

describe("activity", () => {
  const stale: TopologyEntity = entity("legacy", EntityType.Service, {
    lastSeenAt: LONG_AGO,
  });

  test("services silent in the range are left out and counted", () => {
    const result: ServiceMapModel = model(
      [...ENTITIES, stale],
      [
        ...RELATIONSHIPS,
        calls("legacy", "api", 5, 0, 1),
        calls("web", "legacy", 5, 0, 1),
      ],
    );
    expect(result.entryByKey.has("legacy")).toBe(false);
    expect(result.inactiveServiceCount).toBe(1);
    // Neither direction may resurrect it through an edge.
    expect(
      result.edges.some((edge: { from: string; to: string }) => {
        return edge.from === "legacy" || edge.to === "legacy";
      }),
    ).toBe(false);
  });

  test("show inactive brings them back", () => {
    const result: ServiceMapModel = model([...ENTITIES, stale], RELATIONSHIPS, {
      rangeStart: RANGE_START,
      includeInactive: true,
    });
    expect(result.entryByKey.has("legacy")).toBe(true);
    expect(result.inactiveServiceCount).toBe(0);
  });

  test("without a range start everything is active", () => {
    const result: ServiceMapModel = model(
      [...ENTITIES, stale],
      RELATIONSHIPS,
      {},
    );
    expect(result.entryByKey.has("legacy")).toBe(true);
    expect(result.inactiveServiceCount).toBe(0);
  });

  test("manually registered and mirrored services are always active", () => {
    const result: ServiceMapModel = model(
      [
        entity("manual", EntityType.Service, {
          source: EntitySource.Manual,
          lastSeenAt: LONG_AGO,
        }),
        entity("never-seen", EntityType.Service, { lastSeenAt: undefined }),
      ],
      [],
    );
    expect(result.entryByKey.has("manual")).toBe(true);
    expect(result.entryByKey.has("never-seen")).toBe(true);
    expect(result.inactiveServiceCount).toBe(0);
  });

  test("activity is judged exactly at the range start", () => {
    const result: ServiceMapModel = model(
      [
        entity("on-the-edge", EntityType.Service, { lastSeenAt: RANGE_START }),
        entity("just-before", EntityType.Service, {
          lastSeenAt: new Date(RANGE_START.getTime() - 1),
        }),
      ],
      [],
    );
    expect(result.entryByKey.has("on-the-edge")).toBe(true);
    expect(result.entryByKey.has("just-before")).toBe(false);
  });
});

describe("callers", () => {
  test("only an active service is ever the caller of an edge", () => {
    /*
     * The Topology API only sends depends-on rows whose caller is a service,
     * but the map must not rely on it: a database a service calls is on the
     * map, yet its own depends-on rows are not calls between services.
     */
    const result: ServiceMapModel = model(ENTITIES, [
      calls("api", "postgres", 10, 0, 1),
      calls("postgres", "stripe", 10, 0, 1),
    ]);
    expect(edgeIds(result)).toEqual(["api->postgres"]);
    expect(result.entryByKey.has("stripe")).toBe(false);
    expect(entry(result, "postgres").dependencies).toBe(0);
    expect(entry(result, "postgres").outbound.calls).toBe(0);
    expect(result.relationships).toHaveLength(1);
  });

  test("a callee is no caller whatever order the rows arrive in", () => {
    const forward: ServiceMapModel = model(ENTITIES, [
      calls("api", "postgres", 10, 0, 1),
      calls("postgres", "stripe", 10, 0, 1),
    ]);
    const backward: ServiceMapModel = model(ENTITIES, [
      calls("postgres", "stripe", 10, 0, 1),
      calls("api", "postgres", 10, 0, 1),
    ]);
    expect(edgeIds(forward)).toEqual(edgeIds(backward));
    expect(Array.from(backward.entryByKey.keys()).sort()).toEqual(
      Array.from(forward.entryByKey.keys()).sort(),
    );
  });

  test("a non-service caller is ignored even when it is in the payload", () => {
    const result: ServiceMapModel = model(ENTITIES, [
      calls("pod-1", "postgres", 10, 0, 1),
      calls("stripe", "api", 10, 0, 1),
    ]);
    expect(result.edges).toHaveLength(0);
    expect(result.entryByKey.has("postgres")).toBe(false);
    expect(entry(result, "api").callers).toBe(0);
  });

  test("a service can call another service, both ways", () => {
    const result: ServiceMapModel = model(ENTITIES, [
      calls("web", "api", 10, 0, 1),
      calls("api", "web", 3, 0, 1),
    ]);
    expect(edgeIds(result)).toEqual(["web->api", "api->web"]);
    expect(entry(result, "web").callers).toBe(1);
    expect(entry(result, "api").callers).toBe(1);
  });

  test("a service that is only in the payload as a callee is never a caller", () => {
    // An inactive service reached through an edge must stay off the map.
    const result: ServiceMapModel = model(
      [
        ...ENTITIES,
        entity("legacy", EntityType.Service, { lastSeenAt: LONG_AGO }),
      ],
      [calls("legacy", "postgres", 10, 0, 1), calls("api", "legacy", 1, 0, 1)],
    );
    expect(result.edges).toHaveLength(0);
    expect(result.entryByKey.has("postgres")).toBe(false);
  });
});

describe("runs on, counted by the server", () => {
  const counts: TopologyRunsOnCounts = new Map<
    string,
    Array<TopologyRunsOnCount>
  >([
    [
      "api",
      [
        runsOnCount(EntityType.Host, 3, 5),
        runsOnCount(EntityType.KubernetesPod, 12, 40),
        runsOnCount(EntityType.Container, 0, 7),
      ],
    ],
    ["web", [runsOnCount(EntityType.Host, 1, 1)]],
  ]);

  test("uses only the services' active resources, most first", () => {
    const result: ServiceMapModel = model(ENTITIES, RELATIONSHIPS, {
      rangeStart: RANGE_START,
      runsOnCounts: counts,
    });
    expect(entry(result, "api").runsOn).toEqual([
      { entityType: EntityType.KubernetesPod, count: 12 },
      { entityType: EntityType.Host, count: 3 },
    ]);
    expect(summarizeRunsOn(entry(result, "api").runsOn)).toBe(
      "12 pods · 3 hosts",
    );
    expect(entry(result, "web").runsOn).toEqual([
      { entityType: EntityType.Host, count: 1 },
    ]);
  });

  test("with inactive resources shown, counts every resource", () => {
    const result: ServiceMapModel = model(ENTITIES, RELATIONSHIPS, {
      rangeStart: RANGE_START,
      includeInactive: true,
      runsOnCounts: counts,
    });
    expect(summarizeRunsOn(entry(result, "api").runsOn)).toBe(
      "40 pods · 7 containers · 5 hosts",
    );
  });

  test("without a range start, like the rest of the model, counts everything", () => {
    const result: ServiceMapModel = model(ENTITIES, RELATIONSHIPS, {
      runsOnCounts: counts,
    });
    expect(summarizeRunsOn(entry(result, "api").runsOn)).toBe(
      "40 pods · 7 containers · 5 hosts",
    );
  });

  test("ignores the relationships entirely once counts are given", () => {
    // RELATIONSHIPS places api on pod-1 and pod-2; the counts say otherwise.
    const result: ServiceMapModel = model(ENTITIES, RELATIONSHIPS, {
      rangeStart: RANGE_START,
      runsOnCounts: new Map<string, Array<TopologyRunsOnCount>>(),
    });
    expect(entry(result, "api").runsOn).toEqual([]);
    expect(summarizeRunsOn(entry(result, "api").runsOn)).toBeNull();
  });

  test("a service with nothing active drops out of the summary", () => {
    const result: ServiceMapModel = model(ENTITIES, [], {
      rangeStart: RANGE_START,
      runsOnCounts: new Map<string, Array<TopologyRunsOnCount>>([
        ["worker", [runsOnCount(EntityType.KubernetesPod, 0, 9)]],
      ]),
    });
    expect(entry(result, "worker").runsOn).toEqual([]);
  });

  test("never applies to dependencies or to services off the map", () => {
    const result: ServiceMapModel = model(
      [
        ...ENTITIES,
        entity("legacy", EntityType.Service, { lastSeenAt: LONG_AGO }),
      ],
      RELATIONSHIPS,
      {
        rangeStart: RANGE_START,
        runsOnCounts: new Map<string, Array<TopologyRunsOnCount>>([
          ["postgres", [runsOnCount(EntityType.Host, 1, 1)]],
          ["legacy", [runsOnCount(EntityType.Host, 1, 1)]],
        ]),
      },
    );
    expect(entry(result, "postgres").runsOn).toEqual([]);
    expect(result.entryByKey.has("legacy")).toBe(false);
  });

  test("equal counts read in type order, and repeated types add up", () => {
    const result: ServiceMapModel = model(ENTITIES, [], {
      rangeStart: RANGE_START,
      runsOnCounts: new Map<string, Array<TopologyRunsOnCount>>([
        [
          "worker",
          [
            runsOnCount(EntityType.KubernetesPod, 2, 2),
            runsOnCount(EntityType.Host, 2, 2),
            runsOnCount(EntityType.KubernetesPod, 1, 1),
          ],
        ],
      ]),
    });
    expect(entry(result, "worker").runsOn).toEqual([
      { entityType: EntityType.KubernetesPod, count: 3 },
      { entityType: EntityType.Host, count: 2 },
    ]);
  });
});

describe("runs on, counted from relationships", () => {
  test("lists only active infrastructure, by type", () => {
    expect(entry(model(), "api").runsOn).toEqual([
      { entityType: EntityType.KubernetesPod, count: 2 },
    ]);
    expect(summarizeRunsOn(entry(model(), "api").runsOn)).toBe("2 pods");
  });

  test("shows inactive infrastructure too when asked", () => {
    const result: ServiceMapModel = model(ENTITIES, RELATIONSHIPS, {
      rangeStart: RANGE_START,
      includeInactive: true,
    });
    expect(summarizeRunsOn(entry(result, "api").runsOn)).toBe(
      "2 pods · 1 host",
    );
  });

  test("counts a resource once, however many rows place the service on it", () => {
    const result: ServiceMapModel = model(ENTITIES, [
      placed("api", "pod-1"),
      placed("api", "pod-1"),
      placed("api", "pod-1", EntityRelationshipType.HostedOn),
    ]);
    expect(entry(result, "api").runsOn).toEqual([
      { entityType: EntityType.KubernetesPod, count: 1 },
    ]);
  });

  test("ignores other relationship types, unknown targets and non-services", () => {
    const result: ServiceMapModel = model(ENTITIES, [
      calls("api", "postgres", 1, 0, 1),
      placed("api", "pod-1", EntityRelationshipType.PartOf),
      placed("api", "missing-pod"),
      placed("postgres", "pod-2"),
      placed("pod-1", "old-host"),
    ]);
    expect(entry(result, "api").runsOn).toEqual([]);
    expect(entry(result, "postgres").runsOn).toEqual([]);
  });

  test("a target without a type still counts", () => {
    const result: ServiceMapModel = model(
      [...ENTITIES, entity("mystery", "")],
      [placed("worker", "mystery")],
    );
    expect(entry(result, "worker").runsOn).toEqual([
      { entityType: "unknown", count: 1 },
    ]);
  });
});

describe("edges", () => {
  test("duplicate, self and dangling rows are dropped", () => {
    const result: ServiceMapModel = model(ENTITIES, [
      calls("web", "api", 10, 0, 1),
      calls("web", "api", 99, 0, 1),
      calls("api", "api", 10, 0, 1),
      calls("api", "missing", 10, 0, 1),
      calls("missing", "api", 10, 0, 1),
    ]);
    expect(
      result.edges.map((edge: { id: string; calls: number }) => {
        return [edge.id, edge.calls];
      }),
    ).toEqual([["web->api", 10]]);
    expect(result.relationships).toHaveLength(1);
  });

  test("the first row of a pair wins (the server sends the newest first)", () => {
    const newest: TopologyRelationship = calls("web", "api", 10, 1, 5);
    const result: ServiceMapModel = model(ENTITIES, [
      newest,
      calls("web", "api", 500, 0, 1),
    ]);
    expect(result.edges[0]!.relationship).toBe(newest);
    expect(result.relationships).toEqual([newest]);
    expect(entry(result, "api").inbound.calls).toBe(10);
  });

  test("co-occurrence relationships are never drawn as calls", () => {
    expect(
      model().edges.every((edge: { to: string }) => {
        return !edge.to.startsWith("pod");
      }),
    ).toBe(true);
  });

  test("keep their order and carry metrics", () => {
    const result: ServiceMapModel = model();
    expect(edgeIds(result)).toEqual([
      "web->api",
      "api->postgres",
      "api->stripe",
    ]);
    const stripe: ServiceMapEdge = result.edges[2]!;
    expect(stripe.calls).toBe(100);
    expect(stripe.errors).toBe(20);
    expect(stripe.avgDurationMs).toBe(300);
    expect(stripe.health).toBe("critical");
    expect(result.edges[0]!.health).toBe("healthy");
  });
});

describe("visibility", () => {
  test("search keeps matches plus their direct neighbours as context", () => {
    const visibility: ServiceMapVisibility = resolveServiceMapVisibility({
      model: model(),
      search: "postgres",
      focusKey: null,
      attentionOnly: false,
    });
    expect(Array.from(visibility.matchedKeys)).toEqual(["postgres"]);
    expect(Array.from(visibility.contextKeys)).toEqual(["api"]);
  });

  test("search matches type and engine words too", () => {
    const visibility: ServiceMapVisibility = resolveServiceMapVisibility({
      model: model(),
      search: "database postgresql",
      focusKey: null,
      attentionOnly: false,
    });
    expect(Array.from(visibility.matchedKeys)).toEqual(["postgres"]);
  });

  test("focus limits the map to a node and its direct connections", () => {
    const visibility: ServiceMapVisibility = resolveServiceMapVisibility({
      model: model(),
      search: "",
      focusKey: "api",
      attentionOnly: false,
    });
    expect(Array.from(visibility.visibleKeys).sort()).toEqual([
      "api",
      "postgres",
      "stripe",
      "web",
    ]);
  });

  test("an unknown focus is ignored", () => {
    const visibility: ServiceMapVisibility = resolveServiceMapVisibility({
      model: model(),
      search: "",
      focusKey: "gone",
      attentionOnly: false,
    });
    expect(visibility.effectiveFocusKey).toBeNull();
    expect(visibility.visibleKeys.size).toBe(5);
  });

  test("attention only keeps nodes that need attention", () => {
    const visibility: ServiceMapVisibility = resolveServiceMapVisibility({
      model: model(),
      search: "",
      focusKey: null,
      attentionOnly: true,
    });
    expect(Array.from(visibility.matchedKeys)).toEqual(["stripe"]);
  });
});

describe("layoutServiceMap", () => {
  test("lays callers left of callees and lists unconnected nodes separately", () => {
    const result: ServiceMapModel = model();
    const layout: ServiceMapLayout = layoutServiceMap({
      visibleKeys: new Set<string>(result.entryByKey.keys()),
      edges: result.edges,
      columnGap: 300,
      rowGap: 150,
    });
    const x: (key: string) => number = (key: string): number => {
      return layout.positions.get(key)!.x;
    };
    expect(x("web")).toBeLessThan(x("api"));
    expect(x("api")).toBeLessThan(x("postgres"));
    expect(x("postgres")).toBe(x("stripe"));
    expect(layout.positions.get("postgres")!.y).not.toBe(
      layout.positions.get("stripe")!.y,
    );
    expect(layout.positions.has("worker")).toBe(false);
    expect(layout.unconnectedKeys).toEqual(["worker"]);
  });

  test("only visible edges connect nodes", () => {
    const result: ServiceMapModel = model();
    const layout: ServiceMapLayout = layoutServiceMap({
      visibleKeys: new Set<string>(["web", "postgres"]),
      edges: result.edges,
      columnGap: 300,
      rowGap: 150,
    });
    expect(layout.positions.size).toBe(0);
    expect(layout.unconnectedKeys).toEqual(["postgres", "web"]);
  });

  test("is deterministic", () => {
    const result: ServiceMapModel = model();
    const build: () => ServiceMapLayout = (): ServiceMapLayout => {
      return layoutServiceMap({
        visibleKeys: new Set<string>(result.entryByKey.keys()),
        edges: result.edges,
        columnGap: 300,
        rowGap: 150,
      });
    };
    expect(Array.from(build().positions.entries())).toEqual(
      Array.from(build().positions.entries()),
    );
  });
});

describe("helpers", () => {
  test("summarizeRunsOn lists counts by type, most first", () => {
    expect(
      summarizeRunsOn([
        { entityType: EntityType.Host, count: 1 },
        { entityType: EntityType.KubernetesPod, count: 2 },
      ]),
    ).toBe("2 pods · 1 host");
    expect(summarizeRunsOn([])).toBeNull();
  });

  test("summarizeRunsOn skips empty counts and breaks ties by type", () => {
    const runsOn: Array<ServiceMapRunsOn> = [
      { entityType: EntityType.KubernetesPod, count: 3 },
      { entityType: EntityType.Container, count: 0 },
      { entityType: EntityType.Host, count: 3 },
    ];
    expect(summarizeRunsOn(runsOn)).toBe("3 hosts · 3 pods");
    // The caller's array is left as it was.
    expect(runsOn[0]!.entityType).toBe(EntityType.KubernetesPod);
    expect(
      summarizeRunsOn([{ entityType: EntityType.Host, count: 0 }]),
    ).toBeNull();
  });

  test("nounForType pluralizes short nouns and falls back to type labels", () => {
    expect(nounForType(EntityType.KubernetesPod, 1)).toBe("pod");
    expect(nounForType(EntityType.KubernetesDeployment, 3)).toBe("deployments");
    expect(nounForType(EntityType.CephCluster, 2)).toBe("ceph clusters");
  });

  test("kindForEntityType maps manual and inferred dependency types", () => {
    expect(kindForEntityType(EntityType.ExternalDatabase)).toBe("database");
    expect(kindForEntityType(EntityType.ExternalService)).toBe("external");
    expect(kindForEntityType(EntityType.Service)).toBe("service");
    expect(kindForEntityType("something.new")).toBe("remote");
  });

  test("detailLabelForEntity keeps unknown values as reported", () => {
    expect(
      detailLabelForEntity(
        entity("x", EntityType.Database, {
          identifyingAttributes: { "db.system.name": "couchbase" },
        }),
      ),
    ).toBe("couchbase");
  });

  test("detailLabelForEntity reads the shared keys in order, descriptive first", () => {
    // The server ships exactly these keys; the reader must want no others.
    expect(SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS).toEqual([
      "telemetry.sdk.language",
      "db.system.name",
      "network.protocol.name",
      "messaging.system",
    ]);
    expect(
      detailLabelForEntity(
        entity("x", EntityType.RemoteService, {
          descriptiveAttributes: { "messaging.system": "kafka" },
          identifyingAttributes: { "network.protocol.name": "grpc" },
        }),
      ),
    ).toBe("gRPC");
    expect(
      detailLabelForEntity(
        entity("x", EntityType.Database, {
          descriptiveAttributes: { "db.system.name": "mysql" },
          identifyingAttributes: { "db.system.name": "postgresql" },
        }),
      ),
    ).toBe("MySQL");
  });

  test("detailLabelForEntity skips blank and non-string values", () => {
    expect(
      detailLabelForEntity(
        entity("x", EntityType.Database, {
          descriptiveAttributes: { "db.system.name": "   " },
          identifyingAttributes: { "db.system.name": "redis" },
        }),
      ),
    ).toBe("Redis");
    expect(
      detailLabelForEntity(
        entity("x", EntityType.Service, {
          descriptiveAttributes: { "telemetry.sdk.language": 42 },
        }),
      ),
    ).toBeNull();
    expect(detailLabelForEntity(entity("x", EntityType.Service))).toBeNull();
  });
});
