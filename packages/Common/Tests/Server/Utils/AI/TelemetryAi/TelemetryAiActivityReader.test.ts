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
import CodeTaskListRows, {
  CodeTaskRepliesRead,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskListRows";
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
// A later turn of TASK_RUN: its fix asked again from Code (Try again).
const ASKED_AGAIN_TURN: string = "5092eeee-0000-4000-8000-0000000000e4";

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

/*
 * A later turn of a task, as CodeTaskListRows.readReplies reads a task's
 * newest: a code-fix run of its own, without a run type in its select.
 */
function laterTurn(data: {
  id: string;
  taskId: string;
  status: AIRunStatus;
  needsUserInput?: boolean;
}): AIRun {
  const value: AIRun = new AIRun();
  value.id = new ObjectID(data.id);
  value.codeTaskId = new ObjectID(data.taskId);
  value.status = data.status;
  value.createdAt = new Date("2026-10-24T11:00:00.000Z");
  if (data.needsUserInput !== undefined) {
    value.needsUserInput = data.needsUserInput;
  }
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

  /*
   * Its kind: the Logs page says an investigation's verdict in its kind's
   * words - found in the code is avoidable work for slow code, the tracing
   * to add for missing tracing.
   */
  test("an entry names its finding's kind, an investigation's and a pull request's alike", () => {
    const slow: AIInsight = problem(INSIGHT_A, "GET /orders is slow");
    slow.insightType = AIInsightType.TraceSlowOperation;
    slow.classification = "code-fault";

    const investigation: TelemetryAiLogEntryJSON =
      TelemetryAiActivityReader.toEntry({
        run: run({
          id: TRIAGE_RUN,
          runType: AIRunType.Investigation,
          status: AIRunStatus.Completed,
          insightId: INSIGHT_A,
        }),
        problem: slow,
      });

    expect(investigation.insight).toEqual({
      id: INSIGHT_A,
      title: "GET /orders is slow",
      serviceName: "checkout",
      type: AIInsightType.TraceSlowOperation,
    });
    expect(investigation.classification).toBe("code-fault");

    const pullRequestEntry: TelemetryAiLogEntryJSON =
      TelemetryAiActivityReader.toEntry({
        run: run({
          id: TASK_RUN,
          runType: AIRunType.CodeFix,
          status: AIRunStatus.Completed,
          insightId: INSIGHT_A,
        }),
        problem: slow,
      });

    expect(pullRequestEntry.insight.type).toBe(
      AIInsightType.TraceSlowOperation,
    );
    // A pull request is no verdict, whatever its finding's.
    expect(pullRequestEntry.classification).toBeUndefined();

    // A finding read without its kind names none.
    expect(
      TelemetryAiActivityReader.toEntry({
        run: run({
          id: TRIAGE_RUN,
          runType: AIRunType.Investigation,
          status: AIRunStatus.Completed,
          insightId: INSIGHT_A,
        }),
        problem: problem(INSIGHT_A, "x"),
      }).insight.type,
    ).toBeUndefined();
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

  /*
   * A Code task stands as its newest turn (#9812): a fix that failed and
   * was asked again from Code is the newer turn's, whatever its first said.
   */
  test.each([
    [AIRunStatus.Queued, false, TelemetryAiLogState.Waiting],
    [AIRunStatus.Running, false, TelemetryAiLogState.Working],
    [AIRunStatus.Completed, false, TelemetryAiLogState.Done],
    [AIRunStatus.Completed, true, TelemetryAiLogState.WaitingForYou],
    [AIRunStatus.NoFixFound, false, TelemetryAiLogState.NothingToChange],
    [AIRunStatus.Cancelled, false, TelemetryAiLogState.Stopped],
    [AIRunStatus.Error, false, TelemetryAiLogState.Failed],
  ])(
    "a failed task whose newest turn is %s (needs input: %s) reads as %s",
    (
      status: AIRunStatus,
      needsUserInput: boolean,
      state: TelemetryAiLogState,
    ) => {
      const entry: TelemetryAiLogEntryJSON = TelemetryAiActivityReader.toEntry({
        run: run({
          id: TASK_RUN,
          runType: AIRunType.CodeFix,
          status: AIRunStatus.Error,
          insightId: INSIGHT_A,
        }),
        latestTurn: laterTurn({
          id: ASKED_AGAIN_TURN,
          taskId: TASK_RUN,
          status,
          needsUserInput,
        }),
        problem: problem(INSIGHT_A, "slow"),
      });

      expect(entry.state).toBe(state);
      // One row per task: still named, and dated, by its first turn.
      expect(entry.runId).toBe(TASK_RUN);
      expect(entry.taskId).toBe(TASK_RUN);
      expect(entry.at).toBe("2026-10-24T09:00:00.000Z");
    },
  );

  test("a task done on its first turn reads as done whatever an older read said", () => {
    expect(
      TelemetryAiActivityReader.toEntry({
        run: run({
          id: TASK_RUN,
          runType: AIRunType.CodeFix,
          status: AIRunStatus.Completed,
          insightId: INSIGHT_A,
        }),
        problem: problem(INSIGHT_A, "slow"),
      }).state,
    ).toBe(TelemetryAiLogState.Done);
  });

  test("an investigation is never stated by a turn: it has none", () => {
    const entry: TelemetryAiLogEntryJSON = TelemetryAiActivityReader.toEntry({
      run: run({
        id: TRIAGE_RUN,
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
        insightId: INSIGHT_A,
      }),
      latestTurn: laterTurn({
        id: ASKED_AGAIN_TURN,
        taskId: TRIAGE_RUN,
        status: AIRunStatus.Error,
      }),
      problem: problem(INSIGHT_A, "slow"),
    });

    expect(entry.state).toBe(TelemetryAiLogState.Done);
    expect(entry.classification).toBe("Actionable");
  });

  test("a pull request recorded without a state reads as open, as Code reads it", () => {
    const stateless: AIAgentTaskPullRequest = pullRequest(ASKED_AGAIN_TURN);
    stateless.pullRequestState = undefined;

    const entry: TelemetryAiLogEntryJSON = TelemetryAiActivityReader.toEntry({
      run: run({
        id: TASK_RUN,
        runType: AIRunType.CodeFix,
        status: AIRunStatus.Completed,
        insightId: INSIGHT_A,
        repositoryId: REPO_ID,
      }),
      problem: problem(INSIGHT_A, "slow"),
      repository: repositoryRow(REPO_ID, "acme/shop"),
      pullRequest: stateless,
    });

    expect(entry.pullRequest).toEqual({
      state: PullRequestState.Open,
      number: 812,
      url: "https://github.com/acme/shop/pull/812",
    });
  });
});

describe("TelemetryAiActivityReader.readLogs", () => {
  let readProblems: SpyInstance<typeof AIInsightService.findBy>;
  let readRuns: SpyInstance<typeof AIRunService.findBy>;
  let countRuns: SpyInstance<typeof AIRunService.countBy>;
  let readRepositories: SpyInstance<typeof CodeRepositoryService.findBy>;
  let readReplies: SpyInstance<typeof CodeTaskListRows.readReplies>;
  let readPullRequests: SpyInstance<typeof CodeTaskListRows.readPullRequests>;
  let problems: Array<AIInsight>;
  let runs: Array<AIRun>;
  let readableRepositories: Array<CodeRepository> | Error;
  // Each task's newest later turn, and the pull request it shows, by task id.
  let replies: Map<string, CodeTaskRepliesRead>;
  let taskPullRequests: Map<string, AIAgentTaskPullRequest>;

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
    replies = new Map<string, CodeTaskRepliesRead>();
    taskPullRequests = new Map<string, AIAgentTaskPullRequest>([
      [TASK_RUN, pullRequest(TASK_RUN)],
      [PERSON_TASK_RUN, pullRequest(PERSON_TASK_RUN)],
    ]);
    readReplies = jest
      .spyOn(CodeTaskListRows, "readReplies")
      .mockImplementation(async () => {
        return replies;
      });
    readPullRequests = jest
      .spyOn(CodeTaskListRows, "readPullRequests")
      .mockImplementation(async () => {
        return taskPullRequests;
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
    // Each problem's kind is read, for the words its verdict is said in.
    expect(call["select"]).toEqual({
      _id: true,
      title: true,
      serviceName: true,
      classification: true,
      insightType: true,
    });
  });

  test("each entry names its problem's kind, as read", async () => {
    problems[0]!.insightType = AIInsightType.ProfileHotspot;

    const logs: TelemetryAiLogsJSON = await read();

    for (const entry of logs.entries) {
      expect(entry.insight.type).toBe(
        entry.insight.id === INSIGHT_A
          ? AIInsightType.ProfileHotspot
          : undefined,
      );
    }
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

    // Each task's turns are read by its first turn's id: never a triage's.
    for (const spy of [readPullRequests, readReplies]) {
      const call: { projectId: ObjectID; taskIds: Array<ObjectID> } = spy.mock
        .calls[0]![0] as { projectId: ObjectID; taskIds: Array<ObjectID> };

      expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(
        call.taskIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([TASK_RUN, PERSON_TASK_RUN]);
    }
  });

  /*
   * #9812: Try again on a fix OneUptime started asks it again as a later
   * turn of the same task. The log read only the first turn - a failed fix
   * stayed failed, with no pull request, while the fix asked again worked
   * and after it opened its pull request.
   */
  describe("a fix asked again from Code (#9812)", () => {
    beforeEach(() => {
      // The task's first turn failed, and wrote nothing.
      runs[0]!.status = AIRunStatus.Error;
      taskPullRequests.delete(TASK_RUN);
    });

    test("is working while the fix asked again works", async () => {
      replies.set(TASK_RUN, {
        count: 1,
        newest: laterTurn({
          id: ASKED_AGAIN_TURN,
          taskId: TASK_RUN,
          status: AIRunStatus.Running,
        }),
      });

      const task: TelemetryAiLogEntryJSON = (await read()).entries[0]!;

      expect(task.runId).toBe(TASK_RUN);
      expect(task.state).toBe(TelemetryAiLogState.Working);
      expect(task.pullRequest).toBeUndefined();
    });

    test("waits while the fix asked again waits for a Runner", async () => {
      replies.set(TASK_RUN, {
        count: 1,
        newest: laterTurn({
          id: ASKED_AGAIN_TURN,
          taskId: TASK_RUN,
          status: AIRunStatus.Queued,
        }),
      });

      expect((await read()).entries[0]!.state).toBe(
        TelemetryAiLogState.Waiting,
      );
    });

    test("is done, with the pull request the fix asked again opened", async () => {
      replies.set(TASK_RUN, {
        count: 1,
        newest: laterTurn({
          id: ASKED_AGAIN_TURN,
          taskId: TASK_RUN,
          status: AIRunStatus.Completed,
        }),
      });
      // Opened by the later turn: the task's pull request all the same.
      taskPullRequests.set(TASK_RUN, pullRequest(ASKED_AGAIN_TURN));

      const logs: TelemetryAiLogsJSON = await read();
      const task: TelemetryAiLogEntryJSON = logs.entries[0]!;

      expect(task.state).toBe(TelemetryAiLogState.Done);
      expect(task.taskId).toBe(TASK_RUN);
      expect(task.repositoryName).toBe("acme/shop");
      expect(task.pullRequest).toEqual({
        state: PullRequestState.Open,
        number: 812,
        url: "https://github.com/acme/shop/pull/812",
      });
      // Still one row for the task: the first turn's, where it was.
      expect(
        logs.entries.map((entry: TelemetryAiLogEntryJSON): string => {
          return entry.runId;
        }),
      ).toEqual([TASK_RUN, PERSON_TASK_RUN, TRIAGE_RUN]);
    });

    test("fails again when the fix asked again fails too", async () => {
      replies.set(TASK_RUN, {
        count: 1,
        newest: laterTurn({
          id: ASKED_AGAIN_TURN,
          taskId: TASK_RUN,
          status: AIRunStatus.Error,
        }),
      });

      const task: TelemetryAiLogEntryJSON = (await read()).entries[0]!;

      expect(task.state).toBe(TelemetryAiLogState.Failed);
      expect(task.pullRequest).toBeUndefined();
    });

    test("a task with no later turn reads as its first turn, as before", async () => {
      const logs: TelemetryAiLogsJSON = await read();

      expect(logs.entries[0]!.state).toBe(TelemetryAiLogState.Failed);
      expect(logs.entries[0]!.pullRequest).toBeUndefined();
      // The other task, done on its first turn, is done.
      expect(logs.entries[1]!.state).toBe(TelemetryAiLogState.Done);
    });

    test("a reply someone sent in Code stands for the task too", async () => {
      replies.set(TASK_RUN, {
        count: 3,
        newest: laterTurn({
          id: ASKED_AGAIN_TURN,
          taskId: TASK_RUN,
          status: AIRunStatus.Completed,
          needsUserInput: true,
        }),
      });

      expect((await read()).entries[0]!.state).toBe(
        TelemetryAiLogState.WaitingForYou,
      );
    });

    test("the pull request of a task in a repository the reader may not read is not named", async () => {
      readableRepositories = [];
      replies.set(TASK_RUN, {
        count: 1,
        newest: laterTurn({
          id: ASKED_AGAIN_TURN,
          taskId: TASK_RUN,
          status: AIRunStatus.Completed,
        }),
      });
      taskPullRequests.set(TASK_RUN, pullRequest(ASKED_AGAIN_TURN));

      const task: TelemetryAiLogEntryJSON = (await read()).entries[0]!;

      // How it stands is no secret of the repository's: its link is.
      expect(task.state).toBe(TelemetryAiLogState.Done);
      expect(task.repositoryName).toBeUndefined();
      expect(task.pullRequest).toBeUndefined();
    });
  });

  test("reads no turns when the page lists no task", async () => {
    runs = [runs[2]!];

    const logs: TelemetryAiLogsJSON = await read();

    expect(logs.entries).toHaveLength(1);
    for (const spy of [readPullRequests, readReplies]) {
      expect(
        (spy.mock.calls[0]![0] as { taskIds: Array<ObjectID> }).taskIds,
      ).toEqual([]);
    }
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
