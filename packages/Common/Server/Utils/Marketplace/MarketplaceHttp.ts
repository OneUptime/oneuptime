/*
 * The one HTTP call the marketplace clients make, behind a function type so
 * their tests hand in canned responses and see exactly what was sent.
 *
 * Every request has a deadline. Node's fetch has none of its own, and a
 * marketplace API that accepts a connection and never answers would
 * otherwise hold a webhook (which the marketplace times out and retries) or
 * the hourly usage report behind it indefinitely.
 */

export type MarketplaceHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface MarketplaceHttpRequest {
  method: MarketplaceHttpMethod;
  url: string;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
  timeoutInMs?: number | undefined;
}

export interface MarketplaceHttpResponse {
  status: number;
  getHeader: (name: string) => string | null;
  body: string;
}

export type MarketplaceHttpClient = (
  request: MarketplaceHttpRequest,
) => Promise<MarketplaceHttpResponse>;

export const DEFAULT_MARKETPLACE_HTTP_TIMEOUT_IN_MS: number = 30_000;

export const defaultMarketplaceHttpClient: MarketplaceHttpClient = async (
  request: MarketplaceHttpRequest,
): Promise<MarketplaceHttpResponse> => {
  const response: Response = await fetch(request.url, {
    method: request.method,
    headers: request.headers || {},
    body: request.body ?? null,
    redirect: "error",
    signal: AbortSignal.timeout(
      request.timeoutInMs || DEFAULT_MARKETPLACE_HTTP_TIMEOUT_IN_MS,
    ),
  });

  return {
    status: response.status,
    getHeader: (name: string): string | null => {
      return response.headers.get(name);
    },
    body: await response.text(),
  };
};

export class MarketplaceHttp {
  // The body as a JSON object, or null when it is empty or not an object.
  public static parseJsonObject(body: string): Record<string, unknown> | null {
    if (!body || !body.trim()) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(body);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }

      return null;
    } catch {
      return null;
    }
  }

  public static isSuccess(status: number): boolean {
    return status >= 200 && status < 300;
  }

  /*
   * A status worth sending the same request again for: throttling and the
   * server's own failures. Anything else in the 4xx range is an answer.
   */
  public static isRetryable(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  /*
   * A response body cut down for a log line or an error column. Cut before
   * the whitespace is folded, so the regular expression never reads more
   * than a few kilobytes of whatever a server sent back.
   */
  public static summarize(body: string, maxLength: number = 300): string {
    const flat: string = (body || "")
      .substring(0, maxLength * 4)
      .replace(/\s+/g, " ")
      .trim();

    if (flat.length <= maxLength) {
      return flat;
    }

    return `${flat.substring(0, maxLength)}...`;
  }
}
