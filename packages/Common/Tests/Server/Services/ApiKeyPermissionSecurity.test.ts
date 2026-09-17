import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import Label from "../../../Models/DatabaseModels/Label";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. Nothing here touches password hashing; stub the module before the
 * service import graph drags it into compilation.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * Security regression for delegated API-key management.
 *
 * Creating an API key and deciding what that key may do are separate powers.
 * The old ApiKeyPermission ACL nevertheless admitted CreateProjectApiKey, so a
 * user trusted only to mint a key could attach ProjectOwner and come back as a
 * full owner. The service also trusted the request's projectId independently
 * of the referenced key, and the authorization hot path loaded grants by key
 * id alone. Together those gaps turned a narrow delegated capability into a
 * tenant-crossing privilege-minting primitive.
 *
 * This suite pins both layers. Model ACL tests prove the public CRUD endpoint
 * rejects create-only and metadata-edit callers. Hook tests prove that even an
 * alternate/internal caller which reaches the service cannot grant above its
 * own effective authority or point a permission row at another tenant's key.
 */

const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const apiKeyId: ObjectID = ObjectID.generate();
const otherApiKeyId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type HookCallable = {
  onBeforeCreate: (createBy: unknown) => Promise<unknown>;
  onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
};

function hooks(): HookCallable {
  return ApiKeyPermissionService as unknown as HookCallable;
}

function userPermission(data: {
  permission: Permission;
  labels?: Array<ObjectID>;
  isBlockPermission?: boolean;
  scope?: PermissionScope;
}): UserPermission {
  return {
    permission: data.permission,
    labelIds: data.labels || [],
    isBlockPermission: data.isBlockPermission || false,
    scope: data.scope,
    _type: "UserPermission",
  };
}

function props(
  permissions: Array<UserPermission>,
  tenantId: ObjectID = projectId,
): DatabaseCommonInteractionProps {
  return {
    userId,
    tenantId,
    userGlobalAccessPermission: {
      projectIds: [tenantId],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [tenantId.toString()]: {
        projectId: tenantId,
        permissions,
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function label(labelId: ObjectID): Label {
  const value: Label = new Label();
  value.id = labelId;
  return value;
}

function permissionRow(
  data: {
    permission?: Permission;
    project?: ObjectID;
    key?: ObjectID;
    labels?: Array<ObjectID>;
    isBlockPermission?: boolean;
  } = {},
): ApiKeyPermission {
  const row: ApiKeyPermission = new ApiKeyPermission();
  row.id = ObjectID.generate();
  row.projectId = data.project || projectId;
  row.apiKeyId = data.key || apiKeyId;
  row.permission = data.permission || Permission.TelemetryAdmin;
  row.labels = (data.labels || []).map(label);
  row.isBlockPermission = data.isBlockPermission || false;
  return row;
}

describe("ApiKeyPermission delegated-management ACL", () => {
  const model: ApiKeyPermission = new ApiKeyPermission();

  test("creation is limited to owners, admins, and the dedicated permission editor", () => {
    expect(model.createRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ]);
    expect(model.createRecordPermissions).not.toContain(
      Permission.CreateProjectApiKey,
    );
  });

  test("updates cannot be made with the API-key metadata editor", () => {
    expect(model.updateRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ]);
    expect(model.updateRecordPermissions).not.toContain(
      Permission.EditProjectApiKey,
    );
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditProjectApiKeyPermissions,
  ])("%s passes the table-level create gate", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        ApiKeyPermission,
        props([userPermission({ permission })]),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test("CreateProjectApiKey alone fails the table-level create gate", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        ApiKeyPermission,
        props([userPermission({ permission: Permission.CreateProjectApiKey })]),
        DatabaseRequestType.Create,
      );
    }).toThrow(NotAuthorizedException);
  });

  test("EditProjectApiKey alone fails the table-level update gate", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        ApiKeyPermission,
        props([userPermission({ permission: Permission.EditProjectApiKey })]),
        DatabaseRequestType.Update,
      );
    }).toThrow(NotAuthorizedException);
  });

  test("no grant-bearing column reintroduces the create-only or metadata-edit capabilities", () => {
    for (const columnName of [
      "apiKey",
      "apiKeyId",
      "project",
      "projectId",
      "permission",
      "labels",
      "isBlockPermission",
    ]) {
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(columnName);
      expect(accessControl?.create || []).not.toContain(
        Permission.CreateProjectApiKey,
      );
    }

    for (const columnName of ["permission", "labels", "isBlockPermission"]) {
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(columnName);
      expect(accessControl?.update || []).not.toContain(
        Permission.EditProjectApiKey,
      );
    }
  });
});

describe("ApiKeyPermissionService create boundaries", () => {
  let findApiKey: jest.SpyInstance;
  let findPermission: jest.SpyInstance;

  beforeEach(() => {
    ApiKeyPermissionService.clearCache();
    findApiKey = getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue({
      _id: apiKeyId.toString(),
    } as never);
    findPermission = getJestSpyOn(
      ApiKeyPermissionService,
      "findOneBy",
    ).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createAs(
    callerProps: DatabaseCommonInteractionProps,
    row: ApiKeyPermission = permissionRow(),
  ): Promise<unknown> {
    return await hooks().onBeforeCreate({
      data: row,
      props: callerProps,
    });
  }

  test("an owner may grant ProjectOwner", async () => {
    await expect(
      createAs(
        props([userPermission({ permission: Permission.ProjectOwner })]),
        permissionRow({ permission: Permission.ProjectOwner }),
      ),
    ).resolves.toBeDefined();
  });

  test("a project admin may delegate the ProjectAdmin authority it holds", async () => {
    await expect(
      createAs(
        props([userPermission({ permission: Permission.ProjectAdmin })]),
        permissionRow({ permission: Permission.ProjectAdmin }),
      ),
    ).resolves.toBeDefined();
  });

  test.each([
    Permission.ProjectOwner,
    Permission.DeleteProject,
    Permission.ManageProjectBilling,
  ])(
    "a project admin cannot mint the separately-gated %s authority",
    async (permission: Permission) => {
      await expect(
        createAs(
          props([userPermission({ permission: Permission.ProjectAdmin })]),
          permissionRow({ permission }),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("a project admin may delegate DeleteProject only when it is separately held", async () => {
    await expect(
      createAs(
        props([
          userPermission({ permission: Permission.ProjectAdmin }),
          userPermission({ permission: Permission.DeleteProject }),
        ]),
        permissionRow({ permission: Permission.DeleteProject }),
      ),
    ).resolves.toBeDefined();
  });

  test("a granular editor may delegate a permission it also holds", async () => {
    await expect(
      createAs(
        props([
          userPermission({
            permission: Permission.EditProjectApiKeyPermissions,
          }),
          userPermission({ permission: Permission.TelemetryAdmin }),
        ]),
      ),
    ).resolves.toBeDefined();
  });

  test("the granular editor alone cannot delegate a permission it lacks", async () => {
    await expect(
      createAs(
        props([
          userPermission({
            permission: Permission.EditProjectApiKeyPermissions,
          }),
        ]),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a blocked permission does not count as authority to delegate it", async () => {
    await expect(
      createAs(
        props([
          userPermission({
            permission: Permission.EditProjectApiKeyPermissions,
          }),
          userPermission({ permission: Permission.TelemetryAdmin }),
          userPermission({
            permission: Permission.TelemetryAdmin,
            isBlockPermission: true,
          }),
        ]),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a label-scoped permission can be delegated to a subset of its labels", async () => {
    const allowedLabelId: ObjectID = ObjectID.generate();
    await expect(
      createAs(
        props([
          userPermission({
            permission: Permission.EditProjectApiKeyPermissions,
          }),
          userPermission({
            permission: Permission.TelemetryAdmin,
            labels: [allowedLabelId, ObjectID.generate()],
            scope: PermissionScope.Labels,
          }),
        ]),
        permissionRow({ labels: [allowedLabelId] }),
      ),
    ).resolves.toBeDefined();
  });

  test("a label-scoped permission cannot be widened to an unscoped grant", async () => {
    await expect(
      createAs(
        props([
          userPermission({
            permission: Permission.EditProjectApiKeyPermissions,
          }),
          userPermission({
            permission: Permission.TelemetryAdmin,
            labels: [ObjectID.generate()],
            scope: PermissionScope.Labels,
          }),
        ]),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a label-scoped permission cannot be delegated to a label the caller lacks", async () => {
    await expect(
      createAs(
        props([
          userPermission({
            permission: Permission.EditProjectApiKeyPermissions,
          }),
          userPermission({
            permission: Permission.TelemetryAdmin,
            labels: [ObjectID.generate()],
            scope: PermissionScope.Labels,
          }),
        ]),
        permissionRow({ labels: [ObjectID.generate()] }),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a label block prevents delegating that label while leaving other labels available", async () => {
    const allowedLabelId: ObjectID = ObjectID.generate();
    const blockedLabelId: ObjectID = ObjectID.generate();
    const callerProps: DatabaseCommonInteractionProps = props([
      userPermission({
        permission: Permission.EditProjectApiKeyPermissions,
      }),
      userPermission({
        permission: Permission.TelemetryAdmin,
        scope: PermissionScope.All,
      }),
      userPermission({
        permission: Permission.TelemetryAdmin,
        labels: [blockedLabelId],
        isBlockPermission: true,
        scope: PermissionScope.Labels,
      }),
    ]);

    await expect(
      createAs(callerProps, permissionRow({ labels: [allowedLabelId] })),
    ).resolves.toBeDefined();
    await expect(
      createAs(callerProps, permissionRow({ labels: [blockedLabelId] })),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("Owned authority cannot be converted into an API-key-wide grant", async () => {
    await expect(
      createAs(
        props([
          userPermission({
            permission: Permission.EditProjectApiKeyPermissions,
          }),
          userPermission({
            permission: Permission.TelemetryAdmin,
            scope: PermissionScope.Owned,
          }),
        ]),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("root maintenance still bypasses the delegation ceiling", async () => {
    await expect(
      createAs(
        { isRoot: true },
        permissionRow({ permission: Permission.ProjectOwner }),
      ),
    ).resolves.toBeDefined();
  });

  test("the referenced API key is resolved by id and project together", async () => {
    await createAs(
      props([userPermission({ permission: Permission.ProjectOwner })]),
    );

    const options: Record<string, any> = findApiKey.mock.calls[0]![0] as Record<
      string,
      any
    >;
    expect(options["query"]["_id"].toString()).toBe(apiKeyId.toString());
    expect(options["query"]["projectId"].toString()).toBe(projectId.toString());
    expect(options["props"]["isRoot"]).toBe(true);
  });

  test("relation-only references are canonicalized to validated scalar IDs before persistence", async () => {
    const row: ApiKeyPermission = permissionRow();
    delete row.apiKeyId;
    delete row.projectId;
    row.apiKey = { id: apiKeyId } as never;
    row.project = { id: projectId } as never;

    await createAs(
      props([userPermission({ permission: Permission.ProjectOwner })]),
      row,
    );

    expect((row.apiKeyId as ObjectID | undefined)?.toString()).toBe(
      apiKeyId.toString(),
    );
    expect((row.projectId as ObjectID | undefined)?.toString()).toBe(
      projectId.toString(),
    );
    expect(row.apiKey).toBeUndefined();
    expect(row.project).toBeUndefined();
    expect(findApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: apiKeyId,
          projectId,
        },
      }),
    );
  });

  test("a conflicting API key relation cannot override the validated scalar ID", async () => {
    const row: ApiKeyPermission = permissionRow();
    row.apiKey = { id: otherApiKeyId } as never;

    await expect(
      createAs(
        props([userPermission({ permission: Permission.ProjectOwner })]),
        row,
      ),
    ).rejects.toThrow("Conflicting API Key references");
    expect(findApiKey).not.toHaveBeenCalled();
    expect(findPermission).not.toHaveBeenCalled();
  });

  test("a conflicting project relation cannot override the request tenant during persistence", async () => {
    const row: ApiKeyPermission = permissionRow();
    row.project = { id: otherProjectId } as never;

    await expect(
      createAs(
        props([userPermission({ permission: Permission.ProjectOwner })]),
        row,
      ),
    ).rejects.toThrow("Conflicting Project references");
    expect(findApiKey).not.toHaveBeenCalled();
    expect(findPermission).not.toHaveBeenCalled();
  });

  test("a key id from another project is rejected before duplicate checks", async () => {
    findApiKey.mockResolvedValue(null);

    await expect(
      createAs(
        props([userPermission({ permission: Permission.ProjectOwner })]),
      ),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(findPermission).not.toHaveBeenCalled();
  });

  test("a body project cannot differ from the authenticated request tenant", async () => {
    await expect(
      createAs(
        props(
          [userPermission({ permission: Permission.ProjectOwner })],
          projectId,
        ),
        permissionRow({ project: otherProjectId }),
      ),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(findApiKey).not.toHaveBeenCalled();
  });

  test("an existing allow/block tuple remains a duplicate within this project", async () => {
    findPermission.mockResolvedValue(permissionRow() as never);

    await expect(
      createAs(
        props([userPermission({ permission: Permission.ProjectOwner })]),
      ),
    ).rejects.toThrow("already assigned");

    const options: Record<string, any> = findPermission.mock
      .calls[0]![0] as Record<string, any>;
    expect(options["query"]["apiKeyId"].toString()).toBe(apiKeyId.toString());
    expect(options["query"]["projectId"].toString()).toBe(projectId.toString());
    expect(options["query"]["permission"]).toBe(Permission.TelemetryAdmin);
    expect(options["query"]["isBlockPermission"]).toBe(false);
  });

  test("the opposite allow/block tuple is not treated as a duplicate", async () => {
    await expect(
      createAs(
        props([userPermission({ permission: Permission.ProjectOwner })]),
        permissionRow({ isBlockPermission: true }),
      ),
    ).resolves.toBeDefined();

    const options: Record<string, any> = findPermission.mock
      .calls[0]![0] as Record<string, any>;
    expect(options["query"]["isBlockPermission"]).toBe(true);
  });
});

describe("ApiKeyPermissionService update boundaries", () => {
  let findApiKey: jest.SpyInstance;
  let findPermissions: jest.SpyInstance;
  let findPermission: jest.SpyInstance;

  beforeEach(() => {
    findApiKey = getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue({
      _id: apiKeyId.toString(),
    } as never);
    findPermissions = getJestSpyOn(
      ApiKeyPermissionService,
      "findBy",
    ).mockResolvedValue([permissionRow()] as never);
    findPermission = getJestSpyOn(
      ApiKeyPermissionService,
      "findOneBy",
    ).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("changing a grant to ProjectOwner is denied to a project admin", async () => {
    await expect(
      hooks().onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { permission: Permission.ProjectOwner },
        props: props([userPermission({ permission: Permission.ProjectAdmin })]),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(findPermission).not.toHaveBeenCalled();
  });

  test("an editor may narrow a grant to a label it holds", async () => {
    const allowedLabelId: ObjectID = ObjectID.generate();
    findPermissions.mockResolvedValue([
      permissionRow({ labels: [allowedLabelId] }),
    ] as never);

    await expect(
      hooks().onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { labels: [label(allowedLabelId)] },
        props: props([
          userPermission({
            permission: Permission.EditProjectApiKeyPermissions,
          }),
          userPermission({
            permission: Permission.TelemetryAdmin,
            labels: [allowedLabelId],
            scope: PermissionScope.Labels,
          }),
        ]),
      }),
    ).resolves.toBeDefined();
  });

  test("an editor cannot clear labels and widen a scoped grant", async () => {
    const allowedLabelId: ObjectID = ObjectID.generate();
    findPermissions.mockResolvedValue([
      permissionRow({ labels: [allowedLabelId] }),
    ] as never);

    await expect(
      hooks().onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { labels: [] },
        props: props([
          userPermission({
            permission: Permission.EditProjectApiKeyPermissions,
          }),
          userPermission({
            permission: Permission.TelemetryAdmin,
            labels: [allowedLabelId],
            scope: PermissionScope.Labels,
          }),
        ]),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("an update cannot operate on a permission row from another request tenant", async () => {
    findPermissions.mockResolvedValue([
      permissionRow({ project: otherProjectId }),
    ] as never);

    await expect(
      hooks().onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { labels: [] },
        props: props(
          [userPermission({ permission: Permission.ProjectOwner })],
          projectId,
        ),
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(findApiKey).not.toHaveBeenCalled();
  });

  test("changing permission or block state rejects a duplicate tuple", async () => {
    findPermission.mockResolvedValue(permissionRow() as never);

    await expect(
      hooks().onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { isBlockPermission: false },
        props: props([userPermission({ permission: Permission.ProjectOwner })]),
      }),
    ).rejects.toThrow("already assigned");
  });
});
