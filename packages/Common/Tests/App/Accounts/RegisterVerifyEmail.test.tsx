import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import User from "../../../Models/DatabaseModels/User";
import { RevenueEventName } from "../../../Types/Analytics/RevenueEvent";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import * as UIConfig from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import UiAnalytics from "../../../UI/Utils/Analytics";
import LoginUtil from "../../../UI/Utils/Login";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";

/*
 * A hosted signup that ends on "verify your email", driven through the real
 * Register -> ModelForm -> BasicForm stack with only the network, analytics
 * and navigation mocked.
 *
 * On the hosted service /signup creates the account but starts no session:
 * it answers `emailVerificationRequired` and, when it could mint one, a
 * resend token plus how long until the first resend is allowed. The page has
 * to (a) not log anybody in, (b) show the address the link went to, and
 * (c) wire the resend button to that token with that wait. And when the
 * address was mistyped, "Sign up with a different email" has to bring the
 * form back filled in -- minus the secrets -- without counting the visitor
 * twice in the signup funnel.
 *
 * TYPING AN EMAIL. RegisterPassword.test.tsx notes that the shared Email
 * input loses synthetic paste events in jsdom (user-event cannot place a
 * selection in an <input type="email">), which is why it prefills the
 * address through ?email=. A change event carries the value just fine, so
 * the flows below that need an editable address set it with
 * fireEvent.change; everything else is typed or pasted as a person would.
 *
 * THE CLOCK. The form is filled on the real clock; the fake one is switched
 * on just before submitting, so the resend countdown that starts with the
 * verification screen only moves when a test advances it -- and never ticks
 * outside act() while a test is still looking at the page.
 */

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Config",
    ) as typeof import("../../../UI/Config")),
    __esModule: true,
    BILLING_ENABLED: true,
    CAPTCHA_ENABLED: false,
  };
});

const EMAIL: string = "ada@example.com";
const TYPO_EMAIL: string = "ada@exmaple.com";
const NAME: string = "Ada Lovelace";
const COMPANY: string = "Analytical Engines";
const PHONE: string = "+14155552671";
const PASSWORD: string = "lantern river meadow";
const RESEND_TOKEN: string =
  "v1.eyJ2IjoxLCJ1IjoiMzMzMyJ9.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmUtc2ln";

// Straight out of en.json.
const TITLE: string = "Verify your email to finish signing up";
const SPAM_HINT: string =
  "Can't find it? Check your spam or junk folder. The link expires in 24 hours.";
const SIGN_IN_FALLBACK_HINT: string =
  "Can't find it? Check your spam folder. The link expires in 24 hours, and signing in with your email and password sends you a new one.";
const SENT: string =
  "We've sent a new verification link. It can take a minute or two to arrive.";
const SENT_TO: (email: string) => string = (email: string): string => {
  return `We've sent a verification link to ${email}.`;
};

type CountdownFunction = (time: string) => string;

const countdown: CountdownFunction = (time: string): string => {
  return `You can request another email in ${time}.`;
};

/*
 * Printed by React for BasicForm's own validation (see the other Register
 * tests); this suite only insists that nothing it added shows up here.
 */
const OWN_COMPONENTS: Array<string> = [
  "ResendVerificationEmail",
  "VerifyEmailPending",
];

/*
 * What /signup answers with. Set per test; the account itself is never in
 * the answer, which deliberately describes no account.
 */
let signupMiscData: JSONObject = {};

/* What ?email= holds -- "" when the visitor typed the address themselves. */
let linkedEmail: string = "";

let resendPosts: Array<{ url: string; data: unknown }> = [];
let consoleErrors: SpyInstance<typeof console.error>;

type FakeClockFunction = () => void;

const useFakeClock: FakeClockFunction = (): void => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-03-02T10:00:00.000Z"));
};

type AdvanceFunction = (milliseconds: number) => void;

const advance: AdvanceFunction = (milliseconds: number): void => {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
};

type SettleFunction = () => Promise<void>;

const settle: SettleFunction = async (): Promise<void> => {
  await act(async () => {
    for (let tick: number = 0; tick < 50; tick++) {
      await Promise.resolve();
    }
  });
};

type RenderPageFunction = () => Promise<void>;

const renderPage: RenderPageFunction = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
  await screen.findByTestId("password");

  if (linkedEmail) {
    await waitFor(() => {
      expect(screen.getByTestId("email")).toHaveValue(linkedEmail);
    });
  }
};

type SetFieldFunction = (name: string, value: string) => Promise<void>;

const setField: SetFieldFunction = async (
  name: string,
  value: string,
): Promise<void> => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });
  const input: HTMLElement = screen.getByTestId(name);
  await user.clear(input);
  if (value) {
    await user.paste(value);
  }
};

type TypeEmailFunction = (value: string) => Promise<void>;

// See "TYPING AN EMAIL" above.
const typeEmail: TypeEmailFunction = async (value: string): Promise<void> => {
  const input: HTMLElement = screen.getByTestId("email");
  await act(async () => {
    fireEvent.change(input, { target: { value: value } });
  });
  expect(input).toHaveValue(value);
};

type FillFormFunction = (email?: string) => Promise<void>;

const fillForm: FillFormFunction = async (email?: string): Promise<void> => {
  if (email !== undefined) {
    await typeEmail(email);
  }
  await setField("name", NAME);
  await setField("companyName", COMPANY);
  await setField("companyPhoneNumber", PHONE);
  await setField("password", PASSWORD);
  await setField("confirmPassword", PASSWORD);
};

type SubmitFunction = () => Promise<void>;

/*
 * Switches to the fake clock (see THE CLOCK above), then submits and lets
 * the mocked /signup settle.
 */
const submit: SubmitFunction = async (): Promise<void> => {
  useFakeClock();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign Up" }));
  });
  await settle();
};

type ElementFunction = () => HTMLElement;

const verifyScreen: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("verify-email-required");
};

type CountRevenueFunction = (name: RevenueEventName) => number;

const revenueEvents: CountRevenueFunction = (
  name: RevenueEventName,
): number => {
  return jest
    .mocked(UiAnalytics.captureRevenueEvent)
    .mock.calls.filter((call: Array<unknown>) => {
      return call[0] === name;
    }).length;
};

type CountCaptureFunction = (name: string) => number;

const captures: CountCaptureFunction = (name: string): number => {
  return jest
    .mocked(UiAnalytics.capture)
    .mock.calls.filter((call: Array<unknown>) => {
      return call[0] === name;
    }).length;
};

type IdentifiedFunction = () => Array<string>;

const identifiedAs: IdentifiedFunction = (): Array<string> => {
  return jest
    .mocked(UiAnalytics.userAuth)
    .mock.calls.map((call: Array<unknown>) => {
      return String(call[0]);
    });
};

type SubmittedEmailsFunction = () => Array<string>;

const submittedEmails: SubmittedEmailsFunction = (): Array<string> => {
  return jest
    .mocked(ModelAPI.createOrUpdate)
    .mock.calls.map((call: Parameters<typeof ModelAPI.createOrUpdate>) => {
      return (call[0].model as User).email?.toString() || "";
    });
};

describe("Hosted signup that needs email verification", () => {
  beforeEach(() => {
    Object.defineProperty(UIConfig, "BILLING_ENABLED", { value: true });

    linkedEmail = "";
    resendPosts = [];
    signupMiscData = {
      emailVerificationRequired: true,
      verificationEmailResendToken: RESEND_TOKEN,
      verificationEmailResendAvailableInSeconds: 60,
    };

    consoleErrors = jest.spyOn(console, "error");

    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    jest.spyOn(UserUtil, "getUtmParams").mockReturnValue({});
    jest.spyOn(UserUtil, "getAttributionClickIds").mockReturnValue(null);
    jest.spyOn(UserUtil, "getFirstTouchAttribution").mockReturnValue(null);
    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
    jest
      .spyOn(Navigation, "getQueryStringByName")
      .mockImplementation((key: string): string => {
        return key === "email" ? linkedEmail : "";
      });
    jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
    jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
    jest.spyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(() => {});
    jest.spyOn(LoginUtil, "login").mockImplementation(() => {});
    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
        const response: ModelAPIHttpResponse<User> =
          new ModelAPIHttpResponse<User>(200, {}, {});
        response.miscData = { ...signupMiscData };
        return response;
      });
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: Parameters<typeof API.post>[0],
        ): Promise<HTTPResponse<JSONObject>> => {
          const url: string = options.url.toString();

          if (!url.endsWith("/resend-verification-email")) {
            throw new Error(`Unexpected request to ${url}`);
          }

          resendPosts.push({ url: url, data: options.data });
          return new HTTPResponse<JSONObject>(
            200,
            { emailSent: true, alreadyVerified: false, retryAfterSeconds: 60 },
            {},
          );
        },
      );
  });

  afterEach(() => {
    cleanup();

    const ownComponentErrors: Array<string> = consoleErrors.mock.calls
      .map((call: Array<unknown>) => {
        return call.map(String).join(" ");
      })
      .filter((message: string) => {
        return OWN_COMPONENTS.some((name: string) => {
          return message.includes(name);
        });
      });

    jest.useRealTimers();
    jest.restoreAllMocks();

    expect(ownComponentErrors).toEqual([]);
  });

  describe("with the address from the link (?email=)", () => {
    beforeEach(() => {
      linkedEmail = EMAIL;
    });

    test("shows the verification screen for that address and logs nobody in", async () => {
      await renderPage();
      await fillForm();
      await submit();

      expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(1);
      expect(submittedEmails()).toEqual([EMAIL]);

      const card: HTMLElement = verifyScreen();
      expect(
        screen.getByRole("heading", { level: 1, name: TITLE }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("verify-email-address")).toHaveTextContent(
        EMAIL,
      );
      expect(card).toHaveTextContent(SENT_TO(EMAIL));
      expect(document.querySelector("form")).toBeNull();
      expect(screen.queryByTestId("password")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Sign Up" }),
      ).not.toBeInTheDocument();

      // No session exists yet, so nothing may pretend otherwise.
      expect(LoginUtil.login).not.toHaveBeenCalled();
      expect(Navigation.navigate).not.toHaveBeenCalled();
    });

    test("wires the resend button to the token, disabled for the wait /signup gave", async () => {
      await renderPage();
      await fillForm();
      await submit();

      expect(screen.getByText(SPAM_HINT)).toBeInTheDocument();
      expect(screen.queryByText(SIGN_IN_FALLBACK_HINT)).not.toBeInTheDocument();

      const resend: HTMLElement = screen.getByTestId(
        "resend-verification-email",
      );
      expect(resend).toBeDisabled();
      expect(resend).toHaveAccessibleName("Resend verification email");
      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("1:00"));

      advance(30_000);
      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("0:30"));
      expect(resend).toBeDisabled();
      expect(resendPosts).toHaveLength(0);
    });

    test("after the wait, resend posts the token from /signup and nothing else", async () => {
      await renderPage();
      await fillForm();
      await submit();

      advance(60_000);

      const resend: HTMLElement = screen.getByTestId(
        "resend-verification-email",
      );
      expect(resend).toBeEnabled();
      expect(
        screen.queryByTestId("resend-verification-email-countdown"),
      ).not.toBeInTheDocument();

      fireEvent.click(resend);
      await settle();

      expect(resendPosts).toEqual([
        {
          url: expect.stringMatching(/\/resend-verification-email$/),
          data: { data: { resendToken: RESEND_TOKEN } },
        },
      ]);
      expect(
        screen.getByTestId("resend-verification-email-status"),
      ).toHaveTextContent(SENT);
      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("1:01"));
      expect(LoginUtil.login).not.toHaveBeenCalled();
    });

    test("uses whatever wait /signup gave", async () => {
      signupMiscData["verificationEmailResendAvailableInSeconds"] = 5;
      await renderPage();
      await fillForm();
      await submit();

      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("0:05"));

      advance(5000);
      expect(screen.getByTestId("resend-verification-email")).toBeEnabled();
    });

    test("falls back to the default minute when /signup gives no usable wait", async () => {
      signupMiscData["verificationEmailResendAvailableInSeconds"] = "soon";
      await renderPage();
      await fillForm();
      await submit();

      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("1:00"));
    });

    test.each([
      ["no resend token", undefined],
      ["an empty resend token", ""],
      ["a resend token that is not a string", 12345],
    ])(
      "with %s: the sign-in advice and no resend button",
      async (_label: string, token: unknown) => {
        if (token === undefined) {
          delete signupMiscData["verificationEmailResendToken"];
          delete signupMiscData["verificationEmailResendAvailableInSeconds"];
        } else {
          signupMiscData["verificationEmailResendToken"] = token as string;
        }

        await renderPage();
        await fillForm();
        await submit();

        expect(verifyScreen()).toBeInTheDocument();
        expect(screen.getByTestId("verify-email-address")).toHaveTextContent(
          EMAIL,
        );
        expect(screen.getByText(SIGN_IN_FALLBACK_HINT)).toBeInTheDocument();
        expect(screen.queryByText(SPAM_HINT)).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("resend-verification-email"),
        ).not.toBeInTheDocument();
        expect(LoginUtil.login).not.toHaveBeenCalled();
      },
    );

    test("does not offer a different email for an address that came with the link", async () => {
      await renderPage();

      expect(screen.getByTestId("email")).toHaveAttribute("readonly");

      await fillForm();
      await submit();

      expect(verifyScreen()).toBeInTheDocument();
      expect(
        screen.queryByTestId("verify-email-use-different-email"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Wrong email address?"),
      ).not.toBeInTheDocument();
    });

    test("counts one completed signup, under that address", async () => {
      await renderPage();
      await fillForm();
      await submit();

      expect(revenueEvents(RevenueEventName.SignupStarted)).toBe(1);
      expect(revenueEvents(RevenueEventName.SignupCompleted)).toBe(1);
      expect(captures("accounts/register")).toBe(1);
      expect(captures("accounts/register_email_changed")).toBe(0);
      expect(identifiedAs()).toEqual([EMAIL]);
    });

    test("a signup that starts a session still logs in as before", async () => {
      signupMiscData = { token: "signup-session" };
      jest
        .spyOn(ModelAPI, "createOrUpdate")
        .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
          const response: ModelAPIHttpResponse<User> =
            new ModelAPIHttpResponse<User>(
              200,
              {
                _id: "33333333-3333-4333-8333-333333333333",
                email: EMAIL,
                name: NAME,
              },
              {},
            );
          response.miscData = { ...signupMiscData };
          return response;
        });

      await renderPage();
      await fillForm();
      await submit();

      expect(LoginUtil.login).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByTestId("verify-email-required"),
      ).not.toBeInTheDocument();
      expect(revenueEvents(RevenueEventName.SignupCompleted)).toBe(1);
    });
  });

  describe("with an address the visitor typed", () => {
    test("offers a way back when the address was wrong, and keeps what was typed", async () => {
      await renderPage();

      expect(screen.getByTestId("email")).not.toHaveAttribute("readonly");
      expect(screen.getByTestId("email")).toBeEnabled();

      await fillForm(TYPO_EMAIL);
      await submit();

      expect(screen.getByTestId("verify-email-address")).toHaveTextContent(
        TYPO_EMAIL,
      );

      const useDifferentEmail: HTMLElement = screen.getByTestId(
        "verify-email-use-different-email",
      );
      expect(useDifferentEmail).toHaveAccessibleName(
        "Sign up with a different email",
      );
      expect(useDifferentEmail.closest("p")).toHaveTextContent(
        "Wrong email address?",
      );

      await act(async () => {
        fireEvent.click(useDifferentEmail);
      });
      await settle();

      // Back to the form, as it was left.
      expect(
        screen.queryByTestId("verify-email-required"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign Up" })).toBeEnabled();

      const email: HTMLElement = screen.getByTestId("email");
      expect(email).toHaveValue(TYPO_EMAIL);
      expect(email).toBeEnabled();
      expect(email).not.toHaveAttribute("readonly");
      expect(screen.getByTestId("name")).toHaveValue(NAME);
      expect(screen.getByTestId("companyName")).toHaveValue(COMPANY);
      expect(screen.getByTestId("companyPhoneNumber")).toHaveValue(PHONE);

      // Never the secrets.
      expect(screen.getByTestId("password")).toHaveValue("");
      expect(screen.getByTestId("confirmPassword")).toHaveValue("");

      // The resend countdown went with the screen.
      expect(
        screen.queryByTestId("resend-verification-email"),
      ).not.toBeInTheDocument();
      expect(jest.getTimerCount()).toBe(0);
    });

    test("the returned form accepts a corrected address and signs up again under it", async () => {
      await renderPage();
      await fillForm(TYPO_EMAIL);
      await submit();

      await act(async () => {
        fireEvent.click(screen.getByTestId("verify-email-use-different-email"));
      });
      await settle();

      // Back on the real clock for typing, as at the start.
      jest.useRealTimers();

      await typeEmail(EMAIL);
      await setField("password", PASSWORD);
      await setField("confirmPassword", PASSWORD);
      await submit();

      expect(submittedEmails()).toEqual([TYPO_EMAIL, EMAIL]);

      const secondRequest: User = jest.mocked(ModelAPI.createOrUpdate).mock
        .calls[1]![0].model as User;
      expect(secondRequest.name?.toString()).toBe(NAME);
      expect(secondRequest.companyName?.toString()).toBe(COMPANY);
      expect(secondRequest.password?.toString()).toBe(PASSWORD);

      expect(screen.getByTestId("verify-email-address")).toHaveTextContent(
        EMAIL,
      );
      expect(verifyScreen()).not.toHaveTextContent(TYPO_EMAIL);
      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("1:00"));
      expect(LoginUtil.login).not.toHaveBeenCalled();

      /*
       * One visitor, one conversion: the funnel does not count the second
       * account, but analytics follows the visitor to the address they
       * actually use.
       */
      expect(revenueEvents(RevenueEventName.SignupStarted)).toBe(1);
      expect(revenueEvents(RevenueEventName.SignupCompleted)).toBe(1);
      expect(captures("accounts/register")).toBe(1);
      expect(captures("accounts/register_email_changed")).toBe(1);
      expect(identifiedAs()).toEqual([TYPO_EMAIL, EMAIL]);
    });

    test("signing up again under the same address is not an address change", async () => {
      await renderPage();
      await fillForm(EMAIL);
      await submit();

      await act(async () => {
        fireEvent.click(screen.getByTestId("verify-email-use-different-email"));
      });
      await settle();
      jest.useRealTimers();

      expect(screen.getByTestId("email")).toHaveValue(EMAIL);
      await setField("password", PASSWORD);
      await setField("confirmPassword", PASSWORD);
      await submit();

      expect(submittedEmails()).toEqual([EMAIL, EMAIL]);
      expect(verifyScreen()).toBeInTheDocument();
      expect(revenueEvents(RevenueEventName.SignupCompleted)).toBe(1);
      expect(captures("accounts/register_email_changed")).toBe(0);
      expect(identifiedAs()).toEqual([EMAIL]);
    });

    test("the new screen gets the new token and its own wait", async () => {
      await renderPage();
      await fillForm(TYPO_EMAIL);
      await submit();

      advance(40_000);
      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("0:20"));

      await act(async () => {
        fireEvent.click(screen.getByTestId("verify-email-use-different-email"));
      });
      await settle();
      jest.useRealTimers();

      signupMiscData = {
        emailVerificationRequired: true,
        verificationEmailResendToken: `${RESEND_TOKEN}-second`,
        verificationEmailResendAvailableInSeconds: 45,
      };

      await typeEmail(EMAIL);
      await setField("password", PASSWORD);
      await setField("confirmPassword", PASSWORD);
      await submit();

      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent(countdown("0:45"));

      advance(45_000);
      fireEvent.click(screen.getByTestId("resend-verification-email"));
      await settle();

      expect(
        resendPosts.map((post: { data: unknown }) => {
          return post.data;
        }),
      ).toEqual([{ data: { resendToken: `${RESEND_TOKEN}-second` } }]);
    });

    test("a second signup whose server sends no token falls back to the sign-in advice", async () => {
      await renderPage();
      await fillForm(TYPO_EMAIL);
      await submit();

      expect(
        screen.getByTestId("resend-verification-email"),
      ).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByTestId("verify-email-use-different-email"));
      });
      await settle();
      jest.useRealTimers();

      signupMiscData = { emailVerificationRequired: true };

      await typeEmail(EMAIL);
      await setField("password", PASSWORD);
      await setField("confirmPassword", PASSWORD);
      await submit();

      expect(screen.getByTestId("verify-email-address")).toHaveTextContent(
        EMAIL,
      );
      expect(screen.getByText(SIGN_IN_FALLBACK_HINT)).toBeInTheDocument();
      expect(
        screen.queryByTestId("resend-verification-email"),
      ).not.toBeInTheDocument();
    });
  });
});
