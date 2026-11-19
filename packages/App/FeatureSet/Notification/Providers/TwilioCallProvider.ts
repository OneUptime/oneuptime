import {
  AvailablePhoneNumber,
  DialOptions,
  DialStatusData,
  ICallProvider,
  IncomingCallData,
  OwnedPhoneNumber,
  PurchasedPhoneNumber,
  SearchNumberOptions,
  WebhookRequest,
} from "Common/Types/Call/CallProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import Twilio from "twilio";
import logger from "Common/Server/Utils/Logger";
import {
  describeTwilioWebhookUrl,
  getTwilioWebhookUrls,
  isSignedWithAuthToken,
} from "Common/Server/Utils/TwilioWebhookSignature";

export default class TwilioCallProvider implements ICallProvider {
  private client: Twilio.Twilio;
  private config: TwilioConfig;

  public constructor(config: TwilioConfig) {
    this.config = config;
    this.client = new Twilio.Twilio(config.accountSid, config.authToken);
  }

  public async searchAvailableNumbers(
    options: SearchNumberOptions,
  ): Promise<AvailablePhoneNumber[]> {
    const searchOptions: {
      voiceEnabled: boolean;
      limit: number;
      areaCode?: number;
      contains?: string;
    } = {
      voiceEnabled: true,
      limit: options.limit || 10,
    };

    if (options.areaCode) {
      searchOptions.areaCode = parseInt(options.areaCode);
    }

    if (options.contains) {
      searchOptions.contains = options.contains;
    }

    const numbers: Array<{
      phoneNumber: string;
      friendlyName: string;
      locality?: string;
      region?: string;
    }> = await this.client
      .availablePhoneNumbers(options.countryCode)
      .local.list(searchOptions);

    return numbers.map(
      (n: {
        phoneNumber: string;
        friendlyName: string;
        locality?: string;
        region?: string;
      }): AvailablePhoneNumber => {
        const result: AvailablePhoneNumber = {
          phoneNumber: n.phoneNumber,
          friendlyName: n.friendlyName,
          country: options.countryCode,
        };
        if (n.locality) {
          result.locality = n.locality;
        }
        if (n.region) {
          result.region = n.region;
        }
        return result;
      },
    );
  }

  public async listOwnedNumbers(): Promise<OwnedPhoneNumber[]> {
    const numbers: Array<{
      sid: string;
      phoneNumber: string;
      friendlyName: string;
      voiceUrl?: string;
    }> = await this.client.incomingPhoneNumbers.list({
      limit: 100,
    });

    return numbers.map(
      (n: {
        sid: string;
        phoneNumber: string;
        friendlyName: string;
        voiceUrl?: string;
      }): OwnedPhoneNumber => {
        return {
          phoneNumberId: n.sid,
          phoneNumber: n.phoneNumber,
          friendlyName: n.friendlyName,
          voiceUrl: n.voiceUrl,
        };
      },
    );
  }

  public async purchaseNumber(
    phoneNumber: string,
    webhookUrl: string,
  ): Promise<PurchasedPhoneNumber> {
    const purchased: Twilio.Twilio["incomingPhoneNumbers"] extends {
      create: (opts: Record<string, unknown>) => Promise<infer R>;
    }
      ? R
      : never = await this.client.incomingPhoneNumbers.create({
      phoneNumber,
      voiceUrl: webhookUrl,
      voiceMethod: "POST",
    });

    return {
      phoneNumberId: purchased.sid,
      phoneNumber: purchased.phoneNumber,
    };
  }

  public async assignExistingNumber(
    phoneNumberId: string,
    webhookUrl: string,
  ): Promise<PurchasedPhoneNumber> {
    // Update the webhook URL for an existing phone number
    const updated: Twilio.Twilio["incomingPhoneNumbers"] extends {
      (sid: string): {
        update: (opts: Record<string, unknown>) => Promise<infer R>;
      };
    }
      ? R
      : never = await this.client.incomingPhoneNumbers(phoneNumberId).update({
      voiceUrl: webhookUrl,
      voiceMethod: "POST",
    });

    return {
      phoneNumberId: updated.sid,
      phoneNumber: updated.phoneNumber,
    };
  }

  public async releaseNumber(phoneNumberId: string): Promise<void> {
    try {
      await this.client.incomingPhoneNumbers(phoneNumberId).remove();
    } catch (err) {
      /*
       * Treat "already released / not found" as success so releasing is
       * idempotent — a number deleted out-of-band (e.g. in the Twilio console)
       * must not wedge the policy and block reprovisioning.
       */
      const status: number | undefined = (err as { status?: number }).status;
      const code: number | undefined = (err as { code?: number }).code;
      if (status === 404 || code === 20404) {
        return;
      }
      throw err;
    }
  }

  public async updateWebhookUrl(
    phoneNumberId: string,
    webhookUrl: string,
  ): Promise<void> {
    await this.client.incomingPhoneNumbers(phoneNumberId).update({
      voiceUrl: webhookUrl,
      voiceMethod: "POST",
    });
  }

  public generateGreetingResponse(message: string): string {
    const response: Twilio.twiml.VoiceResponse =
      new Twilio.twiml.VoiceResponse();
    response.say({ voice: "alice" }, message);
    return response.toString();
  }

  public generateDialResponse(options: DialOptions): string {
    const response: Twilio.twiml.VoiceResponse =
      new Twilio.twiml.VoiceResponse();
    const dial: ReturnType<Twilio.twiml.VoiceResponse["dial"]> = response.dial({
      action: options.statusCallbackUrl,
      method: "POST",
      timeout: options.timeoutSeconds,
      callerId: options.fromPhoneNumber,
    });
    dial.number(options.toPhoneNumber);
    return response.toString();
  }

  public generateHangupResponse(message?: string): string {
    const response: Twilio.twiml.VoiceResponse =
      new Twilio.twiml.VoiceResponse();
    if (message) {
      response.say({ voice: "alice" }, message);
    }
    response.hangup();
    return response.toString();
  }

  public generateEscalationResponse(
    message: string,
    nextDialOptions: DialOptions,
  ): string {
    const response: Twilio.twiml.VoiceResponse =
      new Twilio.twiml.VoiceResponse();
    response.say({ voice: "alice" }, message);
    const dial: ReturnType<Twilio.twiml.VoiceResponse["dial"]> = response.dial({
      action: nextDialOptions.statusCallbackUrl,
      method: "POST",
      timeout: nextDialOptions.timeoutSeconds,
      callerId: nextDialOptions.fromPhoneNumber,
    });
    dial.number(nextDialOptions.toPhoneNumber);
    return response.toString();
  }

  public parseIncomingCallWebhook(request: WebhookRequest): IncomingCallData {
    const body: { CallSid?: string; From?: string; To?: string } =
      request.body as { CallSid?: string; From?: string; To?: string };

    if (!body.CallSid) {
      throw new BadDataException("CallSid not found in webhook request");
    }

    if (!body.From) {
      throw new BadDataException("From not found in webhook request");
    }

    if (!body.To) {
      throw new BadDataException("To not found in webhook request");
    }

    return {
      callId: body.CallSid,
      callerPhoneNumber: body.From,
      calledPhoneNumber: body.To,
    };
  }

  public parseDialStatusWebhook(request: WebhookRequest): DialStatusData {
    const body: {
      CallSid?: string;
      CallStatus?: string;
      DialCallStatus?: string;
      DialCallDuration?: string;
    } = request.body as {
      CallSid?: string;
      CallStatus?: string;
      DialCallStatus?: string;
      DialCallDuration?: string;
    };

    if (!body.CallSid) {
      throw new BadDataException("CallSid not found in webhook request");
    }

    return {
      callId: body.CallSid,
      dialStatus: this.mapTwilioStatus(body.DialCallStatus || "failed"),
      dialDurationSeconds: parseInt(body.DialCallDuration || "0"),
      callerHungUp: this.hasCallEnded(body.CallStatus),
    };
  }

  /*
   * Whether this account signed the request, at the public URL Twilio was
   * given - as the request names it, through the ingress's /notification
   * rewrite and the scheme and host a proxy forwarded, or as this server
   * gives it to Twilio from HOST and HTTP_PROTOCOL (TwilioWebhookSignature).
   * A request it did not sign is logged with the URLs it was checked at,
   * their query values left out, and never the signature.
   */
  public validateWebhookSignature(
    request: WebhookRequest,
    signature: string,
  ): boolean {
    const isValid: boolean = isSignedWithAuthToken({
      request: request,
      authToken: this.config.authToken,
      signature: signature,
    });

    if (!isValid) {
      logger.debug(
        `Twilio webhook signature not valid for ${
          getTwilioWebhookUrls(request)
            .map((url: string): string => {
              return describeTwilioWebhookUrl(url);
            })
            .join(" or ") || "a request naming no host"
        }${signature ? "" : ": the request carries no X-Twilio-Signature"}`,
        {
          service: "notification",
        },
      );
    }

    return isValid;
  }

  /*
   * CallStatus in a <Dial> action request is the incoming call's own status,
   * not the dialed leg's. It stays "in-progress" while the caller is on the
   * line. Twilio requests the action URL when the caller hangs up mid-dial
   * too, and by then the incoming call has one of its final statuses. A
   * missing or unknown status counts as still connected: hanging up on a
   * caller who is waiting is worse than logging one attempt too many.
   */
  private hasCallEnded(callStatus: string | undefined): boolean {
    const finalStatuses: Array<string> = [
      "completed",
      "busy",
      "failed",
      "no-answer",
      "canceled",
    ];
    return finalStatuses.includes(callStatus || "");
  }

  private mapTwilioStatus(status: string): DialStatusData["dialStatus"] {
    const map: Record<string, DialStatusData["dialStatus"]> = {
      completed: "completed",
      busy: "busy",
      "no-answer": "no-answer",
      failed: "failed",
      canceled: "canceled",
    };
    return map[status] || "failed";
  }
}
