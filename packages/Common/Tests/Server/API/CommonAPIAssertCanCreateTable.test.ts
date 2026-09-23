import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * CommonAPI.assertCanCreateTable: "could this caller create <model> through
 * its CRUD endpoint?", for custom routes whose side effect is only
 * acceptable from someone who could create that model anyway.
 *
 * The CRUD create has two table-level halves and both are applied: an Allow
 * grant from the model's create list, and no unlabelled team BLOCK row on
 * any permission in that list (a block overrides every Allow). Master
 * admins bypass both. It is the create twin of assertCanReadTable, and the
 * Slack / Microsoft Teams "Send Test" routes are its first callers: without
 * the block half, a member whose team is blocked from creating workspace
 * notification rules was refused by POST /workspace-notification-rule but
 * could still make OneUptime post into the workspace through those routes.
 *
 * WorkspaceNotificationRule is the main model under test because it is the
 * one those routes guard: ProjectMember and CreateWorkspaceNotificationRule
 * are on its create list, while Viewer and ReadWorkspaceNotificationRule are
 * only on its read list. StatusPageSubscriber is used where the create list
 * has to contain Permission.Public (anyone may subscribe to a status page).
 */

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(() => {
        return null;
      }),
      isConnected: jest.fn(() => {
        return false;
      }),
    },
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const LABEL_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

const CUSTOM_MESSAGE: string = "No rules for you.";

const GENERIC_MESSAGE: string =
  "You do not have permission to access this project's data.";

// The exact wording checkTableLevelBlockPermissions uses for a create.
const BLOCKED_MESSAGE: string =
  "You are not authorized to create Workspace Notification Rule because CreateWorkspaceNotificationRule is in your team's permission block list.";

function buildRow(data: {
  permission: Permission;
  isBlockPermission: boolean;
  labelIds?: Array<ObjectID> | undefined;
}): UserPermission {
  return {
    _type: "UserPermission",
    permission: data.permission,
    labelIds: data.labelIds || [],
    isBlockPermission: data.isBlockPermission,
  };
}

function buildPropsFromRows(
  rowsByProject: Array<{ projectId: ObjectID; rows: Array<UserPermission> }>,
): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  for (const entry of rowsByProject) {
    permissionMap[entry.projectId.toString()] = {
      _type: "UserTenantAccessPermission",
      projectId: entry.projectId,
      permissions: entry.rows,
    };
  }

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

function buildProps(data: {
  permissions?: Array<Permission> | undefined;
  blocks?: Array<Permission> | undefined;
  blockLabelIds?: Array<ObjectID> | undefined;
}): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = [
    ...(data.permissions || []).map(
      (permission: Permission): UserPermission => {
        return buildRow({ permission: permission, isBlockPermission: false });
      },
    ),
    ...(data.blocks || []).map((permission: Permission): UserPermission => {
      return buildRow({
        permission: permission,
        isBlockPermission: true,
        labelIds: data.blockLabelIds,
      });
    }),
  ];

  return buildPropsFromRows([{ projectId: PROJECT_ID, rows: rows }]);
}

function refusal(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  return undefined;
}

describe("CommonAPI.assertCanCreateTable", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("admits an Allow grant from the create list", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRule,
    ]) {
      expect(() => {
        CommonAPI.assertCanCreateTable({
          modelType: WorkspaceNotificationRule,
          props: buildProps({ permissions: [permission] }),
        });
      }).not.toThrow();
    }
  });

  test("refuses read-only and other non-create grants, with the caller's message", () => {
    for (const permissions of [
      [Permission.Viewer],
      [Permission.SettingsViewer],
      [Permission.ReadWorkspaceNotificationRule],
      [Permission.EditWorkspaceNotificationRule],
      [Permission.DeleteWorkspaceNotificationRule],
      [
        Permission.Viewer,
        Permission.SettingsViewer,
        Permission.ReadWorkspaceNotificationRule,
      ],
      [],
    ]) {
      const thrown: unknown = refusal(() => {
        CommonAPI.assertCanCreateTable({
          modelType: WorkspaceNotificationRule,
          props: buildProps({ permissions: permissions }),
          errorMessage: CUSTOM_MESSAGE,
        });
      });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect((thrown as Exception).message).toBe(CUSTOM_MESSAGE);
    }
  });

  test("uses the generic refusal when the caller gives no message", () => {
    const thrown: unknown = refusal(() => {
      CommonAPI.assertCanCreateTable({
        modelType: WorkspaceNotificationRule,
        props: buildProps({ permissions: [Permission.Viewer] }),
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Exception).message).toBe(GENERIC_MESSAGE);
  });

  test("reads the create list, not the read list", () => {
    /*
     * Viewer is on WorkspaceNotificationRule's read list, so the read twin
     * admits it; the create gate must not.
     */
    const props: DatabaseCommonInteractionProps = buildProps({
      permissions: [Permission.Viewer],
    });

    expect(() => {
      CommonAPI.assertCanReadTable({
        modelType: WorkspaceNotificationRule,
        props: props,
      });
    }).not.toThrow();

    expect(
      refusal(() => {
        CommonAPI.assertCanCreateTable({
          modelType: WorkspaceNotificationRule,
          props: props,
        });
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("strips Permission.Public from the create list", () => {
    /*
     * StatusPageSubscriber's create list contains Public, and every caller
     * carries Public as a global permission. Left in, it would admit a
     * signed-in user with no grant at all in this project.
     */
    expect(new StatusPageSubscriber().getCreatePermissions()).toContain(
      Permission.Public,
    );

    const noGrants: unknown = refusal(() => {
      CommonAPI.assertCanCreateTable({
        modelType: StatusPageSubscriber,
        props: buildProps({ permissions: [] }),
        errorMessage: CUSTOM_MESSAGE,
      });
    });

    expect(noGrants).toBeInstanceOf(NotAuthorizedException);
    expect((noGrants as Exception).message).toBe(CUSTOM_MESSAGE);

    // Public spelled out as a global permission changes nothing.
    const explicitPublic: unknown = refusal(() => {
      CommonAPI.assertCanCreateTable({
        modelType: StatusPageSubscriber,
        props: {
          ...buildProps({ permissions: [] }),
          userGlobalAccessPermission: {
            _type: "UserGlobalAccessPermission",
            globalPermissions: [Permission.Public],
            projectIds: [PROJECT_ID],
          },
        },
      });
    });

    expect(explicitPublic).toBeInstanceOf(NotAuthorizedException);

    // A real grant from the rest of that list still admits.
    expect(() => {
      CommonAPI.assertCanCreateTable({
        modelType: StatusPageSubscriber,
        props: buildProps({
          permissions: [Permission.CreateStatusPageSubscriber],
        }),
      });
    }).not.toThrow();
  });

  test("an anonymous caller is refused with 401 even when the create list is public", () => {
    for (const modelType of [WorkspaceNotificationRule, StatusPageSubscriber]) {
      const thrown: unknown = refusal(() => {
        CommonAPI.assertCanCreateTable({
          modelType: modelType,
          props: {
            tenantId: PROJECT_ID,
            userType: UserType.Public,
          },
          errorMessage: CUSTOM_MESSAGE,
        });
      });

      expect(thrown).toBeInstanceOf(NotAuthenticatedException);
      expect((thrown as Exception).message).toBe(
        CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
      );
    }
  });

  test("does not count a BLOCK row as a grant", () => {
    const thrown: unknown = refusal(() => {
      CommonAPI.assertCanCreateTable({
        modelType: WorkspaceNotificationRule,
        props: buildProps({
          blocks: [Permission.CreateWorkspaceNotificationRule],
        }),
        errorMessage: CUSTOM_MESSAGE,
      });
    });

    // No Allow at all, so the Allow half refuses first, with its message.
    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Exception).message).toBe(CUSTOM_MESSAGE);
  });

  test("refuses a team BLOCK row even with an Allow", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ]) {
      const thrown: unknown = refusal(() => {
        CommonAPI.assertCanCreateTable({
          modelType: WorkspaceNotificationRule,
          props: buildProps({
            permissions: [permission],
            blocks: [Permission.CreateWorkspaceNotificationRule],
          }),
          errorMessage: CUSTOM_MESSAGE,
        });
      });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      // The block says which permission was blocked, not the Allow message.
      expect((thrown as Exception).message).toBe(BLOCKED_MESSAGE);
    }
  });

  test("a BLOCK on any permission in the create list refuses, not only the one granted", () => {
    const thrown: unknown = refusal(() => {
      CommonAPI.assertCanCreateTable({
        modelType: WorkspaceNotificationRule,
        props: buildProps({
          permissions: [Permission.ProjectAdmin],
          blocks: [Permission.SettingsMember],
        }),
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Exception).message).toContain(
      "SettingsMember is in your team's permission block list",
    );
  });

  test("a BLOCK on a permission outside the create list does not refuse", () => {
    /*
     * Blocking reads, edits or deletes of the rules says nothing about
     * creating one, so the block half must look at the create list only.
     */
    expect(() => {
      CommonAPI.assertCanCreateTable({
        modelType: WorkspaceNotificationRule,
        props: buildProps({
          permissions: [Permission.ProjectMember],
          blocks: [
            Permission.ReadWorkspaceNotificationRule,
            Permission.EditWorkspaceNotificationRule,
            Permission.DeleteWorkspaceNotificationRule,
          ],
        }),
      });
    }).not.toThrow();
  });

  test("checks the block list for a create, with the caller's props", () => {
    const blockCheck: jest.SpyInstance = jest.spyOn(
      TablePermission,
      "checkTableLevelBlockPermissions",
    );
    const props: DatabaseCommonInteractionProps = buildProps({
      permissions: [Permission.ProjectMember],
    });

    CommonAPI.assertCanCreateTable({
      modelType: WorkspaceNotificationRule,
      props: props,
    });

    expect(blockCheck).toHaveBeenCalledTimes(1);
    expect(blockCheck.mock.calls[0]![0]).toBe(WorkspaceNotificationRule);
    expect(blockCheck.mock.calls[0]![1]).toBe(props);
    expect(blockCheck.mock.calls[0]![2]).toBe(DatabaseRequestType.Create);
  });

  test("leaves a labelled BLOCK row to the row-level rules", () => {
    /*
     * A block scoped to labels only covers the labelled rows. The CRUD
     * create's table-level check skips it the same way, so this gate must
     * let it through too.
     */
    expect(() => {
      CommonAPI.assertCanCreateTable({
        modelType: WorkspaceNotificationRule,
        props: buildProps({
          permissions: [Permission.ProjectMember],
          blocks: [Permission.CreateWorkspaceNotificationRule],
          blockLabelIds: [LABEL_ID],
        }),
      });
    }).not.toThrow();
  });

  test("an unlabelled BLOCK row wins even when a labelled row for the same permission comes first", () => {
    const thrown: unknown = refusal(() => {
      CommonAPI.assertCanCreateTable({
        modelType: WorkspaceNotificationRule,
        props: buildPropsFromRows([
          {
            projectId: PROJECT_ID,
            rows: [
              buildRow({
                permission: Permission.ProjectMember,
                isBlockPermission: false,
              }),
              buildRow({
                permission: Permission.CreateWorkspaceNotificationRule,
                isBlockPermission: true,
                labelIds: [LABEL_ID],
              }),
              buildRow({
                permission: Permission.CreateWorkspaceNotificationRule,
                isBlockPermission: true,
              }),
            ],
          },
        ]),
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Exception).message).toBe(BLOCKED_MESSAGE);
  });

  test("a BLOCK row in another project does not refuse in this one", () => {
    expect(() => {
      CommonAPI.assertCanCreateTable({
        modelType: WorkspaceNotificationRule,
        props: buildPropsFromRows([
          {
            projectId: PROJECT_ID,
            rows: [
              buildRow({
                permission: Permission.ProjectMember,
                isBlockPermission: false,
              }),
            ],
          },
          {
            projectId: OTHER_PROJECT_ID,
            rows: [
              buildRow({
                permission: Permission.CreateWorkspaceNotificationRule,
                isBlockPermission: true,
              }),
            ],
          },
        ]),
      });
    }).not.toThrow();
  });

  test("an Allow grant in another project does not count in this one", () => {
    const thrown: unknown = refusal(() => {
      CommonAPI.assertCanCreateTable({
        modelType: WorkspaceNotificationRule,
        props: buildPropsFromRows([
          {
            projectId: PROJECT_ID,
            rows: [
              buildRow({
                permission: Permission.Viewer,
                isBlockPermission: false,
              }),
            ],
          },
          {
            projectId: OTHER_PROJECT_ID,
            rows: [
              buildRow({
                permission: Permission.ProjectOwner,
                isBlockPermission: false,
              }),
            ],
          },
        ]),
        errorMessage: CUSTOM_MESSAGE,
      });
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Exception).message).toBe(CUSTOM_MESSAGE);
  });

  test("refuses a caller with no credentials with 401", () => {
    const anonymousCallers: Array<DatabaseCommonInteractionProps> = [
      {},
      { tenantId: PROJECT_ID },
      {
        // A forged grant map without an identity is still no identity.
        ...buildProps({ permissions: [Permission.ProjectOwner] }),
        userId: undefined,
        userType: UserType.Public,
      },
      {
        // Nor is a block: identity is checked before either half.
        ...buildProps({
          permissions: [Permission.ProjectMember],
          blocks: [Permission.CreateWorkspaceNotificationRule],
        }),
        userId: undefined,
        userType: UserType.Public,
      },
    ];

    for (const props of anonymousCallers) {
      const thrown: unknown = refusal(() => {
        CommonAPI.assertCanCreateTable({
          modelType: WorkspaceNotificationRule,
          props: props,
          errorMessage: CUSTOM_MESSAGE,
        });
      });

      expect(thrown).toBeInstanceOf(NotAuthenticatedException);
      expect((thrown as Exception).message).toBe(
        CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
      );
    }
  });

  test("master admin bypasses both halves", () => {
    const blockCheck: jest.SpyInstance = jest.spyOn(
      TablePermission,
      "checkTableLevelBlockPermissions",
    );

    for (const permissions of [[], [Permission.Viewer]]) {
      expect(() => {
        CommonAPI.assertCanCreateTable({
          modelType: WorkspaceNotificationRule,
          props: {
            ...buildProps({
              permissions: permissions,
              blocks: [Permission.CreateWorkspaceNotificationRule],
            }),
            isMasterAdmin: true,
            userType: UserType.MasterAdmin,
          },
          errorMessage: CUSTOM_MESSAGE,
        });
      }).not.toThrow();
    }

    expect(blockCheck).not.toHaveBeenCalled();
  });
});
