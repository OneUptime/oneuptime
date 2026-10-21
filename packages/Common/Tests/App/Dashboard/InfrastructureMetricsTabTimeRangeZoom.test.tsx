/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the infrastructure Metrics tab (ResourceMetricsTab), the
 * tab behind the VMware host / VM / cluster / datastore, Proxmox storage,
 * node and guest, and IoT device detail pages. These pages own no range of
 * their own: the tab's card does, so the tab zooms itself.
 *
 *   - a drag on any chart in the tab (its metric charts or the extra charts
 *     below them) narrows the tab's window; a double-click on any of them,
 *     or Reset zoom in the tab's header, puts the range back;
 *   - on a page that zooms, the tab keeps its own zoom: a drag in the tab
 *     never retimes the page, nor does the page's zoom retime the tab.
 *
 * The metric charts (MetricView) and the line chart are stood in for (see
 * TimeRangeZoomPageHarness); ResourceMetricsTab and EmbeddedMetricCard are
 * the production code.
 */

const PARENT_ID: string = "44444444-4444-4444-8444-444444444444";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

function at(time: string): Date {
  return new Date(`2026-09-28T${time}:00.000Z`);
}

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
let mockLastParam: string = "";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("44444444-4444-4444-8444-444444444444");
      },
      getLastParamAsString: (): string => {
        return mockLastParam;
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    const harness: { StandInMetricView: unknown } = jest.requireActual(
      "./TimeRangeZoomPageHarness",
    ) as { StandInMetricView: unknown };
    return { __esModule: true, default: harness.StandInMetricView };
  },
);

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  const harness: { StandInRangeStartAndEndDateView: unknown } =
    jest.requireActual("./TimeRangeZoomPageHarness") as {
      StandInRangeStartAndEndDateView: unknown;
    };
  return {
    __esModule: true,
    default: harness.StandInRangeStartAndEndDateView,
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

import ResourceMetricsTab from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab";
import VMwareHostDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/HostDetail";
import VMwareVirtualMachineDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/VirtualMachineDetail";
import VMwareClusterDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/ClusterDetail";
import VMwareDatastoreDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/DatastoreDetail";
import ProxmoxStorageDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/StorageDetail";
import IoTDeviceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/DeviceDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import LineChartElement from "../../../UI/Components/Charts/Line/LineChart";
import ChartCurve from "../../../UI/Components/Charts/Types/ChartCurve";
import { XAxisAggregateType } from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxisType from "../../../UI/Components/Charts/Types/YAxis/YAxisType";
import { YAxisPrecision } from "../../../UI/Components/Charts/Types/YAxis/YAxis";
import { TimeRangeZoomScope } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import {
  cardPickers,
  chartWindows,
  chartZooms,
  doubleClick,
  dragAcross,
  expectOneSharedZoom,
  flush,
  metricViews,
  resetZoomButtons,
  windowOf,
  zoomCharts,
} from "./TimeRangeZoomPageHarness";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const QUERY_CONFIGS: Array<MetricQueryConfigData> = [
  {
    metricAliasData: { metricVariable: "cpu" },
    metricQueryData: {
      filterData: {
        metricName: "pve_cpu_usage_ratio",
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  } as unknown as MetricQueryConfigData,
];

// A time-series chart drawn over `window`, as the Proxmox rate charts are.
function TimeChart(props: {
  window: InBetween<Date>;
  syncId: string;
}): React.ReactElement {
  return (
    <LineChartElement
      data={[]}
      xAxis={{
        legend: "Time",
        options: {
          type: XAxisType.Time,
          min: props.window.startValue,
          max: props.window.endValue,
          aggregateType: XAxisAggregateType.Average,
        },
      }}
      yAxis={{
        legend: "B/s",
        options: {
          type: YAxisType.Number,
          min: 0,
          max: "auto",
          precision: YAxisPrecision.NoDecimals,
          formatter: (value: number): string => {
            return `${value} B/s`;
          },
        },
      }}
      curve={ChartCurve.MONOTONE}
      sync={false}
      syncid={props.syncId}
    />
  );
}

function renderExtraCharts(window: InBetween<Date>): React.ReactElement {
  return <TimeChart window={window} syncId="extra" />;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  getItemMock.mockReset();
  getListMock.mockReset();
  mockLastParam = "";
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("ResourceMetricsTab owns its range, so it zooms itself", () => {
  test("a drag on its metric chart narrows the tab; a double-click brings the hour back", async () => {
    render(<ResourceMetricsTab queryConfigs={QUERY_CONFIGS} />);
    await flush();

    expect(chartWindows(metricViews())).toEqual([windowOf(at("11:00"), NOW)]);
    expectOneSharedZoom({ zoomed: false, among: metricViews() });

    await dragAcross(metricViews()[0]!, at("11:20"), at("11:30"));

    expect(chartWindows(metricViews())).toEqual([
      windowOf(at("11:20"), at("11:30")),
    ]);
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.CUSTOM);
    expect(resetZoomButtons()).toHaveLength(1);

    await doubleClick(metricViews()[0]!);

    expect(chartWindows(metricViews())).toEqual([windowOf(at("11:00"), NOW)]);
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.PAST_ONE_HOUR);
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("the extra charts draw the tab's window and share its one zoom", async () => {
    render(
      <ResourceMetricsTab
        queryConfigs={QUERY_CONFIGS}
        renderExtraCharts={renderExtraCharts}
      />,
    );
    await flush();

    expectOneSharedZoom({
      zoomed: false,
      among: [...metricViews(), ...zoomCharts()],
    });

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));

    expect(chartWindows([...metricViews(), ...zoomCharts()])).toEqual([
      windowOf(at("11:20"), at("11:30")),
      windowOf(at("11:20"), at("11:30")),
    ]);
    expectOneSharedZoom({
      zoomed: true,
      among: [...metricViews(), ...zoomCharts()],
    });

    // A double-click on the metric chart undoes the extra chart's drag.
    await doubleClick(metricViews()[0]!);

    expect(chartWindows()).toEqual([windowOf(at("11:00"), NOW)]);
  });

  test("Reset zoom in the tab's header does what a double-click does", async () => {
    render(
      <ResourceMetricsTab
        queryConfigs={QUERY_CONFIGS}
        renderExtraCharts={renderExtraCharts}
      />,
    );
    await flush();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));

    fireEvent.click(resetZoomButtons()[0]!);
    await flush();

    expect(chartWindows([...metricViews(), ...zoomCharts()])).toEqual([
      windowOf(at("11:00"), NOW),
      windowOf(at("11:00"), NOW),
    ]);
  });

  test("on a page that zooms, the tab keeps its own zoom and the page keeps its own", async () => {
    const Page: React.FunctionComponent = (): React.ReactElement => {
      const [timeRange, setTimeRange] =
        React.useState<RangeStartAndEndDateTime>({
          range: TimeRange.PAST_ONE_DAY,
        });
      return (
        <TimeRangeZoomScope
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        >
          <span data-testid="page-range">{timeRange.range}</span>
          <TimeChart
            window={
              new InBetween<Date>(new Date("2026-09-27T12:00:00.000Z"), NOW)
            }
            syncId="page"
          />
          <ResourceMetricsTab
            queryConfigs={QUERY_CONFIGS}
            renderExtraCharts={renderExtraCharts}
          />
        </TimeRangeZoomScope>
      );
    };

    render(<Page />);
    await flush();

    const [pageChart, tabChart] = zoomCharts();
    const [pageZoom, tabZoom] = chartZooms([pageChart!, tabChart!]);
    expect(pageZoom!.onTimeRangeSelect).not.toBe(tabZoom!.onTimeRangeSelect);

    // A drag in the tab narrows the tab, never the page.
    await dragAcross(tabChart!, at("11:20"), at("11:30"));

    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.CUSTOM);

    // A drag on the page's own chart retimes the page, not the tab.
    await dragAcross(zoomCharts()[0]!, at("06:00"), at("08:00"));

    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
    expect(chartWindows(metricViews())).toEqual([
      windowOf(at("11:20"), at("11:30")),
    ]);

    // And each double-click undoes only its own zoom.
    await doubleClick(zoomCharts()[1]!);
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.PAST_ONE_HOUR);
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.CUSTOM,
    );

    await doubleClick(zoomCharts()[0]!);
    expect(screen.getByTestId("page-range")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
  });
});

interface DetailPage {
  name: string;
  Page: React.FunctionComponent<PageComponentProps>;
  lastParam: string;
  row: Record<string, unknown>;
}

const DETAIL_PAGES: Array<DetailPage> = [
  {
    name: "VMware ESXi host",
    Page: VMwareHostDetail,
    lastParam: "host%2Fdc1%2Fesx01",
    row: { kind: "Host", externalId: "host/dc1/esx01", name: "esx01" },
  },
  {
    name: "VMware virtual machine",
    Page: VMwareVirtualMachineDetail,
    lastParam: "vm%2Fuuid-1",
    row: { kind: "VirtualMachine", externalId: "vm/uuid-1", name: "web-01" },
  },
  {
    name: "VMware cluster",
    Page: VMwareClusterDetail,
    lastParam: "cluster%2Fdc1%2Fcl1",
    row: { kind: "Cluster", externalId: "cluster/dc1/cl1", name: "cl1" },
  },
  {
    name: "VMware datastore",
    Page: VMwareDatastoreDetail,
    lastParam: "datastore%2Fdc1%2Fds1",
    row: { kind: "Datastore", externalId: "datastore/dc1/ds1", name: "ds1" },
  },
  {
    name: "Proxmox storage",
    Page: ProxmoxStorageDetail,
    lastParam: "storage%2Fpve1%2Flocal",
    row: {
      kind: "Storage",
      externalId: "storage/pve1/local",
      name: "local",
    },
  },
  {
    name: "IoT device",
    Page: IoTDeviceDetail,
    lastParam: "sensor-17",
    row: { externalId: "sensor-17", name: "sensor-17" },
  },
];

describe.each(DETAIL_PAGES)(
  "$name detail: the Metrics tab zooms itself",
  (detail: DetailPage) => {
    async function renderMetricsTab(): Promise<void> {
      mockLastParam = detail.lastParam;
      getItemMock.mockResolvedValue({ _id: PARENT_ID, name: "parent" });
      getListMock.mockResolvedValue({ data: [detail.row], count: 1 });

      render(<detail.Page {...PAGE_PROPS} />);
      await flush();
      fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
      await flush();

      expect(metricViews().length).toBeGreaterThan(0);
    }

    test("a drag narrows the tab's charts; a double-click brings the hour back", async () => {
      await renderMetricsTab();
      const views: number = metricViews().length;

      await dragAcross(metricViews()[0]!, at("11:20"), at("11:30"));

      expect(chartWindows(metricViews())).toEqual(
        Array.from({ length: views }, (): [string, string] => {
          return windowOf(at("11:20"), at("11:30"));
        }),
      );
      expect(resetZoomButtons()).toHaveLength(1);

      await doubleClick(metricViews()[views - 1]!);

      expect(chartWindows(metricViews())).toEqual(
        Array.from({ length: views }, (): [string, string] => {
          return windowOf(at("11:00"), NOW);
        }),
      );
      expect(resetZoomButtons()).toHaveLength(0);
    });
  },
);
