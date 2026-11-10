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
 * ISSUE #6364, THROUGH THE WHOLE CHAT TURN.
 *
 * The model reads config/servers.ts - two IP addresses and an email,
 * shown as "[redacted-ip]" and "[redacted-email]" - and asks for
 * commit_code_to_branch with the whole file, one line changed. So:
 *
 *   - the read tells the model which lines had values hidden;
 *   - in Ask to act, the card says values were hidden from Ask AI and its
 *     version writes placeholders in their place;
 *   - in Auto-run the commit is not made: the model is told it cannot
 *     write those values back, and a change that leaves the file alone,
 *     or takes the values out, is made;
 *   - it holds in a later turn too: it is of what the change writes.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa6364",
);

const SERVERS: string = "config/servers.ts";

const ON_BRANCH: string = [
  'export const PRIMARY_HOST = "10.0.0.12";',
  'export const BACKUP_HOST = "10.0.0.13";',
  'export const ON_CALL = "ops@acme.com";',
  "export const RETRIES = 3;",
  "",
].join("\n");

// The file as read_code_file showed it to the model.
const AS_SHOWN: string = [
  'export const PRIMARY_HOST = "[redacted-ip]";',
  'export const BACKUP_HOST = "[redacted-ip]";',
  'export const ON_CALL = "[redacted-email]";',
  "export const RETRIES = 3;",
  "",
].join("\n");

let repository: FakeGitRepository;

const startRepository: (files?: Record<string, string>) => void = (
  files?: Record<string, string>,
): void => {
  repository = makeRepository({
    files: {
      main: { [SERVERS]: ON_BRANCH, "README.md": "# checkout\n" },
      "fix/login": files || {
        [SERVERS]: ON_BRANCH,
        "README.md": "# checkout\n",
      },
    },
  });
};

type ToolCall = { id: string; name: string; arguments: JSONObject };

const READ_CALL: ToolCall = {
  id: "call-read",
  name: "read_code_file",
  arguments: { filePath: SERVERS, branchName: "fix/login" },
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
      commitMessage: "fix: retries",
      changes: changes as unknown as JSONObject[],
    } as unknown as JSONObject,
  };
};

// What Ask AI writes from what it was shown: one line changed.
const RETRIES_FIVE: string = AS_SHOWN.replace("RETRIES = 3;", "RETRIES = 5;");

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

const HIDDEN: string = `Values that look like secrets or personal data were hidden from Ask AI, and its version of this file writes placeholders in their place: ${SERVERS}.`;

const actionOf: (spies: Spies, id?: string) => AIChatToolAction = (
  spies: Spies,
  id?: string,
): AIChatToolAction => {
  return toolActionsOf(spies).find((action: AIChatToolAction) => {
    return action.id === (id || "call-commit");
  })!;
};

describe("the read tells the model which lines had values hidden, before it writes anything", () => {
  test("its result names the lines, and holds none of the values", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [{ answer: response({ toolCalls: [READ_CALL] }) }],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    const told: string = toldModel(spies, "call-read")!;
    expect(told).toContain(
      "values that look like secrets or personal data are hidden from you on lines 1-3, as [redacted-ip] and [redacted-email].",
    );
    expect(told).toContain('PRIMARY_HOST = "[redacted-ip]"');
    for (const value of ["10.0.0.12", "10.0.0.13", "ops@acme.com"]) {
      expect(told).not.toContain(value);
    }
  });
});

describe("Ask to act: the card says the version writes placeholders where values were hidden", () => {
  test("read whole, committed with one line changed: the card says so, and nothing is committed", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL] }) },
        {
          answer: response({
            toolCalls: [
              COMMIT_CALL([{ filePath: SERVERS, content: RETRIES_FIVE }]),
            ],
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(repository.commits).toEqual([]);

    const action: AIChatToolAction = actionOf(spies);
    expect(action.status).toBe(AIChatToolActionStatus.Pending);
    expect(action.requiresApproval).toBe(true);
    expect(action.title).toBe("Commit 1 file to fix/login");
    expect(action.description).toBe(HIDDEN);
    expect(
      action.words!.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([AI_ACTION_PLURAL_LINES.codeFilesValuesHidden.other]);
  });

  test("approved anyway, it is committed as the card said: the person chose", async () => {
    startRepository();
    const first: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL] }) },
        {
          answer: response({
            toolCalls: [
              COMMIT_CALL([{ filePath: SERVERS, content: RETRIES_FIVE }]),
            ],
          }),
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
    expect(repository.branches.get("fix/login")!.get(SERVERS)).toBe(
      RETRIES_FIVE,
    );
    expect(actionOf(spies).status).toBe(AIChatToolActionStatus.Executed);
  });

  test("the file's own placeholder text, kept: the card as it always was", async () => {
    const tests: string =
      'expect(redact("host x")).toBe("host [redacted-ip]");\n';
    startRepository({ "Tests/Redact.test.ts": tests });
    const spies: Spies = installSpies({
      turns: [
        {
          answer: response({
            toolCalls: [
              {
                id: "call-read",
                name: "read_code_file",
                arguments: {
                  filePath: "Tests/Redact.test.ts",
                  branchName: "fix/login",
                },
              },
            ],
          }),
        },
        {
          answer: response({
            toolCalls: [
              COMMIT_CALL([
                {
                  filePath: "Tests/Redact.test.ts",
                  content: `${tests}// and one more\n`,
                },
              ]),
            ],
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    expect(actionOf(spies).description).toBeUndefined();
  });
});

describe("Auto-run: a commit that writes placeholders over hidden values is not made unasked", () => {
  test("not made: the model is told it cannot write them back, and changes only a file without hidden values", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL] }) },
        {
          answer: response({
            toolCalls: [
              COMMIT_CALL(
                [{ filePath: SERVERS, content: RETRIES_FIVE }],
                "call-hidden",
              ),
            ],
          }),
        },
        {
          answer: response({
            toolCalls: [
              {
                id: "call-readme-read",
                name: "read_code_file",
                arguments: { filePath: "README.md", branchName: "fix/login" },
              },
            ],
          }),
        },
        {
          answer: response({
            toolCalls: [
              COMMIT_CALL(
                [
                  {
                    filePath: "README.md",
                    content:
                      "# checkout\n\nRetries: set RETRIES = 5 in config/servers.ts.\n",
                  },
                ],
                "call-readme",
              ),
            ],
          }),
        },
        {
          answer: response({
            content:
              "I could not change config/servers.ts: set RETRIES = 5 there yourself.",
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    const told: string = toldModel(spies, "call-hidden")!;
    expect(told).toMatch(
      /^Not done: nothing was committed to fix\/login, because your version of these files writes placeholders where values were hidden from you:/,
    );
    expect(told).toContain(
      `- ${SERVERS}: your version writes [redacted-ip] on lines 1-2; [redacted-email] on line 3.`,
    );
    expect(told).toContain("You cannot write a value hidden from you back");
    expect(told).not.toContain("Read each of these files");

    // config/servers.ts as it was, every value kept; the README committed.
    expect(repository.branches.get("fix/login")!.get(SERVERS)).toBe(ON_BRANCH);
    expect(repository.commits).toHaveLength(1);
    expect(
      repository.commits[0]!.files.map((file: { filePath: string }) => {
        return file.filePath;
      }),
    ).toEqual(["README.md"]);

    const actions: Array<AIChatToolAction> = toolActionsOf(spies);
    expect(
      actions.map((action: AIChatToolAction) => {
        return [action.id, action.status];
      }),
    ).toEqual([
      ["call-hidden", AIChatToolActionStatus.Skipped],
      ["call-readme", AIChatToolActionStatus.Executed],
    ]);
    expect(actions[0]!.resultSummary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.ValuesHidden],
    );
    expect(actions[0]!.description).toBe(HIDDEN);
  });

  test("a version that takes the hard-coded values out writes over nothing hidden: made at once", async () => {
    startRepository();
    const withoutValues: string = [
      "export const PRIMARY_HOST = process.env.PRIMARY_HOST;",
      "export const BACKUP_HOST = process.env.BACKUP_HOST;",
      "export const ON_CALL = process.env.ON_CALL;",
      "export const RETRIES = 3;",
      "",
    ].join("\n");
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL] }) },
        {
          answer: response({
            toolCalls: [
              COMMIT_CALL([{ filePath: SERVERS, content: withoutValues }]),
            ],
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(repository.commits).toHaveLength(1);
    expect(actionOf(spies).status).toBe(AIChatToolActionStatus.Executed);
    expect(actionOf(spies).description).toBeUndefined();
  });

  test("turned back however often the model asks again from what it was shown", async () => {
    startRepository();
    const spies: Spies = installSpies({
      turns: [
        { answer: response({ toolCalls: [READ_CALL] }) },
        ...[1, 2, 3].map((attempt: number): Turn => {
          return {
            answer: response({
              toolCalls: [
                COMMIT_CALL(
                  [{ filePath: SERVERS, content: RETRIES_FIVE }],
                  `call-${attempt}`,
                ),
              ],
            }),
          };
        }),
      ],
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

describe("in a later turn: of what the change writes, wherever the read was", () => {
  test("read in the turn before, committed now from what the model was shown: the card says so, beside that Ask AI no longer has the file (issue #6365)", async () => {
    startRepository();
    const question: AIConversationMessage = new AIConversationMessage();
    question.role = AIChatMessageRole.User;
    question.contentInMarkdown = "Which hosts does checkout use?";

    const answer: AIConversationMessage = new AIConversationMessage();
    answer.role = AIChatMessageRole.Assistant;
    answer.status = AIChatMessageStatus.Completed;
    answer.contentInMarkdown = "Two hosts, in config/servers.ts.";
    answer.citations = [
      {
        id: "C1",
        toolName: "read_code_file",
        label: `${SERVERS} (acme/checkout)`,
        queryArguments: { filePath: SERVERS, branchName: "fix/login" },
        rowCount: 4,
        recordSeen: seeCodeFile({
          repositoryId: repository.repositoryId.toString(),
          branchName: "fix/login",
          filePath: SERVERS,
          fingerprint: fingerprintCodeFileVersion(blobOf(ON_BRANCH)),
        })!,
      } as AIChatCitation,
    ];

    const now: AIConversationMessage = new AIConversationMessage();
    now.role = AIChatMessageRole.User;
    now.contentInMarkdown = "Retry five times, on fix/login.";

    const spies: Spies = installSpies({
      history: [now, answer, question],
      turns: [
        {
          answer: response({
            toolCalls: [
              COMMIT_CALL([{ filePath: SERVERS, content: RETRIES_FIVE }]),
            ],
          }),
        },
      ],
    });

    await ChatAgentRunner.runTurn(buildRequest());

    // Two lines of one file, each of its own: the placeholders first.
    expect(
      actionOf(spies).words!.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesValuesHidden.other,
      AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other,
    ]);
  });
});
