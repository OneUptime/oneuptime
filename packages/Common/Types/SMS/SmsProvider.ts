import Exception from "../Exception/Exception";
import ExceptionCode from "../Exception/ExceptionCode";
import Phone from "../Phone";

export interface SmsSendOptions {
  to: Phone;
  message: string;
  statusCallbackUrl?: string;
}

export interface SmsSendResult {
  providerMessageId: string; // Provider's message id (e.g. Twilio SID)
  providerStatus: string; // Provider status string (e.g. "queued", "sent")
  fromNumber: Phone; // Provider picks the from-number internally; returned for SmsLog
}

// All providers must implement this
export interface ISmsProvider {
  sendSms(options: SmsSendOptions): Promise<SmsSendResult>;
}

export default class SmsSendException extends Exception {
  public errorCode?: string | undefined;

  public constructor(message: string, errorCode?: string) {
    super(ExceptionCode.GeneralException, message);
    this.errorCode = errorCode;
  }
}
