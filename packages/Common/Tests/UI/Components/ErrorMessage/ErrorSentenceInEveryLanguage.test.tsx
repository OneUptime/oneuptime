import ErrorSentence from "../../../../UI/Components/ErrorMessage/ErrorSentence";
import { joinSentences } from "../../../../UI/Components/DeleteConfirmation/DeleteConsequences";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  render,
  RenderResult,
  within,
} from "@testing-library/react";
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
 * A CARD'S SENTENCE WITH AN ERROR IN IT, IN EVERY DASHBOARD LANGUAGE (#7307).
 *
 * The Dashboard's locale files, as they ship, and every kind of error
 * nobody explained put into the who-is-told card's sentence - read by a
 * master admin of a self-hosted server, who reads the most of it. In each
 * of the 18 languages the sentence reads wholly in that language: the
 * card's words, then why it failed and what to do next in the same
 * language, and the reference as written. None of ErrorExplanation's
 * English is left, and SERVER_DOWN_MESSAGE is never on the page - in
 * English neither.
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

const WHO_IS_TOLD: string = "Couldn't work out who is told. {{error}}";
const REFERENCE: string = "a1b2c3d4";
const WITH_REFERENCE: string = getUnexplainedServerErrorMessage(REFERENCE);

// Every English sentence an unexplained error is said with.
const ENGLISH_SENTENCES: Array<string> = Object.values(
  UnexplainedErrorWords,
).filter((words: string): boolean => {
  return !words.includes("{{");
});

const MESSAGES: Array<{ message: string; why: string; next: string }> = [
  {
    message: SERVER_DOWN_MESSAGE,
    why: UnexplainedErrorWords.serverDownWhy,
    next: UnexplainedErrorWords.serverDownNext,
  },
  {
    message: WITH_REFERENCE,
    why: UnexplainedErrorWords.serverWhy,
    next: UnexplainedErrorWords.serverNextWithReferenceSelfHosted,
  },
  {
    message: UNEXPLAINED_ERROR_MESSAGES.server,
    why: UnexplainedErrorWords.serverWhy,
    next: UnexplainedErrorWords.serverNext,
  },
  {
    message: UNEXPLAINED_ERROR_MESSAGES.unreachable,
    why: UnexplainedErrorWords.unreachableWhy,
    next: UnexplainedErrorWords.unreachableNext,
  },
  {
    message: UNEXPLAINED_ERROR_MESSAGES.page,
    why: UnexplainedErrorWords.pageWhy,
    next: UnexplainedErrorWords.pageNext,
  },
];

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

const drawn: (message: string) => {
  text: string;
  result: RenderResult;
} = (message: string): { text: string; result: RenderResult } => {
  const result: RenderResult = render(
    <p data-testid="sentence">
      <ErrorSentence template={WHO_IS_TOLD} error={message} />
    </p>,
  );

  return {
    text: withoutIsolateMarks(
      result.getByTestId("sentence").textContent || "",
    ).trim(),
    result: result,
  };
};

describe("the languages", () => {
  test("are the Dashboard's 17 besides English", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);
    expect(DASHBOARD_LANGUAGES).toEqual(
      expect.arrayContaining(["de", "fa", "ar", "ja", "zh-CN", "hi"]),
    );
  });
});

describe("a sentence the reader's language has no wording of", () => {
  test("is English throughout: the card's words, the error's and where to look", async () => {
    await readIn("de");

    const locale: Record<string, string> = readDashboardLocale("de");
    const notAKey: string = "Couldn't read the review harness. {{error}}";

    expect(locale[notAKey]).toBeUndefined();

    const result: RenderResult = render(
      <div>
        <p data-testid="english">
          <ErrorSentence template={notAKey} error={WITH_REFERENCE} />
        </p>
        <p data-testid="german">
          <ErrorSentence template={WHO_IS_TOLD} error={WITH_REFERENCE} />
        </p>
      </div>,
    );

    const english: HTMLElement = result.getByTestId("english");

    expect(within(english).getByTestId("error-where-to-look").textContent).toBe(
      `${UnexplainedErrorWords.adminWhereToLookWithReference} ${UnexplainedErrorWords.openHealth}`,
    );
    expect(english.textContent).toContain(UnexplainedErrorWords.serverWhy);

    const german: HTMLElement = result.getByTestId("german");

    expect(within(german).getByTestId("error-where-to-look").textContent).toBe(
      `${locale[UnexplainedErrorWords.adminWhereToLookWithReference]!} ${locale[UnexplainedErrorWords.openHealth]!}`,
    );

    await readIn("en");
  });
});

describe.each(["en", ...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
  test("the who-is-told sentence reads wholly in the language, the error's words its own", async () => {
    await readIn(language);

    const locale: Record<string, string> = readDashboardLocale(language);
    const template: string = locale[WHO_IS_TOLD]!;

    expect(template).toBeTruthy();
    expect(template).toContain("{{error}}");

    for (const entry of MESSAGES) {
      const { text, result } = drawn(entry.message);

      const words: string = joinSentences([
        locale[entry.why]!,
        locale[entry.next]!,
      ]);
      const reference: string =
        entry.message === WITH_REFERENCE ? REFERENCE : "";
      const whereToLook: string =
        entry.message === WITH_REFERENCE
          ? locale[UnexplainedErrorWords.adminWhereToLookWithReference]!
          : entry.message === UNEXPLAINED_ERROR_MESSAGES.server
            ? locale[UnexplainedErrorWords.adminWhereToLook]!
            : "";

      // The card's words, then why and next, in the sentence's place.
      const [before, after] = template.split("{{error}}") as [string, string];

      expect({
        language,
        message: entry.message,
        starts: text.startsWith(before.trim()),
      }).toEqual({
        language,
        message: entry.message,
        starts: true,
      });
      expect(text).toContain(words);
      expect(text.endsWith(after.trim())).toBe(true);

      if (reference) {
        expect(text).toContain(reference);
      }

      if (whereToLook) {
        expect(text).toContain(whereToLook);
        expect(text).toContain(locale[UnexplainedErrorWords.openHealth]!);

        // A line of its own after the card's whole sentence.
        const line: HTMLElement = result.getByTestId("error-where-to-look");
        const sentence: string = withoutIsolateMarks(
          (result.getByTestId("sentence").textContent || "").replace(
            line.textContent || "",
            "",
          ),
        ).trim();

        expect(result.getByTestId("sentence").lastElementChild).toBe(line);
        expect(sentence.endsWith(after.trim())).toBe(true);
        expect(sentence).not.toContain(whereToLook);
      }

      // Never the fixed English the error came as.
      expect(text).not.toContain(SERVER_DOWN_MESSAGE);
      expect(text).not.toContain(entry.message);

      if (language !== "en") {
        for (const sentence of ENGLISH_SENTENCES) {
          expect({ language, sentence, left: text.includes(sentence) }).toEqual(
            { language, sentence, left: false },
          );
        }

        expect(text).not.toContain("Couldn't work out who is told.");
      }

      result.unmount();
    }
  });
});
