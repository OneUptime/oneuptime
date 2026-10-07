import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Permission from "../../../Types/Permission";
import {
  RUNBOOK_ADVANCE_PERMISSIONS as ADVANCE_PERMISSIONS,
  RUNBOOK_ADVANCE_REFUSED_MESSAGE,
  RUNBOOK_RUN_PERMISSIONS,
  RUNBOOK_RUN_REFUSED_MESSAGE,
} from "../../../Types/Runbook/RunbookRunPermissions";
import CallerPermission from "../Permission/CallerPermission";

/*
 * Starting a runbook execution runs the project's own Bash/JavaScript on the
 * infrastructure its Runner is installed on, so it is gated on
 * RunbookExecution's create ACL rather than on being able to see the runbook
 * (Types/Runbook/RunbookRunPermissions holds the lists, and a test holds them
 * to the model's). Which runbooks a role's grant reaches is the routes' next
 * step (Server/Utils/Runbook/RunbookRunAccess).
 */
export const RUNBOOK_EXECUTE_PERMISSIONS: Array<Permission> = [
  ...RUNBOOK_RUN_PERMISSIONS,
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
  ...ADVANCE_PERMISSIONS,
];

/*
 * Held the way every permission check reads it (CallerPermission): a team's
 * block row is no grant, and a block with no labels on any of `allowed` takes
 * the action away.
 */
function assertHoldsAny(data: {
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  allowed: Array<Permission>;
  deniedMessage: string;
}): void {
  if (
    !CallerPermission.holdsAnyOf(data.props, data.allowed, {
      projectId: data.projectId,
    })
  ) {
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
    deniedMessage: RUNBOOK_RUN_REFUSED_MESSAGE,
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
    deniedMessage: RUNBOOK_ADVANCE_REFUSED_MESSAGE,
  });
}

export default {
  RUNBOOK_EXECUTE_PERMISSIONS,
  RUNBOOK_ADVANCE_PERMISSIONS,
  assertCanExecuteRunbooks,
  assertCanAdvanceRunbookExecutions,
};
