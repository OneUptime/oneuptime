import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import {
  ErrorPatternCorrelation,
  LogsInsightsScope,
  ResourceLogBreakdown,
  ScopeFacetValue,
  TopErrorPatternRow,
  buildErrorPatternCorrelationRequest,
  buildInsightsHistogramRequest,
  buildScopeFacetsRequest,
  buildServiceBreakdownRequest,
  buildTopErrorPatternsRequest,
  parseErrorPatternCorrelation,
  parseScopeFacets,
  parseTopErrorPatterns,
  summarizeResourceBreakdown,
} from "../../Utils/LogsInsights";

/*
 * The network half of the Logs Insights page. Kept apart from
 * Utils/LogsInsights so that module — the request bodies, the parsing and
 * every derived number — stays free of the API client and can be exercised
 * in plain Node.
 */

function getApiUrl(path: string): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(path);
}

async function postApi(
  path: string,
  data: JSONObject,
): Promise<HTTPResponse<JSONObject>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: getApiUrl(path),
      data,
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response;
}

/** Severity-bucketed volume for the whole window, aggregated server-side. */
export async function fetchInsightsHistogram(
  scope: LogsInsightsScope,
): Promise<Array<JSONObject>> {
  const response: HTTPResponse<JSONObject> = await postApi(
    "/telemetry/logs/histogram",
    buildInsightsHistogramRequest(scope),
  );

  const buckets: unknown = response.data["buckets"];

  return Array.isArray(buckets) ? (buckets as Array<JSONObject>) : [];
}

/**
 * Severity-bucketed volume for an arbitrary prebuilt request body — the
 * seam for callers whose scope includes ATTRIBUTE filters
 * (LogsHistogramRequest.buildLogsHistogramRequest), which
 * LogsInsightsScope deliberately does not model.
 */
export async function fetchLogsHistogramRaw(
  body: JSONObject,
): Promise<Array<JSONObject>> {
  const response: HTTPResponse<JSONObject> = await postApi(
    "/telemetry/logs/histogram",
    body,
  );

  const buckets: unknown = response.data["buckets"];

  return Array.isArray(buckets) ? (buckets as Array<JSONObject>) : [];
}

/** The distinct error messages in the window, most frequent first. */
export async function fetchTopErrorPatterns(
  scope: LogsInsightsScope,
  limit: number,
): Promise<Array<TopErrorPatternRow>> {
  const response: HTTPResponse<JSONObject> = await postApi(
    "/telemetry/logs/error-patterns",
    buildTopErrorPatternsRequest(scope, limit),
  );

  return parseTopErrorPatterns(response.data);
}

/** Everything the detail panel needs about one pattern, in one round trip. */
export async function fetchErrorPatternCorrelation(
  scope: LogsInsightsScope,
  pattern: string,
  limit: number,
): Promise<ErrorPatternCorrelation> {
  const response: HTTPResponse<JSONObject> = await postApi(
    "/telemetry/logs/error-pattern-correlation",
    buildErrorPatternCorrelationRequest(scope, pattern, limit),
  );

  return parseErrorPatternCorrelation(response.data);
}

/** Per-resource log volume and error counts, aggregated server-side. */
export async function fetchResourceBreakdown(
  scope: LogsInsightsScope,
): Promise<Array<ResourceLogBreakdown>> {
  const response: HTTPResponse<JSONObject> = await postApi(
    "/telemetry/logs/analytics",
    buildServiceBreakdownRequest(scope),
  );

  return summarizeResourceBreakdown(response.data);
}

/**
 * The services, hosts and clusters that logged anything in the window —
 * the options the scope picker offers.
 */
export async function fetchScopeFacets(
  scope: LogsInsightsScope,
): Promise<Dictionary<Array<ScopeFacetValue>>> {
  const response: HTTPResponse<JSONObject> = await postApi(
    "/telemetry/logs/facets",
    buildScopeFacetsRequest(scope.timeRange),
  );

  return parseScopeFacets(response.data);
}
