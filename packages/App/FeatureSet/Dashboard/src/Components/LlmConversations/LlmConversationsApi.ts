import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  LLM_CONVERSATIONS_ROUTE,
  LLM_CONVERSATION_PAGE_SIZE,
  LLM_CONVERSATION_ROUTE,
  LlmConversationIssueFilter,
  LlmConversationKeyKind,
  LlmConversationListRequestBody,
  LlmConversationListResponse,
  LlmConversationSort,
  readConversationListResponse,
  readString,
} from "Common/Types/Telemetry/LlmConversationApi";
import { LlmTranscript } from "Common/Utils/Telemetry/LlmConversationTranscript";

/*
 * The client half of /telemetry/llm/conversations and
 * /telemetry/llm/conversation (Common/Types/Telemetry/LlmConversationApi.ts
 * has the contract). Both bodies are read back defensively: a server
 * mid-rollout must leave the page with "nothing" rather than a crash.
 */

export interface LlmConversationListParams {
  startTime: Date;
  endTime: Date;
  serviceIds?: Array<string> | undefined;
  search?: string | undefined;
  issue?: LlmConversationIssueFilter | undefined;
  sort: LlmConversationSort;
  page: number;
  includeSummary: boolean;
}

export interface LlmConversationView {
  key: string;
  kind: LlmConversationKeyKind;
  conversationId: string;
  transcript: LlmTranscript;
  truncated: boolean;
}

export function buildLlmConversationListBody(
  params: LlmConversationListParams,
): LlmConversationListRequestBody {
  return {
    startTime: params.startTime.toISOString(),
    endTime: params.endTime.toISOString(),
    serviceIds:
      params.serviceIds && params.serviceIds.length > 0
        ? params.serviceIds
        : undefined,
    search: params.search?.trim() || undefined,
    issue: params.issue,
    sort: params.sort,
    limit: LLM_CONVERSATION_PAGE_SIZE,
    skip: Math.max(0, params.page) * LLM_CONVERSATION_PAGE_SIZE,
    includeSummary: params.includeSummary,
  };
}

async function post(route: string, data: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data: data,
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

export async function fetchLlmConversations(
  params: LlmConversationListParams,
): Promise<LlmConversationListResponse> {
  const body: JSONObject = await post(
    LLM_CONVERSATIONS_ROUTE,
    buildLlmConversationListBody(params) as unknown as JSONObject,
  );

  return readConversationListResponse(body);
}

/*
 * A transcript as the server answered it, with every list it holds made
 * safe to map over. The steps themselves are rendered defensively.
 */
export function readLlmConversationView(
  value: unknown,
): LlmConversationView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const object: JSONObject = value as JSONObject;
  const transcript: JSONObject | null =
    object["transcript"] &&
    typeof object["transcript"] === "object" &&
    !Array.isArray(object["transcript"])
      ? (object["transcript"] as JSONObject)
      : null;

  if (!transcript) {
    return null;
  }

  const list: (name: string) => Array<unknown> = (
    name: string,
  ): Array<unknown> => {
    return Array.isArray(transcript[name])
      ? (transcript[name] as Array<unknown>)
      : [];
  };

  return {
    key: readString(object["key"]),
    kind:
      object["kind"] === LlmConversationKeyKind.Request
        ? LlmConversationKeyKind.Request
        : LlmConversationKeyKind.Conversation,
    conversationId: readString(object["conversationId"]),
    truncated: object["truncated"] === true,
    transcript: {
      ...(transcript as unknown as LlmTranscript),
      steps: list("steps") as unknown as LlmTranscript["steps"],
      models: list("models") as Array<string>,
      users: list("users") as Array<string>,
      serviceIds: list("serviceIds") as Array<string>,
    },
  };
}

export async function fetchLlmConversation(data: {
  key: string;
  startTime?: string | undefined;
  endTime?: string | undefined;
}): Promise<LlmConversationView | null> {
  const body: JSONObject = await post(LLM_CONVERSATION_ROUTE, {
    key: data.key,
    ...(data.startTime ? { startTime: data.startTime } : {}),
    ...(data.endTime ? { endTime: data.endTime } : {}),
  });

  return readLlmConversationView(body);
}
