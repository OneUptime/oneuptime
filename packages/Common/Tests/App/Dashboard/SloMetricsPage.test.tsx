import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The SLO Metrics page stacks the notice banner over four tabs: the
 * oneuptime.slo.* metric cards, the long-range history charts, and the
 * incident / alert metrics of everything affecting the SLO. These tests
 * render the real page and the real Tabs, with each view replaced by a prop
 * recorder, and assert what the page hands each view at runtime: the SLO id
 * from the route, a range shared across the metric cards, the attribute the
 * incident and alert queries match on, and that a tab's view only mounts when
 * the tab is opened. The legacy Charts route is checked alongside it, since it
 * now renders the same history view.
 */

const SLO_ID_STRING: string = "0193c0de-5555-4aaa-8bbb-000000000005";
const PROJECT_ID_STRING: string = "10000000-0000-4000-8000-000000000001";

const embeddedMetricCardMock: MockFunction = getJestMockFunction();
const historyChartsMock: MockFunction = getJestMockFunction();
const noticeBannerMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-5555-4aaa-8bbb-000000000005");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the recorders above are still unassigned when the
 * factory runs.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title?: string }) => {
        embeddedMetricCardMock(props);
        return <div data-testid="embedded-metric-card">{props.title}</div>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloHistoryCharts",
  () => {
    return {
      __esModule: true,
      default: (props: { sloId: { toString: () => string } }) => {
        historyChartsMock(props);
        return (
          <div data-testid="slo-history-charts">{props.sloId.toString()}</div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloNoticeBanner",
  () => {
    return {
      __esModule: true,
      default: (props: { sloId: { toString: () => string } }) => {
        noticeBannerMock(props);
        return (
          <div data-testid="slo-notice-banner">{props.sloId.toString()}</div>
        );
      },
    };
  },
);

import SloChartsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Charts";
import SloMetricsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Metrics";
import type PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import Search from "../../../Types/BaseDatabase/Search";
import MetricQueryConfigData, {
  MetricChartType,
} from "../../../Types/Metrics/MetricQueryConfigData";
import SloMetricType from "../../../Types/ServiceLevelObjective/SloMetricType";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/slo"),
  currentProject: null,
  hasPaymentMethod: true,
};

interface CardProps {
  title?: string;
  description?: string;
  queryConfigs?: Array<MetricQueryConfigData>;
  timeRange?: RangeStartAndEndDateTime;
  onTimeRangeChange?: (newTimeRange: RangeStartAndEndDateTime) => void;
  defaultTimeRange?: RangeStartAndEndDateTime;
}

// The props each card title received on its most recent render.
function latestCardProps(): Map<string, CardProps> {
  const latest: Map<string, CardProps> = new Map<string, CardProps>();

  for (const args of embeddedMetricCardMock.mock.calls) {
    const props: CardProps = args[0] as CardProps;
    latest.set(props.title || "", props);
  }

  return latest;
}

function renderedCardTitles(): Array<string> {
  return screen
    .queryAllByTestId("embedded-metric-card")
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

function openTab(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name: name }));
}

function attributesOf(
  queryConfig: MetricQueryConfigData,
): Record<string, unknown> {
  return queryConfig.metricQueryData.filterData.attributes as Record<
    string,
    unknown
  >;
}

describe("SLO Metrics page", () => {
  afterEach(() => {
    cleanup();
    embeddedMetricCardMock.mockReset();
    historyChartsMock.mockReset();
    noticeBannerMock.mockReset();
  });

  test("shows the notice banner for this SLO above the tabs", () => {
    render(<SloMetricsPage {...PAGE_PROPS} />);

    const banner: HTMLElement = screen.getByTestId("slo-notice-banner");

    expect(banner).toHaveTextContent(SLO_ID_STRING);
    expect(
      banner.compareDocumentPosition(screen.getByRole("tablist")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("offers the four tabs in reading order", () => {
    render(<SloMetricsPage {...PAGE_PROPS} />);

    expect(
      screen.getAllByRole("tab").map((tab: HTMLElement): string => {
        return (tab.textContent || "").trim();
      }),
    ).toEqual([
      "SLO Metrics",
      "Error Budget History",
      "Incident Metrics",
      "Alert Metrics",
    ]);
  });

  test("opens on the SLO metric cards and does not mount the other tabs' views", () => {
    render(<SloMetricsPage {...PAGE_PROPS} />);

    expect(renderedCardTitles()).toEqual(["Objective", "Burn", "Status"]);
    expect(screen.queryByTestId("slo-history-charts")).not.toBeInTheDocument();
    expect(historyChartsMock).not.toHaveBeenCalled();
  });

  test("charts every SLO series once, filtered to this SLO and project", () => {
    render(<SloMetricsPage {...PAGE_PROPS} />);

    const queryConfigs: Array<MetricQueryConfigData> = [
      "Objective",
      "Burn",
      "Status",
    ].flatMap((title: string): Array<MetricQueryConfigData> => {
      return latestCardProps().get(title)?.queryConfigs || [];
    });

    expect(
      queryConfigs
        .map((queryConfig: MetricQueryConfigData): string => {
          return queryConfig.metricQueryData.filterData.metricName as string;
        })
        .sort(),
    ).toEqual([...(Object.values(SloMetricType) as Array<string>)].sort());

    for (const queryConfig of queryConfigs) {
      expect(attributesOf(queryConfig)).toEqual({
        sloId: SLO_ID_STRING,
        projectId: PROJECT_ID_STRING,
      });
    }
  });

  test("the metric cards share one range: picking a range on one card moves them all", () => {
    render(<SloMetricsPage {...PAGE_PROPS} />);

    const before: Map<string, CardProps> = latestCardProps();

    for (const title of ["Objective", "Burn", "Status"]) {
      expect(before.get(title)!.timeRange).toEqual({
        range: TimeRange.PAST_ONE_DAY,
      });
    }

    expect(before.get("Burn")!.onTimeRangeChange).toBe(
      before.get("Objective")!.onTimeRangeChange,
    );

    act(() => {
      before.get("Objective")!.onTimeRangeChange!({
        range: TimeRange.PAST_ONE_WEEK,
      });
    });

    const after: Map<string, CardProps> = latestCardProps();

    for (const title of ["Objective", "Burn", "Status"]) {
      expect(after.get(title)!.timeRange).toEqual({
        range: TimeRange.PAST_ONE_WEEK,
      });
    }
  });

  test("Error Budget History mounts the history charts for this SLO in place of the cards", () => {
    render(<SloMetricsPage {...PAGE_PROPS} />);

    openTab("Error Budget History");

    expect(screen.getByTestId("slo-history-charts")).toHaveTextContent(
      SLO_ID_STRING,
    );
    expect(renderedCardTitles()).toEqual([]);
    // The banner stays above every tab.
    expect(screen.getByTestId("slo-notice-banner")).toBeInTheDocument();
  });

  test.each([
    ["Incident Metrics", "serviceLevelObjectiveIds"],
    ["Alert Metrics", "serviceLevelObjectiveIds"],
  ])(
    "%s shows one card of bar charts matching this SLO on %s, over the past week",
    (tabName: string, attributeKey: string) => {
      render(<SloMetricsPage {...PAGE_PROPS} />);

      openTab(tabName);

      expect(renderedCardTitles()).toEqual([tabName]);

      const card: CardProps = latestCardProps().get(tabName)!;

      expect(card.defaultTimeRange).toEqual({ range: TimeRange.PAST_ONE_WEEK });
      expect(card.queryConfigs!.length).toBeGreaterThan(0);

      for (const queryConfig of card.queryConfigs!) {
        const search: unknown = attributesOf(queryConfig)[attributeKey];

        expect(search).toBeInstanceOf(Search);
        expect((search as Search<string>).value).toBe(SLO_ID_STRING);
        expect(attributesOf(queryConfig)["projectId"]).toBe(PROJECT_ID_STRING);
        expect(queryConfig.chartType).toBe(MetricChartType.BAR);
      }
    },
  );
});

describe("SLO Charts page (legacy route)", () => {
  afterEach(() => {
    cleanup();
    embeddedMetricCardMock.mockReset();
    historyChartsMock.mockReset();
    noticeBannerMock.mockReset();
  });

  test("still shows the banner and the same history charts, for the SLO in the URL", () => {
    render(<SloChartsPage {...PAGE_PROPS} />);

    expect(screen.getByTestId("slo-notice-banner")).toHaveTextContent(
      SLO_ID_STRING,
    );
    expect(screen.getByTestId("slo-history-charts")).toHaveTextContent(
      SLO_ID_STRING,
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(embeddedMetricCardMock).not.toHaveBeenCalled();
  });
});
