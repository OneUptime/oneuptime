import React from "react";
import { Linking } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TwoFactorEnrolmentScreen from "./TwoFactorEnrolmentScreen";
import { secretFromOtpUrl } from "../../auth/otpUrl";
import type { LoginResponse } from "../../api/auth";
import type { PendingTwoFactor } from "../../hooks/useAuth";
import type { MockedFunction } from "jest-mock";

/*
 * THE SCREEN AN ADMINISTRATOR'S "TWO FACTOR IS MANDATORY" SWITCH LANDS ON.
 *
 * There is NO SESSION here. The user has proved a password and nothing else;
 * the server hands back a session only when the code below verifies. So every
 * failure on this screen is a locked-out user rather than an inconvenienced
 * one -- they cannot skip it, cannot go back to a signed-in app, and on the
 * mobile app cannot be waved off to the web dashboard, because the dashboard
 * is the thing they are trying to reach.
 *
 * The web sign-in solves "get this secret into an authenticator" with a QR
 * code. Copying that here would have been the one presentation guaranteed not
 * to work, because a handset cannot scan its own screen. This screen has two
 * routes instead, and this file exists because each of them is the ONLY route
 * for some real user:
 *
 *   - The otpauth:// LINK, handed to whichever authenticator app is installed.
 *     It has to be passed through byte for byte: an authenticator PARSES that
 *     URL, and a mangled one enrols a secret the server will never accept. The
 *     user then types six digits that are refused forever, with nothing on
 *     either screen that would let them work out why.
 *   - The printed SETUP KEY, for the user whose authenticator lives on another
 *     device, and for the handset where nothing claims otpauth:// at all. That
 *     second case is not exotic: it is every phone with no authenticator
 *     installed, which is most phones the first time an admin flips the
 *     switch. `Linking.openURL` REJECTS there, and a screen that let the
 *     rejection stand would leave those users with a button that does nothing
 *     and no stated alternative.
 *
 * The rest of the file is about what happens AFTER the code is accepted, which
 * is the mobile half of OneUptime issue #3382. The enrolment response is the
 * only copy of the recovery codes that will ever exist anywhere -- the server
 * keeps keyed digests -- so navigating past it destroys them, and the account
 * is left one lost handset away from a support ticket while every screen
 * reports it as covered. `decideTwoFactorFollowUp` is deliberately NOT mocked:
 * which screen comes next is the behaviour under test, and every wrong answer
 * it can give is silent.
 *
 * The auth context is a stand-in so each test can hand the screen an exact
 * server answer and watch what it does with it. `secretFromOtpUrl` is real,
 * because "the key on screen is the key in the URL" is worth nothing asserted
 * against a fake that was told the answer.
 */

type VerifyTotpEnrolment = (data: { code: string }) => Promise<LoginResponse>;

type Navigate = (route: string, params?: unknown) => void;

type OpenUrl = (url: string) => Promise<boolean>;

const mockVerifyTotpEnrolment: MockedFunction<VerifyTotpEnrolment> =
  jest.fn<VerifyTotpEnrolment>();
const mockCancelTwoFactor: MockedFunction<() => void> = jest.fn<() => void>();
const mockCompletePendingLogin: MockedFunction<() => void> =
  jest.fn<() => void>();
const mockNavigate: MockedFunction<Navigate> = jest.fn<Navigate>();
const mockOpenUrl: MockedFunction<OpenUrl> = jest.fn<OpenUrl>();

/*
 * The enrolment in flight. Assigned per test and read lazily by the hook
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
        verifyTotpEnrolment: mockVerifyTotpEnrolment,
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
 * A real otpauth:// URL, shaped the way the server builds one: the label
 * carries the issuer and the account, and `secret` is followed by more
 * parameters. Both details matter -- a naive "everything after secret=" hands
 * the user the issuer as part of their key, and a URL rebuilt from parts by
 * the screen enrols the wrong account name in the authenticator's list.
 */
const OTP_URL: string =
  "otpauth://totp/OneUptime:responder@everythingcorp.example" +
  "?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime&algorithm=SHA1&digits=6&period=30";

const OTP_SECRET: string = "JBSWY3DPEHPK3PXP";

const EMPTY_CODE_MESSAGE: string =
  "Enter the code your authenticator app is showing.";

const REFUSED_CODE_MESSAGE: string = "Invalid code. Please try again.";

/*
 * Matched on its opening clause rather than in full. The rest of the sentence
 * is the thing under test in the first case below -- pinning it here as well
 * would make the assertion tautological -- and a bare /setup key/ would also
 * match the "Or add this setup key by hand" heading that is on screen from the
 * start, which is not evidence of anything.
 */
const NO_AUTHENTICATOR_MESSAGE: RegExp = /no authenticator app on this device/i;

/** The text of the "nothing opened that link" error currently on screen. */
function shownOpenFailure(): string {
  return screen.getByText(NO_AUTHENTICATOR_MESSAGE).props.children as string;
}

function pendingEnrolment(
  overrides: Partial<PendingTwoFactor> = {},
): PendingTwoFactor {
  return {
    email: "responder@everythingcorp.example",
    password: "correct-horse-battery-staple",

    /*
     * Empty on purpose. An account being FORCED to enrol has nothing enrolled
     * yet, so there is no factor to challenge it on -- which is exactly why
     * the login parser checks the enrolment branch before the factor lists.
     */
    totpAuthList: [],
    webAuthnList: [],
    backupCodeCount: null,
    enrolment: {
      twoFactorAuthId: "pending-enrolment-1",
      twoFactorOtpUrl: OTP_URL,
    },
    ...overrides,
  };
}

/** What the server sends back once the first correct code arrives. */
function enrolmentAccepted(
  overrides: Partial<LoginResponse> = {},
): LoginResponse {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: "2026-09-28T00:00:00.000Z",
    user: {
      _id: "user-1",
      email: "responder@everythingcorp.example",
      name: "On Call Responder",
      isMasterAdmin: false,
    },
    ...overrides,
  };
}

/*
 * An axios-shaped refusal, because that is the shape the api layer throws and
 * the reason the screen runs it through getFriendlyErrorMessage. A screen that
 * printed the raw error would put "Request failed with status code 400" in
 * front of someone who mistyped one digit.
 */
function serverRefusal(message: string): unknown {
  return {
    isAxiosError: true,
    response: { status: 400, data: { message } },
  };
}

async function renderScreen(): Promise<void> {
  await render(<TwoFactorEnrolmentScreen />);
}

async function typeCode(code: string): Promise<void> {
  await fireEvent.changeText(screen.getByTestId("enrolment-code-input"), code);
}

async function pressVerify(): Promise<void> {
  await fireEvent.press(screen.getByText("Verify and Sign In"));
}

async function pressAddToAuthenticator(): Promise<void> {
  await fireEvent.press(screen.getByText("Add to Authenticator App"));
}

/** What the screen actually printed as the setup key, or null if it printed none. */
function printedSetupKey(): string | null {
  const element: ReturnType<typeof screen.queryByTestId> =
    screen.queryByTestId("enrolment-secret");

  if (!element) {
    return null;
  }

  return element.props.children as string;
}

beforeEach(() => {
  mockPendingTwoFactor = pendingEnrolment();
  mockVerifyTotpEnrolment.mockResolvedValue(enrolmentAccepted());
  mockOpenUrl.mockResolvedValue(true);

  jest
    .spyOn(Linking, "openURL")
    .mockImplementation((url: string): Promise<boolean> => {
      return mockOpenUrl(url);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Handing the enrolment to an authenticator app", () => {
  test("opens the otpauth:// URL exactly as the server sent it", async () => {
    /*
     * Verbatim, character for character. The authenticator app parses this --
     * the secret, the issuer, the digit count and the period all come out of
     * it -- so a URL that has been re-encoded, trimmed, lower-cased or rebuilt
     * from parts enrols a secret that generates codes the server will refuse
     * forever. Both devices then look correct and neither of them is.
     */
    await renderScreen();

    await pressAddToAuthenticator();

    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith(OTP_URL);
    });

    expect(mockOpenUrl).toHaveBeenCalledTimes(1);
  });

  test("then tells the user to come back and type the code", async () => {
    /*
     * Opening the link sends the user OUT of the app. Without this line they
     * come back to a screen they have already "finished" and have to guess
     * that the six digits now on the other app belong in the field below.
     */
    await renderScreen();

    await pressAddToAuthenticator();

    expect(await screen.findByTestId("opened-authenticator-hint")).toBeTruthy();
  });

  test("and says nothing of the sort before the link is used", async () => {
    /*
     * The hint is a claim about something that happened. Rendering it
     * unconditionally sends a user who never left the app off to read a code
     * from an authenticator that was never set up.
     */
    await renderScreen();

    expect(screen.queryByTestId("opened-authenticator-hint")).toBeNull();
  });
});

describe("A handset with no authenticator app installed", () => {
  /*
   * `Linking.openURL` rejects when nothing on the device claims the scheme,
   * which is every phone that has not installed an authenticator yet -- most
   * phones, the first time an administrator makes two factor mandatory. The
   * link is the headline route on this screen, so its failure has to hand the
   * user the other one rather than leaving a button that does nothing.
   */
  beforeEach(() => {
    mockOpenUrl.mockRejectedValue(
      new Error("No Activity found to handle Intent"),
    );
  });

  test("names the setup key as the way through", async () => {
    await renderScreen();

    await pressAddToAuthenticator();

    await screen.findByText(NO_AUTHENTICATOR_MESSAGE);

    expect(shownOpenFailure()).toContain("setup key");
  });

  test("and the setup key it points at is actually on screen", async () => {
    /*
     * The message says "add the setup key below". If the key were not
     * rendered, that sentence points at nothing and this is a dead end with
     * extra words.
     */
    await renderScreen();

    await pressAddToAuthenticator();

    await screen.findByText(NO_AUTHENTICATOR_MESSAGE);

    expect(printedSetupKey()).toBe(OTP_SECRET);
  });

  test("does not claim the authenticator was opened", async () => {
    await renderScreen();

    await pressAddToAuthenticator();

    await screen.findByText(NO_AUTHENTICATOR_MESSAGE);

    expect(screen.queryByTestId("opened-authenticator-hint")).toBeNull();
  });

  test("and the enrolment can still be finished by hand", async () => {
    /*
     * The whole reason this is a fallback rather than an error: a failed
     * openURL must not disable, clear or block the code field, because typing
     * the key in by hand and then typing the code back is the entire remaining
     * path to a working account.
     */
    await renderScreen();

    await pressAddToAuthenticator();

    await screen.findByText(NO_AUTHENTICATOR_MESSAGE);

    await typeCode("123456");
    await pressVerify();

    await waitFor(() => {
      expect(mockVerifyTotpEnrolment).toHaveBeenCalledWith({ code: "123456" });
    });
  });
});

describe("The setup key printed for manual entry", () => {
  test("is the secret carried by the otpauth URL", async () => {
    /*
     * Asserted against BOTH the extractor and the literal. Against the
     * extractor alone, a regex that started returning the issuer would keep
     * this green; against the literal alone, a screen that stopped using the
     * extractor at all would.
     */
    await renderScreen();

    expect(printedSetupKey()).toBe(OTP_SECRET);
    expect(printedSetupKey()).toBe(secretFromOtpUrl(OTP_URL));
  });

  test("carries nothing else smuggled out of the URL with it", async () => {
    /*
     * A key with the issuer or the period appended is rejected by every
     * authenticator, and the rejection reads as "OneUptime gave me a bad key"
     * rather than as a parsing bug in the app.
     */
    await renderScreen();

    expect(printedSetupKey()).not.toContain("issuer");
    expect(printedSetupKey()).not.toContain("period");
    expect(printedSetupKey()).not.toContain("&");
  });

  test("is left out entirely when the URL carries no secret to print", async () => {
    /*
     * An empty box under "Or add this setup key by hand" is an invitation to
     * copy nothing and an accusation that the app lost the key. The link is
     * still a working route in that state, so it stays.
     */
    mockPendingTwoFactor = pendingEnrolment({
      enrolment: {
        twoFactorAuthId: "pending-enrolment-1",
        twoFactorOtpUrl: "otpauth://totp/OneUptime:responder@example.com",
      },
    });

    await renderScreen();

    expect(screen.queryByTestId("enrolment-secret")).toBeNull();

    await pressAddToAuthenticator();

    await waitFor(() => {
      expect(mockOpenUrl).toHaveBeenCalledWith(
        "otpauth://totp/OneUptime:responder@example.com",
      );
    });
  });
});

describe("A code that was never typed", () => {
  test("is refused with a message rather than silently", async () => {
    /*
     * A press that does nothing at all reads as a broken button, on a screen
     * the user is not allowed to leave.
     */
    await renderScreen();

    await pressVerify();

    expect(await screen.findByText(EMPTY_CODE_MESSAGE)).toBeTruthy();
  });

  test("and the server is never asked", async () => {
    /*
     * The request re-submits the email and PASSWORD -- there is no session yet
     * -- so an empty-code round trip spends a credential submission on a
     * request that cannot succeed, and repeated presses are what trip a
     * server-side login rate limit on the one account that cannot afford it.
     */
    await renderScreen();

    await pressVerify();

    await screen.findByText(EMPTY_CODE_MESSAGE);

    expect(mockVerifyTotpEnrolment).not.toHaveBeenCalled();
  });

  test("a code of nothing but spaces counts as never typed", async () => {
    await renderScreen();

    await typeCode("   ");
    await pressVerify();

    expect(await screen.findByText(EMPTY_CODE_MESSAGE)).toBeTruthy();
    expect(mockVerifyTotpEnrolment).not.toHaveBeenCalled();
  });
});

describe("Finishing the enrolment", () => {
  test("surrounding whitespace is trimmed off the code", async () => {
    /*
     * Phone keyboards and paste-from-authenticator both append a space often
     * enough that not trimming would refuse a correct code -- on the screen
     * where a refusal has no way around it.
     */
    await renderScreen();

    await typeCode("  123456 ");
    await pressVerify();

    await waitFor(() => {
      expect(mockVerifyTotpEnrolment).toHaveBeenCalledWith({ code: "123456" });
    });
  });

  test("minted recovery codes go to the screen that shows them", async () => {
    /*
     * This response is the only copy that will ever exist -- the server keeps
     * keyed digests and cannot re-display them. Signing the user straight in
     * here mints ten codes nobody ever sees, and every screen afterwards
     * reports the account as covered.
     */
    mockVerifyTotpEnrolment.mockResolvedValue(
      enrolmentAccepted({
        backupCodes: ["aaaa-1111", "bbbb-2222", "cccc-3333"],
      }),
    );

    await renderScreen();

    await typeCode("123456");
    await pressVerify();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("BackupCodes", {
        mode: "show",
      });
    });
  });

  test("and the app is not signed in while they are still on screen", async () => {
    /*
     * `completePendingLogin` swaps the whole navigator for the dashboard.
     * Calling it alongside the navigate would replace a set of show-once codes
     * with a monitor list, and the codes would be gone.
     */
    mockVerifyTotpEnrolment.mockResolvedValue(
      enrolmentAccepted({ backupCodes: ["aaaa-1111"] }),
    );

    await renderScreen();

    await typeCode("123456");
    await pressVerify();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });

    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("codes in hand win even when the account already had a set", async () => {
    /*
     * Both flags arriving together should not happen, but if they do the
     * plaintext codes are the half that cannot be recovered. Checking
     * `hasBackupCodes` first would sign the user in and drop them.
     */
    mockVerifyTotpEnrolment.mockResolvedValue(
      enrolmentAccepted({
        backupCodes: ["aaaa-1111"],
        hasBackupCodes: true,
      }),
    );

    await renderScreen();

    await typeCode("123456");
    await pressVerify();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("BackupCodes", {
        mode: "show",
      });
    });

    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("an account that already had codes is signed straight in", async () => {
    /*
     * `hasBackupCodes` means the server minted nothing BECAUSE a set already
     * exists. Offering to generate here would replace the set the user printed
     * and carried around, voiding it without ever saying so -- the exact way
     * to turn a recovery route into a lockout.
     */
    mockVerifyTotpEnrolment.mockResolvedValue(
      enrolmentAccepted({ hasBackupCodes: true }),
    );

    await renderScreen();

    await typeCode("123456");
    await pressVerify();

    await waitFor(() => {
      expect(mockCompletePendingLogin).toHaveBeenCalledTimes(1);
    });
  });

  test("and is not detoured through the backup codes screen", async () => {
    mockVerifyTotpEnrolment.mockResolvedValue(
      enrolmentAccepted({ hasBackupCodes: true }),
    );

    await renderScreen();

    await typeCode("123456");
    await pressVerify();

    await waitFor(() => {
      expect(mockCompletePendingLogin).toHaveBeenCalled();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("an enrolment that minted nothing lands on the offer", async () => {
    /*
     * No codes in the response and no claim that a set already exists means
     * minting failed, and this account -- which has just been given a second
     * factor it must use from now on -- has NO recovery route at all. This is
     * the last moment the app will have the user's attention on the subject.
     */
    await renderScreen();

    await typeCode("123456");
    await pressVerify();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("BackupCodes", {
        mode: "offer",
      });
    });

    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("an empty array of codes is nothing minted, not codes to show", async () => {
    /*
     * A "show" screen with no codes on it is a dead end the user cannot
     * honestly dismiss, and it costs them the offer they should have had.
     */
    mockVerifyTotpEnrolment.mockResolvedValue(
      enrolmentAccepted({ backupCodes: [] }),
    );

    await renderScreen();

    await typeCode("123456");
    await pressVerify();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("BackupCodes", {
        mode: "offer",
      });
    });
  });
});

describe("An enrolment the server refuses", () => {
  beforeEach(() => {
    mockVerifyTotpEnrolment.mockRejectedValue(
      serverRefusal(REFUSED_CODE_MESSAGE),
    );
  });

  test("shows the server's own words", async () => {
    /*
     * "Invalid code" and "your clock is out of sync" are different problems
     * with different fixes, and the server is the only thing that knows which.
     * A generic message here sends the user off to reinstall an authenticator
     * that was working.
     */
    await renderScreen();

    await typeCode("000000");
    await pressVerify();

    expect(await screen.findByText(REFUSED_CODE_MESSAGE)).toBeTruthy();
  });

  test("and goes nowhere", async () => {
    /*
     * A rejected code means no session was issued. Navigating on would park
     * the user behind a "you are signed in" flow with no tokens, and there is
     * no back out of it.
     */
    await renderScreen();

    await typeCode("000000");
    await pressVerify();

    await screen.findByText(REFUSED_CODE_MESSAGE);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockCompletePendingLogin).not.toHaveBeenCalled();
  });

  test("leaves the user able to try again", async () => {
    /*
     * The loading flag disables the button. A rejection that failed to clear
     * it would leave a permanently dead Verify button on a screen whose only
     * other exit is signing in as somebody else.
     */
    await renderScreen();

    await typeCode("000000");
    await pressVerify();

    await screen.findByText(REFUSED_CODE_MESSAGE);

    mockVerifyTotpEnrolment.mockResolvedValue(
      enrolmentAccepted({ hasBackupCodes: true }),
    );

    await typeCode("123456");
    await pressVerify();

    await waitFor(() => {
      expect(mockCompletePendingLogin).toHaveBeenCalled();
    });
  });

  test("and the stale message does not sit over the retry", async () => {
    /*
     * A refusal still on screen while the code being typed is the right one is
     * how a user abandons an enrolment that was about to work.
     */
    await renderScreen();

    await typeCode("000000");
    await pressVerify();

    await screen.findByText(REFUSED_CODE_MESSAGE);

    await typeCode("123456");

    await waitFor(() => {
      expect(screen.queryByText(REFUSED_CODE_MESSAGE)).toBeNull();
    });
  });
});

describe("Backing out of a mandated enrolment", () => {
  test("drops the credentials the next attempt would re-submit", async () => {
    /*
     * The pending challenge holds a PLAINTEXT PASSWORD, because every verify
     * route re-submits it -- there is no session until one of them succeeds.
     * Leaving it behind lets the previous account's password ride along into
     * whatever the next person on this handset does.
     */
    await renderScreen();

    await fireEvent.press(screen.getByTestId("sign-in-as-different-user"));

    await waitFor(() => {
      expect(mockCancelTwoFactor).toHaveBeenCalledTimes(1);
    });
  });

  test("and returns to the login screen", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId("sign-in-as-different-user"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("Login");
    });
  });
});
