import { RESPONSE_TARGET_DURATION_COPY } from "./ResponseTargetsCopy";
import {
  MAX_SECURITY_CASE_TARGET_IN_MINUTES,
  readTargetMinutes,
} from "Common/Utils/SecurityCase/SecurityCaseTargets";

/*
 * A response target as a person enters it: a whole number and a unit -
 * "15 minutes", "4 hours", "3 days" - kept as minutes on the priority
 * (SecurityCasePriority.acknowledgeWithinInMinutes, containWithinInMinutes).
 * Empty is no target. React-free, so the conversions are pinned in a plain
 * test.
 */

export enum ResponseTargetUnit {
  Minutes = "Minutes",
  Hours = "Hours",
  Days = "Days",
}

export const RESPONSE_TARGET_UNITS: ReadonlyArray<ResponseTargetUnit> = [
  ResponseTargetUnit.Minutes,
  ResponseTargetUnit.Hours,
  ResponseTargetUnit.Days,
];

export const RESPONSE_TARGET_UNIT_MINUTES: Readonly<
  Record<ResponseTargetUnit, number>
> = {
  [ResponseTargetUnit.Minutes]: 1,
  [ResponseTargetUnit.Hours]: 60,
  [ResponseTargetUnit.Days]: 24 * 60,
};

// The unit's name, as the field's dropdown shows it.
export const RESPONSE_TARGET_UNIT_LABELS: Readonly<
  Record<ResponseTargetUnit, string>
> = {
  [ResponseTargetUnit.Minutes]: RESPONSE_TARGET_DURATION_COPY.minutes,
  [ResponseTargetUnit.Hours]: RESPONSE_TARGET_DURATION_COPY.hours,
  [ResponseTargetUnit.Days]: RESPONSE_TARGET_DURATION_COPY.days,
};

export interface ResponseTargetEntry {
  // As typed: digits, or empty for no target.
  amount: string;
  unit: ResponseTargetUnit;
}

// What a field's value turns into: minutes, no target, or why it can't be kept.
export interface ResponseTargetReading {
  minutes: number | null;
  error: string | null;
}

// Digits only, at most nine of them: no sign, no decimals, no exponent.
const WHOLE_NUMBER: RegExp = /^[0-9]{1,9}$/;

/*
 * Minutes as the field shows them: in the largest unit they fill whole -
 * 240 is "4 hours", 4320 "3 days", 90 "90 minutes" - and empty, in hours,
 * for no target.
 */
export function splitTargetMinutes(minutes: unknown): ResponseTargetEntry {
  const value: number | null = readTargetMinutes(minutes);

  if (value === null) {
    return { amount: "", unit: ResponseTargetUnit.Hours };
  }

  for (const unit of [ResponseTargetUnit.Days, ResponseTargetUnit.Hours]) {
    const size: number = RESPONSE_TARGET_UNIT_MINUTES[unit];

    if (value % size === 0) {
      return { amount: String(value / size), unit };
    }
  }

  return { amount: String(value), unit: ResponseTargetUnit.Minutes };
}

// What the person entered, in minutes: empty is no target.
export function readTargetEntry(
  entry: ResponseTargetEntry,
): ResponseTargetReading {
  const amount: string = entry.amount.trim();

  if (!amount) {
    return { minutes: null, error: null };
  }

  if (!WHOLE_NUMBER.test(amount) || Number(amount) < 1) {
    return {
      minutes: null,
      error: RESPONSE_TARGET_DURATION_COPY.wholeNumber,
    };
  }

  const minutes: number =
    Number(amount) * RESPONSE_TARGET_UNIT_MINUTES[entry.unit];

  if (minutes > MAX_SECURITY_CASE_TARGET_IN_MINUTES) {
    return { minutes: null, error: RESPONSE_TARGET_DURATION_COPY.tooLong };
  }

  return { minutes, error: null };
}

/*
 * The form value the field hands the form: minutes, null for no target, or
 * - for what cannot be kept - the entry itself, which the field's
 * validation (getTargetFieldError) refuses before anything is saved.
 */
export function getTargetFieldValue(
  entry: ResponseTargetEntry,
): number | null | ResponseTargetEntry {
  const reading: ResponseTargetReading = readTargetEntry(entry);

  return reading.error ? entry : reading.minutes;
}

// Why a form value cannot be saved, or null when it can.
export function getTargetFieldError(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "object") {
    return readTargetEntry(value as ResponseTargetEntry).error;
  }

  return readTargetMinutes(value) === null
    ? RESPONSE_TARGET_DURATION_COPY.wholeNumber
    : null;
}
