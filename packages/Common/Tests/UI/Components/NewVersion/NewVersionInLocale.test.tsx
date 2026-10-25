import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import { Mock, SpyInstance } from "jest-mock";
import path from "path";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import ErrorBoundary from "../../../../UI/Components/ErrorBoundary";
import NewVersionNotice from "../../../../UI/Components/NewVersion/NewVersionNotice";
import { markChunkLoadErrorReload } from "../../../../UI/Utils/NewVersion/ChunkLoadError";
import NewVersion, {
  NewVersionAudience,
} from "../../../../UI/Utils/NewVersion/NewVersion";
import { FetchFunction } from "../../../../UI/Utils/NewVersion/ServerBuildCheck";
import UnsavedChanges from "../../../../UI/Utils/NewVersion/UnsavedChanges";

/*
 * What a reader sees when a new version is out - the notice, and a page
 * moving onto the new version - in every language the frontends ship, read
 * from the locale files themselves: the Dashboard's, and the Admin
 * Dashboard's, Accounts' and Status Page's own (each frontend reads only
 * its own file). Every string is translated, the screens draw the locale's
 * words, a visitor's never name OneUptime in any language, and questions
 * end the way each language ends them.
 */

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet",
);

const LANGUAGES: Array<string> = [
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
];

// The notice (Dashboard, Admin Dashboard).
const NOTICE: Array<string> = [
  "OneUptime has been updated",
  "The next page you open loads the new version.",
  "Reload now? Changes you haven't saved on this page will be lost.",
  "Reload anyway",
  "Reload",
  "Cancel",
  "Dismiss",
];

// A page moving onto the new version, worded for the people who use OneUptime.
const PAGE_FOR_MEMBERS: Array<string> = [
  "Updating to the new version",
  "OneUptime was updated while you had it open. This page will open in the new version in a moment.",
  "A new version of OneUptime is ready",
  "This page needs the new version to open. Reloading discards changes you haven't saved.",
  "You're offline",
  "This page needs an internet connection to load. It will load as soon as you're back online.",
  "Can't reach the server",
  "It may be restarting after an update. This page will load as soon as the server is back.",
  "This page couldn't be loaded",
  "A file it needs couldn't be downloaded from the server. Try reloading in a moment.",
  "Try now",
  "Try again",
  "Reload page",
  "Loading",
  "Loading...",
];

// The same, worded for a status page's or a public dashboard's visitors.
const PAGE_FOR_VISITORS: Array<string> = [
  "Loading the latest version",
  "A newer version of this page is available. It's loading now.",
  "A newer version of this page is ready",
  "This page needs the new version to open. Reloading discards changes you haven't saved.",
  "You're offline",
  "This page needs an internet connection to load. It will load as soon as you're back online.",
  "Can't reach the server",
  "It may be restarting after an update. This page will load as soon as the server is back.",
  "This page couldn't be loaded",
  "A file it needs couldn't be downloaded from the server. Try reloading in a moment.",
  "Try now",
  "Try again",
  "Reload page",
  "Loading",
  "Loading...",
];

// One part of a page (ContainedErrorBoundary).
const PART: Array<string> = [
  "Loading the latest version...",
  "You're offline. This will load when you're back online.",
  "Can't reach the server. Trying again automatically.",
  "This needs the latest version. Save your changes, then reload the page.",
  "This couldn't be loaded.",
];

const unique: (keys: Array<string>) => Array<string> = (
  keys: Array<string>,
): Array<string> => {
  return Array.from(new Set(keys));
};

const WHAT_EACH_FRONTEND_SHOWS: Record<string, Array<string>> = {
  Dashboard: unique([
    ...NOTICE,
    ...PAGE_FOR_MEMBERS,
    ...PAGE_FOR_VISITORS,
    ...PART,
  ]),
  AdminDashboard: unique([...NOTICE, ...PAGE_FOR_MEMBERS, ...PART]),
  Accounts: unique(PAGE_FOR_MEMBERS),
  StatusPage: unique([...PAGE_FOR_VISITORS, ...PART]),
};

type Locale = Record<string, unknown>;

const readLocale: (frontend: string, language: string) => Locale = (
  frontend: string,
  language: string,
): Locale => {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS, frontend, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Locale;
};

describe.each(Object.keys(WHAT_EACH_FRONTEND_SHOWS))(
  "the %s's locale files",
  (frontend: string) => {
    const keys: Array<string> = WHAT_EACH_FRONTEND_SHOWS[frontend]!;
    const english: Locale = readLocale(frontend, "en");

    test("hold every string its screens show, in English as the key", () => {
      for (const key of keys) {
        expect([key, english[key]]).toEqual([key, key]);
      }
    });

    test.each(LANGUAGES)(
      "translate every one of them in %s",
      (language: string) => {
        const locale: Locale = readLocale(frontend, language);

        for (const key of keys) {
          const value: unknown = locale[key];

          expect({ key, isString: typeof value === "string" }).toEqual({
            key,
            isString: true,
          });
          expect({ key, translated: value !== key }).toEqual({
            key,
            translated: true,
          });
        }
      },
    );
  },
);

describe("a visitor's words", () => {
  test.each(LANGUAGES)("never name OneUptime in %s", (language: string) => {
    for (const frontend of ["Dashboard", "StatusPage"]) {
      const locale: Locale = readLocale(frontend, language);

      for (const key of [...PAGE_FOR_VISITORS, ...PART]) {
        expect({ frontend, key, value: locale[key] }).toEqual({
          frontend,
          key,
          value: expect.not.stringContaining("OneUptime"),
        });
      }
    }
  });
});

describe("a question in the notice", () => {
  const QUESTION: string =
    "Reload now? Changes you haven't saved on this page will be lost.";

  test.each<[string, string]>([
    ["ja", "？"],
    ["zh-CN", "？"],
    ["zh-TW", "？"],
    ["fa", "؟"],
    ["de", "?"],
    ["fr", " ?"],
    ["es", "?"],
  ])("ends the way %s ends one", (language: string, mark: string) => {
    const value: string = readLocale("Dashboard", language)[QUESTION] as string;

    expect(value).toContain(mark);

    if (language === "es") {
      expect(value.startsWith("¿")).toBe(true);
    }
  });
});

/*
 * The screens themselves, drawn in each language from the Dashboard's
 * locale (the Dashboard reads its own file; the others' are checked above).
 */
describe("drawn in each language", () => {
  const RUNNING: string = "14.0.89-aaaa-0001";
  const NEWER: string = "14.0.90-bbbb-0002";

  let serverAnswers: boolean = true;

  const fetchFunction: FetchFunction = (): Promise<Response> => {
    if (!serverAnswers) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }

    return Promise.resolve({
      status: 200,
      ok: true,
      text: (): Promise<string> => {
        return Promise.resolve(JSON.stringify({ buildId: NEWER }));
      },
    } as unknown as Response);
  };

  const instances: Record<string, i18n> = {};

  const ORIGINAL_LOCATION: Location = window.location;
  let reloadMock: Mock<() => void>;
  let consoleWarnSpy: SpyInstance<typeof console.warn>;
  let consoleErrorSpy: SpyInstance<typeof console.error>;

  beforeAll(async () => {
    for (const language of LANGUAGES) {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        resources: {
          [language]: {
            translation: readLocale("Dashboard", language) as Record<
              string,
              string
            >,
          },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      instances[language] = instance;
    }
  });

  const start: (audience: NewVersionAudience) => void = (
    audience: NewVersionAudience,
  ): void => {
    NewVersion.start({
      audience: audience,
      runningBuild: {
        buildId: RUNNING,
        manifestUrl: "/dashboard/dist/build.json",
      },
      fetchFunction: fetchFunction,
      firstCheckDelayInMs: 24 * 60 * 60 * 1000,
    });
  };

  const ChunkFailure: FunctionComponent = (): ReactElement => {
    throw new Error(
      "Failed to fetch dynamically imported module: /dashboard/dist/X-ABCDEFGH.js",
    );
  };

  const drawPage: (language: string) => void = (language: string): void => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <ErrorBoundary>
          <ChunkFailure />
        </ErrorBoundary>
      </I18nextProvider>,
    );
  };

  const word: (language: string, key: string) => string = (
    language: string,
    key: string,
  ): string => {
    return readLocale("Dashboard", language)[key] as string;
  };

  beforeEach(() => {
    NewVersion.reset();
    UnsavedChanges.reset();
    window.sessionStorage.clear();
    window.name = "";
    serverAnswers = true;
    reloadMock = jest.fn<() => void>();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...ORIGINAL_LOCATION, reload: reloadMock },
    });
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
      return undefined;
    });
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    NewVersion.reset();
    UnsavedChanges.reset();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: ORIGINAL_LOCATION,
    });
  });

  test.each(LANGUAGES)("the notice, in %s", async (language: string) => {
    start(NewVersionAudience.Members);
    await act(async () => {
      await NewVersion.checkNow({ force: true });
    });

    render(
      <I18nextProvider i18n={instances[language]!}>
        <NewVersionNotice />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("new-version-notice-title")).toHaveTextContent(
      word(language, "OneUptime has been updated"),
    );
    expect(screen.getByTestId("new-version-notice-message")).toHaveTextContent(
      word(language, "The next page you open loads the new version."),
    );
    expect(screen.getByTestId("new-version-notice-reload")).toHaveTextContent(
      word(language, "Reload"),
    );
    expect(screen.getByTestId("new-version-notice-dismiss")).toHaveAttribute(
      "aria-label",
      word(language, "Dismiss"),
    );
  });

  test.each(LANGUAGES)(
    "a page updating to the new version, in %s",
    async (language: string) => {
      start(NewVersionAudience.Members);
      drawPage(language);

      await waitFor(() => {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      });

      expect(screen.getByTestId("chunk-load-recovery-title")).toHaveTextContent(
        word(language, "Updating to the new version"),
      );
      expect(screen.getByTestId("chunk-load-recovery")).toHaveTextContent(
        word(
          language,
          "OneUptime was updated while you had it open. This page will open in the new version in a moment.",
        ),
      );
    },
  );

  test.each(LANGUAGES)(
    "a page whose server does not answer, in %s",
    async (language: string) => {
      serverAnswers = false;
      start(NewVersionAudience.Members);
      drawPage(language);

      await waitFor(() => {
        expect(
          screen.getByTestId("chunk-load-recovery-title"),
        ).toHaveTextContent(word(language, "Can't reach the server"));
      });

      expect(screen.getByTestId("chunk-load-recovery-retry")).toHaveTextContent(
        word(language, "Try now"),
      );
    },
  );

  test.each(LANGUAGES)(
    "a page that could not be loaded after reloading, in %s",
    async (language: string) => {
      markChunkLoadErrorReload(Date.now());
      start(NewVersionAudience.Members);
      drawPage(language);

      await waitFor(() => {
        expect(screen.getByTestId("error-boundary-title")).toHaveTextContent(
          word(language, "This page couldn't be loaded"),
        );
      });

      expect(screen.getByTestId("error-boundary-reload")).toHaveTextContent(
        word(language, "Reload page"),
      );
    },
  );

  test.each(LANGUAGES)(
    "a visitor's page loading the latest version, in %s",
    async (language: string) => {
      start(NewVersionAudience.Visitors);
      drawPage(language);

      await waitFor(() => {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      });

      expect(screen.getByTestId("chunk-load-recovery-title")).toHaveTextContent(
        word(language, "Loading the latest version"),
      );
      expect(
        screen.getByTestId("chunk-load-recovery").textContent || "",
      ).not.toContain("OneUptime");
    },
  );
});
