import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import {
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  UPDATE_WORKFLOW_PROBLEMS,
  UpdateWorkflowTool,
  describeStepsChangedSince,
  fingerprintWorkflowStep,
  getWorkflowComponent,
} from "../../../../Server/Utils/AI/Toolbox/WorkflowBuilderTools";
import TokenSigningKey from "../../../../Server/Utils/TokenSigningKey";
import {
  AI_ACTION_CARD_LINES,
  AIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ConflictException from "../../../../Types/Exception/ConflictException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import {
  WorkflowDraft,
  WorkflowDraftConnection,
  WorkflowDraftStep,
  buildGraphFromDraft,
  getDraftFromGraph,
} from "../../../../Types/Workflow/WorkflowDraft";
import {
  WORKFLOW_DRAFT_PROPOSED_ON_KEY,
  WorkflowDraftProposedOn,
  fingerprintWorkflowSteps,
  getStepsTouchedByDraft,
  readWorkflowDraftProposedOn,
} from "../../../../Types/Workflow/WorkflowDraftRebase";
import { WORKFLOW_GRAPH_REVISION_KEY } from "../../../../Types/Workflow/WorkflowGraphRevision";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";

/*
 * ISSUE #6274: the person asks Ask AI for a change to a workflow, and
 * someone saves the workflow before the person approves it - a teammate,
 * the API, or the person in the Builder beside the panel. Approving never
 * takes their save out: the change is made on top of it when the two touch
 * different steps, and not at all when they meet, saying so, so Ask AI
 * proposes it again on the workflow as it is.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e8000000-0000-4000-8000-0000000062a1",
);
const USER_ID: ObjectID = new ObjectID("e8000000-0000-4000-8000-0000000062b1");
const WORKFLOW_ID: ObjectID = new ObjectID(
  "e8000000-0000-4000-8000-0000000062c1",
);

const CTX: ToolContext = {
  projectId: PROJECT_ID,
  props: { tenantId: PROJECT_ID, userId: USER_ID, userType: UserType.User },
};

let nextId: number = 0;

const generateId: () => string = (): string => {
  nextId++;
  return `fixture-${nextId}`;
};

const graphOf: (
  draft: WorkflowDraft,
  existingGraph?: JSONObject | undefined,
) => JSONObject = (
  draft: WorkflowDraft,
  existingGraph?: JSONObject | undefined,
): JSONObject => {
  return buildGraphFromDraft({
    draft: draft,
    getComponent: getWorkflowComponent,
    generateId: generateId,
    existingGraph: existingGraph,
  });
};

const readBack: (graph: JSONObject) => WorkflowDraft = (
  graph: JSONObject,
): WorkflowDraft => {
  return getDraftFromGraph({ graph: graph, getComponent: getWorkflowComponent });
};

const copyOf: (graph: JSONObject) => JSONObject = (
  graph: JSONObject,
): JSONObject => {
  return JSON.parse(JSON.stringify(graph)) as JSONObject;
};

interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: {
    id: string;
    metadataId: string;
    arguments: JSONObject;
    internalId: string;
    nodeType: string;
    componentType: string;
  };
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

const nodeOf: (graph: JSONObject, stepId: string) => GraphNode | undefined = (
  graph: JSONObject,
  stepId: string,
): GraphNode | undefined => {
  return nodesOf(graph).find((node: GraphNode): boolean => {
    return node.data.id === stepId;
  });
};

const stepIdsOf: (graph: JSONObject) => Array<string> = (
  graph: JSONObject,
): Array<string> => {
  return nodesOf(graph)
    .map((node: GraphNode): string => {
      return node.data.id;
    })
    .sort();
};

// A Log step someone else adds in the Builder, after another step.
const addLogElsewhere: (data: {
  graph: JSONObject;
  stepId: string;
  after: string;
  value: string;
}) => void = (data: {
  graph: JSONObject;
  stepId: string;
  after: string;
  value: string;
}): void => {
  nodesOf(data.graph).push({
    id: `canvas-${data.stepId}`,
    position: { x: 700, y: 700 },
    data: {
      id: data.stepId,
      metadataId: ComponentID.Log,
      arguments: { value: data.value },
      internalId: `runner-${data.stepId}`,
      nodeType: "Node",
      componentType: "Component",
    },
  });
  edgesOf(data.graph).push({
    id: `edge-${data.stepId}`,
    source: nodeOf(data.graph, data.after)!.id,
    target: `canvas-${data.stepId}`,
    sourceHandle: "out",
    targetHandle: "in",
  });
};

const removeElsewhere: (graph: JSONObject, stepId: string) => void = (
  graph: JSONObject,
  stepId: string,
): void => {
  const node: GraphNode = nodeOf(graph, stepId)!;
  graph["nodes"] = nodesOf(graph).filter((each: GraphNode) => {
    return each !== node;
  }) as unknown as JSONObject;
  graph["edges"] = edgesOf(graph).filter((edge: GraphEdge) => {
    return edge.source !== node.id && edge.target !== node.id;
  }) as unknown as JSONObject;
};

// The workflow when Ask AI is asked: its webhook leads to a Log, and to another.
const BASE_DRAFT: WorkflowDraft = {
  steps: [
    { id: "webhook-1", componentId: ComponentID.Webhook },
    { id: "log-a", componentId: ComponentID.Log, arguments: { value: "a" } },
    { id: "log-d", componentId: ComponentID.Log, arguments: { value: "d" } },
  ],
  connections: [
    { from: "webhook-1", to: "log-a" },
    { from: "webhook-1", to: "log-d" },
  ],
};

let BASE: JSONObject = {};

// What Ask AI proposes: a Log after Log a.
const ADD_LOG_B: () => JSONObject = (): JSONObject => {
  const draft: WorkflowDraft = readBack(BASE);

  return {
    steps: [
      ...draft.steps,
      { id: "log-b", componentId: ComponentID.Log, arguments: { value: "b" } },
    ],
    connections: [...draft.connections, { from: "log-a", to: "log-b" }],
  } as unknown as JSONObject;
};

// The workflow as WorkflowService reads it to the person.
const stored: (graph: JSONObject, revision: number) => Workflow = (
  graph: JSONObject,
  revision: number,
): Workflow => {
  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.name = "Tickets";
  workflow.isEnabled = false;
  workflow.isArchived = false;
  workflow.graph = copyOf(graph);
  workflow.graphRevision = revision;
  return workflow;
};

interface RecordedSpy {
  mock: { calls: Array<Array<any>> };
  mockResolvedValue: (value: unknown) => unknown;
  mockResolvedValueOnce: (value: unknown) => RecordedSpy;
  mockRejectedValue: (value: unknown) => unknown;
  mockRejectedValueOnce: (value: unknown) => RecordedSpy;
  mockImplementation: (fn: (...args: Array<any>) => unknown) => unknown;
}

let read: RecordedSpy;
let update: RecordedSpy;

beforeEach(() => {
  nextId = 0;
  BASE = graphOf(BASE_DRAFT);
  read = jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockResolvedValue(stored(BASE, 7) as never) as unknown as RecordedSpy;
  update = jest
    .spyOn(WorkflowService as never, "updateOneById")
    .mockResolvedValue(1 as never) as unknown as RecordedSpy;
});

afterEach(() => {
  jest.restoreAllMocks();
});

const prepare: (args: JSONObject) => Promise<PreparedMutation> = async (
  args: JSONObject,
): Promise<PreparedMutation> => {
  return await UpdateWorkflowTool.prepareMutation!(
    { workflowId: WORKFLOW_ID.toString(), ...args },
    CTX,
  );
};

const approve: (prepared: PreparedMutation) => Promise<ToolExecutionResult> =
  async (prepared: PreparedMutation): Promise<ToolExecutionResult> => {
    return await UpdateWorkflowTool.execute(prepared.arguments, CTX);
  };

const proposedOnOf: (prepared: PreparedMutation) => WorkflowDraftProposedOn = (
  prepared: PreparedMutation,
): WorkflowDraftProposedOn => {
  return readWorkflowDraftProposedOn(
    prepared.arguments[WORKFLOW_DRAFT_PROPOSED_ON_KEY],
  ) as WorkflowDraftProposedOn;
};

const refusalOf: (approval: Promise<unknown>) => Promise<unknown> = async (
  approval: Promise<unknown>,
): Promise<unknown> => {
  try {
    await approval;
  } catch (error) {
    return error;
  }

  return null;
};

const savedGraph: (call: number) => JSONObject = (call: number): JSONObject => {
  return update.mock.calls[call]![0].data.graph as JSONObject;
};

interface CardData {
  words: { line: Array<AIActionSentence> };
  fields: Array<{ label: string; value: string }>;
}

const cardOf: (result: ToolExecutionResult) => CardData = (
  result: ToolExecutionResult,
): CardData => {
  return (result.widget as unknown as { data: CardData }).data;
};

const cardLineOf: (result: ToolExecutionResult) => Array<string> = (
  result: ToolExecutionResult,
): Array<string> => {
  return cardOf(result).words.line.map((sentence: AIActionSentence): string => {
    return sentence.template;
  });
};

describe("what a change is proposed on", () => {
  test("the prepare writes the revision it read, and a fingerprint of each step the change touches", async () => {
    const prepared: PreparedMutation = await prepare(ADD_LOG_B());
    const proposedOn: WorkflowDraftProposedOn = proposedOnOf(prepared);

    expect(proposedOn.graphRevision).toBe(7);
    expect(
      proposedOn.steps.map((step: { id: string; fingerprint: unknown }) => {
        return [step.id, typeof step.fingerprint];
      }),
    ).toEqual([
      ["log-a", "string"],
      // A step the workflow did not have.
      ["log-b", "object"],
    ]);
    expect(proposedOn.steps[1]!.fingerprint).toBeNull();
    // Read as the person.
    expect(read.mock.calls[0]![0].props).toBe(CTX.props);
    expect(read.mock.calls[0]![0].select.graphRevision).toBe(true);
  });

  test("what the model sent for it is overwritten: it could only make a stale change look current", async () => {
    const prepared: PreparedMutation = await prepare({
      ...ADD_LOG_B(),
      [WORKFLOW_DRAFT_PROPOSED_ON_KEY]: { graphRevision: 9000, steps: [] },
    });

    expect(proposedOnOf(prepared).graphRevision).toBe(7);
    expect(proposedOnOf(prepared).steps.length).toBe(2);
  });

  test("a workflow that cannot be read keeps nothing of the model's", async () => {
    read.mockRejectedValue(new Error("Not allowed"));

    const prepared: PreparedMutation = await prepare({
      ...ADD_LOG_B(),
      [WORKFLOW_DRAFT_PROPOSED_ON_KEY]: { graphRevision: 7, steps: [] },
    });

    expect(prepared.arguments[WORKFLOW_DRAFT_PROPOSED_ON_KEY]).toBeUndefined();
  });

  test("a change of the name alone is proposed on nothing", async () => {
    const prepared: PreparedMutation = await prepare({ name: "Renamed" });

    expect(prepared.arguments[WORKFLOW_DRAFT_PROPOSED_ON_KEY]).toBeUndefined();
  });

  test("a draft that cannot be saved is proposed on nothing: it is refused when it runs", async () => {
    const prepared: PreparedMutation = await prepare({
      steps: [{ id: "x", componentId: "no-such-thing" }],
      connections: [],
    });

    expect(prepared.arguments[WORKFLOW_DRAFT_PROPOSED_ON_KEY]).toBeUndefined();
    await expect(approve(prepared)).rejects.toThrow("no-such-thing");
    expect(update.mock.calls).toHaveLength(0);
  });

  test("a fingerprint is keyed with the installation's own key, for this alone", () => {
    const derive: RecordedSpy = jest.spyOn(
      TokenSigningKey,
      "deriveKey",
    ) as unknown as RecordedSpy;
    const fingerprint: string = fingerprintWorkflowStep("a step");

    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintWorkflowStep("a step")).toBe(fingerprint);
    expect(fingerprintWorkflowStep("another step")).not.toBe(fingerprint);
    expect(derive.mock.calls[0]![0]).toBe("workflow-draft-step-fingerprint");
    // Not the plain digest anybody could work out from what the model was shown.
    expect(fingerprint).not.toBe(
      crypto.createHash("sha256").update("a step").digest("hex").slice(0, 16),
    );

    jest.spyOn(TokenSigningKey, "get").mockReturnValue("another key");
    expect(fingerprintWorkflowStep("a step")).not.toBe(fingerprint);
  });
});

describe("approved with nobody saving in between", () => {
  test("one write, exactly as before, held to the revision it was proposed on", async () => {
    const result: ToolExecutionResult = await approve(
      await prepare(ADD_LOG_B()),
    );

    expect(update.mock.calls).toHaveLength(1);
    expect(update.mock.calls[0]![0].miscDataProps).toEqual({
      [WORKFLOW_GRAPH_REVISION_KEY]: 7,
    });
    expect(readBack(savedGraph(0))).toEqual(
      readBack(graphOf(ADD_LOG_B() as unknown as WorkflowDraft, BASE)),
    );
    expect(result.dataForLlm).not.toContain("saved again");
    expect(cardLineOf(result)).not.toContain(
      AI_ACTION_CARD_LINES.workflowSavedSinceKept,
    );
  });

  test("a name and the steps together are one write", async () => {
    await approve(await prepare({ ...ADD_LOG_B(), name: "Renamed" }));

    expect(update.mock.calls).toHaveLength(1);
    expect(update.mock.calls[0]![0].data.name).toBe("Renamed");
    expect(update.mock.calls[0]![0].data.graph).toBeDefined();
    expect(update.mock.calls[0]![0].miscDataProps).toEqual({
      [WORKFLOW_GRAPH_REVISION_KEY]: 7,
    });
  });

  test("a change of the name alone names no revision: it saves no graph", async () => {
    await approve(await prepare({ name: "Renamed" }));

    expect(update.mock.calls).toHaveLength(1);
    expect(update.mock.calls[0]![0].data).toEqual({ name: "Renamed" });
    expect(update.mock.calls[0]![0].miscDataProps).toBeUndefined();
  });
});

describe("approved after someone saved the workflow", () => {
  test("they added a step elsewhere: approving keeps it, makes Ask AI's change on top, and says so", async () => {
    const prepared: PreparedMutation = await prepare(ADD_LOG_B());
    const theirs: JSONObject = copyOf(BASE);
    addLogElsewhere({
      graph: theirs,
      stepId: "log-c",
      after: "log-d",
      value: "c",
    });
    read.mockResolvedValue(stored(theirs, 8));

    const result: ToolExecutionResult = await approve(prepared);

    expect(update.mock.calls).toHaveLength(1);
    // Held to their revision: nothing lands over a save it did not see.
    expect(update.mock.calls[0]![0].miscDataProps).toEqual({
      [WORKFLOW_GRAPH_REVISION_KEY]: 8,
    });

    const saved: JSONObject = savedGraph(0);

    expect(stepIdsOf(saved)).toEqual([
      "log-a",
      "log-b",
      "log-c",
      "log-d",
      "webhook-1",
    ]);
    // Theirs, exactly as they saved it.
    expect(nodeOf(saved, "log-c")).toMatchObject({
      id: "canvas-log-c",
      position: { x: 700, y: 700 },
      data: { arguments: { value: "c" }, internalId: "runner-log-c" },
    });
    // Ask AI's, as the card said.
    expect(nodeOf(saved, "log-b")!.data.arguments).toEqual({ value: "b" });

    expect(result.dataForLlm).toContain(
      "It had been saved again after this change was proposed (it added Log)",
    );
    expect(result.dataForLlm).toContain("so it was kept");
    expect(cardLineOf(result)).toContain(
      AI_ACTION_CARD_LINES.workflowSavedSinceKept,
    );

    // The card's steps are the workflow's now, theirs among them.
    expect(
      cardOf(result).fields.find((field: { label: string }) => {
        return field.label === "Workflow steps";
      })?.value,
    ).toBe("Webhook, Log, Log, Log, Log");
  });

  test("they moved the card Ask AI changes: the move is kept, with Ask AI's change", async () => {
    const prepared: PreparedMutation = await prepare(ADD_LOG_B());
    const theirs: JSONObject = copyOf(BASE);
    nodeOf(theirs, "log-a")!.position = { x: 5, y: 5 };
    read.mockResolvedValue(stored(theirs, 8));

    await approve(prepared);

    expect(nodeOf(savedGraph(0), "log-a")!.position).toEqual({ x: 5, y: 5 });
    expect(stepIdsOf(savedGraph(0))).toContain("log-b");
  });

  test("they changed the step Ask AI's change leaves from: nothing is written, and the model is told to propose it again", async () => {
    const prepared: PreparedMutation = await prepare(ADD_LOG_B());
    const theirs: JSONObject = copyOf(BASE);
    nodeOf(theirs, "log-a")!.data.arguments = { value: "theirs" };
    read.mockResolvedValue(stored(theirs, 8));

    const refusal: unknown = await refusalOf(approve(prepared));

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).message).toBe(
      describeStepsChangedSince('"Log" (log-a)'),
    );
    expect((refusal as ConflictException).message).toContain(
      "nothing was changed",
    );
    expect((refusal as ConflictException).message).toContain(
      "propose the change again on the workflow as it is now",
    );
    expect(update.mock.calls).toHaveLength(0);
  });

  test("a revision the model sent never makes a stale change current: their change is still not replaced", async () => {
    const theirs: JSONObject = copyOf(BASE);
    nodeOf(theirs, "log-a")!.data.arguments = { value: "theirs" };

    // The model claims the revision the workflow is about to be at.
    const prepared: PreparedMutation = await prepare({
      ...ADD_LOG_B(),
      [WORKFLOW_DRAFT_PROPOSED_ON_KEY]: { graphRevision: 8, steps: [] },
    });
    read.mockResolvedValue(stored(theirs, 8));

    expect(await refusalOf(approve(prepared))).toBeInstanceOf(
      ConflictException,
    );
    expect(update.mock.calls).toHaveLength(0);
  });

  test("made on top, the two would leave something to fix neither had: nothing is written", async () => {
    // Ask AI takes out Log a.
    const draft: WorkflowDraft = readBack(BASE);
    const prepared: PreparedMutation = await prepare({
      steps: draft.steps.filter((step: WorkflowDraftStep) => {
        return step.id !== "log-a";
      }),
      connections: draft.connections.filter(
        (connection: WorkflowDraftConnection) => {
          return connection.to !== "log-a";
        },
      ),
    } as unknown as JSONObject);

    // Someone adds, elsewhere, a step that reads what Log a gave.
    const theirs: JSONObject = copyOf(BASE);
    addLogElsewhere({
      graph: theirs,
      stepId: "log-e",
      after: "log-d",
      value: "{{local.components.log-a.returnValues.value}}",
    });
    read.mockResolvedValue(stored(theirs, 8));

    const refusal: unknown = await refusalOf(approve(prepared));

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).message).toContain(
      "would leave something to fix that neither had on its own: log-e:",
    );
    expect(update.mock.calls).toHaveLength(0);
  });

  test("a save landing between Ask AI's read and its write is refused by the service: read again, made on top of it, saved", async () => {
    const prepared: PreparedMutation = await prepare(ADD_LOG_B());
    const theirs: JSONObject = copyOf(BASE);
    addLogElsewhere({
      graph: theirs,
      stepId: "log-c",
      after: "log-d",
      value: "c",
    });

    // The approval reads revision 7; someone saves before its write lands.
    read
      .mockResolvedValueOnce(stored(BASE, 7))
      .mockResolvedValueOnce(stored(theirs, 8));
    update.mockRejectedValueOnce(
      new ConflictException("Someone else saved this workflow's graph."),
    );

    await approve(prepared);

    expect(update.mock.calls).toHaveLength(2);
    expect(update.mock.calls[0]![0].miscDataProps).toEqual({
      [WORKFLOW_GRAPH_REVISION_KEY]: 7,
    });
    expect(update.mock.calls[1]![0].miscDataProps).toEqual({
      [WORKFLOW_GRAPH_REVISION_KEY]: 8,
    });
    expect(stepIdsOf(savedGraph(1))).toEqual([
      "log-a",
      "log-b",
      "log-c",
      "log-d",
      "webhook-1",
    ]);
  });

  test("a workflow saved under it again and again: three tries, then nothing is made, saying why", async () => {
    const prepared: PreparedMutation = await prepare(ADD_LOG_B());
    update.mockRejectedValue(new ConflictException("Saved meanwhile."));

    const refusal: unknown = await refusalOf(approve(prepared));

    expect(refusal).toEqual(
      new ConflictException(UPDATE_WORKFLOW_PROBLEMS.keptBeingSaved),
    );
    expect(update.mock.calls).toHaveLength(3);
  });

  test("a refusal for anything else is not tried again", async () => {
    const prepared: PreparedMutation = await prepare(ADD_LOG_B());
    update.mockRejectedValue(new BadDataException("Not allowed"));

    expect(await refusalOf(approve(prepared))).toEqual(
      new BadDataException("Not allowed"),
    );
    expect(update.mock.calls).toHaveLength(1);
  });

  test("archived meanwhile: refused, saying what to do", async () => {
    const prepared: PreparedMutation = await prepare(ADD_LOG_B());
    const archived: Workflow = stored(BASE, 8);
    archived.isArchived = true;
    read.mockResolvedValue(archived);

    await expect(approve(prepared)).rejects.toThrow("archived");
    expect(update.mock.calls).toHaveLength(0);
  });

  test("a change to the steps with no record of what it was proposed on is refused: one proposed before OneUptime kept one", async () => {
    const refusal: unknown = await refusalOf(
      UpdateWorkflowTool.execute(
        { workflowId: WORKFLOW_ID.toString(), ...ADD_LOG_B() },
        CTX,
      ),
    );

    expect(refusal).toEqual(
      new BadDataException(UPDATE_WORKFLOW_PROBLEMS.notProposed),
    );
    expect(update.mock.calls).toHaveLength(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Races, at random: a stand-in for WorkflowService that refuses what it
 * refuses - a save of the graph made to another revision than the workflow
 * is at - and counts every graph save. Teammates save before the approval,
 * and between the approval's read and its write.
 * ---------------------------------------------------------------------------
 */

interface Server {
  graph: JSONObject;
  revision: number;
  // What the teammates' saves left, applied in order: the workflow without Ask AI.
  withoutAskAi: JSONObject;
}


type TeammateSaveFunction = (
  graph: JSONObject,
  random: SeededRandom,
  label: string,
) => void;

// A teammate's save in the Builder: a step added, a value changed, a card moved, a step taken out.
const teammateSave: TeammateSaveFunction = (
  graph: JSONObject,
  random: SeededRandom,
  label: string,
): void => {
  const steps: Array<GraphNode> = nodesOf(graph);
  const logs: Array<GraphNode> = steps.filter((node: GraphNode) => {
    return node.data.metadataId === ComponentID.Log;
  });
  const kind: number = random(4);

  if (kind === 0 || logs.length === 0) {
    addLogElsewhere({
      graph,
      stepId: `log-${label}`,
      after: steps[random(steps.length)]!.data.id,
      value: label,
    });
  } else if (kind === 1) {
    logs[random(logs.length)]!.data.arguments = { value: `theirs ${label}` };
  } else if (kind === 2) {
    const node: GraphNode = steps[random(steps.length)]!;
    node.position = { x: node.position.x + 40, y: node.position.y + 8 };
  } else {
    removeElsewhere(graph, logs[random(logs.length)]!.data.id);
  }
};

// Ask AI's change, as the model writes it from the workflow it read.
const askAiDraft: (base: JSONObject, random: SeededRandom) => WorkflowDraft = (
  base: JSONObject,
  random: SeededRandom,
): WorkflowDraft => {
  const draft: WorkflowDraft = readBack(base);
  const kind: number = random(3);
  const logs: Array<string> = draft.steps
    .filter((step: WorkflowDraftStep) => {
      return step.componentId === ComponentID.Log;
    })
    .map((step: WorkflowDraftStep) => {
      return step.id;
    });

  if (kind === 0 || logs.length === 0) {
    const after: string = draft.steps[random(draft.steps.length)]!.id;
    return {
      steps: [
        ...draft.steps,
        {
          id: "log-ai",
          componentId: ComponentID.Log,
          arguments: { value: "Ask AI's" },
        },
      ],
      connections: [...draft.connections, { from: after, to: "log-ai" }],
    };
  }

  const target: string = logs[random(logs.length)]!;

  if (kind === 1) {
    return {
      ...draft,
      steps: draft.steps.map((step: WorkflowDraftStep) => {
        return step.id === target
          ? { ...step, arguments: { value: "Ask AI's value" } }
          : step;
      }),
    };
  }

  return {
    steps: draft.steps.filter((step: WorkflowDraftStep) => {
      return step.id !== target;
    }),
    connections: draft.connections.filter(
      (connection: WorkflowDraftConnection) => {
        return connection.from !== target && connection.to !== target;
      },
    ),
  };
};

const testDigest: (text: string) => string = fingerprintWorkflowStep;

describe("races between Ask AI's approval and teammates' saves, at random", () => {
  test("Ask AI's save never lands over a save it did not account for, nothing a teammate saved is lost, and a change is refused only when the two meet or the workflow kept being saved", async () => {
    const random: SeededRandom = seededRandom(6274);
    const counts: { [outcome: string]: number } = {
      straight: 0,
      madeOnTop: 0,
      madeOnTopAfterARefusedWrite: 0,
      met: 0,
      keptBeingSaved: 0,
      leftSomethingToFix: 0,
    };

    for (let round: number = 0; round < 250; round++) {
      nextId = 0;
      const base: JSONObject = graphOf({
        steps: BASE_DRAFT.steps,
        connections: BASE_DRAFT.connections,
      });
      const server: Server = {
        graph: copyOf(base),
        revision: 3 + random(5),
        withoutAskAi: copyOf(base),
      };

      /*
       * A teammate's save, of the graph the server has: until Ask AI's write
       * lands, that is the teammates' graph alone.
       */
      const teammate: (label: string) => void = (label: string): void => {
        teammateSave(server.graph, random, label);
        server.revision++;
        server.withoutAskAi = copyOf(server.graph);
      };

      read.mockImplementation(async () => {
        return stored(server.graph, server.revision);
      });

      const draft: WorkflowDraft = askAiDraft(base, random);
      const prepared: PreparedMutation = await prepare(
        draft as unknown as JSONObject,
      );
      const touched: Array<string> = getStepsTouchedByDraft({
        draft,
        graph: base,
        getComponent: getWorkflowComponent,
        generateId,
      });

      // Saves between the proposal and the approval.
      const before: number = random(3);
      for (let save: number = 0; save < before; save++) {
        teammate(`r${round}b${save}`);
      }

      // Saves that land between the approval's read and its write.
      let between: number = random(5) === 0 ? 1 + random(4) : 0;
      let refusedWrites: number = 0;
      const writes: Array<{ basedOn: unknown; revisionThen: number }> = [];

      update.mockImplementation(async (request: JSONObject) => {
        if (between > 0) {
          between--;
          teammate(`r${round}w${between}`);
        }

        const basedOn: unknown = (request["miscDataProps"] as JSONObject)?.[
          WORKFLOW_GRAPH_REVISION_KEY
        ];
        writes.push({ basedOn, revisionThen: server.revision });

        if (typeof basedOn === "number" && basedOn !== server.revision) {
          refusedWrites++;
          throw new ConflictException("Someone else saved this workflow.");
        }

        const data: JSONObject = request["data"] as JSONObject;
        server.graph = copyOf(data["graph"] as JSONObject);
        server.revision++;
        return 1;
      });

      const refusal: unknown = await refusalOf(approve(prepared));

      // Every write named a revision, and none landed on another.
      for (const write of writes) {
        expect(typeof write.basedOn).toBe("number");
      }

      const theirs: JSONObject = server.withoutAskAi;
      const changedSince: Array<string> = touched.filter((id: string) => {
        return (
          fingerprintWorkflowSteps({
            graph: base,
            stepIds: [id],
            digest: testDigest,
          })[0]!.fingerprint !==
          fingerprintWorkflowSteps({
            graph: theirs,
            stepIds: [id],
            digest: testDigest,
          })[0]!.fingerprint
        );
      });

      if (refusal) {
        expect({ round, refusal }).toEqual({
          round,
          refusal: expect.any(ConflictException),
        });

        // Nothing of Ask AI's was saved: the workflow is the teammates' alone.
        expect({ round, graph: readBack(server.graph) }).toEqual({
          round,
          graph: readBack(theirs),
        });

        const message: string = (refusal as ConflictException).message;

        if (message === UPDATE_WORKFLOW_PROBLEMS.keptBeingSaved) {
          counts["keptBeingSaved"]!++;
          expect(refusedWrites).toBe(3);
        } else if (message.includes("leave something to fix")) {
          counts["leftSomethingToFix"]!++;
        } else {
          counts["met"]!++;
          expect({ round, met: changedSince.length > 0 }).toEqual({
            round,
            met: true,
          });
        }

        continue;
      }

      // Made: so the two did not meet.
      expect({ round, changedSince }).toEqual({ round, changedSince: [] });

      if (before === 0 && refusedWrites === 0) {
        counts["straight"]!++;
      } else if (refusedWrites > 0) {
        counts["madeOnTopAfterARefusedWrite"]!++;
      } else {
        counts["madeOnTop"]!++;
      }

      // Every step: Ask AI's where its change touches, the teammates' everywhere else.
      const askAi: JSONObject = graphOf(draft, base);
      const made: JSONObject = server.graph;

      for (const id of new Set<string>([
        ...stepIdsOf(made),
        ...stepIdsOf(theirs),
        ...stepIdsOf(askAi),
      ])) {
        const source: JSONObject = touched.includes(id) ? askAi : theirs;
        const expected: GraphNode | undefined = nodeOf(source, id);
        const actual: GraphNode | undefined = nodeOf(made, id);

        expect({
          round,
          id,
          step: actual
            ? [actual.data.metadataId, actual.data.arguments]
            : null,
        }).toEqual({
          round,
          id,
          step: expected
            ? [expected.data.metadataId, expected.data.arguments]
            : null,
        });

        // Whatever the teammates moved stays where they put it.
        const theirCard: GraphNode | undefined = nodeOf(theirs, id);

        if (actual && theirCard && actual.data.metadataId === theirCard.data.metadataId) {
          expect({ round, id, at: actual.position }).toEqual({
            round,
            id,
            at: theirCard.position,
          });
        }
      }
    }

    expect(counts["straight"]).toBeGreaterThan(20);
    expect(counts["madeOnTop"]).toBeGreaterThan(20);
    expect(counts["madeOnTopAfterARefusedWrite"]).toBeGreaterThan(3);
    expect(counts["met"]).toBeGreaterThan(20);
  });
});
