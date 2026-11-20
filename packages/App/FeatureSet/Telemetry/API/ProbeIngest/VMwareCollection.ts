import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import ProbeSchedulingMiddleware from "../../Middleware/ProbeScheduling";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import { ProbeExpressRequest } from "../../Types/Request";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import VMwareVCenterConnectionTestService from "Common/Server/Services/VMwareVCenterConnectionTestService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import RequestBodyJson from "Common/Server/Utils/RequestBodyJson";
import { VMwareCollectionReportOutcome } from "Common/Server/Utils/VMware/VMwareProbeCollectionStore";
import VMwareProbeMetrics, {
  VMwareProbeMetricsPayload,
} from "Common/Server/Utils/VMware/VMwareProbeMetrics";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import VMwareCollectionStatus from "Common/Types/VMware/VMwareCollectionStatus";
import {
  VMWARE_PROBE_COLLECTION_CONCURRENCY,
  VMWARE_PROBE_TEST_BATCH_SIZE,
  VMwareCollectionJob,
  VMwareCollectionReport,
  VMwareConnectionTestJob,
  VMwareConnectionTestReport,
} from "Common/Types/VMware/VMwareProbeCollection";

/*
 * The probe's side of collecting vCenters (see Types/VMware/
 * VMwareProbeCollection for the conversation):
 *
 *   POST /probe/vmware/work        the vCenters due for a collection, and the
 *                                  connection tests waiting, for this probe
 *   POST /probe/vmware/collection  what one collection found - its status,
 *                                  and its metrics for the ingest
 *   POST /probe/vmware/test        what one connection test found
 *
 * Every route takes the probe from the AUTHENTICATED request, never from the
 * body, and every read and write is keyed on it: a probe is only handed the
 * vCenters and tests that name it, and only heard about those.
 *
 * A collection's metrics go through the same ingest as the VMware agent's
 * (TelemetryQueueService, OtelMetricsIngestService), stamped with the
 * vCenter's name by the server, so every VMware page, monitor, alert template
 * and AI tool reads them as it reads the agent's - and the ingest's own rules
 * (OneUptime's receiving gaps, retention, usage) apply to them unchanged.
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
export function readRunningVMwareVCenterIds(value: unknown): Array<string> {
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
 * A probe sends a collection gzip-compressed: its metrics are several
 * megabytes of JSON for a large vCenter, and compress tenfold. The server's
 * gzip body reader (GzipRequestBody - bounded, 50 MiB inflated) leaves the
 * inflated bytes in req.body; this reads them as the JSON they are, before
 * the probe is authenticated from them. A plain JSON body passes untouched.
 * The bytes are counted first (RequestBodyJson), whatever their Content-Type
 * said, so a body with more values than the route reads is refused with 413
 * before it is parsed.
 */
export function parseInflatedJsonBody(
  req: ProbeExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void {
  const body: unknown = req.body;

  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    try {
      req.body = RequestBodyJson.parse(body, RequestBodyJson.getLimit(req));
    } catch (err) {
      if (RequestBodyJson.isTooManyValuesError(err)) {
        return next(err);
      }

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
 * How many new collections a probe may start: the free slots of the most a
 * probe collects at once.
 */
export function getCollectionClaimLimit(runningCount: number): number {
  return Math.max(0, VMWARE_PROBE_COLLECTION_CONCURRENCY - runningCount);
}

router.post(
  "/probe/vmware/work",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  /*
   * Under the probe scheduling limit (issue #8051); a refused request claims
   * nothing and is answered busy (ProbeSchedulingMiddleware): the vCenters
   * and tests stay due for the probe's next tick. The collections it is
   * running carry on; their reports are not held to the limit.
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

      const runningIds: Array<string> = readRunningVMwareVCenterIds(
        readBody(req)["runningVMwareVCenterIds"],
      );

      /*
       * With telemetry ingestion switched off on this instance, a collection
       * could only be thrown away: none is handed out. Tests still run - they
       * ingest nothing.
       */
      const collections: Array<VMwareCollectionJob> =
        TelemetryIngestionDisabled.isDisabled()
          ? []
          : await VMwareVCenterService.claimForCollection({
              probeId: probeId,
              runningVMwareVCenterIds: runningIds,
              limit: getCollectionClaimLimit(runningIds.length),
            });

      const tests: Array<VMwareConnectionTestJob> =
        await VMwareVCenterConnectionTestService.claimPendingTests({
          probeId: probeId,
          limit: VMWARE_PROBE_TEST_BATCH_SIZE,
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
  "/probe/vmware/collection",
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

      const body: JSONObject = readBody(req);
      const report: VMwareCollectionReport =
        body as unknown as VMwareCollectionReport;

      if (
        report.status !== VMwareCollectionStatus.Succeeded &&
        report.status !== VMwareCollectionStatus.Failed
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("A collection report is Succeeded or Failed."),
        );
      }

      const outcome: VMwareCollectionReportOutcome =
        await VMwareVCenterService.recordCollectionReport({
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
        report.status === VMwareCollectionStatus.Succeeded &&
        !TelemetryIngestionDisabled.isDisabled()
      ) {
        const payload: VMwareProbeMetricsPayload = VMwareProbeMetrics.prepare({
          resourceMetrics: report.resourceMetrics,
          vcenterName: outcome.vcenterName || "",
        });

        if (payload.resourceCount > 0) {
          /*
           * One collection is one ingest job, as one agent export is: the
           * snapshot scan reads a whole collection at a time (inventory
           * counts, powered-on inference).
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
        `VMware collection of vCenter ${report.vmwareVCenterId} by probe ${probeId.toString()}: ${report.status}, ${queuedResourceCount} resource(s) queued for ingest.`,
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
  "/probe/vmware/test",
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

      const report: VMwareConnectionTestReport = readBody(
        req,
      ) as unknown as VMwareConnectionTestReport;

      if (
        report.status !== VMwareCollectionStatus.Succeeded &&
        report.status !== VMwareCollectionStatus.Failed
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("A test report is Succeeded or Failed."),
        );
      }

      const accepted: boolean =
        await VMwareVCenterConnectionTestService.recordTestReport({
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
