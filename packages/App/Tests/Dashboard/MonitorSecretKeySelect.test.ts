/*
 * https://github.com/OneUptime/oneuptime/issues/3360
 *
 * Monitor's three secret-key columns are no longer readable by Viewer,
 * MonitorViewer or ReadProjectMonitor. That closes the direct-read path, but it
 * opens a second-order hazard in the dashboard: asking for an unreadable column
 * is FATAL, not degraded. ColumnPermission throws `User is not allowed to read
 * on serverMonitorSecretKey column of Monitor` and the whole getItem fails, so
 * three pages that used to name these columns unconditionally --
 * Monitor > View, Monitor > Settings and Monitor > Documentation -- would show
 * a Viewer an error screen instead of a monitor.
 *
 * getReadableMonitorSecretKeySelect is what those pages spread into their
 * select instead. These tests pin the two things that matter: it never asks for
 * a column the user cannot read (or the page breaks), and it does ask for the
 * ones they can (or setting up an agent becomes impossible).
 */

const mockUser: { isMasterAdmin: boolean } = { isMasterAdmin: false };
const mockPermissions: { all: Array<unknown> } = { all: [] };

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockUser.isMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return mockPermissions.all;
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
  MONITOR_SECRET_KEY_COLUMNS,
  getReadableMonitorSecretKeySelect,
} from "../../FeatureSet/Dashboard/src/Utils/MonitorSecretKeySelect";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Dictionary from "Common/Types/Dictionary";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const accessControl: Dictionary<ColumnAccessControl> =
  new Monitor().getColumnAccessControlForAllColumns();

type SelectedColumnsFunction = () => Array<string>;

const selectedColumns: SelectedColumnsFunction = (): Array<string> => {
  return Object.keys(
    getReadableMonitorSecretKeySelect() as Record<string, boolean>,
  );
};

describe("getReadableMonitorSecretKeySelect", () => {
  beforeEach(() => {
    mockUser.isMasterAdmin = false;
    mockPermissions.all = [];
  });

  it("asks for nothing at all when the user is a Viewer", () => {
    /*
     * The regression that would break the monitor page. An empty select spread
     * is a no-op, so the page loads and simply does not offer a key.
     */
    mockPermissions.all = [Permission.Viewer];

    expect(selectedColumns()).toEqual([]);
  });

  it.each([Permission.MonitorViewer, Permission.ReadProjectMonitor])(
    "asks for nothing when the user holds only %s",
    (permission: Permission) => {
      mockPermissions.all = [permission];

      expect(selectedColumns()).toEqual([]);
    },
  );

  it("asks for all three keys for a project owner", () => {
    mockPermissions.all = [Permission.ProjectOwner];

    expect(selectedColumns().sort()).toEqual(
      [...MONITOR_SECRET_KEY_COLUMNS].sort(),
    );
  });

  it.each([
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.EditProjectMonitor,
  ])("asks for all three keys for %s", (permission: Permission) => {
    /*
     * Monitor > Settings has to render the current key for anyone who can
     * reset it, and Monitor > Documentation has to render the agent install
     * command. A member who cannot see the key cannot set an agent up.
     */
    mockPermissions.all = [permission];

    expect(selectedColumns().sort()).toEqual(
      [...MONITOR_SECRET_KEY_COLUMNS].sort(),
    );
  });

  it("asks for all three keys for a master admin with no project permissions", () => {
    mockUser.isMasterAdmin = true;
    mockPermissions.all = [];

    expect(selectedColumns().sort()).toEqual(
      [...MONITOR_SECRET_KEY_COLUMNS].sort(),
    );
  });

  it("asks for nothing while the permission snapshot has not loaded", () => {
    /*
     * The snapshot arrives on a response header and is empty for the first
     * paint after a login. Guessing "probably allowed" here would hard-fail
     * that first render of every monitor page.
     */
    mockPermissions.all = [];

    expect(selectedColumns()).toEqual([]);
  });

  it("only ever names columns the server would actually let through", () => {
    /*
     * The property, rather than a role-by-role table: for any permission set,
     * every column this helper selects must pass the same intersection check
     * ColumnPermission runs server-side. If the two ever disagree, the page
     * 400s.
     */
    const permissionSets: Array<Array<Permission>> = [
      [],
      [Permission.Viewer],
      [Permission.MonitorViewer],
      [Permission.ReadProjectMonitor],
      [Permission.Viewer, Permission.MonitorViewer],
      [Permission.ProjectMember],
      [Permission.ProjectOwner, Permission.Viewer],
      [Permission.Viewer, Permission.EditProjectMonitor],
    ];

    for (const permissions of permissionSets) {
      mockPermissions.all = permissions;

      for (const column of selectedColumns()) {
        expect(
          PermissionHelper.doesPermissionsIntersect(
            permissions,
            accessControl[column]?.read || [],
          ),
        ).toBe(true);
      }
    }
  });

  it("covers every secret key column the Monitor model declares", () => {
    /*
     * If someone adds a fourth secret to Monitor and wires a page to select it
     * directly, this list goes stale and that page breaks for read-only users
     * exactly the way the first three did.
     */
    const declaredSecretColumns: Array<string> = Object.keys(
      accessControl,
    ).filter((column: string) => {
      return column.toLowerCase().endsWith("secretkey");
    });

    expect([...MONITOR_SECRET_KEY_COLUMNS].sort()).toEqual(
      declaredSecretColumns.sort(),
    );
  });
});
