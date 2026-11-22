/*
 * EVENTS A RULE THAT COUNTS PER VALUE CANNOT COUNT (#10415).
 *
 * A rule that groups by a field and needs more than one event per group -
 * Brute force from one IP address (ten failed sign-ins of one address),
 * Password spraying (one address failing as five accounts) - used to count
 * every event with no value for that field as one more of the same "''"
 * group. Once a scrub rule hid addresses, ten mistyped passwords across a
 * whole app fired "Brute force from one IP address", with nothing to block,
 * and two real attackers merged into one finding that named neither.
 *
 * So such a rule leaves those events out: they are no value it can count.
 * A rule that fires on each event keeps firing for events with no value -
 * lumping them together changes nothing about whether each fires, and
 * leaving them out would silence the rule for actors with no principal
 * (Many records deleted at once in OneUptime, grouped by principal user, of
 * deletes the audit log names nobody for). A rule with no group field keeps
 * its one group.
 *
 * The scheduled and real-time reads (SecurityEventService
 * .findDetectionMatches), Run on Past Events (DetectionRuleRetrohunt) and
 * the pages that say what a rule left out all ask this one question.
 */

export interface DetectionRuleCounting {
  groupByField?: string | null | undefined;
  distinctCountField?: string | null | undefined;
  matchCountThreshold?: number | string | null | undefined;
}

export function doesDetectionRuleLeaveOutEventsWithNoValue(
  rule: DetectionRuleCounting,
): boolean {
  if (!(rule.groupByField || "").trim()) {
    return false;
  }

  if ((rule.distinctCountField || "").trim()) {
    return true;
  }

  const threshold: number = Number(rule.matchCountThreshold ?? 1);

  // As the read's own HAVING says it: a count above one.
  return Number.isFinite(threshold) && threshold > 1;
}
