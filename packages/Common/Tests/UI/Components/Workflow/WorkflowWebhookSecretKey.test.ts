/*
 * The rules for a workflow's webhook secret key on the dashboard side: when
 * the builder may ask for it, who may reset it, how it is reset, and when it
 * is only the workflow's own ID.
 *
 * Asking for a column the user cannot read fails the whole request - the
 * builder would not load at all - so the select is held, for every role, to
 * the same check the server runs. So is the reset gate: a gate that is looser
 * than the server offers a button that fails, one that is stricter hides a
 * reset someone is allowed.
 */

let mockPermissions: Array<unknown> = [];
let mockIsMasterAdmin: boolean = false;

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockIsMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: jest.fn(),
    },
  };
});

import Workflow from "../../../../Models/DatabaseModels/Workflow";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../Server/Types/Database/Permissions/ColumnPermission";
import SelectPermission from "../../../../Server/Types/Database/Permissions/SelectPermission";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import {
  WEBHOOK_SECRET_KEY_COLUMN,
  canSeeWebhookSecretKey,
  getWebhookSecretKeyResetGate,
  getWebhookSecretKeySelect,
  isWebhookSecretKeyTheWorkflowId,
  resetWebhookSecretKey,
} from "../../../../UI/Components/Workflow/WorkflowWebhookSecretKey";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import { PermissionGateResult } from "../../../../UI/Utils/PermissionGate";
import { MockFunction } from "../../../MockType";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const UUID_V4: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const NO_PERMISSION: string =
  "You do not have permission to reset this webhook URL. You need one of these permissions: Project Owner, Project Admin, Edit Workflow.";

/*
 * Single roles and the combinations a real member is likely to hold. Every
 * workflow role is here, so a role added to the column later is covered.
 */
const PERMISSION_SETS: Array<Array<Permission>> = [
  [Permission.ProjectOwner],
  [Permission.ProjectAdmin],
  [Permission.ProjectMember],
  [Permission.Viewer],
  [Permission.WorkflowAdmin],
  [Permission.WorkflowMember],
  [Permission.WorkflowViewer],
  [Permission.ReadWorkflow],
  [Permission.EditWorkflow],
  [Permission.CreateWorkflow],
  [Permission.DeleteWorkflow],
  [Permission.Viewer, Permission.EditWorkflow],
  [Permission.ProjectMember, Permission.ReadWorkflow],
  [Permission.WorkflowViewer, Permission.DeleteWorkflow],
  [Permission.EditAllOperationalResources],
  [Permission.ReadAllOperationalResources, Permission.WorkflowMember],
];

const projectId: ObjectID = ObjectID.generate();

function serverProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const userPermissions: Array<UserPermission> = permissions.map(
    (permission: Permission) => {
      return {
        _type: "UserPermission" as const,
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: userPermissions,
  };

  return {
    userId: ObjectID.generate(),
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

type ServerAllowsFunction = (permissions: Array<Permission>) => boolean;

const serverAllowsRead: ServerAllowsFunction = (
  permissions: Array<Permission>,
): boolean => {
  try {
    SelectPermission.checkSelectPermission(
      Workflow,
      // The server's own Select type; the column is all that matters here.
      { [WEBHOOK_SECRET_KEY_COLUMN]: true } as never,
      serverProps(permissions),
    );

    return true;
  } catch {
    return false;
  }
};

const serverAllowsReset: ServerAllowsFunction = (
  permissions: Array<Permission>,
): boolean => {
  const data: Workflow = new Workflow();
  data.webhookSecretKey = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  try {
    ColumnPermissions.checkDataColumnPermissions(
      Workflow,
      data,
      serverProps(permissions),
      DatabaseRequestType.Update,
    );

    return true;
  } catch {
    return false;
  }
};

const updateById: MockFunction = ModelAPI.updateById as unknown as MockFunction;

beforeEach(() => {
  mockPermissions = [];
  mockIsMasterAdmin = false;
  updateById.mockReset();
});

describe("getWebhookSecretKeySelect", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflow,
  ])("asks for the key for %s", (permission: Permission) => {
    mockPermissions = [permission];

    expect(getWebhookSecretKeySelect()).toEqual({ webhookSecretKey: true });
    expect(canSeeWebhookSecretKey()).toBe(true);
  });

  test.each([
    Permission.Viewer,
    Permission.WorkflowViewer,
    Permission.ReadWorkflow,
    Permission.ProjectMember,
    Permission.WorkflowAdmin,
    Permission.WorkflowMember,
  ])(
    "asks for nothing for %s, so the builder still loads",
    (permission: Permission) => {
      mockPermissions = [permission];

      expect(getWebhookSecretKeySelect()).toEqual({});
      expect(canSeeWebhookSecretKey()).toBe(false);
    },
  );

  test("asks for nothing while the permission snapshot has not landed", () => {
    /*
     * Guessing "probably allowed" would fail the builder's whole first load
     * for anyone who is not.
     */
    mockPermissions = [];

    expect(getWebhookSecretKeySelect()).toEqual({});
  });

  test("asks for the key for a master admin with no project permissions", () => {
    mockIsMasterAdmin = true;

    expect(getWebhookSecretKeySelect()).toEqual({ webhookSecretKey: true });
  });

  test("takes a snapshot to decide on, when it is handed one", () => {
    mockPermissions = [Permission.Viewer];

    expect(
      getWebhookSecretKeySelect({ permissions: [Permission.EditWorkflow] }),
    ).toEqual({ webhookSecretKey: true });
  });

  test("asks for the key exactly when the server would hand it over", () => {
    for (const permissions of PERMISSION_SETS) {
      mockPermissions = permissions;

      expect({
        permissions,
        asks: Boolean(getWebhookSecretKeySelect()["webhookSecretKey"]),
      }).toEqual({ permissions, asks: serverAllowsRead(permissions) });
    }
  });
});

describe("getWebhookSecretKeyResetGate", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflow,
  ])("lets %s reset the URL", (permission: Permission) => {
    mockPermissions = [permission];

    expect(getWebhookSecretKeyResetGate()).toEqual({ isAllowed: true });
  });

  test("tells a Viewer which permissions would let them reset it", () => {
    mockPermissions = [Permission.Viewer];

    expect(getWebhookSecretKeyResetGate()).toEqual({
      isAllowed: false,
      disabledReason: NO_PERMISSION,
    });
  });

  test("Delete Workflow can update a workflow, but not its key", () => {
    mockPermissions = [Permission.DeleteWorkflow];

    const gate: PermissionGateResult = getWebhookSecretKeyResetGate();

    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toBe(NO_PERMISSION);
  });

  test("gives no reason while the permission snapshot has not landed, so the button is hidden rather than accusing", () => {
    mockPermissions = [];

    expect(getWebhookSecretKeyResetGate()).toEqual({ isAllowed: false });
  });

  test("lets a master admin reset it", () => {
    mockIsMasterAdmin = true;

    expect(getWebhookSecretKeyResetGate()).toEqual({ isAllowed: true });
  });

  test("allows a reset exactly when the server would accept it", () => {
    for (const permissions of PERMISSION_SETS) {
      mockPermissions = permissions;

      expect({
        permissions,
        allowed: getWebhookSecretKeyResetGate().isAllowed,
      }).toEqual({ permissions, allowed: serverAllowsReset(permissions) });
    }
  });

  test("whoever may see the key may also reset it", () => {
    for (const permissions of PERMISSION_SETS) {
      mockPermissions = permissions;

      if (canSeeWebhookSecretKey()) {
        expect({
          permissions,
          allowed: getWebhookSecretKeyResetGate().isAllowed,
        }).toEqual({
          permissions,
          allowed: true,
        });
      }
    }
  });
});

describe("resetWebhookSecretKey", () => {
  test("saves a fresh random key on the workflow, and resolves with it", async () => {
    updateById.mockImplementation(async () => {
      return {};
    });

    const secretKey: string = await resetWebhookSecretKey(WORKFLOW_ID);

    expect(secretKey).toMatch(UUID_V4);
    expect(updateById).toHaveBeenCalledTimes(1);

    const call: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateById.mock.calls[0]![0] as never;

    expect(call.modelType).toBe(Workflow);
    expect(call.id.toString()).toBe(WORKFLOW_ID.toString());
    // Only the key: nothing else on the workflow is touched.
    expect(call.data).toEqual({ webhookSecretKey: secretKey });
  });

  test("never hands out the same key twice", async () => {
    updateById.mockImplementation(async () => {
      return {};
    });

    const keys: Set<string> = new Set<string>();

    for (let i: number = 0; i < 20; i++) {
      keys.add(await resetWebhookSecretKey(WORKFLOW_ID));
    }

    expect(keys.size).toBe(20);
  });

  test("is never the workflow's own ID", async () => {
    updateById.mockImplementation(async () => {
      return {};
    });

    const secretKey: string = await resetWebhookSecretKey(WORKFLOW_ID);

    expect(
      isWebhookSecretKeyTheWorkflowId({
        secretKey: secretKey,
        workflowId: WORKFLOW_ID,
      }),
    ).toBe(false);
  });

  test("rejects with the API's error when the save is refused", async () => {
    const refusal: Error = new Error(
      "User is not allowed to update on webhookSecretKey column of Workflow",
    );

    updateById.mockImplementation(async () => {
      throw refusal;
    });

    await expect(resetWebhookSecretKey(WORKFLOW_ID)).rejects.toBe(refusal);
  });
});

describe("isWebhookSecretKeyTheWorkflowId", () => {
  test("recognises a key that is the workflow's ID, as the 2026 migration set it", () => {
    expect(
      isWebhookSecretKeyTheWorkflowId({
        secretKey: WORKFLOW_ID.toString(),
        workflowId: WORKFLOW_ID,
      }),
    ).toBe(true);
  });

  test("whatever the case and surrounding space", () => {
    expect(
      isWebhookSecretKeyTheWorkflowId({
        secretKey: ` ${WORKFLOW_ID.toString().toUpperCase()} `,
        workflowId: WORKFLOW_ID.toString(),
      }),
    ).toBe(true);
  });

  test("a key of its own is not the ID", () => {
    expect(
      isWebhookSecretKeyTheWorkflowId({
        secretKey: "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b",
        workflowId: WORKFLOW_ID,
      }),
    ).toBe(false);
  });

  test("an empty key is not the ID", () => {
    expect(
      isWebhookSecretKeyTheWorkflowId({ secretKey: "", workflowId: "" }),
    ).toBe(false);
  });
});
