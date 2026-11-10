import {
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import {
  SessionReplayCustomSignalConfig,
  SessionReplayCustomSignalCount,
  SessionReplayFrustrationSettings,
  SessionReplayFrustrationSignalsConfig,
  getDefaultSessionReplayFrustrationSettings,
  toSessionReplayFrustrationSignalsConfig,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";
import { RecorderInitOptions } from "../src/Config";

/*
 * What counts as frustration, end to end through the recorder: the config's
 * frustrationSignals reach the detectors, a signal of the application's own
 * is marked in the payload and counted on the envelope, one that counts as
 * frustration starts an upload under "On error or frustration" exactly like
 * a rage click, a marker does not, and a switched-off built-in rule counts
 * nothing. The page under test is https://shop.example.com/checkout (the
 * jest environment's URL).
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "tok",
  appIdentifier: "app-1",
  respectDoNotTrack: true,
};

function signalsConfig(
  customSignals: Array<SessionReplayCustomSignalConfig>,
  change?: (settings: SessionReplayFrustrationSettings) => void,
): SessionReplayFrustrationSignalsConfig {
  const settings: SessionReplayFrustrationSettings =
    getDefaultSessionReplayFrustrationSettings();

  if (change) {
    change(settings);
  }

  return {
    ...toSessionReplayFrustrationSignalsConfig(settings),
    customSignals: customSignals,
  };
}

function baseConfig(
  frustrationSignals: SessionReplayFrustrationSignalsConfig,
): SessionReplayConfigResponse {
  return {
    enabled: true,
    recorderVersion: "11.7.3",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    consentMode: SessionReplayConsentMode.NotRequired,
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
    frustrationSignals: frustrationSignals,
  };
}

interface CapturedPost {
  envelope: SessionReplayChunkEnvelope;
  payload: string;
}

describe("Recorder frustration signals", (): void => {
  let fetchMock: jest.Mock;

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = `
      <div id='app'>
        <button id='pay'><span id='pay-label'>Pay now</span></button>
        <p id='text'>Order summary</p>
      </div>
    `;

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
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): string => {
        return "visible";
      },
    });
    jest.restoreAllMocks();
  });

  const importIndex: () => Promise<
    typeof import("../src/Index")
  > = async (): Promise<typeof import("../src/Index")> => {
    jest.resetModules();
    return await import("../src/Index");
  };

  const tick: () => Promise<void> = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  };

  const wait: (ms: number) => Promise<void> = async (
    ms: number,
  ): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, ms);
    });
  };

  const posts: () => Array<CapturedPost> = (): Array<CapturedPost> => {
    return fetchMock.mock.calls.map((call: Array<unknown>): CapturedPost => {
      const init: Record<string, unknown> = call[1] as Record<string, unknown>;
      const text: string = new TextDecoder().decode(init["body"] as Uint8Array);
      const newline: number = text.indexOf("\n");

      return {
        envelope: JSON.parse(
          text.slice(0, newline),
        ) as SessionReplayChunkEnvelope,
        payload: text.slice(newline + 1),
      };
    });
  };

  const hidePage: () => Promise<void> = async (): Promise<void> => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): string => {
        return "hidden";
      },
    });

    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    await tick();
  };

  /* Every chunk's custom signal counts, added up per name. */
  const customCounts: () => Record<
    string,
    { count: number; frustrationCount: number }
  > = (): Record<string, { count: number; frustrationCount: number }> => {
    const totals: Record<string, { count: number; frustrationCount: number }> =
      {};

    for (const post of posts()) {
      for (const entry of (post.envelope.signals.customSignals ||
        []) as Array<SessionReplayCustomSignalCount>) {
        const total: { count: number; frustrationCount: number } = totals[
          entry.name
        ] || { count: 0, frustrationCount: 0 };
        total.count += entry.count;
        total.frustrationCount += entry.frustrationCount;
        totals[entry.name] = total;
      }
    }

    return totals;
  };

  const counter: (
    key: "rageClickCount" | "deadClickCount" | "refreshRageCount",
  ) => number = (
    key: "rageClickCount" | "deadClickCount" | "refreshRageCount",
  ): number => {
    return posts().reduce((sum: number, post: CapturedPost): number => {
      return sum + (post.envelope.signals[key] || 0);
    }, 0);
  };

  const allPayloads: () => string = (): string => {
    return posts()
      .map((post: CapturedPost): string => {
        return post.payload;
      })
      .join("");
  };

  it("a page signal that counts as frustration starts an upload like a rage click", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(
      INIT_OPTIONS,
      baseConfig(
        signalsConfig([
          {
            name: "Reached checkout",
            trigger: "page",
            match: "/checkout*",
            isFrustration: true,
          },
        ]),
      ),
    );

    await tick();
    await hidePage();

    expect(posts().length).toBeGreaterThan(0);
    expect(posts()[0]?.envelope.triggerReason).toBe(
      SessionReplayTriggerReason.Frustration,
    );
    expect(customCounts()).toEqual({
      "Reached checkout": { count: 1, frustrationCount: 1 },
    });

    const payload: string = allPayloads();

    expect(payload).toContain('"oneuptime.signal"');
    expect(payload).toContain('"name":"Reached checkout"');
    expect(payload).toContain('"trigger":"page"');

    index.stop();
  });

  it("a marker is counted but never starts an upload on its own", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(
      INIT_OPTIONS,
      baseConfig(
        signalsConfig([
          {
            name: "Reached checkout",
            trigger: "page",
            match: "/checkout",
            isFrustration: false,
          },
        ]),
      ),
    );

    await tick();
    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(index.getDiagnostics().isUploading).toBe(false);

    // Uploaded for another reason, the marker is there, as a marker.
    index.captureSession("support ticket");
    await hidePage();

    expect(customCounts()).toEqual({
      "Reached checkout": { count: 1, frustrationCount: 0 },
    });
    expect(allPayloads()).toContain('"isFrustration":false');

    index.stop();
  });

  it("an event signal fires on the page's track() call", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, {
      ...baseConfig(
        signalsConfig([
          {
            name: "Payment failed",
            trigger: "event",
            match: "payment_failed",
            isFrustration: true,
          },
        ]),
      ),
      samplePercentage: 100,
    });

    await tick();

    index.track("payment_failed", { code: "51" });
    index.track("payment_started");

    await hidePage();

    expect(customCounts()).toEqual({
      "Payment failed": { count: 1, frustrationCount: 1 },
    });

    index.stop();
  });

  it("an error signal matches the error's raw text, and only its name is recorded", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(
      INIT_OPTIONS,
      baseConfig(
        signalsConfig([
          {
            name: "Card declined",
            trigger: "error",
            match: "card declined",
            isFrustration: true,
          },
        ]),
      ),
    );

    await tick();

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "PaymentError: Card declined for alice@example.com",
      }),
    );

    await hidePage();

    expect(customCounts()).toEqual({
      "Card declined": { count: 1, frustrationCount: 1 },
    });

    // The error went through masking as always: the text it matched is not in the recording.
    expect(allPayloads()).not.toContain("alice@example.com");
    expect(allPayloads()).not.toContain("Card declined for");

    index.stop();
  });

  it("an error signal also matches console.error", async (): Promise<void> => {
    // Quiet in the test output; the recorder wraps whatever console.error is.
    jest.spyOn(console, "error").mockImplementation((): void => {});

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, {
      ...baseConfig(
        signalsConfig([
          {
            name: "Card declined",
            trigger: "error",
            match: "card declined",
            isFrustration: false,
          },
        ]),
      ),
      samplePercentage: 100,
    });

    await tick();

    // eslint-disable-next-line no-console
    console.error("checkout:", "card declined", { attempt: 2 });

    await hidePage();

    expect(customCounts()).toEqual({
      "Card declined": { count: 1, frustrationCount: 0 },
    });

    index.stop();
  });

  it("a click signal fires on the element and carries where the click was", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, {
      ...baseConfig(
        signalsConfig([
          {
            name: "Pay clicked",
            trigger: "click",
            match: "#pay",
            isFrustration: false,
          },
        ]),
      ),
      samplePercentage: 100,
    });

    await tick();

    (document.getElementById("pay-label") as Element).dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 12, clientY: 34 }),
    );
    (document.getElementById("text") as Element).dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }),
    );

    await hidePage();

    expect(customCounts()).toEqual({
      "Pay clicked": { count: 1, frustrationCount: 0 },
    });
    expect(allPayloads()).toContain('"x":12');
    expect(allPayloads()).toContain('"y":34');

    index.stop();
  });

  it("a switched-off rage click rule counts nothing, however fast the clicks", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, {
      ...baseConfig(
        signalsConfig(
          [],
          (settings: SessionReplayFrustrationSettings): void => {
            settings.rageClick.isEnabled = false;
          },
        ),
      ),
      samplePercentage: 100,
    });

    await tick();

    for (let click: number = 0; click < 6; click++) {
      (document.getElementById("text") as Element).dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 50 }),
      );
    }

    await wait(1100);
    await hidePage();

    expect(counter("rageClickCount")).toBe(0);

    index.stop();
  });

  it("the same clicks are a rage click under the built-in rule", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, {
      ...baseConfig(signalsConfig([])),
      samplePercentage: 100,
    });

    await tick();

    for (let click: number = 0; click < 6; click++) {
      (document.getElementById("text") as Element).dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 50 }),
      );
    }

    await wait(1100);
    await hidePage();

    expect(counter("rageClickCount")).toBe(1);

    index.stop();
  });

  it("refresh rage follows the application's count, and stays quiet when switched off", async (): Promise<void> => {
    const twoLoads: SessionReplayFrustrationSignalsConfig = signalsConfig(
      [],
      (settings: SessionReplayFrustrationSettings): void => {
        settings.refreshRage.reloadCount = 2;
      },
    );

    const first: typeof import("../src/Index") = await importIndex();
    first.bootstrap(INIT_OPTIONS, {
      ...baseConfig(twoLoads),
      samplePercentage: 100,
    });
    await tick();
    first.stop();

    fetchMock.mockClear();
    delete globalRecord["__ONEUPTIME_SESSION_REPLAY_STARTED__"];

    // The second load of the same page within a minute: rage at a count of two.
    const second: typeof import("../src/Index") = await importIndex();
    second.bootstrap(INIT_OPTIONS, {
      ...baseConfig(twoLoads),
      samplePercentage: 100,
    });
    await tick();
    await hidePage();

    expect(counter("refreshRageCount")).toBe(1);
    second.stop();

    fetchMock.mockClear();
    delete globalRecord["__ONEUPTIME_SESSION_REPLAY_STARTED__"];

    const off: SessionReplayFrustrationSignalsConfig = signalsConfig(
      [],
      (settings: SessionReplayFrustrationSettings): void => {
        settings.refreshRage.isEnabled = false;
        settings.refreshRage.reloadCount = 2;
      },
    );

    const third: typeof import("../src/Index") = await importIndex();
    third.bootstrap(INIT_OPTIONS, {
      ...baseConfig(off),
      samplePercentage: 100,
    });
    await tick();
    await hidePage();

    expect(counter("refreshRageCount")).toBe(0);
    third.stop();
  });

  it("a recorder sent no frustrationSignals (an older server) keeps the built-in rules", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();
    const config: SessionReplayConfigResponse = {
      ...baseConfig(signalsConfig([])),
      samplePercentage: 100,
    };

    delete config.frustrationSignals;

    index.bootstrap(INIT_OPTIONS, config);

    await tick();

    for (let click: number = 0; click < 3; click++) {
      (document.getElementById("text") as Element).dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 50 }),
      );
    }

    await wait(1100);
    await hidePage();

    expect(counter("rageClickCount")).toBe(1);
    expect(customCounts()).toEqual({});

    index.stop();
  });
});
