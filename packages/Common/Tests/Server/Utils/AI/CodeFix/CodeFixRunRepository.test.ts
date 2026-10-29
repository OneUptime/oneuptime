import CodeFixRunRepository, {
  getFirstMonitorName,
  getPerformanceStackTrace,
  getRunRepositoryAllowance,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixRunRepository";
import FixRunBudget from "../../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import { extractCandidatePathsFromStackTrace } from "../../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertService from "../../../../../Server/Services/AlertService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import logger from "../../../../../Server/Utils/Logger";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import CodeFixTaskContext from "../../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * THE REPOSITORY A NEW FIX RUN IS QUEUED ON.
 *
 * A repository picks the Runner AI works in it on, so a run must name its
 * repository to reach that Runner (CodeFixClaimQuery). A run of a recipe
 * that finds its repository as it works is given it when it is queued,
 * decided from the same facts - and through the same resolver - its
 * details route reads when the run starts:
 *
 *   - ImproveLogging / ImproveTracing: the service's name;
 *   - FixPerformance: the implicated spans' code locations as a stack
 *     trace, then the service's name;
 *   - ImproveInstrumentation / FixFromIncident: the incident's first
 *     monitor's name, or the alert's monitor's name.
 *
 * A run whose repository does not resolve, or whose lookup fails, is still
 * queued - without one, as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6b1c2d3e-1111-4222-8333-944455556666",
);
const REPOSITORY_ID: string = "6b1c2d3e-2222-4222-8333-944455556666";

function resolvesTo(codeRepositoryId: string | null): jest.SpyInstance {
  return jest
    .spyOn(CodeRepositoryService, "resolveRepositoryForException")
    .mockResolvedValue(
      codeRepositoryId
        ? {
            codeRepositoryId,
            organizationName: "acme",
            repositoryName: "checkout",
            servicePathInRepository: null,
            method: "name-match",
            evidence: "Named like the service",
          }
        : null,
    );
}

function monitor(name: string): Monitor {
  const row: Monitor = new Monitor();
  row.name = name;
  return row;
}

describe("the helpers the queue and the details route share", () => {
  test("a performance fix's code locations read as a stack trace the path matcher parses", () => {
    const trace: string | null = getPerformanceStackTrace([
      {
        filePath: "src/billing/charge.ts",
        lineNumber: 42,
        functionName: "chargeCard",
      },
      { filePath: "src/orders/list.ts" },
    ] as never);

    expect(trace).toBe(
      "    at chargeCard (src/billing/charge.ts:42)\n    at (src/orders/list.ts:1)",
    );
    expect(extractCandidatePathsFromStackTrace(trace!)).toEqual(
      expect.arrayContaining(["src/billing/charge.ts", "src/orders/list.ts"]),
    );
  });

  test("no code locations, no stack trace", () => {
    expect(getPerformanceStackTrace(undefined)).toBeNull();
    expect(getPerformanceStackTrace([])).toBeNull();
  });

  test("the first monitor with a name names the service", () => {
    expect(getFirstMonitorName([monitor(""), monitor("checkout-api")])).toBe(
      "checkout-api",
    );
    expect(getFirstMonitorName([])).toBeNull();
    expect(getFirstMonitorName(undefined)).toBeNull();
  });
});

describe("CodeFixRunRepository.getResolutionFacts", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([CodeFixTaskType.ImproveLogging, CodeFixTaskType.ImproveTracing])(
    "%s: the service's name, and no stack trace",
    async (taskType: CodeFixTaskType) => {
      expect(
        await CodeFixRunRepository.getResolutionFacts({
          taskType,
          taskContext: {
            serviceName: "checkout-api",
            codeLocations: [{ filePath: "src/a.ts" }],
          } as unknown as CodeFixTaskContext,
        }),
      ).toEqual({ stackTrace: null, serviceName: "checkout-api" });
    },
  );

  test("FixPerformance: the code locations as a stack trace, and the service's name", async () => {
    expect(
      await CodeFixRunRepository.getResolutionFacts({
        taskType: CodeFixTaskType.FixPerformance,
        taskContext: {
          serviceName: "checkout-api",
          codeLocations: [{ filePath: "src/a.ts", lineNumber: 3 }],
        } as unknown as CodeFixTaskContext,
      }),
    ).toEqual({
      stackTrace: "    at (src/a.ts:3)",
      serviceName: "checkout-api",
    });
  });

  test("an incident's recipe: its first monitor's name, read as OneUptime", async () => {
    const incident: Incident = new Incident();
    incident.monitors = [monitor("payments-api"), monitor("ledger")];
    const read: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident);
    const incidentId: ObjectID = ObjectID.generate();

    expect(
      await CodeFixRunRepository.getResolutionFacts({
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId,
      }),
    ).toEqual({ stackTrace: null, serviceName: "payments-api" });
    expect(read).toHaveBeenCalledWith({
      id: incidentId,
      select: { monitors: { name: true } },
      props: { isRoot: true },
    });
  });

  test("an alert's recipe: its monitor's name", async () => {
    const alert: Alert = new Alert();
    alert.monitor = monitor("search-api");
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert);

    expect(
      await CodeFixRunRepository.getResolutionFacts({
        taskType: CodeFixTaskType.ImproveInstrumentation,
        alertId: ObjectID.generate(),
      }),
    ).toEqual({ stackTrace: null, serviceName: "search-api" });
  });

  test("nothing to read: no facts", async () => {
    expect(
      await CodeFixRunRepository.getResolutionFacts({
        taskType: CodeFixTaskType.ImproveInstrumentation,
      }),
    ).toEqual({ stackTrace: null, serviceName: null });
  });
});

describe("CodeFixRunRepository.resolveForNewRun", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the resolver's repository, asked with the recipe's facts", async () => {
    const resolve: jest.SpyInstance = resolvesTo(REPOSITORY_ID);

    const resolved: ObjectID | null =
      await CodeFixRunRepository.resolveForNewRun({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.ImproveLogging,
        taskContext: {
          serviceName: "checkout-api",
        } as unknown as CodeFixTaskContext,
      });

    expect(resolved?.toString()).toBe(REPOSITORY_ID);
    expect(resolve).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      stackTrace: null,
      serviceName: "checkout-api",
      // No rule narrowed it: every connected repository is a candidate.
      allowance: EVERY_CODE_REPOSITORY,
    });
  });

  /*
   * A run the auto remediation rules opened carries the repositories they
   * allow (allowedCodeRepositoryIds): it is queued on one of those, or on
   * none - never on a repository the rules leave out.
   */
  test("a run the rules opened resolves among the repositories they allow", async () => {
    const resolve: jest.SpyInstance = resolvesTo(REPOSITORY_ID);

    await CodeFixRunRepository.resolveForNewRun({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.ImproveLogging,
      taskContext: {
        serviceName: "checkout-api",
        allowedCodeRepositoryIds: [REPOSITORY_ID.toUpperCase()],
      } as unknown as CodeFixTaskContext,
    });

    expect(resolve.mock.calls[0]![0].allowance).toEqual({
      isEveryRepository: false,
      repositoryIds: [REPOSITORY_ID],
    });
  });

  test("an empty list allows none, and is never read as every repository", async () => {
    const resolve: jest.SpyInstance = resolvesTo(null);

    expect(
      await CodeFixRunRepository.resolveForNewRun({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.ImproveLogging,
        taskContext: {
          serviceName: "checkout-api",
          allowedCodeRepositoryIds: [],
        } as unknown as CodeFixTaskContext,
      }),
    ).toBeNull();
    expect(resolve.mock.calls[0]![0].allowance).toEqual(NO_CODE_REPOSITORY);
  });

  test("none resolves: the run is queued without one", async () => {
    resolvesTo(null);

    expect(
      await CodeFixRunRepository.resolveForNewRun({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.ImproveTracing,
      }),
    ).toBeNull();
  });

  test("a lookup that fails never holds the run back", async () => {
    jest
      .spyOn(CodeRepositoryService, "resolveRepositoryForException")
      .mockRejectedValue(new Error("GitHub is down"));
    const logged: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    expect(
      await CodeFixRunRepository.resolveForNewRun({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.ImproveTracing,
      }),
    ).toBeNull();
    expect(String(logged.mock.calls[0]![0])).toContain(
      "it is queued without one",
    );
  });
});

describe("SubjectCodeFixRun queues a run on its repository", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubWrite(): jest.SpyInstance {
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();

    return jest
      .spyOn(AIRunService, "create")
      .mockImplementation(async (createBy: unknown): Promise<AIRun> => {
        return (createBy as { data: AIRun }).data;
      });
  }

  test("the repository that resolves is the run's, so its Runner takes it", async () => {
    resolvesTo(REPOSITORY_ID);
    const create: jest.SpyInstance = stubWrite();

    const run: AIRun = await SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.ImproveLogging,
      taskContext: {
        serviceName: "checkout-api",
        telemetryServiceId: ObjectID.generate().toString(),
      } as unknown as CodeFixTaskContext,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(run.codeRepositoryId?.toString()).toBe(REPOSITORY_ID);
  });

  test("none resolves: queued without a repository, as before", async () => {
    resolvesTo(null);
    stubWrite();

    const run: AIRun = await SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixPerformance,
      taskContext: {
        traceId: "trace-1",
      } as unknown as CodeFixTaskContext,
    });

    expect(run.codeRepositoryId).toBeUndefined();
  });

  /*
   * A person's click asks Code's gate about the repository first
   * (CodeFixStartGate), from the same facts: the run is queued on that very
   * repository, and the facts are not read a second time.
   */
  test("a repository the caller already decided is the run's, and it is not decided again", async () => {
    const resolver: jest.SpyInstance = resolvesTo(
      "6b1c2d3e-3333-4222-8333-944455556666",
    );
    stubWrite();

    const run: AIRun = await SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.FixPerformance,
      taskContext: {
        traceId: "trace-1",
      } as unknown as CodeFixTaskContext,
      codeRepositoryId: new ObjectID(REPOSITORY_ID),
    });

    expect(run.codeRepositoryId?.toString()).toBe(REPOSITORY_ID);
    expect(resolver).not.toHaveBeenCalled();
  });

  test("the caller decided none resolves: queued without one, and not decided again", async () => {
    const resolver: jest.SpyInstance = resolvesTo(REPOSITORY_ID);
    stubWrite();

    const run: AIRun = await SubjectCodeFixRun.enqueueSubjectCodeFixRun({
      projectId: PROJECT_ID,
      taskType: CodeFixTaskType.ImproveTracing,
      taskContext: {
        serviceName: "checkout-api",
        telemetryServiceId: ObjectID.generate().toString(),
      } as unknown as CodeFixTaskContext,
      codeRepositoryId: null,
    });

    expect(run.codeRepositoryId).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });
});

/*
 * A person picked the repository of a fix no repository was found to hold
 * for certain (Fix performance with AI on a trace): the run works in it,
 * when it is queued and again when it starts - the pick is its only
 * candidate, and the resolver's only-repository rule takes it.
 */
describe("getRunRepositoryAllowance: the repositories a run may be made in", () => {
  const PICKED_ID: string = "6b1c2d3e-3333-4222-8333-944455556666";

  test("a pick is the only repository allowed, in lower case", () => {
    expect(
      getRunRepositoryAllowance({
        pickedCodeRepositoryId: PICKED_ID.toUpperCase(),
      } as unknown as CodeFixTaskContext),
    ).toEqual({ isEveryRepository: false, repositoryIds: [PICKED_ID] });
  });

  test("a pick narrows a run the rules opened to the pick alone", () => {
    expect(
      getRunRepositoryAllowance({
        pickedCodeRepositoryId: PICKED_ID,
        allowedCodeRepositoryIds: [REPOSITORY_ID],
      } as unknown as CodeFixTaskContext),
    ).toEqual({ isEveryRepository: false, repositoryIds: [PICKED_ID] });
  });

  test("no pick: the rules' repositories, or every connected one", () => {
    expect(
      getRunRepositoryAllowance({
        allowedCodeRepositoryIds: [REPOSITORY_ID],
      } as unknown as CodeFixTaskContext),
    ).toEqual({ isEveryRepository: false, repositoryIds: [REPOSITORY_ID] });
    expect(getRunRepositoryAllowance({} as CodeFixTaskContext)).toEqual(
      EVERY_CODE_REPOSITORY,
    );
    expect(getRunRepositoryAllowance(undefined)).toEqual(EVERY_CODE_REPOSITORY);
    expect(getRunRepositoryAllowance(null)).toEqual(EVERY_CODE_REPOSITORY);
  });

  test.each([
    ["a name", "checkout-api"],
    ["an empty id", ""],
    ["a number", 42],
  ])("a pick that is %s is no pick", (_name: string, picked: unknown) => {
    expect(
      getRunRepositoryAllowance({
        pickedCodeRepositoryId: picked,
      } as unknown as CodeFixTaskContext),
    ).toEqual(EVERY_CODE_REPOSITORY);
  });

  test("a new run of a pick is resolved among the pick alone", async () => {
    const resolve: jest.SpyInstance = resolvesTo(PICKED_ID);

    const resolved: ObjectID | null =
      await CodeFixRunRepository.resolveForNewRun({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.FixPerformance,
        taskContext: {
          traceId: "abc123trace",
          serviceName: "checkout-api",
          pickedCodeRepositoryId: PICKED_ID,
        } as unknown as CodeFixTaskContext,
      });

    expect(resolved?.toString()).toBe(PICKED_ID);
    expect(resolve.mock.calls[0]![0].allowance).toEqual({
      isEveryRepository: false,
      repositoryIds: [PICKED_ID],
    });

    resolve.mockRestore();
  });
});
