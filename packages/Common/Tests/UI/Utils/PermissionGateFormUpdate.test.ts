import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Two gates the role decisions needed:
 *
 *   - PermissionGate.checkFormUpdate: may this user open an edit form over a
 *     record? The record's update list lets in a Billing Admin now, for a
 *     project's four notification channels, but every other column of a
 *     project leaves them out - and the form drops each field its viewer may
 *     not change. A gate on the record alone handed them an Edit button on
 *     the project's name card that opened an empty form.
 *   - PermissionGate.checkPermissions: a gate over a list somebody chose by
 *     hand - who may run a workflow - read by the rule every gate follows.
 *
 * Like every gate, neither accuses anybody before the permission snapshot
 * has landed, and a master admin may do anything.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
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

import PermissionGate, {
  ModelAction,
  PermissionCheckableFormField,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import Project from "../../../Models/DatabaseModels/Project";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import Permission, { UserPermission } from "../../../Types/Permission";
import {
  WORKFLOW_EDIT_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
  WORKFLOW_RUN_WILDCARD,
} from "../../../Types/Workflow/WorkflowRunPermissions";

const NAME_CARD: Array<PermissionCheckableFormField> = [
  { field: { name: true } },
];

const CHANNELS_CARD: Array<PermissionCheckableFormField> = [
  { field: { enableSmsNotifications: true } },
  { field: { enableCallNotifications: true } },
  { field: { enableWhatsAppNotifications: true } },
  { field: { enableTelegramNotifications: true } },
];

// A permission row, as a team hands it out: an allow, or a block.
function row(permission: Permission, isBlock: boolean): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: isBlock,
  };
}

beforeEach(() => {
  isMasterAdminForTest = false;
  permissionsForTest = [];
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PermissionGate.getFormUpdateColumns", () => {
  test("the columns a form's fields write, once each, in order", () => {
    expect(
      PermissionGate.getFormUpdateColumns([
        { field: { name: true } },
        { field: { description: true } },
        { field: { name: true } },
      ]),
    ).toEqual(["name", "description"]);
  });

  test("no fields, no columns", () => {
    expect(PermissionGate.getFormUpdateColumns([])).toEqual([]);
    expect(PermissionGate.getFormUpdateColumns(undefined)).toEqual([]);
  });

  test.each([
    ["a people picker", { field: { ownerUsers: true }, peoplePicker: {} }],
    ["an overridden key", { field: { name: true }, overrideField: { x: 1 } }],
    [
      "a field shown whatever the permission",
      { field: { name: true }, showEvenIfPermissionDoesNotExist: true },
    ],
    ["a field without a column", { overrideField: undefined }],
    ["a field naming two columns", { field: { name: true, slug: true } }],
  ] as Array<[string, PermissionCheckableFormField]>)(
    "cannot judge a form with %s by its columns",
    (_label: string, field: PermissionCheckableFormField) => {
      expect(
        PermissionGate.getFormUpdateColumns([{ field: { name: true } }, field]),
      ).toBeNull();
    },
  );
});

describe("PermissionGate.checkFormUpdate", () => {
  test("a Billing Admin may update a project, but not its name: the name card's Edit locks, naming who may", () => {
    permissionsForTest = [Permission.BillingAdmin, Permission.ProjectUser];

    // The record's own gate lets them in: the channels are theirs.
    expect(
      PermissionGate.check(new Project(), ModelAction.Update).isAllowed,
    ).toBe(true);

    const result: PermissionGateResult = PermissionGate.checkFormUpdate(
      new Project(),
      NAME_CARD,
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toBe(
      "You do not have permission to update this Project. You need one of these permissions: Project Owner, Manage Billing, Edit Project.",
    );
  });

  test("a Billing Admin opens the channels card", () => {
    permissionsForTest = [Permission.BillingAdmin, Permission.ProjectUser];

    expect(
      PermissionGate.checkFormUpdate(new Project(), CHANNELS_CARD),
    ).toEqual({ isAllowed: true });
  });

  test("a project admin may update a project, but not its channels: that card's Edit locks, naming who may", () => {
    permissionsForTest = [Permission.ProjectAdmin];

    const result: PermissionGateResult = PermissionGate.checkFormUpdate(
      new Project(),
      CHANNELS_CARD,
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toBe(
      "You do not have permission to update this Project. You need one of these permissions: Project Owner, Billing Admin, Manage Billing.",
    );
  });

  test("one column the viewer may change is enough: the form shows that field", () => {
    permissionsForTest = [Permission.BillingAdmin];

    expect(
      PermissionGate.checkFormUpdate(new Project(), [
        ...NAME_CARD,
        ...CHANNELS_CARD,
      ]),
    ).toEqual({ isAllowed: true });
  });

  test("names every permission that would open one of the columns, once each, in the columns' order", () => {
    // A project admin may update a project, but none of these columns.
    permissionsForTest = [Permission.ProjectAdmin];

    const result: PermissionGateResult = PermissionGate.checkFormUpdate(
      new Project(),
      [...CHANNELS_CARD, { field: { financeAccountingEmail: true } }],
    );

    expect(result.isAllowed).toBe(false);
    // The finance email is a billing contact detail: Billing Member's too.
    expect(result.disabledReason).toBe(
      "You do not have permission to update this Project. You need one of these permissions: Project Owner, Billing Admin, Manage Billing, Billing Member.",
    );
  });

  test("somebody the record refuses is told what the record's own list says", () => {
    permissionsForTest = [Permission.ProjectMember];

    const result: PermissionGateResult = PermissionGate.checkFormUpdate(
      new Project(),
      [...NAME_CARD, ...CHANNELS_CARD],
    );

    expect(result).toEqual(
      PermissionGate.check(new Project(), ModelAction.Update),
    );
    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toContain("Billing Admin");
  });

  test("a refusal from the record's own list wins: the columns are not asked", () => {
    permissionsForTest = [Permission.Viewer];

    expect(
      PermissionGate.checkFormUpdate(new Project(), CHANNELS_CARD),
    ).toEqual(PermissionGate.check(new Project(), ModelAction.Update));
  });

  test("a form that cannot be judged by its columns is left to the record's gate", () => {
    permissionsForTest = [Permission.BillingAdmin];

    expect(
      PermissionGate.checkFormUpdate(new Project(), [
        { field: { name: true }, overrideField: { anything: true } },
      ]),
    ).toEqual({ isAllowed: true });
  });

  test("no fields at all: the record's gate decides", () => {
    permissionsForTest = [Permission.BillingAdmin];

    expect(PermissionGate.checkFormUpdate(new Project(), [])).toEqual({
      isAllowed: true,
    });
    expect(PermissionGate.checkFormUpdate(new Project(), undefined)).toEqual({
      isAllowed: true,
    });
  });

  test("before the permission snapshot lands it accuses nobody", () => {
    permissionsForTest = [];

    const result: PermissionGateResult = PermissionGate.checkFormUpdate(
      new Project(),
      NAME_CARD,
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toBeFalsy();
  });

  test("a master admin opens every form", () => {
    isMasterAdminForTest = true;

    expect(PermissionGate.checkFormUpdate(new Project(), NAME_CARD)).toEqual({
      isAllowed: true,
    });
    expect(
      PermissionGate.checkFormUpdate(new Project(), CHANNELS_CARD),
    ).toEqual({ isAllowed: true });
  });

  test("a Workflow Admin opens a workflow's settings; a Workflow Member does not", () => {
    const settings: Array<PermissionCheckableFormField> = [
      { field: { name: true } },
      { field: { description: true } },
    ];

    permissionsForTest = [Permission.WorkflowAdmin];
    PermissionGate.clearPermissionPropsCache();

    expect(PermissionGate.checkFormUpdate(new Workflow(), settings)).toEqual({
      isAllowed: true,
    });

    permissionsForTest = [Permission.WorkflowMember];
    PermissionGate.clearPermissionPropsCache();

    const result: PermissionGateResult = PermissionGate.checkFormUpdate(
      new Workflow(),
      settings,
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toContain("Workflow Admin");
    expect(result.disabledReason).not.toContain("Workflow Member");
  });
});

describe("PermissionGate.checkPermissions", () => {
  const SENTENCE: string = "You do not have permission to run this workflow.";

  test.each([...WORKFLOW_RUN_PERMISSIONS])(
    "lets %s through a run gate",
    (permission: Permission) => {
      permissionsForTest = [permission];

      expect(
        PermissionGate.checkPermissions(WORKFLOW_RUN_PERMISSIONS, {
          sentence: SENTENCE,
          wildcard: WORKFLOW_RUN_WILDCARD,
        }),
      ).toEqual({ isAllowed: true });
    },
  );

  test("refuses anybody else with the sentence, then the permissions that would let them", () => {
    permissionsForTest = [Permission.WorkflowViewer];

    expect(
      PermissionGate.checkPermissions(WORKFLOW_RUN_PERMISSIONS, {
        sentence: SENTENCE,
        wildcard: WORKFLOW_RUN_WILDCARD,
      }),
    ).toEqual({
      isAllowed: false,
      disabledReason:
        "You do not have permission to run this workflow. You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin, Workflow Member.",
    });
  });

  test("the wildcard counts when it is given, and only then", () => {
    permissionsForTest = [Permission.EditAllOperationalResources];

    expect(
      PermissionGate.checkPermissions(WORKFLOW_EDIT_PERMISSIONS, {
        sentence: SENTENCE,
        wildcard: WORKFLOW_RUN_WILDCARD,
      }).isAllowed,
    ).toBe(true);
    expect(
      PermissionGate.checkPermissions(WORKFLOW_EDIT_PERMISSIONS, {
        sentence: SENTENCE,
      }).isAllowed,
    ).toBe(false);
  });

  test("a team's block row is no grant", () => {
    expect(
      PermissionGate.checkPermissions(WORKFLOW_RUN_PERMISSIONS, {
        sentence: SENTENCE,
        held: HeldPermissionsUtil.fromRows({
          rows: [row(Permission.WorkflowMember, true)],
        }),
      }).isAllowed,
    ).toBe(false);
  });

  test("a block with no labels on one team wins over the allow on another, and says so", () => {
    const result: PermissionGateResult = PermissionGate.checkPermissions(
      WORKFLOW_RUN_PERMISSIONS,
      {
        sentence: SENTENCE,
        held: HeldPermissionsUtil.fromRows({
          rows: [
            row(Permission.WorkflowMember, false),
            row(Permission.WorkflowMember, true),
          ],
        }),
      },
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toContain(SENTENCE);
    expect(result.disabledReason).toContain("Workflow Member");
  });

  test("before the permission snapshot lands it accuses nobody", () => {
    permissionsForTest = [];

    expect(
      PermissionGate.checkPermissions(WORKFLOW_RUN_PERMISSIONS, {
        sentence: SENTENCE,
      }),
    ).toEqual({ isAllowed: false });
  });

  test("a master admin is let through", () => {
    isMasterAdminForTest = true;

    expect(
      PermissionGate.checkPermissions(WORKFLOW_RUN_PERMISSIONS, {
        sentence: SENTENCE,
      }),
    ).toEqual({ isAllowed: true });
  });

  test("an empty list lets nobody but a master admin through, and blames nobody", () => {
    permissionsForTest = [Permission.ProjectOwner];

    expect(PermissionGate.checkPermissions([], { sentence: SENTENCE })).toEqual(
      { isAllowed: false },
    );
  });

  test("a snapshot handed in is what it decides on", () => {
    permissionsForTest = [Permission.Viewer];

    expect(
      PermissionGate.checkPermissions(WORKFLOW_RUN_PERMISSIONS, {
        sentence: SENTENCE,
        permissions: [Permission.WorkflowMember],
      }).isAllowed,
    ).toBe(true);
  });
});
