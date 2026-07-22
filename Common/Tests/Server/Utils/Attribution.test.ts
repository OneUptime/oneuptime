import Attribution from "../../../Server/Utils/Attribution";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

describe("Attribution", () => {
  describe("sanitizeClickIds", () => {
    test("keeps every supported ad-platform click identifier", () => {
      const clickIds: JSONObject = {
        gclid: "google-click",
        wbraid: "google-web-to-app",
        gbraid: "google-app-to-web",
        fbclid: "meta-click",
        msclkid: "microsoft-click",
        li_fat_id: "linkedin-click",
        twclid: "x-click",
        rdt_cid: "reddit-click",
      };

      expect(Attribution.sanitizeClickIds(clickIds)).toEqual(clickIds);
    });

    test("drops keys that are not explicitly allowlisted", () => {
      expect(
        Attribution.sanitizeClickIds({
          gclid: "valid",
          attackerControlledKey: "must-not-persist",
          __proto__: "must-not-persist",
        }),
      ).toEqual({ gclid: "valid" });
    });

    test.each([null, undefined, "gclid=x", 42, true, ["gclid"]])(
      "rejects a non-object value: %p",
      (value: unknown) => {
        expect(Attribution.sanitizeClickIds(value as never)).toBeUndefined();
      },
    );

    test("drops empty, boolean and object click-id values", () => {
      expect(
        Attribution.sanitizeClickIds({
          gclid: "",
          fbclid: false,
          msclkid: { nested: "value" },
        }),
      ).toBeUndefined();
    });

    test("normalizes numeric identifiers to strings", () => {
      expect(
        Attribution.sanitizeClickIds({
          gclid: 12345,
          msclkid: 67890,
        }),
      ).toEqual({
        gclid: "12345",
        msclkid: "67890",
      });
    });

    test("caps each identifier at 500 characters", () => {
      const result: JSONObject | undefined = Attribution.sanitizeClickIds({
        gclid: "g".repeat(600),
        fbclid: "f".repeat(501),
      });

      expect(result?.["gclid"]).toBe("g".repeat(500));
      expect(result?.["fbclid"]).toBe("f".repeat(500));
    });

    test("returns a fresh object instead of retaining the untrusted input", () => {
      const input: JSONObject = { gclid: "original" };
      const result: JSONObject | undefined =
        Attribution.sanitizeClickIds(input);

      input["gclid"] = "mutated";

      expect(result).toEqual({ gclid: "original" });
      expect(result).not.toBe(input);
    });
  });

  describe("sanitizeFirstTouchAttribution", () => {
    test("keeps the complete supported first-touch payload", () => {
      const firstTouch: JSONObject = {
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "pagerduty-alternative",
        utmTerm: "pagerduty alternative",
        utmContent: "comparison-ad-a",
        landingUrl: "https://oneuptime.com/compare/pagerduty?gclid=abc",
        referrer: "https://google.com/",
        timestamp: "2026-07-22T10:00:00.000Z",
        clickIds: {
          gclid: "abc",
          msclkid: "def",
        },
      };

      expect(Attribution.sanitizeFirstTouchAttribution(firstTouch)).toEqual(
        firstTouch,
      );
    });

    test("drops unknown top-level and nested click-id keys", () => {
      expect(
        Attribution.sanitizeFirstTouchAttribution({
          utmSource: "google",
          arbitrary: "do-not-store",
          clickIds: {
            gclid: "valid",
            arbitraryClickId: "do-not-store",
          },
        }),
      ).toEqual({
        utmSource: "google",
        clickIds: { gclid: "valid" },
      });
    });

    test("keeps valid first-touch fields when clickIds is malformed", () => {
      expect(
        Attribution.sanitizeFirstTouchAttribution({
          utmSource: "newsletter",
          clickIds: ["not", "an", "object"],
        }),
      ).toEqual({ utmSource: "newsletter" });
    });

    test("keeps valid click IDs when no UTM values exist", () => {
      expect(
        Attribution.sanitizeFirstTouchAttribution({
          clickIds: { gclid: "auto-tagged-click" },
        }),
      ).toEqual({
        clickIds: { gclid: "auto-tagged-click" },
      });
    });

    test("caps all first-touch strings and nested click IDs", () => {
      const result: JSONObject | undefined =
        Attribution.sanitizeFirstTouchAttribution({
          utmCampaign: "c".repeat(700),
          landingUrl: "l".repeat(700),
          clickIds: { gclid: "g".repeat(700) },
        });

      expect(result?.["utmCampaign"]).toBe("c".repeat(500));
      expect(result?.["landingUrl"]).toBe("l".repeat(500));
      expect((result?.["clickIds"] as JSONObject)?.["gclid"]).toBe(
        "g".repeat(500),
      );
    });

    test("normalizes numeric scalar values", () => {
      expect(
        Attribution.sanitizeFirstTouchAttribution({
          utmCampaign: 2026,
          timestamp: 123456,
        }),
      ).toEqual({
        utmCampaign: "2026",
        timestamp: "123456",
      });
    });

    test.each([null, undefined, "utm_source=google", 42, true, []])(
      "rejects a non-object first-touch value: %p",
      (value: unknown) => {
        expect(
          Attribution.sanitizeFirstTouchAttribution(value as never),
        ).toBeUndefined();
      },
    );

    test("returns undefined when every supplied field is invalid", () => {
      expect(
        Attribution.sanitizeFirstTouchAttribution({
          unsupported: "value",
          clickIds: { unsupported: "value" },
        }),
      ).toBeUndefined();
    });

    test("does not retain mutable nested input objects", () => {
      const clickIds: JSONObject = { gclid: "original" };
      const input: JSONObject = {
        utmSource: "google",
        clickIds,
      };
      const result: JSONObject | undefined =
        Attribution.sanitizeFirstTouchAttribution(input);

      clickIds["gclid"] = "mutated";
      input["utmSource"] = "mutated";

      expect(result).toEqual({
        utmSource: "google",
        clickIds: { gclid: "original" },
      });
    });
  });
});
