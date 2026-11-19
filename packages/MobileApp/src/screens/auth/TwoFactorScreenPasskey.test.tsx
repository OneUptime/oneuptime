import React, { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import TwoFactorScreen from "./TwoFactorScreen";
import type { LoginResponse, TwoFactorMethod } from "../../api/auth";
import type { PendingTwoFactor } from "../../hooks/useAuth";
import type { PasskeySignInOptions } from "../../passkeys/signIn";
import type { MockedFunction } from "jest-mock";

/*
 * A PASSKEY ON THE SECOND STEP OF A PASSWORD SIGN-IN (#9817).
 *
 * This app cannot answer a security key's challenge, so the challenge
 * screen lists security keys as out of its reach. A passkey is different:
 * the app signs in with one on its own, in the phone's browser (Sign in
 * with a passkey) - and a passkey is what the app now sets up when sign-in
 * requires a second step. So a passkey listed here is a way in: pressed, it
 * runs the passkey sign-in, keeping the password's challenge until the
 * passkey has signed the person in. A canceled passkey leaves them on the
 * challenge with every other way still open; a security key is listed as
 * before.
 */

type LoginWithPasskey = (
  options: PasskeySignInOptions & { keepsPendingSignIn?: boolean },
) => Promise<LoginResponse | null>;

const mockLoginWithPasskey: MockedFunction<LoginWithPasskey> =
  jest.fn<LoginWithPasskey>();
const mockCancelTwoFactor: MockedFunction<() => void> = jest.fn<() => void>();
const mockNavigate: MockedFunction<(route: string) => void> =
  jest.fn<(route: string) => void>();

let mockPendingTwoFactor: PendingTwoFactor | null = null;

jest.mock("../../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return {
        pendingTwoFactor: mockPendingTwoFactor,
        verifyTotpAuth: jest.fn(),
        verifyBackupCode: jest.fn(),
        cancelTwoFactor: mockCancelTwoFactor,
        completePendingLogin: jest.fn(),
        loginWithPasskey: mockLoginWithPasskey,
      };
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
  };
});

jest.mock("../../storage/backupCodeOffer", () => {
  return { wasBackupCodeOfferSkippedRecently: jest.fn() };
});

const PASSKEY: TwoFactorMethod = {
  _id: "passkey-1",
  name: "Passkey",
  isPasskey: true,
};

const SECURITY_KEY: TwoFactorMethod = {
  _id: "security-key-1",
  name: "YubiKey",
};

const APP: TwoFactorMethod = { _id: "totp-1", name: "Phone" };

function challenge(data: {
  totpAuthList?: Array<TwoFactorMethod>;
  webAuthnList?: Array<TwoFactorMethod>;
}): PendingTwoFactor {
  return {
    email: "responder@example.com",
    password: "correct-horse-battery-staple",
    totpAuthList: data.totpAuthList || [],
    webAuthnList: data.webAuthnList || [],
    backupCodeCount: 10,
  };
}

const SIGNED_IN: LoginResponse = {
  accessToken: "access",
  refreshToken: "refresh",
  refreshTokenExpiresAt: "2026-12-01T00:00:00.000Z",
  user: {
    _id: "user-1",
    email: "responder@example.com",
    name: "Responder",
    isMasterAdmin: false,
  },
};

async function renderScreen(): Promise<void> {
  await render(<TwoFactorScreen />);
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeEach(() => {
  mockLoginWithPasskey.mockReset();
  mockCancelTwoFactor.mockReset();
  mockNavigate.mockReset();
  mockPendingTwoFactor = challenge({ webAuthnList: [PASSKEY] });
});

describe("a passkey on the challenge", () => {
  test("is a way in, named, not a dead end", async () => {
    await renderScreen();

    expect(screen.getByTestId("passkey-method-passkey-1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Passkey" })).toBeTruthy();
    expect(
      screen.getByText("Passkey: signs you in on its own, in your browser"),
    ).toBeTruthy();
    // Not the security key's sentence, nor its warning.
    expect(screen.queryByTestId("webauthn-method-passkey-1")).toBeNull();
    expect(screen.queryByTestId("security-key-only-notice")).toBeNull();
    expect(
      screen.queryByText(/Security keys are not supported in the mobile app/),
    ).toBeNull();
  });

  test("pressed, it signs in with the passkey, keeping the password's challenge until it has", async () => {
    mockLoginWithPasskey.mockResolvedValue(SIGNED_IN);

    await renderScreen();
    await press("passkey-method-passkey-1");

    expect(mockLoginWithPasskey).toHaveBeenCalledTimes(1);
    expect(mockLoginWithPasskey.mock.calls[0]![0].keepsPendingSignIn).toBe(
      true,
    );
    // Signed in by the auth context: nothing for this screen to cancel.
    expect(mockCancelTwoFactor).not.toHaveBeenCalled();
    expect(screen.queryByTestId("passkey-sign-in-notice")).toBeNull();
  });

  test("canceled, it says so and leaves the challenge as it was", async () => {
    mockLoginWithPasskey.mockResolvedValue(null);

    await renderScreen();
    await press("passkey-method-passkey-1");

    expect(screen.getByTestId("passkey-sign-in-notice")).toBeTruthy();
    expect(screen.getByTestId("passkey-method-passkey-1")).toBeTruthy();
    expect(mockCancelTwoFactor).not.toHaveBeenCalled();
  });

  test("a failure says why, and the passkey can be tried again", async () => {
    mockLoginWithPasskey.mockRejectedValueOnce(
      new Error(
        "Could not open or complete passkey sign-in. Please try again.",
      ),
    );

    await renderScreen();
    await press("passkey-method-passkey-1");

    expect(screen.getByTestId("passkey-sign-in-error")).toBeTruthy();

    mockLoginWithPasskey.mockResolvedValue(SIGNED_IN);
    await press("passkey-method-passkey-1");

    expect(mockLoginWithPasskey).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("passkey-sign-in-error")).toBeNull();
  });

  test("while it is in the browser, it says where, and can be canceled", async () => {
    let seen: AbortSignal | null = null;

    mockLoginWithPasskey.mockImplementation(
      (
        options: PasskeySignInOptions & { keepsPendingSignIn?: boolean },
      ): Promise<LoginResponse | null> => {
        seen = options.signal;
        options.onProgress("browser");
        return new Promise<LoginResponse | null>((): void => {});
      },
    );

    await renderScreen();
    await press("passkey-method-passkey-1");

    expect(screen.getByTestId("passkey-sign-in-in-browser")).toBeTruthy();

    await press("cancel-passkey-sign-in");

    expect(seen!.aborted).toBe(true);
    expect(screen.getByTestId("passkey-sign-in-notice")).toBeTruthy();
  });

  test("an account whose only second steps are passkeys is not told it cannot sign in here", async () => {
    await renderScreen();

    expect(screen.getByText("Lost access to your passkey?")).toBeTruthy();
    expect(screen.queryByTestId("security-key-only-notice")).toBeNull();
  });
});

describe("a security key on the challenge", () => {
  test("is listed as out of the app's reach, as before", async () => {
    mockPendingTwoFactor = challenge({ webAuthnList: [SECURITY_KEY] });

    await renderScreen();

    expect(screen.getByTestId("webauthn-method-security-key-1")).toBeTruthy();
    expect(screen.queryByTestId("passkey-method-security-key-1")).toBeNull();
    expect(screen.getByTestId("security-key-only-notice")).toBeTruthy();
    expect(screen.getByText("Lost access to your security key?")).toBeTruthy();
  });

  test("beside a passkey: the passkey is the way, the key is listed, and no warning", async () => {
    mockPendingTwoFactor = challenge({
      webAuthnList: [PASSKEY, SECURITY_KEY],
    });

    await renderScreen();

    expect(screen.getByTestId("passkey-method-passkey-1")).toBeTruthy();
    expect(screen.getByTestId("webauthn-method-security-key-1")).toBeTruthy();
    expect(screen.queryByTestId("security-key-only-notice")).toBeNull();
  });

  test("beside an authenticator app, a passkey is a way in too", async () => {
    mockPendingTwoFactor = challenge({
      totpAuthList: [APP],
      webAuthnList: [PASSKEY],
    });

    await renderScreen();

    expect(screen.getByTestId("totp-method-totp-1")).toBeTruthy();
    expect(screen.getByTestId("passkey-method-passkey-1")).toBeTruthy();
    expect(screen.getByText("Lost access to your authenticator?")).toBeTruthy();
  });
});
