import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Route from "Common/Types/API/Route";
import AIChatPageContextType, {
  AIChatPageContext,
} from "Common/Types/AI/AIChatPageContext";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * Detects what the user is looking at in the dashboard so Ask AI can offer
 * "ask about this incident"-style context: a chip in the composer, contextual
 * suggested questions, and a hint the server folds into the system prompt.
 */

export interface DashboardPageContext extends AIChatPageContext {
  // Lower-case noun for UI copy — "incident", "monitor", "the logs explorer".
  noun: string;
  // Short label for the composer chip — "This incident", "Logs explorer".
  chipLabel: string;
  icon: IconProp;
  // True when the context points at one specific record (has an entityId).
  isEntity: boolean;
}

export interface SuggestedQuestion {
  icon: IconProp;
  title: string;
  question: string;
}

// OpenTelemetry trace ids are hex (not OneUptime UUIDs).
const TRACE_ID_REGEX: RegExp = /^[0-9a-fA-F]{8,64}$/;

interface EntityPageRule {
  pageMapKey: PageMap;
  type: AIChatPageContextType;
  noun: string;
  chipLabel: string;
  icon: IconProp;
  isValidId: (id: string) => boolean;
}

interface AreaPageRule {
  // Matched with isStartWith against this base route (subpages included).
  baseRoute: Route | undefined;
  type: AIChatPageContextType;
  noun: string;
  chipLabel: string;
  icon: IconProp;
}

const isUuid: (id: string) => boolean = (id: string): boolean => {
  return ObjectID.isValidUUID(id);
};

/*
 * Entity pages are checked first, most specific wins. The id extracted from
 * the URL is validated (UUID / hex) so static sibling pages that also match
 * the `:id` wildcard — e.g. /monitors/inoperational — fall through to the
 * area rules instead of being mistaken for an entity.
 */
const entityPageRules: Array<EntityPageRule> = [
  {
    pageMapKey: PageMap.INCIDENT_VIEW,
    type: AIChatPageContextType.Incident,
    noun: "incident",
    chipLabel: "This incident",
    icon: IconProp.Alert,
    isValidId: isUuid,
  },
  {
    pageMapKey: PageMap.ALERT_VIEW,
    type: AIChatPageContextType.Alert,
    noun: "alert",
    chipLabel: "This alert",
    icon: IconProp.ExclaimationCircle,
    isValidId: isUuid,
  },
  {
    pageMapKey: PageMap.MONITOR_VIEW,
    type: AIChatPageContextType.Monitor,
    noun: "monitor",
    chipLabel: "This monitor",
    icon: IconProp.AltGlobe,
    isValidId: isUuid,
  },
  {
    pageMapKey: PageMap.SCHEDULED_MAINTENANCE_VIEW,
    type: AIChatPageContextType.ScheduledMaintenanceEvent,
    noun: "maintenance event",
    chipLabel: "This maintenance event",
    icon: IconProp.Clock,
    isValidId: isUuid,
  },
  {
    pageMapKey: PageMap.SERVICE_VIEW,
    type: AIChatPageContextType.TelemetryService,
    noun: "service",
    chipLabel: "This service",
    icon: IconProp.SquareStack,
    isValidId: isUuid,
  },
  {
    pageMapKey: PageMap.TRACE_VIEW,
    type: AIChatPageContextType.Trace,
    noun: "trace",
    chipLabel: "This trace",
    icon: IconProp.Waterfall,
    isValidId: (id: string) => {
      return TRACE_ID_REGEX.test(id);
    },
  },
  {
    pageMapKey: PageMap.EXCEPTIONS_VIEW,
    type: AIChatPageContextType.Exception,
    noun: "exception",
    chipLabel: "This exception",
    icon: IconProp.Bug,
    isValidId: isUuid,
  },
];

const areaPageRules: Array<AreaPageRule> = [
  {
    baseRoute: RouteMap[PageMap.INCIDENTS],
    type: AIChatPageContextType.IncidentsList,
    noun: "incidents",
    chipLabel: "Incidents",
    icon: IconProp.Alert,
  },
  {
    baseRoute: RouteMap[PageMap.ALERTS],
    type: AIChatPageContextType.AlertsList,
    noun: "alerts",
    chipLabel: "Alerts",
    icon: IconProp.ExclaimationCircle,
  },
  {
    baseRoute: RouteMap[PageMap.MONITORS],
    type: AIChatPageContextType.MonitorsList,
    noun: "monitors",
    chipLabel: "Monitors",
    icon: IconProp.AltGlobe,
  },
  {
    baseRoute: RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS],
    type: AIChatPageContextType.ScheduledMaintenanceList,
    noun: "scheduled maintenance",
    chipLabel: "Scheduled maintenance",
    icon: IconProp.Clock,
  },
  {
    baseRoute: RouteMap[PageMap.LOGS],
    type: AIChatPageContextType.LogsExplorer,
    noun: "logs",
    chipLabel: "Logs",
    icon: IconProp.Logs,
  },
  {
    baseRoute: RouteMap[PageMap.TRACES],
    type: AIChatPageContextType.TracesExplorer,
    noun: "traces",
    chipLabel: "Traces",
    icon: IconProp.Waterfall,
  },
  {
    baseRoute: RouteMap[PageMap.METRICS],
    type: AIChatPageContextType.MetricsExplorer,
    noun: "metrics",
    chipLabel: "Metrics",
    icon: IconProp.Heartbeat,
  },
  {
    /*
     * The exceptions area has no plain base entry in RouteMap (EXCEPTIONS
     * points at /exceptions/overview and EXCEPTIONS_ROOT is a `/*` wildcard
     * that segment-matching cannot use), so build the base route here.
     */
    baseRoute: new Route(`/dashboard/${RouteParams.ProjectID}/exceptions`),
    type: AIChatPageContextType.ExceptionsList,
    noun: "exceptions",
    chipLabel: "Exceptions",
    icon: IconProp.Bug,
  },
];

export default class PageContextUtil {
  /*
   * Best-effort: never throws — a page we cannot classify simply yields no
   * context and Ask AI behaves exactly as before.
   */
  public static detectPageContext(): DashboardPageContext | null {
    try {
      for (const rule of entityPageRules) {
        const route: Route | undefined = RouteMap[rule.pageMapKey];

        if (!route || !Navigation.isStartWith(route)) {
          continue;
        }

        const entityId: string | null = Navigation.getParamByName(
          RouteParams.ModelID,
          route,
        );

        if (!entityId || !rule.isValidId(entityId)) {
          continue;
        }

        return {
          type: rule.type,
          entityId: entityId,
          noun: rule.noun,
          chipLabel: rule.chipLabel,
          icon: rule.icon,
          isEntity: true,
        };
      }

      for (const rule of areaPageRules) {
        if (!rule.baseRoute || !Navigation.isStartWith(rule.baseRoute)) {
          continue;
        }

        return {
          type: rule.type,
          noun: rule.noun,
          chipLabel: rule.chipLabel,
          icon: rule.icon,
          isEntity: false,
        };
      }
    } catch {
      // Detection is a nice-to-have; fall through to "no context".
    }

    return null;
  }

  /*
   * Resolve the on-screen entity's display title (incident title, monitor
   * name, …) for the chip and the prompt. Returns null when the entity type
   * has no title, the record is gone, or the user cannot read it.
   */
  public static async resolveEntityTitle(
    context: DashboardPageContext,
  ): Promise<string | null> {
    if (!context.entityId || !ObjectID.isValidUUID(context.entityId)) {
      return null;
    }

    const id: ObjectID = new ObjectID(context.entityId);

    try {
      switch (context.type) {
        case AIChatPageContextType.Incident: {
          const item: Incident | null = await ModelAPI.getItem<Incident>({
            modelType: Incident,
            id: id,
            select: { title: true, incidentNumber: true },
          });
          if (!item) {
            return null;
          }
          const numberPart: string = item.incidentNumber
            ? `#${item.incidentNumber} `
            : "";
          return item.title ? `${numberPart}${item.title}` : null;
        }
        case AIChatPageContextType.Alert: {
          const item: Alert | null = await ModelAPI.getItem<Alert>({
            modelType: Alert,
            id: id,
            select: { title: true, alertNumber: true },
          });
          if (!item) {
            return null;
          }
          const numberPart: string = item.alertNumber
            ? `#${item.alertNumber} `
            : "";
          return item.title ? `${numberPart}${item.title}` : null;
        }
        case AIChatPageContextType.Monitor: {
          const item: Monitor | null = await ModelAPI.getItem<Monitor>({
            modelType: Monitor,
            id: id,
            select: { name: true },
          });
          return item?.name || null;
        }
        case AIChatPageContextType.ScheduledMaintenanceEvent: {
          const item: ScheduledMaintenance | null =
            await ModelAPI.getItem<ScheduledMaintenance>({
              modelType: ScheduledMaintenance,
              id: id,
              select: { title: true },
            });
          return item?.title || null;
        }
        case AIChatPageContextType.TelemetryService: {
          const item: Service | null = await ModelAPI.getItem<Service>({
            modelType: Service,
            id: id,
            select: { name: true },
          });
          return item?.name || null;
        }
        case AIChatPageContextType.Exception: {
          const item: TelemetryException | null =
            await ModelAPI.getItem<TelemetryException>({
              modelType: TelemetryException,
              id: id,
              select: { message: true, exceptionType: true },
            });
          return item?.message || item?.exceptionType || null;
        }
        default:
          return null;
      }
    } catch {
      // No read access / record deleted — the generic chip label is used.
      return null;
    }
  }

  // The wire shape for POST /ai-chat/send-message.
  public static toRequestPayload(context: DashboardPageContext): JSONObject {
    return {
      type: context.type,
      ...(context.entityId ? { entityId: context.entityId } : {}),
      ...(context.entityTitle ? { entityTitle: context.entityTitle } : {}),
    };
  }

  // Contextual suggested questions for the chat home view.
  public static getSuggestions(
    context: DashboardPageContext,
  ): Array<SuggestedQuestion> {
    switch (context.type) {
      case AIChatPageContextType.Incident:
        return [
          {
            icon: IconProp.Document,
            title: "Summarize",
            question:
              "Summarize this incident: what happened, its current state, and the impact.",
          },
          {
            icon: IconProp.Search,
            title: "Find root cause",
            question:
              "Investigate the likely root cause of this incident using logs, traces and metrics from around when it started.",
          },
          {
            icon: IconProp.Clock,
            title: "What changed?",
            question:
              "What changed around the time this incident started — new exceptions, monitor status changes or deployments?",
          },
          {
            icon: IconProp.Announcement,
            title: "Draft status update",
            question:
              "Draft a clear public status update for this incident based on what we know so far.",
          },
        ];
      case AIChatPageContextType.Alert:
        return [
          {
            icon: IconProp.Document,
            title: "Summarize",
            question: "Summarize this alert and its current state.",
          },
          {
            icon: IconProp.Search,
            title: "Investigate",
            question:
              "Investigate what triggered this alert — check related logs, traces and metrics around when it fired.",
          },
          {
            icon: IconProp.Alert,
            title: "Is this an outage?",
            question:
              "Assess the impact of this alert. If it looks like a real outage, create an incident for it.",
          },
          {
            icon: IconProp.Clock,
            title: "What changed?",
            question:
              "What changed recently that could explain this alert firing?",
          },
        ];
      case AIChatPageContextType.Monitor:
        return [
          {
            icon: IconProp.Document,
            title: "Status summary",
            question:
              "Summarize this monitor's current status and its recent status timeline.",
          },
          {
            icon: IconProp.Search,
            title: "Last status change",
            question:
              "Why did this monitor last change status? Investigate the telemetry around that time.",
          },
          {
            icon: IconProp.Activity,
            title: "Is it flapping?",
            question:
              "Is this monitor flapping? Analyze its status changes over the last 7 days.",
          },
          {
            icon: IconProp.Alert,
            title: "Related incidents",
            question:
              "Which incidents and alerts are connected to this monitor?",
          },
        ];
      case AIChatPageContextType.ScheduledMaintenanceEvent:
        return [
          {
            icon: IconProp.Document,
            title: "Summarize",
            question: "Summarize this scheduled maintenance event.",
          },
          {
            icon: IconProp.Activity,
            title: "Impact during window",
            question:
              "What changed in our telemetry during this maintenance window — errors, monitor status changes or anomalies?",
          },
          {
            icon: IconProp.AltGlobe,
            title: "Monitor status",
            question:
              "Did any monitors change status during this maintenance window?",
          },
          {
            icon: IconProp.Clock,
            title: "Recent changes",
            question:
              "Show recent changes across the project around this maintenance window.",
          },
        ];
      case AIChatPageContextType.TelemetryService:
        return [
          {
            icon: IconProp.Activity,
            title: "Health overview",
            question:
              "Give me a health overview of this service — errors, latency and log volume over the last 24 hours.",
          },
          {
            icon: IconProp.ChartBar,
            title: "Slowest endpoints",
            question:
              "What are this service's slowest endpoints right now? Chart their p95 latency.",
          },
          {
            icon: IconProp.Logs,
            title: "Error logs",
            question:
              "Show this service's error log volume over the last 6 hours, and the most common error messages.",
          },
          {
            icon: IconProp.Heartbeat,
            title: "Anomalies",
            question:
              "Are any of this service's key metrics behaving abnormally compared to their baseline?",
          },
        ];
      case AIChatPageContextType.Trace:
        return [
          {
            icon: IconProp.Waterfall,
            title: "Walk me through it",
            question:
              "Walk me through this trace — where is the time going, and which spans dominate?",
          },
          {
            icon: IconProp.Error,
            title: "Errors in trace",
            question:
              "Are there errors or exceptions in this trace? Explain what failed.",
          },
          {
            icon: IconProp.Logs,
            title: "Trace logs",
            question: "Show me the logs that belong to this trace.",
          },
          {
            icon: IconProp.ChartBar,
            title: "Slower than normal?",
            question:
              "Is this trace slower than normal for this operation? Compare it against recent latency for the same endpoint.",
          },
        ];
      case AIChatPageContextType.Exception:
        return [
          {
            icon: IconProp.Document,
            title: "Explain it",
            question: "Explain this exception and its likely cause.",
          },
          {
            icon: IconProp.Code,
            title: "Find the code",
            question:
              "Find the code that throws this exception and explain the bug.",
          },
          {
            icon: IconProp.ChartBar,
            title: "How often?",
            question:
              "How often does this exception occur, and is it trending up?",
          },
          {
            icon: IconProp.Wrench,
            title: "Propose a fix",
            question:
              "Propose a code fix for this exception as a draft pull request.",
          },
        ];
      case AIChatPageContextType.IncidentsList:
        return [
          {
            icon: IconProp.Alert,
            title: "Active incidents",
            question:
              "Which incidents are currently active or unresolved, and what state is each in?",
          },
          {
            icon: IconProp.ChartBar,
            title: "This week",
            question:
              "Summarize incident activity over the last 7 days — how many, how severe, how long to resolve.",
          },
          {
            icon: IconProp.Search,
            title: "Common causes",
            question:
              "What are the most common root causes across recent incidents?",
          },
          {
            icon: IconProp.Clock,
            title: "What changed?",
            question:
              "What changed across the project in the last 24 hours — new exceptions, monitor status changes or maintenance?",
          },
        ];
      case AIChatPageContextType.AlertsList:
        return [
          {
            icon: IconProp.ExclaimationCircle,
            title: "Open alerts",
            question:
              "Which alerts are currently open, and which look most urgent?",
          },
          {
            icon: IconProp.ChartBar,
            title: "Last 24 hours",
            question: "Summarize alert activity over the last 24 hours.",
          },
          {
            icon: IconProp.Search,
            title: "Noisiest source",
            question:
              "Which monitor or source is generating the most alerts recently?",
          },
          {
            icon: IconProp.Alert,
            title: "Needs an incident?",
            question:
              "Do any current alerts look like a real outage that deserves an incident?",
          },
        ];
      case AIChatPageContextType.MonitorsList:
        return [
          {
            icon: IconProp.AltGlobe,
            title: "Unhealthy monitors",
            question:
              "Which monitors are not operational right now, and since when?",
          },
          {
            icon: IconProp.Activity,
            title: "Flapping monitors",
            question:
              "Are any monitors flapping — changing status repeatedly over the last few days?",
          },
          {
            icon: IconProp.ChartBar,
            title: "Uptime summary",
            question:
              "Summarize the recent status history of our most important monitors.",
          },
          {
            icon: IconProp.Clock,
            title: "Recent status changes",
            question: "Which monitors changed status in the last 24 hours?",
          },
        ];
      case AIChatPageContextType.ScheduledMaintenanceList:
        return [
          {
            icon: IconProp.Clock,
            title: "Upcoming windows",
            question:
              "What scheduled maintenance is coming up or currently ongoing?",
          },
          {
            icon: IconProp.Activity,
            title: "Recent impact",
            question:
              "Did recent maintenance windows correlate with errors or monitor status changes?",
          },
          {
            icon: IconProp.ChartBar,
            title: "Error volume",
            question:
              "Show error log volume over the last 24 hours by severity.",
          },
          {
            icon: IconProp.Search,
            title: "Recent changes",
            question: "What changed across the project in the last 48 hours?",
          },
        ];
      case AIChatPageContextType.LogsExplorer:
        return [
          {
            icon: IconProp.ChartBar,
            title: "Error volume",
            question:
              "Show me error log volume over the last 6 hours by severity.",
          },
          {
            icon: IconProp.Search,
            title: "Common errors",
            question:
              "What are the most common error messages in the last hour?",
          },
          {
            icon: IconProp.Logs,
            title: "Noisiest service",
            question:
              "Which service is producing the most error logs right now?",
          },
          {
            icon: IconProp.Activity,
            title: "Anything unusual?",
            question:
              "Is the current log volume unusual compared to earlier today?",
          },
        ];
      case AIChatPageContextType.TracesExplorer:
        return [
          {
            icon: IconProp.ChartBar,
            title: "Slowest endpoints",
            question:
              "Chart the p95 latency of my slowest endpoints over the last 24 hours.",
          },
          {
            icon: IconProp.Error,
            title: "Highest error rate",
            question:
              "Which operations have the highest error rate in the last 6 hours?",
          },
          {
            icon: IconProp.Waterfall,
            title: "Latency outliers",
            question:
              "Find the slowest traces in the last hour and explain where the time goes.",
          },
          {
            icon: IconProp.Activity,
            title: "Latency trend",
            question:
              "Is overall latency trending up or down over the last 24 hours?",
          },
        ];
      case AIChatPageContextType.MetricsExplorer:
        return [
          {
            icon: IconProp.Search,
            title: "What can I chart?",
            question:
              "What metrics are available in this project? List the most useful ones.",
          },
          {
            icon: IconProp.ChartBar,
            title: "CPU & memory",
            question:
              "Chart CPU and memory usage over the last 24 hours for my services.",
          },
          {
            icon: IconProp.Heartbeat,
            title: "Anomalies",
            question:
              "Are any key metrics behaving abnormally compared to their baseline right now?",
          },
          {
            icon: IconProp.Activity,
            title: "Request rate",
            question: "Chart the request rate over the last 24 hours.",
          },
        ];
      case AIChatPageContextType.ExceptionsList:
        return [
          {
            icon: IconProp.Bug,
            title: "Top exceptions",
            question: "What are the top exceptions this week?",
          },
          {
            icon: IconProp.Clock,
            title: "New today",
            question: "Which exceptions appeared for the first time today?",
          },
          {
            icon: IconProp.ChartBar,
            title: "Trending up",
            question:
              "Which exceptions are occurring more often than last week?",
          },
          {
            icon: IconProp.Code,
            title: "Worst offender",
            question:
              "Take the most frequent unresolved exception, find the code that throws it, and explain the bug.",
          },
        ];
      default:
        return [];
    }
  }
}
