import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import MetricService from "../../../../../Server/Services/MetricService";
import AggregateBy from "../../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import GroupedMetricSeries, {
  GroupedMetricRead,
  MetricSeries,
  MetricSeriesPoint,
  NO_ATTRIBUTE_VALUE_LABEL,
  TREND_GAP,
  describeInterval,
} from "../../../../../Server/Utils/AI/Toolbox/GroupedMetricSeries";
import { MAX_METRIC_SERIES } from "../../../../../Server/Utils/AI/Toolbox/MetricAttributeQuery";
import AggregatedModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";

/*
 * A METRIC READ ONE SERIES PER ATTRIBUTE VALUE (issue #4784).
 *
 * The grouped read is MetricService's own grouped aggregation, bounded like
 * the metric explorer's charts: the server keeps the groups with the
 * highest peak and says how many there were, and the row limit is sized to
 * those series' buckets. These tests pin the exact requests and how the
 * rows become series the model can read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const START: Date = new Date("2026-10-16T13:00:00.000Z");
const END: Date = new Date("2026-10-16T13:10:00.000Z");
const PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

function minute(index: number): Date {
  return new Date(START.getTime() + index * 60 * 1000);
}

function row(
  attributes: Record<string, string>,
  index: number,
  value: number,
): AggregatedModel {
  return { timestamp: minute(index), value, attributes } as AggregatedModel;
}

// What the host agent sends for one CPU state, as bucket averages.
function cpuState(
  state: string,
  values: Array<number>,
): Array<AggregatedModel> {
  return values.map((value: number, index: number): AggregatedModel => {
    return row({ state, "cpu.mode": "" }, index, value);
  });
}

let aggregate: SpyInstance<typeof MetricService.aggregateBy>;
let requests: Array<AggregateBy<Metric>>;

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

function answer(
  byType: (request: AggregateBy<Metric>) => AggregatedResult,
): void {
  aggregate = jest
    .spyOn(MetricService, "aggregateBy")
    .mockImplementation(
      async (request: AggregateBy<Metric>): Promise<AggregatedResult> => {
        requests.push(request);
        return byType(request);
      },
    );
}

async function readCpu(): Promise<GroupedMetricRead> {
  return await GroupedMetricSeries.read({
    query: { projectId: PROJECT_ID, name: "system.cpu.utilization" },
    aggregationType: AggregationType.Avg,
    groupBy: ["state", "cpu.mode"],
    interval: AggregationInterval.Minute,
    startTime: START,
    endTime: END,
    props: PROPS,
  });
}

describe("GroupedMetricSeries.read", () => {
  test("asks the grouped aggregation for the top series by peak, sized to their buckets, and counts them alongside", async () => {
    answer((): AggregatedResult => {
      return { data: [] };
    });

    await readCpu();

    expect(aggregate).toHaveBeenCalledTimes(2);
    const [values, counts] = requests;

    for (const request of [values!, counts!]) {
      expect(request.query).toEqual({
        projectId: PROJECT_ID,
        name: "system.cpu.utilization",
      });
      expect(request.groupByAttributeKeys).toEqual(["state", "cpu.mode"]);
      expect(request.topK).toEqual({ count: MAX_METRIC_SERIES, rankBy: "max" });
      expect(request.aggregationInterval).toBe(AggregationInterval.Minute);
      expect(request.aggregateColumnName).toBe("value");
      expect(request.aggregationTimestampColumnName).toBe("time");
      expect(request.startTimestamp).toBe(START);
      expect(request.endTimestamp).toBe(END);
      // 10 minutes is 11 buckets: 10 series of 12 rows at most.
      expect(request.limit).toBe(MAX_METRIC_SERIES * 12);
      expect(request.skip).toBe(0);
      expect(request.props).toBe(PROPS);
      expect(request.sort).toEqual({ time: SortOrder.Ascending });
    }

    expect(values!.aggregationType).toBe(AggregationType.Avg);
    expect(counts!.aggregationType).toBe(AggregationType.Count);
    // Each request is its own object: the service keeps per-request state.
    expect(values).not.toBe(counts);
  });

  test("a Count read is not counted twice", async () => {
    answer((): AggregatedResult => {
      return { data: [] };
    });

    await GroupedMetricSeries.read({
      query: { projectId: PROJECT_ID, name: "http.server.requests" },
      aggregationType: AggregationType.Count,
      groupBy: ["http.route"],
      interval: AggregationInterval.Total,
      startTime: START,
      endTime: END,
      props: PROPS,
    });

    expect(aggregate).toHaveBeenCalledTimes(1);
    // One bucket per series in a whole-window read.
    expect(requests[0]!.limit).toBe(MAX_METRIC_SERIES * 2);
  });

  test("the row limit never passes the project's", async () => {
    answer((): AggregatedResult => {
      return { data: [] };
    });

    await GroupedMetricSeries.read({
      query: { projectId: PROJECT_ID, name: "system.cpu.utilization" },
      aggregationType: AggregationType.Avg,
      groupBy: ["state"],
      interval: AggregationInterval.Minute,
      startTime: START,
      endTime: new Date(START.getTime() + 30 * 24 * 60 * 60 * 1000),
      props: PROPS,
    });

    expect(requests[0]!.limit).toBe(LIMIT_PER_PROJECT);
  });

  test("a host out of CPU reads as busy states near 1 and idle near 0 - not the flat 1/8 of one average", async () => {
    const data: Array<AggregatedModel> = [
      ...cpuState("user", [0.91, 0.93, 0.95]),
      ...cpuState("system", [0.05, 0.05, 0.04]),
      ...cpuState("idle", [0.02, 0.01, 0]),
      ...cpuState("wait", [0.02, 0.01, 0.01]),
    ];

    answer((request: AggregateBy<Metric>): AggregatedResult => {
      return request.aggregationType === AggregationType.Count
        ? {
            data: data.map((item: AggregatedModel): AggregatedModel => {
              return { ...item, value: 4 };
            }),
            totalGroups: 4,
          }
        : { data, totalGroups: 4 };
    });

    const read: GroupedMetricRead = await readCpu();

    expect(
      read.series.map((series: MetricSeries): string => {
        return series.label;
      }),
    ).toEqual(["state=user", "state=system", "state=idle", "state=wait"]);
    expect(read.totalSeries).toBe(4);
    expect(read.isTruncated).toBe(false);

    const user: MetricSeries = read.series[0]!;

    expect(user.min).toBe(0.91);
    expect(user.max).toBe(0.95);
    expect(user.latest).toBe(0.95);
    expect(user.avg).toBeCloseTo(0.93, 10);
    expect(GroupedMetricSeries.toLlmRow(user)).toEqual({
      series: "state=user",
      min: "0.91",
      avg: "0.93",
      max: "0.95",
      latest: "0.95",
      trend: "0.91 0.93 0.95",
    });
  });

  test("more series than are kept: the read says how many there were and that it was cut", async () => {
    answer((): AggregatedResult => {
      return {
        data: [row({ mountpoint: "/" }, 0, 0.97)],
        totalGroups: 37,
        truncated: true,
      };
    });

    const read: GroupedMetricRead = await GroupedMetricSeries.read({
      query: { projectId: PROJECT_ID, name: "system.filesystem.utilization" },
      aggregationType: AggregationType.Max,
      groupBy: ["mountpoint"],
      interval: AggregationInterval.Minute,
      startTime: START,
      endTime: END,
      props: PROPS,
    });

    expect(read.series).toHaveLength(1);
    expect(read.totalSeries).toBe(37);
    expect(read.isTruncated).toBe(true);
    expect(
      GroupedMetricSeries.describeRead({
        read,
        groupBy: ["mountpoint"],
        interval: AggregationInterval.Minute,
        startTime: START,
      }),
    ).toContain(
      "37 matched; these are the 1 with the highest peak - filter attributes to see the others.",
    );
  });

  test("a read that reached its row limit says so even when no series was cut", async () => {
    answer((request: AggregateBy<Metric>): AggregatedResult => {
      return {
        data: [row({ state: "used" }, 0, 0.5)],
        totalGroups: 1,
        truncated: request.aggregationType === AggregationType.Count,
      };
    });

    const read: GroupedMetricRead = await GroupedMetricSeries.read({
      query: { projectId: PROJECT_ID, name: "system.memory.utilization" },
      aggregationType: AggregationType.Avg,
      groupBy: ["state"],
      interval: AggregationInterval.Minute,
      startTime: START,
      endTime: END,
      props: PROPS,
    });

    expect(read.isTruncated).toBe(true);
    expect(
      GroupedMetricSeries.describeRead({
        read,
        groupBy: ["state"],
        interval: AggregationInterval.Minute,
        startTime: START,
      }),
    ).toContain("The read reached its row limit");
  });
});

describe("GroupedMetricSeries.toSeries", () => {
  test("a bucket counted empty is a gap, not a zero (a distribution exported with no observations)", () => {
    const series: Array<MetricSeries> = GroupedMetricSeries.toSeries({
      valueRows: [
        row({ "http.route": "/api" }, 0, 0.2),
        row({ "http.route": "/api" }, 1, 0),
        row({ "http.route": "/api" }, 2, 0.4),
      ],
      countRows: [
        row({ "http.route": "/api" }, 0, 10),
        row({ "http.route": "/api" }, 1, 0),
        row({ "http.route": "/api" }, 2, 12),
      ],
      groupBy: ["http.route"],
    });

    expect(
      series[0]!.points.map((point: MetricSeriesPoint): number | null => {
        return point.value;
      }),
    ).toEqual([0.2, null, 0.4]);
    expect(series[0]!.min).toBe(0.2);
    expect(GroupedMetricSeries.formatTrend(series[0]!.points)).toBe(
      `0.2 ${TREND_GAP} 0.4`,
    );
  });

  test("without counts, a real zero stays a zero; a value that is not a number is a gap", () => {
    const series: Array<MetricSeries> = GroupedMetricSeries.toSeries({
      valueRows: [
        row({ state: "idle" }, 0, 0),
        row({ state: "idle" }, 1, Number.NaN),
      ],
      groupBy: ["state"],
    });

    expect(
      series[0]!.points.map((point: MetricSeriesPoint): number | null => {
        return point.value;
      }),
    ).toEqual([0, null]);
    expect(series[0]!.max).toBe(0);
  });

  test("rows come back in any order; each series is in time order, highest peak first, then by name", () => {
    const series: Array<MetricSeries> = GroupedMetricSeries.toSeries({
      valueRows: [
        row({ "resource.container.name": "worker" }, 2, 5),
        row({ "resource.container.name": "api" }, 1, 90),
        row({ "resource.container.name": "worker" }, 0, 7),
        row({ "resource.container.name": "db" }, 0, 7),
        row({ "resource.container.name": "api" }, 0, 80),
      ],
      groupBy: ["resource.container.name"],
    });

    expect(
      series.map((item: MetricSeries): string => {
        return item.label;
      }),
    ).toEqual([
      "resource.container.name=api",
      "resource.container.name=db",
      "resource.container.name=worker",
    ]);
    expect(
      series[2]!.points.map((point: MetricSeriesPoint): number => {
        return point.timestamp.getTime();
      }),
    ).toEqual([minute(0).getTime(), minute(2).getTime()]);
    expect(series[2]!.latest).toBe(5);
  });

  test("a series names only the grouped keys its rows carry, and one that carries none says so", () => {
    expect(
      GroupedMetricSeries.describeLabel({ state: "user", "cpu.mode": "" }, [
        "state",
        "cpu.mode",
      ]),
    ).toBe("state=user");
    expect(
      GroupedMetricSeries.describeLabel({ state: "", "cpu.mode": "user" }, [
        "state",
        "cpu.mode",
      ]),
    ).toBe("cpu.mode=user");
    expect(
      GroupedMetricSeries.describeLabel(
        { "resource.host.name": "web-1", state: "used" },
        ["resource.host.name", "state"],
      ),
    ).toBe("resource.host.name=web-1, state=used");
    expect(GroupedMetricSeries.describeLabel({ state: "" }, ["state"])).toBe(
      NO_ATTRIBUTE_VALUE_LABEL,
    );
  });

  test("a row without an attributes map belongs to the series with no value", () => {
    const series: Array<MetricSeries> = GroupedMetricSeries.toSeries({
      valueRows: [{ timestamp: minute(0), value: 3 } as AggregatedModel],
      groupBy: ["state"],
    });

    expect(series[0]!.label).toBe(NO_ATTRIBUTE_VALUE_LABEL);
    expect(series[0]!.attributes).toEqual({ state: "" });
  });
});

describe("what the model reads", () => {
  test("a whole-window series is one value, said once", () => {
    const [series] = GroupedMetricSeries.toSeries({
      valueRows: [row({ state: "used" }, 0, 0.8765432)],
      groupBy: ["state"],
    });

    expect(GroupedMetricSeries.toLlmRow(series!)).toEqual({
      series: "state=used",
      value: "0.8765",
    });
  });

  test("numbers keep four significant digits", () => {
    expect(GroupedMetricSeries.formatNumber(0.123456)).toBe("0.1235");
    expect(GroupedMetricSeries.formatNumber(1234567890)).toBe("1235000000");
    expect(GroupedMetricSeries.formatNumber(97)).toBe("97");
    expect(GroupedMetricSeries.formatNumber(null)).toBe("no data");
    expect(GroupedMetricSeries.formatNumber(Number.POSITIVE_INFINITY)).toBe(
      "no data",
    );
  });

  test("the read describes its series, its buckets and their gaps", () => {
    const read: GroupedMetricRead = {
      series: GroupedMetricSeries.toSeries({
        valueRows: cpuState("user", [0.5]),
        groupBy: ["state", "cpu.mode"],
      }),
      totalSeries: 1,
      isTruncated: false,
    };

    expect(
      GroupedMetricSeries.describeRead({
        read,
        groupBy: ["state", "cpu.mode"],
        interval: AggregationInterval.FiveMinutes,
        startTime: START,
      }),
    ).toBe(
      `1 series by state, cpu.mode, the highest peak first. Each trend lists one value per 5-minute bucket from ${START.toISOString()}, oldest first (${TREND_GAP} = no data in that bucket).`,
    );
    expect(
      GroupedMetricSeries.describeRead({
        read,
        groupBy: ["state"],
        interval: AggregationInterval.Total,
        startTime: START,
      }),
    ).toBe(
      "1 series by state, the highest peak first. Each value covers the whole window.",
    );
  });

  test("no data says so, and that missing data is not health", () => {
    expect(
      GroupedMetricSeries.describeRead({
        read: { series: [], totalSeries: 0, isTruncated: false },
        groupBy: ["state"],
        interval: AggregationInterval.Minute,
        startTime: START,
      }),
    ).toBe(
      "No data points matched, so there is no series by state. Missing data is not evidence of health.",
    );
  });

  test("every interval has words", () => {
    for (const interval of Object.values(AggregationInterval)) {
      expect(describeInterval(interval).length).toBeGreaterThan(0);
    }
    expect(describeInterval(AggregationInterval.Minute)).toBe("1-minute");
    expect(describeInterval(AggregationInterval.Hour)).toBe("1-hour");
  });

  test("the chart has one line per series, with its gaps", () => {
    const series: Array<MetricSeries> = GroupedMetricSeries.toSeries({
      valueRows: [row({ state: "used" }, 0, 0.5), row({ state: "used" }, 1, 0)],
      countRows: [row({ state: "used" }, 0, 1), row({ state: "used" }, 1, 0)],
      groupBy: ["state"],
    });

    const widgetSeries: Array<JSONObject> = GroupedMetricSeries.toWidgetSeries(
      series,
    ) as unknown as Array<JSONObject>;

    expect(widgetSeries).toEqual([
      {
        name: "state=used",
        points: [
          { x: minute(0).toISOString(), y: 0.5 },
          { x: minute(1).toISOString(), y: null },
        ],
      },
    ]);
  });
});

/*
 * What people read on a grouped chart. A split metric is grouped by its old
 * and its new attribute name at once (state and cpu.mode), and a collector
 * sends one of them: the chart names the one there is - "... by state" -
 * and calls its lines "user", "system", "idle", not "state=user".
 */
describe("a grouped chart's names", () => {
  const BOTH_NAMES: Array<string> = ["state", "cpu.mode"];

  function seriesOf(
    rows: Array<AggregatedModel>,
    groupBy: Array<string>,
  ): Array<MetricSeries> {
    return GroupedMetricSeries.toSeries({ valueRows: rows, groupBy });
  }

  test("only the grouped keys the series carry are named", () => {
    const oldNames: Array<MetricSeries> = seriesOf(
      [row({ state: "user" }, 0, 0.9), row({ state: "idle" }, 0, 0.1)],
      BOTH_NAMES,
    );
    const newNames: Array<MetricSeries> = seriesOf(
      [row({ "cpu.mode": "user" }, 0, 0.9)],
      BOTH_NAMES,
    );

    expect(GroupedMetricSeries.getShownGroupBy(oldNames, BOTH_NAMES)).toEqual([
      "state",
    ]);
    expect(GroupedMetricSeries.getShownGroupBy(newNames, BOTH_NAMES)).toEqual([
      "cpu.mode",
    ]);
  });

  test("all of them when no series carries any, and every one that some series does, in their order", () => {
    expect(
      GroupedMetricSeries.getShownGroupBy(
        seriesOf([row({}, 0, 1)], BOTH_NAMES),
        BOTH_NAMES,
      ),
    ).toEqual(BOTH_NAMES);
    expect(
      GroupedMetricSeries.getShownGroupBy(
        seriesOf(
          [
            row({ "service.name": "api" }, 0, 1),
            row({ "service.name": "web", region: "eu" }, 0, 2),
          ],
          ["region", "service.name"],
        ),
        ["region", "service.name"],
      ),
    ).toEqual(["region", "service.name"]);
  });

  test("one attribute telling the lines apart: each line is its value", () => {
    const series: Array<MetricSeries> = seriesOf(
      [
        row({ state: "user" }, 0, 0.9),
        row({ state: "idle" }, 0, 0.1),
        row({}, 0, 0.5),
      ],
      BOTH_NAMES,
    );

    expect(
      GroupedMetricSeries.toWidgetSeries(series, BOTH_NAMES).map(
        (item: { name: string }): string => {
          return item.name;
        },
      ),
    ).toEqual(["user", NO_ATTRIBUTE_VALUE_LABEL, "idle"]);
  });

  test("several: each line keeps its label, which says which is which", () => {
    const series: Array<MetricSeries> = seriesOf(
      [
        row({ "service.name": "api", region: "eu" }, 0, 2),
        row({ "service.name": "web", region: "us" }, 0, 1),
      ],
      ["service.name", "region"],
    );

    expect(
      GroupedMetricSeries.toWidgetSeries(series, [
        "service.name",
        "region",
      ]).map((item: { name: string }): string => {
        return item.name;
      }),
    ).toEqual(["service.name=api, region=eu", "service.name=web, region=us"]);
  });
});
