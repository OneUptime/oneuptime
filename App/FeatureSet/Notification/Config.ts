import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { AdminDashboardClientURL } from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import Phone from "Common/Types/Phone";

type GetGlobalSMTPConfig = () => Promise<EmailServer | null>;

export const DEFAULT_META_WHATSAPP_API_VERSION: string = "v23.0";

export const getGlobalSMTPConfig: GetGlobalSMTPConfig =
  async (): Promise<EmailServer | null> => {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          smtpFromEmail: true,
          smtpHost: true,
          smtpPort: true,
          smtpUsername: true,
          smtpPassword: true,
          isSMTPSecure: true,
          smtpFromName: true,
        },
      });

    if (!globalConfig) {
      throw new BadDataException("Global Config not found");
    }

    if (
      !globalConfig.smtpFromEmail &&
      !globalConfig.smtpHost &&
      !globalConfig.smtpPort &&
      !globalConfig.smtpUsername &&
      !globalConfig.smtpPassword &&
      !globalConfig.smtpFromName
    ) {
      return null;
    }

    if (!globalConfig.smtpFromEmail) {
      throw new BadDataException(
        "Global SMTP From Email not found. Please set this in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    if (!globalConfig.smtpHost) {
      throw new BadDataException(
        "SMTP Host not found. Please set this in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    if (!globalConfig.smtpPort) {
      throw new BadDataException(
        "SMTP Port not found. Please set this in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    if (!globalConfig.smtpFromName) {
      throw new BadDataException(
        "SMTP From Name not found. Please set this in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    if (!globalConfig.smtpFromEmail) {
      throw new BadDataException(
        "SMTP From Email not found. Please set this in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    return {
      host: globalConfig.smtpHost,
      port: globalConfig.smtpPort,
      username: globalConfig.smtpUsername || undefined, // these can be optional. If not set, they will be undefined
      password: globalConfig.smtpPassword || undefined, // these can be optional. If not set, they will be undefined
      secure: globalConfig.isSMTPSecure || false,
      fromEmail: globalConfig.smtpFromEmail,
      fromName: globalConfig.smtpFromName || "OneUptime",
    };
  };

type GetEmailServerTypeFunction = () => Promise<EmailServerType>;

export const getEmailServerType: GetEmailServerTypeFunction =
  async (): Promise<EmailServerType> => {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          emailServerType: true,
        },
      });

    if (!globalConfig) {
      return EmailServerType.CustomSMTP;
    }

    return globalConfig.emailServerType || EmailServerType.CustomSMTP;
  };

export interface SendGridConfig {
  apiKey: string;
  fromName: string;
  fromEmail: Email;
}

type GetSendgridConfigFunction = () => Promise<SendGridConfig | null>;

export const getSendgridConfig: GetSendgridConfigFunction =
  async (): Promise<SendGridConfig | null> => {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          sendgridApiKey: true,
          sendgridFromEmail: true,
          sendgridFromName: true,
        },
      });

    if (!globalConfig) {
      return null;
    }

    if (
      globalConfig.sendgridApiKey &&
      globalConfig.sendgridFromEmail &&
      globalConfig.sendgridFromName
    ) {
      return {
        apiKey: globalConfig.sendgridApiKey,
        fromName: globalConfig.sendgridFromName,
        fromEmail: globalConfig.sendgridFromEmail,
      };
    }

    return null;
  };

type GetTwilioConfigFunction = () => Promise<TwilioConfig | null>;

export const getTwilioConfig: GetTwilioConfigFunction =
  async (): Promise<TwilioConfig | null> => {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          twilioAccountSID: true,
          twilioAuthToken: true,
          twilioPrimaryPhoneNumber: true,
          twilioSecondaryPhoneNumbers: true,
        },
      });

    if (!globalConfig) {
      throw new BadDataException("Global Config not found");
    }

    if (
      !globalConfig.twilioAccountSID ||
      !globalConfig.twilioAuthToken ||
      !globalConfig.twilioPrimaryPhoneNumber
    ) {
      return null;
    }

    return {
      accountSid: globalConfig.twilioAccountSID,
      authToken: globalConfig.twilioAuthToken,
      primaryPhoneNumber: globalConfig.twilioPrimaryPhoneNumber,
      secondaryPhoneNumbers:
        globalConfig.twilioSecondaryPhoneNumbers &&
        globalConfig.twilioSecondaryPhoneNumbers.length > 0
          ? globalConfig.twilioSecondaryPhoneNumbers
              .split(",")
              .map((phoneNumber: string) => {
                return new Phone(phoneNumber.trim());
              })
          : [],
    };
  };

export const SMSDefaultCostInCents: number = process.env[
  "SMS_DEFAULT_COST_IN_CENTS"
]
  ? parseInt(process.env["SMS_DEFAULT_COST_IN_CENTS"])
  : 0;

export const SMSHighRiskCostInCents: number = process.env[
  "SMS_HIGH_RISK_COST_IN_CENTS"
]
  ? parseInt(process.env["SMS_HIGH_RISK_COST_IN_CENTS"])
  : 0;

export interface MetaWhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string | undefined;
  appId?: string | undefined;
  appSecret?: string | undefined;
  apiVersion?: string | undefined;
}

type GetMetaWhatsAppConfigFunction = () => Promise<MetaWhatsAppConfig>;

export const getMetaWhatsAppConfig: GetMetaWhatsAppConfigFunction =
  async (): Promise<MetaWhatsAppConfig> => {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          metaWhatsAppAccessToken: true,
          metaWhatsAppPhoneNumberId: true,
          metaWhatsAppBusinessAccountId: true,
          metaWhatsAppAppId: true,
          metaWhatsAppAppSecret: true,
        },
      });

    if (!globalConfig) {
      throw new BadDataException("Global Config not found");
    }

    const accessToken: string | undefined =
      globalConfig.metaWhatsAppAccessToken?.trim();
    const phoneNumberId: string | undefined =
      globalConfig.metaWhatsAppPhoneNumberId?.trim();

    if (!accessToken) {
      throw new BadDataException(
        "Meta WhatsApp access token not configured. Please set it in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    if (!phoneNumberId) {
      throw new BadDataException(
        "Meta WhatsApp phone number ID not configured. Please set it in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    const businessAccountId: string | undefined =
      globalConfig.metaWhatsAppBusinessAccountId?.trim() || undefined;
    const appId: string | undefined =
      globalConfig.metaWhatsAppAppId?.trim() || undefined;
    const appSecret: string | undefined =
      globalConfig.metaWhatsAppAppSecret?.trim() || undefined;
    const apiVersion: string = DEFAULT_META_WHATSAPP_API_VERSION;

    return {
      accessToken,
      phoneNumberId,
      businessAccountId,
      appId,
      appSecret,
      apiVersion,
    };
  };

export const WhatsAppTextDefaultCostInCents: number = process.env[
  "WHATSAPP_TEXT_DEFAULT_COST_IN_CENTS"
]
  ? parseInt(process.env["WHATSAPP_TEXT_DEFAULT_COST_IN_CENTS"])
  : 0;

export const CallHighRiskCostInCentsPerMinute: number = process.env[
  "CALL_HIGH_RISK_COST_IN_CENTS_PER_MINUTE"
]
  ? parseInt(process.env["CALL_HIGH_RISK_COST_IN_CENTS_PER_MINUTE"])
  : 0;

export const CallDefaultCostInCentsPerMinute: number = process.env[
  "CALL_DEFAULT_COST_IN_CENTS_PER_MINUTE"
]
  ? parseInt(process.env["CALL_DEFAULT_COST_IN_CENTS_PER_MINUTE"])
  : 0;

// Call provider type
export const CallProvider: string = process.env["CALL_PROVIDER"] || "twilio";

// Host URL for webhook callbacks (required for incoming call features)
export const NotificationWebhookHost: string = process.env["HOST"] || "";
