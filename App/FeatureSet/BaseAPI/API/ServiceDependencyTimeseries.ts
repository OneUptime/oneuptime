import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "Common/Types/Permission";
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
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ServiceService from "Common/Server/Services/ServiceService";
import SpanService from "Common/Server/Services/SpanService";
import Service from "Common/Models/DatabaseModels/Service";
import Span from "Common/Models/AnalyticsModels/Span";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * On-demand call history for one service-dependency edge: time-bucketed
 * call / error / latency series for a (caller, callee) pair over a user
 * time range, aggregated straight from spans in ClickHouse. This is the
 * drill-down behind the Service Map's edges — the edge rows themselves
 * only carry the latest cron window, real history lives in the spans.
 *
 * Same parent/child join as the ComputeServiceDependencies cron, but
 * filtered to a single service pair, so it prunes hard on the
 * (projectId, startTime) sort key plus primaryEntityId and stays cheap.
 * User-supplied names are resolved to Service rows through the
 * permission-scoped props helper (a user only drills into services they
 * can read) and only their UUIDs are interpolated into SQL.
 */

// Aim for ~60 points; clamp so huge ranges stay bounded and tiny ones sane.
const TARGET_BUCKETS: number = 60;
const MIN_BUCKET_SECONDS: number = 60;
const MAX_BUCKET_SECONDS: number = 24 * 60 * 60;
// Client-requested bucket sizes may go up to a month (chart-aligned).
const MAX_REQUESTED_BUCKET_SECONDS: number = 30 * 24 * 60 * 60;
const MAX_RANGE_DAYS: number = 93;
const MAX_RESULT_BUCKETS: number = 500;
const MAX_SPANS_PER_SIDE: number = 500000;

const QUERY_SETTINGS: string =
  "SETTINGS max_execution_time = 30, timeout_overflow_mode = 'break', max_memory_usage = 2000000000";

export interface DependencyTimeseriesBucket {
  bucketStart: string;
  callCount: number;
  errorCount: number;
  avgDurationMs: number;
}

function escapeSql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || !value) {
    throw new BadDataException(`${field} is required`);
  }
  const parsed: Date = OneUptimeDate.fromString(value);
  if (isNaN(parsed.getTime())) {
    throw new BadDataException(`${field} is not a valid date`);
  }
  return parsed;
}

export default class ServiceDependencyTimeseriesAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/telemetry/service-dependency-timeseries",
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

          /*
           * This endpoint reads span-derived data, so holding read on the
           * Service model alone is not enough — gate on the Span analytics
           * model's own read ACL (TelemetryViewer, ReadTelemetryServiceTraces,
           * ...), mirroring what the standard analytics API would enforce.
           */
          if (!props.isRoot && !props.isMasterAdmin) {
            const userPermissions: Array<Permission> = (
              props.userTenantAccessPermission?.[props.tenantId.toString()]
                ?.permissions || []
            ).map((userPermission: UserPermission) => {
              return userPermission.permission;
            });
            const spanReadPermissions: Array<Permission> =
              new Span().accessControl?.read || [];
            if (
              !PermissionHelper.doesPermissionsIntersect(
                userPermissions,
                spanReadPermissions,
              )
            ) {
              throw new NotAuthorizedException(
                "You do not have permission to read traces for this project.",
              );
            }
          }

          const body: JSONObject = req.body as JSONObject;
          const callerServiceName: unknown = body["callerServiceName"];
          const calleeServiceName: unknown = body["calleeServiceName"];

          if (
            typeof callerServiceName !== "string" ||
            !callerServiceName ||
            typeof calleeServiceName !== "string" ||
            !calleeServiceName
          ) {
            throw new BadDataException(
              "callerServiceName and calleeServiceName are required",
            );
          }

          const startTime: Date = parseDate(body["startTime"], "startTime");
          const endTime: Date = parseDate(body["endTime"], "endTime");

          if (endTime.getTime() <= startTime.getTime()) {
            throw new BadDataException("endTime must be after startTime");
          }

          const rangeSeconds: number = Math.ceil(
            (endTime.getTime() - startTime.getTime()) / 1000,
          );
          if (rangeSeconds > MAX_RANGE_DAYS * 24 * 60 * 60) {
            throw new BadDataException(
              `Time range cannot exceed ${MAX_RANGE_DAYS} days`,
            );
          }

          /*
           * Permission-scoped name → id resolution: the user must be able
           * to read both services, and only the resolved UUIDs reach SQL.
           */
          const resolveService: (name: string) => Promise<ObjectID> = async (
            name: string,
          ): Promise<ObjectID> => {
            /*
             * Case-insensitive: topology entity display names are
             * canonicalized to lowercase, while Service rows keep the
             * original casing — ingest matches the same way.
             */
            const service: Service | null = await ServiceService.findOneBy({
              query: {
                projectId: props.tenantId!,
                name: QueryHelper.findWithSameText(name),
              },
              select: { _id: true },
              props: props,
            });
            if (!service || !service._id) {
              throw new BadDataException(`Service "${name}" was not found`);
            }
            return new ObjectID(service._id.toString());
          };

          const [callerServiceId, calleeServiceId]: [ObjectID, ObjectID] =
            await Promise.all([
              resolveService(callerServiceName),
              resolveService(calleeServiceName),
            ]);

          /*
           * The client may request a bucket size aligned with its chart
           * intervals (1:1 buckets keep per-interval aggregation exact).
           * Honor it when it is a sane integer AND the resulting bucket
           * count stays within the result cap; otherwise fall back to
           * the ~TARGET_BUCKETS default.
           */
          let bucketSeconds: number = Math.min(
            MAX_BUCKET_SECONDS,
            Math.max(
              MIN_BUCKET_SECONDS,
              Math.ceil(rangeSeconds / TARGET_BUCKETS),
            ),
          );
          const requestedBucketSeconds: number = Number(body["bucketSeconds"]);
          if (
            Number.isInteger(requestedBucketSeconds) &&
            requestedBucketSeconds >= 1 &&
            requestedBucketSeconds <= MAX_REQUESTED_BUCKET_SECONDS &&
            /*
             * +1: toStartOfInterval aligns buckets to the epoch, not to
             * startTime, so an unaligned window can straddle one extra
             * bucket beyond ceil(range / bucket).
             */
            Math.ceil(rangeSeconds / requestedBucketSeconds) + 1 <=
              MAX_RESULT_BUCKETS
          ) {
            bucketSeconds = requestedBucketSeconds;
          }

          const projectIdSql: string = escapeSql(props.tenantId.toString());
          const serviceTypeSql: string = escapeSql(ServiceType.OpenTelemetry);
          const callerIdSql: string = escapeSql(callerServiceId.toString());
          const calleeIdSql: string = escapeSql(calleeServiceId.toString());
          const startSql: string = `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(startTime)}', 9)`;
          const endSql: string = `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(endTime)}', 9)`;

          /*
           * Truncation guard: a busy service can exceed the per-side span
           * cap over a long range, and an uncapped join is not safe. Count
           * both sides first (cheap — prunes on the (projectId, startTime)
           * sort key) so the client can say "partial data" instead of
           * silently charting a corrupted series.
           */
          const countSql: string = `
            SELECT
              countIf(primaryEntityId = '${callerIdSql}') AS callerCount,
              countIf(primaryEntityId = '${calleeIdSql}' AND parentSpanId IS NOT NULL AND parentSpanId != '') AS calleeCount
            FROM oneuptime.SpanItemV3
            WHERE projectId = '${projectIdSql}'
              AND startTime >= ${startSql}
              AND startTime < ${endSql}
              AND primaryEntityType = '${serviceTypeSql}'
              AND primaryEntityId IN ('${callerIdSql}', '${calleeIdSql}')
            ${QUERY_SETTINGS}
          `;

          const countResultSet: {
            json: () => Promise<{
              data: Array<{ callerCount: string; calleeCount: string }>;
            }>;
          } = (await SpanService.executeQuery(countSql)) as unknown as {
            json: () => Promise<{
              data: Array<{ callerCount: string; calleeCount: string }>;
            }>;
          };
          const countRows: {
            data: Array<{ callerCount: string; calleeCount: string }>;
          } = await countResultSet.json();
          const isTruncated: boolean =
            Number(countRows.data[0]?.callerCount || 0) > MAX_SPANS_PER_SIDE ||
            Number(countRows.data[0]?.calleeCount || 0) > MAX_SPANS_PER_SIDE;

          /*
           * Metrics come from the callee side (how the callee handled the
           * calls); statusCode 2 = OTel STATUS_CODE_ERROR. Bucket by the
           * callee span's start time. ORDER BY startTime DESC before the
           * caps so that when a side IS truncated, the kept spans are a
           * contiguous most-recent window instead of an arbitrary subset.
           */
          const sql: string = `
            SELECT
              toStartOfInterval(callee.startTime, INTERVAL ${bucketSeconds} second) AS bucketStart,
              count() AS callCount,
              countIf(callee.statusCode = 2) AS errorCount,
              avg(callee.durationUnixNano) AS avgDurationNano
            FROM
            (
              SELECT traceId, spanId
              FROM oneuptime.SpanItemV3
              WHERE projectId = '${projectIdSql}'
                AND startTime >= ${startSql}
                AND startTime < ${endSql}
                AND primaryEntityType = '${serviceTypeSql}'
                AND primaryEntityId = '${callerIdSql}'
              ORDER BY startTime DESC
              LIMIT ${MAX_SPANS_PER_SIDE}
            ) AS caller
            INNER JOIN
            (
              SELECT traceId, parentSpanId, startTime, statusCode, durationUnixNano
              FROM oneuptime.SpanItemV3
              WHERE projectId = '${projectIdSql}'
                AND startTime >= ${startSql}
                AND startTime < ${endSql}
                AND primaryEntityType = '${serviceTypeSql}'
                AND primaryEntityId = '${calleeIdSql}'
                AND parentSpanId IS NOT NULL
                AND parentSpanId != ''
              ORDER BY startTime DESC
              LIMIT ${MAX_SPANS_PER_SIDE}
            ) AS callee
            ON caller.traceId = callee.traceId AND caller.spanId = callee.parentSpanId
            GROUP BY bucketStart
            ORDER BY bucketStart
            LIMIT ${MAX_RESULT_BUCKETS}
            ${QUERY_SETTINGS}
          `;

          const resultSet: {
            json: () => Promise<{
              data: Array<{
                bucketStart: string;
                callCount: string;
                errorCount: string;
                avgDurationNano: string;
              }>;
            }>;
          } = (await SpanService.executeQuery(sql)) as unknown as {
            json: () => Promise<{
              data: Array<{
                bucketStart: string;
                callCount: string;
                errorCount: string;
                avgDurationNano: string;
              }>;
            }>;
          };

          const parsed: {
            data: Array<{
              bucketStart: string;
              callCount: string;
              errorCount: string;
              avgDurationNano: string;
            }>;
          } = await resultSet.json();

          const buckets: Array<DependencyTimeseriesBucket> = parsed.data.map(
            (row: {
              bucketStart: string;
              callCount: string;
              errorCount: string;
              avgDurationNano: string;
            }): DependencyTimeseriesBucket => {
              const avgDurationMs: number =
                Number(row.avgDurationNano) / 1_000_000;
              return {
                bucketStart: row.bucketStart,
                callCount: Number(row.callCount) || 0,
                errorCount: Number(row.errorCount) || 0,
                avgDurationMs:
                  Number.isFinite(avgDurationMs) && avgDurationMs >= 0
                    ? Math.round(avgDurationMs * 100) / 100
                    : 0,
              };
            },
          );

          return Response.sendJsonObjectResponse(req, res, {
            bucketSeconds: bucketSeconds,
            callerServiceId: callerServiceId.toString(),
            calleeServiceId: calleeServiceId.toString(),
            truncated: isTruncated,
            buckets: buckets,
          } as unknown as JSONObject);
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
