import {
  AUTH_TOKEN_HEADER,
  CONFIG_PATH,
  MOBILE_RECORDER_KIND,
  SESSION_REPLAY_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER,
  SESSION_REPLAY_MAX_OFFLINE_DELAY_MS,
  SESSION_REPLAY_MAX_USER_REF_LENGTH,
  SESSION_REPLAY_RECORDER_KIND_HEADER,
  SESSION_REPLAY_USER_REF_HEADER,
  SessionReplayCaptureTrigger,
  SessionReplayConfigResponse,
  SessionReplayConsentMode,
  SessionReplayMaskingMode,
} from "./Contract";
import { ReplayStorage } from "./Storage";

export const CONFIG_FETCH_TIMEOUT_MS: number = 5_000;

export interface ReplayFetchResponse {
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
}

export type ReplayFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  },
) => Promise<ReplayFetchResponse>;

export interface MobileReplayStartOptions {
  /** Ingest origin, for example https://oneuptime.com. */
  host: string;
  /** OneUptime telemetry ingestion key. */
  token: string;
  /** Identifier of the OneUptime RUM application receiving the replay. */
  appIdentifier: string;
  /** Android applicationId or iOS bundle identifier. */
  mobileAppIdentifier: string;
  appName?: string;
  appVersion?: string;
  /** Optional opaque reference used by record-next-session targeting. */
  userRef?: string;
  captureIntervalMs?: number;
  fetch?: ReplayFetch;
  debug?: boolean;
  /**
   * Optional connectivity source for offline mode. Recording never depends
   * on it: without one, a lost connection is noticed when an upload fails
   * and the backlog is retried with backoff and whenever the app returns to
   * the foreground. With one, nothing is attempted while it says the device
   * is offline, and the backlog uploads the moment it says it is back. With
   * `@react-native-community/netinfo`:
   *
   *   connectivity: {
   *     subscribe: (listener) =>
   *       NetInfo.addEventListener((state) => listener(state.isConnected)),
   *   }
   */
  connectivity?: ReplayConnectivity;
}

export interface ReplayConnectivity {
  /**
   * Call `listener` with whether the device has a connection now and on
   * every change (null when unknown), and return a function that stops.
   */
  subscribe(listener: (isConnected: boolean | null) => void): () => void;
}

export interface ResolvedReplayConfig {
  enabled: boolean;
  captureTrigger: SessionReplayCaptureTrigger;
  consentMode: SessionReplayConsentMode;
  maskingMode: SessionReplayMaskingMode.MaskAllText;
  samplePercentage: number;
  captureUserIdentity: boolean;
  configEpoch: number;
  isTargeted: boolean;
  disabledReason?: string;
}

export interface ValidatedStartOptions extends MobileReplayStartOptions {
  host: string;
  token: string;
  appIdentifier: string;
  mobileAppIdentifier: string;
  fetch: ReplayFetch;
}

const MOBILE_APP_IDENTIFIER_LABEL_PATTERN: RegExp = /^[a-z0-9_-]+$/u;
const WHITESPACE_PATTERN: RegExp = /\s/u;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN: RegExp = /[\u0000-\u001F\u007F]/u;

/* Kept byte-for-byte compatible with Common's authorization grammar. */
export function normalizeMobileAppIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const identifier: string = value.trim().toLowerCase();
  if (
    !identifier ||
    identifier.length > 255 ||
    WHITESPACE_PATTERN.test(identifier)
  ) {
    return null;
  }

  const labels: Array<string> = identifier.split(".");
  if (labels.length < 2) {
    return null;
  }

  for (const label of labels) {
    if (
      !label ||
      !MOBILE_APP_IDENTIFIER_LABEL_PATTERN.test(label) ||
      label.startsWith("-") ||
      label.endsWith("-") ||
      label.startsWith("_") ||
      label.endsWith("_")
    ) {
      return null;
    }
  }

  return identifier;
}

export function normalizeIngestHost(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed: URL = new URL(value.trim());
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

export function normalizeRumAppIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const identifier: string = value.trim();
  if (
    !identifier ||
    identifier.length > 255 ||
    CONTROL_CHARACTER_PATTERN.test(identifier)
  ) {
    return null;
  }

  return identifier;
}

function defaultFetch(
  input: string,
  init?: Parameters<ReplayFetch>[1],
): Promise<ReplayFetchResponse> {
  const fetchRef: typeof fetch | undefined = globalThis.fetch;
  if (!fetchRef) {
    return Promise.reject(new Error("fetch-unavailable"));
  }

  return fetchRef(input, init as RequestInit) as Promise<ReplayFetchResponse>;
}

export function validateStartOptions(
  options: MobileReplayStartOptions,
): ValidatedStartOptions | null {
  if (!options || typeof options !== "object") {
    return null;
  }

  const host: string | null = normalizeIngestHost(options.host);
  const token: string =
    typeof options.token === "string" ? options.token.trim() : "";
  const appIdentifier: string | null = normalizeRumAppIdentifier(
    options.appIdentifier,
  );
  const mobileAppIdentifier: string | null = normalizeMobileAppIdentifier(
    options.mobileAppIdentifier,
  );
  const rawUserRef: string =
    typeof options.userRef === "string" ? options.userRef.trim() : "";
  const userRef: string | undefined = rawUserRef
    ? rawUserRef.slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH)
    : undefined;

  if (!host || !token || !appIdentifier || !mobileAppIdentifier) {
    return null;
  }

  const validated: ValidatedStartOptions = {
    ...options,
    host,
    token,
    appIdentifier,
    mobileAppIdentifier,
    fetch: options.fetch ?? defaultFetch,
  };
  if (userRef) {
    validated.userRef = userRef;
  } else {
    delete validated.userRef;
  }
  return validated;
}

export function mobileRequestHeaders(
  options: Pick<
    ValidatedStartOptions,
    "token" | "appIdentifier" | "mobileAppIdentifier" | "userRef"
  >,
  includeUserRef: boolean = false,
): Record<string, string> {
  const headers: Record<string, string> = {
    [AUTH_TOKEN_HEADER]: options.token,
    [SESSION_REPLAY_APP_IDENTIFIER_HEADER]: options.appIdentifier,
    [SESSION_REPLAY_RECORDER_KIND_HEADER]: MOBILE_RECORDER_KIND,
    [SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER]: options.mobileAppIdentifier,
  };
  if (includeUserRef && options.userRef) {
    try {
      headers[SESSION_REPLAY_USER_REF_HEADER] = encodeURIComponent(
        options.userRef.slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH),
      );
    } catch {
      /* An invalid surrogate skips targeting; policy fetch still proceeds. */
    }
  }
  return headers;
}

function failClosed(reason: string): ResolvedReplayConfig {
  return {
    enabled: false,
    captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    consentMode: SessionReplayConsentMode.RequireExplicit,
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    samplePercentage: 0,
    captureUserIdentity: false,
    configEpoch: 0,
    isTargeted: false,
    disabledReason: reason,
  };
}

export function normalizeReplayConfig(value: unknown): ResolvedReplayConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failClosed("invalid-config");
  }

  const config: Partial<SessionReplayConfigResponse> =
    value as Partial<SessionReplayConfigResponse>;
  const captureTrigger: SessionReplayCaptureTrigger =
    config.captureTrigger === SessionReplayCaptureTrigger.Always
      ? SessionReplayCaptureTrigger.Always
      : SessionReplayCaptureTrigger.OnErrorOrFrustration;
  const consentMode: SessionReplayConsentMode =
    config.consentMode === SessionReplayConsentMode.NotRequired
      ? SessionReplayConsentMode.NotRequired
      : SessionReplayConsentMode.RequireExplicit;
  const samplePercentage: number =
    typeof config.samplePercentage === "number" &&
    Number.isFinite(config.samplePercentage) &&
    config.samplePercentage >= 0 &&
    config.samplePercentage <= 100
      ? config.samplePercentage
      : 0;
  const enabled: boolean =
    config.enabled === true && config.directive === "continue";

  const resolved: ResolvedReplayConfig = {
    enabled,
    captureTrigger,
    consentMode,
    /* Mobile never relaxes text masking, even if web policy is looser. */
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    samplePercentage,
    captureUserIdentity: config.captureUserIdentity === true,
    configEpoch:
      typeof config.configEpoch === "number" &&
      Number.isSafeInteger(config.configEpoch) &&
      config.configEpoch >= 0
        ? config.configEpoch
        : 0,
    isTargeted: config.isTargeted === true,
  };
  if (typeof config.disabledReason === "string") {
    resolved.disabledReason = config.disabledReason.slice(0, 100);
  } else if (!enabled) {
    resolved.disabledReason = "disabled";
  }
  return resolved;
}

/*
 * Offline mode: the last policy the server gave this app, kept so that an
 * app launched WITHOUT a connection still records - and uploads when the
 * connection returns - instead of failing closed on a config request that
 * could never succeed. Only ever used when the config request itself failed
 * to get an answer (see isRetryablePolicyFailure's callers); an answer
 * saying replay is off deletes it. Never older than the offline delay, and
 * never "targeted": record-next-session is a live decision the server makes
 * again when the connection is back.
 */
interface CachedReplayConfig {
  savedAtUnixMs: number;
  config: ResolvedReplayConfig;
}

export function replayConfigCacheKey(namespace: string): string {
  return `@oneuptime/replay/${namespace}/config`;
}

export async function saveReplayConfig(
  storage: ReplayStorage,
  namespace: string,
  config: ResolvedReplayConfig,
  nowUnixMs: number,
): Promise<void> {
  try {
    if (!config.enabled) {
      await storage.removeItem(replayConfigCacheKey(namespace));
      return;
    }

    const cached: CachedReplayConfig = {
      savedAtUnixMs: nowUnixMs,
      config: { ...config, isTargeted: false },
    };
    await storage.setItem(
      replayConfigCacheKey(namespace),
      JSON.stringify(cached),
    );
  } catch {
    /* A policy that is not cached only means an offline launch does not record. */
  }
}

/* Consent withdrawn: nothing of the recorder's stays on the device. */
export async function forgetReplayConfig(
  storage: ReplayStorage,
  namespace: string,
): Promise<void> {
  try {
    await storage.removeItem(replayConfigCacheKey(namespace));
  } catch {
    /* Best-effort privacy cleanup. */
  }
}

export async function loadCachedReplayConfig(
  storage: ReplayStorage,
  namespace: string,
  nowUnixMs: number,
): Promise<ResolvedReplayConfig | null> {
  try {
    const raw: string | null = await storage.getItem(
      replayConfigCacheKey(namespace),
    );
    if (!raw) {
      return null;
    }

    const cached: Partial<CachedReplayConfig> = JSON.parse(
      raw,
    ) as Partial<CachedReplayConfig>;
    const age: number = nowUnixMs - Number(cached.savedAtUnixMs);
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > SESSION_REPLAY_MAX_OFFLINE_DELAY_MS ||
      !cached.config ||
      typeof cached.config !== "object"
    ) {
      return null;
    }

    /* Re-validated like a fresh response: storage is not trusted. */
    const config: ResolvedReplayConfig = normalizeReplayConfig({
      ...cached.config,
      directive: cached.config.enabled === true ? "continue" : "stop",
      isTargeted: false,
    });
    return config.enabled ? config : null;
  } catch {
    return null;
  }
}

export async function fetchReplayConfig(
  options: ValidatedStartOptions,
  includeUserRef: boolean = false,
  revalidate: boolean = false,
): Promise<ResolvedReplayConfig> {
  const controller: AbortController | null =
    typeof AbortController === "undefined" ? null : new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    const request: Promise<ResolvedReplayConfig> =
      (async (): Promise<ResolvedReplayConfig> => {
        const headers: Record<string, string> = {
          ...mobileRequestHeaders(options, includeUserRef),
          Accept: "application/json",
        };
        if (revalidate) {
          headers["Cache-Control"] = "no-cache";
          headers["Pragma"] = "no-cache";
        }
        const requestInit: NonNullable<Parameters<ReplayFetch>[1]> = {
          method: "GET",
          headers,
        };
        if (controller) {
          requestInit.signal = controller.signal;
        }
        const response: ReplayFetchResponse = await options.fetch(
          `${options.host}${CONFIG_PATH}`,
          requestInit,
        );

        if (!response.ok) {
          return failClosed(`config-http-${response.status}`);
        }

        return normalizeReplayConfig(await response.json());
      })();
    const deadline: Promise<never> = new Promise<never>(
      (
        _resolve: (value: never | PromiseLike<never>) => void,
        reject: (reason?: unknown) => void,
      ): void => {
        timeout = setTimeout((): void => {
          controller?.abort();
          reject(new Error("config-fetch-timeout"));
        }, CONFIG_FETCH_TIMEOUT_MS);
      },
    );
    return await Promise.race([request, deadline]);
  } catch {
    return failClosed("config-fetch-failed");
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
