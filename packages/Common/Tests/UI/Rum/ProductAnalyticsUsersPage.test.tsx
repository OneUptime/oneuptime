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
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { XAxis as ChartXAxis } from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";

/*
 * Product Analytics > Users (Pages/Rum/View/ProductAnalyticsUsers.tsx),
 * rendered against mocked reads (issue #6444): the six tiles say what the
 * summary says, against the range before; the charts get the trend's lines;
 * the people list follows its filter, its dormant window and its search,
 * each kept in the address; and the page says plainly when nothing has been
 * counted yet, or when a read was refused.
 */

const postMock: MockFunction = getJestMockFunction();
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
    },
  };
});

/* recharts draws nothing in jsdom: each chart is checked by the lines it is handed. */
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

import RumApplicationProductAnalyticsUsers from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsUsers";
import { PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsPeopleCard";

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const OTHER_USER_KEY: string =
  "1111111111111111111111111111111111111111111111111111111111111111";
const VISITOR_ID: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-users`;
const DAY_MS: number = 24 * 60 * 60 * 1000;

interface CapturedRequest {
  url: string;
  data: JSONObject;
}

type Answer = JSONObject | HTTPErrorResponse | Promise<JSONObject>;

interface Answers {
  summary: Answer | (() => Answer);
  trend: Answer | (() => Answer);
  people: Answer | ((data: JSONObject) => Answer);
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

function period(overrides?: JSONObject): JSONObject {
  return {
    activeUsers: 1234,
    signedInUsers: 494,
    anonymousUsers: 740,
    newUsers: 300,
    returningUsers: 934,
    sessions: 4000,
    signedInSessions: 1500,
    finishedSessions: 3900,
    medianSessionMs: 61000,
    averagePagesPerSession: 2.5,
    errorSessions: 120,
    frustratedSessions: 80,
    sessionLengths: [100, 200, 300, 400, 500, 600, 1800],
    ...overrides,
  };
}

function summary(overrides?: JSONObject): JSONObject {
  return {
    current: period(),
    previous: period({ activeUsers: 1122, newUsers: 0, returningUsers: 934 }),
    previousStartTime: Date.now() - 60 * DAY_MS,
    previousEndTime: Date.now() - 30 * DAY_MS,
    totalUsers: 5600,
    dormantUsers: 2100,
    dormantAfterDays: 30,
    /* Counting began long before the range: no note. */
    dataStartedAt: Date.now() - 200 * DAY_MS,
    ...overrides,
  };
}

function trend(): JSONObject {
  return {
    timeZone: "UTC",
    days: [
      {
        day: "2026-09-01",
        activeUsers: 10,
        weeklyActiveUsers: 30,
        monthlyActiveUsers: 90,
        newUsers: 4,
        returningUsers: 6,
      },
      {
        day: "2026-09-02",
        activeUsers: 12,
        weeklyActiveUsers: 33,
        monthlyActiveUsers: 95,
        newUsers: 5,
        returningUsers: 7,
      },
    ],
  };
}

function identified(label?: string | undefined): JSONObject {
  return {
    personKey: `u:${USER_KEY}`,
    identifiedUserKey: USER_KEY,
    visitorId: VISITOR_ID,
    ...(label === undefined ? {} : { identifiedUserLabel: label }),
    firstSeenAt: Date.UTC(2026, 7, 1),
    lastSeenAt: Date.UTC(2026, 8, 2),
    sessionsInRange: 3,
    totalSessions: 1250,
    deviceType: "desktop",
    countryCode: "DE",
    isNew: 0,
  };
}

function visitor(): JSONObject {
  return {
    personKey: `v:${VISITOR_ID}`,
    identifiedUserKey: "",
    visitorId: VISITOR_ID,
    firstSeenAt: Date.UTC(2026, 8, 1),
    lastSeenAt: Date.UTC(2026, 8, 1),
    sessionsInRange: 1,
    totalSessions: 1,
    deviceType: "mobile",
    countryCode: "",
    isNew: 1,
  };
}

function people(
  list: Array<JSONObject>,
  extra?: { hasMore?: boolean; includesLabels?: boolean },
): JSONObject {
  return {
    people: list,
    hasMore: extra?.hasMore ?? false,
    includesLabels: extra?.includesLabels ?? true,
  };
}

function respond(answer: Answer): Promise<unknown> {
  if (answer instanceof HTTPErrorResponse) {
    return Promise.resolve(answer);
  }

  return Promise.resolve(answer).then((data: JSONObject): unknown => {
    return new HTTPResponse<JSONObject>(200, data, {});
  });
}

function mockReads(answers: Partial<Answers>): void {
  const all: Answers = {
    summary: summary(),
    trend: trend(),
    people: people([identified("jane@acme.com"), visitor()]),
    ...answers,
  };

  postMock.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: { url: { toString: () => string }; data: JSONObject } =
      args[0] as { url: { toString: () => string }; data: JSONObject };
    const url: string = request.url.toString();

    if (url.endsWith("/product-analytics/summary")) {
      return respond(
        typeof all.summary === "function" ? all.summary() : all.summary,
      );
    }

    if (url.endsWith("/product-analytics/trend")) {
      return respond(typeof all.trend === "function" ? all.trend() : all.trend);
    }

    if (url.endsWith("/product-analytics/people")) {
      return respond(
        typeof all.people === "function"
          ? all.people(request.data)
          : all.people,
      );
    }

    return Promise.reject(new Error(`Unexpected read ${url}`));
  });
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <RumApplicationProductAnalyticsUsers
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

/* Each tile's words, in the order the page lays them out. */
function tileTexts(): Array<string> {
  return Array.from(
    screen
      .getByTestId("product-analytics-user-tiles")
      .querySelectorAll("[aria-busy]"),
  ).map((tile: Element): string => {
    return (tile.textContent || "").replace(/\s+/g, " ").trim();
  });
}

async function waitForTiles(): Promise<Array<string>> {
  await waitFor(() => {
    expect(tileTexts()[0]).toContain("1,234");
  });

  return tileTexts();
}

async function waitForPeople(count: number): Promise<Array<HTMLElement>> {
  await waitFor(() => {
    expect(screen.getAllByTestId("product-analytics-person-link")).toHaveLength(
      count,
    );
  });

  return screen.getAllByTestId("product-analytics-person-link");
}

function peopleCard(): HTMLElement {
  return screen.getByTestId("product-analytics-people");
}

function chooseHeaderMenuItem(name: string): void {
  fireEvent.click(screen.getByTestId("product-analytics-users-toolbar-more"));
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", { name: name }),
  );
}

interface Deferred {
  promise: Promise<JSONObject>;
  resolve: (value: JSONObject) => void;
}

function deferred(): Deferred {
  let resolve: (value: JSONObject) => void = (): void => {};
  const promise: Promise<JSONObject> = new Promise<JSONObject>(
    (done: (value: JSONObject) => void): void => {
      resolve = done;
    },
  );

  return { promise: promise, resolve: resolve };
}

/* The time axis each drawing of a chart asked for, first to last. */
function chartAxes(): Array<ChartXAxis> {
  return lineChartMock.mock.calls.map((call: Array<unknown>): ChartXAxis => {
    return (call[0] as { xAxis: ChartXAxis }).xAxis;
  });
}

beforeEach(() => {
  postMock.mockReset();
  lineChartMock.mockReset();
  window.history.replaceState(null, "", PAGE_PATH);
});

describe("ProductAnalyticsUsers tiles", () => {
  it("shows the six numbers, each against the range before", async () => {
    mockReads({});

    renderPage();

    const tiles: Array<string> = await waitForTiles();

    expect(tiles).toHaveLength(6);
    expect(tiles[0]).toContain("Active users");
    expect(tiles[0]).toContain("1,234");
    expect(tiles[0]).toContain("Up 10% on the previous period");
    expect(tiles[1]).toContain("New users");
    expect(tiles[1]).toContain("300");
    expect(tiles[1]).toContain("None in the previous period");
    expect(tiles[2]).toContain("Returning users");
    expect(tiles[2]).toContain("Same as the previous period");
    expect(tiles[3]).toContain("Signed-in users");
    expect(tiles[3]).toContain("494");
    expect(tiles[3]).toContain("40% of active users");
    expect(tiles[4]).toContain("Total users");
    expect(tiles[4]).toContain("5,600");
    expect(tiles[4]).toContain("In the last 13 months");
    expect(tiles[5]).toContain("Dormant users");
    expect(tiles[5]).toContain("2,100");
    expect(tiles[5]).toContain("Not seen for 30 days");
  });

  it("each tile says what it counts in its (i)", async () => {
    mockReads({});

    renderPage();

    await waitForTiles();

    for (const title of [
      "Active users",
      "New users",
      "Returning users",
      "Signed-in users",
      "Total users",
      "Dormant users",
    ]) {
      expect(
        within(screen.getByTestId("product-analytics-user-tiles")).getByRole(
          "button",
          { name: `About ${title}` },
        ),
      ).toBeInTheDocument();
    }
  });

  it("asks for the default month, the dormant cut-off and the reader's zone, with a clean address", async () => {
    mockReads({});

    renderPage();

    /* Every read answered and drawn: each still asked once, however often the page drew. */
    await waitForTiles();
    await waitForPeople(2);
    await waitFor(() => {
      expect(screen.getAllByTestId("line-chart")).toHaveLength(2);
    });

    const summaryRequest: JSONObject = requestsTo("summary")[0]!.data;
    const start: number = new Date(
      summaryRequest["startTime"] as string,
    ).getTime();
    const end: number = new Date(summaryRequest["endTime"] as string).getTime();

    expect(requestsTo("summary")).toHaveLength(1);
    expect(summaryRequest["rumApplicationId"]).toBe(APP_ID);
    expect(summaryRequest["dormantAfterDays"]).toBe(30);
    /* A month: 28 to 31 days. */
    expect((end - start) / DAY_MS).toBeGreaterThanOrEqual(28);
    expect((end - start) / DAY_MS).toBeLessThanOrEqual(31);

    expect(requestsTo("trend")).toHaveLength(1);
    expect(requestsTo("trend")[0]!.data).toEqual(
      expect.objectContaining({
        rumApplicationId: APP_ID,
        startTime: summaryRequest["startTime"],
        endTime: summaryRequest["endTime"],
        timeZone: expect.any(String),
      }),
    );

    expect(requestsTo("people")).toHaveLength(1);
    expect(requestsTo("people")[0]!.data).toEqual({
      rumApplicationId: APP_ID,
      startTime: summaryRequest["startTime"],
      endTime: summaryRequest["endTime"],
      filter: "active",
      dormantAfterDays: 30,
      limit: PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE,
      offset: 0,
    });

    expect(window.location.search).toBe("");
  });

  it("says when counting started inside the range", async () => {
    mockReads({ summary: summary({ dataStartedAt: Date.now() - 3 * DAY_MS }) });

    renderPage();

    await waitForTiles();

    expect(
      screen.getByTestId("product-analytics-counting-since"),
    ).toHaveTextContent(
      "Sessions recorded before then are not in these numbers.",
    );
  });

  it("compares with nothing when the range before was only partly counted", async () => {
    /* Counting began 40 days ago: inside the range before this month. */
    mockReads({
      summary: summary({ dataStartedAt: Date.now() - 40 * DAY_MS }),
    });

    renderPage();

    const tiles: Array<string> = await waitForTiles();

    for (const tile of tiles.slice(0, 3)) {
      expect(tile).toContain("Previous period not fully counted");
      expect(tile).not.toContain("on the previous period");
    }
  });

  it("a share of no active users is no line at all, never 0%", async () => {
    mockReads({
      summary: summary({
        current: period({ activeUsers: 0, signedInUsers: 0 }),
      }),
    });

    renderPage();

    /* The summary drawn: the total from it, then the signed-in tile beside it. */
    await waitFor(() => {
      expect(tileTexts()[4]).toContain("5,600");
    });

    expect(tileTexts()[3]).toContain("Signed-in users");
    expect(tileTexts()[3]).not.toContain("of active users");
    expect(tileTexts()[3]).not.toContain("%");
  });

  it("charts from the day counting started, not days nobody counted as zero", async () => {
    mockReads({
      summary: summary({ dataStartedAt: Date.UTC(2026, 8, 2, 15, 0) }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByTestId("line-chart")).toHaveLength(2);
    });

    await waitFor(() => {
      const lastCall: Array<unknown> | undefined =
        lineChartMock.mock.calls[lineChartMock.mock.calls.length - 1];
      const lines: Array<{ data: Array<{ x: Date }> }> = (
        lastCall![0] as { data: Array<{ data: Array<{ x: Date }> }> }
      ).data;

      expect(
        lines[0]!.data.map((point: { x: Date }): string => {
          return point.x.toISOString();
        }),
      ).toEqual(["2026-09-02T00:00:00.000Z"]);
    });
  });

  it("says nothing about counting when it started before the range", async () => {
    mockReads({});

    renderPage();

    await waitForTiles();

    expect(screen.queryByTestId("product-analytics-counting-since")).toBeNull();
  });
});

describe("ProductAnalyticsUsers charts", () => {
  it("draws daily, weekly and monthly active users, and new against returning, one point a day", async () => {
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByTestId("line-chart")).toHaveLength(2);
    });

    const charts: Array<string> = screen
      .getAllByTestId("line-chart")
      .map((chart: HTMLElement): string => {
        return chart.textContent || "";
      });

    expect(charts).toEqual([
      "Daily active users,Weekly active users,Monthly active users",
      "New users,Returning users",
    ]);

    const lastCall: Array<unknown> | undefined =
      lineChartMock.mock.calls[lineChartMock.mock.calls.length - 2];
    const lines: Array<{
      seriesName: string;
      data: Array<{ x: Date; y: number }>;
    }> = (
      lastCall![0] as {
        data: Array<{
          seriesName: string;
          data: Array<{ x: Date; y: number }>;
        }>;
      }
    ).data;

    expect(
      lines[2]!.data.map((point: { x: Date; y: number }) => {
        return [point.x.toISOString(), point.y];
      }),
    ).toEqual([
      ["2026-09-01T00:00:00.000Z", 90],
      ["2026-09-02T00:00:00.000Z", 95],
    ]);
  });

  it("both charts ask for a day axis: their ticks name days, never clock times", async () => {
    /*
     * One point a day (issue #6564): left to the window's length, two days
     * counted read "01 Sep, 00:00" under the charts.
     */
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByTestId("line-chart")).toHaveLength(2);
    });

    const axes: Array<ChartXAxis> = chartAxes();

    expect(axes.length).toBeGreaterThanOrEqual(2);
    for (const axis of axes) {
      expect(axis.options.type).toBe(XAxisType.Time);
      expect(axis.options.precision).toBe(XAxisPrecision.EVERY_DAY);
    }

    // From the first day's start to the last day's: the two days counted.
    const last: ChartXAxis = axes[axes.length - 1]!;

    expect((last.options.min as Date).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect((last.options.max as Date).toISOString()).toBe(
      "2026-09-02T00:00:00.000Z",
    );
  });

  it("a refused trend says so where the charts go, and the tiles stay", async () => {
    mockReads({
      trend: new HTTPErrorResponse(
        400,
        { message: "The range is too long." },
        {},
      ),
    });

    renderPage();

    await waitForTiles();

    await waitFor(() => {
      expect(screen.getByText("The range is too long.")).toBeInTheDocument();
    });

    expect(screen.queryAllByTestId("line-chart")).toHaveLength(0);
  });
});

describe("ProductAnalyticsUsers before anything is counted, and when refused", () => {
  it("before the first session: where the numbers will come from, and no people list", async () => {
    mockReads({ summary: summary({ dataStartedAt: null }) });

    renderPage();

    await waitFor(() => {
      expect(
        document.getElementById("product-analytics-nothing-yet"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("No sessions counted yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "How to install Session Replay" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay-documentation`,
    );
    expect(screen.queryByTestId("product-analytics-user-tiles")).toBeNull();
    expect(screen.queryByTestId("product-analytics-people")).toBeNull();
  });

  it("a refused summary shows the server's words, and nothing that would read as zero", async () => {
    mockReads({
      summary: new HTTPErrorResponse(
        403,
        { message: "You do not have permission to read session replays." },
        {},
      ),
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("You do not have permission to read session replays."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByTestId("product-analytics-user-tiles")).toBeNull();
    expect(screen.queryByTestId("product-analytics-people")).toBeNull();
  });
});

describe("ProductAnalyticsUsers people", () => {
  it("lists people by what the reader may see, each a link to their page", async () => {
    mockReads({
      people: people([
        identified("jane@acme.com"),
        {
          ...identified(""),
          personKey: `u:${OTHER_USER_KEY}`,
          identifiedUserKey: OTHER_USER_KEY,
        },
        visitor(),
      ]),
    });

    renderPage();

    const links: Array<HTMLElement> = await waitForPeople(3);

    expect(links[0]).toHaveTextContent("jane@acme.com");
    expect(links[0]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-users/u-${USER_KEY}`,
    );
    expect(links[1]).toHaveTextContent("Signed-in user");
    expect(links[2]).toHaveTextContent("Anonymous visitor");
    expect(links[2]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-users/v-${VISITOR_ID}`,
    );

    const card: HTMLElement = peopleCard();

    /* A nameless person's id: left to right in any page, in a monospace face. */
    expect(within(card).getByText("11111111…")).toHaveAttribute("dir", "ltr");
    expect(within(card).getByText("11111111…")).toHaveClass("font-mono");
    expect(within(card).getByText("7f3a2b1c…")).toHaveAttribute("dir", "ltr");
    /* What a named person is, in words: no id face, and the name sets the cell's direction. */
    const named: HTMLElement = links[0]!.closest("[dir]") as HTMLElement;

    expect(named).toHaveAttribute("dir", "auto");
    expect(within(named).getByText("Signed-in user")).not.toHaveClass(
      "font-mono",
    );
    expect(links[0]).toHaveAttribute("title", "jane@acme.com");
    /* Counts in the reader's digits; the country by its name. */
    expect(within(card).getAllByText("1,250 in all")).toHaveLength(2);
    expect(within(card).getAllByText("Germany").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("Mobile").length).toBeGreaterThan(0);
  });

  it("says how long ago a person was last seen, and the day they were first seen", async () => {
    mockReads({ people: people([identified("jane@acme.com")]) });

    renderPage();

    await waitForPeople(1);

    const card: HTMLElement = peopleCard();
    const lastSeen: Date = new Date(Date.UTC(2026, 8, 2));
    const firstSeen: Date = new Date(Date.UTC(2026, 7, 1));

    expect(
      within(card).getAllByText(OneUptimeDate.fromNow(lastSeen))[0],
    ).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(lastSeen),
    );
    expect(
      within(card).getAllByText(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          firstSeen,
          true,
        ),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("offers other page sizes, and asks for the size picked from its first page", async () => {
    mockReads({
      people: people([identified("jane@acme.com")], { hasMore: true }),
    });

    renderPage();

    await waitForPeople(1);

    const select: HTMLSelectElement = within(peopleCard()).getByTestId(
      "pagination-items-on-page-select",
    ) as HTMLSelectElement;

    expect(select.value).toBe(String(PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE));
    expect(select.querySelectorAll("option").length).toBeGreaterThan(1);

    fireEvent.change(select, { target: { value: "100" } });

    await waitFor(() => {
      expect(requestsTo("people")).toHaveLength(2);
    });

    expect(requestsTo("people")[1]!.data).toEqual(
      expect.objectContaining({ limit: 100, offset: 0 }),
    );
  });

  it("a filter reads its people again, writes itself into the address, and leaves the tiles alone", async () => {
    mockReads({});

    renderPage();

    await waitForPeople(2);

    fireEvent.click(screen.getByTestId("product-analytics-people-filter-new"));

    await waitFor(() => {
      expect(requestsTo("people")).toHaveLength(2);
    });

    expect(requestsTo("people")[1]!.data["filter"]).toBe("new");
    expect(window.location.search).toBe("?people=new");
    expect(requestsTo("summary")).toHaveLength(1);
    expect(
      screen.getByTestId("product-analytics-people-filter-new"),
    ).toHaveAttribute("aria-checked", "true");

    /* Back to the default: a clean address again. */
    fireEvent.click(
      screen.getByTestId("product-analytics-people-filter-active"),
    );

    await waitFor(() => {
      expect(requestsTo("people")).toHaveLength(3);
    });

    expect(window.location.search).toBe("");
  });

  it("the dormant window is offered only for dormant users, and moves the tile with the list", async () => {
    mockReads({
      summary: (): JSONObject => {
        const asked: JSONObject | undefined =
          requestsTo("summary")[requestsTo("summary").length - 1]?.data;

        return summary({ dormantAfterDays: asked?.["dormantAfterDays"] ?? 30 });
      },
    });

    renderPage();

    await waitForPeople(2);

    expect(screen.queryByTestId("product-analytics-dormant-window")).toBeNull();

    fireEvent.click(
      screen.getByTestId("product-analytics-people-filter-dormant"),
    );

    const window60: HTMLElement = await screen.findByTestId(
      "product-analytics-dormant-60",
    );

    expect(
      within(screen.getByTestId("product-analytics-dormant-window")).getByText(
        "Dormant after",
      ),
    ).toBeInTheDocument();
    expect(window60).toHaveTextContent("60 days");
    expect(screen.getByTestId("product-analytics-dormant-30")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(window60);

    await waitFor(() => {
      expect(requestsTo("summary")).toHaveLength(2);
    });

    expect(requestsTo("summary")[1]!.data["dormantAfterDays"]).toBe(60);

    await waitFor(() => {
      expect(
        requestsTo("people")[requestsTo("people").length - 1]!.data,
      ).toEqual(
        expect.objectContaining({ filter: "dormant", dormantAfterDays: 60 }),
      );
    });

    await waitFor(() => {
      expect(tileTexts()[5]).toContain("Not seen for 60 days");
    });

    expect(window.location.search).toBe("?people=dormant&dormant=60");
  });

  it("a person's link carries the page's range and filter, for Back to users", async () => {
    mockReads({});

    window.history.replaceState(
      null,
      "",
      `${PAGE_PATH}?range=Past+1+Week&people=dormant&dormant=90`,
    );

    renderPage();

    const links: Array<HTMLElement> = await waitForPeople(2);

    expect(links[0]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-users/u-${USER_KEY}?range=Past+1+Week&people=dormant&dormant=90`,
    );
  });

  it("the search box is there only for a reader who sees names", async () => {
    mockReads({
      people: people([identified(), visitor()], { includesLabels: false }),
    });

    renderPage();

    await waitForPeople(2);

    expect(screen.queryByTestId("product-analytics-people-search")).toBeNull();
    /* Nor an empty toolbar, which would still take a line on a phone. */
    expect(screen.queryByTestId("product-analytics-people-toolbar")).toBeNull();
    /* No name to show: the row says what it is, never "undefined". */
    expect(
      screen.getAllByTestId("product-analytics-person-link")[0],
    ).toHaveTextContent("Signed-in user");
  });

  it("a search waits for a pause in typing, is trimmed, and says when nobody matches", async () => {
    mockReads({
      people: (data: JSONObject): JSONObject => {
        return data["search"]
          ? people([])
          : people([identified("jane@acme.com"), visitor()]);
      },
    });

    renderPage();

    await waitForPeople(2);

    const search: HTMLElement = screen.getByTestId(
      "product-analytics-people-search",
    );

    expect(search).toHaveAttribute(
      "placeholder",
      "Search signed-in users by name",
    );
    expect(search).toHaveAttribute("maxLength", "200");
    /* A query, never work to keep: a new version does not wait for it. */
    expect(search).toHaveAttribute("data-unsaved-changes-ignore", "true");

    fireEvent.change(search, { target: { value: "  zed " } });

    /* Not on each keystroke. */
    expect(requestsTo("people")).toHaveLength(1);

    await waitFor(() => {
      expect(requestsTo("people")).toHaveLength(2);
    });

    expect(requestsTo("people")[1]!.data["search"]).toBe("zed");

    await waitFor(() => {
      expect(
        screen.getByTestId("product-analytics-people-empty"),
      ).toHaveTextContent("Nobody whose name matches this search.");
    });

    /* Still there to clear, though the empty answer had no names in it. */
    expect(
      screen.getByTestId("product-analytics-people-search"),
    ).toBeInTheDocument();
  });

  it("the search sits in the card's header, and Escape clears it and asks again without it", async () => {
    mockReads({});

    renderPage();

    await waitForPeople(2);

    const toolbar: HTMLElement = screen.getByTestId(
      "product-analytics-people-toolbar",
    );
    const search: HTMLElement = within(toolbar).getByTestId(
      "product-analytics-people-search",
    );

    /* Folded to the pill until it is used; the pill opens it. */
    fireEvent.click(
      within(toolbar).getByRole("button", { name: "Open search" }),
    );
    fireEvent.change(search, { target: { value: "jane" } });

    await waitFor(() => {
      expect(requestsTo("people")).toHaveLength(2);
    });

    expect(requestsTo("people")[1]!.data["search"]).toBe("jane");

    fireEvent.keyDown(search, { key: "Escape" });

    expect(search).toHaveValue("");

    await waitFor(() => {
      expect(requestsTo("people")).toHaveLength(3);
    });

    expect(requestsTo("people")[2]!.data["search"]).toBeUndefined();
  });

  it("an empty list says so for the filter and range", async () => {
    mockReads({ people: people([]) });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("product-analytics-people-empty"),
      ).toHaveTextContent("Nobody to show for this filter and range.");
    });
  });

  it("pages forward by offset, the size the list asks for", async () => {
    mockReads({
      people: (data: JSONObject): JSONObject => {
        return data["offset"]
          ? people([visitor()])
          : people([identified("jane@acme.com")], { hasMore: true });
      },
    });

    renderPage();

    await waitForPeople(1);

    fireEvent.click(within(peopleCard()).getByTestId("pagination-next-button"));

    await waitFor(() => {
      expect(requestsTo("people")).toHaveLength(2);
    });

    expect(requestsTo("people")[1]!.data["offset"]).toBe(
      PRODUCT_ANALYTICS_PEOPLE_PAGE_SIZE,
    );

    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-person-link")[0],
      ).toHaveTextContent("Anonymous visitor");
    });

    /* A new filter starts again at the first page. */
    fireEvent.click(screen.getByTestId("product-analytics-people-filter-all"));

    await waitFor(() => {
      expect(requestsTo("people")).toHaveLength(3);
    });

    expect(requestsTo("people")[2]!.data["offset"]).toBe(0);
  });

  it("a refused list says so in the card, and the tiles stay", async () => {
    mockReads({
      people: new HTTPErrorResponse(
        400,
        { message: "Searching by name needs permission to see who users are." },
        {},
      ),
    });

    renderPage();

    await waitForTiles();

    await waitFor(() => {
      expect(
        within(peopleCard()).getByText(
          "Searching by name needs permission to see who users are.",
        ),
      ).toBeInTheDocument();
    });
  });
});

describe("ProductAnalyticsUsers range and refresh", () => {
  it("a picked range reads everything again and is written to the address", async () => {
    mockReads({});

    renderPage();

    await waitForPeople(2);

    fireEvent.click(screen.getByTestId("telemetry-time-range-picker-button"));
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Week" }));

    await waitFor(() => {
      expect(requestsTo("summary")).toHaveLength(2);
      expect(requestsTo("trend")).toHaveLength(2);
      expect(requestsTo("people")).toHaveLength(2);
    });

    const asked: JSONObject = requestsTo("summary")[1]!.data;

    expect(
      (new Date(asked["endTime"] as string).getTime() -
        new Date(asked["startTime"] as string).getTime()) /
        DAY_MS,
    ).toBeCloseTo(7, 1);
    expect(window.location.search).toBe("?range=Past+1+Week");
  });

  it("opens on an absolute window from the address, and Refresh reads that same window again", async () => {
    const start: string = "2026-09-01T00:00:00.000Z";
    const end: string = "2026-09-08T00:00:00.000Z";

    mockReads({});

    window.history.replaceState(
      null,
      "",
      `${PAGE_PATH}?startTime=${start}&endTime=${end}`,
    );

    renderPage();

    await waitForPeople(2);

    expect(requestsTo("summary")[0]!.data).toEqual(
      expect.objectContaining({
        startTime: OneUptimeDate.toString(new Date(start)),
        endTime: OneUptimeDate.toString(new Date(end)),
      }),
    );

    chooseHeaderMenuItem("Refresh");

    await waitFor(() => {
      expect(requestsTo("summary")).toHaveLength(2);
      expect(requestsTo("trend")).toHaveLength(2);
      expect(requestsTo("people")).toHaveLength(2);
    });

    expect(requestsTo("summary")[1]!.data["startTime"]).toBe(
      requestsTo("summary")[0]!.data["startTime"],
    );
  });

  it("an older answer that lands late never replaces a newer one", async () => {
    const slow: Deferred = deferred();
    let calls: number = 0;

    mockReads({
      summary: (): Answer => {
        calls += 1;

        return calls === 1 ? slow.promise : summary({ totalUsers: 777 });
      },
    });

    renderPage();

    fireEvent.click(screen.getByTestId("telemetry-time-range-picker-button"));
    fireEvent.click(screen.getByRole("button", { name: "Past 1 Week" }));

    await waitFor(() => {
      expect(tileTexts()[4]).toContain("777");
    });

    await act(async () => {
      slow.resolve(summary({ totalUsers: 111 }));
      await slow.promise;
    });

    expect(tileTexts()[4]).toContain("777");
    expect(tileTexts()[4]).not.toContain("111");
  });
});
