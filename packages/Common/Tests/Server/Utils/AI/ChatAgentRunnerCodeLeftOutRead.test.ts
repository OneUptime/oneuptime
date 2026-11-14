import ChatAgentRunner, {
  ChatExtraTool,
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import {
  DEFAULT_MAX_CONTEXT_CHARS,
  ELIDED_TOOL_RESULT_PREFIX,
} from "../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import {
  CODE_UNSEEN_SUMMARIES,
  CodeChangeKind,
  fingerprintCodeFileVersion,
} from "../../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import ProjectService from "../../../../Server/Services/ProjectService";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIChatMessageRole from "../../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AI_ACTION_PLURAL_LINES,
  AIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatToolActionStatus,
  AIRunPausedState,
} from "../../../../Types/AI/AIChatTypes";
import { AIChatRecordSeen } from "../../../../Types/AI/AIChatRecordSeen";
import {
  CodeFileUnseen,
  seeCodeFile,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  FakeGitRepository,
  blobOf,
  makeRepository,
  serveOnGitHub,
} from "./FakeGitRepository";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6570, THROUGH THE WHOLE CHAT TURN.
 *
 * One long answer: the model reads src/billing/charge.ts early, then runs
 * query after query, each result long. The conversation outgrows what the
 * model can take in at once, so the oldest results are left out
 * (compactAgentContext) - the read among them - and the model has only a
 * note in its place. Then it commits the "whole" file: from memory. The
 * chat runner hands the records of left-out results to the prepare marked
 * as such, so:
 *
 *   - in Ask to act, the card says Ask AI read the file earlier in this
 *     answer and no longer has its text;
 *   - in Auto-run the commit is not made: the model is told to read the file
 *     again now, reads it, and commits on it;
 *   - read again after the read was left out: nothing on the card;
 *   - a long answer whose read was not left out: nothing on the card;
 *   - a turn paused for an approval and resumed reads what its paused
 *     conversation had left out;
 *   - a commit of Ask AI's own whose result was left out stays in hand: the
 *     call that made it, with everything it wrote, stays in the
 *     conversation whole;
 *   - a file read in an earlier answer and one left out of this one: both
 *     named, each in its own words.
 *
 * The queries' results are big enough for the turn's own limit
 * (DEFAULT_MAX_CONTEXT_CHARS) to leave the read out, as in a real turn.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa6570",
);

const CHARGE: string = "src/billing/charge.ts";
const REFUND: string = "src/billing/refund.ts";

// A file of short lines: 300 of them, read whole in one read.
const shortLines: (count: number, name: string) => string = (
  count: number,
  name: string,
): string => {
  let text: string = "";

  for (let line: number = 1; line <= count; line++) {
    text += `${name}${line} = ${line};\n`;
  }

  return text;
};

const V1: string = shortLines(300, "v");
const R1: string = shortLines(200, "r");

// A query's result this long: three of them fill the conversation past its limit.
const RESULT_CHARS: number = 125_000;

let repository: FakeGitRepository;

const startRepository: () => void = (): void => {
  repository = makeRepository({
    files: {
      main: { [CHARGE]: V1, [REFUND]: R1 },
      "fix/login": { [CHARGE]: V1, [REFUND]: R1 },
    },
  });
};

type ToolCall = { id: string; name: string; arguments: JSONObject };

// The model reads a whole file on fix/login.
const READ: (id: string, filePath?: string) => ToolCall = (
  id: string,
  filePath?: string,
): ToolCall => {
  return {
    id,
    name: "read_code_file",
    arguments: { filePath: filePath || CHARGE, branchName: "fix/login" },
  };
};

// A page of the journal: RESULT_CHARS long.
const JOURNAL_PAGE: (page: number) => ToolCall = (page: number): ToolCall => {
  return {
    id: `call-journal-${page}`,
    name: "read_checkout_journal",
    arguments: { service: "checkout", page },
  };
};

const COMMIT_CALL: (
  changes: Array<{ filePath: string; content: string }>,
  id?: string,
) => ToolCall = (
  changes: Array<{ filePath: string; content: string }>,
  id?: string,
): ToolCall => {
  return {
    id: id || "call-commit",
    name: "commit_code_to_branch",
    arguments: {
      branchName: "fix/login",
      commitMessage: "fix: charge twice",
      changes: changes as unknown as JSONObject[],
    } as unknown as JSONObject,
  };
};

// What Ask AI writes: line 40's charge doubled.
const fixed: (read: string) => string = (read: string): string => {
  return read.replace("v40 = 40;", "v40 = 80;");
};

// And, on top of that, line 41's.
const fixedAgain: (read: string) => string = (read: string): string => {
  return fixed(read).replace("v41 = 41;", "v41 = 82;");
};

const COMMIT_CHARGE: (content: string, id?: string) => ToolCall = (
  content: string,
  id?: string,
): ToolCall => {
  return COMMIT_CALL([{ filePath: CHARGE, content }], id);
};

// A commit of another file, which pauses the turn for an approval.
const OTHER: ToolCall = COMMIT_CALL(
  [{ filePath: "NOTES.md", content: "note\n" }],
  "call-other",
);

// The checkout service's journal, a page at a time: each page long, and different.
const JOURNAL: ChatExtraTool = {
  definition: {
    name: "read_checkout_journal",
    description: "Read a page of the checkout service's journal.",
    inputSchema: { type: "object", properties: {} },
  },
  execute: async (args: JSONObject): Promise<ToolCallOutcome> => {
    const text: string = `journal page ${JSON.stringify(args)}\n`.padEnd(
      RESULT_CHARS,
      "x",
    );

    return {
      success: true,
      textForLlm: text,
      result: {
        dataForLlm: text,
        rowCount: 500,
        citationLabel: `Journal ${JSON.stringify(args)}`,
        redactionCount: 0,
        isTruncated: false,
      },
    };
  },
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

// The model's turns, one call a round.
const rounds: (calls: Array<ToolCall>) => Array<Turn> = (
  calls: Array<ToolCall>,
): Array<Turn> => {
  return calls.map((toolCall: ToolCall): Turn => {
    return { answer: response({ toolCalls: [toolCall] }) };
  });
};

// Read charge.ts, then three long queries: the read is left out by the time the model writes.
const READ_THEN_QUERIES: Array<ToolCall> = [
  READ("call-read"),
  JOURNAL_PAGE(1),
  JOURNAL_PAGE(2),
  JOURNAL_PAGE(3),
];

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
    extraTools: [JOURNAL],
    ...overrides,
  };
}

interface Spies {
  executeWithLogging: SpyInstance;
  messageUpdateOneBy: SpyInstance;
  runUpdateOneBy: SpyInstance;
  // What each model call was sent, copied when it was made.
  sent: Array<Array<LLMMessage>>;
  // What the model answered each call with.
  answered: Array<AILogResponse>;
}

type Turn = {
  answer: AILogResponse;
};

function installSpies(data: {
  turns: Array<Turn>;
  run?: AIRun | undefined;
  history?: Array<AIConversationMessage> | undefined;
}): Spies {
  jest.spyOn(AIRunEventService, "create").mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);
  // Nothing set in Limits per run.
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(new Project() as never);

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

  serveOnGitHub(repository);

  const sent: Array<Array<LLMMessage>> = [];
  const answered: Array<AILogResponse> = [];
  const turns: Array<Turn> = [...data.turns];
  const executeWithLogging: SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockImplementation((async (request: AILogRequest) => {
      sent.push(
        request.messages.map((message: LLMMessage): LLMMessage => {
          return { ...message };
        }),
      );

      const turn: Turn | undefined = turns.shift();
      const reply: AILogResponse = turn
        ? turn.answer
        : response({ content: "Done." });
      answered.push(reply);
      return reply;
    }) as never);

  return {
    executeWithLogging,
    messageUpdateOneBy,
    runUpdateOneBy,
    sent,
    answered,
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
      return JSON.parse(JSON.stringify(paused)) as AIRunPausedState;
    }
  }

  throw new Error("The run was never paused for approval.");
}

// What the model was told in answer to a call: its tool message, the first time it was sent.
const toldModel: (spies: Spies, toolCallId: string) => string | undefined = (
  spies: Spies,
  toolCallId: string,
): string | undefined => {
  for (const messages of spies.sent) {
    const answer: LLMMessage | undefined = messages.find(
      (message: LLMMessage) => {
        return message.role === "tool" && message.toolCallId === toolCallId;
      },
    );
    if (answer) {
      return answer.content;
    }
  }

  return undefined;
};

/*
 * What the model had in place of a call's answer when it asked for
 * another: the tool message as the call asking for `askedBy` was sent it.
 */
const heldWhenAsking: (data: {
  spies: Spies;
  askedBy: string;
  answerOf: string;
}) => string | undefined = (data: {
  spies: Spies;
  askedBy: string;
  answerOf: string;
}): string | undefined => {
  // The model call that the model answered with that call.
  const callIndex: number = data.spies.answered.findIndex(
    (reply: AILogResponse): boolean => {
      return (reply.toolCalls || []).some((toolCall: { id: string }) => {
        return toolCall.id === data.askedBy;
      });
    },
  );

  return callIndex < 0
    ? undefined
    : data.spies.sent[callIndex]!.find((message: LLMMessage): boolean => {
        return message.role === "tool" && message.toolCallId === data.answerOf;
      })?.content;
};

const resumeWith: (data: {
  paused: AIRunPausedState;
  approved: Array<string>;
  turns: Array<Turn>;
}) => Promise<Spies> = async (data: {
  paused: AIRunPausedState;
  approved: Array<string>;
  turns: Array<Turn>;
}): Promise<Spies> => {
  jest.restoreAllMocks();
  const run: AIRun = new AIRun();
  run.status = AIRunStatus.WaitingForApproval;
  run.pausedState = data.paused;
  const spies: Spies = installSpies({ run, turns: data.turns });

  await ChatAgentRunner.resumeTurn(
    buildRequest(),
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

const LEFT_OUT: string = `Ask AI read this file earlier in this answer and no longer has its text, and its version replaces all of it: ${CHARGE}.`;

const EARLIER: string = `Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: ${REFUND}.`;

const commitAction: (spies: Spies, id?: string) => AIChatToolAction = (
  spies: Spies,
  id?: string,
): AIChatToolAction => {
  return toolActionsOf(spies).find((action: AIChatToolAction) => {
    return action.id === (id || "call-commit");
  })!;
};

const templatesOf: (action: AIChatToolAction) => Array<string> = (
  action: AIChatToolAction,
): Array<string> => {
  return (action.words?.description || []).map((sentence: AIActionSentence) => {
    return sentence.template;
  });
};

// The turn before: a question, an answer that read refund.ts, and this turn's question.
const earlierTurnThatRead: (
  filePath: string,
  content: string,
) => Array<AIConversationMessage> = (
  filePath: string,
  content: string,
): Array<AIConversationMessage> => {
  const record: AIChatRecordSeen = seeCodeFile({
    repositoryId: repository.repositoryId.toString(),
    branchName: "fix/login",
    filePath,
    fingerprint: fingerprintCodeFileVersion(blobOf(content)),
  })!;
  const citation: AIChatCitation = {
    id: "C1",
    toolName: "read_code_file",
    label: `${filePath} (acme/checkout)`,
    queryArguments: { filePath, branchName: "fix/login" },
    rowCount: 200,
    recordSeen: record,
  };

  const question: AIConversationMessage = new AIConversationMessage();
  question.role = AIChatMessageRole.User;
  question.contentInMarkdown = "How are refunds made?";

  const answer: AIConversationMessage = new AIConversationMessage();
  answer.role = AIChatMessageRole.Assistant;
  answer.status = AIChatMessageStatus.Completed;
  answer.contentInMarkdown = "Refunds go through refund.ts.";
  answer.citations = [citation];

  const now: AIConversationMessage = new AIConversationMessage();
  now.role = AIChatMessageRole.User;
  now.contentInMarkdown = "Charge twice on fix/login, and fix refunds too.";

  return [now, answer, question];
};

describe("a long answer whose read was left out", () => {
  test("three long results take the conversation past the turn's own limit", () => {
    expect(2 * RESULT_CHARS + V1.length).toBeLessThan(
      DEFAULT_MAX_CONTEXT_CHARS,
    );
    expect(3 * RESULT_CHARS).toBeGreaterThan(DEFAULT_MAX_CONTEXT_CHARS);
  });

  test("the issue's case: committed without a read after it was left out - the card says so, and nothing is committed", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: rounds([...READ_THEN_QUERIES, COMMIT_CHARGE(fixed(V1))]),
    });

    await ChatAgentRunner.runTurn(buildRequest());

    // When the model wrote the commit, it had only a note in place of its read.
    expect(
      heldWhenAsking({ spies, askedBy: "call-commit", answerOf: "call-read" }),
    ).toMatch(new RegExp(`^\\${ELIDED_TOOL_RESULT_PREFIX} \\(C1\\)`));

    expect(repository.commits).toEqual([]);

    const action: AIChatToolAction = commitAction(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.title).toBe("Commit 1 file to fix/login");
    expect(action.description).toBe(LEFT_OUT);
    expect(templatesOf(action)).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer.other,
    ]);

    // The turn stores its citations as they were: never marked.
    const paused: AIRunPausedState = pausedStateOf(spies);
    expect(JSON.stringify(paused.citations)).not.toContain("fromLeftOutResult");
    expect(JSON.stringify(paused)).not.toContain("fromLeftOutResult");
  }, 120_000);

  test("read again after it was left out: nothing on the card", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: rounds([
        ...READ_THEN_QUERIES,
        READ("call-read-again"),
        COMMIT_CHARGE(fixed(V1)),
      ]),
    });

    await ChatAgentRunner.runTurn(buildRequest());

    // The first read was left out; the second was in hand when the model wrote.
    expect(
      heldWhenAsking({ spies, askedBy: "call-commit", answerOf: "call-read" }),
    ).toMatch(new RegExp(`^\\${ELIDED_TOOL_RESULT_PREFIX}`));
    expect(
      heldWhenAsking({
        spies,
        askedBy: "call-commit",
        answerOf: "call-read-again",
      }),
    ).toContain("v40 = 40;");

    const action: AIChatToolAction = commitAction(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.description).toBeUndefined();
  }, 120_000);

  test("a long answer whose read was not left out: nothing on the card, as before", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: rounds([
        READ("call-read"),
        JOURNAL_PAGE(1),
        COMMIT_CHARGE(fixed(V1)),
      ]),
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(
      heldWhenAsking({ spies, askedBy: "call-commit", answerOf: "call-read" }),
    ).toContain("v40 = 40;");
    expect(commitAction(spies).description).toBeUndefined();
  }, 120_000);
});

describe("Auto-run: a commit written after its read was left out is not made unasked", () => {
  test("not made: the model is told to read the file again now, reads it, and commits on it", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        ...rounds([
          ...READ_THEN_QUERIES,
          COMMIT_CHARGE(fixed(V1), "call-memory"),
          READ("call-again"),
          COMMIT_CHARGE(fixed(V1), "call-after-reading"),
        ]),
        { answer: response({ content: "Doubled line 40's charge." }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(toldModel(spies, "call-memory")).toBe(
      [
        "Not done: nothing was committed to fix/login, because you read these files earlier in this answer and their text has been left out of this conversation since:",
        `- ${CHARGE}: you read it earlier in this answer, and its text has been left out of this conversation since, to keep it within your context window.`,
        'Read each file whose text was left out again now, on fix/login with read_code_file and branchName "fix/login", and write it whole right after you read it: a commit replaces each file whole, and you no longer have the text you read before.',
      ].join("\n"),
    );

    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(fixed(V1));

    const actions: Array<AIChatToolAction> = toolActionsOf(spies);
    expect(
      actions.map((action: AIChatToolAction) => {
        return [action.id, action.status];
      }),
    ).toEqual([
      ["call-memory", AIChatToolActionStatus.Skipped],
      ["call-after-reading", AIChatToolActionStatus.Executed],
    ]);
    expect(actions[0]!.resultSummary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ReadEarlierInThisAnswer
      ],
    );
    expect(actions[0]!.resultSummary).toBe(
      "Not committed: Ask AI had read a file the commit replaces earlier in this answer, and no longer had its text.",
    );
  }, 120_000);

  test("its own commit, whose result was left out since, stays in hand: the next commit on it is made", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        ...rounds([
          READ("call-read"),
          COMMIT_CHARGE(fixed(V1), "call-first"),
          JOURNAL_PAGE(1),
          JOURNAL_PAGE(2),
          JOURNAL_PAGE(3),
          COMMIT_CHARGE(fixedAgain(V1), "call-second"),
        ]),
        { answer: response({ content: "Doubled lines 40 and 41." }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    // Both the read and the first commit's result were left out before the second commit.
    for (const answerOf of ["call-read", "call-first"]) {
      expect({
        answerOf,
        leftOut: heldWhenAsking({
          spies,
          askedBy: "call-second",
          answerOf,
        })!.startsWith(ELIDED_TOOL_RESULT_PREFIX),
      }).toEqual({ answerOf, leftOut: true });
    }

    // The call that wrote it is still in the conversation whole, so the version it wrote is in hand.
    expect(
      toolActionsOf(spies).map((action: AIChatToolAction) => {
        return [action.id, action.status];
      }),
    ).toEqual([
      ["call-first", AIChatToolActionStatus.Executed],
      ["call-second", AIChatToolActionStatus.Executed],
    ]);
    expect(repository.commits).toHaveLength(2);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(
      fixedAgain(V1),
    );
  }, 120_000);
});

describe("a turn paused for an approval and resumed", () => {
  test("reads what its paused conversation had left out: the commit after the pause names the file", async () => {
    startRepository();
    const first: Spies = installSpies({
      turns: rounds([...READ_THEN_QUERIES, OTHER]),
    });
    await ChatAgentRunner.runTurn(buildRequest());

    // The paused conversation keeps the note in place of the read, as it was sent.
    const paused: AIRunPausedState = pausedStateOf(first);
    const readAnswer: JSONObject | undefined = (
      paused.messages as Array<JSONObject>
    ).find((message: JSONObject): boolean => {
      return (
        message["role"] === "tool" && message["toolCallId"] === "call-read"
      );
    });
    expect(String(readAnswer?.["content"])).toMatch(
      new RegExp(`^\\${ELIDED_TOOL_RESULT_PREFIX} \\(C1\\)`),
    );

    const spies: Spies = await resumeWith({
      paused,
      approved: ["call-other"],
      turns: rounds([COMMIT_CHARGE(fixed(V1))]),
    });

    expect(commitAction(spies, "call-other").status).toBe(
      AIChatToolActionStatus.Executed,
    );
    const action: AIChatToolAction = commitAction(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.description).toBe(LEFT_OUT);
  }, 120_000);
});

describe("a file read in an earlier answer, and one left out of this one", () => {
  test("Ask to act: both named, each in its own words, the earlier one first", async () => {
    startRepository();
    const spies: Spies = installSpies({
      history: earlierTurnThatRead(REFUND, R1),
      turns: rounds([
        ...READ_THEN_QUERIES,
        COMMIT_CALL([
          { filePath: CHARGE, content: fixed(V1) },
          { filePath: REFUND, content: R1.replace("r1 = 1;", "r1 = 2;") },
        ]),
      ]),
    });

    await ChatAgentRunner.runTurn(buildRequest());

    const action: AIChatToolAction = commitAction(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(templatesOf(action)).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other,
      AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer.other,
    ]);
    expect(action.description).toContain(EARLIER);
    expect(action.description).toContain(LEFT_OUT);
    expect(action.description!.indexOf(EARLIER)).toBeLessThan(
      action.description!.indexOf(LEFT_OUT),
    );
  }, 120_000);

  test("Auto-run: not made, and the model is told of each, with what to read again", async () => {
    startRepository();
    const spies: Spies = installSpies({
      history: earlierTurnThatRead(REFUND, R1),
      turns: rounds([
        ...READ_THEN_QUERIES,
        COMMIT_CALL(
          [
            { filePath: CHARGE, content: fixed(V1) },
            { filePath: REFUND, content: R1.replace("r1 = 1;", "r1 = 2;") },
          ],
          "call-memory",
        ),
      ]),
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(toldModel(spies, "call-memory")).toBe(
      [
        "Not done: nothing was committed to fix/login, because you read these files before and no longer have their text:",
        `- ${CHARGE}: you read it earlier in this answer, and its text has been left out of this conversation since, to keep it within your context window.`,
        `- ${REFUND}: you read it in an earlier answer, and you no longer have its text.`,
        'Read each file you read in an earlier answer again in this answer, on fix/login with read_code_file and branchName "fix/login", and only then write it whole: a commit replaces each file whole, and you no longer have the text you read before.',
        'Read each file whose text was left out again now, on fix/login with read_code_file and branchName "fix/login", and write it whole right after you read it: a commit replaces each file whole, and you no longer have the text you read before.',
      ].join("\n"),
    );
    expect(repository.commits).toEqual([]);
    expect(commitAction(spies, "call-memory").status).toBe(
      AIChatToolActionStatus.Skipped,
    );
    // The most important reason first: read in an earlier answer.
    expect(commitAction(spies, "call-memory").resultSummary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ReadInEarlierAnswer
      ],
    );
  }, 120_000);
});

/*
 * Issue #6984: a file read in two parts, the first left out by the time
 * the model writes. It read every line, so the card never says it read
 * only part, and the model is never told it has not read lines it read:
 * it read them earlier, and no longer has them.
 */
describe("a file read in two parts, the first left out since (#6984)", () => {
  // 800 short lines: 400 to a read, so two reads read all of it.
  const LONG: string = shortLines(800, "v");

  const startLongRepository: () => void = (): void => {
    repository = makeRepository({ files: { "fix/login": { [CHARGE]: LONG } } });
  };

  const READ_LINES: (
    id: string,
    startLine: number,
    endLine: number,
  ) => ToolCall = (
    id: string,
    startLine: number,
    endLine: number,
  ): ToolCall => {
    return {
      id,
      name: "read_code_file",
      arguments: {
        filePath: CHARGE,
        branchName: "fix/login",
        startLine,
        endLine,
      },
    };
  };

  // The first half, three long results, the second half: the first half is left out.
  const HALVES_THEN_QUERIES: Array<ToolCall> = [
    READ_LINES("call-first-half", 1, 400),
    JOURNAL_PAGE(1),
    JOURNAL_PAGE(2),
    JOURNAL_PAGE(3),
    READ_LINES("call-second-half", 401, 800),
  ];

  const PART_NO_LONGER_IN_HAND: string = `Ask AI read this file and no longer has part of its text, and its version replaces all of it: ${CHARGE}.`;

  test("Ask to act: the card says Ask AI read it and no longer has part of it - never that it read only part", async () => {
    startLongRepository();
    const spies: Spies = installSpies({
      turns: rounds([...HALVES_THEN_QUERIES, COMMIT_CHARGE(fixed(LONG))]),
    });

    await ChatAgentRunner.runTurn(buildRequest());

    // When the model wrote, the first half was a note, and the second half still in hand.
    expect(
      heldWhenAsking({
        spies,
        askedBy: "call-commit",
        answerOf: "call-first-half",
      }),
    ).toMatch(new RegExp(`^\\${ELIDED_TOOL_RESULT_PREFIX}`));
    expect(
      heldWhenAsking({
        spies,
        askedBy: "call-commit",
        answerOf: "call-second-half",
      }),
    ).toContain("v800 = 800;");

    const action: AIChatToolAction = commitAction(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.description).toBe(PART_NO_LONGER_IN_HAND);
    expect(templatesOf(action)).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand.other,
    ]);
    expect(repository.commits).toEqual([]);
  }, 120_000);

  test("Auto-run: not made - the model is told it read lines 1-400 earlier and no longer has them, reads them again, and commits", async () => {
    startLongRepository();
    const spies: Spies = installSpies({
      turns: [
        ...rounds([
          ...HALVES_THEN_QUERIES,
          COMMIT_CHARGE(fixed(LONG), "call-memory"),
          READ_LINES("call-first-half-again", 1, 400),
          COMMIT_CHARGE(fixed(LONG), "call-after-reading"),
        ]),
        { answer: response({ content: "Doubled line 40's charge." }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(toldModel(spies, "call-memory")).toBe(
      [
        "Not done: nothing was committed to fix/login, because you read these files before and no longer have all of their text:",
        `- ${CHARGE} has 800 lines on fix/login, and you read lines 1-400 earlier and no longer have them.`,
        'Read the lines you no longer have again now, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and write each file whole right after you read them: a commit replaces each file whole, and you no longer have the text you read of those lines before.',
      ].join("\n"),
    );
    expect(toldModel(spies, "call-memory")).not.toContain("not read");

    const actions: Array<AIChatToolAction> = toolActionsOf(spies);
    expect(
      actions.map((action: AIChatToolAction) => {
        return [action.id, action.status];
      }),
    ).toEqual([
      ["call-memory", AIChatToolActionStatus.Skipped],
      ["call-after-reading", AIChatToolActionStatus.Executed],
    ]);
    expect(actions[0]!.resultSummary).toBe(
      "Not committed: Ask AI had read a file the commit replaces whole, and no longer had part of its text.",
    );
    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(fixed(LONG));
  }, 120_000);
});
