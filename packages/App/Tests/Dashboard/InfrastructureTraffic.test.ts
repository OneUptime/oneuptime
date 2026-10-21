import { describe, expect, test } from "@jest/globals";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  InfrastructureServiceCall,
  InfrastructureTopologyModel,
  InfrastructureTraffic,
  InfrastructureTrafficLink,
  MAX_TRAFFIC_PAIRS,
  buildInfrastructureTopologyModel,
  collectMapCards,
  computeInfrastructureTraffic,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * Traffic on the Infrastructure map (issue #3972): a line between two cards
 * whenever a service running on one calls a service running on the other.
 *
 * Calls are measured per service pair (the `depends-on` relationships the
 * dependency cron writes), never per pod, so the model keeps the calls
 * between placed services and a map projects them onto the cards it draws.
 */

const NOW: Date = new Date("2026-09-26T10:00:00Z");
const RANGE_START: Date = new Date("2026-09-25T10:00:00Z");
const LONG_AGO: Date = new Date("2026-08-20T10:00:00Z");

function entity(
  key: string,
  type: EntityType | string,
  name: string = key,
  lastSeenAt: Date = NOW,
): TopologyEntity {
  return {
    entityKey: key,
    entityType: type,
    displayName: name,
    lastSeenAt,
    source: EntitySource.Discovered,
  };
}

function edge(
  from: string,
  to: string,
  type: EntityRelationshipType,
): TopologyRelationship {
  return { fromEntityKey: from, toEntityKey: to, relationshipType: type };
}

function call(
  from: string,
  to: string,
  callCount?: number | undefined,
  errorCount?: number | undefined,
  avgDurationMs?: number | undefined,
): TopologyRelationship {
  const relationship: TopologyRelationship = edge(
    from,
    to,
    EntityRelationshipType.DependsOn,
  );
  if (callCount !== undefined) {
    relationship.callCount = callCount;
  }
  if (errorCount !== undefined) {
    relationship.errorCount = errorCount;
  }
  if (avgDurationMs !== undefined) {
    relationship.avgDurationMs = avgDurationMs;
  }
  return relationship;
}

function lines(traffic: InfrastructureTraffic): Array<string> {
  return traffic.links
    .map((link: InfrastructureTrafficLink): string => {
      return `${link.from} -> ${link.to}`;
    })
    .sort();
}

function linkBetween(
  traffic: InfrastructureTraffic,
  from: string,
  to: string,
): InfrastructureTrafficLink {
  const found: InfrastructureTrafficLink | undefined = traffic.links.find(
    (link: InfrastructureTrafficLink): boolean => {
      return link.from === from && link.to === to;
    },
  );
  if (!found) {
    throw new Error(`no line ${from} -> ${to}`);
  }
  return found;
}

function callPairs(calls: Array<InfrastructureServiceCall>): Array<string> {
  return calls.map((item: InfrastructureServiceCall): string => {
    return `${item.from} -> ${item.to}`;
  });
}

/*
 * The estate in the issue's screenshot: an AKS node running four pods of
 * four workloads, one more node running a second backend replica, and the
 * services those pods run calling each other.
 */
function aksEntities(): Array<TopologyEntity> {
  return [
    entity("svc-backend", EntityType.Service, "wb-ims-backend"),
    entity("svc-blob", EntityType.Service, "wb-ims-blob"),
    entity("svc-edh", EntityType.Service, "wb-ims-integration-edh"),
    entity("svc-mcp", EntityType.Service, "wb-ims-mcp-remote"),
    entity(
      "node-k",
      EntityType.KubernetesNode,
      "aks-agentpool-14451756-vmss00001k",
    ),
    entity(
      "node-j",
      EntityType.KubernetesNode,
      "aks-agentpool-14451756-vmss00001j",
    ),
    entity(
      "pod-backend",
      EntityType.KubernetesPod,
      "wb-ims-backend-76c6f6c8d9-x2k9p",
    ),
    entity(
      "pod-blob",
      EntityType.KubernetesPod,
      "wb-ims-blob-56d969fb98-q8zwm",
    ),
    entity(
      "pod-edh",
      EntityType.KubernetesPod,
      "wb-ims-integration-edh-6b7c8d9f5-zz2wm",
    ),
    entity(
      "pod-mcp",
      EntityType.KubernetesPod,
      "wb-ims-mcp-remote-567bc8d9f4-bq2zt",
    ),
    entity(
      "pod-backend-2",
      EntityType.KubernetesPod,
      "wb-ims-backend-76c6f6c8d9-4vnkt",
    ),
  ];
}

function aksPlacement(): Array<TopologyRelationship> {
  return [
    edge("pod-backend", "node-k", EntityRelationshipType.RunsOn),
    edge("pod-blob", "node-k", EntityRelationshipType.RunsOn),
    edge("pod-edh", "node-k", EntityRelationshipType.RunsOn),
    edge("pod-mcp", "node-k", EntityRelationshipType.RunsOn),
    edge("pod-backend-2", "node-j", EntityRelationshipType.RunsOn),
    edge("svc-backend", "pod-backend", EntityRelationshipType.RunsOn),
    edge("svc-backend", "pod-backend-2", EntityRelationshipType.RunsOn),
    edge("svc-blob", "pod-blob", EntityRelationshipType.RunsOn),
    edge("svc-edh", "pod-edh", EntityRelationshipType.RunsOn),
    edge("svc-mcp", "pod-mcp", EntityRelationshipType.RunsOn),
  ];
}

function aksCalls(): Array<TopologyRelationship> {
  return [
    call("svc-backend", "svc-blob", 1200, 6, 45),
    call("svc-backend", "svc-edh", 300, 30, 120),
    call("svc-edh", "svc-blob", 60, 0, 20),
    call("svc-mcp", "svc-backend", 90, 0, 15),
  ];
}

function aksModel(
  relationships: Array<TopologyRelationship> = [
    ...aksPlacement(),
    ...aksCalls(),
  ],
): InfrastructureTopologyModel {
  return buildInfrastructureTopologyModel(aksEntities(), relationships, {
    rangeStart: RANGE_START,
  });
}

describe("issue #3972: a node's pods are joined by the calls between their services", () => {
  test("opening the node draws a line per calling pair, carrying its traffic", () => {
    const model: InfrastructureTopologyModel = aksModel();
    const cards: Array<string> = collectMapCards(model, "node-k");
    expect(cards.sort()).toEqual([
      "pod-backend",
      "pod-blob",
      "pod-edh",
      "pod-mcp",
    ]);

    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(
      model,
      cards,
    );
    expect(traffic.isPartial).toBe(false);
    expect(lines(traffic)).toEqual([
      "pod-backend -> pod-blob",
      "pod-backend -> pod-edh",
      "pod-edh -> pod-blob",
      "pod-mcp -> pod-backend",
    ]);

    const backendToBlob: InfrastructureTrafficLink = linkBetween(
      traffic,
      "pod-backend",
      "pod-blob",
    );
    expect(backendToBlob).toMatchObject({
      calls: 1200,
      errors: 6,
      avgDurationMs: 45,
      health: "healthy",
    });
    expect(callPairs(backendToBlob.serviceCalls)).toEqual([
      "svc-backend -> svc-blob",
    ]);
    /* 10% of the backend's calls into the integration failed. */
    expect(linkBetween(traffic, "pod-backend", "pod-edh").health).toBe(
      "critical",
    );
  });

  test("without any calls the same node draws no lines at all", () => {
    const model: InfrastructureTopologyModel = aksModel(aksPlacement());
    expect(model.serviceCalls).toEqual([]);
    expect(
      computeInfrastructureTraffic(model, collectMapCards(model, "node-k"))
        .links,
    ).toEqual([]);
  });

  test("across the cluster, each node is a card and the calls run between nodes", () => {
    const model: InfrastructureTopologyModel = aksModel();
    const cards: Array<string> = collectMapCards(model, null);
    expect(cards.sort()).toEqual(["node-j", "node-k"]);
    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(
      model,
      cards,
    );
    /*
     * The backend also runs on node-j: its calls into blob and the
     * integration (both on node-k) cross nodes, and mcp's calls into the
     * backend reach node-j. Calls between services that share node-k stay
     * inside the card.
     */
    expect(lines(traffic)).toEqual(["node-j -> node-k", "node-k -> node-j"]);
    const outbound: InfrastructureTrafficLink = linkBetween(
      traffic,
      "node-j",
      "node-k",
    );
    expect(callPairs(outbound.serviceCalls)).toEqual([
      "svc-backend -> svc-blob",
      "svc-backend -> svc-edh",
    ]);
    expect(outbound.calls).toBe(1500);
    expect(outbound.errors).toBe(36);
    expect(outbound.avgDurationMs).toBeCloseTo((1200 * 45 + 300 * 120) / 1500);
    expect(outbound.health).toBe("degraded");
    expect(
      callPairs(linkBetween(traffic, "node-k", "node-j").serviceCalls),
    ).toEqual(["svc-mcp -> svc-backend"]);
  });
});

describe("the calls a model keeps", () => {
  test("calls between placed services, ordered by caller then callee, traffic intact", () => {
    const model: InfrastructureTopologyModel = aksModel([
      ...aksPlacement(),
      ...aksCalls().reverse(),
    ]);
    expect(model.serviceCalls).toEqual([
      {
        from: "svc-backend",
        to: "svc-blob",
        calls: 1200,
        errors: 6,
        avgDurationMs: 45,
      },
      {
        from: "svc-backend",
        to: "svc-edh",
        calls: 300,
        errors: 30,
        avgDurationMs: 120,
      },
      {
        from: "svc-edh",
        to: "svc-blob",
        calls: 60,
        errors: 0,
        avgDurationMs: 20,
      },
      {
        from: "svc-mcp",
        to: "svc-backend",
        calls: 90,
        errors: 0,
        avgDurationMs: 15,
      },
    ]);
  });

  test("a service that runs on nothing shown has no calls to draw", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        ...aksEntities(),
        entity("svc-cron", EntityType.Service, "nightly-cron"),
        entity(
          "pod-old",
          EntityType.KubernetesPod,
          "old-6b7c8d9f5-zz2wq",
          LONG_AGO,
        ),
        entity("svc-old", EntityType.Service, "old"),
      ],
      [
        ...aksPlacement(),
        edge("svc-old", "pod-old", EntityRelationshipType.RunsOn),
        call("svc-cron", "svc-backend", 10),
        call("svc-backend", "svc-cron", 10),
        call("svc-old", "svc-blob", 10),
      ],
      { rangeStart: RANGE_START },
    );
    /* svc-cron runs nowhere; svc-old only on a pod hidden as inactive. */
    expect(model.serviceCalls).toEqual([]);

    const withInactive: InfrastructureTopologyModel =
      buildInfrastructureTopologyModel(
        [
          ...aksEntities(),
          entity(
            "pod-old",
            EntityType.KubernetesPod,
            "old-6b7c8d9f5-zz2wq",
            LONG_AGO,
          ),
          entity("svc-old", EntityType.Service, "old"),
        ],
        [
          ...aksPlacement(),
          edge("svc-old", "pod-old", EntityRelationshipType.RunsOn),
          call("svc-old", "svc-blob", 10),
        ],
        { rangeStart: RANGE_START, includeInactive: true },
      );
    expect(callPairs(withInactive.serviceCalls)).toEqual([
      "svc-old -> svc-blob",
    ]);
  });

  test("calls into non-services, self-calls, unknown keys and repeats are dropped", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [...aksEntities(), entity("db", EntityType.Database, "postgres")],
      [
        ...aksPlacement(),
        call("svc-backend", "db", 500),
        call("svc-backend", "svc-backend", 500),
        call("svc-backend", "ghost", 500),
        call("ghost", "svc-backend", 500),
        call("svc-backend", "svc-blob", 7),
        call("svc-backend", "svc-blob", 999),
        /* A pod is not a service, even when something points at it. */
        call("svc-backend", "pod-blob", 3),
        edge("svc-backend", "svc-blob", EntityRelationshipType.RunsOn),
        { toEntityKey: "svc-blob", relationshipType: "depends-on" },
      ],
      { rangeStart: RANGE_START },
    );
    expect(model.serviceCalls).toEqual([
      {
        from: "svc-backend",
        to: "svc-blob",
        calls: 7,
        errors: 0,
        avgDurationMs: null,
      },
    ]);
  });

  test("missing or impossible traffic figures read as none", () => {
    const model: InfrastructureTopologyModel = aksModel([
      ...aksPlacement(),
      call("svc-backend", "svc-blob"),
      call("svc-edh", "svc-blob", -4, -1, -3),
      call("svc-mcp", "svc-backend", 10, 2, 0),
    ]);
    expect(model.serviceCalls).toEqual([
      {
        from: "svc-backend",
        to: "svc-blob",
        calls: 0,
        errors: 0,
        avgDurationMs: null,
      },
      {
        from: "svc-edh",
        to: "svc-blob",
        calls: 0,
        errors: 0,
        avgDurationMs: null,
      },
      {
        from: "svc-mcp",
        to: "svc-backend",
        calls: 10,
        errors: 2,
        avgDurationMs: 0,
      },
    ]);
  });
});

describe("traffic between the cards of a map", () => {
  test("a call between services on one card stays inside it", () => {
    const model: InfrastructureTopologyModel = aksModel();
    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(model, [
      "node-k",
    ]);
    expect(traffic.links).toEqual([]);
  });

  test("each direction is its own line", () => {
    const model: InfrastructureTopologyModel = aksModel([
      ...aksPlacement(),
      call("svc-blob", "svc-edh", 40, 0, 5),
      call("svc-edh", "svc-blob", 60, 0, 20),
    ]);
    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(model, [
      "pod-blob",
      "pod-edh",
    ]);
    expect(lines(traffic)).toEqual([
      "pod-blob -> pod-edh",
      "pod-edh -> pod-blob",
    ]);
    expect(linkBetween(traffic, "pod-blob", "pod-edh").calls).toBe(40);
    expect(linkBetween(traffic, "pod-edh", "pod-blob").calls).toBe(60);
  });

  test("a call whose services run on several cards is drawn on every line between them", () => {
    const model: InfrastructureTopologyModel = aksModel();
    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(model, [
      "pod-backend",
      "pod-backend-2",
      "pod-blob",
    ]);
    /*
     * Traffic is measured per service pair, so neither replica can be told
     * apart: each line carries the whole call.
     */
    expect(lines(traffic)).toEqual([
      "pod-backend -> pod-blob",
      "pod-backend-2 -> pod-blob",
    ]);
    expect(linkBetween(traffic, "pod-backend-2", "pod-blob").calls).toBe(1200);
    expect(linkBetween(traffic, "pod-backend", "pod-blob").calls).toBe(1200);
  });

  test("a replica group carries the calls of the services its members run", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        entity("svc-web", EntityType.Service, "web"),
        entity("svc-api", EntityType.Service, "api"),
        entity("h1", EntityType.Host, "web-01"),
        entity("h2", EntityType.Host, "web-02"),
        entity("h3", EntityType.Host, "api-server"),
      ],
      [
        edge("svc-web", "h1", EntityRelationshipType.HostedOn),
        edge("svc-web", "h2", EntityRelationshipType.HostedOn),
        edge("svc-api", "h3", EntityRelationshipType.HostedOn),
        call("svc-web", "svc-api", 100, 0, 30),
      ],
      { rangeStart: RANGE_START },
    );
    const group: string = model.nodes.get("h1")!.parentId!;
    expect(group.startsWith("group:")).toBe(true);
    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(
      model,
      collectMapCards(model, null),
    );
    expect(lines(traffic)).toEqual([`${group} -> h3`]);
    expect(linkBetween(traffic, group, "h3").calls).toBe(100);
  });

  test("a line sums its calls, averages latency by calls and lists the busiest first", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        entity("a", EntityType.Service),
        entity("b", EntityType.Service),
        entity("c", EntityType.Service),
        entity("d", EntityType.Service),
        entity("left", EntityType.Host, "left-box"),
        entity("right", EntityType.Host, "right-box"),
      ],
      [
        edge("a", "left", EntityRelationshipType.HostedOn),
        edge("b", "left", EntityRelationshipType.HostedOn),
        edge("c", "right", EntityRelationshipType.HostedOn),
        edge("d", "right", EntityRelationshipType.HostedOn),
        call("a", "c", 100, 1, 10),
        call("b", "c", 300, 2, 50),
        call("a", "d", 100, 0),
        call("b", "d"),
      ],
      { rangeStart: RANGE_START },
    );
    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(model, [
      "left",
      "right",
    ]);
    expect(lines(traffic)).toEqual(["left -> right"]);
    const link: InfrastructureTrafficLink = traffic.links[0]!;
    expect(link.calls).toBe(500);
    expect(link.errors).toBe(3);
    /* Weighted exactly like the Service Map's totals, in call order a,b. */
    const afterAc: number = 10;
    const afterAd: number = (afterAc * 100 + 0 * 0) / 100;
    const expected: number = (afterAd * 200 + 50 * 300) / 500;
    expect(link.avgDurationMs).toBeCloseTo(expected);
    expect(callPairs(link.serviceCalls)).toEqual([
      "b -> c",
      "a -> c",
      "a -> d",
      "b -> d",
    ]);
    expect(link.health).toBe("healthy");
  });

  test("a call with no count still draws its line, without traffic", () => {
    const model: InfrastructureTopologyModel = aksModel([
      ...aksPlacement(),
      call("svc-backend", "svc-blob"),
    ]);
    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(model, [
      "pod-backend",
      "pod-blob",
    ]);
    expect(traffic.links).toHaveLength(1);
    expect(traffic.links[0]).toMatchObject({
      calls: 0,
      errors: 0,
      avgDurationMs: null,
      health: "unknown",
    });
  });

  test("health follows the Service Map's thresholds", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        entity("caller", EntityType.Service),
        entity("ok", EntityType.Service),
        entity("wobbly", EntityType.Service),
        entity("broken", EntityType.Service),
        entity("h-caller", EntityType.Host, "caller-box"),
        entity("h-ok", EntityType.Host, "ok-box"),
        entity("h-wobbly", EntityType.Host, "wobbly-box"),
        entity("h-broken", EntityType.Host, "broken-box"),
      ],
      [
        edge("caller", "h-caller", EntityRelationshipType.HostedOn),
        edge("ok", "h-ok", EntityRelationshipType.HostedOn),
        edge("wobbly", "h-wobbly", EntityRelationshipType.HostedOn),
        edge("broken", "h-broken", EntityRelationshipType.HostedOn),
        call("caller", "ok", 1000, 10),
        call("caller", "wobbly", 1000, 20),
        call("caller", "broken", 1000, 50),
      ],
      { rangeStart: RANGE_START },
    );
    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(model, [
      "h-caller",
      "h-ok",
      "h-wobbly",
      "h-broken",
    ]);
    expect(linkBetween(traffic, "h-caller", "h-ok").health).toBe("healthy");
    expect(linkBetween(traffic, "h-caller", "h-wobbly").health).toBe(
      "degraded",
    );
    expect(linkBetween(traffic, "h-caller", "h-broken").health).toBe(
      "critical",
    );
  });

  test("only the cards asked for take part, each once", () => {
    const model: InfrastructureTopologyModel = aksModel();
    const traffic: InfrastructureTraffic = computeInfrastructureTraffic(model, [
      "pod-backend",
      "pod-blob",
      "pod-blob",
      "not-a-node",
    ]);
    expect(lines(traffic)).toEqual(["pod-backend -> pod-blob"]);
    expect(linkBetween(traffic, "pod-backend", "pod-blob").calls).toBe(1200);
  });

  test("the same estate draws the same lines whatever order its rows arrived in", () => {
    const forward: InfrastructureTraffic = computeInfrastructureTraffic(
      aksModel(),
      ["node-j", "node-k"],
    );
    const backward: InfrastructureTraffic = computeInfrastructureTraffic(
      aksModel([...aksCalls(), ...aksPlacement()].reverse()),
      ["node-j", "node-k"],
    );
    expect(backward).toEqual(forward);
  });

  test("a scope where hundreds of services run everywhere stops at the cap and says so", () => {
    const entities: Array<TopologyEntity> = [];
    const relationships: Array<TopologyRelationship> = [];
    const hosts: Array<string> = [];
    for (let index: number = 0; index < 10; index++) {
      hosts.push(`h${index}`);
      entities.push(entity(`h${index}`, EntityType.Host, `box-${index}q`));
    }
    for (let index: number = 0; index < 20; index++) {
      entities.push(entity(`s${index}`, EntityType.Service));
      for (const host of hosts) {
        relationships.push(
          edge(`s${index}`, host, EntityRelationshipType.HostedOn),
        );
      }
      if (index > 0) {
        relationships.push(call(`s${index - 1}`, `s${index}`, 1));
      }
    }
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      entities,
      relationships,
      { rangeStart: RANGE_START },
    );
    /* 19 calls, each on every ordered pair of the 10 hosts: 19 * 90. */
    const full: InfrastructureTraffic = computeInfrastructureTraffic(
      model,
      hosts,
    );
    expect(full.isPartial).toBe(false);
    expect(full.links).toHaveLength(90);
    expect(full.links[0]!.calls).toBe(19);

    const capped: InfrastructureTraffic = computeInfrastructureTraffic(
      model,
      hosts,
      100,
    );
    expect(capped.isPartial).toBe(true);
    const counted: number = capped.links.reduce(
      (total: number, link: InfrastructureTrafficLink): number => {
        return total + link.serviceCalls.length;
      },
      0,
    );
    expect(counted).toBe(100);
    expect(MAX_TRAFFIC_PAIRS).toBeGreaterThan(19 * 90);
  });

  test("an estate without services has nothing to draw", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [entity("a", EntityType.Host), entity("b", EntityType.Host)],
      [],
    );
    expect(model.serviceCalls).toEqual([]);
    expect(computeInfrastructureTraffic(model, ["a", "b"])).toEqual({
      links: [],
      isPartial: false,
    });
  });
});
