import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStartUtil, {
  ScheduledMaintenancePhaseOfState,
} from "Common/Utils/ScheduledMaintenanceStart";

export default class ScheduledMaintenanceStateUtil {
  /*
   * The states an event is still active in: waiting to start or in
   * progress - every state but those where it is over, which are Ended,
   * Completed and the states of the project's own placed after Ended, such
   * as "Reviewing" (Common/Utils/ScheduledMaintenanceStart.getPhase). What a
   * resource's side menu badge and its Activity cards count as its active
   * maintenance. Read through the same cached list as the Ongoing lists.
   */
  public static async getActiveScheduledMaintenanceStates(
    projectId: ObjectID,
  ): Promise<ScheduledMaintenanceState[]> {
    const states: Array<ScheduledMaintenanceState> =
      await this.getScheduledMaintenanceStates(projectId);

    return states.filter((state: ScheduledMaintenanceState): boolean => {
      return (
        ScheduledMaintenanceStartUtil.getPhase({
          states: states,
          state: state,
        }) !== ScheduledMaintenancePhaseOfState.Over
      );
    });
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
