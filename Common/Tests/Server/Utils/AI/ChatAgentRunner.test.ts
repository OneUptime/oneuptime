import ChatAgentRunner, {
  ChatTurnRequest,
  applyHistoryTokenBudget,
  buildEvidenceDigest,
  buildReplayedHistoryMessage,
  sanitizeGeneratedTitle,
  summarizeShownContent,
  HistoryBudgetResult,
  ReplayedHistoryMessage,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIChatMessageRole from "../../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Locks in the runner's history-replay, cancellation, page-context and title
 * behavior: evidence digests keep prior queries referable, the token budget
 * drops oldest history first (with a visible note), a cancelled run is
 * abandoned without overwriting the finalized message, the conversation's
 * subject survives later turns, and titles come from a small sanitized LLM
 * call that can never hurt the turn.
 */

// AIChatMessageStatus.Cancelled lands with the parallel cancel-endpoint change.
const CANCELLED_STATUS: AIChatMessageStatus =
  "Cancelled" as AIChatMessageStatus;

function buildCitation(data?: {
  id?: string;
  toolName?: string;
  queryArguments?: JSONObject;
  rowCount?: number;
  label?: string;
}): AIChatCitation {
  return {
    id: data?.id ?? "C1",
    toolName: data?.toolName ?? "query_incidents",
    queryArguments: data?.queryArguments ?? { incidentId: "abc" },
    rowCount: data?.rowCount ?? 5,
    label: data?.label ?? "Incidents, last 168h",
  };
}

function buildWidget(title: string): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.Table,
    title: title,
    data: {},
  };
}

function buildToolAction(title: string): AIChatToolAction {
  return {
    id: "t1",
    toolName: "create_incident",
    title: title,
    arguments: {},
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Executed,
  };
}

function buildHistoryMessage(data: {
  role: AIChatMessageRole;
  content?: string;
  status?: AIChatMessageStatus;
  citations?: Array<AIChatCitation>;
  widgets?: Array<AIChatWidget>;
  toolActions?: Array<AIChatToolAction>;
}): AIConversationMessage {
  const message: AIConversationMessage = new AIConversationMessage();
  message.role = data.role;
  message.contentInMarkdown = data.content ?? "";
  message.status = data.status ?? AIChatMessageStatus.Completed;
  if (data.citations) {
    message.citations = data.citations;
  }
  if (data.widgets) {
    message.widgets = data.widgets;
  }
  if (data.toolActions) {
    message.toolActions = data.toolActions;
  }
  return message;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildEvidenceDigest", () => {
  test("formats each citation as id tool(args) -> rows (label)", () => {
    const digest: string = buildEvidenceDigest([buildCitation()]);
    expect(digest).toBe(
      '[Evidence from this turn: C1 query_incidents({"incidentId":"abc"}) -> 5 rows (Incidents, last 168h)]',
    );
  });

  test("returns empty string when there are no citations", () => {
    expect(buildEvidenceDigest([])).toBe("");
  });

  test("clamps long query arguments to ~200 chars", () => {
    const digest: string = buildEvidenceDigest([
      buildCitation({
        queryArguments: { filter: "x".repeat(500) },
      }),
    ]);

    // 200 chars of JSON + the ellipsis, not the full 500-char filter.
    expect(digest).toContain("…");
    expect(digest.length).toBeLessThan(300);
  });

  test("caps the digest at ~1500 chars and reports omitted queries", () => {
    const citations: Array<AIChatCitation> = [];
    for (let i: number = 0; i < 30; i++) {
      citations.push(
        buildCitation({
          id: `C${i + 1}`,
          label: `Result set ${i + 1}: ${"y".repeat(120)}`,
        }),
      );
    }

    const digest: string = buildEvidenceDigest(citations);

    expect(digest.length).toBeLessThanOrEqual(1560);
    expect(digest).toMatch(/\.\.\. and \d+ more queries]$/);
  });
});

describe("summarizeShownContent", () => {
  test("prefers widget titles", () => {
    const summary: string = summarizeShownContent(
      [buildWidget("Error volume by service"), buildWidget("p95 latency")],
      [buildToolAction("Create incident: Checkout down")],
    );
    expect(summary).toBe("Error volume by service, p95 latency");
  });

  test("falls back to tool action titles when there are no widgets", () => {
    const summary: string = summarizeShownContent(
      [],
      [buildToolAction("Create incident: Checkout down")],
    );
    expect(summary).toBe("Create incident: Checkout down");
  });

  test("returns empty string when there is nothing to summarize", () => {
    expect(summarizeShownContent([], [])).toBe("");
  });
});

describe("applyHistoryTokenBudget", () => {
  function entry(content: string): ReplayedHistoryMessage {
    return { role: "user", content };
  }

  test("keeps everything when within budget", () => {
    const entries: Array<ReplayedHistoryMessage> = [
      entry("a".repeat(40)),
      entry("b".repeat(40)),
    ];

    const result: HistoryBudgetResult = applyHistoryTokenBudget(entries, 100);

    expect(result.kept).toHaveLength(2);
    expect(result.droppedCount).toBe(0);
  });

  test("drops oldest entries first and reports how many", () => {
    // 100 tokens each (400 chars / 4); budget fits only the two newest.
    const entries: Array<ReplayedHistoryMessage> = [
      entry(`old ${"a".repeat(396)}`),
      entry(`mid ${"b".repeat(396)}`),
      entry(`new ${"c".repeat(396)}`),
    ];

    const result: HistoryBudgetResult = applyHistoryTokenBudget(entries, 250);

    expect(result.droppedCount).toBe(1);
    expect(result.kept).toHaveLength(2);
    expect(result.kept[0]?.content).toContain("mid");
    expect(result.kept[1]?.content).toContain("new");
  });

  test("always keeps the newest entry even when it alone exceeds the budget", () => {
    const entries: Array<ReplayedHistoryMessage> = [entry("z".repeat(4000))];

    const result: HistoryBudgetResult = applyHistoryTokenBudget(entries, 10);

    expect(result.kept).toHaveLength(1);
    expect(result.droppedCount).toBe(0);
  });
});

describe("sanitizeGeneratedTitle", () => {
  test("strips wrapping quotes and trailing punctuation", () => {
    expect(sanitizeGeneratedTitle('"Checkout Latency Investigation."\n')).toBe(
      "Checkout Latency Investigation",
    );
  });

  test("keeps only the first non-empty line and drops Title: prefixes", () => {
    expect(
      sanitizeGeneratedTitle(
        '\nTitle: "Payment failures spike"\nHere is why I chose it...',
      ),
    ).toBe("Payment failures spike");
  });

  test("clamps to 90 chars", () => {
    const title: string = sanitizeGeneratedTitle("word ".repeat(50));
    expect(title.length).toBeLessThanOrEqual(90);
  });

  test("returns empty string when nothing usable remains", () => {
    expect(sanitizeGeneratedTitle('  "..." \n')).toBe("");
    expect(sanitizeGeneratedTitle("")).toBe("");
  });
});

describe("buildReplayedHistoryMessage", () => {
  test("replays user messages verbatim", () => {
    const replayed: ReplayedHistoryMessage | undefined =
      buildReplayedHistoryMessage(
        buildHistoryMessage({
          role: AIChatMessageRole.User,
          content: "What broke?",
        }),
      );

    expect(replayed).toEqual({ role: "user", content: "What broke?" });
  });

  test("strips stale [C#] markers and appends the evidence digest", () => {
    const replayed: ReplayedHistoryMessage | undefined =
      buildReplayedHistoryMessage(
        buildHistoryMessage({
          role: AIChatMessageRole.Assistant,
          content: "Errors spiked at 02:38 [C1].",
          citations: [buildCitation()],
        }),
      );

    expect(replayed?.content).toContain("Errors spiked at 02:38.");
    expect(replayed?.content).not.toContain("[C1]");
    expect(replayed?.content).toContain(
      'C1 query_incidents({"incidentId":"abc"}) -> 5 rows (Incidents, last 168h)',
    );
  });

  test("replays widget-only answers as a shown-content summary", () => {
    const replayed: ReplayedHistoryMessage | undefined =
      buildReplayedHistoryMessage(
        buildHistoryMessage({
          role: AIChatMessageRole.Assistant,
          content: "",
          citations: [buildCitation()],
          widgets: [buildWidget("Error volume by service")],
        }),
      );

    expect(replayed?.content).toContain(
      "[Showed the user: Error volume by service]",
    );
    expect(replayed?.content).toContain("C1 query_incidents(");
  });

  test("skips in-flight and errored assistant rows but replays cancelled ones", () => {
    expect(
      buildReplayedHistoryMessage(
        buildHistoryMessage({
          role: AIChatMessageRole.Assistant,
          content: "still thinking",
          status: AIChatMessageStatus.InProgress,
        }),
      ),
    ).toBeUndefined();

    expect(
      buildReplayedHistoryMessage(
        buildHistoryMessage({
          role: AIChatMessageRole.Assistant,
          content: "",
          status: AIChatMessageStatus.Error,
        }),
      ),
    ).toBeUndefined();

    /*
     * A cancelled turn's contentInMarkdown is the server's finalizer text,
     * not assistant prose — it replays as a neutral stop marker so the model
     * never imitates or apologizes for "Stopped by user.".
     */
    const cancelled: ReplayedHistoryMessage | undefined =
      buildReplayedHistoryMessage(
        buildHistoryMessage({
          role: AIChatMessageRole.Assistant,
          content: "Stopped by user.",
          status: CANCELLED_STATUS,
        }),
      );
    expect(cancelled?.content).toContain(
      "[The user stopped this answer before it finished.]",
    );
    expect(cancelled?.content).not.toContain("Stopped by user.");
  });

  test("skips assistant rows with nothing at all to replay", () => {
    expect(
      buildReplayedHistoryMessage(
        buildHistoryMessage({
          role: AIChatMessageRole.Assistant,
          content: "",
        }),
      ),
    ).toBeUndefined();
  });
});

/*
 * ---------------------------------------------------------------------------
 * runTurn service-spy tests
 * ---------------------------------------------------------------------------
 */

const INCIDENT_ID: string = "0b6ff65a-71a1-40b0-8b9c-6c11f5f6a123";

function buildRequest(data?: {
  pageContext?: AIChatPageContext | undefined;
}): ChatTurnRequest {
  return {
    projectId: ObjectID.generate(),
    userId: ObjectID.generate(),
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.ReadOnly,
    pageContext: data?.pageContext,
    props: { userId: ObjectID.generate() },
  };
}

function buildRun(status: AIRunStatus): AIRun {
  const run: AIRun = new AIRun();
  run.status = status;
  return run;
}

function chatResponse(content: string, stopReason?: string): AILogResponse {
  return {
    content: content,
    toolCalls: undefined,
    stopReason: stopReason,
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

// Let fire-and-forget chains (title generation) settle.
async function flushAsync(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

interface RunnerSpies {
  executeWithLogging: jest.SpyInstance;
  conversationFindOneById: jest.SpyInstance;
  conversationUpdateOneById: jest.SpyInstance;
  messageFindBy: jest.SpyInstance;
  messageCountBy: jest.SpyInstance;
  messageFindOneBy: jest.SpyInstance;
  messageUpdateOneBy: jest.SpyInstance;
  runFindOneById: jest.SpyInstance;
  runUpdateOneBy: jest.SpyInstance;
}

function installRunnerSpies(data: {
  runStatus?: AIRunStatus;
  history?: Array<AIConversationMessage>;
  historyCount?: number;
  titleCount?: number;
  conversation?: AIConversation;
}): RunnerSpies {
  jest.spyOn(AIRunEventService, "create").mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);

  const runFindOneById: jest.SpyInstance = jest
    .spyOn(AIRunService, "findOneById")
    .mockResolvedValue(
      buildRun(data.runStatus ?? AIRunStatus.Running) as never,
    );

  const runUpdateOneBy: jest.SpyInstance = jest
    .spyOn(AIRunService, "updateOneBy")
    .mockResolvedValue(1 as never);

  const messageFindBy: jest.SpyInstance = jest
    .spyOn(AIConversationMessageService, "findBy")
    .mockResolvedValue((data.history ?? []) as never);

  const messageCountBy: jest.SpyInstance = jest
    .spyOn(AIConversationMessageService, "countBy")
    .mockResolvedValueOnce(
      new PositiveNumber(
        data.historyCount ?? (data.history ?? []).length,
      ) as never,
    )
    .mockResolvedValue(
      new PositiveNumber(
        data.titleCount ?? data.historyCount ?? (data.history ?? []).length,
      ) as never,
    );

  const messageFindOneBy: jest.SpyInstance = jest
    .spyOn(AIConversationMessageService, "findOneBy")
    .mockResolvedValue(null as never);

  const messageUpdateOneBy: jest.SpyInstance = jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);

  const conversationFindOneById: jest.SpyInstance = jest
    .spyOn(AIConversationService, "findOneById")
    .mockResolvedValue((data.conversation ?? new AIConversation()) as never);

  const conversationUpdateOneById: jest.SpyInstance = jest
    .spyOn(AIConversationService, "updateOneById")
    .mockResolvedValue(1 as never);

  const executeWithLogging: jest.SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(chatResponse("All good.") as never);

  return {
    executeWithLogging,
    conversationFindOneById,
    conversationUpdateOneById,
    messageFindBy,
    messageCountBy,
    messageFindOneBy,
    messageUpdateOneBy,
    runFindOneById,
    runUpdateOneBy,
  };
}

function findCallWithDataKey(
  spy: jest.SpyInstance,
  key: string,
): JSONObject | undefined {
  for (const call of spy.mock.calls) {
    const arg: { data?: JSONObject } | undefined = call[0] as
      | { data?: JSONObject }
      | undefined;
    if (arg?.data && (arg.data as JSONObject)[key] !== undefined) {
      return arg.data as JSONObject;
    }
  }
  return undefined;
}

describe("ChatAgentRunner.runTurn — cooperative cancellation", () => {
  test("abandons a cancelled run without calling the LLM or overwriting the message", async () => {
    const spies: RunnerSpies = installRunnerSpies({
      runStatus: AIRunStatus.Cancelled,
    });

    await ChatAgentRunner.runTurn(buildRequest());
    await flushAsync();

    expect(spies.executeWithLogging).not.toHaveBeenCalled();
    // The cancel endpoint owns the message and run: no finalizing writes here.
    expect(spies.messageUpdateOneBy).not.toHaveBeenCalled();
    expect(spies.runUpdateOneBy).not.toHaveBeenCalled();
    expect(spies.conversationUpdateOneById).not.toHaveBeenCalled();
  });
});

describe("ChatAgentRunner.runTurn — page context persistence", () => {
  test("persists a fresh page context on the conversation and folds it into the prompt", async () => {
    const pageContext: AIChatPageContext = {
      type: AIChatPageContextType.Incident,
      entityId: INCIDENT_ID,
      entityTitle: "Checkout down",
    };

    const spies: RunnerSpies = installRunnerSpies({ titleCount: 5 });

    await ChatAgentRunner.runTurn(buildRequest({ pageContext }));
    await flushAsync();

    // Persisted as the conversation's subject (it had none).
    const persisted: JSONObject | undefined = findCallWithDataKey(
      spies.conversationUpdateOneById,
      "pageContext",
    );
    expect(persisted).toBeDefined();
    expect(persisted?.["pageContext"]).toEqual(pageContext);

    // Folded into the system prompt.
    const llmRequest: AILogRequest = spies.executeWithLogging.mock
      .calls[0]?.[0] as AILogRequest;
    expect(llmRequest.messages[0]?.content).toContain(
      `incidentId="${INCIDENT_ID}"`,
    );
    expect(llmRequest.messages[0]?.content).toContain('titled "Checkout down"');
  });

  test("falls back to the persisted subject when the turn carries no page context", async () => {
    const conversation: AIConversation = new AIConversation();
    conversation.pageContext = {
      type: AIChatPageContextType.Incident,
      entityId: INCIDENT_ID,
      entityTitle: "DB outage",
    };

    const spies: RunnerSpies = installRunnerSpies({
      conversation,
      titleCount: 5,
    });

    await ChatAgentRunner.runTurn(buildRequest());
    await flushAsync();

    const llmRequest: AILogRequest = spies.executeWithLogging.mock
      .calls[0]?.[0] as AILogRequest;
    expect(llmRequest.messages[0]?.content).toContain(
      `incidentId="${INCIDENT_ID}"`,
    );
    expect(llmRequest.messages[0]?.content).toContain('titled "DB outage"');

    // Nothing re-persisted: the subject was already pinned.
    expect(
      findCallWithDataKey(spies.conversationUpdateOneById, "pageContext"),
    ).toBeUndefined();
  });
});

describe("ChatAgentRunner.runTurn — history replay", () => {
  test("replays digests, widget-only summaries and an omitted-history note", async () => {
    // Newest first, exactly as the Descending findBy returns them.
    const history: Array<AIConversationMessage> = [
      buildHistoryMessage({
        role: AIChatMessageRole.User,
        content: "What happened?",
      }),
      buildHistoryMessage({
        role: AIChatMessageRole.Assistant,
        content: "",
        widgets: [buildWidget("Error volume by service")],
      }),
      buildHistoryMessage({
        role: AIChatMessageRole.Assistant,
        content: "Errors spiked at 02:38 [C1].",
        citations: [buildCitation()],
      }),
    ];

    const spies: RunnerSpies = installRunnerSpies({
      history,
      historyCount: 23,
      titleCount: 23,
    });

    await ChatAgentRunner.runTurn(buildRequest());
    await flushAsync();

    const llmRequest: AILogRequest = spies.executeWithLogging.mock
      .calls[0]?.[0] as AILogRequest;
    const contents: Array<string> = llmRequest.messages.map(
      (message: { content: string }) => {
        return message.content;
      },
    );

    // 20 of the 23 rows never made it past the fetch cap.
    expect(contents[1]).toBe(
      "[Note: 20 earlier messages in this conversation were omitted for length.]",
    );

    // Prior evidence is replayed as a digest, with stale markers stripped.
    expect(contents[2]).toContain("Errors spiked at 02:38.");
    expect(contents[2]).not.toContain("[C1]");
    expect(contents[2]).toContain(
      'C1 query_incidents({"incidentId":"abc"}) -> 5 rows (Incidents, last 168h)',
    );

    // The widget-only answer no longer vanishes.
    expect(contents[3]).toContain("[Showed the user: Error volume by service]");

    expect(contents[4]).toBe("What happened?");

    // A long conversation gets no generated title.
    expect(spies.executeWithLogging).toHaveBeenCalledTimes(1);
  });
});

describe("ChatAgentRunner.runTurn — output truncation notice", () => {
  test("appends a visible truncation marker when stopReason is length", async () => {
    const spies: RunnerSpies = installRunnerSpies({ titleCount: 5 });
    spies.executeWithLogging.mockResolvedValue(
      chatResponse("Partial answer", "length") as never,
    );

    await ChatAgentRunner.runTurn(buildRequest());
    await flushAsync();

    const finalized: JSONObject | undefined = findCallWithDataKey(
      spies.messageUpdateOneBy,
      "contentInMarkdown",
    );
    expect(finalized?.["contentInMarkdown"]).toBe(
      "Partial answer\n\n_[Answer truncated by the output token limit.]_",
    );
  });
});

describe("ChatAgentRunner.runTurn — conversation titles", () => {
  test("names the conversation after the first exchange via a small sanitized LLM call", async () => {
    const firstUserMessage: AIConversationMessage = buildHistoryMessage({
      role: AIChatMessageRole.User,
      content: "Why is checkout failing?",
    });

    const spies: RunnerSpies = installRunnerSpies({
      history: [firstUserMessage],
      historyCount: 2,
      titleCount: 2,
    });

    spies.messageFindOneBy.mockResolvedValue(firstUserMessage as never);
    spies.executeWithLogging
      .mockResolvedValueOnce(
        chatResponse("Checkout is failing because of X.") as never,
      )
      .mockResolvedValueOnce(
        chatResponse('"Checkout Failure Investigation."\n') as never,
      );

    await ChatAgentRunner.runTurn(buildRequest());
    await flushAsync();

    expect(spies.executeWithLogging).toHaveBeenCalledTimes(2);

    const titleRequest: AILogRequest = spies.executeWithLogging.mock
      .calls[1]?.[0] as AILogRequest;
    expect(titleRequest.feature).toBe("Chat Title");
    expect(titleRequest.maxTokens).toBe(100);
    expect(titleRequest.storeContentPreviews).toBe(false);
    expect(
      titleRequest.messages.find((message: { content: string }) => {
        return message.content.includes("Why is checkout failing?");
      }),
    ).toBeDefined();

    const titleUpdate: JSONObject | undefined = findCallWithDataKey(
      spies.conversationUpdateOneById,
      "title",
    );
    expect(titleUpdate?.["title"]).toBe("Checkout Failure Investigation");
  });

  test("a title failure never affects the finished turn", async () => {
    const firstUserMessage: AIConversationMessage = buildHistoryMessage({
      role: AIChatMessageRole.User,
      content: "Why is checkout failing?",
    });

    const spies: RunnerSpies = installRunnerSpies({
      history: [firstUserMessage],
      historyCount: 2,
      titleCount: 2,
    });

    spies.messageFindOneBy.mockResolvedValue(firstUserMessage as never);
    spies.executeWithLogging
      .mockResolvedValueOnce(chatResponse("Answer.") as never)
      .mockRejectedValueOnce(new Error("provider exploded") as never);

    await ChatAgentRunner.runTurn(buildRequest());
    await flushAsync();

    // The turn itself finalized normally (message completed, run completed).
    const finalized: JSONObject | undefined = findCallWithDataKey(
      spies.messageUpdateOneBy,
      "contentInMarkdown",
    );
    expect(finalized?.["contentInMarkdown"]).toBe("Answer.");
    expect(
      findCallWithDataKey(spies.conversationUpdateOneById, "title"),
    ).toBeUndefined();
  });
});
