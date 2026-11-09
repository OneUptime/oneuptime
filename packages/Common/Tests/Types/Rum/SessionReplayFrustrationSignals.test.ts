import { describe, expect, it } from "@jest/globals";
import {
  SESSION_REPLAY_FRUSTRATION_LIMITS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SESSION_REPLAY_MAX_IGNORED_SELECTORS,
  SessionReplayFrustrationSettings,
  SessionReplayFrustrationSignalsConfig,
  getDefaultSessionReplayFrustrationSettings,
  matchesSessionReplayErrorText,
  matchesSessionReplayEventName,
  matchesSessionReplayPagePattern,
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
