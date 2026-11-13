import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import Permission from "../../../../Types/Permission";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDashboardRecordingSwitches1809123700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123700000-AddDashboardRecordingSwitches";

/*
 * THE OFF SWITCHES FOR RECORDING ONEUPTIME'S OWN DASHBOARD (#6834): the
 * migration that adds User.disableDashboardRecording and
 * Project.disableDashboardRecording.
 *
 *  - both default to false, so adding them rewrites no row and nobody's
 *    choice is made for them - recording stays off everywhere until
 *    OneUptime Cloud's configuration turns it on;
 *  - the person's switch is theirs alone to read and change; the project's
 *    is read by every member (each member's browser decides before it
 *    records) and changed by a Project Owner or Admin;
 *  - the migration is registered, named consistently and ordered after
 *    every migration registered before it, or it silently never runs.
 *
 * (The statements are TypeORM's migration:generate output for these two
 * columns; the local database it compared against was older than main, and
 * only these two columns belong to this change.)
 */

const MIGRATION_TIMESTAMP: string = "1809123700000";
const MIGRATION_BASE_NAME: string = "AddDashboardRecordingSwitches";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const COLUMN: string = "disableDashboardRecording";

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

  await new AddDashboardRecordingSwitches1809123700000()[step](runner);

  return statements;
}

function columnOf(target: unknown): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === target && column.propertyName === COLUMN;
    },
  );
}

describe("executing it", () => {
  test("up() adds the person's switch and the project's, both off by default", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "User" ADD "${COLUMN}" boolean DEFAULT false`,
      `ALTER TABLE "Project" ADD "${COLUMN}" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("down() takes both back, in the opposite order", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "${COLUMN}"`,
      `ALTER TABLE "User" DROP COLUMN "${COLUMN}"`,
    ]);
  });

  test("adds no index or foreign key, so no online DDL is owed", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/INDEX|FOREIGN KEY/);
    }
  });
});

describe("the columns it makes", () => {
  test("match the models: the person's nullable, the project's not, both false by default", () => {
    const userColumn: ColumnMetadataArgs | undefined = columnOf(User);
    const projectColumn: ColumnMetadataArgs | undefined = columnOf(Project);

    expect(userColumn?.options.type).toBe("boolean");
    expect(userColumn?.options.nullable).toBe(true);
    expect(userColumn?.options.default).toBe(false);

    expect(projectColumn?.options.type).toBe("boolean");
    expect(projectColumn?.options.nullable).toBe(false);
    expect(projectColumn?.options.default).toBe(false);
  });

  test("the person's switch is theirs alone", () => {
    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = new User().getColumnAccessControlFor(COLUMN) as unknown as {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    };

    expect(access.create).toEqual([]);
    expect(access.read).toEqual([Permission.CurrentUser]);
    expect(access.update).toEqual([Permission.CurrentUser]);
  });

  test("every member reads the project's switch; an Owner or Admin changes it", () => {
    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = new Project().getColumnAccessControlFor(COLUMN) as unknown as {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    };

    expect(access.create).toEqual([]);
    expect(access.read).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
      ]),
    );
    expect(access.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new AddDashboardRecordingSwitches1809123700000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
  });

  test("it is registered once, after every migration registered before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const position: number = names.indexOf(MIGRATION_CLASS_NAME);

    expect(position).toBeGreaterThan(-1);
    expect(names.lastIndexOf(MIGRATION_CLASS_NAME)).toBe(position);

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
