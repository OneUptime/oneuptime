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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the storage array pages. Every time-series chart on them
 * zooms the range it is drawn over, and a double-click on any of them (or
 * "Reset zoom" in the card header) puts the range back:
 *
 *   - Overview: the Golden Signals card's range is the PAGE's (the
 *     auto-refresh slides it), so a zoom there is the page's zoom, pinned
 *     across auto-refresh ticks until it is reset;
 *   - Resource Usage (Insights): every card shares the page's one range, so
 *     they share one zoom - a drag in one card retimes them all, a
 *     double-click in any card resets them all;
 *   - Volume and file system detail, Metrics tab: the tab's card owns its
 *     range and its zoom.
 *
 * Alongside the zoom, the charts must be the array's own: every query is
 * pinned to the array's name, a detail tab's to the object's name as
 * well, and each platform gets its own catalog.
 *
 * The network is replaced (model and analytics APIs), and so are the
 * MetricView inside each card (its own zoom handling has its own suite: the
 * stand-in records the handlers and queries the card hands it and the
 * window it is asked for) and the card's range picker (a stand-in that
 * shows the range and can pick "Past 1 Day"). EmbeddedMetricCard, the
 * pages, StorageArrayResourceDetail and ResourceMetricsTab render for real.
 */

const ARRAY_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const ARRAY_NAME: string = "fa-prod-01";
const NOW: Date = new Date("2026-10-05T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const ZOOM_START: Date = new Date("2026-10-05T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-10-05T11:40:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-10-05T11:25:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-10-05T11:30:00.000Z");
const ARRAY_ATTRIBUTE: string = "resource.storage.array.name";

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

let mockLastParam: string = "";

// The window the next "drag" on a stand-in MetricView selects.
const mockDrag: { start: Date; end: Date } = {
  start: new Date(0),
  end: new Date(0),
};

interface MockQueryConfig {
  metricAliasData?: { metricVariable?: string; title?: string };
  metricQueryData?: {
    filterData?: {
      metricName?: string;
      attributes?: Record<string, unknown>;
    };
    groupByAttributeKeys?: Array<string>;
  };
}

interface MockMetricViewProps {
  data: {
    startAndEndDate: { startValue: Date; endValue: Date };
    queryConfigs: Array<MockQueryConfig>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

// The latest props of each MetricView, by its query variables.
const mockMetricViews: Map<string, MockMetricViewProps> = new Map();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (props: MockMetricViewProps): React.ReactElement => {
        const name: string = props.data.queryConfigs
          .map((query: MockQueryConfig) => {
            return query.metricAliasData?.metricVariable || "";
          })
          .join("+");
        mockMetricViews.set(name, props);
        return (
          <div
            data-testid={`metric-view ${name}`}
            onDoubleClick={props.onTimeRangeReset}
          >
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(mockDrag.start, mockDrag.end);
              }}
            >
              {`Drag across metrics ${name}`}
            </button>
          </div>
        );
      },
    };
  },
);

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

// Each card's picker: shows its range, and can pick "Past 1 Day".
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (value: { range: string }) => void;
    }): React.ReactElement => {
      return (
        <button
          type="button"
          data-testid="card-picker"
          onClick={() => {
            props.onChange({ range: "Past 1 Day" });
          }}
        >
          {props.dashboardStartAndEndDate.range}
        </button>
      );
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return modelGetItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return modelGetListMock(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(1);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return analyticsGetListMock(...args);
      },
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
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
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
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

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="card-model-detail" />;
    },
  };
});

/*
 * The hero's refresh control: "Refresh now" is what an auto-refresh tick
 * calls too (fetchAll(false)).
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: { onManualRefresh: () => void }): React.ReactElement => {
        return (
          <button type="button" onClick={props.onManualRefresh}>
            Refresh now
          </button>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: () => {},
        };
      },
    };
  },
);

import StorageArrayOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import StorageArrayInsights, {
  FLASHARRAY_INSIGHTS_SECTIONS,
  FLASHBLADE_INSIGHTS_SECTIONS,
  InsightsSection,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Insights";
import StorageArrayVolumeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/VolumeDetail";
import StorageArrayFileSystemDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/FileSystemDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TimeRange from "../../../Types/Time/TimeRange";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- fixtures

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

type Row = Record<string, unknown>;

function arrayFixture(storageSystem: string | undefined): Row {
  return {
    _id: ARRAY_ID,
    name: ARRAY_NAME,
    storageSystem: storageSystem,
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    osName: "Purity//FA",
    osVersion: "6.7.2",
    capacityBytes: 100 * 1024 ** 4,
    usedBytes: 40 * 1024 ** 4,
    capacityUsedPercent: 40,
    dataReductionRatio: 4.2,
    openAlertCount: 0,
    criticalAlertCount: 0,
    warningAlertCount: 0,
    volumeCount: 1,
    hostCount: 1,
    podCount: 0,
    fileSystemCount: 1,
    bucketCount: 0,
    hardwareComponentCount: 12,
    unhealthyHardwareCount: 0,
    healthStatus: 0,
  };
}

const VOLUME_ID: string = "vg1/vol-db-01";
const FILE_SYSTEM_ID: string = "home";

const ROWS: Array<Row> = [
  {
    kind: "Volume",
    externalId: VOLUME_ID,
    name: VOLUME_ID,
    capacityBytes: 2 * 1024 ** 4,
    usedBytes: 300 * 1024 ** 3,
    readLatencyUsec: 250,
    writeLatencyUsec: 410,
    metricsUpdatedAt: minutesAgo(1),
    lastSeenAt: minutesAgo(1),
  },
  {
    kind: "FileSystem",
    externalId: FILE_SYSTEM_ID,
    name: FILE_SYSTEM_ID,
    usedBytes: 800 * 1024 ** 3,
    metricsUpdatedAt: minutesAgo(1),
    lastSeenAt: minutesAgo(1),
  },
];

let mockArray: Row = arrayFixture(StorageSystem.PureStorageFlashArray);

function arrange(): void {
  modelGetItemMock.mockImplementation(async () => {
    return mockArray;
  });

  modelGetListMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> = (
      args as { query: Record<string, unknown> }
    ).query;
    // The detail pages look one object up by its kind and externalId.
    const rows: Array<Row> =
      typeof query["kind"] === "string" && query["externalId"]
        ? ROWS.filter((row: Row) => {
            return (
              row["kind"] === query["kind"] &&
              row["externalId"] === query["externalId"]
            );
          })
        : [];
    return { data: rows, count: rows.length, skip: 0, limit: 100 };
  });

  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
}

// ----------------------------------------------------------------- helpers

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function metricView(name: string): MockMetricViewProps {
  const props: MockMetricViewProps | undefined = mockMetricViews.get(name);
  if (!props) {
    throw new Error(
      `MetricView "${name}" has not rendered. Rendered: ${Array.from(
        mockMetricViews.keys(),
      ).join(", ")}`,
    );
  }
  return props;
}

function metricViewWindow(name: string): [string, string] {
  const window: { startValue: Date; endValue: Date } =
    metricView(name).data.startAndEndDate;
  return [window.startValue.toISOString(), window.endValue.toISOString()];
}

function metricViewMinutes(name: string): number {
  const window: { startValue: Date; endValue: Date } =
    metricView(name).data.startAndEndDate;
  return (window.endValue.getTime() - window.startValue.getTime()) / MINUTE;
}

function attributesOf(name: string): Array<Record<string, unknown>> {
  return metricView(name).data.queryConfigs.map(
    (query: MockQueryConfig): Record<string, unknown> => {
      return query.metricQueryData?.filterData?.attributes || {};
    },
  );
}

const ZOOM_WINDOW: [string, string] = [
  ZOOM_START.toISOString(),
  ZOOM_END.toISOString(),
];

async function dragAcrossMetrics(
  name: string,
  start: Date = ZOOM_START,
  end: Date = ZOOM_END,
): Promise<void> {
  mockDrag.start = start;
  mockDrag.end = end;
  fireEvent.click(
    screen.getByRole("button", { name: `Drag across metrics ${name}` }),
  );
  await flush();
}

async function doubleClickMetrics(name: string): Promise<void> {
  fireEvent.doubleClick(screen.getByTestId(`metric-view ${name}`));
  await flush();
}

function pickers(): Array<string> {
  return screen
    .getAllByTestId("card-picker")
    .map((picker: HTMLElement): string => {
      return picker.textContent || "";
    });
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

// A section's MetricView, named as the stand-in names it.
function sectionMetricView(section: InsightsSection): string {
  return section.metricIds
    .map((metricId: string): string => {
      return metricId.replace(/-/g, "_");
    })
    .join("+");
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockLastParam = "";
  mockArray = arrayFixture(StorageSystem.PureStorageFlashArray);
  mockMetricViews.clear();
  mockDrag.start = new Date(0);
  mockDrag.end = new Date(0);
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    analyticsGetListMock,
  ]) {
    mock.mockReset();
  }
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// --------------------------------------------------------------- Overview

const FLASHARRAY_GOLDEN_METRICS: string = [
  "purefa_array_read_latency",
  "purefa_array_write_latency",
  "purefa_array_read_iops",
  "purefa_array_write_iops",
  "purefa_array_read_bandwidth",
  "purefa_array_write_bandwidth",
  "purefa_array_space_utilization",
].join("+");

const FLASHBLADE_GOLDEN_METRICS: string = [
  "purefb_array_read_latency",
  "purefb_array_write_latency",
  "purefb_array_read_iops",
  "purefb_array_write_iops",
  "purefb_array_read_bandwidth",
  "purefb_array_write_bandwidth",
  "purefb_array_space_utilization",
].join("+");

async function renderOverview(
  goldenMetrics: string = FLASHARRAY_GOLDEN_METRICS,
): Promise<void> {
  render(<StorageArrayOverview {...PAGE_PROPS} />);
  await flush();
  await waitFor(() => {
    expect(
      screen.getByTestId(`metric-view ${goldenMetrics}`),
    ).toBeInTheDocument();
  });
}

describe("Storage array Overview: the Golden Signals card zooms the page's range", () => {
  test("the card charts the array's own latency, IOPS, bandwidth and capacity", async () => {
    await renderOverview();

    expect(screen.getByText("Golden Signals")).toBeInTheDocument();
    for (const attributes of attributesOf(FLASHARRAY_GOLDEN_METRICS)) {
      expect(attributes[ARRAY_ATTRIBUTE]).toBe(ARRAY_NAME);
    }
    // One picker, on the page's past hour; nothing zoomed yet.
    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(FLASHARRAY_GOLDEN_METRICS)).toBe(60);
    expect(
      metricView(FLASHARRAY_GOLDEN_METRICS).onTimeRangeSelect,
    ).toBeInstanceOf(Function);
    expect(
      metricView(FLASHARRAY_GOLDEN_METRICS).onTimeRangeReset,
    ).toBeUndefined();
    expect(resetButtons()).toHaveLength(0);
  });

  test("a FlashBlade's card charts the FlashBlade's series", async () => {
    mockArray = arrayFixture(StorageSystem.PureStorageFlashBlade);

    await renderOverview(FLASHBLADE_GOLDEN_METRICS);

    for (const attributes of attributesOf(FLASHBLADE_GOLDEN_METRICS)) {
      expect(attributes[ARRAY_ATTRIBUTE]).toBe(ARRAY_NAME);
    }
    expect(
      Array.from(mockMetricViews.keys()).some((name: string) => {
        return name.includes("purefa_");
      }),
    ).toBe(false);
  });

  test("an array that has not reported its platform has no golden charts, and the page still renders", async () => {
    mockArray = arrayFixture(undefined);

    render(<StorageArrayOverview {...PAGE_PROPS} />);
    await flush();
    await waitFor(() => {
      expect(screen.getAllByText(ARRAY_NAME).length).toBeGreaterThan(0);
    });

    expect(mockMetricViews.size).toBe(0);
    expect(screen.queryByText("Golden Signals")).not.toBeInTheDocument();
  });

  test("a drag narrows the charts to the dragged window; the picker reads Custom and the header offers Reset zoom", async () => {
    await renderOverview();

    await dragAcrossMetrics(FLASHARRAY_GOLDEN_METRICS);

    expect(metricViewWindow(FLASHARRAY_GOLDEN_METRICS)).toEqual(ZOOM_WINDOW);
    expect(pickers()).toEqual([TimeRange.CUSTOM]);
    expect(resetButtons()).toHaveLength(1);
    expect(
      metricView(FLASHARRAY_GOLDEN_METRICS).onTimeRangeReset,
    ).toBeInstanceOf(Function);
  });

  test("a double-click on the chart puts the past hour back", async () => {
    await renderOverview();

    await dragAcrossMetrics(FLASHARRAY_GOLDEN_METRICS);
    await doubleClickMetrics(FLASHARRAY_GOLDEN_METRICS);

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(FLASHARRAY_GOLDEN_METRICS)).toBe(60);
    expect(resetButtons()).toHaveLength(0);
    expect(
      metricView(FLASHARRAY_GOLDEN_METRICS).onTimeRangeReset,
    ).toBeUndefined();
  });

  test("Reset zoom in the card header puts the range back", async () => {
    await renderOverview();

    await dragAcrossMetrics(FLASHARRAY_GOLDEN_METRICS);
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(FLASHARRAY_GOLDEN_METRICS)).toBe(60);
    expect(resetButtons()).toHaveLength(0);
  });

  test("a zoom within a zoom: one double-click returns to the past hour", async () => {
    await renderOverview();

    await dragAcrossMetrics(FLASHARRAY_GOLDEN_METRICS);
    await dragAcrossMetrics(
      FLASHARRAY_GOLDEN_METRICS,
      INNER_ZOOM_START,
      INNER_ZOOM_END,
    );
    expect(metricViewWindow(FLASHARRAY_GOLDEN_METRICS)).toEqual([
      INNER_ZOOM_START.toISOString(),
      INNER_ZOOM_END.toISOString(),
    ]);

    await doubleClickMetrics(FLASHARRAY_GOLDEN_METRICS);

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(FLASHARRAY_GOLDEN_METRICS)).toBe(60);
  });

  test("an auto-refresh leaves a zoom pinned; after a reset it slides the past hour again", async () => {
    await renderOverview();

    await dragAcrossMetrics(FLASHARRAY_GOLDEN_METRICS);

    // A minute later, the auto-refresh ticks.
    jest.setSystemTime(new Date(NOW.getTime() + MINUTE));
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await flush();

    expect(metricViewWindow(FLASHARRAY_GOLDEN_METRICS)).toEqual(ZOOM_WINDOW);
    expect(resetButtons()).toHaveLength(1);

    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();
    const before: string = metricViewWindow(FLASHARRAY_GOLDEN_METRICS)[1];

    jest.setSystemTime(new Date(NOW.getTime() + 2 * MINUTE));
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await flush();

    // The preset slides forward with the clock again.
    expect(
      Date.parse(metricViewWindow(FLASHARRAY_GOLDEN_METRICS)[1]),
    ).toBeGreaterThan(Date.parse(before));
    expect(metricViewMinutes(FLASHARRAY_GOLDEN_METRICS)).toBe(60);
  });

  test("the card's own Refresh keeps the zoom", async () => {
    await renderOverview();

    await dragAcrossMetrics(FLASHARRAY_GOLDEN_METRICS);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await flush();

    expect(pickers()).toEqual([TimeRange.CUSTOM]);
    expect(metricViewWindow(FLASHARRAY_GOLDEN_METRICS)).toEqual(ZOOM_WINDOW);
    expect(resetButtons()).toHaveLength(1);
  });

  test("picking a range in the card's picker ends the zoom", async () => {
    await renderOverview();

    await dragAcrossMetrics(FLASHARRAY_GOLDEN_METRICS);
    fireEvent.click(screen.getByTestId("card-picker"));
    await flush();

    expect(pickers()).toEqual([TimeRange.PAST_ONE_DAY]);
    expect(metricViewMinutes(FLASHARRAY_GOLDEN_METRICS)).toBe(24 * 60);
    expect(resetButtons()).toHaveLength(0);
  });
});

// ------------------------------------------------ Resource Usage (Insights)

async function renderInsights(
  sections: Array<InsightsSection>,
): Promise<Array<string>> {
  const names: Array<string> = sections.map(sectionMetricView);
  render(<StorageArrayInsights {...PAGE_PROPS} />);
  await flush();
  await waitFor(() => {
    for (const name of names) {
      expect(screen.getByTestId(`metric-view ${name}`)).toBeInTheDocument();
    }
  });
  return names;
}

function expectEveryCardOn(
  names: Array<string>,
  window: [string, string],
): void {
  for (const name of names) {
    expect([name, ...metricViewWindow(name)]).toEqual([name, ...window]);
  }
}

function expectEveryCardOnThePastHour(names: Array<string>): void {
  for (const name of names) {
    expect([name, metricViewMinutes(name)]).toEqual([name, 60]);
  }
  expect(pickers()).toEqual(
    names.map(() => {
      return TimeRange.PAST_ONE_HOUR;
    }),
  );
  expect(resetButtons()).toHaveLength(0);
}

describe("Storage array Resource Usage: every card shares one range and one zoom", () => {
  test("a FlashArray gets one card per section, every chart pinned to the array", async () => {
    const names: Array<string> = await renderInsights(
      FLASHARRAY_INSIGHTS_SECTIONS,
    );

    expect(names).toHaveLength(6);
    expect(pickers()).toHaveLength(6);
    for (const name of names) {
      for (const attributes of attributesOf(name)) {
        expect([name, attributes[ARRAY_ATTRIBUTE]]).toEqual([name, ARRAY_NAME]);
      }
    }
  });

  test("the per-object cards split their charts by the label that names the object", async () => {
    await renderInsights(FLASHARRAY_INSIGHTS_SECTIONS);

    const groupBy: (key: string) => Array<Array<string> | undefined> = (
      key: string,
    ): Array<Array<string> | undefined> => {
      const section: InsightsSection = FLASHARRAY_INSIGHTS_SECTIONS.find(
        (candidate: InsightsSection) => {
          return candidate.key === key;
        },
      )!;
      return metricView(sectionMetricView(section)).data.queryConfigs.map(
        (query: MockQueryConfig) => {
          return query.metricQueryData?.groupByAttributeKeys;
        },
      );
    };

    expect(groupBy("volumes")).toEqual([
      ["name"],
      ["name"],
      ["name"],
      ["name"],
    ]);
    expect(groupBy("hosts")).toEqual([["host"], ["host"]]);
    // Whole-array cards are not split.
    expect(groupBy("capacity")).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("every chart in every card takes the same page zoom", async () => {
    const names: Array<string> = await renderInsights(
      FLASHARRAY_INSIGHTS_SECTIONS,
    );

    const select: unknown = metricView(names[0]!).onTimeRangeSelect;
    expect(select).toBeInstanceOf(Function);
    for (const name of names) {
      expect([name, metricView(name).onTimeRangeSelect]).toEqual([
        name,
        select,
      ]);
    }
  });

  test("a drag in the Capacity card retimes every card", async () => {
    const names: Array<string> = await renderInsights(
      FLASHARRAY_INSIGHTS_SECTIONS,
    );

    await dragAcrossMetrics(names[0]!);

    expectEveryCardOn(names, ZOOM_WINDOW);
    expect(pickers()).toEqual(
      names.map(() => {
        return TimeRange.CUSTOM;
      }),
    );
    // Every card's header offers the way back.
    expect(resetButtons()).toHaveLength(names.length);
  });

  test("a double-click in ANOTHER card undoes the zoom in every card", async () => {
    const names: Array<string> = await renderInsights(
      FLASHARRAY_INSIGHTS_SECTIONS,
    );

    await dragAcrossMetrics(names[0]!);
    await doubleClickMetrics(names[names.length - 1]!);

    expectEveryCardOnThePastHour(names);
  });

  test("Reset zoom in any card's header resets them all", async () => {
    const names: Array<string> = await renderInsights(
      FLASHARRAY_INSIGHTS_SECTIONS,
    );

    await dragAcrossMetrics(names[1]!);
    fireEvent.click(resetButtons()[names.length - 1]!);
    await flush();

    expectEveryCardOnThePastHour(names);
  });

  test("a zoom within a zoom across cards: one reset goes back to the past hour", async () => {
    const names: Array<string> = await renderInsights(
      FLASHARRAY_INSIGHTS_SECTIONS,
    );

    await dragAcrossMetrics(names[0]!);
    await dragAcrossMetrics(names[2]!, INNER_ZOOM_START, INNER_ZOOM_END);
    expectEveryCardOn(names, [
      INNER_ZOOM_START.toISOString(),
      INNER_ZOOM_END.toISOString(),
    ]);

    await doubleClickMetrics(names[1]!);

    expectEveryCardOnThePastHour(names);
  });

  test("a card's Refresh keeps the zoom for every card", async () => {
    const names: Array<string> = await renderInsights(
      FLASHARRAY_INSIGHTS_SECTIONS,
    );

    await dragAcrossMetrics(names[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[2]!);
    await flush();

    expectEveryCardOn(names, ZOOM_WINDOW);
    expect(resetButtons()).toHaveLength(names.length);
  });

  test("picking a range in one card ends the zoom in all of them", async () => {
    const names: Array<string> = await renderInsights(
      FLASHARRAY_INSIGHTS_SECTIONS,
    );

    await dragAcrossMetrics(names[0]!);
    fireEvent.click(screen.getAllByTestId("card-picker")[1]!);
    await flush();

    expect(pickers()).toEqual(
      names.map(() => {
        return TimeRange.PAST_ONE_DAY;
      }),
    );
    expect(resetButtons()).toHaveLength(0);
    for (const name of names) {
      expect([name, metricViewMinutes(name)]).toEqual([name, 24 * 60]);
    }
  });

  test("a FlashBlade gets its own sections, and they share the zoom too", async () => {
    mockArray = arrayFixture(StorageSystem.PureStorageFlashBlade);

    const names: Array<string> = await renderInsights(
      FLASHBLADE_INSIGHTS_SECTIONS,
    );

    expect(names).toHaveLength(5);
    expect(
      Array.from(mockMetricViews.keys()).some((name: string) => {
        return name.includes("purefa_");
      }),
    ).toBe(false);

    await dragAcrossMetrics(names[names.length - 1]!);
    expectEveryCardOn(names, ZOOM_WINDOW);

    await doubleClickMetrics(names[0]!);
    expectEveryCardOnThePastHour(names);
  });

  test("an array that has not reported its platform says why there are no charts", async () => {
    mockArray = arrayFixture(undefined);

    render(<StorageArrayInsights {...PAGE_PROPS} />);
    await flush();

    await waitFor(() => {
      expect(screen.getByText("Resource Usage")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/depend on the array's platform/),
    ).toBeInTheDocument();
    expect(mockMetricViews.size).toBe(0);
  });
});

// ------------------------------------------ Volume and file system detail

const VOLUME_METRICS: string = [
  "purefa_volume_read_latency",
  "purefa_volume_write_latency",
  "purefa_volume_read_iops",
  "purefa_volume_write_iops",
  "purefa_volume_read_bandwidth",
  "purefa_volume_write_bandwidth",
  "purefa_volume_physical",
  "purefa_volume_data_reduction",
].join("+");

const FILE_SYSTEM_METRICS: string = [
  "purefb_fs_read_latency",
  "purefb_fs_write_latency",
  "purefb_fs_physical",
  "purefb_fs_available_ratio",
].join("+");

async function openMetricsTab(): Promise<void> {
  fireEvent.click(await screen.findByTestId("tab-Metrics"));
  await flush();
}

describe("Storage array volume detail, Metrics tab", () => {
  async function renderVolume(): Promise<void> {
    // The route carries the volume's name percent-encoded: it has a `/`.
    mockLastParam = encodeURIComponent(VOLUME_ID);
    render(<StorageArrayVolumeDetail {...PAGE_PROPS} />);
    await flush();
    await openMetricsTab();
    await waitFor(() => {
      expect(
        screen.getByTestId(`metric-view ${VOLUME_METRICS}`),
      ).toBeInTheDocument();
    });
  }

  test("charts this volume on this array, under the volume's own name", async () => {
    await renderVolume();

    expect(
      screen.getByText(`Volume Metrics: ${VOLUME_ID}`),
    ).toBeInTheDocument();
    for (const attributes of attributesOf(VOLUME_METRICS)) {
      expect(attributes[ARRAY_ATTRIBUTE]).toBe(ARRAY_NAME);
      expect(attributes["name"]).toBe(VOLUME_ID);
    }
  });

  test("a drag narrows the tab's charts, and a double-click puts the range back", async () => {
    await renderVolume();
    expect(metricView(VOLUME_METRICS).onTimeRangeReset).toBeUndefined();

    await dragAcrossMetrics(VOLUME_METRICS);

    expect(metricViewWindow(VOLUME_METRICS)).toEqual(ZOOM_WINDOW);
    expect(pickers()).toEqual([TimeRange.CUSTOM]);
    expect(resetButtons()).toHaveLength(1);
    expect(metricView(VOLUME_METRICS).onTimeRangeReset).toBeInstanceOf(
      Function,
    );

    await doubleClickMetrics(VOLUME_METRICS);

    expect(metricViewMinutes(VOLUME_METRICS)).toBe(60);
    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(resetButtons()).toHaveLength(0);
  });

  test("Reset zoom beside the tab's picker does the same", async () => {
    await renderVolume();

    await dragAcrossMetrics(VOLUME_METRICS);
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();

    expect(metricViewMinutes(VOLUME_METRICS)).toBe(60);
    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
  });
});

describe("Storage array file system detail, Metrics tab", () => {
  async function renderFileSystem(): Promise<void> {
    mockArray = arrayFixture(StorageSystem.PureStorageFlashBlade);
    mockLastParam = FILE_SYSTEM_ID;
    render(<StorageArrayFileSystemDetail {...PAGE_PROPS} />);
    await flush();
    await openMetricsTab();
    await waitFor(() => {
      expect(
        screen.getByTestId(`metric-view ${FILE_SYSTEM_METRICS}`),
      ).toBeInTheDocument();
    });
  }

  test("charts this file system on this array", async () => {
    await renderFileSystem();

    expect(
      screen.getByText(`File System Metrics: ${FILE_SYSTEM_ID}`),
    ).toBeInTheDocument();
    for (const attributes of attributesOf(FILE_SYSTEM_METRICS)) {
      expect(attributes[ARRAY_ATTRIBUTE]).toBe(ARRAY_NAME);
      expect(attributes["name"]).toBe(FILE_SYSTEM_ID);
    }
  });

  test("a drag narrows the tab's charts, and Reset zoom puts the range back", async () => {
    await renderFileSystem();

    await dragAcrossMetrics(FILE_SYSTEM_METRICS);
    expect(metricViewWindow(FILE_SYSTEM_METRICS)).toEqual(ZOOM_WINDOW);
    expect(pickers()).toEqual([TimeRange.CUSTOM]);

    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();

    expect(metricViewMinutes(FILE_SYSTEM_METRICS)).toBe(60);
    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(resetButtons()).toHaveLength(0);
  });
});
