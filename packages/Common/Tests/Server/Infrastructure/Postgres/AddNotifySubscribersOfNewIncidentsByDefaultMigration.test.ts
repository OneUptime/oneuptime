import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import Project from "../../../../Models/DatabaseModels/Project";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddNotifySubscribersOfNewIncidentsByDefault1809150300000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809150300000-AddNotifySubscribersOfNewIncidentsByDefault";

/*
 * WHETHER "NOTIFY STATUS PAGE SUBSCRIBERS" STARTS TICKED WHEN SOMEONE
 * DECLARES AN INCIDENT (#7606): the migration that adds
 * Project.notifyStatusPageSubscribersOfNewIncidentsByDefault.
 *
 *  - it is on (true) for every project: the ones that exist when it runs
 *    (a NOT NULL column with a constant default fills every row, without
 *    rewriting the table) and every one made after - so the box starts
 *    ticked everywhere, as it always did, until a project owner or admin
 *    turns it off;
 *  - every member reads it (each one's Declare New Incident form starts the
 *    box from it); a Project Owner or Admin changes it - exactly as the
 *    incident switches beside it (Linked Alerts, Episode Membership);
 *  - the migration is registered, named consistently and ordered after
 *    every migration registered before it, or it silently never runs.
 *
 * (The statements are TypeORM's migration:generate output for this column.)
 */

const MIGRATION_TIMESTAMP: string = "1809150300000";
const MIGRATION_BASE_NAME: string =
  "AddNotifySubscribersOfNewIncidentsByDefault";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const COLUMN: string = "notifyStatusPageSubscribersOfNewIncidentsByDefault";

// The incident switches on the Project beside it, on Incidents > Settings.
const NEIGHBOURING_INCIDENT_SWITCHES: Array<string> = [
  "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
  "resolveLinkedAlertsWhenIncidentResolved",
  "limitAlertsToOneEpisode",
];

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

interface ColumnAccess {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
}

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new AddNotifySubscribersOfNewIncidentsByDefault1809150300000()[step](
    runner,
  );

  return statements;
}

function columnOf(columnName: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === Project && column.propertyName === columnName;
    },
  );
}

function accessOf(columnName: string): ColumnAccess {
  return new Project().getColumnAccessControlFor(
    columnName,
  ) as unknown as ColumnAccess;
}

describe("executing it", () => {
  test("up() adds the project's switch, on for every project", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "Project" ADD "${COLUMN}" boolean NOT NULL DEFAULT true`,
    ]);
  });

  test("down() takes it back", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "${COLUMN}"`,
    ]);
  });

  test("adds no index, foreign key or row update, so no online DDL is owed and no row is rewritten", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/INDEX|FOREIGN KEY|UPDATE /);
      // A constant default: Postgres fills existing rows without a rewrite.
      expect(statement).toMatch(/DEFAULT true$/);
    }
  });
});

describe("the column it makes", () => {
  test("matches the model: not nullable, on by default", () => {
    const column: ColumnMetadataArgs | undefined = columnOf(COLUMN);

    expect(column?.options.type).toBe("boolean");
    expect(column?.options.nullable).toBe(false);
    expect(column?.options.default).toBe(true);
  });

  test("the API documents it as a required boolean that defaults to on", () => {
    const metadata: TableColumnMetadata = new Project().getTableColumnMetadata(
      COLUMN,
    );

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.required).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(true);
    expect(metadata.title).toBe(
      "Notify Status Page Subscribers of New Incidents by Default",
    );
    /*
     * It says what it moves, that incidents declared where nothing asks
     * about subscribers follow it, what it leaves alone, and that it starts
     * on.
     */
    expect(metadata.description).toContain("Notify Status Page Subscribers");
    expect(metadata.description).toContain("starts unticked");
    expect(metadata.description).toContain(
      "Incidents declared from Slack or Microsoft Teams, or by OneUptime AI, follow it too",
    );
    expect(metadata.description).toContain(
      "Incidents created by monitors, the API and workflows are not affected",
    );
    expect(metadata.description).toContain("On by default.");
  });

  test("a project made in code leaves it to the database's default", () => {
    // Undefined, not false: a new project is never saved with it off.
    expect(
      (new Project() as unknown as Record<string, unknown>)[COLUMN],
    ).toBeUndefined();
  });

  test("the neighbouring incident switches are columns of the same kind", () => {
    for (const neighbour of NEIGHBOURING_INCIDENT_SWITCHES) {
      const column: ColumnMetadataArgs | undefined = columnOf(neighbour);

      expect([
        neighbour,
        column?.options.type,
        column?.options.nullable,
      ]).toEqual([neighbour, "boolean", false]);
    }
  });
});

describe("who reads and changes it", () => {
  test("every member reads it; a Project Owner or Admin changes it; nobody sets it on create", () => {
    const access: ColumnAccess = accessOf(COLUMN);

    expect(access.create).toEqual([]);
    expect(access.read).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ]);
    expect(access.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
  });

  test("exactly as the incident switches beside it", () => {
    const access: ColumnAccess = accessOf(COLUMN);

    for (const neighbour of NEIGHBOURING_INCIDENT_SWITCHES) {
      expect({ neighbour, access: accessOf(neighbour) }).toEqual({
        neighbour,
        access,
      });
    }
  });

  test("ProjectUser - every member of the project - may read it, so every Declare form can start the box from it", () => {
    expect(accessOf(COLUMN).read).toContain(Permission.ProjectUser);
  });

  test("no member below Admin may change it", () => {
    for (const permission of [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.EditProject,
      Permission.ProjectUser,
    ]) {
      expect([
        permission,
        accessOf(COLUMN).update.includes(permission),
      ]).toEqual([permission, false]);
    }
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(
      new AddNotifySubscribersOfNewIncidentsByDefault1809150300000().name,
    ).toBe(MIGRATION_CLASS_NAME);
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
