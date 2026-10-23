import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  isSupportedDocsLanguage,
} from "./I18n";

/*
 * What an API Reference page tells search engines about its address.
 *
 * Every page is served under each language's prefix (/reference/<lang>/<page>),
 * and no page named a canonical address. Search engines kept the old address
 * without a language instead, which redirected only temporarily: Google
 * Search Console listed the /reference/en pages as "Duplicate without
 * user-selected canonical", with /reference/<page> chosen in their place.
 * So:
 *
 *   - a guide whose text is the locale files' (TRANSLATED_REFERENCE_PAGES) is
 *     written in every language, and is its own canonical page in each. It
 *     lists every language as an alternate (hreflang), and English as the
 *     default for every other reader (x-default);
 *   - every other page - a resource, a data type, the permissions - is
 *     written from the models', data types' and permissions' own
 *     descriptions, which are English: only the headings and labels around
 *     them are translated. In any language it names the English page as
 *     canonical, and lists no alternates: alternates belong on the canonical
 *     page, and it has no translations to list.
 */

export const X_DEFAULT_HREFLANG: string = "x-default";

export interface ReferenceAlternateLink {
  hreflang: string;
  href: string;
}

export interface ReferencePageSeo {
  canonicalUrl: string;
  alternateLinks: Array<ReferenceAlternateLink>;
}

export interface ReferencePageSeoOptions {
  // The origin pages are served from, e.g. https://oneuptime.com.
  origin: string;
  // The last segment of the page's address, e.g. "introduction" or "monitor".
  page: string;
  // The language the page is served in: the URL's prefix.
  lang: string;
}

/*
 * The guides whose text is the locale files' (Locales/*.json), which hold
 * every string in every language the reference is offered in.
 */
export const TRANSLATED_REFERENCE_PAGES: ReadonlyArray<string> = [
  "introduction",
  "authentication",
  "pagination",
  "errors",
  "openapi",
  "data-types",
  "master-admin-apis",
];

// A reference page's full address in a language.
export const getLocalizedReferencePageUrl: (
  origin: string,
  lang: string,
  page: string,
) => string = (origin: string, lang: string, page: string): string => {
  return `${origin}/reference/${lang}/${page}`;
};

export const getReferencePageSeo: (
  options: ReferencePageSeoOptions,
) => ReferencePageSeo = (
  options: ReferencePageSeoOptions,
): ReferencePageSeo => {
  const isTranslated: boolean = TRANSLATED_REFERENCE_PAGES.includes(
    options.page,
  );
  const canonicalLanguage: string =
    isTranslated && isSupportedDocsLanguage(options.lang)
      ? options.lang
      : DEFAULT_DOCS_LANGUAGE;

  const canonicalUrl: string = getLocalizedReferencePageUrl(
    options.origin,
    canonicalLanguage,
    options.page,
  );

  if (!isTranslated) {
    return { canonicalUrl: canonicalUrl, alternateLinks: [] };
  }

  const alternateLinks: Array<ReferenceAlternateLink> =
    SUPPORTED_DOCS_LANGUAGE_CODES.map(
      (lang: string): ReferenceAlternateLink => {
        return {
          hreflang: lang,
          href: getLocalizedReferencePageUrl(
            options.origin,
            lang,
            options.page,
          ),
        };
      },
    );

  alternateLinks.push({
    hreflang: X_DEFAULT_HREFLANG,
    href: getLocalizedReferencePageUrl(
      options.origin,
      DEFAULT_DOCS_LANGUAGE,
      options.page,
    ),
  });

  return { canonicalUrl: canonicalUrl, alternateLinks: alternateLinks };
};
