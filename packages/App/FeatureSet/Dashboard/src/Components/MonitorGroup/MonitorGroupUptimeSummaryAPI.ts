import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { MonitorGroupUptimeSummary } from "Common/Types/Monitor/MonitorGroupUptimeSummary";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import MonitorGroupUptimeSummaryUtil from "Common/Utils/Monitor/MonitorGroupUptimeSummaryUtil";

/*
 * The group's uptime history as the server measures it (MonitorGroupAPI:
 * uptime-summary, issue #6886): its 90 days, cut in the zone the user reads
 * times in, and its uptime over them, from every row.
 *
 * Null when it cannot be had - a server that predates the route, or one
 * that could not answer - so the page draws the group from its rows, as it
 * always did, rather than not at all. A custom route, so the tenantid
 * header is added by hand: BaseAPI does not send it.
 */
export const fetchMonitorGroupUptimeSummary: (data: {
  monitorGroupId: ObjectID;
  timezone: string;
}) => Promise<MonitorGroupUptimeSummary | null> = async (data: {
  monitorGroupId: ObjectID;
  timezone: string;
}): Promise<MonitorGroupUptimeSummary | null> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString())
          .addRoute(new MonitorGroup().getCrudApiPath()!)
          .addRoute("/uptime-summary/")
          .addRoute(`/${data.monitorGroupId.toString()}`)
          .addQueryParam("timezone", data.timezone, true),
        headers: ModelAPI.getCommonHeaders(),
      });

    // API.get can resolve with an error response as well as throw one.
    if (response instanceof HTTPErrorResponse) {
      return null;
    }

    return MonitorGroupUptimeSummaryUtil.fromJSON(response.data);
  } catch {
    return null;
  }
};
