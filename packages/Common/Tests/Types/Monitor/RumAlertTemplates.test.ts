import {
  RumAlertTemplate,
  RumAlertTemplateArgs,
  getAllRumAlertTemplates,
  getRumAlertTemplateById,
} from "../../../Types/Monitor/RumAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStepTraceMonitor from "../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorStepExceptionMonitor from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import {
  ServiceAlertTemplate,
  getAllServiceAlertTemplates,
} from "../../../Types/Monitor/ServiceAlertTemplates";

const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();

function buildArgs(): RumAlertTemplateArgs {
  return {
    rumApplicationId: RUM_APPLICATION_ID.toString(),
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Storefront",
  };
}

function getTemplate(id: string): RumAlertTemplate {
  const template: RumAlertTemplate | undefined = getRumAlertTemplateById(id);

  if (!template) {
    throw new Error(`Missing RUM template ${id}`);
  }

  return template;
}

function getCriteria(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

interface WebVitalCase {
  id: string;
  metricName: string;
  metricAlias: string;
  threshold: number;
  unit: string;
  severity: string;
}

const WEB_VITAL_CASES: Array<WebVitalCase> = [
  {
    id: "rum-poor-lcp",
    metricName: "web_vital.lcp",
    metricAlias: "rum_lcp",
    threshold: 4000,
    unit: "ms",
    severity: "Critical",
  },
  {
    id: "rum-poor-inp",
    metricName: "web_vital.inp",
    metricAlias: "rum_inp",
    threshold: 500,
    unit: "ms",
    severity: "Critical",
  },
  {
    id: "rum-poor-cls",
    metricName: "web_vital.cls",
    metricAlias: "rum_cls",
    threshold: 0.25,
    unit: "1",
    severity: "Critical",
  },
  {
    id: "rum-slow-fcp",
    metricName: "web_vital.fcp",
    metricAlias: "rum_fcp",
    threshold: 3000,
    unit: "ms",
    severity: "Warning",
  },
  {
    id: "rum-slow-ttfb",
    metricName: "web_vital.ttfb",
    metricAlias: "rum_ttfb",
    threshold: 1800,
    unit: "ms",
    severity: "Warning",
  },
];

/*
 * The category and severity of every template, pinned in one place.
 *
 * Before this table only the five web vitals had their severity asserted, and
 * that gap is exactly how `rum-failed-user-operations` came to page Critical
 * on a bar — "more than zero error-status spans in five minutes" — that the
 * Service catalog had already decided was a Warning for the identical signal.
 * `severity` is not cosmetic: MonitorRecommendationSeverityMapper maps
 * Critical onto the project's most severe incident/alert severity and Warning
 * onto the next one down.
 */
const SEVERITY_CASES: Array<{
  id: string;
  category: string;
  severity: string;
}> = [
  { id: "rum-poor-lcp", category: "Core Web Vitals", severity: "Critical" },
  { id: "rum-poor-inp", category: "Core Web Vitals", severity: "Critical" },
  { id: "rum-poor-cls", category: "Core Web Vitals", severity: "Critical" },
  { id: "rum-slow-fcp", category: "Core Web Vitals", severity: "Warning" },
  { id: "rum-slow-ttfb", category: "Core Web Vitals", severity: "Warning" },
  {
    id: "rum-failed-user-operations",
    category: "Errors",
    severity: "Warning",
  },
  {
    id: "rum-unhandled-exceptions",
    category: "Errors",
    severity: "Critical",
  },
];

/*
 * The community spellings `WEB_VITAL_DEFS` in telemetryMetrics.ts probes for,
 * copied verbatim. The overview card tries all four and keeps whichever has
 * data; a monitor holds exactly one name and matches it exactly, so a template
 * pointed at `web_vital.*` is silent forever on an app emitting one of the
 * others — with no error and nothing on screen to say why.
 */
const WEB_VITAL_ALTERNATE_NAMES: Record<string, Array<string>> = {
  "rum-poor-lcp": [
    "browser.largest_contentful_paint",
    "largest_contentful_paint",
    "web.vitals.lcp",
  ],
  "rum-poor-inp": [
    "browser.interaction_to_next_paint",
    "interaction_to_next_paint",
    "web.vitals.inp",
  ],
  "rum-poor-cls": [
    "browser.cumulative_layout_shift",
    "cumulative_layout_shift",
    "web.vitals.cls",
  ],
  "rum-slow-fcp": [
    "browser.first_contentful_paint",
    "first_contentful_paint",
    "web.vitals.fcp",
  ],
  "rum-slow-ttfb": [
    "browser.time_to_first_byte",
    "time_to_first_byte",
    "web.vitals.ttfb",
  ],
};

describe("RumAlertTemplates", () => {
  test("registers every template exactly once", () => {
    const templates: Array<RumAlertTemplate> = getAllRumAlertTemplates();
    const ids: Array<string> = templates.map((template: RumAlertTemplate) => {
      return template.id;
    });

    expect(templates).toHaveLength(7);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      ...WEB_VITAL_CASES.map((item: WebVitalCase) => {
        return item.id;
      }),
      "rum-failed-user-operations",
      "rum-unhandled-exceptions",
    ]);
  });

  test("does not expose its internal template array", () => {
    const first: Array<RumAlertTemplate> = getAllRumAlertTemplates();
    first.pop();

    expect(getAllRumAlertTemplates()).toHaveLength(7);
  });

  test("returns undefined for an unknown template id", () => {
    expect(getRumAlertTemplateById("rum-does-not-exist")).toBeUndefined();
  });

  test.each(WEB_VITAL_CASES)(
    "$id scopes $metricName to the RUM application and evaluates its poor boundary",
    (item: WebVitalCase) => {
      const template: RumAlertTemplate = getTemplate(item.id);
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const metricMonitor: MonitorStepMetricMonitor | undefined =
        step.data?.metricMonitor;

      expect(template.monitorType).toBe(MonitorType.Metrics);
      expect(template.category).toBe("Core Web Vitals");
      expect(template.severity).toBe(item.severity);
      expect(metricMonitor).toBeDefined();
      expect(metricMonitor?.rollingTime).toBe(RollingTime.Past5Minutes);
      expect(
        metricMonitor?.telemetryServiceIds?.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([RUM_APPLICATION_ID.toString()]);

      const query: MetricQueryConfigData | undefined =
        metricMonitor?.metricViewConfig.queryConfigs[0];

      expect(metricMonitor?.metricViewConfig.queryConfigs).toHaveLength(1);
      expect(metricMonitor?.metricViewConfig.formulaConfigs).toEqual([]);
      expect(query?.metricQueryData.filterData.metricName).toBe(
        item.metricName,
      );
      expect(query?.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Avg,
      );
      expect(query?.metricAliasData?.metricVariable).toBe(item.metricAlias);
      expect(query?.metricAliasData?.legendUnit).toBe(item.unit);

      const [unhealthy, healthy]: Array<MonitorCriteriaInstance> =
        getCriteria(step);
      const unhealthyFilter: CriteriaFilter | undefined =
        unhealthy?.data?.filters[0];
      const healthyFilter: CriteriaFilter | undefined =
        healthy?.data?.filters[0];

      expect(getCriteria(step)).toHaveLength(2);
      expect(unhealthyFilter?.checkOn).toBe(CheckOn.MetricValue);
      expect(unhealthyFilter?.filterType).toBe(FilterType.GreaterThanOrEqualTo);
      expect(unhealthyFilter?.value).toBe(item.threshold);
      expect(unhealthyFilter?.metricMonitorOptions?.metricAlias).toBe(
        item.metricAlias,
      );
      expect(unhealthyFilter?.metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.Average,
      );
      expect(unhealthyFilter?.metricMonitorOptions?.thresholdUnit).toBe(
        item.unit,
      );
      expect(healthyFilter?.filterType).toBe(FilterType.LessThan);
      expect(healthyFilter?.value).toBe(item.threshold);
    },
  );

  test("failed user operations watch only error spans for this application over five minutes", () => {
    const template: RumAlertTemplate = getTemplate(
      "rum-failed-user-operations",
    );
    const step: MonitorStep = template.getMonitorStep(buildArgs());
    const traceMonitor: MonitorStepTraceMonitor | undefined =
      step.data?.traceMonitor;

    expect(template.monitorType).toBe(MonitorType.Traces);
    expect(template.category).toBe("Errors");
    expect(traceMonitor?.spanStatuses).toEqual([SpanStatus.Error]);
    expect(traceMonitor?.lastXSecondsOfSpans).toBe(300);
    expect(traceMonitor?.attributes).toEqual({});
    expect(traceMonitor?.spanName).toBe("");
    expect(
      traceMonitor?.telemetryServiceIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([RUM_APPLICATION_ID.toString()]);

    const [unhealthy, healthy]: Array<MonitorCriteriaInstance> =
      getCriteria(step);

    expect(unhealthy?.data?.filters[0]?.checkOn).toBe(CheckOn.SpanCount);
    expect(unhealthy?.data?.filters[0]?.filterType).toBe(
      FilterType.GreaterThan,
    );
    expect(unhealthy?.data?.filters[0]?.value).toBe(0);
    expect(healthy?.data?.filters[0]?.filterType).toBe(
      FilterType.LessThanOrEqualTo,
    );
  });

  test("unhandled exceptions exclude resolved and archived groups and stay application-scoped", () => {
    const template: RumAlertTemplate = getTemplate("rum-unhandled-exceptions");
    const step: MonitorStep = template.getMonitorStep(buildArgs());
    const exceptionMonitor: MonitorStepExceptionMonitor | undefined =
      step.data?.exceptionMonitor;

    expect(template.monitorType).toBe(MonitorType.Exceptions);
    expect(template.category).toBe("Errors");
    expect(exceptionMonitor?.lastXSecondsOfExceptions).toBe(300);
    expect(exceptionMonitor?.includeResolved).toBe(false);
    expect(exceptionMonitor?.includeArchived).toBe(false);
    expect(exceptionMonitor?.exceptionTypes).toEqual([]);
    expect(exceptionMonitor?.message).toBe("");
    expect(
      exceptionMonitor?.telemetryServiceIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([RUM_APPLICATION_ID.toString()]);

    const [unhealthy, healthy]: Array<MonitorCriteriaInstance> =
      getCriteria(step);

    expect(unhealthy?.data?.filters[0]?.checkOn).toBe(CheckOn.ExceptionCount);
    expect(unhealthy?.data?.filters[0]?.filterType).toBe(
      FilterType.GreaterThan,
    );
    expect(healthy?.data?.filters[0]?.filterType).toBe(
      FilterType.LessThanOrEqualTo,
    );
  });

  test("every template has one breach criteria and one inert recovery criteria", () => {
    for (const template of getAllRumAlertTemplates()) {
      const [breach, recovery]: Array<MonitorCriteriaInstance> = getCriteria(
        template.getMonitorStep(buildArgs()),
      );

      expect(breach?.data?.createIncidents).toBe(true);
      expect(breach?.data?.createAlerts).toBe(true);
      expect(breach?.data?.incidents).toHaveLength(1);
      expect(breach?.data?.alerts).toHaveLength(1);
      expect(breach?.data?.incidents[0]?.title).toContain("[RUM]");
      expect(breach?.data?.alerts[0]?.title).toContain("[RUM]");

      expect(recovery?.data?.createIncidents).toBe(false);
      expect(recovery?.data?.createAlerts).toBe(false);
      expect(recovery?.data?.incidents).toEqual([]);
      expect(recovery?.data?.alerts).toEqual([]);
    }
  });

  test.each(SEVERITY_CASES)(
    "$id is a $severity in $category",
    (item: { id: string; category: string; severity: string }) => {
      const template: RumAlertTemplate = getTemplate(item.id);

      expect(template.category).toBe(item.category);
      expect(template.severity).toBe(item.severity);
    },
  );

  test("covers every shipped template in the severity table", () => {
    expect(
      SEVERITY_CASES.map((item: { id: string }) => {
        return item.id;
      }).sort(),
    ).toEqual(
      getAllRumAlertTemplates()
        .map((template: RumAlertTemplate) => {
          return template.id;
        })
        .sort(),
    );
  });

  /*
   * The two catalogs ship the same signal — a trace monitor counting
   * error-status spans with a threshold of zero — against different resource
   * types. They differ only in window (five minutes here, ten there). If one
   * pages and the other does not, a team gets woken by their frontend for
   * something their backend deliberately downgrades, and browser spans are the
   * noisier of the two.
   */
  test("does not page harder than the Service catalog does on the identical signal", () => {
    const serviceEquivalent: ServiceAlertTemplate | undefined =
      getAllServiceAlertTemplates().find((template: ServiceAlertTemplate) => {
        return template.id === "service-failed-operations";
      });

    expect(serviceEquivalent).toBeDefined();
    expect(getTemplate("rum-failed-user-operations").severity).toBe(
      serviceEquivalent!.severity,
    );
    expect(serviceEquivalent!.severity).toBe("Warning");
  });

  /*
   * A silent monitor is indistinguishable from a healthy application, so a
   * template that can only read one of four live spellings has to say which
   * one it reads and what the others are. Retargeting is then one visible
   * edit rather than a mystery.
   */
  test.each(WEB_VITAL_CASES)(
    "$id names the metric it reads and every spelling it does not",
    (item: WebVitalCase) => {
      const template: RumAlertTemplate = getTemplate(item.id);

      expect(template.description).toContain(item.metricName);

      for (const alternate of WEB_VITAL_ALTERNATE_NAMES[item.id]!) {
        expect(template.description).toContain(alternate);
      }
    },
  );

  test("metric monitor serialization preserves the RUM application scope", () => {
    const original: MonitorStep =
      getTemplate("rum-poor-lcp").getMonitorStep(buildArgs());
    const restored: MonitorStep = MonitorStep.fromJSON(original.toJSON());

    expect(restored.data?.metricMonitor?.telemetryServiceIds).toHaveLength(1);
    expect(
      restored.data?.metricMonitor?.telemetryServiceIds?.[0]?.toString(),
    ).toBe(RUM_APPLICATION_ID.toString());
  });
});
