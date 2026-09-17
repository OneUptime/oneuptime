import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import Project from "../../../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * Project.dataResidency is written by exactly one kind of caller - a master
 * admin, from the Admin Dashboard - and read by everyone in the project, since
 * the customer's Project Settings shows it.
 *
 * The write side rests on something the column does not say out loud: its
 * create and update lists are EMPTY, and a master admin still gets through
 * because UpdatePermission.checkUpdatePermissions (and its create twin) return
 * before ColumnPermissions ever looks at the data when props.isMasterAdmin is
 * set. So an empty list reads as "nobody" but means "master admin only". These
 * tests pin both halves: no project role - not even the owner - can write it,
 * and the master admin bypass the Admin Dashboard depends on still holds.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

const COLUMN: string = "dataResidency";

/*
 * Every role a project member can hold. Listed out rather than derived, so a
 * role added to the column's update list fails a named assertion below.
 */
const PROJECT_ROLES: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ReadProject,
  Permission.EditProject,
  Permission.ManageProjectBilling,
  Permission.UnAuthorizedSsoUser,
  Permission.ProjectUser,
];

/*
 * DatabaseCommonInteractionPropsUtil.getUserPermissions drops permissions
 * whose isBlockPermission does not match, and only reads the tenant bucket
 * when props.tenantId is set. Getting either wrong yields an empty permission
 * set, which would make every "refuses" case pass for the wrong reason - hence
 * the harness guard that runs first.
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

function columnsFor(
  permissions: Array<Permission>,
  requestType: DatabaseRequestType,
): Array<string> {
  return ColumnPermissions.getModelColumnsByPermissions(
    Project,
    makeProps(permissions).userTenantAccessPermission![projectId.toString()]!
      .permissions,
    requestType,
  ).columns;
}

type CheckFunction = () => void;

function checkColumnWrite(
  data: Record<string, unknown>,
  permissions: Array<Permission>,
  requestType: DatabaseRequestType,
): CheckFunction {
  return () => {
    ColumnPermissions.checkDataColumnPermissions(
      Project,
      data as unknown as Project,
      makeProps(permissions),
      requestType,
    );
  };
}

describe("Project.dataResidency column access", () => {
  describe("harness guard", () => {
    /*
     * The props factory must produce permissions ColumnPermissions actually
     * reads. `name` is writable by a project owner, so if this throws, the
     * factory is broken and the refusals below prove nothing.
     */
    it("lets a project owner write a column the owner is allowed to write", () => {
      expect(
        checkColumnWrite(
          { name: "Renamed" },
          [Permission.ProjectOwner],
          DatabaseRequestType.Update,
        ),
      ).not.toThrow();
    });

    it("reports the owner's permissions as able to update `name`", () => {
      expect(
        columnsFor([Permission.ProjectOwner], DatabaseRequestType.Update),
      ).toContain("name");
    });
  });

  describe("the column's declared access control", () => {
    const accessControl: Record<string, any> =
      new Project().getColumnAccessControlForAllColumns();

    it("exists on the model", () => {
      expect(accessControl[COLUMN]).toBeDefined();
    });

    it("lists no create permissions", () => {
      expect(accessControl[COLUMN].create).toEqual([]);
    });

    it("lists no update permissions", () => {
      expect(accessControl[COLUMN].update).toEqual([]);
    });

    /*
     * Pinned against `name`, the other value on the same Project Details card:
     * anyone who can see the project's name on that card has to be able to
     * see its data residency next to it, or ModelDetail drops the field from
     * the select and the row silently never appears.
     */
    it("is readable by exactly the roles that can read the project's name", () => {
      expect([...accessControl[COLUMN].read].sort()).toEqual(
        [...accessControl["name"].read].sort(),
      );
    });
  });

  describe("reading it from the customer's dashboard", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProject,
      Permission.UnAuthorizedSsoUser,
      Permission.ProjectUser,
    ]) {
      it(`is readable with only ${permission}`, () => {
        expect(columnsFor([permission], DatabaseRequestType.Read)).toContain(
          COLUMN,
        );
      });
    }

    it("lets a project member select it alongside the project's id and name", () => {
      expect(() => {
        SelectPermission.checkSelectPermission(
          Project,
          { _id: true, name: true, dataResidency: true } as any,
          makeProps([Permission.ProjectMember]),
        );
      }).not.toThrow();
    });

    it("refuses the select for a caller with no project role at all", () => {
      /*
       * Permission.User is what every signed-in user carries. It must not be
       * enough to read another project's residency.
       */
      expect(() => {
        SelectPermission.checkSelectPermission(
          Project,
          { _id: true, dataResidency: true } as any,
          makeProps([Permission.User]),
        );
      }).toThrow(NotAuthorizedException);
    });
  });

  describe("writing it as a project user", () => {
    for (const permission of PROJECT_ROLES) {
      it(`refuses an update from a caller with ${permission}`, () => {
        expect(
          checkColumnWrite(
            { dataResidency: "EU (Frankfurt)" },
            [permission],
            DatabaseRequestType.Update,
          ),
        ).toThrow(BadDataException);
      });
    }

    it("refuses an update even from a caller holding every project role at once", () => {
      expect(
        checkColumnWrite(
          { dataResidency: "EU (Frankfurt)" },
          PROJECT_ROLES,
          DatabaseRequestType.Update,
        ),
      ).toThrow(`User is not allowed to update on dataResidency column`);
    });

    /*
     * Clearing is still a write. A customer must not be able to remove the
     * label staff put on their project any more than change it.
     */
    it("refuses clearing it back to null", () => {
      expect(
        checkColumnWrite(
          { dataResidency: null },
          [Permission.ProjectOwner],
          DatabaseRequestType.Update,
        ),
      ).toThrow(BadDataException);
    });

    it("refuses clearing it to an empty string", () => {
      expect(
        checkColumnWrite(
          { dataResidency: "" },
          [Permission.ProjectOwner],
          DatabaseRequestType.Update,
        ),
      ).toThrow(BadDataException);
    });

    it("is not among the columns any project role may update", () => {
      expect(
        columnsFor(PROJECT_ROLES, DatabaseRequestType.Update),
      ).not.toContain(COLUMN);
    });

    it("refuses it on project creation, so a signed-up user cannot pick their own residency", () => {
      expect(
        checkColumnWrite(
          { name: "Acme", dataResidency: "EU (Frankfurt)" },
          [Permission.User, Permission.CurrentUser],
          DatabaseRequestType.Create,
        ),
      ).toThrow(BadDataException);
    });

    it("is not among the columns a user may create", () => {
      expect(
        columnsFor(
          [Permission.User, Permission.CurrentUser, ...PROJECT_ROLES],
          DatabaseRequestType.Create,
        ),
      ).not.toContain(COLUMN);
    });

    it("still lets the owner rename the project on the same card, so the Project Details form keeps working", () => {
      expect(
        checkColumnWrite(
          { name: "Acme Monitoring" },
          [Permission.ProjectOwner],
          DatabaseRequestType.Update,
        ),
      ).not.toThrow();
    });
  });

  describe("writing it from the Admin Dashboard", () => {
    /*
     * The Admin Dashboard sends no project headers (AdminModelAPI clears
     * them), so a master admin editing a customer's project arrives with no
     * tenant permissions for it. checkUpdatePermissions has to let that
     * through on isMasterAdmin alone, or the Data Residency card 400s on
     * every save.
     */
    const query: Record<string, unknown> = { _id: projectId.toString() };

    async function checkUpdate(
      data: Record<string, unknown>,
      props: DatabaseCommonInteractionProps,
    ): Promise<Record<string, unknown>> {
      return (await UpdatePermission.checkUpdatePermissions(
        Project,
        { ...query } as any,
        data as any,
        props,
      )) as unknown as Record<string, unknown>;
    }

    /*
     * Asserted on the query that comes back, not only on "it did not throw":
     * the non-admin path rewrites the query through BasePermission, so getting
     * the caller's query back unchanged is what says the bypass was taken.
     */
    it("lets a master admin set it with no project membership at all", async () => {
      await expect(
        checkUpdate(
          { dataResidency: "EU (Frankfurt)" },
          { userId, isMasterAdmin: true },
        ),
      ).resolves.toEqual(query);
    });

    it("lets a master admin clear it", async () => {
      await expect(
        checkUpdate({ dataResidency: null }, { userId, isMasterAdmin: true }),
      ).resolves.toEqual(query);
    });

    it("lets a master admin set it while scoped to the project", async () => {
      await expect(
        checkUpdate(
          { dataResidency: "US East" },
          makeProps([], { isMasterAdmin: true }),
        ),
      ).resolves.toEqual(query);
    });

    it("lets a root (system) caller set it", async () => {
      await expect(
        checkUpdate({ dataResidency: "US East" }, { isRoot: true }),
      ).resolves.toEqual(query);
    });

    it("lets a master admin create a project that already carries one", () => {
      const project: Project = new Project();
      project.name = "Acme";
      project.dataResidency = "EU (Frankfurt)";

      expect(() => {
        CreatePermission.checkCreatePermissions(Project, project, {
          userId,
          isMasterAdmin: true,
        });
      }).not.toThrow();
    });

    /*
     * The counterpart of the cases above: the same write from a project owner
     * who is not a master admin must still fail. If it stopped failing, the
     * bypass would no longer be what lets the admin through - and any customer
     * could relabel their own project.
     */
    it("still refuses the same write from a project owner who is not a master admin", async () => {
      await expect(
        checkUpdate(
          { dataResidency: "EU (Frankfurt)" },
          makeProps([Permission.ProjectOwner]),
        ),
      ).rejects.toThrow();
    });

    it("still refuses it when isMasterAdmin is explicitly false", async () => {
      await expect(
        checkUpdate(
          { dataResidency: "EU (Frankfurt)" },
          makeProps([Permission.ProjectOwner], { isMasterAdmin: false }),
        ),
      ).rejects.toThrow();
    });
  });
});
