import Probe from "../../../Models/DatabaseModels/Probe";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Permission from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * Several Probe columns were gated on status-page permissions
 * (Create/Read/EditProjectStatusPage) instead of the probe ones. The table
 * itself is gated on Create/Read/Edit/DeleteProjectProbe, so a team granted
 * only granular probe permissions could open the probe edit form and change
 * "Enable monitoring automatically on new monitors" - and ModelForm would drop
 * the field from both the form and the request, with no error. The toggle
 * looked unset afterwards, and the probe never got attached to new monitors.
 *
 * Any Probe column gated on a status-page permission is a copy-paste bug, so
 * this asserts the absence outright rather than listing today's offenders.
 */

const STATUS_PAGE_PERMISSIONS: Array<Permission> = [
  Permission.CreateProjectStatusPage,
  Permission.ReadProjectStatusPage,
  Permission.EditProjectStatusPage,
  Permission.DeleteProjectStatusPage,
];

describe("Probe column access control", () => {
  const accessControl: Record<string, ColumnAccessControl> =
    new Probe().getColumnAccessControlForAllColumns();

  it("never gates a probe column on a status page permission", () => {
    const offenders: Array<string> = [];

    for (const columnName of Object.keys(accessControl)) {
      const column: ColumnAccessControl | undefined = accessControl[columnName];

      const allPermissions: Array<Permission> = [
        ...(column?.create || []),
        ...(column?.read || []),
        ...(column?.update || []),
      ];

      for (const permission of allPermissions) {
        if (STATUS_PAGE_PERMISSIONS.includes(permission)) {
          offenders.push(`${columnName}: ${permission}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("lets a user with granular probe permissions edit the auto-enable toggle", () => {
    const column: ColumnAccessControl | undefined =
      accessControl["shouldAutoEnableProbeOnNewMonitors"];

    expect(column).toBeDefined();
    expect(column!.update).toContain(Permission.EditProjectProbe);
    expect(column!.read).toContain(Permission.ReadProjectProbe);
    expect(column!.create).toContain(Permission.CreateProjectProbe);
  });

  it("keeps every field on the probe edit form readable and writable by a project owner", () => {
    /*
     * Every field the "Probe Details" card edits. If any of these stops
     * intersecting a project owner's permissions, editing a probe silently
     * stops working for the person who created it - which is exactly how the
     * original bug presented.
     */
    const editableColumns: Array<string> = [
      "name",
      "description",
      "iconFile",
      "shouldAutoEnableProbeOnNewMonitors",
      "labels",
    ];

    // What a signed-in project owner actually carries.
    const ownerPermissions: Array<Permission> = [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.ProjectOwner,
    ];

    for (const columnName of editableColumns) {
      const column: ColumnAccessControl | undefined = accessControl[columnName];

      expect(column).toBeDefined();

      expect(
        (column!.update || []).some((permission: Permission) => {
          return ownerPermissions.includes(permission);
        }),
      ).toBe(true);

      expect(
        (column!.read || []).some((permission: Permission) => {
          return ownerPermissions.includes(permission);
        }),
      ).toBe(true);
    }
  });
});
