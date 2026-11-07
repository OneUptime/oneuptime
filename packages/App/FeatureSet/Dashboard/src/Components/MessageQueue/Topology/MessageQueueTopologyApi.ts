import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  MESSAGE_QUEUE_TOPOLOGY_API_PATH,
  MessageQueueTopologyResponse,
  readMessageQueueTopologyResponse,
} from "Common/Types/MessageQueue/MessageQueueTopology";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Queues topology's one request: how messages flowed between the
 * project's services and queues over a range (POST
 * /api/telemetry/message-queues/topology). The answer is read defensively
 * (readMessageQueueTopologyResponse), so an odd row is left out rather than
 * breaking the map. A failed request rejects with the API's error, which
 * the page words with API.getFriendlyMessage.
 */
export async function fetchMessageQueueTopology(window: {
  start: Date;
  end: Date;
}): Promise<MessageQueueTopologyResponse> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
    MESSAGE_QUEUE_TOPOLOGY_API_PATH,
  );
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url,
      data: {
        startTime: OneUptimeDate.toString(window.start),
        endTime: OneUptimeDate.toString(window.end),
      },
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readMessageQueueTopologyResponse(response.data);
}
