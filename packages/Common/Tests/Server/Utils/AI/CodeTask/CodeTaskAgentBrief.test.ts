import CodeTaskAgentBrief, {
  MAX_CONVERSATION_LENGTH,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAgentBrief";
import CodeTaskOrigin from "../../../../../Server/Utils/AI/CodeTask/CodeTaskOrigin";
import CodeTaskThread from "../../../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import { DashboardClientUrl } from "../../../../../Server/EnvironmentConfig";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskAgentDetails,
  CodeTaskAgentTurn,
  CodeTaskContextType,
  CodeTaskFileStatus,
} from "../../../../../Types/AI/CodeTask";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a Runner is told when it takes a turn of a task in Code: derived from
 * the run alone, never from what the Runner sends. The repository is the
 * run's; a reply works on the branch of the task's open pull request (and
 * opens nothing new); the conversation is the turns before this one; every
 * text a person, a record or the AI wrote is redacted before it leaves.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const TASK_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");
const REPLY_ID: ObjectID = new ObjectID("6f2a5c4b-8d9e-4f0a-9b1c-3d4e5f6a7b8c");
const LATER_ID: ObjectID = new ObjectID("7a3b6d5c-9e0f-4a1b-8c2d-4e5f6a7b8c9d");
const USER_ID: ObjectID = new ObjectID("8b4c7e6d-0f1a-4b2c-9d3e-5f6a7b8c9d0e");

const AWS_KEY: string = "AKIAIOSFODNN7EXAMPLE";

let turns: Array<AIRun>;
let pullRequests: Array<AIAgentTaskPullRequest>;

function turn(data: {
  id: ObjectID;
  codeTaskId?: ObjectID;
  message: string;
  status: AIRunStatus;
  summary?: string;
}): AIRun {
  const run: AIRun = new AIRun();
  run._id = data.id.toString();
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.CodeFix;
  run.codeFixTaskType = CodeFixTaskType.CodeRequest;
  run.codeRepositoryId = REPOSITORY_ID;
  run.status = data.status;
  run.userId = USER_ID;
  if (data.codeTaskId) {
    run.codeTaskId = data.codeTaskId;
  } else {
    run.taskNumber = 42;
    run.title = "Add retries to the users API";
  }
  run.taskContext = {
    request: {
      message: data.message,
      context: [
        {
          type: CodeTaskContextType.Note,
          label: "The error",
          text: `TimeoutError after 30s, key ${AWS_KEY}`,
        },
        {
          type: CodeTaskContextType.Incident,
          label: "Incident #7: Users API is slow",
          recordId: "9c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
          snapshot: "Incident #7: Users API is slow\n\nState: Investigating",
        },
      ],
    },
  };
  if (data.summary) {
    run.taskOutcome = {
      summary: data.summary,
      filesChanged: [
        {
          path: "src/api/users.ts",
          status: CodeTaskFileStatus.Modified,
          additions: 4,
          deletions: 1,
        },
      ],
    };
  }
  return run;
}

function repository(): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value._id = REPOSITORY_ID.toString();
  value.projectId = PROJECT_ID;
  value.name = "users-api";
  value.organizationName = "acme";
  value.repositoryName = "users-api";
  value.mainBranchName = "main";
  value.testCommand = "npm test";
  return value;
}

function pullRequest(
  runId: ObjectID,
  state: PullRequestState,
): AIAgentTaskPullRequest {
  const value: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
  value.aiRunId = runId;
  value.codeRepositoryId = REPOSITORY_ID;
  value.pullRequestNumber = 17;
  value.pullRequestUrl = "https://github.com/acme/users-api/pull/17" as never;
  value.pullRequestState = state;
  value.title = "Add retries to the users API";
  value.headRefName = "oneuptime-task-42-5e1f4b3a";
  value.baseRefName = "main";
  return value;
}

beforeEach(() => {
  turns = [
    turn({
      id: TASK_ID,
      message: `Add retries to the users API. Contact ops@acme.com, key ${AWS_KEY}.`,
      status: AIRunStatus.Completed,
      summary: "Added a retry with backoff in `src/api/users.ts`.",
    }),
    turn({
      id: REPLY_ID,
      codeTaskId: TASK_ID,
      message: "Use exponential backoff, capped at 5 tries.",
      status: AIRunStatus.Running,
    }),
    turn({
      id: LATER_ID,
      codeTaskId: TASK_ID,
      message: "A turn after this one, which this turn must not see.",
      status: AIRunStatus.Queued,
    }),
  ];
  pullRequests = [pullRequest(TASK_ID, PullRequestState.Open)];

  jest.spyOn(CodeTaskThread, "findTask").mockImplementation(async () => {
    return turns[0]!;
  });
  jest.spyOn(CodeTaskThread, "getTurns").mockImplementation(async () => {
    return turns;
  });
  jest.spyOn(CodeTaskThread, "getPullRequests").mockImplementation(async () => {
    return pullRequests;
  });
  jest
    .spyOn(CodeTaskThread, "getPeople")
    .mockResolvedValue(
      new Map([
        [USER_ID.toString(), { id: USER_ID.toString(), name: "Jane Doe" }],
      ]),
    );
  jest.spyOn(CodeTaskOrigin, "loadSubjects").mockResolvedValue({
    exceptions: new Map(),
    incidents: new Map(),
    alerts: new Map(),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function brief(runIndex: number): Promise<CodeTaskAgentDetails> {
  return await CodeTaskAgentBrief.build({
    run: turns[runIndex]!,
    repository: repository(),
  });
}

describe("a reply builds on the task's open pull request", () => {
  test("its branch, and the pull request it pushes to", async () => {
    const details: CodeTaskAgentDetails = await brief(1);

    expect(details.taskId).toBe(TASK_ID.toString());
    expect(details.taskNumber).toBe(42);
    expect(details.taskTitle).toBe("Add retries to the users API");
    expect(details.taskType).toBe(CodeFixTaskType.CodeRequest);
    expect(details.taskUrl).toContain(
      `/${PROJECT_ID.toString()}/code/tasks/${TASK_ID.toString()}`,
    );
    expect(details.requestedBy).toBe("Jane Doe");
    expect(details.workingBranch).toBe("oneuptime-task-42-5e1f4b3a");
    expect(details.pullRequest).toEqual({
      number: 17,
      url: "https://github.com/acme/users-api/pull/17",
      title: "Add retries to the users API",
      baseRefName: "main",
    });
    expect(details.repository).toEqual({
      id: REPOSITORY_ID.toString(),
      name: "users-api",
      organizationName: "acme",
      repositoryName: "users-api",
      mainBranchName: "main",
      setupCommand: null,
      buildCommand: null,
      testCommand: "npm test",
    });
  });

  test("once that pull request is merged, the next change starts a new branch", async () => {
    pullRequests = [pullRequest(TASK_ID, PullRequestState.Merged)];

    const details: CodeTaskAgentDetails = await brief(1);

    expect(details.workingBranch).toBeNull();
    expect(details.pullRequest).toBeNull();
    expect(details.newBranchName).toBe(
      `oneuptime-task-42-${REPLY_ID.toString().substring(0, 8)}`,
    );
  });

  test("a first turn has no conversation and no branch yet", async () => {
    pullRequests = [];

    const details: CodeTaskAgentDetails = await brief(0);

    expect(details.conversation).toEqual([]);
    expect(details.omittedTurns).toBe(0);
    expect(details.workingBranch).toBeNull();
    expect(details.newBranchName).toBe(
      `oneuptime-task-42-${TASK_ID.toString().substring(0, 8)}`,
    );
  });
});

describe("what the turn is asked, and the conversation before it", () => {
  test("the request and its context, in full for this turn", async () => {
    const details: CodeTaskAgentDetails = await brief(1);

    expect(details.request.message).toBe(
      "Use exponential backoff, capped at 5 tries.",
    );
    expect(details.request.context).toEqual([
      {
        type: CodeTaskContextType.Note,
        label: "The error",
        content: "TimeoutError after 30s, key [redacted-aws-key]",
      },
      {
        type: CodeTaskContextType.Incident,
        label: "Incident #7: Users API is slow",
        content: "Incident #7: Users API is slow\n\nState: Investigating",
      },
    ]);
  });

  test("only the turns before this one, each what the person said and what the AI answered", async () => {
    const details: CodeTaskAgentDetails = await brief(1);

    expect(
      details.conversation.map((entry: CodeTaskAgentTurn) => {
        return entry.role;
      }),
    ).toEqual(["person", "ai"]);

    const asked: CodeTaskAgentTurn = details.conversation[0]!;

    expect(asked.author).toBe("Jane Doe");
    expect(asked.text).toContain("Add retries to the users API.");
    // An earlier turn's records are named, not read again in full.
    expect(asked.context).toEqual([
      { type: CodeTaskContextType.Note, label: "The error" },
      {
        type: CodeTaskContextType.Incident,
        label: "Incident #7: Users API is slow",
      },
    ]);

    const answered: string = details.conversation[1]!.text;

    expect(answered).toContain(
      "Added a retry with backoff in `src/api/users.ts`.",
    );
    expect(answered).toContain(
      "Opened pull request #17: Add retries to the users API",
    );
    expect(answered).toContain("Changed: src/api/users.ts");
    expect(JSON.stringify(details)).not.toContain(
      "which this turn must not see",
    );
  });

  test("secrets and personal data never leave the server", async () => {
    const details: CodeTaskAgentDetails = await brief(1);
    const sent: string = JSON.stringify(details);

    expect(sent).not.toContain(AWS_KEY);
    expect(sent).not.toContain("ops@acme.com");
    expect(sent).toContain("[redacted-email]");
  });

  test("this turn's own words are redacted too", async () => {
    turns[1]!.taskContext = {
      request: {
        message: `Rotate the key ${AWS_KEY} and tell dev@acme.com`,
        context: [],
      },
    };

    const details: CodeTaskAgentDetails = await brief(1);

    expect(details.request.message).toBe(
      "Rotate the key [redacted-aws-key] and tell [redacted-email]",
    );
  });

  test("an earlier turn that failed or was stopped says so", async () => {
    turns[0]!.status = AIRunStatus.Error;
    turns[0]!.errorMessage = "The tests failed twice.";
    delete turns[0]!.taskOutcome;
    pullRequests = [];

    const details: CodeTaskAgentDetails = await brief(1);

    expect(details.conversation[1]!.text).toBe(
      "This turn failed: The tests failed twice.",
    );
  });

  test("a run with no request is not something to work on", async () => {
    turns[1]!.taskContext = {};

    await expect(brief(1)).rejects.toThrow("This task has no request.");
  });

  test("a task that no longer exists is not worked on", async () => {
    (CodeTaskThread.findTask as unknown as jest.Mock).mockImplementation(
      async () => {
        return null;
      },
    );

    await expect(brief(1)).rejects.toThrow("This task no longer exists.");
  });
});

/*
 * How a change is built and tested. Code no longer asks for commands: the
 * Runner's code agent reads how from the repository itself (its AGENTS.md,
 * Runner/Utils/RepositoryInstructions), so a repository nobody set commands
 * on hands the Runner none. Commands an operator set before - in the old
 * settings, the API or Terraform - still go to the Runner, as they are,
 * and still run after the agent's change (Runner/Utils/BuildVerification).
 */
describe("the build and test commands an operator set", () => {
  test("all three go to the Runner as they are set", async () => {
    const withCommands: CodeRepository = repository();
    withCommands.setupCommand = "npm ci";
    withCommands.buildCommand = "npm run build";
    withCommands.testCommand = "npm test -- --runInBand";

    const details: CodeTaskAgentDetails = await CodeTaskAgentBrief.build({
      run: turns[1]!,
      repository: withCommands,
    });

    expect(details.repository.setupCommand).toBe("npm ci");
    expect(details.repository.buildCommand).toBe("npm run build");
    expect(details.repository.testCommand).toBe("npm test -- --runInBand");
  });

  test("a repository with none hands the Runner none: the agent reads its AGENTS.md", async () => {
    const withNone: CodeRepository = repository();
    delete (withNone as unknown as Record<string, unknown>)["testCommand"];

    const details: CodeTaskAgentDetails = await CodeTaskAgentBrief.build({
      run: turns[1]!,
      repository: withNone,
    });

    expect(details.repository.setupCommand).toBeNull();
    expect(details.repository.buildCommand).toBeNull();
    expect(details.repository.testCommand).toBeNull();
  });

  test("an empty command is no command", async () => {
    const withEmpty: CodeRepository = repository();
    withEmpty.setupCommand = "";
    withEmpty.testCommand = "";

    const details: CodeTaskAgentDetails = await CodeTaskAgentBrief.build({
      run: turns[1]!,
      repository: withEmpty,
    });

    expect(details.repository.setupCommand).toBeNull();
    expect(details.repository.testCommand).toBeNull();
  });
});

/*
 * The branch a task starts from: the one the person picked in Code's request
 * box, kept on its first turn, for every turn after it too - handed over as
 * the branch to clone (repository.mainBranchName, which Runners older than
 * the pick read) and as the picked branch, which a Runner that cannot check
 * it out stops on rather than work somewhere else.
 */
describe("the branch the task starts from", () => {
  function pick(branch: string): void {
    turns[0]!.taskContext = {
      request: {
        ...turns[0]!.taskContext!.request!,
        baseBranch: branch,
      },
    };
  }

  test("the branch picked, on the task's first turn: cloned and named", async () => {
    pick("release/2026-10");
    pullRequests = [];

    const details: CodeTaskAgentDetails = await brief(0);

    expect(details.baseBranch).toBe("release/2026-10");
    expect(details.repository.mainBranchName).toBe("release/2026-10");
    expect(details.workingBranch).toBeNull();
  });

  test("a reply - whose own request names no branch - still works from the branch the task started from", async () => {
    pick("release/2026-10");
    // Its pull request was merged: the next change starts a new branch from the picked one.
    pullRequests = [pullRequest(TASK_ID, PullRequestState.Merged)];

    const details: CodeTaskAgentDetails = await brief(1);

    expect(turns[1]!.taskContext?.request).not.toHaveProperty("baseBranch");
    expect(details.baseBranch).toBe("release/2026-10");
    expect(details.repository.mainBranchName).toBe("release/2026-10");
  });

  test("none picked: the repository's main branch, and no picked branch to insist on", async () => {
    const details: CodeTaskAgentDetails = await brief(0);

    expect(details.baseBranch).toBeNull();
    expect(details.repository.mainBranchName).toBe("main");
  });

  test("a picked branch git would not take is never handed to a Runner", async () => {
    pick("a..b --upload-pack=evil");

    const details: CodeTaskAgentDetails = await brief(0);

    expect(details.baseBranch).toBeNull();
    expect(details.repository.mainBranchName).toBe("main");
  });

  test("the task is read with what was asked and what AI answered, as every turn is", async () => {
    await brief(1);

    const read: { select?: Record<string, unknown> } = (
      CodeTaskThread.findTask as unknown as jest.Mock
    ).mock.calls[0]![0] as never;
    expect(read.select).toEqual(
      expect.objectContaining({ taskContext: true, taskOutcome: true }),
    );
  });
});

describe("CodeTaskAgentBrief.capConversation", () => {
  function said(text: string): CodeTaskAgentTurn {
    return { role: "person", text };
  }

  test("a short conversation is kept whole", () => {
    const short: Array<CodeTaskAgentTurn> = [said("one"), said("two")];

    expect(CodeTaskAgentBrief.capConversation(short)).toEqual({
      turns: short,
      omitted: 0,
    });
  });

  test("a long one keeps the first turn and the newest that fit, and says how many were left out", () => {
    const quarter: number = Math.floor(MAX_CONVERSATION_LENGTH / 4);
    const long: Array<CodeTaskAgentTurn> = [
      said(`first ${"a".repeat(quarter)}`),
      said(`second ${"b".repeat(quarter)}`),
      said(`third ${"c".repeat(quarter)}`),
      said(`fourth ${"d".repeat(quarter)}`),
      said(`fifth ${"e".repeat(quarter)}`),
    ];

    const capped: { turns: Array<CodeTaskAgentTurn>; omitted: number } =
      CodeTaskAgentBrief.capConversation(long);

    expect(
      capped.turns.map((entry: CodeTaskAgentTurn): string => {
        return entry.text.split(" ")[0]!;
      }),
    ).toEqual(["first", "fourth", "fifth"]);
    expect(capped.omitted).toBe(2);

    const total: number = capped.turns.reduce(
      (sum: number, entry: CodeTaskAgentTurn): number => {
        return sum + entry.text.length;
      },
      0,
    );

    expect(total).toBeLessThanOrEqual(MAX_CONVERSATION_LENGTH);
  });
});

/*
 * A task OneUptime started on its own, from slow code it found
 * (Types/AI/TelemetryAi): the Runner is told what was found and where it is
 * shown, so the pull request says why it was opened; and in a later turn's
 * conversation the request reads as OneUptime's, not a person's.
 */
describe("a task OneUptime started from an insight", () => {
  const INSIGHT_ID: ObjectID = new ObjectID(
    "9a5b8c7d-1e2f-4a3b-8c4d-6e7f8a9b0c1d",
  );

  function startedByOneUptime(): void {
    turns[0]!.userId = undefined as never;
    turns[0]!.triggeredByAiInsightId = INSIGHT_ID;
    turns[0]!.taskContext = {
      request: {
        message: "Make OrderParser.parse faster",
        context: [],
      },
    };

    const insight: AIInsight = new AIInsight();
    insight._id = INSIGHT_ID.toString();
    insight.title = `OrderParser.parse takes 18% of the CPU time in checkout, key ${AWS_KEY}`;

    jest.spyOn(CodeTaskOrigin, "loadSubjects").mockResolvedValue({
      exceptions: new Map(),
      incidents: new Map(),
      alerts: new Map(),
      insights: new Map([[INSIGHT_ID.toString(), insight]]),
    });
  }

  test("the Runner is told what OneUptime found, redacted, and the page that shows it", async () => {
    startedByOneUptime();

    const details: CodeTaskAgentDetails = await brief(0);

    expect(details.requestedBy).toBeUndefined();
    expect(details.startedBy?.finding).toContain(
      "OrderParser.parse takes 18% of the CPU time in checkout",
    );
    expect(details.startedBy?.finding).not.toContain(AWS_KEY);
    expect(details.startedBy?.findingUrl).toBe(
      `${DashboardClientUrl.toString()}/${PROJECT_ID.toString()}/ai/insights/${INSIGHT_ID.toString()}`,
    );
  });

  test("a later turn a person asked still knows why the task was started, and who asked now", async () => {
    startedByOneUptime();

    const details: CodeTaskAgentDetails = await brief(1);

    expect(details.requestedBy).toBe("Jane Doe");
    expect(details.startedBy?.findingUrl).toContain(INSIGHT_ID.toString());

    const first: CodeTaskAgentTurn = details.conversation[0]!;
    expect(first.role).toBe("person");
    expect(first.author).toBe("OneUptime");
    expect(first.text).toBe("Make OrderParser.parse faster");
  });

  test("a task a person asked for carries no reason of OneUptime's", async () => {
    const details: CodeTaskAgentDetails = await brief(0);

    expect(details.startedBy).toBeUndefined();
    expect(details.requestedBy).toBe("Jane Doe");
  });
});
