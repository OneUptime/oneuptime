import WorkspaceProjectAuthToken, {
  LegacyServerOnlyMiscDataKeys,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import SelectPermission from "../../../Server/Types/Database/Permissions/SelectPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
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
 *
 * Nor may it change miscData. For Microsoft Teams that holds the Bot
 * Framework service URLs proactive sends go to, with the bot's token
 * attached, plus the tenant's consent state. The Slack channel cache, the
 * one part the dashboard edits, has its own route (PUT /slack/channel-cache).
 *
 * And miscData, which every role down to Viewer can read, must not carry a
 * credential: the Teams Graph app token lives only in the server-only
 * authToken / authTokenExpiresAt columns.
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

function selectError(
  permissions: Array<Permission>,
  select: Record<string, boolean>,
): Error | null {
  try {
    SelectPermission.checkSelectPermission(
      WorkspaceProjectAuthToken,
      select as any,
      propsWith(permissions),
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

  test("members can still read the connection", () => {
    expect(check([Permission.Viewer], DatabaseRequestType.Read)).toBeNull();
    expect(columnAccess("miscData").read).toContain(Permission.Viewer);
  });

  test("no project role can change miscData through the CRUD API", () => {
    expect(columnAccess("miscData").update).toEqual([]);

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ]) {
      const update: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      update.miscData = {
        installedTeams: {
          "team-1": {
            id: "team-1",
            serviceUrl: "https://attacker.example.com/",
          },
        },
      };

      let error: Error | null = null;

      try {
        ColumnPermissions.checkDataColumnPermissions(
          WorkspaceProjectAuthToken,
          update,
          propsWith([permission]),
          DatabaseRequestType.Update,
        );
      } catch (err) {
        error = err as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.message).toContain("miscData");
    }
  });

  /*
   * For Microsoft Teams `authToken` is a live Microsoft Graph app token for
   * the customer's tenant. It used to be copied into miscData as well, which
   * every Viewer can read, so any Viewer could lift it with
   * GET /workspace-project-auth-token selecting miscData.
   */
  test("no project role can read or write the token's expiry", () => {
    expect(columnAccess("authTokenExpiresAt").read).toEqual([]);
    expect(columnAccess("authTokenExpiresAt").create).toEqual([]);
    expect(columnAccess("authTokenExpiresAt").update).toEqual([]);
  });

  test("no project role can select the token columns", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]) {
      for (const column of ["authToken", "authTokenExpiresAt"]) {
        const error: Error | null = selectError([permission], {
          [column]: true,
        });

        expect(error).toBeInstanceOf(NotAuthorizedException);
      }
    }
  });

  test("a Viewer can still select miscData, which the dashboard reads", () => {
    expect(
      selectError([Permission.Viewer], {
        miscData: true,
        workspaceType: true,
        workspaceProjectId: true,
      }),
    ).toBeNull();
  });

  test("the keys that used to carry the Graph app token are stripped from miscData", () => {
    expect(LegacyServerOnlyMiscDataKeys).toEqual(
      expect.arrayContaining(["appAccessToken", "appAccessTokenExpiresAt"]),
    );
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
