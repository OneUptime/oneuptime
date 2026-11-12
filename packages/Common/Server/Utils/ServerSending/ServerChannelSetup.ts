import Select from "../../Types/Database/Select";
import { toServerTwilioConfig } from "../ServerTwilioConfig";
import {
  GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,
  GLOBAL_TWILIO_CONFIG_SELECT,
} from "../TwilioConfigSelect";
import GlobalConfig, {
  EmailServerType,
} from "../../../Models/DatabaseModels/GlobalConfig";
import CallAndSmsProviders from "../../../Types/CallAndSMS/CallAndSmsProvider";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import TwilioPhoneNumbers from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import { isAwsRegion } from "../../../Types/Cloud/AwsRegionCode";
import AmazonSesAuthenticationType, {
  toAmazonSesAuthenticationType,
} from "../../../Types/Email/AmazonSesAuthenticationType";
import { isMailgunDomain } from "../../../Types/Email/MailgunDomain";
import MailTransportType from "../../../Types/Email/MailTransportType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import { ServerSendingChannel } from "../../../Types/ServerSending/ServerSendingStatus";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";

/*
 * WHETHER THE SERVER'S OWN SETTINGS LET IT SEND, PER CHANNEL.
 *
 * Read from the GlobalConfig row exactly as the Notification service reads
 * it when it sends (Notification/Config: getEmailServerType,
 * getGlobalSMTPConfig, getSendgridConfig, getGlobalEmailProviderServer,
 * getTwilioConfig, getCallAndSmsGateway), so "set up" here means a send
 * would get as far as the mail service, the gateway or Twilio, and "not set
 * up" means it would be refused for a setting left blank. A test holds the
 * two to the same answer for the same row (ServerChannelSetupAgreesWithSender).
 *
 * Each answer is null when the channel is set up, or what its settings are
 * missing, for the server's admin (who reads it in the Admin Dashboard):
 * never a value, a password or a key.
 */

// Every column the four answers read, and nothing else.
export const SERVER_CHANNEL_SETUP_SELECT: Select<GlobalConfig> = {
  emailServerType: true,
  smtpTransportType: true,
  smtpAuthType: true,
  smtpHost: true,
  smtpPort: true,
  smtpUsername: true,
  smtpPassword: true,
  smtpFromEmail: true,
  smtpFromName: true,
  smtpClientId: true,
  smtpClientSecret: true,
  smtpTokenUrl: true,
  smtpScope: true,
  sendgridApiKey: true,
  sendgridFromEmail: true,
  sendgridFromName: true,
  amazonSesAuthenticationType: true,
  amazonSesAccessKeyId: true,
  amazonSesSecretAccessKey: true,
  amazonSesRegion: true,
  amazonSesFromEmail: true,
  mailgunApiKey: true,
  mailgunDomain: true,
  mailgunFromEmail: true,
  postmarkServerToken: true,
  postmarkFromEmail: true,
  resendApiKey: true,
  resendFromEmail: true,
  ...GLOBAL_TWILIO_CONFIG_SELECT,
  ...GLOBAL_CALL_AND_SMS_GATEWAY_SELECT,
  disablePushNotifications: true,
};

/*
 * The settings each channel sends with: a write to any of them starts the
 * channel again at untested (ServerSendingStatus.forgetChannels), since
 * what it remembers was learned with other settings.
 */
export const SERVER_CHANNEL_SETTING_COLUMNS: Readonly<
  Record<ServerSendingChannel, ReadonlyArray<keyof GlobalConfig>>
> = {
  [ServerSendingChannel.Email]: [
    "emailServerType",
    "isSMTPSecure",
    "smtpTransportType",
    "smtpAuthType",
    "smtpHost",
    "smtpPort",
    "smtpUsername",
    "smtpPassword",
    "smtpFromEmail",
    "smtpFromName",
    "smtpClientId",
    "smtpClientSecret",
    "smtpTokenUrl",
    "smtpScope",
    "smtpOAuthProviderType",
    "sendgridApiKey",
    "sendgridFromEmail",
    "sendgridFromName",
    "amazonSesAuthenticationType",
    "amazonSesAccessKeyId",
    "amazonSesSecretAccessKey",
    "amazonSesRegion",
    "amazonSesFromEmail",
    "amazonSesFromName",
    "mailgunApiKey",
    "mailgunDomain",
    "mailgunRegion",
    "mailgunFromEmail",
    "mailgunFromName",
    "postmarkServerToken",
    "postmarkFromEmail",
    "postmarkFromName",
    "resendApiKey",
    "resendFromEmail",
    "resendFromName",
  ],
  [ServerSendingChannel.SMS]: [
    "twilioAccountSID",
    "twilioAuthToken",
    "twilioPrimaryPhoneNumber",
    "twilioSecondaryPhoneNumbers",
    "twilioSmsPhoneNumbers",
    "twilioUsedFor",
    "callAndSmsProvider",
    "callAndSmsGatewayUrl",
    "callAndSmsGatewaySecret",
  ],
  [ServerSendingChannel.Call]: [
    "twilioAccountSID",
    "twilioAuthToken",
    "twilioPrimaryPhoneNumber",
    "twilioSecondaryPhoneNumbers",
    "twilioSmsPhoneNumbers",
    "twilioUsedFor",
    "callAndSmsProvider",
    "callAndSmsGatewayUrl",
    "callAndSmsGatewaySecret",
  ],
  [ServerSendingChannel.Push]: ["disablePushNotifications"],
};

// The words a setting left blank is named in.
export const EMAIL_NOT_SET_UP_PROBLEM: string =
  "Nothing is set up under Settings > Emails yet.";

export const SMS_NOT_SET_UP_PROBLEM: string =
  "No Twilio account or SMS gateway is set up under Settings > Call and SMS.";

export const CALL_NOT_SET_UP_PROBLEM: string =
  "No Twilio account or call gateway is set up under Settings > Call and SMS.";

export const PUSH_TURNED_OFF_PROBLEM: string =
  "Push notifications are turned off under Settings > Push Notifications.";

// The provider's name, as the Email settings page shows it.
const notSet: (provider: string, field: string) => string = (
  provider: string,
  field: string,
): string => {
  return `${provider}: the ${field} is not set under Settings > Emails.`;
};

// Set as Notification/Config reads a Custom SMTP or SendGrid setting: any value.
const isPresent: (value: unknown) => boolean = (value: unknown): boolean => {
  return Boolean(value);
};

// Set as Notification/Config reads a provider's setting: trimmed, not empty.
const text: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

export type ServerChannelSetupSettings = Partial<
  Pick<
    GlobalConfig,
    | "emailServerType"
    | "smtpTransportType"
    | "smtpAuthType"
    | "smtpHost"
    | "smtpPort"
    | "smtpUsername"
    | "smtpPassword"
    | "smtpFromEmail"
    | "smtpFromName"
    | "smtpClientId"
    | "smtpClientSecret"
    | "smtpTokenUrl"
    | "smtpScope"
    | "sendgridApiKey"
    | "sendgridFromEmail"
    | "sendgridFromName"
    | "amazonSesAuthenticationType"
    | "amazonSesAccessKeyId"
    | "amazonSesSecretAccessKey"
    | "amazonSesRegion"
    | "amazonSesFromEmail"
    | "mailgunApiKey"
    | "mailgunDomain"
    | "mailgunFromEmail"
    | "postmarkServerToken"
    | "postmarkFromEmail"
    | "resendApiKey"
    | "resendFromEmail"
    | "twilioUsedFor"
    | "twilioAccountSID"
    | "twilioAuthToken"
    | "twilioPrimaryPhoneNumber"
    | "twilioSecondaryPhoneNumbers"
    | "twilioSmsPhoneNumbers"
    | "callAndSmsProvider"
    | "callAndSmsGatewayUrl"
    | "callAndSmsGatewaySecret"
    | "disablePushNotifications"
  >
>;

export default class ServerChannelSetup {
  /*
   * What the server's email settings are missing, or null when an email
   * would be handed to the mail server or provider they name - as
   * MailService picks it: the Email Server Type, Custom SMTP when none is
   * picked.
   */
  public static getEmailSetUpProblem(
    config: ServerChannelSetupSettings | null | undefined,
  ): string | null {
    if (!config) {
      return EMAIL_NOT_SET_UP_PROBLEM;
    }

    switch (config.emailServerType || EmailServerType.CustomSMTP) {
      case EmailServerType.Sendgrid:
        return ServerChannelSetup.getSendgridProblem(config);
      case EmailServerType.AmazonSES:
        return ServerChannelSetup.getAmazonSesProblem(config);
      case EmailServerType.Mailgun:
        return ServerChannelSetup.getMailgunProblem(config);
      case EmailServerType.Postmark:
        return ServerChannelSetup.getApiKeyProviderProblem({
          provider: "Postmark",
          keyName: "Server API Token",
          key: config.postmarkServerToken,
          fromEmail: config.postmarkFromEmail,
        });
      case EmailServerType.Resend:
        return ServerChannelSetup.getApiKeyProviderProblem({
          provider: "Resend",
          keyName: "API Key",
          key: config.resendApiKey,
          fromEmail: config.resendFromEmail,
        });
      default:
        return ServerChannelSetup.getCustomSmtpProblem(config);
    }
  }

  // getSendgridConfig: all three, or no SendGrid at all.
  private static getSendgridProblem(
    config: ServerChannelSetupSettings,
  ): string | null {
    if (!isPresent(config.sendgridApiKey)) {
      return notSet("SendGrid", "API Key");
    }

    if (!isPresent(config.sendgridFromEmail)) {
      return notSet("SendGrid", "From Email");
    }

    if (!isPresent(config.sendgridFromName)) {
      return notSet("SendGrid", "From Name");
    }

    return null;
  }

  /*
   * getGlobalEmailProviderServer, Amazon SES: an access key, unless it
   * signs in with the server's IAM role, which needs none (#7000). Whether
   * the server has a role at all is known only by asking AWS: the test
   * email asks.
   */
  private static getAmazonSesProblem(
    config: ServerChannelSetupSettings,
  ): string | null {
    const usesServerIamRole: boolean =
      toAmazonSesAuthenticationType(config.amazonSesAuthenticationType) ===
      AmazonSesAuthenticationType.ServerIamRole;

    if (!usesServerIamRole && !text(config.amazonSesAccessKeyId)) {
      return notSet("Amazon SES", "Access Key ID");
    }

    if (!usesServerIamRole && !text(config.amazonSesSecretAccessKey)) {
      return notSet("Amazon SES", "Secret Access Key");
    }

    const region: string = text(config.amazonSesRegion).toLowerCase();

    if (!region || !isAwsRegion(region)) {
      return notSet(
        "Amazon SES",
        "Region (an AWS Region code, such as us-east-1)",
      );
    }

    if (!text(config.amazonSesFromEmail)) {
      return notSet("Amazon SES", "From Email");
    }

    return null;
  }

  // getGlobalEmailProviderServer, Mailgun.
  private static getMailgunProblem(
    config: ServerChannelSetupSettings,
  ): string | null {
    if (!text(config.mailgunApiKey)) {
      return notSet("Mailgun", "API Key");
    }

    const domain: string = text(config.mailgunDomain).toLowerCase();

    if (!domain || !isMailgunDomain(domain)) {
      return notSet(
        "Mailgun",
        "Domain (the sending domain, such as mg.example.com)",
      );
    }

    if (!text(config.mailgunFromEmail)) {
      return notSet("Mailgun", "From Email");
    }

    return null;
  }

  // getGlobalEmailProviderServer, Postmark and Resend.
  private static getApiKeyProviderProblem(data: {
    provider: string;
    keyName: string;
    key: unknown;
    fromEmail: unknown;
  }): string | null {
    if (!text(data.key)) {
      return notSet(data.provider, data.keyName);
    }

    if (!text(data.fromEmail)) {
      return notSet(data.provider, "From Email");
    }

    return null;
  }

  /*
   * getGlobalSMTPConfig: an SMTP server, or Microsoft Graph when that is the
   * transport. Nothing filled in is no email at all; a field left blank of
   * what the transport and the sign-in it uses need refuses the email.
   */
  private static getCustomSmtpProblem(
    config: ServerChannelSetupSettings,
  ): string | null {
    const isMicrosoftGraph: boolean =
      config.smtpTransportType === MailTransportType.MicrosoftGraph;

    const provider: string = isMicrosoftGraph ? "Microsoft Graph" : "SMTP";

    const isAnythingSet: boolean = isMicrosoftGraph
      ? isPresent(config.smtpFromEmail) ||
        isPresent(config.smtpClientId) ||
        isPresent(config.smtpClientSecret) ||
        isPresent(config.smtpTokenUrl)
      : isPresent(config.smtpFromEmail) ||
        isPresent(config.smtpHost) ||
        isPresent(config.smtpPort) ||
        isPresent(config.smtpUsername) ||
        isPresent(config.smtpPassword) ||
        isPresent(config.smtpFromName);

    if (!isAnythingSet) {
      return EMAIL_NOT_SET_UP_PROBLEM;
    }

    const authType: SMTPAuthenticationType = isMicrosoftGraph
      ? SMTPAuthenticationType.OAuth
      : (config.smtpAuthType as SMTPAuthenticationType) ||
        SMTPAuthenticationType.UsernamePassword;

    if (!isPresent(config.smtpFromEmail)) {
      return notSet(provider, "From Email");
    }

    if (!isPresent(config.smtpFromName)) {
      return notSet(provider, "From Name");
    }

    if (!isMicrosoftGraph) {
      if (!isPresent(config.smtpHost)) {
        return notSet(provider, "Host");
      }

      if (!isPresent(config.smtpPort)) {
        return notSet(provider, "Port");
      }
    }

    if (authType === SMTPAuthenticationType.OAuth) {
      if (!isPresent(config.smtpClientId)) {
        return notSet(provider, "OAuth Client ID");
      }

      if (!isPresent(config.smtpClientSecret)) {
        return notSet(provider, "OAuth Client Secret");
      }

      if (!isPresent(config.smtpTokenUrl)) {
        return notSet(provider, "OAuth Token URL");
      }

      if (!isPresent(config.smtpScope)) {
        return notSet(provider, "OAuth Scope");
      }
    }

    return null;
  }

  /*
   * What the server's own SMS or calls are missing, or null when they would
   * go out: through its gateway, which carries both, or else through its
   * Twilio account when that is used for this kind of message
   * (TwilioAccountAvailability.isServerAccountSetUp reads it the same way).
   */
  public static getTwilioSetUpProblem(
    config: ServerChannelSetupSettings | null | undefined,
    kind: TwilioMessageKind,
  ): string | null {
    const notSetUp: string =
      kind === TwilioMessageKind.SMS
        ? SMS_NOT_SET_UP_PROBLEM
        : CALL_NOT_SET_UP_PROBLEM;

    if (!config) {
      return notSetUp;
    }

    if (CallAndSmsProviders.getGateway(config)) {
      return null;
    }

    let twilioConfig: TwilioConfig | null = null;

    try {
      twilioConfig = toServerTwilioConfig(config as GlobalConfig);
    } catch {
      /*
       * A list of numbers kept from before lists were checked, holding one
       * that is not a number: the account is there, and each message sent
       * through it says what is wrong with the list.
       */
      return null;
    }

    if (!twilioConfig) {
      return notSetUp;
    }

    return TwilioPhoneNumbers.getCannotSendReason(twilioConfig, kind);
  }

  /*
   * Push notifications need nothing set up - mobile pushes go through the
   * push relay - until a master admin turns them off for the server.
   */
  public static getPushSetUpProblem(
    config: ServerChannelSetupSettings | null | undefined,
  ): string | null {
    return config?.disablePushNotifications ? PUSH_TURNED_OFF_PROBLEM : null;
  }

  public static getSetUpProblem(
    channel: ServerSendingChannel,
    config: ServerChannelSetupSettings | null | undefined,
  ): string | null {
    switch (channel) {
      case ServerSendingChannel.Email:
        return ServerChannelSetup.getEmailSetUpProblem(config);
      case ServerSendingChannel.SMS:
        return ServerChannelSetup.getTwilioSetUpProblem(
          config,
          TwilioMessageKind.SMS,
        );
      case ServerSendingChannel.Call:
        return ServerChannelSetup.getTwilioSetUpProblem(
          config,
          TwilioMessageKind.Call,
        );
      case ServerSendingChannel.Push:
        return ServerChannelSetup.getPushSetUpProblem(config);
      default:
        return null;
    }
  }

  /*
   * The channels whose settings a GlobalConfig write changes: any of their
   * columns written, an explicit null included.
   */
  public static getChannelsWrittenBy(
    data: unknown,
  ): Array<ServerSendingChannel> {
    if (!data || typeof data !== "object") {
      return [];
    }

    const written: Record<string, unknown> = data as Record<string, unknown>;

    return (
      Object.keys(SERVER_CHANNEL_SETTING_COLUMNS) as Array<ServerSendingChannel>
    ).filter((channel: ServerSendingChannel): boolean => {
      return SERVER_CHANNEL_SETTING_COLUMNS[channel].some(
        (column: keyof GlobalConfig): boolean => {
          return written[column as string] !== undefined;
        },
      );
    });
  }
}
