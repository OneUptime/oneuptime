import Hostname from "Common/Types/API/Hostname";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import { AdminDashboardClientURL } from "CommonServer/EnvironmentConfig";
import GlobalConfigService from "CommonServer/Services/GlobalConfigService";
import GlobalConfig, { EmailServerType } from "Common/AppModels/Models/GlobalConfig";

export const InternalSmtpPassword: string =
  process.env["INTERNAL_SMTP_PASSWORD"] || "";

export const InternalSmtpHost: Hostname = new Hostname(
  process.env["INTERNAL_SMTP_HOST"] || "haraka",
);

export const InternalSmtpPort: Port = new Port(2525);

export const InternalSmtpSecure: boolean = false;

export const InternalSmtpEmail: Email = new Email(
  process.env["INTERNAL_SMTP_EMAIL"] || "noreply@oneuptime.com",
);

export const InternalSmtpFromName: string =
  process.env["INTERNAL_SMTP_FROM_NAME"] || "OneUptime";

type GetGlobalSMTPConfig = () => Promise<EmailServer | null>;

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
      return EmailServerType.Internal;
    }

    return globalConfig.emailServerType || EmailServerType.Internal;
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
          twilioPhoneNumber: true,
        },
      });

    if (!globalConfig) {
      throw new BadDataException("Global Config not found");
    }

    if (
      !globalConfig.twilioAccountSID ||
      !globalConfig.twilioAuthToken ||
      !globalConfig.twilioPhoneNumber
    ) {
      return null;
    }

    return {
      accountSid: globalConfig.twilioAccountSID,
      authToken: globalConfig.twilioAuthToken,
      phoneNumber: globalConfig.twilioPhoneNumber,
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
