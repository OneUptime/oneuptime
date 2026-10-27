import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import NetworkFlow from "../../../../Models/AnalyticsModels/NetworkFlow";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import Host from "../../../../Models/DatabaseModels/Host";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../../Models/DatabaseModels/InventoryItemRelationship";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_CASE_IMPACT_DEPENDENCY_WINDOW_IN_DAYS,
  SECURITY_CASE_IMPACT_MAX_FLOW_ADDRESSES,
  SECURITY_CASE_IMPACT_MAX_FLOW_PEERS,
  SECURITY_CASE_IMPACT_MAX_OWNERS,
  SECURITY_CASE_IMPACT_MAX_STATUS_PAGES,
  SecurityCaseFlowPeerJson,
  SecurityCaseImpactJson,
  SecurityCaseImpactOwnersJson,
  SecurityCaseImpactPeerJson,
  SecurityCaseImpactRecordJson,
  SecurityCaseImpactSource,
  SecurityCaseImpactStatusPageJson,
} from "../../../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectedResourceJson,
  SecurityConnectionChangeJson,
  SecurityConnectionKind,
  SecurityConnectionsJson,
} from "../../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import SecurityEventRequestOutcome from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { TopologyEntityResponseJSON } from "../../../../Types/Topology/TopologyApi";
import {
  ReachedRequest,
  RecordAddress,
  buildInternetExposure,
  pickLastChange,
  toImpactPeers,
} from "../../../../Utils/SecurityCase/SecurityCaseImpactFacts";
import { readClickhouseTime } from "../../../../Utils/SecurityCase/SecurityCaseStoryItems";
import {
  canonicalAddress,
  readRecordAddresses,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import { readChangeEventFields } from "../../../../Utils/Telemetry/ChangeEventFields";
import ChangeEventService from "../../../Services/ChangeEventService";
import DockerHostOwnerTeamService from "../../../Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "../../../Services/DockerHostOwnerUserService";
import HostOwnerTeamService from "../../../Services/HostOwnerTeamService";
import HostOwnerUserService from "../../../Services/HostOwnerUserService";
import HostService from "../../../Services/HostService";
import InventoryItemService from "../../../Services/InventoryItemService";
import KubernetesClusterOwnerTeamService from "../../../Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "../../../Services/KubernetesClusterOwnerUserService";
import MonitorService from "../../../Services/MonitorService";
import NetworkDeviceOwnerTeamService from "../../../Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "../../../Services/NetworkDeviceOwnerUserService";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import NetworkFlowService from "../../../Services/NetworkFlowService";
import PodmanHostOwnerTeamService from "../../../Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "../../../Services/PodmanHostOwnerUserService";
import SecurityEventService, {
  SECURITY_CONNECTION_READ_TIME_LIMIT,
} from "../../../Services/SecurityEventService";
import ServiceOwnerTeamService from "../../../Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../Services/ServiceOwnerUserService";
import StatusPageResourceService from "../../../Services/StatusPageResourceService";
import ModelPermission from "../../../Types/Database/Permissions/Index";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import NetworkTrafficSummaryUtil from "../../NetworkFlow/NetworkTrafficSummary";
import SecurityConnections, {
  RECORD_RELATION_COLUMNS,
} from "../../SecurityEvent/Connections/SecurityConnections";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import TelemetryReadAccess from "../../Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../Telemetry/TelemetryReadScope";
import TopologyConcurrencyLimiter from "../../Topology/TopologyConcurrencyLimiter";
import TopologyQueries from "../../Topology/TopologyQueries";
import {
  SecurityCaseContextScope,
  SecurityCaseSourceTracker,
  readSecurityCaseContextScope,
} from "./SecurityCaseContextScope";

/*
 * WHAT A SECURITY CASE PUTS AT RISK (Types/SecurityCase/SecurityCaseContext.ts
 * says what it holds), from what the rest of OneUptime knows about the
 * records the case names - the ones Connected Signals lists:
 *
 *   dependencies   what each record calls, what calls it and what it runs on,
 *                  on the service map (its inventory item's connections over
 *                  the last week);
 *   monitors,      the monitors watching each record (as Connected Signals
 *   status pages   counts them) and the status pages that show them;
 *   owners         the teams and people who own each record;
 *   changes        what last changed on each record before the case's first
 *                  detection: the deploy an attack may have found;
 *   network flows  the machines the case's addresses exchanged traffic with;
 *   internet       whether OneUptime has seen the records reached from the
 *                  internet - only on evidence (Utils/SecurityCase/
 *                  SecurityCaseImpactFacts.ts), "unknown" otherwise.
 *
 * With the reader's own permissions, each source on its own: one their role
 * cannot read is said to be, one that fails is said to have, and the rest
 * is still told. Every read is bounded.
 */

// How far back a record's last change is looked for, before the case's window.
export const IMPACT_CHANGE_LOOKBACK_IN_DAYS: number = 7;
// The most changes read to find each record's last.
export const IMPACT_MAX_CHANGES_READ: number = 200;
// The most monitors read to find the status pages showing them.
export const IMPACT_MAX_MONITORS_READ: number = 100;
// The most events read for requests from public addresses that reached the app.
export const IMPACT_MAX_REACHED_REQUESTS: number = 50;

function recordKey(kind: SecurityConnectionKind, id: string): string {
  return `${kind}:${id}`;
}

// Reads one kind of owner row: a team's or a user's, for one kind of record.
interface OwnerRowsReader {
  findBy(data: unknown): Promise<Array<unknown>>;
}

interface OwnerTables {
  column: string;
  teams: OwnerRowsReader;
  users: OwnerRowsReader;
}

// Who can own each kind of record, and where that is kept.
const OWNER_TABLES: Partial<Record<SecurityConnectionKind, OwnerTables>> = {
  [SecurityConnectionKind.Service]: {
    column: "serviceId",
    teams: ServiceOwnerTeamService as unknown as OwnerRowsReader,
    users: ServiceOwnerUserService as unknown as OwnerRowsReader,
  },
  [SecurityConnectionKind.Host]: {
    column: "hostId",
    teams: HostOwnerTeamService as unknown as OwnerRowsReader,
    users: HostOwnerUserService as unknown as OwnerRowsReader,
  },
  [SecurityConnectionKind.KubernetesCluster]: {
    column: "kubernetesClusterId",
    teams: KubernetesClusterOwnerTeamService as unknown as OwnerRowsReader,
    users: KubernetesClusterOwnerUserService as unknown as OwnerRowsReader,
  },
  [SecurityConnectionKind.DockerHost]: {
    column: "dockerHostId",
    teams: DockerHostOwnerTeamService as unknown as OwnerRowsReader,
    users: DockerHostOwnerUserService as unknown as OwnerRowsReader,
  },
  [SecurityConnectionKind.PodmanHost]: {
    column: "podmanHostId",
    teams: PodmanHostOwnerTeamService as unknown as OwnerRowsReader,
    users: PodmanHostOwnerUserService as unknown as OwnerRowsReader,
  },
  [SecurityConnectionKind.NetworkDevice]: {
    column: "networkDeviceId",
    teams: NetworkDeviceOwnerTeamService as unknown as OwnerRowsReader,
    users: NetworkDeviceOwnerUserService as unknown as OwnerRowsReader,
  },
};

function readId(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  const id: unknown =
    (value as { _id?: unknown; id?: unknown })._id ||
    (value as { _id?: unknown; id?: unknown }).id;

  return id ? String(id) : String(value);
}

function readNumber(value: JSONValue | undefined): number {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : 0;
}

/*
 * The SQL that sums the traffic between the case's addresses and everyone
 * else, in the case's window and the reader's devices: the busiest
 * exchanges first.
 */
export function buildFlowPeersStatement(data: {
  projectId: ObjectID;
  addresses: Array<string>;
  start: Date;
  end: Date;
  devices: TelemetryServiceFilter;
  limit: number;
}): Statement {
  const addresses: { type: TableColumnType; value: Array<string> } = {
    type: TableColumnType.ArrayText,
    value: data.addresses,
  };

  const statement: Statement = SQL`SELECT if(has(${addresses}, srcIp), srcIp, dstIp) AS caseAddress, if(has(${addresses}, srcIp), dstIp, srcIp) AS peerAddress, if(has(${addresses}, srcIp), 'out', 'in') AS direction, sum(octets) AS bytes, sum(packets) AS packets, max(flowStartAt) AS lastSeen FROM ${AnalyticsTableName.NetworkFlow} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: data.projectId,
  }} AND flowStartAt >= ${{
    type: TableColumnType.DateTime64,
    value: data.start,
  }} AND flowStartAt < ${{
    type: TableColumnType.DateTime64,
    value: data.end,
  }} AND (has(${addresses}, srcIp) OR has(${addresses}, dstIp))`;

  TelemetryReadScopeUtil.appendServiceFilter(
    statement,
    data.devices,
    "networkDeviceId",
  );

  statement.append(
    SQL` GROUP BY caseAddress, peerAddress, direction ORDER BY bytes DESC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

  return statement;
}

/*
 * The SQL that finds requests from the case's addresses that its events'
 * traces show reached the app, in the case's window and the reader's
 * resources: what makes a record reachable from the internet, on evidence.
 */
export function buildReachedRequestsStatement(data: {
  projectId: ObjectID;
  addresses: Array<string>;
  start: Date;
  end: Date;
  serviceFilter: TelemetryServiceFilter;
  limit: number;
}): Statement {
  const statement: Statement = SQL`SELECT principalIp, requestOutcome, min(time) AS firstSeen FROM ${AnalyticsTableName.SecurityEvent} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: data.projectId,
  }} AND time >= ${{
    type: TableColumnType.DateTime64,
    value: data.start,
  }} AND time <= ${{
    type: TableColumnType.DateTime64,
    value: data.end,
  }} AND principalIp IN (${{
    type: TableColumnType.Text,
    value: new Includes(data.addresses),
  }}) AND requestOutcome IN (${{
    type: TableColumnType.Text,
    value: new Includes([
      SecurityEventRequestOutcome.ReachedApp,
      SecurityEventRequestOutcome.Errored,
      SecurityEventRequestOutcome.ReachedDatabase,
    ]),
  }})`;

  TelemetryReadScopeUtil.appendServiceFilter(statement, data.serviceFilter);

  statement.append(
    SQL` GROUP BY principalIp, requestOutcome ORDER BY firstSeen ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(getQuerySettings(SECURITY_CONNECTION_READ_TIME_LIMIT));

  return statement;
}

// The addresses a case names, each once, in one spelling.
export function getCaseAddresses(
  entities: ReadonlyArray<SecurityEntity>,
): Array<string> {
  const addresses: Array<string> = [];

  for (const entity of entities) {
    if (entity.type !== SecurityEntityType.IpAddress) {
      continue;
    }

    const address: string | null = canonicalAddress(entity.value);

    if (address && !addresses.includes(address)) {
      addresses.push(address);
    }
  }

  return addresses;
}

export default class SecurityCaseImpact {
  @CaptureSpan()
  public static async build(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<SecurityCaseImpactJson | null> {
    const scope: SecurityCaseContextScope | null =
      await readSecurityCaseContextScope(data);

    if (!scope) {
      return null;
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const tracker: SecurityCaseSourceTracker<SecurityCaseImpactSource> =
      new SecurityCaseSourceTracker<SecurityCaseImpactSource>(
        "Security case impact",
      );

    const connections: SecurityConnectionsJson | null = await tracker.read(
      SecurityCaseImpactSource.Records,
      (): Promise<SecurityConnectionsJson | null> => {
        return SecurityConnections.forCase({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          props: data.props,
          now,
        });
      },
    );

    if (connections && connections.unreadableKinds.length > 0) {
      tracker.markUnreadable(SecurityCaseImpactSource.Records);
    }

    if (connections && connections.failedKinds.length > 0) {
      tracker.markFailed(SecurityCaseImpactSource.Records);
    }

    const resources: Array<SecurityConnectedResourceJson> =
      connections?.resources || [];
    const addresses: Array<string> = getCaseAddresses(scope.entities).slice(
      0,
      SECURITY_CASE_IMPACT_MAX_FLOW_ADDRESSES,
    );

    const [
      dependencies,
      owners,
      changes,
      statusPages,
      flowPeers,
      reached,
      recordAddresses,
    ]: [
      Map<string, DependencyFacts> | null,
      Map<string, SecurityCaseImpactOwnersJson> | null,
      Map<string, Array<ChangeWithVersion>> | null,
      Array<SecurityCaseImpactStatusPageJson> | null,
      Array<SecurityCaseFlowPeerJson> | null,
      Array<ReachedRequest> | null,
      Array<RecordAddress>,
    ] = await Promise.all([
      tracker.read(
        SecurityCaseImpactSource.Dependencies,
        (): Promise<Map<string, DependencyFacts>> => {
          return this.readDependencies({
            projectId: data.projectId,
            resources,
            props: data.props,
            now,
          });
        },
      ),
      tracker.read(
        SecurityCaseImpactSource.Owners,
        (): Promise<Map<string, SecurityCaseImpactOwnersJson>> => {
          return this.readOwners({
            projectId: data.projectId,
            resources,
            props: data.props,
          });
        },
      ),
      tracker.read(
        SecurityCaseImpactSource.Changes,
        (): Promise<Map<string, Array<ChangeWithVersion>>> => {
          return this.readChanges({
            projectId: data.projectId,
            resources,
            scope,
            props: data.props,
          });
        },
      ),
      tracker.read(
        SecurityCaseImpactSource.StatusPages,
        (): Promise<Array<SecurityCaseImpactStatusPageJson>> => {
          return this.readStatusPages({
            projectId: data.projectId,
            resources,
            props: data.props,
          });
        },
      ),
      addresses.length > 0
        ? tracker.read(
            SecurityCaseImpactSource.NetworkFlows,
            (): Promise<Array<SecurityCaseFlowPeerJson>> => {
              return this.readFlowPeers({
                projectId: data.projectId,
                addresses,
                scope,
                props: data.props,
              });
            },
          )
        : Promise.resolve([]),
      addresses.length > 0
        ? tracker.read(
            SecurityCaseImpactSource.Events,
            (): Promise<Array<ReachedRequest>> => {
              return this.readReachedRequests({
                projectId: data.projectId,
                addresses,
                scope,
                props: data.props,
              });
            },
          )
        : Promise.resolve([]),
      this.readRecordAddresses({
        projectId: data.projectId,
        resources,
        props: data.props,
      }),
    ]);

    const records: Array<SecurityCaseImpactRecordJson> = resources.map(
      (
        resource: SecurityConnectedResourceJson,
      ): SecurityCaseImpactRecordJson => {
        const key: string = recordKey(resource.kind, resource.id);
        const facts: DependencyFacts | undefined = dependencies?.get(key);
        const hasOwners: boolean = Boolean(OWNER_TABLES[resource.kind]);

        return {
          kind: resource.kind,
          id: resource.id,
          name: resource.name,
          certainty: resource.certainty,
          ...(resource.inventoryItemId
            ? { inventoryItemId: resource.inventoryItemId }
            : {}),
          calls: facts ? facts.calls : null,
          calledBy: facts ? facts.calledBy : null,
          runsOn: facts ? facts.runsOn : null,
          monitors: resource.monitors,
          owners:
            owners && hasOwners
              ? owners.get(key) || { teams: [], users: [] }
              : null,
          lastChange: changes
            ? pickLastChange(changes.get(key) || [], scope.firstDetectedAt)
            : null,
        };
      },
    );

    return {
      windowStart: scope.window.start.toISOString(),
      windowEnd: scope.window.end.toISOString(),
      firstDetectedAt: scope.firstDetectedAt
        ? scope.firstDetectedAt.toISOString()
        : null,
      records,
      hasMoreRecords: Boolean(connections?.hasMoreResources),
      statusPages,
      flowPeers,
      internet: buildInternetExposure({
        requests: reached || [],
        recordAddresses,
      }),
      unreadableSources: tracker.getUnreadable(),
      failedSources: tracker.getFailed(),
    };
  }

  /*
   * Each record's place on the service map: what it calls, what calls it
   * and what it runs on, over the last week - for the records Inventory has
   * an item for. The reader needs to be able to read the inventory and its
   * relationships, as the Topology pages ask.
   */
  private static async readDependencies(data: {
    projectId: ObjectID;
    resources: Array<SecurityConnectedResourceJson>;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<Map<string, DependencyFacts>> {
    const facts: Map<string, DependencyFacts> = new Map();
    const withItems: Array<SecurityConnectedResourceJson> =
      data.resources.filter(
        (resource: SecurityConnectedResourceJson): boolean => {
          return Boolean(resource.inventoryItemId);
        },
      );

    if (withItems.length === 0) {
      return facts;
    }

    await ModelPermission.checkReadQueryPermission<InventoryItem>(
      InventoryItem,
      { projectId: data.projectId },
      null,
      data.props,
    );
    await ModelPermission.checkReadQueryPermission<InventoryItemRelationship>(
      InventoryItemRelationship,
      { projectId: data.projectId },
      null,
      data.props,
    );

    const items: Array<InventoryItem> = await InventoryItemService.findBy({
      query: {
        projectId: data.projectId,
        _id: new Includes(
          withItems.map((resource: SecurityConnectedResourceJson): string => {
            return resource.inventoryItemId!;
          }),
        ),
      },
      select: { _id: true, entityKey: true, entityType: true },
      limit: withItems.length,
      skip: 0,
      props: data.props,
    });

    const itemsById: Map<string, InventoryItem> = new Map();

    for (const item of items) {
      if (item.id) {
        itemsById.set(item.id.toString(), item);
      }
    }

    // A week of hours, not of calendar days: a clock change must not move it.
    const rangeStart: Date = new Date(
      data.now.getTime() -
        SECURITY_CASE_IMPACT_DEPENDENCY_WINDOW_IN_DAYS * 24 * 60 * 60 * 1000,
    );
    rangeStart.setSeconds(0, 0);

    for (const resource of withItems) {
      const item: InventoryItem | undefined = itemsById.get(
        resource.inventoryItemId!,
      );

      if (!item?.entityKey) {
        continue;
      }

      const response: TopologyEntityResponseJSON =
        await TopologyConcurrencyLimiter.run(
          data.projectId.toString(),
          (): Promise<TopologyEntityResponseJSON> => {
            return TopologyQueries.getEntity({
              projectId: data.projectId,
              entityKey: item.entityKey!,
              entityType: item.entityType ? String(item.entityType) : null,
              rangeStart,
            });
          },
        );

      if (!response.entity) {
        continue;
      }

      facts.set(recordKey(resource.kind, resource.id), {
        calls: toImpactPeers(response.sections.calls.rows),
        calledBy: toImpactPeers(response.sections.calledBy.rows),
        runsOn: toImpactPeers(response.sections.runsOn.rows),
      });
    }

    return facts;
  }

  // The teams and people who own each record, by "kind:id".
  private static async readOwners(data: {
    projectId: ObjectID;
    resources: Array<SecurityConnectedResourceJson>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, SecurityCaseImpactOwnersJson>> {
    const owners: Map<string, SecurityCaseImpactOwnersJson> = new Map();
    const byKind: Map<SecurityConnectionKind, Array<string>> = new Map();

    for (const resource of data.resources) {
      if (!OWNER_TABLES[resource.kind]) {
        continue;
      }

      const ids: Array<string> = byKind.get(resource.kind) || [];
      ids.push(resource.id);
      byKind.set(resource.kind, ids);
    }

    for (const [kind, ids] of Array.from(byKind.entries())) {
      const tables: OwnerTables = OWNER_TABLES[kind]!;
      const query: JSONObject = {
        projectId: data.projectId,
        [tables.column]: new Includes(ids),
      } as unknown as JSONObject;
      const limit: number = ids.length * SECURITY_CASE_IMPACT_MAX_OWNERS;

      const [teamRows, userRows]: [Array<unknown>, Array<unknown>] =
        await Promise.all([
          tables.teams.findBy({
            query,
            select: { [tables.column]: true, team: { _id: true, name: true } },
            limit,
            skip: 0,
            props: data.props,
          }),
          tables.users.findBy({
            query,
            select: {
              [tables.column]: true,
              user: { _id: true, name: true, email: true },
            },
            limit,
            skip: 0,
            props: data.props,
          }),
        ]);

      const ownersOf: (id: string) => SecurityCaseImpactOwnersJson = (
        id: string,
      ): SecurityCaseImpactOwnersJson => {
        const key: string = recordKey(kind, id);
        let found: SecurityCaseImpactOwnersJson | undefined = owners.get(key);

        if (!found) {
          found = { teams: [], users: [] };
          owners.set(key, found);
        }

        return found;
      };

      for (const row of teamRows) {
        const record: Dictionary<unknown> = row as Dictionary<unknown>;
        const recordId: string = readId(record[tables.column]);
        const team: Dictionary<unknown> | undefined = record["team"] as
          | Dictionary<unknown>
          | undefined;
        const teamId: string = readId(team);
        const list: SecurityCaseImpactOwnersJson = ownersOf(recordId);

        if (
          teamId &&
          list.teams.length < SECURITY_CASE_IMPACT_MAX_OWNERS &&
          !list.teams.some((existing: { id: string }): boolean => {
            return existing.id === teamId;
          })
        ) {
          list.teams.push({ id: teamId, name: String(team?.["name"] || "") });
        }
      }

      for (const row of userRows) {
        const record: Dictionary<unknown> = row as Dictionary<unknown>;
        const recordId: string = readId(record[tables.column]);
        const user: Dictionary<unknown> | undefined = record["user"] as
          | Dictionary<unknown>
          | undefined;
        const userId: string = readId(user);
        const list: SecurityCaseImpactOwnersJson = ownersOf(recordId);

        if (
          userId &&
          list.users.length < SECURITY_CASE_IMPACT_MAX_OWNERS &&
          !list.users.some((existing: { id: string }): boolean => {
            return existing.id === userId;
          })
        ) {
          list.users.push({
            id: userId,
            name: String(user?.["name"] || user?.["email"] || ""),
          });
        }
      }
    }

    return owners;
  }

  /*
   * What changed on each record from a week before the case's window to its
   * end, latest first, matched to a record by the ids a change names.
   */
  private static async readChanges(data: {
    projectId: ObjectID;
    resources: Array<SecurityConnectedResourceJson>;
    scope: SecurityCaseContextScope;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, Array<ChangeWithVersion>>> {
    const keyOfId: Map<string, string> = new Map();

    for (const resource of data.resources) {
      if (
        resource.kind !== SecurityConnectionKind.User &&
        resource.kind !== SecurityConnectionKind.NetworkDevice
      ) {
        keyOfId.set(resource.id, recordKey(resource.kind, resource.id));
      }
    }

    const changes: Map<string, Array<ChangeWithVersion>> = new Map();

    if (keyOfId.size === 0) {
      return changes;
    }

    const rows: Array<ChangeEvent> = await ChangeEventService.findBy({
      query: {
        projectId: data.projectId,
        time: new InBetween(
          OneUptimeDate.addRemoveDays(
            data.scope.window.start,
            -IMPACT_CHANGE_LOOKBACK_IN_DAYS,
          ),
          data.scope.window.end,
        ),
        primaryEntityId: QueryHelper.any(
          Array.from(keyOfId.keys()).map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
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
      limit: IMPACT_MAX_CHANGES_READ,
      skip: 0,
      props: data.props,
    });

    for (const row of rows) {
      if (!row.time) {
        continue;
      }

      const fields: Dictionary<string | undefined> = readChangeEventFields(
        (row.attributes as Dictionary<unknown>) || {},
      ) as Dictionary<string | undefined>;
      const keys: Set<string> = new Set();

      for (const id of [
        row.primaryEntityId?.toString(),
        fields["kubernetesClusterId"],
        fields["resourceId"],
      ]) {
        const key: string | undefined = id ? keyOfId.get(id) : undefined;

        if (key) {
          keys.add(key);
        }
      }

      for (const key of Array.from(keys)) {
        const list: Array<ChangeWithVersion> = changes.get(key) || [];

        list.push({
          id: row._id?.toString() || "",
          time: new Date(row.time).toISOString(),
          title: row.title || "",
          eventType: row.eventType || "change",
          ...(fields["version"] ? { version: fields["version"] } : {}),
        });
        changes.set(key, list);
      }
    }

    return changes;
  }

  /*
   * The status pages that show a monitor watching one of the case's records:
   * customers would see what the case breaks there.
   */
  private static async readStatusPages(data: {
    projectId: ObjectID;
    resources: Array<SecurityConnectedResourceJson>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<SecurityCaseImpactStatusPageJson>> {
    const monitorIds: Set<string> = new Set();

    for (const [kind, ids] of Array.from(
      groupIdsByKind(data.resources).entries(),
    )) {
      const column: string | undefined = RECORD_RELATION_COLUMNS[kind];

      if (!column || ids.length === 0) {
        continue;
      }

      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          projectId: data.projectId,
          [column]: QueryHelper.inRelationArray(
            ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        } as never,
        select: { _id: true } as never,
        limit: IMPACT_MAX_MONITORS_READ,
        skip: 0,
        props: data.props,
      });

      for (const monitor of monitors) {
        if (monitor.id) {
          monitorIds.add(monitor.id.toString());
        }
      }
    }

    if (monitorIds.size === 0) {
      return [];
    }

    const rows: Array<StatusPageResource> =
      await StatusPageResourceService.findBy({
        query: {
          projectId: data.projectId,
          monitorId: new Includes(Array.from(monitorIds)),
        },
        select: {
          _id: true,
          monitorId: true,
          statusPageId: true,
          statusPage: { _id: true, name: true },
        },
        limit: IMPACT_MAX_MONITORS_READ,
        skip: 0,
        props: data.props,
      });

    const pages: Map<string, SecurityCaseImpactStatusPageJson> = new Map();

    for (const row of rows) {
      const id: string = row.statusPageId?.toString() || "";
      const monitorId: string = row.monitorId?.toString() || "";

      if (!id) {
        continue;
      }

      const page: SecurityCaseImpactStatusPageJson = pages.get(id) || {
        id,
        name: row.statusPage?.name || "",
        monitorIds: [],
      };

      if (monitorId && !page.monitorIds.includes(monitorId)) {
        page.monitorIds.push(monitorId);
      }

      pages.set(id, page);
    }

    return Array.from(pages.values())
      .sort(
        (
          first: SecurityCaseImpactStatusPageJson,
          second: SecurityCaseImpactStatusPageJson,
        ): number => {
          return first.name < second.name
            ? -1
            : first.name > second.name
              ? 1
              : 0;
        },
      )
      .slice(0, SECURITY_CASE_IMPACT_MAX_STATUS_PAGES);
  }

  /*
   * The machines the case's addresses exchanged traffic with, from the
   * flows of the network devices the reader may read.
   */
  private static async readFlowPeers(data: {
    projectId: ObjectID;
    addresses: Array<string>;
    scope: SecurityCaseContextScope;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<SecurityCaseFlowPeerJson>> {
    const readScope: TelemetryReadScope = await TelemetryReadAccess.getScope(
      NetworkFlow,
      data.props,
    );

    const result: Awaited<ReturnType<typeof NetworkFlowService.executeQuery>> =
      await NetworkFlowService.executeQuery(
        buildFlowPeersStatement({
          projectId: data.projectId,
          addresses: data.addresses,
          start: data.scope.window.start,
          end: data.scope.window.end,
          devices: NetworkTrafficSummaryUtil.getDeviceFilter(readScope, null),
          limit: SECURITY_CASE_IMPACT_MAX_FLOW_PEERS,
        }),
      );
    const response: { data?: Array<JSONObject> } = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || [])
      .map((row: JSONObject): SecurityCaseFlowPeerJson | null => {
        const caseAddress: string = String(row["caseAddress"] || "");
        const peerAddress: string = String(row["peerAddress"] || "");

        if (!caseAddress || !peerAddress) {
          return null;
        }

        const lastSeen: Date | null = readClickhouseTime(row["lastSeen"]);

        return {
          caseAddress,
          peerAddress,
          direction: row["direction"] === "in" ? "in" : "out",
          bytes: readNumber(row["bytes"]),
          packets: readNumber(row["packets"]),
          lastSeen: lastSeen ? lastSeen.toISOString() : null,
        };
      })
      .filter(
        (
          peer: SecurityCaseFlowPeerJson | null,
        ): peer is SecurityCaseFlowPeerJson => {
          return Boolean(peer);
        },
      );
  }

  // Requests from the case's addresses whose traces show they reached the app.
  private static async readReachedRequests(data: {
    projectId: ObjectID;
    addresses: Array<string>;
    scope: SecurityCaseContextScope;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ReachedRequest>> {
    const serviceFilter: TelemetryServiceFilter =
      await TelemetryReadAccess.getServiceFilter({
        modelType: SecurityEvent,
        props: data.props,
      });

    const result: Awaited<
      ReturnType<typeof SecurityEventService.executeQuery>
    > = await SecurityEventService.executeQuery(
      buildReachedRequestsStatement({
        projectId: data.projectId,
        addresses: data.addresses,
        start: data.scope.window.start,
        end: data.scope.window.end,
        serviceFilter,
        limit: IMPACT_MAX_REACHED_REQUESTS,
      }),
    );
    const response: { data?: Array<JSONObject> } = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || [])
      .map((row: JSONObject): ReachedRequest | null => {
        const time: Date | null = readClickhouseTime(row["firstSeen"]);
        const address: string = String(row["principalIp"] || "");

        if (!time || !address) {
          return null;
        }

        return {
          address,
          time,
          requestOutcome: String(row["requestOutcome"] || ""),
        };
      })
      .filter((request: ReachedRequest | null): request is ReachedRequest => {
        return Boolean(request);
      });
  }

  /*
   * The addresses the case's hosts and network devices report for
   * themselves. Evidence only: a record the reader may not read, or a read
   * that fails, gives none.
   */
  private static async readRecordAddresses(data: {
    projectId: ObjectID;
    resources: Array<SecurityConnectedResourceJson>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<RecordAddress>> {
    const addresses: Array<RecordAddress> = [];
    const hostIds: Array<string> = [];
    const deviceIds: Array<string> = [];

    for (const resource of data.resources) {
      if (resource.kind === SecurityConnectionKind.Host) {
        hostIds.push(resource.id);
      } else if (resource.kind === SecurityConnectionKind.NetworkDevice) {
        deviceIds.push(resource.id);
      }
    }

    try {
      if (hostIds.length > 0) {
        const hosts: Array<Host> = await HostService.findBy({
          query: { projectId: data.projectId, _id: new Includes(hostIds) },
          select: { _id: true, name: true, hostIpAddresses: true },
          limit: hostIds.length,
          skip: 0,
          props: data.props,
        });

        for (const host of hosts) {
          for (const address of readRecordAddresses(host.hostIpAddresses)) {
            addresses.push({ recordName: host.name || "", address });
          }
        }
      }

      if (deviceIds.length > 0) {
        const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy(
          {
            query: { projectId: data.projectId, _id: new Includes(deviceIds) },
            select: {
              _id: true,
              name: true,
              hostname: true,
              otherAddresses: true,
            },
            limit: deviceIds.length,
            skip: 0,
            props: data.props,
          },
        );

        for (const device of devices) {
          for (const address of readRecordAddresses([
            device.hostname || "",
            ...(device.otherAddresses || "").split(","),
          ])) {
            addresses.push({ recordName: device.name || "", address });
          }
        }
      }
    } catch {
      // Evidence only: none when it cannot be read.
      return addresses;
    }

    return addresses;
  }
}

type ChangeWithVersion = SecurityConnectionChangeJson & {
  version?: string | undefined;
};

interface DependencyFacts {
  calls: Array<SecurityCaseImpactPeerJson>;
  calledBy: Array<SecurityCaseImpactPeerJson>;
  runsOn: Array<SecurityCaseImpactPeerJson>;
}

function groupIdsByKind(
  resources: ReadonlyArray<SecurityConnectedResourceJson>,
): Map<SecurityConnectionKind, Array<string>> {
  const byKind: Map<SecurityConnectionKind, Array<string>> = new Map();

  for (const resource of resources) {
    const ids: Array<string> = byKind.get(resource.kind) || [];

    if (!ids.includes(resource.id)) {
      ids.push(resource.id);
    }

    byKind.set(resource.kind, ids);
  }

  return byKind;
}
