/**
 * The two columns an Incoming Request monitor keeps its latest request in
 * (#6402).
 *
 * Monitor.incomingMonitorRequest is the copy people read - the overview,
 * the API, MCP, Terraform, workflow and runbook steps - cut as the
 * monitor's logs are, so everyone who reads the monitor may read it, a
 * Viewer included.
 *
 * Monitor.incomingMonitorRequestAsReceived is the request as it came, for
 * the heartbeat job to judge again. Nobody reads or writes it through the
 * API: no role is on its lists, it is left out of the API reference, of
 * exports and of relation reads, and it is written by the server alone.
 */

import Monitor from "../../Models/DatabaseModels/Monitor";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const SCHEMA_MIGRATIONS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_FILE: string =
  "1809080466402-AddIncomingMonitorRequestAsReceived";

function typeOrmColumn(propertyName: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === Monitor && column.propertyName === propertyName;
  });
}

function accessOf(column: string): {
  create?: Array<Permission>;
  read?: Array<Permission>;
  update?: Array<Permission>;
} {
  return new Monitor().getColumnAccessControlFor(column) || {};
}

// The migration's up() and down(), apart.
function migrationHalves(): { up: string; down: string } {
  const migration: string = fs.readFileSync(
    path.join(SCHEMA_MIGRATIONS_DIRECTORY, `${MIGRATION_FILE}.ts`),
    "utf8",
  );
  const downAt: number = migration.indexOf("public async down(");

  expect(downAt).toBeGreaterThan(0);

  return {
    up: migration.slice(0, downAt),
    down: migration.slice(downAt),
  };
}

describe("Monitor.incomingMonitorRequestAsReceived: the request as it came", () => {
  test("no role reads, creates or updates it", () => {
    const access: ReturnType<typeof accessOf> = accessOf(
      "incomingMonitorRequestAsReceived",
    );

    expect(access.create).toEqual([]);
    expect(access.read).toEqual([]);
    expect(access.update).toEqual([]);
  });

  test("it is the server's: computed, left out of the API reference and of relation reads", () => {
    const metadata: TableColumnMetadata = new Monitor().getTableColumnMetadata(
      "incomingMonitorRequestAsReceived",
    );

    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.computed).toBe(true);
    expect(metadata.hideColumnInDocumentation).toBe(true);
    expect(metadata.canReadOnRelationQuery).toBe(false);
  });

  test("it is a nullable jsonb column: a monitor no request reached holds none", () => {
    const column: ColumnMetadataArgs | undefined = typeOrmColumn(
      "incomingMonitorRequestAsReceived",
    );

    expect(column).toBeDefined();
    expect(column!.options.type).toBe("jsonb");
    expect(column!.options.nullable).toBe(true);
  });

  test("the migration adds it as jsonb, and down() drops it", () => {
    const { up, down } = migrationHalves();

    expect(up).toContain(
      'ALTER TABLE "Monitor" ADD "incomingMonitorRequestAsReceived" jsonb',
    );
    expect(down).toContain(
      'ALTER TABLE "Monitor" DROP COLUMN "incomingMonitorRequestAsReceived"',
    );
  });

  test("the migration runs: it is in the list, last of all", () => {
    const index: string = fs.readFileSync(
      path.join(SCHEMA_MIGRATIONS_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { AddIncomingMonitorRequestAsReceived1809080466402 } from "./${MIGRATION_FILE}";`,
    );

    const list: string = index.slice(index.indexOf("export default ["));

    expect(list.trim().replace(/\s+/g, " ")).toMatch(
      /AddIncomingMonitorRequestAsReceived1809080466402, \];$/,
    );
  });
});

describe("Monitor.incomingMonitorRequest: the copy people read", () => {
  test.each([
    Permission.Viewer,
    Permission.MonitorViewer,
    Permission.ReadProjectMonitor,
    Permission.ProjectMember,
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
  ])("%s still reads it: the overview shows it", (permission: Permission) => {
    expect(accessOf("incomingMonitorRequest").read).toContain(permission);
  });

  /*
   * A monitor's create may carry one, as it always could; every request
   * that comes in writes both copies over it, and the heartbeat splits a
   * copy with no request beside it.
   */
  test("nobody updates it through the API: the server writes it, from each request", () => {
    expect(accessOf("incomingMonitorRequest").update).toEqual([]);
  });

  test("its description says what it holds: cut as the logs are", () => {
    const metadata: TableColumnMetadata = new Monitor().getTableColumnMetadata(
      "incomingMonitorRequest",
    );

    expect(metadata.description).toContain("secrets masked");
    expect(metadata.description).toContain("no headers or body");
  });
});
