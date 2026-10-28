import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import { DataSourceHttpResponse } from "../DataSource/HttpFetch";
import { LlmConnectorTransport } from "./LlmConnectorTypes";
import LlmProviderError from "./LlmProviderError";

/*
 * One request to a provider API, the way every connection client makes it:
 * through the injected transport (the SSRF-guarded fetch in production),
 * held to a deadline of its own so a transport that never settles cannot pin
 * a read, and answered as a JSON object or an LlmProviderError whose message
 * names the provider and the step and carries no secret.
 */

export const LLM_PROVIDER_DEFAULT_TIMEOUT_IN_MS: number = 60 * 1000;

export interface LlmProviderRequest {
  transport: LlmConnectorTransport;
  // PATCH: a cloud connection's response actions, which change one setting.
  method: "GET" | "POST" | "PATCH";
  url: string;
  headers?: Dictionary<string> | undefined;
  // A JSON body (POST), sent as written when it is a string.
  body?: string | Dictionary<string> | undefined;
  formUrlEncoded?: boolean | undefined;
  timeoutInMs?: number | undefined;
  // Keep the body's bytes in the answer's bodyBytes: a file, not text.
  keepBodyBytes?: boolean | undefined;
  // What the request is for, in the error: "usage report".
  step: string;
  providerTitle: string;
  // The connection's secrets, removed from any error text.
  secretValues: Array<string>;
}

/*
 * A query string with repeated keys, in the order given: OpenAI and
 * Anthropic take lists as `group_by[]=model&group_by[]=project_id`.
 */
export function buildQueryString(
  params: Array<[string, string | number | boolean | undefined | null]>,
): string {
  const parts: Array<string> = [];

  for (const [key, value] of params) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  }

  return parts.join("&");
}

export default class LlmProviderHttp {
  public static async requestJson(
    request: LlmProviderRequest,
  ): Promise<JSONObject> {
    const response: DataSourceHttpResponse = await this.send(request);

    const json: unknown = response.bodyJson;

    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new LlmProviderError({
        message: LlmProviderError.redact(
          `${request.providerTitle} ${request.step} returned a response that is not a JSON object (HTTP ${response.statusCode}).`,
          request.secretValues,
        ),
        kind: LlmConnectionFailureKind.Other,
        statusCode: response.statusCode,
      });
    }

    return json as JSONObject;
  }

  public static async send(
    request: LlmProviderRequest,
  ): Promise<DataSourceHttpResponse> {
    const timeoutInMs: number =
      request.timeoutInMs && request.timeoutInMs > 0
        ? request.timeoutInMs
        : LLM_PROVIDER_DEFAULT_TIMEOUT_IN_MS;

    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const deadline: Promise<never> = new Promise<never>(
      (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
        timer = setTimeout(() => {
          reject(
            new LlmProviderError({
              message: `${request.providerTitle} ${request.step} timed out after ${Math.round(
                timeoutInMs / 1000,
              )} seconds.`,
              kind: LlmConnectionFailureKind.Unavailable,
            }),
          );
        }, timeoutInMs + 1000);
      },
    );

    try {
      return await Promise.race([
        request.transport({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: request.body,
          formUrlEncoded: request.formUrlEncoded,
          timeoutInMs: timeoutInMs,
          ...(request.keepBodyBytes ? { keepBodyBytes: true } : {}),
        }),
        deadline,
      ]);
    } catch (error) {
      throw LlmProviderError.from({
        error,
        step: request.step,
        providerTitle: request.providerTitle,
        secretValues: request.secretValues,
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

// A finite, non-negative number read off a provider's JSON; 0 otherwise.
export function readCount(value: unknown): number {
  const numeric: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

// A string read off a provider's JSON; "" for anything else.
export function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// An object read off a provider's JSON; {} for anything else.
export function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

// An array read off a provider's JSON; [] for anything else.
export function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}
