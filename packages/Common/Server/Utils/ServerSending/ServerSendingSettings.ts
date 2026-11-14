import crypto from "crypto";
import { EncryptionSecret } from "../../EnvironmentConfig";
import {
  getServerEmailEnvironment,
  toServerEmailSettings,
} from "../ServerEmailSettings";
import { getServerTwilioEnvironment } from "../ServerTwilioConfig";
import { EmailServerType } from "../../../Models/DatabaseModels/GlobalConfig";
import CallAndSmsProviders, {
  CallAndSmsGateway,
} from "../../../Types/CallAndSMS/CallAndSmsProvider";
import { ServerTwilioEnvironmentReading } from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import TwilioConfigUses from "../../../Types/CallAndSMS/TwilioConfigUse";
import AmazonSesAuthenticationType from "../../../Types/Email/AmazonSesAuthenticationType";
import MailgunRegion from "../../../Types/Email/MailgunRegion";
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import {
  ServerEmailColumn,
  ServerEmailSettings,
} from "../../../Types/Email/ServerEmailEnvironment";
import {
  ServerSendingChannel,
  ServerSendingSettingsFingerprints,
} from "../../../Types/ServerSending/ServerSendingStatus";

/*
 * WHICH SETTINGS THE SERVER'S OWN SENDS GO THROUGH, AS FINGERPRINTS (#7736).
 *
 * What the server remembers of its own sends (GlobalConfig.
 * serverSendingHealth) was learned with the settings it sent with. Saving a
 * channel's settings in the Admin Dashboard forgets it (GlobalConfigService
 * .forgetServerSendingHealthOf). But SMS, calls and email can change
 * without a save: once GLOBAL_TWILIO_ACCOUNT_SID is set, the Twilio account
 * is the one the GLOBAL_TWILIO_ environment variables describe (#7515), and
 * once GLOBAL_EMAIL_SERVER_TYPE is set, the email settings are the ones the
 * GLOBAL_EMAIL_ variables describe (#7738). They change when the variables
 * do and OneUptime restarts. A fixed auth token or SMTP password would
 * otherwise go on showing as "failing since..." until the next message
 * happened to go out, and settings nobody has tried as working.
 *
 * So an SMS, call or email entry is marked with a fingerprint of the
 * settings it was learned with, and one learned with others is read as
 * untested (ServerSendingStatusUtil.getCurrentEntry).
 *
 * For SMS and calls, the settings are the route they take, read as the
 * senders take it: the gateway when one is chosen and has an address, which
 * carries both kinds of message whatever the variables say
 * (ServerChannelSetup.getTwilioSetUpProblem); else the account the
 * variables set, once GLOBAL_TWILIO_ACCOUNT_SID is; else the saved account.
 *
 * For email (#7803), they are the settings the senders read
 * (ServerEmailSettings.toServerEmailSettings): the variables' once
 * GLOBAL_EMAIL_SERVER_TYPE is set, else the saved ones - the Email Server
 * Type and every column of that type (SERVER_EMAIL_TYPE_COLUMNS), so
 * another password, host, port or from address is other settings.
 * Variables with something wrong send nothing, and ServerChannelSetup reads
 * them as not set up: they are settings of their own, never working ones.
 *
 * Entries written before there were fingerprints were learned with the
 * saved settings, the only ones there were: they count as the saved
 * settings' (`unmarked`), so an upgrade alone forgets nothing, and setting
 * the variables does.
 *
 * A fingerprint is an HMAC-SHA256 under the server's ENCRYPTION_SECRET of
 * the whole of the settings - an auth token, a gateway secret or a password
 * changed is other settings - so it says nothing of them to anyone without
 * the secret, and the same settings give another fingerprint on another
 * server. Push has none: its one setting changes only when it is saved.
 */

const FINGERPRINT_SCHEME: string = "server-sending-settings:v1";

// The columns of the Twilio account, as the row holds them and the variables give them.
interface TwilioAccountColumns {
  twilioUsedFor?: unknown;
  twilioAccountSID?: unknown;
  twilioAuthToken?: unknown;
  twilioPrimaryPhoneNumber?: unknown;
  twilioSecondaryPhoneNumbers?: unknown;
  twilioSmsPhoneNumbers?: unknown;
}

// What the fingerprints read of the settings row.
export interface ServerSendingSettingsRow
  extends TwilioAccountColumns,
    ServerEmailSettings {
  callAndSmsProvider?: unknown;
  callAndSmsGatewayUrl?: unknown;
  callAndSmsGatewaySecret?: unknown;
}

/*
 * The columns of SERVER_EMAIL_COLUMNS each Email Server Type sends with:
 * MailService sends through the one type picked (getEmailServerType), with
 * that type's columns only (Notification/Config). Another type's, left
 * from before, change nothing that is sent.
 */
export const SERVER_EMAIL_TYPE_COLUMNS: Readonly<
  Record<EmailServerType, ReadonlyArray<ServerEmailColumn>>
> = {
  [EmailServerType.CustomSMTP]: [
    "smtpTransportType",
    "smtpHost",
    "smtpPort",
    "isSMTPSecure",
    "smtpAuthType",
    "smtpUsername",
    "smtpPassword",
    "smtpOAuthProviderType",
    "smtpClientId",
    "smtpClientSecret",
    "smtpTokenUrl",
    "smtpScope",
    "smtpFromEmail",
    "smtpFromName",
  ],
  [EmailServerType.Sendgrid]: [
    "sendgridApiKey",
    "sendgridFromEmail",
    "sendgridFromName",
  ],
  [EmailServerType.AmazonSES]: [
    "amazonSesAuthenticationType",
    "amazonSesAccessKeyId",
    "amazonSesSecretAccessKey",
    "amazonSesRegion",
    "amazonSesFromEmail",
    "amazonSesFromName",
  ],
  [EmailServerType.Mailgun]: [
    "mailgunApiKey",
    "mailgunDomain",
    "mailgunRegion",
    "mailgunFromEmail",
    "mailgunFromName",
  ],
  [EmailServerType.Postmark]: [
    "postmarkServerToken",
    "postmarkFromEmail",
    "postmarkFromName",
  ],
  [EmailServerType.Resend]: [
    "resendApiKey",
    "resendFromEmail",
    "resendFromName",
  ],
};

/*
 * A choice left empty, as the senders read it: the one they send with
 * instead. The variables always name one, a saved row may not.
 */
const EMAIL_CHOICE_DEFAULTS: Readonly<
  Partial<Record<ServerEmailColumn, string>>
> = {
  smtpTransportType: MailTransportType.SMTP,
  isSMTPSecure: "false",
  smtpAuthType: SMTPAuthenticationType.UsernamePassword,
  smtpOAuthProviderType: OAuthProviderType.ClientCredentials,
  amazonSesAuthenticationType: AmazonSesAuthenticationType.AccessKey,
  mailgunRegion: MailgunRegion.US,
};

// The email settings variables with something wrong give: they send nothing.
const EMAIL_SETTINGS_THAT_SEND_NOTHING: ReadonlyArray<string> = [
  "email",
  "sends-nothing",
];

// A value as text: a phone number by its number, nothing as nothing.
const asText: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

/*
 * An email setting as the senders are handed it: an address, a host or a
 * port by its text, nothing as nothing. Never trimmed - a mail server is
 * handed a saved password as it was saved - while the variables come
 * without the whitespace around them (ServerEmailEnvironment.read).
 */
const asWritten: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

// A comma-separated list of numbers, however it was spaced.
const asList: (value: unknown) => string = (value: unknown): string => {
  return asText(value)
    .split(",")
    .map((item: string) => {
      return item.trim();
    })
    .filter((item: string) => {
      return item.length > 0;
    })
    .join(",");
};

export default class ServerSendingSettings {
  // The channels whose settings can change without a save, and so carry fingerprints.
  public static hasFingerprints(channel: ServerSendingChannel): boolean {
    return (
      channel === ServerSendingChannel.Email ||
      channel === ServerSendingChannel.SMS ||
      channel === ServerSendingChannel.Call
    );
  }

  /*
   * The fingerprints of the settings a channel sends with now, or null for a
   * channel without them. Never throws: a row it cannot read is described
   * by what it holds.
   */
  public static getFingerprints(
    channel: ServerSendingChannel,
    row: ServerSendingSettingsRow | null | undefined,
  ): ServerSendingSettingsFingerprints | null {
    if (!ServerSendingSettings.hasFingerprints(channel)) {
      return null;
    }

    if (channel === ServerSendingChannel.Email) {
      return ServerSendingSettings.getEmailFingerprints(row);
    }

    const saved: Array<string> = ServerSendingSettings.describeRoute(row, null);

    const environment: ServerTwilioEnvironmentReading =
      getServerTwilioEnvironment();

    const current: Array<string> = environment.isSet
      ? ServerSendingSettings.describeRoute(row, environment.account || {})
      : saved;

    return {
      current: ServerSendingSettings.fingerprint(current),
      unmarked: ServerSendingSettings.fingerprint(saved),
    };
  }

  /*
   * The route SMS and calls take, as a list of texts: the gateway when one
   * is chosen with an address, else the Twilio account - the one the
   * variables give, or the saved one when they give none. The same account
   * reads the same wherever it was set, so variables that repeat the saved
   * account keep what was learned with it.
   */
  public static describeRoute(
    row: ServerSendingSettingsRow | null | undefined,
    environmentAccount: TwilioAccountColumns | null,
  ): Array<string> {
    const gateway: CallAndSmsGateway | null = row
      ? CallAndSmsProviders.getGateway(row)
      : null;

    if (gateway) {
      return ["gateway", gateway.url, gateway.secret];
    }

    const account: TwilioAccountColumns = environmentAccount || row || {};

    return [
      "twilio",
      asText(account.twilioAccountSID),
      asText(account.twilioAuthToken),
      TwilioConfigUses.getUse(account.twilioUsedFor),
      asText(account.twilioPrimaryPhoneNumber),
      asList(account.twilioSecondaryPhoneNumbers),
      asList(account.twilioSmsPhoneNumbers),
    ];
  }

  /*
   * Email's: the settings the senders read now - the variables' once
   * GLOBAL_EMAIL_SERVER_TYPE is set, none while something is wrong with
   * them, else the saved row's - and the saved row's as `unmarked`. No row
   * is nothing set up, as an empty one is: never settings that send
   * nothing, which only the variables can give.
   */
  private static getEmailFingerprints(
    row: ServerSendingSettingsRow | null | undefined,
  ): ServerSendingSettingsFingerprints {
    const savedRow: ServerSendingSettingsRow = row || {};

    return {
      current: ServerSendingSettings.fingerprint(
        ServerSendingSettings.describeEmailSettings(
          toServerEmailSettings(savedRow, getServerEmailEnvironment()),
        ),
      ),
      unmarked: ServerSendingSettings.fingerprint(
        ServerSendingSettings.describeEmailSettings(savedRow),
      ),
    };
  }

  /*
   * Email settings as a list of texts: the Email Server Type - Custom SMTP
   * when none is picked, as MailService reads it - and each column that
   * type sends with, a choice left empty as the one the senders take for
   * it. Null is settings that send nothing. The same settings read the same
   * wherever they were set, so variables that repeat the saved settings
   * keep what was learned with them.
   */
  public static describeEmailSettings(
    settings: ServerEmailSettings | null,
  ): Array<string> {
    if (!settings) {
      return [...EMAIL_SETTINGS_THAT_SEND_NOTHING];
    }

    const serverType: string =
      asWritten(settings.emailServerType) || EmailServerType.CustomSMTP;

    // A type that is not one is read with Custom SMTP's columns, as ServerChannelSetup reads it.
    const columns: ReadonlyArray<ServerEmailColumn> =
      SERVER_EMAIL_TYPE_COLUMNS[
        (Object.values(EmailServerType) as Array<string>).includes(serverType)
          ? (serverType as EmailServerType)
          : EmailServerType.CustomSMTP
      ];

    return [
      "email",
      serverType,
      ...columns.map((column: ServerEmailColumn): string => {
        return (
          asWritten(settings[column]) || EMAIL_CHOICE_DEFAULTS[column] || ""
        );
      }),
    ];
  }

  // A keyed hash of settings: each part length-prefixed, so no two settings read alike.
  public static fingerprint(settings: Array<string>): string {
    const message: string = [FINGERPRINT_SCHEME, ...settings]
      .map((part: string) => {
        return `${part.length}:${part}`;
      })
      .join("");

    return crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(message)
      .digest("hex");
  }
}
