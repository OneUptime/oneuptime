import Dictionary from "../Dictionary";
import { JSONObject, JSONValue } from "../JSON";

/*
 * ONE HTTP REQUEST OneUptime SENT AN LLM PROVIDER, AND WHAT CAME BACK.
 *
 * Test LLM Provider shows these under its verdict (issue #7080), so the
 * person setting a provider up can see exactly what was sent and what the
 * provider answered: the request's address, headers and body, then the
 * status, headers and body of the answer - or, when nothing answered, why.
 *
 * Every secret is masked before an exchange leaves the server
 * (LLMProviderExchangeRecorder): the API key in a header, a URL or a body
 * reads as "sk-p…-key", and a cookie as "[redacted]". A body longer than
 * LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH is cut, and says so.
 */
export interface LLMProviderExchange {
  method: string;
  url: string;
  requestHeaders: Dictionary<string>;
  requestBody?: JSONValue | undefined;
  // Absent when the provider never answered (see error).
  statusCode?: number | undefined;
  responseHeaders?: Dictionary<string> | undefined;
  responseBody?: JSONValue | undefined;
  // Why no answer came: unreachable, refused by the egress policy, timed out.
  error?: string | undefined;
  durationMs: number;
}

// The most exchanges one test reports: the rest are dropped.
export const LLM_PROVIDER_EXCHANGE_MAX_COUNT: number = 10;

// The longest a body is kept, in characters of its JSON.
export const LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH: number = 16000;

export const LLM_PROVIDER_EXCHANGE_TRUNCATED_SUFFIX: string =
  "… (cut: the rest was longer than OneUptime shows)";

function readHeaders(value: JSONValue | undefined): Dictionary<string> {
  const headers: Dictionary<string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return headers;
  }

  for (const [key, raw] of Object.entries(value as JSONObject)) {
    if (typeof raw === "string") {
      headers[key] = raw;
    }
  }

  return headers;
}

/*
 * The exchanges a server's answer carries, read defensively: anything not
 * shaped like one is skipped, so an older or odd answer shows none rather
 * than breaking the dialog.
 */
export function readLLMProviderExchanges(
  value: JSONValue | undefined,
): Array<LLMProviderExchange> {
  if (!Array.isArray(value)) {
    return [];
  }

  const exchanges: Array<LLMProviderExchange> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const raw: JSONObject = item as JSONObject;

    if (typeof raw["method"] !== "string" || typeof raw["url"] !== "string") {
      continue;
    }

    const exchange: LLMProviderExchange = {
      method: raw["method"],
      url: raw["url"],
      requestHeaders: readHeaders(raw["requestHeaders"]),
      durationMs:
        typeof raw["durationMs"] === "number" &&
        Number.isFinite(raw["durationMs"])
          ? raw["durationMs"]
          : 0,
    };

    if (raw["requestBody"] !== undefined && raw["requestBody"] !== null) {
      exchange.requestBody = raw["requestBody"];
    }

    if (typeof raw["statusCode"] === "number") {
      exchange.statusCode = raw["statusCode"];
    }

    if (raw["responseHeaders"] !== undefined) {
      exchange.responseHeaders = readHeaders(raw["responseHeaders"]);
    }

    if (raw["responseBody"] !== undefined && raw["responseBody"] !== null) {
      exchange.responseBody = raw["responseBody"];
    }

    if (typeof raw["error"] === "string" && raw["error"]) {
      exchange.error = raw["error"];
    }

    exchanges.push(exchange);

    if (exchanges.length >= LLM_PROVIDER_EXCHANGE_MAX_COUNT) {
      break;
    }
  }

  return exchanges;
}
