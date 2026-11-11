import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "../../../UI/Utils/GlobalConfig";
import Navigation from "../../../UI/Utils/Navigation";
import {
  PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE,
  SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE,
} from "../../../Types/ServerSending/ServerSendingWords";
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

// A server that takes sign-in links, so the link page is drawn.
jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/SignInMethods", () => {
  return {
    __esModule: true,
    readSignInMethods: (): Promise<unknown> => {
      return Promise.resolve({
        isSsoRequired: false,
        ssoProviders: [],
        hasProjectSsoProviders: false,
        isMagicLinkLoginEnabled: true,
      });
    },
    useSignInMethods: (): unknown => {
      return {
        signInMethods: {
          isSsoRequired: false,
          ssoProviders: [],
          hasProjectSsoProviders: false,
          isMagicLinkLoginEnabled: true,
        },
        isReading: false,
        readAgain: (): void => {
          return undefined;
        },
      };
    },
  };
});

import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import ForgotPasswordPage, {
  FORGOT_PASSWORD_CANNOT_EMAIL_TEST_ID,
} from "../../../../App/FeatureSet/Accounts/src/Pages/ForgotPassword";
import MagicLinkPage, {
  MAGIC_LINK_CANNOT_EMAIL_TEST_ID,
  MAGIC_LINK_FORM_TEST_ID,
} from "../../../../App/FeatureSet/Accounts/src/Pages/MagicLink";

/*
 * THE SIGN-IN PAGES ON A SERVER THAT CANNOT SEND EMAIL (#6825).
 *
 * Forgot password and "Sign in with a link" would email their reader. While
 * the server says it cannot send email (GET /global-config/vars'
 * canSendEmail), each says so in place of its form, before anyone types,
 * and who can let them in instead. It is the same for everyone who opens
 * the page - a fact about the server, never about an account. Anywhere
 * else - the server can send, says nothing, or cannot be read - the pages
 * are exactly as they were. Every language says it, in words that name the
 * server's admin, and the English is the server's own refusal.
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

function locale(language: string): Json {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Json;
}

function serverSays(vars: Partial<GlobalConfigVars> | Error): void {
  jest
    .spyOn(GlobalConfigUtil, "fetchVars")
    .mockImplementation(async (): Promise<GlobalConfigVars> => {
      if (vars instanceof Error) {
        throw vars;
      }

      return {
        disableUserProjectCreation: false,
        disablePushNotifications: false,
        canSendEmail: true,
        ...vars,
      };
    });
}

async function draw(page: React.ReactElement): Promise<void> {
  await act(async () => {
    render(<MemoryRouter>{page}</MemoryRouter>);
  });
}

beforeEach(() => {
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    // A page that would move on stays put here.
  });
});

afterEach(() => {
  cleanup();
  GlobalConfigUtil.clearCache();
  jest.restoreAllMocks();
});

describe("Forgot password", () => {
  test("a server that cannot send email says so, and who can reset it, in place of the form", async () => {
    serverSays({ canSendEmail: false });

    await draw(<ForgotPasswordPage />);

    expect(
      screen.getByTestId(FORGOT_PASSWORD_CANNOT_EMAIL_TEST_ID),
    ).toHaveTextContent(en.forgotPassword.cannotEmail);
    expect(screen.queryByTestId("forgot-password-card")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(en.forgotPassword.subtitle)).toBeNull();

    // The way back to sign in stays.
    expect(screen.getByTestId("forgot-password-sign-in")).toBeInTheDocument();
  });

  test.each([
    ["can send email", { canSendEmail: true }],
    ["an older server that does not say", {}],
  ])("a server that %s: the form, as it always was", async (_name: string, vars: Partial<GlobalConfigVars>) => {
    serverSays(vars);

    await draw(<ForgotPasswordPage />);

    expect(screen.getByTestId("forgot-password-card")).toBeInTheDocument();
    expect(
      screen.queryByTestId(FORGOT_PASSWORD_CANNOT_EMAIL_TEST_ID),
    ).toBeNull();
  });

  test("an answer that cannot be read: the form, as it always was", async () => {
    serverSays(new Error("Network Error"));

    await draw(<ForgotPasswordPage />);

    expect(screen.getByTestId("forgot-password-card")).toBeInTheDocument();
  });
});

describe("Sign in with a link", () => {
  test("a server that cannot send email says so in place of the form", async () => {
    serverSays({ canSendEmail: false });

    await draw(<MagicLinkPage />);

    expect(screen.getByTestId(MAGIC_LINK_CANNOT_EMAIL_TEST_ID)).toHaveTextContent(
      en.magicLink.cannotEmail,
    );
    expect(screen.queryByTestId(MAGIC_LINK_FORM_TEST_ID)).toBeNull();
    expect(screen.queryByText(en.magicLink.subtitle)).toBeNull();
    expect(screen.getByTestId("magic-link-sign-in")).toBeInTheDocument();
  });

  test("a server that can send email: the form", async () => {
    serverSays({ canSendEmail: true });

    await draw(<MagicLinkPage />);

    expect(screen.getByTestId(MAGIC_LINK_FORM_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByTestId(MAGIC_LINK_CANNOT_EMAIL_TEST_ID)).toBeNull();
  });
});

describe("the words, in every language", () => {
  test("18 languages", () => {
    expect(LANGUAGES).toHaveLength(18);
  });

  test("the English is the server's own refusal, so the page and the API say the same", () => {
    expect(en.forgotPassword.cannotEmail).toBe(
      PASSWORD_RESET_CANNOT_BE_EMAILED_MESSAGE,
    );
    expect(en.magicLink.cannotEmail).toBe(SIGN_IN_LINK_CANNOT_BE_EMAILED_MESSAGE);
  });

  test.each(LANGUAGES.filter((language: string) => {
    return language !== "en";
  }))("%s says both in its own words", (language: string) => {
    const data: Json = locale(language);
    const forgot: unknown = (data["forgotPassword"] as Json)["cannotEmail"];
    const link: unknown = (data["magicLink"] as Json)["cannotEmail"];

    expect(typeof forgot).toBe("string");
    expect(typeof link).toBe("string");
    expect(forgot).not.toBe(en.forgotPassword.cannotEmail);
    expect(link).not.toBe(en.magicLink.cannotEmail);
    expect(forgot).not.toBe(link);
    // No placeholder to fill: the sentence speaks of the server.
    expect(String(forgot)).not.toMatch(/\{\{|\}\}/);
    expect(String(link)).not.toMatch(/\{\{|\}\}/);
  });
});
