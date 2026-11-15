import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
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
 * WHEN THE OWNERS' CREATED NOTIFICATION OF AN INCIDENT OR ALERT STARTED
 * WAITING FOR ITS OWNERS (issue #7571).
 *
 * Incident / Alert.createdNotificationHeldAt is OneUptime's own bookkeeping:
 * the create's hook writes it as the record is written, the release and the
 * Created job clear it (CreatedNotificationHold). Nobody else may write it -
 * a caller who could would start or end the hold behind the hook's back -
 * or read it. The hook writes it on every create, a dashboard user's
 * included, so writing it there must never refuse the create.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "75710000-0000-4000-8000-000000000001",
);

// A member of the project who may create and change incidents and alerts.
function memberProps(): DatabaseCommonInteractionProps {
  const permission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
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

function accessOf(model: BaseModel, column: string): ColumnAccessControl {
  const access: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  expect(access).toBeTruthy();
  return access!;
}

describe.each([
  ["Incident", Incident as { new (): BaseModel }, "Incident Created"],
  ["Alert", Alert as { new (): BaseModel }, "Alert Created"],
])(
  "%s.createdNotificationHeldAt",
  (_name: string, modelType: { new (): BaseModel }, notification: string) => {
    const model: BaseModel = new modelType();

    it("is an optional time, internal to OneUptime and left out of the docs", () => {
      const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
        model.getTableColumnMetadata("createdNotificationHeldAt");

      expect(metadata.type).toBe(TableColumnType.Date);
      expect(metadata.required).toBe(false);
      expect(metadata.computed).toBe(true);
      expect(metadata.hideColumnInDocumentation).toBe(true);
      expect(metadata.isDefaultValueColumn).toBeFalsy();
      expect(metadata.defaultValue).toBeUndefined();
      expect(metadata.title).toBe("Created Notification Held At");
      expect(metadata.description).toMatch(/^Internal: /);
      expect(metadata.description).toContain(
        `the owners' ${notification} notification`,
      );
    });

    it("is a nullable timestamp with time zone, with no default: added without rewriting the table", () => {
      const column: ColumnMetadataArgs | undefined =
        getMetadataArgsStorage().columns.find(
          (candidate: ColumnMetadataArgs): boolean => {
            return (
              candidate.target === modelType &&
              candidate.propertyName === "createdNotificationHeldAt"
            );
          },
        );

      expect(column?.options.type).toBe(ColumnType.Date);
      expect(column?.options.nullable).toBe(true);
      expect(column?.options.default).toBeUndefined();
    });

    it("no API caller may set it, change it or read it", () => {
      const access: ColumnAccessControl = accessOf(
        model,
        "createdNotificationHeldAt",
      );

      expect(access.create).toEqual([]);
      expect(access.read).toEqual([]);
      expect(access.update).toEqual([]);
    });

    /*
     * The hook writes it with the flag on every held create: the column
     * check, which runs on the record as the hooks left it, lets a member's
     * create through with it - as it does the flag.
     */
    it("does not refuse a member's create the hook wrote it on", () => {
      const record: BaseModel = new modelType();
      record.setColumnValue("createdNotificationHeldAt", new Date());

      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          modelType,
          record,
          memberProps(),
          DatabaseRequestType.Create,
        );
      }).not.toThrow();
    });

    it("refuses a member's update that writes it", () => {
      const record: BaseModel = new modelType();
      record.setColumnValue("createdNotificationHeldAt", new Date());

      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          modelType,
          record,
          memberProps(),
          DatabaseRequestType.Update,
        );
      }).toThrow(/createdNotificationHeldAt|Created Notification Held At/);
    });

    /*
     * Only the records held right now are in its index - a handful at any
     * moment - and the Created job's read of a hold nobody let go
     * (createdNotificationHeldAt <= then) implies its predicate.
     */
    it("is indexed only where a record is held, and not deleted", () => {
      const indexes: Array<IndexMetadataArgs> =
        getMetadataArgsStorage().indices.filter(
          (index: IndexMetadataArgs): boolean => {
            return (
              index.target === modelType &&
              JSON.stringify(index.columns) ===
                JSON.stringify(["createdNotificationHeldAt"])
            );
          },
        );

      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.where).toBe(
        '"createdNotificationHeldAt" IS NOT NULL AND "deletedAt" IS NULL',
      );
    });
  },
);
