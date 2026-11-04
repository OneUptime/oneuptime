import Alert from "../../../../Models/DatabaseModels/Alert";
import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import Incident from "../../../../Models/DatabaseModels/Incident";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import {
  AiAffectedResourceKind,
  AiAffectedResourceRef,
  getAiAffectedResourceKindInfo,
} from "../../../../Types/AI/AiAffectedResources";
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
  SecurityConnectionScheduleJson,
  SecurityConnectionScheduleListJson,
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
  CloudChangeTitleFacts,
  readCloudChangeTitleFacts,
} from "../../../../Utils/Telemetry/CloudChangeTitle";
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
import OnCallDutyPolicyScheduleLayerUserService from "../../../Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../Services/OnCallDutyPolicyScheduleService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import SecurityEventService from "../../../Services/SecurityEventService";
import TeamMemberService from "../../../Services/TeamMemberService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import TelemetryReadAccess from "../../Telemetry/TelemetryReadAccess";
import {
  getDistinctAffectedResources,
  setAffectedResourcesOnNewRecord,
} from "../../AffectedResources/AffectedResourceLists";
import SecurityConnectedRecords, {
  SecurityConnectedRecord,
  SecurityConnectedRecordsResult,
  isRefusedRead,
} from "./SecurityConnectedRecords";

/*
 * CONNECTED SIGNALS: what a security case, event or entity names in the rest
 * of OneUptime, and what is happening on it - the incidents and alerts open
 * on it, the monitors that watch it (and a monitor's own status), what
 * changed on it around the time, and for a member the on-call schedules
 * they are on (on call now or not) and the teams they are in.
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

/*
 * The kind of affected resource each kind of record is on an incident or an
 * alert (Types/AI/AiAffectedResources): what an incident or alert a case, a
 * playbook or a detection opens is linked to, through that kind's list. A
 * monitor, a serverless function and a member are never one: an incident on
 * a monitor can change its status and show on the status pages that list
 * it, and an incident has no list of the others.
 */
export const CONNECTION_KIND_AFFECTED_RESOURCES: Readonly<
  Partial<Record<SecurityConnectionKind, AiAffectedResourceKind>>
> = {
  [SecurityConnectionKind.Host]: AiAffectedResourceKind.Host,
  [SecurityConnectionKind.DockerHost]: AiAffectedResourceKind.DockerHost,
  [SecurityConnectionKind.PodmanHost]: AiAffectedResourceKind.PodmanHost,
  [SecurityConnectionKind.KubernetesCluster]:
    AiAffectedResourceKind.KubernetesCluster,
  // Listed on incidents and alerts since #5341.
  [SecurityConnectionKind.NetworkDevice]: AiAffectedResourceKind.NetworkDevice,
  [SecurityConnectionKind.CloudResource]: AiAffectedResourceKind.CloudResource,
  [SecurityConnectionKind.Service]: AiAffectedResourceKind.Service,
};

/*
 * The relation each kind of record has on incidents and alerts (their
 * Affected Resources): what a record's active incidents and alerts are read
 * through, and the list an incident or alert linked to it holds it in.
 */
export const RECORD_RELATION_COLUMNS: Partial<
  Record<SecurityConnectionKind, string>
> = Object.fromEntries(
  Object.entries(CONNECTION_KIND_AFFECTED_RESOURCES).map(
    ([kind, affectedKind]: [string, AiAffectedResourceKind]): [
      string,
      string,
    ] => {
      return [kind, getAiAffectedResourceKindInfo(affectedKind).relation];
    },
  ),
) as Partial<Record<SecurityConnectionKind, string>>;

/*
 * The relation each kind of record has on monitors (the resources a monitor
 * names): what the monitors that watch a record are read through. A monitor
 * lists no network device - a Network Device monitor names its device in
 * its step - so a device's monitors are not read this way.
 */
export const MONITOR_RELATION_COLUMNS: Partial<
  Record<SecurityConnectionKind, string>
> = {
  [SecurityConnectionKind.Host]: "hosts",
  [SecurityConnectionKind.DockerHost]: "dockerHosts",
  [SecurityConnectionKind.PodmanHost]: "podmanHosts",
  [SecurityConnectionKind.KubernetesCluster]: "kubernetesClusters",
  [SecurityConnectionKind.CloudResource]: "cloudResources",
  [SecurityConnectionKind.Service]: "services",
};

/*
 * A monitor's own incidents (an incident's Monitors Affected) and alerts
 * (the alert's monitor). A monitor is never linked to an incident a case
 * declares: an incident on a monitor can change its status and show on
 * the status pages that list it, and a security incident is not for them.
 */
export const MONITOR_INCIDENTS_COLUMN: string = "monitors";
export const MONITOR_ALERTS_COLUMN: string = "monitorId";

// How one kind of fact names a kind of record: a list relation, or one id.
export interface FactRelation {
  column: string;
  isList: boolean;
}

export function incidentRelation(
  kind: SecurityConnectionKind,
): FactRelation | null {
  if (kind === SecurityConnectionKind.Monitor) {
    return { column: MONITOR_INCIDENTS_COLUMN, isList: true };
  }

  const column: string | undefined = RECORD_RELATION_COLUMNS[kind];

  return column ? { column, isList: true } : null;
}

export function alertRelation(
  kind: SecurityConnectionKind,
): FactRelation | null {
  if (kind === SecurityConnectionKind.Monitor) {
    return { column: MONITOR_ALERTS_COLUMN, isList: false };
  }

  const column: string | undefined = RECORD_RELATION_COLUMNS[kind];

  return column ? { column, isList: true } : null;
}

export function monitorRelation(
  kind: SecurityConnectionKind,
): FactRelation | null {
  const column: string | undefined = MONITOR_RELATION_COLUMNS[kind];

  return column ? { column, isList: true } : null;
}

// The kinds whose changes are read: not a person's, a device's or a monitor's.
export function hasRecentChanges(kind: SecurityConnectionKind): boolean {
  return (
    kind !== SecurityConnectionKind.User &&
    kind !== SecurityConnectionKind.NetworkDevice &&
    kind !== SecurityConnectionKind.Monitor
  );
}

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
  // A member's: null when they could not be read.
  onCallSchedules?: SecurityConnectionScheduleListJson | null | undefined;
  teams?: SecurityConnectionRecordListJson | null | undefined;
}

function recordKey(kind: SecurityConnectionKind, id: string): string {
  return `${kind}:${id}`;
}

// The records a fact is read for: in a list relation, or one id column.
export function relationQuery(
  relation: FactRelation,
  ids: Array<ObjectID>,
): unknown {
  return relation.isList
    ? QueryHelper.inRelationArray(ids)
    : QueryHelper.any(ids);
}

export function relationSelect(relation: FactRelation): unknown {
  return relation.isList ? { _id: true } : true;
}

export function relatedIds(
  row: unknown,
  relation: FactRelation,
): Array<string> {
  const related: unknown = (row as Record<string, unknown>)[relation.column];

  if (!relation.isList) {
    return related ? [related.toString()] : [];
  }

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
 * What these records are as an incident's or an alert's affected
 * resources: the exact ones of a kind an incident or alert lists
 * (CONNECTION_KIND_AFFECTED_RESOURCES), each once. A possible connection is
 * never one - a name two machines share must never link the wrong one.
 */
export function getConnectedRecordAffectedResources(
  records: ReadonlyArray<SecurityConnectedRecord>,
): Array<AiAffectedResourceRef> {
  const refs: Array<AiAffectedResourceRef> = [];

  for (const record of records) {
    const kind: AiAffectedResourceKind | undefined =
      CONNECTION_KIND_AFFECTED_RESOURCES[record.kind];

    if (kind && record.certainty === SecurityConnectionCertainty.Exact) {
      refs.push({ kind, id: record.id });
    }
  }

  return getDistinctAffectedResources(refs);
}

/*
 * Links an incident or alert about to be created to these records - the
 * exact connections of the case declaring it (readIncidentLinks), or of the
 * detection opening it (readEntityLinks) - through the lists its Affected
 * Resources show. Records of other kinds are left out: it does not name
 * them. Returns what it linked.
 */
export function linkRecordToConnectedRecords(
  record: Incident | Alert,
  records: ReadonlyArray<SecurityConnectedRecord>,
): Array<AiAffectedResourceRef> {
  return setAffectedResourcesOnNewRecord(
    record,
    getConnectedRecordAffectedResources(records),
  );
}

// The records an incident or alert may be linked to, of those connected.
function getLinkableRecords(
  records: ReadonlyArray<SecurityConnectedRecord>,
): Array<SecurityConnectedRecord> {
  return records
    .filter((record: SecurityConnectedRecord): boolean => {
      return (
        record.certainty === SecurityConnectionCertainty.Exact &&
        Boolean(CONNECTION_KIND_AFFECTED_RESOURCES[record.kind])
      );
    })
    .slice(0, SECURITY_CONNECTION_MAX_RESOURCES);
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
    ...(record.status ? { status: record.status } : {}),
    // A member's schedules and teams, as read (null) or not read at all.
    ...(record.kind === SecurityConnectionKind.User
      ? {
          onCallSchedules: facts?.onCallSchedules ?? null,
          teams: facts?.teams ?? null,
        }
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
   * The records an incident a case declares - or the alert a playbook pages
   * with - is linked to: the case's exact connections among the kinds an
   * incident names (hosts, Docker and Podman hosts, Kubernetes clusters,
   * network devices, cloud resources, services), so it shows on their pages
   * and its investigation reads them. Read as OneUptime: the server decides
   * what the incident is about, from the case alone, and a possible
   * connection is never linked.
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

    return getLinkableRecords(resolved.records);
  }

  /*
   * The records the alert or incident a detection opens is linked to - a
   * detection rule's match, a threat intel feed's - read as its case would
   * read them: what its entities name exactly, and the records the logs
   * behind its events were sent under, in its window ("Your logs" events
   * carry the host, service or cluster that sent them), among the kinds an
   * incident or alert names. Read as OneUptime, like readIncidentLinks: the
   * server decides what the alert is about, from the detection alone.
   */
  @CaptureSpan()
  public static async readEntityLinks(data: {
    projectId: ObjectID;
    entities: Array<SecurityEntity>;
    window: SecurityConnectionWindow;
  }): Promise<Array<SecurityConnectedRecord>> {
    if (data.entities.length === 0) {
      return [];
    }

    const props: DatabaseCommonInteractionProps = { isRoot: true };

    const resolved: SecurityConnectedRecordsResult =
      await SecurityConnectedRecords.resolve({
        projectId: data.projectId,
        entities: data.entities,
        logResources: await this.readLogResources({
          projectId: data.projectId,
          entities: data.entities,
          window: data.window,
          props,
        }),
        props,
      });

    return getLinkableRecords(resolved.records);
  }

  /*
   * A case's entities and its window, as the caller may read the case: what
   * its Connected Signals, and its logs and traces (SecurityTelemetryMentions),
   * are read over. Null when the case is not the caller's to read.
   */
  @CaptureSpan()
  public static async readCaseWindow(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<{
    entities: Array<SecurityEntity>;
    window: SecurityConnectionWindow;
  } | null> {
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

    return {
      entities: readSecurityEntities(securityCase.entities),
      window: getCaseConnectionWindow({
        firstDetectedAt: securityCase.firstDetectedAt,
        lastDetectedAt: securityCase.lastDetectedAt,
        createdAt: securityCase.createdAt,
        now: data.now || OneUptimeDate.getCurrentDate(),
      }),
    };
  }

  // A case's entities, the logs behind its events and its window, as the caller may read them.
  private static async readCaseScope(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<CaseConnectionScope | null> {
    const caseWindow: {
      entities: Array<SecurityEntity>;
      window: SecurityConnectionWindow;
    } | null = await this.readCaseWindow(data);

    if (!caseWindow) {
      return null;
    }

    return {
      entities: caseWindow.entities,
      window: caseWindow.window,
      logResources: await this.readLogResources({
        projectId: data.projectId,
        entities: caseWindow.entities,
        window: caseWindow.window,
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

    const memberIds: Array<string> =
      byKind.get(SecurityConnectionKind.User) || [];

    const [incidents, alerts, monitors, changes, inventory, schedules, teams]: [
      Map<string, SecurityConnectionRecordListJson> | null,
      Map<string, SecurityConnectionRecordListJson> | null,
      Map<string, SecurityConnectionRecordListJson> | null,
      Map<string, Array<SecurityConnectionChangeJson>> | null,
      Map<string, string>,
      Map<string, SecurityConnectionScheduleListJson> | null,
      Map<string, SecurityConnectionRecordListJson> | null,
    ] = await Promise.all([
      this.readActiveIncidents({ ...data, byKind }),
      this.readActiveAlerts({ ...data, byKind }),
      this.readMonitors({ ...data, byKind }),
      this.readRecentChanges({ ...data, byKind }),
      this.readInventoryItems(data),
      this.readMemberSchedules({ ...data, userIds: memberIds }),
      this.readMemberTeams({ ...data, userIds: memberIds }),
    ]);

    for (const record of data.records) {
      const key: string = recordKey(record.kind, record.id);
      const empty: SecurityConnectionRecordListJson = { count: 0, items: [] };
      const isMember: boolean = record.kind === SecurityConnectionKind.User;

      facts.set(key, {
        activeIncidents: incidentRelation(record.kind)
          ? incidents
            ? incidents.get(key) || empty
            : null
          : null,
        activeAlerts: alertRelation(record.kind)
          ? alerts
            ? alerts.get(key) || empty
            : null
          : null,
        monitors: monitorRelation(record.kind)
          ? monitors
            ? monitors.get(key) || empty
            : null
          : null,
        recentChanges: hasRecentChanges(record.kind)
          ? changes
            ? changes.get(key) || []
            : null
          : null,
        ...(inventory.get(key) ? { inventoryItemId: inventory.get(key) } : {}),
        ...(isMember
          ? {
              onCallSchedules: schedules
                ? schedules.get(record.id) || { count: 0, items: [] }
                : null,
              teams: teams ? teams.get(record.id) || empty : null,
            }
          : {}),
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
    relationOf: (kind: SecurityConnectionKind) => FactRelation | null;
    read: (relation: FactRelation, ids: Array<ObjectID>) => Promise<Array<T>>;
    toItem: (row: T) => SecurityConnectionRecordJson;
  }): Promise<Map<string, SecurityConnectionRecordListJson> | null> {
    const lists: Map<string, SecurityConnectionRecordListJson> = new Map();

    try {
      for (const [kind, ids] of Array.from(data.byKind.entries())) {
        const relation: FactRelation | null = data.relationOf(kind);

        if (!relation || ids.length === 0) {
          continue;
        }

        const wanted: Set<string> = new Set(ids);
        const rows: Array<T> = await data.read(
          relation,
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        );

        for (const row of rows) {
          for (const id of relatedIds(row, relation)) {
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
      relationOf: incidentRelation,
      read: async (
        relation: FactRelation,
        ids: Array<ObjectID>,
      ): Promise<Array<Incident>> => {
        return await IncidentService.findBy({
          query: {
            projectId: data.projectId,
            [relation.column]: relationQuery(relation, ids),
            currentIncidentStateId: QueryHelper.any(unresolved),
          } as never,
          select: {
            _id: true,
            title: true,
            incidentNumber: true,
            incidentNumberWithPrefix: true,
            currentIncidentState: { name: true, color: true },
            [relation.column]: relationSelect(relation),
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
      relationOf: alertRelation,
      read: async (
        relation: FactRelation,
        ids: Array<ObjectID>,
      ): Promise<Array<Alert>> => {
        return await AlertService.findBy({
          query: {
            projectId: data.projectId,
            [relation.column]: relationQuery(relation, ids),
            currentAlertStateId: QueryHelper.any(unresolved),
          } as never,
          select: {
            _id: true,
            title: true,
            alertNumber: true,
            alertNumberWithPrefix: true,
            currentAlertState: { name: true, color: true },
            [relation.column]: relationSelect(relation),
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
      relationOf: monitorRelation,
      read: async (
        relation: FactRelation,
        ids: Array<ObjectID>,
      ): Promise<Array<Monitor>> => {
        return await MonitorService.findBy({
          query: {
            projectId: data.projectId,
            [relation.column]: relationQuery(relation, ids),
          } as never,
          select: {
            _id: true,
            name: true,
            currentMonitorStatus: { name: true, color: true },
            [relation.column]: relationSelect(relation),
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
   * The on-call schedules each member is on - those whose rotation lists
   * them, and those they are on call for now (an override puts someone on
   * call without a rotation) - by member id, the ones they are on call for
   * now first, then by name. With the caller's own permissions: a role that
   * cannot read schedules is told nothing about them (null), and so is
   * everyone when a read fails.
   */
  private static async readMemberSchedules(data: {
    projectId: ObjectID;
    userIds: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, SecurityConnectionScheduleListJson> | null> {
    const lists: Map<string, SecurityConnectionScheduleListJson> = new Map();

    if (data.userIds.length === 0) {
      return lists;
    }

    const userIds: Array<ObjectID> = data.userIds.map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    );

    try {
      const [layerUsers, onCallNow]: [
        Array<OnCallDutyPolicyScheduleLayerUser>,
        Array<OnCallDutyPolicySchedule>,
      ] = await Promise.all([
        OnCallDutyPolicyScheduleLayerUserService.findBy({
          query: {
            projectId: data.projectId,
            userId: QueryHelper.any(userIds),
          },
          select: { userId: true, onCallDutyPolicyScheduleId: true },
          limit: MAX_FACT_ROWS_READ,
          skip: 0,
          props: data.props,
        }),
        OnCallDutyPolicyScheduleService.findBy({
          query: {
            projectId: data.projectId,
            currentUserIdOnRoster: QueryHelper.any(userIds),
          },
          select: { _id: true, name: true, currentUserIdOnRoster: true },
          sort: { name: SortOrder.Ascending },
          limit: MAX_FACT_ROWS_READ,
          skip: 0,
          props: data.props,
        }),
      ]);

      // Every schedule a member is on: by their rotation, or on call now.
      const scheduleIdsOf: Map<string, Set<string>> = new Map();
      const add: (userId: string, scheduleId: string) => void = (
        userId: string,
        scheduleId: string,
      ): void => {
        const ids: Set<string> = scheduleIdsOf.get(userId) || new Set();
        ids.add(scheduleId);
        scheduleIdsOf.set(userId, ids);
      };

      for (const layerUser of layerUsers) {
        const userId: string = layerUser.userId?.toString() || "";
        const scheduleId: string =
          layerUser.onCallDutyPolicyScheduleId?.toString() || "";

        if (userId && scheduleId) {
          add(userId, scheduleId);
        }
      }

      const names: Map<string, string> = new Map();
      const onCallFor: Set<string> = new Set();

      for (const schedule of onCallNow) {
        const scheduleId: string = schedule.id?.toString() || "";
        const userId: string = schedule.currentUserIdOnRoster?.toString() || "";

        if (scheduleId && userId) {
          names.set(scheduleId, schedule.name || "");
          onCallFor.add(`${userId}:${scheduleId}`);
          add(userId, scheduleId);
        }
      }

      // The names of the schedules their rotations list, as the caller may read them.
      const unnamed: Array<ObjectID> = Array.from(
        new Set(
          Array.from(scheduleIdsOf.values()).flatMap(
            (ids: Set<string>): Array<string> => {
              return Array.from(ids);
            },
          ),
        ),
      )
        .filter((id: string): boolean => {
          return !names.has(id);
        })
        .map((id: string): ObjectID => {
          return new ObjectID(id);
        });

      if (unnamed.length > 0) {
        const schedules: Array<OnCallDutyPolicySchedule> =
          await OnCallDutyPolicyScheduleService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(unnamed),
            },
            select: { _id: true, name: true },
            limit: unnamed.length,
            skip: 0,
            props: data.props,
          });

        for (const schedule of schedules) {
          if (schedule.id) {
            names.set(schedule.id.toString(), schedule.name || "");
          }
        }
      }

      for (const [userId, scheduleIds] of Array.from(scheduleIdsOf.entries())) {
        const schedules: Array<SecurityConnectionScheduleJson> = Array.from(
          scheduleIds,
        )
          // A schedule the caller cannot read is not theirs to be told of.
          .filter((scheduleId: string): boolean => {
            return names.has(scheduleId);
          })
          .map((scheduleId: string): SecurityConnectionScheduleJson => {
            return {
              id: scheduleId,
              name: names.get(scheduleId) || "",
              isOnCallNow: onCallFor.has(`${userId}:${scheduleId}`),
            };
          })
          .sort(
            (
              a: SecurityConnectionScheduleJson,
              b: SecurityConnectionScheduleJson,
            ): number => {
              if (a.isOnCallNow !== b.isOnCallNow) {
                return a.isOnCallNow ? -1 : 1;
              }

              return a.name.localeCompare(b.name);
            },
          );

        lists.set(userId, {
          count: schedules.length,
          items: schedules.slice(0, SECURITY_CONNECTION_MAX_LISTED),
        });
      }
    } catch (error) {
      if (!isRefusedRead(error)) {
        logger.error(
          `Security connections: the members' on-call schedules could not be read: ${error}`,
        );
      }

      return null;
    }

    return lists;
  }

  /*
   * The teams each member is in (who to reach about the account), by
   * member id, by name: only the teams they joined - an invitation not yet
   * accepted is no membership. With the caller's own permissions.
   */
  private static async readMemberTeams(data: {
    projectId: ObjectID;
    userIds: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, SecurityConnectionRecordListJson> | null> {
    const lists: Map<string, SecurityConnectionRecordListJson> = new Map();

    if (data.userIds.length === 0) {
      return lists;
    }

    try {
      const memberships: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          projectId: data.projectId,
          userId: QueryHelper.any(
            data.userIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          hasAcceptedInvitation: true,
        },
        select: { userId: true, teamId: true, team: { name: true } },
        limit: MAX_FACT_ROWS_READ,
        skip: 0,
        props: data.props,
      });
      const teamsOf: Map<string, Map<string, string>> = new Map();

      for (const membership of memberships) {
        const userId: string = membership.userId?.toString() || "";
        const teamId: string = membership.teamId?.toString() || "";

        if (!userId || !teamId) {
          continue;
        }

        const teams: Map<string, string> = teamsOf.get(userId) || new Map();
        teams.set(teamId, membership.team?.name || "");
        teamsOf.set(userId, teams);
      }

      for (const [userId, teams] of Array.from(teamsOf.entries())) {
        const items: Array<SecurityConnectionRecordJson> = Array.from(
          teams.entries(),
        )
          .map(
            ([id, title]: [string, string]): SecurityConnectionRecordJson => {
              return { id, title };
            },
          )
          .sort(
            (
              a: SecurityConnectionRecordJson,
              b: SecurityConnectionRecordJson,
            ): number => {
              return a.title.localeCompare(b.title);
            },
          );

        lists.set(userId, {
          count: items.length,
          items: items.slice(0, SECURITY_CONNECTION_MAX_LISTED),
        });
      }
    } catch (error) {
      if (!isRefusedRead(error)) {
        logger.error(
          `Security connections: the members' teams could not be read: ${error}`,
        );
      }

      return null;
    }

    return lists;
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
      if (!hasRecentChanges(kind)) {
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

      // A cloud change's title is worded from these on the page.
      const cloudChange: CloudChangeTitleFacts | null =
        readCloudChangeTitleFacts({
          title: row.title,
          attributes: (row.attributes as Dictionary<unknown>) || {},
        });

      for (const key of Array.from(keys)) {
        const list: Array<SecurityConnectionChangeJson> =
          changes.get(key) || [];

        if (list.length < SECURITY_CONNECTION_MAX_LISTED) {
          list.push({
            id: row._id?.toString() || "",
            time: new Date(row.time).toISOString(),
            title: row.title || "",
            eventType: row.eventType || "change",
            ...(cloudChange ? { cloudChange } : {}),
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
