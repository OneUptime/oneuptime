import crypto from "crypto";
import { JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * The events Zoom sends this server's Zoom app
 * (/api/video-call-oauth/zoom/events): the check that the endpoint is ours
 * when it is saved on the app (endpoint.url_validation), and the news that
 * someone removed the app from their Zoom account (app_deauthorized), after
 * which Zoom requires every bit of their data to be deleted.
 * https://developers.zoom.us/docs/api/webhooks/
 * https://developers.zoom.us/docs/integrations/oauth/#deauthorization
 *
 * Every event is signed with the app's secret token
 * (ZOOM_APP_WEBHOOK_SECRET_TOKEN): `v0=` and the hex HMAC-SHA256 of
 * "v0:<x-zm-request-timestamp>:<raw body>". One that is not, or is older
 * than a few minutes, is refused. The URL validation is answered only once
 * signed too: its answer is an HMAC of text the caller chose, and answering
 * anyone would sign whatever they asked - an app_deauthorized event
 * included.
 */

export const ZOOM_SIGNATURE_HEADER: string = "x-zm-signature";
export const ZOOM_TIMESTAMP_HEADER: string = "x-zm-request-timestamp";

export const ZOOM_URL_VALIDATION_EVENT: string = "endpoint.url_validation";
export const ZOOM_DEAUTHORIZED_EVENT: string = "app_deauthorized";

// Zoom delivers an event within seconds; one older than this is a replay.
export const ZOOM_EVENT_MAX_AGE_IN_SECONDS: number = 5 * 60;

// Zoom's plain tokens are short and URL-safe. Anything else is not Zoom's.
const PLAIN_TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{1,256}$/;

// x-zm-request-timestamp: digits only.
const TIMESTAMP_PATTERN: RegExp = /^\d{1,16}$/;

export interface ZoomDeauthorization {
  userId: string;
  accountId?: string | undefined;
}

export default class ZoomOAuthEvents {
  public static sign(data: {
    secretToken: string;
    timestamp: string;
    rawBody: string;
  }): string {
    return `v0=${crypto
      .createHmac("sha256", data.secretToken)
      .update(`v0:${data.timestamp}:${data.rawBody}`)
      .digest("hex")}`;
  }

  public static isSignedByZoom(data: {
    secretToken: string;
    timestamp: string | undefined;
    signature: string | undefined;
    rawBody: string;
    now?: Date | undefined;
  }): boolean {
    if (!data.secretToken || !data.timestamp || !data.signature) {
      return false;
    }

    if (!TIMESTAMP_PATTERN.test(data.timestamp)) {
      return false;
    }

    // Zoom sends seconds; a value in milliseconds is read as such.
    const sentAt: number = Number(data.timestamp);
    const sentAtInSeconds: number =
      sentAt > 1e12 ? Math.floor(sentAt / 1000) : sentAt;
    const nowInSeconds: number = Math.floor(
      (data.now || new Date()).getTime() / 1000,
    );

    if (
      Math.abs(nowInSeconds - sentAtInSeconds) > ZOOM_EVENT_MAX_AGE_IN_SECONDS
    ) {
      return false;
    }

    const expected: Buffer = Buffer.from(
      ZoomOAuthEvents.sign({
        secretToken: data.secretToken,
        timestamp: data.timestamp,
        rawBody: data.rawBody,
      }),
      "utf8",
    );
    const given: Buffer = Buffer.from(data.signature, "utf8");

    return (
      expected.length === given.length &&
      crypto.timingSafeEqual(expected, given)
    );
  }

  // What endpoint.url_validation must be answered with, or null for a token that is not Zoom's.
  public static getUrlValidationAnswer(data: {
    secretToken: string;
    plainToken: unknown;
  }): JSONObject | null {
    if (
      typeof data.plainToken !== "string" ||
      !PLAIN_TOKEN_PATTERN.test(data.plainToken)
    ) {
      return null;
    }

    return {
      plainToken: data.plainToken,
      encryptedToken: crypto
        .createHmac("sha256", data.secretToken)
        .update(data.plainToken)
        .digest("hex"),
    };
  }

  /*
   * The Zoom user an app_deauthorized event is about, when it is about this
   * server's app.
   */
  public static readDeauthorization(data: {
    body: JSONObject;
    clientId: string;
  }): ZoomDeauthorization | null {
    if (data.body["event"] !== ZOOM_DEAUTHORIZED_EVENT) {
      return null;
    }

    const payload: JSONValue | undefined = data.body["payload"];

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    const clientId: JSONValue | undefined = (payload as JSONObject)[
      "client_id"
    ];
    const userId: JSONValue | undefined = (payload as JSONObject)["user_id"];
    const accountId: JSONValue | undefined = (payload as JSONObject)[
      "account_id"
    ];

    if (clientId !== data.clientId || typeof userId !== "string" || !userId) {
      return null;
    }

    return {
      userId,
      accountId:
        typeof accountId === "string" && accountId ? accountId : undefined,
    };
  }
}
