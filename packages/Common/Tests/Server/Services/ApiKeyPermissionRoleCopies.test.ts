import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { getUniqueColumnsBy } from "../../../Types/Database/UniqueColumnBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getApiKeyRoleCopyChangeRefusedMessage } from "../../../Types/Team/CustomRole";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * AN API KEY'S COPIES OF ITS CUSTOM ROLES' PERMISSIONS, and the cache every
 * API key request reads a key's permissions from.
 *
 *   - A copy is the role's: changed and removed only through the role (or by
 *     taking the role from the key), never on its own - by anyone but
 *     OneUptime - and the refusal names the role.
 *   - No request writes a copy's marks: the three columns are closed to
 *     every create and update.
 *   - A key's own permissions are unique among its own rows; a role's copy
 *     of the same permission beside one is no duplicate, and two roles'
 *     copies of one permission are kept apart.
 *   - A key's cached permissions are kept under their project's generation:
 *     a change - here, or on any other server - is never served from before
 *     it, and every write of a key's permissions starts a new generation of
 *     its project's.
 */

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

const PROJECT: ObjectID = new ObjectID("8a000000-0000-4000-8000-000000000001");
const KEY: ObjectID = new ObjectID("8b000000-0000-4000-8000-000000000001");
const ROLE: ObjectID = new ObjectID("8c000000-0000-4000-8000-000000000001");
const GIVEN: ObjectID = new ObjectID("8d000000-0000-4000-8000-000000000001");
const ROW: ObjectID = new ObjectID("8e000000-0000-4000-8000-000000000001");

type HookCallable = Record<
  string,
  (...args: Array<unknown>) => Promise<unknown>
>;

const hooks: () => HookCallable = (): HookCallable => {
  return ApiKeyPermissionService as unknown as HookCallable;
};

const admin: DatabaseCommonInteractionProps = {
  userId: new ObjectID("8f000000-0000-4000-8000-000000000001"),
  tenantId: PROJECT,
  ...ON_HIGHEST_PLAN,
  userGlobalAccessPermission: {
    _type: "UserGlobalAccessPermission",
    projectIds: [PROJECT],
    globalPermissions: [Permission.User],
  },
  userTenantAccessPermission: {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.All,
        },
      ],
    },
  },
};

// A key's copy of the role Incident Responder's Incident Member.
const copyRow: () => ApiKeyPermission = (): ApiKeyPermission => {
  const row: ApiKeyPermission = new ApiKeyPermission(
    new ObjectID("90000000-0000-4000-8000-000000000001"),
  );
  row.projectId = PROJECT;
  row.apiKeyId = KEY;
  row.permission = Permission.IncidentMember;
  row.isBlockPermission = false;
  row.labels = [];
  row.customRoleId = ROLE;
  row.apiKeyCustomRoleId = GIVEN;
  row.customRolePermissionId = ROW;
  const role: CustomRole = new CustomRole(ROLE);
  role.name = "Incident Responder";
  row.customRole = role;
  return row;
};

// A permission given to the key directly.
const ownRow: () => ApiKeyPermission = (): ApiKeyPermission => {
  const row: ApiKeyPermission = new ApiKeyPermission(
    new ObjectID("90000000-0000-4000-8000-000000000002"),
  );
  row.projectId = PROJECT;
  row.apiKeyId = KEY;
  row.permission = Permission.AlertMember;
  row.isBlockPermission = false;
  row.labels = [];
  return row;
};

// A filter that keeps only the rows with no value: a key's own, in the duplicate checks.
const isNullFilter: (value: unknown) => boolean = (value: unknown): boolean => {
  if (!(value instanceof FindOperator)) {
    return false;
  }

  // QueryHelper.isNull: a raw operator that reads `(<column> IS NULL)`.
  const getSql: ((alias: string) => string) | undefined = (
    value as FindOperator<unknown>
  ).getSql;

  return Boolean(getSql) && getSql!("column") === "(column IS NULL)";
};

beforeEach(() => {
  stubProjectDirectory({});
  ApiKeyPermissionService.clearCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a key's copy of a role's permission is the role's", () => {
  test.each(["onBeforeUpdate", "onBeforeDelete"])(
    "%s refuses a copy, even for a project owner, naming the role",
    async (hook: string) => {
      getJestSpyOn(
        ApiKeyPermissionService,
        hook === "onBeforeUpdate"
          ? "findRowsAndHoldUpdateToThem"
          : "findRowsAndHoldDeleteToThem",
      ).mockResolvedValue([copyRow()] as never);

      const write: Record<string, unknown> = {
        query: { _id: copyRow().id },
        props: admin,
      };

      if (hook === "onBeforeUpdate") {
        write["data"] = { labels: [] };
      }

      const refusal: unknown = await hooks()[hook]!(write)
        .then(() => {
          return null;
        })
        .catch((err: unknown) => {
          return err;
        });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        getApiKeyRoleCopyChangeRefusedMessage({
          roleName: "Incident Responder",
          permission: Permission.IncidentMember,
        }),
      );
      expect((refusal as Error).message).toBe(
        "Incident Member comes with the custom role Incident Responder. Change the role, or take the role away from the API key.",
      );
    },
  );

  test("a copy whose role could not be read is still refused, in words that name no role", () => {
    expect(
      getApiKeyRoleCopyChangeRefusedMessage({
        permission: Permission.IncidentMember,
      }),
    ).toBe(
      "Incident Member comes with a custom role. Change the role, or take the role away from the API key.",
    );
  });

  test("the key's own permissions are changed and removed as before", async () => {
    getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue({
      _id: KEY.toString(),
    } as never);
    getJestSpyOn(ApiKeyPermissionService, "findOneBy").mockResolvedValue(null);
    getJestSpyOn(
      ApiKeyPermissionService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([ownRow()] as never);
    getJestSpyOn(
      ApiKeyPermissionService,
      "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue([ownRow()] as never);

    await expect(
      hooks()["onBeforeUpdate"]!({
        query: { _id: ownRow().id },
        data: { permission: Permission.AlertViewer },
        props: admin,
      }),
    ).resolves.toBeTruthy();

    await expect(
      hooks()["onBeforeDelete"]!({
        query: { _id: ownRow().id },
        props: admin,
      }),
    ).resolves.toBeTruthy();
  });

  test("OneUptime's own writes - the sync - touch a copy", async () => {
    getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue({
      _id: KEY.toString(),
    } as never);
    getJestSpyOn(ApiKeyPermissionService, "findOneBy").mockResolvedValue(null);
    getJestSpyOn(
      ApiKeyPermissionService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([copyRow()] as never);

    await expect(
      hooks()["onBeforeUpdate"]!({
        query: { _id: copyRow().id },
        data: { labels: [] },
        props: { isRoot: true },
      }),
    ).resolves.toBeTruthy();
  });

  test("no request writes a copy's marks: the three columns are closed to every create and update, and read with the key", () => {
    const model: ApiKeyPermission = new ApiKeyPermission();

    for (const column of [
      "customRole",
      "customRoleId",
      "apiKeyCustomRole",
      "apiKeyCustomRoleId",
      "customRolePermission",
      "customRolePermissionId",
    ]) {
      expect({
        column,
        create: model.getColumnAccessControlFor(column)?.create,
        update: model.getColumnAccessControlFor(column)?.update,
      }).toEqual({ column, create: [], update: [] });
      expect(model.getColumnAccessControlFor(column)?.read).toEqual(
        model.getColumnAccessControlFor("apiKeyId")?.read,
      );
    }
  });
});

describe("a key's own permissions, beside its roles' copies", () => {
  test("a permission is unique among the key's own rows, and among one role's copies", () => {
    const row: ApiKeyPermission = new ApiKeyPermission();
    row.permission = Permission.IncidentMember;

    expect(getUniqueColumnsBy(row)).toEqual({
      permission: ["apiKeyId", "apiKeyCustomRoleId"],
    });
  });

  test("adding a permission the key holds through a role is no duplicate: only the key's own rows are asked", async () => {
    getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue({
      _id: KEY.toString(),
    } as never);
    const findOne: jest.SpyInstance = getJestSpyOn(
      ApiKeyPermissionService,
      "findOneBy",
    ).mockResolvedValue(null);

    const data: ApiKeyPermission = new ApiKeyPermission();
    data.apiKeyId = KEY;
    data.projectId = PROJECT;
    data.permission = Permission.IncidentMember;
    data.labels = [];

    await hooks()["onBeforeCreate"]!({ data: data, props: admin });

    expect(findOne).toHaveBeenCalled();

    for (const call of findOne.mock.calls) {
      const query: Record<string, unknown> = (
        call[0] as FindOneBy<ApiKeyPermission>
      ).query as Record<string, unknown>;
      expect(isNullFilter(query["apiKeyCustomRoleId"])).toBe(true);
    }
  });

  test("changing a key's own permission to one it holds through a role is no duplicate either", async () => {
    getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue({
      _id: KEY.toString(),
    } as never);
    getJestSpyOn(
      ApiKeyPermissionService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([ownRow()] as never);
    const findOne: jest.SpyInstance = getJestSpyOn(
      ApiKeyPermissionService,
      "findOneBy",
    ).mockResolvedValue(null);

    await hooks()["onBeforeUpdate"]!({
      query: { _id: ownRow().id },
      data: { permission: Permission.IncidentMember },
      props: admin,
    });

    expect(findOne).toHaveBeenCalledTimes(1);
    const query: Record<string, unknown> = (
      findOne.mock.calls[0]![0] as FindOneBy<ApiKeyPermission>
    ).query as Record<string, unknown>;
    expect(isNullFilter(query["apiKeyCustomRoleId"])).toBe(true);
    expect(query["_id"]).toBeInstanceOf(FindOperator);
  });
});

describe("a key's cached permissions follow its project's generation", () => {
  const spyOnFindBy: () => jest.SpyInstance = (): jest.SpyInstance => {
    return getJestSpyOn(ApiKeyPermissionService, "findBy").mockResolvedValue(
      [] as never,
    );
  };

  test("forgetting a project's permissions starts a new generation of it, by its id in lower case, everywhere", async () => {
    const bump: jest.SpyInstance = getJestSpyOn(
      CacheGenerations.prototype,
      "bump",
    ).mockResolvedValue(undefined as never);

    await ApiKeyPermissionService.forgetPermissionsOfProjects([
      PROJECT,
      PROJECT.toString().toUpperCase(),
      null,
      undefined,
      "",
    ]);

    expect(bump).toHaveBeenCalledTimes(1);
    expect(bump.mock.calls[0]![0]).toEqual([
      PROJECT.toString().toLowerCase(),
      PROJECT.toString().toLowerCase(),
    ]);
  });

  test("forgetting no project asks nothing of Redis, and still drops what this process keeps", async () => {
    const findBy: jest.SpyInstance = spyOnFindBy();
    const bump: jest.SpyInstance = getJestSpyOn(
      CacheGenerations.prototype,
      "bump",
    ).mockResolvedValue(undefined as never);

    await ApiKeyPermissionService.findPermissionsByApiKeyId(KEY, PROJECT);
    await ApiKeyPermissionService.forgetPermissionsOfProjects([]);
    await ApiKeyPermissionService.findPermissionsByApiKeyId(KEY, PROJECT);

    expect(bump).not.toHaveBeenCalled();
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("a new generation of the project - made on another server - is read afresh; the same one is served from the cache", async () => {
    let generation: string = "g1.0";
    getJestSpyOn(CacheGenerations.prototype, "get").mockImplementation(
      async (key: string): Promise<string> => {
        expect(key).toBe(PROJECT.toString().toLowerCase());
        return generation;
      },
    );
    const findBy: jest.SpyInstance = spyOnFindBy();

    await ApiKeyPermissionService.findPermissionsByApiKeyId(KEY, PROJECT);
    await ApiKeyPermissionService.findPermissionsByApiKeyId(KEY, PROJECT);
    expect(findBy).toHaveBeenCalledTimes(1);

    // Another server took the role away, and Redis now holds a new generation.
    generation = "g2.0";

    await ApiKeyPermissionService.findPermissionsByApiKeyId(KEY, PROJECT);
    expect(findBy).toHaveBeenCalledTimes(2);

    await ApiKeyPermissionService.findPermissionsByApiKeyId(KEY, PROJECT);
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("a change made here is read afresh at once, even while Redis cannot be reached", async () => {
    const findBy: jest.SpyInstance = spyOnFindBy();

    await ApiKeyPermissionService.findPermissionsByApiKeyId(KEY, PROJECT);
    await ApiKeyPermissionService.forgetPermissionsOfProjects([PROJECT]);
    await ApiKeyPermissionService.findPermissionsByApiKeyId(KEY, PROJECT);

    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("a created permission starts a new generation of its project", async () => {
    const bump: jest.SpyInstance = getJestSpyOn(
      CacheGenerations.prototype,
      "bump",
    ).mockResolvedValue(undefined as never);

    const created: ApiKeyPermission = ownRow();

    await hooks()["onCreateSuccess"]!(
      { createBy: { data: created, props: admin }, carryForward: null },
      created,
    );

    expect(bump.mock.calls[0]![0]).toEqual([PROJECT.toString().toLowerCase()]);
  });

  test("an update starts a new generation of the projects of the rows it changed", async () => {
    getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue({
      _id: KEY.toString(),
    } as never);
    getJestSpyOn(ApiKeyPermissionService, "findOneBy").mockResolvedValue(null);
    getJestSpyOn(
      ApiKeyPermissionService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([ownRow()] as never);
    const bump: jest.SpyInstance = getJestSpyOn(
      CacheGenerations.prototype,
      "bump",
    ).mockResolvedValue(undefined as never);

    const onUpdate: unknown = await hooks()["onBeforeUpdate"]!({
      query: { _id: ownRow().id },
      data: { permission: Permission.AlertViewer },
      props: admin,
    });

    await hooks()["onUpdateSuccess"]!(onUpdate, [ownRow().id]);

    expect(bump.mock.calls[0]![0]).toEqual([PROJECT.toString().toLowerCase()]);
  });

  test("a delete starts a new generation of the projects of the rows it removed, and of the request's", async () => {
    getJestSpyOn(
      ApiKeyPermissionService,
      "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue([ownRow()] as never);
    const bump: jest.SpyInstance = getJestSpyOn(
      CacheGenerations.prototype,
      "bump",
    ).mockResolvedValue(undefined as never);

    const deleteBy: Record<string, unknown> = {
      query: { _id: ownRow().id },
      props: admin,
    };

    const onDelete: { carryForward: unknown } = (await hooks()[
      "onBeforeDelete"
    ]!(deleteBy)) as { carryForward: unknown };

    await hooks()["onDeleteSuccess"]!(
      { deleteBy: deleteBy, carryForward: onDelete.carryForward },
      [ownRow().id],
    );

    expect(bump.mock.calls[0]![0]).toEqual([
      PROJECT.toString().toLowerCase(),
      PROJECT.toString().toLowerCase(),
    ]);
  });
});
