import { JSONObject } from "../../Types/JSON";

/*
 * WHAT A PERSON WRITES TO A FINDING, AS DATA (#10372, #10378).
 *
 * Confirm says a finding of low confidence is the data it was matched as;
 * Not Sensitive says it is not, and why; Sensitive Again takes that back.
 * Each is one update of the finding through the API
 * (DataStoreFindingService), and these build it: the Dashboard's buttons
 * (StoreView/Inside, Telemetry, StoreNotSensitiveModal) and Ask AI's
 * judge_data_security_finding write what these build, so a button and the
 * action that stands in for it cannot write two different things. Pure.
 */

export enum FindingDecision {
  Confirm = "confirm",
  NotSensitive = "not-sensitive",
}

export const FINDING_DECISIONS: ReadonlyArray<FindingDecision> = [
  FindingDecision.Confirm,
  FindingDecision.NotSensitive,
];

export function isFindingDecision(value: unknown): value is FindingDecision {
  return (FINDING_DECISIONS as ReadonlyArray<unknown>).includes(value);
}

// The longest reason a person writes for Not Sensitive.
export const MAX_NOT_SENSITIVE_REASON_LENGTH: number = 500;

// Confirm: the finding counts, with the confidence of a person's word.
export function getConfirmFindingWrite(): JSONObject {
  return { isConfirmed: true };
}

// Not Sensitive: it stops counting, and the reason says why.
export function getNotSensitiveFindingWrite(reason: string): JSONObject {
  return { isSuppressed: true, suppressedReason: reason };
}

// Sensitive Again: it counts again, and the reason is gone.
export function getSensitiveAgainFindingWrite(): JSONObject {
  return { isSuppressed: false, suppressedReason: "" };
}

export function getFindingDecisionWrite(
  decision: FindingDecision,
  reason?: string | undefined,
): JSONObject {
  return decision === FindingDecision.Confirm
    ? getConfirmFindingWrite()
    : getNotSensitiveFindingWrite((reason || "").trim());
}
