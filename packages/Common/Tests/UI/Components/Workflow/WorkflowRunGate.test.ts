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
  getWorkflowRunGate,
  getWorkflowStepRunGate,
  WorkflowRunCopy,
} from "../../../../UI/Components/Workflow/WorkflowRunGate";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
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
        "You do not have permission to run this workflow. You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin, Workflow Member.",
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
        "Running one step on its own takes permission to edit this workflow. You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin.",
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

describe("both gates", () => {
  test("a master admin passes both", () => {
    isMasterAdminForTest = true;

    expect(getWorkflowRunGate()).toEqual({ isAllowed: true });
    expect(getWorkflowStepRunGate()).toEqual({ isAllowed: true });
  });

  test("before the permission snapshot lands, both refuse with nothing to say", () => {
    permissionsForTest = [];

    expect(getWorkflowRunGate()).toEqual({ isAllowed: false });
    expect(getWorkflowStepRunGate()).toEqual({ isAllowed: false });
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
