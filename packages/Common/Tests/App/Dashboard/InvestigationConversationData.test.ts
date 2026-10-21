import { AIInvestigationStage } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import {
  AI_DISPLAY_NAME,
  AVATAR_TONES,
  DEFAULT_THREAD_PERMISSION_MODE,
  EMPTY_THREAD_VIEW,
  MAX_THREAD_QUESTION_LENGTH,
  SuggestedPrompt,
  THREAD_FOLD_ABOVE_LENGTH,
  THREAD_TAIL_LENGTH,
  ThreadMessage,
  ThreadTail,
  ThreadView,
  ToolActionOutcome,
  buildOptimisticQuestion,
  describeAuthor,
  describeConversation,
  describePermissionMode,
  describeThreadActivity,
  describeToolActionOutcome,
  findActiveAssistantMessage,
  getAvatarTone,
  getInitials,
  getSendBlocker,
  getSuggestedPrompts,
  getThreadSignature,
  getThreadTail,
  getVisibleWidgets,
  hasPendingApproval,
  isThreadBusy,
  isToolActionAwaitingApproval,
  isViewer,
  parseStoredPermissionMode,
  parseThreadMessage,
  parseThreadView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/InvestigationConversationData";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "../../../Types/AI/AIChatPermissionMode";
import {
  AIChatToolAction,
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

  /*
   * Whose question is on is one whole sentence per way of naming the asker,
   * so a language words the possessive its own way.
   */
  test("possessives read naturally", () => {
    const workingFor: (
      author: { userId: string | null; name: string },
      viewerUserId: string | null,
    ) => string | null = (
      author: { userId: string | null; name: string },
      viewerUserId: string | null,
    ): string | null => {
      return describeThreadActivity(
        view({
          messages: [
            message({
              role: AIChatMessageRole.Assistant,
              status: AIChatMessageStatus.InProgress,
              author: author,
            }),
          ],
          viewerUserId: viewerUserId,
        }),
      );
    };

    expect(workingFor({ userId: PRIYA, name: "Priya" }, PRIYA)).toBe(
      `${AI_DISPLAY_NAME} is working on your question…`,
    );
    expect(workingFor({ userId: PRIYA, name: "Priya" }, SAM)).toBe(
      `${AI_DISPLAY_NAME} is working on Priya's question…`,
    );
    expect(workingFor({ userId: SAM, name: "James" }, PRIYA)).toBe(
      `${AI_DISPLAY_NAME} is working on James's question…`,
    );
    expect(workingFor({ userId: SAM, name: " " }, PRIYA)).toBe(
      `${AI_DISPLAY_NAME} is working on a responder's question…`,
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

/*
 * ---------------------------------------------------------------------------
 * The conversation as a section of the AI Investigation card
 * ---------------------------------------------------------------------------
 * What the card's state changes about the conversation, and how much of a
 * long thread it opens with now that the thread is part of the page.
 */

const STAGES: Array<AIInvestigationStage> = [
  "checking",
  "underway",
  "reported",
  "none",
];

describe("what the conversation suggests for each stage of the investigation", () => {
  test("leads with the root-cause question when the card has no report to read", () => {
    const prompts: Array<SuggestedPrompt> = getSuggestedPrompts(
      "incident",
      "none",
    );

    expect(prompts[0]).toEqual({
      label: "What is the root cause?",
      prompt:
        "What is the most likely root cause of this incident? Investigate it and cite the evidence.",
    });
    // A question, so it is asked on the click: only requests to act wait.
    expect(prompts[0]!.isAction).toBeUndefined();
    // In front of the usual five, which keep their order.
    expect(prompts.slice(1)).toEqual(getSuggestedPrompts("incident"));
  });

  test("words the root-cause question for an alert", () => {
    expect(getSuggestedPrompts("alert", "none")[0]!.prompt).toBe(
      "What is the most likely root cause of this alert? Investigate it and cite the evidence.",
    );
  });

  test.each([["checking"], ["underway"], ["reported"], [undefined]] as Array<
    [AIInvestigationStage | undefined]
  >)(
    "does not offer it while the investigation is %s",
    (stage: AIInvestigationStage | undefined) => {
      const labels: Array<string> = getSuggestedPrompts("incident", stage).map(
        (prompt: SuggestedPrompt): string => {
          return prompt.label;
        },
      );

      expect(labels).toEqual([
        "What should I do right now?",
        "What changed just before this?",
        "Is anything else affected?",
        "Draft a status update",
        "Acknowledge this incident",
      ]);
    },
  );

  test("returns a fresh list each time, so one stage's list never leaks into another's", () => {
    const withRootCause: Array<SuggestedPrompt> = getSuggestedPrompts(
      "incident",
      "none",
    );

    expect(getSuggestedPrompts("incident", "reported")).toHaveLength(5);
    expect(getSuggestedPrompts("incident", "none")).toHaveLength(6);
    expect(getSuggestedPrompts("incident", "none")).not.toBe(withRootCause);
  });

  test.each(
    STAGES.map((stage: AIInvestigationStage): [AIInvestigationStage] => {
      return [stage];
    }),
  )(
    "only requests to act are marked as actions, whatever the stage (%s)",
    (stage: AIInvestigationStage) => {
      expect(
        getSuggestedPrompts("alert", stage)
          .filter((prompt: SuggestedPrompt): boolean => {
            return prompt.isAction === true;
          })
          .map((prompt: SuggestedPrompt): string => {
            return prompt.label;
          }),
      ).toEqual(["Acknowledge this alert"]);
    },
  );
});

describe("describeConversation", () => {
  test("says 'follow-up' only under a report", () => {
    expect(describeConversation("incident", "reported")).toBe(
      "Ask a follow-up question, or ask it to act. Everyone on this incident sees this conversation.",
    );

    for (const stage of ["checking", "underway", "none", undefined] as Array<
      AIInvestigationStage | undefined
    >) {
      expect(describeConversation("incident", stage)).toBe(
        "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
      );
    }
  });

  test("names the subject it is about", () => {
    expect(describeConversation("alert", "none")).toBe(
      "Ask a question about this alert, or ask it to act. Everyone on this alert sees this conversation.",
    );
    expect(describeConversation("alert", "reported")).toContain(
      "Everyone on this alert sees this conversation.",
    );
  });

  test("always says the conversation is shared", () => {
    for (const subjectType of ["incident", "alert"] as Array<
      "incident" | "alert"
    >) {
      for (const stage of STAGES) {
        expect(describeConversation(subjectType, stage)).toMatch(
          /Everyone on this (incident|alert) sees this conversation\.$/,
        );
      }
    }
  });
});

describe("getThreadTail", () => {
  // q1 a1 q2 a2 ... as the thread arrives: a question, then its answer.
  function exchanges(count: number): Array<ThreadMessage> {
    const messages: Array<ThreadMessage> = [];

    for (let index: number = 1; index <= count; index++) {
      messages.push(
        message({ id: `q${index}`, role: AIChatMessageRole.User }),
        message({ id: `a${index}`, role: AIChatMessageRole.Assistant }),
      );
    }

    return messages;
  }

  function ids(messages: Array<ThreadMessage>): Array<string> {
    return messages.map((item: ThreadMessage): string => {
      return item.id;
    });
  }

  test("keeps the newest three exchanges of a thread longer than four", () => {
    expect(THREAD_TAIL_LENGTH).toBe(6);
    expect(THREAD_FOLD_ABOVE_LENGTH).toBe(8);
  });

  test("an empty thread has nothing to fold", () => {
    expect(getThreadTail([], false)).toEqual({ hiddenCount: 0, messages: [] });
  });

  test.each([[1], [2], [3], [4]])(
    "a thread of %i exchanges is shown whole",
    (count: number) => {
      const messages: Array<ThreadMessage> = exchanges(count);
      const tail: ThreadTail = getThreadTail(messages, false);

      expect(tail.hiddenCount).toBe(0);
      // The very same array: nothing is copied when nothing is folded.
      expect(tail.messages).toBe(messages);
    },
  );

  test("exactly eight messages are shown whole; the ninth folds the thread", () => {
    const eight: Array<ThreadMessage> = exchanges(4);
    expect(getThreadTail(eight, false).hiddenCount).toBe(0);

    const nine: Array<ThreadMessage> = [
      ...eight,
      message({ id: "q5", role: AIChatMessageRole.User }),
    ];
    expect(getThreadTail(nine, false).hiddenCount).toBeGreaterThan(0);
  });

  test("a long thread opens on its last six messages", () => {
    const tail: ThreadTail = getThreadTail(exchanges(6), false);

    expect(tail.hiddenCount).toBe(6);
    expect(ids(tail.messages)).toEqual(["q4", "a4", "q5", "a5", "q6", "a6"]);
  });

  test("never opens on an answer whose question is folded away", () => {
    // Nine messages: six from the end is a2, so the cut moves back to q2.
    const messages: Array<ThreadMessage> = [
      ...exchanges(4),
      message({ id: "q5", role: AIChatMessageRole.User }),
    ];
    const tail: ThreadTail = getThreadTail(messages, false);

    expect(tail.hiddenCount).toBe(2);
    expect(ids(tail.messages)).toEqual([
      "q2",
      "a2",
      "q3",
      "a3",
      "q4",
      "a4",
      "q5",
    ]);
  });

  test("an answer that follows another answer is not moved for", () => {
    // Six from the end is a1c, and before it is a1b: no question to go back to.
    const messages: Array<ThreadMessage> = [
      message({ id: "q1", role: AIChatMessageRole.User }),
      message({ id: "a1", role: AIChatMessageRole.Assistant }),
      message({ id: "a1b", role: AIChatMessageRole.Assistant }),
      message({ id: "a1c", role: AIChatMessageRole.Assistant }),
      message({ id: "a1d", role: AIChatMessageRole.Assistant }),
      message({ id: "q2", role: AIChatMessageRole.User }),
      message({ id: "a2", role: AIChatMessageRole.Assistant }),
      message({ id: "q3", role: AIChatMessageRole.User }),
      message({ id: "a3", role: AIChatMessageRole.Assistant }),
    ];
    const tail: ThreadTail = getThreadTail(messages, false);

    expect(tail.hiddenCount).toBe(3);
    expect(ids(tail.messages)).toEqual(["a1c", "a1d", "q2", "a2", "q3", "a3"]);
  });

  test("the hidden and the shown always add up to the whole thread", () => {
    for (let count: number = 0; count <= 12; count++) {
      const messages: Array<ThreadMessage> = exchanges(count);

      for (const extra of [0, 1]) {
        const thread: Array<ThreadMessage> =
          extra === 1
            ? [
                ...messages,
                message({ id: "last", role: AIChatMessageRole.User }),
              ]
            : messages;
        const tail: ThreadTail = getThreadTail(thread, false);

        expect(tail.hiddenCount + tail.messages.length).toBe(thread.length);
        expect(tail.messages).toEqual(thread.slice(tail.hiddenCount));
        // Folding always hides at least two messages, never just one.
        expect(tail.hiddenCount === 0 || tail.hiddenCount >= 2).toBe(true);
      }
    }
  });

  test("a reader who asked for the whole thread gets it, however long", () => {
    const messages: Array<ThreadMessage> = exchanges(40);
    const tail: ThreadTail = getThreadTail(messages, true);

    expect(tail.hiddenCount).toBe(0);
    expect(tail.messages).toBe(messages);
  });
});

describe("how a settled action reads", () => {
  test.each([
    [AIChatToolActionStatus.Executed, "Done", "text-emerald-600"],
    [AIChatToolActionStatus.Approved, "Approved", "text-emerald-600"],
    [AIChatToolActionStatus.Failed, "Failed", "text-red-600"],
    [AIChatToolActionStatus.Denied, "Denied", "text-gray-400"],
    [AIChatToolActionStatus.Skipped, "Skipped", "text-gray-400"],
    [AIChatToolActionStatus.Pending, "Pending", "text-gray-400"],
  ])(
    "%s reads '%s'",
    (status: AIChatToolActionStatus, label: string, tone: string) => {
      const outcome: ToolActionOutcome = describeToolActionOutcome(status);

      expect(outcome.label).toBe(label);
      expect(outcome.iconClassName).toBe(tone);
      expect(typeof outcome.icon).toBe("string");
    },
  );

  test("every status the server can send has a word and a mark", () => {
    for (const status of Object.values(AIChatToolActionStatus)) {
      const outcome: ToolActionOutcome = describeToolActionOutcome(status);

      expect(outcome.label.length).toBeGreaterThan(0);
      expect(outcome.iconClassName).toMatch(/^text-[a-z]+-\d{3}$/);
    }
  });

  test("a status this build does not know reads as pending, not as done", () => {
    expect(
      describeToolActionOutcome("Exploded" as AIChatToolActionStatus).label,
    ).toBe("Pending");
  });

  test("only a failure is red and only a success is green", () => {
    const tones: Record<string, Array<string>> = {};

    for (const status of Object.values(AIChatToolActionStatus)) {
      const tone: string = describeToolActionOutcome(status).iconClassName;
      tones[tone] = [...(tones[tone] || []), status];
    }

    expect(tones["text-red-600"]).toEqual([AIChatToolActionStatus.Failed]);
    expect(tones["text-emerald-600"]!.sort()).toEqual(
      [AIChatToolActionStatus.Approved, AIChatToolActionStatus.Executed].sort(),
    );
  });
});

describe("isToolActionAwaitingApproval", () => {
  function action(overrides: {
    status: AIChatToolActionStatus;
    requiresApproval: boolean;
  }): AIChatToolAction {
    return {
      id: "call-1",
      toolName: "acknowledge_incident",
      title: "Acknowledge incident #42",
      arguments: {},
      isMutation: true,
      ...overrides,
    };
  }

  test("a pending action that needs a yes is waiting", () => {
    expect(
      isToolActionAwaitingApproval(
        action({
          status: AIChatToolActionStatus.Pending,
          requiresApproval: true,
        }),
      ),
    ).toBe(true);
  });

  test("a pending action that needs no approval is not waiting on anyone", () => {
    expect(
      isToolActionAwaitingApproval(
        action({
          status: AIChatToolActionStatus.Pending,
          requiresApproval: false,
        }),
      ),
    ).toBe(false);
  });

  test.each(
    Object.values(AIChatToolActionStatus)
      .filter((status: AIChatToolActionStatus): boolean => {
        return status !== AIChatToolActionStatus.Pending;
      })
      .map((status: AIChatToolActionStatus): [AIChatToolActionStatus] => {
        return [status];
      }),
  )(
    "a decided action (%s) is never waiting",
    (status: AIChatToolActionStatus) => {
      expect(
        isToolActionAwaitingApproval(
          action({ status, requiresApproval: true }),
        ),
      ).toBe(false);
    },
  );

  test("agrees with hasPendingApproval about a paused answer", () => {
    const paused: ThreadMessage = message({
      role: AIChatMessageRole.Assistant,
      status: AIChatMessageStatus.WaitingForApproval,
      toolActions: [
        action({
          status: AIChatToolActionStatus.Pending,
          requiresApproval: true,
        }),
      ],
    });

    expect(hasPendingApproval(paused)).toBe(true);
    expect(
      hasPendingApproval({
        ...paused,
        toolActions: [
          action({
            status: AIChatToolActionStatus.Executed,
            requiresApproval: true,
          }),
        ],
      }),
    ).toBe(false);
  });
});

describe("avatar tones", () => {
  test("eight tones, all different", () => {
    expect(AVATAR_TONES).toHaveLength(8);
    expect(new Set(AVATAR_TONES).size).toBe(8);
  });

  test("every responder gets one of them, always the same one", () => {
    for (const seed of [PRIYA, SAM, RUN, "Priya Shah", "a", ""]) {
      expect(AVATAR_TONES).toContain(getAvatarTone(seed));
      expect(getAvatarTone(seed)).toBe(getAvatarTone(seed));
    }
  });

  test("no tone is lime: it had no dark-theme rule and stayed a pale disc", () => {
    for (const tone of AVATAR_TONES) {
      expect(tone).not.toMatch(/lime/);
      // A pale ground with a dark letter of the same hue.
      expect(tone).toMatch(/^bg-([a-z]+)-100 text-\1-[78]00$/);
    }
  });
});

describe("the mode's caption in the composer", () => {
  test.each([
    [
      AIChatPermissionMode.AutoRun,
      "Acts on clear requests right away, within your permissions.",
    ],
    [
      AIChatPermissionMode.AskForApproval,
      "Asks for approval before it changes anything.",
    ],
    [
      AIChatPermissionMode.ReadOnly,
      "Only reads and answers. It never changes anything.",
    ],
  ])("%s: %s", (mode: AIChatPermissionMode, caption: string) => {
    expect(describePermissionMode(mode)).toBe(caption);
  });

  test("stays short enough for the picker's row and never repeats who acts", () => {
    for (const mode of Object.values(AIChatPermissionMode)) {
      const caption: string = describePermissionMode(mode);

      expect(caption.length).toBeLessThanOrEqual(60);
      expect(caption).not.toContain(AI_DISPLAY_NAME);
      expect(caption.endsWith(".")).toBe(true);
    }
  });
});
