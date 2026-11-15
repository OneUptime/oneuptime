import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";

/*
 * AN AI INSIGHT'S REFUSED ACTION, IN THE READER'S LANGUAGE (#8052).
 *
 * On an AI insight's page, Confirm, Dismiss, Resolve and Reopen look the
 * insight up first. When it is gone - deleted in another tab - or the
 * reader may not see it, the server refused with "AI insight not found (or
 * you do not have access to it)." and the red line above the buttons said
 * that English sentence on a German, Arabic or Persian page. The server
 * refuses with a code beside the sentence now, and the page says the
 * code's sentence in the reader's language - drawn from the right on a
 * page read from the right. An answer with no code is worded by its text
 * when the Dashboard words it, and said as the server wrote it otherwise.
 */

const INSIGHT_ID: string = "11111111-1111-4111-8111-111111111111";

const postMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;

jest.mock("react-router-dom", () => {
  return {
    __esModule: true,
    useParams: () => {
      return { id: INSIGHT_ID };
    },
  };
});

// The server's words, as the page reads them off a refusal.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return String(
          (err as { data?: { message?: string } })?.data?.message ||
            (err as { message?: string })?.message ||
            "",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve(buildInsight());
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 5 });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

import AIInsightViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index";
import InsightActionError, {
  describeInsightActionRefusal,
  readInsightActionRefusal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightActionError";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import {
  AI_RUN_REFUSALS,
  AiRunRefusalCode,
} from "../../../Types/AI/AiRunRefusal";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LANGUAGES: Array<string> = ["de", "ar", "fa"];
const LOCALES: Record<string, Record<string, string>> = {};
for (const language of LANGUAGES) {
  LOCALES[language] = readDashboardLocale(language);
}

const NOT_FOUND: string =
  AI_RUN_REFUSALS[AiRunRefusalCode.InsightNotFoundOrNoAccess];

let status: AIInsightStatus = AIInsightStatus.ActionRequired;

function buildInsight(): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title = "New exception: 401 in api";
  insight.insightType = AIInsightType.NewException;
  insight.severity = AIInsightSeverity.Medium;
  insight.detailMarkdown = "New exception detected";
  insight.occurrenceCount = 4;
  insight.status = status;
  return insight;
}

// The server's refusal of an action: its sentence, and its code if any.
function refusal(message: string, code?: AiRunRefusalCode): HTTPErrorResponse {
  return new HTTPErrorResponse(
    400,
    code ? { message, refusalCode: code } : { message },
    {},
  );
}

// Every write route refuses; the triage panel answers that there is none.
function refuseActionsWith(answer: HTTPErrorResponse): void {
  postMock.mockImplementation((args: any): Promise<unknown> => {
    const url: string = String(args.url);

    if (url.includes("/ai-insight/triage-run")) {
      return Promise.resolve(
        new HTTPResponse<JSONObject>(200, { run: null, events: [] }, {}),
      );
    }

    return Promise.resolve(answer);
  });
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

async function renderPage(): Promise<void> {
  render(<AIInsightViewPage {...({} as any)} />);
  await waitFor(() => {
    return expect(
      screen.getByText("New exception: 401 in api"),
    ).toBeInTheDocument();
  });
}

async function press(name: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

  return screen.findByTestId("ai-insight-action-error");
}

function textOf(element: Element): string {
  return withoutIsolateMarks(element.textContent || "");
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: LOCALES["de"]! },
      ar: { translation: LOCALES["ar"]! },
      fa: { translation: LOCALES["fa"]! },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  status = AIInsightStatus.ActionRequired;
  postMock.mockReset();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("a refused action on an insight that is gone, on the insight's page", () => {
  test.each(
    LANGUAGES.flatMap((language: string): Array<[string, string]> => {
      return [
        [language, "Confirm"],
        [language, "Dismiss"],
        [language, "Resolve"],
      ];
    }),
  )(
    "%s, %s: the red line says the refusal in the language, never the server's English",
    async (language: string, action: string) => {
      const words: Record<string, string> = LOCALES[language]!;
      refuseActionsWith(
        refusal(NOT_FOUND, AiRunRefusalCode.InsightNotFoundOrNoAccess),
      );

      await inLanguage(language);
      await renderPage();

      const line: HTMLElement = await press(words[action]!);

      expect(textOf(line)).toContain(words["Could not save your action"]!);
      expect(textOf(line)).toContain(words[NOT_FOUND]!);
      expect(textOf(line)).not.toContain("not found");
      expect(words[NOT_FOUND]).not.toBe(NOT_FOUND);
    },
  );

  test("Reopen, on a closed insight that went: the refusal in German", async () => {
    status = AIInsightStatus.Dismissed;
    refuseActionsWith(
      refusal(NOT_FOUND, AiRunRefusalCode.InsightNotFoundOrNoAccess),
    );

    await inLanguage("de");
    await renderPage();

    const line: HTMLElement = await press(LOCALES["de"]!["Reopen"]!);

    expect(textOf(line)).toContain(
      "KI-Einblick nicht gefunden (oder Sie haben keinen Zugriff darauf).",
    );
  });

  test("German: an insight someone resolved in another tab says so in German", async () => {
    refuseActionsWith(
      refusal(
        "This AI insight is already resolved and cannot be resolved again.",
        AiRunRefusalCode.InsightAlreadyResolved,
      ),
    );

    await inLanguage("de");
    await renderPage();

    const line: HTMLElement = await press(LOCALES["de"]!["Resolve"]!);

    expect(textOf(line)).toContain(
      "Dieser KI-Einblick ist bereits behoben und kann nicht erneut behoben werden.",
    );
  });

  test("the page says the code's sentence, whatever English came beside it", async () => {
    refuseActionsWith(
      refusal(
        "Insight 1111 is unavailable.",
        AiRunRefusalCode.InsightNotFoundOrNoAccess,
      ),
    );

    await inLanguage("fa");
    await renderPage();

    const line: HTMLElement = await press(LOCALES["fa"]!["Confirm"]!);

    expect(textOf(line)).toContain(LOCALES["fa"]![NOT_FOUND]!);
    expect(textOf(line)).not.toContain("unavailable");
  });

  test("English reads the sentence as the server wrote it", async () => {
    refuseActionsWith(
      refusal(NOT_FOUND, AiRunRefusalCode.InsightNotFoundOrNoAccess),
    );

    await inLanguage("en");
    await renderPage();

    const line: HTMLElement = await press("Confirm");

    expect(textOf(line)).toContain(NOT_FOUND);
  });

  test("an older server's refusal with no code is worded by its text", async () => {
    refuseActionsWith(refusal(NOT_FOUND));

    await inLanguage("ar");
    await renderPage();

    const line: HTMLElement = await press(LOCALES["ar"]!["Confirm"]!);

    expect(textOf(line)).toContain(LOCALES["ar"]![NOT_FOUND]!);
  });

  test("a refusal the Dashboard does not word stays as the server wrote it", async () => {
    refuseActionsWith(refusal("The moon is full tonight."));

    await inLanguage("de");
    await renderPage();

    const line: HTMLElement = await press(LOCALES["de"]!["Confirm"]!);

    expect(textOf(line)).toContain("The moon is full tonight.");
  });
});

describe("the line, read the way it is written", () => {
  test("ar: a worded refusal is the page's own way, an English one an isolate read from the left", () => {
    act(() => {
      void i18next.changeLanguage("ar");
    });

    render(
      <InsightActionError
        refusal={{
          message: NOT_FOUND,
          refusalCode: AiRunRefusalCode.InsightNotFoundOrNoAccess,
        }}
      />,
    );
    const worded: HTMLElement = screen.getByTestId("ai-insight-action-error");
    expect(textOf(worded)).toContain(LOCALES["ar"]![NOT_FOUND]!);
    expect(worded.querySelector('bdi[dir="ltr"]')).toBeNull();
    cleanup();

    render(
      <InsightActionError
        refusal={{ message: "The moon is full tonight.", refusalCode: null }}
      />,
    );
    const english: HTMLElement = screen.getByTestId("ai-insight-action-error");
    expect(english.querySelector('bdi[dir="ltr"]')).toHaveTextContent(
      "The moon is full tonight.",
    );
  });
});

describe("reading a refusal off the server's answer", () => {
  test("its message and its code", () => {
    expect(
      readInsightActionRefusal(
        refusal(NOT_FOUND, AiRunRefusalCode.InsightNotFoundOrNoAccess),
      ),
    ).toEqual({
      message: NOT_FOUND,
      refusalCode: AiRunRefusalCode.InsightNotFoundOrNoAccess,
    });
  });

  test("a code this version does not know is no code: the message is said", () => {
    expect(
      readInsightActionRefusal(
        new HTTPErrorResponse(
          400,
          { message: "Newer words.", refusalCode: "from_a_newer_server" },
          {},
        ),
      ),
    ).toEqual({ message: "Newer words.", refusalCode: null });
  });

  test("an error that is no answer of the server has no code", () => {
    expect(readInsightActionRefusal(new Error("Network down"))).toEqual({
      message: "Network down",
      refusalCode: null,
    });
  });

  test.each(LANGUAGES)(
    "%s: the code's sentence whatever English came beside it",
    (language: string) => {
      expect(
        describeInsightActionRefusal(
          {
            message: "Some older words.",
            refusalCode: AiRunRefusalCode.InsightNotFoundOrNoAccess,
          },
          dashboardTranslator(language),
        ),
      ).toBe(LOCALES[language]![NOT_FOUND]);
    },
  );
});
