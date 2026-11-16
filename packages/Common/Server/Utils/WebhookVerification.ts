import Dictionary from "../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../Types/JSON";
import WebhookVerificationProvider from "../../Types/Monitor/IncomingMonitor/WebhookVerificationProvider";
import { ExpressRequest, ExpressResponse } from "./Express";

/*
 * WEBHOOK VERIFICATION HANDSHAKES, ANSWERED.
 *
 * https://github.com/OneUptime/oneuptime/issues/8429
 *
 * Some services check an endpoint before they deliver anything to it: they
 * send it a request, and deliver only once it answers in the way their
 * protocol sets. An Incoming Request monitor's URL and a workflow's Webhook
 * trigger answered every request with the same fixed body, so none of these
 * services could be pointed at them:
 *
 *   - Azure Event Grid, Event Grid schema: a POST with
 *     "aeg-event-type: SubscriptionValidation" and one
 *     Microsoft.EventGrid.SubscriptionValidationEvent, answered
 *     {"validationResponse": "<data.validationCode>"}. (Its validationUrl,
 *     which someone could open within 10 minutes, was the only way.)
 *   - Azure Event Grid, CloudEvents 1.0 schema - and any sender of the
 *     CloudEvents webhook abuse protection: an OPTIONS request with
 *     WebHook-Request-Origin, answered with WebHook-Allowed-Origin naming
 *     that origin, and WebHook-Allowed-Rate. The CORS middleware answered
 *     every OPTIONS itself, so such a subscription could not be created.
 *   - Slack's Events API: a POST of {"type": "url_verification",
 *     "challenge": "..."}, answered {"challenge": "..."}.
 *   - Microsoft Graph change notifications: a POST with an empty body and
 *     ?validationToken=..., answered with the token as text/plain, within
 *     10 seconds.
 *   - Okta event hooks: a GET with X-Okta-Verification-Challenge, answered
 *     {"verification": "..."}.
 *
 * Only these exact shapes are recognized, and an answer echoes nothing but
 * what the protocol defines - the code, challenge, token or origin - once it
 * has passed a length and character check: a value no service would mint is
 * never echoed, and anything else the request carried never is. The answer
 * is JSON or text/plain (never a type a browser renders), with nosniff and
 * no-store; the origin goes into a header only as a plain host name, so
 * nothing can split it.
 *
 * Recognizing a handshake is not answering it: the endpoint decides that.
 * An Incoming Request monitor's URL answers one only for a monitor's key, and
 * only once the project's incoming request secret requirement has let the
 * request through (IncomingRequestSecretGate); a workflow's Webhook trigger
 * only for a workflow that is on. Shared by both (and by StartServer, which
 * lets a CloudEvents validation past the CORS middleware).
 */

export { WebhookVerificationProvider };

// A request, as the recognizer reads it.
export interface WebhookVerificationRequest {
  method: string;
  headers: Dictionary<string | Array<string> | undefined> | undefined;
  query: unknown;
  body: unknown;
}

export interface WebhookVerificationAnswer {
  provider: WebhookVerificationProvider;
  // The body answered as JSON, when the protocol asks for one.
  json?: JSONObject | undefined;
  // The body answered as text/plain, when the protocol asks for one.
  text?: string | undefined;
  // The headers the protocol asks for on the answer.
  headers: Dictionary<string>;
}

// The longest code, challenge or token echoed back.
export const MAX_VERIFICATION_TOKEN_LENGTH: number = 512;

// The longest origin named back: the longest DNS name.
export const MAX_VERIFICATION_ORIGIN_LENGTH: number = 253;

/*
 * A code, challenge or verification value as these services mint them: a
 * GUID, hex, base64 or base64url text. Nothing that means something in HTML,
 * in JSON or in a header.
 */
const OPAQUE_TOKEN: RegExp = /^[A-Za-z0-9._~+/=-]+$/;

/*
 * Microsoft Graph's validation token is a sentence ("Validation: Testing
 * client application reachability for subscription Request-Id: <guid>"):
 * visible ASCII and spaces, still without < > & " ' ` or a backslash.
 */
const TEXT_TOKEN: RegExp = /^[A-Za-z0-9 ._~+/=:;,()@!?#*$%[\]{}|^-]+$/;

// A DNS host name, as WebHook-Request-Origin names its sender.
const HOST_NAME: RegExp =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export const EVENT_GRID_EVENT_TYPE_HEADER: string = "aeg-event-type";
export const EVENT_GRID_SUBSCRIPTION_VALIDATION: string =
  "SubscriptionValidation";
export const EVENT_GRID_VALIDATION_EVENT_TYPE: string =
  "Microsoft.EventGrid.SubscriptionValidationEvent";

export const CLOUD_EVENTS_REQUEST_ORIGIN_HEADER: string =
  "WebHook-Request-Origin";
export const CLOUD_EVENTS_ALLOWED_ORIGIN_HEADER: string =
  "WebHook-Allowed-Origin";
export const CLOUD_EVENTS_ALLOWED_RATE_HEADER: string = "WebHook-Allowed-Rate";

// What a browser's CORS preflight always carries, and a validation never does.
const CORS_PREFLIGHT_HEADER: string = "access-control-request-method";

/*
 * The methods these endpoints take, as the CloudEvents answer lists them
 * (HEAD is read as GET).
 */
export const VERIFIED_ENDPOINT_METHODS: string = "GET, POST, OPTIONS";

export const SLACK_URL_VERIFICATION: string = "url_verification";

export const GRAPH_VALIDATION_TOKEN_PARAMETER: string = "validationToken";

export const OKTA_VERIFICATION_CHALLENGE_HEADER: string =
  "x-okta-verification-challenge";

type IsPlainObjectFunction = (value: unknown) => value is JSONObject;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value)
  );
};

type IsTokenFunction = (value: unknown) => value is string;

const isOpaqueToken: IsTokenFunction = (value: unknown): value is string => {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_VERIFICATION_TOKEN_LENGTH &&
    OPAQUE_TOKEN.test(value)
  );
};

const isTextToken: IsTokenFunction = (value: unknown): value is string => {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_VERIFICATION_TOKEN_LENGTH &&
    value.trim() === value &&
    TEXT_TOKEN.test(value)
  );
};

const isHostName: IsTokenFunction = (value: unknown): value is string => {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_VERIFICATION_ORIGIN_LENGTH &&
    HOST_NAME.test(value)
  );
};

export default class WebhookVerification {
  /*
   * The answer a verification handshake expects, or null when the request
   * is not one: any other request, or a handshake whose value no service
   * would mint.
   */
  public static recognize(
    request: WebhookVerificationRequest,
  ): WebhookVerificationAnswer | null {
    switch ((request.method || "").toUpperCase()) {
      case "POST":
        return (
          WebhookVerification.recognizeEventGrid(request) ||
          WebhookVerification.recognizeSlack(request) ||
          WebhookVerification.recognizeMicrosoftGraph(request)
        );
      case "GET":
        return WebhookVerification.recognizeOkta(request);
      case "OPTIONS":
        return WebhookVerification.recognizeCloudEvents(request);
      default:
        return null;
    }
  }

  // What an Express request is, to the recognizer.
  public static readRequest(req: ExpressRequest): WebhookVerificationRequest {
    return {
      method: req.method,
      headers: req.headers,
      query: req.query,
      body: req.body,
    };
  }

  /*
   * Whether a request is a CloudEvents webhook validation - an OPTIONS
   * request naming its sender in WebHook-Request-Origin - rather than a
   * browser's CORS preflight, which always carries
   * Access-Control-Request-Method. StartServer lets it past the CORS
   * middleware, which would answer it itself, so the endpoint can.
   */
  public static isCloudEventsValidation(request: {
    method: string;
    headers: Dictionary<string | Array<string> | undefined> | undefined;
  }): boolean {
    return (
      (request.method || "").toUpperCase() === "OPTIONS" &&
      WebhookVerification.header(
        request.headers,
        CLOUD_EVENTS_REQUEST_ORIGIN_HEADER,
      ) !== null &&
      WebhookVerification.header(request.headers, CORS_PREFLIGHT_HEADER) ===
        null
    );
  }

  /*
   * Sends the answer: 200, the body as JSON or text/plain, the protocol's
   * headers, and nosniff and no-store whatever app it is sent from (a
   * probe's listener sets neither).
   */
  public static send(
    res: ExpressResponse,
    answer: WebhookVerificationAnswer,
  ): void {
    let body: string = "";
    const headers: Dictionary<string> = {
      ...answer.headers,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };

    if (answer.json) {
      body = JSON.stringify(answer.json);
      headers["Content-Type"] = "application/json; charset=utf-8";
    } else if (answer.text !== undefined) {
      body = answer.text;
      headers["Content-Type"] = "text/plain; charset=utf-8";
    }

    headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));

    res.writeHead(200, headers);
    res.end(body);
  }

  /*
   * Azure Event Grid, Event Grid schema:
   *
   *   POST, aeg-event-type: SubscriptionValidation
   *   [{ "eventType": "Microsoft.EventGrid.SubscriptionValidationEvent",
   *      "data": { "validationCode": "512d38b6-...", "validationUrl": "..." },
   *      ... }]
   *
   * answered {"validationResponse": "512d38b6-..."}.
   */
  private static recognizeEventGrid(
    request: WebhookVerificationRequest,
  ): WebhookVerificationAnswer | null {
    if (
      WebhookVerification.header(
        request.headers,
        EVENT_GRID_EVENT_TYPE_HEADER,
      ) !== EVENT_GRID_SUBSCRIPTION_VALIDATION
    ) {
      return null;
    }

    if (!Array.isArray(request.body) || request.body.length !== 1) {
      return null;
    }

    const event: unknown = request.body[0];

    if (
      !isPlainObject(event) ||
      event["eventType"] !== EVENT_GRID_VALIDATION_EVENT_TYPE
    ) {
      return null;
    }

    const data: JSONValue | undefined = event["data"];

    if (!isPlainObject(data) || !isOpaqueToken(data["validationCode"])) {
      return null;
    }

    return {
      provider: WebhookVerificationProvider.AzureEventGrid,
      json: { validationResponse: data["validationCode"] },
      headers: {},
    };
  }

  /*
   * Slack's Events API:
   *
   *   POST { "token": "...", "challenge": "3eZbrw1aB...", "type": "url_verification" }
   *
   * answered {"challenge": "3eZbrw1aB..."}.
   */
  private static recognizeSlack(
    request: WebhookVerificationRequest,
  ): WebhookVerificationAnswer | null {
    const body: unknown = request.body;

    if (
      !isPlainObject(body) ||
      body["type"] !== SLACK_URL_VERIFICATION ||
      !isOpaqueToken(body["challenge"])
    ) {
      return null;
    }

    return {
      provider: WebhookVerificationProvider.Slack,
      json: { challenge: body["challenge"] },
      headers: {},
    };
  }

  /*
   * Microsoft Graph change notifications (and lifecycle notifications):
   *
   *   POST ?validationToken=Validation%3a+Testing+client+application+...
   *   (no body)
   *
   * answered with the decoded token, as text/plain.
   */
  private static recognizeMicrosoftGraph(
    request: WebhookVerificationRequest,
  ): WebhookVerificationAnswer | null {
    if (!isPlainObject(request.query)) {
      return null;
    }

    // One value: a repeated parameter is read as a list, and is no token.
    const token: unknown = request.query[GRAPH_VALIDATION_TOKEN_PARAMETER];

    if (!isTextToken(token) || !WebhookVerification.isEmpty(request.body)) {
      return null;
    }

    return {
      provider: WebhookVerificationProvider.MicrosoftGraph,
      text: token,
      headers: {},
    };
  }

  /*
   * Okta event hooks' one-time verification:
   *
   *   GET, X-Okta-Verification-Challenge: 6NWv4uK3PE5...
   *
   * answered {"verification": "6NWv4uK3PE5..."}.
   */
  private static recognizeOkta(
    request: WebhookVerificationRequest,
  ): WebhookVerificationAnswer | null {
    const challenge: string | null = WebhookVerification.header(
      request.headers,
      OKTA_VERIFICATION_CHALLENGE_HEADER,
    );

    if (!isOpaqueToken(challenge)) {
      return null;
    }

    return {
      provider: WebhookVerificationProvider.Okta,
      json: { verification: challenge },
      headers: {},
    };
  }

  /*
   * The CloudEvents webhook abuse protection, as Azure Event Grid sends it
   * for a CloudEvents 1.0 subscription:
   *
   *   OPTIONS, WebHook-Request-Origin: eventgrid.azure.net
   *
   * answered 200 with WebHook-Allowed-Origin: eventgrid.azure.net, and
   * WebHook-Allowed-Rate: * - any rate, as OneUptime sets none.
   */
  private static recognizeCloudEvents(
    request: WebhookVerificationRequest,
  ): WebhookVerificationAnswer | null {
    if (!WebhookVerification.isCloudEventsValidation(request)) {
      return null;
    }

    const origin: string | null = WebhookVerification.header(
      request.headers,
      CLOUD_EVENTS_REQUEST_ORIGIN_HEADER,
    );

    if (!isHostName(origin)) {
      return null;
    }

    return {
      provider: WebhookVerificationProvider.CloudEvents,
      headers: {
        [CLOUD_EVENTS_ALLOWED_ORIGIN_HEADER]: origin,
        [CLOUD_EVENTS_ALLOWED_RATE_HEADER]: "*",
        Allow: VERIFIED_ENDPOINT_METHODS,
      },
    };
  }

  /*
   * A header's one value, by its name in any case: null when it is missing,
   * or came as a list.
   */
  private static header(
    headers: Dictionary<string | Array<string> | undefined> | undefined,
    name: string,
  ): string | null {
    const lowerCaseName: string = name.toLowerCase();

    for (const [key, value] of Object.entries(headers || {})) {
      if (key.toLowerCase() === lowerCaseName) {
        return typeof value === "string" ? value.trim() : null;
      }
    }

    return null;
  }

  // A body with nothing in it, as the parsers leave one.
  private static isEmpty(body: unknown): boolean {
    if (body === undefined || body === null || body === "") {
      return true;
    }

    if (Buffer.isBuffer(body)) {
      return body.length === 0;
    }

    return isPlainObject(body) && Object.keys(body).length === 0;
  }
}
