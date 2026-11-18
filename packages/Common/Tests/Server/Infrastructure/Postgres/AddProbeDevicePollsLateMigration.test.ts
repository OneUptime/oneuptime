import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProbeDevicePollsLate1809183760000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183760000-AddProbeDevicePollsLate";
import Probe from "../../../../Models/DatabaseModels/Probe";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind saying when a probe is behind on the network devices
 * it polls - polled later than their interval (#9499): the first and the
 * latest reading that found one of its devices waiting more than a minute
 * past its poll time, beside its monitors' two (#9488).
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): two
 * columns on Probe, no default, no index, no key, nothing backfilled. A
 * server of the release before ignores them; one of this release reads
 * null as on time. The migration has to be registered, named for its class
 * and ordered after every migration before it, or it never runs; the
 * schema drift check holds its statements to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809183760000";
const MIGRATION_BASE_NAME: string = "AddProbeDevicePollsLate";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The migration that added the monitors' two, registered before it.
const PREVIOUS_MIGRATION: string = "AddProbeChecksLate1809183650000";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddProbeDevicePollsLate1809183760000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddProbeDevicePollsLate1809183760000", () => {
  test("adds the two reading times of the device polls to Probe, both nullable", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "Probe" ADD "devicePollsLateSince" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "Probe" ADD "devicePollsLastLateAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("builds no index, adds no key or default, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "Probe" ADD /);
    }
  });

  test("down drops the columns up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "Probe" DROP COLUMN "devicePollsLastLateAt"`,
      `ALTER TABLE "Probe" DROP COLUMN "devicePollsLateSince"`,
    ]);
  });

  test("the model declares the columns it adds: dates nobody but OneUptime writes, read as the monitors' are", () => {
    const model: Probe = new Probe();

    for (const column of ["devicePollsLateSince", "devicePollsLastLateAt"]) {
      expect(model.getTableColumns().columns).toContain(column);
      expect(model.getTableColumnMetadata(column).type).toBe(
        TableColumnType.Date,
      );
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();
      expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
      expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
      // Whoever may read whether its monitors are behind may read this.
      expect(model.getColumnAccessControlFor(column)?.read).toEqual(
        model.getColumnAccessControlFor("checksLateSince")?.read,
      );
      expect(model.getTableColumnMetadata(column).canReadOnRelationQuery).toBe(
        true,
      );
    }
  });

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(new AddProbeDevicePollsLate1809183760000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...timestamps.filter((value: number): boolean => {
          return value <= 1809183650000;
        }),
      ),
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(PREVIOUS_MIGRATION),
    );
    expect(names.indexOf(PREVIOUS_MIGRATION)).toBeGreaterThan(-1);
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
