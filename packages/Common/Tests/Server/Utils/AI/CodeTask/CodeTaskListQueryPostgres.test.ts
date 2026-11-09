import CodeTaskListQuery, {
  CodeTaskListScopeFacts,
  CodeTaskListStatement,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskListQuery";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskListCountsJSON,
  CodeTaskListFilter,
} from "../../../../../Types/AI/CodeTask";
import ObjectID from "../../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * A task list's filters, search and counts (CodeTaskListQuery), run on
 * Postgres: the statements are built as the Code API builds them and run
 * in an isolated schema holding just the columns they read, seeded with a
 * task in each state - so the SQL is checked by Postgres itself, not by
 * reading it.
 *
 * Opt-in: RUN_POSTGRES_CODE_TASK_LIST_TESTS=true, with
 * CODE_TASK_LIST_TEST_DATABASE_HOST/PORT/NAME (the migrated database CI's
 * schema drift job starts).
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CODE_TASK_LIST_TESTS"] === "true"
    ? describe
    : describe.skip;

// The schema's name: letters, digits and underscores only.
const UUID_DASH: RegExp = /-/g;

describePostgres(
  "a task list's filters, search and counts, on Postgres",
  () => {
    const schema: string = `code_task_list_test_${ObjectID.generate()
      .toString()
      .replace(UUID_DASH, "")}`;
    let database: DataSource;

    const projectId: ObjectID = ObjectID.generate();
    const repositoryId: ObjectID = ObjectID.generate();
    const otherRepositoryId: ObjectID = ObjectID.generate();
    const ids: Map<string, string> = new Map<string, string>();
    let minute: number = 0;

    async function inSchema<T>(
      step: (queryRunner: QueryRunner) => Promise<T>,
    ): Promise<T> {
      const queryRunner: QueryRunner = database.createQueryRunner();
      try {
        await queryRunner.query(`SET search_path TO "${schema}"`);
        return await step(queryRunner);
      } finally {
        await queryRunner.release();
      }
    }

    async function addRun(data: {
      label: string;
      status: AIRunStatus;
      title?: string;
      taskNumber?: number;
      needsUserInput?: boolean;
      taskLabel?: string;
      repositoryId?: ObjectID | null;
      recipe?: CodeFixTaskType;
      deleted?: boolean;
    }): Promise<void> {
      const id: string = ObjectID.generate().toString();
      ids.set(data.label, id);
      minute++;

      await inSchema(async (queryRunner: QueryRunner) => {
        await queryRunner.query(
          `INSERT INTO "AIRun" ("_id", "projectId", "runType", "status", "needsUserInput", "codeTaskId", "codeRepositoryId", "codeFixTaskType", "title", "taskNumber", "createdAt", "deletedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - make_interval(mins => $11), $12)`,
          [
            id,
            projectId.toString(),
            AIRunType.CodeFix,
            data.status,
            data.needsUserInput === true,
            data.taskLabel ? ids.get(data.taskLabel) : null,
            data.repositoryId === null
              ? null
              : (data.repositoryId || repositoryId).toString(),
            data.recipe || CodeFixTaskType.CodeRequest,
            data.title || null,
            data.taskNumber || null,
            // Seeded oldest first: the later a row, the newer.
            1000 - minute,
            data.deleted ? new Date() : null,
          ],
        );
      });
    }

    async function addPullRequest(
      runLabel: string,
      state: string | null,
    ): Promise<void> {
      await inSchema(async (queryRunner: QueryRunner) => {
        await queryRunner.query(
          `INSERT INTO "AIAgentTaskPullRequest" ("_id", "aiRunId", "pullRequestState") VALUES ($1, $2, $3)`,
          [ObjectID.generate().toString(), ids.get(runLabel), state],
        );
      });
    }

    async function run(
      statement: CodeTaskListStatement,
    ): Promise<Array<Record<string, unknown>>> {
      return await inSchema(async (queryRunner: QueryRunner) => {
        return (await queryRunner.query(
          statement.sql,
          statement.parameters,
        )) as Array<Record<string, unknown>>;
      });
    }

    function scope(
      overrides: Partial<CodeTaskListScopeFacts> = {},
    ): CodeTaskListScopeFacts {
      return {
        projectId,
        repositoryIds: [repositoryId],
        includeWithoutRepository: false,
        isProductionReviews: false,
        ...overrides,
      };
    }

    async function page(
      filter: CodeTaskListFilter,
      overrides: Partial<CodeTaskListScopeFacts> = {},
    ): Promise<Array<string>> {
      const rows: Array<Record<string, unknown>> = await run(
        CodeTaskListQuery.getPageStatement({
          ...scope(overrides),
          filter,
          limit: 50,
          skip: 0,
        }),
      );

      return rows.map((row: Record<string, unknown>): string => {
        const id: string = String(row["_id"]);
        return (
          [...ids.entries()].find((entry: [string, string]): boolean => {
            return entry[1] === id;
          })?.[0] || id
        );
      });
    }

    async function counts(
      overrides: Partial<CodeTaskListScopeFacts> = {},
    ): Promise<CodeTaskListCountsJSON> {
      return CodeTaskListQuery.toCounts(
        await run(CodeTaskListQuery.getCountsStatement(scope(overrides))),
      );
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["CODE_TASK_LIST_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["CODE_TASK_LIST_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CODE_TASK_LIST_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);
      await inSchema(async (queryRunner: QueryRunner) => {
        await queryRunner.query(
          `CREATE TABLE "AIRun" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "runType" character varying(100) NOT NULL, "status" character varying(100) NOT NULL, "needsUserInput" boolean NOT NULL DEFAULT false, "codeTaskId" uuid, "codeRepositoryId" uuid, "codeFixTaskType" character varying(100), "title" character varying(500), "taskNumber" integer, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "deletedAt" TIMESTAMP WITH TIME ZONE)`,
        );
        await queryRunner.query(
          `CREATE TABLE "AIAgentTaskPullRequest" ("_id" uuid PRIMARY KEY, "aiRunId" uuid, "pullRequestState" character varying(100), "deletedAt" TIMESTAMP WITH TIME ZONE)`,
        );
      });

      // A task in each state, oldest first.
      await addRun({
        label: "done",
        status: AIRunStatus.Completed,
        title: "Tidy the README",
        taskNumber: 1,
      });
      await addRun({
        label: "failed",
        status: AIRunStatus.Error,
        title: "Fix the flaky checkout test",
        taskNumber: 2,
      });
      await addRun({
        label: "working",
        status: AIRunStatus.Running,
        title: "Add retries to the payment client",
        taskNumber: 3,
      });
      await addRun({
        label: "retrying",
        status: AIRunStatus.Queued,
        title: "Speed up the search page",
        taskNumber: 4,
      });
      await addRun({
        label: "asks",
        status: AIRunStatus.Completed,
        needsUserInput: true,
        title: "Which cache to use?",
        taskNumber: 5,
      });
      await addRun({
        label: "withPullRequest",
        status: AIRunStatus.Completed,
        title: "Fix 100% CPU in the_worker",
        taskNumber: 12,
      });
      await addPullRequest("withPullRequest", "open");
      // A task whose reply failed after its pull request merged: Failed.
      await addRun({
        label: "replyFailed",
        status: AIRunStatus.Completed,
        title: "Rename the queue",
        taskNumber: 7,
      });
      await addPullRequest("replyFailed", "merged");
      await addRun({
        label: "replyFailedTurn",
        status: AIRunStatus.Error,
        taskLabel: "replyFailed",
      });
      // A failed first turn that a reply then finished: Done.
      await addRun({
        label: "fixedByReply",
        status: AIRunStatus.Error,
        title: "Bump the SDK",
        taskNumber: 8,
      });
      await addRun({
        label: "fixedByReplyTurn",
        status: AIRunStatus.Completed,
        taskLabel: "fixedByReply",
      });
      // A pull request recorded without a state reads as open.
      await addRun({
        label: "statelessPullRequest",
        status: AIRunStatus.Cancelled,
        title: "Log less",
        taskNumber: 9,
      });
      await addPullRequest("statelessPullRequest", null);
      // Never listed: another repository's, a deleted one, a production review.
      await addRun({
        label: "elsewhere",
        status: AIRunStatus.Error,
        repositoryId: otherRepositoryId,
        title: "Elsewhere",
      });
      await addRun({
        label: "deleted",
        status: AIRunStatus.Error,
        title: "Deleted",
        deleted: true,
      });
      await addRun({
        label: "review",
        status: AIRunStatus.Completed,
        recipe: CodeFixTaskType.GitHubPullRequestProductionReview,
        title: "Review",
      });
      await addRun({
        label: "noRepository",
        status: AIRunStatus.Error,
        repositoryId: null,
        title: "Without a repository",
      });
    }, 60000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("each task falls in exactly one filter, read from its latest turn and its pull requests", async () => {
      expect(await page(CodeTaskListFilter.InProgress)).toEqual([
        "retrying",
        "working",
      ]);
      expect(await page(CodeTaskListFilter.WaitingForYou)).toEqual(["asks"]);
      expect(await page(CodeTaskListFilter.PullRequestOpen)).toEqual([
        "statelessPullRequest",
        "withPullRequest",
      ]);
      expect(await page(CodeTaskListFilter.Failed)).toEqual([
        "replyFailed",
        "failed",
      ]);
      expect(await page(CodeTaskListFilter.Done)).toEqual([
        "fixedByReply",
        "done",
      ]);
    });

    test("All is every task of the scope, newest first, and the counts add up to it", async () => {
      expect(await page(CodeTaskListFilter.All)).toEqual([
        "statelessPullRequest",
        "fixedByReply",
        "replyFailed",
        "withPullRequest",
        "asks",
        "retrying",
        "working",
        "failed",
        "done",
      ]);

      expect(await counts()).toEqual({
        [CodeTaskListFilter.All]: 9,
        [CodeTaskListFilter.InProgress]: 2,
        [CodeTaskListFilter.WaitingForYou]: 1,
        [CodeTaskListFilter.PullRequestOpen]: 2,
        [CodeTaskListFilter.Failed]: 2,
        [CodeTaskListFilter.Done]: 2,
      });
    });

    test("a search matches titles as written, case aside, and task numbers", async () => {
      expect(
        await page(CodeTaskListFilter.All, { search: "CHECKOUT" }),
      ).toEqual(["failed"]);
      expect(await page(CodeTaskListFilter.All, { search: "#12" })).toEqual([
        "withPullRequest",
      ]);
      expect((await counts({ search: "the" }))[CodeTaskListFilter.All]).toBe(7);
    });

    test("LIKE's own characters in a search are matched as text", async () => {
      expect(await page(CodeTaskListFilter.All, { search: "100%" })).toEqual([
        "withPullRequest",
      ]);
      expect(await page(CodeTaskListFilter.All, { search: "the_w" })).toEqual([
        "withPullRequest",
      ]);
      expect(await page(CodeTaskListFilter.All, { search: "%" })).toEqual([
        "withPullRequest",
      ]);
      expect(await page(CodeTaskListFilter.All, { search: "_" })).toEqual([
        "withPullRequest",
      ]);
    });

    test("a scope of several repositories, and of tasks with none", async () => {
      expect(
        (
          await counts({
            repositoryIds: [repositoryId, otherRepositoryId],
            includeWithoutRepository: true,
          })
        )[CodeTaskListFilter.Failed],
      ).toBe(4);
      expect(
        await page(CodeTaskListFilter.All, {
          repositoryIds: [],
          includeWithoutRepository: true,
        }),
      ).toEqual(["noRepository"]);
      expect(
        await page(CodeTaskListFilter.All, {
          repositoryIds: [],
          includeWithoutRepository: false,
        }),
      ).toEqual([]);
    });

    test("a repository's production reviews, apart from its tasks", async () => {
      expect(
        await page(CodeTaskListFilter.All, { isProductionReviews: true }),
      ).toEqual(["review"]);
    });

    test("a page at a time", async () => {
      const rows: Array<Record<string, unknown>> = await run(
        CodeTaskListQuery.getPageStatement({
          ...scope(),
          filter: CodeTaskListFilter.All,
          limit: 2,
          skip: 2,
        }),
      );

      expect(
        rows.map((row: Record<string, unknown>): string => {
          return String(row["_id"]);
        }),
      ).toEqual([ids.get("replyFailed"), ids.get("withPullRequest")]);
    });
  },
);
