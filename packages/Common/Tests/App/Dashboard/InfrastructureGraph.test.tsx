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
  cardForNode,
  layoutInfrastructureMap,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph";
import {
  InfrastructureTopologyModel,
  buildInfrastructureTopologyModel,
  collectMapCards,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
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
