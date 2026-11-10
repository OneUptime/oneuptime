import BadDataException from "../../../Types/Exception/BadDataException";
import {
  MAX_RECORDS_TO_OPEN_EPISODE,
  MIN_RECORDS_TO_OPEN_EPISODE,
  isValidRecordsToOpenEpisode,
} from "../../../Utils/Episode/EpisodeOpeningThreshold";

/*
 * What an incident or alert grouping rule may be saved with as the number of
 * matching records it waits for before it opens an episode
 * (IncidentGroupingRule.minimumIncidentCount,
 * AlertGroupingRule.minimumAlertCount): a whole number the engines act on
 * as written (Common/Utils/Episode/EpisodeOpeningThreshold). A write that
 * leaves it out is not checked - it keeps what the rule has, or the column's
 * default.
 */
export default class GroupingRuleCountCheck {
  public static check(data: { count: unknown; columnTitle: string }): void {
    if (data.count === undefined) {
      return;
    }

    if (!isValidRecordsToOpenEpisode(data.count)) {
      throw new BadDataException(
        `${data.columnTitle} must be a whole number from ${MIN_RECORDS_TO_OPEN_EPISODE} to ${MAX_RECORDS_TO_OPEN_EPISODE}.`,
      );
    }
  }
}
