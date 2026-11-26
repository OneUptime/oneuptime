import { AggregationTemporality } from "Common/Models/AnalyticsModels/Metric";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "Common/Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import { MonitorStepKubernetesMonitorUtil } from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepDockerMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepHostMonitorUtil } from "Common/Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepPodmanMonitorUtil } from "Common/Types/Monitor/MonitorStepPodmanMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepProxmoxMonitorUtil } from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import { MonitorStepOpenStackMonitorUtil } from "Common/Types/Monitor/MonitorStepOpenStackMonitor";
import { MonitorStepVMwareMonitorUtil } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { MonitorStepCephMonitorUtil } from "Common/Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepStorageArrayMonitorUtil } from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import { MonitorStepXcpNgMonitorUtil } from "Common/Types/Monitor/MonitorStepXcpNgMonitor";
import { MonitorStepIoTMonitorUtil } from "Common/Types/Monitor/MonitorStepIoTMonitor";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import { MetricZeroFillOptions } from "Common/Utils/Metrics/MetricZeroFill";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A MONITOR'S FAILURE SHARE READS 0% WHERE NOTHING FAILED (#6761), WITHOUT
 * A FALSE ALERT OR A FALSE RESOLVE.
 *
 * The worker reads a failure share `$b / $a * 100` - everything sent, and
 * what failed, two Sum queries of a delta counter - a minute at a time. A
 * minute with no failure has no point of `b`, and used to have no value of
 * the share: no data, as far as the criteria could tell. The worker now
 * reads the metric's catalog entry, and its formulas read a counting query
 * with no point as 0 in a minute that has been over for a minute
 * (MetricZeroFill): the minutes still being counted keep their gaps, so a
 * failure still in the ingest queue never reads as 0% and resolves the
 * alert it keeps open.
 *
 * Every metric-backed monitor type reads its formulas so. The worker's
 * response then goes through the real MetricMonitorCriteria. The datastores
 * are replaced, and every time is fixed.
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

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import HostService from "Common/Server/Services/HostService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import DataToProcess from "Common/Server/Utils/Monitor/DataToProcess";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import {
  appendFormulaResults,
  buildSeriesBreakdown,
  getFormulaZeroFill,
  monitorCeph,
  monitorDocker,
  monitorDockerSwarm,
  monitorHost,
  monitorIoT,
  monitorKubernetes,
  monitorMetric,
  monitorOpenStack,
  monitorPodman,
  monitorProxmox,
  monitorStorageArray,
  monitorVMware,
  monitorXcpNg,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const MINUTE: number = 60_000;

// The check: 12:15:30, so a 15-minute window starts at 12:00:30.
const NOW: Date = new Date(Date.UTC(2026, 10, 1, 12, 15, 30));

const SENT: string = "notification.send.count";
const SERVICE_KEY: string = "service.name";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricReadSeriesArrivals: jest.Mock =
  MetricService.readSeriesArrivals as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

// The minute bucket starting `minute` minutes after 12:00.
function bucket(minute: number): Date {
  return new Date(Date.UTC(2026, 10, 1, 12, 0, 0) + minute * MINUTE);
}

// The minute a time falls in: 12:00:30 is in minute 0, as its bucket is.
function minuteOf(timestamp: Date | string): number {
  return Math.floor(
    (new Date(timestamp).getTime() - bucket(0).getTime()) / MINUTE,
  );
}

function query(input: {
  variable: string;
  failures: boolean;
  aggregation?: MetricsAggregationType | undefined;
  grouped?: boolean | undefined;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: input.variable,
      title: input.failures ? "Failed" : "Sent",
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: SENT,
        attributes: input.failures ? { outcome: "failure" } : {},
        aggegationType: input.aggregation || MetricsAggregationType.Sum,
        aggregateBy: {},
      },
      ...(input.grouped ? { groupByAttributeKeys: [SERVICE_KEY] } : {}),
    },
  } as MetricQueryConfigData;
}

const SHARE: MetricFormulaConfigData = {
  metricAliasData: {
    metricVariable: "c",
    title: "Failure Share",
    description: undefined,
    legend: undefined,
    legendUnit: "%",
  },
  metricFormulaData: { metricFormula: "$b / $a * 100" },
};

function view(input: {
  grouped: boolean;
  aggregation?: MetricsAggregationType | undefined;
}): MetricsViewConfig {
  return {
    queryConfigs: [
      query({ variable: "a", failures: false, ...input }),
      query({ variable: "b", failures: true, ...input }),
    ],
    formulaConfigs: [SHARE],
  };
}

/*
 * The step of one metric-backed monitor type reading `metricViewConfig` over
 * the past 15 minutes. A type this does not know fails, so a new
 * metric-backed type cannot slip past this suite.
 */
function stepFor(
  monitorType: MonitorType,
  metricViewConfig: MetricsViewConfig,
): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  const rollingTime: RollingTime = RollingTime.Past15Minutes;

  switch (monitorType) {
    case MonitorType.Metrics:
      return step.setMetricMonitor({
        ...MonitorStepMetricMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Kubernetes:
      return step.setKubernetesMonitor({
        ...MonitorStepKubernetesMonitorUtil.getDefault(),
        clusterIdentifier: "prod",
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Docker:
      return step.setDockerMonitor({
        ...MonitorStepDockerMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Host:
      return step.setHostMonitor({
        ...MonitorStepHostMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Podman:
      return step.setPodmanMonitor({
        ...MonitorStepPodmanMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.DockerSwarm:
      return step.setDockerSwarmMonitor({
        ...MonitorStepDockerSwarmMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Proxmox:
      return step.setProxmoxMonitor({
        ...MonitorStepProxmoxMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.OpenStack:
      return step.setOpenStackMonitor({
        ...MonitorStepOpenStackMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.VMware:
      return step.setVMwareMonitor({
        ...MonitorStepVMwareMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Ceph:
      return step.setCephMonitor({
        ...MonitorStepCephMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.StorageArray:
      return step.setStorageArrayMonitor({
        ...MonitorStepStorageArrayMonitorUtil.getDefault(),
        arrayIdentifier: "pure-prod-01",
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.XcpNg:
      return step.setXcpNgMonitor({
        ...MonitorStepXcpNgMonitorUtil.getDefault(),
        poolIdentifier: "1e8b7c4a-3f2d-4b6e-9a1c-0d5e7f9b2a3c",
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.IoTDevice:
      return step.setIoTMonitor({
        ...MonitorStepIoTMonitorUtil.getDefault(),
        fleetIdentifier: "fleet-1",
        metricViewConfig,
        rollingTime,
      });
    default:
      throw new Error(
        `${monitorType} is metric-backed but this suite builds no step for it`,
      );
  }
}

type Reader = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

const READERS: Partial<Record<MonitorType, Reader>> = {
  [MonitorType.Metrics]: monitorMetric,
  [MonitorType.Kubernetes]: monitorKubernetes,
  [MonitorType.Docker]: monitorDocker,
  [MonitorType.Host]: monitorHost,
  [MonitorType.Podman]: monitorPodman,
  [MonitorType.DockerSwarm]: monitorDockerSwarm,
  [MonitorType.Proxmox]: monitorProxmox,
  [MonitorType.OpenStack]: monitorOpenStack,
  [MonitorType.VMware]: monitorVMware,
  [MonitorType.Ceph]: monitorCeph,
  [MonitorType.StorageArray]: monitorStorageArray,
  [MonitorType.XcpNg]: monitorXcpNg,
  [MonitorType.IoTDevice]: monitorIoT,
};

/*
 * What the store holds, a row a minute: what each service sent, and what
 * failed. `failedMinutes` are the minutes `api` failed in - 5 of every 100
 * - and `web` never fails.
 */
let failedMinutes: Array<number> = [];

const SENT_PER_MINUTE: Record<string, number> = { api: 100, web: 50 };
const FAILED_PER_MINUTE: number = 5;

function givenStore(input: { failedMinutes: Array<number> }): void {
  failedMinutes = input.failedMinutes;

  metricAggregateBy.mockImplementation(
    async (args: unknown): Promise<AggregatedResult> => {
      const aggregate: {
        query: { attributes?: Record<string, unknown> };
        startTimestamp: Date;
        endTimestamp: Date;
        groupByAttributeKeys?: Array<string> | undefined;
        aggregationInterval?: AggregationInterval | undefined;
      } = args as {
        query: { attributes?: Record<string, unknown> };
        startTimestamp: Date;
        endTimestamp: Date;
        groupByAttributeKeys?: Array<string> | undefined;
        aggregationInterval?: AggregationInterval | undefined;
      };

      const isFailures: boolean =
        aggregate.query.attributes?.["outcome"] === "failure";
      const isGrouped: boolean = Boolean(
        aggregate.groupByAttributeKeys &&
          aggregate.groupByAttributeKeys.length > 0,
      );

      const data: Array<AggregatedModel> = [];

      for (
        let minute: number = minuteOf(aggregate.startTimestamp);
        minute <= minuteOf(aggregate.endTimestamp);
        minute++
      ) {
        const byService: Record<string, number> = {};

        for (const service of Object.keys(SENT_PER_MINUTE)) {
          if (!isFailures) {
            byService[service] = SENT_PER_MINUTE[service]!;
          } else if (service === "api" && failedMinutes.includes(minute)) {
            byService[service] = FAILED_PER_MINUTE;
          }
        }

        if (isGrouped) {
          for (const [service, value] of Object.entries(byService)) {
            data.push({
              timestamp: bucket(minute),
              value: value,
              attributes: { [SERVICE_KEY]: service } as JSONObject,
            });
          }
        } else if (Object.keys(byService).length > 0) {
          data.push({
            timestamp: bucket(minute),
            value: Object.values(byService).reduce(
              (sum: number, value: number) => {
                return sum + value;
              },
              0,
            ),
          });
        }
      }

      return { data };
    },
  );
}

// What the catalog says the metric is.
function givenCatalog(
  semantics: {
    isMonotonic: boolean | null;
    aggregationTemporality: AggregationTemporality | null;
  } | null,
): void {
  metricTypeFindBy.mockResolvedValue(
    (semantics ? [{ name: SENT, unit: "1", ...semantics }] : []) as never,
  );
}

const DELTA_COUNTER: {
  isMonotonic: boolean;
  aggregationTemporality: AggregationTemporality;
} = { isMonotonic: true, aggregationTemporality: AggregationTemporality.Delta };

async function read(
  monitorType: MonitorType,
  metricViewConfig: MetricsViewConfig,
): Promise<MetricMonitorResponse> {
  return await READERS[monitorType]!({
    monitorStep: stepFor(monitorType, metricViewConfig),
    monitorId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    evaluateUntil: NOW,
  });
}

// The formula's values by minute, as `[minute, value]`.
function shareOf(results: Array<AggregatedResult>): Array<[number, number]> {
  return results[2]!.data.map((row: AggregatedModel): [number, number] => {
    return [minuteOf(row.timestamp), Math.round(row.value * 100) / 100];
  });
}

function seriesOf(
  response: MetricMonitorResponse,
  service: string,
): MetricSeriesResult {
  return response.seriesBreakdown!.find((series: MetricSeriesResult) => {
    return series.labels[SERVICE_KEY] === service;
  })!;
}

// Every minute from `from` to `to`, at `value`.
function minutes(
  from: number,
  to: number,
  value: number,
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let minute: number = from; minute <= to; minute++) {
    result.push([minute, value]);
  }
  return result;
}

// The minutes from `from` to `to`.
function minuteRange(from: number, to: number): Array<number> {
  return minutes(from, to, 0).map((entry: [number, number]): number => {
    return entry[0];
  });
}

beforeEach(() => {
  metricAggregateBy.mockReset();
  metricFindBy.mockReset().mockResolvedValue([] as never);
  metricReadSeriesArrivals.mockReset().mockResolvedValue([] as never);
  metricTypeFindBy.mockReset();
  (HostService.getExpectedHostIdentifiers as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue([] as never);
  (IoTFleetService.findOneBy as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue(null as never);
});

describe("every metric-backed monitor type reads a minute with no failure as a 0% share", () => {
  const types: Array<MonitorType> =
    MonitorTypeHelper.getMetricBackedMonitorTypes();

  test("this suite reads every metric-backed type", () => {
    expect(types.length).toBeGreaterThan(0);

    for (const monitorType of types) {
      expect({ monitorType, read: Boolean(READERS[monitorType]) }).toEqual({
        monitorType,
        read: true,
      });
    }
  });

  test.each(types)(
    "%s: 0% in each settled minute with no failure, the share where one failed, and nothing in the minutes still being counted",
    async (monitorType: MonitorType) => {
      givenStore({ failedMinutes: [5] });
      givenCatalog(DELTA_COUNTER);

      const response: MetricMonitorResponse = await read(
        monitorType,
        view({ grouped: false }),
      );

      /*
       * 12:00 to 12:13 are over and settled: 0%, but 12:05's 5 of 150.
       * 12:14 ended 30 seconds before the check and 12:15 is running: a
       * failure there may still be in the queue, so neither reads as 0%.
       */
      expect(shareOf(response.metricResult!)).toEqual([
        ...minutes(0, 4, 0),
        [5, 3.33],
        ...minutes(6, 13, 0),
      ]);
    },
  );

  test.each(types)(
    "%s: a metric the catalog calls a gauge keeps its gaps, as before",
    async (monitorType: MonitorType) => {
      givenStore({ failedMinutes: [5] });
      givenCatalog({ isMonotonic: null, aggregationTemporality: null });

      const response: MetricMonitorResponse = await read(
        monitorType,
        view({ grouped: false }),
      );

      expect(shareOf(response.metricResult!)).toEqual([[5, 3.33]]);
    },
  );

  test.each(types)(
    "%s: a grouped share reads 0% for the service with no failure",
    async (monitorType: MonitorType) => {
      givenStore({
        failedMinutes: minuteRange(0, 15),
      });
      givenCatalog(DELTA_COUNTER);

      const response: MetricMonitorResponse = await read(
        monitorType,
        view({ grouped: true }),
      );

      expect(shareOf(seriesOf(response, "web").aggregatedResults)).toEqual(
        minutes(0, 13, 0),
      );
      expect(shareOf(seriesOf(response, "api").aggregatedResults)).toEqual(
        minutes(0, 15, 5),
      );
    },
  );
});

describe("a Metrics monitor's catalog read", () => {
  test("reads the counter semantics with the units, in one read", async () => {
    givenStore({ failedMinutes: [] });
    givenCatalog(DELTA_COUNTER);

    await read(MonitorType.Metrics, view({ grouped: false }));

    expect(metricTypeFindBy).toHaveBeenCalledTimes(1);
    expect(
      (metricTypeFindBy.mock.calls[0]![0] as { select: JSONObject }).select,
    ).toEqual({
      name: true,
      unit: true,
      isMonotonic: true,
      aggregationTemporality: true,
    });
  });

  test("a metric the catalog does not list is never guessed at", async () => {
    givenStore({ failedMinutes: [5] });
    givenCatalog(null);

    const response: MetricMonitorResponse = await read(
      MonitorType.Metrics,
      view({ grouped: false }),
    );

    expect(shareOf(response.metricResult!)).toEqual([[5, 3.33]]);
  });

  test("an average is no count: its gaps stay", async () => {
    givenStore({ failedMinutes: [5] });
    givenCatalog(DELTA_COUNTER);

    const response: MetricMonitorResponse = await read(
      MonitorType.Metrics,
      view({ grouped: false, aggregation: MetricsAggregationType.Avg }),
    );

    expect(shareOf(response.metricResult!)).toEqual([[5, 3.33]]);
  });
});

/*
 * The response through the real criteria evaluator: "the failure share is
 * above 1%", as a team sets it for its SLO.
 */
describe("the failure share's criteria, judged on the worker's response", () => {
  function shareAbove(input: {
    aggregation: EvaluateOverTimeType;
    onNoDataPolicy?: NoDataPolicy | undefined;
  }): CriteriaFilter {
    return {
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: 1,
      metricMonitorOptions: {
        metricAlias: "c",
        metricAggregationType: input.aggregation,
        ...(input.onNoDataPolicy
          ? { onNoDataPolicy: input.onNoDataPolicy }
          : {}),
      },
    } as CriteriaFilter;
  }

  async function verdicts(input: {
    response: MetricMonitorResponse;
    criteriaFilter: CriteriaFilter;
    inEffect?: Array<string> | undefined;
  }): Promise<Record<string, string>> {
    const evaluations: Array<MetricSeriesEvaluationResult> =
      await MetricMonitorCriteria.evaluateAllSeries({
        dataToProcess: input.response as DataToProcess,
        criteriaFilter: input.criteriaFilter,
        monitorStep: stepFor(MonitorType.Metrics, view({ grouped: true })),
        isInEffect: async (fingerprint: string | undefined) => {
          return (input.inEffect || []).some((service: string) => {
            return (
              seriesOf(input.response, service).fingerprint === fingerprint
            );
          });
        },
      });

    const byService: Record<string, string> = {};

    for (const evaluation of evaluations) {
      byService[String(evaluation.labels[SERVICE_KEY])] = evaluation.rootCause
        ? "matches"
        : "does not match";
    }

    return byService;
  }

  test('a service with no failure is 0%, not missing: "alert on no data" no longer fires for it', async () => {
    givenStore({
      failedMinutes: minuteRange(0, 15),
    });

    // Without the catalog's word, web has no share at all: "no data".
    givenCatalog(null);
    const before: MetricMonitorResponse = await read(
      MonitorType.Metrics,
      view({ grouped: true }),
    );

    expect(
      await verdicts({
        response: before,
        criteriaFilter: shareAbove({
          aggregation: EvaluateOverTimeType.AnyValue,
          onNoDataPolicy: NoDataPolicy.Trigger,
        }),
      }),
    ).toEqual({ api: "matches", web: "matches" });

    givenCatalog(DELTA_COUNTER);
    const after: MetricMonitorResponse = await read(
      MonitorType.Metrics,
      view({ grouped: true }),
    );

    expect(
      await verdicts({
        response: after,
        criteriaFilter: shareAbove({
          aggregation: EvaluateOverTimeType.AnyValue,
          onNoDataPolicy: NoDataPolicy.Trigger,
        }),
      }),
    ).toEqual({ api: "matches", web: "does not match" });
  });

  test("an open alert is not resolved by the minutes still being counted: their failures may be in the queue", async () => {
    // api failed in every minute that is in; the last two minutes' are not.
    givenStore({
      failedMinutes: minuteRange(0, 13),
    });
    givenCatalog(DELTA_COUNTER);

    const response: MetricMonitorResponse = await read(
      MonitorType.Metrics,
      view({ grouped: true }),
    );

    expect(shareOf(seriesOf(response, "api").aggregatedResults)).toEqual(
      minutes(0, 13, 5),
    );

    expect(
      await verdicts({
        response,
        criteriaFilter: shareAbove({
          aggregation: EvaluateOverTimeType.AllValues,
        }),
        inEffect: ["api"],
      }),
    ).toEqual({ api: "matches", web: "does not match" });
  });

  test("an open alert resolves once a settled minute had no failure: nothing failed then", async () => {
    givenStore({
      failedMinutes: minuteRange(0, 10),
    });
    givenCatalog(DELTA_COUNTER);

    const response: MetricMonitorResponse = await read(
      MonitorType.Metrics,
      view({ grouped: true }),
    );

    expect(shareOf(seriesOf(response, "api").aggregatedResults)).toEqual([
      ...minutes(0, 10, 5),
      ...minutes(11, 13, 0),
    ]);

    expect(
      await verdicts({
        response,
        criteriaFilter: shareAbove({
          aggregation: EvaluateOverTimeType.AllValues,
        }),
        inEffect: ["api"],
      }),
    ).toEqual({ api: "does not match", web: "does not match" });
  });

  test("the average share is the share of every minute, not only of those that failed", async () => {
    givenStore({ failedMinutes: [5] });
    givenCatalog(DELTA_COUNTER);

    const response: MetricMonitorResponse = await read(
      MonitorType.Metrics,
      view({ grouped: true }),
    );

    // One bad minute of 5% in 14: an average of about 0.36%, not 5%.
    expect(
      await verdicts({
        response,
        criteriaFilter: shareAbove({
          aggregation: EvaluateOverTimeType.Average,
        }),
      }),
    ).toEqual({ api: "does not match", web: "does not match" });
  });

  test("a whole window of silence is still no data: nothing is read as 0 without a point to read it beside", async () => {
    metricAggregateBy.mockResolvedValue({ data: [] } as never);
    givenCatalog(DELTA_COUNTER);

    const response: MetricMonitorResponse = await read(
      MonitorType.Metrics,
      view({ grouped: false }),
    );

    expect(response.metricResult![2]!.data).toEqual([]);

    expect(
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response as DataToProcess,
        criteriaFilter: shareAbove({
          aggregation: EvaluateOverTimeType.AnyValue,
          onNoDataPolicy: NoDataPolicy.Trigger,
        }),
        monitorStep: stepFor(MonitorType.Metrics, view({ grouped: false })),
      }),
    ).toMatch(/No data received/);
  });

  test("the root cause names the failures query's 0 beside the share it was worked out with", async () => {
    givenStore({ failedMinutes: [] });
    givenCatalog(DELTA_COUNTER);

    const response: MetricMonitorResponse = await read(
      MonitorType.Metrics,
      view({ grouped: false }),
    );

    // "the share is at or below 1%": every settled minute matches, at 0%.
    const criteriaFilter: CriteriaFilter = {
      ...shareAbove({ aggregation: EvaluateOverTimeType.AnyValue }),
      filterType: FilterType.LessThanOrEqualTo,
    } as CriteriaFilter;

    const evaluations: Array<MetricSeriesEvaluationResult> =
      await MetricMonitorCriteria.evaluateAllSeries({
        dataToProcess: response as DataToProcess,
        criteriaFilter,
        monitorStep: stepFor(MonitorType.Metrics, view({ grouped: false })),
      });

    const sample:
      | NonNullable<
          MetricSeriesEvaluationResult["context"]["breachingSamples"]
        >[number]
      | undefined = evaluations[0]!.context.breachingSamples?.[0];

    expect(sample?.value).toBe(0);
    expect(sample?.componentValues).toEqual([
      { alias: "b", value: 0 },
      { alias: "a", value: 150 },
    ]);
  });
});

describe("getFormulaZeroFill: the worker's steps", () => {
  const window: InBetween<Date> = new InBetween<Date>(
    new Date(NOW.getTime() - 15 * MINUTE),
    NOW,
  );

  test("a minute is settled a minute after it ends, by the window's end", () => {
    const zeroFill: MetricZeroFillOptions = getFormulaZeroFill({
      metricTypes: [],
      startAndEndDate: window,
    });

    expect(zeroFill.isStepSettled!(bucket(13))).toBe(true);
    expect(zeroFill.isStepSettled!(bucket(14))).toBe(false);
    expect(zeroFill.isStepSettled!(bucket(15))).toBe(false);
  });

  test("a window read as one value ends at the window's end, and is never settled", () => {
    const zeroFill: MetricZeroFillOptions = getFormulaZeroFill({
      metricTypes: [],
      startAndEndDate: window,
      aggregatesWholeWindow: true,
    });

    expect(zeroFill.isStepSettled!(NOW)).toBe(false);
    expect(zeroFill.isStepSettled!(window.startValue as Date)).toBe(false);
  });
});

describe("buildSeriesBreakdown: a series a cut read lacks may only have been cut", () => {
  const zeroFill: MetricZeroFillOptions = {
    semanticsByMetricName: new Map([[SENT, DELTA_COUNTER]]),
  };

  const sentByService: AggregatedResult = {
    data: [
      {
        timestamp: bucket(1),
        value: 100,
        attributes: { [SERVICE_KEY]: "api" } as JSONObject,
      },
      {
        timestamp: bucket(1),
        value: 50,
        attributes: { [SERVICE_KEY]: "web" } as JSONObject,
      },
    ],
  };

  const failuresOfApi: AggregatedResult = {
    data: [
      {
        timestamp: bucket(1),
        value: 5,
        attributes: { [SERVICE_KEY]: "api" } as JSONObject,
      },
    ],
  };

  function breakdown(failures: AggregatedResult): Array<MetricSeriesResult> {
    const metricViewConfig: MetricsViewConfig = view({ grouped: true });

    return buildSeriesBreakdown({
      queryConfigs: metricViewConfig.queryConfigs,
      formulaConfigs: metricViewConfig.formulaConfigs,
      perQueryResults: [sentByService, failures],
      attributeKeys: [SERVICE_KEY],
      projectId: ObjectID.generate(),
      zeroFill,
    });
  }

  function webShare(series: Array<MetricSeriesResult>): Array<number> {
    return series
      .find((entry: MetricSeriesResult) => {
        return entry.labels[SERVICE_KEY] === "web";
      })!
      .aggregatedResults[2]!.data.map((row: AggregatedModel) => {
        return row.value;
      });
  }

  test("a whole read: the service it has no series for counted nothing", () => {
    expect(webShare(breakdown(failuresOfApi))).toEqual([0]);
  });

  test("a read cut at its row limit: the service may only have been cut, and keeps its gap", () => {
    const series: Array<MetricSeriesResult> = breakdown({
      ...failuresOfApi,
      truncated: true,
    });

    expect(webShare(series)).toEqual([]);
    // Every series of the cut read says it was cut.
    expect(
      series.map((entry: MetricSeriesResult) => {
        return entry.aggregatedResults[1]!.truncated;
      }),
    ).toEqual([true, true]);
  });

  test("appendFormulaResults without the catalog's word reads gaps, as before", () => {
    const metricViewConfig: MetricsViewConfig = view({ grouped: false });

    const results: Array<AggregatedResult> = appendFormulaResults({
      queryConfigs: metricViewConfig.queryConfigs,
      formulaConfigs: metricViewConfig.formulaConfigs,
      aggregatedResults: [
        {
          data: [
            { timestamp: bucket(1), value: 150 },
            { timestamp: bucket(2), value: 150 },
          ],
        },
        { data: [{ timestamp: bucket(2), value: 3 }] },
      ],
      projectId: ObjectID.generate(),
    });

    expect(shareOf(results)).toEqual([[2, 2]]);
  });
});
