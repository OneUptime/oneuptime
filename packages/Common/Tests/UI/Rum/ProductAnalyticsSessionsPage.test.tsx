import "@testing-library/jest-dom";
import {
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
import { createTranslator } from "../../../Types/Translator";
import {
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS,
  ProductAnalyticsDimension,
} from "../../../Types/Rum/ProductAnalytics";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { XAxis as ChartXAxis } from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";

/*
 * Product Analytics > Sessions (Pages/Rum/View/ProductAnalyticsSessions.tsx),
 * rendered against mocked reads (issue #6444): six tiles of how sessions
 * went, sessions by device day by day, how long finished sessions lasted,
 * and users and sessions broken down by what they came with and where they
 * went - the breakdown's dimension kept in the address.
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

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: { data: Array<{ seriesName: string }> }) => {
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

import RumApplicationProductAnalyticsSessions, {
  buildBreakdownRows,
  buildSessionLengthRows,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsSessions";
import { parseProductAnalyticsSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsApi";

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/product-analytics-sessions`;
const DAY_MS: number = 24 * 60 * 60 * 1000;

type Answer = JSONObject | HTTPErrorResponse;

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

function period(overrides?: JSONObject): JSONObject {
  return {
    activeUsers: 1234,
    signedInUsers: 494,
    anonymousUsers: 740,
    newUsers: 300,
    returningUsers: 934,
    sessions: 4000,
    signedInSessions: 1440,
    finishedSessions: 3900,
    medianSessionMs: 61000,
    averagePagesPerSession: 2.46,
    errorSessions: 120,
    frustratedSessions: 80,
    sessionLengths: [390, 780, 390, 780, 780, 390, 390],
    ...overrides,
  };
}

function summary(overrides?: JSONObject): JSONObject {
  return {
    current: period(),
    previous: period({
      sessions: 5000,
      medianSessionMs: 61000,
      averagePagesPerSession: 0,
    }),
    previousStartTime: Date.now() - 60 * DAY_MS,
    previousEndTime: Date.now() - 30 * DAY_MS,
    totalUsers: 5600,
    dormantUsers: 2100,
    dormantAfterDays: 30,
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
        sessions: 10,
        desktopSessions: 6,
        mobileSessions: 3,
        tabletSessions: 1,
        otherSessions: 0,
      },
    ],
  };
}

function breakdown(dimension: string, overrides?: JSONObject): JSONObject {
  const rows: Record<string, Array<JSONObject>> = {
    deviceType: [
      { value: "desktop", users: 800, sessions: 2600 },
      { value: "mobile", users: 400, sessions: 1200 },
      { value: "", users: 34, sessions: 200 },
    ],
    country: [
      { value: "DE", users: 600, sessions: 2000 },
      { value: "FR", users: 300, sessions: 1000 },
    ],
    page: [{ value: "https://app.acme.com/checkout", users: 50, sessions: 70 }],
  };

  return {
    dimension: dimension,
    rows: rows[dimension] || [{ value: "Chrome", users: 1, sessions: 1 }],
    hasMore: false,
    totalUsers: 1234,
    totalSessions: 4000,
    ...overrides,
  };
}

function respond(answer: Answer): Promise<unknown> {
  return Promise.resolve(
    answer instanceof HTTPErrorResponse
      ? answer
      : new HTTPResponse<JSONObject>(200, answer, {}),
  );
}

function mockReads(answers: {
  summary?: Answer;
  trend?: Answer;
  breakdown?: (dimension: string) => Answer;
}): void {
  postMock.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: { url: { toString: () => string }; data: JSONObject } =
      args[0] as { url: { toString: () => string }; data: JSONObject };
    const url: string = request.url.toString();

    if (url.endsWith("/product-analytics/summary")) {
      return respond(answers.summary ?? summary());
    }

    if (url.endsWith("/product-analytics/trend")) {
      return respond(answers.trend ?? trend());
    }

    if (url.endsWith("/product-analytics/breakdown")) {
      const dimension: string = request.data["dimension"] as string;

      return respond(
        answers.breakdown ? answers.breakdown(dimension) : breakdown(dimension),
      );
    }

    return Promise.reject(new Error(`Unexpected read ${url}`));
  });
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <RumApplicationProductAnalyticsSessions
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
      .getByTestId("product-analytics-session-tiles")
      .querySelectorAll("[aria-busy]"),
  ).map((tile: Element): string => {
    return (tile.textContent || "").replace(/\s+/g, " ").trim();
  });
}

async function waitForTiles(): Promise<Array<string>> {
  await waitFor(() => {
    expect(tileTexts()[0]).toContain("4,000");
  });

  return tileTexts();
}

/* A bars table's rows: each row's label, then its figures, cell by cell. */
function barRows(testId: string): Array<{ key: string; text: string }> {
  return screen
    .getAllByTestId(`${testId}-row`)
    .map((row: HTMLElement): { key: string; text: string } => {
      return {
        key: row.getAttribute("data-key") || "",
        text: Array.from(row.querySelectorAll('[role="cell"]'))
          .map((cell: Element): string => {
            return (cell.textContent || "").trim();
          })
          .join(" "),
      };
    });
}

function barWidths(testId: string): Array<string> {
  return screen
    .getAllByTestId(`${testId}-bar`)
    .map((bar: HTMLElement): string => {
      return bar.style.width;
    });
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

describe("ProductAnalyticsSessions tiles", () => {
  it("shows how sessions went, against the range before where that says something", async () => {
    mockReads({});

    renderPage();

    const tiles: Array<string> = await waitForTiles();

    expect(tiles).toHaveLength(6);
    expect(tiles[0]).toContain("Sessions");
    expect(tiles[0]).toContain("Down 20% on the previous period");
    expect(tiles[1]).toContain("Signed-in sessions");
    expect(tiles[1]).toContain("1,440");
    expect(tiles[1]).toContain("36% of sessions");
    expect(tiles[2]).toContain("Median session length");
    expect(tiles[2]).toContain("1m 1s");
    expect(tiles[2]).toContain("Same as the previous period");
    expect(tiles[3]).toContain("Pages per session");
    expect(tiles[3]).toContain("2.5");
    expect(tiles[3]).toContain("None in the previous period");
    expect(tiles[4]).toContain("Sessions with errors");
    expect(tiles[4]).toContain("120");
    expect(tiles[4]).toContain("3% of sessions");
    expect(tiles[5]).toContain("Frustrated sessions");
    expect(tiles[5]).toContain("2% of sessions");
  });

  it("draws sessions by device, one line per kind of device", async () => {
    mockReads({});

    renderPage();

    /* No session of another kind of device in the range: no line along zero for it. */
    await waitFor(() => {
      expect(screen.getByTestId("line-chart").textContent).toBe(
        "Desktop,Mobile,Tablet",
      );
    });

    expect(requestsTo("trend")[0]!.data["timeZone"]).toEqual(
      expect.any(String),
    );
  });

  it("its chart asks for a day axis: its ticks name days, never clock times", async () => {
    // One point a day (issue #6564).
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("line-chart").textContent).toBe(
        "Desktop,Mobile,Tablet",
      );
    });

    const axes: Array<ChartXAxis> = chartAxes();

    expect(axes.length).toBeGreaterThan(0);
    for (const axis of axes) {
      expect(axis.options.type).toBe(XAxisType.Time);
      expect(axis.options.precision).toBe(XAxisPrecision.EVERY_DAY);
    }
  });

  it("draws a line for other devices once the range has a session from one", async () => {
    const withOther: JSONObject = trend();

    (withOther["days"] as Array<JSONObject>).push({
      day: "2026-09-02",
      sessions: 4,
      desktopSessions: 3,
      mobileSessions: 0,
      tabletSessions: 0,
      otherSessions: 1,
    });

    mockReads({ trend: withOther });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("line-chart").textContent).toBe(
        "Desktop,Mobile,Tablet,Other",
      );
    });
  });

  it("no sessions: no share under the tiles, and nothing compared with a range only partly counted", async () => {
    mockReads({
      summary: summary({
        current: period({
          sessions: 0,
          signedInSessions: 0,
          errorSessions: 0,
          frustratedSessions: 0,
        }),
        /* Counting began inside the range before. */
        dataStartedAt: Date.now() - 40 * DAY_MS,
      }),
    });

    renderPage();

    await waitFor(() => {
      expect(tileTexts()[0]).toContain("Sessions");
      expect(tileTexts()[2]).toContain("1m 1s");
    });

    const tiles: Array<string> = tileTexts();

    for (const tile of tiles) {
      expect(tile).not.toContain("of sessions");
      expect(tile).not.toContain("on the previous period");
    }

    /* Sessions before, none now, and the range before only partly counted. */
    expect(tiles[0]).toContain("Previous period not fully counted");
  });

  it("the summary is asked once for the window, the trend once, the breakdown once", async () => {
    mockReads({});

    renderPage();

    await waitForTiles();
    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-breakdown-bars-row"),
      ).toHaveLength(3);
    });

    expect(requestsTo("summary")).toHaveLength(1);
    expect(requestsTo("trend")).toHaveLength(1);
    expect(requestsTo("breakdown")).toHaveLength(1);
    expect(requestsTo("breakdown")[0]!.data).toEqual(
      expect.objectContaining({
        rumApplicationId: APP_ID,
        dimension: "deviceType",
        startTime: requestsTo("summary")[0]!.data["startTime"],
        endTime: requestsTo("summary")[0]!.data["endTime"],
      }),
    );
    expect(window.location.search).toBe("");
  });
});

describe("ProductAnalyticsSessions session length", () => {
  it("one row per bucket, in order, with its count and its share of finished sessions", async () => {
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-session-lengths-row"),
      ).toHaveLength(PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.length);
    });

    expect(barRows("product-analytics-session-lengths")).toEqual([
      { key: "under-10s", text: "Under 10 seconds 390 10%" },
      { key: "10s-30s", text: "10 to 30 seconds 780 20%" },
      { key: "30s-1m", text: "30 seconds to 1 minute 390 10%" },
      { key: "1m-3m", text: "1 to 3 minutes 780 20%" },
      { key: "3m-10m", text: "3 to 10 minutes 780 20%" },
      { key: "10m-30m", text: "10 to 30 minutes 390 10%" },
      { key: "30m-plus", text: "30 minutes or more 390 10%" },
    ]);

    /*
     * Session length and Breakdown share a row as a CardGrid: each card
     * fills its cell, so the shorter one never leaves bare page under it.
     */
    const cards: HTMLElement = screen.getByTestId(
      "product-analytics-sessions-cards",
    );
    expect(cards).toHaveAttribute("data-columns", "2");
    expect(
      within(cards)
        .getAllByTestId("card-grid-cell")
        .map((cell: HTMLElement): boolean => {
          return (
            within(cell).queryByTestId("product-analytics-session-lengths") !==
              null ||
            within(cell).queryByTestId("product-analytics-breakdown") !== null
          );
        }),
    ).toEqual([true, true]);
  });

  it("the rows a page builds: nothing finished is 0% everywhere, never NaN", () => {
    expect(
      buildSessionLengthRows({
        summary: parseProductAnalyticsSummary({}),
        translator: createTranslator(undefined, "en"),
      }).map((row: { figures: Array<string> }): Array<string> => {
        return row.figures;
      }),
    ).toEqual(
      PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.map((): Array<string> => {
        return ["0", "0%"];
      }),
    );
  });
});

describe("ProductAnalyticsSessions breakdown", () => {
  it("by device type first: users, sessions and share, a session that reported none as Not reported", async () => {
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-breakdown-bars-row"),
      ).toHaveLength(3);
    });

    expect(barRows("product-analytics-breakdown-bars")).toEqual([
      { key: "desktop", text: "Desktop 800 2,600 65%" },
      { key: "mobile", text: "Mobile 400 1,200 30%" },
      { key: "(none)", text: "Not reported 34 200 5%" },
    ]);
    /* Bars by users, against the most: one hue, one baseline. */
    expect(barWidths("product-analytics-breakdown-bars")).toEqual([
      "100%",
      "50%",
      "4.25%",
    ]);
    expect(
      within(screen.getByTestId("product-analytics-breakdown-bars"))
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return header.textContent || "";
        }),
    ).toEqual(["Device type", "Users", "Sessions", "Percent"]);
    expect(
      screen.getByTestId("product-analytics-dimension-deviceType"),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("product-analytics-breakdown-more")).toBeNull();
  });

  it("each dimension is a choice, named", async () => {
    mockReads({});

    renderPage();

    await waitForTiles();

    const group: HTMLElement = await screen.findByRole("radiogroup", {
      name: "Break down by",
    });

    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio: HTMLElement): string => {
          return radio.textContent || "";
        }),
    ).toEqual([
      "Device type",
      "Browser",
      "Operating system",
      "Country",
      "App version",
      "Entry page",
      "Page",
    ]);
    expect(within(group).getAllByRole("radio")).toHaveLength(
      PRODUCT_ANALYTICS_DIMENSIONS.length,
    );
  });

  it("another dimension is read and drawn under its own name, and kept in the address", async () => {
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-breakdown-bars-row"),
      ).toHaveLength(3);
    });

    fireEvent.click(screen.getByTestId("product-analytics-dimension-country"));

    await waitFor(() => {
      expect(barRows("product-analytics-breakdown-bars")).toEqual([
        { key: "DE", text: "Germany 600 2,000 50%" },
        { key: "FR", text: "France 300 1,000 25%" },
      ]);
    });

    expect(requestsTo("breakdown")[1]!.data["dimension"]).toBe("country");
    expect(window.location.search).toBe("?by=country");
    /* The column says what it holds. */
    expect(
      within(screen.getByTestId("product-analytics-breakdown-bars")).getByText(
        "Country",
      ),
    ).toBeInTheDocument();
    /* A new dimension reads no tiles again. */
    expect(requestsTo("summary")).toHaveLength(1);
  });

  it("opens on the dimension the address names", async () => {
    mockReads({});

    window.history.replaceState(null, "", `${PAGE_PATH}?by=page`);

    renderPage();

    await waitFor(() => {
      expect(barRows("product-analytics-breakdown-bars")).toEqual([
        {
          key: "https://app.acme.com/checkout",
          text: "https://app.acme.com/checkout 50 70 2%",
        },
      ]);
    });

    expect(requestsTo("breakdown")[0]!.data["dimension"]).toBe(
      ProductAnalyticsDimension.Page,
    );
  });

  it("says when less common values were left out", async () => {
    mockReads({
      breakdown: (dimension: string): Answer => {
        return breakdown(dimension, { hasMore: true });
      },
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("product-analytics-breakdown-more"),
      ).toHaveTextContent(
        "The 50 values with the most users. Less common ones are left out.",
      );
    });
  });

  it("an empty breakdown says there were no sessions", async () => {
    mockReads({
      breakdown: (dimension: string): Answer => {
        return breakdown(dimension, { rows: [] });
      },
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("No sessions in this range."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByTestId("product-analytics-breakdown-bars")).toBeNull();
  });

  it("a refused breakdown says so in its card, and the rest of the page stays", async () => {
    mockReads({
      breakdown: (): Answer => {
        return new HTTPErrorResponse(
          400,
          { message: "Unknown dimension." },
          {},
        );
      },
    });

    renderPage();

    await waitFor(() => {
      expect(
        within(screen.getByTestId("product-analytics-breakdown")).getByText(
          "Unknown dimension.",
        ),
      ).toBeInTheDocument();
    });

    expect(tileTexts()[0]).toContain("4,000");
  });

  it("the rows a page builds: an empty total is 0%, and a row key is never blank", () => {
    const rows: Array<{ key: string; figures: Array<string> }> =
      buildBreakdownRows({
        breakdown: {
          dimension: ProductAnalyticsDimension.Browser,
          rows: [{ value: "", users: 2, sessions: 3 }],
          hasMore: false,
          totalUsers: 0,
          totalSessions: 0,
        },
        translator: createTranslator(undefined, "en"),
      });

    expect(rows).toEqual([
      expect.objectContaining({
        key: "(none)",
        label: "Not reported",
        value: 2,
        figures: ["2", "3", "0%"],
      }),
    ]);
  });
});

describe("ProductAnalyticsSessions before anything is counted, and when refused", () => {
  it("before the first session: where the numbers will come from, and no cards below", async () => {
    mockReads({ summary: summary({ dataStartedAt: null }) });

    renderPage();

    await waitFor(() => {
      expect(
        document.getElementById("product-analytics-nothing-yet"),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("product-analytics-session-lengths"),
    ).toBeNull();
    expect(screen.queryByTestId("product-analytics-breakdown")).toBeNull();
  });

  it("a refused summary shows the server's words and no tiles", async () => {
    mockReads({
      summary: new HTTPErrorResponse(
        402,
        { message: "Product analytics needs a paid plan." },
        {},
      ),
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("Product analytics needs a paid plan."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByTestId("product-analytics-session-tiles")).toBeNull();
    expect(screen.queryByTestId("product-analytics-breakdown")).toBeNull();
  });

  it("Refresh reads the tiles, the chart and the breakdown again", async () => {
    mockReads({});

    window.history.replaceState(
      null,
      "",
      `${PAGE_PATH}?startTime=2026-09-01T00:00:00.000Z&endTime=2026-09-08T00:00:00.000Z`,
    );

    renderPage();

    await waitForTiles();

    fireEvent.click(
      screen.getByTestId("product-analytics-sessions-toolbar-more"),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Refresh",
      }),
    );

    await waitFor(() => {
      expect(requestsTo("summary")).toHaveLength(2);
      expect(requestsTo("trend")).toHaveLength(2);
      expect(requestsTo("breakdown")).toHaveLength(2);
    });
  });
});
