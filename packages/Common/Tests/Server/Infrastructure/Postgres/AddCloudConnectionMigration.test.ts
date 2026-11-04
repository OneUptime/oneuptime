import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddCloudConnection1805400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805400000000-AddCloudConnection";
import { AddCloudResourceCloudConnectionIndexAndKey1805450000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805450000000-AddCloudResourceCloudConnectionIndexAndKey";
import { AddCloudConnectionStreams1808992600000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808992600000-AddCloudConnectionStreams";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../Types/Dictionary";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Cloud connections add one table, "CloudConnection" (AWS accounts, Azure
 * subscriptions and Google Cloud projects read on a schedule), and one
 * column, "CloudResource"."cloudConnectionId" (the connection that found a
 * resource). The table is new, so its indexes and keys are built on an
 * empty table; the column is nullable with no default, so adding it
 * rewrites nothing, and its index and foreign key are built online, in a
 * migration of their own outside a transaction, on a table ingest writes
 * all the time.
 *
 * Later migrations add columns to "CloudConnection" (the streams' key,
 * when it was made and what they delivered): together with the table they
 * must give exactly the columns the model declares.
 */

const TABLE_MIGRATION: string = "AddCloudConnection1805400000000";
const KEY_MIGRATION: string =
  "AddCloudResourceCloudConnectionIndexAndKey1805450000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const RESOURCE_INDEX: string = `CREATE INDEX "IDX_e8eacdbd89826e4ceb6f25d91c" ON "CloudResource" ("cloudConnectionId") `;
const RESOURCE_KEY: string = `ALTER TABLE "CloudResource" ADD CONSTRAINT "FK_e8eacdbd89826e4ceb6f25d91c8" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

type MigrationClass = new () => MigrationInterface;

const MIGRATIONS: Array<MigrationClass> = [
  AddCloudConnection1805400000000,
  AddCloudResourceCloudConnectionIndexAndKey1805450000000,
];

// Every later migration that adds a column to "CloudConnection", oldest first.
const COLUMN_MIGRATIONS: Array<MigrationClass> = [
  AddCloudConnectionStreams1808992600000,
];

const MIGRATIONS_FOLDER: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const ADDED_COLUMN: RegExp = /^ALTER TABLE "CloudConnection" ADD "([^"]+)"/;

async function record(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    isTransactionActive: false,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  for (const step of ["createIndex", "addForeignKey", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      steps.push(`online: ${statement}`);
    }) as never);
  }

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

// The columns a CREATE TABLE statement lists, constraints left out.
function columnsOf(createTable: string): Array<string> {
  const list: string = createTable.slice(
    createTable.indexOf("(") + 1,
    createTable.lastIndexOf(")"),
  );

  return list
    .split(", ")
    .filter((part: string): boolean => {
      return part.startsWith('"');
    })
    .map((part: string): string => {
      return part.slice(1, part.indexOf('"', 1));
    });
}

// The model's columns kept in its own table: relations are other tables' rows.
function storedColumnsOf(
  columns: Dictionary<TableColumnMetadata>,
): Array<string> {
  return Object.keys(columns).filter((key: string): boolean => {
    return (
      columns[key]!.type !== TableColumnType.Entity &&
      columns[key]!.type !== TableColumnType.EntityArray
    );
  });
}

function quotedNamesAfter(
  statements: Array<string>,
  marker: string,
): Array<string> {
  return statements
    .filter((statement: string): boolean => {
      return statement.includes(marker);
    })
    .map((statement: string): string => {
      const start: number = statement.indexOf(marker) + marker.length;

      return statement.slice(start, statement.indexOf('"', start));
    })
    .sort();
}

// The columns the given migrations' up adds to "CloudConnection", in order.
async function addedColumnsOf(
  migrations: Array<MigrationClass>,
): Promise<Array<string>> {
  const columns: Array<string> = [];

  for (const migration of migrations) {
    for (const statement of await record(new migration(), "up")) {
      const match: RegExpMatchArray | null = statement.match(ADDED_COLUMN);

      if (match) {
        columns.push(match[1]!);
      }
    }
  }

  return columns;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the cloud connection migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(new AddCloudConnection1805400000000().name).toBe(TABLE_MIGRATION);
    expect(
      new AddCloudResourceCloudConnectionIndexAndKey1805450000000().name,
    ).toBe(KEY_MIGRATION);
  });

  test("are registered once each, the index and key right after the table, after every older migration", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(AddCloudConnection1805400000000);

    for (const migration of MIGRATIONS) {
      expect(
        registered.filter((candidate: MigrationClass): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(at).toBeGreaterThan(0);
    expect(registered[at + 1]).toBe(
      AddCloudResourceCloudConnectionIndexAndKey1805450000000,
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddCloudConnection1805400000000),
      );
    }
  });

  test("are backed by exactly one file each", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    for (const migration of MIGRATIONS) {
      expect(
        files.filter((file: string): boolean => {
          return file.startsWith(`${timestampOf(migration)}-`);
        }),
      ).toHaveLength(1);
    }
  });

  test("create the connections table, with the columns later migrations add, as exactly the columns the model declares", async () => {
    const statements: Array<string> = await record(
      new AddCloudConnection1805400000000(),
      "up",
    );
    const createTable: string = statements[0]!;
    const added: Array<string> = await addedColumnsOf(COLUMN_MIGRATIONS);

    expect(createTable).toContain('CREATE TABLE "CloudConnection"');
    expect([...columnsOf(createTable), ...added].sort()).toEqual(
      storedColumnsOf(getTableColumns(new CloudConnection())).sort(),
    );
    // A new connection is read as soon as it is saved.
    expect(createTable).toContain('"isEnabled" boolean NOT NULL DEFAULT true');
  });

  test("later migrations add each column once, none the table already has", async () => {
    const createTable: string = (
      await record(new AddCloudConnection1805400000000(), "up")
    )[0]!;
    const added: Array<string> = await addedColumnsOf(COLUMN_MIGRATIONS);

    expect(added.length).toBeGreaterThan(0);
    expect(new Set(added).size).toBe(added.length);
    expect(
      added.filter((column: string): boolean => {
        return columnsOf(createTable).includes(column);
      }),
    ).toEqual([]);
  });

  test("a later column is nullable with no default, so adding it rewrites nothing", async () => {
    for (const migration of COLUMN_MIGRATIONS) {
      const adds: Array<string> = (await record(new migration(), "up")).filter(
        (statement: string): boolean => {
          return ADDED_COLUMN.test(statement);
        },
      );

      expect(adds.length).toBeGreaterThan(0);

      for (const statement of adds) {
        expect(statement).not.toContain("NOT NULL");
        expect(statement).not.toContain("DEFAULT");
      }
    }
  });

  test("down drops every column a later migration adds", async () => {
    for (const migration of COLUMN_MIGRATIONS) {
      const dropped: Array<string> = (await record(new migration(), "down"))
        .map((statement: string): string | null => {
          const match: RegExpMatchArray | null = statement.match(
            /^ALTER TABLE "CloudConnection" DROP COLUMN "([^"]+)"/,
          );

          return match ? match[1]! : null;
        })
        .filter((column: string | null): column is string => {
          return column !== null;
        });

      expect(dropped.sort()).toEqual(
        (await addedColumnsOf([migration])).sort(),
      );
    }
  });

  test("every migration file that adds a column to the connections table is listed here, oldest first", () => {
    const files: Array<string> = fs
      .readdirSync(MIGRATIONS_FOLDER)
      .filter((file: string): boolean => {
        return /^\d{13}-.+\.ts$/.test(file);
      })
      .filter((file: string): boolean => {
        const source: string = fs.readFileSync(
          path.join(MIGRATIONS_FOLDER, file),
          "utf8",
        );

        return /ALTER TABLE "CloudConnection" ADD "/.test(source);
      })
      .sort();

    expect(
      files.map((file: string): number => {
        return parseInt(file.slice(0, 13), 10);
      }),
    ).toEqual(COLUMN_MIGRATIONS.map(timestampOf));
  });

  test("keep the credentials in one column the model encrypts, never empty", async () => {
    const createTable: string = (
      await record(new AddCloudConnection1805400000000(), "up")
    )[0]!;

    expect(createTable).toContain('"secrets" text NOT NULL');
    expect(getTableColumns(new CloudConnection())["secrets"]!.encrypted).toBe(
      true,
    );
    expect(
      columnsOf(createTable).filter((column: string): boolean => {
        return column.toLowerCase().includes("secret");
      }),
    ).toEqual(["secrets"]);
  });

  test("add the resource's connection as a plain nullable column: no default, no rewrite", async () => {
    const statements: Array<string> = await record(
      new AddCloudConnection1805400000000(),
      "up",
    );

    expect(statements).toContain(
      `ALTER TABLE "CloudResource" ADD "cloudConnectionId" uuid`,
    );
    // Its index and key are not built here, inside the transaction.
    expect(
      statements.filter((statement: string): boolean => {
        return (
          statement.includes(`ON "CloudResource"`) ||
          statement.startsWith(`ALTER TABLE "CloudResource" ADD CONSTRAINT`)
        );
      }),
    ).toEqual([]);
  });

  test("build the resource column's index and its key online, outside a transaction", async () => {
    const migration: AddCloudResourceCloudConnectionIndexAndKey1805450000000 =
      new AddCloudResourceCloudConnectionIndexAndKey1805450000000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([
      `online: ${RESOURCE_INDEX}`,
      `online: ${RESOURCE_KEY}`,
    ]);
  });

  test("a deleted connection leaves its resources, found by no connection", () => {
    expect(RESOURCE_KEY).toContain(`REFERENCES "CloudConnection"("_id")`);
    expect(RESOURCE_KEY).toContain("ON DELETE SET NULL");
  });

  test("a deleted project takes its connections with it; a deleted service or user does not", async () => {
    const statements: Array<string> = await record(
      new AddCloudConnection1805400000000(),
      "up",
    );
    const keyOf: (column: string) => string = (column: string): string => {
      return statements.find((statement: string): boolean => {
        return statement.includes(`FOREIGN KEY ("${column}")`);
      })!;
    };

    expect(keyOf("projectId")).toContain("ON DELETE CASCADE");
    expect(keyOf("serviceId")).toContain("ON DELETE SET NULL");
    expect(keyOf("createdByUserId")).toContain("ON DELETE SET NULL");
    expect(keyOf("deletedByUserId")).toContain("ON DELETE SET NULL");
  });

  test("down takes away every index, key, column and table up adds, the table last", async () => {
    const up: Array<string> = await record(
      new AddCloudConnection1805400000000(),
      "up",
    );
    const down: Array<string> = await record(
      new AddCloudConnection1805400000000(),
      "down",
    );

    expect(quotedNamesAfter(down, 'DROP INDEX "public"."')).toEqual(
      quotedNamesAfter(up, 'CREATE INDEX "'),
    );
    expect(quotedNamesAfter(down, 'DROP CONSTRAINT "')).toEqual(
      quotedNamesAfter(up, 'ADD CONSTRAINT "'),
    );
    expect(down).toContain(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudConnectionId"`,
    );
    expect(down[down.length - 1]).toBe('DROP TABLE "CloudConnection"');
    expect(quotedNamesAfter(up, 'CREATE INDEX "')).toHaveLength(5);
    expect(quotedNamesAfter(up, 'ADD CONSTRAINT "')).toHaveLength(4);
  });

  test("undo the resource column's key and index", async () => {
    expect(
      await record(
        new AddCloudResourceCloudConnectionIndexAndKey1805450000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "CloudResource" DROP CONSTRAINT "FK_e8eacdbd89826e4ceb6f25d91c8"`,
      `online: DROP INDEX "public"."IDX_e8eacdbd89826e4ceb6f25d91c"`,
    ]);
  });

  test("the models match: a resource has its connection", () => {
    expect(Object.keys(getTableColumns(new CloudResource()))).toEqual(
      expect.arrayContaining(["cloudConnection", "cloudConnectionId"]),
    );
  });
});
