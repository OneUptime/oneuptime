/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MetricMonitorCriteria, {
  IsCriteriaInEffect,
  MetricSeriesEvaluationResult,
} from "../../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import MonitorCriteriaEvaluator from "../../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../../Types/JSON";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricDescriptorsByName,
} from "../../../../../Types/MessageQueue/MessageQueueMetricCatalog";
import MetricFormulaConfigData from "../../../../../Types/Metrics/MetricFormulaConfigData";
import MetricsViewConfig from "../../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import {
  KubernetesAlertTemplate,
  getKubernetesAlertTemplateById,
} from "../../../../../Types/Monitor/KubernetesAlertTemplates";
import {
  MessageQueueAlertTemplate,
  getMessageQueueAlertTemplateForMetric,
} from "../../../../../Types/Monitor/MessageQueueAlertTemplates";
import MetricCriteriaContext from "../../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesArrival from "../../../../../Types/Monitor/MetricMonitor/MetricSeriesArrival";
import MetricSeriesResult from "../../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "../../../../../Types/Monitor/MonitorStepMetricMonitor";
import ObjectID from "../../../../../Types/ObjectID";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../../Types/RollingTime/RollingTimeUtil";
import MetricFormulaEvaluator from "../../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../../Utils/Metrics/MetricSeriesFingerprint";
import { MarkdownText } from "../../../../../Utils/Markdown/FeedMarkdown";
import {
  METRIC_FIXTURES,
  MetricFixture,
} from "../../../../Types/MessageQueue/MessagingTelemetryFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * "ALL VALUES" AND FORECASTS, JUDGED BY WHEN A SERIES' DATA ARRIVED
 * (#4912's follow-ups, #5281, #5437).
 *
 * Two monitors #4912 got wrong, both shipped templates fed data shaped as
 * the worker hands it over, with the arrivals the worker read:
 *
 *   - Kubernetes "Deployment Replica Mismatch" on a cluster whose
 *     collector's clock runs three minutes behind: every data point looks
 *     three minutes stale against now, so All Values waited for ever and a
 *     deployment that was short all along never alerted.
 *   - CloudWatch "SQS backlog" on a Metrics monitor whose exporter went
 *     away: freshness was judged against the monitor's own newest data
 *     point, so when every queue stopped at once, each was as fresh as the
 *     newest, and the window was judged up to where they stopped.
 *
 * With arrivals, a series is stale once nothing of it has arrived for one
 * and a half times its cadence, and late - judged as far as its data
 * reaches - while it keeps arriving. Every time is fixed.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

// The check: 12:15:30, so a 15-minute window starts at 12:00:30.
const NOW: Date = new Date(Date.UTC(2026, 9, 16, 12, 15, 30));
const WINDOW: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
  RollingTime.Past15Minutes,
  NOW,
);

const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const DEPLOYMENT_KEY: string = "resource.k8s.deployment.name";

const replicaTemplate: KubernetesAlertTemplate = getKubernetesAlertTemplateById(
  "k8s-deployment-replica-mismatch",
)!;

const replicaStep: MonitorStep = replicaTemplate.getMonitorStep({
  clusterIdentifier: "prod",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Replica Mismatch",
});

const replicaView: MetricsViewConfig =
  MonitorStep.getMetricsViewConfig(replicaStep)!;

// replica_shortfall > 0, All Values: the shipped firing filter.
const shortfallFilter: CriteriaFilter =
  replicaStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
    .filters[0]!;

function bucket(minute: number): Date {
  return new Date(Date.UTC(2026, 9, 16, 12, 0, 0) + minute * MINUTE);
}

function labelsOf(deployment: string): JSONObject {
  return { [NAMESPACE_KEY]: "payments", [DEPLOYMENT_KEY]: deployment };
}

// A collector that sends what it reads as it reads it.
const ON_TIME: MetricSeriesArrival = {
  sinceNewestArrivalMs: 20 * SECOND,
  lagMs: 25 * SECOND,
  arrivalIntervalMs: MINUTE,
};

// A collector whose clock runs three minutes behind: late, but arriving.
const CLOCK_BEHIND: MetricSeriesArrival = {
  sinceNewestArrivalMs: 20 * SECOND,
  lagMs: 3 * MINUTE + 25 * SECOND,
  arrivalIntervalMs: MINUTE,
};

// An agent that went away six minutes ago.
const GONE: MetricSeriesArrival = {
  sinceNewestArrivalMs: 6 * MINUTE + 10 * SECOND,
  lagMs: 25 * SECOND,
  arrivalIntervalMs: MINUTE,
};

/*
 * One deployment short by one replica from 12:`from` to 12:`to`, as
 * buildSeriesBreakdown hands it over - desired, available and the formula -
 * with each of those three's arrivals, when given.
 */
function deployment(input: {
  name: string;
  from: number;
  to: number;
  arrivals?: Array<MetricSeriesArrival | null>;
}): MetricSeriesResult {
  const rows: (value: number) => AggregatedResult = (
    value: number,
  ): AggregatedResult => {
    const data: Array<AggregateModel> = [];
    for (let minute: number = input.from; minute <= input.to; minute++) {
      data.push({
        timestamp: bucket(minute),
        value: value,
        attributes: labelsOf(input.name),
      });
    }
    return { data };
  };

  const queryResults: Array<AggregatedResult> = [rows(3), rows(2)];
  const formula: MetricFormulaConfigData = replicaView.formulaConfigs[0]!;

  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(
      labelsOf(input.name),
    ),
    labels: labelsOf(input.name),
    aggregatedResults: [
      ...queryResults,
      MetricFormulaEvaluator.evaluateFormula({
        formula: formula.metricFormulaData.metricFormula,
        queryConfigs: replicaView.queryConfigs,
        formulaConfigs: [],
        results: queryResults,
      }),
    ],
    ...(input.arrivals ? { arrivals: input.arrivals } : {}),
  };
}

function replicaResponse(
  breakdown: Array<MetricSeriesResult>,
): MetricMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig: replicaView,
    metricResult: [],
    seriesBreakdown: breakdown,
    startAndEndDate: WINDOW,
  };
}

async function evaluate(input: {
  response: MetricMonitorResponse;
  step: MonitorStep;
  filter: CriteriaFilter;
  isInEffect?: IsCriteriaInEffect;
}): Promise<Array<MetricSeriesEvaluationResult>> {
  return await MetricMonitorCriteria.evaluateAllSeries({
    dataToProcess: input.response as DataToProcess,
    // A copy: the evaluator writes its context back onto the filter.
    criteriaFilter: JSON.parse(JSON.stringify(input.filter)),
    monitorStep: input.step,
    isInEffect: input.isInEffect,
  });
}

// "fires", or the evaluation log's waiting message.
function verdict(evaluation: MetricSeriesEvaluationResult): string {
  if (evaluation.rootCause) {
    return "fires";
  }

  return evaluation.context.windowWait?.message || "not met";
}

type EvaluatorPrivate = {
  buildMetricRootCauseContext: (input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }) => MarkdownText | null;
};

// The Metric Details an incident's root cause starts with, for a context.
function metricDetails(context: MetricCriteriaContext): string {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.MetricValue,
        metricCriteriaContext: context,
      } as CriteriaFilter,
    ],
    incidents: [],
    alerts: [],
    name: "Replica shortfall",
    description: "Replica shortfall",
    id: ObjectID.generate().toString(),
  };

  const markdown: MarkdownText | null = (
    MonitorCriteriaEvaluator as unknown as EvaluatorPrivate
  ).buildMetricRootCauseContext({
    criteriaInstance: instance,
    monitor: new Monitor(),
  });

  expect(markdown).not.toBeNull();
  return markdown!.toString();
}

describe("a cluster whose collector's clock runs three minutes behind", () => {
  // Short the whole window by its own clock: 12:00 to 12:11, 3.5 minutes behind now.
  const shortAllAlong: (
    arrivals?: Array<MetricSeriesArrival | null>,
  ) => MetricSeriesResult = (
    arrivals?: Array<MetricSeriesArrival | null>,
  ): MetricSeriesResult => {
    return deployment({ name: "api", from: 0, to: 11, arrivals });
  };

  test("by its data points' times alone, a deployment short all along waits for ever", async () => {
    const [evaluation] = await evaluate({
      response: replicaResponse([shortAllAlong()]),
      step: replicaStep,
      filter: shortfallFilter,
    });

    expect(verdict(evaluation!)).toContain(
      "Waiting for 15 minutes of data: no new data point for the last 3 minutes.",
    );
  });

  test("with its arrivals, it is late, not stopped: the alert opens", async () => {
    const [evaluation] = await evaluate({
      response: replicaResponse([
        shortAllAlong([CLOCK_BEHIND, CLOCK_BEHIND, CLOCK_BEHIND]),
      ]),
      step: replicaStep,
      filter: shortfallFilter,
    });

    expect(verdict(evaluation!)).toBe("fires");
    expect(evaluation!.context.windowWait).toBeUndefined();
    expect(evaluation!.context.dataLagMs).toBe(3 * MINUTE + 25 * SECOND);
  });

  test("its incident says how late the data arrives, in the Metric Details", async () => {
    const [evaluation] = await evaluate({
      response: replicaResponse([
        shortAllAlong([CLOCK_BEHIND, CLOCK_BEHIND, CLOCK_BEHIND]),
      ]),
      step: replicaStep,
      filter: shortfallFilter,
    });

    const details: string = metricDetails(evaluation!.context);

    expect(details).toContain("- Data Arrives: about 3 minutes late");

    // Among the facts about the metric, before the breaching samples.
    expect(details.indexOf("- Data Arrives:")).toBeLessThan(
      details.indexOf("**Breaching Samples**"),
    );
    expect(details.indexOf("- Data Arrives:")).toBeGreaterThan(
      details.indexOf("**Metric Details**"),
    );
  });

  test("a collector on time says nothing of it", async () => {
    const [evaluation] = await evaluate({
      response: replicaResponse([
        deployment({
          name: "api",
          from: 0,
          to: 14,
          arrivals: [ON_TIME, ON_TIME, ON_TIME],
        }),
      ]),
      step: replicaStep,
      filter: shortfallFilter,
    });

    expect(verdict(evaluation!)).toBe("fires");
    expect(evaluation!.context.dataLagMs).toBeUndefined();
    expect(metricDetails(evaluation!.context)).not.toContain("Data Arrives");
  });

  test("a deployment that only just fell short still waits, and says why it has got no further", async () => {
    const [evaluation] = await evaluate({
      response: replicaResponse([
        deployment({
          name: "checkout",
          from: 9,
          to: 11,
          arrivals: [CLOCK_BEHIND, CLOCK_BEHIND, CLOCK_BEHIND],
        }),
      ]),
      step: replicaStep,
      filter: shortfallFilter,
    });

    expect(verdict(evaluation!)).toBe(
      "Deployment: checkout | Namespace: payments - Deployment Replica Shortfall was 1 in all 3 readings, above the 0 threshold. Waiting for 15 minutes of data: 3 of 15 minutes so far. Its data arrives about 3 minutes late.",
    );
  });

  test("when the agent goes away, the window is not judged off its last readings", async () => {
    const [evaluation] = await evaluate({
      response: replicaResponse([shortAllAlong([GONE, GONE, GONE])]),
      step: replicaStep,
      filter: shortfallFilter,
    });

    // Since its data last arrived - not how old its newest data point is.
    expect(verdict(evaluation!)).toContain(
      "Waiting for 15 minutes of data: no new data point for the last 6 minutes.",
    );
  });

  test("an open alert is judged on its data alone, as before: going quiet does not resolve it", async () => {
    const [evaluation] = await evaluate({
      response: replicaResponse([shortAllAlong([GONE, GONE, GONE])]),
      step: replicaStep,
      filter: shortfallFilter,
      isInEffect: async (): Promise<boolean> => {
        return true;
      },
    });

    expect(verdict(evaluation!)).toBe("fires");
  });

  test("the arrivals of the formula the criteria compares decide, not its queries'", async () => {
    const formulaStopped: Array<MetricSeriesEvaluationResult> = await evaluate({
      response: replicaResponse([
        shortAllAlong([CLOCK_BEHIND, CLOCK_BEHIND, GONE]),
      ]),
      step: replicaStep,
      filter: shortfallFilter,
    });
    const formulaArriving: Array<MetricSeriesEvaluationResult> = await evaluate(
      {
        response: replicaResponse([shortAllAlong([GONE, GONE, CLOCK_BEHIND])]),
        step: replicaStep,
        filter: shortfallFilter,
      },
    );

    expect(verdict(formulaStopped[0]!)).toContain(
      "no new data point for the last 6 minutes",
    );
    expect(verdict(formulaArriving[0]!)).toBe("fires");
  });

  test("each series by its own arrivals: one late and arriving fires, one gone waits, one unread is judged as before", async () => {
    const evaluations: Array<MetricSeriesEvaluationResult> = await evaluate({
      response: replicaResponse([
        deployment({
          name: "api",
          from: 0,
          to: 11,
          arrivals: [CLOCK_BEHIND, CLOCK_BEHIND, CLOCK_BEHIND],
        }),
        deployment({
          name: "worker",
          from: 0,
          to: 11,
          arrivals: [GONE, GONE, GONE],
        }),
        deployment({ name: "cron", from: 0, to: 11 }),
        deployment({
          name: "web",
          from: 0,
          to: 11,
          arrivals: [null, null, null],
        }),
      ]),
      step: replicaStep,
      filter: shortfallFilter,
    });

    const byName: Record<string, string> = {};
    for (const evaluation of evaluations) {
      byName[String(evaluation.labels[DEPLOYMENT_KEY])] = verdict(evaluation);
    }

    expect(byName["api"]).toBe("fires");
    expect(byName["worker"]).toContain(
      "no new data point for the last 6 minutes",
    );
    expect(byName["cron"]).toContain(
      "no new data point for the last 3 minutes",
    );
    expect(byName["web"]).toContain("no new data point for the last 3 minutes");
  });
});

/*
 * The shipped CloudWatch SQS backlog template on a Metrics monitor: the
 * aws_cloudwatch receiver delivers one-minute periods ten minutes old every
 * five minutes, so the newest data point is 11 to 16 minutes old and five
 * arrive at once.
 */
describe("a Metrics monitor on CloudWatch", () => {
  const descriptor: MessageQueueMetricDescriptor =
    getMessageQueueMetricDescriptorsByName(
      "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
    ).find((candidate: MessageQueueMetricDescriptor) => {
      return candidate.system === "aws_sqs";
    })!;

  const template: MessageQueueAlertTemplate =
    getMessageQueueAlertTemplateForMetric(descriptor)!;

  const ordersFixture: MetricFixture = METRIC_FIXTURES.find(
    (candidate: MetricFixture) => {
      return (
        candidate.metricName === template.metricName &&
        candidate.expected?.system === template.system
      );
    },
  )!;

  const sqsStep: MonitorStep = template.getMonitorStep({
    observedSeries: [ordersFixture.attributes],
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Queue orders",
  })!;

  const sqsView: MetricsViewConfig = MonitorStep.getMetricsViewConfig(sqsStep)!;

  // At or above 1,000 messages, All Values.
  const backlogHigh: CriteriaFilter =
    sqsStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
      .filters[0]!;

  // Past 30 Minutes at 12:30:30: from 12:00:30.
  const lateWindow: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    RollingTime.Past30Minutes,
    new Date(Date.UTC(2026, 9, 16, 12, 30, 30)),
  );

  // A backlog of 2,500 in every period from 12:01 to 12:`to`.
  function backlog(
    to: number,
    arrivals?: Array<MetricSeriesArrival | null>,
  ): MetricMonitorResponse {
    const data: Array<AggregateModel> = [];
    for (let minute: number = 1; minute <= to; minute++) {
      data.push({ timestamp: bucket(minute), value: 2500 });
    }

    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: sqsView,
      metricResult: [{ data }],
      startAndEndDate: lateWindow,
      ...(arrivals ? { metricResultArrivals: arrivals } : {}),
    };
  }

  // Delivered every five minutes, the last two minutes ago.
  const DELIVERING: MetricSeriesArrival = {
    sinceNewestArrivalMs: 2 * MINUTE,
    lagMs: 11 * MINUTE,
    arrivalIntervalMs: 5 * MINUTE,
  };

  // The exporter went away: the last delivery nine minutes ago.
  const EXPORTER_GONE: MetricSeriesArrival = {
    sinceNewestArrivalMs: 9 * MINUTE,
    lagMs: 11 * MINUTE,
    arrivalIntervalMs: 5 * MINUTE,
  };

  test("a backlog high at every delivered period fires, as it did", async () => {
    for (const arrivals of [undefined, [DELIVERING]]) {
      const [evaluation] = await evaluate({
        response: backlog(16, arrivals),
        step: sqsStep,
        filter: backlogHigh,
      });

      expect({
        arrivals: Boolean(arrivals),
        verdict: verdict(evaluation!),
      }).toEqual({
        arrivals: Boolean(arrivals),
        verdict: "fires",
      });
    }
  });

  test("with its arrivals, the incident says how late CloudWatch's data arrives", async () => {
    const [evaluation] = await evaluate({
      response: backlog(16, [DELIVERING]),
      step: sqsStep,
      filter: backlogHigh,
    });

    expect(evaluation!.context.dataLagMs).toBe(11 * MINUTE);
    expect(metricDetails(evaluation!.context)).toContain(
      "- Data Arrives: about 11 minutes late",
    );
  });

  test("when the exporter goes away, the window is no longer judged up to where its data stopped", async () => {
    // The queue's data stopped at 12:07 - every series of the monitor at once.
    const [before] = await evaluate({
      response: backlog(7),
      step: sqsStep,
      filter: backlogHigh,
    });
    const [after] = await evaluate({
      response: backlog(7, [EXPORTER_GONE]),
      step: sqsStep,
      filter: backlogHigh,
    });

    // Judged against its own newest data point, it looked fresh.
    expect(verdict(before!)).toBe("fires");
    expect(verdict(after!)).toContain(
      "Waiting for 30 minutes of data: no new data point for the last 9 minutes.",
    );
  });

  test("a delivery that is due, not missed, is still fresh: up to one and a half deliveries", async () => {
    const [evaluation] = await evaluate({
      response: backlog(16, [
        { ...DELIVERING, sinceNewestArrivalMs: 7 * MINUTE },
      ]),
      step: sqsStep,
      filter: backlogHigh,
    });

    expect(verdict(evaluation!)).toBe("fires");
  });
});

describe("a forecast, judged by when its data arrived", () => {
  // A disk filling a little every hour, grouped by nothing.
  const forecastFilter: CriteriaFilter = {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.ForecastAbove,
    value: 90,
    metricMonitorOptions: {
      metricAlias: "a",
      metricAggregationType: EvaluateOverTimeType.MaximumValue,
      forecast: { horizonInHours: 24 * 7 },
    },
  } as CriteriaFilter;

  const forecastView: MetricsViewConfig = {
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "a",
          title: "Disk Used",
          description: undefined,
          legend: undefined,
          legendUnit: undefined,
        },
        metricQueryData: {
          filterData: {
            metricName: "system.filesystem.utilization",
            attributes: {},
            aggegationType: "Max",
            aggregateBy: {},
          },
        },
      },
    ],
    formulaConfigs: [],
  } as unknown as MetricsViewConfig;

  const forecastStep: MonitorStep = new MonitorStep().setMetricMonitor({
    ...MonitorStepMetricMonitorUtil.getDefault(),
    metricViewConfig: forecastView,
    rollingTime: RollingTime.Past7Days,
  });

  const weekWindow: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    RollingTime.Past7Days,
    NOW,
  );

  // One point an hour, rising half a percent an hour, to `toHoursAgo`.
  function disk(
    toHoursAgo: number,
    arrivals?: Array<MetricSeriesArrival | null>,
  ): MetricMonitorResponse {
    const data: Array<AggregateModel> = [];
    for (let hoursAgo: number = 167; hoursAgo >= toHoursAgo; hoursAgo--) {
      data.push({
        timestamp: new Date(NOW.getTime() - hoursAgo * 60 * MINUTE),
        value: 70 - hoursAgo / 48,
      });
    }

    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: forecastView,
      metricResult: [{ data }],
      startAndEndDate: weekWindow,
      ...(arrivals ? { metricResultArrivals: arrivals } : {}),
    };
  }

  test("a series stopped for a day, all of the monitor at once, is no longer forecast", async () => {
    // Its newest data point is the monitor's newest: fresh against itself.
    const [before] = await evaluate({
      response: disk(24),
      step: forecastStep,
      filter: forecastFilter,
    });
    const [after] = await evaluate({
      response: disk(24, [
        {
          sinceNewestArrivalMs: 24 * 60 * MINUTE,
          lagMs: 0,
          arrivalIntervalMs: 60 * MINUTE,
        },
      ]),
      step: forecastStep,
      filter: forecastFilter,
    });

    expect(before!.context.forecast?.state).toBe("Forecast");
    expect(after!.context.forecast?.state).toBe("Stale");
    expect(after!.context.forecast?.message).toContain("is not forecast");
  });

  test("a series a day behind that still arrives is forecast, and says how late", async () => {
    const [evaluation] = await evaluate({
      response: disk(24, [
        {
          sinceNewestArrivalMs: 10 * MINUTE,
          lagMs: 24 * 60 * MINUTE,
          arrivalIntervalMs: 60 * MINUTE,
        },
      ]),
      step: forecastStep,
      filter: forecastFilter,
    });

    expect(evaluation!.context.forecast?.state).toBe("Forecast");
    expect(evaluation!.context.dataLagMs).toBe(24 * 60 * MINUTE);
  });
});

describe("MetricMonitorCriteria.judgesFreshness: which criteria read when data arrived", () => {
  function filterOf(input: {
    filterType: FilterType;
    aggregation?: EvaluateOverTimeType;
    overTime?: EvaluateOverTimeType;
  }): CriteriaFilter {
    return {
      checkOn: CheckOn.MetricValue,
      filterType: input.filterType,
      value: 1,
      metricMonitorOptions: {
        metricAlias: "a",
        ...(input.aggregation
          ? { metricAggregationType: input.aggregation }
          : {}),
      },
      ...(input.overTime
        ? {
            evaluateOverTime: true,
            evaluateOverTimeOptions: { evaluateOverTimeType: input.overTime },
          }
        : {}),
    } as CriteriaFilter;
  }

  test("All Values and the forecasts do", () => {
    expect(
      MetricMonitorCriteria.judgesFreshness(
        filterOf({
          filterType: FilterType.GreaterThan,
          aggregation: EvaluateOverTimeType.AllValues,
        }),
      ),
    ).toBe(true);
    expect(
      MetricMonitorCriteria.judgesFreshness(
        filterOf({
          filterType: FilterType.GreaterThan,
          overTime: EvaluateOverTimeType.AllValues,
        }),
      ),
    ).toBe(true);
    for (const filterType of [
      FilterType.ForecastAbove,
      FilterType.ForecastBelow,
    ]) {
      expect(
        MetricMonitorCriteria.judgesFreshness(
          filterOf({
            filterType,
            aggregation: EvaluateOverTimeType.Average,
          }),
        ),
      ).toBe(true);
    }
  });

  test("the measures of the data that arrived do not", () => {
    for (const aggregation of [
      EvaluateOverTimeType.Average,
      EvaluateOverTimeType.Sum,
      EvaluateOverTimeType.MaximumValue,
      EvaluateOverTimeType.MunimumValue,
      EvaluateOverTimeType.AnyValue,
    ]) {
      expect({
        aggregation,
        judges: MetricMonitorCriteria.judgesFreshness(
          filterOf({ filterType: FilterType.GreaterThan, aggregation }),
        ),
      }).toEqual({ aggregation, judges: false });
    }

    for (const filterType of [
      FilterType.IsEmpty,
      FilterType.IsNotEmpty,
      FilterType.AnomalouslyHigh,
    ]) {
      expect(
        MetricMonitorCriteria.judgesFreshness(filterOf({ filterType })),
      ).toBe(false);
    }
  });
});
