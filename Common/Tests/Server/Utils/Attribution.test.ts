import Attribution, { UtmAttribution } from "../../../Server/Utils/Attribution";
import { JSONObject } from "../../../Types/JSON";
import crypto from "crypto";
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

  /*
   * -------------------------------------------------------------------------
   * sanitizeUtm
   *
   * UTM values reach the server in two spellings from three unauthenticated
   * doors: snake_case off a URL and out of Cal booking metadata, camelCase out
   * of the signup form's JSON body. All of them write the same columns, so all
   * of them read through here.
   * -------------------------------------------------------------------------
   */
  describe("sanitizeUtm", () => {
    test("reads the snake_case spelling a URL and Cal metadata carry", () => {
      expect(
        Attribution.sanitizeUtm({
          utm_source: "google",
          utm_medium: "cpc",
          utm_campaign: "pagerduty-alternative",
          utm_term: "pagerduty alternative",
          utm_content: "ad-variant-a",
          utm_url: "https://oneuptime.com/?utm_source=google",
        }),
      ).toEqual({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "pagerduty-alternative",
        utmTerm: "pagerduty alternative",
        utmContent: "ad-variant-a",
        utmUrl: "https://oneuptime.com/?utm_source=google",
      });
    });

    test("reads the camelCase spelling the signup form posts", () => {
      expect(
        Attribution.sanitizeUtm({
          utmSource: "linkedin",
          utmMedium: "paid-social",
          utmUrl: "https://oneuptime.com/enterprise",
        }),
      ).toEqual({
        utmSource: "linkedin",
        utmMedium: "paid-social",
        utmUrl: "https://oneuptime.com/enterprise",
      });
    });

    /*
     * camelCase is the spelling the browser writes deliberately; snake_case is
     * the raw URL echo. When a caller sends both, the deliberate one wins.
     */
    test("prefers the camelCase value when both spellings are present", () => {
      expect(
        Attribution.sanitizeUtm({
          utmSource: "deliberate",
          utm_source: "raw-echo",
        }),
      ).toEqual({ utmSource: "deliberate" });
    });

    test("accepts landingUrl as a source for the landing URL", () => {
      expect(
        Attribution.sanitizeUtm({
          landingUrl: "https://oneuptime.com/pricing",
        }),
      ).toEqual({ utmUrl: "https://oneuptime.com/pricing" });
    });

    test("drops keys that are not explicitly allowlisted", () => {
      expect(
        Attribution.sanitizeUtm({
          utm_source: "google",
          utm_evil: "do-not-store",
          attackerControlledKey: "do-not-store",
          __proto__: "do-not-store",
        }),
      ).toEqual({ utmSource: "google" });
    });

    test("caps every value at 500 characters", () => {
      const result: UtmAttribution = Attribution.sanitizeUtm({
        utm_campaign: "c".repeat(700),
        utm_url: "u".repeat(700),
      });

      expect(result.utmCampaign).toBe("c".repeat(500));
      expect(result.utmUrl).toBe("u".repeat(500));
    });

    test("normalizes numeric values to strings", () => {
      expect(Attribution.sanitizeUtm({ utm_campaign: 2026 })).toEqual({
        utmCampaign: "2026",
      });
    });

    test("drops empty, boolean and object values", () => {
      expect(
        Attribution.sanitizeUtm({
          utm_source: "",
          utm_medium: false,
          utm_campaign: { nested: "value" },
        }),
      ).toEqual({});
    });

    test.each([null, undefined, "utm_source=google", 42, true, ["utm_source"]])(
      "returns an empty object for a non-object value: %p",
      (value: unknown) => {
        expect(Attribution.sanitizeUtm(value as never)).toEqual({});
      },
    );

    test("returns a fresh object instead of retaining the untrusted input", () => {
      const input: JSONObject = { utm_source: "original" };
      const result: UtmAttribution = Attribution.sanitizeUtm(input);

      input["utm_source"] = "mutated";

      expect(result).toEqual({ utmSource: "original" });
    });
  });

  describe("hasAnyAttribution", () => {
    test("is true for a click id with no UTMs at all", () => {
      // Google Ads auto-tagging sends gclid and nothing else.
      expect(
        Attribution.hasAnyAttribution({ clickIds: { gclid: "auto-tagged" } }),
      ).toBe(true);
    });

    test("is true for a UTM with no click id at all", () => {
      // A newsletter or sponsorship link, which no ad platform tagged.
      expect(
        Attribution.hasAnyAttribution({ utm: { utmSource: "newsletter" } }),
      ).toBe(true);
    });

    test.each([
      ["nothing at all", {}],
      ["an empty click id bag", { clickIds: {} }],
      ["an empty utm bag", { utm: {} }],
      ["both empty", { clickIds: {}, utm: {} }],
    ])("is false for %s", (_label: string, data: JSONObject) => {
      expect(Attribution.hasAnyAttribution(data as never)).toBe(false);
    });

    /*
     * The landing URL alone is not attribution: every visitor has one, so
     * treating it as attribution would make every conversion "attributed".
     */
    test("is false when only the landing URL is known", () => {
      expect(
        Attribution.hasAnyAttribution({
          utm: { utmUrl: "https://oneuptime.com/" },
        }),
      ).toBe(false);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * normalizeEmail / hashEmail
   *
   * One definition, because three things have to agree on it or they silently
   * stop matching: the digest ad platforms are given for enhanced matching, the
   * emailHash column the demo-to-signup join is computed on, and the rate-limit
   * bucket key.
   * -------------------------------------------------------------------------
   */
  describe("normalizeEmail", () => {
    test.each([
      ["Ada@Example.com", "ada@example.com"],
      ["  ada@example.com  ", "ada@example.com"],
      ["ADA@EXAMPLE.COM", "ada@example.com"],
    ])("normalizes %p to %p", (input: string, expected: string) => {
      expect(Attribution.normalizeEmail(input)).toBe(expected);
    });

    /*
     * Deliberately NOT gmail dot/plus folding. Every ad platform specifies
     * trim-and-lowercase before SHA-256, so folding further would produce a
     * digest none of them can match.
     */
    test("does not fold gmail dots or plus addressing", () => {
      expect(Attribution.normalizeEmail("a.d.a+ads@gmail.com")).toBe(
        "a.d.a+ads@gmail.com",
      );
    });

    test.each([undefined, null, "", "   ", 42, {}])(
      "returns null for %p",
      (value: unknown) => {
        expect(Attribution.normalizeEmail(value as never)).toBeNull();
      },
    );
  });

  describe("hashEmail", () => {
    test("is the SHA-256 hex digest of the normalized address", () => {
      const expected: string = crypto
        .createHash("sha256")
        .update("ada@example.com")
        .digest("hex");

      expect(Attribution.hashEmail("Ada@Example.com")).toBe(expected);
      expect(expected).toHaveLength(64);
    });

    test("agrees for addresses that differ only in case or padding", () => {
      expect(Attribution.hashEmail("  ADA@Example.com ")).toBe(
        Attribution.hashEmail("ada@example.com"),
      );
    });

    test("differs for genuinely different addresses", () => {
      expect(Attribution.hashEmail("ada@example.com")).not.toBe(
        Attribution.hashEmail("grace@example.com"),
      );
    });

    test.each([undefined, null, "", "   "])(
      "returns null for %p",
      (value: unknown) => {
        expect(Attribution.hashEmail(value as never)).toBeNull();
      },
    );
  });
});
