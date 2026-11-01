import GlobalConfigModel from "../../Models/DatabaseModels/DatabaseBaseModel/GlobalConfig";
import Hostname from "../../Types/API/Hostname";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import Email from "../../Types/Email";
import MailTransportType from "../../Types/Email/MailTransportType";
import OAuthProviderType from "../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../Types/Email/SMTPAuthenticationType";
import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import Port from "../../Types/Port";
import {
  DEFAULT_TWILIO_CONFIG_USE,
  TwilioConfigUse,
} from "../../Types/CallAndSMS/TwilioConfigUse";
import {
  CallAndSmsProvider,
  DEFAULT_CALL_AND_SMS_PROVIDER,
} from "../../Types/CallAndSMS/CallAndSmsProvider";
import { Column, Entity } from "typeorm";

export enum EmailServerType {
  Sendgrid = "Sendgrid",
  CustomSMTP = "Custom SMTP",
}

@TableMetadata({
  tableName: "GlobalConfig",
  singularName: "Global Config",
  pluralName: "Global Configs",
  icon: IconProp.Settings,
  tableDescription: "Settings for OneUptime Server",
})
@Entity({
  name: "GlobalConfig",
})
@CrudApiEndpoint(new Route("/global-config"))
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
export default class GlobalConfig extends GlobalConfigModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Instance ID",
    description:
      "Unique identifier for this OneUptime instance. Auto-generated when the instance is installed.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    unique: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public instanceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Disable Signup",
    description: "Should we disable new user sign up to this server?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
    unique: true,
  })
  public disableSignup?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Require SSO for Login",
    description:
      "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt so they can always recover from a misconfigured SSO. A project's own SSO settings still apply on top of this.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public requireSsoForLogin?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Disable User Project Creation",
    description: "Only master admins can create projects when enabled.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
    unique: true,
  })
  public disableUserProjectCreation?: boolean = undefined;

  /*
   * Push notifications for the whole server: when on, nothing is sent to a
   * phone or browser through OneUptime's apps - through Expo, the push
   * relay, or a browser's push service - and no device can be registered
   * for them. For installations whose rules let nothing leave through
   * those services: they reach people through a custom channel instead
   * (CustomNotificationChannel). A push not sent says why on the person's
   * on-call log (PushNotificationService).
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Disable Push Notifications",
    description:
      "When enabled, OneUptime sends no push notifications to phones or browsers, and no device can be registered for them.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public disablePushNotifications?: boolean = undefined;

  // SMTP Settings.

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Is SMTP Secure",
    description: "Is this SMTP server hosted with SSL/TLS?",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    unique: true,
  })
  public isSMTPSecure?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "SMTP Username",
    description: "Username for your SMTP Server",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: true,
  })
  public smtpUsername?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP Password",
    description: "Password for your SMTP Server",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public smtpPassword?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "SMTP Port",
    description: "Port for your SMTP Server",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: true,
    transformer: Port.getDatabaseTransformer(),
  })
  public smtpPort?: Port = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP Host",
    description: "Host for your SMTP Server",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
    transformer: Hostname.getDatabaseTransformer(),
  })
  public smtpHost?: Hostname = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Email,
    title: "SMTP From Email",
    description: "Which email should we send mail from?",
  })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    nullable: true,
    unique: true,
    transformer: Email.getDatabaseTransformer(),
  })
  public smtpFromEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP From Name",
    description: "Which name should we send emails from?",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public smtpFromName?: string = undefined;

  /*
   * Transport selection for the global SMTP. Defaults to SMTP for backwards
   * compatibility. 'Microsoft Graph' bypasses SMTP entirely and posts to
   * https://graph.microsoft.com/v1.0/users/{from}/sendMail — useful for tenants
   * that have SMTP AUTH disabled.
   */

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP Transport",
    description:
      "How OneUptime delivers mail using the global SMTP config. 'SMTP' uses the host/port. 'Microsoft Graph' sends via the Microsoft Graph REST API.",
    defaultValue: MailTransportType.SMTP,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    default: MailTransportType.SMTP,
  })
  public smtpTransportType?: MailTransportType = undefined;

  // SMTP OAuth 2.0 Settings.

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP Authentication Type",
    description:
      "The type of authentication to use for this SMTP server. Options: Username and Password, OAuth, or None.",
    defaultValue: SMTPAuthenticationType.UsernamePassword,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    default: SMTPAuthenticationType.UsernamePassword,
  })
  public smtpAuthType?: SMTPAuthenticationType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP OAuth Client ID",
    description:
      "The Client ID from your OAuth application registration. Required for OAuth authentication.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public smtpClientId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "SMTP OAuth Client Secret",
    description:
      "The Client Secret from your OAuth application registration. Required for OAuth authentication. For Google service accounts, this is the private key from the JSON key file.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public smtpClientSecret?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongURL,
    title: "SMTP OAuth Token URL",
    description:
      "The OAuth token endpoint URL. For Microsoft 365: https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token. For Google: https://oauth2.googleapis.com/token",
  })
  @Column({
    type: ColumnType.LongURL,
    nullable: true,
  })
  public smtpTokenUrl?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "SMTP OAuth Scope",
    description:
      "The OAuth scope(s) required for SMTP access. For Microsoft 365: https://outlook.office365.com/.default. For Google: https://mail.google.com/",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public smtpScope?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP OAuth Provider Type",
    description:
      "The OAuth grant type to use. 'Client Credentials' for Microsoft 365 and most providers. 'JWT Bearer' for Google Workspace service accounts.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public smtpOAuthProviderType?: OAuthProviderType = undefined;

  // Twilio config.

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Twilio Account SID",
    description: "Account SID for your Twilio Account",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public twilioAccountSID?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Twilio Auth Token",
    description: "Auth Token for your Twilio Account",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public twilioAuthToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Phone,
    title: "Twilio Primary Phone Number",
    description: "Secondary Phone Number for your Twilio account",
  })
  @Column({
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    nullable: true,
    unique: false,
    transformer: Phone.getDatabaseTransformer(),
  })
  public twilioPrimaryPhoneNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Twilio Secondary Phone Numbers",
    description: "Secondary Phone Number for your Twilio account",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public twilioSecondaryPhoneNumbers?: string = undefined; // phone numbers separated by comma

  /*
   * The numbers SMS go out from, as on a project's Twilio config
   * (ProjectCallSMSConfig): for numbers that can only make calls - in
   * Singapore, national numbers are voice-only and SMS need a mobile number.
   * Once set, every SMS goes out from one of them: the one in the
   * recipient's country, or else the first. Empty - as on every
   * installation before them - SMS go out from the numbers calls do
   * (Types/CallAndSMS/TwilioPhoneNumbers).
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Twilio SMS Phone Numbers",
    description:
      "Comma-separated numbers to send SMS from, for phone numbers that can only make calls. Once set, every SMS goes out from the one in the recipient's country, or else the first. Leave it empty to send SMS from the same numbers as calls.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public twilioSmsPhoneNumbers?: string = undefined; // phone numbers separated by comma

  /*
   * What the server's Twilio account is used for, as a project's Twilio
   * config says it (ProjectCallSMSConfig.usedFor,
   * Types/CallAndSMS/TwilioConfigUse): calls and SMS - what every
   * installation's account was, and what the column starts with - SMS only,
   * or calls only. An account used for SMS only needs no number to make
   * calls from and makes no calls: then only projects with a Twilio config
   * of their own that makes calls can make them, and likewise for SMS.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    title: "Twilio Used For",
    description:
      'What the server\'s Twilio account sends: "Calls and SMS", "SMS only" or "Calls only".',
    defaultValue: DEFAULT_TWILIO_CONFIG_USE,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    unique: false,
    default: DEFAULT_TWILIO_CONFIG_USE,
  })
  public twilioUsedFor?: TwilioConfigUse = undefined;

  /*
   * What carries the server's SMS and calls (Types/CallAndSMS/
   * CallAndSmsProvider): its Twilio account above - what every installation
   * sent through, and what the column starts with - or the installation's
   * own gateway, a URL each SMS and call is posted to, signed with the
   * secret below (CallAndSmsGatewayPayload). A project with a Twilio config
   * of its own still sends through that config.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    title: "Send SMS and Calls Through",
    description:
      'What carries the server\'s SMS and calls: "Twilio" (its Twilio account) or "Gateway" (your own gateway, at the Gateway URL).',
    defaultValue: DEFAULT_CALL_AND_SMS_PROVIDER,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    unique: false,
    default: DEFAULT_CALL_AND_SMS_PROVIDER,
  })
  public callAndSmsProvider?: CallAndSmsProvider = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Gateway URL",
    description:
      "Where OneUptime posts each SMS and call when it sends them through your own gateway.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public callAndSmsGatewayUrl?: string = undefined;

  /*
   * Made for the admin when the gateway is first saved, and again when it
   * is cleared (GlobalConfigService): the gateway checks each request's
   * X-OneUptime-Signature with it, as a custom channel's service does.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Gateway Signing Secret",
    description:
      "The secret each request to your gateway is signed with, in the X-OneUptime-Signature header.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: false,
  })
  public callAndSmsGatewaySecret?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Meta WhatsApp Access Token",
    description:
      "Access token generated from Meta for sending WhatsApp messages.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppAccessToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp Phone Number ID",
    description: "The WhatsApp Business phone number ID from Meta.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppPhoneNumberId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp Business Account ID",
    description: "Business account ID associated with your WhatsApp setup.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppBusinessAccountId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp App ID",
    description:
      "Facebook App ID used for the WhatsApp Business Platform integration.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppAppId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Meta WhatsApp App Secret",
    description: "Facebook App Secret for the WhatsApp Business Platform.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppAppSecret?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp Webhook Verify Token",
    description:
      "Verify token configured in Meta to validate webhook subscriptions.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppWebhookVerifyToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Telegram Bot Token",
    description:
      "Bot token issued by @BotFather for sending Telegram messages.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    unique: true,
  })
  public telegramBotToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Telegram Bot Username",
    description:
      "Username of your OneUptime Telegram bot (without the leading @). Used to build verification deep links.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public telegramBotUsername?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Telegram Webhook Secret Token",
    description:
      "Secret token passed to Telegram setWebhook. Telegram sends it back in the X-Telegram-Bot-Api-Secret-Token header.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public telegramWebhookSecretToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Poll Telegram for Messages",
    description:
      "When enabled, OneUptime fetches the bot's messages from Telegram over outbound HTTPS instead of waiting for Telegram to call its webhook. For servers Telegram cannot reach, such as one behind a VPN or firewall.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public telegramPollForUpdates?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Email Server Type",
    description: "Email Server Type",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    unique: true,
  })
  public emailServerType?: EmailServerType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Sendgrid API Key",
    description: "Sendgrid API Key",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    unique: true,
  })
  public sendgridApiKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Email,
    title: "Sendgrid From Email",
    description: "Sendgrid From Email",
  })
  @Column({
    type: ColumnType.Email,
    nullable: true,
    unique: true,
  })
  public sendgridFromEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Sendgrid From Name",
    description: "Sendgrid From Name",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    unique: true,
  })
  public sendgridFromName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Is Master API Key Enabled",
    description: "Is Master API Key Enabled?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    unique: true,
    default: false,
  })
  public isMasterApiKeyEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Master API Key",
    description:
      "This API key has root access to all the resources in all the projects on OneUptime.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    unique: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public masterApiKey?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Email,
    title: "Admin Notification Email",
    description:
      "Email to send admin notifications to (when probes are offline, etc.)",
  })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    nullable: true,
    unique: true,
    transformer: Email.getDatabaseTransformer(),
  })
  public adminNotificationEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Enterprise Company Name",
    description:
      "Company name associated with the validated enterprise license.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public enterpriseCompanyName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Enterprise License Key",
    description: "Enterprise license key stored after successful validation.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public enterpriseLicenseKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Enterprise License Expires At",
    description: "Expiration date of the validated enterprise license.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: true,
  })
  public enterpriseLicenseExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Enterprise License Token",
    description: "Signed JWT returned from license validation.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    unique: true,
  })
  public enterpriseLicenseToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Enterprise License Is Evaluation",
    description:
      "True when the validated enterprise license is an evaluation/testing license. Drives the evaluation notice shown in the edition modal.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public enterpriseLicenseIsEvaluation?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Enterprise License User Limit",
    description:
      "Maximum number of users permitted under the validated enterprise license.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public enterpriseLicenseUserLimit?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Enterprise License Current User Count",
    description:
      "User count last reported to OneUptime for the validated enterprise license.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public enterpriseLicenseCurrentUserCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Enterprise License User Count Updated At",
    description:
      "Timestamp of the most recent user count report sent to OneUptime for the validated enterprise license.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public enterpriseLicenseUserCountUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Enterprise License Instances",
    description:
      "Instances (staging, production, etc.) that share the validated enterprise license, as last reported by OneUptime. Users are counted uniquely across all of them.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public enterpriseLicenseInstances?: Array<EnterpriseLicenseInstanceSummary> =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Email,
    title: "Enterprise License Notification Email",
    description:
      "OneUptime email address CC'd on enterprise license notifications sent to customers (expiry reminders, seat-limit breaches). Only used on the hosted oneuptime.com (billing enabled).",
  })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    nullable: true,
    transformer: Email.getDatabaseTransformer(),
  })
  public enterpriseLicenseNotificationEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Enterprise License Expiry Reminder Days",
    description:
      "How many days before an enterprise license expires that expiry reminder emails start going out to the customer's master admins. Defaults to 45. Only used on the hosted oneuptime.com (billing enabled).",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public enterpriseLicenseExpiryReminderDays?: number = undefined;

  /*
   * Set once, by the enterprise module, the first time this installation boots
   * the Enterprise Edition. An Enterprise install with no license at all gets
   * a 14-day evaluation trial counted from here (also the transition for
   * installs that ran the Enterprise Edition on the IS_ENTERPRISE_EDITION
   * variable alone). Written only by the server itself (isRoot).
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Enterprise Edition First Seen At",
    description:
      "When this installation first booted the OneUptime Enterprise Edition. An unlicensed Enterprise installation gets a 14-day trial counted from this moment.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public enterpriseEditionFirstSeenAt?: Date = undefined;

  /*
   * How a self-hosted Enterprise installation bought on a cloud marketplace
   * bills its users there, by the user-hour: the hourly reports the
   * marketplace has not taken yet, the last one it took, and when it last
   * confirmed (or refused) the subscription. An accepted report is what
   * licenses such an installation without a license key, so this is a
   * license column (GlobalConfigService.ROOT_ONLY_LICENSE_COLUMNS), written
   * only by the Enterprise Edition's usage job (isRoot). The shape is
   * Types/EnterpriseLicense/EnterpriseMarketplaceBilling.ts.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Enterprise Marketplace Billing",
    description:
      "How this self-hosted Enterprise installation bills its users through the cloud marketplace it was bought on: the hourly reports not taken yet, the last one taken, and when the marketplace last confirmed or refused the subscription.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public enterpriseMarketplaceBilling?: JSONObject = undefined;

  /*
   * The installation's own branding: the name it goes by and its logos, in
   * place of OneUptime's (Types/Branding/ProductBranding.ts). Written and read
   * only by OneUptime itself - the enterprise module, which decides whether
   * they apply - never through the generic API (GlobalConfigService,
   * ROOT_ONLY_BRANDING_COLUMNS). Null keeps OneUptime's own. Each image is a
   * data: URL, checked before it is stored, and served from its own route,
   * so no File row and no file id is involved.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Branding Product Name",
    description: "The name this installation goes by.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public brandingProductName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Branding Website URL",
    description: "Where a 'Powered by' line links to.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public brandingWebsiteUrl?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Branding Logo",
    description: "The logo for light backgrounds, as a data: URL.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public brandingLogo?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Branding Dark Logo",
    description: "The logo for dark backgrounds, as a data: URL.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public brandingDarkLogo?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Branding Favicon",
    description: "The browser tab icon, as a data: URL.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public brandingFavicon?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Branding Updated At",
    description:
      "When the branding last changed. Part of every branding image's address, so browsers and mail clients fetch a changed image again.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public brandingUpdatedAt?: Date = undefined;

  /*
   * The four latestRelease* columns cache the daily GitHub release check
   * (Workers/Jobs/InstanceUpdate/CheckForNewVersion). They are a cache, not
   * configuration: an air-gapped installation simply leaves them null and no
   * update prompt is ever shown.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Latest Release Version",
    description:
      "Latest OneUptime version published on GitHub, for example 11.6.0, as of the last update check. Null until the first successful check.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public latestReleaseVersion?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Latest Release Published At",
    description: "When the latest OneUptime version was published on GitHub.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public latestReleasePublishedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Latest Release Checked At",
    description:
      "When this installation last successfully checked GitHub for a newer OneUptime release.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public latestReleaseCheckedAt?: Date = undefined;

  /*
   * The security advisories OneUptime published on GitHub, as of the last
   * update check that read them (Types/UpdateCheck/SecurityAdvisory.ts):
   * a cache, like the latestRelease* columns, written only by the worker
   * (GlobalConfigService.ROOT_ONLY_UPDATE_CHECK_COLUMNS). Whether one
   * affects this installation is worked out when it is read, against the
   * version that runs then, so an upgrade clears the notice at once.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Security Advisories",
    description:
      "The security advisories OneUptime published on GitHub, as of the last update check: each one's identifier, summary, severity and the versions it affects and that fix it.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public securityAdvisories?: Array<JSONObject> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Security Advisories Checked At",
    description:
      "When this installation last read OneUptime's published security advisories from GitHub.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public securityAdvisoriesCheckedAt?: Date = undefined;

  /*
   * The advisories this installation's owners were emailed about, as each
   * one's GHSA id and when (ISO). Each advisory is emailed once: the daily
   * check that finds it again sends nothing.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Security Advisories Emailed",
    description:
      "The security advisories this installation's master admins were emailed about, and when. Each advisory is emailed once.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public securityAdvisoriesEmailed?: JSONObject = undefined;

  /*
   * When the update check last asked GitHub, answered or not. A check that
   * asked within the last hour does not ask again, so a worker that restarts
   * in a loop, or GitHub's rate limit, never turns into a stream of requests.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Update Check Last Attempted At",
    description:
      "When this installation last asked GitHub for the latest OneUptime release and its security advisories, whether or not GitHub answered.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public updateCheckLastAttemptAt?: Date = undefined;

  // Why that attempt failed (Types/UpdateCheck/UpdateCheckFailure.ts); null when it did not.
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Update Check Last Failure",
    description:
      "Why the last update check could not read GitHub: rate-limited, unreachable, timed-out, http-error or malformed-response. Empty when it could.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public updateCheckLastFailure?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Monitor Log Retention Days",
    description:
      "Number of days to retain monitor logs. Monitor logs older than this will be automatically deleted. Default is 1 day.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: true,
  })
  public monitorLogRetentionInDays?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Monitor Metric Retention Days",
    description:
      "Number of days to retain monitor metrics, the oneuptime.slo.* metrics SLO evaluations post and the oneuptime.rum.session.replay.budget.* metrics the session replay budget sweep posts. Metrics older than this will be automatically deleted. Default is 30 days.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: true,
  })
  public monitorMetricRetentionInDays?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "ClickHouse Capacity Notifications",
    description:
      "Notify master administrators when ClickHouse capacity rises above the configured threshold.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public clickhouseCapacityNotificationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "ClickHouse Capacity Notification Threshold (%)",
    description:
      "Notify master administrators when ClickHouse capacity rises above this percentage.",
    defaultValue: 80,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 80,
  })
  public clickhouseCapacityNotificationThresholdPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "ClickHouse Data Pruning",
    description:
      "Automatically prune ClickHouse data when capacity rises above the configured threshold.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public clickhouseDataPruningEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "ClickHouse Data Pruning Threshold (%)",
    description:
      "Start pruning ClickHouse data when capacity rises above this percentage.",
    defaultValue: 90,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 90,
  })
  public clickhouseDataPruningThresholdPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "ClickHouse Data Pruning Target (%)",
    description:
      "Continue pruning ClickHouse data until capacity reaches this percentage.",
    defaultValue: 80,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 80,
  })
  public clickhouseDataPruningTargetPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Valkey Memory Notifications",
    description:
      "Notify master administrators when Valkey memory usage rises above the configured threshold.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public redisMemoryNotificationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Valkey Memory Notification Threshold (%)",
    description:
      "Notify master administrators when Valkey memory usage rises above this percentage of maxmemory.",
    defaultValue: 80,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 80,
  })
  public redisMemoryNotificationThresholdPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Valkey Connection Saturation Notifications",
    description:
      "Notify master administrators when Valkey client connections approach the maxclients limit or connections are being rejected.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public redisConnectionNotificationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Valkey Connection Notification Threshold (%)",
    description:
      "Notify master administrators when connected Valkey clients rise above this percentage of maxclients.",
    defaultValue: 80,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 80,
  })
  public redisConnectionNotificationThresholdPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Valkey Key Eviction Notifications",
    description:
      "Notify master administrators when Valkey evicts keys because it reached its memory limit.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public redisKeyEvictionNotificationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Valkey Persistence Failure Notifications",
    description:
      "Notify master administrators when a Valkey RDB snapshot or AOF write fails.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public redisPersistenceFailureNotificationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Postgres Storage Notifications",
    description:
      "Notify master administrators when the Postgres database size rises above the configured share of its storage limit.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public postgresStorageNotificationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Postgres Storage Limit (GB)",
    description:
      "Size of the volume backing Postgres, in gigabytes. Postgres cannot report filesystem free space over SQL, so this is supplied by the administrator.",
    required: false,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public postgresStorageLimitInGb?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Postgres Storage Notification Threshold (%)",
    description:
      "Notify master administrators when the Postgres database size rises above this percentage of the configured storage limit.",
    defaultValue: 80,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 80,
  })
  public postgresStorageNotificationThresholdPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Postgres Connection Saturation Notifications",
    description:
      "Notify master administrators when Postgres client backends approach the max_connections limit.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public postgresConnectionNotificationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Postgres Connection Notification Threshold (%)",
    description:
      "Notify master administrators when Postgres client backends rise above this percentage of max_connections.",
    defaultValue: 80,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 80,
  })
  public postgresConnectionNotificationThresholdPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Postgres Transaction ID Wraparound Notifications",
    description:
      "Notify master administrators when Postgres transaction-ID age approaches the wraparound ceiling at which Postgres refuses writes.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public postgresWraparoundNotificationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Postgres Wraparound Notification Threshold (%)",
    description:
      "Notify master administrators when transaction-ID age rises above this percentage of the wraparound ceiling.",
    defaultValue: 50,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 50,
  })
  public postgresWraparoundNotificationThresholdPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Postgres Replication Slot Notifications",
    description:
      "Notify master administrators when a Postgres replication slot retains too much WAL or has lost its WAL segments.",
    defaultValue: false,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public postgresReplicationSlotNotificationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Postgres Retained WAL Limit (GB)",
    description:
      "Notify master administrators when a single replication slot retains more than this many gigabytes of WAL.",
    defaultValue: 10,
    isDefaultValueColumn: true,
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 10,
  })
  public postgresRetainedWalLimitInGb?: number = undefined;
}
