import NetworkTrafficUsageService from "./NetworkTrafficUsageService";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import {
  getStorageTableName,
  onClusterClause,
} from "../Utils/AnalyticsDatabase/ClusterConfig";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../Utils/Telemetry/TelemetryReadScope";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  NetworkTrafficUsageStoredEnds,
  NetworkTrafficUsageWindowKey,
} from "../Utils/NetworkController/NetworkControllerTypes";
import { getWindowKey } from "../Utils/NetworkController/NetworkTrafficUsageRows";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import {
  MAX_NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE,
  MAX_NETWORK_TRAFFIC_USAGE_LIST_SKIP,
  MAX_NETWORK_TRAFFIC_USAGE_WINDOW_HOURS,
  NETWORK_TRAFFIC_USAGE_TOP_LIMIT,
  NetworkTrafficUsageApplicationRow,
  NetworkTrafficUsageClientRow,
  NetworkTrafficUsageConversationRow,
  NetworkTrafficUsageDestinationRow,
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageKindTotals,
  NetworkTrafficUsageListKind,
  NetworkTrafficUsageListResult,
  NetworkTrafficUsageListSort,
  NetworkTrafficUsageNetworkRow,
  NetworkTrafficUsageSeriesPoint,
  NetworkTrafficUsageTotals,
  NetworkTrafficUsageUplinkInterfaceRow,
  NetworkTrafficUsageUplinkRow,
  NetworkTrafficUsageUplinkSeriesPoint,
  isUplinkUsageKind,
} from "../../Types/NetFlow/NetworkTrafficUsage";
import { MAX_NETWORK_TRAFFIC_RANGE_DAYS } from "../../Types/NetFlow/NetworkTraffic";
import ObjectID from "../../Types/ObjectID";

/*
 * THE TRAFFIC PAGES' READS OF WHAT A CONTROLLER REPORTED, straight from the
 * NetworkTrafficUsage table - the Meraki side of the page, beside
 * NetworkTrafficAggregationService's flows.
 *
 * Each row totals a window, so every number is the windows' SHARE of the
 * page's range: a window wholly inside counts whole, one that runs past an
 * edge counts for the part inside (WEIGHT). The chart splits each window
 * over the buckets it spans the same way, so an hour-long backfill window
 * draws as twelve five-minute buckets of a twelfth each, not one spike. An
 * uplink's loss and latency are measurements, not totals: they are averaged,
 * never shared out.
 *
 * Every read is bounded as the flow reads are:
 *
 *   - by project, kind and time: the WHERE starts with the table's sort key
 *     (projectId, kind, windowStartAt), looking back past the range's start
 *     no further than the longest window there is;
 *   - by who is asking: `devices` is the caller's read scope narrowed to the
 *     page, applied on networkDeviceId;
 *   - by time and memory: max_execution_time with timeout_overflow_mode
 *     'throw' and a memory ceiling - a timeout is an error the page can
 *     explain, never an empty page.
 *
 * Every value from the request reaches SQL as a bound parameter; the only
 * text spliced in is this file's own. Byte sums are Float64 (a window's
 * bytes times milliseconds would overflow Int64) and rounded when read.
 */

const TABLE_NAME: string = AnalyticsTableName.NetworkTrafficUsage;

// Under the ClickHouse client's own 58 s request timeout.
export const NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS: number = 45;

const QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS,
  timeoutOverflowMode: "throw",
  boundScanMemory: true,
});

const MAX_WINDOW_MS: number =
  MAX_NETWORK_TRAFFIC_USAGE_WINDOW_HOURS * 60 * 60 * 1000;

export interface NetworkTrafficUsageQuery {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  devices: TelemetryServiceFilter;
  filters: NetworkTrafficUsageFilters;
}

export interface NetworkTrafficUsageAggregates {
  // The kind the totals, the chart and Top networks are of.
  primaryKind: NetworkTrafficUsageKind;
  totals: NetworkTrafficUsageTotals;
  applicationTotals: NetworkTrafficUsageKindTotals;
  clientTotals: NetworkTrafficUsageKindTotals;
  series: Array<NetworkTrafficUsageSeriesPoint>;
  topNetworks: Array<NetworkTrafficUsageNetworkRow>;
  topUplinks: Array<NetworkTrafficUsageUplinkRow>;
  uplinkInterfaces: Array<NetworkTrafficUsageUplinkInterfaceRow>;
  uplinkSeries: Array<NetworkTrafficUsageUplinkSeriesPoint>;
  topApplications: Array<NetworkTrafficUsageApplicationRow>;
  topDestinations: Array<NetworkTrafficUsageDestinationRow>;
  topClients: Array<NetworkTrafficUsageClientRow>;
  topConversations: Array<NetworkTrafficUsageConversationRow>;
  // How many rows Top networks, Top applications and Top clients have in all.
  networkCount: number;
  applicationCount: number;
  clientCount: number;
}

// One page of a whole list, as getList reads it.
export interface NetworkTrafficUsageListQuery {
  query: NetworkTrafficUsageQuery;
  list: NetworkTrafficUsageListKind;
  // The kind Top networks is of on the page: the networks' list adds up the same.
  primaryKind: NetworkTrafficUsageKind;
  search: string;
  sortBy: NetworkTrafficUsageListSort;
  skip: number;
  limit: number;
}

/*
 * An appliance the project's connections reported uplink traffic of, as
 * "Link to a Meraki appliance" lists it: by its newest window, so a
 * renamed appliance reads as it is called now.
 */
export interface NetworkTrafficUsageApplianceRow {
  serial: string;
  name: string;
  controllerNetworkId: string;
  controllerNetworkName: string;
  connectionId: string;
  // Whose its newest rows are: a device's ID, or the project's (its bucket).
  networkDeviceId: string;
  lastWindowEndAt: string;
  octets: number;
}

/*
 * Stored traffic to file under another device (issue #5762): an appliance's
 * uplinks and their health by its serial number, a network's applications
 * and clients by the network - only the rows `fromDeviceId` holds now: the
 * project's bucket when an appliance became a device, the device when its
 * link was undone.
 */
export interface NetworkTrafficUsageRefile {
  projectId: ObjectID;
  // One connection's rows; every connection's when absent.
  connectionId?: ObjectID | undefined;
  fromDeviceId: ObjectID;
  appliances: Array<{ serial: string; deviceId: ObjectID }>;
  networks: Array<{ controllerNetworkId: string; deviceId: ObjectID }>;
  // Rows whose window starts before this are left: the table keeps none older.
  since: Date;
}

// Where a mutation is written: the local storage table, on every node.
export interface NetworkTrafficUsageStorageTable {
  databaseName: string;
  storageTable: string;
  // " ON CLUSTER '...'", or "" for a table of one node (tests).
  onCluster: string;
}

export interface NetworkTrafficUsageFreshness {
  lastUplinkAt: string | null;
  lastAnalyticsAt: string | null;
  // The connections whose uplinks are on the page, and their newest row's end.
  uplinkEnds: Map<string, Date>;
}

function toNumber(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBytes(value: unknown): number {
  return Math.max(0, Math.round(toNumber(value)));
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/*
 * A measurement as ClickHouse answers it: null when nothing was measured.
 * Never 0, which would read as a perfect line.
 */
function toMeasurement(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: number = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

// A query with every filter it has, but for an uplink's.
function withoutUplinkFilter(
  query: NetworkTrafficUsageQuery,
): NetworkTrafficUsageQuery {
  const filters: NetworkTrafficUsageFilters = { ...query.filters };

  delete filters.interfaceName;

  return { ...query, filters };
}

export default class NetworkTrafficUsageAggregationService {
  /*
   * When the page's newest uplink and application windows ended (within
   * retention): how fresh it is, and which kind its totals are of - the
   * uplinks when it has any, else the applications (an organization with
   * no MX).
   */
  @CaptureSpan()
  public static async getFreshness(data: {
    projectId: ObjectID;
    devices: TelemetryServiceFilter;
    now: Date;
  }): Promise<NetworkTrafficUsageFreshness> {
    const rows: Array<JSONObject> =
      await NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildFreshnessStatement(data),
      );

    const freshness: NetworkTrafficUsageFreshness = {
      lastUplinkAt: null,
      lastAnalyticsAt: null,
      uplinkEnds: new Map(),
    };

    for (const row of rows) {
      const kind: string = toText(row["usageKind"]);
      const lastMs: number = toNumber(row["lastWindowEndMs"]);

      if (lastMs <= 0) {
        continue;
      }

      // ISO, from epoch milliseconds: never in the server's own time zone.
      const last: string = new Date(lastMs).toISOString();

      if (kind === NetworkTrafficUsageKind.Uplink) {
        if (!freshness.lastUplinkAt || last > freshness.lastUplinkAt) {
          freshness.lastUplinkAt = last;
        }

        const connectionId: string = toText(row["connectionKey"]);

        if (connectionId) {
          freshness.uplinkEnds.set(connectionId, new Date(lastMs));
        }
      } else if (
        kind === NetworkTrafficUsageKind.Application &&
        (!freshness.lastAnalyticsAt || last > freshness.lastAnalyticsAt)
      ) {
        freshness.lastAnalyticsAt = last;
      }
    }

    return freshness;
  }

  @CaptureSpan()
  public static async getAggregates(data: {
    query: NetworkTrafficUsageQuery;
    bucketSeconds: number;
    primaryKind: NetworkTrafficUsageKind;
  }): Promise<NetworkTrafficUsageAggregates> {
    const query: NetworkTrafficUsageQuery = data.query;
    const primaryKind: NetworkTrafficUsageKind = data.primaryKind;

    const [
      uplinkTotalsRows,
      applicationTotalsRows,
      clientTotalsRows,
      seriesRows,
      networkRows,
      uplinkRows,
      applicationRows,
      destinationRows,
      clientRows,
      uplinkInterfaceRows,
      uplinkHealthRows,
      uplinkSeriesRows,
      uplinkHealthSeriesRows,
      conversationRows,
    ]: Array<Array<JSONObject>> = await Promise.all([
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTotalsStatement(
          query,
          NetworkTrafficUsageKind.Uplink,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTotalsStatement(
          query,
          NetworkTrafficUsageKind.Application,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTotalsStatement(
          query,
          NetworkTrafficUsageKind.Client,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildSeriesStatement(
          query,
          primaryKind,
          data.bucketSeconds,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTopNetworksStatement(
          query,
          primaryKind,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTopUplinksStatement(query),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTopApplicationsStatement(
          query,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTopDestinationsStatement(
          query,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTopClientsStatement(query),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildUplinkInterfacesStatement(
          query,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildUplinkHealthStatement(query),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildUplinkSeriesStatement(
          query,
          data.bucketSeconds,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildUplinkHealthSeriesStatement(
          query,
          data.bucketSeconds,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTopConversationsStatement(
          query,
        ),
      ),
    ]);

    const kindTotals: (
      rows: Array<JSONObject> | undefined,
    ) => NetworkTrafficUsageKindTotals = (
      rows: Array<JSONObject> | undefined,
    ): NetworkTrafficUsageKindTotals => {
      return {
        sentOctets: toBytes(rows?.[0]?.["totalSent"]),
        receivedOctets: toBytes(rows?.[0]?.["totalReceived"]),
      };
    };

    const applicationTotals: NetworkTrafficUsageKindTotals = kindTotals(
      applicationTotalsRows,
    );
    const primaryTotals: NetworkTrafficUsageKindTotals =
      primaryKind === NetworkTrafficUsageKind.Uplink
        ? kindTotals(uplinkTotalsRows)
        : applicationTotals;
    const primaryTotalsRow: JSONObject | undefined = (
      primaryKind === NetworkTrafficUsageKind.Uplink
        ? uplinkTotalsRows
        : applicationTotalsRows
    )?.[0];

    return {
      primaryKind,
      totals: {
        sentOctets: primaryTotals.sentOctets,
        receivedOctets: primaryTotals.receivedOctets,
        flows: toBytes(applicationTotalsRows?.[0]?.["totalFlows"]),
      },
      applicationTotals,
      clientTotals: kindTotals(clientTotalsRows),
      networkCount: toBytes(primaryTotalsRow?.["networkTotal"]),
      applicationCount: toBytes(applicationTotalsRows?.[0]?.["listTotal"]),
      clientCount: toBytes(clientTotalsRows?.[0]?.["listTotal"]),
      series: (seriesRows || []).map(
        (row: JSONObject): NetworkTrafficUsageSeriesPoint => {
          return {
            time: new Date(toNumber(row["bucketStartMs"])).toISOString(),
            sentOctets: toBytes(row["bucketSent"]),
            receivedOctets: toBytes(row["bucketReceived"]),
          };
        },
      ),
      topNetworks: (networkRows || []).map(
        NetworkTrafficUsageAggregationService.readNetworkRow,
      ),
      topUplinks: (uplinkRows || []).map(
        (row: JSONObject): NetworkTrafficUsageUplinkRow => {
          const deviceId: string = toText(row["deviceId"]);

          return {
            deviceSerial: toText(row["serialKey"]),
            deviceName: toText(row["applianceName"]),
            controllerNetworkId: toText(row["networkKey"]),
            controllerNetworkName: toText(row["networkName"]),
            interfaceName: toText(row["uplinkKey"]),
            sentOctets: toBytes(row["totalSent"]),
            receivedOctets: toBytes(row["totalReceived"]),
            ...(deviceId && deviceId !== query.projectId.toString()
              ? { networkDeviceId: deviceId }
              : {}),
          };
        },
      ),
      uplinkInterfaces:
        NetworkTrafficUsageAggregationService.readUplinkInterfaces(
          uplinkInterfaceRows || [],
          uplinkHealthRows || [],
        ),
      uplinkSeries: NetworkTrafficUsageAggregationService.readUplinkSeries(
        uplinkSeriesRows || [],
        uplinkHealthSeriesRows || [],
      ),
      topApplications: (applicationRows || []).map(
        NetworkTrafficUsageAggregationService.readApplicationRow,
      ),
      topDestinations: (destinationRows || []).map(
        (row: JSONObject): NetworkTrafficUsageDestinationRow => {
          return {
            destination: toText(row["destinationKey"]),
            application: toText(row["topApplication"]),
            protocol: toText(row["topProtocol"]),
            port: toBytes(row["topPort"]),
            sentOctets: toBytes(row["totalSent"]),
            receivedOctets: toBytes(row["totalReceived"]),
          };
        },
      ),
      topClients: (clientRows || []).map(
        NetworkTrafficUsageAggregationService.readClientRow,
      ),
      topConversations: (conversationRows || []).map(
        (row: JSONObject): NetworkTrafficUsageConversationRow => {
          return {
            controllerNetworkId: toText(row["networkKey"]),
            controllerNetworkName: toText(row["networkName"]),
            destination: toText(row["destinationKey"]),
            application: toText(row["topApplication"]),
            protocol: toText(row["protocolKey"]),
            port: toBytes(row["portKey"]),
            sentOctets: toBytes(row["totalSent"]),
            receivedOctets: toBytes(row["totalReceived"]),
            flows: toBytes(row["totalFlows"]),
            clients: toBytes(row["mostClients"]),
          };
        },
      ),
    };
  }

  // A row of Top networks, or of the whole list of them.
  public static readNetworkRow(row: JSONObject): NetworkTrafficUsageNetworkRow {
    return {
      controllerNetworkId: toText(row["networkKey"]),
      name: toText(row["networkName"]),
      sentOctets: toBytes(row["totalSent"]),
      receivedOctets: toBytes(row["totalReceived"]),
    };
  }

  public static readApplicationRow(
    row: JSONObject,
  ): NetworkTrafficUsageApplicationRow {
    return {
      application: toText(row["applicationKey"]),
      protocol: toText(row["topProtocol"]),
      port: toBytes(row["topPort"]),
      sentOctets: toBytes(row["totalSent"]),
      receivedOctets: toBytes(row["totalReceived"]),
      flows: toBytes(row["totalFlows"]),
    };
  }

  public static readClientRow(row: JSONObject): NetworkTrafficUsageClientRow {
    return {
      clientKey: toText(row["clientKeyValue"]),
      name: toText(row["clientNameValue"]),
      ip: toText(row["clientIpValue"]),
      mac: toText(row["clientMacValue"]),
      manufacturer: toText(row["manufacturerValue"]),
      controllerNetworkName: toText(row["networkName"]),
      sentOctets: toBytes(row["totalSent"]),
      receivedOctets: toBytes(row["totalReceived"]),
    };
  }

  /*
   * One page of a whole list (issue #5762): its rows, searched, sorted and
   * paged by the database, and how many rows the search matches in all -
   * the page's read scope and filters held exactly as the top lists hold
   * them, so its first rows are the top list's.
   */
  @CaptureSpan()
  public static async getList(
    data: NetworkTrafficUsageListQuery,
  ): Promise<NetworkTrafficUsageListResult> {
    const [rows, countRows]: Array<Array<JSONObject>> = await Promise.all([
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildListStatement(data),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildListCountStatement(data),
      ),
    ]);

    return {
      list: data.list,
      count: toBytes(countRows?.[0]?.["listTotal"]),
      networks:
        data.list === NetworkTrafficUsageListKind.Networks
          ? (rows || []).map(
              NetworkTrafficUsageAggregationService.readNetworkRow,
            )
          : [],
      applications:
        data.list === NetworkTrafficUsageListKind.Applications
          ? (rows || []).map(
              NetworkTrafficUsageAggregationService.readApplicationRow,
            )
          : [],
      clients:
        data.list === NetworkTrafficUsageListKind.Clients
          ? (rows || []).map(
              NetworkTrafficUsageAggregationService.readClientRow,
            )
          : [],
    };
  }

  /*
   * The appliances the project's connections reported uplink traffic of
   * since `since`, as the caller may read them (`devices`), each as its
   * newest window describes it - or only those of `serials`, when given.
   */
  @CaptureSpan()
  public static async getAppliances(data: {
    projectId: ObjectID;
    devices: TelemetryServiceFilter;
    since: Date;
    serials?: Array<string> | undefined;
    controllerNetworkIds?: Array<string> | undefined;
    limit: number;
  }): Promise<Array<NetworkTrafficUsageApplianceRow>> {
    const rows: Array<JSONObject> =
      await NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildAppliancesStatement(data),
      );

    return rows
      .map((row: JSONObject): NetworkTrafficUsageApplianceRow => {
        const lastMs: number = toNumber(row["lastWindowEndMs"]);

        return {
          serial: toText(row["serialKey"]),
          name: toText(row["applianceName"]),
          controllerNetworkId: toText(row["networkKey"]),
          controllerNetworkName: toText(row["networkName"]),
          connectionId: toText(row["connectionKey"]),
          networkDeviceId: toText(row["deviceKey"]),
          lastWindowEndAt: lastMs > 0 ? new Date(lastMs).toISOString() : "",
          octets: toBytes(row["totalOctets"]),
        };
      })
      .filter((row: NetworkTrafficUsageApplianceRow): boolean => {
        return Boolean(row.serial);
      });
  }

  /*
   * Where the rows are stored: the local table of the database the service
   * reads, on every node of the cluster - as every data mutation of the
   * analytics schema is written (StatementGenerator.toUpdateStatement).
   */
  public static getStorageTable(): NetworkTrafficUsageStorageTable {
    if (!NetworkTrafficUsageService.database) {
      NetworkTrafficUsageService.useDefaultDatabase();
    }

    return {
      databaseName:
        NetworkTrafficUsageService.database.getDatasourceOptions().database!,
      storageTable: getStorageTableName(TABLE_NAME),
      onCluster: onClusterClause(),
    };
  }

  /*
   * Files stored traffic under another device (NetworkTrafficUsageRefile):
   * when there is any to file, one mutation, queued on every node and run
   * in the background (ClickHouse's mutations_sync = 0), as the analytics
   * schema's other data mutations are. Answers whether it queued one. A
   * link or an unlink is rare, and a read files only what was matched since
   * the last one: never a mutation per read.
   */
  @CaptureSpan()
  public static async refile(
    refile: NetworkTrafficUsageRefile,
    table: NetworkTrafficUsageStorageTable,
  ): Promise<boolean> {
    if (refile.appliances.length === 0 && refile.networks.length === 0) {
      return false;
    }

    const found: Array<JSONObject> =
      await NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildRefileCheckStatement(refile),
      );

    if (found.length === 0) {
      return false;
    }

    await NetworkTrafficUsageService.execute(
      NetworkTrafficUsageAggregationService.buildRefileStatement(refile, table),
    );

    return true;
  }

  /*
   * The page's uplinks: what each carried, with what was measured on it.
   * An uplink that carried nothing has no traffic row and is listed all the
   * same when it was measured - a standby line that is up and healthy.
   */
  public static readUplinkInterfaces(
    trafficRows: Array<JSONObject>,
    healthRows: Array<JSONObject>,
  ): Array<NetworkTrafficUsageUplinkInterfaceRow> {
    const health: Map<string, JSONObject> = new Map(
      healthRows.map((row: JSONObject): [string, JSONObject] => {
        return [toText(row["uplinkKey"]), row];
      }),
    );
    const rows: Array<NetworkTrafficUsageUplinkInterfaceRow> = trafficRows.map(
      (row: JSONObject): NetworkTrafficUsageUplinkInterfaceRow => {
        const interfaceName: string = toText(row["uplinkKey"]);
        const measured: JSONObject | undefined = health.get(interfaceName);

        return {
          interfaceName,
          applianceCount: toBytes(row["applianceTotal"]),
          sentOctets: toBytes(row["totalSent"]),
          receivedOctets: toBytes(row["totalReceived"]),
          lossPercent: toMeasurement(measured?.["averageLoss"]),
          latencyMs: toMeasurement(measured?.["averageLatency"]),
        };
      },
    );

    for (const [interfaceName, measured] of health) {
      const isListed: boolean = rows.some(
        (row: NetworkTrafficUsageUplinkInterfaceRow): boolean => {
          return row.interfaceName === interfaceName;
        },
      );

      if (interfaceName && !isListed) {
        rows.push({
          interfaceName,
          applianceCount: 0,
          sentOctets: 0,
          receivedOctets: 0,
          lossPercent: toMeasurement(measured["averageLoss"]),
          latencyMs: toMeasurement(measured["averageLatency"]),
        });
      }
    }

    return rows.slice(0, NETWORK_TRAFFIC_USAGE_TOP_LIMIT);
  }

  /*
   * Each uplink's buckets, with what was measured on it in them: a bucket
   * of an uplink that carried nothing but was measured holds no bytes.
   */
  public static readUplinkSeries(
    trafficRows: Array<JSONObject>,
    healthRows: Array<JSONObject>,
  ): Array<NetworkTrafficUsageUplinkSeriesPoint> {
    const points: Map<string, NetworkTrafficUsageUplinkSeriesPoint> = new Map();

    const pointOf: (row: JSONObject) => NetworkTrafficUsageUplinkSeriesPoint = (
      row: JSONObject,
    ): NetworkTrafficUsageUplinkSeriesPoint => {
      const bucketMs: number = toNumber(row["bucketStartMs"]);
      const interfaceName: string = toText(row["uplinkKey"]);
      const key: string = `${bucketMs}/${interfaceName}`;
      const point: NetworkTrafficUsageUplinkSeriesPoint = points.get(key) || {
        time: new Date(bucketMs).toISOString(),
        interfaceName,
        sentOctets: 0,
        receivedOctets: 0,
        lossPercent: null,
        latencyMs: null,
      };

      points.set(key, point);

      return point;
    };

    for (const row of trafficRows) {
      const point: NetworkTrafficUsageUplinkSeriesPoint = pointOf(row);

      point.sentOctets = toBytes(row["bucketSent"]);
      point.receivedOctets = toBytes(row["bucketReceived"]);
    }

    for (const row of healthRows) {
      const point: NetworkTrafficUsageUplinkSeriesPoint = pointOf(row);

      point.lossPercent = toMeasurement(row["averageLoss"]);
      point.latencyMs = toMeasurement(row["averageLatency"]);
    }

    return Array.from(points.values()).sort(
      (
        a: NetworkTrafficUsageUplinkSeriesPoint,
        b: NetworkTrafficUsageUplinkSeriesPoint,
      ): number => {
        return (
          a.time.localeCompare(b.time) ||
          a.interfaceName.localeCompare(b.interfaceName)
        );
      },
    );
  }

  /*
   * Which of these windows of a connection are stored already: what the
   * read runner checks before it writes, so no window is written twice.
   * Keys as NetworkTrafficUsageRows.getWindowKey writes them.
   */
  @CaptureSpan()
  public static async findStoredWindowKeys(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    windows: Array<NetworkTrafficUsageWindowKey>;
  }): Promise<Set<string>> {
    const keys: Set<string> = new Set();

    if (data.windows.length === 0) {
      return keys;
    }

    const rows: Array<JSONObject> =
      await NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildStoredWindowsStatement(data),
      );

    for (const row of rows) {
      // Epoch milliseconds, as the keys are made: no time zone to misread.
      const time: number = toNumber(row["windowStartMs"]);

      if (time <= 0) {
        continue;
      }

      keys.add(
        getWindowKey({
          kind: toText(row["usageKind"]) as NetworkTrafficUsageKind,
          controllerNetworkId: toText(row["networkKey"]),
          windowStartAt: new Date(time),
        }),
      );
    }

    return keys;
  }

  /*
   * Where a connection's stored windows that end after `since` end: the
   * newest uplink window's end, the newest window of the uplinks' health,
   * and each network's newest application or client window's. The read runner moves the cursors up to these before
   * it reads, so traffic a read stored without its cursor being recorded
   * (the bookkeeping write failed, or the insert's answer was lost) is
   * never read - and counted - again.
   */
  @CaptureSpan()
  public static async findStoredWindowEnds(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    since: Date;
  }): Promise<NetworkTrafficUsageStoredEnds> {
    const rows: Array<JSONObject> =
      await NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildStoredWindowEndsStatement(
          data,
        ),
      );

    return NetworkTrafficUsageAggregationService.readStoredWindowEnds(rows);
  }

  public static readStoredWindowEnds(
    rows: Array<JSONObject>,
  ): NetworkTrafficUsageStoredEnds {
    const ends: NetworkTrafficUsageStoredEnds = {
      uplinkEnd: null,
      uplinkHealthEnd: null,
      analyticsEnds: new Map(),
    };

    for (const row of rows) {
      const endMs: number = toNumber(row["lastWindowEndMs"]);

      if (endMs <= 0) {
        continue;
      }

      const kind: string = toText(row["usageKind"]);

      if (kind === NetworkTrafficUsageKind.Uplink) {
        if (!ends.uplinkEnd || endMs > ends.uplinkEnd.getTime()) {
          ends.uplinkEnd = new Date(endMs);
        }

        continue;
      }

      // An organization's measurements: no network's analytics have ended.
      if (kind === NetworkTrafficUsageKind.UplinkHealth) {
        if (!ends.uplinkHealthEnd || endMs > ends.uplinkHealthEnd.getTime()) {
          ends.uplinkHealthEnd = new Date(endMs);
        }

        continue;
      }

      const networkId: string = toText(row["networkKey"]);

      if (!networkId) {
        continue;
      }

      const current: Date | undefined = ends.analyticsEnds.get(networkId);

      if (!current || endMs > current.getTime()) {
        ends.analyticsEnds.set(networkId, new Date(endMs));
      }
    }

    return ends;
  }

  // ---- Statements ------------------------------------------------------------

  /*
   * A row's share of the range, as a Float64 from 0 to 1: the part of its
   * window inside [start, end) over the window's length.
   */
  public static buildWeight(query: NetworkTrafficUsageQuery): Statement {
    return SQL`(greatest(0, least(toUnixTimestamp64Milli(windowEndAt), ${{
      type: TableColumnType.BigNumber,
      value: query.endTime.getTime(),
    }}) - greatest(toUnixTimestamp64Milli(windowStartAt), ${{
      type: TableColumnType.BigNumber,
      value: query.startTime.getTime(),
    }})) / greatest(1, toUnixTimestamp64Milli(windowEndAt) - toUnixTimestamp64Milli(windowStartAt)))`;
  }

  /*
   * ` WHERE projectId = .. AND kind = .. AND <windows that reach into
   * [start, end)> AND <devices> AND <filters>` - what every page read
   * shares. An appliance's and an uplink's filter hold the uplinks and their
   * health to it; the network filter holds every kind to the network.
   */
  public static buildWhere(
    query: NetworkTrafficUsageQuery,
    kind: NetworkTrafficUsageKind,
  ): Statement {
    const statement: Statement = SQL`
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }}
        AND kind = ${{ type: TableColumnType.Text, value: kind }}
        AND windowStartAt >= ${{
          type: TableColumnType.DateTime64,
          value: new Date(query.startTime.getTime() - MAX_WINDOW_MS),
        }}
        AND windowStartAt < ${{
          type: TableColumnType.DateTime64,
          value: query.endTime,
        }}
        AND windowEndAt > ${{
          type: TableColumnType.DateTime64,
          value: query.startTime,
        }}`;

    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      query.devices,
      "networkDeviceId",
    );

    if (query.filters.controllerNetworkId) {
      statement.append(
        SQL` AND controllerNetworkId = ${{
          type: TableColumnType.Text,
          value: query.filters.controllerNetworkId,
        }}`,
      );
    }

    if (query.filters.deviceSerial && isUplinkUsageKind(kind)) {
      statement.append(
        SQL` AND deviceSerial = ${{
          type: TableColumnType.Text,
          value: query.filters.deviceSerial,
        }}`,
      );
    }

    if (query.filters.interfaceName && isUplinkUsageKind(kind)) {
      statement.append(
        SQL` AND interfaceName = ${{
          type: TableColumnType.Text,
          value: query.filters.interfaceName,
        }}`,
      );
    }

    return statement;
  }

  /*
   * One kind's bytes in the range - and, for the applications, the flows
   * Meraki's traffic analytics counted - each row's share of them. With
   * them, how many rows the kind's lists have in all (issue #5762): the
   * networks Top networks groups (when the kind is the page's primary
   * kind), and the applications or clients their lists group, by the same
   * keys and the same rows left out, so "View all 523" is the list's own
   * count.
   */
  public static buildTotalsStatement(
    query: NetworkTrafficUsageQuery,
    kind: NetworkTrafficUsageKind,
  ): Statement {
    return SQL`SELECT sum(toFloat64(sentOctets) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalReceived, sum(toFloat64(flows) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalFlows, uniqExact(controllerNetworkId) AS networkTotal`)
      .append(
        kind === NetworkTrafficUsageKind.Application
          ? `, uniqExactIf(application, application != '') AS listTotal`
          : kind === NetworkTrafficUsageKind.Client
            ? `, uniqExactIf(clientKey, clientKey != '') AS listTotal`
            : "",
      )
      .append(SQL` FROM ${TABLE_NAME}`)
      .append(NetworkTrafficUsageAggregationService.buildWhere(query, kind))
      .append(QUERY_SETTINGS);
  }

  /*
   * What a whole list is sorted by: both directions, what came in
   * (received) or what went out (sent) - busiest first, then by the list's
   * key, so a row never moves between two pages read one after another.
   */
  public static getListOrder(
    sortBy: NetworkTrafficUsageListSort,
    key: string,
  ): string {
    const busiest: string =
      sortBy === NetworkTrafficUsageListSort.In
        ? "totalReceived DESC"
        : sortBy === NetworkTrafficUsageListSort.Out
          ? "totalSent DESC"
          : "(totalSent + totalReceived) DESC";

    return ` ORDER BY ${busiest}, ${key} ASC`;
  }

  /*
   * ` AND <one of the columns holds the text>`, without case: a list's
   * search. The text is a bound parameter; positionCaseInsensitiveUTF8 is a
   * plain substring search, in time that grows with the text, whatever the
   * text holds - no pattern, nothing to escape.
   */
  public static buildSearchCondition(
    search: string,
    columns: Array<string>,
  ): Statement {
    const statement: Statement = SQL``;

    if (!search || columns.length === 0) {
      return statement;
    }

    statement.append(" AND (");

    columns.forEach((column: string, index: number): void => {
      statement.append(index === 0 ? "" : " OR ");
      statement.append(
        SQL`positionCaseInsensitiveUTF8(`
          .append(column)
          .append(SQL`, ${{ type: TableColumnType.Text, value: search }}) > 0`),
      );
    });

    statement.append(")");

    return statement;
  }

  /*
   * A list's rows of one kind, before they are grouped: the rows the page's
   * top list reads (the same kind, the same WHERE, the same rows left out),
   * with the search.
   */
  private static buildListWhere(data: NetworkTrafficUsageListQuery): {
    kind: NetworkTrafficUsageKind;
    where: Statement;
  } {
    if (data.list === NetworkTrafficUsageListKind.Applications) {
      return {
        kind: NetworkTrafficUsageKind.Application,
        where: NetworkTrafficUsageAggregationService.buildWhere(
          data.query,
          NetworkTrafficUsageKind.Application,
        )
          .append(" AND application != ''")
          .append(
            NetworkTrafficUsageAggregationService.buildSearchCondition(
              data.search,
              ["application"],
            ),
          ),
      };
    }

    if (data.list === NetworkTrafficUsageListKind.Clients) {
      return {
        kind: NetworkTrafficUsageKind.Client,
        where: NetworkTrafficUsageAggregationService.buildWhere(
          data.query,
          NetworkTrafficUsageKind.Client,
        )
          .append(" AND clientKey != ''")
          .append(
            NetworkTrafficUsageAggregationService.buildSearchCondition(
              data.search,
              ["clientName", "clientIp", "clientMac", "clientManufacturer"],
            ),
          ),
      };
    }

    return {
      kind: data.primaryKind,
      where: NetworkTrafficUsageAggregationService.buildWhere(
        data.query,
        data.primaryKind,
      ).append(
        NetworkTrafficUsageAggregationService.buildSearchCondition(
          data.search,
          ["controllerNetworkName", "controllerNetworkId"],
        ),
      ),
    };
  }

  /*
   * A page of a whole list: grouped as its top list groups, sorted as asked,
   * from `skip`, `limit` rows. Both are whole numbers checked here, spliced
   * as numbers: nothing else from the request reaches the SQL but bound
   * parameters.
   */
  public static buildListStatement(
    data: NetworkTrafficUsageListQuery,
  ): Statement {
    if (
      !Number.isInteger(data.skip) ||
      data.skip < 0 ||
      data.skip > MAX_NETWORK_TRAFFIC_USAGE_LIST_SKIP ||
      !Number.isInteger(data.limit) ||
      data.limit < 1 ||
      data.limit > MAX_NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE
    ) {
      throw new BadDataException("A list's page is out of range");
    }

    const page: string = ` LIMIT ${data.limit} OFFSET ${data.skip}`;
    const where: Statement =
      NetworkTrafficUsageAggregationService.buildListWhere(data).where;
    const weight: () => Statement = (): Statement => {
      return NetworkTrafficUsageAggregationService.buildWeight(data.query);
    };

    if (data.list === NetworkTrafficUsageListKind.Applications) {
      return SQL`SELECT application AS applicationKey, argMax(protocol, toFloat64(sentOctets) + toFloat64(receivedOctets)) AS topProtocol, argMax(port, toFloat64(sentOctets) + toFloat64(receivedOctets)) AS topPort, sum(toFloat64(sentOctets) * `
        .append(weight())
        .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
        .append(weight())
        .append(`) AS totalReceived, sum(toFloat64(flows) * `)
        .append(weight())
        .append(SQL`) AS totalFlows FROM ${TABLE_NAME}`)
        .append(where)
        .append(" GROUP BY applicationKey")
        .append(
          NetworkTrafficUsageAggregationService.getListOrder(
            data.sortBy,
            "applicationKey",
          ),
        )
        .append(page)
        .append(QUERY_SETTINGS);
    }

    if (data.list === NetworkTrafficUsageListKind.Clients) {
      return SQL`SELECT clientKey AS clientKeyValue, any(clientName) AS clientNameValue, any(clientIp) AS clientIpValue, any(clientMac) AS clientMacValue, any(clientManufacturer) AS manufacturerValue, any(controllerNetworkName) AS networkName, sum(toFloat64(sentOctets) * `
        .append(weight())
        .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
        .append(weight())
        .append(SQL`) AS totalReceived FROM ${TABLE_NAME}`)
        .append(where)
        .append(" GROUP BY clientKeyValue")
        .append(
          NetworkTrafficUsageAggregationService.getListOrder(
            data.sortBy,
            "clientKeyValue",
          ),
        )
        .append(page)
        .append(QUERY_SETTINGS);
    }

    return SQL`SELECT controllerNetworkId AS networkKey, any(controllerNetworkName) AS networkName, sum(toFloat64(sentOctets) * `
      .append(weight())
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(weight())
      .append(SQL`) AS totalReceived FROM ${TABLE_NAME}`)
      .append(where)
      .append(" GROUP BY networkKey")
      .append(
        NetworkTrafficUsageAggregationService.getListOrder(
          data.sortBy,
          "networkKey",
        ),
      )
      .append(page)
      .append(QUERY_SETTINGS);
  }

  // How many rows the search matches in all: what the pages page through.
  public static buildListCountStatement(
    data: NetworkTrafficUsageListQuery,
  ): Statement {
    const key: string =
      data.list === NetworkTrafficUsageListKind.Applications
        ? "application"
        : data.list === NetworkTrafficUsageListKind.Clients
          ? "clientKey"
          : "controllerNetworkId";

    return SQL`SELECT uniqExact(`
      .append(key)
      .append(SQL`) AS listTotal FROM ${TABLE_NAME}`)
      .append(NetworkTrafficUsageAggregationService.buildListWhere(data).where)
      .append(QUERY_SETTINGS);
  }

  /*
   * The appliances behind the uplink rows since `since` - the caller's read
   * scope applied as on every page - each by its newest window: its name
   * and network as Meraki calls them now (a window that named none never
   * wins over one that did), the connection that read it, and whose its
   * newest rows are. In serial order, so a list cut at its limit is the
   * same list each time.
   */
  public static buildAppliancesStatement(data: {
    projectId: ObjectID;
    devices: TelemetryServiceFilter;
    since: Date;
    serials?: Array<string> | undefined;
    controllerNetworkIds?: Array<string> | undefined;
    limit: number;
  }): Statement {
    if (!Number.isInteger(data.limit) || data.limit < 1) {
      throw new BadDataException("limit must be at least 1");
    }

    const statement: Statement = SQL`SELECT deviceSerial AS serialKey, argMaxIf(deviceName, windowEndAt, deviceName != '') AS applianceName, argMax(controllerNetworkId, windowEndAt) AS networkKey, argMaxIf(controllerNetworkName, windowEndAt, controllerNetworkName != '') AS networkName, argMax(connectionId, windowEndAt) AS connectionKey, argMax(networkDeviceId, windowEndAt) AS deviceKey, toUnixTimestamp64Milli(max(windowEndAt)) AS lastWindowEndMs, sum(toFloat64(sentOctets) + toFloat64(receivedOctets)) AS totalOctets FROM ${TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND kind = ${{
          type: TableColumnType.Text,
          value: NetworkTrafficUsageKind.Uplink,
        }}
        AND windowStartAt >= ${{
          type: TableColumnType.DateTime64,
          value: data.since,
        }}
        AND deviceSerial != ''`;

    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.devices,
      "networkDeviceId",
    );

    if (data.serials) {
      statement.append(
        SQL` AND has(${{
          type: TableColumnType.ArrayText,
          value: data.serials,
        }}, deviceSerial)`,
      );
    }

    if (data.controllerNetworkIds) {
      statement.append(
        SQL` AND has(${{
          type: TableColumnType.ArrayText,
          value: data.controllerNetworkIds,
        }}, controllerNetworkId)`,
      );
    }

    return statement
      .append(
        ` GROUP BY serialKey ORDER BY serialKey ASC LIMIT ${Math.floor(data.limit)}`,
      )
      .append(QUERY_SETTINGS);
  }

  /*
   * ` WHERE <the rows a refile moves>`: the project's rows that `from` holds
   * now, of the connection when one is named, still kept - an appliance's
   * uplinks and their health by its serial, a network's applications and
   * clients by the network.
   */
  private static buildRefileWhere(
    refile: NetworkTrafficUsageRefile,
  ): Statement {
    const statement: Statement = SQL`
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: refile.projectId,
      }}
        AND networkDeviceId = ${{
          type: TableColumnType.ObjectID,
          value: refile.fromDeviceId,
        }}
        AND windowStartAt >= ${{
          type: TableColumnType.DateTime64,
          value: refile.since,
        }}`;

    if (refile.connectionId) {
      statement.append(
        SQL` AND connectionId = ${{
          type: TableColumnType.ObjectID,
          value: refile.connectionId,
        }}`,
      );
    }

    return statement.append(
      SQL` AND ((kind IN (${{
        type: TableColumnType.Text,
        value: NetworkTrafficUsageKind.Uplink,
      }}, ${{
        type: TableColumnType.Text,
        value: NetworkTrafficUsageKind.UplinkHealth,
      }}) AND has(${{
        type: TableColumnType.ArrayText,
        value: NetworkTrafficUsageAggregationService.refileSerials(refile),
      }}, deviceSerial)) OR (kind IN (${{
        type: TableColumnType.Text,
        value: NetworkTrafficUsageKind.Application,
      }}, ${{
        type: TableColumnType.Text,
        value: NetworkTrafficUsageKind.Client,
      }}) AND has(${{
        type: TableColumnType.ArrayText,
        value: NetworkTrafficUsageAggregationService.refileNetworks(refile),
      }}, controllerNetworkId)))`,
    );
  }

  private static refileSerials(
    refile: NetworkTrafficUsageRefile,
  ): Array<string> {
    return refile.appliances.map(
      (appliance: { serial: string; deviceId: ObjectID }): string => {
        return appliance.serial;
      },
    );
  }

  private static refileNetworks(
    refile: NetworkTrafficUsageRefile,
  ): Array<string> {
    return refile.networks.map(
      (network: {
        controllerNetworkId: string;
        deviceId: ObjectID;
      }): string => {
        return network.controllerNetworkId;
      },
    );
  }

  // Whether a refile has any row to move: one row is enough to say.
  public static buildRefileCheckStatement(
    refile: NetworkTrafficUsageRefile,
  ): Statement {
    return SQL`SELECT 1 AS found FROM ${TABLE_NAME}`
      .append(NetworkTrafficUsageAggregationService.buildRefileWhere(refile))
      .append(" LIMIT 1")
      .append(QUERY_SETTINGS);
  }

  /*
   * The refile itself: `ALTER TABLE <local table> ON CLUSTER .. UPDATE
   * networkDeviceId = ..`, each row given its new device by its serial
   * (uplinks) or its network (applications and clients) through transform()
   * of two bound arrays, every row the WHERE names one of them. Neither the
   * sort key nor the partition key holds networkDeviceId, so the update
   * rewrites that one column of the parts it touches.
   */
  public static buildRefileStatement(
    refile: NetworkTrafficUsageRefile,
    table: NetworkTrafficUsageStorageTable,
  ): Statement {
    // The table's names are identifiers, the cluster clause the code's own.
    return SQL`ALTER TABLE ${table.databaseName}.${table.storageTable}`
      .append(table.onCluster)
      .append(
        SQL` UPDATE networkDeviceId = if(kind IN (${{
          type: TableColumnType.Text,
          value: NetworkTrafficUsageKind.Uplink,
        }}, ${{
          type: TableColumnType.Text,
          value: NetworkTrafficUsageKind.UplinkHealth,
        }}), transform(deviceSerial, ${{
          type: TableColumnType.ArrayText,
          value: NetworkTrafficUsageAggregationService.refileSerials(refile),
        }}, ${{
          type: TableColumnType.ArrayText,
          value: refile.appliances.map(
            (appliance: { serial: string; deviceId: ObjectID }): string => {
              return appliance.deviceId.toString();
            },
          ),
        }}, networkDeviceId), transform(controllerNetworkId, ${{
          type: TableColumnType.ArrayText,
          value: NetworkTrafficUsageAggregationService.refileNetworks(refile),
        }}, ${{
          type: TableColumnType.ArrayText,
          value: refile.networks.map(
            (network: {
              controllerNetworkId: string;
              deviceId: ObjectID;
            }): string => {
              return network.deviceId.toString();
            },
          ),
        }}, networkDeviceId))`,
      )
      .append(NetworkTrafficUsageAggregationService.buildRefileWhere(refile));
  }

  /*
   * Traffic over time: each window split over the buckets it spans (ARRAY
   * JOIN over their indexes), each bucket given the part of the window's
   * bytes its overlap is.
   */
  public static buildSeriesStatement(
    query: NetworkTrafficUsageQuery,
    kind: NetworkTrafficUsageKind,
    bucketSeconds: number,
  ): Statement {
    return NetworkTrafficUsageAggregationService.buildBucketsStatement(
      query,
      kind,
      bucketSeconds,
      { byUplink: false },
    );
  }

  /*
   * The same split, uplink by uplink, of every uplink a page narrowed to
   * one still compares it with.
   */
  public static buildUplinkSeriesStatement(
    query: NetworkTrafficUsageQuery,
    bucketSeconds: number,
  ): Statement {
    return NetworkTrafficUsageAggregationService.buildBucketsStatement(
      withoutUplinkFilter(query),
      NetworkTrafficUsageKind.Uplink,
      bucketSeconds,
      { byUplink: true },
    );
  }

  private static buildBucketsStatement(
    query: NetworkTrafficUsageQuery,
    kind: NetworkTrafficUsageKind,
    bucketSeconds: number,
    options: { byUplink: boolean },
  ): Statement {
    if (!Number.isInteger(bucketSeconds) || bucketSeconds < 60) {
      throw new BadDataException("bucketSeconds must be at least 60");
    }

    const bucketMs: number = bucketSeconds * 1000;

    return SQL`
      SELECT`
      .append(options.byUplink ? " uplinkKey," : "")
      .append(
        SQL`
        bucketIndex * ${{ type: TableColumnType.BigNumber, value: bucketMs }} AS bucketStartMs,
        sum(sent * (least(clippedEnd, (bucketIndex + 1) * ${{
          type: TableColumnType.BigNumber,
          value: bucketMs,
        }}) - greatest(clippedStart, bucketIndex * ${{
          type: TableColumnType.BigNumber,
          value: bucketMs,
        }})) / windowLength) AS bucketSent,
        sum(received * (least(clippedEnd, (bucketIndex + 1) * ${{
          type: TableColumnType.BigNumber,
          value: bucketMs,
        }}) - greatest(clippedStart, bucketIndex * ${{
          type: TableColumnType.BigNumber,
          value: bucketMs,
        }})) / windowLength) AS bucketReceived
      FROM (
        SELECT`,
      )
      .append(options.byUplink ? " interfaceName AS uplinkKey," : "")
      .append(
        SQL`
          toFloat64(sentOctets) AS sent,
          toFloat64(receivedOctets) AS received,
          greatest(toUnixTimestamp64Milli(windowStartAt), ${{
            type: TableColumnType.BigNumber,
            value: query.startTime.getTime(),
          }}) AS clippedStart,
          least(toUnixTimestamp64Milli(windowEndAt), ${{
            type: TableColumnType.BigNumber,
            value: query.endTime.getTime(),
          }}) AS clippedEnd,
          greatest(1, toUnixTimestamp64Milli(windowEndAt) - toUnixTimestamp64Milli(windowStartAt)) AS windowLength
        FROM ${TABLE_NAME}`,
      )
      .append(NetworkTrafficUsageAggregationService.buildWhere(query, kind))
      .append(
        SQL`
      )
      ARRAY JOIN range(intDiv(clippedStart, ${{
        type: TableColumnType.BigNumber,
        value: bucketMs,
      }}), intDiv(clippedEnd - 1, ${{
        type: TableColumnType.BigNumber,
        value: bucketMs,
      }}) + 1) AS bucketIndex
      WHERE clippedEnd > clippedStart`,
      )
      .append(
        options.byUplink
          ? `
      GROUP BY bucketIndex, uplinkKey
      ORDER BY bucketIndex ASC, uplinkKey ASC`
          : `
      GROUP BY bucketIndex
      ORDER BY bucketIndex ASC`,
      )
      .append(QUERY_SETTINGS);
  }

  /*
   * What each uplink carried in the range, across the appliances the page is
   * of. Never held to an uplink's filter: narrowing to one still lists the
   * others beside it.
   */
  public static buildUplinkInterfacesStatement(
    query: NetworkTrafficUsageQuery,
  ): Statement {
    return SQL`SELECT interfaceName AS uplinkKey, uniqExact(deviceSerial) AS applianceTotal, sum(toFloat64(sentOctets) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(SQL`) AS totalReceived FROM ${TABLE_NAME}`)
      .append(
        NetworkTrafficUsageAggregationService.buildWhere(
          withoutUplinkFilter(query),
          NetworkTrafficUsageKind.Uplink,
        ),
      )
      .append(
        ` GROUP BY uplinkKey ORDER BY (totalSent + totalReceived) DESC LIMIT ${NETWORK_TRAFFIC_USAGE_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  /*
   * What Meraki measured on each uplink in the range, on average: over every
   * window and every appliance alike, so an outage shows in proportion to
   * how much of the range it took. NULLs are left out by avg(): a measurement
   * Meraki did not make counts for nothing, not for 0.
   */
  public static buildUplinkHealthStatement(
    query: NetworkTrafficUsageQuery,
  ): Statement {
    return SQL`SELECT interfaceName AS uplinkKey, avg(lossPercent) AS averageLoss, avg(latencyMs) AS averageLatency FROM ${TABLE_NAME}`
      .append(
        NetworkTrafficUsageAggregationService.buildWhere(
          withoutUplinkFilter(query),
          NetworkTrafficUsageKind.UplinkHealth,
        ),
      )
      .append(
        ` GROUP BY uplinkKey ORDER BY uplinkKey ASC LIMIT ${NETWORK_TRAFFIC_USAGE_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  /*
   * The same bucket by bucket. Windows are never split here, as bytes are:
   * they are measurements, and no bucket is narrower than a window.
   */
  public static buildUplinkHealthSeriesStatement(
    query: NetworkTrafficUsageQuery,
    bucketSeconds: number,
  ): Statement {
    if (!Number.isInteger(bucketSeconds) || bucketSeconds < 60) {
      throw new BadDataException("bucketSeconds must be at least 60");
    }

    const bucketMs: number = bucketSeconds * 1000;

    return SQL`SELECT intDiv(toUnixTimestamp64Milli(windowStartAt), ${{
      type: TableColumnType.BigNumber,
      value: bucketMs,
    }}) * ${{
      type: TableColumnType.BigNumber,
      value: bucketMs,
    }} AS bucketStartMs, interfaceName AS uplinkKey, avg(lossPercent) AS averageLoss, avg(latencyMs) AS averageLatency FROM ${TABLE_NAME}`
      .append(
        NetworkTrafficUsageAggregationService.buildWhere(
          withoutUplinkFilter(query),
          NetworkTrafficUsageKind.UplinkHealth,
        ),
      )
      .append(
        " GROUP BY bucketStartMs, uplinkKey ORDER BY bucketStartMs ASC, uplinkKey ASC",
      )
      .append(QUERY_SETTINGS);
  }

  public static buildTopNetworksStatement(
    query: NetworkTrafficUsageQuery,
    kind: NetworkTrafficUsageKind,
  ): Statement {
    return SQL`SELECT controllerNetworkId AS networkKey, any(controllerNetworkName) AS networkName, sum(toFloat64(sentOctets) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(SQL`) AS totalReceived FROM ${TABLE_NAME}`)
      .append(NetworkTrafficUsageAggregationService.buildWhere(query, kind))
      .append(
        ` GROUP BY networkKey ORDER BY (totalSent + totalReceived) DESC LIMIT ${NETWORK_TRAFFIC_USAGE_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  public static buildTopUplinksStatement(
    query: NetworkTrafficUsageQuery,
  ): Statement {
    return SQL`SELECT deviceSerial AS serialKey, interfaceName AS uplinkKey, any(deviceName) AS applianceName, any(controllerNetworkId) AS networkKey, any(controllerNetworkName) AS networkName, any(networkDeviceId) AS deviceId, sum(toFloat64(sentOctets) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(SQL`) AS totalReceived FROM ${TABLE_NAME}`)
      .append(
        NetworkTrafficUsageAggregationService.buildWhere(
          query,
          NetworkTrafficUsageKind.Uplink,
        ),
      )
      .append(
        ` GROUP BY serialKey, uplinkKey ORDER BY (totalSent + totalReceived) DESC LIMIT ${NETWORK_TRAFFIC_USAGE_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  // The row that sums a busy window's rest (application '') is left out.
  public static buildTopApplicationsStatement(
    query: NetworkTrafficUsageQuery,
  ): Statement {
    return SQL`SELECT application AS applicationKey, argMax(protocol, toFloat64(sentOctets) + toFloat64(receivedOctets)) AS topProtocol, argMax(port, toFloat64(sentOctets) + toFloat64(receivedOctets)) AS topPort, sum(toFloat64(sentOctets) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalReceived, sum(toFloat64(flows) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(SQL`) AS totalFlows FROM ${TABLE_NAME}`)
      .append(
        NetworkTrafficUsageAggregationService.buildWhere(
          query,
          NetworkTrafficUsageKind.Application,
        ),
      )
      .append(
        ` AND application != '' GROUP BY applicationKey ORDER BY (totalSent + totalReceived) DESC LIMIT ${NETWORK_TRAFFIC_USAGE_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  public static buildTopDestinationsStatement(
    query: NetworkTrafficUsageQuery,
  ): Statement {
    return SQL`SELECT destination AS destinationKey, argMax(application, toFloat64(sentOctets) + toFloat64(receivedOctets)) AS topApplication, argMax(protocol, toFloat64(sentOctets) + toFloat64(receivedOctets)) AS topProtocol, argMax(port, toFloat64(sentOctets) + toFloat64(receivedOctets)) AS topPort, sum(toFloat64(sentOctets) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(SQL`) AS totalReceived FROM ${TABLE_NAME}`)
      .append(
        NetworkTrafficUsageAggregationService.buildWhere(
          query,
          NetworkTrafficUsageKind.Application,
        ),
      )
      .append(
        ` AND destination != '' GROUP BY destinationKey ORDER BY (totalSent + totalReceived) DESC LIMIT ${NETWORK_TRAFFIC_USAGE_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  // The row that sums a busy window's other clients (clientKey '') is left out.
  public static buildTopClientsStatement(
    query: NetworkTrafficUsageQuery,
  ): Statement {
    return SQL`SELECT clientKey AS clientKeyValue, any(clientName) AS clientNameValue, any(clientIp) AS clientIpValue, any(clientMac) AS clientMacValue, any(clientManufacturer) AS manufacturerValue, any(controllerNetworkName) AS networkName, sum(toFloat64(sentOctets) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(SQL`) AS totalReceived FROM ${TABLE_NAME}`)
      .append(
        NetworkTrafficUsageAggregationService.buildWhere(
          query,
          NetworkTrafficUsageKind.Client,
        ),
      )
      .append(
        ` AND clientKey != '' GROUP BY clientKeyValue ORDER BY (totalSent + totalReceived) DESC LIMIT ${NETWORK_TRAFFIC_USAGE_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  /*
   * What each network reached, by destination, protocol and port: the
   * nearest thing to a conversation the dashboard API reports. Meraki names
   * only the application for some traffic, so a row with no destination
   * stays, kept apart by its application: Teams and Dropbox on TCP 443 are
   * not one conversation. It is left out only when it is the row that sums a
   * busy window's rest, which names neither.
   */
  public static buildTopConversationsStatement(
    query: NetworkTrafficUsageQuery,
  ): Statement {
    return SQL`SELECT controllerNetworkId AS networkKey, any(controllerNetworkName) AS networkName, destination AS destinationKey, protocol AS protocolKey, port AS portKey, if(destination = '', application, '') AS applicationWithoutDestination, argMax(application, toFloat64(sentOctets) + toFloat64(receivedOctets)) AS topApplication, max(clients) AS mostClients, sum(toFloat64(sentOctets) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalReceived, sum(toFloat64(flows) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(SQL`) AS totalFlows FROM ${TABLE_NAME}`)
      .append(
        NetworkTrafficUsageAggregationService.buildWhere(
          query,
          NetworkTrafficUsageKind.Application,
        ),
      )
      .append(
        ` AND (destination != '' OR application != '') GROUP BY networkKey, destinationKey, protocolKey, portKey, applicationWithoutDestination ORDER BY (totalSent + totalReceived) DESC LIMIT ${NETWORK_TRAFFIC_USAGE_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  // The newest window of each kind the page's devices have, within retention.
  public static buildFreshnessStatement(data: {
    projectId: ObjectID;
    devices: TelemetryServiceFilter;
    now: Date;
  }): Statement {
    const statement: Statement = SQL`
      SELECT kind AS usageKind, connectionId AS connectionKey, toUnixTimestamp64Milli(max(windowEndAt)) AS lastWindowEndMs
      FROM ${TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND windowStartAt >= ${{
          type: TableColumnType.DateTime64,
          value: new Date(
            data.now.getTime() -
              (MAX_NETWORK_TRAFFIC_RANGE_DAYS + 1) * 24 * 60 * 60 * 1000,
          ),
        }}`;

    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.devices,
      "networkDeviceId",
    );

    return statement
      .append(" GROUP BY usageKind, connectionKey")
      .append(QUERY_SETTINGS);
  }

  /*
   * The windows of a connection, from the earliest to the latest a read is
   * about to write, that hold at least one row: an uplink kind by start
   * alone (one call covers every network), the rest by network and start.
   */
  public static buildStoredWindowsStatement(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    windows: Array<NetworkTrafficUsageWindowKey>;
  }): Statement {
    let earliest: number = Number.POSITIVE_INFINITY;
    let latest: number = Number.NEGATIVE_INFINITY;

    for (const window of data.windows) {
      earliest = Math.min(earliest, window.windowStartAt.getTime());
      latest = Math.max(latest, window.windowStartAt.getTime());
    }

    return SQL`
      SELECT
        kind AS usageKind,
        if(kind IN (${{
          type: TableColumnType.Text,
          value: NetworkTrafficUsageKind.Uplink,
        }}, ${{
          type: TableColumnType.Text,
          value: NetworkTrafficUsageKind.UplinkHealth,
        }}), '', controllerNetworkId) AS networkKey,
        toUnixTimestamp64Milli(windowStartAt) AS windowStartMs
      FROM ${TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND windowStartAt >= ${{
          type: TableColumnType.DateTime64,
          value: new Date(earliest),
        }}
        AND windowStartAt <= ${{
          type: TableColumnType.DateTime64,
          value: new Date(latest),
        }}
        AND connectionId = ${{
          type: TableColumnType.ObjectID,
          value: data.connectionId,
        }}
      GROUP BY usageKind, networkKey, windowStartMs`.append(QUERY_SETTINGS);
  }

  /*
   * The newest end of a connection's windows per kind and network (an
   * uplink kind as one), of the windows that end after `since` - found by their start,
   * the table's sort key: no window is longer than MAX_WINDOW_MS.
   */
  public static buildStoredWindowEndsStatement(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    since: Date;
  }): Statement {
    return SQL`
      SELECT
        kind AS usageKind,
        if(kind IN (${{
          type: TableColumnType.Text,
          value: NetworkTrafficUsageKind.Uplink,
        }}, ${{
          type: TableColumnType.Text,
          value: NetworkTrafficUsageKind.UplinkHealth,
        }}), '', controllerNetworkId) AS networkKey,
        toUnixTimestamp64Milli(max(windowEndAt)) AS lastWindowEndMs
      FROM ${TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND windowStartAt >= ${{
          type: TableColumnType.DateTime64,
          value: new Date(data.since.getTime() - MAX_WINDOW_MS),
        }}
        AND windowEndAt > ${{
          type: TableColumnType.DateTime64,
          value: data.since,
        }}
        AND connectionId = ${{
          type: TableColumnType.ObjectID,
          value: data.connectionId,
        }}
      GROUP BY usageKind, networkKey`.append(QUERY_SETTINGS);
  }

  private static async run(statement: Statement): Promise<Array<JSONObject>> {
    const result: Results =
      await NetworkTrafficUsageService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []) as Array<JSONObject>;
  }

  public static isTimeout(error: unknown): boolean {
    return AnalyticsDatabaseService.isQueryTimeoutError(error);
  }
}
