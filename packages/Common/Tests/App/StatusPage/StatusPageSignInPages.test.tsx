import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AuthPage, {
  AUTH_PAGE_CARD_TEST_ID,
  AUTH_PAGE_FOOTER_TEST_ID,
  AUTH_PAGE_SUBTITLE_TEST_ID,
  AUTH_PAGE_TEST_ID,
  AUTH_PAGE_TITLE_TEST_ID,
} from "../../../UI/Components/AuthPage/AuthPage";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import UserUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import MasterPasswordPage from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/MasterPassword";
import { getJestSpyOn } from "../../Spy";

/*
 * A status page's sign-in pages (#9132): one frame, the one OneUptime's own
 * sign-in pages are drawn in, and one name for signing in.
 *
 * The seven pages a private user signs in through - sign in, single
 * sign-on, the sign-in link and the page it opens, the password prompt,
 * forgot and reset password - kept an old copy of the frame: no gutter on a
 * phone, so a square card ran from one edge of a 390px screen to the other,
 * a 24px title at every width and 48px of space above the logo. They draw
 * Common's AuthPage now, as Accounts does, so the two match on a phone and
 * in the dark theme.
 *
 * And one flow said "Please login to view…", "Login", "Log In", "Log in"
 * and "Back to sign in" for the same action, beside "password is
 * required." in lower case. Accounts says "Sign in": so does every status
 * page string, in Title Case on a button and as a sentence elsewhere, and
 * the keys say it too, so a new string is not written after an old name.
 */

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (key: string) => string = (key: string): string => {
    let node: unknown = english;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    return typeof node === "string" ? node : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

type Json = Record<string, any>;

const APP: string = path.resolve(__dirname, "..", "..", "..", "..", "App");
const STATUS_PAGE_SRC: string = path.join(
  APP,
  "FeatureSet",
  "StatusPage",
  "src",
);
const LOCALES_DIR: string = path.join(STATUS_PAGE_SRC, "Locales");
const ACCOUNTS_LOCALES_DIR: string = path.join(
  APP,
  "FeatureSet",
  "Accounts",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
  "ar",
];

// Every page a status page draws on its own, in the sign-in frame.
const FRAMED_PAGES: Array<string> = [
  "Pages/Accounts/Login.tsx",
  "Pages/Accounts/SSO.tsx",
  "Pages/Accounts/MagicLink.tsx",
  "Pages/Accounts/MagicLinkLogin.tsx",
  "Pages/Accounts/MasterPassword.tsx",
  "Pages/Accounts/ForgotPassword.tsx",
  "Pages/Accounts/ResetPassword.tsx",
  // Not a sign-in page, but drawn on its own with the page's logo, as they are.
  "Pages/Subscribe/Unsubscribe.tsx",
];

// The old frame's classes, each a part of what was wrong on a phone.
const OLD_FRAME_CLASSES: Array<string> = [
  // A card squared off until 640px, running edge to edge with no gutter.
  "sm:rounded-lg",
  // 48px above the logo at every width.
  "py-12 sm:px-6",
  // The column only centred from 640px.
  "sm:mx-auto sm:w-full sm:max-w-md",
];

// The keys that named the action "log in", and what each is called now.
const RENAMED_KEYS: Array<[string, string]> = [
  ["accounts.shared.login", "accounts.shared.signInLink"],
  ["accounts.login.loginPrompt", "accounts.login.signInPrompt"],
  ["accounts.login.logInWithSso", "accounts.login.signInWithSso"],
  ["accounts.sso.loginPrompt", "accounts.sso.signInPrompt"],
  ["accounts.sso.backToLogin", "accounts.sso.backToSignIn"],
  ["accounts.sso.logInWithPassword", "accounts.sso.signInWithPassword"],
  ["accounts.resetPassword.loginButton", "accounts.resetPassword.signInButton"],
];

const SOURCE_FILE: RegExp = /\.tsx?$/;

// "Login", "Log in", "log-in", "login to": the action named another way.
const OTHER_WORD_FOR_SIGNING_IN: RegExp = /\blog[\s-]?in\b/i;

const readJson: (file: string) => Json = (file: string): Json => {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
};

const statusPage: (language: string) => Json = (language: string): Json => {
  return readJson(path.join(LOCALES_DIR, `${language}.json`));
};

const valueAt: (locale: Json, key: string) => unknown = (
  locale: Json,
  key: string,
): unknown => {
  let node: unknown = locale;

  for (const part of key.split(".")) {
    node =
      node !== null && typeof node === "object"
        ? (node as Json)[part]
        : undefined;
  }

  return node;
};

const strings: (locale: Json, prefix?: string) => Array<[string, string]> = (
  locale: Json,
  prefix: string = "",
): Array<[string, string]> => {
  const found: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(locale)) {
    const at: string = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      found.push([at, value]);
    } else if (value && typeof value === "object") {
      found.push(...strings(value as Json, at));
    }
  }

  return found;
};

const sourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales" && entry.name !== "node_modules") {
        files.push(...sourceFiles(full));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

describe("the sign-in frame", () => {
  afterEach(() => {
    cleanup();
  });

  test("draws a column with a gutter on a phone, a card rounded at every width, and a title that fits a phone", () => {
    render(
      <AuthPage
        logo={<img alt="Acme" />}
        title="Welcome back!"
        subtitle="Sign in to view Acme."
        footer={<a href="/forgot-password">Forgot password?</a>}
      >
        <form />
      </AuthPage>,
    );

    const page: HTMLElement = screen.getByTestId(AUTH_PAGE_TEST_ID);
    const title: HTMLElement = screen.getByTestId(AUTH_PAGE_TITLE_TEST_ID);
    const card: HTMLElement = screen.getByTestId(AUTH_PAGE_CARD_TEST_ID);

    // A 16px gutter and 32px above the logo on a phone, 48px from 640px up.
    expect(page).toHaveClass("px-4", "py-8", "sm:py-12");
    expect(page).not.toHaveClass("py-12");

    // 20px on a phone, 24px from 640px up; a long name wraps.
    expect(title).toHaveClass("text-xl", "sm:text-2xl", "break-words");
    expect(title).not.toHaveClass("text-2xl");
    expect(title).toHaveTextContent("Welcome back!");

    expect(card).toHaveClass("rounded-lg", "bg-white");
    expect(card).not.toHaveClass("sm:rounded-lg");
    expect(card.parentElement).toHaveClass("w-full", "max-w-md", "mx-auto");

    expect(screen.getByTestId(AUTH_PAGE_SUBTITLE_TEST_ID)).toHaveTextContent(
      "Sign in to view Acme.",
    );
    expect(screen.getByTestId(AUTH_PAGE_FOOTER_TEST_ID)).toHaveTextContent(
      "Forgot password?",
    );
  });

  test("draws no title, subtitle, card or footer it is not given", () => {
    render(
      <AuthPage hasCard={false} beforeCard={<p>Ask your admin.</p>}>
        <form />
      </AuthPage>,
    );

    expect(screen.queryByTestId(AUTH_PAGE_TITLE_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(AUTH_PAGE_SUBTITLE_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(AUTH_PAGE_CARD_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(AUTH_PAGE_FOOTER_TEST_ID)).toBeNull();
    expect(screen.getByText("Ask your admin.")).toBeInTheDocument();
  });

  test.each(FRAMED_PAGES)(
    "%s is drawn in it, with none of the old frame",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(STATUS_PAGE_SRC, file),
        "utf8",
      );

      expect(source).toContain('from "Common/UI/Components/AuthPage/AuthPage"');
      expect(source).toContain("<AuthPage");

      for (const oldClass of OLD_FRAME_CLASSES) {
        expect([file, source.includes(oldClass)]).toEqual([file, false]);
      }
    },
  );

  test("so are Accounts' forgot and reset password pages, where the frame came from", () => {
    for (const page of ["ForgotPassword.tsx", "ResetPassword.tsx"]) {
      const source: string = fs.readFileSync(
        path.join(APP, "FeatureSet", "Accounts", "src", "Pages", page),
        "utf8",
      );

      expect([page, source.includes("<AuthPage")]).toEqual([page, true]);
    }
  });
});

describe("a status page's password prompt, in the frame", () => {
  beforeEach(() => {
    getJestSpyOn(StatusPageUtil, "getStatusPageId").mockReturnValue(
      new ObjectID("11111111-1111-4111-8111-111111111111"),
    );
    getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockReturnValue(true);
    getJestSpyOn(StatusPageUtil, "requiresMasterPassword").mockReturnValue(
      true,
    );
    getJestSpyOn(StatusPageUtil, "isMasterPasswordValidated").mockReturnValue(
      false,
    );
    getJestSpyOn(StatusPageUtil, "isPreviewPage").mockReturnValue(false);
    getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("names the page in the frame's title, with what to do under it, and the form in its card", async () => {
    await act(async () => {
      render(
        <MasterPasswordPage
          statusPageName="Acme Status"
          logoFileId={new ObjectID("")}
        />,
      );
    });

    const title: HTMLElement = screen.getByTestId("master-password-title");

    expect(title).toHaveTextContent("Acme Status");
    expect(title).toHaveClass("text-xl", "sm:text-2xl");
    expect(screen.getByTestId("master-password-prompt")).toHaveTextContent(
      "Enter the password to view this status page.",
    );
    expect(
      screen
        .getByTestId(AUTH_PAGE_CARD_TEST_ID)
        .querySelector("#master-password-form"),
    ).not.toBeNull();
  });
});

describe("one name for signing in, in every status page language", () => {
  test("English names it 'sign in' in every status page string", () => {
    const others: Array<string> = strings(statusPage("en"))
      .filter(([, value]: [string, string]) => {
        return OTHER_WORD_FOR_SIGNING_IN.test(value);
      })
      .map(([key, value]: [string, string]) => {
        return `${key}: ${value}`;
      });

    expect(others).toEqual([]);
  });

  test("the check sees each old name (positive control)", () => {
    for (const old of [
      "Please login to view Acme",
      "Login",
      "Log In",
      "Log in with SSO",
      "If you can log-in",
    ]) {
      expect([old, OTHER_WORD_FOR_SIGNING_IN.test(old)]).toEqual([old, true]);
    }

    for (const fine of ["Sign in", "Log Out", "Blogging"]) {
      expect([fine, OTHER_WORD_FOR_SIGNING_IN.test(fine)]).toEqual([
        fine,
        false,
      ]);
    }
  });

  test("English says it in Title Case on a button and as a sentence elsewhere", () => {
    const english: Json = statusPage("en");

    expect({
      submit: valueAt(english, "accounts.login.submit"),
      resetSignIn: valueAt(english, "accounts.resetPassword.signInButton"),
      linkSignIn: valueAt(english, "accounts.magicLinkLogin.submit"),
      prompt: valueAt(english, "accounts.login.signInPrompt"),
      ssoPrompt: valueAt(english, "accounts.sso.signInPrompt"),
      link: valueAt(english, "accounts.shared.signInLink"),
      backToSignIn: valueAt(english, "accounts.sso.backToSignIn"),
      passwordRequired: valueAt(
        english,
        "accounts.masterPassword.passwordRequired",
      ),
    }).toEqual({
      submit: "Sign In",
      resetSignIn: "Sign In",
      linkSignIn: "Sign In",
      prompt: "Sign in to view {{statusPageName}}.",
      ssoPrompt: "Sign in to view {{statusPageName}}.",
      link: "Sign in.",
      backToSignIn: "Back to sign in",
      passwordRequired: "Password is required.",
    });
  });

  test("the other ways in are worded as Accounts words them", () => {
    const english: Json = statusPage("en");
    const accounts: Json = readJson(path.join(ACCOUNTS_LOCALES_DIR, "en.json"));

    expect(valueAt(english, "accounts.login.signInWithSso")).toBe(
      valueAt(accounts, "login.signInWithSso"),
    );
    expect(valueAt(english, "accounts.sso.signInWithPassword")).toBe(
      valueAt(accounts, "sso.signInWithPassword"),
    );
    expect(valueAt(english, "accounts.magicLink.title")).toBe(
      valueAt(accounts, "magicLink.title"),
    );
  });

  test.each(LANGUAGES)(
    "%s: every renamed key is there under its new name, and gone under its old",
    (language: string) => {
      const locale: Json = statusPage(language);

      for (const [oldKey, newKey] of RENAMED_KEYS) {
        const value: unknown = valueAt(locale, newKey);

        expect([language, oldKey, valueAt(locale, oldKey)]).toEqual([
          language,
          oldKey,
          undefined,
        ]);
        expect([language, newKey, typeof value]).toEqual([
          language,
          newKey,
          "string",
        ]);
        expect([language, newKey, (value as string).trim().length > 0]).toEqual(
          [language, newKey, true],
        );
      }

      // Drawn nowhere: a signed-out visitor is sent to sign in, not offered a nav item.
      expect([language, valueAt(locale, "nav.login")]).toEqual([
        language,
        undefined,
      ]);
    },
  );

  test.each(LANGUAGES)(
    "%s: the link at the end of a sentence is Accounts' own, ending as a sentence does",
    (language: string) => {
      const accounts: Json = readJson(
        path.join(ACCOUNTS_LOCALES_DIR, `${language}.json`),
      );

      expect(valueAt(statusPage(language), "accounts.shared.signInLink")).toBe(
        valueAt(accounts, "resetPassword.loginLink"),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: 'Password is required.' starts with a capital, as a sentence does",
    (language: string) => {
      const value: string = valueAt(
        statusPage(language),
        "accounts.masterPassword.passwordRequired",
      ) as string;
      const first: string = Array.from(value)[0]!;

      expect([
        language,
        value,
        first === first.toLocaleLowerCase(language) &&
          first !== first.toLocaleUpperCase(language),
      ]).toEqual([language, value, false]);
    },
  );

  test("no status page source reads a key under its old name", () => {
    const readers: Array<string> = [];

    for (const file of sourceFiles(STATUS_PAGE_SRC)) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const [oldKey] of RENAMED_KEYS) {
        if (source.includes(`"${oldKey}"`)) {
          readers.push(`${path.basename(file)}: ${oldKey}`);
        }
      }

      if (source.includes('"nav.login"')) {
        readers.push(`${path.basename(file)}: nav.login`);
      }
    }

    expect(readers).toEqual([]);
  });
});
