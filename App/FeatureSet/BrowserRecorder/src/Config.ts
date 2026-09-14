import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_RECORDER_CAPABILITIES,
  SESSION_REPLAY_USER_REF_HEADER,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import { debugLog, debugWarn, setEnabled } from "./Debug";

/*
 * Init options and the policy fetch.
 *
 * Every masking, consent and sampling decision comes from the config
 * endpoint, and a config fetch that fails for any reason means no
 * recording at all. That is the whole reason the endpoint exists: without
 * it, a customer flipping "mask everything" in the Dashboard would never
 * reach a browser that had already loaded the script.
 *
 * Two different things can be wrong with an individual policy field, and
 * they resolve differently on purpose:
 *
 *   - The field is ABSENT. That is an older server (or a proxy that drops
 *     unknown keys) and the recorder fills in the PRODUCT default - the
 *     same value a fresh RumApplication row carries (Always / 100% /
 *     NotRequired / MaskSensitiveInputsOnly). The previous behaviour was
 *     to fall to the strictest option instead, which turned an absent
 *     field into "record into memory, upload nothing, wait for a consent
 *     call nobody makes" while the Dashboard showed the opposite policy -
 *     a silent no-recording bug indistinguishable from a broken install.
 *
 *   - The field is PRESENT but this build does not recognise the value.
 *     That is a newer server or a tampered body, and the recorder collapses
 *     to the STRICTEST option, because an unknown value must never be able
 *     to relax masking or consent. See config-value-unrecognised below.
 */

/*
 * Replaced by esbuild's define. The typeof guard is what keeps unit tests
 * (which run the TypeScript directly, with no define applied) working.
 */
declare const __ONEUPTIME_RECORDER_VERSION__: string;

export const RECORDER_VERSION: string =
  typeof __ONEUPTIME_RECORDER_VERSION__ === "string"
    ? __ONEUPTIME_RECORDER_VERSION__
    : "0.0.0-dev";

/* Pinned by package.json. Reported on every chunk so playback can branch. */
export const RRWEB_VERSION: string = "2.1.1";

export const AUTH_TOKEN_HEADER: string = "x-oneuptime-token";

/*
 * Every path is /telemetry-prefixed, and that prefix is load-bearing.
 *
 * The router is mounted at both "/" and "/telemetry", so the bare paths look
 * equivalent from the server's point of view - but they are not equivalent
 * from the browser's. On a real deployment nginx has a catch-all `location /`
 * that proxies to the Home app, and Frontend's DashboardFallbackRoutePrefixes-
 * ToSkip only exempts /telemetry. A request to /session-replay/v1/config
 * therefore reaches the Home app and comes back 404, while the CORS preflight
 * still succeeds - so the recorder saw a well-formed rejection and stopped,
 * with no error anywhere.
 *
 * The artifact path already had the prefix; these two did not, which meant the
 * recorder could never start against any deployment behind that nginx config.
 */
export const CONFIG_PATH: string = "/telemetry/session-replay/v1/config";
export const CHUNK_PATH: string = "/telemetry/session-replay/v1/chunk";

/*
 * A standalone function rather than a Config static on purpose: class
 * methods are never tree-shaken, and only the ARTIFACT posts chunks. As
 * a static this rode along in the loader stub (which lives on a hard
 * byte budget) as dead weight - together with the CHUNK_PATH string.
 */
export function getChunkUrl(options: RecorderInitOptions): string {
  return `${options.host}${CHUNK_PATH}`;
}

/*
 * What THIS recorder build can capture, advertised on chunk 0's envelope
 * (see SessionReplayChunkEnvelope.capabilities). Purely informational: the
 * player uses it to say "this recording predates click labels" instead of
 * showing an empty tab. A standalone function for the same reason as
 * getChunkUrl - only the artifact posts chunks, and a class static would
 * ride along in the byte-budgeted loader stub as dead weight.
 *
 * Web vitals are the one capability a config can switch off, so a
 * recording made with them off says so rather than claiming a capability
 * the viewer will never find events for.
 */
export function getRecorderCapabilities(options?: {
  captureWebVitals?: boolean;
}): Array<string> {
  return SESSION_REPLAY_RECORDER_CAPABILITIES.filter(
    (capability: string): boolean => {
      return !(
        capability === "web-vitals" && options?.captureWebVitals === false
      );
    },
  );
}

/* Where the pinned, immutable artifact lives. */
export const ARTIFACT_PATH_PREFIX: string = "/telemetry/session-replay";

/*
 * recorderVersion is interpolated straight into an artifact URL path, so
 * "non-empty string" is not a sufficient check: a config value of
 * "../../../admin" would produce a request to an entirely different path on
 * the ingest origin. Semver is also exactly what the build stamps (see
 * esbuild.config.js, which asserts package.json's version against this same
 * shape), so anything that does not match cannot correspond to a published
 * artifact and the only safe response is to refuse to record.
 *
 * Kept in sync with RECORDER_VERSION_PATTERN in esbuild.config.js and
 * Manifest.ts - there is a test asserting all three agree.
 */
export const RECORDER_VERSION_PATTERN: RegExp =
  /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

/*
 * A config fetch that hangs must not hang the recorder's startup forever.
 * Deliberately short: no recording is a better outcome than a pending
 * request held open on the customer's page.
 */
export const CONFIG_FETCH_TIMEOUT_MS: number = 5000;

/*
 * The spellings a person actually types into an HTML attribute. Kept
 * identical to TRUTHY in Debug.ts, which resolves the same switch from the
 * init global - a switch that works from one place and not the other is
 * worse than no switch at all on a diagnostic nobody can reach a console for.
 */
const TRUTHY_OPTION_PATTERN: RegExp = /^(1|true|yes|on)$/i;

/*
 * The policy snapshot as the recorder consumes it.
 *
 * recorderIntegrity is additive on top of the shared wire type: the loader
 * needs an SRI hash to put on the injected script tag, and a server that does
 * not send one simply gets a script tag without an integrity attribute rather
 * than no recording. Additive-only is the rule for this whole contract,
 * because a customer's browser may run an older recorder than the server it
 * posts to for as long as the pinned artifact stays cached.
 */
export interface LoaderConfig extends SessionReplayConfigResponse {
  recorderIntegrity?: string;

  /*
   * The config body exactly as received, UNVALIDATED. The loader stub
   * lives under a hard byte budget, so fields only the full artifact acts
   * on (trace propagation, performance budgets, targeted capture) are not
   * validated here field-by-field; the artifact normalises them from this
   * passthrough (see ExtendedConfig.ts) and treats a missing or hostile
   * value as "feature off". Nothing in the LOADER may read through this.
   */
  raw?: Record<string, unknown>;
}

export interface RecorderInitOptions {
  /* Ingest origin, e.g. "https://oneuptime.com". No trailing slash needed. */
  host: string;

  /* OneUptime telemetry ingestion key. */
  token: string;

  /* RumApplication identifier. Travels as a header so ingest can gate pre-decode. */
  appIdentifier: string;

  /*
   * Opaque end-user reference from the host page. Only ever stored when the
   * application has user-identity capture switched on; otherwise the server
   * keeps a one-way HMAC of it.
   */
  userRef?: string;

  /*
   * The one override that can turn off DNT/GPC honouring locally, for a
   * customer whose lawful basis does not depend on it.
   *
   * A TRI-STATE, deliberately: absent means the page said nothing and the
   * server policy decides (Consent.isRecordingPermitted). It used to be
   * coerced to `true` the moment it was read, here and in the script-tag
   * reader, so "the page said nothing" and "the page said honour it" were
   * the same value and the policy's own respectDoNotTrack could never be
   * reached from a page - while three comments promised it could.
   */
  respectDoNotTrack?: boolean;

  /*
   * Print the recorder's decisions to the console. Off unless asked for -
   * this script runs on end users' machines, not the customer's - and
   * equivalent to the localStorage and query-string switches in Debug.ts.
   * See there for why the diagnostic exists at all.
   */
  debug?: boolean;
}

export default class Config {
  /*
   * Read init options from the page.
   *
   * Two supported shapes, both of which a customer can paste without a
   * build step: data-* attributes on the script tag, or a global object
   * set before the script loads. Returns null when required fields are
   * missing — the recorder then does nothing at all rather than guessing
   * an endpoint to post end-user screen content to.
   */
  public static readInitOptions(
    documentRef: Document = document,
    windowRef: Window = window,
  ): RecorderInitOptions | null {
    const fromGlobal: RecorderInitOptions | null = Config.readGlobalOptions(
      windowRef as unknown as Record<string, unknown>,
    );

    if (fromGlobal) {
      return Config.acceptOptions(fromGlobal, "init-global");
    }

    const fromTag: RecorderInitOptions | null =
      Config.readScriptTagOptions(documentRef);

    return fromTag ? Config.acceptOptions(fromTag, "script-tag") : null;
  }

  /*
   * One exit for both option sources.
   *
   * It applies the page's own debug switch - read here rather than in
   * Debug.resolve, because resolving it there would mean a document-wide
   * querySelector on every page load for a switch that is off on virtually
   * all of them - and reports what was read. `host` and `appIdentifier` are
   * the two values a wrong install gets wrong, and neither is user data.
   */
  private static acceptOptions(
    options: RecorderInitOptions,
    source: string,
  ): RecorderInitOptions {
    if (options.debug === true) {
      setEnabled(true, source);
    }

    debugLog("init-options-read", "Init options read.", {
      source: source,
      host: options.host,
      appIdentifier: options.appIdentifier,
      respectDoNotTrack:
        options.respectDoNotTrack === undefined
          ? "policy-decides"
          : options.respectDoNotTrack,
    });

    return options;
  }

  private static readGlobalOptions(
    windowRecord: Record<string, unknown>,
  ): RecorderInitOptions | null {
    const raw: unknown = windowRecord["__ONEUPTIME_SESSION_REPLAY__"];

    if (!raw || typeof raw !== "object") {
      return null;
    }

    return Config.normaliseOptions(
      raw as Record<string, unknown>,
      "init-global",
    );
  }

  private static readScriptTagOptions(
    documentRef: Document,
  ): RecorderInitOptions | null {
    /*
     * document.currentScript is null for a dynamically injected script by
     * the time it executes asynchronously, so the tag is located by a
     * marker attribute instead.
     */
    const tag: Element | null = documentRef.querySelector(
      "script[data-oneuptime-token]",
    );

    if (!tag) {
      return null;
    }

    /*
     * The host defaults to wherever this script was served from.
     *
     * By definition that IS the OneUptime host - the browser just fetched
     * the recorder from it - so requiring the customer to repeat it in a
     * data-oneuptime-host attribute is redundant and, worse, silent when
     * omitted: normaliseOptions rejects the whole config and the recorder
     * does nothing at all, with no console output to explain why. The
     * documented install snippet does not include the attribute, so anyone
     * following the docs verbatim hit exactly that.
     *
     * An explicit data-oneuptime-host still wins, for deployments that proxy
     * the script through their own domain.
     */
    const explicitHost: string | null = tag.getAttribute("data-oneuptime-host");

    const dataset: Record<string, unknown> = {
      host: explicitHost || Config.readHostFromScriptSrc(tag),
      token: tag.getAttribute("data-oneuptime-token"),
      appIdentifier: tag.getAttribute("data-oneuptime-app-identifier"),
      userRef: tag.getAttribute("data-oneuptime-user-ref"),
      /*
       * Absent stays absent. hasAttribute rather than a !== "false" on the
       * value, so a tag that does not mention it leaves the decision to the
       * server policy instead of asserting "honour it".
       */
      respectDoNotTrack: tag.hasAttribute("data-oneuptime-respect-do-not-track")
        ? tag.getAttribute("data-oneuptime-respect-do-not-track") !== "false"
        : undefined,
      debug: tag.getAttribute("data-oneuptime-debug"),
    };

    return Config.normaliseOptions(dataset, "script-tag");
  }

  /*
   * Origin of the script tag's own src, or null when it cannot be derived
   * (an inline tag, or a src that will not parse).
   */
  private static readHostFromScriptSrc(tag: Element): string | null {
    const src: string | null = tag.getAttribute("src");

    if (!src) {
      return null;
    }

    try {
      /*
       * Resolved against the page so a relative src - which is what a
       * customer proxying the script through their own domain would use -
       * still yields an absolute origin.
       */
      return new URL(src, window.location.href).origin;
    } catch {
      return null;
    }
  }

  private static normaliseOptions(
    raw: Record<string, unknown>,
    source: string,
  ): RecorderInitOptions | null {
    const host: unknown = raw["host"];
    const token: unknown = raw["token"];
    const appIdentifier: unknown = raw["appIdentifier"];
    const userRef: unknown = raw["userRef"];
    const respectDoNotTrack: unknown = raw["respectDoNotTrack"];

    if (
      typeof host !== "string" ||
      typeof token !== "string" ||
      typeof appIdentifier !== "string" ||
      !host ||
      !token ||
      !appIdentifier
    ) {
      /*
       * WHICH field is missing, and on WHICH source. "the snippet is wrong"
       * and "the host could not be derived from the script src" are
       * different bugs with different fixes, and the console.warn the loader
       * prints for this case cannot tell them apart.
       *
       * Deliberately not phrased as an outcome. The global is only the FIRST
       * of two sources, so a page that sets `window.__ONEUPTIME_SESSION_REPLAY__
       * = { debug: true }` purely to switch diagnostics on - which is a
       * documented way to do it - reaches this line and then records
       * perfectly well from its script tag. Saying "nothing will be
       * recorded" there would hand the person who just enabled diagnostics a
       * fault that does not exist. Whether anything actually records is the
       * loader's to report, and it does.
       */
      debugWarn(
        "init-options-incomplete",
        "An init source is missing a required field and was skipped.",
        {
          source: source,
          hasHost: typeof host === "string" && Boolean(host),
          hasToken: typeof token === "string" && Boolean(token),
          hasAppIdentifier:
            typeof appIdentifier === "string" && Boolean(appIdentifier),
        },
      );

      return null;
    }

    const options: RecorderInitOptions = {
      host: host.replace(/\/+$/, ""),
      token: token,
      appIdentifier: appIdentifier,
    };

    /*
     * Only an explicit value is carried. `undefined` is the third state -
     * "the page did not say" - and exactOptionalPropertyTypes makes an
     * assigned undefined a different type from an absent key, so it is
     * assigned conditionally like userRef below.
     */
    if (respectDoNotTrack === false || respectDoNotTrack === "false") {
      options.respectDoNotTrack = false;
    } else if (respectDoNotTrack === true || respectDoNotTrack === "true") {
      options.respectDoNotTrack = true;
    }

    if (Config.readBooleanOption(raw["debug"])) {
      options.debug = true;
    }

    /*
     * Assigned conditionally rather than as `userRef: undefined`, because
     * exactOptionalPropertyTypes makes those two different types.
     */
    if (typeof userRef === "string" && userRef) {
      options.userRef = userRef;
    }

    return options;
  }

  /*
   * The spellings a person actually types into an HTML attribute.
   *
   * The tag attribute used to be compared against the literal string "true"
   * while the init global went through Debug's own resolver, which accepts
   * "1", "yes" and "on" in any case - so data-oneuptime-debug="1" silently
   * did nothing while the equivalent global worked. On a feature whose whole
   * point is being reachable by somebody who cannot get to a console, a
   * switch that only works if you guess the right word is worse than no
   * switch.
   */
  private static readBooleanOption(value: unknown): boolean {
    return (
      value === true ||
      (typeof value === "string" && TRUTHY_OPTION_PATTERN.test(value))
    );
  }

  public static getConfigUrl(options: RecorderInitOptions): string {
    return `${options.host}${CONFIG_PATH}`;
  }

  public static isValidRecorderVersion(value: unknown): value is string {
    return typeof value === "string" && RECORDER_VERSION_PATTERN.test(value);
  }

  /*
   * Returns null rather than a best-effort URL when the version is not a
   * semver the build could have produced. The caller then loads nothing,
   * which is the same fail-closed outcome as a config fetch that failed:
   * a <script src> assembled from an unvalidated config value is a request
   * to an attacker-chosen path on the ingest origin.
   */
  public static getArtifactUrl(
    options: RecorderInitOptions,
    recorderVersion: string,
  ): string | null {
    if (!Config.isValidRecorderVersion(recorderVersion)) {
      return null;
    }

    return `${options.host}${ARTIFACT_PATH_PREFIX}/v${recorderVersion}/recorder.js`;
  }

  public static getIngestHeaders(
    options: RecorderInitOptions,
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    headers[AUTH_TOKEN_HEADER] = options.token;
    headers[SESSION_REPLAY_APP_IDENTIFIER_HEADER] = options.appIdentifier;

    return headers;
  }

  /*
   * Fetch the policy snapshot. Resolves to null on ANY failure — network
   * error, timeout, non-2xx, unparseable body, or a body missing required
   * fields. Failing closed is the point; a recorder that guesses its
   * masking policy is a data breach with extra steps.
   */
  public static async fetchConfig(
    options: RecorderInitOptions,
  ): Promise<LoaderConfig | null> {
    const controller: AbortController = new AbortController();

    const timeout: ReturnType<typeof setTimeout> = setTimeout((): void => {
      controller.abort();
    }, CONFIG_FETCH_TIMEOUT_MS);

    const headers: Record<string, string> = Config.getIngestHeaders(options);

    /*
     * Config fetch only, never on chunks: the server answers the
     * "record this user's next session" question exactly once, here.
     * Encoded because fetch() THROWS on a non-ISO-8859-1 header value —
     * an emoji in a customer's user id must not disable recording.
     */
    if (options.userRef) {
      try {
        /*
         * Sliced to 512 = SESSION_REPLAY_MAX_USER_REF_LENGTH (a literal:
         * importing the constant costs loader bytes we do not have). A
         * longer ref can never match a target, and an unbounded one can
         * blow the HTTP header-size limit and kill the whole fetch.
         * encodeURIComponent throws on a lone surrogate — a page that
         * truncated a string through an emoji, or this very slice — and
         * that must skip targeting, never break recording.
         */
        headers[SESSION_REPLAY_USER_REF_HEADER] = encodeURIComponent(
          options.userRef.slice(0, 512),
        );
      } catch {
        /* Un-encodable ref: recording proceeds untargeted. */
      }
    }

    const url: string = Config.getConfigUrl(options);

    debugLog("config-fetch-start", "Requesting the policy.", {
      url: url,
      timeoutMs: CONFIG_FETCH_TIMEOUT_MS,
    });

    try {
      const response: Response = await fetch(url, {
        method: "GET",
        headers: headers,
        signal: controller.signal,

        /*
         * credentials omitted so the recorder never sends the customer's
         * end-user cookies to the OneUptime origin, and never relies on
         * them for auth.
         */
        credentials: "omit",
        mode: "cors",
      });

      if (!response.ok) {
        /*
         * The three statuses that account for nearly every report, named
         * because the fix for each is somewhere completely different: a
         * key in Project Settings, an nginx route, a header on the tag.
         */
        debugWarn(
          "config-fetch-rejected",
          "The config endpoint refused the request. Nothing will be recorded.",
          { url: url, status: response.status },
        );

        return null;
      }

      let body: unknown = null;

      try {
        body = await response.json();
      } catch {
        /*
         * A 2xx that is not JSON. Reported separately from the catch below,
         * because "the request never left the browser" and "something on the
         * path answered 200 with an HTML page" are different faults with
         * different fixes - a CSP or an ad blocker for the first, a proxy,
         * captive portal or SSO interstitial for the second - and collapsing
         * them sends the reader to the wrong one.
         */
        debugWarn(
          "config-body-unparseable",
          "The config endpoint answered, but not with JSON. Something on the path is answering instead of OneUptime.",
          { url: url, status: response.status },
        );

        return null;
      }

      return Config.validateConfig(body);
    } catch {
      /*
       * A rejected fetch is a network-layer failure the page cannot see
       * either: DNS, TLS, offline, an ad blocker, a CSP connect-src that
       * does not list the OneUptime origin, or this request outliving
       * CONFIG_FETCH_TIMEOUT_MS. The browser prints its own message for
       * some of these and nothing at all for others.
       */
      debugWarn(
        "config-fetch-failed",
        "The config request never completed. Nothing will be recorded.",
        { url: url, timeoutMs: CONFIG_FETCH_TIMEOUT_MS },
      );

      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /*
   * Validate and normalise a config body.
   *
   * A MISSING policy field takes the product default (the value a fresh
   * RumApplication carries), so an older server records exactly what its
   * Dashboard says it does. An UNRECOGNISED value resolves to the SAFE
   * option, not the useful one: an unknown masking mode becomes
   * MaskAllText, an unknown consent mode RequireExplicit, an unknown
   * capture trigger OnErrorOrFrustration, an unreadable sample percentage
   * 0. See the file header for why the two cases differ.
   */
  public static validateConfig(body: unknown): LoaderConfig | null {
    if (!body || typeof body !== "object") {
      debugWarn(
        "config-unparseable",
        "The config response was not a JSON object. Nothing will be recorded.",
      );

      return null;
    }

    const raw: Record<string, unknown> = body as Record<string, unknown>;

    /*
     * The server can be told to turn diagnostics on for EVERY visitor, which
     * is the only switch reachable by an operator who cannot touch the
     * customer's page. Applied before the gates below so a disabled response
     * still explains itself. See SESSION_REPLAY_DEBUG.
     */
    if (raw["debug"] === true) {
      setEnabled(true, "server-config");
    }

    if (raw["enabled"] !== true) {
      /*
       * The single most common answer to "replay is on in the dashboard but
       * nothing happens", and until the server started sending
       * disabledReason there was no way to tell the five causes apart from a
       * browser. `recorder-not-built` in particular is a deployment that
       * never ran the recorder build, which no amount of dashboard
       * configuration will fix.
       */
      const reason: unknown = raw["disabledReason"];

      /*
       * disabledDetail narrows the reason to the switch or the budget that
       * did it, and budgetResetsAt says when a budget clears. "Off because
       * the monthly session budget is exhausted, back on the 1st" is a
       * different ticket from "off because someone turned it off".
       */
      const detail: unknown = raw["disabledDetail"];
      const budgetResetsAt: unknown = raw["budgetResetsAt"];

      debugWarn(
        "config-disabled",
        "The server says replay is off here. Nothing will be recorded.",
        {
          disabledReason:
            typeof reason === "string" && reason ? reason : "not-reported",
          disabledDetail:
            typeof detail === "string" && detail ? detail : "not-reported",
          budgetResetsAt:
            typeof budgetResetsAt === "string" && budgetResetsAt
              ? budgetResetsAt
              : "not-reported",
        },
      );

      return null;
    }

    const recorderVersion: unknown = raw["recorderVersion"];

    /*
     * Rejected here rather than at the point of use, so no downstream caller
     * ever holds a LoaderConfig carrying a version that cannot name a
     * published artifact.
     */
    if (!Config.isValidRecorderVersion(recorderVersion)) {
      debugWarn(
        "config-recorder-version-invalid",
        "The server named no published recorder version, so no artifact can load.",
        {
          recorderVersion:
            typeof recorderVersion === "string" ? recorderVersion : "missing",
        },
      );

      return null;
    }

    /*
     * Fail-closed on an unrecognised value: a config from a newer server
     * than this recorder build, or a tampered response, must not be able
     * to relax masking. Only the modes this build actually implements are
     * honoured, and everything else collapses to the strictest one.
     *
     * An ABSENT field is different: nothing was sent to distrust, and the
     * strictest option is not the one the customer's Dashboard shows. The
     * product default (the RumApplication column default) is.
     */
    const maskingMode: SessionReplayMaskingMode =
      raw["maskingMode"] === SessionReplayMaskingMode.MaskInputsOnly
        ? SessionReplayMaskingMode.MaskInputsOnly
        : raw["maskingMode"] ===
              SessionReplayMaskingMode.MaskSensitiveInputsOnly ||
            raw["maskingMode"] === undefined
          ? SessionReplayMaskingMode.MaskSensitiveInputsOnly
          : SessionReplayMaskingMode.MaskAllText;

    const consentMode: SessionReplayConsentMode =
      raw["consentMode"] === SessionReplayConsentMode.NotRequired ||
      raw["consentMode"] === undefined
        ? SessionReplayConsentMode.NotRequired
        : SessionReplayConsentMode.RequireExplicit;

    const captureTrigger: string =
      raw["captureTrigger"] === SessionReplayCaptureTrigger.Always ||
      raw["captureTrigger"] === undefined
        ? SessionReplayCaptureTrigger.Always
        : SessionReplayCaptureTrigger.OnErrorOrFrustration;

    /*
     * Absent is 100 (the column default: every sampled session). Present
     * but unreadable - a string, NaN, null - is 0: a value that exists and
     * cannot be trusted must not be able to widen sampling.
     */
    const samplePercentage: number =
      raw["samplePercentage"] === undefined
        ? 100
        : Config.readNumber(raw["samplePercentage"], 0);

    const integrity: unknown = raw["recorderIntegrity"];

    const config: LoaderConfig = {
      enabled: true,
      recorderVersion: recorderVersion,
      maskingMode: maskingMode,
      captureTrigger: captureTrigger,
      consentMode: consentMode,
      samplePercentage: samplePercentage,
      maskSelectors: Config.readStringArray(raw["maskSelectors"]),
      blockSelectors: Config.readStringArray(raw["blockSelectors"]),
      urlAllowlist: Config.readStringArray(raw["urlAllowlist"]),
      /*
       * Absent on an older server is an empty list: every error stays
       * trigger-worthy, which is the pre-feature behaviour.
       */
      ignoreErrorPatterns: Config.readStringArray(raw["ignoreErrorPatterns"]),
      recordCanvas: raw["recordCanvas"] === true,
      captureUserIdentity: raw["captureUserIdentity"] === true,

      /* Absent means honour DNT. Only an explicit false turns it off. */
      respectDoNotTrack: raw["respectDoNotTrack"] !== false,
      configEpoch: Config.readNumber(raw["configEpoch"], 0),
      directive:
        raw["directive"] === "stop"
          ? "stop"
          : raw["directive"] === "throttle"
            ? "throttle"
            : "continue",

      /* Artifact-only fields ride through unvalidated; see LoaderConfig.raw. */
      raw: raw,
    };

    if (typeof integrity === "string" && integrity) {
      config.recorderIntegrity = integrity;
    }

    /*
     * The policy line. Everything below is a decision the recorder will now
     * make silently for the rest of the page's life, and the combination is
     * what usually explains "no requests in the network tab":
     * OnErrorOrFrustration with samplePercentage 0 is a session that records
     * into memory and uploads NOTHING until something goes wrong. That is
     * working as designed, and it is indistinguishable from broken.
     */
    debugLog("config-accepted", "Policy accepted.", {
      captureTrigger: config.captureTrigger,
      samplePercentage: config.samplePercentage,
      consentMode: config.consentMode,
      maskingMode: config.maskingMode,
      recorderVersion: config.recorderVersion,
      configEpoch: config.configEpoch,
      directive: config.directive,
      respectDoNotTrack: config.respectDoNotTrack,
      hasIntegrity: Boolean(config.recorderIntegrity),
    });

    /*
     * A value this build does not recognise collapses to the STRICTEST
     * option, not to the one the server meant. That is the right default and
     * a genuinely confusing one: a newer server, or a proxy rewriting the
     * body, can leave a customer looking at MaskAllText while the dashboard
     * shows something else entirely - and silently.
     *
     * A field that was never sent is the other case worth a line: the
     * recorder filled in the product default, and if the Dashboard was
     * changed away from that default the server is too old to say so.
     *
     * One loop rather than four blocks: this file is bundled into the
     * loader stub, which every visitor to a customer's site downloads.
     */
    for (const field of [
      "maskingMode",
      "consentMode",
      "captureTrigger",
      "samplePercentage",
    ]) {
      const sent: unknown = raw[field];
      const using: string = String(
        (config as unknown as Record<string, unknown>)[field],
      );

      if (sent === undefined) {
        debugLog(
          "config-field-defaulted",
          "The server sent no value for this field; using the product default.",
          { field: field, using: using },
        );
      } else if (
        sent !== (config as unknown as Record<string, unknown>)[field]
      ) {
        debugWarn(
          "config-value-unrecognised",
          "This build does not know a value the server sent; using the safest one instead.",
          {
            field: field,
            sent: typeof sent === "string" ? sent : typeof sent,
            using: using,
          },
        );
      }
    }

    return config;
  }

  private static readNumber(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }

    return value;
  }

  private static readStringArray(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry: unknown): entry is string => {
      return typeof entry === "string" && entry.length > 0;
    });
  }
}
