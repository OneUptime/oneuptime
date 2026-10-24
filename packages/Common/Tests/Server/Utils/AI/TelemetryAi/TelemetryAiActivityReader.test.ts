import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskThread from "../../../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import ProfileInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/ProfileInsightFix";
import TelemetryAiActivityReader from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiActivityReader";
import SourceLocator, {
  LocatableRepositoryWithTree,
} from "../../../../../Server/Utils/CodeRepository/SourceLocator";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import Project from "../../../../../Models/DatabaseModels/Project";
import URL from "../../../../../Types/API/URL";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import {
  CodeTaskBlockerType,
  CodeTaskPersonJSON,
} from "../../../../../Types/AI/CodeTask";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import {
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
} from "../../../../../Types/AI/TelemetryAi";
import {
  TELEMETRY_AI_LOGS_MAX_PROBLEMS,
  TelemetryAiLogEntryJSON,
  TelemetryAiLogKind,
  TelemetryAiLogState,
  TelemetryAiLogsJSON,
  TelemetryAiReadinessJSON,
} from "../../../../../Types/AI/TelemetryAiActivity";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";

/*
 * What a telemetry product's AI section reads (TelemetryAiActivityReader):
 * whether OneUptime AI can open pull requests for the lane's problems now,
 * and the record of what it did with them - only about problems the reader
 * may read, with a pull request's repository and link only for a
 * repository they may read in Code.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5092eeee-0000-4000-8000-000000000001",
);
const INSIGHT_A: string = "5092eeee-0000-4000-8000-0000000000a1";
const INSIGHT_B: string = "5092eeee-0000-4000-8000-0000000000b2";
const REPO_ID: string = "5092eeee-0000-4000-8000-0000000000c3";
const OTHER_REPO_ID: string = "5092eeee-0000-4000-8000-0000000000c4";
const PERSON_ID: string = "5092eeee-0000-4000-8000-0000000000d5";
const TRIAGE_RUN: string = "5092eeee-0000-4000-8000-0000000000e1";
const TASK_RUN: string = "5092eeee-0000-4000-8000-0000000000e2";
const PERSON_TASK_RUN: string = "5092eeee-0000-4000-8000-0000000000e3";

const READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID(PERSON_ID),
  tenantId: PROJECT_ID,
};

function problem(id: string, title: string): AIInsight {
  const value: AIInsight = new AIInsight();
  value.id = new ObjectID(id);
  value.title = title;
  value.serviceName = "checkout";
  value.classification = "Actionable";
  return value;
}

function run(data: {
  id: string;
  runType: AIRunType;
  status: AIRunStatus;
  insightId: string;
  userId?: string;
  repositoryId?: string;
  needsUserInput?: boolean;
}): AIRun {
  const value: AIRun = new AIRun();
  value.id = new ObjectID(data.id);
  value.runType = data.runType;
  value.status = data.status;
  value.triggeredByAiInsightId = new ObjectID(data.insightId);
  value.createdAt = new Date("2026-10-24T09:00:00.000Z");
  if (data.userId) {
    value.userId = new ObjectID(data.userId);
  }
  if (data.repositoryId) {
    value.codeRepositoryId = new ObjectID(data.repositoryId);
  }
  if (data.needsUserInput !== undefined) {
    value.needsUserInput = data.needsUserInput;
  }
  return value;
}

function repositoryRow(id: string, name: string): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value.id = new ObjectID(id);
  value.name = name;
  return value;
}

function pullRequest(runId: string): AIAgentTaskPullRequest {
  const value: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
  value.aiRunId = new ObjectID(runId);
  value.pullRequestState = PullRequestState.Open;
  value.pullRequestNumber = 812;
  value.pullRequestUrl = URL.fromString(
    "https://github.com/acme/shop/pull/812",
  );
  return value;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TelemetryAiActivityReader.getState", () => {
  test.each([
    [
      AIRunStatus.Queued,
      AIRunType.Investigation,
      false,
      TelemetryAiLogState.Waiting,
    ],
    [
      AIRunStatus.Running,
      AIRunType.CodeFix,
      false,
      TelemetryAiLogState.Working,
    ],
    [
      AIRunStatus.WaitingForApproval,
      AIRunType.CodeFix,
      false,
      TelemetryAiLogState.Working,
    ],
    [
      AIRunStatus.Completed,
      AIRunType.Investigation,
      true,
      TelemetryAiLogState.Done,
    ],
    [AIRunStatus.Completed, AIRunType.CodeFix, false, TelemetryAiLogState.Done],
    [
      AIRunStatus.Completed,
      AIRunType.CodeFix,
      true,
      TelemetryAiLogState.WaitingForYou,
    ],
    [
      AIRunStatus.NoFixFound,
      AIRunType.CodeFix,
      false,
      TelemetryAiLogState.NothingToChange,
    ],
    [AIRunStatus.Error, AIRunType.CodeFix, false, TelemetryAiLogState.Failed],
    [
      AIRunStatus.Stale,
      AIRunType.Investigation,
      false,
      TelemetryAiLogState.Failed,
    ],
    [
      AIRunStatus.Cancelled,
      AIRunType.CodeFix,
      false,
      TelemetryAiLogState.Stopped,
    ],
  ])(
    "a %s %s run (needs input: %s) reads as %s",
    (
      status: AIRunStatus,
      runType: AIRunType,
      needsUserInput: boolean,
      state: TelemetryAiLogState,
    ) => {
      expect(
        TelemetryAiActivityReader.getState({ status, runType, needsUserInput }),
      ).toBe(state);
    },
  );

  test("a run with no status yet waits", () => {
    expect(TelemetryAiActivityReader.getState({})).toBe(
      TelemetryAiLogState.Waiting,
    );
  });
});

describe("TelemetryAiActivityReader.toEntry", () => {
  test("an investigation names its problem, and its verdict once it is done", () => {
    const done: TelemetryAiLogEntryJSON = TelemetryAiActivityReader.toEntry({
      run: run({
        id: TRIAGE_RUN,
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
        insightId: INSIGHT_A,
      }),
      problem: problem(
        INSIGHT_A,
        "OrderParser.parse takes 18% of the CPU time",
      ),
    });

    expect(done).toEqual({
      runId: TRIAGE_RUN,
      kind: TelemetryAiLogKind.Investigation,
      at: "2026-10-24T09:00:00.000Z",
      state: TelemetryAiLogState.Done,
      insight: {
        id: INSIGHT_A,
        title: "OrderParser.parse takes 18% of the CPU time",
        serviceName: "checkout",
      },
      classification: "Actionable",
    });

    const running: TelemetryAiLogEntryJSON = TelemetryAiActivityReader.toEntry({
      run: run({
        id: TRIAGE_RUN,
        runType: AIRunType.Investigation,
        status: AIRunStatus.Running,
        insightId: INSIGHT_A,
      }),
      problem: problem(INSIGHT_A, "x"),
    });

    expect(running.classification).toBeUndefined();
  });

  test("a pull request names its task, and its repository and link only with a repository given", () => {
    const task: AIRun = run({
      id: TASK_RUN,
      runType: AIRunType.CodeFix,
      status: AIRunStatus.Completed,
      insightId: INSIGHT_A,
      repositoryId: REPO_ID,
    });

    const named: TelemetryAiLogEntryJSON = TelemetryAiActivityReader.toEntry({
      run: task,
      problem: problem(INSIGHT_A, "slow"),
      repository: repositoryRow(REPO_ID, "acme/shop"),
      pullRequest: pullRequest(TASK_RUN),
    });

    expect(named.kind).toBe(TelemetryAiLogKind.PullRequest);
    expect(named.taskId).toBe(TASK_RUN);
    expect(named.repositoryName).toBe("acme/shop");
    // A repository that says nothing of its host is on GitHub.
    expect(named.repositoryHostedAt).toBe(CodeRepositoryType.GitHub);
    expect(named.pullRequest).toEqual({
      state: PullRequestState.Open,
      number: 812,
      url: "https://github.com/acme/shop/pull/812",
    });
    expect(named.requestedBy).toBeUndefined();
    // A pull request carries no investigation verdict.
    expect(named.classification).toBeUndefined();

    const unnamed: TelemetryAiLogEntryJSON = TelemetryAiActivityReader.toEntry({
      run: task,
      problem: problem(INSIGHT_A, "slow"),
      pullRequest: pullRequest(TASK_RUN),
      requestedBy: "Ada",
    });

    expect(unnamed.taskId).toBe(TASK_RUN);
    expect(unnamed.repositoryName).toBeUndefined();
    expect(unnamed.repositoryHostedAt).toBeUndefined();
    expect(unnamed.pullRequest).toBeUndefined();
    expect(unnamed.requestedBy).toBe("Ada");
  });

  test("a pull request says where its repository is hosted, so a merge request is drawn as one", () => {
    const onGitLab: CodeRepository = repositoryRow(REPO_ID, "acme/shop");
    onGitLab.repositoryHostedAt = CodeRepositoryType.GitLab;

    const entry: TelemetryAiLogEntryJSON = TelemetryAiActivityReader.toEntry({
      run: run({
        id: TASK_RUN,
        runType: AIRunType.CodeFix,
        status: AIRunStatus.Completed,
        insightId: INSIGHT_A,
        repositoryId: REPO_ID,
      }),
      problem: problem(INSIGHT_A, "slow"),
      repository: onGitLab,
      pullRequest: pullRequest(TASK_RUN),
    });

    expect(entry.repositoryHostedAt).toBe(CodeRepositoryType.GitLab);
  });
});

describe("TelemetryAiActivityReader.readLogs", () => {
  let readProblems: SpyInstance<typeof AIInsightService.findBy>;
  let readRuns: SpyInstance<typeof AIRunService.findBy>;
  let countRuns: SpyInstance<typeof AIRunService.countBy>;
  let readRepositories: SpyInstance<typeof CodeRepositoryService.findBy>;
  let readPullRequests: SpyInstance<typeof CodeTaskThread.getPullRequests>;
  let problems: Array<AIInsight>;
  let runs: Array<AIRun>;
  let readableRepositories: Array<CodeRepository> | Error;

  beforeEach(() => {
    problems = [
      problem(INSIGHT_A, "A is slow"),
      problem(INSIGHT_B, "B is slow"),
    ];
    runs = [
      run({
        id: TASK_RUN,
        runType: AIRunType.CodeFix,
        status: AIRunStatus.Running,
        insightId: INSIGHT_A,
        repositoryId: REPO_ID,
      }),
      run({
        id: PERSON_TASK_RUN,
        runType: AIRunType.CodeFix,
        status: AIRunStatus.Completed,
        insightId: INSIGHT_B,
        repositoryId: OTHER_REPO_ID,
        userId: PERSON_ID,
      }),
      run({
        id: TRIAGE_RUN,
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
        insightId: INSIGHT_A,
      }),
    ];
    readableRepositories = [repositoryRow(REPO_ID, "acme/shop")];

    readProblems = jest
      .spyOn(AIInsightService, "findBy")
      .mockImplementation(async () => {
        return problems;
      });
    readRuns = jest
      .spyOn(AIRunService, "findBy")
      .mockImplementation(async () => {
        return runs;
      });
    countRuns = jest
      .spyOn(AIRunService, "countBy")
      .mockImplementation(async () => {
        return new PositiveNumber(27);
      });
    readRepositories = jest
      .spyOn(CodeRepositoryService, "findBy")
      .mockImplementation(async () => {
        if (readableRepositories instanceof Error) {
          throw readableRepositories;
        }
        return readableRepositories;
      });
    readPullRequests = jest
      .spyOn(CodeTaskThread, "getPullRequests")
      .mockImplementation(async () => {
        return [pullRequest(TASK_RUN), pullRequest(PERSON_TASK_RUN)];
      });
    jest.spyOn(CodeTaskThread, "getPeople").mockImplementation(async () => {
      return new Map<string, CodeTaskPersonJSON>([
        [PERSON_ID, { id: PERSON_ID, name: "Ada Lovelace" }],
      ]);
    });
  });

  async function read(skip: number = 0): Promise<TelemetryAiLogsJSON> {
    return await TelemetryAiActivityReader.readLogs({
      projectId: PROJECT_ID,
      lane: TelemetryAiLane.Profile,
      props: READER,
      skip,
      limit: 20,
    });
  }

  test("reads the lane's problems as the reader, the newest found first", async () => {
    await read();

    const call: Record<string, unknown> = readProblems.mock
      .calls[0]![0] as never;
    const query: Record<string, unknown> = call["query"] as never;

    expect(call["props"]).toBe(READER);
    expect(call["limit"]).toBe(TELEMETRY_AI_LOGS_MAX_PROBLEMS);
    expect(call["sort"]).toEqual({ lastSeenAt: SortOrder.Descending });
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(JSON.stringify(query["insightType"])).toContain(
      AIInsightType.ProfileHotspot,
    );
  });

  test("reads what was done for exactly those problems, as OneUptime: investigations and first turns of tasks, a page at a time", async () => {
    await read(40);

    const call: Record<string, unknown> = readRuns.mock.calls[0]![0] as never;
    const query: Record<string, unknown> = call["query"] as never;

    expect(call["props"]).toEqual({ isRoot: true });
    expect(call["skip"]).toBe(40);
    expect(call["limit"]).toBe(20);
    expect(call["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(JSON.stringify(query["triggeredByAiInsightId"])).toContain(
      INSIGHT_A,
    );
    expect(JSON.stringify(query["triggeredByAiInsightId"])).toContain(
      INSIGHT_B,
    );
    expect(JSON.stringify(query["runType"])).toContain(AIRunType.Investigation);
    expect(JSON.stringify(query["runType"])).toContain(AIRunType.CodeFix);
    expect(query["codeTaskId"]).toBeDefined();

    // The count is of the same query.
    expect(
      (countRuns.mock.calls[0]![0] as unknown as Record<string, unknown>)[
        "query"
      ],
    ).toBe(query);
  });

  test("says nothing, and reads nothing more, for a reader who may read none of the problems", async () => {
    problems = [];

    expect(await read()).toEqual({ entries: [], totalCount: 0 });
    expect(readRuns).not.toHaveBeenCalled();
    expect(countRuns).not.toHaveBeenCalled();
  });

  test("names who asked, and a pull request's repository and link only where the reader may read the repository", async () => {
    const logs: TelemetryAiLogsJSON = await read();

    expect(logs.totalCount).toBe(27);
    expect(
      logs.entries.map((entry: TelemetryAiLogEntryJSON): string => {
        return entry.runId;
      }),
    ).toEqual([TASK_RUN, PERSON_TASK_RUN, TRIAGE_RUN]);

    const [ownTask, personTask, triage] = logs.entries as [
      TelemetryAiLogEntryJSON,
      TelemetryAiLogEntryJSON,
      TelemetryAiLogEntryJSON,
    ];

    expect(ownTask.state).toBe(TelemetryAiLogState.Working);
    expect(ownTask.requestedBy).toBeUndefined();
    expect(ownTask.repositoryName).toBe("acme/shop");
    expect(ownTask.pullRequest?.number).toBe(812);

    // A repository the reader may not read is not named, nor its pull request.
    expect(personTask.requestedBy).toBe("Ada Lovelace");
    expect(personTask.taskId).toBe(PERSON_TASK_RUN);
    expect(personTask.repositoryName).toBeUndefined();
    expect(personTask.pullRequest).toBeUndefined();

    expect(triage.kind).toBe(TelemetryAiLogKind.Investigation);
    expect(triage.insight.title).toBe("A is slow");

    // The repositories are read as the reader, the pull requests by the tasks.
    expect(
      (
        readRepositories.mock.calls[0]![0] as unknown as Record<string, unknown>
      )["props"],
    ).toBe(READER);
    expect(
      (
        readRepositories.mock.calls[0]![0] as unknown as Record<string, unknown>
      )["select"],
    ).toEqual({ _id: true, name: true, repositoryHostedAt: true });
    expect(
      (
        (readPullRequests.mock.calls[0]![0] as { runIds: Array<ObjectID> })
          .runIds || []
      ).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([TASK_RUN, PERSON_TASK_RUN]);
  });

  test("names no repository for a reader the repositories refuse", async () => {
    readableRepositories = new Error("Not authorized");

    const logs: TelemetryAiLogsJSON = await read();

    for (const entry of logs.entries) {
      expect(entry.repositoryName).toBeUndefined();
      expect(entry.pullRequest).toBeUndefined();
    }
  });

  test("leaves out a run about a problem the reader may not read", async () => {
    problems = [problem(INSIGHT_A, "A is slow")];

    const logs: TelemetryAiLogsJSON = await read();

    expect(
      logs.entries.map((entry: TelemetryAiLogEntryJSON): string => {
        return entry.insight.id;
      }),
    ).toEqual([INSIGHT_A, INSIGHT_A]);
  });
});

describe("TelemetryAiActivityReader.readReadiness", () => {
  let project: Project | null;
  let repositories: Array<LocatableRepositoryWithTree>;
  let getBlocker: SpyInstance<typeof CodeTaskGate.getBlocker>;
  let blocker: {
    type: CodeTaskBlockerType;
    message: string;
    runnerName?: string;
  } | null;

  beforeEach(() => {
    project = new Project();
    project.enableAi = true;
    project.enableAutomaticProfileRemediation = true;
    repositories = [
      {
        id: REPO_ID,
        name: "acme/shop",
        organizationName: "acme",
        repositoryName: "shop",
        mainBranchName: "main",
        gitHubAppInstallationId: "42",
      },
    ];
    blocker = null;

    jest.spyOn(ProjectService, "findOneById").mockImplementation(async () => {
      return project;
    });
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockImplementation(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      });
    jest
      .spyOn(SourceLocator, "getLocatableRepositories")
      .mockImplementation(async () => {
        return repositories;
      });
    getBlocker = jest
      .spyOn(CodeTaskGate, "getBlocker")
      .mockImplementation(async () => {
        return blocker;
      });
    jest
      .spyOn(ProfileInsightFix, "countStartedToday")
      .mockImplementation(async () => {
        return 2;
      });
  });

  async function read(): Promise<TelemetryAiReadinessJSON> {
    return await TelemetryAiActivityReader.readReadiness({
      projectId: PROJECT_ID,
      lane: TelemetryAiLane.Profile,
    });
  }

  test("ready: the repositories, today's automatic pull requests and the most a day", async () => {
    expect(await read()).toEqual({
      lane: TelemetryAiLane.Profile,
      isAiEnabled: true,
      isLaneOn: true,
      connectedRepositoryCount: 1,
      blocker: null,
      automaticFixesToday: 2,
      maxAutomaticFixesPerDay: TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
    });

    // Code's gate is asked as OneUptime, for the first repository.
    const call: Record<string, unknown> = getBlocker.mock.calls[0]![0] as never;

    expect((call["props"] as DatabaseCommonInteractionProps).isRoot).toBe(true);
    expect(call["canAsk"]).toBe(true);
    expect(String((call["repository"] as CodeRepository).id)).toBe(REPO_ID);
  });

  test("no repository: nothing to ask Code's gate about", async () => {
    repositories = [];

    const readiness: TelemetryAiReadinessJSON = await read();

    expect(readiness.connectedRepositoryCount).toBe(0);
    expect(readiness.blocker).toBeNull();
    expect(getBlocker).not.toHaveBeenCalled();
  });

  test("Code's gate's blocker, with the repository it was asked about and its Runner", async () => {
    blocker = {
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: "The Runner prod-eu is not online.",
      runnerName: "prod-eu",
    };

    expect((await read()).blocker).toEqual({
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: "The Runner prod-eu is not online.",
      repositoryId: REPO_ID,
      runnerName: "prod-eu",
    });
  });

  test("Enable AI off is the page's own notice, not a blocker said twice", async () => {
    project!.enableAi = false;
    blocker = {
      type: CodeTaskBlockerType.AiDisabled,
      message: "AI is disabled.",
    };

    const readiness: TelemetryAiReadinessJSON = await read();

    expect(readiness.isAiEnabled).toBe(false);
    expect(readiness.blocker).toBeNull();
  });

  test("the lane off, and a project that cannot be read, read as off", async () => {
    project!.enableAutomaticProfileRemediation = false;
    expect((await read()).isLaneOn).toBe(false);

    project = null;
    const unread: TelemetryAiReadinessJSON = await read();

    expect(unread.isAiEnabled).toBe(false);
    expect(unread.isLaneOn).toBe(false);
  });
});
