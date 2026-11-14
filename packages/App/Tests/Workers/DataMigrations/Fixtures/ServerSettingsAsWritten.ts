import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import {
  InMemoryTable,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import Hostname from "Common/Types/API/Hostname";
import { CallAndSmsProvider } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import { TwilioConfigUse } from "Common/Types/CallAndSMS/TwilioConfigUse";
import Email from "Common/Types/Email";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import Port from "Common/Types/Port";
import EncryptGlobalConfigCredentials from "../../../../FeatureSet/Workers/DataMigrations/EncryptGlobalConfigCredentials";
import {
  answerGlobalConfigSql,
  GlobalConfigSql,
  SqlRow,
} from "./GlobalConfigCredentialsSql";

/*
 * The server's settings row as it was stored before its credential columns
 * were encrypted (#7739): every credential as an admin wrote it, and the
 * rest of each channel's settings, so every channel is set up.
 *
 * useServerSettings puts the row behind GlobalConfigService (an in-memory
 * table, InMemoryRepository), so every reader reads it through the service
 * as it reads Postgres, decrypting on the way. migrateServerSettings runs
 * the real EncryptGlobalConfigCredentials over the same rows, its SQL
 * answered as Postgres answers it (GlobalConfigCredentialsSql).
 */

export const SERVER_SETTINGS_ID: string = ObjectID.getZeroObjectID().toString();

// Each as an admin may have written it: kept exactly, spaces and all.
export const CREDENTIALS_AS_WRITTEN: Readonly<Record<string, string>> = {
  smtpPassword: " a password with spaces around it ",
  smtpClientSecret: `client~secret.${String.fromCodePoint(0xe9, 0x4e2d, 0x1f511)}`,
  twilioAuthToken: "0123456789abcdef0123456789abcdef",
  callAndSmsGatewaySecret:
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  metaWhatsAppAccessToken: `EAAG${"x1Y2z3".repeat(60)}`,
  metaWhatsAppAppSecret: "abcdef0123456789abcdef0123456789",
  metaWhatsAppWebhookVerifyToken: "verify me, please",
  telegramBotToken: "123456789:AAE-telegram_bot-token-0123456789",
  telegramWebhookSecretToken: "telegram_webhook_secret_0123456789AB",
  sendgridApiKey: "SG.key-id.key-secret",
  enterpriseLicenseKey: "OU-ENT-0000-1111-2222-3333",
  enterpriseLicenseToken: `eyJhbGciOiJFZERTQSJ9.${"eyJsaWNlbnNlIjp0cnVlfQ".repeat(40)}.c2lnbmF0dXJl`,
};

export const SMTP_HOST: string = "smtp.example.com";
export const SMTP_PORT: number = 587;
export const SMTP_USERNAME: string = "alerts@example.com";
export const SMTP_CLIENT_ID: string = "oauth-client-id";
export const SMTP_TOKEN_URL: string = "https://login.example.com/oauth2/token";
export const SENDER_EMAIL: string = "alerts@example.com";
export const TWILIO_ACCOUNT_SID: string = "AC00000000000000000000000000000001";
export const TWILIO_PRIMARY_NUMBER: string = "+15550001111";
export const TWILIO_SMS_NUMBER: string = "+15550002222";
export const GATEWAY_URL: string =
  "https://sms-gateway.internal.example.com/oneuptime";
export const WHATSAPP_PHONE_NUMBER_ID: string = "1234567890";

// Custom SMTP signed in with a password, SMS and calls through Twilio.
export function serverSettingsAsWritten(overrides: SqlRow = {}): SqlRow {
  return {
    _id: SERVER_SETTINGS_ID,
    emailServerType: EmailServerType.CustomSMTP,
    smtpHost: new Hostname(SMTP_HOST),
    smtpPort: new Port(SMTP_PORT),
    isSMTPSecure: false,
    smtpAuthType: SMTPAuthenticationType.UsernamePassword,
    smtpUsername: SMTP_USERNAME,
    smtpFromEmail: new Email(SENDER_EMAIL),
    smtpFromName: "Example Alerts",
    smtpOAuthProviderType: OAuthProviderType.ClientCredentials,
    smtpClientId: SMTP_CLIENT_ID,
    smtpTokenUrl: SMTP_TOKEN_URL,
    smtpScope: "https://outlook.office365.com/.default",
    sendgridFromEmail: new Email(SENDER_EMAIL),
    sendgridFromName: "Example Alerts",
    callAndSmsProvider: CallAndSmsProvider.Twilio,
    callAndSmsGatewayUrl: GATEWAY_URL,
    twilioUsedFor: TwilioConfigUse.CallsAndSms,
    twilioAccountSID: TWILIO_ACCOUNT_SID,
    twilioPrimaryPhoneNumber: new Phone(TWILIO_PRIMARY_NUMBER),
    twilioSmsPhoneNumbers: TWILIO_SMS_NUMBER,
    metaWhatsAppPhoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    metaWhatsAppBusinessAccountId: "9876543210",
    metaWhatsAppAppId: "1122334455",
    telegramBotUsername: "example_alerts_bot",
    telegramPollForUpdates: true,
    ...CREDENTIALS_AS_WRITTEN,
    ...overrides,
  };
}

export interface ServerSettings {
  table: InMemoryTable;
  sql: GlobalConfigSql;
}

export function useServerSettings(row: SqlRow): ServerSettings {
  const table: InMemoryTable = useInMemoryTable(GlobalConfigService, [row]);

  return {
    table: table,
    sql: answerGlobalConfigSql(() => {
      return table.rows;
    }),
  };
}

/*
 * Runs the data migration over the table. Only while it runs does the
 * repository answer SQL, as Postgres's does: every other read and write
 * goes through the service's find and update, as before.
 */
export async function migrateServerSettings(
  settings: ServerSettings,
): Promise<void> {
  const repository: Record<string, unknown> = settings.table
    .repository as unknown as Record<string, unknown>;

  repository["metadata"] = { tableName: "GlobalConfig" };
  repository["manager"] = { query: settings.sql.query };

  try {
    await new EncryptGlobalConfigCredentials().migrate();
  } finally {
    delete repository["metadata"];
    delete repository["manager"];
  }
}
