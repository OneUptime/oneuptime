import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The other ways to sign in, in every language - Accounts (the sign-in,
 * single sign-on and sign-up pages) and status pages (a private page's
 * sign-in).
 *
 * Under each page's filled button: an "or" divider, then the other ways in
 * as buttons. Their words are held here, in all 17 languages:
 *  - "or" is one word, the same word on both apps' pages and the one the
 *    single sign-on page's "Or continue with email" starts with;
 *  - "Sign in with SSO" sits beside "Sign in with Microsoft" and "Sign in
 *    with a passkey", so it is worded like them: the same words for "sign
 *    in", and the Microsoft label with the provider swapped;
 *  - "Sign in with password", the single sign-on page's way back, names the
 *    password the way the sign-in form's Password field does;
 *  - a status page's "Log in with SSO" is the title of the page it opens;
 *  - the link wordings they replace are gone, and every key is one a page
 *    reads.
 */

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);
const ACCOUNTS_SRC: string = path.join(FEATURE_SETS, "Accounts", "src");
const STATUS_PAGE_SRC: string = path.join(FEATURE_SETS, "StatusPage", "src");

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
];

// Where a language's label for the password inflects the field's word.
const PASSWORD_STEM: Record<string, string> = {
  // "Войти с паролем": the instrumental of "Пароль".
  ru: "парол",
};

/*
 * Portuguese names the company with its article ("Entrar com a Microsoft");
 * single sign-on takes none ("Entrar com SSO").
 */
const MICROSOFT_ARTICLE: Record<string, string> = {
  pt: "a Microsoft",
};

const PLACEHOLDER: RegExp = /\{\{|\}\}/;
const WHITESPACE: RegExp = /\s/;
const SENTENCE_END: RegExp = /[.!?。।؟]$/;

type Json = Record<string, unknown>;

const readJson: (file: string) => Json = (file: string): Json => {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
};

const accounts: (language: string) => Json = (language: string): Json => {
  return readJson(path.join(ACCOUNTS_SRC, "Locales", `${language}.json`));
};

const statusPage: (language: string) => Json = (language: string): Json => {
  return readJson(path.join(STATUS_PAGE_SRC, "Locales", `${language}.json`));
};

const valueAt: (locale: Json, key: string) => unknown = (
  locale: Json,
  key: string,
): unknown => {
  return key.split(".").reduce((node: unknown, part: string): unknown => {
    return node && typeof node === "object" ? (node as Json)[part] : undefined;
  }, locale as unknown);
};

const text: (locale: Json, key: string) => string = (
  locale: Json,
  key: string,
): string => {
  const value: unknown = valueAt(locale, key);
  return typeof value === "string" ? value : "";
};

// What two labels start, and end, with in common.
const sharedEnds: (
  first: string,
  second: string,
) => { start: string; end: string } = (
  first: string,
  second: string,
): { start: string; end: string } => {
  const one: Array<string> = Array.from(first);
  const other: Array<string> = Array.from(second);
  let start: number = 0;
  while (
    start < one.length &&
    start < other.length &&
    one[start] === other[start]
  ) {
    start++;
  }
  let end: number = 0;
  while (
    end < one.length - start &&
    end < other.length - start &&
    one[one.length - 1 - end] === other[other.length - 1 - end]
  ) {
    end++;
  }
  return {
    start: one.slice(0, start).join("").trim(),
    end: one
      .slice(one.length - end)
      .join("")
      .trim(),
  };
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
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
};

const readSource: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return fs.readFileSync(path.join(...parts), "utf8");
};

const ACCOUNTS_KEYS: Array<string> = [
  "common.or",
  "login.signInWithSso",
  "sso.signInWithPassword",
];

const STATUS_PAGE_KEYS: Array<string> = [
  "accounts.login.or",
  "accounts.login.logInWithSso",
];

describe("The other ways to sign in, in every language", () => {
  test("the list here is every Accounts and every status page locale", () => {
    for (const directory of [
      path.join(ACCOUNTS_SRC, "Locales"),
      path.join(STATUS_PAGE_SRC, "Locales"),
    ]) {
      const files: Array<string> = fs
        .readdirSync(directory)
        .filter((file: string) => {
          return file.endsWith(".json");
        })
        .map((file: string) => {
          return file.slice(0, -".json".length);
        })
        .sort();

      expect(files).toEqual([...LANGUAGES].sort());
    }
  });

  test.each(LANGUAGES)(
    "%s: every label is there, filled in, one line, and none ends like a sentence",
    (language: string) => {
      const checks: Array<{ app: string; locale: Json; key: string }> = [
        ...ACCOUNTS_KEYS.map((key: string) => {
          return { app: "Accounts", locale: accounts(language), key };
        }),
        ...STATUS_PAGE_KEYS.map((key: string) => {
          return { app: "StatusPage", locale: statusPage(language), key };
        }),
      ];

      for (const { app, locale, key } of checks) {
        const value: string = text(locale, key);

        expect({
          language,
          app,
          key,
          value,
          filled: value.trim().length > 0,
          trimmed: value === value.trim(),
          placeholder: PLACEHOLDER.test(value),
          sentenceEnd: SENTENCE_END.test(value),
        }).toEqual({
          language,
          app,
          key,
          value,
          filled: true,
          trimmed: true,
          placeholder: false,
          sentenceEnd: false,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the link wordings these buttons replace are gone",
    (language: string) => {
      expect({
        language,
        useSso: valueAt(accounts(language), "login.useSso"),
        useUsernameInstead: valueAt(
          accounts(language),
          "sso.useUsernameInstead",
        ),
        useSSO: valueAt(statusPage(language), "accounts.login.useSSO"),
      }).toEqual({
        language,
        useSso: undefined,
        useUsernameInstead: undefined,
        useSSO: undefined,
      });
    },
  );

  test.each(LANGUAGES)(
    "%s: 'or' is one word, the same on both apps' sign-in pages, and the word 'Or continue with email' starts with",
    (language: string) => {
      const or: string = text(accounts(language), "common.or");
      const continueWithEmail: string = text(
        accounts(language),
        "sso.globalProvidersDivider",
      );

      expect({
        language,
        or,
        oneWord: !WHITESPACE.test(or),
        lowerCase: or === or.toLocaleLowerCase(language),
        statusPage: text(statusPage(language), "accounts.login.or"),
        startsContinueWithEmail: continueWithEmail
          .toLocaleLowerCase(language)
          .startsWith(or),
      }).toEqual({
        language,
        or,
        oneWord: true,
        lowerCase: true,
        statusPage: or,
        startsContinueWithEmail: true,
      });
    },
  );

  test.each(LANGUAGES)(
    "%s: 'Sign in with SSO' is worded like 'Sign in with Microsoft' beside it",
    (language: string) => {
      const locale: Json = accounts(language);
      const sso: string = text(locale, "login.signInWithSso");
      const microsoft: string = text(locale, "login.signInWithMicrosoft");
      const provider: string = MICROSOFT_ARTICLE[language] || "Microsoft";

      expect(sso).toContain("SSO");
      expect(microsoft).toContain(provider);
      expect({ language, sso }).toEqual({
        language,
        sso: microsoft.split(provider).join("SSO"),
      });
    },
  );

  test.each(LANGUAGES)(
    "%s: the sign-in pages' options share the words for 'sign in'",
    (language: string) => {
      const locale: Json = accounts(language);
      const sso: string = text(locale, "login.signInWithSso");

      for (const key of [
        "login.passkey.signIn",
        "login.signInWithMicrosoft",
        "sso.signInWithPassword",
      ]) {
        const shared: { start: string; end: string } = sharedEnds(
          sso,
          text(locale, key),
        );

        expect({
          language,
          key,
          shared,
          sharesTheWords:
            Array.from(shared.start).length >= 2 ||
            Array.from(shared.end).length >= 2,
        }).toEqual({ language, key, shared, sharesTheWords: true });
      }
    },
  );

  test("the shared-words check sees labels worded differently (positive control)", () => {
    const shared: { start: string; end: string } = sharedEnds(
      "Sign in with SSO",
      "Use a passkey instead",
    );

    expect(shared).toEqual({ start: "", end: "" });
    expect(
      sharedEnds("Mit SSO anmelden", "Mit einem Passkey anmelden"),
    ).toEqual({ start: "Mit", end: "anmelden" });
    expect(sharedEnds("SSO でサインイン", "パスキーでサインイン").end).toBe(
      "でサインイン",
    );
  });

  test.each(LANGUAGES)(
    "%s: 'Sign in with password' names the password as the sign-in form's field does",
    (language: string) => {
      const locale: Json = accounts(language);
      const label: string = text(locale, "sso.signInWithPassword");
      const field: string = text(locale, "common.password");
      const word: string = PASSWORD_STEM[language] || field;

      expect({
        language,
        label,
        word,
        namesThePassword: label
          .toLocaleLowerCase(language)
          .includes(word.toLocaleLowerCase(language)),
      }).toEqual({ language, label, word, namesThePassword: true });
    },
  );

  test("the Russian stem is the field's word, inflected (positive control)", () => {
    expect(text(accounts("ru"), "common.password").toLowerCase()).toContain(
      PASSWORD_STEM["ru"]!,
    );
  });

  test.each(LANGUAGES)(
    "%s: a status page's 'Log in with SSO' is the title of the page it opens",
    (language: string) => {
      const locale: Json = statusPage(language);
      const label: string = text(locale, "accounts.login.logInWithSso");

      expect(label).toBe(text(locale, "accounts.sso.title"));
      expect(label).toContain("SSO");
    },
  );
});

/*
 * English Accounts said "Login" on the sign-in page's own button, beside
 * "Sign in with SSO", "Sign in with Microsoft" and "Sign in with a passkey",
 * under the title "Sign in to your account" - three words for one action
 * (#4911's review). Every English Accounts string now says "sign in", as
 * every other language already did with its own one word.
 */
describe("English Accounts says 'sign in', one way", () => {
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

  // "Login", "Log in", "log-in", "login to": the word for the action, not "Sign in".
  const OTHER_WORD_FOR_SIGNING_IN: RegExp = /\blog[\s-]?in\b/i;

  test("no English string calls signing in 'Login' or 'Log in'", () => {
    const offenders: Array<string> = strings(accounts("en"))
      .filter(([, value]: [string, string]): boolean => {
        return OTHER_WORD_FOR_SIGNING_IN.test(value);
      })
      .map(([key, value]: [string, string]): string => {
        return `${key}: ${value}`;
      });

    expect(offenders).toEqual([]);
  });

  test("the check sees each form of the other word (positive control)", () => {
    for (const sample of ["Login", "Log in.", "log-in", "want to login to"]) {
      expect(OTHER_WORD_FOR_SIGNING_IN.test(sample)).toBe(true);
    }
    for (const sample of ["Sign in", "Logging", "blogin", "logins"]) {
      expect(OTHER_WORD_FOR_SIGNING_IN.test(sample)).toBe(false);
    }
  });

  test("the page's own buttons and the way back say what the options say", () => {
    const en: Json = accounts("en");

    expect(text(en, "login.submitButton")).toBe("Sign in");
    expect(text(en, "login.title")).toBe("Sign in to your account");
    expect(text(en, "sso.title")).toBe(text(en, "login.signInWithSso"));
    expect(text(en, "sso.submitButton")).toBe(text(en, "login.signInWithSso"));
    for (const link of [
      "register.loginLink",
      "forgotPassword.loginLink",
      "resetPassword.loginLink",
      "verifyEmail.loginLink",
    ]) {
      expect(`${link}: ${text(en, link)}`).toBe(`${link}: Sign in.`);
    }
  });
});

describe("The pages read these words, and draw these buttons", () => {
  const login: string = readSource(ACCOUNTS_SRC, "Pages", "Login.tsx");
  const singleSignOn: string = readSource(
    ACCOUNTS_SRC,
    "Pages",
    "LoginWithSSO.tsx",
  );
  const register: string = readSource(ACCOUNTS_SRC, "Pages", "Register.tsx");
  const microsoft: string = readSource(
    ACCOUNTS_SRC,
    "Components",
    "MicrosoftSignInButton",
    "MicrosoftSignInButton.tsx",
  );
  const statusPageLogin: string = readSource(
    STATUS_PAGE_SRC,
    "Pages",
    "Accounts",
    "Login.tsx",
  );

  test("every key is read by the page it is for", () => {
    expect(login).toContain('t("common.or")');
    expect(login).toContain('t("login.signInWithSso")');
    expect(singleSignOn).toContain('t("common.or")');
    expect(singleSignOn).toContain('t("sso.signInWithPassword")');
    expect(register).toContain('t("common.or")');
    expect(statusPageLogin).toContain('t("accounts.login.or")');
    expect(statusPageLogin).toContain('t("accounts.login.logInWithSso")');
  });

  test("no source file reads a retired link wording", () => {
    const retired: Array<string> = [
      '"login.useSso"',
      '"sso.useUsernameInstead"',
      '"accounts.login.useSSO"',
    ];
    const readers: Array<string> = [];

    for (const file of [
      ...sourceFiles(ACCOUNTS_SRC),
      ...sourceFiles(STATUS_PAGE_SRC),
    ]) {
      const source: string = fs.readFileSync(file, "utf8");
      for (const key of retired) {
        if (source.includes(key)) {
          readers.push(`${path.basename(file)}: ${key}`);
        }
      }
    }

    expect(readers).toEqual([]);
  });

  test("each other way in is drawn with the shared look, under the shared divider", () => {
    // The sign-in page: the divider, single sign-on, and the passkey button.
    expect(login).toContain("<LabelledDivider");
    expect(login).toContain("<SignInOptionLink");
    expect(login).toContain(
      "className={getSignInOptionClassName(passkeyOptionState)}",
    );
    // Sign in (and up) with Microsoft.
    expect(microsoft).toContain(
      'className={getSignInOptionClassName("ready")}',
    );
    // The single sign-on page's way back.
    expect(singleSignOn).toContain("<SignInOptionLink");
    expect(singleSignOn).toContain('to={new Route("/accounts/login")}');
    // Sign up with Microsoft sits under the divider.
    expect(register.indexOf("<LabelledDivider")).toBeGreaterThan(-1);
    expect(register.indexOf("<LabelledDivider")).toBeLessThan(
      register.indexOf("<MicrosoftSignInButton"),
    );
    // A status page's single sign-on.
    expect(statusPageLogin).toContain("<LabelledDivider");
    expect(statusPageLogin).toContain("<SignInOptionLink");
  });

  /*
   * The single sign-on page drew its divider as a line behind words on a
   * white patch; on anything but a white card the patch shows as a box.
   */
  test("no sign-in page draws a divider as a line behind a white patch", () => {
    const pages: Array<string> = [
      ...sourceFiles(path.join(ACCOUNTS_SRC, "Pages")),
      ...sourceFiles(path.join(STATUS_PAGE_SRC, "Pages", "Accounts")),
    ];

    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      expect({
        page: path.basename(page),
        whitePatchDivider: fs
          .readFileSync(page, "utf8")
          .includes("absolute inset-0 flex items-center"),
      }).toEqual({ page: path.basename(page), whitePatchDivider: false });
    }
  });
});
