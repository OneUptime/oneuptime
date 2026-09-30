import InvestigationThreadService, {
  DEFAULT_THREAD_PERMISSION_MODE,
  InvestigationThreadSendResult,
  MAX_THREAD_MESSAGE_LENGTH,
} from "../../../../Server/Utils/AI/SRE/InvestigationThreadService";
import InvestigationThread, {
  INVESTIGATION_THREAD_FEATURE,
  InvestigationThreadSubject,
} from "../../../../Server/Utils/AI/SRE/InvestigationThread";
import ChatAgentRunner, {
  ChatTurnRequest,
  ResumeToolDecision,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ChatRunCancellation from "../../../../Server/Utils/AI/Chat/ChatRunCancellation";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import ProjectService from "../../../../Server/Services/ProjectService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import { AI_DISABLED_MESSAGE } from "../../../../Server/Services/AIService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import AIChatMessageRole from "../../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The investigation box's conversation, end to end below the HTTP layer:
 * who may ask and when, how a question becomes a run and two message rows,
 * that a turn runs as a shared thread with its incident's context, that
 * approvals are explicit and run under the decider's permissions, and that
 * the view each responder gets never leaks another asker's raw rows.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const THREAD_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ASKER_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const VIEWER_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);
const RUN_ID: ObjectID = new ObjectID("ffffffff-ffff-4fff-8fff-ffffffffffff");
const ASSISTANT_MESSAGE_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);

const SUBJECT: InvestigationThreadSubject = {
  type: "incident",
  id: INCIDENT_ID,
};

const ASKER_PROPS: DatabaseCommonInteractionProps = {
  userId: ASKER_ID,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

function thread(): AIConversation {
  const conversation: AIConversation = new AIConversation(THREAD_ID);
  conversation.incidentId = INCIDENT_ID;
  return conversation;
}

function flush(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

function withId<T extends { id?: ObjectID | null }>(model: T): T {
  if (!model.id) {
    (model as { _id?: string })._id = ObjectID.generate().toString();
  }
  return model;
}

describe("InvestigationThreadService.sendMessage", () => {
  let createdRuns: Array<AIRun>;
  let createdMessages: Array<AIConversationMessage>;
  let runTurn: jest.SpyInstance;

  beforeEach(() => {
    createdRuns = [];
    createdMessages = [];

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      (() => {
        const project: Project = new Project(PROJECT_ID);
        project.enableAi = true;
        return project;
      })() as never,
    );
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(new LlmProvider() as never);
    jest.spyOn(InvestigationThread, "getSubjectDetails").mockResolvedValue({
      label: "Incident #42",
      title: "Node memory at 93%",
      summary: "# Incident #42",
      pageContext: {} as never,
    } as never);
    jest
      .spyOn(InvestigationThread, "findOrCreateThread")
      .mockResolvedValue(thread() as never);
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null as never);
    jest.spyOn(AIRunService, "create").mockImplementation((async (args: {
      data: AIRun;
    }) => {
      args.data.id = RUN_ID;
      createdRuns.push(args.data);
      return args.data;
    }) as never);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([
      (() => {
        const run: AIRun = new AIRun(RUN_ID);
        return run;
      })(),
    ] as never);
    jest
      .spyOn(AIConversationMessageService, "create")
      .mockImplementation((async (args: { data: AIConversationMessage }) => {
        createdMessages.push(withId(args.data));
        return args.data;
      }) as never);
    jest
      .spyOn(AIConversationService, "updateOneById")
      .mockResolvedValue(1 as never);
    jest.spyOn(InvestigationThread, "buildTurnContext").mockResolvedValue({
      additionalSystemInstructions: "# This conversation",
      extraTools: [],
      pageContext: { type: "Incident", entityId: INCIDENT_ID.toString() },
      title: "Incident #42",
    } as never);
    runTurn = jest
      .spyOn(ChatAgentRunner, "runTurn")
      .mockResolvedValue(undefined as never);
  });

  async function send(
    overrides?: Partial<
      Parameters<typeof InvestigationThreadService.sendMessage>[0]
    >,
  ): Promise<InvestigationThreadSendResult> {
    return InvestigationThreadService.sendMessage({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      userId: ASKER_ID,
      props: ASKER_PROPS,
      content: "  Which pods use the most memory?  ",
      ...overrides,
    });
  }

  test("creates the run and both messages, then runs the turn as a shared thread", async () => {
    const result: InvestigationThreadSendResult = await send();
    await flush();

    expect(result.conversationId.toString()).toBe(THREAD_ID.toString());
    expect(result.aiRunId.toString()).toBe(RUN_ID.toString());

    expect(createdRuns).toHaveLength(1);
    expect(createdRuns[0]!.runType).toBe(AIRunType.Chat);
    expect(createdRuns[0]!.status).toBe(AIRunStatus.Running);
    expect(createdRuns[0]!.userId?.toString()).toBe(ASKER_ID.toString());
    expect(createdRuns[0]!.conversationId?.toString()).toBe(
      THREAD_ID.toString(),
    );

    const [question, answer] = createdMessages;
    expect(question!.role).toBe(AIChatMessageRole.User);
    expect(question!.contentInMarkdown).toBe("Which pods use the most memory?");
    expect(question!.userId?.toString()).toBe(ASKER_ID.toString());
    expect(answer!.role).toBe(AIChatMessageRole.Assistant);
    expect(answer!.status).toBe(AIChatMessageStatus.InProgress);
    // The answer is attributed to the asker it answers.
    expect(answer!.userId?.toString()).toBe(ASKER_ID.toString());
    expect(answer!.aiRunId?.toString()).toBe(RUN_ID.toString());

    expect(runTurn).toHaveBeenCalledTimes(1);
    const turn: ChatTurnRequest = runTurn.mock.calls[0]![0] as ChatTurnRequest;
    expect(turn.isSharedThread).toBe(true);
    expect(turn.feature).toBe(INVESTIGATION_THREAD_FEATURE);
    expect(turn.additionalSystemInstructions).toBe("# This conversation");
    expect(turn.pageContext?.entityId).toBe(INCIDENT_ID.toString());
    expect(turn.props).toBe(ASKER_PROPS);
    expect(turn.userId.toString()).toBe(ASKER_ID.toString());
    expect(turn.aiRunId.toString()).toBe(RUN_ID.toString());
  });

  test("acts on clear requests by default (auto-run)", async () => {
    await send();
    await flush();

    expect(DEFAULT_THREAD_PERMISSION_MODE).toBe(AIChatPermissionMode.AutoRun);
    expect((runTurn.mock.calls[0]![0] as ChatTurnRequest).permissionMode).toBe(
      AIChatPermissionMode.AutoRun,
    );
  });

  test("uses the mode the asker chose", async () => {
    await send({ permissionMode: AIChatPermissionMode.AskForApproval });
    await flush();

    expect((runTurn.mock.calls[0]![0] as ChatTurnRequest).permissionMode).toBe(
      AIChatPermissionMode.AskForApproval,
    );
  });

  test("ignores an unknown mode and falls back to the default", async () => {
    await send({ permissionMode: "Sudo" });
    await flush();

    expect((runTurn.mock.calls[0]![0] as ChatTurnRequest).permissionMode).toBe(
      DEFAULT_THREAD_PERMISSION_MODE,
    );
  });

  test("a context that cannot be built still answers the question", async () => {
    (
      InvestigationThread.buildTurnContext as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("db down") as never);

    await send();
    await flush();

    const turn: ChatTurnRequest = runTurn.mock.calls[0]![0] as ChatTurnRequest;
    expect(turn.isSharedThread).toBe(true);
    expect(turn.additionalSystemInstructions).toBeUndefined();
    expect(turn.extraTools).toBeUndefined();
  });

  test.each([[""], ["   "]])(
    "refuses an empty question %p",
    async (content: string) => {
      await expect(send({ content })).rejects.toThrow(BadDataException);
      expect(createdRuns).toHaveLength(0);
    },
  );

  test("refuses a question over the length limit", async () => {
    await expect(
      send({ content: "x".repeat(MAX_THREAD_MESSAGE_LENGTH + 1) }),
    ).rejects.toThrow("too long");
  });

  test("refuses when AI is turned off for the project", async () => {
    (
      ProjectService.findOneById as unknown as jest.SpyInstance
    ).mockResolvedValue(
      (() => {
        const project: Project = new Project(PROJECT_ID);
        project.enableAi = false;
        return project;
      })() as never,
    );

    await expect(send()).rejects.toThrow(AI_DISABLED_MESSAGE);
    expect(createdRuns).toHaveLength(0);
  });

  test("refuses with a clear next step when no AI model is set up", async () => {
    (
      LlmProviderService.getLLMProviderForProject as unknown as jest.SpyInstance
    ).mockResolvedValue(null as never);

    await expect(send()).rejects.toThrow("No AI model is set up");
    expect(createdRuns).toHaveLength(0);
  });

  test("waits while another question is being answered", async () => {
    const busy: AIRun = new AIRun(ObjectID.generate());
    busy.status = AIRunStatus.Running;
    (AIRunService.findOneBy as unknown as jest.SpyInstance).mockResolvedValue(
      busy as never,
    );

    await expect(send()).rejects.toThrow("still answering");
    expect(createdRuns).toHaveLength(0);
    expect(runTurn).not.toHaveBeenCalled();
  });

  test("waits while an action is pending approval", async () => {
    const paused: AIRun = new AIRun(ObjectID.generate());
    paused.status = AIRunStatus.WaitingForApproval;
    (AIRunService.findOneBy as unknown as jest.SpyInstance).mockResolvedValue(
      paused as never,
    );

    await expect(send()).rejects.toThrow("approve or deny");
  });

  test("the loser of a simultaneous send cancels itself and says so", async () => {
    (AIRunService.findBy as unknown as jest.SpyInstance).mockResolvedValue([
      new AIRun(ObjectID.generate()), // the other responder's run is older
      new AIRun(RUN_ID),
    ] as never);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(1 as never);

    await expect(send()).rejects.toThrow("someone else's question");

    const cancel: { id: ObjectID; data: JSONObject } = updateOneById.mock
      .calls[0]![0] as never;
    expect(cancel.id.toString()).toBe(RUN_ID.toString());
    expect(cancel.data["status"]).toBe(AIRunStatus.Cancelled);
    expect(createdMessages).toHaveLength(0);
    expect(runTurn).not.toHaveBeenCalled();
  });
});

describe("InvestigationThreadService.parseDecisions", () => {
  const pending: Array<AIChatToolAction> = [
    {
      id: "call-1",
      toolName: "acknowledge_incident",
      title: "Acknowledge incident",
      arguments: {},
      isMutation: true,
      requiresApproval: true,
      status: AIChatToolActionStatus.Pending,
    },
    {
      id: "call-2",
      toolName: "post_incident_status_update",
      title: "Post status update",
      arguments: {},
      isMutation: true,
      requiresApproval: true,
      status: AIChatToolActionStatus.Pending,
    },
  ];

  test("an approve-all applies to every pending action", () => {
    expect(
      InvestigationThreadService.parseDecisions({
        pendingActions: pending,
        approved: true,
      }),
    ).toEqual([
      { toolCallId: "call-1", approved: true },
      { toolCallId: "call-2", approved: true },
    ]);
  });

  test("per-action decisions keep only pending ids, and approval must be literally true", () => {
    expect(
      InvestigationThreadService.parseDecisions({
        pendingActions: pending,
        decisions: [
          { toolCallId: "call-1", approved: "yes" },
          { toolCallId: "call-2", approved: true },
          { toolCallId: "call-99", approved: true },
          null,
          "garbage",
        ] as unknown as JSONArray,
      }),
    ).toEqual([
      { toolCallId: "call-1", approved: false },
      { toolCallId: "call-2", approved: true },
    ]);
  });

  test("requires a decision shape", () => {
    expect(() => {
      return InvestigationThreadService.parseDecisions({
        pendingActions: pending,
      });
    }).toThrow("decisions");
  });

  test("refuses when nothing is pending", () => {
    expect(() => {
      return InvestigationThreadService.parseDecisions({
        pendingActions: [],
        approved: true,
      });
    }).toThrow("no actions waiting");
  });
});

describe("InvestigationThreadService.respondToApproval", () => {
  let resumeTurn: jest.SpyInstance;

  function waitingMessage(): AIConversationMessage {
    const message: AIConversationMessage = new AIConversationMessage(
      ASSISTANT_MESSAGE_ID,
    );
    message.status = AIChatMessageStatus.WaitingForApproval;
    message.aiRunId = RUN_ID;
    message.toolActions = [
      {
        id: "call-1",
        toolName: "acknowledge_incident",
        title: "Acknowledge incident",
        arguments: {},
        isMutation: true,
        requiresApproval: true,
        status: AIChatToolActionStatus.Pending,
      },
    ];
    return message;
  }

  beforeEach(() => {
    jest
      .spyOn(InvestigationThread, "findThread")
      .mockResolvedValue(thread() as never);
    jest
      .spyOn(AIConversationMessageService, "findOneBy")
      .mockResolvedValue(waitingMessage() as never);
    const run: AIRun = new AIRun(RUN_ID);
    run.status = AIRunStatus.WaitingForApproval;
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run as never);
    jest.spyOn(InvestigationThread, "buildTurnContext").mockResolvedValue({
      additionalSystemInstructions: "# This conversation",
      extraTools: [],
      pageContext: { type: "Incident", entityId: INCIDENT_ID.toString() },
      title: "Incident #42",
    } as never);
    resumeTurn = jest
      .spyOn(ChatAgentRunner, "resumeTurn")
      .mockResolvedValue(undefined as never);
  });

  const deciderProps: DatabaseCommonInteractionProps = {
    userId: VIEWER_ID,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;

  test("resumes the paused turn under the decider's own permissions", async () => {
    await InvestigationThreadService.respondToApproval({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      userId: VIEWER_ID,
      props: deciderProps,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      approved: true,
    });
    await flush();

    expect(resumeTurn).toHaveBeenCalledTimes(1);
    const [turn, decisions] = resumeTurn.mock.calls[0]! as [
      ChatTurnRequest,
      Array<ResumeToolDecision>,
    ];

    expect(turn.props).toBe(deciderProps);
    expect(turn.userId.toString()).toBe(VIEWER_ID.toString());
    expect(turn.aiRunId.toString()).toBe(RUN_ID.toString());
    expect(turn.isSharedThread).toBe(true);
    expect(turn.permissionMode).toBe(AIChatPermissionMode.AskForApproval);
    expect(decisions).toEqual([{ toolCallId: "call-1", approved: true }]);
  });

  test("only finds the message inside this subject's thread", async () => {
    await InvestigationThreadService.respondToApproval({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      userId: VIEWER_ID,
      props: deciderProps,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      approved: false,
    });

    const query: JSONObject = (
      (AIConversationMessageService.findOneBy as unknown as jest.SpyInstance)
        .mock.calls[0]![0] as { query: JSONObject }
    ).query;

    expect(query["conversationId"]).toEqual(THREAD_ID);
    expect(query["projectId"]).toEqual(PROJECT_ID);
  });

  test("a message from another thread is not found", async () => {
    (
      AIConversationMessageService.findOneBy as unknown as jest.SpyInstance
    ).mockResolvedValue(null as never);

    await expect(
      InvestigationThreadService.respondToApproval({
        projectId: PROJECT_ID,
        subject: SUBJECT,
        userId: VIEWER_ID,
        props: deciderProps,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
        approved: true,
      }),
    ).rejects.toThrow("not found");
    expect(resumeTurn).not.toHaveBeenCalled();
  });

  test("a decision already made by someone else is refused", async () => {
    const run: AIRun = new AIRun(RUN_ID);
    run.status = AIRunStatus.Running;
    (AIRunService.findOneBy as unknown as jest.SpyInstance).mockResolvedValue(
      run as never,
    );

    await expect(
      InvestigationThreadService.respondToApproval({
        projectId: PROJECT_ID,
        subject: SUBJECT,
        userId: VIEWER_ID,
        props: deciderProps,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
        approved: true,
      }),
    ).rejects.toThrow("no longer waiting");
    expect(resumeTurn).not.toHaveBeenCalled();
  });

  test("a thread that does not exist yet has nothing to approve", async () => {
    (
      InvestigationThread.findThread as unknown as jest.SpyInstance
    ).mockResolvedValue(null as never);

    await expect(
      InvestigationThreadService.respondToApproval({
        projectId: PROJECT_ID,
        subject: SUBJECT,
        userId: VIEWER_ID,
        props: deciderProps,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
        approved: true,
      }),
    ).rejects.toThrow("no messages yet");
  });
});

describe("InvestigationThreadService.cancelRun", () => {
  test("stops the thread's answer in flight", async () => {
    jest
      .spyOn(InvestigationThread, "findThread")
      .mockResolvedValue(thread() as never);
    const cancelActiveRun: jest.SpyInstance = jest
      .spyOn(ChatRunCancellation, "cancelActiveRun")
      .mockResolvedValue({ aiRunId: RUN_ID, cancelled: true } as never);

    await expect(
      InvestigationThreadService.cancelRun({
        projectId: PROJECT_ID,
        subject: SUBJECT,
        userId: VIEWER_ID,
      }),
    ).resolves.toEqual({ aiRunId: RUN_ID, cancelled: true });

    expect(cancelActiveRun).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      conversationId: THREAD_ID,
      userId: VIEWER_ID,
    });
  });

  test("says so when nothing is being answered", async () => {
    jest
      .spyOn(InvestigationThread, "findThread")
      .mockResolvedValue(thread() as never);
    jest
      .spyOn(ChatRunCancellation, "cancelActiveRun")
      .mockResolvedValue(null as never);

    await expect(
      InvestigationThreadService.cancelRun({
        projectId: PROJECT_ID,
        subject: SUBJECT,
        userId: VIEWER_ID,
      }),
    ).rejects.toThrow("not answering anything");
  });

  test("a subject with no thread has nothing to stop", async () => {
    jest
      .spyOn(InvestigationThread, "findThread")
      .mockResolvedValue(null as never);
    const cancelActiveRun: jest.SpyInstance = jest.spyOn(
      ChatRunCancellation,
      "cancelActiveRun",
    );

    await expect(
      InvestigationThreadService.cancelRun({
        projectId: PROJECT_ID,
        subject: SUBJECT,
        userId: VIEWER_ID,
      }),
    ).rejects.toThrow(BadDataException);
    expect(cancelActiveRun).not.toHaveBeenCalled();
  });
});

describe("InvestigationThreadService.getView", () => {
  function question(
    content: string,
    userId: ObjectID,
    name: string,
  ): AIConversationMessage {
    const message: AIConversationMessage = new AIConversationMessage(
      ObjectID.generate(),
    );
    message.role = AIChatMessageRole.User;
    message.status = AIChatMessageStatus.Completed;
    message.contentInMarkdown = content;
    message.userId = userId;
    message.createdAt = new Date("2026-09-30T10:00:00.000Z");
    const user: User = new User(userId);
    user.name = new Name(name);
    message.user = user;
    return message;
  }

  function answer(data: {
    userId: ObjectID;
    status: AIChatMessageStatus;
    widgets?: Array<AIChatWidget>;
  }): AIConversationMessage {
    const message: AIConversationMessage = new AIConversationMessage(
      ObjectID.generate(),
    );
    message.role = AIChatMessageRole.Assistant;
    message.status = data.status;
    message.contentInMarkdown = "ClickHouse uses 120Gi [C1].";
    message.userId = data.userId;
    message.aiRunId = RUN_ID;
    message.widgets = data.widgets || [];
    return message;
  }

  const widget: AIChatWidget = {
    id: "W1",
    type: AIChatWidgetType.Table,
    title: "Top pods",
    data: {},
  };

  test("an empty thread says nobody has asked", async () => {
    jest
      .spyOn(InvestigationThread, "findThread")
      .mockResolvedValue(null as never);

    await expect(
      InvestigationThreadService.getView({
        projectId: PROJECT_ID,
        subject: SUBJECT,
        viewerUserId: VIEWER_ID,
      }),
    ).resolves.toEqual({
      conversationId: null,
      messages: [],
      activeRun: null,
      isBusy: false,
    });
  });

  test("lists messages oldest first with who asked, and shows raw widgets only to the asker", async () => {
    jest
      .spyOn(InvestigationThread, "findThread")
      .mockResolvedValue(thread() as never);
    // Newest first, as the query sorts.
    jest.spyOn(AIConversationMessageService, "findBy").mockResolvedValue([
      answer({
        userId: VIEWER_ID,
        status: AIChatMessageStatus.Completed,
        widgets: [widget],
      }),
      question("And for me?", VIEWER_ID, "Sam Lee"),
      answer({
        userId: ASKER_ID,
        status: AIChatMessageStatus.Completed,
        widgets: [widget],
      }),
      question("Which pods use the most memory?", ASKER_ID, "Priya Shah"),
    ] as never);

    const view: JSONObject = await InvestigationThreadService.getView({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      viewerUserId: VIEWER_ID,
    });

    const messages: Array<JSONObject> = view["messages"] as Array<JSONObject>;

    expect(view["conversationId"]).toBe(THREAD_ID.toString());
    expect(view["isBusy"]).toBe(false);
    expect(view["activeRun"]).toBeNull();
    expect(
      messages.map((message: JSONObject) => {
        return message["contentInMarkdown"];
      }),
    ).toEqual([
      "Which pods use the most memory?",
      "ClickHouse uses 120Gi [C1].",
      "And for me?",
      "ClickHouse uses 120Gi [C1].",
    ]);
    expect(messages[0]!["author"]).toEqual({
      userId: ASKER_ID.toString(),
      name: "Priya Shah",
    });
    // Priya's answer's raw rows are not shown to Sam...
    expect(messages[1]!["widgets"]).toEqual([]);
    // ...but Sam sees his own.
    expect((messages[3]!["widgets"] as JSONArray).length).toBe(1);
  });

  test("reads only this thread in this project, as root", async () => {
    jest
      .spyOn(InvestigationThread, "findThread")
      .mockResolvedValue(thread() as never);
    const findBy: jest.SpyInstance = jest
      .spyOn(AIConversationMessageService, "findBy")
      .mockResolvedValue([] as never);

    await InvestigationThreadService.getView({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      viewerUserId: VIEWER_ID,
    });

    const args: { query: JSONObject; props: JSONObject } = findBy.mock
      .calls[0]![0] as never;
    expect(args.query["conversationId"]).toEqual(THREAD_ID);
    expect(args.query["projectId"]).toEqual(PROJECT_ID);
    expect(args.props).toEqual({ isRoot: true });
  });

  test("an answer in flight comes with its run and live steps, without tool arguments", async () => {
    jest
      .spyOn(InvestigationThread, "findThread")
      .mockResolvedValue(thread() as never);
    const inFlight: AIConversationMessage = answer({
      userId: ASKER_ID,
      status: AIChatMessageStatus.InProgress,
    });
    jest
      .spyOn(AIConversationMessageService, "findBy")
      .mockResolvedValue([
        inFlight,
        question("Which pods?", ASKER_ID, "Priya Shah"),
      ] as never);
    const run: AIRun = new AIRun(RUN_ID);
    run.status = AIRunStatus.Running;
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run as never);
    const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
    event.eventType = AIRunEventType.ToolCallStarted;
    event.toolName = "run_kubectl";
    event.sequence = 1;
    const findEvents: jest.SpyInstance = jest
      .spyOn(AIRunEventService, "findBy")
      .mockResolvedValue([event] as never);

    const view: JSONObject = await InvestigationThreadService.getView({
      projectId: PROJECT_ID,
      subject: SUBJECT,
      viewerUserId: VIEWER_ID,
    });

    const activeRun: JSONObject = view["activeRun"] as JSONObject;
    expect(view["isBusy"]).toBe(true);
    expect(activeRun["aiRunId"]).toBe(RUN_ID.toString());
    expect(activeRun["assistantMessageId"]).toBe(inFlight.id!.toString());
    expect(activeRun["status"]).toBe(AIRunStatus.Running);
    expect((activeRun["events"] as JSONArray).length).toBe(1);

    const eventSelect: JSONObject = (
      findEvents.mock.calls[0]![0] as { select: JSONObject }
    ).select;
    expect(eventSelect["toolArguments"]).toBeUndefined();
    expect(eventSelect["toolName"]).toBe(true);
  });
});
