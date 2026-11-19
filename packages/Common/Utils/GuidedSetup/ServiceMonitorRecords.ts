import ActivationMilestone from "../../Types/Analytics/ActivationMilestone";
import MonitorRecommendationCatalog from "../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationCreateUtil, {
  MonitorRecommendationCreatePlanItem,
} from "../../Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationNotificationMode,
  MonitorRecommendationResourceType,
} from "../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../Types/ObjectID";

/*
 * THE MONITORS RECOMMENDED FOR A SERVICE, ONE COPY FOR EVERY WAY IN.
 *
 * "Get alerted on my service" is set up two ways: the telemetry guided
 * setup's step in the Dashboard (#6806, Components/GuidedSetup/Telemetry)
 * and a sentence to Ask AI (#7243, Server/Utils/AI/Toolbox/
 * SetupServiceMonitorTools). Both pick the monitors here, and build them
 * with the Recommendations tab's own plan (MonitorRecommendationCreateUtil),
 * so for the same answers they make the same records:
 *
 *   - which monitors: the Service catalog's templates for the data the
 *     project's first data says arrived (#7146) - or the three the setup
 *     always offered, when that is not known;
 *   - each opens an ALERT, for the team: never an incident on a status
 *     page;
 *   - on the project's operational and offline statuses and its most severe
 *     live incident and alert severities, as a Recommendations tab reads
 *     them.
 *
 * Pure: no database, no React. The Dashboard reads and writes through the
 * model API (TelemetrySetupApi), the server through the services, as the
 * person either way.
 */

/*
 * The monitors offered, by their Service catalog template ids
 * (Common/Types/Monitor/ServiceAlertTemplates), in this order: one for
 * each thing a newcomer asks first - is it failing, is it slow, is it
 * throwing - and a spike in its error logs. Each applies to every service,
 * whatever its runtime, and reads one kind of data: a monitor of data the
 * service never sends never fires, and the team believes it is covered
 * (#7146). So each is offered once the project's first data of a kind it
 * reads has arrived (`readsFirstDataOf`, the activation milestones):
 *
 *   - Error Burst counts error spans: traces;
 *   - High Request Latency reads http.server.request.duration: metrics;
 *   - Unhandled Exceptions counts exceptions, which come with traces and
 *     with logs;
 *   - Error Log Spike counts error logs: logs.
 *
 * The project's first data stands for the service's: a new project's first
 * service is the only one that sent anything, and a busy project, which has
 * every kind, is offered all four, as before. A project whose first data is
 * not known (none kept, or the read failed) is offered the three the setup
 * always offered.
 */
export interface TelemetryRecommendedTemplate {
  templateId: string;
  readsFirstDataOf: ReadonlyArray<ActivationMilestone>;
}

export const TELEMETRY_RECOMMENDED_TEMPLATES: ReadonlyArray<TelemetryRecommendedTemplate> =
  [
    {
      templateId: "service-error-burst",
      readsFirstDataOf: [ActivationMilestone.FirstTracesReceived],
    },
    {
      templateId: "service-latency-p95",
      readsFirstDataOf: [ActivationMilestone.FirstMetricsReceived],
    },
    {
      templateId: "service-unhandled-exceptions",
      readsFirstDataOf: [
        ActivationMilestone.FirstExceptionsReceived,
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstLogsReceived,
      ],
    },
    {
      templateId: "service-error-log-spike",
      readsFirstDataOf: [ActivationMilestone.FirstLogsReceived],
    },
  ];

// What a project whose first data is not known is offered.
export const TELEMETRY_RECOMMENDED_TEMPLATE_IDS: ReadonlyArray<string> = [
  "service-error-burst",
  "service-latency-p95",
  "service-unhandled-exceptions",
];

// The first-data marks the offer is read from, each once.
export const TELEMETRY_RECOMMENDATION_MILESTONES: ReadonlyArray<ActivationMilestone> =
  Array.from(
    new Set<ActivationMilestone>(
      TELEMETRY_RECOMMENDED_TEMPLATES.flatMap(
        (
          template: TelemetryRecommendedTemplate,
        ): ReadonlyArray<ActivationMilestone> => {
          return template.readsFirstDataOf;
        },
      ),
    ),
  );

/*
 * The template ids offered, in the setup's order, for the project's first
 * data (null: not known).
 */
export const getTelemetryRecommendedTemplateIds: (
  reached: ReadonlyArray<ActivationMilestone> | null | undefined,
) => Array<string> = (
  reached: ReadonlyArray<ActivationMilestone> | null | undefined,
): Array<string> => {
  const offered: Array<string> = TELEMETRY_RECOMMENDED_TEMPLATES.filter(
    (template: TelemetryRecommendedTemplate): boolean => {
      return template.readsFirstDataOf.some(
        (milestone: ActivationMilestone): boolean => {
          return (reached || []).includes(milestone);
        },
      );
    },
  ).map((template: TelemetryRecommendedTemplate): string => {
    return template.templateId;
  });

  return offered.length > 0 ? offered : [...TELEMETRY_RECOMMENDED_TEMPLATE_IDS];
};

/*
 * The recommended monitors, from the Service catalog, in the setup's order:
 * the ones for the data the project's first data says arrived (#7146), or
 * the setup's three when that is not known (getTelemetryRecommendedTemplateIds).
 */
export const getTelemetryRecommendations: (
  reached?: ReadonlyArray<ActivationMilestone> | null | undefined,
) => Array<MonitorRecommendation> = (
  reached?: ReadonlyArray<ActivationMilestone> | null | undefined,
): Array<MonitorRecommendation> => {
  const all: Array<MonitorRecommendation> =
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.Service,
    );

  return getTelemetryRecommendedTemplateIds(reached)
    .map((templateId: string): MonitorRecommendation | undefined => {
      return all.find((recommendation: MonitorRecommendation): boolean => {
        return recommendation.templateId === templateId;
      });
    })
    .filter(
      (
        recommendation: MonitorRecommendation | undefined,
      ): recommendation is MonitorRecommendation => {
        return Boolean(recommendation);
      },
    );
};

// The Service catalog's recommendation of a template, offered or not.
export const getServiceRecommendation: (
  templateId: string,
) => MonitorRecommendation | null = (
  templateId: string,
): MonitorRecommendation | null => {
  return (
    MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.Service,
    ).find((recommendation: MonitorRecommendation): boolean => {
      return recommendation.templateId === templateId;
    }) || null
  );
};

// The ids every recommended monitor's step is built with.
export interface ServiceMonitorDefaults {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
}

// What is missing for a recommended monitor to be built in a project.
export enum ServiceMonitorDefaultMissing {
  OperationalStatus = "OperationalStatus",
  OfflineStatus = "OfflineStatus",
  IncidentSeverity = "IncidentSeverity",
  AlertSeverity = "AlertSeverity",
}

/*
 * The defaults from the project's statuses (in their priority order) and
 * live severities (in their order), as a Recommendations tab picks them
 * (loadMonitorRecommendationProjectSetup): the first operational and the
 * first offline status, the first incident and alert severity. What is
 * missing, when one is.
 */
export const pickServiceMonitorDefaults: (data: {
  statuses: ReadonlyArray<{
    id?: ObjectID | null | undefined;
    isOperationalState?: boolean | undefined;
    isOfflineState?: boolean | undefined;
  }>;
  incidentSeverities: ReadonlyArray<{ id?: ObjectID | null | undefined }>;
  alertSeverities: ReadonlyArray<{ id?: ObjectID | null | undefined }>;
}) =>
  | { defaults: ServiceMonitorDefaults }
  | { missing: ServiceMonitorDefaultMissing } = (data: {
  statuses: ReadonlyArray<{
    id?: ObjectID | null | undefined;
    isOperationalState?: boolean | undefined;
    isOfflineState?: boolean | undefined;
  }>;
  incidentSeverities: ReadonlyArray<{ id?: ObjectID | null | undefined }>;
  alertSeverities: ReadonlyArray<{ id?: ObjectID | null | undefined }>;
}):
  | { defaults: ServiceMonitorDefaults }
  | { missing: ServiceMonitorDefaultMissing } => {
  const online: ObjectID | null | undefined = data.statuses.find(
    (status: { isOperationalState?: boolean | undefined }): boolean => {
      return Boolean(status.isOperationalState);
    },
  )?.id;
  const offline: ObjectID | null | undefined = data.statuses.find(
    (status: { isOfflineState?: boolean | undefined }): boolean => {
      return Boolean(status.isOfflineState);
    },
  )?.id;
  const incidentSeverity: ObjectID | null | undefined =
    data.incidentSeverities[0]?.id;
  const alertSeverity: ObjectID | null | undefined =
    data.alertSeverities[0]?.id;

  if (!online) {
    return { missing: ServiceMonitorDefaultMissing.OperationalStatus };
  }

  if (!offline) {
    return { missing: ServiceMonitorDefaultMissing.OfflineStatus };
  }

  if (!incidentSeverity) {
    return { missing: ServiceMonitorDefaultMissing.IncidentSeverity };
  }

  if (!alertSeverity) {
    return { missing: ServiceMonitorDefaultMissing.AlertSeverity };
  }

  return {
    defaults: {
      onlineMonitorStatusId: new ObjectID(online.toString()),
      offlineMonitorStatusId: new ObjectID(offline.toString()),
      defaultMonitorStatusId: new ObjectID(online.toString()),
      defaultIncidentSeverityId: new ObjectID(incidentSeverity.toString()),
      defaultAlertSeverityId: new ObjectID(alertSeverity.toString()),
    },
  };
};

// The service a monitor is recommended for: its id and its name.
export interface RecommendedService {
  id: string;
  name: string;
}

// What every recommended monitor of the service is built with.
export const buildServiceMonitorArgs: (data: {
  service: RecommendedService;
  defaults: ServiceMonitorDefaults;
}) => MonitorRecommendationArgs = (data: {
  service: RecommendedService;
  defaults: ServiceMonitorDefaults;
}): MonitorRecommendationArgs => {
  return {
    resourceIdentifier: data.service.id,
    onlineMonitorStatusId: data.defaults.onlineMonitorStatusId,
    offlineMonitorStatusId: data.defaults.offlineMonitorStatusId,
    defaultIncidentSeverityId: data.defaults.defaultIncidentSeverityId,
    defaultAlertSeverityId: data.defaults.defaultAlertSeverityId,
    monitorName: data.service.name,
  };
};

/*
 * The monitors picked, as the Recommendations tab makes them, each opening
 * an alert (not an incident): for the team, never on a status page.
 */
export const buildServiceMonitorPlan: (data: {
  service: RecommendedService;
  recommendations: Array<MonitorRecommendation>;
  recommendationIds: Array<string>;
  defaults: ServiceMonitorDefaults;
}) => Array<MonitorRecommendationCreatePlanItem> = (data: {
  service: RecommendedService;
  recommendations: Array<MonitorRecommendation>;
  recommendationIds: Array<string>;
  defaults: ServiceMonitorDefaults;
}): Array<MonitorRecommendationCreatePlanItem> => {
  return MonitorRecommendationCreateUtil.buildCreatePlan({
    recommendations: data.recommendations,
    selectedRecommendationIds: data.recommendationIds,
    args: buildServiceMonitorArgs({
      service: data.service,
      defaults: data.defaults,
    }),
    resourceDisplayName: data.service.name,
    defaultMonitorStatusId: data.defaults.defaultMonitorStatusId,
    notificationSettings: {
      notificationMode: MonitorRecommendationNotificationMode.Alert,
    },
  });
};
