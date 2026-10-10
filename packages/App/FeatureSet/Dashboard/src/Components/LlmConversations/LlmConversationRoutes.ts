import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import {
  LlmConversationKey,
  LlmConversationKeyUtil,
} from "Common/Types/Telemetry/LlmConversationApi";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

/*
 * Where a conversation lives in the Dashboard, and how its address is read
 * back. A conversation id is the app's own string - it can hold a slash, a
 * question mark or anything else - so it travels as ONE encoded path
 * segment (LlmConversationKeyUtil.toPathSegment), and the view reads it
 * from the path itself rather than from a router param that may already be
 * decoded.
 *
 * The list row adds the conversation's first and last call as a hint
 * (?from= / ?to=), so the view reads the partitions that hold it instead of
 * the last 30 days.
 */

export const LLM_CONVERSATION_PATH_SEGMENT: string = "conversations";

export function getLlmConversationRoute(data: {
  key: string;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  step?: number | undefined;
}): Route | null {
  const key: LlmConversationKey | null = LlmConversationKeyUtil.decode(
    data.key,
  );

  if (!key) {
    return null;
  }

  const query: Dictionary<string> = {};

  if (data.startedAt) {
    query["from"] = data.startedAt;
  }

  if (data.endedAt) {
    query["to"] = data.endedAt;
  }

  if (data.step !== undefined && data.step >= 0) {
    query["step"] = String(data.step);
  }

  return RouteUtil.getPageRoute(PageMap.LLM_CONVERSATION_VIEW, {
    modelId: LlmConversationKeyUtil.toPathSegment(key),
    query: query,
  });
}

/*
 * The conversation a Dashboard path names:
 * ".../llm/conversations/<encoded key>". Null for any other path.
 */
export function readLlmConversationKeyFromPath(
  pathname: string | null | undefined,
): LlmConversationKey | null {
  if (typeof pathname !== "string") {
    return null;
  }

  const withoutQuery: string = pathname.split("?")[0]?.split("#")[0] || "";
  const segments: Array<string> = withoutQuery
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  if (segments.length < 2) {
    return null;
  }

  if (segments[segments.length - 2] !== LLM_CONVERSATION_PATH_SEGMENT) {
    return null;
  }

  return LlmConversationKeyUtil.fromPathSegment(
    segments[segments.length - 1],
  );
}

// One AI call in the trace view, with the span selected.
export function getLlmTraceRoute(
  traceId: string,
  spanId?: string | undefined,
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TRACE_VIEW] as Route,
    { modelId: traceId },
  );

  return spanId ? RouteUtil.addQuery(route, { spanId: spanId }) : route;
}

export function getLlmPageRoute(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route);
}
