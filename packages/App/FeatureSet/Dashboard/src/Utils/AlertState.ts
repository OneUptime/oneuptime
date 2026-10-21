import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelListCache from "Common/UI/Utils/ModelListCache";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";

export default class AlertStateUtil {
  /*
   * The project's alert states, top first, with their place and the
   * resolved flag - what tells which of them count as resolved
   * (Common/Utils/ResolvedState).
   *
   * Served through ModelListCache: the Header and OverviewStats both ask
   * for this list on the same mount, and states change ~never - one request
   * (per project, per minute) covers them all.
   */
  public static async getAlertStates(
    projectId: ObjectID,
  ): Promise<Array<AlertState>> {
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
          order: true,
        },
        projectId: projectId,
      });

    return alertStates.data;
  }

  /*
   * The states an alert (or alert episode) is still open in: every state
   * above the project's resolved state. The resolved state and any state
   * placed after it - flagged or not - count as resolved.
   */
  public static async getUnresolvedAlertStates(
    projectId: ObjectID,
  ): Promise<AlertState[]> {
    return ResolvedStateUtil.getUnresolvedStates({
      list: StateListType.AlertState,
      states: await this.getAlertStates(projectId),
    });
  }
}
