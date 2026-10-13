import { AddInstanceTokenSigningKey1801700000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1801700000000-AddInstanceTokenSigningKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import InstanceTokenSigningKey from "../../../../Models/DatabaseModels/InstanceTokenSigningKey";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The migration behind InstanceTokenSigningKey, the one-row table an
 * installation whose ENCRYPTION_SECRET is unset or a shipped placeholder
 * keeps its own token signing key in (TokenSigningKey).
 *
 * It pins that up() creates exactly that table and nothing else - the base
 * columns and the one signing key column, as the model declares it, with no
 * row in it (the first process to start writes the key) - that down() drops
 * it, and that the migration is registered where it runs after everything
 * before it. Fake QueryRunner only; the real statements run against Postgres
 * in InstanceTokenSigningKeyPostgres and the Schema Drift job.
 */

const OWN_CLASS_NAME: string = "AddInstanceTokenSigningKey1801700000000";

const OWN_TIMESTAMP: number = 1801700000000;

// The migration registered right before this one when it was renumbered.
const PREVIOUS_CLASS_NAME: string =
  "AddCriticalAlertSoundVolumeAndPushRepeat1801650000000";

const MIGRATION_FILE: string = "1801700000000-AddInstanceTokenSigningKey.ts";

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const CLASS_NAME_TIMESTAMP: RegExp = /(\d{13})$/;

type MigrationClass = new () => MigrationInterface;

const registered: Array<MigrationClass> =
  SchemaMigrations as unknown as Array<MigrationClass>;

const registeredNames: Array<string> = registered.map(
  (migration: MigrationClass): string => {
    return migration.name;
  },
);

function timestampOfClassName(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(CLASS_NAME_TIMESTAMP);
  return match ? Number(match[1]) : null;
}

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddInstanceTokenSigningKey1801700000000()[direction](queryRunner);

  return statements;
}

describe("AddInstanceTokenSigningKey migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, MIGRATION_FILE),
      "utf8",
    );

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddInstanceTokenSigningKey1801700000000().name).toBe(
      OWN_CLASS_NAME,
    );
    expect(AddInstanceTokenSigningKey1801700000000.name).toBe(OWN_CLASS_NAME);
    expect(timestampOfClassName(OWN_CLASS_NAME)).toBe(OWN_TIMESTAMP);
    expect(MIGRATION_FILE.startsWith(`${OWN_TIMESTAMP}-`)).toBe(true);
  });

  test("is the only file on its timestamp", () => {
    const files: Array<string> = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file: string): boolean => {
        return file.startsWith(`${OWN_TIMESTAMP}-`);
      });

    expect(files).toEqual([MIGRATION_FILE]);
  });

  test("runs in a transaction, like every migration that only creates a table", () => {
    expect(
      (
        new AddInstanceTokenSigningKey1801700000000() as unknown as {
          transaction?: boolean;
        }
      ).transaction,
    ).toBeUndefined();
  });

  test("is registered once, after the migration before it", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);

    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const previousIndex: number = registeredNames.indexOf(PREVIOUS_CLASS_NAME);

    expect(previousIndex).toBeGreaterThanOrEqual(0);
    expect(ownIndex).toBeGreaterThan(previousIndex);
  });

  test("runs after every migration registered before it", () => {
    /*
     * A fresh install runs the array in order while an existing one runs
     * whatever it has not recorded; a stamp below an earlier entry would make
     * the two disagree (SchemaMigrationsOrdering).
     */
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    expect(
      registeredNames.slice(0, ownIndex).filter((className: string) => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= OWN_TIMESTAMP;
      }),
    ).toEqual([]);
  });

  test("is imported and listed in Index.ts", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${OWN_CLASS_NAME} } from "./1801700000000-AddInstanceTokenSigningKey";`,
    );
    expect(index.split(`  ${OWN_CLASS_NAME},\n`)).toHaveLength(2);
  });
});

describe("AddInstanceTokenSigningKey migration - up() and down()", () => {
  test("up() creates the model's table and nothing else, with no row in it", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements).toHaveLength(1);
    expect(
      statements[0]!.startsWith(
        `CREATE TABLE "${new InstanceTokenSigningKey().tableName}" (`,
      ),
    ).toBe(true);
  });

  test("up() gives the table the base columns, a primary key on _id and one required signing key column", async () => {
    const [createTable] = await recordQueries("up");

    for (const column of [
      `"_id" uuid NOT NULL DEFAULT uuid_generate_v4()`,
      `"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
      `"updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
      `"deletedAt" TIMESTAMP WITH TIME ZONE`,
      `"version" integer NOT NULL`,
      `"signingKey" character varying(100) NOT NULL`,
      `PRIMARY KEY ("_id")`,
    ]) {
      expect({ column, created: createTable!.includes(column) }).toEqual({
        column,
        created: true,
      });
    }

    // Nothing ties the key to a project or a user.
    expect(createTable).not.toContain("projectId");
    expect(createTable).not.toContain("FOREIGN KEY");
  });

  test("down() drops the table again", async () => {
    expect(await recordQueries("down")).toEqual([
      `DROP TABLE "InstanceTokenSigningKey"`,
    ]);
  });
});
