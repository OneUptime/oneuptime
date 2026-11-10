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
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
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
  AIChatRecordSeen,
  AIChatRecordSeenType,
} from "../../../../Types/AI/AIChatRecordSeen";
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
  push,
  serveOnGitHub,
} from "./FakeGitRepository";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6313, THROUGH THE WHOLE CHAT TURN.
 *
 * The model reads a file with read_code_file, a teammate pushes to it, and
 * the model asks for commit_code_to_branch with its version, written from
 * the earlier read. The chat runner keeps what each result showed the
 * model on its citation - a read's file, a commit's files - hands the
 * prepare what the model had seen when it asked, never a read asked for
 * alongside, and so:
 *
 *   - in Ask to act, the card names the file before anyone approves it;
 *     with nothing pushed since, the card is as it always was;
 *   - in Auto-run the commit is not made: the model is told to read the
 *     file again, does, and commits on the file as it is - the teammate's
 *     change kept;
 *   - what an earlier turn showed the model counts, a turn resumed after an
 *     approval keeps it, and an approval is held to the card it was given.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa6313",
);

const CHARGE: string = "src/billing/charge.ts";
const V1: string = "export const charge = 1;\n";
const TEAMMATE: string =
  "export const charge = 1;\nexport const audited = true;\n";

let repository: FakeGitRepository;

const startRepository: () => void = (): void => {
  repository = makeRepository({
    files: {
      main: { [CHARGE]: V1 },
      "fix/login": { [CHARGE]: V1 },
    },
  });
};

const pushTheTeammatesChange: () => void = (): void => {
  push(repository, "fix/login", CHARGE, TEAMMATE);
};

type ToolCall = { id: string; name: string; arguments: JSONObject };

const READ_CALL: (id?: string, branchName?: string) => ToolCall = (
  id?: string,
  branchName?: string,
): ToolCall => {
  return {
    id: id || "call-read",
    name: "read_code_file",
    arguments: { filePath: CHARGE, branchName: branchName || "fix/login" },
  };
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

// What Ask AI writes from what it read: the charge doubled.
const doubled: (read: string) => string = (read: string): string => {
  return read.replace("charge = 1", "charge = 2");
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
  eventCreate: SpyInstance;
}

type Turn = {
  meanwhile?: () => void;
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

  serveOnGitHub(repository);

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

const CHANGED: string = `This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: ${CHARGE}.`;

const commitAction: (spies: Spies, id?: string) => AIChatToolAction = (
  spies: Spies,
  id?: string,
): AIChatToolAction => {
  return toolActionsOf(spies).find((action: AIChatToolAction) => {
    return action.id === (id || "call-commit");
  })!;
};

describe("Ask to act: the card names the file before anyone approves it", () => {
  test("read, a teammate pushes, Ask AI commits from its read: the card names the file, and nothing is committed", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: pushTheTeammatesChange,
          answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(repository.commits).toEqual([]);

    const action: AIChatToolAction = commitAction(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.requiresApproval).toBe(true);
    expect(action.title).toBe("Commit 1 file to fix/login");
    expect(action.description).toBe(CHANGED);
    expect(
      action.words!.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([AI_ACTION_PLURAL_LINES.codeFilesChangedSinceRead.other]);

    // The read's citation keeps what it showed the model; the paused turn keeps the citation.
    const paused: AIRunPausedState = pausedStateOf(spies);
    expect(paused.citations[0]!.toolName).toBe("read_code_file");
    expect(paused.citations[0]!.recordSeen).toEqual(
      seeCodeFile({
        repositoryId: repository.repositoryId.toString(),
        branchName: "fix/login",
        filePath: CHARGE,
        fingerprint: fingerprintCodeFileVersion(blobOf(V1)),
      }),
    );
    expect(
      lastSaved<Array<AIChatCitation>>(spies, "citations")![0]!.recordSeen,
    ).toBeDefined();
  });

  test("approved, it is committed as the card said: the person chose", async () => {
    startRepository();
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: pushTheTeammatesChange,
          answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }),
        },
      ],
    });
    await ChatAgentRunner.runTurn(buildRequest());

    const spies: Spies = await resumeWith({
      paused: pausedStateOf(first),
      approved: ["call-commit"],
      turns: [{ answer: response({ content: "Committed." }) }],
    });

    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(doubled(V1));
    expect(commitAction(spies).status).toBe(AIChatToolActionStatus.Executed);
  });

  test("pushed to while the card waited: the approved commit is not made, and the model is told to read again", async () => {
    startRepository();
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        { answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }) },
      ],
    });
    await ChatAgentRunner.runTurn(buildRequest());
    expect(commitAction(first).description).toBeUndefined();

    pushTheTeammatesChange();

    const spies: Spies = await resumeWith({
      paused: pausedStateOf(first),
      approved: ["call-commit"],
      turns: [{ answer: response({ content: "It changed." }) }],
    });

    expect(repository.commits).toEqual([]);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(TEAMMATE);
    expect(commitAction(spies).status).toBe(AIChatToolActionStatus.Failed);
    expect(toldModel(spies, "call-commit")).toContain(
      `Nothing was committed: ${CHARGE} changed on fix/login after this commit was shown for approval`,
    );
  });

  test("pushed to right after the approval read it again, before the commit: the host refuses it, the push is kept, and the model is told to read again (issue #6331)", async () => {
    startRepository();
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        { answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }) },
      ],
    });
    await ChatAgentRunner.runTurn(buildRequest());
    expect(commitAction(first).description).toBeUndefined();

    // Approved: the approval reads the file again - and a teammate pushes right after.
    repository.afterVersionRead = (): void => {
      repository.afterVersionRead = undefined;
      pushTheTeammatesChange();
    };

    const spies: Spies = await resumeWith({
      paused: pausedStateOf(first),
      approved: ["call-commit"],
      turns: [{ answer: response({ content: "It changed." }) }],
    });

    expect(repository.commits).toEqual([]);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(TEAMMATE);
    expect(commitAction(spies).status).toBe(AIChatToolActionStatus.Failed);
    expect(toldModel(spies, "call-commit")).toContain(
      `Nothing was committed: ${CHARGE} changed on fix/login after this commit was shown for approval`,
    );
  });

  test("nothing pushed since the read: the card is as it always was", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        { answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    const action: AIChatToolAction = commitAction(spies);
    expect(action.title).toBe("Commit 1 file to fix/login");
    expect(action.description).toBeUndefined();
    expect(action.words).toEqual({
      title: {
        template: "Commit {{count}} files to {{branch}}",
        count: 1,
        values: { branch: "fix/login" },
      },
    });
  });

  test("a read asked for alongside the commit was not seen when the commit was written: it does not count", async () => {
    startRepository();
    pushTheTeammatesChange();
    const spies: Spies = installSpies({
      turns: [
        {
          answer: response({
            toolCalls: [READ_CALL(), COMMIT_CALL(doubled(V1))],
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(
      `Ask AI wrote this file without reading it, and it replaces the one on fix/login: ${CHARGE}.`,
    );
  });

  test("read on main, committed to a branch where the file is different: the card says where Ask AI read it", async () => {
    startRepository();
    pushTheTeammatesChange();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL("call-read", "main")] }) },
        { answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(
      `Ask AI read this file on main, but it is different on fix/login, so Ask AI's version may undo changes made there: ${CHARGE}.`,
    );
  });
});

describe("what an earlier turn showed the model counts, as far as the history it is shown goes", () => {
  const earlierTurn: (data: {
    citation: AIChatCitation;
    status?: AIChatMessageStatus;
  }) => Array<AIConversationMessage> = (data: {
    citation: AIChatCitation;
    status?: AIChatMessageStatus;
  }): Array<AIConversationMessage> => {
    const question: AIConversationMessage = new AIConversationMessage();
    question.role = AIChatMessageRole.User;
    question.contentInMarkdown = "What does the charge code do?";

    const answer: AIConversationMessage = new AIConversationMessage();
    answer.role = AIChatMessageRole.Assistant;
    answer.status = data.status || AIChatMessageStatus.Completed;
    answer.contentInMarkdown = "It charges once.";
    answer.citations = [data.citation];

    const now: AIConversationMessage = new AIConversationMessage();
    now.role = AIChatMessageRole.User;
    now.contentInMarkdown = "Make it charge twice, on fix/login.";

    return [now, answer, question];
  };

  const readCitation: () => AIChatCitation = (): AIChatCitation => {
    return {
      id: "C1",
      toolName: "read_code_file",
      label: `${CHARGE}:1-1 (acme/checkout)`,
      queryArguments: { filePath: CHARGE, branchName: "fix/login" },
      rowCount: 1,
      recordSeen: seeCodeFile({
        repositoryId: repository.repositoryId.toString(),
        branchName: "fix/login",
        filePath: CHARGE,
        fingerprint: fingerprintCodeFileVersion(blobOf(V1)),
      })!,
    };
  };

  test("read in the turn before, pushed to since: the commit from that read names the file", async () => {
    startRepository();
    const history: Array<AIConversationMessage> = earlierTurn({
      citation: readCitation(),
    });
    pushTheTeammatesChange();

    const spies: Spies = installSpies({
      history,
      turns: [{ answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }) }],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(CHANGED);
    expect(pausedStateOf(spies).recordsSeenBeforeTurn).toEqual([
      history[1]!.citations![0]!.recordSeen,
    ]);
  });

  test("a commit of its own in the turn before - a citation keeping a list - counts as seen, never as changed since; but Ask AI no longer has what it wrote (issue #6365)", async () => {
    startRepository();
    push(repository, "fix/login", CHARGE, doubled(V1));
    const written: Array<AIChatRecordSeen> = [
      seeCodeFile({
        repositoryId: repository.repositoryId.toString(),
        branchName: "fix/login",
        filePath: CHARGE,
        fingerprint: fingerprintCodeFileVersion(blobOf(doubled(V1))),
      })!,
    ];

    const spies: Spies = installSpies({
      history: earlierTurn({
        citation: {
          id: "C1",
          toolName: "commit_code_to_branch",
          label: "Commit abc1234 on fix/login (1 file)",
          queryArguments: {},
          rowCount: 1,
          recordSeen: written,
        },
      }),
      turns: [
        {
          answer: response({
            toolCalls: [COMMIT_CALL("export const charge = 3;\n")],
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(
      `Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: ${CHARGE}.`,
    );
    // Stored as the commit kept it, unmarked: the mark is the prepare's alone.
    expect(pausedStateOf(spies).recordsSeenBeforeTurn).toEqual(written);
  });

  test("a turn that failed was never shown to the model again: its read does not count", async () => {
    startRepository();
    const history: Array<AIConversationMessage> = earlierTurn({
      citation: readCitation(),
      status: AIChatMessageStatus.Error,
    });

    const spies: Spies = installSpies({
      history,
      turns: [{ answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }) }],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(commitAction(spies).description).toBe(
      `Ask AI wrote this file without reading it, and it replaces the one on fix/login: ${CHARGE}.`,
    );
  });

  test("resumed after an approval, the turn still knows the file as its own commit wrote it", async () => {
    startRepository();
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          answer: response({ toolCalls: [COMMIT_CALL(doubled(V1), "call-a")] }),
        },
      ],
    });
    await ChatAgentRunner.runTurn(buildRequest());

    const spies: Spies = await resumeWith({
      paused: pausedStateOf(first),
      approved: ["call-a"],
      turns: [
        {
          answer: response({
            toolCalls: [COMMIT_CALL("export const charge = 3;\n", "call-b")],
          }),
        },
      ],
    });

    expect(commitAction(spies, "call-a").status).toBe(
      AIChatToolActionStatus.Executed,
    );
    const second: AIChatToolAction = commitAction(spies, "call-b");
    expect(second.status).toBe(AIChatToolActionStatus.Pending);
    expect(second.description).toBeUndefined();

    // The commit's citation keeps the file it wrote, as the host hashes it.
    const citations: Array<AIChatCitation> = pausedStateOf(spies).citations;
    const committed: AIChatCitation = citations.find(
      (citation: AIChatCitation) => {
        return citation.toolName === "commit_code_to_branch";
      },
    )!;
    expect(committed.recordSeen).toEqual([
      seeCodeFile({
        repositoryId: repository.repositoryId.toString(),
        branchName: "fix/login",
        filePath: CHARGE,
        fingerprint: fingerprintCodeFileVersion(blobOf(doubled(V1))),
      }),
    ]);
    expect(
      (committed.recordSeen as Array<AIChatRecordSeen>)[0]!.recordType,
    ).toBe(AIChatRecordSeenType.CodeFile);
  });
});

describe("Auto-run: a commit that would undo a push it never saw is not made unasked", () => {
  test("not made: the model is told why, reads the file again, and commits on the file as it is", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: pushTheTeammatesChange,
          answer: response({
            toolCalls: [COMMIT_CALL(doubled(V1), "call-stale")],
          }),
        },
        { answer: response({ toolCalls: [READ_CALL("call-read-again")] }) },
        {
          // Written from the read it just made.
          answer: (): AILogResponse => {
            return response({
              toolCalls: [
                COMMIT_CALL(
                  doubled(repository.branches.get("fix/login")!.get(CHARGE)!),
                  "call-fresh",
                ),
              ],
            });
          },
        },
        {
          answer: response({
            content: "Doubled the charge, and kept your teammate's audit flag.",
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    // The model was told, in so many words.
    const told: string = toldModel(spies, "call-stale")!;
    expect(told).toMatch(/^Not done: nothing was committed to fix\/login/);
    expect(told).toContain(
      `- ${CHARGE} changed on fix/login after you last read it there.`,
    );
    expect(told).toContain('with read_code_file and branchName "fix/login"');

    // One commit: made on the file as it is, the teammate's change kept.
    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(
      doubled(TEAMMATE),
    );
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toContain(
      "audited = true",
    );

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
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ChangedSinceRead
      ],
    );
    expect(actions[0]!.requiresApproval).toBe(false);
    // Its record says what it would have done.
    expect(actions[0]!.description).toBe(CHANGED);

    // The activity says it was not done.
    const failed: Array<JSONObject> = spies.eventCreate.mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as { data: JSONObject }).data;
      })
      .filter((event: JSONObject) => {
        return (
          event["eventType"] === AIRunEventType.ToolCallFailed &&
          event["toolName"] === "commit_code_to_branch"
        );
      });
    expect(failed).toHaveLength(1);
    expect((failed[0]!["resultSummary"] as JSONObject)["isAction"]).toBe(true);
  });

  test("nothing pushed since the read: it commits at once, as Auto-run always did", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        { answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(repository.commits).toHaveLength(1);
    expect(commitAction(spies).status).toBe(AIChatToolActionStatus.Executed);
    expect(commitAction(spies).description).toBeUndefined();
  });

  test("a model that keeps committing from its old read is turned back each time, and nothing is ever committed", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: pushTheTeammatesChange,
          answer: response({ toolCalls: [COMMIT_CALL(doubled(V1), "call-1")] }),
        },
        {
          answer: response({ toolCalls: [COMMIT_CALL(doubled(V1), "call-2")] }),
        },
        {
          answer: response({ toolCalls: [COMMIT_CALL(doubled(V1), "call-3")] }),
        },
        { answer: response({ content: "I could not commit it." }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(repository.commits).toEqual([]);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(TEAMMATE);
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

  test("a host that cannot be read is not taken for a file that did not change: nothing committed", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL()] }) },
        {
          meanwhile: (): void => {
            repository.isDown = true;
          },
          answer: response({ toolCalls: [COMMIT_CALL(doubled(V1))] }),
        },
        { answer: response({ content: "GitHub is not answering." }) },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(repository.commits).toEqual([]);
    expect(commitAction(spies).status).toBe(AIChatToolActionStatus.Skipped);
    expect(commitAction(spies).resultSummary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.NotChecked],
    );
    expect(toldModel(spies, "call-commit")).toContain(
      "propose the commit again; if it still cannot be checked, tell the user.",
    );
  });
});
