import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PermissionGate.checkColumnUpdate: may this user change ONE column of a
 * record? A switch that saves a single column asks it. The server holds a
 * write to the record's update permissions AND to the column's own
 * (ColumnPermission), and many columns are narrower than their table, so a
 * gate on the table alone hands some people a switch whose save is refused.
 *
 * Like the record gate it never accuses anybody on an empty permission
 * snapshot, and a master admin may do anything.
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
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Permission from "../../../Types/Permission";

beforeEach(() => {
  isMasterAdminForTest = false;
  permissionsForTest = [];
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PermissionGate.checkColumnUpdate", () => {
  test("allowed when the user may update the record and the column", () => {
    permissionsForTest = [Permission.ProjectAdmin];

    expect(
      PermissionGate.checkColumnUpdate(
        new Project(),
        "doNotAddGlobalProbesByDefaultOnNewMonitors",
      ),
    ).toEqual({ isAllowed: true });
  });

  test("locked, naming the column's permissions, when the table allows it but the column does not", () => {
    // Manage Billing may update a project, not its monitor defaults.
    permissionsForTest = [Permission.ManageProjectBilling];

    expect(
      PermissionGate.check(new Project(), ModelAction.Update).isAllowed,
    ).toBe(true);

    const result: PermissionGateResult = PermissionGate.checkColumnUpdate(
      new Project(),
      "doNotAddGlobalProbesByDefaultOnNewMonitors",
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toBe(
      "You do not have permission to update this Project. You need one of these permissions: Project Owner, Project Admin, Edit Project.",
    );
  });

  test("a monitor's Disable Monitoring column is held to its own list too", () => {
    /*
     * The Monitor table's update list has Edit Project Monitor; the
     * column's has Create Project Monitor instead. The server checks both.
     */
    permissionsForTest = [Permission.EditProjectMonitor];

    expect(
      PermissionGate.check(new Monitor(), ModelAction.Update).isAllowed,
    ).toBe(true);
    expect(
      PermissionGate.checkColumnUpdate(new Monitor(), "disableActiveMonitoring")
        .isAllowed,
    ).toBe(false);

    permissionsForTest = [Permission.MonitorMember];

    expect(
      PermissionGate.checkColumnUpdate(new Monitor(), "disableActiveMonitoring")
        .isAllowed,
    ).toBe(true);
  });

  test("without the record's permission, it answers what the record's gate answers", () => {
    permissionsForTest = [Permission.Viewer];

    const record: PermissionGateResult = PermissionGate.check(
      new StatusPage(),
      ModelAction.Update,
    );
    const column: PermissionGateResult = PermissionGate.checkColumnUpdate(
      new StatusPage(),
      "enableMcpServer",
    );

    expect(column).toEqual(record);
    expect(column.isAllowed).toBe(false);
    expect(column.disabledReason).toContain(
      "You do not have permission to update this Status Page.",
    );
  });

  test("an empty permission snapshot accuses nobody", () => {
    permissionsForTest = [];

    expect(
      PermissionGate.checkColumnUpdate(new StatusPage(), "enableMcpServer"),
    ).toEqual({ isAllowed: false });
  });

  test("a master admin may change any column", () => {
    isMasterAdminForTest = true;
    permissionsForTest = [];

    expect(
      PermissionGate.checkColumnUpdate(
        new Project(),
        "doNotAddGlobalProbesByDefaultOnNewMonitors",
      ),
    ).toEqual({ isAllowed: true });
  });

  test("permissions handed in are used instead of the stored ones", () => {
    permissionsForTest = [Permission.ProjectOwner];

    expect(
      PermissionGate.checkColumnUpdate(
        new Project(),
        "doNotAddGlobalProbesByDefaultOnNewMonitors",
        { permissions: [Permission.ManageProjectBilling] },
      ).isAllowed,
    ).toBe(false);
  });

  test("the item's name can be the one on screen", () => {
    permissionsForTest = [Permission.ManageProjectBilling];

    expect(
      PermissionGate.checkColumnUpdate(
        new Project(),
        "doNotAddGlobalProbesByDefaultOnNewMonitors",
        { singularName: "Project Setting" },
      ).disabledReason,
    ).toContain("You do not have permission to update this Project Setting.");
  });

  test("a column that declares no update permissions is left to the server", () => {
    permissionsForTest = [Permission.ProjectOwner];

    expect(
      PermissionGate.checkColumnUpdate(new StatusPage(), "noSuchColumn"),
    ).toEqual({ isAllowed: true });
  });
});

describe("PermissionGate.getMissingPermissionMessage is unchanged", () => {
  test("it still names the record's own permissions", () => {
    expect(
      PermissionGate.getMissingPermissionMessage(
        new Project(),
        ModelAction.Update,
      ),
    ).toBe(
      "You do not have permission to update this Project. You need one of these permissions: Project Owner, Project Admin, Manage Billing, Edit Project.",
    );
  });
});
