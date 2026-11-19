import { gunzipSync, strFromU8 } from "fflate";
import {
  ProductAnalyticsBatchParseResult,
  parseProductAnalyticsBatch,
} from "../../../../Common/Types/Rum/ProductAnalyticsEvents";
import {
  MobileReplayStartOptions,
  ReplayFetch,
  validateStartOptions,
  ValidatedStartOptions,
} from "../src/Config";
import {
  CUSTOM_EVENT_TAG,
  RrwebEvent,
  RrwebEventType,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
} from "../src/Contract";
import MobileReplayRecorder, {
  getReplayStorageNamespace,
  MobileReplayDiagnosticEvent,
} from "../src/MobileReplayRecorder";
import {
  productAnalyticsQueueKey,
  productAnalyticsSessionKey,
} from "../src/ProductAnalytics";
import {
  PRODUCT_ANALYTICS_EVENTS_PATH,
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  ProductAnalyticsWireBatch,
  ProductAnalyticsWireEvent,
} from "../src/ProductAnalyticsContract";
import {
  enabledConfig,
  FakeAppState,
  FakeNativeViewTree,
  MemoryStorage,
  response,
  startOptions,
} from "./TestUtils";

/*
 * Product analytics from the React Native recorder (issue #6629), behind
 * the real MobileReplayRecorder and its public API: which session, visitor,
 * consent and person the events carry, the screens setRoute() names, a
 * session the replay sample leaves out, and an application with them off.
 * Tests/ProductAnalytics.test.ts covers the channel's batching, answers and
 * lifecycle on its own.
 */

const START_UNIX_MS: number = 1_790_000_000_000;
const CAPTURE_INTERVAL_MS: number = 5_000;

type ReplayFetchInit = NonNullable<Parameters<ReplayFetch>[1]>;

interface AnalyticsPost {
  url: string;
  headers: Record<string, string>;
  batch: ProductAnalyticsWireBatch;
}

interface ChunkPost {
  envelope: Record<string, unknown>;
  events: Array<RrwebEvent>;
}

interface Harness {
  recorder: MobileReplayRecorder;
  fetch: jest.MockedFunction<ReplayFetch>;
  analytics: Array<AnalyticsPost>;
  chunks: Array<ChunkPost>;
  storage: MemoryStorage;
  native: FakeNativeViewTree;
  appState: FakeAppState;
  config: Record<string, unknown>;
}

function harness(
  configOverrides: Record<string, unknown> = {},
  storage: MemoryStorage = new MemoryStorage(),
): Harness {
  const analytics: Array<AnalyticsPost> = [];
  const chunks: Array<ChunkPost> = [];
  const config: Record<string, unknown> = enabledConfig({
    productAnalytics: { enabled: true, userPropertyKeys: [] },
    ...configOverrides,
  });
  const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
    async (url: string, init: ReplayFetchInit = {}) => {
      if (url.endsWith("/config")) {
        return response(200, config);
      }
      if (url.endsWith(PRODUCT_ANALYTICS_EVENTS_PATH)) {
        analytics.push({
          url,
          headers: init.headers ?? {},
          batch: JSON.parse(init.body as string) as ProductAnalyticsWireBatch,
        });
        return response(202, { reason: "accepted" });
      }
      const bytes: Uint8Array = init.body as Uint8Array;
      const newline: number = bytes.indexOf(10);
      chunks.push({
        envelope: JSON.parse(strFromU8(bytes.slice(0, newline))),
        events: JSON.parse(strFromU8(gunzipSync(bytes.slice(newline + 1)))),
      });
      return response(202, { directive: "continue", configEpoch: 7 });
    },
  );
  const native: FakeNativeViewTree = new FakeNativeViewTree();
  const appState: FakeAppState = new FakeAppState();
  /* No injected clock: Date.now() is the fake one, in step with the timers. */
  const recorder: MobileReplayRecorder = new MobileReplayRecorder({
    storage,
    nativeViewTree: native,
    appState,
  });
  recorder.setRootTag(101);
  return {
    recorder,
    fetch,
    analytics,
    chunks,
    storage,
    native,
    appState,
    config,
  };
}

function options(
  test: Harness,
  overrides: Partial<MobileReplayStartOptions> = {},
): MobileReplayStartOptions {
  return startOptions({
    fetch: test.fetch,
    captureIntervalMs: CAPTURE_INTERVAL_MS,
    ...overrides,
  });
}

/* Let the recorder's promise chains run without moving the clock. */
async function flush(): Promise<void> {
  for (let round: number = 0; round < 10; round += 1) {
    await jest.advanceTimersByTimeAsync(0);
  }
}

/* Move the clock, running every timer that falls due. */
async function elapse(milliseconds: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(milliseconds);
  await flush();
}

async function nextAnalyticsFlush(): Promise<void> {
  await elapse(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);
}

function analyticsEvents(test: Harness): Array<ProductAnalyticsWireEvent> {
  return test.analytics.flatMap(
    (post: AnalyticsPost): Array<ProductAnalyticsWireEvent> => {
      return post.batch.events;
    },
  );
}

function named(events: Array<ProductAnalyticsWireEvent>): Array<string> {
  return events.map((event: ProductAnalyticsWireEvent): string => {
    return `${event.kind}:${event.name}`;
  });
}

function diagnosticCodes(test: Harness): Array<string> {
  return test.recorder
    .getDiagnostics()
    .events.map((event: MobileReplayDiagnosticEvent): string => {
      return event.code;
    });
}

describe("MobileReplayRecorder product analytics", () => {
  beforeEach((): void => {
    jest.useFakeTimers({
      now: START_UNIX_MS,
      doNotFake: ["nextTick", "queueMicrotask"],
    });
  });

  afterEach((): void => {
    jest.useRealTimers();
  });

  test("sends the session's start, its screens, track() and metric() from a recorded session, under the recording's ids", async () => {
    const test: Harness = harness();
    expect(await test.recorder.start(options(test))).toBe(true);
    const sessionId: string = test.recorder.getSessionId() as string;

    await test.recorder.setRoute("/checkout?payment_token=discarded");
    test.recorder.track("Checkout started", { cartSize: 3 });
    test.recorder.metric("cart.value", 42.5, { currency: "EUR" });
    await nextAnalyticsFlush();

    expect(test.analytics).toHaveLength(1);

    const post: AnalyticsPost = test.analytics[0]!;

    expect(post.url).toBe(
      `https://oneuptime.example${PRODUCT_ANALYTICS_EVENTS_PATH}`,
    );
    /* The replay route's door: the key, the application, a native recorder and its app. */
    expect(post.headers).toEqual({
      "x-oneuptime-token": "token",
      "x-oneuptime-app-identifier": "rum-app",
      "x-oneuptime-replay-recorder-kind": "rn-view-tree",
      "x-oneuptime-mobile-app-identifier": "com.example.checkout",
      "Content-Type": "application/json",
    });
    expect(post.batch.sessionId).toBe(sessionId);
    expect(post.batch.visitorId).toMatch(/^[0-9a-f]{32}$/);
    expect(post.batch.consentState).toBe("NotRequired");
    /* Filed as its recorded sessions are: a phone, no browser, iOS, its version. */
    expect(post.batch.context).toEqual({
      deviceType: "mobile",
      browserName: "",
      osName: "ios",
      appVersion: "2.4.1",
    });
    expect(named(post.batch.events)).toEqual([
      "session:",
      "page:/checkout",
      "custom:Checkout started",
    ]);
    /* Masked as the recorder masks all text; names, keys and numbers as written. */
    expect(post.batch.events[2]?.properties).toEqual({ cartSize: "••••" });
    expect(post.batch.events[2]?.page).toBe("/checkout");
    expect(post.batch.metrics).toEqual([
      {
        name: "cart.value",
        value: 42.5,
        at: START_UNIX_MS,
        attributes: { currency: "••••" },
      },
    ]);
    expect(test.recorder.getDiagnostics().productAnalytics).toEqual({
      state: "on",
      pending: 0,
      dropped: 0,
    });

    /* The replay timeline still carries track() as it always did. */
    await test.recorder.stop();
    const marker: RrwebEvent | undefined = test.chunks
      .flatMap((chunk: ChunkPost): Array<RrwebEvent> => {
        return chunk.events;
      })
      .find((event: RrwebEvent): boolean => {
        return (
          event.type === RrwebEventType.Custom &&
          (event.data as { tag?: string }).tag === CUSTOM_EVENT_TAG
        );
      });
    expect((marker?.data as { payload?: unknown }).payload).toEqual({
      name: "Checkout started",
      properties: { cartSize: "••••" },
    });
  });

  test("builds batches the server's parser keeps whole", async () => {
    const test: Harness = harness({
      captureUserIdentity: true,
      productAnalytics: { enabled: true, userPropertyKeys: ["plan"] },
    });
    expect(await test.recorder.start(options(test))).toBe(true);

    test.recorder.identify("user-42", { plan: "pro", email: "x@example.com" });
    await flush();
    await test.recorder.setRoute("Checkout");
    test.recorder.track("Signed up", { plan: "pro" });
    test.recorder.metric("cart.value", 42.5);
    await nextAnalyticsFlush();

    /* The signed-in user's session, in as many batches as it took. */
    const sessionId: string = test.recorder.getSessionId() as string;
    const names: Array<string> = [];
    let metrics: number = 0;

    for (const post of test.analytics) {
      const parsed: ProductAnalyticsBatchParseResult =
        parseProductAnalyticsBatch(post.batch, {
          receivedAtUnixMs: Date.now(),
          allowedUserPropertyKeys: ["plan"],
        });

      expect(parsed.isValid).toBe(true);
      if (!parsed.isValid || parsed.batch.sessionId !== sessionId) {
        continue;
      }
      expect(parsed.batch.droppedEvents).toBe(0);
      expect(parsed.batch.droppedMetrics).toBe(0);
      expect(parsed.batch.userRef).toBe("user-42");
      expect(parsed.batch.userProperties).toEqual({ plan: "••••" });
      names.push(
        ...parsed.batch.events.map((event: { kind: string; name: string }) => {
          return `${event.kind}:${event.name}`;
        }),
      );
      metrics += parsed.batch.metrics.length;
    }

    /* A screen name is a page, as the server files a mobile screen. */
    expect(names).toEqual(["session:", "page:/Checkout", "custom:Signed up"]);
    expect(metrics).toBe(1);
  });

  test("files a track() right after a sign-in under the signed-in user's new session", async () => {
    const test: Harness = harness({ captureUserIdentity: true });
    expect(await test.recorder.start(options(test))).toBe(true);
    const anonymousSession: string = test.recorder.getSessionId() as string;

    test.recorder.track("Browsed");
    test.recorder.identify("user-7");
    test.recorder.track("Signed in");
    await flush();
    await nextAnalyticsFlush();
    await nextAnalyticsFlush();

    const signedInSession: string = test.recorder.getSessionId() as string;
    expect(signedInSession).not.toBe(anonymousSession);

    const postsOf: (sessionId: string) => Array<AnalyticsPost> = (
      sessionId: string,
    ): Array<AnalyticsPost> => {
      return test.analytics.filter((post: AnalyticsPost): boolean => {
        return post.batch.sessionId === sessionId;
      });
    };
    const before: Array<AnalyticsPost> = postsOf(anonymousSession);
    const after: Array<AnalyticsPost> = postsOf(signedInSession);

    expect(
      named(
        before.flatMap((post: AnalyticsPost) => {
          return post.batch.events;
        }),
      ),
    ).toEqual(["session:", "custom:Browsed"]);
    for (const post of before) {
      expect(post.batch.userRef).toBeUndefined();
    }
    expect(
      named(
        after.flatMap((post: AnalyticsPost) => {
          return post.batch.events;
        }),
      ),
    ).toEqual(["session:", "custom:Signed in"]);
    for (const post of after) {
      expect(post.batch.userRef).toBe("user-7");
    }
  });

  test("sends nothing of who is signed in while the application does not capture identity", async () => {
    const test: Harness = harness({
      captureUserIdentity: false,
      productAnalytics: { enabled: true, userPropertyKeys: ["plan"] },
    });
    expect(await test.recorder.start(options(test))).toBe(true);

    test.recorder.identify("user-7", { plan: "pro" });
    await flush();
    test.recorder.track("Signed in");
    await nextAnalyticsFlush();

    for (const post of test.analytics) {
      expect(Object.keys(post.batch)).not.toContain("userRef");
      expect(Object.keys(post.batch)).not.toContain("userProperties");
    }
  });

  test("says a tablet from a screen whose shorter side is 600 points or more", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Dimensions } = jest.requireMock("react-native") as {
      Dimensions: { get: jest.Mock };
    };
    Dimensions.get.mockReturnValue({ width: 1024, height: 768 });
    try {
      const test: Harness = harness();
      expect(await test.recorder.start(options(test))).toBe(true);
      await nextAnalyticsFlush();

      expect(test.analytics[0]?.batch.context.deviceType).toBe("tablet");
    } finally {
      Dimensions.get.mockReturnValue({ width: 390, height: 844 });
    }
  });

  test("leaves out an app version nobody gave", async () => {
    const test: Harness = harness();
    test.native.getAppMetadata = async () => {
      return {
        appName: "React Native",
        appVersion: "unknown",
        osName: "android",
        osVersion: "15",
      };
    };
    expect(await test.recorder.start(options(test))).toBe(true);
    await nextAnalyticsFlush();

    expect(test.analytics[0]?.batch.context).toEqual({
      deviceType: "mobile",
      browserName: "",
      osName: "android",
      appVersion: "",
    });
  });

  test("takes the app version from the start options before the native module's", async () => {
    const test: Harness = harness();
    expect(
      await test.recorder.start(options(test, { appVersion: " 5.0.0-rc.1 " })),
    ).toBe(true);
    await nextAnalyticsFlush();

    expect(test.analytics[0]?.batch.context.appVersion).toBe("5.0.0-rc.1");
  });

  describe("a session the replay sample leaves out", () => {
    test("records nothing, but still sends its events, and its events keep it alive", async () => {
      const test: Harness = harness({ samplePercentage: 0 });
      /* As before: the recorder says it is not recording. */
      expect(await test.recorder.start(options(test))).toBe(false);
      expect(test.recorder.getDiagnostics().status).toBe("disabled");
      expect(diagnosticCodes(test)).toContain("not-sampled");
      expect(test.recorder.getSessionId()).toBeNull();

      await test.recorder.setRoute("/Home");
      test.recorder.track("Opened");
      test.recorder.metric("home.items", 12);
      await nextAnalyticsFlush();

      expect(test.chunks).toHaveLength(0);
      expect(test.analytics).toHaveLength(1);
      const sessionId: string = test.analytics[0]!.batch.sessionId;
      expect(sessionId).toMatch(/^[0-9a-f]{32}$/);
      expect(named(test.analytics[0]!.batch.events)).toEqual([
        "session:",
        "page:/Home",
        "custom:Opened",
      ]);
      expect(test.analytics[0]!.batch.metrics).toHaveLength(1);

      /* Twenty-nine minutes later the same session: the event kept it alive. */
      await elapse(SESSION_REPLAY_IDLE_ROLLOVER_MS - 60_000);
      test.recorder.track("Still here");
      await nextAnalyticsFlush();
      await elapse(SESSION_REPLAY_IDLE_ROLLOVER_MS - 60_000);
      test.recorder.track("And here");
      await nextAnalyticsFlush();

      const sameSession: Array<string> = test.analytics.map(
        (post: AnalyticsPost): string => {
          return post.batch.sessionId;
        },
      );
      expect(new Set(sameSession)).toEqual(new Set([sessionId]));
    });

    test("starts the next session after the idle window, announced with the screen the app shows", async () => {
      const test: Harness = harness({ samplePercentage: 0 });
      expect(await test.recorder.start(options(test))).toBe(false);

      await test.recorder.setRoute("/Feed");
      await nextAnalyticsFlush();
      const firstSession: string = test.analytics[0]!.batch.sessionId;

      /* The timer alone is not activity: the app sat untouched. */
      await elapse(SESSION_REPLAY_IDLE_ROLLOVER_MS + 60_000);
      test.recorder.track("Back");
      await nextAnalyticsFlush();

      const last: AnalyticsPost = test.analytics[test.analytics.length - 1]!;
      expect(last.batch.sessionId).not.toBe(firstSession);
      expect(named(last.batch.events)).toEqual([
        "session:",
        "page:/Feed",
        "custom:Back",
      ]);
    });

    test("starts the next session for another user, as a recorded session does", async () => {
      const test: Harness = harness({
        samplePercentage: 0,
        captureUserIdentity: true,
      });
      expect(await test.recorder.start(options(test))).toBe(false);

      test.recorder.track("Anonymous");
      test.recorder.identify("user-9");
      test.recorder.track("Signed in");
      await flush();
      await nextAnalyticsFlush();
      await nextAnalyticsFlush();

      const sessions: Array<string> = test.analytics.map(
        (post: AnalyticsPost): string => {
          return post.batch.sessionId;
        },
      );
      expect(new Set(sessions).size).toBe(2);
      expect(test.analytics[test.analytics.length - 1]?.batch.userRef).toBe(
        "user-9",
      );
    });
  });

  describe("consent", () => {
    test("holds every event until grantConsent(), then sends them under the session the grant opened", async () => {
      const test: Harness = harness({ consentMode: "RequireExplicit" });
      expect(await test.recorder.start(options(test))).toBe(true);
      expect(test.recorder.getDiagnostics().status).toBe("consent-required");

      await test.recorder.setRoute("/Welcome");
      test.recorder.track("Read terms");
      await nextAnalyticsFlush();
      await nextAnalyticsFlush();

      expect(test.analytics).toHaveLength(0);
      expect(test.recorder.getDiagnostics().productAnalytics.pending).toBe(2);
      /* Nothing of the recorder's is written before consent. */
      expect(test.storage.values.size).toBe(0);

      await test.recorder.grantConsent();
      await flush();

      const sessionId: string = test.recorder.getSessionId() as string;
      expect(test.analytics).toHaveLength(1);
      expect(test.analytics[0]!.batch.sessionId).toBe(sessionId);
      expect(test.analytics[0]!.batch.consentState).toBe("Granted");
      expect(named(test.analytics[0]!.batch.events)).toEqual([
        "session:",
        "page:/Welcome",
        "custom:Read terms",
      ]);
      expect(test.analytics[0]!.batch.events[0]?.at).toBe(START_UNIX_MS);
    });

    test("drops what it held when consent is withdrawn, and forgets the session it announced", async () => {
      const test: Harness = harness();
      expect(await test.recorder.start(options(test))).toBe(true);
      await nextAnalyticsFlush();
      const validated: ValidatedStartOptions = validateStartOptions(
        options(test),
      ) as ValidatedStartOptions;
      const key: string = productAnalyticsSessionKey(
        getReplayStorageNamespace(validated),
      );
      expect(test.storage.values.get(key)).toMatch(/^[0-9a-f]{32}$/);

      test.recorder.track("Held");
      await test.recorder.revokeConsent();
      await flush();

      expect(test.storage.values.has(key)).toBe(false);
      expect(test.recorder.getDiagnostics().productAnalytics.pending).toBe(0);

      test.recorder.track("While withdrawn");
      await nextAnalyticsFlush();

      expect(
        analyticsEvents(test).map((event: ProductAnalyticsWireEvent) => {
          return event.name;
        }),
      ).toEqual([""]);
    });
  });

  test("sends what it holds when the app is stopped", async () => {
    const test: Harness = harness();
    expect(await test.recorder.start(options(test))).toBe(true);
    await nextAnalyticsFlush();

    test.recorder.track("Last thing");
    await test.recorder.stop();
    await flush();

    expect(named(analyticsEvents(test))).toEqual([
      "session:",
      "custom:Last thing",
    ]);
    expect(test.recorder.getDiagnostics().productAnalytics.state).toBe("off");

    test.recorder.track("After stop");
    await nextAnalyticsFlush();
    expect(analyticsEvents(test)).toHaveLength(2);
  });

  test("sends what it holds as the app goes to the background", async () => {
    const test: Harness = harness();
    expect(await test.recorder.start(options(test))).toBe(true);

    test.recorder.track("Before background");
    test.appState.emit("background");
    await flush();

    expect(named(analyticsEvents(test))).toEqual([
      "session:",
      "custom:Before background",
    ]);
    await test.recorder.stop();
  });

  test("stops when the policy turns replay off, and starts again when a policy turns the events back on", async () => {
    const test: Harness = harness();
    expect(await test.recorder.start(options(test))).toBe(true);
    expect(test.recorder.getDiagnostics().productAnalytics.state).toBe("on");

    test.config["productAnalytics"] = { enabled: false, userPropertyKeys: [] };
    test.appState.emit("background");
    await flush();
    test.appState.emit("active");
    await flush();
    expect(test.recorder.getDiagnostics().productAnalytics.state).toBe("off");

    test.recorder.track("While off");
    test.config["productAnalytics"] = { enabled: true, userPropertyKeys: [] };
    test.appState.emit("background");
    await flush();
    test.appState.emit("active");
    await flush();
    expect(test.recorder.getDiagnostics().productAnalytics.state).toBe("on");

    test.recorder.track("On again");
    await nextAnalyticsFlush();
    expect(
      analyticsEvents(test)
        .map((event: ProductAnalyticsWireEvent): string => {
          return event.name;
        })
        .filter((name: string): boolean => {
          return name !== "";
        }),
    ).toEqual(["On again"]);

    test.config["enabled"] = false;
    test.appState.emit("background");
    await flush();
    test.appState.emit("active");
    await flush();
    expect(test.recorder.getDiagnostics().productAnalytics.state).toBe("off");
  });

  describe("an application with product analytics off, or a server from before them", () => {
    test.each([
      ["absent", undefined],
      ["off", { enabled: false, userPropertyKeys: ["plan"] }],
      ["not an object", "yes"],
    ])(
      "sends no batch when the field is %s, and metric() says why",
      async (_label: string, productAnalytics: unknown) => {
        const test: Harness = harness({ productAnalytics });
        expect(await test.recorder.start(options(test))).toBe(true);

        await test.recorder.setRoute("/Home");
        test.recorder.track("Opened");
        test.recorder.metric("home.items", 1);
        await nextAnalyticsFlush();
        await test.recorder.stop();

        expect(test.analytics).toHaveLength(0);
        expect(diagnosticCodes(test)).toContain("metric-analytics-off");
        expect(test.recorder.getDiagnostics().productAnalytics).toEqual({
          state: "off",
          pending: 0,
          dropped: 0,
        });
        /* The recording is what it always was. */
        expect(test.chunks.length).toBeGreaterThan(0);
      },
    );

    test("sends nothing when the policy has replay off", async () => {
      const test: Harness = harness({ enabled: false, directive: "stop" });
      expect(await test.recorder.start(options(test))).toBe(false);

      test.recorder.track("Opened");
      await nextAnalyticsFlush();

      expect(test.analytics).toHaveLength(0);
      expect(test.fetch).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * Issue #9577: an app used offline and then stopped by the system sends
   * what it held on its next launch, under the session it happened in -
   * the launch after it is another session's - and consent withdrawn on
   * any launch removes it.
   */
  describe("what a launch could not send", () => {
    function failAnalytics(test: Harness): void {
      const answer: ReplayFetch =
        test.fetch.getMockImplementation() as ReplayFetch;
      test.fetch.mockImplementation(
        async (url: string, init?: ReplayFetchInit) => {
          if (url.endsWith(PRODUCT_ANALYTICS_EVENTS_PATH)) {
            throw new TypeError("Network request failed");
          }
          return answer(url, init);
        },
      );
    }

    function queueKey(test: Harness): string {
      return productAnalyticsQueueKey(
        getReplayStorageNamespace(
          validateStartOptions(options(test)) as ValidatedStartOptions,
        ),
      );
    }

    test("is sent on the next launch, under the session it happened in", async () => {
      const storage: MemoryStorage = new MemoryStorage();
      const offline: Harness = harness({}, storage);
      failAnalytics(offline);
      expect(await offline.recorder.start(options(offline))).toBe(true);
      const offlineSession: string = offline.recorder.getSessionId() as string;

      await offline.recorder.setRoute("/Basket");
      offline.recorder.track("Ordered offline");
      offline.appState.emit("background");
      await flush();
      await offline.recorder.stop();
      await flush();

      expect(offline.analytics).toHaveLength(0);
      expect(storage.values.has(queueKey(offline))).toBe(true);

      /* Next morning: a new session. */
      await elapse(SESSION_REPLAY_IDLE_ROLLOVER_MS + 60_000);

      const relaunch: Harness = harness({}, storage);
      expect(await relaunch.recorder.start(options(relaunch))).toBe(true);
      const relaunchSession: string =
        relaunch.recorder.getSessionId() as string;
      expect(relaunchSession).not.toBe(offlineSession);

      await nextAnalyticsFlush();
      await nextAnalyticsFlush();

      expect(relaunch.analytics[0]?.batch.sessionId).toBe(offlineSession);
      expect(named(relaunch.analytics[0]?.batch.events ?? [])).toEqual([
        "session:",
        "page:/Basket",
        "custom:Ordered offline",
      ]);
      expect(
        relaunch.analytics.some((post: AnalyticsPost): boolean => {
          return post.batch.sessionId === relaunchSession;
        }),
      ).toBe(true);
      expect(diagnosticCodes(relaunch)).toContain("analytics-restored");
      await relaunch.recorder.stop();
    });

    test("is removed when consent is withdrawn, even with the events off on this launch", async () => {
      const storage: MemoryStorage = new MemoryStorage();
      const offline: Harness = harness({}, storage);
      failAnalytics(offline);
      expect(await offline.recorder.start(options(offline))).toBe(true);
      offline.recorder.track("Ordered offline");
      offline.appState.emit("background");
      await flush();
      await offline.recorder.stop();
      await flush();
      expect(storage.values.has(queueKey(offline))).toBe(true);

      /* The application has product analytics off by the next launch. */
      const relaunch: Harness = harness(
        { productAnalytics: { enabled: false, userPropertyKeys: [] } },
        storage,
      );
      expect(await relaunch.recorder.start(options(relaunch))).toBe(true);
      expect(relaunch.recorder.getDiagnostics().productAnalytics.state).toBe(
        "off",
      );

      await relaunch.recorder.revokeConsent();
      await flush();

      expect(storage.values.has(queueKey(relaunch))).toBe(false);
    });
  });

  test("counts an announced session once across a relaunch of the app", async () => {
    const storage: MemoryStorage = new MemoryStorage();
    const first: Harness = harness({}, storage);
    expect(await first.recorder.start(options(first))).toBe(true);
    first.recorder.track("First launch");
    await nextAnalyticsFlush();
    await first.recorder.stop();
    await flush();

    const relaunch: Harness = harness({}, storage);
    expect(await relaunch.recorder.start(options(relaunch))).toBe(true);
    relaunch.recorder.track("Second launch");
    await nextAnalyticsFlush();

    expect(relaunch.analytics[0]?.batch.sessionId).toBe(
      first.analytics[0]?.batch.sessionId,
    );
    expect(named(relaunch.analytics[0]?.batch.events ?? [])).toEqual([
      "custom:Second launch",
    ]);
    await relaunch.recorder.stop();
  });
});

/*
 * Readable event properties (issue #7501): this recorder masks all text,
 * and an application that lists a property key keeps that key's short
 * token values as written - in the event product analytics counts and in
 * the recording's marker alike. A listed key's sentence, every other key
 * and every identify() trait stay masked, and with no key listed - the
 * default - nothing is readable.
 */
describe("MobileReplayRecorder readable event properties", () => {
  beforeEach((): void => {
    jest.useFakeTimers({
      now: START_UNIX_MS,
      doNotFake: ["nextTick", "queueMicrotask"],
    });
  });

  afterEach((): void => {
    jest.useRealTimers();
  });

  const PROPERTIES: Record<string, string> = {
    step: "billing",
    setup: "monitor.website",
    plan: "pro",
    note: "Jane Doe asked for a refund",
  };

  function markedProperties(test: Harness): unknown {
    const marker: RrwebEvent | undefined = test.chunks
      .flatMap((chunk: ChunkPost): Array<RrwebEvent> => {
        return chunk.events;
      })
      .find((event: RrwebEvent): boolean => {
        return (
          event.type === RrwebEventType.Custom &&
          (event.data as { tag?: string }).tag === CUSTOM_EVENT_TAG
        );
      });

    return (
      (marker?.data as { payload?: { properties?: unknown } }).payload
        ?.properties ?? null
    );
  }

  test("keeps a listed key's token, in the event and the recording, and masks everything else", async () => {
    const test: Harness = harness({
      readableEventPropertyKeys: ["step", "setup", "note", "currency"],
    });
    expect(await test.recorder.start(options(test))).toBe(true);

    test.recorder.track("guided_setup/step_reached", PROPERTIES);
    test.recorder.metric("cart.value", 42.5, {
      currency: "EUR",
      region: "eu",
    });
    await nextAnalyticsFlush();

    const custom: ProductAnalyticsWireEvent | undefined = analyticsEvents(
      test,
    ).find((event: ProductAnalyticsWireEvent): boolean => {
      return event.name === "guided_setup/step_reached";
    });

    expect(custom?.properties).toEqual({
      step: "billing",
      setup: "monitor.website",
      plan: "••••",
      note: "••••••••••••••••",
    });
    expect(test.analytics[0]?.batch.metrics[0]?.attributes).toEqual({
      currency: "EUR",
      region: "••••",
    });

    await test.recorder.stop();

    expect(markedProperties(test)).toEqual({
      step: "billing",
      setup: "monitor.website",
      plan: "••••",
      note: "••••••••••••••••",
    });
  });

  test("masks every value when the application lists no key: the default", async () => {
    const test: Harness = harness();
    expect(await test.recorder.start(options(test))).toBe(true);

    test.recorder.track("guided_setup/step_reached", PROPERTIES);
    await nextAnalyticsFlush();

    const custom: ProductAnalyticsWireEvent | undefined = analyticsEvents(
      test,
    ).find((event: ProductAnalyticsWireEvent): boolean => {
      return event.name === "guided_setup/step_reached";
    });

    expect(custom?.properties).toEqual({
      step: "••••",
      setup: "••••••••••••••••",
      plan: "••••",
      note: "••••••••••••••••",
    });

    await test.recorder.stop();

    expect(markedProperties(test)).toEqual(custom?.properties);
  });

  test("never keeps an identify() trait readable, even one the list names", async () => {
    const test: Harness = harness({
      captureUserIdentity: true,
      productAnalytics: { enabled: true, userPropertyKeys: ["plan"] },
      readableEventPropertyKeys: ["plan"],
    });
    expect(await test.recorder.start(options(test))).toBe(true);

    test.recorder.identify("user-42", { plan: "pro" });
    await flush();
    test.recorder.track("Signed in", { plan: "pro" });
    await nextAnalyticsFlush();

    const post: AnalyticsPost | undefined = test.analytics[0];

    expect(post?.batch.userProperties).toEqual({ plan: "••••" });
    expect(
      analyticsEvents(test).find(
        (event: ProductAnalyticsWireEvent): boolean => {
          return event.name === "Signed in";
        },
      )?.properties,
    ).toEqual({ plan: "pro" });

    await test.recorder.stop();
  });
});
