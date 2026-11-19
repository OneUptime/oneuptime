import {
  ASK_AI_HOW_DO_I_QUESTIONS,
  ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED,
  ASK_AI_NOT_COVERED_QUESTIONS,
  ASK_AI_PAGE_CONTEXT_PROJECT,
  ASK_AI_PAGE_CONTEXT_QUESTIONS,
  AskAiHowDoIQuestion,
  AskAiHowDoIQuestionTranslated,
  AskAiPageContextQuestion,
} from "../Tests/FeatureSet/Docs/AskAiHowDoIQuestions";
import { RECORD_KIND_OF_PAGE_CONTEXT } from "Common/Server/Utils/AI/Chat/PageContextPage";
import {
  AskAiHowDoICase,
  AskAiSetupCase,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalGrades";
import { AskAiEvalProjectKind } from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalProject";
import { AskAiEvalSuite } from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalReport";
import {
  ASK_AI_SETUP_REQUESTS,
  SetupRequest,
} from "Common/Tests/Server/Utils/AI/AskAiSetupRequests";

/*
 * What `npm run ask-ai-eval` asks (#7246, #7066), from the two lists where
 * they are kept: Common's setup requests (Tests/Server/Utils/AI/
 * AskAiSetupRequests.ts), and the how-do-I questions beside the docs
 * (Tests/FeatureSet/Docs/AskAiHowDoIQuestions.ts) - the English ones, the
 * German and Persian ones, the ones the docs do not cover, and the ones
 * asked on a page, with that page's context (#7062, #7065). Each case has
 * an id by its place in its list (setup-1, how-do-i-1), so a run can name
 * the ones it asks again; the ones asked on a page come last, so the ids
 * before them stay theirs.
 */

export interface AskAiEvalCase {
  suite: AskAiEvalSuite;
  id: string;
  // The request or question, as the person types it.
  asked: string;
  // The project it is asked in, or the language.
  context: string;
  setup?: AskAiSetupCase | undefined;
  howDoI?: AskAiHowDoICase | undefined;
}

const PROJECT_KINDS: ReadonlyArray<string> =
  Object.values(AskAiEvalProjectKind);

export function getSetupCases(): Array<AskAiEvalCase> {
  return ASK_AI_SETUP_REQUESTS.map(
    (request: SetupRequest, index: number): AskAiEvalCase => {
      if (!PROJECT_KINDS.includes(request.project)) {
        throw new Error(
          `The setup request "${request.request}" is asked in a project the eval has no stub of: ${request.project}. Add it to AskAiEvalProject.`,
        );
      }

      const setup: AskAiSetupCase = {
        id: `setup-${index + 1}`,
        request: request.request,
        projectKind: request.project as unknown as AskAiEvalProjectKind,
        expected: request.expected,
        language: request.language || "en",
        ...(request.note ? { note: request.note } : {}),
      };

      return {
        suite: AskAiEvalSuite.Setup,
        id: setup.id,
        asked: setup.request,
        context: request.project,
        setup,
      };
    },
  );
}

export function getHowDoICases(): Array<AskAiEvalCase> {
  const cases: Array<AskAiHowDoICase> = [
    ...ASK_AI_HOW_DO_I_QUESTIONS.map(
      (question: AskAiHowDoIQuestion): Omit<AskAiHowDoICase, "id"> => {
        return {
          question: question.question,
          language: "en",
          docsPage: question.docsPage,
          alsoAnswers: question.alsoAnswers,
          dashboardPage: question.dashboardPage,
          dashboardPath: question.dashboardPath,
        };
      },
    ),
    ...ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED.map(
      (
        question: AskAiHowDoIQuestionTranslated,
      ): Omit<AskAiHowDoICase, "id"> => {
        return {
          question: question.question,
          language: question.language,
          docsPage: question.docsPage,
          alsoAnswers: question.alsoAnswers,
        };
      },
    ),
    ...ASK_AI_NOT_COVERED_QUESTIONS.map(
      (question: string): Omit<AskAiHowDoICase, "id"> => {
        return { question, language: "en", notCovered: true };
      },
    ),
    ...ASK_AI_PAGE_CONTEXT_QUESTIONS.map(
      (question: AskAiPageContextQuestion): Omit<AskAiHowDoICase, "id"> => {
        // On a record, the button must open that record's own page (#7065).
        const isOnRecord: boolean = Boolean(
          RECORD_KIND_OF_PAGE_CONTEXT[question.pageContext.type],
        );

        return {
          question: question.question,
          language: "en",
          docsPage: question.docsPage,
          alsoAnswers: question.alsoAnswers,
          dashboardPage: question.dashboardPage,
          dashboardPath: question.dashboardPath,
          ...(isOnRecord && question.dashboardPage
            ? { dashboardRecordId: question.pageContext.entityId }
            : {}),
          pageContext: question.pageContext,
          projectKind: ASK_AI_PAGE_CONTEXT_PROJECT,
        };
      },
    ),
  ].map((howDoI: Omit<AskAiHowDoICase, "id">, index: number) => {
    return { ...howDoI, id: `how-do-i-${index + 1}` };
  });

  // The questions asked on a page are the last ones, in their list's order.
  const firstOnAPage: number =
    cases.length - ASK_AI_PAGE_CONTEXT_QUESTIONS.length;

  return cases.map((howDoI: AskAiHowDoICase, index: number): AskAiEvalCase => {
    const onAPage: AskAiPageContextQuestion | undefined =
      ASK_AI_PAGE_CONTEXT_QUESTIONS[index - firstOnAPage];

    return {
      suite: AskAiEvalSuite.HowDoI,
      id: howDoI.id,
      asked: howDoI.question,
      context: howDoI.notCovered
        ? `${howDoI.language}, not covered`
        : onAPage
          ? `${howDoI.language}, on ${onAPage.where}`
          : howDoI.language,
      howDoI,
    };
  });
}

export function getAskAiEvalCases(
  suites: ReadonlyArray<AskAiEvalSuite>,
): Array<AskAiEvalCase> {
  return [
    ...(suites.includes(AskAiEvalSuite.Setup) ? getSetupCases() : []),
    ...(suites.includes(AskAiEvalSuite.HowDoI) ? getHowDoICases() : []),
  ];
}
