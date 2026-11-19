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
import GlobalConfigUtil from "../../../UI/Utils/GlobalConfig";
import Navigation from "../../../UI/Utils/Navigation";
import { standInForGlobalConfig } from "../../Helpers/GlobalConfigStandIn";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import ForgotPasswordPage, {
  FORGOT_PASSWORD_CANNOT_EMAIL_TEST_ID,
} from "../../../../App/FeatureSet/Accounts/src/Pages/ForgotPassword";
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
 *     the ones the "check your email" screen used then (it asks "Ready to
 *     sign in?" since #9816, for every address that signs up).
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
  test("in all 18 languages", () => {
    expect(LANGUAGES).toHaveLength(18);
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

  /*
   * The two screens asked one question until #9816. Since then every
   * sign-up sees the "check your email" screen - whether its address was
   * new, already had an account, or had an invitation waiting - so that
   * screen asks a question true for all of them, "Ready to sign in?", and
   * its link says "Go to sign in". A failed verification link still asks
   * whether an earlier click verified the address.
   */
  test("a failed verification link asks whether an earlier click verified the address", () => {
    expect(text(en as Json, "verifyEmail.alreadyVerifiedPrompt")).toBe(
      "Already verified your email?",
    );
  });

  test("the 'check your email' screen asks a question true for every address that signed up (#9816)", () => {
    expect(text(en as Json, "register.verifyEmailAlreadyVerifiedPrompt")).toBe(
      "Ready to sign in?",
    );

    for (const language of LANGUAGES) {
      const data: Json = locale(language);

      // Its own words in every language, never the failed link's.
      expect({
        language,
        differs:
          text(data, "register.verifyEmailAlreadyVerifiedPrompt") !==
          text(data, "verifyEmail.alreadyVerifiedPrompt"),
      }).toEqual({ language, differs: true });
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

/*
 * The forgot password page asks the server whether it can send email
 * (GET /global-config/vars, through GlobalConfigUtil.fetchVars), and draws
 * its form or, where it cannot, says so in the form's place (#8837). Each
 * test answers that read itself: a suite that leaves it to the network has
 * it refused (Tests/Helpers/RealNetworkRequests.ts) and fails.
 */
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

  // Draws the page on a server that can, or cannot, send email.
  async function draw(canSendEmail: boolean): Promise<void> {
    standInForGlobalConfig({ canSendEmail });

    await act(async () => {
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>,
      );
    });
  }

  // The page's one link to sign in, on the line under the card, whichever the server's answer.
  function expectOneWayBack(): void {
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
  }

  test("has one way back to sign in, under its card, where the server can send email", async () => {
    await draw(true);

    expectOneWayBack();
    expect(
      screen.queryByTestId(FORGOT_PASSWORD_CANNOT_EMAIL_TEST_ID),
    ).toBeNull();

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

  test("keeps its one way back where the server cannot send email, which it says in the card's place", async () => {
    await draw(false);

    expectOneWayBack();
    expect(screen.queryByTestId("forgot-password-card")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.getByTestId(FORGOT_PASSWORD_CANNOT_EMAIL_TEST_ID),
    ).toHaveTextContent(en.forgotPassword.cannotEmail);
  });

  test.each([
    ["can", true],
    ["cannot", false],
  ])(
    "asks the suite, not the network, whether the server %s send email (control)",
    async (_can: string, canSendEmail: boolean) => {
      await draw(canSendEmail);

      expect(GlobalConfigUtil.fetchVars).toHaveBeenCalled();
    },
  );
});
