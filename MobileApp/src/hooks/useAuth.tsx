import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { getTokens } from "../storage/keychain";
import { hasServerUrl } from "../storage/serverUrl";
import {
  login as apiLogin,
  logout as apiLogout,
  LoginResponse,
} from "../api/auth";
import { setOnAuthFailure } from "../api/client";
import { unregisterPushToken } from "./pushTokenUtils";
import { clearAllSsoTokens, getSsoTokens } from "../storage/ssoTokens";

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  needsServerUrl: boolean;
  user: LoginResponse["user"] | null;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  setNeedsServerUrl: (value: boolean) => void;
  setIsAuthenticated: (value: boolean) => void;
}

const AuthContext: React.Context<AuthContextValue | undefined> = createContext<
  AuthContextValue | undefined
>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({
  children,
}: AuthProviderProps): React.JSX.Element {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [needsServerUrl, setNeedsServerUrl] = useState<boolean>(false);
  const [user, setUser] = useState<LoginResponse["user"] | null>(null);

  useEffect((): void => {
    const checkAuth: () => Promise<void> = async (): Promise<void> => {
      try {
        const hasUrl: boolean = await hasServerUrl();
        if (!hasUrl) {
          setNeedsServerUrl(true);
          setIsLoading(false);
          return;
        }

        const tokens: { accessToken: string; refreshToken: string } | null =
          await getTokens();
        if (tokens?.accessToken) {
          setIsAuthenticated(true);
        }

        // Initialize SSO token cache for the API client interceptor
        await getSsoTokens();
      } catch {
        // If anything fails, user needs to re-authenticate
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Register auth failure handler for 401 interceptor
  useEffect((): void => {
    setOnAuthFailure((): void => {
      setIsAuthenticated(false);
      setUser(null);
    });
  }, []);

  const login: (email: string, password: string) => Promise<LoginResponse> =
    useCallback(
      async (email: string, password: string): Promise<LoginResponse> => {
        const response: LoginResponse = await apiLogin(email, password);

        if (!response.twoFactorRequired && response.accessToken) {
          setIsAuthenticated(true);
          setUser(response.user);
        }

        return response;
      },
      [],
    );

  const logout: () => Promise<void> = useCallback(async (): Promise<void> => {
    await unregisterPushToken();
    await apiLogout();
    await clearAllSsoTokens();
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        needsServerUrl,
        user,
        login,
        logout,
        setNeedsServerUrl,
        setIsAuthenticated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context: AuthContextValue | undefined = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
