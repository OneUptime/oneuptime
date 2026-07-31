import Config, { LoaderConfig, RecorderInitOptions } from "./Config";
import Consent from "./Consent";

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

interface ArtifactApi {
  bootstrap: (initOptions: RecorderInitOptions, config: LoaderConfig) => void;
}

export async function load(): Promise<void> {
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
      "OneUptime Session Replay: not starting. The script tag needs data-oneuptime-token and data-oneuptime-app-identifier, and a host it can derive from its own src (or an explicit data-oneuptime-host).",
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
    return;
  }

  const config: LoaderConfig | null = await Config.fetchConfig(options);

  if (!config) {
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
    return;
  }

  if (config.directive === "stop") {
    return;
  }

  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  globalRecord[LOADER_FLAG_GLOBAL] = true;

  loadArtifact(options, config);
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
    return;
  }

  const existing: ArtifactApi | null = readArtifactApi();

  if (existing) {
    existing.bootstrap(options, config);
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
      api.bootstrap(options, config);
    }
  };

  script.onerror = (): void => {
    /*
     * Most often a customer CSP that does not allow our origin in script-src,
     * which fails silently from the page's point of view. There is nothing
     * useful to do from here - the Dashboard's "test your installation" panel
     * is the diagnostic, because server telemetry cannot see a script that
     * never loaded.
     */
  };

  const parent: Node =
    document.head || document.body || document.documentElement;

  /*
   * Nothing awaits the script. The stub's promise resolves as soon as the tag
   * is in the document: holding a pending promise open for the lifetime of a
   * cross-origin fetch on a customer's page buys nothing, and bootstrap
   * happens from onload either way.
   */
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
void load().catch((): void => {
  /* Intentionally silent. */
});
