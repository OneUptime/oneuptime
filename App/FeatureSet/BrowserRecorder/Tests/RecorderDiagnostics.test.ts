import { SessionReplayConfigResponse } from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import { RecorderInitOptions } from "../src/Config";
import { DebugRecord, getDebugRecords, setEnabled } from "../src/Debug";
import Recorder from "../src/Recorder";

/*
 * What the recorder SAYS about itself, asserted against the real recorder
 * running real rrweb in jsdom rather than against a double.
 *
 * Every gate in this package fails closed and silently: an unsampled
 * session, a consent mode nobody granted, a 401 that trips the circuit
 * breaker, a server that switched the project off. From the customer's
 * browser all four look identical - no recording, no request, no console
 * output - which is why "session replay is broken" and "session replay is
 * switched off" were indistinguishable, and why these diagnostics exist.
 *
 * The tests below are the contract for that: each silent stop has to leave a
 * record behind naming ITSELF, carrying the specific values a support
 * engineer needs, and the last test in the file asserts the whole channel
 * cannot become a second, unmasked egress path for page content.
 */

const STATE_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY_DEBUG__";

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "test-token",
  appIdentifier: "app-1",
};

const baseConfig: () => SessionReplayConfigResponse =
  (): SessionReplayConfigResponse => {
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
    };
  };

/*
 * The diagnostics state lives on a global so the loader stub and the artifact
 * share one timeline, which also means it survives between test cases. Every
 * case here starts from an empty ring and logging switched off.
 */
function resetDebugState(): void {
  delete (globalThis as unknown as Record<string, unknown>)[STATE_GLOBAL];
}

/* Records are kept even while logging is off, so these read the ring. */
function codes(): Array<string> {
  return getDebugRecords().map((record: DebugRecord): string => {
    return record.code;
  });
}

function recordFor(code: string): DebugRecord | undefined {
  return getDebugRecords().find((record: DebugRecord): boolean => {
    return record.code === code;
  });
}

function detailOf(code: string): Record<string, unknown> {
  return (recordFor(code)?.detail || {}) as Record<string, unknown>;
}

function countOf(code: string): number {
  return codes().filter((candidate: string): boolean => {
    return candidate === code;
  }).length;
}

/*
 * The non-terminal upload path awaits compression before it calls fetch, so
 * anything that asserts on what the transport reported back has to let the
 * microtask queue drain first.
 */
async function flushUploads(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

function setVisibility(state: string): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): string => {
      return state;
    },
  });
}

/*
 * The terminal flush path. stop() deliberately discards the transport queue,
 * so hiding the page is the only way to make the recorder seal a chunk.
 */
function sealByHidingThePage(): void {
  setVisibility("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
}

interface ConsoleSpies {
  info: jest.Mock;
  warn: jest.Mock;
}

/*
 * Mocked rather than merely observed: with diagnostics switched on the
 * recorder writes a line per decision, and a test suite is not a customer's
 * console either.
 */
function spyOnConsole(): ConsoleSpies {
  const spies: ConsoleSpies = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  jest
    .spyOn(console, "info")
    .mockImplementation((...args: Array<unknown>): void => {
      spies.info(...args);
    });

  jest
    .spyOn(console, "warn")
    .mockImplementation((...args: Array<unknown>): void => {
      spies.warn(...args);
    });

  return spies;
}

function allConsoleText(spies: ConsoleSpies): string {
  return [...spies.info.mock.calls, ...spies.warn.mock.calls]
    .map((call: Array<unknown>): string => {
      return call
        .map((argument: unknown): string => {
          return typeof argument === "string"
            ? argument
            : JSON.stringify(argument);
        })
        .join(" ");
    })
    .join("\n");
}

describe("Recorder diagnostics", (): void => {
  let fetchMock: jest.Mock;
  let spies: ConsoleSpies;
  let recorder: Recorder | null = null;

  beforeEach((): void => {
    resetDebugState();

    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.innerHTML = "<div id='app'><p>content</p></div>";
    setVisibility("visible");

    /*
     * CompressionStream is removed so the upload path is short enough to
     * assert on within one macrotask. The gzip branch has its own coverage in
     * Transport.test.ts.
     */
    delete (globalThis as unknown as Record<string, unknown>)[
      "CompressionStream"
    ];

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

    (globalThis as unknown as Record<string, unknown>)["fetch"] = fetchMock;
    (window as unknown as Record<string, unknown>)["fetch"] = fetchMock;

    spies = spyOnConsole();
  });

  afterEach((): void => {
    if (recorder) {
      recorder.stop();
      recorder = null;
    }

    jest.restoreAllMocks();
    resetDebugState();
  });

  const startRecorder: (
    overrides?: Partial<SessionReplayConfigResponse>,
  ) => Recorder = (
    overrides?: Partial<SessionReplayConfigResponse>,
  ): Recorder => {
    const instance: Recorder = new Recorder({
      initOptions: INIT_OPTIONS,
      config: { ...baseConfig(), ...overrides },
    });

    instance.start();
    recorder = instance;

    return instance;
  };

  describe("startup", (): void => {
    /*
     * The hardest no-op in the package to diagnose from outside.
     *
     * In Always mode the sample percentage is the only reachable trigger, so
     * an unsampled session never starts rrweb at all: no listener is
     * installed, no event is buffered, no chunk is built and no request is
     * made. From the page that is byte-for-byte identical to a script tag
     * with the wrong token, a 404ing config endpoint, or a bundle that never
     * parsed - and because sampling is a pure function of the session id, it
     * is not bad luck the customer can reload their way out of either. This
     * record is the only thing that tells them which of those it was.
     */
    it("says so when the sample percentage excluded the session entirely", (): void => {
      const documentSpy: jest.SpyInstance = jest.spyOn(
        document,
        "addEventListener",
      );
      const windowSpy: jest.SpyInstance = jest.spyOn(
        window,
        "addEventListener",
      );

      const instance: Recorder = startRecorder({
        captureTrigger: SessionReplayCaptureTrigger.Always,
        samplePercentage: 0,
      });

      expect(codes()).toContain("not-sampled");
      expect(detailOf("not-sampled")["samplePercentage"]).toBe(0);
      expect(detailOf("not-sampled")["sessionId"]).toBe(
        instance.getSessionId(),
      );

      /*
       * rrweb attaches its mouse, scroll and input observers to the document
       * the moment record() is called, and the recorder's own
       * visibilitychange/pagehide/focusin listeners go on immediately after
       * the sampling gate. Zero registrations is therefore proof that start()
       * bailed before either happened rather than merely proof that nothing
       * uploaded.
       */
      expect(documentSpy.mock.calls.length).toBe(0);
      expect(windowSpy.mock.calls.length).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();

      /*
       * The same probe against a session the sampler DID select, so the
       * assertion above is a signal rather than a listener spy that never
       * fires in jsdom for some unrelated reason.
       */
      startRecorder({
        captureTrigger: SessionReplayCaptureTrigger.Always,
        samplePercentage: 100,
      });

      expect(documentSpy.mock.calls.length).toBeGreaterThan(0);
    });

    /*
     * THE line that answers "I see no requests in my Network tab".
     *
     * Under the default policy - OnErrorOrFrustration with a 0% sample - a
     * perfectly healthy recorder makes exactly one request per page load (the
     * config fetch) and posts nothing unless something goes wrong. That is
     * the entire design, and it is the single most common report filed
     * against a recorder that is behaving exactly as intended, so the message
     * has to name the escape hatch rather than merely say "recording".
     */
    it("explains that the default policy uploads nothing until a trigger fires", (): void => {
      const instance: Recorder = startRecorder();

      const record: DebugRecord | undefined = recordFor("recording");

      expect(record).toBeDefined();
      expect(record?.message).toContain("captureSession()");
      expect(record?.message).toContain("Nothing uploads until a trigger");

      const detail: Record<string, unknown> = detailOf("recording");

      expect(detail["captureTrigger"]).toBe(
        SessionReplayCaptureTrigger.OnErrorOrFrustration,
      );
      expect(detail["samplePercentage"]).toBe(0);
      expect(detail["isSampled"]).toBe(false);
      expect(detail["consentMode"]).toBe(SessionReplayConsentMode.NotRequired);
      expect(detail["consentState"]).toBe("NotRequired");
      expect(detail["uploading"]).toBe(false);
      expect(instance.isUploading()).toBe(false);
    });

    /* The same record, on the other side of the branch. */
    it("reports uploading when the session was sampled in", (): void => {
      startRecorder({ samplePercentage: 100 });

      expect(detailOf("recording")["isSampled"]).toBe(true);
      expect(detailOf("recording")["uploading"]).toBe(true);
      expect(recordFor("recording")?.message).toContain("uploading");
    });
  });

  describe("triggers and uploading", (): void => {
    /*
     * The first reason wins, and the record has to agree with it. A session
     * that rage-clicked and then threw is more usefully labelled by what
     * happened first, so a second "trigger" line - or one carrying the later
     * reason - would make the timeline disagree with the envelopes the server
     * actually received.
     */
    it("records the first trigger reason once, however many triggers fire", (): void => {
      const instance: Recorder = startRecorder();

      instance.trigger(SessionReplayTriggerReason.Frustration);
      instance.trigger(SessionReplayTriggerReason.Error);
      instance.trigger(SessionReplayTriggerReason.Manual);

      expect(countOf("trigger")).toBe(1);
      expect(detailOf("trigger")["reason"]).toBe(
        SessionReplayTriggerReason.Frustration,
      );
      expect(detailOf("trigger")["sessionId"]).toBe(instance.getSessionId());
    });

    it("records that uploading started when consent is not required", (): void => {
      const instance: Recorder = startRecorder({
        consentMode: SessionReplayConsentMode.NotRequired,
      });

      instance.trigger(SessionReplayTriggerReason.Error);

      expect(codes()).toContain("upload-started");
      expect(detailOf("upload-started")["triggerReason"]).toBe(
        SessionReplayTriggerReason.Error,
      );
      expect(detailOf("upload-started")["sessionId"]).toBe(
        instance.getSessionId(),
      );
      expect(instance.isUploading()).toBe(true);
    });

    /*
     * A page that mounts the recorder under RequireExplicit and never wires
     * grantConsent() into its cookie banner records forever and uploads
     * nothing. That is correct behaviour and was completely invisible: the
     * trigger fires, the buffer keeps filling, and the network stays silent.
     */
    it("names consent when a trigger fired but nobody ever granted it", async (): Promise<void> => {
      const instance: Recorder = startRecorder({
        consentMode: SessionReplayConsentMode.RequireExplicit,
      });

      instance.trigger(SessionReplayTriggerReason.Manual);

      await flushUploads();

      expect(codes()).toContain("upload-blocked-consent");
      expect(codes()).not.toContain("upload-started");

      const detail: Record<string, unknown> = detailOf(
        "upload-blocked-consent",
      );

      expect(detail["consentMode"]).toBe(
        SessionReplayConsentMode.RequireExplicit,
      );
      expect(detail["consentState"]).toBe("Unknown");
      expect(detail["isRevoked"]).toBe(false);

      /* The point of the record: nothing left the device. */
      expect(instance.isUploading()).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    /*
     * A chunk that was fully built and then thrown away.
     *
     * It is not re-queued, not counted against droppedEvents, and the chunker
     * has already reset its per-chunk signals - so from the server's side
     * this is simply a gap in the recording with nothing to explain it. The
     * guard exists for the window between "consent said yes" and "the chunk
     * closed", which is why the revoke here is applied to the live Consent
     * object: the public revokeConsent() stops the recorder outright, so it
     * can never produce the very race the branch defends against.
     */
    it("records a chunk discarded because consent no longer allows uploading", async (): Promise<void> => {
      const instance: Recorder = startRecorder({
        consentMode: SessionReplayConsentMode.RequireExplicit,
      });

      instance.trigger(SessionReplayTriggerReason.Manual);
      instance.grantConsent();

      await flushUploads();

      expect(codes()).toContain("upload-started");

      (
        instance as unknown as { consent: { revoke: () => void } }
      ).consent.revoke();

      document.body.appendChild(document.createElement("span"));

      await flushUploads();

      const postsBeforeTheDiscard: number = fetchMock.mock.calls.length;

      sealByHidingThePage();

      expect(codes()).toContain("chunk-discarded-consent");
      expect(detailOf("chunk-discarded-consent")["consentState"]).toBe(
        "Unknown",
      );

      /*
       * A real chunk with real events in it, not the empty final chunk the
       * chunker emits when it has nothing to say - and it went nowhere.
       */
      expect(detailOf("chunk-discarded-consent")["eventCount"]).toBeGreaterThan(
        0,
      );
      expect(fetchMock.mock.calls.length).toBe(postsBeforeTheDiscard);
    });
  });

  describe("stopping", (): void => {
    /*
     * The closing line of the timeline, and the only place the three loss
     * counters are ever reported. A support ticket that opens with "the
     * replay is missing the last minute" is answered by droppedEvents,
     * droppedChunks and flushFailures, none of which are on the envelope.
     */
    it("reports the loss counters when the recorder stops", (): void => {
      const instance: Recorder = startRecorder();

      instance.stop();

      const detail: Record<string, unknown> = detailOf("recorder-stopped");

      expect(codes()).toContain("recorder-stopped");
      expect(detail["sessionId"]).toBe(instance.getSessionId());
      expect(detail["uploaded"]).toBe(false);
      expect(detail["droppedEvents"]).toBe(0);
      expect(detail["droppedChunks"]).toBe(0);
      expect(detail["flushFailures"]).toBe(0);
    });

    /*
     * A wrong ingestion token used to shut the whole recorder down with
     * nothing printed anywhere at all: the transport tripped its breaker, the
     * recorder stopped, and the page went quiet mid-session. The reason is
     * what distinguishes "fix your token" (401) from "fix your host" (404).
     */
    it("names the transport failure that stopped the recorder for good", async (): Promise<void> => {
      fetchMock.mockResolvedValue({
        status: 401,
        headers: {
          get: (): string | null => {
            return null;
          },
        },
        text: async (): Promise<string> => {
          return "";
        },
      });

      const instance: Recorder = startRecorder({ samplePercentage: 100 });

      await flushUploads();

      expect(codes()).toContain("recorder-stopped-transport");
      expect(detailOf("recorder-stopped-transport")["reason"]).toBe("http-401");

      /* The stop is real, not just announced. */
      expect(codes()).toContain("recorder-stopped");
      expect(instance.isUploading()).toBe(true);
    });

    /*
     * The kill switch. Stopping inside one chunk window rather than waiting
     * out the config cache is the whole point of the directive, and the
     * server's reason is the only thing that tells the customer it was THEIR
     * dashboard toggle rather than a bug on their site.
     */
    it("attributes a server-ordered stop to the server, with its reason", async (): Promise<void> => {
      fetchMock.mockResolvedValue({
        status: 204,
        headers: {
          get: (): string | null => {
            return null;
          },
        },
        text: async (): Promise<string> => {
          return '{"directive":"stop","reason":"project-disabled"}';
        },
      });

      startRecorder({ samplePercentage: 100 });

      await flushUploads();

      expect(codes()).toContain("recorder-stopped-by-server");
      expect(detailOf("recorder-stopped-by-server")["reason"]).toBe(
        "project-disabled",
      );
      expect(codes()).toContain("recorder-stopped");
    });
  });

  /*
   * The property that matters more than any individual line in this file.
   *
   * Diagnostics have no masking of their own, they are reachable from
   * untyped JavaScript on a global, and when they are switched on they print
   * into the end user's console on somebody else's website. If a single
   * record could carry a form value or a text node, this channel would be a
   * second, unmasked egress path for exactly the data the rest of the
   * package exists to protect - and it would leak precisely on the pages
   * where somebody turned debugging on to look at a problem.
   */
  describe("page content", (): void => {
    it("never carries page content into a record or the console", async (): Promise<void> => {
      const secret: string = "zzq-shibboleth-4417-do-not-log";

      document.body.innerHTML = `<div id="app"><p>${secret}</p><input id="card" name="card" value="${secret}" /></div>`;

      const field: HTMLInputElement | null = document.querySelector("#card");

      if (field) {
        field.value = secret;
      }

      /* On, before anything is recorded, so the console sees every line. */
      setEnabled(true, "test");

      const instance: Recorder = startRecorder({ samplePercentage: 100 });

      instance.trigger(SessionReplayTriggerReason.Error);

      document.body.appendChild(document.createTextNode(secret));

      if (field) {
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }

      await flushUploads();

      sealByHidingThePage();

      instance.stop();

      /*
       * Guards against the whole assertion passing because nothing was
       * recorded or printed in the first place.
       */
      expect(getDebugRecords().length).toBeGreaterThan(3);
      expect(allConsoleText(spies)).toContain("[OneUptime Session Replay]");

      expect(JSON.stringify(getDebugRecords())).not.toContain(secret);
      expect(allConsoleText(spies)).not.toContain(secret);
    });
  });
});
