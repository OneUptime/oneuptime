import Alert from "../../../../Models/DatabaseModels/Alert";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import {
  AIRunEventResultSummary,
  LinkedInfrastructureActivity,
} from "../../../../Types/AI/AIChatTypes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import PromptText from "../../../../Utils/AI/PromptText";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
import IncidentService from "../../../Services/IncidentService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import LinkedAffectedResources, {
  LINKED_AFFECTED_RESOURCE_RELATIONS,
  LinkedAffectedResource,
  LinkedAffectedResourceRelation,
  LinkedAffectedResourceType,
} from "../../AffectedResources/LinkedAffectedResources";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE - the infrastructure an incident or alert is linked to, and the
 * alerts on it, for the investigation's starting context (issue #4786).
 *
 * A synthetic monitor that fails because the host behind the site is out of
 * CPU opens an incident about the site. The host's own alert - "High CPU on
 * web-1" - is the cause, but nothing pointed the investigation at it: the
 * context named the failing monitor, and the investigation looked at other
 * monitors and project-wide numbers. When a person wrote "check the alerts on
 * host A" into the incident, the next run found the cause at once.
 *
 * So the context now names the infrastructure the subject is linked to - the
 * hosts, Docker and Podman hosts, clusters, databases and services on its
 * Affected Resources card, which its monitors' Linked Resources and
 * configuration put there - with the IDs the investigation tools take, and
 * lists the alerts on those resources that opened from
 * RELATED_ALERTS_LOOKBACK_MINUTES before the subject until now, or are still
 * open, newest first, at most MAX_RELATED_ALERTS.
 *
 * What it never lists:
 *   - a resource or an alert of another project: every read is held to the
 *     subject's project, and LinkedAffectedResources drops a related row of
 *     another project;
 *   - a private alert: its title would reach the subject's report, which
 *     everyone who can see the subject reads;
 *   - for an alert subject, the alert itself.
 */

// How far before the subject an alert on its infrastructure counts.
export const RELATED_ALERTS_LOOKBACK_MINUTES: number = 30;

// The most alerts the context lists.
export const MAX_RELATED_ALERTS: number = 10;

// The most linked resources the context names (and reads alerts for).
export const MAX_LINKED_RESOURCES: number = 10;

/*
 * The kinds of linked resource that are infrastructure, in display order,
 * with the resource type the investigation tools take for each (none for a
 * service: the telemetry tools take a service's ID as serviceId/entityId).
 */
export const LINKED_INFRASTRUCTURE_KINDS: ReadonlyArray<{
  type: LinkedAffectedResourceType;
  aiResourceType?: AIResourceType | undefined;
  noun: string;
}> = [
  {
    type: LinkedAffectedResourceType.Host,
    aiResourceType: AIResourceType.Host,
    noun: "Host",
  },
  {
    type: LinkedAffectedResourceType.NetworkDevice,
    aiResourceType: AIResourceType.NetworkDevice,
    noun: "Network device",
  },
  {
    type: LinkedAffectedResourceType.DockerHost,
    aiResourceType: AIResourceType.DockerHost,
    noun: "Docker host",
  },
  {
    type: LinkedAffectedResourceType.PodmanHost,
    aiResourceType: AIResourceType.PodmanHost,
    noun: "Podman host",
  },
  {
    type: LinkedAffectedResourceType.KubernetesCluster,
    aiResourceType: AIResourceType.KubernetesCluster,
    noun: "Kubernetes cluster",
  },
  {
    type: LinkedAffectedResourceType.DockerSwarmCluster,
    aiResourceType: AIResourceType.DockerSwarmCluster,
    noun: "Docker Swarm cluster",
  },
  {
    type: LinkedAffectedResourceType.ProxmoxCluster,
    aiResourceType: AIResourceType.ProxmoxCluster,
    noun: "Proxmox cluster",
  },
  {
    type: LinkedAffectedResourceType.VMwareVCenter,
    aiResourceType: AIResourceType.VMwareVCenter,
    noun: "VMware vCenter",
  },
  {
    type: LinkedAffectedResourceType.CephCluster,
    aiResourceType: AIResourceType.CephCluster,
    noun: "Ceph cluster",
  },
  {
    type: LinkedAffectedResourceType.StorageArray,
    aiResourceType: AIResourceType.StorageArray,
    noun: "Storage array",
  },
  {
    type: LinkedAffectedResourceType.IoTFleet,
    aiResourceType: AIResourceType.IoTFleet,
    noun: "IoT fleet",
  },
  {
    type: LinkedAffectedResourceType.DatabaseServer,
    aiResourceType: AIResourceType.DatabaseServer,
    noun: "Database",
  },
  {
    type: LinkedAffectedResourceType.CloudResource,
    aiResourceType: AIResourceType.CloudResource,
    noun: "Cloud resource",
  },
  {
    type: LinkedAffectedResourceType.Service,
    noun: "Service",
  },
];

// One resource the subject is linked to.
export interface LinkedInfrastructureResource {
  type: LinkedAffectedResourceType;
  id: string;
  name: string;
}

// One alert on the linked infrastructure.
export interface RelatedAlert {
  id: string;
  alertNumber?: number | undefined;
  alertNumberWithPrefix?: string | undefined;
  title: string;
  severityName?: string | undefined;
  stateName?: string | undefined;
  isOpen: boolean;
  openedAt: Date;
  // The linked resources it is on.
  resources: Array<LinkedInfrastructureResource>;
  rootCause?: string | undefined;
  monitorName?: string | undefined;
}

export interface LinkedInfrastructure {
  subjectKind: "incident" | "alert";
  subjectCreatedAt: Date;
  resources: Array<LinkedInfrastructureResource>;
  // Newest first, at most MAX_RELATED_ALERTS.
  alerts: Array<RelatedAlert>;
  // True when more alerts matched than are listed.
  hasMoreAlerts: boolean;
  // RELATED_ALERTS_LOOKBACK_MINUTES before the subject.
  windowStart: Date;
  // When the alerts were read: the window's end.
  readAt: Date;
}

// The noun a kind of linked resource is called by.
export function describeLinkedResourceKind(
  type: LinkedAffectedResourceType,
): string {
  return (
    LINKED_INFRASTRUCTURE_KINDS.find(
      (kind: { type: LinkedAffectedResourceType }): boolean => {
        return kind.type === type;
      },
    )?.noun || "Resource"
  );
}

// 'Host "web-1"' - how a linked resource is named in the context.
export function describeLinkedResource(
  resource: LinkedInfrastructureResource,
): string {
  const noun: string = describeLinkedResourceKind(resource.type);
  const name: string = resource.name.trim();

  return name ? `${noun} ${JSON.stringify(name)}` : noun;
}

// "Alert #12" or "Alert ALT-12" - "alert #12" in the middle of a sentence.
export function describeAlertNumber(
  alert: {
    alertNumber?: number | undefined;
    alertNumberWithPrefix?: string | undefined;
  },
  options?: { midSentence?: boolean | undefined },
): string {
  const word: string = options?.midSentence ? "alert" : "Alert";

  if (alert.alertNumberWithPrefix) {
    return `${word} ${alert.alertNumberWithPrefix}`;
  }

  if (alert.alertNumber !== undefined) {
    return `${word} #${alert.alertNumber}`;
  }

  return options?.midSentence ? "an alert" : "An alert";
}

/*
 * "3 minutes after this incident was declared", "within a minute of this
 * incident being declared" - when an alert opened, for a report's reader.
 */
export function describeOpenedAfterDeclared(data: {
  openedAt: Date;
  incidentCreatedAt: Date;
}): string {
  const minutes: number = Math.round(
    Math.max(0, data.openedAt.getTime() - data.incidentCreatedAt.getTime()) /
      60000,
  );

  if (minutes === 0) {
    return "within a minute of this incident being declared";
  }

  return `${minutes} minute${minutes === 1 ? "" : "s"} after this incident was declared`;
}

/*
 * "3 minutes after this incident", "4 minutes before this incident", "at
 * the same time as this incident" - a time next to the subject's, in words.
 */
export function describeRelativeTime(data: {
  time: Date;
  subjectCreatedAt: Date;
  subjectKind: "incident" | "alert";
}): string {
  const differenceMs: number =
    data.time.getTime() - data.subjectCreatedAt.getTime();
  const minutes: number = Math.round(Math.abs(differenceMs) / 60000);
  const subject: string = `this ${data.subjectKind}`;

  if (minutes === 0) {
    return `within a minute of ${subject}`;
  }

  return `${minutes} minute${minutes === 1 ? "" : "s"} ${
    differenceMs > 0 ? "after" : "before"
  } ${subject}`;
}

export default class LinkedInfrastructureContext {
  // Only the infrastructure among the resources a record is linked to.
  public static keepInfrastructure(
    resources: Array<LinkedAffectedResource>,
  ): Array<LinkedInfrastructureResource> {
    const order: Array<LinkedAffectedResourceType> =
      LINKED_INFRASTRUCTURE_KINDS.map(
        (kind: { type: LinkedAffectedResourceType }) => {
          return kind.type;
        },
      );

    return resources
      .filter((resource: LinkedAffectedResource): boolean => {
        return order.includes(resource.type) && Boolean(resource.id);
      })
      .sort((a: LinkedAffectedResource, b: LinkedAffectedResource): number => {
        return order.indexOf(a.type) - order.indexOf(b.type);
      })
      .slice(0, MAX_LINKED_RESOURCES)
      .map((resource: LinkedAffectedResource) => {
        return { type: resource.type, id: resource.id, name: resource.name };
      });
  }

  /*
   * The incident's linked infrastructure and the alerts on it, read now.
   * Null when the incident cannot be read; an empty resource list when it
   * is linked to no infrastructure.
   */
  @CaptureSpan()
  public static async readForIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<LinkedInfrastructure | null> {
    const incident: { createdAt?: Date | undefined } | null =
      await IncidentService.findOneBy({
        query: { _id: data.incidentId.toString(), projectId: data.projectId },
        select: { _id: true, createdAt: true },
        props: { isRoot: true },
      });

    if (!incident?.createdAt) {
      return null;
    }

    const resources: Array<LinkedInfrastructureResource> =
      LinkedInfrastructureContext.keepInfrastructure(
        await LinkedAffectedResources.readForIncident({
          service: IncidentService,
          projectId: data.projectId,
          incidentId: data.incidentId,
        }),
      );

    return await LinkedInfrastructureContext.readAlertsFor({
      projectId: data.projectId,
      subjectKind: "incident",
      subjectCreatedAt: incident.createdAt,
      resources,
    });
  }

  // The alert twin of readForIncident; the alert itself is never listed.
  @CaptureSpan()
  public static async readForAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<LinkedInfrastructure | null> {
    const alert: Alert | null = await AlertService.findOneBy({
      query: { _id: data.alertId.toString(), projectId: data.projectId },
      select: { _id: true, createdAt: true },
      props: { isRoot: true },
    });

    if (!alert?.createdAt) {
      return null;
    }

    const resources: Array<LinkedInfrastructureResource> =
      LinkedInfrastructureContext.keepInfrastructure(
        await LinkedAffectedResources.readForAlert({
          service: AlertService,
          projectId: data.projectId,
          alertId: data.alertId,
        }),
      );

    return await LinkedInfrastructureContext.readAlertsFor({
      projectId: data.projectId,
      subjectKind: "alert",
      subjectCreatedAt: alert.createdAt,
      resources,
      excludeAlertId: data.alertId,
    });
  }

  /*
   * The alerts on `resources` that opened from the lookback before the
   * subject until now, or are still open - read per kind of resource,
   * because each kind is its own many-to-many relation (reading them in one
   * query would multiply their rows).
   */
  public static async readAlertsFor(data: {
    projectId: ObjectID;
    subjectKind: "incident" | "alert";
    subjectCreatedAt: Date;
    resources: Array<LinkedInfrastructureResource>;
    excludeAlertId?: ObjectID | undefined;
  }): Promise<LinkedInfrastructure> {
    const readAt: Date = OneUptimeDate.getCurrentDate();
    const windowStart: Date = OneUptimeDate.addRemoveMinutes(
      data.subjectCreatedAt,
      -RELATED_ALERTS_LOOKBACK_MINUTES,
    );
    const result: LinkedInfrastructure = {
      subjectKind: data.subjectKind,
      subjectCreatedAt: data.subjectCreatedAt,
      resources: data.resources,
      alerts: [],
      hasMoreAlerts: false,
      windowStart,
      readAt,
    };

    if (data.resources.length === 0) {
      return result;
    }

    const openStateIds: Array<ObjectID> =
      await AlertStateService.getUnresolvedAlertStateIds(data.projectId);
    const openStateIdSet: Set<string> = new Set<string>(
      openStateIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    const alertsById: Map<string, RelatedAlert> = new Map<
      string,
      RelatedAlert
    >();

    for (const [column, resources] of LinkedInfrastructureContext.groupByColumn(
      data.resources,
    )) {
      const relationQuery: Query<Alert> = {
        projectId: data.projectId,
        [column]: QueryHelper.inRelationArray(
          resources.map((resource: LinkedInfrastructureResource) => {
            return new ObjectID(resource.id);
          }),
        ),
      } as Query<Alert>;

      const reads: Array<Promise<Array<Alert>>> = [
        // Opened in the window, whatever their state now.
        LinkedInfrastructureContext.findAlerts(column, {
          ...relationQuery,
          createdAt: QueryHelper.greaterThanEqualTo(windowStart),
        } as Query<Alert>),
      ];

      // Opened before the window and still open.
      if (openStateIds.length > 0) {
        reads.push(
          LinkedInfrastructureContext.findAlerts(column, {
            ...relationQuery,
            createdAt: QueryHelper.lessThan(windowStart),
            currentAlertStateId: QueryHelper.any(openStateIds),
          } as Query<Alert>),
        );
      }

      const found: Array<Array<Alert>> = await Promise.all(reads);

      for (const alerts of found) {
        if (alerts.length > MAX_RELATED_ALERTS) {
          result.hasMoreAlerts = true;
        }

        for (const alert of alerts) {
          LinkedInfrastructureContext.addAlert({
            alertsById,
            alert,
            column,
            linkedOfColumn: resources,
            openStateIds: openStateIdSet,
            excludeAlertId: data.excludeAlertId,
          });
        }
      }
    }

    const alerts: Array<RelatedAlert> = Array.from(alertsById.values()).sort(
      (a: RelatedAlert, b: RelatedAlert): number => {
        return b.openedAt.getTime() - a.openedAt.getTime();
      },
    );

    if (alerts.length > MAX_RELATED_ALERTS) {
      result.hasMoreAlerts = true;
    }

    result.alerts = alerts.slice(0, MAX_RELATED_ALERTS);

    return result;
  }

  /*
   * The "# Linked infrastructure" block of the starting context: the
   * resources with the IDs the tools take, then the alerts on them. Empty
   * when the subject is linked to no infrastructure.
   */
  public static buildContextSection(data: LinkedInfrastructure | null): string {
    if (!data || data.resources.length === 0) {
      return "";
    }

    const subject: string = `this ${data.subjectKind}`;
    const lines: Array<string> = [
      "",
      "",
      "# Linked infrastructure",
      `${subject.charAt(0).toUpperCase()}${subject.slice(1)} is linked to this infrastructure (its Affected Resources, from its monitors' linked resources and configuration):`,
    ];

    for (const resource of data.resources) {
      lines.push(
        `- ${LinkedInfrastructureContext.describeResourceForTools(resource)}`,
      );
    }

    const windowStartText: string = data.windowStart.toISOString();

    lines.push("");

    if (data.alerts.length === 0) {
      lines.push(
        `No alert on these resources opened from ${windowStartText} (${RELATED_ALERTS_LOOKBACK_MINUTES} minutes before ${subject}) to now, and none of them has an alert still open.`,
      );
    } else {
      lines.push(
        `Alerts on these resources that opened from ${windowStartText} (${RELATED_ALERTS_LOOKBACK_MINUTES} minutes before ${subject}) to now, or are still open, newest first:`,
      );

      for (const alert of data.alerts) {
        lines.push(
          `- ${LinkedInfrastructureContext.describeAlert(alert, data)}`,
        );
      }

      if (data.hasMoreAlerts) {
        lines.push(
          `- (more alerts matched than the ${MAX_RELATED_ALERTS} listed; query_alerts lists the rest)`,
        );
      }
    }

    lines.push(
      "",
      "An alert on the infrastructure behind a failing monitor often names the cause: read these alerts first, then the resources' own telemetry around the incident (query_resource_telemetry; for a Docker or Podman host, query_containers for its busiest containers and the ones that stopped reporting). Host metrics such as system.cpu.utilization are reported per state: read them per state, never as one average.",
    );

    return lines.join("\n");
  }

  /*
   * What the run's activity says it read, for people: the resources and
   * how many open or recent alerts were on them. The dashboard words it in
   * the reader's language (ChatActivityFeed); `message` is the English.
   */
  public static buildActivityNote(
    data: LinkedInfrastructure | null,
  ): AIRunEventResultSummary | null {
    if (!data || data.resources.length === 0) {
      return null;
    }

    const activity: LinkedInfrastructureActivity = {
      resources: data.resources.map(
        (resource: LinkedInfrastructureResource) => {
          return { kind: resource.type, name: resource.name };
        },
      ),
      alertCount: data.alerts.length,
      openAlertCount: data.alerts.filter((alert: RelatedAlert): boolean => {
        return alert.isOpen;
      }).length,
      hasMoreAlerts: data.hasMoreAlerts,
      lookbackMinutes: RELATED_ALERTS_LOOKBACK_MINUTES,
    };

    return {
      message: LinkedInfrastructureContext.describeActivity(activity),
      severity: "Info",
      linkedInfrastructure: activity,
    };
  }

  /*
   * The activity line in English, worded as the AI Investigation card draws
   * it (ChatActivityFeed.describeLinkedInfrastructure): the card words it
   * from the data in the reader's language; this is what an API reader of
   * the run's events gets.
   */
  public static describeActivity(
    activity: LinkedInfrastructureActivity,
  ): string {
    const names: Array<string> = activity.resources
      .slice(0, 3)
      .map((resource: { kind: string; name: string }): string => {
        const noun: string = describeLinkedResourceKind(
          resource.kind as LinkedAffectedResourceType,
        );

        return resource.name ? `${noun} ${resource.name}` : noun;
      });
    const more: number = activity.resources.length - names.length;
    // "a", "a and b", "a, b and c", "a, b, c and 2 more".
    const resources: string =
      more > 0
        ? `${names.join(", ")} and ${more} more`
        : names.length > 1
          ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
          : names.join("");

    if (activity.alertCount === 0) {
      return `No open or recent alerts on ${resources}`;
    }

    if (activity.hasMoreAlerts) {
      return `Read the ${activity.alertCount} newest open or recent alerts on ${resources}`;
    }

    return `Read ${activity.alertCount} open or recent alert${
      activity.alertCount === 1 ? "" : "s"
    } on ${resources}`;
  }

  private static describeResourceForTools(
    resource: LinkedInfrastructureResource,
  ): string {
    const kind: { aiResourceType?: AIResourceType | undefined } | undefined =
      LINKED_INFRASTRUCTURE_KINDS.find(
        (candidate: { type: LinkedAffectedResourceType }): boolean => {
          return candidate.type === resource.type;
        },
      );
    const name: string = describeLinkedResource(resource);

    if (resource.type === LinkedAffectedResourceType.Service) {
      return `${name} (serviceId: ${resource.id}; query_traces, search_logs, log_histogram and the profile tools take it as serviceId, query_metrics as entityId)`;
    }

    if (!kind?.aiResourceType) {
      return `${name} (id: ${resource.id})`;
    }

    const containerHint: string =
      kind.aiResourceType === AIResourceType.DockerHost ||
      kind.aiResourceType === AIResourceType.PodmanHost
        ? "; query_containers lists its containers"
        : "";

    return `${name} (resourceType: ${kind.aiResourceType}, resourceId: ${resource.id}${containerHint})`;
  }

  private static describeAlert(
    alert: RelatedAlert,
    data: LinkedInfrastructure,
  ): string {
    const on: string = alert.resources
      .map((resource: LinkedInfrastructureResource): string => {
        return describeLinkedResource(resource);
      })
      .join(", ");
    const facts: Array<string> = [];

    if (alert.severityName) {
      facts.push(alert.severityName);
    }

    facts.push(
      alert.isOpen
        ? `still open${alert.stateName ? ` (${alert.stateName})` : ""}`
        : `resolved${alert.stateName ? ` (${alert.stateName})` : ""}`,
    );

    facts.push(
      `opened ${alert.openedAt.toISOString()} (${describeRelativeTime({
        time: alert.openedAt,
        subjectCreatedAt: data.subjectCreatedAt,
        subjectKind: data.subjectKind,
      })})`,
    );

    if (alert.monitorName) {
      facts.push(
        `monitor ${JSON.stringify(PromptText.field(alert.monitorName, { maxLength: 200 }))}`,
      );
    }

    const title: string = PromptText.field(alert.title, { maxLength: 300 });
    const rootCause: string = alert.rootCause
      ? PromptText.field(alert.rootCause, { maxLength: 500 })
      : "";

    return `${describeAlertNumber(alert)} ${JSON.stringify(title)}${
      on ? ` on ${on}` : ""
    }: ${facts.join(", ")}.${rootCause ? ` Root cause recorded: ${rootCause}` : ""}`;
  }

  private static groupByColumn(
    resources: Array<LinkedInfrastructureResource>,
  ): Map<string, Array<LinkedInfrastructureResource>> {
    const alertModel: Alert = new Alert();
    const byColumn: Map<string, Array<LinkedInfrastructureResource>> = new Map<
      string,
      Array<LinkedInfrastructureResource>
    >();

    for (const resource of resources) {
      const relation: LinkedAffectedResourceRelation | undefined =
        LINKED_AFFECTED_RESOURCE_RELATIONS.find(
          (candidate: LinkedAffectedResourceRelation): boolean => {
            return (
              candidate.type === resource.type &&
              alertModel.hasColumn(candidate.column)
            );
          },
        );

      if (!relation || !ObjectID.isValidUUID(resource.id)) {
        continue;
      }

      byColumn.set(relation.column, [
        ...(byColumn.get(relation.column) || []),
        resource,
      ]);
    }

    return byColumn;
  }

  private static async findAlerts(
    column: string,
    query: Query<Alert>,
  ): Promise<Array<Alert>> {
    return await AlertService.findBy({
      query,
      select: {
        _id: true,
        projectId: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        title: true,
        createdAt: true,
        isPrivate: true,
        rootCause: true,
        currentAlertStateId: true,
        currentAlertState: { name: true },
        alertSeverity: { name: true },
        monitor: { name: true },
        [column]: { _id: true, name: true, projectId: true },
      } as never,
      sort: { createdAt: SortOrder.Descending },
      // One more than listed, to know when there were more.
      limit: MAX_RELATED_ALERTS + 1,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private static addAlert(data: {
    alertsById: Map<string, RelatedAlert>;
    alert: Alert;
    column: string;
    linkedOfColumn: Array<LinkedInfrastructureResource>;
    openStateIds: Set<string>;
    excludeAlertId?: ObjectID | undefined;
  }): void {
    const alert: Alert = data.alert;
    const id: string = alert.id?.toString() || "";

    if (
      !id ||
      alert.isPrivate === true ||
      (data.excludeAlertId && data.excludeAlertId.toString() === id) ||
      !alert.createdAt
    ) {
      return;
    }

    /*
     * Which of the linked resources of this kind the alert is on: the ones
     * its relation names. The query matched it on at least one, so when the
     * relation was not read back, it is on the linked ones of its kind.
     */
    const relatedIds: Set<string> = new Set<string>(
      (
        ((alert as unknown as Record<string, unknown>)[data.column] ||
          []) as Array<{ _id?: string | undefined } | null>
      )
        .map((row: { _id?: string | undefined } | null): string => {
          return row?._id?.toString() || "";
        })
        .filter(Boolean),
    );
    const onResources: Array<LinkedInfrastructureResource> =
      data.linkedOfColumn.filter(
        (resource: LinkedInfrastructureResource): boolean => {
          return relatedIds.has(resource.id);
        },
      );
    const resources: Array<LinkedInfrastructureResource> =
      onResources.length > 0 ? onResources : data.linkedOfColumn;

    const existing: RelatedAlert | undefined = data.alertsById.get(id);

    if (existing) {
      for (const resource of resources) {
        if (
          !existing.resources.some(
            (known: LinkedInfrastructureResource): boolean => {
              return known.type === resource.type && known.id === resource.id;
            },
          )
        ) {
          existing.resources.push(resource);
        }
      }
      return;
    }

    data.alertsById.set(id, {
      id,
      alertNumber: alert.alertNumber,
      alertNumberWithPrefix: alert.alertNumberWithPrefix,
      title: alert.title || "",
      severityName: alert.alertSeverity?.name,
      stateName: alert.currentAlertState?.name,
      isOpen: alert.currentAlertStateId
        ? data.openStateIds.has(alert.currentAlertStateId.toString())
        : false,
      openedAt: new Date(alert.createdAt),
      resources: [...resources],
      rootCause: alert.rootCause,
      monitorName: alert.monitor?.name,
    });
  }
}
