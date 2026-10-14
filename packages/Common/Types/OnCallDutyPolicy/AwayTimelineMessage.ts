/*
 * THE ESCALATION TIMELINE'S LINE FOR SOMEBODY WHO IS AWAY.
 *
 * An escalation rule that names a person - directly, or as a member of a
 * team - does not page them while a user override says they are away with
 * nobody named to cover (a skip): there is no rotation there to take the
 * next person from. The timeline records a Skipped line for them instead,
 * saying until when, and the on-call run's Slack and Microsoft Teams message
 * reads the line back to say "away until <time>" in each reader's own time
 * (OnCallPolicyRunMessage).
 *
 * The time is written in UTC, to the minute, in one fixed shape, so the line
 * reads plainly on the run's own page and can be read back exactly:
 *
 *   Skipped because this user is away until 2026-10-17 09:00 UTC, and nobody is named to cover for them.
 */

export const AWAY_TIMELINE_MESSAGE_PREFIX: string =
  "Skipped because this user is away until ";

const AWAY_TIMELINE_MESSAGE_SUFFIX: string =
  ", and nobody is named to cover for them.";

// "2026-10-17 09:00 UTC" right after the prefix.
const AWAY_UNTIL_PATTERN: RegExp =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC(?:,|\.|$)/;

const pad: (value: number) => string = (value: number): string => {
  return String(value).padStart(2, "0");
};

// "2026-10-17 09:00 UTC": the moment, in UTC, to the minute.
export const formatAwayUntil: (until: Date) => string = (
  until: Date,
): string => {
  return `${until.getUTCFullYear()}-${pad(until.getUTCMonth() + 1)}-${pad(
    until.getUTCDate(),
  )} ${pad(until.getUTCHours())}:${pad(until.getUTCMinutes())} UTC`;
};

// The timeline's line for somebody away until `until`, with nobody to cover.
export const getAwayTimelineMessage: (until: Date) => string = (
  until: Date,
): string => {
  return `${AWAY_TIMELINE_MESSAGE_PREFIX}${formatAwayUntil(until)}${AWAY_TIMELINE_MESSAGE_SUFFIX}`;
};

/*
 * Until when a timeline line says its person is away, or null when it is not
 * such a line (or its time cannot be read).
 */
export const readAwayUntil: (
  statusMessage: string | null | undefined,
) => Date | null = (statusMessage: string | null | undefined): Date | null => {
  if (
    !statusMessage ||
    statusMessage.indexOf(AWAY_TIMELINE_MESSAGE_PREFIX) !== 0
  ) {
    return null;
  }

  const match: RegExpExecArray | null = AWAY_UNTIL_PATTERN.exec(
    statusMessage.slice(AWAY_TIMELINE_MESSAGE_PREFIX.length),
  );

  if (!match) {
    return null;
  }

  const until: Date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ),
  );

  return isNaN(until.getTime()) ? null : until;
};
