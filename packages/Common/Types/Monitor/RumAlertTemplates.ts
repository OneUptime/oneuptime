import { SpanStatus } from "../../Models/AnalyticsModels/Span";
import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import SessionReplayBudgetMetricType from "../Rum/SessionReplayBudgetMetricType";

export type RumAlertTemplateCategory =
  | "Core Web Vitals"
  | "Errors"
  | "Session Replay";

export type RumAlertTemplateSeverity = "Critical" | "Warning";

/*
 * What has to be true of ONE application before a template is offered to it,
 * for the templates whose metric only exists for some applications. See
 * getRumAlertTemplates:
 *
 *   SessionReplayRecording      session replay is on for the application and
 *                               it has recorded at least one replay
 *   SessionReplayMonthlyBudget  the above, and it has a monthly budget
 */
export type RumAlertTemplateRequirement =
  | "SessionReplayRecording"
  | "SessionReplayMonthlyBudget";

/*
 * What is known about one RUM application, for the templates that carry a
 * `requirement`. Every field is optional, and `null` and `undefined` both
 * mean "not known" - which withholds rather than offers, because a monitor
 * over a series nobody posts never fires and never says why.
 */
export interface RumAlertTemplateContext {
  // The application's own switch, `isSessionReplayEnabled`.
  sessionReplayEnabled?: boolean | null | undefined;
  /*
   * Whether a replay chunk was ever accepted for the application (its
   * `sessionReplayLastChunkReceivedAt` is set). The switch alone says
   * nothing: it defaults to on, so it is on for every RUM application,
   * including the ones that have never loaded the recorder.
   */
  sessionReplayHasRecorded?: boolean | null | undefined;
  // `sessionReplayMonthlyBudgetInGB`. Only a finite number above 0 is a budget.
  sessionReplayMonthlyBudgetInGB?: number | null | undefined;
}

export interface RumAlertTemplateArgs {
  rumApplicationId: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface RumAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: RumAlertTemplateCategory;
  severity: RumAlertTemplateSeverity;
  monitorType: MonitorType;
  /*
   * Absent on the templates whose signal exists for every RUM application,
   * which are offered to all of them.
   */
  requirement?: RumAlertTemplateRequirement | undefined;
  getMonitorStep: (args: RumAlertTemplateArgs) => MonitorStep;
}

interface CriteriaArgs {
  args: RumAlertTemplateArgs;
  checkOn: CheckOn;
  unhealthyFilterType: FilterType;
  healthyFilterType: FilterType;
  threshold: number;
  unhealthyName: string;
  unhealthyDescription: string;
  incidentTitle: string;
  incidentDescription: string;
  metricAlias?: string | undefined;
  thresholdUnit?: string | undefined;
  /*
   * How a metric criteria reduces its window to the value it compares.
   * Average unless set, which is what the web vitals have always been
   * evaluated with. Applied to BOTH criteria: a recovery that reduced the
   * window differently from its breach could find a window that meets both,
   * or neither. Only takes effect together with `metricAlias` - without one,
   * no `metricMonitorOptions` are written at all.
   */
  metricAggregationType?: EvaluateOverTimeType | undefined;
  // The Healthy criteria's description, when the generic sentence does not fit.
  healthyDescription?: string | undefined;
}

function buildCriteria(data: CriteriaArgs): MonitorCriteria {
  const metricAggregationType: EvaluateOverTimeType =
    data.metricAggregationType || EvaluateOverTimeType.Average;

  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: data.checkOn,
        filterType: data.unhealthyFilterType,
        value: data.threshold,
        metricMonitorOptions: data.metricAlias
          ? {
              metricAggregationType: metricAggregationType,
              metricAlias: data.metricAlias,
              thresholdUnit: data.thresholdUnit,
            }
          : undefined,
      },
    ],
    incidents: [
      {
        title: data.incidentTitle,
        description: data.incidentDescription,
        incidentSeverityId: data.args.defaultIncidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: data.incidentTitle,
        description: data.incidentDescription,
        alertSeverityId: data.args.defaultAlertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    name: data.unhealthyName,
    description: data.unhealthyDescription,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: data.checkOn,
        filterType: data.healthyFilterType,
        value: data.threshold,
        metricMonitorOptions: data.metricAlias
          ? {
              metricAggregationType: metricAggregationType,
              metricAlias: data.metricAlias,
              thresholdUnit: data.thresholdUnit,
            }
          : undefined,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description:
      data.healthyDescription ||
      `The RUM signal for ${data.args.monitorName} is within its recommended threshold.`,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

interface WebVitalTemplateData {
  id: string;
  name: string;
  description: string;
  metricName: string;
  metricAlias: string;
  threshold: number;
  thresholdLabel: string;
  thresholdUnit: "ms" | "1";
  severity: RumAlertTemplateSeverity;
}

function buildWebVitalTemplate(data: WebVitalTemplateData): RumAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    category: "Core Web Vitals",
    severity: data.severity,
    monitorType: MonitorType.Metrics,
    getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Metrics,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      step.setMetricMonitor({
        telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
        rollingTime: RollingTime.Past5Minutes,
        metricViewConfig: {
          queryConfigs: [
            {
              metricAliasData: {
                metricVariable: data.metricAlias,
                title: data.name,
                description: data.description,
                legend: data.name,
                legendUnit: data.thresholdUnit,
              },
              metricQueryData: {
                filterData: {
                  metricName: data.metricName,
                  attributes: {},
                  aggegationType: MetricsAggregationType.Avg,
                  aggregateBy: {},
                },
              },
            },
          ],
          formulaConfigs: [],
        },
      });

      step.setMonitorCriteria(
        buildCriteria({
          args: args,
          checkOn: CheckOn.MetricValue,
          unhealthyFilterType: FilterType.GreaterThanOrEqualTo,
          healthyFilterType: FilterType.LessThan,
          threshold: data.threshold,
          metricAlias: data.metricAlias,
          thresholdUnit: data.thresholdUnit,
          unhealthyName: `${data.name} - ${data.thresholdLabel} or worse`,
          unhealthyDescription: `Triggers when the five-minute average ${data.name.toLowerCase()} reaches ${data.thresholdLabel}.`,
          incidentTitle: `[RUM] ${data.name} is poor - ${args.monitorName}`,
          incidentDescription: `${data.name} for real users reached ${data.thresholdLabel}, the poor-performance boundary. Investigate affected pages, devices, regions, and recent frontend changes.`,
        }),
      );

      return step;
    },
  };
}

/*
 * A monitor holds exactly ONE metric name. There is no server-side equivalent
 * of the RUM overview card's candidate probing — WEB_VITAL_DEFS in
 * telemetryMetrics.ts tries four spellings per vital and keeps whichever has
 * data, but MonitorTelemetryMonitor queries `name` as an exact match
 * (MonitorTelemetryMonitor.ts:1183) — and a query that matches nothing returns
 * rootCause: null under the default NoDataPolicy.Ignore. No error, no warning,
 * nothing.
 *
 * So a team whose SDK emits `browser.largest_contentful_paint` sees a
 * populated Core Web Vitals card, clicks create on this recommendation, and
 * gets a monitor that will never fire and never say why. Every template below
 * therefore targets the `web_vital.*` name the docs tell new instrumentation
 * to emit AND names its alternates in the description, so retargeting is one
 * visible edit rather than a mystery.
 */
const webVitalTemplates: Array<RumAlertTemplate> = [
  buildWebVitalTemplate({
    id: "rum-poor-lcp",
    name: "Poor Largest Contentful Paint",
    description:
      "Alert when average Largest Contentful Paint reaches the poor-performance boundary of 4 seconds. Reads web_vital.lcp; an SDK emitting browser.largest_contentful_paint, largest_contentful_paint or web.vitals.lcp must retarget the created monitor.",
    metricName: "web_vital.lcp",
    metricAlias: "rum_lcp",
    threshold: 4000,
    thresholdLabel: "4,000 ms",
    thresholdUnit: "ms",
    severity: "Critical",
  }),
  buildWebVitalTemplate({
    id: "rum-poor-inp",
    name: "Poor Interaction to Next Paint",
    description:
      "Alert when average Interaction to Next Paint reaches the poor-performance boundary of 500 milliseconds. Reads web_vital.inp; an SDK emitting browser.interaction_to_next_paint, interaction_to_next_paint or web.vitals.inp must retarget the created monitor.",
    metricName: "web_vital.inp",
    metricAlias: "rum_inp",
    threshold: 500,
    thresholdLabel: "500 ms",
    thresholdUnit: "ms",
    severity: "Critical",
  }),
  buildWebVitalTemplate({
    id: "rum-poor-cls",
    name: "Poor Cumulative Layout Shift",
    description:
      "Alert when average Cumulative Layout Shift reaches the poor-experience boundary of 0.25. Reads web_vital.cls; an SDK emitting browser.cumulative_layout_shift, cumulative_layout_shift or web.vitals.cls must retarget the created monitor.",
    metricName: "web_vital.cls",
    metricAlias: "rum_cls",
    threshold: 0.25,
    thresholdLabel: "0.25",
    thresholdUnit: "1",
    severity: "Critical",
  }),
  buildWebVitalTemplate({
    id: "rum-slow-fcp",
    name: "Slow First Contentful Paint",
    description:
      "Alert when average First Contentful Paint reaches the poor-performance boundary of 3 seconds. Reads web_vital.fcp; an SDK emitting browser.first_contentful_paint, first_contentful_paint or web.vitals.fcp must retarget the created monitor.",
    metricName: "web_vital.fcp",
    metricAlias: "rum_fcp",
    threshold: 3000,
    thresholdLabel: "3,000 ms",
    thresholdUnit: "ms",
    severity: "Warning",
  }),
  buildWebVitalTemplate({
    id: "rum-slow-ttfb",
    name: "Slow Time to First Byte",
    description:
      "Alert when average Time to First Byte reaches the poor-performance boundary of 1.8 seconds. Reads web_vital.ttfb; an SDK emitting browser.time_to_first_byte, time_to_first_byte or web.vitals.ttfb must retarget the created monitor.",
    metricName: "web_vital.ttfb",
    metricAlias: "rum_ttfb",
    threshold: 1800,
    thresholdLabel: "1,800 ms",
    thresholdUnit: "ms",
    severity: "Warning",
  }),
];

const failedUserOperationsTemplate: RumAlertTemplate = {
  id: "rum-failed-user-operations",
  name: "Failed User Operations",
  description:
    "Alert when the RUM application reports one or more error-status spans in five minutes. The earliest signal that user-facing requests are failing, whatever the cause.",
  category: "Errors",
  /*
   * Warning, not Critical, for the reason ServiceAlertTemplates gives
   * `service-failed-operations` the same severity: a bar of "more than zero
   * error spans" is cleared by one ad blocker, one browser extension, one
   * third-party script, or one user on a flaky mobile connection. It is a
   * near-certainty on any real site, and browser spans are strictly noisier
   * than the backend ones that sibling already declined to page on. The two
   * share the config kind, the error-status filter and the threshold; only the
   * window differs — five minutes here against ten there, for the reason
   * written on that template.
   *
   * `severity` is not cosmetic. MonitorRecommendationSeverityMapper maps
   * Critical onto the project's MOST severe incident/alert severity and
   * Warning onto the next one down, and that is the severity row every
   * incident and alert this monitor opens carries from then on. It is not what
   * attaches the escalation: on-call policies are picked once in the create
   * side-over and applied to every selected recommendation alike.
   *
   * `rum-unhandled-exceptions` below keeps Critical on a `> 0` bar that only
   * looks like this one. It counts exception GROUPS that are neither resolved
   * nor archived, so anything already triaged stops counting. A raw span count
   * has no such gate.
   */
  severity: "Warning",
  monitorType: MonitorType.Traces,
  getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: args.monitorName,
      monitorType: MonitorType.Traces,
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      defaultIncidentSeverityId: args.defaultIncidentSeverityId,
      defaultAlertSeverityId: args.defaultAlertSeverityId,
    });

    step.setTraceMonitor({
      attributes: {},
      spanName: "",
      spanStatuses: [SpanStatus.Error],
      telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
      entityKeys: [],
      lastXSecondsOfSpans: 300,
    });

    step.setMonitorCriteria(
      buildCriteria({
        args: args,
        checkOn: CheckOn.SpanCount,
        unhealthyFilterType: FilterType.GreaterThan,
        healthyFilterType: FilterType.LessThanOrEqualTo,
        threshold: 0,
        unhealthyName: "RUM error spans detected",
        unhealthyDescription:
          "Triggers when at least one error-status span is reported in five minutes.",
        incidentTitle: `[RUM] Failed user operation - ${args.monitorName}`,
        incidentDescription:
          "The RUM application reported an error-status span. Inspect the affected page, operation, trace, device, and browser for the user-visible failure.",
      }),
    );

    return step;
  },
};

const unhandledExceptionsTemplate: RumAlertTemplate = {
  id: "rum-unhandled-exceptions",
  name: "Unhandled Browser Exceptions",
  description:
    "Alert when the RUM application reports one or more unresolved exceptions in five minutes.",
  category: "Errors",
  severity: "Critical",
  monitorType: MonitorType.Exceptions,
  getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: args.monitorName,
      monitorType: MonitorType.Exceptions,
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      defaultIncidentSeverityId: args.defaultIncidentSeverityId,
      defaultAlertSeverityId: args.defaultAlertSeverityId,
    });

    step.setExceptionMonitor({
      telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
      entityKeys: [],
      exceptionTypes: [],
      message: "",
      includeResolved: false,
      includeArchived: false,
      lastXSecondsOfExceptions: 300,
    });

    step.setMonitorCriteria(
      buildCriteria({
        args: args,
        checkOn: CheckOn.ExceptionCount,
        unhealthyFilterType: FilterType.GreaterThan,
        healthyFilterType: FilterType.LessThanOrEqualTo,
        threshold: 0,
        unhealthyName: "Unhandled browser exception detected",
        unhealthyDescription:
          "Triggers when at least one unresolved exception is reported in five minutes.",
        incidentTitle: `[RUM] Unhandled browser exception - ${args.monitorName}`,
        incidentDescription:
          "The RUM application reported an unresolved exception. Inspect the exception group, stack trace, release, page, browser, and affected sessions.",
      }),
    );

    return step;
  },
};

/*
 * Session replay storage budget.
 *
 * Replay uploads are refused once the project's daily limit
 * (SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY) or the application's Monthly
 * budget is spent, and before these templates that was visible only on the
 * Replay Health page: recorders are told to stop, quietly, and recordings
 * simply stop appearing. A worker sweep posts both budgets every five minutes
 * as the `oneuptime.rum.session.replay.budget.*` metrics
 * (SessionReplayBudgetMetricType), keyed to the RUM application, so these are
 * ordinary Metrics monitors scoped to one application, like the web vitals.
 * Every choice below follows from how that sweep writes:
 *
 *   - PERCENT, never bytes. Both budgets are GiB (a Monthly budget of 10 "GB"
 *     is 10 x 1024^3 bytes, and the daily default is 1 GiB), while every byte
 *     threshold, unit and chart in the metric stack is decimal: a "1 GB"
 *     threshold fires at 93% of a 1 GiB limit. The sweep computes the percent
 *     against the exact byte limit the gate enforces, rounded DOWN, so 100 or
 *     more means exactly what the gate means by spent.
 *
 *   - Max, then MaximumValue, over Past15Minutes. A point lands every five
 *     minutes, so fifteen minutes holds two or three of them and one late
 *     sweep cannot empty the window - an empty window meets no criteria,
 *     which resolves an open alert, so a shorter one would flap. Budget use
 *     only climbs within its day or month, so the highest point in the window
 *     is the latest: Average would lag a crossing by most of a window, and
 *     All Values (what a filter falls back to without a metricAlias) would
 *     wait for every point to cross. Recovery reduces the same way, so it
 *     holds until the last point at or over the threshold has left the
 *     window, 10-15 minutes after the value falls. Max at the query is the
 *     aggregation the metric catalog registers for these series: the one that
 *     stays right wherever the project's value appears once per application,
 *     which Sum would multiply.
 *
 *   - The daily limit belongs to the PROJECT. The sweep posts the project's
 *     value under every application that records, identical on each, so the
 *     daily pair is offered on each of them and any one monitor covers them
 *     all. The cards say so: one created per application pages the same
 *     exhaustion once per application.
 *
 *   - Gating (`requirement`). The sweep only posts for applications that have
 *     session replay on and have recorded at least once, and the monthly
 *     series only while the application has a Monthly budget. A monitor over
 *     a series nobody posts never fires, so each pair is offered only once its
 *     series can exist - see getRumAlertTemplates.
 */
interface SessionReplayBudgetTemplateData {
  id: string;
  name: string;
  description: string;
  severity: RumAlertTemplateSeverity;
  requirement: RumAlertTemplateRequirement;
  metricName: SessionReplayBudgetMetricType;
  metricAlias: string;
  // Percent of the budget used, the unit the series is posted in.
  threshold: number;
  // Completes the breach criteria's name: "<name> - 80% or more used".
  thresholdLabel: string;
  breachDescription: string;
  // What goes between "[RUM] " and " - <application>" in the titles.
  incidentHeadline: string;
  getIncidentDescription: (monitorName: string) => string;
}

// The unit the percent series are posted in, and so the one to read them in.
const SESSION_REPLAY_BUDGET_PERCENT_UNIT: string = "%";

function buildSessionReplayBudgetTemplate(
  data: SessionReplayBudgetTemplateData,
): RumAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    category: "Session Replay",
    severity: data.severity,
    monitorType: MonitorType.Metrics,
    requirement: data.requirement,
    getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Metrics,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      step.setMetricMonitor({
        telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
        rollingTime: RollingTime.Past15Minutes,
        metricViewConfig: {
          queryConfigs: [
            {
              metricAliasData: {
                metricVariable: data.metricAlias,
                title: data.name,
                description: data.description,
                legend: data.name,
                legendUnit: SESSION_REPLAY_BUDGET_PERCENT_UNIT,
              },
              metricQueryData: {
                filterData: {
                  metricName: data.metricName,
                  attributes: {},
                  aggegationType: MetricsAggregationType.Max,
                  aggregateBy: {},
                },
              },
            },
          ],
          formulaConfigs: [],
        },
      });

      step.setMonitorCriteria(
        buildCriteria({
          args: args,
          checkOn: CheckOn.MetricValue,
          unhealthyFilterType: FilterType.GreaterThanOrEqualTo,
          healthyFilterType: FilterType.LessThan,
          threshold: data.threshold,
          /*
           * Load-bearing: without the alias no metricMonitorOptions are
           * written, and the window silently falls back to All Values.
           */
          metricAlias: data.metricAlias,
          thresholdUnit: SESSION_REPLAY_BUDGET_PERCENT_UNIT,
          metricAggregationType: EvaluateOverTimeType.MaximumValue,
          unhealthyName: `${data.name} - ${data.thresholdLabel}`,
          unhealthyDescription: data.breachDescription,
          incidentTitle: `[RUM] ${data.incidentHeadline} - ${args.monitorName}`,
          incidentDescription: data.getIncidentDescription(args.monitorName),
          healthyDescription: `Session replay budget use for ${args.monitorName} is below the alert threshold.`,
        }),
      );

      return step;
    },
  };
}

/*
 * The incident descriptions only name levers that take effect BEFORE a byte
 * is charged - the allowed origins and the sample percentage are checked
 * ahead of the charge, and "On error or frustration" keeps ordinary sessions
 * from uploading at all - because a setting that acts on what was already
 * uploaded (retention, deleting recordings) gives none of the budget back.
 * The daily limit itself cannot be raised from the dashboard, only by the
 * deployment.
 */
const sessionReplayBudgetTemplates: Array<RumAlertTemplate> = [
  buildSessionReplayBudgetTemplate({
    id: "rum-session-replay-daily-budget-nearly-spent",
    name: "Session Replay Daily Budget Nearly Spent",
    description:
      "Alert when the project's session replay uploads today reach 80% of its daily limit, before recorders are told to stop. The limit is shared by every application in the project and resets at 00:00 UTC, so one of these monitors covers them all.",
    severity: "Warning",
    requirement: "SessionReplayRecording",
    metricName: SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
    metricAlias: "rum_replay_daily_budget_used",
    threshold: 80,
    thresholdLabel: "80% or more used",
    breachDescription:
      "Triggers when the project's session replay uploads today reach 80% of its daily limit at any point in the last 15 minutes.",
    incidentHeadline: "Project's daily session replay budget nearly spent",
    getIncidentDescription: (): string => {
      return "This project has used 80% of today's session replay upload limit, which all of its RUM applications share. At 100% every recorder in the project is told to stop until 00:00 UTC. To make the rest of the day last, open the Replay Policy page of the busiest applications and lower the Sample percentage, upload only On error or frustration, or narrow the Allowed origins so staging traffic stops spending it. Self-hosted: the limit is SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY.";
    },
  }),
  buildSessionReplayBudgetTemplate({
    id: "rum-session-replay-daily-budget-spent",
    name: "Session Replay Daily Budget Spent",
    description:
      "Alert when the project's daily session replay limit is spent: every recorder in the project has been told to stop until 00:00 UTC. The limit is shared by every application in the project, so one of these monitors covers them all.",
    severity: "Critical",
    requirement: "SessionReplayRecording",
    metricName: SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
    metricAlias: "rum_replay_daily_budget_used",
    threshold: 100,
    thresholdLabel: "100% used",
    breachDescription:
      "Triggers when the project's session replay uploads today reach 100% of its daily limit at any point in the last 15 minutes.",
    incidentHeadline: "Session replay paused: project's daily budget spent",
    getIncidentDescription: (): string => {
      return "This project has spent today's session replay upload limit, which all of its RUM applications share: every recorder in the project has been told to stop, and nothing more is recorded until 00:00 UTC, when this resolves on its own. To make tomorrow's limit last, lower the Sample percentage, upload only On error or frustration, or narrow the Allowed origins on the busiest applications' Replay Policy page. Self-hosted: the limit is SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY.";
    },
  }),
  buildSessionReplayBudgetTemplate({
    id: "rum-session-replay-monthly-budget-nearly-spent",
    name: "Session Replay Monthly Budget Nearly Spent",
    description:
      "Alert when this application's session replay uploads this month reach 80% of its monthly budget, before its recorders are told to stop for the rest of the month (UTC).",
    severity: "Warning",
    requirement: "SessionReplayMonthlyBudget",
    metricName: SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    metricAlias: "rum_replay_monthly_budget_used",
    threshold: 80,
    thresholdLabel: "80% or more used",
    breachDescription:
      "Triggers when this application's session replay uploads this month reach 80% of its monthly budget at any point in the last 15 minutes.",
    incidentHeadline: "Monthly session replay budget nearly spent",
    getIncidentDescription: (monitorName: string): string => {
      return `${monitorName} has used 80% of its monthly session replay budget. At 100% its recorders are told to stop until the 1st of next month (UTC). Raise the Monthly budget on its Replay Policy page, lower the Sample percentage, or upload only On error or frustration.`;
    },
  }),
  buildSessionReplayBudgetTemplate({
    id: "rum-session-replay-monthly-budget-spent",
    name: "Session Replay Monthly Budget Spent",
    description:
      "Alert when this application's monthly session replay budget is spent: its recorders have been told to stop until the 1st of next month (UTC) or until the budget is raised.",
    severity: "Critical",
    requirement: "SessionReplayMonthlyBudget",
    metricName: SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    metricAlias: "rum_replay_monthly_budget_used",
    threshold: 100,
    thresholdLabel: "100% used",
    breachDescription:
      "Triggers when this application's session replay uploads this month reach 100% of its monthly budget at any point in the last 15 minutes.",
    incidentHeadline: "Session replay paused: monthly budget spent",
    getIncidentDescription: (monitorName: string): string => {
      return `${monitorName} has spent its monthly session replay budget: its recorders have been told to stop, and nothing more is recorded until the 1st of next month (UTC) or until the budget is raised on its Replay Policy page. This resolves on its own.`;
    },
  }),
];

const ALL_RUM_ALERT_TEMPLATES: Array<RumAlertTemplate> = [
  ...webVitalTemplates,
  failedUserOperationsTemplate,
  unhandledExceptionsTemplate,
  ...sessionReplayBudgetTemplates,
];

/*
 * Every template this module ships, whatever the application - the set that
 * resolving an id and the catalog-wide invariants have to run over. What to
 * offer ONE application is getRumAlertTemplates.
 */
export function getAllRumAlertTemplates(): Array<RumAlertTemplate> {
  return [...ALL_RUM_ALERT_TEMPLATES];
}

/*
 * Whether one application meets a template's requirement. Only an explicit
 * `true` (and a real budget) counts: unknown is never read as yes.
 */
function isRequirementMet(data: {
  requirement: RumAlertTemplateRequirement | undefined;
  context: RumAlertTemplateContext | undefined;
}): boolean {
  if (!data.requirement) {
    return true;
  }

  const isRecording: boolean =
    data.context?.sessionReplayEnabled === true &&
    data.context?.sessionReplayHasRecorded === true;

  const budgetInGB: number | null | undefined =
    data.context?.sessionReplayMonthlyBudgetInGB;

  switch (data.requirement) {
    case "SessionReplayRecording":
      return isRecording;
    case "SessionReplayMonthlyBudget":
      return (
        isRecording &&
        typeof budgetInGB === "number" &&
        Number.isFinite(budgetInGB) &&
        budgetInGB > 0
      );
    default:
      return false;
  }
}

/*
 * The templates to offer ONE application, given what is known about it.
 *
 * Every template without a requirement, always. The session replay budget
 * pairs only once their series can exist (see the storage budget comment
 * above): the daily pair once the application has session replay on and has
 * recorded, the monthly pair once it also has a Monthly budget. No context,
 * or a field that is null or undefined, withholds them - so what an unknown
 * application is offered is exactly the set every application was offered
 * before they existed.
 */
export function getRumAlertTemplates(
  context?: RumAlertTemplateContext | undefined,
): Array<RumAlertTemplate> {
  return ALL_RUM_ALERT_TEMPLATES.filter((template: RumAlertTemplate) => {
    return isRequirementMet({
      requirement: template.requirement,
      context: context,
    });
  });
}

export function getRumAlertTemplateById(
  id: string,
): RumAlertTemplate | undefined {
  return ALL_RUM_ALERT_TEMPLATES.find((template: RumAlertTemplate) => {
    return template.id === id;
  });
}
