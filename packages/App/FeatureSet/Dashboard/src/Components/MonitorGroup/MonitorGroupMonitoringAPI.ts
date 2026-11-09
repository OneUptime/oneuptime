import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import MonitorGroupMonitoring, {
  MonitorGroupMonitoringSummary,
} from "Common/Utils/Monitor/MonitorGroupMonitoring";

/*
 * The server's answers about monitoring for every monitor in a monitor
 * group (MonitorGroupAPI: monitoring-summary, turn-monitoring-off and
 * turn-monitoring-on). Each read throws what went wrong, worded for the
 * reader (API.getFriendlyMessage), and an answer that is no summary is an
 * error too, never a wrong count.
 */

// A Dashboard translation key: the card that shows it translates it.
export const NOT_A_SUMMARY_ERROR: string = translationKey(
  "The monitors of this group could not be read. Please try again.",
);

const post: (data: {
  route: string;
  monitorGroupId: ObjectID;
}) => Promise<MonitorGroupMonitoringSummary> = async (data: {
  route: string;
  monitorGroupId: ObjectID;
}): Promise<MonitorGroupMonitoringSummary> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString())
        .addRoute(new MonitorGroup().getCrudApiPath()!)
        .addRoute(`/${data.route}/`)
        .addRoute(`/${data.monitorGroupId.toString()}`),
      data: {},
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    });

  if (response instanceof HTTPErrorResponse) {
    throw new Error(API.getFriendlyMessage(response));
  }

  const summary: MonitorGroupMonitoringSummary | null =
    MonitorGroupMonitoring.fromJSON(response.data);

  if (!summary) {
    throw new Error(NOT_A_SUMMARY_ERROR);
  }

  return summary;
};

export const fetchMonitorGroupMonitoringSummary: (
  monitorGroupId: ObjectID,
) => Promise<MonitorGroupMonitoringSummary> = async (
  monitorGroupId: ObjectID,
): Promise<MonitorGroupMonitoringSummary> => {
  return await post({
    route: "monitoring-summary",
    monitorGroupId: monitorGroupId,
  });
};

// Answers the group's monitors as they are once the switch is turned.
export const setMonitorGroupMonitoring: (data: {
  monitorGroupId: ObjectID;
  isMonitoringOn: boolean;
}) => Promise<MonitorGroupMonitoringSummary> = async (data: {
  monitorGroupId: ObjectID;
  isMonitoringOn: boolean;
}): Promise<MonitorGroupMonitoringSummary> => {
  return await post({
    route: data.isMonitoringOn ? "turn-monitoring-on" : "turn-monitoring-off",
    monitorGroupId: data.monitorGroupId,
  });
};
