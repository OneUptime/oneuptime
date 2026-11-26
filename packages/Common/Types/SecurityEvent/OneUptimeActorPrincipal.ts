import ObjectID from "../ObjectID";

/*
 * WHO ACTED IN ONEUPTIME WHEN IT WAS NO PERSON, AS A SECURITY EVENT'S
 * PRINCIPAL USER (#10430, #10630).
 *
 * OneUptime's audit log names what made a change by kind (its userType): a
 * person, a project API key, a step of one of the project's workflows, or
 * OneUptime itself ("System": its own jobs, a SCIM sync, the records a
 * delete takes with it, recorded when the project stores system events). A
 * person is named by their email, but a key, a workflow and OneUptime are
 * no person:
 *
 *   - a workflow and OneUptime have no name an account could have, so
 *     every workflow's changes and OneUptime's own shared one empty
 *     principal (#10430): Security Events summed them into one anonymous
 *     "Someone", and nobody could tell which workflow to stop;
 *   - a key was named by its name ("terraform", "deploy-bot"), which a rule
 *     grouped by principal made a User of the case, so a playbook's Okta or
 *     Entra ID step offered "terraform" as the user to suspend - and two
 *     keys of one name were one principal (#10630).
 *
 * Each has a principal of its own now:
 *
 *   - a workflow is "workflow:" and its id, the same however it is renamed:
 *     a rule that groups by principal groups per workflow, and an exception
 *     can name one;
 *   - a project API key is "api-key:" and its id, the same however it is
 *     renamed, so two keys of one name are two principals. Its name stays
 *     in the event's message and in `audit.api_key_name` (AuditLogSignals),
 *     and an exception that names the key by its name still skips it
 *     (Server/Utils/SecurityEvent/DetectionRuleExceptions);
 *   - OneUptime itself is "oneuptime".
 *
 * None is a person, so none is ever an account to act on: a case holds
 * them as entities of no kind a response acts on, and no playbook offers
 * one as a user to suspend (Types/SecurityCase/SecurityEntity,
 * SecurityPlaybookTargets). The audit event names them in words (AuditLog
 * Signals.describeAuditActor): "The workflow "Nightly Cleanup"", "The API
 * key "terraform"", "OneUptime".
 */

export const ONEUPTIME_PRINCIPAL: string = "oneuptime";

export const WORKFLOW_PRINCIPAL_PREFIX: string = "workflow:";

export const API_KEY_PRINCIPAL_PREFIX: string = "api-key:";

// The principal of a prefix and an id: "" for anything that is no id.
function getPrincipalOfId(prefix: string, id: unknown): string {
  const text: string = typeof id === "string" ? id.trim() : "";

  return ObjectID.isValidUUID(text) ? `${prefix}${text.toLowerCase()}` : "";
}

// The id a principal of a prefix names, whatever its case, or "" when it names none.
function getIdOfPrincipal(prefix: string, value: unknown): string {
  const text: string = typeof value === "string" ? value.trim() : "";

  if (text.slice(0, prefix.length).toLowerCase() !== prefix) {
    return "";
  }

  const id: string = text.slice(prefix.length);

  return ObjectID.isValidUUID(id) ? id.toLowerCase() : "";
}

// A workflow's principal, by its id: "" for anything that is no id.
export function getWorkflowPrincipal(workflowId: unknown): string {
  return getPrincipalOfId(WORKFLOW_PRINCIPAL_PREFIX, workflowId);
}

// The workflow's id a principal names, or "" when it names none.
export function getWorkflowIdOfPrincipal(value: unknown): string {
  return getIdOfPrincipal(WORKFLOW_PRINCIPAL_PREFIX, value);
}

// A project API key's principal, by its id: "" for anything that is no id.
export function getApiKeyPrincipal(apiKeyId: unknown): string {
  return getPrincipalOfId(API_KEY_PRINCIPAL_PREFIX, apiKeyId);
}

// The API key's id a principal names, or "" when it names none.
export function getApiKeyIdOfPrincipal(value: unknown): string {
  return getIdOfPrincipal(API_KEY_PRINCIPAL_PREFIX, value);
}

/*
 * Whether a principal is one of OneUptime's own actors - a workflow, a
 * project API key, or OneUptime itself - and so no person: whatever its
 * case, as an entity's value is compared without case.
 */
export function isOneUptimeActorPrincipal(value: unknown): boolean {
  const text: string = typeof value === "string" ? value.trim() : "";

  return (
    text.toLowerCase() === ONEUPTIME_PRINCIPAL ||
    getWorkflowIdOfPrincipal(text) !== "" ||
    getApiKeyIdOfPrincipal(text) !== ""
  );
}
