import Semaphore, {
  SemaphoreMutex,
} from "../../../../../Server/Infrastructure/Semaphore";
import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIService from "../../../../../Server/Services/AIService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import CodeFixAutoRetry from "../../../../../Server/Utils/AI/CodeFix/CodeFixAutoRetry";
import CodeFixRunRepository from "../../../../../Server/Utils/AI/CodeFix/CodeFixRunRepository";
import FixRunBudget from "../../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import FixFromIncidentTaskTrigger from "../../../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import FixPerformanceTaskTrigger from "../../../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger";
import PostedRootCause from "../../../../../Server/Utils/AI/SRE/PostedRootCause";
import ProfileFixTaskTrigger from "../../../../../Server/Utils/AI/SRE/ProfileFixTaskTrigger";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import TelemetryImprovementTaskTrigger from "../../../../../Server/Utils/AI/SRE/TelemetryImprovementTaskTrigger";
import TelemetryAiFix from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiFix";
import TraceInsightFix, {
  TRACE_FIX_ALREADY_RUNNING_MESSAGE,
} from "../../../../../Server/Utils/AI/TelemetryAi/TraceInsightFix";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import Service from "../../../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import { TraceInsightEvidence } from "../../../../../Types/AI/AIInsightEvidence";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import { CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE } from "../../../../../Types/AI/CodeTaskTryAgain";
import { CodeTaskContextType } from "../../../../../Types/AI/CodeTask";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import FixTurnsTable, { FixTurnFacts, FixTurnRow } from "./FixTurnsTable";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONE FIX AT A TIME SEES A REPLY WORKING IN CODE (#9882).
 *
 * A Code task's later turn can be a reply someone sent in Code: it names
 * its task and carries none of what the task is a fix of. Every way into a
 * fix - an exception's Fix with AI, an investigation's fix of an incident
 * or an alert, a trace's performance fix, a service's logging or tracing,
 * an insight's fix, a profile's slow function, and Try again - refuses a
 * second fix while one of the same problem is on its way. Each is asked
 * here, against the same AI runs (FixTurnsTable), in the three cases the
 * issue names:
 *
 *   - the first turn failed and a reply is working in Code: refused, with
 *     what is on its way and where to follow it (each one's own words);
 *   - the first turn failed and its reply failed too: nothing is on its
 *     way, and the fix is started;
 *   - the first turn is still working: refused, as it always was.
 *
 * The runs answer every way a check has read them - the services' own
 * queries, and the one statement every check asks since - so the first
 * case of each failed before #9882: the reply carries no record, and no
 * check saw it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9882aaaa-0000-4000-8000-000000000001",
);
const EXCEPTION_ID: ObjectID = new ObjectID(
  "9882aaaa-0000-4000-8000-0000000000e1",
);
const SIMILAR_EXCEPTION_ID: ObjectID = new ObjectID(
  "9882aaaa-0000-4000-8000-0000000000e2",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "9882aaaa-0000-4000-8000-0000000000c1",
);
const ALERT_ID: ObjectID = new ObjectID("9882aaaa-0000-4000-8000-0000000000a1");
const INSIGHT_ID: ObjectID = new ObjectID(
  "9882aaaa-0000-4000-8000-0000000000d4",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "9882aaaa-0000-4000-8000-0000000000b1",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "9882aaaa-0000-4000-8000-0000000000f1",
);
const USER_ID: ObjectID = new ObjectID("9882aaaa-0000-4000-8000-0000000000aa");
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const ANALYSIS: string =
  "## Root cause\n\nThe pool is exhausted under load; size it to the workers.";

enum Case {
  ReplyWorking = "the first turn failed and a reply is working in Code",
  ReplyFailed = "the first turn failed and its reply failed too",
  FirstTurnWorking = "the first turn is still working",
}

const REFUSED_CASES: Array<Case> = [Case.ReplyWorking, Case.FirstTurnWorking];

let table: FixTurnsTable;
let created: Array<AIRun>;

/*
 * A fix of the problem `facts` names, as the case has it: a task whose
 * first turn failed with a reply working or failed, or a first turn still
 * working. Returns the task.
 */
function seed(facts: FixTurnFacts, which: Case): FixTurnRow {
  if (which === Case.FirstTurnWorking) {
    return table.addFirstTurn({ ...facts, status: AIRunStatus.Running });
  }

  const task: FixTurnRow = table.addFirstTurn({
    ...facts,
    status: AIRunStatus.Error,
  });

  table.addReply(
    task,
    which === Case.ReplyWorking ? AIRunStatus.Running : AIRunStatus.Error,
  );

  return task;
}

async function refusalOf(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the second fix to be refused.");
}

beforeEach(() => {
  table = new FixTurnsTable(PROJECT_ID);
  table.install();
  created = [];

  jest.spyOn(AIRunService, "create").mockImplementation((async (data: {
    data: AIRun;
  }): Promise<AIRun> => {
    data.data.id = ObjectID.generate();
    created.push(data.data);
    return data.data;
  }) as never);

  jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ release: jest.fn() } as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue();
  jest.spyOn(CodeFixRunRepository, "resolveForNewRun").mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an exception's Fix with AI", () => {
  const exceptionFix: FixTurnFacts = {
    codeFixTaskType: CodeFixTaskType.FixException,
    status: AIRunStatus.Error,
    telemetryExceptionId: EXCEPTION_ID,
  };

  function exception(
    id: ObjectID,
    message: string = "Pool exhausted for tenant 0b9c6f4e-2d1a-4c3b-8e5f-6a7b8c9d0e1f",
  ): TelemetryException {
    const value: TelemetryException = new TelemetryException();
    value.id = id;
    value.projectId = PROJECT_ID;
    value.message = message;
    value.exceptionType = "PoolError";
    value.isResolved = false;
    value.isArchived = false;
    return value;
  }

  beforeEach(() => {
    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(exception(EXCEPTION_ID));
    jest
      .spyOn(
        TelemetryExceptionService as unknown as {
          getAIFixReadinessAndRepository: () => Promise<unknown>;
        },
        "getAIFixReadinessAndRepository",
      )
      .mockResolvedValue({
        readiness: { ready: true, checks: [] },
        codeRepositoryId: REPOSITORY_ID,
      });
    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([]);
    /*
     * The exceptions a similar one is compared with: the one on its way,
     * whose message differs only in its value.
     */
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        exception(
          SIMILAR_EXCEPTION_ID,
          "Pool exhausted for tenant 5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a",
        ),
      ]);
  });

  async function fixWithAi(): Promise<AIRun> {
    return await TelemetryExceptionService.createCodeFixRunForException({
      telemetryExceptionId: EXCEPTION_ID,
      props: { isRoot: true },
      taskType: CodeFixTaskType.FixException,
    });
  }

  test.each(REFUSED_CASES)(
    "%s: refused, nothing queued",
    async (which: Case) => {
      seed(exceptionFix, which);

      expect(await refusalOf(fixWithAi)).toBe(
        "OneUptime AI is already fixing this exception. Follow it in Code.",
      );
      expect(created).toHaveLength(0);
    },
  );

  test(`${Case.ReplyFailed}: the fix is queued`, async () => {
    seed(exceptionFix, Case.ReplyFailed);

    await fixWithAi();

    expect(created).toHaveLength(1);
    expect(created[0]!.triggeredByTelemetryExceptionId?.toString()).toBe(
      EXCEPTION_ID.toString(),
    );
  });

  test("a reply working on a fix of the exception's other recipe does not hold this one", async () => {
    seed(
      { ...exceptionFix, codeFixTaskType: CodeFixTaskType.WriteRegressionTest },
      Case.ReplyWorking,
    );

    await fixWithAi();

    expect(created).toHaveLength(1);
  });

  test("a reply working on a fix of a similar exception - one root cause - refuses it too", async () => {
    seed(
      { ...exceptionFix, telemetryExceptionId: SIMILAR_EXCEPTION_ID },
      Case.ReplyWorking,
    );

    expect(await refusalOf(fixWithAi)).toContain(
      `A similar exception (same type and normalized message, exception ${SIMILAR_EXCEPTION_ID.toString()}) already has an AI agent task in progress or an open AI pull request.`,
    );
    expect(created).toHaveLength(0);
  });

  test("a pull request a reply opened, still open, is the task's: a similar exception is not fixed again", async () => {
    const task: FixTurnRow = seed(
      { ...exceptionFix, telemetryExceptionId: SIMILAR_EXCEPTION_ID },
      Case.ReplyFailed,
    );
    const reply: FixTurnRow = table.addReply(task, AIRunStatus.Completed);

    jest.spyOn(AIAgentTaskPullRequestService, "findBy").mockResolvedValue([
      {
        aiRunId: new ObjectID(reply._id),
        pullRequestState: PullRequestState.Open,
      } as never,
    ]);

    expect(await refusalOf(fixWithAi)).toContain("A similar exception");
    expect(created).toHaveLength(0);
  });
});

describe.each([
  ["an incident", { incidentId: INCIDENT_ID }, "incident"],
  ["an alert", { alertId: ALERT_ID }, "alert"],
])(
  "%s's fix from its investigation",
  (
    _name: string,
    subject: { incidentId?: ObjectID; alertId?: ObjectID },
    label: string,
  ) => {
    let investigation: FixTurnRow;

    beforeEach(() => {
      investigation = table.addRecommendingInvestigation({
        ...subject,
        analysisMarkdown: ANALYSIS,
        completedAt: new Date("2026-11-19T07:00:00.000Z"),
      });

      jest
        .spyOn(PostedRootCause, "getForInvestigation")
        .mockResolvedValue(ANALYSIS);
      jest
        .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
        .mockResolvedValue(true);
    });

    function subjectFix(): FixTurnFacts {
      return {
        codeFixTaskType: CodeFixTaskType.FixFromIncident,
        status: AIRunStatus.Error,
        ...subject,
        taskContext: {
          sourceInvestigationRunId: investigation._id,
          sourceInvestigationAnalysisMarkdown: ANALYSIS,
        },
      };
    }

    async function openFixPullRequest(): Promise<AIRun> {
      return await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
        projectId: PROJECT_ID,
        investigationRunId: new ObjectID(investigation._id),
        userId: USER_ID,
        ...subject,
      });
    }

    test.each(REFUSED_CASES)(
      "%s: refused, nothing queued",
      async (which: Case) => {
        seed(subjectFix(), which);

        expect(await refusalOf(openFixPullRequest)).toBe(
          `A fix pull request task is already queued or running for this ${label}. Track its progress in Code.`,
        );
        expect(created).toHaveLength(0);
      },
    );

    test(`${Case.ReplyFailed}: the fix is queued`, async () => {
      seed(subjectFix(), Case.ReplyFailed);

      await openFixPullRequest();

      expect(created).toHaveLength(1);
      expect(created[0]!.codeFixTaskType).toBe(CodeFixTaskType.FixFromIncident);
    });

    test("the card's Remediation step says it is on its way, and offers no second fix", async () => {
      const task: FixTurnRow = seed(subjectFix(), Case.ReplyWorking);

      const run: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalRunForSubject({
          projectId: PROJECT_ID,
          taskType: CodeFixTaskType.FixFromIncident,
          ...subject,
        });

      expect(SubjectCodeFixRun.taskIdOf(run)?.toString()).toBe(task._id);
    });
  },
);

describe("a trace's performance fix", () => {
  function finding(): PerformanceFinding {
    return {
      findingType: PerformanceFindingType.NPlusOneQuery,
      headline: 'N+1: 12× "SELECT users"',
      evidence: "12 near-identical sibling spans under one parent",
      spanCount: 12,
      combinedDurationMs: 480,
      traceDurationMs: 600,
      percentOfTrace: 80,
      normalizedSpanName: "SELECT users",
      implicatedSpans: [{ spanId: "s1", name: "SELECT users", durationMs: 40 }],
    };
  }

  const traceFix: FixTurnFacts = {
    codeFixTaskType: CodeFixTaskType.FixPerformance,
    status: AIRunStatus.Error,
    taskContext: { traceId: TRACE_ID, serviceName: "checkout" },
  };

  beforeEach(() => {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
  });

  async function fixPerformance(): Promise<AIRun> {
    return await FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings(
      {
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        findings: [finding()],
        codeLocations: [],
      },
    );
  }

  test.each(REFUSED_CASES)(
    "%s: refused, nothing queued",
    async (which: Case) => {
      seed(traceFix, which);

      expect(await refusalOf(fixPerformance)).toBe(
        "A performance fix task is already queued or running for this trace. Track its progress in Code.",
      );
      expect(created).toHaveLength(0);
    },
  );

  test(`${Case.ReplyFailed}: the fix is queued`, async () => {
    seed(traceFix, Case.ReplyFailed);

    await fixPerformance();

    expect(created).toHaveLength(1);
    expect(created[0]!.taskContext?.traceId).toBe(TRACE_ID);
  });

  test("a reply working on another trace's fix does not hold this one", async () => {
    seed(
      { ...traceFix, taskContext: { traceId: "another-trace" } },
      Case.ReplyWorking,
    );

    await fixPerformance();

    expect(created).toHaveLength(1);
  });
});

describe.each([CodeFixTaskType.ImproveLogging, CodeFixTaskType.ImproveTracing])(
  "a service's %s",
  (recipe: CodeFixTaskType) => {
    const serviceFix: FixTurnFacts = {
      codeFixTaskType: recipe,
      status: AIRunStatus.Error,
      taskContext: {
        telemetryServiceId: SERVICE_ID.toString(),
        serviceName: "checkout",
      },
    };

    beforeEach(() => {
      const service: Service = new Service();
      service.id = SERVICE_ID;
      service.projectId = PROJECT_ID;
      service.name = "checkout";

      jest.spyOn(ServiceService, "findOneById").mockResolvedValue(service);
      jest
        .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
        .mockResolvedValue(true);
      jest
        .spyOn(TelemetryImprovementTaskTrigger, "checkStart")
        .mockResolvedValue({ blocker: null, codeRepositoryId: REPOSITORY_ID });
    });

    async function improve(): Promise<AIRun> {
      return await TelemetryImprovementTaskTrigger.createTelemetryImprovementTask(
        {
          projectId: PROJECT_ID,
          telemetryServiceId: SERVICE_ID,
          taskType: recipe,
          userId: USER_ID,
        },
      );
    }

    test.each(REFUSED_CASES)(
      "%s: refused, nothing queued",
      async (which: Case) => {
        seed(serviceFix, which);

        expect(await refusalOf(improve)).toBe(
          `An ${
            recipe === CodeFixTaskType.ImproveLogging
              ? "improve-logging"
              : "improve-tracing"
          } task is already queued or running for this service. Track its progress in Code.`,
        );
        expect(created).toHaveLength(0);
      },
    );

    test(`${Case.ReplyFailed}: the improvement is queued`, async () => {
      seed(serviceFix, Case.ReplyFailed);

      await improve();

      expect(created).toHaveLength(1);
      expect(created[0]!.codeFixTaskType).toBe(recipe);
    });
  },
);

describe("an insight's fix", () => {
  const SLOW: TraceInsightEvidence = {
    serviceId: SERVICE_ID.toString(),
    kind: "Slow",
    operationName: "GET /orders",
    windowStartTime: "2026-11-19T06:00:00.000Z",
    windowEndTime: "2026-11-19T07:00:00.000Z",
    spanCount: 1234,
    p50Ms: 180,
    p99Ms: 2400,
    sampleTraceId: TRACE_ID,
    sampleSpanId: "root",
    sampleDurationMs: 2000,
    performanceFindings: [],
    codeLocations: [],
  } as unknown as TraceInsightEvidence;

  // OneUptime opened the finding's fix itself, as a request in Code.
  const insightFix: FixTurnFacts = {
    codeFixTaskType: CodeFixTaskType.CodeRequest,
    status: AIRunStatus.Error,
    aiInsightId: INSIGHT_ID,
    taskContext: {
      request: { message: "Make GET /orders faster.", context: [] },
    } as JSONObject,
  };

  beforeEach(() => {
    const insight: AIInsight = new AIInsight();
    insight.id = INSIGHT_ID;
    insight.projectId = PROJECT_ID;
    insight.insightType = AIInsightType.TraceSlowOperation;
    insight.status = AIInsightStatus.ActionRequired;
    insight.serviceName = "checkout";
    insight.evidence = { trace: SLOW };

    const repository: CodeRepository = new CodeRepository();
    repository.id = REPOSITORY_ID;
    repository.name = "checkout";

    jest.spyOn(AIInsightService, "findOneBy").mockResolvedValue(insight);
    jest.spyOn(AIInsightService, "updateOneBy").mockResolvedValue(1);
    jest.spyOn(TraceInsightFix, "getAskableRepositories").mockResolvedValue([
      {
        id: REPOSITORY_ID.toString(),
        name: "checkout",
      } as never,
    ]);
    jest
      .spyOn(TraceInsightFix, "resolveRepository")
      .mockResolvedValue(REPOSITORY_ID.toString());
    jest.spyOn(TraceInsightFix, "buildContext").mockResolvedValue([]);
    jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockResolvedValue(repository);
    jest.spyOn(CodeTaskGate, "getBlocker").mockResolvedValue(null);
  });

  async function fixFinding(): Promise<{ taskId: string }> {
    return await TraceInsightFix.createFixTask({
      projectId: PROJECT_ID,
      insightId: INSIGHT_ID,
      userId: USER_ID,
      props: { userId: USER_ID, tenantId: PROJECT_ID },
    });
  }

  test.each(REFUSED_CASES)(
    "%s: refused, nothing started",
    async (which: Case) => {
      seed(insightFix, which);

      expect(await refusalOf(fixFinding)).toBe(
        TRACE_FIX_ALREADY_RUNNING_MESSAGE,
      );
      expect(created).toHaveLength(0);
    },
  );

  test(`${Case.ReplyFailed}: the fix is started`, async () => {
    seed(insightFix, Case.ReplyFailed);

    await fixFinding();

    expect(created).toHaveLength(1);
    expect(created[0]!.triggeredByAiInsightId?.toString()).toBe(
      INSIGHT_ID.toString(),
    );
  });

  test("the task the finding links to is the one the reply works in", async () => {
    const task: FixTurnRow = seed(insightFix, Case.ReplyWorking);

    expect(
      await TelemetryAiFix.findActiveTaskIdForInsight({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
      }),
    ).toBe(task._id);
  });
});

describe("a profile's slow function", () => {
  const profileContext: JSONObject = {
    type: CodeTaskContextType.Profile,
    label: "Profile: listOrders in checkout",
    serviceId: SERVICE_ID.toString(),
    functionName: "listOrders",
    fileName: "src/orders/list.ts",
  };

  const profileFix: FixTurnFacts = {
    codeFixTaskType: CodeFixTaskType.CodeRequest,
    status: AIRunStatus.Error,
    taskContext: {
      request: {
        message: "Make listOrders lighter.",
        context: [profileContext],
      },
    } as JSONObject,
  };

  async function findActive(): Promise<string | null> {
    return await ProfileFixTaskTrigger.findActiveTaskId({
      projectId: PROJECT_ID,
      serviceId: SERVICE_ID,
      functionName: "listOrders",
      fileName: "src/orders/list.ts",
    });
  }

  test.each(REFUSED_CASES)(
    "%s: the function's fix is on its way",
    async (which: Case) => {
      const task: FixTurnRow = seed(profileFix, which);

      expect(await findActive()).toBe(task._id);
    },
  );

  test(`${Case.ReplyFailed}: nothing is on its way`, async () => {
    seed(profileFix, Case.ReplyFailed);

    expect(await findActive()).toBeNull();
  });
});

describe("Try again on a fix whose other task's reply is working", () => {
  const exceptionFix: FixTurnFacts = {
    codeFixTaskType: CodeFixTaskType.FixException,
    status: AIRunStatus.Error,
    telemetryExceptionId: EXCEPTION_ID,
  };

  beforeEach(() => {
    const open: TelemetryException = new TelemetryException();
    open.id = EXCEPTION_ID;
    open.isResolved = false;
    open.isArchived = false;

    jest.spyOn(TelemetryExceptionService, "findOneBy").mockResolvedValue(open);
    jest.spyOn(CodeFixAutoRetry, "mayHaveWritten").mockResolvedValue(false);
  });

  // The fix of the same exception that failed, which a person asks again.
  async function tryAgain(): Promise<AIRun> {
    const failed: FixTurnRow = table.addFirstTurn(exceptionFix);
    const task: AIRun = table.find({ _id: failed._id })[0]!;
    task.codeRepositoryId = REPOSITORY_ID;

    return await CodeTaskRuns.retry({
      projectId: PROJECT_ID,
      userId: USER_ID,
      task,
    });
  }

  test.each(REFUSED_CASES)(
    "%s: refused, nothing queued",
    async (which: Case) => {
      seed(exceptionFix, which);

      expect(await refusalOf(tryAgain)).toBe(
        CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE,
      );
      expect(created).toHaveLength(0);
    },
  );

  test(`${Case.ReplyFailed}: the fix is asked again`, async () => {
    seed(exceptionFix, Case.ReplyFailed);

    await tryAgain();

    expect(created).toHaveLength(1);
    expect(created[0]!.codeTaskId).toBeDefined();
  });
});
