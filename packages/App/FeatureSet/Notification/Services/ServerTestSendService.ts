import CallService from "./CallService";
import MailService from "./MailService";
import SmsService from "./SmsService";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import ServerChannelSetup from "Common/Server/Utils/ServerSending/ServerChannelSetup";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import {
  getCallAndSmsSentThrough,
  getEmailSentThrough,
} from "Common/Server/Utils/ServerSetup/ServerSetupChecklist";
import logger from "Common/Server/Utils/Logger";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import CallRequest from "Common/Types/Call/CallRequest";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Phone from "Common/Types/Phone";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import {
  ServerTestSendAnswer,
  ServerTestSendResult,
  toServerTestSendMessage,
} from "Common/Types/ServerSetup/ServerTestSend";

/*
 * A MASTER ADMIN'S TEST SEND, THROUGH THE SERVER'S OWN SETTINGS.
 *
 * The same senders a real email, SMS or call goes through - MailService,
 * SmsService, CallService - with no project and no settings of their own,
 * so the test goes out through exactly what the server sends with, and the
 * senders write how it went where ServerSendingStatus reads it: the setup
 * checklist and the banner then agree with the test.
 *
 * Settings that are missing are answered before anything is tried, with
 * what is missing (ServerChannelSetup, the rules the senders refuse by). A
 * refusal is answered with what the provider said: the reader is the
 * server's admin, whose mail server or Twilio account it is.
 */

// How long a test waits for the mail service, over all its tries.
export const SERVER_TEST_EMAIL_TIMEOUT_IN_MS: number = 15000;

export const SERVER_TEST_SMS_TEXT: string =
  "This is a test SMS from OneUptime. SMS from this server work.";

export const SERVER_TEST_CALL_TEXT: string =
  "This is a test call from One Uptime. Calls from this server work.";

const refusedBecause: (err: unknown) => string = (err: unknown): string => {
  const message: string | null = toServerTestSendMessage(
    err instanceof Error ? err.message : typeof err === "string" ? err : "",
  );

  return message || "No reason was given.";
};

export default class ServerTestSendService {
  // The server's settings, and what takes each channel's sends.
  private static async readConfig(): Promise<GlobalConfig | null> {
    return await ServerSendingStatus.readConfig();
  }

  public static async sendEmail(to: Email): Promise<ServerTestSendAnswer> {
    const config: GlobalConfig | null =
      await ServerTestSendService.readConfig();
    const sentThrough: string | null = getEmailSentThrough(config);
    const problem: string | null =
      ServerChannelSetup.getEmailSetUpProblem(config);

    const answer: ServerTestSendAnswer = {
      channel: ServerSendingChannel.Email,
      result: ServerTestSendResult.Accepted,
      to: to.toString(),
      sentThrough: sentThrough,
      message: null,
    };

    if (problem) {
      return {
        ...answer,
        result: ServerTestSendResult.NotSetUp,
        message: problem,
      };
    }

    const mail: EmailMessage = {
      templateType: EmailTemplateType.SMTPTest,
      toEmail: to,
      subject: `Test Email from ${ProductBrandingText.getProductName()}`,
      isSubjectLiteral: true,
      vars: {},
      body: "",
    };

    try {
      // No project, no mail server of its own: the server's settings.
      await MailService.send(mail, {
        timeout: SERVER_TEST_EMAIL_TIMEOUT_IN_MS,
      });
    } catch (err) {
      logger.warn("A test email through this server's settings was refused.");
      logger.warn(err);

      return {
        ...answer,
        result: ServerTestSendResult.Refused,
        message: refusedBecause(err),
      };
    }

    return answer;
  }

  public static async sendSms(to: Phone): Promise<ServerTestSendAnswer> {
    const config: GlobalConfig | null =
      await ServerTestSendService.readConfig();
    const problem: string | null = ServerChannelSetup.getSetUpProblem(
      ServerSendingChannel.SMS,
      config,
    );

    const answer: ServerTestSendAnswer = {
      channel: ServerSendingChannel.SMS,
      result: ServerTestSendResult.Accepted,
      to: to.toString(),
      sentThrough: getCallAndSmsSentThrough(config),
      message: null,
    };

    if (problem) {
      return {
        ...answer,
        result: ServerTestSendResult.NotSetUp,
        message: problem,
      };
    }

    try {
      await SmsService.sendSms(to, SERVER_TEST_SMS_TEXT, {
        // The server's own Twilio account: no project's config is tested.
        customTwilioConfig: undefined,
        // Throw rather than return quietly when it is not sent.
        failIfNotSent: true,
      });
    } catch (err) {
      logger.warn("A test SMS through this server's settings was refused.");
      logger.warn(err);

      return {
        ...answer,
        result: ServerTestSendResult.Refused,
        message: refusedBecause(err),
      };
    }

    return answer;
  }

  public static async makeCall(to: Phone): Promise<ServerTestSendAnswer> {
    const config: GlobalConfig | null =
      await ServerTestSendService.readConfig();
    const problem: string | null = ServerChannelSetup.getSetUpProblem(
      ServerSendingChannel.Call,
      config,
    );

    const answer: ServerTestSendAnswer = {
      channel: ServerSendingChannel.Call,
      result: ServerTestSendResult.Accepted,
      to: to.toString(),
      sentThrough: getCallAndSmsSentThrough(config),
      message: null,
    };

    if (problem) {
      return {
        ...answer,
        result: ServerTestSendResult.NotSetUp,
        message: problem,
      };
    }

    const callRequest: CallRequest = {
      data: [
        {
          sayMessage: SERVER_TEST_CALL_TEXT,
        },
      ],
      to: to,
    };

    try {
      await CallService.makeCall(callRequest, {
        // The server's own Twilio account: no project's config is tested.
        customTwilioConfig: undefined,
        failIfNotSent: true,
      });
    } catch (err) {
      logger.warn("A test call through this server's settings was refused.");
      logger.warn(err);

      return {
        ...answer,
        result: ServerTestSendResult.Refused,
        message: refusedBecause(err),
      };
    }

    return answer;
  }
}
