/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricDescriptorsByName,
} from "../../../../Types/MessageQueue/MessageQueueMetricCatalog";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CephAlertTemplate,
  getAllCephAlertTemplates,
} from "../../../../Types/Monitor/CephAlertTemplates";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  DockerSwarmAlertTemplate,
  getAllDockerSwarmAlertTemplates,
} from "../../../../Types/Monitor/DockerSwarmAlertTemplates";
import {
  KubernetesAlertTemplate,
  getKubernetesAlertTemplateById,
} from "../../../../Types/Monitor/KubernetesAlertTemplates";
import {
  MessageQueueAlertTemplate,
  getMessageQueueAlertTemplateForMetric,
} from "../../../../Types/Monitor/MessageQueueAlertTemplates";
import MetricCriteriaContext from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesArrival from "../../../../Types/Monitor/MetricMonitor/MetricSeriesArrival";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  ProxmoxAlertTemplate,
  getAllProxmoxAlertTemplates,
} from "../../../../Types/Monitor/ProxmoxAlertTemplates";
import {
  StorageArrayAlertTemplate,
  getAllStorageArrayAlertTemplates,
} from "../../../../Types/Monitor/StorageArrayAlertTemplates";
import {
  VMwareAlertTemplate,
  getAllVMwareAlertTemplates,
} from "../../../../Types/Monitor/VMwareAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import {
  METRIC_FIXTURES,
  MetricFixture,
} from "../../../Types/MessageQueue/MessagingTelemetryFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW LATE A SERIES' DATA ARRIVES, WHERE AN ALERT OR INCIDENT SAYS IT
 * (#4912's follow-up, PR #5714's UI review).
 *
 * An "All Values" or forecast criteria judges a series whose data keeps
 * arriving late - CloudWatch's, a collector's whose clock runs behind - as
 * far as its data reaches, and what the alert or incident then describes is
 * that long ago. Its root cause says so, wherever the reader meets it:
 *
 *   - the details block of the whole monitor's root cause ends with
 *     "- Data Arrives: about 3 minutes late": the Metric Details (Metrics,
 *     Docker, Host, Podman and IoT monitors) and each platform's own block
 *     (Kubernetes Cluster Details, Proxmox, vCenter, Docker Swarm, Ceph and
 *     Storage Array Details), which used to leave it out - so the
 *     Kubernetes cluster whose clock runs behind, the case the line was
 *     built for, never said it;
 *   - a grouped monitor opens each series' alert and incident with that
 *     series' matched lines alone, so they say it themselves: "... above
 *     the 0 threshold. Its data arrives about 3 minutes late."
 *
 * Every time is fixed; the monitors are the shipped templates.
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

const LAG_LINE: string = "- Data Arrives: about 3 minutes late";
const LAG_SENTENCE: string = "Its data arrives about 3 minutes late.";

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

function templateArgs(): {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} {
  return {
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Data lag",
  };
}

function monitorOf(type: MonitorType): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  monitor.projectId = new ObjectID("44444444-4444-4444-8444-444444444444");
  monitor.monitorType = type;
  return monitor;
}

async function check(input: {
  type: MonitorType;
  step: MonitorStep;
  response: MetricMonitorResponse;
}): Promise<ProbeApiIngestResponse> {
  const monitor: Monitor = monitorOf(input.type);
  const summary: MonitorEvaluationSummary = {
    evaluatedAt: NOW,
    criteriaResults: [],
    events: [],
  };

  return await MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: input.response,
    monitorStep: input.step,
    monitor: monitor,
    probeApiIngestResponse: { monitorId: monitor.id!, rootCause: null },
    evaluationSummary: summary,
  });
}

/*
 * The lines of a root cause's block that opens with `heading`, up to the
 * blank line that ends it.
 */
function blockLines(rootCause: string, heading: string): Array<string> {
  const lines: Array<string> = rootCause.split("\n");
  const start: number = lines.indexOf(heading);

  expect(start).toBeGreaterThanOrEqual(0);

  const block: Array<string> = [];
  for (let index: number = start + 1; index < lines.length; index++) {
    if (!lines[index]!.trim()) {
      break;
    }
    block.push(lines[index]!);
  }
  return block;
}

describe("a grouped Kubernetes monitor on a cluster whose collector's clock runs three minutes behind", () => {
  const replicaTemplate: KubernetesAlertTemplate =
    getKubernetesAlertTemplateById("k8s-deployment-replica-mismatch")!;

  const replicaStep: MonitorStep = replicaTemplate.getMonitorStep({
    ...templateArgs(),
    clusterIdentifier: "prod-eu-west-1",
  });

  const replicaView: MetricsViewConfig =
    MonitorStep.getMetricsViewConfig(replicaStep)!;

  function labelsOf(deployment: string): JSONObject {
    return { [NAMESPACE_KEY]: "payments", [DEPLOYMENT_KEY]: deployment };
  }

  /*
   * One deployment, desired 3 and available 2 from 12:00 to 12:`to` by its
   * own clock, as the worker's series breakdown hands it over - with the
   * arrivals it read for desired, available and the formula.
   */
  function deployment(input: {
    name: string;
    to: number;
    arrival?: MetricSeriesArrival | undefined;
  }): MetricSeriesResult {
    const rows: (value: number) => AggregatedResult = (
      value: number,
    ): AggregatedResult => {
      const data: Array<AggregateModel> = [];
      for (let minute: number = 0; minute <= input.to; minute++) {
        data.push({
          timestamp: new Date(Date.UTC(2026, 9, 16, 12, minute, 0)),
          value: value,
          attributes: labelsOf(input.name),
        });
      }
      return { data };
    };

    const queryResults: Array<AggregatedResult> = [rows(3), rows(2)];

    return {
      fingerprint: MetricSeriesFingerprint.computeFingerprint(
        labelsOf(input.name),
      ),
      labels: labelsOf(input.name),
      aggregatedResults: [
        ...queryResults,
        MetricFormulaEvaluator.evaluateFormula({
          formula:
            replicaView.formulaConfigs[0]!.metricFormulaData.metricFormula,
          queryConfigs: replicaView.queryConfigs,
          formulaConfigs: [],
          results: queryResults,
        }),
      ],
      ...(input.arrival
        ? { arrivals: [input.arrival, input.arrival, input.arrival] }
        : {}),
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

  test("each deployment's alert and incident say how late its data arrives, in its own line", async () => {
    // Its data reaches 12:11 by its own clock, 3.5 minutes behind the check.
    const result: ProbeApiIngestResponse = await check({
      type: MonitorType.Kubernetes,
      step: replicaStep,
      response: replicaResponse([
        deployment({ name: "api", to: 11, arrival: CLOCK_BEHIND }),
      ]),
    });

    expect(
      (result.perSeriesMatches || []).map(
        (match: { rootCause?: string | null | undefined }) => {
          return match.rootCause;
        },
      ),
    ).toEqual([
      `- Deployment Replica Shortfall was 1 in all 12 readings, above the 0 threshold. ${LAG_SENTENCE}`,
    ]);
  });

  test("the cluster's details end with how late its data arrives, under the formula and its components", async () => {
    const result: ProbeApiIngestResponse = await check({
      type: MonitorType.Kubernetes,
      step: replicaStep,
      response: replicaResponse([
        deployment({ name: "api", to: 11, arrival: CLOCK_BEHIND }),
      ]),
    });

    const details: Array<string> = blockLines(
      result.rootCause || "",
      "**Kubernetes Cluster Details**",
    );

    expect(details).toEqual([
      "- Cluster: prod-eu-west-1",
      "- Metric: Deployment Replica Shortfall",
      "- Formula: `desired_replicas - available_replicas`",
      "  - `desired_replicas` = Deployment Desired Replicas (`k8s.deployment.desired`)",
      "  - `available_replicas` = Deployment Available Replicas (`k8s.deployment.available`)",
      LAG_LINE,
    ]);

    // Said once: not again in the sentence above the details.
    expect((result.rootCause || "").split("Data Arrives").length - 1).toBe(1);
    expect(result.rootCause).not.toContain(LAG_SENTENCE);
  });

  test("a collector on time says neither", async () => {
    const result: ProbeApiIngestResponse = await check({
      type: MonitorType.Kubernetes,
      step: replicaStep,
      response: replicaResponse([
        deployment({ name: "api", to: 15, arrival: ON_TIME }),
      ]),
    });

    expect(result.perSeriesMatches?.[0]?.rootCause).toBe(
      "- Deployment Replica Shortfall was 1 in all 16 readings, above the 0 threshold.",
    );
    expect(result.rootCause).toContain("**Kubernetes Cluster Details**");
    expect(result.rootCause).not.toContain("Data Arrives");
    expect(result.rootCause).not.toContain("arrives about");
  });

  test("nor does a series whose arrivals were not read", async () => {
    const result: ProbeApiIngestResponse = await check({
      type: MonitorType.Kubernetes,
      step: replicaStep,
      response: replicaResponse([deployment({ name: "api", to: 15 })]),
    });

    expect(result.perSeriesMatches?.[0]?.rootCause).toBe(
      "- Deployment Replica Shortfall was 1 in all 16 readings, above the 0 threshold.",
    );
    expect(result.rootCause).not.toContain("Data Arrives");
  });
});

/*
 * The shipped CloudWatch SQS backlog template on a Metrics monitor: the
 * aws_cloudwatch receiver delivers one-minute periods about eleven minutes
 * after they end, five at a time.
 */
describe("an ungrouped Metrics monitor on CloudWatch", () => {
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
    ...templateArgs(),
    observedSeries: [ordersFixture.attributes],
  })!;

  // Past 30 Minutes at 12:30:30, data to 12:16.
  function backlog(arrival: MetricSeriesArrival): MetricMonitorResponse {
    const data: Array<AggregateModel> = [];
    for (let minute: number = 1; minute <= 16; minute++) {
      data.push({
        timestamp: new Date(Date.UTC(2026, 9, 16, 12, minute, 0)),
        value: 2500,
      });
    }

    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: MonitorStep.getMetricsViewConfig(sqsStep)!,
      metricResult: [{ data }],
      startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
        RollingTime.Past30Minutes,
        new Date(Date.UTC(2026, 9, 16, 12, 30, 30)),
      ),
      metricResultArrivals: [arrival],
    };
  }

  test("its Metric Details end with how late the data arrives, right above the breaching samples", async () => {
    const result: ProbeApiIngestResponse = await check({
      type: MonitorType.Metrics,
      step: sqsStep,
      response: backlog({
        sinceNewestArrivalMs: 2 * MINUTE,
        lagMs: 11 * MINUTE + 40 * SECOND,
        arrivalIntervalMs: 5 * MINUTE,
      }),
    });

    const rootCause: string = result.rootCause || "";
    const details: Array<string> = blockLines(rootCause, "**Metric Details**");

    expect(details[details.length - 1]).toBe(
      "- Data Arrives: about 11 minutes late",
    );
    // After the query's filters, not among the metric's own facts.
    expect(details.indexOf("- Filters:")).toBeGreaterThanOrEqual(0);
    expect(details.indexOf("- Filters:")).toBeLessThan(details.length - 1);

    const lines: Array<string> = rootCause.split("\n");
    const lagIndex: number = lines.indexOf(
      "- Data Arrives: about 11 minutes late",
    );
    const nextHeading: string | undefined = lines
      .slice(lagIndex + 1)
      .find((line: string) => {
        return line.trim().length > 0;
      });

    expect(nextHeading).toBe("**Breaching Samples**");
  });

  test("on time, its Metric Details end with the query's filters, as before", async () => {
    const result: ProbeApiIngestResponse = await check({
      type: MonitorType.Metrics,
      step: sqsStep,
      response: backlog({
        sinceNewestArrivalMs: 10 * SECOND,
        lagMs: 40 * SECOND,
        arrivalIntervalMs: MINUTE,
      }),
    });

    const details: Array<string> = blockLines(
      result.rootCause || "",
      "**Metric Details**",
    );

    expect(details.join("\n")).not.toContain("Data Arrives");
    expect(details[details.length - 1]).toBe(
      "  - `Dimensions.QueueName` = `orders`",
    );
  });
});

type EvaluatorPrivate = {
  buildMetricRootCauseContext: (input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }) => MarkdownText | null;
  buildRootCauseContext: (input: {
    dataToProcess: MetricMonitorResponse;
    monitorStep: MonitorStep;
    monitor: Monitor;
    criteriaInstance?: MonitorCriteriaInstance;
  }) => Promise<MarkdownText | null>;
};

const evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

function contextOf(input: {
  metricName: string;
  dataLagMs?: number | undefined;
}): MetricCriteriaContext {
  return {
    metricName: input.metricName,
    alias: "a",
    unit: null,
    aggregationType: null,
    isFormula: false,
    filterAttributes: {},
    groupBy: [],
    ...(input.dataLagMs !== undefined ? { dataLagMs: input.dataLagMs } : {}),
  };
}

describe("the Metric Details of a formula", () => {
  function detailsOf(dataLagMs?: number): Array<string> {
    const context: MetricCriteriaContext = {
      ...contextOf({
        metricName: "desired_replicas - available_replicas",
        dataLagMs,
      }),
      alias: "replica_shortfall",
      isFormula: true,
      formulaExpression: "desired_replicas - available_replicas",
      groupBy: ["resource.k8s.deployment.name"],
      components: [
        {
          alias: "desired_replicas",
          name: "k8s.deployment.desired",
          unit: null,
          isFormula: false,
        },
        {
          alias: "available_replicas",
          name: "k8s.deployment.available",
          unit: null,
          isFormula: false,
        },
      ],
    };

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

    const markdown: MarkdownText | null = evaluator.buildMetricRootCauseContext(
      {
        criteriaInstance: instance,
        monitor: monitorOf(MonitorType.Metrics),
      },
    );

    return blockLines(markdown!.toString(), "**Metric Details**");
  }

  test("keeps its components right under the formula, and ends with how late its data arrives", () => {
    expect(detailsOf(12 * MINUTE + 5 * SECOND)).toEqual([
      "- Metric: `desired_replicas - available_replicas`",
      "- Alias: `replica_shortfall`",
      "- Formula: `desired_replicas - available_replicas`",
      "- Components:",
      "  - `desired_replicas` = `k8s.deployment.desired`",
      "  - `available_replicas` = `k8s.deployment.available`",
      "- Grouped By: `resource.k8s.deployment.name`",
      "- Data Arrives: about 12 minutes late",
    ]);
  });

  test("on time, it says nothing of it", () => {
    expect(detailsOf().join("\n")).not.toContain("Data Arrives");
    expect(detailsOf(0).join("\n")).not.toContain("Data Arrives");
  });

  test("a day late reads in days", () => {
    expect(detailsOf(2 * 24 * 60 * MINUTE + 3 * MINUTE).pop()).toBe(
      "- Data Arrives: about 2 days late",
    );
  });
});

/*
 * Every platform with a details block of its own - its cluster, vCenter or
 * array, and the metric the criteria compared - ends that block with how
 * late the compared data arrives. Each is the platform's first shipped
 * template with a metric criteria, its firing criteria carrying the context
 * the evaluation left on its filter.
 */
interface PlatformCase {
  type: MonitorType;
  heading: string;
  step: MonitorStep;
}

function firstMetricTemplateStep(
  steps: Array<MonitorStep>,
): MonitorStep | undefined {
  return steps.find((step: MonitorStep) => {
    return (
      step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray?.[0]?.data?.filters?.some(
        (filter: CriteriaFilter) => {
          return filter.checkOn === CheckOn.MetricValue;
        },
      ) === true
    );
  });
}

const PLATFORMS: Array<PlatformCase> = [
  {
    type: MonitorType.Kubernetes,
    heading: "**Kubernetes Cluster Details**",
    step: getKubernetesAlertTemplateById(
      "k8s-deployment-replica-mismatch",
    )!.getMonitorStep({ ...templateArgs(), clusterIdentifier: "prod" }),
  },
  {
    type: MonitorType.Proxmox,
    heading: "**Proxmox Cluster Details**",
    step: firstMetricTemplateStep(
      getAllProxmoxAlertTemplates().map((template: ProxmoxAlertTemplate) => {
        return template.getMonitorStep({
          ...templateArgs(),
          clusterIdentifier: "pve-lab",
        });
      }),
    )!,
  },
  {
    type: MonitorType.VMware,
    heading: "**vCenter Details**",
    step: firstMetricTemplateStep(
      getAllVMwareAlertTemplates().map((template: VMwareAlertTemplate) => {
        return template.getMonitorStep({
          ...templateArgs(),
          vcenterIdentifier: "vcsa-prod",
        });
      }),
    )!,
  },
  {
    type: MonitorType.DockerSwarm,
    heading: "**Docker Swarm Cluster Details**",
    step: firstMetricTemplateStep(
      getAllDockerSwarmAlertTemplates().map(
        (template: DockerSwarmAlertTemplate) => {
          return template.getMonitorStep({
            ...templateArgs(),
            clusterIdentifier: "swarm-prod",
          });
        },
      ),
    )!,
  },
  {
    type: MonitorType.Ceph,
    heading: "**Ceph Cluster Details**",
    step: firstMetricTemplateStep(
      getAllCephAlertTemplates().map((template: CephAlertTemplate) => {
        return template.getMonitorStep({
          ...templateArgs(),
          clusterIdentifier: "ceph-prod",
        });
      }),
    )!,
  },
  {
    type: MonitorType.StorageArray,
    heading: "**Storage Array Details**",
    step: firstMetricTemplateStep(
      getAllStorageArrayAlertTemplates().map(
        (template: StorageArrayAlertTemplate) => {
          return template.getMonitorStep({
            ...templateArgs(),
            arrayIdentifier: "fa-prod-01",
          });
        },
      ),
    )!,
  },
];

async function platformDetails(input: {
  platform: PlatformCase;
  dataLagMs?: number | undefined;
}): Promise<Array<string>> {
  const step: MonitorStep = input.platform.step;
  /*
   * A copy of the firing criteria: the evaluation writes its context onto
   * the filter, and the step's own must stay as the template made it.
   */
  const firing: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  firing.data = JSON.parse(
    JSON.stringify(
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data,
    ),
  );

  const filter: CriteriaFilter = firing.data!.filters.find(
    (candidate: CriteriaFilter) => {
      return candidate.checkOn === CheckOn.MetricValue;
    },
  )!;

  filter.metricCriteriaContext = contextOf({
    metricName:
      (MonitorStep.getMetricsViewConfig(step)?.queryConfigs?.[0]
        ?.metricQueryData?.filterData?.metricName as string | undefined) ||
      "metric",
    dataLagMs: input.dataLagMs,
  });

  const markdown: MarkdownText | null = await evaluator.buildRootCauseContext({
    dataToProcess: {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: MonitorStep.getMetricsViewConfig(step)!,
      metricResult: [],
      startAndEndDate: WINDOW,
    },
    monitorStep: step,
    monitor: monitorOf(input.platform.type),
    criteriaInstance: firing,
  });

  return blockLines(markdown!.toString(), input.platform.heading);
}

describe("every platform's details block", () => {
  test("covers the six platforms with a details block of their own", () => {
    expect(
      PLATFORMS.map((platform: PlatformCase) => {
        return Boolean(platform.step);
      }),
    ).toEqual([true, true, true, true, true, true]);
  });

  for (const platform of PLATFORMS) {
    test(`${platform.type}: ends with how late the compared data arrives`, async () => {
      const details: Array<string> = await platformDetails({
        platform,
        dataLagMs: 3 * MINUTE + 25 * SECOND,
      });

      expect(details[0]!.startsWith("- ")).toBe(true);
      expect(details[details.length - 1]).toBe(LAG_LINE);
      expect(
        details.filter((line: string) => {
          return line.includes("Data Arrives");
        }),
      ).toHaveLength(1);
    });

    test(`${platform.type}: on time, says nothing of it`, async () => {
      const details: Array<string> = await platformDetails({ platform });

      expect(details.length).toBeGreaterThan(0);
      expect(details.join("\n")).not.toContain("Data Arrives");
    });
  }
});
