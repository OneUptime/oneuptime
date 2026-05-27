import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";

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
}
