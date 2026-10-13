/*
 * What a step's values are where another step runs (ValuePicker/StepGraph):
 * there on every run, there on some runs only, or not there at all - and
 * why. "Pls make the available and non-available variables a little more
 * visually distinct": the picker can only draw the difference if the graph
 * says it.
 *
 * Built from the real step definitions, so If / Else's Yes and No, Switch /
 * Case's cases and an API call's Success and Error are the outputs the
 * builder draws.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import {
  StepGraphEdge,
  StepGraphNode,
  StepValueSources,
  UnavailableReason,
  UnavailableStep,
  getStepValueSources,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepGraph";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import { JSONObject } from "../../../../../Types/JSON";
import {
  getStarterSwitchCases,
  toStoredSwitchCases,
} from "../../../../../Types/Workflow/Components/SwitchCases";
import { describe, expect, jest, test } from "@jest/globals";

type NodeFunction = (
  metadataId: string,
  id: string,
  args?: JSONObject,
) => StepGraphNode;

// A step as the canvas holds it; its react-flow id is "rf-" + its own.
const node: NodeFunction = (
  metadataId: string,
  id: string,
  args?: JSONObject,
): StepGraphNode => {
  const metadata: ComponentMetadata = Components.find(
    (component: ComponentMetadata): boolean => {
      return component.id === metadataId;
    },
  ) as ComponentMetadata;

  return {
    id: `rf-${id}`,
    data: {
      id: id,
      error: "",
      nodeType: NodeType.Node,
      metadata: metadata,
      metadataId: metadataId,
      internalId: `internal-${id}`,
      arguments: args || {},
      returnValues: {},
      componentType: metadata.componentType,
    } as NodeDataProp,
  };
};

type EdgeFunction = (from: string, output: string, to: string) => StepGraphEdge;

const edge: EdgeFunction = (
  from: string,
  output: string,
  to: string,
): StepGraphEdge => {
  return { source: `rf-${from}`, sourceHandle: output, target: `rf-${to}` };
};

type SourcesFunction = (
  nodes: Array<StepGraphNode>,
  edges: Array<StepGraphEdge>,
  stepId: string,
) => StepValueSources;

const sourcesOf: SourcesFunction = (
  nodes: Array<StepGraphNode>,
  edges: Array<StepGraphEdge>,
  stepId: string,
): StepValueSources => {
  return getStepValueSources({
    nodes: nodes,
    edges: edges,
    nodeId: `rf-${stepId}`,
  });
};

type IdsFunction = (steps: Array<NodeDataProp>) => Array<string>;

const ids: IdsFunction = (steps: Array<NodeDataProp>): Array<string> => {
  return steps.map((step: NodeDataProp): string => {
    return step.id;
  });
};

type UnavailableFunction = (
  sources: StepValueSources,
) => Array<[string, UnavailableReason]>;

const unavailableOf: UnavailableFunction = (
  sources: StepValueSources,
): Array<[string, UnavailableReason]> => {
  return (sources.unavailable || []).map(
    (entry: UnavailableStep): [string, UnavailableReason] => {
      return [entry.step.id, entry.reason];
    },
  );
};

/*
 * Webhook → If / Else; Yes → HTTP POST, No → Log; both into Slack; after
 * Slack, a GET; and a GET connected to nothing.
 */
const NODES: Array<StepGraphNode> = [
  node(ComponentID.Webhook, "webhook-1"),
  node(ComponentID.IfElse, "if-else-1"),
  node(ComponentID.ApiPost, "api-post-1"),
  node(ComponentID.Log, "log-1"),
  node(ComponentID.SlackSendMessageToChannel, "slack-1"),
  node(ComponentID.ApiGet, "api-get-after"),
  node(ComponentID.ApiGet, "api-get-loose"),
];

const EDGES: Array<StepGraphEdge> = [
  edge("webhook-1", "out", "if-else-1"),
  edge("if-else-1", "yes", "api-post-1"),
  edge("if-else-1", "no", "log-1"),
  edge("api-post-1", "success", "slack-1"),
  edge("log-1", "out", "slack-1"),
  edge("slack-1", "success", "api-get-after"),
];

describe("a step after a branch that joins again", () => {
  const sources: StepValueSources = sourcesOf(NODES, EDGES, "slack-1");

  test("reads every step before it, in run order", () => {
    expect(ids(sources.upstream)).toEqual([
      "webhook-1",
      "if-else-1",
      "api-post-1",
      "log-1",
    ]);
  });

  test("knows which of them run on some runs only, and which output decides", () => {
    expect(Object.keys(sources.sometimes || {}).sort()).toEqual([
      "api-post-1",
      "log-1",
    ]);
    expect(sources.sometimes?.["api-post-1"]?.branchStep.id).toBe("if-else-1");
    expect(sources.sometimes?.["api-post-1"]?.portTitle).toBe("Yes");
    expect(sources.sometimes?.["log-1"]?.portTitle).toBe("No");
  });

  test("the trigger and the If / Else run on every run, so they are not among them", () => {
    expect(sources.sometimes?.["webhook-1"]).toBeUndefined();
    expect(sources.sometimes?.["if-else-1"]).toBeUndefined();
  });

  test("says why every other step's values are not there", () => {
    expect(unavailableOf(sources)).toEqual([
      ["api-get-after", UnavailableReason.RunsAfter],
      ["api-get-loose", UnavailableReason.NeverRuns],
    ]);
  });
});

describe("a step on one branch", () => {
  const sources: StepValueSources = sourcesOf(NODES, EDGES, "api-post-1");

  test("reads the steps before it, on every run", () => {
    expect(ids(sources.upstream)).toEqual(["webhook-1", "if-else-1"]);
    expect(sources.sometimes).toEqual({});
  });

  test("the other branch is not on its path, and what comes after runs after it", () => {
    expect(unavailableOf(sources)).toEqual([
      ["log-1", UnavailableReason.NotOnPath],
      ["slack-1", UnavailableReason.RunsAfter],
      ["api-get-after", UnavailableReason.RunsAfter],
      ["api-get-loose", UnavailableReason.NeverRuns],
    ]);
  });
});

describe("an API call's Error output", () => {
  test("a step reached by Success and by Error reads the steps on one of them as sometimes", () => {
    const nodes: Array<StepGraphNode> = [
      node(ComponentID.Manual, "manual-1"),
      node(ComponentID.ApiGet, "api-get-1"),
      node(ComponentID.ApiPost, "api-post-1"),
      node(ComponentID.Log, "log-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("manual-1", "success", "api-get-1"),
      edge("api-get-1", "success", "api-post-1"),
      edge("api-post-1", "success", "log-1"),
      edge("api-get-1", "error", "log-1"),
    ];

    const sources: StepValueSources = sourcesOf(nodes, edges, "log-1");

    expect(ids(sources.upstream)).toEqual([
      "manual-1",
      "api-get-1",
      "api-post-1",
    ]);
    expect(sources.sometimes?.["api-post-1"]).toEqual({
      branchStep: nodes[1]!.data,
      portTitle: "Success",
    });
    expect(sources.sometimes?.["api-get-1"]).toBeUndefined();
  });
});

describe("a Switch / Case", () => {
  const switchNode: StepGraphNode = node(ComponentID.Switch, "switch-1", {
    cases: toStoredSwitchCases(getStarterSwitchCases()),
  });

  test("a step after one case runs only when the run takes that case", () => {
    const nodes: Array<StepGraphNode> = [
      node(ComponentID.Manual, "manual-1"),
      switchNode,
      node(ComponentID.ApiPost, "api-post-1"),
      node(ComponentID.Log, "log-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("manual-1", "success", "switch-1"),
      edge("switch-1", "case-1", "api-post-1"),
      edge("api-post-1", "success", "log-1"),
      edge("switch-1", "default", "log-1"),
    ];

    const sources: StepValueSources = sourcesOf(nodes, edges, "log-1");

    expect(sources.sometimes?.["api-post-1"]?.branchStep.id).toBe("switch-1");
    expect(sources.sometimes?.["api-post-1"]?.portTitle).toBe("Case 1");
  });

  test("a connection from a case that was taken out carries no run", () => {
    const nodes: Array<StepGraphNode> = [
      node(ComponentID.Manual, "manual-1"),
      switchNode,
      node(ComponentID.ApiPost, "api-post-1"),
      node(ComponentID.Log, "log-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("manual-1", "success", "switch-1"),
      // The step has case-1 and case-2: case-9 is gone.
      edge("switch-1", "case-9", "api-post-1"),
      edge("api-post-1", "success", "log-1"),
    ];

    const sources: StepValueSources = sourcesOf(nodes, edges, "log-1");

    // The HTTP POST is never reached, so Log is not either.
    expect(ids(sources.upstream)).toEqual(["manual-1", "api-post-1"]);
    expect(sources.hasIncomingConnection).toBe(true);

    const post: StepValueSources = sourcesOf(nodes, edges, "api-post-1");

    expect(post.hasIncomingConnection).toBe(false);
    expect(unavailableOf(post)).toEqual([
      ["switch-1", UnavailableReason.NotOnPath],
      ["log-1", UnavailableReason.RunsAfter],
    ]);
  });

  test("a connection that does not say which output it leaves from still counts", () => {
    const nodes: Array<StepGraphNode> = [
      node(ComponentID.Manual, "manual-1"),
      node(ComponentID.ApiPost, "api-post-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      { source: "rf-manual-1", target: "rf-api-post-1" },
    ];

    expect(ids(sourcesOf(nodes, edges, "api-post-1").upstream)).toEqual([
      "manual-1",
    ]);
  });
});

describe("steps nothing runs", () => {
  test("a chain the trigger does not reach is never read by a step it does", () => {
    const nodes: Array<StepGraphNode> = [
      node(ComponentID.Manual, "manual-1"),
      node(ComponentID.ApiGet, "api-get-loose"),
      node(ComponentID.Log, "log-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("manual-1", "success", "log-1"),
      // A step nothing starts, feeding into Log.
      edge("api-get-loose", "success", "log-1"),
    ];

    const sources: StepValueSources = sourcesOf(nodes, edges, "log-1");

    expect(ids(sources.upstream)).toEqual(["manual-1"]);
    expect(unavailableOf(sources)).toEqual([
      ["api-get-loose", UnavailableReason.NeverRuns],
    ]);
  });

  test("while a step is itself still being wired up, the chain into it is offered", () => {
    const nodes: Array<StepGraphNode> = [
      node(ComponentID.Manual, "manual-1"),
      node(ComponentID.ApiGet, "api-get-1"),
      node(ComponentID.Log, "log-1"),
    ];
    const edges: Array<StepGraphEdge> = [
      edge("api-get-1", "success", "log-1"),
    ];

    const sources: StepValueSources = sourcesOf(nodes, edges, "log-1");

    expect(ids(sources.upstream)).toEqual(["manual-1", "api-get-1"]);
    // Nothing can be said about every run of a step no run reaches.
    expect(sources.sometimes).toEqual({});
  });

  test("a trigger reads nothing, and everything else runs after it or off its path", () => {
    const sources: StepValueSources = sourcesOf(NODES, EDGES, "webhook-1");

    expect(sources.upstream).toEqual([]);
    expect(unavailableOf(sources)).toEqual([
      ["if-else-1", UnavailableReason.RunsAfter],
      ["api-post-1", UnavailableReason.RunsAfter],
      ["log-1", UnavailableReason.RunsAfter],
      ["slack-1", UnavailableReason.RunsAfter],
      ["api-get-after", UnavailableReason.RunsAfter],
      ["api-get-loose", UnavailableReason.NeverRuns],
    ]);
  });
});
