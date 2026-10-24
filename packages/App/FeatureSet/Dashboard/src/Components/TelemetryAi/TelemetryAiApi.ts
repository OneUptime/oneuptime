import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import {
  TELEMETRY_AI_LOGS_PATH,
  TELEMETRY_AI_READINESS_PATH,
  TelemetryAiLogsJSON,
  TelemetryAiReadinessJSON,
  parseTelemetryAiLogs,
  parseTelemetryAiReadiness,
} from "Common/Types/AI/TelemetryAiActivity";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The AI section's two reads (Common/Server/API/TelemetryAiAPI): one
 * request each, parsed defensively - an answer that does not hold together
 * is refused like a failed request, so a page says it could not read it
 * rather than drawing half of it.
 */

export const TELEMETRY_AI_UNREADABLE_ANSWER: string =
  "The server's answer could not be read.";

async function post(route: string, data: JSONObject): Promise<unknown> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data: data,
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data;
}

// Whether OneUptime AI can open pull requests for the lane's problems now.
export async function fetchTelemetryAiReadiness(
  lane: TelemetryAiLane,
): Promise<TelemetryAiReadinessJSON> {
  const readiness: TelemetryAiReadinessJSON | null = parseTelemetryAiReadiness(
    await post(TELEMETRY_AI_READINESS_PATH, { lane }),
  );

  if (!readiness) {
    throw new Error(TELEMETRY_AI_UNREADABLE_ANSWER);
  }

  return readiness;
}

// One page of what OneUptime AI did with the lane's problems.
export async function fetchTelemetryAiLogs(data: {
  lane: TelemetryAiLane;
  skip: number;
}): Promise<TelemetryAiLogsJSON> {
  const logs: TelemetryAiLogsJSON | null = parseTelemetryAiLogs(
    await post(TELEMETRY_AI_LOGS_PATH, { lane: data.lane, skip: data.skip }),
  );

  if (!logs) {
    throw new Error(TELEMETRY_AI_UNREADABLE_ANSWER);
  }

  return logs;
}
