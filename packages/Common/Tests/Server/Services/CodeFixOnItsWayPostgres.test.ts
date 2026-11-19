import Entities from "../../../Models/DatabaseModels/Index";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AIRunService from "../../../Server/Services/AIRunService";
import ProjectService from "../../../Server/Services/ProjectService";
import CodeFixOnItsWay, {
  CODE_FIX_ON_ITS_WAY_LIMIT_NAME,
  CodeFixProblem,
} from "../../../Server/Utils/AI/CodeFix/CodeFixOnItsWay";
import ProjectLimitLock from "../../../Server/Utils/Database/ProjectLimitLock";
import logger from "../../../Server/Utils/Logger";
import AIRunStatus, { AIRunStatusHelper } from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import { CodeTaskContextType } from "../../../Types/AI/CodeTask";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * ONE FIX AT A TIME OF THE SAME PROBLEM, ON A MIGRATED POSTGRES (#9882).
 *
 * Every check that refuses a second fix of an exception, an incident, an
 * alert, an insight, a trace, a service or a profile's function asks one
 * statement (CodeFixOnItsWay.getTurnStatement): a turn queued or running
 * whose own record matches, or whose task's first turn's does - so a reply
 * someone sent in Code, which carries no record of its own, holds the
 * problem as its first turn did. Its unit suite pins the SQL; this one runs
 * it on real rows:
 *
 *   - for each kind of problem, a failed first turn with a reply working is
 *     on its way, one whose reply failed is not, and a first turn still
 *     working is;
 *   - every status a turn can still be working in counts, and none it ends
 *     in does; a legacy run with no recipe is an exception fix; a reply that
 *     is deleted, of another project, or in a task of another record or
 *     recipe holds nothing;
 *   - a profile's function is matched in its request's context, the
 *     service's id in any case and a missing file as none;
 *   - the exceptions with a fix on its way are read the same way.
 *
 * And it is decided with the INSERT: of two fixes of the same problem
 * created at the same moment - both past every early check, both waiting
 * for the project's lock (ProjectLimitLock) - exactly one is written, and
 * the other is refused in the rule's words; a fix of another problem waits
 * for the lock too, and is written. Without the hold, both would be.
 *
 * Opt in with RUN_POSTGRES_CODE_TASK_TESTS=true against a database the
 * registered migrations have been applied to:
 *
 *   RUN_POSTGRES_CODE_TASK_TESTS=true \
 *   CODE_TASK_TEST_DATABASE_HOST=127.0.0.1 \
 *   CODE_TASK_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/CodeFixOnItsWayPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, beside Code's
 * other suites. The AI runs are a structure-only clone of the migrated table
 * (LIKE ... INCLUDING ALL) in a uniquely named schema, dropped afterwards;
 * every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CODE_TASK_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "AIRun";

const NON_TERMINAL_STATUSES: Array<AIRunStatus> = Object.values(
  AIRunStatus,
).filter((status: AIRunStatus): boolean => {
  return !AIRunStatusHelper.isTerminalStatus(status);
});

interface SeededRun {
  codeFixTaskType?: CodeFixTaskType | null;
  status: AIRunStatus;
  projectId?: ObjectID;
  runType?: AIRunType;
  codeTaskId?: string | null;
  userId?: ObjectID | null;
  telemetryExceptionId?: ObjectID;
  incidentId?: ObjectID;
  alertId?: ObjectID;
  aiInsightId?: ObjectID;
  taskContext?: JSONObject | null;
  isDeleted?: boolean;
}

describePostgres(
  "one fix at a time of the same problem, on migrated Postgres",
  () => {
    const schema: string = `code_fix_on_its_way_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const exceptionId: ObjectID = ObjectID.generate();
    const incidentId: ObjectID = ObjectID.generate();
    const alertId: ObjectID = ObjectID.generate();
    const insightId: ObjectID = ObjectID.generate();
    const serviceId: ObjectID = ObjectID.generate();
    const traceId: string = "4bf92f3577b34da6a3ce929d0e0e4736";

    let database: DataSource;
    let clock: number = Date.parse("2026-11-19T08:00:00.000Z");

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["CODE_TASK_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["CODE_TASK_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CODE_TASK_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        // A lock holder, two creates and their reads, with room to spare.
        extra: { options: `-c search_path=${schema},public`, max: 8 },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
      );

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    beforeEach(async () => {
      await database.query(`DELETE FROM "${schema}"."${TABLE}"`);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      // The server's product switches and the task counter have suites of their own.
      jest.spyOn(AIRunService, "assertProductsAreOn").mockResolvedValue();
      jest
        .spyOn(ProjectService, "incrementAndGetAIRunCounter")
        .mockResolvedValue(1);
      jest.spyOn(logger, "debug").mockImplementation((): void => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    // A run as OneUptime writes it, a minute after the one before.
    async function seed(run: SeededRun): Promise<string> {
      const id: string = ObjectID.generate().toString();
      clock += 60 * 1000;

      await database.query(
        `INSERT INTO "${schema}"."${TABLE}"
        ("_id", "version", "projectId", "runType", "status", "codeFixTaskType", "codeTaskId",
         "userId", "triggeredByTelemetryExceptionId", "triggeredByIncidentId",
         "triggeredByAlertId", "triggeredByAiInsightId", "taskContext", "needsUserInput",
         "createdAt", "deletedAt")
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13, $14)`,
        [
          id,
          (run.projectId || projectId).toString(),
          run.runType || AIRunType.CodeFix,
          run.status,
          run.codeFixTaskType === undefined ? null : run.codeFixTaskType,
          run.codeTaskId || null,
          run.userId ? run.userId.toString() : null,
          run.telemetryExceptionId?.toString() || null,
          run.incidentId?.toString() || null,
          run.alertId?.toString() || null,
          run.aiInsightId?.toString() || null,
          run.taskContext ? JSON.stringify(run.taskContext) : null,
          new Date(clock),
          run.isDeleted ? new Date() : null,
        ],
      );

      return id;
    }

    // A reply someone sent in Code: its own words, its task - nothing else.
    async function reply(
      taskId: string,
      status: AIRunStatus,
      values: Partial<SeededRun> = {},
    ): Promise<string> {
      return await seed({
        codeFixTaskType: CodeFixTaskType.CodeRequest,
        status,
        codeTaskId: taskId,
        userId: ObjectID.generate(),
        taskContext: { request: { message: "Use the pool.", context: [] } },
        ...values,
      });
    }

    async function onItsWay(problem: CodeFixProblem): Promise<AIRun | null> {
      return await CodeFixOnItsWay.findTurn(problem, database.manager);
    }

    const profileContext: JSONObject = {
      type: CodeTaskContextType.Profile,
      label: "Profile: listOrders",
      // Stored as a request wrote it; the rule reads it in any case.
      serviceId: serviceId.toString().toUpperCase(),
      functionName: "listOrders",
    };

    // Each problem, and the first turn of a fix of it.
    const KINDS: Array<{
      name: string;
      problem: () => CodeFixProblem;
      fix: SeededRun;
    }> = [
      {
        name: "an exception",
        problem: (): CodeFixProblem => {
          return CodeFixOnItsWay.ofException({
            projectId,
            telemetryExceptionId: exceptionId,
            taskTypes: [CodeFixTaskType.FixException],
          });
        },
        fix: {
          codeFixTaskType: CodeFixTaskType.FixException,
          status: AIRunStatus.Error,
          telemetryExceptionId: exceptionId,
        },
      },
      {
        name: "an incident",
        problem: (): CodeFixProblem => {
          return CodeFixOnItsWay.ofSubject({
            projectId,
            taskType: CodeFixTaskType.FixFromIncident,
            incidentId,
          });
        },
        fix: {
          codeFixTaskType: CodeFixTaskType.FixFromIncident,
          status: AIRunStatus.Error,
          incidentId,
        },
      },
      {
        name: "an alert",
        problem: (): CodeFixProblem => {
          return CodeFixOnItsWay.ofSubject({
            projectId,
            taskType: CodeFixTaskType.ImproveInstrumentation,
            alertId,
          });
        },
        fix: {
          codeFixTaskType: CodeFixTaskType.ImproveInstrumentation,
          status: AIRunStatus.Error,
          alertId,
        },
      },
      {
        name: "an insight",
        problem: (): CodeFixProblem => {
          return CodeFixOnItsWay.ofInsight({ projectId, insightId });
        },
        fix: {
          codeFixTaskType: CodeFixTaskType.CodeRequest,
          status: AIRunStatus.Error,
          aiInsightId: insightId,
          taskContext: { request: { message: "Make it faster.", context: [] } },
        },
      },
      {
        name: "a trace",
        problem: (): CodeFixProblem => {
          return CodeFixOnItsWay.ofTrace({ projectId, traceId });
        },
        fix: {
          codeFixTaskType: CodeFixTaskType.FixPerformance,
          status: AIRunStatus.Error,
          taskContext: { traceId, serviceName: "checkout" },
        },
      },
      {
        name: "a service",
        problem: (): CodeFixProblem => {
          return CodeFixOnItsWay.ofService({
            projectId,
            taskType: CodeFixTaskType.ImproveLogging,
            telemetryServiceId: serviceId.toString(),
          });
        },
        fix: {
          codeFixTaskType: CodeFixTaskType.ImproveLogging,
          status: AIRunStatus.Error,
          taskContext: {
            telemetryServiceId: serviceId.toString(),
            serviceName: "checkout",
          },
        },
      },
      {
        name: "a profile's function",
        problem: (): CodeFixProblem => {
          return CodeFixOnItsWay.ofProfileFunction({
            projectId,
            serviceId,
            functionName: "listOrders",
            fileName: "",
          });
        },
        fix: {
          codeFixTaskType: CodeFixTaskType.CodeRequest,
          status: AIRunStatus.Error,
          taskContext: {
            request: { message: "Make it lighter.", context: [profileContext] },
          },
        },
      },
    ];

    describe.each(KINDS)(
      "$name",
      ({ problem, fix }: (typeof KINDS)[number]) => {
        test("a failed first turn with a reply working: on its way, named by its task", async () => {
          const task: string = await seed(fix);
          const working: string = await reply(task, AIRunStatus.Running);

          const turn: AIRun | null = await onItsWay(problem());

          expect(turn?.id?.toString()).toBe(working);
          expect(turn?.codeTaskId?.toString()).toBe(task);
          expect(turn?.status).toBe(AIRunStatus.Running);
        });

        test("a failed first turn whose reply failed too: nothing on its way", async () => {
          await reply(await seed(fix), AIRunStatus.Error);

          expect(await onItsWay(problem())).toBeNull();
        });

        test("a first turn still working: itself", async () => {
          const task: string = await seed({
            ...fix,
            status: AIRunStatus.Queued,
          });

          const turn: AIRun | null = await onItsWay(problem());

          expect(turn?.id?.toString()).toBe(task);
          expect(turn?.codeTaskId).toBeUndefined();
        });
      },
    );

    describe("which turns count", () => {
      const problem: () => CodeFixProblem = KINDS[0]!.problem;
      const fix: SeededRun = KINDS[0]!.fix;

      test.each(NON_TERMINAL_STATUSES)(
        "a reply %s counts",
        async (status: AIRunStatus) => {
          await reply(await seed(fix), status);

          expect(await onItsWay(problem())).not.toBeNull();
        },
      );

      test.each(AIRunStatusHelper.terminalStatuses())(
        "a reply that ended %s does not",
        async (status: AIRunStatus) => {
          await reply(await seed(fix), status);

          expect(await onItsWay(problem())).toBeNull();
        },
      );

      test("a fix asked again, working, counts by what it carries", async () => {
        const task: string = await seed(fix);
        await seed({ ...fix, status: AIRunStatus.Running, codeTaskId: task });

        expect(CodeFixOnItsWay.taskIdOf(await onItsWay(problem()))).toBe(task);
      });

      test("a legacy fix with no recipe is an exception fix", async () => {
        await reply(
          await seed({ ...fix, codeFixTaskType: null }),
          AIRunStatus.Running,
        );

        expect(await onItsWay(problem())).not.toBeNull();
      });

      test("a reply deleted, of another project, or in a task of another exception or recipe holds nothing", async () => {
        await reply(await seed(fix), AIRunStatus.Running, { isDeleted: true });
        const otherProject: ObjectID = ObjectID.generate();
        await reply(
          await seed({ ...fix, projectId: otherProject }),
          AIRunStatus.Running,
          { projectId: otherProject },
        );
        await reply(
          await seed({ ...fix, telemetryExceptionId: ObjectID.generate() }),
          AIRunStatus.Running,
        );
        await reply(
          await seed({
            ...fix,
            codeFixTaskType: CodeFixTaskType.WriteRegressionTest,
          }),
          AIRunStatus.Running,
        );
        // An investigation of the same record is no fix of it.
        await seed({
          runType: AIRunType.Investigation,
          status: AIRunStatus.Running,
          telemetryExceptionId: exceptionId,
        });

        expect(await onItsWay(problem())).toBeNull();
      });

      test("a reply whose task's first turn is deleted holds nothing", async () => {
        const task: string = await seed({ ...fix, isDeleted: true });
        await reply(task, AIRunStatus.Running);

        expect(await onItsWay(problem())).toBeNull();
      });

      test("the newest turn on its way, of two tasks", async () => {
        await seed({ ...fix, status: AIRunStatus.Running });
        const newer: string = await reply(await seed(fix), AIRunStatus.Queued);

        expect((await onItsWay(problem()))?.id?.toString()).toBe(newer);
      });

      test("a profile's function with a file named matches only that file", async () => {
        await reply(
          await seed({
            codeFixTaskType: CodeFixTaskType.CodeRequest,
            status: AIRunStatus.Error,
            taskContext: {
              request: {
                message: "Make it lighter.",
                context: [{ ...profileContext, fileName: "src/orders.ts" }],
              },
            },
          }),
          AIRunStatus.Running,
        );

        expect(await onItsWay(KINDS[6]!.problem())).toBeNull();
        expect(
          await onItsWay(
            CodeFixOnItsWay.ofProfileFunction({
              projectId,
              serviceId,
              functionName: "listOrders",
              fileName: "src/orders.ts",
            }),
          ),
        ).not.toBeNull();
      });
    });

    test("the exceptions with a fix on its way - a reply's task, a first turn, a fix asked again - each once", async () => {
      const replied: ObjectID = ObjectID.generate();
      const working: ObjectID = ObjectID.generate();
      const askedAgain: ObjectID = ObjectID.generate();
      const fix: SeededRun = KINDS[0]!.fix;

      await reply(
        await seed({ ...fix, telemetryExceptionId: replied }),
        AIRunStatus.Running,
      );
      await reply(
        await seed({ ...fix, telemetryExceptionId: replied }),
        AIRunStatus.Queued,
      );
      await seed({
        ...fix,
        telemetryExceptionId: working,
        status: AIRunStatus.Running,
      });
      const task: string = await seed({
        ...fix,
        telemetryExceptionId: askedAgain,
      });
      await seed({
        ...fix,
        telemetryExceptionId: askedAgain,
        codeTaskId: task,
        status: AIRunStatus.Running,
      });
      // Done, or of another recipe: not on its way as an exception fix.
      await reply(
        await seed({ ...fix, telemetryExceptionId: ObjectID.generate() }),
        AIRunStatus.Completed,
      );
      await reply(
        await seed({
          ...fix,
          codeFixTaskType: CodeFixTaskType.WriteRegressionTest,
          telemetryExceptionId: ObjectID.generate(),
        }),
        AIRunStatus.Running,
      );

      const ids: Array<string> = (
        await CodeFixOnItsWay.findExceptionIds({
          projectId,
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

    describe("decided with the INSERT", () => {
      // A fix's first turn, as a create path builds it.
      function performanceFix(forTrace: string): AIRun {
        const run: AIRun = new AIRun();
        run.projectId = projectId;
        run.runType = AIRunType.CodeFix;
        run.codeFixTaskType = CodeFixTaskType.FixPerformance;
        run.status = AIRunStatus.Queued;
        run.taskContext = { traceId: forTrace };
        return run;
      }

      async function create(run: AIRun): Promise<AIRun> {
        return await AIRunService.create({
          data: run,
          props: { isRoot: true },
        });
      }

      async function fixesOf(forTrace: string): Promise<number> {
        const rows: Array<{ count: string }> = await database.query(
          `SELECT count(*)::text AS "count" FROM "${schema}"."${TABLE}"
          WHERE "taskContext" @> $1::jsonb`,
          [JSON.stringify({ traceId: forTrace })],
        );

        return Number(rows[0]!.count);
      }

      // Waits until this many writes wait for the project's lock.
      async function waitForLockWaiters(count: number): Promise<void> {
        let waiting: number = 0;

        for (
          let attempt: number = 0;
          attempt < 400 && waiting < count;
          attempt++
        ) {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 25);
          });

          const rows: Array<{ waiting: string }> = await database.query(
            `SELECT count(*)::text AS "waiting" FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'
              AND query LIKE 'SELECT pg_advisory_xact_lock%'
              AND datname = current_database()`,
          );

          waiting = Number(rows[0]!.waiting);
        }

        expect(waiting).toBe(count);
      }

      /*
       * Fires the creates while another transaction holds the project's lock
       * - as a create that got there first holds it - and lets go once every
       * create waits for it, so all of them are past every check made before
       * the INSERT's transaction. The holder always lets go.
       */
      async function createWhileHeld(
        runs: Array<AIRun>,
        createRun: (run: AIRun) => Promise<AIRun> = create,
      ): Promise<Array<PromiseSettledResult<AIRun>>> {
        const holder: QueryRunner = database.createQueryRunner();

        await holder.connect();
        await holder.startTransaction();

        let settled: Promise<Array<PromiseSettledResult<AIRun>>> =
          Promise.resolve([]);
        let waitError: unknown = null;

        try {
          await holder.query(ProjectLimitLock.LOCK_STATEMENT, [
            ProjectLimitLock.getLockKey({
              limitName: CODE_FIX_ON_ITS_WAY_LIMIT_NAME,
              projectId,
            }),
          ]);

          settled = Promise.allSettled(
            runs.map((run: AIRun): Promise<AIRun> => {
              return createRun(run);
            }),
          );

          await waitForLockWaiters(runs.length);
        } catch (error) {
          waitError = error;
        } finally {
          await holder.commitTransaction();
          await holder.release();
        }

        const results: Array<PromiseSettledResult<AIRun>> = await settled;

        if (waitError) {
          throw waitError;
        }

        return results;
      }

      test("of two fixes of one trace created at once, exactly one is written; the other is told the fix is on its way", async () => {
        const results: Array<PromiseSettledResult<AIRun>> =
          await createWhileHeld([
            performanceFix(traceId),
            performanceFix(traceId),
          ]);

        const written: Array<PromiseSettledResult<AIRun>> = results.filter(
          (result: PromiseSettledResult<AIRun>): boolean => {
            return result.status === "fulfilled";
          },
        );
        const refused: Array<PromiseRejectedResult> = results.filter(
          (
            result: PromiseSettledResult<AIRun>,
          ): result is PromiseRejectedResult => {
            return result.status === "rejected";
          },
        );

        expect(written).toHaveLength(1);
        expect(refused).toHaveLength(1);
        expect((refused[0]!.reason as Error).message).toBe(
          "OneUptime AI is already writing a performance fix for this trace. Follow it in Code.",
        );
        expect(await fixesOf(traceId)).toBe(1);
      });

      test("a fix of another trace in the project waits for the lock too, and is written", async () => {
        const otherTrace: string = "0af7651916cd43dd8448eb211c80319c";

        const results: Array<PromiseSettledResult<AIRun>> =
          await createWhileHeld([
            performanceFix(traceId),
            performanceFix(otherTrace),
          ]);

        expect(
          results.map((result: PromiseSettledResult<AIRun>): string => {
            return result.status;
          }),
        ).toEqual(["fulfilled", "fulfilled"]);
        expect(await fixesOf(traceId)).toBe(1);
        expect(await fixesOf(otherTrace)).toBe(1);
      });

      /*
       * A profile's slow function is named only in a request's context, so
       * the path that starts its fix holds the INSERT to it
       * (CodeFixOnItsWay.createHeldTo) - and a request typed in Code naming
       * the same function is held to nothing.
       */
      test("of two fixes of one profile function started at once, exactly one is written; a request typed in Code naming it is not held", async () => {
        const functionFix: () => AIRun = (): AIRun => {
          const run: AIRun = new AIRun();
          run.projectId = projectId;
          run.runType = AIRunType.CodeFix;
          run.codeFixTaskType = CodeFixTaskType.CodeRequest;
          run.status = AIRunStatus.Queued;
          run.taskContext = {
            request: {
              message: "Make listOrders lighter.",
              context: [profileContext],
            },
          } as never;
          return run;
        };

        const heldToTheFunction: (run: AIRun) => Promise<AIRun> = async (
          run: AIRun,
        ): Promise<AIRun> => {
          return await CodeFixOnItsWay.createHeldTo({
            run,
            problems: [KINDS[6]!.problem()],
            create: async (): Promise<AIRun> => {
              return await create(run);
            },
          });
        };

        const results: Array<PromiseSettledResult<AIRun>> =
          await createWhileHeld(
            [functionFix(), functionFix()],
            heldToTheFunction,
          );

        expect(
          results
            .map((result: PromiseSettledResult<AIRun>): string => {
              return result.status === "rejected"
                ? (result.reason as Error).message
                : result.status;
            })
            .sort(),
        ).toEqual([
          "OneUptime AI is already working on this function. Follow it in Code.",
          "fulfilled",
        ]);

        // Asked in Code, beside the fix on its way: written.
        await expect(create(functionFix())).resolves.toBeDefined();
      });

      test("a reply working on the trace's fix refuses a new fix at the INSERT, whatever came before it", async () => {
        await reply(
          await seed({
            codeFixTaskType: CodeFixTaskType.FixPerformance,
            status: AIRunStatus.Error,
            taskContext: { traceId },
          }),
          AIRunStatus.Running,
        );

        await expect(create(performanceFix(traceId))).rejects.toThrow(
          "OneUptime AI is already writing a performance fix for this trace. Follow it in Code.",
        );
        expect(await fixesOf(traceId)).toBe(1);
      });

      test("a reply is never held: it is written beside a fix on its way", async () => {
        const task: string = await seed({
          codeFixTaskType: CodeFixTaskType.FixPerformance,
          status: AIRunStatus.Running,
          taskContext: { traceId },
        });

        const run: AIRun = new AIRun();
        run.projectId = projectId;
        run.runType = AIRunType.CodeFix;
        run.codeFixTaskType = CodeFixTaskType.CodeRequest;
        run.status = AIRunStatus.Queued;
        run.codeTaskId = new ObjectID(task);
        run.taskContext = {
          request: { message: "Also add a test.", context: [] },
        };

        await expect(create(run)).resolves.toBeDefined();
      });

      test("negative control: without the hold, both fixes of the trace are written", async () => {
        jest.spyOn(CodeFixOnItsWay, "getCreateLimit").mockReturnValue(null);

        const results: Array<PromiseSettledResult<AIRun>> =
          await Promise.allSettled([
            create(performanceFix(traceId)),
            create(performanceFix(traceId)),
          ]);

        expect(
          results.map((result: PromiseSettledResult<AIRun>): string => {
            return result.status;
          }),
        ).toEqual(["fulfilled", "fulfilled"]);
        expect(await fixesOf(traceId)).toBe(2);
      });
    });
  },
);
