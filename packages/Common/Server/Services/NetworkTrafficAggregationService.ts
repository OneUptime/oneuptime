import NetworkFlowService from "./NetworkFlowService";
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
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import {
  NETWORK_TRAFFIC_SOURCES_LIMIT,
  NETWORK_TRAFFIC_SOURCES_LOOKBACK_MINUTES,
  NETWORK_TRAFFIC_TOP_LIMIT,
  NetworkTrafficAddressRow,
  NetworkTrafficApplicationRow,
  NetworkTrafficConversationRow,
  NetworkTrafficDeviceRow,
  NetworkTrafficFilters,
  NetworkTrafficInterfaceRow,
  NetworkTrafficSeriesPoint,
  NetworkTrafficSource,
  NetworkTrafficTotals,
} from "../../Types/NetFlow/NetworkTraffic";
import ObjectID from "../../Types/ObjectID";

/*
 * THE TRAFFIC PAGES' READS, straight from the NetworkFlow table.
 *
 * Every read is bounded the same three ways:
 *
 *   - by project and time: the WHERE starts with projectId and a flowStartAt
 *     range - the table's sort key - so ClickHouse reads only that project's
 *     parts of that window (31 days at most, the retention);
 *   - by who is asking: `devices` is the caller's read scope already narrowed
 *     to the page (TelemetryReadScopeUtil.toServiceFilter), applied on
 *     networkDeviceId, so nobody sees the flows of a device they cannot read;
 *   - by time and memory: each query carries max_execution_time with
 *     timeout_overflow_mode 'throw' (under the client's own timeout), and a
 *     memory ceiling. 'break' would answer a grouped read that ran out of
 *     time with an EMPTY result - an empty page that looks like "no traffic"
 *     when there was too much. A timeout is an error the page can explain.
 *
 * Every value from the request reaches SQL as a bound parameter; the only
 * text spliced in is this file's own.
 */

const TABLE_NAME: string = AnalyticsTableName.NetworkFlow;

// Under the ClickHouse client's own 58 s request timeout.
export const NETWORK_TRAFFIC_QUERY_TIMEOUT_SECONDS: number = 45;

const QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: NETWORK_TRAFFIC_QUERY_TIMEOUT_SECONDS,
  timeoutOverflowMode: "throw",
  boundScanMemory: true,
});

/*
 * The port that names a row's service, in SQL - the rule
 * NetworkFlowApplicationUtil.getServicePort follows: a side the probe folded
 * to 0 leaves the other; otherwise the lower port. 0 for protocols without
 * ports, whatever their port fields hold (NetFlow v5 puts ICMP's type and
 * code in the destination port).
 */
export const SERVICE_PORT_SQL: string =
  "if(protocol IN (6, 17, 33, 132), if(srcPort = 0, dstPort, if(dstPort = 0, srcPort, least(srcPort, dstPort))), 0)";

/*
 * Rows stored before the probe counted summed records read 0 here: one
 * record each.
 *
 * Every aggregate below is aliased to a name no column has: ClickHouse
 * reads a column name in an expression as an alias of the same name, so
 * `sum(octets) AS octets` beside `sumIf(octets, ..)` would nest one
 * aggregate in the other.
 */
const FLOW_COUNT_SQL: string = "greatest(flowCount, 1)";

export interface NetworkTrafficQuery {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  /*
   * The devices the page may read - the read scope narrowed to the page's
   * device or site (toServiceFilter's serviceIds / excludedServiceIds).
   */
  devices: TelemetryServiceFilter;
  filters: NetworkTrafficFilters;
}

export interface NetworkTrafficAggregates {
  totals: NetworkTrafficTotals;
  maxSamplingRate: number;
  bucketSeconds: number;
  series: Array<NetworkTrafficSeriesPoint>;
  topSources: Array<NetworkTrafficAddressRow>;
  topDestinations: Array<NetworkTrafficAddressRow>;
  topConversations: Array<NetworkTrafficConversationRow>;
  topApplications: Array<NetworkTrafficApplicationRow>;
  topInterfaces: Array<NetworkTrafficInterfaceRow>;
  topDevices: Array<NetworkTrafficDeviceRow>;
}

export default class NetworkTrafficAggregationService {
  /*
   * Everything a Traffic page shows for a window, in parallel queries.
   * `includeInterfaces` on a device's page, `includeDevices` on a site's
   * and the network's.
   */
  @CaptureSpan()
  public static async getAggregates(data: {
    query: NetworkTrafficQuery;
    bucketSeconds: number;
    includeInterfaces: boolean;
    includeDevices: boolean;
  }): Promise<NetworkTrafficAggregates> {
    const query: NetworkTrafficQuery = data.query;

    const [
      totalsRows,
      seriesRows,
      sourceRows,
      destinationRows,
      conversationRows,
      applicationRows,
      interfaceRows,
      deviceRows,
    ]: Array<Array<JSONObject>> = await Promise.all([
      NetworkTrafficAggregationService.run(
        NetworkTrafficAggregationService.buildTotalsStatement(query),
      ),
      NetworkTrafficAggregationService.run(
        NetworkTrafficAggregationService.buildSeriesStatement(
          query,
          data.bucketSeconds,
        ),
      ),
      NetworkTrafficAggregationService.run(
        NetworkTrafficAggregationService.buildTopAddressStatement(
          query,
          "srcIp",
        ),
      ),
      NetworkTrafficAggregationService.run(
        NetworkTrafficAggregationService.buildTopAddressStatement(
          query,
          "dstIp",
        ),
      ),
      NetworkTrafficAggregationService.run(
        NetworkTrafficAggregationService.buildTopConversationsStatement(query),
      ),
      NetworkTrafficAggregationService.run(
        NetworkTrafficAggregationService.buildTopApplicationsStatement(query),
      ),
      data.includeInterfaces
        ? NetworkTrafficAggregationService.run(
            NetworkTrafficAggregationService.buildTopInterfacesStatement(query),
          )
        : Promise.resolve([]),
      data.includeDevices
        ? NetworkTrafficAggregationService.run(
            NetworkTrafficAggregationService.buildTopDevicesStatement(query),
          )
        : Promise.resolve([]),
    ]);

    const totals: JSONObject = totalsRows?.[0] || {};
    const hasInterfaceFilter: boolean =
      query.filters.interfaceIndex !== undefined;

    return {
      totals: {
        octets: toNumber(totals["totalOctets"]),
        packets: toNumber(totals["totalPackets"]),
        flows: toNumber(totals["totalFlows"]),
      },
      maxSamplingRate: Math.max(1, toNumber(totals["maxSamplingRate"])),
      bucketSeconds: data.bucketSeconds,
      series: (seriesRows || []).map(
        (row: JSONObject): NetworkTrafficSeriesPoint => {
          const point: NetworkTrafficSeriesPoint = {
            time: String(row["bucket"] ?? ""),
            octets: toNumber(row["bucketOctets"]),
          };

          if (hasInterfaceFilter) {
            point.inOctets = toNumber(row["inOctets"]);
            point.outOctets = toNumber(row["outOctets"]);
          }

          return point;
        },
      ),
      topSources: (sourceRows || []).map(toAddressRow),
      topDestinations: (destinationRows || []).map(toAddressRow),
      topConversations: (conversationRows || []).map(
        (row: JSONObject): NetworkTrafficConversationRow => {
          return {
            sourceIp: String(row["sourceIp"] ?? ""),
            destinationIp: String(row["destinationIp"] ?? ""),
            octets: toNumber(row["totalOctets"]),
            packets: toNumber(row["totalPackets"]),
          };
        },
      ),
      topApplications: (applicationRows || []).map(
        (row: JSONObject): NetworkTrafficApplicationRow => {
          return {
            protocolNumber: toNumber(row["protocolNumber"]),
            port: toNumber(row["servicePort"]),
            octets: toNumber(row["totalOctets"]),
            packets: toNumber(row["totalPackets"]),
          };
        },
      ),
      topInterfaces: (interfaceRows || []).map(
        (row: JSONObject): NetworkTrafficInterfaceRow => {
          return {
            interfaceIndex: toNumber(row["interfaceIndex"]),
            inOctets: toNumber(row["inOctets"]),
            outOctets: toNumber(row["outOctets"]),
          };
        },
      ),
      topDevices: (deviceRows || []).map(
        (row: JSONObject): NetworkTrafficDeviceRow => {
          return {
            networkDeviceId: String(row["networkDeviceId"] ?? ""),
            exporterIp: String(row["exporterAddress"] ?? ""),
            octets: toNumber(row["totalOctets"]),
            packets: toNumber(row["totalPackets"]),
          };
        },
      ),
    };
  }

  /*
   * Who has sent flows in the last NETWORK_TRAFFIC_SOURCES_LOOKBACK_MINUTES
   * (within the page's devices): one row per device and address it sent
   * from, newest first. The project's bucket rows are the exporters that are
   * no device yet.
   */
  @CaptureSpan()
  public static async getSources(data: {
    projectId: ObjectID;
    devices: TelemetryServiceFilter;
    now: Date;
  }): Promise<Array<NetworkTrafficSource>> {
    const rows: Array<JSONObject> = await NetworkTrafficAggregationService.run(
      NetworkTrafficAggregationService.buildSourcesStatement(data),
    );

    return rows.map((row: JSONObject): NetworkTrafficSource => {
      const probeId: string = String(row["latestProbeId"] ?? "");

      return {
        networkDeviceId: String(row["networkDeviceId"] ?? ""),
        exporterIp: String(row["exporterIp"] ?? ""),
        flowFormat: String(row["latestFormat"] ?? ""),
        samplingRate: Math.max(1, toNumber(row["maxSamplingRate"])),
        lastFlowAt: String(row["lastFlowAt"] ?? ""),
        flows: toNumber(row["totalFlows"]),
        octets: toNumber(row["totalOctets"]),
        ...(probeId ? { probeId: probeId } : {}),
      };
    });
  }

  // When the device's newest flow started, within retention; null for never.
  @CaptureSpan()
  public static async getLastFlowAt(data: {
    projectId: ObjectID;
    networkDeviceId: ObjectID;
  }): Promise<string | null> {
    const rows: Array<JSONObject> = await NetworkTrafficAggregationService.run(
      NetworkTrafficAggregationService.buildLastFlowStatement(data),
    );

    const value: unknown = rows[0]?.["flowStartAt"];

    return value ? String(value) : null;
  }

  // ---- Statements ------------------------------------------------------------

  /*
   * ` WHERE projectId = .. AND flowStartAt in [start, end) AND <devices>
   * AND <filters>` - the part every page read shares.
   */
  public static buildWhere(query: NetworkTrafficQuery): Statement {
    const statement: Statement = SQL`
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }}
        AND flowStartAt >= ${{
          type: TableColumnType.DateTime64,
          value: query.startTime,
        }}
        AND flowStartAt < ${{
          type: TableColumnType.DateTime64,
          value: query.endTime,
        }}`;

    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      query.devices,
      "networkDeviceId",
    );

    NetworkTrafficAggregationService.appendFilters(statement, query.filters);

    return statement;
  }

  public static appendFilters(
    statement: Statement,
    filters: NetworkTrafficFilters,
  ): void {
    if (filters.sourceIp) {
      statement.append(
        SQL` AND srcIp = ${{ type: TableColumnType.Text, value: filters.sourceIp }}`,
      );
    }

    if (filters.destinationIp) {
      statement.append(
        SQL` AND dstIp = ${{
          type: TableColumnType.Text,
          value: filters.destinationIp,
        }}`,
      );
    }

    if (filters.hostIp) {
      statement.append(
        SQL` AND (srcIp = ${{ type: TableColumnType.Text, value: filters.hostIp }} OR dstIp = ${{
          type: TableColumnType.Text,
          value: filters.hostIp,
        }})`,
      );
    }

    if (filters.protocolNumber !== undefined) {
      statement.append(
        SQL` AND protocol = ${{
          type: TableColumnType.Number,
          value: filters.protocolNumber,
        }}`,
      );
    }

    if (filters.port !== undefined) {
      statement.append(
        SQL` AND (srcPort = ${{ type: TableColumnType.Number, value: filters.port }} OR dstPort = ${{
          type: TableColumnType.Number,
          value: filters.port,
        }})`,
      );
    }

    if (filters.interfaceIndex !== undefined) {
      statement.append(
        SQL` AND (inputInterfaceIndex = ${{
          type: TableColumnType.BigNumber,
          value: filters.interfaceIndex,
        }} OR outputInterfaceIndex = ${{
          type: TableColumnType.BigNumber,
          value: filters.interfaceIndex,
        }})`,
      );
    }

    if (filters.networkDeviceId) {
      statement.append(
        SQL` AND networkDeviceId = ${{
          type: TableColumnType.ObjectID,
          value: filters.networkDeviceId,
        }}`,
      );
    }

    if (filters.exporterIp) {
      statement.append(
        SQL` AND exporterIp = ${{
          type: TableColumnType.Text,
          value: filters.exporterIp,
        }}`,
      );
    }
  }

  public static buildTotalsStatement(query: NetworkTrafficQuery): Statement {
    return SQL`
      SELECT
        sum(octets) AS totalOctets,
        sum(packets) AS totalPackets,
        sum(`
      .append(FLOW_COUNT_SQL)
      .append(
        SQL`) AS totalFlows,
        max(greatest(samplingRate, 1)) AS maxSamplingRate
      FROM ${TABLE_NAME}`,
      )
      .append(NetworkTrafficAggregationService.buildWhere(query))
      .append(QUERY_SETTINGS);
  }

  public static buildSeriesStatement(
    query: NetworkTrafficQuery,
    bucketSeconds: number,
  ): Statement {
    if (!Number.isInteger(bucketSeconds) || bucketSeconds < 60) {
      throw new BadDataException("bucketSeconds must be at least 60");
    }

    const statement: Statement = SQL`
      SELECT
        toStartOfInterval(flowStartAt, INTERVAL ${{
          type: TableColumnType.Number,
          value: bucketSeconds,
        }} SECOND) AS bucket,
        sum(octets) AS bucketOctets`;

    if (query.filters.interfaceIndex !== undefined) {
      statement.append(
        SQL`,
        sumIf(octets, inputInterfaceIndex = ${{
          type: TableColumnType.BigNumber,
          value: query.filters.interfaceIndex,
        }}) AS inOctets,
        sumIf(octets, outputInterfaceIndex = ${{
          type: TableColumnType.BigNumber,
          value: query.filters.interfaceIndex,
        }}) AS outOctets`,
      );
    }

    return statement
      .append(SQL` FROM ${TABLE_NAME}`)
      .append(NetworkTrafficAggregationService.buildWhere(query))
      .append(" GROUP BY bucket ORDER BY bucket ASC")
      .append(QUERY_SETTINGS);
  }

  public static buildTopAddressStatement(
    query: NetworkTrafficQuery,
    column: "srcIp" | "dstIp",
  ): Statement {
    // The column is one of two of this file's own names, never a caller's.
    const columnSql: string = column === "srcIp" ? "srcIp" : "dstIp";

    return SQL`SELECT `
      .append(columnSql)
      .append(
        SQL` AS ip, sum(octets) AS totalOctets, sum(packets) AS totalPackets FROM ${TABLE_NAME}`,
      )
      .append(NetworkTrafficAggregationService.buildWhere(query))
      .append(
        ` GROUP BY ip ORDER BY totalOctets DESC LIMIT ${NETWORK_TRAFFIC_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  public static buildTopConversationsStatement(
    query: NetworkTrafficQuery,
  ): Statement {
    return SQL`
      SELECT
        srcIp AS sourceIp,
        dstIp AS destinationIp,
        sum(octets) AS totalOctets,
        sum(packets) AS totalPackets
      FROM ${TABLE_NAME}`
      .append(NetworkTrafficAggregationService.buildWhere(query))
      .append(
        ` GROUP BY sourceIp, destinationIp ORDER BY totalOctets DESC LIMIT ${NETWORK_TRAFFIC_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  public static buildTopApplicationsStatement(
    query: NetworkTrafficQuery,
  ): Statement {
    return SQL`SELECT protocol AS protocolNumber, `
      .append(SERVICE_PORT_SQL)
      .append(
        SQL` AS servicePort, sum(octets) AS totalOctets, sum(packets) AS totalPackets FROM ${TABLE_NAME}`,
      )
      .append(NetworkTrafficAggregationService.buildWhere(query))
      .append(
        ` GROUP BY protocolNumber, servicePort ORDER BY totalOctets DESC LIMIT ${NETWORK_TRAFFIC_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  /*
   * A device's busiest interfaces, in and out, from one scan: each row is
   * counted once for the interface it came in through and once for the one
   * it left through (ARRAY JOIN over the two), and an unknown interface (0)
   * is left out.
   */
  public static buildTopInterfacesStatement(
    query: NetworkTrafficQuery,
  ): Statement {
    return SQL`
      SELECT
        tupleElement(direction, 1) AS interfaceIndex,
        sumIf(octets, tupleElement(direction, 2) = 1) AS inOctets,
        sumIf(octets, tupleElement(direction, 2) = 2) AS outOctets
      FROM ${TABLE_NAME}
      ARRAY JOIN [(toUInt64(inputInterfaceIndex), 1), (toUInt64(outputInterfaceIndex), 2)] AS direction`
      .append(NetworkTrafficAggregationService.buildWhere(query))
      .append(
        ` GROUP BY interfaceIndex HAVING interfaceIndex > 0 ORDER BY (inOctets + outOctets) DESC LIMIT ${NETWORK_TRAFFIC_TOP_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  /*
   * The devices sending the most, on a site's or the network's page. Rows
   * of the project's bucket (exporters that are no device yet) are told
   * apart by exporter address; a device's rows sum whatever address it sent
   * from.
   */
  public static buildTopDevicesStatement(
    query: NetworkTrafficQuery,
  ): Statement {
    return SQL`
      SELECT
        networkDeviceId,
        any(exporterIp) AS exporterAddress,
        sum(octets) AS totalOctets,
        sum(packets) AS totalPackets
      FROM ${TABLE_NAME}`
      .append(NetworkTrafficAggregationService.buildWhere(query))
      .append(
        SQL` GROUP BY networkDeviceId, if(networkDeviceId = ${{
          type: TableColumnType.ObjectID,
          value: query.projectId,
        }}, exporterIp, '') ORDER BY totalOctets DESC LIMIT `,
      )
      .append(`${NETWORK_TRAFFIC_TOP_LIMIT}`)
      .append(QUERY_SETTINGS);
  }

  public static buildSourcesStatement(data: {
    projectId: ObjectID;
    devices: TelemetryServiceFilter;
    now: Date;
  }): Statement {
    const since: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -NETWORK_TRAFFIC_SOURCES_LOOKBACK_MINUTES,
    );

    /*
     * The newest format a row recorded: rows from a probe older than formats
     * carry none (''), and one of those - written later, or in the same
     * batch - must not hide it. probeId needs no guard: argMax skips NULLs.
     */
    const statement: Statement = SQL`
      SELECT
        networkDeviceId,
        exporterIp,
        argMaxIf(flowFormat, ingestedAt, flowFormat != '') AS latestFormat,
        max(greatest(samplingRate, 1)) AS maxSamplingRate,
        argMax(probeId, ingestedAt) AS latestProbeId,
        max(ingestedAt) AS lastFlowAt,
        sum(`
      .append(FLOW_COUNT_SQL)
      .append(
        SQL`) AS totalFlows,
        sum(octets) AS totalOctets
      FROM ${TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND flowStartAt >= ${{
          type: TableColumnType.DateTime64,
          value: since,
        }}`,
      );

    TelemetryReadScopeUtil.appendServiceFilter(
      statement,
      data.devices,
      "networkDeviceId",
    );

    return statement
      .append(
        ` GROUP BY networkDeviceId, exporterIp ORDER BY lastFlowAt DESC LIMIT ${NETWORK_TRAFFIC_SOURCES_LIMIT}`,
      )
      .append(QUERY_SETTINGS);
  }

  /*
   * The device's newest flow: the sort key ends in flowStartAt, so reading
   * the key backwards stops at the first row.
   */
  public static buildLastFlowStatement(data: {
    projectId: ObjectID;
    networkDeviceId: ObjectID;
  }): Statement {
    return SQL`
      SELECT flowStartAt
      FROM ${TABLE_NAME}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND networkDeviceId = ${{
          type: TableColumnType.ObjectID,
          value: data.networkDeviceId,
        }}
      ORDER BY flowStartAt DESC
      LIMIT 1`.append(QUERY_SETTINGS);
  }

  private static async run(statement: Statement): Promise<Array<JSONObject>> {
    const result: Results = await NetworkFlowService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []) as Array<JSONObject>;
  }

  /*
   * Whether a failure is ClickHouse refusing to finish in time - what the
   * API answers with "pick a shorter range" rather than a database error.
   */
  public static isTimeout(error: unknown): boolean {
    return AnalyticsDatabaseService.isQueryTimeoutError(error);
  }
}

function toNumber(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAddressRow(row: JSONObject): NetworkTrafficAddressRow {
  return {
    ip: String(row["ip"] ?? ""),
    octets: toNumber(row["totalOctets"]),
    packets: toNumber(row["totalPackets"]),
  };
}
