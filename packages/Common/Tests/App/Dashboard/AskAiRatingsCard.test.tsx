import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import AskAiRatingsCard, {
  ASK_AI_RATINGS_CARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AskAiRatingsCard";
import {
  ASK_AI_RATINGS_READERS,
  getAskAiSourceTitle,
  mayReadAskAiRatings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AskAiRatingsData";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  ASK_AI_RATINGS_ROUTE,
  AskAiProjectRatings,
  AskAiSourceOfNoProduct,
} from "../../../Types/AI/AskAiRatings";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * ASK AI ANSWERS ON AI RESULTS (#7365): a project's owners and admins see
 * how its Ask AI answers were rated in the last 90 days, and what the
 * answers rated down read - products, the docs, nothing - never a word of a
 * question or an answer: each conversation is private to its person. The
 * real card, through the Dashboard's i18next, with the server's answer
 * stood in for.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const RATINGS: AskAiProjectRatings = {
  sinceDays: 90,
  helpful: 18,
  notHelpful: 6,
  ratedDownDrewOn: [
    { source: ProductKey.Logs, answers: 3 },
    { source: ProductKey.Incidents, answers: 2 },
    { source: AskAiSourceOfNoProduct.Docs, answers: 1 },
    { source: AskAiSourceOfNoProduct.Nothing, answers: 1 },
  ],
};

const LATIN_DIGIT: RegExp = /[0-9]/;

let answer: HTTPResponse<JSONObject> | HTTPErrorResponse;
let urls: Array<string> = [];

const text: (element: HTMLElement) => string = (
  element: HTMLElement,
): string => {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
};

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
      fa: { translation: readLocale("fa") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  urls = [];
  answer = new HTTPResponse<JSONObject>(
    200,
    RATINGS as unknown as JSONObject,
    {},
  );
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(API, "get")
    .mockImplementation(
      async (
        request: unknown,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        urls.push(String((request as JSONObject)["url"]));
        return answer;
      },
    );
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await inLanguage("en");
});

describe("Ask AI Answers", () => {
  test("says how many rated answers were helpful, and what the ones rated down read, most first", async () => {
    render(<AskAiRatingsCard />);

    const headline: HTMLElement = await screen.findByTestId(
      "ask-ai-ratings-headline",
    );

    expect(text(headline)).toBe("18 of 24 rated answers were helpful.");
    expect(urls).toHaveLength(1);
    expect(urls[0]!.endsWith(ASK_AI_RATINGS_ROUTE)).toBe(true);

    expect(screen.getAllByTestId("ask-ai-ratings-source").map(text)).toEqual([
      "Logs3",
      "Incidents2",
      "OneUptime docs1",
      "No data read1",
    ]);
  });

  test("says the words stay private, before anything else", async () => {
    render(<AskAiRatingsCard />);

    await screen.findByTestId("ask-ai-ratings-headline");

    expect(
      screen.getByText(
        "How people in this project rated Ask AI's answers in the last 90 days. Each conversation is private to its person, so no question or answer is shown.",
      ),
    ).toBeInTheDocument();
  });

  test("with nothing rated yet, says when it will have something", async () => {
    answer = new HTTPResponse<JSONObject>(
      200,
      { sinceDays: 90, helpful: 0, notHelpful: 0, ratedDownDrewOn: [] },
      {},
    );

    render(<AskAiRatingsCard />);

    expect(text(await screen.findByTestId("ask-ai-ratings-none"))).toBe(
      "No answers rated yet. When people rate Ask AI's answers with a thumb, how they rated them shows up here.",
    );
    expect(screen.queryByTestId("ask-ai-ratings-headline")).toBeNull();
  });

  test("every answer helpful: no list of what went wrong, a line instead", async () => {
    answer = new HTTPResponse<JSONObject>(
      200,
      { sinceDays: 90, helpful: 4, notHelpful: 0, ratedDownDrewOn: [] },
      {},
    );

    render(<AskAiRatingsCard />);

    await screen.findByTestId("ask-ai-ratings-headline");
    expect(screen.queryAllByTestId("ask-ai-ratings-source")).toHaveLength(0);
    expect(screen.getByTestId("ask-ai-ratings-drew-on")).toHaveTextContent(
      "No answer was rated down.",
    );
  });

  test("a refusal or a failure says what failed, and offers to try again", async () => {
    answer = new HTTPErrorResponse(
      403,
      {
        message:
          "Only Project Owners and Project Admins see how Ask AI's answers were rated. Ask one of them, or ask for the Project Admin role.",
      },
      {},
    );

    render(<AskAiRatingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId(ASK_AI_RATINGS_CARD_TEST_ID)).toHaveTextContent(
        "Only Project Owners and Project Admins see how Ask AI's answers were rated.",
      );
    });
    expect(screen.queryByTestId("ask-ai-ratings-headline")).toBeNull();
  });

  test("in German, the card and the products the answers read are German", async () => {
    await inLanguage("de");
    render(<AskAiRatingsCard />);

    const headline: HTMLElement = await screen.findByTestId(
      "ask-ai-ratings-headline",
    );
    const german: Record<string, string> = readLocale("de");

    expect(text(headline)).toBe(
      german["{{helpful}} of {{count}} rated answers were helpful."]!.replace(
        "{{helpful}}",
        "18",
      ).replace("{{count}}", "24"),
    );
    expect(screen.getAllByTestId("ask-ai-ratings-source").map(text)).toEqual([
      `${german["Logs"]}3`,
      `${german["Incidents"]}2`,
      `${german["OneUptime docs"]}1`,
      `${german["No data read"]}1`,
    ]);
  });

  test("in Persian, every count is in Persian digits", async () => {
    await inLanguage("fa");
    render(<AskAiRatingsCard />);

    const headline: HTMLElement = await screen.findByTestId(
      "ask-ai-ratings-headline",
    );

    expect(text(headline)).toContain("۱۸");
    expect(text(headline)).toContain("۲۴");
    expect(LATIN_DIGIT.test(text(headline))).toBe(false);
    for (const source of screen.getAllByTestId("ask-ai-ratings-source")) {
      expect(LATIN_DIGIT.test(text(source))).toBe(false);
    }
  });
});

describe("who sees it", () => {
  test("the project's owners and admins, as the server asks", () => {
    expect(ASK_AI_RATINGS_READERS).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);

    for (const [permissions, mayRead] of [
      [[Permission.ProjectOwner], true],
      [[Permission.ProjectAdmin], true],
      [[Permission.ProjectMember], false],
      [[], false],
    ] as Array<[Array<Permission>, boolean]>) {
      PermissionGate.clearPermissionPropsCache();
      jest
        .spyOn(PermissionUtil, "getAllPermissions")
        .mockReturnValue(permissions);

      expect({ permissions, mayRead: mayReadAskAiRatings() }).toEqual({
        permissions,
        mayRead,
      });
      jest.restoreAllMocks();
    }
  });

  test("each source is named by the products menu's word, or the card's own", () => {
    expect(getAskAiSourceTitle(ProductKey.Logs)).toBe("Logs");
    expect(getAskAiSourceTitle(ProductKey.OnCall)).toBe("On-Call");
    expect(getAskAiSourceTitle(AskAiSourceOfNoProduct.Docs)).toBe(
      "OneUptime docs",
    );
    expect(getAskAiSourceTitle(AskAiSourceOfNoProduct.OtherData)).toBe(
      "Other OneUptime data",
    );
    expect(getAskAiSourceTitle(AskAiSourceOfNoProduct.Nothing)).toBe(
      "No data read",
    );
  });
});
