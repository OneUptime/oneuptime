import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

/*
 * THE PROPS OF A WRITE ONEUPTIME MAKES ON A PERSON'S BEHALF, CREDITED TO
 * THEM IN THE AUDIT LOG.
 *
 * Some of what people do is written by OneUptime past the model's own
 * permissions, because the action has rules of its own that already let
 * them do it. Starting or cancelling a runbook run is allowed by the run
 * permissions (RunbookRunAccess), not by RunbookExecution's create or update
 * permission, and a run's status is OneUptime's to write. Written as plain
 * root, such a write was OneUptime's in the audit log: "System" cancelled
 * the run, and the entry was kept only when the project stores system
 * events.
 *
 * These props keep the write OneUptime's - root, so nothing of the person's
 * is asked again, and with no project on the request, so DatabaseService
 * takes it as a write OneUptime makes itself and keeps the people it names
 * (UserAttribution: a run's triggeredByUserId) - and carry who the person
 * is, and nothing of what they may do: their user and its type, the API key,
 * the MCP client or the workflow they acted through, and Ask AI when it
 * acted for them. The audit log reads its actor from these
 * (AuditLogRecorder), so the entry is theirs, kept whether or not the
 * project stores system events, like every other change they make.
 *
 * Never for a write a person did not ask for: OneUptime's own work stays
 * root with no one named, a system event.
 */

// What says who acted, and through what: nothing here grants anything.
const IDENTITY_KEYS: ReadonlyArray<keyof DatabaseCommonInteractionProps> = [
  "userId",
  "userType",
  "apiKeyId",
  "apiKeyName",
  "mcpOAuthGrantId",
  "mcpClientName",
  "workflowId",
  "workflowName",
  "writeSource",
];

export default class OnBehalfOfProps {
  public static get(
    props: DatabaseCommonInteractionProps,
  ): DatabaseCommonInteractionProps {
    const onBehalfOf: Record<string, unknown> = { isRoot: true };

    for (const key of IDENTITY_KEYS) {
      if (props[key] !== undefined && props[key] !== null) {
        onBehalfOf[key] = props[key];
      }
    }

    return onBehalfOf as DatabaseCommonInteractionProps;
  }

  // The keys get() copies, for the tests that hold it to the props' type.
  public static getIdentityKeys(): ReadonlyArray<
    keyof DatabaseCommonInteractionProps
  > {
    return IDENTITY_KEYS;
  }
}
