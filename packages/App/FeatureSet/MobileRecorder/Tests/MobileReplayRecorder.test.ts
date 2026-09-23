import { gunzipSync, strFromU8 } from "fflate";
import {
  ERROR_CUSTOM_EVENT_TAG,
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  MOBILE_RECORDER_KIND,
  RrwebEvent,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SessionReplayChunkEnvelope,
  SessionReplayFidelityNotice,
  SessionReplayMaskingMode,
} from "../src/Contract";
import {
  ReplayFetch,
  validateStartOptions,
  ValidatedStartOptions,
} from "../src/Config";
import MobileReplayRecorder, {
  getReplayStorageNamespace,
  MobileReplayDiagnosticEvent,
  MOBILE_POLICY_REFRESH_INTERVAL_MS,
} from "../src/MobileReplayRecorder";
import ReplayOutbox, { frameId } from "../src/Outbox";
import {
  enabledConfig,
  envelope,
  FakeAppState,
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
  advance(milliseconds: number): void;
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
  return {
    recorder,
    fetch,
    posted,
    storage,
    native,
    appState,
    advance(milliseconds: number): void {
      now += milliseconds;
    },
  };
}

function allEvents(posts: Array<DecodedPost>): Array<RrwebEvent> {
  return posts.flatMap((post: DecodedPost): Array<RrwebEvent> => {
    return post.events;
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
