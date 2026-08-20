import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
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

    const slackSignature: string | undefined = req.headers[
      "x-slack-signature"
    ] as string | undefined;
    const timestamp: string = req.headers[
      "x-slack-request-timestamp"
    ] as string;
    // Use rawBody for both JSON and URL-encoded requests, fallback to rawFormUrlEncodedBody for backward compatibility
    const requestBody: string =
      (req as OneUptimeRequest).rawBody ||
      (req as OneUptimeRequest).rawFormUrlEncodedBody ||
      "";

    logger.debug(
      `slackSignature: ${slackSignature}`,
      getLogAttributesFromRequest(req),
    );
    logger.debug(`timestamp: ${timestamp}`, getLogAttributesFromRequest(req));
    logger.debug(`requestBody: `, getLogAttributesFromRequest(req));
    logger.debug(requestBody, getLogAttributesFromRequest(req));

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

    logger.debug(
      `Generated signature: ${SIGNATURE_PREFIX}${expectedDigest}`,
      getLogAttributesFromRequest(req),
    );

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

    logger.debug(
      "Slack request authorized successfully",
      getLogAttributesFromRequest(req),
    );
    next();
  }
}
