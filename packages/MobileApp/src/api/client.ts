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
    isRefreshing = true;

    try {
      const tokens: StoredTokens | null = await getTokens();
      if (!tokens?.refreshToken) {
        throw new Error("No refresh token available");
      }

      const serverUrl: string = await getServerUrl();
      const response: AxiosResponse = await axios.post(
        `${serverUrl}/identity/refresh-token`,
        {
          refreshToken: tokens.refreshToken,
        },
        {
          timeout: 10000,
        },
      );

      const { accessToken, refreshToken, refreshTokenExpiresAt } =
        response.data;

      await storeTokens({
        accessToken,
        refreshToken,
        refreshTokenExpiresAt,
      });

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

      await clearTokens();
      if (onAuthFailure) {
        onAuthFailure();
      }
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  },
);

export default apiClient;
