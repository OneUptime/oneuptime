import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Before this gate existed, "you cannot do this" was rendered as "this button
 * does not exist". A viewer looking at a monitor list simply had no Create
 * button, no Edit and no Delete, with nothing to say why - and on the flows
 * that route to a dedicated create page there was no gate at all, so the whole
 * wizard opened and only failed at submit, with a validation error about a
 * field the user had never been shown (issue #3306).
 *
 * The gate turns a boolean into an answer with a reason attached, and these
 * tests pin the three-way distinction the rest of the UI depends on:
 *
 *   allowed                       -> render the button, working
 *   denied, WITH a reason         -> render it locked, tooltip explains
 *   denied, WITHOUT a reason      -> render nothing at all
 *
 * That third case is the one worth being careful about. It covers the moments
 * where the UI genuinely does not know: the permission snapshot arrives on an
 * API response header, so it is empty on the first paint after a login and for
 * a beat after a project switch. Accusing somebody of lacking a permission
 * they actually hold is worse than briefly not offering the button.
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
  PermissionCheckableModel,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Log from "../../../Models/AnalyticsModels/Log";
import IconProp from "../../../Types/Icon/IconProp";
import Permission from "../../../Types/Permission";

/*
 * A model that supports create but genuinely does not support delete - the
 * shape an analytics model takes when it declares no access control for an
 * operation. Nobody can ever be granted delete on it, so the UI has nothing to
 * tell the user and must render nothing rather than a locked button.
 */
const modelWithNoDeletePermissions: PermissionCheckableModel = {
  singularName: "Widget",
  hasCreatePermissions: (): boolean => {
    return true;
  },
  hasReadPermissions: (): boolean => {
    return true;
  },
  hasUpdatePermissions: (): boolean => {
    return true;
  },
  hasDeletePermissions: (): boolean => {
    return false;
  },
  getCreatePermissions: (): Array<Permission> => {
    return [Permission.ProjectOwner];
  },
  getReadPermissions: (): Array<Permission> => {
    return [Permission.ProjectOwner];
  },
  getUpdatePermissions: (): Array<Permission> => {
    return [Permission.ProjectOwner];
  },
  getDeletePermissions: (): Array<Permission> => {
    return [];
  },
};

describe("PermissionGate", () => {
  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [];
    PermissionGate.clearPermissionPropsCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("check", () => {
    test("allows an operation the user holds a permission for", () => {
      permissionsForTest = [Permission.ProjectAdmin];

      const result: PermissionGateResult = PermissionGate.check(
        new Monitor(),
        ModelAction.Create,
      );

      expect(result.isAllowed).toBe(true);
      expect(result.disabledReason).toBeUndefined();
    });

    /*
     * The exact case from issue #3306: a Viewer opening the monitors list. The
     * snapshot IS loaded - Viewer is a real permission - it just does not carry
     * create. This must produce a reason, because that reason is the whole
     * point of the change.
     */
    test("denies with a reason when the snapshot is loaded but insufficient", () => {
      permissionsForTest = [Permission.Viewer];

      const result: PermissionGateResult = PermissionGate.check(
        new Monitor(),
        ModelAction.Create,
      );

      expect(result.isAllowed).toBe(false);
      expect(result.disabledReason).toBeTruthy();
      expect(result.disabledReason).toContain(
        "You do not have permission to create this Monitor.",
      );
    });

    test("names the permissions that would grant the operation", () => {
      permissionsForTest = [Permission.Viewer];

      const result: PermissionGateResult = PermissionGate.check(
        new Monitor(),
        ModelAction.Create,
      );

      /*
       * Human titles, not raw enum values. A user told they need
       * "CreateProjectMonitor" has been handed an internal identifier.
       */
      expect(result.disabledReason).toContain("Create Monitor");
      expect(result.disabledReason).toContain("Project Admin");
      expect(result.disabledReason).not.toContain("CreateProjectMonitor");
    });

    /*
     * The snapshot lands on a response header. Until the first response with
     * one arrives, every permission check would come back false - and would
     * tell a project owner they need permissions they own.
     */
    test("denies WITHOUT a reason when the permission snapshot has not loaded", () => {
      permissionsForTest = [];

      const result: PermissionGateResult = PermissionGate.check(
        new Monitor(),
        ModelAction.Create,
      );

      expect(result.isAllowed).toBe(false);
      expect(result.disabledReason).toBeUndefined();
    });

    /*
     * An analytics model with no declared access control for an operation
     * reports false for every user. There is no permission anybody could be
     * granted, so there is nothing to say - and certainly not
     * "You need one of these permissions: " with an empty list.
     */
    test("denies WITHOUT a reason when the model declares no permissions for the operation", () => {
      permissionsForTest = [Permission.ProjectOwner];

      const result: PermissionGateResult = PermissionGate.check(
        modelWithNoDeletePermissions,
        ModelAction.Delete,
      );

      expect(result.isAllowed).toBe(false);
      expect(result.disabledReason).toBeUndefined();
    });

    test("short-circuits for a master admin, even with an empty snapshot", () => {
      isMasterAdminForTest = true;
      permissionsForTest = [];

      for (const action of [
        ModelAction.Create,
        ModelAction.Read,
        ModelAction.Update,
        ModelAction.Delete,
      ]) {
        const result: PermissionGateResult = PermissionGate.check(
          new Monitor(),
          action,
        );

        expect(result.isAllowed).toBe(true);
        expect(result.disabledReason).toBeUndefined();
      }
    });

    test("checks each operation against its own permission list", () => {
      /*
       * Monitor's read list includes Viewer; create, update and delete do not.
       * One permission therefore has to produce four different answers.
       */
      permissionsForTest = [Permission.Viewer];

      const monitor: Monitor = new Monitor();

      expect(PermissionGate.check(monitor, ModelAction.Read).isAllowed).toBe(
        true,
      );
      expect(PermissionGate.check(monitor, ModelAction.Create).isAllowed).toBe(
        false,
      );
      expect(PermissionGate.check(monitor, ModelAction.Update).isAllowed).toBe(
        false,
      );
      expect(PermissionGate.check(monitor, ModelAction.Delete).isAllowed).toBe(
        false,
      );
    });

    test("accepts an explicit permission list instead of reading storage", () => {
      permissionsForTest = [];

      const result: PermissionGateResult = PermissionGate.check(
        new Monitor(),
        ModelAction.Create,
        { permissions: [Permission.ProjectOwner] },
      );

      expect(result.isAllowed).toBe(true);
    });

    test("uses the caller's noun for the resource when one is supplied", () => {
      permissionsForTest = [Permission.Viewer];

      const result: PermissionGateResult = PermissionGate.check(
        new Monitor(),
        ModelAction.Create,
        { singularName: "Monitor Template" },
      );

      expect(result.disabledReason).toContain("this Monitor Template");
    });

    /*
     * Both model hierarchies are unrelated classes that happen to expose the
     * same permission API, and the gate is structurally typed so one
     * implementation covers both. If AnalyticsBaseModel ever drifts, this is
     * where it shows up.
     */
    test("works for analytics models as well as database models", () => {
      permissionsForTest = [Permission.ProjectAdmin];

      expect(PermissionGate.check(new Log(), ModelAction.Read).isAllowed).toBe(
        true,
      );

      permissionsForTest = [Permission.Viewer];

      const denied: PermissionGateResult = PermissionGate.check(
        new Log(),
        ModelAction.Create,
      );

      expect(denied.isAllowed).toBe(false);
      expect(denied.disabledReason).toBeTruthy();
    });
  });

  describe("getPermissionTitles", () => {
    test("maps permissions to their human titles", () => {
      expect(
        PermissionGate.getPermissionTitles([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
        ]),
      ).toEqual(["Project Owner", "Project Admin"]);
    });

    /*
     * PermissionHelper.getTitle throws on a permission with no props entry.
     * Called in a loop while building a tooltip, one stale enum value would
     * take down the whole table it was rendering in.
     */
    test("skips unknown permissions instead of throwing", () => {
      const titles: Array<string> = PermissionGate.getPermissionTitles([
        Permission.ProjectOwner,
        "SomePermissionThatDoesNotExist" as Permission,
      ]);

      expect(titles).toEqual(["Project Owner"]);
    });

    test("returns an empty list rather than throwing for an empty input", () => {
      expect(PermissionGate.getPermissionTitles([])).toEqual([]);
    });

    test("does not repeat a title", () => {
      const titles: Array<string> = PermissionGate.getPermissionTitles([
        Permission.ProjectOwner,
        Permission.ProjectOwner,
      ]);

      expect(titles).toEqual(["Project Owner"]);
    });
  });

  describe("getMissingPermissionMessage", () => {
    test("falls back to a bare sentence when no permission has a title", () => {
      /*
       * Never "You need one of these permissions: " trailing into nothing.
       */
      const model: PermissionCheckableModel = {
        singularName: "Widget",
        hasCreatePermissions: (): boolean => {
          return false;
        },
        hasReadPermissions: (): boolean => {
          return false;
        },
        hasUpdatePermissions: (): boolean => {
          return false;
        },
        hasDeletePermissions: (): boolean => {
          return false;
        },
        getCreatePermissions: (): Array<Permission> => {
          return ["NotARealPermission" as Permission];
        },
        getReadPermissions: (): Array<Permission> => {
          return [];
        },
        getUpdatePermissions: (): Array<Permission> => {
          return [];
        },
        getDeletePermissions: (): Array<Permission> => {
          return [];
        },
      };

      const message: string = PermissionGate.getMissingPermissionMessage(
        model,
        ModelAction.Create,
      );

      expect(message).toBe("You do not have permission to create this Widget.");
      expect(message).not.toContain("permissions:");
    });

    test("uses the operation verb the user performed", () => {
      const monitor: Monitor = new Monitor();

      expect(
        PermissionGate.getMissingPermissionMessage(monitor, ModelAction.Delete),
      ).toContain("permission to delete this Monitor");
      expect(
        PermissionGate.getMissingPermissionMessage(monitor, ModelAction.Update),
      ).toContain("permission to update this Monitor");
    });
  });

  describe("gateCardButton", () => {
    const button: CardButtonSchema = {
      title: "Create Monitor",
      icon: IconProp.Add,
      onClick: (): void => {
        clicked = true;
      },
    };

    let clicked: boolean = false;

    beforeEach(() => {
      clicked = false;
    });

    test("returns the button untouched when the user is allowed", () => {
      permissionsForTest = [Permission.ProjectAdmin];

      const gated: CardButtonSchema | null = PermissionGate.gateCardButton(
        button,
        new Monitor(),
        ModelAction.Create,
      );

      expect(gated).toBe(button);
    });

    test("returns a locked button with a tooltip when the user is denied", () => {
      permissionsForTest = [Permission.Viewer];

      const gated: CardButtonSchema | null = PermissionGate.gateCardButton(
        button,
        new Monitor(),
        ModelAction.Create,
      );

      expect(gated).not.toBeNull();
      expect(gated!.title).toBe("Create Monitor");
      expect(gated!.disabled).toBe(true);
      expect(gated!.tooltip).toContain(
        "You do not have permission to create this Monitor.",
      );
    });

    /*
     * Disabling a button is a rendering hint; a schema handed to something that
     * ignores it must still not navigate the user into a flow they will be
     * thrown out of.
     */
    test("neuters the click handler of a locked button", () => {
      permissionsForTest = [Permission.Viewer];

      const gated: CardButtonSchema | null = PermissionGate.gateCardButton(
        button,
        new Monitor(),
        ModelAction.Create,
      );

      gated!.onClick();

      expect(clicked).toBe(false);
    });

    test("returns null when there is no reason to show - snapshot not loaded", () => {
      permissionsForTest = [];

      expect(
        PermissionGate.gateCardButton(
          button,
          new Monitor(),
          ModelAction.Create,
        ),
      ).toBeNull();
    });
  });
});
