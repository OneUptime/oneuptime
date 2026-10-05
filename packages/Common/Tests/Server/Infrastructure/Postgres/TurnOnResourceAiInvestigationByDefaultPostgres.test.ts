import { TurnOnResourceAiInvestigationByDefault1798000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1798000000000-TurnOnResourceAiInvestigationByDefault";
import ObjectID from "../../../../Types/ObjectID";
import { ALL_AI_RESOURCE_TYPES } from "../../../../Types/ResourceAiAgent/AiResourceType";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The TurnOnResourceAiInvestigationByDefault migration against a real
 * Postgres, on real rows: every resource table's default turns on, the
 * resources nobody ever configured AI access for start investigating, and
 * nothing else moves — not a configured resource's switch either way, not
 * its fixes, not its allowlist, not the configured marker.
 *
 * Opt in with RUN_POSTGRES_RESOURCE_AI_INVESTIGATION_TESTS=true and the
 * normal database credentials; RESOURCE_AI_INVESTIGATION_TEST_DATABASE_HOST
 * / _PORT / _NAME point it at a database other than the local development
 * one. The database must already be migrated: the eight resource tables are
 * cloned from public into a uniquely named schema (so the source's rows are
 * never read or modified), the migration's own down() puts the defaults back
 * as they were before it, and up() then runs on seeded rows. The schema is
 * dropped afterwards.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RESOURCE_AI_INVESTIGATION_TESTS"] === "true"
    ? describe
    : describe.skip;

// The AiResourceType values are the resource tables' names.
const RESOURCE_TABLES: Array<string> = ALL_AI_RESOURCE_TYPES.map(String);

const CONFIGURED_AT: string = "2026-09-01T10:00:00.000Z";

interface RowSeed {
  isAiInvestigationEnabled: boolean;
  aiAccessConfiguredAt: string | null;
  aiRemediationMode: string;
  aiCommandAllowlist: Array<string> | null;
}

interface ResourceRow {
  isAiInvestigationEnabled: boolean;
  aiAccessConfiguredAt: Date | null;
  aiRemediationMode: string;
  aiCommandAllowlist: Array<string> | null;
}

// Every combination the update must tell apart, per table.
const SEEDS: Record<string, RowSeed> = {
  "never configured, off": {
    isAiInvestigationEnabled: false,
    aiAccessConfiguredAt: null,
    aiRemediationMode: "Disabled",
    aiCommandAllowlist: null,
  },
  // An agent that allowed writes connected: fixes ask first. Still unconfigured.
  "never configured, off, fixes asking": {
    isAiInvestigationEnabled: false,
    aiAccessConfiguredAt: null,
    aiRemediationMode: "RequireApproval",
    aiCommandAllowlist: ["restart *"],
  },
  // Its agent's first connection already turned investigation on.
  "never configured, on": {
    isAiInvestigationEnabled: true,
    aiAccessConfiguredAt: null,
    aiRemediationMode: "Disabled",
    aiCommandAllowlist: null,
  },
  "configured off by an operator": {
    isAiInvestigationEnabled: false,
    aiAccessConfiguredAt: CONFIGURED_AT,
    aiRemediationMode: "Automatic",
    aiCommandAllowlist: ["status *"],
  },
  "configured on by an operator": {
    isAiInvestigationEnabled: true,
    aiAccessConfiguredAt: CONFIGURED_AT,
    aiRemediationMode: "BypassApproval",
    aiCommandAllowlist: [],
  },
};

describePostgres(
  "TurnOnResourceAiInvestigationByDefault against Postgres",
  () => {
    const schema: string = `resource_ai_investigation_test_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;

    const requiredColumnsByTable: Map<
      string,
      Array<{ column_name: string; udt_name: string }>
    > = new Map();

    // table -> seed label -> row id
    const ids: Map<string, Map<string, string>> = new Map();
    let defaultsAfterDown: Map<string, string | null> = new Map();
    let defaultsAfterUp: Map<string, string | null> = new Map();
    let defaultsAfterSecondDown: Map<string, string | null> = new Map();
    const rowsAfterUp: Map<string, Map<string, ResourceRow>> = new Map();

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
     * was not given with a unique value of its type, so the seeds only say
     * what the test is about.
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
        } else if (column.udt_name === "int4" || column.udt_name === "int8") {
          row[column.column_name] = 1;
        } else if (column.udt_name === "bool") {
          row[column.column_name] = false;
        } else if (column.udt_name === "jsonb" || column.udt_name === "json") {
          row[column.column_name] = JSON.stringify({});
        } else if (column.udt_name === "timestamptz") {
          row[column.column_name] = new Date().toISOString();
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

    async function investigationDefaults(): Promise<
      Map<string, string | null>
    > {
      const rows: Array<{ table_name: string; column_default: string | null }> =
        await database.query(
          `SELECT table_name, column_default FROM information_schema.columns
         WHERE table_schema = $1 AND column_name = 'isAiInvestigationEnabled'`,
          [schema],
        );

      return new Map(
        rows.map(
          (row: {
            table_name: string;
            column_default: string | null;
          }): [string, string | null] => {
            return [row.table_name, row.column_default];
          },
        ),
      );
    }

    async function readRow(table: string, id: string): Promise<ResourceRow> {
      const rows: Array<ResourceRow> = await database.query(
        `SELECT "isAiInvestigationEnabled", "aiAccessConfiguredAt", "aiRemediationMode", "aiCommandAllowlist"
       FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    function idOf(table: string, label: string): string {
      return ids.get(table)!.get(label)!;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["RESOURCE_AI_INVESTIGATION_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["RESOURCE_AI_INVESTIGATION_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RESOURCE_AI_INVESTIGATION_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        schema: schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of RESOURCE_TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // The tables as they were BEFORE the migration, whether or not the source ran it.
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new TurnOnResourceAiInvestigationByDefault1798000000000().down(
          queryRunner,
        );
      });
      defaultsAfterDown = await investigationDefaults();

      for (const table of RESOURCE_TABLES) {
        const byLabel: Map<string, string> = new Map();

        for (const [label, seed] of Object.entries(SEEDS)) {
          byLabel.set(
            label,
            await insertRow(table, {
              projectId: ObjectID.generate().toString(),
              isAiInvestigationEnabled: seed.isAiInvestigationEnabled,
              aiAccessConfiguredAt: seed.aiAccessConfiguredAt,
              aiRemediationMode: seed.aiRemediationMode,
              aiCommandAllowlist:
                seed.aiCommandAllowlist === null
                  ? null
                  : JSON.stringify(seed.aiCommandAllowlist),
            }),
          );
        }

        ids.set(table, byLabel);
      }

      await runInSchema(async (queryRunner: QueryRunner) => {
        await new TurnOnResourceAiInvestigationByDefault1798000000000().up(
          queryRunner,
        );
      });
      defaultsAfterUp = await investigationDefaults();

      for (const table of RESOURCE_TABLES) {
        const byLabel: Map<string, ResourceRow> = new Map();
        for (const label of Object.keys(SEEDS)) {
          byLabel.set(label, await readRow(table, idOf(table, label)));
        }
        rowsAfterUp.set(table, byLabel);
      }

      // And back down, to see what a rollback keeps.
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new TurnOnResourceAiInvestigationByDefault1798000000000().down(
          queryRunner,
        );
      });
      defaultsAfterSecondDown = await investigationDefaults();
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("before it, every resource table defaulted investigation to off", () => {
      expect([...defaultsAfterDown.keys()].sort()).toEqual(
        [...RESOURCE_TABLES].sort(),
      );
      for (const table of RESOURCE_TABLES) {
        expect({ table, default: defaultsAfterDown.get(table) }).toEqual({
          table,
          default: "false",
        });
      }
    });

    test("after it, every resource table defaults investigation to on", () => {
      for (const table of RESOURCE_TABLES) {
        expect({ table, default: defaultsAfterUp.get(table) }).toEqual({
          table,
          default: "true",
        });
      }
    });

    test.each(RESOURCE_TABLES)(
      "%s: a never-configured resource with investigation off now investigates, and nothing else about it moved",
      (table: string) => {
        for (const label of [
          "never configured, off",
          "never configured, off, fixes asking",
        ]) {
          const seed: RowSeed = SEEDS[label]!;
          const row: ResourceRow = rowsAfterUp.get(table)!.get(label)!;

          expect({ label, ...row }).toEqual({
            label,
            isAiInvestigationEnabled: true,
            aiAccessConfiguredAt: null,
            aiRemediationMode: seed.aiRemediationMode,
            aiCommandAllowlist: seed.aiCommandAllowlist,
          });
        }
      },
    );

    test.each(RESOURCE_TABLES)(
      "%s: a never-configured resource already investigating is left as it was",
      (table: string) => {
        const row: ResourceRow = rowsAfterUp
          .get(table)!
          .get("never configured, on")!;

        expect(row).toEqual({
          isAiInvestigationEnabled: true,
          aiAccessConfiguredAt: null,
          aiRemediationMode: "Disabled",
          aiCommandAllowlist: null,
        });
      },
    );

    test.each(RESOURCE_TABLES)(
      "%s: a resource an operator configured keeps every setting, off or on",
      (table: string) => {
        for (const label of [
          "configured off by an operator",
          "configured on by an operator",
        ]) {
          const seed: RowSeed = SEEDS[label]!;
          const row: ResourceRow = rowsAfterUp.get(table)!.get(label)!;

          expect({ label, ...row }).toEqual({
            label,
            isAiInvestigationEnabled: seed.isAiInvestigationEnabled,
            aiAccessConfiguredAt: new Date(CONFIGURED_AT),
            aiRemediationMode: seed.aiRemediationMode,
            aiCommandAllowlist: seed.aiCommandAllowlist,
          });
        }
      },
    );

    test("a resource created after it, without saying, investigates", async () => {
      for (const table of RESOURCE_TABLES) {
        // The column is left out, as a new resource's insert leaves it out.
        const id: string = await insertRow(table, {
          projectId: ObjectID.generate().toString(),
        });

        // down() ran since, so this reads the default down() restored...
        expect((await readRow(table, id)).isAiInvestigationEnabled).toBe(false);
      }

      // ...and up() again gives a new resource investigation on.
      await runInSchema(async (queryRunner: QueryRunner) => {
        await new TurnOnResourceAiInvestigationByDefault1798000000000().up(
          queryRunner,
        );
      });

      for (const table of RESOURCE_TABLES) {
        const id: string = await insertRow(table, {
          projectId: ObjectID.generate().toString(),
        });
        const row: ResourceRow = await readRow(table, id);

        expect({ table, ...row }).toEqual({
          table,
          isAiInvestigationEnabled: true,
          aiAccessConfiguredAt: null,
          aiRemediationMode: "Disabled",
          aiCommandAllowlist: null,
        });
      }
    });

    test("down() puts the defaults back, and keeps every row as up() left it", async () => {
      for (const table of RESOURCE_TABLES) {
        expect({ table, default: defaultsAfterSecondDown.get(table) }).toEqual({
          table,
          default: "false",
        });
      }

      /*
       * Read back now: the "created after it" test above ran up() once more,
       * which must not have moved these rows either (it is idempotent).
       */
      for (const table of RESOURCE_TABLES) {
        for (const label of Object.keys(SEEDS)) {
          expect({
            table,
            label,
            ...(await readRow(table, idOf(table, label))),
          }).toEqual({
            table,
            label,
            ...rowsAfterUp.get(table)!.get(label)!,
          });
        }
      }
    });
  },
);
