/*
 * DELETING ONE ROW OF AN INCIDENT'S, ALERT'S, SCHEDULED MAINTENANCE EVENT'S
 * OR EPISODE'S STATE TIMELINE, BY ITS ID.
 *
 * Someone correcting a record's history: "it was never Acknowledged at 3pm".
 * The row goes, and the state before it runs on over its time, so the
 * record's state at every moment stays known - the rule a monitor's status
 * events follow too (Utils/Monitor/MonitorStatusEventDelete):
 *
 *   - the newest state: the one before it becomes the record's current
 *     state again;
 *   - a state in the middle: the one before it runs on up to the start of
 *     the one after it. The one after it keeps its start: it is when that
 *     state really began. (This used to also move the next state back to
 *     the deleted one's start, so the two covered the deleted span twice.)
 *   - the oldest state: it goes, and nothing moves - the history then
 *     begins with the state after it.
 *
 * The record's only state is never deleted: the record would have no state
 * at all. The service refuses it (each timeline service's onBeforeDelete),
 * and each Status Timeline page locks that row's Delete, saying why, in the
 * same words - so the API, a workflow step's error, the page's tooltip and a
 * bulk Delete's list of what it did not delete all read alike.
 *
 * A delete that names its rows by a query is a clean-up, not a correction:
 * it moves no row, and DatabaseService has already narrowed it to the rows
 * that are over (Types/StateTimeline/RowsKeptOnDelete).
 */

// The records whose state history is a table of rows like this.
export enum StateTimelineRecord {
  Incident = "Incident",
  Alert = "Alert",
  ScheduledMaintenance = "ScheduledMaintenance",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
}

/*
 * Why the record's only state is not deleted, and what to do instead. The
 * Dashboard's Status Timeline pages hold the same English as translation keys
 * (STATE_TIMELINE_DELETE_WORDS in Components/StateTimeline), and a test keeps
 * the two equal.
 */
export const ONLY_STATE_DELETE_MESSAGES: Readonly<
  Record<StateTimelineRecord, string>
> = {
  [StateTimelineRecord.Incident]:
    "The incident's only state can't be deleted: an incident always has a state. To change it, add a new state.",
  [StateTimelineRecord.Alert]:
    "The alert's only state can't be deleted: an alert always has a state. To change it, add a new state.",
  [StateTimelineRecord.ScheduledMaintenance]:
    "The event's only state can't be deleted: a scheduled maintenance event always has a state. To change it, add a new state.",
  [StateTimelineRecord.IncidentEpisode]:
    "The episode's only state can't be deleted: an episode always has a state. To change it, add a new state.",
  [StateTimelineRecord.AlertEpisode]:
    "The episode's only state can't be deleted: an episode always has a state. To change it, add a new state.",
};

// What deleting one row does to the rest of the record's timeline.
export enum StateRowDeleteEffect {
  // Refused: the record's only state.
  OnlyState = "OnlyState",
  // The state before it becomes the record's current state again.
  PreviousIsCurrentAgain = "PreviousIsCurrentAgain",
  // The state before it runs on up to the start of the one after it.
  PreviousTakesOver = "PreviousTakesOver",
  // The oldest state: nothing else moves.
  NothingMoves = "NothingMoves",
}

export interface StateRowNeighbours {
  // Whether a state starts before it (at or before its start, not itself).
  hasStateBefore: boolean;
  // Whether a state starts after it.
  hasStateAfter: boolean;
}

/*
 * The effect, from the row's two neighbours, as the services read them:
 * the latest other row that starts at or before it, and the first that
 * starts after it.
 */
export const decideStateRowDelete: (
  neighbours: StateRowNeighbours,
) => StateRowDeleteEffect = (
  neighbours: StateRowNeighbours,
): StateRowDeleteEffect => {
  if (!neighbours.hasStateBefore && !neighbours.hasStateAfter) {
    return StateRowDeleteEffect.OnlyState;
  }

  if (!neighbours.hasStateBefore) {
    return StateRowDeleteEffect.NothingMoves;
  }

  if (!neighbours.hasStateAfter) {
    return StateRowDeleteEffect.PreviousIsCurrentAgain;
  }

  return StateRowDeleteEffect.PreviousTakesOver;
};
