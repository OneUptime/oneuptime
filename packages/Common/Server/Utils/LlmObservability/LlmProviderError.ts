import APIException from "../../../Types/Exception/ApiException";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import { redactLogString } from "../LogRedaction";

/*
 * THE ONE ERROR A CONNECTOR THROWS.
 *
 * Every failure of a provider call becomes an LlmProviderError whose message
 * names the step ("usage report", "token request"), says what the provider
 * answered with secrets removed, and carries a kind the read loop and the
 * dashboard act on: a refused key is reported as one, a rate limit pauses
 * the read until the next schedule instead of failing it, and a provider
 * that is down is retried on schedule.
 *
 * The message is stored on the connection (lastError) and shown to the
 * people who manage it, so it goes through redact() before it exists: the
 * connection's own secrets, anything shaped like an API key, and what the
 * shared log redaction knows.
 */

// The shape DataSourceHttpFetch throws for a non-2xx answer.
const TRANSPORT_HTTP_ERROR_REGEX: RegExp =
  /^Data source responded with HTTP (\d{3}):\s*([\s\S]*)$/;

/*
 * Provider API keys and admin keys: OpenAI (sk-..., sk-admin-...,
 * sk-proj-...) and Anthropic (sk-ant-...). The repeat is bounded and the
 * class excludes nothing the pattern starts with, so it runs in linear time
 * on any text.
 */
const PROVIDER_KEY_REGEX: RegExp = /\bsk-[A-Za-z0-9_-]{6,256}/g;

// Longest message kept on the connection, the marker included.
export const MAX_LLM_PROVIDER_ERROR_LENGTH: number = 1000;
const TRUNCATION_MARKER: string = "... (truncated)";
const REDACTED: string = "[REDACTED]";

export interface LlmProviderErrorData {
  message: string;
  kind: LlmConnectionFailureKind;
  statusCode?: number | undefined;
  // Seconds the provider asked us to wait, when it said.
  retryAfterSeconds?: number | undefined;
  /*
   * The provider's answer to a failed request, secrets removed, for a client
   * that reads an error code out of it.
   */
  responseBody?: string | undefined;
}

export default class LlmProviderError extends APIException {
  public kind: LlmConnectionFailureKind;
  public statusCode: number | undefined;
  public retryAfterSeconds: number | undefined;
  public responseBody: string | undefined;

  public constructor(data: LlmProviderErrorData) {
    super(data.message);
    this.kind = data.kind;
    this.statusCode = data.statusCode;
    this.retryAfterSeconds = data.retryAfterSeconds;
    this.responseBody = data.responseBody;
  }

  /*
   * What a status code means when the provider says nothing more specific.
   * 401 is the credential; 403 a role or scope; 404 a subscription, project
   * or group that does not exist (or is not visible to the credential); 429
   * a rate limit; 5xx the provider. A 400 is left as "other": it is as
   * likely to be a request the provider stopped accepting as a setting the
   * person can fix, and the message carries the provider's own reason.
   */
  public static kindFromStatus(status: number): LlmConnectionFailureKind {
    if (status === 401) {
      return LlmConnectionFailureKind.Authentication;
    }

    if (status === 403) {
      return LlmConnectionFailureKind.Permission;
    }

    if (status === 404) {
      return LlmConnectionFailureKind.Settings;
    }

    if (status === 429) {
      return LlmConnectionFailureKind.RateLimited;
    }

    if (status >= 500) {
      return LlmConnectionFailureKind.Unavailable;
    }

    return LlmConnectionFailureKind.Other;
  }

  /*
   * The status and body of a non-2xx answer, read back from the message the
   * shared transport throws (it keeps only those two). Null when the error
   * is not an HTTP answer at all (a timeout, a refused connection, a DNS
   * failure).
   */
  public static readTransportHttpError(
    error: unknown,
  ): { status: number; body: string } | null {
    const message: string =
      error instanceof Error ? error.message : String(error ?? "");
    const match: RegExpExecArray | null =
      TRANSPORT_HTTP_ERROR_REGEX.exec(message);

    if (!match) {
      return null;
    }

    return { status: Number(match[1]), body: match[2] || "" };
  }

  /*
   * A message safe to store and show: the given secret values removed
   * wherever they appear, anything shaped like a provider key removed, the
   * shared redaction rules applied, and the whole held to the stored
   * length.
   */
  public static redact(text: string, secretValues: Array<string> = []): string {
    let redacted: string = text || "";

    for (const secret of secretValues) {
      if (typeof secret !== "string" || secret.length < 4) {
        continue;
      }

      // split/join: an exact, linear replacement of every occurrence.
      redacted = redacted.split(secret).join(REDACTED);
    }

    redacted = redacted.replace(PROVIDER_KEY_REGEX, REDACTED);
    redacted = redactLogString(redacted);

    if (redacted.length > MAX_LLM_PROVIDER_ERROR_LENGTH) {
      redacted =
        redacted.substring(
          0,
          MAX_LLM_PROVIDER_ERROR_LENGTH - TRUNCATION_MARKER.length,
        ) + TRUNCATION_MARKER;
    }

    return redacted;
  }

  /*
   * Any error a connector call ended with, as an LlmProviderError: an
   * LlmProviderError as it is (its message redacted again with the secrets
   * at hand), a transport HTTP failure classified by its status, anything
   * else as "the provider could not be reached".
   */
  public static from(data: {
    error: unknown;
    step: string;
    providerTitle: string;
    secretValues?: Array<string> | undefined;
  }): LlmProviderError {
    const secrets: Array<string> = data.secretValues || [];

    if (data.error instanceof LlmProviderError) {
      return new LlmProviderError({
        message: LlmProviderError.redact(data.error.message, secrets),
        kind: data.error.kind,
        statusCode: data.error.statusCode,
        retryAfterSeconds: data.error.retryAfterSeconds,
        responseBody:
          data.error.responseBody === undefined
            ? undefined
            : LlmProviderError.redact(data.error.responseBody, secrets),
      });
    }

    const http: { status: number; body: string } | null =
      LlmProviderError.readTransportHttpError(data.error);

    if (http) {
      return new LlmProviderError({
        message: LlmProviderError.redact(
          `${data.providerTitle} ${data.step} failed with HTTP ${http.status}: ${http.body}`,
          secrets,
        ),
        kind: LlmProviderError.kindFromStatus(http.status),
        statusCode: http.status,
        responseBody: LlmProviderError.redact(http.body, secrets),
      });
    }

    const reason: string =
      data.error instanceof Error
        ? data.error.message
        : String(data.error ?? "Unknown error.");

    return new LlmProviderError({
      message: LlmProviderError.redact(
        `${data.providerTitle} ${data.step} did not complete: ${reason}`,
        secrets,
      ),
      kind: LlmConnectionFailureKind.Unavailable,
    });
  }
}
