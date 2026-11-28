import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { PROBE_COLLECTION_MIDDLEWARES } from "../../Middleware/ProbeCollectionRequest";
import ProbeSchedulingMiddleware from "../../Middleware/ProbeScheduling";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import { ProbeExpressRequest } from "../../Types/Request";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import StorageArrayConnectionService from "Common/Server/Services/StorageArrayConnectionService";
import StorageArrayConnectionTestService from "Common/Server/Services/StorageArrayConnectionTestService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import { StorageArrayCollectionReportOutcome } from "Common/Server/Utils/StorageArray/StorageArrayProbeCollectionStore";
import StorageArrayProbeMetrics, {
  StorageArrayProbeMetricsPayload,
} from "Common/Server/Utils/StorageArray/StorageArrayProbeMetrics";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import { StorageArrayCollectionStatusUtil } from "Common/Types/StorageArray/Collection/StorageArrayCollectionStatus";
import {
  STORAGE_ARRAY_PROBE_COLLECTION_CONCURRENCY,
  STORAGE_ARRAY_PROBE_TEST_BATCH_SIZE,
  StorageArrayCollectionJob,
  StorageArrayCollectionReport,
  StorageArrayConnectionTestJob,
  StorageArrayConnectionTestReport,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import { StorageArrayProbeCollector } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollector";
import StorageArrayProbeCollectors from "Common/Types/StorageArray/Collection/StorageArrayProbeCollectors";

/*
 * The probe's side of collecting storage arrays from their management
 * server (#11004; Types/StorageArray/Collection/StorageArrayProbeCollection
 * has the conversation), the shape of VMware's (ProbeIngest/VMwareCollection):
 *
 *   POST /probe/storage-array/work        the connections due for a
 *                                         collection, and the connection
 *                                         tests waiting, for this probe
 *   POST /probe/storage-array/collection  what one collection found - its
 *                                         status, and its metrics
 *   POST /probe/storage-array/test        what one connection test found
 *
 * Every route takes the probe from the AUTHENTICATED request, never from
 * the body, and every read and write is keyed on it: a probe is only handed
 * the connections and tests that name it, and only heard about those.
 *
 * A collection's metrics go through the same ingest as the Storage Array
 * Agent's (TelemetryQueueService, OtelMetricsIngestService), each array's
 * resource stamped by the server with its platform and its name in
 * OneUptime (StorageArrayProbeMetrics), so every Storage Arrays page,
 * monitor and alert template reads them as it reads the agent's.
 */

const router: ExpressRouter = Express.getRouter();

// The most running collections a probe may name in one work request.
const MAX_RUNNING_IDS_PER_REQUEST: number = 100;

function readBody(req: ProbeExpressRequest): JSONObject {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as JSONObject)
    : {};
}

function getProbeId(req: ProbeExpressRequest): ObjectID | null {
  return req.probe?.id || null;
}

// The collections a probe says it is still running: ids only, bounded.
export function readRunningStorageArrayConnectionIds(
  value: unknown,
): Array<string> {
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

// How many new collections a probe may start: its free slots.
export function getStorageArrayCollectionClaimLimit(
  runningCount: number,
): number {
  return Math.max(0, STORAGE_ARRAY_PROBE_COLLECTION_CONCURRENCY - runningCount);
}

/*
 * A succeeded collection's metrics, stamped and queued for the ingest:
 * one ingest job per collection, as one agent export is. Returns how many
 * array resources were queued.
 */
export async function queueStorageArrayCollectionMetrics(data: {
  projectId: ObjectID;
  storageSystem: string | undefined;
  report: StorageArrayCollectionReport;
}): Promise<number> {
  const collector: StorageArrayProbeCollector | null =
    StorageArrayProbeCollectors.getCollector(data.storageSystem);

  if (!collector) {
    return 0;
  }

  const identifiers: Array<string> = StorageArrayProbeMetrics.getArrayIdentifiers(
    {
      resourceMetrics: data.report.resourceMetrics,
      collector: collector,
    },
  );

  const namesByIdentifier: Map<string, string> =
    await StorageArrayConnectionService.getArrayNamesBySystemId({
      projectId: data.projectId,
      storageSystem: collector.storageSystem,
      systemIds: identifiers,
    });

  const payload: StorageArrayProbeMetricsPayload =
    StorageArrayProbeMetrics.prepare({
      resourceMetrics: data.report.resourceMetrics,
      collector: collector,
      namesByIdentifier: namesByIdentifier,
    });

  if (payload.resourceCount === 0) {
    return 0;
  }

  await TelemetryQueueService.addMetricIngestJob({
    projectId: data.projectId,
    body: { resourceMetrics: payload.resourceMetrics },
    headers: {},
    productType: ProductType.Metrics,
  } as unknown as TelemetryRequest);

  return payload.resourceCount;
}

router.post(
  "/probe/storage-array/work",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  /*
   * Under the probe scheduling limit (issue #8051): a refused request
   * claims nothing and is answered busy, and the connections and tests
   * stay due for the probe's next tick.
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

      const runningIds: Array<string> = readRunningStorageArrayConnectionIds(
        readBody(req)["runningStorageArrayConnectionIds"],
      );

      /*
       * With telemetry ingestion switched off on this instance, a
       * collection could only be thrown away: none is handed out. Tests
       * still run - they ingest nothing.
       */
      const collections: Array<StorageArrayCollectionJob> =
        TelemetryIngestionDisabled.isDisabled()
          ? []
          : await StorageArrayConnectionService.claimForCollection({
              probeId: probeId,
              runningStorageArrayConnectionIds: runningIds,
              limit: getStorageArrayCollectionClaimLimit(runningIds.length),
            });

      const tests: Array<StorageArrayConnectionTestJob> =
        await StorageArrayConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: STORAGE_ARRAY_PROBE_TEST_BATCH_SIZE,
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
 * A probe sends a collection gzip-compressed: its metrics are megabytes of
 * JSON for a Unisphere of many arrays. Its key is checked before the
 * report is parsed (ProbeCollectionRequest).
 */
router.post(
  "/probe/storage-array/collection",
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

      const report: StorageArrayCollectionReport = readBody(
        req,
      ) as unknown as StorageArrayCollectionReport;

      if (!StorageArrayCollectionStatusUtil.isReportable(report.status)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("A collection report is Succeeded or Failed."),
        );
      }

      const outcome: StorageArrayCollectionReportOutcome =
        await StorageArrayConnectionService.recordCollectionReport({
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

      if (
        report.status === "Succeeded" &&
        !TelemetryIngestionDisabled.isDisabled()
      ) {
        queuedResourceCount = await queueStorageArrayCollectionMetrics({
          projectId: outcome.projectId,
          storageSystem: outcome.storageSystem,
          report: report,
        });
      }

      logger.debug(
        `Storage array collection of connection ${report.storageArrayConnectionId} by probe ${probeId.toString()}: ${report.status}, ${queuedResourceCount} array(s) queued for ingest.`,
      );

      return Response.sendJsonObjectResponse(req, res, {
        accepted: true,
        isCurrent: Boolean(outcome.isCurrent),
        queuedResourceCount: queuedResourceCount,
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/probe/storage-array/test",
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

      const report: StorageArrayConnectionTestReport = readBody(
        req,
      ) as unknown as StorageArrayConnectionTestReport;

      if (!StorageArrayCollectionStatusUtil.isReportable(report.status)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("A test report is Succeeded or Failed."),
        );
      }

      const accepted: boolean =
        await StorageArrayConnectionTestService.recordTestReport({
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
