import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { DEBUG_STORAGE_KEY, DebugRecord, getDebugRecords } from "../src/Debug";

/*
 * What the loader stub says about itself.
 *
 * Every gate in the stub fails closed and silently: no init options, a
 * privacy signal, a 401, `enabled: false`, a directive to stand down, a
 * blocked script tag. All six produce the identical observable outcome on a
 * customer's page - no recording, and usually no request either - so the
 * diagnostics timeline is the only thing that can tell them apart. These
 * tests pin the `code` on each one, because a support ticket quotes the code
 * and the troubleshooting docs are indexed by it; renaming one silently is
 * the same as deleting the diagnostic.
 *
 * Assertions read the RECORD RING rather than the console on purpose.
 * Records are kept whether or not logging is switched on, which is what lets
 * a support engineer ask for the timeline from a page nobody had
 * instrumented - and asserting on console output instead would quietly stop
 * covering the off-by-default case, which is every real page.
 */

const STATE_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY_DEBUG__";

const CONFIG_URL: string =
  "https://oneuptime.com/telemetry/session-replay/v1/config";

const ARTIFACT_URL: string =
  "https://oneuptime.com/telemetry/session-replay/v11.7.3/recorder.js";

/*
 * Distinctive enough that a substring search for it is meaningful. The
 * ingestion key travels in a request header and must never reach a channel
 * that gets pasted into a support ticket.
 */
const SECRET_TOKEN: string = "tok-must-never-be-logged-91af";
const SECRET_USER_REF: string = "user-ref-must-never-be-logged-91af";

const CONFIG_BODY: Record<string, unknown> = {
  enabled: true,
  recorderVersion: "11.7.3",
  maskingMode: SessionReplayMaskingMode.MaskAllText,
  consentMode: "NotRequired",
  captureTrigger: "OnErrorOrFrustration",
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
  recorderIntegrity: "sha384-testhash",
};

type GlobalRecord = Record<string, unknown>;

function globalRecord(): GlobalRecord {
  return globalThis as unknown as GlobalRecord;
}

/*
 * The timeline lives on a global so the stub and the artifact share one
 * ring, which also means it survives between test cases. Every case starts
 * from an empty one or it would be reading the previous case's decisions.
 */
function resetDebugState(): void {
  delete globalRecord()[STATE_GLOBAL];
}

function codes(): Array<string> {
  return getDebugRecords().map((record: DebugRecord): string => {
    return record.code;
  });
}

function detailOf(code: string): Record<string, unknown> {
  const record: DebugRecord | undefined = getDebugRecords().find(
    (candidate: DebugRecord): boolean => {
      return candidate.code === code;
    },
  );

  return (record?.detail || {}) as Record<string, unknown>;
}

function consoleText(spy: jest.SpyInstance): string {
  return spy.mock.calls
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

describe("Loader diagnostics", (): void => {
  let fetchMock: jest.Mock;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const setNavigatorSignal: (value: boolean) => void = (
    value: boolean,
  ): void => {
    Object.defineProperty(window.navigator, "globalPrivacyControl", {
      configurable: true,
      value: value,
    });
  };

  const setConfigResponse: (body: Record<string, unknown> | null) => void = (
    body: Record<string, unknown> | null,
  ): void => {
    fetchMock.mockResolvedValue({
      ok: body !== null,
      status: body === null ? 404 : 200,
      json: async (): Promise<unknown> => {
        return body;
      },
    });
  };

  /* A refusal with a status the stub is expected to name back. */
  const setConfigRefusal: (status: number) => void = (status: number): void => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: status,
      json: async (): Promise<unknown> => {
        return null;
      },
    });
  };

  const tick: () => Promise<void> = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  };

  /*
   * The stub is a side effect, not a library: importing it runs it. Modules
   * are reset between cases so each one gets a fresh execution.
   */
  const runLoader: () => Promise<void> = async (): Promise<void> => {
    jest.resetModules();

    await import("../src/Loader");

    await tick();
    await tick();
  };

  const injectedScript: () => HTMLScriptElement | null =
    (): HTMLScriptElement | null => {
      return document.querySelector<HTMLScriptElement>(
        'script[src*="/telemetry/session-replay/"]',
      );
    };

  const setInitOptions: (options: Record<string, unknown>) => void = (
    options: Record<string, unknown>,
  ): void => {
    globalRecord()["__ONEUPTIME_SESSION_REPLAY__"] = options;
  };

  beforeEach((): void => {
    resetDebugState();

    document.head.innerHTML = "";
    document.body.innerHTML = "";

    /*
     * Both storages are ambient debug switches. A leftover key from another
     * suite would switch logging on and make the "silent by default" case
     * pass for the wrong reason.
     */
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* jsdom always has both; a hostile environment is Debug's problem. */
    }

    setNavigatorSignal(false);

    setInitOptions({
      host: "https://oneuptime.com",
      token: SECRET_TOKEN,
      appIdentifier: "app-1",
    });

    globalRecord()["OneUptimeReplay"] = {
      bootstrap: (): void => {
        /* The artifact is already present unless a case removes it. */
      },
    };

    fetchMock = jest.fn();
    globalRecord()["fetch"] = fetchMock;

    setConfigResponse(CONFIG_BODY);

    infoSpy = jest.spyOn(console, "info").mockImplementation((): void => {
      /* Swallowed so a failing case does not print into the test output. */
    });

    warnSpy = jest.spyOn(console, "warn").mockImplementation((): void => {
      /* Swallowed; asserted through the spy instead. */
    });
  });

  afterEach((): void => {
    delete globalRecord()["__ONEUPTIME_SESSION_REPLAY__"];
    delete globalRecord()["OneUptimeReplay"];

    jest.restoreAllMocks();
    resetDebugState();
  });

  /*
   * "The stub never ran" - a CSP that blocked it, a tag that is not on the
   * page, a bundler that dropped it - and "the stub ran and decided not to
   * record" look identical from the network tab and have nothing in common.
   * This record is the only thing that separates them, so it has to be
   * emitted before anything the stub might stand down over.
   */
  it("records that it ran before it reads anything from the page", async (): Promise<void> => {
    await runLoader();

    expect(codes()[0]).toBe("loader-start");
    expect(detailOf("loader-start")["diagnostics"]).toBe("off");
  });

  /*
   * Nothing on the page to read at all: no init global and no
   * script[data-oneuptime-token]. Distinct from a snippet that is present but
   * incomplete, which Config reports field by field - here the marker
   * attribute is misspelled, the snippet went into a different document, or a
   * tag manager dropped it.
   *
   * Both records matter. loader-start is the only evidence the stub ever
   * executed, and init-options-missing is what keeps getDiagnostics() a
   * complete account rather than a timeline that stops without saying why.
   */
  it("records that it ran and that it found nothing to read", async (): Promise<void> => {
    delete globalRecord()["__ONEUPTIME_SESSION_REPLAY__"];

    await runLoader();

    expect(codes()).toEqual(["loader-start", "init-options-missing"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("init options", (): void => {
    /*
     * host and appIdentifier are the two values a wrong install gets wrong,
     * and neither is a secret. The token is, and so is the customer's own
     * user reference - this timeline is printed to an end user's console and
     * pasted into support tickets, so it is an egress path like any other.
     */
    it("names the host and app identifier it read, and never the token", async (): Promise<void> => {
      setInitOptions({
        host: "https://oneuptime.com",
        token: SECRET_TOKEN,
        appIdentifier: "app-1",
        userRef: SECRET_USER_REF,
      });

      await runLoader();

      expect(detailOf("init-options-read")).toEqual({
        source: "init-global",
        host: "https://oneuptime.com",
        appIdentifier: "app-1",
        respectDoNotTrack: true,
      });

      const timeline: string = JSON.stringify(getDebugRecords());

      expect(timeline).not.toContain(SECRET_TOKEN);
      expect(timeline).not.toContain(SECRET_USER_REF);
    });

    /*
     * WHICH field is missing, not just that one is. The unconditional
     * console.warn below can only say "something is wrong with the snippet",
     * and "you forgot the token" and "the host could not be derived from the
     * script src" are different bugs with fixes in different places.
     */
    it("names a missing token", async (): Promise<void> => {
      setInitOptions({
        host: "https://oneuptime.com",
        appIdentifier: "app-1",
      });

      await runLoader();

      expect(codes()).toContain("init-options-incomplete");
      expect(detailOf("init-options-incomplete")).toEqual({
        source: "init-global",
        hasHost: true,
        hasToken: false,
        hasAppIdentifier: true,
      });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    /*
     * `source` matters as much as the flags. The init global is only the
     * FIRST of two sources the recorder tries, so a page that sets
     * `window.__ONEUPTIME_SESSION_REPLAY__ = { debug: true }` purely to turn
     * diagnostics on reaches this warning and then records perfectly well
     * from its script tag. Naming the source is what keeps that from reading
     * as a fault - see the case below.
     */
    it("names a missing app identifier", async (): Promise<void> => {
      setInitOptions({
        host: "https://oneuptime.com",
        token: SECRET_TOKEN,
      });

      await runLoader();

      expect(detailOf("init-options-incomplete")).toEqual({
        source: "init-global",
        hasHost: true,
        hasToken: true,
        hasAppIdentifier: false,
      });
    });

    /*
     * The host normally defaults to wherever the script itself was served
     * from, so an inline tag - a customer who pasted the attributes onto a
     * <script> with no src, or a bundler that inlined it - has no host to
     * derive and nothing to say so. hasHost false is what points at the
     * missing src rather than at the attributes, which are all present here.
     */
    it("reports the host as missing when it cannot be derived from the script src", async (): Promise<void> => {
      delete globalRecord()["__ONEUPTIME_SESSION_REPLAY__"];

      document.head.innerHTML =
        '<script data-oneuptime-token="t" data-oneuptime-app-identifier="a"></script>';

      await runLoader();

      expect(detailOf("init-options-incomplete")).toEqual({
        source: "script-tag",
        hasHost: false,
        hasToken: true,
        hasAppIdentifier: true,
      });
    });

    /*
     * The documented way to turn diagnostics on for a tag-configured install
     * is a global carrying nothing but `debug: true`. That global does not
     * normalise, so it is skipped and the script tag answers instead - and
     * the recorder must not report the skip as a failure. Telling the person
     * who just enabled diagnostics that nothing will be recorded, moments
     * before recording, is worse than saying nothing at all.
     */
    it("does not call a skipped init source a failure", async (): Promise<void> => {
      (globalRecord() as Record<string, unknown>)[
        "__ONEUPTIME_SESSION_REPLAY__"
      ] = { debug: true };

      document.head.innerHTML =
        '<script src="https://oneuptime.com/telemetry/session-replay/v1/recorder.js" data-oneuptime-token="t" data-oneuptime-app-identifier="app-1"></script>';

      await runLoader();

      /* The skip is reported, and named as a skip on a named source. */
      expect(detailOf("init-options-incomplete")["source"]).toBe("init-global");

      const record: DebugRecord | undefined = getDebugRecords().find(
        (r: DebugRecord): boolean => {
          return r.code === "init-options-incomplete";
        },
      );

      expect(record?.message).not.toContain("Nothing will be recorded");

      /* And the script tag went on to answer, so the recorder started. */
      expect(detailOf("init-options-read")["source"]).toBe("script-tag");
      expect(codes()).toContain("config-accepted");
      expect(fetchMock).toHaveBeenCalled();
    });

    /*
     * The one thing the recorder prints unasked. A misconfigured snippet used
     * to produce total silence, which is indistinguishable from "replay is
     * off for this app" and sent people looking in entirely the wrong place.
     * It now also has to name the localStorage switch, because everything
     * else this file asserts is invisible until somebody turns it on.
     */
    it("warns on the console about a missing snippet and says how to get the rest", async (): Promise<void> => {
      delete globalRecord()["__ONEUPTIME_SESSION_REPLAY__"];

      await runLoader();

      expect(warnSpy).toHaveBeenCalledTimes(1);

      const text: string = consoleText(warnSpy);

      expect(text).toContain("data-oneuptime-token");
      expect(text).toContain("data-oneuptime-app-identifier");
      expect(text).toContain(DEBUG_STORAGE_KEY);
    });
  });

  /*
   * The signal is checked BEFORE the config request. A user who has asked
   * not to be tracked must not have a request made about them just to find
   * out whether we would have recorded them - so the record for this gate
   * and the absence of the fetch are one assertion, not two.
   */
  it("records the privacy signal without making a request about the user", async (): Promise<void> => {
    setNavigatorSignal(true);

    await runLoader();

    expect(codes()).toEqual([
      "loader-start",
      "init-options-read",
      "privacy-signal",
    ]);

    /*
     * Which of the two DNT checks fired. The stub reads the signal once
     * before the config request and again after it with the server's own
     * setting, and telling them apart is the difference between "this
     * browser sends the signal" and "this browser sends it and the
     * deployment honours it".
     */
    expect(detailOf("privacy-signal")["stage"]).toBe("before-config-fetch");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("the config round trip", (): void => {
    /*
     * A 401 is a key in Project Settings, a 404 is usually an nginx route
     * that never reaches the telemetry app. Both come back as "nothing
     * recorded, no error", and the status is the entire diagnosis - so it
     * is carried verbatim rather than collapsed into "the request failed".
     */
    it("names the status when the config endpoint refuses the request", async (): Promise<void> => {
      for (const status of [401, 404]) {
        resetDebugState();
        setConfigRefusal(status);

        await runLoader();

        expect(codes()).toContain("config-fetch-start");
        expect(codes()).toContain("config-fetch-rejected");

        /*
         * The attempt has to be visible before its outcome, or a request
         * that was never made and one that was refused read the same.
         */
        expect(codes().indexOf("config-fetch-start")).toBeLessThan(
          codes().indexOf("config-fetch-rejected"),
        );

        expect(detailOf("config-fetch-rejected")).toEqual({
          url: CONFIG_URL,
          status: status,
        });
      }
    });

    /*
     * A rejected fetch is a network-layer failure the page cannot see either
     * - DNS, TLS, offline, an ad blocker, or a connect-src that does not list
     * the ingest origin. There is no status to report, which is exactly why
     * it needs its own code rather than sharing the refusal one.
     */
    it("distinguishes a request that never completed from one that was refused", async (): Promise<void> => {
      fetchMock.mockRejectedValue(new Error("blocked by connect-src"));

      await runLoader();

      expect(codes()).toContain("config-fetch-failed");
      expect(codes()).not.toContain("config-fetch-rejected");
      expect(detailOf("config-fetch-failed")["url"]).toBe(CONFIG_URL);
    });

    /*
     * "Replay is on in the dashboard but nothing happens" is the single most
     * common report, and several unrelated causes all answer `enabled:
     * false`. recorder-not-built in particular is a deployment that never ran
     * the recorder build - no amount of dashboard configuration fixes it, so
     * a customer left guessing will spend the afternoon on the wrong thing.
     */
    it("passes the server's reason for being off straight through", async (): Promise<void> => {
      setConfigResponse({
        ...CONFIG_BODY,
        enabled: false,
        disabledReason: "recorder-not-built",
      });

      await runLoader();

      expect(detailOf("config-disabled")["disabledReason"]).toBe(
        "recorder-not-built",
      );
    });

    /*
     * An older server does not send disabledReason at all. The record still
     * has to say so explicitly: a missing key reads as "the recorder did not
     * look", and would send someone hunting for a bug in the stub instead of
     * upgrading the deployment that owns the answer.
     */
    it("says the reason was not reported when the server omits one", async (): Promise<void> => {
      setConfigResponse({ ...CONFIG_BODY, enabled: false });

      await runLoader();

      expect(detailOf("config-disabled")["disabledReason"]).toBe(
        "not-reported",
      );
    });

    /*
     * The version is interpolated into an artifact URL path, so a traversing
     * or unpublished value is refused outright. Refusing silently is the same
     * dead end as every other gate here, and the offending value is the whole
     * diagnosis - it points at the server or at whatever rewrote its reply.
     */
    it("names the version it refused to build a URL from", async (): Promise<void> => {
      for (const version of ["../../../admin", "latest"]) {
        resetDebugState();
        setConfigResponse({ ...CONFIG_BODY, recorderVersion: version });

        await runLoader();

        expect(detailOf("config-recorder-version-invalid")).toEqual({
          recorderVersion: version,
        });

        expect(codes()).not.toContain("config-accepted");
      }
    });

    /*
     * The policy line, and the one that explains "there are no requests in
     * the network tab": OnErrorOrFrustration with samplePercentage 0 records
     * into memory and uploads nothing until something goes wrong. That is
     * working as designed and it is indistinguishable from broken, so all
     * four decisions are carried together - any one of them alone is enough
     * to misread the other three.
     */
    it("carries the policy the recorder will now run under", async (): Promise<void> => {
      await runLoader();

      const detail: Record<string, unknown> = detailOf("config-accepted");

      expect(detail["captureTrigger"]).toBe(
        SessionReplayCaptureTrigger.OnErrorOrFrustration,
      );
      expect(detail["samplePercentage"]).toBe(0);
      expect(detail["consentMode"]).toBe(SessionReplayConsentMode.NotRequired);
      expect(detail["maskingMode"]).toBe(SessionReplayMaskingMode.MaskAllText);
    });
  });

  describe("the artifact", (): void => {
    beforeEach((): void => {
      /*
       * No artifact on the page, so the stub has to inject one. With the
       * bootstrap global present it short-circuits and none of the injection
       * diagnostics below are reachable at all.
       */
      delete globalRecord()["OneUptimeReplay"];
    });

    /*
     * The kill switch has to stop RECORDING, not merely ingest. If the
     * artifact were still fetched, live browsers would go on recording into
     * a buffer for the rest of the page's life after the switch was thrown -
     * so the absence of the script tag is as much the assertion as the code.
     */
    it("records the stand-down and injects nothing when told to stop", async (): Promise<void> => {
      setConfigResponse({ ...CONFIG_BODY, directive: "stop" });

      await runLoader();

      expect(codes()).toContain("directive-stop");
      expect(codes()).not.toContain("artifact-requested");
      expect(injectedScript()).toBeNull();
    });

    /*
     * The last record before the stub hands over. Everything after this point
     * belongs to a bundle that may never load, so a timeline that ends here
     * says "the stub did its whole job" rather than "the stub gave up".
     */
    it("records the artifact it asked for and whether it pinned a hash", async (): Promise<void> => {
      await runLoader();

      expect(detailOf("artifact-requested")).toEqual({
        url: ARTIFACT_URL,
        hasIntegrity: true,
      });
    });

    it("says when no hash was published to pin", async (): Promise<void> => {
      const body: Record<string, unknown> = { ...CONFIG_BODY };
      delete body["recorderIntegrity"];

      setConfigResponse(body);

      await runLoader();

      expect(detailOf("artifact-requested")["hasIntegrity"]).toBe(false);
    });

    /*
     * Usually a customer CSP that does not list our origin in script-src,
     * which fails silently from the page's point of view. Server telemetry
     * cannot see a script that never loaded, so this record is one of only
     * two diagnostics that exist for it - and hasIntegrity rides along
     * because an SRI mismatch fails through exactly the same handler.
     */
    it("records a script that never loaded, which the server can never see", async (): Promise<void> => {
      await runLoader();

      const script: HTMLScriptElement | null = injectedScript();

      expect(script).not.toBeNull();

      if (script && script.onerror) {
        script.onerror(new Event("error"));
      }

      expect(detailOf("artifact-load-failed")).toEqual({
        url: ARTIFACT_URL,
        hasIntegrity: true,
      });
    });

    /*
     * The script loaded and published nothing. That is a broken or
     * substituted artifact rather than a blocked one - a proxy serving an
     * HTML error page with a 200, or a build that shipped the wrong file -
     * and it needs its own code, because "loaded fine, recorded nothing" is
     * the least intuitive outcome the stub can produce.
     */
    it("records an artifact that loaded but published no API", async (): Promise<void> => {
      await runLoader();

      const script: HTMLScriptElement | null = injectedScript();

      if (script && script.onload) {
        script.onload(new Event("load"));
      }

      expect(detailOf("artifact-api-missing")["url"]).toBe(ARTIFACT_URL);
    });
  });

  /*
   * The rule the whole diagnostics design hangs on. This script runs in a
   * customer's END USERS' browsers, not the customer's own, so a recorder
   * that chatters is one a customer removes - and the timeline above is
   * still fully populated while the console stays clean.
   */
  it("prints nothing at all on a normal page with diagnostics off", async (): Promise<void> => {
    await runLoader();

    expect(codes()).toContain("config-accepted");

    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
