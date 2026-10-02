import { gunzipSync, strFromU8 } from "fflate";
import {
  CUSTOM_EVENT_TAG,
  ERROR_CUSTOM_EVENT_TAG,
  IDLE_PAUSED_CUSTOM_EVENT_TAG,
  IDLE_RESUMED_CUSTOM_EVENT_TAG,
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  MOBILE_RECORDER_KIND,
  ROUTE_CUSTOM_EVENT_TAG,
  RrwebEvent,
  RrwebEventType,
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_IDLE_PAUSE_MS,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_ROTATED_CUSTOM_EVENT_TAG,
  SessionReplayChunkEnvelope,
  SessionReplayFidelityNotice,
  SessionReplayIdlePausedPayload,
  SessionReplayIdleResumedPayload,
  SessionReplayMaskingMode,
  TAGS_CUSTOM_EVENT_TAG,
  TOUCH_CUSTOM_EVENT_TAG,
  VISIBILITY_CUSTOM_EVENT_TAG,
} from "../src/Contract";
import {
  ReplayFetch,
  validateStartOptions,
  ValidatedStartOptions,
} from "../src/Config";
import MobileReplayRecorder, {
  getReplayStorageNamespace,
  MobileReplayDiagnosticEvent,
  MobileReplayRecorderDependencies,
  MOBILE_POLICY_REFRESH_INTERVAL_MS,
} from "../src/MobileReplayRecorder";
import ReplayOutbox, { frameId } from "../src/Outbox";
import {
  enabledConfig,
  envelope,
  FakeAppState,
  FakeKeyboard,
  FakeNativeViewTree,
  MemoryStorage,
  response,
  settle,
  startOptions,
} from "./TestUtils";

interface DecodedPost {
  envelope: Record<string, unknown>;
  events: Array<RrwebEvent>;
}

interface RecorderHarness {
  recorder: MobileReplayRecorder;
  fetch: jest.MockedFunction<ReplayFetch>;
  posted: Array<DecodedPost>;
  storage: MemoryStorage;
  native: FakeNativeViewTree;
  appState: FakeAppState;
  keyboard: FakeKeyboard;
  advance(milliseconds: number): void;
  nowUnixMs(): number;
}

type ReplayFetchInit = NonNullable<Parameters<ReplayFetch>[1]>;
type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;
type TestResponse = ReturnType<typeof response>;
type VoidPromiseResolver = (value: void | PromiseLike<void>) => void;
type TestResponseResolver = (
  value: TestResponse | PromiseLike<TestResponse>,
) => void;

interface TestGlobalErrorUtils {
  getGlobalHandler(): GlobalErrorHandler;
  setGlobalHandler: jest.MockedFunction<(handler: GlobalErrorHandler) => void>;
}

function decodePost(body: unknown): DecodedPost {
  const bytes: Uint8Array = body as Uint8Array;
  const newline: number = bytes.indexOf(10);
  return {
    envelope: JSON.parse(strFromU8(bytes.slice(0, newline))),
    events: JSON.parse(strFromU8(gunzipSync(bytes.slice(newline + 1)))),
  };
}

function harness(
  configOverrides: Record<string, unknown> = {},
  dependencyOverrides: Partial<MobileReplayRecorderDependencies> = {},
): RecorderHarness {
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
  const storage: MemoryStorage = new MemoryStorage();
  const native: FakeNativeViewTree = new FakeNativeViewTree();
  const appState: FakeAppState = new FakeAppState();
  const keyboard: FakeKeyboard = new FakeKeyboard();
  let now: number = 100_000;
  const recorder: MobileReplayRecorder = new MobileReplayRecorder({
    storage,
    nativeViewTree: native,
    appState,
    keyboard,
    now: (): number => {
      return now;
    },
    ...dependencyOverrides,
  });
  recorder.setRootTag(101);
  return {
    recorder,
    fetch,
    posted,
    storage,
    native,
    appState,
    keyboard,
    advance(milliseconds: number): void {
      now += milliseconds;
    },
    nowUnixMs(): number {
      return now;
    },
  };
}

function allEvents(posts: Array<DecodedPost>): Array<RrwebEvent> {
  return posts.flatMap((post: DecodedPost): Array<RrwebEvent> => {
    return post.events;
  });
}

function customTag(event: RrwebEvent): string | null {
  if (event.type !== RrwebEventType.Custom) {
    return null;
  }
  const tag: unknown = (event.data as { tag?: unknown }).tag;
  return typeof tag === "string" ? tag : null;
}

function customPayload<T>(event: RrwebEvent): T {
  return (event.data as { payload: T }).payload;
}

function eventsTagged(
  posts: Array<DecodedPost>,
  tag: string,
): Array<RrwebEvent> {
  return allEvents(posts).filter((event: RrwebEvent): boolean => {
    return customTag(event) === tag;
  });
}

function indexOfPostWith(posts: Array<DecodedPost>, tag: string): number {
  return posts.findIndex((post: DecodedPost): boolean => {
    return post.events.some((event: RrwebEvent): boolean => {
      return customTag(event) === tag;
    });
  });
}

/* What an event is, for asserting order: a custom event's tag, else its type. */
function describeEvent(event: RrwebEvent): string {
  const tag: string | null = customTag(event);
  if (tag) {
    return tag;
  }
  if (event.type === RrwebEventType.Meta) {
    return "meta";
  }
  if (event.type === RrwebEventType.FullSnapshot) {
    return "full-snapshot";
  }
  return event.type === RrwebEventType.IncrementalSnapshot
    ? "incremental"
    : `type-${event.type}`;
}

function diagnosticCodes(recorder: MobileReplayRecorder): Array<string> {
  return recorder
    .getDiagnostics()
    .events.map((event: MobileReplayDiagnosticEvent): string => {
      return event.code;
    });
}

function touchAt(
  test: RecorderHarness,
  x: number,
  y: number,
  targetTag: number = 1,
): void {
  test.recorder.recordTouch({
    phase: "start",
    x,
    y,
    timestamp: test.nowUnixMs(),
    targetTag,
  });
}

describe("MobileReplayRecorder end-to-end", () => {
  test("records a synthetic full snapshot and posts a mobile wire envelope", async () => {
    const test: RecorderHarness = harness();
    test.native.tree = {
      ...test.native.tree,
      children: [
        {
          nativeId: 2,
          kind: "text",
          x: 10,
          y: 20,
          width: 100,
          height: 20,
          text: "private checkout copy",
          children: [],
        },
      ],
    };
    expect(await test.recorder.start(startOptions({ fetch: test.fetch }))).toBe(
      true,
    );
    await test.recorder.stop();

    expect(test.posted).toHaveLength(1);
    const post: DecodedPost = test.posted[0]!;
    expect(post.envelope).toMatchObject({
      v: 1,
      appIdentifier: "rum-app",
      recorderKind: MOBILE_RECORDER_KIND,
      schemaVersion: 1,
      rrwebVersion: "synthetic-1",
      maskingMode: SessionReplayMaskingMode.MaskAllText,
      consentState: "NotRequired",
      triggerReason: "sampled",
      url: "app://com.example.checkout/",
      isFinal: true,
      hasFullSnapshot: true,
      payloadEncoding: "gzip",
    });
    expect(post.envelope["capabilities"]).toEqual(
      expect.arrayContaining(["mobile-view-tree", "mobile-touch-events"]),
    );
    expect(post.envelope["fidelityNotices"]).toContain(
      SessionReplayFidelityNotice.MobileAnimationSampled,
    );
    expect(post.envelope["meta"]).toMatchObject({
      entryUrl: "app://com.example.checkout/",
      browserName: "Checkout",
      browserVersion: "2.4.1",
      osName: "ios 18.0",
      deviceType: "ios",
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(JSON.stringify(post.events)).not.toContain("private checkout copy");
    expect(test.recorder.getDiagnostics().status).toBe("stopped");
  });

  test("fails closed with an actionable diagnostic outside an autolinked build", async () => {
    const test: RecorderHarness = harness();
    test.native.available = false;
    expect(await test.recorder.start(startOptions({ fetch: test.fetch }))).toBe(
      false,
    );
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.recorder.getDiagnostics()).toMatchObject({
      status: "disabled",
      sessionId: null,
    });
    expect(
      test.recorder
        .getDiagnostics()
        .events.some((event: MobileReplayDiagnosticEvent) => {
          return event.code === "native-module-unavailable";
        }),
    ).toBe(true);
  });

  test("does not upload explicit-consent footage until consent is granted", async () => {
    const test: RecorderHarness = harness({ consentMode: "RequireExplicit" });
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    expect(test.posted).toHaveLength(0);
    expect(test.recorder.getDiagnostics().status).toBe("consent-required");
    await test.recorder.grantConsent();
    expect(test.posted).toHaveLength(1);
    expect(test.posted[0]?.envelope["consentState"]).toBe("Granted");
    await test.recorder.stop();
  });

  test("does not persist session, visitor, or outbox state before explicit consent", async () => {
    const test: RecorderHarness = harness({ consentMode: "RequireExplicit" });
    const setItem: jest.SpyInstance = jest.spyOn(test.storage, "setItem");
    const removeItem: jest.SpyInstance = jest.spyOn(test.storage, "removeItem");
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(test.storage.values.size).toBe(0);
    await test.recorder.grantConsent();
    expect(setItem).toHaveBeenCalled();
    await test.recorder.stop();
  });

  test("backgrounding cannot drain a persisted outbox before explicit consent", async () => {
    const test: RecorderHarness = harness({ consentMode: "RequireExplicit" });
    const validated: ValidatedStartOptions = validateStartOptions(
      startOptions({ fetch: test.fetch }),
    )!;
    const outbox: ReplayOutbox = new ReplayOutbox(
      test.storage,
      getReplayStorageNamespace(validated),
    );
    const persistedEnvelope: SessionReplayChunkEnvelope = envelope();
    await outbox.enqueue({
      id: frameId(persistedEnvelope),
      envelope: persistedEnvelope,
      payload: "[]",
      attempts: 0,
      createdAtUnixMs: Date.now(),
    });

    await test.recorder.start(validated);
    test.appState.emit("background");
    await settle();
    expect(test.posted).toHaveLength(0);
    expect(await outbox.list()).toHaveLength(1);
    expect(test.recorder.getDiagnostics().status).toBe("background");
    await test.recorder.revokeConsent();
  });

  test("performs anonymous policy fetch before consent and refreshes targeting only after grant", async () => {
    const configUserRefs: Array<string | undefined> = [];
    const configCacheControls: Array<string | undefined> = [];
    const posted: Array<DecodedPost> = [];
    let configCalls: number = 0;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          configUserRefs.push(init.headers?.["x-oneuptime-user-ref"]);
          configCacheControls.push(init.headers?.["Cache-Control"]);
          return response(
            200,
            enabledConfig({
              consentMode: "RequireExplicit",
              samplePercentage: 0,
              isTargeted: configCalls > 1,
              captureUserIdentity: configCalls === 1,
            }),
          );
        }
        posted.push(decodePost(init.body));
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(
      startOptions({ fetch, userRef: "target+user@example.com" }),
    );
    expect(configUserRefs).toEqual([undefined]);
    expect(recorder.getDiagnostics().status).toBe("consent-required");

    await recorder.grantConsent();
    expect(configUserRefs).toEqual([undefined, "target%2Buser%40example.com"]);
    expect(configCacheControls).toEqual([undefined, "no-cache"]);
    expect(recorder.getDiagnostics().triggered).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.envelope["triggerReason"]).toBe("manual");
    expect(posted[0]?.envelope["meta"]).not.toHaveProperty("identifiedUserRef");
    await recorder.stop();
  });

  test("uses the current post-start identity only in the consent-time targeting refresh", async () => {
    const configUserRefs: Array<string | undefined> = [];
    let configCalls: number = 0;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          configUserRefs.push(init.headers?.["x-oneuptime-user-ref"]);
          return response(
            200,
            enabledConfig({
              consentMode: "RequireExplicit",
              isTargeted: configCalls > 1,
            }),
          );
        }
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));
    recorder.identify("identified-after-start");
    expect(configUserRefs).toEqual([undefined]);

    await recorder.grantConsent();
    expect(configUserRefs).toEqual([
      undefined,
      undefined,
      "identified-after-start",
    ]);
    expect(recorder.getDiagnostics().triggered).toBe(true);
    await recorder.stop();
  });

  test("fails closed when the latest consent-time policy is disabled", async () => {
    let configCalls: number = 0;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          return response(
            200,
            enabledConfig(
              configCalls === 1
                ? { consentMode: "RequireExplicit" }
                : { enabled: false, directive: "stop" },
            ),
          );
        }
        throw new Error("disabled policy must not upload");
      },
    );
    const storage: MemoryStorage = new MemoryStorage();
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage,
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));
    await recorder.grantConsent();

    expect(configCalls).toBe(2);
    expect(storage.values.size).toBe(0);
    expect(recorder.getDiagnostics()).toMatchObject({
      status: "disabled",
      sessionId: expect.any(String),
    });
    expect(
      recorder
        .getDiagnostics()
        .events.some((event: MobileReplayDiagnosticEvent) => {
          return event.code === "config-disabled-after-consent";
        }),
    ).toBe(true);
  });

  test("fails closed when the consent-time policy refresh cannot be fetched", async () => {
    let configCalls: number = 0;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          if (configCalls > 1) {
            throw new Error("offline while granting consent");
          }
          return response(
            200,
            enabledConfig({ consentMode: "RequireExplicit" }),
          );
        }
        throw new Error("failed policy must not upload");
      },
    );
    const storage: MemoryStorage = new MemoryStorage();
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage,
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch, userRef: "target-user" }));
    await recorder.grantConsent();

    expect(configCalls).toBe(2);
    expect(storage.values.size).toBe(0);
    expect(recorder.getDiagnostics()).toMatchObject({
      status: "disabled",
      sessionId: expect.any(String),
    });
    expect(
      recorder
        .getDiagnostics()
        .events.some((event: MobileReplayDiagnosticEvent) => {
          return event.code === "config-disabled-after-consent";
        }),
    ).toBe(true);
  });

  test("periodically refreshes an unsampled rolling recorder and stops on disable", async () => {
    jest.useFakeTimers();
    try {
      let now: number = 100_000;
      let configCalls: number = 0;
      const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
        async (url: string) => {
          if (url.endsWith("/config")) {
            configCalls += 1;
            return response(
              200,
              enabledConfig(
                configCalls === 1
                  ? {
                      captureTrigger: "OnErrorOrFrustration",
                      samplePercentage: 0,
                    }
                  : { enabled: false, directive: "stop" },
              ),
            );
          }
          throw new Error("an unsampled recorder must not upload");
        },
      );
      const recorder: MobileReplayRecorder = new MobileReplayRecorder({
        storage: new MemoryStorage(),
        nativeViewTree: new FakeNativeViewTree(),
        appState: new FakeAppState(),
        now: (): number => {
          return now;
        },
      });
      recorder.setRootTag(101);
      await recorder.start(startOptions({ fetch }));
      expect(configCalls).toBe(1);

      now += MOBILE_POLICY_REFRESH_INTERVAL_MS;
      await jest.advanceTimersByTimeAsync(500);

      expect(configCalls).toBe(2);
      expect(recorder.getDiagnostics()).toMatchObject({
        status: "disabled",
        pendingEvents: 0,
      });
      expect(
        recorder
          .getDiagnostics()
          .events.some((event: MobileReplayDiagnosticEvent) => {
            return event.code === "config-disabled-after-refresh";
          }),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("refreshes policy before foreground capture resumes", async () => {
    let configCalls: number = 0;
    const appState: FakeAppState = new FakeAppState();
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          return response(
            200,
            enabledConfig(
              configCalls === 1
                ? {
                    captureTrigger: "OnErrorOrFrustration",
                    samplePercentage: 0,
                  }
                : { enabled: false, directive: "stop" },
            ),
          );
        }
        throw new Error("disabled foreground policy must not upload");
      },
    );
    const native: FakeNativeViewTree = new FakeNativeViewTree();
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: native,
      appState,
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));
    expect(native.captures).toBe(1);

    appState.emit("background");
    await settle();
    appState.emit("active");
    await settle();

    expect(configCalls).toBe(2);
    expect(native.captures).toBe(1);
    expect(recorder.getDiagnostics()).toMatchObject({
      status: "disabled",
      pendingEvents: 0,
    });
  });

  test("withdraws persisted state when refreshed policy starts requiring consent", async () => {
    let configCalls: number = 0;
    const appState: FakeAppState = new FakeAppState();
    const storage: MemoryStorage = new MemoryStorage();
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          return response(
            200,
            enabledConfig({
              consentMode:
                configCalls === 1 ? "NotRequired" : "RequireExplicit",
            }),
          );
        }
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage,
      nativeViewTree: new FakeNativeViewTree(),
      appState,
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));
    expect(storage.values.size).toBeGreaterThan(0);

    appState.emit("background");
    await settle();
    appState.emit("active");
    await settle();

    expect(configCalls).toBe(2);
    expect(storage.values.size).toBe(0);
    expect(recorder.getDiagnostics()).toMatchObject({
      status: "consent-required",
      consentState: "Unknown",
    });
    await recorder.stop();
  });

  test("immediately refreshes identity policy before the next meta-bearing chunk", async () => {
    let configCalls: number = 0;
    const appState: FakeAppState = new FakeAppState();
    const posted: Array<DecodedPost> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          return response(
            200,
            enabledConfig({ captureUserIdentity: configCalls === 1 }),
          );
        }
        posted.push(decodePost(init.body));
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: new FakeNativeViewTree(),
      appState,
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));
    recorder.identify("identity-that-must-be-removed", { plan: "secret" });
    await recorder.setRoute("/before-refresh");
    expect(configCalls).toBe(2);
    const currentSessionId: string | null = recorder.getSessionId();
    const currentSessionMetas: Array<Record<string, unknown>> = posted
      .filter((post: DecodedPost) => {
        return post.envelope["sessionId"] === currentSessionId;
      })
      .map((post: DecodedPost) => {
        return post.envelope["meta"] as Record<string, unknown>;
      })
      .filter(Boolean);
    expect(currentSessionMetas.length).toBeGreaterThan(0);
    for (const meta of currentSessionMetas) {
      expect(meta).not.toHaveProperty("identifiedUserRef");
      expect(meta).not.toHaveProperty("identifiedUserTraits");
    }
    await recorder.stop();
  });

  test("refreshes runtime targeting immediately when identify changes users", async () => {
    const configUserRefs: Array<string | undefined> = [];
    const posted: Array<DecodedPost> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          const userRef: string | undefined =
            init.headers?.["x-oneuptime-user-ref"];
          configUserRefs.push(userRef);
          return response(
            200,
            enabledConfig({
              captureTrigger: "OnErrorOrFrustration",
              samplePercentage: 0,
              isTargeted: userRef === "new-target-user",
            }),
          );
        }
        posted.push(decodePost(init.body));
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));
    expect(posted).toHaveLength(0);

    recorder.identify("new-target-user");
    await recorder.setRoute("/targeted");

    expect(configUserRefs).toEqual([undefined, "new-target-user"]);
    expect(recorder.getDiagnostics().triggered).toBe(true);
    expect(posted.length).toBeGreaterThan(0);
    await recorder.stop();
  });

  test.each([
    ["network exception", "throw"],
    ["HTTP 503", 503],
  ])(
    "keeps the last valid policy after a transient %s refresh failure",
    async (_label: string, failure: string | number) => {
      let configCalls: number = 0;
      const appState: FakeAppState = new FakeAppState();
      const posted: Array<DecodedPost> = [];
      const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
        async (url: string, init: ReplayFetchInit = {}) => {
          if (url.endsWith("/config")) {
            configCalls += 1;
            if (configCalls > 1) {
              if (failure === "throw") {
                throw new Error("temporary network outage");
              }
              return response(failure as number, {});
            }
            return response(200, enabledConfig());
          }
          posted.push(decodePost(init.body));
          return response(202, { directive: "continue", configEpoch: 7 });
        },
      );
      const recorder: MobileReplayRecorder = new MobileReplayRecorder({
        storage: new MemoryStorage(),
        nativeViewTree: new FakeNativeViewTree(),
        appState,
        now: (): number => {
          return 100_000;
        },
      });
      recorder.setRootTag(101);
      await recorder.start(startOptions({ fetch }));
      appState.emit("background");
      await settle();
      appState.emit("active");
      await settle();

      expect(recorder.getDiagnostics().status).toBe("recording");
      expect(
        recorder
          .getDiagnostics()
          .events.some((event: MobileReplayDiagnosticEvent) => {
            return event.code === "policy-refresh-failed-using-last-config";
          }),
      ).toBe(true);
      await recorder.setRoute("/still-recording");
      await recorder.stop();
      expect(
        posted.some((post: DecodedPost) => {
          return (
            post.envelope["url"] ===
            "app://com.example.checkout/still-recording"
          );
        }),
      ).toBe(true);
    },
  );

  test("activates buffered footage when a foreground refresh newly targets the session", async () => {
    let configCalls: number = 0;
    const appState: FakeAppState = new FakeAppState();
    const posted: Array<DecodedPost> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          return response(
            200,
            enabledConfig({
              captureTrigger: "OnErrorOrFrustration",
              samplePercentage: 0,
              isTargeted: configCalls >= 3,
            }),
          );
        }
        posted.push(decodePost(init.body));
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: new FakeNativeViewTree(),
      appState,
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch, userRef: "target-user" }));
    expect(configCalls).toBe(2);
    expect(posted).toHaveLength(0);

    appState.emit("background");
    await settle();
    appState.emit("active");
    await settle();

    expect(configCalls).toBe(3);
    expect(recorder.getDiagnostics().triggered).toBe(true);
    expect(posted.length).toBeGreaterThan(0);
    expect(posted[0]?.envelope["triggerReason"]).toBe("manual");
    await recorder.stop();
  });

  test("preserves pre-start identify for consent-safe targeting when no option userRef is supplied", async () => {
    const configUserRefs: Array<string | undefined> = [];
    const posted: Array<DecodedPost> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          configUserRefs.push(init.headers?.["x-oneuptime-user-ref"]);
          return response(
            200,
            enabledConfig({ captureUserIdentity: true, isTargeted: false }),
          );
        }
        posted.push(decodePost(init.body));
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.identify("pre-start-user", { plan: "secret" });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));
    expect(configUserRefs).toEqual([undefined, "pre-start-user"]);
    await recorder.stop();
    expect(posted[0]?.envelope["meta"]).toEqual(
      expect.objectContaining({ identifiedUserRef: "pre-start-user" }),
    );
  });

  test("start option userRef takes precedence over an earlier pre-start identify", async () => {
    const configUserRefs: Array<string | undefined> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          configUserRefs.push(init.headers?.["x-oneuptime-user-ref"]);
          return response(200, enabledConfig());
        }
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.identify("pre-start-user");
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch, userRef: "option-user" }));
    expect(configUserRefs).toEqual([undefined, "option-user"]);
    await recorder.stop();
  });

  test("revocation clears session, visitor, rolling footage, and durable outbox", async () => {
    const test: RecorderHarness = harness({ consentMode: "RequireExplicit" });
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    await test.recorder.grantConsent();
    expect(test.storage.values.size).toBeGreaterThan(0);
    const postedBeforeRevocation: number = test.posted.length;
    await test.recorder.revokeConsent();
    expect(test.posted).toHaveLength(postedBeforeRevocation);
    expect(test.storage.values.size).toBe(0);
    expect(test.recorder.getDiagnostics()).toMatchObject({
      status: "consent-revoked",
      sessionId: null,
      pendingEvents: 0,
    });
  });

  test("serializes a concurrent grant and revoke so late grant writes cannot survive revocation", async () => {
    const test: RecorderHarness = harness({ consentMode: "RequireExplicit" });
    await test.recorder.start(startOptions({ fetch: test.fetch }));

    let releaseFirstWrite: () => void = (): void => {
      throw new Error("grant persistence did not start");
    };
    let markWriteStarted: () => void = (): void => {
      return undefined;
    };
    const writeStarted: Promise<void> = new Promise<void>(
      (resolve: VoidPromiseResolver): void => {
        markWriteStarted = resolve;
      },
    );
    const writeGate: Promise<void> = new Promise<void>(
      (resolve: VoidPromiseResolver): void => {
        releaseFirstWrite = resolve;
      },
    );
    const originalSetItem: MemoryStorage["setItem"] = test.storage.setItem.bind(
      test.storage,
    );
    let blocked: boolean = false;
    jest
      .spyOn(test.storage, "setItem")
      .mockImplementation(async (key: string, value: string): Promise<void> => {
        if (!blocked) {
          blocked = true;
          markWriteStarted();
          await writeGate;
        }
        await originalSetItem(key, value);
      });

    const granting: Promise<void> = test.recorder.grantConsent();
    await writeStarted;
    let revokeFinished: boolean = false;
    const revoking: Promise<void> = test.recorder.revokeConsent().then(() => {
      revokeFinished = true;
    });
    await Promise.resolve();
    expect(revokeFinished).toBe(false);

    releaseFirstWrite();
    await Promise.all([granting, revoking]);
    expect(test.storage.values.size).toBe(0);
    expect(test.recorder.getDiagnostics()).toMatchObject({
      status: "consent-revoked",
      sessionId: null,
      consentState: "Unknown",
    });
    const diagnosticEvents: Array<MobileReplayDiagnosticEvent> =
      test.recorder.getDiagnostics().events;
    expect(diagnosticEvents[diagnosticEvents.length - 1]?.code).toBe(
      "consent-revoked",
    );
  });

  test("drops deferred tag activity when consent is revoked during an identity policy refresh", async () => {
    let configCalls: number = 0;
    let markRefreshStarted: () => void = (): void => {
      return undefined;
    };
    const refreshStarted: Promise<void> = new Promise<void>(
      (resolve: VoidPromiseResolver): void => {
        markRefreshStarted = resolve;
      },
    );
    let releaseRefresh: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("identity refresh did not start");
    };
    const pendingRefresh: Promise<TestResponse> = new Promise<TestResponse>(
      (resolve: TestResponseResolver): void => {
        releaseRefresh = resolve;
      },
    );
    const posted: Array<DecodedPost> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          if (configCalls === 2) {
            markRefreshStarted();
            return await pendingRefresh;
          }
          return response(200, enabledConfig());
        }
        posted.push(decodePost(init.body));
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));

    recorder.identify("new-user-during-refresh");
    await refreshStarted;
    recorder.setTags({ privacy: "must-not-survive-revoke" });
    const revoking: Promise<void> = recorder.revokeConsent();
    releaseRefresh(response(200, enabledConfig()));
    await revoking;

    await recorder.grantConsent();
    await recorder.stop();
    expect(configCalls).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(posted)).not.toContain("must-not-survive-revoke");
  });

  test("holds unsampled error-mode pre-roll, then uploads it on a JS error", async () => {
    const test: RecorderHarness = harness({
      captureTrigger: "OnErrorOrFrustration",
      samplePercentage: 0,
    });
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    expect(test.posted).toHaveLength(0);
    const hostileError: Error = new Error(
      "Customer alice@example.com entered card 4111111111111111",
    );
    hostileError.name = "alice@example.com-secret-error-name";
    await test.recorder.captureError(hostileError);
    expect(test.posted).toHaveLength(1);
    expect(test.posted[0]?.envelope["triggerReason"]).toBe("error");
    expect(test.posted[0]?.envelope["signals"]).toEqual(
      expect.objectContaining({ errorCount: 1 }),
    );
    const wire: string = JSON.stringify(test.posted);
    expect(wire).toContain(ERROR_CUSTOM_EVENT_TAG);
    expect(wire).toContain("[masked]");
    expect(wire).toContain('"name":"Error"');
    expect(wire).not.toContain("alice@example.com");
    expect(wire).not.toContain("4111111111111111");
    await test.recorder.stop();
  });

  test("uploads sampled baseline sessions even when the trigger mode also supports errors", async () => {
    const test: RecorderHarness = harness({
      captureTrigger: "OnErrorOrFrustration",
      samplePercentage: 100,
    });
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    await test.recorder.stop();
    expect(test.posted).toHaveLength(1);
    expect(test.posted[0]?.envelope["triggerReason"]).toBe("sampled");
  });

  test("records public API metadata, route, custom event, and root touches", async () => {
    const test: RecorderHarness = harness({ captureUserIdentity: true });
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    test.recorder.identify("alice@example.com", {
      plan: "enterprise",
      count: 2,
    });
    test.recorder.setTags({ build: "2026.09", region: "eu" });
    test.recorder.addTag("experiment", "checkout-b");
    test.recorder.track("checkout_opened", { cartSize: 3, paid: false });
    await test.recorder.setRoute("/checkout?token=private#payment");
    test.recorder.recordTouch({
      phase: "start",
      x: 123,
      y: 456,
      timestamp: 100_010,
      targetTag: 2,
    });
    await settle();
    await test.recorder.stop();

    const firstMeta: Record<string, unknown> = test.posted
      .map((post: DecodedPost) => {
        return post.envelope["meta"];
      })
      .find((meta: unknown) => {
        return (
          (meta as Record<string, unknown> | undefined)?.[
            "identifiedUserRef"
          ] === "alice@example.com"
        );
      }) as Record<string, unknown>;
    expect(firstMeta).toMatchObject({
      identifiedUserRef: "alice@example.com",
      identifiedUserTraits: { plan: "••••••••••••••••", count: "••••" },
      tags: {
        build: "2026.09",
        region: "eu",
        experiment: "checkout-b",
      },
    });
    const wire: string = JSON.stringify(allEvents(test.posted));
    expect(wire).toContain("checkout_opened");
    expect(wire).toContain("oneuptime.route");
    expect(wire).toContain('"x":123');
    expect(wire).toContain('"y":456');
    expect(wire).not.toContain("token=private");
    expect(wire).not.toContain("enterprise");
    expect(
      test.posted.some((post: DecodedPost) => {
        return post.envelope["url"] === "app://com.example.checkout/checkout";
      }),
    ).toBe(true);
  });

  test("seals each account into a distinct replay session during rapid identity changes", async () => {
    const test: RecorderHarness = harness({ captureUserIdentity: true });
    await test.recorder.start(
      startOptions({ fetch: test.fetch, userRef: "alice@example.com" }),
    );
    const aliceSessionId: string | null =
      test.recorder.getDiagnostics().sessionId;
    await test.recorder.setRoute("/alice");

    test.recorder.identify("bob@example.com", { plan: "business" });
    test.recorder.identify("carol@example.com", { plan: "enterprise" });
    await test.recorder.setRoute("/carol");
    const carolSessionId: string | null =
      test.recorder.getDiagnostics().sessionId;
    await test.recorder.stop();

    const sessionByUser: Map<string, string> = new Map<string, string>();
    for (const post of test.posted) {
      const meta: Record<string, unknown> | undefined = post.envelope[
        "meta"
      ] as Record<string, unknown> | undefined;
      const userRef: unknown = meta?.["identifiedUserRef"];
      const sessionId: unknown = post.envelope["sessionId"];
      if (typeof userRef === "string" && typeof sessionId === "string") {
        sessionByUser.set(userRef, sessionId);
      }
    }
    expect(sessionByUser.get("alice@example.com")).toBe(aliceSessionId);
    expect(sessionByUser.get("bob@example.com")).toEqual(expect.any(String));
    expect(sessionByUser.get("carol@example.com")).toBe(carolSessionId);
    expect(new Set(sessionByUser.values()).size).toBe(3);
    expect(JSON.stringify(test.posted)).not.toContain("business");
    expect(JSON.stringify(test.posted)).not.toContain("enterprise");
  });

  test("updates traits in place when identify repeats the same user", async () => {
    const test: RecorderHarness = harness({ captureUserIdentity: true });
    await test.recorder.start(
      startOptions({ fetch: test.fetch, userRef: "same@example.com" }),
    );
    const sessionId: string | null = test.recorder.getDiagnostics().sessionId;
    test.recorder.identify("same@example.com", { plan: "updated-secret" });
    await test.recorder.setRoute("/same-user");

    expect(test.recorder.getDiagnostics().sessionId).toBe(sessionId);
    await test.recorder.stop();
    expect(
      new Set(
        test.posted.map((post: DecodedPost) => {
          return post.envelope["sessionId"];
        }),
      ).size,
    ).toBe(1);
    expect(JSON.stringify(test.posted)).not.toContain("updated-secret");
  });

  test("exposes consented session ids immediately and on rotation", async () => {
    const test: RecorderHarness = harness();
    const seen: Array<string | null> = [];
    const unsubscribe: () => void = test.recorder.onSessionChange(
      (sessionId: string | null): void => {
        seen.push(sessionId);
      },
    );
    expect(test.recorder.getSessionId()).toBeNull();
    expect(seen).toEqual([]);

    await test.recorder.start(startOptions({ fetch: test.fetch }));
    const firstSessionId: string | null = test.recorder.getSessionId();
    expect(firstSessionId).toEqual(expect.any(String));
    expect(seen).toEqual([firstSessionId]);

    test.recorder.identify("rotated-user");
    await test.recorder.setRoute("/rotated-user");
    const secondSessionId: string | null = test.recorder.getSessionId();
    expect(secondSessionId).not.toBe(firstSessionId);
    expect(seen).toEqual([firstSessionId, secondSessionId]);

    await test.recorder.stop();
    expect(test.recorder.getSessionId()).toBeNull();
    expect(seen).toEqual([firstSessionId, secondSessionId, null]);
    unsubscribe();
  });

  test("does not carry one user's targeting trigger into the next account", async () => {
    const configUserRefs: Array<string | undefined> = [];
    const posted: Array<DecodedPost> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          const userRef: string | undefined =
            init.headers?.["x-oneuptime-user-ref"];
          configUserRefs.push(userRef);
          return response(
            200,
            enabledConfig({
              captureTrigger: "OnErrorOrFrustration",
              samplePercentage: 0,
              isTargeted: userRef === "alice-targeted",
            }),
          );
        }
        posted.push(decodePost(init.body));
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: new MemoryStorage(),
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch, userRef: "alice-targeted" }));
    expect(recorder.getDiagnostics().triggered).toBe(true);

    recorder.identify("bob-untargeted");
    await recorder.setRoute("/bob");
    const bobSessionId: string | null = recorder.getSessionId();

    expect(configUserRefs).toEqual([
      undefined,
      "alice-targeted",
      "bob-untargeted",
    ]);
    expect(recorder.getDiagnostics().triggered).toBe(false);
    expect(
      posted.some((post: DecodedPost) => {
        return post.envelope["sessionId"] === bobSessionId;
      }),
    ).toBe(false);
    await recorder.stop();
  });

  test("suppresses an entire touch sequence that enters a ReplayMask or opaque surface", async () => {
    const test: RecorderHarness = harness();
    test.native.tree = {
      ...test.native.tree,
      touchOriginX: 50,
      touchOriginY: 100,
      children: [
        {
          nativeId: 2,
          kind: "masked",
          masked: true,
          x: 10,
          y: 20,
          width: 100,
          height: 100,
          children: [],
        },
      ],
    };
    test.native.isTouchTargetPrivate = jest.fn(
      async (targetTag: number): Promise<boolean> => {
        return targetTag === 2;
      },
    );
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    test.recorder.recordTouch({
      phase: "start",
      x: 350,
      y: 700,
      timestamp: 100_000,
      targetTag: 2,
      pointerId: 7,
    });
    test.recorder.recordTouch({
      phase: "start",
      x: 300,
      y: 400,
      timestamp: 100_100,
      targetTag: 1,
      pointerId: 8,
    });
    test.recorder.recordTouch({
      phase: "end",
      x: 300,
      y: 400,
      timestamp: 100_200,
      targetTag: 1,
      pointerId: 8,
    });
    test.recorder.recordTouch({
      phase: "move",
      x: 310,
      y: 410,
      timestamp: 100_300,
      targetTag: 1,
      pointerId: 7,
    });
    test.recorder.recordTouch({
      phase: "end",
      x: 310,
      y: 410,
      timestamp: 100_400,
      targetTag: 1,
      pointerId: 7,
    });
    await settle();
    await test.recorder.stop();

    const wire: string = JSON.stringify(allEvents(test.posted));
    expect(wire).not.toContain('"x":350');
    expect(wire).not.toContain('"x":310');
    expect(wire).toContain('"x":300');
    expect(
      test.recorder
        .getDiagnostics()
        .events.some((event: MobileReplayDiagnosticEvent) => {
          return event.code === "touch-suppressed-private-region";
        }),
    ).toBe(true);
  });

  test("suppresses the remainder of a pointer sequence after it crosses into an opaque target", async () => {
    const test: RecorderHarness = harness();
    test.native.isTouchTargetPrivate = jest.fn(
      async (targetTag: number): Promise<boolean> => {
        return targetTag === 2;
      },
    );
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    test.recorder.recordTouch({
      phase: "start",
      x: 200,
      y: 300,
      timestamp: 100_000,
      targetTag: 1,
      pointerId: 9,
    });
    test.recorder.recordTouch({
      phase: "move",
      x: 210,
      y: 310,
      timestamp: 100_100,
      targetTag: 2,
      pointerId: 9,
    });
    test.recorder.recordTouch({
      phase: "move",
      x: 220,
      y: 320,
      timestamp: 100_200,
      targetTag: 1,
      pointerId: 9,
    });
    test.recorder.recordTouch({
      phase: "end",
      x: 230,
      y: 330,
      timestamp: 100_300,
      targetTag: 1,
      pointerId: 9,
    });
    await settle();
    await test.recorder.stop();

    const wire: string = JSON.stringify(allEvents(test.posted));
    expect(wire).toContain('"x":200');
    expect(wire).not.toContain('"x":210');
    expect(wire).not.toContain('"x":220');
    expect(wire).not.toContain('"x":230');
  });

  test("masks trait, custom-property, and capture-reason values but keeps tags searchable", async () => {
    const test: RecorderHarness = harness({ captureUserIdentity: true });
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    test.recorder.identify("stable-user-ref", { account: "trait-secret" });
    test.recorder.setTags({ release: "searchable-release" });
    test.recorder.track("safe-event-name", { customer: "property-secret" });
    await test.recorder.captureSession("reason-secret");
    await test.recorder.stop();
    const wire: string = JSON.stringify(test.posted);
    expect(wire).not.toContain("trait-secret");
    expect(wire).not.toContain("property-secret");
    expect(wire).not.toContain("reason-secret");
    expect(wire).toContain("safe-event-name");
    expect(wire).toContain("searchable-release");
    expect(wire).toContain("stable-user-ref");
  });

  test("never sends host identity when server policy disables it", async () => {
    const test: RecorderHarness = harness({ captureUserIdentity: false });
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    test.recorder.identify("alice@example.com", { secret: "private-plan" });
    await test.recorder.stop();
    const meta: Record<string, unknown> = test.posted[0]?.envelope[
      "meta"
    ] as Record<string, unknown>;
    expect(meta).not.toHaveProperty("identifiedUserRef");
    expect(meta).not.toHaveProperty("identifiedUserTraits");
    expect(JSON.stringify(test.posted)).not.toContain("private-plan");
    expect(JSON.stringify(test.posted)).not.toContain("alice@example.com");
  });

  test("AppState flushes hidden state and forces a checkout on resume", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    expect(test.native.captures).toBe(1);
    test.appState.emit("background");
    await settle();
    expect(test.recorder.getDiagnostics().status).toBe("background");
    test.advance(1_000);
    test.appState.emit("active");
    await settle();
    expect(test.native.captures).toBeGreaterThanOrEqual(2);
    expect(test.recorder.getDiagnostics().status).toBe("recording");
    await test.recorder.stop();
    const wire: string = JSON.stringify(allEvents(test.posted));
    expect(wire).toContain('"state":"hidden"');
    expect(wire).toContain('"state":"visible"');
    expect(
      allEvents(test.posted).filter((event: RrwebEvent) => {
        return event.type === 2;
      }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  test.each([
    [30 * 60_000, "idle"],
    [4 * 60 * 60_000, "duration"],
  ])(
    "rotates a long-running session on resume after %sms",
    async (elapsed: number, reason: string) => {
      const test: RecorderHarness = harness();
      await test.recorder.start(startOptions({ fetch: test.fetch }));
      const originalSessionId: string | null =
        test.recorder.getDiagnostics().sessionId;
      test.appState.emit("background");
      await settle();
      test.advance(elapsed);
      test.appState.emit("active");
      await settle();
      expect(test.recorder.getDiagnostics().sessionId).not.toBe(
        originalSessionId,
      );
      expect(
        test.recorder
          .getDiagnostics()
          .events.some((event: MobileReplayDiagnosticEvent) => {
            return (
              event.code === "session-rotated" &&
              event.details?.["reason"] === reason
            );
          }),
      ).toBe(true);
      await test.recorder.stop();
      expect(
        new Set(
          test.posted.map((post: DecodedPost) => {
            return post.envelope["sessionId"];
          }),
        ).size,
      ).toBeGreaterThanOrEqual(2);
    },
  );

  test("rotates before the first touch after idle and deliberately drops that stale touch", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    const originalSessionId: string | null =
      test.recorder.getDiagnostics().sessionId;
    test.advance(SESSION_REPLAY_IDLE_ROLLOVER_MS);

    test.recorder.recordTouch({
      phase: "start",
      x: 321,
      y: 654,
      timestamp: 100_000 + SESSION_REPLAY_IDLE_ROLLOVER_MS,
      targetTag: 2,
    });
    await settle();

    expect(test.recorder.getDiagnostics().sessionId).not.toBe(
      originalSessionId,
    );
    expect(
      test.recorder
        .getDiagnostics()
        .events.some((event: MobileReplayDiagnosticEvent) => {
          return event.code === "touch-dropped-session-rotation";
        }),
    ).toBe(true);
    expect(JSON.stringify(test.posted)).not.toContain('"x":321');
    await test.recorder.stop();
  });

  test("defers developer events until idle rotation completes and never appends after the old final chunk", async () => {
    const posted: Array<DecodedPost> = [];
    let releaseFirstPost: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("post did not start");
    };
    let postCalls: number = 0;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          return response(200, enabledConfig());
        }
        postCalls += 1;
        posted.push(decodePost(init.body));
        if (postCalls === 1) {
          return await new Promise<TestResponse>(
            (resolve: TestResponseResolver): void => {
              releaseFirstPost = resolve;
            },
          );
        }
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const storage: MemoryStorage = new MemoryStorage();
    const native: FakeNativeViewTree = new FakeNativeViewTree();
    const appState: FakeAppState = new FakeAppState();
    let now: number = 100_000;
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage,
      nativeViewTree: native,
      appState,
      now: (): number => {
        return now;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));
    const outgoingSessionId: string | null =
      recorder.getDiagnostics().sessionId;
    now += SESSION_REPLAY_IDLE_ROLLOVER_MS;

    recorder.recordTouch({
      phase: "start",
      x: 10,
      y: 20,
      timestamp: now,
      targetTag: 2,
    });
    await settle();
    recorder.track("deferred-after-rotation", { secret: "masked-value" });
    recorder.recordTouch({
      phase: "start",
      x: 30,
      y: 40,
      timestamp: now,
      targetTag: 2,
    });
    expect(posted).toHaveLength(1);
    expect(JSON.stringify(posted[0]?.events)).not.toContain(
      "deferred-after-rotation",
    );

    releaseFirstPost(response(202, { directive: "continue", configEpoch: 7 }));
    await settle();
    expect(recorder.getDiagnostics().sessionId).not.toBe(outgoingSessionId);
    await recorder.stop();

    const outgoingPosts: Array<DecodedPost> = posted.filter(
      (post: DecodedPost) => {
        return post.envelope["sessionId"] === outgoingSessionId;
      },
    );
    expect(outgoingPosts).toHaveLength(1);
    expect(outgoingPosts[0]?.envelope["isFinal"]).toBe(true);
    expect(JSON.stringify(outgoingPosts)).not.toContain(
      "deferred-after-rotation",
    );
    const newSessionPosts: Array<DecodedPost> = posted.filter(
      (post: DecodedPost) => {
        return post.envelope["sessionId"] !== outgoingSessionId;
      },
    );
    expect(JSON.stringify(newSessionPosts)).toContain(
      "deferred-after-rotation",
    );
    expect(JSON.stringify(posted)).not.toContain("masked-value");
  });

  test("marks chunk 479 final and rotates live instead of disabling capture", async () => {
    const posted: Array<DecodedPost> = [];
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string, init: ReplayFetchInit = {}) => {
        if (url.endsWith("/config")) {
          return response(200, enabledConfig());
        }
        posted.push(decodePost(init.body));
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const options: ValidatedStartOptions = validateStartOptions(
      startOptions({ fetch }),
    )!;
    const namespace: string = getReplayStorageNamespace(options);
    const storage: MemoryStorage = new MemoryStorage();
    const oldSessionId: string = "a".repeat(32);
    storage.values.set(
      `@oneuptime/replay/${namespace}/session`,
      JSON.stringify({
        sessionId: oldSessionId,
        sessionStartUnixMs: 90_000,
        lastActivityUnixMs: 99_000,
        nextChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
      }),
    );
    storage.values.set(
      `@oneuptime/replay/${namespace}/visitor`,
      "b".repeat(32),
    );
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage,
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(options);
    expect(recorder.getDiagnostics().sessionId).toBe(oldSessionId);

    await recorder.setRoute("/after-cap");
    expect(posted[0]?.envelope).toMatchObject({
      sessionId: oldSessionId,
      chunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
      isFinal: true,
    });
    expect(recorder.getDiagnostics().sessionId).not.toBe(oldSessionId);
    expect(recorder.getDiagnostics().status).toBe("recording");
    expect(
      recorder
        .getDiagnostics()
        .events.some((event: MobileReplayDiagnosticEvent) => {
          return (
            event.code === "session-rotated" &&
            event.details?.["reason"] === "chunk-cap"
          );
        }),
    ).toBe(true);
    await recorder.stop();
  });

  test("serializes rapid background-active transitions until the background drain completes", async () => {
    let releasePost: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("background post did not start");
    };
    let postCalls: number = 0;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string) => {
        if (url.endsWith("/config")) {
          return response(200, enabledConfig());
        }
        postCalls += 1;
        if (postCalls === 1) {
          return await new Promise<TestResponse>(
            (resolve: TestResponseResolver): void => {
              releasePost = resolve;
            },
          );
        }
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const storage: MemoryStorage = new MemoryStorage();
    const native: FakeNativeViewTree = new FakeNativeViewTree();
    const appState: FakeAppState = new FakeAppState();
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage,
      nativeViewTree: native,
      appState,
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));
    expect(native.captures).toBe(1);

    appState.emit("background");
    appState.emit("active");
    await settle();
    expect(recorder.getDiagnostics().status).toBe("background");
    expect(native.captures).toBe(1);

    releasePost(response(202, { directive: "continue", configEpoch: 7 }));
    await settle();
    expect(recorder.getDiagnostics().status).toBe("recording");
    expect(native.captures).toBe(2);
    await recorder.stop();
  });

  test("preserves and restores the host global JS error handler", async () => {
    const originalErrorUtils: unknown = (
      globalThis as unknown as Record<string, unknown>
    )["ErrorUtils"];
    const previous: jest.MockedFunction<GlobalErrorHandler> = jest.fn();
    let current: GlobalErrorHandler = previous;
    (globalThis as unknown as Record<string, unknown>)["ErrorUtils"] = {
      getGlobalHandler: (): ((error: Error, isFatal?: boolean) => void) => {
        return current;
      },
      setGlobalHandler: (
        handler: (error: Error, isFatal?: boolean) => void,
      ): void => {
        current = handler;
      },
    };

    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    const installed: GlobalErrorHandler = current;
    expect(installed).not.toBe(previous);
    installed(new Error("private error message"), true);
    await settle();
    expect(previous).toHaveBeenCalledWith(expect.any(Error), true);
    await test.recorder.stop();
    expect(current).toBe(previous);
    (globalThis as unknown as Record<string, unknown>)["ErrorUtils"] =
      originalErrorUtils;
  });

  test.each([
    {
      name: "stop",
      shutdown: (recorder: MobileReplayRecorder): Promise<void> => {
        return recorder.stop();
      },
    },
    {
      name: "consent revocation",
      shutdown: (recorder: MobileReplayRecorder): Promise<void> => {
        return recorder.revokeConsent();
      },
    },
  ])(
    "does not overwrite a newer host error handler during $name",
    async ({
      shutdown,
    }: {
      name: string;
      shutdown: (recorder: MobileReplayRecorder) => Promise<void>;
    }) => {
      const originalErrorUtils: unknown = (
        globalThis as unknown as Record<string, unknown>
      )["ErrorUtils"];
      const previous: jest.MockedFunction<GlobalErrorHandler> = jest.fn();
      const external: jest.MockedFunction<GlobalErrorHandler> = jest.fn();
      let current: GlobalErrorHandler = previous;
      const setter: jest.MockedFunction<(handler: GlobalErrorHandler) => void> =
        jest.fn((handler: GlobalErrorHandler): void => {
          current = handler;
        });
      const errorUtils: TestGlobalErrorUtils = {
        getGlobalHandler: (): GlobalErrorHandler => {
          return current;
        },
        setGlobalHandler: setter,
      };
      (globalThis as unknown as Record<string, unknown>)["ErrorUtils"] =
        errorUtils;

      const test: RecorderHarness = harness();
      try {
        await test.recorder.start(startOptions({ fetch: test.fetch }));
        const installed: GlobalErrorHandler = current;
        expect(installed).not.toBe(previous);

        errorUtils.setGlobalHandler(external);
        const callsBeforeShutdown: number = setter.mock.calls.length;
        await shutdown(test.recorder);

        expect(current).toBe(external);
        expect(current).not.toBe(installed);
        expect(setter).toHaveBeenCalledTimes(callsBeforeShutdown);
      } finally {
        await test.recorder.stop();
        (globalThis as unknown as Record<string, unknown>)["ErrorUtils"] =
          originalErrorUtils;
      }
    },
  );

  test("captures once when a restarted handler delegates through a stale recorder wrapper", async () => {
    const originalErrorUtils: unknown = (
      globalThis as unknown as Record<string, unknown>
    )["ErrorUtils"];
    const previous: jest.MockedFunction<GlobalErrorHandler> = jest.fn();
    let current: GlobalErrorHandler = previous;
    const setter: jest.MockedFunction<(handler: GlobalErrorHandler) => void> =
      jest.fn((handler: GlobalErrorHandler): void => {
        current = handler;
      });
    const errorUtils: TestGlobalErrorUtils = {
      getGlobalHandler: (): GlobalErrorHandler => {
        return current;
      },
      setGlobalHandler: setter,
    };
    (globalThis as unknown as Record<string, unknown>)["ErrorUtils"] =
      errorUtils;

    const test: RecorderHarness = harness();
    try {
      await test.recorder.start(startOptions({ fetch: test.fetch }));
      const firstRecorderHandler: GlobalErrorHandler = current;
      const hostHandler: jest.MockedFunction<GlobalErrorHandler> = jest.fn(
        (error: Error, isFatal?: boolean): void => {
          firstRecorderHandler(error, isFatal);
        },
      );
      errorUtils.setGlobalHandler(hostHandler);
      await test.recorder.stop();
      expect(current).toBe(hostHandler);

      await test.recorder.start(startOptions({ fetch: test.fetch }));
      const restartedHandler: GlobalErrorHandler = current;
      expect(restartedHandler).not.toBe(firstRecorderHandler);
      expect(restartedHandler).not.toBe(hostHandler);
      const captureError: jest.SpyInstance = jest
        .spyOn(test.recorder, "captureError")
        .mockResolvedValue();

      restartedHandler(new Error("private chained error"), true);
      await settle();

      expect(captureError).toHaveBeenCalledTimes(1);
      expect(hostHandler).toHaveBeenCalledTimes(1);
      expect(previous).toHaveBeenCalledTimes(1);
      expect(previous).toHaveBeenCalledWith(expect.any(Error), true);
    } finally {
      await test.recorder.stop();
      (globalThis as unknown as Record<string, unknown>)["ErrorUtils"] =
        originalErrorUtils;
    }
  });

  test("does not replace ErrorUtils when no prior callable handler can be restored", async () => {
    const originalErrorUtils: unknown = (
      globalThis as unknown as Record<string, unknown>
    )["ErrorUtils"];
    const setter: jest.Mock = jest.fn();
    (globalThis as unknown as Record<string, unknown>)["ErrorUtils"] = {
      getGlobalHandler: (): null => {
        return null;
      },
      setGlobalHandler: setter,
    };
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    await test.recorder.stop();
    expect(setter).not.toHaveBeenCalled();
    (globalThis as unknown as Record<string, unknown>)["ErrorUtils"] =
      originalErrorUtils;
  });

  test("quiesces an in-flight native capture before sealing the final chunk", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    let release: (tree: typeof test.native.tree) => void = (): void => {
      throw new Error("capture did not start");
    };
    test.native.captureViewTree = jest.fn().mockImplementationOnce(async () => {
      return await new Promise<typeof test.native.tree>(
        (
          resolve: (
            value:
              | typeof test.native.tree
              | PromiseLike<typeof test.native.tree>,
          ) => void,
        ): void => {
          release = resolve;
        },
      );
    });
    test.recorder.setRootTag(202);
    await settle();
    const stopping: Promise<void> = test.recorder.stop();
    release(test.native.tree);
    await stopping;
    expect(test.posted).toHaveLength(1);
    expect(test.posted[0]?.envelope["isFinal"]).toBe(true);
    expect(test.recorder.getDiagnostics().pendingEvents).toBe(0);
  });

  test("a stale native capture rejection cannot disable a restarted generation", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    let rejectOldCapture: (error: Error) => void = (): void => {
      throw new Error("stale capture did not start");
    };
    test.native.captureViewTree = jest
      .fn()
      .mockImplementationOnce(async () => {
        return await new Promise<never>(
          (
            _resolve: (value: never | PromiseLike<never>) => void,
            reject: (reason?: unknown) => void,
          ): void => {
            rejectOldCapture = reject;
          },
        );
      })
      .mockImplementation(async () => {
        return test.native.tree;
      });
    test.recorder.setRootTag(202);
    await settle();
    await test.recorder.stop();
    await expect(
      test.recorder.start(startOptions({ fetch: test.fetch })),
    ).resolves.toBe(true);

    rejectOldCapture(new Error("old native bridge failure"));
    await settle();
    expect(test.recorder.getDiagnostics().status).toBe("recording");
    expect(
      test.recorder
        .getDiagnostics()
        .events.some((event: MobileReplayDiagnosticEvent) => {
          return event.code === "native-capture-failed";
        }),
    ).toBe(false);
    await test.recorder.stop();
  });

  test("sanitizes malformed runtime metadata instead of failing startup", async () => {
    const test: RecorderHarness = harness();
    test.native.getAppMetadata = jest.fn(async () => {
      return {
        appName: null,
        appVersion: 42,
        osName: {},
        osVersion: undefined,
      };
    }) as never;
    await expect(
      test.recorder.start(
        startOptions({
          fetch: test.fetch,
          appName: 42 as unknown as string,
          appVersion: null as unknown as string,
        }),
      ),
    ).resolves.toBe(true);
    await test.recorder.stop();
    expect(test.posted[0]?.envelope["meta"]).toEqual(
      expect.objectContaining({
        browserName: "React Native",
        browserVersion: "unknown",
        osName: "unknown unknown",
      }),
    );
  });

  test("hostile runtime calls are ignored rather than thrown into the app", async () => {
    const test: RecorderHarness = harness();
    await expect(
      test.recorder.start(null as unknown as ReturnType<typeof startOptions>),
    ).resolves.toBe(false);
    expect(() => {
      return test.recorder.identify(null as unknown as string, {
        constructor: "blocked",
      });
    }).not.toThrow();
    expect(() => {
      return test.recorder.track(null as unknown as string);
    }).not.toThrow();
    expect(() => {
      return test.recorder.addTag(null as unknown as string, "value");
    }).not.toThrow();
  });

  test("sanitizes hostile public touch inputs without poisoning idle rotation", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    const originalSessionId: string | null =
      test.recorder.getDiagnostics().sessionId;

    expect(() => {
      return test.recorder.recordTouch(
        null as unknown as Parameters<typeof test.recorder.recordTouch>[0],
      );
    }).not.toThrow();
    expect(() => {
      return test.recorder.recordTouch({
        phase: "tap",
        x: 1,
        y: 2,
        timestamp: 100_000,
      } as never);
    }).not.toThrow();
    test.recorder.recordTouch({
      phase: "start",
      x: Number.POSITIVE_INFINITY,
      y: Number.NaN,
      timestamp: Number.POSITIVE_INFINITY,
      targetTag: 2,
    });
    await settle();
    test.advance(SESSION_REPLAY_IDLE_ROLLOVER_MS);
    test.recorder.recordTouch({
      phase: "start",
      x: 10,
      y: 20,
      timestamp: Number.NEGATIVE_INFINITY,
      targetTag: 2,
    });
    await settle();

    expect(test.recorder.getDiagnostics().sessionId).not.toBe(
      originalSessionId,
    );
    await test.recorder.stop();
    const events: Array<RrwebEvent> = allEvents(test.posted);
    expect(
      events.every((event: RrwebEvent) => {
        return Number.isFinite(event.timestamp);
      }),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain('"timestamp":null');
    expect(JSON.stringify(events)).toContain('"x":0');
    expect(
      test.recorder
        .getDiagnostics()
        .events.some((event: MobileReplayDiagnosticEvent) => {
          return event.code === "invalid-touch-event";
        }),
    ).toBe(true);
  });

  test("isolates persisted footage by ingest host, project token, and app ids", () => {
    const base: ValidatedStartOptions = validateStartOptions(startOptions())!;
    const namespace: string = getReplayStorageNamespace(base);
    expect(
      getReplayStorageNamespace({ ...base, host: "https://other.example" }),
    ).not.toBe(namespace);
    expect(
      getReplayStorageNamespace({ ...base, token: "another-project-token" }),
    ).not.toBe(namespace);
    expect(
      getReplayStorageNamespace({ ...base, appIdentifier: "another app" }),
    ).not.toBe(namespace);
    expect(namespace).not.toContain(base.token);
    expect(namespace).toMatch(/^v1-[0-9a-f]{32}$/u);
  });

  test("stop during policy fetch invalidates startup before native capture", async () => {
    let releaseConfig: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("config fetch did not start");
    };
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (_url: string, _init: ReplayFetchInit = {}) => {
        return await new Promise<TestResponse>(
          (resolve: TestResponseResolver): void => {
            releaseConfig = resolve;
          },
        );
      },
    );
    const test: RecorderHarness = harness();
    const starting: Promise<boolean> = test.recorder.start(
      startOptions({ fetch }),
    );
    await settle();
    await test.recorder.stop();
    releaseConfig(response(200, enabledConfig()));
    await expect(starting).resolves.toBe(false);
    expect(test.native.captures).toBe(0);
    expect(test.recorder.getDiagnostics().status).toBe("stopped");
  });

  test("a Strict Mode cleanup can cancel one start while the remount starts cleanly", async () => {
    let releaseFirst: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("first config fetch did not start");
    };
    let configCalls: number = 0;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (_url: string, _init: ReplayFetchInit = {}) => {
        configCalls += 1;
        if (configCalls === 1) {
          return await new Promise<TestResponse>(
            (resolve: TestResponseResolver): void => {
              releaseFirst = resolve;
            },
          );
        }
        return response(200, enabledConfig());
      },
    );
    const test: RecorderHarness = harness();
    const first: Promise<boolean> = test.recorder.start(
      startOptions({ fetch }),
    );
    await settle();
    await test.recorder.stop();
    const second: Promise<boolean> = test.recorder.start(
      startOptions({ fetch }),
    );
    releaseFirst(response(200, enabledConfig()));
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(test.native.captures).toBe(1);
    await test.recorder.stop();
  });

  test("a restart waits for an unawaited pending stop before replacing recorder state", async () => {
    let releaseFirstPost: (value: ReturnType<typeof response>) => void = () => {
      throw new Error("stop upload did not start");
    };
    let configCalls: number = 0;
    let postCalls: number = 0;
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string) => {
        if (url.endsWith("/config")) {
          configCalls += 1;
          return response(200, enabledConfig());
        }
        postCalls += 1;
        if (postCalls === 1) {
          return await new Promise<TestResponse>(
            (resolve: TestResponseResolver): void => {
              releaseFirstPost = resolve;
            },
          );
        }
        return response(202, { directive: "continue", configEpoch: 7 });
      },
    );
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch }));
    const stopping: Promise<void> = test.recorder.stop();
    await settle();
    const restarting: Promise<boolean> = test.recorder.start(
      startOptions({ fetch }),
    );
    await settle();
    expect(configCalls).toBe(1);
    expect(test.native.captures).toBe(1);

    releaseFirstPost(response(202, { directive: "continue", configEpoch: 7 }));
    await stopping;
    await expect(restarting).resolves.toBe(true);
    expect(configCalls).toBe(2);
    expect(test.native.captures).toBe(2);
    expect(test.recorder.getDiagnostics().status).toBe("recording");
    await test.recorder.stop();
  });

  test("a non-awaited revoke completes before an immediate restart", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    const oldSessionId: string | null =
      test.recorder.getDiagnostics().sessionId;

    const revoking: Promise<void> = test.recorder.revokeConsent();
    const restarting: Promise<boolean> = test.recorder.start(
      startOptions({ fetch: test.fetch }),
    );
    await revoking;
    await expect(restarting).resolves.toBe(true);

    expect(test.recorder.getDiagnostics()).toMatchObject({
      status: "recording",
      consentState: "NotRequired",
    });
    expect(test.recorder.getDiagnostics().sessionId).not.toBe(oldSessionId);
    expect(test.storage.values.size).toBeGreaterThan(0);
    await test.recorder.stop();
  });

  test("serializes an uploading stop with consent revocation", async () => {
    let postStarted: () => void = (): void => {
      return undefined;
    };
    const postWasStarted: Promise<void> = new Promise<void>(
      (resolve: VoidPromiseResolver): void => {
        postStarted = resolve;
      },
    );
    const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
      async (url: string) => {
        if (url.endsWith("/config")) {
          return response(200, enabledConfig());
        }
        postStarted();
        return await new Promise<never>(() => {
          /* Intentionally unresolved until destroy() aborts the request. */
        });
      },
    );
    const storage: MemoryStorage = new MemoryStorage();
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage,
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return 100_000;
      },
    });
    recorder.setRootTag(101);
    await recorder.start(startOptions({ fetch }));

    const stopping: Promise<void> = recorder.stop();
    await postWasStarted;
    const revoking: Promise<void> = recorder.revokeConsent();
    await Promise.all([stopping, revoking]);

    expect(storage.values.size).toBe(0);
    expect(recorder.getDiagnostics()).toMatchObject({
      status: "consent-revoked",
      sessionId: null,
      pendingEvents: 0,
    });
  });

  test.each([401, 403, 404])(
    "terminal transport status %i halts capture and discards memory",
    async (status: number) => {
      const native: FakeNativeViewTree = new FakeNativeViewTree();
      const fetch: jest.MockedFunction<ReplayFetch> = jest.fn(
        async (url: string) => {
          return url.endsWith("/config")
            ? response(200, enabledConfig())
            : response(status, { error: "denied" });
        },
      );
      const recorder: MobileReplayRecorder = new MobileReplayRecorder({
        storage: new MemoryStorage(),
        nativeViewTree: native,
        appState: new FakeAppState(),
        now: (): number => {
          return 100_000;
        },
      });
      recorder.setRootTag(101);
      await recorder.start(startOptions({ fetch }));
      await recorder.setRoute("/terminal-status");

      expect(recorder.getDiagnostics()).toMatchObject({
        status: "disabled",
        pendingEvents: 0,
      });
      const capturesAfterStop: number = native.captures;
      recorder.setRootTag(202);
      await settle();
      expect(native.captures).toBe(capturesAfterStop);
      expect(
        recorder
          .getDiagnostics()
          .events.some((event: MobileReplayDiagnosticEvent) => {
            return event.code === "server-stopped";
          }),
      ).toBe(true);
    },
  );
});

/*
 * The idle pause (#4208): five minutes without a touch and the recorder
 * stops capturing altogether, then resumes the same session on a fresh
 * snapshot when the person comes back - or, past the idle window, ends the
 * session where its footage ended and lets the next input start a new one.
 *
 * Fake timers drive the sampler and flush timers; the recorder's injected
 * clock moves with them (live), as it would for an app left on screen.
 */
describe("MobileReplayRecorder idle pause", () => {
  /* harness() starts its clock here, and start() counts as input. */
  const START_UNIX_MS: number = 100_000;
  const PAUSED_AT_UNIX_MS: number =
    START_UNIX_MS + SESSION_REPLAY_IDLE_PAUSE_MS;
  /* Nothing is recorded via appendEvent before the pause: the start is the session's last activity. */
  const ROLLOVER_AT_UNIX_MS: number =
    START_UNIX_MS + SESSION_REPLAY_IDLE_ROLLOVER_MS;

  beforeEach((): void => {
    jest.useFakeTimers();
  });

  afterEach((): void => {
    jest.useRealTimers();
  });

  /*
   * An app on screen living through `milliseconds`: the clock first, then
   * the timers due in that step, so every tick sees the time it fires at.
   */
  const live: (
    test: RecorderHarness,
    milliseconds: number,
    stepMs?: number,
  ) => Promise<void> = async (
    test: RecorderHarness,
    milliseconds: number,
    stepMs: number = 5_000,
  ): Promise<void> => {
    let elapsed: number = 0;
    while (elapsed < milliseconds) {
      const step: number = Math.min(stepMs, milliseconds - elapsed);
      test.advance(step);
      await jest.advanceTimersByTimeAsync(step);
      elapsed += step;
    }
  };

  const flush: () => Promise<void> = async (): Promise<void> => {
    await jest.advanceTimersByTimeAsync(0);
  };

  /* Started and then left alone: returns the index of the post the pause closed. */
  const startAndLeaveAlone: (test: RecorderHarness) => Promise<number> = async (
    test: RecorderHarness,
  ): Promise<number> => {
    expect(await test.recorder.start(startOptions({ fetch: test.fetch }))).toBe(
      true,
    );
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS);
    const pauseIndex: number = indexOfPostWith(
      test.posted,
      IDLE_PAUSED_CUSTOM_EVENT_TAG,
    );
    expect(pauseIndex).toBeGreaterThanOrEqual(0);
    return pauseIndex;
  };

  test("keeps capturing through any stretch without input shorter than the pause window", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS - 5_000);
    expect(test.recorder.getDiagnostics().status).toBe("recording");

    /* A touch just inside the window starts it over. */
    touchAt(test, 10, 20);
    await flush();
    const capturesAfterTouch: number = test.native.captures;
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS - 5_000);

    expect(test.native.captures).toBeGreaterThan(capturesAfterTouch + 50);
    expect(test.recorder.getDiagnostics().status).toBe("recording");
    expect(diagnosticCodes(test.recorder)).not.toContain("idle-paused");
    await test.recorder.stop();
    expect(eventsTagged(test.posted, IDLE_PAUSED_CUSTOM_EVENT_TAG)).toEqual([]);
  });

  test("pauses five minutes after the last input, closing the open chunk on the idle-paused marker", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);

    /* The pause's chunk went out at once, and nothing has gone since. */
    expect(pauseIndex).toBe(test.posted.length - 1);
    const pausePost: DecodedPost = test.posted[pauseIndex]!;
    const marker: RrwebEvent = pausePost.events[pausePost.events.length - 1]!;
    expect(customTag(marker)).toBe(IDLE_PAUSED_CUSTOM_EVENT_TAG);
    expect(marker.timestamp).toBe(PAUSED_AT_UNIX_MS);
    expect(customPayload<SessionReplayIdlePausedPayload>(marker)).toEqual({
      idleSinceUnixMs: START_UNIX_MS,
      pausedAtUnixMs: PAUSED_AT_UNIX_MS,
    });
    expect(pausePost.envelope).toMatchObject({
      isFinal: false,
      chunkEndOffsetMs: PAUSED_AT_UNIX_MS - START_UNIX_MS,
    });
    expect(
      eventsTagged(test.posted, IDLE_PAUSED_CUSTOM_EVENT_TAG),
    ).toHaveLength(1);
    expect(test.recorder.getDiagnostics()).toMatchObject({
      status: "paused",
      pendingEvents: 0,
    });
    expect(diagnosticCodes(test.recorder)).toContain("idle-paused");
    await test.recorder.stop();
  });

  test("captures nothing, uploads nothing and refreshes no policy for as long as it is paused", async () => {
    const test: RecorderHarness = harness();
    await startAndLeaveAlone(test);
    const captureViewTree: jest.SpyInstance = jest.spyOn(
      test.native,
      "captureViewTree",
    );
    const postsAtPause: number = test.posted.length;
    const fetchesAtPause: number = test.fetch.mock.calls.length;
    /* The sampler is stopped; only the 15-second heartbeat is left. */
    expect(jest.getTimerCount()).toBe(1);

    /* 24 minutes: short of the half hour that ends the session. */
    await live(test, 24 * 60_000, 15_000);

    expect(captureViewTree).not.toHaveBeenCalled();
    expect(test.posted).toHaveLength(postsAtPause);
    expect(test.fetch.mock.calls.length).toBe(fetchesAtPause);
    expect(test.recorder.getDiagnostics()).toMatchObject({
      status: "paused",
      pendingEvents: 0,
    });

    /* A replay root remounted by the app is not input either. */
    test.recorder.setRootTag(202);
    await flush();
    expect(captureViewTree).not.toHaveBeenCalled();
    expect(test.fetch.mock.calls.length).toBe(fetchesAtPause);
    await test.recorder.stop();
  });

  test("a touch resumes the same session and tab at the next chunk index: the snapshot, then the resume marker, then the touch", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    const pausePost: DecodedPost = test.posted[pauseIndex]!;
    await live(test, 3 * 60_000, 15_000);
    const capturesWhilePaused: number = test.native.captures;

    const resumedAtUnixMs: number = test.nowUnixMs();
    touchAt(test, 123, 456);
    await flush();
    expect(test.native.captures).toBe(capturesWhilePaused + 1);
    expect(test.recorder.getDiagnostics().status).toBe("recording");
    /* The sampler and the flush timer, both back. */
    expect(jest.getTimerCount()).toBe(2);
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);

    expect(test.posted.length).toBeGreaterThan(pauseIndex + 1);
    const resumePost: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(resumePost.envelope).toMatchObject({
      sessionId: pausePost.envelope["sessionId"],
      tabId: pausePost.envelope["tabId"],
      chunkIndex: (pausePost.envelope["chunkIndex"] as number) + 1,
      hasFullSnapshot: true,
      isFinal: false,
    });
    expect(resumePost.events.slice(0, 5).map(describeEvent)).toEqual([
      "meta",
      "full-snapshot",
      IDLE_RESUMED_CUSTOM_EVENT_TAG,
      "incremental",
      TOUCH_CUSTOM_EVENT_TAG,
    ]);
    const [, snapshot, marker, touch] = resumePost.events;
    expect(snapshot?.timestamp).toBe(resumedAtUnixMs);
    expect(marker?.timestamp).toBe(resumedAtUnixMs);
    expect(customPayload<SessionReplayIdleResumedPayload>(marker!)).toEqual({
      pausedAtUnixMs: PAUSED_AT_UNIX_MS,
      resumedAtUnixMs,
    });
    expect(touch).toMatchObject({
      timestamp: resumedAtUnixMs,
      data: { x: 123, y: 456 },
    });
    expect(resumePost.envelope["signals"]).toMatchObject({ clickCount: 1 });

    /* The sampler is running again. */
    expect(test.native.captures).toBeGreaterThan(capturesWhilePaused + 1);
    expect(diagnosticCodes(test.recorder)).toContain("idle-resumed");
    await test.recorder.stop();
  });

  test("coming back to the foreground resumes the paused session, with no visibility rows for the time away", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    const pausePost: DecodedPost = test.posted[pauseIndex]!;

    test.appState.emit("background");
    await flush();
    expect(test.recorder.getDiagnostics().status).toBe("background");
    await live(test, 4 * 60_000, 15_000);
    expect(test.posted).toHaveLength(pauseIndex + 1);

    const returnedAtUnixMs: number = test.nowUnixMs();
    test.appState.emit("active");
    await flush();
    expect(test.recorder.getDiagnostics().status).toBe("recording");
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);

    const resumePost: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(resumePost.envelope).toMatchObject({
      sessionId: pausePost.envelope["sessionId"],
      tabId: pausePost.envelope["tabId"],
      chunkIndex: (pausePost.envelope["chunkIndex"] as number) + 1,
      hasFullSnapshot: true,
    });
    expect(resumePost.events.slice(0, 3).map(describeEvent)).toEqual([
      "meta",
      "full-snapshot",
      IDLE_RESUMED_CUSTOM_EVENT_TAG,
    ]);
    expect(
      customPayload<SessionReplayIdleResumedPayload>(resumePost.events[2]!),
    ).toEqual({
      pausedAtUnixMs: PAUSED_AT_UNIX_MS,
      resumedAtUnixMs: returnedAtUnixMs,
    });
    expect(
      eventsTagged(test.posted.slice(pauseIndex), VISIBILITY_CUSTOM_EVENT_TAG),
    ).toEqual([]);
    await test.recorder.stop();
  });

  test("backgrounding while paused neither throws, records, captures nor resumes", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    const capturesAtPause: number = test.native.captures;

    expect((): void => {
      test.appState.emit("background");
    }).not.toThrow();
    await flush();
    await live(test, 10 * 60_000, 15_000);

    expect(test.native.captures).toBe(capturesAtPause);
    expect(test.posted).toHaveLength(pauseIndex + 1);
    expect(test.recorder.getDiagnostics().status).toBe("background");
    expect(diagnosticCodes(test.recorder)).not.toContain(
      "app-state-transition-failed",
    );

    /* A touch reported while the app is away resumes nothing. */
    touchAt(test, 5, 5);
    await flush();
    expect(test.native.captures).toBe(capturesAtPause);
    expect(test.posted).toHaveLength(pauseIndex + 1);
    await test.recorder.stop();
  });

  test("coming back to the foreground is the person returning: the session's idle window starts over from there", async () => {
    const test: RecorderHarness = harness();
    await startAndLeaveAlone(test);
    const sessionId: string | null = test.recorder.getSessionId();
    test.appState.emit("background");
    await flush();

    /* Back 25 minutes after the session's last activity: inside its window. */
    await live(test, START_UNIX_MS + 25 * 60_000 - test.nowUnixMs(), 60_000);
    const returnedAtUnixMs: number = test.nowUnixMs();
    test.appState.emit("active");
    await flush();

    /* Looked at, never touched: it pauses again five minutes later... */
    await live(test, 10 * 60_000);
    expect(test.recorder.getDiagnostics().status).toBe("paused");
    const markers: Array<RrwebEvent> = eventsTagged(
      test.posted,
      IDLE_PAUSED_CUSTOM_EVENT_TAG,
    );
    expect(markers).toHaveLength(2);
    expect(customPayload<SessionReplayIdlePausedPayload>(markers[1]!)).toEqual({
      idleSinceUnixMs: returnedAtUnixMs,
      pausedAtUnixMs: returnedAtUnixMs + SESSION_REPLAY_IDLE_PAUSE_MS,
    });
    /* ...but the session runs on: half an hour from the return, not the start. */
    expect(test.recorder.getSessionId()).toBe(sessionId);
    expect(
      test.posted.some((post: DecodedPost): boolean => {
        return post.envelope["isFinal"] === true;
      }),
    ).toBe(false);
    await test.recorder.stop();
  });

  test("an app that leaves between the waking touch and its snapshot stays paused, and its return resumes cleanly", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    await live(test, 60_000, 15_000);
    const capturesAtPause: number = test.native.captures;

    touchAt(test, 15, 25);
    test.appState.emit("background");
    await flush();

    expect(test.native.captures).toBe(capturesAtPause);
    expect(test.posted).toHaveLength(pauseIndex + 1);
    expect(test.recorder.getDiagnostics().status).toBe("background");

    await live(test, 2 * 60_000, 15_000);
    const returnedAtUnixMs: number = test.nowUnixMs();
    test.appState.emit("active");
    await flush();
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);

    /* Nothing from the aborted resume - no touch, no "hidden" - leaks into it. */
    const resumePost: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(resumePost.events.map(describeEvent)).toEqual([
      "meta",
      "full-snapshot",
      IDLE_RESUMED_CUSTOM_EVENT_TAG,
    ]);
    expect(
      customPayload<SessionReplayIdleResumedPayload>(resumePost.events[2]!),
    ).toEqual({
      pausedAtUnixMs: PAUSED_AT_UNIX_MS,
      resumedAtUnixMs: returnedAtUnixMs,
    });
    expect(
      eventsTagged(test.posted.slice(pauseIndex), VISIBILITY_CUSTOM_EVENT_TAG),
    ).toEqual([]);
    expect(JSON.stringify(allEvents(test.posted))).not.toContain('"x":15');
    await test.recorder.stop();
  });

  test("drops what the app emits while paused - events, tags, routes, errors - and counts none of it", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    const capturesAtPause: number = test.native.captures;

    test.recorder.track("emitted-while-paused", { cart: 3 });
    test.recorder.addTag("phase", "tagged-while-paused");
    await test.recorder.setRoute("/changed-while-paused");
    await test.recorder.captureError(new TypeError("background poll failed"));
    await flush();
    expect(test.posted).toHaveLength(pauseIndex + 1);
    expect(test.native.captures).toBe(capturesAtPause);

    await live(test, 60_000, 15_000);
    touchAt(test, 40, 50);
    await flush();
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);

    const afterPause: Array<DecodedPost> = test.posted.slice(pauseIndex + 1);
    expect(afterPause.length).toBeGreaterThan(0);
    expect(JSON.stringify(allEvents(afterPause))).not.toContain(
      "emitted-while-paused",
    );
    for (const tag of [
      CUSTOM_EVENT_TAG,
      ROUTE_CUSTOM_EVENT_TAG,
      ERROR_CUSTOM_EVENT_TAG,
      TAGS_CUSTOM_EVENT_TAG,
    ]) {
      expect(eventsTagged(afterPause, tag)).toEqual([]);
    }
    for (const post of afterPause) {
      expect(post.envelope["signals"]).toMatchObject({
        customEventCount: 0,
        routeCount: 0,
        errorCount: 0,
      });
    }

    /*
     * What the app changed is still known: the resume's snapshot is on the
     * route it moved to, and the tag is on the session.
     */
    const resumePost: DecodedPost = afterPause[0]!;
    expect(resumePost.envelope["url"]).toBe(
      "app://com.example.checkout/changed-while-paused",
    );
    expect(resumePost.envelope["meta"]).toMatchObject({
      tags: { phase: "tagged-while-paused" },
    });
    expect(test.recorder.getDiagnostics().triggered).toBe(false);
    await test.recorder.stop();
  });

  test("an app that keeps raising events by itself cannot hold off the pause or the end of the session", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    for (let minute: number = 1; minute <= 4; minute += 1) {
      await live(test, 60_000);
      test.recorder.track(`poll-${minute}`);
      await test.recorder.setRoute(`/auto-refresh-${minute}`);
    }
    await live(test, 60_000);

    expect(test.recorder.getDiagnostics().status).toBe("paused");
    const markers: Array<RrwebEvent> = eventsTagged(
      test.posted,
      IDLE_PAUSED_CUSTOM_EVENT_TAG,
    );
    expect(markers).toHaveLength(1);
    expect(customPayload<SessionReplayIdlePausedPayload>(markers[0]!)).toEqual({
      idleSinceUnixMs: START_UNIX_MS,
      pausedAtUnixMs: PAUSED_AT_UNIX_MS,
    });
    /* Recorded while nobody had been gone for long. */
    expect(JSON.stringify(allEvents(test.posted))).toContain("poll-4");

    /*
     * Still polling while paused: none of it is recorded or moves the idle
     * window, which runs out half an hour after the last recorded event.
     */
    const lastRecordedUnixMs: number = START_UNIX_MS + 4 * 60_000;
    while (
      test.nowUnixMs() <
      lastRecordedUnixMs + SESSION_REPLAY_IDLE_ROLLOVER_MS
    ) {
      await live(test, 60_000, 15_000);
      test.recorder.track("poll-while-paused");
    }
    await live(test, 15_000, 15_000);
    expect(test.recorder.getSessionId()).toBeNull();
    expect(diagnosticCodes(test.recorder)).toContain("idle-session-ended");
    expect(JSON.stringify(allEvents(test.posted))).not.toContain(
      "poll-while-paused",
    );
    await test.recorder.stop();
  });

  test("a touch counts as input even where it is never recorded - inside a ReplayMask", async () => {
    const test: RecorderHarness = harness();
    test.native.isTouchTargetPrivate = jest.fn(
      async (targetTag: number): Promise<boolean> => {
        return targetTag === 2;
      },
    );
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    for (let round: number = 0; round < 3; round += 1) {
      await live(test, 4 * 60_000);
      touchAt(test, 77, 88, 2);
      await flush();
    }
    await live(test, 4 * 60_000);

    expect(test.recorder.getDiagnostics().status).toBe("recording");
    expect(diagnosticCodes(test.recorder)).toContain(
      "touch-suppressed-private-region",
    );
    await test.recorder.stop();
    expect(eventsTagged(test.posted, IDLE_PAUSED_CUSTOM_EVENT_TAG)).toEqual([]);
    expect(JSON.stringify(allEvents(test.posted))).not.toContain('"x":77');
  });

  test("a resumed recording pauses again after another five minutes without input, in one session with contiguous chunks", async () => {
    const test: RecorderHarness = harness();
    await startAndLeaveAlone(test);
    await live(test, 60_000, 15_000);
    const touchedAtUnixMs: number = test.nowUnixMs();
    touchAt(test, 60, 70);
    await flush();
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS);

    const markers: Array<RrwebEvent> = eventsTagged(
      test.posted,
      IDLE_PAUSED_CUSTOM_EVENT_TAG,
    );
    expect(markers).toHaveLength(2);
    expect(customPayload<SessionReplayIdlePausedPayload>(markers[1]!)).toEqual({
      idleSinceUnixMs: touchedAtUnixMs,
      pausedAtUnixMs: touchedAtUnixMs + SESSION_REPLAY_IDLE_PAUSE_MS,
    });
    expect(
      eventsTagged(test.posted, IDLE_RESUMED_CUSTOM_EVENT_TAG),
    ).toHaveLength(1);
    expect(test.recorder.getDiagnostics().status).toBe("paused");

    const chunkIndexes: Array<number> = test.posted.map(
      (post: DecodedPost): number => {
        return post.envelope["chunkIndex"] as number;
      },
    );
    expect(chunkIndexes).toEqual(
      chunkIndexes.map((_index: number, position: number): number => {
        return position;
      }),
    );
    expect(
      new Set(
        test.posted.map((post: DecodedPost): unknown => {
          return post.envelope["sessionId"];
        }),
      ).size,
    ).toBe(1);
    expect(
      new Set(
        test.posted.map((post: DecodedPost): unknown => {
          return post.envelope["tabId"];
        }),
      ).size,
    ).toBe(1);
    await test.recorder.stop();
  });

  test("what happens between the waking touch and its snapshot lands behind the resume marker", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    await live(test, 60_000, 15_000);

    touchAt(test, 12, 34);
    /* The screen the touch opened says so before the snapshot is taken. */
    test.recorder.track("opened-by-the-waking-touch");
    await flush();
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);

    const resumePost: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(resumePost.events.slice(0, 6).map(describeEvent)).toEqual([
      "meta",
      "full-snapshot",
      IDLE_RESUMED_CUSTOM_EVENT_TAG,
      CUSTOM_EVENT_TAG,
      "incremental",
      TOUCH_CUSTOM_EVENT_TAG,
    ]);
    expect(resumePost.envelope["signals"]).toMatchObject({
      customEventCount: 1,
      clickCount: 1,
    });
    await test.recorder.stop();
  });

  test("the touch that wakes the recorder is checked against the screen it resumed on, not the one before the pause", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    /* While nobody watched, the app put a masked surface where the next touch lands. */
    test.native.tree = {
      ...test.native.tree,
      touchOriginX: 0,
      touchOriginY: 0,
      children: [
        {
          nativeId: 3,
          kind: "masked",
          masked: true,
          x: 150,
          y: 250,
          width: 100,
          height: 100,
          children: [],
        },
      ],
    };
    await live(test, 60_000, 15_000);

    touchAt(test, 200, 300);
    await flush();
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);
    await test.recorder.stop();

    const afterPause: Array<DecodedPost> = test.posted.slice(pauseIndex + 1);
    expect(
      eventsTagged(afterPause, IDLE_RESUMED_CUSTOM_EVENT_TAG),
    ).toHaveLength(1);
    expect(JSON.stringify(allEvents(afterPause))).not.toContain('"x":200');
    expect(diagnosticCodes(test.recorder)).toContain(
      "touch-suppressed-private-region",
    );
  });

  test("ends a session nobody came back to, dated at its pause, and the next touch starts a new one", async () => {
    const test: RecorderHarness = harness();
    const seen: Array<string | null> = [];
    test.recorder.onSessionChange((sessionId: string | null): void => {
      seen.push(sessionId);
    });
    const pauseIndex: number = await startAndLeaveAlone(test);
    const pausePost: DecodedPost = test.posted[pauseIndex]!;
    const pausedSessionId: string | null = test.recorder.getSessionId();
    expect(pausedSessionId).toEqual(expect.any(String));

    await live(test, ROLLOVER_AT_UNIX_MS - test.nowUnixMs() + 15_000, 15_000);

    expect(test.posted).toHaveLength(pauseIndex + 2);
    const seal: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(seal.envelope).toMatchObject({
      sessionId: pausedSessionId,
      tabId: pausePost.envelope["tabId"],
      chunkIndex: (pausePost.envelope["chunkIndex"] as number) + 1,
      isFinal: true,
      hasFullSnapshot: false,
      chunkStartOffsetMs: PAUSED_AT_UNIX_MS - START_UNIX_MS,
      chunkEndOffsetMs: PAUSED_AT_UNIX_MS - START_UNIX_MS,
    });
    expect(seal.events).toEqual([
      {
        type: RrwebEventType.Custom,
        timestamp: PAUSED_AT_UNIX_MS,
        data: {
          tag: SESSION_ROTATED_CUSTOM_EVENT_TAG,
          payload: { reason: "idle" },
        },
      },
    ]);
    expect(test.recorder.getSessionId()).toBeNull();
    expect(seen).toEqual([pausedSessionId, null]);
    expect(test.recorder.getDiagnostics().status).toBe("paused");
    expect(diagnosticCodes(test.recorder)).toContain("idle-session-ended");

    /* Over, and nobody here: nothing more is sent, sampled or kept alive. */
    expect(jest.getTimerCount()).toBe(0);
    const capturesAfterSeal: number = test.native.captures;
    await live(test, 20 * 60_000, 15_000);
    expect(test.posted).toHaveLength(pauseIndex + 2);
    expect(test.native.captures).toBe(capturesAfterSeal);

    touchAt(test, 321, 654);
    await flush();
    const nextSessionId: string | null = test.recorder.getSessionId();
    expect(nextSessionId).toEqual(expect.any(String));
    expect(nextSessionId).not.toBe(pausedSessionId);
    expect(seen).toEqual([pausedSessionId, null, nextSessionId]);
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);
    await test.recorder.stop();

    const nextPosts: Array<DecodedPost> = test.posted.filter(
      (post: DecodedPost): boolean => {
        return post.envelope["sessionId"] === nextSessionId;
      },
    );
    expect(nextPosts[0]?.envelope).toMatchObject({
      chunkIndex: 0,
      hasFullSnapshot: true,
    });
    expect(nextPosts[0]?.events.slice(0, 2).map(describeEvent)).toEqual([
      "meta",
      "full-snapshot",
    ]);
    expect(eventsTagged(nextPosts, IDLE_RESUMED_CUSTOM_EVENT_TAG)).toEqual([]);
    /* As ever after the rollover, the touch that found the session over is not recorded. */
    expect(JSON.stringify(allEvents(nextPosts))).not.toContain('"x":321');
    expect(diagnosticCodes(test.recorder)).toContain(
      "touch-dropped-session-rotation",
    );
    expect(
      test.posted.filter((post: DecodedPost): boolean => {
        return post.envelope["sessionId"] === pausedSessionId;
      }),
    ).toHaveLength(pauseIndex + 2);
  });

  test("a touch after the idle window ran out, before the heartbeat noticed, still seals the session at its pause", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    const pausedSessionId: string | null = test.recorder.getSessionId();
    await live(test, ROLLOVER_AT_UNIX_MS - test.nowUnixMs() - 15_000, 15_000);
    expect(test.posted).toHaveLength(pauseIndex + 1);

    /* Past the window, between two heartbeats. */
    test.advance(20_000);
    touchAt(test, 1, 2);
    await flush();
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);

    const seal: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(seal.envelope).toMatchObject({
      sessionId: pausedSessionId,
      isFinal: true,
      chunkEndOffsetMs: PAUSED_AT_UNIX_MS - START_UNIX_MS,
    });
    expect(seal.events.map(describeEvent)).toEqual([
      SESSION_ROTATED_CUSTOM_EVENT_TAG,
    ]);
    expect(seal.events[0]?.timestamp).toBe(PAUSED_AT_UNIX_MS);
    expect(test.recorder.getSessionId()).not.toBe(pausedSessionId);
    expect(test.recorder.getDiagnostics().status).toBe("recording");
    await test.recorder.stop();
  });

  test("a paused session that ran out while the app was in the background is sealed at its pause when the app returns", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    const pausedSessionId: string | null = test.recorder.getSessionId();

    test.appState.emit("background");
    await flush();
    await live(test, 40 * 60_000, 60_000);
    expect(test.posted).toHaveLength(pauseIndex + 1);

    test.appState.emit("active");
    await flush();

    const seal: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(seal.envelope).toMatchObject({
      sessionId: pausedSessionId,
      isFinal: true,
      chunkStartOffsetMs: PAUSED_AT_UNIX_MS - START_UNIX_MS,
      chunkEndOffsetMs: PAUSED_AT_UNIX_MS - START_UNIX_MS,
    });
    expect(seal.events.map(describeEvent)).toEqual([
      SESSION_ROTATED_CUSTOM_EVENT_TAG,
    ]);
    expect(seal.events[0]?.timestamp).toBe(PAUSED_AT_UNIX_MS);

    const nextSessionId: string | null = test.recorder.getSessionId();
    expect(nextSessionId).toEqual(expect.any(String));
    expect(nextSessionId).not.toBe(pausedSessionId);
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);
    await test.recorder.stop();

    /* The new session opens as a return to the foreground always opens one. */
    const nextPosts: Array<DecodedPost> = test.posted.filter(
      (post: DecodedPost): boolean => {
        return post.envelope["sessionId"] === nextSessionId;
      },
    );
    expect(
      eventsTagged(nextPosts, VISIBILITY_CUSTOM_EVENT_TAG).map(
        (event: RrwebEvent): unknown => {
          return customPayload<{ state: string }>(event).state;
        },
      ),
    ).toEqual(["visible", "stopped"]);
    expect(
      nextPosts.some((post: DecodedPost): boolean => {
        return post.envelope["hasFullSnapshot"] === true;
      }),
    ).toBe(true);
    expect(eventsTagged(nextPosts, IDLE_RESUMED_CUSTOM_EVENT_TAG)).toEqual([]);
  });

  test("stopping while paused seals the session at its pause, not at the stop", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    const pausePost: DecodedPost = test.posted[pauseIndex]!;
    await live(test, 10 * 60_000, 15_000);
    const capturesBeforeStop: number = test.native.captures;

    await test.recorder.stop();

    expect(test.native.captures).toBe(capturesBeforeStop);
    expect(test.posted).toHaveLength(pauseIndex + 2);
    const final: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(final.envelope).toMatchObject({
      sessionId: pausePost.envelope["sessionId"],
      chunkIndex: (pausePost.envelope["chunkIndex"] as number) + 1,
      isFinal: true,
      chunkStartOffsetMs: PAUSED_AT_UNIX_MS - START_UNIX_MS,
      chunkEndOffsetMs: PAUSED_AT_UNIX_MS - START_UNIX_MS,
    });
    expect(final.events).toEqual([
      {
        type: RrwebEventType.Custom,
        timestamp: PAUSED_AT_UNIX_MS,
        data: {
          tag: VISIBILITY_CUSTOM_EVENT_TAG,
          payload: { state: "stopped" },
        },
      },
    ]);
    expect(test.recorder.getDiagnostics().status).toBe("stopped");
  });

  test("stopping after the paused session ended sends nothing more for it", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    await live(test, ROLLOVER_AT_UNIX_MS - test.nowUnixMs() + 15_000, 15_000);
    expect(test.posted).toHaveLength(pauseIndex + 2);

    await test.recorder.stop();

    expect(test.posted).toHaveLength(pauseIndex + 2);
    expect(test.recorder.getDiagnostics().status).toBe("stopped");
  });

  test("a relaunch after a paused session ended starts a new session rather than continuing it", async () => {
    const test: RecorderHarness = harness();
    await startAndLeaveAlone(test);
    const endedSessionId: string | null = test.recorder.getSessionId();
    await live(test, ROLLOVER_AT_UNIX_MS - test.nowUnixMs() + 15_000, 15_000);
    expect(test.recorder.getSessionId()).toBeNull();

    /* Killed: no stop(), no timers. Relaunched a minute later. */
    jest.clearAllTimers();
    const relaunchedAtUnixMs: number = test.nowUnixMs() + 60_000;
    const relaunched: MobileReplayRecorder = new MobileReplayRecorder({
      storage: test.storage,
      nativeViewTree: new FakeNativeViewTree(),
      appState: new FakeAppState(),
      now: (): number => {
        return relaunchedAtUnixMs;
      },
    });
    relaunched.setRootTag(101);
    expect(await relaunched.start(startOptions({ fetch: test.fetch }))).toBe(
      true,
    );

    expect(relaunched.getSessionId()).toEqual(expect.any(String));
    expect(relaunched.getSessionId()).not.toBe(endedSessionId);
    await relaunched.stop();
  });

  test("an error-triggered recorder drops its pre-roll at the pause, and an error while paused triggers nothing", async () => {
    const test: RecorderHarness = harness({
      captureTrigger: "OnErrorOrFrustration",
      samplePercentage: 0,
    });
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS);
    expect(test.recorder.getDiagnostics()).toMatchObject({
      status: "paused",
      pendingEvents: 0,
    });

    await test.recorder.captureError(new Error("background poll failed"));
    await flush();
    expect(test.posted).toHaveLength(0);
    expect(test.recorder.getDiagnostics().triggered).toBe(false);

    /*
     * Back well inside the pre-roll's own minute, so nothing from before
     * the pause would have aged out of it by itself.
     */
    await live(test, 30_000, 15_000);
    const resumedAtUnixMs: number = test.nowUnixMs();
    touchAt(test, 9, 9);
    await flush();
    await test.recorder.captureError(new Error("the user hit a real error"));
    await flush();

    expect(test.recorder.getDiagnostics().triggered).toBe(true);
    expect(test.posted.length).toBeGreaterThan(0);
    const uploaded: Array<RrwebEvent> = allEvents(test.posted);
    expect(describeEvent(uploaded[0]!)).toBe("meta");
    for (const event of uploaded) {
      expect(event.timestamp).toBeGreaterThanOrEqual(resumedAtUnixMs);
    }
    /* No pause was ever in an uploaded stream, so none is answered. */
    expect(eventsTagged(test.posted, IDLE_PAUSED_CUSTOM_EVENT_TAG)).toEqual([]);
    expect(eventsTagged(test.posted, IDLE_RESUMED_CUSTOM_EVENT_TAG)).toEqual(
      [],
    );
    await test.recorder.stop();
  });

  test("an identity change while paused ends the outgoing user's session at its pause, and the next user's starts with the next input", async () => {
    const test: RecorderHarness = harness({ captureUserIdentity: true });
    expect(
      await test.recorder.start(
        startOptions({ fetch: test.fetch, userRef: "alice@example.com" }),
      ),
    ).toBe(true);
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS);
    const pauseIndex: number = indexOfPostWith(
      test.posted,
      IDLE_PAUSED_CUSTOM_EVENT_TAG,
    );
    expect(pauseIndex).toBeGreaterThanOrEqual(0);
    const aliceSessionId: string | null = test.recorder.getSessionId();
    const capturesAtPause: number = test.native.captures;

    /* The app signs out the user who walked away. */
    test.recorder.identify("bob@example.com");
    await flush();

    expect(test.recorder.getSessionId()).toBeNull();
    expect(test.native.captures).toBe(capturesAtPause);
    const seal: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(seal.envelope).toMatchObject({
      sessionId: aliceSessionId,
      isFinal: true,
      chunkEndOffsetMs: PAUSED_AT_UNIX_MS - START_UNIX_MS,
    });
    expect(seal.events).toEqual([
      {
        type: RrwebEventType.Custom,
        timestamp: PAUSED_AT_UNIX_MS,
        data: {
          tag: SESSION_ROTATED_CUSTOM_EVENT_TAG,
          payload: { reason: "identity" },
        },
      },
    ]);

    /* Nobody here: no session of nobody for the new user meanwhile. */
    await live(test, 10 * 60_000, 15_000);
    expect(test.posted).toHaveLength(pauseIndex + 2);
    expect(test.native.captures).toBe(capturesAtPause);

    touchAt(test, 3, 4);
    await flush();
    const bobSessionId: string | null = test.recorder.getSessionId();
    expect(bobSessionId).toEqual(expect.any(String));
    expect(bobSessionId).not.toBe(aliceSessionId);
    await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);
    await test.recorder.stop();

    const bobPosts: Array<DecodedPost> = test.posted.filter(
      (post: DecodedPost): boolean => {
        return post.envelope["sessionId"] === bobSessionId;
      },
    );
    expect(bobPosts[0]?.envelope).toMatchObject({
      chunkIndex: 0,
      hasFullSnapshot: true,
      meta: expect.objectContaining({ identifiedUserRef: "bob@example.com" }),
    });
    const alicePosts: Array<DecodedPost> = test.posted.filter(
      (post: DecodedPost): boolean => {
        return post.envelope["sessionId"] === aliceSessionId;
      },
    );
    expect(alicePosts).toHaveLength(pauseIndex + 2);
    expect(JSON.stringify(alicePosts)).not.toContain("bob@example.com");
  });

  /*
   * captureSession() while paused, as in the browser recorder: an explicit
   * ask for this moment, so capture resumes at once - but it is not input,
   * so the next pause check pauses again if nobody is there.
   */
  test("captureSession() while paused resumes the same session at once - snapshot, resume marker, then its marker - and the next check pauses again", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    const pausePost: DecodedPost = test.posted[pauseIndex]!;
    await live(test, 2 * 60_000, 15_000);

    const capturedAtUnixMs: number = test.nowUnixMs();
    await test.recorder.captureSession("support-request");
    expect(test.recorder.getDiagnostics().status).toBe("recording");

    /* Not input: the next pause check finds nobody there. */
    await live(test, 500, 500);
    expect(test.recorder.getDiagnostics().status).toBe("paused");

    const capturePost: DecodedPost = test.posted[pauseIndex + 1]!;
    expect(capturePost.envelope).toMatchObject({
      sessionId: pausePost.envelope["sessionId"],
      tabId: pausePost.envelope["tabId"],
      chunkIndex: (pausePost.envelope["chunkIndex"] as number) + 1,
      hasFullSnapshot: true,
    });
    expect(capturePost.events.map(describeEvent)).toEqual([
      "meta",
      "full-snapshot",
      IDLE_RESUMED_CUSTOM_EVENT_TAG,
      CUSTOM_EVENT_TAG,
      IDLE_PAUSED_CUSTOM_EVENT_TAG,
    ]);
    expect(capturePost.events[1]?.timestamp).toBe(capturedAtUnixMs);
    expect(
      customPayload<SessionReplayIdleResumedPayload>(capturePost.events[2]!),
    ).toEqual({
      pausedAtUnixMs: PAUSED_AT_UNIX_MS,
      resumedAtUnixMs: capturedAtUnixMs,
    });
    expect(customPayload(capturePost.events[3]!)).toMatchObject({
      name: "oneuptime.capture",
    });
    /* The idle clock still runs from the person's last input: the start. */
    expect(
      customPayload<SessionReplayIdlePausedPayload>(capturePost.events[4]!),
    ).toEqual({
      idleSinceUnixMs: START_UNIX_MS,
      pausedAtUnixMs: capturedAtUnixMs + 500,
    });
    await test.recorder.stop();
  });

  test("captureSession() after the paused session ended starts the next session, and its marker lands in it", async () => {
    const test: RecorderHarness = harness();
    const pauseIndex: number = await startAndLeaveAlone(test);
    const endedSessionId: string | null = test.recorder.getSessionId();
    await live(test, ROLLOVER_AT_UNIX_MS - test.nowUnixMs() + 15_000, 15_000);
    expect(test.posted).toHaveLength(pauseIndex + 2);
    expect(test.recorder.getSessionId()).toBeNull();

    const capturedAtUnixMs: number = test.nowUnixMs();
    await test.recorder.captureSession("support-request");
    const nextSessionId: string | null = test.recorder.getSessionId();
    expect(nextSessionId).toEqual(expect.any(String));
    expect(nextSessionId).not.toBe(endedSessionId);
    await live(test, 500, 500);
    expect(test.recorder.getDiagnostics().status).toBe("paused");

    const nextPosts: Array<DecodedPost> = test.posted.filter(
      (post: DecodedPost): boolean => {
        return post.envelope["sessionId"] === nextSessionId;
      },
    );
    expect(nextPosts[0]?.envelope).toMatchObject({
      chunkIndex: 0,
      hasFullSnapshot: true,
    });
    expect(nextPosts[0]?.events.map(describeEvent)).toEqual([
      "meta",
      "full-snapshot",
      CUSTOM_EVENT_TAG,
      IDLE_PAUSED_CUSTOM_EVENT_TAG,
    ]);
    /* Nobody there before this session began: idle since it began. */
    expect(
      customPayload<SessionReplayIdlePausedPayload>(nextPosts[0]!.events[3]!),
    ).toEqual({
      idleSinceUnixMs: capturedAtUnixMs,
      pausedAtUnixMs: capturedAtUnixMs + 500,
    });
    expect(eventsTagged(nextPosts, IDLE_RESUMED_CUSTOM_EVENT_TAG)).toEqual([]);
    expect(
      test.posted.filter((post: DecodedPost): boolean => {
        return post.envelope["sessionId"] === endedSessionId;
      }),
    ).toHaveLength(pauseIndex + 2);
    await test.recorder.stop();
  });

  test("captureSession() on a paused error-triggered recorder starts the upload, opening on the snapshot it resumes on", async () => {
    const test: RecorderHarness = harness({
      captureTrigger: "OnErrorOrFrustration",
      samplePercentage: 0,
    });
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS);
    expect(test.recorder.getDiagnostics().status).toBe("paused");
    expect(test.posted).toHaveLength(0);
    await live(test, 30_000, 15_000);

    const capturedAtUnixMs: number = test.nowUnixMs();
    await test.recorder.captureSession("support-request");

    expect(test.recorder.getDiagnostics().triggered).toBe(true);
    expect(test.posted.length).toBeGreaterThan(0);
    const first: DecodedPost = test.posted[0]!;
    expect(first.envelope).toMatchObject({
      chunkIndex: 0,
      hasFullSnapshot: true,
      triggerReason: "manual",
    });
    expect(first.events.map(describeEvent)).toEqual([
      "meta",
      "full-snapshot",
      CUSTOM_EVENT_TAG,
    ]);
    expect(first.events[0]?.timestamp).toBe(capturedAtUnixMs);
    /* Nothing from before the pause: its pre-roll was dropped there. */
    for (const event of allEvents(test.posted)) {
      expect(event.timestamp).toBeGreaterThanOrEqual(capturedAtUnixMs);
    }
    /* That pause was never in an uploaded stream, so nothing answers it. */
    expect(eventsTagged(test.posted, IDLE_RESUMED_CUSTOM_EVENT_TAG)).toEqual(
      [],
    );

    /* Not input: it pauses again - and now that it uploads, says so. */
    await live(test, 500, 500);
    expect(test.recorder.getDiagnostics().status).toBe("paused");
    const markers: Array<RrwebEvent> = eventsTagged(
      test.posted,
      IDLE_PAUSED_CUSTOM_EVENT_TAG,
    );
    expect(markers).toHaveLength(1);
    expect(customPayload<SessionReplayIdlePausedPayload>(markers[0]!)).toEqual({
      idleSinceUnixMs: START_UNIX_MS,
      pausedAtUnixMs: capturedAtUnixMs + 500,
    });
    await test.recorder.stop();
  });

  /*
   * The soft keyboard: what is typed on it reaches no view the recorder
   * sees, so it stands in for the keystrokes.
   */
  test("someone typing with the soft keyboard up for ten minutes and more is never taken for nobody", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    await live(test, 60_000);
    test.keyboard.show();
    await flush();

    await live(test, 12 * 60_000);

    expect(test.recorder.getDiagnostics().status).toBe("recording");
    expect(eventsTagged(test.posted, IDLE_PAUSED_CUSTOM_EVENT_TAG)).toEqual([]);
    const capturesWhileTyping: number = test.native.captures;
    await live(test, 30_000);
    expect(test.native.captures).toBeGreaterThan(capturesWhileTyping);
    await test.recorder.stop();
  });

  test.each<[string, (keyboard: FakeKeyboard) => void]>([
    [
      "coming up",
      (keyboard: FakeKeyboard): void => {
        keyboard.show();
      },
    ],
    [
      "going away",
      (keyboard: FakeKeyboard): void => {
        keyboard.hide();
      },
    ],
  ])(
    "the soft keyboard %s is input: it resumes a paused recorder on a fresh snapshot",
    async (_label: string, change: (keyboard: FakeKeyboard) => void) => {
      const test: RecorderHarness = harness();
      const pauseIndex: number = await startAndLeaveAlone(test);
      const pausePost: DecodedPost = test.posted[pauseIndex]!;
      await live(test, 2 * 60_000, 15_000);

      const resumedAtUnixMs: number = test.nowUnixMs();
      change(test.keyboard);
      await flush();
      expect(test.recorder.getDiagnostics().status).toBe("recording");
      await live(test, SESSION_REPLAY_FLUSH_INTERVAL_MS, 500);

      const resumePost: DecodedPost = test.posted[pauseIndex + 1]!;
      expect(resumePost.envelope).toMatchObject({
        sessionId: pausePost.envelope["sessionId"],
        tabId: pausePost.envelope["tabId"],
        chunkIndex: (pausePost.envelope["chunkIndex"] as number) + 1,
        hasFullSnapshot: true,
      });
      expect(resumePost.events.slice(0, 3).map(describeEvent)).toEqual([
        "meta",
        "full-snapshot",
        IDLE_RESUMED_CUSTOM_EVENT_TAG,
      ]);
      expect(
        customPayload<SessionReplayIdleResumedPayload>(resumePost.events[2]!),
      ).toEqual({
        pausedAtUnixMs: PAUSED_AT_UNIX_MS,
        resumedAtUnixMs,
      });
      await test.recorder.stop();
    },
  );

  test("once the keyboard goes away, five minutes of nothing pauses as usual", async () => {
    const test: RecorderHarness = harness();
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    test.keyboard.show();
    await flush();
    await live(test, 8 * 60_000);

    const hiddenAtUnixMs: number = test.nowUnixMs();
    test.keyboard.hide();
    await flush();
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS - 5_000);
    expect(test.recorder.getDiagnostics().status).toBe("recording");
    await live(test, 5_000);

    expect(test.recorder.getDiagnostics().status).toBe("paused");
    const markers: Array<RrwebEvent> = eventsTagged(
      test.posted,
      IDLE_PAUSED_CUSTOM_EVENT_TAG,
    );
    expect(markers).toHaveLength(1);
    expect(customPayload<SessionReplayIdlePausedPayload>(markers[0]!)).toEqual({
      idleSinceUnixMs: hiddenAtUnixMs,
      pausedAtUnixMs: hiddenAtUnixMs + SESSION_REPLAY_IDLE_PAUSE_MS,
    });
    await test.recorder.stop();
  });

  test("a recording started with the keyboard already up does not pause until it goes away", async () => {
    const test: RecorderHarness = harness();
    test.keyboard.visible = true;
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    await live(test, 7 * 60_000);
    expect(test.recorder.getDiagnostics().status).toBe("recording");

    test.keyboard.hide();
    await flush();
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS);
    expect(test.recorder.getDiagnostics().status).toBe("paused");
    await test.recorder.stop();
  });

  test("listens to the keyboard only while recording: stopping removes its listeners", async () => {
    const test: RecorderHarness = harness();
    expect(test.keyboard.listenerCount()).toBe(0);
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    expect(test.keyboard.listenerCount()).toBe(2);

    await test.recorder.stop();
    expect(test.keyboard.listenerCount()).toBe(0);
    const postsAfterStop: number = test.posted.length;
    expect((): void => {
      test.keyboard.show();
    }).not.toThrow();
    await flush();
    expect(test.posted).toHaveLength(postsAfterStop);

    /* A restart listens again, once; a withdrawal of consent stops it too. */
    await test.recorder.start(startOptions({ fetch: test.fetch }));
    expect(test.keyboard.listenerCount()).toBe(2);
    await test.recorder.revokeConsent();
    expect(test.keyboard.listenerCount()).toBe(0);
  });

  test("listens to React Native's own Keyboard module by default", async () => {
    const reactNative: {
      Keyboard: { addListener: jest.Mock };
    } = jest.requireMock("react-native");
    const test: RecorderHarness = harness();
    const recorder: MobileReplayRecorder = new MobileReplayRecorder({
      storage: test.storage,
      nativeViewTree: test.native,
      appState: test.appState,
      now: (): number => {
        return test.nowUnixMs();
      },
    });
    recorder.setRootTag(101);
    expect(await recorder.start(startOptions({ fetch: test.fetch }))).toBe(
      true,
    );

    expect(reactNative.Keyboard.addListener).toHaveBeenCalledWith(
      "keyboardDidShow",
      expect.any(Function),
    );
    expect(reactNative.Keyboard.addListener).toHaveBeenCalledWith(
      "keyboardDidHide",
      expect.any(Function),
    );
    await recorder.stop();
    for (const result of reactNative.Keyboard.addListener.mock.results) {
      expect(
        (result.value as { remove: jest.Mock }).remove,
      ).toHaveBeenCalledTimes(1);
    }
  });

  test("a keyboard module that cannot be observed costs only the typing signal", async () => {
    const test: RecorderHarness = harness(
      {},
      {
        keyboard: {
          addListener(): { remove(): void } {
            throw new Error("Keyboard is not linked");
          },
          isVisible(): boolean {
            throw new Error("Keyboard is not linked");
          },
        },
      },
    );
    expect(await test.recorder.start(startOptions({ fetch: test.fetch }))).toBe(
      true,
    );
    expect(diagnosticCodes(test.recorder)).toContain(
      "keyboard-subscribe-failed",
    );
    await live(test, SESSION_REPLAY_IDLE_PAUSE_MS);
    expect(test.recorder.getDiagnostics().status).toBe("paused");
    await test.recorder.stop();
  });
});
