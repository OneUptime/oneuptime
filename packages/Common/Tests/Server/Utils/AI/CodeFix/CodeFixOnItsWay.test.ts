import AIRunService from "../../../../../Server/Services/AIRunService";
import CreateBy from "../../../../../Server/Types/Database/CreateBy";
import CreateLimit from "../../../../../Server/Types/Database/CreateLimit";
import CodeFixOnItsWay, {
  CODE_FIX_ON_ITS_WAY_LIMIT_NAME,
  CodeFixProblem,
  CodeFixProblemKind,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixOnItsWay";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunStatus, {
  AIRunStatusHelper,
} from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import { CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE } from "../../../../../Types/AI/CodeTaskTryAgain";
import { CodeTaskContextType } from "../../../../../Types/AI/CodeTask";
import { getTelemetryAiFixTaskTypes } from "../../../../../Types/AI/TelemetryAi";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import FixTurnsTable, { FixTurnFacts, FixTurnRow } from "./FixTurnsTable";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { EntityManager } from "typeorm";

/*
 * THE ONE RULE EVERY "A FIX IS ALREADY ON ITS WAY" CHECK ASKS (#9882).
 *
 * What a fix's run is a fix of (problemsOf), the one statement that finds a
 * turn of such a task still working - the turn's own record, or its task's
 * first turn's, as for a reply someone sent in Code (getTurnStatement), the
 * exceptions a guard against one root cause fixed twice compares with
 * (getExceptionIdsStatement), what a second fix is told (getRefusal), and
 * the hold every fix's INSERT is decided under (getCreateLimit, which
 * AIRunService hands DatabaseService). The statements' SQL is held here
 * word for word where it decides the answer, and run on a real table by
 * CodeFixOnItsWayPostgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9882bbbb-0000-4000-8000-000000000001",
);
const EXCEPTION_ID: ObjectID = new ObjectID(
  "9882bbbb-0000-4000-8000-0000000000e1",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "9882bbbb-0000-4000-8000-0000000000c1",
);
const ALERT_ID: ObjectID = new ObjectID("9882bbbb-0000-4000-8000-0000000000a1");
const INSIGHT_ID: ObjectID = new ObjectID(
  "9882bbbb-0000-4000-8000-0000000000d4",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "9882bbbb-0000-4000-8000-0000000000b1",
);
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const NON_TERMINAL_STATUSES: Array<AIRunStatus> = Object.values(
  AIRunStatus,
).filter((status: AIRunStatus): boolean => {
  return !AIRunStatusHelper.isTerminalStatus(status);
});

function fixRun(values: Partial<AIRun>): AIRun {
  const run: AIRun = new AIRun();
  run.projectId = PROJECT_ID;
  run.runType = AIRunType.CodeFix;
  run.status = AIRunStatus.Queued;
  Object.assign(run, values);
  return run;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a fix's run is a fix of", () => {
  test("an exception's fix: the exception, by its recipe", () => {
    expect(
      CodeFixOnItsWay.problemsOf(
        fixRun({
          codeFixTaskType: CodeFixTaskType.WriteRegressionTest,
          triggeredByTelemetryExceptionId: EXCEPTION_ID,
        }),
      ),
    ).toEqual([
      {
        projectId: PROJECT_ID,
        kind: CodeFixProblemKind.Exception,
        recordId: EXCEPTION_ID.toString(),
        taskTypes: [CodeFixTaskType.WriteRegressionTest],
      },
    ]);
  });

  test("a legacy run with no recipe is an exception fix", () => {
    const problems: Array<CodeFixProblem> = CodeFixOnItsWay.problemsOf(
      fixRun({ triggeredByTelemetryExceptionId: EXCEPTION_ID }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.taskTypes).toEqual([CodeFixTaskType.FixException]);
  });

  test("an exception's fix OneUptime opened for an insight is a fix of both", () => {
    expect(
      CodeFixOnItsWay.problemsOf(
        fixRun({
          codeFixTaskType: CodeFixTaskType.FixException,
          triggeredByTelemetryExceptionId: EXCEPTION_ID,
          triggeredByAiInsightId: INSIGHT_ID,
        }),
      ).map((problem: CodeFixProblem): CodeFixProblemKind => {
        return problem.kind;
      }),
    ).toEqual([CodeFixProblemKind.Exception, CodeFixProblemKind.Insight]);
  });

  test.each([
    [CodeFixTaskType.FixFromIncident, { triggeredByIncidentId: INCIDENT_ID }],
    [CodeFixTaskType.ImproveInstrumentation, { triggeredByAlertId: ALERT_ID }],
  ])(
    "an incident's or alert's %s: its record, by its recipe",
    (recipe: CodeFixTaskType, subject: Partial<AIRun>) => {
      const problems: Array<CodeFixProblem> = CodeFixOnItsWay.problemsOf(
        fixRun({ codeFixTaskType: recipe, ...subject }),
      );

      expect(problems).toHaveLength(1);
      expect(problems[0]!.kind).toBe(
        subject.triggeredByIncidentId
          ? CodeFixProblemKind.Incident
          : CodeFixProblemKind.Alert,
      );
      expect(problems[0]!.taskTypes).toEqual([recipe]);
    },
  );

  test("a run naming both an incident and an alert is a fix of neither", () => {
    expect(
      CodeFixOnItsWay.problemsOf(
        fixRun({
          codeFixTaskType: CodeFixTaskType.FixFromIncident,
          triggeredByIncidentId: INCIDENT_ID,
          triggeredByAlertId: ALERT_ID,
        }),
      ),
    ).toEqual([]);
  });

  test("a trace's and a service's fix: the id in its context", () => {
    expect(
      CodeFixOnItsWay.problemsOf(
        fixRun({
          codeFixTaskType: CodeFixTaskType.FixPerformance,
          taskContext: { traceId: TRACE_ID },
        }),
      ),
    ).toEqual([
      CodeFixOnItsWay.ofTrace({ projectId: PROJECT_ID, traceId: TRACE_ID }),
    ]);

    expect(
      CodeFixOnItsWay.problemsOf(
        fixRun({
          codeFixTaskType: CodeFixTaskType.ImproveTracing,
          taskContext: { telemetryServiceId: SERVICE_ID.toString() },
        }),
      ),
    ).toEqual([
      CodeFixOnItsWay.ofService({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.ImproveTracing,
        telemetryServiceId: SERVICE_ID.toString(),
      }),
    ]);
  });

  test("a request OneUptime started for an insight: the insight, of every lane's recipe", () => {
    expect(
      CodeFixOnItsWay.problemsOf(
        fixRun({
          codeFixTaskType: CodeFixTaskType.CodeRequest,
          triggeredByAiInsightId: INSIGHT_ID,
        }),
      ),
    ).toEqual([
      {
        projectId: PROJECT_ID,
        kind: CodeFixProblemKind.Insight,
        recordId: INSIGHT_ID.toString(),
        taskTypes: getTelemetryAiFixTaskTypes(),
      },
    ]);
  });

  test.each([
    [
      "a reply someone sent in Code",
      fixRun({
        codeFixTaskType: CodeFixTaskType.CodeRequest,
        codeTaskId: ObjectID.generate(),
        taskContext: { request: { message: "Try again", context: [] } },
      }),
    ],
    [
      "a request typed in Code",
      fixRun({ codeFixTaskType: CodeFixTaskType.CodeRequest }),
    ],
    [
      "a task asked on GitHub",
      fixRun({ codeFixTaskType: CodeFixTaskType.GitHubIssueFix }),
    ],
    [
      "a performance fix with no trace",
      fixRun({ codeFixTaskType: CodeFixTaskType.FixPerformance }),
    ],
    [
      "an investigation of an incident",
      fixRun({
        runType: AIRunType.Investigation,
        triggeredByIncidentId: INCIDENT_ID,
      }),
    ],
    [
      "a run with no project",
      fixRun({
        projectId: undefined as unknown as ObjectID,
        triggeredByTelemetryExceptionId: EXCEPTION_ID,
      }),
    ],
  ])("%s is a fix of nothing", (_name: string, run: AIRun) => {
    expect(CodeFixOnItsWay.problemsOf(run)).toEqual([]);
  });
});

describe("the statement that finds a fix on its way", () => {
  test("a turn of the project's code tasks, queued or running, beside its task's first turn - every value bound", () => {
    const problem: CodeFixProblem = CodeFixOnItsWay.ofException({
      projectId: PROJECT_ID,
      telemetryExceptionId: EXCEPTION_ID,
      taskTypes: [CodeFixTaskType.WriteRegressionTest],
    });
    const statement: { sql: string; parameters: Array<unknown> } =
      CodeFixOnItsWay.getTurnStatement(problem);

    expect(statement.parameters).toEqual([
      PROJECT_ID.toString(),
      AIRunType.CodeFix,
      AIRunStatusHelper.terminalStatuses(),
      [CodeFixTaskType.WriteRegressionTest],
      EXCEPTION_ID.toString(),
    ]);
    expect(statement.sql).toContain(
      `LEFT JOIN "AIRun" AS "task" ON "task"."_id" = "turn"."codeTaskId"`,
    );
    expect(statement.sql).toContain(
      `"task"."projectId" = $1 AND "task"."runType" = $2`,
    );
    expect(statement.sql).toContain(
      `"task"."codeTaskId" IS NULL AND "task"."deletedAt" IS NULL`,
    );
    expect(statement.sql).toContain(
      `"turn"."deletedAt" IS NULL AND "turn"."status" <> ALL($3::text[])`,
    );
    // The turn is a fix of it, or its task's first turn is.
    expect(statement.sql).toContain(
      `(("turn"."triggeredByTelemetryExceptionId" = $5::uuid AND "turn"."codeFixTaskType" = ANY($4::text[])) OR ("task"."triggeredByTelemetryExceptionId" = $5::uuid AND "task"."codeFixTaskType" = ANY($4::text[])))`,
    );
    expect(statement.sql).toContain(
      `ORDER BY "turn"."createdAt" DESC, "turn"."_id" ASC\nLIMIT 1`,
    );
    expect(statement.sql).not.toContain(EXCEPTION_ID.toString());
  });

  test("an exception fix's recipe matches a legacy run with none", () => {
    const sql: string = CodeFixOnItsWay.getTurnStatement(
      CodeFixOnItsWay.ofException({
        projectId: PROJECT_ID,
        telemetryExceptionId: EXCEPTION_ID,
        taskTypes: [CodeFixTaskType.FixException],
      }),
    ).sql;

    expect(sql).toContain(
      `("turn"."codeFixTaskType" = ANY($4::text[]) OR "turn"."codeFixTaskType" IS NULL)`,
    );
    expect(sql).toContain(
      `("task"."codeFixTaskType" = ANY($4::text[]) OR "task"."codeFixTaskType" IS NULL)`,
    );
  });

  test.each([
    [
      CodeFixOnItsWay.ofSubject({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: INCIDENT_ID,
      }),
      "triggeredByIncidentId",
    ],
    [
      CodeFixOnItsWay.ofSubject({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.FixFromIncident,
        alertId: ALERT_ID,
      }),
      "triggeredByAlertId",
    ],
    [
      CodeFixOnItsWay.ofInsight({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
      }),
      "triggeredByAiInsightId",
    ],
  ])(
    "a record of its own column: %#",
    (problem: CodeFixProblem, column: string) => {
      const statement: { sql: string; parameters: Array<unknown> } =
        CodeFixOnItsWay.getTurnStatement(problem);

      expect(statement.sql).toContain(`"turn"."${column}" = $5::uuid`);
      expect(statement.sql).toContain(`"task"."${column}" = $5::uuid`);
      expect(statement.parameters[4]).toBe(problem.recordId);
    },
  );

  test.each([
    [
      CodeFixOnItsWay.ofTrace({ projectId: PROJECT_ID, traceId: TRACE_ID }),
      { traceId: TRACE_ID },
    ],
    [
      CodeFixOnItsWay.ofService({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.ImproveLogging,
        telemetryServiceId: SERVICE_ID.toString(),
      }),
      { telemetryServiceId: SERVICE_ID.toString() },
    ],
  ])(
    "a trace's or a service's id, contained in the context: %#",
    (problem: CodeFixProblem, contained: JSONObject) => {
      const statement: { sql: string; parameters: Array<unknown> } =
        CodeFixOnItsWay.getTurnStatement(problem);

      expect(statement.sql).toContain(`"turn"."taskContext" @> $5::jsonb`);
      expect(statement.sql).toContain(`"task"."taskContext" @> $5::jsonb`);
      expect(JSON.parse(String(statement.parameters[4]))).toEqual(contained);
    },
  );

  test("a profile's function: a request whose context names it - the service in any case, the file as written", () => {
    const statement: { sql: string; parameters: Array<unknown> } =
      CodeFixOnItsWay.getTurnStatement(
        CodeFixOnItsWay.ofProfileFunction({
          projectId: PROJECT_ID,
          serviceId: new ObjectID(SERVICE_ID.toString().toUpperCase()),
          functionName: "listOrders",
          fileName: "",
        }),
      );

    expect(statement.parameters.slice(3)).toEqual([
      [CodeFixTaskType.CodeRequest],
      CodeTaskContextType.Profile,
      SERVICE_ID.toString().toLowerCase(),
      "listOrders",
      "",
    ]);
    expect(statement.sql).toContain(
      `"turn"."taskContext" -> 'request' -> 'context'`,
    );
    expect(statement.sql).toContain(
      `lower(COALESCE("item" ->> 'serviceId', '')) = $6`,
    );
    expect(statement.sql).toContain(`COALESCE("item" ->> 'fileName', '') = $8`);
  });

  test("the exceptions with a fix on its way: the turn's exception when it is the fix, else its task's", () => {
    const statement: { sql: string; parameters: Array<unknown> } =
      CodeFixOnItsWay.getExceptionIdsStatement({
        projectId: PROJECT_ID,
        taskTypes: [CodeFixTaskType.FixException],
        limit: 500,
      });

    expect(statement.parameters).toEqual([
      PROJECT_ID.toString(),
      AIRunType.CodeFix,
      AIRunStatusHelper.terminalStatuses(),
      [CodeFixTaskType.FixException],
      500,
    ]);
    expect(statement.sql).toContain(
      `SELECT DISTINCT CASE WHEN ("turn"."triggeredByTelemetryExceptionId" IS NOT NULL`,
    );
    expect(statement.sql).toContain(
      `ELSE "task"."triggeredByTelemetryExceptionId" END AS "telemetryExceptionId"`,
    );
    expect(statement.sql).toContain("LIMIT $5");
  });

  test("exactly one of an incident and an alert names a subject", () => {
    expect(() => {
      return CodeFixOnItsWay.ofSubject({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.FixFromIncident,
      });
    }).toThrow(/Exactly one incident or alert/);
    expect(() => {
      return CodeFixOnItsWay.ofSubject({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: INCIDENT_ID,
        alertId: ALERT_ID,
      });
    }).toThrow(BadDataException);
  });
});

describe("a fix on its way, read from the project's runs", () => {
  const exceptionFix: FixTurnFacts = {
    codeFixTaskType: CodeFixTaskType.FixException,
    status: AIRunStatus.Error,
    telemetryExceptionId: EXCEPTION_ID,
  };

  const problem: CodeFixProblem = CodeFixOnItsWay.ofException({
    projectId: PROJECT_ID,
    telemetryExceptionId: EXCEPTION_ID,
    taskTypes: [CodeFixTaskType.FixException],
  });

  function tableWith(seed: (table: FixTurnsTable) => void): FixTurnsTable {
    const table: FixTurnsTable = new FixTurnsTable(PROJECT_ID);
    seed(table);
    table.install();
    return table;
  }

  test.each(NON_TERMINAL_STATUSES)(
    "a reply %s in Code: the turn, named by its task",
    async (status: AIRunStatus) => {
      let task: FixTurnRow | undefined;
      let reply: FixTurnRow | undefined;

      tableWith((table: FixTurnsTable) => {
        task = table.addFirstTurn(exceptionFix);
        reply = table.addReply(task, status);
      });

      const turn: AIRun | null = await CodeFixOnItsWay.findTurn(problem);

      expect(turn?.id?.toString()).toBe(reply!._id);
      expect(turn?.codeTaskId?.toString()).toBe(task!._id);
      expect(turn?.userId?.toString()).toBe(reply!.userId);
      expect(turn?.status).toBe(status);
      expect(await CodeFixOnItsWay.findTaskId(problem)).toBe(task!._id);
    },
  );

  test.each(AIRunStatusHelper.terminalStatuses())(
    "a reply that ended %s: nothing on its way",
    async (status: AIRunStatus) => {
      tableWith((table: FixTurnsTable) => {
        table.addReply(table.addFirstTurn(exceptionFix), status);
      });

      expect(await CodeFixOnItsWay.findTurn(problem)).toBeNull();
    },
  );

  test("a first turn still working: itself, its own task", async () => {
    let task: FixTurnRow | undefined;

    tableWith((table: FixTurnsTable) => {
      task = table.addFirstTurn({
        ...exceptionFix,
        status: AIRunStatus.Queued,
      });
    });

    const turn: AIRun | null = await CodeFixOnItsWay.findTurn(problem);

    expect(turn?.id?.toString()).toBe(task!._id);
    expect(turn?.codeTaskId).toBeUndefined();
    expect(await CodeFixOnItsWay.findTaskId(problem)).toBe(task!._id);
  });

  test("the fix asked again, working: found by what it carries", async () => {
    let task: FixTurnRow | undefined;

    tableWith((table: FixTurnsTable) => {
      task = table.addFirstTurn(exceptionFix);
      table.addAskedAgain(task, AIRunStatus.Running);
    });

    expect(await CodeFixOnItsWay.findTaskId(problem)).toBe(task!._id);
  });

  test("the newest turn on its way, when two tasks' are", async () => {
    let newer: FixTurnRow | undefined;

    tableWith((table: FixTurnsTable) => {
      table.addFirstTurn({ ...exceptionFix, status: AIRunStatus.Running });
      newer = table.addReply(
        table.addFirstTurn(exceptionFix),
        AIRunStatus.Queued,
      );
    });

    expect((await CodeFixOnItsWay.findTurn(problem))?.id?.toString()).toBe(
      newer!._id,
    );
  });

  test("a reply in a task of another exception, of another recipe, or deleted: nothing on its way", async () => {
    tableWith((table: FixTurnsTable) => {
      table.addReply(
        table.addFirstTurn({
          ...exceptionFix,
          telemetryExceptionId: ObjectID.generate(),
        }),
        AIRunStatus.Running,
      );
      table.addReply(
        table.addFirstTurn({
          ...exceptionFix,
          codeFixTaskType: CodeFixTaskType.ImproveExceptionHandling,
        }),
        AIRunStatus.Running,
      );
      const deleted: FixTurnRow = table.addReply(
        table.addFirstTurn(exceptionFix),
        AIRunStatus.Running,
      );
      deleted.deletedAt = new Date();
    });

    expect(await CodeFixOnItsWay.findTurn(problem)).toBeNull();
  });

  test("a reply whose task's first turn is gone holds nothing", async () => {
    tableWith((table: FixTurnsTable) => {
      const task: FixTurnRow = table.addFirstTurn(exceptionFix);
      table.addReply(task, AIRunStatus.Running);
      task.deletedAt = new Date();
    });

    expect(await CodeFixOnItsWay.findTurn(problem)).toBeNull();
  });

  test("the exceptions a reply's task, a first turn and a fix asked again are on their way for - each once", async () => {
    const replied: ObjectID = ObjectID.generate();
    const working: ObjectID = ObjectID.generate();
    const askedAgain: ObjectID = ObjectID.generate();

    tableWith((table: FixTurnsTable) => {
      table.addReply(
        table.addFirstTurn({ ...exceptionFix, telemetryExceptionId: replied }),
        AIRunStatus.Running,
      );
      table.addFirstTurn({
        ...exceptionFix,
        telemetryExceptionId: working,
        status: AIRunStatus.Running,
      });
      const task: FixTurnRow = table.addFirstTurn({
        ...exceptionFix,
        telemetryExceptionId: askedAgain,
      });
      table.addAskedAgain(task, AIRunStatus.Queued);
      table.addReply(task, AIRunStatus.Running);
      // Another recipe's reply: not a fix of the exception's FixException.
      table.addReply(
        table.addFirstTurn({
          ...exceptionFix,
          codeFixTaskType: CodeFixTaskType.WriteRegressionTest,
        }),
        AIRunStatus.Running,
      );
    });

    const ids: Array<string> = (
      await CodeFixOnItsWay.findExceptionIds({
        projectId: PROJECT_ID,
        taskTypes: [CodeFixTaskType.FixException],
        limit: 500,
      })
    )
      .map((id: ObjectID): string => {
        return id.toString();
      })
      .sort();

    expect(ids).toEqual(
      [replied, working, askedAgain]
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort(),
    );
  });

  test("read through the manager it is handed, as inside the INSERT's transaction", async () => {
    const query: jest.Mock = jest.fn(async () => {
      return [];
    });
    const repository: jest.SpiedFunction<typeof AIRunService.getRepository> =
      jest.spyOn(AIRunService, "getRepository");

    expect(
      await CodeFixOnItsWay.findTurn(problem, {
        query,
      } as unknown as EntityManager),
    ).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(repository).not.toHaveBeenCalled();
  });
});

describe("what a second fix is told", () => {
  test.each([
    [
      CodeFixOnItsWay.ofException({
        projectId: PROJECT_ID,
        telemetryExceptionId: EXCEPTION_ID,
        taskTypes: [CodeFixTaskType.FixException],
      }),
      "OneUptime AI is already fixing this exception. Follow it in Code.",
    ],
    [
      CodeFixOnItsWay.ofException({
        projectId: PROJECT_ID,
        telemetryExceptionId: EXCEPTION_ID,
        taskTypes: [CodeFixTaskType.WriteRegressionTest],
      }),
      "OneUptime AI is already writing a regression test for this exception. Follow it in Code.",
    ],
    [
      CodeFixOnItsWay.ofException({
        projectId: PROJECT_ID,
        telemetryExceptionId: EXCEPTION_ID,
        taskTypes: [CodeFixTaskType.ImproveExceptionHandling],
      }),
      "OneUptime AI is already improving how this exception is handled. Follow it in Code.",
    ],
    [
      CodeFixOnItsWay.ofSubject({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: INCIDENT_ID,
      }),
      "OneUptime AI is already writing a fix pull request for this incident. Follow it in Code.",
    ],
    [
      CodeFixOnItsWay.ofSubject({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.ImproveInstrumentation,
        alertId: ALERT_ID,
      }),
      "OneUptime AI is already improving the instrumentation this alert needs. Follow it in Code.",
    ],
    [
      CodeFixOnItsWay.ofInsight({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
      }),
      "OneUptime AI is already working on this finding. Follow it in Code.",
    ],
    [
      CodeFixOnItsWay.ofTrace({ projectId: PROJECT_ID, traceId: TRACE_ID }),
      "OneUptime AI is already writing a performance fix for this trace. Follow it in Code.",
    ],
    [
      CodeFixOnItsWay.ofService({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.ImproveLogging,
        telemetryServiceId: SERVICE_ID.toString(),
      }),
      "OneUptime AI is already improving this service's logging. Follow it in Code.",
    ],
    [
      CodeFixOnItsWay.ofService({
        projectId: PROJECT_ID,
        taskType: CodeFixTaskType.ImproveTracing,
        telemetryServiceId: SERVICE_ID.toString(),
      }),
      "OneUptime AI is already improving this service's tracing. Follow it in Code.",
    ],
  ])(
    "what is on its way, and where to follow it: %#",
    (problem: CodeFixProblem, refusal: string) => {
      expect(CodeFixOnItsWay.getRefusal(problem)).toBe(refusal);
    },
  );
});

describe("every fix's INSERT is held to the rule", () => {
  test("a fix's first turn: the project's lock, and its check refuses while a fix of the problem is on its way", async () => {
    const run: AIRun = fixRun({
      codeFixTaskType: CodeFixTaskType.FixPerformance,
      taskContext: { traceId: TRACE_ID },
    });
    const limit: CreateLimit | null = CodeFixOnItsWay.getCreateLimit(run);

    expect(limit?.limitName).toBe(CODE_FIX_ON_ITS_WAY_LIMIT_NAME);
    expect(limit?.projectId).toBe(PROJECT_ID);

    const table: FixTurnsTable = new FixTurnsTable(PROJECT_ID);
    table.addReply(
      table.addFirstTurn({
        codeFixTaskType: CodeFixTaskType.FixPerformance,
        status: AIRunStatus.Error,
        taskContext: { traceId: TRACE_ID },
      }),
      AIRunStatus.Running,
    );

    const manager: EntityManager = {
      query: async (sql: string, parameters: Array<unknown>) => {
        return table.query(sql, parameters);
      },
    } as unknown as EntityManager;

    await expect(limit!.check(manager)).rejects.toThrow(
      "OneUptime AI is already writing a performance fix for this trace. Follow it in Code.",
    );
  });

  test("nothing on its way: the check lets the INSERT through", async () => {
    const limit: CreateLimit | null = CodeFixOnItsWay.getCreateLimit(
      fixRun({
        codeFixTaskType: CodeFixTaskType.FixFromIncident,
        triggeredByIncidentId: INCIDENT_ID,
      }),
    );
    const query: jest.Mock = jest.fn(async () => {
      return [];
    });

    await expect(
      limit!.check({ query } as unknown as EntityManager),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("a fix of two problems is held to both", async () => {
    const limit: CreateLimit | null = CodeFixOnItsWay.getCreateLimit(
      fixRun({
        codeFixTaskType: CodeFixTaskType.FixException,
        triggeredByTelemetryExceptionId: EXCEPTION_ID,
        triggeredByAiInsightId: INSIGHT_ID,
      }),
    );
    const statements: Array<string> = [];

    await limit!.check({
      query: async (sql: string) => {
        statements.push(sql);
        return [];
      },
    } as unknown as EntityManager);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain(`"turn"."triggeredByTelemetryExceptionId"`);
    expect(statements[1]).toContain(`"turn"."triggeredByAiInsightId"`);
  });

  test("a fix asked again is refused in Try again's own words", async () => {
    const limit: CreateLimit | null = CodeFixOnItsWay.getCreateLimit(
      fixRun({
        codeFixTaskType: CodeFixTaskType.ImproveLogging,
        codeTaskId: ObjectID.generate(),
        taskContext: { telemetryServiceId: SERVICE_ID.toString() },
      }),
    );

    await expect(
      limit!.check({
        query: async () => {
          return [{ turnId: ObjectID.generate().toString() }];
        },
      } as unknown as EntityManager),
    ).rejects.toThrow(CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE);
  });

  test("a reply, a request, a GitHub task and a chat are never held", () => {
    for (const run of [
      fixRun({
        codeFixTaskType: CodeFixTaskType.CodeRequest,
        codeTaskId: ObjectID.generate(),
      }),
      fixRun({ codeFixTaskType: CodeFixTaskType.CodeRequest }),
      fixRun({ codeFixTaskType: CodeFixTaskType.GitHubIssueFix }),
      fixRun({ runType: AIRunType.Chat }),
    ]) {
      expect(CodeFixOnItsWay.getCreateLimit(run)).toBeNull();
    }
  });

  test("AIRunService hands every create the rule's hold", async () => {
    const run: AIRun = fixRun({
      codeFixTaskType: CodeFixTaskType.FixException,
      triggeredByTelemetryExceptionId: EXCEPTION_ID,
    });

    const limit: CreateLimit | null = await (
      AIRunService as unknown as {
        getCreateLimit: (
          createBy: CreateBy<AIRun>,
        ) => Promise<CreateLimit | null>;
      }
    ).getCreateLimit({ data: run, props: { isRoot: true } });

    expect(limit?.limitName).toBe(CODE_FIX_ON_ITS_WAY_LIMIT_NAME);
    expect(limit?.projectId).toBe(PROJECT_ID);

    expect(
      await (
        AIRunService as unknown as {
          getCreateLimit: (
            createBy: CreateBy<AIRun>,
          ) => Promise<CreateLimit | null>;
        }
      ).getCreateLimit({
        data: fixRun({ codeFixTaskType: CodeFixTaskType.CodeRequest }),
        props: { isRoot: true },
      }),
    ).toBeNull();
  });
});
