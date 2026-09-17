import DashboardResourceList, {
  DashboardResourceRequestOptions,
} from "./DashboardResourceList";
import {
  getPublicDashboardContext,
  PublicDashboardContext,
} from "./PublicDashboardContext";
import SloHistory from "Common/Models/AnalyticsModels/SloHistory";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import { SLO_WIDGET_NAME_MATCH_LIMIT } from "Common/Utils/Dashboard/SloWidgetSource";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Data access for the dashboard SLO widget, which reads the same two things
 * on an authenticated dashboard and on an anonymous public one — but through
 * different endpoints.
 *
 * Keeping both routes here (rather than branching inside the renderer) means
 * the public and private paths cannot drift in what they SELECT, which is the
 * field that decides what an anonymous viewer gets to see.
 */

/*
 * Exactly the fields the widget renders. The public endpoint pins its own
 * copy of this select server-side and ignores whatever the client sends, so
 * this list is the widget's contract, never its access control.
 */
export const SLO_WIDGET_SELECT: Select<ServiceLevelObjective> = {
  name: true,
  targetPercentage: true,
  currentSliPercentage: true,
  errorBudgetRemainingPercentage: true,
  errorBudgetRemainingSeconds: true,
  currentBurnRate: true,
  sloStatus: true,
};

/*
 * A widget that follows a toolbar selection knows its SLO only by NAME until
 * the lookup returns, and the authenticated history aggregation is keyed by
 * id — so that one read also needs the row's id. (The public select already
 * carries `_id`.)
 */
export const SLO_WIDGET_SELECT_WITH_ID: Select<ServiceLevelObjective> = {
  _id: true,
  ...SLO_WIDGET_SELECT,
};

export default class SloWidgetData {
  /**
   * The SLO's current numbers, for a widget PINNED to one SLO.
   *
   * Public dashboards go through the shared resource-list endpoint, which
   * resolves the SLO from the STORED widget config — so the id below is only
   * ever used by the authenticated path.
   */
  public static async fetchSlo(data: {
    serviceLevelObjectiveId: ObjectID;
    componentId: ObjectID;
  }): Promise<ServiceLevelObjective | null> {
    /*
     * No variables are sent: a pinned SLO widget names one SLO outright, so
     * its server-side policy has nothing to interpolate.
     */
    const requestOptions: DashboardResourceRequestOptions | undefined =
      DashboardResourceList.getRequestOptions("slo", {
        componentId: data.componentId,
      });

    if (!requestOptions) {
      return ModelAPI.getItem<ServiceLevelObjective>({
        modelType: ServiceLevelObjective,
        id: data.serviceLevelObjectiveId,
        select: SLO_WIDGET_SELECT,
      });
    }

    const listResult: ListResult<ServiceLevelObjective> =
      await ModelAPI.getList<ServiceLevelObjective>({
        modelType: ServiceLevelObjective,
        requestOptions: requestOptions,
        query: {
          _id: data.serviceLevelObjectiveId,
        } as Query<ServiceLevelObjective>,
        select: SLO_WIDGET_SELECT,
        sort: {
          name: SortOrder.Ascending,
        },
        limit: 1,
        skip: 0,
      });

    /*
     * A widget pointed at a since-deleted SLO comes back as an empty list
     * rather than a 404, which is the same "this SLO no longer exists" state
     * the authenticated path expresses with null.
     */
    return listResult.data[0] || null;
  }

  /**
   * The ACTIVE SLOs carrying the name a variable-bound widget's toolbar
   * selection resolved to — at most SLO_WIDGET_NAME_MATCH_LIMIT of them, so
   * the renderer can tell "no such SLO" and "two SLOs share this name" apart
   * from a clean match.
   *
   * On a public dashboard the viewer's selections ARE sent: the endpoint
   * re-resolves the name from its own stored copy of the bound variable and
   * the selection alone, so the query here only drives the authenticated path.
   */
  public static async fetchSlosByName(data: {
    sloName: string;
    componentId: ObjectID;
    projectId?: ObjectID | null | undefined;
    variables?: Array<DashboardVariable> | undefined;
  }): Promise<Array<ServiceLevelObjective>> {
    const requestOptions: DashboardResourceRequestOptions | undefined =
      DashboardResourceList.getRequestOptions("slo", {
        componentId: data.componentId,
        variables: data.variables,
      });

    const query: Record<string, unknown> = {
      name: data.sloName,
      // Archived SLOs are hidden from every SLO picker and list.
      isArchived: false,
    };

    if (!requestOptions && data.projectId) {
      query["projectId"] = data.projectId;
    }

    const listResult: ListResult<ServiceLevelObjective> =
      await ModelAPI.getList<ServiceLevelObjective>({
        modelType: ServiceLevelObjective,
        requestOptions: requestOptions,
        query: query as Query<ServiceLevelObjective>,
        select: SLO_WIDGET_SELECT_WITH_ID,
        sort: {
          name: SortOrder.Ascending,
        },
        limit: SLO_WIDGET_NAME_MATCH_LIMIT,
        skip: 0,
      });

    return listResult.data;
  }

  /**
   * The SLO's history series for the widget's Chart display.
   *
   * The public endpoint takes the componentId instead of a query: it rebuilds
   * the whole aggregation from the stored widget and only reads the time
   * window out of `aggregateBy` — plus, for a widget that follows an SLO
   * variable, the viewer's selections, which is the only way the server can
   * know which SLO the reader picked.
   */
  public static async aggregateSloHistory(data: {
    componentId: ObjectID;
    aggregateBy: AggregateBy<SloHistory>;
    variables?: Array<DashboardVariable> | undefined;
  }): Promise<AggregatedResult> {
    const context: PublicDashboardContext | null = getPublicDashboardContext();

    if (!context) {
      return AnalyticsModelAPI.aggregate<SloHistory>({
        modelType: SloHistory,
        aggregateBy: data.aggregateBy,
      });
    }

    const body: JSONObject = {
      componentId: data.componentId.toString(),
      aggregateBy: JSONFunctions.serialize(
        data.aggregateBy as any,
      ) as JSONObject,
    };

    if (data.variables) {
      body["variables"] = DashboardResourceList.getVariableSelections(
        data.variables,
      );
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await context.postJSON(
        `/slo-history-aggregate/${context.dashboardId.toString()}`,
        body,
      );

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return response.data as unknown as AggregatedResult;
  }
}
