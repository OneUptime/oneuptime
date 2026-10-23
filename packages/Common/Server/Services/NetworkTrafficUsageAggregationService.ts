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
import { NetworkTrafficUsageWindowKey } from "../Utils/NetworkController/NetworkControllerTypes";
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
  NetworkTrafficUsageDestinationRow,
  NetworkTrafficUsageFilters,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageNetworkRow,
  NetworkTrafficUsageSeriesPoint,
  NetworkTrafficUsageTotals,
  NetworkTrafficUsageUplinkRow,
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
 * draws as twelve five-minute buckets of a twelfth each, not one spike.
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
  series: Array<NetworkTrafficUsageSeriesPoint>;
  topNetworks: Array<NetworkTrafficUsageNetworkRow>;
  topUplinks: Array<NetworkTrafficUsageUplinkRow>;
  topApplications: Array<NetworkTrafficUsageApplicationRow>;
  topDestinations: Array<NetworkTrafficUsageDestinationRow>;
  topClients: Array<NetworkTrafficUsageClientRow>;
}

export interface NetworkTrafficUsageFreshness {
  lastUplinkAt: string | null;
  lastAnalyticsAt: string | null;
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
    };

    for (const row of rows) {
      const kind: string = toText(row["usageKind"]);
      const last: string = toText(row["lastWindowEnd"]);

      if (!last) {
        continue;
      }

      if (kind === NetworkTrafficUsageKind.Uplink) {
        freshness.lastUplinkAt = last;
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
      totalsRows,
      flowsRows,
      seriesRows,
      networkRows,
      uplinkRows,
      applicationRows,
      destinationRows,
      clientRows,
    ]: Array<Array<JSONObject>> = await Promise.all([
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildTotalsStatement(
          query,
          primaryKind,
        ),
      ),
      NetworkTrafficUsageAggregationService.run(
        NetworkTrafficUsageAggregationService.buildFlowsStatement(query),
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
    ]);

    const totals: JSONObject = totalsRows?.[0] || {};

    return {
      primaryKind,
      totals: {
        sentOctets: toBytes(totals["totalSent"]),
        receivedOctets: toBytes(totals["totalReceived"]),
        flows: toBytes(flowsRows?.[0]?.["totalFlows"]),
      },
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
      topApplications: (applicationRows || []).map(
        (row: JSONObject): NetworkTrafficUsageApplicationRow => {
          return {
            application: toText(row["applicationKey"]),
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
    };
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
        NetworkTrafficUsageAggregationService.buildStoredWindowsStatement(
          data,
        ),
      );

    for (const row of rows) {
      const start: string = toText(row["windowStart"]);
      const time: number = Date.parse(
        start.includes("T") ? start : `${start.replace(" ", "T")}Z`,
      );

      if (!Number.isFinite(time)) {
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
   * shares. A deviceSerial filter holds the uplinks to that appliance; the
   * network filter holds every kind to the network.
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

    if (query.filters.deviceSerial && kind === NetworkTrafficUsageKind.Uplink) {
      statement.append(
        SQL` AND deviceSerial = ${{
          type: TableColumnType.Text,
          value: query.filters.deviceSerial,
        }}`,
      );
    }

    return statement;
  }

  public static buildTotalsStatement(
    query: NetworkTrafficUsageQuery,
    kind: NetworkTrafficUsageKind,
  ): Statement {
    return SQL`SELECT sum(toFloat64(sentOctets) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(`) AS totalSent, sum(toFloat64(receivedOctets) * `)
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(SQL`) AS totalReceived FROM ${TABLE_NAME}`)
      .append(NetworkTrafficUsageAggregationService.buildWhere(query, kind))
      .append(QUERY_SETTINGS);
  }

  // The flows Meraki's traffic analytics counted, the range's share of them.
  public static buildFlowsStatement(
    query: NetworkTrafficUsageQuery,
  ): Statement {
    return SQL`SELECT sum(toFloat64(flows) * `
      .append(NetworkTrafficUsageAggregationService.buildWeight(query))
      .append(SQL`) AS totalFlows FROM ${TABLE_NAME}`)
      .append(
        NetworkTrafficUsageAggregationService.buildWhere(
          query,
          NetworkTrafficUsageKind.Application,
        ),
      )
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
    if (!Number.isInteger(bucketSeconds) || bucketSeconds < 60) {
      throw new BadDataException("bucketSeconds must be at least 60");
    }

    const bucketMs: number = bucketSeconds * 1000;

    return SQL`
      SELECT
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
        SELECT
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
        FROM ${TABLE_NAME}`
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
      WHERE clippedEnd > clippedStart
      GROUP BY bucketIndex
      ORDER BY bucketIndex ASC`,
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
    return SQL`SELECT application AS applicationKey, sum(toFloat64(sentOctets) * `
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
    return SQL`SELECT destination AS destinationKey, argMax(application, toFloat64(sentOctets) + toFloat64(receivedOctets)) AS topApplication, sum(toFloat64(sentOctets) * `
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

  // The newest window of each kind the page's devices have, within retention.
  public static buildFreshnessStatement(data: {
    projectId: ObjectID;
    devices: TelemetryServiceFilter;
    now: Date;
  }): Statement {
    const statement: Statement = SQL`
      SELECT kind AS usageKind, max(windowEndAt) AS lastWindowEnd
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
      .append(" GROUP BY usageKind")
      .append(QUERY_SETTINGS);
  }

  /*
   * The windows of a connection, from the earliest to the latest a read is
   * about to write, that hold at least one row: uplinks by start alone
   * (one call covers every network), the rest by network and start.
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
        if(kind = ${{
          type: TableColumnType.Text,
          value: NetworkTrafficUsageKind.Uplink,
        }}, '', controllerNetworkId) AS networkKey,
        windowStartAt AS windowStart
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
      GROUP BY usageKind, networkKey, windowStart`.append(QUERY_SETTINGS);
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
