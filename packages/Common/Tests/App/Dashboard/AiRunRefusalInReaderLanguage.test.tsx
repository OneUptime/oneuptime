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
 * A REFUSAL IN THE READER'S LANGUAGE (#7157's UI review).
 *
 * When an incident's or alert's own daily AI token limit stops a run, the
 * AI card says so in the reader's language. Pressing Try again (or
 * Investigate now) while the limit still stops it is refused by the
 * server in the very sentence the card says - "The Daily Incident AI Token
 * Limit is set to 0, ..." - which the Dashboard words in every language.
 * The refusal reads in the reader's language too, never English under a
 * German or an Arabic notice (describeAiRunRefusal). A refusal the
 * Dashboard does not word stays in the server's English, laid out by its
 * own first letter.
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
  "This incident's investigation is queued or running already.";

const OTHER_LANGUAGES: ReadonlyArray<string> = DASHBOARD_LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

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

  async function pressTryAgain(refusal: string): Promise<HTMLElement> {
    render(
      <AiRunFailureNotice
        title="The investigation stopped before it could report."
        events={[]}
        errorMessage={getRecordAiTokenLimitRunError("incident", {
          limitInTokens: 0,
          usedTokensToday: 0,
        })}
        onTryAgain={async (): Promise<void> => {
          throw new HTTPErrorResponse(400, { message: refusal }, {});
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
    refusal: string,
  ): Promise<HTMLElement> {
    postMock.mockImplementation(async (request: any) => {
      if (
        request.url.toString().endsWith("/ai-investigation/investigate-now")
      ) {
        return new HTTPErrorResponse(400, { message: refusal }, {});
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

  test("ar: an Investigate now refusal the Dashboard does not word stays English, laid out by its own first letter", async () => {
    await inLanguage("ar");

    const said: HTMLElement = await pressInvestigateNow("ar", UNWORDED_REFUSAL);

    expect(said).toHaveTextContent(UNWORDED_REFUSAL);
    expect(said).toHaveAttribute("dir", "auto");
  });
});
