import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * WorkspaceProjectAuthToken is the binding every Slack and Microsoft Teams
 * path trusts: which workspace or tenant a project's bot token belongs to.
 * For Teams the server goes further and mints a fresh Graph app token for
 * whichever tenant `workspaceProjectId` names.
 *
 * So the binding may only be written by the connect flows, which prove the
 * workspace or tenant first (see WorkspaceOAuthState). The CRUD API must not
 * be a second way to create it or to change which workspace it names.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const userPermissions: Array<UserPermission> = permissions.map(
    (permission: Permission) => {
      return {
        _type: "UserPermission" as const,
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: userPermissions,
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function check(
  permissions: Array<Permission>,
  type: DatabaseRequestType,
): Error | null {
  try {
    TablePermission.checkTableLevelPermissions(
      WorkspaceProjectAuthToken,
      propsWith(permissions),
      type,
    );
  } catch (err) {
    return err as Error;
  }

  return null;
}

const columnAccess: (column: string) => ColumnAccessControl = (
  column: string,
): ColumnAccessControl => {
  const accessControl: ColumnAccessControl | null =
    new WorkspaceProjectAuthToken().getColumnAccessControlFor(column);

  expect(accessControl).not.toBeNull();
  return accessControl!;
};

describe("WorkspaceProjectAuthToken access control", () => {
  test("no project role can create the binding through the CRUD API", () => {
    expect(new WorkspaceProjectAuthToken().getCreatePermissions()).toEqual([]);

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ]) {
      const error: Error | null = check(
        [permission],
        DatabaseRequestType.Create,
      );

      expect(error).not.toBeNull();
      expect(error?.message).toContain("is not allowed");
    }
  });

  test("no project role can repoint the binding at another workspace or tenant", () => {
    expect(columnAccess("workspaceProjectId").update).toEqual([]);
  });

  test("no project role can replace the bot token", () => {
    expect(columnAccess("authToken").update).toEqual([]);
    expect(columnAccess("authToken").read).toEqual([]);
  });

  test("members can still read the connection and edit its cached settings", () => {
    expect(check([Permission.Viewer], DatabaseRequestType.Read)).toBeNull();

    // The Slack channel cache editor updates miscData through the CRUD API.
    expect(
      check([Permission.ProjectMember], DatabaseRequestType.Update),
    ).toBeNull();
    expect(columnAccess("miscData").update).toContain(Permission.ProjectMember);
  });

  test("owners and admins can still disconnect", () => {
    expect(
      check([Permission.ProjectAdmin], DatabaseRequestType.Delete),
    ).toBeNull();
    expect(
      check([Permission.ProjectOwner], DatabaseRequestType.Delete),
    ).toBeNull();
  });
});
