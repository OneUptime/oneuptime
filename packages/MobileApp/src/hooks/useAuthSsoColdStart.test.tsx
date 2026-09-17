import React from "react";
import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { AuthProvider, useAuth } from "./useAuth";
import {
  consumeInitialSsoCallbackUrl,
  startSsoCallbackCapture,
  stopSsoCallbackCapture,
} from "../sso/deepLink";
import { completeSsoLoginFromUrl } from "../sso/session";
import { hasServerUrl } from "../storage/serverUrl";
import { getTokens } from "../storage/keychain";
import {
  clearAllSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
} from "../storage/ssoTokens";
import { logout as apiLogout } from "../api/auth";
import { unregisterPushToken } from "./pushTokenUtils";
/*
 * Deliberately NOT mocked: the assertion below is about real denial state
 * surviving (or not) a sign-out, which a spy would not tell us.
 */
import { isProjectSsoDenied, markProjectSsoDenied } from "../sso/ssoDenials";

/*
 * AuthProvider is the only thing running when the app cold-starts, so it is
 * the only thing that can rescue an SSO login the OS interrupted.
 *
 * The sequence being pinned here: the user taps "Sign in with SSO", the OS
 * kills the app while they are at their identity provider (routine on Android
 * under memory pressure, and possible on iOS), the IdP redirects to
 * `oneuptime://sso-callback?...`, and the app is launched fresh by that URL.
 * Every promise that was waiting for the callback died with the old process.
 * If startup does not pick the URL up and finish the login, the tokens in it
 * are thrown away and the user is dropped back on the login screen having
 * just authenticated successfully - with no explanation, and no reason to
 * believe a second attempt will end differently.
 *
 * The collaborators are all mocked: this file is about the decisions
 * AuthProvider makes given each answer, not about how a callback URL is
 * parsed (callbackUrl.ts) or persisted (session.ts).
 *
 * Everything below is platform-independent by design and the suite runs under
 * both the ios and android Jest projects, which is the point - the cold-start
 * rescue has to behave identically on the platform where it happens most.
 */

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

jest.mock("../api/auth", () => {
  return {
    login: jest.fn(),
    logout: jest.fn(),
  };
});

/*
 * The provider only needs setOnAuthFailure from the client, but mocking the
 * module also keeps the real axios instance (and its interceptors) out of the
 * test entirely.
 */
jest.mock("../api/client", () => {
  return {
    __esModule: true,
    default: { post: jest.fn(), get: jest.fn() },
    setOnAuthFailure: jest.fn(),
  };
});

jest.mock("./pushTokenUtils", () => {
  return {
    PUSH_TOKEN_KEY: "oneuptime_expo_push_token",
    unregisterPushToken: jest.fn(),
  };
});

/*
 * A real global-SSO callback: the token payload lives in the query string, so
 * anything that mangles this URL on its way to session.ts silently loses the
 * login.
 */
const GLOBAL_CALLBACK_URL: string =
  "oneuptime://sso-callback?access_token=access-abc&refresh_token=refresh-abc" +
  "&refresh_token_expires_at=2030-01-01T00%3A00%3A00.000Z" +
  "&global_sso_token=global-sso-abc";

const STORED_TOKENS: {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
} = {
  accessToken: "stored-access",
  refreshToken: "stored-refresh",
  refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
};

function startCaptureSpy(): jest.SpyInstance {
  return startSsoCallbackCapture as unknown as jest.SpyInstance;
}

function stopCaptureSpy(): jest.SpyInstance {
  return stopSsoCallbackCapture as unknown as jest.SpyInstance;
}

function consumeInitialSpy(): jest.SpyInstance {
  return consumeInitialSsoCallbackUrl as unknown as jest.SpyInstance;
}

function completeLoginSpy(): jest.SpyInstance {
  return completeSsoLoginFromUrl as unknown as jest.SpyInstance;
}

function hasServerUrlSpy(): jest.SpyInstance {
  return hasServerUrl as unknown as jest.SpyInstance;
}

function getTokensSpy(): jest.SpyInstance {
  return getTokens as unknown as jest.SpyInstance;
}

function getSsoTokensSpy(): jest.SpyInstance {
  return getSsoTokens as unknown as jest.SpyInstance;
}

function getGlobalSsoTokenSpy(): jest.SpyInstance {
  return getGlobalSsoToken as unknown as jest.SpyInstance;
}

function clearAllSsoTokensSpy(): jest.SpyInstance {
  return clearAllSsoTokens as unknown as jest.SpyInstance;
}

function apiLogoutSpy(): jest.SpyInstance {
  return apiLogout as unknown as jest.SpyInstance;
}

function unregisterPushTokenSpy(): jest.SpyInstance {
  return unregisterPushToken as unknown as jest.SpyInstance;
}

type AuthValue = ReturnType<typeof useAuth>;

/*
 * The house pattern for reading a context: a child that renders inside the
 * provider, publishes whatever the context currently holds, and re-publishes
 * on every re-render so assertions always see the latest value.
 */
const authProbe: { current: AuthValue | null } = { current: null };

function AuthProbe(): React.JSX.Element {
  const auth: AuthValue = useAuth();
  authProbe.current = auth;

  return <Text>{auth.isLoading ? "loading" : "ready"}</Text>;
}

function currentAuth(): AuthValue {
  if (!authProbe.current) {
    throw new Error("AuthProvider was never rendered");
  }

  return authProbe.current;
}

interface RenderedProvider {
  unmount: () => Promise<void> | void;
}

/*
 * The startup check is asynchronous, so every test waits for it to settle
 * before asserting. `isLoading` going false is the provider saying "I have
 * decided" - EVERY startup path ends there, including the failure paths,
 * because a path that never clears it leaves the app stuck on the splash
 * screen forever.
 *
 * `render` is awaited because React 19's `act` is asynchronous, which makes
 * @testing-library/react-native return a promise here; not awaiting it leaves
 * the tree half-mounted and leaks into the next test.
 */
async function renderAuthProvider(): Promise<RenderedProvider> {
  const rendered: RenderedProvider = (await render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  )) as unknown as RenderedProvider;

  await waitFor((): void => {
    expect(authProbe.current?.isLoading).toBe(false);
  });

  return rendered;
}

beforeEach(() => {
  authProbe.current = null;

  // Defaults: a configured server, nothing waiting, nothing stored.
  hasServerUrlSpy().mockResolvedValue(true as never);
  consumeInitialSpy().mockResolvedValue(null as never);
  completeLoginSpy().mockResolvedValue({
    status: "success",
    isGlobal: true,
    projectId: null,
  } as never);
  getTokensSpy().mockResolvedValue(null as never);
  getSsoTokensSpy().mockResolvedValue({} as never);
  getGlobalSsoTokenSpy().mockResolvedValue(null as never);
  clearAllSsoTokensSpy().mockResolvedValue(undefined as never);
  apiLogoutSpy().mockResolvedValue(undefined as never);
  unregisterPushTokenSpy().mockResolvedValue(undefined as never);
});

describe("AuthProvider starts the SSO deep link capture at startup", () => {
  test("the capture starts on mount", async () => {
    /*
     * It has to be running before anything else can open a browser, and it is
     * also what drains the launch URL - so this is the call the whole
     * cold-start rescue hangs off.
     */
    await renderAuthProvider();

    expect(startCaptureSpy()).toHaveBeenCalled();
  });

  test("the capture starts even when the app has no server URL yet", async () => {
    /*
     * Starting the listener is unconditional on purpose: the callback can
     * arrive at any moment, and a listener that only starts once the app is
     * configured is a listener that is not there when it matters.
     */
    hasServerUrlSpy().mockResolvedValue(false as never);

    await renderAuthProvider();

    expect(startCaptureSpy()).toHaveBeenCalled();
  });

  test("the capture is torn down on unmount", async () => {
    /*
     * The listener is process-wide. Leaving it registered after the provider
     * is gone means a later callback is captured by a dead tree and consumed
     * where nobody can act on it.
     */
    const rendered: RenderedProvider = await renderAuthProvider();

    expect(stopCaptureSpy()).not.toHaveBeenCalled();

    await rendered.unmount();

    expect(stopCaptureSpy()).toHaveBeenCalled();
  });
});

describe("AuthProvider cold-started by a successful SSO callback", () => {
  beforeEach(() => {
    consumeInitialSpy().mockResolvedValue(GLOBAL_CALLBACK_URL as never);
    // Nothing was stored before: the process that started the login is gone.
    getTokensSpy().mockResolvedValue(null as never);
  });

  test("the launch URL is handed to the SSO session completer verbatim", async () => {
    /*
     * The tokens are IN the URL. Trimming, re-encoding or otherwise touching
     * it here would produce a callback that parses to nothing and a login
     * that fails for a reason nobody can see.
     */
    await renderAuthProvider();

    expect(completeLoginSpy()).toHaveBeenCalledWith(GLOBAL_CALLBACK_URL);
  });

  test("the user ends up signed in even though no tokens were stored before", async () => {
    /*
     * This is the entire bug being fixed. Before the cold-start handling, the
     * stored-token check was the only thing startup did, it found nothing,
     * and the freshly completed login was discarded.
     */
    await renderAuthProvider();

    expect(currentAuth().isAuthenticated).toBe(true);
  });

  test("startup finishes rather than hanging on the splash screen", async () => {
    await renderAuthProvider();

    expect(currentAuth().isLoading).toBe(false);
  });

  test("the app does not ask for a server URL it already has", async () => {
    await renderAuthProvider();

    expect(currentAuth().needsServerUrl).toBe(false);
  });

  test("a project-scoped callback signs the user in too", async () => {
    /*
     * Global SSO is what this work was for, but the same launch path carries a
     * project SSO callback. Treating only the global shape as a real login
     * would strand every project-SSO user whose app was killed mid-login.
     */
    completeLoginSpy().mockResolvedValue({
      status: "success",
      isGlobal: false,
      projectId: "project-1",
    } as never);

    await renderAuthProvider();

    expect(currentAuth().isAuthenticated).toBe(true);
  });
});

describe("AuthProvider cold-started by a callback that failed", () => {
  beforeEach(() => {
    consumeInitialSpy().mockResolvedValue(GLOBAL_CALLBACK_URL as never);
    completeLoginSpy().mockResolvedValue({
      status: "error",
      message: "SSO login failed",
    } as never);
  });

  test("the app does not claim to be signed in", async () => {
    /*
     * An error callback - a denied IdP assertion, a tampered URL, a token the
     * app could not store - must not be mistaken for a login. Claiming
     * authenticated here sends the user into a UI that 401s on every screen.
     */
    getTokensSpy().mockResolvedValue(null as never);

    await renderAuthProvider();

    expect(currentAuth().isAuthenticated).toBe(false);
  });

  test("it falls through to the stored-token check instead of stopping", async () => {
    /*
     * A failed SSO attempt says nothing about the session the user already
     * had. Signing them out of a perfectly good session because a re-auth
     * attempt failed would be a self-inflicted logout.
     */
    getTokensSpy().mockResolvedValue(STORED_TOKENS as never);

    await renderAuthProvider();

    expect(getTokensSpy()).toHaveBeenCalled();
    expect(currentAuth().isAuthenticated).toBe(true);
  });

  test("the SSO token caches are still primed on the failure path", async () => {
    getTokensSpy().mockResolvedValue(STORED_TOKENS as never);

    await renderAuthProvider();

    expect(getSsoTokensSpy()).toHaveBeenCalled();
    expect(getGlobalSsoTokenSpy()).toHaveBeenCalled();
  });

  test("startup still finishes", async () => {
    await renderAuthProvider();

    expect(currentAuth().isLoading).toBe(false);
  });
});

describe("AuthProvider starting up with no SSO callback waiting", () => {
  test("a stored access token means the user is still signed in", async () => {
    getTokensSpy().mockResolvedValue(STORED_TOKENS as never);

    await renderAuthProvider();

    expect(currentAuth().isAuthenticated).toBe(true);
  });

  test("no stored token means the user is not signed in", async () => {
    getTokensSpy().mockResolvedValue(null as never);

    await renderAuthProvider();

    expect(currentAuth().isAuthenticated).toBe(false);
  });

  test("an empty access token is not treated as a session", async () => {
    /*
     * The 2FA branch of the login API returns a token record with an empty
     * accessToken. Reading "a record exists" as "signed in" would walk a user
     * who never completed their second factor straight into the app.
     */
    getTokensSpy().mockResolvedValue({
      ...STORED_TOKENS,
      accessToken: "",
    } as never);

    await renderAuthProvider();

    expect(currentAuth().isAuthenticated).toBe(false);
  });

  test("nothing is completed when there is no callback to complete", async () => {
    await renderAuthProvider();

    expect(completeLoginSpy()).not.toHaveBeenCalled();
  });
});

describe("AuthProvider primes the SSO token caches at startup", () => {
  /*
   * The axios interceptor reads these caches SYNCHRONOUSLY on every request,
   * via getCachedSsoTokens()/getCachedGlobalSsoToken(). Nothing else fills
   * them after a cold start, so skipping this priming means the first
   * requests of every launch go out without x-sso-tokens or
   * x-global-sso-token and come back 406 from an SSO-enforced project.
   */
  test("the per-project cache is read", async () => {
    await renderAuthProvider();

    expect(getSsoTokensSpy()).toHaveBeenCalled();
  });

  test("the global SSO token cache is read", async () => {
    await renderAuthProvider();

    expect(getGlobalSsoTokenSpy()).toHaveBeenCalled();
  });

  test("they are primed for a signed-in user too", async () => {
    getTokensSpy().mockResolvedValue(STORED_TOKENS as never);

    await renderAuthProvider();

    expect(getSsoTokensSpy()).toHaveBeenCalled();
    expect(getGlobalSsoTokenSpy()).toHaveBeenCalled();
  });
});

describe("AuthProvider before a server URL is configured", () => {
  beforeEach(() => {
    hasServerUrlSpy().mockResolvedValue(false as never);
  });

  test("the app asks for the server URL", async () => {
    await renderAuthProvider();

    expect(currentAuth().needsServerUrl).toBe(true);
    expect(currentAuth().isAuthenticated).toBe(false);
  });

  test("no launch callback is consumed", async () => {
    /*
     * There is no server to reconcile a callback against, and consuming one
     * here would burn the URL - it can only be read once - leaving nothing to
     * finish the login with after the user finally enters their server URL.
     */
    await renderAuthProvider();

    expect(consumeInitialSpy()).not.toHaveBeenCalled();
    expect(completeLoginSpy()).not.toHaveBeenCalled();
  });

  test("no SSO token caches are touched", async () => {
    await renderAuthProvider();

    expect(getSsoTokensSpy()).not.toHaveBeenCalled();
    expect(getGlobalSsoTokenSpy()).not.toHaveBeenCalled();
  });
});

describe("AuthProvider when the startup checks throw", () => {
  test("a deep link read that blows up still lets the app start", async () => {
    /*
     * Linking.getInitialURL() can reject on a malformed launch intent. The
     * app must land on the login screen, not on a splash screen that never
     * goes away.
     */
    consumeInitialSpy().mockRejectedValue(new Error("bad launch intent"));

    await renderAuthProvider();

    expect(currentAuth().isLoading).toBe(false);
    expect(currentAuth().isAuthenticated).toBe(false);
  });

  test("a failed SSO completion still lets the app start", async () => {
    consumeInitialSpy().mockResolvedValue(GLOBAL_CALLBACK_URL as never);
    completeLoginSpy().mockRejectedValue(new Error("keychain unavailable"));

    await renderAuthProvider();

    expect(currentAuth().isLoading).toBe(false);
    expect(currentAuth().isAuthenticated).toBe(false);
  });
});

describe("AuthProvider logout", () => {
  beforeEach(() => {
    getTokensSpy().mockResolvedValue(STORED_TOKENS as never);
  });

  test("clears the SSO tokens along with the auth tokens", async () => {
    /*
     * The global SSO token outlives the access token by weeks (it is signed
     * for 30 days). Leaving it behind means the next person to use the handset
     * inherits a valid instance-wide SSO credential.
     */
    await renderAuthProvider();

    await act(async () => {
      await currentAuth().logout();
    });

    expect(apiLogoutSpy()).toHaveBeenCalled();
    expect(clearAllSsoTokensSpy()).toHaveBeenCalled();
  });

  test("unregisters the push token as well", async () => {
    await renderAuthProvider();

    await act(async () => {
      await currentAuth().logout();
    });

    expect(unregisterPushTokenSpy()).toHaveBeenCalled();
  });

  test("clears the recorded SSO denials, so they do not follow the next user", async () => {
    /*
     * The denial set is module-scope and in-memory, cleared only by a
     * successful SSO callback or by the process restarting. Without a clear on
     * sign-out, a project the PREVIOUS user was refused would still read as
     * "needs SSO" for whoever signs in next on the same handset - and that
     * user may need no SSO at all.
     */
    markProjectSsoDenied("project-from-the-previous-user");
    expect(isProjectSsoDenied("project-from-the-previous-user")).toBe(true);

    await renderAuthProvider();

    await act(async () => {
      await currentAuth().logout();
    });

    expect(isProjectSsoDenied("project-from-the-previous-user")).toBe(false);
  });

  test("the context reports the user as signed out afterwards", async () => {
    await renderAuthProvider();

    expect(currentAuth().isAuthenticated).toBe(true);

    await act(async () => {
      await currentAuth().logout();
    });

    expect(currentAuth().isAuthenticated).toBe(false);
    expect(currentAuth().user).toBeNull();
  });
});
