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
      "You do not have permission to update this Project. You need this permission: Edit Project.",
    );
  });

  test("a monitor's Disable Monitoring switch is open to whoever may edit the monitor", () => {
    /*
     * The column's update list is the monitor's own, Edit Monitor included.
     * It used to list Create Monitor instead, which locked the Monitoring
     * switch for somebody allowed to edit monitors.
     */
    for (const permission of [
      Permission.EditProjectMonitor,
      Permission.MonitorMember,
      Permission.MonitorAdmin,
      Permission.ProjectMember,
    ]) {
      permissionsForTest = [permission];

      expect([
        permission,
        PermissionGate.checkColumnUpdate(
          new Monitor(),
          "disableActiveMonitoring",
        ),
      ]).toEqual([permission, { isAllowed: true }]);
    }
  });

  test("Create Monitor alone does not unlock the Disable Monitoring switch", () => {
    permissionsForTest = [Permission.CreateProjectMonitor];

    const result: PermissionGateResult = PermissionGate.checkColumnUpdate(
      new Monitor(),
      "disableActiveMonitoring",
    );

    expect(result).toEqual(
      PermissionGate.check(new Monitor(), ModelAction.Update),
    );
    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toBe(
      "You do not have permission to update this Monitor. You need this permission: Edit Monitor.",
    );
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

/*
 * A switch refused by its RECORD's gate - a Viewer may update no project at
 * all - names what would open that switch, not every permission that opens
 * the record: "An incident can be in only one episode" is for a project's
 * owners and admins, and its lock used to send a Viewer to Billing Admin,
 * Billing Member, Manage Billing and Edit Project too (#4933).
 */
describe("PermissionGate.checkColumnUpdate, refused by the record's own gate", () => {
  const OWNER_OR_ADMIN: string =
    "You do not have permission to update this Project. You need one of these roles: Project Owner, Project Admin.";

  test.each(["limitIncidentsToOneEpisode", "limitAlertsToOneEpisode"])(
    "a Viewer's lock on the Project's %s switch names only Project Owner and Project Admin",
    (column: string) => {
      permissionsForTest = [Permission.Viewer];

      // The record's own list is wider: billing and Edit Project open it.
      expect(
        PermissionGate.check(new Project(), ModelAction.Update).disabledReason,
      ).toBe(
        "You do not have permission to update this Project. You need one of these permissions: Manage Billing, Edit Project.",
      );

      const result: PermissionGateResult = PermissionGate.checkColumnUpdate(
        new Project(),
        column,
      );

      expect(result).toEqual({
        isAllowed: false,
        disabledReason: OWNER_OR_ADMIN,
      });
      expect(result.disabledReason).not.toContain("Billing");
      expect(result.disabledReason).not.toContain("Edit Project");
    },
  );

  test("a column a little narrower than its record names the permissions it shares with it", () => {
    // Monitor defaults: owners, admins and Edit Project - no billing roles.
    permissionsForTest = [Permission.Viewer];

    expect(
      PermissionGate.checkColumnUpdate(
        new Project(),
        "doNotAddGlobalProbesByDefaultOnNewMonitors",
      ).disabledReason,
    ).toBe(
      "You do not have permission to update this Project. You need this permission: Edit Project.",
    );
  });

  test("still never allows: whoever may not update the record may change none of its columns", () => {
    for (const permission of [
      Permission.Viewer,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ]) {
      permissionsForTest = [permission];

      expect([
        permission,
        PermissionGate.checkColumnUpdate(
          new Project(),
          "limitIncidentsToOneEpisode",
        ).isAllowed,
      ]).toEqual([permission, false]);
    }
  });

  test("the item's own name and the caller's own sentence are kept", () => {
    permissionsForTest = [Permission.Viewer];

    expect(
      PermissionGate.checkColumnUpdate(
        new Project(),
        "limitIncidentsToOneEpisode",
        { singularName: "Project Setting" },
      ).disabledReason,
    ).toBe(
      "You do not have permission to update this Project Setting. You need one of these roles: Project Owner, Project Admin.",
    );

    expect(
      PermissionGate.checkColumnUpdate(
        new Project(),
        "limitIncidentsToOneEpisode",
        { sentence: "You cannot change how episodes take incidents." },
      ).disabledReason,
    ).toBe(
      "You cannot change how episodes take incidents. You need one of these roles: Project Owner, Project Admin.",
    );
  });

  test("a team's block on one of the column's permissions is what it names", () => {
    const result: PermissionGateResult = PermissionGate.checkColumnUpdate(
      new Project(),
      "limitIncidentsToOneEpisode",
      {
        held: {
          allowed: [Permission.Viewer],
          allowedProjectWide: [Permission.Viewer],
          blocked: [Permission.ProjectAdmin],
          blockedForSomeLabels: [],
        },
      },
    );

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toBe(
      "You do not have permission to update this Project. A team you are on blocks Project Admin.",
    );
  });

  test("a column as wide as its record keeps the record's answer", () => {
    permissionsForTest = [Permission.Viewer];

    expect(
      PermissionGate.checkColumnUpdate(new StatusPage(), "enableMcpServer"),
    ).toEqual(PermissionGate.check(new StatusPage(), ModelAction.Update));
  });

  test("a column that declares no update permissions keeps the record's answer", () => {
    permissionsForTest = [Permission.Viewer];

    expect(
      PermissionGate.checkColumnUpdate(new Project(), "noSuchColumn"),
    ).toEqual(PermissionGate.check(new Project(), ModelAction.Update));
  });

  test("a column whose permissions open none of the record keeps the record's answer", () => {
    permissionsForTest = [Permission.Viewer];

    const record: Project = new Project();
    const model: Project = Object.assign(Object.create(record), {
      getColumnAccessControlForAllColumns: () => {
        return { odd: { update: [Permission.ManageProjectBilling] } };
      },
      getUpdatePermissions: () => {
        return [Permission.ProjectOwner, Permission.ProjectAdmin];
      },
    }) as Project;

    expect(PermissionGate.checkColumnUpdate(model, "odd")).toEqual(
      PermissionGate.check(model, ModelAction.Update),
    );
  });

  test("an empty permission snapshot still accuses nobody", () => {
    permissionsForTest = [];

    expect(
      PermissionGate.checkColumnUpdate(
        new Project(),
        "limitIncidentsToOneEpisode",
      ),
    ).toEqual({ isAllowed: false });
  });

  test("a master admin may still change it", () => {
    isMasterAdminForTest = true;
    permissionsForTest = [Permission.Viewer];

    expect(
      PermissionGate.checkColumnUpdate(
        new Project(),
        "limitIncidentsToOneEpisode",
      ),
    ).toEqual({ isAllowed: true });
  });

  test("an owner or admin may change it, as before", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]) {
      permissionsForTest = [permission];

      expect(
        PermissionGate.checkColumnUpdate(
          new Project(),
          "limitIncidentsToOneEpisode",
        ),
      ).toEqual({ isAllowed: true });
    }
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
      "You do not have permission to update this Project. You need one of these permissions: Manage Billing, Edit Project.",
    );
  });
});
