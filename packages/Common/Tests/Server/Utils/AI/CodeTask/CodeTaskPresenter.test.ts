import FixProductionCheck from "../../../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import UserService from "../../../../../Server/Services/UserService";
import CodeTaskOrigin from "../../../../../Server/Utils/AI/CodeTask/CodeTaskOrigin";
import CodeTaskPresenter from "../../../../../Server/Utils/AI/CodeTask/CodeTaskPresenter";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../../Models/DatabaseModels/AIRunEvent";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import User from "../../../../../Models/DatabaseModels/User";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskContextType,
  CodeTaskFileStatus,
  CodeTaskOriginJSON,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
} from "../../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ProductionReviewPosting,
  ProductionReviewReport,
} from "../../../../../Types/CodeRepository/ProductionReview";
import {
  emptyReport,
  fullReport,
} from "../../CodeRepository/ProductionReview/ProductionReviewFixtures";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What the Code pages are sent of a task: a list row says how it stands
 * (read from its LATEST turn), who asked or what started it, and its pull
 * request; a conversation shows every turn - what was asked and the context
 * added (never the snapshots the AI read), the steps, the reply, the files
 * and, only for people who may change the code, the diff.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const TASK_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");
const REPLY_ID: ObjectID = new ObjectID("6f2a5c4b-8d9e-4f0a-9b1c-3d4e5f6a7b8c");
const USER_ID: ObjectID = new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
const EXCEPTION_ID: ObjectID = new ObjectID(
  "8b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "9c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
);

const READER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

function requestTurn(data: {
  id: ObjectID;
  status: AIRunStatus;
  createdAt: string;
  message: string;
  codeTaskId?: ObjectID;
  needsUserInput?: boolean;
}): AIRun {
  const run: AIRun = new AIRun();
  run._id = data.id.toString();
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.CodeFix;
  run.codeFixTaskType = CodeFixTaskType.CodeRequest;
  run.codeRepositoryId = REPOSITORY_ID;
  run.status = data.status;
  run.userId = USER_ID;
  run.createdAt = new Date(data.createdAt);
  run.needsUserInput = Boolean(data.needsUserInput);
  if (data.codeTaskId) {
    run.codeTaskId = data.codeTaskId;
  } else {
    run.title = "Add retries to the users API";
    run.taskNumber = 42;
  }
  run.taskContext = {
    request: {
      message: data.message,
      context: [
        {
          type: CodeTaskContextType.Incident,
          label: "Incident #7: Users API is slow",
          recordId: INCIDENT_ID.toString(),
          snapshot: "SECRET SNAPSHOT THE AI READ",
        },
        {
          type: CodeTaskContextType.File,
          label: "src/api/users.ts",
          path: "src/api/users.ts",
        },
      ],
    },
  };
  return run;
}

function openPullRequest(
  runId: ObjectID,
  state: PullRequestState,
): AIAgentTaskPullRequest {
  const value: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
  value.aiRunId = runId;
  value.pullRequestNumber = 17;
  value.pullRequestUrl = "https://github.com/acme/api/pull/17" as never;
  value.pullRequestState = state;
  value.title = "Add retries to the users API";
  value.headRefName = "oneuptime-task-42-5e1f4b3a";
  value.codeRepositoryId = REPOSITORY_ID;
  return value;
}

function person(): User {
  const user: User = new User();
  user._id = USER_ID.toString();
  user.name = new Name("Jane Doe");
  return user;
}

beforeEach(() => {
  jest.spyOn(UserService, "findBy").mockResolvedValue([person()]);
  jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CodeTaskPresenter.summarize", () => {
  test("a task's state is its latest turn's, and its activity the latest moment of any", async () => {
    const task: AIRun = requestTurn({
      id: TASK_ID,
      status: AIRunStatus.Completed,
      createdAt: "2026-10-19T08:00:00.000Z",
      message: "Add retries",
      needsUserInput: true,
    });
    const reply: AIRun = requestTurn({
      id: REPLY_ID,
      codeTaskId: TASK_ID,
      status: AIRunStatus.Queued,
      createdAt: "2026-10-19T09:30:00.000Z",
      message: "Use exponential backoff",
    });

    jest.spyOn(AIRunService, "findBy").mockResolvedValue([reply]);
    jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([openPullRequest(TASK_ID, PullRequestState.Open)]);

    const [summary]: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [task],
        props: READER,
      });

    expect(summary).toEqual({
      id: TASK_ID.toString(),
      taskNumber: 42,
      title: "Add retries to the users API",
      recipe: CodeFixTaskType.CodeRequest,
      // The first turn asked a question; the reply now being worked on wins.
      state: CodeTaskState.Working,
      isQueued: true,
      createdAt: "2026-10-19T08:00:00.000Z",
      lastActivityAt: "2026-10-19T09:30:00.000Z",
      origin: { type: CodeTaskOriginType.Request, label: "Jane Doe" },
      requestedBy: { id: USER_ID.toString(), name: "Jane Doe" },
      pullRequest: {
        number: 17,
        url: "https://github.com/acme/api/pull/17",
        title: "Add retries to the users API",
        state: PullRequestState.Open,
        branch: "oneuptime-task-42-5e1f4b3a",
      },
      turnCount: 2,
      codeRepositoryId: REPOSITORY_ID.toString(),
    });
  });

  test("a task whose latest turn asked something waits for its person", async () => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);

    const [summary]: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [
          requestTurn({
            id: TASK_ID,
            status: AIRunStatus.Completed,
            createdAt: "2026-10-19T08:00:00.000Z",
            message: "Which table?",
            needsUserInput: true,
          }),
        ],
        props: READER,
      });

    expect(summary!.state).toBe(CodeTaskState.WaitingForYou);
    expect(summary!.isQueued).toBe(false);
    expect(summary!.pullRequest).toBeUndefined();
  });

  test("names what started a task the reader's way: an exception they may read, by its message", async () => {
    const task: AIRun = new AIRun();
    task._id = TASK_ID.toString();
    task.projectId = PROJECT_ID;
    task.codeFixTaskType = CodeFixTaskType.FixException;
    task.status = AIRunStatus.Error;
    task.createdAt = new Date("2026-10-19T08:00:00.000Z");
    task.triggeredByTelemetryExceptionId = EXCEPTION_ID;

    const exception: TelemetryException = new TelemetryException();
    exception._id = EXCEPTION_ID.toString();
    exception.exceptionType = "TypeError";
    exception.message = "x is undefined";

    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);
    const findExceptions: jest.SpiedFunction<
      typeof TelemetryExceptionService.findBy
    > = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([exception]);

    const [summary]: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [task],
        props: READER,
      });

    expect((findExceptions.mock.calls[0]![0] as { props: unknown }).props).toBe(
      READER,
    );
    expect(summary!.origin).toEqual({
      type: CodeTaskOriginType.Exception,
      label: "TypeError: x is undefined",
      recordId: EXCEPTION_ID.toString(),
    });
    expect(summary!.title).toBe("TypeError: x is undefined");
    expect(summary!.state).toBe(CodeTaskState.Failed);
  });

  test("a row says how much its task changed over its turns: each file once, every turn's lines", async () => {
    const task: AIRun = requestTurn({
      id: TASK_ID,
      status: AIRunStatus.Completed,
      createdAt: "2026-10-19T08:00:00.000Z",
      message: "Add retries",
    });
    const reply: AIRun = requestTurn({
      id: REPLY_ID,
      codeTaskId: TASK_ID,
      status: AIRunStatus.Completed,
      createdAt: "2026-10-19T09:00:00.000Z",
      message: "Log each retry",
    });
    const outcomes: Record<string, AIRun["taskOutcome"]> = {
      [TASK_ID.toString()]: {
        summary: "Retries.",
        filesChanged: [
          {
            path: "src/payments/client.ts",
            status: CodeTaskFileStatus.Modified,
            additions: 9,
            deletions: 1,
          },
          {
            path: "test/payments/retries.test.ts",
            status: CodeTaskFileStatus.Added,
            additions: 14,
            deletions: 0,
          },
        ],
      },
      [REPLY_ID.toString()]: {
        summary: "Logged.",
        filesChanged: [
          {
            path: "src/payments/client.ts",
            status: CodeTaskFileStatus.Modified,
            additions: 4,
            deletions: 0,
          },
        ],
      },
    };

    const findRuns: jest.SpiedFunction<typeof AIRunService.findBy> = jest
      .spyOn(AIRunService, "findBy")
      .mockImplementation((async (data: {
        select?: Record<string, unknown>;
      }): Promise<Array<AIRun>> => {
        // The outcomes read; otherwise the task's replies.
        if (data.select?.["taskOutcome"]) {
          return [TASK_ID, REPLY_ID].map((id: ObjectID): AIRun => {
            const run: AIRun = new AIRun();
            run._id = id.toString();
            run.taskOutcome = outcomes[id.toString()]!;
            return run;
          });
        }
        return [reply];
      }) as never);
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);

    const [summary]: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [task],
        props: READER,
      });

    expect(summary!.changes).toEqual({
      files: 2,
      additions: 27,
      deletions: 1,
    });

    // Only the ids and outcomes are read, as OneUptime: the rows are the reader's already.
    const read: {
      select: Record<string, unknown>;
      props: unknown;
      query: Record<string, unknown>;
    } = findRuns.mock.calls.find((call: Array<unknown>): boolean => {
      return Boolean(
        (call[0] as { select?: Record<string, unknown> }).select?.[
          "taskOutcome"
        ],
      );
    })![0] as never;
    expect(read.select).toEqual({ _id: true, taskOutcome: true });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("a task that changed no file says nothing about lines", async () => {
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);

    const [summary]: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [
          requestTurn({
            id: TASK_ID,
            status: AIRunStatus.Completed,
            createdAt: "2026-10-19T08:00:00.000Z",
            message: "Explain the code",
          }),
        ],
        props: READER,
      });

    expect(summary).not.toHaveProperty("changes");
  });

  /*
   * A pull request's production review is one task, reviewed again in
   * place: its row says what its latest review found, at a glance, from
   * the task's own outcome - and a task of any other kind never does, even
   * if its outcome held one.
   */
  function reviewTask(): AIRun {
    const task: AIRun = new AIRun();
    task._id = TASK_ID.toString();
    task.projectId = PROJECT_ID;
    task.runType = AIRunType.CodeFix;
    task.codeFixTaskType = CodeFixTaskType.GitHubPullRequestProductionReview;
    task.codeRepositoryId = REPOSITORY_ID;
    task.status = AIRunStatus.Completed;
    task.title = "Production review: fix: guard the card (#42)";
    task.createdAt = new Date("2026-10-22T09:00:00.000Z");
    return task;
  }

  function outcomesRead(
    outcome: AIRun["taskOutcome"],
  ): (data: { select?: Record<string, unknown> }) => Promise<Array<AIRun>> {
    return async (data: {
      select?: Record<string, unknown>;
    }): Promise<Array<AIRun>> => {
      // The outcomes read; a review has no replies.
      if (data.select?.["taskOutcome"]) {
        const run: AIRun = new AIRun();
        run._id = TASK_ID.toString();
        run.taskOutcome = outcome!;
        return [run];
      }
      return [];
    };
  }

  test("a production review's row says what its latest review found", async () => {
    const report: ProductionReviewReport = fullReport({
      posting: ProductionReviewPosting.Link,
    });

    jest.spyOn(AIRunService, "findBy").mockImplementation(
      outcomesRead({
        summary: "",
        filesChanged: [],
        productionReview: report,
      }) as never,
    );
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);

    const [summary]: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [reviewTask()],
        props: READER,
      });

    expect(summary!.recipe).toBe(
      CodeFixTaskType.GitHubPullRequestProductionReview,
    );
    expect(summary!.productionReview).toEqual({
      hasSignal: true,
      exceptionCount: report.exceptions.length,
      operationCount: report.operations.length,
      hotFunctionCount: report.hotFunctions.length,
      incidentCount: 2,
      suspectDeployCount: report.suspectDeploys.length,
      headSha: report.pullRequest.headSha,
      reviewedAt: report.reviewedAt,
      posting: ProductionReviewPosting.Link,
    });
    // Its numbers, never the report itself: the row is a glance.
    expect(JSON.stringify(summary)).not.toContain("TypeError");
  });

  test("a production review that found nothing says so", async () => {
    jest.spyOn(AIRunService, "findBy").mockImplementation(
      outcomesRead({
        summary: "",
        filesChanged: [],
        productionReview: emptyReport(),
      }) as never,
    );
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);

    const [summary]: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [reviewTask()],
        props: READER,
      });

    expect(summary!.productionReview!.hasSignal).toBe(false);
    expect(summary!.productionReview!.exceptionCount).toBe(0);
  });

  test("a production review not yet reviewed has no glance", async () => {
    jest
      .spyOn(AIRunService, "findBy")
      .mockImplementation(outcomesRead(undefined) as never);
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);

    const [summary]: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [reviewTask()],
        props: READER,
      });

    expect(summary).not.toHaveProperty("productionReview");
  });

  test("a task of another kind never shows a production review", async () => {
    const task: AIRun = reviewTask();
    task.codeFixTaskType = CodeFixTaskType.CodeRequest;

    jest.spyOn(AIRunService, "findBy").mockImplementation(
      outcomesRead({
        summary: "",
        filesChanged: [],
        productionReview: fullReport(),
      }) as never,
    );
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);

    const [summary]: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [task],
        props: READER,
      });

    expect(summary).not.toHaveProperty("productionReview");
  });

  test("a list reads nothing for no tasks", async () => {
    const findRuns: jest.SpiedFunction<typeof AIRunService.findBy> = jest.spyOn(
      AIRunService,
      "findBy",
    );

    expect(
      await CodeTaskPresenter.summarize({
        projectId: PROJECT_ID,
        tasks: [],
        props: READER,
      }),
    ).toEqual([]);
    expect(findRuns).not.toHaveBeenCalled();
  });
});

/*
 * Merged is not fixed: a fix's pull request carries what production showed
 * once a deploy shipped it (FixProductionVerifier), wherever Code shows it -
 * the task list's row and the conversation's turn.
 */
describe("CodeTaskPresenter.toPullRequest: what production showed", () => {
  function mergedFix(
    overrides: Partial<AIAgentTaskPullRequest>,
  ): AIAgentTaskPullRequest {
    const value: AIAgentTaskPullRequest = openPullRequest(
      TASK_ID,
      PullRequestState.Merged,
    );

    Object.assign(value, overrides);
    return value;
  }

  test("a merged fix production decided says so, with its check and its words", () => {
    expect(
      CodeTaskPresenter.toPullRequest(
        mergedFix({
          productionStatus: FixProductionStatus.Verified,
          productionCheck: FixProductionCheck.Performance,
          productionSummary:
            'The p99 of "GET /users" fell from 2.4 s to 310 ms in the 26 hours since version 2.3.2 shipped the fix (1,204 spans).',
          productionStatusAt: new Date("2026-10-20T10:00:00.000Z"),
          deployedAt: new Date("2026-10-19T08:00:00.000Z"),
          deployedVersion: "2.3.2",
        }),
      ),
    ).toEqual({
      number: 17,
      url: "https://github.com/acme/api/pull/17",
      title: "Add retries to the users API",
      state: PullRequestState.Merged,
      branch: "oneuptime-task-42-5e1f4b3a",
      production: {
        status: FixProductionStatus.Verified,
        check: FixProductionCheck.Performance,
        summary:
          'The p99 of "GET /users" fell from 2.4 s to 310 ms in the 26 hours since version 2.3.2 shipped the fix (1,204 spans).',
        statusAt: "2026-10-20T10:00:00.000Z",
        deployedAt: "2026-10-19T08:00:00.000Z",
        deployedVersion: "2.3.2",
      },
    });
  });

  test("a watched exception fix from before the checks were told apart is an exception's", () => {
    expect(
      CodeTaskPresenter.toPullRequest(
        mergedFix({ productionStatus: FixProductionStatus.Watching }),
      ).production,
    ).toEqual({
      status: FixProductionStatus.Watching,
      check: FixProductionCheck.Exception,
    });
  });

  test("a pull request production says nothing about, or says something this server does not know, carries none", () => {
    expect(CodeTaskPresenter.toPullRequest(mergedFix({}))).not.toHaveProperty(
      "production",
    );
    expect(
      CodeTaskPresenter.toPullRequest(
        mergedFix({ productionStatus: "Shipped" as FixProductionStatus }),
      ),
    ).not.toHaveProperty("production");
    expect(
      CodeTaskPresenter.toPullRequest(
        mergedFix({
          productionStatus: FixProductionStatus.Verified,
          productionCheck: "FasterQueries" as FixProductionCheck,
        }),
      ),
    ).not.toHaveProperty("production");
  });

  test("the pull requests are read with the columns the report is made of", async () => {
    const findPullRequests: jest.SpiedFunction<
      typeof AIAgentTaskPullRequestService.findBy
    > = jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([]);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);

    await CodeTaskPresenter.summarize({
      projectId: PROJECT_ID,
      tasks: [
        requestTurn({
          id: TASK_ID,
          status: AIRunStatus.Completed,
          createdAt: "2026-10-19T08:00:00.000Z",
          message: "Add retries",
        }),
      ],
      props: READER,
    });

    expect(findPullRequests.mock.calls[0]![0].select).toMatchObject({
      productionStatus: true,
      productionCheck: true,
      productionSummary: true,
      productionStatusAt: true,
    });
  });
});

describe("CodeTaskPresenter.getConversation", () => {
  function setUp(): { task: AIRun; reply: AIRun } {
    const task: AIRun = requestTurn({
      id: TASK_ID,
      status: AIRunStatus.Completed,
      createdAt: "2026-10-19T08:00:00.000Z",
      message: "Add retries to the users API",
    });
    task.startedAt = new Date("2026-10-19T08:01:00.000Z");
    task.completedAt = new Date("2026-10-19T08:09:00.000Z");
    task.taskOutcome = {
      summary: "Added a retry with backoff.",
      filesChanged: [
        {
          path: "src/api/users.ts",
          status: CodeTaskFileStatus.Modified,
          additions: 12,
          deletions: 3,
        },
      ],
      pullRequestNumber: 17,
      openedPullRequest: true,
    };
    task.codeChanges = {
      files: [
        {
          path: "src/api/users.ts",
          status: CodeTaskFileStatus.Modified,
          additions: 12,
          deletions: 3,
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
      isTruncated: false,
    };

    const reply: AIRun = requestTurn({
      id: REPLY_ID,
      codeTaskId: TASK_ID,
      status: AIRunStatus.Running,
      createdAt: "2026-10-19T09:00:00.000Z",
      message: "Use exponential backoff",
    });

    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(task);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([reply]);
    jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([openPullRequest(TASK_ID, PullRequestState.Open)]);

    return { task, reply };
  }

  test("shows each turn: what was asked, the context's names, the reply, the files, and the diff for people who may change the code", async () => {
    const { task } = setUp();

    const conversation: {
      task: CodeTaskSummaryJSON;
      turns: Array<CodeTaskTurnJSON>;
    } = await CodeTaskPresenter.getConversation({
      projectId: PROJECT_ID,
      task,
      canSeeChanges: true,
      props: READER,
    });

    expect(conversation.task.state).toBe(CodeTaskState.Working);
    expect(conversation.turns).toHaveLength(2);

    const first: CodeTaskTurnJSON = conversation.turns[0]!;

    expect(first.request).toEqual({
      message: "Add retries to the users API",
      context: [
        {
          type: CodeTaskContextType.Incident,
          label: "Incident #7: Users API is slow",
          recordId: INCIDENT_ID.toString(),
        },
        {
          type: CodeTaskContextType.File,
          label: "src/api/users.ts",
          path: "src/api/users.ts",
        },
      ],
    });
    expect(first.requestedBy).toEqual({
      id: USER_ID.toString(),
      name: "Jane Doe",
    });
    expect(first.state).toBe(CodeTaskState.Done);
    expect(first.outcome?.summary).toBe("Added a retry with backoff.");
    expect(first.changes?.files[0]?.patch).toBe("@@ -1 +1 @@\n-old\n+new");
    expect(first.pullRequests).toEqual([
      {
        number: 17,
        url: "https://github.com/acme/api/pull/17",
        title: "Add retries to the users API",
        state: PullRequestState.Open,
        branch: "oneuptime-task-42-5e1f4b3a",
      },
    ]);
    expect(first.startedAt).toBe("2026-10-19T08:01:00.000Z");
    expect(first.completedAt).toBe("2026-10-19T08:09:00.000Z");

    const second: CodeTaskTurnJSON = conversation.turns[1]!;

    expect(second.request?.message).toBe("Use exponential backoff");
    expect(second.state).toBe(CodeTaskState.Working);
    expect(second.pullRequests).toEqual([]);
  });

  test("the branch the person picked is said on the task's first turn - and only there", async () => {
    const { task, reply } = setUp();
    task.taskContext = {
      request: {
        ...task.taskContext!.request!,
        baseBranch: "release/2026-10",
      },
    };
    // A later turn never carries one: if it did, it is not said.
    reply.taskContext = {
      request: { ...reply.taskContext!.request!, baseBranch: "elsewhere" },
    };

    const conversation: { turns: Array<CodeTaskTurnJSON> } =
      await CodeTaskPresenter.getConversation({
        projectId: PROJECT_ID,
        task,
        canSeeChanges: true,
        props: READER,
      });

    expect(conversation.turns[0]!.request?.baseBranch).toBe("release/2026-10");
    expect(conversation.turns[1]!.request).not.toHaveProperty("baseBranch");
  });

  test("a branch git would not take is never said", async () => {
    const { task } = setUp();
    task.taskContext = {
      request: { ...task.taskContext!.request!, baseBranch: "bad..branch" },
    };

    const conversation: { turns: Array<CodeTaskTurnJSON> } =
      await CodeTaskPresenter.getConversation({
        projectId: PROJECT_ID,
        task,
        canSeeChanges: true,
        props: READER,
      });

    expect(conversation.turns[0]!.request).not.toHaveProperty("baseBranch");
  });

  test("the task at the top says how much it changed, from its turns' outcomes", async () => {
    const { task } = setUp();

    const conversation: { task: CodeTaskSummaryJSON } =
      await CodeTaskPresenter.getConversation({
        projectId: PROJECT_ID,
        task,
        canSeeChanges: false,
        props: READER,
      });

    expect(conversation.task.changes).toEqual({
      files: 1,
      additions: 12,
      deletions: 3,
    });
  });

  test("never sends the snapshots the AI read", async () => {
    const { task } = setUp();

    const conversation: { turns: Array<CodeTaskTurnJSON> } =
      await CodeTaskPresenter.getConversation({
        projectId: PROJECT_ID,
        task,
        canSeeChanges: true,
        props: READER,
      });

    expect(JSON.stringify(conversation)).not.toContain(
      "SECRET SNAPSHOT THE AI READ",
    );
  });

  test("a reader who may not change the code sees which files changed, not the diff - it is not even read", async () => {
    const { task } = setUp();

    const conversation: { turns: Array<CodeTaskTurnJSON> } =
      await CodeTaskPresenter.getConversation({
        projectId: PROJECT_ID,
        task,
        canSeeChanges: false,
        props: READER,
      });

    expect(conversation.turns[0]!.outcome?.filesChanged).toHaveLength(1);
    expect(conversation.turns[0]!.changes).toBeUndefined();

    const select: Record<string, unknown> = (
      (AIRunService.findOneById as unknown as jest.Mock).mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(select["codeChanges"]).toBeUndefined();
    expect(select["taskOutcome"]).toBe(true);
  });

  test("a turn's steps are the newest events of the run, in order", async () => {
    const { task } = setUp();

    const newest: AIRunEvent = new AIRunEvent();
    newest.sequence = 2;
    newest.eventType = AIRunEventType.ProgressLog;
    newest.toolName = "read_file";
    newest.resultSummary = { message: "read src/b.ts" };

    const older: AIRunEvent = new AIRunEvent();
    older.sequence = 1;
    older.eventType = AIRunEventType.ProgressLog;
    older.toolName = "read_file";
    older.resultSummary = { message: "read src/a.ts" };

    const findEvents: jest.SpiedFunction<typeof AIRunEventService.findBy> = (
      AIRunEventService.findBy as unknown as jest.SpiedFunction<
        typeof AIRunEventService.findBy
      >
    ).mockResolvedValue([newest, older]);

    const conversation: { turns: Array<CodeTaskTurnJSON> } =
      await CodeTaskPresenter.getConversation({
        projectId: PROJECT_ID,
        task,
        canSeeChanges: true,
        props: READER,
      });

    expect(
      conversation.turns[0]!.steps.map((step: { subject: string }) => {
        return step.subject;
      }),
    ).toEqual(["src/a.ts", "src/b.ts"]);
    expect(
      (findEvents.mock.calls[0]![0] as { sort: Record<string, string> }).sort,
    ).toEqual({ sequence: "DESC" });
  });

  test("a question waits only when its turn finished", async () => {
    const { task } = setUp();
    task.needsUserInput = true;
    task.status = AIRunStatus.Error;

    const conversation: { turns: Array<CodeTaskTurnJSON> } =
      await CodeTaskPresenter.getConversation({
        projectId: PROJECT_ID,
        task,
        canSeeChanges: true,
        props: READER,
      });

    expect(conversation.turns[0]!.needsInput).toBe(false);
    expect(conversation.turns[0]!.state).toBe(CodeTaskState.Failed);
  });
});

describe("CodeTaskOrigin", () => {
  const subjects: Parameters<typeof CodeTaskOrigin.describe>[0]["subjects"] = {
    exceptions: new Map(),
    incidents: new Map(),
    alerts: new Map(),
  };

  function originOf(
    setUp: (run: AIRun) => void,
    taskContext?: Record<string, unknown>,
  ): CodeTaskOriginJSON {
    const run: AIRun = new AIRun();
    run._id = TASK_ID.toString();
    setUp(run);

    return CodeTaskOrigin.describe({
      run,
      subjects,
      taskContext: taskContext as never,
    });
  }

  test("a GitHub command names its issue or pull request, linked on GitHub", () => {
    expect(
      originOf(
        (run: AIRun) => {
          run.codeFixTaskType = CodeFixTaskType.GitHubIssueFix;
        },
        {
          github: {
            commandType: "implement",
            organizationName: "acme",
            repositoryName: "api",
            issueNumber: 12,
            commentId: 1,
            commentKind: "issue",
            requestedBy: "octocat",
            installationId: "1",
            codeRepositoryId: REPOSITORY_ID.toString(),
          },
        },
      ),
    ).toEqual({
      type: CodeTaskOriginType.GitHubIssue,
      label: "#12",
      url: "https://github.com/acme/api/issues/12",
    });
  });

  test("an incident it was started from is named by number and title when readable", () => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.incidentNumber = 7;
    incident.title = "Users API is slow";
    subjects.incidents.set(INCIDENT_ID.toString(), incident);

    expect(
      originOf((run: AIRun) => {
        run.codeFixTaskType = CodeFixTaskType.FixFromIncident;
        run.triggeredByIncidentId = INCIDENT_ID;
      }),
    ).toEqual({
      type: CodeTaskOriginType.Incident,
      label: "#7: Users API is slow",
      recordId: INCIDENT_ID.toString(),
    });

    subjects.incidents.clear();

    // One the reader may not read keeps its link, without its title.
    expect(
      originOf((run: AIRun) => {
        run.codeFixTaskType = CodeFixTaskType.FixFromIncident;
        run.triggeredByIncidentId = INCIDENT_ID;
      }),
    ).toEqual({
      type: CodeTaskOriginType.Incident,
      label: "",
      recordId: INCIDENT_ID.toString(),
    });
  });

  test("a slow trace, a service and an insight", () => {
    expect(
      originOf(
        (run: AIRun) => {
          run.codeFixTaskType = CodeFixTaskType.FixPerformance;
        },
        {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          serviceName: "checkout",
        },
      ),
    ).toEqual({
      type: CodeTaskOriginType.Trace,
      label: "checkout",
      recordId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });

    expect(
      originOf(
        (run: AIRun) => {
          run.codeFixTaskType = CodeFixTaskType.ImproveLogging;
        },
        {
          telemetryServiceId: REPOSITORY_ID.toString(),
          serviceName: "checkout",
        },
      ).type,
    ).toBe(CodeTaskOriginType.Service);

    expect(
      originOf((run: AIRun) => {
        run.codeFixTaskType = CodeFixTaskType.FixException;
        run.triggeredByAiInsightId = INCIDENT_ID;
      }).type,
    ).toBe(CodeTaskOriginType.Insight);

    expect(
      originOf((run: AIRun) => {
        run.codeFixTaskType = CodeFixTaskType.FixException;
      }),
    ).toEqual({ type: CodeTaskOriginType.Unknown, label: "" });
  });

  test("names are read as the reader, and a table they may not read names nothing", async () => {
    const findIncidents: jest.SpiedFunction<typeof IncidentService.findBy> =
      jest
        .spyOn(IncidentService, "findBy")
        .mockRejectedValue(new Error("You do not have permission to read"));
    const findAlerts: jest.SpiedFunction<typeof AlertService.findBy> =
      jest.spyOn(AlertService, "findBy");

    const run: AIRun = new AIRun();
    run.triggeredByIncidentId = INCIDENT_ID;

    const loaded: Parameters<typeof CodeTaskOrigin.describe>[0]["subjects"] =
      await CodeTaskOrigin.loadSubjects({
        projectId: PROJECT_ID,
        runs: [run],
        props: READER,
      });

    expect(loaded.incidents.size).toBe(0);
    expect((findIncidents.mock.calls[0]![0] as { props: unknown }).props).toBe(
      READER,
    );
    expect(findAlerts).not.toHaveBeenCalled();
  });
});

/*
 * A task OneUptime started on its own, from slow code it found in a
 * service's profiles (Types/AI/TelemetryAi): a Code request nobody typed,
 * stamped with the insight it came from. Code names that insight as what
 * started it, above the request OneUptime wrote.
 */
describe("a task OneUptime started from an insight", () => {
  const INSIGHT_ID: ObjectID = new ObjectID(
    "4d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f60",
  );

  function oneUptimeRequest(): AIRun {
    const run: AIRun = requestTurn({
      id: TASK_ID,
      status: AIRunStatus.Queued,
      createdAt: "2026-10-24T09:00:10.000Z",
      message: "Make OrderParser.parse in src/orders/parser.ts faster",
    });
    run.userId = undefined as never;
    run.triggeredByAiInsightId = INSIGHT_ID;
    return run;
  }

  function insightNamed(title: string): AIInsight {
    const insight: AIInsight = new AIInsight();
    insight._id = INSIGHT_ID.toString();
    insight.title = title;
    return insight;
  }

  test("isStartedByOneUptime: a Code request with no person, naming an insight", () => {
    expect(CodeTaskOrigin.isStartedByOneUptime(oneUptimeRequest())).toBe(true);

    const asked: AIRun = oneUptimeRequest();
    asked.userId = USER_ID;
    expect(CodeTaskOrigin.isStartedByOneUptime(asked)).toBe(false);

    const noInsight: AIRun = oneUptimeRequest();
    noInsight.triggeredByAiInsightId = undefined as never;
    expect(CodeTaskOrigin.isStartedByOneUptime(noInsight)).toBe(false);

    const otherRecipe: AIRun = oneUptimeRequest();
    otherRecipe.codeFixTaskType = CodeFixTaskType.FixException;
    expect(CodeTaskOrigin.isStartedByOneUptime(otherRecipe)).toBe(false);
  });

  test("is named by its insight's title, linked to it", () => {
    expect(
      CodeTaskOrigin.describe({
        run: oneUptimeRequest(),
        subjects: {
          exceptions: new Map(),
          incidents: new Map(),
          alerts: new Map(),
          insights: new Map([
            [
              INSIGHT_ID.toString(),
              insightNamed(
                "OrderParser.parse takes 18% of the CPU time in checkout",
              ),
            ],
          ]),
        },
      }),
    ).toEqual({
      type: CodeTaskOriginType.Insight,
      label: "OrderParser.parse takes 18% of the CPU time in checkout",
      recordId: INSIGHT_ID.toString(),
    });
  });

  test("an insight the reader may not read keeps its link, without its title", () => {
    expect(
      CodeTaskOrigin.describe({
        run: oneUptimeRequest(),
        subjects: {
          exceptions: new Map(),
          incidents: new Map(),
          alerts: new Map(),
        },
      }),
    ).toEqual({
      type: CodeTaskOriginType.Insight,
      label: "",
      recordId: INSIGHT_ID.toString(),
    });
  });

  test("a request a person asked stays theirs, whatever it names", () => {
    const asked: AIRun = oneUptimeRequest();
    asked.userId = USER_ID;

    expect(
      CodeTaskOrigin.describe({
        run: asked,
        subjects: {
          exceptions: new Map(),
          incidents: new Map(),
          alerts: new Map(),
        },
        requesterName: "Jane Doe",
      }),
    ).toEqual({ type: CodeTaskOriginType.Request, label: "Jane Doe" });
  });

  test("the insights are read as the reader, only for OneUptime's own requests", async () => {
    const findInsights: jest.SpiedFunction<typeof AIInsightService.findBy> =
      jest
        .spyOn(AIInsightService, "findBy")
        .mockResolvedValue([insightNamed("Slow")]);

    const asked: AIRun = oneUptimeRequest();
    asked.userId = USER_ID;
    asked._id = REPLY_ID.toString();

    const loaded: Parameters<typeof CodeTaskOrigin.describe>[0]["subjects"] =
      await CodeTaskOrigin.loadSubjects({
        projectId: PROJECT_ID,
        runs: [oneUptimeRequest(), asked],
        props: READER,
      });

    expect(loaded.insights?.get(INSIGHT_ID.toString())?.title).toBe("Slow");
    expect(findInsights).toHaveBeenCalledTimes(1);
    expect((findInsights.mock.calls[0]![0] as { props: unknown }).props).toBe(
      READER,
    );
  });

  test("an insight the reader may not read names nothing, and fails nothing", async () => {
    jest
      .spyOn(AIInsightService, "findBy")
      .mockRejectedValue(new Error("You do not have permission to read"));

    const loaded: Parameters<typeof CodeTaskOrigin.describe>[0]["subjects"] =
      await CodeTaskOrigin.loadSubjects({
        projectId: PROJECT_ID,
        runs: [oneUptimeRequest()],
        props: READER,
      });

    expect(loaded.insights?.size).toBe(0);
  });

  test("its conversation shows what started it above the request OneUptime wrote", async () => {
    const task: AIRun = oneUptimeRequest();
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(task);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(AIInsightService, "findBy")
      .mockResolvedValue([
        insightNamed("OrderParser.parse takes 18% of the CPU time in checkout"),
      ]);

    const conversation: {
      task: CodeTaskSummaryJSON;
      turns: Array<CodeTaskTurnJSON>;
    } = await CodeTaskPresenter.getConversation({
      projectId: PROJECT_ID,
      task,
      canSeeChanges: true,
      props: READER,
    });

    const first: CodeTaskTurnJSON = conversation.turns[0]!;

    expect(first.origin).toEqual({
      type: CodeTaskOriginType.Insight,
      label: "OrderParser.parse takes 18% of the CPU time in checkout",
      recordId: INSIGHT_ID.toString(),
    });
    expect(first.request?.message).toBe(
      "Make OrderParser.parse in src/orders/parser.ts faster",
    );
    expect(first.requestedBy).toBeUndefined();
    expect(conversation.task.origin.type).toBe(CodeTaskOriginType.Insight);
  });

  test("a person's request shows no origin beside it", async () => {
    const asked: AIRun = oneUptimeRequest();
    asked.userId = USER_ID;
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(asked);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);

    const conversation: {
      task: CodeTaskSummaryJSON;
      turns: Array<CodeTaskTurnJSON>;
    } = await CodeTaskPresenter.getConversation({
      projectId: PROJECT_ID,
      task: asked,
      canSeeChanges: true,
      props: READER,
    });

    expect(conversation.turns[0]!.origin).toBeUndefined();
    expect(conversation.turns[0]!.requestedBy?.name).toBe("Jane Doe");
  });
});
