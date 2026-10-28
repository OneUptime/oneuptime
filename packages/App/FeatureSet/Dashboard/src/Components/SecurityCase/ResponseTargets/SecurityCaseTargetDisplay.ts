import {
  SECURITY_CASE_TARGET_DUE_IN,
  SECURITY_CASE_TARGET_OVERDUE_BY,
  SECURITY_CASE_TARGET_TILE_NOTES,
} from "./ResponseTargetsCopy";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import { Amber500, Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import {
  SecurityCasePriorityTargets,
  SecurityCaseTarget,
  SecurityCaseTargetMoments,
  SecurityCaseTargetReading,
  SecurityCaseTargetState,
  getNextPendingTarget,
  hasTargets,
  readSecurityCaseTargets,
} from "Common/Utils/SecurityCase/SecurityCaseTargets";

/*
 * How a case's response targets read on its pages and in its lists
 * (Common/Utils/SecurityCase/SecurityCaseTargets holds the rules):
 *
 *   - the case's header, on every page of the case, and the lists' Due
 *     column: the target the case is working against now - the next one
 *     not met, a missed one first - and how long is left ("Acknowledge in
 *     12 min"), or how far past it is ("Acknowledge overdue by 5 min"): grey
 *     on track, amber in its last fifth, red once missed. Nothing once every
 *     target is met, or the case has none;
 *   - the Overview's Time to Acknowledge and Time to Contain figures: under
 *     each, where the case stands against that target - due in, overdue by,
 *     within its target, or how far over it.
 *
 * React-free, so what each state reads as is pinned in a plain test.
 */

export enum SecurityCaseTargetTone {
  Neutral = "Neutral",
  Warning = "Warning",
  Danger = "Danger",
  Success = "Success",
}

// What a case holds that its targets are read from, as the dashboard reads it.
export interface SecurityCaseTargetCase extends SecurityCaseTargetMoments {
  securityCasePriorityId?: ObjectID | string | null | undefined;
}

export function getSecurityCaseTargetTone(
  state: SecurityCaseTargetState,
): SecurityCaseTargetTone {
  switch (state) {
    case SecurityCaseTargetState.AtRisk:
      return SecurityCaseTargetTone.Warning;
    case SecurityCaseTargetState.Missed:
    case SecurityCaseTargetState.MetLate:
      return SecurityCaseTargetTone.Danger;
    case SecurityCaseTargetState.Met:
      return SecurityCaseTargetTone.Success;
    default:
      return SecurityCaseTargetTone.Neutral;
  }
}

// A tone's color, for a pill.
export function getSecurityCaseTargetToneColor(
  tone: SecurityCaseTargetTone,
): Color {
  switch (tone) {
    case SecurityCaseTargetTone.Warning:
      return Amber500;
    case SecurityCaseTargetTone.Danger:
      return Red500;
    case SecurityCaseTargetTone.Success:
      return Green500;
    default:
      return Gray500;
  }
}

// A tone's text color, for words drawn on their own (both themes remap these).
export function getSecurityCaseTargetToneClassName(
  tone: SecurityCaseTargetTone,
): string {
  switch (tone) {
    case SecurityCaseTargetTone.Warning:
      return "text-amber-700";
    case SecurityCaseTargetTone.Danger:
      return "text-red-700";
    case SecurityCaseTargetTone.Success:
      return "text-green-700";
    default:
      return "text-gray-700";
  }
}

/*
 * Minutes as a target reads them: left before its due time, rounded up -
 * "in 1 min" rather than "in 0 min" - or past it, never less than a minute.
 */
export function roundTargetMinutes(minutes: number | null): number {
  if (minutes === null || !Number.isFinite(minutes)) {
    return 1;
  }

  return Math.max(1, Math.ceil(minutes - 1e-9));
}

// Both targets of a case, at its priority now.
export function readCaseTargets(data: {
  securityCase: SecurityCaseTargetCase;
  priorities: ReadonlyArray<SecurityCasePriority>;
  now: Date;
}): Array<SecurityCaseTargetReading> {
  const priority: SecurityCasePriority | null = SecurityCasePriorities.find(
    data.priorities,
    data.securityCase.securityCasePriorityId,
  );

  return readSecurityCaseTargets({
    securityCase: data.securityCase,
    priority,
    now: data.now,
  });
}

// What the header's chip and the Due column show: the next target, and when.
export interface SecurityCaseDue {
  target: SecurityCaseTarget;
  state: SecurityCaseTargetState;
  dueAt: Date;
  // Left before its due time, or past it, rounded to whole minutes.
  minutes: number;
  isOverdue: boolean;
  tone: SecurityCaseTargetTone;
  // "Acknowledge in {{time}}" or "Acknowledge overdue by {{time}}".
  template: string;
}

export function getSecurityCaseDue(data: {
  securityCase: SecurityCaseTargetCase;
  priorities: ReadonlyArray<SecurityCasePriority>;
  now: Date;
}): SecurityCaseDue | null {
  const reading: SecurityCaseTargetReading | null = getNextPendingTarget(
    readCaseTargets(data),
  );

  if (!reading || !reading.dueAt) {
    return null;
  }

  const isOverdue: boolean = reading.state === SecurityCaseTargetState.Missed;

  return {
    target: reading.target,
    state: reading.state,
    dueAt: reading.dueAt,
    minutes: roundTargetMinutes(reading.minutes),
    isOverdue,
    tone: getSecurityCaseTargetTone(reading.state),
    template: isOverdue
      ? SECURITY_CASE_TARGET_OVERDUE_BY[reading.target]
      : SECURITY_CASE_TARGET_DUE_IN[reading.target],
  };
}

// What the Overview says under a target's figure.
export interface SecurityCaseTargetNote {
  // A template with {{time}} and {{target}} in it, where they apply.
  template: string;
  // {{time}}: minutes left, past due, or over the target.
  minutes: number | null;
  // {{target}}: the priority's target, in minutes.
  targetInMinutes: number | null;
  tone: SecurityCaseTargetTone;
}

export function getSecurityCaseTargetNote(
  reading: SecurityCaseTargetReading,
): SecurityCaseTargetNote | null {
  const tone: SecurityCaseTargetTone = getSecurityCaseTargetTone(reading.state);

  switch (reading.state) {
    case SecurityCaseTargetState.OnTrack:
    case SecurityCaseTargetState.AtRisk:
      return {
        template: SECURITY_CASE_TARGET_TILE_NOTES.dueIn,
        minutes: roundTargetMinutes(reading.minutes),
        targetInMinutes: reading.targetInMinutes,
        tone,
      };
    case SecurityCaseTargetState.Missed:
      return {
        template: SECURITY_CASE_TARGET_TILE_NOTES.overdueBy,
        minutes: roundTargetMinutes(reading.minutes),
        targetInMinutes: reading.targetInMinutes,
        tone,
      };
    case SecurityCaseTargetState.Met:
      return {
        template:
          reading.targetInMinutes !== null
            ? SECURITY_CASE_TARGET_TILE_NOTES.withinTarget
            : SECURITY_CASE_TARGET_TILE_NOTES.metByDueTime,
        minutes: null,
        targetInMinutes: reading.targetInMinutes,
        tone,
      };
    case SecurityCaseTargetState.MetLate:
      return {
        template:
          reading.targetInMinutes !== null
            ? SECURITY_CASE_TARGET_TILE_NOTES.overTarget
            : SECURITY_CASE_TARGET_TILE_NOTES.pastDueTime,
        minutes: roundTargetMinutes(reading.minutes),
        targetInMinutes: reading.targetInMinutes,
        tone,
      };
    default:
      return null;
  }
}

/*
 * Whether any of the project's priorities sets a target: the case lists
 * draw their Due column only then, rather than a column of dashes.
 */
export function projectHasTargets(
  priorities: ReadonlyArray<SecurityCasePriorityTargets>,
): boolean {
  return priorities.some((priority: SecurityCasePriorityTargets): boolean => {
    return hasTargets(priority);
  });
}
