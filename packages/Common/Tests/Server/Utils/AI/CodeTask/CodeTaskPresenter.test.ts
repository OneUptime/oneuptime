import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import UserService from "../../../../../Server/Services/UserService";
import CodeTaskOrigin from "../../../../../Server/Utils/AI/CodeTask/CodeTaskOrigin";
import CodeTaskPresenter from "../../../../../Server/Utils/AI/CodeTask/CodeTaskPresenter";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
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

function openPullRequest(runId: ObjectID, state: PullRequestState): AIAgentTaskPullRequest {
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

  test("a list reads nothing for no tasks", async () => {
    const findRuns: jest.SpiedFunction<typeof AIRunService.findBy> =
      jest.spyOn(AIRunService, "findBy");

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
        { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", serviceName: "checkout" },
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
        { telemetryServiceId: REPOSITORY_ID.toString(), serviceName: "checkout" },
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
