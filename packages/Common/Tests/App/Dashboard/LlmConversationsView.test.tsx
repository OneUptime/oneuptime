import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import {
  LLM_SETUP_CHECK_ROUTE,
  LlmMetricSource,
  LlmSetupCheckConnection,
  LlmSetupCheckResponse,
} from "../../../Types/Telemetry/LlmSetupCheckApi";

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
  // What /telemetry/llm/setup-check answers; null fails it.
  setupCheck: LlmSetupCheckResponse | null;
}

let server: ServerState;
let postSpy: ReturnType<typeof jest.spyOn>;
let navigateSpy: ReturnType<typeof jest.spyOn>;

// Whether a request is the setup check's (and not the list's).
function isSetupCheckCall(args: unknown): boolean {
  const url: string = String((args as { url: unknown }).url || "");

  try {
    return new URL(url).pathname.endsWith(LLM_SETUP_CHECK_ROUTE);
  } catch {
    return false;
  }
}

function listCalls(): Array<Array<unknown>> {
  return (postSpy.mock.calls as Array<Array<unknown>>).filter(
    (call: Array<unknown>): boolean => {
      return !isSetupCheckCall(call[0]);
    },
  );
}

function setupCheckCalls(): Array<Array<unknown>> {
  return (postSpy.mock.calls as Array<Array<unknown>>).filter(
    (call: Array<unknown>): boolean => {
      return isSetupCheckCall(call[0]);
    },
  );
}

function bodies(): Array<JSONObject> {
  return listCalls().map((call: Array<unknown>): JSONObject => {
    return (call[0] as { data: JSONObject }).data;
  });
}

// A setup check that found nothing at all.
function emptyCheck(
  overrides: Partial<LlmSetupCheckResponse> = {},
): LlmSetupCheckResponse {
  return {
    checkedAt: new Date().toISOString(),
    apps: {
      callsInWindow: 0,
      callsRecently: 0,
      newestCallAt: null,
      services: [],
      providers: [],
      answersRecently: 0,
      answersWithContent: 0,
      contentInLogs: null,
      uninstrumented: [],
    },
    metrics: [],
    connections: [],
    ...overrides,
  };
}

function connection(
  overrides: Partial<LlmSetupCheckConnection> = {},
): LlmSetupCheckConnection {
  return {
    connectionId: "6f1e2d3c-4b5a-4968-8776-000000000001",
    name: "Production OpenAI",
    provider: "openai",
    kind: "provider-account",
    isEnabled: true,
    lastReadAt: new Date().toISOString(),
    lastSuccessfulReadAt: new Date().toISOString(),
    lastError: "",
    newestUsageAt: null,
    resources: null,
    readSince: new Date(Date.now() - 30 * 86400000).toISOString(),
    callsRecently: null,
    ...overrides,
  };
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
    expect(
      screen.queryByTestId("llm-conversations-loading"),
    ).not.toBeInTheDocument();
  });
}

async function settled(requests: number): Promise<void> {
  await waitFor(() => {
    expect(listCalls()).toHaveLength(requests);
    expect(
      screen.queryByTestId("llm-conversations-loading"),
    ).not.toBeInTheDocument();
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
    setupCheck: emptyCheck(),
  };

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<never> => {
      const service: Service = new Service();
      service._id = APP_ID;
      service.name = "Support bot";

      return { data: [service], count: 1, skip: 0, limit: 1 } as never;
    });
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  postSpy = jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        args: unknown,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        if (isSetupCheckCall(args)) {
          return server.setupCheck
            ? new HTTPResponse<JSONObject>(
                200,
                server.setupCheck as unknown as JSONObject,
                {},
              )
            : new HTTPErrorResponse(500, { error: "Server Error" }, {});
        }

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

    expect(
      screen.getByTestId("llm-summary-conversations-value"),
    ).toHaveTextContent("120");
    expect(screen.getByTestId("llm-chip-all-count")).toHaveTextContent("120");
    expect(screen.getByTestId("llm-chip-any-count")).toHaveTextContent("6");
    expect(screen.getByTestId("llm-chip-refused-count")).toHaveTextContent("4");
    expect(screen.getByTestId("llm-chip-failed-count")).toHaveTextContent("2");
    // A problem no conversation had is not offered as a chip.
    expect(screen.queryByTestId("llm-chip-cut_off")).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-chip-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "llm-conversation-row",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Where should I go in May?");
    expect(rows[0]).toHaveTextContent("Support bot");
  });

  test("each row opens its conversation, with where to look for it", async () => {
    await openList();

    const href: string | null = screen
      .getAllByTestId("llm-conversation-row")[0]!
      .closest("a")!
      .getAttribute("href");

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
    expect(screen.getByTestId("llm-conversations-search")).toHaveValue(
      "refund",
    );
    expect(screen.getByTestId("llm-chip-refused")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
    expect(screen.getByTestId("llm-chip-any")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The numbers stay: they describe the time range, not the chip.
    expect(
      screen.getByTestId("llm-summary-conversations-value"),
    ).toHaveTextContent("120");
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

    expect(screen.getByTestId("llm-chip-cut_off")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
    ).toEqual([
      "Newest first",
      "Oldest first",
      "Most expensive",
      "Slowest answers",
      "Most calls",
    ]);
  });

  test("a search waits for typing to settle, then re-counts", async () => {
    await openList();

    fireEvent.change(screen.getByTestId("llm-conversations-search"), {
      target: { value: "  refund  " },
    });

    // Nothing is asked while typing.
    expect(listCalls()).toHaveLength(1);

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

    const select: HTMLElement = await screen.findByTestId(
      "llm-conversations-app",
    );

    expect(
      within(select).getByRole("option", { name: "All apps" }),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Support bot" }),
    ).toBeInTheDocument();

    fireEvent.change(select, { target: { value: APP_ID } });
    await settled(2);

    expect(lastBody()["serviceIds"]).toEqual([APP_ID]);
    expect(lastBody()["includeSummary"]).toBe(true);
    expect(urlParam("app")).toBe(APP_ID);
  });

  test("with no apps to choose from, there is no app filter", async () => {
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (): Promise<never> => {
        return { data: [], count: 0, skip: 0, limit: 0 } as never;
      });

    await openList();

    expect(
      screen.queryByTestId("llm-conversations-app"),
    ).not.toBeInTheDocument();
  });
});

describe("pages", () => {
  test("more than a page: where you are, and Next and Previous", async () => {
    server.hasMore = true;

    await openList();

    const pagination: HTMLElement = screen.getByTestId(
      "llm-conversations-pagination",
    );

    expect(pagination).toHaveTextContent("Showing 1–2 of 120");
    expect(screen.getByTestId("llm-conversations-previous")).toBeDisabled();

    fireEvent.click(screen.getByTestId("llm-conversations-next"));
    await settled(2);

    expect(lastBody()["skip"]).toBe(LLM_CONVERSATION_PAGE_SIZE);
    expect(lastBody()["includeSummary"]).toBe(false);
    expect(urlParam("page")).toBe("1");
    expect(
      screen.getByTestId("llm-conversations-pagination"),
    ).toHaveTextContent(
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

    expect(
      screen.getByTestId("llm-conversations-pagination"),
    ).toHaveTextContent("Showing 1–2 of 4");
  });

  test("one page is no pagination", async () => {
    await openList();

    expect(
      screen.queryByTestId("llm-conversations-pagination"),
    ).not.toBeInTheDocument();
  });
});

describe("when there is nothing to show", () => {
  test("the first time: no numbers, no chips - the ways conversations arrive", async () => {
    server.summary = summary({
      conversationCount: 0,
      problemConversationCount: 0,
      issueConversationCounts: emptyIssueCounts(),
    });
    server.conversations = [];

    await openList();

    await waitFor(() => {
      expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
        "from your own apps",
      );
    });

    const empty: HTMLElement = screen.getByTestId("llm-conversations-empty");

    expect(empty).toHaveTextContent("No AI conversations here yet");
    // Both ways in: your own apps, and the company's AI tools by name.
    expect(empty).toHaveTextContent("from your own apps");
    expect(empty).toHaveTextContent("Claude Enterprise");
    expect(empty).toHaveTextContent("Microsoft 365 Copilot");
    expect(screen.queryByTestId("llm-summary-tiles")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("llm-conversations-chips").parentElement,
    ).toHaveClass("hidden");

    const connect: HTMLElement = screen.getByTestId("llm-conversations-setup");

    // The way in is named for what it does, and opens Connect.
    expect(connect).toHaveTextContent("Connect AI");
    fireEvent.click(connect);

    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/connect`,
    );
    expect(within(empty).getByText("Usage tab").closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/llm/usage`,
    );
  });

  test("an empty week offers the past month", async () => {
    server.summary = summary({
      conversationCount: 0,
      problemConversationCount: 0,
    });
    server.conversations = [];

    await openList();

    fireEvent.click(await screen.findByTestId("llm-conversations-widen-range"));
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
    server.summary = summary({
      conversationCount: 0,
      problemConversationCount: 0,
    });
    server.conversations = [];

    await openList(`?range=${TimeRange.PAST_ONE_MONTH}`);

    await waitFor(() => {
      expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
        "from your own apps",
      );
    });

    expect(
      screen.queryByTestId("llm-conversations-widen-range"),
    ).not.toBeInTheDocument();
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
      return new HTTPErrorResponse(
        403,
        { error: "You cannot read traces." },
        {},
      );
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

/*
 * WHY THE LIST IS EMPTY, FOR THIS PROJECT (#5776).
 *
 * A project whose OpenAI and Azure OpenAI accounts were connected and
 * working saw "No AI conversations here yet" and a description of where
 * conversations come from in general. The empty list now asks the
 * project's setup check and leads with what it found, and the one next
 * step it calls for.
 */
describe("an empty list says why, from the setup check", () => {
  beforeEach(() => {
    server.summary = summary({
      conversationCount: 0,
      problemConversationCount: 0,
      issueConversationCounts: emptyIssueCounts(),
    });
    server.conversations = [];
  });

  async function diagnosis(): Promise<HTMLElement> {
    await waitFor(() => {
      expect(
        screen.getByTestId("llm-conversations-diagnosis"),
      ).not.toHaveTextContent("Checking what your AI is sending");
    });

    return screen.getByTestId("llm-conversations-diagnosis");
  }

  async function checked(): Promise<void> {
    await waitFor(() => {
      expect(
        screen.getByTestId("llm-conversations-empty"),
      ).not.toHaveTextContent("Checking what your AI is sending");
    });
  }

  test("the check is asked for the list's own window, once the list is empty", async () => {
    await openList();
    await checked();

    expect(setupCheckCalls()).toHaveLength(1);

    const check: JSONObject = (setupCheckCalls()[0]![0] as { data: JSONObject })
      .data;
    const list: JSONObject = bodies()[0]!;

    expect(
      Math.abs(
        new Date(check["startTime"] as string).getTime() -
          new Date(list["startTime"] as string).getTime(),
      ),
    ).toBeLessThan(60_000);
    expect(
      Math.abs(
        new Date(check["endTime"] as string).getTime() -
          new Date(list["endTime"] as string).getTime(),
      ),
    ).toBeLessThan(60_000);
  });

  test("a list with conversations never asks", async () => {
    server.summary = summary();
    server.conversations = [listItem({ key: "c:chat-1" })];

    await openList();

    expect(setupCheckCalls()).toHaveLength(0);
  });

  test("a filtered list that matches nothing never asks: the filter is why", async () => {
    await openList("?q=zzz");

    expect(screen.getByText("No conversations match")).toBeInTheDocument();
    expect(setupCheckCalls()).toHaveLength(0);
  });

  test("while the check reads, the list says it is checking", async () => {
    let release: (() => void) | undefined;

    postSpy.mockImplementation(
      async (
        args: unknown,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        if (isSetupCheckCall(args)) {
          await new Promise<void>((resolve: () => void) => {
            release = resolve;
          });

          return new HTTPResponse<JSONObject>(
            200,
            emptyCheck() as unknown as JSONObject,
            {},
          );
        }

        return new HTTPResponse<JSONObject>(
          200,
          {
            summary: server.summary as unknown as JSONObject,
            conversations: [],
            hasMore: false,
          } as JSONObject,
          {},
        );
      },
    );

    await openList();

    expect(
      await screen.findByTestId("llm-conversations-diagnosis"),
    ).toHaveTextContent("Checking what your AI is sending");

    await waitFor(() => {
      expect(release).toBeDefined();
    });
    release!();

    await waitFor(() => {
      expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
        "from your own apps",
      );
    });
  });

  test("connected provider accounts and no app calls: they bring usage, not conversations", async () => {
    server.setupCheck = emptyCheck({
      connections: [
        connection(),
        connection({
          connectionId: "6f1e2d3c-4b5a-4968-8776-000000000002",
          name: "Production Azure",
          provider: "azure-openai",
          resources: 3,
        }),
      ],
    });

    await openList();

    const text: HTMLElement = await diagnosis();
    const empty: HTMLElement = screen.getByTestId("llm-conversations-empty");

    expect(empty).toHaveTextContent("Conversations come from your apps");
    expect(text).toHaveTextContent(
      "Your 2 connected provider accounts report usage and cost by day, never a call or a conversation.",
    );
    expect(text).toHaveTextContent(
      "none has sent an AI call in the past 7 days",
    );

    fireEvent.click(screen.getByTestId("llm-empty-send-calls"));
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/connect?way=apps`,
    );

    fireEvent.click(screen.getByTestId("llm-empty-see-provider-usage"));
    expect(String(navigateSpy.mock.calls[1]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/usage?source=providers`,
    );
  });

  test("one connected account reads in the singular", async () => {
    server.setupCheck = emptyCheck({ connections: [connection()] });

    await openList();

    expect(await diagnosis()).toHaveTextContent(
      "Your connected provider account reports usage and cost by day",
    );
  });

  test("a turned-off account is not counted", async () => {
    server.setupCheck = emptyCheck({
      connections: [connection({ isEnabled: false })],
    });

    await openList();
    await checked();

    expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
      "from your own apps",
    );
  });

  test("calls just outside the range: when the newest was, and the range that holds it", async () => {
    server.setupCheck = emptyCheck({
      apps: {
        ...emptyCheck().apps!,
        callsInWindow: 0,
        newestCallAt: new Date(Date.now() - 12 * 86400000).toISOString(),
      },
    });

    await openList();

    const text: HTMLElement = await diagnosis();

    expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
      "No conversations in this time range",
    );
    expect(text).toHaveTextContent("Your apps' newest AI call was");

    const widen: HTMLElement = screen.getByTestId("llm-empty-widen-range");

    expect(widen).toHaveTextContent("Show the past month");
    fireEvent.click(widen);
    await settled(2);

    expect(urlParam("range")).toBe(TimeRange.PAST_ONE_MONTH);
  });

  test("a call older than three months widens to a range from the day before it", async () => {
    server.setupCheck = emptyCheck({
      apps: {
        ...emptyCheck().apps!,
        callsInWindow: 0,
        newestCallAt: new Date(Date.now() - 120 * 86400000).toISOString(),
      },
    });

    await openList();
    await diagnosis();

    expect(screen.getByTestId("llm-empty-widen-range")).toHaveTextContent(
      "Show from",
    );

    fireEvent.click(screen.getByTestId("llm-empty-widen-range"));
    await settled(2);

    const body: JSONObject = lastBody();
    const days: number =
      (new Date(body["endTime"] as string).getTime() -
        new Date(body["startTime"] as string).getTime()) /
      86400000;

    expect(days).toBeGreaterThanOrEqual(120);
    expect(days).toBeLessThan(123);
  });

  test("an app calls Azure OpenAI and nothing records it: add an instrumentation", async () => {
    server.setupCheck = emptyCheck({
      apps: {
        ...emptyCheck().apps!,
        uninstrumented: [
          {
            serviceId: APP_ID,
            host: "contoso.openai.azure.com",
            provider: "azure.ai.openai",
            calls: 1240,
          },
        ],
      },
      connections: [connection()],
    });

    await openList();

    const text: HTMLElement = await diagnosis();

    expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
      "Your app's AI calls aren't recorded",
    );
    // The app by its name, the host it called, how often.
    expect(text).toHaveTextContent(
      "Support bot called contoso.openai.azure.com",
    );
    // The count as the reader's language writes it.
    expect(text).toHaveTextContent("1,240 times in the past day");

    fireEvent.click(screen.getByTestId("llm-empty-send-calls"));
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/connect?way=apps`,
    );
  });

  test("an app the reader cannot name is one of your apps", async () => {
    server.setupCheck = emptyCheck({
      apps: {
        ...emptyCheck().apps!,
        uninstrumented: [
          {
            serviceId: "6f1e2d3c-4b5a-4968-8776-999999999999",
            host: "api.openai.com",
            provider: "openai",
            calls: 1,
          },
        ],
      },
    });

    await openList();

    expect(await diagnosis()).toHaveTextContent(
      "One of your apps called api.openai.com once in the past day",
    );
  });

  test("coding assistants send usage: see it on Usage", async () => {
    server.setupCheck = emptyCheck({
      metrics: [
        {
          source: LlmMetricSource.ClaudeCode,
          points: 900,
          newestAt: new Date().toISOString(),
        },
        {
          source: LlmMetricSource.Codex,
          points: 20,
          newestAt: new Date().toISOString(),
        },
      ],
    });

    await openList();

    expect(await diagnosis()).toHaveTextContent(
      "Claude Code and Codex send usage metrics, which show on Usage.",
    );

    fireEvent.click(screen.getByTestId("llm-empty-see-usage"));
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/usage`,
    );
  });

  test("the conventions' own metrics alone are no coding assistant", async () => {
    server.setupCheck = emptyCheck({
      metrics: [
        {
          source: LlmMetricSource.GenAi,
          points: 40,
          newestAt: new Date().toISOString(),
        },
      ],
    });

    await openList();
    await checked();

    expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
      "from your own apps",
    );
  });

  test("a company AI tool that is quiet: its chats arrive as people use it", async () => {
    server.setupCheck = emptyCheck({
      connections: [
        connection({
          name: "Claude for the company",
          provider: "claude-enterprise",
          kind: "company-tool",
          callsRecently: 0,
          readSince: null,
        }),
        connection(),
      ],
    });

    await openList();

    expect(await diagnosis()).toHaveTextContent(
      "Claude Enterprise is connected and read every 15 minutes",
    );
    expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
      "No chats in this time range",
    );
  });

  test("a company AI tool whose last read failed says so, and opens Connect", async () => {
    const earlier: string = new Date(Date.now() - 3600000).toISOString();

    server.setupCheck = emptyCheck({
      connections: [
        connection({
          name: "Copilot",
          provider: "microsoft-365-copilot",
          kind: "company-tool",
          lastSuccessfulReadAt: earlier,
          lastReadAt: new Date().toISOString(),
          lastError: "The client secret has expired.",
          callsRecently: 0,
        }),
      ],
    });

    await openList();
    await diagnosis();

    expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
      "Microsoft 365 Copilot isn't working",
    );

    fireEvent.click(screen.getByTestId("llm-empty-open-connect"));
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/connect`,
    );
  });

  test("a check that cannot be read leaves the page as it always was", async () => {
    server.setupCheck = null;

    await openList();

    await waitFor(() => {
      expect(screen.getByTestId("llm-conversations-empty")).toHaveTextContent(
        "from your own apps",
      );
    });
    expect(screen.getByTestId("llm-conversations-setup")).toHaveTextContent(
      "Connect AI",
    );
  });
});
