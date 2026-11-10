import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import {
  LLM_USAGE_ROUTE,
  LlmUsageDimension,
  LlmUsageRequestBody,
  LlmUsageResponse,
  readLlmUsageResponse,
} from "Common/Types/Telemetry/LlmUsageApi";
import {
  LLM_SETUP_CHECK_ROUTE,
  LlmSetupCheckRequestBody,
  LlmSetupCheckResponse,
  readLlmSetupCheckResponse,
} from "Common/Types/Telemetry/LlmSetupCheckApi";

/*
 * The client half of two AI / LLM reads:
 *
 *   - /telemetry/llm/usage: what a range's AI usage adds up to - the AI
 *     calls, each model call once, and the usage metrics, each service
 *     counted from the signal it sends (the Usage tab's tiles and
 *     breakdown);
 *   - /telemetry/llm/setup-check: what the project's AI is sending, way by
 *     way (the empty Conversations and Calls views, and Connect).
 *
 * Both answers are read defensively (Common/Types/Telemetry/*Api.ts): a
 * server mid-rollout leaves the page with "nothing", never a crash. A
 * failed request throws, so the caller can tell "none" from "unknown".
 */

async function post(route: string, data: JSONObject): Promise<JSONObject> {
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

  return (response.data || {}) as JSONObject;
}

export function buildLlmUsageBody(data: {
  range: InBetween<Date>;
  dimension: LlmUsageDimension;
}): LlmUsageRequestBody {
  return {
    startTime: data.range.startValue.toISOString(),
    endTime: data.range.endValue.toISOString(),
    dimension: data.dimension,
  };
}

export async function fetchLlmUsage(data: {
  range: InBetween<Date>;
  dimension: LlmUsageDimension;
}): Promise<LlmUsageResponse> {
  const body: JSONObject = await post(
    LLM_USAGE_ROUTE,
    buildLlmUsageBody(data) as unknown as JSONObject,
  );

  return readLlmUsageResponse(body);
}

export function buildLlmSetupCheckBody(
  window?: InBetween<Date> | undefined,
): LlmSetupCheckRequestBody {
  if (!window) {
    return {};
  }

  return {
    startTime: window.startValue.toISOString(),
    endTime: window.endValue.toISOString(),
  };
}

export async function fetchLlmSetupCheck(
  window?: InBetween<Date> | undefined,
): Promise<LlmSetupCheckResponse> {
  const body: JSONObject = await post(
    LLM_SETUP_CHECK_ROUTE,
    buildLlmSetupCheckBody(window) as unknown as JSONObject,
  );

  return readLlmSetupCheckResponse(body);
}
