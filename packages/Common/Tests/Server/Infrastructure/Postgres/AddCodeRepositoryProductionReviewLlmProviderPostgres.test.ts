import { AddCodeRepositoryProductionReviewLlmProvider1808330000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808330000000-AddCodeRepositoryProductionReviewLlmProvider";
import { AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808340000000-AddCodeRepositoryProductionReviewLlmProviderIndexAndKey";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddCodeRepositoryProductionReviewLlmProvider migrations against a
 * real Postgres, on real rows: a repository in Code may pick the LLM
 * provider OneUptime AI reads its pull requests with in production reviews
 * (CodeRepository.productionReviewLlmProviderId).
 *
 * Opt in with RUN_POSTGRES_PRODUCTION_REVIEW_LLM_PROVIDER_TESTS=true and
 * the normal database credentials;
 * PRODUCTION_REVIEW_LLM_PROVIDER_TEST_DATABASE_HOST / _PORT / _NAME point
 * it at a database other than the local development one. The database must
 * already be migrated: LlmProvider and CodeRepository are cloned from
 * public into a uniquely named schema (so the source's rows are never read
 * or modified) and put back as they were before the migrations - without
 * the pick - and both migrations' up() then run there, the second outside a
 * transaction as it runs for real. The schema is dropped afterwards.
 *
 * What it pins:
 *   - every repository there was picks none: the project's default
 *     provider, else the global one, as its reviews used before;
 *   - the pick is indexed, and its key to "LlmProvider" is validated -
 *     running the online migration again changes nothing;
 *   - a repository may pick one of the project's providers or a global one,
 *     and no provider that is not there;
 *   - A PROVIDER DELETED WHILE REPOSITORIES POINT AT IT leaves every
 *     repository that picked it picking none, and touches none that picked
 *     another.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PRODUCTION_REVIEW_LLM_PROVIDER_TESTS"] === "true"
    ? describe
    : describe.skip;

const COLUMN: string = "productionReviewLlmProviderId";
const INDEX: string = "IDX_0d6102e35d45ec40768554266e";
const FOREIGN_KEY: string = "FK_0d6102e35d45ec40768554266e0";

describePostgres(
  "AddCodeRepositoryProductionReviewLlmProvider against Postgres",
  () => {
    const schema: string = `review_llm_provider_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;

    const requiredColumnsByTable: Map<
      string,
      Array<{ column_name: string; udt_name: string }>
    > = new Map();

    const projectId: string = ObjectID.generate().toString();

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
     * was not given with a unique value of its type, so the seeds below
     * only say what the test is about.
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

    async function seedProvider(values: {
      projectId: string | null;
      isGlobalLlm: boolean;
    }): Promise<string> {
      return await insertRow("LlmProvider", {
        projectId: values.projectId,
        isGlobalLlm: values.isGlobalLlm,
        name: `provider-${ObjectID.generate().toString()}`,
      });
    }

    async function seedRepository(
      llmProviderId: string | null,
    ): Promise<string> {
      return await insertRow("CodeRepository", {
        projectId: projectId,
        name: `repository-${ObjectID.generate().toString()}`,
        ...(llmProviderId ? { [COLUMN]: llmProviderId } : {}),
      });
    }

    async function pickOf(id: string): Promise<string | null> {
      const rows: Array<Record<string, string | null>> = await database.query(
        `SELECT "${COLUMN}" FROM "${schema}"."CodeRepository" WHERE "_id" = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      return rows[0]![COLUMN] as string | null;
    }

    // A repository there before the migration, which picks nothing.
    let repositoryBefore: string = "";

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PRODUCTION_REVIEW_LLM_PROVIDER_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["PRODUCTION_REVIEW_LLM_PROVIDER_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PRODUCTION_REVIEW_LLM_PROVIDER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        schema: schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of ["LlmProvider", "CodeRepository"]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      /*
       * The table as it was BEFORE the migrations, whether or not the
       * source database has run them: without the pick.
       */
      await database.query(
        `ALTER TABLE "${schema}"."CodeRepository" DROP COLUMN IF EXISTS "${COLUMN}"`,
      );

      repositoryBefore = await insertRow("CodeRepository", {
        projectId: projectId,
        name: "repository before",
      });

      await runInSchema(async (queryRunner: QueryRunner) => {
        await new AddCodeRepositoryProductionReviewLlmProvider1808330000000().up(
          queryRunner,
        );
        await new AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000().up(
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

    test("every repository there was picks none: the project's default provider, else the global one", async () => {
      expect(await pickOf(repositoryBefore)).toBeNull();
    });

    test("the pick is indexed, and its key to LlmProvider is validated", async () => {
      const indexes: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexname = $3`,
        [schema, "CodeRepository", INDEX],
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.indexdef).toContain(`("${COLUMN}")`);

      const keys: Array<{
        convalidated: boolean;
        isToProviders: boolean;
        definition: string;
      }> = await database.query(
        `SELECT con.convalidated,
                con.confrelid = to_regclass($3) AS "isToProviders",
                pg_get_constraintdef(con.oid) AS definition
           FROM pg_constraint con
          WHERE con.conrelid = to_regclass($1) AND con.conname = $2`,
        [
          `"${schema}"."CodeRepository"`,
          FOREIGN_KEY,
          `"${schema}"."LlmProvider"`,
        ],
      );
      expect(keys).toHaveLength(1);
      expect(keys[0]!.convalidated).toBe(true);
      expect(keys[0]!.isToProviders).toBe(true);
      expect(keys[0]!.definition).toContain(`FOREIGN KEY ("${COLUMN}")`);
      expect(keys[0]!.definition).toContain("ON DELETE SET NULL");
    });

    test("running the online migration again changes nothing", async () => {
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new AddCodeRepositoryProductionReviewLlmProviderIndexAndKey1808340000000().up(
          queryRunner,
        );
      });

      const keys: Array<{ conname: string }> = await database.query(
        `SELECT con.conname FROM pg_constraint con
          WHERE con.conrelid = to_regclass($1) AND con.contype = 'f'`,
        [`"${schema}"."CodeRepository"`],
      );
      expect(
        keys.filter((key: { conname: string }): boolean => {
          return key.conname === FOREIGN_KEY;
        }),
      ).toHaveLength(1);

      const indexes: Array<{ indexname: string }> = await database.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexdef LIKE $3`,
        [schema, "CodeRepository", `%("${COLUMN}")%`],
      );
      expect(indexes).toEqual([{ indexname: INDEX }]);
    });

    test("a repository may pick one of the project's providers or a global one - and no provider that is not there", async () => {
      const own: string = await seedProvider({
        projectId: projectId,
        isGlobalLlm: false,
      });
      const global: string = await seedProvider({
        projectId: null,
        isGlobalLlm: true,
      });

      expect(await pickOf(await seedRepository(own))).toBe(own);
      expect(await pickOf(await seedRepository(global))).toBe(global);
      expect(await pickOf(await seedRepository(null))).toBeNull();

      await expect(
        seedRepository(ObjectID.generate().toString()),
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    test("a provider deleted while repositories point at it: every repository that picked it picks none, the others keep theirs", async () => {
      const doomed: string = await seedProvider({
        projectId: projectId,
        isGlobalLlm: false,
      });
      const kept: string = await seedProvider({
        projectId: projectId,
        isGlobalLlm: false,
      });

      const pickedDoomed: Array<string> = [
        await seedRepository(doomed),
        await seedRepository(doomed),
      ];
      const pickedKept: string = await seedRepository(kept);

      await database.query(
        `DELETE FROM "${schema}"."LlmProvider" WHERE "_id" = $1`,
        [doomed],
      );

      for (const repository of pickedDoomed) {
        expect(await pickOf(repository)).toBeNull();
      }
      expect(await pickOf(pickedKept)).toBe(kept);
    });
  },
);
