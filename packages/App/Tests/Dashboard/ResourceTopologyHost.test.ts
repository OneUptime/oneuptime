import { describe, expect, test } from "@jest/globals";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  InfrastructureData,
  ServiceMapData,
  TopologyEntity,
  TopologyRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import {
  ResourceTopologyGraph,
  ResourceTopologyIssue,
  ResourceTopologyNode,
  ResourceTopologyRelation,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import { entityKind } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyKinds";
import { OpenIssueRecord } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import {
  HOST_CALLERS_SECTION_ID,
  HOST_CALLS_SECTION_ID,
  HOST_ROOT_ID,
  HOST_STALE_MS,
  HostTopologyInput,
  buildHostTopology,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/HostTopology";

/*
 * A host's topology from the master Topology's own data: what runs on the
 * host (its containers and the services placed on them), what those
 * services call and what calls them, each call a line coloured by its
 * error rate, and the open incidents and alerts on the part they name.
 */

const NOW: Date = new Date("2026-10-21T12:00:00Z");
const RANGE_START: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

function entity(
  key: string,
  type: EntityType,
  name: string,
  lastSeenAt: Date = NOW,
): TopologyEntity {
  return {
    entityKey: key,
    entityType: type,
    displayName: name,
    lastSeenAt: lastSeenAt,
  };
}

function edge(
  from: string,
  to: string,
  type: EntityRelationshipType,
  callCount?: number,
  errorCount?: number,
): TopologyRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: type,
    callCount: callCount,
    errorCount: errorCount,
  };
}

const ENTITIES: Array<TopologyEntity> = [
  entity("host", EntityType.Host, "web-01"),
  entity("other-host", EntityType.Host, "web-02"),
  entity("api-container", EntityType.Container, "checkout-api"),
  entity(
    "gone-container",
    EntityType.Container,
    "old-job",
    new Date(RANGE_START.getTime() - 1000),
  ),
  entity("checkout", EntityType.Service, "checkout"),
  entity("storefront", EntityType.Service, "storefront"),
  entity("payments", EntityType.Service, "payments"),
  entity("mobile", EntityType.Service, "mobile-bff"),
];

function input(overrides: Partial<HostTopologyInput> = {}): HostTopologyInput {
  const infrastructure: InfrastructureData = {
    rangeStart: RANGE_START,
    loadedAt: NOW,
    entities: ENTITIES,
    relationships: [
      edge("api-container", "host", EntityRelationshipType.RunsOn),
      edge("gone-container", "host", EntityRelationshipType.RunsOn),
      edge("checkout", "api-container", EntityRelationshipType.RunsOn),
      edge("checkout", "host", EntityRelationshipType.RunsOn),
      edge("storefront", "host", EntityRelationshipType.RunsOn),
      edge("payments", "other-host", EntityRelationshipType.RunsOn),
    ],
    collections: [],
    totals: {} as InfrastructureData["totals"],
    truncation: null,
    dependencyTruncation: null,
  };
  const serviceMap: ServiceMapData = {
    rangeStart: RANGE_START,
    loadedAt: NOW,
    entities: ENTITIES,
    relationships: [
      edge("storefront", "checkout", EntityRelationshipType.DependsOn, 900, 0),
      edge("checkout", "payments", EntityRelationshipType.DependsOn, 200, 14),
      edge("mobile", "storefront", EntityRelationshipType.DependsOn, 300, 0),
      // Neither end on the host: not this host's business.
      edge("mobile", "payments", EntityRelationshipType.DependsOn, 50, 0),
    ],
    runsOnCounts: {} as ServiceMapData["runsOnCounts"],
    truncations: [],
  };

  return {
    host: { id: "host-row", name: "web-01", lastSeenAt: NOW },
    hostEntityKey: "host",
    infrastructure: infrastructure,
    serviceMap: serviceMap,
    serviceIds: new Map<string, string>([["checkout", "service-row"]]),
    now: NOW,
    ...overrides,
  };
}

function node(graph: ResourceTopologyGraph, id: string): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = graph.nodes.get(id);

  if (!found) {
    throw new Error(`no ${id} in the graph`);
  }

  return found;
}

describe("what runs on the host", () => {
  const graph: ResourceTopologyGraph = buildHostTopology(input());

  test("its containers, and each service on the most specific part it runs on", () => {
    expect(node(graph, "entity:api-container").parentId).toBe(HOST_ROOT_ID);
    expect(node(graph, "entity:api-container").kind).toBe(
      entityKind(EntityType.Container),
    );
    // checkout runs on the host and on its container: the container wins.
    expect(node(graph, "service:checkout").parentId).toBe(
      "entity:api-container",
    );
    expect(node(graph, "service:storefront").parentId).toBe(HOST_ROOT_ID);
  });

  test("a container that stopped reporting before the range is left out", () => {
    expect(graph.nodes.has("entity:gone-container")).toBe(false);
  });

  test("a service links to its page when its row is known", () => {
    expect(node(graph, "service:checkout").link).toEqual({
      page: PageMap.SERVICE_VIEW,
      modelId: "service-row",
    });
    expect(node(graph, "service:storefront").link).toBeNull();
    expect(node(graph, HOST_ROOT_ID).link).toEqual({
      page: PageMap.HOST_VIEW,
      modelId: "host-row",
    });
  });
});

describe("what it talks to, and what talks to it", () => {
  const graph: ResourceTopologyGraph = buildHostTopology(input());

  test("services elsewhere it calls are in Talks to, named with where they run", () => {
    const payments: ResourceTopologyNode = node(graph, "calls:payments");

    expect(payments.parentId).toBe(HOST_CALLS_SECTION_ID);
    expect(payments.context).toBe("web-02");
    expect(node(graph, HOST_CALLS_SECTION_ID).isSection).toBe(true);
  });

  test("services elsewhere that call it are in Called by", () => {
    expect(node(graph, "callers:mobile").parentId).toBe(
      HOST_CALLERS_SECTION_ID,
    );
  });

  test("every call that touches the host is a line, with its rate and health", () => {
    const calls: Map<string, ResourceTopologyRelation> = new Map<
      string,
      ResourceTopologyRelation
    >(
      graph.relations.map(
        (
          relation: ResourceTopologyRelation,
        ): [string, ResourceTopologyRelation] => {
          return [`${relation.from}>${relation.to}`, relation];
        },
      ),
    );

    expect(Array.from(calls.keys()).sort()).toEqual(
      [
        "callers:mobile>service:storefront",
        "service:checkout>calls:payments",
        "service:storefront>service:checkout",
      ].sort(),
    );
    // 14 of 200 failed (7%): past 5% is critical.
    expect(calls.get("service:checkout>calls:payments")).toMatchObject({
      label: "Calls",
      health: "critical",
      detail: "13/min",
    });
    expect(calls.get("service:storefront>service:checkout")).toMatchObject({
      health: "healthy",
      detail: "60/min",
    });
  });

  test("a service's health is its calls', in the service map's words", () => {
    expect(node(graph, "calls:payments").health).toBe("critical");
    expect(node(graph, "calls:payments").status).toEqual({
      text: "High error rate",
    });
    expect(node(graph, "service:checkout").health).toBe("healthy");
    // Healthy calls say nothing more: the numbers say it.
    expect(node(graph, "service:checkout").status).toBeUndefined();
    expect(
      node(graph, "service:checkout").facts?.map(
        (fact: { label: string }): string => {
          return fact.label;
        },
      ),
    ).toEqual(["Requests", "Errors"]);
    // mobile-bff only calls: an entry point.
    expect(node(graph, "callers:mobile").status).toEqual({
      text: "Entry point",
    });
  });

  test("a host whose services call nothing outside has no sections", () => {
    const quiet: ResourceTopologyGraph = buildHostTopology(
      input({ serviceMap: null }),
    );

    expect(quiet.nodes.has(HOST_CALLS_SECTION_ID)).toBe(false);
    expect(quiet.nodes.has(HOST_CALLERS_SECTION_ID)).toBe(false);
    expect(node(quiet, "service:checkout").status).toEqual({
      text: "No calls observed",
    });
    expect(node(quiet, "service:checkout").health).toBe("unknown");
  });
});

describe("the host's own state", () => {
  test("reporting, not reporting for 15 minutes, or never seen", () => {
    expect(node(buildHostTopology(input()), HOST_ROOT_ID).health).toBe(
      "healthy",
    );
    expect(
      node(
        buildHostTopology(
          input({
            host: {
              id: "host-row",
              name: "web-01",
              lastSeenAt: new Date(NOW.getTime() - HOST_STALE_MS - 1000),
            },
          }),
        ),
        HOST_ROOT_ID,
      ).health,
    ).toBe("warning");
    expect(
      node(
        buildHostTopology(
          input({ host: { id: "host-row", name: "web-01", lastSeenAt: null } }),
        ),
        HOST_ROOT_ID,
      ).health,
    ).toBe("unknown");
  });

  test("with no topology data at all, the host alone", () => {
    const empty: ResourceTopologyGraph = buildHostTopology(
      input({ infrastructure: null, serviceMap: null }),
    );

    expect(empty.nodes.size).toBe(1);
  });
});

describe("open incidents and alerts", () => {
  function record(id: string, labels: Record<string, string>): OpenIssueRecord {
    return {
      type: "incident",
      id: id,
      title: id,
      number: id,
      severityName: "Critical",
      severityColor: "#dc2626",
      stateName: "Created",
      createdAt: NOW,
      seriesLabels: labels,
      relatedIds: {},
    };
  }

  function service(id: string): ResourceTopologyIssue {
    return {
      type: "alert",
      id: id,
      title: id,
      number: id,
      severityName: "Warning",
      severityColor: null,
      stateName: "Created",
      createdAt: NOW,
    };
  }

  const graph: ResourceTopologyGraph = buildHostTopology(
    input({
      issues: [
        record("by-service", { "resource.service.name": "Checkout" }),
        record("by-container", { "container.name": "checkout-api" }),
        record("on-host", {}),
      ],
      serviceIssues: new Map<string, Array<ResourceTopologyIssue>>([
        ["payments", [service("payments-latency")]],
        ["nowhere", [service("not-drawn")]],
      ]),
    }),
  );

  const on: (id: string) => Array<string> = (id: string): Array<string> => {
    return node(graph, id).issues.map((item: { id: string }): string => {
      return item.id;
    });
  };

  test("the host's land on the service or container they name, else the host", () => {
    expect(on("service:checkout")).toEqual(["by-service"]);
    expect(on("entity:api-container")).toEqual(["by-container"]);
    expect(on(HOST_ROOT_ID)).toEqual(["on-host"]);
  });

  test("a service's own land on its card, wherever it is drawn", () => {
    expect(on("calls:payments")).toEqual(["payments-latency"]);
    // A service not on this map is not this host's.
    expect(graph.alertCount).toBe(1);
    expect(graph.incidentCount).toBe(3);
  });
});
