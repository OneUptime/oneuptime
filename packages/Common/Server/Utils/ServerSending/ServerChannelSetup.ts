import Select from "../../Types/Database/Select";
import {
  getServerTwilioEnvironment,
  toServerTwilioConfig,
} from "../ServerTwilioConfig";
import { ServerTwilioEnvironmentReading } from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import {
  getServerEmailEnvironment,
  getServerEmailEnvironmentProblem,
  toServerEmailSettings,
} from "../ServerEmailSettings";
import { ServerEmailEnvironmentReading } from "../../../Types/Email/ServerEmailEnvironment";
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
import ServerSetUpProblem, {
  SERVER_EMAIL_SETTING_NAMES,
  SERVER_SET_UP_PROBLEMS,
  ServerSetUpProblemWords,
} from "../../../Types/ServerSending/ServerSetUpProblem";
import TwilioConfigUses from "../../../Types/CallAndSMS/TwilioConfigUse";
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

/*
 * Every column the four answers read, and the fingerprints of the settings
 * each channel sends with (ServerSendingSettings), and nothing else. Email's
 * fingerprint reads every column of its Email Server Type: one left out
 * here would go unseen, and settings that differ only in it would read as
 * the same.
 */
export const SERVER_CHANNEL_SETUP_SELECT: Select<GlobalConfig> = {
  emailServerType: true,
  isSMTPSecure: true,
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
  smtpOAuthProviderType: true,
  sendgridApiKey: true,
  sendgridFromEmail: true,
  sendgridFromName: true,
  amazonSesAuthenticationType: true,
  amazonSesAccessKeyId: true,
  amazonSesSecretAccessKey: true,
  amazonSesRegion: true,
  amazonSesFromEmail: true,
  amazonSesFromName: true,
  mailgunApiKey: true,
  mailgunDomain: true,
  mailgunRegion: true,
  mailgunFromEmail: true,
  mailgunFromName: true,
  postmarkServerToken: true,
  postmarkFromEmail: true,
  postmarkFromName: true,
  resendApiKey: true,
  resendFromEmail: true,
  resendFromName: true,
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

/*
 * The words a setting left blank is named in: sentences every language the
 * Admin Dashboard speaks has (Types/ServerSending/ServerSetUpProblem, #9437).
 */
export const EMAIL_NOT_SET_UP_PROBLEM: string =
  SERVER_SET_UP_PROBLEMS.emailNotSetUp;

export const SMS_NOT_SET_UP_PROBLEM: string =
  SERVER_SET_UP_PROBLEMS.smsNotSetUp;

export const CALL_NOT_SET_UP_PROBLEM: string =
  SERVER_SET_UP_PROBLEMS.callNotSetUp;

// Before what is wrong with the GLOBAL_TWILIO_ environment variables.
export const SERVER_TWILIO_ENVIRONMENT_PROBLEM: string =
  "The Twilio account set by environment variables cannot send:";

/*
 * Worded in every language the Admin Dashboard speaks: a test push answers
 * with it too (Types/ServerSetup/ServerTestSend).
 */
export const PUSH_TURNED_OFF_PROBLEM: string =
  SERVER_SET_UP_PROBLEMS.pushTurnedOff;

/*
 * What a channel's settings are missing: the English sentence the server
 * sends and logs, and - for a sentence of OneUptime's own - its words, for
 * a page to say in the reader's language. What is wrong with environment
 * variables, by the variables' names, has none: it is drawn as written.
 */
export interface ServerSetUpProblemReading {
  english: string;
  words: ServerSetUpProblemWords | null;
}

const inWords: (words: ServerSetUpProblemWords) => ServerSetUpProblemReading = (
  words: ServerSetUpProblemWords,
): ServerSetUpProblemReading => {
  return { english: ServerSetUpProblem.toEnglish(words), words: words };
};

const asWritten: (english: string) => ServerSetUpProblemReading = (
  english: string,
): ServerSetUpProblemReading => {
  return { english: english, words: null };
};

// The provider's name, as the Email settings page shows it, and the setting's.
const notSet: (provider: string, field: string) => ServerSetUpProblemReading = (
  provider: string,
  field: string,
): ServerSetUpProblemReading => {
  return inWords(ServerSetUpProblem.emailSettingNotSet(provider, field));
};

const NOTHING_SET_UP_FOR_EMAIL: ServerSetUpProblemReading = inWords(
  ServerSetUpProblem.of(SERVER_SET_UP_PROBLEMS.emailNotSetUp),
);

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
    row: ServerChannelSetupSettings | null | undefined,
  ): string | null {
    return ServerChannelSetup.readEmailSetUpProblem(row)?.english || null;
  }

  // The same, with its words for a page to say in the reader's language.
  public static readEmailSetUpProblem(
    row: ServerChannelSetupSettings | null | undefined,
  ): ServerSetUpProblemReading | null {
    /*
     * Settings the GLOBAL_EMAIL_ environment variables set (#7738) are fixed
     * where they are set, not under Settings > Emails: say what is wrong
     * with them, by the variable's name. With nothing wrong, they are what
     * an email is sent with, and are checked as the saved row would be.
     */
    const environment: ServerEmailEnvironmentReading =
      getServerEmailEnvironment();
    const environmentProblem: string | null =
      getServerEmailEnvironmentProblem(environment);

    if (environmentProblem) {
      return asWritten(environmentProblem);
    }

    const config: ServerChannelSetupSettings | null = toServerEmailSettings(
      row,
      environment,
    );

    if (!config) {
      return NOTHING_SET_UP_FOR_EMAIL;
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
          keyName: SERVER_EMAIL_SETTING_NAMES.serverApiToken,
          key: config.postmarkServerToken,
          fromEmail: config.postmarkFromEmail,
        });
      case EmailServerType.Resend:
        return ServerChannelSetup.getApiKeyProviderProblem({
          provider: "Resend",
          keyName: SERVER_EMAIL_SETTING_NAMES.apiKey,
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
  ): ServerSetUpProblemReading | null {
    if (!isPresent(config.sendgridApiKey)) {
      return notSet("SendGrid", SERVER_EMAIL_SETTING_NAMES.apiKey);
    }

    if (!isPresent(config.sendgridFromEmail)) {
      return notSet("SendGrid", SERVER_EMAIL_SETTING_NAMES.fromEmail);
    }

    if (!isPresent(config.sendgridFromName)) {
      return notSet("SendGrid", SERVER_EMAIL_SETTING_NAMES.fromName);
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
  ): ServerSetUpProblemReading | null {
    const usesServerIamRole: boolean =
      toAmazonSesAuthenticationType(config.amazonSesAuthenticationType) ===
      AmazonSesAuthenticationType.ServerIamRole;

    if (!usesServerIamRole && !text(config.amazonSesAccessKeyId)) {
      return notSet("Amazon SES", SERVER_EMAIL_SETTING_NAMES.accessKeyId);
    }

    if (!usesServerIamRole && !text(config.amazonSesSecretAccessKey)) {
      return notSet("Amazon SES", SERVER_EMAIL_SETTING_NAMES.secretAccessKey);
    }

    const region: string = text(config.amazonSesRegion).toLowerCase();

    if (!region || !isAwsRegion(region)) {
      return notSet("Amazon SES", SERVER_EMAIL_SETTING_NAMES.awsRegion);
    }

    if (!text(config.amazonSesFromEmail)) {
      return notSet("Amazon SES", SERVER_EMAIL_SETTING_NAMES.fromEmail);
    }

    return null;
  }

  // getGlobalEmailProviderServer, Mailgun.
  private static getMailgunProblem(
    config: ServerChannelSetupSettings,
  ): ServerSetUpProblemReading | null {
    if (!text(config.mailgunApiKey)) {
      return notSet("Mailgun", SERVER_EMAIL_SETTING_NAMES.apiKey);
    }

    const domain: string = text(config.mailgunDomain).toLowerCase();

    if (!domain || !isMailgunDomain(domain)) {
      return notSet("Mailgun", SERVER_EMAIL_SETTING_NAMES.mailgunDomain);
    }

    if (!text(config.mailgunFromEmail)) {
      return notSet("Mailgun", SERVER_EMAIL_SETTING_NAMES.fromEmail);
    }

    return null;
  }

  // getGlobalEmailProviderServer, Postmark and Resend.
  private static getApiKeyProviderProblem(data: {
    provider: string;
    keyName: string;
    key: unknown;
    fromEmail: unknown;
  }): ServerSetUpProblemReading | null {
    if (!text(data.key)) {
      return notSet(data.provider, data.keyName);
    }

    if (!text(data.fromEmail)) {
      return notSet(data.provider, SERVER_EMAIL_SETTING_NAMES.fromEmail);
    }

    return null;
  }

  /*
   * getGlobalSMTPConfig: an SMTP server, or Microsoft Graph when that is the
   * transport. Nothing filled in is no email at all; a field left blank of
   * what the transport and the sign-in it uses need refuses the email.
   *
   * A port alone is nothing filled in (#7458): an installation's settings
   * were seeded with port 25 when SMTP_PORT was not set
   * (UpdateGlobalConfigFromEnv), so a server nobody had touched read as
   * half set up, and its first missing field - the From Email - was named
   * as if the rest were done. A port is only ever one of the fields still
   * missing once something else is set.
   */
  private static getCustomSmtpProblem(
    config: ServerChannelSetupSettings,
  ): ServerSetUpProblemReading | null {
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
        isPresent(config.smtpUsername) ||
        isPresent(config.smtpPassword) ||
        isPresent(config.smtpFromName);

    if (!isAnythingSet) {
      return NOTHING_SET_UP_FOR_EMAIL;
    }

    const authType: SMTPAuthenticationType = isMicrosoftGraph
      ? SMTPAuthenticationType.OAuth
      : (config.smtpAuthType as SMTPAuthenticationType) ||
        SMTPAuthenticationType.UsernamePassword;

    if (!isPresent(config.smtpFromEmail)) {
      return notSet(provider, SERVER_EMAIL_SETTING_NAMES.fromEmail);
    }

    if (!isPresent(config.smtpFromName)) {
      return notSet(provider, SERVER_EMAIL_SETTING_NAMES.fromName);
    }

    if (!isMicrosoftGraph) {
      if (!isPresent(config.smtpHost)) {
        return notSet(provider, SERVER_EMAIL_SETTING_NAMES.host);
      }

      if (!isPresent(config.smtpPort)) {
        return notSet(provider, SERVER_EMAIL_SETTING_NAMES.port);
      }
    }

    if (authType === SMTPAuthenticationType.OAuth) {
      /*
       * Over SMTP, OAuth signs in as a mailbox, which the sender refuses
       * every email without (#7833). Microsoft Graph sends as the From
       * Email, and needs none.
       */
      if (!isMicrosoftGraph && !isPresent(config.smtpUsername)) {
        return notSet(provider, SERVER_EMAIL_SETTING_NAMES.username);
      }

      if (!isPresent(config.smtpClientId)) {
        return notSet(provider, SERVER_EMAIL_SETTING_NAMES.oauthClientId);
      }

      if (!isPresent(config.smtpClientSecret)) {
        return notSet(provider, SERVER_EMAIL_SETTING_NAMES.oauthClientSecret);
      }

      if (!isPresent(config.smtpTokenUrl)) {
        return notSet(provider, SERVER_EMAIL_SETTING_NAMES.oauthTokenUrl);
      }

      if (!isPresent(config.smtpScope)) {
        return notSet(provider, SERVER_EMAIL_SETTING_NAMES.oauthScope);
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
    return (
      ServerChannelSetup.readTwilioSetUpProblem(config, kind)?.english || null
    );
  }

  // The same, with its words for a page to say in the reader's language.
  public static readTwilioSetUpProblem(
    config: ServerChannelSetupSettings | null | undefined,
    kind: TwilioMessageKind,
  ): ServerSetUpProblemReading | null {
    const notSetUp: ServerSetUpProblemReading = inWords(
      ServerSetUpProblem.of(
        kind === TwilioMessageKind.SMS
          ? SERVER_SET_UP_PROBLEMS.smsNotSetUp
          : SERVER_SET_UP_PROBLEMS.callNotSetUp,
      ),
    );

    if (!config) {
      return notSetUp;
    }

    if (CallAndSmsProviders.getGateway(config)) {
      return null;
    }

    /*
     * An account the GLOBAL_TWILIO_ environment variables set (#7515) is
     * fixed where they are set, not under Settings > Call and SMS: say what
     * is wrong with them, by the variable's name.
     */
    const environment: ServerTwilioEnvironmentReading =
      getServerTwilioEnvironment();

    if (environment.isSet && environment.problems.length > 0) {
      return asWritten(
        `${SERVER_TWILIO_ENVIRONMENT_PROBLEM} ${environment.problems.join(" ")}`,
      );
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

    return ServerChannelSetup.readTwilioCannotSend(twilioConfig, kind);
  }

  /*
   * Why the server's Twilio account sends no message of this kind, as
   * TwilioPhoneNumbers.getCannotSendReason says it, in its words: used for
   * the other kind only, or with no number to send it from.
   */
  private static readTwilioCannotSend(
    config: TwilioConfig,
    kind: TwilioMessageKind,
  ): ServerSetUpProblemReading | null {
    const english: string | null = TwilioPhoneNumbers.getCannotSendReason(
      config,
      kind,
    );

    if (!english) {
      return null;
    }

    const isSms: boolean = kind === TwilioMessageKind.SMS;
    const isUsedForIt: boolean = isSms
      ? TwilioConfigUses.sendsSms(config.use)
      : TwilioConfigUses.makesCalls(config.use);

    const template: string = !isUsedForIt
      ? isSms
        ? SERVER_SET_UP_PROBLEMS.twilioUsedForCallsOnly
        : SERVER_SET_UP_PROBLEMS.twilioUsedForSmsOnly
      : isSms
        ? SERVER_SET_UP_PROBLEMS.twilioHasNoSmsNumber
        : SERVER_SET_UP_PROBLEMS.twilioHasNoCallNumber;

    /*
     * The words say what the reason says, or there are none: a reason
     * worded otherwise is drawn as written, never as another sentence.
     */
    return english === template
      ? inWords(ServerSetUpProblem.of(template))
      : asWritten(english);
  }

  /*
   * Push notifications need nothing set up - mobile pushes go through the
   * push relay - until a master admin turns them off for the server.
   */
  public static getPushSetUpProblem(
    config: ServerChannelSetupSettings | null | undefined,
  ): string | null {
    return ServerChannelSetup.readPushSetUpProblem(config)?.english || null;
  }

  public static readPushSetUpProblem(
    config: ServerChannelSetupSettings | null | undefined,
  ): ServerSetUpProblemReading | null {
    return config?.disablePushNotifications
      ? inWords(ServerSetUpProblem.of(SERVER_SET_UP_PROBLEMS.pushTurnedOff))
      : null;
  }

  public static getSetUpProblem(
    channel: ServerSendingChannel,
    config: ServerChannelSetupSettings | null | undefined,
  ): string | null {
    return (
      ServerChannelSetup.readSetUpProblem(channel, config)?.english || null
    );
  }

  /*
   * What a channel's settings are missing, in English and - for a sentence
   * of OneUptime's own - in words a page says in the reader's language.
   */
  public static readSetUpProblem(
    channel: ServerSendingChannel,
    config: ServerChannelSetupSettings | null | undefined,
  ): ServerSetUpProblemReading | null {
    switch (channel) {
      case ServerSendingChannel.Email:
        return ServerChannelSetup.readEmailSetUpProblem(config);
      case ServerSendingChannel.SMS:
        return ServerChannelSetup.readTwilioSetUpProblem(
          config,
          TwilioMessageKind.SMS,
        );
      case ServerSendingChannel.Call:
        return ServerChannelSetup.readTwilioSetUpProblem(
          config,
          TwilioMessageKind.Call,
        );
      case ServerSendingChannel.Push:
        return ServerChannelSetup.readPushSetUpProblem(config);
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
