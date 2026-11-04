import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import { ProbeExpressRequest } from "../../Types/Request";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import OpenStackCloudConnectionTestService from "Common/Server/Services/OpenStackCloudConnectionTestService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import { OpenStackCollectionReportOutcome } from "Common/Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import OpenStackProbeMetrics, {
  OpenStackProbeMetricsPayload,
} from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackCollectionStatusUtil } from "Common/Types/OpenStack/OpenStackCollectionStatus";
import {
  OPENSTACK_PROBE_COLLECTION_CONCURRENCY,
  OPENSTACK_PROBE_TEST_BATCH_SIZE,
  OpenStackCollectionJob,
  OpenStackCollectionReport,
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
} from "Common/Types/OpenStack/OpenStackProbeCollection";

/*
 * The probe's side of collecting clouds (see Types/OpenStack/OpenStackProbeCollection for
 * the conversation):
 *
 *   POST /probe/openstack/work        the clouds due for a collection, and the
 *                                     connection tests waiting, for this probe
 *   POST /probe/openstack/collection  what one collection found: its status, and its
 *                                     metrics for the ingest
 *   POST /probe/openstack/test        what one connection test found
 *
 * Every route takes the probe from the AUTHENTICATED request, never from the body, and
 * every read and write is keyed on it: a probe is only handed the clouds and tests that
 * name it, and only heard about those.
 *
 * A collection's metrics go through the same ingest as the agent's
 * (TelemetryQueueService, OtelMetricsIngestService), stamped with the cloud's name by the
 * server, so every OpenStack page, monitor, alert template and AI tool reads them as it
 * reads the agent's, and the ingest's own rules (receiving gaps, retention, usage) apply
 * to them unchanged.
 */

/*
 * What these routes need of the database, in the words of the conversation. The real one
 * is OpenStackCloudService and OpenStackCloudConnectionTestService, over
 * OpenStackProbeCollectionStore and OpenStackConnectionTestStore.
 */
export interface OpenStackProbeWorkStore {
  claimForCollection: (data: {
    probeId: ObjectID;
    runningOpenStackCloudIds: Array<string>;
    limit: number;
  }) => Promise<Array<OpenStackCollectionJob>>;
  recordCollectionReport: (data: {
    probeId: ObjectID;
    report: OpenStackCollectionReport;
  }) => Promise<OpenStackCollectionReportOutcome>;
  claimPendingTests: (data: {
    probeId: ObjectID;
    limit: number;
  }) => Promise<Array<OpenStackConnectionTestJob>>;
  recordTestReport: (data: {
    probeId: ObjectID;
    report: OpenStackConnectionTestReport;
  }) => Promise<boolean>;
}

export const OPENSTACK_PROBE_WORK_STORE: OpenStackProbeWorkStore = {
  claimForCollection: async (data: {
    probeId: ObjectID;
    runningOpenStackCloudIds: Array<string>;
    limit: number;
  }): Promise<Array<OpenStackCollectionJob>> => {
    return await OpenStackCloudService.claimForCollection(data);
  },
  recordCollectionReport: async (data: {
    probeId: ObjectID;
    report: OpenStackCollectionReport;
  }): Promise<OpenStackCollectionReportOutcome> => {
    return await OpenStackCloudService.recordCollectionReport(data);
  },
  claimPendingTests: async (data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<OpenStackConnectionTestJob>> => {
    return await OpenStackCloudConnectionTestService.claimPendingTests(data);
  },
  recordTestReport: async (data: {
    probeId: ObjectID;
    report: OpenStackConnectionTestReport;
  }): Promise<boolean> => {
    return await OpenStackCloudConnectionTestService.recordTestReport(data);
  },
};

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
export function readRunningOpenStackCloudIds(value: unknown): Array<string> {
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

/*
 * A probe sends a collection gzip-compressed: its metrics are several megabytes of JSON
 * for a large cloud, and compress tenfold. The server's gzip body reader
 * (GzipRequestBody - bounded, 50 MiB inflated) leaves the inflated bytes in req.body; this
 * reads them as the JSON they are, before the probe is authenticated from them. A plain
 * JSON body passes untouched.
 */
export function parseInflatedJsonBody(
  req: ProbeExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void {
  const body: unknown = req.body;

  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    try {
      req.body = JSON.parse(Buffer.from(body).toString("utf8"));
    } catch {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("The collection report is not JSON."),
      );
    }
  }

  return next();
}

/*
 * How many new collections a probe may start: the free slots of the most a probe
 * collects at once.
 */
export function getCollectionClaimLimit(runningCount: number): number {
  return Math.max(0, OPENSTACK_PROBE_COLLECTION_CONCURRENCY - runningCount);
}

export function createOpenStackCollectionRouter(
  store: OpenStackProbeWorkStore,
): ExpressRouter {
  const router: ExpressRouter = Express.getRouter();

  router.post(
    "/probe/openstack/work",
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

        const runningIds: Array<string> = readRunningOpenStackCloudIds(
          readBody(req)["runningOpenStackCloudIds"],
        );

        /*
         * With telemetry ingestion switched off on this instance, a collection could only
         * be thrown away, so none is handed out. Tests still run: they ingest nothing.
         */
        const collections: Array<OpenStackCollectionJob> =
          TelemetryIngestionDisabled.isDisabled()
            ? []
            : await store.claimForCollection({
                probeId: probeId,
                runningOpenStackCloudIds: runningIds,
                limit: getCollectionClaimLimit(runningIds.length),
              });

        const tests: Array<OpenStackConnectionTestJob> =
          await store.claimPendingTests({
            probeId: probeId,
            limit: OPENSTACK_PROBE_TEST_BATCH_SIZE,
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

  router.post(
    "/probe/openstack/collection",
    parseInflatedJsonBody,
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

        const report: OpenStackCollectionReport = readBody(
          req,
        ) as unknown as OpenStackCollectionReport;

        if (!OpenStackCollectionStatusUtil.isReportable(report.status)) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              "A collection report is Succeeded, PartiallySucceeded or Failed.",
            ),
          );
        }

        const outcome: OpenStackCollectionReportOutcome =
          await store.recordCollectionReport({
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

        /*
         * A failed collection has metrics too, unlike a vCenter's. A service reading down
         * is exactly what a monitor is waiting to hear, and what keeps an alert's anchor
         * series there so it can recover.
         */
        if (!TelemetryIngestionDisabled.isDisabled()) {
          const payload: OpenStackProbeMetricsPayload =
            OpenStackProbeMetrics.prepare({
              resourceMetrics: report.resourceMetrics,
              cloudName: outcome.cloudName || "",
            });

          if (payload.resourceCount > 0) {
            /*
             * One collection is one ingest job, so the snapshot scan reads a whole
             * collection at a time and each hypervisor finds its nova-compute in it.
             */
            await TelemetryQueueService.addMetricIngestJob({
              projectId: outcome.projectId,
              body: { resourceMetrics: payload.resourceMetrics },
              headers: {},
              productType: ProductType.Metrics,
            } as unknown as TelemetryRequest);

            queuedResourceCount = payload.resourceCount;
          }
        }

        logger.debug(
          `OpenStack collection of cloud ${report.openStackCloudId} by probe ${probeId.toString()}: ${report.status}, ${queuedResourceCount} resource(s) queued for ingest.`,
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
    "/probe/openstack/test",
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

        const report: OpenStackConnectionTestReport = readBody(
          req,
        ) as unknown as OpenStackConnectionTestReport;

        if (report.status !== "Succeeded" && report.status !== "Failed") {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("A test report is Succeeded or Failed."),
          );
        }

        const accepted: boolean = await store.recordTestReport({
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

  return router;
}

export default createOpenStackCollectionRouter(OPENSTACK_PROBE_WORK_STORE);
