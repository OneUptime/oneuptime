import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import Route from "../../../Types/API/Route";
import TimeRange from "../../../Types/Time/TimeRange";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  ProductAnalyticsRetentionDto,
  ProductAnalyticsRetentionPeriod,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import {
  PRODUCT_ANALYTICS_TEST_APP_ID,
  PRODUCT_ANALYTICS_TEST_PROJECT_ID,
  ProductAnalyticsTestAnswer,
  answerProductAnalyticsReads,
  chooseProductAnalyticsOption,
  lastProductAnalyticsRequestTo,
  openProductAnalyticsOptions,
  productAnalyticsTestNames,
} from "./ProductAnalyticsEventsPageKit";

/*
 * Product Analytics > Retention (Pages/Rum/View/ProductAnalyticsRetention.tsx),
 * rendered against mocked reads (issue #6444, part two): people grouped by
 * when they first did the start event, one row a cohort, and the share of
 * each that came back to do the return event in each period after - a
 * period not begun yet left empty, never written as 0. A period the range
 * spans too many of reads as the next longer one, and says so.
 */

const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

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
    },
  };
});

import RumApplicationProductAnalyticsRetention from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/ProductAnalyticsRetention";
import {
  RETENTION_LIGHT_TEXT_SHADE,
  buildProductAnalyticsRetentionRows,
  describeProductAnalyticsCohort,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsRetentionTable";

const PAGE_PATH: string = `/dashboard/${PRODUCT_ANALYTICS_TEST_PROJECT_ID}/rum/${PRODUCT_ANALYTICS_TEST_APP_ID}/product-analytics-retention`;

const english: Translator = createTranslator(undefined, "en");

function retention(data?: JSONObject): JSONObject {
  return {
    period: (data?.["period"] as string) || "week",
    timeZone: "UTC",
    cohorts: [
      { start: "2026-10-05", people: 200, returning: [200, 90, 40, 20] },
      { start: "2026-10-12", people: 100, returning: [100, 30, 10, null] },
      { start: "2026-10-19", people: 50, returning: [50, 0, null, null] },
    ],
  };
}

function mockReads(
  answers: Partial<
    Record<
      string,
      | ProductAnalyticsTestAnswer
      | ((data: JSONObject) => ProductAnalyticsTestAnswer)
    >
  >,
): void {
  answerProductAnalyticsReads(postMock, {
    "event-names": productAnalyticsTestNames(),
    "event-properties": { propertyKeys: ["plan"], userPropertyKeys: ["role"] },
    retention: retention,
    ...(answers as Record<
      string,
      | ProductAnalyticsTestAnswer
      | ((data: JSONObject) => ProductAnalyticsTestAnswer)
    >),
  });
}

function renderPage(search?: string): ReturnType<typeof render> {
  window.history.replaceState(null, "", `${PAGE_PATH}${search || ""}`);

  return render(
    <MemoryRouter>
      <RumApplicationProductAnalyticsRetention
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

function tableRows(): Array<Array<string>> {
  return screen
    .getAllByTestId("product-analytics-retention-table-row")
    .map((row: HTMLElement): Array<string> => {
      return Array.from(row.children).map((cell: Element): string => {
        return (cell.textContent || "").trim();
      });
    });
}

function lastRetentionRequest(): JSONObject {
  return lastProductAnalyticsRequestTo(postMock, "retention");
}

beforeEach(() => {
  postMock.mockReset();
  getItemMock.mockReset();
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      isProductAnalyticsEnabled: true,
      isSessionReplayEnabled: true,
    });
  });
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a retention table's rows", () => {
  const dto: ProductAnalyticsRetentionDto = {
    period: ProductAnalyticsRetentionPeriod.Week,
    timeZone: "UTC",
    cohorts: [
      { start: "2026-10-05", people: 4, returning: [4, 1, null] },
      { start: "2026-10-12", people: 0, returning: [0, null, null] },
    ],
  };

  test("each cohort by its first day; each cell its share, its sentence and its shade; a period not begun empty", () => {
    const rows: ReturnType<typeof buildProductAnalyticsRetentionRows> =
      buildProductAnalyticsRetentionRows({
        retention: dto,
        translator: english,
      });

    expect(rows[0]!.cohort).toBe("Oct 5, 2026");
    expect(rows[0]!.people).toBe("4");
    expect(rows[0]!.cells[0]).toEqual({
      text: "100%",
      title: "Week 0: 4 of 4 came back (100%)",
      shade: 0.8,
    });
    expect(rows[0]!.cells[1]!.text).toBe("25%");
    expect(rows[0]!.cells[1]!.title).toBe("Week 1: 1 of 4 came back (25%)");
    expect(rows[0]!.cells[1]!.shade).toBeLessThan(RETENTION_LIGHT_TEXT_SHADE);
    expect(rows[0]!.cells[2]).toBeNull();
    /* An empty cohort is 0%, never a division by nothing. */
    expect(rows[1]!.cells[0]).toEqual(
      expect.objectContaining({ text: "0%", shade: 0 }),
    );
  });

  test.each([
    [ProductAnalyticsRetentionPeriod.Day, "en", "Oct 5, 2026"],
    [ProductAnalyticsRetentionPeriod.Week, "de", "5. Okt. 2026"],
    [ProductAnalyticsRetentionPeriod.Month, "en", "October 2026"],
    [ProductAnalyticsRetentionPeriod.Month, "fr", "octobre 2026"],
  ])(
    "a %s cohort in %s reads %p",
    (
      period: ProductAnalyticsRetentionPeriod,
      language: string,
      expected: string,
    ) => {
      expect(
        describeProductAnalyticsCohort({
          start:
            period === ProductAnalyticsRetentionPeriod.Month
              ? "2026-10-01"
              : "2026-10-05",
          period: period,
          language: language,
        }),
      ).toBe(expected);
    },
  );

  test("a start that is not a day is shown as it came", () => {
    expect(
      describeProductAnalyticsCohort({
        start: "soon",
        period: ProductAnalyticsRetentionPeriod.Day,
        language: "en",
      }),
    ).toBe("soon");
  });
});

describe("ProductAnalyticsRetention", () => {
  it("opens on who came back for another session, by week, in the reader's zone", async () => {
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-retention-table-row"),
      ).toHaveLength(3);
    });

    const request: JSONObject = lastRetentionRequest();

    expect(request["startEvent"]).toEqual({ kind: "session", name: "" });
    expect(request["returnEvent"]).toEqual({ kind: "session", name: "" });
    expect(request["period"]).toBe("week");
    expect(request["filters"]).toEqual([]);
    expect(typeof request["timeZone"]).toBe("string");
    expect(request["rumApplicationId"]).toBe(PRODUCT_ANALYTICS_TEST_APP_ID);
    expect(tableRows()).toEqual([
      ["Oct 5, 2026", "200", "100%", "45%", "20%", "10%"],
      ["Oct 12, 2026", "100", "100%", "30%", "10%", ""],
      ["Oct 19, 2026", "50", "100%", "0%", "", ""],
    ]);
    expect(
      within(screen.getByTestId("product-analytics-retention-table"))
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return (header.textContent || "").trim();
        }),
    ).toEqual(["Cohort", "People", "Week 0", "Week 1", "Week 2", "Week 3"]);
    expect(
      screen.getAllByTestId("product-analytics-retention-table-empty"),
    ).toHaveLength(3);
    expect(window.location.search).toBe("");
  });

  it("picks the start and the return events, and keeps them in the address", async () => {
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-retention-table-row"),
      ).toHaveLength(3);
    });
    await chooseProductAnalyticsOption(
      screen.getByRole("combobox", { name: "People who did" }),
      "Signed up",
    );
    await chooseProductAnalyticsOption(
      screen.getByRole("combobox", { name: "And came back to do" }),
      "Purchased",
    );

    await waitFor(() => {
      expect(lastRetentionRequest()["returnEvent"]).toEqual({
        kind: "custom",
        name: "Purchased",
      });
    });
    expect(lastRetentionRequest()["startEvent"]).toEqual({
      kind: "custom",
      name: "Signed up",
    });
    /* The segment offers the start event's people's properties. */
    expect(
      lastProductAnalyticsRequestTo(postMock, "event-properties")["event"],
    ).toEqual({ kind: "custom", name: "Signed up" });

    const params: URLSearchParams = new URLSearchParams(window.location.search);

    expect(params.get("start")).toBe("custom:Signed up");
    expect(params.get("return")).toBe("custom:Purchased");
  });

  it("by day over the default month: one row a day, with no note", async () => {
    mockReads({});

    renderPage("?per=day");

    await waitFor(() => {
      expect(lastRetentionRequest()["period"]).toBe("day");
    });
    expect(
      screen.queryByTestId("product-analytics-retention-period-fitted"),
    ).not.toBeInTheDocument();
  });

  it("by day over three months: read by week, and the page says why", async () => {
    mockReads({});

    renderPage(
      `?range=${encodeURIComponent(TimeRange.PAST_THREE_MONTHS)}&per=day`,
    );

    await waitFor(() => {
      expect(lastRetentionRequest()["period"]).toBe("week");
    });
    expect(
      await screen.findByTestId("product-analytics-retention-period-fitted"),
    ).toHaveTextContent(
      "This range has too many periods to show one row each, so its cohorts are longer.",
    );
    /* The picker shows the period read. */
    expect(screen.getByText("By week")).toBeInTheDocument();
  });

  it("offers the three periods, and a new one reads again", async () => {
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-retention-table-row"),
      ).toHaveLength(3);
    });

    const periodPicker: HTMLElement = screen.getByRole("combobox", {
      name: "Cohorts",
    });

    expect(openProductAnalyticsOptions(periodPicker)).toEqual([
      "By day",
      "By week",
      "By month",
    ]);
    await chooseProductAnalyticsOption(periodPicker, "By month");

    await waitFor(() => {
      expect(lastRetentionRequest()["period"]).toBe("month");
    });
    expect(new URLSearchParams(window.location.search).get("per")).toBe(
      "month",
    );
  });

  it("says so when nobody did the start event", async () => {
    mockReads({
      retention: {
        period: "week",
        timeZone: "UTC",
        cohorts: [{ start: "2026-10-05", people: 0, returning: [0] }],
      },
    });

    renderPage();

    expect(
      await screen.findByTestId("product-analytics-retention-nobody"),
    ).toHaveTextContent(
      "Nobody did the start event in this range and segment.",
    );
    expect(
      screen.queryByTestId("product-analytics-retention-table"),
    ).not.toBeInTheDocument();
  });

  it("a refused read says why", async () => {
    mockReads({
      retention: new HTTPErrorResponse(
        400,
        {
          message:
            "A week retention read covers at most 26 weeks. Choose a shorter range or a longer period.",
        },
        {},
      ),
    });

    renderPage();

    expect(
      await screen.findByText(
        "A week retention read covers at most 26 weeks. Choose a shorter range or a longer period.",
      ),
    ).toBeInTheDocument();
  });

  it("events on and none sent yet: the calls that send them, no table", async () => {
    mockReads({
      "event-names": productAnalyticsTestNames({
        events: [],
        dataStartedAt: null,
      }),
    });

    renderPage();

    expect(await screen.findByText("No events yet")).toBeInTheDocument();
    expect(
      screen.queryByTestId("product-analytics-retention-page"),
    ).not.toBeInTheDocument();
  });
});
