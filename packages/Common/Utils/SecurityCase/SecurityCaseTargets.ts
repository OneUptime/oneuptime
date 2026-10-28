/*
 * A SECURITY CASE'S RESPONSE TARGETS - ONE RULE, EVERYWHERE.
 *
 * A project's case priorities each say how fast a case at them must be
 * taken on and contained (SecurityCasePriority.acknowledgeWithinInMinutes
 * and containWithinInMinutes, Security Events > Settings > Response
 * Targets). From them a case gets two due times (SecurityCase.
 * acknowledgeDueAt, containDueAt), and everything that reads them - the
 * case's service as it writes them, the every-minute check that tells
 * people, the case's header, its Overview's figures and the case lists -
 * asks here:
 *
 *   - As a case opens, each target is due that long from now. A target the
 *     case meets as it opens (opened assigned to somebody, or straight into
 *     a status that acknowledges or closes it) gets no due time.
 *   - Acknowledge is met when the case is acknowledged (acknowledgedAt:
 *     assigned to a person, or moved to a status that counts as
 *     acknowledged). Contain is met when it is contained, or closed: a case
 *     closed without being contained - a false positive - has nothing left
 *     to contain.
 *   - When its priority changes, a target not met and not missed follows
 *     the new priority: a rise brings its due time closer - the new
 *     priority's target from the moment it rose, never later than it was -
 *     and a fall moves it out to the new priority's target counted from
 *     when the case opened, never sooner than it was. A target the case had
 *     no due time for gets the new priority's from the moment of the change.
 *     A priority without a target leaves a rise as it was and takes the due
 *     time away on a fall. A target met or missed stays as it is: a missed
 *     target is a record of what happened.
 *   - Reopening a case starts its contain target again, from the moment it
 *     is reopened: it is new work.
 *   - In the last fifth of a target's time the case is at risk, and the
 *     people on it are told once; when the due time passes, it has missed
 *     the target, and they are told again (SecurityCaseTargetCheck).
 *
 * Pure: no database and no React, so the server, the dashboard and the
 * tests read one rule.
 */

export enum SecurityCaseTarget {
  Acknowledge = "Acknowledge",
  Contain = "Contain",
}

// In the order a case meets them.
export const SECURITY_CASE_TARGETS: ReadonlyArray<SecurityCaseTarget> = [
  SecurityCaseTarget.Acknowledge,
  SecurityCaseTarget.Contain,
];

/*
 * At risk for the last fifth of a target's time: three minutes of a
 * 15-minute target, 48 of a 4-hour one - enough to act on, and late enough
 * that it is not every case.
 */
export const SECURITY_CASE_TARGET_AT_RISK_FRACTION: number = 0.2;

// The longest target a priority takes: a year.
export const MAX_SECURITY_CASE_TARGET_IN_MINUTES: number = 365 * 24 * 60;

const MINUTE_IN_MS: number = 60 * 1000;

// A priority's targets, as the server and the dashboard hold it.
export interface SecurityCasePriorityTargets {
  acknowledgeWithinInMinutes?: number | null | undefined;
  containWithinInMinutes?: number | null | undefined;
}

// What a case holds that its targets are read from.
export interface SecurityCaseTargetMoments {
  createdAt?: Date | null | undefined;
  acknowledgedAt?: Date | null | undefined;
  containedAt?: Date | null | undefined;
  closedAt?: Date | null | undefined;
  acknowledgeDueAt?: Date | null | undefined;
  containDueAt?: Date | null | undefined;
  acknowledgeWarnedAt?: Date | null | undefined;
  acknowledgeMissedAt?: Date | null | undefined;
  containWarnedAt?: Date | null | undefined;
  containMissedAt?: Date | null | undefined;
}

// The columns each target is kept in, on the priority and on the case.
export interface SecurityCaseTargetColumns {
  priorityColumn: keyof SecurityCasePriorityTargets;
  dueColumn: "acknowledgeDueAt" | "containDueAt";
  warnedColumn: "acknowledgeWarnedAt" | "containWarnedAt";
  missedColumn: "acknowledgeMissedAt" | "containMissedAt";
}

export const SECURITY_CASE_TARGET_COLUMNS: Readonly<
  Record<SecurityCaseTarget, SecurityCaseTargetColumns>
> = {
  [SecurityCaseTarget.Acknowledge]: {
    priorityColumn: "acknowledgeWithinInMinutes",
    dueColumn: "acknowledgeDueAt",
    warnedColumn: "acknowledgeWarnedAt",
    missedColumn: "acknowledgeMissedAt",
  },
  [SecurityCaseTarget.Contain]: {
    priorityColumn: "containWithinInMinutes",
    dueColumn: "containDueAt",
    warnedColumn: "containWarnedAt",
    missedColumn: "containMissedAt",
  },
};

// Where a case stands against one target.
export enum SecurityCaseTargetState {
  // No due time: the priority has no target, or it was met as the case opened.
  None = "None",
  OnTrack = "OnTrack",
  // In the target's last fifth, not met yet.
  AtRisk = "AtRisk",
  // Past its due time, not met yet.
  Missed = "Missed",
  // Met by its due time.
  Met = "Met",
  // Met, but after its due time.
  MetLate = "MetLate",
}

// One target of a case, read at a moment.
export interface SecurityCaseTargetReading {
  target: SecurityCaseTarget;
  state: SecurityCaseTargetState;
  dueAt: Date | null;
  // When it is at risk from: the last fifth of its priority's target.
  atRiskAt: Date | null;
  metAt: Date | null;
  // The priority's target now, in minutes; null for none.
  targetInMinutes: number | null;
  /*
   * Minutes between the due time and the moment that matters: left before
   * it (on track, at risk), past it (missed: now; met late: when it was
   * met), or to spare (met).
   */
  minutes: number | null;
}

// Changes to a case's target columns: a date, or null to clear one.
export type SecurityCaseTargetWrite = Partial<
  Record<
    | "acknowledgeDueAt"
    | "containDueAt"
    | "acknowledgeWarnedAt"
    | "acknowledgeMissedAt"
    | "containWarnedAt"
    | "containMissedAt"
    | "nextDueAt"
    | "nextTargetCheckAt",
    Date | null
  >
>;

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_IN_MS);
}

function earliest(dates: Array<Date | null>): Date | null {
  let found: Date | null = null;

  for (const date of dates) {
    if (date && (!found || date.getTime() < found.getTime())) {
      found = date;
    }
  }

  return found;
}

/*
 * A target as a priority may hold it: a whole number of minutes from 1 to
 * a year. Anything else - empty, zero, negative, fractional, too long, not
 * a number - is no target.
 */
export function readTargetMinutes(value: unknown): number | null {
  const minutes: number =
    typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN;

  if (
    !Number.isFinite(minutes) ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > MAX_SECURITY_CASE_TARGET_IN_MINUTES
  ) {
    return null;
  }

  return minutes;
}

// A priority's target for one of the two, in minutes, or null for none.
export function getTargetMinutes(
  priority: SecurityCasePriorityTargets | null | undefined,
  target: SecurityCaseTarget,
): number | null {
  if (!priority) {
    return null;
  }

  return readTargetMinutes(
    priority[SECURITY_CASE_TARGET_COLUMNS[target].priorityColumn],
  );
}

// Whether a priority has either target.
export function hasTargets(
  priority: SecurityCasePriorityTargets | null | undefined,
): boolean {
  return SECURITY_CASE_TARGETS.some((target: SecurityCaseTarget): boolean => {
    return getTargetMinutes(priority, target) !== null;
  });
}

// When a target was met: acknowledged; contained, or closed.
export function getTargetMetAt(
  securityCase: SecurityCaseTargetMoments,
  target: SecurityCaseTarget,
): Date | null {
  if (target === SecurityCaseTarget.Acknowledge) {
    return toDate(securityCase.acknowledgedAt);
  }

  return earliest([
    toDate(securityCase.containedAt),
    toDate(securityCase.closedAt),
  ]);
}

function getDueAt(
  securityCase: SecurityCaseTargetMoments,
  target: SecurityCaseTarget,
): Date | null {
  return toDate(securityCase[SECURITY_CASE_TARGET_COLUMNS[target].dueColumn]);
}

function getWarnedAt(
  securityCase: SecurityCaseTargetMoments,
  target: SecurityCaseTarget,
): Date | null {
  return toDate(
    securityCase[SECURITY_CASE_TARGET_COLUMNS[target].warnedColumn],
  );
}

function getMissedAt(
  securityCase: SecurityCaseTargetMoments,
  target: SecurityCaseTarget,
): Date | null {
  return toDate(
    securityCase[SECURITY_CASE_TARGET_COLUMNS[target].missedColumn],
  );
}

/*
 * When a target is at risk from: its due time less the last fifth of the
 * priority's target. Null without a due time or a target to take the fifth
 * of; never before the case opened.
 */
export function getAtRiskAt(data: {
  dueAt: Date | null;
  targetInMinutes: number | null;
  openedAt?: Date | null | undefined;
}): Date | null {
  if (!data.dueAt || data.targetInMinutes === null) {
    return null;
  }

  const atRiskAt: Date = new Date(
    data.dueAt.getTime() -
      Math.round(
        data.targetInMinutes *
          SECURITY_CASE_TARGET_AT_RISK_FRACTION *
          MINUTE_IN_MS,
      ),
  );
  const openedAt: Date | null = toDate(data.openedAt);

  return openedAt && atRiskAt.getTime() < openedAt.getTime()
    ? openedAt
    : atRiskAt;
}

// Where a case stands against one target at `now`.
export function readSecurityCaseTarget(data: {
  securityCase: SecurityCaseTargetMoments;
  target: SecurityCaseTarget;
  // The case's priority as it is now: its target sizes the at-risk window.
  priority: SecurityCasePriorityTargets | null | undefined;
  now: Date;
}): SecurityCaseTargetReading {
  const { securityCase, target, now } = data;
  const dueAt: Date | null = getDueAt(securityCase, target);
  const metAt: Date | null = getTargetMetAt(securityCase, target);
  const targetInMinutes: number | null = getTargetMinutes(
    data.priority,
    target,
  );
  const atRiskAt: Date | null = getAtRiskAt({
    dueAt,
    targetInMinutes,
    openedAt: toDate(securityCase.createdAt),
  });

  const reading: SecurityCaseTargetReading = {
    target,
    state: SecurityCaseTargetState.None,
    dueAt,
    atRiskAt,
    metAt,
    targetInMinutes,
    minutes: null,
  };

  if (!dueAt) {
    return reading;
  }

  const minutesBetween: (from: Date, to: Date) => number = (
    from: Date,
    to: Date,
  ): number => {
    return Math.max(0, (to.getTime() - from.getTime()) / MINUTE_IN_MS);
  };

  if (metAt) {
    const isLate: boolean = metAt.getTime() > dueAt.getTime();

    return {
      ...reading,
      state: isLate
        ? SecurityCaseTargetState.MetLate
        : SecurityCaseTargetState.Met,
      minutes: isLate
        ? minutesBetween(dueAt, metAt)
        : minutesBetween(metAt, dueAt),
    };
  }

  if (
    now.getTime() >= dueAt.getTime() ||
    getMissedAt(securityCase, target) !== null
  ) {
    return {
      ...reading,
      state: SecurityCaseTargetState.Missed,
      minutes: minutesBetween(dueAt, now),
    };
  }

  return {
    ...reading,
    state:
      atRiskAt && now.getTime() >= atRiskAt.getTime()
        ? SecurityCaseTargetState.AtRisk
        : SecurityCaseTargetState.OnTrack,
    minutes: minutesBetween(now, dueAt),
  };
}

// Both targets of a case, acknowledge first.
export function readSecurityCaseTargets(data: {
  securityCase: SecurityCaseTargetMoments;
  priority: SecurityCasePriorityTargets | null | undefined;
  now: Date;
}): Array<SecurityCaseTargetReading> {
  return SECURITY_CASE_TARGETS.map(
    (target: SecurityCaseTarget): SecurityCaseTargetReading => {
      return readSecurityCaseTarget({ ...data, target });
    },
  );
}

// Whether a reading is a target the case still has to meet.
export function isPendingTarget(reading: SecurityCaseTargetReading): boolean {
  return (
    reading.state === SecurityCaseTargetState.OnTrack ||
    reading.state === SecurityCaseTargetState.AtRisk ||
    reading.state === SecurityCaseTargetState.Missed
  );
}

/*
 * The target a case is working against now: of those not met yet, the one
 * due first - a missed one before any other. What the case's header and the
 * case lists show. Null when nothing is pending.
 */
export function getNextPendingTarget(
  readings: ReadonlyArray<SecurityCaseTargetReading>,
): SecurityCaseTargetReading | null {
  let next: SecurityCaseTargetReading | null = null;

  for (const reading of readings) {
    if (!isPendingTarget(reading) || !reading.dueAt) {
      continue;
    }

    if (!next || reading.dueAt.getTime() < next.dueAt!.getTime()) {
      next = reading;
    }
  }

  return next;
}

// ---------- What the case's service writes ----------

/*
 * The due times of a case opening at `openedAt` at `priority`: each target
 * from now, unless the case meets it as it opens.
 */
export function getDueTimesForNewCase(data: {
  openedAt: Date;
  priority: SecurityCasePriorityTargets | null | undefined;
  acknowledgedAt?: Date | null | undefined;
  containedAt?: Date | null | undefined;
  closedAt?: Date | null | undefined;
}): { acknowledgeDueAt: Date | null; containDueAt: Date | null } {
  const moments: SecurityCaseTargetMoments = {
    acknowledgedAt: data.acknowledgedAt || null,
    containedAt: data.containedAt || null,
    closedAt: data.closedAt || null,
  };

  const dueFor: (target: SecurityCaseTarget) => Date | null = (
    target: SecurityCaseTarget,
  ): Date | null => {
    const minutes: number | null = getTargetMinutes(data.priority, target);

    if (minutes === null || getTargetMetAt(moments, target)) {
      return null;
    }

    return addMinutes(data.openedAt, minutes);
  };

  return {
    acknowledgeDueAt: dueFor(SecurityCaseTarget.Acknowledge),
    containDueAt: dueFor(SecurityCaseTarget.Contain),
  };
}

/*
 * One target's due time after the case's priority changed: undefined when
 * it stays as it is, null when it is taken away. See the rules at the top.
 */
export function getDueTimeAfterPriorityChange(data: {
  dueAt: Date | null;
  // Met or missed already: nothing moves.
  isSettled: boolean;
  isRising: boolean;
  newTargetInMinutes: number | null;
  openedAt: Date;
  now: Date;
}): Date | null | undefined {
  if (data.isSettled) {
    return undefined;
  }

  if (!data.dueAt) {
    return data.newTargetInMinutes === null
      ? undefined
      : addMinutes(data.now, data.newTargetInMinutes);
  }

  if (data.newTargetInMinutes === null) {
    return data.isRising ? undefined : null;
  }

  if (data.isRising) {
    const fromNow: Date = addMinutes(data.now, data.newTargetInMinutes);

    return fromNow.getTime() < data.dueAt.getTime() ? fromNow : undefined;
  }

  const fromOpening: Date = addMinutes(data.openedAt, data.newTargetInMinutes);

  return fromOpening.getTime() > data.dueAt.getTime() ? fromOpening : undefined;
}

// Both targets' due times after a priority change; only what changes.
export function getDueTimesAfterPriorityChange(data: {
  securityCase: SecurityCaseTargetMoments;
  newPriority: SecurityCasePriorityTargets | null | undefined;
  isRising: boolean;
  now: Date;
}): SecurityCaseTargetWrite {
  const write: SecurityCaseTargetWrite = {};
  const openedAt: Date = toDate(data.securityCase.createdAt) || data.now;

  for (const target of SECURITY_CASE_TARGETS) {
    const columns: SecurityCaseTargetColumns =
      SECURITY_CASE_TARGET_COLUMNS[target];
    const next: Date | null | undefined = getDueTimeAfterPriorityChange({
      dueAt: getDueAt(data.securityCase, target),
      isSettled:
        getTargetMetAt(data.securityCase, target) !== null ||
        getMissedAt(data.securityCase, target) !== null,
      isRising: data.isRising,
      newTargetInMinutes: getTargetMinutes(data.newPriority, target),
      openedAt,
      now: data.now,
    });

    if (next === undefined) {
      continue;
    }

    write[columns.dueColumn] = next;

    // A due time that moved has not been warned about yet.
    write[columns.warnedColumn] = null;
  }

  return write;
}

/*
 * A reopened case's contain target, started again from `now`, with nothing
 * said about it yet. Null due time for a priority without one.
 */
export function getContainTargetAfterReopen(data: {
  priority: SecurityCasePriorityTargets | null | undefined;
  now: Date;
}): SecurityCaseTargetWrite {
  const minutes: number | null = getTargetMinutes(
    data.priority,
    SecurityCaseTarget.Contain,
  );

  return {
    containDueAt: minutes === null ? null : addMinutes(data.now, minutes),
    containWarnedAt: null,
    containMissedAt: null,
  };
}

/*
 * The earliest due time of a target the case has not met, a missed one
 * among them: what the case lists sort by. Null when none is left.
 */
export function getNextDueAt(
  securityCase: SecurityCaseTargetMoments,
): Date | null {
  return earliest(
    SECURITY_CASE_TARGETS.map((target: SecurityCaseTarget): Date | null => {
      return getTargetMetAt(securityCase, target)
        ? null
        : getDueAt(securityCase, target);
    }),
  );
}

/*
 * When the every-minute check must next look at the case: for each target
 * not met and not missed, its at-risk moment until it has been warned
 * about, then its due time. Null when there is nothing left to say.
 */
export function getNextTargetCheckAt(data: {
  securityCase: SecurityCaseTargetMoments;
  priority: SecurityCasePriorityTargets | null | undefined;
}): Date | null {
  const moments: Array<Date | null> = [];

  for (const target of SECURITY_CASE_TARGETS) {
    const dueAt: Date | null = getDueAt(data.securityCase, target);

    if (
      !dueAt ||
      getTargetMetAt(data.securityCase, target) ||
      getMissedAt(data.securityCase, target)
    ) {
      continue;
    }

    const atRiskAt: Date | null = getAtRiskAt({
      dueAt,
      targetInMinutes: getTargetMinutes(data.priority, target),
      openedAt: toDate(data.securityCase.createdAt),
    });

    moments.push(
      atRiskAt && !getWarnedAt(data.securityCase, target) ? atRiskAt : dueAt,
    );
  }

  return earliest(moments);
}

// The case's two bookkeeping columns, from what it holds.
export function getTargetBookkeeping(data: {
  securityCase: SecurityCaseTargetMoments;
  priority: SecurityCasePriorityTargets | null | undefined;
}): { nextDueAt: Date | null; nextTargetCheckAt: Date | null } {
  return {
    nextDueAt: getNextDueAt(data.securityCase),
    nextTargetCheckAt: getNextTargetCheckAt(data),
  };
}

// ---------- What the every-minute check says ----------

export enum SecurityCaseTargetAlertKind {
  AtRisk = "AtRisk",
  Missed = "Missed",
}

export interface SecurityCaseTargetAlert {
  target: SecurityCaseTarget;
  kind: SecurityCaseTargetAlertKind;
  dueAt: Date;
  targetInMinutes: number | null;
}

/*
 * What is to be said about a case at `now`: a target past its due time and
 * not missed yet, missed; one in its last fifth and not warned about yet,
 * at risk. A target already past its due time is only ever missed - a
 * warning that comes too late is not sent.
 */
export function getTargetAlertsDue(data: {
  securityCase: SecurityCaseTargetMoments;
  priority: SecurityCasePriorityTargets | null | undefined;
  now: Date;
}): Array<SecurityCaseTargetAlert> {
  const alerts: Array<SecurityCaseTargetAlert> = [];

  for (const target of SECURITY_CASE_TARGETS) {
    const dueAt: Date | null = getDueAt(data.securityCase, target);

    if (
      !dueAt ||
      getTargetMetAt(data.securityCase, target) ||
      getMissedAt(data.securityCase, target)
    ) {
      continue;
    }

    const targetInMinutes: number | null = getTargetMinutes(
      data.priority,
      target,
    );

    if (data.now.getTime() >= dueAt.getTime()) {
      alerts.push({
        target,
        kind: SecurityCaseTargetAlertKind.Missed,
        dueAt,
        targetInMinutes,
      });
      continue;
    }

    const atRiskAt: Date | null = getAtRiskAt({
      dueAt,
      targetInMinutes,
      openedAt: toDate(data.securityCase.createdAt),
    });

    if (
      atRiskAt &&
      data.now.getTime() >= atRiskAt.getTime() &&
      !getWarnedAt(data.securityCase, target)
    ) {
      alerts.push({
        target,
        kind: SecurityCaseTargetAlertKind.AtRisk,
        dueAt,
        targetInMinutes,
      });
    }
  }

  return alerts;
}

// The stamps that record alerts said at `now`.
export function getAlertStamps(
  alerts: ReadonlyArray<SecurityCaseTargetAlert>,
  now: Date,
): SecurityCaseTargetWrite {
  const write: SecurityCaseTargetWrite = {};

  for (const alert of alerts) {
    const columns: SecurityCaseTargetColumns =
      SECURITY_CASE_TARGET_COLUMNS[alert.target];

    write[
      alert.kind === SecurityCaseTargetAlertKind.Missed
        ? columns.missedColumn
        : columns.warnedColumn
    ] = now;
  }

  return write;
}

// ---------- Words ----------

/*
 * A duration in English, by its two largest units: "15 minutes", "1 hour",
 * "1 hour 30 minutes", "3 days", "1 day 4 hours". For the server's
 * messages; the dashboard says durations in the reader's language.
 */
export function describeTargetDuration(minutes: number): string {
  const total: number = Math.max(0, Math.round(minutes));
  const unit: (count: number, word: string) => string = (
    count: number,
    word: string,
  ): string => {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
  };

  if (total < 60) {
    return unit(total, "minute");
  }

  const hours: number = Math.floor(total / 60);
  const restMinutes: number = total % 60;

  if (hours < 24) {
    return restMinutes > 0
      ? `${unit(hours, "hour")} ${unit(restMinutes, "minute")}`
      : unit(hours, "hour");
  }

  const days: number = Math.floor(hours / 24);
  const restHours: number = hours % 24;

  return restHours > 0
    ? `${unit(days, "day")} ${unit(restHours, "hour")}`
    : unit(days, "day");
}

// A target's verb, in the server's messages: "acknowledge", "contain".
export function getTargetVerb(target: SecurityCaseTarget): string {
  return target === SecurityCaseTarget.Acknowledge ? "acknowledge" : "contain";
}
