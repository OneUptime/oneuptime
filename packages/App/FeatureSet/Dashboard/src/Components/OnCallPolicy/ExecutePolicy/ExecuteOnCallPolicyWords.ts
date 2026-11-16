import { OnCallPageRecordType } from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import { translationKey } from "Common/Types/Translator";
import { EventStanding } from "../../../Utils/EventDuration";

/*
 * EXECUTE ON-CALL POLICY, BY WHERE THE RECORD STANDS (issue #7839).
 *
 * The Actions menu of an incident's, an alert's or an episode's feed starts
 * an on-call policy by hand (OnCallPolicyStartedByHand). Such a run goes on
 * paging, level by level, until somebody it paged answers it or the record
 * is resolved: somebody else acknowledging the record does not stop it -
 * that is how a responder pages another team into a record they are on.
 *
 *   - On a RESOLVED record nothing is started: the server refuses it, in the
 *     words Slack's and Microsoft Teams' own buttons use ("This incident is
 *     resolved, so no on-call policy was started.",
 *     getOnCallPolicyStartedOnResolvedRecordMessage). The menu item says so
 *     before the form is filled in, locked with why, instead of after it is
 *     sent.
 *   - On an ACKNOWLEDGED record, the form says that the policy still pages
 *     its people until one of them answers, so whoever starts it knows that
 *     the acknowledgement already there - or another one - will not stop
 *     it.
 *   - On an OPEN record, or one whose state could not be read, the form says
 *     how long the policy pages, and the item is offered as it always was:
 *     the server still has the last word.
 *
 * One table for the four feeds, so they say it in the same words, and every
 * sentence whole for each record: a translation never builds one from
 * pieces.
 */

interface ExecuteOnCallPolicyRecordWords {
  // The form's description on a record nobody acknowledged yet.
  open: string;
  // The form's description on a record somebody acknowledged.
  acknowledged: string;
  // Why the menu item is locked on a resolved record.
  resolved: string;
}

export const EXECUTE_ON_CALL_POLICY_WORDS: Record<
  OnCallPageRecordType,
  ExecuteOnCallPolicyRecordWords
> = {
  [OnCallPageRecordType.Incident]: {
    open: translationKey(
      "Pages the people of the policy you pick about this incident, level by level, until one of them answers or the incident is resolved.",
    ),
    acknowledged: translationKey(
      "This incident is acknowledged already. The policy you pick still pages its people, level by level, until one of them answers or the incident is resolved.",
    ),
    resolved: translationKey(
      "This incident is resolved, so no on-call policy can be started for it.",
    ),
  },
  [OnCallPageRecordType.Alert]: {
    open: translationKey(
      "Pages the people of the policy you pick about this alert, level by level, until one of them answers or the alert is resolved.",
    ),
    acknowledged: translationKey(
      "This alert is acknowledged already. The policy you pick still pages its people, level by level, until one of them answers or the alert is resolved.",
    ),
    resolved: translationKey(
      "This alert is resolved, so no on-call policy can be started for it.",
    ),
  },
  [OnCallPageRecordType.IncidentEpisode]: {
    open: translationKey(
      "Pages the people of the policy you pick about this incident episode, level by level, until one of them answers or the episode is resolved.",
    ),
    acknowledged: translationKey(
      "This incident episode is acknowledged already. The policy you pick still pages its people, level by level, until one of them answers or the episode is resolved.",
    ),
    resolved: translationKey(
      "This incident episode is resolved, so no on-call policy can be started for it.",
    ),
  },
  [OnCallPageRecordType.AlertEpisode]: {
    open: translationKey(
      "Pages the people of the policy you pick about this alert episode, level by level, until one of them answers or the episode is resolved.",
    ),
    acknowledged: translationKey(
      "This alert episode is acknowledged already. The policy you pick still pages its people, level by level, until one of them answers or the episode is resolved.",
    ),
    resolved: translationKey(
      "This alert episode is resolved, so no on-call policy can be started for it.",
    ),
  },
};

// How the Actions menu offers Execute On-Call Policy on a record.
export interface ExecuteOnCallPolicyMenuLock {
  isDisabled: boolean;
  // Why it is locked, as the menu shows it; none while it is offered.
  tooltip: string | undefined;
}

/*
 * Locked with why on a resolved record; offered on every other, and while
 * where the record stands is not known yet (`standing` undefined).
 */
export function getExecuteOnCallPolicyMenuLock(data: {
  recordType: OnCallPageRecordType;
  standing: EventStanding | undefined;
}): ExecuteOnCallPolicyMenuLock {
  if (data.standing === EventStanding.Resolved) {
    return {
      isDisabled: true,
      tooltip: EXECUTE_ON_CALL_POLICY_WORDS[data.recordType].resolved,
    };
  }

  return { isDisabled: false, tooltip: undefined };
}

/*
 * The form's description: on an acknowledged record, that the policy still
 * pages its people until one of them answers; on a record resolved while
 * the form was open, why nothing will be started; else how long it pages.
 */
export function getExecuteOnCallPolicyDescription(data: {
  recordType: OnCallPageRecordType;
  standing: EventStanding | undefined;
}): string {
  const words: ExecuteOnCallPolicyRecordWords =
    EXECUTE_ON_CALL_POLICY_WORDS[data.recordType];

  switch (data.standing) {
    case EventStanding.Acknowledged:
      return words.acknowledged;
    case EventStanding.Resolved:
      return words.resolved;
    case EventStanding.Open:
    default:
      return words.open;
  }
}
