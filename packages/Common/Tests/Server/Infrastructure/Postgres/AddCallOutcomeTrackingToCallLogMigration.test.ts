import CallLog from "../../../../Models/DatabaseModels/CallLog";
import { AddCallOutcomeTrackingToCallLog1809090000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809090000000-AddCallOutcomeTrackingToCallLog";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A CALL ENDED, ON ITS LOG (#6586).
 *
 * Each call log gets the secret token its Twilio status callback URL
 * carries, and the on-call notification the call was made for, so how the
 * call ended can be written back onto that notification - as an SMS log
 * has for its delivery status (AddDeliveryTrackingToSmsLog). Two nullable
 * columns, an index and a foreign key, named as TypeORM names them, so the
 * schema drift check finds nothing to change. No row is rewritten: a
 * nullable column with no default is added without one.
 *
 * Pure SQL-contract assertions against a fake QueryRunner.
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const INDEX: string = naming.indexName("CallLog", ["userOnCallLogTimelineId"]);
const FOREIGN_KEY: string = naming.foreignKeyName(
  "CallLog",
  ["userOnCallLogTimelineId"],
  "UserOnCallLogTimeline",
  ["_id"],
);

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function columnOf(property: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs) => {
      return args.target === CallLog && args.propertyName === property;
    })
    .pop();
}

describe("AddCallOutcomeTrackingToCallLog1809090000000", () => {
  test("adds the token, the notification, its index and its foreign key - and nothing else", async () => {
    const migration: AddCallOutcomeTrackingToCallLog1809090000000 =
      new AddCallOutcomeTrackingToCallLog1809090000000();

    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "CallLog" ADD "statusCallbackToken" character varying(100)`,
      `ALTER TABLE "CallLog" ADD "userOnCallLogTimelineId" uuid`,
      `CREATE INDEX "${INDEX}" ON "CallLog" ("userOnCallLogTimelineId") `,
      `ALTER TABLE "CallLog" ADD CONSTRAINT "${FOREIGN_KEY}" FOREIGN KEY ("userOnCallLogTimelineId") REFERENCES "UserOnCallLogTimeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    ]);
  });

  test("never rewrites the table: both columns are nullable, with no default", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddCallOutcomeTrackingToCallLog1809090000000().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toMatch(/^UPDATE/);
    }
  });

  test("down() takes back exactly what up() added, in reverse", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddCallOutcomeTrackingToCallLog1809090000000().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "CallLog" DROP CONSTRAINT "${FOREIGN_KEY}"`,
      `DROP INDEX "public"."${INDEX}"`,
      `ALTER TABLE "CallLog" DROP COLUMN "userOnCallLogTimelineId"`,
      `ALTER TABLE "CallLog" DROP COLUMN "statusCallbackToken"`,
    ]);
  });

  test("is registered, after the migrations before it, and named for its class", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    const index: number = names.indexOf(
      "AddCallOutcomeTrackingToCallLog1809090000000",
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("AddIncomingMonitorRequestAsReceived1809080466402"),
    );
    expect(index).toBeGreaterThan(
      names.indexOf("AddDeliveryTrackingToSmsLog1780317745887"),
    );
    expect(new AddCallOutcomeTrackingToCallLog1809090000000().name).toBe(
      "AddCallOutcomeTrackingToCallLog1809090000000",
    );
  });
});

describe("the CallLog model says the same", () => {
  test("the token: nullable text of 100 characters, wide enough for the UUID it holds", () => {
    const column: ColumnMetadataArgs | undefined = columnOf(
      "statusCallbackToken",
    );

    expect(column?.options.nullable).toBe(true);
    expect(column?.options.length).toBe(100);
    expect(column?.options.length).toBeGreaterThanOrEqual(
      "6c0e0000-0000-4000-8000-000000000001".length,
    );
  });

  test("the notification: a nullable id, indexed, whose row's deletion takes the link with it", () => {
    expect(columnOf("userOnCallLogTimelineId")?.options.nullable).toBe(true);

    const indexed: Array<unknown> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs) => {
        return index.target === CallLog;
      })
      .map((index: IndexMetadataArgs): unknown => {
        return index.columns;
      });

    expect(indexed).toContainEqual(["userOnCallLogTimelineId"]);

    const relation: RelationMetadataArgs | undefined = getMetadataArgsStorage()
      .relations.filter((args: RelationMetadataArgs) => {
        return (
          args.target === CallLog &&
          args.propertyName === "userOnCallLogTimeline"
        );
      })
      .pop();

    expect(relation?.relationType).toBe("many-to-one");
    expect(relation?.options.onDelete).toBe("CASCADE");
    expect(relation?.options.nullable).toBe(true);
  });

  test("nobody reads, writes or is shown the token through the API", () => {
    const callLog: CallLog = new CallLog();
    const access: { create: Array<unknown>; read: Array<unknown> } =
      callLog.getColumnAccessControlForAllColumns()["statusCallbackToken"] as {
        create: Array<unknown>;
        read: Array<unknown>;
      };

    expect(access.read).toEqual([]);
    expect(access.create).toEqual([]);
  });
});
