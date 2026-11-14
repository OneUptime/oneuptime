import Hostname from "../API/Hostname";
import URL from "../API/URL";
import Email from "../Email";
import ObjectID from "../ObjectID";
import Port from "../Port";
import AmazonSesAuthenticationType from "./AmazonSesAuthenticationType";
import MailgunRegion from "./MailgunRegion";
import MailTransportType from "./MailTransportType";
import OAuthProviderType from "./OAuthProviderType";
import SMTPAuthenticationType from "./SMTPAuthenticationType";

export default interface EmailServer {
  id?: ObjectID | undefined; // If this is custom SMTP, this is the ID of the SMTP config. Otherwise, it's undefined

  /*
   * Transport selection.
   * Defaults to SMTP when undefined for backwards compatibility with existing
   * EmailServer constructions.
   */
  transportType?: MailTransportType | undefined;

  /*
   * SMTP transport fields. Required when transportType === SMTP (or undefined).
   * Not used for HTTP-API transports like MicrosoftGraph.
   */
  host?: Hostname | undefined;
  port?: Port | undefined;
  secure?: boolean | undefined;

  username: string | undefined;
  password: string | undefined;
  fromEmail: Email;
  fromName: string;

  /*
   * OAuth 2.0 fields. Used by:
   * - SMTP transport when authType === OAuth (XOAUTH2)
   * - HTTP-API transports (always — they always authenticate via OAuth2)
   */
  authType?: SMTPAuthenticationType | undefined;
  clientId?: string | undefined; // OAuth Application Client ID
  clientSecret?: string | undefined; // OAuth Application Client Secret
  tokenUrl?: URL | undefined; // OAuth token endpoint URL (e.g., https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token)
  scope?: string | undefined; // OAuth scope(s), space-separated (e.g., https://outlook.office365.com/.default)
  oauthProviderType?: OAuthProviderType | undefined; // OAuth grant type: Client Credentials or JWT Bearer

  /*
   * The keys of the providers that send through an HTTP API of their own.
   * Each transport reads only its own:
   *
   *   - Amazon SES: awsAccessKeyId, awsSecretAccessKey and awsRegion, an
   *     IAM access key allowed ses:SendEmail and the Region the sender's
   *     identity is verified in - or, with awsAuthenticationType
   *     ServerIamRole, the Region alone: it signs in as the server's own
   *     IAM role. Only the server's own settings set that
   *     (Notification/Config.getGlobalEmailProviderServer); a project's
   *     config never does, and is refused if it says so;
   *   - SendGrid, Postmark and Resend: apiKey (Postmark's server API token);
   *   - Mailgun: apiKey, mailgunDomain (the sending domain, such as
   *     mg.example.com) and mailgunRegion (US or EU).
   */
  apiKey?: string | undefined;
  awsAuthenticationType?: AmazonSesAuthenticationType | undefined;
  awsAccessKeyId?: string | undefined;
  awsSecretAccessKey?: string | undefined;
  awsRegion?: string | undefined;
  mailgunDomain?: string | undefined;
  mailgunRegion?: MailgunRegion | undefined;
}
