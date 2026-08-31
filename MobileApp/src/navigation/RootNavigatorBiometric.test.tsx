import React from "react";
import { Text } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import RootNavigator from "./RootNavigator";
import { AuthProvider, useAuth } from "../hooks/useAuth";
import {
  login as apiLogin,
  logout as apiLogout,
  type LoginResponse,
} from "../api/auth";
import { hasServerUrl } from "../storage/serverUrl";
import { getTokens } from "../storage/keychain";
import {
  clearAllSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
} from "../storage/ssoTokens";
import { consumeInitialSsoCallbackUrl } from "../sso/deepLink";
import { unregisterPushToken } from "../hooks/pushTokenUtils";

/*
 * The biometric lock is the last thing between a found or borrowed handset and
 * a live on-call session, and RootNavigator is the only thing that decides
 * whether it is shown.
 *
 * Two pieces of state meet here and they have different lifetimes.
 * `biometric.isEnabled` is a DEVICE preference read from storage - it survives
 * a sign-out on purpose, because someone who turned the lock on wants the next
 * sign-in guarded too. `biometricPassed` is the record that this session's
 * user actually unlocked, and it is the only guard in front of
 * MainTabNavigator. If it outlives the session that earned it, the lock is
 * shown exactly once per process launch and never again - so a phone that is
 * signed out and signed back in, by the same person or by the next responder
 * on the rotation, walks straight into the dashboard. Phones are not
 * force-quit; that "process lifetime" is weeks.
 *
 * This file drives the real AuthProvider so the sign-out and the sign-in are
 * the ones the app performs, not a hand-set boolean. Everything else is a
 * stand-in: the two navigators and the lock screen are stubs, because what is
 * under test is WHICH of the three RootNavigator renders, and mounting the
 * real tab navigator would drag every screen and query in the app into a test
 * about one flag.
 *
 * The suite runs under both the ios and android Jest projects, which is the
 * point - the lock is the same promise to the user on both.
 */

jest.mock("./MainTabNavigator", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function MainTabNavigatorStub(): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "main-tabs" },
        "signed in",
      );
    },
  };
});

jest.mock("./AuthStackNavigator", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function AuthStackNavigatorStub(): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "auth-stack" },
        "signed out",
      );
    },
  };
});

/*
 * The stub stands in for the real lock screen's successful unlock: pressing it
 * is what the Face ID prompt resolving successfully does. The real screen's
 * own behaviour (prompting on mount, refusing to call onSuccess on a failed
 * scan) belongs to BiometricLockScreen, not here.
 */
jest.mock("../screens/BiometricLockScreen", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual("react-native") as {
    Text: React.ComponentType<Record<string, unknown>>;
  };

  return {
    __esModule: true,
    default: function BiometricLockScreenStub({
      onSuccess,
    }: {
      onSuccess: () => void;
    }): React.JSX.Element {
      return ReactModule.createElement(
        TextComponent,
        { testID: "biometric-lock", onPress: onSuccess },
        "locked",
      );
    },
  };
});

/*
 * The device says the lock is switched on, for every test in this file. That
 * is the whole premise: a preference that outlives the session it was read
 * for.
 */
jest.mock("../hooks/useBiometric", () => {
  return {
    useBiometric: () => {
      return {
        isAvailable: true,
        isEnabled: true,
        biometricType: "Face ID",
        authenticate: jest.fn(),
        setEnabled: jest.fn(),
      };
    },
  };
});

/*
 * Push registration reads useProject and talks to the network on every auth
 * change; none of that is what this file is about.
 */
jest.mock("../hooks/usePushNotifications", () => {
  return {
    usePushNotifications: jest.fn(),
  };
});

jest.mock("../notifications/handlers", () => {
  return {
    processPendingNotification: jest.fn(),
    setNavigationRef: jest.fn(),
    handleNotificationResponse: jest.fn(),
  };
});

jest.mock("expo-splash-screen", () => {
  return {
    hideAsync: jest.fn(),
    preventAutoHideAsync: jest.fn(),
  };
});

jest.mock("expo-linking", () => {
  return {
    createURL: () => {
      return "oneuptime://";
    },
  };
});

jest.mock("../api/auth", () => {
  return {
    login: jest.fn(),
    logout: jest.fn(),
  };
});

jest.mock("../storage/serverUrl", () => {
  return {
    hasServerUrl: jest.fn(),
  };
});

jest.mock("../storage/keychain", () => {
  return {
    getTokens: jest.fn(),
  };
});

jest.mock("../storage/ssoTokens", () => {
  return {
    getSsoTokens: jest.fn(),
    getGlobalSsoToken: jest.fn(),
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
  return {
    completeSsoLoginFromUrl: jest.fn(),
  };
});

jest.mock("../api/client", () => {
  return {
    __esModule: true,
    default: { post: jest.fn(), get: jest.fn() },
    setOnAuthFailure: jest.fn(),
  };
});

jest.mock("../hooks/pushTokenUtils", () => {
  return {
    PUSH_TOKEN_KEY: "oneuptime_expo_push_token",
    unregisterPushToken: jest.fn(),
  };
});

const STORED_TOKENS: {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
} = {
  accessToken: "stored-access",
  refreshToken: "stored-refresh",
  refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
};

/*
 * The account that signs in second is deliberately a DIFFERENT one: handing
 * the phone over at the end of a shift is the case that matters most, and the
 * lock has to stand between the two of them.
 */
const NEXT_RESPONDER: LoginResponse["user"] = {
  _id: "user-2",
  email: "next-responder@example.com",
  name: "Next Responder",
  isMasterAdmin: false,
};

function apiLoginSpy(): jest.Mock {
  return apiLogin as unknown as jest.Mock;
}

function apiLogoutSpy(): jest.Mock {
  return apiLogout as unknown as jest.Mock;
}

function hasServerUrlSpy(): jest.Mock {
  return hasServerUrl as unknown as jest.Mock;
}

function getTokensSpy(): jest.Mock {
  return getTokens as unknown as jest.Mock;
}

function getSsoTokensSpy(): jest.Mock {
  return getSsoTokens as unknown as jest.Mock;
}

function getGlobalSsoTokenSpy(): jest.Mock {
  return getGlobalSsoToken as unknown as jest.Mock;
}

function clearAllSsoTokensSpy(): jest.Mock {
  return clearAllSsoTokens as unknown as jest.Mock;
}

function consumeInitialSpy(): jest.Mock {
  return consumeInitialSsoCallbackUrl as unknown as jest.Mock;
}

function unregisterPushTokenSpy(): jest.Mock {
  return unregisterPushToken as unknown as jest.Mock;
}

type AuthValue = ReturnType<typeof useAuth>;

const authProbe: { current: AuthValue | null } = { current: null };

/*
 * Sits inside the provider next to the navigator and publishes the context, so
 * a test can sign out and back in the way the app does rather than by poking
 * at state the navigator cannot see.
 */
function AuthProbe(): React.JSX.Element {
  const auth: AuthValue = useAuth();
  authProbe.current = auth;

  return (
    <Text testID="auth-probe">{auth.isLoading ? "loading" : "ready"}</Text>
  );
}

function currentAuth(): AuthValue {
  if (!authProbe.current) {
    throw new Error("AuthProvider was never rendered");
  }

  return authProbe.current;
}

/*
 * `render` is awaited because React 19's `act` is asynchronous, which makes
 * @testing-library/react-native return a promise here; not awaiting it leaves
 * the tree half-mounted and leaks into the next test.
 */
async function renderApp(): Promise<void> {
  await render(
    <AuthProvider>
      <AuthProbe />
      <RootNavigator />
    </AuthProvider>,
  );

  await waitFor((): void => {
    expect(authProbe.current?.isLoading).toBe(false);
  });
}

async function passTheLock(): Promise<void> {
  await waitFor((): void => {
    expect(screen.getByTestId("biometric-lock")).toBeTruthy();
  });

  await act(async (): Promise<void> => {
    fireEvent.press(screen.getByTestId("biometric-lock"));
  });

  await waitFor((): void => {
    expect(screen.getByTestId("main-tabs")).toBeTruthy();
  });
}

async function signOut(): Promise<void> {
  await act(async (): Promise<void> => {
    await currentAuth().logout();
  });

  await waitFor((): void => {
    expect(screen.getByTestId("auth-stack")).toBeTruthy();
  });
}

async function signInAsTheNextResponder(): Promise<void> {
  await act(async (): Promise<void> => {
    await currentAuth().login(NEXT_RESPONDER.email, "their-own-password");
  });
}

beforeEach(() => {
  authProbe.current = null;

  /* A configured server, a stored session, nothing waiting from SSO. */
  hasServerUrlSpy().mockResolvedValue(true as never);
  consumeInitialSpy().mockResolvedValue(null as never);
  getTokensSpy().mockResolvedValue(STORED_TOKENS as never);
  getSsoTokensSpy().mockResolvedValue({} as never);
  getGlobalSsoTokenSpy().mockResolvedValue(null as never);
  clearAllSsoTokensSpy().mockResolvedValue(undefined as never);
  apiLogoutSpy().mockResolvedValue(undefined as never);
  unregisterPushTokenSpy().mockResolvedValue(undefined as never);
  apiLoginSpy().mockResolvedValue({
    accessToken: "next-responders-access",
    refreshToken: "next-responders-refresh",
    user: NEXT_RESPONDER,
  } as never);
});

describe("RootNavigator with the biometric lock switched on", () => {
  test("an authenticated launch lands on the lock screen, not the app", async () => {
    await renderApp();

    await waitFor((): void => {
      expect(screen.getByTestId("biometric-lock")).toBeTruthy();
    });
    expect(screen.queryByTestId("main-tabs")).toBeNull();
  });

  test("unlocking hands the session over to the tab navigator", async () => {
    await renderApp();

    await passTheLock();

    expect(screen.queryByTestId("biometric-lock")).toBeNull();
  });

  test("signing out replaces the app with the auth stack", async () => {
    await renderApp();
    await passTheLock();

    await signOut();

    expect(screen.queryByTestId("main-tabs")).toBeNull();
    expect(screen.queryByTestId("biometric-lock")).toBeNull();
  });

  test("the next sign in is locked again rather than walking into the app", async () => {
    /*
     * The regression. Before the reset, the unlock above set a flag that
     * belonged to the process rather than to the session: `isEnabled` is still
     * true (it is a device preference) and `biometricPassed` was still true
     * too, so renderContent went straight to MainTabNavigator and the lock
     * screen never appeared again for the life of the app. Whoever signs in
     * next - here, a different account entirely - inherits an unlock they
     * never performed.
     */
    await renderApp();
    await passTheLock();
    await signOut();

    await signInAsTheNextResponder();

    await waitFor((): void => {
      expect(screen.getByTestId("biometric-lock")).toBeTruthy();
    });
    expect(screen.queryByTestId("main-tabs")).toBeNull();
  });

  test("the second user can unlock and get in on their own scan", async () => {
    /*
     * The reset must lock the next session, not brick it: the guard has to
     * open again for the person who actually passes it.
     */
    await renderApp();
    await passTheLock();
    await signOut();
    await signInAsTheNextResponder();

    await passTheLock();

    expect(screen.queryByTestId("biometric-lock")).toBeNull();
  });
});
