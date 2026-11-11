/*
 * Repeating a push rule until somebody acknowledges.
 *
 * A rule that pages a phone can send its push again every few minutes
 * (UserNotificationRule.repeatEveryMinutes), so a responder who slept through
 * the first critical alert gets another - and another - instead of the phone
 * going quiet after one sound. Repeats stop as soon as the incident, alert or
 * episode is acknowledged (the on-call worker ends the log then, as it always
 * has), and after MAX_NOTIFICATION_REPEATS at most, so an alert nobody ever
 * acknowledges does not page all night.
 *
 * The schedule: the rule's first push goes out after notifyAfterMinutes, as
 * before. Repeat n is due notifyAfterMinutes + n * repeatEveryMinutes after the
 * page started. Each delivery is claimed on the on-call log under a key of its
 * own (getRepeatClaimKey), so two worker runs can never send the same repeat
 * twice, and a worker that missed minutes sends the latest repeat due rather
 * than every one it missed at once.
 */

// Off: the rule sends once, as every rule did before.
export const NO_NOTIFICATION_REPEAT: number = 0;

// The intervals the On-Call Rules page offers, in minutes.
export const REPEAT_EVERY_MINUTES_OPTIONS: ReadonlyArray<number> = [
  1, 2, 3, 5, 10, 15, 30,
];

// Repeats after the first push, at most.
export const MAX_NOTIFICATION_REPEATS: number = 10;

export function isRepeatEveryMinutes(value: unknown): value is number {
  return (
    value === NO_NOTIFICATION_REPEAT ||
    REPEAT_EVERY_MINUTES_OPTIONS.includes(value as number)
  );
}

/*
 * The interval a rule repeats at. A rule read without the column, or one with
 * a value this build does not offer, does not repeat - repeating is opted
 * into, and an unknown value must not start paging somebody every minute.
 */
export function getRepeatEveryMinutes(value: unknown): number {
  return isRepeatEveryMinutes(value) ? value : NO_NOTIFICATION_REPEAT;
}

/*
 * Which repeat is due now: 0 while none is (the rule does not repeat, its
 * first push is not due yet, or the first interval has not passed), otherwise
 * the latest one due, never more than MAX_NOTIFICATION_REPEATS.
 */
export function getDueRepeatNumber(data: {
  minutesSinceStart: number;
  notifyAfterMinutes: number;
  repeatEveryMinutes: unknown;
}): number {
  const repeatEveryMinutes: number = getRepeatEveryMinutes(
    data.repeatEveryMinutes,
  );

  if (repeatEveryMinutes === NO_NOTIFICATION_REPEAT) {
    return 0;
  }

  const minutesSinceFirstPush: number =
    data.minutesSinceStart - (data.notifyAfterMinutes || 0);

  if (!Number.isFinite(minutesSinceFirstPush) || minutesSinceFirstPush < 0) {
    return 0;
  }

  return Math.min(
    MAX_NOTIFICATION_REPEATS,
    Math.floor(minutesSinceFirstPush / repeatEveryMinutes),
  );
}

/*
 * The key repeat n of a rule is claimed under on the on-call log, beside the
 * rule's own id for its first push. Never a valid rule id, so the two cannot
 * collide.
 */
export function getRepeatClaimKey(
  ruleId: string,
  repeatNumber: number,
): string {
  return `${ruleId}:repeat:${repeatNumber}`;
}

/*
 * Whether a rule has nothing left to send on this log: its first push went
 * out and, if it repeats, so did its last repeat.
 */
export function isRuleFullyExecuted(data: {
  executedClaimKeys: ReadonlyArray<string>;
  ruleId: string;
  repeatEveryMinutes: unknown;
}): boolean {
  if (!data.executedClaimKeys.includes(data.ruleId)) {
    return false;
  }

  if (
    getRepeatEveryMinutes(data.repeatEveryMinutes) === NO_NOTIFICATION_REPEAT
  ) {
    return true;
  }

  return data.executedClaimKeys.includes(
    getRepeatClaimKey(data.ruleId, MAX_NOTIFICATION_REPEATS),
  );
}

/*
 * What, if anything, a rule should send on this tick of the on-call worker:
 * null for nothing, 0 for its first push, n for repeat n.
 *
 *   - Its first push, once notifyAfterMinutes have passed and until it is
 *     claimed - exactly as every rule ran before repeats existed.
 *   - Then the latest repeat due (getDueRepeatNumber), if it has not been
 *     claimed. A repeat is never sent before the first push, and a worker that
 *     was down for a while sends the latest repeat rather than every one it
 *     missed at once.
 */
export function getDueRuleExecution(data: {
  executedClaimKeys: ReadonlyArray<string>;
  ruleId: string;
  notifyAfterMinutes: number;
  repeatEveryMinutes: unknown;
  minutesSinceStart: number;
}): number | null {
  if (!data.executedClaimKeys.includes(data.ruleId)) {
    return (data.notifyAfterMinutes || 0) <= data.minutesSinceStart ? 0 : null;
  }

  const repeatNumber: number = getDueRepeatNumber({
    minutesSinceStart: data.minutesSinceStart,
    notifyAfterMinutes: data.notifyAfterMinutes,
    repeatEveryMinutes: data.repeatEveryMinutes,
  });

  if (repeatNumber === 0) {
    return null;
  }

  return data.executedClaimKeys.includes(
    getRepeatClaimKey(data.ruleId, repeatNumber),
  )
    ? null
    : repeatNumber;
}

/*
 * WHEN A DELIVERY OF A RULE WAS DUE, for how late it went out
 * (notification.send.lag, OnCallSendLag).
 *
 * How many minutes after its log started a rule's delivery comes due: its
 * first push (0) after notifyAfterMinutes, repeat n after notifyAfterMinutes
 * + n * repeatEveryMinutes - the first whole minute at which
 * getDueRuleExecution, counting whole minutes as the worker does, says it
 * is due.
 */
export function getRuleExecutionDueAfterMinutes(data: {
  notifyAfterMinutes: number;
  repeatEveryMinutes: unknown;
  executionNumber: number;
}): number {
  const notifyAfterMinutes: number = Number.isFinite(data.notifyAfterMinutes)
    ? data.notifyAfterMinutes
    : 0;
  const repeats: number = toRepeatNumber(data.executionNumber);

  return Math.max(
    0,
    Math.ceil(
      notifyAfterMinutes +
        repeats * getRepeatEveryMinutes(data.repeatEveryMinutes),
    ),
  );
}

/*
 * An execution number as the repeat it is: 0 for the first push - and for
 * anything that is not a number above 0 - whole repeats, never past the
 * last (MAX_NOTIFICATION_REPEATS).
 */
function toRepeatNumber(executionNumber: number): number {
  if (!Number.isFinite(executionNumber) || executionNumber <= 0) {
    return 0;
  }

  return Math.min(MAX_NOTIFICATION_REPEATS, Math.floor(executionNumber));
}

/*
 * The earliest delivery a rule's send now stands in for. A worker that fell
 * behind sends the latest repeat due and skips the ones it missed
 * (getDueRuleExecution), so repeat n sent now was owed since the first
 * repeat after the last one sent - the person went without a push from
 * then. Its first push, and a repeat right after the last one sent, stand
 * for themselves.
 */
export function getFirstOwedRuleExecution(data: {
  executedClaimKeys: ReadonlyArray<string>;
  ruleId: string;
  executionNumber: number;
}): number {
  const executionNumber: number = toRepeatNumber(data.executionNumber);

  if (executionNumber === 0) {
    return 0;
  }

  for (let repeat: number = executionNumber - 1; repeat >= 1; repeat--) {
    if (
      data.executedClaimKeys.includes(getRepeatClaimKey(data.ruleId, repeat))
    ) {
      return repeat + 1;
    }
  }

  return 1;
}
