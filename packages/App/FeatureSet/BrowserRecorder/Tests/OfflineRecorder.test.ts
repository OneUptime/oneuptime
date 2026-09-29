import {
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { RecorderInitOptions, getChunkUrl } from "../src/Config";
import OfflineStore from "../src/OfflineStore";
import Recorder from "../src/Recorder";
import {
  databaseNames,
  framesOfBody,
  freshIndexedDb,
  resetBrowserOnline,
  setBrowserOnline,
  settle,
  testEnvelope,
} from "./OfflineTestUtils";

/*
 * Offline mode, end to end: the real recorder, rrweb and all, on a page
 * whose network goes away and comes back.
 *
 * What a customer was promised: when the web app goes offline it keeps
 * recording the session, and when it comes back online it pushes everything
 * it recorded to OneUptime - including what a tab recorded before it was
 * closed without ever getting its connection back.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

const SCOPE: string = `${getChunkUrl(INIT_OPTIONS)}#${INIT_OPTIONS.appIdentifier}`;

/* Records and uploads from the first event, with readable text. */
const recordEverything: () => SessionReplayConfigResponse =
  (): SessionReplayConfigResponse => {
    return {
      enabled: true,
      recorderVersion: "latest",
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
      respectDoNotTrack: false,
      configEpoch: 1,
      directive: "continue",
    };
  };

interface PostedFrame {
  envelope: SessionReplayChunkEnvelope;
  payload: string;
  keepalive: boolean;
}

const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
  string,
  unknown
>;

describe("Recorder offline mode", (): void => {
  let networkUp: boolean = true;
  let fetchMock: jest.Mock;
  const recorders: Array<Recorder> = [];

  const start: (
    overrides?: Partial<SessionReplayConfigResponse>,
    initOverrides?: Partial<RecorderInitOptions>,
  ) => Recorder = (
    overrides?: Partial<SessionReplayConfigResponse>,
    initOverrides?: Partial<RecorderInitOptions>,
  ): Recorder => {
    const instance: Recorder = new Recorder({
      initOptions: { ...INIT_OPTIONS, ...initOverrides },
      config: { ...recordEverything(), ...overrides },
    });

    instance.start();
    recorders.push(instance);

    return instance;
  };

  /* Every chunk frame the server accepted, in the order it arrived. */
  const delivered: () => Array<PostedFrame> = (): Array<PostedFrame> => {
    const frames: Array<PostedFrame> = [];

    for (const call of fetchMock.mock.calls) {
      if (String(call[0]).indexOf("session-replay/v1/chunk") < 0) {
        continue;
      }

      const init: Record<string, unknown> = call[1] as Record<string, unknown>;

      if (init["__failed"] === true) {
        continue;
      }

      for (const frame of framesOfBody(init["body"] as Uint8Array)) {
        frames.push({
          envelope: frame.envelope,
          payload: frame.payload,
          keepalive: init["keepalive"] === true,
        });
      }
    }

    return frames;
  };

  const deliveredFor: (tabId: string) => Array<PostedFrame> = (
    tabId: string,
  ): Array<PostedFrame> => {
    return delivered().filter((frame: PostedFrame): boolean => {
      return frame.envelope.tabId === tabId;
    });
  };

  const indexes: (frames: Array<PostedFrame>) => Array<number> = (
    frames: Array<PostedFrame>,
  ): Array<number> => {
    return frames.map((frame: PostedFrame): number => {
      return frame.envelope.chunkIndex;
    });
  };

  const goOffline: () => void = (): void => {
    networkUp = false;
    setBrowserOnline(false);
    window.dispatchEvent(new Event("offline"));
  };

  const goOnline: () => void = (): void => {
    networkUp = true;
    setBrowserOnline(true);
    window.dispatchEvent(new Event("online"));
  };

  /*
   * rrweb, compression and IndexedDB all hop through promises and tasks -
   * and a stored chunk is claimed in IndexedDB before it is posted, so a
   * backlog takes several rounds per chunk.
   */
  const drain: () => Promise<void> = async (): Promise<void> => {
    for (let round: number = 0; round < 20; round++) {
      for (let i: number = 0; i < 30; i++) {
        await Promise.resolve();
      }

      await settle(5);
    }
  };

  /*
   * One flush interval. Drained first: rrweb hears a DOM change through a
   * MutationObserver, a microtask, so what the test just appended has to
   * reach the chunk before the timer closes it.
   */
  const tick: () => Promise<void> = async (): Promise<void> => {
    await drain();
    jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS);
    await drain();
  };

  const appendText: (text: string) => void = (text: string): void => {
    const div: HTMLDivElement = document.createElement("div");

    div.textContent = text;
    document.body.appendChild(div);
  };

  const setVisibility: (state: "visible" | "hidden") => void = (
    state: "visible" | "hidden",
  ): void => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): string => {
        return state;
      },
    });
  };

  const pageHide: () => void = (): void => {
    const event: Event = new Event("pagehide");

    Object.defineProperty(event, "persisted", { value: false });
    window.dispatchEvent(event);
  };

  /* A closed tab: its listeners are gone and its timers never fire again. */
  const closeTab: (instance: Recorder) => void = (instance: Recorder): void => {
    instance.stop();
    jest.clearAllTimers();
  };

  beforeEach((): void => {
    jest.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "<div id='app'><p>content</p></div>";
    setVisibility("visible");
    freshIndexedDb();
    networkUp = true;
    setBrowserOnline(true);

    delete globalRecord["CompressionStream"];

    fetchMock = jest
      .fn()
      .mockImplementation(
        async (
          _url: string,
          init: Record<string, unknown>,
        ): Promise<unknown> => {
          if (!networkUp) {
            init["__failed"] = true;
            throw new TypeError("Failed to fetch");
          }

          return {
            status: 202,
            headers: {
              get: (): string | null => {
                return null;
              },
            },
            text: async (): Promise<string> => {
              return "";
            },
          };
        },
      );

    globalRecord["fetch"] = fetchMock;
    (window as unknown as Record<string, unknown>)["fetch"] = fetchMock;
  });

  afterEach(async (): Promise<void> => {
    /*
     * stop() still sends what was queued (it is the page's own stop), so
     * a stopped recorder's backlog would otherwise drain into the next
     * test's network. Discard it, and let anything in flight finish here.
     */
    for (const instance of recorders) {
      instance.stop();
      (
        instance as unknown as { transport: { discardQueue: () => void } }
      ).transport.discardQueue();
    }

    await drain();

    recorders.length = 0;
    resetBrowserOnline();
    setVisibility("visible");
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("keeps recording while offline and uploads the whole backlog when the connection returns", async (): Promise<void> => {
    const instance: Recorder = start();

    await drain();
    appendText("before-the-tunnel");
    await tick();

    const beforeTheTunnel: Array<number> = indexes(
      deliveredFor(instance.getTabId()),
    );

    expect(beforeTheTunnel.length).toBeGreaterThan(0);

    goOffline();

    for (let minute: number = 0; minute < 4; minute++) {
      appendText(`recorded-offline-${minute}`);
      await tick();
    }

    /* Nothing went anywhere, and nothing was given up on. */
    expect(indexes(delivered())).toEqual(beforeTheTunnel);
    expect(instance.isStopped()).toBe(false);
    expect(instance.getDecisions().uploadsAllowed).toBe(true);
    expect(instance.getDecisions().offline).toBe(true);
    expect(instance.getDecisions().queuedChunks).toBe(4);

    goOnline();
    await drain();

    const frames: Array<PostedFrame> = deliveredFor(instance.getTabId());

    /* Every chunk, in order, with no hole in the sequence. */
    expect(indexes(frames)).toEqual(
      Array.from(
        { length: beforeTheTunnel.length + 4 },
        (_: unknown, index: number): number => {
          return index;
        },
      ),
    );

    const everything: string = frames
      .map((frame: PostedFrame): string => {
        return frame.payload;
      })
      .join("");

    for (let minute: number = 0; minute < 4; minute++) {
      expect(everything).toContain(`recorded-offline-${minute}`);
    }

    /* One session throughout: going offline is not a new recording. */
    for (const frame of frames) {
      expect(frame.envelope.sessionId).toBe(instance.getSessionId());
    }

    expect(instance.getDecisions().offline).toBe(false);
    expect(instance.getDecisions().queuedChunks).toBe(0);
  });

  it("carries on recording after the connection returns, as if nothing happened", async (): Promise<void> => {
    const instance: Recorder = start();

    await tick();
    goOffline();
    appendText("offline");
    await tick();
    goOnline();
    await drain();

    appendText("back-online");
    await tick();

    const frames: Array<PostedFrame> = deliveredFor(instance.getTabId());

    expect(indexes(frames)).toEqual([0, 1, 2]);
    expect(frames[2]?.payload).toContain("back-online");
  });

  it("survives a connection that drops without the browser noticing", async (): Promise<void> => {
    const instance: Recorder = start();

    await tick();

    /* A captive portal: navigator.onLine stays true, requests go nowhere. */
    networkUp = false;

    for (let minute: number = 0; minute < 8; minute++) {
      appendText(`nowhere-${minute}`);
      await tick();
    }

    expect(instance.isStopped()).toBe(false);
    expect(instance.getDecisions().offline).toBe(true);

    /* The portal is signed into; the next retry gets through. */
    networkUp = true;
    jest.advanceTimersByTime(5 * 60_000);
    await drain();

    const frames: Array<PostedFrame> = deliveredFor(instance.getTabId());

    /* Contiguous from 0: nothing recorded behind the portal was lost. */
    expect(indexes(frames)).toEqual(
      Array.from(
        { length: frames.length },
        (_: unknown, index: number): number => {
          return index;
        },
      ),
    );

    const everything: string = frames
      .map((frame: PostedFrame): string => {
        return frame.payload;
      })
      .join("");

    for (let minute: number = 0; minute < 8; minute++) {
      expect(everything).toContain(`nowhere-${minute}`);
    }

    expect(instance.getDecisions().offline).toBe(false);
  });

  it("hands a tab closed while offline to the next page load, which uploads all of it", async (): Promise<void> => {
    const pageOne: Recorder = start();

    await tick();
    goOffline();
    await drain();

    appendText("written-offline");
    await tick();
    appendText("the-last-thing-before-close");
    await drain();

    pageHide();
    await drain();

    const pageOneTab: string = pageOne.getTabId();

    expect(indexes(deliveredFor(pageOneTab))).toEqual([0]);

    closeTab(pageOne);

    /* The next day: the application is opened again, with a connection. */
    goOnline();
    document.body.innerHTML = "<div id='app'><p>tomorrow</p></div>";

    const pageTwo: Recorder = start();

    await drain();

    const handedOver: Array<PostedFrame> = deliveredFor(pageOneTab);

    expect(indexes(handedOver)).toEqual([0, 1, 2]);

    /* Sealed: the session knows that tab ended where it did. */
    expect(handedOver[2]?.envelope.isFinal).toBe(true);
    expect(handedOver[1]?.payload).toContain("written-offline");
    expect(handedOver[2]?.payload).toContain("the-last-thing-before-close");

    /* Uploaded by page two, but still page one's recording. */
    expect(pageTwo.getTabId()).not.toBe(pageOneTab);

    expect(OfflineStore.hasPending()).toBe(false);
  });

  it("stores a hidden tab's open chunk whole while offline, not cut to the keepalive budget", async (): Promise<void> => {
    const instance: Recorder = start();

    await tick();
    goOffline();
    await drain();

    /* Far more than one keepalive request could ever carry. */
    const large: string = "L".repeat(SESSION_REPLAY_KEEPALIVE_MAX_BYTES);

    for (let part: number = 0; part < 3; part++) {
      appendText(`${part}-${large}`);
    }

    await drain();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await drain();

    /* Stored, not posted. */
    const beforeHiding: number = delivered().length;

    expect(OfflineStore.hasPending()).toBe(true);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    goOnline();
    await drain();

    const frames: Array<PostedFrame> = deliveredFor(instance.getTabId());
    const hidden: PostedFrame = frames[beforeHiding] as PostedFrame;

    expect(beforeHiding).toBeGreaterThan(0);
    expect(hidden.envelope.droppedEvents).toBe(0);

    for (let part: number = 0; part < 3; part++) {
      expect(hidden.payload).toContain(`${part}-${large}`);
    }
  });

  it("writes the queue to IndexedDB as it grows, not only at pagehide", async (): Promise<void> => {
    start();

    await tick();
    goOffline();

    for (let minute: number = 0; minute < 3; minute++) {
      appendText(`kept-${minute}`);
      await tick();
    }

    /*
     * Another page of the application loads now (the page itself is still
     * open): it finds all three already on disk.
     */
    expect(OfflineStore.hasPending()).toBe(true);
    expect(await databaseNames()).toEqual(["oneuptime-session-replay"]);
  });

  it("uploads each chunk exactly once when the recording tab is still open as another tab loads", async (): Promise<void> => {
    const pageOne: Recorder = start();

    await tick();
    goOffline();

    for (let minute: number = 0; minute < 3; minute++) {
      appendText(`shared-${minute}`);
      await tick();
    }

    /*
     * The connection comes back and a second tab of the application opens
     * before the first one retries; then both hear about it.
     */
    networkUp = true;
    setBrowserOnline(true);

    const tabTwoInitOptions: RecorderInitOptions = { ...INIT_OPTIONS };
    let SiblingRecorder: typeof Recorder = Recorder;

    await jest.isolateModulesAsync(async (): Promise<void> => {
      SiblingRecorder = (await import("../src/Recorder")).default;
    });

    const pageTwo: Recorder = new SiblingRecorder({
      initOptions: tabTwoInitOptions,
      config: recordEverything(),
    });

    pageTwo.start();
    recorders.push(pageTwo);

    window.dispatchEvent(new Event("online"));

    for (let round: number = 0; round < 3; round++) {
      jest.advanceTimersByTime(1_000);
      await drain();
    }

    const pageOneChunks: Array<number> = indexes(
      deliveredFor(pageOne.getTabId()),
    );

    expect(pageOneChunks.slice().sort()).toEqual([0, 1, 2, 3]);
  });

  describe("consent", (): void => {
    it("does not upload an earlier page's recording until this page has consent", async (): Promise<void> => {
      new OfflineStore(SCOPE).put([
        {
          envelope: testEnvelope({ chunkIndex: 3, tabId: "c".repeat(32) }),
          payload: "[]",
        },
      ]);
      await settle();

      const instance: Recorder = start({
        consentMode: SessionReplayConsentMode.RequireExplicit,
      });

      await drain();

      expect(delivered()).toEqual([]);
      expect(OfflineStore.hasPending()).toBe(true);

      instance.grantConsent();
      await drain();

      expect(indexes(deliveredFor("c".repeat(32)))).toEqual([3]);
    });

    it("deletes what an earlier page stored when consent is withdrawn", async (): Promise<void> => {
      new OfflineStore(SCOPE).put([
        {
          envelope: testEnvelope({ chunkIndex: 3, tabId: "c".repeat(32) }),
          payload: "[]",
        },
      ]);
      await settle();

      const instance: Recorder = start({
        consentMode: SessionReplayConsentMode.RequireExplicit,
      });

      await drain();
      instance.revokeConsent();
      await drain();

      expect(OfflineStore.hasPending()).toBe(false);
      expect(await new OfflineStore(SCOPE).takeAll()).toEqual([]);

      /* And a later grant has nothing of it to send. */
      instance.grantConsent();
      await drain();

      expect(deliveredFor("c".repeat(32))).toEqual([]);
    });

    it("deletes this page's own offline backlog when consent is withdrawn", async (): Promise<void> => {
      const instance: Recorder = start();

      await tick();
      goOffline();
      appendText("never-to-be-sent");
      await tick();

      instance.revokeConsent();
      await drain();

      goOnline();
      await drain();

      const everything: string = delivered()
        .map((frame: PostedFrame): string => {
          return frame.payload;
        })
        .join("");

      expect(everything).not.toContain("never-to-be-sent");
      expect(await new OfflineStore(SCOPE).takeAll()).toEqual([]);
    });
  });

  it("still uploads an earlier sampled page's backlog from a page that is not sampled", async (): Promise<void> => {
    new OfflineStore(SCOPE).put([
      {
        envelope: testEnvelope({ chunkIndex: 5, tabId: "c".repeat(32) }),
        payload: "[]",
      },
    ]);
    await settle();

    const instance: Recorder = start({ samplePercentage: 0 });

    await drain();

    expect(instance.getState()).toBe("not-sampled");
    expect(indexes(deliveredFor("c".repeat(32)))).toEqual([5]);
  });

  it("keeps what is waiting when the session reaches its chunk cap", async (): Promise<void> => {
    const instance: Recorder = start();

    await tick();
    goOffline();
    appendText("before-the-cap");
    await tick();

    /* The per-session chunk cap stops the recorder (Chunker.onTruncated). */
    (
      instance as unknown as {
        shutdown: (reason: string, seal: boolean) => void;
      }
    ).shutdown("chunk-cap", false);

    goOnline();
    jest.advanceTimersByTime(60_000);
    await drain();

    expect(indexes(deliveredFor(instance.getTabId()))).toEqual([0, 1]);
  });

  describe("offlineStorage: false", (): void => {
    it("still survives an outage the page lives through", async (): Promise<void> => {
      const instance: Recorder = start({}, { offlineStorage: false });

      await tick();
      goOffline();
      appendText("in-memory-only");
      await tick();
      goOnline();
      await drain();

      expect(indexes(deliveredFor(instance.getTabId()))).toEqual([0, 1]);
    });

    it("never writes the session to the visitor's disk", async (): Promise<void> => {
      start({}, { offlineStorage: false });

      await tick();
      goOffline();
      appendText("not-on-disk");
      await tick();
      pageHide();
      await drain();

      expect(await databaseNames()).toEqual([]);
      expect(OfflineStore.hasPending()).toBe(false);
    });
  });

  it("never opens IndexedDB for a visitor whose connection never drops", async (): Promise<void> => {
    const open: jest.SpyInstance = jest.spyOn(indexedDB, "open");

    start();

    for (let minute: number = 0; minute < 3; minute++) {
      appendText(`online-${minute}`);
      await tick();
    }

    pageHide();
    await drain();

    expect(open).not.toHaveBeenCalled();
    expect(await databaseNames()).toEqual([]);
  });
});
