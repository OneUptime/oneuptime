import axios, {
  AxiosHeaders,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import * as SecureStore from "expo-secure-store";
import config from "@/utils/config";
import { mergeCookies, parseSetCookieHeader } from "@/utils/cookies";

const COOKIE_STORAGE_KEY = "oneuptime:session-cookie";

let tenantId: string | null = null;

const withInterceptors = (instance: AxiosInstance): AxiosInstance => {
  instance.interceptors.request.use(async (request: InternalAxiosRequestConfig) => {
    const cookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
    if (cookie) {
      const headers = request.headers ?? new AxiosHeaders();
      headers.set("Cookie", cookie);
      request.headers = headers;
    }

    request.withCredentials = true;

    if (tenantId) {
      const headers = request.headers ?? new AxiosHeaders();
      headers.set("tenantid", tenantId);
      request.headers = headers;
    }

    return request;
  });

  instance.interceptors.response.use(
    async (response: AxiosResponse) => {
      const setCookieHeader =
        (response.headers["set-cookie"] as string[] | string | undefined) ||
        (response.headers["Set-Cookie"] as string[] | string | undefined);

      const latestCookie = parseSetCookieHeader(setCookieHeader);

      if (latestCookie) {
        const existingCookie = await SecureStore.getItemAsync(
          COOKIE_STORAGE_KEY,
        );

        const merged = mergeCookies(existingCookie, latestCookie);

        if (merged) {
          await SecureStore.setItemAsync(COOKIE_STORAGE_KEY, merged);
        }
      }

      return response;
    },
    async (error: unknown) => {
      const axiosError = error as { response?: { status?: number } };
      if (axiosError?.response?.status === 401) {
        await SecureStore.deleteItemAsync(COOKIE_STORAGE_KEY).catch(() => null);
      }

      return Promise.reject(error);
    },
  );

  return instance;
};

export const appClient = withInterceptors(
  axios.create({
    baseURL: config.appApiUrl,
    timeout: 30000,
  }),
);

export const identityClient = withInterceptors(
  axios.create({
    baseURL: config.identityApiUrl,
    timeout: 30000,
  }),
);

export const clearSession = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(COOKIE_STORAGE_KEY).catch(() => null);
};

export const setTenantId = (id: string | null): void => {
  tenantId = id;
};
