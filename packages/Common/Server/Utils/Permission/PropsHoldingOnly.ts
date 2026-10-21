import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";

/*
 * A caller's props holding only their rows of `permissions` in the project -
 * read the way the CRUD path reads them, allows and blocks alike - and none
 * of their global permissions (the CRUD path adds back the ones every caller
 * holds). Who the caller is - user, project, teams - is kept, so labels and
 * owned scope still apply.
 *
 * For a check that asks which records ONE grant reaches, so that another
 * grant the caller holds widens nothing: a Workflow Member runs the
 * workflows their Workflow Member grant reaches, not every workflow a Viewer
 * grant shows them (App/FeatureSet/Workflow/Utils/WorkflowRunAccess), and a
 * Runbook Member runs the runbooks theirs reaches
 * (Server/Utils/Runbook/RunbookRunAccess). The CRUD path then decides what
 * the rows reach.
 */
export default class PropsHoldingOnly {
  public static build(data: {
    databaseProps: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    permissions: ReadonlyArray<Permission>;
  }): DatabaseCommonInteractionProps {
    const rows: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getPermissionRows({
        ...data.databaseProps,
        tenantId: data.projectId,
        userGlobalAccessPermission: undefined,
      }).filter((row: UserPermission): boolean => {
        return data.permissions.includes(row.permission);
      });

    return {
      ...data.databaseProps,
      tenantId: data.projectId,
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        globalPermissions: [],
        projectIds: [data.projectId],
      },
      userTenantAccessPermission: {
        [data.projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: data.projectId,
          permissions: rows,
        },
      },
    };
  }
}
