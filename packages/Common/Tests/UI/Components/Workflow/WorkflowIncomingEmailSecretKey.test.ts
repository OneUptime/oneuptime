/*
 * The rules for a workflow's incoming email secret key on the dashboard side:
 * when the builder may ask for it, who may reset it, and how it is reset (or
 * created, for a workflow that has none).
 *
 * Asking for a column the user cannot read fails the whole request - the
 * builder would not load at all - so the select is held, for every role, to
 * the same check the server runs. So is the reset gate: a gate looser than
 * the server offers a button that fails, one stricter hides a reset someone
 * is allowed.
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
  INCOMING_EMAIL_SECRET_KEY_COLUMN,
  canSeeIncomingEmailSecretKey,
  getIncomingEmailSecretKeyResetGate,
  getIncomingEmailSecretKeySelect,
  resetIncomingEmailSecretKey,
} from "../../../../UI/Components/Workflow/WorkflowIncomingEmailSecretKey";
import {
  canSeeWebhookSecretKey,
  getWebhookSecretKeyResetGate,
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
  "You do not have permission to reset this email address. You need one of these permissions: Project Owner, Project Admin, Edit Workflow.";

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
      { [INCOMING_EMAIL_SECRET_KEY_COLUMN]: true } as never,
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
  data.incomingEmailSecretKey = new ObjectID(
    "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  );

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

describe("getIncomingEmailSecretKeySelect", () => {
  test("names the column the model has", () => {
    expect(INCOMING_EMAIL_SECRET_KEY_COLUMN).toBe("incomingEmailSecretKey");
    expect(new Workflow().getTableColumns().columns).toContain(
      INCOMING_EMAIL_SECRET_KEY_COLUMN,
    );
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflow,
  ])("asks for the key for %s", (permission: Permission) => {
    mockPermissions = [permission];

    expect(getIncomingEmailSecretKeySelect()).toEqual({
      incomingEmailSecretKey: true,
    });
    expect(canSeeIncomingEmailSecretKey()).toBe(true);
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

      expect(getIncomingEmailSecretKeySelect()).toEqual({});
      expect(canSeeIncomingEmailSecretKey()).toBe(false);
    },
  );

  test("asks for nothing while the permission snapshot has not landed", () => {
    mockPermissions = [];

    expect(getIncomingEmailSecretKeySelect()).toEqual({});
  });

  test("asks for the key for a master admin with no project permissions", () => {
    mockIsMasterAdmin = true;

    expect(getIncomingEmailSecretKeySelect()).toEqual({
      incomingEmailSecretKey: true,
    });
  });

  test("asks for the key exactly when the server would hand it over", () => {
    for (const permissions of PERMISSION_SETS) {
      mockPermissions = permissions;

      expect({
        permissions,
        asks: Boolean(
          getIncomingEmailSecretKeySelect()["incomingEmailSecretKey"],
        ),
      }).toEqual({ permissions, asks: serverAllowsRead(permissions) });
    }
  });

  test("whoever may see the webhook URL may see the email address, and nobody else", () => {
    for (const permissions of PERMISSION_SETS) {
      mockPermissions = permissions;

      expect({
        permissions,
        email: canSeeIncomingEmailSecretKey(),
      }).toEqual({ permissions, email: canSeeWebhookSecretKey() });
    }
  });
});

describe("getIncomingEmailSecretKeyResetGate", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflow,
  ])("lets %s reset the address", (permission: Permission) => {
    mockPermissions = [permission];

    expect(getIncomingEmailSecretKeyResetGate()).toEqual({ isAllowed: true });
  });

  test("tells a Viewer which permissions would let them reset it", () => {
    mockPermissions = [Permission.Viewer];

    expect(getIncomingEmailSecretKeyResetGate()).toEqual({
      isAllowed: false,
      disabledReason: NO_PERMISSION,
    });
  });

  test("Delete Workflow alone may not update a workflow, nor reset its address", () => {
    mockPermissions = [Permission.DeleteWorkflow];

    const gate: PermissionGateResult = getIncomingEmailSecretKeyResetGate();

    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toBe(NO_PERMISSION);
  });

  test("gives no reason while the permission snapshot has not landed, so the button is hidden rather than accusing", () => {
    mockPermissions = [];

    expect(getIncomingEmailSecretKeyResetGate()).toEqual({ isAllowed: false });
  });

  test("lets a master admin reset it", () => {
    mockIsMasterAdmin = true;

    expect(getIncomingEmailSecretKeyResetGate()).toEqual({ isAllowed: true });
  });

  test("allows a reset exactly when the server would accept it", () => {
    for (const permissions of PERMISSION_SETS) {
      mockPermissions = permissions;

      expect({
        permissions,
        allowed: getIncomingEmailSecretKeyResetGate().isAllowed,
      }).toEqual({ permissions, allowed: serverAllowsReset(permissions) });
    }
  });

  test("whoever may see the key may also reset it - so a missing address can always be created by whoever sees it missing", () => {
    for (const permissions of PERMISSION_SETS) {
      mockPermissions = permissions;

      if (canSeeIncomingEmailSecretKey()) {
        expect({
          permissions,
          allowed: getIncomingEmailSecretKeyResetGate().isAllowed,
        }).toEqual({ permissions, allowed: true });
      }
    }
  });

  test("agrees with the webhook URL's gate for every role", () => {
    for (const permissions of PERMISSION_SETS) {
      mockPermissions = permissions;

      expect({
        permissions,
        allowed: getIncomingEmailSecretKeyResetGate().isAllowed,
      }).toEqual({
        permissions,
        allowed: getWebhookSecretKeyResetGate().isAllowed,
      });
    }
  });
});

describe("resetIncomingEmailSecretKey", () => {
  test("saves a fresh random key on the workflow, and resolves with it", async () => {
    updateById.mockImplementation(async () => {
      return {};
    });

    const secretKey: string = await resetIncomingEmailSecretKey(WORKFLOW_ID);

    expect(secretKey).toMatch(UUID_V4);
    expect(updateById).toHaveBeenCalledTimes(1);

    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateById.mock.calls[0]![0] as never;

    expect(update.modelType).toBe(Workflow);
    expect(update.id.toString()).toBe(WORKFLOW_ID.toString());
    expect(update.data).toEqual({ incomingEmailSecretKey: secretKey });
  });

  test("never reuses a key, and never uses the workflow's own ID", async () => {
    updateById.mockImplementation(async () => {
      return {};
    });

    const first: string = await resetIncomingEmailSecretKey(WORKFLOW_ID);
    const second: string = await resetIncomingEmailSecretKey(WORKFLOW_ID);

    expect(first).not.toBe(second);
    expect(first).not.toBe(WORKFLOW_ID.toString());
    expect(second).not.toBe(WORKFLOW_ID.toString());
  });

  test("a refused save rejects, with the API's error, and resolves with no key", async () => {
    updateById.mockImplementation(async () => {
      throw new Error(
        "User is not allowed to update on incomingEmailSecretKey column of Workflow",
      );
    });

    await expect(resetIncomingEmailSecretKey(WORKFLOW_ID)).rejects.toThrow(
      "is not allowed to update on incomingEmailSecretKey",
    );
  });
});
