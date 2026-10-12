import AllModelTypes from "../../Models/DatabaseModels/Index";
import PacketCapture from "../../Models/DatabaseModels/PacketCapture";
import Probe from "../../Models/DatabaseModels/Probe";
import { AddPacketCapture1800800000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1800800000000-AddPacketCapture";
import SchemaMigrations from "../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AllServices from "../../Server/Services/Index";
import PacketCaptureService from "../../Server/Services/PacketCaptureService";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The two places packet captures are stored: the PacketCapture table, and
 * what each probe last reported about capturing (Probe.packetCaptureCapability).
 * What is pinned is what the rest of the feature leans on: the table is
 * registered, served and documented; its migration builds what the claim
 * and the lists read (and takes it all away again); and the probe's report
 * is written by the probe alone, read by the project, and readable through
 * a device's probe.
 */

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;

  await new AddPacketCapture1800800000000()[direction](runner);

  return statements;
}

describe("the PacketCapture table", () => {
  const model: PacketCapture = new PacketCapture();

  test("is a model of its own, served at /packet-capture and documented", () => {
    expect(AllModelTypes).toContain(PacketCapture);
    expect(model.tableName).toBe("PacketCapture");
    expect(model.singularName).toBe("Packet Capture");
    expect(model.pluralName).toBe("Packet Captures");
    expect(model.getCrudApiPath()?.toString()).toBe("/packet-capture");
    expect(model.getTenantColumn()).toBe("projectId");
    expect(model.enableDocumentation).toBe(true);
  });

  test("its service is registered with the others", () => {
    expect(AllServices).toContain(PacketCaptureService);
  });

  test("starting and deleting a capture are audited; nothing is ever updated through the API", () => {
    expect(model.enableAuditLogOn).toMatchObject({
      create: true,
      update: false,
      delete: true,
    });
  });

  test("the pcap file is a relation to File that nobody may read, write or set", () => {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata("file")!;
    const access: ColumnAccessControl =
      model.getColumnAccessControlFor("file")!;

    expect(metadata.type).toBe(TableColumnType.Entity);
    expect(metadata.manyToOneRelationColumn).toBe("fileId");
    expect(metadata.hideColumnInDocumentation).toBe(true);
    expect(access).toEqual({ create: [], read: [], update: [] });
    expect(model.getColumnAccessControlFor("fileId")).toEqual({
      create: [],
      read: [],
      update: [],
    });
  });
});

describe("its migration", () => {
  test("is registered, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { new (): MigrationInterface }): string => {
        return new migration().name || migration.name;
      },
    );

    expect(names).toContain("AddPacketCapture1800800000000");

    const timestamps: Array<number> = names.map((name: string): number => {
      return Number(name.match(/(\d{13})$/)?.[1] || 0);
    });
    const own: number = names.indexOf("AddPacketCapture1800800000000");

    for (let index: number = 0; index < own; index++) {
      expect(timestamps[index]!).toBeLessThan(1800800000000);
    }
  });

  test("builds the table with what the claim and the lists read", async () => {
    const up: string = (await statementsOf("up")).join("\n");

    expect(up).toContain('CREATE TABLE "PacketCapture"');
    expect(up).toContain(
      "\"status\" character varying(100) NOT NULL DEFAULT 'Pending'",
    );
    expect(up).toContain('"bpfFilter" character varying(500)');
    expect(up).toContain('"statusMessage" character varying(500)');
    // The probe's claim: its Pending captures, oldest first.
    expect(up).toContain(
      'ON "PacketCapture" ("probeId", "status", "createdAt")',
    );
    // A probe's or a device's captures, newest first.
    expect(up).toContain('ON "PacketCapture" ("projectId", "createdAt")');
    expect(up).toContain(
      'ALTER TABLE "Probe" ADD "packetCaptureCapability" jsonb',
    );
  });

  test("a deleted project takes its captures; a deleted probe, device, file or person leaves them", async () => {
    const up: string = (await statementsOf("up")).join("\n");

    expect(up).toContain(
      'FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE',
    );

    for (const [column, table] of [
      ["probeId", "Probe"],
      ["networkDeviceId", "NetworkDevice"],
      ["fileId", "File"],
      ["createdByUserId", "User"],
      ["deletedByUserId", "User"],
    ]) {
      expect(up).toContain(
        `FOREIGN KEY ("${column}") REFERENCES "${table}"("_id") ON DELETE SET NULL`,
      );
    }
  });

  test("down takes everything up built away again, the table last", async () => {
    const down: Array<string> = await statementsOf("down");

    expect(down.join("\n")).toContain(
      'ALTER TABLE "Probe" DROP COLUMN "packetCaptureCapability"',
    );
    expect(down[down.length - 1]).toBe('DROP TABLE "PacketCapture"');
    expect(
      down.filter((sql: string): boolean => {
        return sql.includes("DROP CONSTRAINT");
      }),
    ).toHaveLength(6);
    expect(
      down.filter((sql: string): boolean => {
        return sql.startsWith("DROP INDEX");
      }),
    ).toHaveLength(6);
  });
});

describe("the probe's report", () => {
  const model: Probe = new Probe();
  const metadata: TableColumnMetadata = model.getTableColumnMetadata(
    "packetCaptureCapability",
  )!;
  const access: ColumnAccessControl = model.getColumnAccessControlFor(
    "packetCaptureCapability",
  )!;

  test("is JSON the probe writes, never a request", () => {
    expect(metadata.type).toBe(TableColumnType.JSON);
    expect(metadata.required).toBe(false);
    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
  });

  test("is read by the project, and through a device's probe", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProjectProbe,
    ]) {
      expect(access.read).toContain(permission);
    }

    expect(metadata.canReadOnRelationQuery).toBe(true);
  });
});
