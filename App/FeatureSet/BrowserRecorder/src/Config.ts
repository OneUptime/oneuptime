import {
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_USER_REF_HEADER,
  SessionReplayConfigResponse,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";

/*
 * Init options and the policy fetch.
 *
 * The recorder holds NO defaults of its own for anything privacy-relevant.
 * Every masking, consent and sampling decision comes from the config
 * endpoint, and a config fetch that fails for any reason means no
 * recording at all. That is the whole reason the endpoint exists: without
 * it, a customer flipping "mask everything" in the Dashboard would never
 * reach a browser that had already loaded the script.
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
 * A standalone function rather than a Config static on purpose: class
 * methods are never tree-shaken, and only the ARTIFACT posts chunks. As
 * a static this rode along in the loader stub (which lives on a hard
 * byte budget) as dead weight.
 */
export function getChunkUrl(options: RecorderInitOptions): string {
  return `${options.host}${CHUNK_PATH}`;
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
   * customer whose lawful basis does not depend on it. Defaults to true,
   * and the server's own respectDoNotTrack still applies on top.
   */
  respectDoNotTrack?: boolean;
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
      return fromGlobal;
    }

    return Config.readScriptTagOptions(documentRef);
  }

  private static readGlobalOptions(
    windowRecord: Record<string, unknown>,
  ): RecorderInitOptions | null {
    const raw: unknown = windowRecord["__ONEUPTIME_SESSION_REPLAY__"];

    if (!raw || typeof raw !== "object") {
      return null;
    }

    return Config.normaliseOptions(raw as Record<string, unknown>);
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
      respectDoNotTrack:
        tag.getAttribute("data-oneuptime-respect-do-not-track") !== "false",
    };

    return Config.normaliseOptions(dataset);
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
      return null;
    }

    const options: RecorderInitOptions = {
      host: host.replace(/\/+$/, ""),
      token: token,
      appIdentifier: appIdentifier,
      respectDoNotTrack: respectDoNotTrack !== false,
    };

    /*
     * Assigned conditionally rather than as `userRef: undefined`, because
     * exactOptionalPropertyTypes makes those two different types.
     */
    if (typeof userRef === "string" && userRef) {
      options.userRef = userRef;
    }

    return options;
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

    try {
      const response: Response = await fetch(Config.getConfigUrl(options), {
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
        return null;
      }

      const body: unknown = await response.json();

      return Config.validateConfig(body);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /*
   * Validate and normalise a config body.
   *
   * Every unrecognised or missing value resolves to the SAFE option, not
   * the useful one: unknown masking mode becomes MaskAllText, unknown
   * consent mode becomes RequireExplicit, a missing sample percentage
   * becomes 0.
   */
  public static validateConfig(body: unknown): LoaderConfig | null {
    if (!body || typeof body !== "object") {
      return null;
    }

    const raw: Record<string, unknown> = body as Record<string, unknown>;

    if (raw["enabled"] !== true) {
      return null;
    }

    const recorderVersion: unknown = raw["recorderVersion"];

    /*
     * Rejected here rather than at the point of use, so no downstream caller
     * ever holds a LoaderConfig carrying a version that cannot name a
     * published artifact.
     */
    if (!Config.isValidRecorderVersion(recorderVersion)) {
      return null;
    }

    const maskingMode: SessionReplayMaskingMode =
      raw["maskingMode"] === SessionReplayMaskingMode.MaskInputsOnly
        ? SessionReplayMaskingMode.MaskInputsOnly
        : SessionReplayMaskingMode.MaskAllText;

    const consentMode: SessionReplayConsentMode =
      raw["consentMode"] === SessionReplayConsentMode.NotRequired
        ? SessionReplayConsentMode.NotRequired
        : SessionReplayConsentMode.RequireExplicit;

    const captureTrigger: string =
      raw["captureTrigger"] === SessionReplayCaptureTrigger.Always
        ? SessionReplayCaptureTrigger.Always
        : SessionReplayCaptureTrigger.OnErrorOrFrustration;

    const integrity: unknown = raw["recorderIntegrity"];

    const config: LoaderConfig = {
      enabled: true,
      recorderVersion: recorderVersion,
      maskingMode: maskingMode,
      captureTrigger: captureTrigger,
      consentMode: consentMode,
      samplePercentage: Config.readNumber(raw["samplePercentage"], 0),
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
