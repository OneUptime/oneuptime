import crypto from "crypto";
import ZoomOAuthEvents, {
  ZOOM_EVENT_MAX_AGE_IN_SECONDS,
} from "../../../../../Server/Utils/VideoCall/OAuth/ZoomOAuthEvents";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Zoom signs every event it sends the app with the app's secret token. The
 * deauthorization event deletes a sign-in, and the URL validation answers
 * with an HMAC of a token the caller chose, so neither may be answered for
 * anyone but Zoom.
 */

const SECRET_TOKEN: string = "zoom-secret-token";
const NOW: Date = new Date("2026-10-09T12:00:00.000Z");
const NOW_IN_SECONDS: string = String(Math.floor(NOW.getTime() / 1000));

function zoomSignature(timestamp: string, rawBody: string): string {
  return `v0=${crypto
    .createHmac("sha256", SECRET_TOKEN)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
}

const DEAUTHORIZED: JSONObject = {
  event: "app_deauthorized",
  event_ts: 1791561600000,
  payload: {
    account_id: "acct-1",
    user_id: "KdYKjnimT4KPd8FFgQt9FQ",
    signature: "unused",
    deauthorization_time: "2026-10-09T12:00:00.000Z",
    client_id: "zoom-client-id",
  },
};

describe("ZoomOAuthEvents", () => {
  test("signs exactly as Zoom does: v0, the timestamp and the raw body", () => {
    const rawBody: string = JSON.stringify(DEAUTHORIZED);

    expect(
      ZoomOAuthEvents.sign({
        secretToken: SECRET_TOKEN,
        timestamp: NOW_IN_SECONDS,
        rawBody,
      }),
    ).toBe(zoomSignature(NOW_IN_SECONDS, rawBody));
  });

  test("accepts an event signed with the app's secret token", () => {
    const rawBody: string = JSON.stringify(DEAUTHORIZED);

    expect(
      ZoomOAuthEvents.isSignedByZoom({
        secretToken: SECRET_TOKEN,
        timestamp: NOW_IN_SECONDS,
        signature: zoomSignature(NOW_IN_SECONDS, rawBody),
        rawBody,
        now: NOW,
      }),
    ).toBe(true);
  });

  test("refuses a body changed after it was signed", () => {
    const rawBody: string = JSON.stringify(DEAUTHORIZED);

    expect(
      ZoomOAuthEvents.isSignedByZoom({
        secretToken: SECRET_TOKEN,
        timestamp: NOW_IN_SECONDS,
        signature: zoomSignature(NOW_IN_SECONDS, rawBody),
        rawBody: rawBody.replace("KdYKjnimT4KPd8FFgQt9FQ", "someone-else"),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("refuses a signature made with another secret, or none", () => {
    const rawBody: string = "{}";

    expect(
      ZoomOAuthEvents.isSignedByZoom({
        secretToken: SECRET_TOKEN,
        timestamp: NOW_IN_SECONDS,
        signature: `v0=${crypto.createHmac("sha256", "other").update(`v0:${NOW_IN_SECONDS}:{}`).digest("hex")}`,
        rawBody,
        now: NOW,
      }),
    ).toBe(false);

    expect(
      ZoomOAuthEvents.isSignedByZoom({
        secretToken: SECRET_TOKEN,
        timestamp: NOW_IN_SECONDS,
        signature: undefined,
        rawBody,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("refuses a replay older than a few minutes", () => {
    const old: string = String(
      Number(NOW_IN_SECONDS) - ZOOM_EVENT_MAX_AGE_IN_SECONDS - 1,
    );
    const rawBody: string = "{}";

    expect(
      ZoomOAuthEvents.isSignedByZoom({
        secretToken: SECRET_TOKEN,
        timestamp: old,
        signature: zoomSignature(old, rawBody),
        rawBody,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("refuses a timestamp that is not a number", () => {
    expect(
      ZoomOAuthEvents.isSignedByZoom({
        secretToken: SECRET_TOKEN,
        timestamp: "now",
        signature: zoomSignature("now", "{}"),
        rawBody: "{}",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("answers the URL validation with the plain token and its HMAC", () => {
    expect(
      ZoomOAuthEvents.getUrlValidationAnswer({
        secretToken: SECRET_TOKEN,
        plainToken: "qgg8vlvZRS6UYooatFL8Aw",
      }),
    ).toEqual({
      plainToken: "qgg8vlvZRS6UYooatFL8Aw",
      encryptedToken: crypto
        .createHmac("sha256", SECRET_TOKEN)
        .update("qgg8vlvZRS6UYooatFL8Aw")
        .digest("hex"),
    });
  });

  test("never signs a plain token shaped like an event's signed text", () => {
    expect(
      ZoomOAuthEvents.getUrlValidationAnswer({
        secretToken: SECRET_TOKEN,
        plainToken: `v0:${NOW_IN_SECONDS}:${JSON.stringify(DEAUTHORIZED)}`,
      }),
    ).toBe(null);
    expect(
      ZoomOAuthEvents.getUrlValidationAnswer({
        secretToken: SECRET_TOKEN,
        plainToken: undefined,
      }),
    ).toBe(null);
  });

  test("reads the Zoom user an app_deauthorized event is about", () => {
    expect(
      ZoomOAuthEvents.readDeauthorization({
        body: DEAUTHORIZED,
        clientId: "zoom-client-id",
      }),
    ).toEqual({ userId: "KdYKjnimT4KPd8FFgQt9FQ", accountId: "acct-1" });
  });

  test("ignores a deauthorization of another app, and any other event", () => {
    expect(
      ZoomOAuthEvents.readDeauthorization({
        body: DEAUTHORIZED,
        clientId: "another-client-id",
      }),
    ).toBe(null);
    expect(
      ZoomOAuthEvents.readDeauthorization({
        body: { ...DEAUTHORIZED, event: "meeting.started" },
        clientId: "zoom-client-id",
      }),
    ).toBe(null);
  });
});
