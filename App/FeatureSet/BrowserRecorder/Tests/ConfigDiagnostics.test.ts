import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import Config, { LoaderConfig, RecorderInitOptions } from "../src/Config";
import {
  DebugRecord,
  getDebugRecords,
  getDebugSource,
  isDebugEnabled,
} from "../src/Debug";

/*
 * What Config.ts says out loud when an install is wrong.
 *
 * Every failure this file covers is invisible by construction: a missing
 * data attribute, a 404 from the config endpoint, `enabled: false`, a
 * masking mode this build has never heard of. All four produce exactly the
 * same thing on the customer's page - no recording, no request, no error -
 * so the record each one leaves behind is the ONLY thing that tells
 * "replay is broken" apart from "replay is switched off". That makes these
 * records behaviour rather than logging, and they are tested as behaviour.
 *
 * Config is driven directly rather than through the loader on purpose: the
 * loader has its own reasons to stop early, and a diagnostic that only
 * appears on the loader's happy path is one nobody gets when they need it.
 */

const STATE_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY_DEBUG__";
const INIT_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY__";

type GlobalRecord = Record<string, unknown>;

function globalRecord(): GlobalRecord {
  return globalThis as unknown as GlobalRecord;
}

/*
 * Diagnostics state lives on a global so the loader stub and the artifact
 * share one timeline, which also means it survives between test cases.
 * Every case here starts from nothing, or the previous case's `setEnabled`
 * would make this one pass for the wrong reason.
 */
function resetDebugState(): void {
  delete globalRecord()[STATE_GLOBAL];
}

function recordsFor(code: string): Array<DebugRecord> {
  return getDebugRecords().filter((record: DebugRecord): boolean => {
    return record.code === code;
  });
}

function codes(): Array<string> {
  return getDebugRecords().map((record: DebugRecord): string => {
    return record.code;
  });
}

function detailOf(code: string): Record<string, unknown> {
  return (recordsFor(code)[0]?.detail || {}) as Record<string, unknown>;
}

function detailsOf(code: string): Array<Record<string, unknown>> {
  return recordsFor(code).map(
    (record: DebugRecord): Record<string, unknown> => {
      return (record.detail || {}) as Record<string, unknown>;
    },
  );
}

describe("Config diagnostics", (): void => {
  const validBody: Record<string, unknown> = {
    enabled: true,
    recorderVersion: "12.0.0",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentMode: SessionReplayConsentMode.RequireExplicit,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    samplePercentage: 0,
  };

  function bodyWith(extra: Record<string, unknown>): Record<string, unknown> {
    return { enabled: true, recorderVersion: "12.0.0", ...extra };
  }

  const options: RecorderInitOptions = {
    host: "https://oneuptime.com",
    token: "t",
    appIdentifier: "a",
  };

  beforeEach((): void => {
    resetDebugState();

    document.head.innerHTML = "";
    delete globalRecord()[INIT_GLOBAL];

    /*
     * The ambient switches Debug resolves on its own. Left set by another
     * case, any of them would turn logging on before Config ever ran and
     * make the "stays off" assertions meaningless.
     */
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* jsdom always has both. */
    }

    /*
     * Turning diagnostics on flushes the whole backlog to the console.
     * Silenced so a passing run stays readable; every assertion below reads
     * the records, which is what a support engineer actually gets handed.
     */
    jest.spyOn(console, "info").mockImplementation((): void => {
      /* silenced */
    });
    jest.spyOn(console, "warn").mockImplementation((): void => {
      /* silenced */
    });
  });

  afterEach((): void => {
    jest.restoreAllMocks();

    document.head.innerHTML = "";
    delete globalRecord()[INIT_GLOBAL];
    delete globalRecord()["fetch"];

    resetDebugState();
  });

  /*
   * The switch a customer can flip without a console: it goes on the same
   * script tag they already pasted. Debug.ts deliberately does NOT resolve
   * this one itself (a document-wide querySelector on every page load, for
   * a flag that is off on virtually all of them), so Config is the only
   * thing that can apply it.
   */
  describe("the page's own debug switch", (): void => {
    it("turns diagnostics on from the script tag attribute", (): void => {
      document.head.innerHTML =
        '<script data-oneuptime-host="https://oneuptime.com" data-oneuptime-token="t" data-oneuptime-app-identifier="a" data-oneuptime-debug="true"></script>';

      expect(Config.readInitOptions()).not.toBeNull();

      expect(isDebugEnabled()).toBe(true);
      expect(getDebugSource()).toBe("script-tag");
    });

    /*
     * The spellings somebody actually types into an HTML attribute.
     *
     * The attribute used to be compared against the literal string "true"
     * while the init global went through Debug's own resolver, which takes
     * "1", "yes" and "on" in any case - so data-oneuptime-debug="1" silently
     * did nothing while the equivalent global worked. On a switch whose whole
     * purpose is being reachable by somebody who cannot get to a console, one
     * that only works if you guess the right word is worse than none.
     */
    it("accepts the truthy spellings a person would type", (): void => {
      for (const value of ["1", "yes", "TRUE", "on", "True"]) {
        resetDebugState();

        document.head.innerHTML = `<script data-oneuptime-host="https://oneuptime.com" data-oneuptime-token="t" data-oneuptime-app-identifier="a" data-oneuptime-debug="${value}"></script>`;

        const read: RecorderInitOptions | null = Config.readInitOptions();

        expect(read?.debug).toBe(true);
        expect(isDebugEnabled()).toBe(true);
      }
    });

    /*
     * And stays off for everything else - a RUM script that starts printing
     * into end users' consoles because an attribute was left as a templating
     * placeholder is noise on somebody else's property.
     */
    it("leaves diagnostics off for a falsy or meaningless attribute value", (): void => {
      for (const value of ["false", "0", "off", "", "{{DEBUG}}"]) {
        resetDebugState();

        document.head.innerHTML = `<script data-oneuptime-host="https://oneuptime.com" data-oneuptime-token="t" data-oneuptime-app-identifier="a" data-oneuptime-debug="${value}"></script>`;

        const read: RecorderInitOptions | null = Config.readInitOptions();

        expect(read).not.toBeNull();
        expect("debug" in ((read || {}) as Record<string, unknown>)).toBe(
          false,
        );
        expect(isDebugEnabled()).toBe(false);
      }
    });

    /*
     * The other install shape. Debug.ts resolves this same global by itself
     * as "init-global" and Config applies it again through acceptOptions;
     * both agree, so only the outcome is asserted - which of the two won
     * the race is not a contract anyone depends on.
     */
    it("turns diagnostics on from the init global", (): void => {
      globalRecord()[INIT_GLOBAL] = {
        host: "https://oneuptime.com",
        token: "t",
        appIdentifier: "a",
        debug: true,
      };

      expect(Config.readInitOptions()).not.toBeNull();
      expect(isDebugEnabled()).toBe(true);
    });

    it("carries debug through into the options it returns", (): void => {
      globalRecord()[INIT_GLOBAL] = {
        host: "https://oneuptime.com",
        token: "t",
        appIdentifier: "a",
        debug: true,
      };

      expect(Config.readInitOptions()?.debug).toBe(true);
    });

    /*
     * Absent, not `debug: undefined`. exactOptionalPropertyTypes makes
     * those different types, and a present-but-undefined key would spread
     * into every `{ ...options }` downstream as an explicit "no" that
     * overwrites whatever the server or the storage switch decided.
     */
    it("leaves the debug key absent when the page did not ask for it", (): void => {
      globalRecord()[INIT_GLOBAL] = {
        host: "https://oneuptime.com",
        token: "t",
        appIdentifier: "a",
      };

      const read: RecorderInitOptions | null = Config.readInitOptions();

      expect(read).not.toBeNull();
      expect("debug" in ((read || {}) as Record<string, unknown>)).toBe(false);
    });

    /*
     * Which snippet the browser actually found, and what it made of it.
     * "the tag is on the page but the host came out wrong" and "the global
     * was set after the script ran" look identical from the outside.
     */
    it("reports which source the options came from", (): void => {
      document.head.innerHTML =
        '<script src="/proxy/recorder.js" data-oneuptime-token="t" data-oneuptime-app-identifier="app-42" data-oneuptime-respect-do-not-track="false"></script>';

      Config.readInitOptions();

      expect(detailOf("init-options-read")).toEqual({
        source: "script-tag",
        host: window.location.origin,
        appIdentifier: "app-42",
        respectDoNotTrack: false,
      });
    });

    it("reports the init global as the source when both could apply", (): void => {
      document.head.innerHTML =
        '<script data-oneuptime-host="https://tag.example.com" data-oneuptime-token="t" data-oneuptime-app-identifier="from-tag"></script>';

      globalRecord()[INIT_GLOBAL] = {
        host: "https://global.example.com",
        token: "t",
        appIdentifier: "from-global",
      };

      Config.readInitOptions();

      const detail: Record<string, unknown> = detailOf("init-options-read");

      expect(detail["source"]).toBe("init-global");
      expect(detail["appIdentifier"]).toBe("from-global");
    });

    /*
     * WHICH field is missing, not merely that one is. "the snippet is
     * incomplete" and "the host could not be derived from the script src"
     * are different bugs with different fixes, and the recorder's silence
     * is identical for both.
     */
    it("names the field a broken snippet is missing", (): void => {
      document.head.innerHTML =
        '<script data-oneuptime-token="t" data-oneuptime-app-identifier="a"></script>';

      expect(Config.readInitOptions()).toBeNull();

      expect(codes()).toEqual(["init-options-incomplete"]);
      expect(detailOf("init-options-incomplete")).toEqual({
        source: "script-tag",
        hasHost: false,
        hasToken: true,
        hasAppIdentifier: true,
      });
    });
  });

  describe("validateConfig", (): void => {
    /*
     * The only switch reachable by an operator who cannot touch the
     * customer's page, and the ordering is the whole point: it is applied
     * BEFORE the enabled gate, so a response that says "off" can still
     * explain itself. Applied afterwards, the one config body a customer
     * most needs explained would be the one that returns in silence.
     */
    it("lets a disabled server response still turn diagnostics on", (): void => {
      const config: LoaderConfig | null = Config.validateConfig({
        enabled: false,
        debug: true,
        disabledReason: "recorder-not-built",
      });

      expect(config).toBeNull();
      expect(isDebugEnabled()).toBe(true);
      expect(getDebugSource()).toBe("server-config");
      expect(codes()).toContain("config-disabled");
    });

    it("reports why the server says replay is off", (): void => {
      Config.validateConfig({
        enabled: false,
        disabledReason: "no-active-subscription",
      });

      expect(detailOf("config-disabled")).toEqual({
        disabledReason: "no-active-subscription",
      });
    });

    /*
     * An older server sends no reason at all. The record still has to be
     * distinguishable from one that reported an empty string, or a support
     * engineer reads "off, reason: nothing" as a server bug.
     */
    it("says so when the server gave no reason", (): void => {
      Config.validateConfig({ enabled: false });

      expect(detailOf("config-disabled")["disabledReason"]).toBe(
        "not-reported",
      );
    });

    /*
     * Usually a proxy, an SSO interstitial or an error page answering with
     * HTML where JSON was expected. Indistinguishable at the call site from
     * a server that is simply switched off.
     */
    it("reports a body that is not a JSON object", (): void => {
      for (const body of [null, "enabled", 7, undefined]) {
        resetDebugState();

        expect(Config.validateConfig(body)).toBeNull();
        expect(codes()).toEqual(["config-unparseable"]);
      }
    });

    it("reports a recorder version no artifact could be published under", (): void => {
      expect(
        Config.validateConfig(bodyWith({ recorderVersion: "../../../admin" })),
      ).toBeNull();

      expect(codes()).toEqual(["config-recorder-version-invalid"]);
      expect(detailOf("config-recorder-version-invalid")).toEqual({
        recorderVersion: "../../../admin",
      });
    });

    /*
     * A deployment that never ran the recorder build sends no version at
     * all, which is a different fix from a version that is merely
     * malformed - so the record must not report an empty string.
     */
    it("says the version is missing rather than blank", (): void => {
      expect(Config.validateConfig({ enabled: true })).toBeNull();

      expect(
        detailOf("config-recorder-version-invalid")["recorderVersion"],
      ).toBe("missing");
    });

    /*
     * The combination that explains nearly every "replay is on but there
     * are no requests in the network tab": OnErrorOrFrustration with a
     * sample percentage of 0 records into memory and uploads NOTHING until
     * something goes wrong. Working as designed, and indistinguishable
     * from broken without this line.
     */
    it("prints the policy it accepted", (): void => {
      Config.validateConfig(validBody);

      const detail: Record<string, unknown> = detailOf("config-accepted");

      expect(detail["captureTrigger"]).toBe(
        SessionReplayCaptureTrigger.OnErrorOrFrustration,
      );
      expect(detail["samplePercentage"]).toBe(0);
      expect(detail["consentMode"]).toBe(
        SessionReplayConsentMode.RequireExplicit,
      );
      expect(detail["maskingMode"]).toBe(SessionReplayMaskingMode.MaskAllText);
      expect(detail["recorderVersion"]).toBe("12.0.0");
    });
  });

  /*
   * A value this build does not recognise collapses to the STRICTEST
   * option rather than to the one the server meant. That is the right
   * default and a genuinely confusing one: a newer server, or a proxy
   * rewriting the body, leaves a customer looking at MaskAllText while the
   * dashboard shows something else entirely - and silently.
   */
  describe("unrecognised config values", (): void => {
    it("names the masking mode it refused and the one it used instead", (): void => {
      Config.validateConfig(bodyWith({ maskingMode: "MaskNothing" }));

      expect(recordsFor("config-value-unrecognised")).toHaveLength(1);
      expect(detailOf("config-value-unrecognised")).toEqual({
        field: "maskingMode",
        sent: "MaskNothing",
        using: SessionReplayMaskingMode.MaskAllText,
      });
    });

    it("names an unrecognised consent mode", (): void => {
      Config.validateConfig(bodyWith({ consentMode: "ImpliedByVisit" }));

      expect(detailOf("config-value-unrecognised")).toEqual({
        field: "consentMode",
        sent: "ImpliedByVisit",
        using: SessionReplayConsentMode.RequireExplicit,
      });
    });

    it("names an unrecognised capture trigger", (): void => {
      Config.validateConfig(bodyWith({ captureTrigger: "OnRageClickOnly" }));

      expect(detailOf("config-value-unrecognised")).toEqual({
        field: "captureTrigger",
        sent: "OnRageClickOnly",
        using: SessionReplayCaptureTrigger.OnErrorOrFrustration,
      });
    });

    /*
     * One record per field, not one for the body. Three quietly downgraded
     * policies is a different conversation from one, and a single summary
     * record would hide two of them.
     */
    it("warns once per field when several values are unknown", (): void => {
      Config.validateConfig(
        bodyWith({
          maskingMode: "MaskNothing",
          consentMode: "ImpliedByVisit",
          captureTrigger: "OnRageClickOnly",
        }),
      );

      expect(
        detailsOf("config-value-unrecognised").map(
          (detail: Record<string, unknown>): unknown => {
            return detail["field"];
          },
        ),
      ).toEqual(["maskingMode", "consentMode", "captureTrigger"]);
    });

    /*
     * A tampered or garbled body can send a number where an enum belongs.
     * The type is reported instead of the value so the record still says
     * something useful without stringifying whatever arrived.
     */
    it("reports the type when the value is not even a string", (): void => {
      Config.validateConfig(bodyWith({ maskingMode: 7 }));

      expect(detailOf("config-value-unrecognised")["sent"]).toBe("number");
    });

    /*
     * The noise floor. This warning has to mean something, and a recorder
     * that warns about every policy it correctly understood trains people
     * to scroll past the one time it matters.
     */
    it("stays quiet when every value is recognised", (): void => {
      for (const maskingMode of [
        SessionReplayMaskingMode.MaskAllText,
        SessionReplayMaskingMode.MaskInputsOnly,
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      ]) {
        resetDebugState();

        Config.validateConfig(
          bodyWith({
            maskingMode: maskingMode,
            consentMode: SessionReplayConsentMode.NotRequired,
            captureTrigger: SessionReplayCaptureTrigger.Always,
            samplePercentage: 100,
          }),
        );

        expect(codes()).toEqual(["config-accepted"]);
      }
    });

    /*
     * An absent field is an older server, not a downgrade, so it is not
     * a warning - but it is not silence either. The recorder filled in
     * the product default, and if the Dashboard was changed away from
     * that default the server is too old to say so; the record is what
     * tells a reader "the policy you see here came from the recorder,
     * not from your settings".
     */
    it("notes each field it defaulted, at info level, and warns about none", (): void => {
      Config.validateConfig(bodyWith({}));

      expect(recordsFor("config-value-unrecognised")).toHaveLength(0);
      expect(codes()[0]).toBe("config-accepted");
      expect(codes().slice(1)).toEqual([
        "config-field-defaulted",
        "config-field-defaulted",
        "config-field-defaulted",
        "config-field-defaulted",
      ]);
      expect(
        recordsFor("config-field-defaulted").every(
          (record: DebugRecord): boolean => {
            return record.level === "info";
          },
        ),
      ).toBe(true);
      expect(detailsOf("config-field-defaulted")).toEqual([
        {
          field: "maskingMode",
          using: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        },
        { field: "consentMode", using: SessionReplayConsentMode.NotRequired },
        {
          field: "captureTrigger",
          using: SessionReplayCaptureTrigger.Always,
        },
        { field: "samplePercentage", using: "100" },
      ]);
    });

    it("notes only the fields that were actually absent", (): void => {
      Config.validateConfig(
        bodyWith({
          maskingMode: SessionReplayMaskingMode.MaskAllText,
          samplePercentage: 25,
        }),
      );

      expect(
        detailsOf("config-field-defaulted").map(
          (detail: Record<string, unknown>): unknown => {
            return detail["field"];
          },
        ),
      ).toEqual(["consentMode", "captureTrigger"]);
    });

    /*
     * The policy line must print what the recorder will actually DO, and
     * for an older server that is the product default - not the strict
     * fallback the line used to show, which was the "record into memory,
     * upload nothing" combination nobody had configured.
     */
    it("prints the product defaults as the accepted policy for a minimal body", (): void => {
      Config.validateConfig(bodyWith({}));

      const detail: Record<string, unknown> = detailOf("config-accepted");

      expect(detail["captureTrigger"]).toBe(SessionReplayCaptureTrigger.Always);
      expect(detail["samplePercentage"]).toBe(100);
      expect(detail["consentMode"]).toBe(SessionReplayConsentMode.NotRequired);
      expect(detail["maskingMode"]).toBe(
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      );
    });

    it("names an unreadable sample percentage and the 0 it fell back to", (): void => {
      Config.validateConfig(bodyWith({ samplePercentage: "50" }));

      expect(detailOf("config-value-unrecognised")).toEqual({
        field: "samplePercentage",
        sent: "50",
        using: "0",
      });

      /* A non-string is reported by type, like the enum fields. */
      Config.validateConfig(bodyWith({ samplePercentage: null }));

      expect(detailsOf("config-value-unrecognised")[1]?.["sent"]).toBe(
        "object",
      );
    });
  });

  describe("fetchConfig", (): void => {
    /*
     * The exact URL, because the single most common cause of a silent
     * recorder is a request that never reached the OneUptime router: a
     * host with a typo, a missing /telemetry prefix, an nginx catch-all
     * answering 404 while the CORS preflight succeeds. The URL in this
     * record is what someone pastes into curl.
     */
    it("names the url it is about to request", async (): Promise<void> => {
      globalRecord()["fetch"] = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          return validBody;
        },
      });

      await Config.fetchConfig(options);

      expect(detailOf("config-fetch-start")["url"]).toBe(
        "https://oneuptime.com/telemetry/session-replay/v1/config",
      );
      expect(codes()).toEqual(["config-fetch-start", "config-accepted"]);
    });

    /*
     * The status is the whole diagnosis and each one points somewhere
     * completely different: 401 is a key in Project Settings, 404 is a
     * route, 403 is usually a header the tag never sent.
     */
    it("reports the status when the endpoint refuses", async (): Promise<void> => {
      globalRecord()["fetch"] = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 401 });

      expect(await Config.fetchConfig(options)).toBeNull();

      expect(codes()).toEqual(["config-fetch-start", "config-fetch-rejected"]);
      expect(detailOf("config-fetch-rejected")).toEqual({
        url: "https://oneuptime.com/telemetry/session-replay/v1/config",
        status: 401,
      });
    });

    /*
     * DNS, TLS, offline, an ad blocker, or a CSP connect-src that does not
     * list the OneUptime origin. The browser prints its own message for
     * some of these and nothing at all for others, and none of them reach
     * the page as an error it could report.
     */
    it("reports a fetch that never completed", async (): Promise<void> => {
      globalRecord()["fetch"] = jest
        .fn()
        .mockRejectedValue(new Error("Failed to fetch"));

      expect(await Config.fetchConfig(options)).toBeNull();

      expect(codes()).toEqual(["config-fetch-start", "config-fetch-failed"]);
      expect(detailOf("config-fetch-failed")["url"]).toBe(
        "https://oneuptime.com/telemetry/session-replay/v1/config",
      );
    });

    /*
     * A 200 whose body will not parse - an HTML login page, a captive
     * portal, an SSO interstitial, or an error page from something in front
     * of the router.
     *
     * Reported separately from a rejected fetch, and the distinction is the
     * whole value of the record: "the request never left the browser" points
     * at a CSP or an ad blocker, while "something answered 200 with HTML"
     * points at the network path. These used to share one catch and one
     * code, which sent the reader to the wrong one of the two.
     */
    it("distinguishes a body that will not parse from a request that failed", async (): Promise<void> => {
      globalRecord()["fetch"] = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          throw new Error("Unexpected token < in JSON");
        },
      });

      expect(await Config.fetchConfig(options)).toBeNull();

      expect(codes()).toEqual([
        "config-fetch-start",
        "config-body-unparseable",
      ]);

      /* The status is what says the request DID complete. */
      expect(detailOf("config-body-unparseable")["status"]).toBe(200);
    });

    /*
     * A rejected body still gets validated, so the fetch record and the
     * reason it was refused arrive as one timeline rather than two.
     */
    it("keeps the fetch and the validation on one timeline", async (): Promise<void> => {
      globalRecord()["fetch"] = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          return { enabled: false, disabledReason: "not-sampled" };
        },
      });

      expect(await Config.fetchConfig(options)).toBeNull();

      expect(codes()).toEqual(["config-fetch-start", "config-disabled"]);
    });
  });

  /*
   * Diagnostics are printed into an end user's console and pasted into
   * support tickets, so the channel has exactly one rule: it carries no
   * secret and no page data. The two values that would do real damage are
   * the ingestion token (it writes to the customer's telemetry) and the
   * userRef (it identifies a human being).
   */
  describe("what a record may never contain", (): void => {
    const token: string = "tok-DO-NOT-LOG-9f3c1d";
    const userRef: string = "user-DO-NOT-LOG-4271";

    function initWithSecrets(): RecorderInitOptions {
      globalRecord()[INIT_GLOBAL] = {
        host: "https://oneuptime.com",
        token: token,
        appIdentifier: "app-1",
        userRef: userRef,

        /* On, so the console path is exercised too, not just the ring. */
        debug: true,
      };

      const read: RecorderInitOptions | null = Config.readInitOptions();

      expect(read).not.toBeNull();

      return read as RecorderInitOptions;
    }

    it("keeps the token and the userRef out of a successful run", async (): Promise<void> => {
      const read: RecorderInitOptions = initWithSecrets();

      globalRecord()["fetch"] = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => {
          return validBody;
        },
      });

      expect(await Config.fetchConfig(read)).not.toBeNull();

      const serialised: string = JSON.stringify(getDebugRecords());

      /* Guard against the assertion passing because nothing was recorded. */
      expect(getDebugRecords().length).toBeGreaterThan(2);
      expect(serialised).not.toContain(token);
      expect(serialised).not.toContain(userRef);
    });

    /*
     * The failure path specifically: it is the one where a future "let us
     * log the request we sent" would dump the headers, and the token and
     * the userRef both travel as headers.
     */
    it("keeps them out of a failed run too", async (): Promise<void> => {
      const read: RecorderInitOptions = initWithSecrets();

      globalRecord()["fetch"] = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 401 });

      expect(await Config.fetchConfig(read)).toBeNull();

      const serialised: string = JSON.stringify(getDebugRecords());

      expect(codes()).toContain("config-fetch-rejected");
      expect(serialised).not.toContain(token);
      expect(serialised).not.toContain(userRef);
    });

    /*
     * The server's own body is not a safe source either. Nothing the
     * server sends is echoed into a record except the policy fields, so a
     * value parked in an unrelated key cannot ride the diagnostics channel
     * back out into a console.
     */
    it("does not echo unrelated fields from the server body", (): void => {
      Config.validateConfig(
        bodyWith({
          internalNote: "leak-DO-NOT-LOG-88",
          apiKey: "leak-DO-NOT-LOG-99",
        }),
      );

      expect(JSON.stringify(getDebugRecords())).not.toContain("DO-NOT-LOG");
    });
  });
});
