import {
  AI_DISPLAY_NAME,
  DEFAULT_THREAD_PERMISSION_MODE,
  EMPTY_THREAD_VIEW,
  MAX_THREAD_QUESTION_LENGTH,
  SuggestedPrompt,
  ThreadMessage,
  ThreadView,
  buildOptimisticQuestion,
  describeAuthor,
  describeAuthorPossessive,
  describePermissionMode,
  describeThreadActivity,
  findActiveAssistantMessage,
  getAvatarTone,
  getInitials,
  getSendBlocker,
  getSuggestedPrompts,
  getThreadSignature,
  getVisibleWidgets,
  hasPendingApproval,
  isThreadBusy,
  isViewer,
  parseStoredPermissionMode,
  parseThreadMessage,
  parseThreadView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/InvestigationConversationData";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "../../../Types/AI/AIChatPermissionMode";
import {
  AIChatToolActionStatus,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The decisions the investigation box's conversation makes about its
 * thread, without rendering anything: parsing what the API sends (and
 * surviving what it should not), who is asking, whether the viewer may
 * send, and what raw data each viewer may see.
 */

const PRIYA: string = "11111111-1111-4111-8111-111111111111";
const SAM: string = "22222222-2222-4222-8222-222222222222";
const RUN: string = "33333333-3333-4333-8333-333333333333";

function messageJson(overrides: JSONObject): JSONObject {
  return {
    _id: "44444444-4444-4444-8444-444444444444",
    role: AIChatMessageRole.User,
    contentInMarkdown: "Which pods use the most memory?",
    status: AIChatMessageStatus.Completed,
    citations: [],
    widgets: [],
    toolActions: [],
    errorMessage: null,
    aiRunId: null,
    createdAt: "2026-09-30T10:00:00.000Z",
    author: { userId: PRIYA, name: "Priya Shah" },
    ...overrides,
  };
}

function message(overrides: Partial<ThreadMessage>): ThreadMessage {
  return {
    id: "m1",
    role: AIChatMessageRole.User,
    content: "hi",
    status: AIChatMessageStatus.Completed,
    citations: [],
    widgets: [],
    toolActions: [],
    errorMessage: null,
    aiRunId: null,
    createdAt: null,
    author: { userId: PRIYA, name: "Priya Shah" },
    ...overrides,
  };
}

function view(overrides: Partial<ThreadView>): ThreadView {
  return { ...EMPTY_THREAD_VIEW, ...overrides };
}

describe("parseThreadMessage", () => {
  test("parses a question with its author and time", () => {
    const parsed: ThreadMessage | null = parseThreadMessage(messageJson({}));

    expect(parsed).toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      role: AIChatMessageRole.User,
      content: "Which pods use the most memory?",
      status: AIChatMessageStatus.Completed,
      citations: [],
      widgets: [],
      toolActions: [],
      errorMessage: null,
      aiRunId: null,
      createdAt: new Date("2026-09-30T10:00:00.000Z"),
      author: { userId: PRIYA, name: "Priya Shah" },
    });
  });

  test.each([
    [{ _id: null }],
    [{ role: "System" }],
    [{ status: "Exploded" }],
    [{ role: undefined }],
  ])("drops a malformed message %p", (overrides: JSONObject) => {
    expect(parseThreadMessage(messageJson(overrides))).toBeNull();
  });

  test("defaults what is missing instead of failing", () => {
    const parsed: ThreadMessage = parseThreadMessage(
      messageJson({
        contentInMarkdown: 42,
        citations: "nope",
        createdAt: "not a date",
        author: null,
      }),
    )!;

    expect(parsed.content).toBe("");
    expect(parsed.citations).toEqual([]);
    expect(parsed.createdAt).toBeNull();
    expect(parsed.author).toEqual({ userId: null, name: "A responder" });
  });
});

describe("parseThreadView", () => {
  test("an empty or broken payload is an empty thread", () => {
    expect(parseThreadView(null)).toBe(EMPTY_THREAD_VIEW);
    expect(parseThreadView(undefined)).toBe(EMPTY_THREAD_VIEW);
  });

  test("parses messages, the viewer and the answer in flight", () => {
    const parsed: ThreadView = parseThreadView({
      conversationId: "55555555-5555-4555-8555-555555555555",
      messages: [
        messageJson({}),
        messageJson({ _id: null }),
        "garbage",
        messageJson({
          _id: "66666666-6666-4666-8666-666666666666",
          role: AIChatMessageRole.Assistant,
          status: AIChatMessageStatus.InProgress,
          contentInMarkdown: "",
          aiRunId: RUN,
        }),
      ],
      activeRun: {
        aiRunId: RUN,
        assistantMessageId: "66666666-6666-4666-8666-666666666666",
        status: AIRunStatus.Running,
        startedAt: "2026-09-30T10:00:01.000Z",
        events: [
          {
            _id: "77777777-7777-4777-8777-777777777777",
            sequence: 1,
            eventType: AIRunEventType.ToolCallStarted,
            toolName: "run_kubectl",
          },
        ],
      },
      isBusy: true,
      viewerUserId: SAM,
    });

    expect(parsed.conversationId).toBe("55555555-5555-4555-8555-555555555555");
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.isBusy).toBe(true);
    expect(parsed.viewerUserId).toBe(SAM);
    expect(parsed.activeRun?.aiRunId).toBe(RUN);
    expect(parsed.activeRun?.status).toBe(AIRunStatus.Running);
    expect(parsed.activeRun?.events).toHaveLength(1);
    expect(parsed.activeRun?.events[0]!.toolName).toBe("run_kubectl");
    expect(parsed.activeRun?.startedAt).toEqual(
      new Date("2026-09-30T10:00:01.000Z"),
    );
  });

  test("an unknown run status is kept as unknown, not trusted", () => {
    const parsed: ThreadView = parseThreadView({
      activeRun: { aiRunId: RUN, status: "Hacked", events: [] },
    });

    expect(parsed.activeRun?.status).toBeNull();
  });

  test("an active run without an id is ignored", () => {
    expect(
      parseThreadView({ activeRun: { status: AIRunStatus.Running } }).activeRun,
    ).toBeNull();
  });
});

describe("getThreadSignature", () => {
  const base: ThreadView = view({
    conversationId: "c",
    messages: [message({})],
  });

  test("is stable for the same thread", () => {
    expect(getThreadSignature(base)).toBe(
      getThreadSignature(
        view({ conversationId: "c", messages: [message({})] }),
      ),
    );
  });

  test.each([
    ["a new message", { messages: [message({}), message({ id: "m2" })] }],
    [
      "a status change",
      { messages: [message({ status: AIChatMessageStatus.Error })] },
    ],
    ["an answer growing", { messages: [message({ content: "hi there" })] }],
    ["a busy flag", { isBusy: true }],
    [
      "an action decided",
      {
        messages: [
          message({
            toolActions: [
              {
                id: "a",
                toolName: "t",
                title: "t",
                arguments: {},
                isMutation: true,
                requiresApproval: true,
                status: AIChatToolActionStatus.Executed,
              },
            ],
          }),
        ],
      },
    ],
    [
      "a new live step",
      {
        activeRun: {
          aiRunId: RUN,
          assistantMessageId: null,
          status: AIRunStatus.Running,
          startedAt: null,
          events: [{} as never],
        },
      },
    ],
  ])("changes with %s", (_label: string, overrides: Partial<ThreadView>) => {
    expect(getThreadSignature({ ...base, ...overrides })).not.toBe(
      getThreadSignature(base),
    );
  });
});

describe("who is asking", () => {
  test("the viewer is 'You'; everyone else by name", () => {
    expect(isViewer({ userId: PRIYA, name: "Priya" }, PRIYA)).toBe(true);
    expect(isViewer({ userId: PRIYA, name: "Priya" }, SAM)).toBe(false);
    expect(isViewer({ userId: null, name: "Priya" }, null)).toBe(false);
    expect(describeAuthor({ userId: PRIYA, name: "Priya" }, PRIYA)).toBe("You");
    expect(describeAuthor({ userId: PRIYA, name: "Priya" }, SAM)).toBe("Priya");
  });

  test("possessives read naturally", () => {
    expect(
      describeAuthorPossessive({ userId: PRIYA, name: "Priya" }, PRIYA),
    ).toBe("your");
    expect(
      describeAuthorPossessive({ userId: PRIYA, name: "Priya" }, SAM),
    ).toBe("Priya's");
    expect(
      describeAuthorPossessive({ userId: SAM, name: "James" }, PRIYA),
    ).toBe("James'");
    expect(describeAuthorPossessive({ userId: SAM, name: " " }, PRIYA)).toBe(
      "a responder's",
    );
  });

  test("initials from names and emails", () => {
    expect(getInitials("Priya Shah")).toBe("PS");
    expect(getInitials("priya")).toBe("P");
    expect(getInitials("sam.lee@example.com")).toBe("SL");
    expect(getInitials("")).toBe("?");
    expect(getInitials("  Ünal  Öz ")).toBe("ÜÖ");
  });

  test("each responder keeps one avatar colour", () => {
    expect(getAvatarTone(PRIYA)).toBe(getAvatarTone(PRIYA));
    expect(getAvatarTone(PRIYA)).toMatch(/^bg-\w+-100 text-\w+-[78]00$/);
  });
});

describe("thread activity", () => {
  const working: ThreadMessage = message({
    id: "a1",
    role: AIChatMessageRole.Assistant,
    status: AIChatMessageStatus.InProgress,
    author: { userId: PRIYA, name: "Priya Shah" },
  });

  test("an idle thread", () => {
    const idle: ThreadView = view({ messages: [message({})] });

    expect(findActiveAssistantMessage(idle)).toBeUndefined();
    expect(isThreadBusy(idle)).toBe(false);
    expect(describeThreadActivity(idle)).toBeNull();
  });

  test("names whose question is being worked on", () => {
    const busy: ThreadView = view({
      messages: [message({}), working],
      viewerUserId: SAM,
    });

    expect(findActiveAssistantMessage(busy)).toBe(working);
    expect(isThreadBusy(busy)).toBe(true);
    expect(describeThreadActivity(busy)).toBe(
      `${AI_DISPLAY_NAME} is working on Priya Shah's question…`,
    );
    expect(describeThreadActivity({ ...busy, viewerUserId: PRIYA })).toBe(
      `${AI_DISPLAY_NAME} is working on your question…`,
    );
  });

  test("says when an action is waiting for approval", () => {
    const waiting: ThreadView = view({
      messages: [
        message({ ...working, status: AIChatMessageStatus.WaitingForApproval }),
      ],
      viewerUserId: SAM,
    });

    expect(describeThreadActivity(waiting)).toContain(
      "waiting for someone to approve an action on Priya Shah's request",
    );
  });

  test("trusts the server's busy flag even before the message arrives", () => {
    expect(isThreadBusy(view({ isBusy: true }))).toBe(true);
  });

  test("an approval is pending only for a waiting message with an undecided action", () => {
    const action: {
      id: string;
      toolName: string;
      title: string;
      arguments: JSONObject;
      isMutation: boolean;
      requiresApproval: boolean;
      status: AIChatToolActionStatus;
    } = {
      id: "a",
      toolName: "acknowledge_incident",
      title: "Acknowledge",
      arguments: {},
      isMutation: true,
      requiresApproval: true,
      status: AIChatToolActionStatus.Pending,
    };

    expect(
      hasPendingApproval(
        message({
          status: AIChatMessageStatus.WaitingForApproval,
          toolActions: [action],
        }),
      ),
    ).toBe(true);
    expect(
      hasPendingApproval(
        message({
          status: AIChatMessageStatus.WaitingForApproval,
          toolActions: [{ ...action, status: AIChatToolActionStatus.Denied }],
        }),
      ),
    ).toBe(false);
    expect(
      hasPendingApproval(
        message({
          status: AIChatMessageStatus.Completed,
          toolActions: [action],
        }),
      ),
    ).toBe(false);
  });
});

describe("getSendBlocker", () => {
  const idle: ThreadView = view({ messages: [] });

  test("a question can be sent to an idle thread", () => {
    expect(
      getSendBlocker({ view: idle, input: "Why?", isSending: false }),
    ).toBeNull();
  });

  test("nothing to send", () => {
    expect(getSendBlocker({ view: idle, input: "   ", isSending: false })).toBe(
      "Type a question or a request.",
    );
  });

  test("already sending", () => {
    expect(getSendBlocker({ view: idle, input: "Why?", isSending: true })).toBe(
      "Sending…",
    );
  });

  test("too long", () => {
    expect(
      getSendBlocker({
        view: idle,
        input: "x".repeat(MAX_THREAD_QUESTION_LENGTH + 1),
        isSending: false,
      }),
    ).toContain("Keep it under");
  });

  test("the AI is busy with someone's question", () => {
    expect(
      getSendBlocker({
        view: view({
          messages: [
            message({
              role: AIChatMessageRole.Assistant,
              status: AIChatMessageStatus.InProgress,
            }),
          ],
          viewerUserId: SAM,
        }),
        input: "And the node?",
        isSending: false,
      }),
    ).toBe(`${AI_DISPLAY_NAME} is working on Priya Shah's question…`);
  });
});

describe("getSuggestedPrompts", () => {
  test("offers the questions responders ask first, for the subject", () => {
    const prompts: Array<SuggestedPrompt> = getSuggestedPrompts("alert");

    expect(prompts.length).toBeGreaterThanOrEqual(4);
    for (const prompt of prompts) {
      expect(prompt.label.length).toBeGreaterThan(0);
      expect(prompt.prompt).toMatch(/alert/);
      expect(prompt.prompt).not.toMatch(/incident/);
    }
  });

  test("marks requests that change something, so they are never one-click", () => {
    const actions: Array<SuggestedPrompt> = getSuggestedPrompts(
      "incident",
    ).filter((prompt: SuggestedPrompt) => {
      return prompt.isAction;
    });

    expect(
      actions.map((prompt: SuggestedPrompt) => {
        return prompt.label;
      }),
    ).toEqual(["Acknowledge this incident"]);
    // The status update is only drafted, so it is a question.
    expect(
      getSuggestedPrompts("incident").find((prompt: SuggestedPrompt) => {
        return prompt.label === "Draft a status update";
      })?.prompt,
    ).toContain("Don't post it yet");
  });
});

describe("permission mode", () => {
  test("acts on clear requests by default", () => {
    expect(DEFAULT_THREAD_PERMISSION_MODE).toBe(AIChatPermissionMode.AutoRun);
    expect(parseStoredPermissionMode(null)).toBe(AIChatPermissionMode.AutoRun);
    expect(parseStoredPermissionMode("garbage")).toBe(
      AIChatPermissionMode.AutoRun,
    );
  });

  test("remembers a valid choice", () => {
    expect(parseStoredPermissionMode(AIChatPermissionMode.ReadOnly)).toBe(
      AIChatPermissionMode.ReadOnly,
    );
  });

  test("every mode explains itself", () => {
    for (const mode of Object.values(AIChatPermissionMode)) {
      expect(describePermissionMode(mode).length).toBeGreaterThan(10);
    }
    expect(describePermissionMode(AIChatPermissionMode.AutoRun)).toContain(
      "within your permissions",
    );
  });
});

describe("getVisibleWidgets", () => {
  const widget: {
    id: string;
    type: AIChatWidgetType;
    title: string;
    data: JSONObject;
  } = { id: "W1", type: AIChatWidgetType.Table, title: "Top pods", data: {} };

  test("the asker sees their charts and tables", () => {
    expect(
      getVisibleWidgets(
        message({ widgets: [widget], author: { userId: PRIYA, name: "P" } }),
        PRIYA,
      ),
    ).toEqual([widget]);
  });

  test("other responders do not see another asker's raw rows", () => {
    expect(
      getVisibleWidgets(
        message({ widgets: [widget], author: { userId: PRIYA, name: "P" } }),
        SAM,
      ),
    ).toEqual([]);
  });
});

describe("buildOptimisticQuestion", () => {
  test("shows the viewer's question at once, marked as not yet confirmed", () => {
    const now: Date = new Date("2026-09-30T10:00:00.000Z");
    const optimistic: ThreadMessage = buildOptimisticQuestion({
      content: "Acknowledge this incident.",
      viewerUserId: SAM,
      viewerName: "Sam Lee",
      now,
    });

    expect(optimistic.isOptimistic).toBe(true);
    expect(optimistic.role).toBe(AIChatMessageRole.User);
    expect(optimistic.author).toEqual({ userId: SAM, name: "Sam Lee" });
    expect(optimistic.createdAt).toBe(now);
    expect(optimistic.id).toBe(`optimistic-${now.getTime()}`);
  });
});
