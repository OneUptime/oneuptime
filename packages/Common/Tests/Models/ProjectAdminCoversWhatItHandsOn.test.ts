import AnalyticsModels from "../../Models/AnalyticsModels/Index";
import DatabaseModels from "../../Models/DatabaseModels/Index";
import Dictionary from "../../Types/Dictionary";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * PROJECT ADMIN HANDS ON ONLY WHAT IT ALREADY DOES.
 *
 * An admin nothing blocks may give a team member or an API key any
 * permission PermissionHelper.isCoveredByProjectAdmin covers - Members, a
 * viewer, a domain role - though they do not hold it themselves. That is
 * safe only while Project Admin opens everything such a permission opens,
 * so this sweeps every list of every model, the whole table and each
 * column: a list naming a covered permission names ProjectAdmin too.
 *
 * And the other way: each permission the rule leaves out by name is left
 * out because some list names it without ProjectAdmin. One that no list
 * does any more fails here, and can be covered.
 */

interface AccessControlledModel {
  tableName?: string | undefined;
  getCreatePermissions(): Array<Permission>;
  getReadPermissions(): Array<Permission>;
  getUpdatePermissions(): Array<Permission>;
  getDeletePermissions(): Array<Permission>;
  getColumnAccessControlForAllColumns(): Dictionary<ColumnAccessControl>;
}

type ModelType = { new (): AccessControlledModel; name: string };

const MODEL_TYPES: Array<ModelType> = [
  ...(DatabaseModels as unknown as Array<ModelType>),
  ...(AnalyticsModels as unknown as Array<ModelType>),
];

// Left out by name, not by being billing: see isCoveredByProjectAdmin.
const LEFT_OUT_BY_NAME: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.DeleteProject,
  Permission.EditProject,
  Permission.EditProjectTeam,
  Permission.InviteProjectTeamMembers,
];

// Every list of a model, named "<table> <operation>" or "<table> <column>.<operation>".
const listsOf: (modelType: ModelType) => Array<[string, Array<Permission>]> = (
  modelType: ModelType,
): Array<[string, Array<Permission>]> => {
  const model: AccessControlledModel = new modelType();
  const name: string = model.tableName || modelType.name;
  const lists: Array<[string, Array<Permission>]> = [
    [`${name} create`, model.getCreatePermissions()],
    [`${name} read`, model.getReadPermissions()],
    [`${name} update`, model.getUpdatePermissions()],
    [`${name} delete`, model.getDeletePermissions()],
  ];

  for (const [column, accessControl] of Object.entries(
    model.getColumnAccessControlForAllColumns(),
  )) {
    for (const operation of ["create", "read", "update"] as const) {
      lists.push([
        `${name} ${column}.${operation}`,
        accessControl?.[operation] || [],
      ]);
    }
  }

  return lists;
};

// "<list>: <permission>" for each permission a list names without ProjectAdmin.
const namedWithoutProjectAdmin: Array<string> = MODEL_TYPES.flatMap(
  (modelType: ModelType): Array<string> => {
    return listsOf(modelType).flatMap(
      ([list, permissions]: [string, Array<Permission>]): Array<string> => {
        if (permissions.includes(Permission.ProjectAdmin)) {
          return [];
        }

        return permissions.map((permission: Permission): string => {
          return `${list}: ${permission}`;
        });
      },
    );
  },
);

describe("What Project Admin hands on", () => {
  test("the sweep reaches the models and the rule its roles", () => {
    // A sweep over nothing would pass while covering nothing.
    expect(MODEL_TYPES.length).toBeGreaterThan(300);
    expect(namedWithoutProjectAdmin).toContain("Project delete: ProjectOwner");

    for (const permission of [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentMember,
      Permission.MonitorViewer,
      Permission.TelemetryViewer,
      Permission.ProjectAdmin,
    ]) {
      expect([
        permission,
        PermissionHelper.isCoveredByProjectAdmin(permission),
      ]).toEqual([permission, true]);
    }

    for (const permission of [
      ...LEFT_OUT_BY_NAME,
      Permission.ManageProjectBilling,
      Permission.BillingViewer,
      Permission.ReadInvoices,
      Permission.CustomerSupport,
      Permission.Public,
    ]) {
      expect([
        permission,
        PermissionHelper.isCoveredByProjectAdmin(permission),
      ]).toEqual([permission, false]);
    }
  });

  test("every list naming a permission Project Admin hands on names ProjectAdmin too", () => {
    const uncovered: Array<string> = namedWithoutProjectAdmin.filter(
      (line: string): boolean => {
        const permission: Permission = line.split(": ")[1] as Permission;
        return PermissionHelper.isCoveredByProjectAdmin(permission);
      },
    );

    expect(uncovered).toEqual([]);
  });

  test("each permission left out by name is named somewhere without ProjectAdmin", () => {
    for (const permission of LEFT_OUT_BY_NAME) {
      const lists: Array<string> = namedWithoutProjectAdmin.filter(
        (line: string): boolean => {
          return line.endsWith(`: ${permission}`);
        },
      );

      expect([permission, lists.length > 0]).toEqual([permission, true]);
    }
  });

  test("billing is left out as a whole", () => {
    const billing: Array<PermissionProps> =
      PermissionHelper.getAllPermissionProps().filter(
        (props: PermissionProps): boolean => {
          return props.group === "Billing";
        },
      );

    expect(billing.length).toBeGreaterThan(5);

    for (const props of billing) {
      expect([
        props.permission,
        PermissionHelper.isCoveredByProjectAdmin(props.permission),
      ]).toEqual([props.permission, false]);
    }
  });
});
