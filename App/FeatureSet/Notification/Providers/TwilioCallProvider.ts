import {
  AvailablePhoneNumber,
  DialOptions,
  DialStatusData,
  ICallProvider,
  IncomingCallData,
  PurchasedPhoneNumber,
  SearchNumberOptions,
  WebhookRequest,
} from "Common/Types/Call/CallProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import Twilio from "twilio";
import { validateRequest } from "twilio";
import { IncomingCallPhoneNumberMarkupPercentage } from "../Config";

// Calculate multiplier from percentage (20% markup = 1.20 multiplier)
const PHONE_NUMBER_PRICE_MULTIPLIER: number =
  1 + IncomingCallPhoneNumberMarkupPercentage / 100;

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
    const pricing: { basePricePerMonthInUSDCents: number } =
      await this.getPhoneNumberPricing(options.countryCode);

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
          providerCostPerMonthInUSDCents: pricing.basePricePerMonthInUSDCents,
          customerCostPerMonthInUSDCents: this.applyMarkup(
            pricing.basePricePerMonthInUSDCents,
          ),
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

  public async purchaseNumber(
    phoneNumber: string,
    webhookUrl: string,
  ): Promise<PurchasedPhoneNumber> {
    const purchased: Twilio.Twilio["incomingPhoneNumbers"] extends {
      create: (opts: object) => Promise<infer R>;
    }
      ? R
      : never = await this.client.incomingPhoneNumbers.create({
      phoneNumber,
      voiceUrl: webhookUrl,
      voiceMethod: "POST",
    });

    // Get pricing for this phone number's country
    // Extract country code from phone number (e.g., +1 for US/CA)
    const countryCode: string = this.getCountryCodeFromPhoneNumber(phoneNumber);
    const pricing: { basePricePerMonthInUSDCents: number } =
      await this.getPhoneNumberPricing(countryCode);

    return {
      phoneNumberId: purchased.sid,
      phoneNumber: purchased.phoneNumber,
      providerCostPerMonthInUSDCents: pricing.basePricePerMonthInUSDCents,
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

  public async getPhoneNumberPricing(
    countryCode: string,
  ): Promise<{ basePricePerMonthInUSDCents: number }> {
    try {
      const pricing: Twilio.Twilio["pricing"]["v1"]["phoneNumbers"]["countries"] extends (
        countryCode: string,
      ) => { fetch: () => Promise<infer R> }
        ? R
        : never = await this.client.pricing.v1.phoneNumbers
        .countries(countryCode)
        .fetch();

      // Twilio returns prices - we need to convert to cents
      // The pricing structure has phoneNumberPrices with basePrice
      const phoneNumberPrices: Array<{
        basePrice: number | string;
        numberType: string;
      }> = (pricing.phoneNumberPrices || []) as Array<{
        basePrice: number | string;
        numberType: string;
      }>;

      // Find local number pricing
      const localPricing:
        | { basePrice: number | string; numberType: string }
        | undefined = phoneNumberPrices.find(
        (p: { basePrice: number | string; numberType: string }) => {
          return p.numberType === "local";
        },
      );

      if (localPricing) {
        const basePriceInDollars: number =
          typeof localPricing.basePrice === "string"
            ? parseFloat(localPricing.basePrice)
            : localPricing.basePrice;
        return {
          basePricePerMonthInUSDCents: Math.round(basePriceInDollars * 100),
        };
      }

      // Default price if local pricing not found
      return { basePricePerMonthInUSDCents: 100 }; // $1.00 default
    } catch (error) {
      // Default price if pricing API fails
      return { basePricePerMonthInUSDCents: 100 }; // $1.00 default
    }
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
    const protocol: string = request.protocol || "https";
    const host: string = request.get("host") || "";
    const url: string = `${protocol}://${host}${request.originalUrl}`;

    const params: Record<string, string> = {};
    const body: Record<string, unknown> = request.body as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(body)) {
      params[key] = String(body[key]);
    }

    return validateRequest(authToken, signature, url, params);
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

  private applyMarkup(basePriceInCents: number): number {
    return Math.round(basePriceInCents * PHONE_NUMBER_PRICE_MULTIPLIER);
  }

  private getCountryCodeFromPhoneNumber(phoneNumber: string): string {
    // Map common country calling codes to ISO country codes
    // This is a simplified mapping - in production you might use a library like libphonenumber
    const countryCodeMap: Record<string, string> = {
      "+1": "US", // US and Canada
      "+44": "GB", // United Kingdom
      "+61": "AU", // Australia
      "+49": "DE", // Germany
      "+33": "FR", // France
      "+91": "IN", // India
      "+81": "JP", // Japan
      "+86": "CN", // China
      "+55": "BR", // Brazil
      "+52": "MX", // Mexico
    };

    for (const [prefix, countryCode] of Object.entries(countryCodeMap)) {
      if (phoneNumber.startsWith(prefix)) {
        return countryCode;
      }
    }

    // Default to US if unknown
    return "US";
  }
}
