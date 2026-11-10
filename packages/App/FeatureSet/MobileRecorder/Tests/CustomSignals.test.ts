import { gunzipSync, strFromU8 } from "fflate";
import { isSessionReplayCustomSignalPayload } from "../../../../Common/Types/Rum/SessionReplayCustomEvents";
import {
  CUSTOM_SIGNAL_CUSTOM_EVENT_TAG,
  RrwebEvent,
  RrwebEventType,
  SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS,
  SESSION_REPLAY_IDLE_PAUSE_MS,
  SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK,
  SessionReplayCustomSignalConfig,
  SessionReplayCustomSignalPayload,
} from "../src/Contract";
import { ReplayFetch } from "../src/Config";
import {
  CustomSignalMatcher,
  MobileCustomSignalHit,
  readCustomSignals,
  routeMatchPath,
} from "../src/CustomSignals";
import MobileReplayRecorder, {
  MobileReplayDiagnosticEvent,
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
 * The application's own frustration signals in the React Native recorder
 * (issue #6443): a route, a track() event, an error's text. The settings
 * come with the replay config; a hit is a oneuptime.signal marker carrying
 * the signal's name only, counted on the envelope, and - when it counts as
 * frustration - the start of an "On error or frustration" upload.
 */

interface DecodedPost {
  envelope: Record<string, unknown>;
  events: Array<RrwebEvent>;
}

interface Harness {
  recorder: MobileReplayRecorder;
  fetch: jest.MockedFunction<ReplayFetch>;
  posted: Array<DecodedPost>;
  advance(milliseconds: number): void;
  nowUnixMs(): number;
}

type ReplayFetchInit = NonNullable<Parameters<ReplayFetch>[1]>;

function decodePost(body: unknown): DecodedPost {
  const bytes: Uint8Array = body as Uint8Array;
  const newline: number = bytes.indexOf(10);
  return {
    envelope: JSON.parse(strFromU8(bytes.slice(0, newline))),
    events: JSON.parse(strFromU8(gunzipSync(bytes.slice(newline + 1)))),
  };
}

function harness(configOverrides: Record<string, unknown> = {}): Harness {
  const posted: Array<DecodedPost> = [];
  const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
    async (url: string, init: ReplayFetchInit = {}) => {
      if (url.endsWith("/config")) {
        return response(200, enabledConfig(configOverrides));
      }
      posted.push(decodePost(init.body));
      return response(202, { directive: "continue", configEpoch: 7 });
    },
  );
  let now: number = 100_000;
  const recorder: MobileReplayRecorder = new MobileReplayRecorder({
    storage: new MemoryStorage(),
    nativeViewTree: new FakeNativeViewTree(),
    appState: new FakeAppState(),
    keyboard: new FakeKeyboard(),
    now: (): number => {
      return now;
    },
  });
  recorder.setRootTag(101);
  return {
    recorder,
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

function signalsConfig(
  customSignals: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { frustrationSignals: { customSignals }, ...overrides };
}

/* Unsampled, uploading only on an error or frustration. */
const ON_FRUSTRATION_ONLY: Record<string, unknown> = {
  captureTrigger: "OnErrorOrFrustration",
  samplePercentage: 0,
};

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

function diagnosticCodes(recorder: MobileReplayRecorder): Array<string> {
  return recorder
    .getDiagnostics()
    .events.map((event: MobileReplayDiagnosticEvent): string => {
      return event.code;
    });
}

describe("reading the application's own signals", () => {
  test("keeps the page, event and error signals, read as the server reads them", () => {
    expect(readCustomSignals(undefined)).toEqual([]);
    expect(readCustomSignals({ customSignals: "nope" })).toEqual([]);

    const signals: Array<SessionReplayCustomSignalConfig> = readCustomSignals({
      customSignals: [
        { name: "Checkout error", trigger: "page", match: "/checkout/error" },
        { name: "checkout ERROR", trigger: "event", match: "duplicate_name" },
        { name: "", trigger: "event", match: "nameless" },
        { name: "x".repeat(41), trigger: "event", match: "too_long_a_name" },
        { name: "No anchor", trigger: "page", match: "checkout" },
        { name: "Long event", trigger: "event", match: "e".repeat(65) },
        { name: "Long text", trigger: "error", match: "t".repeat(201) },
        { name: "Nothing", trigger: "error", match: "   " },
        { name: "Shake", trigger: "shake", match: "x" },
        { name: "Off", trigger: "event", match: "off", isEnabled: false },
        { name: "Star page", trigger: "page", match: "*/failed" },
        {
          name: "Marker",
          trigger: "event",
          match: "help_opened",
          isFrustration: false,
        },
        { name: "Click", trigger: "click", match: "button.pay" },
        "not a signal",
        null,
      ],
    });

    expect(signals).toEqual([
      {
        name: "Checkout error",
        trigger: "page",
        match: "/checkout/error",
        isFrustration: true,
      },
      {
        name: "Star page",
        trigger: "page",
        match: "*/failed",
        isFrustration: true,
      },
      {
        name: "Marker",
        trigger: "event",
        match: "help_opened",
        isFrustration: false,
      },
    ]);
  });

  test("counts twenty signals before the click ones it cannot detect are set aside", () => {
    const customSignals: Array<Record<string, unknown>> = [];
    for (let index: number = 0; index < 19; index++) {
      customSignals.push({
        name: `Click ${index}`,
        trigger: "click",
        match: `#button-${index}`,
      });
    }
    customSignals.push({ name: "Twentieth", trigger: "event", match: "a" });
    customSignals.push({ name: "Twenty-first", trigger: "event", match: "b" });

    expect(
      readCustomSignals({ customSignals }).map(
        (signal: SessionReplayCustomSignalConfig): string => {
          return signal.name;
        },
      ),
    ).toEqual(["Twentieth"]);
  });

  test("matches a route by its path as the app wrote it", () => {
    expect(routeMatchPath("/checkout?token=1#payment")).toBe("/checkout");
    expect(routeMatchPath("Checkout")).toBe("/Checkout");
    expect(routeMatchPath("https://shop.example.com/orders/7?x=1")).toBe(
      "/orders/7",
    );
    expect(routeMatchPath("myapp://open")).toBe("/");
    expect(routeMatchPath("")).toBe("/");
    expect(routeMatchPath(42)).toBe("/");
  });
});

describe("CustomSignalMatcher", () => {
  const signals: Array<SessionReplayCustomSignalConfig> = [
    {
      name: "Order failed",
      trigger: "page",
      match: "/orders/*/failed",
      isFrustration: true,
    },
    {
      name: "Help opened",
      trigger: "event",
      match: "Help_Opened",
      isFrustration: false,
    },
    {
      name: "Declined",
      trigger: "error",
      match: "card declined",
      isFrustration: true,
    },
  ];

  test("each trigger matches only its own kind of moment", () => {
    const matcher: CustomSignalMatcher = new CustomSignalMatcher();

    expect(matcher.matchPage(signals, "/orders/123/failed", 1_000)).toEqual<
      Array<MobileCustomSignalHit>
    >([
      {
        name: "Order failed",
        trigger: "page",
        isFrustration: true,
        atUnixMs: 1_000,
      },
    ]);
    expect(matcher.matchPage(signals, "/orders/123", 1_000)).toEqual([]);
    /* An event named like a page is not a page. */
    expect(matcher.matchEvent(signals, "/orders/9/failed", 1_000)).toEqual([]);

    expect(matcher.matchEvent(signals, " help_opened ", 1_000)).toEqual([
      {
        name: "Help opened",
        trigger: "event",
        isFrustration: false,
        atUnixMs: 1_000,
      },
    ]);
    expect(
      matcher.matchErrorText(signals, "Payment: Card Declined (51)", 1_000),
    ).toEqual([
      {
        name: "Declined",
        trigger: "error",
        isFrustration: true,
        atUnixMs: 1_000,
      },
    ]);
    expect(matcher.matchErrorText(signals, "", 1_000)).toEqual([]);
  });

  test("fires one name at most once a second, and reset clears that", () => {
    const matcher: CustomSignalMatcher = new CustomSignalMatcher();

    expect(
      matcher.matchErrorText(signals, "card declined", 1_000),
    ).toHaveLength(1);
    expect(
      matcher.matchErrorText(
        signals,
        "card declined",
        1_000 + SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS - 1,
      ),
    ).toHaveLength(0);
    expect(
      matcher.matchErrorText(
        signals,
        "card declined",
        1_000 + SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS,
      ),
    ).toHaveLength(1);

    /* Another signal is not held back by this one. */
    expect(matcher.matchEvent(signals, "help_opened", 2_000)).toHaveLength(1);

    matcher.reset();
    expect(
      matcher.matchErrorText(signals, "card declined", 2_001),
    ).toHaveLength(1);
  });
});

describe("MobileReplayRecorder with signals of the application's own", () => {
  test("a frustration page signal marks the route and uploads the session", async () => {
    const test: Harness = harness(
      signalsConfig(
        [
          {
            name: "Order failed",
            trigger: "page",
            match: "/orders/*/failed",
            isFrustration: true,
          },
        ],
        ON_FRUSTRATION_ONLY,
      ),
    );
    expect(await test.recorder.start(startOptions({ fetch: test.fetch }))).toBe(
      true,
    );
    expect(test.posted).toHaveLength(0);

    await test.recorder.setRoute("/orders/5551234567/failed?token=secret");
    await settle();

    expect(test.recorder.getDiagnostics().triggered).toBe(true);
    expect(test.posted.length).toBeGreaterThan(0);
    expect(test.posted[0]?.envelope["triggerReason"]).toBe("frustration");

    const markers: Array<SessionReplayCustomSignalPayload> = signalMarkers(
      test.posted,
    );
    expect(markers).toEqual([
      {
        name: "Order failed",
        trigger: "page",
        isFrustration: true,
        atUnixMs: test.nowUnixMs(),
      },
    ]);
    /* What the player reads the marker through accepts it. */
    expect(isSessionReplayCustomSignalPayload(markers[0])).toBe(true);
    expect(countsOf(test.posted)).toEqual([
      { name: "Order failed", count: 1, frustrationCount: 1 },
    ]);
    /* The route is recorded redacted, as always; the match never leaves. */
    const wire: string = JSON.stringify(test.posted);
    expect(wire).not.toContain("5551234567");
    expect(wire).not.toContain("token=secret");
    await test.recorder.stop();
  });

  test("a marker-only event signal is recorded and counted but uploads nothing on its own", async () => {
    const markerOnly: Array<Record<string, unknown>> = [
      {
        name: "Help opened",
        trigger: "event",
        match: "help_opened",
        isFrustration: false,
      },
    ];

    const unsampled: Harness = harness(
      signalsConfig(markerOnly, ON_FRUSTRATION_ONLY),
    );
    await unsampled.recorder.start(startOptions({ fetch: unsampled.fetch }));
    unsampled.recorder.track("HELP_OPENED", { article: "refunds" });
    await settle();
    expect(unsampled.recorder.getDiagnostics().triggered).toBe(false);
    expect(unsampled.posted).toHaveLength(0);
    await unsampled.recorder.stop();
    expect(unsampled.posted).toHaveLength(0);

    const sampled: Harness = harness(signalsConfig(markerOnly));
    await sampled.recorder.start(startOptions({ fetch: sampled.fetch }));
    sampled.recorder.track("help_opened");
    await settle();
    await sampled.recorder.stop();

    expect(signalMarkers(sampled.posted)).toEqual([
      expect.objectContaining({
        name: "Help opened",
        trigger: "event",
        isFrustration: false,
      }),
    ]);
    expect(countsOf(sampled.posted)).toEqual([
      { name: "Help opened", count: 1, frustrationCount: 0 },
    ]);
  });

  test("a frustration event signal starts the upload", async () => {
    const test: Harness = harness(
      signalsConfig(
        [
          {
            name: "Payment retried",
            trigger: "event",
            match: "payment_retry",
            isFrustration: true,
          },
        ],
        ON_FRUSTRATION_ONLY,
      ),
    );
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    test.recorder.track("payment_retry");
    await settle();
    await settle();

    expect(test.recorder.getDiagnostics().triggered).toBe(true);
    expect(test.posted[0]?.envelope["triggerReason"]).toBe("frustration");
    await test.recorder.stop();
    expect(countsOf(test.posted)).toEqual([
      { name: "Payment retried", count: 1, frustrationCount: 1 },
    ]);
  });

  test("an error signal matches the thrown text but sends none of it", async () => {
    const test: Harness = harness(
      signalsConfig(
        [
          {
            name: "Card declined",
            trigger: "error",
            match: "card was declined",
            isFrustration: true,
          },
        ],
        ON_FRUSTRATION_ONLY,
      ),
    );
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    await test.recorder.captureError(
      new Error("The card was declined for alice@example.com"),
    );
    await settle();
    await test.recorder.stop();

    /* An error is the trigger here; the signal rides along with it. */
    expect(test.posted[0]?.envelope["triggerReason"]).toBe("error");
    expect(signalMarkers(test.posted)).toEqual([
      expect.objectContaining({ name: "Card declined", trigger: "error" }),
    ]);
    const wire: string = JSON.stringify(test.posted);
    expect(wire).not.toContain("alice@example.com");
    expect(wire).not.toContain("card was declined");

    /* A string thrown is text too; an object without a message is not. */
    const strings: Harness = harness(
      signalsConfig([
        { name: "Timeout", trigger: "error", match: "timed out" },
      ]),
    );
    await strings.recorder.start(startOptions({ fetch: strings.fetch }));
    await strings.recorder.captureError("Request timed out");
    strings.advance(SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS);
    await strings.recorder.captureError({ code: 504 });
    await strings.recorder.stop();
    expect(signalMarkers(strings.posted)).toHaveLength(1);
  });

  test("records nothing extra without signals, or for a click signal it cannot see", async () => {
    const plain: Harness = harness();
    await plain.recorder.start(startOptions({ fetch: plain.fetch }));
    plain.recorder.track("help_opened");
    await plain.recorder.setRoute("/orders/1/failed");
    await plain.recorder.captureError(new Error("card was declined"));
    await plain.recorder.stop();
    expect(signalMarkers(plain.posted)).toEqual([]);
    expect(countsOf(plain.posted)).toEqual([]);

    const clicks: Harness = harness(
      signalsConfig([
        { name: "Pay button", trigger: "click", match: "button.pay" },
      ]),
    );
    await clicks.recorder.start(startOptions({ fetch: clicks.fetch }));
    clicks.recorder.recordTouch({
      phase: "start",
      x: 10,
      y: 10,
      timestamp: clicks.nowUnixMs(),
      targetTag: 2,
    });
    await settle();
    await clicks.recorder.stop();
    expect(signalMarkers(clicks.posted)).toEqual([]);
  });

  test("holds a signal that repeats within a second to one marker", async () => {
    const test: Harness = harness(
      signalsConfig([{ name: "Retry", trigger: "event", match: "retry" }]),
    );
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    test.recorder.track("retry");
    test.advance(SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS - 1);
    test.recorder.track("retry");
    test.advance(1);
    test.recorder.track("retry");
    await test.recorder.stop();

    expect(signalMarkers(test.posted)).toHaveLength(2);
    expect(countsOf(test.posted)).toEqual([
      { name: "Retry", count: 2, frustrationCount: 2 },
    ]);
  });

  test("a chunk holds at most fifty markers", async () => {
    const test: Harness = harness(
      signalsConfig([{ name: "Retry", trigger: "event", match: "retry" }]),
    );
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    for (
      let index: number = 0;
      index < SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK + 10;
      index++
    ) {
      test.recorder.track("retry");
      test.advance(SESSION_REPLAY_CUSTOM_SIGNAL_COOLDOWN_MS);
    }
    await test.recorder.stop();

    expect(signalMarkers(test.posted)).toHaveLength(
      SESSION_REPLAY_MAX_CUSTOM_SIGNAL_EVENTS_PER_CHUNK,
    );
    expect(diagnosticCodes(test.recorder)).toContain(
      "custom-signal-cap-reached",
    );
  });

  describe("while nobody is using the app", () => {
    beforeEach((): void => {
      jest.useFakeTimers();
    });

    afterEach((): void => {
      jest.useRealTimers();
    });

    test("a frustration signal while paused for idle records and uploads nothing", async () => {
      const test: Harness = harness(
        signalsConfig(
          [
            {
              name: "Payment retried",
              trigger: "event",
              match: "payment_retry",
              isFrustration: true,
            },
          ],
          ON_FRUSTRATION_ONLY,
        ),
      );
      await test.recorder.start(startOptions({ fetch: test.fetch }));

      let elapsed: number = 0;
      while (elapsed < SESSION_REPLAY_IDLE_PAUSE_MS) {
        test.advance(5_000);
        await jest.advanceTimersByTimeAsync(5_000);
        elapsed += 5_000;
      }
      expect(test.recorder.getDiagnostics().status).toBe("paused");

      test.recorder.track("payment_retry");
      await jest.advanceTimersByTimeAsync(0);

      expect(test.recorder.getDiagnostics().triggered).toBe(false);
      expect(test.posted).toHaveLength(0);
      await test.recorder.stop();
      expect(signalMarkers(test.posted)).toEqual([]);
    });
  });
});
