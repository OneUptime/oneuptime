import Semaphore, {
  SemaphoreMutex,
} from "../../../../../Server/Infrastructure/Semaphore";
import AIRunService from "../../../../../Server/Services/AIRunService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import CodeFixAutoRetry from "../../../../../Server/Utils/AI/CodeFix/CodeFixAutoRetry";
import FixRunBudget from "../../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeTaskFixRetry, {
  CODE_TASK_FIX_TURN_SELECT,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskFixRetry";
import CodeTaskRuns, {
  CODE_TASK_BUSY_MESSAGE,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import InvestigationSubjectLock from "../../../../../Server/Utils/AI/SRE/InvestigationSubjectLock";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  CODE_TASK_TRY_AGAIN_EXCEPTION_ARCHIVED_MESSAGE,
  CODE_TASK_TRY_AGAIN_EXCEPTION_GONE_MESSAGE,
  CODE_TASK_TRY_AGAIN_EXCEPTION_RESOLVED_MESSAGE,
  CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE,
  CODE_TASK_TRY_AGAIN_INVESTIGATION_MOVED_MESSAGE,
  CODE_TASK_TRY_AGAIN_MAY_HAVE_WRITTEN_MESSAGE,
  CODE_TASK_TRY_AGAIN_NOT_IN_CODE_MESSAGE,
} from "../../../../../Types/AI/CodeTaskTryAgain";
import BadDataException from "../../../../../Types/Exception/BadDataException";
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
 * TRY AGAIN ON A FIX ONEUPTIME STARTED (#6509).
 *
 * A failed or stopped fix - an exception's, an investigation's fix pull
 * request, a trace's, a service's, an insight's - is asked again as a new
 * turn of its task, carrying everything its turn carried, so it is read by
 * the same readers and worked the same way. It is refused, with why, when
 * it may already have written (it would open a second pull request), when
 * another fix of the same problem is on its way, when its exception is no
 * longer open, or when its investigation is no longer the latest - and it
 * counts against its incident's or alert's daily fix-task limit like any
 * new fix. A task takes one turn at a time.
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
const ALERT_ID: ObjectID = new ObjectID("0d4e5f6a-7b8c-4d9e-8f0a-2b3c4d5e6f7a");
const INSIGHT_ID: ObjectID = new ObjectID(
  "1e5f6a7b-8c9d-4e0f-9a1b-3c4d5e6f7a8b",
);
const PROVIDER_ID: ObjectID = new ObjectID(
  "2f6a7b8c-9d0e-4f1a-8b2c-4d5e6f7a8b9c",
);
const CARRIED_INCIDENT: string = "3a7b8c9d-0e1f-4a2b-9c3d-5e6f7a8b9c0d";

interface World {
  // The task's first turn: a fix OneUptime started.
  task: AIRun;
  // Its newest reply, if any (getLatestTurn), read once before the lock and once in it.
  latestReplies: Array<AIRun | null>;
  mayHaveWritten: boolean;
  exception: TelemetryException | null;
  otherExceptionFix: AIRun | null;
  otherSubjectFix: AIRun | null;
  otherTraceFix: AIRun | null;
  otherServiceFix: AIRun | null;
}

let world: World;
let created: Array<AIRun>;
const mutex: SemaphoreMutex = {
  release: jest.fn(),
} as unknown as SemaphoreMutex;

function fixRun(
  recipe: CodeFixTaskType,
  data: { id?: ObjectID; status?: AIRunStatus; codeTaskId?: ObjectID } = {},
): AIRun {
  const run: AIRun = new AIRun();
  run._id = (data.id || TASK_ID).toString();
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.CodeFix;
  run.codeFixTaskType = recipe;
  run.codeRepositoryId = REPOSITORY_ID;
  run.status = data.status || AIRunStatus.Error;
  run.errorMessage = "The Runner went away.";
  run.llmProviderId = PROVIDER_ID;
  run.triggeredByAiInsightId = INSIGHT_ID;
  run.carriedIncidentIds = [CARRIED_INCIDENT];
  run.carriedAlertIds = [];

  if (data.codeTaskId) {
    run.codeTaskId = data.codeTaskId;
  }

  switch (recipe) {
    case CodeFixTaskType.FixFromIncident:
    case CodeFixTaskType.ImproveInstrumentation:
      run.triggeredByIncidentId = INCIDENT_ID;
      run.taskContext = {
        investigationRunId: "4b8c9d0e-1f2a-4b3c-8d4e-6f7a8b9c0d1e",
        investigationAnalysisMarkdown: "The pool is exhausted.",
      } as never;
      break;
    case CodeFixTaskType.FixPerformance:
      run.taskContext = {
        traceId: "trace-1",
        serviceName: "checkout",
        performanceFindings: [{ headline: "N+1 queries" }],
      } as never;
      break;
    case CodeFixTaskType.ImproveLogging:
    case CodeFixTaskType.ImproveTracing:
      run.taskContext = {
        telemetryServiceId: "5c9d0e1f-2a3b-4c4d-9e5f-7a8b9c0d1e2f",
        telemetryServiceName: "checkout",
      } as never;
      break;
    default:
      run.triggeredByTelemetryExceptionId = EXCEPTION_ID;
  }

  return run;
}

function openException(): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  exception._id = EXCEPTION_ID.toString();
  exception.isResolved = false;
  exception.isArchived = false;
  return exception;
}

async function retry(): Promise<AIRun> {
  return await CodeTaskRuns.retry({
    projectId: PROJECT_ID,
    userId: USER_ID,
    task: world.task,
  });
}

async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal.");
}

beforeEach(() => {
  created = [];
  world = {
    task: fixRun(CodeFixTaskType.FixException),
    latestReplies: [],
    mayHaveWritten: false,
    exception: openException(),
    otherExceptionFix: null,
    otherSubjectFix: null,
    otherTraceFix: null,
    otherServiceFix: null,
  };

  let latestReads: number = 0;

  jest
    .spyOn(AIRunService, "findOneBy")
    .mockImplementation(async (data: { query: Record<string, unknown> }) => {
      const query: Record<string, unknown> = data.query;

      // The task's newest reply (CodeTaskRuns.getLatestTurn).
      if (query["codeTaskId"] && !query["_id"]) {
        const reads: Array<AIRun | null> = world.latestReplies;
        const reply: AIRun | null =
          reads[Math.min(latestReads, reads.length - 1)] || null;
        latestReads++;
        return reply;
      }

      // A turn read by its id: the task's own, or a reply.
      if (query["_id"]) {
        const id: string = String(query["_id"]).toLowerCase();

        if (id === TASK_ID.toString()) {
          return world.task;
        }

        return (
          world.latestReplies.find((reply: AIRun | null): boolean => {
            return reply?.id?.toString() === id;
          }) || null
        );
      }

      // Another fix of the exception on its way.
      if (query["triggeredByTelemetryExceptionId"]) {
        return world.otherExceptionFix;
      }

      return null;
    });
  jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
    return world.task;
  });
  jest
    .spyOn(AIRunService, "create")
    .mockImplementation(async (data: { data: AIRun }): Promise<AIRun> => {
      created.push(data.data);
      data.data._id = ObjectID.generate().toString();
      return data.data;
    });

  jest
    .spyOn(CodeFixAutoRetry, "mayHaveWritten")
    .mockImplementation(async () => {
      return world.mayHaveWritten;
    });
  jest
    .spyOn(TelemetryExceptionService, "findOneBy")
    .mockImplementation(async () => {
      return world.exception;
    });
  jest
    .spyOn(SubjectCodeFixRun, "findNonTerminalRunForSubject")
    .mockImplementation(async () => {
      return world.otherSubjectFix;
    });
  jest
    .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
    .mockImplementation(async () => {
      return world.otherTraceFix;
    });
  jest
    .spyOn(SubjectCodeFixRun, "findNonTerminalRunForTelemetryService")
    .mockImplementation(async () => {
      return world.otherServiceFix;
    });
  jest
    .spyOn(SubjectCodeFixRun, "assertLatestRecommendedInvestigationSource")
    .mockResolvedValue(undefined);
  jest
    .spyOn(InvestigationSubjectLock, "runExclusive")
    .mockImplementation(
      async <T>(_data: unknown, operation: () => Promise<T>): Promise<T> => {
        return await operation();
      },
    );
  jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue(undefined);
  jest.spyOn(Semaphore, "lock").mockResolvedValue(mutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a failed fix OneUptime started is asked again as a new turn of its task", () => {
  test("an exception's fix: its recipe, the exception, the insight, the LLM provider, the repository and what it carries - asked by the person, queued", async () => {
    await retry();

    expect(created).toHaveLength(1);

    const turn: AIRun = created[0]!;

    expect(turn.codeTaskId?.toString()).toBe(TASK_ID.toString());
    expect(turn.codeFixTaskType).toBe(CodeFixTaskType.FixException);
    expect(turn.runType).toBe(AIRunType.CodeFix);
    expect(turn.status).toBe(AIRunStatus.Queued);
    expect(turn.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(turn.userId?.toString()).toBe(USER_ID.toString());
    expect(turn.codeRepositoryId?.toString()).toBe(REPOSITORY_ID.toString());
    expect(turn.triggeredByTelemetryExceptionId?.toString()).toBe(
      EXCEPTION_ID.toString(),
    );
    expect(turn.triggeredByAiInsightId?.toString()).toBe(INSIGHT_ID.toString());
    expect(turn.llmProviderId?.toString()).toBe(PROVIDER_ID.toString());
    // Read by the readers the first turn is read by (#9186).
    expect(turn.carriedIncidentIds).toEqual([CARRIED_INCIDENT]);
    // A turn of the task: no title, no error, no time of its own yet.
    expect(turn.title).toBeUndefined();
    expect(turn.errorMessage).toBeUndefined();
    expect(turn.completedAt).toBeUndefined();
  });

  test.each([
    [AIRunStatus.Error, "failed"],
    [AIRunStatus.Stale, "failed for good after its attempts"],
    [AIRunStatus.Cancelled, "was stopped"],
  ])("one whose turn %s (%s) is asked again", async (status: AIRunStatus) => {
    world.task.status = status;

    await retry();

    expect(created).toHaveLength(1);
  });

  test.each([
    CodeFixTaskType.WriteRegressionTest,
    CodeFixTaskType.ImproveExceptionHandling,
    CodeFixTaskType.ImproveInstrumentation,
    CodeFixTaskType.FixPerformance,
    CodeFixTaskType.ImproveLogging,
    CodeFixTaskType.ImproveTracing,
    CodeFixTaskType.FixFromIncident,
  ])(
    "a %s fix is asked again with the context it started with - a copy, never the same object",
    async (recipe: CodeFixTaskType) => {
      world.task = fixRun(recipe);

      await retry();

      const turn: AIRun = created[0]!;

      expect(turn.codeFixTaskType).toBe(recipe);
      expect(turn.taskContext).toEqual(world.task.taskContext);

      // An exception's fix reads its exception, not a context of its own.
      if (world.task.taskContext) {
        expect(turn.taskContext).not.toBe(world.task.taskContext);
      }
      expect(turn.triggeredByIncidentId?.toString()).toBe(
        world.task.triggeredByIncidentId?.toString(),
      );
      expect(turn.triggeredByTelemetryExceptionId?.toString()).toBe(
        world.task.triggeredByTelemetryExceptionId?.toString(),
      );
    },
  );

  test("an alert's investigation fix keeps its alert, and only it", async () => {
    world.task = fixRun(CodeFixTaskType.FixFromIncident);
    delete world.task.triggeredByIncidentId;
    world.task.triggeredByAlertId = ALERT_ID;

    await retry();

    expect(created[0]!.triggeredByAlertId?.toString()).toBe(
      ALERT_ID.toString(),
    );
    expect(created[0]!.triggeredByIncidentId).toBeUndefined();
  });

  test("a fix asked again before is asked again from its newest turn", async () => {
    world.task.status = AIRunStatus.Error;
    const again: AIRun = fixRun(CodeFixTaskType.FixException, {
      id: REPLY_ID,
      codeTaskId: TASK_ID,
    });
    again.llmProviderId = new ObjectID("6d0e1f2a-3b4c-4d5e-8f6a-8b9c0d1e2f3a");
    world.latestReplies = [again];

    await retry();

    expect(created).toHaveLength(1);
    expect(created[0]!.codeTaskId?.toString()).toBe(TASK_ID.toString());
    expect(created[0]!.llmProviderId?.toString()).toBe(
      again.llmProviderId.toString(),
    );
    // It was asked of the turn read by its id, with everything it carries.
    const turnReads: Array<{
      query: Record<string, unknown>;
      select: unknown;
    }> = (AIRunService.findOneBy as unknown as jest.Mock).mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          query: Record<string, unknown>;
          select: unknown;
        };
      })
      .filter((read: { query: Record<string, unknown> }) => {
        return String(read.query["_id"]) === REPLY_ID.toString();
      });

    expect(turnReads).toHaveLength(1);
    expect(turnReads[0]!.select).toBe(CODE_TASK_FIX_TURN_SELECT);
  });

  test("its incident's daily fix-task limit is in force: the new turn counts in the incident's lane", async () => {
    world.task = fixRun(CodeFixTaskType.FixFromIncident);

    await retry();

    expect(FixRunBudget.assertWithinBudget).toHaveBeenCalledWith(PROJECT_ID, {
      incidentId: INCIDENT_ID,
      alertId: undefined,
    });
  });

  test("a project at its daily fix-task limit is refused in the limit's words, and nothing is queued", async () => {
    world.task = fixRun(CodeFixTaskType.FixFromIncident);
    (FixRunBudget.assertWithinBudget as unknown as jest.Mock).mockRejectedValue(
      new BadDataException(
        "The project's daily incident AI fix task limit has been reached.",
      ) as never,
    );

    expect(await refusal(retry)).toBe(
      "The project's daily incident AI fix task limit has been reached.",
    );
    expect(created).toHaveLength(0);
  });

  test("an investigation's fix is asked again under the lock its creation takes, from the same investigation", async () => {
    world.task = fixRun(CodeFixTaskType.FixFromIncident);

    await retry();

    expect(InvestigationSubjectLock.runExclusive).toHaveBeenCalledTimes(1);
    expect(
      (InvestigationSubjectLock.runExclusive as unknown as jest.Mock).mock
        .calls[0]![0],
    ).toEqual({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertId: undefined,
    });
    expect(
      SubjectCodeFixRun.assertLatestRecommendedInvestigationSource,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: INCIDENT_ID,
        taskContext: world.task.taskContext,
      }),
    );
    expect(created).toHaveLength(1);
  });

  test("negative control: a fix of an exception takes no investigation's lock", async () => {
    await retry();

    expect(InvestigationSubjectLock.runExclusive).not.toHaveBeenCalled();
    expect(
      SubjectCodeFixRun.assertLatestRecommendedInvestigationSource,
    ).not.toHaveBeenCalled();
  });
});

describe("a fix that is not asked again says why", () => {
  test("one that may already have pushed or opened a pull request - asked as for a Runner gone, so the task's pull requests count", async () => {
    world.mayHaveWritten = true;

    expect(await refusal(retry)).toBe(
      CODE_TASK_TRY_AGAIN_MAY_HAVE_WRITTEN_MESSAGE,
    );
    expect(created).toHaveLength(0);
    expect(CodeFixAutoRetry.mayHaveWritten).toHaveBeenCalledWith(
      expect.objectContaining({ isRunnerGone: true }),
    );
  });

  test.each([
    [
      "the exception",
      CodeFixTaskType.FixException,
      (): void => {
        world.otherExceptionFix = new AIRun();
      },
    ],
    [
      "the incident",
      CodeFixTaskType.FixFromIncident,
      (): void => {
        world.otherSubjectFix = new AIRun();
      },
    ],
    [
      "the trace",
      CodeFixTaskType.FixPerformance,
      (): void => {
        world.otherTraceFix = new AIRun();
      },
    ],
    [
      "the service",
      CodeFixTaskType.ImproveLogging,
      (): void => {
        world.otherServiceFix = new AIRun();
      },
    ],
  ])(
    "another fix of %s on its way",
    async (_name: string, recipe: CodeFixTaskType, onItsWay: () => void) => {
      world.task = fixRun(recipe);
      onItsWay();

      expect(await refusal(retry)).toBe(
        CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE,
      );
      expect(created).toHaveLength(0);
    },
  );

  test("another fix of the exception is looked for by its recipe - a legacy null recipe as an exception fix", async () => {
    await retry();

    const query: Record<string, unknown> = ((
      AIRunService.findOneBy as unknown as jest.Mock
    ).mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as { query: Record<string, unknown> }).query;
      })
      .find((each: Record<string, unknown>) => {
        return Boolean(each["triggeredByTelemetryExceptionId"]);
      }) as Record<string, unknown>)!;

    expect(String(query["triggeredByTelemetryExceptionId"])).toBe(
      EXCEPTION_ID.toString(),
    );
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(query["codeFixTaskType"]).not.toBe(CodeFixTaskType.FixException);
  });

  test.each([
    [
      "resolved",
      (exception: TelemetryException): void => {
        exception.isResolved = true;
      },
      CODE_TASK_TRY_AGAIN_EXCEPTION_RESOLVED_MESSAGE,
    ],
    [
      "archived",
      (exception: TelemetryException): void => {
        exception.isArchived = true;
      },
      CODE_TASK_TRY_AGAIN_EXCEPTION_ARCHIVED_MESSAGE,
    ],
  ])(
    "its exception is %s",
    async (
      _name: string,
      change: (exception: TelemetryException) => void,
      message: string,
    ) => {
      change(world.exception!);

      expect(await refusal(retry)).toBe(message);
      expect(created).toHaveLength(0);
    },
  );

  test("its exception is gone", async () => {
    world.exception = null;

    expect(await refusal(retry)).toBe(
      CODE_TASK_TRY_AGAIN_EXCEPTION_GONE_MESSAGE,
    );
  });

  test("its incident was investigated again since: started from the latest investigation instead", async () => {
    world.task = fixRun(CodeFixTaskType.FixFromIncident);
    (
      SubjectCodeFixRun.assertLatestRecommendedInvestigationSource as unknown as jest.Mock
    ).mockRejectedValue(
      new BadDataException(
        "The source investigation is no longer the latest durably Recommended analysis. Refresh and try again.",
      ) as never,
    );

    expect(await refusal(retry)).toBe(
      CODE_TASK_TRY_AGAIN_INVESTIGATION_MOVED_MESSAGE,
    );
    expect(created).toHaveLength(0);
  });

  test("one turn at a time: a fix asked again by someone else the same moment is refused, not queued twice", async () => {
    world.task.status = AIRunStatus.Error;
    const queued: AIRun = fixRun(CodeFixTaskType.FixException, {
      id: REPLY_ID,
      codeTaskId: TASK_ID,
      status: AIRunStatus.Queued,
    });
    // Before the lock the task's own turn is the latest; in it, theirs is.
    world.latestReplies = [null, queued];

    expect(await refusal(retry)).toBe(CODE_TASK_BUSY_MESSAGE);
    expect(created).toHaveLength(0);
  });

  test("a turn that is no fix OneUptime started is never asked again as one", async () => {
    world.task = fixRun(CodeFixTaskType.GitHubIssueFix);

    expect(
      await refusal(() => {
        return CodeTaskFixRetry.createTurn({
          projectId: PROJECT_ID,
          userId: USER_ID,
          task: world.task,
          turnId: TASK_ID,
        });
      }),
    ).toBe(CODE_TASK_TRY_AGAIN_NOT_IN_CODE_MESSAGE);
    expect(created).toHaveLength(0);
  });
});

describe("what a fix's page says in place of Try again", () => {
  test("one that may have written: why it is not asked again", async () => {
    world.mayHaveWritten = true;

    expect(
      await CodeTaskFixRetry.getRefusal(fixRun(CodeFixTaskType.FixException)),
    ).toBe(CODE_TASK_TRY_AGAIN_MAY_HAVE_WRITTEN_MESSAGE);
  });

  test("one that has not: nothing - Try again is offered", async () => {
    expect(
      await CodeTaskFixRetry.getRefusal(fixRun(CodeFixTaskType.FixPerformance)),
    ).toBeNull();
  });

  test("a request is never asked what it wrote: it is asked again in its own words", async () => {
    world.mayHaveWritten = true;
    const request: AIRun = fixRun(CodeFixTaskType.CodeRequest);

    expect(await CodeTaskFixRetry.getRefusal(request)).toBeNull();
    expect(CodeFixAutoRetry.mayHaveWritten).not.toHaveBeenCalled();
  });
});

describe("a fix waiting for its own next attempt", () => {
  test("is started now, as a request's is: no new turn", async () => {
    world.task.status = AIRunStatus.Queued;
    world.task.nextAttemptAt = new Date(Date.now() + 60 * 1000);
    const update: jest.SpiedFunction<typeof AIRunService.updateOneBy> = jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);

    await retry();

    expect(update).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
  });
});
