import SessionReplayWireEncoding, {
  SESSION_REPLAY_ENVELOPE_TERMINATOR as COMMON_ENVELOPE_TERMINATOR,
} from "../../../../Common/Utils/Rum/SessionReplayWireEncoding";
import {
  SeededRandom,
  seededRandom,
} from "../../../../Common/Tests/Helpers/SeededRandom";
import {
  matchesSessionReplayErrorText,
  matchesSessionReplayEventName,
  matchesSessionReplayPagePattern,
  readSessionReplayFrustrationSignalsConfig,
  SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS as COMMON_CUSTOM_SIGNAL_COOLDOWN_MS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENT_NAME_LENGTH as COMMON_MAX_EVENT_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK as COMMON_MAX_SIGNAL_EVENTS_PER_CHUNK,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_MATCH_LENGTH as COMMON_MAX_MATCH_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH as COMMON_MAX_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS as COMMON_MAX_CUSTOM_SIGNALS,
  SessionReplayCustomSignalConfig as CommonCustomSignalConfig,
  SessionReplayCustomSignalCount as CommonCustomSignalCount,
  SessionReplayCustomSignalTrigger as CommonCustomSignalTrigger,
  SessionReplayFrustrationSignalsConfig as CommonFrustrationSignalsConfig,
} from "../../../../Common/Types/Rum/SessionReplayFrustrationSignals";
import {
  SessionReplayConfigResponse as CommonConfigResponse,
  SessionReplaySignalCounts as CommonSignalCounts,
  SESSION_REPLAY_APP_IDENTIFIER_HEADER as COMMON_APP_HEADER,
  SESSION_REPLAY_CONTENT_TYPE as COMMON_CONTENT_TYPE,
  SESSION_REPLAY_IDLE_PAUSE_MS as COMMON_IDLE_PAUSE_MS,
  SESSION_REPLAY_IDLE_ROLLOVER_MS as COMMON_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_LEGACY_CONTENT_TYPE as COMMON_LEGACY_CONTENT_TYPE,
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS as COMMON_MAX_OFFLINE_DELAY_MS,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER as COMMON_MOBILE_HEADER,
  SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES as COMMON_MOBILE_CAPABILITIES,
  SESSION_REPLAY_RECORDER_KIND_HEADER as COMMON_KIND_HEADER,
  SESSION_REPLAY_USER_REF_HEADER as COMMON_USER_REF_HEADER,
  SESSION_REPLAY_SCHEMA_VERSION as COMMON_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION as COMMON_WIRE_VERSION,
  SessionReplayFidelityNotice as CommonFidelityNotice,
} from "../../../../Common/Types/Rum/SessionReplay";
import {
  isSessionReplayCustomSignalPayload,
  isSessionReplayIdlePausedPayload,
  isSessionReplayIdleResumedPayload,
  SessionReplayCustomEventTag,
  SessionReplayCustomSignalPayload as CommonCustomSignalPayload,
  SessionReplayIdlePausedPayload as CommonIdlePausedPayload,
  SessionReplayIdleResumedPayload as CommonIdleResumedPayload,
} from "../../../../Common/Types/Rum/SessionReplayCustomEvents";
import {
  PRODUCT_ANALYTICS_CONTENT_TYPE as COMMON_PA_CONTENT_TYPE,
  PRODUCT_ANALYTICS_EVENTS_PATH as COMMON_PA_EVENTS_PATH,
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS as COMMON_PA_FLUSH_INTERVAL_MS,
  PRODUCT_ANALYTICS_MAX_BATCH_BYTES as COMMON_PA_MAX_BATCH_BYTES,
  PRODUCT_ANALYTICS_MAX_CONTEXT_VALUE_LENGTH as COMMON_PA_MAX_CONTEXT_VALUE_LENGTH,
  PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS as COMMON_PA_MAX_EVENT_AGE_MS,
  PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH as COMMON_PA_MAX_EVENT_NAME_LENGTH,
  PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH as COMMON_PA_MAX_EVENTS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_METRIC_NAME_LENGTH as COMMON_PA_MAX_METRIC_NAME_LENGTH,
  PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH as COMMON_PA_MAX_METRICS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_PENDING_EVENTS as COMMON_PA_MAX_PENDING_EVENTS,
  PRODUCT_ANALYTICS_PROPERTY_LIMITS as COMMON_PA_PROPERTY_LIMITS,
  PRODUCT_ANALYTICS_RESERVED_METRIC_PREFIX as COMMON_PA_RESERVED_METRIC_PREFIX,
  PRODUCT_ANALYTICS_TARGET_BATCH_BYTES as COMMON_PA_TARGET_BATCH_BYTES,
  PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS as COMMON_PA_USER_PROPERTY_LIMITS,
  PRODUCT_ANALYTICS_WIRE_VERSION as COMMON_PA_WIRE_VERSION,
  ProductAnalyticsEventKind as CommonProductAnalyticsEventKind,
  ProductAnalyticsRecorderConfig as CommonProductAnalyticsRecorderConfig,
  ProductAnalyticsWireBatch as CommonProductAnalyticsWireBatch,
  ProductAnalyticsWireContext as CommonProductAnalyticsWireContext,
  ProductAnalyticsWireEvent as CommonProductAnalyticsWireEvent,
  ProductAnalyticsWireMetric as CommonProductAnalyticsWireMetric,
  isProductAnalyticsMetricName as commonIsProductAnalyticsMetricName,
  normalizeProductAnalyticsUserPropertyKeys as commonNormalizeUserPropertyKeys,
  readProductAnalyticsRecorderConfig as commonReadRecorderConfig,
  toProductAnalyticsEventName as commonToProductAnalyticsEventName,
} from "../../../../Common/Types/Rum/ProductAnalyticsEvents";
import { PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE as COMMON_PA_TABLET_MIN_SHORT_SIDE } from "../../../../Common/Types/Rum/ProductAnalytics";
import {
  SESSION_REPLAY_MAX_APP_VERSION_LENGTH as COMMON_MAX_APP_VERSION_LENGTH,
  toSessionReplayAppVersion,
} from "../../../../Common/Types/Rum/SessionReplay";
import {
  PRODUCT_ANALYTICS_CONTENT_TYPE,
  PRODUCT_ANALYTICS_EVENTS_PATH,
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  PRODUCT_ANALYTICS_MAX_APP_VERSION_LENGTH,
  PRODUCT_ANALYTICS_MAX_BATCH_BYTES,
  PRODUCT_ANALYTICS_MAX_CONTEXT_VALUE_LENGTH,
  PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS,
  PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH,
  PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_METRIC_NAME_LENGTH,
  PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
  PRODUCT_ANALYTICS_MAX_USER_PROPERTY_KEY_LENGTH,
  PRODUCT_ANALYTICS_MAX_USER_PROPERTY_KEYS,
  PRODUCT_ANALYTICS_RESERVED_METRIC_PREFIX,
  PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE,
  PRODUCT_ANALYTICS_TARGET_BATCH_BYTES,
  PRODUCT_ANALYTICS_WIRE_VERSION,
  ProductAnalyticsEventKind,
  ProductAnalyticsRecorderConfig,
  ProductAnalyticsWireBatch,
  ProductAnalyticsWireContext,
  ProductAnalyticsWireEvent,
  ProductAnalyticsWireMetric,
  isProductAnalyticsMetricName,
  normalizeProductAnalyticsUserPropertyKeys,
  readProductAnalyticsRecorderConfig,
  toProductAnalyticsAppVersion,
  toProductAnalyticsEventName,
} from "../src/ProductAnalyticsContract";
import {
  MAX_CUSTOM_EVENT_PROPERTY_KEYS,
  MAX_TRAIT_KEY_LENGTH,
  MAX_TRAIT_VALUE_LENGTH,
} from "../src/Sanitize";
import {
  CUSTOM_EVENT_TAG,
  CUSTOM_SIGNAL_CUSTOM_EVENT_TAG,
  encodeSessionReplayEnvelopeLine,
  ERROR_CUSTOM_EVENT_TAG,
  escapeSessionReplayJson,
  IDENTIFY_CUSTOM_EVENT_TAG,
  IDLE_PAUSED_CUSTOM_EVENT_TAG,
  IDLE_RESUMED_CUSTOM_EVENT_TAG,
  ROUTE_CUSTOM_EVENT_TAG,
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_CONTENT_TYPE,
  SESSION_REPLAY_ENVELOPE_TERMINATOR,
  SESSION_REPLAY_IDLE_PAUSE_MS,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_LEGACY_CONTENT_TYPE,
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
  SESSION_REPLAY_USER_REF_HEADER,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SESSION_ROTATED_CUSTOM_EVENT_TAG,
  SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENT_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_MATCH_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_SIGNALS,
  SessionReplayConfigResponse,
  SessionReplayCustomSignalConfig,
  SessionReplayCustomSignalCount,
  SessionReplayCustomSignalPayload,
  SessionReplayCustomSignalTrigger,
  SessionReplayFidelityNotice,
  SessionReplayFrustrationSignalsConfig,
  SessionReplayIdlePausedPayload,
  SessionReplayIdleResumedPayload,
  SessionReplaySignalCounts,
  TAGS_CUSTOM_EVENT_TAG,
  VISIBILITY_CUSTOM_EVENT_TAG,
} from "../src/Contract";
import {
  matchesErrorText,
  matchesEventName,
  matchesPagePattern,
  readCustomSignals,
  readPathAsWritten,
} from "../src/CustomSignals";
import { sanitizeRoute } from "../src/Sanitize";
import fs from "node:fs";
import path from "node:path";
import UrlScrubber from "../../../../Common/Utils/Rum/UrlScrubber";
import {
  PAGES_WITH_PERSONAL_DATA,
  PAGES_WITH_SECRETS,
  PageSpellingCase,
} from "../../../../Common/Tests/Helpers/PageSpellings";

/*
 * True only when the two types are identical - same members, same
 * optionality - so a field added to one copy and not the other is a
 * compile error here, not a payload the player silently ignores.
 */
type IdenticalTypes<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

describe("published SDK wire contract", () => {
  test("stays in lockstep with Common without creating a runtime dependency", () => {
    expect(SESSION_REPLAY_WIRE_VERSION).toBe(COMMON_WIRE_VERSION);
    expect(SESSION_REPLAY_SCHEMA_VERSION).toBe(COMMON_SCHEMA_VERSION);
    expect(SESSION_REPLAY_CONTENT_TYPE).toBe(COMMON_CONTENT_TYPE);
    expect(SESSION_REPLAY_APP_IDENTIFIER_HEADER).toBe(COMMON_APP_HEADER);
    expect(SESSION_REPLAY_RECORDER_KIND_HEADER).toBe(COMMON_KIND_HEADER);
    expect(SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER).toBe(
      COMMON_MOBILE_HEADER,
    );
    expect(SESSION_REPLAY_USER_REF_HEADER).toBe(COMMON_USER_REF_HEADER);
    expect(SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES).toEqual(
      COMMON_MOBILE_CAPABILITIES,
    );
    /*
     * Offline mode: the device discards what it held longer than the
     * server is willing to place on the recording's real timeline.
     */
    expect(SESSION_REPLAY_MAX_OFFLINE_DELAY_MS).toBe(
      COMMON_MAX_OFFLINE_DELAY_MS,
    );
  });

  /*
   * The idle pause (#4208). The recorder stops capturing after Common's
   * pause window and marks the stretch with Common's two markers; the
   * player draws that stretch from them, so a drift in either copy would
   * be a pause the player shows as footage of a screen that sat still.
   */
  test("pauses on Common's idle window and marks it with Common's markers", () => {
    expect(SESSION_REPLAY_IDLE_PAUSE_MS).toBe(COMMON_IDLE_PAUSE_MS);
    expect(SESSION_REPLAY_IDLE_ROLLOVER_MS).toBe(COMMON_IDLE_ROLLOVER_MS);
    /* A pause must come well before the rollover, or nothing could resume. */
    expect(SESSION_REPLAY_IDLE_PAUSE_MS).toBeLessThan(
      SESSION_REPLAY_IDLE_ROLLOVER_MS,
    );
    expect(IDLE_PAUSED_CUSTOM_EVENT_TAG).toBe(
      SessionReplayCustomEventTag.IdlePaused,
    );
    expect(IDLE_RESUMED_CUSTOM_EVENT_TAG).toBe(
      SessionReplayCustomEventTag.IdleResumed,
    );

    const pausedIsIdentical: IdenticalTypes<
      SessionReplayIdlePausedPayload,
      CommonIdlePausedPayload
    > = true;
    const resumedIsIdentical: IdenticalTypes<
      SessionReplayIdleResumedPayload,
      CommonIdleResumedPayload
    > = true;
    expect(pausedIsIdentical && resumedIsIdentical).toBe(true);

    /* And what the recorder builds passes the guards the player reads through. */
    const paused: SessionReplayIdlePausedPayload = {
      idleSinceUnixMs: 1_000,
      pausedAtUnixMs: 1_000 + SESSION_REPLAY_IDLE_PAUSE_MS,
    };
    const resumed: SessionReplayIdleResumedPayload = {
      pausedAtUnixMs: paused.pausedAtUnixMs,
      resumedAtUnixMs: paused.pausedAtUnixMs + 60_000,
    };
    expect(isSessionReplayIdlePausedPayload(paused)).toBe(true);
    expect(isSessionReplayIdleResumedPayload(resumed)).toBe(true);
  });

  test("names every custom event it shares with the player exactly as Common does", () => {
    expect(ROUTE_CUSTOM_EVENT_TAG).toBe(SessionReplayCustomEventTag.Route);
    expect(ERROR_CUSTOM_EVENT_TAG).toBe(SessionReplayCustomEventTag.Error);
    expect(CUSTOM_EVENT_TAG).toBe(SessionReplayCustomEventTag.Custom);
    expect(IDENTIFY_CUSTOM_EVENT_TAG).toBe(
      SessionReplayCustomEventTag.Identify,
    );
    expect(TAGS_CUSTOM_EVENT_TAG).toBe(SessionReplayCustomEventTag.Tags);
    expect(VISIBILITY_CUSTOM_EVENT_TAG).toBe(
      SessionReplayCustomEventTag.Visibility,
    );
  });

  test("uses the exact stored mobile fidelity vocabulary", () => {
    expect(SessionReplayFidelityNotice.MobileImagesOpaque).toBe(
      CommonFidelityNotice.MobileImagesOpaque,
    );
    expect(SessionReplayFidelityNotice.MobileWebViewOpaque).toBe(
      CommonFidelityNotice.MobileWebViewOpaque,
    );
    expect(SessionReplayFidelityNotice.MobileCanvasOpaque).toBe(
      CommonFidelityNotice.MobileCanvasOpaque,
    );
    expect(SessionReplayFidelityNotice.MobileAnimationSampled).toBe(
      CommonFidelityNotice.MobileAnimationSampled,
    );
  });

  /*
   * Frustration signals (issue #6443). The settings arrive on the config
   * response and the counts leave on the envelope in Common's shapes; the
   * signals are read and matched by copies of Common's functions, compared
   * here on the same inputs, so a signal the server accepted fires on a
   * phone exactly when it would in a browser.
   */
  describe("frustration signals", () => {
    test("carries Common's settings, counts and marker, type for type", () => {
      const configIsIdentical: IdenticalTypes<
        SessionReplayFrustrationSignalsConfig,
        CommonFrustrationSignalsConfig
      > = true;
      const signalIsIdentical: IdenticalTypes<
        SessionReplayCustomSignalConfig,
        CommonCustomSignalConfig
      > = true;
      const triggerIsIdentical: IdenticalTypes<
        SessionReplayCustomSignalTrigger,
        CommonCustomSignalTrigger
      > = true;
      const countIsIdentical: IdenticalTypes<
        SessionReplayCustomSignalCount,
        CommonCustomSignalCount
      > = true;
      const payloadIsIdentical: IdenticalTypes<
        SessionReplayCustomSignalPayload,
        CommonCustomSignalPayload
      > = true;
      const responseFieldIsIdentical: IdenticalTypes<
        SessionReplayConfigResponse["frustrationSignals"],
        CommonConfigResponse["frustrationSignals"]
      > = true;
      const countsFieldIsIdentical: IdenticalTypes<
        SessionReplaySignalCounts["customSignals"],
        CommonSignalCounts["customSignals"]
      > = true;
      expect(
        configIsIdentical &&
          signalIsIdentical &&
          triggerIsIdentical &&
          countIsIdentical &&
          payloadIsIdentical &&
          responseFieldIsIdentical &&
          countsFieldIsIdentical,
      ).toBe(true);

      expect(CUSTOM_SIGNAL_CUSTOM_EVENT_TAG).toBe(
        SessionReplayCustomEventTag.CustomSignal,
      );
      expect(SESSION_REPLAY_MAX_CUSTOM_SIGNALS).toBe(COMMON_MAX_CUSTOM_SIGNALS);
      expect(SESSION_REPLAY_MAX_CUSTOM_SIGNAL_NAME_LENGTH).toBe(
        COMMON_MAX_NAME_LENGTH,
      );
      expect(SESSION_REPLAY_MAX_CUSTOM_SIGNAL_MATCH_LENGTH).toBe(
        COMMON_MAX_MATCH_LENGTH,
      );
      expect(SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENT_NAME_LENGTH).toBe(
        COMMON_MAX_EVENT_NAME_LENGTH,
      );
      expect(SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS).toBe(
        COMMON_CUSTOM_SIGNAL_COOLDOWN_MS,
      );
      expect(SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK).toBe(
        COMMON_MAX_SIGNAL_EVENTS_PER_CHUNK,
      );

      const marker: SessionReplayCustomSignalPayload = {
        name: "Order failed",
        trigger: "page",
        isFrustration: true,
        atUnixMs: 1_000,
      };
      expect(isSessionReplayCustomSignalPayload(marker)).toBe(true);
    });

    test("reads a config's signals as Common does, less the clicks", () => {
      const random: SeededRandom = seededRandom(6443);
      const names: Array<unknown> = [
        "Checkout error",
        "checkout ERROR",
        "  Padded  ",
        "",
        "x".repeat(40),
        "x".repeat(41),
        7,
        undefined,
      ];
      const triggers: Array<unknown> = [
        "click",
        "page",
        "event",
        "error",
        "shake",
        null,
      ];
      const matches: Array<unknown> = [
        "/checkout/error",
        "*/failed",
        "checkout",
        " help_opened ",
        "card declined",
        "button.pay",
        "",
        "e".repeat(64),
        "e".repeat(65),
        "t".repeat(200),
        "t".repeat(201),
        false,
      ];
      const flags: Array<unknown> = [true, false, undefined, "no", 0];
      const pick: (list: Array<unknown>) => unknown = (
        list: Array<unknown>,
      ): unknown => {
        return list[random(list.length)];
      };

      for (let iteration: number = 0; iteration < 500; iteration++) {
        const customSignals: Array<unknown> = [];
        const length: number = random(26);
        for (let index: number = 0; index < length; index++) {
          customSignals.push(
            random(12) === 0
              ? "not a signal"
              : {
                  name: pick(names),
                  trigger: pick(triggers),
                  match: pick(matches),
                  isFrustration: pick(flags),
                  isEnabled: pick(flags),
                },
          );
        }
        const config: Record<string, unknown> = { customSignals };

        const expected: Array<CommonCustomSignalConfig> =
          readSessionReplayFrustrationSignalsConfig(
            config,
          ).customSignals.filter(
            (signal: CommonCustomSignalConfig): boolean => {
              return signal.trigger !== "click";
            },
          );
        expect(readCustomSignals(config)).toEqual(expected);
      }

      expect(readCustomSignals(null)).toEqual([]);
      expect(readCustomSignals({ customSignals: {} })).toEqual([]);
    });

    test("matches pages, events and errors exactly as Common does", () => {
      const random: SeededRandom = seededRandom(5);
      const patternAlphabet: string = "/**abAB-.";
      const pathAlphabet: string = "/abAB-.";

      const text: (alphabet: string, maxLength: number) => string = (
        alphabet: string,
        maxLength: number,
      ): string => {
        let value: string = "";
        const length: number = random(maxLength + 1);
        for (let index: number = 0; index < length; index++) {
          value += alphabet.charAt(random(alphabet.length));
        }
        return value;
      };

      for (let iteration: number = 0; iteration < 3000; iteration++) {
        const pattern: string = text(patternAlphabet, 8);
        const path: string = text(pathAlphabet, 10);

        expect(matchesPagePattern(pattern, path)).toBe(
          matchesSessionReplayPagePattern(pattern, path),
        );
        expect(matchesErrorText(pattern, path)).toBe(
          matchesSessionReplayErrorText(pattern, path),
        );
        expect(matchesEventName(pattern, path)).toBe(
          matchesSessionReplayEventName(pattern, path),
        );
      }

      for (const [pattern, path] of [
        ["/checkout/error", "/Checkout/Error/"],
        ["/orders/*/failed", "/orders/123/failed"],
        ["/orders/*/failed", "/orders/123/failed/again"],
        ["*/failed", "/a/b/failed"],
        ["/checkout*", "/checkout"],
        ["/a*a", "/a"],
        ["/", "/"],
        ["*", "/anything"],
      ] as Array<[string, string]>) {
        expect(matchesPagePattern(pattern, path)).toBe(
          matchesSessionReplayPagePattern(pattern, path),
        );
      }
    });

    /*
     * #8195: a pattern is compared with a path in the spelling a person
     * reads, "/café" whatever the escapes - Common's
     * UrlScrubber.normalizePathSpelling(path, true), which this recorder
     * carries a copy of (readPathAsWritten). The two read every spelling
     * the same, and the matchers match on it alike.
     */
    test("reads a path's spelling, and matches a spelled page, exactly as Common does", () => {
      const random: SeededRandom = seededRandom(8195);
      const pieces: Array<string> = [
        "/",
        "*",
        "a",
        "E",
        "%C3%A9",
        "%c3%a9",
        "%CC%81",
        "%cc%81",
        "é",
        "É",
        "e",
        "%C3%89",
        "%2F",
        "%2f",
        "%25",
        "%E9",
        "%e2%84%aa",
        "%D8%B3",
        "س",
        "%",
        "%4",
        "%zz",
        "%F0%9F%98%80",
        String.fromCharCode(0x301),
      ];

      const text: (maxPieces: number) => string = (
        maxPieces: number,
      ): string => {
        let value: string = "";
        const count: number = random(maxPieces + 1);

        for (let index: number = 0; index < count; index++) {
          value += pieces[random(pieces.length)];
        }

        return value;
      };

      let matched: number = 0;

      for (let iteration: number = 0; iteration < 4000; iteration++) {
        const pattern: string = `/${text(5)}`;
        const path: string = `/${text(6)}`;

        expect([path, readPathAsWritten(path)]).toEqual([
          path,
          UrlScrubber.normalizePathSpelling(path, true),
        ]);

        const common: boolean = matchesSessionReplayPagePattern(pattern, path);

        expect([pattern, path, matchesPagePattern(pattern, path)]).toEqual([
          pattern,
          path,
          common,
        ]);

        if (common) {
          matched++;
        }
      }

      // The sweep reaches both sides of the rule.
      expect(matched).toBeGreaterThan(100);

      for (const [pattern, path, expected] of [
        ["/café", "/caf%C3%A9", true],
        ["/café", "/caf%c3%a9", true],
        ["/café", "/cafe%CC%81", true],
        ["/CAFÉ", "/caf%C3%A9", true],
        ["/caf%C3%A9", "/cafe%CC%81", true],
        ["/a%2Fb", "/a/b", false],
      ] as Array<[string, string, boolean]>) {
        expect([pattern, path, matchesPagePattern(pattern, path)]).toEqual([
          pattern,
          path,
          expected,
        ]);
      }
    });
  });

  /*
   * The route rule (sanitizeRoute) is a copy of the path rule Common's
   * UrlScrubber holds every address to, so a screen is redacted alike in
   * the recording and in what the server keeps of it. Both read the shared
   * table the browser recorder and the server read (#8197, #8385): a route
   * sent as the path in `sent` is the page in `page`.
   */
  test("redacts a route as Common's scrubber redacts a path", () => {
    for (const row of [...PAGES_WITH_PERSONAL_DATA, ...PAGES_WITH_SECRETS]) {
      expect([row.name, sanitizeRoute(row.sent)]).toEqual([
        row.name,
        (row as PageSpellingCase).page,
      ]);
    }

    for (const route of [
      "/auth/callback/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
      "/users/someone%2540example.com",
      "/files/report-2026-11-15.pdf",
      "/a%2Fb/someone%40example.com",
      "/x/%25zz-off",
    ]) {
      expect([route, sanitizeRoute(route)]).toEqual([
        route,
        UrlScrubber.scrubPath(route),
      ]);
    }
  });

  /*
   * Product analytics (issue #6629). The batch, its limits, its route and
   * the config field that switches it on are copies of Common's
   * ProductAnalyticsEvents, and so are the rules a name, a metric, an app
   * version and the trait keys are read by, compared here on the same
   * inputs: what the server takes is what the phone sends.
   */
  describe("product analytics", () => {
    test("carries Common's batch, context, event and config types, type for type", () => {
      /*
       * The event kind is an enum on both sides, and two enums are never
       * one type however alike: the rest of each type is compared whole,
       * and the kinds value for value below.
       */
      const batchIsIdentical: IdenticalTypes<
        Omit<ProductAnalyticsWireBatch, "events">,
        Omit<CommonProductAnalyticsWireBatch, "events">
      > = true;
      const eventIsIdentical: IdenticalTypes<
        Omit<ProductAnalyticsWireEvent, "kind">,
        Omit<CommonProductAnalyticsWireEvent, "kind">
      > = true;
      const eventsAreIdentical: IdenticalTypes<
        Omit<ProductAnalyticsWireBatch["events"][number], "kind">,
        Omit<CommonProductAnalyticsWireBatch["events"][number], "kind">
      > = true;
      const metricIsIdentical: IdenticalTypes<
        ProductAnalyticsWireMetric,
        CommonProductAnalyticsWireMetric
      > = true;
      const contextIsIdentical: IdenticalTypes<
        ProductAnalyticsWireContext,
        CommonProductAnalyticsWireContext
      > = true;
      const configIsIdentical: IdenticalTypes<
        ProductAnalyticsRecorderConfig,
        CommonProductAnalyticsRecorderConfig
      > = true;
      const responseFieldIsIdentical: IdenticalTypes<
        SessionReplayConfigResponse["productAnalytics"],
        CommonConfigResponse["productAnalytics"]
      > = true;
      expect(
        batchIsIdentical &&
          eventIsIdentical &&
          eventsAreIdentical &&
          metricIsIdentical &&
          contextIsIdentical &&
          configIsIdentical &&
          responseFieldIsIdentical,
      ).toBe(true);

      expect(Object.entries(ProductAnalyticsEventKind)).toEqual(
        Object.entries(CommonProductAnalyticsEventKind),
      );
    });

    test("posts to Common's route, under Common's limits", () => {
      expect(PRODUCT_ANALYTICS_EVENTS_PATH).toBe(COMMON_PA_EVENTS_PATH);
      expect(PRODUCT_ANALYTICS_WIRE_VERSION).toBe(COMMON_PA_WIRE_VERSION);
      expect(PRODUCT_ANALYTICS_CONTENT_TYPE).toBe(COMMON_PA_CONTENT_TYPE);
      expect(PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH).toBe(
        COMMON_PA_MAX_EVENTS_PER_BATCH,
      );
      expect(PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH).toBe(
        COMMON_PA_MAX_METRICS_PER_BATCH,
      );
      expect(PRODUCT_ANALYTICS_MAX_BATCH_BYTES).toBe(COMMON_PA_MAX_BATCH_BYTES);
      expect(PRODUCT_ANALYTICS_TARGET_BATCH_BYTES).toBe(
        COMMON_PA_TARGET_BATCH_BYTES,
      );
      expect(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS).toBe(
        COMMON_PA_FLUSH_INTERVAL_MS,
      );
      expect(PRODUCT_ANALYTICS_MAX_PENDING_EVENTS).toBe(
        COMMON_PA_MAX_PENDING_EVENTS,
      );
      expect(PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH).toBe(
        COMMON_PA_MAX_EVENT_NAME_LENGTH,
      );
      expect(PRODUCT_ANALYTICS_MAX_CONTEXT_VALUE_LENGTH).toBe(
        COMMON_PA_MAX_CONTEXT_VALUE_LENGTH,
      );
      expect(PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS).toBe(
        COMMON_PA_MAX_EVENT_AGE_MS,
      );
      expect(PRODUCT_ANALYTICS_MAX_METRIC_NAME_LENGTH).toBe(
        COMMON_PA_MAX_METRIC_NAME_LENGTH,
      );
      expect(PRODUCT_ANALYTICS_RESERVED_METRIC_PREFIX).toBe(
        COMMON_PA_RESERVED_METRIC_PREFIX,
      );
      expect(PRODUCT_ANALYTICS_MAX_APP_VERSION_LENGTH).toBe(
        COMMON_MAX_APP_VERSION_LENGTH,
      );
      expect(PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE).toBe(
        COMMON_PA_TABLET_MIN_SHORT_SIDE,
      );
      expect(PRODUCT_ANALYTICS_MAX_USER_PROPERTY_KEYS).toBe(
        COMMON_PA_USER_PROPERTY_LIMITS.maxKeys,
      );
      expect(PRODUCT_ANALYTICS_MAX_USER_PROPERTY_KEY_LENGTH).toBe(
        COMMON_PA_USER_PROPERTY_LIMITS.maxKeyLength,
      );
      /* track() properties are capped as Common caps them. */
      expect(MAX_CUSTOM_EVENT_PROPERTY_KEYS).toBe(
        COMMON_PA_PROPERTY_LIMITS.maxKeys,
      );
      expect(MAX_TRAIT_KEY_LENGTH).toBe(COMMON_PA_PROPERTY_LIMITS.maxKeyLength);
      expect(MAX_TRAIT_VALUE_LENGTH).toBe(
        COMMON_PA_PROPERTY_LIMITS.maxValueLength,
      );
    });

    test("reads an event name, a metric name and an app version exactly as Common does", () => {
      const random: SeededRandom = seededRandom(6629);
      const alphabet: string =
        "aZ09 ._-/\n\t\u0000\u007f\u0085oneuptime.é日😀";
      const text: (maxLength: number) => string = (
        maxLength: number,
      ): string => {
        let value: string = "";
        const length: number = random(maxLength + 1);
        for (let index: number = 0; index < length; index++) {
          value += alphabet.charAt(random(alphabet.length));
        }
        return value;
      };

      for (let iteration: number = 0; iteration < 3000; iteration++) {
        const value: string = text(iteration % 7 === 0 ? 140 : 20);

        expect([value, toProductAnalyticsEventName(value)]).toEqual([
          value,
          commonToProductAnalyticsEventName(value),
        ]);
        expect([value, isProductAnalyticsMetricName(value)]).toEqual([
          value,
          commonIsProductAnalyticsMetricName(value),
        ]);
        expect([value, toProductAnalyticsAppVersion(value)]).toEqual([
          value,
          toSessionReplayAppVersion(value),
        ]);
      }

      for (const value of [
        "cart.value",
        "Checkout/latency_ms",
        "oneuptime.rum.product.events",
        "OneUptime.anything",
        "9lives",
        "x".repeat(100),
        "x".repeat(101),
        undefined,
        null,
        42,
        { name: "x" },
      ] as Array<unknown>) {
        expect([value, isProductAnalyticsMetricName(value)]).toEqual([
          value,
          commonIsProductAnalyticsMetricName(value),
        ]);
        expect([value, toProductAnalyticsEventName(value)]).toEqual([
          value,
          commonToProductAnalyticsEventName(value),
        ]);
        expect([value, toProductAnalyticsAppVersion(value)]).toEqual([
          value,
          toSessionReplayAppVersion(value),
        ]);
      }
    });

    test("reads the config field and its trait keys exactly as Common does", () => {
      const random: SeededRandom = seededRandom(66);
      const keys: Array<unknown> = [
        "plan",
        " plan ",
        "Plan",
        "role",
        "",
        "   ",
        "__proto__",
        "k".repeat(40),
        "k".repeat(41),
        7,
        null,
      ];

      for (let iteration: number = 0; iteration < 500; iteration++) {
        const list: Array<unknown> = [];
        const length: number = random(26);
        for (let index: number = 0; index < length; index++) {
          list.push(keys[random(keys.length)]);
        }
        const field: unknown =
          iteration % 11 === 0
            ? "on"
            : {
                enabled: [true, false, "true", 1, undefined][random(5)],
                userPropertyKeys: iteration % 13 === 0 ? "plan" : list,
              };

        expect(normalizeProductAnalyticsUserPropertyKeys(list)).toEqual(
          commonNormalizeUserPropertyKeys(list),
        );
        expect(readProductAnalyticsRecorderConfig(field)).toEqual(
          commonReadRecorderConfig(field),
        );
      }

      expect(readProductAnalyticsRecorderConfig(undefined)).toEqual(
        commonReadRecorderConfig(undefined),
      );
      expect(readProductAnalyticsRecorderConfig(null)).toEqual(
        commonReadRecorderConfig(null),
      );
    });
  });

  test("marks a rotated session with the tag the browser recorder uses", () => {
    expect(SESSION_ROTATED_CUSTOM_EVENT_TAG).toBe(
      SessionReplayCustomEventTag.SessionRotated,
    );
  });
  /*
   * The frame encoding is a copy, not an import, so a published SDK never
   * drags Common into a customer's bundle. A drift here would be a mobile
   * chunk that a customer's firewall blocks while the browser's passes.
   */
  /*
   * Issue #8928: every OneUptime client reads Retry-After with Common's
   * RetryAfter. This package cannot import Common, so it carries the file
   * byte for byte: copy packages/Common/Utils/RetryAfter.ts over
   * src/RetryAfter.ts when this fails.
   */
  test("reads Retry-After with a byte-identical copy of Common's RetryAfter", () => {
    const common: Buffer = fs.readFileSync(
      path.join(__dirname, "../../../../Common/Utils/RetryAfter.ts"),
    );
    const copy: Buffer = fs.readFileSync(
      path.join(__dirname, "../src/RetryAfter.ts"),
    );

    expect(copy.equals(common)).toBe(true);
    // It imports nothing, so the copy needs nothing of Common's.
    expect(copy.toString("utf8")).not.toMatch(/^import /m);
  });

  test("frames envelopes exactly the way Common does", () => {
    expect(SESSION_REPLAY_CONTENT_TYPE).toBe("application/octet-stream");
    expect(SESSION_REPLAY_LEGACY_CONTENT_TYPE).toBe(COMMON_LEGACY_CONTENT_TYPE);
    expect(SESSION_REPLAY_ENVELOPE_TERMINATOR).toBe(COMMON_ENVELOPE_TERMINATOR);

    const samples: Array<Record<string, unknown>> = [
      {},
      { url: "https://shop.example.com/search/gadget+case%20x%0Ay" },
      { meta: { identifiedUserTraits: { name: "Bridget Jones & Co" } } },
      { note: "GET /v1/users HTTP/1.1 or Http/2", other: "https://x/y" },
      { big: 1e21, nested: [{ "100%": ["&", "%", "http/", "日本", "😀"] }] },
    ];

    for (const sample of samples) {
      expect(encodeSessionReplayEnvelopeLine(sample)).toBe(
        SessionReplayWireEncoding.encodeEnvelopeLine(sample),
      );
      expect(escapeSessionReplayJson(JSON.stringify(sample))).toBe(
        SessionReplayWireEncoding.escapeJson(JSON.stringify(sample)),
      );
    }

    const alphabet: string = '%&+/ \\"hHtTpP0123aZ\n日😀';
    const random: SeededRandom = seededRandom(7);

    for (let iteration: number = 0; iteration < 1000; iteration++) {
      let text: string = "";

      for (let index: number = 0; index < 20; index++) {
        text += alphabet.charAt(random(alphabet.length));
      }

      const sample: Record<string, unknown> = { [text]: text };

      expect(encodeSessionReplayEnvelopeLine(sample)).toBe(
        SessionReplayWireEncoding.encodeEnvelopeLine(sample),
      );
    }
  });
});
