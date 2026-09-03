import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import Dashboard from "../../../../../Models/DatabaseModels/Dashboard";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { FindOperator } from "typeorm";

/*
 * github.com/OneUptime/oneuptime/issues/3550 reported that a user holding only
 * the read-only `Viewer` and `MonitorViewer` roles could open a dashboard they
 * were not an owner of AND save changes to it.
 *
 * These tests pin down what the server actually does, because the two halves of
 * that report have different answers:
 *
 *   - Reading is allowed, and is meant to be. `Viewer` is documented as
 *     "read-only access across all project resources", and the reported team
 *     granted it at scope "All resources in project". Narrowing visibility to
 *     the resources somebody owns is what the `Owned` scope on the permission
 *     row is for - the last two tests here are the proof that it reaches
 *     dashboards.
 *
 *   - Writing was never allowed. Dashboard's update ACL is
 *     [ProjectOwner, ProjectAdmin, EditDashboard], so the PUT the editor
 *     eventually sends is refused. What was broken lived entirely in the UI,
 *     which offered the whole editing surface to a reader and only surfaced the
 *     refusal after the work was done (see
 *     Common/Tests/App/Dashboard/DashboardEditPermissions.test.tsx). These
 *     cases stand guard over the ACL that makes that refusal happen.
 */
describe("Dashboard access control (issue #3550)", () => {
  const projectId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();

  type MakePropsFunction = (
    permissions: Array<Permission>,
    scope?: PermissionScope | undefined,
  ) => DatabaseCommonInteractionProps;

  /*
   * The permission set a member of the reported team actually carries:
   * whatever their team grants, plus the implicit grants every signed-in
   * project member gets (see UserPermissionUtil).
   */
  const makeProps: MakePropsFunction = (
    permissions: Array<Permission>,
    scope?: PermissionScope | undefined,
  ): DatabaseCommonInteractionProps => {
    const userPermissions: Array<UserPermission> = permissions.map(
      (permission: Permission) => {
        return {
          _type: "UserPermission" as const,
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
          ...(scope ? { scope: scope } : {}),
        };
      },
    );

    // Implicit grants - never scoped, never stored on a TeamPermission row.
    for (const implicitPermission of [
      Permission.CurrentUser,
      Permission.ProjectUser,
      Permission.UnAuthorizedSsoUser,
    ]) {
      userPermissions.push({
        _type: "UserPermission",
        permission: implicitPermission,
        labelIds: [],
        isBlockPermission: false,
      });
    }

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
  };

  type CheckFunction = (
    permissions: Array<Permission>,
    type: DatabaseRequestType,
  ) => Error | null;

  const check: CheckFunction = (
    permissions: Array<Permission>,
    type: DatabaseRequestType,
  ): Error | null => {
    try {
      TablePermission.checkTableLevelPermissions(
        Dashboard,
        makeProps(permissions),
        type,
      );
    } catch (err) {
      return err as Error;
    }

    return null;
  };

  const readOnlyRoles: Array<Permission> = [
    Permission.Viewer,
    Permission.MonitorViewer,
  ];

  describe("the roles from the report", () => {
    test("Viewer + Monitor Viewer may READ a dashboard", () => {
      expect(check(readOnlyRoles, DatabaseRequestType.Read)).toBeNull();
    });

    test("Viewer + Monitor Viewer may NOT update a dashboard", () => {
      const error: Error | null = check(
        readOnlyRoles,
        DatabaseRequestType.Update,
      );

      expect(error).not.toBeNull();
      expect(error?.message).toContain(
        "You do not have permissions to update Dashboard",
      );
      /*
       * The message names the permissions that would work, in their human
       * titles. The UI gate reproduces this same sentence so the two do not
       * read like different products.
       */
      expect(error?.message).toContain("Edit Dashboard");
      expect(error?.message).toContain("Project Admin");
      expect(error?.message).toContain("Project Owner");
    });

    test("Viewer + Monitor Viewer may NOT create a dashboard", () => {
      const error: Error | null = check(
        readOnlyRoles,
        DatabaseRequestType.Create,
      );

      expect(error).not.toBeNull();
      expect(error?.message).toContain(
        "You do not have permissions to create Dashboard",
      );
    });

    test("Viewer + Monitor Viewer may NOT delete a dashboard", () => {
      const error: Error | null = check(
        readOnlyRoles,
        DatabaseRequestType.Delete,
      );

      expect(error).not.toBeNull();
      expect(error?.message).toContain(
        "You do not have permissions to delete Dashboard",
      );
    });

    /*
     * The project-wide Viewer role is read-only by definition, so it must not
     * pick up write access to a dashboard by any route - not through the
     * granular Dashboard permissions and not through the operational
     * wildcards, neither of which it holds.
     */
    test("no combination of the reported roles grants a write", () => {
      for (const type of [
        DatabaseRequestType.Create,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        expect(check([Permission.Viewer], type)).not.toBeNull();
        expect(check([Permission.MonitorViewer], type)).not.toBeNull();
        expect(check(readOnlyRoles, type)).not.toBeNull();
      }
    });
  });

  describe("the permissions that DO grant a write", () => {
    test("Edit Dashboard allows an update", () => {
      expect(
        check([Permission.EditDashboard], DatabaseRequestType.Update),
      ).toBeNull();
    });

    test("Project Admin allows an update", () => {
      expect(
        check([Permission.ProjectAdmin], DatabaseRequestType.Update),
      ).toBeNull();
    });

    /*
     * Dashboard is @OperationalResource, so the wildcard covers it even though
     * it is not enumerated in the model's ACL. The UI gate has to know this
     * too, or it would lock the editor for somebody the API would let through.
     */
    test("Edit All Operational Resources allows an update", () => {
      expect(
        check(
          [Permission.EditAllOperationalResources],
          DatabaseRequestType.Update,
        ),
      ).toBeNull();
    });

    test("Read All Operational Resources does NOT allow an update", () => {
      expect(
        check(
          [Permission.ReadAllOperationalResources],
          DatabaseRequestType.Update,
        ),
      ).not.toBeNull();
    });
  });

  /*
   * The half of the report that is a configuration answer rather than a bug:
   * "a dashboard with no assigned Owner should not be visible to arbitrary
   * team members". That is exactly what scope `Owned` does, and Dashboard is
   * registered in the owner-table registry so it resolves through
   * DashboardOwnerUser / DashboardOwnerTeam.
   */
  describe("restricting visibility to owners via the Owned scope", () => {
    const ownedDashboardId: ObjectID = ObjectID.generate();

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /*
     * The ids end up as bound parameters on a Raw operator, so the values are
     * read off objectLiteralParameters rather than off `value`.
     */
    type BoundValuesFunction = (operator: FindOperator<any>) => Array<string>;

    const boundValues: BoundValuesFunction = (
      operator: FindOperator<any>,
    ): Array<string> => {
      /*
       * `in` binds the whole id list to a single parameter, `equalTo` binds one
       * value per parameter - flatten so both shapes read the same here.
       */
      return Object.values(
        (operator.objectLiteralParameters || {}) as Record<string, unknown>,
      ).flatMap((value: unknown) => {
        return Array.isArray(value) ? value.map(String) : [String(value)];
      });
    };

    test("an Owned-scoped Viewer only sees dashboards they own", async () => {
      jest
        .spyOn(OwnedScopePermission as any, "getAllowedResourceIds")
        .mockResolvedValue([ownedDashboardId]);

      const query: any = await OwnedScopePermission.addOwnedScopeToQuery(
        Dashboard,
        { projectId } as any,
        makeProps([Permission.Viewer], PermissionScope.Owned),
        DatabaseRequestType.Read,
      );

      expect(query._id).toBeInstanceOf(FindOperator);
      expect(boundValues(query._id)).toEqual([ownedDashboardId.toString()]);
    });

    test("an Owned-scoped Viewer who owns no dashboard sees none", async () => {
      jest
        .spyOn(OwnedScopePermission as any, "getAllowedResourceIds")
        .mockResolvedValue([]);

      const query: any = await OwnedScopePermission.addOwnedScopeToQuery(
        Dashboard,
        { projectId } as any,
        makeProps([Permission.Viewer], PermissionScope.Owned),
        DatabaseRequestType.Read,
      );

      /*
       * Matches nothing rather than everything. A dashboard with an empty
       * Owners list is owned by nobody, so it drops out of the result for
       * every Owned-scoped reader - which is the behaviour the report asked
       * for.
       */
      expect(query._id).toBeInstanceOf(FindOperator);
      expect(boundValues(query._id)).toEqual([
        ObjectID.getZeroObjectID().toString(),
      ]);
    });

    /*
     * The scope the reported team actually had. Documented here so the
     * difference between the two configurations is not folklore.
     */
    test("an All-scoped Viewer is not narrowed to owned dashboards", async () => {
      jest
        .spyOn(OwnedScopePermission as any, "getAllowedResourceIds")
        .mockResolvedValue([ownedDashboardId]);

      const query: any = await OwnedScopePermission.addOwnedScopeToQuery(
        Dashboard,
        { projectId } as any,
        makeProps([Permission.Viewer], PermissionScope.All),
        DatabaseRequestType.Read,
      );

      expect(query._id).toBeUndefined();
    });
  });
});
