import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import {
  PERMISSION_ROW_MIGRATIONS,
  PERMISSION_ROW_TABLES,
  PERMISSION_ROWS_VERSION,
  getMigrationNumber,
} from "../../../../Server/Infrastructure/Postgres/PermissionRowMigrations";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * EVERY SCHEMA MIGRATION THAT CHANGES PERMISSION ROWS RAISES THE VERSION
 * MEMBERS' CACHED PERMISSION SETS ARE SERVED AT (#8373).
 *
 * A member's permission set is cached in Redis for up to 30 days, built
 * from their teams' rows. A migration changes those rows in Postgres
 * directly, so it rebuilds no one's set: it is listed in
 * PERMISSION_ROW_MIGRATIONS (Server/Infrastructure/Postgres/
 * PermissionRowMigrations.ts), which makes every set cached before it be
 * read as missing, and rebuilt from the rows as they are
 * (PermissionRowsVersionCache.test.ts). One that is not listed leaves
 * members with what it took away, or without what it gave.
 *
 * The guard reads every registered schema migration's code (comments
 * taken out) for a statement that deletes, changes or inserts rows of a
 * table a member's or a key's permissions are read from
 * (PERMISSION_ROW_TABLES) - named in the statement, or through a list of
 * table names the statement is written for, as the migrations that remove
 * permissions write theirs - and holds the list to exactly those.
 *
 * When it fails for a new migration: add its class name to the end of
 * PERMISSION_ROW_MIGRATIONS. Docs/migrations/README.md says why.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const REGISTERED: Array<string> = (
  SchemaMigrations as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

// A file's code: its block and line comments taken out.
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const TABLES: string = PERMISSION_ROW_TABLES.join("|");

// A statement that writes rows of a permission table, named in it.
const NAMED_ROW_WRITE: RegExp = new RegExp(
  `\\b(?:DELETE\\s+FROM|UPDATE|INSERT\\s+INTO|TRUNCATE(?:\\s+TABLE)?)\\s+(?:ONLY\\s+)?(?:"public"\\.)?"(?:${TABLES})"`,
  "i",
);

// A statement that writes rows of a table named in an interpolation.
const INTERPOLATED_ROW_WRITE: RegExp =
  /\b(?:DELETE\s+FROM|UPDATE|INSERT\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:"public"\.)?"\$\{/i;

// A permission table's name as a string of its own: a list such a statement runs over.
const TABLE_NAME_AS_TEXT: RegExp = new RegExp(`["'\`](?:${TABLES})["'\`]`);

// Whether a migration's code writes rows of a permission table.
function changesPermissionRows(source: string): boolean {
  const code: string = codeOf(source);

  return (
    NAMED_ROW_WRITE.test(code) ||
    (INTERPOLATED_ROW_WRITE.test(code) && TABLE_NAME_AS_TEXT.test(code))
  );
}

// A migration's file: <13-digit number>-<name>.ts.
const MIGRATION_FILE: RegExp = /^\d{13}-.+\.ts$/;

const FILES: Array<string> = fs
  .readdirSync(MIGRATION_DIRECTORY)
  .filter((file: string): boolean => {
    return MIGRATION_FILE.test(file);
  });

// Every migration class, by name, and the file it is written in.
const FILE_OF_CLASS: Map<string, string> = new Map<string, string>();

for (const file of FILES) {
  const source: string = fs.readFileSync(
    path.join(MIGRATION_DIRECTORY, file),
    "utf8",
  );

  for (const match of source.matchAll(
    /\bexport\s+(?:default\s+)?class\s+(\w+)/g,
  )) {
    FILE_OF_CLASS.set(match[1]!, path.join(MIGRATION_DIRECTORY, file));
  }
}

function fileOf(migrationName: string): string | undefined {
  return FILE_OF_CLASS.get(migrationName);
}

// The registered migrations whose code changes permission rows, in registry order.
function migrationsChangingPermissionRows(): Array<string> {
  return REGISTERED.filter((name: string): boolean => {
    const file: string | undefined = fileOf(name);

    return (
      Boolean(file) && changesPermissionRows(fs.readFileSync(file!, "utf8"))
    );
  });
}

describe("PERMISSION_ROW_MIGRATIONS", () => {
  test("names every registered migration that changes permission rows, and no other, in the order they run", () => {
    expect([...PERMISSION_ROW_MIGRATIONS]).toEqual(
      migrationsChangingPermissionRows(),
    );
  });

  test("each is registered, once, in the order of its number", () => {
    const positions: Array<number> = PERMISSION_ROW_MIGRATIONS.map(
      (name: string): number => {
        return REGISTERED.indexOf(name);
      },
    );

    expect(
      positions.every((at: number): boolean => {
        return at >= 0;
      }),
    ).toBe(true);
    expect(
      [...positions].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(positions);
    expect(new Set(PERMISSION_ROW_MIGRATIONS).size).toBe(
      PERMISSION_ROW_MIGRATIONS.length,
    );

    const numbers: Array<number> =
      PERMISSION_ROW_MIGRATIONS.map(getMigrationNumber);

    expect(
      [...numbers].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(numbers);
  });

  test("each is the class in a file named for it, so the file read is the migration that runs", () => {
    for (const name of PERMISSION_ROW_MIGRATIONS) {
      const file: string | undefined = fileOf(name);

      expect({ name, file: file && path.basename(file) }).toEqual({
        name,
        file: `${getMigrationNumber(name)}-${name.replace(/\d{13}$/, "")}.ts`,
      });
      expect(fs.readFileSync(file!, "utf8")).toContain(`class ${name}`);
    }
  });

  test("the version sets are cached at is the newest one's number", () => {
    expect(PERMISSION_ROWS_VERSION).toBe(
      getMigrationNumber(
        PERMISSION_ROW_MIGRATIONS[PERMISSION_ROW_MIGRATIONS.length - 1]!,
      ),
    );
    expect(PERMISSION_ROWS_VERSION).toBe(1809186970000);
  });

  /*
   * It writes the address an invitation not yet accepted was sent to
   * (#10175), which grants nothing, but it writes TeamMember rows, so it is
   * listed as any write to a permission table is.
   */
  test("the newest is the one that kept each pending invitation's address", () => {
    expect(
      PERMISSION_ROW_MIGRATIONS[PERMISSION_ROW_MIGRATIONS.length - 1],
    ).toBe("BackfillTeamMemberInviteeEmail1809186970000");
    expect(
      PERMISSION_ROW_MIGRATIONS[PERMISSION_ROW_MIGRATIONS.length - 2],
    ).toBe("RemovePermissionsThatGrantNothing1809178600000");
  });

  test("the scan reads every registered migration's file", () => {
    expect(REGISTERED.length).toBeGreaterThan(1000);

    // A registered class found in no file would be read nowhere.
    expect(
      REGISTERED.filter((name: string): boolean => {
        return !fileOf(name);
      }),
    ).toEqual([]);
  });
});

/*
 * What the scan takes for a change of permission rows - and what it does
 * not, so a migration that only changes their tables' shape is not listed.
 */
describe("the scan for a change of permission rows", () => {
  test.each([
    [
      "a delete named in its statement",
      'await queryRunner.query(`DELETE FROM "TeamPermission" WHERE "permission" = $1`, ["X"]);',
    ],
    [
      "a change of a permission's value",
      'await queryRunner.query(`UPDATE "ApiKeyPermission" SET "permission" = $1 WHERE "permission" = $2`);',
    ],
    [
      "rows put into a custom role",
      'await queryRunner.query(`INSERT INTO "CustomRolePermission" ("_id", "permission") VALUES ($1, $2)`);',
    ],
    [
      "a team's members taken away",
      'await queryRunner.query(`DELETE FROM "TeamMember" WHERE "hasAcceptedInvitation" = false`);',
    ],
    [
      "a row's labels emptied",
      'await queryRunner.query(`TRUNCATE TABLE "TeamPermissionLabel"`);',
    ],
    [
      "a delete over a list of the tables, as the removals write theirs",
      'const TABLES = ["TeamPermission", "ApiKeyPermission"];\nfor (const table of TABLES) {\n  await queryRunner.query(`DELETE FROM "${table}" WHERE "permission" = ANY($1::text[])`);\n}',
    ],
    [
      "a statement in the public schema",
      'await queryRunner.query(`DELETE FROM "public"."TeamPermission" WHERE true`);',
    ],
    [
      "a statement in lower case",
      'await queryRunner.query(`delete from "TeamPermission" where true`);',
    ],
  ])("finds %s", (_label: string, source: string) => {
    expect(changesPermissionRows(source)).toBe(true);
  });

  test.each([
    [
      "a column added to a permission table",
      'await queryRunner.query(`ALTER TABLE "TeamPermission" ADD "scope" character varying`);',
    ],
    [
      "an index on one",
      'await queryRunner.query(`CREATE INDEX "IDX_x" ON "ApiKeyPermission" ("projectId")`);',
    ],
    [
      "a foreign key to one, from a table whose rows change",
      'await queryRunner.query(`UPDATE "Monitor" SET "x" = 1`);\nawait queryRunner.query(`ALTER TABLE "TeamPermission" ADD CONSTRAINT "FK_x" FOREIGN KEY ("teamId") REFERENCES "Team"("_id")`);',
    ],
    [
      "a table whose name only begins like one",
      'await queryRunner.query(`DELETE FROM "TeamPermissionAudit" WHERE true`);',
    ],
    [
      "a statement in a comment",
      '// await queryRunner.query(`DELETE FROM "TeamPermission"`);\n/* UPDATE "TeamMember" SET x = 1 */',
    ],
    [
      "an interpolated delete over other tables",
      'const TABLES = ["Monitor", "Incident"];\nfor (const table of TABLES) {\n  await queryRunner.query(`DELETE FROM "${table}" WHERE "projectId" IS NULL`);\n}',
    ],
  ])("does not take %s for one", (_label: string, source: string) => {
    expect(changesPermissionRows(source)).toBe(false);
  });

  test("the tables it reads for are the models' own, and their labels' join tables", () => {
    const modelTables: Set<string> = new Set<string>(
      (AllModelTypes as Array<{ new (): BaseModel }>).map(
        (modelType: { new (): BaseModel }): string => {
          return new modelType().tableName || "";
        },
      ),
    );
    const joinTables: Set<string> = new Set<string>(
      getMetadataArgsStorage()
        .joinTables.map((joinTable: { name?: string | undefined }) => {
          return joinTable.name || "";
        })
        .filter(Boolean),
    );

    for (const table of PERMISSION_ROW_TABLES) {
      expect({
        table,
        known: modelTables.has(table) || joinTables.has(table),
      }).toEqual({ table, known: true });
    }

    expect([...PERMISSION_ROW_TABLES]).toEqual(
      expect.arrayContaining([
        "TeamMember",
        "TeamPermission",
        "ApiKeyPermission",
        "CustomRolePermission",
      ]),
    );
  });
});

/*
 * Run, each listed migration writes rows of a permission table: none is
 * listed for a statement the scan misread. Their statements are executed
 * against a QueryRunner that keeps them and answers every query with no
 * rows, as an empty database would.
 */
describe("each listed migration, run, writes permission rows", () => {
  async function statementsOf(name: string): Promise<Array<string>> {
    const statements: Array<string> = [];
    const runner: QueryRunner = {
      query: async (sql: string): Promise<Array<unknown>> => {
        statements.push(sql);
        return [];
      },
    } as unknown as QueryRunner;
    const migrationType: { new (): MigrationInterface } | undefined = (
      SchemaMigrations as Array<{ new (): MigrationInterface; name: string }>
    ).find((migration: { name: string }): boolean => {
      return migration.name === name;
    });

    await new migrationType!().up(runner);

    return statements;
  }

  test.each(
    PERMISSION_ROW_MIGRATIONS.map((name: string) => {
      return [name];
    }),
  )("%s", async (name: string) => {
    const writes: Array<string> = (await statementsOf(name)).filter(
      (sql: string): boolean => {
        return NAMED_ROW_WRITE.test(sql);
      },
    );

    expect(writes.length).toBeGreaterThan(0);
  });
});

/*
 * The migrations guide says what to do when this fails, and every file it
 * points to for it is there.
 */
describe("the migrations guide's section on migrations that change permission rows", () => {
  const GUIDE: string = path.join(
    __dirname,
    "../../../../../../Docs/migrations/README.md",
  );
  const guide: string = fs.readFileSync(GUIDE, "utf8");
  const section: string =
    guide.split(/^### /m).find((part: string): boolean => {
      return part.startsWith("Migrations that change permission rows");
    }) || "";

  test("is there, and names the list a migration is added to", () => {
    expect(section).not.toBe("");
    expect(section).toContain("PERMISSION_ROW_MIGRATIONS");
    expect(section).toContain("PermissionRowMigrationsGuard");
  });

  test("every file it links to exists", () => {
    const links: Array<string> = [...section.matchAll(/\]\(([^)#]+)\)/g)].map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(links.length).toBeGreaterThan(3);

    for (const link of links) {
      expect({
        link,
        exists: fs.existsSync(path.join(path.dirname(GUIDE), link)),
      }).toEqual({ link, exists: true });
    }
  });
});
