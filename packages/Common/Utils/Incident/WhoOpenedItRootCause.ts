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
 * still shows them as they are stored.
 *
 * Read in one pass over at most one line: every pattern is anchored at both
 * ends, and each repeat stops at the character that ends it.
 */

// "Incident created by [Name](<address>)", the name as mdText escaped it.
const CREATED_BY_PERSON_LINK: RegExp =
  /^(?:Incident|Alert) created by \[(?:\\.|[^\\\]\n])*\]\([^()\s]*\)$/;

// "Incident created by @name on Slack." - a Slack name is at most 80 long.
const CREATED_ON_SLACK: RegExp =
  /^Incident created by @[^\n]{1,200} on Slack\.$/;

// The ones written word for word: by the Teams form and the copilot.
const CREATED_VIA: ReadonlyArray<string> = [
  "Incident created via Microsoft Teams",
  "Incident created via the OneUptime AI copilot.",
];

/*
 * Whether a root cause is one of the lines OneUptime wrote to say who
 * opened the record, and nothing else.
 */
export function isWhoOpenedItRootCause(
  rootCause: string | null | undefined,
): boolean {
  const text: string = (rootCause || "").trim();

  if (!text || text.length > 1000) {
    return false;
  }

  return (
    CREATED_VIA.includes(text) ||
    CREATED_BY_PERSON_LINK.test(text) ||
    CREATED_ON_SLACK.test(text)
  );
}

export default isWhoOpenedItRootCause;
