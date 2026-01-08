import Hostname from "../API/Hostname";
import Email from "../Email";
import ObjectID from "../ObjectID";
import Port from "../Port";
import SMTPAuthenticationType from "./SMTPAuthenticationType";

export default interface EmailServer {
  id?: ObjectID | undefined; // If this is custom SMTP, this is the ID of the SMTP config. Otherwise, it's undefined
  host: Hostname;
  port: Port;
  username: string | undefined;
  password: string | undefined;
  secure: boolean;
  fromEmail: Email;
  fromName: string;

  // OAuth 2.0 fields for Microsoft 365 and other OAuth-enabled SMTP servers
  authType?: SMTPAuthenticationType | undefined;
  clientId?: string | undefined; // Microsoft Entra (Azure AD) Application Client ID
  clientSecret?: string | undefined; // Microsoft Entra (Azure AD) Application Client Secret
  tenantId?: string | undefined; // Microsoft Entra (Azure AD) Tenant ID
}
