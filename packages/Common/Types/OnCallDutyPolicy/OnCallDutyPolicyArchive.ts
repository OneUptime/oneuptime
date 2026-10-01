/*
 * What an archived on-call policy leaves behind when something asks it to
 * page people.
 *
 * An archived policy pages no one. An incident, alert or episode that still
 * lists it - or a person running it from Slack, Microsoft Teams or the AI
 * assistant - gets an execution log that says so, rather than nothing at all,
 * so "why was nobody paged?" has an answer on the incident itself. An
 * execution that was already escalating when the policy was archived stops
 * at its next step.
 */

// The execution log of a run that was refused because the policy is archived.
export const ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE: string =
  "Not executed: this on-call policy is archived, so it paged no one. Unarchive it to use it again.";

// The execution log of a run that was escalating when the policy was archived.
export const ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE: string =
  "Execution stopped because the on-call policy was archived. The remaining escalation rules were not run.";
