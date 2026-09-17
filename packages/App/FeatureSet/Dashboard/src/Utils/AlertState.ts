import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import AlertState from "Common/Models/DatabaseModels/AlertState";

export default class AlertStateUtil {
  public static async getUnresolvedAlertStates(
    projectId: ObjectID,
  ): Promise<AlertState[]> {
    /*
     * Served through ModelListCache: the Header and OverviewStats both ask
     * for this list on the same mount, and states change ~never - one request
     * (per project, per minute) covers them all.
     */
    const alertStates: ListResult<AlertState> =
      await ModelListCache.getList<AlertState>({
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
        projectId: projectId,
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
