import type { OnCallPageRecordType } from "../api/onCallPassOn";

/*
 * A PAGE THAT KEEPS THE READER INFORMED: AN OBSERVER'S PAGE.
 *
 * Some people are paged to know, not to respond - an oversight team told
 * about every critical incident another team owns, a manager told when
 * their service is down (the server's
 * Common/Types/OnCallDutyPolicy/OnCallObserverPage). Answering their page
 * only says they have seen it: the record is not acknowledged, nobody
 * else's page stops, and nobody becomes its Incident Commander. So wherever
 * the app shows one it says "FYI (observer)", offers "I've seen it", and
 * never offers the record's Acknowledge as the answer to it:
 *
 *   - under its push, on the lock screen (notifications/categories.ts);
 *   - on the record's screen while the page is open (oncall/pagedActions.ts),
 *     and for the push's action there (oncall/pushPageAction.ts);
 *   - in My Pages (components/OnCallPageCard.tsx).
 *
 * Once they have said they have seen it, the record's screen is as it is
 * for anybody: an observer who decides to step in acknowledges the record
 * as anybody does, and that is them taking it on.
 *
 * The words are the server's, as the email, the text and the Dashboard say
 * them. The app is built without Common's code, so it keeps its own copy;
 * Common's PushNotificationCategoryMobileParity holds the label and the
 * button to the server's.
 */

export const OBSERVER_PAGE_TEXT: Readonly<{
  label: string;
  seenButton: string;
  seenStatus: string;
  notSeenStatus: string;
  alreadySeenTitle: string;
  alreadySeen: string;
  alreadyResolvedTitle: string;
  couldNotCheckTitle: string;
  couldNotCheck: string;
  failedTitle: string;
  failed: string;
}> = {
  // A text message's lead and an email's subject (ON_CALL_OBSERVER_PAGE_SMS_LEAD).
  label: "FYI (observer)",
  // The email's button and the chat's (ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL).
  seenButton: "I've seen it",
  // My Pages, for an observer's page answered, and not yet.
  seenStatus: "Seen",
  notSeenStatus: "Not seen yet",
  // The email's words for a page answered already.
  alreadySeenTitle: "Already marked as seen",
  alreadySeen: "This page has already been marked as seen.",
  alreadyResolvedTitle: "Already resolved",
  couldNotCheckTitle: "Could not mark as seen",
  couldNotCheck:
    "OneUptime could not check whether you are paged as an observer about this right now. Pull down to refresh, then try again.",
  failedTitle: "Could not mark as seen",
  failed: "You are still paged as an observer. Please try again.",
};

// What an observer's page calls its record: the server's own kinds.
export type ObserverPageRecordKind =
  | "incident"
  | "alert"
  | "incident episode"
  | "alert episode";

export function getObserverPageRecordKind(
  recordType: OnCallPageRecordType,
): ObserverPageRecordKind {
  if (recordType === "alert") {
    return "alert";
  }
  if (recordType === "incident-episode") {
    return "incident episode";
  }
  if (recordType === "alert-episode") {
    return "alert episode";
  }
  return "incident";
}

/*
 * What the record's screen says while the reader's page as an observer is
 * open - the server's own words on the page its email's link opens.
 */
export function getObserverPageGuidance(
  recordType: OnCallPageRecordType,
): string {
  const kind: ObserverPageRecordKind = getObserverPageRecordKind(recordType);

  return `You're paged as an observer: the people responding stay on this ${kind}. Saying you've seen it does not acknowledge the ${kind}.`;
}

// Why there is nothing to mark seen on a resolved record.
export function getObserverPageResolvedMessage(
  recordType: OnCallPageRecordType,
): string {
  return `This ${getObserverPageRecordKind(recordType)} is resolved, so there is nothing to mark as seen.`;
}
