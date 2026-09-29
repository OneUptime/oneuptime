import SubjectCodeFixRun from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import FixRunBudget from "../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import AIRunService from "../../../../Server/Services/AIRunService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunStatus, {
  AIRunStatusHelper,
} from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext from "../../../../Types/AI/CodeFixTaskContext";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The per-subject / per-trace / per-service dedupe guards: at most one
 * NON-TERMINAL CodeFix run per (subject, recipe). "Non-terminal" is a
 * database predicate — QueryHelper.notIn(AIRunStatusHelper.terminalStatuses())
 * — and getting that set wrong is silent and permanent: a finished run that
 * the guard still counts as live blocks every future run for that subject
 * FOREVER, including the unattended automatic trigger.
 *
 * NoFixFound is the status that makes this concrete. It is a RESULT (the
 * agent read the code and found nothing worth changing), not an in-flight
 * run, and it is by far the most common non-error ending — so a guard that
 * omits it disables fixes for that subject after the very first quiet
 * "nothing to do".
 *
 * Rather than reach into the TypeORM Raw operator notIn produces, notIn is
 * swapped for a sentinel the fake AIRunService can evaluate. What is asserted
 * is therefore the real behaviour: given a stored run of status X, does the
 * guard report a blocker?
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const traceId: string = "trace-abc";
const telemetryServiceId: string = ObjectID.generate().toString();

interface StoredRun {
  id: ObjectID;
  status: AIRunStatus;
  taskContext?: CodeFixTaskContext;
}

interface NotInSentinel {
  excludedStatuses: Array<string>;
}

let storedRuns: Array<StoredRun> = [];

function storeRun(status: AIRunStatus): void {
  storedRuns = [
    {
      id: ObjectID.generate(),
      status: status,
      taskContext: {
        traceId: traceId,
        telemetryServiceId: telemetryServiceId,
      } as unknown as CodeFixTaskContext,
    },
  ];
}

// A stored run matches only when its status is NOT one the query excluded.
function matchingRuns(statusQuery: unknown): Array<AIRun> {
  const excluded: Array<string> = (statusQuery as NotInSentinel)
    .excludedStatuses;

  return storedRuns
    .filter((run: StoredRun): boolean => {
      return !excluded.includes(run.status);
    })
    .map((run: StoredRun): AIRun => {
      return {
        id: run.id,
        taskContext: run.taskContext,
      } as unknown as AIRun;
    });
}

const nonTerminalStatuses: Array<AIRunStatus> = Object.values(
  AIRunStatus,
).filter((status: AIRunStatus): boolean => {
  return !AIRunStatusHelper.isTerminalStatus(status);
});

describe("SubjectCodeFixRun dedupe guards", () => {
  let notIn: jest.SpyInstance;

  beforeEach(() => {
    storedRuns = [];

    notIn = jest.spyOn(QueryHelper, "notIn");
    notIn.mockImplementation((values: Array<string | ObjectID>) => {
      return {
        excludedStatuses: values.map((value: string | ObjectID): string => {
          return value.toString();
        }),
      };
    });

    const findOneBy: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");
    findOneBy.mockImplementation(
      (data: { query: { status: unknown } }): Promise<AIRun | null> => {
        return Promise.resolve(matchingRuns(data.query.status)[0] || null);
      },
    );

    const findBy: jest.SpyInstance = jest.spyOn(AIRunService, "findBy");
    findBy.mockImplementation(
      (data: { query: { status: unknown } }): Promise<Array<AIRun>> => {
        return Promise.resolve(matchingRuns(data.query.status));
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("findNonTerminalRunForSubject", () => {
    test.each([
      { label: "neither", input: {} },
      { label: "both", input: { incidentId, alertId } },
    ])(
      "rejects $label subject type before querying",
      async ({
        input,
      }: {
        input: { incidentId?: ObjectID; alertId?: ObjectID };
      }) => {
        await expect(
          SubjectCodeFixRun.findNonTerminalRunForSubject({
            taskType: CodeFixTaskType.FixFromIncident,
            ...input,
          }),
        ).rejects.toThrow(/Exactly one/);

        expect(AIRunService.findOneBy).not.toHaveBeenCalled();
      },
    );

    test("a NoFixFound run does NOT block a new run for the same subject", async () => {
      storeRun(AIRunStatus.NoFixFound);

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalRunForSubject({
          taskType: CodeFixTaskType.FixFromIncident,
          incidentId: incidentId,
        });

      expect(existingRun).toBeNull();
    });

    test.each([
      AIRunStatus.Completed,
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ])(
      "a %s run does not block a new run for the same subject either",
      async (status: AIRunStatus) => {
        storeRun(status);

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalRunForSubject({
            taskType: CodeFixTaskType.FixFromIncident,
            incidentId: incidentId,
          });

        expect(existingRun).toBeNull();
      },
    );

    test.each(nonTerminalStatuses)(
      "a live %s run still blocks a second run for the same subject",
      async (status: AIRunStatus) => {
        storeRun(status);

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalRunForSubject({
            taskType: CodeFixTaskType.FixFromIncident,
            alertId: alertId,
          });

        expect(existingRun).not.toBeNull();
      },
    );

    test("the query excludes exactly the terminal statuses", async () => {
      await SubjectCodeFixRun.findNonTerminalRunForSubject({
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: incidentId,
      });

      expect(notIn).toHaveBeenCalledWith(AIRunStatusHelper.terminalStatuses());
    });
  });

  describe("enqueueSubjectCodeFixRun", () => {
    test("rejects a dual-subject run before the budget check or write", async () => {
      const assertWithinBudget: jest.SpyInstance = jest.spyOn(
        FixRunBudget,
        "assertWithinBudget",
      );
      const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

      await expect(
        SubjectCodeFixRun.enqueueSubjectCodeFixRun({
          projectId,
          taskType: CodeFixTaskType.FixFromIncident,
          incidentId,
          alertId,
        }),
      ).rejects.toThrow(/both an incident and an alert/);

      expect(assertWithinBudget).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("findNonTerminalPerformanceFixRunForTrace", () => {
    test("a NoFixFound run does NOT block a new run for the same trace", async () => {
      storeRun(AIRunStatus.NoFixFound);

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
          projectId: projectId,
          traceId: traceId,
        });

      expect(existingRun).toBeNull();
    });

    test.each([
      AIRunStatus.Completed,
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ])(
      "a %s run does not block a new run for the same trace either",
      async (status: AIRunStatus) => {
        storeRun(status);

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
            projectId: projectId,
            traceId: traceId,
          });

        expect(existingRun).toBeNull();
      },
    );

    test.each(nonTerminalStatuses)(
      "a live %s run still blocks a second run for the same trace",
      async (status: AIRunStatus) => {
        storeRun(status);

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
            projectId: projectId,
            traceId: traceId,
          });

        expect(existingRun).not.toBeNull();
      },
    );

    test("a live run for a different trace never blocks", async () => {
      storeRun(AIRunStatus.Running);

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
          projectId: projectId,
          traceId: "some-other-trace",
        });

      expect(existingRun).toBeNull();
    });
  });

  describe("findNonTerminalRunForTelemetryService", () => {
    test("a NoFixFound run does NOT block a new run for the same service", async () => {
      storeRun(AIRunStatus.NoFixFound);

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
          projectId: projectId,
          taskType: CodeFixTaskType.ImproveLogging,
          telemetryServiceId: telemetryServiceId,
        });

      expect(existingRun).toBeNull();
    });

    test.each([
      AIRunStatus.Completed,
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ])(
      "a %s run does not block a new run for the same service either",
      async (status: AIRunStatus) => {
        storeRun(status);

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
            projectId: projectId,
            taskType: CodeFixTaskType.ImproveLogging,
            telemetryServiceId: telemetryServiceId,
          });

        expect(existingRun).toBeNull();
      },
    );

    test.each(nonTerminalStatuses)(
      "a live %s run still blocks a second run for the same service",
      async (status: AIRunStatus) => {
        storeRun(status);

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
            projectId: projectId,
            taskType: CodeFixTaskType.ImproveTracing,
            telemetryServiceId: telemetryServiceId,
          });

        expect(existingRun).not.toBeNull();
      },
    );
  });
});
