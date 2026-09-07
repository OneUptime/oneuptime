import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { Edge, Node } from "reactflow";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../Models/DatabaseModels/InventoryItemRelationship";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import InfrastructureGraph from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph";

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
 * Inspect the actual nodes and connections handed to the canvas. Layout and
 * nesting run normally; React Flow's browser measurement is the only boundary
 * replaced, so an edge silently filtered before rendering fails these tests.
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
          <div>
            {props.nodes.map((node: Node): React.ReactElement => {
              return (
                <button
                  type="button"
                  key={node.id}
                  data-testid={`node-${node.id}`}
                  data-parent={node.parentNode || ""}
                  onClick={(event: React.MouseEvent): void => {
                    props.onNodeClick(event, node);
                  }}
                >
                  {node.data.title}
                </button>
              );
            })}
          </div>
          <ul aria-label="Visible infrastructure connections">
            {props.edges.map((edge: Edge): React.ReactElement => {
              return (
                <li
                  key={edge.id}
                  data-source={edge.source}
                  data-target={edge.target}
                  data-relationship={edge.data?.relationshipType}
                >
                  {edge.source} → {edge.target}
                </li>
              );
            })}
          </ul>
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
    Position: { Top: "top", Bottom: "bottom" },
  };
});

function entity(key: string, type: EntityType): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item.entityKey = key;
  item.displayName = key;
  item.entityType = type;
  return item;
}
function edge(
  from: string,
  to: string,
  type: EntityRelationshipType = EntityRelationshipType.HostedOn,
): InventoryItemRelationship {
  const item: InventoryItemRelationship = new InventoryItemRelationship();
  item.fromEntityKey = from;
  item.toEntityKey = to;
  item.relationshipType = type;
  return item;
}
function connections(): Array<HTMLElement> {
  return within(
    screen.getByRole("list", { name: "Visible infrastructure connections" }),
  ).queryAllByRole("listitem");
}

afterEach(() => {
  cleanup();
});

describe("Infrastructure canvas connection fidelity", () => {
  test("keeps a shared host's other service connection after nesting it under its primary service", () => {
    render(
      <InfrastructureGraph
        entities={[
          entity("api", EntityType.Service),
          entity("web", EntityType.Service),
          entity("shared-host", EntityType.Host),
        ]}
        relationships={[edge("web", "shared-host"), edge("api", "shared-host")]}
      />,
    );
    expect(screen.getByTestId("node-shared-host")).toHaveAttribute(
      "data-parent",
      "api",
    );
    expect(connections()).toHaveLength(1);
    expect(connections()[0]).toHaveAttribute("data-source", "web");
    expect(connections()[0]).toHaveAttribute("data-target", "shared-host");
    expect(connections()[0]).toHaveAttribute(
      "data-relationship",
      EntityRelationshipType.HostedOn,
    );
    // api → host is already represented by nesting; web → host is not.
    expect(screen.queryByText("api → shared-host")).not.toBeInTheDocument();
  });

  test("hides only the relationship actually consumed by nesting when the same pair has another relationship", () => {
    render(
      <InfrastructureGraph
        entities={[
          entity("api", EntityType.Service),
          entity("host", EntityType.Host),
        ]}
        relationships={[
          edge("api", "host"),
          edge("api", "host", EntityRelationshipType.RunsOn),
        ]}
      />,
    );
    expect(screen.getByTestId("node-host")).toHaveAttribute(
      "data-parent",
      "api",
    );
    expect(connections()).toHaveLength(1);
    expect(connections()[0]).toHaveAttribute("data-source", "api");
    expect(connections()[0]).toHaveAttribute(
      "data-relationship",
      EntityRelationshipType.RunsOn,
    );
  });

  test("preserves workload connections while structural pod and node relationships remain represented by their boxes", () => {
    render(
      <InfrastructureGraph
        entities={[
          entity("cluster", EntityType.KubernetesCluster),
          entity("node", EntityType.KubernetesNode),
          entity("pod", EntityType.KubernetesPod),
          entity("api", EntityType.Service),
        ]}
        relationships={[
          edge("node", "cluster", EntityRelationshipType.MemberOf),
          edge("pod", "node", EntityRelationshipType.RunsOn),
          edge("api", "pod", EntityRelationshipType.RunsOn),
        ]}
      />,
    );
    expect(screen.getByTestId("node-node")).toHaveAttribute(
      "data-parent",
      "cluster",
    );
    expect(screen.getByTestId("node-pod")).toHaveAttribute(
      "data-parent",
      "node",
    );
    expect(connections()).toHaveLength(1);
    expect(connections()[0]).toHaveAttribute("data-source", "api");
    expect(connections()[0]).toHaveAttribute("data-target", "pod");
  });

  test("keeps unresolved connection endpoints selectable by their actual identity", () => {
    const onSelectResource: MockFunction = getJestMockFunction();
    render(
      <InfrastructureGraph
        entities={[entity("host", EntityType.Host)]}
        relationships={[
          edge("host", "missing-resource", EntityRelationshipType.MemberOf),
        ]}
        onSelectResource={onSelectResource}
      />,
    );
    expect(screen.getByTestId("node-missing-resource")).toHaveTextContent(
      "Undiscovered resource · missing-resource",
    );
    expect(connections()).toHaveLength(1);
    fireEvent.click(screen.getByTestId("node-missing-resource"));
    expect(onSelectResource).toHaveBeenCalledWith("missing-resource");
  });

  test("explains an empty scoped canvas", () => {
    render(<InfrastructureGraph entities={[]} relationships={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No resources in this map",
    );
    expect(
      screen.queryByTestId("infrastructure-canvas"),
    ).not.toBeInTheDocument();
  });
});
