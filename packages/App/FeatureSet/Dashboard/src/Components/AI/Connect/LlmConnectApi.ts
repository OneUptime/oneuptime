import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestCounts,
  LlmConnectionTestResult,
  LlmConnectionTestStatus,
} from "Common/Types/LlmObservability/LlmConnectionTest";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL, DOCS_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The two calls the Connect page makes besides the connections' CRUD:
 * "Test connection" (a few days of a provider account's usage, or a count
 * of a company AI tool's newest chats - nothing is imported or stored) and
 * "Read now" (queues a read of a saved connection).
 *
 * The server answers a test with an LlmConnectionTestResult, a failed one
 * included: a refused key is the test's answer, not a failed request.
 */

export const LLM_CONNECTION_API_PATH: string = "/llm-observability-connection";

export function llmConnectionDocsUrl(docsPath: string): URL {
  const relativePath: string = docsPath.replace(/^\/docs/, "");
  return URL.fromString(`${DOCS_URL.toString()}${relativePath}`);
}

const TEST_STATUSES: Array<LlmConnectionTestStatus> = ["pass", "warn", "fail"];

function readCounts(value: JSONValue | undefined): LlmConnectionTestCounts {
  const counts: LlmConnectionTestCounts = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return counts;
  }

  for (const [key, raw] of Object.entries(value as JSONObject)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      (counts as Record<string, number>)[key] = raw;
    }
  }

  return counts;
}

// The server's answer, read as the result it is - or a failure saying so.
export function readLlmConnectionTestResult(
  data: JSONObject | undefined,
): LlmConnectionTestResult {
  const status: unknown = data?.["status"];

  if (!data || !TEST_STATUSES.includes(status as LlmConnectionTestStatus)) {
    return {
      provider: "",
      status: "fail",
      message:
        "The server did not return a test result. Check the API logs and try again.",
      failureKind: LlmConnectionFailureKind.Other,
      durationMs: 0,
    };
  }

  return {
    provider: typeof data["provider"] === "string" ? data["provider"] : "",
    status: status as LlmConnectionTestStatus,
    message: typeof data["message"] === "string" ? data["message"] : "",
    failureKind:
      typeof data["failureKind"] === "string"
        ? (data["failureKind"] as LlmConnectionFailureKind)
        : undefined,
    counts: readCounts(data["counts"]),
    durationMs: typeof data["durationMs"] === "number" ? data["durationMs"] : 0,
  };
}

/*
 * Tests a connection: { provider, config, secrets } for settings never
 * saved, or { connectionId, config?, secrets? } for a saved one (a secret
 * left empty keeps the stored one).
 */
export async function runLlmConnectionTest(
  body: JSONObject,
): Promise<LlmConnectionTestResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(`${LLM_CONNECTION_API_PATH}/test`),
      headers: ModelAPI.getCommonHeaders(),
      data: body,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readLlmConnectionTestResult(response.data);
}

// Queues a read of a saved, enabled connection now.
export async function readLlmConnectionNow(
  connectionId: ObjectID,
): Promise<void> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        `${LLM_CONNECTION_API_PATH}/${connectionId.toString()}/read-now`,
      ),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
}
