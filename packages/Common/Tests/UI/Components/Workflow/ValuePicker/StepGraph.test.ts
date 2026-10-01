/*
 * Which steps a step's settings can read values from.
 *
 * The picker offers only what exists by the time the step runs: the trigger,
 * and the steps the runner reaches before this one. Offering a step that
 * runs later would hand the builder a reference GraphLint immediately
 * reports as a forward reference - and that is always empty at run time.
 */

import {
  EMPTY_STEP_VALUE_SOURCES,
  StepGraphEdge,
  StepGraphNode,
  StepValueSources,
  getStepValueSources,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepGraph";
import IconProp from "../../../../../Types/Icon/IconProp";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

type MakeNodeFunction = (
  id: string,
  componentType?: ComponentType,
) => StepGraphNode;

// The react-flow id is "rf-" + the step's id, so the two are never confused.
const node: MakeNodeFunction = (
  id: string,
  componentType: ComponentType = ComponentType.Component,
): StepGraphNode => {
  return {
    id: `rf-${id}`,
    data: {
      id: id,
      error: "",
      nodeType: NodeType.Node,
      metadataId: id,
      internalId: `internal-${id}`,
      arguments: {},
      returnValues: {},
      componentType: componentType,
      metadata: {
        id: id,
        title: id,
        category: "Test",
        description: "",
        iconProp: IconProp.Bolt,
        componentType: componentType,
        arguments: [],
        returnValues: [],
        inPorts: [],
        outPorts: [],
      },
    } as NodeDataProp,
  };
};

type EdgeFunction = (from: string, to: string) => StepGraphEdge;

const edge: EdgeFunction = (from: string, to: string): StepGraphEdge => {
  return { source: `rf-${from}`, target: `rf-${to}` };
};

type UpstreamIdsFunction = (sources: StepValueSources) => Array<string>;

const upstreamIds: UpstreamIdsFunction = (
  sources: StepValueSources,
): Array<string> => {
  return sources.upstream.map((step: NodeDataProp) => {
    return step.id;
  });
};

const trigger: StepGraphNode = node("webhook-1", ComponentType.Trigger);

describe("getStepValueSources", () => {
  test("a chain: everything before the step, the trigger first, nothing after", () => {
    const nodes: Array<StepGraphNode> = [
      trigger,
      node("api-1"),
      node("log-1"),
      node("slack-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("webhook-1", "api-1"),
      edge("api-1", "log-1"),
      edge("log-1", "slack-1"),
    ];

    const sources: StepValueSources = getStepValueSources({
      nodes,
      edges,
      nodeId: "rf-log-1",
    });

    expect(upstreamIds(sources)).toEqual(["webhook-1", "api-1"]);
    expect(sources.downstreamIds).toEqual(["slack-1"]);
    expect(sources.hasIncomingConnection).toBe(true);
  });

  test("a step just added, connected to nothing, can still read the trigger", () => {
    const nodes: Array<StepGraphNode> = [trigger, node("api-1"), node("new-1")];
    const edges: Array<StepGraphEdge> = [edge("webhook-1", "api-1")];

    const sources: StepValueSources = getStepValueSources({
      nodes,
      edges,
      nodeId: "rf-new-1",
    });

    // Not the API step: nothing says it runs before this one.
    expect(upstreamIds(sources)).toEqual(["webhook-1"]);
    expect(sources.hasIncomingConnection).toBe(false);
    expect(sources.downstreamIds).toEqual([]);
  });

  test("a step after an If/Else join can read both branches", () => {
    const nodes: Array<StepGraphNode> = [
      trigger,
      node("if-1"),
      node("yes-1"),
      node("no-1"),
      node("join-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("webhook-1", "if-1"),
      edge("if-1", "yes-1"),
      edge("if-1", "no-1"),
      edge("yes-1", "join-1"),
      edge("no-1", "join-1"),
    ];

    expect(
      upstreamIds(getStepValueSources({ nodes, edges, nodeId: "rf-join-1" })),
    ).toEqual(["webhook-1", "if-1", "yes-1", "no-1"]);
  });

  test("a step on one branch cannot read the other branch", () => {
    const nodes: Array<StepGraphNode> = [
      trigger,
      node("if-1"),
      node("yes-1"),
      node("no-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("webhook-1", "if-1"),
      edge("if-1", "yes-1"),
      edge("if-1", "no-1"),
    ];

    const sources: StepValueSources = getStepValueSources({
      nodes,
      edges,
      nodeId: "rf-yes-1",
    });

    expect(upstreamIds(sources)).toEqual(["webhook-1", "if-1"]);
    expect(upstreamIds(sources)).not.toContain("no-1");
    expect(sources.downstreamIds).toEqual([]);
  });

  test("a trigger reads nothing: it runs first", () => {
    const nodes: Array<StepGraphNode> = [trigger, node("api-1")];
    const edges: Array<StepGraphEdge> = [edge("webhook-1", "api-1")];

    const sources: StepValueSources = getStepValueSources({
      nodes,
      edges,
      nodeId: "rf-webhook-1",
    });

    expect(upstreamIds(sources)).toEqual([]);
    expect(sources.downstreamIds).toEqual(["api-1"]);
  });

  test("the step itself is never offered, even in a loop", () => {
    const nodes: Array<StepGraphNode> = [trigger, node("a-1"), node("b-1")];
    const edges: Array<StepGraphEdge> = [
      edge("webhook-1", "a-1"),
      edge("a-1", "b-1"),
      edge("b-1", "a-1"),
    ];

    const sources: StepValueSources = getStepValueSources({
      nodes,
      edges,
      nodeId: "rf-a-1",
    });

    expect(upstreamIds(sources)).not.toContain("a-1");
    // In a loop b-1 is before and after a-1; after wins, as for the linter.
    expect(upstreamIds(sources)).toEqual(["webhook-1"]);
    expect(sources.downstreamIds).toEqual(["b-1"]);
  });

  test("a chain no trigger reaches yet still feeds the step, farthest first", () => {
    const nodes: Array<StepGraphNode> = [
      trigger,
      node("first-1"),
      node("second-1"),
      node("target-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("first-1", "second-1"),
      edge("second-1", "target-1"),
    ];

    expect(
      upstreamIds(getStepValueSources({ nodes, edges, nodeId: "rf-target-1" })),
    ).toEqual(["webhook-1", "first-1", "second-1"]);
  });

  test("the placeholder trigger node is not a step", () => {
    const placeholder: StepGraphNode = {
      id: "rf-placeholder",
      data: {
        nodeType: NodeType.PlaceholderNode,
        componentType: ComponentType.Trigger,
        metadata: { title: "Trigger" },
      } as unknown as NodeDataProp,
    };

    const sources: StepValueSources = getStepValueSources({
      nodes: [placeholder, node("log-1")],
      edges: [{ source: "rf-placeholder", target: "rf-log-1" }],
      nodeId: "rf-log-1",
    });

    expect(sources.upstream).toEqual([]);
    // An edge from the placeholder connects nothing.
    expect(sources.hasIncomingConnection).toBe(false);
  });

  test("an edge to a node that is not in the graph is ignored", () => {
    const sources: StepValueSources = getStepValueSources({
      nodes: [trigger, node("log-1")],
      edges: [edge("webhook-1", "log-1"), edge("ghost-1", "log-1")],
      nodeId: "rf-log-1",
    });

    expect(upstreamIds(sources)).toEqual(["webhook-1"]);
  });

  test("a node that is not in the graph has nothing to read", () => {
    expect(
      getStepValueSources({
        nodes: [trigger],
        edges: [],
        nodeId: "rf-missing",
      }),
    ).toEqual(EMPTY_STEP_VALUE_SOURCES);
  });

  test("a step reached twice is listed once", () => {
    const nodes: Array<StepGraphNode> = [
      trigger,
      node("api-1"),
      node("log-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("webhook-1", "api-1"),
      edge("webhook-1", "log-1"),
      edge("api-1", "log-1"),
      edge("api-1", "log-1"),
    ];

    expect(
      upstreamIds(getStepValueSources({ nodes, edges, nodeId: "rf-log-1" })),
    ).toEqual(["webhook-1", "api-1"]);
  });
});
