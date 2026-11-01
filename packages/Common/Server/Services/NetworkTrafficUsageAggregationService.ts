import NetworkTrafficUsageService from "./NetworkTrafficUsageService";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
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
  MAX_NETWORK_TRAFFIC_USAGE_WINDOW_HOURS,
  NETWORK_TRAFFIC_USAGE_TOP_LIMIT,
  NetworkTrafficUsageApplicationRow,
  NetworkTrafficUsageClientRow,
  NetworkTrafficUsageConversationRow,
  NetworkTrafficUsageDestinationRow,
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageKindTotals,
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

    return {
      primaryKind,
      totals: {
        sentOctets: primaryTotals.sentOctets,
        receivedOctets: primaryTotals.receivedOctets,
        flows: toBytes(applicationTotalsRows?.[0]?.["totalFlows"]),
      },
      applicationTotals,
      clientTotals: kindTotals(clientTotalsRows),
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
        (row: JSONObject): NetworkTrafficUsageNetworkRow => {
          return {
            controllerNetworkId: toText(row["networkKey"]),
            name: toText(row["networkName"]),
            sentOctets: toBytes(row["totalSent"]),
            receivedOctets: toBytes(row["totalReceived"]),
          };
        },
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
        (row: JSONObject): NetworkTrafficUsageApplicationRow => {
          return {
            application: toText(row["applicationKey"]),
            protocol: toText(row["topProtocol"]),
            port: toBytes(row["topPort"]),
            sentOctets: toBytes(row["totalSent"]),
            receivedOctets: toBytes(row["totalReceived"]),
            flows: toBytes(row["totalFlows"]),
          };
        },
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
        (row: JSONObject): NetworkTrafficUsageClientRow => {
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
        },
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
   * Meraki's traffic analytics counted - each row's share of them.
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
      .append(SQL`) AS totalFlows FROM ${TABLE_NAME}`)
      .append(NetworkTrafficUsageAggregationService.buildWhere(query, kind))
      .append(QUERY_SETTINGS);
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
