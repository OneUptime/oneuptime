import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowLogService from "../../../../Server/Services/WorkflowLogService";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import {
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  CreateWorkflowTool,
  UNSEEN_CHANGE_SUMMARIES,
  UpdateWorkflowTool,
  describeSavedSinceRead,
  describeStepsNotRead,
  fingerprintWorkflowStep,
  getWorkflowComponent,
  getWorkflowSeen,
} from "../../../../Server/Utils/AI/Toolbox/WorkflowBuilderTools";
import { QueryWorkflowsTool } from "../../../../Server/Utils/AI/Toolbox/WorkflowProbeTools";
import {
  AI_ACTION_LINES,
  AIActionSentence,
  describeAIActionSentence,
  describeAIActionWords,
} from "../../../../Types/AI/AIActionWords";
import {
  AIChatRecordSeen,
  AIChatRecordSeenType,
} from "../../../../Types/AI/AIChatRecordSeen";
import ConflictException from "../../../../Types/Exception/ConflictException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import { NodeType } from "../../../../Types/Workflow/Component";
import {
  WorkflowDraft,
  WorkflowDraftConnection,
  WorkflowDraftStep,
  buildGraphFromDraft,
  checkWorkflowDraft,
  getDraftFromGraph,
  getDraftValueKey,
} from "../../../../Types/Workflow/WorkflowDraft";
import { WORKFLOW_DRAFT_PROPOSED_ON_KEY } from "../../../../Types/Workflow/WorkflowDraftProposedOnKey";
import {
  WorkflowDraftProposedOn,
  readWorkflowDraftProposedOn,
} from "../../../../Types/Workflow/WorkflowDraftRebase";
import {
  WorkflowPartSeen,
  seeWorkflowParts,
} from "../../../../Types/Workflow/WorkflowDraftSeen";
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

/*
 * ISSUE #6291: Ask AI writes a change to a workflow from what it last saw of
 * its steps - its read, or the workflow as it created or changed it itself
 * - and the person or a teammate may have saved the workflow since. The
 * draft knows nothing of their save: approved, it would take their step out
 * again, or put an old setting back. #6290 made the approval safe against
 * saves between the proposal and the approval; this is the window before
 * the proposal.
 *
 * OneUptime keeps what each result showed the model (the citation's
 * recordSeen) - never anything the model says - and before anyone approves
 * the change, its card names what it would undo that was saved since. With
 * nothing saved since - or only cards moved, or a step changed that the
 * change keeps - the card is exactly as it was. The line only ever adds to
 * the card: what runs, and #6290's check, are as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e8000000-0000-4000-8000-0000000062d1",
);
const USER_ID: ObjectID = new ObjectID("e8000000-0000-4000-8000-0000000062d2");
const WORKFLOW_ID: ObjectID = new ObjectID(
  "e8000000-0000-4000-8000-0000000062d3",
);
const OTHER_WORKFLOW_ID: string = "e8000000-0000-4000-8000-0000000062d4";

const CTX: ToolContext = {
  projectId: PROJECT_ID,
  props: { tenantId: PROJECT_ID, userId: USER_ID, userType: UserType.User },
};

let nextId: number = 0;

const generateId: () => string = (): string => {
  nextId++;
  return `fixture-${nextId}`;
};

const graphOf: (draft: WorkflowDraft, existing?: JSONObject) => JSONObject = (
  draft: WorkflowDraft,
  existing?: JSONObject,
): JSONObject => {
  return buildGraphFromDraft({
    draft: draft,
    getComponent: getWorkflowComponent,
    generateId: generateId,
    existingGraph: existing,
  });
};

const readBack: (graph: JSONObject) => WorkflowDraft = (
  graph: JSONObject,
): WorkflowDraft => {
  return getDraftFromGraph({
    graph: graph,
    getComponent: getWorkflowComponent,
  });
};

const copyOf: <T>(value: T) => T = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
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

/*
 * ---------------------------------------------------------------------------
 * The workflow, as WorkflowService keeps it: a stand-in that counts every
 * save of the graph, and refuses one held to another revision (#6257).
 * ---------------------------------------------------------------------------
 */

interface Server {
  graph: JSONObject;
  revision: number;
  isEnabled: boolean;
}

let server: Server;

// What the conversation showed the model, as the chat runner keeps it.
let records: Array<AIChatRecordSeen>;

/*
 * The record a workflow's tool kept: one. Only a commit keeps a list, of the
 * files it wrote (ToolExecutionResult.recordSeen).
 */
const workflowSeen: (result: ToolExecutionResult) => AIChatRecordSeen = (
  result: ToolExecutionResult,
): AIChatRecordSeen => {
  const seen: AIChatRecordSeen | Array<AIChatRecordSeen> | undefined =
    result.recordSeen;

  if (!seen || Array.isArray(seen)) {
    throw new Error(`Expected one record seen, got ${JSON.stringify(seen)}`);
  }

  return seen;
};

const stored: () => Workflow = (): Workflow => {
  const workflow: Workflow = new Workflow();
  workflow.id = WORKFLOW_ID;
  workflow.name = "Tickets";
  workflow.description = "Opens a ticket for every new incident";
  workflow.isEnabled = server.isEnabled;
  workflow.isArchived = false;
  workflow.graph = copyOf(server.graph);
  workflow.graphRevision = server.revision;
  return workflow;
};

// Saves in the Builder, by the person beside the panel or a teammate.
const builder: {
  addSlackAfter: (after: string) => void;
  addLogAfter: (after: string, stepId: string, value: string) => void;
  setValue: (stepId: string, value: string) => void;
  move: (stepId: string) => void;
  remove: (stepId: string) => void;
  connect: (from: string, to: string) => void;
} = {
  addSlackAfter: (after: string): void => {
    nodesOf(server.graph).push({
      id: "canvas-slack-1",
      position: { x: 700, y: 700 },
      data: {
        id: "slack-1",
        metadataId: ComponentID.SlackSendMessageToChannel,
        arguments: { text: "A ticket was opened" },
        internalId: "runner-slack-1",
        nodeType: NodeType.Node,
        componentType: "Component",
      },
    });
    edgesOf(server.graph).push({
      id: "edge-slack-1",
      source: nodeOf(server.graph, after)!.id,
      target: "canvas-slack-1",
      sourceHandle: "out",
      targetHandle: "in",
    });
    server.revision++;
  },
  addLogAfter: (after: string, stepId: string, value: string): void => {
    nodesOf(server.graph).push({
      id: `canvas-${stepId}`,
      position: { x: 900, y: 900 },
      data: {
        id: stepId,
        metadataId: ComponentID.Log,
        arguments: { value: value },
        internalId: `runner-${stepId}`,
        nodeType: NodeType.Node,
        componentType: "Component",
      },
    });
    edgesOf(server.graph).push({
      id: `edge-${stepId}`,
      source: nodeOf(server.graph, after)!.id,
      target: `canvas-${stepId}`,
      sourceHandle: "out",
      targetHandle: "in",
    });
    server.revision++;
  },
  setValue: (stepId: string, value: string): void => {
    nodeOf(server.graph, stepId)!.data.arguments = { value: value };
    server.revision++;
  },
  move: (stepId: string): void => {
    const node: GraphNode = nodeOf(server.graph, stepId)!;
    node.position = { x: node.position.x + 40, y: node.position.y + 8 };
    server.revision++;
  },
  remove: (stepId: string): void => {
    const node: GraphNode = nodeOf(server.graph, stepId)!;
    server.graph["nodes"] = nodesOf(server.graph).filter((each: GraphNode) => {
      return each !== node;
    }) as unknown as JSONValue;
    server.graph["edges"] = edgesOf(server.graph).filter((edge: GraphEdge) => {
      return edge.source !== node.id && edge.target !== node.id;
    }) as unknown as JSONValue;
    server.revision++;
  },
  connect: (from: string, to: string): void => {
    edgesOf(server.graph).push({
      id: `edge-${from}-${to}-${server.revision}`,
      source: nodeOf(server.graph, from)!.id,
      target: nodeOf(server.graph, to)!.id,
      sourceHandle: "out",
      targetHandle: "in",
    });
    server.revision++;
  },
};

interface RecordedSpy {
  mock: { calls: Array<Array<any>> };
  mockResolvedValue: (value: unknown) => unknown;
  mockImplementation: (fn: (...args: Array<any>) => unknown) => unknown;
}

let read: RecordedSpy;
let update: RecordedSpy;
let create: RecordedSpy;

// The workflow when Ask AI is asked: a webhook leading to a Log, and to another.
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

beforeEach(() => {
  nextId = 0;
  records = [];
  server = { graph: graphOf(BASE_DRAFT), revision: 7, isEnabled: false };

  read = jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockImplementation((async () => {
      return stored();
    }) as never) as unknown as RecordedSpy;

  update = jest
    .spyOn(WorkflowService as never, "updateOneById")
    .mockImplementation((async (request: JSONObject) => {
      const heldTo: unknown = (request["miscDataProps"] as JSONObject)?.[
        WORKFLOW_GRAPH_REVISION_KEY
      ];
      if (typeof heldTo === "number" && heldTo !== server.revision) {
        throw new ConflictException("Someone else saved this workflow.");
      }
      const data: JSONObject = request["data"] as JSONObject;
      if (data["graph"]) {
        server.graph = copyOf(data["graph"] as JSONObject);
        server.revision++;
      }
      return 1;
    }) as never) as unknown as RecordedSpy;

  create = jest
    .spyOn(WorkflowService as never, "create")
    .mockImplementation((async (request: { data: Workflow }) => {
      const created: Workflow = request.data;
      created.id = WORKFLOW_ID;
      server = {
        graph: copyOf(created.graph as JSONObject),
        revision: 0,
        isEnabled: false,
      };
      return created;
    }) as never) as unknown as RecordedSpy;

  jest
    .spyOn(WorkflowLogService as never, "findBy")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * The tools, as the chat runner calls them: each result's record kept, and
 * handed to the next prepare.
 * ---------------------------------------------------------------------------
 */

const STEPS_SHOWN: string =
  "Its steps and connections, as update_workflow takes them:\n";

// The model reads the workflow's steps: what it is shown, as it is shown.
const readSteps: () => Promise<WorkflowDraft> =
  async (): Promise<WorkflowDraft> => {
    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
      CTX,
    );

    if (result.recordSeen) {
      records.push(workflowSeen(result));
    }

    const text: string = result.dataForLlm;

    return JSON.parse(
      text.slice(text.indexOf(STEPS_SHOWN) + STEPS_SHOWN.length),
    ) as WorkflowDraft;
  };

const propose: (
  draft: WorkflowDraft | JSONObject,
  extra?: JSONObject,
  recordsSeen?: ReadonlyArray<AIChatRecordSeen> | null,
) => Promise<PreparedMutation> = async (
  draft: WorkflowDraft | JSONObject,
  extra?: JSONObject,
  recordsSeen?: ReadonlyArray<AIChatRecordSeen> | null,
): Promise<PreparedMutation> => {
  return await UpdateWorkflowTool.prepareMutation!(
    {
      workflowId: WORKFLOW_ID.toString(),
      ...(copyOf(draft) as unknown as JSONObject),
      ...(extra || {}),
    },
    recordsSeen === null
      ? CTX
      : { ...CTX, recordsSeen: copyOf(recordsSeen || records) },
  );
};

// As before this issue: a caller that keeps no record of what the model saw.
const proposeAsBefore: (
  draft: WorkflowDraft | JSONObject,
  extra?: JSONObject,
) => Promise<PreparedMutation> = async (
  draft: WorkflowDraft | JSONObject,
  extra?: JSONObject,
): Promise<PreparedMutation> => {
  return await propose(draft, extra, null);
};

const approve: (
  prepared: PreparedMutation,
) => Promise<ToolExecutionResult> = async (
  prepared: PreparedMutation,
): Promise<ToolExecutionResult> => {
  const result: ToolExecutionResult = await UpdateWorkflowTool.execute(
    prepared.arguments,
    CTX,
  );

  if (result.recordSeen) {
    records.push(workflowSeen(result));
  }

  return result;
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

// The card's line under its title, as the English the model and the exports read.
const linesOf: (prepared: PreparedMutation) => Array<string> = (
  prepared: PreparedMutation,
): Array<string> => {
  return (prepared.description || []).map(
    (sentence: AIActionSentence): string => {
      return describeAIActionSentence(sentence);
    },
  );
};

const UNDOES: (steps: string) => string = (steps: string): string => {
  return `This change undoes what was saved after Ask AI read the workflow: ${steps}.`;
};

const NOT_READ: string =
  "Ask AI wrote this change without reading the workflow's steps, so it may remove or change steps it has not seen.";

const proposedOnOf: (prepared: PreparedMutation) => WorkflowDraftProposedOn = (
  prepared: PreparedMutation,
): WorkflowDraftProposedOn => {
  return readWorkflowDraftProposedOn(
    prepared.arguments[WORKFLOW_DRAFT_PROPOSED_ON_KEY],
  ) as WorkflowDraftProposedOn;
};

// What Ask AI proposes, from what it read: a Log after Log a.
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

describe("what Ask AI is shown of a workflow is kept by OneUptime, never by the model", () => {
  test("query_workflows with includeSteps keeps every step and connection it showed, at the revision it read", async () => {
    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
      CTX,
    );

    expect(read.mock.calls[0]![0].select.graph).toBe(true);
    expect(read.mock.calls[0]![0].select.graphRevision).toBe(true);
    // Read as the person.
    expect(read.mock.calls[0]![0].props).toBe(CTX.props);

    expect(result.recordSeen).toEqual(
      getWorkflowSeen({
        workflowId: WORKFLOW_ID.toString(),
        graph: server.graph,
        revision: 7,
      }),
    );
    expect(workflowSeen(result).recordType).toBe(AIChatRecordSeenType.Workflow);
    expect(workflowSeen(result).isPartial).toBeUndefined();
    expect(workflowSeen(result).parts).toEqual(
      seeWorkflowParts({
        graph: server.graph,
        digest: fingerprintWorkflowStep,
      }),
    );

    // The model is shown the steps, never the record of them.
    for (const part of workflowSeen(result).parts) {
      expect(result.dataForLlm).not.toContain(part.fingerprint as string);
    }
  });

  test("its steps' fingerprints are keyed with the installation's own key: a setting cannot be read from them", async () => {
    nodeOf(server.graph, "log-a")!.data.arguments = {
      value: "the password is hunter2",
    };

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
      CTX,
    );

    expect(JSON.stringify(result.recordSeen)).not.toContain("hunter2");
    expect(JSON.stringify(result.recordSeen)).not.toContain("password");
  });

  test("without includeSteps, nothing is kept: the model was shown no steps", async () => {
    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString() },
      CTX,
    );

    expect(result.recordSeen).toBeUndefined();
    expect(read.mock.calls[0]![0].select.graphRevision).toBeUndefined();
  });

  test("steps too long to read here are not shown, so nothing is kept", async () => {
    nodeOf(server.graph, "log-a")!.data.arguments = {
      value: "x".repeat(60 * 1024),
    };

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
      CTX,
    );

    expect(result.dataForLlm).toContain("too long to read here");
    expect(result.recordSeen).toBeUndefined();
  });

  test("a workflow the person cannot read keeps nothing", async () => {
    read.mockResolvedValue(null);

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
      CTX,
    );

    expect(result.recordSeen).toBeUndefined();
  });

  test("a workflow saved before revisions were counted is read at revision 0, as update_workflow reads it", async () => {
    read.mockImplementation(async () => {
      const workflow: Workflow = stored();
      delete workflow.graphRevision;
      return workflow;
    });

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: WORKFLOW_ID.toString(), includeSteps: true },
      CTX,
    );

    expect(workflowSeen(result).revision).toBe(0);
  });

  test("create_workflow keeps the workflow it made, whole, at revision 0", async () => {
    const result: ToolExecutionResult = await CreateWorkflowTool.execute(
      { name: "Tickets", ...(copyOf(BASE_DRAFT) as unknown as JSONObject) },
      CTX,
    );
    const made: JSONObject = create.mock.calls[0]![0].data.graph as JSONObject;

    expect(result.recordSeen).toEqual(
      getWorkflowSeen({
        workflowId: WORKFLOW_ID.toString(),
        graph: made,
        revision: 0,
      }),
    );
  });

  test("a change Ask AI saved keeps what it touched, as saved, at the revision after the one it was held to", async () => {
    const result: ToolExecutionResult = await approve(
      await propose(addLogB(await readSteps())),
    );

    expect(update.mock.calls[0]![0].miscDataProps).toEqual({
      [WORKFLOW_GRAPH_REVISION_KEY]: 7,
    });
    expect(workflowSeen(result).isPartial).toBe(true);
    expect(workflowSeen(result).revision).toBe(8);
    expect(server.revision).toBe(8);

    const saved: Map<string, string | null> = new Map<string, string | null>(
      seeWorkflowParts({
        graph: server.graph,
        digest: fingerprintWorkflowStep,
      }).map((part: WorkflowPartSeen): [string, string | null] => {
        return [part.id, part.fingerprint];
      }),
    );

    // Log a, and Log b after it: as saved. Nothing else: Ask AI saw the rest when it read.
    expect(
      workflowSeen(result)
        .parts.map((part: { id: string }) => {
          return part.id;
        })
        .sort(),
    ).toEqual(
      [
        "step:log-a",
        "step:log-b",
        'connection:["log-a","out","log-b"]',
        'connection:["webhook-1","out","log-a"]',
      ].sort(),
    );
    for (const part of workflowSeen(result).parts) {
      expect(part.fingerprint).toBe(saved.get(part.id));
    }
  });

  test("a change of the name alone keeps nothing, and a change that was not made keeps nothing", async () => {
    const renamed: ToolExecutionResult = await approve(
      await propose({ name: "Renamed" }),
    );
    expect(renamed.recordSeen).toBeUndefined();

    const prepared: PreparedMutation = await propose({
      ...addLogB(await readSteps()),
    });
    builder.setValue("log-a", "theirs");

    expect(await refusalOf(approve(prepared))).toBeInstanceOf(
      ConflictException,
    );
    expect(
      records.filter((record: AIChatRecordSeen) => {
        return record.isPartial;
      }),
    ).toEqual([]);
  });
});

describe("Ask AI read the workflow, someone added a step in the Builder, and Ask AI proposed a change from its earlier read", () => {
  test("before anyone approves it, the card names the step the change would take out again", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.addSlackAfter("log-d");

    const prepared: PreparedMutation = await propose(addLogB(earlier));

    expect(linesOf(prepared)).toEqual([
      "Adds Log.",
      "Removes Send Message to Slack.",
      UNDOES("Send Message to Slack"),
    ]);
    // A sentence of the module, which the card says in the reader's language.
    expect(prepared.description![2]).toEqual({
      template: AI_ACTION_LINES.workflowUndoesSavedSince,
      values: { steps: "Send Message to Slack" },
    });
    expect(
      describeAIActionWords({
        title: prepared.title!,
        description: prepared.description,
      }),
    ).toEqual({
      title: "Update workflow Tickets",
      description: `Adds Log. Removes Send Message to Slack. ${UNDOES("Send Message to Slack")}`,
    });

    // And it is not made unasked.
    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: `Not done: ${describeSavedSinceRead('"Send Message to Slack" (slack-1)')}`,
      summary: UNSEEN_CHANGE_SUMMARIES.savedSinceRead,
    });
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "Read the workflow again with query_workflows and includeSteps",
    );
  });

  test("a workflow that is on says so after it: what the change undoes first, then when it takes effect", async () => {
    server.isEnabled = true;
    const earlier: WorkflowDraft = await readSteps();
    builder.addSlackAfter("log-d");

    expect(linesOf(await propose(addLogB(earlier)))).toEqual([
      "Adds Log.",
      "Removes Send Message to Slack.",
      UNDOES("Send Message to Slack"),
      "This workflow is on, so its next run uses the change.",
    ]);
  });

  test("approved anyway, it does what the card said, exactly as it would have without the line", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.addSlackAfter("log-d");

    const warned: PreparedMutation = await propose(addLogB(earlier));
    const asBefore: PreparedMutation = await proposeAsBefore(addLogB(earlier));

    // What runs is the same: the line is on the card alone.
    expect(warned.arguments).toEqual(asBefore.arguments);

    await approve(warned);

    expect(update.mock.calls).toHaveLength(1);
    expect(update.mock.calls[0]![0].miscDataProps).toEqual({
      [WORKFLOW_GRAPH_REVISION_KEY]: 8,
    });
    expect(stepIdsOf(server.graph)).toEqual([
      "log-a",
      "log-b",
      "log-d",
      "webhook-1",
    ]);
  });

  test("read again, the change is proposed on the workflow as it is: the card is as it always was", async () => {
    await readSteps();
    builder.addSlackAfter("log-d");

    const again: WorkflowDraft = await readSteps();
    const prepared: PreparedMutation = await propose(addLogB(again));

    expect(linesOf(prepared)).toEqual(["Adds Log."]);
    expect(prepared.notRunWithoutApproval).toBeUndefined();
    expect(prepared).toEqual(await proposeAsBefore(addLogB(again)));
  });

  test("a setting changed since, which the change writes back as Ask AI read it: named", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.setValue("log-d", "theirs");

    expect(linesOf(await propose(addLogB(earlier)))).toEqual([
      "Adds Log.",
      "Changes Log.",
      UNDOES("Log"),
    ]);
  });

  test("a step taken out since, which the change puts back: named", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.remove("log-d");

    expect(linesOf(await propose(addLogB(earlier)))).toEqual([
      "Adds Log, Log.",
      UNDOES("Log"),
    ]);
  });

  test("a connection made since, which the change takes out: the steps it joined are named", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.connect("log-a", "log-d");

    // The card says nothing of connections; the line says which steps were joined.
    expect(linesOf(await propose(addLogB(earlier)))).toEqual([
      "Adds Log.",
      UNDOES("Log, Log"),
    ]);
  });
});

describe("with no save after the read, the card is exactly as it is today", () => {
  const drafts: Array<[string, (read: WorkflowDraft) => JSONObject]> = [
    [
      "a step added",
      (read: WorkflowDraft): JSONObject => {
        return addLogB(read) as unknown as JSONObject;
      },
    ],
    [
      "a setting changed",
      (read: WorkflowDraft): JSONObject => {
        return {
          ...read,
          steps: read.steps.map((step: WorkflowDraftStep) => {
            return step.id === "log-a"
              ? { ...step, arguments: { value: "changed" } }
              : step;
          }),
        } as unknown as JSONObject;
      },
    ],
    [
      "a step taken out",
      (read: WorkflowDraft): JSONObject => {
        return {
          steps: read.steps.filter((step: WorkflowDraftStep) => {
            return step.id !== "log-d";
          }),
          connections: read.connections.filter(
            (connection: WorkflowDraftConnection) => {
              return connection.to !== "log-d";
            },
          ),
        } as unknown as JSONObject;
      },
    ],
    [
      "a new name with the steps",
      (read: WorkflowDraft): JSONObject => {
        return { ...addLogB(read), name: "Renamed" } as unknown as JSONObject;
      },
    ],
    [
      "settings left out of the steps it does not change",
      (read: WorkflowDraft): JSONObject => {
        return {
          ...addLogB(read),
          steps: addLogB(read).steps.map((step: WorkflowDraftStep) => {
            return step.id === "log-b"
              ? step
              : { id: step.id, componentId: step.componentId };
          }),
        } as unknown as JSONObject;
      },
    ],
    [
      "a draft that cannot be saved",
      (): JSONObject => {
        return {
          steps: [{ id: "x", componentId: "no-such-thing" }],
          connections: [],
        };
      },
    ],
    [
      "a new name alone",
      (): JSONObject => {
        return { name: "Renamed" };
      },
    ],
  ];

  test.each(drafts)(
    "%s",
    async (_name: string, draftOf: (read: WorkflowDraft) => JSONObject) => {
      const earlier: WorkflowDraft = await readSteps();

      const prepared: PreparedMutation = await propose(draftOf(earlier));

      expect(prepared).toEqual(await proposeAsBefore(draftOf(earlier)));
      expect(prepared.notRunWithoutApproval).toBeUndefined();
    },
  );

  test("only cards moved since: the card is as it is today", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.move("log-a");
    builder.move("log-d");

    const prepared: PreparedMutation = await propose(addLogB(earlier));

    expect(server.revision).toBe(9);
    expect(prepared).toEqual(await proposeAsBefore(addLogB(earlier)));
  });

  test("a setting changed since on a step the change keeps as it is: the card is as it is today", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.setValue("log-d", "theirs");

    // The model leaves out the settings of the steps it does not change.
    const draft: WorkflowDraft = {
      ...addLogB(earlier),
      steps: addLogB(earlier).steps.map((step: WorkflowDraftStep) => {
        return step.id === "log-d"
          ? { id: step.id, componentId: step.componentId }
          : step;
      }),
    };

    const prepared: PreparedMutation = await propose(draft);

    expect(linesOf(prepared)).toEqual(["Adds Log."]);
    expect(prepared).toEqual(await proposeAsBefore(draft));
  });
});

describe("a revision the model makes up changes nothing at all", () => {
  const values: Array<[string, unknown]> = [
    ["older", 6],
    ["the same", 7],
    ["newer", 8],
    ["far in the future", 1e18],
    ["text", "7"],
    ["words", "the latest"],
    ["NaN", NaN],
    ["negative", -1],
    ["Infinity", Infinity],
    ["null", null],
    ["an object", { graphRevision: 7 }],
    ["a list", [7]],
  ];

  const situations: Array<[string, () => Promise<WorkflowDraft>]> = [
    [
      "on a fresh read",
      async (): Promise<WorkflowDraft> => {
        return await readSteps();
      },
    ],
    [
      "on a read someone saved after",
      async (): Promise<WorkflowDraft> => {
        const earlier: WorkflowDraft = await readSteps();
        builder.addSlackAfter("log-d");
        return earlier;
      },
    ],
  ];

  describe.each(situations)(
    "%s",
    (_situation: string, readOf: () => Promise<WorkflowDraft>) => {
      test.each(values)(
        "readAtRevision %s",
        async (_name: string, value: unknown) => {
          const earlier: WorkflowDraft = await readOf();

          const without: PreparedMutation = await propose(addLogB(earlier));
          const withIt: PreparedMutation = await propose(addLogB(earlier), {
            readAtRevision: value as JSONValue,
            graphRevision: value as JSONValue,
          });

          // The card, and whether it runs unasked: as without it.
          expect(withIt.title).toEqual(without.title);
          expect(withIt.description).toEqual(without.description);
          expect(withIt.notRunWithoutApproval).toEqual(
            without.notRunWithoutApproval,
          );
          // What it is proposed on (#6290): OneUptime's own record, as without it.
          expect(proposedOnOf(withIt)).toEqual(proposedOnOf(without));

          // What is saved: the same graph, held to the same revision, from the same workflow.
          const before: Server = copyOf(server);
          await approve(without);
          server = copyOf(before);
          await approve(withIt);

          expect(update.mock.calls).toHaveLength(2);
          expect(readBack(update.mock.calls[1]![0].data.graph)).toEqual(
            readBack(update.mock.calls[0]![0].data.graph),
          );
          expect(update.mock.calls[1]![0].miscDataProps).toEqual(
            update.mock.calls[0]![0].miscDataProps,
          );
        },
      );
    },
  );

  test("a record the model writes into its arguments is never read: only what the conversation showed it counts", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.addSlackAfter("log-d");

    // The model claims a read of the workflow as it is now.
    const claimed: AIChatRecordSeen = getWorkflowSeen({
      workflowId: WORKFLOW_ID.toString(),
      graph: server.graph,
      revision: server.revision,
    });

    const prepared: PreparedMutation = await propose(addLogB(earlier), {
      recordsSeen: [claimed] as unknown as JSONValue,
      recordSeen: claimed as unknown as JSONValue,
    });

    expect(linesOf(prepared)).toContain(UNDOES("Send Message to Slack"));
    expect(prepared.notRunWithoutApproval).toBeDefined();
  });
});

describe("Ask AI never read the steps", () => {
  test("a change that takes out or changes steps it never saw: the card says so", async () => {
    records = [];
    const blind: WorkflowDraft = {
      steps: [
        { id: "webhook-1", componentId: ComponentID.Webhook },
        {
          id: "log-a",
          componentId: ComponentID.Log,
          arguments: { value: "made up" },
        },
      ],
      connections: [{ from: "webhook-1", to: "log-a" }],
    };

    const prepared: PreparedMutation = await propose(blind);

    expect(linesOf(prepared)).toEqual([
      "Removes Log.",
      "Changes Log.",
      NOT_READ,
    ]);
    expect(prepared.description![2]).toEqual({
      template: AI_ACTION_LINES.workflowNotRead,
    });
    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: `Not done: ${describeStepsNotRead('"Log" (log-a), "Log" (log-d)')}`,
      summary: UNSEEN_CHANGE_SUMMARIES.stepsNotRead,
    });
  });

  test("a change that only adds a step: there is nothing it could undo", async () => {
    records = [];

    const prepared: PreparedMutation = await propose(
      addLogB(readBack(server.graph)),
    );

    expect(linesOf(prepared)).toEqual(["Adds Log."]);
    expect(prepared.notRunWithoutApproval).toBeUndefined();
  });

  test("a read of another workflow, or only a change of its own, is no read of this one", async () => {
    const blind: WorkflowDraft = {
      steps: [{ id: "w", componentId: ComponentID.Webhook }],
      connections: [],
    };

    for (const seen of [
      [
        getWorkflowSeen({
          workflowId: OTHER_WORKFLOW_ID,
          graph: server.graph,
          revision: 7,
        }),
      ],
      [
        {
          ...getWorkflowSeen({
            workflowId: WORKFLOW_ID.toString(),
            graph: server.graph,
            revision: 7,
          }),
          isPartial: true,
        },
      ],
    ]) {
      expect(linesOf(await propose(blind, {}, seen))).toContain(NOT_READ);
    }
  });

  test("a caller that keeps no record of what the model saw: the card is as it always was", async () => {
    const blind: WorkflowDraft = {
      steps: [{ id: "w", componentId: ComponentID.Webhook }],
      connections: [],
    };
    const prepared: PreparedMutation = await proposeAsBefore(blind);

    expect(linesOf(prepared)).not.toContain(NOT_READ);
    expect(prepared.notRunWithoutApproval).toBeUndefined();
  });
});

describe("what Ask AI changed itself, it knows", () => {
  test("a change approved, then another from what it read and what it made: the card is as it always was", async () => {
    const earlier: WorkflowDraft = await readSteps();
    const first: WorkflowDraft = addLogB(earlier);
    await approve(await propose(first));

    // Then it gives its own new step a value of its own.
    const second: WorkflowDraft = {
      ...first,
      steps: first.steps.map((step: WorkflowDraftStep) => {
        return step.id === "log-b"
          ? { ...step, arguments: { value: "b2" } }
          : step;
      }),
    };
    const prepared: PreparedMutation = await propose(second);

    expect(linesOf(prepared)).toEqual(["Changes Log."]);
    expect(prepared.notRunWithoutApproval).toBeUndefined();

    // And it takes it out again.
    const third: WorkflowDraft = {
      steps: first.steps.filter((step: WorkflowDraftStep) => {
        return step.id !== "log-b";
      }),
      connections: first.connections.filter(
        (connection: WorkflowDraftConnection) => {
          return connection.to !== "log-b";
        },
      ),
    };
    expect(linesOf(await propose(third))).toEqual(["Removes Log."]);
  });

  test("approved on top of a teammate's save, which it never saw: its next change from what it knows names their step", async () => {
    const earlier: WorkflowDraft = await readSteps();
    const first: WorkflowDraft = addLogB(earlier);
    const prepared: PreparedMutation = await propose(first);

    // Saved while the card waited: #6290 keeps it, and makes the change on top.
    builder.addLogAfter("log-d", "log-x", "theirs");
    const result: ToolExecutionResult = await approve(prepared);
    expect(result.dataForLlm).toContain("so it was kept");
    expect(stepIdsOf(server.graph)).toContain("log-x");

    // Ask AI's next change, from what it read and what it made: no log-x in it.
    const second: WorkflowDraft = {
      ...first,
      steps: first.steps.map((step: WorkflowDraftStep) => {
        return step.id === "log-a"
          ? { ...step, arguments: { value: "a2" } }
          : step;
      }),
    };

    expect(linesOf(await propose(second))).toEqual([
      "Removes Log.",
      "Changes Log.",
      UNDOES("Log"),
    ]);
  });

  test("a change it was refused, or the person skipped, taught it nothing: it knows what it read", async () => {
    const earlier: WorkflowDraft = await readSteps();
    // Proposed, and skipped: nothing ran.
    await propose(addLogB(earlier));
    builder.addSlackAfter("log-d");

    expect(linesOf(await propose(addLogB(earlier)))).toContain(
      UNDOES("Send Message to Slack"),
    );
  });

  test("it made the workflow, the person filled in a setting in the Builder, and its change writes the step back without it: named", async () => {
    const made: ToolExecutionResult = await CreateWorkflowTool.execute(
      { name: "Tickets", ...(copyOf(BASE_DRAFT) as unknown as JSONObject) },
      CTX,
    );
    records.push(workflowSeen(made));
    builder.setValue("log-a", "filled in by the person");

    // Written from the draft it sent, which had no such value.
    expect(linesOf(await propose(addLogB(BASE_DRAFT)))).toEqual([
      "Adds Log.",
      "Changes Log.",
      UNDOES("Log"),
    ]);
  });
});

describe("#6290's check is never weakened", () => {
  test("what Ask AI was shown never enters what runs", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.addSlackAfter("log-d");

    const prepared: PreparedMutation = await propose(addLogB(earlier));
    const text: string = JSON.stringify(prepared.arguments);

    for (const record of records) {
      for (const part of record.parts) {
        expect(text).not.toContain(part.id);
      }
    }
    expect(prepared.arguments).toEqual(
      (await proposeAsBefore(addLogB(earlier))).arguments,
    );
  });

  test("a fresh read, and a save while the card waits: made on top of it exactly as without the record", async () => {
    const earlier: WorkflowDraft = await readSteps();
    const prepared: PreparedMutation = await propose(addLogB(earlier));
    expect(linesOf(prepared)).toEqual(["Adds Log."]);

    builder.addLogAfter("log-d", "log-c", "c");
    await approve(prepared);

    expect(update.mock.calls[0]![0].miscDataProps).toEqual({
      [WORKFLOW_GRAPH_REVISION_KEY]: 8,
    });
    expect(stepIdsOf(server.graph)).toEqual([
      "log-a",
      "log-b",
      "log-c",
      "log-d",
      "webhook-1",
    ]);
  });

  test("the line stays true while the card waits: a card moved meanwhile, and approving does what it said", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.addSlackAfter("log-d");
    const prepared: PreparedMutation = await propose(addLogB(earlier));
    expect(linesOf(prepared)).toContain(UNDOES("Send Message to Slack"));

    builder.move("log-a");
    const movedTo: { x: number; y: number } = copyOf(
      nodeOf(server.graph, "log-a")!.position,
    );
    await approve(prepared);

    // Made on top of the move (#6290), and the Slack step goes, as the card said.
    expect(update.mock.calls[0]![0].miscDataProps).toEqual({
      [WORKFLOW_GRAPH_REVISION_KEY]: 9,
    });
    expect(nodeOf(server.graph, "slack-1")).toBeUndefined();
    expect(nodeOf(server.graph, "log-a")!.position).toEqual(movedTo);
  });

  test("the line can never come to lie: the step it names taken out while the card waits, approving is refused", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.addSlackAfter("log-d");
    const prepared: PreparedMutation = await propose(addLogB(earlier));
    expect(linesOf(prepared)).toContain(UNDOES("Send Message to Slack"));

    // Someone takes the Slack step out again: what the card named is no longer so.
    builder.remove("slack-1");

    const refusal: unknown = await refusalOf(approve(prepared));
    expect(refusal).toBeInstanceOf(ConflictException);
    // #6290's refusal names the step, which is in neither the workflow nor the draft now, by its id.
    expect((refusal as ConflictException).message).toContain("(slack-1)");
    expect((refusal as ConflictException).message).toContain(
      "nothing was changed",
    );
    expect(update.mock.calls).toHaveLength(0);
  });

  test("no line, and a step added while the card waits: approving keeps it (#6290), so no line was owed", async () => {
    const earlier: WorkflowDraft = await readSteps();
    const prepared: PreparedMutation = await propose(addLogB(earlier));
    expect(linesOf(prepared)).toEqual(["Adds Log."]);

    builder.addSlackAfter("log-d");
    await approve(prepared);

    expect(nodeOf(server.graph, "slack-1")).toBeDefined();
    expect(nodeOf(server.graph, "log-b")).toBeDefined();
  });

  test("a stale read approved, and a save while the card waits to a step it touches: refused as before", async () => {
    const earlier: WorkflowDraft = await readSteps();
    builder.addSlackAfter("log-d");
    const prepared: PreparedMutation = await propose(addLogB(earlier));
    expect(prepared.notRunWithoutApproval).toBeDefined();

    builder.setValue("log-a", "theirs");

    expect(await refusalOf(approve(prepared))).toBeInstanceOf(
      ConflictException,
    );
    expect(update.mock.calls).toHaveLength(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * At random: reads, saves in the Builder, proposals, approvals and skips, in
 * any order. Ask AI writes each change from what it believes the workflow
 * is - what it last read, with what it made since - and an oracle that
 * reads graphs its own way says what each card must name.
 * ---------------------------------------------------------------------------
 */

type State = string | null;

const stateOfStep: (graph: JSONObject, stepId: string) => State = (
  graph: JSONObject,
  stepId: string,
): State => {
  const nodes: Array<GraphNode> = nodesOf(graph).filter((node: GraphNode) => {
    return (
      node.data.id === stepId && node.data.nodeType !== NodeType.PlaceholderNode
    );
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

const edgesByStep: (
  graph: JSONObject,
) => Array<{ key: string; from: string; to: string }> = (
  graph: JSONObject,
): Array<{ key: string; from: string; to: string }> => {
  const stepOfNode: Map<string, string> = new Map<string, string>(
    nodesOf(graph).map((node: GraphNode): [string, string] => {
      return [node.id, node.data.id];
    }),
  );
  const edges: Array<{ key: string; from: string; to: string }> = [];

  for (const edge of edgesOf(graph)) {
    const from: string | undefined = stepOfNode.get(edge.source);
    const to: string | undefined = stepOfNode.get(edge.target);
    const key: string = JSON.stringify([from, edge.sourceHandle || "", to]);

    if (
      from &&
      to &&
      !edges.some((each: { key: string }) => {
        return each.key === key;
      })
    ) {
      edges.push({ key, from, to });
    }
  }

  return edges;
};

// What Ask AI knows: each part's state as it saw it.
type Belief = Map<string, State>;

const beliefOf: (graph: JSONObject) => Belief = (graph: JSONObject): Belief => {
  const belief: Belief = new Map<string, State>();

  for (const node of nodesOf(graph)) {
    belief.set(`step ${node.data.id}`, stateOfStep(graph, node.data.id));
  }
  for (const edge of edgesByStep(graph)) {
    belief.set(`edge ${edge.key}`, "there");
  }

  return belief;
};

const titleOfComponent: (componentId: string) => string = (
  componentId: string,
): string => {
  return getWorkflowComponent(componentId)?.title || componentId;
};

// What the card must name, or null for no line.
const expectedLine: (data: {
  belief: Belief | null;
  now: JSONObject;
  after: JSONObject;
}) => string | null = (data: {
  belief: Belief | null;
  now: JSONObject;
  after: JSONObject;
}): string | null => {
  const parts: Array<{ key: string; steps: Array<string>; isStep: boolean }> =
    [];
  const seen: Set<string> = new Set<string>();

  for (const graph of [data.now, data.after]) {
    for (const node of nodesOf(graph)) {
      const key: string = `step ${node.data.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        parts.push({ key, steps: [node.data.id], isStep: true });
      }
    }
    for (const edge of edgesByStep(graph)) {
      const key: string = `edge ${edge.key}`;
      if (!seen.has(key)) {
        seen.add(key);
        parts.push({ key, steps: [edge.from, edge.to], isStep: false });
      }
    }
  }

  const stateIn: (
    graph: JSONObject,
    part: { key: string; steps: Array<string>; isStep: boolean },
  ) => State = (
    graph: JSONObject,
    part: { key: string; steps: Array<string>; isStep: boolean },
  ): State => {
    if (part.isStep) {
      return stateOfStep(graph, part.steps[0]!);
    }
    return edgesByStep(graph).some((edge: { key: string }) => {
      return `edge ${edge.key}` === part.key;
    })
      ? "there"
      : null;
  };

  const undone: Array<{ key: string; steps: Array<string>; isStep: boolean }> =
    parts.filter(
      (part: {
        key: string;
        steps: Array<string>;
        isStep: boolean;
      }): boolean => {
        const now: State = stateIn(data.now, part);
        if (stateIn(data.after, part) === now) {
          return false;
        }
        return data.belief
          ? (data.belief.get(part.key) ?? null) !== now
          : now !== null;
      },
    );

  if (undone.length === 0) {
    return null;
  }

  if (!data.belief) {
    return NOT_READ;
  }

  const steps: Array<string> = undone
    .filter((part: { isStep: boolean }) => {
      return part.isStep;
    })
    .map((part: { steps: Array<string> }) => {
      return part.steps[0]!;
    });
  const named: Array<string> =
    steps.length > 0
      ? steps
      : Array.from(
          new Set<string>(
            undone.flatMap((part: { steps: Array<string> }) => {
              return part.steps;
            }),
          ),
        );

  return UNDOES(
    named
      .map((stepId: string): string => {
        const node: GraphNode | undefined =
          nodeOf(data.now, stepId) || nodeOf(data.after, stepId);
        return titleOfComponent(node!.data.metadataId);
      })
      .join(", "),
  );
};

describe("reads, saves, proposals and approvals in any order, at random", () => {
  test("every card names exactly what its change would undo that Ask AI never saw, and nothing else changes", async () => {
    const random: SeededRandom = seededRandom(6291);
    const counts: { [outcome: string]: number } = {
      asItAlwaysWas: 0,
      asItAlwaysWasThoughSavedSince: 0,
      namesWhatItUndoes: 0,
      neverRead: 0,
      approved: 0,
      approvedOnTop: 0,
      refused: 0,
      skipped: 0,
    };

    for (let round: number = 0; round < 250; round++) {
      nextId = 0;
      records = [];
      server = {
        graph: graphOf(BASE_DRAFT),
        revision: 3 + random(5),
        isEnabled: random(2) === 0,
      };

      // What Ask AI believes the workflow is, and what it knows of its parts.
      let believed: WorkflowDraft | null = null;
      let belief: Belief | null = null;
      let pending: {
        prepared: PreparedMutation;
        draft: WorkflowDraft;
        over: JSONObject;
      } | null = null;
      let label: number = 0;

      for (let event: number = 0; event < 4 + random(7); event++) {
        const kind: number = random(10);

        if (kind <= 1) {
          // Ask AI reads the steps.
          believed = await readSteps();
          belief = beliefOf(server.graph);
          continue;
        }

        if (kind <= 4) {
          // A save in the Builder.
          const steps: Array<string> = stepIdsOf(server.graph);
          const logs: Array<string> = steps.filter((id: string) => {
            return id.startsWith("log");
          });
          // A moved card as often as anything else: the commonest save beside the panel.
          const save: number = random(6);
          label++;

          if (save === 0 || logs.length === 0) {
            builder.addLogAfter(
              steps[random(steps.length)]!,
              `log-t${label}`,
              `t${label}`,
            );
          } else if (save === 1) {
            builder.setValue(logs[random(logs.length)]!, `theirs ${label}`);
          } else if (save === 2 || save === 5) {
            builder.move(steps[random(steps.length)]!);
          } else if (save === 3) {
            builder.remove(logs[random(logs.length)]!);
          } else {
            const to: string = logs[random(logs.length)]!;
            const from: string = steps.filter((id: string) => {
              return id !== to;
            })[0]!;
            builder.connect(from, to);
          }
          continue;
        }

        if (kind <= 7) {
          // Ask AI proposes a change, from what it believes - or blind.
          const from: WorkflowDraft = copyOf(
            believed || readBack(graphOf(BASE_DRAFT)),
          );
          const logs: Array<string> = from.steps
            .filter((step: WorkflowDraftStep) => {
              return step.componentId === ComponentID.Log;
            })
            .map((step: WorkflowDraftStep) => {
              return step.id;
            });
          const change: number = logs.length === 0 ? 0 : random(3);
          let draft: WorkflowDraft;

          if (change === 0) {
            label++;
            draft = {
              steps: [
                ...from.steps,
                {
                  id: `log-ai${label}`,
                  componentId: ComponentID.Log,
                  arguments: { value: "ai" },
                },
              ],
              connections: [
                ...from.connections,
                {
                  from: from.steps[random(from.steps.length)]!.id,
                  to: `log-ai${label}`,
                },
              ],
            };
          } else if (change === 1) {
            const target: string = logs[random(logs.length)]!;
            const value: string = `ai ${label}`;
            draft = {
              ...from,
              steps: from.steps.map((step: WorkflowDraftStep) => {
                return step.id === target
                  ? { ...step, arguments: { value: value } }
                  : step;
              }),
            };
          } else {
            const target: string = logs[random(logs.length)]!;
            draft = {
              steps: from.steps.filter((step: WorkflowDraftStep) => {
                return step.id !== target;
              }),
              connections: from.connections.filter(
                (connection: WorkflowDraftConnection) => {
                  return connection.from !== target && connection.to !== target;
                },
              ),
            };
          }

          // Most steps it does not change, it writes without their settings.
          draft.steps = draft.steps.map((step: WorkflowDraftStep) => {
            return random(2) === 0 || step.id.startsWith("log-ai")
              ? step
              : { id: step.id, componentId: step.componentId };
          });

          const prepared: PreparedMutation = await propose(draft);
          const asBefore: PreparedMutation = await proposeAsBefore(draft);

          // A draft that cannot be saved is refused when it runs: its card is as it was.
          if (
            checkWorkflowDraft({ draft, getComponent: getWorkflowComponent })
              .length > 0
          ) {
            expect({ round, event, prepared }).toEqual({
              round,
              event,
              prepared: asBefore,
            });
            counts["cannotBeSaved"] = (counts["cannotBeSaved"] || 0) + 1;
            pending = null;
            continue;
          }

          const now: JSONObject = copyOf(server.graph);
          const after: JSONObject = graphOf(draft, now);
          const line: string | null = expectedLine({ belief, now, after });
          const lines: Array<string> = linesOf(prepared);
          const linesBefore: Array<string> = linesOf(asBefore);

          // What runs never changes, and nor does the title.
          expect({ round, event, arguments: prepared.arguments }).toEqual({
            round,
            event,
            arguments: asBefore.arguments,
          });
          expect(prepared.title).toEqual(asBefore.title);

          if (line === null) {
            expect({ round, event, prepared }).toEqual({
              round,
              event,
              prepared: asBefore,
            });
            if (
              belief &&
              server.revision !== (records[records.length - 1]?.revision ?? -1)
            ) {
              counts["asItAlwaysWasThoughSavedSince"]!++;
            } else {
              counts["asItAlwaysWas"]!++;
            }
          } else {
            // The card is today's, with the one line before "This workflow is on".
            const expected: Array<string> = [...linesBefore];
            const at: number = expected.indexOf(
              "This workflow is on, so its next run uses the change.",
            );
            expected.splice(at < 0 ? expected.length : at, 0, line);
            expect({ round, event, lines }).toEqual({
              round,
              event,
              lines: expected,
            });
            expect(prepared.notRunWithoutApproval).toBeDefined();
            counts[belief ? "namesWhatItUndoes" : "neverRead"]!++;
          }

          pending = { prepared, draft, over: now };
          continue;
        }

        if (!pending) {
          continue;
        }

        if (kind === 8) {
          // Approved.
          const before: number = update.mock.calls.length;
          const replaced: JSONObject = copyOf(server.graph);
          const refusal: unknown = await refusalOf(approve(pending.prepared));

          if (refusal) {
            expect(refusal).toBeInstanceOf(ConflictException);
            counts["refused"]!++;
          } else {
            const madeOnTop: boolean =
              server.revision - 1 !==
              proposedOnOf(pending.prepared).graphRevision;
            counts[madeOnTop ? "approvedOnTop" : "approved"]!++;

            // Every write held to the revision it was made over.
            for (const call of update.mock.calls.slice(before)) {
              expect(
                typeof call[0].miscDataProps[WORKFLOW_GRAPH_REVISION_KEY],
              ).toBe("number");
            }

            // It now believes its own draft, with what it left out as it knew it.
            const known: Map<string, WorkflowDraftStep> = new Map<
              string,
              WorkflowDraftStep
            >(
              (believed || readBack(graphOf(BASE_DRAFT))).steps.map(
                (step: WorkflowDraftStep): [string, WorkflowDraftStep] => {
                  return [step.id, step];
                },
              ),
            );
            believed = {
              steps: pending.draft.steps.map((step: WorkflowDraftStep) => {
                return step.arguments ? step : known.get(step.id) || step;
              }),
              connections: pending.draft.connections,
            };

            // And knows the parts it touched as it saved them.
            if (belief) {
              const touched: Set<string> = new Set<string>(
                proposedOnOf(pending.prepared).steps.map(
                  (step: { id: string }) => {
                    return step.id;
                  },
                ),
              );
              for (const stepId of touched) {
                belief.set(`step ${stepId}`, stateOfStep(server.graph, stepId));
              }
              for (const graph of [replaced, server.graph]) {
                for (const edge of edgesByStep(graph)) {
                  if (touched.has(edge.from) || touched.has(edge.to)) {
                    belief.set(
                      `edge ${edge.key}`,
                      edgesByStep(server.graph).some(
                        (each: { key: string }) => {
                          return each.key === edge.key;
                        },
                      )
                        ? "there"
                        : null,
                    );
                  }
                }
              }
            }
          }
        } else {
          counts["skipped"]!++;
        }

        pending = null;
      }
    }

    for (const outcome of [
      "asItAlwaysWas",
      "asItAlwaysWasThoughSavedSince",
      "namesWhatItUndoes",
      "neverRead",
      "approved",
      "approvedOnTop",
      "refused",
      "skipped",
    ]) {
      expect({ outcome, enough: counts[outcome]! > 5 }).toEqual({
        outcome,
        enough: true,
      });
    }
  });
});
