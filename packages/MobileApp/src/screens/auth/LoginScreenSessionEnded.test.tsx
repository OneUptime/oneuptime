import React from "react";
import { Text } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import LoginScreen, { SESSION_ENDED_NOTICE_TEST_ID } from "./LoginScreen";
import { AuthProvider, useAuth } from "../../hooks/useAuth";
import { login as apiLogin, logout as apiLogout } from "../../api/auth";
import { setOnAuthFailure, type AuthFailureListener } from "../../api/client";
import { getTokens } from "../../storage/keychain";
import { hasServerUrl } from "../../storage/serverUrl";
import {
  clearAllSsoTokens,
  getGlobalSsoToken,
  getSsoTokens,
} from "../../storage/ssoTokens";
import { consumeInitialSsoCallbackUrl } from "../../sso/deepLink";
import { unregisterPushToken } from "../../hooks/pushTokenUtils";
import {
  SESSION_ENDED_NOTICES,
  type SessionEndReason,
} from "../../auth/sessionEnded";

/*
 * THE SIGN-IN SCREEN SAYS WHY THE SERVER ENDED THE SESSION (issue #8381).
 *
 * When the server ends a session at a renewal - its idle timeout or its
 * session length - the client hands the reason to the AuthProvider
 * (onAuthFailure), and the sign-in screen says it in one sentence above the
 * form, as the Dashboard's sign-in page does. Without it, an on-call person
 * sees the app sign itself out with nothing to tell a server's rule from a
 * bug. Any other end says nothing, and the sentence is gone once they sign
 * in again or sign out themselves.
 *
 * The real AuthProvider and the real sign-in screen; the client, storage
 * and the identity calls are stood in for.
 */

jest.mock("../../api/auth", () => {
  return {
    login: jest.fn(),
    logout: jest.fn(),
    verifyTotpAuth: jest.fn(),
    verifyBackupCode: jest.fn(),
    verifyTotpEnrolment: jest.fn(),
  };
});

jest.mock("../../api/client", () => {
  return {
    __esModule: true,
    default: { post: jest.fn(), get: jest.fn() },
    setOnAuthFailure: jest.fn(),
  };
});

jest.mock("../../storage/serverUrl", () => {
  return {
    hasServerUrl: jest.fn(),
    getServerUrl: jest.fn(async (): Promise<string> => {
      return "https://oneuptime.example.com";
    }),
  };
});

jest.mock("../../storage/keychain", () => {
  return {
    getTokens: jest.fn(),
  };
});

jest.mock("../../storage/ssoTokens", () => {
  return {
    getSsoTokens: jest.fn(),
    getGlobalSsoToken: jest.fn(),
    clearAllSsoTokens: jest.fn(),
  };
});

jest.mock("../../sso/deepLink", () => {
  return {
    startSsoCallbackCapture: jest.fn(),
    stopSsoCallbackCapture: jest.fn(),
    consumeInitialSsoCallbackUrl: jest.fn(),
  };
});

jest.mock("../../sso/session", () => {
  return {
    completeSsoLoginFromUrl: jest.fn(),
  };
});

jest.mock("../../passkeys/signIn", () => {
  return {
    signInWithPasskey: jest.fn(),
    discardPasskeySession: jest.fn(),
  };
});

jest.mock("../../hooks/pushTokenUtils", () => {
  return {
    PUSH_TOKEN_KEY: "oneuptime_expo_push_token",
    unregisterPushToken: jest.fn(),
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return {
        navigate: jest.fn(),
        addListener: jest.fn(() => {
          return jest.fn();
        }),
      };
    },
  };
});

type AuthValue = ReturnType<typeof useAuth>;

const authProbe: { current: AuthValue | null } = { current: null };

// Signed in, the app's tabs; signed out, the sign-in screen.
function Root(): React.JSX.Element {
  const auth: AuthValue = useAuth();
  authProbe.current = auth;

  if (auth.isLoading) {
    return <Text>Loading</Text>;
  }

  return auth.isAuthenticated ? <Text>Signed in</Text> : <LoginScreen />;
}

function currentAuth(): AuthValue {
  if (!authProbe.current) {
    throw new Error("AuthProvider was never rendered");
  }

  return authProbe.current;
}

// What the client calls when the session is over (setOnAuthFailure's listener).
function sessionEnds(): AuthFailureListener {
  const calls: Array<Array<unknown>> = (
    setOnAuthFailure as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return calls[calls.length - 1]![0] as AuthFailureListener;
}

async function endSession(reason: SessionEndReason | null): Promise<void> {
  await act(async (): Promise<void> => {
    sessionEnds()(reason);
  });
}

// The app opens signed in, as a stored session does.
async function openSignedIn(): Promise<void> {
  (getTokens as unknown as jest.Mock).mockResolvedValue({
    accessToken: "access",
    refreshToken: "refresh",
  } as never);

  await render(
    <AuthProvider>
      <Root />
    </AuthProvider>,
  );

  await screen.findByText("Signed in");
}

function notice(): ReturnType<typeof screen.queryByTestId> {
  return screen.queryByTestId(SESSION_ENDED_NOTICE_TEST_ID);
}

async function signInAgain(): Promise<void> {
  (apiLogin as unknown as jest.Mock).mockResolvedValue({
    accessToken: "access-2",
    refreshToken: "refresh-2",
    refreshTokenExpiresAt: "2027-01-01T00:00:00.000Z",
    user: {
      _id: "user-1",
      email: "responder@example.com",
      name: "Responder",
      isMasterAdmin: false,
    },
  } as never);

  await fireEvent.changeText(
    screen.getByPlaceholderText("you@example.com"),
    "responder@example.com",
  );
  await fireEvent.changeText(
    screen.getByPlaceholderText("Your password"),
    "correct horse",
  );
  await fireEvent.press(screen.getByText("Sign In"));

  await screen.findByText("Signed in");
  expect(apiLogin).toHaveBeenCalledWith(
    "responder@example.com",
    "correct horse",
  );
}

beforeEach((): void => {
  authProbe.current = null;

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

describe("the server ended the session, and said why", () => {
  test.each<[SessionEndReason, string]>([
    ["inactive", "You were signed out after a while without use."],
    [
      "length-reached",
      "You were signed out because your sign-in lasted as long as this server allows.",
    ],
  ])(
    "%s: the sign-in screen says it, above the form",
    async (reason: SessionEndReason, sentence: string) => {
      await openSignedIn();

      await endSession(reason);

      await screen.findByText("Welcome back");

      expect(notice()).not.toBeNull();
      expect(screen.getByText(sentence)).toBeTruthy();
      expect(SESSION_ENDED_NOTICES[reason]).toBe(sentence);

      // Above the form: before the email field, in reading order.
      const tree: string = JSON.stringify(screen.toJSON());

      expect(tree.indexOf(sentence)).toBeGreaterThan(-1);
      expect(tree.indexOf(sentence)).toBeLessThan(
        tree.indexOf("you@example.com"),
      );
    },
  );

  test("it is information, not an error: no alert is announced", async () => {
    await openSignedIn();
    await endSession("inactive");

    const shown: NonNullable<ReturnType<typeof notice>> = (await waitFor(
      (): NonNullable<ReturnType<typeof notice>> => {
        const found: ReturnType<typeof notice> = notice();
        expect(found).not.toBeNull();
        return found!;
      },
    )) as NonNullable<ReturnType<typeof notice>>;

    expect(shown.props.accessibilityRole).not.toBe("alert");
    expect(shown.props.accessibilityLiveRegion).toBe("polite");
  });

  test("the requests still in flight, refused afterwards without a reason, leave the sentence as it was", async () => {
    await openSignedIn();
    await endSession("inactive");
    await endSession(null);
    await endSession(null);

    expect(
      screen.getByText("You were signed out after a while without use."),
    ).toBeTruthy();
  });

  test("a later reason replaces an earlier one", async () => {
    await openSignedIn();
    await endSession("inactive");
    await endSession("length-reached");

    expect(
      screen.getByText(SESSION_ENDED_NOTICES["length-reached"]),
    ).toBeTruthy();
    expect(screen.queryByText(SESSION_ENDED_NOTICES.inactive)).toBeNull();
  });

  test("gone once the person signs in again, and not back when that session ends for another reason", async () => {
    await openSignedIn();
    await endSession("inactive");
    await screen.findByText("Welcome back");

    await signInAgain();

    expect(currentAuth().sessionEndReason).toBeNull();

    // Signed out elsewhere: a plain 401, no reason.
    await endSession(null);
    await screen.findByText("Welcome back");

    expect(notice()).toBeNull();
  });
});

describe("any other end says nothing", () => {
  test("a refusal without a reason (a refresh token that ran out, a sign-out elsewhere)", async () => {
    await openSignedIn();
    await endSession(null);

    await screen.findByText("Welcome back");

    expect(notice()).toBeNull();
    expect(currentAuth().sessionEndReason).toBeNull();
  });

  test("a listener called with nothing at all, as an older caller would", async () => {
    await openSignedIn();

    await act(async (): Promise<void> => {
      (sessionEnds() as unknown as () => void)();
    });

    await screen.findByText("Welcome back");

    expect(notice()).toBeNull();
  });

  test("the person signing out", async () => {
    await openSignedIn();

    await act(async (): Promise<void> => {
      await currentAuth().logout();
    });

    await screen.findByText("Welcome back");

    expect(notice()).toBeNull();
  });

  test("the person signing out while the server ends the session under them: they chose to leave, so no reason", async () => {
    await openSignedIn();

    // The renewal the sign-out waits for is refused with the idle timeout.
    (apiLogout as unknown as jest.Mock).mockImplementation(
      async (): Promise<void> => {
        sessionEnds()("inactive");
      },
    );

    await act(async (): Promise<void> => {
      await currentAuth().logout();
    });

    await screen.findByText("Welcome back");

    expect(notice()).toBeNull();
  });

  test("an app opened signed out says nothing", async () => {
    await render(
      <AuthProvider>
        <Root />
      </AuthProvider>,
    );

    await screen.findByText("Welcome back");

    expect(notice()).toBeNull();
  });
});
