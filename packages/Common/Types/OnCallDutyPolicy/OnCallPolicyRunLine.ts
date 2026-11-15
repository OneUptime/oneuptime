import {
  ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
  ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
} from "./OnCallDutyPolicyArchive";
import {
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
  isOnCallPolicyRunEverybodyPassedOnMessage,
  isOnCallPolicyRunNobodyNotifiedMessage,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "./OnCallDutyPolicyRunEnding";
import { ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE } from "./OnCallPageLine";

/*
 * AN ON-CALL POLICY RUN'S OWN LINE, AS A CODE (#8330).
 *
 * A run says how it ended in its status message, in English, for every
 * reader: the worker that ends runs writes it from OnCallDutyPolicyRunEnding
 * and OnCallDutyPolicyArchive. The Execution Logs table's View Status
 * Message dialog drew that message as it was, so a German reader read
 * "Execution completed because incident is acknowledged or resolved." in
 * English, and an Arabic or Persian one read it laid out right to left,
 * its full stop first.
 *
 * This reads the endings OneUptime writes back into a code, compared with
 * the very constants and builders the worker writes them with - so a run
 * written before this file is read the same way, and a line that changes is
 * read the same way or not at all. The Dashboard words the code in the
 * reader's language (OnCallLogLineWords). Any other line - a run still
 * paging, an error's own words, a test page's, a direct page's - is no
 * ending of a policy's run, reads as null, and is shown as written.
 *
 * React-free and server-safe.
 */

export enum OnCallPolicyRunLineCode {
  // It went through every escalation rule, and every repeat.
  WentThroughEveryRule = "WentThroughEveryRule",
  // Everybody it paged escalated it: nobody was left to page.
  EverybodyEscalated = "EverybodyEscalated",
  // No escalation rule of the policy had anybody to page.
  NobodyNotified = "NobodyNotified",
  // Its record was acknowledged or resolved, so it stopped.
  RecordHandled = "RecordHandled",
  // A page again, whose record was resolved.
  RecordResolved = "RecordResolved",
  // The policy was archived, so the run never paged.
  PolicyArchivedNotRun = "PolicyArchivedNotRun",
  // The policy was archived while the run escalated: it stopped.
  PolicyArchivedStopped = "PolicyArchivedStopped",
  // The policy has no escalation rules.
  PolicyHasNoRules = "PolicyHasNoRules",
}

// The records a run pages about, as its ending names them.
export enum OnCallPolicyRunRecordKind {
  Incident = "incident",
  Alert = "alert",
  IncidentEpisode = "incident episode",
  AlertEpisode = "alert episode",
}

export const ON_CALL_POLICY_RUN_RECORD_KINDS: ReadonlyArray<OnCallPolicyRunRecordKind> =
  [
    OnCallPolicyRunRecordKind.Incident,
    OnCallPolicyRunRecordKind.Alert,
    OnCallPolicyRunRecordKind.IncidentEpisode,
    OnCallPolicyRunRecordKind.AlertEpisode,
  ];

export interface OnCallPolicyRunLine {
  code: OnCallPolicyRunLineCode;
  // The record that was handled or resolved: RecordHandled, RecordResolved.
  recordKind?: OnCallPolicyRunRecordKind | undefined;
}

/*
 * The ending of a policy's run its status message says, or null for any
 * other line.
 */
export function readOnCallPolicyRunLine(
  statusMessage: string | null | undefined,
): OnCallPolicyRunLine | null {
  const message: string = (statusMessage || "").trim();

  if (!message) {
    return null;
  }

  if (message === ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE) {
    return { code: OnCallPolicyRunLineCode.WentThroughEveryRule };
  }

  if (isOnCallPolicyRunEverybodyPassedOnMessage(message)) {
    return { code: OnCallPolicyRunLineCode.EverybodyEscalated };
  }

  if (isOnCallPolicyRunNobodyNotifiedMessage(message)) {
    return { code: OnCallPolicyRunLineCode.NobodyNotified };
  }

  if (message === ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE) {
    return { code: OnCallPolicyRunLineCode.PolicyArchivedNotRun };
  }

  if (message === ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE) {
    return { code: OnCallPolicyRunLineCode.PolicyArchivedStopped };
  }

  if (message === ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE) {
    return { code: OnCallPolicyRunLineCode.PolicyHasNoRules };
  }

  for (const recordKind of ON_CALL_POLICY_RUN_RECORD_KINDS) {
    if (message === getOnCallPolicyRunRecordHandledMessage(recordKind)) {
      return {
        code: OnCallPolicyRunLineCode.RecordHandled,
        recordKind: recordKind,
      };
    }

    if (message === getOnCallPolicyRunRecordResolvedMessage(recordKind)) {
      return {
        code: OnCallPolicyRunLineCode.RecordResolved,
        recordKind: recordKind,
      };
    }
  }

  return null;
}
