import { AddKeepMonitoringDuringIncidents1809187731141 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187731141-AddKeepMonitoringDuringIncidents";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
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
 * The migration behind Keep monitoring during incidents (issue #11141):
 * whether an incident declared by hand pauses a monitor's checks.
 *
 *   1. up() adds exactly the two columns, each NOT NULL with a constant
 *      default that keeps every stored monitor and incident as it was:
 *      Monitor.keepMonitoringDuringIncidents false (an incident declared by
 *      hand still pauses the monitor), Incident.pauseMonitoring true (every
 *      such incident still pauses its monitors). A constant default adds the
 *      column without rewriting a row.
 *   2. down() removes exactly what up() added.
 *   3. It is registered last, and named as its class, so it runs once.
 *   4. The models carry the columns the same way, and the people who edit a
 *      monitor or an incident may set them.
 *
 * Pure SQL-contract and metadata assertions against a fake QueryRunner.
 * The Postgres Schema Drift workflow compares the generated schema with the
 * models, and MonitorIncidentPausePostgres reads the defaults migrated.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const MIGRATION_TIMESTAMP: string = "1809187731141";

const MIGRATION_NAME: string = `AddKeepMonitoringDuringIncidents${MIGRATION_TIMESTAMP}`;

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

type ColumnAccess = {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
};

function accessOf(
  model: Monitor | Incident,
  column: string,
): ColumnAccess {
  return (
    model.getColumnAccessControlForAllColumns() as unknown as Record<
      string,
      ColumnAccess
    >
  )[column]!;
}

function columnArgs(
  target: typeof Monitor | typeof Incident,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return candidate.target === target;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === propertyName;
    });
}

describe(`${MIGRATION_NAME} - SQL contract`, () => {
  test("up() adds exactly the two columns, each with the default that keeps what is stored as it was", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddKeepMonitoringDuringIncidents1809187731141().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "Monitor" ADD "keepMonitoringDuringIncidents" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "Incident" ADD "pauseMonitoring" boolean NOT NULL DEFAULT true`,
    ]);
  });

  test("nothing is backfilled: no UPDATE of the monitors or incidents already stored", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddKeepMonitoringDuringIncidents1809187731141().up(runner);

    for (const sql of statements) {
      expect(sql).not.toMatch(/\bUPDATE\b/i);
    }
  });

  test("down() drops exactly what up() added, in reverse", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddKeepMonitoringDuringIncidents1809187731141().down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "Incident" DROP COLUMN "pauseMonitoring"`,
      `ALTER TABLE "Monitor" DROP COLUMN "keepMonitoringDuringIncidents"`,
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

  test("its declared name matches its class name", () => {
    expect(new AddKeepMonitoringDuringIncidents1809187731141().name).toBe(
      MIGRATION_NAME,
    );
    expect(AddKeepMonitoringDuringIncidents1809187731141.name).toBe(
      MIGRATION_NAME,
    );
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    expect(
      fs.readdirSync(MIGRATION_DIRECTORY).filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      }),
    ).toEqual([`${MIGRATION_TIMESTAMP}-AddKeepMonitoringDuringIncidents.ts`]);
  });
});

describe("Monitor.keepMonitoringDuringIncidents", () => {
  test("a NOT NULL boolean defaulting to false, matching the migration", () => {
    const args: ColumnMetadataArgs | undefined = columnArgs(
      Monitor,
      "keepMonitoringDuringIncidents",
    );

    expect(args).toBeDefined();
    expect(args!.options.type).toBe(ColumnType.Boolean);
    expect(args!.options.nullable).toBe(false);
    expect(args!.options.default).toBe(false);
  });

  test("its TableColumn is a required boolean defaulting to off", () => {
    const metadata: TableColumnMetadata =
      new Monitor().getTableColumnMetadata("keepMonitoringDuringIncidents");

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.required).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(false);
    expect(metadata.title).toBe("Keep Monitoring During Incidents");
  });

  test("whoever may edit a monitor may set it, and whoever may read one may read it", () => {
    const access: ColumnAccess = accessOf(
      new Monitor(),
      "keepMonitoringDuringIncidents",
    );

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ]) {
      expect(access.update).toContain(permission);
    }

    expect(access.create).toContain(Permission.CreateProjectMonitor);
    expect(access.read).toContain(Permission.Viewer);
    expect(access.read).toContain(Permission.ReadProjectMonitor);
    // A viewer reads it, never sets it.
    expect(access.update).not.toContain(Permission.Viewer);
    expect(access.update).not.toContain(Permission.MonitorViewer);
  });

  test("the pause flag it governs stays OneUptime's alone to write", () => {
    const access: ColumnAccess = accessOf(
      new Monitor(),
      "disableActiveMonitoringBecauseOfManualIncident",
    );

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
  });
});

describe("Incident.pauseMonitoring", () => {
  test("a NOT NULL boolean defaulting to true, matching the migration", () => {
    const args: ColumnMetadataArgs | undefined = columnArgs(
      Incident,
      "pauseMonitoring",
    );

    expect(args).toBeDefined();
    expect(args!.options.type).toBe(ColumnType.Boolean);
    expect(args!.options.nullable).toBe(false);
    expect(args!.options.default).toBe(true);
  });

  test("its TableColumn is a required boolean defaulting to on", () => {
    const metadata: TableColumnMetadata =
      new Incident().getTableColumnMetadata("pauseMonitoring");

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.required).toBe(true);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(true);
    expect(metadata.title).toBe("Pause Monitoring");
  });

  test("whoever may declare or edit an incident may set it, as they set its monitor status", () => {
    const access: ColumnAccess = accessOf(new Incident(), "pauseMonitoring");
    const monitorStatusAccess: ColumnAccess = accessOf(
      new Incident(),
      "changeMonitorStatusToId",
    );

    expect([...access.create].sort()).toEqual(
      [...monitorStatusAccess.create].sort(),
    );
    expect([...access.update].sort()).toEqual(
      [...monitorStatusAccess.update].sort(),
    );
    expect([...access.read].sort()).toEqual(
      [...monitorStatusAccess.read].sort(),
    );
  });
});
