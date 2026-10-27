/*
 * What started a runbook execution (RunbookExecution.triggerType).
 *
 * Every way a run starts goes through one start path
 * (Server/Utils/Runbook/RunbookStarter), and each says which of these it is,
 * so a run's page, the Executions lists and the steps themselves can tell a
 * run somebody started from one a schedule or another tool did:
 *
 *   - Manual: a person - Run Now on the runbook, Run Again on a run, Run
 *     Runbook on an incident, alert or scheduled maintenance event, or the
 *     API with a person's or an API key's credentials;
 *   - Rule: a runbook rule, when a matching incident, alert or scheduled
 *     maintenance event was created;
 *   - AutoRemediation: an auto-remediation rule, on its own or once a person
 *     approved its plan;
 *   - AI: OneUptime AI, acting for the person it was talking to;
 *   - Schedule: the runbook's own schedule (its Triggers page);
 *   - Webhook: a POST to the runbook's webhook URL (its Triggers page);
 *   - SecurityPlaybook: a security playbook's Run a runbook step, for a
 *     security case, once a person approved the step if it waited for one.
 *
 * Runs started before this column existed have none; they are read the way
 * they always were (the record they are linked to, the person who started
 * them).
 *
 * A Bash step reads it as $ONEUPTIME_TRIGGER and a JavaScript step as
 * args.trigger (Types/Runbook/RunbookInputs), so the values are part of the
 * scripts' contract: add values, never rename one.
 */
enum RunbookTriggerType {
  Manual = "Manual",
  Rule = "Rule",
  AutoRemediation = "AutoRemediation",
  AI = "AI",
  Schedule = "Schedule",
  Webhook = "Webhook",
  SecurityPlaybook = "SecurityPlaybook",
}

export const RUNBOOK_TRIGGER_TYPES: ReadonlyArray<RunbookTriggerType> = [
  RunbookTriggerType.Manual,
  RunbookTriggerType.Rule,
  RunbookTriggerType.AutoRemediation,
  RunbookTriggerType.AI,
  RunbookTriggerType.Schedule,
  RunbookTriggerType.Webhook,
  RunbookTriggerType.SecurityPlaybook,
];

// The triggers that start a run with nobody watching: no person clicked.
export const UNATTENDED_RUNBOOK_TRIGGER_TYPES: ReadonlyArray<RunbookTriggerType> =
  [RunbookTriggerType.Schedule, RunbookTriggerType.Webhook];

export function isRunbookTriggerType(
  value: unknown,
): value is RunbookTriggerType {
  return (
    typeof value === "string" &&
    RUNBOOK_TRIGGER_TYPES.includes(value as RunbookTriggerType)
  );
}

export default RunbookTriggerType;
