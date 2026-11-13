import ErrorSentence from "../../../../UI/Components/ErrorMessage/ErrorSentence";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import fs from "fs";
import path from "path";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import "@testing-library/jest-dom";
import { act, cleanup, render, RenderResult } from "@testing-library/react";
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
 * THE WORKFLOW BUILDER'S "COULDN'T LOAD THIS MODEL'S COLUMNS" NOTICE, IN
 * EVERY DASHBOARD LANGUAGE (#7307).
 *
 * When a step's model columns cannot be read, the field editor says so and
 * falls back to JSON. The error used to sit in brackets inside the first
 * sentence: "Couldn't load this model's columns ({{error}}). ...". Since
 * the error is said through ErrorSentence, an error nobody explained is
 * why it failed and what to do next - two sentences, and a server
 * failure's reference with its copy button - so the brackets held a
 * run-on. The error is now a sentence of its own between the notice's
 * two, in all 18 languages, with no bracket left around it.
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
        return false;
      },
    },
  };
});

// The four notices ModelColumnEditor draws, as en.json keys them.
const NOTICES: Array<string> = [
  "Couldn't load this model's columns. {{error}} The query is shown as JSON.",
  "Couldn't load this model's columns. {{error}} These fields are shown as JSON.",
  "Couldn't load this model's columns. {{error}} You can still write the query as JSON.",
  "Couldn't load this model's columns. {{error}} You can still write these fields as JSON.",
];

// Each notice as it was, with the error in brackets.
const bracketed: (notice: string) => string = (notice: string): string => {
  return notice.replace(". {{error}} ", " ({{error}}). ");
};

// An error in brackets, in Latin or full-width ones.
const ERROR_IN_BRACKETS: RegExp = /[(（]\s*\{\{error\}\}\s*[)）]/u;

const REFERENCE: string = "1f0c9a2b";
const WITH_REFERENCE: string = getUnexplainedServerErrorMessage(REFERENCE);

const MESSAGES: Array<{ message: string; why: string }> = [
  { message: SERVER_DOWN_MESSAGE, why: UnexplainedErrorWords.serverDownWhy },
  { message: WITH_REFERENCE, why: UnexplainedErrorWords.serverWhy },
];

// Every English sentence an unexplained error is said with.
const ENGLISH_SENTENCES: Array<string> = Object.values(
  UnexplainedErrorWords,
).filter((words: string): boolean => {
  return !words.includes("{{");
});

const readIn: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  await act(async () => {
    for (const code of [language, "en"]) {
      i18next.removeResourceBundle(code, "translation");
      i18next.addResourceBundle(
        code,
        "translation",
        readDashboardLocale(code),
        true,
        true,
      );
    }

    await i18next.changeLanguage(language);
  });
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

describe("the notices", () => {
  test("a bracketed error is what the check finds, in Latin and full-width brackets", () => {
    expect(ERROR_IN_BRACKETS.test(bracketed(NOTICES[0]!))).toBe(true);
    expect(ERROR_IN_BRACKETS.test("無法載入此模型的欄位（{{error}}）。")).toBe(
      true,
    );

    for (const notice of NOTICES) {
      expect(ERROR_IN_BRACKETS.test(notice)).toBe(false);
    }
  });

  test("are the ones ModelColumnEditor draws, with no error in brackets left there", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../UI/Components/Workflow/ModelColumnEditor.tsx",
      ),
      "utf-8",
    );

    for (const notice of NOTICES) {
      expect(source).toContain(`"${notice}"`);
    }

    expect(ERROR_IN_BRACKETS.test(source)).toBe(false);
  });
});

describe.each(["en", ...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
  test("each notice is worded, and an error nobody explained is a sentence of its own in it", async () => {
    await readIn(language);

    const locale: Record<string, string> = readDashboardLocale(language);

    for (const notice of NOTICES) {
      const worded: string | undefined = locale[notice];

      expect({ language, notice, worded: Boolean(worded) }).toEqual({
        language,
        notice,
        worded: true,
      });

      if (language !== "en") {
        expect({ language, notice, english: worded === notice }).toEqual({
          language,
          notice,
          english: false,
        });
      }

      expect(worded).toContain("{{error}}");
      expect({
        language,
        notice,
        bracketed: ERROR_IN_BRACKETS.test(worded!),
      }).toEqual({ language, notice, bracketed: false });

      // The old, bracketed key is gone.
      expect(locale[bracketed(notice)]).toBeUndefined();

      const [before, after] = worded!.split("{{error}}") as [string, string];

      for (const entry of MESSAGES) {
        const result: RenderResult = render(
          <p data-testid="notice">
            <ErrorSentence template={notice} error={entry.message} />
          </p>,
        );

        const text: string = withoutIsolateMarks(
          result.getByTestId("notice").textContent || "",
        ).trim();

        // The notice's first sentence, why and what next, then its last.
        expect({
          language,
          notice,
          starts: text.startsWith(before.trim()),
        }).toEqual({ language, notice, starts: true });
        expect({ language, notice, ends: text.endsWith(after.trim()) }).toEqual(
          { language, notice, ends: true },
        );
        expect(text).toContain(locale[entry.why]!);

        if (entry.message === WITH_REFERENCE) {
          expect(result.getByText(REFERENCE).tagName).toBe("CODE");
        }

        expect(text).not.toContain(SERVER_DOWN_MESSAGE);
        expect(text).not.toContain(entry.message);

        if (language !== "en") {
          for (const sentence of ENGLISH_SENTENCES) {
            expect({
              language,
              sentence,
              left: text.includes(sentence),
            }).toEqual({ language, sentence, left: false });
          }

          expect(text).not.toContain("Couldn't load this model's columns");
        }

        result.unmount();
      }
    }
  });
});
