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

import DocsNav, {
  LocalizedNavGroup,
  LocalizedNavLink,
  NavGroup,
  NavLink,
} from "./Nav";

export interface LocaleStrings {
  ui: { [key: string]: string };
  navGroups: { [key: string]: string };
  navLinks: { [key: string]: string };
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

const lookup: (
  lang: string,
  section: keyof LocaleStrings,
  key: string,
) => string = (
  lang: string,
  section: keyof LocaleStrings,
  key: string,
): string => {
  const langLocale: LocaleStrings | undefined = Locales[lang];
  const enLocale: LocaleStrings = Locales[DEFAULT_DOCS_LANGUAGE]!;

  const fromLang: string | undefined = langLocale?.[section]?.[key];
  if (fromLang) {
    return fromLang;
  }
  const fromEn: string | undefined = enLocale[section]?.[key];
  return fromEn ?? key;
};

/*
 * Build a per-language translation function for the EJS templates.
 * Keys are of the form "ui.foo", "navGroups.Bar", "navLinks.Baz".
 * Unknown sections or missing keys fall back to the English value, then to the
 * key itself.
 */
export const makeT: (lang: string) => TranslateFn = (
  lang: string,
): TranslateFn => {
  const resolvedLang: string = isSupportedDocsLanguage(lang)
    ? lang
    : DEFAULT_DOCS_LANGUAGE;
  return (key: string, vars?: { [k: string]: string }): string => {
    const dot: number = key.indexOf(".");
    if (dot < 0) {
      return key;
    }
    const section: string = key.slice(0, dot);
    const subKey: string = key.slice(dot + 1);
    if (section !== "ui" && section !== "navGroups" && section !== "navLinks") {
      return key;
    }
    return interpolate(
      lookup(resolvedLang, section as keyof LocaleStrings, subKey),
      vars,
    );
  };
};

/*
 * Localize the navigation tree for a given language. URLs are rewritten to
 * include the /docs/:lang/ prefix where appropriate.
 */
export const getLocalizedNav: (lang: string) => LocalizedNavGroup[] = (
  lang: string,
): LocalizedNavGroup[] => {
  const t: TranslateFn = makeT(lang);
  return DocsNav.map((group: NavGroup): LocalizedNavGroup => {
    return {
      title: t(`navGroups.${group.title}`),
      links: group.links.map((link: NavLink): LocalizedNavLink => {
        return {
          title: t(`navLinks.${link.title}`),
          url: localizeDocsUrl(link.url, lang),
        };
      }),
    };
  });
};

/*
 * Rewrite a docs URL so it includes the chosen language prefix. External URLs
 * and non-docs URLs are returned unchanged.
 */
export const localizeDocsUrl: (url: string, lang: string) => string = (
  url: string,
  lang: string,
): string => {
  if (!url.startsWith("/docs/")) {
    return url;
  }
  const resolvedLang: string = isSupportedDocsLanguage(lang)
    ? lang
    : DEFAULT_DOCS_LANGUAGE;
  const rest: string = url.slice("/docs/".length);
  /*
   * If the URL already begins with a known language code, strip it before
   * re-prefixing so we never produce /docs/en/de/...
   */
  const firstSegment: string = rest.split("/")[0] ?? "";
  if (isSupportedDocsLanguage(firstSegment)) {
    const withoutLang: string = rest.slice(firstSegment.length + 1);
    return `/docs/${resolvedLang}/${withoutLang}`;
  }
  return `/docs/${resolvedLang}/${rest}`;
};

export {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGES,
  SUPPORTED_DOCS_LANGUAGE_CODES,
  isSupportedDocsLanguage,
};

export type { DocsLanguage };
