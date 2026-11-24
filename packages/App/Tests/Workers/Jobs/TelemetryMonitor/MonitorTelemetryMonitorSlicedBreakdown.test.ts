import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import ObjectID from "Common/Types/ObjectID";
import EventLoop, { EventLoopBudget } from "Common/Server/Utils/EventLoop";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A GROUPED METRIC MONITOR'S SERIES, BROKEN DOWN IN SLICES (issue #10108).
 *
 * The worker buckets every query's rows by series and works out each
 * series' formulas (buildSeriesBreakdown), and works out the formulas over
 * the whole read (appendFormulaResults): for the #10108 fleet, 16,250
 * series and 160,000 rows, most of a second of work in one block. The
 * worker now runs both in slices, handing the event loop back between
 * series and every 1,024 rows once the work has taken its budget, and reads
 * each row's series once for the whole evaluation (a shared reader). The
 * slices must give what the one block gave, and the shared reader what each
 * query's own reading did.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: {
      aggregateBy: jest.fn(),
      findBy: jest.fn(),
      readSeriesArrivals: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/HostService", () => {
  return {
    __esModule: true,
    default: { getExpectedHostIdentifiers: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IoTFleetService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IoTDeviceCredentialService", () => {
  return {
    __esModule: true,
    default: { getExpectedDeviceExternalIds: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import {
  appendFormulaResults,
  appendFormulaResultsInSlices,
  buildSeriesBreakdown,
  buildSeriesBreakdownInSlices,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const HOST_KEY: string = "resource.host.name";
const CONTAINER_KEY: string = "resource.container.name";
const KEYS: Array<string> = [HOST_KEY, CONTAINER_KEY];
const WINDOW_START_MS: number = Date.UTC(2026, 10, 17, 10, 0, 0);
const MINUTE_MS: number = 60 * 1000;

const SERIES: number = 1_500;
const MINUTES: number = 10;

function query(
  variable: string,
  aggregation: MetricsAggregationType,
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: "container.restarts",
        attributes: {},
        aggegationType: aggregation,
        aggregateBy: {},
      },
      groupByAttributeKeys: KEYS,
    },
  } as MetricQueryConfigData;
}

const QUERIES: Array<MetricQueryConfigData> = [
  query("a", MetricsAggregationType.Max),
  query("b", MetricsAggregationType.Min),
];

const FORMULAS: Array<MetricFormulaConfigData> = [
  {
    metricAliasData: {
      metricVariable: "c",
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricFormulaData: { metricFormula: "$a - $b" },
  } as MetricFormulaConfigData,
];

/*
 * A grouped read as ClickHouse returns it: a row per series and minute,
 * newest minute first. The Minimum's read misses every seventh series'
 * newest minute, so a series' queries do not always line up.
 */
function read(variable: "a" | "b"): AggregatedResult {
  const data: Array<AggregatedModel> = [];

  for (let minute: number = MINUTES - 1; minute >= 0; minute--) {
    for (let series: number = 0; series < SERIES; series++) {
      if (variable === "b" && minute === MINUTES - 1 && series % 7 === 0) {
        continue;
      }

      data.push({
        timestamp: new Date(WINDOW_START_MS + minute * MINUTE_MS),
        value:
          variable === "a"
            ? (series * 13 + minute) % 50
            : (series * 3 + minute) % 20,
        attributes: {
          [HOST_KEY]: `docker-host-${String(series % 101).padStart(4, "0")}`,
          [CONTAINER_KEY]: `container-${series}`,
        },
      } as unknown as AggregatedModel);
    }
  }

  return { data: data };
}

const PROJECT_ID: ObjectID = ObjectID.generate();

let handBacks: number;

beforeEach(() => {
  handBacks = 0;
  jest
    .spyOn(EventLoop, "yieldToEventLoop")
    .mockImplementation(async (): Promise<void> => {
      handBacks++;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildSeriesBreakdownInSlices", () => {
  test("gives what buildSeriesBreakdown gives, handing the loop back between series and rows", async () => {
    const perQueryResults: Array<AggregatedResult> = [read("a"), read("b")];

    const inOneBlock: Array<MetricSeriesResult> = buildSeriesBreakdown({
      queryConfigs: QUERIES,
      formulaConfigs: FORMULAS,
      perQueryResults,
      attributeKeys: KEYS,
      projectId: PROJECT_ID,
    });
    expect(handBacks).toBe(0);

    // A budget spent at once: the loop is handed back at every pause.
    const inSlices: Array<MetricSeriesResult> =
      await buildSeriesBreakdownInSlices(
        {
          queryConfigs: QUERIES,
          formulaConfigs: FORMULAS,
          perQueryResults,
          attributeKeys: KEYS,
          projectId: PROJECT_ID,
        },
        new EventLoopBudget(0),
      );

    expect(inSlices).toEqual(inOneBlock);
    expect(inSlices).toHaveLength(SERIES);
    // Every 1,024 rows of the two reads, and after each series.
    expect(handBacks).toBeGreaterThanOrEqual(
      Math.floor(perQueryResults[0]!.data.length / 1_024) +
        Math.floor(perQueryResults[1]!.data.length / 1_024) +
        SERIES,
    );
  });

  test("with the default budget, hands the loop back only once the work has taken it", async () => {
    const perQueryResults: Array<AggregatedResult> = [read("a"), read("b")];
    let now: number = 0;
    let pauses: number = 0;
    // Each pause asks the clock: say a tenth of a millisecond of work each.
    jest.spyOn(EventLoop, "now").mockImplementation((): number => {
      pauses++;
      now += 0.1;
      return now;
    });

    const inSlices: Array<MetricSeriesResult> =
      await buildSeriesBreakdownInSlices({
        queryConfigs: QUERIES,
        formulaConfigs: FORMULAS,
        perQueryResults,
        attributeKeys: KEYS,
        projectId: PROJECT_ID,
      });

    expect(inSlices).toHaveLength(SERIES);
    // Some 150 ms of work: handed back about every 20 ms, not every pause.
    expect(pauses).toBeGreaterThan(SERIES);
    expect(handBacks).toBeGreaterThan(0);
    expect(handBacks).toBeLessThan(pauses / 100);
  });

  test("a series reader shared by the evaluation gives what each breakdown's own gave", () => {
    const perQueryResults: Array<AggregatedResult> = [read("a"), read("b")];
    const shared: ReturnType<
      typeof MetricSeriesFingerprint.createSeriesReader
    > = MetricSeriesFingerprint.createSeriesReader(KEYS);

    const withOwnReader: Array<MetricSeriesResult> = buildSeriesBreakdown({
      queryConfigs: QUERIES,
      formulaConfigs: FORMULAS,
      perQueryResults,
      attributeKeys: KEYS,
      projectId: PROJECT_ID,
    });

    // Read first by another of the evaluation's reads, then by this one.
    for (const result of perQueryResults) {
      for (const row of result.data) {
        shared(row);
      }
    }

    const withSharedReader: Array<MetricSeriesResult> = buildSeriesBreakdown({
      queryConfigs: QUERIES,
      formulaConfigs: FORMULAS,
      perQueryResults,
      attributeKeys: KEYS,
      projectId: PROJECT_ID,
      readSeries: shared,
    });

    expect(withSharedReader).toEqual(withOwnReader);

    // Each series under the fingerprint of its labels, as before.
    for (const series of withSharedReader.slice(0, 50)) {
      expect(series.fingerprint).toBe(
        MetricSeriesFingerprint.computeFingerprint(series.labels),
      );
    }
  });
});

describe("appendFormulaResultsInSlices", () => {
  test("gives what appendFormulaResults gives, handing the loop back as it goes", async () => {
    const aggregatedResults: Array<AggregatedResult> = [read("a"), read("b")];

    const inOneBlock: Array<AggregatedResult> = appendFormulaResults({
      queryConfigs: QUERIES,
      formulaConfigs: FORMULAS,
      aggregatedResults,
      projectId: PROJECT_ID,
    });
    expect(handBacks).toBe(0);

    const inSlices: Array<AggregatedResult> =
      await appendFormulaResultsInSlices(
        {
          queryConfigs: QUERIES,
          formulaConfigs: FORMULAS,
          aggregatedResults,
          projectId: PROJECT_ID,
        },
        new EventLoopBudget(0),
      );

    expect(inSlices).toEqual(inOneBlock);
    // The two reads, and the formula's points over every series.
    expect(inSlices).toHaveLength(3);
    expect(inSlices[2]!.data.length).toBeGreaterThan(SERIES * (MINUTES - 1));
    expect(handBacks).toBeGreaterThanOrEqual(SERIES);
  });
});
