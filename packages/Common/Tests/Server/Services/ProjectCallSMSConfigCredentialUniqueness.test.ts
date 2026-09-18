import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import InitialMigration from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1717605043663-InitialMigration";
import { DropProjectCallSMSConfigCredentialUniques1786700000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1786700000000-DropProjectCallSMSConfigCredentialUniques";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Issue #3020: POST/PUT /api/call-sms-config answered 500 {"error":"Server
 * Error"} the moment a second config was given Twilio credentials that another
 * row already held.
 *
 * ProjectCallSMSConfig's columns were modelled on GlobalConfig, a SINGLETON
 * table whose every column carries a pointless `unique: true`. Copied onto a
 * tenant-scoped, inherently multi-row table, that became a global UNIQUE on
 * twilioAccountSID and twilioAuthToken — no two rows anywhere in the instance
 * could share a Twilio account. Two legitimate setups were then impossible:
 *
 *   1. One account, two numbers. Poland requires a Local number for Voice and
 *      a Mobile number for SMS, so one project needs two configs on one
 *      account. This is what the issue was filed against.
 *   2. Two projects, one account — the first project to save an account SID
 *      locked every other tenant out of it, and neither could see why.
 *
 * Two things must hold for the fix, and a regression in either one puts the
 * 500 straight back:
 *   1. neither credential column declares `unique: true` (a `unique: true`
 *      here is what makes schema:generate re-ADD the constraint as "drift"),
 *   2. the migration drops both constraints AND is registered in
 *      SchemaMigrations/Index.ts — an unregistered migration never runs, so
 *      every existing database keeps the constraint.
 *
 * Pure metadata/mocks — no Postgres connection anywhere.
 */

const CREDENTIAL_COLUMNS: Array<string> = [
  "twilioAccountSID",
  "twilioAuthToken",
];

const ACCOUNT_SID_CONSTRAINT: string = "UQ_0886139eac04ad49627e446d477";
const AUTH_TOKEN_CONSTRAINT: string = "UQ_2eb1a240d549a7701b6e82d2f94";

function columnArgs(propertyName: string): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs) => {
      return column.target === ProjectCallSMSConfig;
    })
    .find((column: ColumnMetadataArgs) => {
      return column.propertyName === propertyName;
    });

  if (!args) {
    throw new Error(
      `ProjectCallSMSConfig.${propertyName} has no TypeORM @Column metadata`,
    );
  }

  return args;
}

function makeQueryRunner(): {
  runner: QueryRunner;
  query: jest.Mock;
} {
  const query: jest.Mock = jest.fn(() => {
    return Promise.resolve(undefined);
  }) as unknown as jest.Mock;

  /*
   * InitialMigration short-circuits when it finds a "File" table, so that its
   * CREATE TABLEs are not replayed over an existing database. Undefined means
   * "empty database", which is the path that actually emits the SQL.
   */
  const getTable: jest.Mock = jest.fn(() => {
    return Promise.resolve(undefined);
  }) as unknown as jest.Mock;

  return { runner: { query, getTable } as unknown as QueryRunner, query };
}

function executedSql(query: jest.Mock): Array<string> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

describe("ProjectCallSMSConfig credential columns", () => {
  test.each(CREDENTIAL_COLUMNS)(
    "%s is not declared unique — a Twilio account can back more than one config",
    (propertyName: string) => {
      expect(columnArgs(propertyName).options.unique).toBe(false);
    },
  );

  test.each(CREDENTIAL_COLUMNS)(
    "%s is still nullable, so a config may exist before credentials are entered",
    (propertyName: string) => {
      expect(columnArgs(propertyName).options.nullable).toBe(true);
    },
  );

  test("twilioPrimaryPhoneNumber is not unique either — two projects can share a number", () => {
    expect(columnArgs("twilioPrimaryPhoneNumber").options.unique).toBe(false);
  });

  test("no column on this table declares unique: true at all", () => {
    /*
     * The whole class of bug, not just the two columns the issue happened to
     * name. Config identity is `name`, which is unique PER PROJECT through
     * @UniqueColumnBy("projectId") — an app-level check, not a DB constraint.
     * Nothing on a tenant-scoped provider-credential table should ever be
     * globally unique, so the correct count is zero.
     */
    const uniqueColumns: Array<string> = getMetadataArgsStorage()
      .columns.filter((column: ColumnMetadataArgs) => {
        return (
          column.target === ProjectCallSMSConfig &&
          column.options.unique === true
        );
      })
      .map((column: ColumnMetadataArgs) => {
        return column.propertyName;
      });

    expect(uniqueColumns).toEqual([]);
  });

  test("the columns are wide enough for real Twilio credentials", () => {
    /*
     * Guards the alternative explanation for the reported 500. A live account
     * SID is 34 characters and an auth token 32, so truncation was never the
     * cause — but if these ever narrowed below that, the same endpoint would
     * start answering 500 again for an entirely different reason.
     */
    for (const propertyName of CREDENTIAL_COLUMNS) {
      expect(Number(columnArgs(propertyName).options.length)).toBeGreaterThan(
        34,
      );
    }
  });
});

describe("DropProjectCallSMSConfigCredentialUniques migration", () => {
  test("up() drops both credential constraints", async () => {
    const { runner, query } = makeQueryRunner();

    await new DropProjectCallSMSConfigCredentialUniques1786700000000().up(
      runner,
    );

    const sql: Array<string> = executedSql(query);

    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain(ACCOUNT_SID_CONSTRAINT);
    expect(sql[1]).toContain(AUTH_TOKEN_CONSTRAINT);

    for (const statement of sql) {
      expect(statement).toContain(`ALTER TABLE "ProjectCallSMSConfig"`);
      expect(statement).toContain("DROP CONSTRAINT");
    }
  });

  test("up() drops nothing else — no drift statements smuggled in", () => {
    /*
     * An autogenerated migration emits every difference it finds, so a
     * regenerated file can quietly carry unrelated ALTERs. Both statements
     * must be DROP CONSTRAINT against this one table.
     */
    const { runner, query } = makeQueryRunner();

    return new DropProjectCallSMSConfigCredentialUniques1786700000000()
      .up(runner)
      .then(() => {
        for (const statement of executedSql(query)) {
          expect(statement).not.toContain("ADD");
          expect(statement).not.toContain("DROP COLUMN");
          expect(statement).not.toMatch(
            /ALTER TABLE "(?!ProjectCallSMSConfig)/,
          );
        }
      });
  });

  test("up() is idempotent — IF EXISTS, so a hand-dropped constraint does not fail the deploy", async () => {
    /*
     * Self-hosted operators hit by #3020 were told the workaround is to drop
     * the constraint by hand. Without IF EXISTS this migration would abort on
     * exactly the databases that most needed it.
     */
    const { runner, query } = makeQueryRunner();

    await new DropProjectCallSMSConfigCredentialUniques1786700000000().up(
      runner,
    );

    for (const statement of executedSql(query)) {
      expect(statement).toContain("DROP CONSTRAINT IF EXISTS");
    }
  });

  test("down() restores both constraints on the original columns", async () => {
    const { runner, query } = makeQueryRunner();

    await new DropProjectCallSMSConfigCredentialUniques1786700000000().down(
      runner,
    );

    const sql: Array<string> = executedSql(query);

    expect(sql).toHaveLength(2);
    expect(sql.join("\n")).toContain(
      `ADD CONSTRAINT "${AUTH_TOKEN_CONSTRAINT}" UNIQUE ("twilioAuthToken")`,
    );
    expect(sql.join("\n")).toContain(
      `ADD CONSTRAINT "${ACCOUNT_SID_CONSTRAINT}" UNIQUE ("twilioAccountSID")`,
    );
  });

  test("down() reuses the original constraint names, so up() can drop them again", async () => {
    /*
     * A rollback that invented new names would leave the next roll-forward
     * dropping constraints that no longer exist and leaving the real ones in
     * place — the bug would survive its own fix.
     */
    const upRunner: {
      runner: QueryRunner;
      query: jest.Mock;
    } = makeQueryRunner();
    const downRunner: {
      runner: QueryRunner;
      query: jest.Mock;
    } = makeQueryRunner();
    const migration: DropProjectCallSMSConfigCredentialUniques1786700000000 =
      new DropProjectCallSMSConfigCredentialUniques1786700000000();

    await migration.up(upRunner.runner);
    await migration.down(downRunner.runner);

    for (const constraint of [ACCOUNT_SID_CONSTRAINT, AUTH_TOKEN_CONSTRAINT]) {
      expect(executedSql(upRunner.query).join("\n")).toContain(constraint);
      expect(executedSql(downRunner.query).join("\n")).toContain(constraint);
    }
  });

  test("targets the constraint names the InitialMigration actually created", () => {
    /*
     * The names are opaque TypeORM hashes. If they were mistyped, up() would
     * silently drop nothing (IF EXISTS makes that a no-op rather than an
     * error) and every database would keep the constraint. Pin them against
     * the CREATE TABLE that introduced them.
     */
    const { runner, query } = makeQueryRunner();

    return new InitialMigration().up(runner).then(() => {
      const createTable: string | undefined = executedSql(query).find(
        (statement: string) => {
          return statement.includes(`CREATE TABLE "ProjectCallSMSConfig"`);
        },
      );

      expect(createTable).toBeDefined();
      expect(createTable).toContain(
        `CONSTRAINT "${ACCOUNT_SID_CONSTRAINT}" UNIQUE ("twilioAccountSID")`,
      );
      expect(createTable).toContain(
        `CONSTRAINT "${AUTH_TOKEN_CONSTRAINT}" UNIQUE ("twilioAuthToken")`,
      );
    });
  });

  test("is registered in SchemaMigrations/Index.ts", () => {
    expect(SchemaMigrations).toContain(
      DropProjectCallSMSConfigCredentialUniques1786700000000,
    );
  });

  test("is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: unknown) => {
        return (
          migration === DropProjectCallSMSConfigCredentialUniques1786700000000
        );
      },
    ).length;

    expect(occurrences).toBe(1);
  });

  test("runs after the migration that created the constraints", () => {
    /*
     * TypeORM executes registered migrations in array order. Dropping a
     * constraint before the CREATE TABLE that declares it is a no-op that
     * leaves the constraint in place once the table finally arrives.
     */
    const createIndex: number = SchemaMigrations.indexOf(InitialMigration);
    const dropIndex: number = SchemaMigrations.indexOf(
      DropProjectCallSMSConfigCredentialUniques1786700000000,
    );

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(dropIndex).toBeGreaterThan(createIndex);
  });
});
