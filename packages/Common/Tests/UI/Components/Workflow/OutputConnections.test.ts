/*
 * Which steps a step's outputs lead to, and the connections a Switch / Case
 * loses with a case (Workflow/OutputConnections).
 *
 * The task: "editing the cases adds, renames and removes ports; an edge from
 * a removed case is dropped with a clear note". The settings name what each
 * output leads to - and what removing a case disconnects - from
 * getOutputConnections, and the builder drops exactly the connections from
 * outputs the step no longer has with dropConnectionsFromMissingOutputs.
 */

import {
  ConnectionGraphEdge,
  ConnectionGraphNode,
  dropConnectionsFromMissingOutputs,
  getOutputConnections,
} from "../../../../UI/Components/Workflow/OutputConnections";
import { OutputConnections } from "../../../../UI/Components/Workflow/Switch/SwitchModel";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import IconProp from "../../../../Types/Icon/IconProp";
import { describe, expect, test } from "@jest/globals";

type NodeFunction = (
  canvasId: string,
  stepId: string,
  title: string,
  nodeType?: NodeType,
) => ConnectionGraphNode;

const node: NodeFunction = (
  canvasId: string,
  stepId: string,
  title: string,
  nodeType: NodeType = NodeType.Node,
): ConnectionGraphNode => {
  return {
    id: canvasId,
    data: {
      id: stepId,
      nodeType: nodeType,
      error: "",
      internalId: `runner-${stepId}`,
      metadataId: "x",
      metadata: {
        id: "x",
        title: title,
        description: "",
        category: "",
        iconProp: IconProp.Bolt,
        componentType: ComponentType.Component,
        arguments: [],
        returnValues: [],
        inPorts: [],
        outPorts: [],
      },
      arguments: {},
      returnValues: {},
      componentType: ComponentType.Component,
    } as NodeDataProp,
  };
};

type EdgeFunction = (
  source: string,
  sourceHandle: string | null | undefined,
  target: string,
) => ConnectionGraphEdge & { id: string };

const edge: EdgeFunction = (
  source: string,
  sourceHandle: string | null | undefined,
  target: string,
): ConnectionGraphEdge & { id: string } => {
  return {
    id: `${source}-${sourceHandle}-${target}`,
    source: source,
    target: target,
    sourceHandle: sourceHandle,
  };
};

const NODES: Array<ConnectionGraphNode> = [
  node("n-switch", "switch-1", "Switch / Case"),
  node("n-slack", "slack-critical", "Send Message to Slack"),
  node("n-teams", "teams-1", "Send Message to Teams"),
  node("n-log", "log-1", "Log"),
  node("n-trigger", "manual-1", "Manual"),
  node("n-placeholder", "", "Trigger", NodeType.PlaceholderNode),
];

describe("where a step's outputs lead", () => {
  test("by output: the steps connected to it, by id and title, in the order they were connected", () => {
    const connections: OutputConnections = getOutputConnections({
      nodes: NODES,
      edges: [
        edge("n-trigger", "success", "n-switch"),
        edge("n-switch", "case-1", "n-slack"),
        edge("n-switch", "case-1", "n-teams"),
        edge("n-switch", "default", "n-log"),
      ],
      nodeId: "n-switch",
    });

    expect(connections).toEqual({
      "case-1": [
        { componentId: "slack-critical", title: "Send Message to Slack" },
        { componentId: "teams-1", title: "Send Message to Teams" },
      ],
      default: [{ componentId: "log-1", title: "Log" }],
    });
  });

  test("an output nothing is connected to is not listed", () => {
    expect(
      getOutputConnections({
        nodes: NODES,
        edges: [edge("n-switch", "case-1", "n-slack")],
        nodeId: "n-switch",
      })["case-2"],
    ).toBeUndefined();
  });

  test("only the step's own connections, and only those leaving it", () => {
    expect(
      getOutputConnections({
        nodes: NODES,
        edges: [
          edge("n-trigger", "success", "n-switch"),
          edge("n-slack", "error", "n-log"),
        ],
        nodeId: "n-switch",
      }),
    ).toEqual({});
  });

  test("a step connected twice to one output is listed once", () => {
    expect(
      getOutputConnections({
        nodes: NODES,
        edges: [
          edge("n-switch", "case-1", "n-slack"),
          { ...edge("n-switch", "case-1", "n-slack"), id: "again" },
        ],
        nodeId: "n-switch",
      })["case-1"],
    ).toHaveLength(1);
  });

  test("a connection that says no output, leads nowhere, or reaches a placeholder is not a step", () => {
    expect(
      getOutputConnections({
        nodes: NODES,
        edges: [
          edge("n-switch", null, "n-slack"),
          edge("n-switch", undefined, "n-slack"),
          edge("n-switch", "case-1", "n-gone"),
          edge("n-switch", "case-2", "n-placeholder"),
        ],
        nodeId: "n-switch",
      }),
    ).toEqual({});
  });

  test("a step with no title is named by its id", () => {
    const untitled: ConnectionGraphNode = node("n-x", "step-x", "");

    expect(
      getOutputConnections({
        nodes: [...NODES, untitled],
        edges: [edge("n-switch", "case-1", "n-x")],
        nodeId: "n-switch",
      })["case-1"],
    ).toEqual([{ componentId: "step-x", title: "step-x" }]);
  });
});

describe("dropping the connections of outputs a step no longer has", () => {
  const EDGES: Array<ConnectionGraphEdge & { id: string }> = [
    edge("n-trigger", "success", "n-switch"),
    edge("n-switch", "case-1", "n-slack"),
    edge("n-switch", "case-2", "n-teams"),
    edge("n-switch", "default", "n-log"),
    edge("n-slack", "error", "n-log"),
  ];

  test("drops the connection from a removed case, and keeps everything else as it is", () => {
    const kept: Array<ConnectionGraphEdge & { id: string }> =
      dropConnectionsFromMissingOutputs({
        edges: EDGES,
        nodeId: "n-switch",
        outputIds: ["case-1", "default"],
      });

    expect(
      kept.map((kept: { id: string }): string => {
        return kept.id;
      }),
    ).toEqual([
      "n-trigger-success-n-switch",
      "n-switch-case-1-n-slack",
      "n-switch-default-n-log",
      "n-slack-error-n-log",
    ]);

    // The same objects, untouched.
    expect(kept[0]).toBe(EDGES[0]);
  });

  test("keeps every connection while every output is still there", () => {
    expect(
      dropConnectionsFromMissingOutputs({
        edges: EDGES,
        nodeId: "n-switch",
        outputIds: ["case-1", "case-2", "default"],
      }),
    ).toEqual(EDGES);
  });

  test("never touches another step's connections, even from an output of the same name", () => {
    const sameName: Array<ConnectionGraphEdge & { id: string }> = [
      edge("n-other-switch", "case-2", "n-teams"),
    ];

    expect(
      dropConnectionsFromMissingOutputs({
        edges: sameName,
        nodeId: "n-switch",
        outputIds: ["default"],
      }),
    ).toEqual(sameName);
  });

  test("keeps a connection that does not say which output it leaves from", () => {
    const unnamed: Array<ConnectionGraphEdge & { id: string }> = [
      edge("n-switch", null, "n-teams"),
      edge("n-switch", undefined, "n-log"),
      edge("n-switch", "", "n-slack"),
    ];

    expect(
      dropConnectionsFromMissingOutputs({
        edges: unnamed,
        nodeId: "n-switch",
        outputIds: ["default"],
      }),
    ).toEqual(unnamed);
  });

  test("a step left with Default alone keeps only Default's connections", () => {
    expect(
      dropConnectionsFromMissingOutputs({
        edges: EDGES,
        nodeId: "n-switch",
        outputIds: ["default"],
      }).filter((kept: ConnectionGraphEdge): boolean => {
        return kept.source === "n-switch";
      }),
    ).toEqual([edge("n-switch", "default", "n-log")]);
  });
});
