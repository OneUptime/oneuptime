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
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { seededRandom, shuffled } from "../../Helpers/SeededRandom";

/*
 * The report: on a metric Value widget, the sparkline under the number ran
 * from the newest point on the left to the oldest on the right, and the
 * trend arrow and its percentage were inverted - "↑ 143.8%" where a line
 * chart of the same metric over the same week fell. The number itself was
 * right.
 *
 * The cause: OneUptime's metrics API answers an aggregate NEWEST bucket
 * first (AnalyticsDatabaseService sorts by time, descending, so a read that
 * runs into its row limit loses the oldest buckets). The metric widget
 * handed those points to the view as they came; the view drew them evenly
 * spaced in that order, and its trend split the array in two by position.
 * The Data Source Value widget was right only because its host sorted.
 *
 * These tests feed the real widgets the API's real order - and oldest-first
 * and shuffled - and read what a person reads: the line's shape from left to
 * right, the time and value the hover shows at each end, and the arrow, its
 * percentage, its colour and its tooltip.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const fetchTimeSeriesMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTimeSeries: (...args: Array<any>) => {
          return fetchTimeSeriesMock(...args);
        },
      },
    };
  },
);

import ValueWidgetView, {
  HOVERED_TIME_TEST_ID,
  SPARKLINE_END_LABEL_TEST_ID,
  SPARKLINE_START_LABEL_TEST_ID,
  SPARKLINE_TEST_ID,
  TREND_DETAILS_TEST_ID,
  TREND_TEST_ID,
  VALUE_WIDGET_TEST_ID,
  ValueWidgetViewProps,
  getSparklineSpanLabelsFit,
  getValueWidgetTrendTone,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import DashboardValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardValueComponent";
import DashboardDataSourceValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceValueComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  getDashboardBucketLabel,
  getDashboardSpanLabeller,
  getDashboardSpanLabels,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardDateTime";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardDataSourceValueComponent, {
  DataSourceValueReduce,
} from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DashboardValueComponent, {
  DashboardValueTrendDirection,
} from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  getValueWidgetTrend,
  getMeanOfValues,
  ValueWidgetTrend,
  ValueWidgetTrendDirection,
} from "../../../Utils/Dashboard/ValueWidgetSeries";
import ValueFormatter from "../../../Utils/ValueFormatter";

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;

// The report's range: a week, 15 to 22 October, starting on the hour.
const WEEK_START_MS: number = Date.UTC(2026, 9, 15, 10, 0, 0);
const WEEK_END_MS: number = WEEK_START_MS + 168 * HOUR_MS;

const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date(WEEK_START_MS),
    new Date(WEEK_END_MS),
  ),
};

interface Bucket {
  hour: number;
  value: number | null;
}

const bucketAt: (bucket: Bucket) => AggregatedModel = (
  bucket: Bucket,
): AggregatedModel => {
  return {
    timestamp: new Date(WEEK_START_MS + bucket.hour * HOUR_MS),
    value: bucket.value as number,
  };
};

/*
 * A log recording rule's hourly count across the week: 100 an hour in the
 * first half, 250 in the second, each hour a little different so a hover
 * can tell the buckets apart. The halves sum to 11,886 and 31,542: up
 * 165.4%.
 */
const RISING_WEEK: Array<Bucket> = Array.from(
  { length: 168 },
  (_unused: unknown, hour: number): Bucket => {
    return { hour: hour, value: (hour < 84 ? 100 : 250) + hour };
  },
);

const RISING_TOTALS: { first: number; second: number; percent: number } = {
  first: 11886,
  second: 31542,
  percent: 165.4,
};

const ORDERS: Array<{
  name: string;
  order: (buckets: Array<Bucket>) => Array<Bucket>;
}> = [
  {
    name: "newest first, as the metrics API answers",
    order: (buckets: Array<Bucket>): Array<Bucket> => {
      return buckets.slice().reverse();
    },
  },
  {
    name: "oldest first",
    order: (buckets: Array<Bucket>): Array<Bucket> => {
      return buckets.slice();
    },
  },
  {
    name: "shuffled",
    order: (buckets: Array<Bucket>): Array<Bucket> => {
      return shuffled(buckets, seededRandom(5126));
    },
  },
];

const COMPONENT_ID: ObjectID = new ObjectID(
  "13131313-1111-4111-8111-131313131313",
);

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

function buildHostProps(
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "value-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    // Tall enough for the sparkline, wide enough for its end labels.
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: BOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    ...overrides,
  };
}

function buildValueComponent(data: {
  metricName: string;
  aggregation: MetricsAggregationType;
  trendDirection?: DashboardValueTrendDirection | undefined;
}): DashboardValueComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Value,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 4,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {
      title: "Log errors",
      metricQueryConfig: {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: data.metricName,
            aggegationType: data.aggregation,
          },
        },
      },
      ...(data.trendDirection ? { trendDirection: data.trendDirection } : {}),
    },
  } as unknown as DashboardValueComponent;
}

function renderMetricWidget(
  data: {
    buckets: Array<AggregatedModel>;
    metricName?: string | undefined;
    aggregation?: MetricsAggregationType | undefined;
    trendDirection?: DashboardValueTrendDirection | undefined;
  },
  overrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult {
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: data.buckets }]);
  });

  return render(
    <DashboardValueComponentElement
      {...buildHostProps(overrides)}
      component={buildValueComponent({
        metricName: data.metricName || "log.errors.count",
        aggregation: data.aggregation || MetricsAggregationType.Sum,
        trendDirection: data.trendDirection,
      })}
    />,
  );
}

// The line's points, left to right, as the svg draws them.
function linePoints(svg: Element): Array<[number, number]> {
  return (svg.querySelector("polyline")!.getAttribute("points") || "")
    .trim()
    .split(" ")
    .map((pair: string): [number, number] => {
      const [x, y] = pair.split(",");
      return [Number(x), Number(y)];
    });
}

/*
 * Where the line draws a value: the box's height less its 4px padding,
 * scaled between the series' lowest and highest values.
 */
function expectedY(svg: Element, value: number, values: Array<number>): number {
  const height: number = Number(svg.getAttribute("height"));
  const lowest: number = Math.min(...values);
  const highest: number = Math.max(...values);

  return height - 4 - ((value - lowest) / (highest - lowest)) * (height - 8);
}

/*
 * jsdom lays nothing out: give the line a real box, 100px from the left,
 * and hand back the pointer x over any of its points.
 */
const BOX_LEFT: number = 100;

function layOut(svg: Element): (index: number) => number {
  const width: number = Number(svg.getAttribute("width"));
  const count: number = linePoints(svg).length;

  (svg as SVGSVGElement).getBoundingClientRect = (): DOMRect => {
    return {
      left: BOX_LEFT,
      top: 0,
      right: BOX_LEFT + width,
      bottom: 20,
      width: width,
      height: 20,
      x: BOX_LEFT,
      y: 0,
      toJSON: (): string => {
        return "";
      },
    } as DOMRect;
  };

  return (index: number): number => {
    return Math.round(BOX_LEFT + 4 + (index / (count - 1)) * (width - 8));
  };
}

function bigNumber(container: HTMLElement): string {
  return (
    container.querySelector("div.font-bold.tabular-nums")?.textContent || ""
  ).trim();
}

function formatted(value: number, unit: string = ""): string {
  return ValueFormatter.formatValueCompact(value, unit, {
    metricName: "log.errors.count",
  }).value;
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

beforeEach(() => {
  fetchResultsMock.mockReset();
  fetchTimeSeriesMock.mockReset();
});

describe.each(ORDERS)(
  "the metric Value widget, its buckets $name",
  (order: {
    name: string;
    order: (buckets: Array<Bucket>) => Array<Bucket>;
  }) => {
    const buckets: Array<AggregatedModel> = order
      .order(RISING_WEEK)
      .map(bucketAt);
    const oldestFirstValues: Array<number> = RISING_WEEK.map(
      (bucket: Bucket): number => {
        return bucket.value as number;
      },
    );

    test("draws the line from the oldest bucket on the left to the newest on the right", async () => {
      renderMetricWidget({ buckets });

      const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);
      const points: Array<[number, number]> = linePoints(svg);

      expect(points).toHaveLength(168);

      for (let index: number = 1; index < points.length; index++) {
        expect(points[index]![0]).toBeGreaterThan(points[index - 1]![0]);
      }

      points.forEach((pointXY: [number, number], index: number): void => {
        expect(pointXY[1]).toBeCloseTo(
          expectedY(svg, oldestFirstValues[index]!, oldestFirstValues),
          6,
        );
      });

      // A rise: the right end is drawn higher (a smaller y) than the left.
      expect(points[167]![1]).toBeLessThan(points[0]![1]);
    });

    test("hovering the left end reads the oldest bucket, the right end the newest", async () => {
      const rendered: RenderResult = renderMetricWidget({ buckets });

      const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);
      const xOf: (index: number) => number = layOut(svg);
      const oldest: Date = new Date(WEEK_START_MS);
      const newest: Date = new Date(WEEK_START_MS + 167 * HOUR_MS);

      fireEvent.mouseMove(svg, { clientX: xOf(0), buttons: 0 });

      // Named as precisely as the hour the point stands for.
      expect(screen.getByTestId(HOVERED_TIME_TEST_ID)).toHaveTextContent(
        getDashboardBucketLabel(oldest, HOUR_MS),
      );
      expect(bigNumber(rendered.container)).toBe(
        formatted(oldestFirstValues[0]!),
      );

      fireEvent.mouseMove(svg, { clientX: xOf(167), buttons: 0 });

      expect(screen.getByTestId(HOVERED_TIME_TEST_ID)).toHaveTextContent(
        getDashboardBucketLabel(newest, HOUR_MS),
      );
      expect(bigNumber(rendered.container)).toBe(
        formatted(oldestFirstValues[167]!),
      );
    });

    test("the arrow points up, by the share of the first half the second half rose", async () => {
      renderMetricWidget({ buckets });

      const chip: HTMLElement = await screen.findByTestId(TREND_TEST_ID);

      expect(chip).toHaveAttribute(
        "data-direction",
        ValueWidgetTrendDirection.Up,
      );
      expect(chip).toHaveTextContent(`↑${RISING_TOTALS.percent}%`);
      expect(chip).toHaveAccessibleName(
        `Up ${RISING_TOTALS.percent}% from the first half of the time range`,
      );
      // An error count rising is bad news: red.
      expect(chip).toHaveAttribute("data-tone", "bad");
      expect(chip).toHaveClass("text-red-600");
    });

    test("the big number is the same whatever the order: the sum of the week", async () => {
      const rendered: RenderResult = renderMetricWidget({ buckets });

      await screen.findByTestId(SPARKLINE_TEST_ID);

      expect(bigNumber(rendered.container)).toBe(
        formatted(RISING_TOTALS.first + RISING_TOTALS.second),
      );
    });
  },
);

describe("the metric Value widget's other shapes of series", () => {
  test("its tooltip names both halves of the week and what each added up to", async () => {
    renderMetricWidget({
      buckets: RISING_WEEK.slice().reverse().map(bucketAt),
    });

    const chip: HTMLElement = await screen.findByTestId(TREND_TEST_ID);

    jest.useFakeTimers();
    fireEvent.mouseEnter(chip);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    const details: HTMLElement = screen.getByTestId(TREND_DETAILS_TEST_ID);
    const halves: Array<HTMLElement> = Array.from(
      details.querySelectorAll<HTMLElement>("[data-half]"),
    );

    expect(details).toHaveTextContent(
      `Up ${RISING_TOTALS.percent}% from the first half of the time range`,
    );
    expect(
      halves.map((half: HTMLElement): string | null => {
        return half.getAttribute("data-half");
      }),
    ).toEqual(["first", "second"]);
    expect(within(halves[0]!).getByText("First half")).toBeInTheDocument();
    expect(halves[0]!).toHaveTextContent(formatted(RISING_TOTALS.first));
    expect(within(halves[1]!).getByText("Second half")).toBeInTheDocument();
    expect(halves[1]!).toHaveTextContent(formatted(RISING_TOTALS.second));

    /*
     * The halves meet at the week's midpoint, 18 October at 22:00, labelled
     * as the week's own instants are.
     */
    const label: ((date: Date) => string) | null = getDashboardSpanLabeller(
      new Date(WEEK_START_MS),
      new Date(WEEK_END_MS),
    );
    const midpoint: Date = new Date(WEEK_START_MS + 84 * HOUR_MS);

    expect(halves[0]!).toHaveTextContent(
      `${label!(new Date(WEEK_START_MS))} – ${label!(midpoint)}`,
    );
    expect(halves[1]!).toHaveTextContent(
      `${label!(midpoint)} – ${label!(new Date(WEEK_END_MS))}`,
    );
  });

  test("a grouped query's groups are drawn as one point per bucket", async () => {
    const grouped: Array<AggregatedModel> = [];

    for (let hour: number = 167; hour >= 0; hour--) {
      for (const service of ["checkout", "payments", "search"]) {
        grouped.push({
          ...bucketAt({ hour: hour, value: hour < 84 ? 10 : 30 }),
          attributes: { "service.name": service },
        } as unknown as AggregatedModel);
      }
    }

    renderMetricWidget({ buckets: grouped });

    const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);

    // 168 buckets, not 504 points zig-zagging between the groups.
    expect(linePoints(svg)).toHaveLength(168);

    const chip: HTMLElement = screen.getByTestId(TREND_TEST_ID);
    // 3 x 10 against 3 x 30 an hour.
    expect(chip).toHaveTextContent("↑200%");
  });

  test("a bucket with no number leaves a line with no NaN in it: an average leaves it out", async () => {
    const withNulls: Array<AggregatedModel> = RISING_WEEK.map(
      (bucket: Bucket): AggregatedModel => {
        return bucketAt(
          bucket.hour % 10 === 0 ? { ...bucket, value: null } : bucket,
        );
      },
    ).reverse();

    renderMetricWidget({
      buckets: withNulls,
      aggregation: MetricsAggregationType.Avg,
    });

    const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);
    const points: string = svg
      .querySelector("polyline")!
      .getAttribute("points")!;

    expect(points).not.toContain("NaN");
    expect(linePoints(svg)).toHaveLength(168 - 17);
  });

  test("a bucket with no number in a sum counts nothing: drawn at 0 between readings, never NaN", async () => {
    const withNulls: Array<AggregatedModel> = RISING_WEEK.map(
      (bucket: Bucket): AggregatedModel => {
        return bucketAt(
          bucket.hour % 10 === 0 ? { ...bucket, value: null } : bucket,
        );
      },
    ).reverse();

    renderMetricWidget({ buckets: withNulls });

    const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);
    const points: string = svg
      .querySelector("polyline")!
      .getAttribute("points")!;

    expect(points).not.toContain("NaN");
    /*
     * Hour 0 is empty and comes before the first reading, so the line
     * starts at hour 1; the 16 empty hours after it are drawn at 0.
     */
    expect(linePoints(svg)).toHaveLength(167);
  });

  test("one bucket: the number, with no line and no arrow - nothing to compare", async () => {
    const rendered: RenderResult = renderMetricWidget({
      buckets: [bucketAt({ hour: 167, value: 7 })],
    });

    await waitFor(() => {
      expect(bigNumber(rendered.container)).toBe("7");
    });

    expect(screen.queryByTestId(SPARKLINE_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(TREND_TEST_ID)).toBeNull();
  });

  /*
   * A sparse count: deploys, now and then. The metrics API answers only the
   * hours that had one, and the line drawn through just those read flat -
   * 4, 4, 12, 12, 12, evenly spaced - while the arrow said the count rose
   * 350%. Every empty hour between the first reading and the last is drawn
   * at 0 now, so the spikes read as spikes and the line agrees with the
   * arrow.
   */
  const SPARSE_DEPLOYS: Array<Bucket> = [
    { hour: 10, value: 4 },
    { hour: 40, value: 4 },
    { hour: 100, value: 12 },
    { hour: 130, value: 12 },
    { hour: 160, value: 12 },
  ];

  test("a sparse count draws the empty hours between its readings at 0", async () => {
    renderMetricWidget({
      buckets: SPARSE_DEPLOYS.map(bucketAt).reverse(),
      metricName: "deploys.count",
    });

    const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);
    const ys: Array<number> = linePoints(svg).map(
      (point: [number, number]): number => {
        return point[1];
      },
    );
    const height: number = Number(svg.getAttribute("height"));

    // Hours 10 to 160, one point each: the 146 empty ones too.
    expect(ys).toHaveLength(151);

    const baseline: number = Math.max(...ys);
    const readingIndexes: Set<number> = new Set<number>(
      SPARSE_DEPLOYS.map((bucket: Bucket): number => {
        return bucket.hour - 10;
      }),
    );

    ys.forEach((y: number, index: number): void => {
      if (readingIndexes.has(index)) {
        expect(y).toBeLessThan(baseline);
      } else {
        expect(y).toBe(baseline);
      }
    });

    // The baseline is the box's bottom less its padding: a real 0.
    expect(baseline).toBe(height - 4);
    // The later readings stand three times as tall as the earlier ones.
    expect(ys[90]!).toBeLessThan(ys[0]!);
    expect(ys[150]!).toBe(ys[90]!);

    // The arrow compares the halves' totals: 8 then 36.
    expect(screen.getByTestId(TREND_TEST_ID)).toHaveTextContent("↑350%");
  });

  test("a sparse count's line ends at its newest reading, never on a 0 that has not landed yet", async () => {
    renderMetricWidget({
      buckets: SPARSE_DEPLOYS.map(bucketAt).reverse(),
      metricName: "deploys.count",
    });

    const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);
    const points: Array<[number, number]> = linePoints(svg);
    const baseline: number = Math.max(
      ...points.map((point: [number, number]): number => {
        return point[1];
      }),
    );

    // The last hours of the week (161 to 167) had no reading: not drawn.
    expect(points).toHaveLength(151);
    expect(points[points.length - 1]![1]).toBeLessThan(baseline);
    expect(points[0]![1]).toBeLessThan(baseline);
  });

  test("an average of the same readings keeps its gaps: no reading is not 0", async () => {
    renderMetricWidget({
      buckets: SPARSE_DEPLOYS.map(bucketAt).reverse(),
      metricName: "deploy.duration",
      aggregation: MetricsAggregationType.Avg,
    });

    const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);

    expect(linePoints(svg)).toHaveLength(SPARSE_DEPLOYS.length);
  });

  test("a metric that began reporting late in the week draws its line, with no arrow", async () => {
    const recent: Array<AggregatedModel> = RISING_WEEK.slice(130)
      .reverse()
      .map(bucketAt);

    renderMetricWidget({ buckets: recent });

    await screen.findByTestId(SPARKLINE_TEST_ID);

    expect(screen.queryByTestId(TREND_TEST_ID)).toBeNull();
  });

  test("a series that never moves: '→ 0%', neither good nor bad, and a line across the middle", async () => {
    const steady: Array<AggregatedModel> = RISING_WEEK.map(
      (bucket: Bucket): AggregatedModel => {
        return bucketAt({ hour: bucket.hour, value: 42 });
      },
    ).reverse();

    renderMetricWidget({
      buckets: steady,
      metricName: "queue.depth",
      aggregation: MetricsAggregationType.Avg,
    });

    const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);
    const chip: HTMLElement = screen.getByTestId(TREND_TEST_ID);
    const height: number = Number(svg.getAttribute("height"));

    expect(chip).toHaveTextContent("→0%");
    expect(chip).toHaveAttribute("data-tone", "neutral");
    expect(chip).toHaveAccessibleName(
      "About the same as in the first half of the time range",
    );

    for (const [, y] of linePoints(svg)) {
      expect(y).toBe(height / 2);
    }
  });

  test("a falling latency is good news: green", async () => {
    const falling: Array<AggregatedModel> = RISING_WEEK.map(
      (bucket: Bucket): AggregatedModel => {
        return bucketAt({
          hour: bucket.hour,
          value: bucket.hour < 84 ? 400 : 300,
        });
      },
    ).reverse();

    renderMetricWidget({
      buckets: falling,
      metricName: "checkout.latency",
      aggregation: MetricsAggregationType.Avg,
    });

    const chip: HTMLElement = await screen.findByTestId(TREND_TEST_ID);

    expect(chip).toHaveTextContent("↓25%");
    expect(chip).toHaveAttribute("data-tone", "good");
    expect(chip).toHaveClass("text-emerald-700");
    expect(chip).toHaveAccessibleName(
      "Down 25% from the first half of the time range",
    );
  });

  test("the widget's own Trend Direction outranks the metric's name", async () => {
    renderMetricWidget({
      buckets: RISING_WEEK.slice().reverse().map(bucketAt),
      trendDirection: DashboardValueTrendDirection.HigherIsBetter,
    });

    const chip: HTMLElement = await screen.findByTestId(TREND_TEST_ID);

    expect(chip).toHaveAttribute("data-tone", "good");
  });

  test("the trend splits the time range the results were asked for", async () => {
    renderMetricWidget({
      buckets: RISING_WEEK.slice().reverse().map(bucketAt),
    });

    await screen.findByTestId(TREND_TEST_ID);

    const asked: { metricViewData: { startAndEndDate: InBetween<Date> } } =
      fetchResultsMock.mock.calls[0]![0] as {
        metricViewData: { startAndEndDate: InBetween<Date> };
      };

    expect(asked.metricViewData.startAndEndDate.startValue.getTime()).toBe(
      WEEK_START_MS,
    );
    expect(asked.metricViewData.startAndEndDate.endValue.getTime()).toBe(
      WEEK_END_MS,
    );
  });
});

describe("the Data Source Value widget reads its rows the same way", () => {
  function buildDataSourceComponent(
    reduce: DataSourceValueReduce,
  ): DashboardDataSourceValueComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.DataSourceValue,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 4,
      heightInDashboardUnits: 3,
      minWidthInDashboardUnits: 1,
      minHeightInDashboardUnits: 1,
      arguments: {
        title: "Orders",
        query: {
          id: "orders",
          dataSourceId: "34343434-3434-4434-8434-343434343434",
          query: "SELECT hour, orders FROM orders_per_hour",
        },
        reduce: reduce,
      },
    } as unknown as DashboardDataSourceValueComponent;
  }

  test("rows in no order draw the line oldest first, and the arrow compares the sums of the halves", async () => {
    fetchTimeSeriesMock.mockImplementation(() => {
      return Promise.resolve({
        data: shuffled(RISING_WEEK, seededRandom(5127)).map(bucketAt),
      });
    });

    render(
      <DashboardDataSourceValueComponentElement
        {...buildHostProps()}
        component={buildDataSourceComponent(DataSourceValueReduce.Sum)}
      />,
    );

    const svg: Element = await screen.findByTestId(SPARKLINE_TEST_ID);
    const points: Array<[number, number]> = linePoints(svg);

    expect(points[167]![1]).toBeLessThan(points[0]![1]);

    const chip: HTMLElement = screen.getByTestId(TREND_TEST_ID);

    expect(chip).toHaveTextContent(`↑${RISING_TOTALS.percent}%`);
    // No metric name behind external data: a rise reads as good.
    expect(chip).toHaveAttribute("data-tone", "good");
  });

  test("with Last, each half is its latest row: now against the middle of the range", async () => {
    fetchTimeSeriesMock.mockImplementation(() => {
      return Promise.resolve({
        data: RISING_WEEK.slice().reverse().map(bucketAt),
      });
    });

    render(
      <DashboardDataSourceValueComponentElement
        {...buildHostProps()}
        component={buildDataSourceComponent(DataSourceValueReduce.Last)}
      />,
    );

    const chip: HTMLElement = await screen.findByTestId(TREND_TEST_ID);

    // The first half ends on hour 83 (183), the second on hour 167 (417).
    expect(chip).toHaveTextContent("↑127.9%");
  });
});

/*
 * The view on its own: what it draws for a trend and a line it is handed.
 */
const baseViewProps: ValueWidgetViewProps = {
  widthInPx: 480,
  heightInPx: 320,
  isEditMode: false,
  isLoading: false,
  hasEverLoaded: true,
  error: null,
  value: 42,
  points: RISING_WEEK.slice().reverse().map(bucketAt) as Array<{
    timestamp: Date;
    value: number;
  }>,
  noDataMessage: "No data for the selected time range",
  isConfigured: true,
  setupTitle: "Value Widget",
  setupMessage: "Click to configure metric",
  title: "Latency",
  rawUnit: "ms",
  metricName: "checkout.latency",
  hideUnit: false,
  warningThreshold: undefined,
  criticalThreshold: undefined,
  trendDirection: undefined,
};

function trendFor(firstHalf: number, secondHalf: number): ValueWidgetTrend {
  return getValueWidgetTrend({
    points: RISING_WEEK.map((bucket: Bucket): AggregatedModel => {
      return bucketAt({
        hour: bucket.hour,
        value: bucket.hour < 84 ? firstHalf : secondHalf,
      });
    }),
    reduce: getMeanOfValues,
    windowStart: new Date(WEEK_START_MS),
    windowEnd: new Date(WEEK_END_MS),
    bucketWidthMs: HOUR_MS,
  })!;
}

async function openTooltip(chip: HTMLElement): Promise<HTMLElement> {
  jest.useFakeTimers();
  fireEvent.mouseEnter(chip);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  return screen.getByTestId(TREND_DETAILS_TEST_ID);
}

describe("the Value widget's view", () => {
  test("a rise from nothing is 'from 0': there is no percentage of nothing", async () => {
    render(<ValueWidgetView {...baseViewProps} trend={trendFor(0, 12)} />);

    const chip: HTMLElement = screen.getByTestId(TREND_TEST_ID);

    expect(chip).toHaveTextContent("↑from 0");
    expect(chip).toHaveAccessibleName(
      "Up from 0 in the first half of the time range",
    );

    const details: HTMLElement = await openTooltip(chip);

    expect(details).toHaveTextContent("0 ms");
    expect(details).toHaveTextContent("12 ms");
  });

  test("the tooltip writes each half's number as the widget writes its own, unit and all", async () => {
    render(<ValueWidgetView {...baseViewProps} trend={trendFor(400, 300)} />);

    const details: HTMLElement = await openTooltip(
      screen.getByTestId(TREND_TEST_ID),
    );

    expect(details).toHaveTextContent(
      "Down 25% from the first half of the time range",
    );
    expect(details).toHaveTextContent("400 ms");
    expect(details).toHaveTextContent("300 ms");
  });

  test("Hide Unit hides it in the tooltip too", async () => {
    render(
      <ValueWidgetView
        {...baseViewProps}
        hideUnit={true}
        trend={trendFor(400, 300)}
      />,
    );

    const details: HTMLElement = await openTooltip(
      screen.getByTestId(TREND_TEST_ID),
    );

    expect(details).not.toHaveTextContent("ms");
  });

  test("no trend handed over: no arrow", () => {
    render(<ValueWidgetView {...baseViewProps} trend={null} />);

    expect(screen.queryByTestId(TREND_TEST_ID)).toBeNull();
  });

  test("hovering the line labels its two ends, oldest on the left, when they fit beside it", () => {
    render(<ValueWidgetView {...baseViewProps} trend={trendFor(400, 300)} />);

    const svg: Element = screen.getByTestId(SPARKLINE_TEST_ID);
    const xOf: (index: number) => number = layOut(svg);
    const expected: { start: string; end: string } | null =
      getDashboardSpanLabels(
        new Date(WEEK_START_MS),
        new Date(WEEK_START_MS + 167 * HOUR_MS),
      );

    // Not while the pointer is elsewhere.
    expect(screen.queryByTestId(SPARKLINE_START_LABEL_TEST_ID)).toBeNull();

    fireEvent.mouseMove(svg, { clientX: xOf(40), buttons: 0 });

    expect(screen.getByTestId(SPARKLINE_START_LABEL_TEST_ID)).toHaveTextContent(
      expected!.start,
    );
    expect(screen.getByTestId(SPARKLINE_END_LABEL_TEST_ID)).toHaveTextContent(
      expected!.end,
    );
    // Placed by the line's own left and right, whatever the page's direction.
    expect(screen.getByTestId(SPARKLINE_START_LABEL_TEST_ID)).toHaveClass(
      "right-full",
    );
    expect(screen.getByTestId(SPARKLINE_END_LABEL_TEST_ID)).toHaveClass(
      "left-full",
    );
    expect(
      screen.getByTestId(SPARKLINE_START_LABEL_TEST_ID).parentElement,
    ).toHaveAttribute("dir", "ltr");

    fireEvent.mouseLeave(svg);

    expect(screen.queryByTestId(SPARKLINE_START_LABEL_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(SPARKLINE_END_LABEL_TEST_ID)).toBeNull();
  });

  test("on a tile too narrow for them, the ends go unlabelled", () => {
    render(
      <ValueWidgetView
        {...baseViewProps}
        widthInPx={170}
        heightInPx={320}
        trend={trendFor(400, 300)}
      />,
    );

    const svg: Element = screen.getByTestId(SPARKLINE_TEST_ID);
    const xOf: (index: number) => number = layOut(svg);

    fireEvent.mouseMove(svg, { clientX: xOf(40), buttons: 0 });

    expect(screen.queryByTestId(SPARKLINE_START_LABEL_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(SPARKLINE_END_LABEL_TEST_ID)).toBeNull();
  });

  test("a value past its thresholds washes the tile in a class the dark theme remaps", () => {
    const { container, rerender } = render(
      <ValueWidgetView {...baseViewProps} value={42} criticalThreshold={40} />,
    );

    const tile: () => HTMLElement = (): HTMLElement => {
      return container.firstElementChild as HTMLElement;
    };

    expect(tile()).toHaveClass("bg-red-50/50");
    expect(tile().getAttribute("style") || "").not.toContain("gradient");

    rerender(
      <ValueWidgetView
        {...baseViewProps}
        value={42}
        warningThreshold={40}
        criticalThreshold={50}
      />,
    );
    expect(tile()).toHaveClass("bg-amber-50/50");

    rerender(<ValueWidgetView {...baseViewProps} value={42} />);
    expect(tile()).not.toHaveClass("bg-red-50/50");
    expect(tile()).not.toHaveClass("bg-amber-50/50");
  });

  describe("the hovered point's time", () => {
    afterEach(() => {
      OneUptimeDate.setUserTimezone(null);
    });

    test("reads day first, like the labels at the line's two ends, and left to right on any page", () => {
      OneUptimeDate.setUserTimezone(Timezone.UTC);

      render(<ValueWidgetView {...baseViewProps} trend={trendFor(400, 300)} />);

      const svg: Element = screen.getByTestId(SPARKLINE_TEST_ID);
      const xOf: (index: number) => number = layOut(svg);

      fireEvent.mouseMove(svg, { clientX: xOf(0), buttons: 0 });

      // The oldest hour of the week, as a chart's tooltip names an hour.
      expect(screen.getByTestId(HOVERED_TIME_TEST_ID)).toHaveTextContent(
        /^15 Oct, 10:00$/,
      );
      expect(
        screen.getByTestId(SPARKLINE_START_LABEL_TEST_ID),
      ).toHaveTextContent(/^15 Oct$/);
      expect(screen.getByTestId(SPARKLINE_END_LABEL_TEST_ID)).toHaveTextContent(
        /^22 Oct$/,
      );
      /*
       * "15 Oct, 10:00" starts with a digit: on a right-to-left page it was
       * reordered unless it is a left-to-right run of its own.
       */
      expect(screen.getByTestId(HOVERED_TIME_TEST_ID)).toHaveAttribute(
        "dir",
        "ltr",
      );
    });

    test("a day's bucket is named by its day alone, as the axis names it", () => {
      OneUptimeDate.setUserTimezone(Timezone.UTC);

      const days: Array<{ timestamp: Date; value: number }> = Array.from(
        { length: 14 },
        (_unused: unknown, day: number) => {
          return {
            timestamp: new Date(Date.UTC(2026, 9, 8 + day)),
            value: 10 + day,
          };
        },
      ).reverse();

      render(<ValueWidgetView {...baseViewProps} points={days} trend={null} />);

      const svg: Element = screen.getByTestId(SPARKLINE_TEST_ID);
      const xOf: (index: number) => number = layOut(svg);

      fireEvent.mouseMove(svg, { clientX: xOf(13), buttons: 0 });

      expect(screen.getByTestId(HOVERED_TIME_TEST_ID)).toHaveTextContent(
        /^21 Oct$/,
      );
    });
  });

  test("the arrow is in the tab order, and focusing it opens what it compares", async () => {
    render(<ValueWidgetView {...baseViewProps} trend={trendFor(400, 300)} />);

    const chip: HTMLElement = screen.getByTestId(TREND_TEST_ID);

    expect(chip).toHaveAttribute("tabindex", "0");
    // A ring for the keyboard's focus, in a colour the dark theme remaps.
    expect(chip).toHaveClass("focus-visible:ring-indigo-500");

    jest.useFakeTimers();
    fireEvent.focus(chip);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.getByTestId(TREND_DETAILS_TEST_ID)).toHaveTextContent(
      "Down 25% from the first half of the time range",
    );
  });

  test("each half's dates are a left-to-right run of their own", async () => {
    render(<ValueWidgetView {...baseViewProps} trend={trendFor(400, 300)} />);

    const details: HTMLElement = await openTooltip(
      screen.getByTestId(TREND_TEST_ID),
    );
    const runs: Array<HTMLElement> = Array.from(
      details.querySelectorAll<HTMLElement>("[data-half] bdi"),
    );

    /*
     * "15 Oct – 18 Oct" starts with a digit: a Persian page drew it as
     * "Oct – 18 Oct 15" until each range was isolated.
     */
    expect(runs).toHaveLength(2);

    const label: ((date: Date) => string) | null = getDashboardSpanLabeller(
      new Date(WEEK_START_MS),
      new Date(WEEK_END_MS),
    );
    const midpoint: Date = new Date(WEEK_START_MS + 84 * HOUR_MS);

    expect(runs[0]!).toHaveAttribute("dir", "ltr");
    expect(runs[0]!).toHaveTextContent(
      `${label!(new Date(WEEK_START_MS))} – ${label!(midpoint)}`,
    );
    expect(runs[1]!).toHaveAttribute("dir", "ltr");
    expect(runs[1]!).toHaveTextContent(
      `${label!(midpoint)} – ${label!(new Date(WEEK_END_MS))}`,
    );
  });

  describe("on the shipped 3x1 tile", () => {
    // Three units by one on a 975px board: 236 by 72 pixels.
    const SHIPPED_TILE: { widthInPx: number; heightInPx: number } = {
      widthInPx: 236,
      heightInPx: 72,
    };

    function messageOf(text: string): HTMLElement {
      return screen.getByText(text);
    }

    test("an unconfigured widget says only what to do, in edit mode too, where 30px cannot hold two lines", () => {
      const { rerender } = render(
        <ValueWidgetView
          {...baseViewProps}
          {...SHIPPED_TILE}
          isEditMode={true}
          isConfigured={false}
          title={undefined}
        />,
      );

      /*
       * "Value Widget" over "Click to configure metric" needed 38px and the
       * edit-mode tile has 30: both lines lost their bottoms.
       */
      expect(screen.queryByText("Value Widget")).toBeNull();
      expect(messageOf("Click to configure metric")).toHaveClass(
        "line-clamp-1",
      );

      // Viewing, the tile has 46px: room for the message on two lines.
      rerender(
        <ValueWidgetView
          {...baseViewProps}
          {...SHIPPED_TILE}
          isConfigured={false}
          title={undefined}
        />,
      );

      expect(screen.queryByText("Value Widget")).toBeNull();
      expect(messageOf("Click to configure metric")).toHaveClass(
        "line-clamp-2",
      );

      // Two units tall, the widget names itself over the message.
      rerender(
        <ValueWidgetView
          {...baseViewProps}
          widthInPx={236}
          heightInPx={154}
          isConfigured={false}
          title={undefined}
        />,
      );

      expect(screen.getByText("Value Widget")).toBeInTheDocument();
      expect(messageOf("Click to configure metric")).toBeInTheDocument();
      expect(screen.getByTestId(VALUE_WIDGET_TEST_ID)).toHaveAttribute(
        "data-state",
        "setup",
      );
    });

    test("the no-data and error messages keep to one line where two do not fit", () => {
      const { rerender } = render(
        <ValueWidgetView
          {...baseViewProps}
          {...SHIPPED_TILE}
          isEditMode={true}
          value={null}
        />,
      );

      expect(messageOf("No data for the selected time range")).toHaveClass(
        "line-clamp-1",
      );

      rerender(
        <ValueWidgetView
          {...baseViewProps}
          {...SHIPPED_TILE}
          isEditMode={true}
          error="The metrics service did not answer in time."
        />,
      );

      expect(
        messageOf("The metrics service did not answer in time."),
      ).toHaveClass("line-clamp-1");

      rerender(
        <ValueWidgetView
          {...baseViewProps}
          {...SHIPPED_TILE}
          error="The metrics service did not answer in time."
        />,
      );

      expect(
        messageOf("The metrics service did not answer in time."),
      ).toHaveClass("line-clamp-2");
    });
  });
});

describe("getValueWidgetTrendTone", () => {
  test("flat is neither good nor bad", () => {
    expect(
      getValueWidgetTrendTone({
        direction: ValueWidgetTrendDirection.Flat,
        trendDirection: DashboardValueTrendDirection.HigherIsWorse,
        metricName: "error.count",
      }),
    ).toBe("neutral");
  });

  test("a rise is good unless a higher value is worse", () => {
    const tone: (
      direction: ValueWidgetTrendDirection,
      trendDirection: DashboardValueTrendDirection | undefined,
      metricName: string,
    ) => string = (
      direction: ValueWidgetTrendDirection,
      trendDirection: DashboardValueTrendDirection | undefined,
      metricName: string,
    ): string => {
      return getValueWidgetTrendTone({ direction, trendDirection, metricName });
    };

    const UP: ValueWidgetTrendDirection = ValueWidgetTrendDirection.Up;
    const DOWN: ValueWidgetTrendDirection = ValueWidgetTrendDirection.Down;

    expect(tone(UP, undefined, "orders.count")).toBe("good");
    expect(tone(DOWN, undefined, "orders.count")).toBe("bad");
    // Auto reads the name: an error count or a latency is worse higher.
    expect(tone(UP, DashboardValueTrendDirection.Auto, "error.count")).toBe(
      "bad",
    );
    expect(tone(DOWN, undefined, "http.server.duration.latency")).toBe("good");
    // The widget's setting wins over the name.
    expect(
      tone(UP, DashboardValueTrendDirection.HigherIsBetter, "error.count"),
    ).toBe("good");
    expect(
      tone(UP, DashboardValueTrendDirection.HigherIsWorse, "orders.count"),
    ).toBe("bad");
    // External data has no name: up is good.
    expect(tone(UP, undefined, "")).toBe("good");
  });
});

describe("getSparklineSpanLabelsFit", () => {
  test("both labels must fit in the room beside the line", () => {
    const labels: { start: string; end: string } = {
      start: "15 Oct",
      end: "22 Oct",
    };

    // (300 - 120) / 2 - 6 = 84px of room; six characters take about 37.
    expect(
      getSparklineSpanLabelsFit({
        labels,
        contentWidthInPx: 300,
        sparklineWidthInPx: 120,
      }),
    ).toBe(true);
    // (150 - 90) / 2 - 6 = 24px: too little.
    expect(
      getSparklineSpanLabelsFit({
        labels,
        contentWidthInPx: 150,
        sparklineWidthInPx: 90,
      }),
    ).toBe(false);
    // The longer of the two decides.
    expect(
      getSparklineSpanLabelsFit({
        labels: { start: "15 Oct", end: "22 Oct, 10:00" },
        contentWidthInPx: 260,
        sparklineWidthInPx: 120,
      }),
    ).toBe(false);
  });
});
