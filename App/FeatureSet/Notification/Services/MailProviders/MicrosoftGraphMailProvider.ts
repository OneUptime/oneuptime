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
 * Error thrown by a single Graph sendMail attempt. Carries enough metadata for
 * the retry loop to decide whether to retry and how long to wait.
 *
 * Extends BadDataException so the message still surfaces cleanly in the email
 * log / on-call timeline once retries are exhausted.
 */
class GraphSendException extends BadDataException {
  /*
   * Whether retrying this request could plausibly succeed (throttling, 5xx,
   * network blips). False for auth/permission/mailbox errors that will fail
   * identically on every retry.
   */
  public readonly isRetryable: boolean;

  /*
   * Value of Graph's `Retry-After` header (seconds), when present. The server
   * is telling us exactly how long to wait — always prefer this over our own
   * backoff.
   */
  public readonly retryAfterSeconds: number | undefined;

  public constructor(
    message: string,
    options: { isRetryable: boolean; retryAfterSeconds?: number | undefined },
  ) {
    super(message);
    this.isRetryable = options.isRetryable;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
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
 *
 * Throttling: Graph enforces a per-mailbox concurrency limit on sendMail and
 * returns 429 "ApplicationThrottled — over its MailboxConcurrency limit" when a
 * single mailbox has too many requests in flight at once. OneUptime fans out
 * many notifications through one sender mailbox, so this provider owns two
 * safeguards:
 *   1. A per-mailbox concurrency gate that keeps in-flight sendMail calls below
 *      the limit (primary defense — avoids tripping the throttle at all).
 *   2. A retry loop that honors Graph's `Retry-After` header (secondary defense
 *      — recovers gracefully if we still get throttled, e.g. across replicas).
 */
export default class MicrosoftGraphMailProvider implements MailProvider {
  private static readonly GRAPH_BASE_URL: string =
    "https://graph.microsoft.com/v1.0";
  private static readonly FETCH_TIMEOUT_MS: number = 30000;

  /*
   * Microsoft documents a limit of ~4 concurrent requests per mailbox for
   * Outlook/Exchange (EWS and Graph). We cap below that to leave headroom.
   *
   * Note: this counter is per-process, so in a multi-replica deployment the
   * effective cap is (replicas × this value). That is exactly why the
   * Retry-After-aware retry below exists — it absorbs the residual throttling
   * that a per-process gate alone cannot prevent across replicas.
   */
  private static readonly MAX_CONCURRENT_PER_MAILBOX: number = 3;

  /*
   * Live count of in-flight sendMail requests, keyed by lowercased sender
   * mailbox. Shared across all instances (the class is instantiated per send).
   */
  private static readonly mailboxConcurrency: Map<string, number> = new Map();

  private static readonly MAX_RETRIES: number = 4;

  /*
   * Cap on how long we will honor a Retry-After value, so a pathologically
   * large header can't pin a worker for minutes.
   */
  private static readonly MAX_RETRY_WAIT_MS: number = 60000;

  public async send(
    mail: EmailMessage,
    emailServer: EmailServer,
    options?: { timeoutMs?: number | undefined } | undefined,
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

    /*
     * Optional total deadline. Callers like the "Test mail config" endpoint pass
     * a short timeout expecting a fast failure; without this the retry loop
     * (up to MAX_RETRIES × FETCH_TIMEOUT_MS + backoff) could run for minutes and
     * make the UI hang. An absolute timestamp is easier to reason about than a
     * shrinking budget as we thread it through the retry loop.
     */
    const deadlineAt: number | undefined =
      options && options.timeoutMs !== undefined
        ? Date.now() + options.timeoutMs
        : undefined;

    // Gate on the sender mailbox to stay under Graph's MailboxConcurrency limit.
    await MicrosoftGraphMailProvider.acquireMailboxSlot(senderAddress);

    try {
      await this.sendWithRetry(mail, emailServer, senderAddress, deadlineAt);
    } finally {
      MicrosoftGraphMailProvider.releaseMailboxSlot(senderAddress);
    }
  }

  /**
   * Retry loop that honors Graph's Retry-After header on throttling and only
   * retries errors that could plausibly succeed on a subsequent attempt.
   *
   * When `deadlineAt` is set, the loop never runs past it: the per-attempt fetch
   * timeout shrinks to the remaining budget, and a retry is skipped if its
   * backoff would blow the deadline. This bounds the worst case for callers that
   * supply a timeout.
   */
  private async sendWithRetry(
    mail: EmailMessage,
    emailServer: EmailServer,
    senderAddress: string,
    deadlineAt: number | undefined,
  ): Promise<void> {
    let lastError: unknown;

    for (
      let attempt: number = 1;
      attempt <= MicrosoftGraphMailProvider.MAX_RETRIES;
      attempt++
    ) {
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
        throw (
          lastError ??
          new GraphSendException(
            "Microsoft Graph send exceeded the caller-supplied timeout before completing.",
            { isRetryable: false },
          )
        );
      }

      try {
        const fetchTimeoutMs: number =
          MicrosoftGraphMailProvider.effectiveFetchTimeoutMs(deadlineAt);
        await this.sendOnce(mail, emailServer, senderAddress, fetchTimeoutMs);
        return;
      } catch (error) {
        lastError = error;

        const isRetryable: boolean =
          error instanceof GraphSendException && error.isRetryable;

        if (
          !isRetryable ||
          attempt === MicrosoftGraphMailProvider.MAX_RETRIES
        ) {
          throw error;
        }

        const retryAfterSeconds: number | undefined =
          error instanceof GraphSendException
            ? error.retryAfterSeconds
            : undefined;

        const waitTime: number = MicrosoftGraphMailProvider.computeBackoffMs(
          attempt,
          retryAfterSeconds,
        );

        /*
         * Don't wait (and retry) if doing so would exceed the caller's deadline —
         * surface the failure now instead of blocking past the budget.
         */
        if (deadlineAt !== undefined && Date.now() + waitTime >= deadlineAt) {
          throw error;
        }

        logger.warn(
          `Microsoft Graph send attempt ${attempt} failed (retryable). ` +
            `Retrying in ${waitTime}ms` +
            (retryAfterSeconds !== undefined
              ? ` (Graph Retry-After: ${retryAfterSeconds}s).`
              : `.`),
        );

        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, waitTime);
        });
      }
    }

    /*
     * Unreachable in practice — the loop either returns or throws — but keeps
     * the type checker and future edits honest.
     */
    throw lastError;
  }

  /**
   * Perform a single Graph sendMail call. Success is a no-op; failures throw a
   * GraphSendException tagged with retryability + Retry-After.
   */
  private async sendOnce(
    mail: EmailMessage,
    emailServer: EmailServer,
    senderAddress: string,
    fetchTimeoutMs: number,
  ): Promise<void> {
    const accessToken: string = await SMTPOAuthService.getAccessToken({
      clientId: emailServer.clientId!,
      clientSecret: emailServer.clientSecret!,
      tokenUrl: emailServer.tokenUrl!,
      scope: emailServer.scope!,
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
    }, fetchTimeoutMs);

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
      // Timeouts and network errors are transient — worth retrying.
      if (error instanceof Error && error.name === "AbortError") {
        throw new GraphSendException(
          `Microsoft Graph request timed out after ${fetchTimeoutMs}ms. ` +
            `Check network connectivity to graph.microsoft.com.`,
          { isRetryable: true },
        );
      }
      throw new GraphSendException(
        `Microsoft Graph request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { isRetryable: true },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // Graph returns 202 Accepted on success, with no body.
    if (response.status === 202) {
      logger.debug("Microsoft Graph accepted the message (HTTP 202).");
      return;
    }

    // Read Retry-After before consuming the body — Graph sets it on 429/503.
    const retryAfterSeconds: number | undefined =
      MicrosoftGraphMailProvider.parseRetryAfter(
        response.headers.get("Retry-After"),
      );

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

    /*
     * 429 (throttling), 408 (request timeout) and 5xx (transient server) are
     * retryable; auth, permission and mailbox errors (4xx) are not.
     */
    const isRetryable: boolean =
      response.status === 429 ||
      response.status === 408 ||
      response.status >= 500;

    throw new GraphSendException(
      MicrosoftGraphMailProvider.explainGraphError(response.status, detail),
      { isRetryable, retryAfterSeconds },
    );
  }

  /**
   * Wait for a free concurrency slot for this mailbox, then reserve it.
   *
   * The check-then-increment is atomic under Node's single-threaded model (no
   * await between the passing check and the increment), so concurrent callers
   * cannot both slip past the cap. Mirrors the SMTP TransporterPool semaphore.
   */
  private static async acquireMailboxSlot(mailbox: string): Promise<void> {
    const key: string = mailbox.toLowerCase();

    while (
      (this.mailboxConcurrency.get(key) || 0) >= this.MAX_CONCURRENT_PER_MAILBOX
    ) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 100);
      });
    }

    this.mailboxConcurrency.set(
      key,
      (this.mailboxConcurrency.get(key) || 0) + 1,
    );
  }

  private static releaseMailboxSlot(mailbox: string): void {
    const key: string = mailbox.toLowerCase();
    const current: number = this.mailboxConcurrency.get(key) || 0;
    const next: number = Math.max(0, current - 1);

    /*
     * Delete the key when it drops to 0 rather than leaving a 0-count entry —
     * acquireMailboxSlot treats absent and 0 identically via `(get(key) || 0)`,
     * so this is behavior-preserving and keeps the Map from growing unbounded in
     * multi-tenant deployments with many distinct sender mailboxes.
     */
    if (next === 0) {
      this.mailboxConcurrency.delete(key);
    } else {
      this.mailboxConcurrency.set(key, next);
    }
  }

  /**
   * The per-attempt fetch timeout: the standard FETCH_TIMEOUT_MS, but never more
   * than the time remaining before a caller-supplied deadline. Returns 0 once
   * the deadline has passed (the caller checks the deadline before using this).
   */
  private static effectiveFetchTimeoutMs(
    deadlineAt: number | undefined,
  ): number {
    if (deadlineAt === undefined) {
      return this.FETCH_TIMEOUT_MS;
    }

    const remaining: number = deadlineAt - Date.now();
    return Math.max(0, Math.min(this.FETCH_TIMEOUT_MS, remaining));
  }

  /**
   * Parse the `Retry-After` header. Graph returns delta-seconds (a number). The
   * HTTP-date form is uncommon here and we fall back to computed backoff for it.
   */
  private static parseRetryAfter(
    headerValue: string | null,
  ): number | undefined {
    if (!headerValue) {
      return undefined;
    }

    /*
     * Number.isFinite (not !isNaN) so non-finite values like "Infinity" fall
     * through to computed backoff instead of pinning the wait at the 60s cap.
     */
    const seconds: number = Number(headerValue);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds;
    }

    return undefined;
  }

  /**
   * Prefer Graph's Retry-After (capped), otherwise exponential backoff with
   * jitter to avoid a thundering herd of retries.
   */
  private static computeBackoffMs(
    attempt: number,
    retryAfterSeconds: number | undefined,
  ): number {
    if (retryAfterSeconds !== undefined) {
      return Math.min(retryAfterSeconds * 1000, this.MAX_RETRY_WAIT_MS);
    }

    const baseWaitTime: number = Math.pow(2, attempt - 1) * 1000;
    const jitter: number = Math.random() * 1000;
    return Math.min(baseWaitTime + jitter, this.MAX_RETRY_WAIT_MS);
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
        "OneUptime limits concurrent sends per mailbox and retries with the " +
        "Retry-After delay, but Graph is still throttling this mailbox. " +
        "Reduce send volume or contact Microsoft to raise quota. " +
        `Graph said: ${detail}`
      );
    }

    return `Microsoft Graph sendMail failed with HTTP ${status}. ${detail}`;
  }
}
