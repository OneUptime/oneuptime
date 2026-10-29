import OnCallDutyExecutionLogTimelineStatus from "./OnCalDutyExecutionLogTimelineStatus";

/*
 * A LEVEL WITH NOBODY TO PAGE DOES NOT HOLD THE PAGE UP.
 *
 * An escalation rule - a level of an on-call policy - waits its "Escalate
 * after" for the people it paged to acknowledge, then the next level is
 * paged. A level that pages nobody has nobody to wait for: waiting out its
 * wait would only keep the next level from hearing of the incident or alert.
 * So a run moves on from such a level at once - to the next level, to the
 * policy's first level again when it repeats, or to its end - in the one
 * way a run moves on (OnCallEscalationAdvance).
 *
 * A level pages nobody when, at the moment it is reached:
 *
 *   - it names nobody: no person, team or on-call schedule;
 *   - its teams have no members;
 *   - nobody is on call in its schedules - a gap between layers, an override
 *     that leaves nobody - or nobody is next in a rotation whose next person
 *     it pages;
 *   - everybody it names is away with nobody named to cover, has left the
 *     project, or has escalated this run's page already;
 *   - nobody it named can be reached at all: each one's page was skipped or
 *     failed as it went out - they opted out of this severity, or have no
 *     notification rule for it and no verified method to fall back on.
 *
 * The last is a choice, and this is why: a level's wait is the time its
 * people get to acknowledge, and somebody whose page never went out can
 * neither see it nor acknowledge it. Whether a page went out is known when
 * it is sent - each person's notification log is written then, and says
 * "skipped" or "error" at once for a page that cannot go anywhere - so the
 * level is counted as empty only on what is certain. A page that is on its
 * way, or that a person's own rules send a few minutes later, counts as
 * reaching them, and the level waits as it always has.
 *
 * A level that pages nobody writes one line of its own on the run's timeline
 * (after a line for each person, team or schedule it found nobody in), in
 * the words below: the Execution Timeline, the record's feed and the run's
 * Slack and Microsoft Teams message read it back to say that the policy
 * moved on at once, and why.
 *
 * React-free and server-safe: the server, the dashboard and their tests read
 * it.
 */

// The level's line, when the level names nobody at all.
export const ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE: string =
  "This level has no responders, so the policy moved on at once.";

/*
 * The level's line, when it names somebody but paged nobody: each person,
 * team or schedule has a line of its own before it, saying why.
 */
export const ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE: string =
  "Nobody at this level could be paged, so the policy moved on at once.";

/*
 * The line runs wrote before a level with nobody to page was passed at once:
 * those runs waited out the level's wait. Kept so their lines read as what
 * they were.
 */
export const LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE: string =
  "Skipped because no users in this rule.";

// Which of the lines above a timeline line is.
export enum OnCallEmptyLevelLine {
  // The level names nobody; the run moved on at once.
  NoResponders = "NoResponders",
  // The level named somebody and paged nobody; the run moved on at once.
  PagedNobody = "PagedNobody",
  // Written before levels were passed at once: the run waited out the level.
  Legacy = "Legacy",
}

/*
 * Which level line a timeline line's status message is, or null for any
 * other line. Compared as written, spaces trimmed.
 */
export function readOnCallEmptyLevelLine(
  statusMessage: string | undefined | null,
): OnCallEmptyLevelLine | null {
  const message: string = (statusMessage || "").trim();

  if (message === ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE) {
    return OnCallEmptyLevelLine.NoResponders;
  }

  if (message === ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE) {
    return OnCallEmptyLevelLine.PagedNobody;
  }

  if (message === LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE) {
    return OnCallEmptyLevelLine.Legacy;
  }

  return null;
}

/*
 * Whether a timeline line says its level paged nobody and the run moved on
 * from it at once: not a legacy line, whose run waited.
 */
export function isOnCallEmptyLevelMovedOnAtOnce(
  statusMessage: string | undefined | null,
): boolean {
  const line: OnCallEmptyLevelLine | null =
    readOnCallEmptyLevelLine(statusMessage);

  return (
    line === OnCallEmptyLevelLine.NoResponders ||
    line === OnCallEmptyLevelLine.PagedNobody
  );
}

// The line a level that paged nobody writes: whether it names anybody at all.
export function getOnCallEmptyLevelTimelineMessage(data: {
  namesAnybody: boolean;
}): string {
  return data.namesAnybody
    ? ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE
    : ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE;
}

/*
 * Whether a person's line on a run's timeline says their page went out - is
 * being sent, was sent, was acknowledged or was escalated - rather than
 * skipped or failed. A line whose status is not known counts as reaching
 * them: a level is only counted as empty on what is certain.
 */
export function isOnCallPageLineReached(
  status: OnCallDutyExecutionLogTimelineStatus | string | undefined | null,
): boolean {
  return (
    status !== OnCallDutyExecutionLogTimelineStatus.Skipped &&
    status !== OnCallDutyExecutionLogTimelineStatus.Error
  );
}
