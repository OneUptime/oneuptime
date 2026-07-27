import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONObject } from "Common/Types/JSON";
import { MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST } from "Common/Types/Kubernetes/KubernetesCostIngest";
import TelemetryQueueService from "../Services/Queue/TelemetryQueueService";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

/*
 * Cost-allocation ingest for the Kubernetes agent's cost poller. The body
 * is a KubernetesCostIngestPayload (see
 * Common/Types/Kubernetes/KubernetesCostIngest.ts) — pre-priced allocation
 * rows read from an in-cluster OpenCost / Kubecost Allocation API.
 *
 * Auth mirrors the OTLP endpoints: a telemetry ingestion key in
 * x-oneuptime-token. Validation here is shape-only and synchronous; the
 * row-level work (cluster resolution, retention, ClickHouse insert) runs
 * in the telemetry worker via the queue, so the 200 answers fast.
 */
router.post(
  "/kubernetes-cost/ingest",
  TelemetryIngestionDisabled.middleware,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body: JSONObject = req.body as JSONObject;

      if (!body || typeof body !== "object") {
        throw new BadRequestException("Request body must be a JSON object.");
      }

      const clusterName: unknown = body["clusterName"];
      if (
        !clusterName ||
        typeof clusterName !== "string" ||
        !clusterName.trim()
      ) {
        throw new BadRequestException(
          "clusterName is required and must be a non-empty string.",
        );
      }

      const allocations: unknown = body["allocations"];
      if (!Array.isArray(allocations)) {
        throw new BadRequestException("allocations must be an array.");
      }

      if (allocations.length > MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST) {
        throw new BadRequestException(
          `allocations must contain at most ${MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST} rows per request. Chunk the payload.`,
        );
      }

      if (allocations.length === 0) {
        // Nothing to do — still a success so the poller's empty windows are cheap.
        return Response.sendEmptySuccessResponse(req, res);
      }

      await TelemetryQueueService.addKubernetesCostIngestJob({
        projectId: (req as TelemetryRequest).projectId,
        costPayload: body,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      logger.error("Error in /kubernetes-cost/ingest:");
      logger.error(err);
      return next(err);
    }
  },
);

export default router;
