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
} from "./AskAiHowDoIQuestions";
import { AskAiEvalProjectKind } from "Common/Server/Utils/AI/Eval/AskAi/AskAiEvalProject";
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

  test("every how-do-I question: in English, in German and Persian, and the ones the docs do not cover", () => {
    const cases: Array<AskAiEvalCase> = getHowDoICases();

    expect(cases).toHaveLength(
      ASK_AI_HOW_DO_I_QUESTIONS.length +
        ASK_AI_HOW_DO_I_QUESTIONS_TRANSLATED.length +
        ASK_AI_NOT_COVERED_QUESTIONS.length,
    );
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
