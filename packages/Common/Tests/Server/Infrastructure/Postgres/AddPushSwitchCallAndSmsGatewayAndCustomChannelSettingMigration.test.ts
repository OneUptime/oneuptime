import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";
import {
  CallAndSmsProvider,
  DEFAULT_CALL_AND_SMS_PROVIDER,
} from "../../../../Types/CallAndSMS/CallAndSmsProvider";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddCustomNotificationChannelIndexesAndKeys1808090000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808090000000-AddCustomNotificationChannelIndexesAndKeys";
import { AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808100000000-AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting";

/*
 * THE MIGRATION FOR THE PUSH SWITCH, THE SMS AND CALL GATEWAY AND CUSTOM
 * CHANNELS FOR OTHER NOTIFICATIONS.
 *
 * Five columns, each with a constant default or none, so Postgres adds them
 * from the catalog and rewrites neither table:
 *
 *   - "GlobalConfig"."disablePushNotifications": push off for the whole
 *     server, off (false) where nobody chose;
 *   - "GlobalConfig"."callAndSmsProvider": what carries the server's SMS and
 *     calls, NOT NULL with "Twilio" - what every installation sent through,
 *     so each sends as it did the moment the column is added;
 *   - "GlobalConfig"."callAndSmsGatewayUrl" and "callAndSmsGatewaySecret":
 *     the gateway's, empty until an admin chooses one;
 *   - "UserNotificationSetting"."alertByCustomChannel": a person's
 *     notifications through the custom channels too, NOT NULL and off for
 *     everyone, as their SMS and calls are until they turn them on.
 *
 * The SQL was generated (npm run generate-postgres-migration) and the schema
 * drift check proves it matches the models. Pinned here: that up() adds
 * exactly those columns, that down() takes back exactly them, that the
 * migration and the models describe the same columns, and that it is
 * registered after every migration before it.
 */

const MIGRATION_TIMESTAMP: string = "1808100000000";
const MIGRATION_NAME: string =
  "AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_NAME}${MIGRATION_TIMESTAMP}`;
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_NAME}.ts`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

const ADD_STATEMENTS: Array<string> = [
  `ALTER TABLE "GlobalConfig" ADD "disablePushNotifications" boolean DEFAULT false`,
  `ALTER TABLE "GlobalConfig" ADD "callAndSmsProvider" character varying(${ColumnLength.ShortText}) NOT NULL DEFAULT 'Twilio'`,
  `ALTER TABLE "GlobalConfig" ADD "callAndSmsGatewayUrl" character varying(${ColumnLength.LongText})`,
  `ALTER TABLE "GlobalConfig" ADD "callAndSmsGatewaySecret" character varying(${ColumnLength.ShortText})`,
  `ALTER TABLE "UserNotificationSetting" ADD "alertByCustomChannel" boolean NOT NULL DEFAULT false`,
];

const DROP_STATEMENTS: Array<string> = [
  `ALTER TABLE "UserNotificationSetting" DROP COLUMN "alertByCustomChannel"`,
  `ALTER TABLE "GlobalConfig" DROP COLUMN "callAndSmsGatewaySecret"`,
  `ALTER TABLE "GlobalConfig" DROP COLUMN "callAndSmsGatewayUrl"`,
  `ALTER TABLE "GlobalConfig" DROP COLUMN "callAndSmsProvider"`,
  `ALTER TABLE "GlobalConfig" DROP COLUMN "disablePushNotifications"`,
];

type RecordingRunner = {
  runner: QueryRunner;
  statements: Array<string>;
};

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

type MigratedModelClass = typeof GlobalConfig | typeof UserNotificationSetting;

function typeOrmColumn(
  target: MigratedModelClass,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === target && column.propertyName === propertyName;
    },
  );
}

function newMigration(): AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000 {
  return new AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000();
}

describe("running it", () => {
  test("up() adds the five columns, and does nothing else", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().up(runner);

    expect(statements).toEqual(ADD_STATEMENTS);
  });

  test("down() drops exactly what up() added, in reverse, and nothing else", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().down(runner);

    expect(statements).toEqual(DROP_STATEMENTS);
  });

  test("down() undoes up(): every column up() adds is the one a statement of down() drops", async () => {
    const added: RecordingRunner = recordingRunner();
    const dropped: RecordingRunner = recordingRunner();

    await newMigration().up(added.runner);
    await newMigration().down(dropped.runner);

    const columnOf: (statement: string) => string = (
      statement: string,
    ): string => {
      const match: RegExpMatchArray | null = statement.match(
        /^ALTER TABLE ("[A-Za-z]+") (?:ADD|DROP COLUMN) ("[A-Za-z]+")/,
      );

      return match ? `${match[1]}.${match[2]}` : statement;
    };

    expect(dropped.statements.map(columnOf).reverse()).toEqual(
      added.statements.map(columnOf),
    );
  });

  /*
   * A constant default, or none, is stored in the catalog: no row of either
   * table is rewritten, and nothing backfills one.
   */
  test("rewrites no row: no backfill, no expression default, one statement each", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().up(runner);

    for (const statement of statements) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain(";");
      expect(statement).not.toMatch(/DEFAULT\s+\(/);
      expect(statement).not.toContain("now()");
    }
  });

  test("touches only the two tables it is about", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().up(runner);

    const tables: Set<string> = new Set<string>(
      statements.map((statement: string): string => {
        return statement.split('"')[1] || "";
      }),
    );

    expect(Array.from(tables).sort()).toEqual([
      "GlobalConfig",
      "UserNotificationSetting",
    ]);
  });

  test("every existing server keeps sending through Twilio, with push on", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().up(runner);

    expect(
      statements.find((statement: string): boolean => {
        return statement.includes('"callAndSmsProvider"');
      }),
    ).toContain(`NOT NULL DEFAULT '${CallAndSmsProvider.Twilio}'`);

    expect(
      statements.find((statement: string): boolean => {
        return statement.includes('"disablePushNotifications"');
      }),
    ).toContain("DEFAULT false");
  });

  test("nobody's notifications go to a custom channel until they turn it on", async () => {
    const { runner, statements } = recordingRunner();

    await newMigration().up(runner);

    expect(
      statements.find((statement: string): boolean => {
        return statement.includes('"alertByCustomChannel"');
      }),
    ).toContain("NOT NULL DEFAULT false");
  });

  test("is a MigrationInterface whose two steps are up and down", () => {
    const migration: MigrationInterface = newMigration();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the migration and the models", () => {
  test("GlobalConfig.disablePushNotifications: boolean, nullable, off by default", () => {
    const options: ColumnMetadataArgs["options"] | undefined = typeOrmColumn(
      GlobalConfig,
      "disablePushNotifications",
    )?.options;

    expect(options).toBeDefined();
    expect(options!.type).toBe(ColumnType.Boolean);
    expect(options!.nullable).toBe(true);
    expect(options!.default).toBe(false);
  });

  test("GlobalConfig.callAndSmsProvider: short text, NOT NULL, Twilio by default", () => {
    const options: ColumnMetadataArgs["options"] | undefined = typeOrmColumn(
      GlobalConfig,
      "callAndSmsProvider",
    )?.options;

    expect(options).toBeDefined();
    expect(options!.type).toBe(ColumnType.ShortText);
    expect(options!.length).toBe(ColumnLength.ShortText);
    expect(options!.nullable).toBe(false);
    expect(options!.default).toBe(DEFAULT_CALL_AND_SMS_PROVIDER);
    expect(DEFAULT_CALL_AND_SMS_PROVIDER).toBe(CallAndSmsProvider.Twilio);
    expect(options!.unique).toBe(false);
  });

  test.each([
    ["callAndSmsGatewayUrl", ColumnType.LongText, ColumnLength.LongText],
    ["callAndSmsGatewaySecret", ColumnType.ShortText, ColumnLength.ShortText],
  ] as Array<[string, ColumnType, number]>)(
    "GlobalConfig.%s: nullable, with no default",
    (column: string, type: ColumnType, length: number) => {
      const options: ColumnMetadataArgs["options"] | undefined = typeOrmColumn(
        GlobalConfig,
        column,
      )?.options;

      expect(options).toBeDefined();
      expect(options!.type).toBe(type);
      expect(options!.length).toBe(length);
      expect(options!.nullable).toBe(true);
      expect(options!.default).toBeUndefined();
    },
  );

  test("UserNotificationSetting.alertByCustomChannel: boolean, off by default, like the other channels", () => {
    const options: ColumnMetadataArgs["options"] | undefined = typeOrmColumn(
      UserNotificationSetting,
      "alertByCustomChannel",
    )?.options;
    const webhook: ColumnMetadataArgs["options"] | undefined = typeOrmColumn(
      UserNotificationSetting,
      "alertByWebhook",
    )?.options;

    expect(options).toBeDefined();
    expect(options!.type).toBe(ColumnType.Boolean);
    expect(options!.default).toBe(false);
    expect(options!.nullable).toBe(webhook!.nullable);
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
      AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000,
    );
  });

  test("its declared name is its class name", () => {
    expect(newMigration().name).toBe(MIGRATION_CLASS_NAME);
    expect(
      AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000.name,
    ).toBe(MIGRATION_CLASS_NAME);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    expect(
      fs.readdirSync(MIGRATION_DIRECTORY).filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      }),
    ).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000,
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

  test("runs after the custom channel migrations whose columns it builds on", () => {
    expect(
      SchemaMigrations.indexOf(
        AddPushSwitchCallAndSmsGatewayAndCustomChannelSetting1808100000000,
      ),
    ).toBeGreaterThan(
      SchemaMigrations.indexOf(
        AddCustomNotificationChannelIndexesAndKeys1808090000000,
      ),
    );
  });
});
