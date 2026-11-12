import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { ProductAnalyticsDerivedMetric } from "../../../Types/Rum/ProductAnalyticsEvents";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { XAxis as ChartXAxis } from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";
import { getJestSpyOn } from "../../Spy";

/*
 * Product Analytics > Events (Pages/Rum/View/ProductAnalyticsEvents.tsx),
 * rendered against mocked reads (issue #6444, part two): it opens on the
 * application's most frequent event of its own; the tiles, the chart and
 * the breakdown say what the reads say; a breakdown row narrows the
 * segment, a row of All events opens that event, and each choice is kept
 * in the address. Before there is anything to read it says why: events off,
 * with the switch, or none sent yet, with the two calls that send them.
 */

const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const lineChartMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

/* recharts draws nothing in jsdom: the chart is checked by the lines it is handed. */
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: {
      data: Array<{ seriesName: string; data: Array<unknown> }>;
    }) => {
      lineChartMock(props);

      return (
        <div data-testid="line-chart">
          {props.data
            .map((series: { seriesName: string }) => {
              return series.seriesName;
            })
            .join(",")}
        </div>
      );
    },
  };
});

import RumApplicationProductAnalyticsEvents, {
  PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS,
  buildProductAnalyticsEventTiles,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsEvents";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { createTranslator } from "../../../Types/Translator";

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-events`;
const DAY_MS: number = 24 * 60 * 60 * 1000;

type Answer = JSONObject | HTTPErrorResponse;

interface Answers {
  names: Answer;
  trend: Answer;
  breakdown: Answer | ((data: JSONObject) => Answer);
  properties: Answer;
}

interface CapturedRequest {
  url: string;
  data: JSONObject;
}

function requestsTo(route: string): Array<CapturedRequest> {
  return postMock.mock.calls
    .map((call: Array<unknown>): CapturedRequest => {
      const request: { url: { toString: () => string }; data: JSONObject } =
        call[0] as { url: { toString: () => string }; data: JSONObject };

      return { url: request.url.toString(), data: request.data };
    })
    .filter((request: CapturedRequest): boolean => {
      return request.url.endsWith(`/product-analytics/${route}`);
    });
}

function lastRequestTo(route: string): JSONObject {
  const requests: Array<CapturedRequest> = requestsTo(route);

  return requests[requests.length - 1]!.data;
}

function names(overrides?: JSONObject): JSONObject {
  return {
    events: [
      { kind: "session", name: "", events: 900, users: 300, lastSeenAt: 1 },
      {
        kind: "page",
        name: "/pricing",
        events: 400,
        users: 200,
        lastSeenAt: 1,
      },
      {
        kind: "custom",
        name: "Signed up",
        events: 120,
        users: 100,
        lastSeenAt: 1,
      },
      { kind: "custom", name: "Search", events: 80, users: 20, lastSeenAt: 1 },
    ],
    hasMore: false,
    /* Counting began long before the range: no note. */
    dataStartedAt: Date.now() - 200 * DAY_MS,
    ...overrides,
  };
}

function trend(): JSONObject {
  return {
    timeZone: "UTC",
    days: [
      { day: "2026-09-01", events: 60, users: 50 },
      { day: "2026-09-02", events: 60, users: 55 },
    ],
    totalEvents: 120,
    totalUsers: 100,
    totalSessions: 110,
  };
}

function breakdown(data?: JSONObject): JSONObject {
  const asked: JSONObject = (data?.["breakdown"] as JSONObject) || {
    field: "deviceType",
    key: "",
  };

  if (asked["field"] === "property") {
    return {
      ...asked,
      rows: [
        { value: "pro", events: 90, users: 70 },
        { value: "", events: 30, users: 30 },
      ],
      hasMore: true,
      totalEvents: 120,
      totalUsers: 100,
    };
  }

  return {
    field: "deviceType",
    key: "",
    rows: [
      { value: "desktop", events: 80, users: 70 },
      { value: "mobile", events: 40, users: 30 },
    ],
    hasMore: false,
    totalEvents: 120,
    totalUsers: 100,
  };
}

function respond(answer: Answer): Promise<unknown> {
  if (answer instanceof HTTPErrorResponse) {
    return Promise.resolve(answer);
  }

  return Promise.resolve(new HTTPResponse<JSONObject>(200, answer, {}));
}

function mockReads(answers: Partial<Answers>): void {
  const all: Answers = {
    names: names(),
    trend: trend(),
    breakdown: breakdown,
    properties: { propertyKeys: ["plan"], userPropertyKeys: ["role"] },
    ...answers,
  };

  postMock.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: { url: { toString: () => string }; data: JSONObject } =
      args[0] as { url: { toString: () => string }; data: JSONObject };
    const url: string = request.url.toString();

    if (url.endsWith("/product-analytics/event-names")) {
      return respond(all.names);
    }

    if (url.endsWith("/product-analytics/event-trend")) {
      return respond(all.trend);
    }

    if (url.endsWith("/product-analytics/event-breakdown")) {
      return respond(
        typeof all.breakdown === "function"
          ? all.breakdown(request.data)
          : all.breakdown,
      );
    }

    if (url.endsWith("/product-analytics/event-properties")) {
      return respond(all.properties);
    }

    return Promise.reject(new Error(`Unexpected read ${url}`));
  });
}

function mockApplication(application: {
  isProductAnalyticsEnabled: boolean;
  isSessionReplayEnabled?: boolean;
}): void {
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      isSessionReplayEnabled: true,
      ...application,
    });
  });
}

function renderPage(search?: string): ReturnType<typeof render> {
  window.history.replaceState(null, "", `${PAGE_PATH}${search || ""}`);

  return render(
    <MemoryRouter>
      <RumApplicationProductAnalyticsEvents
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

function tileTexts(): Array<string> {
  return Array.from(
    screen
      .getByTestId("product-analytics-event-tiles")
      .querySelectorAll("[aria-busy]"),
  ).map((tile: Element): string => {
    return (tile.textContent || "").replace(/\s+/g, " ").trim();
  });
}

async function waitForTiles(total: string): Promise<Array<string>> {
  await waitFor(() => {
    expect(tileTexts()[0]).toContain(total);
  });

  return tileTexts();
}

function rowTexts(testId: string): Array<string> {
  return screen
    .getAllByTestId(`${testId}-row`)
    .map((row: HTMLElement): string => {
      return Array.from(row.querySelectorAll("[role='cell']"))
        .map((cell: Element): string => {
          return (cell.textContent || "").trim();
        })
        .join(" | ");
    });
}

async function waitForRows(
  testId: string,
  count: number,
): Promise<Array<string>> {
  await waitFor(() => {
    expect(screen.getAllByTestId(`${testId}-row`)).toHaveLength(count);
  });

  return rowTexts(testId);
}

function headersOf(testId: string): Array<string> {
  return within(screen.getByTestId(testId))
    .getAllByRole("columnheader")
    .map((header: HTMLElement): string => {
      return header.textContent || "";
    });
}

function selectRow(testId: string, label: string): void {
  const button: HTMLElement | undefined = screen
    .getAllByTestId(`${testId}-select`)
    .find((candidate: HTMLElement): boolean => {
      return candidate.textContent === label;
    });

  expect(button).toBeDefined();
  fireEvent.click(button!);
}

async function chooseOption(
  comboboxName: string,
  optionText: string,
): Promise<void> {
  fireEvent.keyDown(screen.getByRole("combobox", { name: comboboxName }), {
    key: "ArrowDown",
  });

  const option: HTMLElement | undefined = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim() === optionText;
    });

  expect(option).toBeDefined();

  await act(async () => {
    fireEvent.mouseDown(option!);
    fireEvent.click(option!);
  });
}

function searchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/* The time axis each drawing of a chart asked for, first to last. */
function chartAxes(): Array<ChartXAxis> {
  return lineChartMock.mock.calls.map((call: Array<unknown>): ChartXAxis => {
    return (call[0] as { xAxis: ChartXAxis }).xAxis;
  });
}

beforeEach(() => {
  postMock.mockReset();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  lineChartMock.mockReset();
  mockApplication({ isProductAnalyticsEnabled: true });
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  window.scrollTo = (() => {}) as typeof window.scrollTo;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProductAnalyticsEvents: the event", () => {
  it("opens on the application's most frequent event of its own and reads it in the range, the segment and the reader's zone", async () => {
    mockReads({});

    renderPage();

    await waitForTiles("120");

    const trendRequest: JSONObject = lastRequestTo("event-trend");
    const namesRequest: JSONObject = lastRequestTo("event-names");

    expect(trendRequest["event"]).toEqual({
      kind: "custom",
      name: "Signed up",
    });
    expect(trendRequest["filters"]).toEqual([]);
    expect(typeof trendRequest["timeZone"]).toBe("string");
    expect(trendRequest["rumApplicationId"]).toBe(APP_ID);
    /* The same window for every read. */
    expect(trendRequest["startTime"]).toBe(namesRequest["startTime"]);
    expect(trendRequest["endTime"]).toBe(namesRequest["endTime"]);
    expect(lastRequestTo("event-breakdown")["breakdown"]).toEqual({
      field: "deviceType",
      key: "",
    });
    expect(lastRequestTo("event-properties")["event"]).toEqual({
      kind: "custom",
      name: "Signed up",
    });
    /* A default is never written into the address. */
    expect(window.location.search).toBe("");
    /* The picker is named on the page, not only to a screen reader. */
    expect(
      within(screen.getByTestId("product-analytics-events-page")).getByText(
        "Event",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Event" })).toBeInTheDocument();
  });

  it("says how often it happened, by how many, in how many sessions, and how often each person did it", async () => {
    mockReads({});

    renderPage();

    const tiles: Array<string> = await waitForTiles("120");

    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toContain("Events");
    expect(tiles[0]).toContain("1.2 per user");
    expect(tiles[1]).toContain("Users");
    expect(tiles[1]).toContain("100");
    expect(tiles[2]).toContain("Sessions");
    expect(tiles[2]).toContain("110");

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toHaveTextContent(
        "Events,Users",
      );
    });
  });

  it("its chart asks for a day axis: its ticks name days, never clock times", async () => {
    // One point a day (issue #6564).
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toHaveTextContent(
        "Events,Users",
      );
    });

    const axes: Array<ChartXAxis> = chartAxes();

    expect(axes.length).toBeGreaterThan(0);
    for (const axis of axes) {
      expect(axis.options.type).toBe(XAxisType.Time);
      expect(axis.options.precision).toBe(XAxisPrecision.EVERY_DAY);
    }
  });

  it("an event nobody did has no per-user line, and an unread trend shows dashes", () => {
    const english: ReturnType<typeof createTranslator> = createTranslator(
      undefined,
      "en",
    );
    const empty: Array<{ value: string; sublabel?: string | undefined }> =
      buildProductAnalyticsEventTiles({
        trend: {
          timeZone: "UTC",
          days: [],
          totalEvents: 0,
          totalUsers: 0,
          totalSessions: 0,
        },
        isLoading: false,
        translator: english,
      });

    expect(empty[0]!.value).toBe("0");
    expect(empty[0]!.sublabel).toBeUndefined();

    const unread: Array<{ value: string; loading?: boolean | undefined }> =
      buildProductAnalyticsEventTiles({
        trend: null,
        isLoading: true,
        translator: english,
      });

    expect(
      unread.map((tile: { value: string }): string => {
        return tile.value;
      }),
    ).toEqual(["-", "-", "-"]);
    expect(unread[0]!.loading).toBe(true);
  });

  it("picking another event reads it and keeps it in the address", async () => {
    mockReads({});

    renderPage();

    await waitForTiles("120");
    await chooseOption("Event", "Search");

    await waitFor(() => {
      expect(lastRequestTo("event-trend")["event"]).toEqual({
        kind: "custom",
        name: "Search",
      });
    });
    expect(searchParams().get("event")).toBe("custom:Search");
  });

  it("opens the event the address names, in its segment, broken down its way", async () => {
    mockReads({});

    renderPage(
      `?event=${encodeURIComponent("page:/pricing")}&by=country&segment=${encodeURIComponent(
        JSON.stringify([{ field: "country", key: "", value: "DE" }]),
      )}`,
    );

    await waitForTiles("120");

    expect(lastRequestTo("event-trend")["event"]).toEqual({
      kind: "page",
      name: "/pricing",
    });
    expect(lastRequestTo("event-trend")["filters"]).toEqual([
      { field: "country", key: "", value: "DE" },
    ]);
    expect(lastRequestTo("event-breakdown")["breakdown"]).toEqual({
      field: "country",
      key: "",
    });
    expect(
      screen.getByTestId("product-analytics-event-segment-filter"),
    ).toHaveTextContent("Country is Germany");
  });
});

describe("ProductAnalyticsEvents: breakdown and segment", () => {
  it("lists each value with its events, its people and its share", async () => {
    mockReads({});

    renderPage();

    expect(
      await waitForRows("product-analytics-event-breakdown-bars", 2),
    ).toEqual(["Desktop | 80 | 70 | 67%", "Mobile | 40 | 30 | 33%"]);
    /*
     * The share is titled Percent, as the Sessions breakdown titles it:
     * the bare word Share is a button's in every other language.
     */
    expect(headersOf("product-analytics-event-breakdown-bars")).toEqual([
      "Device type",
      "Events",
      "Users",
      "Percent",
    ]);
  });

  it("a value's row narrows the segment to it: every read again, the chip and the address", async () => {
    mockReads({});

    renderPage();

    await waitForRows("product-analytics-event-breakdown-bars", 2);
    selectRow("product-analytics-event-breakdown-bars", "Desktop");

    const desktop: JSONObject = {
      field: "deviceType",
      key: "",
      value: "desktop",
    };

    await waitFor(() => {
      expect(lastRequestTo("event-trend")["filters"]).toEqual([desktop]);
    });
    expect(lastRequestTo("event-breakdown")["filters"]).toEqual([desktop]);
    expect(
      screen.getByTestId("product-analytics-event-segment-filter"),
    ).toHaveTextContent("Device type is Desktop");
    expect(JSON.parse(searchParams().get("segment")!)).toEqual([desktop]);

    /* Its way out takes the page back to everyone. */
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Device type is Desktop" }),
    );

    await waitFor(() => {
      expect(lastRequestTo("event-trend")["filters"]).toEqual([]);
    });
    expect(searchParams().has("segment")).toBe(false);
    expect(
      screen.getByTestId("product-analytics-event-segment-everyone"),
    ).toHaveTextContent("Everyone");
  });

  it("breaks down by a property the event carried, and says when only the most frequent values are listed", async () => {
    mockReads({});

    renderPage();

    await waitForRows("product-analytics-event-breakdown-bars", 2);
    await chooseOption("Break down by", "Event property: plan");

    await waitFor(() => {
      expect(lastRequestTo("event-breakdown")["breakdown"]).toEqual({
        field: "property",
        key: "plan",
      });
    });
    await waitFor(() => {
      expect(rowTexts("product-analytics-event-breakdown-bars")).toEqual([
        "pro | 90 | 70 | 75%",
        "Not reported | 30 | 30 | 25%",
      ]);
    });
    expect(
      screen.getByText("Only the most frequent values are listed."),
    ).toBeInTheDocument();
    expect(searchParams().get("by")).toBe("property:plan");
  });

  it("offers every plain field, then the event's properties, then the people's", async () => {
    mockReads({});

    renderPage();

    await waitForRows("product-analytics-event-breakdown-bars", 2);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Break down by" }), {
      key: "ArrowDown",
    });

    expect(
      screen.getAllByRole("option").map((option: HTMLElement): string => {
        return (option.textContent || "").trim();
      }),
    ).toEqual([
      "Device type",
      "Browser",
      "Operating system",
      "Country",
      "App version",
      "Page",
      "Event property: plan",
      "User property: role",
    ]);
  });

  it("a segment typed by a country's name matches its code", async () => {
    mockReads({});

    renderPage();

    await waitForTiles("120");
    fireEvent.click(screen.getByTestId("product-analytics-event-segment-open"));
    await chooseOption("Field", "Country");
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), {
      target: { value: "Germany" },
    });
    fireEvent.click(screen.getByTestId("product-analytics-event-segment-add"));

    await waitFor(() => {
      expect(lastRequestTo("event-trend")["filters"]).toEqual([
        { field: "country", key: "", value: "DE" },
      ]);
    });
  });

  it("says so when the event did not happen in the segment", async () => {
    mockReads({
      breakdown: {
        field: "deviceType",
        key: "",
        rows: [],
        hasMore: false,
        totalEvents: 0,
        totalUsers: 0,
      },
    });

    renderPage();

    expect(
      await screen.findByText(
        "Nothing to break down: the event did not happen in this range and segment.",
      ),
    ).toBeInTheDocument();
  });
});

describe("ProductAnalyticsEvents: all events", () => {
  it("lists every event, the most frequent first, the open one marked; a row opens its event", async () => {
    mockReads({ names: names({ hasMore: true }) });

    renderPage();

    expect(await waitForRows("product-analytics-event-list-bars", 4)).toEqual([
      "Session started | 900 | 300",
      "Viewed /pricing | 400 | 200",
      "Signed up | 120 | 100",
      "Search | 80 | 20",
    ]);
    expect(headersOf("product-analytics-event-list-bars")).toEqual([
      "Event",
      "Events",
      "Users",
    ]);
    expect(
      screen
        .getAllByTestId("product-analytics-event-list-bars-select")
        .map((button: HTMLElement): string | null => {
          return button.getAttribute("aria-pressed");
        }),
    ).toEqual(["false", "false", "true", "false"]);
    expect(
      screen.getByText("Only the most frequent events are listed."),
    ).toBeInTheDocument();

    selectRow("product-analytics-event-list-bars", "Viewed /pricing");

    await waitFor(() => {
      expect(lastRequestTo("event-trend")["event"]).toEqual({
        kind: "page",
        name: "/pricing",
      });
    });
    expect(searchParams().get("event")).toBe("page:/pricing");
  });

  it("folds a long list after ten, the most frequent first, and opens it whole", async () => {
    const many: Array<JSONObject> = Array.from(
      { length: PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS + 3 },
      (_value: unknown, index: number): JSONObject => {
        return {
          kind: "custom",
          name: `Step ${index + 1}`,
          events: 1000 - index,
          users: 10,
          lastSeenAt: 1,
        };
      },
    );

    mockReads({ names: names({ events: many, hasMore: true }) });

    renderPage();

    const folded: Array<string> = await waitForRows(
      "product-analytics-event-list-bars",
      PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS,
    );

    expect(folded[0]).toBe("Step 1 | 1,000 | 10");

    const toggle: HTMLElement = screen.getByTestId(
      "product-analytics-event-list-toggle",
    );

    expect(toggle).toHaveTextContent("Show 3 more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    /* Folded, the toggle says what is left; the cap is said under the whole list. */
    expect(
      screen.queryByText("Only the most frequent events are listed."),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(
      (
        await waitForRows(
          "product-analytics-event-list-bars",
          PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS + 3,
        )
      ).slice(-1),
    ).toEqual(["Step 13 | 988 | 10"]);
    expect(toggle).toHaveTextContent("Show fewer");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("Only the most frequent events are listed."),
    ).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitForRows(
      "product-analytics-event-list-bars",
      PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS,
    );
  });

  it("a list of ten or fewer has nothing to fold", async () => {
    mockReads({});

    renderPage();

    await waitForRows("product-analytics-event-list-bars", 4);
    expect(
      screen.queryByTestId("product-analytics-event-list-toggle"),
    ).not.toBeInTheDocument();
  });

  it("says where else the events go: the metric each is counted as, and a link to Metrics", async () => {
    mockReads({});

    renderPage();

    const note: HTMLElement = await screen.findByTestId(
      "product-analytics-metrics-note",
    );

    expect(note).toHaveTextContent(ProductAnalyticsDerivedMetric.Events);
    /* The metric's name is drawn as code, left to right, as it is typed. */
    expect(
      within(note).getByText(ProductAnalyticsDerivedMetric.Events).tagName,
    ).toBe("CODE");
    expect(
      within(note).getByRole("link", { name: "Open Metrics" }),
    ).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUM_APPLICATION_VIEW_METRICS] as Route,
        { modelId: new ObjectID(APP_ID) },
      ).toString(),
    );
  });
});

describe("ProductAnalyticsEvents: before there is anything to read", () => {
  it("events on and none sent yet: the two calls that send them, and nothing else", async () => {
    mockReads({ names: names({ events: [], dataStartedAt: null }) });

    renderPage();

    expect(await screen.findByText("No events yet")).toBeInTheDocument();
    /*
     * What arrives on its own, and what the code sends, in one line on a
     * phone: an empty state's words are at most 150 characters (issue #6660).
     */
    const said: string =
      "Session starts and page views arrive on their own wherever the browser recorder runs. To count what people do, send events and numbers from your app:";

    expect(screen.getByText(said)).toBeInTheDocument();
    expect(said.length).toBeLessThanOrEqual(150);
    expect(
      screen.getByTestId("product-analytics-events-snippet"),
    ).toHaveTextContent('OneUptimeReplay.track("Signed up", { plan: "pro" });');
    expect(
      screen.getByTestId("product-analytics-events-snippet"),
    ).toHaveTextContent("OneUptimeReplay.metric(");
    expect(
      screen.getByRole("link", { name: "How to send events and metrics" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("product-analytics-events-replay-off"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("All events")).not.toBeInTheDocument();
    expect(requestsTo("event-trend")).toHaveLength(0);
  });

  it("with Session Replay off, says its recorder is what sends them", async () => {
    mockApplication({
      isProductAnalyticsEnabled: true,
      isSessionReplayEnabled: false,
    });
    mockReads({ names: names({ events: [], dataStartedAt: null }) });

    renderPage();

    expect(
      await screen.findByTestId("product-analytics-events-replay-off"),
    ).toHaveTextContent("Session Replay is off for this application");
  });

  it("events off and nothing kept: what turning them on does, and the switch that does it", async () => {
    mockApplication({ isProductAnalyticsEnabled: false });
    mockReads({ names: names({ events: [], dataStartedAt: null }) });
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return Promise.resolve({});
    });

    renderPage();

    const off: HTMLElement = await screen.findByTestId(
      "product-analytics-events-off",
    );

    expect(off).toHaveTextContent(
      "Turn them on to count session starts, page views and track() events.",
    );
    expect(screen.queryByText("No events yet")).not.toBeInTheDocument();

    const toggle: HTMLElement = within(off).getByRole("switch", {
      name: "Send product analytics events",
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: JSONObject }).data,
    ).toEqual({ isProductAnalyticsEnabled: true });
    /*
     * Saved: the page says how to send them, under the switch, which stays
     * - on, and saying so - so the press shows what it did and can be
     * taken back.
     */
    expect(await screen.findByText("No events yet")).toBeInTheDocument();
    expect(screen.getByTestId("product-analytics-events-off")).toBe(off);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId("product-analytics-events-off-switch-status"),
    ).toHaveTextContent("Saved");
    expect(off).toHaveTextContent(
      "Sends session starts, page views, track() and metric() calls from every session, recorded or not.",
    );
  });

  it("while the switch is read, an application with nothing kept says nothing of events yet", async () => {
    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise((): void => {});
    });
    mockReads({ names: names({ events: [], dataStartedAt: null }) });

    renderPage();

    expect(
      await screen.findByTestId("product-analytics-nothing-kept"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No events yet")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("product-analytics-events-off"),
    ).not.toBeInTheDocument();
  });

  it("events turned off after some were kept: the switch above what is kept", async () => {
    mockApplication({ isProductAnalyticsEnabled: false });
    mockReads({});

    renderPage();

    await waitForTiles("120");

    const page: HTMLElement = screen.getByTestId(
      "product-analytics-events-page",
    );

    expect(
      within(page).getByTestId("product-analytics-events-off"),
    ).toBeInTheDocument();
    expect(page.firstElementChild?.getAttribute("data-testid")).toBe(
      "product-analytics-events-off",
    );

    /* Turned back on here, the switch stays above what is kept, on. */
    const toggle: HTMLElement = within(page).getByRole("switch", {
      name: "Send product analytics events",
    });

    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });
    expect(
      within(page).getByTestId("product-analytics-events-off-switch-status"),
    ).toHaveTextContent("Saved");
    expect(page.firstElementChild?.getAttribute("data-testid")).toBe(
      "product-analytics-events-off",
    );
  });

  it("while the events' names are read, the picker says so, and the tiles and the breakdown wait rather than show nothing", async () => {
    mockReads({});

    const answer: (...args: Array<unknown>) => unknown =
      postMock.getMockImplementation() as (...args: Array<unknown>) => unknown;
    let answerNames: () => void = (): void => {};

    postMock.mockImplementation((...args: Array<unknown>): unknown => {
      const url: string = (
        args[0] as { url: { toString: () => string } }
      ).url.toString();

      if (url.endsWith("/product-analytics/event-names")) {
        return new Promise((resolve: (value: unknown) => void): void => {
          answerNames = (): void => {
            resolve(answer(...args));
          };
        });
      }

      return answer(...args);
    });

    renderPage();

    const picker: HTMLElement = await screen.findByRole("combobox", {
      name: "Event",
    });

    expect(
      within(screen.getByTestId("product-analytics-events-page")).getByText(
        "Loading events...",
      ),
    ).toBeInTheDocument();
    expect(picker).toBeInTheDocument();
    expect(
      Array.from(
        screen
          .getByTestId("product-analytics-event-tiles")
          .querySelectorAll("[aria-busy]"),
      ).map((tile: Element): string | null => {
        return tile.getAttribute("aria-busy");
      }),
    ).toEqual(["true", "true", "true"]);
    expect(
      screen.getByTestId("product-analytics-event-breakdown-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("product-analytics-event-breakdown-bars"),
    ).not.toBeInTheDocument();

    await act(async () => {
      answerNames();
    });

    await waitForTiles("120");
    expect(screen.queryByText("Loading events...")).not.toBeInTheDocument();
    await waitForRows("product-analytics-event-breakdown-bars", 2);
    expect(
      screen.queryByTestId("product-analytics-event-breakdown-loading"),
    ).not.toBeInTheDocument();
  });

  it("a refused read says why, with a way to try again, and no list", async () => {
    mockReads({
      names: new HTTPErrorResponse(
        403,
        { message: "You do not have permission to read sessions." },
        {},
      ),
    });

    renderPage();

    expect(
      await screen.findByText("You do not have permission to read sessions."),
    ).toBeInTheDocument();
    expect(screen.queryByText("All events")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("product-analytics-events-page"),
    ).not.toBeInTheDocument();
  });

  it("a refused trend says why in place of the numbers, and the rest of the page stays", async () => {
    mockReads({
      trend: new HTTPErrorResponse(
        504,
        { message: "The read took too long. Choose a shorter range." },
        {},
      ),
    });

    renderPage();

    expect(
      await screen.findByText(
        "The read took too long. Choose a shorter range.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("product-analytics-event-tiles"),
    ).not.toBeInTheDocument();
    await waitForRows("product-analytics-event-breakdown-bars", 2);
    await waitForRows("product-analytics-event-list-bars", 4);
  });
});
