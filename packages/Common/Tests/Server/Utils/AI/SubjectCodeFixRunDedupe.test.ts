import SubjectCodeFixRun from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import FixRunBudget from "../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunStatus, {
  AIRunStatusHelper,
} from "../../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import FixTurnsTable, {
  FixTurnFacts,
  FixTurnRow,
} from "./CodeFix/FixTurnsTable";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The per-subject / per-trace / per-service dedupe guards: at most one task
 * of a recipe on its way per (subject, recipe) - a turn queued or running,
 * its first turn's or a later one's (CodeFixOnItsWay). "On its way" is the
 * set of statuses that are not terminal (AIRunStatusHelper.terminalStatuses),
 * and getting that set wrong is silent and permanent: a finished run that
 * the guard still counts as live blocks every future run for that subject
 * FOREVER, including the unattended automatic trigger.
 *
 * NoFixFound is the status that makes this concrete. It is a RESULT (the
 * agent read the code and found nothing worth changing), not an in-flight
 * run, and it is by far the most common non-error ending — so a guard that
 * omits it disables fixes for that subject after the very first quiet
 * "nothing to do".
 *
 * The runs are rows of FixTurnsTable, which works out the guards' statement
 * from them: what is asserted is the behaviour - given a stored run of
 * status X, does the guard report a blocker? - and that the statement
 * names exactly the terminal statuses.
 */

const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const traceId: string = "trace-abc";
const telemetryServiceId: string = ObjectID.generate().toString();

const nonTerminalStatuses: Array<AIRunStatus> = Object.values(
  AIRunStatus,
).filter((status: AIRunStatus): boolean => {
  return !AIRunStatusHelper.isTerminalStatus(status);
});

const terminalStatuses: Array<AIRunStatus> =
  AIRunStatusHelper.terminalStatuses();

describe("SubjectCodeFixRun dedupe guards", () => {
  let table: FixTurnsTable;

  // A fix's first turn in the given status: a task of its own.
  function storeRun(facts: FixTurnFacts): void {
    table.addFirstTurn(facts);
  }

  beforeEach(() => {
    table = new FixTurnsTable(projectId);
    table.install();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("findNonTerminalRunForSubject", () => {
    function subjectRun(status: AIRunStatus): FixTurnFacts {
      return {
        codeFixTaskType: CodeFixTaskType.FixFromIncident,
        status,
        incidentId,
      };
    }

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
            projectId,
            taskType: CodeFixTaskType.FixFromIncident,
            ...input,
          }),
        ).rejects.toThrow(/Exactly one/);

        expect(table.statements).toHaveLength(0);
      },
    );

    test("a NoFixFound run does NOT block a new run for the same subject", async () => {
      storeRun(subjectRun(AIRunStatus.NoFixFound));

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalRunForSubject({
          projectId,
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
        storeRun(subjectRun(status));

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalRunForSubject({
            projectId,
            taskType: CodeFixTaskType.FixFromIncident,
            incidentId: incidentId,
          });

        expect(existingRun).toBeNull();
      },
    );

    test.each(nonTerminalStatuses)(
      "a live %s run still blocks a second run for the same subject",
      async (status: AIRunStatus) => {
        storeRun({
          codeFixTaskType: CodeFixTaskType.FixFromIncident,
          status,
          alertId,
        });

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalRunForSubject({
            projectId,
            taskType: CodeFixTaskType.FixFromIncident,
            alertId: alertId,
          });

        expect(existingRun).not.toBeNull();
      },
    );

    test.each(nonTerminalStatuses)(
      "a reply %s in Code on a fix whose first turn failed still blocks a second run for the same subject",
      async (status: AIRunStatus) => {
        table.addReply(
          table.addFirstTurn(subjectRun(AIRunStatus.Error)),
          status,
        );

        expect(
          await SubjectCodeFixRun.findNonTerminalRunForSubject({
            projectId,
            taskType: CodeFixTaskType.FixFromIncident,
            incidentId,
          }),
        ).not.toBeNull();
      },
    );

    test("a live run of another recipe for the same subject never blocks", async () => {
      storeRun({
        codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
        status: AIRunStatus.Running,
        incidentId,
      });

      expect(
        await SubjectCodeFixRun.findNonTerminalRunForSubject({
          projectId,
          taskType: CodeFixTaskType.FixFromIncident,
          incidentId,
        }),
      ).toBeNull();
    });

    test("the statement excludes exactly the terminal statuses", async () => {
      await SubjectCodeFixRun.findNonTerminalRunForSubject({
        projectId,
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: incidentId,
      });

      expect(table.statements).toHaveLength(1);
      expect(table.statements[0]!.parameters[2]).toEqual(terminalStatuses);
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
    function traceRun(
      status: AIRunStatus,
      forTrace: string = traceId,
    ): FixTurnFacts {
      return {
        codeFixTaskType: CodeFixTaskType.FixPerformance,
        status,
        taskContext: { traceId: forTrace } as JSONObject,
      };
    }

    test("a NoFixFound run does NOT block a new run for the same trace", async () => {
      storeRun(traceRun(AIRunStatus.NoFixFound));

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
        storeRun(traceRun(status));

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
        storeRun(traceRun(status));

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
            projectId: projectId,
            traceId: traceId,
          });

        expect(existingRun).not.toBeNull();
      },
    );

    test("a reply working in Code on the trace's fix whose first turn failed blocks a second, named by its task", async () => {
      const task: FixTurnRow = table.addFirstTurn(traceRun(AIRunStatus.Error));
      table.addReply(task, AIRunStatus.Running);

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
          projectId,
          traceId,
        });

      expect(SubjectCodeFixRun.taskIdOf(existingRun)?.toString()).toBe(
        task._id,
      );
    });

    test("a live run for a different trace never blocks", async () => {
      storeRun(traceRun(AIRunStatus.Running));

      const existingRun: AIRun | null =
        await SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace({
          projectId: projectId,
          traceId: "some-other-trace",
        });

      expect(existingRun).toBeNull();
    });
  });

  describe("findNonTerminalRunForTelemetryService", () => {
    function serviceRun(
      status: AIRunStatus,
      recipe: CodeFixTaskType = CodeFixTaskType.ImproveLogging,
    ): FixTurnFacts {
      return {
        codeFixTaskType: recipe,
        status,
        taskContext: { telemetryServiceId } as JSONObject,
      };
    }

    test("a NoFixFound run does NOT block a new run for the same service", async () => {
      storeRun(serviceRun(AIRunStatus.NoFixFound));

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
        storeRun(serviceRun(status));

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
        storeRun(serviceRun(status, CodeFixTaskType.ImproveTracing));

        const existingRun: AIRun | null =
          await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
            projectId: projectId,
            taskType: CodeFixTaskType.ImproveTracing,
            telemetryServiceId: telemetryServiceId,
          });

        expect(existingRun).not.toBeNull();
      },
    );

    test("a reply working in Code on the service's improvement whose first turn failed blocks a second", async () => {
      table.addReply(
        table.addFirstTurn(serviceRun(AIRunStatus.Error)),
        AIRunStatus.Queued,
      );

      expect(
        await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
          projectId,
          taskType: CodeFixTaskType.ImproveLogging,
          telemetryServiceId,
        }),
      ).not.toBeNull();
    });

    test("the other recipe's improvement of the service never blocks", async () => {
      storeRun(serviceRun(AIRunStatus.Running, CodeFixTaskType.ImproveTracing));

      expect(
        await SubjectCodeFixRun.findNonTerminalRunForTelemetryService({
          projectId,
          taskType: CodeFixTaskType.ImproveLogging,
          telemetryServiceId,
        }),
      ).toBeNull();
    });
  });
});
