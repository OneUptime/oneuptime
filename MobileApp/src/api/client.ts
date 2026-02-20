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
import { getCachedSsoTokens } from "../storage/ssoTokens";

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
      normalized[key] = normalizeResponseData(obj[key]);
    }
    return normalized;
  }

  return data;
}

let isRefreshing: boolean = false;
let refreshSubscribers: Array<(token: string) => void> = [];
let onAuthFailure: (() => void) | null = null;

function subscribeTokenRefresh(callback: (token: string) => void): void {
  refreshSubscribers.push(callback);
}

function onTokenRefreshed(newToken: string): void {
  refreshSubscribers.forEach((callback: (token: string) => void) => {
    callback(newToken);
  });
  refreshSubscribers = [];
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

    return config;
  },
);

// Response interceptor: normalize OneUptime serialized types then handle 401
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    response.data = normalizeResponseData(response.data);
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest: InternalAxiosRequestConfig & {
      _retry?: boolean;
    } = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve: (value: AxiosResponse) => void) => {
        subscribeTokenRefresh(async (newToken: string) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          resolve(await apiClient(originalRequest));
        });
      });
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
