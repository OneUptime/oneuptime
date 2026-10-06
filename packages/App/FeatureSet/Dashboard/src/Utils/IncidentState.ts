import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";

export default class IncidentStateUtil {
  /*
   * The project's incident states, top first, with their place and the
   * resolved flag - what tells which of them count as resolved
   * (Common/Utils/ResolvedState).
   *
   * Served through ModelListCache: Header, Home and OverviewStats all ask
   * for this list on the same mount, and states change ~never - one request
   * (per project, per minute) covers them all.
   */
  public static async getIncidentStates(
    projectId: ObjectID,
  ): Promise<Array<IncidentState>> {
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
          order: true,
        },
        projectId: projectId,
      });

    return incidentStates.data;
  }

  /*
   * The states an incident (or incident episode) is still open in: every
   * state above the project's resolved state. The resolved state and any
   * state placed after it - flagged or not - count as resolved.
   */
  public static async getUnresolvedIncidentStates(
    projectId: ObjectID,
  ): Promise<IncidentState[]> {
    return ResolvedStateUtil.getUnresolvedStates({
      list: StateListType.IncidentState,
      states: await this.getIncidentStates(projectId),
    });
  }
}
