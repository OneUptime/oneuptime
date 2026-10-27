import Alert from "../../../../Models/DatabaseModels/Alert";
import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import ServiceModel from "../../../../Models/DatabaseModels/Service";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_CONNECTION_MAX_LISTED,
  SECURITY_CONNECTION_MAX_RESOURCES,
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionChangeJson,
  SecurityConnectionKind,
  SecurityConnectionMatch,
  SecurityConnectionRecordJson,
  SecurityConnectionRecordListJson,
  SecurityConnectionsJson,
} from "../../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  readSecurityEntities,
} from "../../../../Types/SecurityCase/SecurityEntity";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  SecurityConnectionWindow,
  SecurityLogResource,
  getCaseConnectionWindow,
  getEventConnectionWindow,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import {
  ChangeEventFields,
  readChangeEventFields,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import {
  keyForHost,
  keyForInventoryEntity,
  keyForKubernetesCluster,
  keyForService,
} from "../../../../Utils/Telemetry/EntityKey";
import AlertService from "../../../Services/AlertService";
import AlertStateService from "../../../Services/AlertStateService";
import ChangeEventService from "../../../Services/ChangeEventService";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateService from "../../../Services/IncidentStateService";
import InventoryItemService from "../../../Services/InventoryItemService";
import MonitorService from "../../../Services/MonitorService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import SecurityEventService from "../../../Services/SecurityEventService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import TelemetryReadAccess from "../../Telemetry/TelemetryReadAccess";
import SecurityConnectedRecords, {
  SecurityConnectedRecord,
  SecurityConnectedRecordsResult,
  isRefusedRead,
} from "./SecurityConnectedRecords";

/*
 * CONNECTED SIGNALS: what a security case, event or entity names in the rest
 * of OneUptime, and what is happening on it - the incidents and alerts open
 * on it, the monitors that watch it, what changed on it around the time.
 *
 * The records come from SecurityConnectedRecords (the rules are in
 * SecurityConnectionMatch); this reads their facts, for at most
 * SECURITY_CONNECTION_MAX_RESOURCES records, exact ones first, in a few
 * bounded reads in all (one per kind of fact and kind of record, never one
 * per record), each with the caller's own permissions. A fact the caller's
 * role cannot read, or that cannot be read now, is null - never zero.
 *
 * The case page's Connected Signals, an event's Connected tab, an entity's
 * page and OneUptime AI's triage all read it, so they say the same things.
 */

// The relation each kind of record has on incidents, alerts and monitors.
export const RECORD_RELATION_COLUMNS: Partial<
  Record<SecurityConnectionKind, string>
> = {
  [SecurityConnectionKind.Host]: "hosts",
  [SecurityConnectionKind.DockerHost]: "dockerHosts",
  [SecurityConnectionKind.PodmanHost]: "podmanHosts",
  [SecurityConnectionKind.KubernetesCluster]: "kubernetesClusters",
  [SecurityConnectionKind.Service]: "services",
};

// The most incidents, alerts and monitors read for one kind of record.
export const MAX_FACT_ROWS_READ: number = 100;

// The most change events read from a window (as an investigation reads them).
export const MAX_CHANGES_READ: number = 200;

// The most "Your logs" resources the events about a case are read for.
export const MAX_LOG_RESOURCES: number = 20;

interface CaseConnectionScope {
  entities: Array<SecurityEntity>;
  window: SecurityConnectionWindow;
  logResources: Array<SecurityLogResource>;
}

interface RecordFacts {
  activeIncidents: SecurityConnectionRecordListJson | null;
  activeAlerts: SecurityConnectionRecordListJson | null;
  monitors: SecurityConnectionRecordListJson | null;
  recentChanges: Array<SecurityConnectionChangeJson> | null;
  inventoryItemId?: string | undefined;
}

function recordKey(kind: SecurityConnectionKind, id: string): string {
  return `${kind}:${id}`;
}

function relatedIds(row: unknown, column: string): Array<string> {
  const related: unknown = (row as Record<string, unknown>)[column];

  if (!Array.isArray(related)) {
    return [];
  }

  return related
    .map((item: unknown): string => {
      const id: unknown =
        (item as { _id?: unknown; id?: unknown })?._id ||
        (item as { _id?: unknown; id?: unknown })?.id;

      return id ? id.toString() : "";
    })
    .filter(Boolean);
}

function addToList(
  lists: Map<string, SecurityConnectionRecordListJson>,
  key: string,
  item: SecurityConnectionRecordJson,
): void {
  const list: SecurityConnectionRecordListJson = lists.get(key) || {
    count: 0,
    items: [],
  };

  list.count += 1;

  if (list.items.length < SECURITY_CONNECTION_MAX_LISTED) {
    list.items.push(item);
  }

  lists.set(key, list);
}

/*
 * Links an incident about to be created to these records - the exact
 * connections of the case declaring it (readIncidentLinks) - through the
 * relations its Affected Resources show. Records of other kinds are left
 * out: an incident does not name them.
 */
export function linkIncidentToConnectedRecords(
  incident: Incident,
  records: ReadonlyArray<SecurityConnectedRecord>,
): void {
  const idsOf: (kind: SecurityConnectionKind) => Array<ObjectID> = (
    kind: SecurityConnectionKind,
  ): Array<ObjectID> => {
    return Array.from(
      new Set(
        records
          .filter((record: SecurityConnectedRecord): boolean => {
            return (
              record.kind === kind &&
              record.certainty === SecurityConnectionCertainty.Exact
            );
          })
          .map((record: SecurityConnectedRecord): string => {
            return record.id;
          }),
      ),
    ).map((id: string): ObjectID => {
      return new ObjectID(id);
    });
  };

  const hosts: Array<ObjectID> = idsOf(SecurityConnectionKind.Host);
  const dockerHosts: Array<ObjectID> = idsOf(SecurityConnectionKind.DockerHost);
  const podmanHosts: Array<ObjectID> = idsOf(SecurityConnectionKind.PodmanHost);
  const clusters: Array<ObjectID> = idsOf(
    SecurityConnectionKind.KubernetesCluster,
  );
  const services: Array<ObjectID> = idsOf(SecurityConnectionKind.Service);

  if (hosts.length > 0) {
    incident.hosts = hosts.map((id: ObjectID): Host => {
      return new Host(id);
    });
  }

  if (dockerHosts.length > 0) {
    incident.dockerHosts = dockerHosts.map((id: ObjectID): DockerHost => {
      return new DockerHost(id);
    });
  }

  if (podmanHosts.length > 0) {
    incident.podmanHosts = podmanHosts.map((id: ObjectID): PodmanHost => {
      return new PodmanHost(id);
    });
  }

  if (clusters.length > 0) {
    incident.kubernetesClusters = clusters.map(
      (id: ObjectID): KubernetesCluster => {
        return new KubernetesCluster(id);
      },
    );
  }

  if (services.length > 0) {
    incident.services = services.map((id: ObjectID): ServiceModel => {
      return new ServiceModel(id);
    });
  }
}

export function toConnectedResourceJson(
  record: SecurityConnectedRecord,
  facts: RecordFacts | undefined,
): SecurityConnectedResourceJson {
  return {
    kind: record.kind,
    id: record.id,
    name: record.name,
    certainty: record.certainty,
    matches: record.matches.map((match: SecurityConnectionMatch) => {
      return {
        entityType: match.entity.type,
        entityValue: match.entity.value,
        certainty: match.certainty,
        reason: match.reason,
        matchedValue: match.matchedValue,
      };
    }),
    activeIncidents: facts ? facts.activeIncidents : null,
    activeAlerts: facts ? facts.activeAlerts : null,
    monitors: facts ? facts.monitors : null,
    recentChanges: facts ? facts.recentChanges : null,
    ...(facts?.inventoryItemId
      ? { inventoryItemId: facts.inventoryItemId }
      : {}),
  };
}

export default class SecurityConnections {
  /*
   * What a case names: its entities, and the records the logs behind its
   * events were sent under, around its detections.
   */
  @CaptureSpan()
  public static async forCase(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<SecurityConnectionsJson | null> {
    const scope: CaseConnectionScope | null = await this.readCaseScope(data);

    if (!scope) {
      return null;
    }

    return await this.build({
      projectId: data.projectId,
      entities: scope.entities,
      logResources: scope.logResources,
      window: scope.window,
      props: data.props,
    });
  }

  /*
   * The records an incident a case declares is linked to: the case's
   * exact connections among the kinds an incident names (hosts, Docker
   * and Podman hosts, Kubernetes clusters, services), so the incident shows
   * on their pages and its investigation reads them. Read as OneUptime: the
   * server decides what the incident is about, from the case alone, and a
   * possible connection is never linked.
   */
  @CaptureSpan()
  public static async readIncidentLinks(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    now?: Date | undefined;
  }): Promise<Array<SecurityConnectedRecord>> {
    const props: DatabaseCommonInteractionProps = { isRoot: true };
    const scope: CaseConnectionScope | null = await this.readCaseScope({
      ...data,
      props,
    });

    if (!scope) {
      return [];
    }

    const resolved: SecurityConnectedRecordsResult =
      await SecurityConnectedRecords.resolve({
        projectId: data.projectId,
        entities: scope.entities,
        logResources: scope.logResources,
        props,
      });

    return resolved.records
      .filter((record: SecurityConnectedRecord): boolean => {
        return (
          record.certainty === SecurityConnectionCertainty.Exact &&
          Boolean(RECORD_RELATION_COLUMNS[record.kind])
        );
      })
      .slice(0, SECURITY_CONNECTION_MAX_RESOURCES);
  }

  // A case's entities, the logs behind its events and its window, as the caller may read them.
  private static async readCaseScope(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<CaseConnectionScope | null> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: {
          _id: true,
          projectId: true,
          entities: true,
          firstDetectedAt: true,
          lastDetectedAt: true,
          createdAt: true,
        },
        props: data.props,
      });

    if (!securityCase) {
      return null;
    }

    const window: SecurityConnectionWindow = getCaseConnectionWindow({
      firstDetectedAt: securityCase.firstDetectedAt,
      lastDetectedAt: securityCase.lastDetectedAt,
      createdAt: securityCase.createdAt,
      now: data.now || OneUptimeDate.getCurrentDate(),
    });
    const entities: Array<SecurityEntity> = readSecurityEntities(
      securityCase.entities,
    );

    return {
      entities,
      window,
      logResources: await this.readLogResources({
        projectId: data.projectId,
        entities,
        window,
        props: data.props,
      }),
    };
  }

  /*
   * What an event names - its entities, and the record its log line was
   * sent under - in the hour around it; or, with no time, what a set of
   * entities names around now.
   */
  @CaptureSpan()
  public static async forEntities(data: {
    projectId: ObjectID;
    entities: Array<SecurityEntity>;
    time?: Date | undefined;
    logResources?: Array<SecurityLogResource> | undefined;
    // Read the log resources behind these entities' events in the window too.
    readLogResources?: boolean | undefined;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<SecurityConnectionsJson> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const window: SecurityConnectionWindow = getEventConnectionWindow(
      data.time && data.time.getTime() <= now.getTime() ? data.time : now,
      now,
    );
    const logResources: Array<SecurityLogResource> = [
      ...(data.logResources || []),
    ];

    if (data.readLogResources) {
      logResources.push(
        ...(await this.readLogResources({
          projectId: data.projectId,
          entities: data.entities,
          window,
          props: data.props,
        })),
      );
    }

    return await this.build({
      projectId: data.projectId,
      entities: data.entities,
      logResources,
      window,
      props: data.props,
    });
  }

  /*
   * The records the logs behind events naming these entities were sent
   * under, in the window - of the events of the sources the reader may
   * read, as a read of the events would be (OneUptime's own read, as root,
   * reads every source). Enrichment: a read that fails, or that the reader
   * may not make, reads as none.
   */
  private static async readLogResources(data: {
    projectId: ObjectID;
    entities: Array<SecurityEntity>;
    window: SecurityConnectionWindow;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<SecurityLogResource>> {
    if (data.entities.length === 0) {
      return [];
    }

    try {
      return await SecurityEventService.findLogResourcesNaming({
        projectId: data.projectId,
        values: data.entities.map((entity: SecurityEntity): string => {
          return entity.value;
        }),
        startTime: data.window.start,
        endTime: data.window.end,
        limit: MAX_LOG_RESOURCES,
        serviceFilter: await TelemetryReadAccess.getServiceFilter({
          modelType: SecurityEvent,
          props: data.props,
        }),
      });
    } catch (error) {
      if (!isRefusedRead(error)) {
        logger.error(
          `Security connections: the logs behind the events could not be read: ${error}`,
        );
      }

      return [];
    }
  }

  @CaptureSpan()
  public static async build(data: {
    projectId: ObjectID;
    entities: ReadonlyArray<SecurityEntity>;
    logResources: ReadonlyArray<SecurityLogResource>;
    window: SecurityConnectionWindow;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityConnectionsJson> {
    const resolved: SecurityConnectedRecordsResult =
      await SecurityConnectedRecords.resolve({
        projectId: data.projectId,
        entities: data.entities,
        logResources: data.logResources,
        props: data.props,
      });

    const listed: Array<SecurityConnectedRecord> = resolved.records.slice(
      0,
      SECURITY_CONNECTION_MAX_RESOURCES,
    );
    const facts: Map<string, RecordFacts> = await this.readFacts({
      projectId: data.projectId,
      records: listed,
      window: data.window,
      props: data.props,
    });

    return {
      windowStart: data.window.start.toISOString(),
      windowEnd: data.window.end.toISOString(),
      resources: listed.map(
        (record: SecurityConnectedRecord): SecurityConnectedResourceJson => {
          return toConnectedResourceJson(
            record,
            facts.get(recordKey(record.kind, record.id)),
          );
        },
      ),
      hasMoreResources:
        resolved.records.length > SECURITY_CONNECTION_MAX_RESOURCES,
      unmatched: resolved.unmatched,
      unreadableKinds: resolved.unreadableKinds,
      failedKinds: resolved.failedKinds,
    };
  }

  // The facts of each record, by "kind:id". Each kind of fact is read once for every record.
  @CaptureSpan()
  public static async readFacts(data: {
    projectId: ObjectID;
    records: Array<SecurityConnectedRecord>;
    window: SecurityConnectionWindow;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, RecordFacts>> {
    const facts: Map<string, RecordFacts> = new Map();

    if (data.records.length === 0) {
      return facts;
    }

    const byKind: Map<SecurityConnectionKind, Array<string>> = new Map();

    for (const record of data.records) {
      const ids: Array<string> = byKind.get(record.kind) || [];
      ids.push(record.id);
      byKind.set(record.kind, ids);
    }

    const [incidents, alerts, monitors, changes, inventory]: [
      Map<string, SecurityConnectionRecordListJson> | null,
      Map<string, SecurityConnectionRecordListJson> | null,
      Map<string, SecurityConnectionRecordListJson> | null,
      Map<string, Array<SecurityConnectionChangeJson>> | null,
      Map<string, string>,
    ] = await Promise.all([
      this.readActiveIncidents({ ...data, byKind }),
      this.readActiveAlerts({ ...data, byKind }),
      this.readMonitors({ ...data, byKind }),
      this.readRecentChanges({ ...data, byKind }),
      this.readInventoryItems(data),
    ]);

    for (const record of data.records) {
      const key: string = recordKey(record.kind, record.id);
      const hasRelation: boolean = Boolean(
        RECORD_RELATION_COLUMNS[record.kind],
      );
      const empty: SecurityConnectionRecordListJson = { count: 0, items: [] };

      facts.set(key, {
        activeIncidents: hasRelation
          ? incidents
            ? incidents.get(key) || empty
            : null
          : null,
        activeAlerts: hasRelation
          ? alerts
            ? alerts.get(key) || empty
            : null
          : null,
        monitors: hasRelation
          ? monitors
            ? monitors.get(key) || empty
            : null
          : null,
        recentChanges:
          record.kind === SecurityConnectionKind.User ||
          record.kind === SecurityConnectionKind.NetworkDevice
            ? null
            : changes
              ? changes.get(key) || []
              : null,
        ...(inventory.get(key) ? { inventoryItemId: inventory.get(key) } : {}),
      });
    }

    return facts;
  }

  /*
   * Reads one kind of fact for every kind of record that has the relation:
   * a refusal or a failure of any of them reads as "not known" (null) for
   * the whole fact, so a number is never shown that leaves some out.
   */
  private static async readRelated<T>(data: {
    byKind: Map<SecurityConnectionKind, Array<string>>;
    label: string;
    read: (column: string, ids: Array<ObjectID>) => Promise<Array<T>>;
    toItem: (row: T) => SecurityConnectionRecordJson;
  }): Promise<Map<string, SecurityConnectionRecordListJson> | null> {
    const lists: Map<string, SecurityConnectionRecordListJson> = new Map();

    try {
      for (const [kind, ids] of Array.from(data.byKind.entries())) {
        const column: string | undefined = RECORD_RELATION_COLUMNS[kind];

        if (!column || ids.length === 0) {
          continue;
        }

        const wanted: Set<string> = new Set(ids);
        const rows: Array<T> = await data.read(
          column,
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        );

        for (const row of rows) {
          for (const id of relatedIds(row, column)) {
            if (wanted.has(id)) {
              addToList(lists, recordKey(kind, id), data.toItem(row));
            }
          }
        }
      }
    } catch (error) {
      if (!isRefusedRead(error)) {
        logger.error(
          `Security connections: the ${data.label} could not be read: ${error}`,
        );
      }

      return null;
    }

    return lists;
  }

  private static async readActiveIncidents(data: {
    projectId: ObjectID;
    byKind: Map<SecurityConnectionKind, Array<string>>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, SecurityConnectionRecordListJson> | null> {
    let unresolved: Array<ObjectID> = [];

    try {
      unresolved = await IncidentStateService.getUnresolvedIncidentStateIds(
        data.projectId,
      );
    } catch (error) {
      logger.error(
        `Security connections: the incident states could not be read: ${error}`,
      );
      return null;
    }

    if (unresolved.length === 0) {
      return new Map();
    }

    return await this.readRelated<Incident>({
      byKind: data.byKind,
      label: "active incidents",
      read: async (
        column: string,
        ids: Array<ObjectID>,
      ): Promise<Array<Incident>> => {
        return await IncidentService.findBy({
          query: {
            projectId: data.projectId,
            [column]: QueryHelper.inRelationArray(ids),
            currentIncidentStateId: QueryHelper.any(unresolved),
          } as never,
          select: {
            _id: true,
            title: true,
            incidentNumber: true,
            incidentNumberWithPrefix: true,
            currentIncidentState: { name: true, color: true },
            [column]: { _id: true },
          } as never,
          sort: { createdAt: SortOrder.Descending },
          limit: MAX_FACT_ROWS_READ,
          skip: 0,
          props: data.props,
        });
      },
      toItem: (incident: Incident): SecurityConnectionRecordJson => {
        return {
          id: incident.id?.toString() || "",
          title: incident.title || "",
          ...(incident.incidentNumberWithPrefix ||
          incident.incidentNumber !== undefined
            ? {
                number:
                  incident.incidentNumberWithPrefix ||
                  `#${incident.incidentNumber}`,
              }
            : {}),
          ...(incident.currentIncidentState?.name
            ? { stateName: incident.currentIncidentState.name }
            : {}),
          ...(incident.currentIncidentState?.color
            ? { stateColor: incident.currentIncidentState.color.toString() }
            : {}),
        };
      },
    });
  }

  private static async readActiveAlerts(data: {
    projectId: ObjectID;
    byKind: Map<SecurityConnectionKind, Array<string>>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, SecurityConnectionRecordListJson> | null> {
    let unresolved: Array<ObjectID> = [];

    try {
      unresolved = await AlertStateService.getUnresolvedAlertStateIds(
        data.projectId,
      );
    } catch (error) {
      logger.error(
        `Security connections: the alert states could not be read: ${error}`,
      );
      return null;
    }

    if (unresolved.length === 0) {
      return new Map();
    }

    return await this.readRelated<Alert>({
      byKind: data.byKind,
      label: "active alerts",
      read: async (
        column: string,
        ids: Array<ObjectID>,
      ): Promise<Array<Alert>> => {
        return await AlertService.findBy({
          query: {
            projectId: data.projectId,
            [column]: QueryHelper.inRelationArray(ids),
            currentAlertStateId: QueryHelper.any(unresolved),
          } as never,
          select: {
            _id: true,
            title: true,
            alertNumber: true,
            alertNumberWithPrefix: true,
            currentAlertState: { name: true, color: true },
            [column]: { _id: true },
          } as never,
          sort: { createdAt: SortOrder.Descending },
          limit: MAX_FACT_ROWS_READ,
          skip: 0,
          props: data.props,
        });
      },
      toItem: (alert: Alert): SecurityConnectionRecordJson => {
        return {
          id: alert.id?.toString() || "",
          title: alert.title || "",
          ...(alert.alertNumberWithPrefix || alert.alertNumber !== undefined
            ? {
                number: alert.alertNumberWithPrefix || `#${alert.alertNumber}`,
              }
            : {}),
          ...(alert.currentAlertState?.name
            ? { stateName: alert.currentAlertState.name }
            : {}),
          ...(alert.currentAlertState?.color
            ? { stateColor: alert.currentAlertState.color.toString() }
            : {}),
        };
      },
    });
  }

  private static async readMonitors(data: {
    projectId: ObjectID;
    byKind: Map<SecurityConnectionKind, Array<string>>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, SecurityConnectionRecordListJson> | null> {
    return await this.readRelated<Monitor>({
      byKind: data.byKind,
      label: "monitors",
      read: async (
        column: string,
        ids: Array<ObjectID>,
      ): Promise<Array<Monitor>> => {
        return await MonitorService.findBy({
          query: {
            projectId: data.projectId,
            [column]: QueryHelper.inRelationArray(ids),
          } as never,
          select: {
            _id: true,
            name: true,
            currentMonitorStatus: { name: true, color: true },
            [column]: { _id: true },
          } as never,
          sort: { name: SortOrder.Ascending },
          limit: MAX_FACT_ROWS_READ,
          skip: 0,
          props: data.props,
        });
      },
      toItem: (monitor: Monitor): SecurityConnectionRecordJson => {
        return {
          id: monitor.id?.toString() || "",
          title: monitor.name || "",
          ...(monitor.currentMonitorStatus?.name
            ? { stateName: monitor.currentMonitorStatus.name }
            : {}),
          ...(monitor.currentMonitorStatus?.color
            ? { stateColor: monitor.currentMonitorStatus.color.toString() }
            : {}),
        };
      },
    });
  }

  /*
   * What changed on each record in the window - a service's deploys, a
   * cluster's rollouts, a fix run on a host - the latest first.
   */
  private static async readRecentChanges(data: {
    projectId: ObjectID;
    byKind: Map<SecurityConnectionKind, Array<string>>;
    window: SecurityConnectionWindow;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, Array<SecurityConnectionChangeJson>> | null> {
    const keyOfId: Map<string, string> = new Map();

    for (const [kind, ids] of Array.from(data.byKind.entries())) {
      if (
        kind === SecurityConnectionKind.User ||
        kind === SecurityConnectionKind.NetworkDevice
      ) {
        continue;
      }

      for (const id of ids) {
        keyOfId.set(id, recordKey(kind, id));
      }
    }

    if (keyOfId.size === 0) {
      return new Map();
    }

    let rows: Array<ChangeEvent> = [];

    try {
      rows = await ChangeEventService.findBy({
        query: {
          projectId: data.projectId,
          time: new InBetween(data.window.start, data.window.end),
        } as never,
        select: {
          _id: true,
          time: true,
          eventType: true,
          title: true,
          primaryEntityId: true,
          attributes: true,
        } as never,
        sort: { time: SortOrder.Descending } as never,
        limit: MAX_CHANGES_READ,
        skip: 0,
        props: data.props,
      });
    } catch (error) {
      if (!isRefusedRead(error)) {
        logger.error(
          `Security connections: the recent changes could not be read: ${error}`,
        );
      }

      return null;
    }

    const changes: Map<string, Array<SecurityConnectionChangeJson>> = new Map();

    for (const row of rows) {
      if (!row.time) {
        continue;
      }

      const fields: ChangeEventFields = readChangeEventFields(
        (row.attributes as Dictionary<unknown>) || {},
      );
      const keys: Set<string> = new Set();

      for (const id of [
        row.primaryEntityId?.toString(),
        fields.kubernetesClusterId,
        fields.resourceId,
      ]) {
        const key: string | undefined = id ? keyOfId.get(id) : undefined;

        if (key) {
          keys.add(key);
        }
      }

      for (const key of Array.from(keys)) {
        const list: Array<SecurityConnectionChangeJson> =
          changes.get(key) || [];

        if (list.length < SECURITY_CONNECTION_MAX_LISTED) {
          list.push({
            id: row._id?.toString() || "",
            time: new Date(row.time).toISOString(),
            title: row.title || "",
            eventType: row.eventType || "change",
          });
        }

        changes.set(key, list);
      }
    }

    return changes;
  }

  /*
   * Each record's inventory item, found by the key Inventory gives it: a
   * host by its host.name, a cluster by its k8s.cluster.name, a service by
   * its name, a mirrored record by its id. Best effort: no item, no link.
   */
  private static async readInventoryItems(data: {
    projectId: ObjectID;
    records: Array<SecurityConnectedRecord>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, string>> {
    const projectId: string = data.projectId.toString();
    const recordOfKey: Map<string, string> = new Map();

    for (const record of data.records) {
      let key: string | null = null;

      switch (record.kind) {
        case SecurityConnectionKind.Host:
          key = record.identity ? keyForHost(projectId, record.identity) : null;
          break;
        case SecurityConnectionKind.KubernetesCluster:
          key = record.identity
            ? keyForKubernetesCluster(projectId, record.identity)
            : null;
          break;
        case SecurityConnectionKind.Service:
          key = record.identity
            ? keyForService(projectId, record.identity)
            : null;
          break;
        case SecurityConnectionKind.DockerHost:
          key = keyForInventoryEntity(
            projectId,
            EntityType.DockerHost,
            record.id,
          );
          break;
        case SecurityConnectionKind.PodmanHost:
          key = keyForInventoryEntity(
            projectId,
            EntityType.PodmanHost,
            record.id,
          );
          break;
        case SecurityConnectionKind.NetworkDevice:
          key = keyForInventoryEntity(
            projectId,
            EntityType.NetworkDevice,
            record.id,
          );
          break;
        default:
          key = null;
      }

      if (key) {
        recordOfKey.set(key, recordKey(record.kind, record.id));
      }
    }

    const items: Map<string, string> = new Map();

    if (recordOfKey.size === 0) {
      return items;
    }

    try {
      const rows: Array<InventoryItem> = await InventoryItemService.findBy({
        query: {
          projectId: data.projectId,
          entityKey: QueryHelper.any(Array.from(recordOfKey.keys())),
        } as never,
        select: { _id: true, entityKey: true },
        limit: recordOfKey.size,
        skip: 0,
        props: data.props,
      });

      for (const row of rows) {
        const key: string | undefined = row.entityKey
          ? recordOfKey.get(row.entityKey)
          : undefined;

        if (key && row.id) {
          items.set(key, row.id.toString());
        }
      }
    } catch (error) {
      if (!isRefusedRead(error)) {
        logger.error(
          `Security connections: the inventory items could not be read: ${error}`,
        );
      }
    }

    return items;
  }
}
