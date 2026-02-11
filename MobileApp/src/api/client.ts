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

    return config;
  },
);

// Response interceptor: handle 401 with token refresh queue
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
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
        subscribeTokenRefresh((newToken: string) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          resolve(apiClient(originalRequest));
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
