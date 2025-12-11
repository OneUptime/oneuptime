import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import { SlackAppSigningSecret } from "../EnvironmentConfig";
import crypto from "crypto";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export default class SlackAuthorization {
  @CaptureSpan()
  public static async isAuthorizedSlackRequest(
    req: OneUptimeRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    logger.debug("Starting Slack request authorization");

    if (!SlackAppSigningSecret) {
      logger.error("SLACK_APP_SIGNING_SECRET env variable not found.");
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

    const slackSignature: string = req.headers["x-slack-signature"] as string;
    const timestamp: string = req.headers[
      "x-slack-request-timestamp"
    ] as string;
    // Use rawBody for both JSON and URL-encoded requests, fallback to rawFormUrlEncodedBody for backward compatibility
    const requestBody: string =
      (req as OneUptimeRequest).rawBody ||
      (req as OneUptimeRequest).rawFormUrlEncodedBody ||
      "";

    logger.debug(`slackSignature: ${slackSignature}`);
    logger.debug(`timestamp: ${timestamp}`);
    logger.debug(`requestBody: `);
    logger.debug(requestBody);

    const baseString: string = `v0:${timestamp}:${requestBody}`;
    const signature: string = `v0=${crypto.createHmac("sha256", slackSigningSecret).update(baseString).digest("hex")}`;

    logger.debug(`Generated signature: ${signature}`);

    // check if the signature is valid
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature) as Uint8Array,
        Buffer.from(slackSignature) as Uint8Array,
      )
    ) {
      logger.error("Slack Signature Verification Failed.");
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Slack Signature Verification Failed."),
      );
    }

    logger.debug("Slack request authorized successfully");
    next();
  }
}
