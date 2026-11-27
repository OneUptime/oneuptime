import ExternalMcpToolReadOnlyMark from "../../../Models/DatabaseModels/ExternalMcpToolReadOnlyMark";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";

/*
 * ISSUE #11081: A PROJECT ADMIN'S READ-ONLY MARK ON AN EXTERNAL MCP SERVER'S
 * TOOL. A mark lets OneUptime AI call the tool with nobody asking, so the
 * model pins who may make one and what it is:
 *
 *   - only Project Owners and Project Admins mark a tool, or take a mark
 *     away - the people who set the servers up - and the real permission
 *     check refuses a Member, a Viewer and a team's block;
 *   - a mark is never changed (no update), only made and taken away, so
 *     its who and when stay what they were;
 *   - who made it is OneUptime's to say (createdByUserId), never the
 *     request's; whoever sees the servers sees the marks;
 *   - it belongs to the project (the tenant column) and goes with its
 *     server.
 */

const ADMINS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

const PROJECT_ID: ObjectID = new ObjectID(
  "11081000-0000-4000-8000-0000000000f1",
);

const mark: ExternalMcpToolReadOnlyMark = new ExternalMcpToolReadOnlyMark();
const access: Dictionary<ColumnAccessControl> =
  mark.getColumnAccessControlForAllColumns();

function accessOf(column: string): ColumnAccessControl {
  const control: ColumnAccessControl | undefined = access[column];

  expect({ column, defined: control !== undefined }).toEqual({
    column,
    defined: true,
  });

  return control!;
}

function propsOf(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): DatabaseCommonInteractionProps {
  const row: (isBlock: boolean) => (permission: Permission) => JSONObject = (
    isBlock: boolean,
  ) => {
    return (permission: Permission): JSONObject => {
      return {
        permission,
        labelIds: [],
        isBlockPermission: isBlock,
        _type: "UserPermission",
      };
    };
  };

  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          ...permissions.map(row(false)),
          ...blocked.map(row(true)),
        ],
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

// A mark as the Dashboard sends it: the server and the tool, nothing else.
function sentMark(): ExternalMcpToolReadOnlyMark {
  const sent: ExternalMcpToolReadOnlyMark = new ExternalMcpToolReadOnlyMark();
  sent.externalMcpServerId = ObjectID.generate();
  sent.toolName = "k8s_get_resources";
  return sent;
}

function refusesCreate(props: DatabaseCommonInteractionProps): boolean {
  try {
    ModelPermission.checkTableWritePermission(
      ExternalMcpToolReadOnlyMark,
      props,
      DatabaseRequestType.Create,
    );
    ModelPermission.checkCreatePermissions(
      ExternalMcpToolReadOnlyMark,
      sentMark(),
      props,
    );
    return false;
  } catch {
    return true;
  }
}

function refusesWrite(
  props: DatabaseCommonInteractionProps,
  type: DatabaseRequestType.Update | DatabaseRequestType.Delete,
): boolean {
  try {
    ModelPermission.checkTableWritePermission(
      ExternalMcpToolReadOnlyMark,
      props,
      type,
      type === DatabaseRequestType.Update
        ? { toolFingerprint: "0".repeat(64) }
        : undefined,
    );
    return false;
  } catch {
    return true;
  }
}

describe("who marks a tool read-only", () => {
  test("Project Owners and Project Admins mark tools and take marks away", () => {
    expect(mark.getCreatePermissions()).toEqual(ADMINS);
    expect(mark.getDeletePermissions()).toEqual(ADMINS);
  });

  test("nobody changes a mark: marking again makes a new one", () => {
    expect(mark.getUpdatePermissions()).toEqual([]);
  });

  test("everyone who sees the project's servers sees which tools are marked", () => {
    expect(mark.getReadPermissions()).toEqual(READERS);
    expect(mark.getReadPermissions()).toEqual(
      new ExternalMcpServer().getReadPermissions(),
    );
  });

  test("the same people who set servers up, and nobody else", () => {
    expect(mark.getCreatePermissions()).toEqual(
      new ExternalMcpServer().getCreatePermissions(),
    );
  });

  test.each([
    ["a Project Owner", [Permission.ProjectOwner]],
    ["a Project Admin", [Permission.ProjectAdmin]],
  ])(
    "the real create check lets %s mark one",
    (_who: string, permissions: Array<Permission>) => {
      expect(refusesCreate(propsOf(permissions))).toBe(false);
    },
  );

  test.each([
    ["a Project Member", [Permission.ProjectMember]],
    ["a Viewer", [Permission.Viewer]],
    ["someone with no role", []],
    [
      "a Member who reads every external MCP server",
      [Permission.ProjectMember, Permission.Viewer],
    ],
  ])(
    "the real create check refuses %s: non-admins can't mark a tool",
    (_who: string, permissions: Array<Permission>) => {
      expect(refusesCreate(propsOf(permissions))).toBe(true);
    },
  );

  test("a Project Admin whose team blocks Project Admin is refused too", () => {
    expect(
      refusesCreate(
        propsOf([Permission.ProjectAdmin], [Permission.ProjectAdmin]),
      ),
    ).toBe(true);
  });

  test("a Member cannot take a mark away; an Admin can", () => {
    expect(
      refusesWrite(
        propsOf([Permission.ProjectMember]),
        DatabaseRequestType.Delete,
      ),
    ).toBe(true);
    expect(
      refusesWrite(
        propsOf([Permission.ProjectAdmin]),
        DatabaseRequestType.Delete,
      ),
    ).toBe(false);
  });

  test("not even an Owner changes a mark in place", () => {
    expect(
      refusesWrite(
        propsOf([Permission.ProjectOwner]),
        DatabaseRequestType.Update,
      ),
    ).toBe(true);
  });
});

describe("what a mark is", () => {
  test("a project's: the tenant column is projectId", () => {
    expect(mark.getTenantColumn()).toBe("projectId");
  });

  test("on the plans that sell external MCP servers", () => {
    expect(mark.getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(mark.getReadBillingPlan()).toBe(PlanType.Free);
    expect(mark.getDeleteBillingPlan()).toBe(PlanType.Free);
  });

  test("reached through its own CRUD route", () => {
    expect(mark.getCrudApiPath()?.toString()).toBe(
      "/external-mcp-tool-read-only-mark",
    );
  });

  test("names its server and its tool, and holds the definition it was made for", () => {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(mark);

    expect(columns["externalMcpServerId"]).toMatchObject({
      type: TableColumnType.ObjectID,
      required: true,
    });
    expect(columns["externalMcpServer"]).toMatchObject({
      type: TableColumnType.Entity,
      modelType: ExternalMcpServer,
    });
    expect(columns["toolName"]).toMatchObject({ required: true });
    expect(columns["toolFingerprint"]).toMatchObject({ required: true });
  });

  test("its server, its tool and the definition are written once, when it is made, by those who may make it", () => {
    for (const column of [
      "projectId",
      "project",
      "externalMcpServerId",
      "externalMcpServer",
      "toolName",
      "toolFingerprint",
    ]) {
      expect({ column, access: accessOf(column) }).toEqual({
        column,
        access: { create: ADMINS, read: READERS, update: [] },
      });
    }
  });

  test("who made it is OneUptime's to write, and everyone who sees it reads it", () => {
    for (const column of ["createdByUserId", "createdByUser"]) {
      expect({ column, access: accessOf(column) }).toEqual({
        column,
        access: { create: [], read: READERS, update: [] },
      });
    }
  });
});
