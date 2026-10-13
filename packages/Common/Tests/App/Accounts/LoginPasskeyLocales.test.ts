import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The sign-in page's passkey copy, in all 17 Accounts languages.
 *
 * The page leads with the password form and offers passkeys as a quiet
 * option under it (Accounts/src/Pages/Login.tsx). These checks hold the copy
 * to that in every language, not only English:
 *
 *  - the subtitle names the password first and the passkey last;
 *  - "New to passkeys?" says what a passkey is and names the Dashboard's
 *    real menu, User Profile -> Security -> Passkeys, as that language's
 *    Dashboard draws it. The old copy sent people to "Passkeys & Two Factor
 *    Auth", a page the Dashboard no longer has; the mobile app's browser
 *    hand-off page (mobilePasskey.setup) names the same menu;
 *  - the keys only the retired passkey panel used are gone, and every
 *    login.passkey key left is one a page reads;
 *  - a canceled or timed-out attempt says what happened in one sentence:
 *    "Try passkey again" is drawn right above the notice and the password
 *    form above that, and the mobile hand-off page, which shows the same
 *    notices, has no password form at all;
 *  - where that hand-off page cannot use passkeys, it sends the person back
 *    to the app, as its other messages do, not to a form it does not have.
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
const ACCOUNTS_LOCALES: string = path.join(ACCOUNTS_SRC, "Locales");
const DASHBOARD_LOCALES: string = path.join(
  FEATURE_SETS,
  "Dashboard",
  "src",
  "Locales",
);
const PROFILE_SIDE_MENU: string = path.join(
  FEATURE_SETS,
  "Dashboard",
  "src",
  "Pages",
  "Global",
  "UserProfile",
  "SideMenu.tsx",
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
];

// How each language's sign-in copy names a password, and a passkey.
const PASSWORD_WORD: Record<string, string> = {
  en: "password",
  de: "Passwort",
  fr: "mot de passe",
  es: "contraseña",
  it: "password",
  pt: "senha",
  nl: "wachtwoord",
  da: "adgangskode",
  no: "passord",
  sv: "lösenord",
  ru: "пароль",
  ja: "パスワード",
  ko: "비밀번호",
  "zh-CN": "密码",
  "zh-TW": "密碼",
  hi: "पासवर्ड",
  fa: "رمز عبور",
};

const PASSKEY_WORD: Record<string, string> = {
  en: "passkey",
  de: "Passkey",
  fr: "clé d’accès",
  es: "clave de acceso",
  it: "passkey",
  pt: "chave de acesso",
  nl: "passkey",
  da: "adgangsnøgle",
  no: "passnøkkel",
  sv: "passnyckel",
  ru: "ключ доступа",
  ja: "パスキー",
  ko: "패스키",
  "zh-CN": "通行密钥",
  "zh-TW": "通行密鑰",
  hi: "पासकी",
  fa: "کلید عبور",
};

// What ends a sentence in these languages' notices.
const SENTENCE_ENDS: Array<string> = [".", "!", "?", "。", "।", "؟"];

// The notices a passkey attempt that did not sign in shows.
const ATTEMPT_NOTICES: Array<string> = [
  "login.passkey.notCompleted",
  "login.passkey.cancelled",
];

// A text's sentences, each with the mark that ends it.
const sentencesOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const sentences: Array<string> = [];
  let current: string = "";

  for (const character of Array.from(text)) {
    current += character;
    if (SENTENCE_ENDS.includes(character)) {
      sentences.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) {
    sentences.push(current.trim());
  }

  return sentences;
};

/*
 * What two texts start with in common, in whole words where the script
 * separates words with spaces: two different words can start alike.
 */
const sharedStart: (first: string, second: string) => string = (
  first: string,
  second: string,
): string => {
  const one: Array<string> = Array.from(first);
  const other: Array<string> = Array.from(second);
  let length: number = 0;

  while (
    length < one.length &&
    length < other.length &&
    one[length] === other[length]
  ) {
    length++;
  }

  const shared: string = one.slice(0, length).join("");
  const endsInsideAWord: boolean =
    length < one.length && one[length] !== " " && !shared.endsWith(" ");

  return endsInsideAWord && shared.includes(" ")
    ? shared.slice(0, shared.lastIndexOf(" ") + 1)
    : shared;
};

// The keys the retired tinted panel drew, and nothing else did.
const RETIRED_KEYS: Array<string> = [
  "title",
  "description",
  "passwordAlternative",
];

// A login.passkey key named in a page's source, as `"login.passkey.<key>"`.
const PASSKEY_KEY_IN_SOURCE: RegExp = /"login\.passkey\.([A-Za-z]+)"/g;

type Json = Record<string, unknown>;

const readJson: (file: string) => Json = (file: string): Json => {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
};

const accounts: (language: string) => Json = (language: string): Json => {
  return readJson(path.join(ACCOUNTS_LOCALES, `${language}.json`));
};

const valueAt: (locale: Json, key: string) => string = (
  locale: Json,
  key: string,
): string => {
  const value: unknown = key
    .split(".")
    .reduce((node: unknown, part: string): unknown => {
      return node && typeof node === "object"
        ? (node as Json)[part]
        : undefined;
    }, locale as unknown);

  return typeof value === "string" ? value : "";
};

const dashboardLocales: Map<string, Json> = new Map<string, Json>();

const dashboard: (language: string) => Json = (language: string): Json => {
  let locale: Json | undefined = dashboardLocales.get(language);

  if (!locale) {
    locale = readJson(path.join(DASHBOARD_LOCALES, `${language}.json`));
    dashboardLocales.set(language, locale);
  }

  return locale;
};

// What the Dashboard draws for an English label in a language (a flat key).
const drawnDashboardLabel: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  const translated: unknown = dashboard(language)[english];

  return typeof translated === "string" && translated.trim()
    ? translated
    : english;
};

// Persian copy writes a path right to left, with the arrow that points left.
const menuPath: (language: string) => string = (language: string): string => {
  const arrow: string = language === "fa" ? " ← " : " → ";

  return ["User Profile", "Security", "Passkeys"]
    .map((label: string) => {
      return drawnDashboardLabel(language, label);
    })
    .join(arrow);
};

const countOf: (text: string, part: string) => number = (
  text: string,
  part: string,
): number => {
  return text.split(part).length - 1;
};

const accountsSourceFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "Locales") {
          walk(full);
        }
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };
  walk(ACCOUNTS_SRC);
  return files;
};

describe("Sign-in passkey copy in every Accounts language", () => {
  test("the list here is every Accounts locale", () => {
    const files: Array<string> = fs
      .readdirSync(ACCOUNTS_LOCALES)
      .filter((file: string) => {
        return file.endsWith(".json");
      })
      .map((file: string) => {
        return file.slice(0, -".json".length);
      })
      .sort();

    expect(files).toEqual([...LANGUAGES].sort());
    expect(Object.keys(PASSWORD_WORD).sort()).toEqual(files);
    expect(Object.keys(PASSKEY_WORD).sort()).toEqual(files);
  });

  test.each(LANGUAGES)(
    "%s: the subtitle names the password, then SSO, and the passkey last",
    (language: string) => {
      const subtitle: string = valueAt(accounts(language), "login.subtitle");
      const lower: string = subtitle.toLowerCase();

      // Lower-casing these scripts keeps every index where it was.
      expect(lower.length).toBe(subtitle.length);

      const password: number = lower.indexOf(
        PASSWORD_WORD[language]!.toLowerCase(),
      );
      // Case-sensitive: Norwegian "passordet" holds a lower-case "sso".
      const sso: number = subtitle.indexOf("SSO");
      const passkey: number = lower.indexOf(
        PASSKEY_WORD[language]!.toLowerCase(),
      );

      expect({
        language,
        subtitle,
        namesThePassword: password >= 0,
        thenSso: sso > password,
        passkeyLast: passkey > sso,
      }).toEqual({
        language,
        subtitle,
        namesThePassword: true,
        thenSso: true,
        passkeyLast: true,
      });
    },
  );

  test.each(LANGUAGES)(
    "%s: 'New to passkeys?' names the Dashboard's menu as that language's Dashboard draws it",
    (language: string) => {
      const locale: Json = accounts(language);
      const help: string = valueAt(locale, "login.passkey.help");
      const setup: string = valueAt(locale, "mobilePasskey.setup");
      const arrow: string = language === "fa" ? "←" : "→";

      expect(valueAt(locale, "login.passkey.helpTitle")).not.toBe("");
      expect(help).toContain(menuPath(language));
      expect(setup).toContain(menuPath(language));

      // Three levels, two arrows: the retired path had two levels.
      expect(countOf(help, arrow)).toBe(2);
      expect(countOf(setup, arrow)).toBe(2);

      // It also says what a passkey is, before saying where to add one.
      const passkey: number = help
        .toLowerCase()
        .indexOf(PASSKEY_WORD[language]!.toLowerCase());
      expect(passkey).toBeGreaterThanOrEqual(0);
      expect(passkey).toBeLessThan(help.indexOf(menuPath(language)));
      expect(help.length).toBeGreaterThan(menuPath(language).length + 40);
    },
  );

  test("the menu the help names is the Dashboard's: User Profile > Security > Passkeys", () => {
    const sideMenu: string = fs.readFileSync(PROFILE_SIDE_MENU, "utf8");
    const security: number = sideMenu.indexOf(
      '<SideMenuSection title="Security">',
    );

    expect(security).toBeGreaterThanOrEqual(0);
    expect(sideMenu.indexOf('title: "Passkeys"')).toBeGreaterThan(security);
    expect(sideMenu).not.toContain("Passkeys & Two Factor Auth");

    const english: Json = accounts("en");
    expect(valueAt(english, "login.passkey.help")).toBe(
      "A passkey lets you sign in with your fingerprint, face, or device PIN instead of a password. To add one, sign in with your password or SSO, then open User Profile → Security → Passkeys.",
    );
    expect(valueAt(english, "mobilePasskey.setup")).toBe(
      "Create a passkey in the web dashboard, under User Profile → Security → Passkeys.",
    );
  });

  test.each(LANGUAGES)(
    "%s: a canceled or timed-out attempt says what happened, in one sentence",
    (language: string) => {
      const locale: Json = accounts(language);

      for (const key of ATTEMPT_NOTICES) {
        const notice: string = valueAt(locale, key);
        const characters: Array<string> = Array.from(notice);

        expect({
          language,
          key,
          notice,
          sentences: characters.filter((character: string) => {
            return SENTENCE_ENDS.includes(character);
          }).length,
          endsWithASentenceEnd: SENTENCE_ENDS.includes(
            characters[characters.length - 1] || "",
          ),
          namesThePassword: notice
            .toLowerCase()
            .includes(PASSWORD_WORD[language]!.toLowerCase()),
        }).toEqual({
          language,
          key,
          notice,
          sentences: 1,
          endsWithASentenceEnd: true,
          namesThePassword: false,
        });
      }
    },
  );

  test("the one-sentence check counts the sentences of a notice (positive control)", () => {
    const sentences: (text: string) => number = (text: string): number => {
      return Array.from(text).filter((character: string) => {
        return SENTENCE_ENDS.includes(character);
      }).length;
    };

    expect(
      sentences(
        "Passkey sign-in was canceled or timed out. Try again, or sign in with your password.",
      ),
    ).toBe(2);
    expect(sentences("通行密钥登录已取消或超时。请重试或使用密码登录。")).toBe(
      2,
    );
    expect(
      sentences(
        "पासकी से साइन इन रद्द हो गया या समय समाप्त हो गया। दोबारा कोशिश करें या अपने पासवर्ड से साइन इन करें।",
      ),
    ).toBe(2);
    expect(sentences("Passkey sign-in canceled.")).toBe(1);
  });

  /*
   * The mobile app's browser hand-off page has no password form and no SSO
   * link. Where it cannot use passkeys it used to show the sign-in page's
   * sentence, "...You can still sign in with your password or SSO". Its own
   * sentence says the same first thing, then sends the person back to the
   * app, in the words its other messages use for that.
   */
  test.each(LANGUAGES)(
    "%s: where the hand-off page cannot use passkeys, it sends the person back to the app",
    (language: string) => {
      const locale: Json = accounts(language);
      const signInPage: Array<string> = sentencesOf(
        valueAt(locale, "login.passkey.unsupported"),
      );
      const handOff: Array<string> = sentencesOf(
        valueAt(locale, "mobilePasskey.unsupported"),
      );
      // How this language's hand-off messages say "Return to the app and".
      const backToTheApp: string = sharedStart(
        sentencesOf(valueAt(locale, "mobilePasskey.insecure"))[1] || "",
        sentencesOf(valueAt(locale, "mobilePasskey.failed"))[1] || "",
      ).trim();

      expect(signInPage).toHaveLength(2);
      expect(backToTheApp.length).toBeGreaterThanOrEqual(4);
      expect({
        language,
        handOff,
        sentences: handOff.length,
        saysTheSameFirstThing: handOff[0] === signInPage[0],
        thenSendsBackToTheApp: (handOff[1] || "").startsWith(backToTheApp),
        namesSso: (handOff[1] || "").includes("SSO"),
        isItsOwnSentence: handOff[1] !== signInPage[1],
      }).toEqual({
        language,
        handOff,
        sentences: 2,
        saysTheSameFirstThing: true,
        thenSendsBackToTheApp: true,
        namesSso: true,
        isItsOwnSentence: true,
      });
    },
  );

  test("the hand-off page reads its own 'not available' sentence, and the sign-in page keeps the other", () => {
    const handOffPage: string = fs.readFileSync(
      path.join(ACCOUNTS_SRC, "Pages", "MobilePasskey.tsx"),
      "utf8",
    );
    const signInPage: string = fs.readFileSync(
      path.join(ACCOUNTS_SRC, "Pages", "Login.tsx"),
      "utf8",
    );

    expect(handOffPage).toContain('t("mobilePasskey.unsupported")');
    expect(handOffPage).not.toContain('"login.passkey.unsupported"');
    expect(signInPage).toContain('"login.passkey.unsupported"');
    expect(valueAt(accounts("en"), "mobilePasskey.unsupported")).toBe(
      "Passkeys aren’t available in this browser. Return to the app and sign in with your password or SSO.",
    );
  });

  test.each(LANGUAGES)(
    "%s: no key of the retired passkey panel is left",
    (language: string) => {
      const passkey: Json = (accounts(language)["login"] as Json)[
        "passkey"
      ] as Json;

      for (const key of RETIRED_KEYS) {
        expect({ language, key, present: key in passkey }).toEqual({
          language,
          key,
          present: false,
        });
      }
    },
  );

  test("every login.passkey key is one a page reads, and every key a page reads exists", () => {
    const used: Set<string> = new Set<string>();

    for (const file of accountsSourceFiles()) {
      const source: string = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(PASSKEY_KEY_IN_SOURCE)) {
        used.add(match[1]!);
      }
    }

    const defined: Array<string> = Object.keys(
      (accounts("en")["login"] as Json)["passkey"] as Json,
    ).sort();

    expect([...used].sort()).toEqual(defined);
    for (const key of RETIRED_KEYS) {
      expect(used.has(key)).toBe(false);
    }
  });

  test("the check above sees a key in a page's source (positive control)", () => {
    const sample: string = `t("login.passkey.signIn") t('login.passkey.ignored') "login.passkey.help"`;

    expect(
      [...sample.matchAll(PASSKEY_KEY_IN_SOURCE)].map(
        (match: RegExpMatchArray) => {
          return match[1];
        },
      ),
    ).toEqual(["signIn", "help"]);
  });
});
