import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import {
  readUserFlowJourneysResponse,
  UserFlowJourneysResponseDto,
} from "Common/Types/Rum/UserFlow";

/*
 * The client half of /telemetry/rum/session-replay/user-flow. The endpoint
 * answers with journeys; Common/Utils/Rum/UserFlow.ts turns them into
 * everything the page draws.
 */

export const USER_FLOW_ROUTE: string =
  "/telemetry/rum/session-replay/user-flow";

export async function fetchUserFlowJourneys(request: {
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
}): Promise<UserFlowJourneysResponseDto> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(USER_FLOW_ROUTE),
      data: {
        rumApplicationId: request.rumApplicationId.toString(),
        startTime: OneUptimeDate.toString(request.startTime),
        endTime: OneUptimeDate.toString(request.endTime),
      },
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readUserFlowJourneysResponse(response.data);
}
