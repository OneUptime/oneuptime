import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import DataProduct from "../../../../Models/DatabaseModels/DataProduct";
import IoTDeviceCredential from "../../../../Models/DatabaseModels/IoTDeviceCredential";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import TelemetryIngestionKey from "../../../../Models/DatabaseModels/TelemetryIngestionKey";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { PresentedKeysEncryptedColumns1809182900000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182900000-PresentedKeysEncryptedColumns";
import { StatusPageEmbedTokenEncryptedColumn1809182910000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182910000-StatusPageEmbedTokenEncryptedColumn";
import { StatusPageSubscriberTokenEncryptedColumn1809182920000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182920000-StatusPageSubscriberTokenEncryptedColumn";
import { MonitorKeysEncryptedColumns1809182930000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182930000-MonitorKeysEncryptedColumns";
import { PresentedKeyLookupHashIndexes1809182940000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182940000-PresentedKeyLookupHashIndexes";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";

/*
 * THE KEYS PRESENTED TO ONEUPTIME, KEPT ENCRYPTED: THEIR COLUMNS (#9012).
 *
 * A ciphertext is longer than the key it holds and is no uuid, so the
 * columns of the keys kept encrypted become text, and the keys a request
 * names its record by alone get a lookup hash column, indexed. Pinned here:
 *
 *   - each column changes its type IN PLACE (ALTER COLUMN TYPE): the
 *     generator's DROP COLUMN + ADD COLUMN would throw every key away, and
 *     every probe, collector, heartbeat, badge and webhook with it;
 *   - a uuid is cast to its text, which a server of the release before
 *     still compares a key with, and which the lookup takes until the key
 *     is encrypted;
 *   - the Monitor's three keys change in ONE statement, in a migration of
 *     its own, with the server-side statement timeout raised for its rewrite;
 *     the status pages' and their subscribers' columns have one each;
 *   - the lookup hash indexes are built online, in a migration with no
 *     transaction, by the names the model's @Index() gives them;
 *   - down() puts every type back: a ciphertext, no uuid and no
 *     varchar(100), becomes a new random key, or is cleared;
 *   - each is registered once, in order.
 * PresentedKeysAtRestPostgres.test.ts runs them on a real Postgres.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

const UUID_PATTERN: string =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

interface Step {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
}

async function statementsOf(
  migration: Step,
  step: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await migration[step](runner);

  return statements;
}

function columnOf(
  target: unknown,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (entry: ColumnMetadataArgs): boolean => {
      return entry.target === target && entry.propertyName === propertyName;
    },
  );
}

function expectRegisteredInOrder(className: string): void {
  const names: Array<string> = SchemaMigrations.map(
    (migration: unknown): string => {
      return (migration as { name: string }).name;
    },
  );
  const position: number = names.indexOf(className);
  const timestamp: string = className.match(CLASS_TIMESTAMP)![1]!;

  expect(position).toBeGreaterThan(-1);
  expect(names.lastIndexOf(className)).toBe(position);

  for (const earlier of names.slice(0, position)) {
    const earlierTimestamp: string | undefined =
      earlier.match(CLASS_TIMESTAMP)?.[1];

    if (earlierTimestamp) {
      expect([earlier, Number(earlierTimestamp) < Number(timestamp)]).toEqual([
        earlier,
        true,
      ]);
    }
  }
}

function toUuid(column: string): string {
  return `(CASE WHEN "${column}" IS NULL THEN NULL WHEN "${column}" ~* '${UUID_PATTERN}' THEN "${column}"::uuid ELSE gen_random_uuid() END)`;
}

describe("PresentedKeysEncryptedColumns", () => {
  const migration: PresentedKeysEncryptedColumns1809182900000 =
    new PresentedKeysEncryptedColumns1809182900000();

  test("up() changes each key's column to text in place, and adds the lookup hash columns", async () => {
    expect(await statementsOf(migration, "up")).toEqual([
      `ALTER TABLE "TelemetryIngestionKey" ALTER COLUMN "secretKey" TYPE text USING "secretKey"::text`,
      `ALTER TABLE "TelemetryIngestionKey" ADD "secretKeyHash" character varying(255)`,
      `ALTER TABLE "IoTDeviceCredential" ALTER COLUMN "secretKey" TYPE text USING "secretKey"::text`,
      `ALTER TABLE "Workflow" ALTER COLUMN "incomingEmailSecretKey" TYPE text USING "incomingEmailSecretKey"::text`,
      `ALTER TABLE "Workflow" ADD "webhookSecretKeyHash" character varying(255)`,
      `ALTER TABLE "Workflow" ADD "incomingEmailSecretKeyHash" character varying(255)`,
      `ALTER TABLE "Runbook" ALTER COLUMN "webhookSecretKey" TYPE text`,
      `ALTER TABLE "DataProduct" ALTER COLUMN "badgeToken" TYPE text`,
    ]);
  });

  test("up() drops no column, constraint or index: every key stays where it is", async () => {
    for (const statement of await statementsOf(migration, "up")) {
      expect(statement).not.toMatch(/DROP|INDEX|CONSTRAINT/);
    }
  });

  test("down() puts the types back: an encrypted key becomes a new random one, an encrypted token is cleared", async () => {
    expect(await statementsOf(migration, "down")).toEqual([
      `ALTER TABLE "DataProduct" ALTER COLUMN "badgeToken" TYPE character varying(100) USING (CASE WHEN "badgeToken" LIKE 'U2FsdGVkX1%' THEN NULL ELSE "badgeToken" END)`,
      `ALTER TABLE "Runbook" ALTER COLUMN "webhookSecretKey" TYPE character varying(100) USING (CASE WHEN "webhookSecretKey" LIKE 'U2FsdGVkX1%' THEN NULL ELSE "webhookSecretKey" END)`,
      `ALTER TABLE "Workflow" DROP COLUMN "incomingEmailSecretKeyHash"`,
      `ALTER TABLE "Workflow" DROP COLUMN "webhookSecretKeyHash"`,
      `ALTER TABLE "Workflow" ALTER COLUMN "incomingEmailSecretKey" TYPE uuid USING ${toUuid("incomingEmailSecretKey")}`,
      `ALTER TABLE "IoTDeviceCredential" ALTER COLUMN "secretKey" TYPE uuid USING (CASE WHEN "secretKey" ~* '${UUID_PATTERN}' THEN "secretKey"::uuid ELSE gen_random_uuid() END)`,
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "secretKeyHash"`,
      `ALTER TABLE "TelemetryIngestionKey" ALTER COLUMN "secretKey" TYPE uuid USING (CASE WHEN "secretKey" ~* '${UUID_PATTERN}' THEN "secretKey"::uuid ELSE gen_random_uuid() END)`,
    ]);
  });

  test("the columns are as the models declare them", () => {
    for (const [target, column] of [
      [TelemetryIngestionKey, "secretKey"],
      [IoTDeviceCredential, "secretKey"],
      [Workflow, "incomingEmailSecretKey"],
      [Runbook, "webhookSecretKey"],
      [DataProduct, "badgeToken"],
      [StatusPage, "embeddedOverallStatusToken"],
      [StatusPageSubscriber, "unsubscribeToken"],
      [Monitor, "serverMonitorSecretKey"],
      [Monitor, "incomingRequestSecretKey"],
      [Monitor, "incomingEmailSecretKey"],
    ] as Array<[unknown, string]>) {
      expect({ column, type: columnOf(target, column)?.options.type }).toEqual({
        column,
        type: "text",
      });
    }

    for (const [target, column] of [
      [TelemetryIngestionKey, "secretKeyHash"],
      [Workflow, "webhookSecretKeyHash"],
      [Workflow, "incomingEmailSecretKeyHash"],
      [Monitor, "serverMonitorSecretKeyHash"],
      [Monitor, "incomingRequestSecretKeyHash"],
      [Monitor, "incomingEmailSecretKeyHash"],
    ] as Array<[unknown, string]>) {
      expect({ column, options: columnOf(target, column)?.options }).toEqual({
        column,
        options: expect.objectContaining({
          type: "varchar",
          length: 255,
          nullable: true,
        }),
      });
    }
  });

  test("it is named after its file and registered once, in order", () => {
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          "1809182900000-PresentedKeysEncryptedColumns.ts",
        ),
      ),
    ).toBe(true);
    expect(migration.name).toBe("PresentedKeysEncryptedColumns1809182900000");
    expectRegisteredInOrder("PresentedKeysEncryptedColumns1809182900000");
  });
});

describe("the status pages' tokens, each in a migration of its own", () => {
  test("a status page's embed token: text in place, and back", async () => {
    const migration: StatusPageEmbedTokenEncryptedColumn1809182910000 =
      new StatusPageEmbedTokenEncryptedColumn1809182910000();

    expect(await statementsOf(migration, "up")).toEqual([
      `ALTER TABLE "StatusPage" ALTER COLUMN "embeddedOverallStatusToken" TYPE text`,
    ]);
    expect(await statementsOf(migration, "down")).toEqual([
      `ALTER TABLE "StatusPage" ALTER COLUMN "embeddedOverallStatusToken" TYPE character varying(100) USING (CASE WHEN "embeddedOverallStatusToken" LIKE 'U2FsdGVkX1%' THEN NULL ELSE "embeddedOverallStatusToken" END)`,
    ]);
    expectRegisteredInOrder("StatusPageEmbedTokenEncryptedColumn1809182910000");
  });

  test("a subscriber's unsubscribe token: text in place, and back", async () => {
    const migration: StatusPageSubscriberTokenEncryptedColumn1809182920000 =
      new StatusPageSubscriberTokenEncryptedColumn1809182920000();

    expect(await statementsOf(migration, "up")).toEqual([
      `ALTER TABLE "StatusPageSubscriber" ALTER COLUMN "unsubscribeToken" TYPE text`,
    ]);
    expect(await statementsOf(migration, "down")).toEqual([
      `ALTER TABLE "StatusPageSubscriber" ALTER COLUMN "unsubscribeToken" TYPE character varying(100) USING (CASE WHEN "unsubscribeToken" LIKE 'U2FsdGVkX1%' THEN NULL ELSE "unsubscribeToken" END)`,
    ]);
    expectRegisteredInOrder(
      "StatusPageSubscriberTokenEncryptedColumn1809182920000",
    );
  });
});

describe("MonitorKeysEncryptedColumns", () => {
  const migration: MonitorKeysEncryptedColumns1809182930000 =
    new MonitorKeysEncryptedColumns1809182930000();

  test("up() changes the Monitor's three keys and adds their hash columns in ONE statement: one rewrite, one lock", async () => {
    expect(await statementsOf(migration, "up")).toEqual([
      `SET LOCAL statement_timeout = '600s'`,
      `ALTER TABLE "Monitor" ALTER COLUMN "serverMonitorSecretKey" TYPE text USING "serverMonitorSecretKey"::text, ALTER COLUMN "incomingRequestSecretKey" TYPE text USING "incomingRequestSecretKey"::text, ALTER COLUMN "incomingEmailSecretKey" TYPE text USING "incomingEmailSecretKey"::text, ADD "serverMonitorSecretKeyHash" character varying(255), ADD "incomingRequestSecretKeyHash" character varying(255), ADD "incomingEmailSecretKeyHash" character varying(255)`,
    ]);
  });

  test("down() puts the uuid columns back, each encrypted key a new random one", async () => {
    expect(await statementsOf(migration, "down")).toEqual([
      `SET LOCAL statement_timeout = '600s'`,
      `ALTER TABLE "Monitor" DROP COLUMN "incomingEmailSecretKeyHash", DROP COLUMN "incomingRequestSecretKeyHash", DROP COLUMN "serverMonitorSecretKeyHash", ALTER COLUMN "incomingEmailSecretKey" TYPE uuid USING ${toUuid("incomingEmailSecretKey")}, ALTER COLUMN "incomingRequestSecretKey" TYPE uuid USING ${toUuid("incomingRequestSecretKey")}, ALTER COLUMN "serverMonitorSecretKey" TYPE uuid USING ${toUuid("serverMonitorSecretKey")}`,
    ]);
  });

  test("runs in a transaction - the default - so a failed rewrite leaves the table as it was", () => {
    expect(
      (migration as unknown as { transaction?: boolean }).transaction,
    ).toBeUndefined();
  });

  test("is registered once, in order", () => {
    expectRegisteredInOrder("MonitorKeysEncryptedColumns1809182930000");
  });
});

describe("PresentedKeyLookupHashIndexes", () => {
  const migration: PresentedKeyLookupHashIndexes1809182940000 =
    new PresentedKeyLookupHashIndexes1809182940000();

  const naming: DefaultNamingStrategy = new DefaultNamingStrategy();

  // Each index the model declares on a lookup hash column, by its name.
  const INDEXES: Array<[string, unknown, string, boolean]> = [
    ["Monitor", Monitor, "serverMonitorSecretKeyHash", false],
    ["Monitor", Monitor, "incomingRequestSecretKeyHash", false],
    ["Monitor", Monitor, "incomingEmailSecretKeyHash", false],
    ["Workflow", Workflow, "webhookSecretKeyHash", false],
    ["Workflow", Workflow, "incomingEmailSecretKeyHash", true],
    ["TelemetryIngestionKey", TelemetryIngestionKey, "secretKeyHash", false],
  ];

  test("builds every lookup hash index online, with no transaction", async () => {
    const built: Array<string> = [];
    const createIndex: jest.SpyInstance = jest
      .spyOn(OnlineDdl, "createIndex")
      .mockImplementation((async (_runner: QueryRunner, sql: string) => {
        built.push(sql);
      }) as never);

    await migration.up({} as QueryRunner);

    expect(migration.transaction).toBe(false);
    expect(built).toEqual(
      INDEXES.map(
        ([table, , column, isUnique]: [string, unknown, string, boolean]) => {
          return `CREATE ${isUnique ? "UNIQUE " : ""}INDEX "${naming.indexName(table, [column])}" ON "${table}" ("${column}") `;
        },
      ),
    );

    createIndex.mockRestore();
  });

  test("the indexes are the models' own", () => {
    for (const [table, target, column, isUnique] of INDEXES) {
      const declared: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find(
          (entry: IndexMetadataArgs): boolean => {
            return (
              entry.target === target &&
              Array.isArray(entry.columns) &&
              (entry.columns as Array<string>).length === 1 &&
              (entry.columns as Array<string>)[0] === column
            );
          },
        );

      expect({ table, column, declared: Boolean(declared) }).toEqual({
        table,
        column,
        declared: true,
      });
      expect(Boolean(declared!.unique)).toBe(isUnique);
    }
  });

  test("down() drops them again", async () => {
    const dropped: Array<string> = [];
    const dropIndex: jest.SpyInstance = jest
      .spyOn(OnlineDdl, "dropIndex")
      .mockImplementation((async (_runner: QueryRunner, sql: string) => {
        dropped.push(sql);
      }) as never);

    await migration.down({} as QueryRunner);

    expect(dropped.sort()).toEqual(
      INDEXES.map(([table, , column]: [string, unknown, string, boolean]) => {
        return `DROP INDEX "public"."${naming.indexName(table, [column])}"`;
      }).sort(),
    );

    dropIndex.mockRestore();
  });

  test("is registered once, after the columns it indexes", () => {
    expectRegisteredInOrder("PresentedKeyLookupHashIndexes1809182940000");
  });
});
