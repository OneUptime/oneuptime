/*
 * ONEUPTIME AI RESPONDS FIRST: A RUN HELD WHILE AI WORKS.
 *
 * An alert or incident on-call rule set to After OneUptime AI
 * (OnCallRuleWhenToPage.AfterOneUptimeAI) holds the runs it starts, when AI
 * may fix what the record is about (AiFirstResponderEligibility): each is
 * created waiting (OnCallDutyPolicyRunWait), for at most the rule's hold time,
 * while OneUptime AI investigates, fixes and checks its fix. Then one of
 * these ends the hold, and the run's aiHoldOutcome says which:
 *
 *   - AI's fix was verified and the record resolved: nobody is paged;
 *   - the record resolved, or a person acknowledged or resolved it, with no
 *     verified AI fix: nobody is paged, and AI is not credited;
 *   - AI handed off (it could not investigate, found no fix it may run on its
 *     own, or its fix did not hold), someone pressed Page now, or the hold
 *     time ran out: the run pages its first escalation rule, as it would have.
 *
 * A run with no AI hold has no aiHoldOutcome. Stored as plain text on the run
 * (OnCallDutyPolicyExecutionLog.aiHoldOutcome): never rename a value.
 */
export enum OnCallPolicyAiHoldOutcome {
  // Still waiting while OneUptime AI works.
  Holding = "Holding",
  ResolvedByAI = "Resolved by AI",
  RecoveredOnItsOwn = "Recovered on its own",
  HandledByPerson = "Handled by a person",
  HandedOff = "Handed off",
  HoldTimeRanOut = "Hold time ran out",
  PageNowPressed = "Page now pressed",
}

// The hold time a rule that names none uses, and the bounds of any.
export const AI_HOLD_TIME_DEFAULT_IN_MINUTES: number = 10;
export const AI_HOLD_TIME_MIN_IN_MINUTES: number = 1;
export const AI_HOLD_TIME_MAX_IN_MINUTES: number = 30;

/*
 * The hold time a rule's aiHoldTimeInMinutes gives: whole minutes within the
 * bounds, and the default for none - a value written before the bounds, or
 * through the API, never holds a page longer than the maximum.
 */
export function getAiHoldTimeInMinutes(
  aiHoldTimeInMinutes: number | null | undefined,
): number {
  if (
    aiHoldTimeInMinutes === null ||
    aiHoldTimeInMinutes === undefined ||
    !Number.isFinite(aiHoldTimeInMinutes)
  ) {
    return AI_HOLD_TIME_DEFAULT_IN_MINUTES;
  }

  return Math.min(
    AI_HOLD_TIME_MAX_IN_MINUTES,
    Math.max(AI_HOLD_TIME_MIN_IN_MINUTES, Math.round(aiHoldTimeInMinutes)),
  );
}

/*
 * What looks like an outage: this many other alerts and incidents opened in
 * the project within the window. AI holds no page then, and every page it
 * holds starts at once - people, not AI, take an outage.
 */
export const AI_HOLD_OUTAGE_RECORD_COUNT: number = 3;
export const AI_HOLD_OUTAGE_WINDOW_IN_MINUTES: number = 5;

/*
 * A record whose monitor had another record OneUptime AI resolved within
 * this window is paged right away: the last fix did not hold.
 */
export const AI_HOLD_RECURRENCE_WINDOW_IN_HOURS: number = 24;

/*
 * WHY ONEUPTIME AI HANDED A HELD RUN TO PEOPLE BEFORE ITS HOLD TIME RAN OUT.
 * Plain text, kept on the run (pagingStartedEarlyReason) and said in its
 * record's feed and its Slack and Microsoft Teams message, as the reason a
 * working-hours run started early is (OnCallDutyPolicyRunWait).
 */
export type AiHoldRecordKind = "alert" | "incident";

export const AiHoldHandOffReason: {
  investigationSkipped: (data: {
    recordKind: AiHoldRecordKind;
    why: string;
  }) => string;
  investigationWaits: (data: { waitMinutes: number }) => string;
  noFixToRun: () => string;
  fixNeedsApproval: () => string;
  fixDidNotHold: () => string;
  noMonitorToCheck: () => string;
  pageNow: (data: { userName?: string | undefined }) => string;
  aiTurnedOff: () => string;
  automaticFixingTurnedOff: (data: { recordKind: AiHoldRecordKind }) => string;
  ruleChanged: () => string;
  outage: (data: { recordCount: number; windowMinutes: number }) => string;
  highestSeverity: (data: { recordKind: AiHoldRecordKind }) => string;
} = {
  // "OneUptime AI could not investigate this incident: AI credits ran out."
  investigationSkipped: (data: {
    recordKind: AiHoldRecordKind;
    why: string;
  }): string => {
    let why: string = (data.why || "").trim();

    while (why.endsWith(".")) {
      why = why.slice(0, -1).trimEnd();
    }

    return why
      ? `OneUptime AI could not investigate this ${data.recordKind}: ${why}.`
      : `OneUptime AI could not investigate this ${data.recordKind}.`;
  },
  investigationWaits: (data: { waitMinutes: number }): string => {
    return `An AI rule waits ${data.waitMinutes} ${
      data.waitMinutes === 1 ? "minute" : "minutes"
    } before OneUptime AI investigates.`;
  },
  noFixToRun: (): string => {
    return "OneUptime AI found no fix it may run on its own.";
  },
  fixNeedsApproval: (): string => {
    return "OneUptime AI's fix needs a person to approve it.";
  },
  fixDidNotHold: (): string => {
    return "OneUptime AI's fix did not bring the monitors back.";
  },
  noMonitorToCheck: (): string => {
    return "OneUptime AI has no monitor to check its fix against.";
  },
  pageNow: (data: { userName?: string | undefined }): string => {
    const name: string = (data.userName || "").trim();

    return name ? `${name} pressed Page now.` : "Someone pressed Page now.";
  },
  aiTurnedOff: (): string => {
    return "OneUptime AI was turned off for this project.";
  },
  automaticFixingTurnedOff: (data: {
    recordKind: AiHoldRecordKind;
  }): string => {
    return `Fixing new ${data.recordKind}s automatically was turned off.`;
  },
  ruleChanged: (): string => {
    return "The on-call rule no longer lets OneUptime AI respond first.";
  },
  outage: (data: { recordCount: number; windowMinutes: number }): string => {
    return `${data.recordCount} alerts and incidents opened within ${data.windowMinutes} minutes, which looks like an outage.`;
  },
  highestSeverity: (data: { recordKind: AiHoldRecordKind }): string => {
    return `The ${data.recordKind} now has the project's highest severity.`;
  },
};

// Whether a run's hold is over, however it ended.
export function isAiHoldOver(
  outcome: OnCallPolicyAiHoldOutcome | string | null | undefined,
): boolean {
  return Boolean(outcome) && outcome !== OnCallPolicyAiHoldOutcome.Holding;
}

// Whether a hold ended with a page.
export function isAiHoldPaged(
  outcome: OnCallPolicyAiHoldOutcome | string | null | undefined,
): boolean {
  return (
    outcome === OnCallPolicyAiHoldOutcome.HandedOff ||
    outcome === OnCallPolicyAiHoldOutcome.HoldTimeRanOut ||
    outcome === OnCallPolicyAiHoldOutcome.PageNowPressed
  );
}
