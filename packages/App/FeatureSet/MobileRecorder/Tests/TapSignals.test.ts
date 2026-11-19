import { gunzipSync, strFromU8 } from "fflate";
import { isSessionReplayCustomSignalPayload } from "../../../../Common/Types/Rum/SessionReplayCustomEvents";
import {
  CUSTOM_SIGNAL_CUSTOM_EVENT_TAG,
  RrwebEvent,
  RrwebEventType,
  RrwebIncrementalSource,
  SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS,
  SessionReplayCustomSignalConfig,
  SessionReplayCustomSignalPayload,
} from "../src/Contract";
import { ReplayFetch } from "../src/Config";
import {
  CustomSignalMatcher,
  isTapPatternUsable,
  MAX_TAP_TARGET_TEST_IDS,
  matchesTapTarget,
  MobileCustomSignalHit,
  readCustomSignals,
  readTapTargetTestIds,
} from "../src/CustomSignals";
import MobileReplayRecorder, {
  TAP_SLOP_POINTS,
} from "../src/MobileReplayRecorder";
import {
  enabledConfig,
  FakeAppState,
  FakeKeyboard,
  FakeNativeViewTree,
  MemoryStorage,
  response,
  settle,
  startOptions,
} from "./TestUtils";

/*
 * Tap signals of the application's own in the React Native recorder (issue
 * #6517): a tap on a view whose testID a signal names - exactly, or by its
 * start and a star - or on anything inside that view. The testIDs come
 * from the native module, are matched on the device and never leave it: a
 * hit is a oneuptime.signal marker with the signal's name, where the tap
 * was when the touch is recorded, counted on the envelope, and - when it
 * counts as frustration - the start of an "On error or frustration" upload.
 */

interface DecodedPost {
  envelope: Record<string, unknown>;
  events: Array<RrwebEvent>;
}

interface Harness {
  recorder: MobileReplayRecorder;
  native: FakeNativeViewTree;
  fetch: jest.MockedFunction<ReplayFetch>;
  posted: Array<DecodedPost>;
  advance(milliseconds: number): void;
  nowUnixMs(): number;
}

type ReplayFetchInit = NonNullable<Parameters<ReplayFetch>[1]>;

/* A pay button with a label inside it, on the checkout screen. */
const PAY_LABEL: number = 21;
const OTHER_VIEW: number = 22;
const PRODUCT_CARD: number = 23;
const MASKED_CARD: number = 24;

function decodePost(body: unknown): DecodedPost {
  const bytes: Uint8Array = body as Uint8Array;
  const newline: number = bytes.indexOf(10);
  return {
    envelope: JSON.parse(strFromU8(bytes.slice(0, newline))),
    events: JSON.parse(strFromU8(gunzipSync(bytes.slice(newline + 1)))),
  };
}

function harness(
  customSignals: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
): Harness {
  const posted: Array<DecodedPost> = [];
  const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
    async (url: string, init: ReplayFetchInit = {}) => {
      if (url.endsWith("/config")) {
        return response(
          200,
          enabledConfig({
            frustrationSignals: { customSignals },
            ...overrides,
          }),
        );
      }
      posted.push(decodePost(init.body));
      return response(202, { directive: "continue", configEpoch: 7 });
    },
  );
  let now: number = 100_000;
  const native: FakeNativeViewTree = new FakeNativeViewTree();
  native.testIds.set(PAY_LABEL, [
    "pay-button-label",
    "pay-button",
    "checkout-screen",
  ]);
  native.testIds.set(OTHER_VIEW, ["help-link", "checkout-screen"]);
  native.testIds.set(PRODUCT_CARD, ["Product-Card-42", "product-list"]);
  native.testIds.set(MASKED_CARD, ["card-number-field"]);
  native.privateTargets.add(MASKED_CARD);
  const recorder: MobileReplayRecorder = new MobileReplayRecorder({
    storage: new MemoryStorage(),
    nativeViewTree: native,
    appState: new FakeAppState(),
    keyboard: new FakeKeyboard(),
    now: (): number => {
      return now;
    },
  });
  recorder.setRootTag(101);
  return {
    recorder,
    native,
    fetch,
    posted,
    advance(milliseconds: number): void {
      now += milliseconds;
    },
    nowUnixMs(): number {
      return now;
    },
  };
}

/* A finger down on a view and up again, sliding `slide` points on the way. */
async function tap(
  test: Harness,
  targetTag: number,
  options: { x?: number; y?: number; slide?: number; pointerId?: number } = {},
): Promise<void> {
  const x: number = options.x ?? 40;
  const y: number = options.y ?? 300;
  const slide: number = options.slide ?? 2;
  const pointerId: number = options.pointerId ?? 1;
  test.recorder.recordTouch({
    phase: "start",
    x,
    y,
    timestamp: test.nowUnixMs(),
    targetTag,
    pointerId,
  });
  await settle();
  test.advance(80);
  test.recorder.recordTouch({
    phase: "move",
    x: x + slide,
    y,
    timestamp: test.nowUnixMs(),
    targetTag,
    pointerId,
  });
  await settle();
  test.advance(40);
  test.recorder.recordTouch({
    phase: "end",
    x: x + slide,
    y,
    timestamp: test.nowUnixMs(),
    targetTag,
    pointerId,
  });
  await settle();
  await settle();
}

function signalMarkers(
  posts: Array<DecodedPost>,
): Array<SessionReplayCustomSignalPayload> {
  return posts
    .flatMap((post: DecodedPost): Array<RrwebEvent> => {
      return post.events;
    })
    .filter((event: RrwebEvent): boolean => {
      return (
        event.type === RrwebEventType.Custom &&
        (event.data as { tag?: unknown }).tag === CUSTOM_SIGNAL_CUSTOM_EVENT_TAG
      );
    })
    .map((event: RrwebEvent): SessionReplayCustomSignalPayload => {
      return (event.data as { payload: SessionReplayCustomSignalPayload })
        .payload;
    });
}

function countsOf(posts: Array<DecodedPost>): Array<unknown> {
  return posts.flatMap((post: DecodedPost): Array<unknown> => {
    const signals: Record<string, unknown> = post.envelope["signals"] as Record<
      string,
      unknown
    >;
    return (signals["customSignals"] as Array<unknown> | undefined) ?? [];
  });
}

function touchEnds(posts: Array<DecodedPost>): number {
  return posts
    .flatMap((post: DecodedPost): Array<RrwebEvent> => {
      return post.events;
    })
    .filter((event: RrwebEvent): boolean => {
      const data: Record<string, unknown> = event.data as Record<
        string,
        unknown
      >;
      return (
        event.type === RrwebEventType.IncrementalSnapshot &&
        data["source"] === RrwebIncrementalSource.MouseInteraction
      );
    }).length;
}

const PAY_TAPPED: Record<string, unknown> = {
  name: "Pay tapped",
  trigger: "tap",
  match: "pay-button",
  isFrustration: false,
};

describe("reading tap signals", () => {
  test("keeps a tap signal, and leaves out one whose star is anywhere but its end", () => {
    const signals: Array<SessionReplayCustomSignalConfig> = readCustomSignals({
      customSignals: [
        PAY_TAPPED,
        { name: "Cards", trigger: "tap", match: "product-card-*" },
        { name: "Star alone", trigger: "tap", match: "*" },
        { name: "Star inside", trigger: "tap", match: "product-*-card" },
        { name: "Two stars", trigger: "tap", match: "product**" },
        { name: "Too long", trigger: "tap", match: "t".repeat(201) },
        { name: "Click", trigger: "click", match: "button.pay" },
      ],
    });

    expect(signals).toEqual([
      {
        name: "Pay tapped",
        trigger: "tap",
        match: "pay-button",
        isFrustration: false,
      },
      {
        name: "Cards",
        trigger: "tap",
        match: "product-card-*",
        isFrustration: true,
      },
    ]);
  });

  test("a tap pattern is some of a testID and at most a star at its end", () => {
    expect(isTapPatternUsable("pay-button")).toBe(true);
    expect(isTapPatternUsable("product-card-*")).toBe(true);
    expect(isTapPatternUsable("*")).toBe(false);
    expect(isTapPatternUsable("*-card")).toBe(false);
    expect(isTapPatternUsable("a*b")).toBe(false);
    expect(isTapPatternUsable("ab**")).toBe(false);
  });
});

describe("matching a tap", () => {
  test("matches a testID exactly, or by its start before a star, ignoring case", () => {
    expect(matchesTapTarget("pay-button", "pay-button")).toBe(true);
    expect(matchesTapTarget("Pay-Button", "pay-button")).toBe(true);
    expect(matchesTapTarget(" pay-button ", "pay-button")).toBe(true);
    expect(matchesTapTarget("pay-button", "pay-button-label")).toBe(false);
    expect(matchesTapTarget("pay", "pay-button")).toBe(false);
    expect(matchesTapTarget("product-card-*", "product-card-42")).toBe(true);
    expect(matchesTapTarget("product-card-*", "PRODUCT-CARD-")).toBe(true);
    expect(matchesTapTarget("product-card-*", "product-list")).toBe(false);
    expect(matchesTapTarget("*", "anything")).toBe(false);
    expect(matchesTapTarget("a*b", "a*b")).toBe(false);
    expect(matchesTapTarget("pay-button", "")).toBe(false);
    expect(matchesTapTarget("", "pay-button")).toBe(false);
  });

  test("reads the native module's testIDs as strings only, short enough, a bounded few", () => {
    expect(readTapTargetTestIds(null)).toEqual([]);
    expect(readTapTargetTestIds("pay-button")).toEqual([]);
    expect(
      readTapTargetTestIds(["pay-button", "", 7, null, "x".repeat(201), "ok"]),
    ).toEqual(["pay-button", "ok"]);

    const many: Array<string> = [];
    for (let index: number = 0; index < 100; index++) {
      many.push(`view-${index}`);
    }
    expect(readTapTargetTestIds(many)).toHaveLength(MAX_TAP_TARGET_TEST_IDS);
  });

  test("a tap inside a named view is a tap on it, and fires one name at most once a second", () => {
    const matcher: CustomSignalMatcher = new CustomSignalMatcher();
    const signals: Array<SessionReplayCustomSignalConfig> = readCustomSignals({
      customSignals: [
        PAY_TAPPED,
        { name: "Screen", trigger: "tap", match: "checkout-screen" },
        { name: "Paid page", trigger: "page", match: "/paid" },
      ],
    });
    const testIds: Array<string> = [
      "pay-button-label",
      "pay-button",
      "checkout-screen",
    ];

    const hits: Array<MobileCustomSignalHit> = matcher.matchTap(
      signals,
      testIds,
      1_000,
    );
    expect(
      hits.map((hit: MobileCustomSignalHit): string => {
        return `${hit.name}:${hit.trigger}`;
      }),
    ).toEqual(["Pay tapped:tap", "Screen:tap"]);
    expect(matcher.matchTap(signals, testIds, 1_500)).toEqual([]);
    expect(
      matcher.matchTap(
        signals,
        testIds,
        1_000 + SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS,
      ),
    ).toHaveLength(2);
    expect(matcher.matchTap(signals, [], 9_000)).toEqual([]);
    /* A tap is never a page, and a page never a tap. */
    expect(matcher.matchPage(signals, "/pay-button", 20_000)).toEqual([]);
  });
});

describe("MobileReplayRecorder with tap signals", () => {
  test("a tap on a matching testID fires once, a tap elsewhere does not, and nothing but the name is sent", async () => {
    const test: Harness = harness([PAY_TAPPED]);
    expect(await test.recorder.start(startOptions({ fetch: test.fetch }))).toBe(
      true,
    );

    await tap(test, PAY_LABEL, { x: 40, y: 300, slide: 2 });
    const tappedAt: number = test.nowUnixMs();
    test.advance(5_000);
    await tap(test, OTHER_VIEW);
    await test.recorder.stop();

    const markers: Array<SessionReplayCustomSignalPayload> = signalMarkers(
      test.posted,
    );
    expect(markers).toEqual([
      {
        name: "Pay tapped",
        trigger: "tap",
        isFrustration: false,
        atUnixMs: tappedAt,
        x: 42,
        y: 300,
      },
    ]);
    /* What the player reads the marker through accepts it. */
    expect(isSessionReplayCustomSignalPayload(markers[0])).toBe(true);
    expect(countsOf(test.posted)).toEqual([
      { name: "Pay tapped", count: 1, frustrationCount: 0 },
    ]);
    /* Both touches are recorded as always. */
    expect(touchEnds(test.posted)).toBe(4);
    /* The testIDs it was matched against never leave the device. */
    const wire: string = JSON.stringify(test.posted);
    expect(wire).not.toContain("pay-button");
    expect(wire).not.toContain("checkout-screen");
    expect(wire).not.toContain("help-link");
    /* A marker only: it uploads nothing on its own, and triggers nothing. */
    expect(test.recorder.getDiagnostics().triggered).toBe(false);
  });

  test("a touch that slides further than a tap is a scroll, not a tap", async () => {
    const test: Harness = harness([PAY_TAPPED]);
    await test.recorder.start(startOptions({ fetch: test.fetch }));

    await tap(test, PAY_LABEL, { slide: TAP_SLOP_POINTS + 1 });
    await tap(test, PAY_LABEL, { slide: TAP_SLOP_POINTS });
    await test.recorder.stop();

    expect(signalMarkers(test.posted)).toHaveLength(1);
  });

  test("a tap that counts as frustration starts an On error or frustration upload", async () => {
    const test: Harness = harness(
      [{ ...PAY_TAPPED, name: "Rage pay", isFrustration: true }],
      { captureTrigger: "OnErrorOrFrustration", samplePercentage: 0 },
    );
    expect(await test.recorder.start(startOptions({ fetch: test.fetch }))).toBe(
      true,
    );
    expect(test.posted).toHaveLength(0);

    await tap(test, PAY_LABEL);
    await settle();

    expect(test.recorder.getDiagnostics().triggered).toBe(true);
    expect(test.posted.length).toBeGreaterThan(0);
    expect(test.posted[0]?.envelope["triggerReason"]).toBe("frustration");
    expect(countsOf(test.posted)).toEqual([
      { name: "Rage pay", count: 1, frustrationCount: 1 },
    ]);
    await test.recorder.stop();
  });

  test("a start and a star name a whole family of views", async () => {
    const test: Harness = harness([
      { name: "Card opened", trigger: "tap", match: "product-card-*" },
    ]);
    await test.recorder.start(startOptions({ fetch: test.fetch }));

    await tap(test, PRODUCT_CARD);
    await tap(test, PAY_LABEL);
    await test.recorder.stop();

    expect(
      signalMarkers(test.posted).map(
        (marker: SessionReplayCustomSignalPayload): string => {
          return marker.name;
        },
      ),
    ).toEqual(["Card opened"]);
  });

  test("a tap on a view the replay never records still fires, without saying where", async () => {
    const test: Harness = harness([
      { name: "Card field", trigger: "tap", match: "card-number-field" },
    ]);
    await test.recorder.start(startOptions({ fetch: test.fetch }));

    await tap(test, MASKED_CARD);
    await test.recorder.stop();

    expect(signalMarkers(test.posted)).toEqual([
      {
        name: "Card field",
        trigger: "tap",
        isFrustration: true,
        atUnixMs: expect.any(Number) as unknown as number,
      },
    ]);
    /* The touch itself stays unrecorded. */
    expect(touchEnds(test.posted)).toBe(0);
  });

  test("fires one name at most once a second", async () => {
    const test: Harness = harness([PAY_TAPPED]);
    await test.recorder.start(startOptions({ fetch: test.fetch }));

    await tap(test, PAY_LABEL);
    await tap(test, PAY_LABEL);
    test.advance(SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS);
    await tap(test, PAY_LABEL);
    await test.recorder.stop();

    expect(signalMarkers(test.posted)).toHaveLength(2);
  });

  test("asks the native module nothing while the application has no tap signal", async () => {
    const test: Harness = harness([
      { name: "Paid", trigger: "page", match: "/paid" },
      { name: "Pay clicked", trigger: "click", match: "#pay" },
    ]);
    await test.recorder.start(startOptions({ fetch: test.fetch }));

    await tap(test, PAY_LABEL);
    await test.recorder.stop();

    expect(test.native.testIdLookups).toBe(0);
    expect(signalMarkers(test.posted)).toEqual([]);
    expect(touchEnds(test.posted)).toBe(2);
  });

  test("a native module built before tap signals fires none, and records the touch as always", async () => {
    const test: Harness = harness([PAY_TAPPED]);
    (test.native as unknown as Record<string, unknown>)["touchTargetTestIds"] =
      undefined;
    await test.recorder.start(startOptions({ fetch: test.fetch }));

    await tap(test, PAY_LABEL);
    await test.recorder.stop();

    expect(signalMarkers(test.posted)).toEqual([]);
    expect(touchEnds(test.posted)).toBe(2);
  });

  test("a native module that fails is no tap, and says so", async () => {
    const test: Harness = harness([PAY_TAPPED]);
    test.native.touchTargetTestIds = async (): Promise<Array<string>> => {
      throw new Error("stale tag");
    };
    await test.recorder.start(startOptions({ fetch: test.fetch }));

    await tap(test, PAY_LABEL);
    await test.recorder.stop();

    expect(signalMarkers(test.posted)).toEqual([]);
    expect(
      test.recorder
        .getDiagnostics()
        .events.map((event: { code: string }): string => {
          return event.code;
        }),
    ).toContain("tap-target-unreadable");
  });
});
