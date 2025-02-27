import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
// import Response from "../Utils/Response";
// import BadDataException from "Common/Types/Exception/BadDataException";
// import { SlackAppSigningSecret } from "../EnvironmentConfig";
// import crypto from "crypto";
// import logger from "../Utils/Logger";
// import { JSONObject } from "../../Types/JSON";

export default class SlackAuthorization {
  public static async isAuthorizedSlackRequest(
    _req: OneUptimeRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {

    next(); 
    return; 
    // logger.debug("Starting Slack request authorization");

    // if (!SlackAppSigningSecret) {
    //   logger.error("SLACK_APP_SIGNING_SECRET env variable not found.");
    //   return Response.sendErrorResponse(
    //     req,
    //     res,
    //     new BadDataException(
    //       "SLACK_APP_SIGNING_SECRET env variable not found.",
    //     ),
    //   );
    // }

    // // validate slack signing secret
    // const slackSigningSecret: string = SlackAppSigningSecret.toString();

    // const slackSignature: string = req.headers["x-slack-signature"] as string;
    // const timestamp: string = req.headers[
    //   "x-slack-request-timestamp"
    // ] as string;
    // const requestBody: JSONObject = req.body;

    // logger.debug(`slackSignature: ${slackSignature}`);
    // logger.debug(`timestamp: ${timestamp}`);
    // logger.debug(`requestBody: `);
    // logger.debug(requestBody);

    // const baseString: string = `v0:${timestamp}:${(requestBody)['payload']}`;
    // const signature: string = `v0=${crypto.createHmac("sha256", slackSigningSecret).update(baseString).digest("hex")}`;

    // logger.debug(`Generated signature: ${signature}`);

    // // check if the signature is valid
    // if (
    //   !crypto.timingSafeEqual(
    //     Buffer.from(signature),
    //     Buffer.from(slackSignature),
    //   )
    // ) {
    //   logger.error("Slack Signature Verification Failed.");
    //   return Response.sendErrorResponse(
    //     req,
    //     res,
    //     new BadDataException("Slack Signature Verification Failed."),
    //   );
    // }

    // logger.debug("Slack request authorized successfully");
    // next();
  }
}
