import DocsAIReader from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  ASK_AI_HOW_DO_I_QUESTIONS,
  ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED,
  AskAiHowDoIQuestion,
} from "./AskAiHowDoIQuestions";
import { AIDocsSearchHit } from "Common/Server/Utils/AI/Docs/AIDocsLibrary";
import DashboardPageFinder, {
  AIDashboardPage,
} from "Common/Server/Utils/AI/Docs/DashboardPageFinder";
import { describe, expect, jest, test } from "@jest/globals";
import path from "path";

/*
 * THE "HOW DO I...?" LIST, ANSWERED OFFLINE (issue #6828).
 *
 * Ask AI answers a question about OneUptime from the docs it finds with
 * search_docs, and ends at the page find_dashboard_page finds. Without a
 * model this holds the two searches to the list in AskAiHowDoIQuestions:
 * the question as asked finds the page that answers it among the first
 * results the model is shown, in English, German and Persian, and the
 * Dashboard page is found by its name, at the route its button opens.
 */

jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const nodePath: typeof path = jest.requireActual("path") as typeof path;
  const root: string = nodePath.resolve(__dirname, "../../../FeatureSet/Docs");

  return {
    ContentPath: nodePath.join(root, "Content"),
    StaticPath: nodePath.join(root, "Static"),
    ViewsPath: nodePath.join(root, "Views"),
  };
});

// As many results as search_docs hands the model by default.
const SHOWN_RESULTS: number = 6;

const NAV_PAGES: Set<string> = new Set<string>(
  (DocsNav as Array<NavGroup>).flatMap((group: NavGroup): Array<string> => {
    return (group.links as Array<NavLink>).map((link: NavLink): string => {
      return link.url.replace(/^\/docs\//, "");
    });
  }),
);

const reader: DocsAIReader = new DocsAIReader();

// The pages search_docs shows the model for `question`.
const shownPages: (
  question: string,
  language: string,
) => Promise<Array<string>> = async (
  question: string,
  language: string,
): Promise<Array<string>> => {
  const hits: Array<AIDocsSearchHit> = await reader.search({
    query: question,
    language,
    limit: SHOWN_RESULTS,
  });
  return hits.map((hit: AIDocsSearchHit): string => {
    return hit.page;
  });
};

const answeringPages: (entry: {
  docsPage: string;
  alsoAnswers?: Array<string> | undefined;
}) => Array<string> = (entry: {
  docsPage: string;
  alsoAnswers?: Array<string> | undefined;
}): Array<string> => {
  return [entry.docsPage, ...(entry.alsoAnswers || [])];
};

describe("Ask AI's how-do-I list", () => {
  test("holds about forty questions, each with a docs page that is in the docs", () => {
    expect(ASK_AI_HOW_DO_I_QUESTIONS.length).toBeGreaterThanOrEqual(40);

    for (const entry of [
      ...ASK_AI_HOW_DO_I_QUESTIONS,
      ...ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED,
    ]) {
      for (const page of answeringPages(entry)) {
        expect(NAV_PAGES.has(page)).toBe(true);
      }
    }
  });

  test.each(
    ASK_AI_HOW_DO_I_QUESTIONS.map(
      (
        entry: AskAiHowDoIQuestion,
      ): [string, Array<string>, string | undefined] => {
        return [entry.question, answeringPages(entry), entry.searchWords];
      },
    ),
  )(
    'search_docs shows a page that answers "%s" (%p)',
    async (
      question: string,
      pages: Array<string>,
      searchWords: string | undefined,
    ) => {
      const shown: Array<string> = await shownPages(
        searchWords || question,
        "en",
      );
      expect(
        shown.filter((page: string): boolean => {
          return pages.includes(page);
        }),
      ).not.toEqual([]);
    },
  );

  test.each(
    ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED.map(
      (entry: {
        language: string;
        question: string;
        docsPage: string;
        alsoAnswers?: Array<string> | undefined;
      }): [string, string, Array<string>] => {
        return [entry.language, entry.question, answeringPages(entry)];
      },
    ),
  )(
    'in %s, search_docs shows a page that answers "%s" (%p)',
    async (language: string, question: string, pages: Array<string>) => {
      const shown: Array<string> = await shownPages(question, language);
      expect(
        shown.filter((page: string): boolean => {
          return pages.includes(page);
        }),
      ).not.toEqual([]);
    },
  );

  test.each(
    ASK_AI_HOW_DO_I_QUESTIONS.filter((entry: AskAiHowDoIQuestion) => {
      return Boolean(entry.dashboardPage);
    }).map((entry: AskAiHowDoIQuestion) => {
      return [entry.dashboardPage!, entry.dashboardPath || ""];
    }),
  )(
    'find_dashboard_page opens "%s"',
    (dashboardPage: string, dashboardPath: string) => {
      const found: AIDashboardPage | undefined = DashboardPageFinder.find({
        query: dashboardPage,
        limit: 1,
        isBillingEnabled: true,
      })[0];

      expect(found?.title).toBe(dashboardPage);

      if (dashboardPath) {
        expect(found?.path.split(/[?#]/)[0]).toBe(dashboardPath);
      }
    },
  );
});
