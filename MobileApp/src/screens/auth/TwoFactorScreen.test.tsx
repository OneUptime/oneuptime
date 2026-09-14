import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import TwoFactorScreen from "./TwoFactorScreen";
import type { LoginResponse, TwoFactorMethod } from "../../api/auth";
import type { PendingTwoFactor } from "../../hooks/useAuth";
import type { MockedFunction } from "jest-mock";

/*
 * THE SCREEN THE MOBILE APP DID NOT HAVE.
 *
 * Before this, an account with two factor authentication was answered by the
 * app with a sentence -- "not yet supported, sign in on the web dashboard" --
 * which for an on-call engineer is a refusal at the worst possible moment,
 * because the dashboard they are being sent to is the one with the incident on
 * it. So the assertions here are almost all about people who CANNOT get in,
 * and every one of them pins a way out that a plausible refactor would remove:
 *
 *   - The user with ONE authenticator app must land on the code field, not on
 *     a list of one. A list of one is ceremony, and ceremony in the middle of
 *     a page is how a sign-in gets abandoned.
 *   - The user with TWO must be asked which, and the id of the one they tapped
 *     must be the id that is sent. The server checks the code against the
 *     enrolment it is quoted; the wrong id is a refusal for a correct code,
 *     and there is nothing on screen that would let the user work that out.
 *   - The way out ("Lost access to your authenticator?") must be on EVERY
 *     challenge screen and must be offered REGARDLESS of the reported code
 *     count. That pair is OneUptime issue #3382 in mobile form: on the web the
 *     link lived on the picker only and was hidden from accounts with no
 *     codes, and since nothing minted codes back then, that meant hidden from
 *     nearly everybody.
 *   - backupCodeCount null means UNKNOWN, not zero. Zero is a claim the screen
 *     acts on -- it replaces the code field with "go and find an
 *     administrator" -- and making that claim because a count could not be
 *     read would send a user holding ten printed codes away from the one field
 *     that would have let them in.
 *   - A security key must be LISTED even though it cannot be used, and the
 *     account whose only factor is a security key must still reach recovery.
 *     That user is the one for whom this app is otherwise a dead end.
 *
 * The auth context is a stand-in so each test can hand the screen an exact
 * challenge and watch which verify function is called with what; the follow-up
 * decision (`decideTwoFactorFollowUp`) is deliberately NOT mocked, because
 * "which screen comes after a correct code" is behaviour this screen owns and
 * every wrong answer it can give is silent -- the user is simply signed in,
 * and finds out months later at the sign-in they cannot complete.
 */

type VerifyTotpAuth = (data: {
  twoFactorAuthId: string;
  code: string;
}) => Promise<LoginResponse>;

type VerifyBackupCode = (data: {
  backupCode: string;
}) => Promise<LoginResponse>;

type Navigate = (route: string, params?: unknown) => void;

type WasOfferSkipped = (data: { userId: string }) => Promise<boolean>;

const mockVerifyTotpAuth: MockedFunction<VerifyTotpAuth> =
  jest.fn<VerifyTotpAuth>();
const mockVerifyBackupCode: MockedFunction<VerifyBackupCode> =
  jest.fn<VerifyBackupCode>();
const mockCancelTwoFactor: MockedFunction<() => void> = jest.fn<() => void>();
const mockCompletePendingLogin: MockedFunction<() => void> =
  jest.fn<() => void>();
const mockNavigate: MockedFunction<Navigate> = jest.fn<Navigate>();
const mockWasBackupCodeOfferSkippedRecently: MockedFunction<WasOfferSkipped> =
  jest.fn<WasOfferSkipped>();

/*
 * The challenge in flight. Assigned per test and read lazily by the hook
 * stand-in below, because a jest.mock factory runs while the screen module is
 * still being required -- which is before anything declared in this file
 * exists.
 */
let mockPendingTwoFactor: PendingTwoFactor | null = null;

jest.mock("../../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return {
        pendingTwoFactor: mockPendingTwoFactor,
        verifyTotpAuth: mockVerifyTotpAuth,
        verifyBackupCode: mockVerifyBackupCode,
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

/*
 * The "stop asking me" snooze is storage-backed and has its own suite; here it
 * is a stand-in so the offer path is decided by this file rather than by
 * whatever an earlier test left in AsyncStorage.
 */
jest.mock("../../storage/backupCodeOffer", () => {
  return {
    wasBackupCodeOfferSkippedRecently: (data: {
      userId: string;
    }): Promise<boolean> => {
      return mockWasBackupCodeOfferSkippedRecently(data);
    },
  };
});

const PHONE_AUTHENTICATOR: TwoFactorMethod = {
  _id: "totp-phone",
  name: "iPhone Authenticator",
};

const LAPTOP_AUTHENTICATOR: TwoFactorMethod = {
  _id: "totp-laptop",
  name: "Laptop 1Password",
};

const SECURITY_KEY: TwoFactorMethod = {
  _id: "webauthn-yubikey",
  name: "YubiKey 5C",
};

const SIGNED_IN_USER_ID: string = "6653f0a0a0a0a0a0a0a0a0a1";

function challenge(
  overrides: Partial<PendingTwoFactor> = {},
): PendingTwoFactor {
  return {
    email: "oncall@acme.com",
    /* Held in memory by the context, never in navigation params. */
    password: "correct-horse-battery-staple",
    totpAuthList: [PHONE_AUTHENTICATOR],
    webAuthnList: [],
    backupCodeCount: 8,
    ...overrides,
  };
}

/** A second step the server accepted: the tokens are already stored. */
function accepted(overrides: Partial<LoginResponse> = {}): LoginResponse {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: "2026-09-30T00:00:00.000Z",
    user: {
      _id: SIGNED_IN_USER_ID,
      email: "oncall@acme.com",
      name: "On Call Engineer",
      isMasterAdmin: false,
    },
    ...overrides,
  };
}

async function renderChallenge(
  pending: PendingTwoFactor = challenge(),
): Promise<void> {
  mockPendingTwoFactor = pending;

  await render(<TwoFactorScreen />);
}

/*
 * Open the code field for a method, the way a person does: through the picker.
 *
 * The screen deliberately does NOT auto-select a single method, even though
 * skipping a list of one would save a tap. The flow is meant to be
 * recognisable to somebody who has signed in on the web, and a handset that
 * quietly starts a step further along than the browser did is a difference the
 * user has to discover mid-sign-in.
 */
async function openCodeEntryFor(method: TwoFactorMethod): Promise<void> {
  await fireEvent.press(screen.getByTestId(`totp-method-${method._id}`));
}

/*
 * Type a code and submit it, opening the code field first if the test has not
 * already done so.
 *
 * The screen opens on the picker for every account, single-method included --
 * see the first test for why -- so "get to the code field" is a step every one
 * of these cases needs and none of them is about. Tapping the FIRST
 * authenticator app keeps it honest for the two-method tests, which assert on
 * the id separately.
 */
async function typeCodeAndVerify(code: string): Promise<void> {
  if (!screen.queryByTestId("totp-code-input")) {
    await fireEvent.press(
      screen.getByTestId(`totp-method-${PHONE_AUTHENTICATOR._id}`),
    );
  }

  await fireEvent.changeText(screen.getByTestId("totp-code-input"), code);
  await fireEvent.press(screen.getByText("Verify"));
}

async function typeBackupCodeAndSignIn(code: string): Promise<void> {
  await fireEvent.press(screen.getByTestId("lost-access-link"));
  await fireEvent.changeText(screen.getByTestId("backup-code-input"), code);
  await fireEvent.press(screen.getByText("Sign In"));
}

beforeEach(() => {
  mockPendingTwoFactor = null;
  mockVerifyTotpAuth.mockResolvedValue(accepted());
  mockVerifyBackupCode.mockResolvedValue(accepted());
  mockWasBackupCodeOfferSkippedRecently.mockResolvedValue(false);
});

describe("An account with one authenticator app and nothing else", () => {
  test("is still shown the picker, exactly as the web sign-in is", async () => {
    /*
     * The common case, and the one place it would be tempting to diverge from
     * the browser: an account with a single method could be dropped straight
     * onto the code field.
     *
     * It is not, on purpose. Somebody who signs in on the web and then on
     * their phone should meet the same screens in the same order; a handset
     * that silently starts one step further along is a difference discovered
     * mid-sign-in, which is the wrong moment for one. What the single-method
     * account gets instead is the honest heading -- "Confirm it is you to
     * finish signing in" rather than an invitation to select from a list of
     * one -- which is the same wording the web screen uses.
     */
    await renderChallenge();

    expect(
      screen.getByTestId(`totp-method-${PHONE_AUTHENTICATOR._id}`),
    ).toBeTruthy();
    expect(screen.queryByTestId("totp-code-input")).toBeNull();
    expect(
      screen.getByText("Confirm it is you to finish signing in."),
    ).toBeTruthy();
  });

  test("and the code they type reaches that method's id", async () => {
    await renderChallenge();
    await openCodeEntryFor(PHONE_AUTHENTICATOR);
    await typeCodeAndVerify("123456");

    await waitFor(() => {
      expect(mockVerifyTotpAuth).toHaveBeenCalledWith({
        twoFactorAuthId: PHONE_AUTHENTICATOR._id,
        code: "123456",
      });
    });
  });

  test("the way out is on the code screen too, not only on the picker", async () => {
    /*
     * Half of issue #3382. On the web the recovery link lived on the picker
     * alone, so a user standing at a box asking for a code they cannot produce
     * was offered nothing but "pick a different method" -- which returns them
     * to a list of the methods they already cannot use.
     */
    await renderChallenge();
    await openCodeEntryFor(PHONE_AUTHENTICATOR);

    expect(screen.getByTestId("totp-code-input")).toBeTruthy();
    expect(screen.getByTestId("lost-access-link")).toBeTruthy();
  });
});

describe("An account with two authenticator apps", () => {
  function twoApps(): PendingTwoFactor {
    return challenge({
      totpAuthList: [PHONE_AUTHENTICATOR, LAPTOP_AUTHENTICATOR],
    });
  }

  test("is asked which one instead of being guessed for", async () => {
    await renderChallenge(twoApps());

    expect(
      screen.getByTestId(`totp-method-${PHONE_AUTHENTICATOR._id}`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`totp-method-${LAPTOP_AUTHENTICATOR._id}`),
    ).toBeTruthy();
    expect(screen.queryByTestId("totp-code-input")).toBeNull();
  });

  test("tapping one moves on to the code field", async () => {
    await renderChallenge(twoApps());

    await fireEvent.press(
      screen.getByTestId(`totp-method-${LAPTOP_AUTHENTICATOR._id}`),
    );

    expect(screen.getByTestId("totp-code-input")).toBeTruthy();
  });

  test("and the id sent is the id that was tapped", async () => {
    /*
     * The server checks the code against the enrolment it is quoted. Sending
     * the other one refuses a correct code, and nothing on this screen would
     * let the user work out why -- they would conclude their authenticator is
     * broken and stop trying.
     */
    await renderChallenge(twoApps());

    await fireEvent.press(
      screen.getByTestId(`totp-method-${LAPTOP_AUTHENTICATOR._id}`),
    );
    await typeCodeAndVerify("654321");

    await waitFor(() => {
      expect(mockVerifyTotpAuth).toHaveBeenCalledWith({
        twoFactorAuthId: LAPTOP_AUTHENTICATOR._id,
        code: "654321",
      });
    });
  });

  test("the picker carries the way out as well", async () => {
    /* The other half of #3382: recovery from the method list itself. */
    await renderChallenge(twoApps());

    expect(screen.getByTestId("lost-access-link")).toBeTruthy();
  });
});

describe("A security key, which this client cannot use", () => {
  test("is listed anyway, with the reason", async () => {
    /*
     * Hiding it would be worse than saying so. Its owner would open a two
     * factor screen missing the factor they registered and conclude the
     * account had been tampered with.
     */
    await renderChallenge(
      challenge({
        totpAuthList: [PHONE_AUTHENTICATOR],
        webAuthnList: [SECURITY_KEY],
      }),
    );

    const row: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
      `webauthn-method-${SECURITY_KEY._id}`,
    );

    expect(within(row).getByText(SECURITY_KEY.name)).toBeTruthy();
    expect(
      within(row).getByText(
        /security keys are not supported in the mobile app/i,
      ),
    ).toBeTruthy();
  });

  test("and does not auto-select the one authenticator app next to it", async () => {
    /*
     * Auto-selection is only right when there is genuinely nothing to choose.
     * Skipping the picker here would hide the key the user is looking for.
     */
    await renderChallenge(
      challenge({
        totpAuthList: [PHONE_AUTHENTICATOR],
        webAuthnList: [SECURITY_KEY],
      }),
    );

    expect(
      screen.getByTestId(`totp-method-${PHONE_AUTHENTICATOR._id}`),
    ).toBeTruthy();
    expect(screen.queryByTestId("totp-code-input")).toBeNull();
  });

  test("an account whose ONLY factor is a security key is told so and still gets out", async () => {
    /*
     * The one user for whom this app would otherwise be a flat dead end:
     * nothing to tap, nothing to type. The notice explains it and the recovery
     * link is the actual way in.
     */
    await renderChallenge(
      challenge({ totpAuthList: [], webAuthnList: [SECURITY_KEY] }),
    );

    expect(screen.getByTestId("security-key-only-notice")).toBeTruthy();
    expect(screen.getByTestId("lost-access-link")).toBeTruthy();
    expect(screen.queryByTestId("totp-code-input")).toBeNull();
  });

  test("and that route really opens the backup code field", async () => {
    await renderChallenge(
      challenge({
        totpAuthList: [],
        webAuthnList: [SECURITY_KEY],
        backupCodeCount: 3,
      }),
    );

    await fireEvent.press(screen.getByTestId("lost-access-link"));

    expect(screen.getByTestId("backup-code-input")).toBeTruthy();
  });
});

describe("The way out is offered whatever the code count says", () => {
  test("including to an account the server says has none", async () => {
    /*
     * The exact shape of issue #3382. Offering recovery only to accounts that
     * already have codes hides it from the only people who need to be told
     * anything at all.
     */
    await renderChallenge(challenge({ backupCodeCount: 0 }));

    expect(screen.getByTestId("lost-access-link")).toBeTruthy();
  });

  test("and an account with none is given the administrator reset, not a form", async () => {
    await renderChallenge(challenge({ backupCodeCount: 0 }));

    await fireEvent.press(screen.getByTestId("lost-access-link"));

    const guidance: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("no-backup-codes");

    expect(within(guidance).getByText(/ask an administrator/i)).toBeTruthy();
    expect(
      within(guidance).getByText(/reset two factor authentication/i),
    ).toBeTruthy();
    /*
     * A field that could only ever refuse them is worse than no field: it
     * reads as "you typed it wrong" rather than "there is nothing to type".
     */
    expect(screen.queryByTestId("backup-code-input")).toBeNull();
  });

  test("an account with codes gets the field, not the guidance", async () => {
    await renderChallenge(challenge({ backupCodeCount: 2 }));

    await fireEvent.press(screen.getByTestId("lost-access-link"));

    expect(screen.getByTestId("backup-code-input")).toBeTruthy();
    expect(screen.queryByTestId("no-backup-codes")).toBeNull();
  });

  test("and an UNKNOWN count gets the field too", async () => {
    /*
     * null is "the server did not say", not "there are none" -- the count is
     * omitted when it could not be read. Collapsing the two with a falsy check
     * sends a user holding ten printed codes to find an administrator on the
     * strength of a transient database fault, at the one moment they are
     * locked out.
     */
    await renderChallenge(challenge({ backupCodeCount: null }));

    await fireEvent.press(screen.getByTestId("lost-access-link"));

    expect(screen.getByTestId("backup-code-input")).toBeTruthy();
    expect(screen.queryByTestId("no-backup-codes")).toBeNull();
  });
});

describe("Submitting an authenticator code", () => {
  test("an empty one is refused here rather than by the server", async () => {
    /*
     * A round trip to be told "invalid code" for a code that was never typed
     * costs the user a failed attempt on an account that may lock out.
     */
    await renderChallenge();
    await openCodeEntryFor(PHONE_AUTHENTICATOR);

    await fireEvent.press(screen.getByText("Verify"));

    expect(
      await screen.findByText("Enter the code from your authenticator app."),
    ).toBeTruthy();
    expect(mockVerifyTotpAuth).not.toHaveBeenCalled();
  });

  test("whitespace alone counts as empty", async () => {
    await renderChallenge();
    await typeCodeAndVerify("   ");

    expect(
      await screen.findByText("Enter the code from your authenticator app."),
    ).toBeTruthy();
    expect(mockVerifyTotpAuth).not.toHaveBeenCalled();
  });

  test("a refused code says why and moves nobody on", async () => {
    /*
     * Navigating on a rejection is how a user ends up on a dashboard whose
     * every request is unauthorised; saying nothing is how they retype the
     * same code forever.
     */
    mockVerifyTotpAuth.mockRejectedValue(
      new Error("Invalid two factor authentication code."),
    );

    await renderChallenge();
    await typeCodeAndVerify("000000");

    expect(
      await screen.findByText("Invalid two factor authentication code."),
    ).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("and leaves the field on screen to try again", async () => {
    mockVerifyTotpAuth.mockRejectedValue(new Error("Invalid code."));

    await renderChallenge();
    await typeCodeAndVerify("000000");

    await screen.findByText("Invalid code.");

    expect(screen.getByTestId("totp-code-input")).toBeTruthy();
  });
});

describe("What happens once the second factor is accepted", () => {
  test("an account that already has codes is simply signed in", async () => {
    await renderChallenge(challenge({ backupCodeCount: 8 }));
    await typeCodeAndVerify("123456");

    await waitFor(() => {
      expect(mockCompletePendingLogin).toHaveBeenCalledTimes(1);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("a response carrying codes goes to the screen that shows them", async () => {
    /*
     * Those strings are in that one response and nowhere else, ever -- the
     * server keeps keyed digests. Completing the login instead of navigating
     * swaps the whole navigator and destroys them, and the account is left
     * holding ten codes nobody has ever seen, which reads everywhere else as
     * "you are covered".
     */
    mockVerifyTotpAuth.mockResolvedValue(
      accepted({ backupCodes: ["ABCDE-11111", "ABCDE-22222"] }),
    );

    await renderChallenge(challenge({ backupCodeCount: 8 }));
    await typeCodeAndVerify("123456");

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("BackupCodes", {
        mode: "show",
      });
    });

    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("an account with no recovery route is offered one", async () => {
    /*
     * Everybody who enrolled before codes existed, and everybody an admin has
     * just reset: one lost handset away from a support ticket and never told.
     * The offer is made at the one moment they are demonstrably thinking about
     * their second factor.
     */
    await renderChallenge(challenge({ backupCodeCount: 0 }));
    await typeCodeAndVerify("123456");

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("BackupCodes", {
        mode: "offer",
      });
    });

    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("the snooze is looked up for the user who just signed in", async () => {
    /*
     * A shared on-call handset is normal, so the snooze is per account. Asking
     * with the wrong id -- or with none -- silences the prompt for whoever
     * happens to sign in next, whose recovery posture is a different one.
     */
    await renderChallenge(challenge({ backupCodeCount: 0 }));
    await typeCodeAndVerify("123456");

    await waitFor(() => {
      expect(mockWasBackupCodeOfferSkippedRecently).toHaveBeenCalledWith({
        userId: SIGNED_IN_USER_ID,
      });
    });
  });

  test("and an offer this handset recently skipped is not made again", async () => {
    /*
     * The offer is a nudge, not a gate. Asked on every sign-in for the life of
     * the account it becomes a toll, and a toll is what gets dismissed without
     * being read.
     */
    mockWasBackupCodeOfferSkippedRecently.mockResolvedValue(true);

    await renderChallenge(challenge({ backupCodeCount: 0 }));
    await typeCodeAndVerify("123456");

    await waitFor(() => {
      expect(mockCompletePendingLogin).toHaveBeenCalledTimes(1);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("Signing in with a backup code", () => {
  test("the typed code is what is sent, trimmed", async () => {
    await renderChallenge(challenge({ backupCodeCount: 5 }));
    await typeBackupCodeAndSignIn("  ABCDE-12345  ");

    await waitFor(() => {
      expect(mockVerifyBackupCode).toHaveBeenCalledWith({
        backupCode: "ABCDE-12345",
      });
    });
  });

  test("an empty one is refused without a round trip", async () => {
    await renderChallenge(challenge({ backupCodeCount: 5 }));

    await fireEvent.press(screen.getByTestId("lost-access-link"));
    await fireEvent.press(screen.getByText("Sign In"));

    expect(
      await screen.findByText("Enter one of your backup codes."),
    ).toBeTruthy();
    expect(mockVerifyBackupCode).not.toHaveBeenCalled();
  });

  test("spending the LAST one leads to the offer, not straight in", async () => {
    /*
     * The count in the challenge was read before the code was spent, and a
     * backup code is single use -- that is the whole point of it. Passing the
     * stale count sails past the clearest "you are one lost handset from a
     * support ticket" moment this app will ever have: the user has just proved
     * it by using their last way in.
     */
    await renderChallenge(challenge({ backupCodeCount: 1 }));
    await typeBackupCodeAndSignIn("ABCDE-12345");

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("BackupCodes", {
        mode: "offer",
      });
    });

    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("but spending one of several does not", async () => {
    /*
     * The other side of the same arithmetic. Offering a fresh set to somebody
     * who still has four would invalidate the four they are holding, which is
     * a worse outcome than not asking.
     */
    await renderChallenge(challenge({ backupCodeCount: 5 }));
    await typeBackupCodeAndSignIn("ABCDE-12345");

    await waitFor(() => {
      expect(mockCompletePendingLogin).toHaveBeenCalledTimes(1);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("a refused backup code says so and does not sign anyone in", async () => {
    mockVerifyBackupCode.mockRejectedValue(
      new Error("This backup code has already been used."),
    );

    await renderChallenge(challenge({ backupCodeCount: 5 }));
    await typeBackupCodeAndSignIn("ABCDE-12345");

    expect(
      await screen.findByText("This backup code has already been used."),
    ).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });
});

describe("Getting back out of a screen", () => {
  test("the code field hands the user back to the method list", async () => {
    /*
     * Without this, a user who taps the wrong authenticator is stuck typing
     * codes that will never be accepted, with no visible reason.
     */
    await renderChallenge(
      challenge({ totpAuthList: [PHONE_AUTHENTICATOR, LAPTOP_AUTHENTICATOR] }),
    );

    await fireEvent.press(
      screen.getByTestId(`totp-method-${LAPTOP_AUTHENTICATOR._id}`),
    );
    await fireEvent.press(screen.getByTestId("back-to-methods"));

    expect(
      screen.getByTestId(`totp-method-${PHONE_AUTHENTICATOR._id}`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`totp-method-${LAPTOP_AUTHENTICATOR._id}`),
    ).toBeTruthy();
    expect(screen.queryByTestId("totp-code-input")).toBeNull();
  });

  test("and so does the recovery screen", async () => {
    /*
     * "Lost access" is a guess a user makes before they have checked their
     * pocket. A recovery screen with no way back turns that guess into a
     * restarted sign-in.
     */
    await renderChallenge(
      challenge({ totpAuthList: [PHONE_AUTHENTICATOR, LAPTOP_AUTHENTICATOR] }),
    );

    await fireEvent.press(screen.getByTestId("lost-access-link"));

    expect(screen.getByTestId("backup-code-input")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("back-to-methods"));

    expect(
      screen.getByTestId(`totp-method-${PHONE_AUTHENTICATOR._id}`),
    ).toBeTruthy();
    expect(screen.queryByTestId("backup-code-input")).toBeNull();
  });

  test("signing in as somebody else drops the held credentials", async () => {
    /*
     * The pending challenge holds a PLAINTEXT password, because every verify
     * route re-submits it -- there is no session until one of them succeeds.
     * Navigating away without cancelling leaves the previous user's password
     * in memory for the next person to use this handset, and leaves their
     * half-finished challenge live behind the login form.
     */
    await renderChallenge();

    await fireEvent.press(screen.getByTestId("sign-in-as-different-user"));

    expect(mockCancelTwoFactor).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("Login");
  });

  test("it is offered on the recovery screen too", async () => {
    /*
     * The user who reaches "you have no backup codes" is the most likely of
     * anybody to be signing in on somebody else's phone. Stranding them there
     * is the dead end this whole screen exists to remove.
     */
    await renderChallenge(challenge({ backupCodeCount: 0 }));

    await fireEvent.press(screen.getByTestId("lost-access-link"));

    expect(screen.getByTestId("no-backup-codes")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("sign-in-as-different-user"));

    expect(mockCancelTwoFactor).toHaveBeenCalledTimes(1);
  });
});
