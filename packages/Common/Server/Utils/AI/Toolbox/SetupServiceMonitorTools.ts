import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import ProjectMilestone from "../../../../Models/DatabaseModels/ProjectMilestone";
import Service from "../../../../Models/DatabaseModels/Service";
import {
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_LINES,
  AI_ACTION_TITLES,
  AIActionSentence,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import {
  AIChatCitationTargetType,
  AIToolRefusal,
} from "../../../../Types/AI/AIChatTypes";
import { AI_TOOL_CITATIONS } from "../../../../Types/AI/AIReadTableWords";
import ActivationMilestone, {
  isActivationMilestone,
} from "../../../../Types/Analytics/ActivationMilestone";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorRecommendationCreateUtil, {
  MonitorRecommendationCreatePlanItem,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";
import { MonitorRecommendation } from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationUtil from "../../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  RecommendedService,
  ServiceMonitorDefaultMissing,
  ServiceMonitorDefaults,
  TELEMETRY_RECOMMENDATION_MILESTONES,
  TELEMETRY_RECOMMENDED_TEMPLATES,
  TelemetryRecommendedTemplate,
  buildServiceMonitorArgs,
  buildServiceMonitorPlan,
  getServiceRecommendation,
  getTelemetryRecommendations,
  pickServiceMonitorDefaults,
} from "../../../../Utils/GuidedSetup/ServiceMonitorRecords";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import MonitorService from "../../../Services/MonitorService";
import MonitorStatusService from "../../../Services/MonitorStatusService";
import ProjectMilestoneService from "../../../Services/ProjectMilestoneService";
import ServiceService from "../../../Services/ServiceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { citationSentence } from "./ReadTableWords";
import { SETUP_PLAN_ORDER, readMonitorPlanRefusal } from "./SetupPlan";
import {
  ObservabilityTool,
  PreparedMutation,
  SetupActionRefusal,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import WidgetBuilder from "./WidgetBuilder";

/*
 * "SET UP MONITORING FOR THE CHECKOUT SERVICE" (#7243): the monitors the
 * telemetry guided setup recommends for a service (#6806), from a
 * sentence.
 *
 * One call for each monitor, so each is a line of the plan's card the
 * person can skip, as the guided setup's step is a list they can untick:
 * failing requests (errors), slow ones (slow_requests), unhandled
 * exceptions (exceptions) and a spike in error logs (error_logs) - each
 * offered only once the project's first data of the kind it reads has
 * arrived, as the guided setup offers them (Common's ServiceMonitorRecords).
 * Each is built with the Recommendations tab's own plan, so the monitor is
 * the one the guided setup and the tab make for the same service, and they
 * count it as covered: it opens an ALERT, for the team, never an incident
 * on a status page.
 *
 * What cannot be made is said before the card: a service that does not
 * exist or sends nothing yet, a monitor of data the project does not send
 * (it would never fire), one the service has already (the recommendation's
 * fingerprint), a project missing its statuses or severities, and room in
 * the plan for every monitor the plan sets up.
 */

/*
 * The monitors a call names, as the person says them, by the Service
 * catalog template each is (Common/Types/Monitor/ServiceAlertTemplates).
 */
export const SERVICE_MONITOR_TEMPLATES: Readonly<Record<string, string>> = {
  errors: "service-error-burst",
  slow_requests: "service-latency-p95",
  exceptions: "service-unhandled-exceptions",
  error_logs: "service-error-log-spike",
};

// The kinds of data a monitor reads, by the first-data mark of each, for the model.
const DATA_KIND_BY_MILESTONE: Readonly<Record<string, string>> = {
  [ActivationMilestone.FirstTracesReceived]: "traces",
  [ActivationMilestone.FirstMetricsReceived]: "metrics",
  [ActivationMilestone.FirstExceptionsReceived]: "exceptions",
  [ActivationMilestone.FirstLogsReceived]: "logs",
};

// The template a call names, or null.
export function readServiceMonitorTemplate(args: JSONObject): string | null {
  const word: string = (ToolArgs.getString(args, "monitor") || "")
    .trim()
    .toLowerCase();

  return SERVICE_MONITOR_TEMPLATES[word] || null;
}

// The service a call names, by its name (without case), as the person reads it.
async function findService(
  ctx: ToolContext,
  name: string,
): Promise<Service | null> {
  return await ServiceService.findOneBy({
    query: {
      projectId: ctx.projectId,
      name: QueryHelper.findWithSameText(name),
    },
    select: { _id: true, name: true, lastSeenAt: true },
    props: ctx.props,
  });
}

/*
 * The project's first data that has arrived, as the guided setup reads it
 * (TelemetrySetupApi.loadFirstDataReached); null when it cannot be read -
 * not known, so the setup's three are offered.
 */
async function readFirstDataReached(
  ctx: ToolContext,
): Promise<Array<ActivationMilestone> | null> {
  try {
    const marks: Array<ProjectMilestone> = await ProjectMilestoneService.findBy(
      {
        query: {
          projectId: ctx.projectId,
          milestone: QueryHelper.any([...TELEMETRY_RECOMMENDATION_MILESTONES]),
        } as never,
        select: { _id: true, milestone: true },
        limit: TELEMETRY_RECOMMENDATION_MILESTONES.length,
        skip: 0,
        props: ctx.props,
      },
    );

    return marks
      .map((mark: ProjectMilestone): unknown => {
        return mark.milestone;
      })
      .filter(isActivationMilestone);
  } catch {
    return null;
  }
}

/*
 * The statuses and severities a recommended monitor is built on, read as
 * the person and picked as a Recommendations tab picks them (live ones, in
 * their order).
 */
async function readServiceMonitorDefaults(
  ctx: ToolContext,
): Promise<
  | { defaults: ServiceMonitorDefaults }
  | { missing: ServiceMonitorDefaultMissing }
> {
  const [statuses, incidentSeverities, alertSeverities]: [
    Array<MonitorStatus>,
    Array<IncidentSeverity>,
    Array<AlertSeverity>,
  ] = await Promise.all([
    MonitorStatusService.findBy({
      query: { projectId: ctx.projectId, isArchived: false } as never,
      select: { _id: true, isOperationalState: true, isOfflineState: true },
      sort: { priority: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
    IncidentSeverityService.findBy({
      query: { projectId: ctx.projectId, isArchived: false },
      select: { _id: true },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
    AlertSeverityService.findBy({
      query: { projectId: ctx.projectId, isArchived: false },
      select: { _id: true },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
  ]);

  return pickServiceMonitorDefaults({
    statuses: statuses.map((status: MonitorStatus) => {
      return {
        id: status.id,
        isOperationalState: status.isOperationalState,
        isOfflineState: status.isOfflineState,
      };
    }),
    incidentSeverities: incidentSeverities.map((severity: IncidentSeverity) => {
      return { id: severity.id };
    }),
    alertSeverities: alertSeverities.map((severity: AlertSeverity) => {
      return { id: severity.id };
    }),
  });
}

/*
 * The project's monitor that covers the recommendation for the service
 * already - made by the guided setup, a Recommendations tab or this - by
 * the tab's own test (the recommendation's fingerprint), as the person
 * reads the project's monitors of its type. Null when none does.
 */
async function findCoveringMonitor(
  ctx: ToolContext,
  data: {
    recommendation: MonitorRecommendation;
    service: RecommendedService;
    defaults: ServiceMonitorDefaults;
  },
): Promise<{ id: string; name: string } | null> {
  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: {
      projectId: ctx.projectId,
      monitorType: data.recommendation.monitorType,
    },
    select: { _id: true, name: true, monitorSteps: true },
    sort: { name: SortOrder.Ascending },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: ctx.props,
  });

  const covered: Map<string, ObjectID> =
    MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
      recommendations: [data.recommendation],
      existingMonitors: monitors
        .filter((monitor: Monitor): boolean => {
          return Boolean(monitor.id);
        })
        .map((monitor: Monitor) => {
          return {
            monitorId: monitor.id!,
            monitorSteps:
              MonitorRecommendationCreateUtil.getExistingMonitorSteps([
                monitor,
              ]) as Array<MonitorStep>,
          };
        }),
      args: buildServiceMonitorArgs({
        service: data.service,
        defaults: data.defaults,
      }),
    });

  const monitorId: ObjectID | undefined = covered.get(
    data.recommendation.recommendationId,
  );

  if (!monitorId) {
    return null;
  }

  const monitor: Monitor | undefined = monitors.find(
    (each: Monitor): boolean => {
      return each.id?.toString() === monitorId.toString();
    },
  );

  return { id: monitorId.toString(), name: monitor?.name || "" };
}

// What a call would make, read before its card and again when it runs.
export interface ServiceMonitorPlan {
  service: RecommendedService;
  recommendation: MonitorRecommendation;
  monitorName: string;
}

// Why a call cannot be made, or what it would make.
export type ServiceMonitorReading =
  | { refused: SetupActionRefusal }
  | { plan: ServiceMonitorPlan; defaults: ServiceMonitorDefaults };

const NAME_THE_MONITOR: string = `Nothing proposed: name the recommended monitor - ${Object.keys(
  SERVICE_MONITOR_TEMPLATES,
).join(
  ", ",
)} - one call for each, in the same answer, so each is a line the person can skip.`;

// The words the model is told for what is missing from a project to build a monitor.
const MISSING_DEFAULT_SENTENCES: Readonly<
  Record<ServiceMonitorDefaultMissing, string>
> = {
  [ServiceMonitorDefaultMissing.OperationalStatus]:
    "This project has no operational monitor status. Add one under Monitors > Settings > Monitor Status.",
  [ServiceMonitorDefaultMissing.OfflineStatus]:
    "This project has no offline monitor status. Add one under Monitors > Settings > Monitor Status.",
  [ServiceMonitorDefaultMissing.IncidentSeverity]:
    "This project has no incident severity. Add one under Incidents > Settings > Incident Severity.",
  [ServiceMonitorDefaultMissing.AlertSeverity]:
    "This project has no alert severity. Add one under Alerts > Settings > Alert Severity.",
};

/*
 * What a call would make, or why it cannot be made - everything but the
 * plan's room, which is asked for the whole plan (readMonitorPlanRefusal).
 */
export async function readServiceMonitor(
  args: JSONObject,
  ctx: ToolContext,
): Promise<ServiceMonitorReading> {
  const templateId: string | null = readServiceMonitorTemplate(args);

  if (!templateId) {
    return { refused: { toldModel: NAME_THE_MONITOR } };
  }

  const named: string = ToolArgs.getString(args, "service") || "";
  const service: Service | null = named ? await findService(ctx, named) : null;

  if (!service?.id) {
    return {
      refused: {
        toldModel: `Nothing proposed: ${
          named
            ? `"${named}" is no service of this project that sends telemetry`
            : "no service was named"
        }. query_telemetry_resources lists the project's services by name: name one of them, or tell the person to send its logs, metrics and traces first, with the telemetry guided setup.`,
      },
    };
  }

  const serviceName: string = service.name || named;

  if (!service.lastSeenAt) {
    return {
      refused: {
        toldModel: `Nothing proposed: the service "${serviceName}" has not sent any data yet, so a monitor of it would never fire. Tell the person to send its logs, metrics and traces first, with the telemetry guided setup, and to ask again once data arrives.`,
      },
    };
  }

  const reached: Array<ActivationMilestone> | null =
    await readFirstDataReached(ctx);
  const offered: Array<MonitorRecommendation> =
    getTelemetryRecommendations(reached);
  const recommendation: MonitorRecommendation | undefined = offered.find(
    (each: MonitorRecommendation): boolean => {
      return each.templateId === templateId;
    },
  );

  if (!recommendation) {
    const reads: Array<string> = (
      TELEMETRY_RECOMMENDED_TEMPLATES.find(
        (template: TelemetryRecommendedTemplate): boolean => {
          return template.templateId === templateId;
        },
      )?.readsFirstDataOf || []
    ).map((milestone: ActivationMilestone): string => {
      return DATA_KIND_BY_MILESTONE[milestone] || milestone;
    });
    const recommended: Array<string> = offered.map(
      (each: MonitorRecommendation): string => {
        return (
          Object.keys(SERVICE_MONITOR_TEMPLATES).find(
            (word: string): boolean => {
              return SERVICE_MONITOR_TEMPLATES[word] === each.templateId;
            },
          ) || each.templateId
        );
      },
    );

    return {
      refused: {
        toldModel: `Nothing proposed: the "${getServiceRecommendation(templateId)?.name || templateId}" monitor reads ${reads.join(" or ")}, which this project has not sent yet, so it would never fire. The monitors its data feeds now: ${recommended.join(", ")}. Say so in one sentence.`,
      },
    };
  }

  const read: Awaited<ReturnType<typeof readServiceMonitorDefaults>> =
    await readServiceMonitorDefaults(ctx);

  if ("missing" in read) {
    return {
      refused: { toldModel: MISSING_DEFAULT_SENTENCES[read.missing] },
    };
  }

  const plan: ServiceMonitorPlan = {
    service: { id: service.id.toString(), name: serviceName },
    recommendation: recommendation,
    monitorName: MonitorRecommendationUtil.getMonitorName({
      recommendation: recommendation,
      resourceDisplayName: serviceName,
    }),
  };

  const covering: { id: string; name: string } | null =
    await findCoveringMonitor(ctx, {
      recommendation: recommendation,
      service: plan.service,
      defaults: read.defaults,
    });

  if (covering) {
    return {
      refused: {
        toldModel: `Nothing proposed: the monitor "${covering.name || plan.monitorName}" already watches "${serviceName}" this way, so no second one is made. Say so in one sentence, naming it.`,
      },
    };
  }

  return { plan: plan, defaults: read.defaults };
}

export const SetUpServiceMonitorTool: ObservabilityTool = {
  name: "set_up_service_monitor",
  description:
    "Create one of the monitors the telemetry guided setup recommends for a service that sends telemetry: errors (failing requests), slow_requests (p95 latency), exceptions (unhandled exceptions) or error_logs (a spike in error logs). Each opens an alert for the team, never an incident on a status page, and is the monitor the service's Recommendations tab makes. For 'monitor my checkout service' or 'alert me when the checkout service fails', call it once for each of the four, in the same answer, so each is a line of the card the person can skip: a monitor of data the project does not send, or one the service has already, is refused before the card. It always shows the person an approval card, in every mode.",
  inputSchema: {
    type: "object",
    properties: {
      service: {
        type: "string",
        description:
          "The service, by its name (query_telemetry_resources lists them).",
      },
      monitor: {
        type: "string",
        enum: Object.keys(SERVICE_MONITOR_TEMPLATES),
        description:
          "Which recommended monitor: errors, slow_requests, exceptions or error_logs.",
      },
    },
    required: ["service", "monitor"],
  },
  // Creating a monitor: Create Monitor's own permission.
  get requiredPermissions(): Array<Permission> {
    return new Monitor().getCreatePermissions();
  },
  isMutation: true,
  setupAction: { planOrder: SETUP_PLAN_ORDER.serviceMonitor },
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    const templateId: string | null = readServiceMonitorTemplate(args);
    const service: string = ToolArgs.getString(args, "service") || "";
    const recommendation: MonitorRecommendation | null = templateId
      ? getServiceRecommendation(templateId)
      : null;

    return recommendation && service
      ? aiActionSentence(AI_ACTION_TITLES.setUpServiceMonitor, {
          monitor: JSON.stringify(
            MonitorRecommendationUtil.getMonitorName({
              recommendation: recommendation,
              resourceDisplayName: service,
            }),
          ),
        })
      : aiActionSentence(AI_ACTION_TITLES.setUpServiceMonitorUnnamed);
  },
  /*
   * The service and the recommendation written out by id - what the card
   * named is what runs - and what the card says: the monitor by the name
   * it will have, and that it opens an alert for the team.
   */
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    try {
      const reading: ServiceMonitorReading = await readServiceMonitor(
        args,
        ctx,
      );

      if ("refused" in reading) {
        return { arguments: args };
      }

      return {
        arguments: {
          ...args,
          service: reading.plan.service.name,
          serviceId: reading.plan.service.id,
        },
        title: aiActionSentence(AI_ACTION_TITLES.setUpServiceMonitor, {
          monitor: JSON.stringify(reading.plan.monitorName),
        }),
        namedArguments: ["monitor"],
        description: [
          aiActionSentence(AI_ACTION_LINES.serviceMonitorOpensAlerts, {
            service: reading.plan.service.name,
          }),
        ],
        describedArguments: ["service", "serviceId"],
      };
    } catch {
      // Unreadable now: running it says why.
      return { arguments: args };
    }
  },
  checkBeforeApproval: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<SetupActionRefusal | null> => {
    try {
      const reading: ServiceMonitorReading = await readServiceMonitor(
        args,
        ctx,
      );

      if ("refused" in reading) {
        return reading.refused;
      }
    } catch {
      // Unreadable now: running it says why.
    }

    try {
      const planRefusal: string | null = await readMonitorPlanRefusal(ctx);

      if (planRefusal) {
        return {
          toldModel: `Nothing proposed: the project's plan does not allow it now. ${planRefusal} Tell the person what is needed, in these words.`,
          refusal: AIToolRefusal.Plan,
        };
      }
    } catch {
      // Unreadable now: running it says why.
    }

    return null;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    /*
     * Read again now: the service's monitor may have been made since the
     * card was shown - on its Recommendations tab, or by the guided setup.
     */
    const reading: ServiceMonitorReading = await readServiceMonitor(args, ctx);

    if ("refused" in reading) {
      throw new BadDataException(reading.refused.toldModel);
    }

    // The Recommendations tab's own monitor, for the same choices (Common).
    const plan: Array<MonitorRecommendationCreatePlanItem> =
      buildServiceMonitorPlan({
        service: reading.plan.service,
        recommendations: [reading.plan.recommendation],
        recommendationIds: [reading.plan.recommendation.recommendationId],
        defaults: reading.defaults,
      });
    const item: MonitorRecommendationCreatePlanItem | undefined = plan[0];

    if (!item) {
      throw new BadDataException(
        "The recommended monitor could not be built for this service.",
      );
    }

    item.monitor.projectId = ctx.projectId;

    // Created as the person: their permissions, the plan's limits.
    const created: Monitor = await MonitorService.create({
      data: item.monitor,
      miscDataProps: item.miscDataProps,
      props: ctx.props,
    });

    const monitorId: string = created.id!.toString();
    const monitorName: string = created.name || reading.plan.monitorName;

    return {
      dataForLlm: `Created the monitor "${monitorName}" for the service "${reading.plan.service.name}": the "${reading.plan.recommendation.name}" monitor its Recommendations tab recommends (${reading.plan.recommendation.description}). It opens an alert for the team, never an incident on a status page; who is told is the project's on-call rules for alerts, which who_is_told answers. To show customers instead, the person switches the monitor to open an incident.`,
      rowCount: 1,
      ...citationSentence(AI_TOOL_CITATIONS.setUpMonitor, {
        name: monitorName,
      }),
      citationTarget: {
        type: AIChatCitationTargetType.MonitorView,
        params: { monitorId: monitorId },
      },
      redactionCount: 0,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "Monitor set up",
        heading: monitorName,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.monitor),
          line: [aiActionSentence(AI_ACTION_CARD_LINES.opensAlertsForTeam)],
        },
        link: {
          type: AIChatCitationTargetType.MonitorView,
          params: { monitorId: monitorId },
        },
      }),
    };
  },
};
