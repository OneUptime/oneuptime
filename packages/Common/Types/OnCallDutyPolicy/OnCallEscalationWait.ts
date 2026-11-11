import OneUptimeDate from "../Date";

/*
 * WHEN A RUN'S WAIT ON ITS ESCALATION RULE RUNS OUT.
 *
 * A run pages a level, then waits the level's "Escalate after" for somebody
 * to acknowledge (executeNextEscalationRuleInMinutes, copied onto the run
 * as the level starts) from the moment the level started
 * (lastEscalationRuleExecutedAt - or the run's creation, before it has
 * one). The worker (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions)
 * moves the run on at its first tick once that wait has run out, counting
 * whole minutes.
 *
 * One reading of the wait for the worker deciding it is over
 * (isOnCallEscalationWaitOver) and for the notifications of the level it
 * moves on to, timed from the moment it ran out
 * (getOnCallEscalationDueAt, notification.send.lag): the moment is the
 * first at which the worker says it is over.
 */

export interface OnCallEscalationWaitRun {
  lastEscalationRuleExecutedAt?: Date | string | null | undefined;
  createdAt?: Date | string | null | undefined;
  executeNextEscalationRuleInMinutes?: number | null | undefined;
}

const MINUTE_IN_MS: number = 60 * 1000;

// When the wait started: when the level started, else the run's creation.
export function getOnCallEscalationWaitStartedAt(
  run: OnCallEscalationWaitRun,
): Date | undefined {
  const startedAt: Date | string | null | undefined =
    run.lastEscalationRuleExecutedAt || run.createdAt;

  return startedAt ? OneUptimeDate.fromString(startedAt) : undefined;
}

// How many minutes the run waits: none, for a level that holds no wait.
export function getOnCallEscalationWaitInMinutes(
  run: OnCallEscalationWaitRun,
): number {
  return run.executeNextEscalationRuleInMinutes || 0;
}

/*
 * Whether the wait has run out at `now`, as the worker has always decided
 * it: the whole minutes since it started are at least the wait.
 */
export function isOnCallEscalationWaitOver(
  run: OnCallEscalationWaitRun,
  now: Date,
): boolean {
  const startedAt: Date | undefined = getOnCallEscalationWaitStartedAt(run);

  return (
    OneUptimeDate.getDifferenceInMinutes(startedAt!, now) >=
    getOnCallEscalationWaitInMinutes(run)
  );
}

/*
 * The moment the wait runs out: the first at which isOnCallEscalationWaitOver
 * says it is over. Undefined for a run with no moment its wait started, or
 * a wait that never runs out.
 */
export function getOnCallEscalationDueAt(
  run: OnCallEscalationWaitRun,
): Date | undefined {
  const startedAt: Date | undefined = getOnCallEscalationWaitStartedAt(run);
  const minutes: number = getOnCallEscalationWaitInMinutes(run);

  if (!startedAt || isNaN(startedAt.getTime()) || !Number.isFinite(minutes)) {
    return undefined;
  }

  // Whole minutes, as the worker counts them: a wait of 1.5 runs out at 2.
  const wholeMinutes: number = minutes > 0 ? Math.ceil(minutes) : 0;

  return new Date(startedAt.getTime() + wholeMinutes * MINUTE_IN_MS);
}
