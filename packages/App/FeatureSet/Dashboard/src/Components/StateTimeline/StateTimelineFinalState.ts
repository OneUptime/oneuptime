import AlertStateUtil from "../../Utils/AlertState";
import IncidentStateUtil from "../../Utils/IncidentState";
import ScheduledMaintenanceStateUtil from "../../Utils/ScheduledMaintenanceState";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { StatusTimelineFinalStateRule } from "Common/UI/Components/StatusTimeline/ModelStatusTimeline";
import ProjectUtil from "Common/UI/Utils/Project";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import ScheduledMaintenanceStartUtil from "Common/Utils/ScheduledMaintenanceStart";
import { StateListType } from "Common/Utils/StateOrder";

/*
 * Which states a record is done with, for its status timeline - the states
 * its band stops running on to now in (ModelStatusTimeline's
 * getFinalStateRule). A record in any other state is still open, and its
 * band runs on to now however long ago it last changed: how long it has
 * been in its state is what its reader is watching.
 *
 * Each record answers by its project's own list of states, through the one
 * rule every other part of OneUptime asks, never by a flag on its own:
 *
 *   - an incident or an incident episode once resolved, and an alert or an
 *     alert episode once resolved - in the Resolved state, or in a state the
 *     project placed after it, such as "Closed" (Common/Utils/ResolvedState);
 *   - a scheduled maintenance event once over - Ended, Completed, or a state
 *     of the project's own placed after Ended, such as "Reviewing"
 *     (Common/Utils/ScheduledMaintenanceStart.hasEnded).
 *
 * The project's states come from the cached lists the rest of the Dashboard
 * reads (ModelListCache: one request per project a minute). stateSelect is
 * what each rule reads of a row's own state: its place and its flags.
 */
export interface StateTimelineFinalState {
  stateSelect: JSONObject;
  getFinalStateRule: () => Promise<StatusTimelineFinalStateRule>;
}

const getProjectId: () => ObjectID = (): ObjectID => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    // No project to read the states of: the band is fitted to the changes.
    throw new BadDataException("No project is selected.");
  }

  return projectId;
};

const RESOLVED_STATE_SELECT: JSONObject = {
  order: true,
  isResolvedState: true,
};

export const INCIDENT_FINAL_STATE: StateTimelineFinalState = {
  stateSelect: RESOLVED_STATE_SELECT,
  getFinalStateRule: async (): Promise<StatusTimelineFinalStateRule> => {
    const states: Array<unknown> =
      await IncidentStateUtil.getIncidentStates(getProjectId());

    return (state: JSONObject): boolean => {
      return ResolvedStateUtil.isStateResolved({
        list: StateListType.IncidentState,
        states: states,
        state: state,
      });
    };
  },
};

export const ALERT_FINAL_STATE: StateTimelineFinalState = {
  stateSelect: RESOLVED_STATE_SELECT,
  getFinalStateRule: async (): Promise<StatusTimelineFinalStateRule> => {
    const states: Array<unknown> =
      await AlertStateUtil.getAlertStates(getProjectId());

    return (state: JSONObject): boolean => {
      return ResolvedStateUtil.isStateResolved({
        list: StateListType.AlertState,
        states: states,
        state: state,
      });
    };
  },
};

export const SCHEDULED_MAINTENANCE_FINAL_STATE: StateTimelineFinalState = {
  stateSelect: {
    order: true,
    isScheduledState: true,
    isOngoingState: true,
    isEndedState: true,
    isResolvedState: true,
  },
  getFinalStateRule: async (): Promise<StatusTimelineFinalStateRule> => {
    const states: Array<unknown> =
      await ScheduledMaintenanceStateUtil.getScheduledMaintenanceStates(
        getProjectId(),
      );

    return (state: JSONObject): boolean => {
      return ScheduledMaintenanceStartUtil.hasEnded({
        states: states,
        state: state,
      });
    };
  },
};
