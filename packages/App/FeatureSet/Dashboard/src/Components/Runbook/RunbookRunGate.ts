import PermissionGate, {
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { RUNBOOK_RUN_PERMISSIONS } from "Common/Types/Runbook/RunbookRunPermissions";

/*
 * Whether a runbook's page offers Run Now, by the list the server asks for
 * it (Common/Types/Runbook/RunbookRunPermissions): the roles that run
 * runbooks - Project Owner, Project Admin, Project Member, Runbook Admin and
 * Runbook Member - and Create Runbook Execution. Runbook Viewer and Viewer
 * read runbooks and run none: they see the button locked, saying why and
 * what would let them, in the server's own words. Which runbooks a role
 * reaches - its labels and owned scope - is the server's to decide on the
 * click. Before the permission snapshot has landed nobody is told anything
 * and the server decides (PermissionGate.checkPermissions).
 */

// The first sentence of the refusal: the server's message, word for word.
export const RunbookRunCopy: {
  readonly runRefused: string;
} = {
  runRefused: translationKey(
    "You do not have permission to start runbook executions in this project.",
  ),
};

export type GetRunbookRunGateFunction = (
  options?: PermissionGateOptions | undefined,
) => PermissionGateResult;

export const getRunbookRunGate: GetRunbookRunGateFunction = (
  options?: PermissionGateOptions | undefined,
): PermissionGateResult => {
  return PermissionGate.checkPermissions(RUNBOOK_RUN_PERMISSIONS, {
    ...options,
    sentence: RunbookRunCopy.runRefused,
  });
};

/*
 * The reason Run Now is locked, or undefined when it is not: refused with
 * something to say. A gate that refuses with nothing to say - the snapshot
 * has not landed - leaves the button working, and the server decides.
 */
export const getRunbookRunLockedReason: (
  gate: PermissionGateResult,
) => string | undefined = (gate: PermissionGateResult): string | undefined => {
  if (gate.isAllowed) {
    return undefined;
  }

  return gate.disabledReason || undefined;
};
