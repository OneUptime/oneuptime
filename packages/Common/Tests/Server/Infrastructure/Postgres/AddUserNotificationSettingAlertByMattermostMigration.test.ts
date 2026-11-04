import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import ColumnType from "../../../../Types/Database/ColumnType";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddUserMattermostIndexesAndKeys1808992680000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808992680000-AddUserMattermostIndexesAndKeys";
import { AddUserNotificationSettingAlertByMattermost1808992950000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808992950000-AddUserNotificationSettingAlertByMattermost";

/*
 * THE MIGRATION FOR THE MATTERMOST COLUMN OF NOTIFICATION SETTINGS.
 *
 * One column: "UserNotificationSetting"."alertByMattermost", NOT NULL and off
 * for everyone, as a person's Slack and Microsoft Teams switches start. Its
 * constant default is stored in the catalog, so Postgres adds it without
 * rewriting the table, and an unindexed column needs no online build.
 *
 * The SQL was generated (npm run generate-postgres-migration) and the schema
 * drift check proves it matches the model. Pinned here: that up() adds exactly
 * that column, that down() takes back exactly it, that the migration and the
 * model describe the same column, and that it runs after what it builds on.
 */

const MIGRATION_TIMESTAMP: string = "1808992950000";
const MIGRATION_NAME: string = "AddUserNotificationSettingAlertByMattermost";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

const ADD_STATEMENT: string = `ALTER TABLE "UserNotificationSetting" ADD "alertByMattermost" boolean NOT NULL DEFAULT false`;
const DROP_STATEMENT: string = `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByMattermost"`;

interface RecordingRunner {
  runner: QueryRunner;
  statements: Array<string>;
}

function recordingRunner(): RecordingRunner {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return { runner: { query } as unknown as QueryRunner, statements };
}

function typeOrmColumn(propertyName: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === UserNotificationSetting &&
        column.propertyName === propertyName
      );
    },
  );
}

function newMigration(): AddUserNotificationSettingAlertByMattermost1808992950000 {
  return new AddUserNotificationSettingAlertByMattermost1808992950000();
}

describe("running it", () => {
  test("up() adds the one column, and does nothing else", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().up(runner);

    expect(statements).toEqual([ADD_STATEMENT]);
  });

  test("down() drops exactly what up() added, and nothing else", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().down(runner);

    expect(statements).toEqual([DROP_STATEMENT]);
  });

  test("nobody's updates go to Mattermost until they turn it on", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().up(runner);

    expect(statements[0]).toContain("NOT NULL DEFAULT false");
  });

  test("rewrites no row and builds no index: nothing blocks the table's writers", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().up(runner);

    for (const statement of statements) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("CREATE INDEX");
      expect(statement).not.toContain("FOREIGN KEY");
      expect(statement).not.toMatch(/DEFAULT\s+\(/);
    }
  });
});

describe("the migration and the model", () => {
  test("UserNotificationSetting.alertByMattermost is the column the migration adds, as the other workspaces' are", () => {
    const options: ColumnMetadataArgs["options"] | undefined =
      typeOrmColumn("alertByMattermost")?.options;
    const teams: ColumnMetadataArgs["options"] | undefined = typeOrmColumn(
      "alertByMicrosoftTeams",
    )?.options;

    expect(options).toBeDefined();
    expect(options!.type).toBe(ColumnType.Boolean);
    expect(options!.default).toBe(false);
    expect(options!.nullable).toBe(teams!.nullable);
    expect(options!.type).toBe(teams!.type);
    expect(options!.default).toBe(teams!.default);
  });
});

describe("the migration runs", () => {
  test("it is registered, and in the exported list", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `from "./${MIGRATION_TIMESTAMP}-${MIGRATION_NAME}"`,
    );
    expect(index).toContain(`${MIGRATION_CLASS_NAME},`);
    expect(SchemaMigrations).toContain(
      AddUserNotificationSettingAlertByMattermost1808992950000,
    );
  });

  test("its declared name is its class name", () => {
    expect(newMigration().name).toBe(MIGRATION_CLASS_NAME);
    expect(AddUserNotificationSettingAlertByMattermost1808992950000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    expect(
      fs.readdirSync(MIGRATION_DIRECTORY).filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      }),
    ).toEqual([`${MIGRATION_TIMESTAMP}-${MIGRATION_NAME}.ts`]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddUserNotificationSettingAlertByMattermost1808992950000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlier: Array<number> = [];

    for (const migrationClass of SchemaMigrations.slice(0, position)) {
      const match: RegExpMatchArray | null = (
        migrationClass as { name: string }
      ).name.match(CLASS_TIMESTAMP);

      if (match) {
        earlier.push(Number(match[1]));
      }
    }

    expect(earlier.length).toBeGreaterThan(100);
    expect(Math.max(...earlier)).toBeLessThan(Number(MIGRATION_TIMESTAMP));
  });

  test("runs after the migrations that made Mattermost a notification method", () => {
    expect(
      SchemaMigrations.indexOf(
        AddUserNotificationSettingAlertByMattermost1808992950000,
      ),
    ).toBeGreaterThan(
      SchemaMigrations.indexOf(AddUserMattermostIndexesAndKeys1808992680000),
    );
  });
});
