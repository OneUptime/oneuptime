import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddOwnerNotificationDelivery1809179400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809179400000-AddOwnerNotificationDelivery";
import { AddOwnerNotificationFeedStatus1809179500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809179500000-AddOwnerNotificationFeedStatus";
import { AddOwnerNotificationFeedStatusIndex1809179510000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809179510000-AddOwnerNotificationFeedStatusIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import OwnerNotificationDelivery from "../../../../Models/DatabaseModels/OwnerNotificationDelivery";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { getTableColumn } from "../../../../Types/Database/TableColumn";
import { OwnerNotificationFeedStatus } from "../../../../Types/Notification/OwnerNotificationDelivery";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two migrations behind whether an owner notification's feed item is
 * written yet (issue #8510): OwnerNotificationDelivery.feedStatus. The
 * column is nullable with no default, so it is added without rewriting the
 * table, and every existing row reads as before - no feed item kept, never
 * taken up. Its partial index is built online, outside a transaction, in a
 * migration of its own. Statements are recorded against a fake QueryRunner.
 */

const COLUMN_MIGRATION: string = "AddOwnerNotificationFeedStatus1809179500000";
const INDEX_MIGRATION: string =
  "AddOwnerNotificationFeedStatusIndex1809179510000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const FEED_INDEX: string = `CREATE INDEX "IDX_6949512eb6ccac3f68f3d589a4" ON "OwnerNotificationDelivery" ("kind", "attemptedAt") WHERE "feedStatus" = 'Pending'`;

type MigrationClass = new () => MigrationInterface;

const MIGRATIONS: Array<MigrationClass> = [
  AddOwnerNotificationFeedStatus1809179500000,
  AddOwnerNotificationFeedStatusIndex1809179510000,
];

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

  for (const step of ["createIndex", "dropIndex"] as const) {
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

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the owner notification feed status migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(new AddOwnerNotificationFeedStatus1809179500000().name).toBe(
      COLUMN_MIGRATION,
    );
    expect(new AddOwnerNotificationFeedStatusIndex1809179510000().name).toBe(
      INDEX_MIGRATION,
    );
  });

  test("are registered once each, after the table's own, the index right after the column", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddOwnerNotificationFeedStatus1809179500000,
    );

    for (const migration of MIGRATIONS) {
      expect(
        registered.filter((candidate: MigrationClass): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(at).toBeGreaterThan(
      registered.indexOf(AddOwnerNotificationDelivery1809179400000),
    );
    expect(registered[at + 1]).toBe(
      AddOwnerNotificationFeedStatusIndex1809179510000,
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddOwnerNotificationFeedStatus1809179500000),
      );
    }
  });

  test("are backed by exactly one file each", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    for (const migration of MIGRATIONS) {
      expect(
        files.filter((file: string): boolean => {
          return file.startsWith(`${timestampOf(migration)}-`);
        }),
      ).toHaveLength(1);
    }
  });

  test("add the column, nullable, with no default and nothing backfilled", async () => {
    const steps: Array<string> = await record(
      new AddOwnerNotificationFeedStatus1809179500000(),
      "up",
    );

    expect(steps).toEqual([
      `ALTER TABLE "OwnerNotificationDelivery" ADD "feedStatus" character varying(100)`,
    ]);
    expect(steps[0]).not.toMatch(/NOT NULL|DEFAULT|UPDATE |INDEX/);
  });

  test("build the partial index online, outside a transaction", async () => {
    const migration: AddOwnerNotificationFeedStatusIndex1809179510000 =
      new AddOwnerNotificationFeedStatusIndex1809179510000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([`online: ${FEED_INDEX}`]);
  });

  test("down drops the index online, then the column", async () => {
    expect(
      await record(
        new AddOwnerNotificationFeedStatusIndex1809179510000(),
        "down",
      ),
    ).toEqual([`online: DROP INDEX "public"."IDX_6949512eb6ccac3f68f3d589a4"`]);
    expect(
      await record(new AddOwnerNotificationFeedStatus1809179500000(), "down"),
    ).toEqual([
      `ALTER TABLE "OwnerNotificationDelivery" DROP COLUMN "feedStatus"`,
    ]);
  });

  test("the model declares what they build: the column, nullable, of the feed's statuses, and the partial index", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (each: ColumnMetadataArgs): boolean => {
          return (
            each.target === OwnerNotificationDelivery &&
            each.propertyName === "feedStatus"
          );
        },
      );

    expect(column?.options.nullable).toBe(true);
    expect(
      getTableColumn(new OwnerNotificationDelivery(), "feedStatus"),
    ).toMatchObject({
      type: TableColumnType.ShortText,
      required: false,
      allowedValues: Object.values(OwnerNotificationFeedStatus),
    });

    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === OwnerNotificationDelivery;
        },
      );

    expect(
      indexes.some((index: IndexMetadataArgs): boolean => {
        return (
          JSON.stringify(index.columns) ===
            JSON.stringify(["kind", "attemptedAt"]) &&
          index.where === `"feedStatus" = 'Pending'`
        );
      }),
    ).toBe(true);
  });
});
