import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../../../../Server/Types/Database/Permissions/BillingPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import DeletePermission from "../../../../../Server/Types/Database/Permissions/DeletePermission";
import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getModelTypeByName } from "../../../../../Models/DatabaseModels/Index";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { DELETE_CONSEQUENCES } from "../../../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Delete is now in each row's ⋯ menu and in Bulk Actions on every deletable
 * list, and a bulk Delete sends one DELETE per row. The list only offers it:
 * whether a row goes is the server's decision, the same as it was when
 * Delete lived on the record's own page.
 *
 * So for every kind of record those lists' dialogs speak about
 * (DELETE_CONSEQUENCES, keyed by table name), asked of the check every
 * DELETE goes through (TablePermission, the table step):
 *
 *   - a Viewer is refused, saying which permissions it would take;
 *   - a project owner is let through.
 *
 * And for status pages, the list the request was about, role by role: the
 * domain viewer is refused, the domain admin and member and anyone with
 * Delete Status Page are let through, and a team block on the permission
 * that let them through refuses them again.
 *
 * Every member of a project also holds Project User (AccessTokenService adds
 * it), so each caller here holds it too: it must not let anyone delete.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type ModelType = { new (): DatabaseBaseModel };

function propsFor(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): DatabaseCommonInteractionProps {
  const row: (permission: Permission, isBlock: boolean) => UserPermission = (
    permission: Permission,
    isBlock: boolean,
  ): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: isBlock,
    };
  };

  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: [
      ...[...permissions, Permission.ProjectUser].map(
        (permission: Permission): UserPermission => {
          return row(permission, false);
        },
      ),
      ...blocked.map((permission: Permission): UserPermission => {
        return row(permission, true);
      }),
    ],
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

// What the table step answers a DELETE: nothing, or why not.
function deleteRefusal(
  modelType: ModelType,
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): Error | null {
  const props: DatabaseCommonInteractionProps = propsFor(permissions, blocked);

  try {
    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Delete,
    );
    TablePermission.checkTableLevelBlockPermissions(
      modelType,
      props,
      DatabaseRequestType.Delete,
    );

    return null;
  } catch (error) {
    return error as Error;
  }
}

const ALL_KINDS: Array<[string, ModelType]> = Object.keys(DELETE_CONSEQUENCES)
  .sort()
  .map((tableName: string): [string, ModelType] => {
    return [tableName, getModelTypeByName(tableName) as ModelType];
  });

/*
 * Kinds whose model grants nobody delete: only OneUptime's master admins
 * delete them, from the Admin Dashboard (an enterprise license, on
 * OneUptime Cloud). A project role - an owner's included - never does.
 */
const isMasterAdminOnly: (kind: [string, ModelType]) => boolean = ([
  ,
  modelType,
]: [string, ModelType]): boolean => {
  return (
    Boolean(modelType) && new modelType().getDeletePermissions().length === 0
  );
};

const KINDS: Array<[string, ModelType]> = ALL_KINDS.filter(
  (kind: [string, ModelType]): boolean => {
    return !isMasterAdminOnly(kind);
  },
);

const MASTER_ADMIN_KINDS: Array<[string, ModelType]> =
  ALL_KINDS.filter(isMasterAdminOnly);

beforeEach(() => {
  // What is asked here is who, not which plan.
  jest
    .spyOn(BillingPermissions, "checkBillingPermissions")
    .mockImplementation((): void => {
      return undefined;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every kind of record the lists' Delete dialogs speak about", () => {
  test("is a model the server knows by that table name", () => {
    expect(KINDS.length).toBeGreaterThan(40);

    for (const [tableName, modelType] of KINDS) {
      expect({ tableName, found: Boolean(modelType) }).toEqual({
        tableName,
        found: true,
      });
    }
  });

  test.each(KINDS)(
    "%s: a Viewer's DELETE is refused, saying which permissions it takes",
    (_tableName: string, modelType: ModelType) => {
      const refusal: Error | null = deleteRefusal(modelType, [
        Permission.Viewer,
      ]);

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal!.message).toContain("You need one of these permissions");
    },
  );

  test.each(KINDS)(
    "%s: a project owner's DELETE is let through",
    (_tableName: string, modelType: ModelType) => {
      expect(deleteRefusal(modelType, [Permission.ProjectOwner])).toBeNull();
    },
  );
});

describe("the kinds only a master admin deletes", () => {
  test("are the Admin Dashboard's enterprise licenses", () => {
    expect(
      MASTER_ADMIN_KINDS.map(([tableName]: [string, ModelType]): string => {
        return tableName;
      }),
    ).toEqual(["EnterpriseLicense"]);
  });

  test.each(MASTER_ADMIN_KINDS)(
    "%s: a project owner's DELETE is refused",
    (_tableName: string, modelType: ModelType) => {
      expect(
        deleteRefusal(modelType, [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
        ]),
      ).toBeInstanceOf(NotAuthorizedException);
    },
  );

  test.each(MASTER_ADMIN_KINDS)(
    "%s: a master admin's DELETE is let through",
    async (_tableName: string, modelType: ModelType) => {
      await expect(
        DeletePermission.checkDeletePermission(
          modelType,
          { _id: ObjectID.generate().toString() },
          { userId, isMasterAdmin: true },
        ),
      ).resolves.toBeDefined();
    },
  );
});

describe("a status page's DELETE, role by role", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.DeleteProjectStatusPage,
  ])("%s is let through", (permission: Permission) => {
    expect(deleteRefusal(StatusPage, [permission])).toBeNull();
  });

  test.each([
    Permission.Viewer,
    Permission.StatusPageViewer,
    Permission.ReadProjectStatusPage,
    Permission.EditProjectStatusPage,
  ])("%s is refused", (permission: Permission) => {
    expect(deleteRefusal(StatusPage, [permission])).toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("a team block on the permission that let them through refuses them again", () => {
    expect(
      deleteRefusal(
        StatusPage,
        [Permission.DeleteProjectStatusPage],
        [Permission.DeleteProjectStatusPage],
      ),
    ).toBeInstanceOf(NotAuthorizedException);
  });
});
