import ObjectID from "../ObjectID";

/*
 * WHO ACTED IN ONEUPTIME WHEN IT WAS NO PERSON, AS A SECURITY EVENT'S
 * PRINCIPAL USER (#10430).
 *
 * OneUptime's audit log names what made a change by kind (its userType): a
 * person, a project API key, a step of one of the project's workflows, or
 * OneUptime itself ("System": its own jobs, a SCIM sync, the records a
 * delete takes with it, recorded when the project stores system events). A
 * person is named by their email and a key by its name, but a workflow and
 * OneUptime have neither, so every workflow's changes and OneUptime's own
 * shared one empty principal: Security Events summed them into one
 * anonymous "Someone", and nobody could tell which workflow to stop.
 *
 * Each has a principal of its own now:
 *
 *   - a workflow is "workflow:" and its id, the same however it is renamed:
 *     a rule that groups by principal groups per workflow, and an exception
 *     can name one;
 *   - OneUptime itself is "oneuptime".
 *
 * Neither is a person, so neither is ever an account to act on: a case
 * holds them as entities of no kind a response acts on, and no playbook
 * offers one as a user to suspend (Types/SecurityCase/SecurityEntity,
 * SecurityPlaybookTargets). The audit event names them in words (AuditLog
 * Signals.describeAuditActor): "The workflow "Nightly Cleanup"", "OneUptime".
 */

export const ONEUPTIME_PRINCIPAL: string = "oneuptime";

export const WORKFLOW_PRINCIPAL_PREFIX: string = "workflow:";

// A workflow's principal, by its id: "" for anything that is no id.
export function getWorkflowPrincipal(workflowId: unknown): string {
  const id: string = typeof workflowId === "string" ? workflowId.trim() : "";

  return ObjectID.isValidUUID(id)
    ? `${WORKFLOW_PRINCIPAL_PREFIX}${id.toLowerCase()}`
    : "";
}

// The workflow's id a principal names, or "" when it names none.
export function getWorkflowIdOfPrincipal(value: unknown): string {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (
    text.slice(0, WORKFLOW_PRINCIPAL_PREFIX.length).toLowerCase() !==
    WORKFLOW_PRINCIPAL_PREFIX
  ) {
    return "";
  }

  const id: string = text.slice(WORKFLOW_PRINCIPAL_PREFIX.length);

  return ObjectID.isValidUUID(id) ? id.toLowerCase() : "";
}

/*
 * Whether a principal is one of OneUptime's own actors - a workflow, or
 * OneUptime itself - and so no person: whatever its case, as an entity's
 * value is compared without case.
 */
export function isOneUptimeActorPrincipal(value: unknown): boolean {
  const text: string = typeof value === "string" ? value.trim() : "";

  return (
    text.toLowerCase() === ONEUPTIME_PRINCIPAL ||
    getWorkflowIdOfPrincipal(text) !== ""
  );
}
