import React from "react";
import { Platform, Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { AuthProvider, useAuth } from "./useAuth";
import { signInWithPasskey } from "../passkeys/signIn";
import { enrolPasskey as runPasskeyEnrolment } from "../passkeys/enrol";
import { login as apiLogin, LoginResponse } from "../api/auth";
import { getServerUrl } from "../storage/serverUrl";

/*
 * THE AUTH CONTEXT'S HALF OF A PASSKEY SET UP AT SIGN-IN (#9817).
 *
 *   - At the password step, whether to offer a passkey is decided once:
 *     the server offers one, it is reached over HTTPS, and this phone's
 *     browser makes passkeys.
 *   - enrolPasskey sends the email and password the challenge holds - and
 *     nothing else - and a saved passkey settles the second step exactly as
 *     an authenticator app does: the challenge (and its password) is
 *     dropped, the codes minted behind it held for the one screen that
 *     shows them, and the app NOT yet signed in while they are.
 *   - A canceled or unsupported passkey keeps the challenge: the
 *     authenticator app is still there to set up.
 *   - A passkey sign-in started from a password's challenge keeps the
 *     challenge until it has signed the person in.
 */

jest.mock("../passkeys/signIn", () => {
  return { signInWithPasskey: jest.fn(), discardPasskeySession: jest.fn() };
});
jest.mock("../passkeys/enrol", () => {
  return { enrolPasskey: jest.fn() };
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
    getServerUrl: jest.fn(),
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

const EMAIL: string = "responder@example.com";
const PASSWORD: string = "correct-horse-battery-staple";

let auth: ReturnType<typeof useAuth>;

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

function enrolmentRequired(offered: boolean): LoginResponse {
  return {
    accessToken: "",
    refreshToken: "",
    refreshTokenExpiresAt: "",
    user: { _id: "user-1", email: EMAIL, name: "", isMasterAdmin: false },
    twoFactorRequired: true,
    twoFactorEnrolmentRequired: true,
    twoFactorAuthId: "pending-enrolment-1",
    twoFactorOtpUrl: "otpauth://totp/OneUptime:x?secret=ABC",
    ...(offered ? { passkeyEnrolmentOffered: true } : {}),
  };
}

const SIGNED_IN: LoginResponse = {
  accessToken: "access",
  refreshToken: "refresh",
  refreshTokenExpiresAt: "2027-01-01",
  user: {
    _id: "user-1",
    email: EMAIL,
    name: "Responder",
    isMasterAdmin: false,
  },
};

const originalVersion: string | number = Platform.Version;

function onPhone(version: string | number): void {
  Object.defineProperty(Platform, "Version", {
    configurable: true,
    get: (): string | number => {
      return version;
    },
  });
}

// A version that makes passkeys on whichever platform this run is.
const CAPABLE_VERSION: string | number = Platform.OS === "ios" ? "17.4" : 34;
const INCAPABLE_VERSION: string | number = Platform.OS === "ios" ? "15.7" : 26;

async function signInWithPassword(offered: boolean): Promise<void> {
  jest.mocked(apiLogin).mockResolvedValue(enrolmentRequired(offered));

  await act(async () => {
    await auth.login(EMAIL, PASSWORD);
  });
}

beforeEach(() => {
  jest.mocked(getServerUrl).mockResolvedValue("https://oneuptime.example.com");
  onPhone(CAPABLE_VERSION);
});

afterEach(() => {
  onPhone(originalVersion);
});

describe("whether a passkey is offered beside the authenticator app", () => {
  test("yes: the server offers it, over HTTPS, on a phone that makes passkeys", async () => {
    await show();
    await signInWithPassword(true);

    expect(auth.pendingTwoFactor?.enrolment?.canEnrolPasskey).toBe(true);
  });

  test("no: the server does not offer it", async () => {
    await show();
    await signInWithPassword(false);

    expect(auth.pendingTwoFactor?.enrolment?.canEnrolPasskey).toBe(false);
  });

  test("no: the server is reached over plain HTTP", async () => {
    jest.mocked(getServerUrl).mockResolvedValue("http://oneuptime.internal");

    await show();
    await signInWithPassword(true);

    expect(auth.pendingTwoFactor?.enrolment?.canEnrolPasskey).toBe(false);
  });

  test("no: this phone's browser makes no passkeys", async () => {
    onPhone(INCAPABLE_VERSION);

    await show();
    await signInWithPassword(true);

    expect(auth.pendingTwoFactor?.enrolment?.canEnrolPasskey).toBe(false);
  });
});

describe("enrolPasskey", () => {
  test("sends the challenge's email and password, and a saved passkey settles the second step", async () => {
    jest.mocked(runPasskeyEnrolment).mockResolvedValue({
      status: "enrolled",
      response: { ...SIGNED_IN, backupCodes: ["AAAAA-BBBBB"] },
    });

    await show();
    await signInWithPassword(true);

    const signal: AbortSignal = new AbortController().signal;
    const onProgress: jest.Mock = jest.fn();

    await act(async () => {
      await auth.enrolPasskey({ signal, onProgress });
    });

    expect(runPasskeyEnrolment).toHaveBeenCalledWith({
      signal,
      onProgress,
      email: EMAIL,
      password: PASSWORD,
    });

    // The challenge, and the password it held, are gone.
    expect(auth.pendingTwoFactor).toBeNull();
    // The codes wait for their screen, and the app is not signed in under them.
    expect(auth.pendingBackupCodes).toEqual(["AAAAA-BBBBB"]);
    expect(auth.pendingLoginUserId).toBe("user-1");
    expect(auth.isAuthenticated).toBe(false);

    await act(async (): Promise<void> => {
      auth.completePendingLogin();
    });

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.pendingBackupCodes).toBeNull();
  });

  test("a canceled passkey keeps the challenge, so the authenticator app is still there", async () => {
    jest.mocked(runPasskeyEnrolment).mockResolvedValue({ status: "cancelled" });

    await show();
    await signInWithPassword(true);

    await act(async () => {
      await auth.enrolPasskey({
        signal: new AbortController().signal,
        onProgress: jest.fn(),
      });
    });

    expect(auth.pendingTwoFactor?.enrolment?.twoFactorAuthId).toBe(
      "pending-enrolment-1",
    );
    expect(auth.isAuthenticated).toBe(false);
  });

  test("an unsupported browser keeps the challenge too", async () => {
    jest
      .mocked(runPasskeyEnrolment)
      .mockResolvedValue({ status: "unsupported" });

    await show();
    await signInWithPassword(true);

    await act(async () => {
      await auth.enrolPasskey({
        signal: new AbortController().signal,
        onProgress: jest.fn(),
      });
    });

    expect(auth.pendingTwoFactor).not.toBeNull();
  });

  test("with no setup waiting, nothing is sent anywhere", async () => {
    await show();

    await expect(
      auth.enrolPasskey({
        signal: new AbortController().signal,
        onProgress: jest.fn(),
      }),
    ).rejects.toThrow("There is no two factor setup waiting to finish.");
    expect(runPasskeyEnrolment).not.toHaveBeenCalled();
  });
});

describe("a passkey sign-in from a password's challenge", () => {
  test("canceled, it keeps the challenge", async () => {
    jest.mocked(signInWithPasskey).mockResolvedValue(null);

    await show();
    await signInWithPassword(true);

    await act(async () => {
      await auth.loginWithPasskey({
        signal: new AbortController().signal,
        onProgress: jest.fn(),
        keepsPendingSignIn: true,
      });
    });

    expect(auth.pendingTwoFactor).not.toBeNull();
    expect(auth.isAuthenticated).toBe(false);
  });

  test("signed in, it drops the challenge and its password", async () => {
    jest.mocked(signInWithPasskey).mockResolvedValue(SIGNED_IN);

    await show();
    await signInWithPassword(true);

    await act(async () => {
      await auth.loginWithPasskey({
        signal: new AbortController().signal,
        onProgress: jest.fn(),
        keepsPendingSignIn: true,
      });
    });

    expect(auth.pendingTwoFactor).toBeNull();
    expect(auth.isAuthenticated).toBe(true);
  });

  test("from the sign-in screen, any challenge left over is dropped first, as before", async () => {
    jest.mocked(signInWithPasskey).mockResolvedValue(null);

    await show();
    await signInWithPassword(true);

    await act(async () => {
      await auth.loginWithPasskey({
        signal: new AbortController().signal,
        onProgress: jest.fn(),
      });
    });

    expect(auth.pendingTwoFactor).toBeNull();
  });
});
