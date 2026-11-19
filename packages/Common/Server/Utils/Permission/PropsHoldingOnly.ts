import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
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
 *
 * buildWithout is the other way round: everything the caller holds but
 * some of their allow rows, for a check that asks which records they reach
 * without a grant - the user overrides they reach without Manage On-Call
 * Policy User Overrides for Own Team, or with only one team's rows of it
 * (OnCallDutyPolicyUserOverrideService, issue #9733).
 */

/*
 * What getPermissionRows adds for every caller, as rows of the project: a
 * permission held everywhere, never a project's row (no team, custom role
 * or API key is given one). The CRUD path adds it back from the global
 * permissions.
 */
const EVERY_CALLERS_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.Public,
  Permission.CurrentUser,
];

export default class PropsHoldingOnly {
  public static build(data: {
    databaseProps: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    permissions: ReadonlyArray<Permission>;
  }): DatabaseCommonInteractionProps {
    /*
     * Every block row stays: a block only ever takes away, and one on a
     * permission besides `permissions` - a block on Workflow Viewer for the
     * records carrying a label - takes those records away from every read
     * of the table (ReadPermission.getLabelledBlockRows), so the grant here
     * may not reach them either.
     */
    const rows: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getPermissionRows({
        ...data.databaseProps,
        tenantId: data.projectId,
        userGlobalAccessPermission: undefined,
      }).filter((row: UserPermission): boolean => {
        return (
          HeldPermissionsUtil.isBlockRow(row) ||
          data.permissions.includes(row.permission)
        );
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

  /*
   * The caller's props with the allow rows `isLeftOut` names taken out of
   * the project's: every other row - allows and blocks, the project's and
   * other projects' - and the global permissions kept as they are, and who
   * the caller is. A block is never left out: it only ever takes away. The
   * CRUD path then decides what the rows that are left reach.
   */
  public static buildWithout(data: {
    databaseProps: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    isLeftOut: (row: UserPermission) => boolean;
  }): DatabaseCommonInteractionProps {
    const rows: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getPermissionRows({
        ...data.databaseProps,
        tenantId: data.projectId,
        userGlobalAccessPermission: undefined,
      }).filter((row: UserPermission): boolean => {
        if (HeldPermissionsUtil.isBlockRow(row)) {
          return true;
        }

        // Every caller's, added back from the global permissions.
        if (EVERY_CALLERS_PERMISSIONS.includes(row.permission) && !row.teamId) {
          return false;
        }

        return !data.isLeftOut(row);
      });

    return {
      ...data.databaseProps,
      tenantId: data.projectId,
      userTenantAccessPermission: {
        ...(data.databaseProps.userTenantAccessPermission || {}),
        [data.projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: data.projectId,
          permissions: rows,
        },
      },
    };
  }
}
