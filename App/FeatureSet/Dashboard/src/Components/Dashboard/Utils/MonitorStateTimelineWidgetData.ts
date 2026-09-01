import {
  getPublicDashboardContext,
  PublicDashboardContext,
} from "./PublicDashboardContext";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import GreaterThanOrNull from "Common/Types/BaseDatabase/GreaterThanOrNull";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Data access for the Monitor List widget's State Timeline view, on both an
 * authenticated dashboard and an anonymous public one.
 *
 * The two paths are deliberately NOT symmetrical. The authenticated path
 * queries MonitorStatusTimeline directly for the monitor ids the widget just
 * listed. The public path cannot: monitor ids sent by an anonymous caller
 * would be a selector the server has to trust, and the whole public-dashboard
 * design refuses to trust client-supplied selectors. So the public route takes
 * only the componentId and the window, re-derives the monitor set from the
 * STORED widget, and returns the timelines for exactly those monitors.
 */

/*
 * Everything the timeline draws, and nothing else. The public endpoint pins
 * its own copy of this select server-side and ignores whatever the client
 * sends, so this list is the widget's contract, never its access control.
 *
 * monitorStatus._id is not cosmetic: UptimeUtil keys an event's status off it,
 * and without it every segment would collapse into one indistinguishable
 * status and the uptime percentage would count no downtime at all.
 */
export const MONITOR_STATE_TIMELINE_SELECT: Select<MonitorStatusTimeline> = {
  monitorId: true,
  startsAt: true,
  endsAt: true,
  monitorStatus: {
    _id: true,
    name: true,
    color: true,
    isOperationalState: true,
    priority: true,
  },
};

export default class MonitorStateTimelineWidgetData {
  /**
   * The status history overlapping [startDate, endDate] for the given
   * monitors, oldest first.
   */
  public static async fetchStatusTimelines(data: {
    componentId: ObjectID;
    monitorIds: Array<ObjectID>;
    projectId: ObjectID | null;
    startDate: Date;
    endDate: Date;
    variables?: Array<DashboardVariable> | undefined;
  }): Promise<Array<MonitorStatusTimeline>> {
    const context: PublicDashboardContext | null = getPublicDashboardContext();

    if (context) {
      return MonitorStateTimelineWidgetData.fetchPublicStatusTimelines({
        context,
        componentId: data.componentId,
        startDate: data.startDate,
        endDate: data.endDate,
        variables: data.variables,
      });
    }

    if (data.monitorIds.length === 0 || !data.projectId) {
      return [];
    }

    const listResult: ListResult<MonitorStatusTimeline> =
      await ModelAPI.getList<MonitorStatusTimeline>({
        modelType: MonitorStatusTimeline,
        query: {
          /*
           * Every row that OVERLAPS the window, not just the rows that began
           * inside it. A monitor that went Offline before the window opened
           * and is still Offline has exactly one row, and it started in the
           * past — without this the lane would render empty for a monitor
           * that has been down the whole time.
           */
          startsAt: new LessThanOrEqual(data.endDate),
          endsAt: new GreaterThanOrNull(data.startDate),
          monitorId: new Includes(data.monitorIds),
          projectId: data.projectId,
        } as Query<MonitorStatusTimeline>,
        select: MONITOR_STATE_TIMELINE_SELECT,
        sort: {
          /*
           * startsAt, not createdAt: they are different clocks (DB now() vs
           * worker moment()) with real skew, and startsAt is the one the
           * timeline math orders by.
           */
          startsAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    return listResult.data;
  }

  private static async fetchPublicStatusTimelines(data: {
    context: PublicDashboardContext;
    componentId: ObjectID;
    startDate: Date;
    endDate: Date;
    variables?: Array<DashboardVariable> | undefined;
  }): Promise<Array<MonitorStatusTimeline>> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await data.context.postJSON(
        `/monitor-status-timeline/${data.context.dashboardId.toString()}`,
        {
          componentId: data.componentId.toString(),
          /*
           * Selections only — the same projection the resource-list route
           * takes. The server resolves each id against the dashboard's stored
           * variables, including its trusted type and attribute key.
           */
          variables: (data.variables || []).map(
            (variable: DashboardVariable): JSONObject => {
              return {
                id: variable.id,
                selectedValue: variable.selectedValue ?? null,
                selectedValues: variable.selectedValues || [],
              };
            },
          ) as JSONArray,
          /*
           * toJSON(), NOT JSONFunctions.serialize(): serialize would wrap each
           * bound as {_type: "DateTime", value}, and InBetween.fromJSON copies
           * its bounds across verbatim — so the server would receive an
           * InBetween holding two objects where it expects two dates, and
           * reject the window. toJSON leaves the raw Dates, which JSON
           * stringification turns into the ISO strings the server parses.
           */
          startAndEndDate: new InBetween<Date>(
            data.startDate,
            data.endDate,
          ).toJSON(),
        },
      );

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const list: JSONArray = (response.data["data"] || []) as JSONArray;

    return BaseModel.fromJSONArray(list, MonitorStatusTimeline);
  }
}
