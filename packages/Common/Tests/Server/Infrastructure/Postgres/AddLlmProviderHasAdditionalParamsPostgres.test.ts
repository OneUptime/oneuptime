import { AddLlmProviderHasAdditionalParams1801000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1801000000000-AddLlmProviderHasAdditionalParams";
import { Service as LlmProviderServiceClass } from "../../../../Server/Services/LlmProviderService";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The hasAdditionalParams migration against a migrated Postgres.
 *
 * Every create and every update that writes a provider's Additional
 * Parameters records whether any are saved, by the rule
 * LlmProviderService.hasAdditionalParams. The migration that added the
 * column fills it in for the providers that exist with SQL of its own, so
 * the two have to agree on every shape of stored parameters: an object, a
 * list, text, a number, a boolean, JSON null, nothing at all, and the empty
 * object, list and text.
 *
 * Runs the migration's own up() against a clone of the MIGRATED LlmProvider
 * table without the column, holding one provider of every shape, and holds
 * each provider's answer to the rule applied to what Postgres returns for its
 * parameters. Then runs down().
 *
 * Opt in with RUN_POSTGRES_LLM_PROVIDER_PARAMS_FLAG_TESTS=true against a
 * database the registered migrations have been applied to:
 *
 *   RUN_POSTGRES_LLM_PROVIDER_PARAMS_FLAG_TESTS=true \
 *   LLM_PROVIDER_PARAMS_FLAG_TEST_DATABASE_HOST=127.0.0.1 \
 *   LLM_PROVIDER_PARAMS_FLAG_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Infrastructure/Postgres/AddLlmProviderHasAdditionalParamsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. The table
 * is a structure-only clone (LIKE ... INCLUDING ALL) in a uniquely named
 * schema that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_LLM_PROVIDER_PARAMS_FLAG_TESTS"] === "true"
    ? describe
    : describe.skip;

// Stored parameters of every shape, as the SQL literal of the jsonb value.
const SHAPES: Array<[string, string | null]> = [
  ["no parameters", null],
  ["JSON null", "null"],
  ["an empty object", "{}"],
  ["an object with an entry", `{"temperature": 0.2}`],
  ["a nested object", `{"extra_headers": {"x-team": "ops"}}`],
  ["an empty list", "[]"],
  ["a list with an entry", "[1]"],
  ["empty text", `""`],
  ["blank text", `" \\t\\n "`],
  ["text", `"x"`],
  ["zero", "0"],
  ["false", "false"],
  ["true", "true"],
];

describePostgres(
  "LlmProvider.hasAdditionalParams migration against Postgres",
  () => {
    const schema: string = `llm_provider_flag_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["LLM_PROVIDER_PARAMS_FLAG_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["LLM_PROVIDER_PARAMS_FLAG_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["LLM_PROVIDER_PARAMS_FLAG_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: [],
        schema,
        synchronize: false,
        extra: {
          // The clone first: an unqualified "LlmProvider" resolves to it.
          options: `-c search_path=${schema}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);

      // The migrated table as it stood before this migration.
      await database.query(
        `CREATE TABLE "${schema}"."LlmProvider" (LIKE public."LlmProvider" INCLUDING ALL)`,
      );
      await database.query(
        `ALTER TABLE "${schema}"."LlmProvider" DROP COLUMN "hasAdditionalParams"`,
      );

      for (const [name, literal] of SHAPES) {
        await database.query(
          `INSERT INTO "${schema}"."LlmProvider" ("version", "name", "slug", "llmType", "additionalParams") VALUES (1, $1, $2, 'OpenAI', ${
            literal === null ? "NULL" : `'${literal}'::jsonb`
          })`,
          [name, name.replace(/[^a-z]+/g, "-")],
        );
      }
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function run(step: "up" | "down"): Promise<void> {
      const runner: QueryRunner = database.createQueryRunner();

      try {
        await new AddLlmProviderHasAdditionalParams1801000000000()[step](
          runner,
        );
      } finally {
        await runner.release();
      }
    }

    test("up() records, for every provider, what the write rule says of its parameters", async () => {
      await run("up");

      const rows: Array<{
        name: string;
        additionalParams: unknown;
        hasAdditionalParams: boolean;
      }> = await database.query(
        `SELECT "name", "additionalParams", "hasAdditionalParams" FROM "${schema}"."LlmProvider" ORDER BY "name"`,
      );

      expect(rows).toHaveLength(SHAPES.length);

      for (const row of rows) {
        expect({
          name: row.name,
          hasAdditionalParams: row.hasAdditionalParams,
        }).toEqual({
          name: row.name,
          hasAdditionalParams: LlmProviderServiceClass.hasAdditionalParams(
            row.additionalParams,
          ),
        });
      }

      // Both answers are reached, so the comparison above is not vacuous.
      expect(
        rows.filter((row: { hasAdditionalParams: boolean }): boolean => {
          return row.hasAdditionalParams;
        }).length,
      ).toBe(7);
    });

    test("a provider created afterwards starts with none saved", async () => {
      await database.query(
        `INSERT INTO "${schema}"."LlmProvider" ("version", "name", "slug", "llmType") VALUES (1, 'later', 'later', 'OpenAI')`,
      );

      const rows: Array<{ hasAdditionalParams: boolean }> =
        await database.query(
          `SELECT "hasAdditionalParams" FROM "${schema}"."LlmProvider" WHERE "name" = 'later'`,
        );

      expect(rows[0]!.hasAdditionalParams).toBe(false);
    });

    test("down() drops the column again", async () => {
      await run("down");

      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'LlmProvider' AND column_name = 'hasAdditionalParams'`,
        [schema],
      );

      expect(columns).toHaveLength(0);
    });
  },
);
