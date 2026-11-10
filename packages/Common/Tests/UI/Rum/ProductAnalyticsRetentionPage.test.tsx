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
  ALL_COHORTS,
  ProductAnalyticsRetentionAverage,
  ProductAnalyticsRetentionRow,
  RETENTION_AVERAGE_MIN_COHORTS,
  RETENTION_COHORT_COLUMN_CLASS_NAME,
  RETENTION_LIGHT_TEXT_SHADE,
  averageProductAnalyticsRetention,
  buildProductAnalyticsRetentionAverageRow,
  buildProductAnalyticsRetentionRows,
  describeProductAnalyticsCohort,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsRetentionTable";
import { getProductAnalyticsRetentionShade } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsEventsFormat";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

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

// The "All cohorts" row as the reader reads it: its cells' texts, an empty one "".
function averageRow(): Array<string> {
  return Array.from(
    screen.getByTestId("product-analytics-retention-table-average-row")
      .children,
  ).map((cell: Element): string => {
    return (cell.textContent || "").trim();
  });
}

function weekRetention(
  cohorts: ProductAnalyticsRetentionDto["cohorts"],
): ProductAnalyticsRetentionDto {
  return {
    period: ProductAnalyticsRetentionPeriod.Week,
    timeZone: "UTC",
    cohorts: cohorts,
  };
}

type Cohort = ProductAnalyticsRetentionDto["cohorts"][number];

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
    /* A cohort nobody is in has no shares: a share of nobody says nothing. */
    expect(rows[1]!.people).toBe("0");
    expect(rows[1]!.cells).toEqual([null, null, null]);
  });

  test("starts at the first cohort anyone is in: the periods before it are rows of nobody", () => {
    const rows: ReturnType<typeof buildProductAnalyticsRetentionRows> =
      buildProductAnalyticsRetentionRows({
        retention: {
          period: ProductAnalyticsRetentionPeriod.Week,
          timeZone: "UTC",
          cohorts: [
            { start: "2026-09-28", people: 0, returning: [0, 0, 0, 0] },
            { start: "2026-10-05", people: 0, returning: [0, 0, 0] },
            { start: "2026-10-12", people: 3, returning: [3, 1] },
            { start: "2026-10-19", people: 0, returning: [0] },
          ],
        },
        translator: english,
      });

    expect(
      rows.map((row: { cohort: string; people: string }): string => {
        return `${row.cohort}: ${row.people}`;
      }),
    ).toEqual(["Oct 12, 2026: 3", "Oct 19, 2026: 0"]);
    /* Nobody at all: every cohort stays, for the page to say so. */
    expect(
      buildProductAnalyticsRetentionRows({
        retention: {
          period: ProductAnalyticsRetentionPeriod.Week,
          timeZone: "UTC",
          cohorts: [{ start: "2026-10-05", people: 0, returning: [0] }],
        },
        translator: english,
      }),
    ).toHaveLength(1);
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

/*
 * "All cohorts" (issue #6632): above the cohorts, each period's people who
 * came back, summed over the cohorts that have reached it, over those
 * cohorts' people - what a team asks first ("what share comes back after
 * one week?") without reading a whole column.
 */
describe("the All cohorts row", () => {
  test("two cohorts are averaged by their people, not by their shares", () => {
    const dto: ProductAnalyticsRetentionDto = weekRetention([
      { start: "2026-10-05", people: 200, returning: [200, 90] },
      { start: "2026-10-12", people: 100, returning: [100, 30] },
    ]);

    expect(averageProductAnalyticsRetention(dto)).toEqual({
      people: 300,
      periods: [
        { returning: 300, people: 300 },
        { returning: 120, people: 300 },
      ],
    });

    const row: ProductAnalyticsRetentionRow | null =
      buildProductAnalyticsRetentionAverageRow({
        retention: dto,
        translator: english,
      });

    expect(row?.cohort).toBe("All cohorts");
    expect(row?.people).toBe("300");
    /*
     * 45% and 30% average to 37.5% by share; weighted by their people it is
     * 120 of 300: 40%.
     */
    expect(row?.cells[1]).toEqual({
      text: "40%",
      title: "Week 1: 120 of 300 came back (40%)",
      shade: getProductAnalyticsRetentionShade(0.4),
    });
    expect(row?.cells[0]?.text).toBe("100%");
  });

  test("a period only one cohort has reached counts only that cohort", () => {
    const row: ProductAnalyticsRetentionRow | null =
      buildProductAnalyticsRetentionAverageRow({
        retention: weekRetention([
          { start: "2026-10-05", people: 200, returning: [200, 90, 40] },
          { start: "2026-10-12", people: 100, returning: [100, 30, null] },
        ]),
        translator: english,
      });

    /* Week 2 is the older cohort's alone: 40 of its 200, not of all 300. */
    expect(row?.cells[2]).toEqual({
      text: "20%",
      title: "Week 2: 40 of 200 came back (20%)",
      shade: getProductAnalyticsRetentionShade(0.2),
    });
    /* A period no cohort has reached is empty, as a cohort's is. */
    expect(
      buildProductAnalyticsRetentionAverageRow({
        retention: weekRetention([
          { start: "2026-10-05", people: 2, returning: [2, null] },
          { start: "2026-10-12", people: 1, returning: [1, null] },
        ]),
        translator: english,
      })?.cells,
    ).toEqual([
      {
        text: "100%",
        title: "Week 0: 3 of 3 came back (100%)",
        shade: getProductAnalyticsRetentionShade(1),
      },
      null,
    ]);
  });

  test("empty cohorts are ignored: in the people, in each period, and in whether there is a row", () => {
    const withEmpty: ProductAnalyticsRetentionDto = weekRetention([
      { start: "2026-09-28", people: 0, returning: [0, 0, 0, 0] },
      { start: "2026-10-05", people: 200, returning: [200, 90, 40] },
      { start: "2026-10-12", people: 0, returning: [0, 0] },
      { start: "2026-10-19", people: 100, returning: [100] },
    ]);
    const average: ProductAnalyticsRetentionAverage =
      averageProductAnalyticsRetention(withEmpty);

    expect(average.people).toBe(300);
    expect(average.periods).toEqual([
      { returning: 300, people: 300 },
      { returning: 90, people: 200 },
      { returning: 40, people: 200 },
      /* Only the empty cohort reached it: no cohort with anyone in it has. */
      null,
    ]);
    expect(
      buildProductAnalyticsRetentionAverageRow({
        retention: withEmpty,
        translator: english,
      })?.cells.map(
        (cell: ProductAnalyticsRetentionRow["cells"][number]): string => {
          return cell ? cell.text : "";
        },
      ),
    ).toEqual(["100%", "45%", "20%", ""]);

    /*
     * One cohort with anyone in it, however many empty ones: the row would
     * say only what that cohort's own row says, so there is none.
     */
    expect(RETENTION_AVERAGE_MIN_COHORTS).toBe(2);
    expect(
      buildProductAnalyticsRetentionAverageRow({
        retention: weekRetention([
          { start: "2026-10-05", people: 0, returning: [0, 0] },
          { start: "2026-10-12", people: 7, returning: [7, 2] },
          { start: "2026-10-19", people: 0, returning: [0] },
        ]),
        translator: english,
      }),
    ).toBeNull();
    expect(
      buildProductAnalyticsRetentionAverageRow({
        retention: weekRetention([]),
        translator: english,
      }),
    ).toBeNull();
  });

  test("a count that is no number of people counts as nobody, and never makes NaN", () => {
    const average: ProductAnalyticsRetentionAverage =
      averageProductAnalyticsRetention(
        weekRetention([
          {
            start: "2026-10-05",
            people: 10,
            returning: [10, Number.NaN, 4],
          },
          {
            start: "2026-10-12",
            people: Number.POSITIVE_INFINITY,
            returning: [5, 5, 5],
          },
          { start: "2026-10-19", people: -3, returning: [1, 1] },
          { start: "2026-10-26", people: 10, returning: [10, -1, null] },
        ]),
      );

    expect(average).toEqual({
      people: 20,
      periods: [
        { returning: 20, people: 20 },
        { returning: 0, people: 20 },
        { returning: 4, people: 10 },
      ],
    });
  });

  test("seeded: every period is the people who came back over the people who could have, between the cohorts' own shares", () => {
    const random: SeededRandom = seededRandom(6632);

    for (let round: number = 0; round < 300; round++) {
      const periods: number = 1 + random(8);
      const cohorts: Array<Cohort> = [];

      for (let index: number = 0; index < periods; index++) {
        const people: number = random(4) === 0 ? 0 : 1 + random(500);
        const reached: number = periods - index;

        cohorts.push({
          start: `2026-10-${String(1 + index).padStart(2, "0")}`,
          people: people,
          returning: Array.from(
            { length: periods },
            (_value: unknown, period: number): number | null => {
              return period < reached ? random(people + 1) : null;
            },
          ),
        });
      }

      const average: ProductAnalyticsRetentionAverage =
        averageProductAnalyticsRetention(weekRetention(cohorts));
      const withPeople: Array<Cohort> = cohorts.filter(
        (cohort: Cohort): boolean => {
          return cohort.people > 0;
        },
      );
      const sumPeople: (list: Array<Cohort>) => number = (
        list: Array<Cohort>,
      ): number => {
        return list.reduce((sum: number, cohort: Cohort): number => {
          return sum + cohort.people;
        }, 0);
      };

      expect(average.people).toBe(sumPeople(withPeople));

      for (let period: number = 0; period < periods; period++) {
        const reachedIt: Array<Cohort> = withPeople.filter(
          (cohort: Cohort): boolean => {
            return cohort.returning[period] !== null;
          },
        );

        if (reachedIt.length === 0) {
          expect(average.periods[period] ?? null).toBeNull();
          continue;
        }

        const shares: Array<number> = reachedIt.map(
          (cohort: Cohort): number => {
            return (cohort.returning[period] as number) / cohort.people;
          },
        );
        const result: { returning: number; people: number } = average.periods[
          period
        ] as { returning: number; people: number };
        const share: number = result.returning / result.people;

        expect(result.people).toBe(sumPeople(reachedIt));
        expect(result.returning).toBe(
          reachedIt.reduce((sum: number, cohort: Cohort): number => {
            return sum + (cohort.returning[period] as number);
          }, 0),
        );
        expect(share).toBeGreaterThanOrEqual(Math.min(...shares) - 1e-12);
        expect(share).toBeLessThanOrEqual(Math.max(...shares) + 1e-12);
      }
    }
  });

  test("reads in the reader's language: Persian words and Persian digits", () => {
    const persian: Translator = dashboardTranslator("fa");
    const row: ProductAnalyticsRetentionRow | null =
      buildProductAnalyticsRetentionAverageRow({
        retention: weekRetention([
          { start: "2026-10-05", people: 200, returning: [200, 90] },
          { start: "2026-10-12", people: 100, returning: [100, 30] },
        ]),
        translator: persian,
      });

    expect(row?.cohort).toBe(persian.translateText(ALL_COHORTS));
    expect(row?.cohort).not.toBe(ALL_COHORTS);
    expect(row?.people).toBe(persian.formatNumber(300));
    expect(row?.cells[1]?.title).toContain(persian.formatNumber(120));
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
    /*
     * The cohort column holds the table's start edge while a phone scrolls
     * the periods, on the card's background - the left, or the right in a
     * language read right to left.
     */
    expect(RETENTION_COHORT_COLUMN_CLASS_NAME).toBe(
      "sticky start-0 z-10 bg-white",
    );

    const table: HTMLElement = screen.getByTestId(
      "product-analytics-retention-table",
    );

    for (const cohort of [
      within(table).getByRole("columnheader", { name: "Cohort" }),
      ...within(table).getAllByRole("rowheader"),
    ]) {
      expect(cohort.className).toContain(RETENTION_COHORT_COLUMN_CLASS_NAME);
    }
  });

  it("draws All cohorts above the cohorts, weighted by their people, on the sticky cohort column", async () => {
    mockReads({});

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("product-analytics-retention-table-average-row"),
      ).toBeInTheDocument();
    });

    /*
     * 350 people in all; week 1: 90 + 30 + 0 of 350; week 2: 40 + 10 of the
     * 300 whose week 2 has begun; week 3: 20 of the 200 of the first cohort.
     */
    expect(averageRow()).toEqual([
      "All cohorts",
      "350",
      "100%",
      "34%",
      "17%",
      "10%",
    ]);

    const table: HTMLElement = screen.getByTestId(
      "product-analytics-retention-table",
    );
    const rowHeaders: Array<HTMLElement> =
      within(table).getAllByRole("rowheader");

    /* First, before every cohort; on the column that stays in view. */
    expect(
      rowHeaders.map((header: HTMLElement): string => {
        return (header.textContent || "").trim();
      }),
    ).toEqual(["All cohorts", "Oct 5, 2026", "Oct 12, 2026", "Oct 19, 2026"]);
    expect(rowHeaders[0]!.className).toContain(
      RETENTION_COHORT_COLUMN_CLASS_NAME,
    );
    expect(rowHeaders[0]!.className).toContain("font-semibold");

    /* Its cells say their whole sentence, and are shaded like a cohort's. */
    const cells: Array<HTMLElement> = screen.getAllByTestId(
      "product-analytics-retention-table-average-cell",
    );

    expect(
      cells.map((cell: HTMLElement): string | null => {
        return cell.getAttribute("aria-label");
      }),
    ).toEqual([
      "Week 0: 350 of 350 came back (100%)",
      "Week 1: 120 of 350 came back (34%)",
      "Week 2: 50 of 300 came back (17%)",
      "Week 3: 20 of 200 came back (10%)",
    ]);
    expect(cells[1]!.getAttribute("style")).toContain(
      `rgb(79 70 229 / ${getProductAnalyticsRetentionShade(120 / 350)})`,
    );
    /* The cohorts' own rows are as they were. */
    expect(tableRows()).toHaveLength(3);
  });

  it("one cohort with anyone in it: no All cohorts row", async () => {
    mockReads({
      retention: {
        period: "week",
        timeZone: "UTC",
        cohorts: [
          { start: "2026-10-05", people: 0, returning: [0, 0] },
          { start: "2026-10-12", people: 40, returning: [40, 12] },
        ],
      },
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("product-analytics-retention-table-row"),
      ).toHaveLength(1);
    });
    expect(
      screen.queryByTestId("product-analytics-retention-table-average-row"),
    ).not.toBeInTheDocument();
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
