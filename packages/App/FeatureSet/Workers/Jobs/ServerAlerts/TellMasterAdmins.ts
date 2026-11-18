import RunCron from "../../Utils/Cron";
import {
  INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES,
  INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
  runWithInstanceHealthLease,
} from "../InstanceHealth/InstanceHealthLock";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import User from "Common/Models/DatabaseModels/User";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import { Host, IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import MailService from "Common/Server/Services/MailService";
import PushNotificationService from "Common/Server/Services/PushNotificationService";
import SmsService from "Common/Server/Services/SmsService";
import UserPushService from "Common/Server/Services/UserPushService";
import UserService from "Common/Server/Services/UserService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import PartialEntity from "Common/Types/Database/PartialEntity";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import ServerAlertsUtil, {
  ServerAlertChannel,
  ServerAlertMessage,
  ServerAlertPlan,
  ServerAlertSettings,
  ServerAlertState,
  getServerAlertSettings,
} from "Common/Types/ServerSending/ServerAlerts";
import { ServerSendingStatusAnswer } from "Common/Types/ServerSending/ServerSendingStatus";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * TELLING MASTER ADMINS WHEN THE SERVER'S EMAIL OR GLOBAL PROBES STOP
 * WORKING, AND WORK AGAIN (#6879).
 *
 * Every five minutes, under the instance-health lease so two replicas never
 * tell twice: where the server stands (ServerSendingStatus) against what was
 * last told (GlobalConfig.serverAlertState), by the rules in
 * Types/ServerSending/ServerAlerts - only a change, at most one message
 * about a thing an hour, never through the channel it is about, never to
 * anyone but the master admins. Each message goes through every channel
 * master admins chose that the server can send through now: a push to each
 * master admin's own devices, an SMS to the number they gave, and - for
 * the probes - the Admin Notification Email. A channel that refuses is
 * logged and the others go on; nothing is thrown. The state is written
 * only when it changes.
 */

export const SERVER_ALERTS_JOB_NAME: string = "ServerAlerts:TellMasterAdmins";

// How each alert channel is sent through; the job's tests stand in for them.
export interface ServerAlertSenders {
  // Whether any of the master admins' devices took it.
  push: (data: {
    title: string;
    body: string;
    tag: string;
  }) => Promise<boolean>;
  sms: (data: { to: Phone; text: string }) => Promise<boolean>;
  email: (data: { to: Email; title: string; body: string }) => Promise<boolean>;
}

const isAccepted: (
  response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse,
) => boolean = (
  response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse,
): boolean => {
  return !(response instanceof HTTPErrorResponse) && !response.isFailure();
};

// The verified push devices of every master admin, each token once.
const readMasterAdminDevices: () => Promise<
  Map<PushDeviceType, Array<{ token: string; name: string }>>
> = async (): Promise<
  Map<PushDeviceType, Array<{ token: string; name: string }>>
> => {
  const masterAdmins: Array<User> = await UserService.findBy({
    query: { isMasterAdmin: true },
    select: { _id: true },
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });

  const byType: Map<
    PushDeviceType,
    Array<{ token: string; name: string }>
  > = new Map();

  if (masterAdmins.length === 0) {
    return byType;
  }

  const rows: Array<UserPush> = await UserPushService.findBy({
    query: {
      userId: QueryHelper.any(
        masterAdmins
          .map((user: User): ObjectID | undefined => {
            return user.id || undefined;
          })
          .filter((id: ObjectID | undefined): boolean => {
            return Boolean(id);
          }) as Array<ObjectID>,
      ),
      isVerified: true,
    },
    select: { deviceToken: true, deviceType: true, deviceName: true },
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });

  const seen: Set<string> = new Set<string>();

  for (const row of rows) {
    const token: string = (row.deviceToken || "").trim();

    if (!token || seen.has(token)) {
      continue;
    }

    seen.add(token);

    const type: PushDeviceType = row.deviceType || PushDeviceType.Web;
    const devices: Array<{ token: string; name: string }> =
      byType.get(type) || [];

    devices.push({ token, name: (row.deviceName || "").trim() || "Device" });
    byType.set(type, devices);
  }

  return byType;
};

export const SERVER_ALERT_SENDERS: ServerAlertSenders = {
  push: async (data: {
    title: string;
    body: string;
    tag: string;
  }): Promise<boolean> => {
    const byType: Map<
      PushDeviceType,
      Array<{ token: string; name: string }>
    > = await readMasterAdminDevices();

    const message: PushNotificationMessage =
      PushNotificationUtil.createGenericNotification({
        title: data.title,
        body: data.body,
        clickAction: "/admin",
        tag: data.tag,
        requireInteraction: false,
      });

    const results: Array<PromiseSettledResult<void>> = await Promise.allSettled(
      Array.from(byType.entries()).map(
        ([deviceType, devices]: [
          PushDeviceType,
          Array<{ token: string; name: string }>,
        ]): Promise<void> => {
          return PushNotificationService.sendPushNotification(
            { devices, message, deviceType },
            { isSensitive: false },
          );
        },
      ),
    );

    return results.some((result: PromiseSettledResult<void>): boolean => {
      return result.status === "fulfilled";
    });
  },
  sms: async (data: { to: Phone; text: string }): Promise<boolean> => {
    return isAccepted(
      await SmsService.sendSms(
        { to: data.to, message: data.text },
        { isSensitive: false, failIfNotSent: true },
      ),
    );
  },
  email: async (data: {
    to: Email;
    title: string;
    body: string;
  }): Promise<boolean> => {
    return isAccepted(
      await MailService.sendMail({
        toEmail: data.to,
        subject: data.title,
        isSubjectLiteral: true,
        templateType: EmailTemplateType.SimpleMessage,
        vars: { subject: data.title, message: data.body },
      }),
    );
  },
};

const sendThrough: (data: {
  channel: ServerAlertChannel;
  message: ServerAlertMessage;
  text: { title: string; body: string };
  settings: ServerAlertSettings;
  senders: ServerAlertSenders;
}) => Promise<boolean> = async (data: {
  channel: ServerAlertChannel;
  message: ServerAlertMessage;
  text: { title: string; body: string };
  settings: ServerAlertSettings;
  senders: ServerAlertSenders;
}): Promise<boolean> => {
  switch (data.channel) {
    case ServerAlertChannel.Push:
      return await data.senders.push({
        title: data.text.title,
        body: data.text.body,
        tag: `server-alert-${data.message.subject}`,
      });
    case ServerAlertChannel.SMS:
      return data.settings.smsNumber
        ? await data.senders.sms({
            to: new Phone(data.settings.smsNumber),
            text: data.text.body,
          })
        : false;
    case ServerAlertChannel.Email:
      return data.settings.adminNotificationEmail
        ? await data.senders.email({
            to: new Email(data.settings.adminNotificationEmail),
            title: data.text.title,
            body: data.text.body,
          })
        : false;
  }

  return false;
};

export const tellMasterAdmins: (options?: {
  now?: Date;
  senders?: ServerAlertSenders;
}) => Promise<void> = async (options?: {
  now?: Date;
  senders?: ServerAlertSenders;
}): Promise<void> => {
  const now: Date = options?.now || new Date();
  const senders: ServerAlertSenders = options?.senders || SERVER_ALERT_SENDERS;

  const config: GlobalConfig | null = await GlobalConfigService.findOneById({
    id: ObjectID.getZeroObjectID(),
    select: {
      serverAlertPhoneNumber: true,
      isServerAlertPushOn: true,
      serverAlertState: true,
      adminNotificationEmail: true,
    },
    props: { isRoot: true },
  });

  const settings: ServerAlertSettings = getServerAlertSettings({
    smsNumber: config?.serverAlertPhoneNumber?.toString() || null,
    isPushOn: config?.isServerAlertPushOn ?? null,
    adminNotificationEmail: config?.adminNotificationEmail?.toString() || null,
    isBillingEnabled: IsBillingEnabled,
  });

  const answer: ServerSendingStatusAnswer =
    await ServerSendingStatus.getAnswer();

  const plan: ServerAlertPlan = ServerAlertsUtil.plan({
    answer: answer,
    state: ServerAlertsUtil.readState(config?.serverAlertState),
    settings: settings,
    now: now,
  });

  let state: ServerAlertState = plan.state;
  let hasStateChanged: boolean = plan.hasStateChanged;

  for (const message of plan.messages) {
    const text: { title: string; body: string } = ServerAlertsUtil.getText({
      message: message,
      serverName: Host || "OneUptime",
      probes: answer.globalProbes,
    });

    const sentThrough: Array<ServerAlertChannel> = [];

    for (const channel of message.channels) {
      try {
        if (await sendThrough({ channel, message, text, settings, senders })) {
          sentThrough.push(channel);
        }
      } catch (err) {
        logger.warn(
          `Could not tell master admins by ${channel} that ${message.subject} is ${message.condition}.`,
        );
        logger.warn(err);
      }
    }

    if (sentThrough.length === 0) {
      logger.warn(
        `Master admins could not be told that ${message.subject} is ${message.condition}: no channel took the message. It is tried again within the hour.`,
      );
    }

    state = ServerAlertsUtil.afterSending({
      state: state,
      message: message,
      sentThrough: sentThrough,
      now: now,
    });
    hasStateChanged = true;
  }

  if (!hasStateChanged) {
    return;
  }

  /*
   * Set by name, as GlobalConfigService sets its other JSON columns: a JSON
   * value spelled out in a PartialEntity is a type too deep to check.
   */
  const update: PartialEntity<GlobalConfig> = {};

  (update as Record<string, unknown>)["serverAlertState"] =
    ServerAlertsUtil.toJSON(state);

  await GlobalConfigService.updateOneById({
    id: ObjectID.getZeroObjectID(),
    data: update,
    props: { isRoot: true },
  });
};

RunCron(
  SERVER_ALERTS_JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES * 60 * 1000,
  },
  async () => {
    await runWithInstanceHealthLease({
      jobName: SERVER_ALERTS_JOB_NAME,
      lockLabel: "server alerts",
      leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run: async (): Promise<void> => {
        await tellMasterAdmins();
      },
    });
  },
);
