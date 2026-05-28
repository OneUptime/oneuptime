import SMTPOAuthService from "../SMTPOAuthService";
import MailProvider from "./MailProvider";
import URL from "Common/Types/API/URL";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import BadDataException from "Common/Types/Exception/BadDataException";
import logger from "Common/Server/Utils/Logger";

interface GraphErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * Sends mail via Microsoft Graph
 * (POST https://graph.microsoft.com/v1.0/users/{sender}/sendMail).
 *
 * Why this exists: Microsoft has been disabling SMTP AUTH by default for new
 * tenants since 2022. Customers who already have an Azure AD app with Mail.Send
 * (application) permission cannot use OneUptime's SMTP+XOAUTH2 path even with
 * correct credentials, because the underlying SMTP AUTH is off at the tenant or
 * mailbox level. Graph bypasses SMTP entirely.
 *
 * What's required on the customer's side:
 * - Azure AD app registration
 * - Microsoft Graph → Mail.Send (Application) permission, admin consent granted
 * - Sender mailbox must be a licensed Exchange Online mailbox in the tenant
 *
 * Auth: we use the existing SMTPOAuthService to fetch a Client Credentials
 * token. The recommended scope is `https://graph.microsoft.com/.default`.
 */
export default class MicrosoftGraphMailProvider implements MailProvider {
  private static readonly GRAPH_BASE_URL: string =
    "https://graph.microsoft.com/v1.0";
  private static readonly FETCH_TIMEOUT_MS: number = 30000;

  public async send(
    mail: EmailMessage,
    emailServer: EmailServer,
  ): Promise<void> {
    if (
      !emailServer.clientId ||
      !emailServer.clientSecret ||
      !emailServer.tokenUrl ||
      !emailServer.scope
    ) {
      throw new BadDataException(
        "Microsoft Graph transport requires OAuth credentials " +
          "(Client ID, Client Secret, Token URL, and Scope). " +
          "Typical scope: https://graph.microsoft.com/.default",
      );
    }

    if (!emailServer.fromEmail) {
      throw new BadDataException(
        "Microsoft Graph transport requires a From Email — Graph sends as " +
          "POST /users/{fromEmail}/sendMail and the address must be a licensed " +
          "mailbox in your tenant.",
      );
    }

    const senderAddress: string = emailServer.fromEmail.toString();

    const accessToken: string = await SMTPOAuthService.getAccessToken({
      clientId: emailServer.clientId,
      clientSecret: emailServer.clientSecret,
      tokenUrl: emailServer.tokenUrl,
      scope: emailServer.scope,
      username: emailServer.username || senderAddress,
      providerType:
        emailServer.oauthProviderType || OAuthProviderType.ClientCredentials,
    });

    const endpoint: URL = URL.fromString(
      `${MicrosoftGraphMailProvider.GRAPH_BASE_URL}/users/${encodeURIComponent(
        senderAddress,
      )}/sendMail`,
    );

    const payload: Record<string, unknown> = {
      message: {
        subject: mail.subject,
        body: {
          contentType: "HTML",
          content: mail.body || "",
        },
        toRecipients: [
          {
            emailAddress: {
              address: mail.toEmail.toString(),
            },
          },
        ],
        from: {
          emailAddress: {
            address: senderAddress,
            name: emailServer.fromName,
          },
        },
      },
      saveToSentItems: false,
    };

    logger.debug(
      `Sending mail via Microsoft Graph as ${senderAddress} to ${mail.toEmail.toString()}`,
    );

    const controller: AbortController = new AbortController();
    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
      controller.abort();
    }, MicrosoftGraphMailProvider.FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new BadDataException(
          `Microsoft Graph request timed out after ${MicrosoftGraphMailProvider.FETCH_TIMEOUT_MS}ms. ` +
            `Check network connectivity to graph.microsoft.com.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    // Graph returns 202 Accepted on success, with no body.
    if (response.status === 202) {
      logger.debug("Microsoft Graph accepted the message (HTTP 202).");
      return;
    }

    // Anything else is an error. Try to surface Graph's friendly message.
    const bodyText: string = await response.text();
    let detail: string = bodyText;
    try {
      const parsed: GraphErrorBody = JSON.parse(bodyText) as GraphErrorBody;
      if (parsed.error?.code || parsed.error?.message) {
        detail =
          `${parsed.error.code || ""} ${parsed.error.message || ""}`.trim();
      }
    } catch {
      // body wasn't JSON, keep raw text
    }

    logger.error(
      `Microsoft Graph sendMail failed: ${response.status} — ${detail}`,
    );

    throw new BadDataException(
      MicrosoftGraphMailProvider.explainGraphError(response.status, detail),
    );
  }

  /**
   * Map common Graph errors to actionable messages. The customer-facing config
   * UI is where most of these fail, so the messages need to point at the right
   * Azure setting.
   */
  private static explainGraphError(status: number, detail: string): string {
    if (status === 401) {
      return (
        "Microsoft Graph rejected the OAuth token (401 Unauthorized). " +
        "Verify the Tenant ID in the Token URL, Client ID, and Client Secret. " +
        `Graph said: ${detail}`
      );
    }

    if (status === 403) {
      return (
        "Microsoft Graph denied the send (403 Forbidden). " +
        "Most common cause: the Azure AD app does not have the Mail.Send " +
        "Application permission, or admin consent has not been granted. " +
        `Graph said: ${detail}`
      );
    }

    if (status === 404) {
      return (
        `Microsoft Graph could not find the sender mailbox (404). ` +
        `Verify From Email is a licensed Exchange Online mailbox in your tenant. ` +
        `Graph said: ${detail}`
      );
    }

    if (status === 429) {
      return (
        "Microsoft Graph rate-limited the request (429). " +
        "Reduce send volume or contact Microsoft to raise quota. " +
        `Graph said: ${detail}`
      );
    }

    return `Microsoft Graph sendMail failed with HTTP ${status}. ${detail}`;
  }
}
