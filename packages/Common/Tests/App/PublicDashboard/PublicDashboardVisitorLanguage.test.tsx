import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import type { i18n as I18nInstance } from "i18next";
import { Mock, SpyInstance } from "jest-mock";
import path from "path";
import React, { FunctionComponent, ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import ErrorBoundary from "../../../UI/Components/ErrorBoundary";
import NewVersion, {
  NewVersionAudience,
} from "../../../UI/Utils/NewVersion/NewVersion";
import { FetchFunction } from "../../../UI/Utils/NewVersion/ServerBuildCheck";
import UnsavedChanges from "../../../UI/Utils/NewVersion/UnsavedChanges";

/*
 * "The Public Dashboard's strings are English only" - the maintainer, of
 * what a public dashboard's visitor reads while the page moves onto a new
 * version of OneUptime or cannot load (#5254). The Public Dashboard now has
 * locale files of its own, as every frontend has, and starts its
 * translation before its first render in its visitor's language - the
 * browser's, as nothing on the page picks one
 * (PublicDashboard/src/Utils/i18n.ts, Common/UI/Utils/VisitorLanguage).
 *
 * The module is loaded as the browser loads it, in a fresh module registry
 * with the browser's languages set first.
 */

const PUBLIC_DASHBOARD: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "PublicDashboard",
);

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
];

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(PUBLIC_DASHBOARD, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
};

const setBrowserLanguages: (languages: Array<string>) => void = (
  languages: Array<string>,
): void => {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    get: (): Array<string> => {
      return languages;
    },
  });
};

interface LoadedModule {
  language: string;
  i18n: I18nInstance;
}

// The Public Dashboard's real i18n module, loaded fresh for these languages.
const loadPublicDashboardI18n: (
  browserLanguages: Array<string>,
) => Promise<LoadedModule> = async (
  browserLanguages: Array<string>,
): Promise<LoadedModule> => {
  setBrowserLanguages(browserLanguages);

  let loaded: LoadedModule | null = null;

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const module: { PUBLIC_DASHBOARD_LANGUAGE: string } = require(
      path.join(PUBLIC_DASHBOARD, "src", "Utils", "i18n.ts"),
    );
    const i18next: {
      default?: I18nInstance;
    } & I18nInstance = require("i18next");
    const i18n: I18nInstance = i18next.default || i18next;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

    loaded = { language: module.PUBLIC_DASHBOARD_LANGUAGE, i18n };
  });

  const result: LoadedModule = loaded!;

  if (!result.i18n.isInitialized) {
    await new Promise<void>((resolve: () => void) => {
      result.i18n.on("initialized", () => {
        resolve();
      });
    });
  }

  return result;
};

afterEach(() => {
  setBrowserLanguages(["en-US"]);
});

describe("the Public Dashboard's words", () => {
  test("are in every language the other frontends speak, key for key", () => {
    const english: Record<string, string> = readLocale("en");

    expect(
      fs
        .readdirSync(path.join(PUBLIC_DASHBOARD, "src", "Locales"))
        .filter((file: string): boolean => {
          return file.endsWith(".json");
        })
        .sort(),
    ).toEqual(
      LANGUAGES.map((language: string): string => {
        return `${language}.json`;
      }).sort(),
    );

    for (const language of LANGUAGES) {
      expect([language, Object.keys(readLocale(language))]).toEqual([
        language,
        Object.keys(english),
      ]);
    }
  });

  test("its i18n module loads every one of them", () => {
    const source: string = fs.readFileSync(
      path.join(PUBLIC_DASHBOARD, "src", "Utils", "i18n.ts"),
      "utf8",
    );

    for (const language of LANGUAGES) {
      expect([
        language,
        source.includes(`../Locales/${language}.json"`),
      ]).toEqual([language, true]);
    }
  });

  test("start before anything else in the entry", () => {
    const entry: string = fs.readFileSync(
      path.join(PUBLIC_DASHBOARD, "src", "Index.tsx"),
      "utf8",
    );

    expect(entry.indexOf('import "./Utils/i18n";')).toBe(0);
  });
});

describe("the visitor's language", () => {
  test.each<[Array<string>, string]>([
    [["de-DE", "en"], "de"],
    [["fa-IR"], "fa"],
    [["zh-HK"], "zh-TW"],
    [["xx-YY", "ja"], "ja"],
    [["xx-YY"], "en"],
  ])(
    "a browser saying %j is read in %s",
    async (browserLanguages: Array<string>, language: string) => {
      const loaded: LoadedModule =
        await loadPublicDashboardI18n(browserLanguages);

      expect(loaded.language).toBe(language);
      expect(loaded.i18n.language).toBe(language);
      expect(loaded.i18n.t("Loading the latest version")).toBe(
        readLocale(language)["Loading the latest version"],
      );
    },
  );
});

describe("a visitor's page moving onto a new version, in the visitor's language", () => {
  const RUNNING: string = "14.0.89-aaaa-0001";
  const NEWER: string = "14.0.90-bbbb-0002";
  const ORIGINAL_LOCATION: Location = window.location;

  let reloadMock: Mock<() => void>;
  let consoleErrorSpy: SpyInstance<typeof console.error>;
  let consoleWarnSpy: SpyInstance<typeof console.warn>;

  const fetchFunction: FetchFunction = (): Promise<Response> => {
    return Promise.resolve({
      status: 200,
      ok: true,
      text: (): Promise<string> => {
        return Promise.resolve(JSON.stringify({ buildId: NEWER }));
      },
    } as unknown as Response);
  };

  const ChunkFailure: FunctionComponent = (): ReactElement => {
    throw new Error(
      "Failed to fetch dynamically imported module: /public-dashboard/dist/DashboardCanvas-ABCDEFGH.js",
    );
  };

  beforeEach(() => {
    NewVersion.reset();
    UnsavedChanges.reset();
    window.sessionStorage.clear();
    reloadMock = jest.fn<() => void>();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...ORIGINAL_LOCATION, reload: reloadMock },
    });
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    NewVersion.reset();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: ORIGINAL_LOCATION,
    });
  });

  test.each<[string, string, string]>([
    ["de-DE", "de", "ltr"],
    ["fa-IR", "fa", "rtl"],
  ])(
    "a browser in %s reads it in its own words, the way its language reads",
    async (browserLanguage: string, language: string, direction: string) => {
      const loaded: LoadedModule = await loadPublicDashboardI18n([
        browserLanguage,
      ]);
      const locale: Record<string, string> = readLocale(language);

      NewVersion.start({
        audience: NewVersionAudience.Visitors,
        runningBuild: {
          buildId: RUNNING,
          manifestUrl: "/public-dashboard/dist/build.json",
        },
        fetchFunction: fetchFunction,
        firstCheckDelayInMs: 24 * 60 * 60 * 1000,
      });

      render(
        <I18nextProvider i18n={loaded.i18n}>
          <ErrorBoundary>
            <ChunkFailure />
          </ErrorBoundary>
        </I18nextProvider>,
      );

      await waitFor(() => {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      });

      expect(screen.getByTestId("chunk-load-recovery-title")).toHaveTextContent(
        locale["Loading the latest version"]!,
      );
      expect(screen.getByTestId("chunk-load-recovery")).toHaveTextContent(
        locale["A newer version of this page is available. It's loading now."]!,
      );
      expect(screen.getByTestId("chunk-load-recovery")).toHaveAttribute(
        "lang",
        language,
      );
      expect(screen.getByTestId("chunk-load-recovery")).toHaveAttribute(
        "dir",
        direction,
      );
      expect(
        screen.getByTestId("chunk-load-recovery").textContent || "",
      ).not.toContain("OneUptime");
    },
  );
});
