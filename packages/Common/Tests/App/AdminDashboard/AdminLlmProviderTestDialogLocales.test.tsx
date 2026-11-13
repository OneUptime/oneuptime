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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import TestLlmProviderModal, {
  LlmProviderTestOutcome,
} from "../../../UI/Components/AI/TestLlmProviderModal";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { LLMProviderExchange } from "../../../Types/LLM/LLMProviderExchange";
import { createTranslator, Translator } from "../../../Types/Translator";
import API from "../../../UI/Utils/API/API";
import { drawLine, getDrawnText } from "../../Helpers/BidiLayout";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Admin Dashboard > Settings > Global LLM Providers > Test, in every
 * language.
 *
 * A global provider's Test opens the dialog a project's providers open
 * (TestLlmProviderModal), with what the test sent and what came back
 * folded under its verdict (LlmProviderExchanges). The Admin Dashboard
 * looks those words up in its own locale files, which had none of that
 * section's: an admin reading German read "Show request and response"
 * under a German headline (#7545). This renders the dialog with the Admin
 * Dashboard's locale files, one language at a time, for a test that failed
 * after two requests - one the provider refused, one nothing answered -
 * opens the section and reads it: every word as the Dashboard words it in
 * that language, none left in English. An Arabic page draws a request's
 * duration in Arabic, its figure read first. A test that passed, from a
 * server that said nothing about it, reads the dialog's own verdict
 * (TestLLMProvider) in the language too.
 *
 * The i18next instance reaches the dialog through I18nextProvider only;
 * installing it globally would leak a language into the other tests in
 * this worker.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const PROVIDER_ID: string = "33333333-3333-4333-8333-333333333333";

// The server's verdict: its own words, drawn as it sends them.
const VERDICT: string =
  "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key.";

const REFUSED: LLMProviderExchange = {
  method: "POST",
  url: "https://api.openai.com/v1/chat/completions",
  requestHeaders: { Authorization: "Bearer sk-p…1234" },
  requestBody: { model: "gpt-4o" },
  statusCode: 401,
  responseHeaders: { "x-request-id": "req_401" },
  responseBody: { error: { message: "Incorrect API key provided." } },
  durationMs: 87,
};

const UNANSWERED: LLMProviderExchange = {
  method: "POST",
  url: "http://llm.internal:8000/v1/chat/completions",
  requestHeaders: {},
  requestBody: { model: "chat-large" },
  error: "connection refused",
  durationMs: 5,
};

const DURATION: { one: string; other: string } = {
  one: "{{count}} ms",
  other: "{{count}} ms",
};

// Intl's short unit for a millisecond in Arabic, as Locales/ARABIC.md writes it.
const ARABIC_MILLISECONDS: string = "ملي ث";
const LATIN_LETTER: RegExp = /[A-Za-z]/;

// The dialog's verdict for a pass the server says nothing about (TestLLMProvider).
const OWN_VERDICT: string =
  "Connection successful. The LLM provider responded to a test prompt.";

// How a page read from the right draws `text`, from left to right.
function drawnFromTheRight(text: string): string {
  return getDrawnText(drawLine(text, "rtl"));
}

type Locale = Record<string, unknown>;

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

// An instance like the Admin Dashboard's: one language, English as the fallback.
async function adminInstance(code: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: code,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [code]: { translation: readLocale(code) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

interface SectionWords {
  title: string;
  headline: string;
  close: string;
  testAgain: string;
  show: string;
  hide: string;
  copyAll: string;
  intro: string;
  firstOfTwo: string;
  secondOfTwo: string;
  noResponse: string;
  duration: string;
  requestHeaders: string;
  requestBody: string;
  responseHeaders: string;
  responseBody: string;
}

// What the dialog says, through a translator: the reader's, or English's.
function wordsOf(translator: Translator): SectionWords {
  return {
    title: translator.translateText("Test LLM Provider") || "",
    headline: translator.translateText("Test failed") || "",
    close: translator.translateText("Close") || "",
    testAgain: translator.translateText("Test again") || "",
    show: translator.translateText("Show request and response") || "",
    hide: translator.translateText("Hide request and response") || "",
    copyAll: translator.translateText("Copy all") || "",
    intro:
      translator.translateText(
        "What was sent to your provider and what came back. API keys and cookies are masked.",
      ) || "",
    firstOfTwo: translator.translateTemplate(
      "Request {{number}} of {{total}}",
      {
        number: translator.formatNumber(1),
        total: translator.formatNumber(2),
      },
    ),
    secondOfTwo: translator.translateTemplate(
      "Request {{number}} of {{total}}",
      {
        number: translator.formatNumber(2),
        total: translator.formatNumber(2),
      },
    ),
    noResponse: translator.translateText("No response") || "",
    duration: translator.translatePlural(DURATION, REFUSED.durationMs),
    requestHeaders: translator.translateText("Request headers") || "",
    requestBody: translator.translateText("Request body") || "",
    responseHeaders: translator.translateText("Response headers") || "",
    responseBody: translator.translateText("Response body") || "",
  };
}

const ENGLISH: SectionWords = wordsOf(createTranslator(undefined, "en"));

// The label over a request's or an answer's headers or body.
function labelOver(block: HTMLElement, testId: string): string {
  return (
    within(block).getByTestId(testId).previousElementSibling?.textContent || ""
  );
}

// The dialog, read in a language: the section closed, then opened.
async function readDialogIn(code: string): Promise<{
  words: SectionWords;
  // All the dialog says once the section is open, the verdict among it.
  dialogText: string;
}> {
  const instance: i18n = await adminInstance(code);

  render(
    <I18nextProvider i18n={instance}>
      <TestLlmProviderModal llmProviderId={PROVIDER_ID} onClose={() => {}} />
    </I18nextProvider>,
  );

  await waitFor(() => {
    expect(
      screen.getByTestId("llm-provider-test").getAttribute("data-outcome"),
    ).toBe(LlmProviderTestOutcome.Failed);
  });

  const modal: HTMLElement = screen.getByTestId("modal");
  const toggle: HTMLElement = screen.getByTestId(
    "llm-provider-exchanges-toggle",
  );
  const show: string = toggle.textContent?.trim() || "";

  fireEvent.click(toggle);

  const section: HTMLElement = screen.getByTestId("llm-provider-exchanges");
  const blocks: Array<HTMLElement> = within(section).getAllByTestId(
    "llm-provider-exchange",
  );
  const [refused, unanswered] = blocks as [HTMLElement, HTMLElement];

  expect(blocks).toHaveLength(2);

  return {
    words: {
      title: within(modal).getByTestId("modal-title").textContent || "",
      // The alert's headline, over the server's verdict.
      headline:
        screen
          .getByTestId("llm-provider-test-result")
          .querySelector(".font-semibold")?.textContent || "",
      close:
        within(modal).getByTestId("modal-footer-close-button").textContent ||
        "",
      testAgain:
        within(modal).getByTestId("llm-provider-test-again").textContent || "",
      show: show,
      hide: toggle.textContent?.trim() || "",
      copyAll:
        within(section)
          .getAllByRole("button")
          .find((button: HTMLElement): boolean => {
            return button !== toggle;
          })
          ?.textContent?.trim() || "",
      intro: section.querySelector("p")?.textContent || "",
      firstOfTwo: refused.querySelector("span")?.textContent || "",
      secondOfTwo: unanswered.querySelector("span")?.textContent || "",
      noResponse:
        within(unanswered).getByTestId("llm-provider-exchange-status")
          .textContent || "",
      duration:
        within(refused).getByTestId("llm-provider-exchange-status")
          .nextElementSibling?.textContent || "",
      requestHeaders: labelOver(
        refused,
        "llm-provider-exchange-request-headers",
      ),
      requestBody: labelOver(refused, "llm-provider-exchange-request-body"),
      responseHeaders: labelOver(
        refused,
        "llm-provider-exchange-response-headers",
      ),
      responseBody: labelOver(refused, "llm-provider-exchange-response-body"),
    },
    dialogText: modal.textContent || "",
  };
}

// A test that passed, from a server that said nothing about it.
function passedWithNoWord(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    { exchanges: [], supportsToolCalling: true },
    {},
  );
}

// The verdict the dialog shows in a language: its headline and its words.
async function readVerdictIn(code: string): Promise<string> {
  const instance: i18n = await adminInstance(code);

  render(
    <I18nextProvider i18n={instance}>
      <TestLlmProviderModal llmProviderId={PROVIDER_ID} onClose={() => {}} />
    </I18nextProvider>,
  );

  await waitFor(() => {
    expect(
      screen.getByTestId("llm-provider-test").getAttribute("data-outcome"),
    ).toBe(LlmProviderTestOutcome.Passed);
  });

  return withoutIsolateMarks(
    screen.getByTestId("llm-provider-test-result").textContent || "",
  );
}

describe("Settings > Global LLM Providers: the Test dialog's request and response in every language", () => {
  let fetchMock: MockFunction;

  beforeEach(() => {
    fetchMock = getJestMockFunction();
    fetchMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message: VERDICT,
          exchanges: [REFUSED, UNANSWERED] as unknown as Array<JSONObject>,
        },
        {},
      ) as never,
    );

    jest
      .spyOn(API, "fetch")
      .mockImplementation(fetchMock as unknown as typeof API.fetch);
    jest.spyOn(API, "getFriendlyMessage").mockImplementation((err: unknown) => {
      return err instanceof HTTPErrorResponse ? err.message : String(err);
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("English shows the dialog's own words", async () => {
    const { words } = await readDialogIn("en");

    expect(words).toEqual(ENGLISH);
    expect(words.show).toBe("Show request and response");
    expect(words.firstOfTwo).toBe("Request 1 of 2");
    expect(words.duration).toBe("87 ms");
  });

  test("German shows the section as the Dashboard's German says it", async () => {
    const { words } = await readDialogIn("de");

    expect(words.show).toBe("Anfrage und Antwort anzeigen");
    expect(words.hide).toBe("Anfrage und Antwort ausblenden");
    expect(words.firstOfTwo).toBe("Anfrage 1 von 2");
    expect(words.noResponse).toBe("Keine Antwort");
  });

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s shows every word of the dialog and its request and response as the Dashboard words it, none in English",
    async (code: string) => {
      const { words, dialogText } = await readDialogIn(code);
      const dashboard: SectionWords = wordsOf(dashboardTranslator(code));

      expect({ code, words }).toEqual({ code, words: dashboard });

      // What the Dashboard words otherwise than English, nowhere in English.
      const leftInEnglish: Array<string> = (
        Object.keys(ENGLISH) as Array<keyof SectionWords>
      )
        .filter((key: keyof SectionWords): boolean => {
          return dashboard[key] !== ENGLISH[key];
        })
        .map((key: keyof SectionWords): string => {
          return ENGLISH[key];
        })
        .filter((english: string): boolean => {
          return dialogText.includes(english);
        });

      expect({ code, leftInEnglish }).toEqual({ code, leftInEnglish: [] });
    },
  );

  /*
   * A duration drawn on its own reads Intl's short unit in Arabic
   * (Locales/ARABIC.md): the figure is read first, where "87 ms" was drawn
   * "ms 87" from the right.
   */
  test("Arabic draws a request's duration in Arabic, its figure read first from the right", async () => {
    const { words } = await readDialogIn("ar");

    expect(words.duration).toBe(`87 ${ARABIC_MILLISECONDS}`);
    expect(words.duration).not.toMatch(LATIN_LETTER);
    expect(drawnFromTheRight(words.duration).endsWith("87")).toBe(true);
    // The English it drew before, laid out from the right.
    expect(drawnFromTheRight("87 ms")).toBe("ms 87");
  });

  test("English reads the dialog's own verdict for a pass the server says nothing about", async () => {
    fetchMock.mockResolvedValue(passedWithNoWord() as never);

    expect(await readVerdictIn("en")).toContain(OWN_VERDICT);
  });

  test.each([...ADMIN_DASHBOARD_LANGUAGES])(
    "%s reads the dialog's own verdict for a pass the server says nothing about as the Dashboard words it",
    async (code: string) => {
      fetchMock.mockResolvedValue(passedWithNoWord() as never);

      const shown: string = await readVerdictIn(code);
      const worded: string =
        dashboardTranslator(code).translateText(OWN_VERDICT) || "";

      expect({
        code,
        worded: worded !== OWN_VERDICT,
        shown: shown.includes(worded),
        english: shown.includes(OWN_VERDICT),
      }).toEqual({ code, worded: true, shown: true, english: false });
    },
  );
});
