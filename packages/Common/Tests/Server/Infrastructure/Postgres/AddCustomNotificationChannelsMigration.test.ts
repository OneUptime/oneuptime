import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddCustomNotificationChannelIndexesAndKeys1808090000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808090000000-AddCustomNotificationChannelIndexesAndKeys";
import { AddCustomNotificationChannels1808080000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808080000000-AddCustomNotificationChannels";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { MigrationInterface, QueryRunner } from "typeorm";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Custom channels add one table, "CustomNotificationChannel", and a nullable
 * column to two tables that are among the busiest on a server -
 * "UserNotificationRule" and "UserOnCallLogTimeline". The new table's keys
 * are built on an empty table; the two columns are added with no default,
 * which rewrites and scans nothing; and their indexes and keys are built
 * online, in a migration of their own, outside a transaction.
 */

const TABLE_MIGRATION: string = "AddCustomNotificationChannels1808080000000";
const KEYS_MIGRATION: string =
  "AddCustomNotificationChannelIndexesAndKeys1808090000000";

async function record(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const steps: Array<string> = [];

  const runner: QueryRunner = {
    isTransactionActive: false,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  for (const step of ["createIndex", "addForeignKey", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      steps.push(`online: ${statement}`);
    }) as never);
  }

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the custom channel migrations", () => {
  test("name themselves after their classes", () => {
    expect(new AddCustomNotificationChannels1808080000000().name).toBe(
      TABLE_MIGRATION,
    );
    expect(
      new AddCustomNotificationChannelIndexesAndKeys1808090000000().name,
    ).toBe(KEYS_MIGRATION);
  });

  test("are registered once each, the table before its indexes and keys, after every migration before them", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === TABLE_MIGRATION || name === KEYS_MIGRATION;
      }),
    ).toEqual([TABLE_MIGRATION, KEYS_MIGRATION]);
    expect(names.indexOf(KEYS_MIGRATION)).toBe(
      names.indexOf(TABLE_MIGRATION) + 1,
    );
    expect(names.indexOf(TABLE_MIGRATION)).toBeGreaterThan(
      names.indexOf("AddCloudAccounts1807900000000"),
    );
  });

  test("create the table with every column the model has", async () => {
    const steps: Array<string> = await record(
      new AddCustomNotificationChannels1808080000000(),
      "up",
    );

    expect(steps[0]).toMatch(/^CREATE TABLE "CustomNotificationChannel" /);

    for (const column of [
      `"name" character varying(100) NOT NULL`,
      `"webhookUrl" character varying(500) NOT NULL`,
      `"secret" character varying(100) NOT NULL`,
      `"isEnabled" boolean NOT NULL DEFAULT true`,
      `"pageEveryoneByDefault" boolean NOT NULL DEFAULT true`,
      `"addedToEveryonesRulesAt" TIMESTAMP WITH TIME ZONE`,
      `"createdByUserId" uuid`,
      `"deletedByUserId" uuid`,
    ]) {
      expect(steps[0]).toContain(column);
    }
  });

  test("add the two columns to the busy tables as nullable, with no default, so nothing is rewritten", async () => {
    const steps: Array<string> = await record(
      new AddCustomNotificationChannels1808080000000(),
      "up",
    );

    expect(steps).toContain(
      `ALTER TABLE "UserNotificationRule" ADD "customNotificationChannelId" uuid`,
    );
    expect(steps).toContain(
      `ALTER TABLE "UserOnCallLogTimeline" ADD "customNotificationChannelId" uuid`,
    );
  });

  test("build nothing that scans a busy table in the transactional migration", async () => {
    const steps: Array<string> = await record(
      new AddCustomNotificationChannels1808080000000(),
      "up",
    );

    for (const step of steps) {
      const scansATable: boolean =
        step.includes("CREATE INDEX") || step.includes("FOREIGN KEY");

      if (scansATable) {
        expect(step).not.toContain(`"UserNotificationRule"`);
        expect(step).not.toContain(`"UserOnCallLogTimeline"`);
      }
    }

    expect(
      steps.filter((step: string): boolean => {
        return step.startsWith("online:");
      }),
    ).toEqual([]);
  });

  test("build the indexes and keys online, outside a transaction", async () => {
    const migration: AddCustomNotificationChannelIndexesAndKeys1808090000000 =
      new AddCustomNotificationChannelIndexesAndKeys1808090000000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([
      `online: CREATE INDEX "IDX_9007ed46795bf227769761ea87" ON "UserNotificationRule" ("customNotificationChannelId") `,
      `online: CREATE INDEX "IDX_89ba6c7d5c32a8bf1f1c8ade98" ON "UserOnCallLogTimeline" ("customNotificationChannelId") `,
      `online: ALTER TABLE "UserNotificationRule" ADD CONSTRAINT "FK_9007ed46795bf227769761ea871" FOREIGN KEY ("customNotificationChannelId") REFERENCES "CustomNotificationChannel"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      `online: ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_89ba6c7d5c32a8bf1f1c8ade98e" FOREIGN KEY ("customNotificationChannelId") REFERENCES "CustomNotificationChannel"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("deleting a channel deletes the rules that page through it, and keeps the history", async () => {
    const steps: Array<string> = await record(
      new AddCustomNotificationChannelIndexesAndKeys1808090000000(),
      "up",
    );

    const keys: Array<string> = steps.filter((step: string): boolean => {
      return step.includes("FOREIGN KEY");
    });

    expect(
      keys.find((key: string): boolean => {
        return key.includes(`"UserNotificationRule"`);
      }),
    ).toContain("ON DELETE CASCADE");
    expect(
      keys.find((key: string): boolean => {
        return key.includes(`"UserOnCallLogTimeline"`);
      }),
    ).toContain("ON DELETE SET NULL");
  });

  test("undo the keys and indexes, then the columns and the table", async () => {
    expect(
      await record(
        new AddCustomNotificationChannelIndexesAndKeys1808090000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_89ba6c7d5c32a8bf1f1c8ade98e"`,
      `ALTER TABLE "UserNotificationRule" DROP CONSTRAINT "FK_9007ed46795bf227769761ea871"`,
      `online: DROP INDEX "public"."IDX_89ba6c7d5c32a8bf1f1c8ade98"`,
      `online: DROP INDEX "public"."IDX_9007ed46795bf227769761ea87"`,
    ]);

    const steps: Array<string> = await record(
      new AddCustomNotificationChannels1808080000000(),
      "down",
    );

    expect(steps[steps.length - 1]).toBe(
      `DROP TABLE "CustomNotificationChannel"`,
    );
    expect(steps).toContain(
      `ALTER TABLE "UserNotificationRule" DROP COLUMN "customNotificationChannelId"`,
    );
    expect(steps).toContain(
      `ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "customNotificationChannelId"`,
    );
  });
});
