import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import Project from "../../../../Models/DatabaseModels/Project";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectManageSignInWithSso1809185200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185200000-AddProjectManageSignInWithSso";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * WHETHER A PROJECT MANAGES ITS PEOPLE'S SIGN-IN WITH SSO (#9763): the
 * migration that adds Project.manageSignInWithSso.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. What matters beyond the SQL:
 *
 *  - nothing changes for any project until it turns the switch on: the
 *    column is NOT NULL with a default of false, as the model declares it;
 *  - it is the column the model declares - a boolean, off by default - read
 *    by the project's people and changed by whoever may require SSO for it,
 *    on the plans that may;
 *  - the migration is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 *
 * (Generated with TypeORM's migration:generate against a database every
 * registered migration had run on; the schema drift check found nothing left
 * to generate once it had run.)
 */

const MIGRATION_TIMESTAMP: string = "1809185200000";
const MIGRATION_BASE_NAME: string = "AddProjectManageSignInWithSso";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const COLUMN: string = "manageSignInWithSso";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new AddProjectManageSignInWithSso1809185200000()[step](runner);

  return statements;
}

describe("executing it", () => {
  test("up() adds the column, off for every project that exists", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "Project" ADD "${COLUMN}" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("down() takes it back", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "${COLUMN}"`,
    ]);
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddProjectManageSignInWithSso1809185200000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
  });
});

describe("the column it adds", () => {
  test("is the model's: a boolean, false by default", () => {
    const metadata: TableColumnMetadata = new Project().getTableColumnMetadata(
      COLUMN,
    );

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.defaultValue).toBe(false);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.required).toBe(true);
  });

  test("is changed by whoever may require SSO for the project, and created by nobody through the API", () => {
    const project: Project = new Project();
    const access: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } = project.getColumnAccessControlFor(COLUMN) || {};
    const requireSso: {
      update?: Array<Permission>;
    } = project.getColumnAccessControlFor("requireSsoForLogin") || {};

    expect(access.create || []).toEqual([]);
    expect([...(access.update || [])].sort()).toEqual(
      [...(requireSso.update || [])].sort(),
    );
    expect(access.read).toContain(Permission.ProjectMember);
  });

  test("needs the plan requiring SSO needs, and is read on every plan", () => {
    const project: Project = new Project();

    expect(project.getColumnBillingAccessControl(COLUMN)).toEqual(
      project.getColumnBillingAccessControl("requireSsoForLogin"),
    );
    expect(project.getColumnBillingAccessControl(COLUMN)?.read).toBe(
      PlanType.Free,
    );
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new AddProjectManageSignInWithSso1809185200000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
  });

  test("it is registered after every migration registered before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const position: number = names.indexOf(MIGRATION_CLASS_NAME);

    expect(position).toBeGreaterThan(-1);

    for (const earlier of names.slice(0, position)) {
      const timestamp: string | undefined = earlier.match(CLASS_TIMESTAMP)?.[1];

      if (timestamp) {
        expect([
          earlier,
          Number(timestamp) < Number(MIGRATION_TIMESTAMP),
        ]).toEqual([earlier, true]);
      }
    }
  });
});
