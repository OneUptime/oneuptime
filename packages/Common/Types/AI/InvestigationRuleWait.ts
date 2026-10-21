/*
 * An investigation rule's wait (issue #5074): "only if the incident is
 * still open after N minutes".
 *
 * A rule may make OneUptime AI wait before it investigates what the rule
 * matches. The incident (or alert) then waits that many minutes after it was
 * created, and is investigated when the wait ends only if it is still open:
 * one resolved by then is not investigated, and its AI card says why. A
 * rule with no wait - the default, and every rule saved before rules could
 * wait - investigates right away, as before.
 *
 * Rules widen what is investigated (an incident is investigated when it
 * matches at least one), so the rule that lets OneUptime AI start soonest
 * decides when: the shortest wait of the rules an incident matches, and no
 * wait at all when one of them has none.
 *
 * Server-free and React-free: the rule service, the investigation runners,
 * the dashboard's rule form and the docs suites all read it.
 */

// The longest wait a rule may set: a day, as the re-investigation cooldown.
export const MAX_INVESTIGATION_RULE_WAIT_MINUTES: number = 24 * 60;

// The rule's column, as the API, Terraform and the rule form name it.
export const INVESTIGATION_RULE_WAIT_COLUMN: string = "onlyIfOpenAfterMinutes";

// The wait a rule's form starts on when someone chooses to wait.
export const DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES: number = 10;

const MILLISECONDS_PER_MINUTE: number = 60 * 1000;

// What the column is called in a refusal, as its title reads in the API docs.
const WAIT_COLUMN_TITLE: string = "Only If Open After (Minutes)";

/*
 * A stored wait as a whole number of minutes, 0 when there is none: unset,
 * zero, negative and unreadable values all read as no wait, and a wait
 * longer than MAX_INVESTIGATION_RULE_WAIT_MINUTES as the longest. The
 * server refuses to save the last ones (getInvestigationRuleWaitProblem), so
 * only a row written around it can hold one.
 */
export function getInvestigationRuleWaitMinutes(value: unknown): number {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(MAX_INVESTIGATION_RULE_WAIT_MINUTES, Math.floor(parsed));
}

/*
 * Why a rule's wait cannot be saved as written, or null when it can. Empty
 * (null or undefined) and 0 are no wait.
 */
export function getInvestigationRuleWaitProblem(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  // A number, or the digits of one (a form or an API client may send them).
  const minutes: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) {
    return `${WAIT_COLUMN_TITLE} must be a whole number of minutes. Leave it empty to investigate right away.`;
  }

  if (minutes < 0) {
    return `${WAIT_COLUMN_TITLE} cannot be negative. Leave it empty to investigate right away.`;
  }

  if (minutes > MAX_INVESTIGATION_RULE_WAIT_MINUTES) {
    return `${WAIT_COLUMN_TITLE} can be at most ${MAX_INVESTIGATION_RULE_WAIT_MINUTES} minutes (a day).`;
  }

  return null;
}

/*
 * The wait an incident or alert gets from the waits of the rules it
 * matches: the shortest, since any one of them puts it in scope - and none
 * when one of them investigates right away, or when there is no rule.
 */
export function getShortestInvestigationRuleWait(
  waits: ReadonlyArray<unknown>,
): number {
  let shortest: number | null = null;

  for (const wait of waits) {
    const minutes: number = getInvestigationRuleWaitMinutes(wait);

    if (minutes === 0) {
      return 0;
    }

    if (shortest === null || minutes < shortest) {
      shortest = minutes;
    }
  }

  return shortest || 0;
}

// When a record created at `createdAt` that waits `minutes` is investigated.
export function getInvestigationWaitUntil(
  createdAt: Date,
  minutes: number,
): Date {
  return new Date(
    createdAt.getTime() +
      getInvestigationRuleWaitMinutes(minutes) * MILLISECONDS_PER_MINUTE,
  );
}

/*
 * The wait, in whole minutes, a waiting record's time stands for: the time
 * is always its creation plus the wait, so this reads the wait back.
 */
export function getInvestigationWaitMinutes(
  createdAt: Date,
  waitUntil: Date,
): number {
  return getInvestigationRuleWaitMinutes(
    Math.round(
      (waitUntil.getTime() - createdAt.getTime()) / MILLISECONDS_PER_MINUTE,
    ),
  );
}
