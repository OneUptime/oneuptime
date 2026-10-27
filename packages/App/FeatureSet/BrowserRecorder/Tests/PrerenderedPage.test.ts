import {
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { RecorderInitOptions } from "../src/Config";
import { DebugRecord } from "../src/Debug";
import { EarlyErrorRecord } from "../src/EarlyErrors";
import { definePrerendering, resetDocumentState } from "./TrustedEvents";

/*
 * A page the browser PRERENDERS - speculation rules, or Chrome's address
 * bar guessing where the visitor is going - runs the loader and the
 * recorder before anybody opens it, and many such pages are never opened.
 * Recording one made a session nobody visited. The recorder now waits:
 * nothing is built, stored or sent until the page is opened, and the
 * calls the page made and the errors it threw meanwhile are applied and
 * replayed then. RealBrowserPrerender runs the same in a real Chromium.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "tok",
  appIdentifier: "app-1",
  respectDoNotTrack: true,
};

/* Records everyone and uploads at once: the first chunk leaves at start. */
function recordEveryoneConfig(
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
    captureUserIdentity: false,
    respectDoNotTrack: true,
    configEpoch: 1,
    directive: "continue",
    ...overrides,
  };
}

/* Uploads only when something goes wrong: an error is what sends it. */
function onErrorConfig(): SessionReplayConfigResponse {
  return recordEveryoneConfig({
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    samplePercentage: 0,
  });
}

function bodyText(call: Array<unknown>): string {
  const init: Record<string, unknown> = call[1] as Record<string, unknown>;

  return new TextDecoder().decode(init["body"] as Uint8Array);
}

/* The envelope line of one posted chunk body. */
function envelopeOf(call: Array<unknown>): SessionReplayChunkEnvelope {
  const text: string = bodyText(call);

  return JSON.parse(
    text.slice(0, text.indexOf("\n")),
  ) as SessionReplayChunkEnvelope;
}

function storageKeys(storage: Storage): Array<string> {
  const keys: Array<string> = [];

  for (let index: number = 0; index < storage.length; index++) {
    keys.push(storage.key(index) as string);
  }

  return keys;
}

describe("a prerendered page", (): void => {
  let fetchMock: jest.Mock;

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  /* The visitor opens the page: prerendering ends, prerenderingchange fires. */
  const open: () => void = (): void => {
    definePrerendering(false);
    document.dispatchEvent(new Event("prerenderingchange"));
  };

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "<section id='app'><p>content</p></section>";

    delete globalRecord["CompressionStream"];
    delete globalRecord["__ONEUPTIME_SESSION_REPLAY_STARTED__"];
    delete globalRecord["OneUptimeReplayQueue"];

    /* The diagnostics timeline lives on the page, not the module: start empty. */
    delete globalRecord["__ONEUPTIME_SESSION_REPLAY_DEBUG__"];

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

  /* The test's own copy of the artifact, for afterEach to wind down. */
  let loaded: typeof import("../src/Index") | null = null;

  afterEach((): void => {
    /*
     * The document outlives each test's copy of the artifact: a page a
     * test left unopened still has its listener on it, and would start a
     * recorder in the next test that opens one. Open it here and stop
     * whatever that started.
     */
    open();
    loaded?.stop();
    loaded = null;

    resetDocumentState();
    delete globalRecord["__ONEUPTIME_SESSION_REPLAY_STARTED__"];
    delete globalRecord["OneUptimeReplayQueue"];
    jest.restoreAllMocks();
  });

  const importIndex: () => Promise<
    typeof import("../src/Index")
  > = async (): Promise<typeof import("../src/Index")> => {
    jest.resetModules();
    loaded = await import("../src/Index");
    return loaded;
  };

  const tick: () => Promise<void> = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  };

  const settle: () => Promise<void> = async (): Promise<void> => {
    await tick();
    await tick();
  };

  const codesOf: (records: Array<DebugRecord>) => Array<string> = (
    records: Array<DebugRecord>,
  ): Array<string> => {
    return records.map((record: DebugRecord): string => {
      return record.code;
    });
  };

  it("a page nobody has opened records nothing: no recorder, no request, nothing stored", async (): Promise<void> => {
    definePrerendering(true);

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, recordEveryoneConfig(), []);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(index.getSessionId()).toBeNull();
    expect(index.getVisitorId()).toBe("");
    expect(storageKeys(window.localStorage)).toEqual([]);
    expect(storageKeys(window.sessionStorage)).toEqual([]);

    const diagnostics: ReturnType<typeof index.getDiagnostics> =
      index.getDiagnostics();

    expect(diagnostics.state).toBe("none");
    expect(diagnostics.isRecording).toBe(false);
    expect(diagnostics.bootstrapDecision).toBe("not-started");
    expect(codesOf(diagnostics.records)).toContain("prerender-wait");
  });

  it("the same page, not prerendered, records and uploads at once (control)", async (): Promise<void> => {
    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, recordEveryoneConfig(), []);
    await settle();

    expect(fetchMock).toHaveBeenCalled();
    expect(index.getSessionId()).not.toBeNull();
    expect(codesOf(index.getDiagnostics().records)).not.toContain(
      "prerender-wait",
    );

    index.stop();
  });

  it("once opened, the session starts then, from the page the visitor sees", async (): Promise<void> => {
    definePrerendering(true);

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, recordEveryoneConfig(), []);
    await settle();

    /* The page changes while nobody is looking. */
    document.body.innerHTML = "<article id='app'><p>content</p></article>";

    const openedAt: number = Date.now();

    open();
    await settle();

    expect(fetchMock).toHaveBeenCalled();
    expect(index.getDiagnostics().bootstrapDecision).toBe("started");
    expect(index.getDiagnostics().isRecording).toBe(true);

    const first: Array<unknown> = fetchMock.mock.calls[0] as Array<unknown>;
    const envelope: SessionReplayChunkEnvelope = envelopeOf(first);

    expect(envelope.chunkIndex).toBe(0);
    expect(envelope.hasFullSnapshot).toBe(true);
    expect(envelope.sessionStartUnixMs).toBeGreaterThanOrEqual(openedAt);

    /* The snapshot is of the page as opened, not as it was prerendered. */
    const body: string = bodyText(first);

    expect(body).toContain('"tagName":"article"');
    expect(body).not.toContain('"tagName":"section"');

    index.stop();
  });

  it("the page's calls while it waits are queued, not dropped, and applied once it is opened", async (): Promise<void> => {
    definePrerendering(true);

    const index: typeof import("../src/Index") = await importIndex();

    /*
     * Explicit consent: without the grant the page gave while it waited,
     * nothing would ever upload.
     */
    index.bootstrap(
      INIT_OPTIONS,
      recordEveryoneConfig({
        consentMode: SessionReplayConsentMode.RequireExplicit,
        captureUserIdentity: true,
      }),
      [],
    );

    index.grantConsent();
    index.identify("user-42");
    index.setTags({ plan: "pro" });
    index.addTag("build", 7);
    index.track("checkout_started");
    index.captureSession("support asked");
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(codesOf(index.getDiagnostics().records)).not.toContain(
      "api-no-recorder",
    );

    open();
    await settle();

    expect(fetchMock).toHaveBeenCalled();

    const envelope: SessionReplayChunkEnvelope = envelopeOf(
      fetchMock.mock.calls[0] as Array<unknown>,
    );

    expect(envelope.chunkIndex).toBe(0);
    expect(envelope.meta?.identifiedUserRef).toBe("user-42");
    expect(envelope.meta?.tags).toEqual({ plan: "pro", build: "7" });
    expect(index.getDiagnostics().decisions?.uploadsAllowed).toBe(true);

    /* Opened and stopped, a call has no recorder again and says so. */
    index.stop();
    index.identify("user-43");

    expect(codesOf(index.getDiagnostics().records)).toContain(
      "api-no-recorder",
    );
    expect(globalRecord["OneUptimeReplayQueue"]).toEqual([]);
  });

  it("stop() while it waits: nothing starts when it is opened", async (): Promise<void> => {
    definePrerendering(true);

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, recordEveryoneConfig(), []);
    index.stop();

    open();
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(index.getSessionId()).toBeNull();
    expect(index.getDiagnostics().bootstrapDecision).toBe(
      "cancelled-before-start",
    );
  });

  it("revokeConsent() while it waits wins over the first upload once it is opened", async (): Promise<void> => {
    definePrerendering(true);

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, recordEveryoneConfig(), []);
    index.revokeConsent();

    open();
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(index.getDiagnostics().decisions?.uploadBlockedBy).toBe("consent");

    index.stop();
  });

  it("an error the page throws while it waits is replayed once it is opened", async (): Promise<void> => {
    definePrerendering(true);

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, onErrorConfig(), []);

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom while unseen",
        filename: "https://shop.example.com/app.js",
      }),
    );
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();

    open();
    await settle();

    expect(index.getDiagnostics().triggerReason).toBe("error");
    expect(fetchMock).toHaveBeenCalled();

    index.stop();
  });

  it("so is one the loader caught before the recorder arrived", async (): Promise<void> => {
    definePrerendering(true);

    const startupError: EarlyErrorRecord = {
      kind: "error",
      message: "boom during startup",
      source: "https://shop.example.com/app.js",
      atUnixMs: Date.now() - 3000,
    };

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, onErrorConfig(), [startupError]);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();

    open();
    await settle();

    expect(index.getDiagnostics().triggerReason).toBe("error");
    expect(fetchMock).toHaveBeenCalled();

    index.stop();
  });

  it("a second copy of the snippet while it waits stands down without touching the first", async (): Promise<void> => {
    definePrerendering(true);

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(INIT_OPTIONS, recordEveryoneConfig(), []);
    index.bootstrap(INIT_OPTIONS, recordEveryoneConfig(), []);

    expect(index.getDiagnostics().bootstrapDecision).toBe("not-started");
    expect(codesOf(index.getDiagnostics().records)).toContain(
      "bootstrap-already-running",
    );

    open();
    await settle();

    expect(index.getDiagnostics().bootstrapDecision).toBe("started");
    expect(fetchMock).toHaveBeenCalled();

    index.stop();
  });

  it("the privacy gates still answer at once: a stop directive never waits", async (): Promise<void> => {
    definePrerendering(true);

    const index: typeof import("../src/Index") = await importIndex();

    index.bootstrap(
      INIT_OPTIONS,
      recordEveryoneConfig({ directive: "stop" }),
      [],
    );

    expect(index.getDiagnostics().bootstrapDecision).toBe("directive-stop");

    open();
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(index.getSessionId()).toBeNull();
  });
});
