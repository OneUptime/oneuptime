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
import { SpyInstance } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { RESET_LINK_MESSAGES } from "../../../Types/Accounts/SignInMessages";
import { PASSWORD_RULE_MESSAGES } from "../../../Types/Password";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import SensitiveUrlToken from "../../../UI/Utils/SensitiveUrlToken";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import ResetPasswordPage from "../../../../App/FeatureSet/Accounts/src/Pages/ResetPassword";

/*
 * OneUptime's Reset Password page (#9123): the one password rule with its
 * checklist as the person types, and one button that leads on wherever the
 * reset ends. It used to take six characters, end a reset in "Your password
 * has been updated. Please sign in." with nothing to click, and leave a dead
 * link at the server's "Expired link. Please go to forgot password page
 * again", with no way there.
 */

const RESET_TOKEN: string = "5c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e";
const STRONG_PASSWORD: string = "violet river lantern";

type Answer = () => Promise<ModelAPIHttpResponse<User>>;

let answer: Answer;
let createOrUpdate: SpyInstance<typeof ModelAPI.createOrUpdate>;

const succeed: Answer = async (): Promise<ModelAPIHttpResponse<User>> => {
  return new ModelAPIHttpResponse<User>(200, {}, {});
};

const refuseWith: (message: string) => Answer = (message: string): Answer => {
  return async (): Promise<ModelAPIHttpResponse<User>> => {
    throw new HTTPErrorResponse(400, { message: message }, {});
  };
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }
  });
};

const renderPage: () => Promise<void> = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(document.querySelectorAll("input[type='password']")).toHaveLength(2);
  });
};

const passwordInputs: () => Array<HTMLInputElement> =
  (): Array<HTMLInputElement> => {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>("input[type='password']"),
    );
  };

const typePasswords: (password: string, confirmation?: string) => void = (
  password: string,
  confirmation?: string,
): void => {
  const [passwordInput, confirmationInput] = passwordInputs();

  fireEvent.change(passwordInput!, { target: { value: password } });
  fireEvent.change(confirmationInput!, {
    target: { value: confirmation ?? password },
  });
};

const submit: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Reset Password" }));
  });
  await settle();
};

describe("Reset Password", () => {
  beforeEach(() => {
    answer = succeed;

    jest.spyOn(SensitiveUrlToken, "read").mockImplementation((): string => {
      return RESET_TOKEN;
    });
    jest.spyOn(SensitiveUrlToken, "clear").mockImplementation(() => {});

    createOrUpdate = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
        return await answer();
      }) as unknown as SpyInstance<typeof ModelAPI.createOrUpdate>;
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();

    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  describe("asks the one rule as the person types", () => {
    test("shows what the rule asks before anything is typed", async () => {
      await renderPage();

      expect(screen.getByTestId("password-requirements")).toHaveTextContent(
        "Use at least 15 characters.",
      );
      expect(
        screen.getByText("Between 15 and 100 characters"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Avoid common or repeated patterns"),
      ).toBeInTheDocument();
    });

    test("counts each character as it is typed", async () => {
      await renderPage();

      typePasswords("violet");

      expect(screen.getByText("6 / 15 characters minimum")).toBeInTheDocument();

      typePasswords(STRONG_PASSWORD);

      expect(screen.getByText("Password meets requirements")).toBeVisible();
    });

    test("the six characters it used to take are refused before anything is sent", async () => {
      await renderPage();

      typePasswords("abc123");
      await submit();

      expect(createOrUpdate).not.toHaveBeenCalled();
      expect(screen.getByTestId("password-requirements")).toHaveTextContent(
        PASSWORD_RULE_MESSAGES.tooShort,
      );
    });

    test("a predictable password is refused before anything is sent", async () => {
      await renderPage();

      typePasswords("password123456789");
      await submit();

      expect(createOrUpdate).not.toHaveBeenCalled();
      expect(screen.getByTestId("password-requirements")).toHaveTextContent(
        PASSWORD_RULE_MESSAGES.predictable,
      );
    });

    test("a confirmation that does not match is refused", async () => {
      await renderPage();

      typePasswords(STRONG_PASSWORD, "violet river lanterns");
      await submit();

      expect(createOrUpdate).not.toHaveBeenCalled();
      expect(
        screen.getByText("Confirm Password should match New Password"),
      ).toBeInTheDocument();
    });

    test("the checklist speaks the reader's language", async () => {
      await i18n.changeLanguage("de");
      await renderPage();

      expect(
        screen.getByText("Häufige oder sich wiederholende Muster vermeiden"),
      ).toBeInTheDocument();
    });
  });

  describe("ends in one button that leads on", () => {
    test("a reset ends in Sign In", async () => {
      await renderPage();

      typePasswords(STRONG_PASSWORD);
      await submit();

      expect(createOrUpdate).toHaveBeenCalledTimes(1);
      expect(SensitiveUrlToken.clear).toHaveBeenCalled();
      expect(screen.getByTestId("reset-password-success")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Your password has been reset",
      );
      expect(
        screen.getByText("Sign in with your new password."),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute(
        "href",
        "/accounts/login",
      );
      // One way on, not a second "Know your password? Sign in." under it.
      expect(screen.queryByText("Know your password?")).not.toBeInTheDocument();
    });

    test.each([
      [
        "an expired link",
        RESET_LINK_MESSAGES.expired,
        "This reset link has expired",
        "Reset links work for one day. Ask for a new link and we will email it to you.",
      ],
      [
        "a used or unknown link",
        RESET_LINK_MESSAGES.invalid,
        "This reset link no longer works",
        "It may have been used already, or only part of it was copied. Ask for a new link and we will email it to you.",
      ],
    ])(
      "%s ends in Request a New Link",
      async (
        _case: string,
        refusal: string,
        title: string,
        description: string,
      ) => {
        answer = refuseWith(refusal);

        await renderPage();
        typePasswords(STRONG_PASSWORD);
        await submit();

        expect(
          screen.getByTestId("reset-password-link-problem"),
        ).toBeInTheDocument();
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
          title,
        );
        expect(screen.getByText(description)).toBeInTheDocument();
        expect(
          screen.getByRole("link", { name: "Request a New Link" }),
        ).toHaveAttribute("href", "/accounts/forgot-password");
        // The link is not spent: the next one replaces it.
        expect(SensitiveUrlToken.clear).not.toHaveBeenCalled();
      },
    );

    test("a password the server refuses stays on the form, to try again", async () => {
      answer = refuseWith(PASSWORD_RULE_MESSAGES.predictable);

      await renderPage();
      typePasswords(STRONG_PASSWORD);
      await submit();

      expect(
        screen.queryByTestId("reset-password-link-problem"),
      ).not.toBeInTheDocument();
      expect(passwordInputs()).toHaveLength(2);
      expect(
        screen.getAllByText(PASSWORD_RULE_MESSAGES.predictable).length,
      ).toBeGreaterThan(0);
    });

    test("the ways on are worded in the reader's language", async () => {
      await i18n.changeLanguage("de");
      answer = refuseWith(RESET_LINK_MESSAGES.expired);

      await renderPage();
      typePasswords(STRONG_PASSWORD);
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Passwort zurücksetzen" }),
        );
      });
      await settle();

      expect(
        screen.getByRole("link", { name: "Neuen Link anfordern" }),
      ).toBeInTheDocument();
    });
  });
});
