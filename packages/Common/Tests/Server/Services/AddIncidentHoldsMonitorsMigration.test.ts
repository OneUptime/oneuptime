import { AddIncidentHoldsMonitors1798900000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1798900000000-AddIncidentHoldsMonitors";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Incident from "../../../Models/DatabaseModels/Incident";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind Incident.holdsMonitors: whether an incident holds its
 * monitors - keeps them in its monitor status, or their monitoring paused -
 * so that resolving it gives back only what it holds.
 *
 *   1. up() adds exactly the one column, nullable with no default. NULL is a
 *      meaning: an incident from before the column, whose next resolve gives
 *      its monitors back as it always did. A default of true or false would
 *      decide that for every stored incident at once, and false would leave
 *      every open incident's monitors in its status after its resolve.
 *   2. down() removes exactly what up() added.
 *   3. It is registered, and named as its class, so it runs once on boot.
 *   4. The model carries the column the same way, written by OneUptime
 *      only: nobody can send it on a create or an update.
 *
 * Pure SQL-contract and metadata assertions against a fake QueryRunner. No
 * Postgres - the Postgres Schema Drift workflow compares the generated
 * schema with the model.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const MIGRATION_TIMESTAMP: string = "1798900000000";

const MIGRATION_NAME: string = `AddIncidentHoldsMonitors${MIGRATION_TIMESTAMP}`;

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

function makeQueryRunner(): MakeQueryRunnerResult {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements,
  };
}

describe(`${MIGRATION_NAME} - SQL contract`, () => {
  test("up() adds exactly the one column: a boolean, nullable, with no default", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddIncidentHoldsMonitors1798900000000().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "Incident" ADD "holdsMonitors" boolean`,
    ]);
    expect(statements[0]).not.toContain("NOT NULL");
    expect(statements[0]).not.toContain("DEFAULT");
  });

  test("nothing is backfilled: no UPDATE of the incidents already stored", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddIncidentHoldsMonitors1798900000000().up(runner);

    for (const sql of statements) {
      expect(sql).not.toMatch(/\bUPDATE\b/i);
    }
  });

  test("down() drops exactly what up() added", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddIncidentHoldsMonitors1798900000000().down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "Incident" DROP COLUMN "holdsMonitors"`,
    ]);
  });
});

describe("registration", () => {
  const names: Array<string> = SchemaMigrations.map(
    (migration: new () => MigrationInterface): string => {
      return migration.name;
    },
  );

  test("the migration is registered so it runs on boot, exactly once", () => {
    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
  });

  test("it runs after every migration registered before it", () => {
    const timestamps: Array<number> = names.map((name: string): number => {
      return Number((name.match(/(\d{13})$/) || [])[1] || 0);
    });
    const index: number = names.indexOf(MIGRATION_NAME);

    for (let earlier: number = 0; earlier < index; earlier++) {
      expect(timestamps[earlier]!).toBeLessThan(Number(MIGRATION_TIMESTAMP));
    }
  });

  // TypeORM records applied migrations by `name`, not by file name.
  test("its declared name matches its class name", () => {
    expect(new AddIncidentHoldsMonitors1798900000000().name).toBe(
      MIGRATION_NAME,
    );
    expect(AddIncidentHoldsMonitors1798900000000.name).toBe(MIGRATION_NAME);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    expect(
      fs.readdirSync(MIGRATION_DIRECTORY).filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      }),
    ).toEqual([`${MIGRATION_TIMESTAMP}-AddIncidentHoldsMonitors.ts`]);
  });
});

describe("the Incident model carries the column the migration adds", () => {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return candidate.target === Incident;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === "holdsMonitors";
    });

  test("a nullable boolean with no default, matching the migration", () => {
    expect(args).toBeDefined();
    expect(args!.options.type).toBe(ColumnType.Boolean);
    expect(args!.options.nullable).toBe(true);
    expect(args!.options.default).toBeUndefined();
  });

  test("its TableColumn is an optional boolean OneUptime computes", () => {
    const metadata: TableColumnMetadata = new Incident().getTableColumnMetadata(
      "holdsMonitors",
    );

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.required).toBe(false);
    // Read-only in the API and Terraform: OneUptime writes it.
    expect(metadata.computed).toBe(true);
  });

  test("nobody may send it, on a create or an update; members may read it", () => {
    const access: {
      create: Array<unknown>;
      read: Array<unknown>;
      update: Array<unknown>;
    } = (
      new Incident().getColumnAccessControlForAllColumns() as unknown as Record<
        string,
        { create: Array<unknown>; read: Array<unknown>; update: Array<unknown> }
      >
    )["holdsMonitors"]!;

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect(access.read.length).toBeGreaterThan(0);
  });

  test("a fresh model has it unset", () => {
    const incident: Incident = new Incident();

    expect("holdsMonitors" in incident).toBe(true);
    expect(incident.holdsMonitors).toBeUndefined();
  });
});
