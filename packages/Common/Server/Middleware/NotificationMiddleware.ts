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
import URL from "../../Types/API/URL";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  CALL_KEYPAD_FINISH_ON_KEY,
  CallKeypadPrompt,
} from "../../Utils/Call/CallKeypad";
import { CallSpeechOptions, sayInto } from "../Utils/Call/CallTwimlSpeech";
import { getCallAnswerWrongKeySentence } from "../Utils/OnCall/OnCallPageCallAnswers";

/*
 * How a key's answer speaks: in the call's voice (OnCallKeypadToken), and
 * with no record number to spell - an answer names none.
 */
const getAnswerSpeech: (voice: string | undefined) => CallSpeechOptions = (
  voice: string | undefined,
): CallSpeechOptions => {
  return { voice: voice, recordNumberPrefixes: [] };
};

export default class NotificationMiddleware {
  /*
   * Answers a key the person pressed during a call: with what the call
   * itself said that key would answer (its signed token), or - when what
   * happened decides the answer, as for passing a page on - with
   * `sayMessage`. In the voice the call speaks with (#10948), and in
   * characters TwiML can carry (CallTwimlSpeech): a name in the answer with
   * a control character in it no longer fails the TwiML builder, and with
   * it the answer.
   */
  @CaptureSpan()
  public static async sendResponse(
    req: ExpressRequest,
    res: ExpressResponse,
    onCallInputRequest: OnCallInputRequest,
    sayMessage?: string | undefined,
    voice?: string | undefined,
  ): Promise<void> {
    const response: VoiceResponse = new VoiceResponse();
    const speech: CallSpeechOptions = getAnswerSpeech(voice);

    if (sayMessage) {
      sayInto(response, sayMessage, speech);
    } else if (onCallInputRequest[req.body["Digits"]]) {
      sayInto(
        response,
        onCallInputRequest[req.body["Digits"]]!.sayMessage,
        speech,
      );
    } else {
      sayInto(response, onCallInputRequest["default"]!.sayMessage, speech);
    }

    return Response.sendXmlResponse(req, res, response.toString());
  }

  /*
   * Answers a wrong key by asking again (#10949): "That key does nothing.",
   * then the call's own prompt, inside a <Gather> that listens as long as
   * the call's did and posts the next key to `action` - the call's own
   * keypad address, which counts the wrong keys asked again for
   * (OnCallPageLinks.getCallAskAgainUrl). Silence after it ends the call as
   * silence always does: its no-input words, then it hangs up, the page left
   * as it was. In the call's voice, and its language (#11066): the prompt
   * and its no-input words are the call's own, and "That key does nothing."
   * is said in the language of its voice (OnCallPageCallAnswers).
   */
  @CaptureSpan()
  public static async sendAskAgain(
    req: ExpressRequest,
    res: ExpressResponse,
    data: {
      prompt: CallKeypadPrompt;
      action: URL;
      voice?: string | undefined;
    },
  ): Promise<void> {
    return Response.sendXmlResponse(
      req,
      res,
      NotificationMiddleware.getAskAgainTwiml(data),
    );
  }

  // The TwiML of a prompt asked again (sendAskAgain).
  public static getAskAgainTwiml(data: {
    prompt: CallKeypadPrompt;
    action: URL;
    voice?: string | undefined;
  }): string {
    const response: VoiceResponse = new VoiceResponse();
    const speech: CallSpeechOptions = getAnswerSpeech(data.voice);

    const gather: VoiceResponse.Gather = response.gather({
      input: ["dtmf"],
      numDigits: 1,
      timeout: data.prompt.timeoutInSeconds,
      action: data.action.toString(),
      method: "POST",
      finishOnKey: CALL_KEYPAD_FINISH_ON_KEY,
    });

    // In the call's language: the language of its voice (#11066).
    sayInto(gather, getCallAnswerWrongKeySentence(data.voice), speech);
    sayInto(gather, data.prompt.sayMessage, speech);

    if (data.prompt.noInputMessage) {
      sayInto(response, data.prompt.noInputMessage, speech);
    }

    response.hangup();

    return response.toString();
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
