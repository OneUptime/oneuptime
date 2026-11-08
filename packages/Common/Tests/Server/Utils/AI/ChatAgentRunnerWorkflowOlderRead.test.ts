import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import {
  UNSEEN_CHANGE_SUMMARIES,
  describeSavedSinceRead,
  getWorkflowComponent,
  getWorkflowSeen,
} from "../../../../Server/Utils/AI/Toolbox/WorkflowBuilderTools";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import WorkflowLogService from "../../../../Server/Services/WorkflowLogService";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import AIChatMessageRole from "../../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AI_ACTION_LINES,
  AIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatToolActionStatus,
  AIRunPausedState,
} from "../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ConflictException from "../../../../Types/Exception/ConflictException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import { NodeType } from "../../../../Types/Workflow/Component";
import {
  WorkflowDraft,
  WorkflowDraftStep,
  buildGraphFromDraft,
  getDraftFromGraph,
} from "../../../../Types/Workflow/WorkflowDraft";
import { WORKFLOW_GRAPH_REVISION_KEY } from "../../../../Types/Workflow/WorkflowGraphRevision";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6291, THROUGH THE WHOLE CHAT TURN.
 *
 * The model reads a workflow's steps with query_workflows, the person adds a
 * step in the Builder beside the panel, and the model asks for update_workflow
 * with a draft written from its earlier read. The chat runner keeps what each
 * result showed the model on its citation, hands the prepare what the model
 * had seen when it asked - never a read it asked for alongside - and so:
 *
 *   - in Ask to act, the card names the step the change would take out
 *     again, before anyone approves it; with nothing saved since, the card is
 *     as it always was;
 *   - in Auto-run, such a change is not made: the model is told the workflow
 *     changed since it read it, reads it again, and makes its change on the
 *     workflow as it is;
 *   - what an earlier turn showed the model counts too, as far as the history
 *     the model is shown goes, and a turn resumed after an approval keeps it.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa6291",
);
const WORKFLOW_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddd6291";

let nextId: number = 0;

const generateId: () => string = (): string => {
  nextId++;
  return `fixture-${nextId}`;
};

// The workflow: a webhook leading to a Log, and to another.
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

interface Server {
  graph: JSONObject;
  revision: number;
}

let server: Server;

const copyOf: <T>(value: T) => T = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const readBack: (graph: JSONObject) => WorkflowDraft = (
  graph: JSONObject,
): WorkflowDraft => {
  return getDraftFromGraph({
    graph: graph,
    getComponent: getWorkflowComponent,
  });
};

interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: {
    id: string;
    metadataId: string;
    arguments: JSONObject;
    nodeType?: string;
    componentType?: string;
  };
}

const nodesOf: (graph: JSONObject) => Array<GraphNode> = (
  graph: JSONObject,
): Array<GraphNode> => {
  return graph["nodes"] as unknown as Array<GraphNode>;
};

const nodeOf: (graph: JSONObject, stepId: string) => GraphNode | undefined = (
  graph: JSONObject,
  stepId: string,
): GraphNode | undefined => {
  return nodesOf(graph).find((node: GraphNode): boolean => {
    return node.data.id === stepId;
  });
};

// The person adds a Slack message after Log d, in the Builder.
const addSlackInTheBuilder: () => void = (): void => {
  nodesOf(server.graph).push({
    id: "canvas-slack-1",
    position: { x: 700, y: 700 },
    data: {
      id: "slack-1",
      metadataId: ComponentID.SlackSendMessageToChannel,
      arguments: { text: "A ticket was opened" },
      nodeType: NodeType.Node,
      componentType: "Component",
    },
  });
  (server.graph["edges"] as unknown as Array<JSONObject>).push({
    id: "edge-slack-1",
    source: nodeOf(server.graph, "log-d")!.id,
    target: "canvas-slack-1",
    sourceHandle: "out",
    targetHandle: "in",
  });
  server.revision++;
};

const moveACardInTheBuilder: () => void = (): void => {
  nodeOf(server.graph, "log-a")!.position = { x: 5, y: 5 };
  server.revision++;
};

// What Ask AI writes from what it read: a Log after Log a.
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

type ToolCall = { id: string; name: string; arguments: JSONObject };

const READ_CALL: (id?: string) => ToolCall = (id?: string): ToolCall => {
  return {
    id: id || "call-read",
    name: "query_workflows",
    arguments: { workflowId: WORKFLOW_ID, includeSteps: true },
  };
};

const UPDATE_CALL: (draft: WorkflowDraft, id?: string) => ToolCall = (
  draft: WorkflowDraft,
  id?: string,
): ToolCall => {
  return {
    id: id || "call-update",
    name: "update_workflow",
    arguments: {
      workflowId: WORKFLOW_ID,
      ...(copyOf(draft) as unknown as JSONObject),
    },
  };
};

function response(data: {
  content?: string;
  toolCalls?: Array<ToolCall>;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.toolCalls ? "tool_use" : "end_turn",
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

// A project owner, signed in: who asks, and who approves.
function ownerProps(): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: [Permission.ProjectOwner],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function buildRequest(overrides?: Partial<ChatTurnRequest>): ChatTurnRequest {
  return {
    projectId: PROJECT_ID,
    userId: ObjectID.generate(),
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AskForApproval,
    props: ownerProps(),
    ...overrides,
  };
}

interface Spies {
  executeWithLogging: SpyInstance;
  messageUpdateOneBy: SpyInstance;
  runUpdateOneBy: SpyInstance;
  workflowUpdate: SpyInstance;
  eventCreate: SpyInstance;
}

/*
 * Every model turn is scripted: each entry runs whatever happens while the
 * model thinks (a save in the Builder), then answers.
 */
type Turn = {
  meanwhile?: () => void;
  // Or worked out as the model is asked: a draft from a read made in this turn.
  answer: AILogResponse | (() => AILogResponse);
};

function installSpies(data: {
  turns: Array<Turn>;
  run?: AIRun | undefined;
  history?: Array<AIConversationMessage> | undefined;
}): Spies {
  const eventCreate: SpyInstance = jest
    .spyOn(AIRunEventService, "create")
    .mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);

  const run: AIRun = data.run ?? new AIRun();
  if (!data.run) {
    run.status = AIRunStatus.Running;
  }
  jest.spyOn(AIRunService, "findOneById").mockResolvedValue(run as never);
  const runUpdateOneBy: SpyInstance = jest
    .spyOn(AIRunService, "updateOneBy")
    .mockResolvedValue(1 as never);

  const history: Array<AIConversationMessage> = data.history || [];
  jest
    .spyOn(AIConversationMessageService, "findBy")
    .mockResolvedValue(history as never);
  jest
    .spyOn(AIConversationMessageService, "countBy")
    .mockResolvedValue(new PositiveNumber(history.length) as never);
  jest
    .spyOn(AIConversationMessageService, "findOneBy")
    .mockResolvedValue(null as never);
  const messageUpdateOneBy: SpyInstance = jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);
  jest
    .spyOn(AIConversationService, "findOneById")
    .mockResolvedValue(new AIConversation() as never);
  jest
    .spyOn(AIConversationService, "updateOneById")
    .mockResolvedValue(1 as never);

  jest.spyOn(WorkflowService, "findOneById").mockImplementation((async () => {
    const workflow: Workflow = new Workflow();
    workflow.id = new ObjectID(WORKFLOW_ID);
    workflow.name = "Tickets";
    workflow.isEnabled = false;
    workflow.isArchived = false;
    workflow.graph = copyOf(server.graph);
    workflow.graphRevision = server.revision;
    return workflow;
  }) as never);
  const workflowUpdate: SpyInstance = jest
    .spyOn(WorkflowService, "updateOneById")
    .mockImplementation((async (request: JSONObject) => {
      const heldTo: unknown = (request["miscDataProps"] as JSONObject)?.[
        WORKFLOW_GRAPH_REVISION_KEY
      ];
      if (typeof heldTo === "number" && heldTo !== server.revision) {
        throw new ConflictException("Someone else saved this workflow.");
      }
      server.graph = copyOf(
        (request["data"] as JSONObject)["graph"] as JSONObject,
      );
      server.revision++;
      return 1;
    }) as never);
  jest.spyOn(WorkflowLogService, "findBy").mockResolvedValue([] as never);

  const turns: Array<Turn> = [...data.turns];
  const executeWithLogging: SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockImplementation((async () => {
      const turn: Turn | undefined = turns.shift();
      turn?.meanwhile?.();
      if (!turn) {
        return response({ content: "Done." });
      }
      return typeof turn.answer === "function" ? turn.answer() : turn.answer;
    }) as never);

  return {
    executeWithLogging,
    messageUpdateOneBy,
    runUpdateOneBy,
    workflowUpdate,
    eventCreate,
  };
}

function lastSaved<T>(spies: Spies, key: string): T | undefined {
  let saved: T | undefined = undefined;

  for (const call of spies.messageUpdateOneBy.mock.calls) {
    const value: unknown = (call[0] as { data?: JSONObject }).data?.[key];
    if (value !== undefined) {
      saved = value as T;
    }
  }

  return saved;
}

const toolActionsOf: (spies: Spies) => Array<AIChatToolAction> = (
  spies: Spies,
): Array<AIChatToolAction> => {
  return lastSaved<Array<AIChatToolAction>>(spies, "toolActions") || [];
};

function pausedStateOf(spies: Spies): AIRunPausedState {
  for (const call of spies.runUpdateOneBy.mock.calls) {
    const paused: unknown = (call[0] as { data?: JSONObject }).data?.[
      "pausedState"
    ];
    if (paused) {
      return copyOf(paused) as AIRunPausedState;
    }
  }

  throw new Error("The run was never paused for approval.");
}

// What the model was told in answer to a call, in the next model turn's messages.
const toldModel: (spies: Spies, toolCallId: string) => string | undefined = (
  spies: Spies,
  toolCallId: string,
): string | undefined => {
  for (const call of spies.executeWithLogging.mock.calls) {
    const messages: Array<JSONObject> = (
      call[0] as { messages: Array<JSONObject> }
    ).messages;
    const answer: JSONObject | undefined = messages.find(
      (message: JSONObject) => {
        return (
          message["role"] === "tool" && message["toolCallId"] === toolCallId
        );
      },
    );
    if (answer) {
      return answer["content"] as string;
    }
  }

  return undefined;
};

const UNDOES_SLACK: string =
  "This change undoes what was saved after Ask AI read the workflow: Send Message to Slack.";

const baseGraph: () => JSONObject = (): JSONObject => {
  return buildGraphFromDraft({
    draft: BASE_DRAFT,
    getComponent: getWorkflowComponent,
    generateId: generateId,
  });
};

const startServer: () => void = (): void => {
  nextId = 0;
  server = {
    graph: buildGraphFromDraft({
      draft: BASE_DRAFT,
      getComponent: getWorkflowComponent,
      generateId: generateId,
    }),
    revision: 7,
  };
};

// What the model read, as query_workflows shows it.
const asRead: () => WorkflowDraft = (): WorkflowDraft => {
  return readBack(server.graph);
};

const resumeWith: (data: {
  paused: AIRunPausedState;
  approved: Array<string>;
  turns: Array<Turn>;
  request?: Partial<ChatTurnRequest>;
}) => Promise<Spies> = async (data: {
  paused: AIRunPausedState;
  approved: Array<string>;
  turns: Array<Turn>;
  request?: Partial<ChatTurnRequest>;
}): Promise<Spies> => {
  jest.restoreAllMocks();
  const run: AIRun = new AIRun();
  run.status = AIRunStatus.WaitingForApproval;
  run.pausedState = data.paused;
  const spies: Spies = installSpies({ run, turns: data.turns });

  await ChatAgentRunner.resumeTurn(
    buildRequest(data.request),
    (data.paused.pendingToolCalls as unknown as Array<{ id: string }>).map(
      (call: { id: string }) => {
        return {
          toolCallId: call.id,
          approved: data.approved.includes(call.id),
        };
      },
    ),
  );

  return spies;
};

describe("Ask to act: the card says what the change would undo, before anyone approves it", () => {
  test("Ask AI read the workflow, the person added a step in the Builder, and the change from the earlier read names it", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: addSlackInTheBuilder,
          answer: response({ toolCalls: [UPDATE_CALL(addLogB(read))] }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    // Nothing is saved before the person approves it.
    expect(spies.workflowUpdate).not.toHaveBeenCalled();

    const actions: Array<AIChatToolAction> = toolActionsOf(spies);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Pending);
    expect(actions[0]!.requiresApproval).toBe(true);
    expect(actions[0]!.title).toBe("Update workflow Tickets");
    expect(actions[0]!.description).toBe(
      `Adds Log. Removes Send Message to Slack. ${UNDOES_SLACK}`,
    );
    expect(
      actions[0]!.words!.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([
      AI_ACTION_LINES.workflowAddsSteps,
      AI_ACTION_LINES.workflowRemovesSteps,
      AI_ACTION_LINES.workflowUndoesSavedSince,
    ]);

    // The read's citation keeps what it showed the model; the paused turn keeps the citation.
    const paused: AIRunPausedState = pausedStateOf(spies);
    expect(paused.citations[0]!.toolName).toBe("query_workflows");
    expect(paused.citations[0]!.recordSeen).toEqual(
      getWorkflowSeen({
        workflowId: WORKFLOW_ID,
        graph: baseGraph(),
        revision: 7,
      }),
    );
    expect(paused.recordsSeenBeforeTurn).toEqual([]);
    // And the message the person reads keeps it too.
    expect(
      lastSaved<Array<AIChatCitation>>(spies, "citations")![0]!.recordSeen,
    ).toBeDefined();
  });

  test("approved, it runs as the card said: the person chose", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: addSlackInTheBuilder,
          answer: response({ toolCalls: [UPDATE_CALL(addLogB(read))] }),
        },
      ],
    });
    await ChatAgentRunner.runTurn(buildRequest());

    const spies: Spies = await resumeWith({
      paused: pausedStateOf(first),
      approved: ["call-update"],
      turns: [{ answer: response({ content: "Done." }) }],
    });

    expect(spies.workflowUpdate).toHaveBeenCalledTimes(1);
    expect(nodeOf(server.graph, "slack-1")).toBeUndefined();
    expect(nodeOf(server.graph, "log-b")).toBeDefined();
    expect(toolActionsOf(spies)[0]!.status).toBe(
      AIChatToolActionStatus.Executed,
    );
  });

  test("nothing saved since the read: the card is as it always was", async () => {
    startServer();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        { answer: response({ toolCalls: [UPDATE_CALL(addLogB(asRead()))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    const actions: Array<AIChatToolAction> = toolActionsOf(spies);
    expect(actions[0]!.description).toBe("Adds Log.");
    expect(actions[0]!.words!.description).toEqual([
      { template: AI_ACTION_LINES.workflowAddsSteps, values: { steps: "Log" } },
    ]);
  });

  test("only a card moved in the Builder since: the card is as it always was", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: moveACardInTheBuilder,
          answer: response({ toolCalls: [UPDATE_CALL(addLogB(read))] }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(toolActionsOf(spies)[0]!.description).toBe("Adds Log.");
  });

  test("a read asked for alongside the change was not seen when the change was written: it does not count", async () => {
    startServer();
    // Saved before the turn; the model never read it.
    addSlackInTheBuilder();
    const spies: Spies = installSpies({
      turns: [
        {
          answer: response({
            toolCalls: [
              READ_CALL(),
              // Written before the read's result came back: from the workflow as it once was.
              UPDATE_CALL(addLogB(readBack(baseGraph()))),
            ],
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    const update: AIChatToolAction = toolActionsOf(spies).find(
      (action: AIChatToolAction) => {
        return action.toolName === "update_workflow";
      },
    )!;
    expect(update.description).toBe(
      "Adds Log. Removes Send Message to Slack. Ask AI wrote this change without reading the workflow's steps, so it may remove or change steps it has not seen.",
    );
  });
});

describe("what an earlier turn showed the model counts, as far as the history it is shown goes", () => {
  const readInAnEarlierTurn: (data?: {
    status?: AIChatMessageStatus;
    padding?: string;
  }) => Array<AIConversationMessage> = (data?: {
    status?: AIChatMessageStatus;
    padding?: string;
  }): Array<AIConversationMessage> => {
    const question: AIConversationMessage = new AIConversationMessage();
    question.role = AIChatMessageRole.User;
    question.contentInMarkdown = "What does the Tickets workflow do?";

    const answer: AIConversationMessage = new AIConversationMessage();
    answer.role = AIChatMessageRole.Assistant;
    answer.status = data?.status || AIChatMessageStatus.Completed;
    answer.contentInMarkdown = "It logs every webhook twice.";
    answer.citations = [
      {
        id: "C1",
        toolName: "query_workflows",
        label: 'Workflow "Tickets" (0 recent runs)',
        queryArguments: { workflowId: WORKFLOW_ID, includeSteps: true },
        rowCount: 1,
        recordSeen: getWorkflowSeen({
          workflowId: WORKFLOW_ID,
          graph: server.graph,
          revision: server.revision,
        }),
      },
    ];

    const now: AIConversationMessage = new AIConversationMessage();
    now.role = AIChatMessageRole.User;
    now.contentInMarkdown = `Add a log after the first one.${data?.padding || ""}`;

    // Newest first, as the history is read.
    return [now, answer, question];
  };

  test("read in the turn before, saved in the Builder since: the change from that read names the step", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    const history: Array<AIConversationMessage> = readInAnEarlierTurn();
    addSlackInTheBuilder();

    const spies: Spies = installSpies({
      history,
      turns: [
        { answer: response({ toolCalls: [UPDATE_CALL(addLogB(read))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(toolActionsOf(spies)[0]!.description).toBe(
      `Adds Log. Removes Send Message to Slack. ${UNDOES_SLACK}`,
    );
    expect(pausedStateOf(spies).recordsSeenBeforeTurn).toEqual([
      history[1]!.citations![0]!.recordSeen,
    ]);
  });

  test("read in the turn before, nothing saved since: the card is as it always was", async () => {
    startServer();
    const spies: Spies = installSpies({
      history: readInAnEarlierTurn(),
      turns: [
        { answer: response({ toolCalls: [UPDATE_CALL(addLogB(asRead()))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(toolActionsOf(spies)[0]!.description).toBe("Adds Log.");
  });

  test("a turn that failed was never shown to the model again: its read does not count", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    const history: Array<AIConversationMessage> = readInAnEarlierTurn({
      status: AIChatMessageStatus.Error,
    });
    addSlackInTheBuilder();

    const spies: Spies = installSpies({
      history,
      turns: [
        { answer: response({ toolCalls: [UPDATE_CALL(addLogB(read))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(toolActionsOf(spies)[0]!.description).toContain(
      "Ask AI wrote this change without reading the workflow's steps",
    );
    expect(pausedStateOf(spies).recordsSeenBeforeTurn).toEqual([]);
  });

  test("a turn the history left out for length is not shown to the model: its read does not count", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    // A question so long the budget keeps it alone.
    const history: Array<AIConversationMessage> = readInAnEarlierTurn({
      padding: " ".repeat(10) + "x".repeat(120000),
    });
    addSlackInTheBuilder();

    const spies: Spies = installSpies({
      history,
      turns: [
        { answer: response({ toolCalls: [UPDATE_CALL(addLogB(read))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(pausedStateOf(spies).recordsSeenBeforeTurn).toEqual([]);
    expect(toolActionsOf(spies)[0]!.description).toContain(
      "Ask AI wrote this change without reading the workflow's steps",
    );
  });

  test("resumed after an approval, the turn still knows what the earlier turn showed it", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    const first: Spies = installSpies({
      history: readInAnEarlierTurn(),
      turns: [
        {
          answer: response({
            toolCalls: [UPDATE_CALL(addLogB(read), "call-a")],
          }),
        },
      ],
    });
    await ChatAgentRunner.runTurn(buildRequest());
    const paused: AIRunPausedState = pausedStateOf(first);
    expect(paused.recordsSeenBeforeTurn).toHaveLength(1);

    // While the card waits, the person adds a step; approving makes the change on top of it.
    addSlackInTheBuilder();

    // Then the model changes Log b, from what it read and what it made: no Slack step in it.
    const second: WorkflowDraft = {
      ...addLogB(read),
      steps: addLogB(read).steps.map((step: WorkflowDraftStep) => {
        return step.id === "log-b"
          ? { ...step, arguments: { value: "b2" } }
          : step;
      }),
    };
    const spies: Spies = await resumeWith({
      paused,
      approved: ["call-a"],
      turns: [
        { answer: response({ toolCalls: [UPDATE_CALL(second, "call-b")] }) },
      ],
    });

    expect(nodeOf(server.graph, "slack-1")).toBeDefined();
    const actions: Array<AIChatToolAction> = toolActionsOf(spies);
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Executed);
    expect(actions[1]!.description).toBe(
      `Removes Send Message to Slack. Changes Log. ${UNDOES_SLACK}`,
    );
    // The turn paused again keeps what it was given.
    expect(pausedStateOf(spies).recordsSeenBeforeTurn).toEqual(
      paused.recordsSeenBeforeTurn,
    );
  });

  test("resumed, a change from what it read and what it made itself says nothing more", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          answer: response({
            toolCalls: [UPDATE_CALL(addLogB(read), "call-a")],
          }),
        },
      ],
    });
    await ChatAgentRunner.runTurn(buildRequest());

    const second: WorkflowDraft = {
      ...addLogB(read),
      steps: addLogB(read).steps.map((step: WorkflowDraftStep) => {
        return step.id === "log-b"
          ? { ...step, arguments: { value: "b2" } }
          : step;
      }),
    };
    const spies: Spies = await resumeWith({
      paused: pausedStateOf(first),
      approved: ["call-a"],
      turns: [
        { answer: response({ toolCalls: [UPDATE_CALL(second, "call-b")] }) },
      ],
    });

    const actions: Array<AIChatToolAction> = toolActionsOf(spies);
    expect(actions[1]!.status).toBe(AIChatToolActionStatus.Pending);
    expect(actions[1]!.description).toBe("Changes Log.");
  });
});

describe("Auto-run: a change that would undo a save it never saw is not made unasked", () => {
  test("not made: the model is told why, reads the workflow again, and makes its change on the workflow as it is", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: addSlackInTheBuilder,
          answer: response({
            toolCalls: [UPDATE_CALL(addLogB(read), "call-stale")],
          }),
        },
        { answer: response({ toolCalls: [READ_CALL("call-read-again")] }) },
        {
          // Written from the read it just made.
          answer: (): AILogResponse => {
            return response({
              toolCalls: [UPDATE_CALL(addLogB(asRead()), "call-fresh")],
            });
          },
        },
        {
          answer: response({
            content: "Added a Log after Log a, and kept your Slack step.",
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    // The model was told, in so many words.
    expect(toldModel(spies, "call-stale")).toBe(
      `Not done: ${describeSavedSinceRead('"Send Message to Slack" (slack-1)')}`,
    );

    // One save: the change made on the workflow as it is, the Slack step kept.
    expect(spies.workflowUpdate).toHaveBeenCalledTimes(1);
    expect(nodeOf(server.graph, "slack-1")).toBeDefined();
    expect(nodeOf(server.graph, "log-b")).toBeDefined();

    const actions: Array<AIChatToolAction> = toolActionsOf(spies);
    expect(
      actions.map((action: AIChatToolAction) => {
        return [action.id, action.status];
      }),
    ).toEqual([
      ["call-stale", AIChatToolActionStatus.Skipped],
      ["call-fresh", AIChatToolActionStatus.Executed],
    ]);
    expect(actions[0]!.resultSummary).toBe(
      UNSEEN_CHANGE_SUMMARIES.savedSinceRead,
    );
    expect(actions[0]!.requiresApproval).toBe(false);
    // Its record says what it would have done.
    expect(actions[0]!.description).toBe(
      `Adds Log. Removes Send Message to Slack. ${UNDOES_SLACK}`,
    );

    // The activity says it was not done.
    const failed: Array<JSONObject> = spies.eventCreate.mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as { data: JSONObject }).data;
      })
      .filter((event: JSONObject) => {
        return (
          event["eventType"] === AIRunEventType.ToolCallFailed &&
          event["toolName"] === "update_workflow"
        );
      });
    expect(failed).toHaveLength(1);
    expect((failed[0]!["resultSummary"] as JSONObject)["isAction"]).toBe(true);
  });

  test("nothing saved since the read: it runs at once, as Auto-run always did", async () => {
    startServer();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        { answer: response({ toolCalls: [UPDATE_CALL(addLogB(asRead()))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(spies.workflowUpdate).toHaveBeenCalledTimes(1);
    expect(toolActionsOf(spies)[0]!.status).toBe(
      AIChatToolActionStatus.Executed,
    );
    expect(toolActionsOf(spies)[0]!.description).toBe("Adds Log.");
  });

  test("a model that keeps proposing from its old read is turned back each time, and nothing is ever saved", async () => {
    startServer();
    const read: WorkflowDraft = asRead();
    const stale: Turn = {
      answer: response({
        toolCalls: [UPDATE_CALL(addLogB(read), "call-again")],
      }),
    };
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: addSlackInTheBuilder,
          answer: response({
            toolCalls: [UPDATE_CALL(addLogB(read), "call-1")],
          }),
        },
        {
          answer: response({
            toolCalls: [UPDATE_CALL(addLogB(read), "call-2")],
          }),
        },
        stale,
        { answer: response({ content: "I could not make the change." }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(spies.workflowUpdate).not.toHaveBeenCalled();
    expect(nodeOf(server.graph, "slack-1")).toBeDefined();
    expect(
      toolActionsOf(spies).map((action: AIChatToolAction) => {
        return action.status;
      }),
    ).toEqual([
      AIChatToolActionStatus.Skipped,
      AIChatToolActionStatus.Skipped,
      AIChatToolActionStatus.Skipped,
    ]);
  });
});
