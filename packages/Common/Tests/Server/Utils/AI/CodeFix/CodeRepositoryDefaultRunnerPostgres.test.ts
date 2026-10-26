import CodeFixClaimQuery, {
  CodeFixClaimStatement,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixClaimQuery";
import { AddCodeRepositoryGlobalRunnerPick1807700000000 } from "../../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807700000000-AddCodeRepositoryGlobalRunnerPick";
import { KeepCodeRepositoriesOnGlobalRunners1807710000000 } from "../../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807710000000-KeepCodeRepositoriesOnGlobalRunners";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CodeWorker,
  CodeWorkerKind,
} from "../../../../../Types/Runner/CodeRepositoryRunner";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * A code repository that picks no Runner follows its project's default
 * Runner (Types/Runner/CodeRepositoryRunner), against a real Postgres, on
 * real rows:
 *
 *   - the migrations: AddCodeRepositoryGlobalRunnerPick adds
 *     "isGlobalRunnerPicked", and KeepCodeRepositoriesOnGlobalRunners writes
 *     it true for every repository that picks no Runner in a project that
 *     already has a default Runner - by the rule a default must meet - so
 *     no repository moves off the global Runner it was on at the upgrade;
 *   - the claim (CodeFixClaimQuery), as the code-fix claim and the queue
 *     count run it: the project's default Runner takes the runs of the
 *     repositories that follow it, and stops the moment another Runner is
 *     the default; a global Runner takes the runs of repositories that
 *     picked the Global Runner and of those whose project has no default,
 *     never of one that follows a default; a Runner a repository picked
 *     takes that repository's runs alone.
 *
 * Opt in with RUN_POSTGRES_CODE_REPOSITORY_DEFAULT_RUNNER_TESTS=true and the
 * normal database credentials; CODE_REPOSITORY_DEFAULT_RUNNER_TEST_DATABASE_
 * HOST / _PORT / _NAME point it at a database other than the local
 * development one. The database must already be migrated: Runner,
 * CodeRepository, Project and AIRun are cloned from public into a uniquely
 * named schema (so the source's rows are never read or modified), the
 * repository as it was before the migrations, and the schema is dropped
 * afterwards.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CODE_REPOSITORY_DEFAULT_RUNNER_TESTS"] === "true"
    ? describe
    : describe.skip;

const TASK_TYPES: Array<CodeFixTaskType> = [
  CodeFixTaskType.FixException,
  CodeFixTaskType.CodeRequest,
];

// The schema's name: letters, digits and underscores only.
const UUID_DASH: RegExp = /-/g;

describePostgres(
  "a code repository follows its project's default Runner, against Postgres",
  () => {
    const schema: string = `code_repository_default_runner_test_${ObjectID.generate()
      .toString()
      .replace(UUID_DASH, "")}`;
    let database: DataSource;

    const requiredColumnsByTable: Map<
      string,
      Array<{ column_name: string; udt_name: string }>
    > = new Map();

    const ids: Map<string, string> = new Map();

    function id(label: string): string {
      const found: string | undefined = ids.get(label);
      expect(found).toBeDefined();
      return found!;
    }

    async function runInSchema(
      step: (queryRunner: QueryRunner) => Promise<void>,
    ): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();
      try {
        await queryRunner.query(`SET search_path TO "${schema}"`);
        await step(queryRunner);
      } finally {
        await queryRunner.release();
      }
    }

    /*
     * Inserts a row, filling every NOT NULL column that has no default and
     * was not given with a unique value of its type, so the seeds below only
     * say what the test is about.
     */
    async function insertRow(
      table: string,
      values: Record<string, unknown>,
    ): Promise<string> {
      let required:
        | Array<{ column_name: string; udt_name: string }>
        | undefined = requiredColumnsByTable.get(table);

      if (!required) {
        required = await database.query(
          `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND is_nullable = 'NO' AND column_default IS NULL`,
          [schema, table],
        );
        requiredColumnsByTable.set(table, required!);
      }

      const row: Record<string, unknown> = {
        _id: ObjectID.generate().toString(),
        ...values,
      };

      for (const column of required!) {
        if (column.column_name in row) {
          continue;
        }

        if (column.udt_name === "uuid") {
          row[column.column_name] = ObjectID.generate().toString();
        } else if (column.udt_name === "int4") {
          row[column.column_name] = 1;
        } else if (column.udt_name === "bool") {
          row[column.column_name] = false;
        } else if (column.udt_name === "timestamptz") {
          row[column.column_name] = new Date();
        } else if (column.udt_name === "jsonb" || column.udt_name === "json") {
          row[column.column_name] = JSON.stringify({});
        } else {
          row[column.column_name] =
            `${column.column_name}-${ObjectID.generate().toString()}`;
        }
      }

      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          return row[column];
        }),
      );

      return row["_id"] as string;
    }

    async function seedProject(
      label: string,
      values: { useGlobalRunners?: boolean } = {},
    ): Promise<void> {
      ids.set(
        label,
        await insertRow("Project", {
          name: `project-${label}`,
          useGlobalRunners: values.useGlobalRunners !== false,
        }),
      );
    }

    async function seedRunner(
      label: string,
      values: {
        project: string | null;
        isProjectDefault?: boolean;
        name?: string;
        isGlobalRunner?: boolean;
        canRunRunbooks?: boolean;
        deletedAt?: Date;
      },
    ): Promise<void> {
      ids.set(
        label,
        await insertRow("Runner", {
          projectId: values.project ? id(values.project) : null,
          name: values.name || `runner-${label}`,
          isProjectDefault: values.isProjectDefault === true,
          isGlobalRunner: values.isGlobalRunner === true,
          canRunRunbooks: values.canRunRunbooks !== false,
          ...(values.deletedAt ? { deletedAt: values.deletedAt } : {}),
        }),
      );
    }

    async function seedRepository(
      label: string,
      values: {
        project: string;
        runner?: string | undefined;
      },
    ): Promise<void> {
      ids.set(
        label,
        await insertRow("CodeRepository", {
          projectId: id(values.project),
          name: `repository-${label}`,
          ...(values.runner ? { runnerId: id(values.runner) } : {}),
        }),
      );
    }

    // A queued code-fix run in a repository (or in none, not known yet).
    async function seedRun(
      label: string,
      values: { project: string; repository?: string | undefined },
    ): Promise<void> {
      ids.set(
        label,
        await insertRow("AIRun", {
          projectId: id(values.project),
          runType: AIRunType.CodeFix,
          status: AIRunStatus.Queued,
          codeFixTaskType: CodeFixTaskType.FixException,
          ...(values.repository
            ? { codeRepositoryId: id(values.repository) }
            : {}),
        }),
      );
    }

    async function picksGlobalRunner(
      repository: string,
    ): Promise<boolean | null> {
      const rows: Array<{ isGlobalRunnerPicked: boolean | null }> =
        await database.query(
          `SELECT "isGlobalRunnerPicked" FROM "${schema}"."CodeRepository" WHERE "_id" = $1`,
          [id(repository)],
        );
      expect(rows).toHaveLength(1);
      return rows[0]!.isGlobalRunnerPicked;
    }

    async function setPicksGlobalRunner(
      repository: string,
      value: boolean | null,
    ): Promise<void> {
      await database.query(
        `UPDATE "${schema}"."CodeRepository" SET "isGlobalRunnerPicked" = $1 WHERE "_id" = $2`,
        [value, id(repository)],
      );
    }

    async function makeDefault(project: string, runner: string): Promise<void> {
      await database.query(
        `UPDATE "${schema}"."Runner" SET "isProjectDefault" = ("_id" = $1) WHERE "projectId" = $2`,
        [id(runner), id(project)],
      );
    }

    // The worker's facts, as the claim builds them.
    function projectRunner(
      runner: string,
      project: string,
    ): {
      worker: CodeWorker;
      projectId: ObjectID;
    } {
      return {
        worker: {
          kind: CodeWorkerKind.ProjectRunner,
          id: new ObjectID(id(runner)),
        },
        projectId: new ObjectID(id(project)),
      };
    }

    const GLOBAL_WORKER: { worker: CodeWorker } = {
      worker: {
        kind: CodeWorkerKind.GlobalRunner,
        id: new ObjectID("00000000-0000-0000-0000-000000000002"),
      },
    };

    /*
     * Every queued run the worker may take, by label: the claim's condition
     * run as the count runs it, then each run asked by id.
     */
    async function claimable(facts: {
      worker: CodeWorker;
      projectId?: ObjectID | undefined;
    }): Promise<Array<string>> {
      const statement: CodeFixClaimStatement =
        CodeFixClaimQuery.getCountStatement({
          ...facts,
          claimableTaskTypes: TASK_TYPES,
        });

      const labels: Array<string> = [];

      for (const [label, runId] of ids) {
        if (!label.startsWith("run:")) {
          continue;
        }

        const rows: Array<{ count: number }> = await runInSchemaQuery(
          `${statement.sql} AND "run"."_id" = $${statement.parameters.length + 1}::uuid`,
          [...statement.parameters, runId],
        );

        if (rows[0]!.count > 0) {
          labels.push(label);
        }
      }

      // The count and the claim read the same runs.
      const all: Array<{ count: number }> = await runInSchemaQuery(
        statement.sql,
        statement.parameters,
      );
      expect(all[0]!.count).toBe(labels.length);

      return labels.sort();
    }

    async function runInSchemaQuery<T>(
      sql: string,
      parameters: Array<unknown>,
    ): Promise<Array<T>> {
      let rows: Array<T> = [];

      await runInSchema(async (queryRunner: QueryRunner) => {
        rows = (await queryRunner.query(sql, parameters)) as Array<T>;
      });

      return rows;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["CODE_REPOSITORY_DEFAULT_RUNNER_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["CODE_REPOSITORY_DEFAULT_RUNNER_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CODE_REPOSITORY_DEFAULT_RUNNER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        schema: schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of ["Project", "Runner", "CodeRepository", "AIRun"]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // The repository as it was before the migrations.
      await database.query(
        `ALTER TABLE "${schema}"."CodeRepository" DROP COLUMN IF EXISTS "isGlobalRunnerPicked"`,
      );

      // A project with a default Runner, and another Runner of its own.
      await seedProject("with default");
      await seedRunner("default", {
        project: "with default",
        isProjectDefault: true,
      });
      await seedRunner("other", { project: "with default" });
      await seedRepository("with default: picks none", {
        project: "with default",
      });
      await seedRepository("with default: picks none either", {
        project: "with default",
      });
      await seedRepository("with default: picks other", {
        project: "with default",
        runner: "other",
      });
      await seedRepository("with default: picks the default", {
        project: "with default",
        runner: "default",
      });

      // A project with no default Runner.
      await seedProject("without default");
      await seedRunner("without default: a Runner", {
        project: "without default",
      });
      await seedRepository("without default: picks none", {
        project: "without default",
      });

      // Projects whose default does not meet the rule a default must meet.
      await seedProject("deleted default");
      await seedRunner("deleted default: Runner", {
        project: "deleted default",
        isProjectDefault: true,
        deletedAt: new Date(),
      });
      await seedRepository("deleted default: picks none", {
        project: "deleted default",
      });

      await seedProject("no runbooks default");
      await seedRunner("no runbooks default: Runner", {
        project: "no runbooks default",
        isProjectDefault: true,
        canRunRunbooks: false,
      });
      await seedRepository("no runbooks default: picks none", {
        project: "no runbooks default",
      });

      await seedProject("agent default");
      await seedRunner("agent default: Runner", {
        project: "agent default",
        isProjectDefault: true,
        name: "  Kubernetes-Agent/prod-eu",
      });
      await seedRepository("agent default: picks none", {
        project: "agent default",
      });

      await seedProject("global default");
      await seedRunner("global default: Runner", {
        project: "global default",
        isProjectDefault: true,
        isGlobalRunner: true,
      });
      await seedRepository("global default: picks none", {
        project: "global default",
      });

      // A project with a default that turned global Runners off.
      await seedProject("off", { useGlobalRunners: false });
      await seedRunner("off: default", {
        project: "off",
        isProjectDefault: true,
      });
      await seedRepository("off: picks none", { project: "off" });

      // Both migrations, as the chain runs them.
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new AddCodeRepositoryGlobalRunnerPick1807700000000().up(
          queryRunner,
        );
      });

      // One repository someone already said to follow the default.
      await setPicksGlobalRunner("with default: picks none either", false);

      await runInSchema(async (queryRunner: QueryRunner) => {
        await new KeepCodeRepositoriesOnGlobalRunners1807710000000().up(
          queryRunner,
        );
      });
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    describe("the migrations", () => {
      test("a repository that picks none beside a default Runner stays on its global Runner", async () => {
        expect(await picksGlobalRunner("with default: picks none")).toBe(true);
        expect(await picksGlobalRunner("off: picks none")).toBe(true);
      });

      test("a repository that already said to follow the default keeps that", async () => {
        expect(await picksGlobalRunner("with default: picks none either")).toBe(
          false,
        );
      });

      test("a repository that picks a Runner - the default itself too - is left alone", async () => {
        expect(await picksGlobalRunner("with default: picks other")).toBeNull();
        expect(
          await picksGlobalRunner("with default: picks the default"),
        ).toBeNull();
      });

      test("a project without a default Runner - or with one that may not be it - is left to follow one it makes later", async () => {
        for (const repository of [
          "without default: picks none",
          "deleted default: picks none",
          "no runbooks default: picks none",
          "agent default: picks none",
          "global default: picks none",
        ]) {
          expect({
            repository,
            picksGlobalRunner: await picksGlobalRunner(repository),
          }).toEqual({ repository, picksGlobalRunner: null });
        }
      });

      test("running it again changes nothing", async () => {
        await runInSchema(async (queryRunner: QueryRunner) => {
          await new KeepCodeRepositoriesOnGlobalRunners1807710000000().up(
            queryRunner,
          );
        });

        expect(await picksGlobalRunner("with default: picks none")).toBe(true);
        expect(await picksGlobalRunner("with default: picks none either")).toBe(
          false,
        );
        expect(
          await picksGlobalRunner("without default: picks none"),
        ).toBeNull();
      });

      test("the column is a nullable boolean with no default", async () => {
        const columns: Array<{
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }> = await database.query(
          `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'CodeRepository' AND column_name = 'isGlobalRunnerPicked'`,
          [schema],
        );

        expect(columns).toEqual([
          { data_type: "boolean", is_nullable: "YES", column_default: null },
        ]);
      });
    });

    describe("the claim", () => {
      beforeAll(async () => {
        /*
         * The repositories as people left them after the upgrade: the first
         * picks Global (as the migration wrote), the second follows.
         */
        await seedRun("run: picks none (picked Global at the upgrade)", {
          project: "with default",
          repository: "with default: picks none",
        });
        await seedRun("run: follows the default", {
          project: "with default",
          repository: "with default: picks none either",
        });
        await seedRun("run: picks other", {
          project: "with default",
          repository: "with default: picks other",
        });
        await seedRun("run: picks the default", {
          project: "with default",
          repository: "with default: picks the default",
        });
        await seedRun("run: no repository yet", { project: "with default" });
        await seedRun("run: without default", {
          project: "without default",
          repository: "without default: picks none",
        });
        await seedRun("run: agent default", {
          project: "agent default",
          repository: "agent default: picks none",
        });
        await seedRun("run: off", {
          project: "off",
          repository: "off: picks none",
        });
      });

      test("the project's default Runner takes the runs of the repositories that follow it and of the one that picked it", async () => {
        expect(
          await claimable(projectRunner("default", "with default")),
        ).toEqual([
          "run: follows the default",
          "run: no repository yet",
          "run: picks the default",
        ]);
      });

      test("another Runner of the project takes only the repository that picked it", async () => {
        expect(await claimable(projectRunner("other", "with default"))).toEqual(
          ["run: no repository yet", "run: picks other"],
        );
      });

      test("a global Runner takes the Global Runner's repositories and a project's without a default, never one that follows a default", async () => {
        expect(await claimable(GLOBAL_WORKER)).toEqual([
          "run: agent default",
          "run: no repository yet",
          "run: picks none (picked Global at the upgrade)",
          "run: without default",
        ]);
      });

      test("the in-cluster agent Runner is never a default: neither it nor a global Runner is stopped by it", async () => {
        expect(
          await claimable(
            projectRunner("agent default: Runner", "agent default"),
          ),
        ).toEqual([]);
      });

      test("a project that turned global Runners off: its default takes what follows it, no global Runner takes the rest", async () => {
        await setPicksGlobalRunner("off: picks none", null);

        expect(await claimable(projectRunner("off: default", "off"))).toEqual([
          "run: off",
        ]);
        expect(await claimable(GLOBAL_WORKER)).not.toContain("run: off");

        await setPicksGlobalRunner("off: picks none", true);

        expect(await claimable(projectRunner("off: default", "off"))).toEqual(
          [],
        );
        expect(await claimable(GLOBAL_WORKER)).not.toContain("run: off");
      });

      test("followed, not copied: when another Runner is the default, its runs move with it", async () => {
        await makeDefault("with default", "other");

        expect(await claimable(projectRunner("other", "with default"))).toEqual(
          [
            "run: follows the default",
            "run: no repository yet",
            "run: picks other",
          ],
        );
        expect(
          await claimable(projectRunner("default", "with default")),
        ).toEqual(["run: no repository yet", "run: picks the default"]);

        // With no default at all, a global Runner takes what followed it.
        await database.query(
          `UPDATE "${schema}"."Runner" SET "isProjectDefault" = false WHERE "projectId" = $1`,
          [id("with default")],
        );

        expect(await claimable(GLOBAL_WORKER)).toContain(
          "run: follows the default",
        );
        expect(
          await claimable(projectRunner("other", "with default")),
        ).not.toContain("run: follows the default");

        await makeDefault("with default", "default");
      });

      test("a repository that picks the Global Runner leaves the default", async () => {
        await setPicksGlobalRunner("with default: picks none either", true);

        expect(
          await claimable(projectRunner("default", "with default")),
        ).not.toContain("run: follows the default");
        expect(await claimable(GLOBAL_WORKER)).toContain(
          "run: follows the default",
        );

        await setPicksGlobalRunner("with default: picks none either", false);
      });

      test("a Runner never takes another project's runs, default or not", async () => {
        // Its own project's id is what the claim is held to.
        expect(
          await claimable(projectRunner("default", "without default")),
        ).toEqual([]);
      });
    });
  },
);
