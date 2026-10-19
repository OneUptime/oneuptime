import Entities from "../../../Models/DatabaseModels/Index";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import { MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT } from "../../../Types/Runner/GlobalRunnerWork";
import { DataSource } from "typeorm";

/*
 * The global Runners' claim against a real Postgres: what keeps one
 * project's steps apart from another's on a global Runner is a single
 * UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) in
 * RunnerJobService.claimNextGlobalJob, and only a real driver shows that
 * statement holds:
 *
 *   - a global Runner takes the oldest JavaScript step that waits for any
 *     global Runner, of whichever project, and writes its own id on it;
 *   - never a step aimed at a project's own Runner, nor a Bash or an
 *     AI-composed row even if one were written for the global Runners;
 *   - never a step of a project that turned global Runners off - one already
 *     waiting included - nor of a deleted project, nor one past its claim
 *     window;
 *   - never more than MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT of one project's
 *     steps at once: the next project's step goes first;
 *   - global Runners claiming at the same moment never take the same step.
 *
 * Opt in with RUN_POSTGRES_GLOBAL_RUNNER_CLAIM_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The RunnerJob and Project tables'
 * STRUCTURE is cloned into a unique schema that is dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * GLOBAL_RUNNER_CLAIM_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * GLOBAL_RUNNER_CLAIM_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_GLOBAL_RUNNER_CLAIM_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("the global Runners' claim, in Postgres", () => {
  const schema: string = `global_runner_claim_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;
  let database: DataSource;

  const TABLES: Array<string> = ["RunnerJob", "Project"];

  const GLOBAL_RUNNER: ObjectID = ObjectID.generate();
  const OTHER_GLOBAL_RUNNER: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["GLOBAL_RUNNER_CLAIM_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["GLOBAL_RUNNER_CLAIM_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["GLOBAL_RUNNER_CLAIM_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      // Several connections, so claims made at once are made at once.
      extra: {
        options: `-c search_path=${schema}`,
        max: 8,
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

    await database.query(`DELETE FROM "${schema}"."RunnerJob"`);
    await database.query(`DELETE FROM "${schema}"."Project"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertProject(data: {
    useGlobalRunners?: boolean;
    isDeleted?: boolean;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "useGlobalRunners", "deletedAt") VALUES ($1, $2, $3, $4)`,
      [
        id.toString(),
        `Project ${id.toString()}`,
        data.useGlobalRunners !== false,
        data.isDeleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function insertJob(data: {
    projectId: ObjectID;
    runsOnGlobalRunner?: boolean;
    targetAgentId?: ObjectID;
    stepType?: RunbookStepType;
    origin?: RunnerJobOrigin;
    status?: RunnerJobStatus;
    createdSecondsAgo?: number;
    claimDeadlineInSeconds?: number;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const createdAt: Date = new Date(
      Date.now() - (data.createdSecondsAgo ?? 0) * 1000,
    );

    await database.query(
      `INSERT INTO "${schema}"."RunnerJob" ("_id", "projectId", "runbookExecutionId", "origin", "stepId", "stepType", "targetAgentId", "runsOnGlobalRunner", "status", "script", "timeoutInMs", "claimDeadlineAt", "createdAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)`,
      [
        id.toString(),
        data.projectId.toString(),
        ObjectID.generate().toString(),
        data.origin || RunnerJobOrigin.Runbook,
        "step-1",
        data.stepType || RunbookStepType.JavaScript,
        data.targetAgentId ? data.targetAgentId.toString() : null,
        data.runsOnGlobalRunner !== false,
        data.status || RunnerJobStatus.Pending,
        "return 1;",
        30000,
        new Date(Date.now() + (data.claimDeadlineInSeconds ?? 120) * 1000),
        createdAt,
      ],
    );

    return id;
  }

  async function rowOf(id: ObjectID): Promise<{
    status: string;
    assignedAgentId: string | null;
    leaseExpiresAt: Date | null;
  }> {
    const rows: Array<{
      status: string;
      assignedAgentId: string | null;
      leaseExpiresAt: Date | null;
    }> = await database.query(
      `SELECT "status", "assignedAgentId", "leaseExpiresAt" FROM "${schema}"."RunnerJob" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  async function claim(
    agentId: ObjectID = GLOBAL_RUNNER,
  ): Promise<RunnerJob | null> {
    return await RunnerJobService.claimNextGlobalJob({ agentId });
  }

  test("takes the oldest global JavaScript step, of whichever project, and writes its own id and a lease on it", async () => {
    const projectA: ObjectID = await insertProject({});
    const projectB: ObjectID = await insertProject({});

    const newer: ObjectID = await insertJob({
      projectId: projectA,
      createdSecondsAgo: 5,
    });
    const older: ObjectID = await insertJob({
      projectId: projectB,
      createdSecondsAgo: 30,
    });

    const job: RunnerJob | null = await claim();

    expect(job?._id?.toString()).toBe(older.toString());
    expect(job?.projectId?.toString()).toBe(projectB.toString());
    expect(job?.runsOnGlobalRunner).toBe(true);

    const row: {
      status: string;
      assignedAgentId: string | null;
      leaseExpiresAt: Date | null;
    } = await rowOf(older);

    expect(row.status).toBe(RunnerJobStatus.Claimed);
    expect(row.assignedAgentId).toBe(GLOBAL_RUNNER.toString());
    expect(row.leaseExpiresAt).not.toBeNull();

    expect((await rowOf(newer)).status).toBe(RunnerJobStatus.Pending);
  });

  test("never takes a step aimed at a project's own Runner", async () => {
    const project: ObjectID = await insertProject({});

    const own: ObjectID = await insertJob({
      projectId: project,
      runsOnGlobalRunner: false,
      targetAgentId: ObjectID.generate(),
    });

    expect(await claim()).toBeNull();
    expect((await rowOf(own)).status).toBe(RunnerJobStatus.Pending);
  });

  test("never takes a row that names a Runner, even one marked for the global Runners", async () => {
    const project: ObjectID = await insertProject({});

    await insertJob({
      projectId: project,
      targetAgentId: ObjectID.generate(),
    });

    expect(await claim()).toBeNull();
  });

  test.each([
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
    RunbookStepType.Kubectl,
  ])(
    "never takes a %s row, even one written for the global Runners",
    async (stepType: RunbookStepType) => {
      const project: ObjectID = await insertProject({});

      const row: ObjectID = await insertJob({ projectId: project, stepType });

      expect(await claim()).toBeNull();
      expect((await rowOf(row)).status).toBe(RunnerJobStatus.Pending);
    },
  );

  test("never takes a command OneUptime AI composed", async () => {
    const project: ObjectID = await insertProject({});

    await insertJob({
      projectId: project,
      origin: RunnerJobOrigin.AiRemediation,
    });
    await insertJob({
      projectId: project,
      origin: RunnerJobOrigin.AiInvestigation,
    });

    expect(await claim()).toBeNull();
  });

  test("never takes a step of a project that turned global Runners off - one already waiting included", async () => {
    const project: ObjectID = await insertProject({});
    const waiting: ObjectID = await insertJob({ projectId: project });

    await database.query(
      `UPDATE "${schema}"."Project" SET "useGlobalRunners" = false WHERE "_id" = $1`,
      [project.toString()],
    );

    expect(await claim()).toBeNull();
    expect((await rowOf(waiting)).status).toBe(RunnerJobStatus.Pending);

    // Turned back on, the step is taken.
    await database.query(
      `UPDATE "${schema}"."Project" SET "useGlobalRunners" = true WHERE "_id" = $1`,
      [project.toString()],
    );

    expect((await claim())?._id?.toString()).toBe(waiting.toString());
  });

  test("never takes a step of a deleted project, nor of a project that is gone", async () => {
    const deleted: ObjectID = await insertProject({ isDeleted: true });
    await insertJob({ projectId: deleted });
    await insertJob({ projectId: ObjectID.generate() });

    expect(await claim()).toBeNull();
  });

  test("never takes a step past its claim window", async () => {
    const project: ObjectID = await insertProject({});
    await insertJob({ projectId: project, claimDeadlineInSeconds: -1 });

    expect(await claim()).toBeNull();
  });

  test("never more of one project's steps at once than its share: the next project's step goes first", async () => {
    const busy: ObjectID = await insertProject({});
    const other: ObjectID = await insertProject({});

    for (let index: number = 0; index < MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT; index++) {
      await insertJob({
        projectId: busy,
        status:
          index % 2 === 0 ? RunnerJobStatus.Running : RunnerJobStatus.Claimed,
        createdSecondsAgo: 100 + index,
      });
    }

    const busyNext: ObjectID = await insertJob({
      projectId: busy,
      createdSecondsAgo: 60,
    });
    const otherNext: ObjectID = await insertJob({
      projectId: other,
      createdSecondsAgo: 10,
    });

    // The busy project's waiting step is older, but its share is full.
    expect((await claim())?._id?.toString()).toBe(otherNext.toString());
    expect(await claim()).toBeNull();
    expect((await rowOf(busyNext)).status).toBe(RunnerJobStatus.Pending);

    // One of its steps finishes: its next one is taken.
    await database.query(
      `UPDATE "${schema}"."RunnerJob" SET "status" = $1 WHERE "projectId" = $2 AND "status" = $3`,
      [RunnerJobStatus.Succeeded, busy.toString(), RunnerJobStatus.Running],
    );

    expect((await claim())?._id?.toString()).toBe(busyNext.toString());
  });

  test("a project's steps on its own Runners do not count against its share of the global Runners", async () => {
    const project: ObjectID = await insertProject({});

    for (let index: number = 0; index < MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT + 2; index++) {
      await insertJob({
        projectId: project,
        runsOnGlobalRunner: false,
        targetAgentId: ObjectID.generate(),
        status: RunnerJobStatus.Running,
      });
    }

    const global: ObjectID = await insertJob({ projectId: project });

    expect((await claim())?._id?.toString()).toBe(global.toString());
  });

  test("global Runners claiming at the same moment never take the same step", async () => {
    const projects: Array<ObjectID> = [];

    for (let index: number = 0; index < 4; index++) {
      projects.push(await insertProject({}));
    }

    const jobs: Array<ObjectID> = [];

    for (const project of projects) {
      jobs.push(await insertJob({ projectId: project }));
    }

    const claims: Array<RunnerJob | null> = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((index: number) => {
        return claim(index % 2 === 0 ? GLOBAL_RUNNER : OTHER_GLOBAL_RUNNER);
      }),
    );

    const claimed: Array<string> = claims
      .filter((job: RunnerJob | null): job is RunnerJob => {
        return Boolean(job);
      })
      .map((job: RunnerJob) => {
        return job._id!.toString();
      });

    expect(claimed).toHaveLength(jobs.length);
    expect(new Set(claimed).size).toBe(jobs.length);
    expect([...claimed].sort()).toEqual(
      jobs
        .map((job: ObjectID) => {
          return job.toString();
        })
        .sort(),
    );
  });
});
