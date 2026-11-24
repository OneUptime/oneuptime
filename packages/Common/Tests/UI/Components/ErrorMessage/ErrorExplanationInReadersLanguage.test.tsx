import ErrorExplanation from "../../../../UI/Components/ErrorMessage/ErrorExplanation";
import NewVersion, {
  NewVersionAudience,
} from "../../../../UI/Utils/NewVersion/NewVersion";
import {
  getExplanationWords,
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorExplanation,
  UnexplainedErrorKind,
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
 * The Dashboard, Accounts (the sign-in pages), the Admin Dashboard, the
 * status page and the public dashboard each draw ErrorExplanation (a form's
 * alert, a list that did not load, the page that did not load), and each
 * looks its words up in its own locale. Each app's locale files are read
 * here, as the app ships them, and every kind of unexplained error is drawn
 * in every language the app offers - for the people who use OneUptime as a
 * master admin of a self-hosted server, who reads the most of it, and for
 * a status page's or a public dashboard's visitor as a visitor, who is told
 * to try again and nothing about the server's logs (#7274): none of its
 * English sentences is left on the page, and the reference is drawn as
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

type App =
  | "Accounts"
  | "AdminDashboard"
  | "Dashboard"
  | "StatusPage"
  | "PublicDashboard";
type Words = Record<string, unknown>;

const APPS: Array<App> = [
  "Dashboard",
  "Accounts",
  "AdminDashboard",
  "StatusPage",
  "PublicDashboard",
];

// The apps a visitor reads, who never chose OneUptime (NewVersion's audience).
const VISITOR_APPS: ReadonlyArray<App> = ["StatusPage", "PublicDashboard"];

const isVisitorApp: (app: App) => boolean = (app: App): boolean => {
  return VISITOR_APPS.includes(app);
};

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

/*
 * The sentences a visitor can read: the first line, and why and what to do
 * next for every kind, on OneUptime Cloud and on a server somebody runs -
 * read from getExplanationWords, so a new one for visitors is a key their
 * apps need too. Never where to look, nor the reference's next step, which
 * names whoever runs the server.
 */
const VISITOR_SENTENCES: Array<string> = Array.from(
  new Set<string>([
    UnexplainedErrorWords.didNotFinish,
    ...Object.values(UnexplainedErrorKind).flatMap(
      (kind: UnexplainedErrorKind): Array<string> => {
        return [true, false].flatMap((isCloud: boolean): Array<string> => {
          const words: UnexplainedErrorExplanation = getExplanationWords({
            error: { kind: kind, reference: null },
            isCloud: isCloud,
            isMasterAdmin: true,
            isVisitor: true,
          });

          return [words.why, words.next, words.whereToLook].filter(
            (sentence: string | null): sentence is string => {
              return Boolean(sentence);
            },
          );
        });
      },
    ),
  ]),
);

// What each app's reader can read, as its locales must word it.
const sentencesOf: (app: App) => Array<string> = (app: App): Array<string> => {
  return isVisitorApp(app) ? VISITOR_SENTENCES : ENGLISH_SENTENCES;
};

const REFERENCE: string = "a1b2c3d4";

const MESSAGES: Array<string> = [
  getUnexplainedServerErrorMessage(REFERENCE),
  UNEXPLAINED_ERROR_MESSAGES.server,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES.unreachable,
  UNEXPLAINED_ERROR_MESSAGES.page,
  // A proxy's 413 (#8278), with the proxy's limit for this master admin.
  UNEXPLAINED_ERROR_MESSAGES.tooLarge,
  // OneUptime's own 413 (#8567), with no proxy to look at.
  UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime,
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
  NewVersion.reset();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe.each(APPS)("%s", (app: App) => {
  test.each(LANGUAGES)(
    "in %s, says none of it in English",
    async (language: string) => {
      await readIn(app, language);

      NewVersion.start({
        audience: isVisitorApp(app)
          ? NewVersionAudience.Visitors
          : NewVersionAudience.Members,
        firstCheckDelayInMs: 24 * 60 * 60 * 1000,
      });

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

        if (isVisitorApp(app)) {
          // A visitor is never told where the server's logs are.
          expect(
            container.querySelector("[data-testid='error-where-to-look']"),
          ).toBeNull();
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
        ...sentencesOf(app),
        // What a page was doing, said first ("The monitor was not saved.").
        UnexplainedErrorWords.createFailed,
        UnexplainedErrorWords.saveFailed,
        UnexplainedErrorWords.loadFailed,
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

describe("a visitor's apps", () => {
  test("read only what a visitor can read, never where to look", () => {
    expect(VISITOR_SENTENCES).toContain(UnexplainedErrorWords.serverNext);
    expect(VISITOR_SENTENCES).toContain(UnexplainedErrorWords.unreachableWhy);

    for (const memberOnly of [
      UnexplainedErrorWords.serverNextWithReferenceCloud,
      UnexplainedErrorWords.serverNextWithReferenceSelfHosted,
      UnexplainedErrorWords.adminWhereToLookWithReference,
      UnexplainedErrorWords.adminWhereToLook,
      UnexplainedErrorWords.serverDownWhereToLook,
      UnexplainedErrorWords.tooLargeWhereToLook,
    ]) {
      expect(VISITOR_SENTENCES).not.toContain(memberOnly);
    }
  });

  test.each(VISITOR_APPS as Array<App>)(
    "%s words each sentence as the Dashboard does",
    (app: App) => {
      for (const language of LANGUAGES) {
        const words: Words = wordsOf(app, language);
        const dashboard: Words = wordsOf("Dashboard", language);

        for (const key of [
          ...Object.values(UNEXPLAINED_ERROR_MESSAGES),
          ...VISITOR_SENTENCES,
        ]) {
          expect({ app, language, key, words: words[key] }).toEqual({
            app,
            language,
            key,
            words: dashboard[key],
          });
        }
      }
    },
  );
});
