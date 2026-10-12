import AllModelTypes from "../../Models/DatabaseModels/Index";
import PacketCapture from "../../Models/DatabaseModels/PacketCapture";
import Probe from "../../Models/DatabaseModels/Probe";
import { AddPacketCapture1800800000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1800800000000-AddPacketCapture";
import SchemaMigrations from "../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AllServices from "../../Server/Services/Index";
import PacketCaptureService from "../../Server/Services/PacketCaptureService";
import DatabaseRequestType from "../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import { PACKET_CAPTURE_START_PERMISSIONS } from "../../Types/PacketCapture/PacketCapturePermissions";
import PacketCaptureStatus from "../../Types/PacketCapture/PacketCaptureStatus";
import Permission from "../../Types/Permission";
import UserType from "../../Types/UserType";
import { DASHBOARD_START_COLUMNS } from "../Helpers/PacketCaptureStartBody";
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

/*
 * What a start may write, and what it may not. DatabaseService checks the
 * record as PacketCaptureService.onBeforeCreate leaves it against the
 * starter's create permission, so every column on it must be one each
 * starter may create - or be computed (a value the server decides, which
 * that check skips on create). The hook once stamped fileId null, and every
 * start was refused: "User is not allowed to create on fileId column of
 * Packet Capture".
 */
describe("what a start writes, held to who may start", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );

  function starter(permission: Permission): DatabaseCommonInteractionProps {
    return {
      userId: ObjectID.generate(),
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [
            {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            },
          ],
        },
      },
    };
  }

  // A capture as onBeforeCreate leaves it, before createdByUserId is stamped.
  function startedRecord(): PacketCapture {
    const capture: PacketCapture = new PacketCapture();
    capture.projectId = PROJECT_ID;
    capture.probeId = ObjectID.generate();
    capture.interfaceName = "ens18";
    capture.bpfFilter = "net 192.168.50.0/24 and tcp";
    capture.maxDurationInSeconds = 60;
    capture.maxPackets = 100000;
    capture.maxFileSizeInMB = 10;
    capture.name = "ens18: net 192.168.50.0/24 and tcp";
    capture.status = PacketCaptureStatus.Pending;
    return capture;
  }

  test("whoever may start a capture is who the model lets create one", () => {
    expect(model().createRecordPermissions).toEqual([
      ...PACKET_CAPTURE_START_PERMISSIONS,
    ]);
  });

  test.each([...PACKET_CAPTURE_START_PERMISSIONS])(
    "a starter holding %s may create every column the dashboard's start sends",
    (permission: Permission) => {
      const creatable: Array<string> =
        ColumnPermissions.getModelColumnsByPermissions(
          PacketCapture,
          ColumnPermissions.getColumnCheckRows(starter(permission)),
          DatabaseRequestType.Create,
        ).columns;

      for (const column of DASHBOARD_START_COLUMNS) {
        expect([column, creatable.includes(column)]).toEqual([column, true]);
      }
    },
  );

  test("what the server decides at the start - the name, the status - is computed, so no starter is asked for it", () => {
    for (const column of ["name", "status"]) {
      expect([
        column,
        Boolean(model().getTableColumnMetadata(column)!.computed),
      ]).toEqual([column, true]);
    }
  });

  test("what the probe writes later - the file and the run - nobody may create, so the start leaves it out", () => {
    for (const column of [
      "file",
      "fileId",
      "statusMessage",
      "endReason",
      "startedAt",
      "completedAt",
      "stopRequestedAt",
      "packetCount",
      "fileSizeInBytes",
    ]) {
      expect([column, model().getColumnAccessControlFor(column)!.create]).toEqual(
        [column, []],
      );
    }
  });

  test.each([...PACKET_CAPTURE_START_PERMISSIONS])(
    "the record a start leaves passes the create column check for a starter holding %s",
    (permission: Permission) => {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          PacketCapture,
          startedRecord(),
          starter(permission),
          DatabaseRequestType.Create,
        );
      }).not.toThrow();
    },
  );

  test.each([...PACKET_CAPTURE_START_PERMISSIONS])(
    "regression: with fileId stamped null it is refused, for a starter holding %s - the customer's message",
    (permission: Permission) => {
      const record: PacketCapture = startedRecord();
      (record as unknown as Record<string, unknown>)["fileId"] = null;

      let refusal: unknown = null;

      try {
        ColumnPermissions.checkDataColumnPermissions(
          PacketCapture,
          record,
          starter(permission),
          DatabaseRequestType.Create,
        );
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
      expect((refusal as ColumnWriteRefusedException).columnName).toBe(
        "fileId",
      );
      expect((refusal as Error).message).toContain(
        "User is not allowed to create on fileId column of Packet Capture",
      );
    },
  );
});

function model(): PacketCapture {
  return new PacketCapture();
}

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
