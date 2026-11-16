import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddIncomingRequestSecretMonitorAccess1809181400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809181400000-AddIncomingRequestSecretMonitorAccess";
import { AddIncomingRequestSecretActivity1809179500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809179500000-AddIncomingRequestSecretActivity";
import IncomingRequestSecret from "../../../../Models/DatabaseModels/IncomingRequestSecret";
import { INCOMING_REQUEST_SECRET_DEFAULT_ACCESS } from "../../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess from "../../../../Types/Monitor/MonitorSecretAccess";

/*
 * The migration behind limiting an incoming request secret to some monitors
 * (issue #8501): its mode on "IncomingRequestSecret", and two join tables.
 *
 * The SQL is generated, and the schema-drift job proves it matches the
 * model. What this pins is what a regeneration could quietly reverse:
 *
 *  1. AN UPGRADE LIMITS NOTHING. Every secret that exists gets All Monitors,
 *     what every secret was before, so no sender is refused by the upgrade.
 *  2. NOTHING IS REWRITTEN OR HELD. The column's default is a constant, on a
 *     small table; the join tables are new, so their indexes and foreign
 *     keys are built on empty tables (SchemaMigrationsOnlineDdl).
 *  3. A DELETED MONITOR, LABEL OR SECRET TAKES ITS ROWS WITH IT.
 *  4. IT RUNS AFTER THE MIGRATIONS BEFORE IT, and its file and class agree.
 */

const MIGRATION_FILE_NAME: string =
  "1809181400000-AddIncomingRequestSecretMonitorAccess.ts";

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

// The SQL statements of a method, one per queryRunner.query call.
function statementsOf(body: string): Array<string> {
  return Array.from(body.matchAll(/`([^`]+)`/g)).map(
    (match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    },
  );
}

const UP: Array<string> = statementsOf(bodyOf("up"));
const DOWN: Array<string> = statementsOf(bodyOf("down"));

describe("AddIncomingRequestSecretMonitorAccess migration", () => {
  test("gives every secret that exists All Monitors, as the model's default", () => {
    expect(UP).toContain(
      `ALTER TABLE "IncomingRequestSecret" ADD "monitorAccess" character varying(100) NOT NULL DEFAULT 'All Monitors'`,
    );
    expect(INCOMING_REQUEST_SECRET_DEFAULT_ACCESS).toBe(
      MonitorSecretAccess.AllMonitors,
    );
    expect(
      new IncomingRequestSecret().getTableColumnMetadata("monitorAccess")
        .defaultValue,
    ).toBe("All Monitors");
  });

  test("creates the two join tables before anything is built on them", () => {
    const createMonitors: number = UP.findIndex((statement: string) => {
      return statement.startsWith(
        `CREATE TABLE "IncomingRequestSecretMonitor"`,
      );
    });
    const createLabels: number = UP.findIndex((statement: string) => {
      return statement.startsWith(`CREATE TABLE "IncomingRequestSecretLabel"`);
    });

    expect(createMonitors).toBeGreaterThan(-1);
    expect(createLabels).toBeGreaterThan(-1);

    UP.forEach((statement: string, index: number) => {
      if (statement.includes(`ON "IncomingRequestSecretMonitor"`)) {
        expect(index).toBeGreaterThan(createMonitors);
      }

      if (statement.includes(`ON "IncomingRequestSecretLabel"`)) {
        expect(index).toBeGreaterThan(createLabels);
      }
    });

    // No index is built on a table that holds rows.
    for (const statement of UP) {
      if (statement.startsWith("CREATE INDEX")) {
        expect(statement).toMatch(/ON "IncomingRequestSecret(Monitor|Label)" /);
      }
    }
  });

  test("a deleted secret, monitor or label takes its rows with it", () => {
    const foreignKeys: Array<string> = UP.filter((statement: string) => {
      return statement.includes("FOREIGN KEY");
    });

    expect(foreignKeys).toHaveLength(4);

    for (const target of [
      `REFERENCES "IncomingRequestSecret"("_id")`,
      `REFERENCES "Monitor"("_id")`,
      `REFERENCES "Label"("_id")`,
    ]) {
      expect(
        foreignKeys.some((statement: string) => {
          return statement.includes(target);
        }),
      ).toBe(true);
    }

    for (const statement of foreignKeys) {
      expect(statement).toContain("ON DELETE CASCADE");
    }
  });

  test("down takes away everything up added", () => {
    expect(DOWN).toContain(`DROP TABLE "IncomingRequestSecretMonitor"`);
    expect(DOWN).toContain(`DROP TABLE "IncomingRequestSecretLabel"`);
    expect(DOWN).toContain(
      `ALTER TABLE "IncomingRequestSecret" DROP COLUMN "monitorAccess"`,
    );
    expect(
      DOWN.filter((statement: string) => {
        return statement.includes("DROP CONSTRAINT");
      }),
    ).toHaveLength(4);
  });

  test("is registered once, after the incoming request secret migrations before it, under its own name", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { new (): MigrationInterface }) => {
        return migration.name;
      },
    );

    const index: number = names.indexOf(
      AddIncomingRequestSecretMonitorAccess1809181400000.name,
    );

    expect(index).toBeGreaterThan(
      names.indexOf(AddIncomingRequestSecretActivity1809179500000.name),
    );
    expect(
      names.filter((name: string): boolean => {
        return name === AddIncomingRequestSecretMonitorAccess1809181400000.name;
      }),
    ).toHaveLength(1);

    expect(new AddIncomingRequestSecretMonitorAccess1809181400000().name).toBe(
      "AddIncomingRequestSecretMonitorAccess1809181400000",
    );
    expect(MIGRATION_FILE_NAME.startsWith("1809181400000-")).toBe(true);
  });
});
