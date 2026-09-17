import Hostname from "../API/Hostname";
import URL from "../API/URL";
import Email from "../Email";
import ObjectID from "../ObjectID";
import Port from "../Port";
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
}
