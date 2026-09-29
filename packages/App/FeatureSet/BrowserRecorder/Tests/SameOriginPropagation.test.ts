import {
  SessionReplayChunkEnvelope,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import SessionSampling from "Common/Utils/Rum/SessionSampling";
import { parseSessionTraceState } from "Common/Utils/Rum/SessionTraceState";
import { RecorderInitOptions } from "../src/Config";
import { DebugRecord, clearDebugRecords, getDebugRecords } from "../src/Debug";
import Recorder from "../src/Recorder";

/*
 * Same-origin trace propagation through the whole recorder: which session
 * id the page's own requests carry, and when they carry none.
 *
 * The rule under test is the session predicate Recorder hands the
 * NetworkRecorder: a request carries the session - and a minted, sampled
 * traceparent - only while that session is UPLOADING with consent. Every
 * other state (before consent, after a revoke, after stop, before an
 * OnErrorOrFrustration trigger, a rotation onto an unsampled id) sends
 * nothing new at all.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

const SESSION_KEY: string = "oneuptime.replay.session";
const TRACEPARENT_SHAPE: RegExp = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/;

function baseConfig(): SessionReplayConfigResponse {
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
    sameOriginTracePropagation: true,
  };
}

/* A 32-hex id whose sampling verdict at `percentage` is `sampled`. */
function idWithVerdict(percentage: number, sampled: boolean): string {
  for (let i: number = 1; i < 10000; i++) {
    const id: string = i.toString(16).padStart(32, "0");

    if (SessionSampling.isSampled(id, percentage) === sampled) {
      return id;
    }
  }

  throw new Error("no id found");
}

function seedStoredSession(sessionId: string): void {
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      sessionId: sessionId,
      sessionStartUnixMs: Date.now() - 1000,
      lastActivityUnixMs: Date.now(),
    }),
  );
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe("same-origin propagation through the Recorder", (): void => {
  let fetchMock: jest.Mock;
  let recorder: Recorder | null = null;

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "<div id='app'><p>content</p></div>";
    clearDebugRecords();

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
  });

  afterEach((): void => {
    if (recorder) {
      recorder.stop();
      recorder = null;
    }

    jest.restoreAllMocks();
  });

  const startRecorder: (
    overrides?: Partial<SessionReplayConfigResponse>,
  ) => Recorder = (
    overrides?: Partial<SessionReplayConfigResponse>,
  ): Recorder => {
    recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: { ...baseConfig(), ...overrides },
    });

    recorder.start();

    return recorder;
  };

  /* The page's own calls, as the mock (the "native" fetch) received them. */
  const pageCalls: () => Array<Array<unknown>> = (): Array<Array<unknown>> => {
    return fetchMock.mock.calls.filter((call: Array<unknown>): boolean => {
      return String(call[0]).indexOf("session-replay/v1/chunk") < 0;
    });
  };

  const headersOf: (call: Array<unknown> | undefined) => Headers = (
    call: Array<unknown> | undefined,
  ): Headers => {
    const init: RequestInit | undefined = call?.[1] as RequestInit | undefined;

    return new Headers(
      init && init.headers
        ? Object.entries(init.headers as Record<string, string>)
        : [],
    );
  };

  /* The session id the page's Nth request carried, or null. */
  const sidOf: (index: number) => string | null = (
    index: number,
  ): string | null => {
    return (
      parseSessionTraceState(headersOf(pageCalls()[index]).get("tracestate"))
        .sessionTraceState?.sessionId || null
    );
  };

  const chunkPosts: () => Array<{
    envelope: SessionReplayChunkEnvelope;
    payload: string;
  }> = (): Array<{ envelope: SessionReplayChunkEnvelope; payload: string }> => {
    return fetchMock.mock.calls
      .filter((call: Array<unknown>): boolean => {
        return String(call[0]).indexOf("session-replay/v1/chunk") >= 0;
      })
      .map(
        (
          call: Array<unknown>,
        ): { envelope: SessionReplayChunkEnvelope; payload: string } => {
          const init: Record<string, unknown> = call[1] as Record<
            string,
            unknown
          >;
          const text: string = new TextDecoder().decode(
            init["body"] as Uint8Array,
          );
          const newline: number = text.indexOf("\n");

          return {
            envelope: JSON.parse(
              text.slice(0, newline),
            ) as SessionReplayChunkEnvelope,
            payload: text.slice(newline + 1),
          };
        },
      );
  };

  it("carries the uploading session's id and a minted traceparent on the page's own requests", async (): Promise<void> => {
    const instance: Recorder = startRecorder();

    expect(instance.isUploading()).toBe(true);

    await window.fetch("/api/cart");

    const headers: Headers = headersOf(pageCalls()[0]);
    const traceparent: RegExpExecArray | null = TRACEPARENT_SHAPE.exec(
      headers.get("traceparent") || "",
    );

    expect(traceparent).not.toBeNull();
    expect(headers.get("tracestate")).toBe(
      `oneuptime=sid:${instance.getSessionId()};p:${traceparent?.[2]}`,
    );
  });

  it("keeps a minted same-origin id on the network event but out of the envelope traceIds", async (): Promise<void> => {
    const instance: Recorder = startRecorder({
      tracePropagationOrigins: ["https://api.allowed.example"],
    });

    const pageTraceId: string = "e".repeat(32);

    await window.fetch("/api/minted");
    await window.fetch("/api/page-set", {
      headers: { traceparent: `00-${pageTraceId}-${"f".repeat(16)}-01` },
    });
    await window.fetch("https://api.allowed.example/listed");

    const mintedId: string | undefined = TRACEPARENT_SHAPE.exec(
      headersOf(pageCalls()[0]).get("traceparent") || "",
    )?.[1];
    const listedId: string | undefined = TRACEPARENT_SHAPE.exec(
      headersOf(pageCalls()[2]).get("traceparent") || "",
    )?.[1];

    expect(mintedId).toBeDefined();
    expect(listedId).toBeDefined();

    instance.trigger(SessionReplayTriggerReason.Manual);
    sealByHiding();
    await tick();

    const posts: Array<{
      envelope: SessionReplayChunkEnvelope;
      payload: string;
    }> = chunkPosts();

    const rollup: Array<string> = posts.flatMap(
      (post: { envelope: SessionReplayChunkEnvelope }): Array<string> => {
        return post.envelope.traceIds || [];
      },
    );

    const payloads: string = posts
      .map((post: { payload: string }): string => {
        return post.payload;
      })
      .join("\n");

    expect(rollup).toContain(pageTraceId);
    expect(rollup).toContain(listedId);
    expect(rollup).not.toContain(mintedId);

    /* The network row still names it: clock anchoring and "Backend for this request". */
    expect(payloads).toContain(mintedId as string);
  });

  it("adds nothing new when the config has no sameOriginTracePropagation", async (): Promise<void> => {
    const config: SessionReplayConfigResponse = baseConfig();

    delete config.sameOriginTracePropagation;

    recorder = new Recorder({ initOptions: INIT_OPTIONS, config: config });
    recorder.start();

    await window.fetch("/api/cart");

    expect(pageCalls()[0]?.[1]).toBeUndefined();
    expect(
      getDebugRecords().find((record: DebugRecord): boolean => {
        return record.code === "same-origin-propagation";
      })?.detail,
    ).toEqual({ enabled: false, reason: "policy-off" });
  });

  it("logs same-origin-propagation once at start", (): void => {
    startRecorder();

    const records: Array<DebugRecord> = getDebugRecords().filter(
      (record: DebugRecord): boolean => {
        return record.code === "same-origin-propagation";
      },
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.detail).toEqual({ enabled: true, reason: "on" });
  });

  it("sends nothing before consent under RequireExplicit, and the session after grantConsent()", async (): Promise<void> => {
    const instance: Recorder = startRecorder({
      consentMode: SessionReplayConsentMode.RequireExplicit,
    });

    await window.fetch("/api/before-consent");

    expect(instance.isUploading()).toBe(false);
    expect(pageCalls()[0]?.[1]).toBeUndefined();

    instance.grantConsent();

    await window.fetch("/api/after-consent");

    expect(sidOf(1)).toBe(instance.getSessionId());
  });

  it("sends nothing after revokeConsent() - the withdrawn id is never sent - and a fresh id after a re-grant", async (): Promise<void> => {
    const instance: Recorder = startRecorder();

    await window.fetch("/api/a");

    const firstId: string = instance.getSessionId();

    expect(sidOf(0)).toBe(firstId);

    instance.revokeConsent();

    /* Identity still holds the withdrawn id; the predicate must not use it. */
    expect(instance.getSessionId()).toBe(firstId);

    await window.fetch("/api/b");

    expect(pageCalls()[1]?.[1]).toBeUndefined();

    instance.grantConsent();

    await window.fetch("/api/c");

    expect(sidOf(2)).toBe(instance.getSessionId());
    expect(sidOf(2)).not.toBe(firstId);
  });

  it("sends nothing after stop(), even through a wrapper that outlived it", async (): Promise<void> => {
    const instance: Recorder = startRecorder();

    /* The page patched fetch after the recorder, so stop() leaves ours in the chain. */
    const ours: typeof window.fetch = window.fetch;

    (window as unknown as Record<string, unknown>)["fetch"] = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      return ours(input, init);
    };

    instance.stop();
    recorder = null;

    await window.fetch("/api/after-stop");

    expect(pageCalls()[0]?.[1]).toBeUndefined();
  });

  it("OnErrorOrFrustration: nothing before a trigger, the session after it", async (): Promise<void> => {
    const instance: Recorder = startRecorder({
      captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
      samplePercentage: 0,
    });

    await window.fetch("/api/before-trigger");

    expect(instance.isUploading()).toBe(false);
    expect(pageCalls()[0]?.[1]).toBeUndefined();

    instance.captureSession();

    await window.fetch("/api/after-trigger");

    expect(instance.isUploading()).toBe(true);
    expect(sidOf(1)).toBe(instance.getSessionId());
  });

  it("sends nothing once the session rotates onto an unsampled id", async (): Promise<void> => {
    const sampledId: string = idWithVerdict(50, true);
    const unsampledId: string = idWithVerdict(50, false);

    seedStoredSession(sampledId);

    const instance: Recorder = startRecorder({ samplePercentage: 50 });

    expect(instance.getSessionId()).toBe(sampledId);

    await window.fetch("/api/sampled");

    expect(sidOf(0)).toBe(sampledId);

    /* A sibling tab rotated the shared session onto an unsampled id. */
    seedStoredSession(unsampledId);
    window.dispatchEvent(
      new StorageEvent("storage", { key: SESSION_KEY, newValue: "x" }),
    );

    expect(instance.getSessionId()).toBe(unsampledId);
    expect(instance.isUploading()).toBe(false);

    await window.fetch("/api/unsampled");

    expect(pageCalls()[1]?.[1]).toBeUndefined();
  });

  it("never puts the visitor id in any header", async (): Promise<void> => {
    const instance: Recorder = startRecorder();
    const visitorId: string = instance.getVisitorId();

    expect(visitorId).toMatch(/^[0-9a-f]{32}$/);

    await window.fetch("/api/a");
    await window.fetch("/api/b", { headers: { "x-a": "1" } });

    for (const call of pageCalls()) {
      headersOf(call).forEach((value: string): void => {
        expect(value).not.toContain(visitorId);
      });
    }
  });
});

describe("revokeConsent then grantConsent, both queued before start()", (): void => {
  const INDEX_INIT_OPTIONS: RecorderInitOptions = {
    host: "https://oneuptime.com",
    token: "tok",
    appIdentifier: "app-1",
    respectDoNotTrack: true,
  };

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  let fetchMock: jest.Mock;

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
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
    jest.restoreAllMocks();
  });

  /*
   * A consent banner that fires reject-then-accept while the artifact is
   * still downloading. The constructor adopted the stored session; the
   * revoke withdrew it. start() must not record - or send to the backend -
   * under that withdrawn id: the grant mints a fresh one.
   */
  it("starts on a fresh session id: the chunks and the page's requests never carry the withdrawn one", async (): Promise<void> => {
    const withdrawnId: string = "9".repeat(32);

    seedStoredSession(withdrawnId);

    globalRecord["OneUptimeReplayQueue"] = [
      ["revokeConsent"],
      ["grantConsent"],
    ];

    jest.resetModules();

    const index: typeof import("../src/Index") = await import("../src/Index");

    index.bootstrap(INDEX_INIT_OPTIONS, baseConfig(), []);

    await tick();
    await tick();

    const sessionId: string | null = index.getSessionId();

    expect(sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(sessionId).not.toBe(withdrawnId);

    await window.fetch("/api/after-grant");

    const pageCall: Array<unknown> | undefined = fetchMock.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return String(call[0]) === "/api/after-grant";
      },
    );

    const tracestate: string | null = new Headers(
      Object.entries(
        ((pageCall?.[1] as RequestInit | undefined)?.headers || {}) as Record<
          string,
          string
        >,
      ),
    ).get("tracestate");

    expect(
      parseSessionTraceState(tracestate).sessionTraceState?.sessionId,
    ).toBe(sessionId);

    const envelopes: Array<SessionReplayChunkEnvelope> = fetchMock.mock.calls
      .filter((call: Array<unknown>): boolean => {
        return String(call[0]).indexOf("session-replay/v1/chunk") >= 0;
      })
      .map((call: Array<unknown>): SessionReplayChunkEnvelope => {
        const text: string = new TextDecoder().decode(
          (call[1] as Record<string, unknown>)["body"] as Uint8Array,
        );

        return JSON.parse(
          text.slice(0, text.indexOf("\n")),
        ) as SessionReplayChunkEnvelope;
      });

    expect(envelopes.length).toBeGreaterThan(0);

    for (const envelope of envelopes) {
      expect(envelope.sessionId).toBe(sessionId);
      expect(envelope.sessionId).not.toBe(withdrawnId);
    }

    index.stop();
  });
});

/*
 * stop() discards the transport queue, so hiding the page is the way to put
 * the open chunk on the wire (the terminal keepalive path).
 */
function sealByHiding(): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): string => {
      return "hidden";
    },
  });

  document.dispatchEvent(new Event("visibilitychange"));

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): string => {
      return "visible";
    },
  });
}
