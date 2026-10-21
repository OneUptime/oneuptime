import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import JSONWebToken from "../Utils/JsonWebToken";
import Response from "../Utils/Response";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import { OnCallInputRequest } from "../../Types/Call/CallRequest";
import BadDataException from "../../Types/Exception/BadDataException";
import JSONFunctions from "../../Types/JSONFunctions";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export default class NotificationMiddleware {
  /*
   * Answers a key the person pressed during a call: with what the call
   * itself said that key would answer (its signed token), or - when what
   * happened decides the answer, as for passing a page on - with
   * `sayMessage`.
   */
  @CaptureSpan()
  public static async sendResponse(
    req: ExpressRequest,
    res: ExpressResponse,
    onCallInputRequest: OnCallInputRequest,
    sayMessage?: string | undefined,
  ): Promise<void> {
    const response: VoiceResponse = new VoiceResponse();

    if (sayMessage) {
      response.say(sayMessage);
    } else if (onCallInputRequest[req.body["Digits"]]) {
      response.say(onCallInputRequest[req.body["Digits"]]!.sayMessage);
    } else {
      response.say(onCallInputRequest["default"]!.sayMessage);
    }

    return Response.sendXmlResponse(req, res, response.toString());
  }

  @CaptureSpan()
  public static async isValidCallNotificationRequest(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    req = req as OneUptimeRequest;

    if (!req.body["Digits"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid input"),
      );
    }

    if (!req.query["token"]) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid token"),
      );
    }

    const token: string = req.query["token"] as string;

    try {
      (req as any).callTokenData = JSONFunctions.deserialize(
        JSONWebToken.decodeJsonPayload(token),
      );
    } catch (e) {
      logger.error(e, getLogAttributesFromRequest(req as any));
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid token"),
      );
    }

    return next();
  }
}
