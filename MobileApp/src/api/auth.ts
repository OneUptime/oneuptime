import axios, { AxiosResponse } from "axios";
import apiClient from "./client";
import { getServerUrl } from "../storage/serverUrl";
import {
  storeTokens,
  clearTokens,
  type StoredTokens,
} from "../storage/keychain";

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: {
    _id: string;
    email: string;
    name: string;
    isMasterAdmin: boolean;
  };
  twoFactorRequired?: boolean;
}

export async function validateServerUrl(url: string): Promise<boolean> {
  try {
    const response: AxiosResponse = await axios.get(`${url}/api/status`, {
      timeout: 10000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const serverUrl: string = await getServerUrl();

  const response: AxiosResponse = await apiClient.post(
    `${serverUrl}/identity/login`,
    {
      data: {
        email: {
          _type: "Email",
          value: email,
        },
        password: {
          _type: "HashedString",
          value: password,
        },
      },
    },
    {
      // Don't use the interceptor's baseURL for login
      baseURL: "",
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responseData: any = response.data;

  // Check if 2FA is required
  if (
    responseData._miscData?.totpAuthList ||
    responseData._miscData?.webAuthnList
  ) {
    return {
      ...responseData,
      twoFactorRequired: true,
      accessToken: "",
      refreshToken: "",
      refreshTokenExpiresAt: "",
      user: responseData.data || {},
    };
  }

  const { accessToken, refreshToken, refreshTokenExpiresAt } =
    responseData._miscData || {};

  if (accessToken && refreshToken) {
    await storeTokens({
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
    });
  }

  return {
    accessToken,
    refreshToken,
    refreshTokenExpiresAt,
    user: responseData.data || {},
  };
}

export async function logout(): Promise<void> {
  try {
    const serverUrl: string = await getServerUrl();
    const { getTokens } = await import("../storage/keychain");
    const tokens: StoredTokens | null = await getTokens();

    if (tokens?.refreshToken) {
      await apiClient.post(
        `${serverUrl}/identity/logout`,
        { refreshToken: tokens.refreshToken },
        { baseURL: "" },
      );
    }
  } catch {
    // Logout failures should not block the flow
  } finally {
    await clearTokens();
  }
}
