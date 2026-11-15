import ErrorLine from "../../../../UI/Components/ErrorMessage/ErrorLine";
import {
  CHECK_NOT_WRITTEN_REFUSAL,
  CustomSqlRefusal,
} from "../../../../Types/DataObservability/DataCheckRefusals";
import { getRefusalText } from "../../../../Types/Exception/RefusalWithValues";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import { joinSentences } from "../../../../UI/Utils/SentenceSeparator";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
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
 * A CARD'S RED LINE (#7530): why what the reader asked for did not happen,
 * in their language either way. A failure nobody explained is
 * ErrorExplanation, what failed first; any other message is looked up in
 * the reader's language - a refusal with a value said around its value -
 * and otherwise drawn as it came, on a line of its own read the way its
 * words are.
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

const LANGUAGES: Array<string> = ["de", "fa", "ar", "ja"];
const TEST_ID: string = "card-error";
const CLASS_NAME: string = "break-words text-sm text-red-600";
const WHAT_FAILED: string = "The check was not written.";

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

function said(language: string, text: string): string {
  return language === "en" ? text : readDashboardLocale(language)[text] || text;
}

async function drawIn(
  language: string,
  message: string,
  options: { whatFailed?: string; as?: "div" | "p" } = {},
): Promise<HTMLElement> {
  await inLanguage(language);
  render(
    <ErrorLine
      message={message}
      whatFailed={
        options.whatFailed === undefined
          ? undefined
          : said(language, options.whatFailed)
      }
      as={options.as}
      className={CLASS_NAME}
      dataTestId={TEST_ID}
    />,
  );

  return screen.getByTestId(TEST_ID);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("a message somebody put into words", () => {
  test("on an English page: the message in a paragraph, exactly as it came", async () => {
    const line: HTMLElement = await drawIn(
      "en",
      "You do not have permission to create a check.",
    );

    expect(line.tagName).toBe("P");
    expect(line.textContent).toBe(
      "You do not have permission to create a check.",
    );
    expect(line).not.toHaveAttribute("dir");
    expect(line).toHaveClass("break-words", "text-sm", "text-red-600");
    expect(within(line).queryByTestId("error-explanation")).toBeNull();
  });

  test("a key of the locales reads in the page's language", async () => {
    for (const language of LANGUAGES) {
      const line: HTMLElement = await drawIn(language, CustomSqlRefusal.writes);

      expect(line.textContent).toBe(said(language, CustomSqlRefusal.writes));
      expect(line.textContent).not.toBe(CustomSqlRefusal.writes);
      expect(line).not.toHaveAttribute("dir");
      cleanup();
    }
  });

  test("a refusal with a value reads in the page's language, its value where the language puts it", async () => {
    const line: HTMLElement = await drawIn(
      "de",
      getRefusalText(CHECK_NOT_WRITTEN_REFUSAL, {
        reason: "no such column",
      }),
    );

    expect(withoutIsolateMarks(line.textContent || "")).toBe(
      said("de", CHECK_NOT_WRITTEN_REFUSAL.template).replace(
        "{{reason}}",
        "no such column",
      ),
    );
  });

  test.each(["fa", "ar"])(
    "on a %s page, English the language has no words for reads left to right, as wide as its words",
    async (language: string) => {
      const line: HTMLElement = await drawIn(
        language,
        "You do not have permission to create a check.",
      );

      expect(line).toHaveAttribute("dir", "ltr");
      expect(line).toHaveClass("w-fit", "max-w-full");
      expect(withoutIsolateMarks(line.textContent || "")).toBe(
        "You do not have permission to create a check.",
      );
    },
  );

  test.each([
    ["fa", "این قاعده را نمی‌توان به یک بررسی تبدیل کرد."],
    ["ar", "تعذر الاتصال بقاعدة البيانات."],
  ])(
    "on a %s page, a message in the page's own script reads the page's way",
    async (language: string, message: string) => {
      const line: HTMLElement = await drawIn(language, message);

      expect(line).not.toHaveAttribute("dir");
      expect(line.textContent).toBe(message);
    },
  );

  test("on a German page, a Persian message reads right to left", async () => {
    const message: string = "این قاعده را نمی‌توان به یک بررسی تبدیل کرد.";
    const line: HTMLElement = await drawIn("de", message);

    expect(line).toHaveAttribute("dir", "rtl");
    expect(withoutIsolateMarks(line.textContent || "")).toBe(message);
  });

  test("the line can be a div", async () => {
    const line: HTMLElement = await drawIn("en", "Promo code is invalid.", {
      as: "div",
    });

    expect(line.tagName).toBe("DIV");
  });
});

describe("a failure nobody explained", () => {
  test.each([
    [
      SERVER_DOWN_MESSAGE,
      UnexplainedErrorWords.serverDownWhy,
      UnexplainedErrorWords.serverDownNext,
    ],
    [
      UNEXPLAINED_ERROR_MESSAGES.server,
      UnexplainedErrorWords.serverWhy,
      UnexplainedErrorWords.serverNext,
    ],
    [
      UNEXPLAINED_ERROR_MESSAGES.unreachable,
      UnexplainedErrorWords.unreachableWhy,
      UnexplainedErrorWords.unreachableNext,
    ],
    [
      UNEXPLAINED_ERROR_MESSAGES.page,
      UnexplainedErrorWords.pageWhy,
      UnexplainedErrorWords.pageNext,
    ],
  ])(
    "%j: what failed, why and what to do next, in each language",
    async (message: string, why: string, next: string) => {
      for (const language of ["en", ...LANGUAGES]) {
        const line: HTMLElement = await drawIn(language, message, {
          whatFailed: WHAT_FAILED,
        });

        expect(line.tagName).toBe("P");
        expect(line).toHaveClass("text-sm", "text-red-600");
        expect(line).not.toHaveAttribute("dir");
        expect(within(line).getByTestId("error-what-failed")).toHaveTextContent(
          said(language, WHAT_FAILED),
        );
        expect(within(line).getByTestId("error-why-and-next").textContent).toBe(
          joinSentences([said(language, why), said(language, next)]),
        );
        expect(line.textContent).not.toContain(message);
        cleanup();
      }
    },
  );

  test("with no words for what failed, the first line says this did not finish", async () => {
    const line: HTMLElement = await drawIn("de", SERVER_DOWN_MESSAGE);

    expect(within(line).getByTestId("error-what-failed")).toHaveTextContent(
      said("de", UnexplainedErrorWords.didNotFinish),
    );
  });

  test("a server failure's reference is code, with a Copy button", async () => {
    const line: HTMLElement = await drawIn(
      "en",
      getUnexplainedServerErrorMessage("1f0c9a2b"),
      { whatFailed: WHAT_FAILED },
    );
    const reference: HTMLElement = within(line).getByTestId("error-reference");

    expect(within(reference).getByText("1f0c9a2b").tagName).toBe("CODE");
    expect(
      within(reference).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(line.textContent).not.toContain(
      getUnexplainedServerErrorMessage("1f0c9a2b"),
    );
  });
});
