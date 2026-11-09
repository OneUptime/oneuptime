import {
  AccountsLanguage,
  DEFAULT_ACCOUNTS_LANGUAGE,
  SUPPORTED_ACCOUNTS_LANGUAGES,
} from "../../Types/Accounts/AccountsLanguage";
import {
  AdminDashboardLanguage,
  DEFAULT_ADMIN_DASHBOARD_LANGUAGE,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGES,
} from "../../Types/AdminDashboard/AdminDashboardLanguage";
import {
  DashboardLanguage,
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGES,
} from "../../Types/Dashboard/DashboardLanguage";
import {
  DEFAULT_DOCS_LANGUAGE,
  DocsLanguage,
  SUPPORTED_DOCS_LANGUAGES,
} from "../../Types/Docs/DocsLanguage";
import {
  DEFAULT_STATUS_PAGE_LANGUAGE,
  StatusPageLanguage,
  SUPPORTED_STATUS_PAGE_LANGUAGES,
} from "../../Types/StatusPage/StatusPageLanguage";
import { describe, expect, test } from "@jest/globals";

/*
 * The five registries below are separate arrays that every localized surface
 * reads from: the Dashboard, the Admin Dashboard, Accounts, the Status Page,
 * and Docs (which the API Reference shares). Nothing in the type system ties
 * them together, so a language added to one of them and forgotten in the other
 * four ships a language switcher that offers Persian on the status page and
 * nothing anywhere else - which is exactly how Farsi first landed.
 *
 * These assertions are deliberately whole-array comparisons rather than a
 * membership check for one code: they fail for any language added to a subset
 * of surfaces, not just the one that prompted them.
 *
 * Docs is the one registry allowed to lag: its pages are written per
 * language, so a language the product speaks before its docs are written is
 * listed in DOCS_NOT_WRITTEN_YET, and Docs must equal the product's list
 * without exactly those. A language the docs drop, or one they add before
 * the product does, still fails.
 */

type LanguageEntry =
  | AccountsLanguage
  | AdminDashboardLanguage
  | DashboardLanguage
  | DocsLanguage
  | StatusPageLanguage;

/*
 * What every registry has to agree on. Docs also records which way each
 * language is written, for its right-to-left pages, and the others do not.
 */
type LanguageIdentity = Pick<
  LanguageEntry,
  "code" | "nativeName" | "englishName"
>;

const identityOf: (language: LanguageEntry) => LanguageIdentity = (
  language: LanguageEntry,
): LanguageIdentity => {
  return {
    code: language.code,
    nativeName: language.nativeName,
    englishName: language.englishName,
  };
};

/*
 * Languages the product speaks whose docs pages are not written yet. Arabic
 * reached the product first (#6408); its docs pages are a follow-up, and this
 * list shrinks when they land.
 */
const DOCS_NOT_WRITTEN_YET: Array<string> = ["ar"];

const PRODUCT_REGISTRIES: Array<[string, Array<LanguageEntry>]> = [
  ["Accounts", SUPPORTED_ACCOUNTS_LANGUAGES],
  ["AdminDashboard", SUPPORTED_ADMIN_DASHBOARD_LANGUAGES],
  ["Dashboard", SUPPORTED_DASHBOARD_LANGUAGES],
  ["StatusPage", SUPPORTED_STATUS_PAGE_LANGUAGES],
];

const REGISTRIES: Array<[string, Array<LanguageEntry>]> = [
  ...PRODUCT_REGISTRIES,
  ["Docs", SUPPORTED_DOCS_LANGUAGES],
];

const DEFAULTS: Array<[string, string]> = [
  ["Accounts", DEFAULT_ACCOUNTS_LANGUAGE],
  ["AdminDashboard", DEFAULT_ADMIN_DASHBOARD_LANGUAGE],
  ["Dashboard", DEFAULT_DASHBOARD_LANGUAGE],
  ["Docs", DEFAULT_DOCS_LANGUAGE],
  ["StatusPage", DEFAULT_STATUS_PAGE_LANGUAGE],
];

describe("supported language registries", () => {
  test.each(PRODUCT_REGISTRIES)(
    "%s offers the same languages, in the same order, as the Status Page",
    (_name: string, languages: Array<LanguageEntry>) => {
      expect(languages.map(identityOf)).toEqual(
        SUPPORTED_STATUS_PAGE_LANGUAGES.map(identityOf),
      );
    },
  );

  test("Docs offers the product's languages, in the same order, but the ones its pages are not written in yet", () => {
    expect(SUPPORTED_DOCS_LANGUAGES.map(identityOf)).toEqual(
      SUPPORTED_STATUS_PAGE_LANGUAGES.map(identityOf).filter(
        (language: LanguageIdentity) => {
          return !DOCS_NOT_WRITTEN_YET.includes(language.code);
        },
      ),
    );
  });

  test("every language listed as not written in the docs yet is one the product speaks", () => {
    const productCodes: Array<string> = SUPPORTED_STATUS_PAGE_LANGUAGES.map(
      (language: StatusPageLanguage) => {
        return language.code;
      },
    );

    for (const code of DOCS_NOT_WRITTEN_YET) {
      expect(productCodes).toContain(code);
    }
  });

  test.each(DEFAULTS)(
    "%s falls back to English",
    (_name: string, defaultLanguage: string) => {
      expect(defaultLanguage).toBe("en");
    },
  );

  test.each(REGISTRIES)(
    "%s has a unique, non-blank code for every language",
    (_name: string, languages: Array<LanguageEntry>) => {
      const codes: Array<string> = languages.map((language: LanguageEntry) => {
        return language.code;
      });

      for (const code of codes) {
        expect(code.trim().length).toBeGreaterThan(0);
      }

      expect(new Set<string>(codes).size).toBe(codes.length);
    },
  );

  test.each(REGISTRIES)(
    "%s names every language in English and in the language itself",
    (_name: string, languages: Array<LanguageEntry>) => {
      for (const language of languages) {
        expect(language.englishName.trim().length).toBeGreaterThan(0);
        expect(language.nativeName.trim().length).toBeGreaterThan(0);
      }
    },
  );

  test("English is the first language every switcher offers", () => {
    for (const [, languages] of REGISTRIES) {
      expect(languages[0]?.code).toBe("en");
    }
  });

  test("Persian is registered on every surface, not just the Status Page", () => {
    for (const [, languages] of REGISTRIES) {
      expect(languages.map(identityOf)).toContainEqual({
        code: "fa",
        nativeName: "فارسی",
        englishName: "Persian",
      });
    }
  });

  test("Arabic is registered on every product surface, named in Arabic, right after Persian", () => {
    for (const [, languages] of PRODUCT_REGISTRIES) {
      const codes: Array<string> = languages.map((language: LanguageEntry) => {
        return language.code;
      });

      expect(languages.map(identityOf)).toContainEqual({
        code: "ar",
        nativeName: "العربية",
        englishName: "Arabic",
      });
      expect(codes.indexOf("ar")).toBe(codes.indexOf("fa") + 1);
    }
  });

  test("the docs do not offer Arabic until its pages are written", () => {
    expect(
      SUPPORTED_DOCS_LANGUAGES.map((language: DocsLanguage) => {
        return language.code;
      }),
    ).not.toContain("ar");
  });
});
