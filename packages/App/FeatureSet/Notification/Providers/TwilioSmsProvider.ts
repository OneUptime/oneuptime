import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import Phone from "Common/Types/Phone";
import SmsSendException, {
  ISmsProvider,
  SmsSendOptions,
  SmsSendResult,
} from "Common/Types/SMS/SmsProvider";
import Twilio from "twilio";
import { MessageInstance } from "twilio/lib/rest/api/v2010/account/message";

export default class TwilioSmsProvider implements ISmsProvider {
  private client: Twilio.Twilio;
  private config: TwilioConfig;

  public constructor(config: TwilioConfig) {
    this.config = config;
    this.client = new Twilio.Twilio(config.accountSid, config.authToken);
  }

  public async sendSms(options: SmsSendOptions): Promise<SmsSendResult> {
    try {
      const fromNumber: Phone = Phone.pickPhoneNumberToSendSMSOrCallFrom({
        to: options.to,
        primaryPhoneNumberToPickFrom: this.config.primaryPhoneNumber,
        secondaryPhoneNumbersToPickFrom:
          this.config.secondaryPhoneNumbers || [],
      });

      const message: MessageInstance = await this.client.messages.create({
        body: options.message,
        to: options.to.toString(),
        from: fromNumber.toString(),
        ...(options.statusCallbackUrl
          ? { statusCallback: options.statusCallbackUrl }
          : {}),
      });

      return {
        providerMessageId: message.sid,
        providerStatus: message.status,
        fromNumber: fromNumber,
      };
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err);

      let errorCode: string | undefined = undefined;

      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        err.code !== null &&
        err.code !== undefined
      ) {
        errorCode = String(err.code);
      }

      throw new SmsSendException(message, errorCode);
    }
  }
}
