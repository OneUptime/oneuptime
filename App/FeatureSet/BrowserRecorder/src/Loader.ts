import Config, { LoaderConfig, RecorderInitOptions } from "./Config";
import Consent from "./Consent";
import {
  DEBUG_STORAGE_KEY,
  debugLog,
  debugWarn,
  isDebugEnabled,
} from "./Debug";
import {
  EarlyErrorBuffer,
  EarlyErrorRecord,
  installEarlyErrorBuffer,
} from "./EarlyErrors";

/*
 * The loader stub. This - not the recorder - is what a customer pastes into
 * their page, and it is served with a five minute cache while the recorder
 * artifact it loads is immutable for a year.
 *
 * That split is the entire point. Without it, a masking regression is live in
 * every customer's browser for the full cache TTL with no remedy: the bundle
 * is cached, the customers are third parties, and there is no way to reach
 * their end users. With it, rolling back is changing one field in the config
 * response, and the kill switch stops RECORDING rather than merely stopping
 * ingest.
 *
 * Everything this file does before loading the artifact is a gate:
 *
 *   no init options        -> do nothing
 *   DNT or GPC             -> do nothing, and do not even fetch the config
 *   config fetch fails     -> do nothing (fail closed)
 *   enabled false          -> do nothing
 *   directive "stop"       -> do nothing
 *
 * It deliberately imports neither rrweb nor the Recorder, so none of that
 * code is downloaded, parsed or executed on a page that is not recording.
 */

/* Set so the artifact knows it was loaded by the stub rather than directly. */
const LOADER_FLAG_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY_LOADER__";

const ARTIFACT_GLOBAL: string = "OneUptimeReplay";

/*
 * One string for both DNT checks. The signal is read before the config
 * request and again after it, and both stand-downs look identical to a
 * customer - so they read identically here too.
 */
const PRIVACY_SIGNAL_MESSAGE: string =
  "Do Not Track or Global Privacy Control is set. Nothing is recorded.";

interface ArtifactApi {
  bootstrap: (
    initOptions: RecorderInitOptions,
    config: LoaderConfig,
    earlyErrors?: Array<EarlyErrorRecord>,
  ) => void;
}

export async function load(): Promise<void> {
  /*
   * The very first line, so a customer who turned diagnostics on can tell
   * "the stub never ran" (CSP, a blocked request, a tag that is not on the
   * page) from "the stub ran and decided not to record". Those two look
   * identical from the network tab and have nothing in common.
   */
  debugLog("loader-start", "Loader running.", {
    diagnostics: isDebugEnabled() ? "on" : "off",
  });

  const options: RecorderInitOptions | null = Config.readInitOptions();

  if (!options) {
    /*
     * Say something. A misconfigured snippet used to produce total silence -
     * no recording, no request, no console output - which is indistinguishable
     * from "session replay is off for this app" and sends people looking in
     * the wrong place entirely.
     *
     * This is the ONLY thing the recorder logs. It is a setup error on the
     * customer's own page, it happens once, and the alternative is the
     * silence that made this bug expensive to find.
     */
    // eslint-disable-next-line no-console
    console.warn(
      `OneUptime Session Replay: not starting. The script tag needs data-oneuptime-token and data-oneuptime-app-identifier, and a host it can derive from its own src (or an explicit data-oneuptime-host). For a step-by-step diagnosis run localStorage.setItem("${DEBUG_STORAGE_KEY}", "true") and reload.`,
    );

    /*
     * Also recorded, so getDiagnostics() is a complete account on its own.
     * Config reports WHICH field was missing when it found a source to read;
     * this is the case where it found none at all - a misspelt marker
     * attribute, a snippet injected into a different document, or a tag
     * manager that dropped it - and without this line the timeline would
     * simply stop after loader-start.
     */
    debugWarn(
      "init-options-missing",
      "No usable init options on this page. Nothing will be recorded.",
    );

    return;
  }

  /*
   * Checked BEFORE the config request. A user who has asked not to be tracked
   * should not have a request made about them just to find out whether we
   * would have recorded them.
   */
  if (
    options.respectDoNotTrack !== false &&
    Consent.hasPrivacySignal(navigator)
  ) {
    debugWarn("privacy-signal", PRIVACY_SIGNAL_MESSAGE, {
      stage: "before-config-fetch",
    });

    return;
  }

  /*
   * From here to the artifact's first listener is the config round trip
   * (up to 5s) plus the artifact download — the exact window in which a
   * startup crash, the most valuable failure class an error-triggered
   * recorder has, used to fire into a void. The buffer sits AFTER the
   * synchronous privacy gates (a DNT user gets no listeners at all) and
   * is discarded on every fail-closed exit below; nothing in it leaves
   * the page except through the artifact's masking path.
   */
  const earlyErrors: EarlyErrorBuffer = installEarlyErrorBuffer();

  const config: LoaderConfig | null = await Config.fetchConfig(options);

  if (!config) {
    /* fetchConfig has already logged which of the five reasons it was. */
    earlyErrors.discard();
    return;
  }

  /*
   * Re-checked with the server's own respectDoNotTrack: either side insisting
   * is enough to honour the signal, and only both sides agreeing can turn it
   * off.
   */
  if (
    !Consent.isRecordingPermitted(
      options.respectDoNotTrack !== false,
      config.respectDoNotTrack,
      navigator,
    )
  ) {
    debugWarn("privacy-signal", PRIVACY_SIGNAL_MESSAGE, {
      stage: "after-config-fetch",
      policyRespectsDoNotTrack: config.respectDoNotTrack,
    });

    earlyErrors.discard();
    return;
  }

  if (config.directive === "stop") {
    debugWarn(
      "directive-stop",
      "The server told this recorder to stand down. Nothing is recorded.",
    );

    earlyErrors.discard();
    return;
  }

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  globalRecord[LOADER_FLAG_GLOBAL] = true;

  loadArtifact(options, config, earlyErrors);
}

/*
 * The artifact is an IIFE that publishes window.OneUptimeReplay, loaded with
 * a script tag rather than a dynamic import().
 *
 * Two reasons, both structural: an IIFE bundle imported as a module exposes
 * an empty namespace object, and import() has no way to carry an integrity
 * attribute - so SRI, which is the whole reason the artifact URL is version
 * pinned and immutable, would be unavailable.
 */
function loadArtifact(
  options: RecorderInitOptions,
  config: LoaderConfig,
  earlyErrors: EarlyErrorBuffer,
): void {
  const url: string | null = Config.getArtifactUrl(
    options,
    config.recorderVersion,
  );

  /*
   * A version the build could never have stamped means there is no artifact
   * to pin to. Loading nothing is the fail-closed outcome; guessing a URL
   * would put a <script src> built from an unvalidated config value onto the
   * customer's page.
   */
  if (!url) {
    debugWarn(
      "artifact-url-invalid",
      "The policy names a version this loader will not build a URL from.",
      { recorderVersion: config.recorderVersion },
    );

    earlyErrors.discard();
    return;
  }

  const existing: ArtifactApi | null = readArtifactApi();

  if (existing) {
    existing.bootstrap(options, config, earlyErrors.drain());
    return;
  }

  const script: HTMLScriptElement = document.createElement("script");

  script.src = url;
  script.async = true;

  /*
   * crossOrigin is required for integrity to be enforced on a cross-origin
   * script, and it also keeps error reporting from the artifact non-opaque.
   */
  script.crossOrigin = "anonymous";

  if (config.recorderIntegrity) {
    script.integrity = config.recorderIntegrity;
  }

  script.onload = (): void => {
    const api: ArtifactApi | null = readArtifactApi();

    if (api) {
      /*
       * drain() also uninstalls the stub's listeners: from the next line
       * on, the artifact's own ErrorRecorder is the listener of record,
       * and double-recording every error would follow from keeping both.
       */
      api.bootstrap(options, config, earlyErrors.drain());
    } else {
      /*
       * The script loaded and then the global was not there: something else
       * on the page overwrote it, or a proxy served a different bundle. The
       * artifact is on the page and doing nothing, which looks exactly like
       * it never arrived.
       */
      debugWarn(
        "artifact-api-missing",
        `The artifact loaded but did not publish window.${ARTIFACT_GLOBAL}.`,
        { url: url },
      );

      earlyErrors.discard();
    }
  };

  script.onerror = (): void => {
    /*
     * Most often a customer CSP that does not allow our origin in script-src,
     * which fails silently from the page's point of view. Server telemetry
     * cannot see a script that never loaded, so the Dashboard's "test your
     * installation" panel and this line are the only two diagnostics there
     * are. The buffer is released: no artifact will ever replay it.
     */
    debugWarn(
      "artifact-load-failed",
      "The artifact failed to load. Check CSP script-src and SRI.",
      { url: url, hasIntegrity: Boolean(config.recorderIntegrity) },
    );

    earlyErrors.discard();
  };

  const parent: Node =
    document.head || document.body || document.documentElement;

  /*
   * Nothing awaits the script. The stub's promise resolves as soon as the tag
   * is in the document: holding a pending promise open for the lifetime of a
   * cross-origin fetch on a customer's page buys nothing, and bootstrap
   * happens from onload either way.
   */
  debugLog("artifact-requested", "Injecting the artifact.", {
    url: url,
    hasIntegrity: Boolean(config.recorderIntegrity),
  });

  parent.appendChild(script);
}

function readArtifactApi(): ArtifactApi | null {
  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  const candidate: unknown = globalRecord[ARTIFACT_GLOBAL];

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const bootstrap: unknown = (candidate as Record<string, unknown>)[
    "bootstrap"
  ];

  if (typeof bootstrap !== "function") {
    return null;
  }

  return candidate as unknown as ArtifactApi;
}

/*
 * Self-starting: the stub is a side effect, not a library. The rejection
 * handler exists so a failure inside our own loading path can never surface
 * as an unhandled rejection on the customer's page.
 */
void load().catch((error: unknown): void => {
  /*
   * Still silent for everyone else - an exception in our own loading path
   * must not surface as an unhandled rejection on the customer's page - but
   * no longer silent for someone who asked. This catch used to swallow every
   * failure in the whole loader, so a genuine bug in here was
   * indistinguishable from a deliberate stand-down.
   */
  debugWarn(
    "loader-threw",
    "The loader threw. This is a recorder bug; please report it.",
    { error: String(error) },
  );
});
