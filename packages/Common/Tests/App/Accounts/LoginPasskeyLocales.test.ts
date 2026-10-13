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
 *    login.passkey key left is one a page reads.
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
