import { AddMonitorStatusTimelinePausedBy1809188011433 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809188011433-AddMonitorStatusTimelinePausedBy";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import ColumnType from "../../../Types/Database/ColumnType";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import MonitorPausedBy from "../../../Types/Monitor/MonitorPausedBy";
import Permission from "../../../Types/Permission";
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
 * MonitorStatusTimeline.pausedBy (issue #11433): what paused a monitor's
 * checks for a status event whose time is left out of uptime, so that time
 * reads "paused", and why, apart from time with monitoring turned off. The
 * migration adds one nullable column with no default - no table rewrite on
 * the busiest timeline table, and every row from before reads as it did -
 * and the model holds it as OneUptime's to write, read as the column beside
 * it (isMonitoringOff) is read.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const MIGRATION_TIMESTAMP: string = "1809188011433";

const MIGRATION_NAME: string = `AddMonitorStatusTimelinePausedBy${MIGRATION_TIMESTAMP}`;

function makeQueryRunner(): { runner: QueryRunner; statements: Array<string> } {
  const statements: Array<string> = [];

  return {
    runner: {
      query: (...args: Array<unknown>): Promise<undefined> => {
        statements.push(String(args[0]));
        return Promise.resolve(undefined);
      },
    } as unknown as QueryRunner,
    statements: statements,
  };
}

type ColumnAccess = {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
};

function accessOf(column: string): ColumnAccess {
  return (
    new MonitorStatusTimeline().getColumnAccessControlForAllColumns() as unknown as Record<
      string,
      ColumnAccess
    >
  )[column]!;
}

function columnArgs(propertyName: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return candidate.target === MonitorStatusTimeline;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === propertyName;
    });
}

describe(`${MIGRATION_NAME} - SQL contract`, () => {
  test("up() adds the one nullable column, with no default and no backfill", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMonitorStatusTimelinePausedBy1809188011433().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "MonitorStatusTimeline" ADD "pausedBy" character varying(100)`,
    ]);

    for (const sql of statements) {
      expect(sql).not.toMatch(/\bUPDATE\b|\bDEFAULT\b|NOT NULL|INDEX/i);
    }
  });

  test("down() drops exactly it", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMonitorStatusTimelinePausedBy1809188011433().down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "MonitorStatusTimeline" DROP COLUMN "pausedBy"`,
    ]);
  });

  test("its name is its class's, and it is registered once", () => {
    expect(new AddMonitorStatusTimelinePausedBy1809188011433().name).toBe(
      MIGRATION_NAME,
    );

    const registered: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    expect(
      registered.filter((name: string): boolean => {
        return (
          name === `AddMonitorStatusTimelinePausedBy${MIGRATION_TIMESTAMP}`
        );
      }),
    ).toHaveLength(1);

    const migration: MigrationInterface | undefined = SchemaMigrations.find(
      (candidate: unknown): boolean => {
        return candidate === AddMonitorStatusTimelinePausedBy1809188011433;
      },
    ) as MigrationInterface | undefined;
    expect(migration).toBeDefined();

    // Numbered after every migration registered before it.
    const position: number = SchemaMigrations.indexOf(
      AddMonitorStatusTimelinePausedBy1809188011433 as never,
    );
    const timestampOf: (migration: unknown) => number = (
      migration: unknown,
    ): number => {
      return Number(
        /(\d{13})$/.exec((migration as { name: string }).name)?.[1] || "0",
      );
    };

    expect(position).toBeGreaterThan(0);
    expect(
      Math.max(...SchemaMigrations.slice(0, position).map(timestampOf)),
    ).toBeLessThan(Number(MIGRATION_TIMESTAMP));

    // And no other file in the folder takes its number.
    expect(
      fs
        .readdirSync(MIGRATION_DIRECTORY)
        .filter((file: string): boolean => {
          return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
        }),
    ).toEqual([`${MIGRATION_TIMESTAMP}-AddMonitorStatusTimelinePausedBy.ts`]);
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-AddMonitorStatusTimelinePausedBy.ts`,
        ),
      ),
    ).toBe(true);
  });
});

describe("MonitorStatusTimeline.pausedBy - the model", () => {
  test("the column the migration adds: short text, nullable, no default", () => {
    const column: ColumnMetadataArgs | undefined = columnArgs("pausedBy");

    expect(column?.options.type).toBe(ColumnType.ShortText);
    expect(column?.options.length).toBe(ColumnLength.ShortText);
    expect(column?.options.nullable).toBe(true);
    expect(column?.options.default).toBeUndefined();
  });

  test("OneUptime's to write, read by whoever reads isMonitoringOff, and its values said", () => {
    const metadata: TableColumnMetadata =
      new MonitorStatusTimeline().getTableColumnMetadata("pausedBy");

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.computed).toBe(true);
    expect(metadata.required).toBe(false);
    expect(metadata.allowedValues).toEqual(Object.values(MonitorPausedBy));

    expect(accessOf("pausedBy")).toEqual({
      create: [],
      read: accessOf("isMonitoringOff").read,
      update: [],
    });
  });
});
