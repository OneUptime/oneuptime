import {
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_IDLE_PAUSE_MS,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import {
  SessionReplayCustomEventTag,
  SessionReplayIdlePausedPayload,
  SessionReplayIdleResumedPayload,
  isSessionReplayIdlePausedPayload,
  isSessionReplayIdleResumedPayload,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { RecorderInitOptions } from "../src/Config";
import { MAX_CONSOLE_RECORDED } from "../src/ConsoleRecorder";
import { DebugRecord, clearDebugRecords, getDebugRecords } from "../src/Debug";
import { MAX_ERRORS_RECORDED } from "../src/ErrorRecorder";
import Recorder from "../src/Recorder";

/*
 * #4208: what a tab costs while nobody is at it.
 *
 * After SESSION_REPLAY_IDLE_PAUSE_MS without a key, a pointer, the wheel or
 * a touch, the recorder stops capturing: an idle-paused marker, the open
 * chunk out, rrweb off. Nothing at all is recorded or uploaded until the
 * next input, which resumes the SAME session on a fresh snapshot with an
 * idle-resumed marker - or, once the 30-minute window has run out, starts
 * the next session instead.
 *
 * Every recorder here is built from a module graph imported AFTER the fake
 * clock is installed. rrweb reads `Date.now` once, when it is first
 * imported, so a recorder imported at the top of a file stamps its events
 * with the real clock while everything else runs on the fake one - and an
 * assertion about where a chunk starts or ends would then be measuring
 * nothing. Imported fresh, rrweb's events, the recorder's markers and the
 * chunk offsets all share one clock.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

const SESSION_KEY: string = "oneuptime.replay.session";
const CHUNK_PATH: string = "session-replay/v1/chunk";

/* rrweb EventType / IncrementalSource values the assertions read. */
const EVENT_TYPE_FULL_SNAPSHOT: number = 2;
const EVENT_TYPE_INCREMENTAL: number = 3;
const EVENT_TYPE_META: number = 4;
const EVENT_TYPE_CUSTOM: number = 5;
const SOURCE_SCROLL: number = 3;
const SOURCE_INPUT: number = 5;

const USER_INPUT_EVENT_TYPES: Array<string> = [
  "keydown",
  "mousedown",
  "mousemove",
  "wheel",
  "touchstart",
  "touchmove",
];

function baseConfig(): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    /*
     * Text stays readable so an assertion can find a console line or a
     * business event by its words; masking has suites of its own.
     */
    maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    captureTrigger: SessionReplayCaptureTrigger.Always,
    consentMode: SessionReplayConsentMode.NotRequired,
    samplePercentage: 100,
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

interface RecordedEvent {
  type: number;
  timestamp: number;
  data: Record<string, unknown>;
}

interface CapturedFrame {
  keepalive: boolean;
  envelope: SessionReplayChunkEnvelope;
  events: Array<RecordedEvent>;
}

interface StoredSession {
  sessionId: string;
  sessionStartUnixMs: number;
  lastActivityUnixMs: number;
}

describe("Recorder idle pause (#4208)", (): void => {
  let fetchMock: jest.Mock;
  let RecorderOnFakeClock: typeof Recorder = Recorder;
  const started: Array<Recorder> = [];

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  beforeEach(async (): Promise<void> => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML =
      "<div id='app'><p>content</p><input id='field' type='text' /></div>";
    clearDebugRecords();

    /* Synchronous enough to assert on; the gzip path has its own suite. */
    delete globalRecord["CompressionStream"];

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

    jest.useFakeTimers();

    await jest.isolateModulesAsync(async (): Promise<void> => {
      RecorderOnFakeClock = (await import("../src/Recorder")).default;
    });
  });

  afterEach((): void => {
    for (const instance of started) {
      instance.stop();
    }

    started.length = 0;

    setVisibility("visible");
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /* ---- Harness ---- */

  const startRecorder: (
    overrides?: Partial<SessionReplayConfigResponse>,
  ) => Recorder = (
    overrides?: Partial<SessionReplayConfigResponse>,
  ): Recorder => {
    const instance: Recorder = new RecorderOnFakeClock({
      initOptions: INIT_OPTIONS,
      config: { ...baseConfig(), ...overrides },
    });

    instance.start();
    started.push(instance);

    return instance;
  };

  /*
   * The non-terminal upload path is a promise chain several awaits deep,
   * and fake timers do not run microtasks.
   */
  const drainMicrotasks: () => Promise<void> = async (): Promise<void> => {
    for (let i: number = 0; i < 60; i++) {
      await Promise.resolve();
    }
  };

  const advance: (ms: number) => Promise<void> = async (
    ms: number,
  ): Promise<void> => {
    jest.advanceTimersByTime(ms);
    await drainMicrotasks();
  };

  /* Up to and just past the first flush tick at or after the pause window. */
  const waitForPause: () => Promise<void> = async (): Promise<void> => {
    await advance(
      SESSION_REPLAY_IDLE_PAUSE_MS + SESSION_REPLAY_FLUSH_INTERVAL_MS,
    );
  };

  /* The deferred resume, and whatever it posts once a tick flushes it. */
  const runResumeAndFlush: () => Promise<void> = async (): Promise<void> => {
    await advance(0);
    await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS);
  };

  function setVisibility(state: "hidden" | "visible"): void {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): string => {
        return state;
      },
    });
  }

  const input: (type: string) => void = (type: string): void => {
    document.body.dispatchEvent(new Event(type, { bubbles: true }));
  };

  const clickPage: () => void = (): void => {
    document.body.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 }),
    );
  };

  const pageHide: () => void = (): void => {
    const event: Event = new Event("pagehide");
    Object.defineProperty(event, "persisted", { value: false });
    window.dispatchEvent(event);
  };

  const readStored: () => StoredSession = (): StoredSession => {
    return JSON.parse(
      window.localStorage.getItem(SESSION_KEY) || "{}",
    ) as StoredSession;
  };

  const chunkCalls: () => Array<Array<unknown>> = (): Array<Array<unknown>> => {
    return fetchMock.mock.calls.filter((call: Array<unknown>): boolean => {
      return String(call[0]).indexOf(CHUNK_PATH) >= 0;
    });
  };

  /* Every frame of every chunk request, in order. */
  const allFrames: () => Array<CapturedFrame> = (): Array<CapturedFrame> => {
    const frames: Array<CapturedFrame> = [];

    for (const call of chunkCalls()) {
      const init: Record<string, unknown> = call[1] as Record<string, unknown>;
      const body: Uint8Array = init["body"] as Uint8Array;
      let offset: number = 0;

      while (offset < body.length) {
        const rest: Uint8Array = body.subarray(offset);
        const newline: number = rest.indexOf(10);

        if (newline < 0) {
          break;
        }

        const envelope: SessionReplayChunkEnvelope = JSON.parse(
          new TextDecoder().decode(rest.subarray(0, newline)),
        ) as SessionReplayChunkEnvelope;
        const start: number = newline + 1;
        const end: number = start + envelope.payloadBytes;

        frames.push({
          keepalive: init["keepalive"] === true,
          envelope: envelope,
          events: JSON.parse(
            new TextDecoder().decode(rest.subarray(start, end)),
          ) as Array<RecordedEvent>,
        });

        offset += end;
      }
    }

    return frames;
  };

  const framesFor: (sessionId: string) => Array<CapturedFrame> = (
    sessionId: string,
  ): Array<CapturedFrame> => {
    return allFrames().filter((frame: CapturedFrame): boolean => {
      return frame.envelope.sessionId === sessionId;
    });
  };

  const eventsIn: (frames: Array<CapturedFrame>) => Array<RecordedEvent> = (
    frames: Array<CapturedFrame>,
  ): Array<RecordedEvent> => {
    return frames.flatMap((frame: CapturedFrame): Array<RecordedEvent> => {
      return frame.events;
    });
  };

  const isCustom: (event: RecordedEvent, tag: string) => boolean = (
    event: RecordedEvent,
    tag: string,
  ): boolean => {
    return event.type === EVENT_TYPE_CUSTOM && event.data["tag"] === tag;
  };

  const customEvents: (
    frames: Array<CapturedFrame>,
    tag: string,
  ) => Array<RecordedEvent> = (
    frames: Array<CapturedFrame>,
    tag: string,
  ): Array<RecordedEvent> => {
    return eventsIn(frames).filter((event: RecordedEvent): boolean => {
      return isCustom(event, tag);
    });
  };

  const pausedMarkers: (
    frames: Array<CapturedFrame>,
  ) => Array<SessionReplayIdlePausedPayload> = (
    frames: Array<CapturedFrame>,
  ): Array<SessionReplayIdlePausedPayload> => {
    return customEvents(frames, SessionReplayCustomEventTag.IdlePaused).map(
      (event: RecordedEvent): SessionReplayIdlePausedPayload => {
        return event.data["payload"] as SessionReplayIdlePausedPayload;
      },
    );
  };

  const resumedMarkers: (
    frames: Array<CapturedFrame>,
  ) => Array<SessionReplayIdleResumedPayload> = (
    frames: Array<CapturedFrame>,
  ): Array<SessionReplayIdleResumedPayload> => {
    return customEvents(frames, SessionReplayCustomEventTag.IdleResumed).map(
      (event: RecordedEvent): SessionReplayIdleResumedPayload => {
        return event.data["payload"] as SessionReplayIdleResumedPayload;
      },
    );
  };

  const footageEndOffsetMs: (frames: Array<CapturedFrame>) => number = (
    frames: Array<CapturedFrame>,
  ): number => {
    return Math.max(
      ...frames
        .filter((frame: CapturedFrame): boolean => {
          return frame.envelope.eventCount > 0;
        })
        .map((frame: CapturedFrame): number => {
          return frame.envelope.chunkEndOffsetMs;
        }),
    );
  };

  const seals: (frames: Array<CapturedFrame>) => Array<CapturedFrame> = (
    frames: Array<CapturedFrame>,
  ): Array<CapturedFrame> => {
    return frames.filter((frame: CapturedFrame): boolean => {
      return frame.envelope.isFinal;
    });
  };

  const debugCodes: () => Array<string> = (): Array<string> => {
    return getDebugRecords().map((record: DebugRecord): string => {
      return record.code;
    });
  };

  /* ---- Pausing ---- */

  describe("pausing", (): void => {
    it("pauses after five minutes without input, ending the footage on an idle-paused marker", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();
      const loadedAt: number = Date.now();

      await drainMicrotasks();
      await waitForPause();

      expect(instance.isPausedForIdle()).toBe(true);
      expect(instance.getState()).toBe("paused");

      const frames: Array<CapturedFrame> = framesFor(sessionId);
      const last: CapturedFrame = frames[frames.length - 1] as CapturedFrame;
      const lastEvent: RecordedEvent = last.events[
        last.events.length - 1
      ] as RecordedEvent;

      /* The last thing the recording holds says why it stops there. */
      expect(isCustom(lastEvent, SessionReplayCustomEventTag.IdlePaused)).toBe(
        true,
      );
      expect(isSessionReplayIdlePausedPayload(lastEvent.data["payload"])).toBe(
        true,
      );

      const marker: SessionReplayIdlePausedPayload = lastEvent.data[
        "payload"
      ] as SessionReplayIdlePausedPayload;

      /* The page load is the last activity there was. */
      expect(marker.idleSinceUnixMs).toBe(loadedAt);
      expect(marker.pausedAtUnixMs).toBe(
        loadedAt + SESSION_REPLAY_IDLE_PAUSE_MS,
      );
      expect(lastEvent.timestamp).toBe(marker.pausedAtUnixMs);

      /* A pause is not an end: the session stays open for the user. */
      expect(last.envelope.isFinal).toBe(false);
      expect(seals(frames)).toHaveLength(0);
      expect(last.keepalive).toBe(false);
      expect(last.envelope.chunkEndOffsetMs).toBe(SESSION_REPLAY_IDLE_PAUSE_MS);
    });

    it("never pauses someone who keeps coming back inside the window", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();

      for (let minute: number = 0; minute < 24; minute += 4) {
        await advance(4 * 60 * 1000);
        input("mousemove");
        expect(instance.isPausedForIdle()).toBe(false);
      }

      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      expect(instance.getState()).toBe("uploading");
      expect(pausedMarkers(framesFor(sessionId))).toHaveLength(0);
    });

    /*
     * A rich-text editor turns keystrokes into DOM mutations, which rrweb
     * records and which are, rightly, not activity - so before keydown was
     * heard directly, someone writing a long message without touching the
     * mouse looked exactly like nobody at all.
     */
    it("treats typing as activity even when it only mutates the page", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const editor: HTMLDivElement = document.createElement("div");

      editor.setAttribute("contenteditable", "true");
      document.body.appendChild(editor);
      await drainMicrotasks();

      for (let minute: number = 0; minute < 12; minute++) {
        await advance(60 * 1000);
        editor.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "a" }),
        );
        editor.textContent = `${editor.textContent || ""}a`;
      }

      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      expect(instance.isPausedForIdle()).toBe(false);
    });

    it.each(["wheel", "touchstart", "touchmove", "mousedown"])(
      "treats %s as activity",
      async (type: string): Promise<void> => {
        const instance: Recorder = startRecorder();

        await drainMicrotasks();

        for (let minute: number = 0; minute < 12; minute += 3) {
          await advance(3 * 60 * 1000);
          input(type);
        }

        expect(instance.isPausedForIdle()).toBe(false);
      },
    );

    /*
     * The other half of the activity rule: what a page does by itself.
     * A carousel scrolling itself, a framework writing an input's value and
     * a style property animated from script all reach rrweb as
     * non-mutation events, and every one of them used to count as the user
     * - so on such a page no idle clock ever ran.
     */
    it("pauses a page that scrolls, writes inputs and restyles itself with nobody there", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();
      const field: HTMLInputElement = document.getElementById(
        "field",
      ) as HTMLInputElement;
      const app: HTMLElement = document.getElementById("app") as HTMLElement;

      await drainMicrotasks();

      for (let step: number = 0; step < 18; step++) {
        await advance(20 * 1000);

        if (instance.isPausedForIdle()) {
          break;
        }

        document.dispatchEvent(new Event("scroll"));
        field.value = `value ${step}`;
        app.style.setProperty("--ticker", String(step));
      }

      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      expect(instance.isPausedForIdle()).toBe(true);

      /* The page really did produce them; they just were not the user. */
      const sources: Set<unknown> = new Set<unknown>(
        eventsIn(framesFor(sessionId))
          .filter((event: RecordedEvent): boolean => {
            return event.type === EVENT_TYPE_INCREMENTAL;
          })
          .map((event: RecordedEvent): unknown => {
            return event.data["source"];
          }),
      );

      expect(sources.has(SOURCE_SCROLL)).toBe(true);
      expect(sources.has(SOURCE_INPUT)).toBe(true);
    });

    it("keeps what the page did on its own before the pause", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();

      for (let minute: number = 1; minute <= 3; minute++) {
        await advance(60 * 1000);
        const node: HTMLDivElement = document.createElement("div");
        node.textContent = `tick ${minute}`;
        document.body.appendChild(node);

        /* rrweb hears a mutation in a microtask, as a browser delivers it. */
        await drainMicrotasks();
      }

      await waitForPause();

      const frames: Array<CapturedFrame> = framesFor(sessionId);
      const pauseFrameIndex: number = frames.findIndex(
        (frame: CapturedFrame): boolean => {
          return frame.events.some((event: RecordedEvent): boolean => {
            return isCustom(event, SessionReplayCustomEventTag.IdlePaused);
          });
        },
      );

      /*
       * Nobody can know the user is gone until the window has passed, so
       * the minutes before it are footage like any other.
       */
      const mutationsBeforePause: number = eventsIn(
        frames.slice(0, pauseFrameIndex + 1),
      ).filter((event: RecordedEvent): boolean => {
        return (
          event.type === EVENT_TYPE_INCREMENTAL && event.data["source"] === 0
        );
      }).length;

      expect(pauseFrameIndex).toBe(frames.length - 1);
      expect(mutationsBeforePause).toBeGreaterThanOrEqual(3);
    });

    it("says so in the diagnostics, once", async (): Promise<void> => {
      startRecorder();

      await drainMicrotasks();
      await waitForPause();
      await advance(10 * 60 * 1000);

      const paused: Array<DebugRecord> = getDebugRecords().filter(
        (record: DebugRecord): boolean => {
          return record.code === "recording-paused-idle";
        },
      );

      expect(paused).toHaveLength(1);
      expect(paused[0]?.detail?.["idleForMs"]).toBe(
        SESSION_REPLAY_IDLE_PAUSE_MS,
      );
    });
  });

  /* ---- While paused ---- */

  describe("while paused", (): void => {
    it("records and uploads nothing, whatever the page does on its own", async (): Promise<void> => {
      jest.spyOn(console, "warn").mockImplementation((): void => {});

      const instance: Recorder = startRecorder();

      await drainMicrotasks();
      await waitForPause();

      fetchMock.mockClear();

      for (let minute: number = 0; minute < 20; minute++) {
        const node: HTMLDivElement = document.createElement("div");
        node.textContent = `background ${minute}`;
        document.body.appendChild(node);

        // eslint-disable-next-line no-console
        console.warn(`background warning ${minute}`);
        window.dispatchEvent(
          new ErrorEvent("error", { message: `background error ${minute}` }),
        );
        await window.fetch(`/api/poll?minute=${minute}`);

        await advance(60 * 1000);
      }

      /* No chunk, no checkout snapshot, no marker - nothing at all. */
      expect(chunkCalls()).toHaveLength(0);
      expect(instance.isPausedForIdle()).toBe(true);
      expect(instance.getState()).toBe("paused");
    });

    it("lets neither a background error nor a 5xx start an upload under capture-on-error", async (): Promise<void> => {
      const instance: Recorder = startRecorder({
        captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
        samplePercentage: 0,
      });

      await drainMicrotasks();
      await waitForPause();

      expect(instance.isPausedForIdle()).toBe(true);

      window.dispatchEvent(new ErrorEvent("error", { message: "poll failed" }));
      await drainMicrotasks();

      expect(instance.isUploading()).toBe(false);
      expect(instance.getTriggerReason()).toBeNull();
      expect(chunkCalls()).toHaveLength(0);
    });

    it("spends none of the console or error caps the user's own session needs", async (): Promise<void> => {
      jest.spyOn(console, "warn").mockImplementation((): void => {});

      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await waitForPause();

      for (let i: number = 0; i < MAX_CONSOLE_RECORDED + 20; i++) {
        // eslint-disable-next-line no-console
        console.warn(`background ${i}`);
      }

      for (let i: number = 0; i < MAX_ERRORS_RECORDED + 20; i++) {
        window.dispatchEvent(
          new ErrorEvent("error", { message: `background error ${i}` }),
        );
      }

      input("mousemove");
      await advance(0);

      // eslint-disable-next-line no-console
      console.warn("after the user came back");
      window.dispatchEvent(
        new ErrorEvent("error", { message: "after the user came back" }),
      );
      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      const text: string = JSON.stringify(eventsIn(framesFor(sessionId)));

      expect(text).toContain("after the user came back");
      expect(text).not.toContain("background ");
      expect(text).not.toContain("Console capture stopped");
    });

    it("drops a track() call rather than counting an event nobody can see", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await waitForPause();

      instance.track("background_sync");

      input("mousemove");
      await runResumeAndFlush();

      const frames: Array<CapturedFrame> = framesFor(sessionId);

      expect(JSON.stringify(eventsIn(frames))).not.toContain("background_sync");

      for (const frame of frames) {
        expect(frame.envelope.signals.customEventCount).toBe(0);
      }
    });

    it("forgets the in-memory pre-roll, so a later trigger cannot upload footage from before the gap", async (): Promise<void> => {
      const instance: Recorder = startRecorder({
        captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
        samplePercentage: 0,
      });

      await drainMicrotasks();
      await waitForPause();
      await advance(10 * 60 * 1000);

      const returnedAt: number = Date.now();

      input("mousemove");
      await advance(0);
      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      window.dispatchEvent(new ErrorEvent("error", { message: "after" }));
      await drainMicrotasks();

      expect(instance.isUploading()).toBe(true);

      const chunkZero: CapturedFrame = framesFor(
        instance.getSessionId(),
      )[0] as CapturedFrame;

      expect(chunkZero.envelope.chunkIndex).toBe(0);
      expect(chunkZero.envelope.hasFullSnapshot).toBe(true);

      /* Nothing in it predates the user coming back. */
      for (const event of chunkZero.events) {
        expect(event.timestamp).toBeGreaterThanOrEqual(returnedAt);
      }

      /* And no resume marker answers a pause this recording never held. */
      expect(resumedMarkers([chunkZero])).toHaveLength(0);
    });
  });

  /* ---- Resuming ---- */

  describe("resuming", (): void => {
    it("resumes the same session on the next input, opening on a snapshot with an idle-resumed marker", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();
      const tabId: string = instance.getTabId();

      await drainMicrotasks();
      await waitForPause();

      const beforeResume: Array<CapturedFrame> = framesFor(sessionId);
      const lastIndexBeforePause: number = Math.max(
        ...beforeResume.map((frame: CapturedFrame): number => {
          return frame.envelope.chunkIndex;
        }),
      );
      const pausedAt: number = (
        pausedMarkers(beforeResume)[0] as SessionReplayIdlePausedPayload
      ).pausedAtUnixMs;

      await advance(10 * 60 * 1000);
      fetchMock.mockClear();

      const returnedAt: number = Date.now();

      input("mousemove");
      await runResumeAndFlush();

      expect(instance.isPausedForIdle()).toBe(false);
      expect(instance.getState()).toBe("uploading");
      expect(instance.getSessionId()).toBe(sessionId);
      expect(instance.getTabId()).toBe(tabId);

      const resumed: CapturedFrame = framesFor(sessionId)[0] as CapturedFrame;

      /* The same tab's sequence, with no hole for the stretch skipped. */
      expect(resumed.envelope.tabId).toBe(tabId);
      expect(resumed.envelope.chunkIndex).toBe(lastIndexBeforePause + 1);
      expect(resumed.envelope.hasFullSnapshot).toBe(true);

      /* Snapshot first, then the marker that explains the jump. */
      expect(resumed.events[0]?.type).toBe(EVENT_TYPE_META);
      expect(resumed.events[1]?.type).toBe(EVENT_TYPE_FULL_SNAPSHOT);
      expect(
        isCustom(
          resumed.events[2] as RecordedEvent,
          SessionReplayCustomEventTag.IdleResumed,
        ),
      ).toBe(true);

      const marker: SessionReplayIdleResumedPayload = (
        resumed.events[2] as RecordedEvent
      ).data["payload"] as SessionReplayIdleResumedPayload;

      expect(isSessionReplayIdleResumedPayload(marker)).toBe(true);
      expect(marker.pausedAtUnixMs).toBe(pausedAt);
      expect(marker.resumedAtUnixMs).toBe(returnedAt);
      expect(resumed.envelope.chunkStartOffsetMs).toBe(
        returnedAt - readStored().sessionStartUnixMs,
      );

      expect(debugCodes()).toContain("recording-resumed");
    });

    it.each(USER_INPUT_EVENT_TYPES)(
      "hears %s as the user coming back",
      async (type: string): Promise<void> => {
        const instance: Recorder = startRecorder();

        await drainMicrotasks();
        await waitForPause();

        input(type);
        await runResumeAndFlush();

        expect(instance.isPausedForIdle()).toBe(false);
        expect(resumedMarkers(framesFor(instance.getSessionId()))).toHaveLength(
          1,
        );
      },
    );

    it("resumes once for a burst of input, not once per event", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await waitForPause();
      fetchMock.mockClear();

      for (let i: number = 0; i < 30; i++) {
        input("mousemove");
      }

      input("keydown");
      await runResumeAndFlush();

      const frames: Array<CapturedFrame> = framesFor(sessionId);

      expect(resumedMarkers(frames)).toHaveLength(1);
      expect(
        eventsIn(frames).filter((event: RecordedEvent): boolean => {
          return event.type === EVENT_TYPE_FULL_SNAPSHOT;
        }),
      ).toHaveLength(1);
    });

    it("pauses again the next time nobody is there, and resumes again", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();

      for (let round: number = 0; round < 3; round++) {
        await waitForPause();
        expect(instance.isPausedForIdle()).toBe(true);

        await advance(2 * 60 * 1000);
        input("mousemove");
        await runResumeAndFlush();
        expect(instance.isPausedForIdle()).toBe(false);
      }

      const frames: Array<CapturedFrame> = framesFor(sessionId);
      const paused: Array<SessionReplayIdlePausedPayload> =
        pausedMarkers(frames);
      const resumed: Array<SessionReplayIdleResumedPayload> =
        resumedMarkers(frames);

      expect(paused).toHaveLength(3);
      expect(resumed).toHaveLength(3);

      /* Each resume answers the pause before it. */
      paused.forEach(
        (pause: SessionReplayIdlePausedPayload, index: number): void => {
          expect(resumed[index]?.pausedAtUnixMs).toBe(pause.pausedAtUnixMs);
        },
      );

      /* One session, one contiguous sequence. */
      const indexes: Array<number> = frames.map(
        (frame: CapturedFrame): number => {
          return frame.envelope.chunkIndex;
        },
      );

      expect(indexes).toEqual(
        indexes.map((_index: number, position: number): number => {
          return position;
        }),
      );
      expect(
        new Set<string>(
          allFrames().map((f: CapturedFrame): string => {
            return f.envelope.sessionId;
          }),
        ).size,
      ).toBe(1);
    });

    it("tells the stream the tab is visible again when it was hidden going into the pause", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();

      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await waitForPause();

      expect(instance.isPausedForIdle()).toBe(true);

      /* Shown again while paused: not recorded then... */
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await drainMicrotasks();

      input("mousemove");
      await runResumeAndFlush();

      const events: Array<RecordedEvent> = eventsIn(framesFor(sessionId));
      const resumeAt: number = events.findIndex(
        (event: RecordedEvent): boolean => {
          return isCustom(event, SessionReplayCustomEventTag.IdleResumed);
        },
      );
      const visibility: Array<RecordedEvent> = events.filter(
        (event: RecordedEvent): boolean => {
          return isCustom(event, SessionReplayCustomEventTag.Visibility);
        },
      );

      /* ...but said straight after the resume, so no background stretch runs on. */
      expect(
        visibility.map((event: RecordedEvent): unknown => {
          return (event.data["payload"] as Record<string, unknown>)["state"];
        }),
      ).toEqual(["hidden", "visible"]);
      expect(
        isCustom(
          events[resumeAt + 1] as RecordedEvent,
          SessionReplayCustomEventTag.Visibility,
        ),
      ).toBe(true);
    });

    it("does not repeat a visible state the stream already has", async (): Promise<void> => {
      const instance: Recorder = startRecorder();

      await drainMicrotasks();
      await waitForPause();

      input("mousemove");
      await runResumeAndFlush();

      expect(
        customEvents(
          framesFor(instance.getSessionId()),
          SessionReplayCustomEventTag.Visibility,
        ),
      ).toHaveLength(0);
    });

    it("resumes for an explicit captureSession(), which lands in the same session", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await waitForPause();

      instance.captureSession("support asked for this");
      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      expect(instance.getSessionId()).toBe(sessionId);

      const events: Array<RecordedEvent> = eventsIn(framesFor(sessionId));
      const resumeAt: number = events.findIndex(
        (event: RecordedEvent): boolean => {
          return isCustom(event, SessionReplayCustomEventTag.IdleResumed);
        },
      );
      const captureAt: number = events.findIndex(
        (event: RecordedEvent): boolean => {
          return (
            isCustom(event, SessionReplayCustomEventTag.Custom) &&
            JSON.stringify(event.data["payload"]).indexOf("captureSession") >= 0
          );
        },
      );

      expect(resumeAt).toBeGreaterThan(0);
      expect(captureAt).toBeGreaterThan(resumeAt);
      expect(instance.getTriggerReason()).toBe(
        SessionReplayTriggerReason.Sampled,
      );

      /* A page asking is not a person arriving: nobody is there, so it pauses again. */
      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS);

      expect(instance.isPausedForIdle()).toBe(true);
    });

    it("starts the next session instead when the user comes back after the idle window", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const firstSessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await advance(
        SESSION_REPLAY_IDLE_ROLLOVER_MS + SESSION_REPLAY_FLUSH_INTERVAL_MS,
      );
      await advance(10 * 60 * 1000);

      clickPage();
      await runResumeAndFlush();

      const secondSessionId: string = instance.getSessionId();

      expect(secondSessionId).not.toBe(firstSessionId);
      expect(instance.isPausedForIdle()).toBe(false);

      const chunkZero: CapturedFrame = framesFor(
        secondSessionId,
      )[0] as CapturedFrame;

      expect(chunkZero.envelope.chunkIndex).toBe(0);
      expect(chunkZero.envelope.hasFullSnapshot).toBe(true);
      expect(JSON.stringify(chunkZero.events)).toContain(
        '"rotationReason":"idle"',
      );

      /* A new session owes nobody a resume marker. */
      expect(resumedMarkers(framesFor(secondSessionId))).toHaveLength(0);
    });
  });

  /* ---- Where the session ends ---- */

  describe("where a paused session ends", (): void => {
    it("ends at the pause marker when nobody comes back, not when the window runs out", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await advance(
        SESSION_REPLAY_IDLE_ROLLOVER_MS + SESSION_REPLAY_FLUSH_INTERVAL_MS,
      );

      const frames: Array<CapturedFrame> = framesFor(sessionId);
      const sealed: Array<CapturedFrame> = seals(frames);

      expect(sealed).toHaveLength(1);

      const seal: CapturedFrame = sealed[0] as CapturedFrame;

      expect(seal.envelope.eventCount).toBe(0);
      expect(seal.envelope.chunkEndOffsetMs).toBe(footageEndOffsetMs(frames));
      expect(seal.envelope.chunkEndOffsetMs).toBe(SESSION_REPLAY_IDLE_PAUSE_MS);

      /* Sealed, and nothing behind the seal. */
      expect(frames[frames.length - 1]).toBe(seal);
      expect(instance.isStopped()).toBe(false);
    });

    it("dates the seal at the footage when the tab is closed while paused", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await waitForPause();
      await advance(12 * 60 * 1000);

      pageHide();
      await drainMicrotasks();

      const frames: Array<CapturedFrame> = framesFor(sessionId);
      const sealed: Array<CapturedFrame> = seals(frames);

      expect(sealed).toHaveLength(1);
      expect(sealed[0]?.keepalive).toBe(true);

      /*
       * Twelve minutes nobody recorded are not counted as recording: the
       * list would otherwise call this session seventeen minutes long and
       * the player could show five.
       */
      expect(sealed[0]?.envelope.chunkEndOffsetMs).toBe(
        SESSION_REPLAY_IDLE_PAUSE_MS,
      );
    });

    it("dates the seal at the footage when the page calls stop() while paused", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await waitForPause();
      await advance(7 * 60 * 1000);

      instance.stop();
      await drainMicrotasks();

      const sealed: Array<CapturedFrame> = seals(framesFor(sessionId));

      expect(sealed).toHaveLength(1);
      expect(sealed[0]?.envelope.chunkEndOffsetMs).toBe(
        SESSION_REPLAY_IDLE_PAUSE_MS,
      );
    });

    it("still dates a seal at now while the user is active", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const sessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await advance(2 * 60 * 1000);
      input("mousemove");
      await advance(60 * 1000);

      const closedAt: number = Date.now();

      pageHide();
      await drainMicrotasks();

      const seal: CapturedFrame = seals(
        framesFor(sessionId),
      )[0] as CapturedFrame;

      expect(seal.envelope.chunkEndOffsetMs).toBe(
        closedAt - readStored().sessionStartUnixMs,
      );
    });

    it("waits for the user, recording nothing, when the duration cap passes while paused", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const firstSessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await waitForPause();

      /* The session began long ago; the cap runs out while nobody is here. */
      const stored: StoredSession = readStored();

      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          ...stored,
          sessionStartUnixMs: Date.now() - SESSION_REPLAY_MAX_SESSION_MS - 1000,
        }),
      );

      fetchMock.mockClear();
      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS * 4);

      /* The old session sealed; no new one started on an empty room. */
      expect(instance.getSessionId()).toBe(firstSessionId);
      expect(
        allFrames().every((frame: CapturedFrame): boolean => {
          return frame.envelope.sessionId === firstSessionId;
        }),
      ).toBe(true);
      expect(seals(framesFor(firstSessionId))).toHaveLength(1);

      clickPage();
      await runResumeAndFlush();

      const secondSessionId: string = instance.getSessionId();

      expect(secondSessionId).not.toBe(firstSessionId);
      expect(framesFor(secondSessionId)[0]?.envelope.hasFullSnapshot).toBe(
        true,
      );
    });

    it("lets a sibling tab move the session on without starting to record this one, until the user is back here", async (): Promise<void> => {
      const instance: Recorder = startRecorder();
      const firstSessionId: string = instance.getSessionId();

      await drainMicrotasks();
      await waitForPause();
      fetchMock.mockClear();

      /* The user came back in another tab, which rotated the session. */
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
      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS * 2);

      /* This tab's part of the old session ended, at its footage. */
      expect(instance.getSessionId()).toBe(firstSessionId);
      expect(framesFor(siblingSessionId)).toHaveLength(0);

      const sealed: Array<CapturedFrame> = seals(framesFor(firstSessionId));

      expect(sealed).toHaveLength(1);
      expect(sealed[0]?.envelope.chunkEndOffsetMs).toBe(
        SESSION_REPLAY_IDLE_PAUSE_MS,
      );

      clickPage();
      await runResumeAndFlush();

      expect(instance.getSessionId()).toBe(siblingSessionId);

      const adopted: CapturedFrame = framesFor(
        siblingSessionId,
      )[0] as CapturedFrame;

      expect(adopted.envelope.chunkIndex).toBe(0);
      expect(adopted.envelope.hasFullSnapshot).toBe(true);
      expect(JSON.stringify(adopted.events)).toContain(
        '"rotationReason":"adopted"',
      );
    });
  });
});
