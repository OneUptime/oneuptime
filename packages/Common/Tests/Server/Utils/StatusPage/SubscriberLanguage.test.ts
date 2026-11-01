import { describe, expect, test } from "@jest/globals";
import SubscriberLanguage from "../../../../Server/Utils/StatusPage/SubscriberLanguage";

/*
 * THE LANGUAGE A STATUS PAGE'S SUBSCRIBER IS WRITTEN TO IN.
 *
 * Their own - the language they read the page in when they signed up, when
 * that was not the page's default - else the page's default language, else
 * English. A sign-up stores a language only when it is not the page's
 * default, so a subscriber who read the page in its default follows the
 * page when the team changes it.
 */

describe("SubscriberLanguage.getLanguage", () => {
  test("a subscriber's own language comes first", () => {
    expect(
      SubscriberLanguage.getLanguage({
        subscriber: { language: "fr" },
        statusPage: { defaultLanguage: "de" },
      }),
    ).toBe("fr");
  });

  test("without one, the page's default language", () => {
    expect(
      SubscriberLanguage.getLanguage({
        subscriber: { language: null },
        statusPage: { defaultLanguage: "de" },
      }),
    ).toBe("de");
    expect(
      SubscriberLanguage.getLanguage({
        subscriber: {},
        statusPage: { defaultLanguage: "zh-TW" },
      }),
    ).toBe("zh-TW");
  });

  test("and English when neither names one OneUptime writes in", () => {
    expect(
      SubscriberLanguage.getLanguage({
        subscriber: { language: "xx" },
        statusPage: { defaultLanguage: "yy" },
      }),
    ).toBe("en");
    expect(
      SubscriberLanguage.getLanguage({
        subscriber: undefined,
        statusPage: undefined,
      }),
    ).toBe("en");
    // A page read without its default language: English, as before.
    expect(
      SubscriberLanguage.getLanguage({
        subscriber: {},
        statusPage: {},
      }),
    ).toBe("en");
  });

  test("a stored language that is a regional tag reads as its language", () => {
    expect(
      SubscriberLanguage.getLanguage({
        subscriber: { language: " de-AT " },
        statusPage: { defaultLanguage: "en" },
      }),
    ).toBe("de");
  });
});

describe("SubscriberLanguage.getLanguageToStore", () => {
  test("stores the language the visitor reads the page in, when it is not the default", () => {
    expect(
      SubscriberLanguage.getLanguageToStore({
        acceptLanguage: "fr-FR,fr;q=0.9",
        statusPage: { defaultLanguage: "de" },
      }),
    ).toBe("fr");
  });

  test("stores none when the visitor reads the page in its default", () => {
    expect(
      SubscriberLanguage.getLanguageToStore({
        acceptLanguage: "de",
        statusPage: { defaultLanguage: "de" },
      }),
    ).toBeNull();
    // A page with no default reads in English.
    expect(
      SubscriberLanguage.getLanguageToStore({
        acceptLanguage: "en-US",
        statusPage: {},
      }),
    ).toBeNull();
  });

  test("stores none when the request names no language OneUptime writes in", () => {
    expect(
      SubscriberLanguage.getLanguageToStore({
        acceptLanguage: "xx, yy;q=0.5",
        statusPage: { defaultLanguage: "de" },
      }),
    ).toBeNull();
    expect(
      SubscriberLanguage.getLanguageToStore({
        acceptLanguage: undefined,
        statusPage: { defaultLanguage: "de" },
      }),
    ).toBeNull();
  });
});

describe("SubscriberLanguage.normalizeLanguageToStore", () => {
  test.each<[string | null | undefined, string | null | undefined]>([
    ["de", "de"],
    ["de-AT", "de"],
    ["zh-hk", "zh-TW"],
    ["  ", null],
    ["", null],
    [null, null],
    [undefined, null],
    ["klingon", undefined],
  ])(
    "%p is stored as %p",
    (
      language: string | null | undefined,
      stored: string | null | undefined,
    ) => {
      expect(SubscriberLanguage.normalizeLanguageToStore(language)).toBe(
        stored,
      );
    },
  );
});

describe("SubscriberLanguage.getStatusPageLanguage", () => {
  test("is the page's default language, or English", () => {
    expect(
      SubscriberLanguage.getStatusPageLanguage({ defaultLanguage: "ja" }),
    ).toBe("ja");
    expect(
      SubscriberLanguage.getStatusPageLanguage({ defaultLanguage: null }),
    ).toBe("en");
    expect(SubscriberLanguage.getStatusPageLanguage(null)).toBe("en");
  });
});
