import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import {
  LLM_METRIC_USAGE_ROUTE,
  LlmMetricUsageDimension,
  LlmMetricUsageRequestBody,
  LlmMetricUsageResponse,
  readLlmMetricUsageResponse,
} from "Common/Types/Telemetry/LlmMetricUsageApi";
import {
  LLM_SETUP_CHECK_ROUTE,
  LlmSetupCheckRequestBody,
  LlmSetupCheckResponse,
  readLlmSetupCheckResponse,
} from "Common/Types/Telemetry/LlmSetupCheckApi";

/*
 * The client half of two AI / LLM reads:
 *
 *   - /telemetry/llm/metric-usage: what the GenAI metrics of a range add up
 *     to, counted the way a counter counts (the Usage tab's figures for the
 *     coding assistants and the SDKs that send metrics);
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

export function buildLlmMetricUsageBody(data: {
  range: InBetween<Date>;
  dimension: LlmMetricUsageDimension;
}): LlmMetricUsageRequestBody {
  return {
    startTime: data.range.startValue.toISOString(),
    endTime: data.range.endValue.toISOString(),
    dimension: data.dimension,
  };
}

export async function fetchLlmMetricUsage(data: {
  range: InBetween<Date>;
  dimension: LlmMetricUsageDimension;
}): Promise<LlmMetricUsageResponse> {
  const body: JSONObject = await post(
    LLM_METRIC_USAGE_ROUTE,
    buildLlmMetricUsageBody(data) as unknown as JSONObject,
  );

  return readLlmMetricUsageResponse(body);
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
