import React from "react";
import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import { AuthProvider, useAuth } from "./useAuth";
import { queryClient } from "../api/queryClient";
import { setOnAuthFailure } from "../api/client";
import { logout as apiLogout } from "../api/auth";
import { hasServerUrl } from "../storage/serverUrl";
import { getTokens } from "../storage/keychain";
import {
  clearAllSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
} from "../storage/ssoTokens";
import { consumeInitialSsoCallbackUrl } from "../sso/deepLink";
import { unregisterPushToken } from "./pushTokenUtils";
import {
  makeAlert,
  makeIncident,
  makeListResponse,
  makeNote,
} from "../__tests__/testSupport";
import type { AlertItem, IncidentItem, NoteItem } from "../api/types";

/*
 * Signing out has to end the SESSION, and the react-query cache is part of the
 * session whether or not it looks like it.
 *
 * A OneUptime handset is a shared object. It goes into a drawer at the end of a
 * shift and comes out again for whoever is on the rotation next, and that
 * person signs in as themselves on the same running process. Nothing in a
 * query key says which account fetched the rows underneath it - the keys are
 * ["alerts", "all-projects"], ["incidents", projectId, ...], ["incident-notes",
 * projectId, incidentId] - and the shared client keeps them for a 24 hour
 * gcTime because an on-call phone on a dead connection should still be able to
 * show the page that woke its owner. Put those two facts together and the next
 * responder is served the previous one's alerts, incidents and INTERNAL NOTES
 * the instant a screen mounts, before any refetch has come back. If the new
 * account cannot see those projects at all, the refetch fails and the stale
 * rows never go away.
 *
 * So these tests assert on the real shared client from ../api/queryClient -
 * not a test client - because being the same instance the app renders with is
 * the whole point of that module existing.
 *
 * The collaborators are stand-ins: what a sign-out posts and how tokens are
 * dropped belongs to auth.ts and the keychain, which have their own suites.
 */

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

/*
 * The provider only needs setOnAuthFailure from the client, but mocking the
 * module also keeps the real axios instance (and its interceptors) out of the
 * test entirely. The spy doubles as the only way to reach the 401 handler the
 * provider registers, which is what the last describe below drives.
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

const STORED_TOKENS: {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
} = {
  accessToken: "stored-access",
  refreshToken: "stored-refresh",
  refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
};

/* The keys the real hooks use, spelled out so a rename cannot quietly pass. */
const ALL_PROJECT_ALERTS_KEY: Array<string> = ["alerts", "all-projects"];
const PROJECT_INCIDENTS_KEY: Array<string | number> = [
  "incidents",
  "project-1",
  0,
  20,
];
const INCIDENT_NOTES_KEY: Array<string> = [
  "incident-notes",
  "project-1",
  "incident-1",
];

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

function apiLogoutSpy(): jest.Mock {
  return apiLogout as unknown as jest.Mock;
}

function unregisterPushTokenSpy(): jest.Mock {
  return unregisterPushToken as unknown as jest.Mock;
}

function consumeInitialSpy(): jest.Mock {
  return consumeInitialSsoCallbackUrl as unknown as jest.Mock;
}

function setOnAuthFailureSpy(): jest.Mock {
  return setOnAuthFailure as unknown as jest.Mock;
}

type AuthValue = ReturnType<typeof useAuth>;

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

/*
 * Fill the shared cache with the kind of rows a shift actually leaves behind:
 * the cross-project alert list the home screen holds, one project's incident
 * page, and the internal notes off an incident - the entry that makes this a
 * disclosure bug rather than a staleness bug.
 */
function seedPreviousUsersCache(): void {
  queryClient.setQueryData(
    ALL_PROJECT_ALERTS_KEY,
    makeListResponse<AlertItem>([
      makeAlert({ title: "Primary database is unreachable" }),
    ]),
  );
  queryClient.setQueryData(
    PROJECT_INCIDENTS_KEY,
    makeListResponse<IncidentItem>([makeIncident()]),
  );
  queryClient.setQueryData(
    INCIDENT_NOTES_KEY,
    makeListResponse<NoteItem>([
      makeNote({ note: "Failed over to the standby; do not page the CEO." }),
    ]),
  );
}

function cachedKeyCount(): number {
  return queryClient.getQueryCache().getAll().length;
}

/*
 * The startup check is asynchronous, so every test waits for it to settle
 * before asserting. `render` is awaited because React 19's `act` is
 * asynchronous, which makes @testing-library/react-native return a promise;
 * not awaiting it leaves the tree half-mounted and leaks into the next test.
 */
async function renderAuthProvider(): Promise<void> {
  await render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  );

  await waitFor((): void => {
    expect(authProbe.current?.isLoading).toBe(false);
  });
}

beforeEach(() => {
  authProbe.current = null;

  /*
   * The client is module state shared by every test in this file, exactly as
   * it is shared by every screen in the app. Start each test from empty so a
   * previous test's rows cannot be mistaken for a clear that worked.
   */
  queryClient.clear();

  hasServerUrlSpy().mockResolvedValue(true as never);
  consumeInitialSpy().mockResolvedValue(null as never);
  getTokensSpy().mockResolvedValue(STORED_TOKENS as never);
  getSsoTokensSpy().mockResolvedValue({} as never);
  getGlobalSsoTokenSpy().mockResolvedValue(null as never);
  clearAllSsoTokensSpy().mockResolvedValue(undefined as never);
  apiLogoutSpy().mockResolvedValue(undefined as never);
  unregisterPushTokenSpy().mockResolvedValue(undefined as never);
});

describe("AuthProvider empties the shared query cache when a user signs out", () => {
  test("the previous user's cached rows do not survive the sign out", async () => {
    seedPreviousUsersCache();
    expect(cachedKeyCount()).toBe(3);

    await renderAuthProvider();

    await act(async () => {
      await currentAuth().logout();
    });

    expect(cachedKeyCount()).toBe(0);
  });

  test("the cross-project alert list is gone, not merely marked stale", async () => {
    /*
     * Invalidation would not be enough. An invalidated query still HANDS OVER
     * its data on the first render while the refetch is in flight, which is
     * precisely the moment the new responder is looking at the screen.
     */
    seedPreviousUsersCache();

    await renderAuthProvider();

    await act(async () => {
      await currentAuth().logout();
    });

    expect(queryClient.getQueryData(ALL_PROJECT_ALERTS_KEY)).toBeUndefined();
  });

  test("a project's incidents are gone even though the key names that project", async () => {
    /*
     * A project id in the key looks like it scopes the entry, but it scopes it
     * to a PROJECT, not to an account - and two accounts on the same handset
     * can have very different access to the same project.
     */
    seedPreviousUsersCache();

    await renderAuthProvider();

    await act(async () => {
      await currentAuth().logout();
    });

    expect(queryClient.getQueryData(PROJECT_INCIDENTS_KEY)).toBeUndefined();
  });

  test("the internal notes on an incident are gone", async () => {
    /*
     * The worst of it. Notes are the internal running commentary on an
     * incident - who was paged, what was said about a customer, what was not
     * said publicly - and there is no version of this app where the next
     * person to sign in is entitled to read them off a cache.
     */
    seedPreviousUsersCache();

    await renderAuthProvider();

    await act(async () => {
      await currentAuth().logout();
    });

    expect(queryClient.getQueryData(INCIDENT_NOTES_KEY)).toBeUndefined();
  });

  test("rows that land while the sign out is still in flight are cleared too", async () => {
    /*
     * The ordering inside logout, pinned.
     *
     * Until apiLogout returns, the old session is still valid and the old
     * user's screens are still mounted, so requests that went out before the
     * sign-out started are still resolving into the cache. This stands in for
     * one of them by writing a row from inside the sign-out call itself.
     * Clearing at the TOP of logout would leave that row behind - the cache
     * would end up holding the departing user's data with no user signed in.
     */
    await renderAuthProvider();

    apiLogoutSpy().mockImplementation(async (): Promise<void> => {
      seedPreviousUsersCache();
    });

    await act(async () => {
      await currentAuth().logout();
    });

    expect(cachedKeyCount()).toBe(0);
  });

  test("the sign out still does everything else it did before", async () => {
    /*
     * The cache clear is an addition, not a replacement: a sign-out that
     * emptied the cache but stopped revoking the session or the push token
     * would be a worse bug than the one being fixed.
     */
    seedPreviousUsersCache();

    await renderAuthProvider();

    await act(async () => {
      await currentAuth().logout();
    });

    expect(unregisterPushTokenSpy()).toHaveBeenCalled();
    expect(apiLogoutSpy()).toHaveBeenCalled();
    expect(clearAllSsoTokensSpy()).toHaveBeenCalled();
    expect(currentAuth().isAuthenticated).toBe(false);
  });
});

describe("AuthProvider empties the shared query cache when the session dies on its own", () => {
  test("the 401 handler clears the cache along with the session", async () => {
    /*
     * This handler runs only after a token refresh failed and the client threw
     * the stored tokens away, so the session is as over as it is after a
     * sign-out - and it is the likelier way a shared handset ends up back on
     * the login screen, because it is what happens to an app that sat in a
     * pocket past its refresh token. If only the explicit sign-out cleared the
     * cache, the path nobody chooses would be the one that leaks.
     */
    await renderAuthProvider();

    const onAuthFailure: () => void = setOnAuthFailureSpy().mock
      .calls[0]![0] as () => void;

    seedPreviousUsersCache();
    expect(cachedKeyCount()).toBe(3);

    await act(async (): Promise<void> => {
      onAuthFailure();
    });

    expect(cachedKeyCount()).toBe(0);

    await waitFor((): void => {
      expect(currentAuth().isAuthenticated).toBe(false);
    });
  });
});
