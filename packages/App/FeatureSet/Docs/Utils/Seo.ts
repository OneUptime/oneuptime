import { DEFAULT_DOCS_LANGUAGE, SUPPORTED_DOCS_LANGUAGE_CODES } from "./I18n";

/*
 * What a docs page tells search engines about its address.
 *
 * A page is served under every language's prefix, written in English where
 * it is not translated (Utils/Translations.ts). Left to themselves, search
 * engines indexed the same English page under seventeen addresses. So:
 *
 *   - a page in a language it is written in (English, or a translation) is
 *     its own canonical page;
 *   - a page served in English under another language's prefix names the
 *     English page as canonical;
 *   - a canonical page that is translated lists every language it is written
 *     in as an alternate (hreflang), and English as the default for every
 *     other reader (x-default). One that is not translated lists none, and
 *     neither does a page whose canonical is another: alternates belong on
 *     the canonical page.
 */

export const X_DEFAULT_HREFLANG: string = "x-default";

export interface DocsAlternateLink {
  hreflang: string;
  href: string;
}

export interface DocsPageSeo {
  canonicalUrl: string;
  alternateLinks: Array<DocsAlternateLink>;
}

export interface DocsPageSeoOptions {
  // The origin pages are served from, e.g. https://oneuptime.com.
  origin: string;
  // "category/page".
  pagePath: string;
  // The language the page is served in: the URL's prefix.
  lang: string;
  // The languages the page is written in (DocsTranslations.getLanguages).
  translatedLanguages: Array<string>;
}

// A docs page's full address in a language.
export const getDocsPageUrl: (
  origin: string,
  lang: string,
  pagePath: string,
) => string = (origin: string, lang: string, pagePath: string): string => {
  return `${origin}/docs/${lang}/${pagePath}`;
};

export const getDocsPageSeo: (options: DocsPageSeoOptions) => DocsPageSeo = (
  options: DocsPageSeoOptions,
): DocsPageSeo => {
  const isWrittenInLanguage: boolean = options.translatedLanguages.includes(
    options.lang,
  );
  const canonicalLanguage: string = isWrittenInLanguage
    ? options.lang
    : DEFAULT_DOCS_LANGUAGE;

  const canonicalUrl: string = getDocsPageUrl(
    options.origin,
    canonicalLanguage,
    options.pagePath,
  );

  // In the docs' order, English first; only languages the page is written in.
  const languages: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
    (lang: string): boolean => {
      return options.translatedLanguages.includes(lang);
    },
  );

  if (!isWrittenInLanguage || languages.length < 2) {
    return { canonicalUrl: canonicalUrl, alternateLinks: [] };
  }

  const alternateLinks: Array<DocsAlternateLink> = languages.map(
    (lang: string): DocsAlternateLink => {
      return {
        hreflang: lang,
        href: getDocsPageUrl(options.origin, lang, options.pagePath),
      };
    },
  );

  alternateLinks.push({
    hreflang: X_DEFAULT_HREFLANG,
    href: getDocsPageUrl(
      options.origin,
      DEFAULT_DOCS_LANGUAGE,
      options.pagePath,
    ),
  });

  return { canonicalUrl: canonicalUrl, alternateLinks: alternateLinks };
};
