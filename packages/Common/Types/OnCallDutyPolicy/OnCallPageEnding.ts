import { ON_CALL_PAGE_RECORD_DELETED_MESSAGE_START } from "./OnCallPageRecordGone";

/*
 * HOW A PERSON'S PAGE SAYS IT ENDED, OR WAS ANSWERED (#8551).
 *
 * A person's page (UserOnCallLog) stops once nobody needs paging any more:
 * the person's-log worker (UserOnCallLog:ExecutePendingExecutions) ends it
 * when its record was acknowledged, and a page again or an observer's page
 * once it, or its record, is answered, resolved or deleted
 * (OnCallAcknowledgementTimeout.getPageAgainOverReason). A person who
 * acknowledges the page from one of its notifications marks it so
 * (UserOnCallLogTimelineService). Each says so in English, for every
 * reader.
 *
 * The writers write these lines from here, and the on-call logs read them
 * back into codes (OnCallLogLine) to word them in the reader's language:
 * the same words as before, so a page written before this file is read the
 * same.
 *
 * React-free and server-safe.
 */

// Why a page again's or an observer's page is over, as its line says it.
export const ON_CALL_PAGE_OVER_PAGE_ACKNOWLEDGED_REASON: string =
  "this page is acknowledged";
export const ON_CALL_PAGE_OVER_PAGE_AGAIN_ACKNOWLEDGED_REASON: string =
  "this page again is acknowledged";

// "incident is deleted", "alert episode is resolved".
export function getOnCallPageOverRecordDeletedReason(kind: string): string {
  return `${kind} is deleted`;
}

export function getOnCallPageOverRecordResolvedReason(kind: string): string {
  return `${kind} is resolved`;
}

/*
 * "Execution completed because <reason>." - a person's page that is over,
 * for one of the reasons above.
 */
export function getUserOnCallLogEndedMessage(reason: string): string {
  return `${ON_CALL_PAGE_RECORD_DELETED_MESSAGE_START}${reason}.`;
}

/*
 * "Execution completed because incident is acknowledged." - a person's page
 * that stopped because its record was acknowledged.
 */
export function getUserOnCallLogRecordAcknowledgedMessage(
  kind: string,
): string {
  return getUserOnCallLogEndedMessage(`${kind} is acknowledged`);
}

/*
 * A person's page they acknowledged from one of its notifications:
 * "Incident acknowledged by Ana Lopez (ana@acme.example)". The record is
 * named as a label: Incident, Alert, Incident Episode, Alert Episode.
 */
const ACKNOWLEDGED_BY: string = " acknowledged by ";

export const ON_CALL_PAGE_ACKNOWLEDGED_RECORD_LABELS: ReadonlyArray<string> = [
  "Incident",
  "Alert",
  "Incident Episode",
  "Alert Episode",
];

export function getOnCallPageAcknowledgedByMessage(data: {
  recordLabel: string;
  userName: string;
  userEmail: string;
}): string {
  return `${data.recordLabel}${ACKNOWLEDGED_BY}${data.userName} (${data.userEmail})`;
}

/*
 * The record's label and who acknowledged ("Ana Lopez (ana@acme.example)")
 * an acknowledged page's line names; null for any other line.
 */
export function readOnCallPageAcknowledgedByMessage(
  statusMessage: string | null | undefined,
): { recordLabel: string; who: string } | null {
  const message: string = (statusMessage || "").trim();

  for (const recordLabel of ON_CALL_PAGE_ACKNOWLEDGED_RECORD_LABELS) {
    const start: string = `${recordLabel}${ACKNOWLEDGED_BY}`;

    if (message.startsWith(start)) {
      const who: string = message.slice(start.length).trim();

      return who ? { recordLabel: recordLabel, who: who } : null;
    }
  }

  return null;
}
