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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import EmbeddedMetricCard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard";
import MonitorMetricsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Metrics";
import SloMetricsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Metrics";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MonitorType from "../../../Types/Monitor/MonitorType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Search from "../../../Types/BaseDatabase/Search";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import TimeRange from "../../../Types/Time/TimeRange";
import ChartTimeReferenceLineProps from "../../../UI/Components/Charts/Types/TimeReferenceLineProps";

/*
 * Exercise real page -> real tab -> real resource metric component -> real
 * EmbeddedMetricCard. Only the shared hook and chart renderer are replaced,
 * exposing the scope each API boundary receives. The hook integration suite
 * separately verifies how this scope filters incidents, alerts and changes.
 */
const hookMock: MockFunction = getJestMockFunction();
const metricViewMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        hookMock(props);
        return {
          lines: [
            {
              date: new Date("2026-09-01T10:30:00.000Z"),
              label: "Incident: scoped incident",
              color: "#f00",
            },
          ],
          markerCount: 1,
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        metricViewMock(props);
        return <div data-testid="metric-view" />;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: unknown) => {
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
        return new ObjectID("0193c0de-5555-4aaa-8bbb-000000000005");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloNoticeBanner",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloHistoryCharts",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

const RESOURCE_ID: string = "0193c0de-5555-4aaa-8bbb-000000000005";
const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/resource"),
  currentProject: null,
  hasPaymentMethod: true,
};
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-09-01T10:00:00.000Z"),
  new Date("2026-09-01T11:00:00.000Z"),
);

interface OverlayProps {
  enabled: boolean;
  window: InBetween<Date>;
  queryConfigs?: Array<MetricQueryConfigData>;
  refreshTick?: number;
}

interface MetricViewProps {
  data: MetricViewData;
  timeReferenceLines?: Array<ChartTimeReferenceLineProps>;
  refreshNonce?: number;
}

function latestOverlay(): OverlayProps {
  return hookMock.mock.calls[
    hookMock.mock.calls.length - 1
  ]![0] as OverlayProps;
}

function assertAllOverlayQueriesHaveScope(
  attributeKey: string,
  membership: boolean = false,
): void {
  expect(hookMock).toHaveBeenCalled();
  for (const [rawProps] of hookMock.mock.calls) {
    const props: OverlayProps = rawProps as OverlayProps;
    expect(props.enabled).toBe(true);
    expect(props.queryConfigs?.length).toBeGreaterThan(0);
    for (const query of props.queryConfigs || []) {
      const attributes: Record<string, unknown> = query.metricQueryData
        .filterData.attributes as Record<string, unknown>;
      if (membership) {
        expect(attributes[attributeKey]).toBeInstanceOf(Search);
        expect((attributes[attributeKey] as Search<string>).toString()).toBe(
          RESOURCE_ID,
        );
      } else {
        expect(attributes[attributeKey]).toBe(RESOURCE_ID);
      }
    }
  }
}

beforeEach(() => {
  hookMock.mockReset();
  metricViewMock.mockReset();
  getItemMock.mockReset();
  analyticsGetListMock.mockReset();
  getItemMock.mockResolvedValue({ monitorType: MonitorType.SyntheticMonitor });
  analyticsGetListMock.mockResolvedValue({
    data: [{ name: "custom.monitor.checkout_latency" }],
  });
});

afterEach(() => {
  cleanup();
});

describe("embedded metric event scope", () => {
  test.each<[string, string, boolean]>([
    ["Monitor Metrics", "monitorId", false],
    ["Custom Metrics", "monitorId", false],
    ["Incident Metrics", "monitorIds", true],
    ["Alert Metrics", "monitorId", false],
  ])(
    "the monitor's %s tab scopes every chart overlay to that monitor",
    async (tabName: string, attributeKey: string, membership: boolean) => {
      render(<MonitorMetricsPage {...PAGE_PROPS} />);
      await screen.findAllByTestId("metric-view");
      const tab: HTMLElement = screen.getByRole("tab", { name: tabName });
      if (tabName !== "Monitor Metrics") {
        hookMock.mockClear();
        fireEvent.click(tab);
      }
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: tabName })).toHaveAttribute(
          "aria-selected",
          "true",
        );
      });
      await waitFor(() => {
        expect(screen.getAllByTestId("metric-view").length).toBeGreaterThan(0);
        assertAllOverlayQueriesHaveScope(attributeKey, membership);
      });
    },
  );

  test.each<[string, string, boolean]>([
    ["SLO Metrics", "sloId", false],
    ["Incident Metrics", "serviceLevelObjectiveIds", true],
    ["Alert Metrics", "serviceLevelObjectiveIds", true],
  ])(
    "the SLO's %s tab scopes every chart overlay to that SLO",
    async (tabName: string, attributeKey: string, membership: boolean) => {
      render(<SloMetricsPage {...PAGE_PROPS} />);
      if (tabName !== "SLO Metrics") {
        hookMock.mockClear();
        fireEvent.click(screen.getByRole("tab", { name: tabName }));
      }
      await waitFor(() => {
        assertAllOverlayQueriesHaveScope(attributeKey, membership);
      });
    },
  );

  test("refreshing a fixed window refreshes the markers along with the metric data", () => {
    const queryConfigs: Array<MetricQueryConfigData> = [
      {
        metricQueryData: {
          filterData: { attributes: { monitorId: RESOURCE_ID } },
        },
      },
    ];
    render(
      <EmbeddedMetricCard
        queryConfigs={queryConfigs}
        defaultTimeRange={{ range: TimeRange.CUSTOM, startAndEndDate: WINDOW }}
      />,
    );
    expect(latestOverlay().refreshTick).toBe(0);
    expect(latestOverlay().queryConfigs).toBe(queryConfigs);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(latestOverlay().refreshTick).toBe(1);
    expect(latestOverlay().window).toEqual(WINDOW);
    expect(latestOverlay().queryConfigs).toBe(queryConfigs);
    const view: MetricViewProps = metricViewMock.mock.calls[
      metricViewMock.mock.calls.length - 1
    ]![0] as MetricViewProps;
    expect(view.refreshNonce).toBe(1);
    expect(
      view.timeReferenceLines?.map((line: ChartTimeReferenceLineProps) => {
        return line.label;
      }),
    ).toEqual(["Incident: scoped incident"]);
  });

  test("resource changes replace the overlay scope even when the time window stays fixed", () => {
    const first: Array<MetricQueryConfigData> = [
      {
        metricQueryData: {
          filterData: { attributes: { "resource.host.id": "host-a" } },
        },
      },
    ];
    const second: Array<MetricQueryConfigData> = [
      {
        metricQueryData: {
          filterData: { attributes: { "resource.host.id": "host-b" } },
        },
      },
    ];
    const { rerender } = render(
      <EmbeddedMetricCard queryConfigs={first} startAndEndDate={WINDOW} />,
    );
    expect(latestOverlay().queryConfigs).toBe(first);
    rerender(
      <EmbeddedMetricCard queryConfigs={second} startAndEndDate={WINDOW} />,
    );
    expect(latestOverlay().queryConfigs).toBe(second);
    expect(latestOverlay().window).toBe(WINDOW);
  });
});
