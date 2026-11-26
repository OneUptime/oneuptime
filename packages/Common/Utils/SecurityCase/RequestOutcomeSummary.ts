import SecurityEventRequestOutcome from "../../Types/SecurityEvent/SecurityEventRequestOutcome";

/*
 * How far a detection's requests got, from the outcome of each one its
 * events' traces followed (SecurityEventRequestOutcome): every one turned
 * away, some past the app's checks, or none followed at all. What the
 * case's Why Opened card says of a detection, and what its Response Plan
 * asks next - read the same on the server and in the browser.
 */

export enum RequestOutcomeSummaryKind {
  // Every followed request was turned away.
  AllTurnedAway = "AllTurnedAway",
  // At least one got past the app's checks: it reached a handler, errored or reached the database.
  SomeGotThrough = "SomeGotThrough",
  // No request was followed into its trace.
  NotFollowed = "NotFollowed",
}

export interface RequestOutcomeSummary {
  kind: RequestOutcomeSummaryKind;
  // Requests followed into their trace.
  followed: number;
  // Of those, the ones past the app's checks.
  through: number;
  // Each outcome and how many, the most serious first, none for an unfollowed request.
  tally: Array<{ outcome: SecurityEventRequestOutcome; count: number }>;
}

const OUTCOMES_MOST_SERIOUS_FIRST: ReadonlyArray<SecurityEventRequestOutcome> =
  [
    SecurityEventRequestOutcome.ReachedDatabase,
    SecurityEventRequestOutcome.Errored,
    SecurityEventRequestOutcome.ReachedApp,
    SecurityEventRequestOutcome.Rejected,
  ];

export function getRequestOutcomeSummary(
  outcomes: Record<string, number>,
): RequestOutcomeSummary {
  const tally: Array<{ outcome: SecurityEventRequestOutcome; count: number }> =
    [];
  let followed: number = 0;
  let through: number = 0;

  for (const outcome of OUTCOMES_MOST_SERIOUS_FIRST) {
    const count: number = Math.max(0, Math.trunc(outcomes[outcome] || 0));

    if (count === 0) {
      continue;
    }

    tally.push({ outcome, count });
    followed += count;

    if (outcome !== SecurityEventRequestOutcome.Rejected) {
      through += count;
    }
  }

  return {
    kind:
      followed === 0
        ? RequestOutcomeSummaryKind.NotFollowed
        : through > 0
          ? RequestOutcomeSummaryKind.SomeGotThrough
          : RequestOutcomeSummaryKind.AllTurnedAway,
    followed,
    through,
    tally,
  };
}
