import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";

export default class IncidentStateUtil {
  public static async getUnresolvedIncidentStates(
    projectId: ObjectID,
  ): Promise<IncidentState[]> {
    /*
     * Served through ModelListCache: Header, Home and OverviewStats all ask
     * for this list on the same mount, and states change ~never - one request
     * (per project, per minute) covers them all.
     */
    const incidentStates: ListResult<IncidentState> =
      await ModelListCache.getList<IncidentState>({
        modelType: IncidentState,
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

    const unresolvedIncidentStates: Array<IncidentState> = [];

    for (const state of incidentStates.data) {
      if (!state.isResolvedState) {
        unresolvedIncidentStates.push(state);
      } else {
        break; // everything after resolved state is resolved
      }
    }

    return unresolvedIncidentStates;
  }
}
