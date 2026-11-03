import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import BadDataException from "Common/Types/Exception/BadDataException";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
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
  DbtManifest,
  DbtRunResults,
  readDbtManifest,
  readDbtRunResults,
} from "Common/Server/Utils/DataObservability/DbtArtifacts";
import DbtIngest, {
  DbtIngestSummary,
} from "Common/Server/Utils/DataObservability/DbtIngest";
import { readBearerIngestionKey } from "./OpenLineageIngest";

const router: ExpressRouter = Express.getRouter();

const setDbtProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  // Artifacts annotate tables and pipelines, like OpenLineage events: Logs' bookkeeping.
  (req as TelemetryRequest).productType = ProductType.Logs;
  next();
};

/*
 * DBT ARTIFACTS: A PROJECT'S MODELS, LINEAGE AND TESTS.
 *
 * Sent after a dbt build by CI or the CLI (oneuptime dbt upload), with a
 * telemetry ingestion key: { manifest, run_results, project }, either file
 * alone, as dbt writes them to target/ - the CLI trims a manifest to what is
 * read first. The models and sources that are watched tables record what
 * dbt says of them, their dependencies become lineage, the tests become
 * checks with their results, and the invocation a run of the project's
 * pipeline (DbtIngest). The answer says what was matched, so a CI log shows
 * at once when nothing was.
 */
router.post(
  "/dbt/v1/artifacts",
  TelemetryIngestionDisabled.middleware,
  readBearerIngestionKey,
  setDbtProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.DbtArtifacts),
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

      const body: JSONObject =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as JSONObject)
          : {};
      const now: Date = OneUptimeDate.getCurrentDate();
      const manifest: DbtManifest | null = readDbtManifest(body["manifest"]);
      const runResults: DbtRunResults | null = readDbtRunResults(
        body["run_results"] ?? body["runResults"],
        now,
      );

      if (!manifest && !runResults) {
        throw new BadDataException(
          "Send dbt's manifest.json as manifest, its run_results.json as run_results, or both.",
        );
      }

      const summary: DbtIngestSummary = await DbtIngest.ingest({
        projectId,
        manifest,
        runResults,
        projectName:
          typeof body["project"] === "string"
            ? body["project"].trim().slice(0, 200) || null
            : null,
        now,
      });

      return Response.sendJsonObjectResponse(
        req,
        res,
        summary as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
