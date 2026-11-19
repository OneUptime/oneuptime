import {
  ProductAnalyticsBatchParseResult,
  parseProductAnalyticsBatch,
} from "../../../../Common/Types/Rum/ProductAnalyticsEvents";
import { ReplayFetch, ReplayFetchResponse } from "../src/Config";
import { SessionReplayConsentState } from "../src/Contract";
import MobileProductAnalytics, {
  MobileProductAnalyticsHost,
  PRODUCT_ANALYTICS_MAX_STORED_BYTES,
  PRODUCT_ANALYTICS_STORE_DELAY_MS,
  PRODUCT_ANALYTICS_STORED_QUEUE_VERSION,
  ProductAnalyticsAppState,
  clearStoredProductAnalytics,
  productAnalyticsQueueKey,
  productAnalyticsSessionKey,
} from "../src/ProductAnalytics";
import {
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS,
  PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
  ProductAnalyticsEventKind,
  ProductAnalyticsWireBatch,
  ProductAnalyticsWireEvent,
} from "../src/ProductAnalyticsContract";
import {
  byteLength,
  maskStringMapValues,
  sanitizeEventProperties,
} from "../src/Sanitize";
import { ReplayStorage } from "../src/Storage";
import { FakeAppState, MemoryStorage, response } from "./TestUtils";

/*
 * What the React Native recorder's product analytics channel keeps in the
 * device's storage (issue #9577): the events and metric points it has not
 * sent, and the batch on its way, so an app used offline and then killed -
 * or stopped by the system in the background - still counts that session
 * on the next start(), under the session and the person each happened
 * under. Bounded as what it holds in memory is, never written before
 * consent, and removed when consent is withdrawn.
 *
 * A relaunch is a second channel over the same storage, as the recorder
 * makes one on its next start(); "killed" is a channel that is simply
 * never stopped.
 */

const SESSION_A: string = "a".repeat(32);
const SESSION_B: string = "b".repeat(32);
const VISITOR: string = "c".repeat(32);
const NAMESPACE: string = "v1-store";
const QUEUE_KEY: string = productAnalyticsQueueKey(NAMESPACE);
const STARTED_AT: number = Date.parse("2026-11-18T09:00:00.000Z");

interface HostState {
  sessionId: string;
  consentState: SessionReplayConsentState;
  requiresConsent: boolean;
  userRef: string;
  traits: Record<string, string> | null;
}

type Answer = { status: number } | "network-error" | "never";

interface SentRequest {
  body: string;
  batch: ProductAnalyticsWireBatch;
}

interface Diagnostic {
  code: string;
  details?: Record<string, unknown> | undefined;
}

/* Storage whose writes take a while, as AsyncStorage's do on a busy phone. */
class SlowStorage extends MemoryStorage {
  public delayMs: number = 50;

  public override async setItem(key: string, value: string): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, this.delayMs);
    });
    await super.setItem(key, value);
  }
}

/* Storage that cannot be written at all: a full device. */
class FullStorage extends MemoryStorage {
  public override async setItem(): Promise<void> {
    throw new Error("Database or disk is full");
  }
}

describe("MobileProductAnalytics: what the device keeps unsent", (): void => {
  let state: HostState;
  let answers: Array<Answer>;
  let sent: Array<SentRequest>;
  let diagnostics: Array<Diagnostic>;
  let storage: MemoryStorage;
  let appState: FakeAppState;
  let channels: Array<MobileProductAnalytics>;
  let connectivityListener: ((isConnected: boolean | null) => void) | null;

  const fetchMock: jest.MockedFunction<ReplayFetch> = jest.fn();

  function makeHost(
    overrides: Partial<MobileProductAnalyticsHost> = {},
  ): MobileProductAnalyticsHost {
    return {
      url: "https://oneuptime.example/telemetry/session-replay/v1/events",
      headers: { "x-oneuptime-token": "token" },
      fetch: fetchMock,
      now: (): number => {
        return Date.now();
      },
      storage: storage,
      namespace: NAMESPACE,
      appState: appState as unknown as ProductAnalyticsAppState,
      connectivity: {
        subscribe: (listener: (isConnected: boolean | null) => void) => {
          connectivityListener = listener;
          return (): void => {
            connectivityListener = null;
          };
        },
      },
      getSessionId: (): string => {
        return state.sessionId;
      },
      peekSessionId: (): string => {
        return state.sessionId;
      },
      getVisitorId: (): string => {
        return state.sessionId ? VISITOR : "";
      },
      getConsentState: (): SessionReplayConsentState => {
        return state.consentState;
      },
      requiresConsent: (): boolean => {
        return state.requiresConsent;
      },
      getIdentity: (): {
        userRef: string;
        traits: Record<string, string> | null;
      } => {
        return { userRef: state.userRef, traits: state.traits };
      },
      toProperties: (value: unknown): Record<string, string> => {
        return maskStringMapValues(sanitizeEventProperties(value));
      },
      getContext: () => {
        return {
          deviceType: "mobile",
          browserName: "",
          osName: "ios",
          appVersion: "2.4.1",
        };
      },
      onDiagnostic: (code: string, details?: Record<string, unknown>): void => {
        diagnostics.push({ code, details });
      },
      ...overrides,
    };
  }

  async function startChannel(
    options: {
      userPropertyKeys?: Array<string>;
      host?: Partial<MobileProductAnalyticsHost>;
    } = {},
  ): Promise<MobileProductAnalytics> {
    const channel: MobileProductAnalytics = new MobileProductAnalytics(
      makeHost(options.host),
      { enabled: true, userPropertyKeys: options.userPropertyKeys ?? [] },
    );
    channels.push(channel);
    await channel.start();
    return channel;
  }

  async function settle(): Promise<void> {
    await jest.advanceTimersByTimeAsync(0);
  }

  async function nextFlush(): Promise<void> {
    await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);
  }

  /* Long enough for a change to be written. */
  async function storeDelay(): Promise<void> {
    await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_STORE_DELAY_MS);
  }

  function stored(): Record<string, unknown> | null {
    const raw: string | undefined = storage.values.get(QUEUE_KEY);

    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }

  function storedNames(): Array<string> {
    const queue: Record<string, unknown> | null = stored();

    if (!queue) {
      return [];
    }

    return (queue["items"] as Array<Record<string, unknown>>).map(
      (item: Record<string, unknown>): string => {
        const event: Record<string, unknown> | undefined = item["e"] as
          | Record<string, unknown>
          | undefined;

        return event
          ? `${event["kind"]}:${event["name"]}`
          : `metric:${(item["m"] as Record<string, unknown>)["name"]}`;
      },
    );
  }

  function sentNames(): Array<string> {
    return sent.flatMap((request: SentRequest): Array<string> => {
      return [
        ...request.batch.events.map(
          (event: ProductAnalyticsWireEvent): string => {
            return `${event.kind}:${event.name}`;
          },
        ),
        ...request.batch.metrics.map((metric: { name: string }): string => {
          return `metric:${metric.name}`;
        }),
      ];
    });
  }

  function codes(): Array<string> {
    return diagnostics.map((diagnostic: Diagnostic): string => {
      return diagnostic.code;
    });
  }

  /* The device loses its connection: the channel holds what happens next. */
  function goOffline(): void {
    connectivityListener?.(false);
  }

  beforeEach((): void => {
    jest.useFakeTimers();
    jest.setSystemTime(STARTED_AT);
    state = {
      sessionId: SESSION_A,
      consentState: "NotRequired",
      requiresConsent: false,
      userRef: "",
      traits: null,
    };
    answers = [];
    sent = [];
    diagnostics = [];
    storage = new MemoryStorage();
    appState = new FakeAppState();
    channels = [];
    connectivityListener = null;
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async (
        _url: string,
        init?: Parameters<ReplayFetch>[1],
      ): Promise<ReplayFetchResponse> => {
        const body: string = (init?.body as string) ?? "";

        sent.push({
          body: body,
          batch: JSON.parse(body) as ProductAnalyticsWireBatch,
        });

        const answer: Answer = answers.shift() ?? { status: 202 };

        if (answer === "network-error") {
          throw new TypeError("Network request failed");
        }

        if (answer === "never") {
          return new Promise<ReplayFetchResponse>(
            (
              _resolve: (value: ReplayFetchResponse) => void,
              reject: (reason?: unknown) => void,
            ): void => {
              init?.signal?.addEventListener("abort", (): void => {
                reject(new Error("aborted"));
              });
            },
          );
        }

        return response(answer.status, {}, {});
      },
    );
  });

  afterEach((): void => {
    for (const channel of channels) {
      channel.stop();
    }
    jest.useRealTimers();
  });

  describe("an app used offline, then killed", (): void => {
    it("sends what it held on the next start(), under the session and the person it happened under", async (): Promise<void> => {
      state.userRef = "user-42";
      state.traits = maskStringMapValues({ plan: "pro" });

      const first: MobileProductAnalytics = await startChannel({
        userPropertyKeys: ["plan"],
      });

      goOffline();
      first.page("/Basket");
      first.track("Checkout started", { cartSize: 3 });
      first.metric("cart.value", 42.5, { currency: "EUR" });
      await storeDelay();
      await nextFlush();

      expect(sent).toHaveLength(0);
      expect(storedNames()).toEqual([
        "session:",
        "page:/Basket",
        "custom:Checkout started",
        "metric:cart.value",
      ]);

      /*
       * Killed: never stopped. The next launch is somebody else's session,
       * signed out, an hour later.
       */
      jest.setSystemTime(STARTED_AT + 60 * 60 * 1000);
      state.sessionId = SESSION_B;
      state.userRef = "";
      state.traits = null;

      const second: MobileProductAnalytics = new MobileProductAnalytics(
        makeHost(),
        { enabled: true, userPropertyKeys: ["plan"] },
      );
      channels.push(second);
      await second.start();
      await nextFlush();
      await nextFlush();

      expect(sent.length).toBeGreaterThanOrEqual(2);

      const earlier: ProductAnalyticsWireBatch = sent[0]!.batch;

      expect(earlier.sessionId).toBe(SESSION_A);
      expect(earlier.userRef).toBe("user-42");
      expect(earlier.userProperties).toEqual({ plan: "••••" });
      expect(
        earlier.events.map((event: ProductAnalyticsWireEvent): string => {
          return `${event.kind}:${event.name}`;
        }),
      ).toEqual(["session:", "page:/Basket", "custom:Checkout started"]);
      expect(earlier.metrics).toEqual([
        {
          name: "cart.value",
          value: 42.5,
          at: STARTED_AT,
          attributes: { currency: "••••" },
        },
      ]);

      const later: ProductAnalyticsWireBatch = sent[1]!.batch;

      expect(later.sessionId).toBe(SESSION_B);
      expect(later.userRef).toBeUndefined();
      expect(
        later.events.map((event: ProductAnalyticsWireEvent): string => {
          return event.kind;
        }),
      ).toEqual([ProductAnalyticsEventKind.Session]);

      /* Sent: nothing is kept any more. */
      await storeDelay();
      expect(stored()).toBeNull();
      expect(codes()).toContain("analytics-restored");
    });

    it("files each event when it happened, however long after it is sent", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Paid");
      await storeDelay();

      const relaunchedAt: number = STARTED_AT + 26 * 60 * 60 * 1000;

      jest.setSystemTime(relaunchedAt);
      await startChannel();
      await nextFlush();

      const request: SentRequest = sent[0]!;
      const parsed: ProductAnalyticsBatchParseResult =
        parseProductAnalyticsBatch(JSON.parse(request.body), {
          receivedAtUnixMs: request.batch.sentAt,
          allowedUserPropertyKeys: [],
        });

      expect(parsed.isValid).toBe(true);

      if (!parsed.isValid) {
        return;
      }

      expect(
        parsed.batch.events.map((event: { name: string; time: number }) => {
          return [event.name, event.time];
        }),
      ).toEqual([
        ["", STARTED_AT],
        ["Paid", STARTED_AT],
      ]);
    });

    it("sends the batch that was on its way again under its own id, with a fresh sentAt", async (): Promise<void> => {
      answers.push("never");

      const first: MobileProductAnalytics = await startChannel();

      first.track("Paid");
      await nextFlush();

      /* The request hangs; the app is killed while it does. */
      expect(sent).toHaveLength(1);
      await storeDelay();
      expect(
        (stored()?.["pending"] as Record<string, unknown> | null)?.["batchId"],
      ).toBe(sent[0]!.batch.batchId);

      jest.setSystemTime(STARTED_AT + 10 * 60 * 1000);
      await startChannel();
      await nextFlush();

      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
      expect(sent[1]!.batch.events).toEqual(sent[0]!.batch.events);
      expect(sent[1]!.batch.sentAt).toBe(
        STARTED_AT + 10 * 60 * 1000 + PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
      );
    });

    it("writes a change once its burst is over, not on every call", async (): Promise<void> => {
      const setItem: jest.SpyInstance = jest.spyOn(storage, "setItem");
      const first: MobileProductAnalytics = await startChannel();

      goOffline();

      const writesBefore: number = setItem.mock.calls.filter(
        (call: Array<unknown>): boolean => {
          return call[0] === QUEUE_KEY;
        },
      ).length;

      for (let index: number = 0; index < 20; index++) {
        first.track(`Tap ${index}`);
      }

      /* Killed inside the burst: nothing of it was written yet. */
      expect(storedNames()).toEqual([]);

      await storeDelay();

      expect(
        setItem.mock.calls.filter((call: Array<unknown>): boolean => {
          return call[0] === QUEUE_KEY;
        }).length - writesBefore,
      ).toBe(1);
      expect(storedNames()).toHaveLength(21);
    });

    it("writes at once when the app leaves the foreground, where the system may stop it", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Backgrounded");
      appState.emit("background");
      await settle();

      expect(storedNames()).toEqual(["session:", "custom:Backgrounded"]);
    });

    it("writes what it holds when the app stops the recorder, for the next start() to send", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Before stop");
      first.stop();
      await settle();

      expect(storedNames()).toEqual(["session:", "custom:Before stop"]);

      await startChannel();
      await nextFlush();

      expect(sentNames()).toEqual(["session:", "custom:Before stop"]);
    });

    it("reads what the channel before it is still writing, never an older copy", async (): Promise<void> => {
      const slow: SlowStorage = new SlowStorage();

      storage = slow;

      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Written slowly");
      first.stop();

      /* The write has not landed when the next channel starts reading. */
      expect(slow.values.has(QUEUE_KEY)).toBe(false);

      const startSecond: Promise<MobileProductAnalytics> = startChannel();

      await jest.advanceTimersByTimeAsync(slow.delayMs);
      await startSecond;
      await nextFlush();

      expect(sentNames()).toEqual(["session:", "custom:Written slowly"]);
    });

    it("never overwrites what a previous launch kept before it has read it back", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Kept");
      await storeDelay();

      const keptValue: string | undefined = storage.values.get(QUEUE_KEY);

      expect(keptValue).toBeDefined();

      /* A channel stopped while it was still reading the queue back. */
      const second: MobileProductAnalytics = new MobileProductAnalytics(
        makeHost(),
        { enabled: true, userPropertyKeys: [] },
      );
      channels.push(second);

      const starting: Promise<void> = second.start();

      second.stop();
      await starting;
      await storeDelay();

      expect(storage.values.get(QUEUE_KEY)).toBe(keptValue);
    });
  });

  describe("bounds", (): void => {
    it("drops what is older than the server keeps, counting the events", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Too old");
      first.metric("too.old", 1);
      await storeDelay();

      jest.setSystemTime(STARTED_AT + PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS + 1);
      state.sessionId = SESSION_B;

      const second: MobileProductAnalytics = await startChannel();

      await nextFlush();

      expect(sentNames()).toEqual(["session:"]);
      expect(sent[0]!.batch.sessionId).toBe(SESSION_B);
      expect(second.getDiagnostics().dropped).toBe(2);
      expect(diagnostics).toContainEqual({
        code: "analytics-restored",
        details: {
          events: 0,
          metrics: 0,
          droppedTooOld: 2,
          droppedOverCap: 0,
        },
      });
    });

    it("holds at most 500 events across a relaunch, the oldest dropped first and counted", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();

      for (let index: number = 0; index < 520; index++) {
        first.track(`Event ${index}`);
      }

      await storeDelay();

      expect(storedNames()).toHaveLength(PRODUCT_ANALYTICS_MAX_PENDING_EVENTS);
      expect(first.getDiagnostics().dropped).toBe(21);

      /* The next launch opens a new session: its start is one more event. */
      state.sessionId = SESSION_B;

      const second: MobileProductAnalytics = await startChannel();

      expect(second.getDiagnostics().pending).toBe(
        PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
      );
      expect(second.getDiagnostics().dropped).toBe(1);

      for (let step: number = 0; step < 12; step++) {
        await nextFlush();
      }

      const names: Array<string> = sentNames();

      expect(names).toHaveLength(PRODUCT_ANALYTICS_MAX_PENDING_EVENTS);
      expect(names[0]).toBe("custom:Event 21");
      expect(names[names.length - 1]).toBe("session:");
    });

    it("keeps the stored copy under its size, the newest kept", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();
      const wide: Record<string, string> = {};

      for (let index: number = 0; index < 20; index++) {
        wide[`property_${index}_${"k".repeat(28)}`] = "v".repeat(200);
      }

      goOffline();

      for (let index: number = 0; index < 499; index++) {
        first.track(`Wide ${index}`, wide);
      }

      await storeDelay();

      const raw: string = storage.values.get(QUEUE_KEY) as string;

      expect(byteLength(raw)).toBeLessThanOrEqual(
        PRODUCT_ANALYTICS_MAX_STORED_BYTES,
      );

      const names: Array<string> = storedNames();

      expect(names.length).toBeGreaterThan(50);
      expect(names.length).toBeLessThan(500);
      expect(names[names.length - 1]).toBe("custom:Wide 498");
      /* Still sent whole while the app runs. */
      expect(first.getDiagnostics().pending).toBe(500);
    });

    it("keeps each person's and session's details once, however many items share them", async (): Promise<void> => {
      state.userRef = "user-42";

      const first: MobileProductAnalytics = await startChannel();

      goOffline();

      for (let index: number = 0; index < 30; index++) {
        first.track(`Tap ${index}`);
      }

      await storeDelay();

      expect(stored()?.["v"]).toBe(PRODUCT_ANALYTICS_STORED_QUEUE_VERSION);
      expect(stored()?.["scopes"]).toEqual([
        { sessionId: SESSION_A, userRef: "user-42", userProperties: {} },
      ]);
    });

    it("keeps running in memory when the device has no room to write", async (): Promise<void> => {
      storage = new FullStorage();

      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("No room");
      await storeDelay();
      connectivityListener?.(true);
      await settle();

      expect(sentNames()).toEqual(["session:", "custom:No room"]);
    });
  });

  describe("consent", (): void => {
    it("never writes what it holds before consent: it has no session yet", async (): Promise<void> => {
      state.requiresConsent = true;
      state.consentState = "Unknown";
      state.sessionId = "";

      const first: MobileProductAnalytics = await startChannel();

      first.track("Before consent");
      first.metric("before.consent", 1);
      appState.emit("background");
      await storeDelay();

      expect(first.getDiagnostics().pending).toBe(2);
      expect(storage.values.has(QUEUE_KEY)).toBe(false);
    });

    it("writes what it held once the grant names its session", async (): Promise<void> => {
      state.requiresConsent = true;
      state.consentState = "Unknown";
      state.sessionId = "";

      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Before consent");

      state.consentState = "Granted";
      state.sessionId = SESSION_A;
      first.onConsentGranted();
      await storeDelay();

      expect(storedNames()).toEqual(["session:", "custom:Before consent"]);
    });

    it("withdrawn, what was written goes, and nothing comes back on the next start()", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Before withdrawal");
      await storeDelay();
      expect(storage.values.has(QUEUE_KEY)).toBe(true);

      first.forget();
      await settle();

      expect(storage.values.has(QUEUE_KEY)).toBe(false);
      expect(storage.values.has(productAnalyticsSessionKey(NAMESPACE))).toBe(
        false,
      );

      /* What it held after the withdrawal is not written either. */
      first.track("After withdrawal");
      first.stop();
      await storeDelay();
      expect(storage.values.has(QUEUE_KEY)).toBe(false);

      await startChannel();
      await nextFlush();

      expect(sentNames()).toEqual(["session:"]);
    });

    it("withdrawn while the queue is being read back, nothing of it comes back", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Before withdrawal");
      await storeDelay();

      const second: MobileProductAnalytics = new MobileProductAnalytics(
        makeHost(),
        { enabled: true, userPropertyKeys: [] },
      );
      channels.push(second);

      const starting: Promise<void> = second.start();

      /* As the recorder withdraws: its session goes with the consent. */
      second.forget();
      state.sessionId = "";
      await starting;
      await settle();

      expect(second.getDiagnostics().pending).toBe(0);
      expect(storage.values.has(QUEUE_KEY)).toBe(false);
    });

    it("a policy that starts waiting for consent removes what was written", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Before the policy changed");
      await storeDelay();

      first.reset();
      await settle();

      expect(storage.values.has(QUEUE_KEY)).toBe(false);
    });

    it("clearStoredProductAnalytics removes what a launch kept, with no channel running", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      goOffline();
      first.track("Kept");
      await storeDelay();
      first.stop();
      await settle();

      expect(storage.values.has(QUEUE_KEY)).toBe(true);

      await clearStoredProductAnalytics(storage, NAMESPACE);

      expect(storage.values.has(QUEUE_KEY)).toBe(false);
      expect(storage.values.has(productAnalyticsSessionKey(NAMESPACE))).toBe(
        false,
      );
    });
  });

  describe("the server", (): void => {
    it.each([204, 400, 403])(
      "refusing this app's batches for good (%d), what was written goes too",
      async (status: number): Promise<void> => {
        const first: MobileProductAnalytics = await startChannel();

        goOffline();
        first.track("Held");
        await storeDelay();
        expect(storage.values.has(QUEUE_KEY)).toBe(true);

        answers.push({ status: status });
        connectivityListener?.(true);
        await settle();

        expect(first.isStarted()).toBe(false);
        expect(storage.values.has(QUEUE_KEY)).toBe(false);
      },
    );

    it("a batch it files is no longer kept", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      first.track("Filed");
      await storeDelay();
      expect(storedNames()).toEqual(["session:", "custom:Filed"]);

      await nextFlush();
      await storeDelay();

      expect(sentNames()).toEqual(["session:", "custom:Filed"]);
      expect(storage.values.has(QUEUE_KEY)).toBe(false);
    });
  });

  describe("a damaged value", (): void => {
    it.each([
      ["not JSON", "{not json"],
      ["another layout", JSON.stringify({ v: 2, scopes: [], items: [] })],
      ["no items", JSON.stringify({ v: 1, scopes: [] })],
      ["an array", "[]"],
    ])(
      "%s is read as nothing and removed",
      async (_label: string, raw: string): Promise<void> => {
        storage.values.set(QUEUE_KEY, raw);

        const channel: MobileProductAnalytics = await startChannel();

        await settle();

        /* Removed at once, before anything new is written in its place. */
        expect(storage.values.has(QUEUE_KEY)).toBe(false);
        expect(codes()).toContain("analytics-store-unreadable");

        await nextFlush();

        expect(sentNames()).toEqual(["session:"]);
        expect(channel.getDiagnostics().dropped).toBe(0);
      },
    );

    it("an item of the wrong shape, or with no scope, is left out alone", async (): Promise<void> => {
      const scope: Record<string, unknown> = {
        sessionId: SESSION_A,
        userRef: "",
        userProperties: null,
      };

      storage.values.set(
        QUEUE_KEY,
        JSON.stringify({
          v: PRODUCT_ANALYTICS_STORED_QUEUE_VERSION,
          scopes: [scope, { sessionId: "not-a-session", userRef: "" }],
          items: [
            { s: 0, e: { kind: "custom", name: "Good", at: STARTED_AT } },
            { s: 0, e: { kind: "unheard-of", name: "Bad", at: STARTED_AT } },
            { s: 0, e: { kind: "custom", name: "No time" } },
            { s: 1, e: { kind: "custom", name: "Bad scope", at: STARTED_AT } },
            { s: 7, e: { kind: "custom", name: "No scope", at: STARTED_AT } },
            { s: 0, m: { name: "oneuptime.reserved", value: 1, at: 1 } },
            { s: 0, m: { name: "cart.value", value: 3, at: STARTED_AT } },
            "not an item",
          ],
          pending: { v: 1, batchId: "short" },
        }),
      );
      state.sessionId = SESSION_B;

      await startChannel();
      await nextFlush();
      await nextFlush();

      expect(sent[0]!.batch.sessionId).toBe(SESSION_A);
      expect(sentNames()).toEqual([
        "custom:Good",
        "metric:cart.value",
        "session:",
      ]);
    });
  });
});

/* The storage contract holds for anything AsyncStorage-shaped. */
describe("productAnalyticsQueueKey", (): void => {
  it("is the namespace's own key, beside the outbox's and the session's", (): void => {
    expect(productAnalyticsQueueKey("v1-abc")).toBe(
      "@oneuptime/replay/v1-abc/analytics-queue",
    );
    expect(productAnalyticsQueueKey("v1-abc")).not.toBe(
      productAnalyticsSessionKey("v1-abc"),
    );
  });

  it("is removed even by a storage that has no way to list its keys", async (): Promise<void> => {
    const plain: ReplayStorage = new MemoryStorage();

    await plain.setItem(productAnalyticsQueueKey("v1-abc"), "{}");
    await clearStoredProductAnalytics(plain, "v1-abc");

    expect(await plain.getItem(productAnalyticsQueueKey("v1-abc"))).toBeNull();
  });
});
