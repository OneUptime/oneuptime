import { identityClient } from "@/api/client";
import { User } from "@/types/models";

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TotpAuthDevice {
  id: string;
  name: string;
}

export interface WebAuthnDevice {
  id: string;
  name: string;
}

export type LoginResult =
  | {
      status: "success";
      user: User;
      token?: string;
    }
  | {
      status: "2fa";
      totpDevices: TotpAuthDevice[];
      webAuthnDevices: WebAuthnDevice[];
      interimData: Record<string, unknown>;
    };

const mapUser = (rawUser: any): User => {
  return {
    id: rawUser._id || rawUser.id,
    _id: rawUser._id || rawUser.id,
    email: rawUser.email,
    name: rawUser.name,
    timezone: rawUser.timezone,
    isMasterAdmin: rawUser.isMasterAdmin,
    profilePictureId: rawUser.profilePictureId,
  };
};

export const login = async ({ email, password }: LoginRequest): Promise<LoginResult> => {
  const response = await identityClient.post("/login", {
    data: {
      email,
      password,
    },
  });

  const payload = response.data as Record<string, unknown>;
  const miscData = (payload["_miscData"] as Record<string, unknown>) || {};

  if (
    Array.isArray(miscData?.totpAuthList) &&
    (miscData.totpAuthList as Array<Record<string, unknown>>).length > 0
  ) {
    const totpDevices = (miscData.totpAuthList as Array<Record<string, unknown>>).map((device) => ({
      id: (device["_id"] as string) || (device["id"] as string),
      name: (device["name"] as string) || "Authenticator",
    }));

    const webAuthnDevices = Array.isArray(miscData?.webAuthnList)
      ? (miscData.webAuthnList as Array<Record<string, unknown>>).map((device) => ({
          id: (device["_id"] as string) || (device["id"] as string),
          name: (device["name"] as string) || "Security Key",
        }))
      : [];

    return {
      status: "2fa",
      totpDevices,
      webAuthnDevices,
      interimData: {
        email,
        password,
        miscData,
      },
    };
  }

  return {
    status: "success",
    user: mapUser(payload),
    token: (miscData?.token as string | undefined) || undefined,
  };
};

export const verifyTotp = async (data: {
  code: string;
  twoFactorAuthId: string;
  interimData: Record<string, unknown>;
}): Promise<User> => {
  const { code, interimData, twoFactorAuthId } = data;

  const response = await identityClient.post("/verify-totp-auth", {
    data: {
      ...(interimData || {}),
      code,
      twoFactorAuthId,
    },
  });

  const payload = response.data;
  return mapUser(payload);
};

export const logout = async (): Promise<void> => {
  try {
    await identityClient.post("/logout", { data: {} });
  } catch (_) {
    // no-op
  }
};
