import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ApiKeyCustomRole from "../../../Models/DatabaseModels/ApiKeyCustomRole";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../Models/DatabaseModels/Label";
import ApiKeyCustomRoleService from "../../../Server/Services/ApiKeyCustomRoleService";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import CustomRolePermissionService from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import {
  CUSTOM_ROLE_NOT_READABLE_MESSAGE,
  getCustomRoleGrantRefusedMessage,
} from "../../../Types/Team/CustomRole";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GIVING A CUSTOM ROLE TO AN API KEY, AND TAKING IT AWAY, through
 * ApiKeyCustomRoleService's hooks with the database stood in for.
 *
 * Giving a key a role gives it every permission of the role a key can hold,
 * so it is held to what giving each of them to the key directly takes:
 *
 *   - the key and the role are the request's project's;
 *   - the giver reads the role with their own read of it, so someone who may
 *     change what a key can do but not see the project's roles gives none;
 *   - every permission the key would hold is one the giver could give the
 *     key directly, with its labels (ApiKeyPermissionService
 *     .assertCallerCanGrantPermission) - but those the role limits to what
 *     is owned, which give a key nothing;
 *   - once given, the key's copies are made (CustomRoleSync); if they cannot
 *     be, the role is taken back, every server forgets the key's
 *     permissions, and the give is refused;
 *   - taking it away forgets the key's permissions on every server.
 *
 * The same against a real Postgres is ApiKeyCustomRolesPostgres.test.ts.
 */

const PROJECT: ObjectID = new ObjectID("7a000000-0000-4000-8000-000000000001");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000002",
);
const ROLE: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000001");
const KEY: ObjectID = new ObjectID("7c000000-0000-4000-8000-000000000001");
const GIVEN: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000001");
const PRODUCTION: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);
const STAGING: ObjectID = new ObjectID("7e000000-0000-4000-8000-000000000002");

type HookService = Record<
  string,
  (...args: Array<unknown>) => Promise<unknown>
>;

const callHook: (
  service: unknown,
  hook: string,
  ...args: Array<unknown>
) => Promise<unknown> = (
  service: unknown,
  hook: string,
  ...args: Array<unknown>
): Promise<unknown> => {
  return (service as HookService)[hook]!.apply(service, args);
};

const grant: (
  permission: Permission,
  data?: Partial<UserPermission>,
) => UserPermission = (
  permission: Permission,
  data: Partial<UserPermission> = {},
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
    ...data,
  };
};

const propsHolding: (
  permissions: Array<UserPermission>,
  tenantId?: ObjectID,
) => DatabaseCommonInteractionProps = (
  permissions: Array<UserPermission>,
  tenantId: ObjectID = PROJECT,
): DatabaseCommonInteractionProps => {
  return {
    userId: new ObjectID("7f000000-0000-4000-8000-000000000001"),
    tenantId: tenantId,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [tenantId],
      globalPermissions: [Permission.User],
    },
    userTenantAccessPermission: {
      [tenantId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: tenantId,
        permissions: permissions,
      },
    },
  };
};

/*
 * May change what a key can do and read the project's roles, and holds
 * Incident Member for the whole project and Monitor Viewer for Production
 * only - nothing else.
 */
const keyEditor: DatabaseCommonInteractionProps = propsHolding([
  grant(Permission.EditProjectApiKeyPermissions),
  grant(Permission.ReadProjectApiKey),
  grant(Permission.ReadProjectTeam),
  grant(Permission.IncidentMember),
  grant(Permission.MonitorViewer, {
    scope: PermissionScope.Labels,
    labelIds: [PRODUCTION],
  }),
]);

const owner: DatabaseCommonInteractionProps = propsHolding([
  grant(Permission.ProjectOwner),
]);

const roleRow: (
  permission: Permission,
  scope: PermissionScope,
  labels?: Array<ObjectID>,
) => CustomRolePermission = (
  permission: Permission,
  scope: PermissionScope,
  labels: Array<ObjectID> = [],
): CustomRolePermission => {
  const row: CustomRolePermission = new CustomRolePermission(
    ObjectID.generate(),
  );
  row.customRoleId = ROLE;
  row.projectId = PROJECT;
  row.permission = permission;
  row.scope = scope;
  row.labels = labels.map((labelId: ObjectID): Label => {
    return new Label(labelId);
  });
  return row;
};

const giving: (
  props: DatabaseCommonInteractionProps,
  data?: Partial<{
    apiKeyId: ObjectID | undefined;
    customRoleId: ObjectID | undefined;
    projectId: ObjectID | undefined;
  }>,
) => { data: ApiKeyCustomRole; props: DatabaseCommonInteractionProps } = (
  props: DatabaseCommonInteractionProps,
  data: Partial<{
    apiKeyId: ObjectID | undefined;
    customRoleId: ObjectID | undefined;
    projectId: ObjectID | undefined;
  }> = {},
): { data: ApiKeyCustomRole; props: DatabaseCommonInteractionProps } => {
  const given: ApiKeyCustomRole = new ApiKeyCustomRole();

  const apiKeyId: ObjectID | undefined =
    "apiKeyId" in data ? data.apiKeyId : KEY;
  const customRoleId: ObjectID | undefined =
    "customRoleId" in data ? data.customRoleId : ROLE;
  const projectId: ObjectID | undefined =
    "projectId" in data ? data.projectId : PROJECT;

  if (apiKeyId) {
    given.apiKeyId = apiKeyId;
  }

  if (customRoleId) {
    given.customRoleId = customRoleId;
  }

  if (projectId) {
    given.projectId = projectId;
  }

  return { data: given, props: props };
};

const refusalOf: (work: () => Promise<unknown>) => Promise<Error> = async (
  work: () => Promise<unknown>,
): Promise<Error> => {
  try {
    await work();
  } catch (err) {
    return err as Error;
  }

  throw new Error("Expected a refusal, but the give went through.");
};

describe("ApiKeyCustomRoleService", () => {
  let rolePermissions: Array<CustomRolePermission>;
  let roleReads: Array<FindOneBy<CustomRole>>;

  beforeEach(() => {
    stubProjectDirectory({});
    getJestSpyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    rolePermissions = [];
    roleReads = [];

    getJestSpyOn(ApiKeyService, "findOneBy").mockImplementation(
      async (findOneBy: FindOneBy<ApiKey>): Promise<ApiKey | null> => {
        // The key is read with its project, as OneUptime.
        expect(findOneBy.props).toEqual({ isRoot: true });

        return String(findOneBy.query.projectId) === PROJECT.toString() &&
          String(findOneBy.query._id) === KEY.toString()
          ? new ApiKey(KEY)
          : null;
      },
    );
    getJestSpyOn(CustomRoleService, "findOneBy").mockImplementation(
      async (findOneBy: FindOneBy<CustomRole>): Promise<CustomRole | null> => {
        roleReads.push(findOneBy);

        if (
          String(findOneBy.query.projectId) !== PROJECT.toString() ||
          String(findOneBy.query._id) !== ROLE.toString()
        ) {
          return null;
        }

        const role: CustomRole = new CustomRole(ROLE);
        role.name = "Incident Responder";
        return role;
      },
    );
    getJestSpyOn(
      CustomRolePermissionService,
      "findPermissionsOfRole",
    ).mockImplementation(async (): Promise<Array<CustomRolePermission>> => {
      return rolePermissions;
    });
    getJestSpyOn(
      ApiKeyPermissionService,
      "forgetPermissionsOfProjects",
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("who may give a role to a key", () => {
    test("someone who holds every permission the key would get gives it - one limited to what is owned is not weighed", async () => {
      rolePermissions = [
        roleRow(Permission.IncidentMember, PermissionScope.All),
        roleRow(Permission.MonitorViewer, PermissionScope.Labels, [PRODUCTION]),
        // The editor does not hold it, but it gives a key nothing.
        roleRow(Permission.AlertMember, PermissionScope.Owned),
      ];
      const ceiling: jest.SpyInstance = getJestSpyOn(
        ApiKeyPermissionService,
        "assertCallerCanGrantPermission",
      );

      await expect(
        callHook(ApiKeyCustomRoleService, "onBeforeCreate", giving(keyEditor)),
      ).resolves.toBeTruthy();

      // Weighed as giving each to the key directly, with the role's labels.
      const weighed: Array<string> = ceiling.mock.calls.map(
        (call: Array<unknown>): string => {
          const data: { permission: Permission; labels: Array<Label> } =
            call[0] as { permission: Permission; labels: Array<Label> };
          return `${data.permission}:${data.labels
            .map((label: Label): string => {
              return label.id!.toString();
            })
            .join(",")}`;
        },
      );
      expect(weighed).toEqual([
        `${Permission.IncidentMember}:`,
        `${Permission.MonitorViewer}:${PRODUCTION.toString()}`,
      ]);
    });

    test.each([
      [
        "a permission the giver does not hold",
        roleRow(Permission.AlertMember, PermissionScope.All),
        Permission.AlertMember,
      ],
      [
        "a label the giver does not reach",
        roleRow(Permission.MonitorViewer, PermissionScope.Labels, [STAGING]),
        Permission.MonitorViewer,
      ],
      [
        "the whole project where the giver holds one label",
        roleRow(Permission.MonitorViewer, PermissionScope.All),
        Permission.MonitorViewer,
      ],
    ])(
      "a role holding %s is refused, in words that name the role and the permission",
      async (
        _case: string,
        row: CustomRolePermission,
        permission: Permission,
      ) => {
        rolePermissions = [
          roleRow(Permission.IncidentMember, PermissionScope.All),
          row,
        ];

        const refusal: Error = await refusalOf(() => {
          return callHook(
            ApiKeyCustomRoleService,
            "onBeforeCreate",
            giving(keyEditor),
          );
        });

        expect(refusal).toBeInstanceOf(NotAuthorizedException);
        expect(refusal.message).toBe(
          getCustomRoleGrantRefusedMessage({
            roleName: "Incident Responder",
            permission: permission,
          }),
        );
      },
    );

    test("a block on a permission of the role refuses it, as it refuses giving the key that permission", async () => {
      rolePermissions = [
        roleRow(Permission.IncidentMember, PermissionScope.All),
      ];

      const blocked: DatabaseCommonInteractionProps = propsHolding([
        grant(Permission.EditProjectApiKeyPermissions),
        grant(Permission.ReadProjectTeam),
        grant(Permission.IncidentMember),
        grant(Permission.IncidentMember, {
          isBlockPermission: true,
          scope: PermissionScope.Labels,
          labelIds: [STAGING],
        }),
      ]);

      const refusal: Error = await refusalOf(() => {
        return callHook(
          ApiKeyCustomRoleService,
          "onBeforeCreate",
          giving(blocked),
        );
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal.message).toContain("Incident Responder");
    });

    test("a project owner gives any role", async () => {
      rolePermissions = [
        roleRow(Permission.ProjectAdmin, PermissionScope.All),
        roleRow(Permission.MonitorAdmin, PermissionScope.Labels, [STAGING]),
      ];

      await expect(
        callHook(ApiKeyCustomRoleService, "onBeforeCreate", giving(owner)),
      ).resolves.toBeTruthy();
    });

    test("the role is read with the giver's own read of it, in the project of the request", async () => {
      rolePermissions = [];

      await callHook(
        ApiKeyCustomRoleService,
        "onBeforeCreate",
        giving(keyEditor),
      );

      expect(roleReads).toHaveLength(1);
      expect(roleReads[0]!.props.isRoot).toBeFalsy();
      expect(roleReads[0]!.props.userTenantAccessPermission).toBe(
        keyEditor.userTenantAccessPermission,
      );
      expect(String(roleReads[0]!.props.tenantId)).toBe(PROJECT.toString());
      expect(String(roleReads[0]!.query.projectId)).toBe(PROJECT.toString());
    });

    test("someone who may change what a key can do, but not see the project's roles, gives none, in words that say so", async () => {
      const keysOnly: DatabaseCommonInteractionProps = propsHolding([
        grant(Permission.EditProjectApiKeyPermissions),
        grant(Permission.ReadProjectApiKey),
        grant(Permission.IncidentMember),
      ]);

      // The read the role is held to refuses them: no read permission of Custom Role is theirs.
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          CustomRole,
          keysOnly,
          DatabaseRequestType.Read,
        );
      }).toThrow(NotAuthorizedException);

      getJestSpyOn(CustomRoleService, "findOneBy").mockImplementation(
        async (findOneBy: FindOneBy<CustomRole>): Promise<CustomRole> => {
          TablePermission.checkTableLevelPermissions(
            CustomRole,
            findOneBy.props,
            DatabaseRequestType.Read,
          );
          return new CustomRole(ROLE);
        },
      );

      const refusal: Error = await refusalOf(() => {
        return callHook(
          ApiKeyCustomRoleService,
          "onBeforeCreate",
          giving(keysOnly),
        );
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal.message).toBe(CUSTOM_ROLE_NOT_READABLE_MESSAGE);
      expect(
        CustomRolePermissionService.findPermissionsOfRole,
      ).not.toHaveBeenCalled();
    });

    test("OneUptime and a master admin give any role of the project, read as OneUptime", async () => {
      rolePermissions = [roleRow(Permission.ProjectAdmin, PermissionScope.All)];

      for (const props of [
        { isRoot: true },
        {
          isMasterAdmin: true,
          userId: new ObjectID("7f000000-0000-4000-8000-000000000009"),
        },
      ] as Array<DatabaseCommonInteractionProps>) {
        roleReads = [];

        await expect(
          callHook(ApiKeyCustomRoleService, "onBeforeCreate", giving(props)),
        ).resolves.toBeTruthy();

        expect(roleReads[0]!.props).toEqual({ isRoot: true });
      }

      expect(
        CustomRolePermissionService.findPermissionsOfRole,
      ).not.toHaveBeenCalled();
    });
  });

  describe("a role and a key stay in their project", () => {
    test("another project's key is refused as one that does not exist", async () => {
      const refusal: Error = await refusalOf(() => {
        return callHook(
          ApiKeyCustomRoleService,
          "onBeforeCreate",
          giving(keyEditor, {
            apiKeyId: new ObjectID("7c000000-0000-4000-8000-0000000000ff"),
          }),
        );
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal.message).toBe("Invalid API Key ID for this project");
    });

    test("another project's role is refused as one that does not exist", async () => {
      const refusal: Error = await refusalOf(() => {
        return callHook(
          ApiKeyCustomRoleService,
          "onBeforeCreate",
          giving(keyEditor, {
            customRoleId: new ObjectID("7b000000-0000-4000-8000-0000000000ff"),
          }),
        );
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal.message).toBe("Invalid Custom Role ID");
    });

    test("a give into another project than the request's is refused", async () => {
      const elsewhere: DatabaseCommonInteractionProps = {
        ...keyEditor,
        tenantId: OTHER_PROJECT,
      };

      const refusal: Error = await refusalOf(() => {
        return callHook(
          ApiKeyCustomRoleService,
          "onBeforeCreate",
          giving(elsewhere, { projectId: undefined }),
        );
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal.message).toBe("Invalid API Key ID for this project");
    });

    test.each([
      [
        "apiKeyId",
        "API Key ID is required to give a custom role to an API key.",
      ],
      [
        "customRoleId",
        "Custom Role ID is required to give a custom role to an API key.",
      ],
    ])(
      "a give with no %s is refused",
      async (missing: string, message: string) => {
        const refusal: Error = await refusalOf(() => {
          return callHook(
            ApiKeyCustomRoleService,
            "onBeforeCreate",
            giving(keyEditor, { [missing]: undefined }),
          );
        });

        expect(refusal).toBeInstanceOf(BadDataException);
        expect(refusal.message).toBe(message);
      },
    );

    test("a give with no project at all is refused", async () => {
      const refusal: Error = await refusalOf(() => {
        return callHook(
          ApiKeyCustomRoleService,
          "onBeforeCreate",
          giving({ isRoot: true }, { projectId: undefined }),
        );
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal.message).toBe(
        "Project ID is required to give a custom role to an API key.",
      );
    });
  });

  describe("once a role is given", () => {
    test("the key's copies are made by the sync", async () => {
      const created: ApiKeyCustomRole = new ApiKeyCustomRole(GIVEN);
      created.projectId = PROJECT;
      created.customRoleId = ROLE;
      created.apiKeyId = KEY;

      const sync: jest.SpyInstance = getJestSpyOn(
        CustomRoleSync,
        "syncRoles",
      ).mockResolvedValue([]);
      const deleteBy: jest.SpyInstance = getJestSpyOn(
        ApiKeyCustomRoleService,
        "deleteBy",
      ).mockResolvedValue(1);

      await expect(
        callHook(
          ApiKeyCustomRoleService,
          "onCreateSuccess",
          { createBy: { data: created, props: keyEditor }, carryForward: null },
          created,
        ),
      ).resolves.toBe(created);

      expect(sync).toHaveBeenCalledWith({
        projectId: PROJECT,
        customRoleIds: [ROLE],
      });
      expect(deleteBy).not.toHaveBeenCalled();
    });

    test("when the copies cannot be made, the role is taken from the key again, every server forgets the key's permissions, and the give is refused", async () => {
      const created: ApiKeyCustomRole = new ApiKeyCustomRole(GIVEN);
      created.projectId = PROJECT;
      created.customRoleId = ROLE;
      created.apiKeyId = KEY;

      const failure: Error = new Error("could not write the copies");
      getJestSpyOn(CustomRoleSync, "syncRoles").mockRejectedValue(failure);
      const deleteBy: jest.SpyInstance = getJestSpyOn(
        ApiKeyCustomRoleService,
        "deleteBy",
      ).mockResolvedValue(1);

      await expect(
        callHook(
          ApiKeyCustomRoleService,
          "onCreateSuccess",
          { createBy: { data: created, props: keyEditor }, carryForward: null },
          created,
        ),
      ).rejects.toBe(failure);

      const undo: DeleteBy<ApiKeyCustomRole> = deleteBy.mock
        .calls[0]![0] as DeleteBy<ApiKeyCustomRole>;
      expect(String(undo.query._id)).toBe(GIVEN.toString());
      expect(String(undo.query.projectId)).toBe(PROJECT.toString());
      expect(undo.props).toEqual({ isRoot: true, ignoreHooks: true });
      expect(
        ApiKeyPermissionService.forgetPermissionsOfProjects,
      ).toHaveBeenCalledWith([PROJECT]);
    });
  });

  describe("taking a role from a key", () => {
    test("reads the rows it removes, held to them, and every server forgets the keys' permissions once they are gone", async () => {
      const row: ApiKeyCustomRole = new ApiKeyCustomRole(GIVEN);
      row.projectId = PROJECT;
      row.apiKeyId = KEY;

      const held: jest.SpyInstance = getJestSpyOn(
        ApiKeyCustomRoleService,
        "findRowsAndHoldDeleteToThem",
      ).mockResolvedValue([row]);

      const deleteBy: DeleteBy<ApiKeyCustomRole> = {
        query: { _id: GIVEN },
        limit: 1,
        skip: 0,
        props: keyEditor,
      };

      const onDelete: { carryForward: unknown } = (await callHook(
        ApiKeyCustomRoleService,
        "onBeforeDelete",
        deleteBy,
      )) as { carryForward: unknown };

      expect(held).toHaveBeenCalledTimes(1);

      await callHook(
        ApiKeyCustomRoleService,
        "onDeleteSuccess",
        { deleteBy: deleteBy, carryForward: onDelete.carryForward },
        [GIVEN],
      );

      expect(
        ApiKeyPermissionService.forgetPermissionsOfProjects,
      ).toHaveBeenCalledWith([PROJECT]);
    });

    test("a row of another project than the request's is not taken away", async () => {
      const row: ApiKeyCustomRole = new ApiKeyCustomRole(GIVEN);
      row.projectId = OTHER_PROJECT;
      row.apiKeyId = KEY;

      getJestSpyOn(
        ApiKeyCustomRoleService,
        "findRowsAndHoldDeleteToThem",
      ).mockResolvedValue([row]);

      const refusal: Error = await refusalOf(() => {
        return callHook(ApiKeyCustomRoleService, "onBeforeDelete", {
          query: { _id: GIVEN },
          props: keyEditor,
        });
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
    });

    test("a delete that removed nothing forgets nothing", async () => {
      await callHook(
        ApiKeyCustomRoleService,
        "onDeleteSuccess",
        { deleteBy: { query: {}, props: keyEditor }, carryForward: null },
        [],
      );

      expect(
        ApiKeyPermissionService.forgetPermissionsOfProjects,
      ).toHaveBeenCalledWith([]);
    });
  });
});
