import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import DashboardDescription from "../../../../App/FeatureSet/PublicDashboard/src/Components/DashboardDescription";
import {
  DESCRIPTION_COPY,
  DESCRIPTION_TEST_ID,
  DESCRIPTION_TOGGLE_TEST_ID,
  ERROR_PAGE_DESCRIPTION_TEST_ID,
  ERROR_PAGE_NEXT_STEP_TEST_ID,
  ERROR_PAGE_TITLE_TEST_ID,
  ERROR_PAGE_TRY_AGAIN_TEST_ID,
  FORBIDDEN_COPY,
  NOT_FOUND_COPY,
} from "../../../../App/FeatureSet/PublicDashboard/src/Components/PublicDashboardCopy";
import ForbiddenPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/Forbidden/Forbidden";
import NotFoundPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/NotFound/NotFound";
import PublicDashboardUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/PublicDashboard";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";

/*
 * A public dashboard's error pages, and its description (#9132).
 *
 * "Dashboard Not Found" and "Access Denied … Your IP address may be
 * restricted." were written in English into the pages, so a German or a
 * Persian visitor read them in English, and neither said what to do next:
 * no one to ask, nothing to press. They are keys of the public dashboard's
 * locales now, and each page ends in a way forward - the person who shared
 * the link, the dashboard's owner, and on Access Denied, Try again.
 *
 * And the header cut the dashboard's description to one line, so a phone,
 * with no pointer to hover, had no way to read the rest. It is two lines,
 * with Show more when it holds more, and the whole of it once opened.
 */

type Words = Record<string, string>;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "PublicDashboard",
  "src",
  "Locales",
);

const PAGES_DIR: string = path.resolve(LOCALES_DIR, "..", "Pages");

const LANGUAGES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
  "ar",
];

const WORDS: Array<string> = [
  ...Object.values(NOT_FOUND_COPY),
  ...Object.values(FORBIDDEN_COPY),
  ...Object.values(DESCRIPTION_COPY),
];

const DASHBOARD_ID: string = "ab000000-0000-4000-8000-0000000000d4";

const readLocale: (language: string) => Words = (language: string): Words => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Words;
};

// An i18next instance set up as the public dashboard sets its own up.
const instanceFor: (language: string) => Promise<i18n> = async (
  language: string,
): Promise<i18n> => {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      [language]: { translation: readLocale(language) },
      en: { translation: readLocale("en") },
    },
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });

  return instance;
};

const renderIn: (
  language: string,
  element: ReactElement,
) => Promise<void> = async (
  language: string,
  element: ReactElement,
): Promise<void> => {
  const instance: i18n = await instanceFor(language);

  await act(async () => {
    render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);
  });
};

// Makes every element measure as text that runs past two lines, or not.
const measureAsCut: (isCut: boolean) => void = (isCut: boolean): void => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: (): number => {
      return isCut ? 120 : 40;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: (): number => {
      return 40;
    },
  });
};

describe("the error pages' words, in every public dashboard language", () => {
  test.each(LANGUAGES)("%s has every one, filled in", (language: string) => {
    const locale: Words = readLocale(language);

    for (const word of WORDS) {
      const value: string | undefined = locale[word];

      expect([language, word, typeof value]).toEqual([
        language,
        word,
        "string",
      ]);
      expect([language, word, (value as string).trim().length > 0]).toEqual([
        language,
        word,
        true,
      ]);
    }
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )("%s words each in its own language, not English", (language: string) => {
    const locale: Words = readLocale(language);

    for (const word of WORDS) {
      expect([language, word, locale[word] === word]).toEqual([
        language,
        word,
        false,
      ]);
    }
  });

  test("English is the words as written", () => {
    const english: Words = readLocale("en");

    for (const word of WORDS) {
      expect(english[word]).toBe(word);
    }
  });

  test("the pages write none of their words themselves", () => {
    for (const page of ["NotFound/NotFound.tsx", "Forbidden/Forbidden.tsx"]) {
      const source: string = fs.readFileSync(
        path.join(PAGES_DIR, page),
        "utf8",
      );

      for (const old of [
        "Dashboard Not Found",
        "Access Denied",
        "does not exist",
        "may be restricted",
      ]) {
        expect([page, old, source.includes(old)]).toEqual([page, old, false]);
      }
    }
  });
});

describe("Dashboard Not Found", () => {
  afterEach(() => {
    cleanup();
  });

  test("says what is wrong, then who can give the visitor a working link", async () => {
    await renderIn("en", <NotFoundPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Dashboard Not Found",
    );
    expect(
      screen.getByTestId(ERROR_PAGE_DESCRIPTION_TEST_ID),
    ).toHaveTextContent(NOT_FOUND_COPY.description);
    expect(screen.getByTestId(ERROR_PAGE_NEXT_STEP_TEST_ID)).toHaveTextContent(
      /ask the person who shared it with you/,
    );
    // Nothing to try again: the same address finds the same nothing.
    expect(screen.queryByTestId(ERROR_PAGE_TRY_AGAIN_TEST_ID)).toBeNull();
  });

  test("in German, every word is German", async () => {
    const german: Words = readLocale("de");

    await renderIn("de", <NotFoundPage />);

    expect(screen.getByTestId(ERROR_PAGE_TITLE_TEST_ID)).toHaveTextContent(
      german[NOT_FOUND_COPY.title]!,
    );
    expect(screen.getByTestId(ERROR_PAGE_NEXT_STEP_TEST_ID)).toHaveTextContent(
      german[NOT_FOUND_COPY.nextStep]!,
    );
    expect(screen.queryByText(NOT_FOUND_COPY.title)).toBeNull();
  });
});

describe("Access Denied", () => {
  let isPreview: boolean = false;

  beforeEach(() => {
    isPreview = false;
    getJestSpyOn(PublicDashboardUtil, "isPreviewPage").mockImplementation(
      (): boolean => {
        return isPreview;
      },
    );
    getJestSpyOn(PublicDashboardUtil, "getDashboardId").mockReturnValue(
      new ObjectID(DASHBOARD_ID),
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("says why, who can let the visitor in, and offers Try again on the dashboard's own address", async () => {
    await renderIn("en", <ForbiddenPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Access Denied",
    );
    expect(
      screen.getByTestId(ERROR_PAGE_DESCRIPTION_TEST_ID),
    ).toHaveTextContent(/IP addresses/);
    expect(screen.getByTestId(ERROR_PAGE_NEXT_STEP_TEST_ID)).toHaveTextContent(
      "Ask the dashboard's owner for access",
    );

    const tryAgain: HTMLElement = screen.getByTestId(
      ERROR_PAGE_TRY_AGAIN_TEST_ID,
    );

    // A full load, so the server is asked again - not this page's /forbidden.
    expect(tryAgain.tagName).toBe("A");
    expect(tryAgain).toHaveAttribute("href", "/");
    expect(tryAgain).toHaveTextContent("Try again");
  });

  test("in the Dashboard's preview, Try again opens the preview's address", async () => {
    isPreview = true;

    await renderIn("en", <ForbiddenPage />);

    expect(screen.getByTestId(ERROR_PAGE_TRY_AGAIN_TEST_ID)).toHaveAttribute(
      "href",
      `/public-dashboard/${DASHBOARD_ID}`,
    );
  });

  test("in Persian, every word is Persian", async () => {
    const persian: Words = readLocale("fa");

    await renderIn("fa", <ForbiddenPage />);

    expect(screen.getByTestId(ERROR_PAGE_TITLE_TEST_ID)).toHaveTextContent(
      persian[FORBIDDEN_COPY.title]!,
    );
    expect(screen.getByTestId(ERROR_PAGE_NEXT_STEP_TEST_ID)).toHaveTextContent(
      persian[FORBIDDEN_COPY.nextStep]!,
    );
    expect(screen.getByTestId(ERROR_PAGE_TRY_AGAIN_TEST_ID)).toHaveTextContent(
      persian[FORBIDDEN_COPY.tryAgain]!,
    );
  });
});

describe("a dashboard's description in its header", () => {
  const LONG: string =
    "Latency, error rates and saturation for every service in the checkout path, with the on-call notes for each panel.";

  afterEach(() => {
    cleanup();
    // Back to jsdom's own, which measures nothing.
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
      "scrollHeight"
    ];
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
      "clientHeight"
    ];
  });

  test("a description that fits two lines is shown whole, with nothing to press", async () => {
    measureAsCut(false);

    await renderIn("en", <DashboardDescription text="Checkout health." />);

    expect(screen.getByTestId(DESCRIPTION_TEST_ID)).toHaveTextContent(
      "Checkout health.",
    );
    expect(screen.queryByTestId(DESCRIPTION_TOGGLE_TEST_ID)).toBeNull();
  });

  test("a longer one is clamped to two lines, never cut to one, and Show more opens all of it", async () => {
    measureAsCut(true);

    await renderIn("en", <DashboardDescription text={LONG} />);

    const text: HTMLElement = screen.getByTestId(DESCRIPTION_TEST_ID);
    const toggle: HTMLElement = screen.getByTestId(DESCRIPTION_TOGGLE_TEST_ID);

    expect(text).toHaveClass("line-clamp-2");
    expect(text).not.toHaveClass("truncate");
    expect(text).toHaveTextContent(LONG);
    expect(toggle).toHaveTextContent("Show more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", text.id);

    fireEvent.click(toggle);

    // Open: no cap at all (Folds), and the way back says which way it is.
    expect(text).not.toHaveClass("line-clamp-2");
    expect(toggle).toHaveTextContent("Show less");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);

    expect(text).toHaveClass("line-clamp-2");
    expect(toggle).toHaveTextContent("Show more");
  });

  test("its toggle is in the reader's language", async () => {
    measureAsCut(true);
    const german: Words = readLocale("de");

    await renderIn("de", <DashboardDescription text={LONG} />);

    expect(screen.getByTestId(DESCRIPTION_TOGGLE_TEST_ID)).toHaveTextContent(
      german[DESCRIPTION_COPY.showMore]!,
    );
  });

  test("the header draws it, and no longer cuts it to one line", () => {
    const source: string = fs.readFileSync(
      path.join(PAGES_DIR, "DashboardView", "DashboardViewPage.tsx"),
      "utf8",
    );

    expect(source).toContain("<DashboardDescription text={pageDescription} />");
    expect(source).not.toContain('"text-sm text-gray-500 truncate"');
  });
});
