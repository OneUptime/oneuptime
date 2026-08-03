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
 * Kept in step with that ACL by hand: widening one without the other is how a
 * route ends up checking something weaker than the CRUD path it stands in for.
 */
export const RUNBOOK_EXECUTE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.CreateRunbookExecution,
  Permission.RunbookAdmin,
  Permission.RunbookMember,
];

/*
 * Advancing an execution that already exists — completing a gated step,
 * skipping one, cancelling the run — is a mutation of that row, so
 * RunbookExecution's UPDATE ACL applies as well as its create ACL. The union
 * is deliberate in both directions: `EditRunbookExecution` is documented as
 * the permission that lets someone tick an execution off without being able
 * to start one, and a RunbookMember who could start the run must not be
 * unable to advance it.
 */
export const RUNBOOK_ADVANCE_PERMISSIONS: Array<Permission> = [
  ...RUNBOOK_EXECUTE_PERMISSIONS,
  Permission.EditRunbookExecution,
];

function assertHoldsAny(data: {
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  allowed: Array<Permission>;
  deniedMessage: string;
}): void {
  const tenantPermission: UserTenantAccessPermission | undefined =
    data.props.userTenantAccessPermission?.[data.projectId.toString()];

  /*
   * A permission row can be a BLOCK rather than a grant, so matching on the
   * permission name alone would read a denial as an authorization.
   */
  const hasPermission: boolean = Boolean(
    tenantPermission?.permissions?.some((p: UserPermission): boolean => {
      return !p.isBlockPermission && data.allowed.includes(p.permission);
    }),
  );

  if (!hasPermission) {
    throw new NotAuthorizedException(data.deniedMessage);
  }
}

export function assertCanExecuteRunbooks(
  props: DatabaseCommonInteractionProps,
  projectId: ObjectID,
): void {
  assertHoldsAny({
    props,
    projectId,
    allowed: RUNBOOK_EXECUTE_PERMISSIONS,
    deniedMessage:
      "You do not have permission to start runbook executions in this project.",
  });
}

export function assertCanAdvanceRunbookExecutions(
  props: DatabaseCommonInteractionProps,
  projectId: ObjectID,
): void {
  assertHoldsAny({
    props,
    projectId,
    allowed: RUNBOOK_ADVANCE_PERMISSIONS,
    deniedMessage:
      "You do not have permission to change runbook executions in this project.",
  });
}

export default {
  RUNBOOK_EXECUTE_PERMISSIONS,
  RUNBOOK_ADVANCE_PERMISSIONS,
  assertCanExecuteRunbooks,
  assertCanAdvanceRunbookExecutions,
};
