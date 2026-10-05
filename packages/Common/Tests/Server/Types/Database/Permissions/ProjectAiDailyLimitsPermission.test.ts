import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import Project from "../../../../../Models/DatabaseModels/Project";
import {
  PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
  PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
} from "../../../../../Types/AI/ProjectAiDailyLimits";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Who may set a project's own daily AI limits (Project Settings → AI
 * Features → More settings), asked of the server's own checks - the
 * record's update list (TablePermission), then the column's
 * (ColumnPermission), the two an update runs before it writes - for every
 * permission a team can grant, one at a time.
 *
 * The limits decide what AI may cost the project each day, so they take
 * what Enable AI takes: a project owner, or someone who manages billing.
 * A project admin may tune the incident and alert limits under them, but
 * not raise the project's ceiling over them. Everyone who reads the project
 * reads them.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

const LIMIT_COLUMNS: Array<string> = [
  PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
  PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
];

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
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

const GRANTABLE: Array<Permission> = PermissionHelper.getTenantPermissionProps()
  .map((props: PermissionProps) => {
    return props.permission;
  })
  .sort();

function mayUpdate(column: string, permissions: Array<Permission>): boolean {
  const props: DatabaseCommonInteractionProps = propsWith(permissions);
  const row: Project = new Project();
  (row as unknown as Record<string, unknown>)[column] = 25;

  try {
    TablePermission.checkTableLevelPermissions(
      Project,
      props,
      DatabaseRequestType.Update,
    );
    ColumnPermissions.checkDataColumnPermissions(
      Project,
      row,
      props,
      DatabaseRequestType.Update,
    );
  } catch {
    return false;
  }

  return true;
}

function mayRead(column: string, permissions: Array<Permission>): boolean {
  const props: DatabaseCommonInteractionProps = propsWith(permissions);

  try {
    TablePermission.checkTableLevelPermissions(
      Project,
      props,
      DatabaseRequestType.Read,
    );
    SelectPermission.checkSelectPermission(
      Project,
      { _id: true, [column]: true } as never,
      props,
    );
  } catch {
    return false;
  }

  return true;
}

function whoMayUpdate(column: string): Array<Permission> {
  return GRANTABLE.filter((permission: Permission) => {
    return mayUpdate(column, [permission]);
  });
}

describe.each(LIMIT_COLUMNS)("Project.%s", (column: string) => {
  test("a project owner or someone who manages billing may set it, and nobody else", () => {
    expect(whoMayUpdate(column)).toEqual(
      [Permission.ManageProjectBilling, Permission.ProjectOwner].sort(),
    );
  });

  test("takes exactly what Enable AI takes", () => {
    expect(whoMayUpdate(column)).toEqual(whoMayUpdate("enableAi"));
  });

  test.each([
    Permission.ProjectAdmin,
    Permission.EditProject,
    Permission.ProjectMember,
    Permission.Viewer,
  ])("%s alone may not set it", (permission: Permission) => {
    expect(mayUpdate(column, [permission])).toBe(false);
  });

  /*
   * A project admin tunes the incident and alert limits; the project's own
   * ceiling over them is not theirs to raise.
   */
  test("a project admin may set the incident limits under it, but not it", () => {
    expect(
      mayUpdate("incidentAiDailyAutonomousTokenLimit", [
        Permission.ProjectAdmin,
      ]),
    ).toBe(true);
    expect(mayUpdate(column, [Permission.ProjectAdmin])).toBe(false);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadProject,
  ])("%s may read it", (permission: Permission) => {
    expect(mayRead(column, [permission])).toBe(true);
  });

  test("a project is never created with it", () => {
    expect(new Project().getColumnAccessControlFor(column)?.create).toEqual([]);
  });
});
