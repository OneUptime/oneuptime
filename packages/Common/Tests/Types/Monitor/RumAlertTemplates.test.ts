import {
  RumAlertTemplate,
  RumAlertTemplateArgs,
  RumAlertTemplateContext,
  RumAlertTemplateRequirement,
  getAllRumAlertTemplates,
  getRumAlertTemplateById,
  getRumAlertTemplates,
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
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import MonitorStepMetricMonitor from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStepTraceMonitor from "../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorStepExceptionMonitor from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import {
  ServiceAlertTemplate,
  getAllServiceAlertTemplates,
} from "../../../Types/Monitor/ServiceAlertTemplates";
import SessionReplayBudgetMetricType from "../../../Types/Rum/SessionReplayBudgetMetricType";
import SessionReplayBudgetMetricTypeUtil, {
  SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES,
} from "../../../Utils/SessionReplay/SessionReplayBudgetMetricType";

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
  /*
   * "Nearly spent" warns while there is still time to act; "spent" means the
   * recorders have already been told to stop, so nothing more is recorded.
   */
  {
    id: "rum-session-replay-daily-budget-nearly-spent",
    category: "Session Replay",
    severity: "Warning",
  },
  {
    id: "rum-session-replay-daily-budget-spent",
    category: "Session Replay",
    severity: "Critical",
  },
  {
    id: "rum-session-replay-monthly-budget-nearly-spent",
    category: "Session Replay",
    severity: "Warning",
  },
  {
    id: "rum-session-replay-monthly-budget-spent",
    category: "Session Replay",
    severity: "Critical",
  },
];

/*
 * The four session replay storage budget templates, restated from the spec
 * rather than read back from the module, so a change to either has to be made
 * twice. The alias is shared within a pair on purpose (same series, two
 * thresholds); the pairs read different series.
 */
interface BudgetCase {
  id: string;
  name: string;
  metricName: SessionReplayBudgetMetricType;
  metricAlias: string;
  threshold: number;
  breachName: string;
  requirement: RumAlertTemplateRequirement;
  incidentTitle: string;
  isProjectScoped: boolean;
}

const BUDGET_CASES: Array<BudgetCase> = [
  {
    id: "rum-session-replay-daily-budget-nearly-spent",
    name: "Session Replay Daily Budget Nearly Spent",
    metricName: SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
    metricAlias: "rum_replay_daily_budget_used",
    threshold: 80,
    breachName: "Session Replay Daily Budget Nearly Spent - 80% or more used",
    requirement: "SessionReplayRecording",
    incidentTitle:
      "[RUM] Project's daily session replay budget nearly spent - Storefront",
    isProjectScoped: true,
  },
  {
    id: "rum-session-replay-daily-budget-spent",
    name: "Session Replay Daily Budget Spent",
    metricName: SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
    metricAlias: "rum_replay_daily_budget_used",
    threshold: 100,
    breachName: "Session Replay Daily Budget Spent - 100% used",
    requirement: "SessionReplayRecording",
    incidentTitle:
      "[RUM] Session replay paused: project's daily budget spent - Storefront",
    isProjectScoped: true,
  },
  {
    id: "rum-session-replay-monthly-budget-nearly-spent",
    name: "Session Replay Monthly Budget Nearly Spent",
    metricName: SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    metricAlias: "rum_replay_monthly_budget_used",
    threshold: 80,
    breachName: "Session Replay Monthly Budget Nearly Spent - 80% or more used",
    requirement: "SessionReplayMonthlyBudget",
    incidentTitle:
      "[RUM] Monthly session replay budget nearly spent - Storefront",
    isProjectScoped: false,
  },
  {
    id: "rum-session-replay-monthly-budget-spent",
    name: "Session Replay Monthly Budget Spent",
    metricName: SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    metricAlias: "rum_replay_monthly_budget_used",
    threshold: 100,
    breachName: "Session Replay Monthly Budget Spent - 100% used",
    requirement: "SessionReplayMonthlyBudget",
    incidentTitle:
      "[RUM] Session replay paused: monthly budget spent - Storefront",
    isProjectScoped: false,
  },
];

const BUDGET_TEMPLATE_IDS: Array<string> = BUDGET_CASES.map(
  (item: BudgetCase) => {
    return item.id;
  },
);

// The seven templates every RUM application was offered before the budgets.
const CORE_TEMPLATE_IDS: Array<string> = [
  "rum-poor-lcp",
  "rum-poor-inp",
  "rum-poor-cls",
  "rum-slow-fcp",
  "rum-slow-ttfb",
  "rum-failed-user-operations",
  "rum-unhandled-exceptions",
];

const DAILY_TEMPLATE_IDS: Array<string> = [
  "rum-session-replay-daily-budget-nearly-spent",
  "rum-session-replay-daily-budget-spent",
];

const MONTHLY_TEMPLATE_IDS: Array<string> = [
  "rum-session-replay-monthly-budget-nearly-spent",
  "rum-session-replay-monthly-budget-spent",
];

// An application that records replays and has a monthly budget of 10 GiB.
const FULL_CONTEXT: RumAlertTemplateContext = {
  sessionReplayEnabled: true,
  sessionReplayHasRecorded: true,
  sessionReplayMonthlyBudgetInGB: 10,
};

function offeredIds(
  context?: RumAlertTemplateContext | undefined,
): Array<string> {
  return getRumAlertTemplates(context).map((template: RumAlertTemplate) => {
    return template.id;
  });
}

// The first filter of the breach criteria and of the Healthy one.
interface BudgetFilters {
  breach: CriteriaFilter | undefined;
  recovery: CriteriaFilter | undefined;
}

function getFilters(step: MonitorStep): BudgetFilters {
  const [breach, recovery]: Array<MonitorCriteriaInstance> = getCriteria(step);

  return {
    breach: breach?.data?.filters[0],
    recovery: recovery?.data?.filters[0],
  };
}

function getWindowInMinutes(rollingTime: RollingTime): number {
  const window: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(rollingTime);

  return (window.endValue.getTime() - window.startValue.getTime()) / 60000;
}

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

    expect(templates).toHaveLength(11);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      ...WEB_VITAL_CASES.map((item: WebVitalCase) => {
        return item.id;
      }),
      "rum-failed-user-operations",
      "rum-unhandled-exceptions",
      "rum-session-replay-daily-budget-nearly-spent",
      "rum-session-replay-daily-budget-spent",
      "rum-session-replay-monthly-budget-nearly-spent",
      "rum-session-replay-monthly-budget-spent",
    ]);
  });

  test("does not expose its internal template array", () => {
    const first: Array<RumAlertTemplate> = getAllRumAlertTemplates();
    first.pop();

    expect(getAllRumAlertTemplates()).toHaveLength(11);
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

      /*
       * The recovery reduces the window exactly as the breach does. The
       * budget templates made the reduction a parameter; the web vitals
       * must keep evaluating the five-minute Average on both sides.
       */
      expect(healthyFilter?.metricMonitorOptions?.metricAlias).toBe(
        item.metricAlias,
      );
      expect(healthyFilter?.metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.Average,
      );
      expect(healthyFilter?.metricMonitorOptions?.thresholdUnit).toBe(
        item.unit,
      );
      expect(healthy?.data?.description).toBe(
        "The RUM signal for Storefront is within its recommended threshold.",
      );
      expect(template.requirement).toBeUndefined();
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

/*
 * The session replay storage budget templates. Each one is a Metrics monitor
 * over a series the budget sweep posts every five minutes under the RUM
 * application's id, and every shape assertion below is one a mistake in would
 * produce a monitor that looks right on the page and never fires, fires late,
 * or never resolves:
 *
 *   - scope: without `telemetryServiceIds` the query reads every application
 *     in the project, and the recommendation fingerprint loses its resource;
 *   - the reduction: without `metricAlias` no metricMonitorOptions are
 *     written and the window silently falls back to All Values, which only
 *     fires once EVERY point crossed;
 *   - the unit: "%" on the alias, the threshold and the catalog alike, or the
 *     evaluator converts the value it compares.
 */
describe("RumAlertTemplates - session replay storage budget", () => {
  test.each(BUDGET_CASES)(
    "$id watches $metricName for this application alone, at its threshold",
    (item: BudgetCase) => {
      const template: RumAlertTemplate = getTemplate(item.id);
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const metricMonitor: MonitorStepMetricMonitor | undefined =
        step.data?.metricMonitor;

      expect(template.name).toBe(item.name);
      expect(template.monitorType).toBe(MonitorType.Metrics);
      expect(template.category).toBe("Session Replay");
      expect(template.requirement).toBe(item.requirement);

      expect(metricMonitor).toBeDefined();
      expect(metricMonitor?.rollingTime).toBe(RollingTime.Past15Minutes);
      expect(
        metricMonitor?.telemetryServiceIds?.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([RUM_APPLICATION_ID.toString()]);

      expect(metricMonitor?.metricViewConfig.queryConfigs).toHaveLength(1);
      expect(metricMonitor?.metricViewConfig.formulaConfigs).toEqual([]);

      const query: MetricQueryConfigData | undefined =
        metricMonitor?.metricViewConfig.queryConfigs[0];

      expect(query?.metricQueryData.filterData.metricName).toBe(
        item.metricName,
      );
      expect(query?.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Max,
      );
      // Scoped by primaryEntityId alone: no attribute filter, no grouping.
      expect(query?.metricQueryData.filterData.attributes).toEqual({});
      expect(query?.metricQueryData.groupBy).toBeUndefined();
      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);
      expect(query?.metricAliasData?.metricVariable).toBe(item.metricAlias);
      expect(query?.metricAliasData?.legendUnit).toBe("%");
      expect(query?.metricAliasData?.title).toBe(item.name);
      expect(query?.metricAliasData?.legend).toBe(item.name);

      const { breach, recovery }: BudgetFilters = getFilters(step);

      expect(getCriteria(step)).toHaveLength(2);

      expect(breach?.checkOn).toBe(CheckOn.MetricValue);
      expect(breach?.filterType).toBe(FilterType.GreaterThanOrEqualTo);
      expect(breach?.value).toBe(item.threshold);

      expect(recovery?.checkOn).toBe(CheckOn.MetricValue);
      expect(recovery?.filterType).toBe(FilterType.LessThan);
      expect(recovery?.value).toBe(item.threshold);

      for (const filter of [breach, recovery]) {
        expect(filter?.metricMonitorOptions).toEqual({
          metricAggregationType: EvaluateOverTimeType.MaximumValue,
          metricAlias: item.metricAlias,
          thresholdUnit: "%",
        });
      }
    },
  );

  test.each(BUDGET_CASES)(
    "$id names its criteria and titles its incidents and alerts",
    (item: BudgetCase) => {
      const step: MonitorStep = getTemplate(item.id).getMonitorStep(
        buildArgs(),
      );
      const [breach, recovery]: Array<MonitorCriteriaInstance> =
        getCriteria(step);

      expect(breach?.data?.name).toBe(item.breachName);
      expect(breach?.data?.description).toMatch(/^Triggers when /);
      expect(breach?.data?.description).toContain(`${item.threshold}%`);
      expect(breach?.data?.description).toMatch(
        / at any point in the last 15 minutes\.$/,
      );

      expect(recovery?.data?.name).toBe("Healthy");
      expect(recovery?.data?.description).toBe(
        "Session replay budget use for Storefront is below the alert threshold.",
      );

      expect(breach?.data?.incidents[0]?.title).toBe(item.incidentTitle);
      expect(breach?.data?.alerts[0]?.title).toBe(item.incidentTitle);
      expect(breach?.data?.incidents[0]?.description).toBe(
        breach?.data?.alerts[0]?.description,
      );
      expect(breach?.data?.incidents[0]?.autoResolveIncident).toBe(true);
      expect(breach?.data?.alerts[0]?.autoResolveAlert).toBe(true);

      // Both criteria move the monitor's status, so a recovery resolves.
      expect(breach?.data?.changeMonitorStatus).toBe(true);
      expect(recovery?.data?.changeMonitorStatus).toBe(true);
    },
  );

  /*
   * The enum and its util are the contract the sweep writes by. A template
   * that reads the series in another unit gets its values converted before
   * they are compared; one aggregated differently from how the catalog
   * charts it reads a different number from the one on screen.
   */
  test.each(BUDGET_CASES)(
    "$id reads the series in the unit the metric catalog registers and the aggregation it names",
    (item: BudgetCase) => {
      const step: MonitorStep = getTemplate(item.id).getMonitorStep(
        buildArgs(),
      );
      const query: MetricQueryConfigData | undefined =
        step.data?.metricMonitor?.metricViewConfig.queryConfigs[0];
      const { breach }: BudgetFilters = getFilters(step);

      expect(SessionReplayBudgetMetricTypeUtil.getAll()).toContain(
        item.metricName,
      );
      expect(
        SessionReplayBudgetMetricTypeUtil.isReservedMetricName(item.metricName),
      ).toBe(true);
      expect(query?.metricAliasData?.legendUnit).toBe(
        SessionReplayBudgetMetricTypeUtil.getUnit(item.metricName),
      );
      expect(breach?.metricMonitorOptions?.thresholdUnit).toBe(
        SessionReplayBudgetMetricTypeUtil.getUnit(item.metricName),
      );
      expect(query?.metricQueryData.filterData.aggegationType).toBe(
        SessionReplayBudgetMetricTypeUtil.getAggregationType(item.metricName),
      );
      expect(
        SessionReplayBudgetMetricTypeUtil.isProjectScoped(item.metricName),
      ).toBe(item.isProjectScoped);
    },
  );

  /*
   * The budgets are GiB while every byte threshold and chart is decimal, so a
   * bytes template would fire at 93% of a 1 GiB limit and call it spent.
   */
  test("alerts on the percent series, never on bytes", () => {
    for (const id of BUDGET_TEMPLATE_IDS) {
      const metricName: unknown =
        getTemplate(id).getMonitorStep(buildArgs()).data?.metricMonitor
          ?.metricViewConfig.queryConfigs[0]?.metricQueryData.filterData
          .metricName;

      expect(typeof metricName).toBe("string");
      expect(metricName).not.toBe(
        SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
      );
      expect(metricName).not.toBe(
        SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
      );
      expect(String(metricName).endsWith(".percent")).toBe(true);
    }
  });

  /*
   * An empty window meets no criteria and resolves an open alert, so the
   * window has to hold more than one of the sweep's points - one late sweep
   * must not resolve a budget that is still spent.
   */
  test("looks back far enough to hold three of the sweep's points", () => {
    expect(getWindowInMinutes(RollingTime.Past15Minutes)).toBe(15);

    for (const id of BUDGET_TEMPLATE_IDS) {
      const rollingTime: RollingTime | undefined =
        getTemplate(id).getMonitorStep(buildArgs()).data?.metricMonitor
          ?.rollingTime;

      expect(rollingTime).toBeDefined();
      expect(getWindowInMinutes(rollingTime!)).toBeGreaterThanOrEqual(
        3 * SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES,
      );
    }
  });

  test("each pair reads one series under one alias, and the two pairs read different ones", () => {
    const seriesOf: (id: string) => string = (id: string): string => {
      const query: MetricQueryConfigData | undefined =
        getTemplate(id).getMonitorStep(buildArgs()).data?.metricMonitor
          ?.metricViewConfig.queryConfigs[0];

      return `${query?.metricQueryData.filterData.metricName} as ${query?.metricAliasData?.metricVariable}`;
    };

    expect(seriesOf(DAILY_TEMPLATE_IDS[0]!)).toBe(
      seriesOf(DAILY_TEMPLATE_IDS[1]!),
    );
    expect(seriesOf(MONTHLY_TEMPLATE_IDS[0]!)).toBe(
      seriesOf(MONTHLY_TEMPLATE_IDS[1]!),
    );
    expect(seriesOf(DAILY_TEMPLATE_IDS[0]!)).not.toBe(
      seriesOf(MONTHLY_TEMPLATE_IDS[0]!),
    );
  });

  /*
   * The card clamps at three lines, so the sentence that decides whether to
   * click create comes first - and the daily cards have to say the limit is
   * the project's, or every application gets its own copy of the monitor.
   */
  test("cards lead with what they alert on, and the daily ones say one monitor covers the project", () => {
    for (const id of BUDGET_TEMPLATE_IDS) {
      expect(getTemplate(id).description).toMatch(/^Alert when /);
    }

    for (const id of DAILY_TEMPLATE_IDS) {
      const description: string = getTemplate(id).description;

      expect(description).toContain("the project's");
      expect(description).toContain(
        "shared by every application in the project",
      );
      expect(description).toContain("one of these monitors covers them all");
      expect(description).toContain("00:00 UTC");
    }

    for (const id of MONTHLY_TEMPLATE_IDS) {
      const description: string = getTemplate(id).description;

      expect(description).toContain("this application's");
      expect(description).toContain("(UTC)");
      expect(description).not.toContain("shared by every application");
    }
  });

  /*
   * What the incident and the alert say, verbatim. Every lever named is one
   * the ingest path refuses BEFORE it charges a byte (allowed origins,
   * sampling, the upload trigger), and the daily limit is only ever raised by
   * the deployment - so the text never sends anyone to a setting that cannot
   * help.
   */
  test("incident and alert descriptions name the levers that act before bytes are charged", () => {
    const descriptionOf: (id: string, monitorName: string) => string = (
      id: string,
      monitorName: string,
    ): string => {
      const [breach]: Array<MonitorCriteriaInstance> = getCriteria(
        getTemplate(id).getMonitorStep({
          ...buildArgs(),
          monitorName: monitorName,
        }),
      );

      expect(breach?.data?.alerts[0]?.description).toBe(
        breach?.data?.incidents[0]?.description,
      );

      return breach?.data?.incidents[0]?.description || "";
    };

    expect(
      descriptionOf("rum-session-replay-daily-budget-nearly-spent", "Shop"),
    ).toBe(
      "This project has used 80% of today's session replay upload limit, which all of its RUM applications share. At 100% every recorder in the project is told to stop until 00:00 UTC. To make the rest of the day last, open the Replay Policy page of the busiest applications and lower the Sample percentage, upload only On error or frustration, or narrow the Allowed origins so staging traffic stops spending it. Self-hosted: the limit is SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY.",
    );
    expect(descriptionOf("rum-session-replay-daily-budget-spent", "Shop")).toBe(
      "This project has spent today's session replay upload limit, which all of its RUM applications share: every recorder in the project has been told to stop, and nothing more is recorded until 00:00 UTC. This resolves on its own at about 00:10-00:15 UTC, once the last reading over the limit has left the monitor's 15-minute window. To make tomorrow's limit last, lower the Sample percentage, upload only On error or frustration, or narrow the Allowed origins on the busiest applications' Replay Policy page. Self-hosted: the limit is SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY.",
    );
    expect(
      descriptionOf("rum-session-replay-monthly-budget-nearly-spent", "Shop"),
    ).toBe(
      "Shop has used 80% of its monthly session replay budget. At 100% its recorders are told to stop until the 1st of next month (UTC). Raise the Monthly budget on its Replay Policy page, lower the Sample percentage, or upload only On error or frustration.",
    );
    expect(
      descriptionOf("rum-session-replay-monthly-budget-spent", "Shop"),
    ).toBe(
      "Shop has spent its monthly session replay budget: its recorders have been told to stop, and nothing more is recorded until the 1st of next month (UTC) or until the budget is raised on its Replay Policy page. This resolves on its own.",
    );

    // The daily text is about the project, so no application is named in it.
    for (const id of DAILY_TEMPLATE_IDS) {
      expect(descriptionOf(id, "Checkout Web")).not.toContain("Checkout Web");
    }

    for (const id of MONTHLY_TEMPLATE_IDS) {
      expect(descriptionOf(id, "Checkout Web")).toMatch(/^Checkout Web has /);
    }
  });

  test("every title carries the application it was created on", () => {
    for (const id of BUDGET_TEMPLATE_IDS) {
      const [breach]: Array<MonitorCriteriaInstance> = getCriteria(
        getTemplate(id).getMonitorStep({
          ...buildArgs(),
          monitorName: "Checkout Web",
        }),
      );

      expect(breach?.data?.incidents[0]?.title).toMatch(
        /^\[RUM\] .+ - Checkout Web$/,
      );
      expect(breach?.data?.alerts[0]?.title).toBe(
        breach?.data?.incidents[0]?.title,
      );
    }
  });

  /*
   * The Replay Health page's "Set up alerts" link opens the Recommendations
   * tab searching for "budget", and that search matches a card's name,
   * description, category and severity (RecommendationFilterUtil). So every
   * budget template has to carry the word, and no other RUM template may, or
   * the link lands on the wrong cards.
   */
  test("the word the Health page searches for finds exactly the budget templates", () => {
    const matching: Array<string> = getAllRumAlertTemplates()
      .filter((template: RumAlertTemplate) => {
        return [
          template.name,
          template.description,
          template.category,
          template.severity,
        ].some((field: string) => {
          return field.toLowerCase().includes("budget");
        });
      })
      .map((template: RumAlertTemplate) => {
        return template.id;
      });

    expect(matching).toEqual(BUDGET_TEMPLATE_IDS);
  });

  /*
   * A requirement is what keeps a template off applications its series is
   * never posted for. The budget templates must all carry one, and nothing
   * else may: a web vital gated by accident would vanish from every page.
   */
  test("only the session replay templates carry a requirement, and all of them do", () => {
    for (const template of getAllRumAlertTemplates()) {
      expect(`${template.id}: ${Boolean(template.requirement)}`).toBe(
        `${template.id}: ${template.category === "Session Replay"}`,
      );
    }
  });

  test.each(BUDGET_CASES)(
    "$id survives the JSON round trip a saved monitor takes, scope and alias included",
    (item: BudgetCase) => {
      const original: MonitorStep = getTemplate(item.id).getMonitorStep(
        buildArgs(),
      );
      const restored: MonitorStep = MonitorStep.fromJSON(
        JSON.parse(JSON.stringify(original.toJSON())) as JSONObject,
      );
      const metricMonitor: MonitorStepMetricMonitor | undefined =
        restored.data?.metricMonitor;

      expect(
        metricMonitor?.telemetryServiceIds?.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([RUM_APPLICATION_ID.toString()]);
      expect(metricMonitor?.rollingTime).toBe(RollingTime.Past15Minutes);
      expect(
        metricMonitor?.metricViewConfig.queryConfigs[0]?.metricAliasData
          ?.metricVariable,
      ).toBe(item.metricAlias);
      expect(
        metricMonitor?.metricViewConfig.queryConfigs[0]?.metricQueryData
          .filterData.metricName,
      ).toBe(item.metricName);

      const { breach, recovery }: BudgetFilters = getFilters(restored);

      for (const filter of [breach, recovery]) {
        expect(filter?.metricMonitorOptions?.metricAlias).toBe(
          item.metricAlias,
        );
        expect(filter?.metricMonitorOptions?.metricAggregationType).toBe(
          EvaluateOverTimeType.MaximumValue,
        );
        expect(filter?.metricMonitorOptions?.thresholdUnit).toBe("%");
      }
    },
  );
});

/*
 * The gate. The sweep only posts the daily series for an application that has
 * session replay on and has recorded a replay, and the monthly series only
 * while it also has a monthly budget; a monitor over a series nobody posts
 * never fires and never says why. So each pair is offered only once its
 * series can exist - and "not known" never counts as yes.
 */
describe("getRumAlertTemplates", () => {
  test("offers the original seven when nothing is known about the application", () => {
    expect(offeredIds()).toEqual(CORE_TEMPLATE_IDS);
    expect(offeredIds(undefined)).toEqual(CORE_TEMPLATE_IDS);
    expect(offeredIds({})).toEqual(CORE_TEMPLATE_IDS);
    expect(
      offeredIds({
        sessionReplayEnabled: null,
        sessionReplayHasRecorded: null,
        sessionReplayMonthlyBudgetInGB: null,
      }),
    ).toEqual(CORE_TEMPLATE_IDS);
    expect(
      offeredIds({
        sessionReplayEnabled: undefined,
        sessionReplayHasRecorded: undefined,
        sessionReplayMonthlyBudgetInGB: undefined,
      }),
    ).toEqual(CORE_TEMPLATE_IDS);
  });

  test("adds the daily pair once the application has replay on and has recorded", () => {
    expect(
      offeredIds({
        sessionReplayEnabled: true,
        sessionReplayHasRecorded: true,
      }),
    ).toEqual([...CORE_TEMPLATE_IDS, ...DAILY_TEMPLATE_IDS]);
  });

  test("adds the monthly pair once it also has a monthly budget", () => {
    const offered: Array<string> = offeredIds(FULL_CONTEXT);

    expect(offered).toHaveLength(11);
    expect(offered).toEqual([
      ...CORE_TEMPLATE_IDS,
      ...DAILY_TEMPLATE_IDS,
      ...MONTHLY_TEMPLATE_IDS,
    ]);
    expect(offered).toEqual(
      getAllRumAlertTemplates().map((template: RumAlertTemplate) => {
        return template.id;
      }),
    );
  });

  test("counts a fractional budget - 0.5 is half a GiB, not none", () => {
    expect(
      offeredIds({ ...FULL_CONTEXT, sessionReplayMonthlyBudgetInGB: 0.5 }),
    ).toHaveLength(11);
  });

  test.each([0, null, undefined, NaN, -1, Infinity, -Infinity])(
    "withholds only the monthly pair for a budget of %p",
    (budget: number | null | undefined) => {
      expect(
        offeredIds({
          sessionReplayEnabled: true,
          sessionReplayHasRecorded: true,
          sessionReplayMonthlyBudgetInGB: budget,
        }),
      ).toEqual([...CORE_TEMPLATE_IDS, ...DAILY_TEMPLATE_IDS]);
    },
  );

  test.each([false, null, undefined])(
    "withholds both pairs while session replay is %p for the application",
    (enabled: boolean | null | undefined) => {
      expect(
        offeredIds({ ...FULL_CONTEXT, sessionReplayEnabled: enabled }),
      ).toEqual(CORE_TEMPLATE_IDS);
    },
  );

  test.each([false, null, undefined])(
    "withholds both pairs, budget or not, while has-recorded is %p",
    (hasRecorded: boolean | null | undefined) => {
      expect(
        offeredIds({ ...FULL_CONTEXT, sessionReplayHasRecorded: hasRecorded }),
      ).toEqual(CORE_TEMPLATE_IDS);
      expect(
        offeredIds({
          sessionReplayEnabled: true,
          sessionReplayHasRecorded: hasRecorded,
        }),
      ).toEqual(CORE_TEMPLATE_IDS);
    },
  );

  test("a budget alone offers nothing: the application also has to be recording", () => {
    expect(offeredIds({ sessionReplayMonthlyBudgetInGB: 10 })).toEqual(
      CORE_TEMPLATE_IDS,
    );
    expect(
      offeredIds({
        sessionReplayEnabled: false,
        sessionReplayHasRecorded: true,
        sessionReplayMonthlyBudgetInGB: 10,
      }),
    ).toEqual(CORE_TEMPLATE_IDS);
  });

  /*
   * Only an explicit `true` and a real number count. Parsing what the API
   * hands back (a date string for has-recorded, a numeric string for the
   * budget) is the Dashboard registry's job, before it ever gets here.
   */
  test("reads only an explicit true and a real number, never something truthy", () => {
    expect(
      offeredIds({
        sessionReplayEnabled: 1 as unknown as boolean,
        sessionReplayHasRecorded: true,
      }),
    ).toEqual(CORE_TEMPLATE_IDS);
    expect(
      offeredIds({
        sessionReplayEnabled: true,
        sessionReplayHasRecorded:
          "2026-09-01T00:00:00.000Z" as unknown as boolean,
      }),
    ).toEqual(CORE_TEMPLATE_IDS);
    expect(
      offeredIds({
        ...FULL_CONTEXT,
        sessionReplayMonthlyBudgetInGB: "10" as unknown as number,
      }),
    ).toEqual([...CORE_TEMPLATE_IDS, ...DAILY_TEMPLATE_IDS]);
  });

  test("offers every template without a requirement, whatever the context says", () => {
    const contexts: Array<RumAlertTemplateContext | undefined> = [
      undefined,
      {},
      FULL_CONTEXT,
      { sessionReplayEnabled: false, sessionReplayHasRecorded: false },
    ];

    for (const context of contexts) {
      const offered: Array<string> = offeredIds(context);

      for (const id of CORE_TEMPLATE_IDS) {
        expect(offered).toContain(id);
      }
    }
  });

  test("does not expose its internal template array", () => {
    const first: Array<RumAlertTemplate> = getRumAlertTemplates(FULL_CONTEXT);
    first.length = 0;

    expect(getRumAlertTemplates(FULL_CONTEXT)).toHaveLength(11);
    expect(getAllRumAlertTemplates()).toHaveLength(11);
  });
});

/*
 * A dismissal, and the created-monitor diff, resolve a template from its id
 * alone - with no idea what the application is offered today. The by-id
 * lookup therefore searches every template, gated or not.
 */
describe("getRumAlertTemplateById", () => {
  test.each(BUDGET_TEMPLATE_IDS)(
    "resolves %s even where it is not offered",
    (id: string) => {
      expect(offeredIds()).not.toContain(id);

      const template: RumAlertTemplate | undefined =
        getRumAlertTemplateById(id);

      expect(template).toBeDefined();
      expect(template?.id).toBe(id);
      expect(template?.category).toBe("Session Replay");
    },
  );
});
