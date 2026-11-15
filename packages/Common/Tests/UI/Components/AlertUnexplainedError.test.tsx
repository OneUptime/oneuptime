import Alert, { AlertType } from "../../../UI/Components/Alerts/Alert";
import {
  getUnexplainedServerErrorMessage,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import { joinSentences } from "../../../UI/Utils/SentenceSeparator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
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
 * AN ALERT WHOSE TITLE IS AN ERROR NOBODY EXPLAINED (#7537).
 *
 * About forty Dashboard cards show why a button failed as an Alert's
 * title, the answer of API.getFriendlyMessage. For a gateway's 502 that is
 * SERVER_DOWN_MESSAGE, no key in any language: the alert read "Error
 * connecting to server. Please try again in few minutes." in English on
 * every page, and a server failure's reference had no copy button. The
 * Alert draws such a title with ErrorInSentence now - why and what to do
 * next in the reader's language, the reference in code with Copy - and
 * every other title exactly as before.
 */

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

const LANGUAGES: Array<string> = ["de", "fa", "ja", "ar"];

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

function said(language: string, text: string): string {
  return language === "en" ? text : readDashboardLocale(language)[text] || text;
}

async function drawIn(language: string, title: string): Promise<HTMLElement> {
  await inLanguage(language);
  render(
    <Alert type={AlertType.DANGER} title={title} dataTestId="the-alert" />,
  );

  return screen.getByTestId("the-alert");
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

describe("an Alert's title that is an error nobody explained", () => {
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
    "%j says why and what to do next, in each language",
    async (message: string, why: string, next: string) => {
      for (const language of ["en", ...LANGUAGES]) {
        const alert: HTMLElement = await drawIn(language, message);
        const words: HTMLElement =
          within(alert).getByTestId("error-in-sentence");

        expect(words.textContent).toBe(
          joinSentences([said(language, why), said(language, next)]),
        );
        expect(alert.textContent).not.toContain(message);
        cleanup();
      }
    },
  );

  test("in German and in Persian, no English is left but the product's name and its command", async () => {
    for (const language of ["de", "fa"]) {
      const alert: HTMLElement = await drawIn(language, SERVER_DOWN_MESSAGE);
      const text: string = (alert.textContent || "").replace(
        /OneUptime|npm run doctor|oneuptime/g,
        "",
      );

      expect(text).not.toContain("Error connecting to server");

      if (language === "fa") {
        expect(text).not.toMatch(/[A-Za-z]/);
      }

      cleanup();
    }
  });

  test("a server failure's reference is code, with a Copy button", async () => {
    const alert: HTMLElement = await drawIn(
      "en",
      getUnexplainedServerErrorMessage("1f0c9a2b"),
    );
    const reference: HTMLElement = within(alert).getByTestId("error-reference");

    expect(within(reference).getByText("1f0c9a2b").tagName).toBe("CODE");
    expect(
      within(reference).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(alert.textContent).not.toContain(
      getUnexplainedServerErrorMessage("1f0c9a2b"),
    );
  });

  test("the alert stays an alert: its role and its type's colours", async () => {
    const alert: HTMLElement = await drawIn("en", SERVER_DOWN_MESSAGE);

    expect(alert).toHaveClass("bg-red-50");
  });
});

describe("any other title reads as before", () => {
  test("a message somebody wrote, in English", async () => {
    const alert: HTMLElement = await drawIn(
      "en",
      "You do not have permission to update this Monitor.",
    );

    expect(alert).toHaveTextContent(
      "You do not have permission to update this Monitor.",
    );
    expect(within(alert).queryByTestId("error-in-sentence")).toBeNull();
  });

  test("a key of the locales, in the page's language", async () => {
    const alert: HTMLElement = await drawIn("de", "Custom SQL may only read.");

    expect(alert).toHaveTextContent(said("de", "Custom SQL may only read."));
  });

  test("a message in another script, as it was written (#7536)", async () => {
    const alert: HTMLElement = await drawIn("de", "接続が拒否されました");

    expect(alert.textContent).toContain("接続が拒否されました");
  });
});
