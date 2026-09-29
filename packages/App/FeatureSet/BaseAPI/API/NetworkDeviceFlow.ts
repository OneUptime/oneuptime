import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkFlowService from "Common/Server/Services/NetworkFlowService";

/*
 * Top-talkers rollup for one network device over a time window, aggregated
 * straight from NetFlow records in ClickHouse: top source IPs, top
 * destination IPs and top protocol/destination-port pairs by bytes, plus
 * window totals. The device is resolved through the permission-scoped
 * props helper (a user only queries devices they can read) and only its
 * UUID and the project's UUID are interpolated into SQL — all aggregation
 * prunes on the (projectId, networkDeviceId, flowStartAt) sort key.
 */

const DEFAULT_WINDOW_MINUTES: number = 60;
const MAX_RANGE_DAYS: number = 31;
const TOP_LIMIT: number = 10;

const QUERY_SETTINGS: string =
  "SETTINGS max_execution_time = 30, timeout_overflow_mode = 'break', max_memory_usage = 2000000000";

export interface FlowTopEntry {
  key: string;
  octets: number;
  packets: number;
}

export interface FlowTopProtocolPortEntry {
  protocolNumber: number;
  destinationPort: number;
  octets: number;
  packets: number;
}

export interface FlowConversationEntry {
  sourceIp: string;
  destinationIp: string;
  octets: number;
  packets: number;
}

export interface FlowSeriesPoint {
  // Bucket start, ISO string.
  time: string;
  octets: number;
  packets: number;
}

/*
 * Bucket width for the bandwidth-over-time series: whole minutes, sized so
 * a window renders at most ~120 points. One hour → 1-minute buckets, a day
 * → 12-minute buckets, the 31-day max → ~6-hour buckets.
 */
export function pickBucketSeconds(windowInSeconds: number): number {
  const targetPoints: number = 120;
  const rawSeconds: number = Math.ceil(windowInSeconds / targetPoints);
  return Math.max(60, Math.ceil(rawSeconds / 60) * 60);
}

function escapeSql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadDataException(`${field} must be a date string`);
  }
  const parsed: Date = OneUptimeDate.fromString(value);
  if (isNaN(parsed.getTime())) {
    throw new BadDataException(`${field} is not a valid date`);
  }
  return parsed;
}

type QueryRows = Array<JSONObject>;

async function runQuery(sql: string): Promise<QueryRows> {
  const resultSet: {
    json: () => Promise<{ data: QueryRows }>;
  } = (await NetworkFlowService.executeQuery(sql)) as unknown as {
    json: () => Promise<{ data: QueryRows }>;
  };

  const parsed: { data: QueryRows } = await resultSet.json();
  return parsed.data || [];
}

export default class NetworkDeviceFlowAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/network-device/flow/top-talkers",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.tenantId) {
            throw new BadDataException("Project not found in request");
          }

          const body: JSONObject = req.body as JSONObject;
          const networkDeviceIdAsString: unknown = body["networkDeviceId"];

          if (
            typeof networkDeviceIdAsString !== "string" ||
            !networkDeviceIdAsString
          ) {
            throw new BadDataException("networkDeviceId is required");
          }

          /*
           * Permission-scoped device lookup: enforces that the device
           * belongs to the caller's project AND that the caller can read
           * it (the flow table's read ACL mirrors the device's). Only the
           * resolved UUIDs reach SQL.
           */
          const device: NetworkDevice | null =
            await NetworkDeviceService.findOneBy({
              query: {
                _id: new ObjectID(networkDeviceIdAsString),
                projectId: props.tenantId,
              },
              select: {
                _id: true,
              },
              props: props,
            });

          if (!device || !device.id) {
            throw new BadDataException("Network device not found");
          }

          // Default window: the last hour, ending now.
          const endTime: Date =
            parseOptionalDate(body["endTime"], "endTime") ||
            OneUptimeDate.getCurrentDate();
          const startTime: Date =
            parseOptionalDate(body["startTime"], "startTime") ||
            OneUptimeDate.addRemoveMinutes(endTime, -DEFAULT_WINDOW_MINUTES);

          if (endTime.getTime() <= startTime.getTime()) {
            throw new BadDataException("endTime must be after startTime");
          }

          if (
            endTime.getTime() - startTime.getTime() >
            MAX_RANGE_DAYS * 24 * 60 * 60 * 1000
          ) {
            throw new BadDataException(
              `Time range cannot exceed ${MAX_RANGE_DAYS} days`,
            );
          }

          const databaseName: string =
            NetworkFlowService.database.getDatasourceOptions().database ||
            "oneuptime";
          const tableRef: string = `${databaseName}.${NetworkFlowService.model.tableName}`;

          const projectIdSql: string = escapeSql(props.tenantId.toString());
          const deviceIdSql: string = escapeSql(device.id.toString());
          const startSql: string = `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(startTime)}', 9)`;
          const endSql: string = `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(endTime)}', 9)`;

          const whereClause: string = `
            WHERE projectId = '${projectIdSql}'
              AND networkDeviceId = '${deviceIdSql}'
              AND flowStartAt >= ${startSql}
              AND flowStartAt < ${endSql}
          `;

          const totalsSql: string = `
            SELECT
              sum(octets) AS totalOctets,
              sum(packets) AS totalPackets,
              count() AS totalFlows
            FROM ${tableRef}
            ${whereClause}
            ${QUERY_SETTINGS}
          `;

          const topSourcesSql: string = `
            SELECT
              srcIp AS key,
              sum(octets) AS octets,
              sum(packets) AS packets
            FROM ${tableRef}
            ${whereClause}
            GROUP BY srcIp
            ORDER BY octets DESC
            LIMIT ${TOP_LIMIT}
            ${QUERY_SETTINGS}
          `;

          const topDestinationsSql: string = `
            SELECT
              dstIp AS key,
              sum(octets) AS octets,
              sum(packets) AS packets
            FROM ${tableRef}
            ${whereClause}
            GROUP BY dstIp
            ORDER BY octets DESC
            LIMIT ${TOP_LIMIT}
            ${QUERY_SETTINGS}
          `;

          /*
           * Protocol/port pairs key on the DESTINATION port — for
           * client-server traffic that is the service port (443, 53, ...),
           * while the source port is usually an ephemeral one.
           */
          const topProtocolPortsSql: string = `
            SELECT
              protocol AS protocolNumber,
              dstPort AS destinationPort,
              sum(octets) AS octets,
              sum(packets) AS packets
            FROM ${tableRef}
            ${whereClause}
            GROUP BY protocol, dstPort
            ORDER BY octets DESC
            LIMIT ${TOP_LIMIT}
            ${QUERY_SETTINGS}
          `;

          /*
           * Conversations: who talked to whom, as a pair. The independent
           * srcIp / dstIp rollups above cannot answer this — a host can be
           * a top source without any single peer being significant.
           */
          const topConversationsSql: string = `
            SELECT
              srcIp AS sourceIp,
              dstIp AS destinationIp,
              sum(octets) AS octets,
              sum(packets) AS packets
            FROM ${tableRef}
            ${whereClause}
            GROUP BY srcIp, dstIp
            ORDER BY octets DESC
            LIMIT ${TOP_LIMIT}
            ${QUERY_SETTINGS}
          `;

          const bucketSeconds: number = pickBucketSeconds(
            Math.floor((endTime.getTime() - startTime.getTime()) / 1000),
          );

          const seriesSql: string = `
            SELECT
              toStartOfInterval(flowStartAt, INTERVAL ${bucketSeconds} second) AS bucket,
              sum(octets) AS octets,
              sum(packets) AS packets
            FROM ${tableRef}
            ${whereClause}
            GROUP BY bucket
            ORDER BY bucket ASC
            ${QUERY_SETTINGS}
          `;

          const [
            totalsRows,
            sourceRows,
            destinationRows,
            protocolPortRows,
            conversationRows,
            seriesRows,
          ]: [
            QueryRows,
            QueryRows,
            QueryRows,
            QueryRows,
            QueryRows,
            QueryRows,
          ] = await Promise.all([
            runQuery(totalsSql),
            runQuery(topSourcesSql),
            runQuery(topDestinationsSql),
            runQuery(topProtocolPortsSql),
            runQuery(topConversationsSql),
            runQuery(seriesSql),
          ]);

          const toTopEntry: (row: JSONObject) => FlowTopEntry = (
            row: JSONObject,
          ): FlowTopEntry => {
            return {
              key: String(row["key"] ?? ""),
              octets: Number(row["octets"]) || 0,
              packets: Number(row["packets"]) || 0,
            };
          };

          const topProtocolPorts: Array<FlowTopProtocolPortEntry> =
            protocolPortRows.map(
              (row: JSONObject): FlowTopProtocolPortEntry => {
                return {
                  protocolNumber: Number(row["protocolNumber"]) || 0,
                  destinationPort: Number(row["destinationPort"]) || 0,
                  octets: Number(row["octets"]) || 0,
                  packets: Number(row["packets"]) || 0,
                };
              },
            );

          const topConversations: Array<FlowConversationEntry> =
            conversationRows.map((row: JSONObject): FlowConversationEntry => {
              return {
                sourceIp: String(row["sourceIp"] ?? ""),
                destinationIp: String(row["destinationIp"] ?? ""),
                octets: Number(row["octets"]) || 0,
                packets: Number(row["packets"]) || 0,
              };
            });

          const series: Array<FlowSeriesPoint> = seriesRows.map(
            (row: JSONObject): FlowSeriesPoint => {
              return {
                time: String(row["bucket"] ?? ""),
                octets: Number(row["octets"]) || 0,
                packets: Number(row["packets"]) || 0,
              };
            },
          );

          return Response.sendJsonObjectResponse(req, res, {
            networkDeviceId: device.id.toString(),
            windowStartAt: OneUptimeDate.toString(startTime),
            windowEndAt: OneUptimeDate.toString(endTime),
            totalOctets: Number(totalsRows[0]?.["totalOctets"]) || 0,
            totalPackets: Number(totalsRows[0]?.["totalPackets"]) || 0,
            totalFlows: Number(totalsRows[0]?.["totalFlows"]) || 0,
            topSources: sourceRows.map(toTopEntry),
            topDestinations: destinationRows.map(toTopEntry),
            topProtocolPorts: topProtocolPorts,
            topConversations: topConversations,
            series: series,
            seriesBucketSeconds: bucketSeconds,
          } as unknown as JSONObject);
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
