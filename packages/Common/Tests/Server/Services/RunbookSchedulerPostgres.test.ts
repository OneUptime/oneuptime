import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookService from "../../../Server/Services/RunbookService";
import logger from "../../../Server/Utils/Logger";
import RunbookScheduler, {
  RunbookScheduledTimeOutcome,
  RunbookSchedulerPassResult,
} from "../../../Server/Utils/Runbook/RunbookScheduler";
import RunbookStarter from "../../../Server/Utils/Runbook/RunbookStarter";
import ObjectID from "../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import { RunbookScheduleOverlapPolicy } from "../../../Types/Runbook/RunbookSchedule";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunbookTriggerType from "../../../Types/Runbook/RunbookTriggerType";
import { DataSource } from "typeorm";

/*
 * A runbook's schedule against a real Postgres: what keeps a due time from
 * starting two runs is a single UPDATE ... WHERE "scheduleNextRunAt" IS NOT
 * DISTINCT FROM <the time read> (RunbookScheduler.runDueTime), and only a
 * real driver shows that statement holds when Workers race.
 *
 *   - passes started at once, as several Workers would: one run per due
 *     time, written once, through the real create and its reference check;
 *   - a time missed while OneUptime was down: one catch-up run;
 *   - a run waiting for the one before it: started once, by one pass;
 *   - planNextRun writes only over an empty column.
 *
 * Opt in with RUN_POSTGRES_RUNBOOK_SCHEDULER_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The Runbook and RunbookExecution
 * tables' STRUCTURE is cloned into a unique schema that is dropped
 * afterwards. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from RUNBOOK_SCHEDULER_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from RUNBOOK_SCHEDULER_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_RUNBOOK_SCHEDULER_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("a runbook's schedule, in Postgres", () => {
  const schema: string = `runbook_scheduler_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;
  let database: DataSource;
  let enqueued: Array<string>;

  const TABLES: Array<string> = ["Runbook", "RunbookExecution"];

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["RUNBOOK_SCHEDULER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["RUNBOOK_SCHEDULER_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["RUNBOOK_SCHEDULER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      // A fixture names only what the statements touch.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema, table],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

    enqueued = [];
    RunbookStarter.registerEnqueuer(
      async (data: { runbookExecutionId: ObjectID }): Promise<void> => {
        enqueued.push(data.runbookExecutionId.toString());
      },
    );

    await database.query(`DELETE FROM "${schema}"."RunbookExecution"`);
    await database.query(`DELETE FROM "${schema}"."Runbook"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertRunbook(data: {
    projectId: ObjectID;
    cron: string;
    nextRunAt: Date | null;
    queuedRunAt?: Date | null;
    overlap?: RunbookScheduleOverlapPolicy;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Runbook" ("_id", "projectId", "name", "slug", "version", "isEnabled", "steps", "isScheduleEnabled", "scheduleCron", "scheduleTimezone", "scheduleOverlapPolicy", "scheduleMissedRunPolicy", "scheduleNextRunAt", "scheduleQueuedRunAt", "isWebhookEnabled")
       VALUES ($1, $2, $3, $4, 1, true, $5, true, $6, 'UTC', $7, 'RunOnce', $8, $9, false)`,
      [
        id.toString(),
        data.projectId.toString(),
        `Runbook ${id.toString()}`,
        `runbook-${id.toString()}`,
        JSON.stringify([
          {
            id: "step-1",
            order: 1,
            type: RunbookStepType.Manual,
            title: "Check",
            config: {},
          },
        ]),
        data.cron,
        data.overlap || RunbookScheduleOverlapPolicy.Skip,
        data.nextRunAt,
        data.queuedRunAt || null,
      ],
    );

    return id;
  }

  async function runsOf(runbookId: ObjectID): Promise<
    Array<{
      _id: string;
      triggerType: string;
      triggerDetails: Record<string, unknown>;
      status: string;
    }>
  > {
    return await database.query(
      `SELECT "_id", "triggerType", "triggerDetails", "status" FROM "${schema}"."RunbookExecution" WHERE "runbookId" = $1`,
      [runbookId.toString()],
    );
  }

  async function columnOf(
    runbookId: ObjectID,
    column: string,
  ): Promise<string | null> {
    const rows: Array<Record<string, Date | null>> = await database.query(
      `SELECT "${column}" FROM "${schema}"."Runbook" WHERE "_id" = $1`,
      [runbookId.toString()],
    );

    const value: Date | null | undefined = rows[0]?.[column];

    return value ? new Date(value).toISOString() : null;
  }

  test("a due time raced by four passes at once starts one run, written and queued once", async () => {
    const runbookId: ObjectID = await insertRunbook({
      projectId: ObjectID.generate(),
      cron: "0 9 * * *",
      nextRunAt: new Date("2026-10-15T09:00:00.000Z"),
    });

    const now: Date = new Date("2026-10-15T09:00:20.000Z");
    const passes: Array<RunbookSchedulerPassResult> = await Promise.all([
      RunbookScheduler.runDueSchedules(now),
      RunbookScheduler.runDueSchedules(now),
      RunbookScheduler.runDueSchedules(now),
      RunbookScheduler.runDueSchedules(now),
    ]);

    const started: number = passes
      .flatMap((pass: RunbookSchedulerPassResult) => {
        return pass.outcomes;
      })
      .filter((item: { outcome: RunbookScheduledTimeOutcome }) => {
        return item.outcome === RunbookScheduledTimeOutcome.Started;
      }).length;

    expect(started).toBe(1);

    const runs: Array<{
      _id: string;
      triggerType: string;
      triggerDetails: Record<string, unknown>;
      status: string;
    }> = await runsOf(runbookId);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.triggerType).toBe(RunbookTriggerType.Schedule);
    expect(runs[0]!.status).toBe(RunbookExecutionStatus.Scheduled);
    expect(runs[0]!.triggerDetails).toEqual({
      scheduledFor: "2026-10-15T09:00:00.000Z",
    });
    expect(enqueued).toEqual([runs[0]!._id]);
    expect(await columnOf(runbookId, "scheduleNextRunAt")).toBe(
      "2026-10-16T09:00:00.000Z",
    );
  });

  test("a time missed while OneUptime was down starts one catch-up run", async () => {
    const runbookId: ObjectID = await insertRunbook({
      projectId: ObjectID.generate(),
      cron: "*/15 * * * *",
      nextRunAt: new Date("2026-10-15T05:00:00.000Z"),
    });

    await Promise.all([
      RunbookScheduler.runDueSchedules(new Date("2026-10-15T09:07:00.000Z")),
      RunbookScheduler.runDueSchedules(new Date("2026-10-15T09:07:00.000Z")),
    ]);

    const runs: Array<{ triggerDetails: Record<string, unknown> }> =
      await runsOf(runbookId);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.triggerDetails).toEqual({
      scheduledFor: "2026-10-15T05:00:00.000Z",
      isCatchUp: true,
    });
    expect(await columnOf(runbookId, "scheduleNextRunAt")).toBe(
      "2026-10-15T09:15:00.000Z",
    );
  });

  test("a run waiting for the one before it starts once, by one of the passes", async () => {
    const runbookId: ObjectID = await insertRunbook({
      projectId: ObjectID.generate(),
      cron: "0 9 * * *",
      nextRunAt: new Date("2026-10-16T09:00:00.000Z"),
      queuedRunAt: new Date("2026-10-15T09:00:00.000Z"),
      overlap: RunbookScheduleOverlapPolicy.RunAfter,
    });

    const passes: Array<RunbookSchedulerPassResult> = await Promise.all([
      RunbookScheduler.runDueSchedules(new Date("2026-10-15T10:00:00.000Z")),
      RunbookScheduler.runDueSchedules(new Date("2026-10-15T10:00:00.000Z")),
      RunbookScheduler.runDueSchedules(new Date("2026-10-15T10:00:00.000Z")),
    ]);

    expect(
      passes.reduce((sum: number, pass: RunbookSchedulerPassResult) => {
        return sum + pass.startedFromQueue;
      }, 0),
    ).toBe(1);

    const runs: Array<{ triggerDetails: Record<string, unknown> }> =
      await runsOf(runbookId);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.triggerDetails).toEqual({
      scheduledFor: "2026-10-15T09:00:00.000Z",
      waitedForPreviousRun: true,
    });
    expect(await columnOf(runbookId, "scheduleQueuedRunAt")).toBeNull();
  });

  test("planNextRun writes only over an empty column", async () => {
    const empty: ObjectID = await insertRunbook({
      projectId: ObjectID.generate(),
      cron: "30 8 * * *",
      nextRunAt: null,
    });
    const planned: ObjectID = await insertRunbook({
      projectId: ObjectID.generate(),
      cron: "30 8 * * *",
      nextRunAt: new Date("2026-10-20T08:30:00.000Z"),
    });

    await Promise.all([
      RunbookScheduler.planNextRun({
        runbookId: empty,
        now: new Date("2026-10-15T08:00:00.000Z"),
      }),
      RunbookScheduler.planNextRun({
        runbookId: planned,
        now: new Date("2026-10-15T08:00:00.000Z"),
      }),
    ]);

    expect(await columnOf(empty, "scheduleNextRunAt")).toBe(
      "2026-10-15T08:30:00.000Z",
    );
    expect(await columnOf(planned, "scheduleNextRunAt")).toBe(
      "2026-10-20T08:30:00.000Z",
    );
  });

  test("the webhook's key is given once: racing writers agree on one", async () => {
    const runbookId: ObjectID = await insertRunbook({
      projectId: ObjectID.generate(),
      cron: "0 9 * * *",
      nextRunAt: null,
    });

    const keys: Array<string | null> = await Promise.all(
      Array.from({ length: 5 }, () => {
        return RunbookService.ensureWebhookSecretKey(runbookId);
      }),
    );

    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
