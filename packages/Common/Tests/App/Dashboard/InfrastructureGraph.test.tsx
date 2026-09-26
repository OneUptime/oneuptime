import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { Edge, Node } from "reactflow";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import getJestMockFunction, { MockFunction } from "../../MockType";
import InfrastructureGraph, {
  InfrastructureMapLayout,
  MAX_MAP_CARDS,
  TRAFFIC_EDGE_PREFIX,
  TRAFFIC_ROUTE_EDGE_TYPE,
  TrafficEdgeData,
  cardForNode,
  describeTrafficLink,
  layoutInfrastructureMap,
  trafficEdges,
  trafficLanePath,
  trafficMetricLabel,
  trafficRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph";
import {
  InfrastructureTopologyModel,
  InfrastructureTrafficLink,
  buildInfrastructureTopologyModel,
  collectMapCards,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import { HEALTH_COLORS } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

/*
 * The infrastructure map draws one level of the tree: cards for the
 * workloads and machines in scope, a column of the services running on them,
 * and an arrow per placement. React Flow's rendering is the only boundary
 * replaced; layout runs for real.
 */
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    default: (props: {
      nodes: Array<Node>;
      edges: Array<Edge>;
      onNodeClick: (event: React.MouseEvent, node: Node) => void;
      onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
      onEdgeMouseEnter?: (event: React.MouseEvent, edge: Edge) => void;
      onEdgeMouseLeave?: (event: React.MouseEvent, edge: Edge) => void;
    }): React.ReactElement => {
      return (
        <div data-testid="infrastructure-canvas">
          {props.nodes.map((node: Node): React.ReactElement => {
            return (
              <button
                type="button"
                key={node.id}
                data-testid={`node-${node.id}`}
                onClick={(event: React.MouseEvent): void => {
                  props.onNodeClick(event, node);
                }}
              >
                {node.data.title}
              </button>
            );
          })}
          {props.edges.map((edge: Edge): React.ReactElement => {
            return (
              <button
                type="button"
                key={edge.id}
                data-testid={`edge-${edge.id}`}
                aria-label={edge.ariaLabel}
                onClick={(event: React.MouseEvent): void => {
                  props.onEdgeClick?.(event, edge);
                }}
                onMouseEnter={(event: React.MouseEvent): void => {
                  props.onEdgeMouseEnter?.(event, edge);
                }}
                onMouseLeave={(event: React.MouseEvent): void => {
                  props.onEdgeMouseLeave?.(event, edge);
                }}
              >
                {typeof edge.label === "string" ? edge.label : ""}
              </button>
            );
          })}
          <span data-testid="edge-count">{props.edges.length}</span>
        </div>
      );
    },
    Background: (): null => {
      return null;
    },
    Controls: (): null => {
      return null;
    },
    Handle: (): null => {
      return null;
    },
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Left: "left", Right: "right" },
  };
});

const NOW: Date = new Date("2026-09-07T10:00:00Z");

/* The lean rows the Topology API sends. */
function entity(
  key: string,
  type: EntityType,
  name: string = key,
  lastSeenAt: Date = NOW,
): TopologyEntity {
  return {
    entityKey: key,
    displayName: name,
    entityType: type,
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

function kubernetesModel(): InfrastructureTopologyModel {
  return buildInfrastructureTopologyModel(
    [
      entity("api", EntityType.Service),
      entity("worker", EntityType.Service),
      entity("cluster", EntityType.KubernetesCluster, "prod"),
      entity("ns", EntityType.KubernetesNamespace, "shop"),
      entity("node-a", EntityType.KubernetesNode, "node-a"),
      entity("checkout", EntityType.KubernetesDeployment, "checkout"),
      entity("jobs", EntityType.KubernetesDeployment, "jobs"),
      entity("pod-1", EntityType.KubernetesPod, "checkout-6d4f8b9c7d-x2k9p"),
      entity("pod-2", EntityType.KubernetesPod, "checkout-6d4f8b9c7d-q8zwm"),
      entity("pod-3", EntityType.KubernetesPod, "jobs-7b9d6c5f48-zz2wm"),
    ],
    [
      edge("ns", "cluster", EntityRelationshipType.MemberOf),
      edge("node-a", "cluster", EntityRelationshipType.MemberOf),
      edge("checkout", "ns", EntityRelationshipType.MemberOf),
      edge("jobs", "ns", EntityRelationshipType.MemberOf),
      edge("pod-1", "checkout", EntityRelationshipType.PartOf),
      edge("pod-2", "checkout", EntityRelationshipType.PartOf),
      edge("pod-3", "jobs", EntityRelationshipType.PartOf),
      edge("api", "pod-1", EntityRelationshipType.RunsOn),
      edge("api", "pod-2", EntityRelationshipType.RunsOn),
      edge("worker", "pod-3", EntityRelationshipType.RunsOn),
    ],
    { rangeStart: new Date("2026-09-06T10:00:00Z") },
  );
}

afterEach(() => {
  cleanup();
});

describe("layoutInfrastructureMap", () => {
  test("draws cards plus a service column with one arrow per placement", () => {
    const model: InfrastructureTopologyModel = kubernetesModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, null),
      now: NOW,
    });
    const ids: Array<string> = layout.nodes.map((node: Node) => {
      return node.id;
    });
    expect(ids).toEqual([
      "service:api",
      "service:worker",
      "checkout",
      "jobs",
      "node-a",
    ]);
    expect(
      layout.edges.map((item: Edge) => {
        return `${item.source}->${item.target}`;
      }),
    ).toEqual(["service:api->checkout", "service:worker->jobs"]);
    const x: (id: string) => number = (id: string): number => {
      return layout.nodes.find((node: Node) => {
        return node.id === id;
      })!.position.x;
    };
    expect(x("service:api")).toBeLessThan(x("checkout"));
  });

  test("cards that run something come first", () => {
    const model: InfrastructureTopologyModel = kubernetesModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: ["node-a", "jobs", "checkout"],
      now: NOW,
    });
    expect(
      layout.nodes
        .filter((node: Node) => {
          return !node.id.startsWith("service:");
        })
        .map((node: Node) => {
          return node.id;
        }),
    ).toEqual(["jobs", "checkout", "node-a"]);
  });

  test("with no services there is no service column", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [entity("a", EntityType.Host), entity("b", EntityType.Host)],
      [],
    );
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: ["a", "b"],
      now: NOW,
    });
    expect(layout.edges).toEqual([]);
    expect(layout.nodes[0]!.position.x).toBe(0);
  });

  test("a huge scope is capped with an overflow card", () => {
    const hosts: Array<TopologyEntity> = Array.from(
      { length: MAX_MAP_CARDS + 10 },
      (_value: unknown, index: number) => {
        return entity(`h${index}`, EntityType.Host, `server-${index}x`);
      },
    );
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      hosts,
      [],
    );
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: hosts.map((host: TopologyEntity) => {
        return host.entityKey!;
      }),
      now: NOW,
    });
    expect(layout.nodes).toHaveLength(MAX_MAP_CARDS);
    const overflow: Node | undefined = layout.nodes.find((node: Node) => {
      return node.id === "__more__";
    });
    expect(overflow?.data.title).toBe("11 more");
  });

  test("cards never overlap", () => {
    const model: InfrastructureTopologyModel = kubernetesModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: ["checkout", "jobs", "node-a", "ns", "cluster"],
      now: NOW,
    });
    const seen: Set<string> = new Set<string>();
    for (const node of layout.nodes) {
      const key: string = `${node.position.x},${node.position.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("cards that run a service sit in the column next to the services", () => {
    const model: InfrastructureTopologyModel = kubernetesModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, null),
      now: NOW,
    });
    const x: (id: string) => number = (id: string): number => {
      return layout.nodes.find((node: Node) => {
        return node.id === id;
      })!.position.x;
    };
    // No arrow has to cross another card: both targets share one column...
    expect(x("checkout")).toBe(x("jobs"));
    // ...and the machine nothing runs on starts the next one.
    expect(x("node-a")).toBeGreaterThan(x("checkout"));
  });

  test("a long column of running cards wraps instead of shrinking the map", () => {
    const hosts: Array<TopologyEntity> = Array.from(
      { length: 12 },
      (_value: unknown, index: number) => {
        return entity(`h${index}`, EntityType.Host, `machine-${index}x`);
      },
    );
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [entity("svc", EntityType.Service), ...hosts],
      hosts.map((host: TopologyEntity) => {
        return edge("svc", host.entityKey!, EntityRelationshipType.HostedOn);
      }),
    );
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: hosts.map((host: TopologyEntity) => {
        return host.entityKey!;
      }),
      now: NOW,
    });
    const columns: Set<number> = new Set<number>(
      layout.nodes
        .filter((node: Node) => {
          return !node.id.startsWith("service:");
        })
        .map((node: Node) => {
          return node.position.x;
        }),
    );
    expect(columns.size).toBe(2);
  });
});

describe("cardForNode", () => {
  test("a workload card says where it lives, what it holds and what it runs", () => {
    const model: InfrastructureTopologyModel = kubernetesModel();
    const card: ReturnType<typeof cardForNode> = cardForNode(
      model,
      model.nodes.get("checkout")!,
      NOW,
    );
    expect(card.title).toBe("checkout");
    expect(card.subtitle).toBe("K8s Deployment · shop");
    expect(card.statusLabel).toBe("Active · 2 pods");
    expect(card.stats).toEqual([]);
    expect(card.footer).toBe("Runs api");
  });

  test("a replica group is drawn as a stack", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        entity("h1", EntityType.Host, "web-01"),
        entity("h2", EntityType.Host, "web-02"),
      ],
      [],
    );
    const groupId: string = model.nodes.get("h1")!.parentId!;
    const card: ReturnType<typeof cardForNode> = cardForNode(
      model,
      model.nodes.get(groupId)!,
      NOW,
    );
    expect(card.stacked).toBe(true);
    expect(card.subtitle).toBe("Host replicas");
    expect(card.statusLabel).toBe("Active · 2 hosts");
  });

  test("an inactive machine is dimmed and says when it was last seen", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [entity("old", EntityType.Host, "old", new Date("2026-09-04T10:00:00Z"))],
      [],
      { rangeStart: new Date("2026-09-06T10:00:00Z"), includeInactive: true },
    );
    const card: ReturnType<typeof cardForNode> = cardForNode(
      model,
      model.nodes.get("old")!,
      NOW,
    );
    expect(card.dimmed).toBe(true);
    expect(card.statusLabel).toBe("Inactive · seen 3 days ago");
  });
});

/*
 * A collection — a flat type with more items than the map ships, like
 * thousands of IoT devices — is one card with its count, never a card per
 * item, and opening it opens the collection.
 */
function collectionModel(): InfrastructureTopologyModel {
  return buildInfrastructureTopologyModel(
    [
      entity("svc", EntityType.Service),
      entity("switch", EntityType.NetworkDevice, "core-switch"),
    ],
    [edge("svc", "switch", EntityRelationshipType.RunsOn)],
    {
      rangeStart: new Date("2026-09-06T10:00:00Z"),
      collections: [
        {
          entityType: EntityType.IoTDevice,
          total: 5000,
          active: 4200,
          lastSeenAt: NOW,
          activeLastSeenAt: NOW,
        },
      ],
    },
  );
}

describe("collections on the map", () => {
  test("a collection is one stacked card that carries its count", () => {
    const model: InfrastructureTopologyModel = collectionModel();
    const card: ReturnType<typeof cardForNode> = cardForNode(
      model,
      model.nodes.get("collection:iot.device")!,
      NOW,
    );
    expect(card.title).toBe("IoT Devices");
    expect(card.subtitle).toBe("Collection");
    expect(card.statusLabel).toBe("Active · 4,200 IoT devices");
    expect(card.stacked).toBe(true);
    expect(card.dimmed).toBe(false);
    expect(card.footer).toBeUndefined();
  });

  test("the overview draws the collection as a single card beside the devices", () => {
    const model: InfrastructureTopologyModel = collectionModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, null),
      now: NOW,
    });
    expect(
      layout.nodes.map((node: Node): string => {
        return node.id;
      }),
    ).toEqual(["service:svc", "switch", "collection:iot.device"]);
    expect(
      layout.edges.map((item: Edge): string => {
        return item.target;
      }),
    ).toEqual(["switch"]);
  });

  test("opening the card opens the collection", () => {
    const model: InfrastructureTopologyModel = collectionModel();
    const onOpenNode: MockFunction = getJestMockFunction();
    render(
      <InfrastructureGraph
        model={model}
        nodeIds={collectMapCards(model, null)}
        onOpenNode={onOpenNode}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("node-collection:iot.device")).toHaveTextContent(
      "IoT Devices",
    );
    fireEvent.click(screen.getByTestId("node-collection:iot.device"));
    expect(onOpenNode).toHaveBeenCalledWith("collection:iot.device");
  });

  test("a collection whose items all went quiet is dimmed", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [],
      [],
      {
        rangeStart: new Date("2026-09-06T10:00:00Z"),
        includeInactive: true,
        collections: [
          {
            entityType: EntityType.CloudResource,
            total: 1500,
            active: 0,
            lastSeenAt: new Date("2026-08-10T10:00:00Z"),
            activeLastSeenAt: null,
          },
        ],
      },
    );
    const card: ReturnType<typeof cardForNode> = cardForNode(
      model,
      model.nodes.get("collection:cloud.resource")!,
      NOW,
    );
    expect(card.dimmed).toBe(true);
    expect(card.statusLabel).toBe("Inactive · 1,500 cloud resources");
  });
});

describe("InfrastructureGraph", () => {
  test("opens cards, services and the overflow through their own callbacks", () => {
    const hosts: Array<TopologyEntity> = Array.from(
      { length: MAX_MAP_CARDS + 1 },
      (_value: unknown, index: number) => {
        return entity(`h${index}`, EntityType.Host, `server-${index}x`);
      },
    );
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [entity("svc", EntityType.Service), ...hosts],
      [edge("svc", "h0", EntityRelationshipType.HostedOn)],
    );
    const onOpenNode: MockFunction = getJestMockFunction();
    const onOpenService: MockFunction = getJestMockFunction();
    const onShowAll: MockFunction = getJestMockFunction();
    render(
      <InfrastructureGraph
        model={model}
        nodeIds={hosts.map((host: TopologyEntity) => {
          return host.entityKey!;
        })}
        onOpenNode={onOpenNode}
        onOpenService={onOpenService}
        onShowAll={onShowAll}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByTestId("node-h0"));
    expect(onOpenNode).toHaveBeenCalledWith("h0");
    fireEvent.click(screen.getByTestId("node-service:svc"));
    expect(onOpenService).toHaveBeenCalledWith("svc");
    fireEvent.click(screen.getByTestId("node-__more__"));
    expect(onShowAll).toHaveBeenCalled();
    expect(onOpenNode).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("edge-count")).toHaveTextContent("1");
  });

  test("explains an empty scope", () => {
    render(
      <InfrastructureGraph
        model={buildInfrastructureTopologyModel([], [])}
        nodeIds={[]}
        onOpenNode={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing to draw here",
    );
  });
});

/*
 * Issue #3972: the map drew a node's pods as standalone cards, because
 * nothing on it ever joined two resources. When services on one card call
 * services on another, a line now joins the two cards and carries the calls'
 * traffic, like the Service Map's connections.
 */
function call(
  from: string,
  to: string,
  callCount: number,
  errorCount: number,
  avgDurationMs: number,
): TopologyRelationship {
  return {
    ...edge(from, to, EntityRelationshipType.DependsOn),
    callCount,
    errorCount,
    avgDurationMs,
  };
}

/* The node in the issue's screenshot: four pods of four workloads. */
function aksNodeModel(
  calls: Array<TopologyRelationship> = [
    call("svc-mcp", "svc-backend", 90, 0, 15),
    call("svc-backend", "svc-blob", 1200, 6, 45),
    call("svc-backend", "svc-edh", 300, 30, 120),
    call("svc-edh", "svc-blob", 60, 0, 20),
  ],
): InfrastructureTopologyModel {
  return buildInfrastructureTopologyModel(
    [
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
      entity("pod-quiet", EntityType.KubernetesPod, "cilium-x2k9p"),
    ],
    [
      edge("pod-backend", "node-k", EntityRelationshipType.RunsOn),
      edge("pod-blob", "node-k", EntityRelationshipType.RunsOn),
      edge("pod-edh", "node-k", EntityRelationshipType.RunsOn),
      edge("pod-mcp", "node-k", EntityRelationshipType.RunsOn),
      edge("pod-quiet", "node-k", EntityRelationshipType.RunsOn),
      edge("svc-backend", "pod-backend", EntityRelationshipType.RunsOn),
      edge("svc-blob", "pod-blob", EntityRelationshipType.RunsOn),
      edge("svc-edh", "pod-edh", EntityRelationshipType.RunsOn),
      edge("svc-mcp", "pod-mcp", EntityRelationshipType.RunsOn),
      ...calls,
    ],
    { rangeStart: new Date("2026-09-06T10:00:00Z") },
  );
}

const WINDOW_SECONDS: number = 15 * 60;

function positionOf(
  layout: InfrastructureMapLayout,
  id: string,
): {
  x: number;
  y: number;
} {
  return layout.nodes.find((node: Node) => {
    return node.id === id;
  })!.position;
}

function linkFor(
  layout: InfrastructureMapLayout,
  from: string,
  to: string,
): InfrastructureTrafficLink {
  return layout.traffic.links.find((link: InfrastructureTrafficLink) => {
    return link.from === from && link.to === to;
  })!;
}

/* One service per host, "a" on h-a and so on, with the given calls. */
function hostsModel(
  calls: Array<[string, string, number]>,
): InfrastructureTopologyModel {
  const names: Set<string> = new Set<string>();
  for (const [from, to] of calls) {
    names.add(from);
    names.add(to);
  }
  const entities: Array<TopologyEntity> = [];
  const relationships: Array<TopologyRelationship> = [];
  for (const name of names) {
    entities.push(entity(name, EntityType.Service, name));
    entities.push(entity(`h-${name}`, EntityType.Host, `${name}-box`));
    relationships.push(
      edge(name, `h-${name}`, EntityRelationshipType.HostedOn),
    );
  }
  for (const [from, to, count] of calls) {
    relationships.push(call(from, to, count, 0, 10));
  }
  return buildInfrastructureTopologyModel(entities, relationships);
}

describe("traffic between the cards (issue #3972)", () => {
  test("a node's pods are joined by the calls between the services they run", () => {
    const model: InfrastructureTopologyModel = aksNodeModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    expect(
      layout.traffic.links
        .map((link: InfrastructureTrafficLink): string => {
          return `${link.from}->${link.to}`;
        })
        .sort(),
    ).toEqual([
      "pod-backend->pod-blob",
      "pod-backend->pod-edh",
      "pod-edh->pod-blob",
      "pod-mcp->pod-backend",
    ]);
    /*
     * The traffic is what this map is about now: no service column and no
     * arrows into every card — each card names what it runs.
     */
    expect(layout.edges).toEqual([]);
    expect(
      layout.nodes.filter((node: Node): boolean => {
        return node.id.startsWith("service:");
      }),
    ).toEqual([]);
    expect(
      layout.nodes.find((node: Node): boolean => {
        return node.id === "pod-backend";
      })!.data.footer,
    ).toBe("Runs wb-ims-backend");
  });

  test("cards that talk are laid out in call order, callers first", () => {
    const model: InfrastructureTopologyModel = aksNodeModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    const x: (id: string) => number = (id: string): number => {
      return positionOf(layout, id).x;
    };
    expect(x("pod-mcp")).toBeLessThan(x("pod-backend"));
    expect(x("pod-backend")).toBeLessThan(x("pod-edh"));
    expect(x("pod-edh")).toBeLessThan(x("pod-blob"));
    // The first callers start the drawing.
    expect(x("pod-mcp")).toBe(0);
    // A card nothing talks to follows the ones that do.
    expect(x("pod-quiet")).toBeGreaterThan(x("pod-blob"));
  });

  test("cards never overlap when traffic places them", () => {
    const model: InfrastructureTopologyModel = aksNodeModel([
      call("svc-mcp", "svc-backend", 90, 0, 15),
      call("svc-mcp", "svc-blob", 90, 0, 15),
      call("svc-mcp", "svc-edh", 90, 0, 15),
    ]);
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    const seen: Set<string> = new Set<string>();
    for (const node of layout.nodes) {
      const key: string = `${node.position.x},${node.position.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // One caller, three callees stacked in the next column.
    const callees: Set<number> = new Set<number>(
      ["pod-backend", "pod-blob", "pod-edh"].map((id: string): number => {
        return positionOf(layout, id).x;
      }),
    );
    expect(callees.size).toBe(1);
  });

  test("a line that skips a layer is routed through a slot of its own, clear of the cards", () => {
    const model: InfrastructureTopologyModel = aksNodeModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    /*
     * backend -> blob crosses the integration's layer; the other three
     * lines join neighbouring layers and need no route.
     */
    const backendToBlob: InfrastructureTrafficLink = linkFor(
      layout,
      "pod-backend",
      "pod-blob",
    );
    expect(Array.from(layout.routes.keys())).toEqual([backendToBlob.id]);
    const [slot] = layout.routes.get(backendToBlob.id)!;
    // In the integration's layer, but not where the integration's card is.
    expect(slot!.x).toBe(positionOf(layout, "pod-edh").x);
    expect(slot!.y).not.toBe(positionOf(layout, "pod-edh").y);
    for (const node of layout.nodes) {
      expect(`${node.position.x},${node.position.y}`).not.toBe(
        `${slot!.x},${slot!.y}`,
      );
    }

    const edges: Array<Edge<TrafficEdgeData>> = trafficEdges({
      model,
      links: layout.traffic.links,
      label: "calls",
      metricsWindowSeconds: WINDOW_SECONDS,
      routes: layout.routes,
      cardTops: new Map<string, number>([["pod-backend", 40]]),
    });
    const routed: Array<Edge<TrafficEdgeData>> = edges.filter(
      (item: Edge<TrafficEdgeData>): boolean => {
        return item.type === TRAFFIC_ROUTE_EDGE_TYPE;
      },
    );
    expect(routed).toHaveLength(1);
    expect(routed[0]!.data).toEqual({
      link: backendToBlob,
      waypoints: [slot],
      sourceTop: 40,
    });
    expect(
      edges
        .filter((item: Edge<TrafficEdgeData>): boolean => {
          return item.type === "default";
        })
        .map((item: Edge<TrafficEdgeData>): string => {
          return `${item.source}->${item.target}`;
        })
        .sort(),
    ).toEqual([
      "pod-backend->pod-edh",
      "pod-edh->pod-blob",
      "pod-mcp->pod-backend",
    ]);
  });

  test("a routed line runs straight through each slot and curves between them", () => {
    const route: { path: string; labelX: number; labelY: number } =
      trafficRoutePath({
        sourceX: 256,
        sourceY: 50,
        targetX: 1000,
        targetY: 50,
        waypoints: [
          { x: 356, y: 152 },
          { x: 712, y: 152 },
        ],
        handleOffset: 50,
      });
    expect(route.path).toBe(
      "M 256,50 C 306,50 306,202 356,202 L 612,202 L 712,202 L 968,202 C 984,202 984,50 1000,50",
    );
    // The label sits in the first slot, where no card is.
    expect(route.labelX).toBe(356 + 128);
    expect(route.labelY).toBe(202);
  });

  test("a chain of calls routes a long line through every layer it crosses", () => {
    const model: InfrastructureTopologyModel = aksNodeModel([
      call("svc-mcp", "svc-backend", 90, 0, 15),
      call("svc-backend", "svc-edh", 300, 0, 120),
      call("svc-edh", "svc-blob", 60, 0, 20),
      call("svc-mcp", "svc-blob", 10, 0, 5),
    ]);
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    const long: InfrastructureTrafficLink = linkFor(
      layout,
      "pod-mcp",
      "pod-blob",
    );
    const slots: Array<{ x: number; y: number }> = layout.routes.get(long.id)!;
    expect(
      slots.map((slot: { x: number; y: number }): number => {
        return slot.x;
      }),
    ).toEqual([
      positionOf(layout, "pod-backend").x,
      positionOf(layout, "pod-edh").x,
    ]);
  });

  test("a call against the flow takes a lane above the cards, the forward call stays direct", () => {
    const model: InfrastructureTopologyModel = hostsModel([
      ["a", "b", 100],
      ["b", "a", 10],
    ]);
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: ["h-a", "h-b"],
      now: NOW,
    });
    const back: InfrastructureTrafficLink = linkFor(layout, "h-b", "h-a");
    expect(Array.from(layout.lanes.keys())).toEqual([back.id]);
    const laneY: number = layout.lanes.get(back.id)!;
    expect(laneY).toBeLessThan(
      Math.min(positionOf(layout, "h-a").y, positionOf(layout, "h-b").y),
    );
    const edges: Array<Edge<TrafficEdgeData>> = trafficEdges({
      model,
      links: layout.traffic.links,
      label: "calls",
      metricsWindowSeconds: WINDOW_SECONDS,
      routes: layout.routes,
      lanes: layout.lanes,
    });
    const byLink: (link: InfrastructureTrafficLink) => Edge<TrafficEdgeData> = (
      link: InfrastructureTrafficLink,
    ): Edge<TrafficEdgeData> => {
      return edges.find((item: Edge<TrafficEdgeData>) => {
        return item.data!.link === link;
      })!;
    };
    expect(byLink(back).type).toBe(TRAFFIC_ROUTE_EDGE_TYPE);
    expect(byLink(back).data).toEqual({ link: back, laneY });
    expect(byLink(linkFor(layout, "h-a", "h-b")).type).toBe("default");
  });

  test("each line against the flow has a lane of its own", () => {
    const model: InfrastructureTopologyModel = hostsModel([
      ["a", "b", 100],
      ["b", "c", 100],
      ["c", "b", 10],
      ["b", "a", 10],
      ["c", "a", 10],
    ]);
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: ["h-a", "h-b", "h-c"],
      now: NOW,
    });
    expect(layout.lanes.size).toBe(3);
    expect(new Set<number>(layout.lanes.values()).size).toBe(3);
  });

  test("a line against the flow leaves right, runs over the cards and enters its target from the left", () => {
    const route: { path: string; labelX: number; labelY: number } =
      trafficLanePath({
        sourceX: 868,
        sourceY: 50,
        targetX: 256,
        targetY: 60,
        laneY: -40,
      });
    expect(route.path).toBe(
      "M 868,50 C 916,50 916,-40 868,-40 L 256,-40 C 208,-40 208,60 256,60",
    );
    // Its label sits above the middle of the source card.
    expect(route.labelX).toBe(868 - 128);
    expect(route.labelY).toBe(-40);
  });

  test("calls running both ways between two cards need no route", () => {
    const model: InfrastructureTopologyModel = aksNodeModel([
      call("svc-blob", "svc-edh", 40, 0, 5),
      call("svc-edh", "svc-blob", 60, 0, 20),
    ]);
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    expect(layout.traffic.links).toHaveLength(2);
    expect(layout.routes.size).toBe(0);
  });

  test("with no calls the map is laid out exactly as before", () => {
    const withCalls: InfrastructureTopologyModel = aksNodeModel([]);
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model: withCalls,
      nodeIds: collectMapCards(withCalls, "node-k"),
      now: NOW,
    });
    expect(layout.traffic).toEqual({ links: [], isPartial: false });
    expect(layout.routes.size).toBe(0);
    // Without traffic, the service column and its arrows are back.
    expect(layout.edges).toHaveLength(4);
    // Cards that run something share the column next to the services.
    const runningX: Set<number> = new Set<number>(
      ["pod-backend", "pod-blob", "pod-edh", "pod-mcp"].map(
        (id: string): number => {
          return positionOf(layout, id).x;
        },
      ),
    );
    expect(runningX.size).toBe(1);
    expect(positionOf(layout, "pod-quiet").x).toBeGreaterThan(
      [...runningX][0]!,
    );
  });

  test("lines are labeled with the chosen metric, colored by error rate", () => {
    const model: InfrastructureTopologyModel = aksNodeModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    const backendToBlob: InfrastructureTrafficLink = linkFor(
      layout,
      "pod-backend",
      "pod-blob",
    );
    expect(trafficMetricLabel(backendToBlob, "calls", WINDOW_SECONDS)).toBe(
      "80/min",
    );
    expect(trafficMetricLabel(backendToBlob, "errors", WINDOW_SECONDS)).toBe(
      "0.5% errors",
    );
    expect(trafficMetricLabel(backendToBlob, "latency", WINDOW_SECONDS)).toBe(
      "45ms",
    );

    for (const [label, expected] of [
      ["calls", "80/min"],
      ["errors", "0.5% errors"],
      ["latency", "45ms"],
    ] as const) {
      const edges: Array<Edge<TrafficEdgeData>> = trafficEdges({
        model,
        links: layout.traffic.links,
        label,
        metricsWindowSeconds: WINDOW_SECONDS,
      });
      const drawn: Edge<TrafficEdgeData> = edges.find(
        (item: Edge<TrafficEdgeData>) => {
          return item.data!.link === backendToBlob;
        },
      )!;
      expect(drawn.id.startsWith(TRAFFIC_EDGE_PREFIX)).toBe(true);
      expect(drawn.source).toBe("pod-backend");
      expect(drawn.target).toBe("pod-blob");
      expect(drawn.label).toBe(expected);
    }

    const edges: Array<Edge<TrafficEdgeData>> = trafficEdges({
      model,
      links: layout.traffic.links,
      label: "calls",
      metricsWindowSeconds: WINDOW_SECONDS,
    });
    const colorOf: (link: InfrastructureTrafficLink) => unknown = (
      link: InfrastructureTrafficLink,
    ): unknown => {
      return edges.find((item: Edge<TrafficEdgeData>) => {
        return item.data!.link === link;
      })!.style!.stroke;
    };
    expect(colorOf(backendToBlob)).toBe(HEALTH_COLORS.healthy);
    expect(colorOf(linkFor(layout, "pod-backend", "pod-edh"))).toBe(
      HEALTH_COLORS.critical,
    );
  });

  test("on hover, only the hovered line is labeled", () => {
    const model: InfrastructureTopologyModel = aksNodeModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    const quiet: Array<Edge<TrafficEdgeData>> = trafficEdges({
      model,
      links: layout.traffic.links,
      label: "hover",
      metricsWindowSeconds: WINDOW_SECONDS,
    });
    expect(
      quiet.every((item: Edge<TrafficEdgeData>): boolean => {
        return item.label === undefined;
      }),
    ).toBe(true);
    const hoveredId: string = quiet[0]!.id;
    const hovered: Array<Edge<TrafficEdgeData>> = trafficEdges({
      model,
      links: layout.traffic.links,
      label: "hover",
      hoveredId,
      metricsWindowSeconds: WINDOW_SECONDS,
    });
    expect(
      hovered
        .filter((item: Edge<TrafficEdgeData>): boolean => {
          return item.label !== undefined;
        })
        .map((item: Edge<TrafficEdgeData>): string => {
          return item.id;
        }),
    ).toEqual([hoveredId]);
  });

  test("a line whose calls reported no count is drawn gray and unlabeled", () => {
    const model: InfrastructureTopologyModel = aksNodeModel([
      { ...edge("svc-backend", "svc-blob", EntityRelationshipType.DependsOn) },
    ]);
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    const [drawn] = trafficEdges({
      model,
      links: layout.traffic.links,
      label: "calls",
      metricsWindowSeconds: WINDOW_SECONDS,
    });
    expect(drawn!.label).toBeUndefined();
    expect(drawn!.style!.stroke).toBe(HEALTH_COLORS.unknown);
    expect(drawn!.ariaLabel).toBe(
      "wb-ims-backend → wb-ims-blob: no calls counted",
    );
  });

  test("a line says which calls it stands for", () => {
    const model: InfrastructureTopologyModel = aksNodeModel();
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: collectMapCards(model, "node-k"),
      now: NOW,
    });
    expect(
      describeTrafficLink(
        model,
        linkFor(layout, "pod-backend", "pod-blob"),
        WINDOW_SECONDS,
      ),
    ).toBe("wb-ims-backend → wb-ims-blob: 80/min · 0.5% errors · 45ms avg");
  });

  test("a line standing for many calls names the busiest three", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        entity("a", EntityType.Service, "alpha"),
        entity("b", EntityType.Service, "bravo"),
        entity("c", EntityType.Service, "charlie"),
        entity("d", EntityType.Service, "delta"),
        entity("e", EntityType.Service, "echo"),
        entity("left", EntityType.Host, "left-box"),
        entity("right", EntityType.Host, "right-box"),
      ],
      [
        edge("a", "left", EntityRelationshipType.HostedOn),
        edge("b", "right", EntityRelationshipType.HostedOn),
        edge("c", "right", EntityRelationshipType.HostedOn),
        edge("d", "right", EntityRelationshipType.HostedOn),
        edge("e", "right", EntityRelationshipType.HostedOn),
        call("a", "b", 10, 0, 1),
        call("a", "c", 40, 0, 1),
        call("a", "d", 30, 0, 1),
        call("a", "e", 20, 0, 1),
      ],
    );
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: ["left", "right"],
      now: NOW,
    });
    expect(
      describeTrafficLink(
        model,
        linkFor(layout, "left", "right"),
        WINDOW_SECONDS,
      ),
    ).toBe(
      "alpha → charlie, alpha → delta, alpha → echo +1: 6.7/min · 0% errors · 1ms avg",
    );
  });
});

describe("InfrastructureGraph traffic", () => {
  function renderNode(
    model: InfrastructureTopologyModel,
    onOpenTraffic?: (link: InfrastructureTrafficLink) => void,
  ): void {
    render(
      <InfrastructureGraph
        model={model}
        nodeIds={collectMapCards(model, "node-k")}
        onOpenNode={() => {}}
        onOpenTraffic={onOpenTraffic}
        metricsWindowSeconds={WINDOW_SECONDS}
        now={NOW}
      />,
    );
  }

  function trafficButtons(): Array<HTMLElement> {
    return screen.getAllByTestId(/^edge-traffic:/);
  }

  test("draws the lines with request rates, and says what they are", () => {
    renderNode(aksNodeModel());
    expect(trafficButtons()).toHaveLength(4);
    expect(
      trafficButtons()
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        })
        .sort(),
    ).toEqual(["20/min", "4.0/min", "6.0/min", "80/min"]);
    expect(
      screen.getByTestId("infrastructure-traffic-status"),
    ).toHaveTextContent(
      "4 connections · Lines are calls between the services on these cards, measured per service.",
    );
    // Only the traffic: no placement arrows beside it.
    expect(screen.getByTestId("edge-count")).toHaveTextContent("4");
    expect(
      screen.getByRole("button", {
        name: "wb-ims-backend → wb-ims-blob: 80/min · 0.5% errors · 45ms avg",
      }),
    ).toBeInTheDocument();
  });

  test("the label picker switches every line to another metric", () => {
    renderNode(aksNodeModel());
    fireEvent.change(screen.getByLabelText("Line labels"), {
      target: { value: "errors" },
    });
    expect(
      trafficButtons()
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        })
        .sort(),
    ).toEqual(["0% errors", "0% errors", "0.5% errors", "10.0% errors"]);
    fireEvent.change(screen.getByLabelText("Line labels"), {
      target: { value: "hover" },
    });
    expect(
      trafficButtons().every((button: HTMLElement): boolean => {
        return button.textContent === "";
      }),
    ).toBe(true);
  });

  test("hovering a line says which calls it carries", () => {
    renderNode(aksNodeModel());
    expect(
      screen.queryByTestId("infrastructure-traffic-hover"),
    ).not.toBeInTheDocument();
    const line: HTMLElement = screen.getByRole("button", {
      name: "wb-ims-backend → wb-ims-integration-edh: 20/min · 10.0% errors · 120ms avg",
    });
    fireEvent.mouseEnter(line);
    expect(
      screen.getByTestId("infrastructure-traffic-hover"),
    ).toHaveTextContent(
      "wb-ims-backend → wb-ims-integration-edh: 20/min · 10.0% errors · 120ms avg",
    );
    fireEvent.mouseLeave(line);
    expect(
      screen.queryByTestId("infrastructure-traffic-hover"),
    ).not.toBeInTheDocument();
  });

  test("clicking a line opens it; clicking a card opens the card", () => {
    const onOpenTraffic: MockFunction = getJestMockFunction();
    renderNode(aksNodeModel(), onOpenTraffic);
    fireEvent.click(
      screen.getByRole("button", {
        name: "wb-ims-backend → wb-ims-blob: 80/min · 0.5% errors · 45ms avg",
      }),
    );
    expect(onOpenTraffic).toHaveBeenCalledTimes(1);
    const link: InfrastructureTrafficLink = onOpenTraffic.mock
      .calls[0]![0] as InfrastructureTrafficLink;
    expect(link.from).toBe("pod-backend");
    expect(link.to).toBe("pod-blob");
    expect(link.serviceCalls[0]!.from).toBe("svc-backend");
    fireEvent.click(screen.getByTestId("node-pod-blob"));
    expect(onOpenTraffic).toHaveBeenCalledTimes(1);
  });

  test("the invisible slots a routed line runs through open nothing", () => {
    const onOpenTraffic: MockFunction = getJestMockFunction();
    const onOpenNode: MockFunction = getJestMockFunction();
    const model: InfrastructureTopologyModel = aksNodeModel();
    render(
      <InfrastructureGraph
        model={model}
        nodeIds={collectMapCards(model, "node-k")}
        onOpenNode={onOpenNode}
        onOpenTraffic={onOpenTraffic}
        metricsWindowSeconds={WINDOW_SECONDS}
        now={NOW}
      />,
    );
    const slots: Array<HTMLElement> =
      screen.getAllByTestId(/^node-route-slot:/);
    expect(slots).toHaveLength(1);
    fireEvent.click(slots[0]!);
    expect(onOpenNode).not.toHaveBeenCalled();
    expect(onOpenTraffic).not.toHaveBeenCalled();
  });

  test("past a few lines, labels wait for the pointer until the user picks a metric", () => {
    const calls: Array<[string, string, number]> = [];
    for (const caller of ["a", "b", "c", "d"]) {
      for (const callee of ["x", "y"]) {
        calls.push([caller, callee, 900]);
      }
    }
    const model: InfrastructureTopologyModel = hostsModel(calls);
    render(
      <InfrastructureGraph
        model={model}
        nodeIds={collectMapCards(model, null)}
        onOpenNode={() => {}}
        metricsWindowSeconds={WINDOW_SECONDS}
        now={NOW}
      />,
    );
    expect(trafficButtons()).toHaveLength(8);
    expect(screen.getByLabelText("Line labels")).toHaveValue("hover");
    expect(
      trafficButtons().every((button: HTMLElement): boolean => {
        return button.textContent === "";
      }),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Line labels"), {
      target: { value: "calls" },
    });
    expect(
      trafficButtons().every((button: HTMLElement): boolean => {
        return button.textContent === "60/min";
      }),
    ).toBe(true);
  });

  test("services that never called each other say so instead of drawing nothing silently", () => {
    renderNode(aksNodeModel([]));
    expect(screen.queryAllByTestId(/^edge-traffic:/)).toHaveLength(0);
    expect(
      screen.getByTestId("infrastructure-traffic-status"),
    ).toHaveTextContent(
      "The services on these cards were not seen calling each other in this time range.",
    );
    expect(screen.queryByLabelText("Line labels")).not.toBeInTheDocument();
  });

  test("a scope where no service is known to run explains why nothing is joined", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [entity("a", EntityType.Host), entity("b", EntityType.Host)],
      [],
    );
    render(
      <InfrastructureGraph
        model={model}
        nodeIds={["a", "b"]}
        onOpenNode={() => {}}
        now={NOW}
      />,
    );
    expect(
      screen.getByTestId("infrastructure-traffic-status"),
    ).toHaveTextContent(
      "No services are known to run on these cards, so there are no calls to draw between them.",
    );
  });
});
