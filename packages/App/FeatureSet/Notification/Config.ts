import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import AmazonSesAuthenticationType, {
  toAmazonSesAuthenticationType,
} from "Common/Types/Email/AmazonSesAuthenticationType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import { isMailgunDomain } from "Common/Types/Email/MailgunDomain";
import { toMailgunRegion } from "Common/Types/Email/MailgunRegion";
import { isAwsRegion } from "Common/Types/Cloud/AwsRegionCode";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { AdminDashboardClientURL } from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import TwilioPhoneNumbers from "Common/Types/CallAndSMS/TwilioPhoneNumbers";
import { GLOBAL_TWILIO_CONFIG_SELECT } from "Common/Server/Utils/TwilioConfigSelect";
import { toServerTwilioConfig } from "Common/Server/Utils/ServerTwilioConfig";
import { TwilioMessageKind } from "Common/Utils/Project/TwilioAccount";
import { CallAndSmsGateway } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import CallAndSmsGatewayConfig from "Common/Server/Utils/CallAndSmsGatewayConfig";

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
          smtpTransportType: true,
          smtpAuthType: true,
          smtpClientId: true,
          smtpClientSecret: true,
          smtpTokenUrl: true,
          smtpScope: true,
          smtpOAuthProviderType: true,
        },
      });

    if (!globalConfig) {
      throw new BadDataException("Global Config not found");
    }

    /*
     * The server's Custom SMTP settings send over SMTP or through Microsoft
     * Graph; anything else stored there is read as SMTP. The providers with
     * an HTTP API of their own are Email Server Types, each with settings of
     * its own (getGlobalEmailProviderServer).
     */
    const transportType: MailTransportType =
      globalConfig.smtpTransportType === MailTransportType.MicrosoftGraph
        ? MailTransportType.MicrosoftGraph
        : MailTransportType.SMTP;

    /*
     * "config not yet set" detection: for SMTP we look at host/port/credentials;
     * for Microsoft Graph we look at OAuth credentials. If none of the relevant
     * fields are populated, treat it as "no global SMTP configured" rather than
     * throwing — callers handle null gracefully.
     */
    if (transportType === MailTransportType.MicrosoftGraph) {
      if (
        !globalConfig.smtpFromEmail &&
        !globalConfig.smtpClientId &&
        !globalConfig.smtpClientSecret &&
        !globalConfig.smtpTokenUrl
      ) {
        return null;
      }
    } else if (
      !globalConfig.smtpFromEmail &&
      !globalConfig.smtpHost &&
      !globalConfig.smtpPort &&
      !globalConfig.smtpUsername &&
      !globalConfig.smtpPassword &&
      !globalConfig.smtpFromName
    ) {
      return null;
    }

    /*
     * Microsoft Graph always uses OAuth (Client Credentials). For SMTP, the
     * user picks an auth type — default to UsernamePassword for back-compat.
     */
    const smtpAuthType: SMTPAuthenticationType =
      transportType === MailTransportType.MicrosoftGraph
        ? SMTPAuthenticationType.OAuth
        : (globalConfig.smtpAuthType as SMTPAuthenticationType) ||
          SMTPAuthenticationType.UsernamePassword;

    if (!globalConfig.smtpFromEmail) {
      throw new BadDataException(
        "Global SMTP From Email not found. Please set this in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    if (!globalConfig.smtpFromName) {
      throw new BadDataException(
        "SMTP From Name not found. Please set this in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    /*
     * Host/port are only required for SMTP transport. Microsoft Graph posts to
     * graph.microsoft.com and ignores host/port entirely.
     */
    if (transportType === MailTransportType.SMTP) {
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
    }

    // OAuth credentials are required for both Microsoft Graph and SMTP+OAuth.
    if (smtpAuthType === SMTPAuthenticationType.OAuth) {
      if (!globalConfig.smtpClientId) {
        throw new BadDataException(
          "SMTP OAuth Client ID not found. Please set this in the Admin Dashboard: " +
            AdminDashboardClientURL.toString(),
        );
      }

      if (!globalConfig.smtpClientSecret) {
        throw new BadDataException(
          "SMTP OAuth Client Secret not found. Please set this in the Admin Dashboard: " +
            AdminDashboardClientURL.toString(),
        );
      }

      if (!globalConfig.smtpTokenUrl) {
        throw new BadDataException(
          "SMTP OAuth Token URL not found. Please set this in the Admin Dashboard: " +
            AdminDashboardClientURL.toString(),
        );
      }

      if (!globalConfig.smtpScope) {
        throw new BadDataException(
          "SMTP OAuth Scope not found. Please set this in the Admin Dashboard: " +
            AdminDashboardClientURL.toString(),
        );
      }
    }

    return {
      transportType: transportType,
      host: globalConfig.smtpHost || undefined,
      port: globalConfig.smtpPort || undefined,
      username: globalConfig.smtpUsername || undefined,
      password: globalConfig.smtpPassword || undefined,
      secure: globalConfig.isSMTPSecure || false,
      fromEmail: globalConfig.smtpFromEmail,
      // Without a name of its own, emails are from the product.
      fromName:
        globalConfig.smtpFromName || ProductBrandingText.getProductName(),
      authType: smtpAuthType,
      clientId: globalConfig.smtpClientId || undefined,
      clientSecret: globalConfig.smtpClientSecret || undefined,
      tokenUrl: globalConfig.smtpTokenUrl
        ? URL.fromString(globalConfig.smtpTokenUrl)
        : undefined,
      scope: globalConfig.smtpScope || undefined,
      oauthProviderType:
        (globalConfig.smtpOAuthProviderType as OAuthProviderType | undefined) ||
        undefined,
    };
  };

type GetGlobalEmailProviderServerFunction = (
  transportType: MailTransportType,
) => Promise<EmailServer>;

/*
 * The server's own settings for a provider with an HTTP API of its own -
 * Email Server Type Amazon SES, Mailgun, Postmark or Resend - as the
 * EmailServer MailService sends with: only that provider's key and sender.
 * A setting left blank (or not what the provider takes: an AWS Region, a
 * Mailgun domain) refuses the email with the field to fill in, stamped as
 * the operator's to fix.
 */
export const getGlobalEmailProviderServer: GetGlobalEmailProviderServerFunction =
  async (transportType: MailTransportType): Promise<EmailServer> => {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
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
        },
      });

    if (!globalConfig) {
      throw new BadDataException("Global Config not found");
    }

    const notSet: (field: string) => BadDataException = (
      field: string,
    ): BadDataException => {
      return new BadDataException(
        `Email is configured to use ${transportType}, but its ${field} is not set. Please set it in the Admin Dashboard, under Settings > Emails: ` +
          AdminDashboardClientURL.toString(),
      ).asUserError();
    };

    const text: (value: string | undefined) => string = (
      value: string | undefined,
    ): string => {
      return value?.trim() || "";
    };

    const sender: (
      fromEmail: Email | undefined,
      fromName: string | undefined,
    ) => { fromEmail: Email; fromName: string } = (
      fromEmail: Email | undefined,
      fromName: string | undefined,
    ): { fromEmail: Email; fromName: string } => {
      if (!fromEmail || !fromEmail.toString().trim()) {
        throw notSet("From Email");
      }

      return {
        fromEmail: fromEmail,
        // Without a name of its own, emails are from the product.
        fromName: text(fromName) || ProductBrandingText.getProductName(),
      };
    };

    const base: Pick<EmailServer, "transportType" | "username" | "password"> = {
      transportType: transportType,
      username: undefined,
      password: undefined,
    };

    switch (transportType) {
      case MailTransportType.AmazonSES: {
        /*
         * Signed in as the server's own IAM role (#7000), nothing but the
         * Region is needed: the credentials are the role's, fetched when
         * the email goes (AwsDefaultCredentialChain).
         */
        const usesServerIamRole: boolean =
          toAmazonSesAuthenticationType(
            globalConfig.amazonSesAuthenticationType,
          ) === AmazonSesAuthenticationType.ServerIamRole;
        const accessKeyId: string = text(globalConfig.amazonSesAccessKeyId);
        const secretAccessKey: string = text(
          globalConfig.amazonSesSecretAccessKey,
        );
        const region: string = text(globalConfig.amazonSesRegion).toLowerCase();

        if (!usesServerIamRole && !accessKeyId) {
          throw notSet("Access Key ID");
        }

        if (!usesServerIamRole && !secretAccessKey) {
          throw notSet("Secret Access Key");
        }

        if (!region || !isAwsRegion(region)) {
          throw notSet("Region (an AWS Region code, such as us-east-1)");
        }

        return {
          ...base,
          ...sender(
            globalConfig.amazonSesFromEmail,
            globalConfig.amazonSesFromName,
          ),
          awsAuthenticationType: usesServerIamRole
            ? AmazonSesAuthenticationType.ServerIamRole
            : AmazonSesAuthenticationType.AccessKey,
          awsAccessKeyId: usesServerIamRole ? undefined : accessKeyId,
          awsSecretAccessKey: usesServerIamRole ? undefined : secretAccessKey,
          awsRegion: region,
        };
      }

      case MailTransportType.Mailgun: {
        const apiKey: string = text(globalConfig.mailgunApiKey);
        const domain: string = text(globalConfig.mailgunDomain).toLowerCase();

        if (!apiKey) {
          throw notSet("API Key");
        }

        if (!domain || !isMailgunDomain(domain)) {
          throw notSet("Domain (the sending domain, such as mg.example.com)");
        }

        return {
          ...base,
          ...sender(
            globalConfig.mailgunFromEmail,
            globalConfig.mailgunFromName,
          ),
          apiKey: apiKey,
          mailgunDomain: domain,
          mailgunRegion: toMailgunRegion(globalConfig.mailgunRegion),
        };
      }

      case MailTransportType.Postmark: {
        const serverToken: string = text(globalConfig.postmarkServerToken);

        if (!serverToken) {
          throw notSet("Server API Token");
        }

        return {
          ...base,
          ...sender(
            globalConfig.postmarkFromEmail,
            globalConfig.postmarkFromName,
          ),
          apiKey: serverToken,
        };
      }

      case MailTransportType.Resend: {
        const apiKey: string = text(globalConfig.resendApiKey);

        if (!apiKey) {
          throw notSet("API Key");
        }

        return {
          ...base,
          ...sender(globalConfig.resendFromEmail, globalConfig.resendFromName),
          apiKey: apiKey,
        };
      }

      default:
        throw new BadDataException(
          `${transportType} is not an email provider the server sends through with settings of its own.`,
        );
    }
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

type GetTwilioConfigFunction = (
  kind?: TwilioMessageKind | undefined,
) => Promise<TwilioConfig | null>;

/*
 * The OneUptime server's own Twilio account, or null while it is not set up
 * (ServerTwilioConfig) - and, given a kind of message, while it is not used
 * for that kind: an account used for SMS only makes no calls, and one used
 * for calls only sends no SMS (Types/CallAndSMS/TwilioConfigUse).
 */
export const getTwilioConfig: GetTwilioConfigFunction = async (
  kind?: TwilioMessageKind | undefined,
): Promise<TwilioConfig | null> => {
  const globalConfig: GlobalConfig | null = await GlobalConfigService.findOneBy(
    {
      query: {
        _id: ObjectID.getZeroObjectID().toString(),
      },
      props: {
        isRoot: true,
      },
      // Its SMS numbers too: SMS go out from them when they are set.
      select: GLOBAL_TWILIO_CONFIG_SELECT,
    },
  );

  if (!globalConfig) {
    throw new BadDataException("Global Config not found");
  }

  // Its SMS numbers and what it is used for too: read whole.
  const twilioConfig: TwilioConfig | null = toServerTwilioConfig(globalConfig);

  if (!twilioConfig) {
    return null;
  }

  if (kind && !TwilioPhoneNumbers.canSend(twilioConfig, kind)) {
    return null;
  }

  return twilioConfig;
};

type GetCallAndSmsGatewayFunction = () => Promise<CallAndSmsGateway | null>;

/*
 * The installation's own gateway, when the server sends its SMS and calls
 * through one (Types/CallAndSMS/CallAndSmsProvider) - or null when it sends
 * them through Twilio. Asked wherever the server's own Twilio account would
 * be, and first: a server that sends through its gateway sends nothing
 * through Twilio. A read that fails throws, as getTwilioConfig's does, so
 * the message fails rather than going out through Twilio after all.
 */
export const getCallAndSmsGateway: GetCallAndSmsGatewayFunction =
  async (): Promise<CallAndSmsGateway | null> => {
    return await CallAndSmsGatewayConfig.getGateway();
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

export interface TelegramConfig {
  botToken: string;
  botUsername?: string | undefined;
  webhookSecretToken?: string | undefined;
}

type GetTelegramConfigFunction = () => Promise<TelegramConfig>;

export const getTelegramConfig: GetTelegramConfigFunction =
  async (): Promise<TelegramConfig> => {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          telegramBotToken: true,
          telegramBotUsername: true,
          telegramWebhookSecretToken: true,
        },
      });

    if (!globalConfig) {
      throw new BadDataException("Global Config not found");
    }

    const botToken: string | undefined = globalConfig.telegramBotToken?.trim();

    if (!botToken) {
      throw new BadDataException(
        "Telegram bot token not configured. Please set it in the Admin Dashboard: " +
          AdminDashboardClientURL.toString(),
      );
    }

    return {
      botToken,
      botUsername: globalConfig.telegramBotUsername?.trim() || undefined,
      webhookSecretToken:
        globalConfig.telegramWebhookSecretToken?.trim() || undefined,
    };
  };

export const TelegramTextDefaultCostInCents: number = process.env[
  "TELEGRAM_TEXT_DEFAULT_COST_IN_CENTS"
]
  ? parseInt(process.env["TELEGRAM_TEXT_DEFAULT_COST_IN_CENTS"])
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
