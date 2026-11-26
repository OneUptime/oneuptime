import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import BadDataException from "Common/Types/Exception/BadDataException";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import SyncWebhookIngest, {
  FIVETRAN_SIGNATURE_HEADER,
  isSignedByFivetran,
} from "Common/Server/Utils/DataObservability/SyncWebhooks";
import RequestBodyAfterAuthentication from "Common/Server/Middleware/RequestBodyAfterAuthentication";
import { LARGE_REQUEST_BODY_LIMIT } from "Common/Server/Utils/RequestBodyLimit";

const router: ExpressRouter = Express.getRouter();

/*
 * FIVETRAN AND AIRBYTE SYNC WEBHOOKS: DATA OBSERVABILITY'S PIPELINES.
 *
 * Neither tool can send a header of its own, so the key comes with the URL:
 *
 *  - Fivetran signs each delivery with the webhook's secret. Its URL names
 *    an ingestion key by its id, and the webhook's secret is that key, so
 *    the key itself never travels: a delivery is taken only when it is
 *    signed with it.
 *  - Airbyte signs nothing, so its URL carries the ingestion key itself,
 *    as an incoming request monitor's URL carries its secret. Give Airbyte
 *    a key of its own.
 *
 * Either way the key is then checked like any other (enabled, unexpired,
 * a server key, within its rate) and each sync becomes a pipeline run
 * (SyncWebhookIngest). The answer is synchronous, so the tool knows the
 * delivery was taken, and an event that is no sync is taken too, so a tool
 * never retries it.
 *
 * Neither body is read before its key is known (#10702): StartServer
 * leaves them unread (RequestBodyLimit). Airbyte's is read once the key in
 * its URL is right. Fivetran's key proves itself only by the body's
 * signature, so its body is read - JSON, held to 50 MB - once the key its
 * URL names is found and the delivery carries a signature: a delivery that
 * names no key, or carries none, is refused unread, as it would have been
 * refused once read.
 */

// A delivery's JSON, as StartServer read it before routing.
const readSyncBody: RequestHandler = RequestBodyAfterAuthentication.readBody(
  LARGE_REQUEST_BODY_LIMIT,
  { parseGzipJson: true },
);

// Fivetran's: its signature is over the bytes as sent.
const readFivetranBody: RequestHandler =
  RequestBodyAfterAuthentication.readBody(LARGE_REQUEST_BODY_LIMIT);

const setSyncProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  // Syncs are run events, an annotation stream, like OpenLineage's: Logs' bookkeeping.
  (req as TelemetryRequest).productType = ProductType.Logs;
  next();
};

/*
 * A Fivetran delivery is taken when it is signed with the ingestion key its
 * URL names. An unknown key and a wrong signature are refused alike, so
 * the URL tells nothing of which keys exist; 403, not 401, so Fivetran
 * shows the webhook as failing rather than retrying a delivery that will
 * never be taken. The body is read only to check the signature over it, of
 * a delivery that names a key and carries a signature (see above).
 */
const verifyFivetranDelivery: RequestHandler = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  const refuse: () => void = (): void => {
    logger.warn(
      "Refused a Fivetran webhook delivery: it is not signed with the ingestion key its URL names.",
      getLogAttributesFromRequest(req as RequestLike),
    );
    res.status(403).json({
      message:
        "This delivery is not signed with the ingestion key the URL names. Set the Fivetran webhook's secret to the ingestion key whose ID is in the URL.",
    });
  };

  try {
    const keyId: string = String(req.params["ingestionKeyId"] || "");
    const key: TelemetryIngestionKey | null = ObjectID.isValidUUID(keyId)
      ? await TelemetryIngestionKeyService.findOneById({
          id: new ObjectID(keyId),
          select: { secretKey: true },
          props: { isRoot: true },
        })
      : null;
    const secret: string = key?.secretKey?.toString() || "";

    if (!secret || !req.headers[FIVETRAN_SIGNATURE_HEADER]) {
      return refuse();
    }

    readFivetranBody(req, res, ((err?: unknown): void => {
      if (err) {
        return next(err);
      }

      if (
        !isSignedByFivetran({
          rawBody: (req as OneUptimeRequest).rawBody || "",
          signature: req.headers[FIVETRAN_SIGNATURE_HEADER],
          secret,
        })
      ) {
        return refuse();
      }

      req.headers["x-oneuptime-token"] = secret;
      next();
    }) as NextFunction);
  } catch (err) {
    next(err);
  }
};

// Airbyte's URL carries the key itself.
const readPathIngestionKey: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  const key: string = String(req.params["ingestionKey"] || "").trim();

  if (key && !req.headers["x-oneuptime-token"]) {
    req.headers["x-oneuptime-token"] = key;
  }

  next();
};

function readProjectId(req: ExpressRequest): ObjectID {
  const projectId: ObjectID | undefined = (req as TelemetryRequest).projectId;

  if (!projectId) {
    throw new BadDataException(
      "Invalid request - projectId not found in request.",
    );
  }

  return projectId;
}

router.post(
  "/fivetran/v1/webhook/:ingestionKeyId",
  TelemetryIngestionDisabled.middleware,
  verifyFivetranDelivery,
  setSyncProductType,
  // Read already, by its signature's check: passed over.
  TelemetryIngest.forSurface(TelemetryIngestSurface.SyncWebhooks, readSyncBody),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const accepted: number = await SyncWebhookIngest.ingestFivetran({
        projectId: readProjectId(req),
        body: req.body,
        now: OneUptimeDate.getCurrentDate(),
      });

      return Response.sendJsonObjectResponse(req, res, { accepted });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/airbyte/v1/webhook/:ingestionKey",
  TelemetryIngestionDisabled.middleware,
  readPathIngestionKey,
  setSyncProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.SyncWebhooks, readSyncBody),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const accepted: number = await SyncWebhookIngest.ingestAirbyte({
        projectId: readProjectId(req),
        body: req.body,
        now: OneUptimeDate.getCurrentDate(),
      });

      return Response.sendJsonObjectResponse(req, res, { accepted });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
