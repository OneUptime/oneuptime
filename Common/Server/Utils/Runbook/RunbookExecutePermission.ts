import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";

/*
 * Starting a runbook execution runs the project's own Bash/JavaScript on the
 * infrastructure its Runner is installed on, so it is gated on
 * RunbookExecution's create ACL rather than on being able to see the runbook.
 * Every route that starts, advances or cancels an execution shares this one
 * list — a route that checks something weaker is a way around the others.
 */
export const RUNBOOK_EXECUTE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.CreateRunbookExecution,
  Permission.RunbookAdmin,
  Permission.RunbookMember,
];

export function assertCanExecuteRunbooks(
  props: DatabaseCommonInteractionProps,
  projectId: ObjectID,
): void {
  const tenantPermission: UserTenantAccessPermission | undefined =
    props.userTenantAccessPermission?.[projectId.toString()];

  /*
   * A permission row can be a BLOCK rather than a grant, so matching on the
   * permission name alone would read a denial as an authorization.
   */
  const hasPermission: boolean = Boolean(
    tenantPermission?.permissions?.some((p: UserPermission): boolean => {
      return (
        !p.isBlockPermission && RUNBOOK_EXECUTE_PERMISSIONS.includes(p.permission)
      );
    }),
  );

  if (!hasPermission) {
    throw new NotAuthorizedException(
      "You do not have permission to start runbook executions in this project.",
    );
  }
}

export default {
  RUNBOOK_EXECUTE_PERMISSIONS,
  assertCanExecuteRunbooks,
};
