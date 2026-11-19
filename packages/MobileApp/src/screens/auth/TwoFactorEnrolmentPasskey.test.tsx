import React, { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import TwoFactorEnrolmentScreen from "./TwoFactorEnrolmentScreen";
import type { LoginResponse } from "../../api/auth";
import type { PendingTwoFactor } from "../../hooks/useAuth";
import type {
  PasskeyEnrolmentOptions,
  PasskeyEnrolmentOutcome,
} from "../../passkeys/enrol";
import type { MockedFunction } from "jest-mock";

/*
 * A PASSKEY, BESIDE THE AUTHENTICATOR APP, WHEN SIGN-IN REQUIRES A SECOND
 * STEP (#9817).
 *
 * Where a passkey can work - the server offers one over HTTPS and this
 * phone's browser makes them (canEnrolPasskey) - the screen opens on a
 * choice: Passkey, or Authenticator app. The passkey runs in the phone's
 * browser and, once saved, goes on exactly as a verified authenticator app
 * does: to the codes it minted, the offer of some, or straight in. Where it
 * cannot work the screen opens on the authenticator app alone, as before.
 * A canceled passkey says so and can be tried again; a browser that turns
 * out not to make passkeys sends the person to the authenticator app,
 * saying why, and the choice is not offered again. Either way back to the
 * choice, and Sign in as a different user, are there throughout.
 */

type EnrolPasskey = (
  options: PasskeyEnrolmentOptions,
) => Promise<PasskeyEnrolmentOutcome>;
type Navigate = (route: string, params?: unknown) => void;

const mockEnrolPasskey: MockedFunction<EnrolPasskey> = jest.fn<EnrolPasskey>();
const mockVerifyTotpEnrolment: MockedFunction<
  (data: { code: string }) => Promise<LoginResponse>
> = jest.fn<(data: { code: string }) => Promise<LoginResponse>>();
const mockCancelTwoFactor: MockedFunction<() => void> = jest.fn<() => void>();
const mockCompletePendingLogin: MockedFunction<() => void> =
  jest.fn<() => void>();
const mockNavigate: MockedFunction<Navigate> = jest.fn<Navigate>();

let mockPendingTwoFactor: PendingTwoFactor | null = null;

jest.mock("../../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return {
        pendingTwoFactor: mockPendingTwoFactor,
        verifyTotpEnrolment: mockVerifyTotpEnrolment,
        enrolPasskey: mockEnrolPasskey,
        cancelTwoFactor: mockCancelTwoFactor,
        completePendingLogin: mockCompletePendingLogin,
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

const OTP_URL: string =
  "otpauth://totp/OneUptime:responder@example.com?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime";

function pending(canEnrolPasskey: boolean): PendingTwoFactor {
  return {
    email: "responder@example.com",
    password: "correct-horse-battery-staple",
    totpAuthList: [],
    webAuthnList: [],
    backupCodeCount: null,
    enrolment: {
      twoFactorAuthId: "pending-enrolment-1",
      twoFactorOtpUrl: OTP_URL,
      canEnrolPasskey: canEnrolPasskey,
    },
  };
}

function signedIn(overrides: Partial<LoginResponse> = {}): LoginResponse {
  return {
    accessToken: "access",
    refreshToken: "refresh",
    refreshTokenExpiresAt: "2026-12-01T00:00:00.000Z",
    user: {
      _id: "user-1",
      email: "responder@example.com",
      name: "Responder",
      isMasterAdmin: false,
    },
    ...overrides,
  };
}

async function renderScreen(): Promise<void> {
  await render(<TwoFactorEnrolmentScreen />);
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

async function openPasskeyStep(): Promise<void> {
  await renderScreen();
  await press("enrolment-choice-passkey");
}

beforeEach(() => {
  mockPendingTwoFactor = pending(true);
  mockEnrolPasskey.mockReset();
  mockVerifyTotpEnrolment.mockReset();
  mockCancelTwoFactor.mockReset();
  mockCompletePendingLogin.mockReset();
  mockNavigate.mockReset();
});

describe("where a passkey can be made", () => {
  test("opens on the choice: Passkey first, then Authenticator app", async () => {
    await renderScreen();

    expect(screen.getByTestId("enrolment-choices")).toBeTruthy();
    expect(screen.getByText("Passkey")).toBeTruthy();
    expect(
      screen.getByText(
        "Use this phone's face, fingerprint or screen lock, or a security key. No code to type.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Authenticator app")).toBeTruthy();
    // Nothing is set up from the choice itself.
    expect(screen.queryByTestId("enrolment-code-input")).toBeNull();
    expect(mockEnrolPasskey).not.toHaveBeenCalled();
  });

  test("each choice is a named button", async () => {
    await renderScreen();

    expect(screen.getByRole("button", { name: "Passkey" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Authenticator app" }),
    ).toBeTruthy();
  });

  test("Authenticator app opens its two steps, with a way back to the choice", async () => {
    await renderScreen();
    await press("enrolment-choice-authenticator-app");

    expect(screen.getByTestId("enrolment-code-input")).toBeTruthy();
    expect(screen.getByText("Add to Authenticator App")).toBeTruthy();

    await press("choose-another-way");

    expect(screen.getByTestId("enrolment-choices")).toBeTruthy();
  });

  test("Passkey says what happens, and creates nothing until asked", async () => {
    await openPasskeyStep();

    expect(screen.getByText("Create a passkey")).toBeTruthy();
    expect(screen.getByTestId("create-passkey")).toBeTruthy();
    expect(screen.getByText("Create Passkey")).toBeTruthy();
    expect(mockEnrolPasskey).not.toHaveBeenCalled();
  });

  test("Sign in as a different user drops the credentials, from the choice too", async () => {
    await renderScreen();
    await press("sign-in-as-different-user");

    expect(mockCancelTwoFactor).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("Login");
  });
});

describe("creating the passkey", () => {
  test("a passkey saved with codes minted goes to the screen that shows them, still not signed in", async () => {
    mockEnrolPasskey.mockResolvedValue({
      status: "enrolled",
      response: signedIn({ backupCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"] }),
    });

    await openPasskeyStep();
    await press("create-passkey");

    expect(mockEnrolPasskey).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("BackupCodes", { mode: "show" });
    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("an account that already had codes is signed straight in", async () => {
    mockEnrolPasskey.mockResolvedValue({
      status: "enrolled",
      response: signedIn({ hasBackupCodes: true }),
    });

    await openPasskeyStep();
    await press("create-passkey");

    expect(mockCompletePendingLogin).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalledWith(
      "BackupCodes",
      expect.anything(),
    );
  });

  test("a passkey saved with no codes at all lands on the offer of some", async () => {
    mockEnrolPasskey.mockResolvedValue({
      status: "enrolled",
      response: signedIn(),
    });

    await openPasskeyStep();
    await press("create-passkey");

    expect(mockNavigate).toHaveBeenCalledWith("BackupCodes", {
      mode: "offer",
    });
  });

  test("shows its progress as it goes", async () => {
    let finish: (outcome: PasskeyEnrolmentOutcome) => void = (): void => {};

    mockEnrolPasskey.mockImplementation(
      (options: PasskeyEnrolmentOptions): Promise<PasskeyEnrolmentOutcome> => {
        options.onProgress("browser");
        return new Promise<PasskeyEnrolmentOutcome>(
          (resolve: (outcome: PasskeyEnrolmentOutcome) => void): void => {
            finish = resolve;
          },
        );
      },
    );

    await openPasskeyStep();
    await press("create-passkey");

    // A spinner in the button, still named for what it is doing.
    expect(screen.getByTestId("create-passkey").props.accessibilityLabel).toBe(
      "Continue in your browser…",
    );
    expect(screen.getByTestId("passkey-enrolment-in-browser")).toBeTruthy();
    expect(screen.getByTestId("cancel-passkey-enrolment")).toBeTruthy();

    await act(async () => {
      finish({ status: "cancelled" });
    });
  });

  test("a canceled passkey says so, and can be tried again", async () => {
    mockEnrolPasskey.mockResolvedValue({ status: "cancelled" });

    await openPasskeyStep();
    await press("create-passkey");

    expect(screen.getByTestId("passkey-enrolment-notice")).toBeTruthy();
    expect(screen.getByText("Try Again")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockCompletePendingLogin).not.toHaveBeenCalled();

    mockEnrolPasskey.mockResolvedValue({
      status: "enrolled",
      response: signedIn({ hasBackupCodes: true }),
    });

    await press("create-passkey");

    expect(mockEnrolPasskey).toHaveBeenCalledTimes(2);
    expect(mockCompletePendingLogin).toHaveBeenCalledTimes(1);
  });

  test("Cancel while the browser is open stops waiting for it", async () => {
    let seenSignal: AbortSignal | null = null;

    mockEnrolPasskey.mockImplementation(
      (options: PasskeyEnrolmentOptions): Promise<PasskeyEnrolmentOutcome> => {
        seenSignal = options.signal;
        options.onProgress("browser");
        return new Promise<PasskeyEnrolmentOutcome>((): void => {});
      },
    );

    await openPasskeyStep();
    await press("create-passkey");
    await press("cancel-passkey-enrolment");

    expect(seenSignal!.aborted).toBe(true);
    expect(screen.getByTestId("passkey-enrolment-notice")).toBeTruthy();
    expect(screen.getByText("Try Again")).toBeTruthy();
  });

  test("a refusal shows the server's own words and goes nowhere", async () => {
    mockEnrolPasskey.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: { message: "Registration verification failed." },
      },
    });

    await openPasskeyStep();
    await press("create-passkey");

    expect(screen.getByTestId("passkey-enrolment-error")).toBeTruthy();
    expect(screen.getByText("Registration verification failed.")).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("a browser that makes no passkeys sends the person to the authenticator app, saying why, for good", async () => {
    mockEnrolPasskey.mockResolvedValue({ status: "unsupported" });

    await openPasskeyStep();
    await press("create-passkey");

    expect(screen.getByTestId("passkey-unsupported-notice")).toBeTruthy();
    expect(
      screen.getByText(
        "This phone's browser can't create a passkey. Set up an authenticator app instead.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("enrolment-code-input")).toBeTruthy();
    // No way back to a choice that has only one way left.
    expect(screen.queryByTestId("choose-another-way")).toBeNull();
  });

  test("Choose another way from the passkey goes back to the choice", async () => {
    await openPasskeyStep();
    await press("choose-another-way");

    expect(screen.getByTestId("enrolment-choices")).toBeTruthy();
  });
});

describe("where a passkey cannot be made", () => {
  test("opens on the authenticator app alone, as before, with no choice to make", async () => {
    mockPendingTwoFactor = pending(false);

    await renderScreen();

    expect(screen.queryByTestId("enrolment-choices")).toBeNull();
    expect(screen.queryByText("Passkey")).toBeNull();
    expect(screen.getByTestId("enrolment-code-input")).toBeTruthy();
    expect(screen.queryByTestId("choose-another-way")).toBeNull();
  });

  test("an enrolment from an older auth state, with no word on passkeys, is the authenticator app", async () => {
    const legacy: PendingTwoFactor = pending(false);
    delete (
      legacy.enrolment as Partial<NonNullable<PendingTwoFactor["enrolment"]>>
    ).canEnrolPasskey;
    mockPendingTwoFactor = legacy;

    await renderScreen();

    expect(screen.queryByTestId("enrolment-choices")).toBeNull();
    expect(screen.getByTestId("enrolment-code-input")).toBeTruthy();
  });
});
