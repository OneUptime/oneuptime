import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { MockedFunction } from "jest-mock";
import ForgotPasswordScreen from "./ForgotPasswordScreen";

/*
 * THE HEADLINE PROPERTY OF THIS SCREEN IS THAT IT TELLS YOU NOTHING.
 *
 * A password reset form is an account oracle if it is honest. Type an address,
 * read "we have sent you a link" or "no account with that address", and you now
 * know which addresses exist on the instance - which for a self-hosted
 * OneUptime is a list of the company's engineers, harvestable one address at a
 * time by anybody who can reach the sign-in screen.
 *
 * The server therefore answers the same way for every well-formed address, and
 * this screen says the same sentence back regardless. That sentence is not a
 * nicety: it is the whole control. It hedges ("if that address has an
 * account") precisely because claiming a mail was sent would be a lie for half
 * the callers and a confirmation for the other half.
 *
 * So the assertions here are mostly about SAMENESS - that the words shown do
 * not vary with the address, are not derived from it, and never contain the
 * vocabulary of recognition. The rest cover the paths that get somebody to
 * that sentence, or back out of it: an empty submission, a request in flight,
 * a request that failed, and the way back to sign-in from either.
 *
 * `getFriendlyErrorMessage` is deliberately NOT mocked. What a failure reads
 * as, to the person holding the phone, is part of what this screen is for, and
 * a stand-in would let the test pass on a message nobody could act on.
 */

type RequestPasswordReset = (email: string) => Promise<void>;
type Navigate = (route: string) => void;

const mockRequestPasswordReset: MockedFunction<RequestPasswordReset> =
  jest.fn<RequestPasswordReset>();
const mockNavigate: MockedFunction<Navigate> = jest.fn<Navigate>();

jest.mock("../../api/auth", () => {
  return {
    requestPasswordReset: (email: string) => {
      return mockRequestPasswordReset(email);
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
 * The one sentence every successful submission produces, quoted in full and
 * asserted against exactly. A partial match would let a change that appended
 * "for oncall@acme.com" - or swapped the hedge for a claim - go on passing,
 * and that change is precisely the leak this screen exists to avoid.
 */
const SAME_ANSWER_FOR_EVERY_ADDRESS: string =
  "If that address has an account, we have emailed a link for resetting the " +
  "password. Open it on a device with a browser to finish.";

/* An address the instance does have an account for. */
const KNOWN_ADDRESS: string = "oncall@acme.example";

/* One it does not - the server answers both identically, and so must this. */
const UNKNOWN_ADDRESS: string = "nobody@acme.example";

/*
 * Words that would give the game away in either direction. Asserted as absent
 * over the whole screen rather than over one node, because a leak added to a
 * banner, a hint or a toast would be just as much of an oracle as one in the
 * subtitle.
 */
const RECOGNITION_VOCABULARY: RegExp =
  /no account|not found|does not exist|is not registered|unknown address|we have sent you/i;

function subtitleText(): string {
  const subtitle: { props: { children: string } } = screen.getByTestId(
    "forgot-password-subtitle",
  ) as unknown as { props: { children: string } };

  return subtitle.props.children;
}

async function typeEmail(email: string): Promise<void> {
  await fireEvent.changeText(
    screen.getByTestId("forgot-password-email-input"),
    email,
  );
}

/*
 * `fireEvent` resolves with the pressed handler's own promise, so awaiting it
 * runs the whole submit. The in-flight tests below must not await it, for the
 * same reason.
 */
async function pressSend(): Promise<void> {
  await fireEvent.press(screen.getByTestId("send-reset-link"));
}

/* Picks up whatever React queued on the way out of the handler. */
async function settleSubmit(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

async function submitAddress(email: string): Promise<void> {
  await typeEmail(email);
  await pressSend();
  await settleSubmit();
}

beforeEach(() => {
  /*
   * `clearMocks` in jest.config.js clears CALLS but not IMPLEMENTATIONS, so a
   * rejection or a deliberately hanging request from an earlier test would
   * otherwise decide this one.
   */
  mockRequestPasswordReset.mockReset();
  mockNavigate.mockReset();

  /* The server's contract: a well-formed address always resolves. */
  mockRequestPasswordReset.mockResolvedValue(undefined);
});

describe("The screen does not disclose whether an account exists", () => {
  test("an address with an account is answered with the hedged sentence", async () => {
    await render(<ForgotPasswordScreen />);

    await submitAddress(KNOWN_ADDRESS);

    expect(subtitleText()).toBe(SAME_ANSWER_FOR_EVERY_ADDRESS);
  });

  test("an address with no account is answered with the very same sentence", async () => {
    /*
     * The pair of tests is the point. The screen has nothing to branch on -
     * the request resolves either way - and this pins that it stays that way:
     * any wording derived from the address, or from anything the server said,
     * fails one of the two.
     */
    await render(<ForgotPasswordScreen />);

    await submitAddress(UNKNOWN_ADDRESS);

    expect(subtitleText()).toBe(SAME_ANSWER_FOR_EVERY_ADDRESS);
  });

  test("the confirmation hedges instead of claiming a mail was sent", async () => {
    await render(<ForgotPasswordScreen />);

    await submitAddress(KNOWN_ADDRESS);

    expect(subtitleText()).toMatch(/^If that address has an account/);
  });

  test("the address that was submitted is not echoed back", async () => {
    /*
     * Echoing it is harmless on its own, and that is what makes it dangerous:
     * it is the first step towards copy that is ABOUT the address, and the
     * second step is copy that differs by address.
     */
    await render(<ForgotPasswordScreen />);

    await submitAddress(KNOWN_ADDRESS);

    expect(subtitleText()).not.toContain(KNOWN_ADDRESS);
    expect(screen.queryByText(new RegExp(KNOWN_ADDRESS, "i"))).toBeNull();
  });

  test("nothing on the screen speaks of the address being recognised or not", async () => {
    await render(<ForgotPasswordScreen />);

    await submitAddress(UNKNOWN_ADDRESS);

    expect(screen.queryByText(RECOGNITION_VOCABULARY)).toBeNull();
  });

  test("the address is passed to the server unchanged apart from trimming", async () => {
    /*
     * The screen must not normalise, lower-case or otherwise pre-judge the
     * address: deciding locally which addresses are worth asking about is the
     * same oracle by another route.
     */
    await render(<ForgotPasswordScreen />);

    await submitAddress(`  ${KNOWN_ADDRESS}  `);

    expect(mockRequestPasswordReset).toHaveBeenCalledWith(KNOWN_ADDRESS);
    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(1);
  });
});

describe("Before anything has been sent", () => {
  test("there is a field, a send button and a way back to sign-in", async () => {
    await render(<ForgotPasswordScreen />);

    expect(screen.getByTestId("forgot-password-email-input")).toBeTruthy();
    expect(screen.getByTestId("send-reset-link")).toBeTruthy();
    expect(screen.getByTestId("back-to-sign-in")).toBeTruthy();
  });

  test("the subtitle says what pressing send will do", async () => {
    await render(<ForgotPasswordScreen />);

    expect(subtitleText()).toMatch(/we will send you a link to reset/i);
  });

  test("no error is shown before anything has been tried", async () => {
    await render(<ForgotPasswordScreen />);

    expect(
      screen.queryByText("Enter the email address on your account."),
    ).toBeNull();
  });
});

describe("Once the link has been requested", () => {
  test("the form is taken away, so the same address is not sent twice", async () => {
    await render(<ForgotPasswordScreen />);

    await submitAddress(KNOWN_ADDRESS);

    expect(screen.queryByTestId("forgot-password-email-input")).toBeNull();
    expect(screen.queryByTestId("send-reset-link")).toBeNull();
  });

  test("the way back to sign-in is still there", async () => {
    /*
     * It is the only control left on the screen at this point. Losing it would
     * strand the user on a confirmation with nowhere to go but the app
     * switcher.
     */
    await render(<ForgotPasswordScreen />);

    await submitAddress(KNOWN_ADDRESS);

    expect(screen.getByTestId("back-to-sign-in")).toBeTruthy();
  });

  test("the user is told to finish in a browser", async () => {
    /*
     * The reset itself is completed from the mailed link, in a browser, as on
     * the web - the token is a credential and is deliberately not deep-linked
     * into the handset app. A user who expects the app to take over here waits
     * for a screen that is never coming.
     */
    await render(<ForgotPasswordScreen />);

    await submitAddress(KNOWN_ADDRESS);

    expect(subtitleText()).toMatch(/device with a browser/i);
  });
});

describe("An empty submission", () => {
  test("asks for an address instead of asking the server about an empty one", async () => {
    await render(<ForgotPasswordScreen />);

    await pressSend();
    await settleSubmit();

    expect(
      screen.getByText("Enter the email address on your account."),
    ).toBeTruthy();
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });

  test("whitespace alone counts as empty", async () => {
    await render(<ForgotPasswordScreen />);

    await submitAddress("   ");

    expect(
      screen.getByText("Enter the email address on your account."),
    ).toBeTruthy();
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });

  test("the confirmation is not shown for a submission that never happened", async () => {
    await render(<ForgotPasswordScreen />);

    await pressSend();
    await settleSubmit();

    expect(subtitleText()).not.toBe(SAME_ANSWER_FOR_EVERY_ADDRESS);
    expect(screen.getByTestId("forgot-password-email-input")).toBeTruthy();
  });
});

describe("While the request is in flight", () => {
  let releaseRequest: () => void = (): void => {
    return undefined;
  };

  beforeEach(() => {
    mockRequestPasswordReset.mockImplementation((): Promise<void> => {
      return new Promise<void>((resolve: () => void): void => {
        releaseRequest = resolve;
      });
    });
  });

  /*
   * Not awaited: the request has not answered, and `fireEvent` resolves with
   * the handler's own promise. The `act` inside fireEvent is subscribed as
   * soon as the press is fired, so yielding a macrotask here - outside any act
   * of our own - is what makes the busy window observable.
   */
  async function pressSendWithoutWaiting(): Promise<void> {
    fireEvent.press(screen.getByTestId("send-reset-link"));

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  async function startRequest(): Promise<void> {
    await render(<ForgotPasswordScreen />);
    await typeEmail(KNOWN_ADDRESS);
    await pressSendWithoutWaiting();
  }

  async function finishRequest(): Promise<void> {
    releaseRequest();

    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
  }

  test("the send button reports itself busy rather than showing its label", async () => {
    await startRequest();

    expect(screen.queryByText("Send Reset Link")).toBeNull();

    await finishRequest();
  });

  test("a second press does not send a second request", async () => {
    /*
     * Two requests mean two reset mails for one address, which is the shape of
     * a message people report as suspicious - and an impatient second tap on a
     * slow connection is the normal case, not the exotic one.
     */
    await startRequest();

    await pressSendWithoutWaiting();
    await pressSendWithoutWaiting();

    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(1);

    await finishRequest();
  });

  test("the confirmation only appears once the request has answered", async () => {
    await startRequest();

    expect(subtitleText()).not.toBe(SAME_ANSWER_FOR_EVERY_ADDRESS);

    await finishRequest();

    expect(subtitleText()).toBe(SAME_ANSWER_FOR_EVERY_ADDRESS);
  });
});

describe("When the request fails", () => {
  /*
   * The failure path is reachable for a malformed address - this screen does
   * no format checking of its own, so "notanemail" is submitted like any other
   * string and it is the server that objects - and for a server that could not
   * be reached at all. Neither of those tells anybody which accounts exist,
   * which is why relaying the server's own words here is safe.
   */
  function serverRejection(message: string): unknown {
    return {
      isAxiosError: true,
      response: { status: 400, data: { message } },
    };
  }

  test("the server's own explanation is what the user reads", async () => {
    mockRequestPasswordReset.mockRejectedValue(
      serverRejection("Email is not in valid format."),
    );

    await render(<ForgotPasswordScreen />);

    await submitAddress("notanemail");

    expect(screen.getByText("Email is not in valid format.")).toBeTruthy();
  });

  test("a server that could not be reached is explained in those terms", async () => {
    mockRequestPasswordReset.mockRejectedValue({
      isAxiosError: true,
      code: "ERR_NETWORK",
    });

    await render(<ForgotPasswordScreen />);

    await submitAddress(KNOWN_ADDRESS);

    expect(
      screen.getByText(/check your internet connection and server URL/i),
    ).toBeTruthy();
  });

  test("the confirmation is not shown, so nobody waits for a mail that is not coming", async () => {
    mockRequestPasswordReset.mockRejectedValue(
      serverRejection("Email is not in valid format."),
    );

    await render(<ForgotPasswordScreen />);

    await submitAddress("notanemail");

    expect(subtitleText()).not.toBe(SAME_ANSWER_FOR_EVERY_ADDRESS);
  });

  test("the form stays, so the address can be corrected and sent again", async () => {
    mockRequestPasswordReset.mockRejectedValue(
      serverRejection("Email is not in valid format."),
    );

    await render(<ForgotPasswordScreen />);

    await submitAddress("notanemail");

    expect(screen.getByTestId("forgot-password-email-input")).toBeTruthy();
    expect(screen.getByTestId("send-reset-link")).toBeTruthy();
  });

  test("editing the address clears the previous failure", async () => {
    /*
     * An error left standing over an address the user has since changed reads
     * as a verdict on the new one, and correcting the address is the only
     * thing anybody does next on this screen.
     */
    mockRequestPasswordReset.mockRejectedValue(
      serverRejection("Email is not in valid format."),
    );

    await render(<ForgotPasswordScreen />);

    await submitAddress("notanemail");

    expect(screen.getByText("Email is not in valid format.")).toBeTruthy();

    await typeEmail(KNOWN_ADDRESS);

    expect(screen.queryByText("Email is not in valid format.")).toBeNull();
  });

  test("a corrected address can be sent, and reaches the confirmation", async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      serverRejection("Email is not in valid format."),
    );
    mockRequestPasswordReset.mockResolvedValue(undefined);

    await render(<ForgotPasswordScreen />);

    await submitAddress("notanemail");
    await submitAddress(KNOWN_ADDRESS);

    expect(subtitleText()).toBe(SAME_ANSWER_FOR_EVERY_ADDRESS);
  });
});

describe("The way back to sign-in", () => {
  test("returns to the sign-in screen", async () => {
    await render(<ForgotPasswordScreen />);

    await fireEvent.press(screen.getByTestId("back-to-sign-in"));

    expect(mockNavigate).toHaveBeenCalledWith("Login");
  });

  test("is offered as a button to a screen reader", async () => {
    /*
     * It is a bare `TouchableOpacity` around a line of text, which without the
     * role is announced as static text - so the one route off this screen is
     * invisible to anybody navigating by control.
     */
    await render(<ForgotPasswordScreen />);

    expect(
      screen.getByRole("button", { name: "Back to sign in" }),
    ).toBeTruthy();
  });

  test("still works after the link has been requested", async () => {
    await render(<ForgotPasswordScreen />);

    await submitAddress(KNOWN_ADDRESS);
    await fireEvent.press(screen.getByTestId("back-to-sign-in"));

    expect(mockNavigate).toHaveBeenCalledWith("Login");
  });
});
