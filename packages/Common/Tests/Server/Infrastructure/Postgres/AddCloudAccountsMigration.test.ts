import { AddCloudAccounts1807900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807900000000-AddCloudAccounts";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../../Types/Database/TableColumn";
import Dictionary from "../../../../Types/Dictionary";
import { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * Cloud accounts add five tables - "CloudAccount" and its labels, and the
 * links of monitors, incidents and alerts to cloud resources - and the
 * inventory's columns on "CloudResource" and the rules. Every index and
 * key is on a table the migration creates, so each is built on an empty
 * table; the tables that exist only gain nullable columns with no
 * default, which rewrites nothing.
 */

const NEW_TABLES: ReadonlyArray<string> = [
  "CloudAccount",
  "CloudAccountLabel",
  "MonitorCloudResource",
  "IncidentCloudResource",
  "AlertCloudResource",
];

const EXISTING_TABLES: ReadonlyArray<string> = [
  "CloudResource",
  "CloudResourceLabelRule",
  "CloudResourceOwnerRule",
];

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface = new AddCloudAccounts1807900000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

describe("AddCloudAccounts1807900000000", () => {
  test("is registered after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(names).toContain("AddCloudAccounts1807900000000");
    /*
     * Directly after the migration it was numbered to follow - newer ones
     * may be registered after it (it was last until #5322 and #5326 added
     * theirs).
     */
    expect(names.indexOf("AddStatusPageDarkThemeLogoKey1807840000000")).toBe(
      names.indexOf("AddCloudAccounts1807900000000") - 1,
    );
    expect(new AddCloudAccounts1807900000000().name).toBe(
      "AddCloudAccounts1807900000000",
    );
  });

  test("creates the account table, one row per project, cloud and account id", async () => {
    const steps: Array<string> = await record("up");

    expect(steps[0]).toMatch(/^CREATE TABLE "CloudAccount" /);
    expect(steps).toContain(
      `CREATE UNIQUE INDEX "IDX_6dc4578485ddbaf5aeb603ad03" ON "CloudAccount" ("projectId", "provider", "accountId") `,
    );
    // Deleting a project takes its accounts; a connection going leaves them.
    expect(steps).toContain(
      `ALTER TABLE "CloudAccount" ADD CONSTRAINT "FK_f0218b0032b7103d501980fbfa3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    expect(steps).toContain(
      `ALTER TABLE "CloudAccount" ADD CONSTRAINT "FK_f3bfc7910122657fc8f56cc98ca" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudConnection"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  });

  test("links monitors, incidents and alerts to cloud resources, cascading both ways", async () => {
    const steps: Array<string> = await record("up");

    for (const [table, owner, ownerColumn] of [
      ["MonitorCloudResource", "Monitor", "monitorId"],
      ["IncidentCloudResource", "Incident", "incidentId"],
      ["AlertCloudResource", "Alert", "alertId"],
    ] as Array<[string, string, string]>) {
      expect(steps).toContain(
        `CREATE TABLE "${table}" ("${ownerColumn}" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, CONSTRAINT "${
          (steps
            .find((step: string): boolean => {
              return step.startsWith(`CREATE TABLE "${table}"`);
            })!
            .match(/CONSTRAINT "(PK_[a-f0-9]+)"/) || [])[1]
        }" PRIMARY KEY ("${ownerColumn}", "cloudResourceId"))`,
      );
      expect(
        steps.some((step: string): boolean => {
          return (
            step.startsWith(`ALTER TABLE "${table}" ADD CONSTRAINT`) &&
            step.includes(`REFERENCES "${owner}"("_id") ON DELETE CASCADE`)
          );
        }),
      ).toBe(true);
      expect(
        steps.some((step: string): boolean => {
          return (
            step.startsWith(`ALTER TABLE "${table}" ADD CONSTRAINT`) &&
            step.includes(`REFERENCES "CloudResource"("_id") ON DELETE CASCADE`)
          );
        }),
      ).toBe(true);
    }
  });

  test("adds the inventory's columns, nullable and with no default, to the tables that exist", async () => {
    const steps: Array<string> = await record("up");

    expect(steps).toEqual(
      expect.arrayContaining([
        `ALTER TABLE "CloudResource" ADD "cloudTags" jsonb`,
        `ALTER TABLE "CloudResource" ADD "cloudProperties" jsonb`,
        `ALTER TABLE "CloudResource" ADD "cloudRelationships" jsonb`,
        `ALTER TABLE "CloudResource" ADD "cloudEndpoints" jsonb`,
        `ALTER TABLE "CloudResource" ADD "inventoriedAt" TIMESTAMP WITH TIME ZONE`,
        `ALTER TABLE "CloudResource" ADD "cloudInventoryFingerprint" character varying(100)`,
        `ALTER TABLE "CloudResourceLabelRule" ADD "cloudTagPattern" character varying(500)`,
        `ALTER TABLE "CloudResourceOwnerRule" ADD "cloudTagPattern" character varying(500)`,
      ]),
    );

    for (const step of steps) {
      if (step.startsWith(`ALTER TABLE "CloudResource" ADD "`)) {
        expect(step).not.toMatch(/NOT NULL|DEFAULT/);
      }
    }
  });

  test("builds no index and adds no key on a table that exists", async () => {
    const steps: Array<string> = await record("up");

    for (const step of steps) {
      for (const table of EXISTING_TABLES) {
        expect(step).not.toMatch(
          new RegExp(`^CREATE (UNIQUE )?INDEX .* ON "${table}"`),
        );
        expect(step).not.toMatch(
          new RegExp(`^ALTER TABLE "${table}" ADD CONSTRAINT`),
        );
      }
    }

    // Each table it indexes or keys is one it created first.
    for (const step of steps) {
      const target: string | undefined = (step.match(
        /^(?:CREATE (?:UNIQUE )?INDEX "[^"]+" ON|ALTER TABLE) "([^"]+)" (?:\(|ADD CONSTRAINT)/,
      ) || [])[1];

      if (target) {
        expect(NEW_TABLES).toContain(target);
      }
    }
  });

  test("down takes back everything up added", async () => {
    const steps: Array<string> = await record("down");

    for (const table of NEW_TABLES) {
      expect(steps).toContain(`DROP TABLE "${table}"`);
    }

    expect(steps).toEqual(
      expect.arrayContaining([
        `ALTER TABLE "CloudResource" DROP COLUMN "cloudTags"`,
        `ALTER TABLE "CloudResource" DROP COLUMN "cloudInventoryFingerprint"`,
        `ALTER TABLE "CloudResourceLabelRule" DROP COLUMN "cloudTagPattern"`,
        `ALTER TABLE "CloudResourceOwnerRule" DROP COLUMN "cloudTagPattern"`,
      ]),
    );
  });

  test("covers every column the models declare for what it adds", () => {
    const accountColumns: Dictionary<TableColumnMetadata> = getTableColumns(
      new CloudAccount(),
    );
    const resourceColumns: Dictionary<TableColumnMetadata> = getTableColumns(
      new CloudResource(),
    );

    for (const column of [
      "provider",
      "accountId",
      "providerAccountName",
      "resourceCount",
      "regionCount",
      "resourceSummary",
      "inventoryListedAt",
    ]) {
      expect(accountColumns[column]).toBeDefined();
    }

    for (const column of [
      "cloudTags",
      "cloudProperties",
      "cloudRelationships",
      "cloudEndpoints",
      "inventoriedAt",
      "cloudInventoryFingerprint",
    ]) {
      expect(resourceColumns[column]).toBeDefined();
    }
  });
});
