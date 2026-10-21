import PropsHoldingOnly from "../../../../Server/Utils/Permission/PropsHoldingOnly";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";

/*
 * PropsHoldingOnly.build keeps a caller's identity but narrows what they
 * hold to their rows of the named permissions in one project - allow and
 * block rows alike - with no global permissions, so that a check of what
 * ONE grant reaches is not widened by any other grant the caller holds.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "9c1f2d3e-1111-4222-8333-444455556666",
);
const USER_ID: ObjectID = new ObjectID("1b2c3d4e-0000-4000-8000-000000000001");
const LABEL_ID: ObjectID = new ObjectID("1b2c3d4e-0000-4000-8000-0000000000aa");

function row(
  permission: Permission,
  options?: { block?: boolean; labelIds?: Array<ObjectID> },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelIds || [],
    isBlockPermission: Boolean(options?.block),
  };
}

function propsWithRows(data: {
  projectRows: Array<UserPermission>;
  otherProjectRows?: Array<UserPermission>;
  globalPermissions?: Array<Permission>;
}): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      globalPermissions: data.globalPermissions || [
        Permission.Public,
        Permission.CurrentUser,
      ],
      projectIds: [PROJECT_ID, OTHER_PROJECT_ID],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: data.projectRows,
      },
      [OTHER_PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: OTHER_PROJECT_ID,
        permissions: data.otherProjectRows || [],
      },
    },
  };
}

function rowsOf(
  props: DatabaseCommonInteractionProps,
  projectId: ObjectID = PROJECT_ID,
): Array<UserPermission> {
  return (
    props.userTenantAccessPermission?.[projectId.toString()]?.permissions || []
  );
}

describe("PropsHoldingOnly.build", () => {
  test("keeps only the rows of the named permissions", () => {
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({
        projectRows: [
          row(Permission.WorkflowMember),
          row(Permission.ProjectMember),
          row(Permission.ProjectAdmin),
        ],
      }),
      projectId: PROJECT_ID,
      permissions: [Permission.WorkflowMember],
    });

    expect(
      rowsOf(props).map((r: UserPermission) => {
        return r.permission;
      }),
    ).toEqual([Permission.WorkflowMember]);
  });

  test("keeps block rows of the named permissions as well as allow rows", () => {
    const allow: UserPermission = row(Permission.RunbookMember, {
      labelIds: [LABEL_ID],
    });
    const block: UserPermission = row(Permission.RunbookMember, {
      block: true,
      labelIds: [LABEL_ID],
    });

    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({
        projectRows: [allow, block, row(Permission.ProjectMember)],
      }),
      projectId: PROJECT_ID,
      permissions: [Permission.RunbookMember],
    });

    // Allow rows are read first, then block rows - each as it was, labels included.
    expect(rowsOf(props)).toEqual([allow, block]);
  });

  test("keeps rows for every named permission", () => {
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({
        projectRows: [
          row(Permission.WorkflowMember),
          row(Permission.ProjectAdmin),
          row(Permission.RunbookMember),
        ],
      }),
      projectId: PROJECT_ID,
      permissions: [Permission.WorkflowMember, Permission.RunbookMember],
    });

    expect(
      rowsOf(props).map((r: UserPermission) => {
        return r.permission;
      }),
    ).toEqual([Permission.WorkflowMember, Permission.RunbookMember]);
  });

  test("holds no rows when the caller has none of the named permissions", () => {
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({
        projectRows: [row(Permission.ProjectAdmin)],
      }),
      projectId: PROJECT_ID,
      permissions: [Permission.WorkflowMember],
    });

    expect(rowsOf(props)).toEqual([]);
  });

  test("holds no rows when asked for no permissions at all", () => {
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({
        projectRows: [row(Permission.ProjectAdmin)],
      }),
      projectId: PROJECT_ID,
      permissions: [],
    });

    expect(rowsOf(props)).toEqual([]);
  });

  test("drops every global permission, keeping only the project", () => {
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({
        projectRows: [row(Permission.WorkflowMember)],
        globalPermissions: [
          Permission.Public,
          Permission.CurrentUser,
          Permission.ProjectAdmin,
        ],
      }),
      projectId: PROJECT_ID,
      permissions: [Permission.WorkflowMember],
    });

    expect(props.userGlobalAccessPermission).toEqual({
      _type: "UserGlobalAccessPermission",
      globalPermissions: [],
      projectIds: [PROJECT_ID],
    });
  });

  test("a global permission named among the permissions does not come back as a project row unless everyone holds it", () => {
    // The caller's own global ProjectAdmin is discarded before rows are read.
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({
        projectRows: [],
        globalPermissions: [Permission.Public, Permission.ProjectAdmin],
      }),
      projectId: PROJECT_ID,
      permissions: [Permission.ProjectAdmin],
    });

    expect(rowsOf(props)).toEqual([]);
  });

  test("Public, which every caller holds, comes back as an allow row when named", () => {
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({ projectRows: [] }),
      projectId: PROJECT_ID,
      permissions: [Permission.Public, Permission.CurrentUser],
    });

    // The caller has a userId, so CurrentUser is held by them as well.
    expect(rowsOf(props)).toEqual([
      row(Permission.Public),
      row(Permission.CurrentUser),
    ]);
  });

  test("reads the rows of the named project, not of the request's tenant", () => {
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({
        projectRows: [row(Permission.ProjectAdmin)],
        otherProjectRows: [row(Permission.WorkflowMember)],
      }),
      projectId: OTHER_PROJECT_ID,
      permissions: [Permission.WorkflowMember, Permission.ProjectAdmin],
    });

    expect(props.tenantId).toEqual(OTHER_PROJECT_ID);
    expect(Object.keys(props.userTenantAccessPermission || {})).toEqual([
      OTHER_PROJECT_ID.toString(),
    ]);
    expect(
      rowsOf(props, OTHER_PROJECT_ID).map((r: UserPermission) => {
        return r.permission;
      }),
    ).toEqual([Permission.WorkflowMember]);
  });

  test("holds only the named project's access, never another project's", () => {
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: propsWithRows({
        projectRows: [row(Permission.WorkflowMember)],
        otherProjectRows: [row(Permission.WorkflowMember)],
      }),
      projectId: PROJECT_ID,
      permissions: [Permission.WorkflowMember],
    });

    expect(props.userTenantAccessPermission).toEqual({
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [row(Permission.WorkflowMember)],
      },
    });
  });

  test("a caller with no access to the project holds nothing in it", () => {
    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: {
        userId: USER_ID,
        userType: UserType.User,
      },
      projectId: PROJECT_ID,
      permissions: [Permission.WorkflowMember],
    });

    expect(props.tenantId).toEqual(PROJECT_ID);
    expect(rowsOf(props)).toEqual([]);
  });

  test("keeps who the caller is", () => {
    const teamId: ObjectID = new ObjectID(
      "1b2c3d4e-0000-4000-8000-0000000000bb",
    );

    const props: DatabaseCommonInteractionProps = PropsHoldingOnly.build({
      databaseProps: {
        ...propsWithRows({ projectRows: [row(Permission.WorkflowMember)] }),
        isRoot: false,
        isMasterAdmin: false,
        userTeamIds: [teamId],
      },
      projectId: PROJECT_ID,
      permissions: [Permission.WorkflowMember],
    });

    expect(props.userId).toEqual(USER_ID);
    expect(props.userType).toBe(UserType.User);
    expect(props.userTeamIds).toEqual([teamId]);
    expect(props.isRoot).toBe(false);
  });

  test("does not change the props it was given", () => {
    const databaseProps: DatabaseCommonInteractionProps = propsWithRows({
      projectRows: [
        row(Permission.WorkflowMember),
        row(Permission.ProjectAdmin),
      ],
    });
    const globalBefore: UserGlobalAccessPermission | undefined =
      databaseProps.userGlobalAccessPermission;
    const snapshot: string = JSON.stringify(databaseProps);

    PropsHoldingOnly.build({
      databaseProps: databaseProps,
      projectId: PROJECT_ID,
      permissions: [Permission.WorkflowMember],
    });

    expect(databaseProps.userGlobalAccessPermission).toBe(globalBefore);
    expect(JSON.stringify(databaseProps)).toBe(snapshot);
  });
});
