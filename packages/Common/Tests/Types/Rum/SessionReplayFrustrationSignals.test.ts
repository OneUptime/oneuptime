import { describe, expect, it } from "@jest/globals";
import {
  SESSION_REPLAY_CUSTOM_SIGNAL_TRIGGERS,
  SESSION_REPLAY_FRUSTRATION_LIMITS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SESSION_REPLAY_MAX_IGNORED_SELECTORS,
  SessionReplayFrustrationSettings,
  SessionReplayFrustrationSignalsConfig,
  getDefaultSessionReplayFrustrationSettings,
  isSessionReplayCustomSignalTrigger,
  isSessionReplayTapPatternUsable,
  matchesSessionReplayErrorText,
  matchesSessionReplayEventName,
  matchesSessionReplayPagePattern,
  matchesSessionReplayTapTarget,
  normalizeSessionReplayFrustrationSettings,
  readSessionReplayFrustrationSignalsConfig,
  toSessionReplayFrustrationSignalsConfig,
} from "../../../Types/Rum/SessionReplayFrustrationSignals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The shared half of "what counts as frustration": the defaults, the
 * lenient read the recorders and the gate use, the wire the recorders get,
 * and the page matcher both recorders run on every page.
 */

describe("the defaults", () => {
  it("are the numbers the recorder used before they could be changed", () => {
    /*
     * FrustrationDetector's RAGE_CLICK_* / DEAD_CLICK_TIMEOUT_MS /
     * ERROR_CLICK_WINDOW_MS and SessionId's REFRESH_RAGE_* were these, so an
     * application nobody touches records exactly what it did.
     */
    expect(getDefaultSessionReplayFrustrationSettings()).toEqual({
      rageClick: {
        isEnabled: true,
        clickCount: 3,
        windowMs: 1000,
        radiusPx: 30,
        ignoreSelectors: [],
      },
      deadClick: { isEnabled: true, timeoutMs: 3000, ignoreSelectors: [] },
      errorClick: { isEnabled: true, windowMs: 1000 },
      refreshRage: { isEnabled: true, reloadCount: 3, windowSeconds: 60 },
      customSignals: [],
    });
  });

  it("sit inside their own ranges", () => {
    for (const limit of Object.values(SESSION_REPLAY_FRUSTRATION_LIMITS)) {
      expect(limit.defaultValue).toBeGreaterThanOrEqual(limit.min);
      expect(limit.defaultValue).toBeLessThanOrEqual(limit.max);
      expect(Number.isInteger(limit.min)).toBe(true);
      expect(Number.isInteger(limit.max)).toBe(true);
    }
  });

  it("hand out a fresh object each time, so a caller cannot change them for everyone", () => {
    const first: SessionReplayFrustrationSettings =
      getDefaultSessionReplayFrustrationSettings();
    first.rageClick.clickCount = 9;
    first.customSignals.push({
      id: "a",
      name: "x",
      trigger: "event",
      match: "x",
      isFrustration: true,
      isEnabled: true,
    });

    expect(
      getDefaultSessionReplayFrustrationSettings().rageClick.clickCount,
    ).toBe(3);
    expect(getDefaultSessionReplayFrustrationSettings().customSignals).toEqual(
      [],
    );
  });
});

describe("normalizeSessionReplayFrustrationSettings", () => {
  it("reads null, nothing and garbage as the defaults", () => {
    for (const value of [null, undefined, 1, "x", [], true]) {
      expect(normalizeSessionReplayFrustrationSettings(value)).toEqual(
        getDefaultSessionReplayFrustrationSettings(),
      );
    }
  });

  it("keeps a switched-off rule off, and anything but false on", () => {
    const settings: SessionReplayFrustrationSettings =
      normalizeSessionReplayFrustrationSettings({
        rageClick: { isEnabled: false },
        deadClick: { isEnabled: false },
        errorClick: { isEnabled: "no" },
        refreshRage: {},
      });

    expect(settings.rageClick.isEnabled).toBe(false);
    expect(settings.deadClick.isEnabled).toBe(false);
    expect(settings.errorClick.isEnabled).toBe(true);
    expect(settings.refreshRage.isEnabled).toBe(true);
  });

  it("keeps numbers inside their ranges, whole, and reads non-numbers as the default", () => {
    const settings: SessionReplayFrustrationSettings =
      normalizeSessionReplayFrustrationSettings({
        rageClick: { clickCount: 1, windowMs: 99999, radiusPx: 12.6 },
        deadClick: { timeoutMs: "5000" },
        errorClick: { windowMs: Number.NaN },
        refreshRage: {
          reloadCount: Number.POSITIVE_INFINITY,
          windowSeconds: 120,
        },
      });

    expect(settings.rageClick.clickCount).toBe(3);
    expect(settings.rageClick.windowMs).toBe(5000);
    expect(settings.rageClick.radiusPx).toBe(13);
    expect(settings.deadClick.timeoutMs).toBe(3000);
    expect(settings.errorClick.windowMs).toBe(1000);
    expect(settings.refreshRage.reloadCount).toBe(3);
    expect(settings.refreshRage.windowSeconds).toBe(120);
  });

  it("trims, de-duplicates and caps the elements a click rule ignores", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 30; index++) {
      many.push(`.item-${index}`);
    }

    const settings: SessionReplayFrustrationSettings =
      normalizeSessionReplayFrustrationSettings({
        rageClick: {
          ignoreSelectors: [" .stepper ", ".stepper", "", 3, "x".repeat(201)],
        },
        deadClick: { ignoreSelectors: many },
      });

    expect(settings.rageClick.ignoreSelectors).toEqual([".stepper"]);
    expect(settings.deadClick.ignoreSelectors).toHaveLength(
      SESSION_REPLAY_MAX_IGNORED_SELECTORS,
    );
    expect(settings.deadClick.ignoreSelectors[0]).toBe(".item-0");
  });

  it("keeps the custom signals it can match and drops the rest", () => {
    const settings: SessionReplayFrustrationSettings =
      normalizeSessionReplayFrustrationSettings({
        customSignals: [
          {
            id: "s1",
            name: "  Payment failed ",
            trigger: "event",
            match: " payment_failed ",
          },
          { name: "", trigger: "event", match: "x" },
          { name: "No trigger", match: "x" },
          { name: "Hover", trigger: "hover", match: "x" },
          { name: "Empty match", trigger: "click", match: "  " },
          // A page pattern that cannot match any path.
          { name: "Unanchored", trigger: "page", match: "checkout" },
          { name: "Long event", trigger: "event", match: "e".repeat(65) },
          // The same name again, in another case: the first one stays.
          { name: "PAYMENT FAILED", trigger: "error", match: "x" },
          {
            name: "Help",
            trigger: "click",
            match: "#help",
            isFrustration: false,
            isEnabled: false,
          },
          "not an object",
        ],
      });

    expect(settings.customSignals).toEqual([
      {
        id: "s1",
        name: "Payment failed",
        trigger: "event",
        match: "payment_failed",
        isFrustration: true,
        isEnabled: true,
      },
      {
        id: "",
        name: "Help",
        trigger: "click",
        match: "#help",
        isFrustration: false,
        isEnabled: false,
      },
    ]);
  });

  it("keeps at most twenty custom signals", () => {
    const signals: Array<Record<string, unknown>> = [];

    for (let index: number = 0; index < 25; index++) {
      signals.push({ name: `Signal ${index}`, trigger: "event", match: "x" });
    }

    expect(
      normalizeSessionReplayFrustrationSettings({ customSignals: signals })
        .customSignals,
    ).toHaveLength(SESSION_REPLAY_MAX_CUSTOM_SIGNALS);
  });
});

describe("the wire the recorders receive", () => {
  it("carries the rules as they are and only the custom signals that are on, without ids", () => {
    const settings: SessionReplayFrustrationSettings =
      normalizeSessionReplayFrustrationSettings({
        rageClick: { isEnabled: false, clickCount: 5 },
        customSignals: [
          {
            id: "a",
            name: "Payment failed",
            trigger: "event",
            match: "payment_failed",
            isFrustration: true,
            isEnabled: true,
          },
          {
            id: "b",
            name: "Paused one",
            trigger: "page",
            match: "/x",
            isEnabled: false,
          },
        ],
      });

    const config: SessionReplayFrustrationSignalsConfig =
      toSessionReplayFrustrationSignalsConfig(settings);

    expect(config.rageClick).toEqual({
      isEnabled: false,
      clickCount: 5,
      windowMs: 1000,
      radiusPx: 30,
      ignoreSelectors: [],
    });
    expect(config.customSignals).toEqual([
      {
        name: "Payment failed",
        trigger: "event",
        match: "payment_failed",
        isFrustration: true,
      },
    ]);
  });

  it("reads a missing field (an older server) as the built-in rules and no custom signals", () => {
    expect(readSessionReplayFrustrationSignalsConfig(undefined)).toEqual(
      toSessionReplayFrustrationSignalsConfig(
        getDefaultSessionReplayFrustrationSettings(),
      ),
    );
  });

  it("round-trips: what the server sends is what the recorder reads", () => {
    const config: SessionReplayFrustrationSignalsConfig =
      toSessionReplayFrustrationSignalsConfig(
        normalizeSessionReplayFrustrationSettings({
          deadClick: { timeoutMs: 5000, ignoreSelectors: [".carousel"] },
          refreshRage: { reloadCount: 4, windowSeconds: 30 },
          customSignals: [
            { name: "Out of stock", trigger: "page", match: "/sold-out*" },
          ],
        }),
      );

    expect(
      readSessionReplayFrustrationSignalsConfig(
        JSON.parse(JSON.stringify(config)),
      ),
    ).toEqual(config);
  });
});

describe("matchesSessionReplayPagePattern", () => {
  it("matches a plain path exactly, ignoring case and the slash at the end", () => {
    expect(
      matchesSessionReplayPagePattern("/checkout/error", "/checkout/error"),
    ).toBe(true);
    expect(
      matchesSessionReplayPagePattern("/checkout/error", "/Checkout/Error/"),
    ).toBe(true);
    expect(
      matchesSessionReplayPagePattern("/checkout/error/", "/checkout/error"),
    ).toBe(true);
    expect(
      matchesSessionReplayPagePattern("/checkout", "/checkout/error"),
    ).toBe(false);
    expect(matchesSessionReplayPagePattern("/", "/")).toBe(true);
    expect(matchesSessionReplayPagePattern("/", "/home")).toBe(false);
  });

  it("reads a star as any run of characters, slashes included", () => {
    expect(matchesSessionReplayPagePattern("/checkout*", "/checkout")).toBe(
      true,
    );
    expect(
      matchesSessionReplayPagePattern("/checkout*", "/checkout/pay/card"),
    ).toBe(true);
    expect(
      matchesSessionReplayPagePattern("/orders/*/failed", "/orders/42/failed"),
    ).toBe(true);
    expect(
      matchesSessionReplayPagePattern("/orders/*/failed", "/orders/a/b/failed"),
    ).toBe(true);
    expect(
      matchesSessionReplayPagePattern("/orders/*/failed", "/orders/42/paid"),
    ).toBe(false);
    expect(matchesSessionReplayPagePattern("*/error", "/billing/error")).toBe(
      true,
    );
    expect(matchesSessionReplayPagePattern("*/error", "/billing/errors")).toBe(
      false,
    );
    expect(matchesSessionReplayPagePattern("*", "/anything/at/all")).toBe(true);
    expect(matchesSessionReplayPagePattern("/a*b*c", "/abc")).toBe(true);
    expect(matchesSessionReplayPagePattern("/a*b*c", "/acb")).toBe(false);
  });

  it("never lets the end of a pattern reuse what its middle consumed", () => {
    // "/ab" + "*" + "ba": the b cannot be both the end of "/ab" and the start of "ba".
    expect(matchesSessionReplayPagePattern("/ab*ba", "/aba")).toBe(false);
    expect(matchesSessionReplayPagePattern("/ab*ba", "/abba")).toBe(true);
  });

  it("stays fast on a pattern and a path built to make a matcher backtrack", () => {
    const pattern: string = `/${"*a".repeat(90)}*b`;
    const path: string = `/${"a".repeat(2000)}`;

    // 200 runs of a linear walk; a backtracking one would not finish at all.
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        let matched: number = 0;

        for (let run: number = 0; run < 200; run++) {
          if (matchesSessionReplayPagePattern(pattern, path)) {
            matched++;
          }
        }

        return matched;
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBe(0);
    expect(timed.inMs).toBeLessThan(2000);
  });

  /*
   * #8195: the browser escapes every letter beyond ASCII in a path - a
   * visit to /café has the path "/caf%C3%A9" - and a link can write the
   * same page "/caf%c3%a9" or "/cafe%CC%81". A pattern written as the page
   * reads compared with the escaped path never matched.
   */
  describe("a page with letters beyond ASCII", () => {
    const CAFE_PATHS: Array<string> = [
      "/caf%C3%A9",
      "/caf%c3%a9",
      "/cafe%CC%81",
      "/cafe%cc%81",
      "/café",
      `/cafe${String.fromCharCode(0x301)}`,
    ];

    it("matches a pattern written as it reads, in every spelling of the page", () => {
      for (const path of CAFE_PATHS) {
        expect([path, matchesSessionReplayPagePattern("/café", path)]).toEqual([
          path,
          true,
        ]);
      }
    });

    it("matches a pattern written escaped, in every spelling of the page", () => {
      for (const pattern of ["/caf%C3%A9", "/caf%c3%a9", "/cafe%CC%81"]) {
        for (const path of CAFE_PATHS) {
          expect([
            pattern,
            path,
            matchesSessionReplayPagePattern(pattern, path),
          ]).toEqual([pattern, path, true]);
        }
      }
    });

    it("ignores case on the letters themselves", () => {
      for (const path of [...CAFE_PATHS, "/CAF%C3%89", "/Caf%c3%89/"]) {
        expect([path, matchesSessionReplayPagePattern("/CAFÉ", path)]).toEqual([
          path,
          true,
        ]);
      }
    });

    it("matches stars and pieces in the same spelling", () => {
      expect(
        matchesSessionReplayPagePattern("/café/*", "/caf%C3%A9/men%C3%BC"),
      ).toBe(true);
      expect(
        matchesSessionReplayPagePattern("*/menü", "/cafe%CC%81/men%c3%bc/"),
      ).toBe(true);
      expect(
        matchesSessionReplayPagePattern(
          "/السلة*",
          "/%D8%A7%D9%84%D8%B3%D9%84%D8%A9/checkout",
        ),
      ).toBe(true);
      expect(matchesSessionReplayPagePattern("/café", "/cafe")).toBe(false);
      expect(matchesSessionReplayPagePattern("/cafe", "/caf%C3%A9")).toBe(
        false,
      );
    });

    it("keeps what names another page apart", () => {
      // An escaped slash is not a slash, whichever side writes it.
      expect(matchesSessionReplayPagePattern("/a%2Fb", "/a/b")).toBe(false);
      expect(matchesSessionReplayPagePattern("/a/b", "/a%2Fb")).toBe(false);
      expect(matchesSessionReplayPagePattern("/a%2fb", "/a%2Fb")).toBe(true);
      // Bytes that are not UTF-8 are matched as written, in either hex case.
      expect(matchesSessionReplayPagePattern("/%E9t%E9", "/%e9t%e9")).toBe(
        true,
      );
      expect(matchesSessionReplayPagePattern("/été", "/%e9t%e9")).toBe(false);
    });

    it("stays fast on a long path full of escapes", () => {
      const path: string = `/${"caf%C3%A9-".repeat(20000)}`;
      const timed: FastestRun<boolean> = fastestRun({
        run: (): boolean => {
          return matchesSessionReplayPagePattern(`/${"*é".repeat(50)}*x`, path);
        },
        limitInMs: 2000,
      });

      expect(timed.result).toBe(false);
      expect(timed.inMs).toBeLessThan(2000);
    });
  });
});

describe("the error and event matchers", () => {
  it("finds the error text anywhere in the message, ignoring case", () => {
    expect(
      matchesSessionReplayErrorText(
        "card declined",
        "PaymentError: Card Declined by issuer",
      ),
    ).toBe(true);
    expect(
      matchesSessionReplayErrorText("card declined", "Card was declined"),
    ).toBe(false);
    expect(matchesSessionReplayErrorText("", "anything")).toBe(false);
  });

  it("compares event names whole, ignoring case and spaces at the ends", () => {
    expect(
      matchesSessionReplayEventName("payment_failed", "Payment_Failed"),
    ).toBe(true);
    expect(
      matchesSessionReplayEventName(" payment_failed", "payment_failed "),
    ).toBe(true);
    expect(matchesSessionReplayEventName("payment", "payment_failed")).toBe(
      false,
    );
  });
});

/*
 * Tap signals (issue #6517): a React Native view named by its testID. The
 * recorder that detects them (MobileRecorder/src/CustomSignals.ts) carries
 * a copy of these, held to them by its ContractParity test.
 */
describe("tap signals", () => {
  it("are a trigger of their own, after the click", () => {
    expect(SESSION_REPLAY_CUSTOM_SIGNAL_TRIGGERS).toEqual([
      "click",
      "tap",
      "page",
      "event",
      "error",
    ]);
    expect(isSessionReplayCustomSignalTrigger("tap")).toBe(true);
    expect(isSessionReplayCustomSignalTrigger("touch")).toBe(false);
  });

  it("name a testID: some of it, and a star at most at its end", () => {
    expect(isSessionReplayTapPatternUsable("pay-button")).toBe(true);
    expect(isSessionReplayTapPatternUsable("product-card-*")).toBe(true);
    expect(isSessionReplayTapPatternUsable("*")).toBe(false);
    expect(isSessionReplayTapPatternUsable("*-card")).toBe(false);
    expect(isSessionReplayTapPatternUsable("a*b")).toBe(false);
    expect(isSessionReplayTapPatternUsable("ab**")).toBe(false);
  });

  it("match a testID exactly, or by the start before the star, ignoring case", () => {
    expect(matchesSessionReplayTapTarget("pay-button", "pay-button")).toBe(
      true,
    );
    expect(matchesSessionReplayTapTarget("PAY-button", "pay-BUTTON")).toBe(
      true,
    );
    expect(matchesSessionReplayTapTarget(" pay-button ", "pay-button")).toBe(
      true,
    );
    expect(
      matchesSessionReplayTapTarget("pay-button", "pay-button-label"),
    ).toBe(false);
    expect(
      matchesSessionReplayTapTarget("product-card-*", "product-card-42"),
    ).toBe(true);
    expect(
      matchesSessionReplayTapTarget("product-card-*", "product-card-"),
    ).toBe(true);
    expect(matchesSessionReplayTapTarget("product-card-*", "product")).toBe(
      false,
    );
    expect(matchesSessionReplayTapTarget("*", "anything")).toBe(false);
    expect(matchesSessionReplayTapTarget("a*b", "a*b")).toBe(false);
    expect(matchesSessionReplayTapTarget("", "pay-button")).toBe(false);
    expect(matchesSessionReplayTapTarget("pay-button", "")).toBe(false);
  });

  it("are kept when they can match, and dropped when their star cannot", () => {
    const settings: SessionReplayFrustrationSettings =
      normalizeSessionReplayFrustrationSettings({
        customSignals: [
          { id: "a", name: "Pay tapped", trigger: "tap", match: "pay-button" },
          { id: "b", name: "Cards", trigger: "tap", match: "product-card-*" },
          { id: "c", name: "Every tap", trigger: "tap", match: "*" },
          { id: "d", name: "Inside", trigger: "tap", match: "a*b" },
        ],
      });

    expect(
      settings.customSignals.map(
        (signal: { name: string; trigger: string; match: string }) => {
          return [signal.name, signal.trigger, signal.match];
        },
      ),
    ).toEqual([
      ["Pay tapped", "tap", "pay-button"],
      ["Cards", "tap", "product-card-*"],
    ]);
  });

  it("reach every recorder on the wire, which a recorder that cannot detect them ignores", () => {
    const config: SessionReplayFrustrationSignalsConfig =
      readSessionReplayFrustrationSignalsConfig({
        customSignals: [
          { name: "Pay tapped", trigger: "tap", match: "pay-button" },
        ],
      });

    expect(config.customSignals).toEqual([
      {
        name: "Pay tapped",
        trigger: "tap",
        match: "pay-button",
        isFrustration: true,
      },
    ]);
  });
});
