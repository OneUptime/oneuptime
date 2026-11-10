import { SessionReplayConfigResponse } from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import {
  PRODUCT_ANALYTICS_EVENTS_PATH,
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  ProductAnalyticsEventKind,
  ProductAnalyticsWireBatch,
  ProductAnalyticsWireEvent,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import { RecorderInitOptions } from "../src/Config";
import { DebugRecord } from "../src/Debug";

/*
 * Product analytics events behind the real recorder and the public API
 * (issue #6444, part two): which sessions send them, that track() feeds
 * both the recording and the events, metric(), the pre-load queue, consent
 * and stop(). ProductAnalytics.test.ts covers the channel's own rules.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.example.com",
  token: "tok",
  appIdentifier: "app-1",
  respectDoNotTrack: true,
};

const EVENTS_URL: string = `https://oneuptime.example.com${PRODUCT_ANALYTICS_EVENTS_PATH}`;

function baseConfig(): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    captureTrigger: SessionReplayCaptureTrigger.Always,
    consentMode: SessionReplayConsentMode.NotRequired,
    /* Left out by the replay sample: the events still go. */
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
    productAnalytics: { enabled: true, userPropertyKeys: ["plan"] },
  };
}

describe("Recorder product analytics", (): void => {
  let fetchMock: jest.Mock;

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  beforeEach((): void => {
    jest.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/checkout");
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
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const importIndex: () => Promise<
    typeof import("../src/Index")
  > = async (): Promise<typeof import("../src/Index")> => {
    jest.resetModules();
    return await import("../src/Index");
  };

  interface AnalyticsPost {
    headers: Record<string, string>;
    batch: ProductAnalyticsWireBatch;
  }

  const analyticsPosts: () => Array<AnalyticsPost> =
    (): Array<AnalyticsPost> => {
      return fetchMock.mock.calls
        .filter((call: Array<unknown>): boolean => {
          return call[0] === EVENTS_URL;
        })
        .map((call: Array<unknown>): AnalyticsPost => {
          const init: RequestInit = call[1] as RequestInit;

          return {
            headers: init.headers as Record<string, string>,
            batch: JSON.parse(init.body as string) as ProductAnalyticsWireBatch,
          };
        });
    };

  const analyticsEvents: () => Array<ProductAnalyticsWireEvent> =
    (): Array<ProductAnalyticsWireEvent> => {
      return analyticsPosts().flatMap(
        (post: AnalyticsPost): Array<ProductAnalyticsWireEvent> => {
          return post.batch.events;
        },
      );
    };

  const replayPosts: () => Array<Array<unknown>> = (): Array<
    Array<unknown>
  > => {
    return fetchMock.mock.calls.filter((call: Array<unknown>): boolean => {
      return call[0] !== EVENTS_URL;
    });
  };

  const flushInterval: () => Promise<void> = async (): Promise<void> => {
    await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);
  };

  it("sends a left-out session's start, page views and track() events, and nothing of the recording", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, baseConfig());

    expect(index.getDiagnostics().state).toBe("not-sampled");
    expect(index.getDiagnostics().productAnalytics.state).toBe("on");

    index.track("Signed up", { plan: "pro" });
    await flushInterval();

    expect(replayPosts()).toHaveLength(0);
    expect(analyticsPosts()).toHaveLength(1);

    const post: AnalyticsPost = analyticsPosts()[0]!;

    expect(post.headers["x-oneuptime-token"]).toBe("tok");
    expect(post.headers["Content-Type"]).toBe("application/json");
    expect(post.batch.sessionId).toBe(index.getDiagnostics().sessionId);
    expect(post.batch.visitorId).toBe(index.getDiagnostics().visitorId);
    expect(post.batch.consentState).toBe("NotRequired");
    expect(post.batch.context.deviceType).not.toBe("");
    expect(
      post.batch.events.map((event: ProductAnalyticsWireEvent): string => {
        return `${event.kind}:${event.name}`;
      }),
    ).toEqual(["session:", "page:/checkout", "custom:Signed up"]);
    expect(post.batch.events[2]?.properties).toEqual({ plan: "pro" });

    index.stop();
  });

  it("files a recorded session's events under the recording's session", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, { ...baseConfig(), samplePercentage: 100 });

    expect(index.getDiagnostics().isRecording).toBe(true);

    index.track("Opened cart");
    await flushInterval();

    const post: AnalyticsPost | undefined = analyticsPosts()[0];

    expect(post?.batch.sessionId).toBe(index.getSessionId());
    expect(
      analyticsEvents().some((event: ProductAnalyticsWireEvent): boolean => {
        return (
          event.kind === ProductAnalyticsEventKind.Custom &&
          event.name === "Opened cart"
        );
      }),
    ).toBe(true);

    index.stop();
  });

  it("sends nothing when the application has product analytics off, and metric() says why", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();
    const config: SessionReplayConfigResponse = baseConfig();

    delete config.productAnalytics;

    index.bootstrap(INIT_OPTIONS, config);
    index.track("Signed up");
    index.metric("cart.value", 10);

    await flushInterval();
    await flushInterval();

    expect(analyticsPosts()).toHaveLength(0);
    expect(index.getDiagnostics().productAnalytics).toEqual({
      state: "off",
      pending: 0,
      dropped: 0,
    });
    expect(
      index.getDiagnostics().records.some((record: DebugRecord): boolean => {
        return record.code === "metric-analytics-off";
      }),
    ).toBe(true);

    index.stop();
  });

  it("sends metric() points with their attributes", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, baseConfig());
    index.metric("checkout.duration_ms", 1834, { step: "payment" });

    await flushInterval();

    expect(analyticsPosts()[0]?.batch.metrics).toEqual([
      {
        name: "checkout.duration_ms",
        value: 1834,
        at: expect.any(Number),
        attributes: { step: "payment" },
      },
    ]);

    index.stop();
  });

  it("applies track and metric pushed onto the queue before the recorder arrived", async (): Promise<void> => {
    globalRecord["OneUptimeReplayQueue"] = [
      ["track", "Landed", { campaign: "autumn" }],
      ["metric", "page.load_ms", 820, { route: "home" }],
    ];

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, baseConfig());
    await flushInterval();

    const batch: ProductAnalyticsWireBatch | undefined =
      analyticsPosts()[0]?.batch;

    expect(
      batch?.events.find((event: ProductAnalyticsWireEvent): boolean => {
        return event.name === "Landed";
      })?.properties,
    ).toEqual({ campaign: "autumn" });
    expect(batch?.metrics[0]?.name).toBe("page.load_ms");
    expect(batch?.metrics[0]?.value).toBe(820);
    expect(batch?.metrics[0]?.attributes).toEqual({ route: "home" });

    index.stop();
  });

  it("holds the events of an application that asks for consent until it is granted", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, {
      ...baseConfig(),
      consentMode: SessionReplayConsentMode.RequireExplicit,
    });

    index.track("Browsed");
    await flushInterval();
    await flushInterval();

    expect(analyticsPosts()).toHaveLength(0);
    expect(index.getDiagnostics().productAnalytics.pending).toBeGreaterThan(0);

    index.grantConsent();
    await jest.advanceTimersByTimeAsync(0);

    expect(analyticsPosts()).toHaveLength(1);
    expect(analyticsPosts()[0]?.batch.consentState).toBe("Granted");
    expect(
      analyticsEvents().some((event: ProductAnalyticsWireEvent): boolean => {
        return event.name === "Browsed";
      }),
    ).toBe(true);

    index.stop();
  });

  it("drops the held events when consent is withdrawn", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, baseConfig());
    index.track("Before");
    index.revokeConsent();
    index.track("After");

    await flushInterval();
    await flushInterval();

    expect(analyticsPosts()).toHaveLength(0);
    expect(index.getDiagnostics().productAnalytics.pending).toBe(0);

    index.stop();
  });

  it("stop() stops the events too", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, baseConfig());
    index.stop();
    index.track("After stop");

    await flushInterval();

    expect(analyticsPosts()).toHaveLength(0);
    expect(index.getDiagnostics().productAnalytics.state).toBe("off");
  });

  it("sends nothing from a page whose visitor asked not to be tracked", async (): Promise<void> => {
    Object.defineProperty(navigator, "doNotTrack", {
      configurable: true,
      get: (): string => {
        return "1";
      },
    });

    try {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig());
      index.track("Signed up");
      await flushInterval();

      expect(index.getDiagnostics().bootstrapDecision).toBe("privacy-signal");
      expect(analyticsPosts()).toHaveLength(0);
    } finally {
      Object.defineProperty(navigator, "doNotTrack", {
        configurable: true,
        get: (): string | null => {
          return null;
        },
      });
    }
  });
});
