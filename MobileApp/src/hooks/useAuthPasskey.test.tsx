import React from "react";
import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { AuthProvider, useAuth } from "./useAuth";
import { signInWithPasskey, discardPasskeySession } from "../passkeys/signIn";
import { login as apiLogin, LoginResponse } from "../api/auth";

jest.mock("../passkeys/signIn", () => {
  return { signInWithPasskey: jest.fn(), discardPasskeySession: jest.fn() };
});
jest.mock("../api/auth", () => {
  return { login: jest.fn(), logout: jest.fn() };
});
jest.mock("../api/client", () => {
  return { setOnAuthFailure: jest.fn() };
});
jest.mock("../api/queryClient", () => {
  return { queryClient: { clear: jest.fn() } };
});
jest.mock("../storage/serverUrl", () => {
  return {
    hasServerUrl: async () => {
      return true;
    },
  };
});
jest.mock("../storage/keychain", () => {
  return {
    getTokens: async () => {
      return null;
    },
  };
});
jest.mock("../storage/ssoTokens", () => {
  return {
    getGlobalSsoToken: jest.fn(),
    getSsoTokens: jest.fn(),
    clearAllSsoTokens: jest.fn(),
  };
});
jest.mock("../sso/deepLink", () => {
  return {
    startSsoCallbackCapture: jest.fn(),
    stopSsoCallbackCapture: jest.fn(),
    consumeInitialSsoCallbackUrl: jest.fn(),
  };
});
jest.mock("../sso/session", () => {
  return { completeSsoLoginFromUrl: jest.fn() };
});
jest.mock("./pushTokenUtils", () => {
  return { unregisterPushToken: jest.fn() };
});

let auth: ReturnType<typeof useAuth>;
const session: LoginResponse = {
  accessToken: "access",
  refreshToken: "refresh",
  refreshTokenExpiresAt: "2027-01-01",
  user: {
    _id: "user-1",
    name: "Responder",
    email: "user@example.com",
    isMasterAdmin: false,
  },
};
function Probe(): React.JSX.Element {
  auth = useAuth();
  return <Text>{auth.isAuthenticated ? "signed in" : "signed out"}</Text>;
}
async function show(): Promise<void> {
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => {
    expect(auth.isLoading).toBe(false);
  });
}

test("publishes the passkey user and authenticated navigator only after completion", async () => {
  jest.mocked(signInWithPasskey).mockResolvedValue(session);
  await show();
  expect(auth.isAuthenticated).toBe(false);
  await act(async () => {
    await auth.loginWithPasskey({
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });
  });
  expect(auth.isAuthenticated).toBe(true);
  expect(auth.user).toEqual(session.user);
  expect(apiLogin).not.toHaveBeenCalled();
});

test("a canceled handoff never authenticates", async () => {
  jest.mocked(signInWithPasskey).mockResolvedValue(null);
  await show();
  await act(async () => {
    await auth.loginWithPasskey({
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });
  });
  expect(auth.isAuthenticated).toBe(false);
  expect(auth.user).toBeNull();
});

test("an aborted response cannot switch the navigator after the login screen leaves", async () => {
  const controller: AbortController = new AbortController();
  jest.mocked(signInWithPasskey).mockImplementation(async () => {
    controller.abort();
    return session;
  });
  await show();
  await act(async () => {
    await auth.loginWithPasskey({
      signal: controller.signal,
      onProgress: jest.fn(),
    });
  });
  expect(auth.isAuthenticated).toBe(false);
  expect(discardPasskeySession).toHaveBeenCalledWith("access");
});

test("starting passkey sign-in removes an abandoned password challenge from memory", async () => {
  jest.mocked(apiLogin).mockResolvedValue({
    ...session,
    accessToken: "",
    refreshToken: "",
    twoFactorRequired: true,
    totpAuthList: [{ _id: "totp-1", name: "Phone" }],
  });
  jest.mocked(signInWithPasskey).mockResolvedValue(null);
  await show();
  await act(async () => {
    await auth.login("user@example.com", "secret-password");
  });
  expect(auth.pendingTwoFactor?.password).toBe("secret-password");
  await act(async () => {
    await auth.loginWithPasskey({
      signal: new AbortController().signal,
      onProgress: jest.fn(),
    });
  });
  expect(auth.pendingTwoFactor).toBeNull();
  expect(auth.pendingBackupCodes).toBeNull();
  expect(auth.pendingLoginUserId).toBeNull();
  expect(auth.isAuthenticated).toBe(false);
});
