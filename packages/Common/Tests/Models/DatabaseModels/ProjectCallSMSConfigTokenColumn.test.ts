import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TWILIO AUTH TOKEN IS A SECRET, AND THE ACCOUNT SID IS AN IDENTIFIER.
 *
 * The auth token sends calls and SMS on the customer's Twilio account, so it
 * is read only by the roles that own a project's call and SMS settings - its
 * owners and admins and whoever is explicitly granted Read Call and SMS - and
 * stored encrypted at rest. The broad read-only roles that may see the rest
 * of the config (a plain member, a viewer, the settings roles) may not read
 * the token. The account SID identifies the account but cannot authenticate
 * without the token, so it stays readable by that wider audience, exactly as
 * the SMTP username does beside its password.
 *
 * This holds the model to that, so a later edit cannot quietly widen the
 * token's readers or drop its encryption.
 */

const model: ProjectCallSMSConfig = new ProjectCallSMSConfig();

// The roles that may read the rest of the config but not the token.
const BROAD_READ_ONLY_ROLES: Array<Permission> = [
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
];

describe("ProjectCallSMSConfig.twilioAuthToken", () => {
  const tokenAccess: ColumnAccessControl | null =
    model.getColumnAccessControlFor("twilioAuthToken");
  const tokenColumn: TableColumnMetadata =
    model.getTableColumnMetadata("twilioAuthToken");

  test("is read only by owners, admins and Read Call and SMS", () => {
    expect(tokenAccess).not.toBeNull();
    expect([...(tokenAccess!.read || [])].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ReadProjectCallSMSConfig,
      ].sort(),
    );
  });

  test("none of the broad read-only roles may read it", () => {
    for (const role of BROAD_READ_ONLY_ROLES) {
      expect(tokenAccess!.read).not.toContain(role);
    }
  });

  test("is stored encrypted at rest", () => {
    expect(tokenColumn.encrypted).toBe(true);
  });

  test("is still writable by owners, admins and Edit Call and SMS", () => {
    expect([...(tokenAccess!.update || [])].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditProjectCallSMSConfig,
      ].sort(),
    );
  });
});

describe("ProjectCallSMSConfig.twilioAccountSID", () => {
  const sidAccess: ColumnAccessControl | null =
    model.getColumnAccessControlFor("twilioAccountSID");
  const sidColumn: TableColumnMetadata =
    model.getTableColumnMetadata("twilioAccountSID");

  test("stays readable by the config's wider audience (an identifier, not a credential)", () => {
    expect(sidAccess).not.toBeNull();
    for (const role of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      ...BROAD_READ_ONLY_ROLES,
      Permission.ReadProjectCallSMSConfig,
    ]) {
      expect(sidAccess!.read).toContain(role);
    }
  });

  test("is not itself encrypted (it carries no secret on its own)", () => {
    expect(sidColumn.encrypted).toBeFalsy();
  });
});
