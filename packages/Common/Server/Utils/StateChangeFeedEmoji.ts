/*
 * The mark a state change's feed line starts with - in the record's feed and
 * wherever it is posted (Slack, Microsoft Teams) - for incidents, alerts and
 * both kinds of episode alike. It says how far along the move took the
 * record, by the two rules every part of OneUptime reads:
 *
 *   - resolved (Common/Utils/ResolvedState): the project's resolved state,
 *     or a state placed after it;
 *   - acknowledged (Common/Utils/AcknowledgedState): the project's
 *     acknowledged state, or a state placed after it - "Investigating" is
 *     marked as an acknowledgement, as on-call reads it;
 *   - otherwise the created state, or a step on the way.
 */
export const RESOLVED_FEED_EMOJI: string = "✅";
export const ACKNOWLEDGED_FEED_EMOJI: string = "👀";
export const CREATED_FEED_EMOJI: string = "🔴";
export const OTHER_STATE_FEED_EMOJI: string = "➡️";

export default class StateChangeFeedEmoji {
  public static get(data: {
    // The new state counts as resolved.
    isResolved: boolean;
    // The new state counts as acknowledged (resolved ones count too).
    isAcknowledged: boolean;
    // The new state is the project's created state.
    isCreatedState: boolean;
  }): string {
    if (data.isResolved) {
      return RESOLVED_FEED_EMOJI;
    }

    if (data.isAcknowledged) {
      return ACKNOWLEDGED_FEED_EMOJI;
    }

    if (data.isCreatedState) {
      return CREATED_FEED_EMOJI;
    }

    return OTHER_STATE_FEED_EMOJI;
  }
}
