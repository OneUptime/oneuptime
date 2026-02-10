import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { getTokens, clearTokens } from "../storage/keychain";
import { hasServerUrl } from "../storage/serverUrl";
import {
  login as apiLogin,
  logout as apiLogout,
  LoginResponse,
} from "../api/auth";
import { setOnAuthFailure } from "../api/client";
import { unregisterPushToken } from "./usePushNotifications";

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

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): React.JSX.Element {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [needsServerUrl, setNeedsServerUrl] = useState(false);
  const [user, setUser] = useState<LoginResponse["user"] | null>(null);

  useEffect(() => {
    const checkAuth = async (): Promise<void> => {
      try {
        const hasUrl = await hasServerUrl();
        if (!hasUrl) {
          setNeedsServerUrl(true);
          setIsLoading(false);
          return;
        }

        const tokens = await getTokens();
        if (tokens?.accessToken) {
          setIsAuthenticated(true);
        }
      } catch {
        // If anything fails, user needs to re-authenticate
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  // Register auth failure handler for 401 interceptor
  useEffect(() => {
    setOnAuthFailure(() => {
      setIsAuthenticated(false);
      setUser(null);
    });
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResponse> => {
      const response = await apiLogin(email, password);

      if (!response.twoFactorRequired && response.accessToken) {
        setIsAuthenticated(true);
        setUser(response.user);
      }

      return response;
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    await unregisterPushToken();
    await apiLogout();
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
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
