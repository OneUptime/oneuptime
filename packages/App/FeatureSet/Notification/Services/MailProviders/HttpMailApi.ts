import { InlineImageRefusalFlag } from "./InlineImageRefusal";
import BadDataException from "Common/Types/Exception/BadDataException";
import logger from "Common/Server/Utils/Logger";
import { createHash } from "crypto";

/*
 * ONE EMAIL TO A PROVIDER'S HTTP API, THE WAY EVERY ONE IS SENT.
 *
 * Amazon SES, Mailgun, Postmark and Resend are each one HTTPS request per
 * email. What happens around that request is the same for all of them, so
 * it is written once, here:
 *
 *   - A deadline for the whole send, retries included. "Send Test Email"
 *     passes four seconds and expects an answer in that time; a real send
 *     waits as long as it takes, a minute a request at most.
 *   - Retries only for what can go through on a second try: throttling
 *     (429, Amazon SES's TooManyRequestsException), a request the service
 *     timed out (408), the service's own failure (5xx) and a network that
 *     did not answer. A key that is refused, a sender that is not verified
 *     or an address the provider will not send to fails the same way every
 *     time, and is reported at once.
 *   - The wait before a retry is what the provider asked for (Retry-After)
 *     where it says, capped at a minute, else a doubling wait with jitter so
 *     replicas that were throttled together do not all come back together.
 *   - Every failure is a MailApiSendException whose message says what the
 *     provider said and what to change, in the Email Log's words, and never
 *     a key: the provider's own text is scrubbed of the request's secrets.
 *   - At most MAX_IN_FLIGHT_PER_CONFIG requests of one config are in flight
 *     at once (withSendSlot), as Microsoft Graph's mailbox gate does: an
 *     announcement to a thousand subscribers goes out at a pace the
 *     provider's rate limit takes (Resend's is ten requests a second)
 *     rather than as a thousand requests refused together. The gate is
 *     keyed by the provider, the config and a hash of its key, so two
 *     projects never wait on each other, and an edited key starts afresh.
 *
 * Each provider (MailProviders/*MailProvider.ts) builds its request and
 * reads its answer; nothing here knows any provider's format.
 */

export interface MailApiRequest {
  url: string;
  headers: Record<string, string>;
  // A JSON text, or a multipart form (Mailgun's MIME upload).
  body: string | FormData;
}

export interface MailApiAnswer {
  status: number;
  headers: Headers;
  bodyText: string;
}

/*
 * What a provider's send throws: the message the Email Log shows, and what
 * the retry loop and MailService need to know about it.
 */
export class MailApiSendException
  extends BadDataException
  implements InlineImageRefusalFlag
{
  // The HTTP status the provider answered with, when it answered.
  public readonly statusCode: number | undefined;

  // Whether the same request could go through on another try.
  public readonly isRetryable: boolean;

  // How long the provider asked to wait (Retry-After), in seconds.
  public readonly retryAfterSeconds: number | undefined;

  // Whether the provider refused the email for its inline images.
  public readonly refusedInlineImages: boolean;

  public constructor(
    message: string,
    options: {
      statusCode?: number | undefined;
      isRetryable: boolean;
      retryAfterSeconds?: number | undefined;
      refusedInlineImages?: boolean | undefined;
    },
  ) {
    super(message);
    this.statusCode = options.statusCode;
    this.isRetryable = options.isRetryable;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.refusedInlineImages = options.refusedInlineImages === true;
  }
}

// The most a provider's error text adds to a message, so a page of HTML stays a line.
export const MAX_PROVIDER_DETAIL_LENGTH: number = 500;

export default class HttpMailApi {
  // One request's time, when the caller gives no deadline.
  public static readonly REQUEST_TIMEOUT_MS: number = 60000;

  // Requests of one config in flight at once (withSendSlot).
  public static readonly MAX_IN_FLIGHT_PER_CONFIG: number = 5;

  // In-flight requests by slot key (getSlotKey), per process.
  private static readonly inFlight: Map<string, number> = new Map();

  // Tries in all: the first and three retries.
  public static readonly MAX_ATTEMPTS: number = 4;

  // The longest wait honoured, whatever a Retry-After says.
  public static readonly MAX_RETRY_WAIT_MS: number = 60000;

  /*
   * The gate a config's sends share: its provider, its id (null for the
   * server's own settings) and its key, hashed so the map holds no secret.
   * JSON-encoded first, so a separator inside a value cannot make two keys
   * the same.
   */
  public static getSlotKey(data: {
    providerName: string;
    configId?: string | undefined;
    credential: string;
  }): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          data.providerName,
          data.configId || null,
          data.credential,
        ]),
      )
      .digest("hex");
  }

  /*
   * Run `send` once a slot of the config's gate is free, and free it when
   * the send is done, however it ends. The check and the increment happen
   * with no await between them, so two sends cannot both take the last
   * slot.
   */
  public static async withSendSlot<T>(
    slotKey: string,
    send: () => Promise<T>,
    maxInFlight: number = HttpMailApi.MAX_IN_FLIGHT_PER_CONFIG,
  ): Promise<T> {
    while ((HttpMailApi.inFlight.get(slotKey) || 0) >= maxInFlight) {
      await HttpMailApi.sleep(50);
    }

    HttpMailApi.inFlight.set(
      slotKey,
      (HttpMailApi.inFlight.get(slotKey) || 0) + 1,
    );

    try {
      return await send();
    } finally {
      const next: number = (HttpMailApi.inFlight.get(slotKey) || 1) - 1;

      // A config with nothing in flight keeps no entry.
      if (next <= 0) {
        HttpMailApi.inFlight.delete(slotKey);
      } else {
        HttpMailApi.inFlight.set(slotKey, next);
      }
    }
  }

  // How many of a gate's slots are taken now, for tests.
  public static getInFlightCount(slotKey: string): number {
    return HttpMailApi.inFlight.get(slotKey) || 0;
  }

  /*
   * Send one request, as long as `attempt` throws something worth trying
   * again and the deadline allows. `attempt` gets the time this try may
   * take, and throws a MailApiSendException for every failure.
   */
  public static async sendWithRetry(data: {
    providerName: string;
    timeoutMs?: number | undefined;
    attempt: (requestTimeoutMs: number) => Promise<void>;
    maxAttempts?: number | undefined;
    /*
     * Whether a failure is worth another try, and how long the provider
     * asked to wait, for an attempt that throws something other than a
     * MailApiSendException (SendGrid's own client). Read from the
     * MailApiSendException when left out.
     */
    isRetryable?: ((error: unknown) => boolean) | undefined;
    getRetryAfterSeconds?: ((error: unknown) => number | undefined) | undefined;
    // The wait before a retry, for tests: setTimeout when left out.
    sleep?: ((ms: number) => Promise<void>) | undefined;
    random?: (() => number) | undefined;
  }): Promise<void> {
    const deadlineAt: number | undefined =
      data.timeoutMs !== undefined ? Date.now() + data.timeoutMs : undefined;
    const maxAttempts: number = data.maxAttempts || HttpMailApi.MAX_ATTEMPTS;
    const sleep: (ms: number) => Promise<void> =
      data.sleep || HttpMailApi.sleep;

    let lastError: unknown = undefined;

    for (let attempt: number = 1; attempt <= maxAttempts; attempt++) {
      const requestTimeoutMs: number =
        HttpMailApi.getRequestTimeoutMs(deadlineAt);

      if (requestTimeoutMs <= 0) {
        throw (
          lastError ||
          new MailApiSendException(
            `${data.providerName} did not answer within the time this send allows.`,
            { isRetryable: false },
          )
        );
      }

      try {
        await data.attempt(requestTimeoutMs);
        return;
      } catch (error) {
        lastError = error;

        const isRetryable: boolean = data.isRetryable
          ? data.isRetryable(error)
          : error instanceof MailApiSendException && error.isRetryable;

        if (!isRetryable || attempt === maxAttempts) {
          throw error;
        }

        const retryAfterSeconds: number | undefined = data.getRetryAfterSeconds
          ? data.getRetryAfterSeconds(error)
          : error instanceof MailApiSendException
            ? error.retryAfterSeconds
            : undefined;

        const waitMs: number = HttpMailApi.getBackoffMs({
          attempt: attempt,
          retryAfterSeconds: retryAfterSeconds,
          random: data.random || Math.random,
        });

        // A retry that would end past the deadline is not tried.
        if (deadlineAt !== undefined && Date.now() + waitMs >= deadlineAt) {
          throw error;
        }

        logger.warn(
          `${data.providerName} send attempt ${attempt} failed and will be tried again in ${waitMs}ms: ${(error as Error).message}`,
        );

        await sleep(waitMs);
      }
    }

    // The loop returns or throws; this keeps the type checker honest.
    throw lastError;
  }

  /*
   * One request, answered: its status, headers and body as text. A request
   * that never got an answer - the network, DNS, a timeout - throws a
   * retryable MailApiSendException naming the host it was sent to.
   */
  public static async post(data: {
    providerName: string;
    request: MailApiRequest;
    timeoutMs: number;
  }): Promise<MailApiAnswer> {
    const controller: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      controller.abort();
    }, data.timeoutMs);

    const host: string = HttpMailApi.getHost(data.request.url);

    try {
      const response: Response = await fetch(data.request.url, {
        method: "POST",
        headers: data.request.headers,
        body: data.request.body,
        signal: controller.signal,
      });

      return {
        status: response.status,
        headers: response.headers,
        bodyText: await response.text(),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new MailApiSendException(
          `${data.providerName} did not answer within ${Math.round(data.timeoutMs / 1000)} seconds. Check that this server can reach ${host} over HTTPS (port 443).`,
          { isRetryable: true },
        );
      }

      const reason: string =
        error instanceof Error
          ? HttpMailApi.describeNetworkError(error)
          : String(error);

      throw new MailApiSendException(
        `${data.providerName} could not be reached at ${host}: ${reason}. Check that this server can reach ${host} over HTTPS (port 443).`,
        { isRetryable: true },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /*
   * Whether an answer's status is worth another try: throttled, timed out
   * on the provider's side, or the provider's own failure.
   */
  public static isRetryableStatus(status: number): boolean {
    return status === 429 || status === 408 || status >= 500;
  }

  /*
   * The Retry-After header as seconds: delta-seconds ("30") or an HTTP date.
   * Undefined when absent, negative or not a value, so the backoff applies.
   */
  public static parseRetryAfter(
    value: string | null | undefined,
    now: number = Date.now(),
  ): number | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed: string = value.trim();

    if (!trimmed) {
      return undefined;
    }

    const seconds: number = Number(trimmed);

    if (Number.isFinite(seconds)) {
      return seconds >= 0 ? seconds : undefined;
    }

    const date: number = Date.parse(trimmed);

    if (Number.isFinite(date)) {
      return Math.max(0, Math.ceil((date - now) / 1000));
    }

    return undefined;
  }

  // The wait before retry number `attempt` (1 after the first try).
  public static getBackoffMs(data: {
    attempt: number;
    retryAfterSeconds?: number | undefined;
    random: () => number;
  }): number {
    if (data.retryAfterSeconds !== undefined) {
      return Math.min(
        data.retryAfterSeconds * 1000,
        HttpMailApi.MAX_RETRY_WAIT_MS,
      );
    }

    const base: number = Math.pow(2, data.attempt - 1) * 1000;
    const jitter: number = data.random() * 1000;

    return Math.min(base + jitter, HttpMailApi.MAX_RETRY_WAIT_MS);
  }

  /*
   * A provider's own words, made safe to show: every secret the request
   * carried replaced, whitespace collapsed, and cut to a line.
   */
  public static scrub(
    text: string,
    secrets: Array<string | undefined>,
  ): string {
    let scrubbed: string = text || "";

    for (const secret of secrets) {
      if (secret && secret.length >= 4) {
        scrubbed = scrubbed.split(secret).join("[redacted]");
      }
    }

    scrubbed = scrubbed.replace(/\s+/g, " ").trim();

    return scrubbed.length > MAX_PROVIDER_DETAIL_LENGTH
      ? `${scrubbed.slice(0, MAX_PROVIDER_DETAIL_LENGTH)}…`
      : scrubbed;
  }

  // An answer's body as JSON, or undefined when it is not JSON.
  public static readJson(bodyText: string): unknown {
    if (!bodyText) {
      return undefined;
    }

    try {
      return JSON.parse(bodyText);
    } catch {
      return undefined;
    }
  }

  public static getHost(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  private static getRequestTimeoutMs(deadlineAt: number | undefined): number {
    if (deadlineAt === undefined) {
      return HttpMailApi.REQUEST_TIMEOUT_MS;
    }

    return Math.min(HttpMailApi.REQUEST_TIMEOUT_MS, deadlineAt - Date.now());
  }

  /*
   * Node's fetch says only "fetch failed"; the reason (ENOTFOUND,
   * ECONNREFUSED, a certificate it would not trust) is on its cause.
   */
  private static describeNetworkError(error: Error): string {
    const cause: unknown = (error as Error & { cause?: unknown }).cause;

    if (cause && typeof cause === "object") {
      const code: unknown = (cause as { code?: unknown }).code;
      const message: unknown = (cause as { message?: unknown }).message;

      if (typeof code === "string" && code) {
        return typeof message === "string" && message
          ? `${code} (${message})`
          : code;
      }

      if (typeof message === "string" && message) {
        return message;
      }
    }

    return error.message || "the request failed";
  }

  private static async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, ms);
    });
  }
}
