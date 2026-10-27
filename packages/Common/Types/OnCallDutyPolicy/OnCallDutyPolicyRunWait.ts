import WorkingHours from "./WorkingHours";

/*
 * A RUN THAT WAITS TO PAGE, AND HOW IT SAYS SO.
 *
 * An on-call policy's run can be held: it is created waiting
 * (OnCallDutyPolicyStatus.Waiting) with the moment it starts paging
 * (OnCallDutyPolicyExecutionLog.pagingStartsAt), pages nobody until then, and
 * is started at its first escalation rule when that moment comes
 * (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions). An on-call rule
 * that pages only during working hours holds the runs it starts outside them
 * (OnCallRuleWhenToPage), one set to After OneUptime AI holds them while AI
 * works (OnCallPolicyAiHold), and OnCallDutyPolicyService.executePolicy
 * holds a run for any caller that names the moment.
 *
 * Acknowledged or resolved while it waits, the record needs nobody paged: the
 * run ends there, paging nobody. An archived policy pages no one: its run
 * ends there too, saying so (OnCallDutyPolicyArchive).
 *
 * The run's status message says why it waits and when it pages - the words
 * its record's feed, its Slack and Microsoft Teams message and the Execution
 * Logs table show - and, once it ended without paging, why. Those readers
 * tell the messages apart by how they start, as they do the messages of a
 * run that ended (OnCallDutyPolicyRunEnding).
 */

// "Waiting for working hours. Paging starts Wed 09:00 (Europe/London)."
export const ON_CALL_POLICY_RUN_WAITING_FOR_WORKING_HOURS_MESSAGE_START: string =
  "Waiting for working hours. ";

// A run that waits for any other reason: "Waiting. Paging starts Wed 09:00 (UTC)."
export const ON_CALL_POLICY_RUN_WAITING_MESSAGE_START: string = "Waiting. ";

/*
 * A run OneUptime AI holds while it works (OnCallPolicyAiHold): "Waiting for
 * OneUptime AI. Paging starts 02:10 (UTC) unless it resolves this."
 */
export const ON_CALL_POLICY_RUN_WAITING_FOR_ONEUPTIME_AI_MESSAGE_START: string =
  "Waiting for OneUptime AI. ";

export function getOnCallPolicyRunWaitingMessage(data: {
  pagingStartsAt: Date;
  // The zone the moment is told in: the rule's. UTC without one.
  timezone?: string | undefined;
  // When the message is written: a moment a week or more away names its date.
  now: Date;
  isWaitingForWorkingHours: boolean;
  isWaitingForOneUptimeAI?: boolean | undefined;
}): string {
  const moment: string = WorkingHours.describeMoment({
    at: data.pagingStartsAt,
    timezone: data.timezone,
    now: data.now,
  });

  if (data.isWaitingForOneUptimeAI) {
    return `${ON_CALL_POLICY_RUN_WAITING_FOR_ONEUPTIME_AI_MESSAGE_START}Paging starts ${moment} unless it resolves this.`;
  }

  const start: string = data.isWaitingForWorkingHours
    ? ON_CALL_POLICY_RUN_WAITING_FOR_WORKING_HOURS_MESSAGE_START
    : ON_CALL_POLICY_RUN_WAITING_MESSAGE_START;

  return `${start}Paging starts ${moment}.`;
}

// Whether a waiting run's message says OneUptime AI holds it.
export function isOnCallPolicyRunWaitingForOneUptimeAI(
  statusMessage: string | null | undefined,
): boolean {
  return (statusMessage || "").startsWith(
    ON_CALL_POLICY_RUN_WAITING_FOR_ONEUPTIME_AI_MESSAGE_START,
  );
}

// Whether a waiting run's message says it waits for working hours.
export function isOnCallPolicyRunWaitingForWorkingHours(
  statusMessage: string | null | undefined,
): boolean {
  return (statusMessage || "").startsWith(
    ON_CALL_POLICY_RUN_WAITING_FOR_WORKING_HOURS_MESSAGE_START,
  );
}

/*
 * WHY A RUN THAT WAITED STARTED PAGING EARLY: its record changed - raised to
 * a higher severity, say - and now matches an on-call rule that pages right
 * away (WaitingRunsOnRecordChange). Plain text, kept on the run
 * (pagingStartedEarlyReason) and said in its record's feed and its Slack and
 * Microsoft Teams message:
 *
 *   The alert now matches on-call rule "P1 alerts", which pages right away.
 *   The incident now matches on-call rules "P1" and "Payments", which page
 *   right away.
 *
 * Two rule names at most, each cut to a length that keeps the whole within
 * the column; any more are counted.
 */
export const ON_CALL_POLICY_RUN_STARTED_EARLY_REASON_MAX_LENGTH: number = 500;

const STARTED_EARLY_RULE_NAME_MAX_LENGTH: number = 150;

const RECORD_KIND_SUBJECTS: Record<string, string> = {
  alert: "The alert",
  incident: "The incident",
  "alert episode": "The alert episode",
  "incident episode": "The incident episode",
};

export function getOnCallPolicyRunStartedEarlyReason(data: {
  // "alert", "incident", "alert episode" or "incident episode".
  recordKind: string;
  // The rules that page right away and now match the record.
  ruleNames: Array<string>;
}): string {
  const subject: string =
    RECORD_KIND_SUBJECTS[data.recordKind] || `The ${data.recordKind}`;

  const names: Array<string> = data.ruleNames
    .map((name: string): string => {
      const trimmed: string = (name || "").trim();

      return trimmed.length > STARTED_EARLY_RULE_NAME_MAX_LENGTH
        ? `${trimmed.slice(0, STARTED_EARLY_RULE_NAME_MAX_LENGTH - 1)}…`
        : trimmed;
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  const quoted: Array<string> = Array.from(new Set(names)).map(
    (name: string): string => {
      return `"${name}"`;
    },
  );

  if (quoted.length === 0) {
    return `${subject} now matches an on-call rule that pages right away.`;
  }

  if (quoted.length === 1) {
    return `${subject} now matches on-call rule ${quoted[0]}, which pages right away.`;
  }

  const listed: string =
    quoted.length === 2
      ? `${quoted[0]} and ${quoted[1]}`
      : `${quoted[0]}, ${quoted[1]} and ${quoted.length - 2} more`;

  return `${subject} now matches on-call rules ${listed}, which page right away.`;
}

/*
 * How the message of a run that ended while it waited, because its record
 * was handled, starts. Not "Execution completed because ...": that is a run
 * that stopped paging (OnCallDutyPolicyRunEnding), and this one never began.
 */
export const ON_CALL_POLICY_RUN_ENDED_WHILE_WAITING_MESSAGE_START: string =
  "Execution completed without paging because ";

// "Execution completed without paging because alert is acknowledged or resolved."
export function getOnCallPolicyRunEndedWhileWaitingMessage(
  recordKind: string,
): string {
  return `${ON_CALL_POLICY_RUN_ENDED_WHILE_WAITING_MESSAGE_START}${recordKind} is acknowledged or resolved.`;
}

export function isOnCallPolicyRunEndedWhileWaiting(
  statusMessage: string | null | undefined,
): boolean {
  return (statusMessage || "").startsWith(
    ON_CALL_POLICY_RUN_ENDED_WHILE_WAITING_MESSAGE_START,
  );
}
