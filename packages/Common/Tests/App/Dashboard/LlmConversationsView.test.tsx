import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import LlmConversationsView from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationsView";
import {
  LLM_CONVERSATION_PAGE_SIZE,
  LlmConversationListItem,
  LlmConversationSort,
  LlmConversationSummary,
  emptyIssueCounts,
} from "../../../Types/Telemetry/LlmConversationApi";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import TimeRange from "../../../Types/Time/TimeRange";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Service from "../../../Models/DatabaseModels/Service";
import { PROJECT_ID, goTo, listItem, summary } from "./LlmConversationFixtures";

/*
 * THE HOME OF AI / LLM OBSERVABILITY: every conversation the AI had.
 *
 * Five numbers, chips that narrow the list to what needs attention, a sort,
 * a search and the list itself - all kept in the URL. What each control
 * asks the server for, what it writes into the URL, and what the page says
 * when there is nothing to show, are pinned here against a stand-in server.
 */

const APP_ID: string = "6f1e2d3c-4b5a-4968-8776-655443322110";
const PAGE: string = `/dashboard/${PROJECT_ID}/llm/conversations`;

interface ServerState {
  summary: LlmConversationSummary | null;
  conversations: Array<LlmConversationListItem>;
  hasMore: boolean;
}

let server: ServerState;
let postSpy: ReturnType<typeof jest.spyOn>;
let navigateSpy: ReturnType<typeof jest.spyOn>;

function bodies(): Array<JSONObject> {
  return (postSpy.mock.calls as Array<Array<unknown>>).map((call: Array<unknown>): JSONObject => {
    return (call[0] as { data: JSONObject }).data;
  });
}

function lastBody(): JSONObject {
  const all: Array<JSONObject> = bodies();

  return all[all.length - 1]!;
}

function urlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

async function openList(query: string = ""): Promise<void> {
  goTo(`${PAGE}${query}`);

  render(
    <MemoryRouter initialEntries={[`${PAGE}${query}`]}>
      <LlmConversationsView />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.queryByTestId("llm-conversations-loading")).not.toBeInTheDocument();
  });
}

async function settled(requests: number): Promise<void> {
  await waitFor(() => {
    expect(postSpy).toHaveBeenCalledTimes(requests);
    expect(screen.queryByTestId("llm-conversations-loading")).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  server = {
    summary: summary(),
    conversations: [
      listItem({
        key: "c:chat-1",
        conversationId: "chat-1",
        title: "Where should I go in May?",
        serviceIds: [APP_ID],
        issueCounts: { ...emptyIssueCounts(), [LlmAnswerIssue.Refused]: 1 },
      }),
      listItem({
        key: "c:chat-2",
        conversationId: "chat-2",
        title: "Can I get a refund?",
      }),
    ],
    hasMore: false,
  };

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getList").mockImplementation(async (): Promise<never> => {
    const service: Service = new Service();
    service._id = APP_ID;
    service.name = "Support bot";

    return { data: [service], count: 1, skip: 0, limit: 1 } as never;
  });
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  postSpy = jest.spyOn(API, "post").mockImplementation(
    async (args: unknown): Promise<HTTPResponse<JSONObject>> => {
      const body: JSONObject = (args as { data: JSONObject }).data;

      return new HTTPResponse<JSONObject>(
        200,
        {
          summary: body["includeSummary"]
            ? (server.summary as unknown as JSONObject)
            : null,
          conversations: server.conversations as unknown as Array<JSONObject>,
          hasMore: server.hasMore,
        } as JSONObject,
        {},
      );
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("opening the list", () => {
  test("asks for the past week, newest first, with the numbers", async () => {
    await openList();

    const body: JSONObject = lastBody();
    const weekMs: number =
      new Date(body["endTime"] as string).getTime() -
      new Date(body["startTime"] as string).getTime();

    expect(Math.round(weekMs / (24 * 60 * 60 * 1000))).toBe(7);
    expect(body["sort"]).toBe(LlmConversationSort.Newest);
    expect(body["skip"]).toBe(0);
    expect(body["limit"]).toBe(LLM_CONVERSATION_PAGE_SIZE);
    expect(body["includeSummary"]).toBe(true);
    expect(body["search"]).toBeUndefined();
    expect(body["issue"]).toBeUndefined();
    expect(body["serviceIds"]).toBeUndefined();
  });

  test("the numbers, the chips with their counts, and a row per conversation", async () => {
    await openList();

    expect(screen.getByTestId("llm-summary-conversations-value")).toHaveTextContent("120");
    expect(screen.getByTestId("llm-chip-all-count")).toHaveTextContent("120");
    expect(screen.getByTestId("llm-chip-any-count")).toHaveTextContent("6");
    expect(screen.getByTestId("llm-chip-refused-count")).toHaveTextContent("4");
    expect(screen.getByTestId("llm-chip-failed-count")).toHaveTextContent("2");
    // A problem no conversation had is not offered as a chip.
    expect(screen.queryByTestId("llm-chip-cut_off")).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-chip-all")).toHaveAttribute("aria-pressed", "true");

    const rows: Array<HTMLElement> = screen.getAllByTestId("llm-conversation-row");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Where should I go in May?");
    expect(rows[0]).toHaveTextContent("Support bot");
  });

  test("each row opens its conversation, with where to look for it", async () => {
    await openList();

    const href: string | null =
      screen.getAllByTestId("llm-conversation-row")[0]!.closest("a")!.getAttribute("href");

    expect(href?.split("?")[0]).toBe(`${PAGE}/c%3Achat-1`);
    expect(new URLSearchParams(href?.split("?")[1]).get("from")).toBe(
      server.conversations[0]!.startedAt,
    );
    expect(new URLSearchParams(href?.split("?")[1]).get("to")).toBe(
      server.conversations[0]!.endedAt,
    );
  });

  test("the view in the URL is the view the list opens on", async () => {
    await openList(
      `?q=refund&issue=refused&sort=most_expensive&page=2&app=${APP_ID}&range=${TimeRange.PAST_ONE_DAY}`,
    );

    const body: JSONObject = lastBody();

    expect(body["search"]).toBe("refund");
    expect(body["issue"]).toBe(LlmAnswerIssue.Refused);
    expect(body["sort"]).toBe(LlmConversationSort.MostExpensive);
    expect(body["skip"]).toBe(2 * LLM_CONVERSATION_PAGE_SIZE);
    expect(body["serviceIds"]).toEqual([APP_ID]);
    expect(screen.getByTestId("llm-conversations-search")).toHaveValue("refund");
    expect(screen.getByTestId("llm-chip-refused")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("narrowing the list", () => {
  test("Need attention narrows to every conversation with a problem, without re-counting", async () => {
    await openList();

    fireEvent.click(screen.getByTestId("llm-chip-any"));
    await settled(2);

    expect(lastBody()["issue"]).toBe("any");
    expect(lastBody()["includeSummary"]).toBe(false);
    expect(lastBody()["skip"]).toBe(0);
    expect(urlParam("issue")).toBe("any");
    expect(screen.getByTestId("llm-chip-any")).toHaveAttribute("aria-pressed", "true");
    // The numbers stay: they describe the time range, not the chip.
    expect(screen.getByTestId("llm-summary-conversations-value")).toHaveTextContent("120");
  });

  test("the Need attention tile does the same", async () => {
    await openList();

    fireEvent.click(screen.getByTestId("llm-summary-problems"));
    await settled(2);

    expect(lastBody()["issue"]).toBe("any");
  });

  test("one problem's chip, and All to go back", async () => {
    await openList();

    fireEvent.click(screen.getByTestId("llm-chip-refused"));
    await settled(2);

    expect(lastBody()["issue"]).toBe(LlmAnswerIssue.Refused);
    expect(urlParam("issue")).toBe(LlmAnswerIssue.Refused);

    fireEvent.click(screen.getByTestId("llm-chip-all"));
    await settled(3);

    expect(lastBody()["issue"]).toBeUndefined();
    expect(urlParam("issue")).toBeNull();
  });

  test("a chosen problem keeps its chip even when nothing has it", async () => {
    await openList("?issue=cut_off");

    expect(screen.getByTestId("llm-chip-cut_off")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("llm-chip-cut_off-count")).toHaveTextContent("0");
  });

  test("the sort", async () => {
    await openList();

    fireEvent.change(screen.getByTestId("llm-conversations-sort"), {
      target: { value: LlmConversationSort.Slowest },
    });
    await settled(2);

    expect(lastBody()["sort"]).toBe(LlmConversationSort.Slowest);
    expect(lastBody()["includeSummary"]).toBe(false);
    expect(urlParam("sort")).toBe(LlmConversationSort.Slowest);
  });

  test("the sort offers every order, in words", async () => {
    await openList();

    expect(
      within(screen.getByTestId("llm-conversations-sort"))
        .getAllByRole("option")
        .map((option: HTMLElement): string | null => {
          return option.textContent;
        }),
    ).toEqual(["Newest first", "Oldest first", "Most expensive", "Slowest answers", "Most calls"]);
  });

  test("a search waits for typing to settle, then re-counts", async () => {
    await openList();

    fireEvent.change(screen.getByTestId("llm-conversations-search"), {
      target: { value: "  refund  " },
    });

    // Nothing is asked while typing.
    expect(postSpy).toHaveBeenCalledTimes(1);

    await settled(2);

    expect(lastBody()["search"]).toBe("refund");
    expect(lastBody()["includeSummary"]).toBe(true);
    expect(urlParam("q")).toBe("refund");
  });

  test("Enter searches at once", async () => {
    await openList();

    const input: HTMLElement = screen.getByTestId("llm-conversations-search");

    fireEvent.change(input, { target: { value: "refund" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await settled(2);

    expect(lastBody()["search"]).toBe("refund");
  });

  test("the search box says what it searches", async () => {
    await openList();

    const input: HTMLElement = screen.getByTestId("llm-conversations-search");

    expect(input).toHaveAttribute("aria-label", "Search conversations");
    expect(input).toHaveAttribute(
      "placeholder",
      "Search what people asked, a person, a model or a conversation id",
    );
  });

  test("one app", async () => {
    await openList();

    const select: HTMLElement = await screen.findByTestId("llm-conversations-app");

    expect(within(select).getByRole("option", { name: "All apps" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Support bot" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: APP_ID } });
    await settled(2);

    expect(lastBody()["serviceIds"]).toEqual([APP_ID]);
    expect(lastBody()["includeSummary"]).toBe(true);
    expect(urlParam("app")).toBe(APP_ID);
  });

  test("with no apps to choose from, there is no app filter", async () => {
    jest.spyOn(ModelAPI, "getList").mockImplementation(async (): Promise<never> => {
      return { data: [], count: 0, skip: 0, limit: 0 } as never;
    });

    await openList();

    expect(screen.queryByTestId("llm-conversations-app")).not.toBeInTheDocument();
  });
});

describe("pages", () => {
  test("more than a page: where you are, and Next and Previous", async () => {
    server.hasMore = true;

    await openList();

    const pagination: HTMLElement = screen.getByTestId("llm-conversations-pagination");

    expect(pagination).toHaveTextContent("Showing 1–2 of 120");
    expect(screen.getByTestId("llm-conversations-previous")).toBeDisabled();

    fireEvent.click(screen.getByTestId("llm-conversations-next"));
    await settled(2);

    expect(lastBody()["skip"]).toBe(LLM_CONVERSATION_PAGE_SIZE);
    expect(lastBody()["includeSummary"]).toBe(false);
    expect(urlParam("page")).toBe("1");
    expect(screen.getByTestId("llm-conversations-pagination")).toHaveTextContent(
      `Showing ${LLM_CONVERSATION_PAGE_SIZE + 1}–${LLM_CONVERSATION_PAGE_SIZE + 2} of 120`,
    );

    fireEvent.click(screen.getByTestId("llm-conversations-previous"));
    await settled(3);

    expect(lastBody()["skip"]).toBe(0);
    expect(urlParam("page")).toBeNull();
  });

  test("a chip counts its own conversations, not all of them", async () => {
    server.hasMore = true;

    await openList("?issue=refused");

    expect(screen.getByTestId("llm-conversations-pagination")).toHaveTextContent(
      "Showing 1–2 of 4",
    );
  });

  test("one page is no pagination", async () => {
    await openList();

    expect(screen.queryByTestId("llm-conversations-pagination")).not.toBeInTheDocument();
  });
});

describe("when there is nothing to show", () => {
  test("the first time: no numbers, no chips - how to send conversations", async () => {
    server.summary = summary({
      conversationCount: 0,
      problemConversationCount: 0,
      issueConversationCounts: emptyIssueCounts(),
    });
    server.conversations = [];

    await openList();

    const empty: HTMLElement = screen.getByTestId("llm-conversations-empty");

    expect(empty).toHaveTextContent("No AI conversations here yet");
    expect(empty).toHaveTextContent("OpenLLMetry");
    expect(screen.queryByTestId("llm-summary-tiles")).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-conversations-chips").parentElement).toHaveClass("hidden");

    fireEvent.click(screen.getByTestId("llm-conversations-setup"));

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/documentation`,
    );
    expect(within(empty).getByText("Usage tab").closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/llm/usage`,
    );
  });

  test("an empty week offers the past month", async () => {
    server.summary = summary({ conversationCount: 0, problemConversationCount: 0 });
    server.conversations = [];

    await openList();

    fireEvent.click(screen.getByTestId("llm-conversations-widen-range"));
    await settled(2);

    expect(urlParam("range")).toBe(TimeRange.PAST_ONE_MONTH);

    const body: JSONObject = lastBody();
    const days: number = Math.round(
      (new Date(body["endTime"] as string).getTime() -
        new Date(body["startTime"] as string).getTime()) /
        (24 * 60 * 60 * 1000),
    );

    expect(days).toBeGreaterThanOrEqual(28);
  });

  test("an empty month does not offer the month again", async () => {
    server.summary = summary({ conversationCount: 0, problemConversationCount: 0 });
    server.conversations = [];

    await openList(`?range=${TimeRange.PAST_ONE_MONTH}`);

    expect(screen.queryByTestId("llm-conversations-widen-range")).not.toBeInTheDocument();
  });

  test("a search that matches nothing offers to clear it", async () => {
    server.conversations = [];

    await openList(`?q=zzz&issue=refused&app=${APP_ID}`);

    expect(screen.getByText("No conversations match")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("llm-conversations-clear-filters"));
    await settled(2);

    expect(lastBody()["search"]).toBeUndefined();
    expect(lastBody()["issue"]).toBeUndefined();
    expect(lastBody()["serviceIds"]).toBeUndefined();
    expect(screen.getByTestId("llm-conversations-search")).toHaveValue("");
    expect(urlParam("q")).toBeNull();
    expect(urlParam("app")).toBeNull();
  });

  test("an error says what went wrong, and Try again re-counts", async () => {
    postSpy.mockImplementationOnce(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(403, { error: "You cannot read traces." }, {});
    });

    await openList();

    expect(screen.getByText("Couldn't load conversations")).toBeInTheDocument();
    expect(screen.getByText("You cannot read traces.")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("refresh-button"));
    await settled(2);

    expect(lastBody()["includeSummary"]).toBe(true);
    expect(screen.getAllByTestId("llm-conversation-row")).toHaveLength(2);
  });
});
