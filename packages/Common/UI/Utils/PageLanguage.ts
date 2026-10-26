import type { i18n as I18nInstance } from "i18next";
import {
  getReadingDirection,
  LEFT_TO_RIGHT,
  ReadingDirection,
  RIGHT_TO_LEFT,
} from "../../Types/ReadingDirection";

/*
 * THE PAGE SAYS WHICH LANGUAGE IT IS IN, AND WHICH WAY IT IS READ.
 *
 * Every frontend's index.ejs writes <html lang="en">, whatever language the
 * reader picked: a screen reader read a German page with English
 * pronunciation, the browser offered to translate it from English, and a
 * Persian page was laid out from the left - its rows, menus and dialogs the
 * wrong way round, and every right-to-left fix in a component waiting for a
 * dir="rtl" that never came.
 *
 * Each frontend hands its i18next instance to followLanguageForPage once, at
 * start-up (beside followLanguageForDates), and <html> then carries the
 * reader's language and its direction - set as soon as i18next has resolved
 * it, before the first page is drawn, and again on every switch. Persian
 * reads right to left (Types/ReadingDirection); with Tailwind's left and
 * right meaning start and end (Styles/TailwindReadingDirection.js), the
 * whole layout mirrors.
 */

export interface PageLanguage {
  language: string;
  direction: ReadingDirection;
}

export const DEFAULT_PAGE_LANGUAGE: string = "en";

const getRootElement: () => HTMLElement | null = (): HTMLElement | null => {
  if (typeof document === "undefined" || !document.documentElement) {
    return null;
  }

  return document.documentElement;
};

/*
 * Writes `language` and its direction on <html> (or on `element`), and
 * returns them. A missing language is English. Unchanged attributes are not
 * written again, so nothing that observes them hears of a change that is
 * not one.
 */
export const setPageLanguage: (
  language: string | null | undefined,
  element?: HTMLElement | null | undefined,
) => PageLanguage = (
  language: string | null | undefined,
  element?: HTMLElement | null | undefined,
): PageLanguage => {
  const pageLanguage: string =
    (language || "").trim() || DEFAULT_PAGE_LANGUAGE;
  const direction: ReadingDirection = getReadingDirection(pageLanguage);
  const root: HTMLElement | null = element || getRootElement();

  if (root) {
    if (root.getAttribute("lang") !== pageLanguage) {
      root.setAttribute("lang", pageLanguage);
    }

    if (root.getAttribute("dir") !== direction) {
      root.setAttribute("dir", direction);
    }
  }

  return { language: pageLanguage, direction: direction };
};

/*
 * The language an i18next instance shows its words in right now: the one
 * it resolved, else the first it looks words up in - English for a
 * language it does not have, never the code it was asked for.
 */
export const getShownLanguage: (
  instance: I18nInstance,
  changedTo?: string | undefined,
) => string = (instance: I18nInstance, changedTo?: string): string => {
  return (
    instance.resolvedLanguage ||
    instance.languages?.[0] ||
    changedTo ||
    instance.language ||
    DEFAULT_PAGE_LANGUAGE
  );
};

/*
 * Keeps <html lang> and <html dir> on the language `instance` shows: now if
 * it is ready, when it is otherwise, and on every switch.
 */
export const followLanguageForPage: (
  instance: I18nInstance,
  element?: HTMLElement | null | undefined,
) => void = (
  instance: I18nInstance,
  element?: HTMLElement | null | undefined,
): void => {
  const follow: (changedTo?: string | undefined) => void = (
    changedTo?: string | undefined,
  ): void => {
    setPageLanguage(getShownLanguage(instance, changedTo), element);
  };

  instance.on("languageChanged", (language: string): void => {
    follow(language);
  });

  if (instance.isInitialized) {
    follow();
  } else {
    instance.on("initialized", (): void => {
      follow();
    });
  }
};

/*
 * Which way the page is read: what <html dir> says (an element's own
 * direction, when given one, as the browser works it out). For the few
 * places that place things from code - a scroll position, a menu worked
 * out in pixels.
 */
export const getPageReadingDirection: (
  element?: Element | null | undefined,
) => ReadingDirection = (
  element?: Element | null | undefined,
): ReadingDirection => {
  if (element && typeof window !== "undefined" && window.getComputedStyle) {
    const computed: string = window.getComputedStyle(element).direction;

    if (computed === RIGHT_TO_LEFT || computed === LEFT_TO_RIGHT) {
      return computed;
    }
  }

  const root: HTMLElement | null = getRootElement();

  return root && root.getAttribute("dir") === RIGHT_TO_LEFT
    ? RIGHT_TO_LEFT
    : LEFT_TO_RIGHT;
};

export const isPageRightToLeft: (
  element?: Element | null | undefined,
) => boolean = (element?: Element | null | undefined): boolean => {
  return getPageReadingDirection(element) === RIGHT_TO_LEFT;
};
