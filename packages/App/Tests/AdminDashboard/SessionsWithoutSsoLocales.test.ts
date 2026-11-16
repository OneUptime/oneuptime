import { SESSIONS_WITHOUT_SSO_COPY } from "../../FeatureSet/AdminDashboard/src/Pages/Settings/SSO/SsoSettingsCopy";
import { ADMIN_DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Require SSO card says about people still signed in without SSO
 * (SessionsWithoutSso, #6116), in the Admin Dashboard's 17 languages: how
 * many there are, the button that signs them out, and the dialog before it
 * does. Each string is a key of every locale file, translated - none left
 * in English - with its {{count}} where the sentence has one, and the
 * count's one form (_one) beside its general form, as the Admin Dashboard's
 * plural lookups read them.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

const COUNT_KEY: string = SESSIONS_WITHOUT_SSO_COPY.stillSignedIn.other;
const COUNT_ONE_KEY: string = `${COUNT_KEY}_one`;

const SENTENCES: Array<string> = [
  SESSIONS_WITHOUT_SSO_COPY.signOutButton,
  SESSIONS_WITHOUT_SSO_COPY.confirmTitle,
  SESSIONS_WITHOUT_SSO_COPY.confirmDescription,
];

const english: Locale = readLocale("en");

describe("the Require SSO card's people signed in without SSO, in every language", () => {
  test("English maps each string to itself, and the count's one form to its own sentence", () => {
    for (const key of [COUNT_KEY, ...SENTENCES]) {
      expect({ key, value: english[key] }).toEqual({ key, value: key });
    }

    expect(english[COUNT_ONE_KEY]).toBe(
      SESSIONS_WITHOUT_SSO_COPY.stillSignedIn.one,
    );
  });

  test("the dialog's sentence fits a dialog, and says master admins stay signed in", () => {
    expect(
      SESSIONS_WITHOUT_SSO_COPY.confirmDescription.length,
    ).toBeLessThanOrEqual(150);
    expect(SESSIONS_WITHOUT_SSO_COPY.confirmDescription).toContain(
      "Master admins stay signed in.",
    );
  });

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s translates every string, keeping the count",
    (locale: string) => {
      const entries: Locale = readLocale(locale);

      for (const key of [COUNT_KEY, COUNT_ONE_KEY, ...SENTENCES]) {
        const value: unknown = entries[key];

        expect({ key, isText: typeof value === "string" }).toEqual({
          key,
          isText: true,
        });
        expect({ key, isEnglish: value === english[key] }).toEqual({
          key,
          isEnglish: false,
        });
      }

      for (const key of [COUNT_KEY, COUNT_ONE_KEY]) {
        expect({
          key,
          keepsCount: String(entries[key]).includes("{{count}}"),
        }).toEqual({ key, keepsCount: true });
      }

      for (const key of SENTENCES) {
        expect(String(entries[key])).not.toContain("{{");
      }
    },
  );
});
