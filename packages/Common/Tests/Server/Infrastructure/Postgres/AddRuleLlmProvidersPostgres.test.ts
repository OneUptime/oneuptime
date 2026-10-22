import { AddRuleLlmProviders1805920000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805920000000-AddRuleLlmProviders";
import { AddRuleLlmProviderIndexesAndKeys1805930000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805930000000-AddRuleLlmProviderIndexesAndKeys";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddRuleLlmProviders migrations against a real Postgres, on real rows:
 * every AI rule may pick the LLM provider its work uses, and a run records
 * the pick of the rule that started it (Common/Types/AI/LlmProviderChoice).
 *
 * Opt in with RUN_POSTGRES_RULE_LLM_PROVIDER_TESTS=true and the normal
 * database credentials; RULE_LLM_PROVIDER_TEST_DATABASE_HOST / _PORT / _NAME
 * point it at a database other than the local development one. The
 * database must already be migrated: LlmProvider, the three rule tables and
 * AIRun are cloned from public into a uniquely named schema (so the
 * source's rows are never read or modified) and put back as they were
 * before the migrations - without the pick - and both migrations' up() then
 * run there, the second outside a transaction as it runs for real. The
 * schema is dropped afterwards.
 *
 * What it pins:
 *   - every rule there was picks none: the project's default provider, else
 *     the global one, as its work used before;
 *   - each rule's pick is indexed, and its key to "LlmProvider" is
 *     validated - running the online migration again changes nothing;
 *   - a rule may pick one of the project's providers or a global one, and
 *     no provider that is not there;
 *   - A PROVIDER DELETED WHILE RULES POINT AT IT leaves every rule that
 *     picked it - of each kind - picking none, and touches no rule that
 *     picked another; a run that recorded it keeps the pick, so it can say
 *     why it used another provider.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RULE_LLM_PROVIDER_TESTS"] === "true"
    ? describe
    : describe.skip;

const RULE_TABLES: Array<string> = [
  "AutoRemediationRule",
  "AIInvestigationRule",
  "AIPostmortemRule",
];

const CLONED_TABLES: Array<string> = ["LlmProvider", ...RULE_TABLES, "AIRun"];

const INDEXES: Record<string, string> = {
  AutoRemediationRule: "IDX_1da91a0497a685dcc14535aa68",
  AIInvestigationRule: "IDX_42204354d038fc00dc63646b72",
  AIPostmortemRule: "IDX_57fa7734d3e32175d6100fb8d0",
};

const FOREIGN_KEYS: Record<string, string> = {
  AutoRemediationRule: "FK_1da91a0497a685dcc14535aa681",
  AIInvestigationRule: "FK_42204354d038fc00dc63646b72b",
  AIPostmortemRule: "FK_57fa7734d3e32175d6100fb8d00",
};

describePostgres("AddRuleLlmProviders against Postgres", () => {
  const schema: string = `rule_llm_provider_test_${ObjectID.generate()
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
   * was not given with a unique value of its type, so the seeds below only
   * say what the test is about.
   */
  async function insertRow(
    table: string,
    values: Record<string, unknown>,
  ): Promise<string> {
    let required: Array<{ column_name: string; udt_name: string }> | undefined =
      requiredColumnsByTable.get(table);

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

  async function seedRule(
    table: string,
    llmProviderId: string | null,
  ): Promise<string> {
    return await insertRow(table, {
      projectId: projectId,
      name: `${table}-${ObjectID.generate().toString()}`,
      ...(llmProviderId ? { llmProviderId } : {}),
    });
  }

  async function pickOf(table: string, id: string): Promise<string | null> {
    const rows: Array<{ llmProviderId: string | null }> = await database.query(
      `SELECT "llmProviderId" FROM "${schema}"."${table}" WHERE "_id" = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.llmProviderId;
  }

  // Rules there before the migration, which pick nothing.
  const rulesBefore: Map<string, string> = new Map();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["RULE_LLM_PROVIDER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["RULE_LLM_PROVIDER_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["RULE_LLM_PROVIDER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of CLONED_TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    /*
     * The tables as they were BEFORE the migrations, whether or not the
     * source database has run them: without the pick.
     */
    for (const table of [...RULE_TABLES, "AIRun"]) {
      await database.query(
        `ALTER TABLE "${schema}"."${table}" DROP COLUMN IF EXISTS "llmProviderId"`,
      );
    }

    for (const table of RULE_TABLES) {
      rulesBefore.set(
        table,
        await insertRow(table, {
          projectId: projectId,
          name: `${table} before`,
        }),
      );
    }

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddRuleLlmProviders1805920000000().up(queryRunner);
      await new AddRuleLlmProviderIndexesAndKeys1805930000000().up(queryRunner);
    });
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("every rule there was picks none: the project's default provider, else the global one", async () => {
    for (const table of RULE_TABLES) {
      expect(await pickOf(table, rulesBefore.get(table)!)).toBeNull();
    }
  });

  test("each rule's pick is indexed, and its key to LlmProvider is validated", async () => {
    for (const table of RULE_TABLES) {
      const indexes: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexname = $3`,
        [schema, table, INDEXES[table]],
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.indexdef).toContain(`("llmProviderId")`);

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
          `"${schema}"."${table}"`,
          FOREIGN_KEYS[table],
          `"${schema}"."LlmProvider"`,
        ],
      );
      expect(keys).toHaveLength(1);
      expect(keys[0]!.convalidated).toBe(true);
      expect(keys[0]!.isToProviders).toBe(true);
      expect(keys[0]!.definition).toContain(`FOREIGN KEY ("llmProviderId")`);
      expect(keys[0]!.definition).toContain("ON DELETE SET NULL");
    }
  });

  test("a run's pick has no key: no constraint names it", async () => {
    const keys: Array<{ conname: string }> = await database.query(
      `SELECT con.conname FROM pg_constraint con
        WHERE con.conrelid = to_regclass($1) AND con.contype = 'f'
          AND pg_get_constraintdef(con.oid) LIKE '%llmProviderId%'`,
      [`"${schema}"."AIRun"`],
    );
    expect(keys).toEqual([]);
  });

  test("running the online migration again changes nothing", async () => {
    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddRuleLlmProviderIndexesAndKeys1805930000000().up(queryRunner);
    });

    for (const table of RULE_TABLES) {
      const keys: Array<{ conname: string }> = await database.query(
        `SELECT con.conname FROM pg_constraint con
          WHERE con.conrelid = to_regclass($1) AND con.contype = 'f'`,
        [`"${schema}"."${table}"`],
      );
      expect(
        keys.filter((key: { conname: string }): boolean => {
          return key.conname === FOREIGN_KEYS[table];
        }),
      ).toHaveLength(1);
    }
  });

  test("a rule may pick one of the project's providers or a global one - and no provider that is not there", async () => {
    const own: string = await seedProvider({
      projectId: projectId,
      isGlobalLlm: false,
    });
    const global: string = await seedProvider({
      projectId: null,
      isGlobalLlm: true,
    });

    for (const table of RULE_TABLES) {
      const ownPick: string = await seedRule(table, own);
      const globalPick: string = await seedRule(table, global);

      expect(await pickOf(table, ownPick)).toBe(own);
      expect(await pickOf(table, globalPick)).toBe(global);

      await expect(
        seedRule(table, ObjectID.generate().toString()),
      ).rejects.toThrow(/violates foreign key constraint/);
    }
  });

  test("a provider deleted while rules point at it: every rule that picked it picks none, the others keep theirs, and a run keeps its pick", async () => {
    const doomed: string = await seedProvider({
      projectId: projectId,
      isGlobalLlm: false,
    });
    const kept: string = await seedProvider({
      projectId: projectId,
      isGlobalLlm: false,
    });

    const pickedDoomed: Map<string, string> = new Map();
    const pickedKept: Map<string, string> = new Map();

    for (const table of RULE_TABLES) {
      pickedDoomed.set(table, await seedRule(table, doomed));
      pickedKept.set(table, await seedRule(table, kept));
    }

    const run: string = await insertRow("AIRun", {
      projectId: projectId,
      llmProviderId: doomed,
    });

    await database.query(
      `DELETE FROM "${schema}"."LlmProvider" WHERE "_id" = $1`,
      [doomed],
    );

    for (const table of RULE_TABLES) {
      expect(await pickOf(table, pickedDoomed.get(table)!)).toBeNull();
      expect(await pickOf(table, pickedKept.get(table)!)).toBe(kept);
    }

    // The run remembers the pick it was queued with, to say why it fell back.
    expect(await pickOf("AIRun", run)).toBe(doomed);
  });
});
