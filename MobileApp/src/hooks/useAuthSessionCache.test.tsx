import React from "react";
import { Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import { AuthProvider, useAuth } from "./useAuth";
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
import { setOnAuthFailure } from "../api/client";
import { queryClient } from "../queryClient";
import { calendarFeedQueryKey } from "./useOnCallCalendarFeed";

/*
 * What the previous session leaves behind on a shared handset.
 *
 * The query cache is a module-level singleton with a 24 hour `gcTime`, so it
 * outlives sign-out by a day unless something empties it - and since calendar
 * feeds it holds a LIVE CREDENTIAL: the personal feed's URL is the only thing
 * protecting that feed, and anyone holding it keeps reading the owner's shifts
 * until the owner rotates. The handset this app is written for is an on-call
 * duty phone that gets handed over.
 *
 * Both ways a session can end are pinned here: the user signs out, or the
 * server stops accepting the tokens and the client's auth-failure handler
 * fires. The second one is the one nobody taps.
 */

jest.mock("../api/auth", () => {
  return {
    login: jest.fn(),
    logout: jest.fn(),
    verifyTotpAuth: jest.fn(),
    verifyBackupCode: jest.fn(),
    verifyTotpEnrolment: jest.fn(),
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

jest.mock("./pushTokenUtils", () => {
  return {
    PUSH_TOKEN_KEY: "oneuptime_expo_push_token",
    unregisterPushToken: jest.fn(),
  };
});

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

/** The secret the previous user's session put in the cache. */
const FEED_STATUS: { urls: { https: string } } = {
  urls: {
    https:
      "https://oneuptime.example.com/api/on-call-calendar/user/secret-token-of-user-a/shifts.ics",
  },
};

function seedPreviousSession(): void {
  queryClient.setQueryData(
    calendarFeedQueryKey("project-1", "user-a"),
    FEED_STATUS,
  );
  queryClient.setQueryData(["oncall", "my-shifts", "user-a"], {
    shifts: [{ shiftKey: "a" }],
  });
}

function cachedEntryCount(): number {
  return queryClient.getQueryCache().getAll().length;
}

beforeEach((): void => {
  authProbe.current = null;
  queryClient.clear();

  (hasServerUrl as unknown as jest.Mock).mockResolvedValue(true as never);
  (consumeInitialSsoCallbackUrl as unknown as jest.Mock).mockResolvedValue(
    null as never,
  );
  (getTokens as unknown as jest.Mock).mockResolvedValue(null as never);
  (getSsoTokens as unknown as jest.Mock).mockResolvedValue({} as never);
  (getGlobalSsoToken as unknown as jest.Mock).mockResolvedValue(null as never);
  (clearAllSsoTokens as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
  (unregisterPushToken as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
  (apiLogout as unknown as jest.Mock).mockResolvedValue(undefined as never);
});

describe("signing out", () => {
  test("empties the query cache, secrets and all", async () => {
    seedPreviousSession();
    expect(cachedEntryCount()).toBe(2);

    await renderAuthProvider();

    await act(async (): Promise<void> => {
      await currentAuth().logout();
    });

    expect(cachedEntryCount()).toBe(0);
    expect(
      queryClient.getQueryData(calendarFeedQueryKey("project-1", "user-a")),
    ).toBeUndefined();
  });

  test("still signs out when the cache is already empty", async () => {
    await renderAuthProvider();

    await act(async (): Promise<void> => {
      await currentAuth().logout();
    });

    expect(currentAuth().isAuthenticated).toBe(false);
    expect(cachedEntryCount()).toBe(0);
  });
});

describe("the session ending on its own", () => {
  test("the auth-failure handler empties the cache too", async () => {
    seedPreviousSession();

    await renderAuthProvider();

    const onAuthFailure: () => void = (setOnAuthFailure as unknown as jest.Mock)
      .mock.calls[0]![0] as () => void;

    await act(async (): Promise<void> => {
      onAuthFailure();
    });

    expect(cachedEntryCount()).toBe(0);
    expect(currentAuth().isAuthenticated).toBe(false);
  });
});
