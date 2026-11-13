import {
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_IDLE_PAUSE_MS,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import {
  SessionReplayCustomEventTag,
  SessionReplayIdlePausedPayload,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { RecorderInitOptions } from "../src/Config";
import { DebugRecord, clearDebugRecords, getDebugRecords } from "../src/Debug";
import Recorder from "../src/Recorder";

/*
 * pause() and resume(): the page holds recording while it shows what it
 * does not want recorded (issue #6834 - OneUptime's Dashboard records its
 * first-run pages and pauses on every other one).
 *
 * A page pause is the idle pause held by the page instead of the clock:
 * the open chunk goes out with a paused marker that says "page", rrweb
 * stops, and nothing on screen is captured - DOM, console, clicks, rage
 * clicks, track() - until resume() opens the same session on a fresh
 * snapshot. The visitor's input and captureSession() resume nothing.
 *
 * Built on a fake clock imported fresh for each test, as the idle pause
 * suite is: rrweb reads Date.now once, when first imported.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

const CHUNK_PATH: string = "session-replay/v1/chunk";

const EVENT_TYPE_FULL_SNAPSHOT: number = 2;
const EVENT_TYPE_CUSTOM: number = 5;

// Words that appear on the page only while it asked not to be recorded.
const NOT_RECORDED: string = "Incident about Hartwell Ltd payroll";

function baseConfig(): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    // Text readable, so an assertion can look for what was on screen.
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
  envelope: SessionReplayChunkEnvelope;
  events: Array<RecordedEvent>;
  text: string;
}

describe("Recorder page pause (#6834)", (): void => {
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
      "<div id='app'><h1>Create Monitor</h1><button id='go' style='cursor:pointer'>Go</button></div>";

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
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const build: () => Recorder = (): Recorder => {
    const instance: Recorder = new RecorderOnFakeClock({
      initOptions: INIT_OPTIONS,
      config: baseConfig(),
    });

    started.push(instance);

    return instance;
  };

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

  const flushTick: () => Promise<void> = async (): Promise<void> => {
    await advance(0);
    await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS);
  };

  const input: (type: string) => void = (type: string): void => {
    document.body.dispatchEvent(new Event(type, { bubbles: true }));
  };

  const showNotRecordedPage: () => void = (): void => {
    const paragraph: HTMLParagraphElement = document.createElement("p");
    paragraph.id = "secret";
    paragraph.textContent = NOT_RECORDED;
    document.body.appendChild(paragraph);
  };

  const frames: () => Array<CapturedFrame> = (): Array<CapturedFrame> => {
    const result: Array<CapturedFrame> = [];

    for (const call of fetchMock.mock.calls) {
      if (String(call[0]).indexOf(CHUNK_PATH) < 0) {
        continue;
      }

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
        const text: string = new TextDecoder().decode(
          rest.subarray(start, end),
        );

        result.push({
          envelope: envelope,
          events: JSON.parse(text) as Array<RecordedEvent>,
          text: text,
        });

        offset += end;
      }
    }

    return result;
  };

  const allText: () => string = (): string => {
    return frames()
      .map((frame: CapturedFrame): string => {
        return frame.text;
      })
      .join("\n");
  };

  const events: () => Array<RecordedEvent> = (): Array<RecordedEvent> => {
    return frames().flatMap((frame: CapturedFrame): Array<RecordedEvent> => {
      return frame.events;
    });
  };

  const markers: (tag: string) => Array<RecordedEvent> = (
    tag: string,
  ): Array<RecordedEvent> => {
    return events().filter((event: RecordedEvent): boolean => {
      return event.type === EVENT_TYPE_CUSTOM && event.data["tag"] === tag;
    });
  };

  const debugCodes: () => Array<string> = (): Array<string> => {
    return getDebugRecords().map((record: DebugRecord): string => {
      return record.code;
    });
  };

  const fullSnapshots: () => number = (): number => {
    return events().filter((event: RecordedEvent): boolean => {
      return event.type === EVENT_TYPE_FULL_SNAPSHOT;
    }).length;
  };

  describe("pause()", (): void => {
    it("ends the footage on a paused marker that says the page asked", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      const askedAt: number = Date.now();

      instance.pause();
      await drainMicrotasks();

      expect(instance.isPausedByPage()).toBe(true);
      expect(instance.getState()).toBe("paused");

      const paused: Array<RecordedEvent> = markers(
        SessionReplayCustomEventTag.IdlePaused,
      );

      expect(paused).toHaveLength(1);

      const payload: SessionReplayIdlePausedPayload = (
        paused[0] as RecordedEvent
      ).data["payload"] as SessionReplayIdlePausedPayload;

      expect(payload.reason).toBe("page");
      expect(payload.pausedAtUnixMs).toBe(askedAt);
      expect(payload.idleSinceUnixMs).toBe(askedAt);

      // A pause is not an end: nothing is sealed.
      expect(
        frames().some((frame: CapturedFrame): boolean => {
          return frame.envelope.isFinal;
        }),
      ).toBe(false);
    });

    it("captures nothing on screen while paused: DOM, console, track() or clicks", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.pause();
      await drainMicrotasks();

      const chunksAtPause: number = frames().length;

      showNotRecordedPage();
      // eslint-disable-next-line no-console
      console.error(NOT_RECORDED);
      instance.track("not_recorded_event", { what: NOT_RECORDED });
      (document.getElementById("go") as HTMLElement).click();

      await advance(SESSION_REPLAY_FLUSH_INTERVAL_MS * 3);

      expect(frames()).toHaveLength(chunksAtPause);
      expect(allText()).not.toContain(NOT_RECORDED);
      expect(allText()).not.toContain("not_recorded_event");
    });

    it("is not resumed by the visitor's input, however long they keep at it", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.pause();

      for (const type of ["mousedown", "keydown", "mousemove", "wheel"]) {
        input(type);
        await flushTick();
      }

      expect(instance.isPausedByPage()).toBe(true);
      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(1);
    });

    it("is not resumed by captureSession()", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.pause();
      showNotRecordedPage();
      instance.captureSession("look at this");
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(allText()).not.toContain(NOT_RECORDED);
      expect(allText()).not.toContain("look at this");
    });

    it("does not count a rage click made while paused", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.pause();

      const button: HTMLElement = document.getElementById("go") as HTMLElement;

      for (let i: number = 0; i < 5; i++) {
        button.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: 4, clientY: 4 }),
        );
      }

      await advance(3000);
      instance.resume();
      await flushTick();

      const rageClicks: number = frames().reduce(
        (sum: number, frame: CapturedFrame): number => {
          return sum + (frame.envelope.signals?.rageClickCount || 0);
        },
        0,
      );
      const clicks: number = frames().reduce(
        (sum: number, frame: CapturedFrame): number => {
          return sum + (frame.envelope.signals?.clickCount || 0);
        },
        0,
      );

      expect(rageClicks).toBe(0);
      expect(clicks).toBe(0);
    });

    it("does not even try to resume on input or captureSession()", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.pause();
      clearDebugRecords();

      input("mousedown");
      instance.captureSession("look at this");
      await flushTick();

      // The idle pause's own resume never ran.
      expect(debugCodes()).not.toContain("recording-resumed");
    });

    it("stays paused when the page comes back from the back/forward cache", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.pause();
      showNotRecordedPage();

      const restore: Event = new Event("pageshow");
      Object.defineProperty(restore, "persisted", { value: true });
      window.dispatchEvent(restore);
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(1);
      expect(allText()).not.toContain(NOT_RECORDED);
    });

    it("twice is once", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.pause();
      instance.pause();
      await drainMicrotasks();

      expect(markers(SessionReplayCustomEventTag.IdlePaused)).toHaveLength(1);
    });
  });

  describe("resume()", (): void => {
    it("goes on in the same session, on a fresh snapshot of the page now", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      const sessionId: string = instance.getSessionId();
      const tabId: string = instance.getTabId();

      instance.pause();
      showNotRecordedPage();
      await advance(60 * 1000);

      // Back on a page it records: the earlier page's words are gone.
      (document.getElementById("secret") as HTMLElement).remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        "<h2>Project Settings</h2>",
      );

      instance.resume();
      await flushTick();

      expect(instance.isPausedByPage()).toBe(false);
      expect(instance.getState()).toBe("uploading");
      expect(instance.getSessionId()).toBe(sessionId);
      expect(instance.getTabId()).toBe(tabId);
      expect(fullSnapshots()).toBe(2);
      expect(markers(SessionReplayCustomEventTag.IdleResumed)).toHaveLength(1);
      expect(allText()).toContain("Project Settings");
      expect(allText()).not.toContain(NOT_RECORDED);
    });

    it("records again after it, until the next pause", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.pause();
      instance.resume();
      instance.track("after_resume");
      await flushTick();

      expect(allText()).toContain("after_resume");
    });

    it("does nothing on a recorder the page never paused", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.resume();
      await flushTick();

      expect(fullSnapshots()).toBe(1);
      expect(markers(SessionReplayCustomEventTag.IdleResumed)).toHaveLength(0);
    });

    it("starts the next session when the one it paused ran out meanwhile", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      const sessionId: string = instance.getSessionId();

      instance.pause();
      // Nobody at the page for longer than a session lasts idle.
      await advance(
        SESSION_REPLAY_IDLE_ROLLOVER_MS + SESSION_REPLAY_FLUSH_INTERVAL_MS * 2,
      );

      instance.resume();
      await flushTick();

      expect(instance.getSessionId()).not.toBe(sessionId);
      expect(instance.getState()).toBe("uploading");
      expect(
        frames().some((frame: CapturedFrame): boolean => {
          return (
            frame.envelope.sessionId === instance.getSessionId() &&
            frame.envelope.hasFullSnapshot
          );
        }),
      ).toBe(true);
    });
  });

  describe("before start()", (): void => {
    it("starts paused: no snapshot of the page it asked not to have recorded", async (): Promise<void> => {
      showNotRecordedPage();

      const instance: Recorder = build();
      instance.pause();
      instance.start();
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(0);
      expect(allText()).not.toContain(NOT_RECORDED);
    });

    it("is still a sampled session, and uploads from the resume", async (): Promise<void> => {
      showNotRecordedPage();

      const instance: Recorder = build();
      instance.pause();
      instance.start();
      await flushTick();

      (document.getElementById("secret") as HTMLElement).remove();

      instance.resume();
      await flushTick();

      expect(instance.getState()).toBe("uploading");
      expect(fullSnapshots()).toBe(1);
      expect(allText()).toContain("Create Monitor");
      expect(allText()).not.toContain(NOT_RECORDED);
    });

    it("forgets a pause the page took back before start()", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.pause();
      instance.resume();
      instance.start();
      await flushTick();

      expect(instance.getState()).toBe("uploading");
      expect(fullSnapshots()).toBe(1);
    });
  });

  describe("through window.OneUptimeReplay and its queue", (): void => {
    const importIndex: () => Promise<
      typeof import("../src/Index")
    > = async (): Promise<typeof import("../src/Index")> => {
      let index: typeof import("../src/Index") | null = null;

      await jest.isolateModulesAsync(async (): Promise<void> => {
        index = await import("../src/Index");
      });

      return index as unknown as typeof import("../src/Index");
    };

    afterEach((): void => {
      delete globalRecord["__ONEUPTIME_SESSION_REPLAY_STARTED__"];
      delete globalRecord["OneUptimeReplayQueue"];
    });

    it("starts paused when the page queued pause() before the artifact arrived", async (): Promise<void> => {
      showNotRecordedPage();
      globalRecord["OneUptimeReplayQueue"] = [["grantConsent"], ["pause"]];

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig());
      await flushTick();

      expect(index.getDiagnostics().state).toBe("paused");
      expect(fullSnapshots()).toBe(0);
      expect(allText()).not.toContain(NOT_RECORDED);

      // The live queue resumes it, on the page as it is then.
      (document.getElementById("secret") as HTMLElement).remove();
      (globalRecord["OneUptimeReplayQueue"] as Array<unknown>).push(["resume"]);
      await flushTick();

      expect(index.getDiagnostics().state).toBe("uploading");
      expect(fullSnapshots()).toBe(1);

      (globalRecord["OneUptimeReplayQueue"] as Array<unknown>).push(["pause"]);
      expect(index.getDiagnostics().state).toBe("paused");

      index.stop();
    });

    it("exposes pause() and resume() on the API", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig());
      await drainMicrotasks();

      index.pause();
      expect(index.getDiagnostics().state).toBe("paused");

      index.resume();
      expect(index.getDiagnostics().state).toBe("uploading");

      index.stop();
    });
  });

  describe("beside the idle pause", (): void => {
    it("holds a recorder already paused for idle, so input no longer resumes it", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      await advance(
        SESSION_REPLAY_IDLE_PAUSE_MS + SESSION_REPLAY_FLUSH_INTERVAL_MS,
      );
      expect(instance.isPausedForIdle()).toBe(true);

      instance.pause();
      input("mousedown");
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(1);

      instance.resume();
      await flushTick();

      expect(instance.getState()).toBe("uploading");
      expect(fullSnapshots()).toBe(2);
    });

    it("leaves the idle pause as it was: input still resumes it", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      await advance(
        SESSION_REPLAY_IDLE_PAUSE_MS + SESSION_REPLAY_FLUSH_INTERVAL_MS,
      );

      input("mousedown");
      await flushTick();

      expect(instance.getState()).toBe("uploading");

      const idleMarker: SessionReplayIdlePausedPayload = (
        markers(SessionReplayCustomEventTag.IdlePaused)[0] as RecordedEvent
      ).data["payload"] as SessionReplayIdlePausedPayload;

      // An idle pause says no reason: every pause older recorders made.
      expect(idleMarker.reason).toBeUndefined();
    });
  });
});
