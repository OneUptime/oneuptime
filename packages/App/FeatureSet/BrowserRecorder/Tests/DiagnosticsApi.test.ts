import { SessionReplayConfigResponse } from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { RecorderInitOptions } from "../src/Config";
import {
  DebugRecord,
  debugLog,
  getDebugRecords,
  getDebugSource,
  isDebugEnabled,
} from "../src/Debug";
import { SessionReplayDiagnostics } from "../src/Index";

/*
 * The public diagnostics surface: OneUptimeReplay.setDebug() and
 * OneUptimeReplay.getDiagnostics().
 *
 * This is the pair a support engineer asks a customer to paste into the
 * console of the page that is misbehaving, so the properties that matter are
 * the unglamorous ones: it answers on a page where the recorder never
 * started, it answers whether or not anybody remembered to turn logging on
 * first, and it carries the LOADER's decisions - the ones made before this
 * bundle existed - because those are usually the answer.
 *
 * The gates are covered here from the outside for the same reason: every one
 * of them ends in "nothing recorded, no request, no output", and the only
 * thing that tells them apart on a customer's machine is the code each one
 * leaves behind.
 */

const INIT_OPTIONS: RecorderInitOptions = {
  host: "https://oneuptime.com",
  token: "tok",
  appIdentifier: "app-1",
  respectDoNotTrack: true,
};

function baseConfig(): SessionReplayConfigResponse {
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
}

type GlobalRecord = Record<string, unknown>;

function globalRecord(): GlobalRecord {
  return globalThis as unknown as GlobalRecord;
}

function codesIn(records: Array<DebugRecord>): Array<string> {
  return records.map((record: DebugRecord): string => {
    return record.code;
  });
}

/* The shared timeline, which both bundles and every test case write into. */
function codes(): Array<string> {
  return codesIn(getDebugRecords());
}

function detailOf(code: string): Record<string, unknown> {
  const record: DebugRecord | undefined = getDebugRecords().find(
    (candidate: DebugRecord): boolean => {
      return candidate.code === code;
    },
  );

  return (record?.detail || {}) as Record<string, unknown>;
}

interface ConsoleSpies {
  info: jest.Mock;
  warn: jest.Mock;
}

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

describe("Diagnostics API", (): void => {
  let fetchMock: jest.Mock;

  /*
   * jsdom's navigator has no globalPrivacyControl at all, so the signal is
   * defined onto it rather than assigned - and redefined back to false for
   * every case, because a leaked `true` would silently turn every later
   * bootstrap into a privacy-signal no-op.
   */
  const setPrivacySignal: (value: boolean) => void = (value: boolean): void => {
    Object.defineProperty(window.navigator, "globalPrivacyControl", {
      configurable: true,
      value: value,
    });
  };

  beforeEach((): void => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.head.innerHTML = "";
    document.body.innerHTML = "<div id='app'><p>content</p></div>";

    delete globalRecord()["CompressionStream"];
    delete globalRecord()["__ONEUPTIME_SESSION_REPLAY_STARTED__"];
    delete globalRecord()["OneUptimeReplayQueue"];
    delete globalRecord()["__ONEUPTIME_SESSION_REPLAY__"];

    /*
     * The diagnostics state lives on a global so the stub and the artifact
     * share one timeline - which also means it survives between test cases.
     * Every case starts from an empty ring and a switch that is off.
     */
    delete globalRecord()["__ONEUPTIME_SESSION_REPLAY_DEBUG__"];

    setPrivacySignal(false);

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

    globalRecord()["fetch"] = fetchMock;
    (window as unknown as Record<string, unknown>)["fetch"] = fetchMock;
  });

  afterEach((): void => {
    delete globalRecord()["__ONEUPTIME_SESSION_REPLAY_STARTED__"];
    delete globalRecord()["OneUptimeReplayQueue"];
    delete globalRecord()["__ONEUPTIME_SESSION_REPLAY_DEBUG__"];
    setPrivacySignal(false);
    jest.restoreAllMocks();
  });

  /*
   * The entry point holds module-level state - the active recorder and a
   * page-level "already started" flag - so each case gets its own copy of
   * the module, the way a fresh page load would.
   */
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

  describe("getDiagnostics", (): void => {
    it("answers on a page where nothing ever started", async (): Promise<void> => {
      /*
       * The likeliest moment anyone calls this: the recorder is missing, so
       * every field is being read off a recorder that does not exist. If it
       * threw here it would be useless in exactly the case it was built for.
       */
      const index: typeof import("../src/Index") = await importIndex();

      const diagnostics: SessionReplayDiagnostics = index.getDiagnostics();

      expect(diagnostics.isRecording).toBe(false);
      expect(diagnostics.sessionId).toBeNull();
      expect(diagnostics.isUploading).toBe(false);
      expect(diagnostics.triggerReason).toBeNull();

      /* The version pins which artifact the page actually got. */
      expect(typeof diagnostics.version).toBe("string");
      expect(diagnostics.version.length).toBeGreaterThan(0);
      expect(diagnostics.version).toBe(index.version);
    });

    it("includes records written before the artifact existed", async (): Promise<void> => {
      /*
       * The loader stub and the artifact are separate bundles with separate
       * module instances, and the stub's records are the ones that explain
       * why the artifact was never reached at all - a 404 on the policy, a
       * disabled project, an unsampled session. If getDiagnostics() only
       * reported what happened after this bundle loaded, every ticket where
       * the answer is "the stub stopped" would come back empty.
       */
      debugLog("loader-stopped-before-artifact", "The stub got this far.");

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig(), []);

      await tick();
      await tick();

      const records: Array<DebugRecord> = index.getDiagnostics().records;

      expect(codesIn(records)).toContain("loader-stopped-before-artifact");
      expect(codesIn(records)).toContain("bootstrap");

      index.stop();
    });

    it("hands back a copy of the timeline rather than the live ring", async (): Promise<void> => {
      /*
       * The return value goes straight into a support ticket, where it gets
       * serialised, sorted and sliced. None of that may reach back into the
       * recorder's own timeline.
       */
      const index: typeof import("../src/Index") = await importIndex();

      debugLog("a-real-step", "Something happened.");

      const first: Array<DebugRecord> = index.getDiagnostics().records;
      const originalLength: number = first.length;

      first.push({
        atUnixMs: 0,
        level: "info",
        code: "injected-by-the-caller",
        message: "Not a real record.",
      });

      first.length = 0;

      const second: Array<DebugRecord> = index.getDiagnostics().records;

      expect(second.length).toBe(originalLength);
      expect(codesIn(second)).toContain("a-real-step");
      expect(codesIn(second)).not.toContain("injected-by-the-caller");
    });
  });

  describe("setDebug", (): void => {
    it("starts printing to the console once it is switched on", async (): Promise<void> => {
      /*
       * The mid-incident switch: the page is already loaded and cannot be
       * redeployed, so turning logging on has to take effect on the next
       * decision the recorder makes, with no reload.
       */
      const index: typeof import("../src/Index") = await importIndex();
      const spies: ConsoleSpies = spyOnConsole();

      index.setDebug(true);

      debugLog("a-step-after-the-switch", "A later step ran.");

      expect(isDebugEnabled()).toBe(true);
      expect(getDebugSource()).toBe("api");
      expect(allConsoleText(spies)).toContain("a-step-after-the-switch");
    });

    it("goes quiet again when switched off, but keeps recording the timeline", async (): Promise<void> => {
      /*
       * Switching off is what a customer does before handing the page back
       * to real users, and it must not cost them the diagnostics: the ring
       * is filled unconditionally so getDiagnostics() still has the answer
       * afterwards. Output is the only thing the switch gates.
       */
      const index: typeof import("../src/Index") = await importIndex();
      const spies: ConsoleSpies = spyOnConsole();

      index.setDebug(true);
      index.setDebug(false);

      debugLog("a-step-after-the-switch-off", "A later step ran.");

      expect(isDebugEnabled()).toBe(false);
      expect(allConsoleText(spies)).not.toContain(
        "a-step-after-the-switch-off",
      );
      expect(codesIn(index.getDiagnostics().records)).toContain(
        "a-step-after-the-switch-off",
      );
    });

    it("is turned on by an init option carried through bootstrap", async (): Promise<void> => {
      /*
       * The install-time switch, for a customer who cannot open the console
       * of the browser that is failing - it is applied as bootstrap's very
       * first act, before any gate, so the run that a gate stops is still
       * the run that explains itself.
       */
      const options: RecorderInitOptions = {
        ...INIT_OPTIONS,
        debug: true,
      };

      const index: typeof import("../src/Index") = await importIndex();
      const spies: ConsoleSpies = spyOnConsole();

      index.bootstrap(options, baseConfig(), []);

      await tick();
      await tick();

      expect(isDebugEnabled()).toBe(true);
      expect(getDebugSource()).toBe("init-options");
      expect(allConsoleText(spies)).toContain("bootstrap");

      index.stop();
    });
  });

  describe("the bootstrap gates", (): void => {
    it("records a normal start alongside the recorder's own state", async (): Promise<void> => {
      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig(), []);

      await tick();
      await tick();

      const diagnostics: SessionReplayDiagnostics = index.getDiagnostics();

      expect(codesIn(diagnostics.records)).toContain("bootstrap");

      /*
       * The positive control for every "nothing recorded" case below: a
       * healthy page reports a session id, which is the value a support
       * engineer needs in order to look the recording up server-side.
       */
      expect(diagnostics.isRecording).toBe(true);
      expect(diagnostics.sessionId).not.toBeNull();

      index.stop();
    });

    it("says bootstrap-already-started when a second bundle starts on the same page", async (): Promise<void> => {
      /*
       * The loader stub plus a self-hosted copy of the artifact, or two
       * copies of the install snippet: two module instances, one page-level
       * flag. The second one records nothing at all, and without this code
       * the page just looks like a recorder that half works.
       */
      const first: typeof import("../src/Index") = await importIndex();

      first.bootstrap(INIT_OPTIONS, baseConfig(), []);

      await tick();
      await tick();

      const second: typeof import("../src/Index") = await importIndex();

      second.bootstrap(INIT_OPTIONS, baseConfig(), []);

      expect(codes()).toContain("bootstrap-already-started");
      expect(second.getDiagnostics().isRecording).toBe(false);

      first.stop();
    });

    it("says privacy-signal when the browser asked not to be tracked", async (): Promise<void> => {
      /*
       * Indistinguishable from a broken install without the code: nothing
       * records, nothing uploads, nothing prints. The artifact re-checks the
       * signal that the stub already checked because it can be loaded
       * directly, and a signal honoured on only one of two entry paths is
       * not honoured.
       */
      setPrivacySignal(true);

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig(), []);

      await tick();
      await tick();

      expect(codes()).toContain("privacy-signal");
      expect(index.getDiagnostics().isRecording).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("says directive-stop when the policy carries a stop directive", async (): Promise<void> => {
      /*
       * A server-side kill switch - budget exhausted, or an incident - looks
       * exactly like a broken recorder from the page. This is the one code
       * that tells a customer to stop debugging their install.
       */
      const config: SessionReplayConfigResponse = {
        ...baseConfig(),
        directive: "stop",
      };

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, config, []);

      await tick();
      await tick();

      expect(codes()).toContain("directive-stop");
      expect(index.getDiagnostics().isRecording).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("start", (): void => {
    it("says init-options-missing when the page carries no install snippet", async (): Promise<void> => {
      /*
       * The SELF-HOSTED artifact path. The loader stub prints an
       * unconditional console.warn for this identical condition, so a
       * customer who bundles the artifact themselves used to get total
       * silence from the one failure that WAS instrumented everywhere else.
       */
      const index: typeof import("../src/Index") = await importIndex();

      await index.start();

      expect(codes()).toContain("init-options-missing");

      /* Fail closed: no options means no endpoint to post screen content to. */
      expect(fetchMock).not.toHaveBeenCalled();
      expect(index.getDiagnostics().isRecording).toBe(false);
    });
  });

  describe("the command queue", (): void => {
    it("warns when the queue global is not an array", async (): Promise<void> => {
      /*
       * A page that assigned to window.OneUptimeReplayQueue instead of
       * pushing onto it - the mistake the snippet's own shape invites. Every
       * consent decision the page queued is dropped, so a RequireExplicit
       * project records and never uploads, forever.
       */
      globalRecord()["OneUptimeReplayQueue"] = "grantConsent";

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig(), []);

      await tick();
      await tick();

      expect(codes()).toContain("command-queue-not-an-array");
      expect(detailOf("command-queue-not-an-array")["type"]).toBe("string");

      index.stop();
    });

    it("names a queued command it does not recognise", async (): Promise<void> => {
      /*
       * Unknown names are ignored on purpose - a page may be written against
       * a newer recorder than the config pinned - but ignoring them silently
       * is how a misspelt "grantconsent" becomes a session that records
       * forever and uploads nothing. The name has to be in the record, or
       * the record cannot point at the typo.
       */
      globalRecord()["OneUptimeReplayQueue"] = [["grantconsent"]];

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig(), []);

      await tick();
      await tick();

      expect(codes()).toContain("command-queue-unknown-command");
      expect(detailOf("command-queue-unknown-command")["command"]).toBe(
        "grantconsent",
      );

      index.stop();
    });

    it("stays quiet for a correctly queued grantConsent", async (): Promise<void> => {
      /*
       * The negative control. A diagnostic that cries wolf on the documented
       * usage is one a customer learns to scroll past, and the two warnings
       * above are only useful if the correct call is silent.
       */
      globalRecord()["OneUptimeReplayQueue"] = [["grantConsent"]];

      const index: typeof import("../src/Index") = await importIndex();

      index.bootstrap(INIT_OPTIONS, baseConfig(), []);

      await tick();
      await tick();

      expect(codes()).toContain("api-grant-consent");
      expect(codes()).not.toContain("command-queue-unknown-command");
      expect(codes()).not.toContain("command-queue-not-an-array");

      index.stop();
    });
  });

  describe("the API with no recorder", (): void => {
    it("says api-no-recorder when captureSession() finds nothing running", async (): Promise<void> => {
      /*
       * A consent banner or a "report a problem" button calling into the
       * global after a gate already stopped the recorder. The call is a
       * no-op by design, and this record is the only thing that separates
       * "your button never fired" from "the recorder was not there to fire
       * at".
       */
      const index: typeof import("../src/Index") = await importIndex();

      index.captureSession();

      expect(codes()).toContain("api-no-recorder");
    });

    it("says api-no-recorder when grantConsent() finds nothing running", async (): Promise<void> => {
      /*
       * The costlier half of the same mistake: a grant that lands before the
       * artifact loaded is lost unless the page queued it, and nothing about
       * the page changes to say so.
       */
      const index: typeof import("../src/Index") = await importIndex();

      index.grantConsent();

      expect(codes()).toContain("api-no-recorder");
    });

    /*
     * REGRESSION (recorder-8). identify/track/setTags/addTag returned in
     * silence when no recorder existed, so a customer whose identify() ran
     * before the artifact loaded (or after stop()) saw "Identity hidden" in
     * the dashboard, no tags, nothing in getDiagnostics().records - while
     * the troubleshooting docs name api-no-recorder as the line to look for.
     */
    it.each([
      [
        "identify()",
        (index: typeof import("../src/Index")): void => {
          index.identify("user-42", { plan: "pro" });
        },
      ],
      [
        "track()",
        (index: typeof import("../src/Index")): void => {
          index.track("checkout_failed");
        },
      ],
      [
        "setTags()",
        (index: typeof import("../src/Index")): void => {
          index.setTags({ build: "9" });
        },
      ],
      [
        "addTag()",
        (index: typeof import("../src/Index")): void => {
          index.addTag("arm", "b");
        },
      ],
    ])(
      "says api-no-recorder when %s finds nothing running",
      async (
        call: string,
        run: (index: typeof import("../src/Index")) => void,
      ): Promise<void> => {
        const index: typeof import("../src/Index") = await importIndex();

        run(index);

        expect(codes()).toContain("api-no-recorder");

        /* Naming WHICH call it was; four of them share the code. */
        expect(JSON.stringify(index.getDiagnostics().records)).toContain(call);
      },
    );
  });
});
