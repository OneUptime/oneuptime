import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStartUtil from "Common/Utils/ScheduledMaintenanceStart";

export default class ScheduledMaintenanceStateUtil {
  public static async getActiveScheduledMaintenanceStates(
    projectId: ObjectID,
  ): Promise<ScheduledMaintenanceState[]> {
    const scheduledMaintenanceStates: ListResult<ScheduledMaintenanceState> =
      await ModelAPI.getList<ScheduledMaintenanceState>({
        modelType: ScheduledMaintenanceState,
        query: {
          projectId: projectId,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          order: SortOrder.Ascending,
        },
        select: {
          _id: true,
          isEndedState: true,
          isResolvedState: true,
        },
      });

    const activeScheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
      [];

    for (const state of scheduledMaintenanceStates.data) {
      if (!state.isEndedState && !state.isResolvedState) {
        activeScheduledMaintenanceStates.push(state);
      } else {
        break;
      }
    }

    return activeScheduledMaintenanceStates;
  }

  /*
   * The project's scheduled maintenance states, top first, with their place
   * and every built-in flag - what tells where an event is in its life
   * (Common/Utils/ScheduledMaintenanceStart).
   *
   * Served through ModelListCache: the Home and Scheduled Maintenance side
   * menus, the Home stats and the Ongoing lists ask for this list on the
   * same mount, and states change ~never - one request (per project, per
   * minute) covers them all.
   */
  public static async getScheduledMaintenanceStates(
    projectId: ObjectID,
  ): Promise<Array<ScheduledMaintenanceState>> {
    const scheduledMaintenanceStates: ListResult<ScheduledMaintenanceState> =
      await ModelListCache.getList<ScheduledMaintenanceState>({
        modelType: ScheduledMaintenanceState,
        query: {
          projectId: projectId,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        sort: {
          order: SortOrder.Ascending,
        },
        select: {
          _id: true,
          name: true,
          order: true,
          isScheduledState: true,
          isOngoingState: true,
          isEndedState: true,
          isResolvedState: true,
        },
        projectId: projectId,
      });

    return scheduledMaintenanceStates.data;
  }

  /*
   * The states an event is in progress in: the project's ongoing state, and
   * every state of its own placed between Ongoing and Ended, such as
   * "Verifying". The Ongoing lists, their menu badges and the Home stats
   * match an event's current state against these, as the server and the
   * status pages do.
   */
  public static async getInProgressScheduledMaintenanceStates(
    projectId: ObjectID,
  ): Promise<Array<ScheduledMaintenanceState>> {
    return ScheduledMaintenanceStartUtil.getInProgressStates({
      states: await this.getScheduledMaintenanceStates(projectId),
    });
  }
}
