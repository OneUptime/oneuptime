import { gunzipSync, strFromU8 } from "fflate";
import {
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SessionReplayChunkEnvelope,
} from "../src/Contract";
import {
  ReplayConnectivity,
  ReplayFetch,
  replayConfigCacheKey,
  validateStartOptions,
  ValidatedStartOptions,
} from "../src/Config";
import MobileReplayRecorder, {
  getReplayStorageNamespace,
  MobileReplayDiagnosticEvent,
} from "../src/MobileReplayRecorder";
import ReplayOutbox, { OutboxEntry } from "../src/Outbox";
import {
  enabledConfig,
  FakeAppState,
  FakeNativeViewTree,
  MemoryStorage,
  response,
  startOptions,
} from "./TestUtils";

/*
 * Offline mode, end to end, on the React Native recorder: an app whose
 * network goes away keeps recording, keeps what it records across being
 * killed, can even be LAUNCHED offline, and uploads all of it when the
 * connection returns.
 */

type ReplayFetchInit = NonNullable<Parameters<ReplayFetch>[1]>;

interface PostedFrame {
  envelope: SessionReplayChunkEnvelope;
  text: string;
}

/*
 * One device: its storage outlives any one app process, its network can be
 * switched off, and the server's policy can be changed between launches.
 */
class Device {
  public readonly storage: MemoryStorage = new MemoryStorage();
  public readonly posted: Array<PostedFrame> = [];
  public online: boolean = true;
  public configCalls: number = 0;
  public config: Record<string, unknown> = enabledConfig();
  public now: number = 1_750_000_000_000;
  public readonly fetch: jest.MockedFunction<ReplayFetch>;

  public constructor() {
    this.fetch = jest.fn(async (url: string, init: ReplayFetchInit = {}) => {
      if (!this.online) {
        throw new TypeError("Network request failed");
      }
      if (url.endsWith("/config")) {
        this.configCalls += 1;
        return response(200, this.config);
      }
      const body: Uint8Array = init.body as Uint8Array;
      const newline: number = body.indexOf(10);
      this.posted.push({
        envelope: JSON.parse(
          strFromU8(body.slice(0, newline)),
        ) as SessionReplayChunkEnvelope,
        text: strFromU8(gunzipSync(body.slice(newline + 1))),
      });
      return response(202, { directive: "continue", configEpoch: 7 });
    });
  }

  /* A fresh app process on this device. */
  public launch(): App {
    return new App(this);
  }

  public options(
    overrides: Parameters<typeof startOptions>[0] = {},
  ): ValidatedStartOptions {
    return validateStartOptions(
      startOptions({ fetch: this.fetch, ...overrides }),
    )!;
  }

  public outbox(): ReplayOutbox {
    return new ReplayOutbox(
      this.storage,
      getReplayStorageNamespace(this.options()),
      (): number => {
        return this.now;
      },
    );
  }

  public postedFor(tabId: string): Array<PostedFrame> {
    return this.posted.filter((frame: PostedFrame): boolean => {
      return frame.envelope.tabId === tabId;
    });
  }
}

class App {
  public readonly recorder: MobileReplayRecorder;
  public readonly native: FakeNativeViewTree = new FakeNativeViewTree();
  public readonly appState: FakeAppState = new FakeAppState();
  private changes: number = 0;

  public constructor(device: Device) {
    this.recorder = new MobileReplayRecorder({
      storage: device.storage,
      nativeViewTree: this.native,
      appState: this.appState,
      now: (): number => {
        return device.now;
      },
    });
    this.recorder.setRootTag(101);
  }

  /*
   * Something visibly different on screen, so the next chunk carries it.
   * Text is masked on the device - two strings of the same length look the
   * same once masked - so the layout moves as well.
   */
  public show(text: string): void {
    this.changes += 1;
    this.native.tree = {
      ...this.native.tree,
      children: [
        {
          nativeId: 2,
          kind: "text",
          x: 16,
          y: 24 + this.changes * 8,
          width: 120 + this.changes,
          height: 24,
          text: `${text}${"!".repeat(this.changes)}`,
          children: [],
        },
      ],
    };
  }

  public diagnosticCodes(): Array<string> {
    return this.recorder
      .getDiagnostics()
      .events.map((event: MobileReplayDiagnosticEvent): string => {
        return event.code;
      });
  }

  public tabId(): string {
    return this.recorder.getDiagnostics().sessionId === null
      ? ""
      : (this.recorder as unknown as { identity: { tabId: string } | null })
          .identity?.tabId ?? "";
  }
}

function indexes(frames: Array<PostedFrame>): Array<number> {
  return frames.map((frame: PostedFrame): number => {
    return frame.envelope.chunkIndex;
  });
}

function contiguousFromZero(frames: Array<PostedFrame>): Array<number> {
  return Array.from(
    { length: frames.length },
    (_: unknown, index: number): number => {
      return index;
    },
  );
}

describe("MobileReplayRecorder offline mode", () => {
  let device: Device;
  const apps: Array<App> = [];

  const launch: () => App = (): App => {
    const app: App = device.launch();
    apps.push(app);
    return app;
  };

  /* One flush interval of an app in the foreground. */
  const flushInterval: () => Promise<void> = async (): Promise<void> => {
    device.now += SESSION_REPLAY_FLUSH_INTERVAL_MS;
    await jest.advanceTimersByTimeAsync(SESSION_REPLAY_FLUSH_INTERVAL_MS);
  };

  const wait: (milliseconds: number) => Promise<void> = async (
    milliseconds: number,
  ): Promise<void> => {
    device.now += milliseconds;
    await jest.advanceTimersByTimeAsync(milliseconds);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    device = new Device();
  });

  afterEach(async () => {
    device.online = false;
    for (const app of apps) {
      await app.recorder.revokeConsent();
    }
    apps.length = 0;
    jest.useRealTimers();
  });

  test("keeps recording while offline and uploads everything once the connection returns", async () => {
    const app: App = launch();
    expect(await app.recorder.start(device.options())).toBe(true);
    await flushInterval();

    const beforeTheOutage: number = device.posted.length;
    expect(beforeTheOutage).toBeGreaterThan(0);

    device.online = false;
    for (let minute: number = 0; minute < 6; minute += 1) {
      app.show(`recorded-offline-${minute}`);
      await flushInterval();
    }

    /* Nothing arrived, nothing was given up on, recording never stopped. */
    expect(device.posted).toHaveLength(beforeTheOutage);
    expect(app.recorder.getDiagnostics().status).toBe("recording");
    expect(app.diagnosticCodes()).not.toContain("chunk-retry-exhausted");
    const waiting: Array<OutboxEntry> = await device.outbox().entries();
    expect(waiting.length).toBeGreaterThanOrEqual(6);
    for (const entry of waiting) {
      expect(entry.attempts).toBe(0);
    }

    device.online = true;
    await wait(60_000);

    const frames: Array<PostedFrame> = device.postedFor(
      device.posted[0]!.envelope.tabId,
    );
    expect(indexes(frames)).toEqual(contiguousFromZero(frames));

    /* Every change made offline reached the server: one frame per interval. */
    expect(frames.length).toBeGreaterThanOrEqual(beforeTheOutage + 6);
    for (let minute: number = 1; minute <= 6; minute += 1) {
      expect(
        frames.some((frame: PostedFrame): boolean => {
          return frame.text.includes(`top:${24 + minute * 8}px`);
        }),
      ).toBe(true);
    }
    expect(await device.outbox().entries()).toEqual([]);

    /* One session throughout. */
    expect(
      new Set(
        frames.map((frame: PostedFrame): string => {
          return frame.envelope.sessionId;
        }),
      ).size,
    ).toBe(1);
  });

  test("an app killed while offline uploads its recording on the next launch", async () => {
    const first: App = launch();
    await first.recorder.start(device.options());
    await flushInterval();

    device.online = false;
    for (let minute: number = 0; minute < 4; minute += 1) {
      first.show(`before-the-kill-${minute}`);
      await flushInterval();
    }

    const firstTab: string = device.posted[0]!.envelope.tabId;
    const deliveredBeforeKill: number = device.postedFor(firstTab).length;

    /* Killed: no stop(), no drain, its timers simply never fire again. */
    jest.clearAllTimers();
    apps.splice(apps.indexOf(first), 1);

    device.online = true;
    device.now += 60 * 60 * 1000;
    const second: App = launch();
    expect(await second.recorder.start(device.options())).toBe(true);
    await jest.advanceTimersByTimeAsync(0);

    const handedOver: Array<PostedFrame> = device.postedFor(firstTab);
    expect(handedOver.length).toBeGreaterThan(deliveredBeforeKill);
    expect(indexes(handedOver)).toEqual(contiguousFromZero(handedOver));
    expect(await device.outbox().entries()).toEqual([]);
  });

  test("an app LAUNCHED offline records under its last policy and uploads when online", async () => {
    /* Yesterday: an ordinary online launch, which remembers the policy. */
    const yesterday: App = launch();
    await yesterday.recorder.start(device.options());
    await yesterday.recorder.stop();
    expect(
      device.storage.values.has(
        replayConfigCacheKey(getReplayStorageNamespace(device.options())),
      ),
    ).toBe(true);

    /* Today: launched in airplane mode. */
    device.now += 12 * 60 * 60 * 1000;
    device.online = false;
    const configCallsBefore: number = device.configCalls;
    const postedBefore: number = device.posted.length;

    const today: App = launch();
    expect(await today.recorder.start(device.options())).toBe(true);
    expect(today.diagnosticCodes()).toContain("config-from-cache");
    expect(today.recorder.getDiagnostics().status).toBe("recording");

    for (let minute: number = 0; minute < 3; minute += 1) {
      today.show(`launched-offline-${minute}`);
      await flushInterval();
    }
    expect(device.posted).toHaveLength(postedBefore);

    /* Signal returns: the backlog goes, and the policy is fetched fresh. */
    device.online = true;
    await wait(60_000);

    const todaysFrames: Array<PostedFrame> = device.posted.slice(postedBefore);
    expect(todaysFrames.length).toBeGreaterThanOrEqual(3);
    expect(device.configCalls).toBeGreaterThan(configCallsBefore);
  });

  test("an app launched offline with no remembered policy records nothing", async () => {
    device.online = false;
    const app: App = launch();

    expect(await app.recorder.start(device.options())).toBe(false);
    expect(app.recorder.getDiagnostics().status).toBe("disabled");
    expect(await device.outbox().entries()).toEqual([]);
  });

  test("never records offline under a policy older than the offline delay", async () => {
    const earlier: App = launch();
    await earlier.recorder.start(device.options());
    await earlier.recorder.stop();

    device.now += SESSION_REPLAY_MAX_OFFLINE_DELAY_MS + 1;
    device.online = false;

    expect(await launch().recorder.start(device.options())).toBe(false);
  });

  test("forgets the remembered policy the moment the server says replay is off", async () => {
    const earlier: App = launch();
    await earlier.recorder.start(device.options());
    await earlier.recorder.stop();

    device.config = enabledConfig({ enabled: false, directive: "stop" });
    expect(await launch().recorder.start(device.options())).toBe(false);

    /* Offline now: there is no stale "on" to fall back to. */
    device.online = false;
    expect(await launch().recorder.start(device.options())).toBe(false);
  });

  test("never records a remembered policy as a targeted session", async () => {
    device.config = enabledConfig({ isTargeted: true });
    const earlier: App = launch();
    await earlier.recorder.start(device.options());
    expect(earlier.recorder.getDiagnostics().triggered).toBe(true);
    await earlier.recorder.stop();

    device.online = false;
    const offline: App = launch();
    await offline.recorder.start(device.options());

    expect(offline.recorder.getDiagnostics().triggered).toBe(false);
  });

  test("remembers nothing before an explicit consent the policy requires", async () => {
    device.config = enabledConfig({ consentMode: "RequireExplicit" });
    const app: App = launch();
    await app.recorder.start(device.options());

    expect(device.storage.values.size).toBe(0);

    await app.recorder.grantConsent();

    expect(
      device.storage.values.has(
        replayConfigCacheKey(getReplayStorageNamespace(device.options())),
      ),
    ).toBe(true);

    /* And forgets it with everything else when consent is withdrawn. */
    await app.recorder.revokeConsent();
    expect(device.storage.values.size).toBe(0);
  });

  describe("with a connectivity source", () => {
    interface FakeNetInfo {
      connectivity: ReplayConnectivity;
      emit(isConnected: boolean | null): void;
      unsubscribed: jest.Mock;
    }

    const netInfo: () => FakeNetInfo = (): FakeNetInfo => {
      let listener: ((isConnected: boolean | null) => void) | null = null;
      const unsubscribed: jest.Mock = jest.fn();
      return {
        connectivity: {
          subscribe(next: (isConnected: boolean | null) => void): () => void {
            listener = next;
            /* NetInfo reports the current state on subscription. */
            next(true);
            return unsubscribed;
          },
        },
        emit(isConnected: boolean | null): void {
          listener?.(isConnected);
        },
        unsubscribed,
      };
    };

    test("attempts nothing while it says offline, and uploads the moment it says online", async () => {
      const source: FakeNetInfo = netInfo();
      const app: App = launch();
      await app.recorder.start(
        device.options({ connectivity: source.connectivity }),
      );
      await flushInterval();
      const before: number = device.fetch.mock.calls.length;

      device.online = false;
      source.emit(false);
      for (let minute: number = 0; minute < 3; minute += 1) {
        app.show(`no-signal-${minute}`);
        await flushInterval();
      }

      /* Not one request made into a network the device knows is gone. */
      expect(device.fetch.mock.calls.length).toBe(before);
      expect(app.diagnosticCodes()).toContain("network-offline");

      device.online = true;
      const postedBefore: number = device.posted.length;
      source.emit(true);
      await jest.advanceTimersByTimeAsync(0);

      expect(device.posted.length).toBeGreaterThanOrEqual(postedBefore + 3);
      expect(app.diagnosticCodes()).toContain("network-online");
    });

    test("a connection coming back never uploads a stored backlog before this run's consent", async () => {
      /* A consented earlier run left frames behind in the outbox. */
      const earlier: App = launch();
      await earlier.recorder.start(device.options());
      device.online = false;
      earlier.show("from-the-earlier-run");
      await flushInterval();
      jest.clearAllTimers();
      apps.splice(apps.indexOf(earlier), 1);
      expect((await device.outbox().entries()).length).toBeGreaterThan(0);

      /* This run requires explicit consent, which it has not been given. */
      device.config = enabledConfig({ consentMode: "RequireExplicit" });
      device.online = true;
      const source: FakeNetInfo = netInfo();
      const app: App = launch();
      await app.recorder.start(
        device.options({ connectivity: source.connectivity }),
      );
      const postedBefore: number = device.posted.length;

      source.emit(false);
      source.emit(true);
      await jest.advanceTimersByTimeAsync(0);

      expect(device.posted).toHaveLength(postedBefore);
      expect((await device.outbox().entries()).length).toBeGreaterThan(0);
    });

    test("stops listening when the recorder stops", async () => {
      const source: FakeNetInfo = netInfo();
      const app: App = launch();
      await app.recorder.start(
        device.options({ connectivity: source.connectivity }),
      );

      await app.recorder.stop();

      expect(source.unsubscribed).toHaveBeenCalledTimes(1);
    });

    test("survives a connectivity source that throws", async () => {
      const app: App = launch();
      const started: boolean = await app.recorder.start(
        device.options({
          connectivity: {
            subscribe(): () => void {
              throw new Error("NetInfo is not linked");
            },
          },
        }),
      );

      expect(started).toBe(true);
      expect(app.diagnosticCodes()).toContain("connectivity-subscribe-failed");
    });
  });

  test("coming back to the foreground retries the backlog at once", async () => {
    const app: App = launch();
    await app.recorder.start(device.options());
    await flushInterval();

    device.online = false;
    app.show("while-in-a-tunnel");
    await flushInterval();
    await wait(5_000 + 15_000);

    app.appState.emit("background");
    await jest.advanceTimersByTimeAsync(0);

    const postedBefore: number = device.posted.length;
    device.online = true;
    device.now += 1_000;
    app.appState.emit("active");
    await jest.advanceTimersByTimeAsync(0);

    /* Well inside the one-minute backoff, the backlog already went. */
    expect(device.posted.length).toBeGreaterThan(postedBefore);
  });

  test("every chunk it sends says when it was sent, not when it was recorded", async () => {
    jest.setSystemTime(device.now);
    const app: App = launch();
    await app.recorder.start(device.options());
    await flushInterval();

    device.online = false;
    app.show("late");
    await flushInterval();

    /* Two hours without signal. */
    jest.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    device.online = true;
    await wait(60_000);

    const last: PostedFrame = device.posted[device.posted.length - 1]!;
    expect(last.envelope.clientSendUnixMs).toBeGreaterThanOrEqual(
      device.now - 60_000,
    );
    /*
     * The gap between the chunk's end and its send stamp is the two hours
     * it waited (the recorder's and the system clock differ by the minute
     * the test spent waiting for the retry).
     */
    const waitedMs: number =
      last.envelope.clientSendUnixMs -
      (last.envelope.sessionStartUnixMs + last.envelope.chunkEndOffsetMs);
    expect(waitedMs).toBeGreaterThan(2 * 60 * 60 * 1000 - 2 * 60_000);
    expect(waitedMs).toBeLessThan(2 * 60 * 60 * 1000 + 2 * 60_000);
  });
});
