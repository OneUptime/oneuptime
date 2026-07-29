import { describe, expect, test } from "@jest/globals";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";

/*
 * Tests for CommonAPI.getUserTenantPermissions.
 *
 * userTenantAccessPermission is a Dictionary<UserTenantAccessPermission>
 * keyed by PROJECT ID, and each entry holds UserPermission rows (objects),
 * not bare Permission values. Several custom endpoints used to index the
 * dictionary with the literal key "permissions" and `as`-cast the result to
 * Array<Permission> - the cast hid the mistake from the type checker, the
 * lookup always produced undefined, and every non-master-admin caller was
 * rejected. These tests pin the corrected resolution.
 */

function buildUserPermission(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
  };
}

function buildTenantPermission(
  projectId: ObjectID,
  permissions: Array<Permission>,
): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions.map(buildUserPermission),
  };
}

function buildProps(overrides?: {
  tenantId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
  userTenantAccessPermission?:
    | Dictionary<UserTenantAccessPermission>
    | undefined;
}): DatabaseCommonInteractionProps {
  return {
    tenantId: overrides?.tenantId,
    userId: overrides?.userId,
    userTenantAccessPermission: overrides?.userTenantAccessPermission,
  };
}

describe("CommonAPI.getUserTenantPermissions", () => {
  describe("regression: permissions resolve for the current tenant", () => {
    test("a Project Owner's permission is returned (the old literal-key lookup returned nothing)", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [projectId.toString()]: buildTenantPermission(projectId, [
            Permission.ProjectOwner,
          ]),
        },
      });

      const permissions: Array<Permission> =
        CommonAPI.getUserTenantPermissions(props);

      expect(permissions).toEqual([Permission.ProjectOwner]);

      /*
       * The exact predicate the AI note/postmortem endpoints run. Before the
       * fix this was false for a Project Owner, so the endpoints rejected
       * everyone who was not a master admin.
       */
      const hasPermission: boolean = permissions.some((p: Permission) => {
        return p === Permission.ProjectOwner || p === Permission.ProjectAdmin;
      });
      expect(hasPermission).toBe(true);
    });

    test("the old broken lookup - indexing by the literal string 'permissions' - yields undefined", () => {
      const projectId: ObjectID = ObjectID.generate();
      const permissionMap: Dictionary<UserTenantAccessPermission> = {
        [projectId.toString()]: buildTenantPermission(projectId, [
          Permission.ProjectOwner,
        ]),
      };
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userId: ObjectID.generate(),
        userTenantAccessPermission: permissionMap,
      });

      /*
       * Pins the defect itself: "permissions" is not a project id, so it is
       * never a key of this dictionary. Kept as a guard against the pattern
       * being reintroduced by copy-paste.
       */
      expect(permissionMap["permissions"]).toBeUndefined();
      expect(CommonAPI.getUserTenantPermissions(props).length).toBe(1);
    });

    test("every permission row is mapped, in order", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [projectId.toString()]: buildTenantPermission(projectId, [
            Permission.ProjectMember,
            Permission.CreateIncidentInternalNote,
            Permission.EditProjectIncident,
          ]),
        },
      });

      expect(CommonAPI.getUserTenantPermissions(props)).toEqual([
        Permission.ProjectMember,
        Permission.CreateIncidentInternalNote,
        Permission.EditProjectIncident,
      ]);
    });

    test("label-scoped and block permission rows are still returned as permissions", () => {
      const projectId: ObjectID = ObjectID.generate();
      const labelScopedRow: UserPermission = {
        _type: "UserPermission",
        permission: Permission.EditProjectIncident,
        labelIds: [ObjectID.generate()],
        scope: PermissionScope.Labels,
      };
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [projectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: projectId,
            permissions: [labelScopedRow],
          },
        },
      });

      /*
       * getUserTenantPermissions is a plain projection of the rows - it does
       * not apply label filtering. Row-level access control still happens in
       * the database layer when the endpoint reads the resource.
       */
      expect(CommonAPI.getUserTenantPermissions(props)).toEqual([
        Permission.EditProjectIncident,
      ]);
    });

    test("lookup is by string value, not ObjectID instance identity", () => {
      const projectIdString: string = ObjectID.generate().toString();
      const tenantInstance: ObjectID = new ObjectID(projectIdString);
      const keyInstance: ObjectID = new ObjectID(projectIdString);
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: tenantInstance,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [keyInstance.toString()]: buildTenantPermission(keyInstance, [
            Permission.ProjectAdmin,
          ]),
        },
      });

      expect(tenantInstance).not.toBe(keyInstance);
      expect(CommonAPI.getUserTenantPermissions(props)).toEqual([
        Permission.ProjectAdmin,
      ]);
    });

    test("only the requested tenant's permissions are returned when the user belongs to several projects", () => {
      const projectA: ObjectID = ObjectID.generate();
      const projectB: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectB,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [projectA.toString()]: buildTenantPermission(projectA, [
            Permission.ProjectOwner,
          ]),
          [projectB.toString()]: buildTenantPermission(projectB, [
            Permission.ProjectMember,
          ]),
        },
      });

      const permissions: Array<Permission> =
        CommonAPI.getUserTenantPermissions(props);

      expect(permissions).toEqual([Permission.ProjectMember]);
      expect(permissions).not.toContain(Permission.ProjectOwner);
    });
  });

  describe("callers with nothing to resolve get an empty array", () => {
    test("returns [] when tenantId is undefined", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: undefined,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [projectId.toString()]: buildTenantPermission(projectId, [
            Permission.ProjectOwner,
          ]),
        },
      });

      expect(CommonAPI.getUserTenantPermissions(props)).toEqual([]);
    });

    test("returns [] when the permission map is undefined", () => {
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: ObjectID.generate(),
        userId: ObjectID.generate(),
        userTenantAccessPermission: undefined,
      });

      expect(CommonAPI.getUserTenantPermissions(props)).toEqual([]);
    });

    test("returns [] when the map is keyed by a different project", () => {
      const requestedProjectId: ObjectID = ObjectID.generate();
      const otherProjectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: requestedProjectId,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [otherProjectId.toString()]: buildTenantPermission(otherProjectId, [
            Permission.ProjectOwner,
          ]),
        },
      });

      expect(CommonAPI.getUserTenantPermissions(props)).toEqual([]);
    });

    test("returns [] for an empty permission map and for an entry with no rows", () => {
      const projectId: ObjectID = ObjectID.generate();

      expect(
        CommonAPI.getUserTenantPermissions(
          buildProps({
            tenantId: projectId,
            userTenantAccessPermission: {},
          }),
        ),
      ).toEqual([]);

      expect(
        CommonAPI.getUserTenantPermissions(
          buildProps({
            tenantId: projectId,
            userTenantAccessPermission: {
              [projectId.toString()]: buildTenantPermission(projectId, []),
            },
          }),
        ),
      ).toEqual([]);
    });

    test("returns [] for completely empty props", () => {
      expect(CommonAPI.getUserTenantPermissions({})).toEqual([]);
    });

    test("does not throw when a tenant entry is missing its permissions array", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = buildProps({
        tenantId: projectId,
        userId: ObjectID.generate(),
        userTenantAccessPermission: {
          [projectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: projectId,
          } as UserTenantAccessPermission,
        },
      });

      expect(() => {
        CommonAPI.getUserTenantPermissions(props);
      }).not.toThrow();
      expect(CommonAPI.getUserTenantPermissions(props)).toEqual([]);
    });
  });
});
