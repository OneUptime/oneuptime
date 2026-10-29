import { AddNetworkDevicesToIncidentsAndAlerts1808320000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808320000000-AddNetworkDevicesToIncidentsAndAlerts";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Alert from "../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import BaseService from "../../../../Server/Services/BaseService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import { getAffectedResourceRelations } from "../../../../Server/Utils/Database/AffectedResourceRelations";
import { ProjectScopedRelation } from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * Network devices as affected resources (issue #5341): an incident's and
 * an alert's routers, switches and firewalls, each in a join table of its
 * own. Both tables are new and empty, so their indexes and foreign keys are
 * built in the migration that makes them, and no table that exists changes.
 * Deleting an incident, an alert or a device takes its rows with it.
 */

const NEW_TABLES: ReadonlyArray<[string, string, string]> = [
  ["IncidentNetworkDevice", "Incident", "incidentId"],
  ["AlertNetworkDevice", "Alert", "alertId"],
];

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddNetworkDevicesToIncidentsAndAlerts1808320000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

describe("AddNetworkDevicesToIncidentsAndAlerts1808320000000", () => {
  test("is registered last, after the migration it was numbered to follow", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(names).toContain(
      "AddNetworkDevicesToIncidentsAndAlerts1808320000000",
    );
    expect(
      names.indexOf("AddSecurityWatchlists1808310000000"),
    ).toBe(
      names.indexOf("AddNetworkDevicesToIncidentsAndAlerts1808320000000") - 1,
    );
    expect(new AddNetworkDevicesToIncidentsAndAlerts1808320000000().name).toBe(
      "AddNetworkDevicesToIncidentsAndAlerts1808320000000",
    );
  });

  test.each(NEW_TABLES)(
    "creates %s, one row per %s and device, cascading both ways",
    async (table: string, owner: string, ownerColumn: string) => {
      const steps: Array<string> = await record("up");
      const create: string | undefined = steps.find((step: string): boolean => {
        return step.startsWith(`CREATE TABLE "${table}"`);
      });

      expect(create).toMatch(
        new RegExp(
          `^CREATE TABLE "${table}" \\("${ownerColumn}" uuid NOT NULL, "networkDeviceId" uuid NOT NULL, CONSTRAINT "PK_[a-f0-9]+" PRIMARY KEY \\("${ownerColumn}", "networkDeviceId"\\)\\)$`,
        ),
      );

      for (const column of [ownerColumn, "networkDeviceId"]) {
        expect(
          steps.some((step: string): boolean => {
            return new RegExp(
              `^CREATE INDEX "IDX_[a-f0-9]+" ON "${table}" \\("${column}"\\) $`,
            ).test(step);
          }),
        ).toBe(true);
      }

      for (const target of [owner, "NetworkDevice"]) {
        expect(
          steps.some((step: string): boolean => {
            return (
              step.startsWith(`ALTER TABLE "${table}" ADD CONSTRAINT`) &&
              step.includes(
                `REFERENCES "${target}"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
              )
            );
          }),
        ).toBe(true);
      }
    },
  );

  test("indexes and keys only the tables it creates", async () => {
    const steps: Array<string> = await record("up");
    const created: Array<string> = NEW_TABLES.map(
      ([table]: [string, string, string]): string => {
        return table;
      },
    );

    for (const step of steps) {
      const target: string | undefined = (step.match(
        /^(?:CREATE (?:UNIQUE )?INDEX "[^"]+" ON|ALTER TABLE|CREATE TABLE) "([^"]+)"/,
      ) || [])[1];

      expect(target && created.includes(target)).toBe(true);
    }
  });

  test("down takes back everything up added, keys before tables", async () => {
    const up: Array<string> = await record("up");
    const down: Array<string> = await record("down");

    for (const [table] of NEW_TABLES) {
      expect(down).toContain(`DROP TABLE "${table}"`);
    }

    // Every key and index up made is dropped again.
    for (const step of up) {
      const name: string | undefined = (step.match(
        /(?:ADD CONSTRAINT|CREATE INDEX) "((?:FK|IDX)_[a-f0-9]+)"/,
      ) || [])[1];

      if (name) {
        expect(
          down.some((drop: string): boolean => {
            return drop.includes(`"${name}"`);
          }),
        ).toBe(true);
      }
    }

    const lastKey: number = Math.max(
      ...down.map((step: string, index: number): number => {
        return step.includes("DROP CONSTRAINT") ? index : -1;
      }),
    );
    const firstTable: number = down.findIndex((step: string): boolean => {
      return step.startsWith("DROP TABLE");
    });

    expect(lastKey).toBeLessThan(firstTable);
  });
});

describe("the lists the migration holds", () => {
  test.each([
    ["Incident", "IncidentNetworkDevice", "incidentId", new Incident()],
    ["Alert", "AlertNetworkDevice", "alertId", new Alert()],
  ] as Array<[string, string, string, BaseModel]>)(
    "%s.networkDevices is a list of network devices, joined through %s",
    (model: string, table: string, ownerColumn: string, record: BaseModel) => {
      const metadata: TableColumnMetadata =
        record.getTableColumnMetadata("networkDevices");

      expect(metadata.type).toBe(TableColumnType.EntityArray);
      expect(metadata.modelType).toBe(NetworkDevice);
      expect(metadata.title).toBe("Network Devices");
      expect(metadata.required).toBeFalsy();

      const joinTable: JoinTableMetadataArgs | undefined =
        getMetadataArgsStorage().joinTables.find(
          (candidate: JoinTableMetadataArgs): boolean => {
            return (
              (candidate.target as { name?: string }).name === model &&
              candidate.propertyName === "networkDevices"
            );
          },
        );

      expect(joinTable?.name).toBe(table);
      expect(
        (joinTable?.joinColumns as Array<{ name?: string }> | undefined)?.[0]
          ?.name,
      ).toBe(ownerColumn);
      expect(
        (
          joinTable?.inverseJoinColumns as Array<{ name?: string }> | undefined
        )?.[0]?.name,
      ).toBe("networkDeviceId");
    },
  );

  test.each([
    ["Incident", new Incident()],
    ["Alert", new Alert()],
  ] as Array<[string, BaseModel]>)(
    "%s's devices are read, linked and changed by whoever may do so for its hosts",
    (_model: string, record: BaseModel) => {
      const devices: ColumnAccessControl | null =
        record.getColumnAccessControlFor("networkDevices");
      const hosts: ColumnAccessControl | null =
        record.getColumnAccessControlFor("hosts");

      expect(devices).not.toBeNull();
      expect(devices).toEqual(hosts);
    },
  );

  test("the list comes right after the hosts, as the card shows it", () => {
    for (const record of [new Incident(), new Alert()]) {
      const columns: Array<string> = record.getTableColumns().columns;

      expect(columns.indexOf("networkDevices")).toBe(
        columns.indexOf("hosts") + 1,
      );
    }
  });
});

describe("a device linked to a record is one of the record's own project", () => {
  test.each([
    ["Incident", new Incident()],
    ["Alert", new Alert()],
  ] as Array<[string, BaseModel]>)(
    "a %s's devices are checked against its project, as its hosts are",
    (_model: string, record: BaseModel) => {
      const relations: Array<ProjectScopedRelation> =
        getAffectedResourceRelations(record).filter(
          (relation: ProjectScopedRelation): boolean => {
            return relation.column === "networkDevices";
          },
        );

      expect(relations).toHaveLength(1);
      expect(relations[0]!.modelName).toBe("Network Device");
      expect(relations[0]!.service as unknown as BaseService).toBe(
        NetworkDeviceService as unknown as BaseService,
      );
    },
  );

  test("a maintenance event has no list of devices, so none is checked", () => {
    expect(
      getAffectedResourceRelations(new ScheduledMaintenance()).map(
        (relation: ProjectScopedRelation): string => {
          return relation.column;
        },
      ),
    ).not.toContain("networkDevices");
  });
});
