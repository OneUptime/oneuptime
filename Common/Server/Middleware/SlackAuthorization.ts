import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { SlackAppSigningSecret } from "../EnvironmentConfig";
import crypto from "crypto";
import logger from "../Utils/Logger";

export default class SlackAuthorization {
  public static async isAuthorizedSlackRequest(
    req: OneUptimeRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    if (!SlackAppSigningSecret) {
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
    const requestBody: string = req.body;

    logger.debug(`slackSignature: ${slackSignature}`);
    logger.debug(`timestamp: ${timestamp}`);
    logger.debug(`requestBody: ${requestBody}`);

    const baseString: string = `v0:${timestamp}:${requestBody}`;
    const signature: string = `v0=${crypto.createHmac("sha256", slackSigningSecret).update(baseString).digest("hex")}`;

    // check if the signature is valid
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(slackSignature),
      )
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Slack Signature Verification Failed."),
      );
    }

    next();
  }
}
