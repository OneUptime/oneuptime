import {
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { RecorderInitOptions } from "../src/Config";
import Recorder from "../src/Recorder";
import SessionId from "../src/SessionId";
import Transport from "../src/Transport";

/*
 * jsdom gives real localStorage, sessionStorage, history and a real DOM, so
 * these run rrweb for real rather than against a double.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

const baseConfig: () => SessionReplayConfigResponse =
  (): SessionReplayConfigResponse => {
    return {
      enabled: true,
      recorderVersion: "11.7.3",
      maskingMode: SessionReplayMaskingMode.MaskAllText,
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
  };

interface CapturedPost {
  url: string;
  init: Record<string, unknown>;
  envelope: SessionReplayChunkEnvelope;
  payload: string;
}

/*
 * The non-terminal upload path awaits compression before it calls fetch, so
 * every assertion about a POST has to let the microtask queue drain first.
 * The terminal path is synchronous on purpose and needs none of this.
 */
async function flushUploads(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

function readPost(call: Array<unknown>): CapturedPost {
  const init: Record<string, unknown> = call[1] as Record<string, unknown>;
  const body: Uint8Array = init["body"] as Uint8Array;
  const text: string = new TextDecoder().decode(body);
  const newline: number = text.indexOf("\n");

  return {
    url: call[0] as string,
    init: init,
    envelope: JSON.parse(text.slice(0, newline)) as SessionReplayChunkEnvelope,
    payload: text.slice(newline + 1),
  };
}

describe("Recorder", (): void => {
  let fetchMock: jest.Mock;
  let recorder: Recorder | null = null;

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "<div id='app'><p>content</p></div>";

    /*
     * CompressionStream is removed so the non-terminal upload path is
     * synchronous enough to assert on. The gzip branch has its own coverage
     * in Transport.test.ts.
     */
    delete (globalThis as unknown as Record<string, unknown>)[
      "CompressionStream"
    ];

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

    (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;
    (window as unknown as Record<string, unknown>)["fetch"] = fetchMock;
  });

  afterEach((): void => {
    if (recorder) {
      recorder.stop();
      recorder = null;
    }

    jest.restoreAllMocks();
  });

  const startRecorder: (
    overrides?: Partial<SessionReplayConfigResponse>,
  ) => Recorder = (
    overrides?: Partial<SessionReplayConfigResponse>,
  ): Recorder => {
    const instance: Recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: { ...baseConfig(), ...overrides },
    });

    instance.start();
    recorder = instance;

    return instance;
  };

  /*
   * THE bfcache rule. Registering unload or beforeunload disqualifies the
   * customer's page from the back/forward cache - a RUM vendor measurably
   * degrading its own customer's Core Web Vitals to collect data about them.
   */
  describe("bfcache safety", (): void => {
    it("never registers unload or beforeunload at runtime", (): void => {
      const windowSpy: jest.SpyInstance = jest.spyOn(
        window,
        "addEventListener",
      );
      const documentSpy: jest.SpyInstance = jest.spyOn(
        document,
        "addEventListener",
      );

      startRecorder();

      const registered: Array<string> = [
        ...windowSpy.mock.calls,
        ...documentSpy.mock.calls,
      ].map((call: Array<unknown>): string => {
        return String(call[0]);
      });

      expect(registered).not.toContain("unload");
      expect(registered).not.toContain("beforeunload");
      expect(registered).toContain("pagehide");
      expect(registered).toContain("visibilitychange");
    });
  });

  describe("triggers", (): void => {
    it("uploads nothing until something goes wrong", (): void => {
      const instance: Recorder = startRecorder();

      expect(instance.isUploading()).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uploads the pre-roll when an uncaught error fires", async (): Promise<void> => {
      const instance: Recorder = startRecorder();

      window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));

      expect(instance.isUploading()).toBe(true);
      expect(instance.getTriggerReason()).toBe(
        SessionReplayTriggerReason.Error,
      );

      await flushUploads();

      expect(fetchMock).toHaveBeenCalled();

      /* The pre-roll opens with a full snapshot, so it is replayable. */
      expect(
        readPost(fetchMock.mock.calls[0] as Array<unknown>).envelope
          .hasFullSnapshot,
      ).toBe(true);
    });

    /*
     * The 15x storage/privacy bet: one chronically-throwing third-party
     * tag must not convert error-triggered capture into always-on upload.
     */
    it("does not upload over stackless cross-origin 'Script error.' noise", (): void => {
      const instance: Recorder = startRecorder();

      window.dispatchEvent(
        new ErrorEvent("error", { message: "Script error." }),
      );

      expect(instance.isUploading()).toBe(false);
      expect(instance.getTriggerReason()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not upload over a pattern-ignored error, but a genuine one still triggers", (): void => {
      const instance: Recorder = startRecorder({
        ignoreErrorPatterns: ["third-party-tag\\.js"],
      });

      window.dispatchEvent(
        new ErrorEvent("error", {
          message: "boom",
          filename: "https://cdn.example.net/third-party-tag.js",
        }),
      );

      expect(instance.isUploading()).toBe(false);

      window.dispatchEvent(
        new ErrorEvent("error", {
          message: "genuine failure",
          filename: "https://shop.example.com/app.js",
        }),
      );

      expect(instance.isUploading()).toBe(true);
      expect(instance.getTriggerReason()).toBe(
        SessionReplayTriggerReason.Error,
      );
    });

    /*
     * A startup crash caught by the loader stub's pre-load buffer must
     * trigger capture once the recorder starts — that window used to be
     * a void.
     */
    it("a replayed early error triggers the upload at start", (): void => {
      const instance: Recorder = new Recorder({
        initOptions: INIT_OPTIONS,
        config: baseConfig(),
        earlyErrors: [
          {
            kind: "error",
            message: "boom during startup",
            source: "https://shop.example.com/app.js",
            atUnixMs: Date.now() - 3000,
          },
        ],
      });

      instance.start();
      recorder = instance;

      expect(instance.isUploading()).toBe(true);
      expect(instance.getTriggerReason()).toBe(
        SessionReplayTriggerReason.Error,
      );
    });

    it("a replayed early 'Script error.' stays noise, exactly like a live one", (): void => {
      const instance: Recorder = new Recorder({
        initOptions: INIT_OPTIONS,
        config: baseConfig(),
        earlyErrors: [
          {
            kind: "error",
            message: "Script error.",
            atUnixMs: Date.now() - 3000,
          },
        ],
      });

      instance.start();
      recorder = instance;

      expect(instance.isUploading()).toBe(false);
      expect(instance.getTriggerReason()).toBeNull();
    });

    it("uploads on an explicit captureSession call", (): void => {
      const instance: Recorder = startRecorder();

      instance.trigger(SessionReplayTriggerReason.Manual);

      expect(instance.isUploading()).toBe(true);
      expect(instance.getTriggerReason()).toBe(
        SessionReplayTriggerReason.Manual,
      );
    });

    it("uploads immediately when the session falls in the sample", (): void => {
      const instance: Recorder = startRecorder({ samplePercentage: 100 });

      expect(instance.isUploading()).toBe(true);
      expect(instance.getTriggerReason()).toBe(
        SessionReplayTriggerReason.Sampled,
      );
    });

    it("keeps the first trigger reason when a second fires", (): void => {
      const instance: Recorder = startRecorder();

      instance.trigger(SessionReplayTriggerReason.Frustration);
      instance.trigger(SessionReplayTriggerReason.Error);

      expect(instance.getTriggerReason()).toBe(
        SessionReplayTriggerReason.Frustration,
      );
    });

    /*
     * In Always mode the sample percentage is the only reachable trigger, so
     * an unsampled session records nothing at all - cheaper for the page, and
     * no buffer of end-user content to leak.
     */
    it("does not record at all in Always mode when unsampled", (): void => {
      const instance: Recorder = startRecorder({
        captureTrigger: SessionReplayCaptureTrigger.Always,
        samplePercentage: 0,
      });

      instance.trigger(SessionReplayTriggerReason.Error);

      expect(instance.isUploading()).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("consent", (): void => {
    it("records but uploads nothing until consent is granted", async (): Promise<void> => {
      const instance: Recorder = startRecorder({
        consentMode: SessionReplayConsentMode.RequireExplicit,
      });

      instance.trigger(SessionReplayTriggerReason.Manual);

      await flushUploads();

      expect(instance.isUploading()).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();

      instance.grantConsent();

      await flushUploads();

      expect(instance.isUploading()).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
      expect(
        readPost(fetchMock.mock.calls[0] as Array<unknown>).envelope
          .consentState,
      ).toBe("Granted");
    });

    it("drops the buffer and the identity on revoke", (): void => {
      const instance: Recorder = startRecorder({
        consentMode: SessionReplayConsentMode.RequireExplicit,
      });

      instance.trigger(SessionReplayTriggerReason.Manual);
      instance.revokeConsent();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(window.localStorage.length).toBe(0);
    });
  });

  describe("envelope", (): void => {
    it("carries identity, versions and policy for the ingest gate", async (): Promise<void> => {
      const instance: Recorder = startRecorder({ samplePercentage: 100 });

      await flushUploads();

      const post: CapturedPost = readPost(
        fetchMock.mock.calls[0] as Array<unknown>,
      );

      expect(post.url).toBe(
        "https://oneuptime.com/telemetry/session-replay/v1/chunk",
      );
      expect(post.envelope.v).toBe(1);
      expect(post.envelope.appIdentifier).toBe("app-1");
      expect(post.envelope.sessionId).toBe(instance.getSessionId());
      expect(post.envelope.tabId).toBe(instance.getTabId());
      expect(post.envelope.chunkIndex).toBe(0);
      expect(post.envelope.rrwebVersion).toBe("2.1.1");
      expect(post.envelope.recorderKind).toBe("dom");
      expect(post.envelope.maskingMode).toBe(
        SessionReplayMaskingMode.MaskAllText,
      );
    });

    it("puts device metadata on chunk 0 only", async (): Promise<void> => {
      startRecorder({ samplePercentage: 100 });

      await flushUploads();

      const post: CapturedPost = readPost(
        fetchMock.mock.calls[0] as Array<unknown>,
      );

      expect(post.envelope.meta).toBeDefined();
      expect(post.envelope.meta?.viewportWidth).toBeGreaterThan(0);
    });

    /*
     * The raw user reference is only ever sent when the application has
     * identity capture switched on; otherwise the server never receives it.
     */
    it("omits the user reference unless identity capture is enabled", async (): Promise<void> => {
      const withUser: Recorder = new Recorder({
        initOptions: { ...INIT_OPTIONS, userRef: "user-42" },
        config: { ...baseConfig(), samplePercentage: 100 },
      });

      withUser.start();
      recorder = withUser;

      await flushUploads();

      const post: CapturedPost = readPost(
        fetchMock.mock.calls[0] as Array<unknown>,
      );

      expect(post.envelope.meta?.identifiedUserRef).toBeUndefined();
    });

    it("includes the user reference when identity capture is enabled", async (): Promise<void> => {
      const withUser: Recorder = new Recorder({
        initOptions: { ...INIT_OPTIONS, userRef: "user-42" },
        config: {
          ...baseConfig(),
          samplePercentage: 100,
          captureUserIdentity: true,
        },
      });

      withUser.start();
      recorder = withUser;

      await flushUploads();

      const post: CapturedPost = readPost(
        fetchMock.mock.calls[0] as Array<unknown>,
      );

      expect(post.envelope.meta?.identifiedUserRef).toBe("user-42");
    });

    it("reports a scrubbed url, never a query string", async (): Promise<void> => {
      window.history.replaceState({}, "", "/reset?token=secret-value");

      startRecorder({ samplePercentage: 100 });

      await flushUploads();

      const post: CapturedPost = readPost(
        fetchMock.mock.calls[0] as Array<unknown>,
      );

      expect(post.envelope.url).not.toContain("secret-value");
      expect(post.envelope.meta?.entryUrl).not.toContain("secret-value");
    });
  });

  describe("terminal flush", (): void => {
    it("sends a final keepalive chunk when the page is hidden", (): void => {
      startRecorder({ samplePercentage: 100 });

      fetchMock.mockClear();

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: (): string => {
          return "hidden";
        },
      });

      document.dispatchEvent(new Event("visibilitychange"));

      const finalCalls: Array<Array<unknown>> = fetchMock.mock.calls.filter(
        (call: Array<unknown>): boolean => {
          return (call[1] as Record<string, unknown>)["keepalive"] === true;
        },
      );

      expect(finalCalls.length).toBeGreaterThan(0);
      expect(readPost(finalCalls[0] as Array<unknown>).envelope.isFinal).toBe(
        true,
      );
    });

    /*
     * persisted === true means the page is going into the bfcache and may come
     * back with its state intact. Sealing it would orphan a session the user
     * is about to resume.
     */
    it("does not seal the session when the page enters the bfcache", (): void => {
      startRecorder({ samplePercentage: 100 });

      fetchMock.mockClear();

      const event: Event = new Event("pagehide");
      Object.defineProperty(event, "persisted", { value: true });

      window.dispatchEvent(event);

      for (const call of fetchMock.mock.calls) {
        expect(readPost(call as Array<unknown>).envelope.isFinal).toBe(false);
      }
    });

    it("seals the session when the page is really going away", (): void => {
      startRecorder({ samplePercentage: 100 });

      /* Something to flush, so the terminal chunk is not the empty one. */
      document.body.appendChild(document.createElement("span"));

      fetchMock.mockClear();

      const event: Event = new Event("pagehide");
      Object.defineProperty(event, "persisted", { value: false });

      window.dispatchEvent(event);

      expect(fetchMock).toHaveBeenCalled();
      expect(
        readPost(fetchMock.mock.calls[0] as Array<unknown>).envelope.isFinal,
      ).toBe(true);
    });

    it("discloses a bfcache restore as a fidelity notice", (): void => {
      startRecorder({ samplePercentage: 100 });

      const show: Event = new Event("pageshow");
      Object.defineProperty(show, "persisted", { value: true });

      window.dispatchEvent(show);

      fetchMock.mockClear();
      document.body.appendChild(document.createElement("span"));

      const hide: Event = new Event("pagehide");
      Object.defineProperty(hide, "persisted", { value: false });

      window.dispatchEvent(hide);

      const notices: Array<string> = readPost(
        fetchMock.mock.calls[0] as Array<unknown>,
      ).envelope.fidelityNotices;

      expect(notices).toContain("bfcache-restore");
    });
  });

  describe("server directives and the circuit breaker", (): void => {
    it("stops recording when the server says stop", async (): Promise<void> => {
      fetchMock.mockResolvedValue({
        status: 204,
        headers: {
          get: (): string | null => {
            return null;
          },
        },
        text: async (): Promise<string> => {
          return '{"directive":"stop"}';
        },
      });

      const instance: Recorder = startRecorder({ samplePercentage: 100 });

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const before: number = fetchMock.mock.calls.length;

      instance.trigger(SessionReplayTriggerReason.Error);
      document.body.appendChild(document.createElement("span"));

      expect(fetchMock.mock.calls.length).toBe(before);
    });

    it("permanently self-disables after three failed flushes", async (): Promise<void> => {
      fetchMock.mockResolvedValue({
        status: 503,
        headers: {
          get: (): string | null => {
            return null;
          },
        },
        text: async (): Promise<string> => {
          return "";
        },
      });

      const instance: Recorder = startRecorder({ samplePercentage: 100 });

      for (let i: number = 0; i < 6; i++) {
        instance.trigger(SessionReplayTriggerReason.Error);
        document.body.appendChild(document.createElement("span"));

        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }

      const settled: number = fetchMock.mock.calls.length;

      document.body.appendChild(document.createElement("span"));
      await Promise.resolve();

      expect(fetchMock.mock.calls.length).toBe(settled);
    });
  });

  /*
   * The 30 minute idle rollover and the 4 hour duration cap.
   *
   * Both decisions live in Common/Utils/Rum/SessionIdentity, but they were
   * only ever consulted in the constructor and on a bfcache restore. The
   * flush timer instead called SessionId.touch(Date.now()) every 15 s
   * unconditionally, which bumped lastActivityUnixMs even for a completely
   * idle tab - so the idle rollover could never fire while the recorder was
   * alive and the duration cap was never checked at all. A dashboard tab left
   * open all day accumulated one sessionId and one unbounded chunk sequence.
   */
  describe("session lifecycle", (): void => {
    const SESSION_KEY: string = "oneuptime.replay.session";

    interface StoredSession {
      sessionId: string;
      sessionStartUnixMs: number;
      lastActivityUnixMs: number;
    }

    const readStored: () => StoredSession = (): StoredSession => {
      return JSON.parse(
        window.localStorage.getItem(SESSION_KEY) || "{}",
      ) as StoredSession;
    };

    const writeStored: (state: StoredSession) => void = (
      state: StoredSession,
    ): void => {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(state));
    };

    afterEach((): void => {
      jest.useRealTimers();
    });

    /* THE regression: the recorder's own heartbeat is not user activity. */
    it("does not treat its own flush heartbeat as activity", (): void => {
      jest.useFakeTimers();

      startRecorder();

      const before: number = readStored().lastActivityUnixMs;

      jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS * 6);

      expect(readStored().lastActivityUnixMs).toBe(before);
    });

    it("writes activity through when the user actually interacts", (): void => {
      jest.useFakeTimers();

      startRecorder();

      const before: number = readStored().lastActivityUnixMs;

      jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      document.body.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 }),
      );

      jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      expect(readStored().lastActivityUnixMs).toBeGreaterThan(before);
    });

    /*
     * The non-terminal upload path is a promise chain, and fake timers do not
     * advance microtasks. Drained explicitly rather than with a setTimeout,
     * which fake timers would swallow.
     */
    const drainMicrotasks: () => Promise<void> = async (): Promise<void> => {
      for (let i: number = 0; i < 20; i++) {
        await Promise.resolve();
      }
    };

    it("rolls the session over once the idle window has elapsed", async (): Promise<void> => {
      jest.useFakeTimers();

      const instance: Recorder = startRecorder({ samplePercentage: 100 });
      const firstSessionId: string = instance.getSessionId();
      const tabId: string = instance.getTabId();

      /* The user walked away right after the page loaded. */
      const idleSince: number = Date.now() - SESSION_REPLAY_IDLE_ROLLOVER_MS;

      writeStored({
        sessionId: firstSessionId,
        sessionStartUnixMs: idleSince,
        lastActivityUnixMs: idleSince,
      });

      fetchMock.mockClear();
      jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS);
      await drainMicrotasks();

      const secondSessionId: string = instance.getSessionId();

      expect(secondSessionId).not.toBe(firstSessionId);

      /* Same tab. The tab id is what scopes the chunk counter. */
      expect(instance.getTabId()).toBe(tabId);
      expect(SessionId.readTabId()).toBe(tabId);

      /*
       * The new session starts its own chunk sequence at 0. Without the reset
       * its first chunk would claim an index the finalizer then reports as
       * preceded by missing chunks.
       */
      const newSessionPosts: Array<CapturedPost> = fetchMock.mock.calls
        .map((call: Array<unknown>): CapturedPost => {
          return readPost(call);
        })
        .filter((post: CapturedPost): boolean => {
          return post.envelope.sessionId === secondSessionId;
        });

      expect(newSessionPosts.length).toBeGreaterThan(0);
      expect(newSessionPosts[0]?.envelope.chunkIndex).toBe(0);

      /*
       * previousSessionId and rotationReason are computed by
       * SessionId.resolveSession but the chunk envelope has no field for
       * either, so they ride in the payload as a custom rrweb event. Without
       * this, telling "the user went to lunch" from "the recorder lost its
       * state" is impossible server-side.
       */
      const payloads: string = newSessionPosts
        .map((post: CapturedPost): string => {
          return post.payload;
        })
        .join("");

      expect(payloads).toContain("oneuptime.session-rotated");
      expect(payloads).toContain(firstSessionId);
      expect(payloads).toContain("idle");
    });

    it("rolls the session over at the duration cap even while in use", (): void => {
      jest.useFakeTimers();

      const instance: Recorder = startRecorder({ samplePercentage: 100 });
      const firstSessionId: string = instance.getSessionId();

      /* Continuously active, but open past the ceiling. */
      writeStored({
        sessionId: firstSessionId,
        sessionStartUnixMs: Date.now() - SESSION_REPLAY_MAX_SESSION_MS,
        lastActivityUnixMs: Date.now(),
      });

      jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      expect(instance.getSessionId()).not.toBe(firstSessionId);
    });

    it("seals the outgoing session before opening the new one", (): void => {
      jest.useFakeTimers();

      const instance: Recorder = startRecorder({ samplePercentage: 100 });
      const firstSessionId: string = instance.getSessionId();

      fetchMock.mockClear();

      const idleSince: number = Date.now() - SESSION_REPLAY_IDLE_ROLLOVER_MS;

      writeStored({
        sessionId: firstSessionId,
        sessionStartUnixMs: idleSince,
        lastActivityUnixMs: idleSince,
      });

      jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      const finals: Array<CapturedPost> = fetchMock.mock.calls
        .map((call: Array<unknown>): CapturedPost => {
          return readPost(call);
        })
        .filter((post: CapturedPost): boolean => {
          return post.envelope.isFinal;
        });

      expect(finals.length).toBeGreaterThan(0);
      expect(finals[0]?.envelope.sessionId).toBe(firstSessionId);
    });

    it("does not roll over a session that is inside both limits", (): void => {
      jest.useFakeTimers();

      const instance: Recorder = startRecorder({ samplePercentage: 100 });
      const firstSessionId: string = instance.getSessionId();

      jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS * 10);

      expect(instance.getSessionId()).toBe(firstSessionId);
    });
  });

  /*
   * The transport's retry queue holds fully serialised chunks of end-user page
   * content. Transport.disable() clears it, but neither revoke nor stop goes
   * through disable(), so part of "the buffer" used to survive a revoke with
   * nothing that would ever upload it.
   */
  describe("releasing held content", (): void => {
    it("discards the transport queue on revokeConsent", (): void => {
      const discard: jest.SpyInstance = jest.spyOn(
        Transport.prototype,
        "discardQueue",
      );

      const instance: Recorder = startRecorder({
        consentMode: SessionReplayConsentMode.RequireExplicit,
      });

      instance.trigger(SessionReplayTriggerReason.Manual);
      instance.revokeConsent();

      expect(discard).toHaveBeenCalled();
    });

    it("discards the transport queue on stop", (): void => {
      const discard: jest.SpyInstance = jest.spyOn(
        Transport.prototype,
        "discardQueue",
      );

      const instance: Recorder = startRecorder({ samplePercentage: 100 });

      instance.stop();

      expect(discard).toHaveBeenCalled();
    });
  });

  describe("user agent parsing", (): void => {
    it("recognises the common browsers", (): void => {
      expect(
        Recorder.getBrowserName(
          "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        ),
      ).toBe("Chrome");
      expect(
        Recorder.getBrowserName("Mozilla/5.0 (Windows NT 10.0) Firefox/121.0"),
      ).toBe("Firefox");
      expect(
        Recorder.getBrowserName(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/605.1.15",
        ),
      ).toBe("Safari");
    });

    it("classifies device and os", (): void => {
      expect(Recorder.getDeviceType("iPhone")).toBe("mobile");
      expect(Recorder.getDeviceType("iPad")).toBe("tablet");
      expect(Recorder.getDeviceType("Macintosh")).toBe("desktop");
      expect(Recorder.getOsName("Mac OS X 10_15")).toBe("macOS");
      expect(Recorder.getOsName("Windows NT 10.0")).toBe("Windows");
    });
  });
});
