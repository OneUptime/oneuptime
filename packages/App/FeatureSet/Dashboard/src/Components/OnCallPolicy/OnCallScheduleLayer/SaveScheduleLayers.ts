import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ScheduleLayersSaveUtil, {
  ScheduleLayersSaveRequest,
  ScheduleLayersSaveResult,
  getScheduleLayersSaveRoute,
} from "Common/Types/OnCallDutyPolicy/ScheduleLayersSave";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Save on a schedule's Layers page: every change to who takes turns - people
 * added, taken out or put in another order, layers moved or deleted - sent
 * at once, to be written together and told to the people it reaches once
 * (POST /on-call-duty-policy-schedule/:id/save-layers, issue #7575). Throws
 * what the server answered when it refused; a refusal because someone else
 * changed the layers first is a conflict (isScheduleLayersSaveConflict).
 */
export const getScheduleLayersSaveUrl: (scheduleId: ObjectID) => URL = (
  scheduleId: ObjectID,
): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${new OnCallDutyPolicySchedule().getCrudApiPath()!.toString()}${getScheduleLayersSaveRoute(
      scheduleId.toString(),
    )}`,
  );
};

export const saveScheduleLayers: (data: {
  scheduleId: ObjectID;
  projectId: ObjectID;
  request: ScheduleLayersSaveRequest;
}) => Promise<ScheduleLayersSaveResult> = async (data: {
  scheduleId: ObjectID;
  projectId: ObjectID;
  request: ScheduleLayersSaveRequest;
}): Promise<ScheduleLayersSaveResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: getScheduleLayersSaveUrl(data.scheduleId),
      data: ScheduleLayersSaveUtil.requestToJSON(data.request),
      headers: {
        ...ModelAPI.getCommonHeaders(),
        tenantid: data.projectId.toString(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return ScheduleLayersSaveUtil.resultFromJSON(response.data);
};

/*
 * Whether Save was refused because the layers changed after the page read
 * them - on another page, through the API, by Terraform: the server's 409.
 */
export const isScheduleLayersSaveConflict: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { statusCode?: unknown }).statusCode ===
      ExceptionCode.ConflictException
  );
};
