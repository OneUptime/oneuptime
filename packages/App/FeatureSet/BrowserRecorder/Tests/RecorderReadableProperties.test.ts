import {
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import {
  SessionReplayCustomEventTag,
  SessionReplayCustomPayload,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import {
  PRODUCT_ANALYTICS_EVENTS_PATH,
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  ProductAnalyticsEventKind,
  ProductAnalyticsWireBatch,
  ProductAnalyticsWireEvent,
  ProductAnalyticsWireMetric,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import CommonMasking from "Common/Utils/Rum/Masking";
import { RecorderInitOptions } from "../src/Config";
import Recorder from "../src/Recorder";

/*
 * READABLE EVENT PROPERTIES (issue #7501).
 *
 * Under Mask all text the recorder masks the value of every track()
 * property, and so a funnel split by a property ("step", "setup") was one
 * bucket of placeholders. An application may list the keys whose values
 * its own code chooses: a listed key keeps its value as written - in the
 * recording's marker and in the product analytics event alike - but only
 * while the value is a short token. A listed key's sentence, an unlisted
 * key's token and every identify() trait are masked as before, and with no
 * keys listed - the default - nothing is readable.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

const CHUNK_PATH: string = "session-replay/v1/chunk";
const EVENT_TYPE_CUSTOM: number = 5;

const SENTENCE: string = "Jane Doe asked for a refund";

function config(
  overrides: Partial<SessionReplayConfigResponse> = {},
): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    captureTrigger: SessionReplayCaptureTrigger.Always,
    consentMode: SessionReplayConsentMode.NotRequired,
    samplePercentage: 100,
    maskSelectors: [],
    blockSelectors: [],
    urlAllowlist: [],
    ignoreErrorPatterns: [],
    recordCanvas: false,
    captureUserIdentity: true,
    respectDoNotTrack: true,
    configEpoch: 1,
    directive: "continue",
    ...overrides,
  };
}

const PROPERTIES: Record<string, string> = {
  setup: "monitor.website",
  step: "billing",
  plan: "pro",
  note: SENTENCE,
};

const masked: (value: string) => string = (value: string): string => {
  return CommonMasking.maskText(value);
};

interface RecordedEvent {
  type: number;
  timestamp: number;
  data: Record<string, unknown>;
}

describe("Recorder readable event properties (#7501)", (): void => {
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
    document.body.innerHTML = "<div id='app'><h1>Checkout</h1></div>";

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

  const build: (
    overrides?: Partial<SessionReplayConfigResponse>,
  ) => Recorder = (
    overrides?: Partial<SessionReplayConfigResponse>,
  ): Recorder => {
    const instance: Recorder = new RecorderOnFakeClock({
      initOptions: INIT_OPTIONS,
      config: config(overrides),
    });

    started.push(instance);

    return instance;
  };

  const drainMicrotasks: () => Promise<void> = async (): Promise<void> => {
    for (let i: number = 0; i < 60; i++) {
      await Promise.resolve();
    }
  };

  const flushTick: () => Promise<void> = async (): Promise<void> => {
    jest.advanceTimersByTime(0);
    await drainMicrotasks();
    jest.advanceTimersByTime(SESSION_REPLAY_FLUSH_INTERVAL_MS);
    await drainMicrotasks();
  };

  interface Frame {
    envelope: SessionReplayChunkEnvelope;
    events: Array<RecordedEvent>;
  }

  const frames: () => Array<Frame> = (): Array<Frame> => {
    const result: Array<Frame> = [];

    for (const call of fetchMock.mock.calls) {
      if (String(call[0]).indexOf(CHUNK_PATH) < 0) {
        continue;
      }

      const body: Uint8Array = (call[1] as Record<string, unknown>)[
        "body"
      ] as Uint8Array;
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

        result.push({
          envelope: envelope,
          events: JSON.parse(
            new TextDecoder().decode(rest.subarray(start, end)),
          ) as Array<RecordedEvent>,
        });

        offset += end;
      }
    }

    return result;
  };

  // The properties of every track() marker in the recording, in order.
  const markedProperties: () => Array<
    Record<string, string> | undefined
  > = (): Array<Record<string, string> | undefined> => {
    return frames()
      .flatMap((frame: Frame): Array<RecordedEvent> => {
        return frame.events;
      })
      .filter((event: RecordedEvent): boolean => {
        return (
          event.type === EVENT_TYPE_CUSTOM &&
          event.data["tag"] === SessionReplayCustomEventTag.Custom
        );
      })
      .map((event: RecordedEvent): Record<string, string> | undefined => {
        return (event.data["payload"] as SessionReplayCustomPayload).properties;
      });
  };

  const trackOnce: (instance: Recorder) => Promise<void> = async (
    instance: Recorder,
  ): Promise<void> => {
    instance.start();
    await drainMicrotasks();
    instance.track("guided_setup/step_reached", PROPERTIES);
    await flushTick();
  };

  describe("in the recording's track() marker", (): void => {
    it("masks every property value under Mask all text when no key is listed: the default", async (): Promise<void> => {
      const instance: Recorder = build();

      await trackOnce(instance);

      expect(markedProperties()).toEqual([
        {
          setup: masked("monitor.website"),
          step: masked("billing"),
          plan: masked("pro"),
          note: masked(SENTENCE),
        },
      ]);

      for (const value of Object.values(markedProperties()[0] || {})) {
        expect(value).toMatch(/^•+$/);
      }
    });

    it("keeps a listed key's token as written, and masks its sentence and every unlisted key", async (): Promise<void> => {
      const instance: Recorder = build({
        readableEventPropertyKeys: ["setup", "step", "note"],
      });

      await trackOnce(instance);

      expect(markedProperties()).toEqual([
        {
          setup: "monitor.website",
          step: "billing",
          plan: masked("pro"),
          note: masked(SENTENCE),
        },
      ]);
    });

    it("keeps a listed key's value only while it is a short token", async (): Promise<void> => {
      const instance: Recorder = build({
        readableEventPropertyKeys: ["user", "id", "step"],
      });

      instance.start();
      await drainMicrotasks();
      instance.track("signed_in", {
        user: "jane@acme.com",
        id: "x".repeat(33),
        step: "two words",
      });
      await flushTick();

      expect(markedProperties()).toEqual([
        {
          user: masked("jane@acme.com"),
          id: masked("x".repeat(33)),
          step: masked("two words"),
        },
      ]);
    });

    it("never keeps an identify() trait readable, even one a key of the list names", async (): Promise<void> => {
      const instance: Recorder = build({
        readableEventPropertyKeys: ["step", "plan"],
      });

      instance.start();
      await drainMicrotasks();
      instance.identify("user-42", { step: "billing", plan: "pro" });
      await flushTick();

      const traits: Array<Record<string, string>> = frames()
        .map((frame: Frame): Record<string, string> | undefined => {
          return frame.envelope.meta?.identifiedUserTraits;
        })
        .filter((value: Record<string, string> | undefined): boolean => {
          return Boolean(value);
        }) as Array<Record<string, string>>;

      expect(traits.length).toBeGreaterThan(0);

      for (const trait of traits) {
        expect(trait).toEqual({ step: masked("billing"), plan: masked("pro") });
      }
    });

    it("changes nothing in a mode that records text: every value was readable already", async (): Promise<void> => {
      const instance: Recorder = build({
        maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        readableEventPropertyKeys: ["step"],
      });

      await trackOnce(instance);

      expect(markedProperties()).toEqual([PROPERTIES]);
    });

    it("a captureSession() reason stays masked unless its key is listed", async (): Promise<void> => {
      const instance: Recorder = build({
        readableEventPropertyKeys: ["step"],
      });

      instance.start();
      await drainMicrotasks();
      instance.captureSession("checkout_failed");
      await flushTick();

      expect(markedProperties()).toEqual([
        { reason: masked("checkout_failed") },
      ]);
    });
  });

  it("product analytics masks a track() call's properties and a metric's attributes the same way", (): void => {
    const instance: Recorder = build({
      readableEventPropertyKeys: ["step", "currency"],
    });

    expect(
      instance.maskAnalyticsProperties({
        step: "billing",
        note: SENTENCE,
        currency: "EUR",
        plan: "pro",
      }),
    ).toEqual({
      step: "billing",
      note: masked(SENTENCE),
      currency: "EUR",
      plan: masked("pro"),
    });

    const byDefault: Recorder = build();

    expect(byDefault.maskAnalyticsProperties({ step: "billing" })).toEqual({
      step: masked("billing"),
    });
  });
});

/*
 * The same through the public API and product analytics' own batches: a
 * funnel split by a listed property is built from readable values, and no
 * free text leaves the page through one.
 */
describe("product analytics events with readable event properties (#7501)", (): void => {
  const EVENTS_URL: string = `https://oneuptime.example.com${PRODUCT_ANALYTICS_EVENTS_PATH}`;
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

  const batches: () => Array<ProductAnalyticsWireBatch> =
    (): Array<ProductAnalyticsWireBatch> => {
      return fetchMock.mock.calls
        .filter((call: Array<unknown>): boolean => {
          return call[0] === EVENTS_URL;
        })
        .map((call: Array<unknown>): ProductAnalyticsWireBatch => {
          return JSON.parse(
            (call[1] as RequestInit).body as string,
          ) as ProductAnalyticsWireBatch;
        });
    };

  const run: (readableEventPropertyKeys: Array<string> | undefined) => Promise<{
    custom: ProductAnalyticsWireEvent | undefined;
    metric: ProductAnalyticsWireMetric | undefined;
  }> = async (
    readableEventPropertyKeys: Array<string> | undefined,
  ): Promise<{
    custom: ProductAnalyticsWireEvent | undefined;
    metric: ProductAnalyticsWireMetric | undefined;
  }> => {
    jest.resetModules();
    const index: typeof import("../src/Index") = await import("../src/Index");

    index.bootstrap(
      { ...INIT_OPTIONS, host: "https://oneuptime.example.com" },
      config({
        captureUserIdentity: false,
        productAnalytics: { enabled: true, userPropertyKeys: [] },
        ...(readableEventPropertyKeys
          ? { readableEventPropertyKeys: readableEventPropertyKeys }
          : {}),
      }),
    );

    index.track("guided_setup/step_reached", PROPERTIES);
    index.metric("cart.value", 42.5, { currency: "EUR", note: SENTENCE });
    await jest.advanceTimersByTimeAsync(PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

    const events: Array<ProductAnalyticsWireEvent> = batches().flatMap(
      (batch: ProductAnalyticsWireBatch): Array<ProductAnalyticsWireEvent> => {
        return batch.events;
      },
    );
    const metrics: Array<ProductAnalyticsWireMetric> = batches().flatMap(
      (batch: ProductAnalyticsWireBatch): Array<ProductAnalyticsWireMetric> => {
        return batch.metrics;
      },
    );

    index.stop();

    return {
      custom: events.find((event: ProductAnalyticsWireEvent): boolean => {
        return event.kind === ProductAnalyticsEventKind.Custom;
      }),
      metric: metrics[0],
    };
  };

  it("keeps a listed key's token readable in the event and the metric, and nothing else", async (): Promise<void> => {
    const sent: {
      custom: ProductAnalyticsWireEvent | undefined;
      metric: ProductAnalyticsWireMetric | undefined;
    } = await run(["setup", "step", "currency", "note"]);

    expect(sent.custom?.properties).toEqual({
      setup: "monitor.website",
      step: "billing",
      plan: masked("pro"),
      note: masked(SENTENCE),
    });
    expect(sent.metric?.attributes).toEqual({
      currency: "EUR",
      note: masked(SENTENCE),
    });
    expect(JSON.stringify(batches())).not.toContain("Jane");
  });

  it("masks every value when the application lists no key: the default", async (): Promise<void> => {
    const sent: {
      custom: ProductAnalyticsWireEvent | undefined;
      metric: ProductAnalyticsWireMetric | undefined;
    } = await run(undefined);

    expect(sent.custom?.properties).toEqual({
      setup: masked("monitor.website"),
      step: masked("billing"),
      plan: masked("pro"),
      note: masked(SENTENCE),
    });
    expect(sent.metric?.attributes).toEqual({
      currency: masked("EUR"),
      note: masked(SENTENCE),
    });

    for (const value of [
      ...Object.values(sent.custom?.properties || {}),
      ...Object.values(sent.metric?.attributes || {}),
    ]) {
      expect(value).toMatch(/^•+$/);
    }
  });
});
