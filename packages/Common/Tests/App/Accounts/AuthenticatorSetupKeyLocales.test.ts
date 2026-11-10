import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The words of the authenticator app's setup - its QR code and the setup key
 * under it (issue #6638) - in every language of the sign-in pages, and of the
 * Dashboard, which draws the same component (AuthenticatorAppSetupCode).
 *
 * The sign-in pages are where someone whose administrator requires
 * two-factor authentication sets it up, most often in their own language (the
 * issue was reported from a German one). So on them the words are translated
 * through, in the words the rest of that screen uses: the QR code is called
 * what the scan instruction above it calls it, and the authenticator app what
 * the code field below it calls it. The copy button says what it says in the
 * Dashboard.
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
const ACCOUNTS_LOCALES: string = path.join(
  FEATURE_SETS,
  "Accounts",
  "src",
  "Locales",
);
const DASHBOARD_LOCALES: string = path.join(
  FEATURE_SETS,
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = [
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

const QR_CODE: string = "QR code";
const QR_FAILED: string = "The QR code could not be shown.";
const CANT_SCAN: string = "Can't scan the QR code?";
const ENTER_KEY: string =
  "Enter this setup key in your authenticator app instead.";
const TIME_BASED: string = "If your app asks, choose a time-based key.";

// What the setup component and the QR code say.
const SETUP_KEYS: Array<string> = [
  QR_CODE,
  QR_FAILED,
  CANT_SCAN,
  ENTER_KEY,
  TIME_BASED,
];

// What the copy button beside the key says.
const COPY_KEYS: Array<string> = ["Copy", "Copied!", "Copy failed"];

/*
 * The authenticator app, as each language's code field names it - its stem
 * where the setup key's sentence inflects it ("в приложении-аутентификаторе",
 * the Russian prepositional).
 */
const AUTHENTICATOR_APP: Record<string, string> = {
  de: "Authenticator-App",
  fr: "application d'authentification",
  es: "aplicación de autenticación",
  it: "app di autenticazione",
  pt: "aplicação de autenticação",
  nl: "authenticator-app",
  da: "godkendelsesapp",
  no: "autentiseringsapp",
  sv: "autentiseringsapp",
  ru: "приложени",
  ja: "認証アプリ",
  ko: "인증 앱",
  "zh-CN": "身份验证器应用",
  "zh-TW": "驗證器應用程式",
  hi: "प्रमाणक ऐप",
  fa: "اپلیکیشن احراز هویت",
  ar: "تطبيق المصادقة",
};

// A sentence's end in each script, and a question's.
const SENTENCE_END: RegExp = /[.。।]$/;
const QUESTION_END: RegExp = /[?？؟]$/;
const PLACEHOLDER: RegExp = /\{\{|\}\}/;
// ٠-٩ and the Persian ۰-۹: OneUptime writes Latin digits in every language.
const NON_LATIN_DIGIT: RegExp = /[٠-٩۰-۹]/;

type LocaleTree = { [key: string]: string | LocaleTree };

const readLocale: (directory: string, language: string) => LocaleTree = (
  directory: string,
  language: string,
): LocaleTree => {
  return JSON.parse(
    fs.readFileSync(path.join(directory, `${language}.json`), "utf8"),
  ) as LocaleTree;
};

const wordsOf: (tree: LocaleTree, key: string) => string = (
  tree: LocaleTree,
  key: string,
): string => {
  const value: string | LocaleTree | undefined = tree[key];

  return typeof value === "string" ? value : "";
};

const enrolmentWordOf: (
  tree: LocaleTree,
  key: "scanInstruction" | "codeFieldDescription",
) => string = (
  tree: LocaleTree,
  key: "scanInstruction" | "codeFieldDescription",
): string => {
  const login: LocaleTree = tree["login"] as LocaleTree;
  const enrolment: LocaleTree = login["twoFactorEnrolment"] as LocaleTree;

  return enrolment[key] as string;
};

const english: LocaleTree = readLocale(ACCOUNTS_LOCALES, "en");

describe("the setup key's words on the sign-in pages", () => {
  test("are English's own in en.json, the language every other falls back to", () => {
    for (const key of [...SETUP_KEYS, ...COPY_KEYS]) {
      expect({ key, english: wordsOf(english, key) }).toEqual({
        key,
        english: key,
      });
    }
  });

  test.each(LANGUAGES)("are each translated in %s", (language: string) => {
    const locale: LocaleTree = readLocale(ACCOUNTS_LOCALES, language);

    for (const key of [...SETUP_KEYS, ...COPY_KEYS]) {
      const translated: string = wordsOf(locale, key);

      expect({
        key,
        isTranslated: translated !== "" && translated !== key,
      }).toEqual({ key, isTranslated: true });
      expect(translated).not.toMatch(PLACEHOLDER);
      expect(translated.trim()).toBe(translated);
      expect(translated).not.toMatch(NON_LATIN_DIGIT);
    }
  });

  test.each(LANGUAGES)(
    "end as sentences and questions end in %s",
    (language: string) => {
      const locale: LocaleTree = readLocale(ACCOUNTS_LOCALES, language);

      for (const key of [QR_FAILED, ENTER_KEY, TIME_BASED]) {
        expect({ key, words: wordsOf(locale, key) }).toEqual({
          key,
          words: expect.stringMatching(SENTENCE_END),
        });
      }

      /*
       * Japanese asks it as "when the QR code cannot be scanned", as its
       * apps do: a phrase, not a question.
       */
      if (language !== "ja") {
        expect(wordsOf(locale, CANT_SCAN)).toMatch(QUESTION_END);
      }
    },
  );

  test.each(LANGUAGES)(
    "call the QR code what the scan instruction above it calls it, in %s",
    (language: string) => {
      const locale: LocaleTree = readLocale(ACCOUNTS_LOCALES, language);
      const qrCode: string = wordsOf(locale, QR_CODE).toLowerCase();

      expect(
        enrolmentWordOf(locale, "scanInstruction").toLowerCase(),
      ).toContain(qrCode);

      for (const key of [QR_FAILED, CANT_SCAN]) {
        expect({ key, words: wordsOf(locale, key).toLowerCase() }).toEqual({
          key,
          words: expect.stringContaining(qrCode),
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "call the authenticator app what the code field calls it, in %s",
    (language: string) => {
      const locale: LocaleTree = readLocale(ACCOUNTS_LOCALES, language);
      const app: string = AUTHENTICATOR_APP[language] as string;

      expect(enrolmentWordOf(locale, "codeFieldDescription")).toContain(app);
      expect(wordsOf(locale, ENTER_KEY)).toContain(app);
    },
  );

  test.each(LANGUAGES)(
    "say Copy, Copied! and Copy failed as the Dashboard does, in %s",
    (language: string) => {
      const accounts: LocaleTree = readLocale(ACCOUNTS_LOCALES, language);
      const dashboard: LocaleTree = readLocale(DASHBOARD_LOCALES, language);

      for (const key of COPY_KEYS) {
        expect({ key, words: wordsOf(accounts, key) }).toEqual({
          key,
          words: wordsOf(dashboard, key),
        });
      }
    },
  );
});

describe("the setup key's words in the Dashboard", () => {
  const dashboardEnglish: LocaleTree = readLocale(DASHBOARD_LOCALES, "en");

  test("are in en.json, where the string extractor put them", () => {
    for (const key of SETUP_KEYS) {
      expect({ key, english: wordsOf(dashboardEnglish, key) }).toEqual({
        key,
        english: key,
      });
    }
  });

  test.each(LANGUAGES)("are each translated in %s", (language: string) => {
    const locale: LocaleTree = readLocale(DASHBOARD_LOCALES, language);

    for (const key of SETUP_KEYS) {
      const translated: string = wordsOf(locale, key);

      expect({
        key,
        isTranslated: translated !== "" && translated !== key,
      }).toEqual({ key, isTranslated: true });
    }
  });

  test.each(LANGUAGES)(
    "call the QR code what the sign-in pages call it, in %s",
    (language: string) => {
      expect(wordsOf(readLocale(DASHBOARD_LOCALES, language), QR_CODE)).toBe(
        wordsOf(readLocale(ACCOUNTS_LOCALES, language), QR_CODE),
      );
    },
  );
});
