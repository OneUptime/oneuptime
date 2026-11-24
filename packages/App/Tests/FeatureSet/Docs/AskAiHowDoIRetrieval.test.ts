import DocsAIReader from "../../../FeatureSet/Docs/Utils/AIDocsReader";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  ASK_AI_HOW_DO_I_QUESTIONS,
  ASK_AI_HOW_DO_I_QUESTIONS_IN_EVERY_LANGUAGE,
  ASK_AI_PAGE_CONTEXT_QUESTIONS,
  ASK_AI_QUESTIONS_BY_LANGUAGE,
  ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED,
  ASK_AI_WEBSITE_QUESTIONS,
  AskAiHowDoIQuestion,
  AskAiHowDoIQuestionTranslated,
  AskAiPageContextQuestion,
} from "./AskAiHowDoIQuestions";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  getPageContextPage,
  PageContextPage,
  RECORD_KIND_OF_PAGE_CONTEXT,
} from "Common/Server/Utils/AI/Chat/PageContextPage";
import { AIDocsSearchHit } from "Common/Server/Utils/AI/Docs/AIDocsLibrary";
import DashboardPageFinder, {
  AIDashboardPage,
} from "Common/Server/Utils/AI/Docs/DashboardPageFinder";
import DashboardRecordPageFinder from "Common/Server/Utils/AI/Docs/DashboardRecordPageFinder";
import { AIChatPageContextHelper } from "Common/Types/AI/AIChatPageContext";
import {
  AskAiRecordKind,
  AskAiRecordPage,
} from "Common/Types/AI/AskAiRecordPages";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, jest, test } from "@jest/globals";
import path from "path";

/*
 * THE "HOW DO I...?" LIST, ANSWERED OFFLINE (issue #6828).
 *
 * Ask AI answers a question about OneUptime from the docs it finds with
 * search_docs, and ends at the page find_dashboard_page finds. Without a
 * model this holds the two searches to the list in AskAiHowDoIQuestions:
 * the question as asked finds the page that answers it among the first
 * results the model is shown, in every docs language (#7875), and the
 * Dashboard page is found by its name, at the route its button opens.
 */

// Every question asked in a language other than English, with its language.
const TRANSLATED: Array<AskAiHowDoIQuestionTranslated> = [
  ...ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED,
  ...ASK_AI_WEBSITE_QUESTIONS,
  ...ASK_AI_HOW_DO_I_QUESTIONS_IN_EVERY_LANGUAGE,
  ...ASK_AI_QUESTIONS_BY_LANGUAGE,
];

/*
 * Questions search_docs does not show a page for in the six it hands the
 * model, each with why (#8335). This list only shrinks: a question it
 * finds fails its test until it is deleted here.
 */
// Empty since #8700 met Spanish's and Portuguese's "they" forms ("suscriben", "assinam").
const NOT_IN_THE_FIRST_SIX: Record<string, string> = {};

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
      ...TRANSLATED,
      ...ASK_AI_PAGE_CONTEXT_QUESTIONS,
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

  test("asks how to monitor a website in every docs language, and the same five questions in every one but English (#7875)", () => {
    const asked: (
      list: ReadonlyArray<AskAiHowDoIQuestionTranslated>,
    ) => Array<string> = (
      list: ReadonlyArray<AskAiHowDoIQuestionTranslated>,
    ): Array<string> => {
      return Array.from(
        new Set<string>(
          list.map((entry: AskAiHowDoIQuestionTranslated): string => {
            return entry.language;
          }),
        ),
      ).sort();
    };

    expect(asked(ASK_AI_WEBSITE_QUESTIONS)).toEqual(
      [...SUPPORTED_DOCS_LANGUAGE_CODES].sort(),
    );

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const own: Array<AskAiHowDoIQuestionTranslated> = TRANSLATED.filter(
        (entry: AskAiHowDoIQuestionTranslated): boolean => {
          return entry.language === language;
        },
      );

      expect({
        language,
        asked: own.length >= (language === "en" ? 1 : 4),
      }).toEqual({
        language,
        asked: true,
      });
    }

    // And about ten more in every one but English, as each asks them (#8335).
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        asked:
          ASK_AI_QUESTIONS_BY_LANGUAGE.filter(
            (entry: AskAiHowDoIQuestionTranslated): boolean => {
              return entry.language === language;
            },
          ).length >= (language === "en" ? 0 : 9),
      }).toEqual({ language, asked: true });
    }

    // Each question is asked once.
    const questions: Array<string> = TRANSLATED.map(
      (entry: AskAiHowDoIQuestionTranslated): string => {
        return `${entry.language} ${entry.question}`;
      },
    );
    expect(new Set<string>(questions).size).toBe(questions.length);
  });

  test.each(
    TRANSLATED.map(
      (
        entry: AskAiHowDoIQuestionTranslated,
      ): [string, string, Array<string>] => {
        return [entry.language, entry.question, answeringPages(entry)];
      },
    ),
  )(
    'in %s, search_docs shows a page that answers "%s" (%p)',
    async (language: string, question: string, pages: Array<string>) => {
      const shown: Array<string> = await shownPages(question, language);
      const answering: Array<string> = shown.filter((page: string): boolean => {
        return pages.includes(page);
      });
      const notYet: string | undefined =
        NOT_IN_THE_FIRST_SIX[`${language} ${question}`];

      if (notYet) {
        // Found now: delete it from NOT_IN_THE_FIRST_SIX.
        expect({ question, notYet, answering }).toEqual({
          question,
          notYet,
          answering: [],
        });
        return;
      }

      expect(answering).not.toEqual([]);
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

/*
 * QUESTIONS ASKED ON A PAGE (#7062, #7065), OFFLINE.
 *
 * Each is asked with the context its page sends. The server takes that
 * context as it is and names its page from its own catalogs, the docs
 * search finds the page that answers the question once the page's subject
 * is in its words, and the Go to button opens the page it should: on a
 * record, that record's own page.
 */

// The record kind a context's page is of, when it is one record's page.
const recordKindOf: (
  entry: AskAiPageContextQuestion,
) => AskAiRecordKind | undefined = (
  entry: AskAiPageContextQuestion,
): AskAiRecordKind | undefined => {
  return RECORD_KIND_OF_PAGE_CONTEXT[entry.pageContext.type];
};

describe("Ask AI's questions asked on a page", () => {
  test("ask on records, setup pages and a create form, each question once", () => {
    const questions: Array<string> = ASK_AI_PAGE_CONTEXT_QUESTIONS.map(
      (entry: AskAiPageContextQuestion): string => {
        return `${entry.where} ${entry.question}`;
      },
    );

    expect(new Set<string>(questions).size).toBe(questions.length);
    expect(
      ASK_AI_PAGE_CONTEXT_QUESTIONS.filter(
        (entry: AskAiPageContextQuestion): boolean => {
          return Boolean(recordKindOf(entry));
        },
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      ASK_AI_PAGE_CONTEXT_QUESTIONS.filter(
        (entry: AskAiPageContextQuestion): boolean => {
          return !recordKindOf(entry);
        },
      ).length,
    ).toBeGreaterThanOrEqual(5);
  });

  test.each(
    ASK_AI_PAGE_CONTEXT_QUESTIONS.map(
      (entry: AskAiPageContextQuestion): [string, AskAiPageContextQuestion] => {
        return [entry.where, entry];
      },
    ),
  )(
    "on %s, the context is one the server keeps whole, and it names the page as its menu does",
    (_where: string, entry: AskAiPageContextQuestion) => {
      // As the Dashboard sends it, through the API's own sanitizer.
      expect(
        AIChatPageContextHelper.sanitize(
          JSON.parse(JSON.stringify(entry.pageContext)) as JSONObject,
        ),
      ).toEqual({
        type: entry.pageContext.type,
        page: entry.pageContext.page,
        ...(entry.pageContext.entityId
          ? { entityId: entry.pageContext.entityId }
          : {}),
        ...(entry.pageContext.entityTitle
          ? { entityTitle: entry.pageContext.entityTitle }
          : {}),
      });

      const page: PageContextPage | null = getPageContextPage(
        entry.pageContext,
      );

      expect(page?.menuPath).toBe(entry.onPage);
    },
  );

  test.each(
    ASK_AI_PAGE_CONTEXT_QUESTIONS.map(
      (entry: AskAiPageContextQuestion): [string, string, string] => {
        return [entry.where, entry.question, entry.searchWords];
      },
    ),
  )(
    'on %s, search_docs shows a page that answers "%s" (searched as "%s")',
    async (_where: string, question: string, searchWords: string) => {
      const entry: AskAiPageContextQuestion =
        ASK_AI_PAGE_CONTEXT_QUESTIONS.find(
          (candidate: AskAiPageContextQuestion): boolean => {
            return candidate.question === question;
          },
        )!;
      const shown: Array<string> = await shownPages(searchWords, "en");

      expect(
        shown.filter((page: string): boolean => {
          return answeringPages(entry).includes(page);
        }),
      ).not.toEqual([]);
    },
  );

  test.each(
    ASK_AI_PAGE_CONTEXT_QUESTIONS.filter(
      (entry: AskAiPageContextQuestion): boolean => {
        return Boolean(entry.dashboardPage);
      },
    ).map((entry: AskAiPageContextQuestion): [string, string, string] => {
      return [entry.where, entry.dashboardPage!, entry.dashboardPath || ""];
    }),
  )(
    'on %s, find_dashboard_page opens "%s"',
    (where: string, dashboardPage: string, dashboardPath: string) => {
      const entry: AskAiPageContextQuestion =
        ASK_AI_PAGE_CONTEXT_QUESTIONS.find(
          (candidate: AskAiPageContextQuestion): boolean => {
            return candidate.where === where;
          },
        )!;
      const kind: AskAiRecordKind | undefined = recordKindOf(entry);

      // On a record, its own page: the one its menu names so.
      const found: AskAiRecordPage | AIDashboardPage | undefined = kind
        ? DashboardRecordPageFinder.find({
            kind,
            query: dashboardPage,
            limit: 1,
          })[0]
        : DashboardPageFinder.find({
            query: dashboardPage,
            limit: 1,
            isBillingEnabled: true,
          })[0];

      expect({ title: found?.title, path: found?.path }).toEqual({
        title: dashboardPage,
        path: dashboardPath,
      });
    },
  );
});
