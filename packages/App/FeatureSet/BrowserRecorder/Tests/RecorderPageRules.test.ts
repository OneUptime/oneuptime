import {
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import {
  SessionReplayCustomEventTag,
  SessionReplayIdlePausedPayload,
  SessionReplayIdleResumedPayload,
  SessionReplayRoutePayload,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { SessionReplayPageRules } from "Common/Types/Rum/SessionReplayPageRules";
import { RecorderInitOptions } from "../src/Config";
import { DebugRecord, clearDebugRecords, getDebugRecords } from "../src/Debug";
import Recorder from "../src/Recorder";

/*
 * THE REPLAY POLICY'S PAGE RULES (issue #7502): Record only these pages and
 * Never record these pages, without a line of the page's own code.
 *
 * A page the rules keep out is never in the bytes: not its DOM, not its
 * address. Capture is held the moment the address changes - inside the
 * history call itself, before the router draws the page - and on a page
 * the recorder starts on. Leaving it for a page the rules record goes on in
 * the same session once that page has drawn, on a fresh snapshot, with the
 * route recorded from the last page the recording held. The page's own
 * pause() and resume() still hold: resume() never lets go of a page the
 * rules keep out, and pause() outlasts them.
 *
 * Built on a fake clock imported fresh for each test, as the page pause
 * suite is: rrweb reads Date.now once, when first imported.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

const ORIGIN: string = "https://shop.example.com";

const CHUNK_PATH: string = "session-replay/v1/chunk";

const EVENT_TYPE_FULL_SNAPSHOT: number = 2;
const EVENT_TYPE_CUSTOM: number = 5;

// Words only a page the rules keep out shows.
const KEPT_OUT: string = "Payroll of Hartwell Ltd";

// Words only a page the rules record shows.
const RECORDED: string = "Your basket";

function config(
  pageRules: SessionReplayPageRules,
): SessionReplayConfigResponse {
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
    pageRules: pageRules,
  };
}

const NEVER_ADMIN: SessionReplayPageRules = {
  recordOnly: [],
  neverRecord: ["/admin*"],
};

interface RecordedEvent {
  type: number;
  timestamp: number;
  data: Record<string, unknown>;
}

interface CapturedFrame {
  envelope: SessionReplayChunkEnvelope;
  envelopeText: string;
  events: Array<RecordedEvent>;
  text: string;
}

describe("Recorder page rules (#7502)", (): void => {
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
    window.history.replaceState({}, "", "/checkout");
    document.body.innerHTML =
      "<div id='app'><h1>Checkout</h1><button id='go'>Go</button></div>";

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
    clearDebugRecords();

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

  const build: (pageRules?: SessionReplayPageRules) => Recorder = (
    pageRules: SessionReplayPageRules = NEVER_ADMIN,
  ): Recorder => {
    const instance: Recorder = new RecorderOnFakeClock({
      initOptions: INIT_OPTIONS,
      config: config(pageRules),
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

  // A router: the address, then the page, in the same task.
  const navigate: (path: string, words: string) => void = (
    path: string,
    words: string,
  ): void => {
    window.history.pushState({}, "", path);
    draw(words);
  };

  const draw: (words: string) => void = (words: string): void => {
    const app: HTMLElement = document.getElementById("app") as HTMLElement;
    app.innerHTML = `<h1>${words}</h1><p>${words}</p>`;
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

        const envelopeText: string = new TextDecoder().decode(
          rest.subarray(0, newline),
        );
        const envelope: SessionReplayChunkEnvelope = JSON.parse(
          envelopeText,
        ) as SessionReplayChunkEnvelope;
        const start: number = newline + 1;
        const end: number = start + envelope.payloadBytes;
        const text: string = new TextDecoder().decode(
          rest.subarray(start, end),
        );

        result.push({
          envelope: envelope,
          envelopeText: envelopeText,
          events: JSON.parse(text) as Array<RecordedEvent>,
          text: text,
        });

        offset += end;
      }
    }

    return result;
  };

  // Every byte that left the page: envelopes and events alike.
  const allBytes: () => string = (): string => {
    return frames()
      .map((frame: CapturedFrame): string => {
        return `${frame.envelopeText}\n${frame.text}`;
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

  const routes: () => Array<SessionReplayRoutePayload> =
    (): Array<SessionReplayRoutePayload> => {
      return markers(SessionReplayCustomEventTag.Route).map(
        (event: RecordedEvent): SessionReplayRoutePayload => {
          return event.data["payload"] as SessionReplayRoutePayload;
        },
      );
    };

  const fullSnapshots: () => number = (): number => {
    return events().filter((event: RecordedEvent): boolean => {
      return event.type === EVENT_TYPE_FULL_SNAPSHOT;
    }).length;
  };

  const debugCodes: () => Array<string> = (): Array<string> => {
    return getDebugRecords().map((record: DebugRecord): string => {
      return record.code;
    });
  };

  // The page drew and settled: the next frame, then one task.
  const settle: () => Promise<void> = async (): Promise<void> => {
    await advance(50);
  };

  // Seal the session, so every chunk - the final one too - has gone out.
  const seal: (instance: Recorder) => Promise<void> = async (
    instance: Recorder,
  ): Promise<void> => {
    instance.stop();
    await drainMicrotasks();
  };

  describe("Never record these pages", (): void => {
    it("pauses inside the history call, before the router draws the page", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      expect(instance.getState()).toBe("uploading");

      window.history.pushState({}, "", "/admin/payroll");

      // No timer ran: the pause happened inside pushState.
      expect(instance.getState()).toBe("paused");
      expect(instance.isPausedByPage()).toBe(true);

      draw(KEPT_OUT);
      await flushTick();

      const paused: Array<RecordedEvent> = markers(
        SessionReplayCustomEventTag.IdlePaused,
      );

      expect(paused).toHaveLength(1);
      expect(
        (
          (paused[0] as RecordedEvent).data[
            "payload"
          ] as SessionReplayIdlePausedPayload
        ).reason,
      ).toBe("page");
      expect(debugCodes()).toContain("recording-paused-page-rule");
    });

    it("never puts the page's words or its address in the bytes, the final chunk included", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      navigate("/admin/payroll", KEPT_OUT);
      await flushTick();

      // A burst on the page: a route of its own, a query, a hash.
      navigate("/admin/payroll/2026?month=11", `${KEPT_OUT} November`);
      window.history.replaceState({}, "", "/admin/payroll/2026#top");
      instance.track("viewed_payroll", { page: "admin" });
      await flushTick();

      await seal(instance);

      const bytes: string = allBytes();

      expect(frames().length).toBeGreaterThan(0);
      expect(bytes).not.toContain(KEPT_OUT);
      expect(bytes).not.toContain("/admin");
      expect(bytes).not.toContain("viewed_payroll");
      expect(bytes).toContain(`${ORIGIN}/checkout`);

      for (const frame of frames()) {
        expect(frame.envelope.url).not.toContain("/admin");
        expect(frame.envelope.url).toBe(`${ORIGIN}/checkout`);
      }

      expect(
        frames().some((frame: CapturedFrame): boolean => {
          return frame.envelope.isFinal;
        }),
      ).toBe(true);
    });

    it("goes on in the same session once a page it records has drawn, on a fresh snapshot", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      const sessionId: string = instance.getSessionId();

      navigate("/admin/payroll", KEPT_OUT);
      await flushTick();

      expect(fullSnapshots()).toBe(1);

      window.history.pushState({}, "", "/basket");

      // Not yet: the router has not drawn the page the address names.
      expect(instance.getState()).toBe("paused");

      draw(RECORDED);
      await settle();

      expect(instance.getState()).toBe("uploading");
      expect(instance.getSessionId()).toBe(sessionId);

      await flushTick();

      expect(fullSnapshots()).toBe(2);
      expect(allBytes()).toContain(RECORDED);
      expect(allBytes()).not.toContain(KEPT_OUT);

      const resumed: Array<RecordedEvent> = markers(
        SessionReplayCustomEventTag.IdleResumed,
      );

      expect(resumed).toHaveLength(1);
      expect(
        (
          (resumed[0] as RecordedEvent).data[
            "payload"
          ] as SessionReplayIdleResumedPayload
        ).reason,
      ).toBe("page");

      // The route from the last page the recording held, across the gap.
      expect(routes()).toEqual([
        {
          from: `${ORIGIN}/checkout`,
          to: `${ORIGIN}/basket`,
          kind: "pushState",
        },
      ]);

      await seal(instance);

      const last: CapturedFrame = frames()[
        frames().length - 1
      ] as CapturedFrame;

      expect(last.envelope.url).toBe(`${ORIGIN}/basket`);
      expect(allBytes()).not.toContain("/admin");
    });

    it("does not go on when the address moves on to a page it keeps out before the page drew", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      navigate("/admin/payroll", KEPT_OUT);
      window.history.pushState({}, "", "/basket");
      window.history.pushState({}, "", "/admin/users");
      draw(KEPT_OUT);
      await settle();
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(1);
      expect(allBytes()).not.toContain(KEPT_OUT);
    });

    it("starts held on a page it keeps out: no snapshot, no entry, no route names it", async (): Promise<void> => {
      window.history.replaceState({}, "", "/admin/payroll?id=7");
      draw(KEPT_OUT);

      const instance: Recorder = build();
      instance.start();
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(0);
      expect(debugCodes()).toContain("recording-paused-page-rule");

      navigate("/basket", RECORDED);
      await settle();
      await flushTick();
      await seal(instance);

      expect(fullSnapshots()).toBe(1);
      expect(allBytes()).not.toContain("/admin");
      expect(allBytes()).not.toContain(KEPT_OUT);
      expect(allBytes()).toContain(RECORDED);

      const first: CapturedFrame = frames()[0] as CapturedFrame;

      // The recording begins on the first page it holds.
      expect(first.envelope.meta?.entryUrl).toBe(`${ORIGIN}/basket`);

      for (const frame of frames()) {
        for (const route of frame.envelope.routes || []) {
          expect(route).toBe(`${ORIGIN}/basket`);
        }
      }

      expect(routes()).toEqual([
        { from: "", to: `${ORIGIN}/basket`, kind: "pushState" },
      ]);
    });

    it("a session that never leaves the page names it nowhere, even when it is sealed", async (): Promise<void> => {
      window.history.replaceState({}, "", "/admin/payroll");
      draw(KEPT_OUT);

      const instance: Recorder = build();
      instance.start();
      await flushTick();
      await seal(instance);

      expect(allBytes()).not.toContain("/admin");
      expect(allBytes()).not.toContain(KEPT_OUT);

      for (const frame of frames()) {
        expect(frame.envelope.url).toBe("");
        expect(frame.envelope.meta?.entryUrl || "").toBe("");
      }
    });

    it("keeps out a hash-routed page by its route", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      window.location.hash = "#/admin/payroll";
      window.dispatchEvent(new HashChangeEvent("hashchange"));

      expect(instance.getState()).toBe("paused");

      draw(KEPT_OUT);
      await flushTick();
      await seal(instance);

      expect(allBytes()).not.toContain(KEPT_OUT);
      expect(allBytes()).not.toContain("admin");
    });

    it("asks before a router listening for popstate draws the page", async (): Promise<void> => {
      // The page's router, listening the ordinary way since before the recorder.
      const router: () => void = (): void => {
        draw(KEPT_OUT);
      };

      window.addEventListener("popstate", router);

      try {
        const instance: Recorder = build();
        instance.start();
        await drainMicrotasks();

        // Back to a page the rules keep out: the address changes, then popstate.
        History.prototype.replaceState.call(
          window.history,
          {},
          "",
          "/admin/payroll",
        );
        window.dispatchEvent(new PopStateEvent("popstate"));

        expect(instance.getState()).toBe("paused");

        await flushTick();
        await seal(instance);

        expect(allBytes()).not.toContain(KEPT_OUT);
        expect(allBytes()).not.toContain("/admin");
      } finally {
        window.removeEventListener("popstate", router);
      }
    });

    it("is not resumed by the visitor's input", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      navigate("/admin/payroll", KEPT_OUT);

      for (const type of ["mousedown", "keydown", "wheel"]) {
        document.body.dispatchEvent(new Event(type, { bubbles: true }));
        await flushTick();
      }

      instance.captureSession("look");
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(1);
      expect(allBytes()).not.toContain(KEPT_OUT);
    });
  });

  describe("Record only these pages", (): void => {
    const ONLY_CHECKOUT: SessionReplayPageRules = {
      recordOnly: ["/checkout*"],
      neverRecord: [],
    };

    it("records the pages it names, and pauses on any other", async (): Promise<void> => {
      const instance: Recorder = build(ONLY_CHECKOUT);
      instance.start();
      await drainMicrotasks();

      expect(instance.getState()).toBe("uploading");

      navigate("/account/settings", KEPT_OUT);

      expect(instance.getState()).toBe("paused");

      await flushTick();

      navigate("/checkout/payment", RECORDED);
      await settle();
      await flushTick();
      await seal(instance);

      expect(instance.isStopped()).toBe(true);
      expect(allBytes()).toContain(RECORDED);
      expect(allBytes()).not.toContain(KEPT_OUT);
      expect(allBytes()).not.toContain("/account");
      expect(allBytes()).toContain(`${ORIGIN}/checkout/payment`);
    });

    it("starts held on a page it does not name", async (): Promise<void> => {
      window.history.replaceState({}, "", "/");

      const instance: Recorder = build(ONLY_CHECKOUT);
      instance.start();
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(0);
    });
  });

  it("Never record wins over Record only", async (): Promise<void> => {
    const instance: Recorder = build({
      recordOnly: ["/checkout*"],
      neverRecord: ["/checkout/card*"],
    });
    instance.start();
    await drainMicrotasks();

    expect(instance.getState()).toBe("uploading");

    navigate("/checkout/card", KEPT_OUT);

    expect(instance.getState()).toBe("paused");

    await flushTick();
    await seal(instance);

    expect(allBytes()).not.toContain(KEPT_OUT);
    expect(allBytes()).not.toContain("/checkout/card");
  });

  it("records every page when the policy has no rules, as before", async (): Promise<void> => {
    const instance: Recorder = build({ recordOnly: [], neverRecord: [] });
    instance.start();
    await drainMicrotasks();

    navigate("/admin/payroll", KEPT_OUT);
    await flushTick();
    await seal(instance);

    expect(instance.isPausedByPage()).toBe(false);
    expect(allBytes()).toContain(KEPT_OUT);
    expect(debugCodes()).not.toContain("recording-paused-page-rule");
  });

  it("records no page when the rules came but cannot be read", async (): Promise<void> => {
    const instance: Recorder = new RecorderOnFakeClock({
      initOptions: INIT_OPTIONS,
      config: {
        ...config(NEVER_ADMIN),
        pageRules: "garbage" as unknown as SessionReplayPageRules,
      },
    });

    started.push(instance);
    instance.start();
    await flushTick();

    expect(instance.getState()).toBe("paused");
    expect(fullSnapshots()).toBe(0);

    navigate("/basket", RECORDED);
    await settle();
    await flushTick();

    expect(instance.getState()).toBe("paused");
    expect(allBytes()).not.toContain(RECORDED);
  });

  describe("beside the page's own pause() and resume()", (): void => {
    it("resume() does not let go of a page the rules keep out", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      navigate("/admin/payroll", KEPT_OUT);
      instance.pause();
      instance.resume();
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(1);
      expect(allBytes()).not.toContain(KEPT_OUT);
    });

    it("pause() outlasts the rules: a page they record stays paused until resume()", async (): Promise<void> => {
      const instance: Recorder = build();
      instance.start();
      await drainMicrotasks();

      instance.pause();
      navigate("/admin/payroll", KEPT_OUT);
      navigate("/basket", RECORDED);
      await settle();
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(1);

      instance.resume();
      await flushTick();

      expect(instance.getState()).toBe("uploading");
      expect(fullSnapshots()).toBe(2);
      expect(allBytes()).toContain(RECORDED);
      expect(allBytes()).not.toContain(KEPT_OUT);
    });

    it("a pause() queued before start on a page the rules keep out starts held, and stays held after resume()", async (): Promise<void> => {
      window.history.replaceState({}, "", "/admin");

      const instance: Recorder = build();
      instance.pause();
      instance.start();
      instance.resume();
      await flushTick();

      expect(instance.getState()).toBe("paused");
      expect(fullSnapshots()).toBe(0);
    });
  });
});
