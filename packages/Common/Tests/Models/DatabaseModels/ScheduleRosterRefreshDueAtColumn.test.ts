import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * WHEN A CHANGE TO A SCHEDULE'S LAYERS MADE THROUGH THE API IS TOLD (issue
 * #7813).
 *
 * OnCallDutyPolicySchedule.rosterRefreshDueAt is OneUptime's own
 * bookkeeping: a write of the schedule's layers made through the API holds
 * the schedule's change until then, and the Workers let it go once they
 * have told it (ScheduleLayerChanges). Nobody else may write it - a caller
 * who could would hold a schedule's messages, or let them go, behind the
 * hooks' back - or read it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0d781300-0000-4000-8000-0000000000aa",
);

// An admin of the project's on-call: may create and change schedules.
function onCallAdminProps(): DatabaseCommonInteractionProps {
  const permission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: permission },
  };
}

describe("OnCallDutyPolicySchedule.rosterRefreshDueAt", () => {
  const model: BaseModel = new OnCallDutyPolicySchedule();

  it("is an optional time, internal to OneUptime and left out of the docs", () => {
    const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
      model.getTableColumnMetadata("rosterRefreshDueAt");

    expect(metadata.type).toBe(TableColumnType.Date);
    expect(metadata.required).toBe(false);
    expect(metadata.computed).toBe(true);
    expect(metadata.hideColumnInDocumentation).toBe(true);
    expect(metadata.isDefaultValueColumn).toBeFalsy();
    expect(metadata.title).toBe("Roster Refresh Due At");
    expect(metadata.description).toMatch(/^Internal: /);
  });

  it("is a nullable timestamp with time zone, with no default: added without rewriting the table", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === OnCallDutyPolicySchedule &&
            candidate.propertyName === "rosterRefreshDueAt"
          );
        },
      );

    expect(column?.options.type).toBe(ColumnType.Date);
    expect(column?.options.nullable).toBe(true);
    expect(column?.options.default).toBeUndefined();
  });

  it("no API caller may set it, change it or read it", () => {
    const access: ColumnAccessControl | null =
      model.getColumnAccessControlFor("rosterRefreshDueAt");

    expect(access).toBeTruthy();
    expect(access!.create).toEqual([]);
    expect(access!.read).toEqual([]);
    expect(access!.update).toEqual([]);
  });

  it("refuses even a project owner's update that writes it", () => {
    const record: BaseModel = new OnCallDutyPolicySchedule();
    record.setColumnValue("rosterRefreshDueAt", new Date());

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        OnCallDutyPolicySchedule,
        record,
        onCallAdminProps(),
        DatabaseRequestType.Update,
      );
    }).toThrow(/rosterRefreshDueAt|Roster Refresh Due At/);
  });

  it("refuses a create that sends it", () => {
    const record: BaseModel = new OnCallDutyPolicySchedule();
    record.setColumnValue("rosterRefreshDueAt", new Date());

    expect(() => {
      ColumnPermissions.checkComputedColumnsSentOnCreate(
        OnCallDutyPolicySchedule,
        record,
        onCallAdminProps(),
      );
    }).toThrow(/rosterRefreshDueAt/);
  });

  /*
   * Only the schedules whose change waits are in its index - a handful, for
   * half a minute each - and the Workers' read of what is due
   * (rosterRefreshDueAt <= now) implies its predicate.
   */
  it("is indexed only where a change waits", () => {
    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === OnCallDutyPolicySchedule &&
            JSON.stringify(index.columns) ===
              JSON.stringify(["rosterRefreshDueAt"])
          );
        },
      );

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.where).toBe('"rosterRefreshDueAt" IS NOT NULL');
  });
});
