import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import {
  DEFAULT_PAGE_LANGUAGE,
  followLanguageForPage,
  getPageReadingDirection,
  getShownLanguage,
  isPageRightToLeft,
  PageLanguage,
  setPageLanguage,
} from "../../../UI/Utils/PageLanguage";

/*
 * Every frontend's index.ejs wrote <html lang="en">, whatever language the
 * reader picked, and nothing ever set dir="rtl": a Persian page was laid out
 * from the left, and screen readers read every language with English
 * pronunciation. Each translated frontend now hands its i18next instance to
 * followLanguageForPage, which keeps <html lang> and <html dir> on the
 * language the page shows.
 */

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet",
);

const LANGUAGES: Array<string> = ["en", "de", "ja", "fa", "zh-CN"];

const resetRoot: () => void = (): void => {
  document.documentElement.setAttribute("lang", "en");
  document.documentElement.removeAttribute("dir");
};

beforeEach(() => {
  resetRoot();
});

afterEach(() => {
  resetRoot();
});

const startI18n: (language: string) => Promise<i18n> = async (
  language: string,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  followLanguageForPage(instance);

  await instance.init({
    lng: language,
    fallbackLng: "en",
    supportedLngs: LANGUAGES,
    load: "currentOnly",
    resources: Object.fromEntries(
      LANGUAGES.map(
        (code: string): [string, { translation: Record<string, unknown> }] => {
          return [code, { translation: {} }];
        },
      ),
    ),
  });

  return instance;
};

const htmlLanguage: () => { lang: string | null; dir: string | null } = (): {
  lang: string | null;
  dir: string | null;
} => {
  return {
    lang: document.documentElement.getAttribute("lang"),
    dir: document.documentElement.getAttribute("dir"),
  };
};

describe("setPageLanguage", () => {
  test("writes the language and the way it is read on <html>", () => {
    expect(setPageLanguage("fa")).toEqual({ language: "fa", direction: "rtl" });
    expect(htmlLanguage()).toEqual({ lang: "fa", dir: "rtl" });

    expect(setPageLanguage("de")).toEqual({ language: "de", direction: "ltr" });
    expect(htmlLanguage()).toEqual({ lang: "de", dir: "ltr" });
  });

  test("keeps a language's region or script as i18next names it", () => {
    setPageLanguage("zh-CN");
    expect(htmlLanguage()).toEqual({ lang: "zh-CN", dir: "ltr" });

    setPageLanguage(" fa-IR ");
    expect(htmlLanguage()).toEqual({ lang: "fa-IR", dir: "rtl" });
  });

  test.each([undefined, null, "", "   "])(
    "a missing language (%p) is English, left to right",
    (language: string | null | undefined) => {
      document.documentElement.setAttribute("lang", "fa");
      document.documentElement.setAttribute("dir", "rtl");

      const written: PageLanguage = setPageLanguage(language);

      expect(written).toEqual({
        language: DEFAULT_PAGE_LANGUAGE,
        direction: "ltr",
      });
      expect(htmlLanguage()).toEqual({ lang: "en", dir: "ltr" });
    },
  );

  test("writes on the element it is given instead", () => {
    const element: HTMLElement = document.createElement("section");

    setPageLanguage("fa", element);

    expect(element.getAttribute("lang")).toBe("fa");
    expect(element.getAttribute("dir")).toBe("rtl");
    // <html> is left as it was.
    expect(htmlLanguage()).toEqual({ lang: "en", dir: null });
  });

  test("does not write an attribute again when it already says so", async () => {
    setPageLanguage("fa");

    const changed: Array<string> = [];
    const observer: MutationObserver = new MutationObserver(
      (records: Array<MutationRecord>): void => {
        for (const record of records) {
          changed.push(record.attributeName || "");
        }
      },
    );

    observer.observe(document.documentElement, { attributes: true });

    setPageLanguage("fa");
    setPageLanguage("fa");
    // Persian to Hindi: the language changes, the direction does too.
    setPageLanguage("hi");

    await Promise.resolve();
    observer.disconnect();

    expect(changed.sort()).toEqual(["dir", "lang"]);
  });
});

describe("the page follows the language i18next shows", () => {
  test("from the language it starts in", async () => {
    await startI18n("fa");

    expect(htmlLanguage()).toEqual({ lang: "fa", dir: "rtl" });
  });

  test("on every switch, back to English included", async () => {
    const instance: i18n = await startI18n("de");

    expect(htmlLanguage()).toEqual({ lang: "de", dir: "ltr" });

    await instance.changeLanguage("fa");
    expect(htmlLanguage()).toEqual({ lang: "fa", dir: "rtl" });

    await instance.changeLanguage("ja");
    expect(htmlLanguage()).toEqual({ lang: "ja", dir: "ltr" });

    await instance.changeLanguage("fa");
    await instance.changeLanguage("en");
    expect(htmlLanguage()).toEqual({ lang: "en", dir: "ltr" });
  });

  test("an instance set up before it is followed is read at once", async () => {
    const instance: i18n = createInstance();

    await instance.init({
      lng: "fa",
      fallbackLng: "en",
      resources: { en: { translation: {} }, fa: { translation: {} } },
    });

    expect(htmlLanguage()).toEqual({ lang: "en", dir: null });

    followLanguageForPage(instance);

    expect(htmlLanguage()).toEqual({ lang: "fa", dir: "rtl" });
  });

  test("the language it shows, not one it was asked for and does not have", async () => {
    const instance: i18n = await startI18n("de");

    // Klingon is not a language the page has: it shows English.
    await instance.changeLanguage("tlh");

    expect(getShownLanguage(instance)).toBe("en");
    expect(htmlLanguage()).toEqual({ lang: "en", dir: "ltr" });
  });

  test("a region i18next resolves to its language reads that language's way", async () => {
    const instance: i18n = createInstance();

    followLanguageForPage(instance);

    await instance.init({
      lng: "fa-IR",
      fallbackLng: "en",
      supportedLngs: LANGUAGES,
      nonExplicitSupportedLngs: true,
      resources: { en: { translation: {} }, fa: { translation: {} } },
    });

    expect(htmlLanguage().dir).toBe("rtl");
    expect(["fa", "fa-IR"]).toContain(htmlLanguage().lang);
  });
});

describe("which way the page is read, for code that places things itself", () => {
  test("is what <html dir> says", () => {
    expect(getPageReadingDirection()).toBe("ltr");
    expect(isPageRightToLeft()).toBe(false);

    setPageLanguage("fa");

    expect(getPageReadingDirection()).toBe("rtl");
    expect(isPageRightToLeft()).toBe(true);
  });

  test("an element's own direction wins where the browser works it out", () => {
    setPageLanguage("fa");

    const element: HTMLElement = document.createElement("div");
    element.style.direction = "ltr";
    document.body.appendChild(element);

    try {
      expect(getPageReadingDirection(element)).toBe("ltr");
    } finally {
      element.remove();
    }
  });
});

/*
 * The frontends with an i18n set-up that leave <html> as the server drew it,
 * and why. A public dashboard translates only the screens it draws while it
 * moves onto a new version of OneUptime, cannot load or hits an error, in
 * its visitor's browser language (Common/UI/Utils/VisitorLanguage): the
 * dashboard itself is not translated, so the page keeps its language, and
 * each of those screens says its own (PageScreenCard).
 */
const VISITOR_LANGUAGE_FRONTENDS: Array<string> = ["PublicDashboard"];

describe("each translated frontend follows its language on <html>", () => {
  test.each(["Dashboard", "StatusPage", "AdminDashboard", "Accounts"])(
    "%s's i18n set-up hands its instance over",
    (frontend: string) => {
      const source: string = fs.readFileSync(
        path.join(FEATURE_SETS, frontend, "src", "Utils", "i18n.ts"),
        "utf8",
      );

      expect(source).toContain(
        'import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";',
      );
      expect(source).toContain("followLanguageForPage(i18n);");
      // The shared helper, not a copy of its own.
      expect(source).not.toContain("documentElement.lang =");
      expect(source).not.toContain("documentElement.dir =");
    },
  );

  test("every frontend with an i18n set-up is one of them, or says why not", () => {
    const withI18n: Array<string> = fs
      .readdirSync(FEATURE_SETS)
      .filter((folder: string): boolean => {
        return fs.existsSync(
          path.join(FEATURE_SETS, folder, "src", "Utils", "i18n.ts"),
        );
      })
      .sort();

    expect(withI18n).toEqual(
      [
        "Accounts",
        "AdminDashboard",
        "Dashboard",
        "StatusPage",
        ...VISITOR_LANGUAGE_FRONTENDS,
      ].sort(),
    );
  });

  test.each(VISITOR_LANGUAGE_FRONTENDS)(
    "%s's i18n set-up starts its visitor's language, and leaves <html> alone",
    (frontend: string) => {
      const source: string = fs.readFileSync(
        path.join(FEATURE_SETS, frontend, "src", "Utils", "i18n.ts"),
        "utf8",
      );

      expect(source).toContain(
        'import { startVisitorTranslation } from "Common/UI/Utils/VisitorLanguage";',
      );
      expect(source).not.toContain("followLanguageForPage");
      expect(source).not.toContain("documentElement");
    },
  );
});
