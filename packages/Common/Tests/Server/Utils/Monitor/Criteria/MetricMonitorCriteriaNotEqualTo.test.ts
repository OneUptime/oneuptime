/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing here touches the
 * sandbox, so the module is stubbed before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MetricMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MonitorCriteriaEvaluator from "../../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import MetricQueryConfigData from "../../../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteria from "../../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../../Types/RollingTime/RollingTimeUtil";
import MetricSeriesFingerprint from "../../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, test } from "@jest/globals";

/*
 * NOT EQUAL TO, FOR A METRIC'S VALUE (#10449).
 *
 * Many metrics are a state written as a number: a Windows service's
 * windows.service.status (1 Stopped ... 4 Running ... 7 Paused), a systemd
 * unit's state set, an enum gauge. What is asked of one is "not in the
 * healthy state". The criteria form now offers Not Equal To for a metric's
 * value; the evaluator always compared it (CompareCriteria). These judge it
 * the way a check is judged - a window of one data point a minute, as the
 * worker hands it over - over every way a window is read, and through the
 * whole evaluator, where criteria are tried in order and a grouped monitor
 * judges each series on its own.
 */

const MINUTE: number = 60_000;

// The check: 12:05:00, so a five-minute window reads 12:00 to 12:05.
const NOW: Date = new Date(Date.UTC(2026, 10, 20, 12, 5, 0));
const WINDOW: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
  RollingTime.Past5Minutes,
  NOW,
);

const RUNNING: number = 4;

const query: MetricQueryConfigData = {
  metricAliasData: {
    metricVariable: "status",
    title: "status",
    description: undefined,
    legend: undefined,
    legendUnit: undefined,
  },
  metricQueryData: {
    filterData: {
      metricName: "windows.service.status",
      attributes: { name: "Spooler" },
    },
  },
} as MetricQueryConfigData;

const viewConfig: MetricsViewConfig = {
  queryConfigs: [query],
  formulaConfigs: [],
};

// One data point a minute, the first at the window's start.
function points(values: Array<number>): Array<AggregateModel> {
  return values.map((value: number, index: number): AggregateModel => {
    return {
      timestamp: new Date(WINDOW.startValue.getTime() + index * MINUTE),
      value: value,
    } as AggregateModel;
  });
}

function stepOf(criteria: Array<MonitorCriteriaInstance>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: criteria };
  step.data!.metricMonitor = {
    metricViewConfig: viewConfig,
    rollingTime: RollingTime.Past5Minutes,
  };
  step.data!.monitorCriteria = monitorCriteria;
  return step;
}

function responseOf(data: {
  values?: Array<number>;
  series?: Array<{ host: string; values: Array<number> }>;
}): MetricMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: viewConfig,
    startAndEndDate: WINDOW,
    metricResult: [{ data: points(data.values || []) }],
    ...(data.series
      ? {
          seriesBreakdown: data.series.map(
            (series: { host: string; values: Array<number> }) => {
              const labels: { [key: string]: string } = {
                "resource.host.name": series.host,
              };

              return {
                fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
                labels: labels,
                aggregatedResults: [{ data: points(series.values) }],
              } as MetricSeriesResult;
            },
          ),
        }
      : {}),
  } as MetricMonitorResponse;
}

function notEqualTo(
  value: number,
  evaluation: EvaluateOverTimeType,
): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.NotEqualTo,
    value: value,
    metricMonitorOptions: {
      metricAlias: "status",
      metricAggregationType: evaluation,
    },
  };
}

// What the metric criteria evaluator says of one filter over a window.
async function judge(
  filter: CriteriaFilter,
  values: Array<number>,
): Promise<string | null> {
  return MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: responseOf({ values }),
    monitorStep: stepOf([]),
    criteriaFilter: filter,
  });
}

describe("Not Equal To over a window, read every way a window is read", () => {
  /*
   * [how the window is read, its five minutes, whether the filter is met]
   * A Windows service's status, compared with Running (4).
   */
  const cases: Array<[EvaluateOverTimeType, Array<number>, boolean]> = [
    // Any Value: one minute in another state is enough.
    [EvaluateOverTimeType.AnyValue, [4, 4, 4, 4, 1], true],
    [EvaluateOverTimeType.AnyValue, [7, 1, 2, 3, 5], true],
    [EvaluateOverTimeType.AnyValue, [4, 4, 4, 4, 4], false],
    // All Values: every minute in another state.
    [EvaluateOverTimeType.AllValues, [1, 1, 3, 7, 7], true],
    [EvaluateOverTimeType.AllValues, [1, 1, 4, 7, 7], false],
    // An aggregate: the window's one value, compared once.
    [EvaluateOverTimeType.Average, [4, 4, 4, 4, 1], true],
    [EvaluateOverTimeType.Average, [3, 5, 4, 4, 4], false],
    [EvaluateOverTimeType.MaximumValue, [1, 2, 3, 3, 1], true],
    [EvaluateOverTimeType.MaximumValue, [1, 2, 4, 3, 1], false],
    [EvaluateOverTimeType.MunimumValue, [7, 7, 5, 6, 7], true],
    [EvaluateOverTimeType.MunimumValue, [7, 4, 5, 6, 7], false],
    [EvaluateOverTimeType.Sum, [1, 1, 1, 1, 1], true],
    [EvaluateOverTimeType.Sum, [1, 1, 1, 1, 0], false],
  ];

  test.each(cases)(
    "%s of %j: met is %s",
    async (
      evaluation: EvaluateOverTimeType,
      values: Array<number>,
      isMet: boolean,
    ) => {
      const threshold: number =
        evaluation === EvaluateOverTimeType.Sum ? 4 : RUNNING;
      const rootCause: string | null = await judge(
        notEqualTo(threshold, evaluation),
        values,
      );

      expect(rootCause !== null).toBe(isMet);

      if (isMet) {
        // The root cause's line, as the reader reads it.
        expect(rootCause).toContain(
          `different from the ${threshold} threshold`,
        );
      }
    },
  );

  test("Any Value names the minutes in another state, not the window", async () => {
    expect(
      await judge(
        notEqualTo(RUNNING, EvaluateOverTimeType.AnyValue),
        [4, 4, 4, 1, 1],
      ),
    ).toContain("was 1 in 2 of 5 readings, different from the 4 threshold.");
  });

  test("All Values says every reading was in another state", async () => {
    expect(
      await judge(
        notEqualTo(RUNNING, EvaluateOverTimeType.AllValues),
        [1, 3, 1, 7, 1],
      ),
    ).toContain("ranged from 1 to 7 across all 5 readings");
  });

  test("an aggregate says what it compared", async () => {
    expect(
      await judge(
        notEqualTo(RUNNING, EvaluateOverTimeType.Average),
        [4, 4, 4, 4, 1],
      ),
    ).toContain("The average of");
  });

  test("a window with no data point is not 'another state': nothing is compared", async () => {
    for (const evaluation of Object.values(EvaluateOverTimeType)) {
      expect(await judge(notEqualTo(RUNNING, evaluation), [])).toBeNull();
    }
  });

  test("a threshold the form saved as text is the number it says", async () => {
    const filter: CriteriaFilter = {
      ...notEqualTo(RUNNING, EvaluateOverTimeType.AnyValue),
      value: "4",
    };

    expect(await judge(filter, [4, 4, 4, 4, 4])).toBeNull();
    expect(await judge(filter, [4, 4, 4, 4, 7])).not.toBeNull();
  });
});

describe("Not Equal To through the whole evaluator", () => {
  const ONLINE: ObjectID = ObjectID.generate();
  const OFFLINE: ObjectID = ObjectID.generate();

  function criteriaInstance(data: {
    name: string;
    filter: CriteriaFilter;
    monitorStatusId: ObjectID;
  }): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = {
      id: ObjectID.generate().toString(),
      monitorStatusId: data.monitorStatusId,
      filterCondition: FilterCondition.Any,
      filters: [data.filter],
      incidents: [],
      alerts: [],
      changeMonitorStatus: true,
      createIncidents: false,
      createAlerts: false,
      isEnabled: true,
      name: data.name,
      description: data.name,
    };
    return instance;
  }

  // As Create Monitor makes a Windows service's monitor: running first.
  function serviceCriteria(): Array<MonitorCriteriaInstance> {
    return [
      criteriaInstance({
        name: "Spooler is running",
        filter: {
          ...notEqualTo(RUNNING, EvaluateOverTimeType.AnyValue),
          filterType: FilterType.EqualTo,
        },
        monitorStatusId: ONLINE,
      }),
      criteriaInstance({
        name: "Spooler is not running",
        filter: notEqualTo(RUNNING, EvaluateOverTimeType.AnyValue),
        monitorStatusId: OFFLINE,
      }),
    ];
  }

  async function check(
    criteria: Array<MonitorCriteriaInstance>,
    response: MetricMonitorResponse,
  ): Promise<ProbeApiIngestResponse> {
    const monitor: Monitor = new Monitor();
    monitor._id = response.monitorId.toString();
    monitor.projectId = response.projectId;
    monitor.monitorType = MonitorType.Metrics;

    return MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: response,
      monitorStep: stepOf(criteria),
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: response.monitorId,
        rootCause: null,
      },
      evaluationSummary: {
        criteriaResults: [],
        events: [],
      } as unknown as MonitorEvaluationSummary,
    });
  }

  test("a service that ran in a minute of the window is running, whatever else it did", async () => {
    const criteria: Array<MonitorCriteriaInstance> = serviceCriteria();
    const result: ProbeApiIngestResponse = await check(
      criteria,
      responseOf({ values: [1, 1, 4, 3, 1] }),
    );

    expect(result.criteriaMetId?.toString()).toBe(
      criteria[0]!.data!.id!.toString(),
    );
  });

  test.each([
    ["Stopped", [1, 1, 1, 1, 1]],
    ["stuck starting", [2, 2, 2, 2, 2]],
    ["Paused", [7, 7, 7, 7, 7]],
    ["Paused, then Stopped", [7, 7, 1, 1, 1]],
  ])(
    "%s for the whole window: not running, and the root cause says how",
    async (_state: string, values: Array<number>) => {
      const criteria: Array<MonitorCriteriaInstance> = serviceCriteria();
      const result: ProbeApiIngestResponse = await check(
        criteria,
        responseOf({ values }),
      );

      expect(result.criteriaMetId?.toString()).toBe(
        criteria[1]!.data!.id!.toString(),
      );
      expect(result.rootCause).toContain(
        "**Criteria Name**: Spooler is not running",
      );
      expect(result.rootCause).toContain("different from the 4 threshold");
    },
  );

  test("a grouped monitor judges each host's series on its own: only the host not running matches", async () => {
    const criteria: Array<MonitorCriteriaInstance> = [
      criteriaInstance({
        name: "Spooler is not running",
        filter: notEqualTo(RUNNING, EvaluateOverTimeType.AllValues),
        monitorStatusId: OFFLINE,
      }),
    ];

    const result: ProbeApiIngestResponse = await check(
      criteria,
      responseOf({
        values: [4, 4, 4, 4, 4],
        series: [
          { host: "web-01", values: [4, 4, 4, 4, 4] },
          { host: "web-02", values: [1, 1, 7, 7, 1] },
          { host: "web-03", values: [1, 1, 4, 1, 1] },
        ],
      }),
    );

    expect(
      (result.perSeriesMatches || []).map(
        (match: { labels?: { [key: string]: unknown } }) => {
          return match.labels?.["resource.host.name"];
        },
      ),
    ).toEqual(["web-02"]);
  });
});
