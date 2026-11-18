import OneUptimeDate from "../../Types/Date";
import SloStatus, {
  isSloUnmeasuredStatus,
} from "../../Types/ServiceLevelObjective/SloStatus";
import SloStatusChange, {
  getSloStatusChange,
} from "../../Types/ServiceLevelObjective/SloStatusChange";

/*
 * AN SLO'S STATUS IN SLACK, MICROSOFT TEAMS AND MATTERMOST: WHEN TO SAY IT
 * (#6596).
 *
 * The status already holds back a rolling window that hovers at a line: it
 * leaves At Risk only once the budget is 5 points above the at-risk
 * threshold, and Budget Exhausted only once 2% of the budget is back
 * (SloUtil.computeSloStatus). An unsteady service can still cross those
 * lines several times a day, and a channel that heard each crossing would
 * learn to ignore the SLO. So the channels are told of an SLO's status at
 * most once an interval (SLO_STATUS_POST_MIN_INTERVAL_MINUTES), and what
 * they are told is always where the SLO is now:
 *
 *   - a change is said against what the channels last heard, not against
 *     the status the evaluation started from: an SLO that went Healthy and
 *     came back to At Risk within the interval, after the channels heard
 *     "At Risk", says nothing at all;
 *   - a change that comes within the interval of the last one waits, and is
 *     said by the first evaluation after the interval if the SLO is still
 *     there - so the channels' last word is never one the SLO left;
 *   - an exhausted budget is said at once, whatever the interval: it is the
 *     one change a channel must not hear late, and it cannot repeat until
 *     the SLO has left Budget Exhausted and that was said.
 *
 * What the channels last heard is remembered by the server
 * (SloWorkspaceNotifications); with nothing remembered - the first change,
 * or a cache that lost it - the status the evaluation started from stands
 * in for it, and nothing waits.
 */

export const SLO_STATUS_POST_MIN_INTERVAL_MINUTES: number = 60;

// What the channels were last told of an SLO's status, and when.
export interface SloStatusPost {
  status: SloStatus;
  postedAt: Date;
}

// A change to say now, and the status it is said against.
export interface SloStatusPostDecision {
  change: SloStatusChange;
  from: SloStatus | null;
}

export function decideSloStatusPost(data: {
  // What the channels last heard, when it is remembered.
  lastPost: SloStatusPost | null;
  // The SLO's status before this evaluation; unset for one never evaluated.
  previousStatus: SloStatus | null | undefined;
  // Its status after this evaluation.
  newStatus: SloStatus;
  now: Date;
  minIntervalMinutes?: number | undefined;
}): SloStatusPostDecision | null {
  // A status that measures nothing says nothing about reliability.
  if (isSloUnmeasuredStatus(data.newStatus)) {
    return null;
  }

  const heard: SloStatus | null = data.lastPost
    ? data.lastPost.status
    : data.previousStatus || null;

  const change: SloStatusChange | null = getSloStatusChange(
    heard,
    data.newStatus,
  );

  if (!change) {
    return null;
  }

  const minIntervalMinutes: number =
    data.minIntervalMinutes ?? SLO_STATUS_POST_MIN_INTERVAL_MINUTES;

  if (
    data.lastPost &&
    change !== SloStatusChange.BudgetExhausted &&
    OneUptimeDate.getDifferenceInMinutes(data.now, data.lastPost.postedAt) <
      minIntervalMinutes
  ) {
    return null;
  }

  return { change: change, from: heard };
}
