import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddCreatedNotificationHeldAt1809174700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809174700000-AddCreatedNotificationHeldAt";
import { AddCreatedNotificationHeldAtIndexes1809174710000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809174710000-AddCreatedNotificationHeldAtIndexes";
import { SetNetworkEndpointFillfactor1809173200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809173200000-SetNetworkEndpointFillfactor";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two migrations behind the owners' Created notification's hold written
 * on the record (issue #7571): when an incident's or alert's hold began
 * (createdNotificationHeldAt). The column is nullable with no default, so
 * it is added without rewriting either table, and every existing record
 * reads as before - not held. Its partial indexes are built online, outside
 * a transaction, in a migration of their own. Statements are recorded
 * against a fake QueryRunner.
 */

const COLUMN_MIGRATION: string = "AddCreatedNotificationHeldAt1809174700000";
const INDEX_MIGRATION: string =
  "AddCreatedNotificationHeldAtIndexes1809174710000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const INCIDENT_INDEX: string = `CREATE INDEX "IDX_4ac07dd547a85779a03fd13272" ON "Incident" ("createdNotificationHeldAt") WHERE "createdNotificationHeldAt" IS NOT NULL AND "deletedAt" IS NULL`;
const ALERT_INDEX: string = `CREATE INDEX "IDX_5b2a0df8114b3ccf91efec3861" ON "Alert" ("createdNotificationHeldAt") WHERE "createdNotificationHeldAt" IS NOT NULL AND "deletedAt" IS NULL`;

type MigrationClass = new () => MigrationInterface;

const MIGRATIONS: Array<MigrationClass> = [
  AddCreatedNotificationHeldAt1809174700000,
  AddCreatedNotificationHeldAtIndexes1809174710000,
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

function indexesOf(model: { new (): BaseModel }): Array<IndexMetadataArgs> {
  return getMetadataArgsStorage().indices.filter(
    (index: IndexMetadataArgs): boolean => {
      return index.target === model;
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Created notification hold migrations", () => {
  test("name themselves after their timestamps", () => {
    expect(new AddCreatedNotificationHeldAt1809174700000().name).toBe(
      COLUMN_MIGRATION,
    );
    expect(new AddCreatedNotificationHeldAtIndexes1809174710000().name).toBe(
      INDEX_MIGRATION,
    );
  });

  test("are registered once each, after every earlier migration, the indexes right after the columns", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddCreatedNotificationHeldAt1809174700000,
    );

    for (const migration of MIGRATIONS) {
      expect(
        registered.filter((candidate: MigrationClass): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }

    expect(at).toBeGreaterThan(
      registered.indexOf(SetNetworkEndpointFillfactor1809173200000),
    );
    expect(registered[at + 1]).toBe(
      AddCreatedNotificationHeldAtIndexes1809174710000,
    );
    expect(
      timestampOf(AddCreatedNotificationHeldAtIndexes1809174710000),
    ).toBeGreaterThan(timestampOf(AddCreatedNotificationHeldAt1809174700000));

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddCreatedNotificationHeldAt1809174700000),
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

  test("add the two columns, nullable, with no default and nothing backfilled", async () => {
    const steps: Array<string> = await record(
      new AddCreatedNotificationHeldAt1809174700000(),
      "up",
    );

    expect(steps).toEqual([
      `ALTER TABLE "Incident" ADD "createdNotificationHeldAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "Alert" ADD "createdNotificationHeldAt" TIMESTAMP WITH TIME ZONE`,
    ]);

    for (const step of steps) {
      expect(step).not.toMatch(/NOT NULL|DEFAULT|UPDATE |INDEX/);
    }
  });

  test("build the two partial indexes online, outside a transaction", async () => {
    const migration: AddCreatedNotificationHeldAtIndexes1809174710000 =
      new AddCreatedNotificationHeldAtIndexes1809174710000();

    expect(migration.transaction).toBe(false);
    expect(await record(migration, "up")).toEqual([
      `online: ${INCIDENT_INDEX}`,
      `online: ${ALERT_INDEX}`,
    ]);
  });

  test("down drops the indexes online, then the columns, in the reverse order", async () => {
    expect(
      await record(
        new AddCreatedNotificationHeldAtIndexes1809174710000(),
        "down",
      ),
    ).toEqual([
      `online: DROP INDEX "public"."IDX_5b2a0df8114b3ccf91efec3861"`,
      `online: DROP INDEX "public"."IDX_4ac07dd547a85779a03fd13272"`,
    ]);
    expect(
      await record(new AddCreatedNotificationHeldAt1809174700000(), "down"),
    ).toEqual([
      `ALTER TABLE "Alert" DROP COLUMN "createdNotificationHeldAt"`,
      `ALTER TABLE "Incident" DROP COLUMN "createdNotificationHeldAt"`,
    ]);
  });

  describe("the models declare what the migrations build", () => {
    test.each([
      ["Incident", Incident],
      ["Alert", Alert],
    ])(
      "%s.createdNotificationHeldAt",
      (_name: string, model: { new (): BaseModel }) => {
        expect(
          new model().getTableColumnMetadata("createdNotificationHeldAt")?.type,
        ).toBe(TableColumnType.Date);
      },
    );

    test.each([
      ["Incident", Incident],
      ["Alert", Alert],
    ])(
      "%s's partial index, as the migration builds it",
      (_name: string, model: { new (): BaseModel }) => {
        const partial: Array<IndexMetadataArgs> = indexesOf(model).filter(
          (index: IndexMetadataArgs): boolean => {
            return (
              index.where ===
              `"createdNotificationHeldAt" IS NOT NULL AND "deletedAt" IS NULL`
            );
          },
        );

        expect(partial).toHaveLength(1);
        expect(partial[0]!.columns).toEqual(["createdNotificationHeldAt"]);
      },
    );
  });
});
