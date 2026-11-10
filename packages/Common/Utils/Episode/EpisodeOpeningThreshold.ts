/*
 * HOW MANY MATCHING RECORDS A GROUPING RULE WAITS FOR BEFORE IT OPENS AN
 * EPISODE (issue #5374).
 *
 * A grouping rule opens an episode for the first incident (or alert) that
 * matches it and has no open episode to join. With "Wait for more incidents"
 * on - IncidentGroupingRule.enableMinimumIncidentCount and
 * minimumIncidentCount, AlertGroupingRule.enableMinimumAlertCount and
 * minimumAlertCount - it opens one only once that many matching records of
 * the same group are ongoing: a lone incident stays on its own, and an
 * outage that trips several monitors gets one episode holding all of them.
 *
 * Read the same way by the engines (IncidentGroupingEngineService,
 * AlertGroupingEngineService), the rule services that check what is saved,
 * and the Dashboard's grouping rule form - so the form, the API and the
 * engines agree on what counts.
 */

// The fewest a rule can wait for: 1 is no wait - the first record opens it.
export const MIN_RECORDS_TO_OPEN_EPISODE: number = 1;

/*
 * The most a rule can wait for. Far more than an outage needs before it is
 * one, and it bounds what an engine reads when it opens the episode: every
 * record that waited, at most this many.
 */
export const MAX_RECORDS_TO_OPEN_EPISODE: number = 100;

// The count a rule starts with when the setting is turned on.
export const DEFAULT_RECORDS_TO_OPEN_EPISODE: number = 3;

/*
 * The fewest the form lets a person pick while the setting is on: waiting
 * for one is not waiting. The API takes 1 as well, which waits for nothing.
 */
export const MIN_RECORDS_TO_WAIT_FOR: number = 2;

/*
 * Whether `value` is a count a rule may be saved with: a whole number from
 * MIN_RECORDS_TO_OPEN_EPISODE to MAX_RECORDS_TO_OPEN_EPISODE.
 */
export const isValidRecordsToOpenEpisode: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RECORDS_TO_OPEN_EPISODE &&
    value <= MAX_RECORDS_TO_OPEN_EPISODE
  );
};

/*
 * How many records the rule waits for, as the engines read it: 1 - no wait -
 * unless the setting is on with a usable count. A count above the most is
 * read as the most, and anything else that is not a whole number above 1 as
 * no wait, so a rule saved before the check existed, or written past it,
 * still groups.
 */
export const getRecordsToOpenEpisode: (data: {
  enabled: unknown;
  count: unknown;
}) => number = (data: { enabled: unknown; count: unknown }): number => {
  if (data.enabled !== true) {
    return MIN_RECORDS_TO_OPEN_EPISODE;
  }

  const count: unknown = data.count;

  if (typeof count !== "number" || !Number.isInteger(count) || count <= 1) {
    return MIN_RECORDS_TO_OPEN_EPISODE;
  }

  return Math.min(count, MAX_RECORDS_TO_OPEN_EPISODE);
};
