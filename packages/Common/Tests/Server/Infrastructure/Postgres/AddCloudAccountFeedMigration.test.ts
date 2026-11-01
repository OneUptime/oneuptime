import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddCloudAccountFeed1808480000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808480000000-AddCloudAccountFeed";
import CloudAccountFeed from "../../../../Models/DatabaseModels/CloudAccountFeed";

/*
 * The migration behind a cloud account's feed: one new table, its three
 * indexes (the project, the account, and the account's entries by time -
 * the feed page's read), and its keys: the account and the project take
 * their entries with them, a person who is deleted leaves the entry with
 * no person. Nothing else changes: the table is new and empty, so its
 * indexes and keys are built inside the migration
 * (SchemaMigrationsOnlineDdl), and down() takes away exactly what up() made.
 *
 * Run against a fake QueryRunner, so the statements are what is pinned;
 * the schema drift check holds them to the model, and the migration ran up,
 * down and up again on a real Postgres 15 when it was written.
 */

const MIGRATION_TIMESTAMP: string = "1808480000000";
const MIGRATION_BASE_NAME: string = "AddCloudAccountFeed";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const TABLE: string = "CloudAccountFeed";

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface = new AddCloudAccountFeed1808480000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

// The quoted column names a CREATE TABLE statement declares, in order.
function createdColumns(statement: string): Array<string> {
  const open: number = statement.indexOf("(");
  const columns: Array<string> = [];

  for (const part of statement.slice(open + 1).split(", ")) {
    if (part.startsWith('"')) {
      columns.push(part.slice(1, part.indexOf('"', 1)));
    }
  }

  return columns;
}

describe("AddCloudAccountFeed1808480000000", () => {
  test("creates the table first, with every column the model declares", async () => {
    const up: Array<string> = await statementsOf("up");
    const create: string = up[0]!;

    expect(create.startsWith(`CREATE TABLE "${TABLE}" (`)).toBe(true);

    const columns: Array<string> = createdColumns(create);
    const declared: Array<string> = new CloudAccountFeed()
      .getTableColumns()
      .columns.filter((column: string): boolean => {
        // Relations are their id columns in the table.
        return ![
          "project",
          "cloudAccount",
          "createdByUser",
          "deletedByUser",
          "user",
        ].includes(column);
      });

    for (const column of declared) {
      expect(columns).toContain(column);
    }

    expect(create).toContain('"cloudAccountId" uuid NOT NULL');
    expect(create).toContain('"projectId" uuid NOT NULL');
    expect(create).toContain('"feedInfoInMarkdown" text NOT NULL');
    expect(create).toContain(
      '"cloudAccountFeedEventType" character varying NOT NULL',
    );
  });

  test("indexes the project, the account, and the account's entries by time", async () => {
    const indexes: Array<string> = (await statementsOf("up")).filter(
      (statement: string): boolean => {
        return statement.startsWith("CREATE INDEX");
      },
    );

    expect(
      indexes.map((statement: string): string => {
        return statement.slice(statement.indexOf(`ON "${TABLE}"`)).trim();
      }),
    ).toEqual([
      `ON "${TABLE}" ("projectId")`,
      `ON "${TABLE}" ("cloudAccountId")`,
      `ON "${TABLE}" ("cloudAccountId", "postedAt")`,
    ]);
  });

  test("an entry goes with its account and its project, and outlives a person who is deleted", async () => {
    const keys: Array<string> = (await statementsOf("up")).filter(
      (statement: string): boolean => {
        return statement.includes("FOREIGN KEY");
      },
    );

    const keyOf: (column: string) => string | undefined = (
      column: string,
    ): string | undefined => {
      return keys.find((statement: string): boolean => {
        return statement.includes(`FOREIGN KEY ("${column}")`);
      });
    };

    expect(keyOf("cloudAccountId")).toContain(
      'REFERENCES "CloudAccount"("_id") ON DELETE CASCADE',
    );
    expect(keyOf("projectId")).toContain(
      'REFERENCES "Project"("_id") ON DELETE CASCADE',
    );

    for (const column of ["createdByUserId", "deletedByUserId", "userId"]) {
      expect(keyOf(column)).toContain(
        'REFERENCES "User"("_id") ON DELETE SET NULL',
      );
    }

    expect(keys).toHaveLength(5);
  });

  test("changes no table but its own", async () => {
    for (const statement of await statementsOf("up")) {
      if (statement.startsWith("ALTER TABLE")) {
        expect(
          statement.startsWith(`ALTER TABLE "${TABLE}" ADD CONSTRAINT`),
        ).toBe(true);
      } else if (statement.startsWith("CREATE INDEX")) {
        expect(statement).toContain(`ON "${TABLE}"`);
      } else {
        expect(statement.startsWith(`CREATE TABLE "${TABLE}"`)).toBe(true);
      }
    }
  });

  test("down takes away exactly what up made, in reverse", async () => {
    const up: Array<string> = await statementsOf("up");
    const down: Array<string> = await statementsOf("down");

    const constraintsUp: Array<string> = up
      .filter((statement: string): boolean => {
        return statement.includes("ADD CONSTRAINT");
      })
      .map((statement: string): string => {
        return statement.split('ADD CONSTRAINT "')[1]!.split('"')[0]!;
      });
    const indexesUp: Array<string> = up
      .filter((statement: string): boolean => {
        return statement.startsWith("CREATE INDEX");
      })
      .map((statement: string): string => {
        return statement.split('CREATE INDEX "')[1]!.split('"')[0]!;
      });

    expect(down).toEqual([
      ...[...constraintsUp].reverse().map((constraint: string): string => {
        return `ALTER TABLE "${TABLE}" DROP CONSTRAINT "${constraint}"`;
      }),
      ...[...indexesUp].reverse().map((index: string): string => {
        return `DROP INDEX "public"."${index}"`;
      }),
      `DROP TABLE "${TABLE}"`,
    ]);
  });

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(new AddCloudAccountFeed1808480000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    // It runs after the account's AI access columns, which it follows.
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf("AddCloudAccountAiAccess1808470000000"),
    );

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Math.max(...timestamps)).toBeGreaterThanOrEqual(
      Number(MIGRATION_TIMESTAMP),
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
