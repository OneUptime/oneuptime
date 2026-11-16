import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage, MigrationInterface } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddIncomingRequestSecretActivity1809179500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809179500000-AddIncomingRequestSecretActivity";
import { AddOwnerNotificationDelivery1809179400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809179400000-AddOwnerNotificationDelivery";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { IncomingRequestSecretProblem } from "../../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";

/*
 * The migration behind a monitor's record of whether its requests send one of
 * the project's incoming request secrets (issue #8498): three columns on
 * "Monitor".
 *
 * The SQL is generated, and the schema-drift job proves it matches the
 * model. What this pins is what a regeneration could quietly reverse:
 *
 *  1. AN UPGRADE REWRITES NO MONITOR. The columns are nullable with no
 *     default, so Postgres only adds them to its catalog: "Monitor" is large
 *     and written all the time, and must not be locked while every row is
 *     rewritten.
 *  2. THE STAMPS STAY CHEAP. No index names the columns, so the stamps that
 *     fill them, at most every five minutes per monitor, stay HOT updates.
 *  3. A REASON FITS. Every reason the code stores fits the column.
 *  4. IT RUNS AFTER THE MIGRATION BEFORE IT, and its file and class agree.
 */

const MIGRATION_FILE_NAME: string =
  "1809179500000-AddIncomingRequestSecretActivity.ts";

const COLUMNS: Array<string> = [
  "incomingRequestWithSecretAt",
  "incomingRequestWithoutSecretAt",
  "incomingRequestWithoutSecretReason",
];

const SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    `../../../../Server/Infrastructure/Postgres/SchemaMigrations/${MIGRATION_FILE_NAME}`,
  ),
  "utf8",
);

function bodyOf(method: "up" | "down"): string {
  const start: number = SOURCE.indexOf(`public async ${method}(`);

  expect(start).toBeGreaterThan(-1);

  const end: number =
    method === "up" ? SOURCE.indexOf("public async down(") : SOURCE.length;

  return SOURCE.slice(start, end);
}

const UP: string = bodyOf("up");
const DOWN: string = bodyOf("down");

// The Monitor columns an @Index() names, alone or with others.
function indexedMonitorColumns(): Array<string> {
  return getMetadataArgsStorage()
    .indices.filter((index: { target: unknown }): boolean => {
      return index.target === Monitor;
    })
    .flatMap((index: { columns?: unknown }): Array<string> => {
      return Array.isArray(index.columns)
        ? (index.columns as Array<string>)
        : [];
    });
}

// The SQL statements of a method, one per queryRunner.query call.
function statementsOf(body: string): Array<string> {
  return Array.from(body.matchAll(/`([^`]+)`/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

describe("AddIncomingRequestSecretActivity migration", () => {
  test("adds the three columns, and only them, to Monitor", () => {
    expect(statementsOf(UP)).toEqual([
      `ALTER TABLE "Monitor" ADD "incomingRequestWithSecretAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "Monitor" ADD "incomingRequestWithoutSecretAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "Monitor" ADD "incomingRequestWithoutSecretReason" character varying(100)`,
    ]);
  });

  test("rewrites no monitor: every column is nullable, with no default", () => {
    expect(UP).not.toContain("NOT NULL");
    expect(UP).not.toContain("DEFAULT");

    for (const column of COLUMNS) {
      expect(new Monitor().getTableColumnMetadata(column)).toMatchObject({
        required: false,
      });
      expect(
        new Monitor().getTableColumnMetadata(column).defaultValue,
      ).toBeUndefined();
    }
  });

  test("indexes nothing, so the stamps stay HOT updates", () => {
    expect(UP).not.toContain("INDEX");

    const indexed: Array<string> = indexedMonitorColumns();

    // The model's own indexes are read: projectId is one of them.
    expect(indexed).toContain("projectId");

    for (const column of COLUMNS) {
      expect({ column, indexed: indexed.includes(column) }).toEqual({
        column,
        indexed: false,
      });
    }
  });

  test("the columns are what the model declares", () => {
    const monitor: Monitor = new Monitor();

    expect(
      monitor.getTableColumnMetadata("incomingRequestWithSecretAt").type,
    ).toBe(TableColumnType.Date);
    expect(
      monitor.getTableColumnMetadata("incomingRequestWithoutSecretAt").type,
    ).toBe(TableColumnType.Date);
    expect(
      monitor.getTableColumnMetadata("incomingRequestWithoutSecretReason").type,
    ).toBe(TableColumnType.ShortText);
  });

  test("every reason the code stores fits the column", () => {
    for (const reason of Object.values(IncomingRequestSecretProblem)) {
      expect(reason.length).toBeLessThanOrEqual(100);
    }
  });

  test("down takes away everything up added, in the reverse order", () => {
    expect(statementsOf(DOWN)).toEqual([
      `ALTER TABLE "Monitor" DROP COLUMN "incomingRequestWithoutSecretReason"`,
      `ALTER TABLE "Monitor" DROP COLUMN "incomingRequestWithoutSecretAt"`,
      `ALTER TABLE "Monitor" DROP COLUMN "incomingRequestWithSecretAt"`,
    ]);
  });

  test("is registered right after the migration before it, under its own name", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { new (): MigrationInterface }) => {
        return migration.name;
      },
    );

    const index: number = names.indexOf(
      AddIncomingRequestSecretActivity1809179500000.name,
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBe(
      names.indexOf(AddOwnerNotificationDelivery1809179400000.name) + 1,
    );
    expect(
      names.filter((name: string): boolean => {
        return name === AddIncomingRequestSecretActivity1809179500000.name;
      }),
    ).toHaveLength(1);

    expect(new AddIncomingRequestSecretActivity1809179500000().name).toBe(
      "AddIncomingRequestSecretActivity1809179500000",
    );
    expect(MIGRATION_FILE_NAME.startsWith("1809179500000-")).toBe(true);
  });
});
