import Dictionary from "../../../Types/Dictionary";
import { JSONValue } from "../../../Types/JSON";
import {
  LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH,
  LLM_PROVIDER_EXCHANGE_MAX_COUNT,
  LLM_PROVIDER_EXCHANGE_TRUNCATED_SUFFIX,
  LLMProviderExchange,
} from "../../../Types/LLM/LLMProviderExchange";
import { AsyncLocalStorage } from "async_hooks";

/*
 * WHAT TEST LLM PROVIDER SAW ON THE WIRE (issue #7080).
 *
 * LLMService reports every HTTP request it sends a provider here, with what
 * came back. Nothing is kept unless a caller asked: only code running inside
 * LLMProviderExchangeRecorder.record() - the Test button's route - collects
 * anything, so a chat turn, an investigation or a background job pays one
 * AsyncLocalStorage lookup and keeps nothing.
 *
 * What is kept is safe to show the person testing, who may change the
 * provider anyway:
 *
 *  - a header that carries a credential (Authorization, api-key,
 *    x-api-key, ...) is masked to its first and last four characters, and a
 *    cookie is "[redacted]";
 *  - a credential in the URL (a password, or a query parameter named like a
 *    key or token) is masked the same way;
 *  - every credential value seen in the request's headers is then masked
 *    wherever else it appears - a body, an error, a provider echoing it;
 *  - a body is cut at LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH characters, and
 *    a test keeps at most LLM_PROVIDER_EXCHANGE_MAX_COUNT exchanges.
 */

export interface LLMProviderExchangeCapture {
  method: string;
  url: string;
  requestHeaders: Dictionary<string> | undefined;
  requestBody?: JSONValue | undefined;
  statusCode?: number | undefined;
  responseHeaders?: unknown;
  responseBody?: unknown;
  error?: string | undefined;
  startedAt: number;
}

// Headers whose value is a credential: masked, so the key can be told apart.
const CREDENTIAL_HEADERS: Set<string> = new Set([
  "authorization",
  "proxy-authorization",
  "api-key",
  "x-api-key",
  "x-goog-api-key",
  "ocp-apim-subscription-key",
]);

// Headers whose value is nobody's business: removed outright.
const REDACTED_HEADERS: Set<string> = new Set(["cookie", "set-cookie"]);

// Query parameters that carry a credential.
const CREDENTIAL_QUERY_PARAMETER: RegExp =
  /^(api[-_]?key|key|token|access[-_]?token|auth|sig|signature|code|secret|password)$/i;

export const REDACTED: string = "[redacted]";

const storage: AsyncLocalStorage<Array<LLMProviderExchange>> =
  new AsyncLocalStorage<Array<LLMProviderExchange>>();

export default class LLMProviderExchangeRecorder {
  /*
   * Runs `work`, collecting every provider request it makes. The exchanges
   * are collected whether `work` resolves or throws: a failed test is when
   * they matter most.
   */
  public static async record<T>(work: () => Promise<T>): Promise<{
    exchanges: Array<LLMProviderExchange>;
    value?: T;
    error?: unknown;
    failed: boolean;
  }> {
    const exchanges: Array<LLMProviderExchange> = [];

    try {
      const value: T = await storage.run(exchanges, work);
      return { exchanges, value, failed: false };
    } catch (error) {
      return { exchanges, error, failed: true };
    }
  }

  public static isRecording(): boolean {
    return storage.getStore() !== undefined;
  }

  // Called by LLMService for each request; keeps nothing outside record().
  public static capture(data: LLMProviderExchangeCapture): void {
    const exchanges: Array<LLMProviderExchange> | undefined =
      storage.getStore();

    if (!exchanges || exchanges.length >= LLM_PROVIDER_EXCHANGE_MAX_COUNT) {
      return;
    }

    try {
      exchanges.push(LLMProviderExchangeRecorder.toExchange(data));
    } catch {
      // A report that cannot be built is left out; the test goes on.
    }
  }

  public static toExchange(
    data: LLMProviderExchangeCapture,
  ): LLMProviderExchange {
    const secrets: Array<string> = LLMProviderExchangeRecorder.findSecrets(
      data.requestHeaders || {},
    );

    const mask: (text: string) => string = (text: string): string => {
      return LLMProviderExchangeRecorder.maskSecrets(text, secrets);
    };

    const exchange: LLMProviderExchange = {
      method: data.method.toUpperCase(),
      url: mask(LLMProviderExchangeRecorder.maskUrl(data.url)),
      requestHeaders: LLMProviderExchangeRecorder.maskHeaders(
        data.requestHeaders,
        mask,
      ),
      durationMs: Math.max(0, Math.round(Date.now() - data.startedAt)),
    };

    if (data.requestBody !== undefined && data.requestBody !== null) {
      exchange.requestBody = LLMProviderExchangeRecorder.sanitizeBody(
        data.requestBody,
        mask,
      );
    }

    if (typeof data.statusCode === "number" && data.statusCode > 0) {
      exchange.statusCode = data.statusCode;
      exchange.responseHeaders = LLMProviderExchangeRecorder.maskHeaders(
        LLMProviderExchangeRecorder.normalizeHeaders(data.responseHeaders),
        mask,
      );

      if (
        data.responseBody !== undefined &&
        data.responseBody !== null &&
        data.responseBody !== ""
      ) {
        exchange.responseBody = LLMProviderExchangeRecorder.sanitizeBody(
          data.responseBody,
          mask,
        );
      }
    }

    if (data.error) {
      exchange.error = mask(data.error);
    }

    return exchange;
  }

  // A credential shown by its ends only: "sk-p…-key", or "…" when short.
  public static maskSecret(value: string): string {
    const trimmed: string = value.trim();

    const bearer: RegExpMatchArray | null = trimmed.match(
      /^(bearer|basic|token)\s+(.+)$/i,
    );

    if (bearer) {
      return `${bearer[1]} ${LLMProviderExchangeRecorder.maskSecret(bearer[2]!)}`;
    }

    if (trimmed.length < 12) {
      return "…";
    }

    return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
  }

  public static maskUrl(url: string): string {
    let parsed: globalThis.URL;

    try {
      parsed = new globalThis.URL(url);
    } catch {
      return url;
    }

    if (parsed.password) {
      parsed.password = REDACTED;
    }

    for (const key of Array.from(parsed.searchParams.keys())) {
      if (CREDENTIAL_QUERY_PARAMETER.test(key)) {
        parsed.searchParams.set(
          key,
          LLMProviderExchangeRecorder.maskSecret(
            parsed.searchParams.get(key) || "",
          ),
        );
      }
    }

    return parsed.toString();
  }

  public static normalizeHeaders(value: unknown): Dictionary<string> {
    const headers: Dictionary<string> = {};

    if (!value || typeof value !== "object") {
      return headers;
    }

    // axios' AxiosHeaders, a plain object, or anything with toJSON.
    const plain: unknown =
      typeof (value as { toJSON?: unknown }).toJSON === "function"
        ? (value as { toJSON: () => unknown }).toJSON()
        : value;

    if (!plain || typeof plain !== "object") {
      return headers;
    }

    for (const [key, raw] of Object.entries(plain as Record<string, unknown>)) {
      if (raw === undefined || raw === null) {
        continue;
      }

      if (Array.isArray(raw)) {
        headers[key.toLowerCase()] = raw.map(String).join(", ");
      } else if (typeof raw !== "object" && typeof raw !== "function") {
        headers[key.toLowerCase()] = String(raw);
      }
    }

    return headers;
  }

  private static maskHeaders(
    headers: Dictionary<string> | undefined,
    mask: (text: string) => string,
  ): Dictionary<string> {
    const masked: Dictionary<string> = {};

    for (const [key, value] of Object.entries(headers || {})) {
      if (value === undefined || value === null) {
        continue;
      }

      const name: string = key.toLowerCase();

      if (REDACTED_HEADERS.has(name)) {
        masked[key] = REDACTED;
      } else if (CREDENTIAL_HEADERS.has(name)) {
        masked[key] = LLMProviderExchangeRecorder.maskSecret(String(value));
      } else {
        masked[key] = mask(String(value));
      }
    }

    return masked;
  }

  private static findSecrets(headers: Dictionary<string>): Array<string> {
    const secrets: Array<string> = [];

    for (const [key, value] of Object.entries(headers)) {
      if (!CREDENTIAL_HEADERS.has(key.toLowerCase()) || !value) {
        continue;
      }

      const raw: string = String(value).trim();
      const token: string = raw.replace(/^(bearer|basic|token)\s+/i, "");

      for (const secret of [raw, token]) {
        // Too short to mask without masking ordinary words too.
        if (secret.length >= 8 && !secrets.includes(secret)) {
          secrets.push(secret);
        }
      }
    }

    // Longest first, so "Bearer sk-..." is masked before "sk-...".
    return secrets.sort((a: string, b: string) => {
      return b.length - a.length;
    });
  }

  private static maskSecrets(text: string, secrets: Array<string>): string {
    let masked: string = text;

    for (const secret of secrets) {
      if (masked.includes(secret)) {
        masked = masked
          .split(secret)
          .join(LLMProviderExchangeRecorder.maskSecret(secret));
      }
    }

    return masked;
  }

  /*
   * A body, masked and cut: kept as JSON when it fits, otherwise as the
   * start of its JSON with a note that it was cut.
   */
  private static sanitizeBody(
    body: unknown,
    mask: (text: string) => string,
  ): JSONValue {
    if (typeof body === "string") {
      return LLMProviderExchangeRecorder.cut(mask(body));
    }

    let serialized: string;

    try {
      serialized = JSON.stringify(body);
    } catch {
      return "[unreadable body]";
    }

    if (serialized === undefined) {
      return "[unreadable body]";
    }

    const masked: string = mask(serialized);

    if (masked.length > LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH) {
      return LLMProviderExchangeRecorder.cut(masked);
    }

    try {
      return JSON.parse(masked) as JSONValue;
    } catch {
      // Masking cut through an escape: keep the text.
      return masked;
    }
  }

  private static cut(text: string): string {
    return text.length > LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH
      ? `${text.slice(0, LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH)}${LLM_PROVIDER_EXCHANGE_TRUNCATED_SUFFIX}`
      : text;
  }
}
