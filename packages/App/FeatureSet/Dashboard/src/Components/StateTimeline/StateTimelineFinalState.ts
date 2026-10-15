import { JSONObject } from "Common/Types/JSON";

/*
 * Which states a record is done with, for its status timeline: an
 * incident's or an alert's resolved state (an episode's too), a scheduled
 * maintenance event's ended and completed ones. A record in any other state
 * is still open, and its band runs on to now, however long ago it last
 * changed (ModelStatusTimeline's isFinalState): how long it has been in its
 * state is what its reader is watching. Each select is the flags its
 * predicate reads.
 */

export const RESOLVED_STATE_SELECT: JSONObject = { isResolvedState: true };

export const isResolvedState: (state: JSONObject) => boolean = (
  state: JSONObject,
): boolean => {
  return state["isResolvedState"] === true;
};

export const MAINTENANCE_FINAL_STATE_SELECT: JSONObject = {
  isEndedState: true,
  isResolvedState: true,
};

export const isMaintenanceFinalState: (state: JSONObject) => boolean = (
  state: JSONObject,
): boolean => {
  return state["isEndedState"] === true || state["isResolvedState"] === true;
};
