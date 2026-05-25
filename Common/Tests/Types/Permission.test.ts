import ObjectID from "../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../Types/Permission";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";

describe("Permission", () => {
  test("Permission.ProjectMember should be ProjectMember", () => {
    expect(Permission.ProjectMember).toBe("ProjectMember");
  });

  test("Permission.Public should be Public", () => {
    expect(Permission.Public).toBe("Public");
  });
});

const makeRow: (
  permission: Permission,
  scope: PermissionScope | undefined,
  labelIds?: Array<ObjectID>,
) => UserPermission = (
  permission: Permission,
  scope: PermissionScope | undefined,
  labelIds: Array<ObjectID> = [],
): UserPermission => {
  return {
    _type: "UserPermission",
    permission,
    labelIds,
    scope,
  };
};

describe("PermissionHelper label/scope filtering", () => {
  /*
   * Regression coverage for the bug where a team permission with
   * scope=Labels on a role permission (IncidentViewer, MonitorViewer,
   * Viewer, …) was treated as an unconditional grant because the
   * legacy filter consulted the per-permission `isAccessControlPermission`
   * flag instead of the explicit scope on the row.
   */

  test("getNonAccessControlPermissions: scope=All counts as unrestricted", () => {
    const rows: Array<UserPermission> = [
      makeRow(Permission.IncidentViewer, PermissionScope.All, []),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([
      Permission.IncidentViewer,
    ]);
  });

  test("getNonAccessControlPermissions: scope=Labels with labels is restricted (NOT included)", () => {
    const labelId: ObjectID = ObjectID.generate();
    const rows: Array<UserPermission> = [
      makeRow(Permission.IncidentViewer, PermissionScope.Labels, [labelId]),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([]);
  });

  test("getNonAccessControlPermissions: scope=Labels with empty labels is treated as unrestricted (legacy parity)", () => {
    const rows: Array<UserPermission> = [
      makeRow(Permission.IncidentViewer, PermissionScope.Labels, []),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([
      Permission.IncidentViewer,
    ]);
  });

  test("getNonAccessControlPermissions: scope=Owned is excluded (OwnedScope handles it)", () => {
    const rows: Array<UserPermission> = [
      makeRow(Permission.IncidentViewer, PermissionScope.Owned, []),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([]);
  });

  test("getNonAccessControlPermissions: legacy row (scope undefined, no labels) is unrestricted", () => {
    const rows: Array<UserPermission> = [
      makeRow(Permission.CurrentUser, undefined, []),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([
      Permission.CurrentUser,
    ]);
  });

  test("getAccessControlPermissions: role permission with scope=Labels + labels is collected", () => {
    const labelId: ObjectID = ObjectID.generate();
    const row: UserPermission = makeRow(
      Permission.IncidentViewer,
      PermissionScope.Labels,
      [labelId],
    );
    expect(PermissionHelper.getAccessControlPermissions([row])).toEqual([row]);
  });

  test("getAccessControlPermissions: granular permission with scope=Labels + labels is collected", () => {
    const labelId: ObjectID = ObjectID.generate();
    const row: UserPermission = makeRow(
      Permission.ReadProjectIncident,
      PermissionScope.Labels,
      [labelId],
    );
    expect(PermissionHelper.getAccessControlPermissions([row])).toEqual([row]);
  });

  test("getAccessControlPermissions: scope=All with labels is NOT collected (All wins over labels)", () => {
    const labelId: ObjectID = ObjectID.generate();
    const row: UserPermission = makeRow(
      Permission.IncidentViewer,
      PermissionScope.All,
      [labelId],
    );
    expect(PermissionHelper.getAccessControlPermissions([row])).toEqual([]);
  });

  test("getAccessControlPermissions: scope=Owned never contributes a label filter", () => {
    const labelId: ObjectID = ObjectID.generate();
    const row: UserPermission = makeRow(
      Permission.IncidentViewer,
      PermissionScope.Owned,
      [labelId],
    );
    expect(PermissionHelper.getAccessControlPermissions([row])).toEqual([]);
  });

  test("Mixed: All row on a different permission does NOT suppress a Labels row's filter", () => {
    const labelId: ObjectID = ObjectID.generate();
    const rows: Array<UserPermission> = [
      makeRow(Permission.MonitorViewer, PermissionScope.All, []),
      makeRow(Permission.IncidentViewer, PermissionScope.Labels, [labelId]),
    ];
    expect(PermissionHelper.getNonAccessControlPermissions(rows)).toEqual([
      Permission.MonitorViewer,
    ]);
    expect(PermissionHelper.getAccessControlPermissions(rows)).toEqual([
      rows[1],
    ]);
  });
});
