import CallLog from "../../../../Models/DatabaseModels/CallLog";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddCallOutcomeTrackingToCallLog1809090000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809090000000-AddCallOutcomeTrackingToCallLog";
import { AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809090010000-AddCallOutcomeTrackingToCallLogIndexAndKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

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
 * The index and foreign key are built online, in a migration of their own
 * outside a transaction (OnlineDdl): "CallLog" holds every call a project
 * made, and every call that goes out writes to it. Building them in the
 * columns' migration held SHARE on "CallLog" - and SHARE ROW EXCLUSIVE on
 * it and "UserOnCallLogTimeline" - for as long as the build and the check
 * of every row took (SchemaMigrationsOnlineDdl.test.ts).
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>".
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

  for (const step of ["createIndex", "addForeignKey", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function columnOf(property: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs) => {
      return args.target === CallLog && args.propertyName === property;
    })
    .pop();
}

describe("AddCallOutcomeTrackingToCallLog1809090000000", () => {
  test("adds the token and the notification - and nothing else", async () => {
    const migration: AddCallOutcomeTrackingToCallLog1809090000000 =
      new AddCallOutcomeTrackingToCallLog1809090000000();

    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "CallLog" ADD "statusCallbackToken" character varying(100)`,
      `ALTER TABLE "CallLog" ADD "userOnCallLogTimelineId" uuid`,
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

describe("AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000", () => {
  test("builds the notification's index and foreign key online, outside a transaction", async () => {
    const migration: AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000 =
      new AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: CREATE INDEX "${INDEX}" ON "CallLog" ("userOnCallLogTimelineId") `,
      `online: ALTER TABLE "CallLog" ADD CONSTRAINT "${FOREIGN_KEY}" FOREIGN KEY ("userOnCallLogTimelineId") REFERENCES "UserOnCallLogTimeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    ]);
  });

  test("down() takes the key, then the index, away - the columns' migration then the columns", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "CallLog" DROP CONSTRAINT "${FOREIGN_KEY}"`,
      `online: DROP INDEX "public"."${INDEX}"`,
    ]);
  });

  test("is registered right after the columns' migration, named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const at: number = registered.indexOf(
      AddCallOutcomeTrackingToCallLog1809090000000,
    );

    expect(at).toBeGreaterThan(-1);
    expect(registered[at + 1]).toBe(
      AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000,
    );
    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate === AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000
        );
      }),
    ).toHaveLength(1);
    expect(
      new AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000().name,
    ).toBe("AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000");
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
