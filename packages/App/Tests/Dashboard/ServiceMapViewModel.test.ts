import { describe, expect, test } from "@jest/globals";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import { ServiceOperationalStatus } from "../../FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay";
import {
  ServiceMapEntry,
  ServiceMapLayout,
  ServiceMapModel,
  ServiceMapVisibility,
  buildServiceMapModel,
  detailLabelForEntity,
  kindForEntityType,
  layoutServiceMap,
  nounForType,
  resolveServiceMapVisibility,
  summarizeRunsOn,
} from "../../FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";

/*
 * The Service Map view model decides what the map says about every node:
 * which nodes exist (services and what they call), how healthy each one is,
 * where it runs, and what survives a search or focus.
 */

const NOW: Date = new Date("2026-09-07T10:00:00Z");
const RANGE_START: Date = new Date("2026-09-06T10:00:00Z");

function entity(
  key: string,
  type: EntityType,
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item.entityKey = key;
  item.displayName = key;
  item.entityType = type;
  item.source = EntitySource.Discovered;
  item.lastSeenAt = NOW;
  Object.assign(item, overrides);
  return item;
}

function calls(
  from: string,
  to: string,
  callCount?: number,
  errorCount?: number,
  avgDurationMs?: number,
): InventoryItemRelationship {
  const edge: InventoryItemRelationship = new InventoryItemRelationship();
  edge.fromEntityKey = from;
  edge.toEntityKey = to;
  edge.relationshipType = EntityRelationshipType.DependsOn;
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
): InventoryItemRelationship {
  const edge: InventoryItemRelationship = new InventoryItemRelationship();
  edge.fromEntityKey = from;
  edge.toEntityKey = to;
  edge.relationshipType = type;
  return edge;
}

const ENTITIES: Array<InventoryItem> = [
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
  entity("old-host", EntityType.Host, {
    lastSeenAt: new Date("2026-08-01T00:00:00Z"),
  }),
];

const RELATIONSHIPS: Array<InventoryItemRelationship> = [
  calls("web", "api", 1000, 5, 100),
  calls("api", "postgres", 3000, 0, 4),
  calls("api", "stripe", 100, 20, 300),
  placed("api", "pod-1"),
  placed("api", "pod-2"),
  placed("api", "old-host", EntityRelationshipType.HostedOn),
];

function model(
  entities: Array<InventoryItem> = ENTITIES,
  relationships: Array<InventoryItemRelationship> = RELATIONSHIPS,
  options: Parameters<typeof buildServiceMapModel>[2] = {
    rangeStart: RANGE_START,
  },
): ServiceMapModel {
  return buildServiceMapModel(entities, relationships, options);
}

function entry(result: ServiceMapModel, key: string): ServiceMapEntry {
  return result.entryByKey.get(key)!;
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
  const stale: InventoryItem = entity("legacy", EntityType.Service, {
    lastSeenAt: new Date("2026-08-01T00:00:00Z"),
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

  test("where a service runs lists only active infrastructure", () => {
    expect(entry(model(), "api").runsOn.sort()).toEqual(["pod-1", "pod-2"]);
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

  test("co-occurrence relationships are never drawn as calls", () => {
    expect(
      model().edges.every((edge: { to: string }) => {
        return !edge.to.startsWith("pod");
      }),
    ).toBe(true);
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
  test("summarizeRunsOn counts placements by type, most first", () => {
    const byKey: Map<string, InventoryItem> = new Map(
      ENTITIES.map((item: InventoryItem): [string, InventoryItem] => {
        return [item.entityKey!, item];
      }),
    );
    expect(summarizeRunsOn(["pod-1", "pod-2", "old-host"], byKey)).toBe(
      "2 pods · 1 host",
    );
    expect(summarizeRunsOn([], byKey)).toBeNull();
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
});
