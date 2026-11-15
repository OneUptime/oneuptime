import Alert from "../../../../Models/DatabaseModels/Alert";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import {
  AIRunEventResultSummary,
  LinkedInfrastructureActivity,
} from "../../../../Types/AI/AIChatTypes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import logger from "../../Logger";
import ObjectID from "../../../../Types/ObjectID";
import { DEFAULT_LANGUAGE, toSentenceTerm } from "../../../../Types/Translator";
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
import { isCloudResourceKindResource } from "../../../../Types/Cloud/CloudResourceKind";
import { JSONObject } from "../../../../Types/JSON";
import {
  OpenStackBlastRadiusOwner,
  OpenStackBlastRadiusProject,
  describeOpenStackBlastRadius,
  describeOpenStackBlastRadiusCounts,
  isOpenStackBlastRadiusEmpty,
} from "../../../../Types/OpenStack/OpenStackBlastRadius";
import {
  OPENSTACK_SERVICE_TITLES,
  OpenStackResourceKind,
} from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackAttentionRow,
  OpenStackAttentionSummary,
  summarizeOpenStackAttention,
} from "../../../../Types/OpenStack/OpenStackAttentionSummary";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
} from "../../../../Utils/OpenStack/OpenStackLogs";
import OpenStackResourceService, {
  OpenStackAttentionRows,
} from "../../../Services/OpenStackResourceService";
import OpenStackAcrossProducts, {
  OpenStackKubernetesNodeRead,
} from "../../OpenStack/OpenStackAcrossProducts";
import OpenStackAlertContext, {
  OpenStackAlertContextResult,
  OpenStackBusyInstance,
  OpenStackRegionWide,
  getOpenStackMetricNamesOfMonitor,
} from "../../OpenStack/OpenStackAlertContext";
import {
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
  describeOpenStackReachAcrossProducts,
  isOpenStackReachEmpty,
} from "../../../../Types/OpenStack/OpenStackLinks";
import ServiceService from "../../../Services/ServiceService";

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

/*
 * What the context calls an App Platforms environment (ECS on Fargate in
 * one account and region, a Cloud Run region, ...): a place apps run, which
 * its account's Cloud AI agent fixes by the services running there.
 */
export const CLOUD_ENVIRONMENT_NOUN: string = "Cloud environment";

/*
 * The kind a run's activity records for an App Platforms environment
 * (LinkedInfrastructureActivity, FollowUpCheckActivity). Its row is a
 * CloudResource like a resource of a connected account, so the activity
 * recorded the table's kind, and the AI card's line called an environment a
 * "Cloud resource" - what the context and the feeds do not call it. The
 * card words this kind as CLOUD_ENVIRONMENT_NOUN, in the reader's language
 * (ChatActivityFeed's LINKED_RESOURCE_KIND_NOUNS).
 */
export const CLOUD_ENVIRONMENT_ACTIVITY_KIND: string = "CloudEnvironment";

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
    type: LinkedAffectedResourceType.OpenStackCloud,
    aiResourceType: AIResourceType.OpenStackCloud,
    noun: "OpenStack cloud",
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
  /*
   * A cloud row's kind, when it was read (LinkedAffectedResource): an App
   * Platforms environment is a "Cloud environment", a resource of a
   * connected account a "Cloud resource".
   */
  cloudResourceKind?: string | undefined;
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
  // What the subject takes with it on an OpenStack cloud, and whose that is.
  openStack?: OpenStackAlertContextResult | undefined;
  /*
   * Which part of a cloud each linked host, service or Kubernetes cluster runs on, so an
   * investigation that starts at a slow service can walk down to its hypervisor.
   */
  openStackPlacements?: Array<OpenStackPlacementOfResource> | undefined;
  // What the page of each linked cloud says needs attention right now.
  openStackAttention?: Array<OpenStackCloudAttention> | undefined;
}

export interface OpenStackCloudAttention {
  cloud: LinkedInfrastructureResource;
  summary: OpenStackAttentionSummary;
}

export interface OpenStackPlacementOfResource {
  resource: LinkedInfrastructureResource;
  // What the placement is reached through, when that isn't the resource itself: a host, a node.
  through?: string | undefined;
  placement: OpenStackPlacement;
}

// Enough to say where a thing runs, without crowding out everything else the context says.
const MAX_OPENSTACK_PLACEMENTS: number = 10;

// Enough to see the shape of what is wrong: the agent's commands and the page have the rest.
const MAX_OPENSTACK_ATTENTION_ROWS_PER_KIND: number = 8;
const MAX_OPENSTACK_CLOUDS_READ_FOR_ATTENTION: number = 3;

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

/*
 * Whether a linked resource is an App Platforms environment: a cloud row
 * whose kind was read and is not a resource of a connected account. A row
 * whose kind was not read stays a cloud resource, as it always was.
 */
export function isLinkedCloudEnvironment(
  resource: Pick<LinkedInfrastructureResource, "type" | "cloudResourceKind">,
): boolean {
  return Boolean(
    resource.type === LinkedAffectedResourceType.CloudResource &&
      resource.cloudResourceKind &&
      !isCloudResourceKindResource(resource.cloudResourceKind),
  );
}

// The noun a linked resource is called by: its kind's, an environment's own.
export function describeLinkedResourceNoun(
  resource: Pick<LinkedInfrastructureResource, "type" | "cloudResourceKind">,
): string {
  return isLinkedCloudEnvironment(resource)
    ? CLOUD_ENVIRONMENT_NOUN
    : describeLinkedResourceKind(resource.type);
}

/*
 * The kind a run's activity records for a linked resource: its kind, or
 * CLOUD_ENVIRONMENT_ACTIVITY_KIND for an App Platforms environment.
 */
export function getLinkedResourceActivityKind(
  resource: Pick<LinkedInfrastructureResource, "type" | "cloudResourceKind">,
): string {
  return isLinkedCloudEnvironment(resource)
    ? CLOUD_ENVIRONMENT_ACTIVITY_KIND
    : resource.type;
}

// The noun a kind a run's activity recorded is called by, in English.
export function describeActivityResourceKind(kind: string): string {
  return kind === CLOUD_ENVIRONMENT_ACTIVITY_KIND
    ? CLOUD_ENVIRONMENT_NOUN
    : describeLinkedResourceKind(kind as LinkedAffectedResourceType);
}

/*
 * "host web-1", "Docker host web-2": a resource a run's activity recorded,
 * named in the middle of an English sentence for people (#7952). Its kind's
 * noun is cased by the AI Investigation card's rule (ChatActivityFeed's
 * describeLinkedResource: toSentenceTerm, which keeps "Docker",
 * "Kubernetes" and "IoT"), not written as the label "Host"; a resource
 * without a name is its noun alone. The run's activity lines and the
 * follow-up check's report lead name a resource this way.
 */
export function describeActivityResource(resource: {
  kind: string;
  name: string;
}): string {
  const noun: string = toSentenceTerm(
    describeActivityResourceKind(resource.kind),
    DEFAULT_LANGUAGE,
  );

  return resource.name ? `${noun} ${resource.name}` : noun;
}

/*
 * 'Host "web-1"' - how a linked resource is named in the context, for the
 * model: the noun as a label, the name a quoted field. A sentence for
 * people says describeActivityResource's "host web-1".
 */
export function describeLinkedResource(
  resource: LinkedInfrastructureResource,
): string {
  const noun: string = describeLinkedResourceNoun(resource);
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
        return {
          type: resource.type,
          id: resource.id,
          name: resource.name,
          ...(resource.cloudResourceKind
            ? { cloudResourceKind: resource.cloudResourceKind }
            : {}),
        };
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
    const incident: {
      createdAt?: Date | undefined;
      seriesLabels?: JSONObject | undefined;
      monitors?: Array<{ monitorSteps?: unknown }> | undefined;
    } | null = await IncidentService.findOneBy({
      query: { _id: data.incidentId.toString(), projectId: data.projectId },
      select: {
        _id: true,
        createdAt: true,
        seriesLabels: true,
        monitors: { _id: true, monitorSteps: true },
      },
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

    return {
      ...(await LinkedInfrastructureContext.readAlertsFor({
        projectId: data.projectId,
        subjectKind: "incident",
        subjectCreatedAt: incident.createdAt,
        resources,
      })),
      openStack: await LinkedInfrastructureContext.readOpenStack({
        projectId: data.projectId,
        resources,
        seriesLabels: incident.seriesLabels,
        monitors: incident.monitors,
      }),
      openStackPlacements:
        await LinkedInfrastructureContext.readOpenStackPlacements({
          projectId: data.projectId,
          resources,
        }),
      openStackAttention:
        await LinkedInfrastructureContext.readOpenStackAttention({
          projectId: data.projectId,
          resources,
        }),
    };
  }

  // The alert twin of readForIncident; the alert itself is never listed.
  @CaptureSpan()
  public static async readForAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<LinkedInfrastructure | null> {
    const alert: Alert | null = await AlertService.findOneBy({
      query: { _id: data.alertId.toString(), projectId: data.projectId },
      select: {
        _id: true,
        createdAt: true,
        seriesLabels: true,
        monitor: { _id: true, monitorSteps: true },
      },
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

    return {
      ...(await LinkedInfrastructureContext.readAlertsFor({
        projectId: data.projectId,
        subjectKind: "alert",
        subjectCreatedAt: alert.createdAt,
        resources,
        excludeAlertId: data.alertId,
      })),
      openStack: await LinkedInfrastructureContext.readOpenStack({
        projectId: data.projectId,
        resources,
        seriesLabels: alert.seriesLabels as JSONObject | undefined,
        monitors: alert.monitor ? [alert.monitor] : undefined,
      }),
      openStackPlacements:
        await LinkedInfrastructureContext.readOpenStackPlacements({
          projectId: data.projectId,
          resources,
        }),
      openStackAttention:
        await LinkedInfrastructureContext.readOpenStackAttention({
          projectId: data.projectId,
          resources,
        }),
    };
  }

  /*
   * Where the linked hosts, services and Kubernetes nodes are in a cloud. One more thing to
   * know rather than the thing an investigation stands on, so a read that fails says nothing.
   */
  private static async readOpenStackPlacements(data: {
    projectId: ObjectID;
    resources: Array<LinkedInfrastructureResource>;
  }): Promise<Array<OpenStackPlacementOfResource> | undefined> {
    const placements: Array<OpenStackPlacementOfResource> = [];
    try {
      for (const resource of data.resources) {
        if (placements.length >= MAX_OPENSTACK_PLACEMENTS) {
          break;
        }
        if (resource.type === LinkedAffectedResourceType.Host) {
          const placement: OpenStackPlacement | null =
            await OpenStackAcrossProducts.getPlacementOfHost({
              projectId: data.projectId,
              hostId: new ObjectID(resource.id),
            });
          if (placement) {
            placements.push({ resource, placement });
          }
        }
        if (resource.type === LinkedAffectedResourceType.Service) {
          const service: { name?: string | undefined } | null =
            await ServiceService.findOneById({
              id: new ObjectID(resource.id),
              select: { name: true },
              props: { isRoot: true },
            });
          if (service?.name) {
            for (const found of await OpenStackAcrossProducts.getPlacementsOfService(
              { projectId: data.projectId, serviceName: service.name },
            )) {
              placements.push({
                resource,
                through: `${found.kubernetesClusterId ? "Kubernetes node" : "host"} ${JSON.stringify(PromptText.field(found.hostName, { maxLength: 200 }))}`,
                placement: found.placement,
              });
            }
          }
        }
        if (resource.type === LinkedAffectedResourceType.KubernetesCluster) {
          placements.push(
            ...(await LinkedInfrastructureContext.readPlacementsOfCluster({
              projectId: data.projectId,
              resource,
            })),
          );
        }
      }
    } catch {
      return placements.length > 0 ? placements : undefined;
    }
    return placements.length > 0
      ? placements.slice(0, MAX_OPENSTACK_PLACEMENTS)
      : undefined;
  }

  private static async readPlacementsOfCluster(data: {
    projectId: ObjectID;
    resource: LinkedInfrastructureResource;
  }): Promise<Array<OpenStackPlacementOfResource>> {
    const nodes: Array<OpenStackKubernetesNodeRead> =
      await OpenStackAcrossProducts.readOpenStackKubernetesNodes({
        projectId: data.projectId,
        kubernetesClusterId: new ObjectID(data.resource.id),
        limit: MAX_OPENSTACK_PLACEMENTS,
      });
    const placements: Array<OpenStackPlacementOfResource> = [];
    for (const node of nodes) {
      const placement: OpenStackPlacement | null =
        await OpenStackAcrossProducts.getPlacementOfKubernetesNode({
          projectId: data.projectId,
          kubernetesClusterId: new ObjectID(data.resource.id),
          nodeName: node.nodeName,
        });
      if (placement) {
        placements.push({
          resource: data.resource,
          through: `node ${JSON.stringify(PromptText.field(node.nodeName, { maxLength: 200 }))}`,
          placement,
        });
      }
    }
    return placements;
  }

  /*
   * What the page of each linked cloud says needs attention, whatever series the subject is
   * about: an investigation's first question is what else is wrong there. One more thing to
   * know, so a read that fails leaves the rest of the context as it is.
   */
  private static async readOpenStackAttention(data: {
    projectId: ObjectID;
    resources: Array<LinkedInfrastructureResource>;
  }): Promise<Array<OpenStackCloudAttention> | undefined> {
    const clouds: Array<LinkedInfrastructureResource> = data.resources
      .filter((resource: LinkedInfrastructureResource): boolean => {
        return resource.type === LinkedAffectedResourceType.OpenStackCloud;
      })
      .slice(0, MAX_OPENSTACK_CLOUDS_READ_FOR_ATTENTION);
    const attention: Array<OpenStackCloudAttention> = [];

    for (const cloud of clouds) {
      try {
        const now: Date = OneUptimeDate.getCurrentDate();
        const read: OpenStackAttentionRows =
          await OpenStackResourceService.getAttentionRows({
            projectId: data.projectId,
            openStackCloudId: new ObjectID(cloud.id),
            now,
            rowsPerKind: MAX_OPENSTACK_ATTENTION_ROWS_PER_KIND,
          });

        attention.push({
          cloud,
          summary: summarizeOpenStackAttention({
            rows: read.rows,
            totalsByKind: read.totalsByKind,
            now,
            rowsPerKind: MAX_OPENSTACK_ATTENTION_ROWS_PER_KIND,
          }),
        });
      } catch (err) {
        logger.warn(
          `Could not read what needs attention on an OpenStack cloud for an investigation: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return attention.length > 0 ? attention : undefined;
  }

  /*
   * What the series a subject is about takes with it on the OpenStack cloud it is linked
   * to. A read that fails leaves the rest of the context as it is: this is one more thing
   * to know, not the thing an investigation stands on.
   *
   * The series a region's API opens on names only the region, so which API it is comes from
   * what its monitor reads, as it does for the description written when the subject opened.
   */
  private static async readOpenStack(data: {
    projectId: ObjectID;
    resources: Array<LinkedInfrastructureResource>;
    seriesLabels: JSONObject | undefined;
    monitors?: Array<{ monitorSteps?: unknown }> | undefined;
  }): Promise<OpenStackAlertContextResult | undefined> {
    const cloud: LinkedInfrastructureResource | undefined = data.resources.find(
      (resource: LinkedInfrastructureResource): boolean => {
        return resource.type === LinkedAffectedResourceType.OpenStackCloud;
      },
    );

    if (!cloud || !data.seriesLabels) {
      return undefined;
    }

    try {
      return await OpenStackAlertContext.read({
        projectId: data.projectId,
        openStackCloudId: new ObjectID(cloud.id),
        seriesLabels: data.seriesLabels,
        metricNames: (data.monitors || []).flatMap(
          (monitor: { monitorSteps?: unknown }): Array<string> => {
            return getOpenStackMetricNamesOfMonitor(monitor.monitorSteps);
          },
        ),
      });
    } catch {
      return undefined;
    }
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

    lines.push(...LinkedInfrastructureContext.describeOpenStack(data));
    lines.push(...LinkedInfrastructureContext.describeOpenStackAttention(data));
    lines.push(...LinkedInfrastructureContext.describeOpenStackLogs(data));
    lines.push(
      ...LinkedInfrastructureContext.describeOpenStackPlacements(data),
    );

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
   * What is in trouble on each linked cloud, by the same lines as its page. Names are whoever
   * wrote them, so each goes in as a field.
   */
  private static describeOpenStackAttention(
    data: LinkedInfrastructure,
  ): Array<string> {
    const lines: Array<string> = [];

    for (const { cloud, summary } of data.openStackAttention || []) {
      const name: string = describeLinkedResource(cloud);

      if (summary.rows.length === 0) {
        if (summary.hasServiceRows) {
          lines.push(
            "",
            `Nothing reads as down, failed or full on ${name} right now, from what its Needs attention list reads.`,
          );
        }
        continue;
      }

      lines.push(
        "",
        `What reads as down, failed or full on ${name} right now, from what its Needs attention list reads, what everything stands on first. This is what was last collected, so check each with a command before you rely on it:`,
      );

      for (const row of summary.rows) {
        lines.push(
          `- ${LinkedInfrastructureContext.describeOpenStackAttentionRow(row)}`,
        );
      }

      for (const [kind, count] of Object.entries(summary.moreByKind)) {
        lines.push(`- and ${count} more of kind ${kind}`);
      }
    }

    return lines;
  }

  private static describeOpenStackAttentionRow(
    row: OpenStackAttentionRow,
  ): string {
    const name: string = JSON.stringify(
      PromptText.field(row.name, { maxLength: 200 }),
    );
    const where: string = row.where
      ? ` on ${JSON.stringify(PromptText.field(row.where, { maxLength: 200 }))}`
      : "";
    const id: string = row.id
      ? ` (id: ${JSON.stringify(PromptText.field(row.id, { maxLength: 200 }))})`
      : "";
    const message: string = row.message
      ? ` It failed with: ${JSON.stringify(PromptText.field(row.message, { maxLength: 300 }))}`
      : "";

    return `${row.kind} ${name}${where}${id}: ${row.why}.${message}`;
  }

  /*
   * How to read the logs of a cloud: this part's lines, when the subject names one, and one
   * request's across every service, which is how a failure is followed through a cloud.
   */
  private static describeOpenStackLogs(
    data: LinkedInfrastructure,
  ): Array<string> {
    const cloud: LinkedInfrastructureResource | undefined = data.resources.find(
      (resource: LinkedInfrastructureResource): boolean => {
        return resource.type === LinkedAffectedResourceType.OpenStackCloud;
      },
    );

    if (!cloud) {
      return [];
    }

    const cloudFilter: Record<string, string> = cloud.name
      ? {
          [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: PromptText.field(cloud.name, {
            maxLength: 200,
          }),
        }
      : {};
    const lines: Array<string> = [""];
    const part: Record<string, string> | undefined =
      data.openStack?.partLogAttributes;

    if (part) {
      const filter: Record<string, string> = { ...cloudFilter };

      for (const [key, value] of Object.entries(part)) {
        filter[key] = PromptText.field(value, { maxLength: 200 });
      }

      lines.push(
        `This part's logs, where the cloud sends them: search_logs with attributes ${JSON.stringify(filter)}.`,
      );
    }

    lines.push(
      `To follow a request through the cloud: \`openstack server event list <instance id>\`, run through the agent, names the request behind each thing that happened to an instance (req-...), and search_logs with attributes ${JSON.stringify(
        {
          ...cloudFilter,
          [OpenStackLogAttribute.RequestRootId]: "req-...",
        },
      )} reads what every service wrote about it. No lines means this cloud does not send its logs, not that nothing happened.`,
    );

    return lines;
  }

  /*
   * "This incident's part takes 3 instances in 2 projects with it", and whose they are.
   * Project names are a tenant's own words, so each goes in as a field.
   */
  private static describeOpenStack(data: LinkedInfrastructure): Array<string> {
    const lines: Array<string> = [];
    const context: OpenStackAlertContextResult | undefined = data.openStack;

    if (!context) {
      return lines;
    }

    if (context.projectId) {
      const name: string = PromptText.field(
        context.projectName || context.projectId,
        { maxLength: 200 },
      );
      lines.push(
        `It is about OpenStack project ${JSON.stringify(name)} (id: ${context.projectId}).`,
      );
    }

    const regionWide: OpenStackRegionWide | undefined = context.regionWide;

    if (regionWide) {
      lines.push(LinkedInfrastructureContext.describeRegionWide(regionWide));
    }

    if (context.radius && !context.radius.isKnown) {
      lines.push(
        "What was collected from this cloud does not say what this part holds, so do not read that as nothing.",
      );
    } else if (context.radius && !isOpenStackBlastRadiusEmpty(context.radius)) {
      lines.push(
        regionWide
          ? `What it takes with it, every project there with anything on it: ${describeOpenStackBlastRadius(context.radius)}.`
          : `What this part takes with it: ${describeOpenStackBlastRadius(context.radius)}.`,
      );
      for (const project of context.radius.projects) {
        lines.push(
          `- ${LinkedInfrastructureContext.describeOpenStackProject(project)}`,
        );
      }
      if (context.radius.projectCount > context.radius.projects.length) {
        lines.push(
          `- and ${context.radius.projectCount - context.radius.projects.length} more projects`,
        );
      }
    }

    for (const owner of context.radius?.belongsTo || []) {
      lines.push(
        `Part of ${owner.kind === OpenStackResourceKind.ContainerCluster ? "Magnum Kubernetes cluster" : "Heat stack"} ${JSON.stringify(owner.name || owner.externalId)}${owner.status ? `, which reads ${owner.status}` : ""}.`,
      );
    }
    if (context.radius?.magnumClusters?.length) {
      lines.push(
        `Magnum Kubernetes clusters with a server on it: ${context.radius.magnumClusters
          .map((owner: OpenStackBlastRadiusOwner): string => {
            return JSON.stringify(owner.name || owner.externalId);
          })
          .join(", ")}.`,
      );
    }

    const reach: OpenStackReachAcrossProducts | null | undefined =
      context.radius?.acrossProducts;
    if (reach && !isOpenStackReachEmpty(reach)) {
      lines.push(
        `Beyond the cloud it takes: ${describeOpenStackReachAcrossProducts(reach)}.`,
      );
      for (const host of reach.hosts) {
        lines.push(
          `- Host ${JSON.stringify(PromptText.field(host.name, { maxLength: 200 }))} (resourceType: ${AIResourceType.Host}, resourceId: ${host.id})${host.isHypervisor ? ": this hypervisor's own machine" : ""}`,
        );
      }
      for (const cluster of reach.kubernetesClusters) {
        lines.push(
          `- Kubernetes cluster ${JSON.stringify(PromptText.field(cluster.name, { maxLength: 200 }))} (resourceType: ${AIResourceType.KubernetesCluster}, resourceId: ${cluster.id}): ${cluster.nodeCount} ${cluster.nodeCount === 1 ? "node" : "nodes"}`,
        );
      }
      for (const service of reach.services) {
        lines.push(
          `- Service ${JSON.stringify(PromptText.field(service.name, { maxLength: 200 }))} (serviceId: ${service.id})`,
        );
      }
    }

    if (context.busiestInstances && context.busiestInstances.length > 0) {
      lines.push("The instances using the most of this hypervisor:");
      for (const instance of context.busiestInstances) {
        lines.push(
          `- ${LinkedInfrastructureContext.describeBusyInstance(instance)}`,
        );
      }
    }

    return lines.length > 0 ? ["", ...lines] : lines;
  }

  // A region's name is whatever its operator called it, so it goes in as a field.
  private static describeRegionWide(regionWide: OpenStackRegionWide): string {
    const title: string = OPENSTACK_SERVICE_TITLES[regionWide.service];

    if (regionWide.isWholeCloud) {
      return `This is about the whole cloud, not one part of it: the ${title} API, which every region depends on.`;
    }

    return regionWide.regionName
      ? `This is about a whole region, not one part of it: the ${title} API of region ${JSON.stringify(PromptText.field(regionWide.regionName, { maxLength: 200 }))}.`
      : `This is about a whole region, not one part of it: the ${title} API.`;
  }

  private static describeBusyInstance(instance: OpenStackBusyInstance): string {
    const name: string = PromptText.field(
      instance.name || instance.instanceId,
      { maxLength: 200 },
    );
    const facts: Array<string> = [];
    if (instance.cpuCores !== null) {
      facts.push(`${instance.cpuCores.toFixed(1)} CPU threads`);
    }
    if (instance.contentionPercent !== null) {
      facts.push(
        `waiting ${Math.round(instance.contentionPercent)}% of its time for the hypervisor`,
      );
    }
    return `Instance ${JSON.stringify(name)} (id: ${instance.instanceId})${facts.length > 0 ? `: ${facts.join(", ")}` : ""}`;
  }

  /*
   * How to walk down from what the subject is linked to: "Service "api", through host
   * "web-1", is OpenStack instance "web-1" on hypervisor "compute-01" of cloud "prod-eu"".
   * Names are a tenant's own words, so each goes in as a field.
   */
  private static describeOpenStackPlacements(
    data: LinkedInfrastructure,
  ): Array<string> {
    const placements: Array<OpenStackPlacementOfResource> =
      data.openStackPlacements || [];
    if (placements.length === 0) {
      return [];
    }
    const lines: Array<string> = [
      "",
      "Where this infrastructure runs in OpenStack, which the same tools can read as an OpenStack cloud:",
    ];
    for (const { resource, through, placement } of placements) {
      const field: (value: string | null) => string = (
        value: string | null,
      ): string => {
        return JSON.stringify(
          PromptText.field(value || "unknown", { maxLength: 200 }),
        );
      };
      const start: string = `${describeLinkedResource(resource)}${through ? `, through ${through},` : ""}`;
      const where: string =
        placement.kind === "hypervisor"
          ? `is OpenStack hypervisor ${field(placement.hypervisorName)}`
          : `is OpenStack instance ${field(placement.name || placement.externalId)} (id: ${placement.externalId}) on hypervisor ${field(placement.hypervisorName)}`;
      const zone: string = placement.availabilityZone
        ? ` in zone ${field(placement.availabilityZone)}`
        : "";
      const owner: string = placement.openStackProjectId
        ? `, in project ${field(placement.openStackProjectName || placement.openStackProjectId)}`
        : "";
      lines.push(
        `- ${start} ${where}${zone}${owner}, of cloud ${field(placement.cloudName)} (resourceType: ${AIResourceType.OpenStackCloud}, resourceId: ${placement.openStackCloudId})`,
      );
    }
    return lines;
  }

  private static describeOpenStackProject(
    project: OpenStackBlastRadiusProject,
  ): string {
    const name: string = PromptText.field(project.name || project.projectId, {
      maxLength: 200,
    });

    return `OpenStack project ${JSON.stringify(name)} (id: ${project.projectId}): ${describeOpenStackBlastRadiusCounts(project)}`;
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
          // An App Platforms environment as what it is, not "Cloud resource".
          return {
            kind: getLinkedResourceActivityKind(resource),
            name: resource.name,
          };
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
   * it (ChatActivityFeed.describeLinkedInfrastructure), each kind cased for
   * the middle of the sentence as the card cases it: "on host web-1 and
   * Docker host web-2" (describeActivityResource). The card words it from
   * the data in the reader's language; this is what an API reader of the
   * run's events gets.
   */
  public static describeActivity(
    activity: LinkedInfrastructureActivity,
  ): string {
    const names: Array<string> = activity.resources
      .slice(0, 3)
      .map((resource: { kind: string; name: string }): string => {
        return describeActivityResource(resource);
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
