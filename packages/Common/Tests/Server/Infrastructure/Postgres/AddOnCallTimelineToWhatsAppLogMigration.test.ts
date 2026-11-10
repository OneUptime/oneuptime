import WhatsAppLog from "../../../../Models/DatabaseModels/WhatsAppLog";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddOnCallTimelineToWhatsAppLog1809100612200 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809100612200-AddOnCallTimelineToWhatsAppLog";
import { AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809100612210-AddOnCallTimelineToWhatsAppLogIndexAndKey";
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
 * A WHATSAPP MESSAGE'S LOG KEEPS THE ON-CALL NOTIFICATION IT WAS SENT FOR
 * (#6648).
 *
 * As an SMS's and a call's logs do (AddDeliveryTrackingToSmsLog,
 * AddCallOutcomeTrackingToCallLog): Meta's status webhook reads it to tell
 * the platform's delivery metrics (notification.delivery.count) that the
 * message was an on-call page, as the send's own metric said. One nullable
 * column, an index and a foreign key, named as TypeORM names them, so the
 * schema drift check finds nothing to change. No row is rewritten: a
 * nullable column with no default is added without one.
 *
 * The index and foreign key are built online, in a migration of their own
 * outside a transaction (OnlineDdl): "WhatsAppLog" holds every WhatsApp
 * message a project sent, and every message that goes out writes to it.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>".
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const INDEX: string = naming.indexName("WhatsAppLog", [
  "userOnCallLogTimelineId",
]);
const FOREIGN_KEY: string = naming.foreignKeyName(
  "WhatsAppLog",
  ["userOnCallLogTimelineId"],
  "UserOnCallLogTimeline",
  ["_id"],
);

const UPDATE_STATEMENT: RegExp = /^UPDATE/;

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
      return args.target === WhatsAppLog && args.propertyName === property;
    })
    .pop();
}

describe("AddOnCallTimelineToWhatsAppLog1809100612200", () => {
  test("adds the notification's column - and nothing else", async () => {
    const migration: AddOnCallTimelineToWhatsAppLog1809100612200 =
      new AddOnCallTimelineToWhatsAppLog1809100612200();

    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`ALTER TABLE "WhatsAppLog" ADD "userOnCallLogTimelineId" uuid`]);
  });

  test("never rewrites the table: the column is nullable, with no default", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddOnCallTimelineToWhatsAppLog1809100612200().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toMatch(UPDATE_STATEMENT);
    }
  });

  test("down() takes back exactly what up() added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddOnCallTimelineToWhatsAppLog1809100612200().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "WhatsAppLog" DROP COLUMN "userOnCallLogTimelineId"`,
    ]);
  });

  test("is registered, after the migrations before it, and named for its class", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    const index: number = names.indexOf(
      "AddOnCallTimelineToWhatsAppLog1809100612200",
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("AddRumApplicationProductAnalyticsEvents1809096444000"),
    );
    expect(index).toBeGreaterThan(
      names.indexOf("AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000"),
    );
    expect(index).toBeGreaterThan(
      names.indexOf("AddDataDashboardUsageAndRefreshes1809100612000"),
    );
    expect(new AddOnCallTimelineToWhatsAppLog1809100612200().name).toBe(
      "AddOnCallTimelineToWhatsAppLog1809100612200",
    );
  });
});

describe("AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210", () => {
  test("the index and the key are named as TypeORM names them: the drift check finds nothing", () => {
    expect(INDEX).toBe("IDX_f6f9b9b3a51e0eee9b1bfa95b7");
    expect(FOREIGN_KEY).toBe("FK_f6f9b9b3a51e0eee9b1bfa95b76");
  });

  test("builds the notification's index and foreign key online, outside a transaction", async () => {
    const migration: AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210 =
      new AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: CREATE INDEX "${INDEX}" ON "WhatsAppLog" ("userOnCallLogTimelineId") `,
      `online: ALTER TABLE "WhatsAppLog" ADD CONSTRAINT "${FOREIGN_KEY}" FOREIGN KEY ("userOnCallLogTimelineId") REFERENCES "UserOnCallLogTimeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    ]);
  });

  test("down() takes the key, then the index, away - the columns' migration then the column", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "WhatsAppLog" DROP CONSTRAINT "${FOREIGN_KEY}"`,
      `online: DROP INDEX "public"."${INDEX}"`,
    ]);
  });

  test("is registered right after the column's migration, once, named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const at: number = registered.indexOf(
      AddOnCallTimelineToWhatsAppLog1809100612200,
    );

    expect(at).toBeGreaterThan(-1);
    expect(registered[at + 1]).toBe(
      AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210,
    );
    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate === AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210
        );
      }),
    ).toHaveLength(1);
    expect(
      new AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210().name,
    ).toBe("AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210");
  });
});

describe("the WhatsAppLog model says the same", () => {
  test("the notification: a nullable id, indexed, whose row's deletion takes the log with it - as an SMS's and a call's", () => {
    expect(columnOf("userOnCallLogTimelineId")?.options.nullable).toBe(true);

    const indexed: Array<unknown> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs) => {
        return index.target === WhatsAppLog;
      })
      .map((index: IndexMetadataArgs): unknown => {
        return index.columns;
      });

    expect(indexed).toContainEqual(["userOnCallLogTimelineId"]);

    const relation: RelationMetadataArgs | undefined = getMetadataArgsStorage()
      .relations.filter((args: RelationMetadataArgs) => {
        return (
          args.target === WhatsAppLog &&
          args.propertyName === "userOnCallLogTimeline"
        );
      })
      .pop();

    expect(relation?.relationType).toBe("many-to-one");
    expect(relation?.options.onDelete).toBe("CASCADE");
    expect(relation?.options.nullable).toBe(true);
  });

  test("read as the log's other columns are; nobody writes it through the API", () => {
    const log: WhatsAppLog = new WhatsAppLog();

    for (const column of ["userOnCallLogTimelineId", "userOnCallLogTimeline"]) {
      const access: {
        create: Array<unknown>;
        read: Array<unknown>;
        update: Array<unknown>;
      } = log.getColumnAccessControlForAllColumns()[column] as {
        create: Array<unknown>;
        read: Array<unknown>;
        update: Array<unknown>;
      };

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
      expect(access.read).toEqual(
        log.getColumnAccessControlForAllColumns()["onCallDutyPolicyScheduleId"]
          ?.read,
      );
    }
  });
});
