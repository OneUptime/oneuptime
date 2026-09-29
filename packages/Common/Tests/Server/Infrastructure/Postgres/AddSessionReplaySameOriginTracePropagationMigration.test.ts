import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSessionReplaySameOriginTracePropagation1794800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1794800000000-AddSessionReplaySameOriginTracePropagation";

/*
 * The migration behind RumApplication.sessionReplaySameOriginTracePropagation:
 * the per-application switch for the browser recorder's automatic
 * traceparent + session tracestate on requests to the page's own origin.
 *
 * The one decision the SQL carries is DEFAULT true on a NOT NULL column:
 * Postgres fills every EXISTING application with true as the column appears,
 * so installed recorders start linking on their next page load with no
 * backfill statement to forget, and the column is the way to turn it off
 * without a customer redeploy. The statements are executed against a fake
 * QueryRunner, so up() and down() are told apart.
 */

const MIGRATION_TIMESTAMP: string = "1794800000000";

const MIGRATION_BASE_NAME: string =
  "AddSessionReplaySameOriginTracePropagation";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const ADD_SQL: string = `ALTER TABLE "RumApplication" ADD "sessionReplaySameOriginTracePropagation" boolean NOT NULL DEFAULT true`;

const DROP_SQL: string = `ALTER TABLE "RumApplication" DROP COLUMN "sessionReplaySameOriginTracePropagation"`;

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

type MakeQueryRunnerFunction = () => MakeQueryRunnerResult;

const makeQueryRunner: MakeQueryRunnerFunction = (): MakeQueryRunnerResult => {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements,
  };
};

async function upStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddSessionReplaySameOriginTracePropagation1794800000000().up(
    runner,
  );
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddSessionReplaySameOriginTracePropagation1794800000000().down(
    runner,
  );
  return statements;
}

describe("executing it", () => {
  test("up() adds exactly the one column and does nothing else", async () => {
    expect(await upStatements()).toEqual([ADD_SQL]);
  });

  test("down() drops exactly that column and nothing else", async () => {
    expect(await downStatements()).toEqual([DROP_SQL]);
  });

  /*
   * On for existing applications too: the default IS the rollout. No
   * UPDATE, because ADD COLUMN ... NOT NULL DEFAULT true already writes true
   * into every existing row.
   */
  test("existing applications get the switch on through the column default, with no backfill", async () => {
    const statements: Array<string> = await upStatements();

    expect(statements[0]).toContain("boolean NOT NULL DEFAULT true");

    for (const statement of [...statements, ...(await downStatements())]) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("INDEX");
      expect(statement).not.toContain("DEFAULT false");
    }
  });

  test("every statement is a complete, single statement", async () => {
    const statements: Array<string> = [
      ...(await upStatements()),
      ...(await downStatements()),
    ];

    expect(statements).toHaveLength(2);

    for (const statement of statements) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
      expect(statement.trim()).toBe(statement);
    }
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddSessionReplaySameOriginTracePropagation1794800000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddSessionReplaySameOriginTracePropagation1794800000000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the migration runs", () => {
  test("it is imported and listed in Index.ts", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${MIGRATION_CLASS_NAME} } from "./${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}";`,
    );
    expect(index).toContain(`  ${MIGRATION_CLASS_NAME},\n`);
  });

  test("it is in the exported migration list, exactly once", () => {
    expect(SchemaMigrations).toContain(
      AddSessionReplaySameOriginTracePropagation1794800000000,
    );
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return (
          migration === AddSessionReplaySameOriginTracePropagation1794800000000
        );
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by `name`. A mismatch re-runs the
   * migration on every boot, and an ADD COLUMN without IF NOT EXISTS fails
   * the boot the second time.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(
      new AddSessionReplaySameOriginTracePropagation1794800000000().name,
    ).toBe(MIGRATION_CLASS_NAME);
    expect(AddSessionReplaySameOriginTracePropagation1794800000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddSessionReplaySameOriginTracePropagation1794800000000.name.match(
        CLASS_TIMESTAMP,
      )?.[1],
    ).toBe(MIGRATION_TIMESTAMP);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const matching: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      });

    expect(matching).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddSessionReplaySameOriginTracePropagation1794800000000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlierTimestamps: Array<number> = [];

    for (const migrationClass of SchemaMigrations.slice(0, position)) {
      const match: RegExpMatchArray | null = (
        migrationClass as { name: string }
      ).name.match(CLASS_TIMESTAMP);

      if (match) {
        earlierTimestamps.push(Number(match[1]));
      }
    }

    // Math.max() of an empty list is -Infinity; prove the list was read.
    expect(earlierTimestamps.length).toBeGreaterThan(100);

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(...earlierTimestamps),
    );
  });
});

/*
 * The model side of the same contract. TypeORM generates the schema from
 * these decorators, so a model column whose type, nullability or default
 * disagrees with the migration is exactly the drift the Postgres Schema
 * Drift workflow fails on.
 */
describe("the RumApplication model carries the column the migration adds", () => {
  test("a non-nullable boolean defaulting to true", () => {
    const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.filter((candidate: ColumnMetadataArgs): boolean => {
        return candidate.target === RumApplication;
      })
      .find((candidate: ColumnMetadataArgs): boolean => {
        return (
          candidate.propertyName === "sessionReplaySameOriginTracePropagation"
        );
      });

    expect(args).toBeDefined();
    expect(args?.options.type).toBe("boolean");
    expect(args?.options.nullable).toBe(false);
    expect(args?.options.default).toBe(true);
  });
});
