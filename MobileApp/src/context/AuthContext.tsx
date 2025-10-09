import React, { createContext, useCallback, useMemo, useState } from "react";
import * as AuthAPI from "@/api/auth";
import { clearSession } from "@/api/client";
import { User } from "@/types/models";

export interface PendingTwoFactor {
  totpDevices: AuthAPI.TotpAuthDevice[];
  webAuthnDevices: AuthAPI.WebAuthnDevice[];
  interimData: Record<string, unknown>;
}

export interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  pendingTwoFactor: PendingTwoFactor | null;
  login: (email: string, password: string) => Promise<AuthAPI.LoginResult>;
  verifyTotp: (code: string, twoFactorAuthId: string) => Promise<User>;
  logout: () => Promise<void>;
  cancelTwoFactor: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

export const AuthProvider = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [pendingTwoFactor, setPendingTwoFactor] =
    useState<PendingTwoFactor | null>(null);

  const login = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      try {
        const result = await AuthAPI.login({ email, password });

        if (result.status === "success") {
          setUser(result.user);
          setPendingTwoFactor(null);
        } else {
          setPendingTwoFactor({
            totpDevices: result.totpDevices,
            webAuthnDevices: result.webAuthnDevices,
            interimData: result.interimData,
          });
        }

        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const verifyTotp = useCallback(
    async (code: string, twoFactorAuthId: string) => {
      if (!pendingTwoFactor) {
        throw new Error("Two-factor authentication is not pending.");
      }

      setIsLoading(true);
      try {
        const userResponse = await AuthAPI.verifyTotp({
          code,
          twoFactorAuthId,
          interimData: pendingTwoFactor.interimData,
        });

        setUser(userResponse);
        setPendingTwoFactor(null);

        return userResponse;
      } finally {
        setIsLoading(false);
      }
    },
    [pendingTwoFactor],
  );

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await AuthAPI.logout();
    } catch (_) {
      // ignore logout errors; we'll clear client state regardless
    } finally {
      await clearSession();
      setUser(null);
      setPendingTwoFactor(null);
      setIsLoading(false);
    }
  }, []);

  const cancelTwoFactor = useCallback(() => {
    setPendingTwoFactor(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      pendingTwoFactor,
      login,
      verifyTotp,
      logout,
      cancelTwoFactor,
    }),
    [user, isLoading, pendingTwoFactor, login, verifyTotp, logout, cancelTwoFactor],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
