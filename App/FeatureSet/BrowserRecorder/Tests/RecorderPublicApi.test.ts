import {
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_TRAIT_KEYS,
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { RecorderInitOptions } from "../src/Config";

/*
 * The public API, as a host page sees it through window.OneUptimeReplay and
 * the pre-load command queue: identify with traits, track, tags, the
 * capture reason, onSessionChange, and a getDiagnostics() that answers every
 * gate instead of only "is a recorder object around".
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "tok",
  appIdentifier: "app-1",
  respectDoNotTrack: true,
};

const SESSION_KEY: string = "oneuptime.replay.session";

function baseConfig(): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    consentMode: SessionReplayConsentMode.NotRequired,
    samplePercentage: 0,
    maskSelectors: [],
    blockSelectors: [],
    urlAllowlist: [],
    ignoreErrorPatterns: [],
    recordCanvas: false,
    captureUserIdentity: false,
    respectDoNotTrack: true,
    configEpoch: 1,
    directive: "continue",
  };
}

interface CapturedPost {
  envelope: SessionReplayChunkEnvelope;
  payload: string;
  body: string;
}

function readPost(call: Array<unknown>): CapturedPost {
  const init: Record<string, unknown> = call[1] as Record<string, unknown>;
  const text: string = new TextDecoder().decode(init["body"] as Uint8Array);
  const newline: number = text.indexOf("\n");

  return {
    envelope: JSON.parse(text.slice(0, newline)) as SessionReplayChunkEnvelope,
    payload: text.slice(newline + 1),
    body: text,
  };
}

describe("Recorder public API", (): void => {
  let fetchMock: jest.Mock;

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "<div id='app'><p>content</p></div>";

    delete globalRecord["CompressionStream"];
    delete globalRecord["__ONEUPTIME_SESSION_REPLAY_STARTED__"];
    delete globalRecord["OneUptimeReplayQueue"];

    fetchMock = jest.fn().mockResolvedValue({
      status: 202,
      headers: {
        get: (): string | null => {
          return null;
        },
      },
      text: async (): Promise<string> => {
        return "";
      },
    });

    globalRecord["fetch"] = fetchMock;
    (window as unknown as Record<string, unknown>)["fetch"] = fetchMock;
  });

  afterEach((): void => {
    delete globalRecord["__ONEUPTIME_SESSION_REPLAY_STARTED__"];
    delete globalRecord["OneUptimeReplayQueue"];
    jest.restoreAllMocks();
  });

  const importIndex: () => Promise<
    typeof import("../src/Index")
  > = async (): Promise<typeof import("../src/Index")> => {
    jest.resetModules();
    return await import("../src/Index");
  };

  const tick: () => Promise<void> = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  };

  const posts: () => Array<CapturedPost> = (): Array<CapturedPost> => {
    return fetchMock.mock.calls.map((call: Array<unknown>): CapturedPost => {
      return readPost(call);
    });
  };

  const allBytes: () => string = (): string => {
    return posts()
      .map((post: CapturedPost): string => {
        return post.body;
      })
      .join("");
  };

  const hidePage: () => void = (): void => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): string => {
        return "hidden";
      },
    });

    document.dispatchEvent(new Event("visibilitychange"));
  };

  describe("the command queue", (): void => {
    it("applies queued identify (with traits), setTags and addTag before chunk 0", async (): Promise<void> => {
      globalRecord["OneUptimeReplayQueue"] = [
        ["identify", "user-42", { plan: "pro", seats: 3 }],
        ["setTags", { build: "9" }],
        ["addTag", "arm", "b"],
      ];

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, {
        ...baseConfig(),
        samplePercentage: 100,
        captureUserIdentity: true,
      });

      await tick();
      await tick();

      const first: CapturedPost | undefined = posts()[0];

      expect(first?.envelope.chunkIndex).toBe(0);
      expect(first?.envelope.meta?.identifiedUserRef).toBe("user-42");
      expect(first?.envelope.meta?.identifiedUserTraits).toEqual({
        plan: "pro",
        seats: "3",
      });
      expect(first?.envelope.meta?.tags).toEqual({ build: "9", arm: "b" });
      expect(index.getDiagnostics().hasTraits).toBe(true);
      expect(index.getDiagnostics().tags).toEqual({ build: "9", arm: "b" });

      /* Consumed, not left for a second drain. */
      expect(globalRecord["OneUptimeReplayQueue"]).toEqual([]);

      index.stop();
    });

    it("runs queued track and captureSession(reason) after start, never before", async (): Promise<void> => {
      globalRecord["OneUptimeReplayQueue"] = [
        ["track", "checkout_started", { step: 1 }],
        ["captureSession", "support ticket 4711"],
      ];

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig());

      await tick();
      await tick();

      /* captureSession is the trigger; nothing else would upload at 0%. */
      expect(fetchMock).toHaveBeenCalled();
      expect(index.getDiagnostics().triggerReason).toBe(
        SessionReplayTriggerReason.Manual,
      );

      hidePage();
      await tick();

      const bytes: string = allBytes();

      expect(bytes).toContain('"name":"checkout_started"');
      expect(bytes).toContain('"step":"1"');
      expect(bytes).toContain('"name":"captureSession"');
      expect(bytes).toContain("support ticket 4711");

      index.stop();
    });

    it("hands a queued onSessionChange callback the session after bootstrap", async (): Promise<void> => {
      const seen: Array<string> = [];

      globalRecord["OneUptimeReplayQueue"] = [
        [
          "onSessionChange",
          (sessionId: string): void => {
            seen.push(sessionId);
          },
        ],
      ];

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig());

      expect(seen).toEqual([index.getSessionId()]);

      index.stop();
    });

    it("drops a malformed identify rather than throwing", async (): Promise<void> => {
      globalRecord["OneUptimeReplayQueue"] = [["identify", 42], ["track"]];

      const index: typeof import("../src/Index") = await importIndex();

      expect((): void => {
        index.bootstrap(INIT_OPTIONS, baseConfig());
      }).not.toThrow();

      expect(index.getDiagnostics().hasTraits).toBe(false);

      index.stop();
    });
  });

  describe("identify and track", (): void => {
    it("caps traits at the shared limit and stringifies scalar values only", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, {
        ...baseConfig(),
        samplePercentage: 100,
        captureUserIdentity: true,
      });

      const traits: Record<string, string | number | boolean> = {};

      for (let i: number = 0; i < SESSION_REPLAY_MAX_TRAIT_KEYS + 5; i++) {
        traits[`key${i}`] = i;
      }

      traits["nested"] = {
        secret: "x",
      } as unknown as string;

      await tick();
      fetchMock.mockClear();

      index.identify("user-42", { flag: true, count: 7, ...traits });

      document.body.appendChild(document.createElement("span"));
      await tick();
      hidePage();
      await tick();

      const withMeta: CapturedPost | undefined = posts().find(
        (post: CapturedPost): boolean => {
          return post.envelope.meta !== undefined;
        },
      );

      const sent: Record<string, string> | undefined =
        withMeta?.envelope.meta?.identifiedUserTraits;

      expect(sent).toBeDefined();
      expect(Object.keys(sent || {})).toHaveLength(
        SESSION_REPLAY_MAX_TRAIT_KEYS,
      );
      expect(sent?.["flag"]).toBe("true");
      expect(sent?.["count"]).toBe("7");
      expect(sent?.["nested"]).toBeUndefined();
      expect(allBytes()).not.toContain("secret");

      index.stop();
    });

    it("keeps traits on the page when identity capture is off", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, {
        ...baseConfig(),
        samplePercentage: 100,
        captureUserIdentity: false,
      });

      index.identify("user-42", { email: "alice@example.com" });

      await tick();
      document.body.appendChild(document.createElement("span"));
      await tick();
      hidePage();
      await tick();

      expect(fetchMock).toHaveBeenCalled();
      expect(allBytes()).not.toContain("user-42");
      expect(allBytes()).not.toContain("alice@example.com");

      /* The page still knows it identified someone. */
      expect(index.getDiagnostics().hasTraits).toBe(true);

      index.stop();
    });

    it("ignores an empty reference", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, {
        ...baseConfig(),
        captureUserIdentity: true,
      });

      index.identify("", { plan: "pro" });

      expect(index.getDiagnostics().hasTraits).toBe(false);

      index.stop();
    });

    it("caps a track() name and its property keys", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, { ...baseConfig(), samplePercentage: 100 });

      await tick();

      const properties: Record<string, string> = {};

      for (let i: number = 0; i < 30; i++) {
        properties[`p${i}`] = "v";
      }

      index.track("x".repeat(100), properties);

      hidePage();
      await tick();

      const bytes: string = allBytes();

      expect(bytes).toContain(`"name":"${"x".repeat(64)}"`);
      expect(bytes).not.toContain("x".repeat(65));
      expect(bytes).toContain('"p19"');
      expect(bytes).not.toContain('"p20"');

      index.stop();
    });
  });

  describe("tags", (): void => {
    it("setTags replaces, addTag merges, and each change is disclosed in-band", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, { ...baseConfig(), samplePercentage: 100 });

      await tick();

      index.setTags({ build: "1", arm: "a" });
      index.addTag("arm", "b");
      index.setTags({ build: "2" });

      expect(index.getDiagnostics().tags).toEqual({ build: "2" });

      hidePage();
      await tick();

      const bytes: string = allBytes();

      expect(bytes).toContain('"oneuptime.tags"');
      expect(bytes).toContain('"arm":"b"');
      expect(bytes).toContain('"build":"2"');

      const withTags: CapturedPost | undefined = posts()
        .reverse()
        .find((post: CapturedPost): boolean => {
          return post.envelope.meta?.tags !== undefined;
        });

      expect(withTags?.envelope.meta?.tags).toEqual({ build: "2" });

      index.stop();
    });

    it("caps tags at the shared limits and ignores a no-op", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig());

      index.setTags({ ["k".repeat(50)]: "v".repeat(200) });

      const tags: Record<string, string> = index.getDiagnostics().tags;
      const key: string = Object.keys(tags)[0] as string;

      expect(key.length).toBe(32);
      expect(tags[key]?.length).toBe(128);

      index.addTag("", "ignored");

      expect(Object.keys(index.getDiagnostics().tags)).toHaveLength(1);

      index.stop();
    });
  });

  describe("onSessionChange", (): void => {
    it("fires immediately, again on rotation, and stops after unsubscribe", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, { ...baseConfig(), samplePercentage: 100 });

      const firstSessionId: string = index.getSessionId() as string;
      const seen: Array<string> = [];
      const alsoSeen: Array<string> = [];

      const unsubscribe: () => void = index.onSessionChange(
        (sessionId: string, tabId: string): void => {
          seen.push(sessionId);
          expect(tabId).toBe(index.getDiagnostics().tabId);
        },
      );

      index.onSessionChange((sessionId: string): void => {
        alsoSeen.push(sessionId);
      });

      expect(seen).toEqual([firstSessionId]);

      unsubscribe();

      /* Another tab rotated the session; the storage event says so. */
      const siblingSessionId: string = "d".repeat(32);

      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          sessionId: siblingSessionId,
          sessionStartUnixMs: Date.now() - 1000,
          lastActivityUnixMs: Date.now(),
        }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: SESSION_KEY, newValue: "x" }),
      );

      expect(index.getSessionId()).toBe(siblingSessionId);
      expect(seen).toEqual([firstSessionId]);
      expect(alsoSeen).toEqual([firstSessionId, siblingSessionId]);

      index.stop();
    });

    it("fires on an idle rollover", async (): Promise<void> => {
      jest.useFakeTimers();

      try {
        const index: typeof import("../src/Index") = await importIndex();

        index.bootstrap(INIT_OPTIONS, {
          ...baseConfig(),
          samplePercentage: 100,
        });

        const firstSessionId: string = index.getSessionId() as string;
        const seen: Array<string> = [];

        index.onSessionChange((sessionId: string): void => {
          seen.push(sessionId);
        });

        const idleSince: number = Date.now() - SESSION_REPLAY_IDLE_ROLLOVER_MS;

        window.localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            sessionId: firstSessionId,
            sessionStartUnixMs: idleSince,
            lastActivityUnixMs: idleSince,
          }),
        );

        jest.advanceTimersByTime(20_000);

        expect(seen).toHaveLength(2);
        expect(seen[1]).toBe(index.getSessionId());
        expect(seen[1]).not.toBe(firstSessionId);

        index.stop();
      } finally {
        jest.useRealTimers();
      }
    });

    it("returns an inert unsubscribe for a non-function", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      expect((): void => {
        index.onSessionChange(null as unknown as () => void)();
      }).not.toThrow();
    });
  });

  describe("getDiagnostics", (): void => {
    it("says not-sampled, and is not recording, when the draw excluded the session", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, {
        ...baseConfig(),
        captureTrigger: SessionReplayCaptureTrigger.Always,
        samplePercentage: 0,
      });

      const diagnostics: ReturnType<typeof index.getDiagnostics> =
        index.getDiagnostics();

      expect(diagnostics.isRecording).toBe(false);
      expect(diagnostics.state).toBe("not-sampled");
      expect(diagnostics.bootstrapDecision).toBe("started");
      expect(diagnostics.decisions?.startDecision).toBe("not-sampled");
      expect(diagnostics.decisions?.isSampled).toBe(false);
      expect(diagnostics.decisions?.captureTrigger).toBe("Always");

      /*
       * The id is still reported: sampling is deterministic in it, so it
       * is exactly what support needs to confirm the draw - while the
       * public getSessionId() answers null for a recorder that never ran.
       */
      expect(typeof diagnostics.sessionId).toBe("string");
      expect(index.getSessionId()).toBeNull();

      index.stop();
    });

    it("names consent as the closed gate, and clears it on grant", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, {
        ...baseConfig(),
        consentMode: SessionReplayConsentMode.RequireExplicit,
        samplePercentage: 100,
      });

      let diagnostics: ReturnType<typeof index.getDiagnostics> =
        index.getDiagnostics();

      expect(diagnostics.isRecording).toBe(true);
      expect(diagnostics.state).toBe("recording");
      expect(diagnostics.isUploading).toBe(false);
      expect(diagnostics.decisions?.startDecision).toBe(
        "recording-into-memory",
      );
      expect(diagnostics.decisions?.uploadsAllowed).toBe(false);
      expect(diagnostics.decisions?.uploadBlockedBy).toBe("consent");
      expect(diagnostics.decisions?.consentMode).toBe("RequireExplicit");
      expect(diagnostics.decisions?.consentState).toBe("Unknown");

      index.grantConsent();

      diagnostics = index.getDiagnostics();

      expect(diagnostics.state).toBe("uploading");
      expect(diagnostics.decisions?.uploadsAllowed).toBe(true);
      expect(diagnostics.decisions?.uploadBlockedBy).toBeNull();
      expect(diagnostics.decisions?.consentState).toBe("Granted");

      index.stop();
    });

    /* recorder-core-14: a stopped recorder used to report isRecording: true. */
    it("stops saying it is recording once the server says stop", async (): Promise<void> => {
      fetchMock.mockResolvedValue({
        status: 204,
        headers: {
          get: (): string | null => {
            return null;
          },
        },
        text: async (): Promise<string> => {
          return '{"directive":"stop","reason":"app-disabled"}';
        },
      });

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, { ...baseConfig(), samplePercentage: 100 });

      expect(index.getDiagnostics().isRecording).toBe(true);

      await tick();
      await tick();

      const diagnostics: ReturnType<typeof index.getDiagnostics> =
        index.getDiagnostics();

      expect(diagnostics.isRecording).toBe(false);
      expect(diagnostics.state).toBe("stopped");
      expect(diagnostics.stopReason).toBe("server-directive");
      expect(diagnostics.decisions?.lastDirective).toBe("stop");
      expect(diagnostics.decisions?.lastDirectiveReason).toBe("app-disabled");
      expect(diagnostics.decisions?.uploadsAllowed).toBe(false);
      expect(index.getSessionId()).toBeNull();

      index.stop();
    });

    it("reports the bootstrap decision for a privacy signal", async (): Promise<void> => {
      Object.defineProperty(window.navigator, "globalPrivacyControl", {
        configurable: true,
        value: true,
      });

      try {
        const index: typeof import("../src/Index") = await importIndex();

        index.bootstrap(INIT_OPTIONS, baseConfig());

        const diagnostics: ReturnType<typeof index.getDiagnostics> =
          index.getDiagnostics();

        expect(diagnostics.bootstrapDecision).toBe("privacy-signal");
        expect(diagnostics.state).toBe("none");
        expect(diagnostics.decisions).toBeNull();
        expect(diagnostics.capabilities).toEqual([]);
      } finally {
        Object.defineProperty(window.navigator, "globalPrivacyControl", {
          configurable: true,
          value: false,
        });
      }
    });

    /*
     * recorder-signals-22, on the artifact's own entry path: a page that
     * says nothing about Do Not Track defers to the server policy. bootstrap
     * used to collapse that silence into "true" before Consent saw it, so a
     * policy that does not honour the signal could never take effect.
     */
    it("starts when the page is silent on DNT and the policy does not honour the signal", async (): Promise<void> => {
      Object.defineProperty(window.navigator, "globalPrivacyControl", {
        configurable: true,
        value: true,
      });

      try {
        const index: typeof import("../src/Index") = await importIndex();

        const silentOptions: RecorderInitOptions = {
          host: INIT_OPTIONS.host,
          token: INIT_OPTIONS.token,
          appIdentifier: INIT_OPTIONS.appIdentifier,
        };

        index.bootstrap(silentOptions, {
          ...baseConfig(),
          respectDoNotTrack: false,
        });

        const diagnostics: ReturnType<typeof index.getDiagnostics> =
          index.getDiagnostics();

        expect(diagnostics.bootstrapDecision).toBe("started");
        expect(diagnostics.isRecording).toBe(true);

        index.stop();
      } finally {
        Object.defineProperty(window.navigator, "globalPrivacyControl", {
          configurable: true,
          value: false,
        });
      }
    });

    it("lists the capabilities this build advertises", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig());

      expect(index.getDiagnostics().capabilities).toEqual(
        expect.arrayContaining([
          "click-events",
          "web-vitals",
          "custom-events",
          "traits",
          "tags",
          "visibility",
        ]),
      );

      index.stop();
    });
  });

  describe("consent round trip", (): void => {
    it("keeps the recorder across revoke so a later grant continues on a fresh session", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, { ...baseConfig(), samplePercentage: 100 });

      const firstSessionId: string = index.getSessionId() as string;

      await tick();

      index.revokeConsent();

      expect(index.getDiagnostics().isRecording).toBe(true);
      expect(index.getDiagnostics().isUploading).toBe(false);
      expect(index.getDiagnostics().decisions?.uploadBlockedBy).toBe("consent");
      expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();

      fetchMock.mockClear();

      index.grantConsent();

      await tick();
      await tick();

      const secondSessionId: string = index.getSessionId() as string;

      expect(secondSessionId).not.toBe(firstSessionId);
      expect(index.getDiagnostics().isUploading).toBe(true);

      const first: CapturedPost | undefined = posts()[0];

      expect(first?.envelope.sessionId).toBe(secondSessionId);
      expect(first?.envelope.chunkIndex).toBe(0);
      expect(first?.envelope.hasFullSnapshot).toBe(true);

      index.stop();
    });
  });
});
