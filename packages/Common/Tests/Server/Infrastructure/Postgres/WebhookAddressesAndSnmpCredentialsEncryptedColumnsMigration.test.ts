import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import CustomNotificationChannel from "../../../../Models/DatabaseModels/CustomNotificationChannel";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import OpenStackProjectNotice from "../../../../Models/DatabaseModels/OpenStackProjectNotice";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import UserWebhook from "../../../../Models/DatabaseModels/UserWebhook";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { WebhookAddressesAndSnmpCredentialsEncryptedColumns1809182720000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182720000-WebhookAddressesAndSnmpCredentialsEncryptedColumns";

/*
 * WEBHOOK ADDRESSES AND SNMP CREDENTIALS GET ROOM FOR THEIR CIPHERTEXT
 * (#9013, #9014): the migration behind them becoming encrypted.
 *
 *  - each column that was a varchar becomes text, in place (ALTER COLUMN
 *    TYPE): the value stored stays for the EncryptWebhookAddresses and
 *    EncryptSnmpCredentials data migrations to encrypt, where the
 *    generator's DROP COLUMN + ADD COLUMN would throw it away;
 *  - every other column made encrypted was text or jsonb already;
 *  - down() puts back what was there, in the opposite order;
 *  - it is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 */

const MIGRATION_TIMESTAMP: string = "1809182720000";
const MIGRATION_BASE_NAME: string =
  "WebhookAddressesAndSnmpCredentialsEncryptedColumns";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;
const MIGRATION_SOURCE_FILE: RegExp = /^\d{13}-.*\.ts$/;
const ALTER_TYPE: RegExp =
  /^ALTER TABLE "([A-Za-z0-9]+)" ALTER COLUMN "([A-Za-z0-9]+)" TYPE (.+)$/;

type ModelType = { new (): DatabaseBaseModel };

// What each column was, as the earlier migrations made it.
const WIDENED: Array<{
  table: string;
  modelType: ModelType;
  column: string;
  was: string;
}> = [
  {
    table: "StatusPageSubscriber",
    modelType: StatusPageSubscriber,
    column: "subscriberWebhook",
    was: "character varying",
  },
  {
    table: "StatusPageSubscriber",
    modelType: StatusPageSubscriber,
    column: "slackIncomingWebhookUrl",
    was: "character varying",
  },
  {
    table: "UserWebhook",
    modelType: UserWebhook,
    column: "webhookUrl",
    was: "character varying(500)",
  },
  {
    table: "OpenStackProjectNotice",
    modelType: OpenStackProjectNotice,
    column: "webhookUrl",
    was: "character varying",
  },
  {
    table: "OpenStackProjectNotice",
    modelType: OpenStackProjectNotice,
    column: "previewedRecipient",
    was: "character varying(100)",
  },
  {
    table: "CustomNotificationChannel",
    modelType: CustomNotificationChannel,
    column: "webhookUrl",
    was: "character varying(500)",
  },
  {
    table: "CustomNotificationChannel",
    modelType: CustomNotificationChannel,
    column: "secret",
    was: "character varying(100)",
  },
  {
    table: "NetworkDevice",
    modelType: NetworkDevice,
    column: "snmpCommunityString",
    was: "character varying(100)",
  },
  {
    table: "NetworkDevice",
    modelType: NetworkDevice,
    column: "snmpV3AuthKey",
    was: "character varying",
  },
  {
    table: "NetworkDevice",
    modelType: NetworkDevice,
    column: "snmpV3PrivKey",
    was: "character varying",
  },
  {
    table: "NetworkDeviceDiscoveryScan",
    modelType: NetworkDeviceDiscoveryScan,
    column: "snmpCommunityString",
    was: "character varying(100)",
  },
  {
    table: "NetworkDeviceDiscoveryScan",
    modelType: NetworkDeviceDiscoveryScan,
    column: "snmpV3AuthKey",
    was: "character varying",
  },
  {
    table: "NetworkDeviceDiscoveryScan",
    modelType: NetworkDeviceDiscoveryScan,
    column: "snmpV3PrivKey",
    was: "character varying",
  },
];

// The models whose encrypted columns this migration had to make room in.
const MODELS: Array<ModelType> = [
  StatusPageSubscriber,
  UserWebhook,
  OpenStackProjectNotice,
  CustomNotificationChannel,
  NetworkDevice,
  NetworkDeviceDiscoveryScan,
];

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new WebhookAddressesAndSnmpCredentialsEncryptedColumns1809182720000()[
    step
  ](runner);

  return statements;
}

function columnOf(
  modelType: ModelType,
  column: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((entry: ColumnMetadataArgs): boolean => {
      return entry.target === modelType && entry.propertyName === column;
    })
    .pop();
}

// Every earlier migration's source, to find what made each column.
function earlierMigrationSources(): string {
  return fs
    .readdirSync(MIGRATION_DIRECTORY)
    .filter((file: string): boolean => {
      return (
        MIGRATION_SOURCE_FILE.test(file) &&
        Number(file.slice(0, 13)) < Number(MIGRATION_TIMESTAMP)
      );
    })
    .map((file: string): string => {
      return fs.readFileSync(path.join(MIGRATION_DIRECTORY, file), "utf8");
    })
    .join("\n");
}

describe("executing it", () => {
  test("up() widens each column to text, in place", async () => {
    expect(await statementsOf("up")).toEqual(
      WIDENED.map((widened: (typeof WIDENED)[number]): string => {
        return `ALTER TABLE "${widened.table}" ALTER COLUMN "${widened.column}" TYPE text`;
      }),
    );
  });

  test("up() keeps every stored value: no column is dropped or added", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/DROP COLUMN|ADD "|ADD COLUMN/);
      expect(ALTER_TYPE.test(statement)).toBe(true);
    }
  });

  test("each column it widens was the varchar it puts back", () => {
    const sources: string = earlierMigrationSources();

    for (const widened of WIDENED) {
      expect([
        widened.table,
        widened.column,
        sources.includes(`"${widened.column}" ${widened.was}`),
      ]).toEqual([widened.table, widened.column, true]);
    }
  });

  test("down() puts back each type, in the opposite order", async () => {
    expect(await statementsOf("down")).toEqual(
      [...WIDENED].reverse().map((widened: (typeof WIDENED)[number]) => {
        return `ALTER TABLE "${widened.table}" ALTER COLUMN "${widened.column}" TYPE ${widened.was}`;
      }),
    );
  });

  test("builds no index, adds no constraint and no foreign key, so no online DDL is owed", async () => {
    for (const statement of [
      ...(await statementsOf("up")),
      ...(await statementsOf("down")),
    ]) {
      expect(statement).not.toMatch(/INDEX|FOREIGN KEY|CONSTRAINT|UNIQUE/);
    }
  });
});

describe("the columns it leaves", () => {
  test("each column it widens is an encrypted text column of its model, not unique", () => {
    for (const widened of WIDENED) {
      const column: ColumnMetadataArgs | undefined = columnOf(
        widened.modelType,
        widened.column,
      );

      expect([
        widened.table,
        widened.column,
        new widened.modelType().getTableColumnMetadata(widened.column)
          .encrypted,
        column?.options.type,
        column?.options.length,
        Boolean(column?.options.unique),
      ]).toEqual([
        widened.table,
        widened.column,
        true,
        "text",
        undefined,
        false,
      ]);
    }
  });

  test("every encrypted column of these models is text or jsonb, which a ciphertext fits", () => {
    for (const modelType of MODELS) {
      for (const column of new modelType().getEncryptedColumns().columns) {
        const options: ColumnMetadataArgs["options"] | undefined = columnOf(
          modelType,
          column,
        )?.options;

        expect([
          modelType.name,
          column,
          ["text", "jsonb"].includes(String(options?.type)),
          options?.length,
        ]).toEqual([modelType.name, column, true, undefined]);
      }
    }
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(
      new WebhookAddressesAndSnmpCredentialsEncryptedColumns1809182720000()
        .name,
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
