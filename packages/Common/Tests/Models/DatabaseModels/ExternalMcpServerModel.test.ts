import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * An external MCP server holds a credential to a system outside OneUptime -
 * an AWS or Azure account, a GitHub organization - and lets OneUptime AI use
 * that system's tools. So who may add one, what is ever read back, and what
 * only OneUptime writes are the model's to say, and these tests pin them:
 *
 *   - project owners and admins add, change, test and remove servers;
 *     everyone who reads the project's settings sees that they exist;
 *   - the token, the header values and the client secret are encrypted at
 *     rest and read by nobody (`read: []`): decryption happens on every
 *     server-side read, so one permission on a secret's read list would
 *     serve it in plaintext;
 *   - what a connection found (how the server talks, its tools, the last
 *     error) is written by OneUptime, never through the API;
 *   - the rules name their servers with the rules' own permissions, and a
 *     fix's tool calls are written by OneUptime alone.
 */

const ADMINS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const SECRETS: Array<string> = ["bearerToken", "headers", "oauthClientSecret"];

// What a connection found: OneUptime's to write.
const FOUND_BY_ONEUPTIME: Array<string> = [
  "transport",
  "serverName",
  "serverVersion",
  "protocolVersion",
  "tools",
  "lastCheckedAt",
  "lastConnectedAt",
  "lastError",
];

// What the people who set a server up write, and everyone who reads it sees.
const SETTINGS: Array<string> = [
  "name",
  "description",
  "url",
  "authType",
  "oauthTokenUrl",
  "oauthClientId",
  "oauthScope",
  "oauthAudience",
  "isEnabled",
];

const server: ExternalMcpServer = new ExternalMcpServer();
const access: Dictionary<ColumnAccessControl> =
  server.getColumnAccessControlForAllColumns();

function accessOf(column: string): ColumnAccessControl {
  const control: ColumnAccessControl | undefined = access[column];

  expect({ column, defined: control !== undefined }).toEqual({
    column,
    defined: true,
  });

  return control!;
}

describe("ExternalMcpServer: who sets a server up, and who sees it", () => {
  test("project owners and admins add, change and remove servers", () => {
    expect(server.getCreatePermissions()).toEqual(ADMINS);
    expect(server.getUpdatePermissions()).toEqual(ADMINS);
    expect(server.getDeletePermissions()).toEqual(ADMINS);
  });

  test("members and viewers see the servers, and nobody else is named", () => {
    expect(server.getReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
  });

  test("a server is a project's: the tenant column is projectId", () => {
    expect(server.getTenantColumn()).toBe("projectId");
  });

  test("adding or changing a server takes the Growth plan; seeing or removing one does not", () => {
    expect(server.getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(server.getUpdateBillingPlan()).toBe(PlanType.Growth);
    expect(server.getReadBillingPlan()).toBe(PlanType.Free);
    expect(server.getDeleteBillingPlan()).toBe(PlanType.Free);
  });

  test("its settings are written by owners and admins and read by everyone who sees it", () => {
    for (const column of SETTINGS) {
      const control: ColumnAccessControl = accessOf(column);

      expect({ column, create: control.create }).toEqual({
        column,
        create: ADMINS,
      });
      expect({ column, update: control.update }).toEqual({
        column,
        update: ADMINS,
      });
      expect({ column, read: control.read }).toEqual({
        column,
        read: server.getReadPermissions(),
      });
    }
  });
});

describe("ExternalMcpServer: what a create may leave out", () => {
  /*
   * The API reference says Authentication defaults to None and a new server
   * is on: an API or Terraform client that leaves them out gets those, from
   * the columns' Postgres defaults, rather than "is required".
   */
  test("Authentication and Enabled, which Postgres fills in", () => {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(server);

    expect(columns["authType"]).toMatchObject({
      required: true,
      defaultValue: "None",
      isDefaultValueColumn: true,
    });
    expect(columns["isEnabled"]).toMatchObject({
      required: true,
      defaultValue: true,
      isDefaultValueColumn: true,
    });
  });
});

describe("ExternalMcpServer: its secrets", () => {
  test("are encrypted at rest", () => {
    const encrypted: Array<string> = server.getEncryptedColumns().columns;

    for (const column of SECRETS) {
      expect(encrypted).toContain(column);
    }
  });

  test("are never read back, by anyone, through the CRUD read path", () => {
    for (const column of SECRETS) {
      expect({ column, read: accessOf(column).read }).toEqual({
        column,
        read: [],
      });
    }
  });

  test("stay writable by owners and admins, so they can be set and rotated", () => {
    for (const column of SECRETS) {
      expect({ column, create: accessOf(column).create }).toEqual({
        column,
        create: ADMINS,
      });
      expect({ column, update: accessOf(column).update }).toEqual({
        column,
        update: ADMINS,
      });
    }
  });

  test("the header names are worked out on every read, and written by nobody", () => {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(server);

    expect(columns["headerNames"]?.computed).toBe(true);
    expect(accessOf("headerNames")).toEqual({
      create: [],
      read: server.getReadPermissions(),
      update: [],
    });
  });

  test("every other column is read back: only the secrets, and who deleted a server, are not", () => {
    const unreadable: Array<string> = Object.entries(access)
      .filter(([, control]: [string, ColumnAccessControl]) => {
        return control.read.length === 0;
      })
      .map(([column]: [string, ColumnAccessControl]) => {
        return column;
      })
      .sort();

    expect(unreadable).toEqual(
      [...SECRETS, "deletedByUser", "deletedByUserId"].sort(),
    );
  });
});

describe("ExternalMcpServer: what a connection found", () => {
  test("is OneUptime's to write, never the API's", () => {
    for (const column of FOUND_BY_ONEUPTIME) {
      const control: ColumnAccessControl = accessOf(column);

      expect({
        column,
        create: control.create,
        update: control.update,
      }).toEqual({ column, create: [], update: [] });
      expect({ column, read: control.read }).toEqual({
        column,
        read: server.getReadPermissions(),
      });
    }
  });

  test("keeps the tools as JSON and the last error as text", () => {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(server);

    expect(columns["tools"]?.type).toBe(TableColumnType.JSON);
    expect(columns["lastError"]?.type).toBe(TableColumnType.VeryLongText);
  });
});

describe("the rules' MCP servers and a fix's tool calls", () => {
  test("an AI rule names its servers - to investigate and to fix - with the rule's own permissions", () => {
    const rule: AutoRemediationRule = new AutoRemediationRule();
    const control: ColumnAccessControl | undefined =
      rule.getColumnAccessControlForAllColumns()["externalMcpServers"];

    expect(control?.create).toEqual(rule.getCreatePermissions());
    expect(control?.update).toEqual(rule.getUpdatePermissions());
    expect(control?.read).toEqual(rule.getReadPermissions());
    expect(rule.isEntityColumn("externalMcpServers")).toBe(true);
    expect(getTableColumns(rule)["externalMcpServers"]?.type).toBe(
      TableColumnType.EntityArray,
    );
  });

  test("an AI rule's servers say they serve its investigation too", () => {
    expect(
      getTableColumns(new AutoRemediationRule())["externalMcpServers"]
        ?.description,
    ).toContain("investigates and fixes");
  });

  test("a fix's tool calls are written by OneUptime alone, and read by the project's members", () => {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    const control: ColumnAccessControl | undefined =
      suggestion.getColumnAccessControlForAllColumns()["mcpToolCallPlan"];

    expect(control).toEqual({
      create: [],
      read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
      ],
      update: [],
    });
    expect(getTableColumns(suggestion)["mcpToolCallPlan"]?.type).toBe(
      TableColumnType.JSON,
    );
  });
});
