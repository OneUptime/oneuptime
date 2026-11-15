import ErrorExplanation from "../../../../UI/Components/ErrorMessage/ErrorExplanation";
import {
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONEUPTIME'S OWN 413, IN EVERY LANGUAGE (#8567).
 *
 * The App answers a body over its own 50 MB with
 * UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime. A proxy's 413 page reads
 * as UNEXPLAINED_ERROR_MESSAGES.tooLarge, and for a master admin of a
 * self-hosted server adds where to look: raise the proxy's limit to 50 MB.
 * That line was wrong for the App's own 413, where no proxy refused
 * anything. Here the App's own is drawn for that admin (the reader most
 * likely to be sent astray) in all 18 languages of the three apps: the 50 MB
 * is said, the proxy is not.
 */

jest.mock("../../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  // A self-hosted server.
  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
    },
  };
});

type App = "Accounts" | "AdminDashboard" | "Dashboard";
type Words = Record<string, unknown>;

const APPS: Array<App> = ["Dashboard", "Accounts", "AdminDashboard"];

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

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet",
);

const wordsOf: (app: App, language: string) => Words = (
  app: App,
  language: string,
): Words => {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS, app, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Words;
};

const readIn: (app: App, language: string) => Promise<void> = async (
  app: App,
  language: string,
): Promise<void> => {
  await act(async () => {
    for (const code of [language, "en"]) {
      i18next.removeResourceBundle(code, "translation");
      i18next.addResourceBundle(
        code,
        "translation",
        wordsOf(app, code),
        true,
        true,
      );
    }

    await i18next.changeLanguage(language);
  });
};

/*
 * Spaces as the words are written: a page keeps "50 MB" on one line with a
 * no-break space (NoBreakSpaces), and French its marks with narrow ones.
 */
const plainSpaces: (text: string) => string = (text: string): string => {
  return text.replace(/[\u00a0\u202f]/g, " ");
};

// The fifty a language writes the limit with: Persian in its own digits.
const fiftyIn: (language: string) => string = (language: string): string => {
  return language === "fa" ? "۵۰" : "50";
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe.each(APPS)("%s", (app: App) => {
  test.each(LANGUAGES)(
    "in %s, the message and its why say OneUptime's 50 MB",
    (language: string) => {
      const words: Words = wordsOf(app, language);

      for (const key of [
        UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
        UnexplainedErrorWords.tooLargeForOneUptimeWhy,
      ]) {
        const said: unknown = words[key];

        expect({ language, key, type: typeof said }).toEqual({
          language,
          key,
          type: "string",
        });
        expect(said as string).toContain("OneUptime");
        expect(said as string).toContain(fiftyIn(language));

        if (language !== "en") {
          expect({ language, key, english: said === key }).toEqual({
            language,
            key,
            english: false,
          });
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "in %s, a self-hosted master admin reads the 50 MB and what to do, and nothing about a proxy",
    async (language: string) => {
      await readIn(app, language);

      const words: Words = wordsOf(app, language);
      const { container, unmount } = render(
        <ErrorExplanation
          message={UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime}
        />,
      );

      const text: string = plainSpaces(
        withoutIsolateMarks(container.textContent || ""),
      );

      expect(text).toContain(
        plainSpaces(
          words[UnexplainedErrorWords.tooLargeForOneUptimeWhy] as string,
        ),
      );
      expect(text).toContain(
        plainSpaces(words[UnexplainedErrorWords.tooLargeNext] as string),
      );
      expect(text).not.toContain(
        plainSpaces(words[UnexplainedErrorWords.tooLargeWhereToLook] as string),
      );
      expect(text).not.toContain("client_max_body_size");
      // Nothing for support to look up.
      expect(text).not.toContain(
        words[UnexplainedErrorWords.openHealth] as string,
      );

      unmount();
    },
  );

  test("a proxy's 413 still sends that admin to the proxy, in English", async () => {
    await readIn(app, "en");

    const { container, unmount } = render(
      <ErrorExplanation message={UNEXPLAINED_ERROR_MESSAGES.tooLarge} />,
    );

    expect(plainSpaces(container.textContent || "")).toContain(
      "client_max_body_size 50M",
    );

    unmount();
  });
});
