import {
  CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS,
  CODE_TASK_BACKFILL_FROM_PULL_REQUESTS,
} from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1804050000000-AddCodeTasks";
import AIRunService from "../../../Server/Services/AIRunService";
import CodeTaskStats from "../../../Server/Utils/AI/CodeTask/CodeTaskStats";
import { CodeRepositoryTaskStatsJSON } from "../../../Types/AI/CodeTask";
import ObjectID from "../../../Types/ObjectID";
import { afterAll, beforeAll, expect, test } from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * Code's SQL, run by Postgres: the migration's backfill that gives existing
 * code-fix runs their repository (so they appear on its page rather than
 * under Other tasks), and the three grouped reads behind each repository's
 * card on Code's first page (CodeTaskStats). The unit tests pin the text;
 * only a database says the backfill crosses no project and fails on no bad
 * JSON, and that a task waits for its person only when its LATEST turn asked.
 *
 * Opt in with RUN_POSTGRES_CODE_TASK_TESTS=true against a database the
 * registered migrations have been applied to:
 *
 *   RUN_POSTGRES_CODE_TASK_TESTS=true \
 *   CODE_TASK_TEST_DATABASE_HOST=127.0.0.1 \
 *   CODE_TASK_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/CodeTaskPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, after every
 * registered migration is applied. The tables are structure-only clones of
 * the migrated ones (LIKE ... INCLUDING ALL) in a uniquely named schema that
 * is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_CODE_TASK_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_A: string = "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d";
const PROJECT_B: string = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describePostgres("Code's SQL on a migrated Postgres", () => {
  const schema: string = `code_task_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;

  async function insertRepository(data: {
    projectId: string;
    deleted?: boolean;
  }): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${schema}"."CodeRepository" ("_id", "version", "projectId", "name", "slug", "repositoryHostedAt", "organizationName", "repositoryName", "deletedAt") VALUES ($1, 1, $2, $3, $3, 'GitHub', 'acme', $3, $4)`,
      [
        id,
        data.projectId,
        `repo-${id.substring(0, 8)}`,
        data.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function insertRun(data: {
    projectId: string;
    runType?: string;
    status?: string;
    repositoryId?: string | null;
    codeTaskId?: string | null;
    needsUserInput?: boolean;
    taskContext?: unknown;
    createdAt?: string;
    completedAt?: string | null;
    deleted?: boolean;
  }): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${schema}"."AIRun" ("_id", "version", "projectId", "runType", "status", "codeRepositoryId", "codeTaskId", "needsUserInput", "taskContext", "createdAt", "completedAt", "deletedAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        data.projectId,
        data.runType || "CodeFix",
        data.status || "Completed",
        data.repositoryId || null,
        data.codeTaskId || null,
        Boolean(data.needsUserInput),
        data.taskContext === undefined
          ? null
          : JSON.stringify(data.taskContext),
        data.createdAt || "2026-10-19T08:00:00.000Z",
        data.completedAt || null,
        data.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function insertPullRequest(data: {
    projectId: string;
    runId: string;
    repositoryId: string;
    state?: string;
    createdAt?: string;
    deleted?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."AIAgentTaskPullRequest" ("_id", "version", "projectId", "aiRunId", "codeRepositoryId", "title", "pullRequestState", "createdAt", "deletedAt") VALUES ($1, 1, $2, $3, $4, 'A fix', $5, $6, $7)`,
      [
        ObjectID.generate().toString(),
        data.projectId,
        data.runId,
        data.repositoryId,
        data.state || "open",
        data.createdAt || "2026-10-19T08:00:00.000Z",
        data.deleted ? new Date() : null,
      ],
    );
  }

  async function repositoryOf(runId: string): Promise<string | null> {
    const rows: Array<{ codeRepositoryId: string | null }> =
      await database.query(
        `SELECT "codeRepositoryId" FROM "${schema}"."AIRun" WHERE "_id" = $1`,
        [runId],
      );

    return rows[0]?.codeRepositoryId || null;
  }

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
      synchronize: false,
      // The clones answer to the migrations' unqualified table names.
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of ["AIRun", "CodeRepository", "AIAgentTaskPullRequest"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  describe("the backfill", () => {
    test("puts each existing code-fix run on its repository, and only its own project's", async () => {
      const repository: string = await insertRepository({
        projectId: PROJECT_A,
      });
      const olderRepository: string = await insertRepository({
        projectId: PROJECT_A,
      });
      const otherProjectRepository: string = await insertRepository({
        projectId: PROJECT_B,
      });
      const deletedRepository: string = await insertRepository({
        projectId: PROJECT_A,
        deleted: true,
      });

      // Its latest pull request record names its repository.
      const withPullRequests: string = await insertRun({
        projectId: PROJECT_A,
      });
      await insertPullRequest({
        projectId: PROJECT_A,
        runId: withPullRequests,
        repositoryId: olderRepository,
        createdAt: "2026-10-18T08:00:00.000Z",
      });
      await insertPullRequest({
        projectId: PROJECT_A,
        runId: withPullRequests,
        repositoryId: repository,
        createdAt: "2026-10-19T08:00:00.000Z",
      });
      // A deleted record is not read.
      await insertPullRequest({
        projectId: PROJECT_A,
        runId: withPullRequests,
        repositoryId: otherProjectRepository,
        createdAt: "2026-10-20T08:00:00.000Z",
        deleted: true,
      });

      // A record of another project never moves a run.
      const crossProjectRecord: string = await insertRun({
        projectId: PROJECT_A,
      });
      await insertPullRequest({
        projectId: PROJECT_B,
        runId: crossProjectRecord,
        repositoryId: otherProjectRepository,
      });

      // A GitHub command names the repository it came from.
      const github: (codeRepositoryId: string) => unknown = (
        codeRepositoryId: string,
      ): unknown => {
        return { github: { codeRepositoryId } };
      };
      const fromGitHub: string = await insertRun({
        projectId: PROJECT_A,
        taskContext: github(repository),
      });
      const fromGitHubOtherProject: string = await insertRun({
        projectId: PROJECT_A,
        taskContext: github(otherProjectRepository),
      });
      const fromGitHubDeleted: string = await insertRun({
        projectId: PROJECT_A,
        taskContext: github(deletedRepository),
      });
      const malformed: string = await insertRun({
        projectId: PROJECT_A,
        taskContext: github("not-a-uuid"),
      });

      // Not a code fix, or already placed: left alone.
      const chat: string = await insertRun({
        projectId: PROJECT_A,
        runType: "Chat",
        taskContext: github(repository),
      });
      const placed: string = await insertRun({
        projectId: PROJECT_A,
        repositoryId: olderRepository,
      });
      await insertPullRequest({
        projectId: PROJECT_A,
        runId: placed,
        repositoryId: repository,
      });

      await database.query(CODE_TASK_BACKFILL_FROM_PULL_REQUESTS);
      await database.query(CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS);

      expect(await repositoryOf(withPullRequests)).toBe(repository);
      expect(await repositoryOf(crossProjectRecord)).toBeNull();
      expect(await repositoryOf(fromGitHub)).toBe(repository);
      expect(await repositoryOf(fromGitHubOtherProject)).toBeNull();
      expect(await repositoryOf(fromGitHubDeleted)).toBeNull();
      expect(await repositoryOf(malformed)).toBeNull();
      expect(await repositoryOf(chat)).toBeNull();
      expect(await repositoryOf(placed)).toBe(olderRepository);
    });

    test("is safe to run again", async () => {
      await database.query(CODE_TASK_BACKFILL_FROM_PULL_REQUESTS);
      await database.query(CODE_TASK_BACKFILL_FROM_GITHUB_COMMANDS);
    });
  });

  describe("a repository's card", () => {
    let repository: string;
    let quiet: string;

    beforeAll(async () => {
      repository = await insertRepository({ projectId: PROJECT_A });
      quiet = await insertRepository({ projectId: PROJECT_A });

      jest.spyOn(AIRunService, "getRepository").mockReturnValue({
        manager: {
          query: (sql: string, parameters: Array<unknown>) => {
            return database.query(sql, parameters);
          },
        },
      } as never);

      // Queued: AI is (about to be) working on it.
      await insertRun({
        projectId: PROJECT_A,
        repositoryId: repository,
        status: "Queued",
        createdAt: "2026-10-19T08:00:00.000Z",
      });

      // Its latest turn asked the person something: it waits for them.
      await insertRun({
        projectId: PROJECT_A,
        repositoryId: repository,
        needsUserInput: true,
        createdAt: "2026-10-19T08:10:00.000Z",
        completedAt: "2026-10-19T08:20:00.000Z",
      });

      // It asked, and was answered since: it waits for nobody.
      const answered: string = await insertRun({
        projectId: PROJECT_A,
        repositoryId: repository,
        needsUserInput: true,
        createdAt: "2026-10-19T08:30:00.000Z",
      });
      await insertRun({
        projectId: PROJECT_A,
        repositoryId: repository,
        codeTaskId: answered,
        createdAt: "2026-10-19T09:00:00.000Z",
        completedAt: "2026-10-19T09:45:00.000Z",
      });
      await insertPullRequest({
        projectId: PROJECT_A,
        runId: answered,
        repositoryId: repository,
      });

      // A reply still running: working, and the task counted once.
      const replying: string = await insertRun({
        projectId: PROJECT_A,
        repositoryId: repository,
        createdAt: "2026-10-19T07:00:00.000Z",
      });
      await insertRun({
        projectId: PROJECT_A,
        repositoryId: repository,
        codeTaskId: replying,
        status: "Running",
        createdAt: "2026-10-19T07:30:00.000Z",
      });
      await insertPullRequest({
        projectId: PROJECT_A,
        runId: replying,
        repositoryId: repository,
        state: "merged",
      });

      // Never counted: a deleted run, and another project's.
      await insertRun({
        projectId: PROJECT_A,
        repositoryId: repository,
        status: "Queued",
        deleted: true,
        createdAt: "2026-10-20T08:00:00.000Z",
      });
      await insertRun({
        projectId: PROJECT_B,
        repositoryId: repository,
        status: "Queued",
        createdAt: "2026-10-21T08:00:00.000Z",
      });
      await insertPullRequest({
        projectId: PROJECT_B,
        runId: answered,
        repositoryId: repository,
      });
    });

    test("says how many tasks AI works on, wait for an answer, are open for review, and when anything last happened", async () => {
      const stats: Map<string, CodeRepositoryTaskStatsJSON> =
        await CodeTaskStats.getRepositoryStats({
          projectId: new ObjectID(PROJECT_A),
          repositoryIds: [new ObjectID(repository), new ObjectID(quiet)],
        });

      expect(stats.get(repository)).toEqual({
        working: 2,
        waitingForYou: 1,
        openPullRequests: 1,
        taskCount: 4,
        lastActivityAt: "2026-10-19T09:45:00.000Z",
      });
      expect(stats.get(quiet)).toEqual(CodeTaskStats.empty());
    });
  });
});
