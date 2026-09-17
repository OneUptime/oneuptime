import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";

/**
 * Generic interface for delivering email via a non-SMTP transport
 * (e.g. Microsoft Graph API, Gmail API, future providers).
 *
 * Implementations are responsible for:
 * - Authenticating to the provider (typically via SMTPOAuthService)
 * - Translating the EmailMessage into the provider's payload format
 * - Making the HTTP call and surfacing useful errors
 *
 * Implementations should NOT touch templating, logging, or metrics — those live
 * in MailService and run regardless of which transport is used.
 */
export default interface MailProvider {
  /**
   * Send a single rendered email.
   *
   * @param mail - The email to send. Subject and body are already compiled
   *               (Handlebars has run); attachments etc. are not yet supported.
   * @param emailServer - The transport config, including OAuth credentials and
   *                      fromEmail/fromName.
   */
  send(mail: EmailMessage, emailServer: EmailServer): Promise<void>;
}
