import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import StatusCode from "Common/Types/API/StatusCode";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import OriginAllowList from "Common/Utils/Telemetry/OriginAllowList";
import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
  SessionReplayRecorderKind,
  parseSessionReplayRecorderKindHeader,
} from "Common/Types/Rum/SessionReplay";
import {
  PRODUCT_ANALYTICS_EVENTS_ROUTE,
  PRODUCT_ANALYTICS_MAX_BATCH_BYTES,
  ProductAnalyticsBatchParseResult,
  parseProductAnalyticsBatch,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import { SESSION_REPLAY_TRUSTED_GEO_HEADER } from "../Config";
import SessionReplayRequestMiddleware from "../Middleware/SessionReplayRequestMiddleware";
import ProductAnalyticsEventIngestService, {
  ProductAnalyticsGateDecision,
  ProductAnalyticsGateOutcome,
} from "../Services/ProductAnalyticsEventIngestService";
import TelemetryQueueService from "../Services/Queue/TelemetryQueueService";

/*
 * POST /session-replay/v1/events (and /telemetry/...): a RUM recorder's
 * product analytics batch (issue #6444, part two) - the session's start,
 * its page views, its track() events and its metric() points - sent from
 * every session the application's replay policy lets the recorder run in,
 * recorded or not.
 *
 * The same door as a replay chunk: the ingestion key and its origin rules
 * (TelemetryIngest, Session Replay surface), the replay body reader's cap,
 * the application identifier header, and the mobile app identifier for a
 * native recorder. Then the batch's own gate
 * (ProductAnalyticsEventIngestService.gateBatch), the batch id claimed for
 * the day, and the job queued BEFORE the answer, so a recorder that is
 * told 202 knows its batch will be filed.
 *
 * Answers, and what the recorder does with each:
 *
 *   202 - queued (or a resend of a batch already queued). Next batch.
 *   204 - not filed and not to be sent again from this page: product
 *         analytics is off, replay is off, the instance does not offer it.
 *         x-oneuptime-replay-reason says which.
 *   400 - a batch this recorder build will always get wrong. It stops.
 *   403 - an origin the application does not allow. It stops.
 *   409 - consent not given yet; nothing filed. It holds its events.
 *   413 - a batch over PRODUCT_ANALYTICS_MAX_BATCH_BYTES. Dropped.
 *   429 - over the project's per-minute allowance; Retry-After. It waits.
 *   503 - a counter, a policy or the queue could not be reached. Retried.
 */

const router: ExpressRouter = Express.getRouter();

const TWO_LETTER_COUNTRY_CODE: RegExp = new RegExp("^[A-Z]{2}$");

/* The trusted proxy's country header, as the replay route reads it. */
function readCountryCode(req: ExpressRequest): string {
  if (!SESSION_REPLAY_TRUSTED_GEO_HEADER) {
    return "";
  }

  const trimmed: string = (
    headerValueToString(req.headers[SESSION_REPLAY_TRUSTED_GEO_HEADER]) || ""
  )
    .trim()
    .toUpperCase();

  return TWO_LETTER_COUNTRY_CODE.test(trimmed) &&
    trimmed !== "XX" &&
    trimmed !== "T1"
    ? trimmed
    : "";
}

function send(
  req: ExpressRequest,
  res: ExpressResponse,
  statusCode: number,
  body: { reason: string; message?: string; retryAfterSeconds?: number },
): void {
  if (body.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(body.retryAfterSeconds));
  }

  if (statusCode === 204) {
    res.setHeader("x-oneuptime-replay-reason", body.reason);
    res.status(204).end();
    return;
  }

  Response.sendJsonObjectResponse(req, res, body as unknown as JSONObject, {
    statusCode: new StatusCode(statusCode),
  });
}

function statusFor(decision: ProductAnalyticsGateDecision): number {
  switch (decision.outcome) {
    case ProductAnalyticsGateOutcome.Accepted:
    case ProductAnalyticsGateOutcome.Duplicate:
      return 202;
    case ProductAnalyticsGateOutcome.Stop:
      return 204;
    case ProductAnalyticsGateOutcome.OriginRefused:
      return 403;
    case ProductAnalyticsGateOutcome.Refused:
      return 409;
    case ProductAnalyticsGateOutcome.RateLimited:
      return 429;
    default:
      return 503;
  }
}

function readBodyJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf-8"));
  } catch {
    return undefined;
  }
}

router.post(
  PRODUCT_ANALYTICS_EVENTS_ROUTE,
  TelemetryIngestionDisabled.middleware,
  TelemetryIngest.forSurface(TelemetryIngestSurface.SessionReplay),
  SessionReplayRequestMiddleware.parseBody,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const receivedAtUnixMs: number = Date.now();
      const projectId: ObjectID = (req as TelemetryRequest).projectId;
      const body: unknown = req.body;

      if (!Buffer.isBuffer(body)) {
        send(req, res, 400, {
          reason: "malformed-body",
          message: "Product analytics batches must be posted as a raw body.",
        });
        return;
      }

      if (body.length > PRODUCT_ANALYTICS_MAX_BATCH_BYTES) {
        send(req, res, 413, {
          reason: "payload-too-large",
          message: `A product analytics batch may not exceed ${PRODUCT_ANALYTICS_MAX_BATCH_BYTES} bytes.`,
        });
        return;
      }

      const appIdentifier: string =
        headerValueToString(
          req.headers[SESSION_REPLAY_APP_IDENTIFIER_HEADER],
        )?.trim() || "";

      if (!appIdentifier) {
        send(req, res, 400, {
          reason: "missing-app-identifier",
          message: `Send the RUM application identifier in the ${SESSION_REPLAY_APP_IDENTIFIER_HEADER} header.`,
        });
        return;
      }

      const recorderKind: SessionReplayRecorderKind | null =
        parseSessionReplayRecorderKindHeader(
          req.headers[SESSION_REPLAY_RECORDER_KIND_HEADER],
        );

      if (!recorderKind) {
        send(req, res, 400, {
          reason: "unsupported-recorder-kind",
          message: `The ${SESSION_REPLAY_RECORDER_KIND_HEADER} header must be omitted, "dom", or "rn-view-tree".`,
        });
        return;
      }

      if (recorderKind === "rn-view-tree") {
        const mobileAppIdentifier: string | undefined = headerValueToString(
          req.headers[SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER],
        );

        if (
          !mobileAppIdentifier ||
          !OriginAllowList.getMobileAppOrigin(mobileAppIdentifier)
        ) {
          send(req, res, 400, {
            reason: "invalid-mobile-app-identifier",
            message: `Send a valid Android package name or iOS bundle identifier in the ${SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER} header.`,
          });
          return;
        }
      }

      const json: unknown = readBodyJson(body);
      const record: Record<string, unknown> =
        json !== null && typeof json === "object" && !Array.isArray(json)
          ? (json as Record<string, unknown>)
          : {};
      const itemCount: number =
        (Array.isArray(record["events"])
          ? (record["events"] as Array<unknown>).length
          : 0) +
        (Array.isArray(record["metrics"])
          ? (record["metrics"] as Array<unknown>).length
          : 0);

      const decision: ProductAnalyticsGateDecision =
        await ProductAnalyticsEventIngestService.gateBatch({
          projectId: projectId,
          appIdentifier: appIdentifier,
          origin:
            (req as TelemetryRequest).resolvedClientOrigin !== undefined
              ? (req as TelemetryRequest).resolvedClientOrigin
              : headerValueToString(req.headers["origin"]),
          consentState:
            typeof record["consentState"] === "string"
              ? (record["consentState"] as string)
              : "",
          itemCount: itemCount,
        });

      if (
        decision.outcome !== ProductAnalyticsGateOutcome.Accepted ||
        !decision.policy
      ) {
        send(req, res, statusFor(decision), {
          reason: decision.reason,
          ...(decision.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: decision.retryAfterSeconds }
            : {}),
        });
        return;
      }

      const parsed: ProductAnalyticsBatchParseResult =
        parseProductAnalyticsBatch(json, {
          receivedAtUnixMs: receivedAtUnixMs,
          allowedUserPropertyKeys:
            decision.policy.productAnalyticsUserPropertyKeys,
        });

      if (!parsed.isValid) {
        send(req, res, 400, {
          reason: parsed.error,
          message: "The product analytics batch could not be read.",
        });
        return;
      }

      const claim: "claimed" | "duplicate" | "unavailable" =
        await ProductAnalyticsEventIngestService.claimBatch({
          projectId: projectId,
          batchId: parsed.batch.batchId,
        });

      if (claim === "duplicate") {
        send(req, res, 202, { reason: "duplicate" });
        return;
      }

      if (claim === "unavailable") {
        send(req, res, 503, {
          reason: "claim-unavailable",
          retryAfterSeconds: 30,
        });
        return;
      }

      try {
        await TelemetryQueueService.addProductAnalyticsEventsJob(
          ProductAnalyticsEventIngestService.buildJob({
            projectId: projectId,
            policy: decision.policy,
            batch: parsed.batch,
            receivedAtUnixMs: receivedAtUnixMs,
            countryCode: decision.policy.captureGeo
              ? readCountryCode(req)
              : "",
          }),
        );
      } catch (err) {
        logger.error("Error queueing a product analytics batch:");
        logger.error(err);

        await ProductAnalyticsEventIngestService.releaseBatch({
          projectId: projectId,
          batchId: parsed.batch.batchId,
        });

        send(req, res, 503, {
          reason: "staging-failed",
          retryAfterSeconds: 30,
        });
        return;
      }

      send(req, res, 202, { reason: "accepted" });
    } catch (err) {
      logger.error(`Error in ${PRODUCT_ANALYTICS_EVENTS_ROUTE}:`);
      logger.error(err);
      return next(err);
    }
  },
);

export default router;
