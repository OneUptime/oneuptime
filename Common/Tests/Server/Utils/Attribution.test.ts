import Attribution from "../../../Server/Utils/Attribution";
import { AttributionConsentState } from "../../../Types/Marketing/AcquisitionAttribution";
import { describe, expect, test } from "@jest/globals";

describe("Attribution", () => {
  test("allowlists and normalizes supported click identifiers", () => {
    expect(
      Attribution.sanitizeClickIds({
        gclid: 123,
        fbclid: " meta ",
        msclkid: "microsoft",
        attackerControlledKey: "drop-me",
      }),
    ).toEqual({ gclid: "123", fbclid: "meta", msclkid: "microsoft" });
  });

  test("sanitizes a direct touch without requiring campaign fields", () => {
    expect(
      Attribution.sanitizeTouch({
        channel: "direct",
        landingPage: "https://oneuptime.com/pricing",
        timestamp: "2026-07-22T10:00:00Z",
        arbitrary: "drop-me",
      }),
    ).toEqual({
      channel: "direct",
      landingPage: "https://oneuptime.com/pricing",
      timestamp: "2026-07-22T10:00:00.000Z",
    });
  });

  test("strips credentials, fragments, UTMs and click IDs from URLs", () => {
    expect(
      Attribution.sanitizeTouch({
        landingUrl:
          "https://user:secret@oneuptime.com/demo?utm_source=google&gclid=abc&keep=yes#private",
        referrer:
          "https://google.com/search?utm_campaign=brand&msclkid=def&q=oneuptime#result",
      }),
    ).toEqual({
      landingPage: "https://oneuptime.com/demo?keep=yes",
      referrer: "https://google.com/search?q=oneuptime",
    });
  });

  test.each([
    "javascript:alert(1)",
    "data:text/plain,secret",
    "not a url",
    "/relative-only",
  ])("rejects an unsafe or invalid URL: %s", (url: string) => {
    expect(Attribution.sanitizeTouch({ landingPage: url })).toBeUndefined();
  });

  test("preserves the latest paid touch independently of the latest direct touch", () => {
    expect(
      Attribution.sanitizeAcquisitionAttribution({
        anonymousVisitorId: "visitor_123456789",
        consentState: AttributionConsentState.Granted,
        firstTouch: { channel: "organic_referral" },
        latestTouch: { channel: "direct" },
        latestPaidTouch: {
          channel: "attributed",
          utmSource: "google",
          clickIds: { gclid: "paid-click" },
        },
      }),
    ).toEqual({
      anonymousVisitorId: "visitor_123456789",
      consentState: AttributionConsentState.Granted,
      firstTouch: { channel: "organic_referral" },
      latestTouch: { channel: "direct" },
      latestPaidTouch: {
        channel: "attributed",
        utmSource: "google",
        clickIds: { gclid: "paid-click" },
      },
    });
  });

  test("allowlists the complete acquisition payload", () => {
    expect(
      Attribution.sanitizeAcquisitionAttribution({
        anonymousVisitorId: "visitor_123456789",
        consentState: AttributionConsentState.Unknown,
        firstTouch: { utmSource: "newsletter", injected: "drop-me" },
        latestTouch: { channel: "direct" },
        latestPaidTouch: { clickIds: { gclid: "abc", injected: "drop-me" } },
        email: "must-not-persist@example.com",
        opaqueVendorPayload: { attendee: "must-not-persist" },
      }),
    ).toEqual({
      anonymousVisitorId: "visitor_123456789",
      consentState: AttributionConsentState.Unknown,
      firstTouch: { utmSource: "newsletter" },
      latestTouch: { channel: "direct" },
      latestPaidTouch: { clickIds: { gclid: "abc" } },
    });
  });

  test.each([null, undefined, "utm_source=google", 42, true, []])(
    "rejects a non-object acquisition payload: %p",
    (value: unknown) => {
      expect(
        Attribution.sanitizeAcquisitionAttribution(value as never),
      ).toBeUndefined();
    },
  );

  test("rejects malformed visitor IDs and consent values", () => {
    expect(
      Attribution.sanitizeAcquisitionAttribution({
        anonymousVisitorId: "short",
        consentState: "yes",
      }),
    ).toBeUndefined();
  });
});
