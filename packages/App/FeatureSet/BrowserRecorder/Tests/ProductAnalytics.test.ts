import {
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
  PRODUCT_ANALYTICS_TARGET_BATCH_BYTES,
  PRODUCT_ANALYTICS_WIRE_VERSION,
  ProductAnalyticsBatchParseResult,
  ProductAnalyticsEventKind,
  ProductAnalyticsWireBatch,
  ProductAnalyticsWireEvent,
  parseProductAnalyticsBatch,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import { DebugRecord, clearDebugRecords, getDebugRecords } from "../src/Debug";
import ProductAnalytics, {
  ProductAnalyticsHost,
  readProductAnalyticsPage,
} from "../src/ProductAnalytics";

/*
 * The product analytics channel (issue #6444, part two) on its own, with a
 * host the test controls - the session, the visitor, consent and who signed
 * in come from the replay recorder in the shipped bundle - and a fetch that
 * answers what each test needs. RecorderProductAnalytics.test.ts runs it
 * behind the real recorder and the public API.
 */

const SESSION_A: string = "a".repeat(32);
const SESSION_B: string = "b".repeat(32);
const VISITOR: string = "c".repeat(32);
const URL_TO_POST: string =
  "https://oneuptime.example.com/telemetry/session-replay/v1/events";
const ANNOUNCED_KEY: string = "oneuptime.analytics.session";

interface HostState {
  sessionId: string;
  consentState: string;
  userRef: string;
  traits: Record<string, string> | null;
}

interface FakeAnswer {
  status: number;
  headers?: Record<string, string>;
}

interface SentRequest {
  url: string;
  init: RequestInit;
  batch: ProductAnalyticsWireBatch;
}

describe("ProductAnalytics", (): void => {
  let state: HostState;
  let answers: Array<FakeAnswer | "network-error" | "never">;
  let sent: Array<SentRequest>;
  let trackers: Array<ProductAnalytics>;

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  const makeHost: (requiresConsent?: boolean) => ProductAnalyticsHost = (
    requiresConsent: boolean = false,
  ): ProductAnalyticsHost => {
    return {
      url: URL_TO_POST,
      headers: { "x-oneuptime-token": "tok", "x-oneuptime-app": "app-1" },
      getSessionId: (): string => {
        return state.sessionId;
      },
      getVisitorId: (): string => {
        return state.consentState === "Revoked" ? "" : VISITOR;
      },
      getConsentState: (): string => {
        return state.consentState;
      },
      requiresConsent: requiresConsent,
      getIdentity: (): {
        userRef: string;
        traits: Record<string, string> | null;
      } => {
        return { userRef: state.userRef, traits: state.traits };
      },
      maskProperties: (map: Record<string, string>): Record<string, string> => {
        /* Stands in for the replay's masking: a "secret" never leaves. */
        const masked: Record<string, string> = { ...map };

        if (masked["secret"] !== undefined) {
          masked["secret"] = "***";
        }

        return masked;
      },
      context: {
        deviceType: "desktop",
        browserName: "Chrome",
        osName: "macOS",
        appVersion: "",
      },
    };
  };

  const makeTracker: (options?: {
    requiresConsent?: boolean;
    userPropertyKeys?: Array<string>;
  }) => ProductAnalytics = (options?: {
    requiresConsent?: boolean;
    userPropertyKeys?: Array<string>;
  }): ProductAnalytics => {
    const tracker: ProductAnalytics = new ProductAnalytics(
      makeHost(options?.requiresConsent === true),
      {
        enabled: true,
        userPropertyKeys: options?.userPropertyKeys || [],
      },
    );

    trackers.push(tracker);
    return tracker;
  };

  /* Lets the fetch promise and its handlers settle. */
  const settle: () => Promise<void> = async (): Promise<void> => {
    await jest.advanceTimersByTimeAsync(0);
  };

  const allEvents: () => Array<ProductAnalyticsWireEvent> =
    (): Array<ProductAnalyticsWireEvent> => {
      return sent.flatMap(
        (request: SentRequest): Array<ProductAnalyticsWireEvent> => {
          return request.batch.events;
        },
      );
    };

  beforeEach((): void => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-10T09:00:00.000Z"));
    window.localStorage.clear();
    window.history.replaceState({}, "", "/checkout");
    clearDebugRecords();

    state = {
      sessionId: SESSION_A,
      consentState: "NotRequired",
      userRef: "",
      traits: null,
    };
    answers = [];
    sent = [];
    trackers = [];

    const fetchMock: jest.Mock = jest.fn(
      (url: string, init: RequestInit): Promise<unknown> => {
        sent.push({
          url: url,
          init: init,
          batch: JSON.parse(init.body as string) as ProductAnalyticsWireBatch,
        });

        const answer: FakeAnswer | "network-error" | "never" =
          answers.shift() || {
            status: 202,
          };

        if (answer === "network-error") {
          return Promise.reject(new TypeError("Failed to fetch"));
        }

        if (answer === "never") {
          return new Promise<unknown>((): void => {});
        }

        const headers: Record<string, string> = answer.headers || {};

        return Promise.resolve({
          status: answer.status,
          headers: {
            get: (name: string): string | null => {
              return headers[name.toLowerCase()] ?? null;
            },
          },
        });
      },
    );

    globalRecord["fetch"] = fetchMock;
  });

  afterEach((): void => {
    for (const tracker of trackers) {
      tracker.stop();
    }

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): string => {
        return "visible";
      },
    });

    jest.useRealTimers();
  });

  describe("what it sends", (): void => {
    it("sends the session's start and the first page view on the flush interval, as one JSON batch", async (): Promise<void> => {
      makeTracker().start();

      await settle();
      expect(sent).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(sent).toHaveLength(1);

      const request: SentRequest = sent[0]!;

      expect(request.url).toBe(URL_TO_POST);
      expect(request.init.method).toBe("POST");
      expect(request.init.keepalive).toBe(false);
      expect(request.init.credentials).toBe("omit");
      expect(request.init.headers).toEqual({
        "x-oneuptime-token": "tok",
        "x-oneuptime-app": "app-1",
        "Content-Type": "application/json",
      });

      const batch: ProductAnalyticsWireBatch = request.batch;

      expect(batch.v).toBe(PRODUCT_ANALYTICS_WIRE_VERSION);
      expect(batch.batchId).toMatch(/^[0-9a-f]{32}$/);
      expect(batch.sessionId).toBe(SESSION_A);
      expect(batch.visitorId).toBe(VISITOR);
      expect(batch.consentState).toBe("NotRequired");
      expect(batch.context).toEqual({
        deviceType: "desktop",
        browserName: "Chrome",
        osName: "macOS",
        appVersion: "",
      });
      expect(batch.events).toEqual([
        {
          kind: ProductAnalyticsEventKind.Session,
          name: "",
          at: Date.parse("2026-11-10T09:00:00.000Z"),
          page: "/checkout",
        },
        {
          kind: ProductAnalyticsEventKind.Page,
          name: "/checkout",
          at: Date.parse("2026-11-10T09:00:00.000Z"),
          page: "/checkout",
        },
      ]);
      expect(batch.metrics).toEqual([]);
      expect(batch.userRef).toBeUndefined();
      expect(batch.userProperties).toBeUndefined();
    });

    /*
     * The contract with the ingest: the server runs the same parser over
     * these bytes, and a batch this recorder builds must be kept whole -
     * nothing refused, nothing dropped.
     */
    it("builds batches the server's parser keeps whole", async (): Promise<void> => {
      state.userRef = "user-42";
      state.traits = { plan: "pro", email: "someone@example.com" };

      const tracker: ProductAnalytics = makeTracker({
        userPropertyKeys: ["plan"],
      });

      tracker.start();
      tracker.track("Signed up", { plan: "pro", seats: 3, trial: false });
      tracker.metric("cart.value", 42.5, { currency: "EUR" });

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(sent).toHaveLength(1);

      const body: string = sent[0]!.init.body as string;
      const parsed: ProductAnalyticsBatchParseResult =
        parseProductAnalyticsBatch(JSON.parse(body), {
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
      expect(parsed.batch.userProperties).toEqual({ plan: "pro" });
      /* Called at the start; the batch went one flush interval later. */
      const calledAt: number = Date.now() - PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS;

      expect(parsed.batch.events[2]).toEqual({
        kind: ProductAnalyticsEventKind.Custom,
        name: "Signed up",
        time: calledAt,
        page: "/checkout",
        properties: { plan: "pro", seats: "3", trial: "false" },
      });
      expect(parsed.batch.metrics[0]).toEqual({
        name: "cart.value",
        value: 42.5,
        time: calledAt,
        attributes: { currency: "EUR" },
      });
    });

    it("sends the signed-in user's reference and only the allow-listed traits", async (): Promise<void> => {
      state.userRef = "user-42";
      state.traits = { plan: "pro", email: "someone@example.com" };

      makeTracker({ userPropertyKeys: ["plan", "region"] }).start();

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(sent[0]!.batch.userRef).toBe("user-42");
      expect(sent[0]!.batch.userProperties).toEqual({ plan: "pro" });
    });

    it("files track() with its page and its masked, capped properties", async (): Promise<void> => {
      const tracker: ProductAnalytics = makeTracker();

      tracker.start();
      tracker.track("Checkout completed", {
        plan: "pro",
        secret: "s3cr3t",
        total: 99.5,
      });

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      const custom: ProductAnalyticsWireEvent | undefined = allEvents().find(
        (event: ProductAnalyticsWireEvent): boolean => {
          return event.kind === ProductAnalyticsEventKind.Custom;
        },
      );

      expect(custom).toEqual({
        kind: ProductAnalyticsEventKind.Custom,
        name: "Checkout completed",
        at: Date.now() - PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
        page: "/checkout",
        properties: { plan: "pro", secret: "***", total: "99.5" },
      });
    });

    it("ignores a track() without a usable name", async (): Promise<void> => {
      const tracker: ProductAnalytics = makeTracker();

      tracker.start();
      tracker.track("");
      tracker.track("   ");
      tracker.track(42);
      tracker.track(null);

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(
        allEvents().filter((event: ProductAnalyticsWireEvent): boolean => {
          return event.kind === ProductAnalyticsEventKind.Custom;
        }),
      ).toEqual([]);
    });

    it("sends a metric() point and refuses a bad name or value, saying why", async (): Promise<void> => {
      const tracker: ProductAnalytics = makeTracker();

      tracker.start();
      tracker.metric("checkout.duration_ms", 1834, { step: "payment" });
      tracker.metric("oneuptime.rum.events", 1);
      tracker.metric("9lives", 1);
      tracker.metric("has space", 1);
      tracker.metric("ok.name", Number.NaN);
      tracker.metric("ok.name", Number.POSITIVE_INFINITY);
      tracker.metric("ok.name", "12");

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(sent[0]!.batch.metrics).toEqual([
        {
          name: "checkout.duration_ms",
          value: 1834,
          at: Date.now() - PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
          attributes: { step: "payment" },
        },
      ]);

      const codes: Array<string> = getDebugRecords().map(
        (record: DebugRecord): string => {
          return record.code;
        },
      );

      expect(
        codes.filter((code: string): boolean => {
          return code === "metric-name-refused";
        }),
      ).toHaveLength(3);
      expect(
        codes.filter((code: string): boolean => {
          return code === "metric-value-refused";
        }),
      ).toHaveLength(3);
    });
  });

  describe("sessions and pages", (): void => {
    it("announces a session once across the browser's tabs, and a new one when it starts", async (): Promise<void> => {
      makeTracker().start();
      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(window.localStorage.getItem(ANNOUNCED_KEY)).toBe(SESSION_A);

      /* A second tab of the same session: its page, not another start. */
      const secondTab: ProductAnalytics = makeTracker();
      secondTab.start();
      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      const sessionStarts: () => number = (): number => {
        return allEvents().filter(
          (event: ProductAnalyticsWireEvent): boolean => {
            return event.kind === ProductAnalyticsEventKind.Session;
          },
        ).length;
      };

      expect(sessionStarts()).toBe(1);

      /* The session rolled over: the next event comes after its start. */
      state.sessionId = SESSION_B;
      secondTab.track("Opened settings");
      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(sessionStarts()).toBe(2);

      const tracked: SentRequest | undefined = sent.find(
        (request: SentRequest): boolean => {
          return request.batch.events.some(
            (event: ProductAnalyticsWireEvent): boolean => {
              return event.name === "Opened settings";
            },
          );
        },
      );

      expect(tracked?.batch.sessionId).toBe(SESSION_B);
      expect(
        tracked?.batch.events.map(
          (event: ProductAnalyticsWireEvent): string => {
            return event.kind;
          },
        ),
      ).toEqual([
        ProductAnalyticsEventKind.Session,
        ProductAnalyticsEventKind.Page,
        ProductAnalyticsEventKind.Custom,
      ]);
    });

    it("notices a single-page app's route change within a second, without patching history", async (): Promise<void> => {
      const pushState: History["pushState"] = window.history.pushState;
      const replaceState: History["replaceState"] = window.history.replaceState;

      makeTracker().start();

      expect(window.history.pushState).toBe(pushState);
      expect(window.history.replaceState).toBe(replaceState);

      window.history.pushState({}, "", "/orders/42?tab=items#notes");
      await jest.advanceTimersByTimeAsync(1000);

      /* Unchanged: one view per page, however often it is looked at. */
      await jest.advanceTimersByTimeAsync(3000);
      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(
        allEvents()
          .filter((event: ProductAnalyticsWireEvent): boolean => {
            return event.kind === ProductAnalyticsEventKind.Page;
          })
          .map((event: ProductAnalyticsWireEvent): string => {
            return event.name;
          }),
      ).toEqual(["/checkout", "/orders/42"]);
    });

    it("reads a back or forward navigation at once", async (): Promise<void> => {
      const tracker: ProductAnalytics = makeTracker();

      tracker.start();
      window.history.pushState({}, "", "/plans");
      window.dispatchEvent(new PopStateEvent("popstate"));
      tracker.track("Viewed plans");

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      const custom: ProductAnalyticsWireEvent | undefined = allEvents().find(
        (event: ProductAnalyticsWireEvent): boolean => {
          return event.kind === ProductAnalyticsEventKind.Custom;
        },
      );

      expect(custom?.page).toBe("/plans");
    });

    it("reads the page as a path: no query, no fragment, identifiers scrubbed, hash routes kept", (): void => {
      const at: (pathname: string, hash: string) => string = (
        pathname: string,
        hash: string,
      ): string => {
        return readProductAnalyticsPage({
          pathname: pathname,
          hash: hash,
        } as Location);
      };

      expect(at("/checkout", "")).toBe("/checkout");
      expect(at("/", "")).toBe("/");
      expect(at("", "")).toBe("/");
      expect(at("/users/1234567890/orders", "")).not.toContain("1234567890");
      expect(at("/users/someone@example.com", "")).not.toContain("@");

      /* An in-page anchor is the same page. */
      expect(at("/pricing", "#faq")).toBe("/pricing");

      /* A hash router's route is the page, after the page's own path. */
      expect(at("/", "#/orders/7")).toBe("/orders/7");
      expect(at("/app/", "#!/orders/7?tab=1")).toBe("/app/orders/7");
      expect(at("/app", "#/settings")).toBe("/app/settings");
      expect(at("/", "#/users/1234567890")).not.toContain("1234567890");
    });
  });

  describe("batches", (): void => {
    it("sends at once when a batch's worth of events is held, and never more than a batch's worth", async (): Promise<void> => {
      const tracker: ProductAnalytics = makeTracker();

      tracker.start();

      for (
        let index: number = 0;
        index < PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH;
        index++
      ) {
        tracker.track(`Step ${index}`);
      }

      await settle();

      expect(sent.length).toBeGreaterThanOrEqual(1);

      for (const request of sent) {
        expect(request.batch.events.length).toBeLessThanOrEqual(
          PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH,
        );
      }

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      /* Session start + first page + every track(), each once. */
      expect(allEvents()).toHaveLength(
        PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH + 2,
      );
    });

    it("halves a batch until it is under the target size, and sends every event once", async (): Promise<void> => {
      const tracker: ProductAnalytics = makeTracker();

      tracker.start();

      const wide: Record<string, string> = {};

      for (let index: number = 0; index < 10; index++) {
        wide[`key${index}`] = "x".repeat(150);
      }

      for (let index: number = 0; index < 60; index++) {
        tracker.track(`Wide ${index}`, wide);
      }

      for (let round: number = 0; round < 10; round++) {
        await jest.advanceTimersByTimeAsync(
          PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
        );
      }

      expect(sent.length).toBeGreaterThan(1);

      for (const request of sent) {
        expect((request.init.body as string).length).toBeLessThanOrEqual(
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
      expect(names[0]).toBe("Wide 0");
      expect(names[59]).toBe("Wide 59");
    });

    it("sends one request at a time", async (): Promise<void> => {
      answers.push("never");

      const tracker: ProductAnalytics = makeTracker();

      tracker.start();

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);
      tracker.track("While waiting");
      await jest.advanceTimersByTimeAsync(
        PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS * 4,
      );

      expect(sent).toHaveLength(1);
      expect(tracker.getPendingCount()).toBe(3);
    });

    it("holds at most a cap of events it cannot send, dropping the oldest and counting them", async (): Promise<void> => {
      state.consentState = "Unknown";

      const tracker: ProductAnalytics = makeTracker({ requiresConsent: true });

      tracker.start();

      for (let index: number = 0; index < 600; index++) {
        tracker.track(`Held ${index}`);
      }

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(sent).toHaveLength(0);
      expect(tracker.getPendingCount()).toBe(
        PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
      );
      expect(tracker.getDroppedEventCount()).toBe(
        600 + 2 - PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
      );
    });
  });

  describe("consent", (): void => {
    it("holds everything until the visitor grants consent when the application asks for it", async (): Promise<void> => {
      state.consentState = "Unknown";

      const tracker: ProductAnalytics = makeTracker({ requiresConsent: true });

      tracker.start();
      tracker.track("Browsed");

      await jest.advanceTimersByTimeAsync(
        PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS * 3,
      );

      expect(sent).toHaveLength(0);

      state.consentState = "Granted";
      tracker.onConsentGranted();
      await settle();

      expect(sent).toHaveLength(1);
      expect(sent[0]!.batch.consentState).toBe("Granted");
      expect(
        sent[0]!.batch.events.map(
          (event: ProductAnalyticsWireEvent): string => {
            return event.kind;
          },
        ),
      ).toEqual([
        ProductAnalyticsEventKind.Session,
        ProductAnalyticsEventKind.Page,
        ProductAnalyticsEventKind.Custom,
      ]);
    });

    it("drops what it held when consent is withdrawn, and keeps nothing until a new grant", async (): Promise<void> => {
      const tracker: ProductAnalytics = makeTracker();

      tracker.start();
      tracker.track("Before the withdrawal");

      tracker.forget();
      state.consentState = "Revoked";

      tracker.track("While withdrawn");
      tracker.metric("while.withdrawn", 1);
      window.history.pushState({}, "", "/withdrawn");

      await jest.advanceTimersByTimeAsync(
        PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS * 2,
      );

      expect(sent).toHaveLength(0);
      expect(tracker.getPendingCount()).toBe(0);

      state.consentState = "Granted";
      state.sessionId = SESSION_B;
      tracker.onConsentGranted();
      await settle();

      const names: Array<string> = allEvents().map(
        (event: ProductAnalyticsWireEvent): string => {
          return `${event.kind}:${event.name}`;
        },
      );

      expect(names).toEqual(["session:", "page:/withdrawn"]);
      expect(sent[0]!.batch.sessionId).toBe(SESSION_B);
    });
  });

  describe("answers", (): void => {
    it("sends a batch that failed again under the same id, after a back-off", async (): Promise<void> => {
      answers.push("network-error");

      makeTracker().start();

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);
      expect(sent).toHaveLength(1);

      /* The next tick is inside the back-off. */
      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);
      expect(sent).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);
      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
      expect(sent[1]!.batch.events).toEqual(sent[0]!.batch.events);
    });

    it.each([429, 503])(
      "waits as long as a %d's Retry-After says before sending the same batch again",
      async (status: number): Promise<void> => {
        answers.push({ status: status, headers: { "retry-after": "60" } });

        makeTracker().start();

        await jest.advanceTimersByTimeAsync(
          PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
        );
        expect(sent).toHaveLength(1);

        await jest.advanceTimersByTimeAsync(55_000);
        expect(sent).toHaveLength(1);

        await jest.advanceTimersByTimeAsync(
          PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS + 1000,
        );
        expect(sent).toHaveLength(2);
        expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
      },
    );

    it("holds a batch the server would not file without consent, and sends it again", async (): Promise<void> => {
      answers.push({ status: 409 });

      makeTracker().start();

      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);
      await jest.advanceTimersByTimeAsync(
        PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS * 2,
      );

      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
    });

    it.each([
      [204, "not-enabled"],
      [403, "origin-not-allowed"],
      [400, "refused"],
    ])(
      "stops for good on a %d, says why, and keeps nothing",
      async (status: number, reason: string): Promise<void> => {
        answers.push({
          status: status,
          headers: { "x-oneuptime-replay-reason": "product-analytics-off" },
        });

        const tracker: ProductAnalytics = makeTracker();

        tracker.start();
        await jest.advanceTimersByTimeAsync(
          PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
        );

        expect(tracker.getStopReason()).toBe(reason);

        tracker.track("After the stop");
        tracker.metric("after.stop", 1);
        window.history.pushState({}, "", "/after-the-stop");
        await jest.advanceTimersByTimeAsync(
          PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS * 3,
        );

        expect(sent).toHaveLength(1);
        expect(tracker.getPendingCount()).toBe(0);

        const stopped: DebugRecord | undefined = getDebugRecords().find(
          (record: DebugRecord): boolean => {
            return record.code === "analytics-stopped";
          },
        );

        expect(stopped?.detail).toEqual({
          status: status,
          reason: "product-analytics-off",
        });
      },
    );

    it("drops a batch the server calls too large and carries on with the next", async (): Promise<void> => {
      answers.push({ status: 413 });

      const tracker: ProductAnalytics = makeTracker();

      tracker.start();
      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      tracker.track("Next");
      await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).not.toBe(sent[0]!.batch.batchId);
      expect(
        sent[1]!.batch.events.map(
          (event: ProductAnalyticsWireEvent): string => {
            return event.name;
          },
        ),
      ).toEqual(["Next"]);
      expect(tracker.getStopReason()).toBeNull();
    });
  });

  describe("leaving the page", (): void => {
    const hidePage: () => void = (): void => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: (): string => {
          return "hidden";
        },
      });

      document.dispatchEvent(new Event("visibilitychange"));
    };

    it("sends what is held as the page is hidden, as a keepalive request", async (): Promise<void> => {
      const tracker: ProductAnalytics = makeTracker();

      tracker.start();
      tracker.track("Leaving");
      hidePage();
      await settle();

      expect(sent).toHaveLength(1);
      expect(sent[0]!.init.keepalive).toBe(true);
      expect(tracker.getPendingCount()).toBe(0);
    });

    it("sends what is held as the page is closed", async (): Promise<void> => {
      const tracker: ProductAnalytics = makeTracker();

      tracker.start();
      tracker.track("Closing");
      window.dispatchEvent(new Event("pagehide"));
      await settle();

      expect(sent).toHaveLength(1);
      expect(sent[0]!.init.keepalive).toBe(true);
    });

    it("sends a batch that failed as the page was hidden again once the page is back", async (): Promise<void> => {
      answers.push({ status: 503 });

      const tracker: ProductAnalytics = makeTracker();

      tracker.start();
      hidePage();
      await settle();

      expect(sent).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(
        PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS * 3,
      );

      expect(sent).toHaveLength(2);
      expect(sent[1]!.batch.batchId).toBe(sent[0]!.batch.batchId);
      expect(sent[1]!.init.keepalive).toBe(false);
    });
  });

  it("stop() ends the timers and the listeners, and sends nothing more", async (): Promise<void> => {
    const tracker: ProductAnalytics = makeTracker();

    tracker.start();
    tracker.stop();

    expect(tracker.getStopReason()).toBe("stopped");

    window.history.pushState({}, "", "/after-stop");
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new Event("pagehide"));
    tracker.track("After stop");
    tracker.flush(false);

    await jest.advanceTimersByTimeAsync(
      PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS * 3,
    );

    expect(sent).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
