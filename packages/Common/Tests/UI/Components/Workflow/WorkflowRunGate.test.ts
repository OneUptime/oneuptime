import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WorkflowRunGate: whether the Builder offers Run Workflow and "Run just this
 * step", decided by the lists the server asks for them
 * (Types/Workflow/WorkflowRunPermissions) and the rule every permission
 * check follows (HeldPermissions). The gate and the route must never
 * disagree: a button that works and a route that refuses, or the reverse,
 * is the bug this is here to prevent.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/User", () => {
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

jest.mock("../../../../UI/Utils/Permission", () => {
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

import {
  getLockedReason,
  getWorkflowEditGate,
  getWorkflowRunGate,
  getWorkflowStepRunGate,
  WorkflowRunCopy,
} from "../../../../UI/Components/Workflow/WorkflowRunGate";
import PermissionGate, {
  ModelAction,
} from "../../../../UI/Utils/PermissionGate";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import HeldPermissionsUtil from "../../../../Types/HeldPermissions";
import Permission from "../../../../Types/Permission";
import {
  WORKFLOW_EDIT_PERMISSIONS,
  WORKFLOW_RUN_ONLY_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
  WORKFLOW_RUN_REFUSED_MESSAGE,
  WORKFLOW_RUN_WILDCARD,
  WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
} from "../../../../Types/Workflow/WorkflowRunPermissions";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

// Single roles, and the combinations a real member is likely to hold.
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
  [Permission.EditAllOperationalResources],
  [Permission.ReadAllOperationalResources],
  [Permission.Viewer, Permission.WorkflowMember],
  [Permission.ProjectMember, Permission.ReadWorkflow],
  [Permission.WorkflowViewer, Permission.DeleteWorkflow],
  [Permission.BillingAdmin],
];

beforeEach(() => {
  isMasterAdminForTest = false;
  permissionsForTest = [];
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the lists", () => {
  test("whoever may change a workflow is exactly the Workflow model's update list, in its order", () => {
    expect([...WORKFLOW_EDIT_PERMISSIONS]).toEqual(
      new Workflow().getUpdatePermissions(),
    );
  });

  test("a run is open to them and to the Workflow Member, nobody else", () => {
    expect([...WORKFLOW_RUN_ONLY_PERMISSIONS]).toEqual([
      Permission.WorkflowMember,
    ]);
    expect([...WORKFLOW_RUN_PERMISSIONS]).toEqual([
      ...WORKFLOW_EDIT_PERMISSIONS,
      Permission.WorkflowMember,
    ]);
  });

  test("whoever may run a workflow may open it", () => {
    const readers: Array<Permission> = new Workflow().getReadPermissions();

    for (const permission of WORKFLOW_RUN_ONLY_PERMISSIONS) {
      expect(readers).toContain(permission);
    }
  });

  test("the wildcard is the one that edits every operational resource, which a workflow is", () => {
    expect(WORKFLOW_RUN_WILDCARD).toBe(Permission.EditAllOperationalResources);
    expect(new Workflow().isOperationalResource).toBe(true);
  });
});

describe("the words", () => {
  test("each refusal opens with the server's own message, word for word", () => {
    expect(WorkflowRunCopy.runRefused).toBe(WORKFLOW_RUN_REFUSED_MESSAGE);
    expect(WorkflowRunCopy.stepRunRefused).toBe(
      WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
    );
  });

  test("every Dashboard language has them, translated", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );

      for (const key of [
        WorkflowRunCopy.runRefused,
        WorkflowRunCopy.stepRunRefused,
        WorkflowRunCopy.editRefused,
      ]) {
        const value: string | undefined = locale[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);
        expect([file, key, value!.trim().length > 0]).toEqual([
          file,
          key,
          true,
        ]);

        if (file === "en.json") {
          expect(value).toBe(key);
        } else {
          expect([file, value === key]).toEqual([file, false]);
        }
      }
    }
  });
});

describe("getWorkflowRunGate", () => {
  test.each([...WORKFLOW_RUN_PERMISSIONS])(
    "lets %s run a workflow",
    (permission: Permission) => {
      permissionsForTest = [permission];

      expect(getWorkflowRunGate()).toEqual({ isAllowed: true });
    },
  );

  test("tells a Workflow Viewer what it takes", () => {
    permissionsForTest = [Permission.WorkflowViewer];

    expect(getWorkflowRunGate()).toEqual({
      isAllowed: false,
      disabledReason:
        "You do not have permission to run this workflow. You need this permission: Edit Workflow.",
    });
  });

  test("allows a run exactly when the route's rule would", () => {
    for (const permissions of PERMISSION_SETS) {
      permissionsForTest = permissions;
      PermissionGate.clearPermissionPropsCache();

      expect({
        permissions,
        allowed: getWorkflowRunGate().isAllowed,
      }).toEqual({
        permissions,
        allowed: HeldPermissionsUtil.holdsAnyOf(
          HeldPermissionsUtil.fromPermissions(permissions),
          WORKFLOW_RUN_PERMISSIONS,
          { wildcard: WORKFLOW_RUN_WILDCARD },
        ),
      });
    }
  });
});

describe("getWorkflowStepRunGate", () => {
  test.each([...WORKFLOW_EDIT_PERMISSIONS])(
    "lets %s run one step",
    (permission: Permission) => {
      permissionsForTest = [permission];

      expect(getWorkflowStepRunGate()).toEqual({ isAllowed: true });
    },
  );

  test("tells a Workflow Member, who may run the whole workflow, that one step takes editing", () => {
    permissionsForTest = [Permission.WorkflowMember];

    expect(getWorkflowRunGate().isAllowed).toBe(true);
    expect(getWorkflowStepRunGate()).toEqual({
      isAllowed: false,
      disabledReason:
        "Running one step on its own takes permission to edit this workflow. You need this permission: Edit Workflow.",
    });
  });

  test("allows a step exactly when the route's rule would", () => {
    for (const permissions of PERMISSION_SETS) {
      permissionsForTest = permissions;
      PermissionGate.clearPermissionPropsCache();

      expect({
        permissions,
        allowed: getWorkflowStepRunGate().isAllowed,
      }).toEqual({
        permissions,
        allowed: HeldPermissionsUtil.holdsAnyOf(
          HeldPermissionsUtil.fromPermissions(permissions),
          WORKFLOW_EDIT_PERMISSIONS,
          { wildcard: WORKFLOW_RUN_WILDCARD },
        ),
      });
    }
  });

  test("whoever may run one step may run the whole workflow", () => {
    for (const permissions of PERMISSION_SETS) {
      permissionsForTest = permissions;
      PermissionGate.clearPermissionPropsCache();

      if (getWorkflowStepRunGate().isAllowed) {
        expect({ permissions, run: getWorkflowRunGate().isAllowed }).toEqual({
          permissions,
          run: true,
        });
      }
    }
  });
});

/*
 * Whether the Builder lets the reader change the workflow at all, or shows
 * it as a view (WorkflowViewOnly). Every save of the graph is an update of
 * the Workflow, which the server allows by the model's update list - so the
 * Builder asks exactly that list. A Workflow Member, who may run the
 * workflow, used to be able to add steps that then failed to save.
 */
describe("getWorkflowEditGate", () => {
  test.each([...WORKFLOW_EDIT_PERMISSIONS])(
    "lets %s change the workflow",
    (permission: Permission) => {
      permissionsForTest = [permission];

      expect(getWorkflowEditGate()).toEqual({ isAllowed: true });
    },
  );

  test("the wildcard that edits every operational resource changes it too", () => {
    permissionsForTest = [Permission.EditAllOperationalResources];

    expect(getWorkflowEditGate()).toEqual({ isAllowed: true });
  });

  test("tells a Workflow Member, who may run it, that changing it takes editing - in the Builder's words, with who may", () => {
    permissionsForTest = [Permission.WorkflowMember];

    expect(getWorkflowRunGate().isAllowed).toBe(true);
    expect(getWorkflowEditGate()).toEqual({
      isAllowed: false,
      disabledReason:
        "Changing this workflow takes permission to edit it. You need this permission: Edit Workflow.",
    });
  });

  test.each([
    Permission.Viewer,
    Permission.WorkflowViewer,
    Permission.ReadWorkflow,
    Permission.ProjectMember,
    Permission.CreateWorkflow,
    Permission.DeleteWorkflow,
  ])("refuses %s, saying why", (permission: Permission) => {
    permissionsForTest = [permission];

    const gate: { isAllowed: boolean; disabledReason?: string | undefined } =
      getWorkflowEditGate();

    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toMatch(
      /^Changing this workflow takes permission to edit it\. /,
    );
  });

  test("allows a change exactly when the server's update rule would", () => {
    for (const permissions of PERMISSION_SETS) {
      permissionsForTest = permissions;
      PermissionGate.clearPermissionPropsCache();

      expect({
        permissions,
        allowed: getWorkflowEditGate().isAllowed,
      }).toEqual({
        permissions,
        allowed: PermissionGate.check(new Workflow(), ModelAction.Update, {
          permissions,
        }).isAllowed,
      });
    }
  });

  test("whoever may change a workflow may run one of its steps, and the whole workflow", () => {
    for (const permissions of PERMISSION_SETS) {
      permissionsForTest = permissions;
      PermissionGate.clearPermissionPropsCache();

      expect({
        permissions,
        step: getWorkflowStepRunGate().isAllowed,
      }).toEqual({ permissions, step: getWorkflowEditGate().isAllowed });

      if (getWorkflowEditGate().isAllowed) {
        expect({ permissions, run: getWorkflowRunGate().isAllowed }).toEqual({
          permissions,
          run: true,
        });
      }
    }
  });

  test("its sentence is the Builder's own, never the server's run refusal", () => {
    expect(WorkflowRunCopy.editRefused).toBe(
      "Changing this workflow takes permission to edit it.",
    );
    expect(WorkflowRunCopy.editRefused).not.toBe(WorkflowRunCopy.runRefused);
    expect(WorkflowRunCopy.editRefused).not.toBe(
      WorkflowRunCopy.stepRunRefused,
    );
  });
});

describe("every gate", () => {
  test("a master admin passes them all", () => {
    isMasterAdminForTest = true;

    expect(getWorkflowRunGate()).toEqual({ isAllowed: true });
    expect(getWorkflowStepRunGate()).toEqual({ isAllowed: true });
    expect(getWorkflowEditGate()).toEqual({ isAllowed: true });
  });

  /*
   * Refused with nothing to say: the Builder then locks nothing
   * (getLockedReason) and the server decides - a page drawn before the
   * snapshot never shows an editor a view.
   */
  test("before the permission snapshot lands, they all refuse with nothing to say", () => {
    permissionsForTest = [];

    expect(getWorkflowRunGate()).toEqual({ isAllowed: false });
    expect(getWorkflowStepRunGate()).toEqual({ isAllowed: false });
    expect(getWorkflowEditGate()).toEqual({ isAllowed: false });
    expect(getLockedReason(getWorkflowEditGate())).toBeUndefined();
  });
});

describe("getLockedReason", () => {
  test("nothing when the gate lets them through", () => {
    expect(getLockedReason({ isAllowed: true })).toBeUndefined();
  });

  test("the reason when it refuses with one", () => {
    expect(
      getLockedReason({ isAllowed: false, disabledReason: "Not yours." }),
    ).toBe("Not yours.");
  });

  /*
   * Refused with nothing to say means the snapshot has not landed: the
   * button keeps working and the server decides, rather than locking it on
   * a guess.
   */
  test("nothing when it refuses with nothing to say", () => {
    expect(getLockedReason({ isAllowed: false })).toBeUndefined();
    expect(
      getLockedReason({ isAllowed: false, disabledReason: "" }),
    ).toBeUndefined();
  });
});

describe("the canvas hands the step's lock to the step's settings", () => {
  test("Workflow passes runStepDisabledReason to ComponentSettingsModal as it was given", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "UI",
        "Components",
        "Workflow",
        "Workflow.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      "runStepDisabledReason={props.runStepDisabledReason}",
    );
  });
});
