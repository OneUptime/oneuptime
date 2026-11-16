import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * MAKING AN ACCOUNT HAS ONE NAME (#9035).
 *
 * The sign-up page's button says "Sign Up", and its way back says "Already
 * have an account? Sign in." The sign-in page and the single sign-on page
 * sent people there with "Don't have an account? Register." - one thing,
 * two words, on the first two pages anyone sees. Nine other languages did
 * the same with their own words: French "Inscription." under a button
 * "S'inscrire", Dutch "Registreren." for "Aanmelden", Japanese 登録 for
 * サインアップ, Korean 등록 for 가입하기, Arabic سجّل الآن for إنشاء حساب.
 *
 * The link now says what the button it leads to says, in every language.
 * Each language's pair is pinned below, beside its button: a change to one
 * fails here until the other follows.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Accounts/src/Locales",
);

interface AccountsWords {
  login: { registerLink: string; noAccountPrompt: string };
  sso: { registerLink: string; noAccountPrompt: string };
  register: {
    submitButton: string;
    loginLink: string;
    checkEmailMessage: string;
  };
}

function wordsOf(code: string): AccountsWords {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as AccountsWords;
}

/*
 * Each language's sign-up button, and the link that leads to it: the same
 * verb, as the language writes it on a button and as an invitation after
 * "Don't have an account?".
 */
const SIGN_UP: Record<string, { button: string; link: string }> = {
  en: { button: "Sign Up", link: "Sign up." },
  de: { button: "Registrieren", link: "Registrieren." },
  fr: { button: "S'inscrire", link: "S'inscrire." },
  es: { button: "Registrarse", link: "Registrarse." },
  it: { button: "Registrati", link: "Registrati." },
  pt: { button: "Cadastrar", link: "Cadastre-se." },
  nl: { button: "Aanmelden", link: "Aanmelden." },
  da: { button: "Tilmeld", link: "Tilmeld dig." },
  no: { button: "Registrer deg", link: "Registrer deg." },
  sv: { button: "Registrera dig", link: "Registrera dig." },
  ru: { button: "Зарегистрироваться", link: "Зарегистрироваться." },
  ja: { button: "サインアップ", link: "サインアップ。" },
  ko: { button: "가입하기", link: "가입하기." },
  "zh-CN": { button: "注册", link: "注册。" },
  "zh-TW": { button: "註冊", link: "註冊。" },
  hi: { button: "साइन अप करें", link: "साइन अप करें।" },
  fa: { button: "ثبت‌نام", link: "ثبت‌نام کنید." },
  ar: { button: "إنشاء حساب", link: "أنشئ حسابًا." },
};

const SENTENCE_ENDS: RegExp = /[.。।]$/;

describe("the link to sign up says what the sign-up button says", () => {
  test("every Accounts language is pinned here", () => {
    const codes: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      })
      .sort();

    expect(codes).toEqual(Object.keys(SIGN_UP).sort());
  });

  test.each(Object.entries(SIGN_UP))(
    "%s: the button and the links of the sign-in and SSO pages",
    (code: string, expected: { button: string; link: string }) => {
      const words: AccountsWords = wordsOf(code);

      expect(words.register.submitButton).toBe(expected.button);
      expect(words.login.registerLink).toBe(expected.link);
      // The single sign-on page says it as the sign-in page does.
      expect(words.sso.registerLink).toBe(words.login.registerLink);
      // A link at the end of a sentence ends it.
      expect(words.login.registerLink).toMatch(SENTENCE_ENDS);
    },
  );

  test("English: the link is the button's words, written as a sentence's", () => {
    const words: AccountsWords = wordsOf("en");

    expect(
      words.login.registerLink.replace(SENTENCE_ENDS, "").toLowerCase(),
    ).toBe(words.register.submitButton.toLowerCase());
    // As the way back, "Sign in.", is the sign-in page's own words.
    expect(words.register.loginLink).toBe("Sign in.");
  });

  test("English never says Register for making an account again", () => {
    const words: AccountsWords = wordsOf("en");

    for (const sentence of [
      words.login.registerLink,
      words.sso.registerLink,
      words.register.checkEmailMessage,
    ]) {
      expect(sentence).not.toMatch(/\bregist(er|ering|ration)\b/i);
    }

    expect(words.register.checkEmailMessage).toBe(
      "If this email address has an account waiting to be set up, we've sent it a link to finish signing up. If you don't see it, check your spam folder.",
    );
  });
});
