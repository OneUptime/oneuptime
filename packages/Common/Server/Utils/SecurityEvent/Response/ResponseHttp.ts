import APIException from "../../../../Types/Exception/ApiException";
import Dictionary from "../../../../Types/Dictionary";
import { JSONValue } from "../../../../Types/JSON";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import { redactLogString, redactLogValue } from "../../LogRedaction";
import { ConnectorTransport } from "../Connectors/Types";

/*
 * The HTTP every response action speaks: one request through the connector
 * transport (the SSRF-guarded DataSourceHttpFetch in production), answered
 * as a status and a body whether the transport returned the response or
 * threw on its status ("Data source responded with HTTP 403: ..."). Bodies
 * that end up in a message are redacted and bounded, and every secret the
 * caller names is scrubbed from them on top.
 */

export interface ResponseHttpRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Dictionary<string> | undefined;
  body?: string | Dictionary<string> | undefined;
  formUrlEncoded?: boolean | undefined;
}

export interface ResponseHttpResult {
  statusCode: number;
  bodyText: string;
  bodyJson: unknown;
}

const TRANSPORT_STATUS_ERROR_PATTERN: RegExp =
  /Data source responded with HTTP (\d{3}):\s*([\s\S]*)$/;

const MAX_ERROR_BODY_LENGTH: number = 500;

export const RESPONSE_ACTION_TIMEOUT_IN_MS: number = 20000;

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export default class ResponseHttp {
  public static async send(data: {
    transport: ConnectorTransport;
    request: ResponseHttpRequest;
    // What the request is, for an error that says where it failed: "Okta user lookup".
    step: string;
    secrets: Array<string>;
  }): Promise<ResponseHttpResult> {
    let response: DataSourceHttpResponse;

    try {
      response = await data.transport({
        method: data.request.method,
        url: data.request.url,
        headers: data.request.headers,
        body: data.request.body,
        formUrlEncoded: data.request.formUrlEncoded,
        timeoutInMs: RESPONSE_ACTION_TIMEOUT_IN_MS,
      });
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);
      const match: RegExpMatchArray | null = message.match(
        TRANSPORT_STATUS_ERROR_PATTERN,
      );

      if (match && match[1]) {
        const bodyText: string = match[2] || "";

        return {
          statusCode: Number(match[1]),
          bodyText,
          bodyJson: tryParseJson(bodyText),
        };
      }

      // No status: a timeout, a refused connection, or the egress guard.
      throw new APIException(
        `${data.step} could not be completed: ${ResponseHttp.scrub(redactLogString(message), data.secrets)}`,
      );
    }

    return {
      statusCode: response.statusCode,
      bodyText: response.bodyText || "",
      bodyJson:
        response.bodyJson !== undefined
          ? response.bodyJson
          : tryParseJson(response.bodyText || ""),
    };
  }

  public static isSuccess(result: ResponseHttpResult): boolean {
    return result.statusCode >= 200 && result.statusCode < 300;
  }

  // The body of a failed response, safe to put in a message.
  public static describeBody(
    result: ResponseHttpResult,
    secrets: Array<string>,
  ): string {
    let body: string =
      result.bodyJson !== undefined
        ? JSON.stringify(redactLogValue(result.bodyJson as JSONValue))
        : redactLogString(result.bodyText || "");

    body = ResponseHttp.scrub(body || "(empty body)", secrets);

    return body.length > MAX_ERROR_BODY_LENGTH
      ? `${body.slice(0, MAX_ERROR_BODY_LENGTH)}…`
      : body;
  }

  public static failure(data: {
    step: string;
    result: ResponseHttpResult;
    secrets: Array<string>;
    hint?: string | undefined;
  }): APIException {
    return new APIException(
      `${data.step} failed (HTTP ${data.result.statusCode}): ${ResponseHttp.describeBody(data.result, data.secrets)}${data.hint ? ` ${data.hint}` : ""}`,
    );
  }

  // Every secret named, replaced wherever it appears; split and joined, so no pattern is built from it.
  public static scrub(text: string, secrets: Array<string>): string {
    let scrubbed: string = text;

    for (const secret of secrets) {
      if (secret && secret.length >= 4) {
        scrubbed = scrubbed.split(secret).join("[REDACTED]");
      }
    }

    return scrubbed;
  }
}
