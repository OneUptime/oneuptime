/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const postMock: MockFunction = getJestMockFunction();

// The server's words, as the Dashboard reads them off a refusal.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return err instanceof Error
          ? err.message
          : String((err as { message?: string })?.message || "");
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "33333333-3333-4333-8333-333333333333" };
      },
    },
  };
});

import AiRunFailureNotice from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureNotice";
import { describeAiRunRefusal } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AiRunFailureWords";
import InvestigationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  AI_RUN_REFUSALS,
  AiRunRefusalCode,
} from "../../../Types/AI/AiRunRefusal";
import {
  getRecordAiTokenLimitMessage,
  getRecordAiTokenLimitRunError,
  RECORD_AI_TOKEN_LIMIT_KINDS,
  RecordAiTokenLimitKind,
} from "../../../Types/AI/RecordAiTokenLimit";
import { Translator } from "../../../Types/Translator";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A REFUSAL IN THE READER'S LANGUAGE (#7157's UI review, #7359).
 *
 * Pressing Try again or Investigate now on an AI card can be refused: AI
 * is off, there is no LLM provider, the investigation is running already,
 * a limit stops it. The server answers with its English sentence and the
 * refusal's code beside it (Types/AI/AiRunRefusal), and the card says the
 * code's sentence in the reader's language - never English under a
 * German or an Arabic notice (describeAiRunRefusal). Every code is worded
 * in every language. A refusal without a code (a 403, an older server) is
 * worded by its sentence when the Dashboard words it - a record's own
 * daily AI token limit says the same sentence on the card as in the
 * refusal - and one the Dashboard does not word stays in the server's
 * English, laid out by its own first letter.
 */

const EN: Record<string, string> = readDashboardLocale("en");

// Every refusal a record's limit gives: paused (a limit of 0) and used up.
const RECORD_LIMIT_REFUSALS: ReadonlyArray<{
  name: string;
  message: string;
}> = RECORD_AI_TOKEN_LIMIT_KINDS.flatMap(
  (kind: RecordAiTokenLimitKind): Array<{ name: string; message: string }> => {
    return [
      {
        name: `${kind} paused`,
        message: getRecordAiTokenLimitMessage(kind, { limitInTokens: 0 }),
      },
      {
        name: `${kind} used up`,
        message: getRecordAiTokenLimitMessage(kind, { limitInTokens: 500 }),
      },
    ];
  },
);

// A refusal no Dashboard key words: the server's English, as it came.
const UNWORDED_REFUSAL: string =
  "The investigation could not start: the moon is full tonight.";

const REFUSAL_CODES: ReadonlyArray<AiRunRefusalCode> =
  Object.values(AiRunRefusalCode);

const OTHER_LANGUAGES: ReadonlyArray<string> = DASHBOARD_LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

describe("describeAiRunRefusal by the refusal's code (#7359)", () => {
  test("every refusal code's sentence is a key of the Dashboard's English", () => {
    for (const code of REFUSAL_CODES) {
      expect({ code, english: EN[AI_RUN_REFUSALS[code]] }).toEqual({
        code,
        english: AI_RUN_REFUSALS[code],
      });
    }
  });

  test.each(OTHER_LANGUAGES)(
    "%s: every refusal code is worded, and the card says its words",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const words: Record<string, string> = readDashboardLocale(language);

      for (const code of REFUSAL_CODES) {
        const sentence: string = AI_RUN_REFUSALS[code];

        expect({
          code,
          worded: isWordedInDashboardLocale(sentence, language),
        }).toEqual({ code, worded: true });
        expect({
          code,
          said: describeAiRunRefusal(sentence, translator, code),
        }).toEqual({ code, said: words[sentence] });
      }
    },
  );

  test("English says each code's sentence as the server wrote it", () => {
    const translator: Translator = dashboardTranslator("en");

    for (const code of REFUSAL_CODES) {
      expect(
        describeAiRunRefusal(AI_RUN_REFUSALS[code], translator, code),
      ).toBe(AI_RUN_REFUSALS[code]);
    }
  });

  test("the code says which sentence, whatever English came beside it (an older server's words)", () => {
    const words: Record<string, string> = readDashboardLocale("de");

    expect(
      describeAiRunRefusal(
        "AI is turned off for this project (Project Settings → AI → AI Features).",
        dashboardTranslator("de"),
        AiRunRefusalCode.AiOff,
      ),
    ).toBe(words[AI_RUN_REFUSALS[AiRunRefusalCode.AiOff]]);
  });

  test("without a code, a sentence the Dashboard words - a 403's - is worded by its text", () => {
    const sentence: string =
      AI_RUN_REFUSALS[AiRunRefusalCode.IncidentTryAgainNotAllowed];

    for (const language of OTHER_LANGUAGES) {
      expect(
        describeAiRunRefusal(sentence, dashboardTranslator(language)),
      ).toBe(readDashboardLocale(language)[sentence]);
    }
  });
});

describe("describeAiRunRefusal", () => {
  test("every refusal a record's limit gives is a key of the Dashboard's English", () => {
    for (const refusal of RECORD_LIMIT_REFUSALS) {
      expect({ refusal: refusal.name, english: EN[refusal.message] }).toEqual({
        refusal: refusal.name,
        english: refusal.message,
      });
    }
  });

  test.each(OTHER_LANGUAGES)(
    "%s: each refusal of a record's limit reads in the reader's language",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const words: Record<string, string> = readDashboardLocale(language);

      for (const refusal of RECORD_LIMIT_REFUSALS) {
        expect({
          refusal: refusal.name,
          worded: isWordedInDashboardLocale(refusal.message, language),
        }).toEqual({ refusal: refusal.name, worded: true });

        const said: string = describeAiRunRefusal(refusal.message, translator);

        expect(said).toBe(words[refusal.message]);
        expect(said).not.toBe(refusal.message);
      }
    },
  );

  test("English reads the server's sentence as it came", () => {
    const translator: Translator = dashboardTranslator("en");

    for (const refusal of RECORD_LIMIT_REFUSALS) {
      expect(describeAiRunRefusal(refusal.message, translator)).toBe(
        refusal.message,
      );
    }
  });

  // Negative control: a sentence no language words is left as it came.
  test.each(DASHBOARD_LANGUAGES)(
    "%s: a refusal the Dashboard does not word stays in the server's English",
    (language: string) => {
      expect(EN[UNWORDED_REFUSAL]).toBeUndefined();
      expect(
        describeAiRunRefusal(UNWORDED_REFUSAL, dashboardTranslator(language)),
      ).toBe(UNWORDED_REFUSAL);
    },
  );
});

describe("on the AI card, in German and in Arabic", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000004",
  );
  const SUBJECT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const DE: Record<string, string> = readDashboardLocale("de");
  const AR: Record<string, string> = readDashboardLocale("ar");

  function wordsOf(language: string): Record<string, string> {
    return language === "de" ? DE : AR;
  }

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      resources: { de: { translation: DE }, ar: { translation: AR } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  beforeEach(() => {
    postMock.mockReset();
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue({ isAllowed: true });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  async function inLanguage(language: string): Promise<void> {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage(language);
    });
  }

  async function pressTryAgain(
    refusal: string | JSONObject,
  ): Promise<HTMLElement> {
    render(
      <AiRunFailureNotice
        title="The investigation stopped before it could report."
        events={[]}
        errorMessage={getRecordAiTokenLimitRunError("incident", {
          limitInTokens: 0,
          usedTokensToday: 0,
        })}
        onTryAgain={async (): Promise<void> => {
          throw new HTTPErrorResponse(
            400,
            typeof refusal === "string" ? { message: refusal } : refusal,
            {},
          );
        }}
        testId="investigation-error"
      />,
    );

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("investigation-error-try-again"));
    });

    return screen.getByTestId("investigation-error-try-again-error");
  }

  test.each([
    { language: "de", refusal: RECORD_LIMIT_REFUSALS[0]! },
    { language: "de", refusal: RECORD_LIMIT_REFUSALS[3]! },
    { language: "ar", refusal: RECORD_LIMIT_REFUSALS[1]! },
    { language: "ar", refusal: RECORD_LIMIT_REFUSALS[2]! },
  ])(
    "$language: Try again refused by the $refusal.name limit says it in the reader's language",
    async (data: {
      language: string;
      refusal: { name: string; message: string };
    }) => {
      await inLanguage(data.language);

      const said: HTMLElement = await pressTryAgain(data.refusal.message);

      expect(said).toHaveAttribute("role", "alert");
      expect(said).toHaveTextContent(
        wordsOf(data.language)[data.refusal.message]!,
      );
      expect(said.textContent).not.toContain("Token Limit");
      expect(said).toHaveAttribute("dir", "auto");
    },
  );

  /*
   * #7359: the server's answer carries the code beside its English: the
   * card says the code's sentence, in German and in Arabic.
   */
  test.each([
    { language: "de", code: AiRunRefusalCode.NoProviderToInvestigate },
    { language: "de", code: AiRunRefusalCode.IncidentInvestigationRunning },
    { language: "ar", code: AiRunRefusalCode.NoProviderToInvestigate },
    { language: "ar", code: AiRunRefusalCode.IncidentInvestigationRunning },
  ])(
    "$language: Try again refused with $code says it in the reader's language",
    async (data: { language: string; code: AiRunRefusalCode }) => {
      await inLanguage(data.language);

      const english: string = AI_RUN_REFUSALS[data.code];
      const said: HTMLElement = await pressTryAgain({
        message: english,
        refusalCode: data.code,
      });

      expect(said).toHaveAttribute("role", "alert");
      expect(said).toHaveTextContent(wordsOf(data.language)[english]!);
      expect(said.textContent).not.toContain(english);
      expect(said.textContent).not.toMatch(/\b(?:project|investigation)\b/);
      expect(said).toHaveAttribute("dir", "auto");
    },
  );

  /*
   * The card reads the code, not only the English: a server whose
   * sentence was reworded since (here Investigate now's words before
   * #7359) is still said in the reader's language, by the code beside it.
   */
  test.each([
    {
      language: "de",
      code: AiRunRefusalCode.NoProviderToInvestigate,
      english:
        "This project has no LLM provider OneUptime AI can use (Project Settings → AI → LLM Providers).",
    },
    {
      language: "ar",
      code: AiRunRefusalCode.AiOff,
      english:
        "AI is turned off for this project (Project Settings → AI → AI Features).",
    },
  ])(
    "$language: Try again says the code's words whatever English came beside it",
    async (data: {
      language: string;
      code: AiRunRefusalCode;
      english: string;
    }) => {
      await inLanguage(data.language);

      // Not a sentence the Dashboard words by its text.
      expect(EN[data.english]).toBeUndefined();

      const said: HTMLElement = await pressTryAgain({
        message: data.english,
        refusalCode: data.code,
      });

      expect(said).toHaveTextContent(
        wordsOf(data.language)[AI_RUN_REFUSALS[data.code]]!,
      );
      expect(said.textContent).not.toContain(data.english);
    },
  );

  test.each(["de", "ar"])(
    "%s: a code this Dashboard does not know (a newer server's) says the server's English",
    async (language: string) => {
      await inLanguage(language);

      const said: HTMLElement = await pressTryAgain({
        message: UNWORDED_REFUSAL,
        refusalCode: "moon_is_full",
      });

      expect(said).toHaveTextContent(UNWORDED_REFUSAL);
    },
  );

  test.each(["de", "ar"])(
    "%s: a refusal the Dashboard does not word stays in the server's English, laid out by its own first letter",
    async (language: string) => {
      await inLanguage(language);

      const said: HTMLElement = await pressTryAgain(UNWORDED_REFUSAL);

      expect(said).toHaveTextContent(UNWORDED_REFUSAL);
      expect(said).toHaveAttribute("dir", "auto");
    },
  );

  function waitingResponse(): HTTPResponse<JSONObject> {
    return new HTTPResponse<JSONObject>(
      200,
      {
        run: null,
        notInvestigatedReason: null,
        waitingInvestigation: {
          waitUntil: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
          waitMinutes: 10,
          canStartNow: true,
        },
        events: [],
        analysisMarkdown: null,
        analysisTldr: null,
        isAnalysisPending: false,
        evidence: [],
        references: [],
        clusterAccess: [],
      },
      {},
    );
  }

  async function pressInvestigateNow(
    language: string,
    refusal: string | JSONObject,
  ): Promise<HTMLElement> {
    postMock.mockImplementation(async (request: any) => {
      if (
        request.url.toString().endsWith("/ai-investigation/investigate-now")
      ) {
        return new HTTPErrorResponse(
          400,
          typeof refusal === "string" ? { message: refusal } : refusal,
          {},
        );
      }

      return waitingResponse();
    });

    render(
      <InvestigationPanel subjectType="incident" subjectId={SUBJECT_ID} />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: wordsOf(language)["Investigate now"]!,
      }),
    );

    return await screen.findByTestId("investigate-now-error");
  }

  test.each([
    { language: "de", refusal: RECORD_LIMIT_REFUSALS[0]! },
    { language: "ar", refusal: RECORD_LIMIT_REFUSALS[1]! },
  ])(
    "$language: Investigate now refused by the $refusal.name limit says it in the reader's language",
    async (data: {
      language: string;
      refusal: { name: string; message: string };
    }) => {
      await inLanguage(data.language);

      const said: HTMLElement = await pressInvestigateNow(
        data.language,
        data.refusal.message,
      );

      expect(said).toHaveAttribute("role", "alert");
      expect(said).toHaveTextContent(
        wordsOf(data.language)[data.refusal.message]!,
      );
      expect(said.textContent).not.toContain("Token Limit");
    },
  );

  test.each([
    { language: "de", code: AiRunRefusalCode.NoProviderToInvestigate },
    { language: "de", code: AiRunRefusalCode.AlreadyInvestigated },
    { language: "ar", code: AiRunRefusalCode.NoProviderToInvestigate },
    { language: "ar", code: AiRunRefusalCode.AlreadyInvestigated },
  ])(
    "$language: Investigate now refused with $code says it in the reader's language",
    async (data: { language: string; code: AiRunRefusalCode }) => {
      await inLanguage(data.language);

      const english: string = AI_RUN_REFUSALS[data.code];
      const said: HTMLElement = await pressInvestigateNow(data.language, {
        message: english,
        refusalCode: data.code,
      });

      expect(said).toHaveAttribute("role", "alert");
      expect(said).toHaveTextContent(wordsOf(data.language)[english]!);
      expect(said.textContent).not.toContain(english);
    },
  );

  test.each([
    {
      language: "de",
      code: AiRunRefusalCode.ProjectDailyLimitReached,
      english:
        "This project has reached its own daily AI limit. It resets at midnight UTC.",
    },
    {
      language: "ar",
      code: AiRunRefusalCode.NoProviderToInvestigate,
      english:
        "This project has no LLM provider OneUptime AI can use (Project Settings → AI → LLM Providers).",
    },
  ])(
    "$language: Investigate now says the code's words whatever English came beside it",
    async (data: {
      language: string;
      code: AiRunRefusalCode;
      english: string;
    }) => {
      await inLanguage(data.language);

      expect(EN[data.english]).toBeUndefined();

      const said: HTMLElement = await pressInvestigateNow(data.language, {
        message: data.english,
        refusalCode: data.code,
      });

      expect(said).toHaveTextContent(
        wordsOf(data.language)[AI_RUN_REFUSALS[data.code]]!,
      );
      expect(said.textContent).not.toContain(data.english);
    },
  );

  test("ar: an Investigate now refusal the Dashboard does not word stays English, laid out by its own first letter", async () => {
    await inLanguage("ar");

    const said: HTMLElement = await pressInvestigateNow("ar", UNWORDED_REFUSAL);

    expect(said).toHaveTextContent(UNWORDED_REFUSAL);
    expect(said).toHaveAttribute("dir", "auto");
  });
});
