import "../../Server/TestingUtils/Init";
import { describe, expect, test } from "@jest/globals";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import MetricMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import TraceMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/TraceMonitorCriteria";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Query from "../../../Types/BaseDatabase/Query";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import {
  CLOUD_APP_PLATFORM_FILTER,
  CLOUD_APP_REQUEST_DURATION_METRIC,
  CloudAppAlertTemplate,
  CloudAppAlertTemplateArgs,
  getAllCloudAppAlertTemplates,
  getCloudAppAlertTemplate,
  getCloudAppAlertTemplatesFor,
  isCloudAppTelemetryScoped,
  readCloudAppTelemetryFilters,
} from "../../../Types/Monitor/CloudAppAlertTemplates";
import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";

/*
 * THE MONITORS ONEUPTIME RECOMMENDS FOR AN APP PLATFORMS APP
 * (Types/Monitor/CloudAppAlertTemplates): its requests failing, slowing or
 * stopping, read from its own spans and its HTTP duration histogram, scoped
 * as its Traces tab scopes them - its environment's cloud.* attributes and
 * its own - never by a service, which two apps of one platform can share.
 */

const APP_ID: string = "0a000000-0000-4000-8000-000000000001";

// checkout, an ECS service of cluster production.
const CHECKOUT_FILTERS: Dictionary<string> = {
  "resource.cloud.platform": "aws_ecs",
  "resource.cloud.account.id": "123456789012",
  "resource.cloud.region": "us-east-1",
  "resource.aws.ecs.task.family": "checkout",
  "resource.aws.ecs.cluster.arn":
    "arn:aws:ecs:us-east-1:123456789012:cluster/production",
};

// The same family in another cluster: another app.
const CHECKOUT_STAGING_FILTERS: Dictionary<string> = {
  ...CHECKOUT_FILTERS,
  "resource.aws.ecs.cluster.arn":
    "arn:aws:ecs:us-east-1:123456789012:cluster/staging",
};

function argsFor(filters: Dictionary<string>): CloudAppAlertTemplateArgs {
  return {
    cloudAppId: APP_ID,
    telemetryFilters: filters,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "checkout",
  };
}

function template(id: string): CloudAppAlertTemplate {
  return getCloudAppAlertTemplate(id)!;
}

function instancesOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

const ALL: Array<CloudAppAlertTemplate> = getAllCloudAppAlertTemplates();

describe("the app alert template library", () => {
  test("its requests failing, slowing or stopping: five templates", () => {
    expect(
      ALL.map((candidate: CloudAppAlertTemplate) => {
        return [candidate.id, candidate.category, candidate.severity];
      }),
    ).toEqual([
      ["cloud-app-failed-operations", "Errors", "Warning"],
      ["cloud-app-error-burst", "Errors", "Critical"],
      ["cloud-app-traffic-stopped", "Throughput", "Warning"],
      ["cloud-app-latency-p95", "Latency", "Warning"],
      ["cloud-app-latency-p99", "Latency", "Critical"],
    ]);

    for (const candidate of ALL) {
      expect(getCloudAppAlertTemplate(candidate.id)).toBe(candidate);
      expect(candidate.summary.length).toBeGreaterThan(0);
      expect(candidate.summary.length).toBeLessThanOrEqual(90);
      expect(candidate.description.length).toBeGreaterThan(40);
    }

    expect(getCloudAppAlertTemplate("cloud-app-nothing")).toBeUndefined();
  });

  test("a count of spans is a Traces monitor; a latency percentile a Metrics one", () => {
    expect(
      ALL.map((candidate: CloudAppAlertTemplate) => {
        return candidate.monitorType;
      }),
    ).toEqual([
      MonitorType.Traces,
      MonitorType.Traces,
      MonitorType.Traces,
      MonitorType.Metrics,
      MonitorType.Metrics,
    ]);
  });
});

describe("which apps are offered them", () => {
  test("an app whose telemetry is told apart from its environment's: all five", () => {
    expect(
      getCloudAppAlertTemplatesFor({ telemetryFilters: CHECKOUT_FILTERS }),
    ).toHaveLength(5);
  });

  test("none before its environment's platform is known, or without its own attributes", () => {
    const withoutPlatform: Dictionary<string> = { ...CHECKOUT_FILTERS };
    delete withoutPlatform[CLOUD_APP_PLATFORM_FILTER];
    const environmentOnly: Dictionary<string> = {
      "resource.cloud.platform": "aws_ecs",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
    };

    for (const filters of [
      withoutPlatform,
      environmentOnly,
      {},
      null,
      undefined,
    ]) {
      expect(isCloudAppTelemetryScoped(filters as Dictionary<string>)).toBe(
        false,
      );
      expect(
        getCloudAppAlertTemplatesFor({
          telemetryFilters: filters as Dictionary<string> | null,
        }),
      ).toEqual([]);
    }
  });

  test("a filter keeps text values only", () => {
    expect(
      readCloudAppTelemetryFilters({
        "resource.cloud.platform": "gcp_cloud_run",
        "resource.faas.name": "checkout",
        blank: " ",
        count: 2,
        nested: { a: "b" },
      }),
    ).toEqual({
      "resource.cloud.platform": "gcp_cloud_run",
      "resource.faas.name": "checkout",
    });
    expect(readCloudAppTelemetryFilters(["x"])).toEqual({});
  });
});

describe("the monitor a template builds", () => {
  test("a span count reads the app's own spans, by its filter, not a service", () => {
    for (const id of [
      "cloud-app-failed-operations",
      "cloud-app-error-burst",
      "cloud-app-traffic-stopped",
    ]) {
      const step: MonitorStep = template(id).getMonitorStep(
        argsFor(CHECKOUT_FILTERS),
      );
      const trace: MonitorStepTraceMonitor = step.data!.traceMonitor!;

      expect(trace.attributes).toEqual(CHECKOUT_FILTERS);
      expect(trace.telemetryServiceIds).toEqual([]);
      expect(trace.spanName).toBe("");

      // The span read the worker makes: the app's attributes, no service.
      const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery(trace);

      expect(query.attributes).toEqual(CHECKOUT_FILTERS);
      expect(query.primaryEntityId).toBeUndefined();
    }
  });

  test("a filter is copied into the step, never shared with the caller", () => {
    const filters: Dictionary<string> = { ...CHECKOUT_FILTERS };
    const step: MonitorStep = template(
      "cloud-app-failed-operations",
    ).getMonitorStep(argsFor(filters));

    filters["resource.aws.ecs.task.family"] = "billing";

    expect(
      step.data!.traceMonitor!.attributes["resource.aws.ecs.task.family"],
    ).toBe("checkout");
  });

  test("failures count error spans; traffic counts every span; each over its window", () => {
    const failed: MonitorStepTraceMonitor = template(
      "cloud-app-failed-operations",
    ).getMonitorStep(argsFor(CHECKOUT_FILTERS)).data!.traceMonitor!;
    const burst: MonitorStepTraceMonitor = template(
      "cloud-app-error-burst",
    ).getMonitorStep(argsFor(CHECKOUT_FILTERS)).data!.traceMonitor!;
    const traffic: MonitorStepTraceMonitor = template(
      "cloud-app-traffic-stopped",
    ).getMonitorStep(argsFor(CHECKOUT_FILTERS)).data!.traceMonitor!;

    expect(failed.spanStatuses).toEqual([SpanStatus.Error]);
    expect(failed.lastXSecondsOfSpans).toBe(600);
    expect(burst.spanStatuses).toEqual([SpanStatus.Error]);
    expect(burst.lastXSecondsOfSpans).toBe(300);
    expect(traffic.spanStatuses).toEqual([]);
    expect(traffic.lastXSecondsOfSpans).toBe(900);
  });

  test("a latency percentile reads http.server.request.duration, in milliseconds, for the app over five minutes", () => {
    for (const [id, aggregation] of [
      ["cloud-app-latency-p95", AggregationType.P95],
      ["cloud-app-latency-p99", AggregationType.P99],
    ] as Array<[string, AggregationType]>) {
      const step: MonitorStep = template(id).getMonitorStep(
        argsFor(CHECKOUT_FILTERS),
      );
      const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
      const query: MetricsViewConfig["queryConfigs"][number] =
        view.queryConfigs[0]!;

      expect(step.data!.metricMonitor!.rollingTime).toBe(
        RollingTime.Past5Minutes,
      );
      expect(step.data!.metricMonitor!.telemetryServiceIds).toBeUndefined();
      expect(query.metricQueryData.filterData.metricName).toBe(
        CLOUD_APP_REQUEST_DURATION_METRIC,
      );
      expect(query.metricQueryData.filterData.attributes).toEqual(
        CHECKOUT_FILTERS,
      );
      expect(query.metricQueryData.filterData.aggegationType).toBe(aggregation);
      expect(query.metricAliasData?.legendUnit).toBe("ms");
      // Read over every instance: an app's percentile, not one replica's.
      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);
    }
  });

  test("incidents and alerts name the app once", () => {
    for (const candidate of ALL) {
      const [unhealthy] = instancesOf(
        candidate.getMonitorStep(argsFor(CHECKOUT_FILTERS)),
      );

      expect(unhealthy!.data!.incidents[0]!.title).toBe(
        `[App] ${candidate.name} - checkout`,
      );
      expect(unhealthy!.data!.alerts[0]!.title).toBe(
        `[App] ${candidate.name} - checkout`,
      );
      expect(unhealthy!.data!.createIncidents).toBe(true);
      expect(unhealthy!.data!.createAlerts).toBe(true);
    }
  });

  test("every unhealthy criteria has its healthy mirror", () => {
    for (const candidate of ALL) {
      const [unhealthy, healthy] = instancesOf(
        candidate.getMonitorStep(argsFor(CHECKOUT_FILTERS)),
      );

      expect(unhealthy!.data!.createIncidents).toBe(true);
      expect(healthy!.data!.createIncidents).toBe(false);
      expect(healthy!.data!.createAlerts).toBe(false);
      expect(healthy!.data!.filterCondition).toBe(FilterCondition.Any);
    }
  });
});

// The trace evaluator's answer for a count, through each template's filters.
async function spanCountMeets(
  instance: MonitorCriteriaInstance,
  spanCount: number,
): Promise<boolean> {
  const filter: CriteriaFilter = instance.data!.filters[0]!;

  expect(filter.checkOn).toBe(CheckOn.SpanCount);

  return (
    (await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: {
        projectId: ObjectID.generate(),
        monitorId: ObjectID.generate(),
        spanCount: spanCount,
        spanQuery: {},
      } as TraceMonitorResponse,
      criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
    })) !== null
  );
}

describe("what each span count decides", () => {
  test.each([
    ["cloud-app-failed-operations", 0, false],
    ["cloud-app-failed-operations", 1, true],
    ["cloud-app-error-burst", 25, false],
    ["cloud-app-error-burst", 26, true],
    ["cloud-app-traffic-stopped", 0, true],
    ["cloud-app-traffic-stopped", 1, false],
  ] as Array<[string, number, boolean]>)(
    "%s at %i spans fires: %s, and is healthy otherwise",
    async (id: string, count: number, fires: boolean) => {
      const [unhealthy, healthy] = instancesOf(
        template(id).getMonitorStep(argsFor(CHECKOUT_FILTERS)),
      );

      expect(await spanCountMeets(unhealthy!, count)).toBe(fires);
      expect(await spanCountMeets(healthy!, count)).toBe(!fires);
    },
  );
});

describe("what a latency percentile decides", () => {
  const NOW: Date = new Date(Date.UTC(2026, 10, 2, 12, 30, 30));

  async function latencyMeets(data: {
    id: string;
    instanceIndex: number;
    valuesMs: Array<number>;
  }): Promise<boolean> {
    const step: MonitorStep = template(data.id).getMonitorStep(
      argsFor(CHECKOUT_FILTERS),
    );
    const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
    const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past5Minutes,
      NOW,
    );
    const start: number = (window.startValue as Date).getTime();
    const response: MetricMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      metricViewConfig: view,
      metricResult: [
        {
          data: data.valuesMs.map((value: number, index: number) => {
            return { timestamp: new Date(start + index * 60_000), value };
          }),
        },
      ],
      startAndEndDate: window,
    };
    const instance: MonitorCriteriaInstance =
      instancesOf(step)[data.instanceIndex]!;
    const filter: CriteriaFilter = instance.data!.filters[0]!;

    return (
      (await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: response,
        criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
        monitorStep: step,
      })) !== null
    );
  }

  test("a p95 of a second or more for five minutes fires", async () => {
    expect(
      await latencyMeets({
        id: "cloud-app-latency-p95",
        instanceIndex: 0,
        valuesMs: [1100, 1200, 1300, 1150, 1250],
      }),
    ).toBe(true);
  });

  test("one slow minute is no breach: the level must hold", async () => {
    expect(
      await latencyMeets({
        id: "cloud-app-latency-p95",
        instanceIndex: 0,
        valuesMs: [200, 300, 1500, 250, 220],
      }),
    ).toBe(false);
  });

  test("a fast app is healthy", async () => {
    expect(
      await latencyMeets({
        id: "cloud-app-latency-p95",
        instanceIndex: 1,
        valuesMs: [200, 300, 250, 250, 220],
      }),
    ).toBe(true);
  });

  test("the p99's line is 2.5 seconds", async () => {
    expect(
      await latencyMeets({
        id: "cloud-app-latency-p99",
        instanceIndex: 0,
        valuesMs: [2400, 2400, 2450, 2400, 2400],
      }),
    ).toBe(false);
    expect(
      await latencyMeets({
        id: "cloud-app-latency-p99",
        instanceIndex: 0,
        valuesMs: [2600, 2700, 2650, 2800, 2600],
      }),
    ).toBe(true);
  });
});

describe("in the recommendation catalog", () => {
  const ARGS: MonitorRecommendationArgs = {
    resourceIdentifier: APP_ID,
    onlineMonitorStatusId: ObjectID.getZeroObjectID(),
    offlineMonitorStatusId: ObjectID.getZeroObjectID(),
    defaultIncidentSeverityId: ObjectID.getZeroObjectID(),
    defaultAlertSeverityId: ObjectID.getZeroObjectID(),
    monitorName: "checkout",
  };

  function recommendationsFor(
    filters: Dictionary<string> | undefined,
  ): Array<MonitorRecommendation> {
    return MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.CloudApp,
      filters ? { cloudAppTelemetryFilters: filters } : {},
    );
  }

  test("an app is offered its five, as CloudApp recommendations; nothing without a filter", () => {
    expect(
      recommendationsFor(CHECKOUT_FILTERS).map(
        (recommendation: MonitorRecommendation) => {
          return recommendation.recommendationId;
        },
      ),
    ).toEqual(
      ALL.map((candidate: CloudAppAlertTemplate) => {
        return `CloudApp:${candidate.id}`;
      }),
    );
    expect(recommendationsFor(undefined)).toEqual([]);
  });

  test("a monitor made for an app covers its recommendation, and never another app's", () => {
    const checkout: Array<MonitorRecommendation> =
      recommendationsFor(CHECKOUT_FILTERS);
    const staging: Array<MonitorRecommendation> = recommendationsFor(
      CHECKOUT_STAGING_FILTERS,
    );

    const made: MonitorStep = checkout[0]!.getMonitorStep({
      ...ARGS,
      // The project's own ids: the fingerprint holds none of them.
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
    });
    const existing: Array<{
      monitorId: ObjectID;
      monitorSteps: Array<MonitorStep>;
    }> = [{ monitorId: ObjectID.generate(), monitorSteps: [made] }];

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: checkout,
        existingMonitorSteps: [made],
        args: ARGS,
      }),
    ).toEqual(new Set<string>([checkout[0]!.recommendationId]));

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: staging,
        existingMonitors: existing,
        args: ARGS,
      }).size,
    ).toBe(0);
  });

  test("each step is valid as the API takes it, and keeps its filter through JSON", () => {
    for (const recommendation of recommendationsFor(CHECKOUT_FILTERS)) {
      const step: MonitorStep = recommendation.getMonitorStep(ARGS);
      const stored: MonitorStep = MonitorStep.fromJSON(step.toJSON());

      expect(
        MonitorStep.getValidationError(step, recommendation.monitorType),
      ).toBeNull();
      expect(
        MonitorStep.getValidationError(stored, recommendation.monitorType),
      ).toBeNull();

      if (recommendation.monitorType === MonitorType.Traces) {
        expect(stored.data!.traceMonitor!.attributes).toEqual(CHECKOUT_FILTERS);
      } else {
        expect(
          MonitorStep.getMetricsViewConfig(stored)!.queryConfigs[0]!
            .metricQueryData.filterData.attributes,
        ).toEqual(CHECKOUT_FILTERS);
      }
    }
  });
});
