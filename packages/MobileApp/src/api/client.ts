import axios, {
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
  AxiosError,
} from "axios";
import { getServerUrl } from "../storage/serverUrl";
import {
  getCachedAccessToken,
  getTokens,
  storeTokens,
  clearTokens,
  type StoredTokens,
} from "../storage/keychain";
import {
  getCachedGlobalSsoToken,
  getCachedSsoTokens,
} from "../storage/ssoTokens";
import { clearProjectSsoDenial, markProjectSsoDenied } from "../sso/ssoDenials";
import { recordProjectPermissions } from "./projectPermissions";
import {
  forgetInactivityReportedBy,
  getRenewalReport,
  onUserActivity,
  type RenewalReport,
} from "../auth/userActivity";
import { decodeJwtPayload } from "../utils/jwt";

/**
 * Recursively normalizes OneUptime API serialized types in response data.
 * Converts { _type: "ObjectID", value: "uuid" } → "uuid"
 * Converts { _type: "DateTime", value: "iso-string" } → "iso-string"
 */
function normalizeResponseData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(normalizeResponseData);
  }

  if (typeof data === "object") {
    const obj: Record<string, unknown> = data as Record<string, unknown>;

    // Check for serialized OneUptime types
    if (
      typeof obj["_type"] === "string" &&
      Object.prototype.hasOwnProperty.call(obj, "value") &&
      (obj["_type"] === "ObjectID" ||
        obj["_type"] === "DateTime" ||
        obj["_type"] === "Markdown")
    ) {
      return normalizeResponseData(obj["value"]);
    }

    const normalized: Record<string, unknown> = {};
    for (const key in obj) {
      /*
       * defineProperty rather than `normalized[key] = ...`. A plain assignment
       * to the key "__proto__" does not create an own property at all: it hits
       * the accessor Object.prototype defines under that name. A response field
       * the server really did call __proto__ would therefore disappear from the
       * rebuilt row, and - when its value is an object - become the rebuilt
       * row's PROTOTYPE instead, so that object's keys leak back in as
       * inherited properties of every read of the row. defineProperty always
       * writes a plain own data property, whatever the key is named, so the
       * caller reads back exactly what the server sent.
       */
      Object.defineProperty(normalized, key, {
        value: normalizeResponseData(obj[key]),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return normalized;
  }

  return data;
}

/**
 * One request that met a 401 while a token refresh was already in flight, and
 * is parked until that refresh has an answer.
 *
 * BOTH halves are kept, not just the resolve half. A refresh fails routinely -
 * the refresh token expired, the handset is offline, the server 500s - and a
 * queue that only knows how to hand out a new token has nothing to do with its
 * waiters when that happens, so every parked request stays pending forever:
 * the screen awaiting one spins until it is unmounted, with no error to catch
 * and no empty state to fall back to.
 */
interface RefreshWaiter {
  onRefreshed: (newToken: string) => void;
  onRefreshFailed: () => void;
}

let isRefreshing: boolean = false;
let refreshSubscribers: Array<RefreshWaiter> = [];
let onAuthFailure: (() => void) | null = null;

// The renewal in flight, whichever way it started; settled when it is over.
let renewalInFlight: Promise<void> | null = null;

// When the last renewal started, whichever way it started.
let lastRenewalStartedAtMs: number | null = null;

function subscribeTokenRefresh(waiter: RefreshWaiter): void {
  refreshSubscribers.push(waiter);
}

/*
 * Hand back the parked waiters and empty the queue in one step, so that every
 * path which settles them leaves nothing behind. A waiter that outlives its
 * own refresh is worse than a leak: this queue is module state that survives a
 * sign-out, and onTokenRefreshed replays whatever it finds - so a callback left
 * over from a failed refresh would be replayed, carrying the NEXT user's token,
 * against the previous user's request. Taking the array before settling
 * anything also keeps a request that re-parks out of the batch being drained.
 */
function takeRefreshSubscribers(): Array<RefreshWaiter> {
  const waiting: Array<RefreshWaiter> = refreshSubscribers;
  refreshSubscribers = [];
  return waiting;
}

function onTokenRefreshed(newToken: string): void {
  takeRefreshSubscribers().forEach((waiter: RefreshWaiter): void => {
    waiter.onRefreshed(newToken);
  });
}

function onRefreshFailed(): void {
  takeRefreshSubscribers().forEach((waiter: RefreshWaiter): void => {
    waiter.onRefreshFailed();
  });
}

export function setOnAuthFailure(callback: () => void): void {
  onAuthFailure = callback;
}

/*
 * A renewal is starting: requests that meet a 401 from now on wait for it
 * (isRefreshing), and so does a sign-out (waitForSessionRenewal). Returns
 * what ends it.
 */
function beginRenewal(nowMs: number): () => void {
  let settle: () => void = (): void => {
    return undefined;
  };

  isRefreshing = true;
  lastRenewalStartedAtMs = nowMs;
  renewalInFlight = new Promise<void>((resolve: () => void): void => {
    settle = resolve;
  });

  return (): void => {
    isRefreshing = false;
    renewalInFlight = null;
    settle();
  };
}

/*
 * Renews the session once, and resolves with its new access token: posts
 * the refresh token, and what the app knows of its person's use of it
 * (auth/userActivity: how long since they last used it, and the longest
 * time they went without since the last renewal), which the server's idle
 * timeout is decided from (issue #8187). A renewal that says nothing is
 * decided from the last renewal alone, and under the 15-minute idle
 * timeout that ended the session at every renewal, however much the app
 * was used. Once the server has taken the report, the time without use it
 * reported is forgotten. Rejects when the session was not renewed.
 *
 * Posted on the bare axios import, never through apiClient, so it cannot
 * recurse into its own 401 handling.
 */
async function renewSession(): Promise<string> {
  const tokens: StoredTokens | null = await getTokens();
  if (!tokens?.refreshToken) {
    throw new Error("No refresh token available");
  }

  const serverUrl: string = await getServerUrl();
  const reportedAtMs: number = Date.now();
  const report: RenewalReport = await getRenewalReport(reportedAtMs);

  const response: AxiosResponse = await axios.post(
    `${serverUrl}/identity/refresh-token`,
    {
      refreshToken: tokens.refreshToken,
      ...report,
    },
    {
      timeout: 10000,
    },
  );

  const { accessToken, refreshToken, refreshTokenExpiresAt } = response.data;

  await storeTokens({
    accessToken,
    refreshToken,
    refreshTokenExpiresAt,
  });

  forgetInactivityReportedBy(reportedAtMs);

  return accessToken;
}

/*
 * RENEWING A LITTLE BEFORE THE ACCESS TOKEN RUNS OUT, WHILE THE APP IS IN
 * USE.
 *
 * The 401 below renews a session whose token has run out, and that is
 * enough for the idle timeout: the renewal says how long since the app was
 * last used. But it renews only once a request has been refused, so the
 * server's record of the person's last activity lags up to a token's life
 * behind them, and each run-out costs a refused request and its replay. So
 * each time the person uses the app (onUserActivity), a token with less
 * than RENEW_AHEAD_WINDOW_MS left is renewed ahead. An app nobody touches
 * never renews ahead: its token runs out, and its next renewal says how
 * long it went unused.
 */
export const RENEW_AHEAD_WINDOW_MS: number = 2 * 60 * 1000;

/*
 * The least time between the start of one renewal and a renewal ahead: a
 * session near its end is handed tokens shorter than the window, and
 * renewing at every touch would spend a renewal on each.
 */
export const MIN_TIME_BETWEEN_RENEWALS_MS: number = 60 * 1000;

let expiryOfToken: { token: string; expiresAtMs: number | null } | null = null;

// When an access token runs out (its exp claim), in milliseconds, or null when it does not say.
function getAccessTokenExpiresAtMs(token: string): number | null {
  if (expiryOfToken?.token !== token) {
    const exp: unknown = decodeJwtPayload(token)?.exp;

    expiryOfToken = {
      token,
      expiresAtMs:
        typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null,
    };
  }

  return expiryOfToken.expiresAtMs;
}

// Whether the server said the session is over: the refresh itself was refused.
function isRenewalRefused(failure: unknown): boolean {
  return axios.isAxiosError(failure) && failure.response?.status === 401;
}

// The session is over: its tokens go, and the app goes back to its sign-in.
async function endSession(): Promise<void> {
  await clearTokens();
  if (onAuthFailure) {
    onAuthFailure();
  }
}

/*
 * Renews the session now when its access token has less than
 * RENEW_AHEAD_WINDOW_MS left (or has run out), nothing is renewing it
 * already, and no renewal started in the last MIN_TIME_BETWEEN_RENEWALS_MS.
 * Resolves once that renewal is over, or is null when none started. Called
 * at each use of the app.
 *
 * Requests that meet a 401 meanwhile wait for it, as for any renewal. When
 * the server refuses it, the session is over, as when the 401 below is
 * refused. When it gets no answer - no signal, a server restarting - the
 * session is left as it is and the next request decides, unless a request
 * is already waiting on it with a 401: then it ends as that request's own
 * renewal would have.
 */
export function renewSessionAheadOfExpiry(
  nowMs: number = Date.now(),
): Promise<void> | null {
  if (isRefreshing) {
    return null;
  }

  const accessToken: string | null = getCachedAccessToken();

  if (!accessToken) {
    return null;
  }

  const expiresAtMs: number | null = getAccessTokenExpiresAtMs(accessToken);

  if (expiresAtMs === null || expiresAtMs - nowMs > RENEW_AHEAD_WINDOW_MS) {
    return null;
  }

  if (
    lastRenewalStartedAtMs !== null &&
    nowMs >= lastRenewalStartedAtMs &&
    nowMs - lastRenewalStartedAtMs < MIN_TIME_BETWEEN_RENEWALS_MS
  ) {
    return null;
  }

  const endRenewal: () => void = beginRenewal(nowMs);

  return (async (): Promise<void> => {
    try {
      onTokenRefreshed(await renewSession());
    } catch (failure: unknown) {
      if (isRenewalRefused(failure) || refreshSubscribers.length > 0) {
        onRefreshFailed();

        try {
          await endSession();
        } catch {
          // Its tokens could not be removed: its next request is refused all the same.
        }
      }
    } finally {
      endRenewal();
    }
  })();
}

onUserActivity((atMs: number): void => {
  void renewSessionAheadOfExpiry(atMs);
});

/*
 * Resolves once no renewal is in flight. A sign-out waits for one: the
 * renewal rotates the refresh token, and a sign-out that sent the token it
 * replaced would leave the renewed session signed in on the server.
 */
export async function waitForSessionRenewal(): Promise<void> {
  if (renewalInFlight) {
    await renewalInFlight;
  }
}

// Forgets when the last renewal started. For tests.
export function resetSessionRenewalForTests(): void {
  lastRenewalStartedAtMs = null;
  expiryOfToken = null;
}

const apiClient: AxiosInstance = axios.create({
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor: attach base URL and Bearer token
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (!config.baseURL) {
      config.baseURL = await getServerUrl();
    }

    const token: string | null = getCachedAccessToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const ssoTokens: Record<string, string> = getCachedSsoTokens();
    if (Object.keys(ssoTokens).length > 0 && config.headers) {
      config.headers["x-sso-tokens"] = JSON.stringify(ssoTokens);
    }

    const globalSsoToken: string | null = getCachedGlobalSsoToken();
    if (globalSsoToken && config.headers) {
      config.headers["x-global-sso-token"] = globalSsoToken;
    }

    return config;
  },
);

/*
 * Axios stores a header under whatever casing the caller wrote, so a raw index
 * read only finds `tenantid` and would silently miss a `tenantId` written in
 * the natural camelCase - turning a 406 into a recorded-nothing dead end, the
 * exact state this feature exists to remove. AxiosHeaders.get() is
 * case-insensitive; fall back to a manual scan for a plain object.
 */
function readTenantId(config: InternalAxiosRequestConfig | undefined): string {
  const headers: unknown = config?.headers;

  if (!headers || typeof headers !== "object") {
    return "";
  }

  const getter: unknown = (headers as { get?: unknown }).get;

  if (typeof getter === "function") {
    const value: unknown = (getter as (name: string) => unknown).call(
      headers,
      "tenantid",
    );

    return typeof value === "string" ? value : "";
  }

  for (const key of Object.keys(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === "tenantid") {
      const value: unknown = (headers as Record<string, unknown>)[key];
      return typeof value === "string" ? value : "";
    }
  }

  return "";
}

// Response interceptor: normalize OneUptime serialized types then handle 401
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    response.data = normalizeResponseData(response.data);

    /*
     * A successful response is the server's LATER word about this project, so
     * it retires any earlier SSO refusal. Without this, a denial recorded
     * before an admin re-enabled the provider would keep the project showing
     * "Authenticate with SSO" for the rest of the session even though its
     * requests are now succeeding.
     */
    const tenantId: string = readTenantId(response.config);

    if (tenantId) {
      clearProjectSsoDenial(tenantId);

      // The person's permission rows in the project (api/projectPermissions).
      recordProjectPermissions(tenantId, response.headers);
    }

    return response;
  },
  async (error: AxiosError) => {
    const originalRequest: InternalAxiosRequestConfig & {
      _retry?: boolean;
    } = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    /*
     * 406 is ExceptionCode.SsoAuthorizationException - the server saying this
     * project needs an SSO login the caller has not completed (or no longer
     * has: the token expired, or the provider was disabled). Record it against
     * the project so the UI can offer the fix, instead of every screen
     * separately rendering "SSO Authorization Required" with nothing to press.
     */
    if (error.response?.status === 406) {
      const tenantId: string = readTenantId(originalRequest);

      if (tenantId) {
        markProjectSsoDenied(tenantId);
      }
    }

    /*
     * A refusal about a project carries the person's rows there too, once
     * the server knows who they are.
     */
    if (error.response) {
      const tenantId: string = readTenantId(originalRequest);

      if (tenantId) {
        recordProjectPermissions(tenantId, error.response.headers);
      }
    }

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<AxiosResponse>(
        (
          resolve: (value: AxiosResponse) => void,
          reject: (reason: unknown) => void,
        ): void => {
          subscribeTokenRefresh({
            onRefreshed: (newToken: string): void => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
              }

              /*
               * Forwarded with .then rather than written as
               * `resolve(await apiClient(originalRequest))`. Awaiting inside
               * the executor puts the replay's failure into a callback nothing
               * is waiting on: this promise would never settle at all, so the
               * caller keeps spinning and the real error surfaces only as an
               * unhandled rejection. Passing both outcomes on hands the caller
               * the same thing an unqueued request would have got.
               */
              apiClient(originalRequest).then(resolve, reject);
            },

            /*
             * The refresh came back empty-handed, so there is no token to
             * replay with and this request is finished. It rejects with its OWN
             * 401 - exactly what the request that happened to drive the refresh
             * is rejected with below - so no caller has to know, or can tell,
             * whether it was the one that led or one of the ones that queued.
             */
            onRefreshFailed: (): void => {
              reject(error);
            },
          });
        },
      );
    }

    originalRequest._retry = true;
    const endRenewal: () => void = beginRenewal(Date.now());

    try {
      const accessToken: string = await renewSession();

      onTokenRefreshed(accessToken);

      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      }

      return apiClient(originalRequest);
    } catch {
      /*
       * Settled first, before anything else in this handler: clearTokens
       * touches storage and can reject on its own, and onAuthFailure runs
       * arbitrary caller code. Either of those throwing after the queue had
       * been left holding waiters is the difference between every parked screen
       * showing an error and every parked screen spinning until the app is
       * killed.
       */
      onRefreshFailed();

      await endSession();
      return Promise.reject(error);
    } finally {
      endRenewal();
    }
  },
);

export default apiClient;
