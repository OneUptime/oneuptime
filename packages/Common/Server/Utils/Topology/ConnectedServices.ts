import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../Models/DatabaseModels/InventoryItemRelationship";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import AlertEpisodeMemberService from "../../Services/AlertEpisodeMemberService";
import AlertService from "../../Services/AlertService";
import IncidentEpisodeMemberService from "../../Services/IncidentEpisodeMemberService";
import IncidentService from "../../Services/IncidentService";
import InventoryItemRelationshipService from "../../Services/InventoryItemRelationshipService";
import InventoryItemService from "../../Services/InventoryItemService";
import MonitorService from "../../Services/MonitorService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Which services are connected on the Service Map, and which services an
 * alert or an incident is on (issue #6798).
 *
 * Grouping rules used to ignore the map. When a database fails, the
 * services that call it alert one after another, each on its own monitor,
 * and a rule that grouped by monitor opened an episode for each: five
 * pages for one outage. A rule that groups by connected services puts an
 * alert into an open episode when one of its services is, or calls, or is
 * called by, a service of an alert already there.
 *
 * What it reads:
 *
 *   - the services a record is on: the ones linked to it (its Affected
 *     Resources) and the ones linked to its monitors;
 *   - the Service Map: the depends-on relationships of the inventory
 *     (InventoryItemRelationship), derived from traces and service graph
 *     metrics, or added by hand, between the inventory items that point at
 *     the project's Service rows (InventoryItem.resourceType "Service").
 *     Relationships the inventory no longer holds - it prunes those not seen
 *     for 30 days - connect nothing.
 *
 * Two services are connected when one calls the other, one call apart.
 * Two services that both call a third that is not one of the project's
 * services (a database or an API that reports no telemetry of its own) are
 * not: a dependency half the estate calls would put every alert in one
 * episode.
 *
 * Service ids are compared as lower-case strings. Every read is held to
 * the project, as root - the grouping engines and OneUptime AI run with no
 * person behind them - and bounded, so a busy project costs a few reads.
 */

// The most records, inventory items or relationships one read takes.
export const MAX_RECORDS_READ: number = 500;

// The most members of the episodes being compared that are read.
export const MAX_EPISODE_MEMBERS_READ: number = 500;

/*
 * The most open (or recently resolved) episodes of a rule a record is
 * compared with, the most recently active first.
 */
export const MAX_EPISODES_COMPARED: number = 25;

/*
 * What a rule that groups by connected services adds to the grouping key of
 * a record on a service: every such record of the rule shares it, and which
 * of the rule's episodes it joins is decided by the services instead.
 */
export const CONNECTED_SERVICES_KEY_PART: string = "services:connected";

// The same for a record on no service and with no monitor to group by.
export const NO_SERVICE_KEY_PART: string = "services:none";

// The services a record is on, and those connected to them.
export interface RecordServices {
  serviceIds: Set<string>;
  // serviceIds and every service connected to one of them on the Service Map.
  connectedServiceIds: Set<string>;
}

export default class ConnectedServices {
  /*
   * What a rule that groups by connected services adds to a record's
   * grouping key. A record on a service shares CONNECTED_SERVICES_KEY_PART
   * with every other; one on no service is grouped by its monitor - unless
   * the rule groups by monitor already, whose part says the same - and one
   * with neither shares NO_SERVICE_KEY_PART.
   */
  public static getGroupingKeyPart(data: {
    services: RecordServices | null;
    monitorId: ObjectID | null | undefined;
    groupsByMonitor: boolean;
  }): string {
    if (data.services && data.services.serviceIds.size > 0) {
      return CONNECTED_SERVICES_KEY_PART;
    }

    if (data.monitorId && !data.groupsByMonitor) {
      return `monitor:${data.monitorId.toString()}`;
    }

    return NO_SERVICE_KEY_PART;
  }

  // The services an alert is on, and those connected to them.
  @CaptureSpan()
  public static async readForAlert(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<RecordServices> {
    const servicesByAlert: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfAlerts({
      projectId: data.projectId,
      alertIds: [data.alertId],
    });

    return await ConnectedServices.withConnected({
      projectId: data.projectId,
      serviceIds:
        servicesByAlert.get(ConnectedServices.key(data.alertId)) ||
        new Set<string>(),
    });
  }

  // The services an incident is on, and those connected to them.
  @CaptureSpan()
  public static async readForIncident(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<RecordServices> {
    const servicesByIncident: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfIncidents({
      projectId: data.projectId,
      incidentIds: [data.incidentId],
    });

    return await ConnectedServices.withConnected({
      projectId: data.projectId,
      serviceIds:
        servicesByIncident.get(ConnectedServices.key(data.incidentId)) ||
        new Set<string>(),
    });
  }

  /*
   * The first of `episodeIds` - in the order given, the most recently active
   * first - that holds a record on one of `connectedServiceIds`. Null when
   * none does.
   */
  public static pickConnectedEpisodeId(data: {
    episodeIds: Array<ObjectID>;
    servicesByEpisode: Map<string, Set<string>>;
    connectedServiceIds: ReadonlySet<string>;
  }): ObjectID | null {
    for (const episodeId of data.episodeIds) {
      if (
        ConnectedServices.intersects(
          data.servicesByEpisode.get(ConnectedServices.key(episodeId)),
          data.connectedServiceIds,
        )
      ) {
        return episodeId;
      }
    }

    return null;
  }

  /*
   * The services each alert is on, by alert id: its own and its monitor's.
   * An alert on no service is left out.
   */
  @CaptureSpan()
  public static async readServicesOfAlerts(data: {
    projectId: ObjectID;
    alertIds: Array<ObjectID>;
  }): Promise<Map<string, Set<string>>> {
    const servicesByAlert: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();
    const alertIds: Array<ObjectID> = ConnectedServices.unique(data.alertIds);

    if (alertIds.length === 0) {
      return servicesByAlert;
    }

    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(alertIds),
      },
      select: {
        _id: true,
        monitorId: true,
        services: { _id: true },
      },
      limit: MAX_RECORDS_READ,
      skip: 0,
      props: { isRoot: true },
    });

    const servicesByMonitor: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfMonitors({
      projectId: data.projectId,
      monitorIds: alerts
        .map((alert: Alert): ObjectID | undefined => {
          return alert.monitorId || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    });

    for (const alert of alerts) {
      const alertId: string = ConnectedServices.key(alert.id);

      if (!alertId) {
        continue;
      }

      const services: Set<string> = ConnectedServices.idsOf(alert.services);

      for (const serviceId of servicesByMonitor.get(
        ConnectedServices.key(alert.monitorId),
      ) || []) {
        services.add(serviceId);
      }

      if (services.size > 0) {
        servicesByAlert.set(alertId, services);
      }
    }

    return servicesByAlert;
  }

  /*
   * The services each incident is on, by incident id: its own and its
   * monitors'. An incident on no service is left out.
   */
  @CaptureSpan()
  public static async readServicesOfIncidents(data: {
    projectId: ObjectID;
    incidentIds: Array<ObjectID>;
  }): Promise<Map<string, Set<string>>> {
    const servicesByIncident: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();
    const incidentIds: Array<ObjectID> = ConnectedServices.unique(
      data.incidentIds,
    );

    if (incidentIds.length === 0) {
      return servicesByIncident;
    }

    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(incidentIds),
      },
      select: {
        _id: true,
        monitors: { _id: true },
        services: { _id: true },
      },
      limit: MAX_RECORDS_READ,
      skip: 0,
      props: { isRoot: true },
    });

    const servicesByMonitor: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfMonitors({
      projectId: data.projectId,
      monitorIds: incidents.flatMap((incident: Incident): Array<ObjectID> => {
        return (incident.monitors || [])
          .map((monitor: Monitor): ObjectID | undefined => {
            return monitor.id || undefined;
          })
          .filter((id: ObjectID | undefined): id is ObjectID => {
            return Boolean(id);
          });
      }),
    });

    for (const incident of incidents) {
      const incidentId: string = ConnectedServices.key(incident.id);

      if (!incidentId) {
        continue;
      }

      const services: Set<string> = ConnectedServices.idsOf(incident.services);

      for (const monitor of incident.monitors || []) {
        for (const serviceId of servicesByMonitor.get(
          ConnectedServices.key(monitor.id),
        ) || []) {
          services.add(serviceId);
        }
      }

      if (services.size > 0) {
        servicesByIncident.set(incidentId, services);
      }
    }

    return servicesByIncident;
  }

  /*
   * `serviceIds` and every service connected to one of them on the Service
   * Map: the ones they call and the ones that call them. Empty for none.
   */
  @CaptureSpan()
  public static async readConnectedServiceIds(data: {
    projectId: ObjectID;
    serviceIds: Iterable<string>;
  }): Promise<Set<string>> {
    const connected: Set<string> = new Set<string>();

    for (const serviceId of data.serviceIds) {
      if (serviceId) {
        connected.add(serviceId.toLowerCase());
      }
    }

    if (connected.size === 0) {
      return connected;
    }

    const items: Array<InventoryItem> = await InventoryItemService.findBy({
      query: {
        projectId: data.projectId,
        resourceType: "Service",
        resourceId: QueryHelper.any(
          Array.from(connected).map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: { _id: true, entityKey: true },
      limit: MAX_RECORDS_READ,
      skip: 0,
      props: { isRoot: true },
    });

    const keys: Array<string> = Array.from(
      new Set<string>(
        items
          .map((item: InventoryItem): string => {
            return item.entityKey || "";
          })
          .filter(Boolean),
      ),
    );

    if (keys.length === 0) {
      return connected;
    }

    const keySet: Set<string> = new Set<string>(keys);

    const [calls, callers]: [
      Array<InventoryItemRelationship>,
      Array<InventoryItemRelationship>,
    ] = await Promise.all([
      InventoryItemRelationshipService.findBy({
        query: {
          projectId: data.projectId,
          relationshipType: EntityRelationshipType.DependsOn,
          fromEntityKey: QueryHelper.any(keys),
        },
        select: { _id: true, fromEntityKey: true, toEntityKey: true },
        limit: MAX_RECORDS_READ,
        skip: 0,
        props: { isRoot: true },
      }),
      InventoryItemRelationshipService.findBy({
        query: {
          projectId: data.projectId,
          relationshipType: EntityRelationshipType.DependsOn,
          toEntityKey: QueryHelper.any(keys),
        },
        select: { _id: true, fromEntityKey: true, toEntityKey: true },
        limit: MAX_RECORDS_READ,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    const neighbourKeys: Set<string> = new Set<string>();

    for (const relationship of [...calls, ...callers]) {
      for (const key of [
        relationship.fromEntityKey,
        relationship.toEntityKey,
      ]) {
        if (key && !keySet.has(key)) {
          neighbourKeys.add(key);
        }
      }
    }

    if (neighbourKeys.size === 0) {
      return connected;
    }

    const neighbours: Array<InventoryItem> = await InventoryItemService.findBy({
      query: {
        projectId: data.projectId,
        resourceType: "Service",
        entityKey: QueryHelper.any(Array.from(neighbourKeys)),
      },
      select: { _id: true, resourceId: true },
      limit: MAX_RECORDS_READ,
      skip: 0,
      props: { isRoot: true },
    });

    for (const neighbour of neighbours) {
      const serviceId: string = ConnectedServices.key(neighbour.resourceId);

      if (serviceId) {
        connected.add(serviceId);
      }
    }

    return connected;
  }

  /*
   * The services of the alerts in each episode, by episode id: the newest
   * members first, at most MAX_EPISODE_MEMBERS_READ of them.
   */
  @CaptureSpan()
  public static async readServicesOfAlertEpisodes(data: {
    projectId: ObjectID;
    episodeIds: Array<ObjectID>;
  }): Promise<Map<string, Set<string>>> {
    if (data.episodeIds.length === 0) {
      return new Map<string, Set<string>>();
    }

    const members: Array<AlertEpisodeMember> =
      await AlertEpisodeMemberService.findBy({
        query: {
          projectId: data.projectId,
          alertEpisodeId: QueryHelper.any(data.episodeIds),
        },
        select: { _id: true, alertEpisodeId: true, alertId: true },
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_EPISODE_MEMBERS_READ,
        skip: 0,
        props: { isRoot: true },
      });

    const servicesByAlert: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfAlerts({
      projectId: data.projectId,
      alertIds: members
        .map((member: AlertEpisodeMember): ObjectID | undefined => {
          return member.alertId || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    });

    return ConnectedServices.byEpisode(
      members.map(
        (
          member: AlertEpisodeMember,
        ): { episodeId: string; recordId: string } => {
          return {
            episodeId: ConnectedServices.key(member.alertEpisodeId),
            recordId: ConnectedServices.key(member.alertId),
          };
        },
      ),
      servicesByAlert,
    );
  }

  // The incident twin of readServicesOfAlertEpisodes.
  @CaptureSpan()
  public static async readServicesOfIncidentEpisodes(data: {
    projectId: ObjectID;
    episodeIds: Array<ObjectID>;
  }): Promise<Map<string, Set<string>>> {
    if (data.episodeIds.length === 0) {
      return new Map<string, Set<string>>();
    }

    const members: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          projectId: data.projectId,
          incidentEpisodeId: QueryHelper.any(data.episodeIds),
        },
        select: { _id: true, incidentEpisodeId: true, incidentId: true },
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_EPISODE_MEMBERS_READ,
        skip: 0,
        props: { isRoot: true },
      });

    const servicesByIncident: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfIncidents({
      projectId: data.projectId,
      incidentIds: members
        .map((member: IncidentEpisodeMember): ObjectID | undefined => {
          return member.incidentId || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    });

    return ConnectedServices.byEpisode(
      members.map(
        (
          member: IncidentEpisodeMember,
        ): { episodeId: string; recordId: string } => {
          return {
            episodeId: ConnectedServices.key(member.incidentEpisodeId),
            recordId: ConnectedServices.key(member.incidentId),
          };
        },
      ),
      servicesByIncident,
    );
  }

  // Whether the two sets have a service in common.
  public static intersects(
    a: ReadonlySet<string> | undefined,
    b: ReadonlySet<string> | undefined,
  ): boolean {
    if (!a || !b) {
      return false;
    }

    const [smaller, larger]: [ReadonlySet<string>, ReadonlySet<string>] =
      a.size <= b.size ? [a, b] : [b, a];

    for (const id of smaller) {
      if (larger.has(id)) {
        return true;
      }
    }

    return false;
  }

  // An id as the maps here key it: lower case, "" for none.
  public static key(id: ObjectID | string | null | undefined): string {
    return id ? id.toString().toLowerCase() : "";
  }

  private static async withConnected(data: {
    projectId: ObjectID;
    serviceIds: Set<string>;
  }): Promise<RecordServices> {
    if (data.serviceIds.size === 0) {
      return { serviceIds: data.serviceIds, connectedServiceIds: new Set() };
    }

    return {
      serviceIds: data.serviceIds,
      connectedServiceIds: await ConnectedServices.readConnectedServiceIds({
        projectId: data.projectId,
        serviceIds: data.serviceIds,
      }),
    };
  }

  private static async readServicesOfMonitors(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
  }): Promise<Map<string, Set<string>>> {
    const servicesByMonitor: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();
    const monitorIds: Array<ObjectID> = ConnectedServices.unique(
      data.monitorIds,
    );

    if (monitorIds.length === 0) {
      return servicesByMonitor;
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(monitorIds),
      },
      select: { _id: true, services: { _id: true } },
      limit: MAX_RECORDS_READ,
      skip: 0,
      props: { isRoot: true },
    });

    for (const monitor of monitors) {
      const services: Set<string> = ConnectedServices.idsOf(monitor.services);

      if (monitor.id && services.size > 0) {
        servicesByMonitor.set(ConnectedServices.key(monitor.id), services);
      }
    }

    return servicesByMonitor;
  }

  private static byEpisode(
    members: Array<{ episodeId: string; recordId: string }>,
    servicesByRecord: Map<string, Set<string>>,
  ): Map<string, Set<string>> {
    const servicesByEpisode: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const member of members) {
      const services: Set<string> | undefined = servicesByRecord.get(
        member.recordId,
      );

      if (!member.episodeId || !services) {
        continue;
      }

      const episodeServices: Set<string> =
        servicesByEpisode.get(member.episodeId) || new Set<string>();

      for (const serviceId of services) {
        episodeServices.add(serviceId);
      }

      servicesByEpisode.set(member.episodeId, episodeServices);
    }

    return servicesByEpisode;
  }

  private static idsOf(services: Array<Service> | undefined): Set<string> {
    const ids: Set<string> = new Set<string>();

    for (const service of services || []) {
      const id: string = ConnectedServices.key(service.id);

      if (id) {
        ids.add(id);
      }
    }

    return ids;
  }

  private static unique(ids: Array<ObjectID>): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const unique: Array<ObjectID> = [];

    for (const id of ids) {
      const key: string = ConnectedServices.key(id);

      if (key && !seen.has(key)) {
        seen.add(key);
        unique.push(id);
      }
    }

    return unique;
  }
}
