import {
  readStatusChangeNote,
  StatusChangeNote,
  WHO_OPENED_IT_NOTES,
} from "../Monitor/StatusChangeNotes";

/*
 * A ROOT CAUSE THAT ONLY SAYS WHO OPENED THE RECORD.
 *
 * OneUptime used to fill an incident's or an alert's empty root cause with
 * who opened it, when a person did:
 *
 *   Incident created by [Maya Chen](<her page>)     IncidentService
 *   Alert created by [Maya Chen](<her page>)        AlertService
 *   Incident created by @maya on Slack.             Slack's Declare Incident
 *   Incident created via Microsoft Teams            Teams' Declare Incident
 *   Incident created via the OneUptime AI copilot.  the copilot's tool
 *
 * That says who, not why - and the record names who opened it already (its
 * creator, the Declared / Created tile, the feed's first entry). Written as
 * the root cause, it stood where the cause belongs: the What happened card,
 * the feed's "Root Cause", the first state's timeline row, and the status
 * timeline of every monitor the incident changed. New records are left with
 * no root cause until somebody writes one; the ones written before read as
 * none here (the Dashboard's What happened card), while the Root Cause page
 * and View Cause say them in the reader's words.
 *
 * The lines are notes of the registry the Dashboard words OneUptime's own
 * sentences by (StatusChangeNotes' WHO_OPENED_IT_NOTES, #10125): defined
 * there once, the person a link and the Slack member a handle, so a line a
 * person typed that starts the same way ("Incident created by a bad
 * deploy") is a root cause. Read in time in line with the text, and never
 * past a thousand characters.
 */

// A longer root cause is never one of these lines.
const MAX_LINE_LENGTH: number = 1000;

/*
 * Whether a root cause is one of the lines OneUptime wrote to say who
 * opened the record, and nothing else.
 */
export function isWhoOpenedItRootCause(
  rootCause: string | null | undefined,
): boolean {
  const text: string = (rootCause || "").trim();

  if (!text || text.length > MAX_LINE_LENGTH) {
    return false;
  }

  const read: { note: StatusChangeNote } | null = readStatusChangeNote(text);

  return Boolean(read && WHO_OPENED_IT_NOTES.includes(read.note));
}

export default isWhoOpenedItRootCause;
