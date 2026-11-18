import CallService from "./CallService";
import MailService from "./MailService";
import SmsService from "./SmsService";
import {
  VapidPrivateKey,
  VapidPublicKey,
} from "Common/Server/EnvironmentConfig";
import PushNotificationService from "Common/Server/Services/PushNotificationService";
import UserPushService from "Common/Server/Services/UserPushService";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import ServerChannelSetup, {
  ServerSetUpProblemReading,
} from "Common/Server/Utils/ServerSending/ServerChannelSetup";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import {
  getCallAndSmsSentThrough,
  getEmailSentThrough,
} from "Common/Server/Utils/ServerSetup/ServerSetupChecklist";
import logger from "Common/Server/Utils/Logger";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import CallRequest from "Common/Types/Call/CallRequest";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import {
  SERVER_TEST_PUSH_REASONS,
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

export const SERVER_TEST_PUSH_TITLE: string = "Test push from OneUptime";

export const SERVER_TEST_PUSH_TEXT: string =
  "This is a test push from your OneUptime server. Push notifications from this server reach this device.";

// One of the admin's own devices a test push goes to.
export interface ServerTestPushDevice {
  token: string;
  name: string;
  deviceType: PushDeviceType;
}

const refusedBecause: (err: unknown) => string = (err: unknown): string => {
  const message: string | null = toServerTestSendMessage(
    err instanceof Error ? err.message : typeof err === "string" ? err : "",
  );

  return message || "No reason was given.";
};

export default class ServerTestSendService {
  /*
   * Nothing went out: what the settings are missing, in English and - for a
   * sentence of OneUptime's own - in words the Admin Dashboard says in its
   * reader's language (#9437).
   */
  public static notSetUp(
    answer: ServerTestSendAnswer,
    problem: ServerSetUpProblemReading,
  ): ServerTestSendAnswer {
    const notSetUp: ServerTestSendAnswer = {
      ...answer,
      result: ServerTestSendResult.NotSetUp,
      message: problem.english,
    };

    if (problem.words) {
      notSetUp.messageWords = problem.words;
    }

    return notSetUp;
  }

  // The server's settings, and what takes each channel's sends.
  private static async readConfig(): Promise<GlobalConfig | null> {
    return await ServerSendingStatus.readConfig();
  }

  public static async sendEmail(to: Email): Promise<ServerTestSendAnswer> {
    const config: GlobalConfig | null =
      await ServerTestSendService.readConfig();
    const sentThrough: string | null = getEmailSentThrough(config);
    const problem: ServerSetUpProblemReading | null =
      ServerChannelSetup.readEmailSetUpProblem(config);

    const answer: ServerTestSendAnswer = {
      channel: ServerSendingChannel.Email,
      result: ServerTestSendResult.Accepted,
      to: to.toString(),
      sentThrough: sentThrough,
      message: null,
    };

    if (problem) {
      return ServerTestSendService.notSetUp(answer, problem);
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
    const problem: ServerSetUpProblemReading | null =
      ServerChannelSetup.readSetUpProblem(ServerSendingChannel.SMS, config);

    const answer: ServerTestSendAnswer = {
      channel: ServerSendingChannel.SMS,
      result: ServerTestSendResult.Accepted,
      to: to.toString(),
      sentThrough: getCallAndSmsSentThrough(config),
      message: null,
    };

    if (problem) {
      return ServerTestSendService.notSetUp(answer, problem);
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
    const problem: ServerSetUpProblemReading | null =
      ServerChannelSetup.readSetUpProblem(ServerSendingChannel.Call, config);

    const answer: ServerTestSendAnswer = {
      channel: ServerSendingChannel.Call,
      result: ServerTestSendResult.Accepted,
      to: to.toString(),
      sentThrough: getCallAndSmsSentThrough(config),
      message: null,
    };

    if (problem) {
      return ServerTestSendService.notSetUp(answer, problem);
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

  /*
   * The phones and browsers this admin registered for push notifications,
   * in every project they registered them in, each once: a phone registered
   * in three projects is one device to push to. Only the verified ones: a
   * device whose push service said it is gone is pushed to by nothing.
   */
  public static async readPushDevices(
    userId: ObjectID,
  ): Promise<Array<ServerTestPushDevice>> {
    const rows: Array<UserPush> = await UserPushService.findBy({
      query: {
        userId: userId,
        isVerified: true,
      },
      select: {
        deviceToken: true,
        deviceType: true,
        deviceName: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const devices: Array<ServerTestPushDevice> = [];

    for (const row of rows) {
      const token: string = (row.deviceToken || "").trim();

      if (
        !token ||
        devices.some((device: ServerTestPushDevice): boolean => {
          return device.token === token;
        })
      ) {
        continue;
      }

      devices.push({
        token: token,
        name: (row.deviceName || "").trim() || "Unknown Device",
        deviceType: row.deviceType || PushDeviceType.Web,
      });
    }

    return devices;
  }

  /*
   * "Send test push" (#7028): a push to the admin who pressed it, on each
   * of their own registered phones and browsers - nobody else's, whatever
   * they hand the route. Through PushNotificationService, the way a page
   * goes, with no project: so the pushes are recorded with the server's own
   * once it records them (#6881).
   *
   *   - not set up, with nothing tried: push is turned off for the server;
   *     the admin has no device registered; or every one is a browser and
   *     the server has no VAPID keys to push to a browser with;
   *   - accepted: the devices whose push service took it, by name - a
   *     browser is left out when the server has no VAPID keys;
   *   - refused: none took it, and what each push service said.
   */
  public static async sendPush(
    userId: ObjectID,
  ): Promise<ServerTestSendAnswer> {
    const config: GlobalConfig | null =
      await ServerTestSendService.readConfig();
    const problem: ServerSetUpProblemReading | null =
      ServerChannelSetup.readSetUpProblem(ServerSendingChannel.Push, config);

    const answer: ServerTestSendAnswer = {
      channel: ServerSendingChannel.Push,
      result: ServerTestSendResult.Accepted,
      to: "",
      sentThrough: null,
      message: null,
    };

    if (problem) {
      return ServerTestSendService.notSetUp(answer, problem);
    }

    const devices: Array<ServerTestPushDevice> =
      await ServerTestSendService.readPushDevices(userId);

    if (devices.length === 0) {
      return {
        ...answer,
        result: ServerTestSendResult.NotSetUp,
        message: SERVER_TEST_PUSH_REASONS.noDevices,
      };
    }

    // A browser takes a push signed with the server's VAPID keys alone.
    const canPushToBrowsers: boolean = Boolean(
      VapidPublicKey && VapidPrivateKey,
    );
    const reachable: Array<ServerTestPushDevice> = devices.filter(
      (device: ServerTestPushDevice): boolean => {
        return canPushToBrowsers || device.deviceType !== PushDeviceType.Web;
      },
    );

    if (reachable.length === 0) {
      return {
        ...answer,
        result: ServerTestSendResult.NotSetUp,
        message: SERVER_TEST_PUSH_REASONS.noVapidKeys,
      };
    }

    const message: PushNotificationMessage =
      PushNotificationUtil.createGenericNotification({
        title: SERVER_TEST_PUSH_TITLE,
        body: SERVER_TEST_PUSH_TEXT,
        clickAction: "/dashboard",
        tag: "server-test-push",
        requireInteraction: false,
      });

    // Each device on its own, so each says whether it took it.
    const results: Array<PromiseSettledResult<void>> = await Promise.allSettled(
      reachable.map((device: ServerTestPushDevice): Promise<void> => {
        return PushNotificationService.sendPushNotification(
          {
            devices: [{ token: device.token, name: device.name }],
            message: message,
            deviceType: device.deviceType,
          },
          {
            isSensitive: false,
            userId: userId,
          },
        );
      }),
    );

    const accepted: Array<string> = [];
    const reasons: Array<string> = [];

    results.forEach(
      (result: PromiseSettledResult<void>, index: number): void => {
        if (result.status === "fulfilled") {
          accepted.push(reachable[index]!.name);
          return;
        }

        const reason: string = PushNotificationService.getFailureReason(
          result.reason,
        );

        if (!reasons.includes(reason)) {
          reasons.push(reason);
        }
      },
    );

    if (accepted.length > 0) {
      return { ...answer, to: accepted.join(", ") };
    }

    logger.warn("A test push through this server's settings was refused.");
    logger.warn(reasons.join("; "));

    return {
      ...answer,
      result: ServerTestSendResult.Refused,
      message: refusedBecause(reasons.join("; ")),
    };
  }
}
