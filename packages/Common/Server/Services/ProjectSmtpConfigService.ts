import DatabaseService from "./DatabaseService";
import { isAwsRegion } from "../../Types/Cloud/AwsRegionCode";
import EmailServer from "../../Types/Email/EmailServer";
import { isMailgunDomain } from "../../Types/Email/MailgunDomain";
import { toMailgunRegion } from "../../Types/Email/MailgunRegion";
import MailTransportType, {
  toMailTransportType,
} from "../../Types/Email/MailTransportType";
import SMTPAuthenticationType from "../../Types/Email/SMTPAuthenticationType";
import BadDataException from "../../Types/Exception/BadDataException";
import URL from "../../Types/API/URL";
import Model from "../../Models/DatabaseModels/ProjectSmtpConfig";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public toEmailServer(
    projectSmtpConfig: Model | undefined,
  ): EmailServer | undefined {
    if (!projectSmtpConfig) {
      return undefined;
    }

    if (!projectSmtpConfig.id) {
      throw new BadDataException("Project SMTP config id is not set");
    }

    const transportType: MailTransportType = toMailTransportType(
      projectSmtpConfig.transportType,
    );

    if (!projectSmtpConfig.fromEmail) {
      throw new BadDataException("Project SMTP config from email is not set");
    }

    if (!projectSmtpConfig.fromName) {
      throw new BadDataException("Project SMTP config from name is not set");
    }

    /*
     * A provider with an HTTP API of its own sends with its own key alone:
     * none of the server, sign-in or OAuth columns below is read, and none
     * is handed on, so a key typed in for one transport never reaches
     * another's API.
     */
    switch (transportType) {
      case MailTransportType.AmazonSES:
      case MailTransportType.SendGrid:
      case MailTransportType.Mailgun:
      case MailTransportType.Postmark:
      case MailTransportType.Resend:
        return this.toApiProviderEmailServer(projectSmtpConfig, transportType);
      default:
        break;
    }

    /*
     * Get auth type, default to UsernamePassword for backward compatibility.
     * Microsoft Graph always uses OAuth (Client Credentials) regardless of what
     * the user picked — but we still let the existing OAuth validation apply.
     */
    const authType: SMTPAuthenticationType =
      transportType === MailTransportType.MicrosoftGraph
        ? SMTPAuthenticationType.OAuth
        : projectSmtpConfig.authType || SMTPAuthenticationType.UsernamePassword;

    if (transportType === MailTransportType.SMTP) {
      if (!projectSmtpConfig.hostname) {
        throw new BadDataException("Project SMTP config host is not set");
      }

      if (!projectSmtpConfig.port) {
        throw new BadDataException("Project SMTP config port is not set");
      }
    }

    // Validate based on auth type
    if (authType === SMTPAuthenticationType.UsernamePassword) {
      if (!projectSmtpConfig.username) {
        throw new BadDataException("Project SMTP config username is not set");
      }

      if (!projectSmtpConfig.password) {
        throw new BadDataException("Project SMTP config password is not set");
      }
    } else if (authType === SMTPAuthenticationType.OAuth) {
      /*
       * For Microsoft Graph, username is optional — we fall back to fromEmail
       * as the sender mailbox. For SMTP+XOAUTH2, username is required.
       */
      if (
        transportType === MailTransportType.SMTP &&
        !projectSmtpConfig.username
      ) {
        throw new BadDataException(
          "Project SMTP config username (email address) is not set for OAuth",
        );
      }

      if (!projectSmtpConfig.clientId) {
        throw new BadDataException(
          "Project SMTP config OAuth Client ID is not set",
        );
      }

      if (!projectSmtpConfig.clientSecret) {
        throw new BadDataException(
          "Project SMTP config OAuth Client Secret is not set",
        );
      }

      if (!projectSmtpConfig.tokenUrl) {
        throw new BadDataException(
          "Project SMTP config OAuth Token URL is not set",
        );
      }

      if (!projectSmtpConfig.scope) {
        throw new BadDataException(
          "Project SMTP config OAuth Scope is not set",
        );
      }
    }
    // For SMTPAuthenticationType.None, no credentials are required

    return {
      id: projectSmtpConfig.id!,
      transportType: transportType,
      host: projectSmtpConfig.hostname,
      port: projectSmtpConfig.port,
      username: projectSmtpConfig.username,
      password: projectSmtpConfig.password,
      fromEmail: projectSmtpConfig.fromEmail,
      fromName: projectSmtpConfig.fromName,
      secure: Boolean(projectSmtpConfig.secure),
      authType: authType,
      clientId: projectSmtpConfig.clientId,
      clientSecret: projectSmtpConfig.clientSecret,
      tokenUrl: projectSmtpConfig.tokenUrl
        ? URL.fromString(projectSmtpConfig.tokenUrl)
        : undefined,
      scope: projectSmtpConfig.scope,
      oauthProviderType: projectSmtpConfig.oauthProviderType,
    };
  }

  /*
   * A config that sends through Amazon SES, SendGrid, Mailgun, Postmark or
   * Resend, with that provider's settings checked as the provider would
   * check them: an AWS Region that is one (isAwsRegion), a Mailgun domain
   * that is a domain (isMailgunDomain). Each refusal names the field to fill in.
   */
  private toApiProviderEmailServer(
    projectSmtpConfig: Model,
    transportType: MailTransportType,
  ): EmailServer {
    const base: EmailServer = {
      id: projectSmtpConfig.id!,
      transportType: transportType,
      username: undefined,
      password: undefined,
      fromEmail: projectSmtpConfig.fromEmail!,
      fromName: projectSmtpConfig.fromName!,
    };

    switch (transportType) {
      case MailTransportType.AmazonSES: {
        const accessKeyId: string =
          projectSmtpConfig.amazonSesAccessKeyId?.trim() || "";
        const secretAccessKey: string =
          projectSmtpConfig.amazonSesSecretAccessKey?.trim() || "";
        const region: string =
          projectSmtpConfig.amazonSesRegion?.trim().toLowerCase() || "";

        if (!accessKeyId) {
          throw new BadDataException(
            "Project SMTP config Amazon SES Access Key ID is not set",
          );
        }

        if (!secretAccessKey) {
          throw new BadDataException(
            "Project SMTP config Amazon SES Secret Access Key is not set",
          );
        }

        if (!region) {
          throw new BadDataException(
            "Project SMTP config Amazon SES Region is not set",
          );
        }

        if (!isAwsRegion(region)) {
          throw new BadDataException(
            `Project SMTP config Amazon SES Region "${region.slice(0, 40)}" is not an AWS Region. Use a code such as us-east-1.`,
          );
        }

        return {
          ...base,
          awsAccessKeyId: accessKeyId,
          awsSecretAccessKey: secretAccessKey,
          awsRegion: region,
        };
      }

      case MailTransportType.SendGrid:
        return {
          ...base,
          apiKey: this.requireKey(
            projectSmtpConfig.sendgridApiKey,
            "SendGrid API Key",
          ),
        };

      case MailTransportType.Mailgun: {
        const apiKey: string = this.requireKey(
          projectSmtpConfig.mailgunApiKey,
          "Mailgun API Key",
        );
        const domain: string =
          projectSmtpConfig.mailgunDomain?.trim().toLowerCase() || "";

        if (!domain) {
          throw new BadDataException(
            "Project SMTP config Mailgun Domain is not set",
          );
        }

        if (!isMailgunDomain(domain)) {
          throw new BadDataException(
            `Project SMTP config Mailgun Domain "${domain.slice(0, 60)}" is not a domain. Use the sending domain as Mailgun lists it, such as mg.example.com.`,
          );
        }

        return {
          ...base,
          apiKey: apiKey,
          mailgunDomain: domain,
          mailgunRegion: toMailgunRegion(projectSmtpConfig.mailgunRegion),
        };
      }

      case MailTransportType.Postmark:
        return {
          ...base,
          apiKey: this.requireKey(
            projectSmtpConfig.postmarkServerToken,
            "Postmark Server API Token",
          ),
        };

      case MailTransportType.Resend:
        return {
          ...base,
          apiKey: this.requireKey(
            projectSmtpConfig.resendApiKey,
            "Resend API Key",
          ),
        };

      default:
        throw new BadDataException(
          `Project SMTP config transport "${transportType}" does not send through an HTTP API.`,
        );
    }
  }

  private requireKey(value: string | undefined, fieldTitle: string): string {
    const key: string = value?.trim() || "";

    if (!key) {
      throw new BadDataException(
        `Project SMTP config ${fieldTitle} is not set`,
      );
    }

    return key;
  }
}
export default new Service();
