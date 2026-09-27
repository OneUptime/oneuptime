import AlertCustomField from "../../Models/DatabaseModels/AlertCustomField";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "../../Models/DatabaseModels/TeamMemberCustomField";
import DatabaseRequestType from "../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Server/Types/Database/Permissions/ColumnPermission";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserTenantAccessPermission } from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The incident custom field settings, in model metadata, where a later
 * well-meaning edit could change them without breaking a functional test:
 *
 *   - isRequiredOnCreate, showOnCreate and includeInSubscriberNotifications
 *     default to off, so existing fields keep behaving as they did - in
 *     particular, no field starts going out to external subscribers;
 *   - sortOrder is optional;
 *   - variableKey is the service's: computed, written by nobody through the
 *     API, readable by whoever reads the field, and unique per project;
 *   - the columns exist on IncidentCustomField only. The shared settings page
 *     and Custom Fields card offer them per model (hasColumn), and a select
 *     of a column a model does not have would fail for that resource.
 */

const model: IncidentCustomField = new IncidentCustomField();
const projectId: ObjectID = ObjectID.generate();

const SETTINGS_COLUMNS: Array<string> = [
  "isRequiredOnCreate",
  "sortOrder",
  "showOnCreate",
  "includeInSubscriberNotifications",
];

function accessControl(column: string): ColumnAccessControl {
  const control: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  expect(control).not.toBeNull();

  return control as ColumnAccessControl;
}

function metadata(column: string): TableColumnMetadata {
  return model.getTableColumnMetadata(column);
}

function props(permissions: Array<Permission>): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: ObjectID.generate(),
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

describe("IncidentCustomField create and notification settings", () => {
  test.each(SETTINGS_COLUMNS)(
    "%s has the access control of the field's other settings",
    (column: string) => {
      expect(accessControl(column)).toEqual(accessControl("dropdownOptions"));
    },
  );

  test.each([
    "isRequiredOnCreate",
    "showOnCreate",
    "includeInSubscriberNotifications",
  ])("%s is a boolean that starts off", (column: string) => {
    expect(metadata(column).type).toBe(TableColumnType.Boolean);
    expect(metadata(column).defaultValue).toBe(false);
    expect(metadata(column).isDefaultValueColumn).toBe(true);
  });

  test("sortOrder is an optional number", () => {
    expect(metadata("sortOrder").type).toBe(TableColumnType.Number);
    expect(metadata("sortOrder").required).toBeFalsy();
  });

  test("a project admin can create and edit the settings", () => {
    const admin: DatabaseCommonInteractionProps = props([
      Permission.ProjectAdmin,
    ]);
    const data: IncidentCustomField = new IncidentCustomField();
    data.name = "Impact";
    data.isRequiredOnCreate = true;
    data.sortOrder = 2;
    data.showOnCreate = true;
    data.includeInSubscriberNotifications = true;

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        IncidentCustomField,
        data,
        admin,
        DatabaseRequestType.Create,
      );
    }).not.toThrow();

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        IncidentCustomField,
        data,
        admin,
        DatabaseRequestType.Update,
      );
    }).not.toThrow();
  });

  test("an incident member can read but not change them", () => {
    const member: DatabaseCommonInteractionProps = props([
      Permission.IncidentMember,
    ]);
    const data: IncidentCustomField = new IncidentCustomField();
    data.includeInSubscriberNotifications = true;

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        IncidentCustomField,
        data,
        member,
        DatabaseRequestType.Update,
      );
    }).toThrow();

    for (const column of [...SETTINGS_COLUMNS, "variableKey"]) {
      expect(accessControl(column).read).toContain(Permission.IncidentMember);
    }
  });
});

describe("IncidentCustomField.variableKey", () => {
  test("is readable like the field's name, and written by nobody through the API", () => {
    expect(accessControl("variableKey")).toEqual({
      create: [],
      read: accessControl("name").read,
      update: [],
    });
  });

  test("is computed, so a create carrying one passes the column check (the service replaces it)", () => {
    expect(metadata("variableKey").computed).toBe(true);
    expect(metadata("variableKey").type).toBe(TableColumnType.ShortText);

    const data: IncidentCustomField = new IncidentCustomField();
    data.name = "Impact";
    data.variableKey = "impact";

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        IncidentCustomField,
        data,
        props([Permission.ProjectAdmin]),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test("is refused on update by the column check, behind the service dropping it", () => {
    const data: IncidentCustomField = new IncidentCustomField();
    data.variableKey = "hijacked";

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        IncidentCustomField,
        data,
        props([Permission.ProjectOwner]),
        DatabaseRequestType.Update,
      );
    }).toThrow();
  });

  test("is unique per project", () => {
    const indexes: Array<IndexMetadataArgs> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs) => {
        return index.target === IncidentCustomField;
      })
      .filter((index: IndexMetadataArgs) => {
        return (
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).includes("variableKey")
        );
      });

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.columns).toEqual(["projectId", "variableKey"]);
    expect(indexes[0]!.unique).toBe(true);
  });
});

describe("the other custom field definition tables", () => {
  const others: Array<{ new (): BaseModel }> = [
    AlertCustomField,
    MonitorCustomField,
    StatusPageCustomField,
    InventoryItemCustomField,
    ScheduledMaintenanceCustomField,
    OnCallDutyPolicyCustomField,
    TeamCustomField,
    TeamMemberCustomField,
  ];

  test.each(
    others.map((type: { new (): BaseModel }) => {
      return [type.name, type];
    }),
  )(
    "%s has none of the incident-only columns",
    (_name: string, type: unknown) => {
      const other: BaseModel = new (type as { new (): BaseModel })();

      for (const column of [...SETTINGS_COLUMNS, "variableKey"]) {
        expect(other.hasColumn(column)).toBe(false);
      }
    },
  );

  test("IncidentCustomField has all of them", () => {
    for (const column of [...SETTINGS_COLUMNS, "variableKey"]) {
      expect(model.hasColumn(column)).toBe(true);
    }
  });
});
