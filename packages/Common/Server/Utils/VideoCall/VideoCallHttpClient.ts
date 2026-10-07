import APIException from "../../../Types/Exception/ApiException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { redactLogString } from "../LogRedaction";

/*
 * The one HTTP path every meeting provider client takes: a deadline on every
 * request, the body read as text and parsed only when it is a JSON object,
 * and a short, redacted summary of an error body for the message a person
 * reads.
 *
 * The fetch is injectable so the provider tests exercise the real request
 * construction and response parsing against recorded shapes, without a
 * network.
 */

export interface VideoCallFetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export interface VideoCallFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
  signal?: AbortSignal | undefined;
}

export type VideoCallFetch = (
  url: string,
  init: VideoCallFetchInit,
) => Promise<VideoCallFetchResponse>;

export interface VideoCallHttpResponse {
  status: number;
  ok: boolean;
  bodyText: string;
  // The body parsed, when it is a JSON object; null for anything else.
  json: JSONObject | null;
}

/*
 * A call is started while an incident is being declared, and a person may
 * be waiting on a Start call button. A provider that accepts the connection
 * and never answers must not hold either for long.
 */
export const VIDEO_CALL_REQUEST_TIMEOUT_IN_MS: number = 15000;

// Enough of an error body to say what went wrong, never a page of HTML.
const MAX_ERROR_SUMMARY_LENGTH: number = 300;

export default class VideoCallHttpClient {
  private fetchImplementation: VideoCallFetch;
  private timeoutInMs: number;

  public constructor(data?: {
    fetchImplementation?: VideoCallFetch | undefined;
    timeoutInMs?: number | undefined;
  }) {
    this.fetchImplementation =
      data?.fetchImplementation || (fetch as unknown as VideoCallFetch);
    this.timeoutInMs =
      typeof data?.timeoutInMs === "number" &&
      Number.isFinite(data.timeoutInMs) &&
      data.timeoutInMs > 0
        ? Math.floor(data.timeoutInMs)
        : VIDEO_CALL_REQUEST_TIMEOUT_IN_MS;
  }

  /*
   * Sends one request. A response of any status is returned, never thrown:
   * what a 400 means differs per provider and per step, and the clients
   * turn it into a message a person can act on. Only the request failing
   * to complete - a timeout, a refused connection - throws, as an
   * APIException naming the step.
   */
  public async request(data: {
    url: string;
    method: "GET" | "POST" | "DELETE";
    headers: Record<string, string>;
    body?: string | undefined;
    // What the request is for, in words: "Zoom token request".
    stepLabel: string;
  }): Promise<VideoCallHttpResponse> {
    const controller: AbortController = new AbortController();
    const timeoutInSeconds: number = Math.max(
      1,
      Math.round(this.timeoutInMs / 1000),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout: Promise<never> = new Promise(
      (
        _resolve: (value: never | PromiseLike<never>) => void,
        reject: (reason?: unknown) => void,
      ): void => {
        timer = setTimeout((): void => {
          controller.abort();
          reject(
            new APIException(
              `${data.stepLabel} timed out after ${timeoutInSeconds} seconds with no response.`,
            ),
          );
        }, this.timeoutInMs);
      },
    );

    try {
      return await Promise.race([
        (async (): Promise<VideoCallHttpResponse> => {
          const response: VideoCallFetchResponse =
            await this.fetchImplementation(data.url, {
              method: data.method,
              headers: data.headers,
              body: data.body,
              signal: controller.signal,
            });

          // The deadline covers the body as well as the response headers.
          const bodyText: string = await response.text();

          return {
            status: response.status,
            ok: response.ok,
            bodyText: bodyText,
            json: VideoCallHttpClient.parseJsonObject(bodyText),
          };
        })(),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof APIException) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new APIException(
          `${data.stepLabel} timed out after ${timeoutInSeconds} seconds with no response.`,
        );
      }

      throw new APIException(
        `${data.stepLabel} failed: ${redactLogString((error as Error)?.message || String(error))}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  public static parseJsonObject(bodyText: string): JSONObject | null {
    if (!bodyText) {
      return null;
    }

    let parsed: JSONValue;

    try {
      parsed = JSON.parse(bodyText) as JSONValue;
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as JSONObject;
  }

  /*
   * The provider's own words for a failed request, shortened and with
   * anything credential-shaped removed: the message is shown on a dashboard,
   * stored on the connection and written to the notification log. Reads the
   * fields the providers use - OAuth's error_description, Zoom's reason and
   * message, Graph's and Google's error.message - and falls back to the body
   * text.
   */
  public static summarizeErrorBody(response: VideoCallHttpResponse): string {
    const json: JSONObject | null = response.json;
    let summary: string = "";

    if (json) {
      const nestedError: JSONValue | undefined = json["error"];

      const candidates: Array<JSONValue | undefined> = [
        json["error_description"],
        json["reason"],
        json["message"],
        nestedError && typeof nestedError === "object"
          ? (nestedError as JSONObject)["message"]
          : undefined,
        typeof nestedError === "string" ? nestedError : undefined,
      ];

      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
          summary = candidate.trim();
          break;
        }
      }
    }

    if (!summary) {
      summary = (response.bodyText || "").trim();
    }

    if (!summary) {
      return `HTTP ${response.status}`;
    }

    // One line: an error body may be a page of HTML or a pretty-printed blob.
    summary = summary.replace(/\s+/g, " ");

    if (summary.length > MAX_ERROR_SUMMARY_LENGTH) {
      summary = `${summary.substring(0, MAX_ERROR_SUMMARY_LENGTH - 1)}…`;
    }

    return redactLogString(summary);
  }

  /*
   * The text a field of a provider's error carries, for matching a known
   * failure (Zoom's numeric code, Graph's error.code, OAuth's error).
   */
  public static readErrorCode(json: JSONObject | null): string {
    if (!json) {
      return "";
    }

    const nestedError: JSONValue | undefined = json["error"];

    if (nestedError && typeof nestedError === "object") {
      const code: JSONValue | undefined = (nestedError as JSONObject)["code"];

      if (typeof code === "string" || typeof code === "number") {
        return String(code);
      }

      const status: JSONValue | undefined = (nestedError as JSONObject)[
        "status"
      ];

      if (typeof status === "string") {
        return status;
      }
    }

    if (typeof nestedError === "string") {
      return nestedError;
    }

    const code: JSONValue | undefined = json["code"];

    if (typeof code === "string" || typeof code === "number") {
      return String(code);
    }

    return "";
  }
}
