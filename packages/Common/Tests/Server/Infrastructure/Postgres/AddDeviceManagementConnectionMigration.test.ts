import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDeviceManagementConnection1809185400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185400000-AddDeviceManagementConnection";

/*
 * The migration that creates the device management tables (issue #9586):
 * the connections (an Esper tenant), the devices they import and the apps
 * installed on them.
 *
 * The SQL is generated, and the schema-drift job already proves it matches
 * the models, so this does not re-check TypeORM's spelling. It pins the
 * decisions a regeneration could silently reverse, each of which no
 * functional test would notice:
 *
 *  1. ONE ROW PER DEVICE PER CONNECTION. (connectionId, providerDeviceId) is
 *     UNIQUE: two reads racing, or one read retried, must never import a
 *     device twice.
 *  2. ONE ROW PER APP PER DEVICE. (managedDeviceId, packageName) is UNIQUE.
 *  3. A DEVICE GOES WITH ITS CONNECTION, AND ITS APPS WITH THE DEVICE: the
 *     keys CASCADE, as do the projectId keys.
 *  4. DELETING A HOST NEVER DELETES A DEVICE. ManagedDevice.inventoryItemId
 *     is SET NULL: a person deleting the device's Inventory item clears the
 *     link, and the next read makes or finds the host again. A CASCADE here
 *     would delete what Esper still lists.
 *  5. THE KEY IS TEXT, NOT NULL: the encrypted credentials.
 *  6. All three tables are new, so their indexes and keys are made on empty
 *     tables, in the same transaction, with no online DDL.
 */

const MIGRATION_FILE: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185400000-AddDeviceManagementConnection.ts",
);

const SOURCE: string = fs.readFileSync(MIGRATION_FILE, "utf8");

// A migration class's timestamp, at the end of its name.
const TIMESTAMP: RegExp = /(\d{13})$/;

function bodyOf(method: "up" | "down"): string {
  const start: number = SOURCE.indexOf(`public async ${method}(`);

  expect(start).toBeGreaterThan(-1);

  const end: number =
    method === "up" ? SOURCE.indexOf("public async down(") : SOURCE.length;

  return SOURCE.slice(start, end);
}

function statementsIn(body: string): Array<string> {
  return [...body.matchAll(/`([^`]+)`/g)].map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const UP: Array<string> = statementsIn(bodyOf("up"));
const DOWN: Array<string> = statementsIn(bodyOf("down"));

function statement(predicate: (text: string) => boolean): string {
  const found: string | undefined = UP.find(predicate);
  expect(found).toBeDefined();
  return found as string;
}

describe("AddDeviceManagementConnection1809185400000", () => {
  test("is registered, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { new (): MigrationInterface }): string => {
        return migration.name;
      },
    );
    const index: number = names.indexOf(
      "AddDeviceManagementConnection1809185400000",
    );

    expect(index).toBeGreaterThan(-1);
    expect(new AddDeviceManagementConnection1809185400000().name).toBe(
      "AddDeviceManagementConnection1809185400000",
    );

    for (const earlier of names.slice(0, index)) {
      const timestamp: number = Number(TIMESTAMP.exec(earlier)?.[1] || 0);
      expect(timestamp).toBeLessThan(1809185400000);
    }
  });

  test("creates the three tables, and drops them in down()", () => {
    for (const table of [
      "DeviceManagementConnection",
      "ManagedDevice",
      "ManagedDeviceApp",
    ]) {
      statement((text: string): boolean => {
        return text.startsWith(`CREATE TABLE "${table}"`);
      });
      expect(DOWN).toContain(`DROP TABLE "${table}"`);
    }

    // The apps go first, then the devices, then the connections.
    expect(DOWN.indexOf(`DROP TABLE "ManagedDeviceApp"`)).toBeLessThan(
      DOWN.indexOf(`DROP TABLE "ManagedDevice"`),
    );
    expect(DOWN.indexOf(`DROP TABLE "ManagedDevice"`)).toBeLessThan(
      DOWN.indexOf(`DROP TABLE "DeviceManagementConnection"`),
    );
  });

  test("one row per device per connection, and per app per device", () => {
    statement((text: string): boolean => {
      return (
        text.startsWith("CREATE UNIQUE INDEX") &&
        text.includes(`ON "ManagedDevice" ("connectionId", "providerDeviceId")`)
      );
    });
    statement((text: string): boolean => {
      return (
        text.startsWith("CREATE UNIQUE INDEX") &&
        text.includes(
          `ON "ManagedDeviceApp" ("managedDeviceId", "packageName")`,
        )
      );
    });
  });

  test("a device goes with its connection, and its apps with the device", () => {
    statement((text: string): boolean => {
      return (
        text.startsWith(`ALTER TABLE "ManagedDevice"`) &&
        text.includes(
          `FOREIGN KEY ("connectionId") REFERENCES "DeviceManagementConnection"("_id") ON DELETE CASCADE`,
        )
      );
    });
    statement((text: string): boolean => {
      return (
        text.startsWith(`ALTER TABLE "ManagedDeviceApp"`) &&
        text.includes(
          `FOREIGN KEY ("managedDeviceId") REFERENCES "ManagedDevice"("_id") ON DELETE CASCADE`,
        )
      );
    });

    for (const table of [
      "DeviceManagementConnection",
      "ManagedDevice",
      "ManagedDeviceApp",
    ]) {
      statement((text: string): boolean => {
        return (
          text.startsWith(`ALTER TABLE "${table}"`) &&
          text.includes(
            `FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE`,
          )
        );
      });
    }
  });

  test("deleting a host never deletes a device: the link is cleared", () => {
    statement((text: string): boolean => {
      return (
        text.startsWith(`ALTER TABLE "ManagedDevice"`) &&
        text.includes(
          `FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("_id") ON DELETE SET NULL`,
        )
      );
    });
  });

  test("the key is text, not null; the read state and results are JSON", () => {
    const connection: string = statement((text: string): boolean => {
      return text.startsWith(`CREATE TABLE "DeviceManagementConnection"`);
    });

    expect(connection).toContain(`"secrets" text NOT NULL`);
    expect(connection).toContain(`"pullState" jsonb`);
    expect(connection).toContain(`"lastPullResult" jsonb`);
    expect(connection).toContain(`"isEnabled" boolean NOT NULL DEFAULT true`);
  });

  test("makes nothing on a table that already holds data", () => {
    for (const text of UP) {
      if (
        text.startsWith("CREATE INDEX") ||
        text.startsWith("CREATE UNIQUE INDEX")
      ) {
        expect(text).toMatch(
          /ON "(DeviceManagementConnection|ManagedDevice|ManagedDeviceApp)"/,
        );
      }

      if (text.startsWith("ALTER TABLE")) {
        expect(text).toMatch(
          /^ALTER TABLE "(DeviceManagementConnection|ManagedDevice|ManagedDeviceApp)"/,
        );
      }
    }
  });
});
