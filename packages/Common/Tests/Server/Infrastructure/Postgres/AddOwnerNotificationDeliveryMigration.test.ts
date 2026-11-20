import { RecordActorUtil } from "../../../../Types/Database/RecordActor";
import { AddOwnerNotificationDelivery1809179400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809179400000-AddOwnerNotificationDelivery";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import OwnerNotificationDelivery from "../../../../Models/DatabaseModels/OwnerNotificationDelivery";
import { OwnerNotificationDeliveryStatus } from "../../../../Types/Notification/OwnerNotificationDelivery";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The schema half of "every owner of an incident or an alert told once,
 * however the worker stops" (issue #8199).
 *
 * The migration was generated against the model, so its names are
 * TypeORM's by construction; the Schema Drift workflow checks the result.
 * What this pins is what the owner notification jobs rely on, so a hand
 * edit cannot quietly drop it: the table has every column the model
 * persists; one row per notification and owner is enforced by the database
 * (OwnerNotificationDeliveryService writes them with ON CONFLICT DO NOTHING
 * on exactly these columns, so two runs writing the same owners at once
 * write one row); the index the read of what a stopped run left goes
 * through holds only the owners still to be told; a row goes with its
 * project or its user; it is registered after every migration before it;
 * and down() undoes up(). A new table, so it needs no online DDL.
 *
 * Fake QueryRunner only.
 */

const MIGRATION_NAME: string = "AddOwnerNotificationDelivery1809179400000";
const MIGRATION_TIMESTAMP: number = 1809179400000;

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddOwnerNotificationDelivery1809179400000()[direction](queryRunner);

  return statements;
};

// Columns a model persists, inherited ones (_id, version, ...) included.
function persistedColumns(modelType: unknown): Array<string> {
  const names: Array<string> = [];
  let current: unknown = modelType;

  while (typeof current === "function" && current !== Function.prototype) {
    for (const column of getMetadataArgsStorage().columns) {
      if (column.target === current) {
        const args: ColumnMetadataArgs = column;
        const name: string = args.options.name || args.propertyName;

        // Added to every table later (AddRecordCreatedByAndLastModifiedColumns, #10290).
        if (!RecordActorUtil.isColumn(name)) {
          names.push(name);
        }
      }
    }

    current = Object.getPrototypeOf(current);
  }

  return names;
}

describe("AddOwnerNotificationDelivery1809179400000", () => {
  test("is named and numbered as it is registered, after every migration before it", () => {
    const migration: AddOwnerNotificationDelivery1809179400000 =
      new AddOwnerNotificationDelivery1809179400000();

    expect(migration.name).toBe(MIGRATION_NAME);
    expect(Number(MIGRATION_NAME.slice(-13))).toBe(MIGRATION_TIMESTAMP);

    const index: number = SchemaMigrations.indexOf(
      AddOwnerNotificationDelivery1809179400000,
    );

    expect(index).toBeGreaterThan(0);

    const timestamps: Array<number> = SchemaMigrations.slice(0, index).map(
      (migrationType: unknown): number => {
        const name: string = new (migrationType as new () => {
          name: string;
        })().name;
        return Number(name.slice(-13));
      },
    );

    for (const timestamp of timestamps) {
      expect(timestamp).toBeLessThan(MIGRATION_TIMESTAMP);
    }
  });

  test("creates the table with every column the model persists, but those later migrations add", async () => {
    const statements: Array<string> = await recordQueries("up");
    const create: string = statements[0]!;

    expect(create.startsWith(`CREATE TABLE "OwnerNotificationDelivery"`)).toBe(
      true,
    );

    // Added by AddOwnerNotificationFeedStatus1809179600000 (#8510).
    const addedLater: Array<string> = ["feedStatus"];

    for (const column of persistedColumns(OwnerNotificationDelivery)) {
      expect([column, create.includes(`"${column}"`)]).toEqual([
        column,
        !addedLater.includes(column),
      ]);
    }

    for (const required of [
      `"projectId" uuid NOT NULL`,
      `"kind" character varying(100) NOT NULL`,
      `"resourceId" uuid NOT NULL`,
      `"eventId" uuid NOT NULL`,
      `"occurrence" integer NOT NULL`,
      `"userId" uuid NOT NULL`,
      `"isProjectOwner" boolean NOT NULL`,
      `"status" character varying(100) NOT NULL`,
      `"attempts" integer NOT NULL`,
      `"attemptedAt" TIMESTAMP WITH TIME ZONE NOT NULL`,
    ]) {
      expect([required, create.includes(required)]).toEqual([required, true]);
    }
  });

  test("one row per notification and owner, as the model declares and the service's ON CONFLICT names", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(
      statements.filter((statement: string): boolean => {
        return (
          statement.startsWith("CREATE UNIQUE INDEX") &&
          statement.includes(
            `ON "OwnerNotificationDelivery" ("kind", "eventId", "occurrence", "userId")`,
          )
        );
      }),
    ).toHaveLength(1);

    const declared: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === OwnerNotificationDelivery && index.unique === true
          );
        },
      );

    expect(
      declared.map((index: IndexMetadataArgs): unknown => {
        return index.columns;
      }),
    ).toEqual([["kind", "eventId", "occurrence", "userId"]]);
  });

  test("the read of what a stopped run left has an index of the owners still to be told only", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(
      statements.filter((statement: string): boolean => {
        return (
          statement.startsWith("CREATE INDEX") &&
          statement.includes(
            `ON "OwnerNotificationDelivery" ("kind", "attemptedAt") WHERE "status" = '${OwnerNotificationDeliveryStatus.Pending}'`,
          )
        );
      }),
    ).toHaveLength(1);
  });

  test("a row goes with its project and with its user", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const key of [
      `FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE`,
      `FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE`,
    ]) {
      expect([
        key,
        statements.some((statement: string): boolean => {
          return statement.includes(key);
        }),
      ]).toEqual([key, true]);
    }

    // Both are looked up by: deleting a project or a user finds its rows by index.
    for (const column of ["projectId", "userId"]) {
      expect(
        statements.some((statement: string): boolean => {
          return (
            statement.startsWith("CREATE INDEX") &&
            statement.includes(`("${column}") `)
          );
        }),
      ).toBe(true);
    }
  });

  test("down() drops everything up() made, in reverse", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    const madeIndexes: Array<string> = up
      .map((statement: string): string | null => {
        return statement.match(/INDEX "([^"]+)"/)?.[1] || null;
      })
      .filter((name: string | null): name is string => {
        return Boolean(name);
      });

    const madeKeys: Array<string> = up
      .map((statement: string): string | null => {
        return statement.match(/ADD CONSTRAINT "([^"]+)"/)?.[1] || null;
      })
      .filter((name: string | null): name is string => {
        return Boolean(name);
      });

    for (const name of madeIndexes) {
      expect(down).toContain(`DROP INDEX "public"."${name}"`);
    }

    for (const name of madeKeys) {
      expect(down).toContain(
        `ALTER TABLE "OwnerNotificationDelivery" DROP CONSTRAINT "${name}"`,
      );
    }

    expect(down[down.length - 1]).toBe(
      `DROP TABLE "OwnerNotificationDelivery"`,
    );
    expect(down.length).toBe(up.length);
  });
});
