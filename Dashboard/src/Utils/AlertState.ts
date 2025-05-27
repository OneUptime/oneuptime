import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AlertState from "Common/Models/DatabaseModels/AlertState";

export default class AlertStateUtil {
  public static async getUnresolvedAlertStates(
    projectId: ObjectID,
  ): Promise<AlertState[]> {
    const alertStates: ListResult<AlertState> =
      await ModelAPI.getList<AlertState>({
        modelType: AlertState,
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
          isResolvedState: true,
        },
      });

    const unresolvedAlertStates: Array<AlertState> = [];

    for (const state of alertStates.data) {
      if (!state.isResolvedState) {
        unresolvedAlertStates.push(state);
      } else {
        break; // everything after resolved state is resolved
      }
    }

    return unresolvedAlertStates;
  }
}
