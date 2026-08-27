import {
  ExpressResponse,
  headerValueToString,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import GlobalCache from "../Infrastructure/GlobalCache";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
import { SlackAppSigningSecret } from "../EnvironmentConfig";
import crypto from "crypto";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Slack sends the digest as "v0=" followed by the 64 hex characters of a
 * SHA-256 HMAC. Same reasoning as WhatsAppAuthorization: the header is
 * attacker-controlled on an endpoint whose only authentication IS the
 * signature, and crypto.timingSafeEqual throws RangeError on a length
 * mismatch instead of returning false, so the shape is validated before the
 * comparison. A missing header is covered by the same check - it used to
 * reach Buffer.from(undefined) and throw a TypeError.
 */
const SIGNATURE_PREFIX: string = "v0=";
const HEX_DIGEST_REGEX: RegExp = /^[a-f0-9]{64}$/i;
const UNIX_TIMESTAMP_REGEX: RegExp = /^\d+$/;
const MAX_REQUEST_AGE_IN_SECONDS: number = 5 * 60;
const REPLAY_CACHE_NAMESPACE: string = "slack-request-replay";

export default class SlackAuthorization {
  @CaptureSpan()
  public static async isAuthorizedSlackRequest(
    req: OneUptimeRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    logger.debug(
      "Starting Slack request authorization",
      getLogAttributesFromRequest(req),
    );

    if (!SlackAppSigningSecret) {
      logger.error(
        "SLACK_APP_SIGNING_SECRET env variable not found.",
        getLogAttributesFromRequest(req),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(
          "SLACK_APP_SIGNING_SECRET env variable not found.",
        ),
      );
    }

    // validate slack signing secret
    const slackSigningSecret: string = SlackAppSigningSecret.toString();

    const slackSignature: string | undefined = headerValueToString(
      req.headers["x-slack-signature"],
    );
    const timestamp: string =
      headerValueToString(req.headers["x-slack-request-timestamp"]) || "";
    // Use rawBody for both JSON and URL-encoded requests, fallback to rawFormUrlEncodedBody for backward compatibility
    const requestBody: string =
      (req as OneUptimeRequest).rawBody ||
      (req as OneUptimeRequest).rawFormUrlEncodedBody ||
      "";

    /*
     * Slack signs the timestamp specifically so a captured request cannot be
     * replayed indefinitely. Verify the documented five-minute freshness
     * window before doing any signature work. The strict decimal check keeps
     * Number parsing from accepting partial values such as "123abc".
     */
    const timestampInSeconds: number = Number(timestamp);
    const nowInSeconds: number = Math.floor(Date.now() / 1000);

    if (
      !UNIX_TIMESTAMP_REGEX.test(timestamp) ||
      !Number.isSafeInteger(timestampInSeconds) ||
      Math.abs(nowInSeconds - timestampInSeconds) > MAX_REQUEST_AGE_IN_SECONDS
    ) {
      logger.error(
        "Slack request has a missing, malformed, or stale X-Slack-Request-Timestamp header.",
        getLogAttributesFromRequest(req),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Slack Signature Verification Failed."),
      );
    }

    const providedDigest: string =
      slackSignature && slackSignature.startsWith(SIGNATURE_PREFIX)
        ? slackSignature.slice(SIGNATURE_PREFIX.length)
        : "";

    if (!HEX_DIGEST_REGEX.test(providedDigest)) {
      logger.error(
        "Slack request has a missing or malformed X-Slack-Signature header.",
        getLogAttributesFromRequest(req),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Slack Signature Verification Failed."),
      );
    }

    const baseString: string = `v0:${timestamp}:${requestBody}`;
    const expectedDigest: string = crypto
      .createHmac("sha256", slackSigningSecret)
      .update(baseString)
      .digest("hex");

    /*
     * Both sides are decoded from 64 validated hex characters, so both
     * buffers are 32 bytes and timingSafeEqual cannot throw here.
     */
    if (
      !crypto.timingSafeEqual(
        Buffer.from(expectedDigest, "hex") as Uint8Array,
        Buffer.from(providedDigest, "hex") as Uint8Array,
      )
    ) {
      logger.error(
        "Slack Signature Verification Failed.",
        getLogAttributesFromRequest(req),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Slack Signature Verification Failed."),
      );
    }

    /*
     * URL verification and options loading have no side effects and need their
     * normal response on every valid delivery. All other signed Slack routes
     * are processed at most once.
     */
    const isNaturallyIdempotentRequest: boolean =
      req.route?.path === "/slack/options-load" ||
      req.body?.["type"] === "url_verification";

    if (isNaturallyIdempotentRequest) {
      next();
      return;
    }

    /*
     * Freshness bounds replay to a small window; this atomic cache claim closes
     * that remaining window across every application replica. The expiry lasts
     * until this timestamp can no longer pass the freshness check. That can be
     * almost ten minutes when a sender clock is five minutes ahead.
     */
    const replayCacheTtlInSeconds: number = Math.max(
      timestampInSeconds + MAX_REQUEST_AGE_IN_SECONDS - nowInSeconds + 1,
      1,
    );

    let isFirstDelivery: boolean;

    try {
      isFirstDelivery = await GlobalCache.setStringIfNotExists(
        REPLAY_CACHE_NAMESPACE,
        expectedDigest,
        timestamp,
        { expiresInSeconds: replayCacheTtlInSeconds },
      );
    } catch {
      /*
       * Replay protection is part of authentication, so cache failure must
       * fail closed. Letting the request through would silently restore the
       * vulnerability whenever Redis is unavailable.
       */
      logger.error(
        "Slack replay protection is unavailable.",
        getLogAttributesFromRequest(req),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new ServiceUnavailableException(
          "Slack request verification is temporarily unavailable.",
        ),
      );
    }

    if (!isFirstDelivery) {
      logger.debug(
        "Duplicate Slack request acknowledged without reprocessing.",
        getLogAttributesFromRequest(req),
      );
      return Response.sendTextResponse(req, res, "");
    }

    logger.debug(
      "Slack request authorized successfully",
      getLogAttributesFromRequest(req),
    );
    next();
  }
}
