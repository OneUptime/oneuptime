import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";

describe("DatabaseCommonInteractionPropsUtil.getUserPermissions", () => {
  const makePerm: (
    permission: Permission,
    isBlockPermission: boolean,
  ) => UserPermission = (
    permission: Permission,
    isBlockPermission: boolean,
  ): UserPermission => {
    return {
      _type: "UserPermission",
      permission,
      labelIds: [],
      isBlockPermission,
    };
  };

  const permissionsOf: (result: Array<UserPermission>) => Array<Permission> = (
    result: Array<UserPermission>,
  ): Array<Permission> => {
    return result.map((p: UserPermission): Permission => {
      return p.permission;
    });
  };

  describe("global permissions", () => {
    test("always grants Public for an anonymous Allow request", () => {
      const props: DatabaseCommonInteractionProps = {};

      const perms: Array<Permission> = permissionsOf(
        DatabaseCommonInteractionPropsUtil.getUserPermissions(
          props,
          PermissionType.Allow,
        ),
      );

      expect(perms).toContain(Permission.Public);
    });

    test("adds CurrentUser when a user is logged in", () => {
      const props: DatabaseCommonInteractionProps = {
        userId: ObjectID.generate(),
      };

      const perms: Array<Permission> = permissionsOf(
        DatabaseCommonInteractionPropsUtil.getUserPermissions(
          props,
          PermissionType.Allow,
        ),
      );

      expect(perms).toContain(Permission.Public);
      expect(perms).toContain(Permission.CurrentUser);
    });

    test("preserves existing global permissions and appends Public", () => {
      const props: DatabaseCommonInteractionProps = {
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          projectIds: [],
          globalPermissions: [Permission.ProjectOwner],
        },
      };

      const perms: Array<Permission> = permissionsOf(
        DatabaseCommonInteractionPropsUtil.getUserPermissions(
          props,
          PermissionType.Allow,
        ),
      );

      expect(perms).toContain(Permission.ProjectOwner);
      expect(perms).toContain(Permission.Public);
    });

    test("does not include global permissions for a Block request", () => {
      const props: DatabaseCommonInteractionProps = {};

      expect(
        DatabaseCommonInteractionPropsUtil.getUserPermissions(
          props,
          PermissionType.Block,
        ),
      ).toEqual([]);
    });
  });

  describe("tenant permissions", () => {
    const buildTenantProps: () => {
      props: DatabaseCommonInteractionProps;
      tenantId: ObjectID;
    } = (): {
      props: DatabaseCommonInteractionProps;
      tenantId: ObjectID;
    } => {
      const tenantId: ObjectID = ObjectID.generate();
      const tenantPermission: UserTenantAccessPermission = {
        _type: "UserTenantAccessPermission",
        projectId: tenantId,
        permissions: [
          makePerm(Permission.ProjectMember, false), // allow row
          makePerm(Permission.ProjectOwner, true), // block row
        ],
      };

      return {
        tenantId,
        props: {
          tenantId,
          userTenantAccessPermission: {
            [tenantId.toString()]: tenantPermission,
          },
        },
      };
    };

    test("Allow includes the tenant's non-block permissions (plus global)", () => {
      const perms: Array<Permission> = permissionsOf(
        DatabaseCommonInteractionPropsUtil.getUserPermissions(
          buildTenantProps().props,
          PermissionType.Allow,
        ),
      );

      expect(perms).toContain(Permission.ProjectMember); // allow tenant row
      expect(perms).toContain(Permission.Public); // global
      expect(perms).not.toContain(Permission.ProjectOwner); // block row excluded
    });

    test("Block includes only the tenant's block permissions", () => {
      const perms: Array<Permission> = permissionsOf(
        DatabaseCommonInteractionPropsUtil.getUserPermissions(
          buildTenantProps().props,
          PermissionType.Block,
        ),
      );

      expect(perms).toContain(Permission.ProjectOwner); // block tenant row
      expect(perms).not.toContain(Permission.ProjectMember); // allow row excluded
      expect(perms).not.toContain(Permission.Public); // no global for Block
    });
  });
});
