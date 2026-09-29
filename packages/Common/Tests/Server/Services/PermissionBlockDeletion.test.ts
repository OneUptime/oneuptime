import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return { __esModule: true, default: class PasswordHashStub {} };
});

/*
 * Removing a deny row can restore a more powerful allow row. Permission
 * editors must therefore be able to grant the complete stored authority they
 * unblock, even if the request supplies only an ID. Removing an allow row is
 * still revocation and must not acquire that extra grant requirement.
 *
 * Keep the actual permission checker and findAllBy pagination in the path;
 * only database reads and token refreshes are mocked. This catches a bulk
 * deletion whose first page is harmless but a later page removes a block.
 */
type PermissionRow = ApiKeyPermission | TeamPermission;

type PermissionUpdate = Omit<UpdateBy<PermissionRow>, "data"> & {
  data: {
    permission?: Permission;
    labels?: Array<Label>;
    isBlockPermission?: boolean;
  };
};

interface PermissionHooks {
  onBeforeDelete: (
    deleteBy: DeleteBy<PermissionRow>,
  ) => Promise<OnDelete<PermissionRow>>;
  onDeleteSuccess: (
    onDelete: OnDelete<PermissionRow>,
    itemIds: Array<ObjectID>,
  ) => Promise<OnDelete<PermissionRow>>;
  onBeforeUpdate: (
    updateBy: PermissionUpdate,
  ) => Promise<OnUpdate<PermissionRow>>;
}

interface PermissionServiceCase {
  name: string;
  service: typeof ApiKeyPermissionService | typeof TeamPermissionService;
  editor: Permission;
  isTeam: boolean;
}

interface RowOptions {
  permission?: Permission;
  labels?: Array<ObjectID>;
  scope?: PermissionScope;
  isBlockPermission?: boolean;
  project?: ObjectID;
  editable?: boolean;
}

const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const targetId: ObjectID = ObjectID.generate();
const labelA: ObjectID = ObjectID.generate();
const labelB: ObjectID = ObjectID.generate();
const labelC: ObjectID = ObjectID.generate();

function userPermission(
  permission: Permission,
  options: {
    labels?: Array<ObjectID>;
    scope?: PermissionScope;
    isBlockPermission?: boolean;
  } = {},
): UserPermission {
  return {
    permission,
    labelIds: options.labels || [],
    scope: options.scope,
    isBlockPermission: options.isBlockPermission || false,
    _type: "UserPermission",
  };
}

function props(
  permissions: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId,
    tenantId: projectId,
    userGlobalAccessPermission: {
      projectIds: [projectId],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId,
        permissions,
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function makeRow(
  serviceCase: PermissionServiceCase,
  options: RowOptions = {},
): PermissionRow {
  const row: PermissionRow = serviceCase.isTeam
    ? new TeamPermission()
    : new ApiKeyPermission();
  row.id = ObjectID.generate();
  row.projectId = options.project || projectId;
  row.permission = options.permission || Permission.TelemetryAdmin;
  row.isBlockPermission = options.isBlockPermission ?? true;
  row.labels = (options.labels || []).map((id: ObjectID): Label => {
    const label: Label = new Label();
    label.id = id;
    return label;
  });

  if (row instanceof TeamPermission) {
    row.teamId = targetId;
    row.scope =
      options.scope ??
      (row.labels.length > 0 ? PermissionScope.Labels : PermissionScope.All);
    row.team = new Team();
    row.team.id = targetId;
    row.team.isPermissionsEditable = options.editable ?? true;
  } else {
    row.apiKeyId = targetId;
  }

  return row;
}

function asNumber(value: number | PositiveNumber): number {
  return value instanceof PositiveNumber ? value.toNumber() : value;
}

function selectedIds(value: unknown): Array<string> | undefined {
  if (value instanceof FindOperator) {
    const parameters: Record<
      string,
      Array<string>
    > = value.objectLiteralParameters || {};
    return Object.values(parameters).flat();
  }

  if (value instanceof ObjectID || typeof value === "string") {
    return [value.toString()];
  }

  return undefined;
}

const serviceCases: Array<PermissionServiceCase> = [
  {
    name: "API key permissions",
    service: ApiKeyPermissionService,
    editor: Permission.EditProjectApiKeyPermissions,
    isTeam: false,
  },
  {
    name: "team permissions",
    service: TeamPermissionService,
    editor: Permission.EditProjectTeamPermissions,
    isTeam: true,
  },
];

describe.each(serviceCases)(
  "$name block removal",
  (serviceCase: PermissionServiceCase) => {
    const hooks: PermissionHooks =
      serviceCase.service as unknown as PermissionHooks;
    let rows: Array<PermissionRow>;
    let findPermissions: jest.SpyInstance;
    let findMembers: jest.SpyInstance;
    let refreshGlobal: jest.SpyInstance;
    let refreshTenant: jest.SpyInstance;

    function editorProps(
      permissions: Array<UserPermission> = [],
    ): DatabaseCommonInteractionProps {
      return props([
        userPermission(serviceCase.editor),
        userPermission(
          serviceCase.isTeam
            ? Permission.ReadProjectTeam
            : Permission.ReadProjectApiKey,
        ),
        ...permissions,
      ]);
    }

    async function deleteAs(
      callerProps: DatabaseCommonInteractionProps = editorProps(),
      options: { skip?: number; limit?: number } = {},
    ): Promise<OnDelete<PermissionRow>> {
      return await hooks.onBeforeDelete({
        query: { projectId },
        props: callerProps,
        skip: options.skip ?? 0,
        limit: options.limit ?? LIMIT_MAX,
      });
    }

    beforeEach(() => {
      rows = [makeRow(serviceCase)];
      ApiKeyPermissionService.clearCache();
      findPermissions = getJestSpyOn(
        serviceCase.service,
        "findBy",
      ).mockImplementation(
        async (
          findBy: FindBy<PermissionRow>,
        ): Promise<Array<PermissionRow>> => {
          const skip: number = asNumber(findBy.skip);
          const ids: Array<string> | undefined = selectedIds(findBy.query._id);
          const idSet: Set<string> = new Set<string>(ids || []);
          let matchingRows: Array<PermissionRow> = ids
            ? rows.filter((row: PermissionRow): boolean => {
                return idSet.has(row.id!.toString());
              })
            : rows;

          if (findBy.query.projectId instanceof ObjectID) {
            const queryProjectId: string = findBy.query.projectId.toString();
            matchingRows = matchingRows.filter(
              (row: PermissionRow): boolean => {
                return row.projectId!.toString() === queryProjectId;
              },
            );
          }

          if (findBy.query.labels) {
            // A relation-filtered SQL join returns only its matching labels.
            matchingRows = matchingRows.map((row: PermissionRow) => {
              return Object.assign(makeRow(serviceCase), row, {
                labels: row.labels?.filter((label: Label): boolean => {
                  return label.id!.toString() === labelA.toString();
                }),
              });
            });
          }

          return matchingRows.slice(skip, skip + asNumber(findBy.limit));
        },
      );
      getJestSpyOn(serviceCase.service, "findOneBy").mockResolvedValue(null);
      getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue({
        _id: targetId.toString(),
      } as never);
      findMembers = getJestSpyOn(TeamMemberService, "findBy").mockResolvedValue(
        [],
      );
      refreshGlobal = getJestSpyOn(
        AccessTokenService,
        "refreshUserGlobalAccessPermission",
      ).mockResolvedValue(undefined);
      refreshTenant = getJestSpyOn(
        AccessTokenService,
        "refreshUserTenantAccessPermission",
      ).mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      ApiKeyPermissionService.clearCache();
    });

    test("the permission editor cannot remove a block on authority it lacks", async () => {
      await expect(deleteAs()).rejects.toBeInstanceOf(NotAuthorizedException);
      expect(findMembers).not.toHaveBeenCalled();
      expect(refreshGlobal).not.toHaveBeenCalled();
      expect(refreshTenant).not.toHaveBeenCalled();
    });

    test.each([
      Permission.ProjectOwner,
      Permission.DeleteProject,
      Permission.ManageProjectBilling,
    ])(
      "ProjectAdmin cannot unblock the separately held %s authority",
      async (permission: Permission) => {
        rows = [makeRow(serviceCase, { permission })];
        await expect(
          deleteAs(props([userPermission(Permission.ProjectAdmin)])),
        ).rejects.toBeInstanceOf(NotAuthorizedException);
      },
    );

    test("ProjectAdmin may unblock an exact permission it separately holds", async () => {
      rows = [makeRow(serviceCase, { permission: Permission.DeleteProject })];
      await expect(
        deleteAs(
          props([
            userPermission(Permission.ProjectAdmin),
            userPermission(Permission.DeleteProject),
          ]),
        ),
      ).resolves.toBeDefined();
    });

    test("an owner may remove a block on any permission", async () => {
      rows = [makeRow(serviceCase, { permission: Permission.DeleteProject })];
      await expect(
        deleteAs(props([userPermission(Permission.ProjectOwner)])),
      ).resolves.toBeDefined();
    });

    test.each([{ isRoot: true }, { isMasterAdmin: true }])(
      "maintenance authority %j remains available",
      async (callerProps: DatabaseCommonInteractionProps) => {
        rows = [makeRow(serviceCase, { permission: Permission.ProjectOwner })];
        await expect(deleteAs(callerProps)).resolves.toBeDefined();
      },
    );

    test("an editor may revoke an allow it could not grant", async () => {
      rows = [
        makeRow(serviceCase, {
          permission: Permission.ProjectOwner,
          isBlockPermission: false,
        }),
      ];
      await expect(deleteAs()).resolves.toBeDefined();
    });

    test("an editor holding the exact unscoped permission may remove its block", async () => {
      await expect(
        deleteAs(editorProps([userPermission(Permission.TelemetryAdmin)])),
      ).resolves.toBeDefined();
    });

    test("a caller's own global block overrides its matching allow", async () => {
      await expect(
        deleteAs(
          editorProps([
            userPermission(Permission.TelemetryAdmin),
            userPermission(Permission.TelemetryAdmin, {
              isBlockPermission: true,
            }),
          ]),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("a blocked ProjectOwner allow cannot bypass the ceiling", async () => {
      await expect(
        deleteAs(
          editorProps([
            userPermission(Permission.ProjectOwner),
            userPermission(Permission.ProjectOwner, {
              isBlockPermission: true,
            }),
          ]),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("a label-scoped ProjectOwner allow is not a project-wide override", async () => {
      await expect(
        deleteAs(
          editorProps([
            userPermission(Permission.ProjectOwner, {
              labels: [labelA],
              scope: PermissionScope.Labels,
            }),
          ]),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("a saved block within the caller's labels may be removed", async () => {
      rows = [makeRow(serviceCase, { labels: [labelA] })];
      await expect(
        deleteAs(
          editorProps([
            userPermission(Permission.TelemetryAdmin, {
              labels: [labelA, labelB],
              scope: PermissionScope.Labels,
            }),
          ]),
        ),
      ).resolves.toBeDefined();
    });

    test.each([
      { name: "unscoped", labels: [] },
      { name: "another label", labels: [labelB] },
      { name: "mixed labels", labels: [labelA, labelB] },
    ])(
      "label authority cannot remove a saved block covering $name",
      async ({ labels }: { labels: Array<ObjectID> }) => {
        rows = [makeRow(serviceCase, { labels })];
        await expect(
          deleteAs(
            editorProps([
              userPermission(Permission.TelemetryAdmin, {
                labels: [labelA],
                scope: PermissionScope.Labels,
              }),
            ]),
          ),
        ).rejects.toBeInstanceOf(NotAuthorizedException);
      },
    );

    test("a caller's label block prevents restoring that label", async () => {
      rows = [makeRow(serviceCase, { labels: [labelA, labelB] })];
      await expect(
        deleteAs(
          editorProps([
            userPermission(Permission.TelemetryAdmin),
            userPermission(Permission.TelemetryAdmin, {
              labels: [labelB],
              scope: PermissionScope.Labels,
              isBlockPermission: true,
            }),
          ]),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("a disjoint caller label block leaves other labels available", async () => {
      rows = [makeRow(serviceCase, { labels: [labelA] })];
      await expect(
        deleteAs(
          editorProps([
            userPermission(Permission.TelemetryAdmin),
            userPermission(Permission.TelemetryAdmin, {
              labels: [labelB],
              scope: PermissionScope.Labels,
              isBlockPermission: true,
            }),
          ]),
        ),
      ).resolves.toBeDefined();
    });

    test("even a partial caller block prevents restoring unscoped authority", async () => {
      await expect(
        deleteAs(
          editorProps([
            userPermission(Permission.TelemetryAdmin),
            userPermission(Permission.TelemetryAdmin, {
              labels: [labelC],
              scope: PermissionScope.Labels,
              isBlockPermission: true,
            }),
          ]),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("Owned authority cannot be used to restore another principal's access", async () => {
      rows = [makeRow(serviceCase, { labels: [labelA] })];
      await expect(
        deleteAs(
          editorProps([
            userPermission(Permission.TelemetryAdmin, {
              scope: PermissionScope.Owned,
            }),
          ]),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test.each([true, false])(
      "rows in another project are excluded before validation (block=%s)",
      async (isBlockPermission: boolean) => {
        rows = [
          makeRow(serviceCase, { project: otherProjectId, isBlockPermission }),
        ];
        const result: OnDelete<PermissionRow> = await hooks.onBeforeDelete({
          query: { projectId: otherProjectId },
          skip: 0,
          limit: 1,
          props: props([userPermission(Permission.ProjectOwner)]),
        });
        expect(selectedIds(result.deleteBy.query._id)).toEqual([]);
        expect(findPermissions).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.objectContaining({ projectId }),
          }),
        );
        expect(findMembers).not.toHaveBeenCalled();
      },
    );

    test("matching grant authority does not replace permission-management access", async () => {
      await expect(
        deleteAs(props([userPermission(Permission.TelemetryAdmin)])),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
      expect(findPermissions).not.toHaveBeenCalled();
    });

    test("a query with no matches remains a no-op", async () => {
      rows = [];
      const result: OnDelete<PermissionRow> = await deleteAs();
      expect(selectedIds(result.deleteBy.query._id)).toEqual([]);
      expect(findMembers).not.toHaveBeenCalled();
    });

    test("an authorized first row cannot hide an unauthorized later block", async () => {
      rows = [
        makeRow(serviceCase, { isBlockPermission: false }),
        makeRow(serviceCase, { permission: Permission.ProjectOwner }),
      ];
      await expect(deleteAs()).rejects.toBeInstanceOf(NotAuthorizedException);
      expect(findMembers).not.toHaveBeenCalled();
    });

    test("a block beyond the first database page is checked before any deletion", async () => {
      rows = [
        ...Array.from({ length: LIMIT_MAX }, (): PermissionRow => {
          return makeRow(serviceCase, { isBlockPermission: false });
        }),
        makeRow(serviceCase, { permission: Permission.ProjectOwner }),
      ];
      await expect(
        deleteAs(editorProps(), { limit: LIMIT_MAX + 1 }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
      expect(findPermissions).toHaveBeenCalledWith(
        expect.objectContaining({ skip: LIMIT_MAX }),
      );
      expect(findMembers).not.toHaveBeenCalled();
    });

    test("validation honors the selected delete page and pins its exact IDs", async () => {
      const selected: PermissionRow = makeRow(serviceCase, {
        isBlockPermission: false,
      });
      rows = [makeRow(serviceCase), selected, makeRow(serviceCase)];
      const result: OnDelete<PermissionRow> = await deleteAs(editorProps(), {
        skip: 1,
        limit: 1,
      });
      expect(selectedIds(result.deleteBy.query._id)).toEqual([
        selected.id!.toString(),
      ]);
      expect(asNumber(result.deleteBy.skip)).toBe(0);
      expect(asNumber(result.deleteBy.limit)).toBe(1);
    });

    test("validation reads the saved permission, block flag, and full labels", async () => {
      await deleteAs(editorProps([userPermission(Permission.TelemetryAdmin)]));
      expect(findPermissions).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            permission: true,
            isBlockPermission: true,
            labels: { _id: true },
          }),
        }),
      );
    });

    test("root validation reads do not elevate the eventual delete or discard its reason", async () => {
      rows = [makeRow(serviceCase, { isBlockPermission: false })];
      const callerProps: DatabaseCommonInteractionProps = editorProps();
      const result: OnDelete<PermissionRow> = await hooks.onBeforeDelete({
        query: { projectId },
        skip: 0,
        limit: 1,
        props: callerProps,
        deletionReason: "Revoke the old grant",
      });
      expect(result.deleteBy.props).toBe(callerProps);
      expect(result.deleteBy.props.isRoot).toBeUndefined();
      expect(result.deleteBy.props.isMasterAdmin).toBeUndefined();
      expect(result.deleteBy.deletionReason).toBe("Revoke the old grant");
    });

    test("a label filter cannot hide the rest of the stored block during deletion", async () => {
      rows = [makeRow(serviceCase, { labels: [labelA, labelB] })];
      await expect(
        hooks.onBeforeDelete({
          query: { labels: [{ _id: labelA.toString() }] },
          skip: 0,
          limit: 1,
          props: editorProps([
            userPermission(Permission.TelemetryAdmin, {
              labels: [labelA],
              scope: PermissionScope.Labels,
            }),
          ]),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("changing a powerful block into an unrelated weaker block cannot erase the old restriction", async () => {
      rows = [makeRow(serviceCase, { permission: Permission.ProjectOwner })];
      await expect(
        hooks.onBeforeUpdate({
          query: { _id: rows[0]!.id! },
          data: { permission: Permission.TelemetryAdmin },
          skip: 0,
          limit: 1,
          props: editorProps([userPermission(Permission.TelemetryAdmin)]),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("narrowing a block cannot remove restrictions beyond the caller's labels", async () => {
      rows = [makeRow(serviceCase, { labels: [labelA, labelB] })];
      const label: Label = new Label();
      label.id = labelA;
      await expect(
        hooks.onBeforeUpdate({
          query: { _id: rows[0]!.id! },
          data: { labels: [label] },
          skip: 0,
          limit: 1,
          props: editorProps([
            userPermission(Permission.TelemetryAdmin, {
              labels: [labelA],
              scope: PermissionScope.Labels,
            }),
          ]),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("a label-filtered update must still check the complete stored block", async () => {
      rows = [makeRow(serviceCase, { labels: [labelA, labelB] })];
      await expect(
        hooks.onBeforeUpdate({
          query: { labels: [{ _id: labelA.toString() }] },
          data: { isBlockPermission: false },
          skip: 0,
          limit: 1,
          props: editorProps([
            userPermission(Permission.TelemetryAdmin, {
              labels: [labelA],
              scope: PermissionScope.Labels,
            }),
          ]),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("update validation honors its selected page and pins its exact IDs", async () => {
      const selected: PermissionRow = makeRow(serviceCase, {
        isBlockPermission: false,
      });
      rows = [
        makeRow(serviceCase, { permission: Permission.ProjectOwner }),
        selected,
        makeRow(serviceCase, { permission: Permission.ProjectOwner }),
      ];

      const result: OnUpdate<PermissionRow> = await hooks.onBeforeUpdate({
        query: { projectId },
        data: { isBlockPermission: true },
        skip: 1,
        limit: 1,
        props: editorProps([userPermission(Permission.TelemetryAdmin)]),
      });
      expect(selectedIds(result.updateBy.query._id)).toEqual([
        selected.id!.toString(),
      ]);
      expect(asNumber(result.updateBy.skip)).toBe(0);
      expect(asNumber(result.updateBy.limit)).toBe(1);
    });

    test("an update cannot rewrite a stronger block beyond its first database page", async () => {
      rows = [
        ...Array.from({ length: LIMIT_MAX }, (): PermissionRow => {
          return makeRow(serviceCase, { isBlockPermission: false });
        }),
        makeRow(serviceCase, { permission: Permission.ProjectOwner }),
      ];
      await expect(
        hooks.onBeforeUpdate({
          query: { projectId },
          data: { permission: Permission.TelemetryAdmin },
          skip: 0,
          limit: LIMIT_MAX + 1,
          props: editorProps([userPermission(Permission.TelemetryAdmin)]),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    if (serviceCase.isTeam) {
      test.each([true, false])(
        "noneditable team protections remain enforced (block=%s)",
        async (isBlockPermission: boolean) => {
          rows = [makeRow(serviceCase, { editable: false, isBlockPermission })];
          await expect(
            deleteAs(props([userPermission(Permission.ProjectOwner)])),
          ).rejects.toBeInstanceOf(BadDataException);
          expect(findMembers).not.toHaveBeenCalled();
        },
      );

      test("explicit All scope is not narrowed by labels left on the stored block", async () => {
        rows = [
          makeRow(serviceCase, {
            scope: PermissionScope.All,
            labels: [labelA],
          }),
        ];
        await expect(
          deleteAs(
            editorProps([
              userPermission(Permission.TelemetryAdmin, {
                labels: [labelA],
                scope: PermissionScope.Labels,
              }),
            ]),
          ),
        ).rejects.toBeInstanceOf(NotAuthorizedException);
      });

      test("successful deletion refreshes both permission caches for affected members", async () => {
        rows = [makeRow(serviceCase, { isBlockPermission: false })];
        const member: TeamMember = new TeamMember();
        member.userId = userId;
        member.projectId = projectId;
        findMembers.mockResolvedValue([member]);

        const result: OnDelete<PermissionRow> = await deleteAs();
        expect(refreshGlobal).not.toHaveBeenCalled();
        expect(refreshTenant).not.toHaveBeenCalled();
        await hooks.onDeleteSuccess(result, [rows[0]!.id!]);

        expect(refreshGlobal).toHaveBeenCalledWith(userId);
        expect(refreshTenant).toHaveBeenCalledWith(userId, projectId);
        expect(findMembers).toHaveBeenCalledWith(
          expect.objectContaining({
            query: { teamId: targetId, projectId },
          }),
        );
      });
    } else {
      test("permission cache is invalidated before and after a permitted delete", async () => {
        rows = [makeRow(serviceCase, { isBlockPermission: false })];
        const clearCache: jest.SpyInstance = getJestSpyOn(
          ApiKeyPermissionService,
          "clearCache",
        );
        const result: OnDelete<PermissionRow> = await deleteAs();
        expect(clearCache).toHaveBeenCalledTimes(1);
        await hooks.onDeleteSuccess(result, [rows[0]!.id!]);
        expect(clearCache).toHaveBeenCalledTimes(2);
      });
    }
  },
);
