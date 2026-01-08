import DatabaseService from "./DatabaseService";
import EmailServer from "../../Types/Email/EmailServer";
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

    if (!projectSmtpConfig.hostname) {
      throw new BadDataException("Project SMTP config host is not set");
    }

    if (!projectSmtpConfig.port) {
      throw new BadDataException("Project SMTP config port is not set");
    }

    // Get auth type, default to UsernamePassword for backward compatibility
    const authType: SMTPAuthenticationType =
      projectSmtpConfig.authType || SMTPAuthenticationType.UsernamePassword;

    // Validate based on auth type
    if (authType === SMTPAuthenticationType.UsernamePassword) {
      if (!projectSmtpConfig.username) {
        throw new BadDataException("Project SMTP config username is not set");
      }

      if (!projectSmtpConfig.password) {
        throw new BadDataException("Project SMTP config password is not set");
      }
    } else if (authType === SMTPAuthenticationType.OAuth) {
      if (!projectSmtpConfig.username) {
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

    if (!projectSmtpConfig.fromEmail) {
      throw new BadDataException("Project SMTP config from email is not set");
    }

    if (!projectSmtpConfig.fromName) {
      throw new BadDataException("Project SMTP config from name is not set");
    }

    return {
      id: projectSmtpConfig.id!,
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
    };
  }
}
export default new Service();
