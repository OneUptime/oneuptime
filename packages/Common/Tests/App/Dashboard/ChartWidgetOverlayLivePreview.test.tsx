import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #9961, IN THE WIDGET'S SETTINGS: THE LIVE PREVIEW FOLLOWS THE
 * SWITCH.
 *
 * The issue's own steps: edit the dashboard, open a Chart widget's
 * settings, add mem_total under mem_used, open its Display Settings - and
 * the Live Preview drew the two as separate charts with no switch to put
 * them together. Here the real board (DashboardCanvas) is drawn in edit
 * mode with the widget's settings open, held by a page that keeps the
 * dashboard it is handed back, as DashboardView does; the settings form, the
 * Live Preview's widget and its charts are all the real ones, with the
 * metrics read stood in for and recharts given a size.
 */

jest.setTimeout(120000);

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, {
        width: 600,
        height: 300,
      } as Record<string, unknown>);
    },
  };
});

const fetchResultsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        fetchExemplars: () => {
          return new Promise(() => {
            // Exemplars are not under test: they never arrive.
          });
        },
        setQueryTopNOverride: () => {
          return undefined;
        },
        getQueryConfigTopNKey: (
          _queryConfig: unknown,
          index: number,
          scope?: string,
        ) => {
          return `${scope || ""}:${index}`;
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
        serializeAttributeFiltersForKey: (attributes: unknown) => {
          return JSON.stringify(attributes || {});
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
      DEFAULT_TOP_N_SERIES: 10,
      SHOW_ALL_SERIES_TOP_N: 10_000,
      sanitizeAttributeFilters: (attributes: unknown) => {
        return attributes;
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "11111111-1111-4111-8111-111111111111";
      },
    },
  };
});

import DashboardCanvas from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import { METRIC_QUERY_ROW_HEADER_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm";
import { WIDGET_SETTINGS_PREVIEW_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const CHART_ID: ObjectID = new ObjectID("99610000-2222-4222-8222-999610009961");

const WINDOW_START: Date = new Date("2026-11-18T10:00:00.000Z");

const WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    WINDOW_START,
    new Date("2026-11-18T11:00:00.000Z"),
  ),
};

const OVERLAY_SWITCH: string = "Overlay with previous query";

function metricType(name: string, unit: string): MetricType {
  const type: MetricType = new MetricType();
  type.name = name;
  type.unit = unit;
  return type;
}

const METRIC_TYPES: Array<MetricType> = [
  metricType("mem_used", "By"),
  metricType("mem_total", "By"),
  metricType("mem_free", "By"),
];

const VALUES: Record<string, Array<number>> = {
  mem_used: [4.1e9, 4.4e9, 4.2e9, 4.6e9],
  mem_total: [8e9, 8e9, 8e9, 8e9],
  mem_free: [3.9e9, 3.6e9, 3.8e9, 3.4e9],
};

function answer(metricViewData: MetricViewData): Array<AggregatedResult> {
  return metricViewData.queryConfigs.map(
    (queryConfig: MetricQueryConfigData): AggregatedResult => {
      const metricName: string = String(
        queryConfig.metricQueryData.filterData.metricName,
      );

      return {
        data: (VALUES[metricName] || []).map(
          (value: number, step: number): AggregatedModel => {
            return {
              timestamp: new Date(
                WINDOW_START.getTime() + step * 15 * 60 * 1000,
              ),
              value: value,
            } as AggregatedModel;
          },
        ),
        truncated: false,
      } as AggregatedResult;
    },
  );
}

function query(variable: string, metricName: string): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: metricName,
      description: undefined,
      legend: metricName,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  } as MetricQueryConfigData;
}

function chartOf(added: Array<string>): DashboardChartComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: CHART_ID,
    componentType: DashboardComponentType.Chart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 6,
    minHeightInDashboardUnits: 3,
    arguments: {
      chartTitle: "Memory",
      chartType: DashboardChartType.Line,
      metricQueryConfig: query("a", "mem_used"),
      metricQueryConfigs: added.map(
        (metricName: string, index: number): MetricQueryConfigData => {
          return query(String.fromCharCode(98 + index), metricName);
        },
      ),
    },
  } as DashboardChartComponent;
}

// The dashboard the page holds, as the board last handed it back.
let held: DashboardViewConfig | null = null;

/*
 * The page around the board while the dashboard is edited: it keeps the
 * dashboard the board hands back and draws the board with it, as
 * DashboardView does until Save Changes.
 */
function EditedBoard(props: {
  chart: DashboardChartComponent;
}): React.ReactElement {
  const [config, setConfig] = React.useState<DashboardViewConfig>({
    _type: ObjectType.DashboardViewConfig,
    components: [props.chart],
    heightInDashboardUnits: 12,
  });

  held = config;

  return (
    <DashboardCanvas
      dashboardViewConfig={config}
      onDashboardViewConfigChange={(next: DashboardViewConfig): void => {
        setConfig(next);
      }}
      isEditMode={true}
      currentTotalDashboardWidthInPx={1200}
      onComponentSelected={() => {}}
      onComponentUnselected={() => {}}
      selectedComponentId={CHART_ID}
      metrics={{ metricTypes: METRIC_TYPES, telemetryAttributes: [] }}
      dashboardStartAndEndDate={WINDOW}
      refreshTick={0}
    />
  );
}

/*
 * jsdom has no ResizeObserver and lays nothing out, and the preview only
 * renders once it has measured a width. Report a real one.
 */
class FakeResizeObserver {
  private callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(): void {
    this.callback(
      [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  public unobserve(): void {
    // Nothing to stop observing.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

function preview(): HTMLElement {
  return within(modal()).getByTestId(WIDGET_SETTINGS_PREVIEW_TEST_ID);
}

// Each chart's legend chips, by the series they name.
function chartsOf(plots: Array<HTMLElement>): Array<Array<string>> {
  return plots.map((plot: HTMLElement): Array<string> => {
    return within(plot.parentElement as HTMLElement)
      .queryAllByRole("button")
      .map((button: HTMLElement): string => {
        return button.getAttribute("title") || "";
      })
      .filter((title: string): boolean => {
        return title.endsWith(" — click to hide");
      })
      .map((title: string): string => {
        return title.replace(" — click to hide", "");
      })
      .sort();
  });
}

// The charts drawn in a part of the page.
function chartsIn(scope: HTMLElement): Array<Array<string>> {
  return chartsOf(within(scope).queryAllByTestId("chart-group-plot"));
}

// The charts of the board's own widget, behind the settings dialog.
function boardCharts(): Array<Array<string>> {
  return chartsOf(
    screen
      .queryAllByTestId("chart-group-plot")
      .filter((plot: HTMLElement): boolean => {
        return !modal().contains(plot);
      }),
  );
}

function addedQueryCard(index: number): HTMLElement {
  return within(modal()).getAllByTestId(METRIC_QUERY_ROW_HEADER_TEST_ID)[index]!
    .parentElement as HTMLElement;
}

function overlaySwitchOf(index: number): HTMLElement {
  const card: HTMLElement = addedQueryCard(index);
  const open: HTMLElement | null = within(card).queryByRole("switch", {
    name: OVERLAY_SWITCH,
  });

  if (open) {
    return open;
  }

  fireEvent.click(
    within(card).getByRole("button", { name: "Display Settings" }),
  );

  return within(card).getByRole("switch", { name: OVERLAY_SWITCH });
}

async function openBoard(chart: DashboardChartComponent): Promise<void> {
  render(<EditedBoard chart={chart} />);

  await waitFor(() => {
    expect(chartsIn(preview()).length).toBeGreaterThan(0);
  });
}

function heldAddedQueries(): Array<MetricQueryConfigData> {
  return (
    (held!.components[0] as unknown as DashboardChartComponent).arguments
      .metricQueryConfigs || []
  );
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
});

beforeEach(() => {
  held = null;
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation((input: unknown) => {
    return Promise.resolve(
      answer((input as { metricViewData: MetricViewData }).metricViewData),
    );
  });
});

afterEach(() => {
  cleanup();
});

describe("the Live Preview follows the switch", () => {
  test("mem_total turned on: the preview draws one chart with both; off: two charts again", async () => {
    await openBoard(chartOf(["mem_total"]));

    // As the issue found it: a chart for each query.
    expect(chartsIn(preview())).toEqual([["mem_used"], ["mem_total"]]);

    fireEvent.click(overlaySwitchOf(0));

    await waitFor(() => {
      expect(chartsIn(preview())).toEqual([["mem_total", "mem_used"]]);
    });
    expect(overlaySwitchOf(0)).toHaveAttribute("aria-checked", "true");

    fireEvent.click(overlaySwitchOf(0));

    await waitFor(() => {
      expect(chartsIn(preview())).toEqual([["mem_used"], ["mem_total"]]);
    });
    expect(overlaySwitchOf(0)).toHaveAttribute("aria-checked", "false");
  });

  test("the dashboard the page will save holds the switch, as the preview draws it", async () => {
    await openBoard(chartOf(["mem_total"]));

    fireEvent.click(overlaySwitchOf(0));

    await waitFor(() => {
      expect(heldAddedQueries()[0]?.overlayWithPreviousQuery).toBe(true);
    });
    expect(chartsIn(preview())).toEqual([["mem_total", "mem_used"]]);
  });

  test("the board behind the dialog draws the widget as its preview does", async () => {
    await openBoard(chartOf(["mem_total"]));

    await waitFor(() => {
      expect(boardCharts()).toEqual([["mem_used"], ["mem_total"]]);
    });

    fireEvent.click(overlaySwitchOf(0));

    await waitFor(() => {
      expect(boardCharts()).toEqual([["mem_total", "mem_used"]]);
    });
  });

  test("three queries: Query 2 on joins Query 1; Query 3 on joins them both", async () => {
    await openBoard(chartOf(["mem_total", "mem_free"]));

    expect(chartsIn(preview())).toEqual([
      ["mem_used"],
      ["mem_total"],
      ["mem_free"],
    ]);

    fireEvent.click(overlaySwitchOf(0));

    await waitFor(() => {
      expect(chartsIn(preview())).toEqual([
        ["mem_total", "mem_used"],
        ["mem_free"],
      ]);
    });

    fireEvent.click(overlaySwitchOf(1));

    await waitFor(() => {
      expect(chartsIn(preview())).toEqual([
        ["mem_free", "mem_total", "mem_used"],
      ]);
    });
    expect(
      heldAddedQueries().map(
        (queryConfig: MetricQueryConfigData): boolean | undefined => {
          return queryConfig.overlayWithPreviousQuery;
        },
      ),
    ).toEqual([true, true]);
  });

  test("three queries: only Query 3 on joins Query 2's chart, and Query 1 keeps its own", async () => {
    await openBoard(chartOf(["mem_total", "mem_free"]));

    fireEvent.click(overlaySwitchOf(1));

    await waitFor(() => {
      expect(chartsIn(preview())).toEqual([
        ["mem_used"],
        ["mem_free", "mem_total"],
      ]);
    });
  });

  test("Query 1's settings in the dialog never offer the switch", async () => {
    await openBoard(chartOf(["mem_total"]));

    const first: HTMLElement = within(modal()).getByText("Query 1")
      .parentElement?.parentElement as HTMLElement;

    fireEvent.click(
      within(first).getByRole("button", { name: "Display Settings" }),
    );

    expect(
      within(first).queryByRole("switch", { name: OVERLAY_SWITCH }),
    ).toBeNull();
    // Query 2's settings, still folded, hold the only one.
    expect(
      within(modal()).queryAllByRole("switch", { name: OVERLAY_SWITCH }),
    ).toHaveLength(0);
    expect(overlaySwitchOf(0)).toBeInTheDocument();
  });
});
