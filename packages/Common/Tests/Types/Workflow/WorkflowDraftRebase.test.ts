import { JSONObject } from "../../../Types/JSON";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeType,
} from "../../../Types/Workflow/Component";
import {
  WorkflowDraft,
  WorkflowDraftConnection,
  WorkflowDraftStep,
  buildGraphFromDraft,
  getDraftFromGraph,
} from "../../../Types/Workflow/WorkflowDraft";
import {
  WorkflowDraftProposedOn,
  WorkflowDraftProposedStep,
  WorkflowDraftRebase,
  WorkflowDraftRebaseKind,
  fingerprintWorkflowSteps,
  getStepsReadBySettings,
  getStepsTouchedByDraft,
  proposeWorkflowDraft,
  readWorkflowDraftProposedOn,
  rebaseWorkflowDraft,
} from "../../../Types/Workflow/WorkflowDraftRebase";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { beforeEach, describe, expect, test } from "@jest/globals";
import crypto from "crypto";

/*
 * Issue #6274: Ask AI's change, approved after someone saved the workflow,
 * is made on top of what they saved when the two touch different steps, and
 * not at all when they meet.
 */

const TRIGGER: ComponentMetadata = {
  id: "on-thing",
  title: "On Thing",
  category: "Test",
  description: "",
  componentType: ComponentType.Trigger,
  arguments: [],
  returnValues: [],
  inPorts: [],
  outPorts: [{ id: "success", title: "Success", description: "" }],
} as unknown as ComponentMetadata;

const OTHER_TRIGGER: ComponentMetadata = {
  ...TRIGGER,
  id: "on-other-thing",
  title: "On Other Thing",
} as unknown as ComponentMetadata;

const STEP: ComponentMetadata = {
  id: "do-thing",
  title: "Do Thing",
  category: "Test",
  description: "",
  componentType: ComponentType.Component,
  arguments: [
    {
      id: "text",
      name: "Text",
      description: "",
      type: ComponentInputType.Text,
      required: true,
    },
    {
      id: "token",
      name: "Token",
      description: "",
      type: ComponentInputType.Password,
      required: false,
    },
    {
      id: "body",
      name: "Body",
      description: "",
      type: ComponentInputType.JSON,
      required: false,
    },
  ],
  returnValues: [],
  inPorts: [{ id: "in", title: "In", description: "" }],
  outPorts: [
    { id: "success", title: "Success", description: "" },
    { id: "error", title: "Error", description: "" },
  ],
} as unknown as ComponentMetadata;

const BRANCH: ComponentMetadata = {
  ...STEP,
  id: "branch",
  title: "Branch",
  outPorts: [
    { id: "yes", title: "Yes", description: "" },
    { id: "no", title: "No", description: "" },
  ],
} as unknown as ComponentMetadata;

type GetComponentFunction = (id: string) => ComponentMetadata | undefined;

const getComponent: GetComponentFunction = (
  id: string,
): ComponentMetadata | undefined => {
  return [TRIGGER, OTHER_TRIGGER, STEP, BRANCH].find(
    (component: ComponentMetadata) => {
      return component.id === id;
    },
  );
};

let nextId: number = 0;

const generateId: () => string = (): string => {
  nextId++;
  return `generated-${nextId}`;
};

beforeEach(() => {
  nextId = 0;
});

// A keyed digest, as the server's is: the key is the test's own.
const digest: (text: string) => string = (text: string): string => {
  return crypto
    .createHmac("sha256", "workflow-draft-rebase-test")
    .update(text, "utf8")
    .digest("hex")
    .slice(0, 16);
};

type GraphOfFunction = (
  draft: WorkflowDraft,
  existingGraph?: JSONObject | undefined,
) => JSONObject;

const graphOf: GraphOfFunction = (
  draft: WorkflowDraft,
  existingGraph?: JSONObject | undefined,
): JSONObject => {
  return buildGraphFromDraft({
    draft: draft,
    getComponent: getComponent,
    generateId: generateId,
    existingGraph: existingGraph,
  });
};

const copyOf: (graph: JSONObject) => JSONObject = (
  graph: JSONObject,
): JSONObject => {
  return JSON.parse(JSON.stringify(graph)) as JSONObject;
};

// The workflow as it is when Ask AI proposes: a trigger, then Work, then Log.
const BASE_DRAFT: WorkflowDraft = {
  steps: [
    { id: "start", componentId: "on-thing" },
    {
      id: "work",
      componentId: "do-thing",
      arguments: { text: "hello", token: "s3cret" },
    },
    { id: "log", componentId: "do-thing", arguments: { text: "done" } },
  ],
  connections: [
    { from: "start", to: "work" },
    { from: "work", to: "log" },
  ],
};

let BASE: JSONObject = {};

beforeEach(() => {
  BASE = graphOf(BASE_DRAFT);
});

interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: {
    id: string;
    metadataId: string;
    internalId: string;
    arguments: JSONObject;
    nodeType: string;
  };
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle?: string;
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

const nodeOf: (graph: JSONObject, stepId: string) => GraphNode | undefined = (
  graph: JSONObject,
  stepId: string,
): GraphNode | undefined => {
  return nodesOf(graph).find((node: GraphNode): boolean => {
    return node.data.id === stepId;
  });
};

// What a draft of the workflow written back as it was read says: the model's view.
const readBack: (graph: JSONObject) => WorkflowDraft = (
  graph: JSONObject,
): WorkflowDraft => {
  return getDraftFromGraph({ graph: graph, getComponent: getComponent });
};

const withStep: (
  draft: WorkflowDraft,
  step: WorkflowDraftStep,
  connection?: WorkflowDraftConnection | undefined,
) => WorkflowDraft = (
  draft: WorkflowDraft,
  step: WorkflowDraftStep,
  connection?: WorkflowDraftConnection | undefined,
): WorkflowDraft => {
  return {
    steps: [...draft.steps, step],
    connections: [...draft.connections, ...(connection ? [connection] : [])],
  };
};

const propose: (draft: WorkflowDraft) => WorkflowDraftProposedOn = (
  draft: WorkflowDraft,
): WorkflowDraftProposedOn => {
  return proposeWorkflowDraft({
    draft: draft,
    graph: BASE,
    graphRevision: 4,
    getComponent: getComponent,
    generateId: generateId,
    digest: digest,
  });
};

const rebase: (
  draft: WorkflowDraft,
  current: JSONObject,
  proposedOn?: WorkflowDraftProposedOn | undefined,
) => WorkflowDraftRebase = (
  draft: WorkflowDraft,
  current: JSONObject,
  proposedOn?: WorkflowDraftProposedOn | undefined,
): WorkflowDraftRebase => {
  return rebaseWorkflowDraft({
    draft: draft,
    proposedOn: proposedOn || propose(draft),
    graph: current,
    getComponent: getComponent,
    generateId: generateId,
    digest: digest,
  });
};

const rebasedGraph: (outcome: WorkflowDraftRebase) => JSONObject = (
  outcome: WorkflowDraftRebase,
): JSONObject => {
  expect(outcome.kind).toBe(WorkflowDraftRebaseKind.Rebased);

  if (outcome.kind !== WorkflowDraftRebaseKind.Rebased) {
    throw new Error("Not rebased.");
  }

  return outcome.graph;
};

// A teammate's save, made to the stored graph as the Builder makes it.
const saveElsewhere: (
  change: (graph: JSONObject) => void,
  from?: JSONObject | undefined,
) => JSONObject = (
  change: (graph: JSONObject) => void,
  from?: JSONObject | undefined,
): JSONObject => {
  const graph: JSONObject = copyOf(from || BASE);
  change(graph);
  return graph;
};

const addStepElsewhere: (data: {
  graph: JSONObject;
  stepId: string;
  after: string;
  text: string;
}) => void = (data: {
  graph: JSONObject;
  stepId: string;
  after: string;
  text: string;
}): void => {
  nodesOf(data.graph).push({
    id: `canvas-${data.stepId}`,
    position: { x: 900, y: 900 },
    data: {
      id: data.stepId,
      metadataId: "do-thing",
      internalId: `runner-${data.stepId}`,
      arguments: { text: data.text, token: "their-token" },
      nodeType: NodeType.Node,
    },
  } as unknown as GraphNode);
  edgesOf(data.graph).push({
    id: `edge-${data.stepId}`,
    source: nodeOf(data.graph, data.after)!.id,
    target: `canvas-${data.stepId}`,
    sourceHandle: "success",
    targetHandle: "in",
  });
};

const ids: (draft: WorkflowDraft) => Array<string> = (
  draft: WorkflowDraft,
): Array<string> => {
  return draft.steps
    .map((step: WorkflowDraftStep): string => {
      return step.id;
    })
    .sort();
};

const connectionsOf: (graph: JSONObject) => Array<string> = (
  graph: JSONObject,
): Array<string> => {
  return readBack(graph)
    .connections.map((connection: WorkflowDraftConnection): string => {
      return `${connection.from}>${connection.fromOutput || ""}>${connection.to}`;
    })
    .sort();
};

describe("readWorkflowDraftProposedOn", () => {
  test("reads what a proposal wrote", () => {
    const proposedOn: WorkflowDraftProposedOn = {
      graphRevision: 7,
      steps: [
        { id: "work", fingerprint: "0123456789abcdef" },
        { id: "email-1", fingerprint: null },
      ],
    };

    expect(
      readWorkflowDraftProposedOn(JSON.parse(JSON.stringify(proposedOn))),
    ).toEqual(proposedOn);
  });

  test("a change that touches no step is still a change proposed on a revision", () => {
    expect(
      readWorkflowDraftProposedOn({ graphRevision: 0, steps: [] }),
    ).toEqual({ graphRevision: 0, steps: [] });
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "graphRevision: 7"],
    ["a list", [7]],
    ["no revision", { steps: [] }],
    ["a revision as text", { graphRevision: "7", steps: [] }],
    ["a negative revision", { graphRevision: -1, steps: [] }],
    ["a fraction", { graphRevision: 1.5, steps: [] }],
    ["a revision past what is exact", { graphRevision: 2 ** 60, steps: [] }],
    ["no steps", { graphRevision: 1 }],
    ["steps as an object", { graphRevision: 1, steps: { work: "x" } }],
    ["a step that is no object", { graphRevision: 1, steps: ["work"] }],
    [
      "a step with no id",
      { graphRevision: 1, steps: [{ fingerprint: "abc" }] },
    ],
    [
      "a step with an empty id",
      { graphRevision: 1, steps: [{ id: "", fingerprint: "abc" }] },
    ],
    [
      "a step twice",
      {
        graphRevision: 1,
        steps: [
          { id: "work", fingerprint: "abc" },
          { id: "work", fingerprint: null },
        ],
      },
    ],
    [
      "a fingerprint that is a number",
      { graphRevision: 1, steps: [{ id: "work", fingerprint: 12 }] },
    ],
    [
      "an empty fingerprint",
      { graphRevision: 1, steps: [{ id: "work", fingerprint: "" }] },
    ],
    [
      "a fingerprint far too long",
      {
        graphRevision: 1,
        steps: [{ id: "work", fingerprint: "a".repeat(129) }],
      },
    ],
    [
      "more steps than any draft touches",
      {
        graphRevision: 1,
        steps: Array.from(
          { length: 1001 },
          (_value: unknown, index: number) => {
            return { id: `step-${index}`, fingerprint: null };
          },
        ),
      },
    ],
  ] as Array<[string, unknown]>)(
    "%s is no record of what a change was proposed on",
    (_name: string, value: unknown) => {
      expect(readWorkflowDraftProposedOn(value)).toBeNull();
    },
  );

  test("a step id that names an object's own machinery is only a step id", () => {
    const read: WorkflowDraftProposedOn | null = readWorkflowDraftProposedOn(
      JSON.parse(
        '{"graphRevision":2,"steps":[{"id":"__proto__","fingerprint":"abc"},{"id":"constructor","fingerprint":null}]}',
      ),
    );

    expect(read?.steps).toEqual([
      { id: "__proto__", fingerprint: "abc" },
      { id: "constructor", fingerprint: null },
    ]);
  });
});

describe("getStepsReadBySettings", () => {
  test("finds the steps a setting reads the results of, however deep", () => {
    expect(
      getStepsReadBySettings({
        text: "Hello {{local.components.fetch-1.returnValues.body.name}}",
        body: '{"to": "{{local.components.lookup_2.returnValues.email}}"}',
        nested: {
          list: ["{{ local.components.spaced.returnValues.x }}"],
        } as unknown as JSONObject,
      }),
    ).toEqual(["fetch-1", "lookup_2", "spaced"]);
  });

  test("a loop over a step's results reads that step", () => {
    expect(
      getStepsReadBySettings({
        text: "{{#each local.components.list-1.returnValues.items}}{{this}}{{/each}}",
      }),
    ).toEqual(["list-1"]);
  });

  test("variables, unknown roots and code are no steps", () => {
    expect(
      getStepsReadBySettings({
        text: "{{local.variables.apiKey}} {{global.variables.region}} {{whatever}} if (x) {{ return 1; }}",
        count: 3,
        flag: true,
      } as unknown as JSONObject),
    ).toEqual([]);
  });
});

describe("getStepsTouchedByDraft", () => {
  type TouchedFunction = (draft: WorkflowDraft) => Array<string>;

  const touched: TouchedFunction = (draft: WorkflowDraft): Array<string> => {
    return getStepsTouchedByDraft({
      draft: draft,
      graph: BASE,
      getComponent: getComponent,
      generateId: generateId,
    });
  };

  test("the workflow written back as it was read touches nothing: a secret read back hidden is no change", () => {
    const draft: WorkflowDraft = readBack(BASE);

    expect(
      draft.steps.find((step: WorkflowDraftStep): boolean => {
        return step.id === "work";
      })?.arguments?.["token"],
    ).toBe("[hidden]");
    expect(touched(draft)).toEqual([]);
  });

  test("a step's settings left out are kept: no change", () => {
    expect(
      touched({
        steps: BASE_DRAFT.steps.map((step: WorkflowDraftStep) => {
          return { id: step.id, componentId: step.componentId };
        }),
        connections: BASE_DRAFT.connections,
      }),
    ).toEqual([]);
  });

  test("a step added after another touches the two: the new one, and the one it leaves from", () => {
    expect(
      touched(
        withStep(
          readBack(BASE),
          { id: "email", componentId: "do-thing", arguments: { text: "hi" } },
          { from: "log", to: "email" },
        ),
      ),
    ).toEqual(["email", "log"]);
  });

  test("a step taken out touches it and its neighbours", () => {
    const draft: WorkflowDraft = readBack(BASE);

    expect(
      touched({
        steps: draft.steps.filter((step: WorkflowDraftStep): boolean => {
          return step.id !== "work";
        }),
        connections: [{ from: "start", to: "log" }],
      }),
    ).toEqual(["log", "start", "work"]);
  });

  test("a step's settings changed touch that step alone", () => {
    const draft: WorkflowDraft = readBack(BASE);

    expect(
      touched({
        ...draft,
        steps: draft.steps.map((step: WorkflowDraftStep) => {
          return step.id === "log"
            ? { ...step, arguments: { text: "all done" } }
            : step;
        }),
      }),
    ).toEqual(["log"]);
  });

  test("another component under the same id is a change of that step", () => {
    const draft: WorkflowDraft = readBack(BASE);

    expect(
      touched({
        ...draft,
        steps: draft.steps.map((step: WorkflowDraftStep) => {
          return step.id === "log"
            ? { id: "log", componentId: "branch", arguments: { text: "x" } }
            : step;
        }),
        connections: [{ from: "start", to: "work" }],
      }),
    ).toEqual(["log", "work"]);
  });

  test("a step the change writes touches the steps it reads; a step it only keeps does not", () => {
    expect(
      touched(
        withStep(
          readBack(BASE),
          {
            id: "email",
            componentId: "do-thing",
            arguments: {
              text: "{{local.components.start.returnValues.title}} and {{#each local.components.work.returnValues.rows}}{{/each}}",
            },
          },
          { from: "log", to: "email" },
        ),
      ),
    ).toEqual(["email", "log", "start", "work"]);
  });

  test("a connection moved to another output touches both its ends", () => {
    const graph: JSONObject = graphOf({
      steps: [
        { id: "start", componentId: "on-thing" },
        { id: "check", componentId: "branch", arguments: { text: "?" } },
        { id: "act", componentId: "do-thing", arguments: { text: "!" } },
      ],
      connections: [
        { from: "start", to: "check" },
        { from: "check", fromOutput: "yes", to: "act" },
      ],
    });

    const draft: WorkflowDraft = readBack(graph);

    expect(
      getStepsTouchedByDraft({
        draft: {
          ...draft,
          connections: [
            { from: "start", to: "check" },
            { from: "check", fromOutput: "no", to: "act" },
          ],
        },
        graph: graph,
        getComponent: getComponent,
        generateId: generateId,
      }),
    ).toEqual(["act", "check"]);
  });
});

describe("fingerprintWorkflowSteps", () => {
  type FingerprintFunction = (graph: JSONObject, stepId: string) => string;

  const fingerprint: FingerprintFunction = (
    graph: JSONObject,
    stepId: string,
  ): string => {
    return fingerprintWorkflowSteps({
      graph: graph,
      stepIds: [stepId],
      digest: digest,
    })[0]!.fingerprint as string;
  };

  test("a step the workflow does not have has none", () => {
    expect(
      fingerprintWorkflowSteps({
        graph: BASE,
        stepIds: ["nowhere", "work"],
        digest: digest,
      }).map((step: WorkflowDraftProposedStep) => {
        return [step.id, step.fingerprint === null];
      }),
    ).toEqual([
      ["nowhere", true],
      ["work", false],
    ]);
  });

  test("a card moved, selected or measured is the same step", () => {
    const moved: JSONObject = saveElsewhere((graph: JSONObject) => {
      const node: GraphNode = nodeOf(graph, "work")!;
      node.position = { x: node.position.x + 300, y: node.position.y - 40 };
      (node as unknown as JSONObject)["selected"] = true;
      (node as unknown as JSONObject)["width"] = 320;
    });

    expect(fingerprint(moved, "work")).toBe(fingerprint(BASE, "work"));
  });

  test("its node id and the runner's id are the canvas's: the same step", () => {
    const renamed: JSONObject = saveElsewhere((graph: JSONObject) => {
      const node: GraphNode = nodeOf(graph, "log")!;
      const edge: GraphEdge = edgesOf(graph).find((each: GraphEdge) => {
        return each.target === node.id;
      })!;

      node.id = "another-canvas-id";
      node.data.internalId = "another-runner-id";
      edge.target = "another-canvas-id";
    });

    expect(fingerprint(renamed, "log")).toBe(fingerprint(BASE, "log"));
  });

  test("an unset setting reads alike however it is written, and JSON alike however it is spaced", () => {
    const before: JSONObject = saveElsewhere((graph: JSONObject) => {
      nodeOf(graph, "log")!.data.arguments = {
        text: "done",
        body: '{"a":1,"b":[1,2]}',
      };
    });
    const after: JSONObject = saveElsewhere((graph: JSONObject) => {
      nodeOf(graph, "log")!.data.arguments = {
        text: "done",
        token: "",
        body: '{ "b": [1, 2], "a": 1 }',
        other: null,
      } as unknown as JSONObject;
    });

    expect(fingerprint(after, "log")).toBe(fingerprint(before, "log"));
  });

  test.each([
    [
      "a setting changed",
      (graph: JSONObject): void => {
        nodeOf(graph, "work")!.data.arguments["text"] = "hello there";
      },
    ],
    [
      "a secret changed, which a draft only ever shows hidden",
      (graph: JSONObject): void => {
        nodeOf(graph, "work")!.data.arguments["token"] = "rotated";
      },
    ],
    [
      "another component",
      (graph: JSONObject): void => {
        nodeOf(graph, "work")!.data.metadataId = "branch";
      },
    ],
    [
      "a new step after it",
      (graph: JSONObject): void => {
        addStepElsewhere({
          graph,
          stepId: "slack",
          after: "work",
          text: "posted",
        });
      },
    ],
    [
      "the connection into it taken out",
      (graph: JSONObject): void => {
        graph["edges"] = edgesOf(graph).filter((edge: GraphEdge) => {
          return edge.target !== nodeOf(graph, "work")!.id;
        }) as unknown as JSONObject;
      },
    ],
    [
      "the output it leaves by changed",
      (graph: JSONObject): void => {
        edgesOf(graph).find((edge: GraphEdge) => {
          return edge.source === nodeOf(graph, "work")!.id;
        })!.sourceHandle = "error";
      },
    ],
    [
      "the step it leads to taken out, its connection with it",
      (graph: JSONObject): void => {
        const log: GraphNode = nodeOf(graph, "log")!;
        graph["nodes"] = nodesOf(graph).filter((node: GraphNode) => {
          return node !== log;
        }) as unknown as JSONObject;
      },
    ],
    [
      "a second step under the same id",
      (graph: JSONObject): void => {
        nodesOf(graph).push({
          ...copyOf(nodeOf(graph, "work") as unknown as JSONObject),
          id: "a-twin",
        } as unknown as GraphNode);
      },
    ],
  ] as Array<[string, (graph: JSONObject) => void]>)(
    "%s is another step",
    (_name: string, change: (graph: JSONObject) => void) => {
      expect(fingerprint(saveElsewhere(change), "work")).not.toBe(
        fingerprint(BASE, "work"),
      );
    },
  );

  test("the slot a trigger goes in is no step", () => {
    const graph: JSONObject = saveElsewhere((each: JSONObject) => {
      nodesOf(each).push({
        id: "placeholder",
        position: { x: 0, y: 0 },
        data: {
          id: "start",
          nodeType: NodeType.PlaceholderNode,
        },
      } as unknown as GraphNode);
    });

    expect(fingerprint(graph, "start")).toBe(fingerprint(BASE, "start"));
  });
});

describe("rebaseWorkflowDraft", () => {
  // Ask AI's change: an email step after Log.
  const ADD_EMAIL: () => WorkflowDraft = (): WorkflowDraft => {
    return withStep(
      readBack(BASE),
      {
        id: "email",
        componentId: "do-thing",
        arguments: { text: "Sent to on-call" },
      },
      { from: "log", to: "email" },
    );
  };

  test("nobody saved since: the draft, exactly as it would have been saved", () => {
    const draft: WorkflowDraft = ADD_EMAIL();
    const rebased: JSONObject = rebasedGraph(rebase(draft, BASE));

    expect(readBack(rebased)).toEqual(readBack(graphOf(draft, BASE)));
    expect(nodeOf(rebased, "work")!.data.arguments["token"]).toBe("s3cret");
  });

  test("someone added a step elsewhere since: theirs is kept as they saved it, and Ask AI's is added", () => {
    const draft: WorkflowDraft = ADD_EMAIL();
    const current: JSONObject = saveElsewhere((graph: JSONObject) => {
      addStepElsewhere({ graph, stepId: "slack", after: "work", text: "hi" });
    });

    const rebased: JSONObject = rebasedGraph(rebase(draft, current));

    expect(ids(readBack(rebased))).toEqual([
      "email",
      "log",
      "slack",
      "start",
      "work",
    ]);
    // Theirs: the same card, where they put it, with its settings and its secret.
    expect(nodeOf(rebased, "slack")).toMatchObject({
      id: "canvas-slack",
      position: { x: 900, y: 900 },
      data: {
        internalId: "runner-slack",
        arguments: { text: "hi", token: "their-token" },
      },
    });
    expect(connectionsOf(rebased)).toEqual([
      "log>success>email",
      "start>success>work",
      "work>success>log",
      "work>success>slack",
    ]);
    // Ask AI's: as the card said.
    expect(nodeOf(rebased, "email")!.data.arguments).toEqual({
      text: "Sent to on-call",
    });
  });

  test("someone moved the very card Ask AI changes: the move and the change are both kept", () => {
    const draft: WorkflowDraft = readBack(BASE);
    const changed: WorkflowDraft = {
      ...draft,
      steps: draft.steps.map((step: WorkflowDraftStep) => {
        return step.id === "log"
          ? { ...step, arguments: { text: "all done" } }
          : step;
      }),
    };
    const current: JSONObject = saveElsewhere((graph: JSONObject) => {
      nodeOf(graph, "log")!.position = { x: 40, y: 1000 };
    });

    const rebased: JSONObject = rebasedGraph(rebase(changed, current));

    expect(nodeOf(rebased, "log")!.position).toEqual({ x: 40, y: 1000 });
    expect(nodeOf(rebased, "log")!.data.arguments).toEqual({
      text: "all done",
    });
  });

  test("someone changed a step Ask AI does not touch: kept exactly, its secret too", () => {
    const current: JSONObject = saveElsewhere((graph: JSONObject) => {
      nodeOf(graph, "work")!.data.arguments = {
        text: "theirs",
        token: "rotated",
      };
    });

    const rebased: JSONObject = rebasedGraph(rebase(ADD_EMAIL(), current));

    expect(nodeOf(rebased, "work")!.data.arguments).toEqual({
      text: "theirs",
      token: "rotated",
    });
    expect(nodeOf(rebased, "work")!.id).toBe(nodeOf(BASE, "work")!.id);
  });

  test("someone took out a step Ask AI only kept as it was: it stays out", () => {
    const draft: WorkflowDraft = readBack(BASE);
    const changed: WorkflowDraft = {
      ...draft,
      steps: draft.steps.map((step: WorkflowDraftStep) => {
        return step.id === "start" ? step : step;
      }),
    };
    const edited: WorkflowDraft = withStep(
      changed,
      { id: "audit", componentId: "do-thing", arguments: { text: "a" } },
      { from: "start", to: "audit" },
    );
    const current: JSONObject = saveElsewhere((graph: JSONObject) => {
      const log: GraphNode = nodeOf(graph, "log")!;
      graph["nodes"] = nodesOf(graph).filter((node: GraphNode) => {
        return node !== log;
      }) as unknown as JSONObject;
      graph["edges"] = edgesOf(graph).filter((edge: GraphEdge) => {
        return edge.target !== log.id;
      }) as unknown as JSONObject;
    });

    const rebased: JSONObject = rebasedGraph(rebase(edited, current));

    expect(ids(readBack(rebased))).toEqual(["audit", "start", "work"]);
  });

  test("someone changed the very step Ask AI changes: nothing is made, and that step is named", () => {
    const draft: WorkflowDraft = readBack(BASE);
    const changed: WorkflowDraft = {
      ...draft,
      steps: draft.steps.map((step: WorkflowDraftStep) => {
        return step.id === "log"
          ? { ...step, arguments: { text: "Ask AI's" } }
          : step;
      }),
    };
    const current: JSONObject = saveElsewhere((graph: JSONObject) => {
      nodeOf(graph, "log")!.data.arguments["text"] = "theirs";
    });

    expect(rebase(changed, current)).toEqual({
      kind: WorkflowDraftRebaseKind.Conflict,
      stepIds: ["log"],
      problems: [],
    });
  });

  test.each([
    [
      "added a step after the step Ask AI adds after",
      (graph: JSONObject): void => {
        addStepElsewhere({ graph, stepId: "slack", after: "log", text: "x" });
      },
      ["log"],
    ],
    [
      "added a step under the id Ask AI adds one under",
      (graph: JSONObject): void => {
        addStepElsewhere({ graph, stepId: "email", after: "work", text: "x" });
      },
      ["email"],
    ],
    [
      "took out the step Ask AI adds after",
      (graph: JSONObject): void => {
        const log: GraphNode = nodeOf(graph, "log")!;
        graph["nodes"] = nodesOf(graph).filter((node: GraphNode) => {
          return node !== log;
        }) as unknown as JSONObject;
      },
      ["log"],
    ],
    [
      "rotated the secret of the step Ask AI adds after",
      (graph: JSONObject): void => {
        nodeOf(graph, "log")!.data.arguments["token"] = "new";
      },
      ["log"],
    ],
  ] as Array<[string, (graph: JSONObject) => void, Array<string>]>)(
    "someone %s: the two meet, and nothing is made",
    (
      _name: string,
      change: (graph: JSONObject) => void,
      meet: Array<string>,
    ) => {
      const outcome: WorkflowDraftRebase = rebase(
        ADD_EMAIL(),
        saveElsewhere(change),
      );

      expect(outcome.kind).toBe(WorkflowDraftRebaseKind.Conflict);
      expect(
        outcome.kind === WorkflowDraftRebaseKind.Conflict && outcome.stepIds,
      ).toEqual(meet);
    },
  );

  test("someone connected another step into the step Ask AI changes: the two meet, so their connection is never dropped", () => {
    const draft: WorkflowDraft = readBack(BASE);
    const changed: WorkflowDraft = {
      ...draft,
      steps: draft.steps.map((step: WorkflowDraftStep) => {
        return step.id === "log"
          ? { ...step, arguments: { text: "Ask AI's" } }
          : step;
      }),
    };
    // Start now leads to Log too, by a connection of theirs.
    const current: JSONObject = saveElsewhere((graph: JSONObject) => {
      edgesOf(graph).push({
        id: "their-edge",
        source: nodeOf(graph, "start")!.id,
        target: nodeOf(graph, "log")!.id,
        sourceHandle: "success",
        targetHandle: "in",
      });
    });

    const outcome: WorkflowDraftRebase = rebase(changed, current);

    expect(outcome.kind).toBe(WorkflowDraftRebaseKind.Conflict);
    expect(
      outcome.kind === WorkflowDraftRebaseKind.Conflict && outcome.stepIds,
    ).toEqual(["log"]);
  });

  test("someone changed a step Ask AI's new step reads: the two meet", () => {
    const draft: WorkflowDraft = withStep(
      readBack(BASE),
      {
        id: "email",
        componentId: "do-thing",
        arguments: { text: "{{local.components.work.returnValues.body}}" },
      },
      { from: "log", to: "email" },
    );
    const current: JSONObject = saveElsewhere((graph: JSONObject) => {
      nodeOf(graph, "work")!.data.metadataId = "branch";
    });

    const outcome: WorkflowDraftRebase = rebase(draft, current);

    expect(outcome.kind === WorkflowDraftRebaseKind.Conflict).toBe(true);
    expect(
      outcome.kind === WorkflowDraftRebaseKind.Conflict && outcome.stepIds,
    ).toEqual(["work"]);
  });

  test("both gave the workflow a trigger, under different ids: the two cannot be one workflow", () => {
    const empty: JSONObject = graphOf({
      steps: [
        { id: "work", componentId: "do-thing", arguments: { text: "w" } },
      ],
      connections: [],
    });
    const draft: WorkflowDraft = withStep(
      readBack(empty),
      { id: "start", componentId: "on-thing" },
      { from: "start", to: "work" },
    );
    const proposedOn: WorkflowDraftProposedOn = proposeWorkflowDraft({
      draft: draft,
      graph: empty,
      graphRevision: 1,
      getComponent: getComponent,
      generateId: generateId,
      digest: digest,
    });
    const current: JSONObject = saveElsewhere((graph: JSONObject) => {
      nodesOf(graph).push({
        id: "canvas-other-start",
        position: { x: 0, y: 0 },
        data: {
          id: "other-start",
          metadataId: "on-other-thing",
          internalId: "runner-other-start",
          arguments: {},
          nodeType: NodeType.Node,
        },
      } as unknown as GraphNode);
    }, empty);

    const outcome: WorkflowDraftRebase = rebase(draft, current, proposedOn);

    expect(outcome.kind).toBe(WorkflowDraftRebaseKind.Conflict);
    expect(
      outcome.kind === WorkflowDraftRebaseKind.Conflict &&
        outcome.stepIds.length === 0 &&
        outcome.problems.join(" "),
    ).toContain("A workflow has one trigger");
  });

  test("a proposal made of fingerprints from another key never matches: nothing is made", () => {
    const draft: WorkflowDraft = ADD_EMAIL();
    const proposedOn: WorkflowDraftProposedOn = proposeWorkflowDraft({
      draft: draft,
      graph: BASE,
      graphRevision: 4,
      getComponent: getComponent,
      generateId: generateId,
      digest: (text: string): string => {
        return crypto
          .createHmac("sha256", "another-installation")
          .update(text)
          .digest("hex")
          .slice(0, 16);
      },
    });

    expect(rebase(draft, BASE, proposedOn).kind).toBe(
      WorkflowDraftRebaseKind.Conflict,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * A seeded property test: random workflows, a random change by Ask AI and a
 * random save by someone else in between, held to what the change and the
 * save each did, step by step.
 * ---------------------------------------------------------------------------
 */

interface Generated {
  base: JSONObject;
  draft: WorkflowDraft;
  current: JSONObject;
  // What Ask AI's change and the other save touch, worked out from what each did.
  askAiTouches: Set<string>;
  otherTouches: Set<string>;
}

const pick: <T>(items: Array<T>, random: SeededRandom) => T = <T>(
  items: Array<T>,
  random: SeededRandom,
): T => {
  return items[random(items.length)] as T;
};

const stepContent: (step: WorkflowDraftStep | undefined) => string = (
  step: WorkflowDraftStep | undefined,
): string => {
  return step
    ? JSON.stringify([
        step.componentId,
        Object.keys(step.arguments || {})
          .sort()
          .map((key: string) => {
            return [key, (step.arguments || {})[key]];
          }),
      ])
    : "";
};

// The steps whose own content, or connections, differ between two graphs.
const touchedBetween: (before: JSONObject, after: JSONObject) => Set<string> = (
  before: JSONObject,
  after: JSONObject,
): Set<string> => {
  const read: (graph: JSONObject) => WorkflowDraft = (
    graph: JSONObject,
  ): WorkflowDraft => {
    // Settings as saved, secrets and all: no lookup, so nothing is hidden.
    return getDraftFromGraph({
      graph: graph,
      getComponent: (): undefined => {
        return undefined;
      },
    });
  };

  const was: WorkflowDraft = read(before);
  const is: WorkflowDraft = read(after);
  const touched: Set<string> = new Set<string>();

  for (const id of new Set<string>([...ids(was), ...ids(is)])) {
    const a: WorkflowDraftStep | undefined = was.steps.find(
      (step: WorkflowDraftStep) => {
        return step.id === id;
      },
    );
    const b: WorkflowDraftStep | undefined = is.steps.find(
      (step: WorkflowDraftStep) => {
        return step.id === id;
      },
    );

    if (stepContent(a) !== stepContent(b)) {
      touched.add(id);
    }
  }

  const key: (connection: WorkflowDraftConnection) => string = (
    connection: WorkflowDraftConnection,
  ): string => {
    return `${connection.from}>${connection.fromOutput || ""}>${connection.to}`;
  };

  const wasKeys: Set<string> = new Set<string>(was.connections.map(key));
  const isKeys: Set<string> = new Set<string>(is.connections.map(key));

  for (const connection of [...was.connections, ...is.connections]) {
    if (wasKeys.has(key(connection)) !== isKeys.has(key(connection))) {
      touched.add(connection.from);
      touched.add(connection.to);
    }
  }

  return touched;
};

const generate: (random: SeededRandom, round: number) => Generated = (
  random: SeededRandom,
  round: number,
): Generated => {
  // A trigger and two to six steps, each led to from one before it.
  const stepCount: number = 2 + random(5);
  const steps: Array<WorkflowDraftStep> = [
    { id: "t", componentId: "on-thing" },
  ];
  const connections: Array<WorkflowDraftConnection> = [];

  for (let index: number = 1; index <= stepCount; index++) {
    const isBranch: boolean = random(4) === 0;
    steps.push({
      id: `s${index}`,
      componentId: isBranch ? "branch" : "do-thing",
      arguments: {
        text: `step ${index}`,
        ...(random(3) === 0 ? { token: `secret-${index}` } : {}),
      },
    });

    const from: WorkflowDraftStep = steps[random(index)]!;
    connections.push({
      from: from.id,
      to: `s${index}`,
      ...(from.componentId === "branch"
        ? { fromOutput: random(2) === 0 ? "yes" : "no" }
        : {}),
    });
  }

  const base: JSONObject = graphOf({ steps, connections });

  // Ask AI's change, made to the draft it read.
  let draft: WorkflowDraft = readBack(base);
  const askAiReads: Set<string> = new Set<string>();
  const changeCount: number = 1 + random(3);

  for (let change: number = 0; change < changeCount; change++) {
    const kind: number = random(4);
    const stepIds: Array<string> = ids(draft);

    if (kind === 0) {
      // A new step after one, perhaps reading another's results.
      const after: string = pick(stepIds, random);
      const reads: string | null =
        random(2) === 0 ? pick(stepIds, random) : null;
      const id: string = `a${round}x${change}`;

      if (reads) {
        askAiReads.add(reads);
      }

      draft = withStep(
        draft,
        {
          id: id,
          componentId: "do-thing",
          arguments: {
            text: reads
              ? `{{local.components.${reads}.returnValues.value}}`
              : "Ask AI's",
          },
        },
        {
          from: after,
          to: id,
          ...(draft.steps.find((step: WorkflowDraftStep) => {
            return step.id === after;
          })?.componentId === "branch"
            ? { fromOutput: "yes" }
            : {}),
        },
      );
    } else if (kind === 1 && stepIds.length > 2) {
      // A step taken out, with its connections.
      const removed: string = pick(
        stepIds.filter((id: string) => {
          return id !== "t";
        }),
        random,
      );
      draft = {
        steps: draft.steps.filter((step: WorkflowDraftStep) => {
          return step.id !== removed;
        }),
        connections: draft.connections.filter(
          (connection: WorkflowDraftConnection) => {
            return connection.from !== removed && connection.to !== removed;
          },
        ),
      };
    } else if (kind === 2) {
      // A step's text changed.
      const changeable: Array<string> = stepIds.filter((id: string) => {
        return id !== "t";
      });

      if (changeable.length === 0) {
        continue;
      }

      const changed: string = pick(changeable, random);
      draft = {
        ...draft,
        steps: draft.steps.map((step: WorkflowDraftStep) => {
          return step.id === changed
            ? {
                ...step,
                arguments: {
                  ...(step.arguments || {}),
                  text: `Ask AI's ${change}`,
                },
              }
            : step;
        }),
      };
    } else {
      // A connection made between two steps that have none.
      const from: string = pick(stepIds, random);
      const targets: Array<string> = stepIds.filter((id: string) => {
        return id !== "t" && id !== from;
      });
      const to: string | undefined =
        targets.length > 0 ? pick(targets, random) : undefined;
      const fromStep: WorkflowDraftStep | undefined = draft.steps.find(
        (step: WorkflowDraftStep) => {
          return step.id === from;
        },
      );

      if (
        to &&
        !draft.connections.some((connection: WorkflowDraftConnection) => {
          return connection.from === from && connection.to === to;
        })
      ) {
        draft = {
          ...draft,
          connections: [
            ...draft.connections,
            {
              from,
              to,
              ...(fromStep?.componentId === "branch"
                ? { fromOutput: "no" }
                : {}),
            },
          ],
        };
      }
    }
  }

  // Someone else's save, made to the graph as the Builder makes it.
  const current: JSONObject = copyOf(base);
  const saveCount: number = random(4);

  for (let save: number = 0; save < saveCount; save++) {
    const kind: number = random(6);
    const nodes: Array<GraphNode> = nodesOf(current);

    if (nodes.length === 0) {
      break;
    }

    const node: GraphNode = pick(nodes, random);

    if (kind === 0) {
      node.position = {
        x: node.position.x + 10 + random(200),
        y: node.position.y + random(50),
      };
    } else if (kind === 1) {
      addStepElsewhere({
        graph: current,
        stepId: `o${round}x${save}`,
        after: node.data.id,
        text: "theirs",
      });
    } else if (kind === 2 && node.data.id !== "t") {
      node.data.arguments = {
        ...node.data.arguments,
        text: `theirs ${save}`,
      };
    } else if (kind === 3 && node.data.id !== "t") {
      current["nodes"] = nodes.filter((each: GraphNode) => {
        return each !== node;
      }) as unknown as JSONObject;
      current["edges"] = edgesOf(current).filter((edge: GraphEdge) => {
        return edge.source !== node.id && edge.target !== node.id;
      }) as unknown as JSONObject;
    } else if (kind === 4 && node.data.id !== "t") {
      node.data.arguments = {
        ...node.data.arguments,
        token: `rotated-${save}`,
      };
    } else if (kind === 5 && node.data.id !== "t") {
      // A connection into an existing step, from another.
      const from: GraphNode = pick(nodes, random);

      if (
        from !== node &&
        !edgesOf(current).some((edge: GraphEdge) => {
          return edge.source === from.id && edge.target === node.id;
        })
      ) {
        edgesOf(current).push({
          id: `their-edge-${round}-${save}`,
          source: from.id,
          target: node.id,
          sourceHandle:
            from.data.metadataId === "branch" ? "no" : "success",
          targetHandle: "in",
        });
      }
    }
  }

  const askAiGraph: JSONObject = graphOf(draft, base);
  const askAiTouches: Set<string> = touchedBetween(base, askAiGraph);
  const written: Set<string> = new Set<string>(
    [...askAiTouches].filter((id: string) => {
      return Boolean(nodeOf(askAiGraph, id));
    }),
  );

  // What the steps Ask AI writes read: the new ones, and the ones it changed.
  for (const id of written) {
    for (const read of getStepsReadBySettings(
      nodeOf(askAiGraph, id)!.data.arguments,
    )) {
      askAiTouches.add(read);
    }
  }

  void askAiReads;

  return {
    base,
    draft,
    current,
    askAiTouches,
    otherTouches: touchedBetween(base, current),
  };
};

describe("Ask AI's change and a save in between, at random", () => {
  test("a change is made on top exactly when the two touch different steps, and then each keeps exactly what it did", () => {
    const random: SeededRandom = seededRandom(6274);
    const counts: { [outcome: string]: number } = {
      rebased: 0,
      rebasedOverAMove: 0,
      rebasedOverAChange: 0,
      met: 0,
      cannotBeOne: 0,
      nobodySaved: 0,
    };

    for (let round: number = 0; round < 600; round++) {
      const generated: Generated = generate(random, round);
      const proposedOn: WorkflowDraftProposedOn = proposeWorkflowDraft({
        draft: generated.draft,
        graph: generated.base,
        graphRevision: round,
        getComponent: getComponent,
        generateId: generateId,
        digest: digest,
      });

      // What the proposal records is what the change touches.
      expect({
        round,
        touched: proposedOn.steps
          .map((step: WorkflowDraftProposedStep) => {
            return step.id;
          })
          .sort(),
      }).toEqual({ round, touched: [...generated.askAiTouches].sort() });

      const outcome: WorkflowDraftRebase = rebaseWorkflowDraft({
        draft: generated.draft,
        proposedOn: proposedOn,
        graph: generated.current,
        getComponent: getComponent,
        generateId: generateId,
        digest: digest,
      });

      const meet: Array<string> = [...generated.askAiTouches]
        .filter((id: string) => {
          return generated.otherTouches.has(id);
        })
        .sort();

      if (meet.length > 0) {
        counts["met"]!++;
        expect({ round, outcome }).toEqual({
          round,
          outcome: {
            kind: WorkflowDraftRebaseKind.Conflict,
            stepIds: meet,
            problems: [],
          },
        });
        continue;
      }

      if (outcome.kind === WorkflowDraftRebaseKind.Conflict) {
        // Only when the two together are no workflow: never for steps that did not meet.
        expect({ round, stepIds: outcome.stepIds }).toEqual({
          round,
          stepIds: [],
        });
        expect(outcome.problems.length).toBeGreaterThan(0);
        counts["cannotBeOne"]!++;
        continue;
      }

      counts["rebased"]!++;

      if (generated.otherTouches.size === 0) {
        if (
          JSON.stringify(readBack(generated.current)) ===
          JSON.stringify(readBack(generated.base))
        ) {
          counts["nobodySaved"]!++;
        }

        if (
          nodesOf(generated.current).some((node: GraphNode) => {
            return (
              JSON.stringify(node.position) !==
              JSON.stringify(nodeOf(generated.base, node.data.id)?.position)
            );
          })
        ) {
          counts["rebasedOverAMove"]!++;
        }
      } else {
        counts["rebasedOverAChange"]!++;
      }

      const rebased: JSONObject = outcome.graph;
      const askAi: JSONObject = graphOf(generated.draft, generated.base);

      for (const id of new Set<string>([
        ...ids(readBack(rebased)),
        ...ids(readBack(generated.current)),
        ...ids(readBack(askAi)),
      ])) {
        const made: GraphNode | undefined = nodeOf(rebased, id);
        const theirs: GraphNode | undefined = nodeOf(generated.current, id);
        const askAis: GraphNode | undefined = nodeOf(askAi, id);

        if (generated.askAiTouches.has(id)) {
          // Ask AI's change, exactly as the card described it.
          expect({ round, id, has: Boolean(made) }).toEqual({
            round,
            id,
            has: Boolean(askAis),
          });

          if (made && askAis) {
            expect({ round, id, step: made.data.metadataId }).toEqual({
              round,
              id,
              step: askAis.data.metadataId,
            });
            expect({ round, id, settings: made.data.arguments }).toEqual({
              round,
              id,
              settings: askAis.data.arguments,
            });
          }

          // A card that stays keeps its place as it is now.
          if (
            made &&
            theirs &&
            made.data.metadataId === theirs.data.metadataId
          ) {
            expect({ round, id, card: [made.id, made.position] }).toEqual({
              round,
              id,
              card: [theirs.id, theirs.position],
            });
          }

          continue;
        }

        // Everything else is the workflow as it is now, exactly as saved.
        expect({ round, id, has: Boolean(made) }).toEqual({
          round,
          id,
          has: Boolean(theirs),
        });

        if (made && theirs) {
          expect({
            round,
            id,
            card: [
              made.id,
              made.position,
              made.data.metadataId,
              made.data.internalId,
              made.data.arguments,
            ],
          }).toEqual({
            round,
            id,
            card: [
              theirs.id,
              theirs.position,
              theirs.data.metadataId,
              theirs.data.internalId,
              theirs.data.arguments,
            ],
          });
        }
      }

      // Connections: the ones Ask AI's change touches are its own, every other is as saved now.
      const touches: (connection: string) => boolean = (
        connection: string,
      ): boolean => {
        const [from, , to] = connection.split(">");
        return (
          generated.askAiTouches.has(from as string) ||
          generated.askAiTouches.has(to as string)
        );
      };

      expect({ round, connections: connectionsOf(rebased) }).toEqual({
        round,
        connections: [
          ...connectionsOf(generated.current).filter((connection: string) => {
            return !touches(connection);
          }),
          ...connectionsOf(askAi).filter(touches),
        ].sort(),
      });
    }

    // Every way it can go, many times over.
    expect(counts["met"]).toBeGreaterThan(100);
    expect(counts["rebased"]).toBeGreaterThan(150);
    expect(counts["rebasedOverAChange"]).toBeGreaterThan(50);
    expect(counts["rebasedOverAMove"]).toBeGreaterThan(20);
    expect(counts["nobodySaved"]).toBeGreaterThan(20);
  });
});
