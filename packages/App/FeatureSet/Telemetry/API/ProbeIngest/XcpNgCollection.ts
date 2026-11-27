import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { PROBE_COLLECTION_MIDDLEWARES } from "../../Middleware/ProbeCollectionRequest";
import ProbeSchedulingMiddleware from "../../Middleware/ProbeScheduling";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import { ProbeExpressRequest } from "../../Types/Request";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import XcpNgConnectionService from "Common/Server/Services/XcpNgConnectionService";
import XcpNgConnectionTestService from "Common/Server/Services/XcpNgConnectionTestService";
import XcpNgPoolService from "Common/Server/Services/XcpNgPoolService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import XcpNgProbeEvents, {
  XcpNgProbeEventsOutcome,
} from "Common/Server/Utils/XcpNg/XcpNgProbeEvents";
import { XcpNgCollectionReportOutcome } from "Common/Server/Utils/XcpNg/XcpNgProbeCollectionStore";
import XcpNgProbeMetrics, {
  XcpNgProbeMetricsPayload,
  readReportedPools,
} from "Common/Server/Utils/XcpNg/XcpNgProbeMetrics";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import XcpNgCollectionStatus from "Common/Types/XcpNg/XcpNgCollectionStatus";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import {
  XCP_NG_PROBE_COLLECTION_CONCURRENCY,
  XCP_NG_PROBE_TEST_BATCH_SIZE,
  XcpNgCollectionJob,
  XcpNgCollectionReport,
  XcpNgConnectionTestJob,
  XcpNgConnectionTestReport,
} from "Common/Types/XcpNg/XcpNgProbeCollection";

/*
 * The probe's side of reading XCP-ng connections (#10996, #10999; see
 * Types/XcpNg/XcpNgProbeCollection for the conversation) - a vCenter's
 * (ProbeIngest/VMwareCollection), route for route:
 *
 *   POST /probe/xcp-ng/work        the connections due for a read, and the
 *                                  connection tests waiting, for this probe
 *   POST /probe/xcp-ng/collection  what one read found - its status, and its
 *                                  metrics for the ingest
 *   POST /probe/xcp-ng/test        what one connection test found
 *
 * Every route takes the probe from the AUTHENTICATED request, never from the
 * body, and every read and write is keyed on it.
 *
 * A read's metrics go through the same ingest as the XCP-ng Agent's
 * (TelemetryQueueService, OtelMetricsIngestService) - only for the pools
 * this connection reads (XcpNgPoolService.assignPoolsToConnection), stamped
 * with the connection's name as the Xen Orchestra they were read from - so
 * every XCP-ng page, monitor, alert template and AI tool reads them as it
 * reads the agent's.
 */

const router: ExpressRouter = Express.getRouter();

// The most running reads a probe may name in one work request.
const MAX_RUNNING_IDS_PER_REQUEST: number = 100;

function readBody(req: ProbeExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

function getProbeId(req: ProbeExpressRequest): ObjectID | null {
  return req.probe?.id || null;
}

// The reads a probe says it is still running: ids only, bounded.
export function readRunningXcpNgConnectionIds(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((id: unknown): id is string => {
      return typeof id === "string" && ObjectID.isValidUUID(id.trim());
    })
    .map((id: string): string => {
      return id.trim();
    })
    .slice(0, MAX_RUNNING_IDS_PER_REQUEST);
}

// How many new reads a probe may start: the free slots it has.
export function getXcpNgCollectionClaimLimit(runningCount: number): number {
  return Math.max(0, XCP_NG_PROBE_COLLECTION_CONCURRENCY - runningCount);
}

router.post(
  "/probe/xcp-ng/work",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  /*
   * Under the probe scheduling limit (issue #8051); a refused request claims
   * nothing and is answered busy: the connections and tests stay due.
   */
  ProbeSchedulingMiddleware.limit(
    (req: ExpressRequest, res: ExpressResponse): void => {
      return Response.sendJsonObjectResponse(req, res, {
        collections: [],
        tests: [],
      });
    },
    { retriesWhenBusy: ProbeCapability.RetryAllWorkWhenBusy },
  ),
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const runningIds: Array<string> = readRunningXcpNgConnectionIds(
        readBody(req)["runningXcpNgConnectionIds"],
      );

      /*
       * With telemetry ingestion switched off on this instance, a read could
       * only be thrown away: none is handed out. Tests still run.
       */
      const collections: Array<XcpNgCollectionJob> =
        TelemetryIngestionDisabled.isDisabled()
          ? []
          : await XcpNgConnectionService.claimForCollection({
              probeId: probeId,
              runningXcpNgConnectionIds: runningIds,
              limit: getXcpNgCollectionClaimLimit(runningIds.length),
            });

      const tests: Array<XcpNgConnectionTestJob> =
        await XcpNgConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: XCP_NG_PROBE_TEST_BATCH_SIZE,
        });

      return Response.sendJsonObjectResponse(req, res, {
        collections: collections as unknown as Array<JSONObject>,
        tests: tests as unknown as Array<JSONObject>,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * A probe sends a read gzip-compressed: a large Xen Orchestra's metrics are
 * megabytes of JSON. Its key is checked before the report is parsed
 * (ProbeCollectionRequest).
 */
router.post(
  "/probe/xcp-ng/collection",
  ...PROBE_COLLECTION_MIDDLEWARES,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const report: XcpNgCollectionReport = readBody(
        req,
      ) as unknown as XcpNgCollectionReport;

      if (
        report.status !== XcpNgCollectionStatus.Succeeded &&
        report.status !== XcpNgCollectionStatus.Failed
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("A collection report is Succeeded or Failed."),
        );
      }

      const outcome: XcpNgCollectionReportOutcome =
        await XcpNgConnectionService.recordCollectionReport({
          probeId: probeId,
          report: report,
        });

      if (!outcome.accepted || !outcome.projectId) {
        return Response.sendJsonObjectResponse(req, res, {
          accepted: false,
          reason: outcome.reason || "The report was not accepted.",
        });
      }

      let queuedResourceCount: number = 0;
      let deliveredMessageCount: number = 0;

      if (
        report.status === XcpNgCollectionStatus.Succeeded &&
        !TelemetryIngestionDisabled.isDisabled()
      ) {
        const connectionId: ObjectID = new ObjectID(report.xcpNgConnectionId);
        const connectionType: XcpNgConnectionType =
          outcome.connectionType || XcpNgConnectionType.XenOrchestra;

        // The pools this connection reads now: made, taken over or kept.
        const assignment: {
          poolIdsToKeep: Set<string>;
          warnings: Array<string>;
        } = await XcpNgPoolService.assignPoolsToConnection({
          projectId: outcome.projectId,
          connection: {
            id: connectionId,
            name: outcome.connectionName || "",
            connectionType: connectionType,
          },
          pools: readReportedPools(report.resourceMetrics),
        });

        if (outcome.isCurrent && assignment.warnings.length > 0) {
          await XcpNgConnectionService.addCollectionWarnings({
            xcpNgConnectionId: connectionId,
            warnings: assignment.warnings,
          });
        }

        const payload: XcpNgProbeMetricsPayload = XcpNgProbeMetrics.prepare({
          resourceMetrics: report.resourceMetrics,
          xenOrchestraName:
            connectionType === XcpNgConnectionType.XenOrchestra
              ? outcome.connectionName
              : undefined,
          poolIdsToKeep: assignment.poolIdsToKeep,
        });

        if (payload.resourceCount > 0) {
          /*
           * One read is one ingest job, as one agent export is: the snapshot
           * scan reads a whole pool at a time.
           */
          await TelemetryQueueService.addMetricIngestJob({
            projectId: outcome.projectId,
            body: { resourceMetrics: payload.resourceMetrics },
            headers: {},
            productType: ProductType.Metrics,
          } as unknown as TelemetryRequest);

          queuedResourceCount = payload.resourceCount;
        }

        /*
         * What XAPI and Xen Orchestra said of the pools since the last read
         * (#10997): messages and alarms, HA and the master, backups and
         * missing patches - log records for the alert templates and the
         * pools' Logs pages, derived series for the XCP-ng monitor, lines
         * on the pools' feeds. Queued like the metrics, then committed.
         */
        const events: XcpNgProbeEventsOutcome = await XcpNgProbeEvents.ingest({
          projectId: outcome.projectId,
          connectionType: connectionType,
          connectionName: outcome.connectionName,
          report: report,
          poolIdsToKeep: assignment.poolIdsToKeep,
          queue: {
            queueLogs: async (data: {
              projectId: ObjectID;
              resourceLogs: Array<JSONObject>;
            }): Promise<void> => {
              await TelemetryQueueService.addLogIngestJob({
                projectId: data.projectId,
                body: { resourceLogs: data.resourceLogs },
                headers: {},
                productType: ProductType.Logs,
              } as unknown as TelemetryRequest);
            },
            queueMetrics: async (data: {
              projectId: ObjectID;
              resourceMetrics: Array<JSONObject>;
            }): Promise<void> => {
              await TelemetryQueueService.addMetricIngestJob({
                projectId: data.projectId,
                body: { resourceMetrics: data.resourceMetrics },
                headers: {},
                productType: ProductType.Metrics,
              } as unknown as TelemetryRequest);
            },
          },
        });
        deliveredMessageCount = events.recordCount;
      }

      logger.debug(
        `XCP-ng read of connection ${report.xcpNgConnectionId} by probe ${probeId.toString()}: ${report.status}, ${queuedResourceCount} resource(s) queued for ingest, ${deliveredMessageCount} message(s) delivered.`,
      );

      return Response.sendJsonObjectResponse(req, res, {
        accepted: true,
        isCurrent: Boolean(outcome.isCurrent),
        queuedResourceCount: queuedResourceCount,
        deliveredMessageCount: deliveredMessageCount,
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/probe/xcp-ng/test",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const report: XcpNgConnectionTestReport = readBody(
        req,
      ) as unknown as XcpNgConnectionTestReport;

      if (
        report.status !== XcpNgCollectionStatus.Succeeded &&
        report.status !== XcpNgCollectionStatus.Failed
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("A test report is Succeeded or Failed."),
        );
      }

      const accepted: boolean =
        await XcpNgConnectionTestService.recordTestReport({
          probeId: probeId,
          report: report,
        });

      return Response.sendJsonObjectResponse(req, res, {
        accepted: accepted,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
