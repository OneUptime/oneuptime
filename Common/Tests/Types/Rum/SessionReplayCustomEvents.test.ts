import { describe, expect, it } from "@jest/globals";
import {
  SESSION_REPLAY_CUSTOM_EVENT_TAGS,
  SESSION_REPLAY_RRWEB_CUSTOM_EVENT_TYPE,
  SessionReplayCustomEventTag,
  isSessionReplayBfcacheRestorePayload,
  isSessionReplayClickDroppedPayload,
  isSessionReplayClickPayload,
  isSessionReplayConsolePayload,
  isSessionReplayCustomDroppedPayload,
  isSessionReplayCustomEventData,
  isSessionReplayCustomEventTag,
  isSessionReplayCustomPayload,
  isSessionReplayErrorPayload,
  isSessionReplayFrustrationPayload,
  isSessionReplayIdentifyPayload,
  isSessionReplayNetworkPayload,
  isSessionReplayPerformanceBudgetPayload,
  isSessionReplayPerformancePayload,
  isSessionReplayRoutePayload,
  isSessionReplaySessionRotatedPayload,
  isSessionReplayTagsPayload,
  isSessionReplayVisibilityPayload,
  isSessionReplayWebVitalPayload,
} from "../../../Types/Rum/SessionReplayCustomEvents";
import { CONSOLE_CUSTOM_EVENT_TAG } from "../../../../App/FeatureSet/BrowserRecorder/src/ConsoleRecorder";
import { NETWORK_CUSTOM_EVENT_TAG } from "../../../../App/FeatureSet/BrowserRecorder/src/NetworkRecorder";
import { ROUTE_CUSTOM_EVENT_TAG } from "../../../../App/FeatureSet/BrowserRecorder/src/RouteRecorder";
import { ERROR_CUSTOM_EVENT_TAG } from "../../../../App/FeatureSet/BrowserRecorder/src/ErrorRecorder";
import { FRUSTRATION_CUSTOM_EVENT_TAG } from "../../../../App/FeatureSet/BrowserRecorder/src/FrustrationDetector";
import { PERFORMANCE_CUSTOM_EVENT_TAG } from "../../../../App/FeatureSet/BrowserRecorder/src/PerformanceRecorder";

/*
 * The tag vocabulary is quoted by stored payloads and by the recorder's
 * own constants. Two things are pinned: the shared constants equal the
 * strings the recorder emits today, so the player extracts what the
 * recorder wrote; and every guard accepts the payload the recorder
 * actually builds while rejecting the minimum-field violations.
 */

describe("SessionReplayCustomEventTag", () => {
  it("matches the strings the recorder emits today, character for character", () => {
    expect(SessionReplayCustomEventTag.Console).toBe(CONSOLE_CUSTOM_EVENT_TAG);
    expect(SessionReplayCustomEventTag.Network).toBe(NETWORK_CUSTOM_EVENT_TAG);
    expect(SessionReplayCustomEventTag.Route).toBe(ROUTE_CUSTOM_EVENT_TAG);
    expect(SessionReplayCustomEventTag.Error).toBe(ERROR_CUSTOM_EVENT_TAG);
    expect(SessionReplayCustomEventTag.Frustration).toBe(
      FRUSTRATION_CUSTOM_EVENT_TAG,
    );
    expect(SessionReplayCustomEventTag.Performance).toBe(
      PERFORMANCE_CUSTOM_EVENT_TAG,
    );
    /*
     * Recorder.ts owns these two but imports rrweb at the top level, which
     * Common's jest cannot resolve, so the strings are pinned literally
     * against BFCACHE_CUSTOM_EVENT_TAG / SESSION_ROTATED_CUSTOM_EVENT_TAG.
     */
    expect(SessionReplayCustomEventTag.BfcacheRestore).toBe(
      "oneuptime.bfcache-restore",
    );
    expect(SessionReplayCustomEventTag.SessionRotated).toBe(
      "oneuptime.session-rotated",
    );
  });

  it("names the new engagement tags under the oneuptime. prefix", () => {
    expect(SessionReplayCustomEventTag.Click).toBe("oneuptime.click");
    expect(SessionReplayCustomEventTag.ClickDropped).toBe(
      "oneuptime.click-dropped",
    );
    expect(SessionReplayCustomEventTag.Visibility).toBe("oneuptime.visibility");
    expect(SessionReplayCustomEventTag.Custom).toBe("oneuptime.custom");
    expect(SessionReplayCustomEventTag.CustomDropped).toBe(
      "oneuptime.custom-dropped",
    );
    expect(SessionReplayCustomEventTag.Identify).toBe("oneuptime.identify");
    expect(SessionReplayCustomEventTag.Tags).toBe("oneuptime.tags");
  });

  it("every tag is unique and prefixed", () => {
    expect(new Set(SESSION_REPLAY_CUSTOM_EVENT_TAGS).size).toBe(
      SESSION_REPLAY_CUSTOM_EVENT_TAGS.length,
    );
    expect(SESSION_REPLAY_CUSTOM_EVENT_TAGS).toHaveLength(15);

    for (const tag of SESSION_REPLAY_CUSTOM_EVENT_TAGS) {
      expect(tag.startsWith("oneuptime.")).toBe(true);
      expect(isSessionReplayCustomEventTag(tag)).toBe(true);
    }

    expect(isSessionReplayCustomEventTag("oneuptime.nope")).toBe(false);
    expect(SESSION_REPLAY_RRWEB_CUSTOM_EVENT_TYPE).toBe(5);
  });

  it("isSessionReplayCustomEventData needs a string tag", () => {
    expect(isSessionReplayCustomEventData({ tag: "x", payload: {} })).toBe(
      true,
    );
    expect(isSessionReplayCustomEventData({ tag: "x" })).toBe(true);
    expect(isSessionReplayCustomEventData({ payload: {} })).toBe(false);
    expect(isSessionReplayCustomEventData(null)).toBe(false);
  });
});

describe("payload guards accept what the recorder builds", () => {
  it("console: ConsoleRecorder's { level, message }", () => {
    expect(
      isSessionReplayConsolePayload({ level: "error", message: "x" }),
    ).toBe(true);
    expect(isSessionReplayConsolePayload({ level: "warn", message: "" })).toBe(
      true,
    );
    expect(isSessionReplayConsolePayload({ level: "log", message: "x" })).toBe(
      false,
    );
    expect(isSessionReplayConsolePayload({ level: "error" })).toBe(false);
  });

  it("network: NetworkRecorder's RecordedRequest, with and without traceId", () => {
    const request: Record<string, unknown> = {
      method: "POST",
      url: "https://acme.com/api/orders",
      status: 500,
      durationMs: 220,
      responseBytes: 1200,
      isError: true,
    };

    expect(isSessionReplayNetworkPayload(request)).toBe(true);
    expect(isSessionReplayNetworkPayload({ ...request, traceId: "abc" })).toBe(
      true,
    );
    expect(
      isSessionReplayNetworkPayload({
        ...request,
        initiator: "xhr",
        requestBytes: 3,
      }),
    ).toBe(true);
    expect(isSessionReplayNetworkPayload({ ...request, status: "500" })).toBe(
      false,
    );
    expect(isSessionReplayNetworkPayload({ method: "GET" })).toBe(false);
  });

  it("route: RouteRecorder's { from, to, kind }", () => {
    expect(
      isSessionReplayRoutePayload({ from: "/a", to: "/b", kind: "pushState" }),
    ).toBe(true);
    expect(
      isSessionReplayRoutePayload({ from: "/a", to: "/b", kind: "hashchange" }),
    ).toBe(true);
    expect(
      isSessionReplayRoutePayload({ from: "/a", to: "/b", kind: "nav" }),
    ).toBe(false);
  });

  it("error: ErrorRecorder's masked RecordedError plus optional occurredAtUnixMs", () => {
    expect(
      isSessionReplayErrorPayload({ kind: "error", message: "boom" }),
    ).toBe(true);
    expect(
      isSessionReplayErrorPayload({
        kind: "unhandledrejection",
        message: "boom",
        source: "https://acme.com/app.js",
        lineNumber: 1,
        columnNumber: 2,
        stack: "Error: boom",
        occurredAtUnixMs: 1700000000000,
      }),
    ).toBe(true);
    expect(isSessionReplayErrorPayload({ kind: "panic", message: "x" })).toBe(
      false,
    );
  });

  it("frustration: FrustrationDetector's signal shapes", () => {
    expect(
      isSessionReplayFrustrationPayload({
        kind: "rage-click",
        atUnixMs: 1,
        x: 10,
        y: 20,
        clickCount: 4,
      }),
    ).toBe(true);
    expect(
      isSessionReplayFrustrationPayload({
        kind: "refresh-rage",
        atUnixMs: 1,
        reloadCount: 3,
      }),
    ).toBe(true);
    expect(isSessionReplayFrustrationPayload({ kind: "rage-click" })).toBe(
      false,
    );
  });

  it("performance: the budget variant PerformanceRecorder emits, and the web-vital variant", () => {
    const budget: Record<string, unknown> = {
      kind: "lcp",
      durationMs: 4800,
      budgetMs: 4000,
    };
    const vital: Record<string, unknown> = {
      kind: "web-vital",
      metric: "INP",
      value: 320,
      rating: "poor",
    };

    expect(isSessionReplayPerformanceBudgetPayload(budget)).toBe(true);
    expect(isSessionReplayWebVitalPayload(budget)).toBe(false);
    expect(isSessionReplayWebVitalPayload(vital)).toBe(true);
    expect(isSessionReplayPerformanceBudgetPayload(vital)).toBe(false);
    expect(isSessionReplayPerformancePayload(budget)).toBe(true);
    expect(isSessionReplayPerformancePayload(vital)).toBe(true);
    expect(isSessionReplayPerformancePayload({ ...vital, metric: "FID" })).toBe(
      false,
    );
    expect(isSessionReplayPerformancePayload({ ...vital, rating: "meh" })).toBe(
      false,
    );
  });

  it("bfcache-restore and session-rotated: Recorder's payloads", () => {
    expect(isSessionReplayBfcacheRestorePayload({ restoredAtUnixMs: 1 })).toBe(
      true,
    );
    expect(isSessionReplayBfcacheRestorePayload({})).toBe(false);

    expect(
      isSessionReplaySessionRotatedPayload({
        previousSessionId: "old",
        rotationReason: "idle",
        rotatedAtUnixMs: 1,
      }),
    ).toBe(true);
    expect(
      isSessionReplaySessionRotatedPayload({
        previousSessionId: "old",
        rotationReason: "because",
        rotatedAtUnixMs: 1,
      }),
    ).toBe(false);
  });
});

describe("payload guards for the engagement events", () => {
  it("click: selector, x, y and atUnixMs required; text optional and string", () => {
    expect(
      isSessionReplayClickPayload({
        selector: "button#buy.primary",
        text: "Place order",
        x: 1,
        y: 2,
        atUnixMs: 3,
      }),
    ).toBe(true);
    expect(
      isSessionReplayClickPayload({ selector: "div", x: 1, y: 2, atUnixMs: 3 }),
    ).toBe(true);
    expect(
      isSessionReplayClickPayload({
        selector: "div",
        x: 1,
        y: 2,
        atUnixMs: 3,
        text: 9,
      }),
    ).toBe(false);
    expect(isSessionReplayClickPayload({ selector: "div", x: 1, y: 2 })).toBe(
      false,
    );
  });

  it("click-dropped / custom-dropped: a finite count", () => {
    expect(isSessionReplayClickDroppedPayload({ count: 12 })).toBe(true);
    expect(isSessionReplayClickDroppedPayload({ count: "12" })).toBe(false);
    expect(isSessionReplayCustomDroppedPayload({ count: 0 })).toBe(true);
    expect(isSessionReplayCustomDroppedPayload({})).toBe(false);
  });

  it("visibility: hidden|visible with a time", () => {
    expect(
      isSessionReplayVisibilityPayload({ state: "hidden", atUnixMs: 1 }),
    ).toBe(true);
    expect(
      isSessionReplayVisibilityPayload({ state: "prerender", atUnixMs: 1 }),
    ).toBe(false);
  });

  it("custom: a non-empty name and, when present, a string map of properties", () => {
    expect(isSessionReplayCustomPayload({ name: "checkout" })).toBe(true);
    expect(
      isSessionReplayCustomPayload({
        name: "checkout",
        properties: { step: "2" },
      }),
    ).toBe(true);
    expect(isSessionReplayCustomPayload({ name: "" })).toBe(false);
    expect(
      isSessionReplayCustomPayload({
        name: "checkout",
        properties: { step: 2 },
      }),
    ).toBe(false);
  });

  it("identify: hasTraits boolean, and nothing else is required (never the ref)", () => {
    expect(isSessionReplayIdentifyPayload({ hasTraits: true })).toBe(true);
    expect(isSessionReplayIdentifyPayload({ hasTraits: "yes" })).toBe(false);
  });

  it("tags: a string map", () => {
    expect(isSessionReplayTagsPayload({ tags: { build: "1" } })).toBe(true);
    expect(isSessionReplayTagsPayload({ tags: {} })).toBe(true);
    expect(isSessionReplayTagsPayload({ tags: ["a"] })).toBe(false);
    expect(isSessionReplayTagsPayload({})).toBe(false);
  });

  it("every guard rejects non-objects without throwing", () => {
    const guards: Array<(value: unknown) => boolean> = [
      isSessionReplayConsolePayload,
      isSessionReplayNetworkPayload,
      isSessionReplayRoutePayload,
      isSessionReplayErrorPayload,
      isSessionReplayFrustrationPayload,
      isSessionReplayPerformancePayload,
      isSessionReplayBfcacheRestorePayload,
      isSessionReplaySessionRotatedPayload,
      isSessionReplayClickPayload,
      isSessionReplayClickDroppedPayload,
      isSessionReplayVisibilityPayload,
      isSessionReplayCustomPayload,
      isSessionReplayCustomDroppedPayload,
      isSessionReplayIdentifyPayload,
      isSessionReplayTagsPayload,
    ];

    for (const guard of guards) {
      for (const value of [null, undefined, 1, "x", [], (): void => {}]) {
        expect(guard(value)).toBe(false);
      }
    }
  });
});
