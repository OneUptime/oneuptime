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
import {
  clearAllSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
} from "../storage/ssoTokens";
import {
  consumeInitialSsoCallbackUrl,
  startSsoCallbackCapture,
  stopSsoCallbackCapture,
} from "../sso/deepLink";
import {
  completeSsoLoginFromUrl,
  type CompleteSsoLoginOutcome,
} from "../sso/session";
import { clearAllSsoDenials } from "../sso/ssoDenials";

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

  useEffect((): (() => void) => {
    /*
     * Start capturing `oneuptime://sso-callback` before anything else can
     * open a browser. The capture also drains the launch URL, which is how
     * the callback arrives when the OS killed the app while the user was at
     * their identity provider - common on Android under memory pressure.
     * Without this the completed login is simply lost.
     */
    startSsoCallbackCapture();

    const checkAuth: () => Promise<void> = async (): Promise<void> => {
      try {
        const hasUrl: boolean = await hasServerUrl();
        if (!hasUrl) {
          setNeedsServerUrl(true);
          setIsLoading(false);
          return;
        }

        /*
         * A callback waiting at launch means an SSO login completed while the
         * app was dead. Finish it here so the user lands signed in instead of
         * back on the login screen with no explanation.
         */
        const launchCallbackUrl: string | null =
          await consumeInitialSsoCallbackUrl();

        if (launchCallbackUrl) {
          const completed: CompleteSsoLoginOutcome =
            await completeSsoLoginFromUrl(launchCallbackUrl);

          if (completed.status === "success") {
            setIsAuthenticated(true);
            setIsLoading(false);
            return;
          }
        }

        const tokens: { accessToken: string; refreshToken: string } | null =
          await getTokens();
        if (tokens?.accessToken) {
          setIsAuthenticated(true);
        }

        // Initialize SSO token caches for the API client interceptor
        await getSsoTokens();
        await getGlobalSsoToken();
      } catch {
        // If anything fails, user needs to re-authenticate
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();

    return (): void => {
      stopSsoCallbackCapture();
    };
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
    /*
     * The denial set is module-scope and in-memory, so without this a project
     * the previous user was refused would still read as "needs SSO" for
     * whoever signs in next on the same handset.
     */
    clearAllSsoDenials();
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
