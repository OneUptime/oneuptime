import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import WorkflowVariable from "../../../../../Models/DatabaseModels/WorkflowVariable";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * Who may read and write the columns an OAuth 2.0 workflow variable adds.
 *
 * The access token is the credential a workflow sends to someone else's API,
 * and the client secret and refresh token are what mint more of them. None of
 * the three may ever come back out through the API - not to a project owner,
 * not in a list, not in an edit form's prefetch. The bookkeeping OneUptime
 * writes while it manages the token (expiry, last refresh, last error) is
 * readable but belongs to OneUptime alone. The variable's type and grant are
 * fixed at creation.
 */

const projectId: ObjectID = ObjectID.generate();

function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: ObjectID.generate(),
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function check(
  requestType: DatabaseRequestType,
  data: Record<string, unknown>,
  permissions: Array<Permission>,
): () => void {
  return () => {
    ColumnPermissions.checkDataColumnPermissions(
      WorkflowVariable,
      data as unknown as WorkflowVariable,
      makeProps(permissions),
      requestType,
    );
  };
}

function accessControl(column: string): ColumnAccessControl {
  const control: ColumnAccessControl | undefined =
    new WorkflowVariable().getColumnAccessControlForAllColumns()[column];

  if (!control) {
    throw new Error(`No ColumnAccessControl on ${column}`);
  }

  return control;
}

const SECRET_COLUMNS: Array<string> = [
  "oauthClientSecret",
  "oauthRefreshToken",
  "oauthAccessToken",
];

const MANAGED_COLUMNS: Array<string> = [
  "oauthAccessToken",
  "oauthAccessTokenExpiresAt",
  "oauthLastRefreshedAt",
  "oauthLastRefreshError",
  "oauthLastRefreshErrorAt",
];

const EDITABLE_SETTINGS: Array<string> = [
  "oauthTokenUrl",
  "oauthClientId",
  "oauthClientSecret",
  "oauthRefreshToken",
  "oauthScope",
  "oauthAdditionalParameters",
  "oauthClientAuthenticationMethod",
];

describe("ColumnPermissions on WorkflowVariable's OAuth columns", () => {
  describe("harness guard", () => {
    /*
     * Every "does not throw" below would also pass with a broken props factory
     * that yields no permissions. This one has to throw.
     */
    it("refuses a read-only key that writes a setting", () => {
      expect(
        check(DatabaseRequestType.Update, { oauthScope: "api.read" }, [
          Permission.ReadWorkflowVariable,
        ]),
      ).toThrow(BadDataException);
    });
  });

  it.each(SECRET_COLUMNS)(
    "%s can never be read, by anyone",
    (column: string) => {
      expect(accessControl(column).read).toEqual([]);
    },
  );

  it.each(SECRET_COLUMNS)("%s is encrypted at rest", (column: string) => {
    expect(new WorkflowVariable().getEncryptedColumns().columns).toContain(
      column,
    );
  });

  it.each(MANAGED_COLUMNS)(
    "%s is written by OneUptime only - nobody may create or update it",
    (column: string) => {
      expect(accessControl(column).create).toEqual([]);
      expect(accessControl(column).update).toEqual([]);
    },
  );

  it("a project owner cannot write the access token", () => {
    expect(
      check(DatabaseRequestType.Update, { oauthAccessToken: "forged" }, [
        Permission.ProjectOwner,
      ]),
    ).toThrow(
      "User is not allowed to update on oauthAccessToken column of Workflow Variable",
    );

    expect(
      check(DatabaseRequestType.Create, { oauthAccessToken: "forged" }, [
        Permission.ProjectOwner,
      ]),
    ).toThrow(BadDataException);
  });

  it("a project owner cannot fake a token's expiry or a refresh", () => {
    for (const column of [
      "oauthAccessTokenExpiresAt",
      "oauthLastRefreshedAt",
      "oauthLastRefreshError",
    ]) {
      expect(
        check(DatabaseRequestType.Update, { [column]: new Date() }, [
          Permission.ProjectOwner,
        ]),
      ).toThrow(BadDataException);
    }
  });

  it.each([
    "oauthAccessTokenExpiresAt",
    "oauthLastRefreshedAt",
    "oauthLastRefreshError",
    "oauthLastRefreshErrorAt",
    "variableType",
    "oauthGrantType",
    "oauthTokenUrl",
    "oauthClientId",
    "oauthScope",
  ])(
    "%s is readable by whoever may read the variable, like its name",
    (column: string) => {
      expect([...(accessControl(column).read || [])].sort()).toEqual(
        [...(accessControl("name").read || [])].sort(),
      );
    },
  );

  it.each(["variableType", "oauthGrantType"])(
    "%s is fixed once the variable exists",
    (column: string) => {
      expect(accessControl(column).update).toEqual([]);
      expect(
        check(DatabaseRequestType.Update, { [column]: "anything" }, [
          Permission.ProjectOwner,
        ]),
      ).toThrow(BadDataException);
    },
  );

  /*
   * The same keys that may edit a Static variable's content may edit an OAuth
   * variable's settings - a key rotating a credential must be able to reach
   * the column it rotates.
   */
  it.each(EDITABLE_SETTINGS)(
    "%s may be updated by a key holding EditWorkflowVariable",
    (column: string) => {
      expect(accessControl(column).update).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.EditWorkflowVariable,
        ]),
      );

      expect(
        check(DatabaseRequestType.Update, { [column]: "value" }, [
          Permission.EditWorkflowVariable,
        ]),
      ).not.toThrow();
    },
  );

  it("an OAuth variable can be created with every setting by a key holding CreateWorkflowVariable", () => {
    expect(
      check(
        DatabaseRequestType.Create,
        {
          name: "API_TOKEN",
          variableType: "OAuth 2.0",
          oauthGrantType: "Client Credentials",
          oauthTokenUrl: "https://login.example.com/token",
          oauthClientId: "client",
          oauthClientSecret: "secret",
          oauthRefreshToken: "refresh",
          oauthScope: "scope",
          oauthAdditionalParameters: { audience: "x" },
          oauthClientAuthenticationMethod: "HTTP Basic Header",
        },
        [Permission.CreateWorkflowVariable],
      ),
    ).not.toThrow();
  });

  it("content stays write-only and unencrypted, as before", () => {
    expect(accessControl("content").read).toEqual([]);
    expect(new WorkflowVariable().getEncryptedColumns().columns).not.toContain(
      "content",
    );
  });
});
