import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage, QueryRunner } from "typeorm";
import { TableMetadataArgs } from "typeorm/metadata-args/TableMetadataArgs";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddGuidedSetupRun1809187025300 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187025300-AddGuidedSetupRun";
import {
  AddRecordCreatedByAndLastModifiedColumns1809187200000,
  getAddRecordActorColumnsStatement,
  getDropRecordActorColumnsStatement,
  RECORD_ACTOR_COLUMN_DEFINITIONS,
  RECORD_ACTOR_TABLES,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187200000-AddRecordCreatedByAndLastModifiedColumns";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import {
  LAST_MODIFIED_BY_USER_COLUMN,
  RECORD_ACTOR_COLUMNS,
} from "../../../../Types/Database/RecordActor";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * WHAT CREATED EACH RECORD AND WHO LAST MODIFIED IT, ON EVERY TABLE (#10290).
 *
 * Six nullable columns on every model's table, as the generator wrote them
 * (the drift check reads the schema they leave, against the models), each
 * table altered on its own outside a transaction so no table is held while
 * another waits, and safe to run again after a stop part way: these pin
 * that shape, and its place in the migrations.
 */

type Recorded = {
  runner: QueryRunner;
  statements: Array<string>;
  lookups: Array<{ statement: string; parameters: Array<unknown> }>;
};

/*
 * A query runner that records each statement, and answers the lookup of the
 * tables that have every column already with `altered`.
 */
function recordQueries(altered: Array<string> = []): Recorded {
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
          return altered.map((table: string): { table_name: string } => {
            return { table_name: table };
          });
        }

        statements.push(statement);
        return [];
      },
    } as unknown as QueryRunner,
  };
}

/*
 * Every model's table, by the name TypeORM gives it - the entity's own name,
 * which a few models spell otherwise in their table metadata ("Reseller
 * Plan" is the ResellerPlan table).
 */
const MODEL_TYPES: Set<unknown> = new Set<unknown>(AllModelTypes);

const MODEL_TABLES: Array<string> = getMetadataArgsStorage()
  .tables.filter((table: TableMetadataArgs): boolean => {
    return MODEL_TYPES.has(table.target);
  })
  .map((table: TableMetadataArgs): string => {
    return table.name || (table.target as { name: string }).name || "";
  })
  .filter((table: string): boolean => {
    return table.length > 0;
  });

// The column as the generator writes a base model column of this type.
const POSTGRES_TYPE_OF: Partial<Record<TableColumnType, string>> = {
  [TableColumnType.ShortText]: `character varying(${ColumnLength.ShortText})`,
  [TableColumnType.ObjectID]: "uuid",
  [TableColumnType.Date]: "TIMESTAMP WITH TIME ZONE",
};

describe("which tables and columns", () => {
  test("every model's table, each once", () => {
    expect(RECORD_ACTOR_TABLES.length).toBe(MODEL_TABLES.length);
    expect(new Set(RECORD_ACTOR_TABLES).size).toBe(RECORD_ACTOR_TABLES.length);
    expect([...RECORD_ACTOR_TABLES].sort()).toEqual([...MODEL_TABLES].sort());
  });

  test("the base model's six columns, as each is declared", () => {
    const model: DatabaseBaseModel = new DatabaseBaseModel();

    // The relation shares its id column, which the migration adds.
    const stored: Array<string> = RECORD_ACTOR_COLUMNS.filter(
      (column: string): boolean => {
        return column !== LAST_MODIFIED_BY_USER_COLUMN;
      },
    );

    expect(
      RECORD_ACTOR_COLUMN_DEFINITIONS.map(
        (definition: { name: string }): string => {
          return definition.name;
        },
      ),
    ).toEqual(stored);

    for (const definition of RECORD_ACTOR_COLUMN_DEFINITIONS) {
      const type: TableColumnType = model.getTableColumnMetadata(
        definition.name,
      ).type;

      expect({
        column: definition.name,
        definition: definition.definition,
      }).toEqual({
        column: definition.name,
        definition: POSTGRES_TYPE_OF[type],
      });
    }
  });

  test("nullable, with no default, index or key: a change of each table's catalog entry", () => {
    for (const table of RECORD_ACTOR_TABLES) {
      expect(getAddRecordActorColumnsStatement(table)).not.toMatch(
        /NOT NULL|DEFAULT|INDEX|CONSTRAINT|FOREIGN KEY|REFERENCES|UPDATE |DELETE /,
      );
    }
  });
});

describe("up", () => {
  test("runs outside a transaction, so each table is held for its own statement alone", () => {
    expect(
      new AddRecordCreatedByAndLastModifiedColumns1809187200000().transaction,
    ).toBe(false);
  });

  test("alters each table once, with all six columns in one statement", async () => {
    const { runner, statements } = recordQueries();

    await new AddRecordCreatedByAndLastModifiedColumns1809187200000().up(
      runner,
    );

    expect(statements).toHaveLength(RECORD_ACTOR_TABLES.length);
    expect(statements).toContain(
      'ALTER TABLE "Monitor" ADD COLUMN IF NOT EXISTS "createdByActorType" character varying(100), ADD COLUMN IF NOT EXISTS "createdByActorId" uuid, ADD COLUMN IF NOT EXISTS "lastModifiedAt" TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS "lastModifiedByActorType" character varying(100), ADD COLUMN IF NOT EXISTS "lastModifiedByActorId" uuid, ADD COLUMN IF NOT EXISTS "lastModifiedByUserId" uuid',
    );

    for (const statement of statements) {
      expect(statement.match(/ALTER TABLE/g)).toHaveLength(1);
      expect(statement.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(6);
    }
  });

  test("asks which tables have every column already, by the six names", async () => {
    const { runner, lookups } = recordQueries();

    await new AddRecordCreatedByAndLastModifiedColumns1809187200000().up(
      runner,
    );

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.parameters).toEqual([
      RECORD_ACTOR_COLUMN_DEFINITIONS.map(
        (definition: { name: string }): string => {
          return definition.name;
        },
      ),
      6,
    ]);
  });

  test("run again after a stop part way, passes the tables it altered without asking for their locks", async () => {
    const altered: Array<string> = RECORD_ACTOR_TABLES.slice(0, 200);
    const { runner, statements } = recordQueries(altered);

    await new AddRecordCreatedByAndLastModifiedColumns1809187200000().up(
      runner,
    );

    expect(statements).toHaveLength(RECORD_ACTOR_TABLES.length - 200);

    for (const table of altered) {
      expect(statements).not.toContain(
        getAddRecordActorColumnsStatement(table),
      );
    }
  });

  test("run again once every table is altered, alters nothing", async () => {
    const { runner, statements } = recordQueries([...RECORD_ACTOR_TABLES]);

    await new AddRecordCreatedByAndLastModifiedColumns1809187200000().up(
      runner,
    );

    expect(statements).toEqual([]);
  });
});

describe("down", () => {
  test("drops the six columns of each table, in the order the generator drops them", async () => {
    const { runner, statements } = recordQueries();

    await new AddRecordCreatedByAndLastModifiedColumns1809187200000().down(
      runner,
    );

    expect(statements).toHaveLength(RECORD_ACTOR_TABLES.length);
    expect(statements).toContain(getDropRecordActorColumnsStatement("Monitor"));
    expect(getDropRecordActorColumnsStatement("Monitor")).toBe(
      'ALTER TABLE "Monitor" DROP COLUMN IF EXISTS "lastModifiedByUserId", DROP COLUMN IF EXISTS "lastModifiedByActorId", DROP COLUMN IF EXISTS "lastModifiedByActorType", DROP COLUMN IF EXISTS "lastModifiedAt", DROP COLUMN IF EXISTS "createdByActorId", DROP COLUMN IF EXISTS "createdByActorType"',
    );
  });
});

describe("its place among the migrations", () => {
  test("is registered exactly once, after the last migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((migration: unknown): boolean => {
        return (
          migration === AddRecordCreatedByAndLastModifiedColumns1809187200000
        );
      }),
    ).toHaveLength(1);
    expect(
      registered.indexOf(AddRecordCreatedByAndLastModifiedColumns1809187200000),
    ).toBeGreaterThan(registered.indexOf(AddGuidedSetupRun1809187025300));
  });

  test("is named for what it does, with its number", () => {
    expect(
      new AddRecordCreatedByAndLastModifiedColumns1809187200000().name,
    ).toBe("AddRecordCreatedByAndLastModifiedColumns1809187200000");
  });
});
