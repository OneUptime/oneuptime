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

/*
 * The metric list's per-row aggregation (MetricsViewer getRowAggregation,
 * #6410): a host whose metric's series are parts of one number - a Service
 * Bus namespace's queues - has a row read with the aggregation it names,
 * captioned so, and opened in the explorer with it. These pin the contract
 * every host relies on: the list without it is unchanged, a name it does
 * not know is averaged as before, a host's own row value still wins, and an
 * entity-scoped list - which aggregates by its own path - honours it too.
 * A row read as a total shows only its whole intervals (getMetricRowPoints).
 */

const mockRowProps: Array<Record<string, unknown>> = [];
let mockMetricNames: Array<string> = [];
const mockAggregateRequests: Array<Record<string, unknown>> = [];
// The aggregate's rows for an aggregation, when a test sets them.
let mockSeries:
  | ((aggregationType: unknown) => Array<{ timestamp: Date; value: number }>)
  | null = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      items: Array<{ name: string }>;
      renderRow: (metric: { name: string }) => React.ReactElement;
    }) => {
      return (
        <div>
          {props.items.map((item: { name: string }) => {
            return (
              <React.Fragment key={item.name}>
                {props.renderRow(item)}
              </React.Fragment>
            );
          })}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        mockRowProps.push(props);
        const name: string = (props["metric"] as { name: string }).name;
        return (
          <button
            data-testid={`row-${name}`}
            onClick={props["onClick"] as () => void}
          >
            {name}
          </button>
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: { modelType: { name: string } }) => {
        if (request.modelType.name !== "MetricType") {
          return Promise.resolve({ data: [], count: 0 });
        }
        const rows: Array<{ name: string }> = mockMetricNames.map(
          (name: string) => {
            return { name: name };
          },
        );
        return Promise.resolve({ data: rows, count: rows.length });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({
          data: mockMetricNames.map((name: string) => {
            return { name: name };
          }),
        });
      },
      aggregate: (request: { aggregateBy: Record<string, unknown> }) => {
        mockAggregateRequests.push(request.aggregateBy);
        // Sum 60, Max 30, anything else 20: the row says which it read.
        const aggregationType: unknown = request.aggregateBy["aggregationType"];
        if (mockSeries) {
          return Promise.resolve({ data: mockSeries(aggregationType) });
        }
        const value: number =
          aggregationType === "Sum" ? 60 : aggregationType === "Max" ? 30 : 20;
        return Promise.resolve({
          data: [{ timestamp: new Date("2026-11-09T10:00:00.000Z"), value }],
        });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve({ data: { attributes: [], facets: {} } });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import MetricsViewer, {
  getMetricRowPoints,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
import { SparklinePoint } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/SparklinePoint";
import {
  GetMetricRowAggregation,
  MetricRowAggregation,
  MetricRowValueOverrideMap,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import { buildQueryConfigsFromSerializedQueries } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricConfigReconstruct";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "21075038-d9f1-4d3a-b878-f64ae861f7be",
);
const SCOPE: Record<string, string> = { "resource.host.name": "web-01" };
const HOUR_MS: number = 60 * 60 * 1000;

const SUMMED: MetricRowAggregation = {
  aggregationType: MetricsAggregationType.Sum,
  caption: "total of series",
};

// Sums "parts" and leaves every other name to the list.
const sumParts: GetMetricRowAggregation = (
  name: string,
): MetricRowAggregation | undefined => {
  return name === "parts" ? SUMMED : undefined;
};

let navigateSpy: ReturnType<typeof jest.spyOn>;

type ViewerProps = React.ComponentProps<typeof MetricsViewer>;

async function renderViewer(
  props: ViewerProps,
  names: Array<string>,
): Promise<ReturnType<typeof render>> {
  mockMetricNames = names;
  let result: ReturnType<typeof render> | undefined = undefined;
  await act(async () => {
    result = render(<MetricsViewer {...props} disableUrlSync={true} />);
  });
  await waitFor(() => {
    for (const name of names) {
      expect(lastRowOf(name)["lastValue"]).toBeDefined();
    }
  });
  return result!;
}

function lastRowOf(name: string): Record<string, unknown> {
  const rows: Array<Record<string, unknown>> = mockRowProps.filter(
    (props: Record<string, unknown>): boolean => {
      return (props["metric"] as { name: string }).name === name;
    },
  );
  expect(rows.length).toBeGreaterThan(0);
  return rows[rows.length - 1]!;
}

function aggregationsOf(name: string): Array<unknown> {
  return mockAggregateRequests
    .filter((request: Record<string, unknown>) => {
      return (request["query"] as { name: string }).name === name;
    })
    .map((request: Record<string, unknown>) => {
      return request["aggregationType"];
    });
}

function openedAggregation(name: string): unknown {
  navigateSpy.mockClear();
  fireEvent.click(screen.getByTestId(`row-${name}`));
  const url: globalThis.URL = new globalThis.URL(
    navigateSpy.mock.calls[0]![0]!.toString(),
  );
  return buildQueryConfigsFromSerializedQueries(
    MetricExplorerUrl.parseMetricQueriesParam(
      url.searchParams.get(MetricExplorerUrlParam.MetricQueries)!,
    ),
  )[0]!.metricQueryData.filterData.aggegationType;
}

beforeEach(() => {
  mockRowProps.length = 0;
  mockAggregateRequests.length = 0;
  mockMetricNames = [];
  mockSeries = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a list without row aggregations", () => {
  test("reads, captions and opens every row as the average, as it always did", async () => {
    await renderViewer({ attributeFilters: SCOPE }, ["parts", "ratio"]);

    for (const name of ["parts", "ratio"]) {
      expect(aggregationsOf(name)).toEqual([MetricsAggregationType.Avg]);
      expect(lastRowOf(name)["lastValue"]).toBe(20);
      expect(lastRowOf(name)["valueCaption"]).toBeUndefined();
      expect(openedAggregation(name)).toBe(MetricsAggregationType.Avg);
    }
  });
});

describe("a list with row aggregations", () => {
  test("a row the host names reads, captions and opens with its aggregation; the others as the average", async () => {
    await renderViewer(
      {
        attributeFilters: SCOPE,
        getRowAggregation: sumParts,
        defaultRowValueCaption: "average of series",
      },
      ["parts", "ratio"],
    );

    expect(aggregationsOf("parts")).toEqual([MetricsAggregationType.Sum]);
    expect(lastRowOf("parts")).toMatchObject({
      lastValue: 60,
      valueCaption: "total of series",
    });
    expect(openedAggregation("parts")).toBe(MetricsAggregationType.Sum);

    expect(aggregationsOf("ratio")).toEqual([MetricsAggregationType.Avg]);
    expect(lastRowOf("ratio")).toMatchObject({
      lastValue: 20,
      valueCaption: "average of series",
    });
    expect(openedAggregation("ratio")).toBe(MetricsAggregationType.Avg);
  });

  test("any aggregation a host names is the one read and opened, with no caption when it gives none", async () => {
    await renderViewer(
      {
        attributeFilters: SCOPE,
        getRowAggregation: (): MetricRowAggregation => {
          return { aggregationType: MetricsAggregationType.Max };
        },
        defaultRowValueCaption: "average of series",
      },
      ["parts"],
    );

    expect(aggregationsOf("parts")).toEqual([MetricsAggregationType.Max]);
    expect(lastRowOf("parts")).toMatchObject({ lastValue: 30 });
    // The row's own (empty) caption, not the averaged rows' one.
    expect(lastRowOf("parts")["valueCaption"]).toBeUndefined();
    expect(openedAggregation("parts")).toBe(MetricsAggregationType.Max);
  });

  /*
   * A host's aggregation may hold over some ranges only (a sum of a level,
   * at one-minute intervals): it is asked with the range the list reads,
   * and a click with the range the explorer opens on.
   */
  test("the host is asked with the range the list reads, and a click with the range it opens", async () => {
    const asked: Array<[string, number]> = [];
    const recordingRange: GetMetricRowAggregation = (
      name: string,
      range: InBetween<Date>,
    ): MetricRowAggregation | undefined => {
      asked.push([
        name,
        (range.endValue.getTime() - range.startValue.getTime()) / HOUR_MS,
      ]);
      return sumParts(name, range);
    };

    await renderViewer(
      {
        attributeFilters: SCOPE,
        getRowAggregation: recordingRange,
        timeRangeOverride: { range: TimeRange.PAST_ONE_DAY },
      },
      ["parts", "ratio"],
    );

    expect(asked).toContainEqual(["parts", 24]);
    expect(asked).toContainEqual(["ratio", 24]);
    for (const [, hours] of asked) {
      expect(hours).toBe(24);
    }
    expect(aggregationsOf("parts")).toEqual([MetricsAggregationType.Sum]);

    asked.length = 0;
    expect(openedAggregation("parts")).toBe(MetricsAggregationType.Sum);
    expect(asked).toEqual([["parts", 24]]);
  });

  test("a value the host computes itself wins over its aggregation, and is not read again", async () => {
    await renderViewer(
      {
        attributeFilters: SCOPE,
        getRowAggregation: sumParts,
        fetchRowValueOverrides: (): Promise<MetricRowValueOverrideMap> => {
          return Promise.resolve(
            new Map([
              [
                "parts",
                {
                  points: [{ time: "2026-11-09T10:00:00.000Z", value: 7 }],
                  caption: "per second, all series",
                },
              ],
            ]),
          );
        },
      },
      ["parts"],
    );

    expect(aggregationsOf("parts")).toEqual([]);
    expect(lastRowOf("parts")).toMatchObject({
      lastValue: 7,
      valueCaption: "per second, all series",
    });
  });

  test("a list scoped by entity keys reads the row with the host's aggregation too", async () => {
    await renderViewer(
      { entityKeysFilter: ["entity-key-1"], getRowAggregation: sumParts },
      ["parts", "ratio"],
    );

    const parts: Array<Record<string, unknown>> = mockAggregateRequests.filter(
      (request: Record<string, unknown>) => {
        return (request["query"] as { name: string }).name === "parts";
      },
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]!["aggregationType"]).toBe(MetricsAggregationType.Sum);
    // Still the entity scope's own query.
    expect(parts[0]!["query"]).toHaveProperty("entityKeys");
    expect(lastRowOf("parts")).toMatchObject({
      lastValue: 60,
      valueCaption: "total of series",
    });
    expect(aggregationsOf("ratio")).toEqual([MetricsAggregationType.Avg]);
  });

  test("a host that changes what it adds up has the rows read again", async () => {
    const view: ReturnType<typeof render> = await renderViewer(
      { attributeFilters: SCOPE, getRowAggregation: sumParts },
      ["parts", "ratio"],
    );
    expect(aggregationsOf("ratio")).toEqual([MetricsAggregationType.Avg]);

    const sumEverything: GetMetricRowAggregation = (): MetricRowAggregation => {
      return SUMMED;
    };
    await act(async () => {
      view.rerender(
        <MetricsViewer
          attributeFilters={SCOPE}
          getRowAggregation={sumEverything}
          disableUrlSync={true}
        />,
      );
    });

    await waitFor(() => {
      expect(aggregationsOf("ratio")).toEqual([
        MetricsAggregationType.Avg,
        MetricsAggregationType.Sum,
      ]);
    });
    await waitFor(() => {
      expect(lastRowOf("ratio")).toMatchObject({
        lastValue: 60,
        valueCaption: "total of series",
      });
    });
    // And a click opens the row as it now reads.
    expect(openedAggregation("ratio")).toBe(MetricsAggregationType.Sum);
  });
});

/*
 * A total per interval counts what had arrived in it. Over a day the list
 * reads 15-minute intervals: the newest is still filling, the oldest began
 * before the range did, and a late source (a cloud's metrics) has not
 * delivered all of the newest ended ones yet. Drawn as they were, a
 * namespace's messages fell at both ends of the line and its value read the
 * few minutes that had arrived (#6410).
 */
const QUARTER_MS: number = 15 * 60 * 1000;
// Past 1 Day up to NOW: 2026-11-08 12:07 to 2026-11-09 12:07.
const NOW: Date = new Date("2026-11-09T12:07:00.000Z");
const PAST_DAY: InBetween<Date> = new InBetween<Date>(
  new Date(NOW.getTime() - 24 * HOUR_MS),
  NOW,
);
// Began seven minutes before the range.
const CUT: number = new Date("2026-11-08T12:00:00.000Z").getTime();
// Still filling.
const FILLING: number = new Date("2026-11-09T12:00:00.000Z").getTime();
// Ended seven minutes ago: whole, unless its source is late.
const ENDED: number = FILLING - QUARTER_MS;

// The day's 97 intervals, CUT to FILLING.
function dayOfIntervals(values: {
  cut: number;
  whole: number;
  ended: number;
  filling: number;
}): Array<SparklinePoint> {
  const points: Array<SparklinePoint> = [];
  for (let start: number = CUT; start <= FILLING; start += QUARTER_MS) {
    points.push({
      time: new Date(start).toISOString(),
      value:
        start === CUT
          ? values.cut
          : start === ENDED
            ? values.ended
            : start === FILLING
              ? values.filling
              : values.whole,
    });
  }
  return points;
}

const SUMMED_DAY: {
  cut: number;
  whole: number;
  ended: number;
  filling: number;
} = { cut: 3, whole: 100, ended: 40, filling: 7 };

function timesOf(points: Array<SparklinePoint>): Array<string> {
  return points.map((point: SparklinePoint): string => {
    return point.time;
  });
}

describe("getMetricRowPoints", () => {
  const DAY: Array<SparklinePoint> = dayOfIntervals(SUMMED_DAY);

  test.each([MetricsAggregationType.Sum, MetricsAggregationType.Count])(
    "a row read as %s keeps the intervals that lie in the range and have ended",
    (aggregationType: MetricsAggregationType) => {
      const points: Array<SparklinePoint> = getMetricRowPoints({
        points: DAY,
        aggregationType,
        startAndEndDate: PAST_DAY,
        now: NOW.getTime(),
      });

      expect(DAY).toHaveLength(97);
      expect(points).toHaveLength(95);
      expect(points[0]!.time).toBe("2026-11-08T12:15:00.000Z");
      expect(points[points.length - 1]).toEqual({
        time: "2026-11-09T11:45:00.000Z",
        value: 40,
      });
    },
  );

  test("a late source's newest ended intervals wait until it has delivered them", () => {
    const points: Array<SparklinePoint> = getMetricRowPoints({
      points: DAY,
      aggregationType: MetricsAggregationType.Sum,
      startAndEndDate: PAST_DAY,
      settleMs: QUARTER_MS,
      now: NOW.getTime(),
    });

    // 11:45 ended 7 minutes ago; 11:30 ended 22 minutes ago.
    expect(points).toHaveLength(94);
    expect(points[points.length - 1]).toEqual({
      time: "2026-11-09T11:30:00.000Z",
      value: 100,
    });
  });

  test("a range that ended long ago keeps its every whole interval, however late its source", () => {
    const points: Array<SparklinePoint> = getMetricRowPoints({
      points: DAY,
      aggregationType: MetricsAggregationType.Sum,
      startAndEndDate: PAST_DAY,
      settleMs: QUARTER_MS,
      now: NOW.getTime() + 24 * HOUR_MS,
    });

    expect(points).toHaveLength(95);
    expect(points[points.length - 1]!.time).toBe("2026-11-09T11:45:00.000Z");
  });

  test.each([
    MetricsAggregationType.Avg,
    MetricsAggregationType.Max,
    MetricsAggregationType.Min,
  ])(
    "a row read as %s keeps every interval, as it always did",
    (aggregationType: MetricsAggregationType) => {
      expect(
        getMetricRowPoints({
          points: DAY,
          aggregationType,
          startAndEndDate: PAST_DAY,
          settleMs: QUARTER_MS,
          now: NOW.getTime(),
        }),
      ).toEqual(DAY);
    },
  );

  test("a total with no whole interval yet keeps what it has", () => {
    const partial: Array<SparklinePoint> = [
      { time: new Date(CUT).toISOString(), value: 3 },
      { time: new Date(FILLING).toISOString(), value: 7 },
    ];

    expect(
      getMetricRowPoints({
        points: partial,
        aggregationType: MetricsAggregationType.Sum,
        startAndEndDate: PAST_DAY,
        now: NOW.getTime(),
      }),
    ).toEqual(partial);
  });
});

describe("a list whose row reads a total", () => {
  beforeEach(() => {
    // Only Date is faked: the clock is pinned, timers and waitFor stay real.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
    // A total reads 100 a whole interval; an average 10, 11 the newest.
    mockSeries = (
      aggregationType: unknown,
    ): Array<{ timestamp: Date; value: number }> => {
      return dayOfIntervals(
        aggregationType === MetricsAggregationType.Sum
          ? SUMMED_DAY
          : { cut: 10, whole: 10, ended: 10, filling: 11 },
      ).map((point: SparklinePoint): { timestamp: Date; value: number } => {
        return { timestamp: new Date(point.time), value: point.value };
      });
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("the row shows its whole intervals and reads the newest of them; an averaged row reads as before", async () => {
    await renderViewer(
      {
        attributeFilters: SCOPE,
        getRowAggregation: sumParts,
        timeRangeOverride: { range: TimeRange.PAST_ONE_DAY },
      },
      ["parts", "ratio"],
    );

    const parts: Record<string, unknown> = lastRowOf("parts");
    expect(parts["lastValue"]).toBe(40);
    const partsTimes: Array<string> = timesOf(
      parts["sparklinePoints"] as Array<SparklinePoint>,
    );
    expect(partsTimes).toHaveLength(95);
    expect(partsTimes[0]).toBe("2026-11-08T12:15:00.000Z");
    expect(partsTimes[partsTimes.length - 1]).toBe("2026-11-09T11:45:00.000Z");

    const ratio: Record<string, unknown> = lastRowOf("ratio");
    expect(ratio["lastValue"]).toBe(11);
    expect(ratio["sparklinePoints"] as Array<SparklinePoint>).toHaveLength(97);
  });

  test("a host whose source is late has the row wait as long as it says", async () => {
    await renderViewer(
      {
        attributeFilters: SCOPE,
        getRowAggregation: (name: string): MetricRowAggregation | undefined => {
          return name === "parts"
            ? { ...SUMMED, settleMs: QUARTER_MS }
            : undefined;
        },
        timeRangeOverride: { range: TimeRange.PAST_ONE_DAY },
      },
      ["parts"],
    );

    const parts: Record<string, unknown> = lastRowOf("parts");
    expect(parts["lastValue"]).toBe(100);
    const partsTimes: Array<string> = timesOf(
      parts["sparklinePoints"] as Array<SparklinePoint>,
    );
    expect(partsTimes).toHaveLength(94);
    expect(partsTimes[partsTimes.length - 1]).toBe("2026-11-09T11:30:00.000Z");
  });
});
