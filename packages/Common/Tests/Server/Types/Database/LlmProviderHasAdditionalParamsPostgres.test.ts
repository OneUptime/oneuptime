import Entities from "../../../../Models/DatabaseModels/Index";
import LlmProvider, {
  getHasAdditionalParamsSql,
} from "../../../../Models/DatabaseModels/LlmProvider";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource, Repository } from "typeorm";

/*
 * LlmProvider.hasAdditionalParams against a migrated Postgres.
 *
 * Whether a provider has Additional Parameters is worked out by Postgres from
 * the parameters on every read that selects it (a virtual column built from
 * getHasAdditionalParamsSql): nothing stores it, so nothing can leave it
 * disagreeing with the parameters - not a write that skips the service's
 * hooks, not a raw repository write, not a provider saved before the column
 * existed. Here the rule meets every shape of stored parameters: nothing,
 * JSON null, the empty object, list and text, and an object, a list, text, a
 * number and a boolean that hold something.
 *
 * Reads go through TypeORM with the real entity metadata, the way every
 * service read does, against a structure-only clone of the MIGRATED
 * LlmProvider table (LIKE ... INCLUDING ALL) in a uniquely named schema that
 * is dropped afterwards; every row is synthetic.
 *
 * Opt in with RUN_POSTGRES_LLM_PROVIDER_PARAMS_FLAG_TESTS=true against a
 * database the registered migrations have been applied to:
 *
 *   RUN_POSTGRES_LLM_PROVIDER_PARAMS_FLAG_TESTS=true \
 *   LLM_PROVIDER_PARAMS_FLAG_TEST_DATABASE_HOST=127.0.0.1 \
 *   LLM_PROVIDER_PARAMS_FLAG_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Types/Database/LlmProviderHasAdditionalParamsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_LLM_PROVIDER_PARAMS_FLAG_TESTS"] === "true"
    ? describe
    : describe.skip;

/*
 * Stored parameters of every shape, as the SQL literal of the jsonb value,
 * and whether they count as saved.
 */
const SHAPES: Array<[string, string | null, boolean]> = [
  ["no parameters", null, false],
  ["JSON null", "null", false],
  ["an empty object", "{}", false],
  ["an empty object with spaces", "{ }", false],
  ["an object with an entry", `{"temperature": 0.2}`, true],
  ["a nested object", `{"extra_headers": {"x-team": "ops"}}`, true],
  ["an empty list", "[]", false],
  ["a list with an entry", "[1]", true],
  ["empty text", `""`, false],
  ["blank text", `" "`, true],
  ["text", `"x"`, true],
  ["zero", "0", true],
  ["false", "false", true],
  ["true", "true", true],
];

describePostgres("LlmProvider.hasAdditionalParams against Postgres", () => {
  const schema: string = `llm_provider_flag_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;
  let providers: Repository<LlmProvider>;
  const ids: Record<string, string> = {};

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
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        // The clone first: an unqualified "LlmProvider" resolves to it.
        options: `-c search_path=${schema},public`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    // The migrated table, columns, defaults and constraints alike.
    await database.query(
      `CREATE TABLE "${schema}"."LlmProvider" (LIKE public."LlmProvider" INCLUDING ALL)`,
    );

    for (const [name, literal] of SHAPES) {
      const rows: Array<{ _id: string }> = await database.query(
        `INSERT INTO "${schema}"."LlmProvider" ("version", "name", "slug", "llmType", "additionalParams") VALUES (1, $1, $2, 'OpenAI', ${
          literal === null ? "NULL" : `'${literal}'::jsonb`
        }) RETURNING "_id"`,
        [name, name.replace(/[^a-z]+/g, "-")],
      );

      ids[name] = rows[0]!._id;
    }

    providers = database.getRepository(LlmProvider);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function answerFor(name: string): Promise<boolean | undefined> {
    const provider: LlmProvider | null = await providers.findOne({
      where: { _id: ids[name] as never },
      select: { _id: true, name: true, hasAdditionalParams: true },
    });

    return provider?.hasAdditionalParams;
  }

  test("no migration stores it: the migrated table has no such column", async () => {
    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'LlmProvider' AND column_name = 'hasAdditionalParams'`,
    );

    expect(columns).toEqual([]);

    // The table it is read from is the migrated one, so the check means it.
    const parameters: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'LlmProvider' AND column_name = 'additionalParams'`,
    );

    expect(parameters).toHaveLength(1);
  });

  test.each(SHAPES)(
    "%s: saved is %s",
    async (name: string, _literal: string | null, expected: boolean) => {
      expect(await answerFor(name)).toBe(expected);
    },
  );

  test("a list read answers every row by the same rule", async () => {
    const rows: Array<LlmProvider> = await providers.find({
      select: { _id: true, name: true, hasAdditionalParams: true },
      order: { name: "ASC" },
    });

    expect(rows).toHaveLength(SHAPES.length);

    for (const row of rows) {
      const shape: [string, string | null, boolean] | undefined = SHAPES.find(
        (candidate: [string, string | null, boolean]): boolean => {
          return candidate[0] === row.name;
        },
      );

      expect({ name: row.name, saved: row.hasAdditionalParams }).toEqual({
        name: row.name,
        saved: shape![2],
      });
    }

    // Both answers are reached, so the comparison above is not vacuous.
    expect(
      rows.filter((row: LlmProvider): boolean => {
        return row.hasAdditionalParams === true;
      }).length,
    ).toBe(
      SHAPES.filter((shape: [string, string | null, boolean]): boolean => {
        return shape[2];
      }).length,
    );
  });

  test("the SQL the column is read with is the rule, run on its own", async () => {
    const rows: Array<{ name: string; saved: boolean }> = await database.query(
      `SELECT "name", ${getHasAdditionalParamsSql(`"provider"`)} AS "saved" FROM "${schema}"."LlmProvider" "provider"`,
    );

    for (const row of rows) {
      const shape: [string, string | null, boolean] | undefined = SHAPES.find(
        (candidate: [string, string | null, boolean]): boolean => {
          return candidate[0] === row.name;
        },
      );

      expect({ name: row.name, saved: row.saved }).toEqual({
        name: row.name,
        saved: shape![2],
      });
    }
  });

  test("a read that does not ask for it reads the row as before", async () => {
    const provider: LlmProvider | null = await providers.findOne({
      where: { _id: ids["an object with an entry"] as never },
      select: { _id: true, name: true },
    });

    expect(provider?.name).toBe("an object with an entry");
    expect(provider?.hasAdditionalParams).toBeUndefined();
  });

  test("changing the parameters changes the answer at once, however they are written", async () => {
    const id: string = ids["an empty object"]!;

    // A raw write, which no service hook sees.
    await database.query(
      `UPDATE "${schema}"."LlmProvider" SET "additionalParams" = '{"top_p": 0.9}'::jsonb WHERE "_id" = $1`,
      [id],
    );
    expect(await answerFor("an empty object")).toBe(true);

    // A repository write, which no service hook sees either.
    await providers.update(id as never, { additionalParams: {} } as never);
    expect(await answerFor("an empty object")).toBe(false);
  });

  test("a write that names it changes nothing: there is nothing to write to", async () => {
    const id: string = ids["no parameters"]!;

    await providers.update(
      id as never,
      { name: "no parameters", hasAdditionalParams: true } as never,
    );

    expect(await answerFor("no parameters")).toBe(false);
  });
});
