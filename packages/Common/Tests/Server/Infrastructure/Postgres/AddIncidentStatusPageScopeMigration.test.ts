import { AddIncidentStatusPageScope1795400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1795400000000-AddIncidentStatusPageScope";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * The schema half of per-incident status page scope: the incident and
 * incident template join tables to StatusPage, the incident's derived scope
 * flag and record of notified pages, and the status page's "only show scoped
 * incidents" switch.
 *
 * It pins that the migration matches the models (a mismatch is a green deploy
 * followed by a red Schema Drift job), that the join rows cascade with either
 * side - which is what keeps a deleted status page from widening an
 * incident's reach, together with the flag that nothing recomputes - that
 * every existing incident and page keeps today's behaviour without a
 * backfill, and that down() undoes up().
 *
 * Fake QueryRunner only. Generating the migration against a database with
 * every registered migration applied, applying it, and generating again to
 * "No changes in database schema were found" is how it was verified;
 * IncidentStatusPageScopePostgres exercises it against a real database.
 */

const OWN_CLASS_NAME: string = "AddIncidentStatusPageScope1795400000000";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1795400000000-AddIncidentStatusPageScope.ts",
);

function timestampOfClassName(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddIncidentStatusPageScope1795400000000()[direction](queryRunner);

  return statements;
}

function declaredColumn(
  target: new () => unknown,
  property: string,
): ColumnMetadataArgs {
  const declared: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (column: ColumnMetadataArgs): boolean => {
        return column.target === target && column.propertyName === property;
      },
    );

  if (!declared) {
    throw new Error(`${String(target)} declares no column ${property}`);
  }

  return declared;
}

function declaredJoinTable(
  target: new () => unknown,
  property: string,
): JoinTableMetadataArgs {
  const declared: JoinTableMetadataArgs | undefined =
    getMetadataArgsStorage().joinTables.find(
      (joinTable: JoinTableMetadataArgs): boolean => {
        return (
          joinTable.target === target && joinTable.propertyName === property
        );
      },
    );

  if (!declared) {
    throw new Error(`${String(target)} declares no join table ${property}`);
  }

  return declared;
}

function statementsMatching(
  statements: Array<string>,
  pattern: RegExp,
): Array<string> {
  return statements.filter((statement: string): boolean => {
    return pattern.test(statement);
  });
}

describe("AddIncidentStatusPageScope migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddIncidentStatusPageScope1795400000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered, so the schema actually reaches every database", () => {
    expect(registeredNames).toContain(OWN_CLASS_NAME);
  });

  test("its timestamp keeps it behind every migration registered before it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    expect(ownIndex).toBeGreaterThan(0);

    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    const notBehind: Array<string> = registeredNames
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= ownTimestamp;
      });

    expect(notBehind).toEqual([]);
  });
});

describe("AddIncidentStatusPageScope migration - up()", () => {
  test.each([
    {
      model: Incident,
      property: "statusPages",
      table: "IncidentStatusPage",
      ownerColumn: "incidentId",
      ownerTable: "Incident",
    },
    {
      model: IncidentTemplate,
      property: "statusPages",
      table: "IncidentTemplateStatusPage",
      ownerColumn: "incidentTemplateId",
      ownerTable: "IncidentTemplate",
    },
  ])(
    "creates $table as the model declares it, cascading with either side",
    async ({
      model,
      property,
      table,
      ownerColumn,
      ownerTable,
    }: {
      model: new () => unknown;
      property: string;
      table: string;
      ownerColumn: string;
      ownerTable: string;
    }) => {
      const joinTable: JoinTableMetadataArgs = declaredJoinTable(
        model,
        property,
      );

      expect(joinTable.name).toBe(table);
      expect(
        (joinTable.joinColumns as Array<{ name: string }> | undefined)?.[0]
          ?.name,
      ).toBe(ownerColumn);
      expect(
        (
          joinTable.inverseJoinColumns as Array<{ name: string }> | undefined
        )?.[0]?.name,
      ).toBe("statusPageId");

      const statements: Array<string> = await recordQueries("up");

      const created: Array<string> = statementsMatching(
        statements,
        new RegExp(`^CREATE TABLE "${table}" `),
      );

      expect(created).toHaveLength(1);
      expect(created[0]).toContain(
        `("${ownerColumn}" uuid NOT NULL, "statusPageId" uuid NOT NULL, CONSTRAINT`,
      );
      expect(created[0]).toContain(
        `PRIMARY KEY ("${ownerColumn}", "statusPageId")`,
      );

      // Both sides are indexed for the lookups each direction makes.
      for (const column of [ownerColumn, "statusPageId"]) {
        expect(
          statementsMatching(
            statements,
            new RegExp(
              `^CREATE INDEX "IDX_\\w+" ON "${table}" \\("${column}"\\)`,
            ),
          ),
        ).toHaveLength(1);
      }

      const foreignKeys: Array<string> = statementsMatching(
        statements,
        new RegExp(
          `^ALTER TABLE "${table}" ADD CONSTRAINT "FK_\\w+" FOREIGN KEY`,
        ),
      );

      expect(foreignKeys).toHaveLength(2);
      expect(
        foreignKeys.some((statement: string): boolean => {
          return statement.includes(
            `FOREIGN KEY ("${ownerColumn}") REFERENCES "${ownerTable}"("_id") ON DELETE CASCADE`,
          );
        }),
      ).toBe(true);
      /*
       * Deleting a status page takes its scope rows with it. The incident
       * keeps isScopedToStatusPages, so it is hidden rather than widened.
       */
      expect(
        foreignKeys.some((statement: string): boolean => {
          return statement.includes(
            `FOREIGN KEY ("statusPageId") REFERENCES "StatusPage"("_id") ON DELETE CASCADE`,
          );
        }),
      ).toBe(true);
    },
  );

  test("adds the three columns as the models declare them, keeping today's behaviour without a backfill", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statementsMatching(statements, /^ALTER TABLE "\w+" ADD "/)).toEqual([
      `ALTER TABLE "StatusPage" ADD "onlyShowScopedIncidents" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "Incident" ADD "isScopedToStatusPages" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "Incident" ADD "statusPagesNotifiedOnCreation" jsonb`,
    ]);

    for (const [model, property] of [
      [StatusPage, "onlyShowScopedIncidents"],
      [Incident, "isScopedToStatusPages"],
    ] as Array<[new () => unknown, string]>) {
      const declared: ColumnMetadataArgs = declaredColumn(model, property);

      expect(declared.options.type).toBe(ColumnType.Boolean);
      expect(declared.options.nullable).toBe(false);
      expect(declared.options.default).toBe(false);
    }

    const record: ColumnMetadataArgs = declaredColumn(
      Incident,
      "statusPagesNotifiedOnCreation",
    );

    expect(record.options.type).toBe(ColumnType.JSON);
    expect(record.options.nullable).toBe(true);

    // Every existing incident is unscoped and every page shows them: no UPDATE.
    expect(statementsMatching(statements, /^(UPDATE|INSERT|DELETE)/)).toEqual(
      [],
    );
  });

  /*
   * The migration alters Incident, so an index built on it in the same
   * transaction holds that ALTER's lock - which blocks reads - for the whole
   * build over the table. The flag is false on nearly every row, so an index
   * could not help the queries that split on it anyway.
   */
  test("builds no index on Incident, which it alters in the same transaction", async () => {
    expect(
      statementsMatching(
        await recordQueries("up"),
        /^CREATE INDEX "IDX_\w+" ON "Incident"/,
      ),
    ).toEqual([]);
    expect(
      getMetadataArgsStorage().indices.filter(
        (index: { target: unknown; columns?: unknown }): boolean => {
          return (
            index.target === Incident &&
            JSON.stringify(index.columns || []).includes(
              "isScopedToStatusPages",
            )
          );
        },
      ),
    ).toEqual([]);
  });

  test("touches no other table", async () => {
    const tables: Set<string> = new Set();

    for (const statement of await recordQueries("up")) {
      const match: RegExpMatchArray | null = statement.match(
        /^(?:CREATE TABLE|ALTER TABLE|CREATE INDEX "\w+" ON) "(\w+)"/,
      );

      if (match) {
        tables.add(match[1]!);
      }
    }

    expect([...tables].sort()).toEqual(
      [
        "Incident",
        "IncidentStatusPage",
        "IncidentTemplateStatusPage",
        "StatusPage",
      ].sort(),
    );
  });
});

describe("AddIncidentStatusPageScope migration - down()", () => {
  test("drops every table, column, index and constraint up() created", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    const createdNames: Array<string> = up
      .map((statement: string): string | null => {
        const constraint: RegExpMatchArray | null = statement.match(
          /ADD CONSTRAINT "(\w+)"/,
        );
        const index: RegExpMatchArray | null = statement.match(
          /^CREATE INDEX "(\w+)"/,
        );
        const table: RegExpMatchArray | null = statement.match(
          /^CREATE TABLE "(\w+)"/,
        );
        const column: RegExpMatchArray | null = statement.match(
          /^ALTER TABLE "\w+" ADD "(\w+)"/,
        );

        return (
          constraint?.[1] || index?.[1] || table?.[1] || column?.[1] || null
        );
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });

    for (const name of createdNames) {
      expect(
        down.some((statement: string): boolean => {
          return statement.includes(`"${name}"`);
        }),
      ).toBe(true);
    }

    // Constraints go before the tables and columns they depend on.
    const lastConstraintDrop: number = Math.max(
      ...down
        .map((statement: string, index: number): number => {
          return statement.includes("DROP CONSTRAINT") ? index : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        }),
    );
    const firstTableDrop: number = down.findIndex(
      (statement: string): boolean => {
        return statement.startsWith("DROP TABLE");
      },
    );

    expect(lastConstraintDrop).toBeLessThan(firstTableDrop);
  });
});
