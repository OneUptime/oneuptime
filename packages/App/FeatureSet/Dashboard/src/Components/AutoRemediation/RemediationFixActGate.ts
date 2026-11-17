import PermissionGate, {
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { RUNBOOK_RUN_PERMISSIONS } from "Common/Types/Runbook/RunbookRunPermissions";

/*
 * WHO MAY ACT ON A FIX ONEUPTIME AI PROPOSED (#5715's follow-up).
 *
 * Approve & Run, its dry run and Dismiss fix each ask the server for the
 * same permission: to start runbook executions in the project
 * (RemediationApproval: assertCanExecuteRunbooks for approving and a dry
 * run, assertCanDismissFixes for dismissing - RunbookExecution's create
 * list, Types/Runbook/RunbookRunPermissions), as the fix's Slack and
 * Microsoft Teams buttons do (WorkspaceRemediationActions). The card used
 * to show all three to everyone who could read the fix, and the server then
 * refused a Viewer's press. The step now asks the same list of the reader's
 * permission snapshot first: someone it certainly refuses sees no buttons,
 * and a quiet line in their place saying who may act, and what would let
 * them - the way Try again is offered only to someone who may change the
 * record.
 *
 * Only a definite refusal hides them. While the snapshot is still on its
 * way nothing honest can be said, so the buttons stay and the server
 * decides, as Run Now on a runbook's page does (RunbookRunGate). A team's
 * block of the permission is a refusal too, and the line names the block.
 * A fix's own extra checks - permission to edit the cluster or the cloud
 * account it changes, the runbook its grant reaches - are about one record
 * and stay the server's, whose refusal reads under the buttons.
 */

export type RemediationFixAct = "approveOrDismiss" | "dismiss";

/*
 * The line's first sentence: who may act on the fix, by what the reader
 * would have pressed - a fix that waits for approval is approved or
 * dismissed, one still being worked out (or that can no longer be
 * approved) only dismissed. The permission that would let the reader, or
 * the team block that stops them, follows (PermissionGate).
 */
export const REMEDIATION_FIX_WHO_MAY_ACT: Readonly<
  Record<RemediationFixAct, string>
> = {
  approveOrDismiss: translationKey(
    "Only someone who may start runbook executions can approve or dismiss this fix.",
  ),
  dismiss: translationKey(
    "Only someone who may start runbook executions can dismiss this fix.",
  ),
};

/*
 * Whether the reader may act on a fix, by the list the server asks: the
 * roles that run runbooks and Create Runbook Execution.
 */
export function getRemediationFixActGate(
  act: RemediationFixAct,
  options?: PermissionGateOptions | undefined,
): PermissionGateResult {
  return PermissionGate.checkPermissions(RUNBOOK_RUN_PERMISSIONS, {
    ...options,
    sentence: REMEDIATION_FIX_WHO_MAY_ACT[act],
  });
}

/*
 * OPENING A PULL REQUEST FROM A PRIVATE INCIDENT OR ALERT (#9106, #9165).
 *
 * Open a pull request to the code, under a fix's step, and Open fix pull
 * request, the fix in the code an investigation recommends, take what
 * OneUptime AI worked out for the record into a repository whose readers
 * are not the record's. On a private record the server holds them to what
 * approving one of its fixes takes, through the teams that own it
 * (RemediationApproval.assertReachesFixSubject), as Approve & Run. So on
 * a private record's page they are locked the same way, saying why: for
 * someone whose teams that own the record may not approve its fixes. Off
 * one - a public record, or a reader named as its owner or a Project Owner
 * or Admin, who has no private record scope - they are offered as before,
 * the repository's own permissions deciding (CodeTaskAccess).
 */
export const REMEDIATION_FIX_PULL_REQUEST_WHO_MAY_OPEN: string = translationKey(
  "Only someone who may approve fixes can open this pull request.",
);

export function getFixPullRequestGate(
  privateRecordOptions: PermissionGateOptions | undefined,
): PermissionGateResult {
  if (!privateRecordOptions) {
    return { isAllowed: true };
  }

  return PermissionGate.checkPermissions(RUNBOOK_RUN_PERMISSIONS, {
    ...privateRecordOptions,
    sentence: REMEDIATION_FIX_PULL_REQUEST_WHO_MAY_OPEN,
  });
}

/*
 * The line in place of the fix's buttons, in the reader's language, or
 * undefined while the buttons are offered: the reader may act, or the
 * permission snapshot has not landed and the server decides.
 */
export function getRemediationFixWhoMayAct(
  gate: PermissionGateResult,
): string | undefined {
  if (gate.isAllowed) {
    return undefined;
  }

  return gate.disabledReason || undefined;
}
