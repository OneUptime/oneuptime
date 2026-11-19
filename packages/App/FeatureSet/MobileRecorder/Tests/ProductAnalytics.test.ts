import {
  ProductAnalyticsBatchParseResult,
  parseProductAnalyticsBatch,
} from "../../../../Common/Types/Rum/ProductAnalyticsEvents";
import { ReplayFetch, ReplayFetchResponse } from "../src/Config";
import { SessionReplayConsentState } from "../src/Contract";
import MobileProductAnalytics, {
  MobileProductAnalyticsHost,
  PRODUCT_ANALYTICS_REQUEST_TIMEOUT_MS,
  ProductAnalyticsAppState,
  pickProductAnalyticsUserProperties,
  productAnalyticsSessionKey,
} from "../src/ProductAnalytics";
import {
  PRODUCT_ANALYTICS_EVENTS_PATH,
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS,
  PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
  PRODUCT_ANALYTICS_TARGET_BATCH_BYTES,
  PRODUCT_ANALYTICS_WIRE_VERSION,
  ProductAnalyticsEventKind,
  ProductAnalyticsWireBatch,
  ProductAnalyticsWireEvent,
} from "../src/ProductAnalyticsContract";
import { maskStringMapValues, sanitizeEventProperties } from "../src/Sanitize";
import { FakeAppState, MemoryStorage, response } from "./TestUtils";

/*
 * The React Native recorder's product analytics channel (issue #6629) on
 * its own, with a host the test controls - in the package the session,
 * the visitor, consent and who signed in come from MobileReplayRecorder -
 * and a fetch that answers what each test needs. It mirrors the browser
 * recorder's suite (BrowserRecorder/Tests/ProductAnalytics.test.ts);
 * RecorderProductAnalytics.test.ts runs it behind the real recorder.
 */

const SESSION_A: string = "a".repeat(32);
const SESSION_B: string = "b".repeat(32);
const VISITOR: string = "c".repeat(32);
const NAMESPACE: string = "v1-test";
const URL_TO_POST: string = `https://oneuptime.example${PRODUCT_ANALYTICS_EVENTS_PATH}`;
const STARTED_AT: number = Date.parse("2026-11-18T09:00:00.000Z");

interface HostState {
  sessionId: string;
  consentState: SessionReplayConsentState;
  requiresConsent: boolean;
  userRef: string;
  traits: Record<string, string> | null;
}

type Answer =
  | { status: number; headers?: Record<string, string> }
  | "network-error"
  | "never";

interface SentRequest {
  url: string;
  init: NonNullable<Parameters<ReplayFetch>[1]>;
  batch: ProductAnalyticsWireBatch;
}

interface Diagnostic {
  code: string;
  details?: Record<string, unknown> | undefined;
}

describe("MobileProductAnalytics", (): void => {
  let state: HostState;
  let answers: Array<Answer>;
  let sent: Array<SentRequest>;
  let diagnostics: Array<Diagnostic>;
  let storage: MemoryStorage;
  let appState: FakeAppState;
  let activityLookups: number;
  let channels: Array<MobileProductAnalytics>;
  let connectivityListener: ((isConnected: boolean | null) => void) | null;
  let unsubscribedConnectivity: number;

  const fetchMock: jest.MockedFunction<ReplayFetch> = jest.fn();

  function makeHost(
    overrides: Partial<MobileProductAnalyticsHost> = {},
  ): MobileProductAnalyticsHost {
    return {
      url: URL_TO_POST,
      headers: {
        "x-oneuptime-token": "token",
        "x-oneuptime-app-identifier": "rum-app",
        "x-oneuptime-replay-recorder-kind": "rn-view-tree",
        "x-oneuptime-mobile-app-identifier": "com.example.checkout",
      },
      fetch: fetchMock,
      now: (): number => {
        return Date.now();
      },
      storage: storage,
      namespace: NAMESPACE,
      appState: appState as unknown as ProductAnalyticsAppState,
      getSessionId: (): string => {
        activityLookups++;
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

  /* Lets the fetch promise and its handlers settle. */
  async function settle(): Promise<void> {
    await jest.advanceTimersByTimeAsync(0);
  }

  async function nextFlush(): Promise<void> {
    await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);
  }

  function allEvents(): Array<ProductAnalyticsWireEvent> {
    return sent.flatMap(
      (request: SentRequest): Array<ProductAnalyticsWireEvent> => {
        return request.batch.events;
      },
    );
  }

  function codes(): Array<string> {
    return diagnostics.map((diagnostic: Diagnostic): string => {
      return diagnostic.code;
    });
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
    activityLookups = 0;
    channels = [];
    connectivityListener = null;
    unsubscribedConnectivity = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async (
        url: string,
        init?: Parameters<ReplayFetch>[1],
      ): Promise<ReplayFetchResponse> => {
        const requestInit: NonNullable<Parameters<ReplayFetch>[1]> = init ?? {};
        sent.push({
          url: url,
          init: requestInit,
          batch: JSON.parse(
            requestInit.body as string,
          ) as ProductAnalyticsWireBatch,
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
              requestInit.signal?.addEventListener("abort", (): void => {
                reject(new Error("aborted"));
              });
            },
          );
        }

        return response(answer.status, {}, answer.headers ?? {});
      },
    );
  });

  afterEach((): void => {
    for (const channel of channels) {
      channel.stop();
    }
    jest.useRealTimers();
  });

  describe("what it sends", (): void => {
    it("sends the session's start on the flush interval, as one JSON batch to the events route", async (): Promise<void> => {
      await startChannel();

      await settle();
      expect(sent).toHaveLength(0);

      await nextFlush();

      expect(sent).toHaveLength(1);

      const request: SentRequest = sent[0]!;

      expect(request.url).toBe(URL_TO_POST);
      expect(request.init.method).toBe("POST");
      expect(request.init.headers).toEqual({
        "x-oneuptime-token": "token",
        "x-oneuptime-app-identifier": "rum-app",
        "x-oneuptime-replay-recorder-kind": "rn-view-tree",
        "x-oneuptime-mobile-app-identifier": "com.example.checkout",
        "Content-Type": "application/json",
      });

      const batch: ProductAnalyticsWireBatch = request.batch;

      expect(batch.v).toBe(PRODUCT_ANALYTICS_WIRE_VERSION);
      expect(batch.batchId).toMatch(/^[0-9a-f]{32}$/);
      expect(batch.sessionId).toBe(SESSION_A);
      expect(batch.visitorId).toBe(VISITOR);
      expect(batch.consentState).toBe("NotRequired");
      expect(batch.sentAt).toBe(
        STARTED_AT + PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
      );
      expect(batch.context).toEqual({
        deviceType: "mobile",
        browserName: "",
        osName: "ios",
        appVersion: "2.4.1",
      });
      /* No screen is named until the app calls setRoute(). */
      expect(batch.events).toEqual([
        { kind: ProductAnalyticsEventKind.Session, name: "", at: STARTED_AT },
      ]);
      expect(batch.metrics).toEqual([]);
      expect(batch.userRef).toBeUndefined();
      expect(batch.userProperties).toBeUndefined();
      expect(codes()).toContain("analytics-started");
    });

    /*
     * The contract with the ingest: the server runs Common's parser over
     * these bytes, and a batch this recorder builds must be kept whole.
     */
    it("builds batches the server's parser keeps whole", async (): Promise<void> => {
      state.userRef = "user-42";
      state.traits = maskStringMapValues({ plan: "pro", email: "x@y.z" });

      const channel: MobileProductAnalytics = await startChannel({
        userPropertyKeys: ["plan"],
      });

      channel.page("/checkout");
      channel.track("Signed up", { plan: "pro", seats: 3, trial: false });
      channel.metric("cart.value", 42.5, { currency: "EUR" });

      await nextFlush();

      expect(sent).toHaveLength(1);

      const parsed: ProductAnalyticsBatchParseResult =
        parseProductAnalyticsBatch(JSON.parse(sent[0]!.init.body as string), {
          receivedAtUnixMs: Date.now(),
          allowedUserPropertyKeys: ["plan"],
        });

      expect(parsed.isValid).toBe(true);

      if (!parsed.isValid) {
        return;
      }

      expect(parsed.batch.events).toHaveLength(3);
      expect(parsed.batch.metrics).toHaveLength(1);
      expect(parsed.batch.droppedEvents).toBe(0);
      expect(parsed.batch.droppedMetrics).toBe(0);
      expect(parsed.batch.droppedTooOld).toBe(0);
      expect(parsed.batch.userRef).toBe("user-42");
      expect(parsed.batch.userProperties).toEqual({ plan: "••••" });
      expect(parsed.batch.context).toEqual({
        deviceType: "mobile",
        browserName: "",
        osName: "ios",
        appVersion: "2.4.1",
      });
      expect(parsed.batch.events[1]).toEqual({
        kind: ProductAnalyticsEventKind.Page,
        name: "/checkout",
        time: STARTED_AT,
        page: "/checkout",
        properties: {},
      });
      expect(parsed.batch.events[2]).toEqual({
        kind: ProductAnalyticsEventKind.Custom,
        name: "Signed up",
        time: STARTED_AT,
        page: "/checkout",
        properties: { plan: "••••", seats: "••••", trial: "••••" },
      });
      expect(parsed.batch.metrics[0]).toEqual({
        name: "cart.value",
        value: 42.5,
        time: STARTED_AT,
        attributes: { currency: "••••" },
      });
    });

    it("sends the signed-in user's reference and only the listed traits", async (): Promise<void> => {
      state.userRef = "user-42";
      state.traits = {
        plan: "••••",
        region: "••••",
        email: "••••••••••••••••",
      };

      await startChannel({ userPropertyKeys: ["plan", "region", "missing"] });
      await nextFlush();

      expect(sent[0]!.batch.userRef).toBe("user-42");
      expect(sent[0]!.batch.userProperties).toEqual({
        plan: "••••",
        region: "••••",
      });
    });

    it("sends no reference and no traits for nobody signed in", async (): Promise<void> => {
      state.traits = { plan: "••••" };

      await startChannel({ userPropertyKeys: ["plan"] });
      await nextFlush();

      expect(Object.keys(sent[0]!.batch)).not.toContain("userRef");
      expect(Object.keys(sent[0]!.batch)).not.toContain("userProperties");
    });

    it("files track() under the screen shown, with its properties as the recorder keeps them", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      channel.page("/Cart");
      channel.track("  Checkout\nstarted  ", {
        cartSize: 3,
        coupon: "WELCOME-2026",
        nested: { not: "kept" },
      });
      await nextFlush();

      expect(allEvents()[2]).toEqual({
        kind: ProductAnalyticsEventKind.Custom,
        name: "Checkoutstarted",
        at: STARTED_AT,
        page: "/Cart",
        properties: { cartSize: "••••", coupon: "••••••••••••••••" },
      });
    });

    it("ignores a track() without a usable name", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      channel.track("   ");
      channel.track("\n\t");
      channel.track(42 as unknown as string);
      channel.track(undefined as unknown as string);
      await nextFlush();

      expect(
        allEvents().filter((event: ProductAnalyticsWireEvent): boolean => {
          return event.kind === ProductAnalyticsEventKind.Custom;
        }),
      ).toEqual([]);
    });

    it("cuts a track() name to 64 characters", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      channel.track("e".repeat(80));
      await nextFlush();

      expect(allEvents()[1]?.name).toBe("e".repeat(64));
    });

    it("sends a metric() point, and refuses a bad name or value, saying why", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      channel.metric("cart.value", 42.5, { currency: "EUR" });
      channel.metric("checkout/latency_ms", -3);
      channel.metric("oneuptime.rum.product.events", 1);
      channel.metric("ONEUPTIME.anything", 1);
      channel.metric("9lives", 1);
      channel.metric("has space", 1);
      channel.metric("x".repeat(101), 1);
      channel.metric("cart.value", Number.NaN);
      channel.metric("cart.value", Number.POSITIVE_INFINITY);
      channel.metric("cart.value", "42" as unknown as number);
      await nextFlush();

      expect(sent[0]!.batch.metrics).toEqual([
        {
          name: "cart.value",
          value: 42.5,
          at: STARTED_AT,
          attributes: { currency: "••••" },
        },
        {
          name: "checkout/latency_ms",
          value: -3,
          at: STARTED_AT,
          attributes: {},
        },
      ]);
      expect(
        codes().filter((code: string): boolean => {
          return code === "metric-name-refused";
        }),
      ).toHaveLength(5);
      expect(
        codes().filter((code: string): boolean => {
          return code === "metric-value-refused";
        }),
      ).toHaveLength(3);
    });
  });

  describe("screens and sessions", (): void => {
    it("sends a page view for each new screen, and none for the screen already shown", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      channel.page("/Home");
      channel.page("/Home");
      channel.page("/Product");
      channel.page("");
      channel.page("/Home");
      await nextFlush();

      expect(
        allEvents().map((event: ProductAnalyticsWireEvent): string => {
          return `${event.kind}:${event.name}`;
        }),
      ).toEqual(["session:", "page:/Home", "page:/Product", "page:/Home"]);
    });

    it("announces a session once on this device, across restarts of the app", async (): Promise<void> => {
      const first: MobileProductAnalytics = await startChannel();

      first.track("Opened");
      await nextFlush();
      first.stop();

      expect(await storage.getItem(productAnalyticsSessionKey(NAMESPACE))).toBe(
        SESSION_A,
      );

      /* The app relaunches inside the session's window: the same session. */
      const second: MobileProductAnalytics = await startChannel();

      second.track("Opened again");
      await nextFlush();

      expect(
        allEvents().filter((event: ProductAnalyticsWireEvent): boolean => {
          return event.kind === ProductAnalyticsEventKind.Session;
        }),
      ).toHaveLength(1);
      expect(sent[1]!.batch.events).toEqual([
        {
          kind: ProductAnalyticsEventKind.Custom,
          name: "Opened again",
          at: STARTED_AT + PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
          properties: {},
        },
      ]);
    });

    it("starts a new session with its start and the screen the app shows", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      channel.page("/Feed");
      await nextFlush();

      state.sessionId = SESSION_B;
      channel.track("Liked");
      await nextFlush();

      expect(sent[1]!.batch.sessionId).toBe(SESSION_B);
      expect(sent[1]!.batch.events).toEqual([
        {
          kind: ProductAnalyticsEventKind.Session,
          name: "",
          at: STARTED_AT + PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
          page: "/Feed",
        },
        {
          kind: ProductAnalyticsEventKind.Page,
          name: "/Feed",
          at: STARTED_AT + PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
          page: "/Feed",
        },
        {
          kind: ProductAnalyticsEventKind.Custom,
          name: "Liked",
          at: STARTED_AT + PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
          page: "/Feed",
          properties: {},
        },
      ]);
    });

    /*
     * A phone holds items longer than a tab, and a sign-in starts a new
     * session: each batch is one session's and one person's, so nothing
     * one person did is filed under another.
     */
    it("files what happened before a session or a user changed under that session and user", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel({
        userPropertyKeys: ["plan"],
      });

      channel.track("Browsed");

      state.sessionId = SESSION_B;
      state.userRef = "user-7";
      state.traits = { plan: "••••" };
      channel.track("Signed in");

      await nextFlush();
      await settle();

      expect(sent).toHaveLength(2);
      expect(sent[0]!.batch.sessionId).toBe(SESSION_A);
      expect(sent[0]!.batch.userRef).toBeUndefined();
      expect(
        sent[0]!.batch.events.map((event: ProductAnalyticsWireEvent) => {
          return event.name;
        }),
      ).toEqual(["", "Browsed"]);
      expect(sent[1]!.batch.sessionId).toBe(SESSION_B);
      expect(sent[1]!.batch.userRef).toBe("user-7");
      expect(sent[1]!.batch.userProperties).toEqual({ plan: "••••" });
      expect(
        sent[1]!.batch.events.map((event: ProductAnalyticsWireEvent) => {
          return event.name;
        }),
      ).toEqual(["", "Signed in"]);
    });

    it("drops an event with no session to file it under, when no consent is being waited for", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      state.sessionId = "";
      channel.track("Orphan");
      channel.metric("orphan.value", 1);
      await nextFlush();

      expect(
        allEvents().map((event: ProductAnalyticsWireEvent) => {
          return event.name;
        }),
      ).toEqual([""]);
      expect(
        sent.flatMap((request: SentRequest) => {
          return request.batch.metrics;
        }),
      ).toEqual([]);
    });

    it("looks at the session on its timer without counting it as activity", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      await nextFlush();
      await nextFlush();
      await nextFlush();
      expect(activityLookups).toBe(0);

      channel.track("Tapped");
      expect(activityLookups).toBe(1);
    });
  });

  describe("batches", (): void => {
    it("sends at once when a batch's worth of events is held, and never more than a batch's worth", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      for (
        let index: number = 0;
        index < PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH + 5;
        index++
      ) {
        channel.track(`Event ${index}`);
      }

      /* Sent as the hundredth event came, not on the timer. */
      expect(sent).toHaveLength(1);
      expect(sent[0]!.batch.events).toHaveLength(
        PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH,
      );

      await settle();
      /* The rest go once the first is answered. */
      expect(sent).toHaveLength(2);
      expect(allEvents()).toHaveLength(
        PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH + 6,
      );
    });

    it("sends at once when a batch's worth of metric points is held", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      for (
        let index: number = 0;
        index < PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH;
        index++
      ) {
        channel.metric("cart.value", index);
      }
      await settle();

      expect(sent).toHaveLength(1);
      expect(sent[0]!.batch.metrics).toHaveLength(
        PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH,
      );
    });

    it("halves a batch until it is under the target size, and sends every event once", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel({
        host: {
          toProperties: (value: unknown): Record<string, string> => {
            return sanitizeEventProperties(value);
          },
        },
      });
      const big: Record<string, string> = {};

      for (let key: number = 0; key < 20; key++) {
        big[`key${key}`] = "v".repeat(200);
      }

      for (let index: number = 0; index < 60; index++) {
        channel.track(`Big ${index}`, big);
      }
      await nextFlush();
      await settle();
      await settle();
      await settle();

      for (const request of sent) {
        expect(JSON.stringify(request.batch).length).toBeLessThanOrEqual(
          PRODUCT_ANALYTICS_TARGET_BATCH_BYTES,
        );
      }

      const names: Array<string> = allEvents()
        .filter((event: ProductAnalyticsWireEvent): boolean => {
          return event.kind === ProductAnalyticsEventKind.Custom;
        })
        .map((event: ProductAnalyticsWireEvent): string => {
          return event.name;
        });

      expect(names).toHaveLength(60);
      expect(new Set(names).size).toBe(60);
      expect(sent.length).toBeGreaterThan(1);
    });

    it("sends one request at a time", async (): Promise<void> => {
      answers.push("never");

      const channel: MobileProductAnalytics = await startChannel();

      await nextFlush();
      channel.track("Later");
      await nextFlush();
      await nextFlush();

      expect(sent).toHaveLength(1);
    });

    it("holds at most a cap of events it cannot send, dropping the oldest and counting them", async (): Promise<void> => {
      state.requiresConsent = true;
      state.consentState = "Unknown";
      state.sessionId = "";

      const channel: MobileProductAnalytics = await startChannel();

      for (
        let index: number = 0;
        index < PRODUCT_ANALYTICS_MAX_PENDING_EVENTS + 25;
        index++
      ) {
        channel.track(`Held ${index}`);
      }

      expect(channel.getDroppedEventCount()).toBe(25);
      expect(channel.getPendingCount()).toBe(
        PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
      );
      expect(channel.getDiagnostics()).toEqual({
        state: "on",
        pending: PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
        dropped: 25,
      });
    });

    it("drops what waited longer than the server keeps, before sending it", async (): Promise<void> => {
      answers.push("network-error");

      const channel: MobileProductAnalytics = await startChannel();

      await nextFlush();
      expect(sent).toHaveLength(1);

      channel.track("Old");
      jest.setSystemTime(Date.now() + PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS + 1);
      state.sessionId = SESSION_A;
      /* The batch that failed is sent again as it was; what is held after it is dropped. */
      await nextFlush();
      await settle();
      await nextFlush();
      await settle();

      expect(
        allEvents().filter((event: ProductAnalyticsWireEvent): boolean => {
          return event.name === "Old";
        }),
      ).toEqual([]);
      expect(channel.getDroppedEventCount()).toBe(1);
    });
  });

  describe("consent", (): void => {
    it("holds everything until consent, then files it under the session the grant opens, its start first", async (): Promise<void> => {
      state.requiresConsent = true;
      state.consentState = "Unknown";
      /* Before consent the recorder's session is a throwaway: none is named. */
      state.sessionId = "";

      const channel: MobileProductAnalytics = await startChannel();

      channel.page("/Onboarding");
      jest.setSystemTime(STARTED_AT + 1_000);
      channel.track("Tapped next");
      channel.metric("onboarding.step", 2);
      await nextFlush();
      await nextFlush();

      expect(sent).toHaveLength(0);
      expect(channel.getPendingCount()).toBe(3);

      state.consentState = "Granted";
      state.sessionId = SESSION_B;
      channel.onConsentGranted();
      await settle();

      expect(sent).toHaveLength(1);
      expect(sent[0]!.batch.sessionId).toBe(SESSION_B);
      expect(sent[0]!.batch.consentState).toBe("Granted");
      expect(sent[0]!.batch.events).toEqual([
        {
          kind: ProductAnalyticsEventKind.Session,
          name: "",
          at: STARTED_AT,
          page: "/Onboarding",
        },
        {
          kind: ProductAnalyticsEventKind.Page,
          name: "/Onboarding",
          at: STARTED_AT,
          page: "/Onboarding",
        },
        {
          kind: ProductAnalyticsEventKind.Custom,
          name: "Tapped next",
          at: STARTED_AT + 1_000,
          page: "/Onboarding",
          properties: {},
        },
      ]);
      expect(sent[0]!.batch.metrics).toHaveLength(1);
      expect(await storage.getItem(productAnalyticsSessionKey(NAMESPACE))).toBe(
        SESSION_B,
      );
    });

    it("files what was held under the session once it is named, even before the grant is said", async (): Promise<void> => {
      state.requiresConsent = true;
      state.consentState = "Unknown";
      state.sessionId = "";

      const channel: MobileProductAnalytics = await startChannel();

      channel.track("Before");
      state.consentState = "Granted";
      state.sessionId = SESSION_A;
      channel.refresh();
      await settle();

      expect(sent[0]!.batch.sessionId).toBe(SESSION_A);
      expect(
        sent[0]!.batch.events.map((event: ProductAnalyticsWireEvent) => {
          return `${event.kind}:${event.name}`;
        }),
      ).toEqual(["session:", "custom:Before"]);
    });

    it("drops what it held when consent is withdrawn, forgets the session it announced, and keeps nothing until a new grant", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      await nextFlush();
      expect(await storage.getItem(productAnalyticsSessionKey(NAMESPACE))).toBe(
        SESSION_A,
      );

      channel.track("Held");
      channel.metric("held.value", 1);
      channel.forget();
      await settle();

      expect(channel.getPendingCount()).toBe(0);
      expect(
        await storage.getItem(productAnalyticsSessionKey(NAMESPACE)),
      ).toBeNull();

      channel.track("While withdrawn");
      channel.metric("withdrawn.value", 1);
      channel.page("/Settings");
      await nextFlush();

      expect(sent).toHaveLength(1);

      /* The session it forgot is announced again, then what follows. */
      channel.onConsentGranted();
      channel.track("After the grant");
      await nextFlush();

      expect(
        sent
          .slice(1)
          .flatMap((request: SentRequest) => {
            return request.batch.events;
          })
          .map((event: ProductAnalyticsWireEvent) => {
            return `${event.kind}:${event.name}`;
          }),
      ).toEqual(["session:", "custom:After the grant"]);
      expect(
        sent.slice(1).flatMap((request: SentRequest) => {
          return request.batch.metrics;
        }),
      ).toEqual([]);
    });

    it("drops what it held when the policy starts waiting for consent, and holds what comes next for the grant", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel();

      channel.track("Before the change");
      state.requiresConsent = true;
      state.consentState = "Unknown";
      state.sessionId = "";
      channel.reset();
      channel.track("After the change");
      await nextFlush();

      expect(sent).toHaveLength(0);
      expect(channel.getPendingCount()).toBe(1);
      expect(
        await storage.getItem(productAnalyticsSessionKey(NAMESPACE)),
      ).toBeNull();
    });
  });

  describe("answers", (): void => {
    it("sends a batch that failed again under the same id, after a back-off", async (): Promise<void> => {
      answers.push({ status: 500 }, { status: 503 });

      await startChannel();
      await nextFlush();
      expect(sent).toHaveLength(1);

      /* Back off ten seconds after the first failure: not on the next flush. */
      await nextFlush();
      expect(sent).toHaveLength(1);
      await nextFlush();
      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
      expect(sent[1]!.batch.events).toEqual(sent[0]!.batch.events);

      /* Twenty seconds after the second. */
      for (let step: number = 0; step < 3; step++) {
        await nextFlush();
      }
      expect(sent).toHaveLength(2);
      await nextFlush();
      expect(sent).toHaveLength(3);
      expect(sent[2]!.batch.batchId).toBe(sent[0]!.batch.batchId);
    });

    it("waits as long as a 429's Retry-After asks before sending the same batch again", async (): Promise<void> => {
      answers.push({ status: 429, headers: { "Retry-After": "60" } });

      await startChannel();
      await nextFlush();

      for (let step: number = 0; step < 11; step++) {
        await nextFlush();
      }
      expect(sent).toHaveLength(1);

      await nextFlush();
      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
    });

    it("reads a Retry-After that is no whole number of seconds as none", async (): Promise<void> => {
      answers.push({ status: 429, headers: { "Retry-After": "1.5" } });

      await startChannel();
      await nextFlush();
      await nextFlush();
      await nextFlush();

      expect(sent).toHaveLength(2);
    });

    it("holds a batch the server would not file without consent, and sends it again", async (): Promise<void> => {
      answers.push({ status: 409 });

      await startChannel();
      await nextFlush();
      await nextFlush();
      await nextFlush();

      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
    });

    it("retries a batch whose request never reached the server, or never came back", async (): Promise<void> => {
      answers.push("network-error", "never");

      await startChannel();
      await nextFlush();
      expect(sent).toHaveLength(1);

      await nextFlush();
      await nextFlush();
      expect(sent).toHaveLength(2);

      /* The request that hangs is given up after its timeout. */
      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_REQUEST_TIMEOUT_MS);
      for (let step: number = 0; step < 5; step++) {
        await nextFlush();
      }

      expect(sent).toHaveLength(3);
      expect(sent[2]!.batch.batchId).toBe(sent[0]!.batch.batchId);
    });

    it("drops a batch the server calls too large and carries on with the next", async (): Promise<void> => {
      answers.push({ status: 413 });

      const channel: MobileProductAnalytics = await startChannel();

      await nextFlush();
      channel.track("Next");
      await nextFlush();

      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).not.toBe(sent[0]!.batch.batchId);
      expect(sent[1]!.batch.events[0]?.name).toBe("Next");
    });

    it.each([
      [204, "not-enabled", "product-analytics-not-enabled"],
      [400, "refused", "invalid-session-id"],
      [403, "origin-not-allowed", "origin-not-allowed"],
    ])(
      "stops for good on a %d, saying why",
      async (
        status: number,
        stopReason: string,
        reason: string,
      ): Promise<void> => {
        answers.push({
          status: status,
          headers: { "x-oneuptime-replay-reason": reason },
        });

        const channel: MobileProductAnalytics = await startChannel();

        await nextFlush();
        channel.track("After");
        channel.metric("after.value", 1);
        await nextFlush();
        await nextFlush();

        expect(sent).toHaveLength(1);
        expect(channel.getStopReason()).toBe(stopReason);
        expect(channel.isStarted()).toBe(false);
        expect(channel.getDiagnostics().state).toBe(stopReason);
        expect(diagnostics).toContainEqual({
          code: "analytics-stopped",
          details: { status: status, reason: reason },
        });
      },
    );
  });

  describe("the app's lifecycle and the network", (): void => {
    it("sends what is held as the app leaves the foreground, whatever a retry waits for", async (): Promise<void> => {
      answers.push({ status: 500 });

      const channel: MobileProductAnalytics = await startChannel();

      await nextFlush();
      channel.track("Before backgrounding");
      appState.emit("background");
      await settle();

      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
    });

    it("sends a batch that waited at once when the app is back in the foreground", async (): Promise<void> => {
      answers.push({ status: 503 });

      await startChannel();
      await nextFlush();
      expect(sent).toHaveLength(1);

      appState.emit("active");
      await settle();

      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
    });

    it("tries nothing while the device says it is offline, and sends at once when it is back", async (): Promise<void> => {
      const channel: MobileProductAnalytics = await startChannel({
        host: {
          connectivity: {
            subscribe: (listener: (isConnected: boolean | null) => void) => {
              connectivityListener = listener;
              return (): void => {
                unsubscribedConnectivity++;
              };
            },
          },
        },
      });

      connectivityListener?.(false);
      channel.track("Offline");
      await nextFlush();
      await nextFlush();
      appState.emit("background");
      await settle();

      expect(sent).toHaveLength(0);

      connectivityListener?.(true);
      await settle();

      expect(sent).toHaveLength(1);
      expect(
        sent[0]!.batch.events.map((event: ProductAnalyticsWireEvent) => {
          return event.name;
        }),
      ).toEqual(["", "Offline"]);

      channel.stop();
      expect(unsubscribedConnectivity).toBe(1);
    });
  });

  it("stop() ends the timer and the listeners, and sends nothing more", async (): Promise<void> => {
    const channel: MobileProductAnalytics = await startChannel();

    channel.track("Before stop");
    channel.stop();
    channel.track("After stop");
    channel.metric("after.stop", 1);
    channel.page("/After");
    appState.emit("background");
    await nextFlush();
    await nextFlush();

    expect(sent).toHaveLength(0);
    expect(channel.getStopReason()).toBe("stopped");
    expect(channel.getPendingCount()).toBe(0);
  });

  it("ignores an answer that arrives after it stopped", async (): Promise<void> => {
    answers.push("never");

    const channel: MobileProductAnalytics = await startChannel();

    await nextFlush();
    channel.stop();
    await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_REQUEST_TIMEOUT_MS);

    expect(channel.getPendingCount()).toBe(0);
    expect(channel.getStopReason()).toBe("stopped");
  });

  it("takes nothing before it has started", async (): Promise<void> => {
    const channel: MobileProductAnalytics = new MobileProductAnalytics(
      makeHost(),
      { enabled: true, userPropertyKeys: [] },
    );
    channels.push(channel);

    channel.track("Too early");
    channel.metric("too.early", 1);
    channel.page("/Early");

    expect(channel.getPendingCount()).toBe(0);
  });
});

describe("pickProductAnalyticsUserProperties", (): void => {
  it("keeps only the listed traits, as written", (): void => {
    expect(
      pickProductAnalyticsUserProperties(
        { plan: "pro", Plan: "other", role: "admin" },
        ["plan", "tier"],
      ),
    ).toEqual({ plan: "pro" });
    expect(pickProductAnalyticsUserProperties(null, ["plan"])).toEqual({});
    expect(
      pickProductAnalyticsUserProperties(
        Object.create({ plan: "inherited" }) as Record<string, string>,
        ["plan"],
      ),
    ).toEqual({});
  });
});
