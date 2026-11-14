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
import {
  AIChatLinesShown,
  AIChatRecordSeen,
} from "../../../../Types/AI/AIChatRecordSeen";
import {
  CodeFileUnseen,
  getCodeFileLinesShown,
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
 * ISSUE #6330, THROUGH THE WHOLE CHAT TURN.
 *
 * The model reads the lines around a stack frame - 340 to 460 of a
 * 2,000-line file - and asks for commit_code_to_branch with the whole file
 * it wrote from them. The chat runner keeps the lines each read showed on
 * its citation, carries every read of one version from batch to batch, from
 * an earlier turn and across an approval, and so:
 *
 *   - in Ask to act, the card says Ask AI read only part of the file;
 *   - in Auto-run the commit is not made: the model is told which lines it
 *     has not read, reads them, and commits on all of it;
 *   - reads that add up to all of the file, in several batches or turns,
 *     leave the card as it always was; a read asked for in the same batch
 *     as the commit does not count, as before.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa6330",
);

const CHARGE: string = "src/billing/charge.ts";

// A 2,000-line file of short lines: 400 of them fit one read.
const shortLines: (count: number) => string = (count: number): string => {
  let text: string = "";

  for (let line: number = 1; line <= count; line++) {
    text += `v${line} = ${line};\n`;
  }

  return text;
};

const V1: string = shortLines(2000);

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

// The lines around the frame that threw: 340 to 460.
const AROUND_THE_FRAME: ToolCall = READ_CALL("call-read", { aroundLine: 400 });

// The rest of the file, at most 400 lines a call.
const THE_REST: Array<ToolCall> = [
  [1, 339],
  [461, 860],
  [861, 1260],
  [1261, 1660],
  [1661, 2000],
].map(([startLine, endLine]: Array<number>, index: number): ToolCall => {
  return READ_CALL(`call-rest-${index}`, {
    startLine: startLine!,
    endLine: endLine!,
  });
});

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

// What Ask AI writes from what it read: line 400's charge doubled.
const fixed: (read: string) => string = (read: string): string => {
  return read.replace("v400 = 400;", "v400 = 800;");
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

const PART: string = `Ask AI read only part of this file, and its version replaces all of it: ${CHARGE}.`;

// What the card says of a file Ask AI read only in a turn before this one (issue #6365).
const EARLIER: string = `Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: ${CHARGE}.`;

const commitAction: (spies: Spies, id?: string) => AIChatToolAction = (
  spies: Spies,
  id?: string,
): AIChatToolAction => {
  return toolActionsOf(spies).find((action: AIChatToolAction) => {
    return action.id === (id || "call-commit");
  })!;
};

// What a read of lines first to last of the 2,000-line file keeps.
const readRecord: (first: number, last: number) => AIChatRecordSeen = (
  first: number,
  last: number,
): AIChatRecordSeen => {
  const linesShown: AIChatLinesShown | undefined = getCodeFileLinesShown({
    lineCount: 2000,
    firstLine: first,
    lastLine: last,
  });

  return seeCodeFile({
    repositoryId: repository.repositoryId.toString(),
    branchName: "fix/login",
    filePath: CHARGE,
    fingerprint: fingerprintCodeFileVersion(blobOf(V1)),
    linesShown,
  })!;
};

describe("Ask to act: the card says Ask AI read only part of the file", () => {
  test("lines 340 to 460 read, the whole file committed: the card says so, and nothing is committed", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [AROUND_THE_FRAME] }) },
        { answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(repository.commits).toEqual([]);

    const action: AIChatToolAction = commitAction(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.requiresApproval).toBe(true);
    expect(action.title).toBe("Commit 1 file to fix/login");
    expect(action.description).toBe(PART);
    expect(
      action.words!.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([AI_ACTION_PLURAL_LINES.codeFilesReadInPart.other]);

    // The read's citation keeps the lines it showed; the paused turn keeps the citation.
    const paused: AIRunPausedState = pausedStateOf(spies);
    expect(paused.citations[0]!.toolName).toBe("read_code_file");
    expect(paused.citations[0]!.recordSeen).toEqual(readRecord(340, 460));
    expect(
      (paused.citations[0]!.recordSeen as AIChatRecordSeen).linesShown,
    ).toEqual({ lineCount: 2000, ranges: [{ first: 340, last: 460 }] });
  });

  test("approved anyway, it is committed as the card said: the person chose", async () => {
    startRepository();
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [AROUND_THE_FRAME] }) },
        { answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) },
      ],
    });
    await ChatAgentRunner.runTurn(buildRequest());

    const spies: Spies = await resumeWith({
      paused: pausedStateOf(first),
      approved: ["call-commit"],
      turns: [{ answer: response({ content: "Committed." }) }],
    });

    expect(repository.commits).toHaveLength(1);
    expect(commitAction(spies).status).toBe(AIChatToolActionStatus.Executed);
  });

  test("the rest read in the batches after: all of it, the card as it always was", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [AROUND_THE_FRAME] }) },
        { answer: response({ toolCalls: THE_REST.slice(0, 2) }) },
        { answer: response({ toolCalls: THE_REST.slice(2) }) },
        { answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    const action: AIChatToolAction = commitAction(spies);
    expect(action.description).toBeUndefined();
    expect(action.words).toEqual({
      title: {
        template: "Commit {{count}} files to {{branch}}",
        count: 1,
        values: { branch: "fix/login" },
      },
    });
  });

  test("the rest asked for alongside the commit was not seen when the commit was written: still part", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [AROUND_THE_FRAME] }) },
        {
          answer: response({
            toolCalls: [...THE_REST, COMMIT_CALL(fixed(V1))],
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(PART);
  });
});

describe("Auto-run: a commit of a file read in part is not made unasked", () => {
  test("not made: the model is told the lines it has not read, reads them, and commits on all of it", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [AROUND_THE_FRAME] }) },
        {
          answer: response({
            toolCalls: [COMMIT_CALL(fixed("v400 = 400;\n"), "call-blind")],
          }),
        },
        { answer: response({ toolCalls: THE_REST }) },
        {
          // Written from all of the file it has now read.
          answer: (): AILogResponse => {
            return response({
              toolCalls: [
                COMMIT_CALL(
                  fixed(repository.branches.get("fix/login")!.get(CHARGE)!),
                  "call-whole",
                ),
              ],
            });
          },
        },
        { answer: response({ content: "Doubled line 400's charge." }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    // The model was told, in so many words.
    const told: string = toldModel(spies, "call-blind")!;
    expect(told).toMatch(/^Not done: nothing was committed to fix\/login/);
    expect(told).toContain(
      `- ${CHARGE} has 2000 lines on fix/login, and you have not read lines 1-339 and 461-2000 of it.`,
    );
    expect(told).toContain(
      'with read_code_file, branchName "fix/login", startLine and endLine',
    );

    // One commit: made on all of the file, every line kept.
    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(fixed(V1));
    expect(
      repository.branches.get("fix/login")!.get(CHARGE)!.split("\n"),
    ).toHaveLength(2001);

    const actions: Array<AIChatToolAction> = toolActionsOf(spies);
    expect(
      actions.map((action: AIChatToolAction) => {
        return [action.id, action.status];
      }),
    ).toEqual([
      ["call-blind", AIChatToolActionStatus.Skipped],
      ["call-whole", AIChatToolActionStatus.Executed],
    ]);
    expect(actions[0]!.resultSummary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.ReadInPart],
    );
    expect(actions[0]!.description).toBe(PART);
  });

  test("read all of it first: it commits at once, as Auto-run always did", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [AROUND_THE_FRAME, ...THE_REST] }) },
        { answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(repository.commits).toHaveLength(1);
    expect(commitAction(spies).status).toBe(AIChatToolActionStatus.Executed);
    expect(commitAction(spies).description).toBeUndefined();
  });
});

describe("what an earlier turn showed the model, and a turn resumed after an approval", () => {
  const earlierTurn: (
    citations: Array<AIChatCitation>,
  ) => Array<AIConversationMessage> = (
    citations: Array<AIChatCitation>,
  ): Array<AIConversationMessage> => {
    const question: AIConversationMessage = new AIConversationMessage();
    question.role = AIChatMessageRole.User;
    question.contentInMarkdown = "Why is the charge wrong?";

    const answer: AIConversationMessage = new AIConversationMessage();
    answer.role = AIChatMessageRole.Assistant;
    answer.status = AIChatMessageStatus.Completed;
    answer.contentInMarkdown = "Line 400 charges once.";
    answer.citations = citations;

    const now: AIConversationMessage = new AIConversationMessage();
    now.role = AIChatMessageRole.User;
    now.contentInMarkdown = "Make it charge twice, on fix/login.";

    return [now, answer, question];
  };

  const citationOf: (id: string, record: AIChatRecordSeen) => AIChatCitation = (
    id: string,
    record: AIChatRecordSeen,
  ): AIChatCitation => {
    return {
      id,
      toolName: "read_code_file",
      label: `${CHARGE} (acme/checkout)`,
      queryArguments: { filePath: CHARGE, branchName: "fix/login" },
      rowCount: 1,
      recordSeen: record,
    };
  };

  test("read in part in the turn before: none of it is in hand now, and the card says so (issue #6365)", async () => {
    startRepository();
    const spies: Spies = installSpies({
      history: earlierTurn([citationOf("C1", readRecord(340, 460))]),
      turns: [{ answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) }],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(EARLIER);
  });

  test("read in part in the turn before, the rest read in this one: all of it read, and the part from before no longer in hand (#6984)", async () => {
    startRepository();
    const spies: Spies = installSpies({
      history: earlierTurn([citationOf("C1", readRecord(1, 1000))]),
      turns: [
        {
          answer: response({
            toolCalls: [
              READ_CALL("call-second-half", { startLine: 1001, endLine: 1400 }),
              READ_CALL("call-rest", { startLine: 1401, endLine: 1800 }),
              READ_CALL("call-end", { startLine: 1801, endLine: 2000 }),
            ],
          }),
        },
        { answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    // Read, every line of it: never "read only part of" (issue #6984).
    expect(commitAction(spies).description).toBe(
      `Ask AI read this file and no longer has part of its text, and its version replaces all of it: ${CHARGE}.`,
    );
    expect(commitAction(spies).description).not.toBe(PART);
  });

  test("two reads in the turn before that add up to all of it: both carried, and none of it in hand now (issue #6365)", async () => {
    startRepository();
    const firstHalf: AIChatRecordSeen = readRecord(1, 1000);
    const secondHalf: AIChatRecordSeen = readRecord(1001, 2000);
    const spies: Spies = installSpies({
      history: earlierTurn([
        citationOf("C1", firstHalf),
        citationOf("C2", secondHalf),
      ]),
      turns: [{ answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) }],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(EARLIER);
    // The turn carries both reads of the version, not just the last - and stores them unmarked.
    expect(pausedStateOf(spies).recordsSeenBeforeTurn).toEqual([
      firstHalf,
      secondHalf,
    ]);
  });

  test("a citation from before OneUptime kept lines reads as all of the file - read in an earlier answer", async () => {
    startRepository();
    const old: AIChatRecordSeen = seeCodeFile({
      repositoryId: repository.repositoryId.toString(),
      branchName: "fix/login",
      filePath: CHARGE,
      fingerprint: fingerprintCodeFileVersion(blobOf(V1)),
    })!;
    const spies: Spies = installSpies({
      history: earlierTurn([citationOf("C1", old)]),
      turns: [{ answer: response({ toolCalls: [COMMIT_CALL(fixed(V1))] }) }],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(old.linesShown).toBeUndefined();
    // Never "read only part" (#6330): it is all of the file, only not in hand (issue #6365).
    expect(commitAction(spies).description).toBe(EARLIER);
  });

  test("resumed after an approval, the turn still knows every line it read before the pause", async () => {
    startRepository();
    // A commit of another file pauses the turn, between the reads and the commit of this one.
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
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [AROUND_THE_FRAME, ...THE_REST] }) },
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
});
