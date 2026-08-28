import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import LoginScreen from "./LoginScreen";
import type { LoginResponse } from "../../api/auth";
import type { MockedFunction } from "jest-mock";

/*
 * WHAT THE LOGIN SCREEN DOES WITH A TWO FACTOR ANSWER.
 *
 * This screen used to end the story. An account with a second factor was met
 * with a sentence -- "two-factor authentication is not yet supported in the
 * mobile app, please use the web dashboard" -- which for an on-call engineer
 * is a refusal at the worst possible moment, because the dashboard they are
 * being sent to is the one with the incident on it. There is now a screen
 * behind each answer, and this file pins the routing decision that is the only
 * thing standing between the user and that dead end coming back.
 *
 * Every assertion here is about a way in that a plausible edit would remove:
 *
 *   - A `twoFactorRequired` answer has to NAVIGATE. If the branch is dropped,
 *     nothing on screen changes: the spinner stops, no error appears, and the
 *     Sign In button silently does nothing forever. That failure is invisible
 *     in a screenshot and invisible in a log, which is why the "no error is
 *     shown" assertions are paired with a navigation assertion rather than
 *     standing alone -- silence is only correct when the user has been moved.
 *   - The old apology is asserted ABSENT by pattern, not by exact string. It
 *     is the regression this whole feature exists to prevent, and it would
 *     come back as a slightly reworded sentence rather than as the original
 *     one.
 *   - ENROLMENT IS CHECKED FIRST, and the order is load-bearing. An account an
 *     administrator has forced to enrol has nothing set up yet, so its factor
 *     lists are EMPTY -- and the api layer sets `twoFactorRequired` on the
 *     enrolment branch as well, so a screen that tested the flags in the other
 *     order would send that user to the challenge screen, which would have no
 *     authenticator to offer and no code to accept. The both-flags test below
 *     is not a hypothetical shape: it is exactly what `login()` returns for a
 *     mandated setup.
 *   - A refused password must produce the SERVER's sentence, not axios's. The
 *     screen routes errors through `getFriendlyErrorMessage`; drop that and a
 *     user with a typo is told "Request failed with status code 400", which
 *     names nothing they can fix.
 *   - Empty credentials must never reach `login()`. The identity route answers
 *     a blank submission with the same 400 as a wrong password, so a screen
 *     that forwarded it would tell a user who typed nothing that their
 *     password was wrong.
 *
 * The auth context is a stand-in so each test can hand the screen an exact
 * answer from the password step and watch where it sends the user. What that
 * answer is parsed FROM (api/auth.ts) and what the destination screens then do
 * are covered by their own suites; this file owns only the fork between them.
 */

type Login = (email: string, password: string) => Promise<LoginResponse>;

type Navigate = (route: string, params?: unknown) => void;

const mockLogin: MockedFunction<Login> = jest.fn<Login>();
const mockSetNeedsServerUrl: jest.Mock<(value: boolean) => void> =
  jest.fn<(value: boolean) => void>();
const mockNavigate: MockedFunction<Navigate> = jest.fn<Navigate>();

/*
 * Read lazily inside the stand-ins: a jest.mock factory runs while the screen
 * module is still being required, which is before anything declared in this
 * file exists.
 */
jest.mock("../../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return {
        login: mockLogin,
        setNeedsServerUrl: mockSetNeedsServerUrl,
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

jest.mock("../../storage/serverUrl", () => {
  return {
    getServerUrl: async (): Promise<string> => {
      return "https://oneuptime.com";
    },
  };
});

/** A session the server issued outright, with no second factor in the way. */
function signedIn(): LoginResponse {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: "2026-09-04T00:00:00.000Z",
    user: {
      _id: "user-1",
      email: "engineer@acme.com",
      name: "On Call Engineer",
      isMasterAdmin: false,
    },
  };
}

/*
 * The password step accepted, and the server is now asking for a code. No
 * tokens: there is no session until the second step completes.
 */
function twoFactorChallenge(): LoginResponse {
  return {
    accessToken: "",
    refreshToken: "",
    refreshTokenExpiresAt: "",
    user: signedIn().user,
    twoFactorRequired: true,
    totpAuthList: [{ _id: "totp-phone", name: "Phone" }],
    webAuthnList: [],
    backupCodeCount: null,
  };
}

/*
 * A setup an administrator made mandatory. `twoFactorRequired` is deliberately
 * absent here so the enrolment flag is tested on its own; the realistic
 * both-flags shape gets its own test below.
 */
function enrolmentDemand(): LoginResponse {
  return {
    accessToken: "",
    refreshToken: "",
    refreshTokenExpiresAt: "",
    user: signedIn().user,
    twoFactorEnrolmentRequired: true,
    twoFactorAuthId: "pending-enrolment-1",
    twoFactorOtpUrl:
      "otpauth://totp/OneUptime:engineer@acme.com?secret=JBSWY3DPEHPK3PXP",
  };
}

interface RefusedRequest {
  isAxiosError: true;
  code?: string;
  response?: {
    status: number;
    data: Record<string, unknown>;
  };
}

/** A 400 shaped the way the identity route shapes one. */
function serverRefusal(message: string): RefusedRequest {
  return {
    isAxiosError: true,
    response: {
      status: 400,
      data: { message },
    },
  };
}

/*
 * Every sentence this screen is capable of putting in front of the user as an
 * error, plus the two the old dead end used. Asserting against the whole set
 * is what stops a "nothing was said" test from passing because it guessed the
 * wrong wording.
 */
const ANY_ERROR_MESSAGE: RegExp =
  /required|error|could not|failed|denied|timed out|not found|try again|not supported|web dashboard/i;

function expectNoErrorShown(): void {
  expect(screen.queryByText(ANY_ERROR_MESSAGE)).toBeNull();
}

/*
 * The dead end, matched loosely on purpose. It would not return as the
 * original sentence -- it would return as a reworded one.
 */
function expectNoApologyShown(): void {
  expect(screen.queryByText(/not (yet )?supported/i)).toBeNull();
  expect(screen.queryByText(/web dashboard/i)).toBeNull();
}

/** Renders the screen and waits for the on-mount server-url read to settle. */
async function renderScreen(): Promise<void> {
  /*
   * `render` is async in this version of the testing library and mounting is
   * what runs the effect below; not awaiting it leaves `screen` unattached and
   * every query in the file throwing "render has not been called".
   */
  await render(<LoginScreen />);

  /*
   * The server URL is read from storage in an effect, so it is the cheapest
   * proof that the first asynchronous paint has landed. Skipping this wait
   * makes every test in the file race the effect.
   */
  await screen.findByText("https://oneuptime.com");
}

/** Types both credentials and presses Sign In. */
async function signIn(
  email: string = "engineer@acme.com",
  password: string = "correct horse battery staple",
): Promise<void> {
  await fireEvent.changeText(
    screen.getByPlaceholderText("you@example.com"),
    email,
  );
  await fireEvent.changeText(
    screen.getByPlaceholderText("Your password"),
    password,
  );
  await fireEvent.press(screen.getByText("Sign In"));
}

beforeEach(() => {
  mockLogin.mockResolvedValue(signedIn());
});

describe("A password step the server answers with a challenge", () => {
  test("sends the user to the two factor screen", async () => {
    /*
     * The headline fix. Without this branch the press resolves into nothing:
     * no navigation, no message, no spinner - a Sign In button that does not
     * work and does not say so.
     */
    mockLogin.mockResolvedValue(twoFactorChallenge());

    await renderScreen();
    await signIn();

    expect(mockNavigate).toHaveBeenCalledWith("TwoFactor");
  });

  test("and nowhere else", async () => {
    mockLogin.mockResolvedValue(twoFactorChallenge());

    await renderScreen();
    await signIn();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test("without calling the challenge a failure", async () => {
    /*
     * A correct password that happens to belong to a protected account is not
     * an error. A message here reads as "your password was wrong", and the
     * user retypes a password that was right the first time.
     */
    mockLogin.mockResolvedValue(twoFactorChallenge());

    await renderScreen();
    await signIn();

    expectNoErrorShown();
  });

  test("and without the apology it replaced", async () => {
    /*
     * OneUptime issue #3382 in mobile form. This screen used to answer a
     * protected account with "not yet supported in the mobile app, please use
     * the web dashboard" and stop there.
     */
    mockLogin.mockResolvedValue(twoFactorChallenge());

    await renderScreen();
    await signIn();

    expectNoApologyShown();
  });
});

describe("A password step the server answers with a mandated enrolment", () => {
  test("sends the user to the enrolment screen", async () => {
    mockLogin.mockResolvedValue(enrolmentDemand());

    await renderScreen();
    await signIn();

    expect(mockNavigate).toHaveBeenCalledWith("TwoFactorEnrolment");
  });

  test("and never to the challenge screen, which would have nothing to offer", async () => {
    /*
     * An account being forced to enrol has no factors set up: its
     * `totpAuthList` is empty and there is no enrolment for a code to be
     * checked against. The challenge screen would render a picker with nothing
     * in it, which is the dead end again wearing a different shirt.
     */
    mockLogin.mockResolvedValue(enrolmentDemand());

    await renderScreen();
    await signIn();

    expect(mockNavigate).not.toHaveBeenCalledWith("TwoFactor");
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test("the enrolment check runs FIRST, so both flags still enrol", async () => {
    /*
     * Not a hypothetical payload: api/auth.ts sets `twoFactorRequired` on the
     * enrolment branch as well, precisely so the auth context carries the
     * pending credentials forward. That makes flag order the only thing
     * separating the two destinations - test `twoFactorRequired` first and
     * EVERY mandated enrolment lands on the challenge screen instead.
     */
    mockLogin.mockResolvedValue({
      ...enrolmentDemand(),
      twoFactorRequired: true,
    });

    await renderScreen();
    await signIn();

    expect(mockNavigate).toHaveBeenCalledWith("TwoFactorEnrolment");
    expect(mockNavigate).not.toHaveBeenCalledWith("TwoFactor");
  });

  test("and says nothing that reads as a refusal", async () => {
    mockLogin.mockResolvedValue({
      ...enrolmentDemand(),
      twoFactorRequired: true,
    });

    await renderScreen();
    await signIn();

    expectNoErrorShown();
    expectNoApologyShown();
  });
});

describe("A password step that simply succeeds", () => {
  test("navigates nowhere", async () => {
    /*
     * The auth context publishes the user, which swaps the whole navigator.
     * A navigate() here would push a screen onto a stack that is about to be
     * unmounted, and on the way past it would flash in front of the user.
     */
    mockLogin.mockResolvedValue(signedIn());

    await renderScreen();
    await signIn();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("and shows no error", async () => {
    mockLogin.mockResolvedValue(signedIn());

    await renderScreen();
    await signIn();

    expectNoErrorShown();
  });
});

describe("A password step the server refuses", () => {
  test("shows the server's own sentence, not the one axios made up", async () => {
    /*
     * "Request failed with status code 400" names nothing the user can act on.
     * The friendly-message extraction is what turns it into the reason.
     */
    mockLogin.mockRejectedValue(
      serverRefusal("Invalid login: please check your email and password."),
    );

    await renderScreen();
    await signIn();

    expect(
      await screen.findByText(
        "Invalid login: please check your email and password.",
      ),
    ).toBeTruthy();
  });

  test("and leaves the user on the login screen", async () => {
    mockLogin.mockRejectedValue(serverRefusal("Invalid login."));

    await renderScreen();
    await signIn();

    await screen.findByText("Invalid login.");

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("a phone with no connection is told that, not told its password is wrong", async () => {
    /*
     * A rejection with no response at all is the offline case. Reporting it as
     * a credential problem sends an on-call engineer hunting for a password
     * that was never the issue.
     */
    mockLogin.mockRejectedValue({
      isAxiosError: true,
      code: "ERR_NETWORK",
    } as RefusedRequest);

    await renderScreen();
    await signIn();

    expect(await screen.findByText(/network error/i)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("Credentials the screen refuses to send", () => {
  test("an empty email never reaches the server", async () => {
    /*
     * The identity route answers a blank submission with the same 400 it uses
     * for a wrong password, so forwarding it would tell a user who typed
     * nothing that their password was wrong.
     */
    await renderScreen();
    await signIn("", "correct horse battery staple");

    expect(mockLogin).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Email and password are required."),
    ).toBeTruthy();
  });

  test("an empty password never reaches the server either", async () => {
    await renderScreen();
    await signIn("engineer@acme.com", "");

    expect(mockLogin).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Email and password are required."),
    ).toBeTruthy();
  });

  test("whitespace counts as empty", async () => {
    /*
     * Phone keyboards insert spaces on their own often enough that a field
     * holding only them looks filled in to the person holding the handset.
     */
    await renderScreen();
    await signIn("   ", "   ");

    expect(mockLogin).not.toHaveBeenCalled();
  });

  test("and a refused submission navigates nowhere", async () => {
    await renderScreen();
    await signIn("", "");

    await screen.findByText("Email and password are required.");

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("What is sent when the credentials are accepted", () => {
  test("the email is trimmed but the password is sent exactly as typed", async () => {
    /*
     * Two different rules on purpose. A phone keyboard's trailing space in an
     * address would make a correct sign-in fail, so it goes; a space inside a
     * password is a CHARACTER OF THE PASSWORD, and trimming it locks out
     * anyone whose password manager generated one with an edge space - a
     * lockout with no message, because the server just says the password is
     * wrong.
     */
    mockLogin.mockResolvedValue(twoFactorChallenge());

    await renderScreen();
    await signIn("  engineer@acme.com  ", " spaced password ");

    expect(mockLogin).toHaveBeenCalledWith(
      "engineer@acme.com",
      " spaced password ",
    );
  });

  test("the challenge is asked for exactly once per press", async () => {
    /*
     * Two password submissions for one tap is two audit-log entries and, on an
     * instance with sign-in rate limiting, half the attempts the user thinks
     * they have.
     */
    mockLogin.mockResolvedValue(twoFactorChallenge());

    await renderScreen();
    await signIn();

    expect(mockLogin).toHaveBeenCalledTimes(1);
  });
});
