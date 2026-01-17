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
import Twilio, { validateRequest } from "twilio";
import logger from "Common/Server/Utils/Logger";

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
      (sid: string): { update: (opts: Record<string, unknown>) => Promise<infer R> };
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
    await this.client.incomingPhoneNumbers(phoneNumberId).remove();
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
      DialCallStatus?: string;
      DialCallDuration?: string;
    } = request.body as {
      CallSid?: string;
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
    };
  }

  public validateWebhookSignature(
    request: WebhookRequest,
    signature: string,
  ): boolean {
    const authToken: string = this.config.authToken;

    // Build the full URL that Twilio used to generate the signature
    // When behind a proxy, use X-Forwarded-Proto and X-Forwarded-Host headers
    // These headers are set by reverse proxies (nginx, load balancers, etc.)
    const forwardedProto: string | undefined = request.get(
      "x-forwarded-proto",
    ) as string | undefined;
    const forwardedHost: string | undefined = request.get(
      "x-forwarded-host",
    ) as string | undefined;

    // Use forwarded headers if available, otherwise fall back to request properties
    const protocol: string = forwardedProto || request.protocol || "https";
    const host: string = forwardedHost || request.get("host") || "";
    const url: string = `${protocol}://${host}${request.originalUrl}`;

    const params: Record<string, string> = {};
    const body: Record<string, unknown> = request.body as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(body)) {
      params[key] = String(body[key]);
    }

    const isValid: boolean = validateRequest(authToken, signature, url, params);

    // Debug logging for signature validation
    if (!isValid) {
      logger.debug("Twilio Webhook Signature Validation Debug:");
      logger.debug(`  URL used for validation: ${url}`);
      logger.debug(`  Signature received: ${signature}`);
      logger.debug(`  Protocol: ${protocol}`);
      logger.debug(`  Host: ${host}`);
      logger.debug(`  Original URL: ${request.originalUrl}`);
      logger.debug(`  X-Forwarded-Proto: ${forwardedProto}`);
      logger.debug(`  X-Forwarded-Host: ${forwardedHost}`);
      logger.debug(`  Request protocol: ${request.protocol}`);
      logger.debug(`  Request host header: ${request.get("host")}`);
    }

    return isValid;
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
