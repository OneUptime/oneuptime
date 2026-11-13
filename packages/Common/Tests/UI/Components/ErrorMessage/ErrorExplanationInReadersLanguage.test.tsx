import ErrorExplanation from "../../../../UI/Components/ErrorMessage/ErrorExplanation";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
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
 * AN ERROR NOBODY EXPLAINED, IN THE READER'S LANGUAGE (#6836).
 *
 * The Dashboard, Accounts (the sign-in pages) and the Admin Dashboard each
 * draw ErrorExplanation, and each looks its words up in its own locale. Each
 * app's locale files are read here, as the app ships them, and every kind
 * of unexplained error is drawn in every language the app offers - as a
 * master admin of a self-hosted server, who reads the most of it: none of
 * its English sentences is left on the page, and the reference is drawn as
 * written.
 */

jest.mock("../../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

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

// Every English sentence ErrorExplanation can draw.
const ENGLISH_SENTENCES: Array<string> = Object.values(
  UnexplainedErrorWords,
).filter((words: string): boolean => {
  return !words.includes("{{");
});

const REFERENCE: string = "a1b2c3d4";

const MESSAGES: Array<string> = [
  getUnexplainedServerErrorMessage(REFERENCE),
  UNEXPLAINED_ERROR_MESSAGES.server,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES.unreachable,
  UNEXPLAINED_ERROR_MESSAGES.page,
];

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
    "in %s, says none of it in English",
    async (language: string) => {
      await readIn(app, language);

      for (const message of MESSAGES) {
        const { container, unmount } = render(
          <ErrorExplanation message={message} />,
        );

        const text: string = withoutIsolateMarks(container.textContent || "");

        for (const sentence of ENGLISH_SENTENCES) {
          expect({
            app,
            language,
            message,
            sentence,
            left: text.includes(sentence),
          }).toEqual({
            app,
            language,
            message,
            sentence,
            left: false,
          });
        }

        if (message.includes(REFERENCE)) {
          expect(text).toContain(REFERENCE);
        }

        unmount();
      }
    },
  );

  test("every locale file of the app has every sentence the transport carries", () => {
    for (const language of ["en", ...LANGUAGES]) {
      const words: Words = wordsOf(app, language);

      for (const key of [
        ...Object.values(UNEXPLAINED_ERROR_MESSAGES),
        ...ENGLISH_SENTENCES,
      ]) {
        expect({ language, key, has: typeof words[key] === "string" }).toEqual({
          language,
          key,
          has: true,
        });
      }
    }
  });
});
