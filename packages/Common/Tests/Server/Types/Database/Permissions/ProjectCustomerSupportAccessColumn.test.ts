import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import Project from "../../../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Columns from "../../../../../Types/Database/Columns";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * Project.letCustomerSupportAccessProject is the switch that lets OneUptime
 * customer support open a customer's project. Two pages write it: the
 * customer's own Project Settings, and - now - the Admin Dashboard's
 * Project > Support page, which talks to the same CRUD endpoint through
 * AdminModelAPI as a master admin.
 *
 * That admin page only works because UpdatePermission.checkUpdatePermissions
 * returns before ColumnPermissions ever sees the data when props.isMasterAdmin
 * is set - the column's own ColumnAccessControl.update lists ProjectOwner and
 * ProjectAdmin and nothing else, so a master admin who is not a member of the
 * project has no listed grant on it at all. Nothing in the page or the model
 * states that dependency, so these tests pin it from both sides: the bypass
 * that makes the admin page work, and the narrow customer-side grant it must
 * not be confused with widening.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * DatabaseCommonInteractionPropsUtil.getUserPermissions drops every permission
 * whose isBlockPermission does not match the requested PermissionType, and it
 * only reads the tenant bucket when props.tenantId is set. Getting either
 * wrong yields an empty permission set, which would make the "does not throw"
 * cases below pass for entirely the wrong reason - hence the harness guard
 * that runs first.
 */
function makeProps(
  permissions: Array<Permission>,
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
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
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
    ...overrides,
  };
}

type CheckFunction = () => void;

function checkColumnUpdate(
  data: Partial<Project>,
  permissions: Array<Permission>,
): CheckFunction {
  return () => {
    ColumnPermissions.checkDataColumnPermissions(
      Project,
      data as Project,
      makeProps(permissions),
      DatabaseRequestType.Update,
    );
  };
}

function updatableColumns(permissions: Array<Permission>): Array<string> {
  return ColumnPermissions.getModelColumnsByPermissions(
    Project,
    makeProps(permissions).userTenantAccessPermission![projectId.toString()]!
      .permissions,
    DatabaseRequestType.Update,
  ).columns;
}

function readableColumns(permissions: Array<Permission>): Array<string> {
  return ColumnPermissions.getModelColumnsByPermissions(
    Project,
    makeProps(permissions).userTenantAccessPermission![projectId.toString()]!
      .permissions,
    DatabaseRequestType.Read,
  ).columns;
}

const COLUMN: string = "letCustomerSupportAccessProject";

describe("Project.letCustomerSupportAccessProject column access", () => {
  describe("harness guard", () => {
    /*
     * Runs first on purpose. Several assertions below are "does not throw",
     * which an empty or mis-shaped permission set would also satisfy -
     * getModelColumnsByPermissions would return no columns, but so would a
     * props object the util silently ignored. This case has a caller that
     * genuinely lacks the grant, so it MUST throw. If it stops throwing, the
     * props factory above is broken, not the model.
     */
    it("refuses a plain member who tries to flip the switch", () => {
      expect(
        checkColumnUpdate({ letCustomerSupportAccessProject: true }, [
          Permission.ProjectMember,
        ]),
      ).toThrow(BadDataException);
    });
  });

  describe("the customer side of the switch", () => {
    it("lets a project owner turn support access on", () => {
      expect(
        checkColumnUpdate({ letCustomerSupportAccessProject: true }, [
          Permission.ProjectOwner,
        ]),
      ).not.toThrow();
    });

    it("lets a project admin turn support access off again", () => {
      expect(
        checkColumnUpdate({ letCustomerSupportAccessProject: false }, [
          Permission.ProjectAdmin,
        ]),
      ).not.toThrow();
    });

    it("refuses a viewer", () => {
      expect(
        checkColumnUpdate({ letCustomerSupportAccessProject: true }, [
          Permission.ProjectMember,
          Permission.Viewer,
        ]),
      ).toThrow(BadDataException);
    });

    it("grants only owners and admins the write, and nobody else", () => {
      /*
       * Asserted through the column list rather than one role at a time, so
       * adding a role to the update array fails here even if no test above
       * happens to name that role.
       */
      for (const permission of [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]) {
        expect(updatableColumns([permission])).toContain(COLUMN);
      }

      for (const permission of [
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadProject,
        Permission.UnAuthorizedSsoUser,
      ]) {
        expect(updatableColumns([permission])).not.toContain(COLUMN);
      }
    });

    it("is readable by everyone in the project, so the toggle renders its current state", () => {
      /*
       * Read and update are independent arrays on ColumnAccessControl. A
       * member who could not read the column would see an empty card rather
       * than "No".
       */
      for (const permission of [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.ReadProject,
      ]) {
        expect(readableColumns([permission])).toContain(COLUMN);
      }
    });

    it("is never creatable, so a project cannot be created with support already let in", () => {
      const createColumns: Columns =
        ColumnPermissions.getModelColumnsByPermissions(
          Project,
          makeProps([
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.User,
          ]).userTenantAccessPermission![projectId.toString()]!.permissions,
          DatabaseRequestType.Create,
        );

      expect(createColumns.columns).not.toContain(COLUMN);
    });
  });

  describe("the admin dashboard side of the switch", () => {
    /*
     * The Admin Dashboard sends no project headers (AdminModelAPI clears
     * them), so a master admin acting on somebody else's project arrives with
     * no tenant permissions for it at all. checkUpdatePermissions has to let
     * that through on isMasterAdmin alone, or the Project > Support page 400s
     * on every save.
     */
    const query: Record<string, unknown> = { _id: projectId.toString() };

    async function checkUpdate(
      props: DatabaseCommonInteractionProps,
    ): Promise<Record<string, unknown>> {
      return (await UpdatePermission.checkUpdatePermissions(
        Project,
        { ...query } as any,
        { letCustomerSupportAccessProject: true } as any,
        props,
      )) as unknown as Record<string, unknown>;
    }

    /*
     * Asserted on the query that comes back rather than on "it did not
     * throw": the non-admin path rewrites the query on its way through
     * BasePermission - tenant scope, owner scope, access-control ids. Getting
     * the caller's query back unchanged is what says the bypass was taken,
     * and it is also what the admin page depends on, since the project it
     * names is not one the staff user belongs to.
     */
    it("lets a master admin write the column with no project membership at all", async () => {
      await expect(
        checkUpdate({
          userId,
          isMasterAdmin: true,
        }),
      ).resolves.toEqual(query);
    });

    it("lets a master admin write it even while scoped to the project", async () => {
      await expect(
        checkUpdate(makeProps([], { isMasterAdmin: true })),
      ).resolves.toEqual(query);
    });

    it("still refuses the same write from a signed-in user who is not a master admin", async () => {
      /*
       * The counterpart of the two cases above: if this stopped throwing, the
       * bypass they rely on would no longer be what is letting them through,
       * and any user could flip the switch on any project they can reach.
       */
      await expect(
        checkUpdate(makeProps([Permission.ProjectMember])),
      ).rejects.toThrow();
    });
  });
});
