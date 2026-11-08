import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The usage overview both dashboards draw (issue #5916): Project Settings >
 * Telemetry & APM > Usage, and the Admin Dashboard's view of one project. It
 * reads a range of the project's usage - the last 30 complete UTC days
 * first - and draws the totals by signal, each day, and each resource
 * heaviest first, with its retention and, where the reader may see it, its
 * cost. The daily chart is a stand-in: it is recharts, which jsdom cannot
 * measure, and its own helpers are pinned below.
 */

jest.mock(
  "../../../../UI/Components/TelemetryUsage/TelemetryUsageDailyChart",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../UI/Components/TelemetryUsage/TelemetryUsageDailyChart",
    ) as Record<string, unknown>;
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      ...actual,
      __esModule: true,
      default: (props: { days: Array<{ day: string }> }) => {
        return react.createElement("div", {
          "data-testid": "daily-chart",
          "data-days": props.days
            .map((day: { day: string }): string => {
              return day.day;
            })
            .join(","),
        });
      },
    };
  },
);

import TelemetryUsageOverview, {
  sortTelemetryUsageResourceRows,
  TelemetryUsageResourceRow,
  toTelemetryUsageResourceRow,
} from "../../../../UI/Components/TelemetryUsage/TelemetryUsageOverview";
import {
  getChartedSignals,
  toReaderNoon,
} from "../../../../UI/Components/TelemetryUsage/TelemetryUsageDailyChart";
import Route from "../../../../Types/API/Route";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  TelemetryUsageRange,
  TelemetryUsageResourceSummary,
  TelemetryUsageSummary,
} from "../../../../Types/Telemetry/TelemetryUsage";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const GONE_ID: string = "44444444-4444-4444-8444-444444444444";

const NOW: Date = new Date("2026-11-08T09:30:00.000Z");

function resource(
  data: Partial<TelemetryUsageResourceSummary> & {
    primaryEntityId: string;
  },
): TelemetryUsageResourceSummary {
  return {
    primaryEntityType: ServiceType.OpenTelemetry,
    name: null,
    byProduct: {},
    total: { dataIngestedInGB: 0 },
    retentionInDays: 15,
    sessionReplayRetentionInDays: null,
    ...data,
  };
}

function summary(
  overrides?: Partial<TelemetryUsageSummary>,
): TelemetryUsageSummary {
  return {
    startDay: "2026-10-09",
    endDay: "2026-11-07",
    isCostIncluded: false,
    total: { dataIngestedInGB: 13.5 },
    byProduct: {
      [ProductType.Logs]: { dataIngestedInGB: 12 },
      [ProductType.Traces]: { dataIngestedInGB: 1.5 },
    },
    days: [
      {
        day: "2026-11-06",
        byProduct: { [ProductType.Logs]: { dataIngestedInGB: 4 } },
        total: { dataIngestedInGB: 4 },
      },
      {
        day: "2026-11-07",
        byProduct: {
          [ProductType.Logs]: { dataIngestedInGB: 8 },
          [ProductType.Traces]: { dataIngestedInGB: 1.5 },
        },
        total: { dataIngestedInGB: 9.5 },
      },
    ],
    resources: [
      resource({
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
        name: "web-01",
        byProduct: { [ProductType.Logs]: { dataIngestedInGB: 2 } },
        total: { dataIngestedInGB: 2 },
        retentionInDays: 30,
      }),
      resource({
        primaryEntityId: SERVICE_ID,
        name: "checkout",
        byProduct: {
          [ProductType.Logs]: { dataIngestedInGB: 10 },
          [ProductType.Traces]: { dataIngestedInGB: 1.5 },
        },
        total: { dataIngestedInGB: 11.5 },
      }),
      resource({
        primaryEntityId: PROJECT_ID,
        primaryEntityType: ServiceType.Unknown,
        byProduct: { [ProductType.Logs]: { dataIngestedInGB: 0.0005 } },
        total: { dataIngestedInGB: 0.0005 },
      }),
    ],
    latestDay: "2026-11-07",
    ...overrides,
  };
}

let fetchUsage: jest.Mock<
  (range: TelemetryUsageRange) => Promise<TelemetryUsageSummary>
>;

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  fetchUsage = jest.fn(async (): Promise<TelemetryUsageSummary> => {
    return summary();
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderOverview(
  getResourceRoute?: (
    resource: TelemetryUsageResourceSummary,
  ) => Route | undefined,
): void {
  render(
    <TelemetryUsageOverview
      projectId={PROJECT_ID}
      fetchUsage={fetchUsage}
      getResourceRoute={getResourceRoute}
    />,
  );
}

// The resources table's rows: the page's only table, its header row left out.
function resourceRows(): Array<HTMLElement> {
  return screen.getAllByRole("row").filter((row: HTMLElement): boolean => {
    return within(row).queryAllByRole("columnheader").length === 0;
  });
}

describe("the usage overview", () => {
  test("reads the last 30 complete UTC days first: today is still being sent", async () => {
    renderOverview();

    await waitFor(() => {
      expect(fetchUsage).toHaveBeenCalledTimes(1);
    });

    expect(fetchUsage).toHaveBeenCalledWith({
      startDay: "2026-10-09",
      endDay: "2026-11-07",
    });
  });

  test("draws the range's total and a total for each signal it sent", async () => {
    renderOverview();

    expect(
      await screen.findByTestId("telemetry-usage-total"),
    ).toHaveTextContent("13.5 GB");
    expect(
      screen.getByTestId(`telemetry-usage-signal-${ProductType.Logs}`),
    ).toHaveTextContent("12 GB");
    expect(
      screen.getByTestId(`telemetry-usage-signal-${ProductType.Traces}`),
    ).toHaveTextContent("1.5 GB");

    // A signal with nothing in the range has no tile of its own.
    expect(
      screen.queryByTestId(`telemetry-usage-signal-${ProductType.Metrics}`),
    ).toBeNull();
    // Nor is there a cost where the reader may not see it.
    expect(screen.queryByTestId("telemetry-usage-cost")).toBeNull();
  });

  test("charts every day of the range", async () => {
    renderOverview();

    expect(await screen.findByTestId("daily-chart")).toHaveAttribute(
      "data-days",
      "2026-11-06,2026-11-07",
    );
  });

  test("lists each resource heaviest first, linked to its page where it has one", async () => {
    renderOverview((each: TelemetryUsageResourceSummary): Route | undefined => {
      return each.name
        ? new Route(`/dashboard/resources/${each.primaryEntityId}`)
        : undefined;
    });

    await screen.findByText("Usage by Resource");

    const rows: Array<HTMLElement> = resourceRows();

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("checkout");
    expect(rows[0]).toHaveTextContent("11.5 GB");
    expect(rows[1]).toHaveTextContent("web-01");
    expect(rows[1]).toHaveTextContent("Host");
    expect(rows[1]).toHaveTextContent("30 days");
    expect(rows[2]).toHaveTextContent("Unknown Service");
    // Half a megabyte: shown as what it is, never as "0.00 GB".
    expect(rows[2]).toHaveTextContent("524.3 KB");

    const links: Array<HTMLElement> = screen.getAllByTestId(
      "telemetry-usage-resource-link",
    );

    expect(
      links.map((link: HTMLElement): string | null => {
        return link.getAttribute("href");
      }),
    ).toEqual([
      `/dashboard/resources/${SERVICE_ID}`,
      `/dashboard/resources/${HOST_ID}`,
    ]);
  });

  test("names a resource with no page as text, never as a link", async () => {
    renderOverview();

    await screen.findByText("Usage by Resource");

    expect(screen.queryByTestId("telemetry-usage-resource-link")).toBeNull();
    expect(screen.getByText("checkout")).toBeInTheDocument();
  });

  test("draws a signal's column only when the range has some of it", async () => {
    renderOverview();

    await screen.findByText("Usage by Resource");

    const headers: Array<string> = screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return header.textContent || "";
      });

    expect(headers.join("|")).toContain("Logs");
    expect(headers.join("|")).toContain("Traces");
    expect(headers.join("|")).not.toContain("Metrics");
    expect(headers.join("|")).not.toContain("Cost");
  });

  test("says what usage cost where the reader may see it", async () => {
    fetchUsage.mockResolvedValue(
      summary({
        isCostIncluded: true,
        total: { dataIngestedInGB: 13.5, totalCostInUSD: 4.256 },
        resources: [
          resource({
            primaryEntityId: SERVICE_ID,
            name: "checkout",
            byProduct: {
              [ProductType.Logs]: {
                dataIngestedInGB: 13.5,
                totalCostInUSD: 4.256,
              },
            },
            total: { dataIngestedInGB: 13.5, totalCostInUSD: 4.256 },
          }),
        ],
      }),
    );

    renderOverview();

    expect(await screen.findByTestId("telemetry-usage-cost")).toHaveTextContent(
      "4.26 USD",
    );
    expect(
      screen
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return header.textContent || "";
        })
        .join("|"),
    ).toContain("Cost");
  });

  test("reads another range when one is picked", async () => {
    renderOverview();

    await screen.findByTestId("telemetry-usage-total");

    // The range is the page's one combobox, and opens on Last 30 days.
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
    expect(await screen.findByText("Last 7 days")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("Last 90 days"));

    await waitFor(() => {
      expect(fetchUsage).toHaveBeenCalledTimes(2);
    });

    expect(fetchUsage).toHaveBeenLastCalledWith({
      startDay: "2026-08-10",
      endDay: "2026-11-07",
    });
  });

  test("says no usage has been counted yet, and when a day is", async () => {
    fetchUsage.mockResolvedValue(
      summary({
        total: { dataIngestedInGB: 0 },
        byProduct: {},
        days: [],
        resources: [],
        latestDay: null,
      }),
    );

    renderOverview();

    expect(
      await screen.findByText("No telemetry usage yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A day's telemetry is counted once the day has ended in UTC, by about 08:00 UTC the next day. Today's shows up tomorrow.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Usage by Resource")).toBeNull();
  });

  test("says a range is empty when usage was counted before it", async () => {
    fetchUsage.mockResolvedValue(
      summary({
        total: { dataIngestedInGB: 0 },
        byProduct: {},
        days: [],
        resources: [],
        latestDay: "2026-08-02",
      }),
    );

    renderOverview();

    expect(
      await screen.findByText("No telemetry usage in this range"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /^The newest day with usage is .*2026.*\. Choose a longer range to see it\.$/,
      ),
    ).toBeInTheDocument();
  });

  test("says why the usage could not be read, and reads it again on refresh", async () => {
    fetchUsage.mockRejectedValueOnce(new Error("Server is unreachable"));

    renderOverview();

    expect(
      await screen.findByText("Server is unreachable"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(
      await screen.findByTestId("telemetry-usage-total"),
    ).toHaveTextContent("13.5 GB");
    expect(fetchUsage).toHaveBeenCalledTimes(2);
  });
});

describe("the resource rows", () => {
  const translator: ReturnType<typeof createTranslator> = createTranslator(
    undefined,
    "en",
  );

  test("carry each signal's GB, the total and the retention", () => {
    const row: TelemetryUsageResourceRow = toTelemetryUsageResourceRow({
      resource: resource({
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.RealUserMonitor,
        name: "storefront",
        byProduct: {
          [ProductType.Metrics]: { dataIngestedInGB: 0.25 },
          [ProductType.SessionReplay]: { dataIngestedInGB: 3 },
        },
        total: { dataIngestedInGB: 3.25 },
        retentionInDays: 15,
        sessionReplayRetentionInDays: 7,
      }),
      projectId: PROJECT_ID,
      translator: translator,
    });

    expect(row).toEqual(
      expect.objectContaining({
        name: "storefront",
        typeLabel: "RUM Application",
        route: undefined,
        totalGB: 3.25,
        metricsGB: 0.25,
        sessionReplayGB: 3,
        logsGB: 0,
        retention: "15 days · Session replays: 7 days",
      }),
    );
  });

  test("sort by any column, ties by name, either way", () => {
    const rows: Array<TelemetryUsageResourceRow> = [
      { name: "b", primaryEntityId: "2", totalGB: 1, logsGB: 5 },
      { name: "a", primaryEntityId: "1", totalGB: 1, logsGB: 0 },
      { name: "c", primaryEntityId: "3", totalGB: 9, logsGB: 1 },
    ] as Array<TelemetryUsageResourceRow>;

    const names: (sorted: Array<TelemetryUsageResourceRow>) => string = (
      sorted: Array<TelemetryUsageResourceRow>,
    ): string => {
      return sorted
        .map((row: TelemetryUsageResourceRow): string => {
          return row.name;
        })
        .join("");
    };

    expect(
      names(sortTelemetryUsageResourceRows(rows, null, SortOrder.Descending)),
    ).toBe("cab");
    expect(
      names(
        sortTelemetryUsageResourceRows(rows, "logsGB", SortOrder.Descending),
      ),
    ).toBe("bca");
    expect(
      names(sortTelemetryUsageResourceRows(rows, "name", SortOrder.Ascending)),
    ).toBe("abc");
    expect(
      names(
        sortTelemetryUsageResourceRows(rows, "totalGB", SortOrder.Ascending),
      ),
    ).toBe("abc");
  });
});

describe("the daily chart's helpers", () => {
  test("chart only the signals with usage, in their order", () => {
    expect(
      getChartedSignals([
        {
          day: "2026-11-06",
          byProduct: {
            [ProductType.Traces]: { dataIngestedInGB: 1 },
            [ProductType.Metrics]: { dataIngestedInGB: 0 },
          },
          total: { dataIngestedInGB: 1 },
        },
        {
          day: "2026-11-07",
          byProduct: { [ProductType.Logs]: { dataIngestedInGB: 2 } },
          total: { dataIngestedInGB: 2 },
        },
      ]),
    ).toEqual([ProductType.Logs, ProductType.Traces]);
  });

  test("put each UTC day at noon of the same day on the reader's clock", () => {
    const noon: Date = toReaderNoon("2026-11-07");

    expect(noon.getFullYear()).toBe(2026);
    expect(noon.getMonth()).toBe(10);
    expect(noon.getDate()).toBe(7);
    expect(noon.getHours()).toBe(12);
  });

  test("never call a resource that is gone anything but its kind and id", () => {
    const row: TelemetryUsageResourceRow = toTelemetryUsageResourceRow({
      resource: resource({
        primaryEntityId: GONE_ID,
        primaryEntityType: ServiceType.KubernetesCluster,
      }),
      projectId: PROJECT_ID,
      translator: createTranslator(undefined, "en"),
    });

    expect(row.name).toBe("Kubernetes Cluster 44444444");
  });
});
