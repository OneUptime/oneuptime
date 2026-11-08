import { describe, expect, test } from "@jest/globals";
import ComponentMetadata, { NodeType } from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components from "../../../Types/Workflow/Components";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  WorkflowDraft,
  WorkflowDraftConnection,
  WorkflowDraftStep,
  buildGraphFromDraft,
  getDraftFromGraph,
  getDraftValueKey,
} from "../../../Types/Workflow/WorkflowDraft";
import {
  WorkflowPartSeen,
  WorkflowPartsSeen,
  WorkflowStepsUndone,
  findWorkflowStepsUndoneUnseen,
  getWorkflowConnectionPartId,
  getWorkflowStepPartId,
  seeWorkflowParts,
  seeWorkflowPartsSaved,
} from "../../../Types/Workflow/WorkflowDraftSeen";
import { getStepsTouchedByDraft } from "../../../Types/Workflow/WorkflowDraftRebase";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import crypto from "crypto";

/*
 * ISSUE #6291: WHAT AN ASK AI CHANGE WOULD UNDO THAT ASK AI NEVER SAW.
 *
 * Ask AI writes a change as a whole draft of a workflow's steps, from what
 * it last saw of them. Saved after that, a teammate's step is taken out
 * again by the draft, and the person's setting put back as it was. A part
 * of the workflow - a step by what it is, or a connection - is undone when
 * it was saved since Ask AI saw it and the change makes it something else
 * again. A moved card, a setting changed on a step the change keeps, or a
 * step added after one the person changed, undo nothing.
 */

const COMPONENTS: Map<string, ComponentMetadata> = new Map<
  string,
  ComponentMetadata
>(
  (Components as Array<ComponentMetadata>).map(
    (component: ComponentMetadata): [string, ComponentMetadata] => {
      return [component.id, component];
    },
  ),
);

const getComponent: (id: string) => ComponentMetadata | undefined = (
  id: string,
): ComponentMetadata | undefined => {
  return COMPONENTS.get(id);
};

let nextId: number = 0;

const generateId: () => string = (): string => {
  nextId++;
  return `node-${nextId}`;
};

// Keyed as the server's is: nothing of a step's text can be read from it.
const digest: (text: string) => string = (text: string): string => {
  return crypto
    .createHmac("sha256", "test key")
    .update(text)
    .digest("hex")
    .slice(0, 16);
};

const graphOf: (draft: WorkflowDraft, existing?: JSONObject) => JSONObject = (
  draft: WorkflowDraft,
  existing?: JSONObject,
): JSONObject => {
  return buildGraphFromDraft({
    draft: draft,
    getComponent: getComponent,
    generateId: generateId,
    existingGraph: existing,
  });
};

const copyOf: (graph: JSONObject) => JSONObject = (
  graph: JSONObject,
): JSONObject => {
  return JSON.parse(JSON.stringify(graph)) as JSONObject;
};

const readBack: (graph: JSONObject) => WorkflowDraft = (
  graph: JSONObject,
): WorkflowDraft => {
  return getDraftFromGraph({ graph: graph, getComponent: getComponent });
};

interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: { id: string; metadataId: string; arguments: JSONObject; nodeType: string };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}

const nodesOf: (graph: JSONObject) => Array<GraphNode> = (
  graph: JSONObject,
): Array<GraphNode> => {
  return graph["nodes"] as unknown as Array<GraphNode>;
};

const edgesOf: (graph: JSONObject) => Array<GraphEdge> = (
  graph: JSONObject,
): Array<GraphEdge> => {
  return graph["edges"] as unknown as Array<GraphEdge>;
};

const nodeOf: (graph: JSONObject, stepId: string) => GraphNode = (
  graph: JSONObject,
  stepId: string,
): GraphNode => {
  return nodesOf(graph).find((node: GraphNode): boolean => {
    return node.data.id === stepId;
  })!;
};

// Saves made in the Builder, after Ask AI saw the workflow.
const theirs: {
  move: (graph: JSONObject, stepId: string) => void;
  setValue: (graph: JSONObject, stepId: string, value: string) => void;
  addAfter: (data: {
    graph: JSONObject;
    after: string;
    stepId: string;
    componentId?: string;
    arguments?: JSONObject;
  }) => void;
  remove: (graph: JSONObject, stepId: string) => void;
  connect: (graph: JSONObject, from: string, to: string) => void;
  disconnect: (graph: JSONObject, from: string, to: string) => void;
} = {
  move: (graph: JSONObject, stepId: string): void => {
    const node: GraphNode = nodeOf(graph, stepId);
    node.position = { x: node.position.x + 77, y: node.position.y + 13 };
  },
  setValue: (graph: JSONObject, stepId: string, value: string): void => {
    nodeOf(graph, stepId).data.arguments = { value: value };
  },
  addAfter: (data: {
    graph: JSONObject;
    after: string;
    stepId: string;
    componentId?: string;
    arguments?: JSONObject;
  }): void => {
    nodesOf(data.graph).push({
      id: `canvas-${data.stepId}`,
      position: { x: 900, y: 900 },
      data: {
        id: data.stepId,
        metadataId: data.componentId || ComponentID.Log,
        arguments: data.arguments || { value: data.stepId },
        nodeType: NodeType.Node,
      },
    });
    edgesOf(data.graph).push({
      id: `edge-${data.stepId}`,
      source: nodeOf(data.graph, data.after).id,
      target: `canvas-${data.stepId}`,
      sourceHandle: "out",
      targetHandle: "in",
    });
  },
  remove: (graph: JSONObject, stepId: string): void => {
    const node: GraphNode = nodeOf(graph, stepId);
    graph["nodes"] = nodesOf(graph).filter((each: GraphNode): boolean => {
      return each !== node;
    }) as unknown as JSONValue;
    graph["edges"] = edgesOf(graph).filter((edge: GraphEdge): boolean => {
      return edge.source !== node.id && edge.target !== node.id;
    }) as unknown as JSONValue;
  },
  connect: (graph: JSONObject, from: string, to: string): void => {
    edgesOf(graph).push({
      id: `edge-${from}-${to}`,
      source: nodeOf(graph, from).id,
      target: nodeOf(graph, to).id,
      sourceHandle: "out",
      targetHandle: "in",
    });
  },
  disconnect: (graph: JSONObject, from: string, to: string): void => {
    const source: string = nodeOf(graph, from).id;
    const target: string = nodeOf(graph, to).id;
    graph["edges"] = edgesOf(graph).filter((edge: GraphEdge): boolean => {
      return !(edge.source === source && edge.target === target);
    }) as unknown as JSONValue;
  },
};

const seenOf: (graph: JSONObject) => Map<string, string | null> = (
  graph: JSONObject,
): Map<string, string | null> => {
  return new Map<string, string | null>(
    seeWorkflowParts({ graph: graph, digest: digest }).map(
      (part: WorkflowPartSeen): [string, string | null] => {
        return [part.id, part.fingerprint];
      },
    ),
  );
};

const undoneOf: (data: {
  seen: WorkflowPartsSeen;
  graph: JSONObject;
  draft: WorkflowDraft;
}) => WorkflowStepsUndone = (data: {
  seen: WorkflowPartsSeen;
  graph: JSONObject;
  draft: WorkflowDraft;
}): WorkflowStepsUndone => {
  return findWorkflowStepsUndoneUnseen({
    seen: data.seen,
    graph: data.graph,
    changed: graphOf(data.draft, data.graph),
    digest: digest,
  });
};

// The workflow Ask AI read: a manual trigger leading to a Log, and to another.
const READ_DRAFT: WorkflowDraft = {
  steps: [
    { id: "manual-1", componentId: ComponentID.Manual },
    { id: "log-a", componentId: ComponentID.Log, arguments: { value: "a" } },
    { id: "log-d", componentId: ComponentID.Log, arguments: { value: "d" } },
  ],
  connections: [
    { from: "manual-1", to: "log-a" },
    { from: "manual-1", to: "log-d" },
  ],
};

// Ask AI's change, written from what it read: a Log after Log a.
const addLogB: (read: WorkflowDraft) => WorkflowDraft = (
  read: WorkflowDraft,
): WorkflowDraft => {
  return {
    steps: [
      ...read.steps,
      { id: "log-b", componentId: ComponentID.Log, arguments: { value: "b" } },
    ],
    connections: [...read.connections, { from: "log-a", to: "log-b" }],
  };
};

const NOTHING: WorkflowStepsUndone = { partIds: [], namedStepIds: [] };

describe("what Ask AI is shown of a workflow", () => {
  test("every step, then every connection, each once, in the graph's order", () => {
    const graph: JSONObject = graphOf(READ_DRAFT);
    const parts: Array<WorkflowPartSeen> = seeWorkflowParts({
      graph,
      digest,
    });

    expect(
      parts.map((part: WorkflowPartSeen): string => {
        return part.id;
      }),
    ).toEqual([
      getWorkflowStepPartId("manual-1"),
      getWorkflowStepPartId("log-a"),
      getWorkflowStepPartId("log-d"),
      getWorkflowConnectionPartId({
        from: "manual-1",
        fromOutput: "success",
        to: "log-a",
      }),
      getWorkflowConnectionPartId({
        from: "manual-1",
        fromOutput: "success",
        to: "log-d",
      }),
    ]);
    for (const part of parts) {
      expect(typeof part.fingerprint).toBe("string");
    }
  });

  test("where a card sits is no part of it", () => {
    const graph: JSONObject = graphOf(READ_DRAFT);
    const moved: JSONObject = copyOf(graph);
    theirs.move(moved, "log-a");
    theirs.move(moved, "manual-1");

    expect(seeWorkflowParts({ graph: moved, digest })).toEqual(
      seeWorkflowParts({ graph, digest }),
    );
  });

  test("a step's settings are in its fingerprint, keyed: nothing of a secret can be read from the record", () => {
    const secret: string = "https://hooks.slack.com/services/T000/B000/s3cret-token";
    const graph: JSONObject = graphOf({
      steps: [
        ...READ_DRAFT.steps,
        {
          id: "slack-1",
          componentId: ComponentID.SlackSendMessageToChannel,
          arguments: { "webhook-url": secret, text: "hi" },
        },
      ],
      connections: [...READ_DRAFT.connections, { from: "log-d", to: "slack-1" }],
    });
    const parts: string = JSON.stringify(seeWorkflowParts({ graph, digest }));

    expect(parts).not.toContain("s3cret");
    expect(parts).not.toContain("hooks.slack.com");

    const other: JSONObject = copyOf(graph);
    nodeOf(other, "slack-1").data.arguments = {
      "webhook-url": "https://hooks.slack.com/services/another",
      text: "hi",
    };
    expect(seenOf(other).get(getWorkflowStepPartId("slack-1"))).not.toBe(
      seenOf(graph).get(getWorkflowStepPartId("slack-1")),
    );
  });

  test("the slot a trigger goes in is no step, and a graph with nothing has no parts", () => {
    const graph: JSONObject = graphOf(READ_DRAFT);
    nodesOf(graph).push({
      id: "placeholder",
      position: { x: 0, y: 0 },
      data: {
        id: "trigger-slot",
        metadataId: "",
        arguments: {},
        nodeType: NodeType.PlaceholderNode,
      },
    });

    expect(seeWorkflowParts({ graph, digest }).map((part: WorkflowPartSeen) => part.id)).not.toContain(
      getWorkflowStepPartId("trigger-slot"),
    );
    expect(seeWorkflowParts({ graph: undefined, digest })).toEqual([]);
    expect(seeWorkflowParts({ graph: { nodes: "x" } as never, digest })).toEqual([]);
  });

  test("a setting left unset is the same as one never written", () => {
    const set: JSONObject = graphOf(READ_DRAFT);
    const unset: JSONObject = copyOf(set);
    nodeOf(unset, "log-a").data.arguments = { value: "a", note: "" } as never;

    expect(seenOf(unset)).toEqual(seenOf(set));
  });
});

describe("what a change would undo that Ask AI never saw", () => {
  test("nobody saved since: nothing, whatever the change does", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const drafts: Array<WorkflowDraft> = [
      addLogB(readBack(read)),
      { ...readBack(read), steps: readBack(read).steps.slice(0, 2), connections: readBack(read).connections.slice(0, 1) },
      {
        ...readBack(read),
        steps: readBack(read).steps.map((step: WorkflowDraftStep) => {
          return step.id === "log-d" ? { ...step, arguments: { value: "Ask AI's" } } : step;
        }),
      },
    ];

    for (const draft of drafts) {
      expect(undoneOf({ seen: seenOf(read), graph: read, draft })).toEqual(NOTHING);
    }
  });

  test("only cards moved since: nothing", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.move(now, "log-a");
    theirs.move(now, "log-d");

    expect(
      undoneOf({ seen: seenOf(read), graph: now, draft: addLogB(readBack(read)) }),
    ).toEqual(NOTHING);
  });

  test("a step added in the Builder since: the change takes it out again, and names it", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.addAfter({
      graph: now,
      after: "log-d",
      stepId: "slack-1",
      componentId: ComponentID.SlackSendMessageToChannel,
      arguments: { text: "deployed" },
    });

    const undone: WorkflowStepsUndone = undoneOf({
      seen: seenOf(read),
      graph: now,
      draft: addLogB(readBack(read)),
    });

    expect(undone.namedStepIds).toEqual(["slack-1"]);
    expect(undone.partIds).toEqual([
      getWorkflowStepPartId("slack-1"),
      getWorkflowConnectionPartId({ from: "log-d", fromOutput: "out", to: "slack-1" }),
    ]);
  });

  test("a setting changed since, on a step the change keeps as it is: nothing", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.setValue(now, "log-d", "theirs");

    // The model leaves out the settings of a step it does not change.
    const draft: WorkflowDraft = addLogB(readBack(read));
    draft.steps = draft.steps.map((step: WorkflowDraftStep) => {
      return step.id === "log-d" ? { id: step.id, componentId: step.componentId } : step;
    });

    expect(undoneOf({ seen: seenOf(read), graph: now, draft })).toEqual(NOTHING);
  });

  test("a setting changed since, and the change adds a step after that same step: still nothing", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.setValue(now, "log-d", "theirs");

    const draft: WorkflowDraft = readBack(read);
    draft.steps = [
      ...draft.steps.map((step: WorkflowDraftStep) => {
        return step.id === "log-d" ? { id: step.id, componentId: step.componentId } : step;
      }),
      { id: "log-e", componentId: ComponentID.Log, arguments: { value: "e" } },
    ];
    draft.connections = [...draft.connections, { from: "log-d", to: "log-e" }];

    expect(undoneOf({ seen: seenOf(read), graph: now, draft })).toEqual(NOTHING);
  });

  test("a setting changed since, and the change writes the step back as Ask AI read it: undone", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.setValue(now, "log-d", "theirs");

    expect(
      undoneOf({ seen: seenOf(read), graph: now, draft: addLogB(readBack(read)) }),
    ).toEqual({ partIds: [getWorkflowStepPartId("log-d")], namedStepIds: ["log-d"] });
  });

  test("a setting changed since, and the change gives the step a value of its own: undone too", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.setValue(now, "log-a", "theirs");

    const draft: WorkflowDraft = readBack(read);
    draft.steps = draft.steps.map((step: WorkflowDraftStep) => {
      return step.id === "log-a" ? { ...step, arguments: { value: "Ask AI's" } } : step;
    });

    expect(undoneOf({ seen: seenOf(read), graph: now, draft }).namedStepIds).toEqual(["log-a"]);
  });

  test("a step taken out since, which the change puts back: undone", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.remove(now, "log-d");

    const undone: WorkflowStepsUndone = undoneOf({
      seen: seenOf(read),
      graph: now,
      draft: addLogB(readBack(read)),
    });

    expect(undone.namedStepIds).toEqual(["log-d"]);
    expect(undone.partIds).toContain(
      getWorkflowConnectionPartId({ from: "manual-1", fromOutput: "success", to: "log-d" }),
    );
  });

  test("a step taken out since, which the change takes out too: nothing", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.remove(now, "log-d");

    const draft: WorkflowDraft = readBack(read);
    draft.steps = draft.steps.filter((step: WorkflowDraftStep) => step.id !== "log-d");
    draft.connections = draft.connections.filter(
      (connection: WorkflowDraftConnection) => connection.to !== "log-d",
    );

    expect(undoneOf({ seen: seenOf(read), graph: now, draft })).toEqual(NOTHING);
  });

  test("a connection made since between steps Ask AI saw: the change takes it out, and names the steps it joined", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.connect(now, "log-a", "log-d");

    const undone: WorkflowStepsUndone = undoneOf({
      seen: seenOf(read),
      graph: now,
      draft: addLogB(readBack(read)),
    });

    expect(undone.partIds).toEqual([
      getWorkflowConnectionPartId({ from: "log-a", fromOutput: "out", to: "log-d" }),
    ]);
    expect(undone.namedStepIds).toEqual(["log-a", "log-d"]);
  });

  test("a connection taken out since, which the change puts back: undone", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const now: JSONObject = copyOf(read);
    theirs.disconnect(now, "manual-1", "log-d");

    const undone: WorkflowStepsUndone = undoneOf({
      seen: seenOf(read),
      graph: now,
      draft: addLogB(readBack(read)),
    });

    expect(undone.namedStepIds).toEqual(["manual-1", "log-d"]);
  });

  test("steps Ask AI saw that are gone, and that the change does not bring back, play no part", () => {
    const read: JSONObject = graphOf(READ_DRAFT);
    const seen: Map<string, string | null> = seenOf(read);
    seen.set(getWorkflowStepPartId("long-gone"), "f00");

    expect(undoneOf({ seen, graph: read, draft: addLogB(readBack(read)) })).toEqual(NOTHING);
  });

  test("never seen: what the change takes out or makes something else - never what it only adds", () => {
    const now: JSONObject = graphOf(READ_DRAFT);

    // Adds a step after Log a: that is all.
    expect(undoneOf({ seen: null, graph: now, draft: addLogB(readBack(now)) })).toEqual(NOTHING);

    // Takes out Log d, and changes Log a.
    const draft: WorkflowDraft = readBack(now);
    draft.steps = draft.steps
      .filter((step: WorkflowDraftStep) => step.id !== "log-d")
      .map((step: WorkflowDraftStep) => {
        return step.id === "log-a" ? { ...step, arguments: { value: "changed" } } : step;
      });
    draft.connections = draft.connections.filter(
      (connection: WorkflowDraftConnection) => connection.to !== "log-d",
    );

    expect(undoneOf({ seen: null, graph: now, draft }).namedStepIds).toEqual(["log-a", "log-d"]);

    // A draft of steps it made up: every step the workflow has goes.
    expect(
      undoneOf({
        seen: null,
        graph: now,
        draft: {
          steps: [{ id: "trigger", componentId: ComponentID.Manual }],
          connections: [],
        },
      }).namedStepIds,
    ).toEqual(["manual-1", "log-a", "log-d"]);
  });
});

describe("what Ask AI sees of a change it saved itself", () => {
  test("the steps it touches as saved, and every connection to or from them, there or gone; nothing else", () => {
    const replaced: JSONObject = graphOf(READ_DRAFT);
    // Someone else's step, kept by the save: Ask AI never saw it.
    theirs.addAfter({ graph: replaced, after: "log-d", stepId: "log-x" });

    const draft: WorkflowDraft = {
      steps: [
        ...readBack(replaced).steps.filter((step: WorkflowDraftStep) => step.id !== "log-a"),
        { id: "log-b", componentId: ComponentID.Log, arguments: { value: "b" } },
      ],
      connections: [
        ...readBack(replaced).connections.filter(
          (connection: WorkflowDraftConnection) => connection.to !== "log-a",
        ),
        { from: "manual-1", to: "log-b" },
      ],
    };
    const saved: JSONObject = graphOf(draft, replaced);
    const touched: Array<string> = getStepsTouchedByDraft({
      draft,
      graph: replaced,
      getComponent,
      generateId,
    });

    expect(touched).toEqual(["log-a", "log-b", "manual-1"]);

    const parts: Map<string, string | null> = new Map<string, string | null>(
      seeWorkflowPartsSaved({ stepIds: touched, replaced, saved, digest }).map(
        (part: WorkflowPartSeen): [string, string | null] => [part.id, part.fingerprint],
      ),
    );
    const savedSeen: Map<string, string | null> = seenOf(saved);

    expect(parts.get(getWorkflowStepPartId("log-a"))).toBeNull();
    expect(parts.get(getWorkflowStepPartId("log-b"))).toBe(
      savedSeen.get(getWorkflowStepPartId("log-b")),
    );
    expect(
      parts.get(getWorkflowConnectionPartId({ from: "manual-1", fromOutput: "success", to: "log-a" })),
    ).toBeNull();
    expect(
      parts.get(getWorkflowConnectionPartId({ from: "manual-1", fromOutput: "success", to: "log-b" })),
    ).toBe("connected");
    // What the save kept of someone else's is not what Ask AI saw.
    expect(parts.has(getWorkflowStepPartId("log-x"))).toBe(false);
    expect(parts.has(getWorkflowStepPartId("log-d"))).toBe(false);
    expect(
      parts.has(getWorkflowConnectionPartId({ from: "log-d", fromOutput: "out", to: "log-x" })),
    ).toBe(false);
  });
});

/*
 * ---------------------------------------------------------------------------
 * At random, against an oracle that reads graphs its own way: a step's state
 * is its component and settings as written, a connection's that it is there,
 * and a part is undone when the change leaves it otherwise than it is now,
 * and it is now otherwise than Ask AI saw it.
 * ---------------------------------------------------------------------------
 */

type State = string | null;

const UNSEEN: string = "\u0000never seen";

const stepStateOf: (graph: JSONObject | null, stepId: string) => State = (
  graph: JSONObject | null,
  stepId: string,
): State => {
  const nodes: Array<GraphNode> = (graph ? nodesOf(graph) : []).filter((node: GraphNode) => {
    return node.data.id === stepId && node.data.nodeType !== NodeType.PlaceholderNode;
  });

  if (nodes.length === 0) {
    return null;
  }

  return JSON.stringify(
    nodes.map((node: GraphNode) => {
      const settings: JSONObject = {};
      for (const [key, value] of Object.entries(node.data.arguments || {})) {
        if (value !== "" && value !== null && value !== undefined) {
          settings[key] = value as JSONValue;
        }
      }
      return [node.data.metadataId, getDraftValueKey(settings)];
    }),
  );
};

const edgeKeysOf: (graph: JSONObject | null) => Array<string> = (
  graph: JSONObject | null,
): Array<string> => {
  if (!graph) {
    return [];
  }

  const stepOfNode: Map<string, string> = new Map<string, string>(
    nodesOf(graph)
      .filter((node: GraphNode) => node.data.nodeType !== NodeType.PlaceholderNode)
      .map((node: GraphNode): [string, string] => [node.id, node.data.id]),
  );
  const keys: Array<string> = [];

  for (const edge of edgesOf(graph)) {
    const from: string | undefined = stepOfNode.get(edge.source);
    const to: string | undefined = stepOfNode.get(edge.target);
    const key: string = JSON.stringify([from, edge.sourceHandle || "", to]);

    if (from && to && !keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys;
};

const stepIdsOfGraph: (graph: JSONObject) => Array<string> = (
  graph: JSONObject,
): Array<string> => {
  return Array.from(
    new Set<string>(
      nodesOf(graph)
        .filter((node: GraphNode) => node.data.nodeType !== NodeType.PlaceholderNode)
        .map((node: GraphNode) => node.data.id),
    ),
  );
};

const oracle: (data: {
  seen: JSONObject | null;
  now: JSONObject;
  after: JSONObject;
}) => { steps: Array<string>; edges: Array<string>; named: Array<string> } = (data: {
  seen: JSONObject | null;
  now: JSONObject;
  after: JSONObject;
}): { steps: Array<string>; edges: Array<string>; named: Array<string> } => {
  const isUndone: (seen: State, now: State, after: State) => boolean = (
    seen: State,
    now: State,
    after: State,
  ): boolean => {
    if (after === now) {
      return false;
    }
    return seen === UNSEEN ? now !== null : seen !== now;
  };

  // In the order the workflow has them now, then the order of the change.
  const order: Array<{ kind: "step" | "edge"; key: string }> = [];
  const listed: Set<string> = new Set<string>();
  const list: (kind: "step" | "edge", key: string) => void = (
    kind: "step" | "edge",
    key: string,
  ): void => {
    if (!listed.has(`${kind}${key}`)) {
      listed.add(`${kind}${key}`);
      order.push({ kind, key });
    }
  };

  for (const graph of [data.now, data.after]) {
    stepIdsOfGraph(graph).forEach((id: string) => list("step", id));
    edgeKeysOf(graph).forEach((key: string) => list("edge", key));
  }

  const steps: Array<string> = [];
  const edges: Array<string> = [];

  for (const part of order) {
    if (part.kind === "step") {
      const seen: State = data.seen ? stepStateOf(data.seen, part.key) : UNSEEN;
      if (
        isUndone(seen, stepStateOf(data.now, part.key), stepStateOf(data.after, part.key))
      ) {
        steps.push(part.key);
      }
    } else {
      const there: (graph: JSONObject | null) => State = (graph: JSONObject | null): State => {
        return edgeKeysOf(graph).includes(part.key) ? "there" : null;
      };
      const seen: State = data.seen ? there(data.seen) : UNSEEN;
      if (isUndone(seen, there(data.now), there(data.after))) {
        edges.push(part.key);
      }
    }
  }

  const joined: Array<string> = [];
  for (const part of order) {
    const isStep: boolean = part.kind === "step" && steps.includes(part.key);
    const isEdge: boolean = part.kind === "edge" && edges.includes(part.key);
    const ends: Array<string> = isStep
      ? [part.key]
      : isEdge
        ? [JSON.parse(part.key)[0] as string, JSON.parse(part.key)[2] as string]
        : [];
    for (const end of ends) {
      if (!joined.includes(end)) {
        joined.push(end);
      }
    }
  }

  return { steps, edges, named: steps.length > 0 ? steps : joined };
};

describe("at random, against an oracle", () => {
  test("what is undone is what the oracle says, and nothing when nobody saved since or only cards moved", () => {
    const random: SeededRandom = seededRandom(6291);
    const counts: { [outcome: string]: number } = {
      nothingSavedSince: 0,
      onlyMoved: 0,
      savedButKept: 0,
      undoneSteps: 0,
      undoneConnectionsOnly: 0,
      neverSeen: 0,
    };

    for (let round: number = 0; round < 400; round++) {
      nextId = 0;

      // A trigger, and two to five Logs, each after one before it.
      const draft: WorkflowDraft = {
        steps: [{ id: "manual-1", componentId: ComponentID.Manual }],
        connections: [],
      };
      const logs: number = 2 + random(4);
      for (let index: number = 0; index < logs; index++) {
        const parent: string = draft.steps[random(draft.steps.length)]!.id;
        draft.steps.push({
          id: `log-${index}`,
          componentId: ComponentID.Log,
          arguments: { value: `v${random(3)}` },
        });
        draft.connections.push({ from: parent, to: `log-${index}` });
      }

      const read: JSONObject = graphOf(draft);
      const now: JSONObject = copyOf(read);
      const isNeverSeen: boolean = random(6) === 0;

      // Saves in the Builder after Ask AI read it.
      const saves: number = random(4);
      let onlyMoves: boolean = true;
      for (let save: number = 0; save < saves; save++) {
        const ids: Array<string> = stepIdsOfGraph(now);
        const logIds: Array<string> = ids.filter((id: string) => id.startsWith("log"));
        const kind: number = random(6);

        if (kind === 0 || logIds.length === 0) {
          theirs.move(now, ids[random(ids.length)]!);
          continue;
        }

        onlyMoves = false;

        if (kind === 1) {
          theirs.addAfter({
            graph: now,
            after: ids[random(ids.length)]!,
            stepId: `log-theirs-${round}-${save}`,
          });
        } else if (kind === 2) {
          theirs.setValue(now, logIds[random(logIds.length)]!, `theirs-${save}`);
        } else if (kind === 3) {
          theirs.remove(now, logIds[random(logIds.length)]!);
        } else if (kind === 4) {
          const from: string = ids[random(ids.length)]!;
          const to: string = logIds[random(logIds.length)]!;
          if (from !== to) {
            theirs.connect(now, from, to);
          }
        } else {
          const edges: Array<string> = edgeKeysOf(now);
          if (edges.length > 0) {
            const [from, , to] = JSON.parse(edges[random(edges.length)]!) as Array<string>;
            theirs.disconnect(now, from!, to!);
          }
        }
      }

      // Ask AI's change, from what it read: most steps' settings left out.
      const askAi: WorkflowDraft = readBack(read);
      askAi.steps = askAi.steps.map((step: WorkflowDraftStep) => {
        return random(3) === 0 ? step : { id: step.id, componentId: step.componentId };
      });
      const readLogs: Array<string> = askAi.steps
        .filter((step: WorkflowDraftStep) => step.componentId === ComponentID.Log)
        .map((step: WorkflowDraftStep) => step.id);
      const change: number = random(4);

      if (change === 0) {
        askAi.steps.push({ id: "log-ai", componentId: ComponentID.Log, arguments: { value: "ai" } });
        askAi.connections.push({ from: askAi.steps[random(askAi.steps.length - 1)]!.id, to: "log-ai" });
      } else if (change === 1) {
        const target: string = readLogs[random(readLogs.length)]!;
        askAi.steps = askAi.steps.map((step: WorkflowDraftStep) => {
          return step.id === target ? { ...step, arguments: { value: "ai's" } } : step;
        });
      } else if (change === 2) {
        const target: string = readLogs[random(readLogs.length)]!;
        askAi.steps = askAi.steps.filter((step: WorkflowDraftStep) => step.id !== target);
        askAi.connections = askAi.connections.filter(
          (connection: WorkflowDraftConnection) =>
            connection.from !== target && connection.to !== target,
        );
      }

      const after: JSONObject = graphOf(askAi, now);
      const undone: WorkflowStepsUndone = findWorkflowStepsUndoneUnseen({
        seen: isNeverSeen ? null : seenOf(read),
        graph: now,
        changed: after,
        digest,
      });
      const expected: { steps: Array<string>; edges: Array<string>; named: Array<string> } =
        oracle({ seen: isNeverSeen ? null : read, now, after });

      expect({ round, named: undone.namedStepIds }).toEqual({ round, named: expected.named });
      expect({ round, parts: undone.partIds.length }).toEqual({
        round,
        parts: expected.steps.length + expected.edges.length,
      });
      expect(undone.partIds.length > 0).toBe(undone.namedStepIds.length > 0);

      if (isNeverSeen) {
        counts["neverSeen"]!++;
        continue;
      }

      if (saves === 0) {
        expect({ round, undone }).toEqual({ round, undone: NOTHING });
        counts["nothingSavedSince"]!++;
      } else if (onlyMoves) {
        expect({ round, undone }).toEqual({ round, undone: NOTHING });
        counts["onlyMoved"]!++;
      } else if (undone.partIds.length === 0) {
        counts["savedButKept"]!++;
      } else if (expected.steps.length > 0) {
        counts["undoneSteps"]!++;
      } else {
        counts["undoneConnectionsOnly"]!++;
      }
    }

    for (const outcome of Object.keys(counts)) {
      expect({ outcome, enough: counts[outcome]! > 10 }).toEqual({ outcome, enough: true });
    }
  });
});
