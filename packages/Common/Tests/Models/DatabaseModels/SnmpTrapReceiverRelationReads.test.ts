import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalProbeSnmpTrapReport from "../../../Models/DatabaseModels/GlobalProbeSnmpTrapReport";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Probe, { PROBE_READERS } from "../../../Models/DatabaseModels/Probe";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import Query from "../../../Server/Types/Database/Query";
import Select from "../../../Server/Types/Database/Select";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RelationReaders from "../../../Types/Database/RelationReaders";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SnmpTrapReceiverUtil, {
  SnmpTrapRefusalReason,
} from "../../../Types/Probe/SnmpTrapReceiver";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A RELATION MAY READ OF A PROBE'S SNMP TRAP RECEIVER (#11173, #11194,
 * #11172).
 *
 * A record names others, and a read of it may take some of their columns
 * along. Three things this receiver keeps must never travel that way:
 *
 *   - Probe.snmpTrapReceiver, the report a project's own probe keeps whole:
 *     the SNMPv3 traps it refused, by source address and user name. #11194
 *     held it to the probe's own readers through every relation (it was
 *     read through 15); that stays.
 *   - GlobalProbeSnmpTrapReport.refusals, a project's share of what a global
 *     probe refused: read by the project's own reads, by the probe's readers,
 *     and through no relation at all - and no model names the table, so no
 *     relation could reach it.
 *   - NetworkDevice.snmpEngineId, the engine ID a device's polls read: the
 *     device's own pages read it; a relation that reaches a device (an
 *     alert's, a monitor's) does not. Since #11405 a v1 or v2c poll reads
 *     it too, and it is held the same way.
 *
 * And, since #11406, the devices each refusal names (SnmpTrapRefusal
 * .deviceIds): kept only in the two columns above, so held as they are.
 */

const PROJECT: ObjectID = ObjectID.generate();

function as(permissions: Array<Permission>): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT,
    userTenantAccessPermission: {
      [PROJECT.toString()]: {
        projectId: PROJECT,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function relationSelect<TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  select: Select<TBaseModel>,
  props: DatabaseCommonInteractionProps,
): void {
  QueryPermission.checkRelationQueryPermission(
    modelType,
    {} as Query<TBaseModel>,
    select,
    props,
  );
}

interface Relation {
  model: string;
  column: string;
  relatedModelType: { new (): BaseModel };
}

// Every relation of every model, with the model it reaches.
function everyRelation(): Array<Relation> {
  const relations: Array<Relation> = [];

  for (const modelType of AllModelTypes) {
    const model: BaseModel = new modelType();

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      if (
        (metadata.type === TableColumnType.Entity ||
          metadata.type === TableColumnType.EntityArray) &&
        metadata.modelType
      ) {
        relations.push({
          model: model.tableName || modelType.name,
          column: column,
          relatedModelType: metadata.modelType as { new (): BaseModel },
        });
      }
    }
  }

  return relations;
}

const RELATIONS: Array<Relation> = everyRelation();

describe("a project's share of a global probe's refusals", () => {
  test("is read by the probe's readers, and written by nobody but OneUptime", () => {
    const share: GlobalProbeSnmpTrapReport = new GlobalProbeSnmpTrapReport();

    /*
     * No product's, as the probe is (TablesOfNoProduct): its readers are
     * exactly the probe's, as a project probe's own report's are.
     */
    expect([...share.getReadPermissions()].sort()).toEqual(
      [...PROBE_READERS].sort(),
    );
    expect(share.getCreatePermissions()).toEqual([]);
    expect(share.getUpdatePermissions()).toEqual([]);
    expect(share.getDeletePermissions()).toEqual([]);

    for (const column of ["refusals", "probeId", "projectId"]) {
      expect({
        column: column,
        read: [...(share.getColumnAccessControlFor(column)?.read || [])].sort(),
        create: share.getColumnAccessControlFor(column)?.create,
        update: share.getColumnAccessControlFor(column)?.update,
      }).toEqual({
        column: column,
        read: [...PROBE_READERS].sort(),
        create: [],
        update: [],
      });
    }
  });

  test("is a project's own: its tenant column is the project, so a project lists only its own rows", () => {
    expect(new GlobalProbeSnmpTrapReport().getTenantColumn()).toBe("projectId");
  });

  test("its refusals are read through no relation", () => {
    expect(
      new GlobalProbeSnmpTrapReport().getTableColumnMetadata("refusals")
        .canReadOnRelationQuery,
    ).toBe(false);
  });

  test("and no model names the table, so no relation could reach them", () => {
    expect(
      RELATIONS.filter((relation: Relation): boolean => {
        return relation.relatedModelType === GlobalProbeSnmpTrapReport;
      }).map((relation: Relation): string => {
        return `${relation.model}.${relation.column}`;
      }),
    ).toEqual([]);
    // The sweep reads relations at all.
    expect(RELATIONS.length).toBeGreaterThan(500);
  });

  test("its probe is read through it, held to the probe's own readers", () => {
    expect(() => {
      relationSelect(
        GlobalProbeSnmpTrapReport,
        {
          probe: { _id: true, snmpTrapReceiver: true },
        } as Select<GlobalProbeSnmpTrapReport>,
        as([Permission.ReadProjectProbe]),
      );
    }).not.toThrow();
  });
});

describe("a probe's own report (#11194, kept)", () => {
  test("is held to its own readers through every relation", () => {
    const metadata: TableColumnMetadata = new Probe().getTableColumnMetadata(
      "snmpTrapReceiver",
    );

    expect(metadata.canReadOnRelationQuery).toBe(true);
    expect(metadata.relationReaders).toBe(RelationReaders.ColumnReaders);
    expect(
      [
        ...(new Probe().getColumnAccessControlFor("snmpTrapReceiver")?.read ||
          []),
      ].sort(),
    ).toEqual([...PROBE_READERS].sort());
  });

  test("a device reader who is not a probe reader cannot select it through the device", () => {
    expect(() => {
      relationSelect(
        NetworkDevice,
        {
          probe: { _id: true, snmpTrapReceiver: true },
        } as Select<NetworkDevice>,
        as([Permission.ReadNetworkDevice]),
      );
    }).toThrow();
  });

  test("a probe reader can, as a device's Overview and Logs do", () => {
    expect(() => {
      relationSelect(
        NetworkDevice,
        {
          probe: { _id: true, snmpTrapReceiver: true },
        } as Select<NetworkDevice>,
        as([Permission.ProjectMember]),
      );
    }).not.toThrow();
  });
});

describe("the devices a refusal names (#11406)", () => {
  /*
   * Each refusal OneUptime keeps names the devices it came from
   * (SnmpTrapRefusal.deviceIds). They are kept only where the refusals
   * themselves are, and travel no further than the addresses and user
   * names beside them.
   */
  const MODELS_DIR: string = path.resolve(
    __dirname,
    "../../../Models/DatabaseModels",
  );

  // Every column of every model typed to keep refusals, as Model.column.
  function columnsKeepingRefusals(): Array<string> {
    const columns: Array<string> = [];

    for (const file of fs.readdirSync(MODELS_DIR)) {
      if (!file.endsWith(".ts")) {
        continue;
      }

      const source: string = fs.readFileSync(
        path.join(MODELS_DIR, file),
        "utf8",
      );
      const declaration: RegExp =
        /public\s+(\w+)\?\s*:\s*(?:SnmpTrapReceiverReport(?!\w)|Array<SnmpTrapRefusal>)/g;

      for (const match of source.matchAll(declaration)) {
        columns.push(`${file.replace(/\.ts$/, "")}.${match[1]}`);
      }
    }

    return columns.sort();
  }

  test("are kept in exactly two columns: a project probe's report, and a project's share of a global probe's", () => {
    expect(columnsKeepingRefusals()).toEqual([
      "GlobalProbeSnmpTrapReport.refusals",
      "Probe.snmpTrapReceiver",
    ]);
  });

  test("each is read by the probe's readers only, and written by nobody but OneUptime", () => {
    for (const [model, column] of [
      [new Probe(), "snmpTrapReceiver"],
      [new GlobalProbeSnmpTrapReport(), "refusals"],
    ] as Array<[BaseModel, string]>) {
      expect({
        column: column,
        read: [...(model.getColumnAccessControlFor(column)?.read || [])].sort(),
        create: model.getColumnAccessControlFor(column)?.create,
        update: model.getColumnAccessControlFor(column)?.update,
      }).toEqual({
        column: column,
        read: [...PROBE_READERS].sort(),
        create: [],
        update: [],
      });
    }
  });

  test("through a relation, a share is never read, and a probe's report only by the probe's readers", () => {
    expect(
      new GlobalProbeSnmpTrapReport().getTableColumnMetadata("refusals")
        .canReadOnRelationQuery,
    ).toBe(false);

    const report: TableColumnMetadata = new Probe().getTableColumnMetadata(
      "snmpTrapReceiver",
    );
    expect(report.relationReaders).toBe(RelationReaders.ColumnReaders);

    const reachingAProbe: Array<Relation> = RELATIONS.filter(
      (relation: Relation): boolean => {
        return relation.relatedModelType === Probe;
      },
    );

    // Alerts, incidents, monitors, devices, scans and the rest name probes.
    expect(reachingAProbe.length).toBeGreaterThan(5);

    // A device reader who is not a probe reader cannot read them through the device.
    expect(() => {
      relationSelect(
        NetworkDevice,
        {
          probe: { _id: true, snmpTrapReceiver: true },
        } as Select<NetworkDevice>,
        as([Permission.ReadNetworkDevice]),
      );
    }).toThrow();
  });

  test("a probe never sets them: what it posts is read with no devices, and a global probe's own row keeps no refusal", () => {
    const named: unknown = {
      isEnabled: true,
      refusals: [
        {
          sourceAddress: "10.20.0.5",
          reason: SnmpTrapRefusalReason.UnknownUser,
          userName: "san-monitor",
          count: 1,
          firstSeenAt: "2026-11-28T09:00:00.000Z",
          lastSeenAt: "2026-11-28T09:00:00.000Z",
          deviceIds: ["11406000-0000-4000-8000-000000000a01"],
        },
      ],
    };

    expect(
      JSON.stringify(SnmpTrapReceiverUtil.sanitizeReport(named)),
    ).not.toContain("deviceIds");
    expect(
      SnmpTrapReceiverUtil.toSharedReport(
        SnmpTrapReceiverUtil.parseReport(named)!,
      ).refusals,
    ).toEqual([]);
  });
});

describe("a device's SNMP engine ID", () => {
  test("is read by the device's readers and written by nobody but OneUptime", () => {
    const device: NetworkDevice = new NetworkDevice();

    expect(
      [
        ...(device.getColumnAccessControlFor("snmpEngineId")?.read || []),
      ].sort(),
    ).toEqual(
      [...(device.getColumnAccessControlFor("sysObjectId")?.read || [])].sort(),
    );
    expect(device.getColumnAccessControlFor("snmpEngineId")?.create).toEqual(
      [],
    );
    expect(device.getColumnAccessControlFor("snmpEngineId")?.update).toEqual(
      [],
    );
  });

  test("is read through no relation that reaches a device", () => {
    expect(
      new NetworkDevice().getTableColumnMetadata("snmpEngineId")
        .canReadOnRelationQuery,
    ).toBe(false);

    const reachingADevice: Array<Relation> = RELATIONS.filter(
      (relation: Relation): boolean => {
        return relation.relatedModelType === NetworkDevice;
      },
    );

    // Alerts, incidents, monitors, links, interfaces and the rest reach devices.
    expect(reachingADevice.length).toBeGreaterThan(5);

    for (const relation of reachingADevice) {
      const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
        (candidate: { new (): BaseModel }): boolean => {
          const model: BaseModel = new candidate();
          return (model.tableName || candidate.name) === relation.model;
        },
      );

      expect(() => {
        relationSelect(
          modelType!,
          {
            [relation.column]: { _id: true, snmpEngineId: true },
          } as Select<BaseModel>,
          as([Permission.ProjectOwner]),
        );
      }).toThrow();
    }
  });
});
