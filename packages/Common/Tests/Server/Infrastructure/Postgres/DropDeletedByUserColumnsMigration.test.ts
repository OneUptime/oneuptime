import { describe, expect, test } from "@jest/globals";
import {
  DefaultNamingStrategy,
  getMetadataArgsStorage,
  QueryRunner,
} from "typeorm";
import { TableMetadataArgs } from "typeorm/metadata-args/TableMetadataArgs";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDataSecurityIssueGroupIndexesAndKeys1809187470380 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187470380-AddDataSecurityIssueGroupIndexesAndKeys";
import { AddRecordCreatedByAndLastModifiedColumns1809187400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187400000-AddRecordCreatedByAndLastModifiedColumns";
import {
  DELETED_BY_USER_ID_COLUMN,
  DELETED_BY_USER_TABLES,
  DeletedByUserTable,
  DropDeletedByUserColumns1809187480000,
  getDropDeletedByUserStatement,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187480000-DropDeletedByUserColumns";

/*
 * WHO DELETED A RECORD GOES FROM EVERY TABLE (#10469).
 *
 * No write ever filled deletedByUserId in, so its column and its foreign key
 * to "User" go from each of the 563 tables of the models that declared it,
 * as the generator wrote them (the drift check reads the schema they leave,
 * against the models). Each table goes on its own, outside a transaction,
 * so no table - and not "User", which every key's triggers are on - is held
 * while another waits, and a run that stopped part way can start again from
 * the top. These pin that shape, and its place in the migrations.
 * DropDeletedByUserColumnsPostgres runs it on Postgres.
 */

const NAMING: DefaultNamingStrategy = new DefaultNamingStrategy();

type Recorded = {
  runner: QueryRunner;
  statements: Array<string>;
  lookups: Array<{ statement: string; parameters: Array<unknown> }>;
};

/*
 * A query runner that records each statement, and answers the lookup of
 * the tables that still have the column with `remaining`.
 */
function recordQueries(remaining?: Array<string>): Recorded {
  const statements: Array<string> = [];
  const lookups: Array<{ statement: string; parameters: Array<unknown> }> = [];

  return {
    statements,
    lookups,
    runner: {
      query: async (
        statement: string,
        parameters?: Array<unknown>,
      ): Promise<unknown> => {
        if (statement.includes('"information_schema"."columns"')) {
          lookups.push({ statement, parameters: parameters || [] });

          return (remaining || TABLES).map(
            (table: string): { table_name: string } => {
              return { table_name: table };
            },
          );
        }

        statements.push(statement);
        return [];
      },
    } as unknown as QueryRunner,
  };
}

const TABLES: Array<string> = DELETED_BY_USER_TABLES.map(
  (entry: DeletedByUserTable): string => {
    return entry.table;
  },
);

// Every model's table, by the name TypeORM gives it ("ResellerPlan").
const MODEL_TYPES: Set<unknown> = new Set<unknown>(AllModelTypes);

const MODEL_TABLES: Set<string> = new Set<string>(
  getMetadataArgsStorage()
    .tables.filter((table: TableMetadataArgs): boolean => {
      return MODEL_TYPES.has(table.target);
    })
    .map((table: TableMetadataArgs): string => {
      return table.name || (table.target as { name: string }).name || "";
    }),
);

// What down() puts back for a table, as the generator wrote it.
function addColumnOf(entry: DeletedByUserTable): string {
  return `ALTER TABLE "${entry.table}" ADD "deletedByUserId" uuid`;
}

function addKeyOf(entry: DeletedByUserTable): string {
  return `ALTER TABLE "${entry.table}" ADD CONSTRAINT "${entry.foreignKey}" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;
}

function entryOf(table: string): DeletedByUserTable {
  const entry: DeletedByUserTable | undefined = DELETED_BY_USER_TABLES.find(
    (candidate: DeletedByUserTable): boolean => {
      return candidate.table === table;
    },
  );

  if (!entry) {
    throw new Error(`${table} is not dropped from`);
  }

  return entry;
}

describe("which tables", () => {
  test("563 tables, each once, each a model's table", () => {
    expect(TABLES).toHaveLength(563);
    expect(new Set(TABLES).size).toBe(TABLES.length);
    expect(
      TABLES.filter((table: string): boolean => {
        return !MODEL_TABLES.has(table);
      }),
    ).toEqual([]);
  });

  test("by the names TypeORM gives the tables, not the models' own spellings", () => {
    expect(TABLES).toContain("ResellerPlan");
    expect(TABLES).toContain("DataMigrations");
    expect(TABLES).not.toContain("Reseller Plan");
  });

  /*
   * TypeORM's own name for each key, but the one its model named itself
   * (foreignKeyConstraintName): the generator dropped each by the name the
   * database has.
   */
  const NAMED_BY_ITS_MODEL: Record<string, string> = {
    NetworkDeviceAutoImportRule: "FK_nd_auto_import_rule_deletedByUserId",
  };

  test("each key by the name the generator gave it, on 561 tables", () => {
    const keyed: Array<DeletedByUserTable> = DELETED_BY_USER_TABLES.filter(
      (entry: DeletedByUserTable): boolean => {
        return entry.foreignKey !== null;
      },
    );

    expect(keyed).toHaveLength(561);
    expect(
      new Set(
        keyed.map((entry: DeletedByUserTable): string | null => {
          return entry.foreignKey;
        }),
      ).size,
    ).toBe(561);

    for (const entry of keyed) {
      expect({ table: entry.table, key: entry.foreignKey }).toEqual({
        table: entry.table,
        key:
          NAMED_BY_ITS_MODEL[entry.table] ||
          NAMING.foreignKeyName(entry.table, [DELETED_BY_USER_ID_COLUMN]),
      });
    }
  });

  test("no key only where the model never had the relation: the two global sign-in links", () => {
    expect(
      DELETED_BY_USER_TABLES.filter((entry: DeletedByUserTable): boolean => {
        return entry.foreignKey === null;
      }).map((entry: DeletedByUserTable): string => {
        return entry.table;
      }),
    ).toEqual(["GlobalSSOProject", "GlobalOIDCProject"]);
  });

  test("not the tables of models that are gone, which go with their own moves", () => {
    for (const table of [
      "GoogleSecOpsConnection",
      "HuntressConnection",
      "AIInvestigationRule",
      "RunbookCredential",
      "RunbookSecret",
      "TelemetryService",
      "ServiceTelemetryService",
      "ProjectUser",
    ]) {
      expect([table, TABLES.includes(table)]).toEqual([table, false]);
    }
  });
});

describe("up", () => {
  test("runs outside a transaction, so each table and \"User\" are held for one statement alone", () => {
    expect(new DropDeletedByUserColumns1809187480000().transaction).toBe(
      false,
    );
  });

  test("drops each table's key and column in one statement, as the generator wrote them", async () => {
    const { runner, statements } = recordQueries();

    await new DropDeletedByUserColumns1809187480000().up(runner);

    expect(statements).toHaveLength(TABLES.length);
    expect(statements).toContain(
      `ALTER TABLE "Monitor" DROP CONSTRAINT IF EXISTS "${NAMING.foreignKeyName("Monitor", ["deletedByUserId"])}", DROP COLUMN IF EXISTS "deletedByUserId"`,
    );
    expect(statements).toContain(
      'ALTER TABLE "GlobalSSOProject" DROP COLUMN IF EXISTS "deletedByUserId"',
    );

    for (const statement of statements) {
      expect(statement.match(/ALTER TABLE/g)).toHaveLength(1);
      expect(statement.match(/DROP COLUMN IF EXISTS "deletedByUserId"/g))
        .toHaveLength(1);
      expect(statement).not.toMatch(/ADD |VALIDATE|INDEX|CASCADE/);
    }
  });

  test("in the order the generator dropped them, each table once", async () => {
    const { runner, statements } = recordQueries();

    await new DropDeletedByUserColumns1809187480000().up(runner);

    expect(statements).toEqual(
      DELETED_BY_USER_TABLES.map((entry: DeletedByUserTable): string => {
        return getDropDeletedByUserStatement(entry);
      }),
    );
  });

  test("asks which tables still have the column, by its name, in the migration's schema", async () => {
    const { runner, lookups } = recordQueries();

    await new DropDeletedByUserColumns1809187480000().up(runner);

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.statement).toContain("current_schema()");
    expect(lookups[0]!.parameters).toEqual(["deletedByUserId"]);
  });

  test("run again after a stop part way, passes the tables it dropped from without asking for their locks", async () => {
    const remaining: Array<string> = TABLES.slice(200);
    const { runner, statements } = recordQueries(remaining);

    await new DropDeletedByUserColumns1809187480000().up(runner);

    expect(statements).toHaveLength(TABLES.length - 200);

    for (const table of TABLES.slice(0, 200)) {
      expect(statements).not.toContain(
        getDropDeletedByUserStatement(entryOf(table)),
      );
    }
  });

  test("run again once every table is done - the old tables' columns left as they are - drops nothing", async () => {
    const { runner, statements } = recordQueries([
      "GoogleSecOpsConnection",
      "HuntressConnection",
    ]);

    await new DropDeletedByUserColumns1809187480000().up(runner);

    expect(statements).toEqual([]);
  });

  test("run by a runner that answers nothing, as a migration test records statements, drops from every table", async () => {
    const statements: Array<string> = [];

    await new DropDeletedByUserColumns1809187480000().up({
      query: async (statement: string): Promise<void> => {
        if (!statement.includes('"information_schema"."columns"')) {
          statements.push(statement);
        }
      },
    } as unknown as QueryRunner);

    expect(statements).toHaveLength(TABLES.length);
  });
});

describe("down", () => {
  test("puts every column back, last table first, then every key, as the generator wrote them", async () => {
    const { runner, statements } = recordQueries();

    await new DropDeletedByUserColumns1809187480000().down(runner);

    const reversed: Array<DeletedByUserTable> = [
      ...DELETED_BY_USER_TABLES,
    ].reverse();

    expect(statements).toEqual([
      ...reversed.map(addColumnOf),
      ...reversed
        .filter((entry: DeletedByUserTable): boolean => {
          return entry.foreignKey !== null;
        })
        .map(addKeyOf),
    ]);
    expect(statements).toHaveLength(563 + 561);
  });

  test("each column nullable, with its key to \"User\" set to null when the person goes", async () => {
    const { runner, statements } = recordQueries();

    await new DropDeletedByUserColumns1809187480000().down(runner);

    expect(statements).toContain(
      'ALTER TABLE "Monitor" ADD "deletedByUserId" uuid',
    );
    expect(statements).toContain(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "${entryOf("Monitor").foreignKey}" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // The two global sign-in links never had a key, and are given none.
    expect(
      statements.filter((statement: string): boolean => {
        return statement.startsWith('ALTER TABLE "GlobalSSOProject"');
      }),
    ).toEqual(['ALTER TABLE "GlobalSSOProject" ADD "deletedByUserId" uuid']);
  });
});

describe("its place among the migrations", () => {
  test("is registered exactly once, after the migrations that made its tables what they are", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((migration: unknown): boolean => {
        return migration === DropDeletedByUserColumns1809187480000;
      }),
    ).toHaveLength(1);
    expect(
      registered.indexOf(DropDeletedByUserColumns1809187480000),
    ).toBeGreaterThan(
      registered.indexOf(AddRecordCreatedByAndLastModifiedColumns1809187400000),
    );
    expect(
      registered.indexOf(DropDeletedByUserColumns1809187480000),
    ).toBeGreaterThan(
      registered.indexOf(AddDataSecurityIssueGroupIndexesAndKeys1809187470380),
    );
  });

  test("is named for what it does, with its number", () => {
    expect(new DropDeletedByUserColumns1809187480000().name).toBe(
      "DropDeletedByUserColumns1809187480000",
    );
  });
});
