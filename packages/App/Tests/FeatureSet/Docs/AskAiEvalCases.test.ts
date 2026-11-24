import { pickCases, readSuites } from "../../../scripts/ask-ai-eval";
import {
  AskAiEvalCase,
  getAskAiEvalCases,
  getHowDoICases,
  getSetupCases,
} from "../../../scripts/ask-ai-eval-cases";
import {
  ASK_AI_HOW_DO_I_QUESTIONS,
  ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED,
  ASK_AI_NOT_COVERED_QUESTIONS,
  ASK_AI_PAGE_CONTEXT_QUESTIONS,
} from "./AskAiHowDoIQuestions";
import {
  AskAiEvalNamedRecord,
  AskAiEvalProject,
  AskAiEvalProjectKind,
  getAskAiEvalProject,
} from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalProject";
import { AskAiEvalSuite } from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalReport";
import { EvalUsageError } from "Common/Server/Utils/AI/Eval/EvalCommandLine";
import { ASK_AI_SETUP_REQUESTS } from "Common/Tests/Server/Utils/AI/AskAiSetupRequests";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What `npm run ask-ai-eval` asks (#7246, #7066): every setup request and
 * every how-do-I question of their lists, each once, with an id a run can
 * name, in the project or the language it is asked in.
 */

const DOCS_CONTENT: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

describe("the cases the eval asks", () => {
  test("every setup request, in the project its entry names", () => {
    const cases: Array<AskAiEvalCase> = getSetupCases();

    expect(cases).toHaveLength(ASK_AI_SETUP_REQUESTS.length);
    cases.forEach((evalCase: AskAiEvalCase, index: number) => {
      expect(evalCase.id).toBe(`setup-${index + 1}`);
      expect(evalCase.asked).toBe(ASK_AI_SETUP_REQUESTS[index]!.request);
      expect(Object.values(AskAiEvalProjectKind)).toContain(
        evalCase.setup!.projectKind,
      );
    });
    expect(
      cases
        .filter((evalCase: AskAiEvalCase) => {
          return evalCase.setup!.language !== "en";
        })
        .map((evalCase: AskAiEvalCase) => {
          return [evalCase.setup!.language, evalCase.asked];
        }),
    ).toEqual([
      [
        "de",
        "Überwache example.com und schick mir eine SMS, wenn es ausfällt.",
      ],
    ]);
  });

  test("every how-do-I question: in English, in German and Persian, the ones the docs do not cover, and the ones asked on a page", () => {
    const cases: Array<AskAiEvalCase> = getHowDoICases();

    expect(cases).toHaveLength(
      ASK_AI_HOW_DO_I_QUESTIONS.length +
        ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED.length +
        ASK_AI_NOT_COVERED_QUESTIONS.length +
        ASK_AI_PAGE_CONTEXT_QUESTIONS.length,
    );
    // The ones before them keep their ids: how-do-i-1 is still the first question.
    expect(cases[0]!.asked).toBe(ASK_AI_HOW_DO_I_QUESTIONS[0]!.question);
    expect(
      cases.filter((evalCase: AskAiEvalCase) => {
        return evalCase.howDoI!.notCovered;
      }),
    ).toHaveLength(ASK_AI_NOT_COVERED_QUESTIONS.length);
    expect(
      new Set(
        cases.map((evalCase: AskAiEvalCase) => {
          return evalCase.howDoI!.language;
        }),
      ),
    ).toEqual(new Set(["en", "de", "fa"]));
  });

  test("a question asked on a page carries its page, in the project whose records it names, and on a record expects that record's own button (#7062, #7065)", () => {
    const onAPage: Array<AskAiEvalCase> = getHowDoICases().filter(
      (evalCase: AskAiEvalCase) => {
        return Boolean(evalCase.howDoI!.pageContext);
      },
    );

    expect(onAPage).toHaveLength(ASK_AI_PAGE_CONTEXT_QUESTIONS.length);

    for (const evalCase of onAPage) {
      const howDoI: NonNullable<AskAiEvalCase["howDoI"]> = evalCase.howDoI!;
      const project: AskAiEvalProject = getAskAiEvalProject(
        howDoI.projectKind!,
      );
      const records: Array<AskAiEvalNamedRecord> = [
        ...project.statusPages,
        ...project.monitors,
        ...project.policies,
        ...project.services,
        // The records whose own pages a question is asked on since #10104.
        ...project.onCallSchedules,
        ...project.incomingCallPolicies,
        ...project.teams,
        ...project.dashboards,
        ...project.runbooks,
        ...project.slos,
        ...project.forms,
      ];
      const entityId: string | undefined = howDoI.pageContext!.entityId;

      expect(evalCase.context).toMatch(/^en, on /);

      if (entityId) {
        // The record is one of the project's, and its button is the record's.
        expect(
          records.some((record: AskAiEvalNamedRecord): boolean => {
            return record.id === entityId;
          }),
        ).toBe(true);
        expect(howDoI.dashboardRecordId).toBe(entityId);
      } else {
        expect(howDoI.dashboardRecordId).toBeUndefined();
      }
    }

    // The ones not asked on a page carry none.
    expect(
      getHowDoICases()
        .slice(0, -ASK_AI_PAGE_CONTEXT_QUESTIONS.length)
        .filter((evalCase: AskAiEvalCase) => {
          return (
            evalCase.howDoI!.pageContext || evalCase.howDoI!.dashboardRecordId
          );
        }),
    ).toEqual([]);
  });

  test("each page a question expects is a page of the docs, in English at least", () => {
    for (const evalCase of getHowDoICases()) {
      for (const page of [
        ...(evalCase.howDoI!.docsPage ? [evalCase.howDoI!.docsPage] : []),
        ...(evalCase.howDoI!.alsoAnswers || []),
      ]) {
        expect(fs.existsSync(path.join(DOCS_CONTENT, `${page}.md`))).toBe(true);
      }
    }
  });

  test("every id is its own", () => {
    const ids: Array<string> = getAskAiEvalCases([
      AskAiEvalSuite.Setup,
      AskAiEvalSuite.HowDoI,
    ]).map((evalCase: AskAiEvalCase) => {
      return evalCase.id;
    });

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("its command line", () => {
  test("--suite asks one list, both without it, and refuses another", () => {
    expect(readSuites([])).toEqual([
      AskAiEvalSuite.Setup,
      AskAiEvalSuite.HowDoI,
    ]);
    expect(readSuites(["--suite="])).toHaveLength(2);
    expect(readSuites(["--suite=how-do-i"])).toEqual([AskAiEvalSuite.HowDoI]);
    expect(() => {
      return readSuites(["--suite=docs"]);
    }).toThrow(
      new EvalUsageError('--suite must be setup or how-do-i, got "docs".'),
    );
  });

  test("--case asks the cases it names, and refuses one it does not know", () => {
    const cases: Array<AskAiEvalCase> = getAskAiEvalCases([
      AskAiEvalSuite.Setup,
      AskAiEvalSuite.HowDoI,
    ]);

    expect(
      pickCases(["--case=how-do-i-2, setup-1"], cases).map(
        (evalCase: AskAiEvalCase) => {
          return evalCase.id;
        },
      ),
    ).toEqual(["setup-1", "how-do-i-2"]);
    expect(pickCases(["--case="], cases)).toHaveLength(cases.length);
    expect(() => {
      return pickCases(["--case=setup-999"], cases);
    }).toThrow(
      new EvalUsageError(
        "Unknown case(s): setup-999. Run with --list to see them.",
      ),
    );
  });
});
