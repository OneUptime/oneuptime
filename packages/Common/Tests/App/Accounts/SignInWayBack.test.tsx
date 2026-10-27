import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import Navigation from "../../../UI/Utils/Navigation";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import ForgotPasswordPage from "../../../../App/FeatureSet/Accounts/src/Pages/ForgotPassword";
import en from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Config",
    ) as typeof import("../../../UI/Config")),
    __esModule: true,
    BILLING_ENABLED: false,
    CAPTCHA_ENABLED: false,
  };
});

/*
 * THE WAY BACK TO SIGN IN, ONCE, IN ITS OWN WORDS (fu-platform's review).
 *
 * Once English Accounts said "Sign in." where it had said "Login.", two
 * pages said it twice:
 *
 *   - Forgot password drew "Return to Sign in." in its card and "Remember
 *     your password? Sign in." right under it: two links to one page. The
 *     card's went; the line under the card stays, as on the register and
 *     single sign-on pages.
 *   - A verification link that failed ended "Return to sign in? Sign in.".
 *     It now asks "Already verified your email?" - an earlier click on the
 *     same link may well have verified it - in each language's own words,
 *     the ones the "check your email" screen already used.
 *
 * And every "question? Link." line, in all 17 languages, says something in
 * its question that its link does not.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Accounts",
  "src",
  "Locales",
);

type Json = { [key: string]: unknown };

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.slice(0, -".json".length);
  });

const locale: (language: string) => Json = (language: string): Json => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Json;
};

const text: (data: Json, key: string) => string = (
  data: Json,
  key: string,
): string => {
  let value: unknown = data;

  for (const part of key.split(".")) {
    value = (value as Json | undefined)?.[part];
  }

  if (typeof value !== "string") {
    throw new Error(`${key} is not a string`);
  }

  return value;
};

// The words of a link or a question, without its closing punctuation.
const words: (value: string) => string = (value: string): string => {
  let end: number = value.length;

  while (end > 0 && ".?!。？！".includes(value.charAt(end - 1))) {
    end--;
  }

  return value.slice(0, end).trim().toLocaleLowerCase();
};

// Each line under a card: its question, and the link that answers it.
const WAY_BACK_LINES: Array<[string, string]> = [
  ["register.haveAccountPrompt", "register.loginLink"],
  ["forgotPassword.rememberPasswordPrompt", "forgotPassword.loginLink"],
  ["resetPassword.knowPasswordPrompt", "resetPassword.loginLink"],
  ["verifyEmail.alreadyVerifiedPrompt", "verifyEmail.loginLink"],
  ["sso.noAccountPrompt", "sso.registerLink"],
];

describe("every 'question? Link.' line says something in its question that its link does not", () => {
  test("in all 17 languages", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test.each(LANGUAGES)("%s", (language: string) => {
    const data: Json = locale(language);

    for (const [promptKey, linkKey] of WAY_BACK_LINES) {
      const prompt: string = words(text(data, promptKey));
      const link: string = words(text(data, linkKey));

      expect({
        language,
        promptKey,
        prompt,
        link,
        repeatsTheLink: prompt.includes(link),
      }).toEqual({ language, promptKey, prompt, link, repeatsTheLink: false });
    }
  });

  test("the check sees the line it replaced (positive control)", () => {
    expect(words("Return to sign in?").includes(words("Sign in."))).toBe(true);
  });

  test("a failed verification link asks the 'check your email' screen's question, in every language", () => {
    for (const language of LANGUAGES) {
      const data: Json = locale(language);

      expect({
        language,
        prompt: text(data, "verifyEmail.alreadyVerifiedPrompt"),
      }).toEqual({
        language,
        prompt: text(data, "register.verifyEmailAlreadyVerifiedPrompt"),
      });
    }
  });

  test("the retired wordings are gone from every language", () => {
    for (const language of LANGUAGES) {
      const data: Json = locale(language);

      expect({
        language,
        verifyReturn: (data["verifyEmail"] as Json)["returnToSignIn"],
        forgotReturn: (data["forgotPassword"] as Json)["returnToSignIn"],
        selfHostedSubtitle: (data["register"] as Json)["selfHostedSubtitle"],
      }).toEqual({
        language,
        verifyReturn: undefined,
        forgotReturn: undefined,
        selfHostedSubtitle: undefined,
      });
    }
  });
});

describe("the forgot password page", () => {
  beforeEach(() => {
    jest.spyOn(Navigation, "navigate").mockImplementation(() => {
      // A page that would move on stays put here.
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("has one way back to sign in, under its card", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>,
      );
    });

    const toSignIn: Array<HTMLElement> = screen
      .getAllByRole("link")
      .filter((link: HTMLElement): boolean => {
        return link.getAttribute("href") === "/accounts/login";
      });

    expect(toSignIn).toHaveLength(1);
    expect(toSignIn[0]).toHaveTextContent(en.forgotPassword.loginLink);

    const line: HTMLElement = screen.getByTestId("forgot-password-sign-in");
    expect(line).toHaveTextContent(
      `${en.forgotPassword.rememberPasswordPrompt} ${en.forgotPassword.loginLink}`,
    );
    expect(within(line).getByRole("link")).toBe(toSignIn[0]);

    // The card holds the email field and its button, and no link.
    const card: HTMLElement = screen.getByTestId("forgot-password-card");
    expect(within(card).getByRole("textbox")).toBeInTheDocument();
    expect(
      within(card).getByRole("button", {
        name: en.forgotPassword.submitButton,
      }),
    ).toBeInTheDocument();
    expect(within(card).queryAllByRole("link")).toEqual([]);
  });
});
