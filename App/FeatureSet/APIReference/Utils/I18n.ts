import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGES,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  DocsLanguage,
  isSupportedDocsLanguage,
} from "Common/Types/Docs/DocsLanguage";

import en from "../Locales/en.json";
import de from "../Locales/de.json";
import fr from "../Locales/fr.json";
import es from "../Locales/es.json";
import it from "../Locales/it.json";
import pt from "../Locales/pt.json";
import nl from "../Locales/nl.json";
import da from "../Locales/da.json";
import no from "../Locales/no.json";
import sv from "../Locales/sv.json";
import ru from "../Locales/ru.json";
import ja from "../Locales/ja.json";
import ko from "../Locales/ko.json";
import zh from "../Locales/zh.json";
import hi from "../Locales/hi.json";

export interface LocaleStrings {
  ui: { [key: string]: string };
  pages: { [key: string]: { [key: string]: string } };
}

const Locales: { [code: string]: LocaleStrings } = {
  en: en as LocaleStrings,
  de: de as LocaleStrings,
  fr: fr as LocaleStrings,
  es: es as LocaleStrings,
  it: it as LocaleStrings,
  pt: pt as LocaleStrings,
  nl: nl as LocaleStrings,
  da: da as LocaleStrings,
  no: no as LocaleStrings,
  sv: sv as LocaleStrings,
  ru: ru as LocaleStrings,
  ja: ja as LocaleStrings,
  ko: ko as LocaleStrings,
  zh: zh as LocaleStrings,
  hi: hi as LocaleStrings,
};

export type TranslateFn = (
  key: string,
  vars?: { [k: string]: string },
) => string;

const interpolate: (text: string, vars?: { [k: string]: string }) => string = (
  text: string,
  vars?: { [k: string]: string },
): string => {
  if (!vars) {
    return text;
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) => {
    const value: string | undefined = vars[name];
    return value === undefined ? `{{${name}}}` : value;
  });
};

const lookupNested: (
  source: { [key: string]: unknown } | undefined,
  path: Array<string>,
) => string | undefined = (
  source: { [key: string]: unknown } | undefined,
  path: Array<string>,
): string | undefined => {
  if (!source) {
    return undefined;
  }
  let cursor: unknown = source;
  for (const segment of path) {
    if (
      cursor &&
      typeof cursor === "object" &&
      segment in (cursor as { [key: string]: unknown })
    ) {
      cursor = (cursor as { [key: string]: unknown })[segment];
    } else {
      return undefined;
    }
  }
  return typeof cursor === "string" ? cursor : undefined;
};

/*
 * Build a per-language translation function for the EJS templates.
 * Keys are dot-paths like "ui.foo" or "pages.introduction.title".
 * Missing keys fall back to the English value, then to the key itself.
 */
export const makeT: (lang: string) => TranslateFn = (
  lang: string,
): TranslateFn => {
  const resolvedLang: string = isSupportedDocsLanguage(lang)
    ? lang
    : DEFAULT_DOCS_LANGUAGE;
  return (key: string, vars?: { [k: string]: string }): string => {
    const path: Array<string> = key.split(".");
    if (path.length < 2) {
      return key;
    }
    const langLocale: LocaleStrings | undefined = Locales[resolvedLang];
    const enLocale: LocaleStrings = Locales[DEFAULT_DOCS_LANGUAGE]!;

    const fromLang: string | undefined = lookupNested(
      langLocale as unknown as { [key: string]: unknown } | undefined,
      path,
    );
    if (fromLang !== undefined) {
      return interpolate(fromLang, vars);
    }
    const fromEn: string | undefined = lookupNested(
      enLocale as unknown as { [key: string]: unknown },
      path,
    );
    if (fromEn !== undefined) {
      return interpolate(fromEn, vars);
    }
    return key;
  };
};

/*
 * Rewrite a /reference URL so it includes the chosen language prefix.
 * External URLs and non-reference URLs are returned unchanged.
 */
export const localizeReferenceUrl: (url: string, lang: string) => string = (
  url: string,
  lang: string,
): string => {
  if (!url.startsWith("/reference")) {
    return url;
  }
  const resolvedLang: string = isSupportedDocsLanguage(lang)
    ? lang
    : DEFAULT_DOCS_LANGUAGE;

  const rest: string = url.slice("/reference".length);
  // /reference -> /reference/<lang>
  if (rest === "" || rest === "/") {
    return `/reference/${resolvedLang}`;
  }

  const trimmed: string = rest.startsWith("/") ? rest.slice(1) : rest;
  const segments: Array<string> = trimmed.split("/");
  const firstSegment: string = segments[0] ?? "";

  // If the URL already has a language code, strip and re-prefix.
  if (isSupportedDocsLanguage(firstSegment)) {
    const remainder: string = segments.slice(1).join("/");
    return remainder
      ? `/reference/${resolvedLang}/${remainder}`
      : `/reference/${resolvedLang}`;
  }

  return `/reference/${resolvedLang}/${trimmed}`;
};

export {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGES,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  isSupportedDocsLanguage,
};

export type { DocsLanguage };
