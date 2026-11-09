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
 */

const mockRowProps: Array<Record<string, unknown>> = [];
let mockMetricNames: Array<string> = [];
const mockAggregateRequests: Array<Record<string, unknown>> = [];

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

import MetricsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
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
