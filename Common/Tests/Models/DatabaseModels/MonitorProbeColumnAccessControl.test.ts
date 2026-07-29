import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/2899
 *
 * Monitor > Probes is where a user goes to change which probe watches a
 * resource. The table is editable and declares a required "Probe" dropdown -
 * but MonitorProbe.probe and MonitorProbe.probeId are create-only, so ModelForm
 * applied the column's *update* ACL, found it empty, and dropped the field from
 * the form and from the request. The Edit modal opened with nothing but an
 * "Enabled" toggle, no message, and a "Save Changes" button; the table could
 * not delete either. So a probe attached by mistake was permanent, and every
 * attempt to change it looked like an edit that was thrown away.
 *
 * The fix keeps the columns create-only (a MonitorProbe row *is* the
 * assignment; replacing it means deleting the row) and instead marks the form
 * field doNotShowWhenEditing and turns row deletion on. These tests pin both
 * halves of that contract, because breaking either one silently restores the
 * original symptom.
 */

// What a signed-in project owner actually carries.
const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

/*
 * ModelForm.hasPermissionOnField, reproduced. It reads the create ACL on a
 * Create form and the update ACL on an Update form, and drops the field when
 * the user's permissions do not intersect it - with no error unless *every*
 * field is dropped.
 */
type WouldFormShowFieldFunction = (data: {
  accessControl: Record<string, ColumnAccessControl>;
  columnName: string;
  isUpdateForm: boolean;
  userPermissions: Array<Permission>;
}) => boolean;

const wouldFormShowField: WouldFormShowFieldFunction = (data: {
  accessControl: Record<string, ColumnAccessControl>;
  columnName: string;
  isUpdateForm: boolean;
  userPermissions: Array<Permission>;
}): boolean => {
  const column: ColumnAccessControl | undefined =
    data.accessControl[data.columnName];

  const fieldPermissions: Array<Permission> =
    (data.isUpdateForm ? column?.update : column?.create) || [];

  return PermissionHelper.doesPermissionsIntersect(
    data.userPermissions,
    fieldPermissions,
  );
};

describe("MonitorProbe column access control", () => {
  const accessControl: Record<string, ColumnAccessControl> =
    new MonitorProbe().getColumnAccessControlForAllColumns();

  it("lets a project owner choose the probe when attaching one", () => {
    expect(
      wouldFormShowField({
        accessControl,
        columnName: "probe",
        isUpdateForm: false,
        userPermissions: OWNER_PERMISSIONS,
      }),
    ).toBe(true);
  });

  it("keeps the probe relation create-only, so a row always points at one probe", () => {
    /*
     * This is the assumption Pages/Monitor/View/Probes.tsx has to encode with
     * doNotShowWhenEditing. If someone later gives these columns an update
     * ACL, that flag becomes wrong and should be removed with it.
     */
    expect(accessControl["probe"]?.update || []).toEqual([]);
    expect(accessControl["probeId"]?.update || []).toEqual([]);
  });

  it("would silently drop a Probe field from the edit form for anyone at all", () => {
    /*
     * The exact mechanism behind the bug report: not "you may not do that",
     * but a field that renders on create and vanishes on edit. Even a project
     * owner loses it - which is why the form must not offer it when editing.
     */
    const everyPermission: Array<Permission> = Object.values(Permission);

    expect(
      wouldFormShowField({
        accessControl,
        columnName: "probe",
        isUpdateForm: true,
        userPermissions: everyPermission,
      }),
    ).toBe(false);
  });

  it("still lets a project owner toggle isEnabled, so the edit form is not empty", () => {
    /*
     * ModelForm only surfaces a permission error when it drops *every* field.
     * isEnabled surviving is why the silent drop of "Probe" produced no
     * message at all.
     */
    expect(
      wouldFormShowField({
        accessControl,
        columnName: "isEnabled",
        isUpdateForm: true,
        userPermissions: OWNER_PERMISSIONS,
      }),
    ).toBe(true);
  });

  it("lets a user with only granular monitor-probe permissions manage the row", () => {
    const granularPermissions: Array<Permission> = [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
      Permission.CreateMonitorProbe,
      Permission.ReadMonitorProbe,
      Permission.EditMonitorProbe,
      Permission.DeleteMonitorProbe,
    ];

    expect(
      wouldFormShowField({
        accessControl,
        columnName: "probe",
        isUpdateForm: false,
        userPermissions: granularPermissions,
      }),
    ).toBe(true);

    expect(
      wouldFormShowField({
        accessControl,
        columnName: "isEnabled",
        isUpdateForm: true,
        userPermissions: granularPermissions,
      }),
    ).toBe(true);
  });

  it("reads back the probe relation, so the table can name the probe it shows", () => {
    for (const columnName of ["probe", "probeId", "isEnabled"]) {
      expect(
        PermissionHelper.doesPermissionsIntersect(
          OWNER_PERMISSIONS,
          accessControl[columnName]?.read || [],
        ),
      ).toBe(true);
    }
  });
});

describe("MonitorProbe table access control", () => {
  const model: MonitorProbe = new MonitorProbe();

  it("allows deletion, which is the only way to undo attaching the wrong probe", () => {
    /*
     * Monitor > Probes sets isDeleteable, and BaseModelTable gates that button
     * on these permissions. Without them the button never renders and the dead
     * end this issue reported comes straight back.
     */
    expect(model.deleteRecordPermissions).toContain(Permission.ProjectOwner);
    expect(model.deleteRecordPermissions).toContain(Permission.ProjectAdmin);
    expect(model.deleteRecordPermissions).toContain(
      Permission.DeleteMonitorProbe,
    );
  });

  it("allows creation, so the removed probe can be replaced with the right one", () => {
    expect(model.createRecordPermissions).toContain(
      Permission.CreateMonitorProbe,
    );
  });

  it("keeps the Edit button reachable for the roles that can update a row", () => {
    // BaseModelTable renders Edit on the table-level update permission.
    expect(
      PermissionHelper.doesPermissionsIntersect(
        OWNER_PERMISSIONS,
        model.updateRecordPermissions,
      ),
    ).toBe(true);
  });
});
