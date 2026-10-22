import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/APIReference/Utils/I18n";
import {
  ReferenceAlternateLink,
  ReferencePageSeo,
  TRANSLATED_REFERENCE_PAGES,
  X_DEFAULT_HREFLANG,
  getReferencePageSeo,
} from "../../../FeatureSet/APIReference/Utils/Seo";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What an API Reference page tells search engines about its address
 * (Utils/Seo.ts): a guide written in every language is its own canonical page
 * in each and lists them all; a page written from English descriptions names
 * the English page in every language.
 */

const ORIGIN: string = "https://oneuptime.com";

const LOCALES_FOLDER: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "APIReference",
  "Locales",
);

// Each translated guide's section in the locale files.
const LOCALE_SECTION_OF_PAGE: Record<string, string> = {
  introduction: "introduction",
  authentication: "authentication",
  pagination: "pagination",
  errors: "errors",
  openapi: "openapi",
  "data-types": "dataTypesGuide",
  "master-admin-apis": "masterAdminApis",
};

interface LocaleFile {
  pages: Record<string, Record<string, string>>;
}

const readLocale: (lang: string) => LocaleFile = (lang: string): LocaleFile => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_FOLDER, `${lang}.json`), "utf8"),
  ) as LocaleFile;
};

const everyLanguageOf: (page: string) => Array<ReferenceAlternateLink> = (
  page: string,
): Array<ReferenceAlternateLink> => {
  return [
    ...SUPPORTED_DOCS_LANGUAGE_CODES.map(
      (lang: string): ReferenceAlternateLink => {
        return { hreflang: lang, href: `${ORIGIN}/reference/${lang}/${page}` };
      },
    ),
    { hreflang: X_DEFAULT_HREFLANG, href: `${ORIGIN}/reference/en/${page}` },
  ];
};

describe("a guide written in every language", () => {
  it("is its own canonical page in English, and lists every language", () => {
    expect(
      getReferencePageSeo({
        origin: ORIGIN,
        page: "authentication",
        lang: "en",
      }),
    ).toEqual({
      canonicalUrl: `${ORIGIN}/reference/en/authentication`,
      alternateLinks: everyLanguageOf("authentication"),
    });
  });

  it("is its own canonical page in every other language, with the same list", () => {
    for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const seo: ReferencePageSeo = getReferencePageSeo({
        origin: ORIGIN,
        page: "introduction",
        lang: lang,
      });

      expect({ lang, seo }).toEqual({
        lang,
        seo: {
          canonicalUrl: `${ORIGIN}/reference/${lang}/introduction`,
          alternateLinks: everyLanguageOf("introduction"),
        },
      });
    }
  });

  it("lists English first and as the default, once each", () => {
    const seo: ReferencePageSeo = getReferencePageSeo({
      origin: ORIGIN,
      page: "errors",
      lang: "ja",
    });

    expect(seo.alternateLinks[0]).toEqual({
      hreflang: DEFAULT_DOCS_LANGUAGE,
      href: `${ORIGIN}/reference/en/errors`,
    });
    expect(
      seo.alternateLinks.filter((link: ReferenceAlternateLink): boolean => {
        return link.hreflang === X_DEFAULT_HREFLANG;
      }),
    ).toEqual([
      { hreflang: X_DEFAULT_HREFLANG, href: `${ORIGIN}/reference/en/errors` },
    ]);
    expect(seo.alternateLinks).toHaveLength(
      SUPPORTED_DOCS_LANGUAGE_CODES.length + 1,
    );
  });

  it("is written in every language: no sentence of it is left in English", () => {
    const english: LocaleFile = readLocale(DEFAULT_DOCS_LANGUAGE);
    const untranslated: Array<string> = [];

    for (const page of TRANSLATED_REFERENCE_PAGES) {
      const section: string = LOCALE_SECTION_OF_PAGE[page] || "";
      const englishStrings: Record<string, string> =
        english.pages[section] || {};

      // A guide with no section in the locale files is not written from them.
      expect({ page, written: Object.keys(englishStrings).length > 0 }).toEqual(
        { page, written: true },
      );

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        if (lang === DEFAULT_DOCS_LANGUAGE) {
          continue;
        }

        const strings: Record<string, string> =
          readLocale(lang).pages[section] || {};

        for (const [key, value] of Object.entries(englishStrings)) {
          // Short strings - a name, a code - may well be the same in two languages.
          if (value.length > 40 && strings[key] === value) {
            untranslated.push(`${lang}: pages.${section}.${key}`);
          }
        }
      }
    }

    expect(untranslated).toEqual([]);
  });
});

describe("a page written from English descriptions", () => {
  it.each(["monitor", "status-page", "equal-to", "object-id", "permissions"])(
    "names the English %s page in every language, and lists no alternates",
    (page: string) => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({
          lang,
          seo: getReferencePageSeo({ origin: ORIGIN, page: page, lang: lang }),
        }).toEqual({
          lang,
          seo: {
            canonicalUrl: `${ORIGIN}/reference/en/${page}`,
            alternateLinks: [],
          },
        });
      }
    },
  );
});

describe("a language the reference does not offer", () => {
  it("names the English page", () => {
    expect(
      getReferencePageSeo({ origin: ORIGIN, page: "errors", lang: "xx" })
        .canonicalUrl,
    ).toBe(`${ORIGIN}/reference/en/errors`);
  });
});
