import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  LLM_CONVERSATION_PATH_SEGMENT,
  getLlmConversationRoute,
  getLlmPageRoute,
  getLlmTraceRoute,
  readLlmConversationKeyFromPath,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  LlmConversationKey,
  LlmConversationKeyKind,
  LlmConversationKeyUtil,
} from "../../../Types/Telemetry/LlmConversationApi";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A conversation id is the customer's own string. Apps use UUIDs, but also
 * "user-42/session-7", "order#1003", ids with spaces, percent signs and
 * emoji. The id must travel as ONE path segment and come back exactly - a
 * slash that splits it, or a decode applied twice, opens the wrong
 * conversation or none.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

function pathOf(route: Route): string {
  return route.toString().split("?")[0] || "";
}

function queryOf(route: Route): URLSearchParams {
  return new URLSearchParams(route.toString().split("?")[1] || "");
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getLlmConversationRoute", () => {
  test("a conversation lives under the project's AI / LLM conversations", () => {
    const route: Route | null = getLlmConversationRoute({ key: "c:chat-123" });

    expect(route?.toString()).toBe(
      `/dashboard/${PROJECT_ID}/llm/${LLM_CONVERSATION_PATH_SEGMENT}/c%3Achat-123`,
    );
  });

  test("a request (no conversation id) lives there too, by trace id", () => {
    expect(getLlmConversationRoute({ key: `t:${TRACE_ID}` })?.toString()).toBe(
      `/dashboard/${PROJECT_ID}/llm/conversations/t%3A${TRACE_ID}`,
    );
  });

  test("the row's first and last call travel as a hint, and a step when asked", () => {
    const route: Route | null = getLlmConversationRoute({
      key: "c:chat-123",
      startedAt: "2026-10-10T09:00:00.000Z",
      endedAt: "2026-10-10T09:05:00.000Z",
      step: 4,
    });

    expect(queryOf(route!).get("from")).toBe("2026-10-10T09:00:00.000Z");
    expect(queryOf(route!).get("to")).toBe("2026-10-10T09:05:00.000Z");
    expect(queryOf(route!).get("step")).toBe("4");
  });

  test("step 0 is a step; a negative step is not", () => {
    expect(
      queryOf(getLlmConversationRoute({ key: "c:a", step: 0 })!).get("step"),
    ).toBe("0");
    expect(
      queryOf(getLlmConversationRoute({ key: "c:a", step: -1 })!).has("step"),
    ).toBe(false);
  });

  test("no hint, no query string", () => {
    expect(getLlmConversationRoute({ key: "c:a" })?.toString()).not.toContain("?");
  });

  test.each([
    [""],
    ["chat-123"],
    ["c:"],
    ["t:not-a-trace-id"],
    [`x:${TRACE_ID}`],
    [`c:${"a".repeat(2000)}`],
  ])("%p is not a conversation key, so there is no route", (key: string) => {
    expect(getLlmConversationRoute({ key: key })).toBeNull();
  });
});

describe("a conversation id survives the trip through the URL", () => {
  test.each([
    ["chat-123"],
    ["user-42/session-7"],
    ["order#1003"],
    ["what?why"],
    ["100% done"],
    ["a b  c"],
    ["%2F already escaped"],
    ["ünïcødé ✓ 👍"],
    ["c:t:nested-prefixes"],
    ["..", ],
    ["../../admin"],
  ])("%p", (conversationId: string) => {
    const key: LlmConversationKey = {
      kind: LlmConversationKeyKind.Conversation,
      value: conversationId,
    };
    const route: Route | null = getLlmConversationRoute({
      key: LlmConversationKeyUtil.encode(key),
      startedAt: "2026-10-10T09:00:00.000Z",
    });

    expect(route).not.toBeNull();

    const path: string = pathOf(route!);

    // One segment: the id's own slashes are escaped.
    expect(path.split("/")).toHaveLength(6);
    expect(readLlmConversationKeyFromPath(path)).toEqual(key);
    // And with the query string still on it, as a raw href carries it.
    expect(readLlmConversationKeyFromPath(route!.toString())).toEqual(key);
  });

  test("a request key comes back as the same trace", () => {
    const route: Route | null = getLlmConversationRoute({ key: `t:${TRACE_ID}` });

    expect(readLlmConversationKeyFromPath(pathOf(route!))).toEqual({
      kind: LlmConversationKeyKind.Request,
      value: TRACE_ID,
    });
  });
});

describe("readLlmConversationKeyFromPath", () => {
  test("reads the last segment under .../conversations/", () => {
    expect(
      readLlmConversationKeyFromPath(
        `/dashboard/${PROJECT_ID}/llm/conversations/c%3Achat-123`,
      ),
    ).toEqual({ kind: LlmConversationKeyKind.Conversation, value: "chat-123" });
  });

  test("a trailing slash, a query and a hash are not part of the key", () => {
    expect(
      readLlmConversationKeyFromPath(
        `/dashboard/${PROJECT_ID}/llm/conversations/c%3Achat-123/`,
      ),
    ).toEqual({ kind: LlmConversationKeyKind.Conversation, value: "chat-123" });
    expect(
      readLlmConversationKeyFromPath(
        `/dashboard/${PROJECT_ID}/llm/conversations/c%3Achat-123?step=2#top`,
      ),
    ).toEqual({ kind: LlmConversationKeyKind.Conversation, value: "chat-123" });
  });

  test.each([
    [null],
    [undefined],
    [""],
    ["/"],
    [`/dashboard/${PROJECT_ID}/llm/conversations`],
    [`/dashboard/${PROJECT_ID}/llm/calls/c%3Achat-123`],
    [`/dashboard/${PROJECT_ID}/llm/conversations/chat-123`],
    [`/dashboard/${PROJECT_ID}/llm/conversations/c%3A`],
    // A malformed escape is not a key, and must not throw.
    [`/dashboard/${PROJECT_ID}/llm/conversations/c%3Achat%E0%A4%A`],
    [`/dashboard/${PROJECT_ID}/llm/conversations/t%3Anot-hex`],
  ])("%p names no conversation", (path: string | null | undefined) => {
    expect(readLlmConversationKeyFromPath(path)).toBeNull();
  });
});

describe("getLlmTraceRoute", () => {
  test("opens the trace, with the call selected when one is named", () => {
    const route: Route = getLlmTraceRoute(TRACE_ID, "00f067aa0ba902b7");

    expect(pathOf(route)).toBe(`/dashboard/${PROJECT_ID}/traces/view/${TRACE_ID}`);
    expect(queryOf(route).get("spanId")).toBe("00f067aa0ba902b7");
  });

  test("without a call, the trace alone", () => {
    expect(getLlmTraceRoute(TRACE_ID).toString()).toBe(
      `/dashboard/${PROJECT_ID}/traces/view/${TRACE_ID}`,
    );
  });
});

describe("getLlmPageRoute", () => {
  test.each([
    [PageMap.LLM_CONVERSATIONS, "conversations"],
    [PageMap.LLM_ALERTS, "alerts"],
    [PageMap.LLM_CALLS, "calls"],
    [PageMap.LLM_USAGE, "usage"],
    [PageMap.LLM_BUDGETS, "budgets"],
    [PageMap.LLM_PRICING, "pricing"],
    [PageMap.LLM_DOCUMENTATION, "documentation"],
  ])("%s is .../llm/%s", (page: PageMap, path: string) => {
    expect(getLlmPageRoute(page).toString()).toBe(
      `/dashboard/${PROJECT_ID}/llm/${path}`,
    );
  });
});
