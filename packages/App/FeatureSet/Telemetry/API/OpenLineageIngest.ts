import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import BadDataException from "Common/Types/Exception/BadDataException";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import {
  OpenLineageRunEvent,
  readOpenLineageEvents,
} from "Common/Server/Utils/DataObservability/OpenLineageEvent";
import OpenLineageIngest from "Common/Server/Utils/DataObservability/OpenLineageIngest";

const router: ExpressRouter = Express.getRouter();

/*
 * OpenLineage clients send their API key as "Authorization: Bearer <key>"
 * (transport.auth.type: api_key). An ingestion key is read from
 * x-oneuptime-token, so the bearer key is handed on there when that header
 * is not set.
 */
export const readBearerIngestionKey: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  const authorization: unknown = req.headers["authorization"];

  if (
    !req.headers["x-oneuptime-token"] &&
    typeof authorization === "string" &&
    authorization.toLowerCase().startsWith("bearer ")
  ) {
    req.headers["x-oneuptime-token"] = authorization.slice(7).trim();
  }

  next();
};

const setOpenLineageProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  // Run events are an annotation stream, like change events: Logs' bookkeeping.
  (req as TelemetryRequest).productType = ProductType.Logs;
  next();
};

/*
 * OPENLINEAGE RUN EVENTS: DATA OBSERVABILITY'S PIPELINES AND LINEAGE.
 *
 * Airflow, Dagster, Spark, dbt and Flink send them unchanged, with a
 * telemetry ingestion key. Each event updates its pipeline and run, and the
 * tables a run reads and writes become lineage (OpenLineageIngest). The
 * answer is synchronous, so a producer knows its events were taken. The
 * path is OpenLineage's own default endpoint (api/v1/lineage), under
 * OneUptime's /openlineage: a producer names only the base URL.
 */
router.post(
  "/openlineage/api/v1/lineage",
  TelemetryIngestionDisabled.middleware,
  readBearerIngestionKey,
  setOpenLineageProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.OpenLineage),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const projectId: ObjectID | undefined = (req as TelemetryRequest)
        .projectId;

      if (!projectId) {
        throw new BadDataException(
          "Invalid request - projectId not found in request.",
        );
      }

      const now: Date = OneUptimeDate.getCurrentDate();
      const events: Array<OpenLineageRunEvent> = readOpenLineageEvents(
        req.body,
        now,
      );

      if (events.length === 0) {
        throw new BadDataException(
          "The request holds no OpenLineage event with a job namespace and name.",
        );
      }

      const accepted: number = await OpenLineageIngest.ingest({
        projectId,
        events,
        now,
      });

      return Response.sendJsonObjectResponse(req, res, { accepted });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
