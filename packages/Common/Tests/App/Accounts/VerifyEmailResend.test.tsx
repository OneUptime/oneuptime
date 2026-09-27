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
} from "@testing-library/react";
import { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import APIException from "../../../Types/Exception/ApiException";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import SensitiveUrlToken from "../../../UI/Utils/SensitiveUrlToken";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import VerifyEmailPage from "../../../../App/FeatureSet/Accounts/src/Pages/VerifyEmail";

/*
 * The page a verification link opens, when the link no longer works.
 *
 * Before this, every failure ended on "Sorry, something went wrong!" and the
 * server's advice to sign in for a new link -- even when the server had not
 * really answered, and even though the link that failed is itself enough to
 * ask for a new one. These tests drive the real page with only the network
 * and the URL token mocked, and pin the three ways it can now end:
 *
 *   - the link was turned down (4xx) and is a well-formed token: say so, and
 *     offer "Resend verification email" with that token as the credential;
 *   - the link was turned down but could never have been a real token: say
 *     so, with the server's own advice, and no button that can only fail;
 *   - the server did not answer properly (5xx, network): nothing is known
 *     about the link, so offer to try the SAME link again.
 *
 * The clock is fake so the resend button's countdown never ticks outside
 * act() while a test is still running.
 */

const LINK_TOKEN: string = "8f2d1c3a-4b5e-4f60-8a71-92b3c4d5e6f7";
const MALFORMED_TOKEN: string = "not-a-verification-token";

// Straight out of en.json.
const SUCCESS_TITLE: string = "Your email is verified.";
const SUCCESS_DESCRIPTION: string =
  "Thank you for verifying your email. You can now log in to OneUptime.";
const CONTINUE_TO_SIGN_IN: string = "Continue to sign in";
const LINK_INVALID_TITLE: string = "This verification link is no longer valid";
const REQUEST_NEW_LINK: string =
  "If your link has expired or stopped working, we can email you a new one.";
const ERROR_TITLE: string = "Sorry, something went wrong!";
const TRY_AGAIN: string = "Try again";
const RETURN_TO_SIGN_IN: string = "Return to sign in?";
const LOGIN_LINK: string = "Login.";
const RESEND_BUTTON: string = "Resend verification email";
const SENT: string =
  "We've sent a new verification link. It can take a minute or two to arrive.";
const ALREADY_VERIFIED: string =
  "Your email address is already verified. You can sign in now.";
const INVALID_REQUEST: string =
  "This verification request is no longer valid. Sign in with your email and password and we will send you a new verification link.";

// What /verify-email says about a link it turns down.
const LINK_EXPIRED: string =
  "Link expired. Please try to log in and we will resend you another link which you should be able to verify email with.";
const LINK_INVALID: string =
  "Invalid link. Please try to log in and we will resend you another link which you should be able to verify email with.";

/*
 * Console noise that has nothing to do with this page, and is ignored for
 * that reason; every other console error fails the test.
 *
 * - Testing Library 13 on React 18.3 prints the first one once per run.
 * - ModelAPI pulls in UI/Utils/Telemetry, whose zone.js swaps the global
 *   Promise. React's "was this act() awaited?" check runs on that Promise
 *   while `await` uses the native one, so the first properly awaited
 *   act(async) in the file is reported as not awaited.
 */
const KNOWN_CONSOLE_NOISE: Array<string> = [
  "`ReactDOMTestUtils.act` is deprecated",
  "You called act(async () => ...) without await",
];

type VerifyAnswer = () => Promise<ModelAPIHttpResponse<EmailVerificationToken>>;

let linkToken: string = LINK_TOKEN;

/*
 * What each POST /verify-email answers with, in order. The last one repeats,
 * so a test only lists as many as it cares about.
 */
let verifyAnswers: Array<VerifyAnswer> = [];

let resendAnswer: () => Promise<HTTPResponse<JSONObject>> = async (): Promise<
  HTTPResponse<JSONObject>
> => {
  return new HTTPResponse<JSONObject>(
    200,
    { emailSent: true, alreadyVerified: false, retryAfterSeconds: 60 },
    {},
  );
};

let resendPosts: Array<unknown> = [];
let consoleErrors: SpyInstance<typeof console.error>;
let createOrUpdate: SpyInstance<typeof ModelAPI.createOrUpdate>;

const verified: VerifyAnswer = async (): Promise<
  ModelAPIHttpResponse<EmailVerificationToken>
> => {
  return new ModelAPIHttpResponse<EmailVerificationToken>(200, {}, {});
};

type RefuseFunction = (statusCode: number, message: string) => VerifyAnswer;

const refuse: RefuseFunction = (
  statusCode: number,
  message: string,
): VerifyAnswer => {
  return async (): Promise<ModelAPIHttpResponse<EmailVerificationToken>> => {
    // ModelAPI.createOrUpdate throws the error response it got back.
    throw new HTTPErrorResponse(statusCode, { message: message }, {});
  };
};

const networkFailure: VerifyAnswer = async (): Promise<
  ModelAPIHttpResponse<EmailVerificationToken>
> => {
  throw new APIException("Network Error");
};

type SettleFunction = () => Promise<void>;

const settle: SettleFunction = async (): Promise<void> => {
  await act(async () => {
    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }
  });
};

type RenderPageFunction = () => Promise<void>;

const renderPage: RenderPageFunction = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <VerifyEmailPage />
    </MemoryRouter>,
  );
  await settle();
};

type ElementFunction = () => HTMLElement;

const errorBlock: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("verify-email-error");
};

const heading: ElementFunction = (): HTMLElement => {
  return screen.getByRole("heading", { level: 1 });
};

type ExpectFooterFunction = () => void;

const expectSignInFooter: ExpectFooterFunction = (): void => {
  const loginLink: HTMLElement = screen.getByRole("link", {
    name: LOGIN_LINK,
  });
  expect(loginLink).toHaveAttribute("href", "/accounts/login");
  expect(loginLink.closest("p")).toHaveTextContent(
    `${RETURN_TO_SIGN_IN} ${LOGIN_LINK}`,
  );
};

describe("Verify email page", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-02T10:00:00.000Z"));

    linkToken = LINK_TOKEN;
    verifyAnswers = [verified];
    resendPosts = [];
    resendAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
      return new HTTPResponse<JSONObject>(
        200,
        { emailSent: true, alreadyVerified: false, retryAfterSeconds: 60 },
        {},
      );
    };

    consoleErrors = jest.spyOn(console, "error");

    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
    jest.spyOn(SensitiveUrlToken, "read").mockImplementation((): string => {
      return linkToken;
    });
    jest.spyOn(SensitiveUrlToken, "clear").mockImplementation(() => {});

    let verifyCalls: number = 0;
    createOrUpdate = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(
        async (): Promise<ModelAPIHttpResponse<EmailVerificationToken>> => {
          const answer: VerifyAnswer =
            verifyAnswers[Math.min(verifyCalls, verifyAnswers.length - 1)]!;
          verifyCalls++;
          return await answer();
        },
      ) as unknown as SpyInstance<typeof ModelAPI.createOrUpdate>;

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

          resendPosts.push(options.data);
          return await resendAnswer();
        },
      );
  });

  afterEach(() => {
    cleanup();

    const reportedErrors: Array<string> = consoleErrors.mock.calls
      .map((call: Array<unknown>) => {
        return call.map(String).join(" ");
      })
      .filter((message: string) => {
        return !KNOWN_CONSOLE_NOISE.some((noise: string) => {
          return message.includes(noise);
        });
      });

    jest.useRealTimers();
    jest.restoreAllMocks();

    expect(reportedErrors).toEqual([]);
  });

  describe("a link that works", () => {
    test("verifies the token from the URL and shows the success view, as before", async () => {
      await renderPage();

      expect(createOrUpdate).toHaveBeenCalledTimes(1);
      const request: Parameters<typeof ModelAPI.createOrUpdate>[0] =
        createOrUpdate.mock.calls[0]![0];
      expect((request.model as EmailVerificationToken).token?.toString()).toBe(
        LINK_TOKEN,
      );
      expect(request.requestOptions?.overrideRequestUrl?.toString()).toMatch(
        /\/verify-email$/,
      );

      const success: HTMLElement = screen.getByTestId("verify-email-success");
      expect(heading()).toHaveTextContent(SUCCESS_TITLE);
      expect(success).toContainElement(heading());
      expect(success).toHaveTextContent(SUCCESS_DESCRIPTION);

      const next: HTMLElement = screen.getByRole("link", {
        name: CONTINUE_TO_SIGN_IN,
      });
      expect(next).toHaveAttribute("href", "/accounts/login");

      // The spent token must not outlive the page.
      expect(SensitiveUrlToken.clear).toHaveBeenCalledTimes(1);

      expect(
        screen.queryByTestId("verify-email-error"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("resend-verification-email"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: LOGIN_LINK }),
      ).not.toBeInTheDocument();
      expect(resendPosts).toHaveLength(0);
    });

    test("lays the card out left-to-right in English", async () => {
      await renderPage();

      const card: HTMLElement | null = screen
        .getByTestId("verify-email-success")
        .closest("[dir]");
      expect(card).toHaveAttribute("dir", "ltr");
    });
  });

  describe("a link the server turned down", () => {
    test.each([
      ["expired", LINK_EXPIRED],
      ["unknown", LINK_INVALID],
    ])(
      "an %s link offers a new one instead of the server's sign-in advice",
      async (_label: string, serverMessage: string) => {
        verifyAnswers = [refuse(400, serverMessage)];

        await renderPage();

        const block: HTMLElement = errorBlock();
        expect(heading()).toHaveTextContent(LINK_INVALID_TITLE);
        expect(block).toContainElement(heading());
        expect(block).toHaveTextContent(REQUEST_NEW_LINK);
        expect(screen.queryByText(serverMessage)).not.toBeInTheDocument();
        expect(document.body).not.toHaveTextContent("Please try to log in");
        expect(screen.queryByText(ERROR_TITLE)).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("verify-email-try-again"),
        ).not.toBeInTheDocument();

        const resend: HTMLElement = screen.getByTestId(
          "resend-verification-email",
        );
        expect(block).toContainElement(resend);
        expect(resend).toHaveAccessibleName(RESEND_BUTTON);
        // Nothing has been sent from this page yet, so there is no wait.
        expect(resend).toBeEnabled();

        expectSignInFooter();

        // Kept: the failed link is still the credential for a new one.
        expect(SensitiveUrlToken.clear).not.toHaveBeenCalled();
        expect(
          screen.queryByTestId("verify-email-success"),
        ).not.toBeInTheDocument();
      },
    );

    test("the resend button asks for a new link with the token from the URL", async () => {
      verifyAnswers = [refuse(400, LINK_EXPIRED)];
      await renderPage();

      fireEvent.click(screen.getByTestId("resend-verification-email"));
      await settle();

      expect(resendPosts).toEqual([
        { data: { verificationToken: LINK_TOKEN } },
      ]);
      expect(
        screen.getByTestId("resend-verification-email-status"),
      ).toHaveTextContent(SENT);
      expect(screen.getByTestId("resend-verification-email")).toBeDisabled();
      expect(
        screen.getByTestId("resend-verification-email-countdown"),
      ).toHaveTextContent("You can request another email in 1:01.");

      // Asking for a new link does not re-run verification.
      expect(createOrUpdate).toHaveBeenCalledTimes(1);
    });

    test("uses the token read when the page opened, even if it is gone from storage by then", async () => {
      verifyAnswers = [refuse(400, LINK_EXPIRED)];
      await renderPage();

      linkToken = "";
      fireEvent.click(screen.getByTestId("resend-verification-email"));
      await settle();

      expect(resendPosts).toEqual([
        { data: { verificationToken: LINK_TOKEN } },
      ]);
    });

    test("a refused resend shows the server's curated reason", async () => {
      verifyAnswers = [refuse(400, LINK_EXPIRED)];
      resendAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPErrorResponse(
          400,
          { message: INVALID_REQUEST },
          {},
        ) as unknown as HTTPResponse<JSONObject>;
      };
      await renderPage();

      fireEvent.click(screen.getByTestId("resend-verification-email"));
      await settle();

      expect(
        screen.getByTestId("resend-verification-email-status"),
      ).toHaveTextContent(INVALID_REQUEST);
      expect(heading()).toHaveTextContent(LINK_INVALID_TITLE);
    });

    test("an account that turns out to be verified flips the page to the success view", async () => {
      verifyAnswers = [refuse(400, LINK_EXPIRED)];
      resendAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(
          200,
          { emailSent: false, alreadyVerified: true, retryAfterSeconds: 0 },
          {},
        );
      };
      await renderPage();

      fireEvent.click(screen.getByTestId("resend-verification-email"));
      await settle();

      expect(screen.getByTestId("verify-email-success")).toBeInTheDocument();
      expect(
        screen.queryByTestId("verify-email-error"),
      ).not.toBeInTheDocument();
      expect(heading()).toHaveTextContent(SUCCESS_TITLE);
      // Focus follows, or it is left on a button that no longer exists.
      expect(heading()).toHaveFocus();
      expect(
        screen.getByRole("link", { name: CONTINUE_TO_SIGN_IN }),
      ).toHaveAttribute("href", "/accounts/login");
      expect(
        screen.queryByTestId("resend-verification-email"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(ALREADY_VERIFIED)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: LOGIN_LINK }),
      ).not.toBeInTheDocument();

      // Nothing left for the token to do.
      expect(SensitiveUrlToken.clear).toHaveBeenCalledTimes(1);
      expect(createOrUpdate).toHaveBeenCalledTimes(1);
    });

    test.each([
      ["a malformed token", MALFORMED_TOKEN],
      ["a token with a trailing character", `${LINK_TOKEN}x`],
      ["no token at all", ""],
    ])(
      "%s gets the server's advice and no button that can only fail",
      async (_label: string, token: string) => {
        linkToken = token;
        verifyAnswers = [refuse(400, LINK_INVALID)];

        await renderPage();

        const block: HTMLElement = errorBlock();
        expect(heading()).toHaveTextContent(LINK_INVALID_TITLE);
        expect(block).toHaveTextContent(LINK_INVALID);
        expect(block).not.toHaveTextContent(REQUEST_NEW_LINK);
        expect(
          screen.queryByTestId("resend-verification-email"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("verify-email-try-again"),
        ).not.toBeInTheDocument();
        expectSignInFooter();
      },
    );

    test("any 4xx is a problem with the link, not the server", async () => {
      verifyAnswers = [refuse(404, "Not found")];

      await renderPage();

      expect(heading()).toHaveTextContent(LINK_INVALID_TITLE);
      expect(screen.getByTestId("resend-verification-email")).toBeEnabled();
    });

    test("the error card is left-to-right in English too", async () => {
      verifyAnswers = [refuse(400, LINK_EXPIRED)];
      await renderPage();

      expect(errorBlock().closest("[dir]")).toHaveAttribute("dir", "ltr");
    });
  });

  describe("a server that did not answer properly", () => {
    test.each([
      ["a 500", refuse(500, "Server Error"), "Server Error"],
      ["a 503", refuse(503, "Service Unavailable"), "Service Unavailable"],
      ["a network error", networkFailure, "Network Error"],
    ])(
      "%s says so and offers to try the same link again",
      async (_label: string, answer: VerifyAnswer, message: string) => {
        verifyAnswers = [answer];

        await renderPage();

        const block: HTMLElement = errorBlock();
        expect(heading()).toHaveTextContent(ERROR_TITLE);
        expect(block).toHaveTextContent(message);
        expect(screen.queryByText(LINK_INVALID_TITLE)).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("resend-verification-email"),
        ).not.toBeInTheDocument();

        const retry: HTMLElement = screen.getByTestId("verify-email-try-again");
        expect(retry).toHaveAccessibleName(TRY_AGAIN);
        expect(retry).toBeEnabled();
        expect(block).toContainElement(retry);

        expectSignInFooter();
        expect(SensitiveUrlToken.clear).not.toHaveBeenCalled();
      },
    );

    test("a 502 is shown as a connection problem", async () => {
      verifyAnswers = [refuse(502, "Bad Gateway")];

      await renderPage();

      expect(errorBlock()).toHaveTextContent(
        "Error connecting to server. Please try again in few minutes.",
      );
      expect(screen.getByTestId("verify-email-try-again")).toBeInTheDocument();
    });

    test("Try again re-runs verification with the same link and can succeed", async () => {
      verifyAnswers = [refuse(500, "Server Error"), verified];
      await renderPage();

      expect(createOrUpdate).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("verify-email-try-again"));
      await settle();

      expect(createOrUpdate).toHaveBeenCalledTimes(2);
      expect(
        (
          createOrUpdate.mock.calls[1]![0].model as EmailVerificationToken
        ).token?.toString(),
      ).toBe(LINK_TOKEN);

      expect(screen.getByTestId("verify-email-success")).toBeInTheDocument();
      expect(heading()).toHaveTextContent(SUCCESS_TITLE);
      expect(
        screen.queryByTestId("verify-email-error"),
      ).not.toBeInTheDocument();
      expect(SensitiveUrlToken.clear).toHaveBeenCalledTimes(1);
    });

    test("Try again shows the loader while it runs", async () => {
      let finishRetry: () => void = () => {};
      verifyAnswers = [
        networkFailure,
        (): Promise<ModelAPIHttpResponse<EmailVerificationToken>> => {
          return new Promise<ModelAPIHttpResponse<EmailVerificationToken>>(
            (
              resolve: (
                value: ModelAPIHttpResponse<EmailVerificationToken>,
              ) => void,
            ): void => {
              finishRetry = (): void => {
                resolve(
                  new ModelAPIHttpResponse<EmailVerificationToken>(200, {}, {}),
                );
              };
            },
          );
        },
      ];
      await renderPage();

      fireEvent.click(screen.getByTestId("verify-email-try-again"));
      await settle();

      expect(
        screen.queryByTestId("verify-email-error"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("verify-email-success"),
      ).not.toBeInTheDocument();

      await act(async () => {
        finishRetry();
      });
      await settle();

      expect(screen.getByTestId("verify-email-success")).toBeInTheDocument();
    });

    test("a retry that fails again stays on the error, ready for another try", async () => {
      verifyAnswers = [networkFailure];
      await renderPage();

      fireEvent.click(screen.getByTestId("verify-email-try-again"));
      await settle();

      expect(createOrUpdate).toHaveBeenCalledTimes(2);
      expect(heading()).toHaveTextContent(ERROR_TITLE);
      expect(screen.getByTestId("verify-email-try-again")).toBeEnabled();
    });

    test("a retry that the server now turns down becomes a link problem", async () => {
      verifyAnswers = [
        refuse(503, "Service Unavailable"),
        refuse(400, LINK_EXPIRED),
      ];
      await renderPage();

      fireEvent.click(screen.getByTestId("verify-email-try-again"));
      await settle();

      expect(heading()).toHaveTextContent(LINK_INVALID_TITLE);
      expect(screen.getByTestId("resend-verification-email")).toBeEnabled();
      expect(
        screen.queryByTestId("verify-email-try-again"),
      ).not.toBeInTheDocument();
    });
  });
});
