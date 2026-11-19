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
import {
  RUM_CLIENT_KIND_BROWSER,
  RUM_CLIENT_KIND_MOBILE,
  RumClientKind,
  readRumClientKind,
} from "../Rum/RumClientKind";
import { APP_NOT_RESPONDING_EXCEPTION_TYPES } from "../../Utils/Telemetry/MobileAppFaults";
import {
  APP_JANK_EVENT_NAME,
  APP_JANK_THRESHOLD_ATTRIBUTE,
  APP_START_SPAN_NAME,
  APP_START_TYPE_ATTRIBUTE,
  APP_START_TYPE_COLD,
  EVENT_NAME_ATTRIBUTE,
  EXCESSIVE_APP_START_MS,
  FROZEN_FRAME_THRESHOLD,
} from "../Rum/MobileAppTelemetry";
import {
  SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE,
  SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
} from "../Rum/SessionReplaySignalMetric";
import {
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
} from "../Rum/SessionReplayFrustrationSignals";

export type RumAlertTemplateCategory =
  | "Core Web Vitals"
  | "Errors"
  | "Performance"
  | "Availability"
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
  /*
   * Whether the application is a browser app or a mobile app, as ingest
   * records it (`clientType`, read through Rum/RumClientKind). Unlike the
   * fields above, not known does not withhold everything that depends on
   * it: an application nothing has arrived from is offered the browser
   * templates, which every RUM application was offered before mobile apps
   * had templates of their own. The mobile templates need a "mobile".
   */
  clientKind?: RumClientKind | string | null | undefined;
  /*
   * The application's own signals that are switched on, from its
   * Frustration Signals page (issue #6518): each is offered as an alert of
   * its own, once the application records - only a recorded session counts
   * a signal.
   */
  customSignals?:
    | ReadonlyArray<RumAlertTemplateCustomSignal>
    | null
    | undefined;
}

/* A signal of the application's own that a recommendation can watch. */
export interface RumAlertTemplateCustomSignal {
  // Its id on the Frustration Signals page, which a rename keeps.
  id: string;
  name: string;
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
  /*
   * The kinds of application whose SDK sends what the template reads: a
   * Web Vital only ever comes from a browser, an app start or an ANR from a
   * mobile app (#9589). Absent on the templates every application can use,
   * such as a failed operation's error span. See getRumAlertTemplates.
   */
  clients?: ReadonlyArray<RumClientKind> | undefined;
  getMonitorStep: (args: RumAlertTemplateArgs) => MonitorStep;
}

const BROWSER_ONLY: ReadonlyArray<RumClientKind> = [RUM_CLIENT_KIND_BROWSER];
const MOBILE_ONLY: ReadonlyArray<RumClientKind> = [RUM_CLIENT_KIND_MOBILE];

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
    // Only a browser reports a Web Vital: on a mobile app it never fires.
    clients: BROWSER_ONLY,
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
        /*
         * Offered to browser and mobile apps alike, so it names a page or a
         * screen, and the device either runs on.
         */
        incidentDescription:
          "The RUM application reported an error-status span. Inspect the affected page or screen, the operation, its trace and the device for the user-visible failure.",
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
  /*
   * A browser's page errors. A mobile app is offered App Crashes and App
   * Not Responding (ANR) instead, which tell a crash from a freeze.
   */
  clients: BROWSER_ONLY,
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
 * THE MOBILE APP TEMPLATES (#9589).
 *
 * What a mobile team pages on, read from what OpenTelemetry Android sends on
 * its own (Rum/MobileAppTelemetry), and an iOS app's MetricKit: a crash, an
 * ANR or a hang, a slow cold start, a frozen frame, and an app that has gone
 * quiet. A browser app is never offered them (none of these spans or events
 * comes from a browser), and a mobile app is never offered the Web Vitals,
 * which only a browser reports.
 *
 * Crashes and freezes are Exceptions monitors that leave each other out
 * (buildMobileFaultTemplate, #9713): an Exceptions monitor that counted
 * every exception would count the app's handled ones - a failed network
 * call's included - and an ANR as a crash too.
 *
 * Every threshold is the first occurrence, on the Failed User Operations
 * pattern: a kiosk fleet, the case these were written for (#9533), has few
 * devices and wants to hear about each crash and each slow start. The
 * performance pair is a Warning, as an app with a large audience on old
 * phones will see some of both; such an app raises the count in the
 * monitor's criteria. Such an app is served by the crash and ANR rates
 * (buildMobileFaultRateTemplate, #9716) rather than by each crash.
 */
interface MobileLogEventTemplateData {
  id: string;
  name: string;
  description: string;
  category: RumAlertTemplateCategory;
  severity: RumAlertTemplateSeverity;
  // The event's attributes, `event.name` first.
  attributes: Record<string, string>;
  lastXSecondsOfLogs: number;
  unhealthyName: string;
  unhealthyDescription: string;
  // What goes between "[RUM] " and " - <application>" in the titles.
  incidentHeadline: string;
  incidentDescription: string;
}

function buildMobileLogEventTemplate(
  data: MobileLogEventTemplateData,
): RumAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    category: data.category,
    severity: data.severity,
    monitorType: MonitorType.Logs,
    clients: MOBILE_ONLY,
    getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Logs,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      step.setLogMonitor({
        attributes: { ...data.attributes },
        body: "",
        // An event carries no severity worth filtering on: every one counts.
        severityTexts: [],
        telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
        entityKeys: [],
        lastXSecondsOfLogs: data.lastXSecondsOfLogs,
      });

      step.setMonitorCriteria(
        buildCriteria({
          args: args,
          checkOn: CheckOn.LogCount,
          unhealthyFilterType: FilterType.GreaterThan,
          healthyFilterType: FilterType.LessThanOrEqualTo,
          threshold: 0,
          unhealthyName: data.unhealthyName,
          unhealthyDescription: data.unhealthyDescription,
          incidentTitle: `[RUM] ${data.incidentHeadline} - ${args.monitorName}`,
          incidentDescription: data.incidentDescription,
        }),
      );

      return step;
    },
  };
}

/*
 * A crash and a freeze are Exceptions monitors (#9713): ingest files every
 * crash, ANR and hang as an unhandled exception (MobileAppFaults), whatever
 * SDK and version reported it, so counting exceptions counts exactly what
 * the Overview's Crashes and ANRs tiles count, and the alert opens the
 * exception - its stack trace, its group's resolved or archived state. A
 * crash is an unhandled exception that is no freeze (ANR and Hang left out),
 * a freeze one of those two types, so one freeze never pages as a crash too.
 */
interface MobileFaultTemplateData {
  id: string;
  name: string;
  description: string;
  // What it counts, beside the application and the five minutes.
  filter: {
    unhandledOnly?: boolean;
    exceptionTypes?: Array<string>;
    excludedExceptionTypes?: Array<string>;
  };
  unhealthyName: string;
  unhealthyDescription: string;
  // What goes between "[RUM] " and " - <application>" in the titles.
  incidentHeadline: string;
  incidentDescription: string;
}

// The step's Exceptions monitor: the application's exceptions of one kind.
function setMobileFaultMonitor(data: {
  step: MonitorStep;
  args: RumAlertTemplateArgs;
  filter: MobileFaultTemplateData["filter"];
  lastXSecondsOfExceptions: number;
}): void {
  data.step.setExceptionMonitor({
    telemetryServiceIds: [new ObjectID(data.args.rumApplicationId)],
    entityKeys: [],
    exceptionTypes: [...(data.filter.exceptionTypes || [])],
    ...(data.filter.excludedExceptionTypes
      ? { excludedExceptionTypes: [...data.filter.excludedExceptionTypes] }
      : {}),
    ...(data.filter.unhandledOnly ? { unhandledOnly: true } : {}),
    message: "",
    includeResolved: false,
    includeArchived: false,
    lastXSecondsOfExceptions: data.lastXSecondsOfExceptions,
  });
}

function buildMobileFaultTemplate(
  data: MobileFaultTemplateData,
): RumAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    category: "Errors",
    /*
     * A crash ends the person's use of the app, as an unhandled browser
     * exception may not, and a freeze is as final to a kiosk: Critical, the
     * severity Android vitals gives both rates as core vitals.
     */
    severity: "Critical",
    monitorType: MonitorType.Exceptions,
    clients: MOBILE_ONLY,
    getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Exceptions,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      setMobileFaultMonitor({
        step: step,
        args: args,
        filter: data.filter,
        lastXSecondsOfExceptions: 300,
      });

      step.setMonitorCriteria(
        buildCriteria({
          args: args,
          checkOn: CheckOn.ExceptionCount,
          unhealthyFilterType: FilterType.GreaterThan,
          healthyFilterType: FilterType.LessThanOrEqualTo,
          threshold: 0,
          unhealthyName: data.unhealthyName,
          unhealthyDescription: data.unhealthyDescription,
          incidentTitle: `[RUM] ${data.incidentHeadline} - ${args.monitorName}`,
          incidentDescription: data.incidentDescription,
        }),
      );

      return step;
    },
  };
}

const appCrashesTemplate: RumAlertTemplate = buildMobileFaultTemplate({
  id: "rum-app-crashes",
  name: "App Crashes",
  description:
    "Alert when the app crashes: any unhandled exception other than an ANR or a hang in five minutes, as the Overview's Crashes tile counts them. OpenTelemetry Android reports every crash, and MetricKit an iOS app's on a later launch.",
  filter: {
    unhandledOnly: true,
    excludedExceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
  },
  unhealthyName: "App crash reported",
  unhealthyDescription:
    "Triggers when the app reports at least one crash in five minutes.",
  incidentHeadline: "App crash",
  incidentDescription:
    "The app crashed for at least one person. Open the exception for its stack trace, release and device, and the session it was in.",
});

const appNotRespondingTemplate: RumAlertTemplate = buildMobileFaultTemplate({
  id: "rum-app-not-responding",
  name: "App Not Responding (ANR)",
  description:
    "Alert when the app stops responding: any ANR, or an iOS app's hang, in five minutes. OpenTelemetry Android reports an ANR once the app's main thread has been blocked for five seconds, and MetricKit a hang on a later launch.",
  filter: {
    exceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
  },
  unhealthyName: "ANR reported",
  unhealthyDescription:
    "Triggers when the app reports at least one ANR or hang in five minutes.",
  incidentHeadline: "App not responding",
  incidentDescription:
    "The app's main thread was blocked, so it stopped responding to input. Open the exception for the main thread's stack, which shows what it was waiting on.",
});

/*
 * A mobile app's crash and ANR rates (#9716): the share of the hour's
 * sessions a crash, or a freeze, happened in (Sessions With Exceptions,
 * ExceptionMonitorEvaluation) - crashed sessions over sessions, as the
 * Overview's Crash-free sessions tile reads them. An app on thousands of
 * phones always has some crashes: what it wants to hear is the rate going
 * up. Android vitals calls a user-perceived crash rate of 1.09% and an ANR
 * rate of 0.47% bad behaviour.
 *
 * Judged only once the hour holds MOBILE_FAULT_RATE_MINIMUM_SESSIONS
 * sessions: one crashed session in 250 is 0.4%, under both, so a single
 * crash never reads as a rate. An app used less than that - a kiosk fleet -
 * is served by the first-occurrence templates above, which stay.
 */
export const MOBILE_CRASH_RATE_PERCENT: number = 1.09;
export const MOBILE_ANR_RATE_PERCENT: number = 0.47;
export const MOBILE_FAULT_RATE_MINIMUM_SESSIONS: number = 250;
export const MOBILE_FAULT_RATE_WINDOW_SECONDS: number = 3600;

/*
 * The OneUptime CLI's command for exception groups (TelemetryException),
 * as its resources name it (Utils/DeveloperDocs/CliResources).
 */
export const EXCEPTION_CLI_RESOURCE: string = "exception";

/*
 * The first command to run when a mobile app's crash or ANR rate alerts:
 * the OneUptime CLI listing the app's open exceptions of that kind, the
 * most recently seen first, with how often each happened and the release
 * it was last seen in - a crash a new release brought shows at once.
 * Read-only, and every argument is known when the monitor is made: the
 * application's id and the types, none of which holds a quote.
 */
export function getMobileFaultDebugCommand(data: {
  rumApplicationId: string;
  // The freezes' types; without them, every unhandled exception.
  exceptionTypes?: Array<string> | undefined;
}): string {
  const query: Record<string, unknown> = {
    primaryEntityId: data.rumApplicationId,
    ...(data.exceptionTypes && data.exceptionTypes.length > 0
      ? { exceptionType: { _type: "Includes", value: data.exceptionTypes } }
      : { unhandled: true }),
    isResolved: false,
    isArchived: false,
  };

  return `oneuptime ${EXCEPTION_CLI_RESOURCE} list --query '${JSON.stringify(
    query,
  )}' --sort '{"lastSeenAt":"DESC"}' --fields exceptionType,message,occuranceCount,lastSeenInRelease,lastSeenAt`;
}

interface MobileFaultRateTemplateData {
  id: string;
  name: string;
  description: string;
  filter: MobileFaultTemplateData["filter"];
  ratePercent: number;
  unhealthyName: string;
  unhealthyDescription: string;
  incidentHeadline: string;
  // What happened, before the first command.
  incidentLead: string;
  // What the first command lists.
  commandLead: string;
  // Between the application's name and the end of the healthy sentence.
  healthySentence: string;
}

function buildMobileFaultRateTemplate(
  data: MobileFaultRateTemplateData,
): RumAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    category: "Errors",
    severity: "Critical",
    monitorType: MonitorType.Exceptions,
    clients: MOBILE_ONLY,
    getMonitorStep: (args: RumAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Exceptions,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      setMobileFaultMonitor({
        step: step,
        args: args,
        filter: data.filter,
        lastXSecondsOfExceptions: MOBILE_FAULT_RATE_WINDOW_SECONDS,
      });

      const command: string = getMobileFaultDebugCommand({
        rumApplicationId: args.rumApplicationId,
        exceptionTypes: data.filter.exceptionTypes,
      });

      const criteria: MonitorCriteria = buildCriteria({
        args: args,
        checkOn: CheckOn.SessionsWithExceptionsPercent,
        unhealthyFilterType: FilterType.GreaterThan,
        healthyFilterType: FilterType.LessThanOrEqualTo,
        threshold: data.ratePercent,
        unhealthyName: data.unhealthyName,
        unhealthyDescription: data.unhealthyDescription,
        incidentTitle: `[RUM] ${data.incidentHeadline} - ${args.monitorName}`,
        incidentDescription: `${data.incidentLead} ${data.commandLead}\n\n\`\`\`\n${command}\n\`\`\``,
        healthyDescription: `${args.monitorName} ${data.healthySentence}`,
      });

      /*
       * The rate is judged only on enough sessions: both filters to alert,
       * either to be healthy - a share at or under the rate, or too few
       * sessions to read one.
       */
      const [unhealthy, healthy]: Array<MonitorCriteriaInstance> =
        criteria.data!.monitorCriteriaInstanceArray;

      unhealthy!.data!.filterCondition = FilterCondition.All;
      unhealthy!.data!.filters.push({
        checkOn: CheckOn.SessionCount,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: MOBILE_FAULT_RATE_MINIMUM_SESSIONS,
      });

      healthy!.data!.filterCondition = FilterCondition.Any;
      healthy!.data!.filters.push({
        checkOn: CheckOn.SessionCount,
        filterType: FilterType.LessThan,
        value: MOBILE_FAULT_RATE_MINIMUM_SESSIONS,
      });

      step.setMonitorCriteria(criteria);

      return step;
    },
  };
}

const appCrashRateTemplate: RumAlertTemplate = buildMobileFaultRateTemplate({
  id: "rum-app-crash-rate",
  name: "App Crash Rate",
  description: `Alert when more than ${MOBILE_CRASH_RATE_PERCENT}% of the app's sessions in an hour crash, the crash rate Android vitals calls bad behaviour. Judged from ${MOBILE_FAULT_RATE_MINIMUM_SESSIONS} sessions an hour, so one crash alone never trips it: for an app with a large audience, where App Crashes would alert all day.`,
  filter: {
    unhandledOnly: true,
    excludedExceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
  },
  ratePercent: MOBILE_CRASH_RATE_PERCENT,
  unhealthyName: `Crash rate above ${MOBILE_CRASH_RATE_PERCENT}%`,
  unhealthyDescription: `Triggers when more than ${MOBILE_CRASH_RATE_PERCENT}% of at least ${MOBILE_FAULT_RATE_MINIMUM_SESSIONS} sessions in an hour crashed.`,
  incidentHeadline: "App crash rate",
  incidentLead: `More than ${MOBILE_CRASH_RATE_PERCENT}% of the app's sessions in the past hour crashed, the rate Android vitals calls bad behaviour.`,
  commandLead:
    "To list the app's open crashes, the most recently seen first, with the release each was last seen in, run:",
  healthySentence: `crashes in ${MOBILE_CRASH_RATE_PERCENT}% of its sessions or fewer.`,
});

const appAnrRateTemplate: RumAlertTemplate = buildMobileFaultRateTemplate({
  id: "rum-app-anr-rate",
  name: "App ANR Rate",
  description: `Alert when more than ${MOBILE_ANR_RATE_PERCENT}% of the app's sessions in an hour have an ANR or a hang, the ANR rate Android vitals calls bad behaviour. Judged from ${MOBILE_FAULT_RATE_MINIMUM_SESSIONS} sessions an hour, so one alone never trips it.`,
  filter: {
    exceptionTypes: [...APP_NOT_RESPONDING_EXCEPTION_TYPES],
  },
  ratePercent: MOBILE_ANR_RATE_PERCENT,
  unhealthyName: `ANR rate above ${MOBILE_ANR_RATE_PERCENT}%`,
  unhealthyDescription: `Triggers when more than ${MOBILE_ANR_RATE_PERCENT}% of at least ${MOBILE_FAULT_RATE_MINIMUM_SESSIONS} sessions in an hour had an ANR or a hang.`,
  incidentHeadline: "App ANR rate",
  incidentLead: `More than ${MOBILE_ANR_RATE_PERCENT}% of the app's sessions in the past hour had an ANR or a hang, the rate Android vitals calls bad behaviour.`,
  commandLead:
    "To list the app's open ANRs and hangs, the most recently seen first, with the release each was last seen in, run:",
  healthySentence: `stops responding in ${MOBILE_ANR_RATE_PERCENT}% of its sessions or fewer.`,
});

const SLOW_COLD_START_MS: number = EXCESSIVE_APP_START_MS[APP_START_TYPE_COLD];

const slowColdStartTemplate: RumAlertTemplate = {
  id: "rum-slow-cold-start",
  name: "Slow Cold Start",
  description: `Alert when a cold start takes 5 seconds or longer, which Android vitals counts as excessive. Reads the ${APP_START_SPAN_NAME} spans OpenTelemetry Android sends with ${APP_START_TYPE_ATTRIBUTE} cold.`,
  category: "Performance",
  severity: "Warning",
  monitorType: MonitorType.Traces,
  clients: MOBILE_ONLY,
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
      attributes: { [APP_START_TYPE_ATTRIBUTE]: APP_START_TYPE_COLD },
      spanName: APP_START_SPAN_NAME,
      spanStatuses: [],
      telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
      entityKeys: [],
      /*
       * Fifteen minutes: an app starts far less often than it makes
       * requests, so a five-minute window would hold one start at most.
       */
      lastXSecondsOfSpans: 900,
      minimumDurationInMs: SLOW_COLD_START_MS,
    });

    step.setMonitorCriteria(
      buildCriteria({
        args: args,
        checkOn: CheckOn.SpanCount,
        unhealthyFilterType: FilterType.GreaterThan,
        healthyFilterType: FilterType.LessThanOrEqualTo,
        threshold: 0,
        unhealthyName: "Cold start of 5 seconds or longer",
        unhealthyDescription:
          "Triggers when at least one cold start takes 5 seconds or longer in fifteen minutes.",
        incidentTitle: `[RUM] Slow cold start - ${args.monitorName}`,
        incidentDescription:
          "A cold start of the app took 5 seconds or longer. Open the app's Traces filtered to AppStart to see which devices and releases start slowly and what runs before the first screen. For an app with a large audience on older phones, raise the monitor's count above 0.",
        healthyDescription: `Every cold start of ${args.monitorName} in the window took under 5 seconds.`,
      }),
    );

    return step;
  },
};

const frozenFramesTemplate: RumAlertTemplate = buildMobileLogEventTemplate({
  id: "rum-frozen-frames",
  name: "Frozen Frames",
  description: `Alert when the app draws a frozen frame, one that takes longer than 700 milliseconds, in fifteen minutes. Reads the ${APP_JANK_EVENT_NAME} events OpenTelemetry Android sends with ${APP_JANK_THRESHOLD_ATTRIBUTE} ${FROZEN_FRAME_THRESHOLD}.`,
  category: "Performance",
  severity: "Warning",
  attributes: {
    [EVENT_NAME_ATTRIBUTE]: APP_JANK_EVENT_NAME,
    [APP_JANK_THRESHOLD_ATTRIBUTE]: FROZEN_FRAME_THRESHOLD,
  },
  // Frames freeze as a screen opens, which is seldom: a longer window, as for starts.
  lastXSecondsOfLogs: 900,
  unhealthyName: "Frozen frame reported",
  unhealthyDescription:
    "Triggers when the app reports a frozen frame in fifteen minutes.",
  incidentHeadline: "Frozen frames",
  incidentDescription:
    "The app took longer than 700 milliseconds to draw a frame, so it looked stuck to the person using it. The app's Overview lists the screens with the most frozen frames. For an app with a large audience on older phones, raise the monitor's count above 0.",
});

/*
 * The app as a whole gone quiet, as Traffic Stopped is for a service: no
 * span from any of its devices. Thirty minutes rather than fifteen, because
 * the SDK keeps what it records on the device until it can send it, so a
 * device that drops off the network for a moment is late rather than gone.
 * A device of a fleet going quiet while the others report is not seen
 * here: that needs a check per device.
 */
const appStoppedReportingTemplate: RumAlertTemplate = {
  id: "rum-app-stopped-reporting",
  name: "App Stopped Reporting",
  description:
    "Alert when the app sends no spans at all for thirty minutes: a release that broke its telemetry, a revoked key, or devices that went offline. An app with idle hours, such as kiosks at night, triggers it then too.",
  category: "Availability",
  severity: "Warning",
  monitorType: MonitorType.Traces,
  clients: MOBILE_ONLY,
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
      spanStatuses: [],
      telemetryServiceIds: [new ObjectID(args.rumApplicationId)],
      entityKeys: [],
      lastXSecondsOfSpans: 1800,
    });

    step.setMonitorCriteria(
      buildCriteria({
        args: args,
        checkOn: CheckOn.SpanCount,
        // Below the threshold is the bad state here, as for Traffic Stopped.
        unhealthyFilterType: FilterType.LessThan,
        healthyFilterType: FilterType.GreaterThanOrEqualTo,
        threshold: 1,
        unhealthyName: "No spans in thirty minutes",
        unhealthyDescription:
          "Triggers when the app reports no spans at all over thirty minutes.",
        incidentTitle: `[RUM] App stopped reporting - ${args.monitorName}`,
        incidentDescription:
          "OneUptime has received no spans from the app for thirty minutes. Check whether its devices are on and online, whether a recent release still starts OpenTelemetry, and whether its ingestion key was revoked or has expired. This resolves on its own once spans arrive again.",
        healthyDescription: `Spans are arriving from ${args.monitorName}.`,
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
 *     aggregation SessionReplayBudgetMetricTypeUtil.getAggregationType names
 *     for these series (and the docs and the catalog descriptions tell anyone
 *     charting them to use): the one that stays right wherever the project's
 *     value appears once per application, which Sum would multiply.
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
      return "This project has spent today's session replay upload limit, which all of its RUM applications share: every recorder in the project has been told to stop, and nothing more is recorded until 00:00 UTC. This resolves on its own at about 00:10-00:15 UTC, once the last reading over the limit has left the monitor's 15-minute window. To make tomorrow's limit last, lower the Sample percentage, upload only On error or frustration, or narrow the Allowed origins on the busiest applications' Replay Policy page. Self-hosted: the limit is SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY.";
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

/*
 * A signal of the application's own (issue #6518): "Sessions hit Payment
 * failed". One template per signal that is switched on, so a page can offer
 * an alert on each without the person typing its name - and, built from
 * the signal's id, the monitor it creates keeps counting the signal after a
 * rename.
 *
 * It reads the series the session replay ingest writes
 * (SESSION_REPLAY_SIGNAL_SESSIONS_METRIC): one point per recorded session,
 * in the minute the signal first fired in it, filtered to the signal's id.
 * Summed over 15 minutes, that is how many sessions hit the signal; the
 * alert opens at 5, a number the monitor's own criteria change. A window
 * with no session in it holds no point, which resolves an open alert - the
 * signal has stopped firing.
 *
 * Offered once the application records (the SessionReplayRecording
 * requirement), since only a recorded session reports a signal: the replay
 * sample and an "On error or frustration" trigger narrow what is counted,
 * and the description says so. Warning, never Critical: a signal is the
 * team's own marker, from a payment error page to a support chat opened,
 * and nothing says which of them should page anyone.
 */
export const RUM_CUSTOM_SIGNAL_TEMPLATE_ID_PREFIX: string =
  "rum-custom-signal-";

// Sessions in the window that open the alert, until the monitor says otherwise.
export const RUM_CUSTOM_SIGNAL_SESSIONS_THRESHOLD: number = 5;

const RUM_CUSTOM_SIGNAL_METRIC_ALIAS: string = "rum_signal_sessions";

// The longest a signal id the page or the API writes can be.
const MAX_CUSTOM_SIGNAL_ID_LENGTH: number = 64;

export function getRumCustomSignalTemplateId(signalId: string): string {
  return `${RUM_CUSTOM_SIGNAL_TEMPLATE_ID_PREFIX}${signalId}`;
}

export function buildRumCustomSignalTemplate(
  signal: RumAlertTemplateCustomSignal,
): RumAlertTemplate {
  const threshold: number = RUM_CUSTOM_SIGNAL_SESSIONS_THRESHOLD;
  const name: string = `Sessions Hit "${signal.name}"`;
  const description: string = `Alert when ${threshold} or more recorded sessions hit your signal "${signal.name}" within 15 minutes. A session counts once, when the signal first fires in it.`;

  return {
    id: getRumCustomSignalTemplateId(signal.id),
    name: name,
    description: description,
    category: "Session Replay",
    severity: "Warning",
    monitorType: MonitorType.Metrics,
    requirement: "SessionReplayRecording",
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
                metricVariable: RUM_CUSTOM_SIGNAL_METRIC_ALIAS,
                title: name,
                description: description,
                legend: signal.name,
                legendUnit: "",
              },
              metricQueryData: {
                filterData: {
                  metricName: SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
                  attributes: {
                    [SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE]: signal.id,
                  },
                  aggegationType: MetricsAggregationType.Sum,
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
          threshold: threshold,
          // Load-bearing: without the alias the window is read as All Values.
          metricAlias: RUM_CUSTOM_SIGNAL_METRIC_ALIAS,
          metricAggregationType: EvaluateOverTimeType.Sum,
          unhealthyName: `${name} - ${threshold} or more in 15 minutes`,
          unhealthyDescription: `Triggers when ${threshold} or more recorded sessions hit the signal "${signal.name}" within 15 minutes.`,
          incidentTitle: `[RUM] Sessions hit "${signal.name}" - ${args.monitorName}`,
          incidentDescription: `${threshold} or more recorded sessions of ${args.monitorName} hit your signal "${signal.name}" in the last 15 minutes. Watch them from the signal's See sessions, on the application's Frustration Signals page, or filter its session list by Signal of your own.`,
          healthyDescription: `Fewer than ${threshold} recorded sessions of ${args.monitorName} hit the signal "${signal.name}" in the last 15 minutes.`,
        }),
      );

      return step;
    },
  };
}

/*
 * The signals a context names that can be offered: a usable id and name,
 * each id once, as many as an application can have.
 */
function readCustomSignals(
  value: ReadonlyArray<RumAlertTemplateCustomSignal> | null | undefined,
): Array<RumAlertTemplateCustomSignal> {
  const signals: Array<RumAlertTemplateCustomSignal> = [];
  const ids: Set<string> = new Set<string>();

  if (!Array.isArray(value)) {
    return signals;
  }

  for (const entry of value) {
    const id: unknown = (entry as { id?: unknown } | null)?.id;
    const name: unknown = (entry as { name?: unknown } | null)?.name;

    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      id.trim().length === 0 ||
      id.length > MAX_CUSTOM_SIGNAL_ID_LENGTH ||
      name.trim().length === 0 ||
      name.trim().length > SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH ||
      ids.has(id)
    ) {
      continue;
    }

    ids.add(id);
    signals.push({ id: id, name: name.trim() });

    if (signals.length >= SESSION_REPLAY_MAX_CUSTOM_SIGNALS) {
      break;
    }
  }

  return signals;
}

/*
 * The Recommendations page draws its categories in the order their first
 * template appears here, and each category's cards in this order. A browser
 * app reads Core Web Vitals, then Errors (Failed User Operations, Unhandled
 * Browser Exceptions), then Session Replay, as it always has. A mobile app
 * reads Errors with App Crashes and its ANRs first, then their rates, then
 * Performance, then Availability, then Session Replay. An application's own
 * signals' alerts
 * (Session Replay too) follow these, from getRumAlertTemplates.
 */
const ALL_RUM_ALERT_TEMPLATES: Array<RumAlertTemplate> = [
  ...webVitalTemplates,
  appCrashesTemplate,
  appNotRespondingTemplate,
  appCrashRateTemplate,
  appAnrRateTemplate,
  failedUserOperationsTemplate,
  unhandledExceptionsTemplate,
  slowColdStartTemplate,
  frozenFramesTemplate,
  appStoppedReportingTemplate,
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
 * Whether one application is the kind of app a template is for. A template
 * for every kind is offered to every application. An application of no known
 * kind (nothing has arrived from it yet) is offered the browser templates and
 * not the mobile ones: what every application was offered before mobile apps
 * had templates of their own.
 */
function isClientMet(data: {
  clients: ReadonlyArray<RumClientKind> | undefined;
  context: RumAlertTemplateContext | undefined;
}): boolean {
  if (!data.clients || data.clients.length === 0) {
    return true;
  }

  const kind: RumClientKind =
    readRumClientKind(data.context?.clientKind) || RUM_CLIENT_KIND_BROWSER;

  return data.clients.includes(kind);
}

/*
 * The templates to offer ONE application, given what is known about it.
 *
 * Only the templates for its kind of app (#9589): a browser app's Web Vitals
 * and Unhandled Browser Exceptions, or a mobile app's App Crashes, App Not
 * Responding (ANR), App Crash Rate, App ANR Rate, Slow Cold Start, Frozen
 * Frames and App Stopped Reporting, and the templates every kind can use.
 * An application of no known kind is offered the browser set.
 *
 * The session replay budget pairs only once their series can exist (see the
 * storage budget comment above): the daily pair once the application has
 * session replay on and has recorded, the monthly pair once it also has a
 * Monthly budget. No context, or a field that is null or undefined,
 * withholds them - so what an unknown application is offered is exactly the
 * set every application was offered before they existed. Then an alert for
 * each of the application's own signals, once it records, whatever its kind.
 */
export function getRumAlertTemplates(
  context?: RumAlertTemplateContext | undefined,
): Array<RumAlertTemplate> {
  const templates: Array<RumAlertTemplate> = ALL_RUM_ALERT_TEMPLATES.filter(
    (template: RumAlertTemplate) => {
      return (
        isClientMet({
          clients: template.clients,
          context: context,
        }) &&
        isRequirementMet({
          requirement: template.requirement,
          context: context,
        })
      );
    },
  );

  /*
   * One alert per signal of the application's own, after the shipped ones,
   * once it records (issue #6518). Built from the context, so neither
   * getAllRumAlertTemplates nor getRumAlertTemplateById knows them: they
   * are the application's, not the catalog's. A browser app and a mobile
   * one alike: both record sessions, and a React Native app's taps report
   * signals too.
   */
  if (
    isRequirementMet({
      requirement: "SessionReplayRecording",
      context: context,
    })
  ) {
    for (const signal of readCustomSignals(context?.customSignals)) {
      templates.push(buildRumCustomSignalTemplate(signal));
    }
  }

  return templates;
}

export function getRumAlertTemplateById(
  id: string,
): RumAlertTemplate | undefined {
  return ALL_RUM_ALERT_TEMPLATES.find((template: RumAlertTemplate) => {
    return template.id === id;
  });
}
