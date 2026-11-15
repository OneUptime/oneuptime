import BadDataException from "../Exception/BadDataException";

/*
 * A PERSON'S PAGE WHOSE INCIDENT, ALERT OR EPISODE IS GONE.
 *
 * A person's on-call log pages them about one record - an incident, an
 * alert, an incident episode or an alert episode - and runs their On-Call
 * Rules ("call me after 10 minutes") until it is acknowledged. A record
 * deleted while some of those rules were still due does not come back:
 * nothing is left to page about, and nobody can acknowledge it. So the log
 * ends there (UserOnCallLog:ExecutePendingExecutions), Completed, saying its
 * record was deleted - the words a page again already ended with when its
 * record was deleted (OnCallAcknowledgementTimeout.getPageAgainOverReason:
 * "incident is deleted").
 *
 * It used to throw a plain Error, which the worker reads as a failure a
 * retry can fix: the log stayed Executing, and was tried, failed and logged
 * an error every minute, forever (issue #8106). Nothing else ends an
 * Executing log: UserOnCallLog:TimeoutStuckExecutions ends Started ones.
 *
 * A log that names no record at all - only a test page has none
 * (OnCallTestPage), and it ends before its record is looked for - is as
 * permanent, and ends the same way.
 *
 * A record deleted between the worker's read of where it stands and a rule's
 * send is found gone by the send itself (UserNotificationRuleService
 * .deliverNotificationForRule), which throws OnCallPageRecordGoneException:
 * the log ends the same way, Completed with these words, rather than in
 * Error with the send's (issue #8168).
 */

// What a send says when the record it pages about is gone.
export const ON_CALL_PAGE_RECORD_NOT_FOUND_MESSAGE: string =
  "Incident, Alert, Alert Episode, or Incident Episode not found.";

/*
 * The record a page's send was about is gone - deleted after the page read
 * where it stands. Still a BadDataException, as the send always threw - a
 * retry finds it gone again - with the kind of record ("incident", "alert",
 * "incident episode", "alert episode"), so the person's log can end saying
 * which was deleted (getOnCallPageRecordDeletedMessage).
 */
export class OnCallPageRecordGoneException extends BadDataException {
  public readonly recordKind: string;

  public constructor(recordKind: string) {
    super(ON_CALL_PAGE_RECORD_NOT_FOUND_MESSAGE);
    this.recordKind = recordKind;
  }
}

// How a log's message starts when its record was deleted.
export const ON_CALL_PAGE_RECORD_DELETED_MESSAGE_START: string =
  "Execution completed because ";

// "Execution completed because this page names no incident, alert or episode."
export const ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE: string =
  "Execution completed because this page names no incident, alert or episode.";

/*
 * "Execution completed because incident is deleted." - for the kind of
 * record the log paged about ("incident", "alert", "incident episode",
 * "alert episode"), or the message for a log that names none.
 */
export function getOnCallPageRecordDeletedMessage(
  recordKind: string | null | undefined,
): string {
  const kind: string = (recordKind || "").trim();

  if (!kind) {
    return ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE;
  }

  return `${ON_CALL_PAGE_RECORD_DELETED_MESSAGE_START}${kind} is deleted.`;
}
