import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import {
  CODE_UNSEEN_SUMMARIES,
  CodeChangeKind,
  fingerprintCodeFileVersion,
} from "../../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
import AIService, {
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
 * ISSUE #6365, THROUGH THE WHOLE CHAT TURN.
 *
 * Turn 1: "why does checkout fail?" - the model reads src/billing/charge.ts
 * and explains. Turn 2: "fix it on fix/login" - the model commits the whole
 * file without reading it again. A new turn replays only the questions and
 * the answers, never the files, so the model writes it from memory. The
 * chat runner hands the earlier turn's records to the prepare marked as
 * from an earlier answer, so:
 *
 *   - in Ask to act, the card says Ask AI read the file in an earlier answer
 *     and no longer has its text;
 *   - in Auto-run the commit is not made: the model is told to read the file
 *     again in this answer, reads it, and commits on it;
 *   - read again in the turn of the commit: nothing on the card - but not a
 *     read asked for in the same batch as the commit;
 *   - a turn paused for an approval and resumed keeps its own reads in hand;
 *     what it had only from the turns before stays from an earlier answer.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa6365",
);

const CHARGE: string = "src/billing/charge.ts";

// A file of short lines: 300 of them, read whole in one read.
const shortLines: (count: number) => string = (count: number): string => {
  let text: string = "";

  for (let line: number = 1; line <= count; line++) {
    text += `v${line} = ${line};\n`;
  }

  return text;
};

const V1: string = shortLines(300);

let repository: FakeGitRepository;

const startRepository: () => void = (): void => {
  repository = makeRepository({
    files: {
      main: { [CHARGE]: V1 },
      "fix/login": { [CHARGE]: V1 },
    },
  });
};

type ToolCall = { id: string; name: string; arguments: JSONObject };

const READ_CALL: (id: string, window: JSONObject) => ToolCall = (
  id: string,
  window: JSONObject,
): ToolCall => {
  return {
    id,
    name: "read_code_file",
    arguments: { filePath: CHARGE, branchName: "fix/login", ...window },
  };
};

// The model reads the whole file on fix/login.
const READ_WHOLE: (id?: string) => ToolCall = (id?: string): ToolCall => {
  return READ_CALL(id || "call-read", {});
};

const COMMIT_CALL: (content: string, id?: string) => ToolCall = (
  content: string,
  id?: string,
): ToolCall => {
  return {
    id: id || "call-commit",
    name: "commit_code_to_branch",
    arguments: {
      branchName: "fix/login",
      commitMessage: "fix: charge twice",
      changes: [{ filePath: CHARGE, content }] as unknown as JSONObject[],
    } as unknown as JSONObject,
  };
};

// What Ask AI writes: line 40's charge doubled.
const fixed: (read: string) => string = (read: string): string => {
  return read.replace("v40 = 40;", "v40 = 80;");
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
}

type Turn = {
  answer: AILogResponse | (() => AILogResponse);
};

function installSpies(data: {
  turns: Array<Turn>;
  run?: AIRun | undefined;
  history?: Array<AIConversationMessage> | undefined;
}): Spies {
  jest.spyOn(AIRunEventService, "create").mockResolvedValue({} as never);
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

  serveOnGitHub(repository);

  const turns: Array<Turn> = [...data.turns];
  const executeWithLogging: SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockImplementation((async () => {
      const turn: Turn | undefined = turns.shift();
      if (!turn) {
        return response({ content: "Done." });
      }
      return typeof turn.answer === "function" ? turn.answer() : turn.answer;
    }) as never);

  return { executeWithLogging, messageUpdateOneBy, runUpdateOneBy };
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

const EARLIER: string = `Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: ${CHARGE}.`;

const commitAction: (spies: Spies, id?: string) => AIChatToolAction = (
  spies: Spies,
  id?: string,
): AIChatToolAction => {
  return toolActionsOf(spies).find((action: AIChatToolAction) => {
    return action.id === (id || "call-commit");
  })!;
};

// What a whole read of the file on fix/login keeps.
const readRecord: () => AIChatRecordSeen = (): AIChatRecordSeen => {
  return seeCodeFile({
    repositoryId: repository.repositoryId.toString(),
    branchName: "fix/login",
    filePath: CHARGE,
    fingerprint: fingerprintCodeFileVersion(blobOf(V1)),
  })!;
};

// The turn before: the question, the answer and its citations; then this turn's question.
const earlierTurn: (
  citations: Array<AIChatCitation>,
) => Array<AIConversationMessage> = (
  citations: Array<AIChatCitation>,
): Array<AIConversationMessage> => {
  const question: AIConversationMessage = new AIConversationMessage();
  question.role = AIChatMessageRole.User;
  question.contentInMarkdown = "Why does checkout fail?";

  const answer: AIConversationMessage = new AIConversationMessage();
  answer.role = AIChatMessageRole.Assistant;
  answer.status = AIChatMessageStatus.Completed;
  answer.contentInMarkdown = "Line 40 charges once.";
  answer.citations = citations;

  const now: AIConversationMessage = new AIConversationMessage();
  now.role = AIChatMessageRole.User;
  now.contentInMarkdown = "Fix it on fix/login.";

  return [now, answer, question];
};

const readCitation: () => AIChatCitation = (): AIChatCitation => {
  return {
    id: "C1",
    toolName: "read_code_file",
    label: `${CHARGE}:1-300 (acme/checkout)`,
    queryArguments: { filePath: CHARGE, branchName: "fix/login" },
    rowCount: 300,
    recordSeen: readRecord(),
  };
};

// A commit of another file, which pauses the turn for an approval.
const OTHER: ToolCall = {
  id: "call-other",
  name: "commit_code_to_branch",
  arguments: {
    branchName: "fix/login",
    commitMessage: "docs: note",
    changes: [
      { filePath: "NOTES.md", content: "note\n" },
    ] as unknown as JSONObject[],
  } as unknown as JSONObject,
};

describe("a new turn: the conversation's history, loaded fresh", () => {
  test("read whole in the turn before, committed now without a read: the card says so, and nothing is committed", async () => {
    startRepository();
    const history: Array<AIConversationMessage> = earlierTurn([readCitation()]);
    const spies: Spies = installSpies({
      history,
      turns: [{ answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) }],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(repository.commits).toEqual([]);

    const action: AIChatToolAction = commitAction(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.title).toBe("Commit 1 file to fix/login");
    expect(action.description).toBe(EARLIER);
    expect(
      action.words!.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other]);
    // The turn stores the record as the citation kept it: never marked.
    expect(pausedStateOf(spies).recordsSeenBeforeTurn).toEqual([readRecord()]);
    expect(
      JSON.stringify(pausedStateOf(spies).recordsSeenBeforeTurn),
    ).not.toContain("fromEarlierAnswer");
  });

  test("read again in the turn of the commit: nothing on the card", async () => {
    startRepository();
    const spies: Spies = installSpies({
      history: earlierTurn([readCitation()]),
      turns: [
        { answer: response({ toolCalls: [READ_WHOLE()] }) },
        { answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBeUndefined();
  });

  test("a read asked for in the same batch as the commit was not seen when the commit was written: still from memory", async () => {
    startRepository();
    const spies: Spies = installSpies({
      history: earlierTurn([readCitation()]),
      turns: [
        {
          answer: response({
            toolCalls: [READ_WHOLE(), COMMIT_CALL(fixed(V1))],
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(EARLIER);
  });

  test("a commit of its own in the turn before: it wrote the file, but no longer has it", async () => {
    startRepository();
    const spies: Spies = installSpies({
      history: earlierTurn([
        {
          id: "C1",
          toolName: "commit_code_to_branch",
          label: "Commit abc1234 on fix/login (1 file)",
          queryArguments: {},
          rowCount: 1,
          recordSeen: [readRecord()],
        },
      ]),
      turns: [{ answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) }],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(EARLIER);
  });
});

describe("Auto-run: a commit written from an earlier answer is not made unasked", () => {
  test("not made: the model is told to read the file again in this answer, reads it, and commits on it", async () => {
    startRepository();
    const spies: Spies = installSpies({
      history: earlierTurn([readCitation()]),
      turns: [
        {
          answer: response({
            toolCalls: [COMMIT_CALL(fixed(V1), "call-memory")],
          }),
        },
        { answer: response({ toolCalls: [READ_WHOLE("call-again")] }) },
        {
          answer: response({
            toolCalls: [COMMIT_CALL(fixed(V1), "call-after-reading")],
          }),
        },
        { answer: response({ content: "Doubled line 40's charge." }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    const told: string = toldModel(spies, "call-memory")!;
    expect(told).toMatch(
      /^Not done: nothing was committed to fix\/login, because you read these files in an earlier answer and no longer have their text:/,
    );
    expect(told).toContain(
      `- ${CHARGE}: you read it in an earlier answer, and you no longer have its text.`,
    );
    expect(told).toContain(
      'Read each file you read in an earlier answer again in this answer, on fix/login with read_code_file and branchName "fix/login"',
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
        CodeFileUnseen.ReadInEarlierAnswer
      ],
    );
  });

  test("a model that keeps committing from memory is turned back each time, and nothing is committed", async () => {
    startRepository();
    const spies: Spies = installSpies({
      history: earlierTurn([readCitation()]),
      turns: [1, 2, 3].map((attempt: number): Turn => {
        return {
          answer: response({
            toolCalls: [COMMIT_CALL(fixed(V1), `call-${attempt}`)],
          }),
        };
      }),
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(repository.commits).toEqual([]);
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

describe("a turn paused for an approval and resumed", () => {
  test("keeps its own reads in hand: the commit after the pause says nothing", async () => {
    startRepository();
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_WHOLE()] }) },
        { answer: response({ toolCalls: [OTHER] }) },
      ],
    });
    await ChatAgentRunner.runTurn(buildRequest());

    const spies: Spies = await resumeWith({
      paused: pausedStateOf(first),
      approved: ["call-other"],
      turns: [{ answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) }],
    });

    expect(commitAction(spies, "call-other").status).toBe(
      AIChatToolActionStatus.Executed,
    );
    const action: AIChatToolAction = commitAction(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.description).toBeUndefined();
  });

  test("what it had only from the turns before stays from an earlier answer after the resume", async () => {
    startRepository();
    const first: Spies = installSpies({
      history: earlierTurn([readCitation()]),
      turns: [{ answer: response({ toolCalls: [OTHER] }) }],
    });
    await ChatAgentRunner.runTurn(buildRequest());

    // The paused turn stores the turns before as they were, unmarked.
    expect(pausedStateOf(first).recordsSeenBeforeTurn).toEqual([readRecord()]);

    const spies: Spies = await resumeWith({
      paused: pausedStateOf(first),
      approved: ["call-other"],
      turns: [{ answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) }],
    });

    expect(commitAction(spies).description).toBe(EARLIER);
  });
});
