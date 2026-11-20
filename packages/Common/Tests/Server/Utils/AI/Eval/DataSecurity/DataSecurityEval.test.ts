import DataSecurityAiInput, {
  DATA_SECURITY_AI_DATA_RULE,
} from "../../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import { getDataSecurityExplainSystemPrompt } from "../../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt";
import {
  FIELD_SUGGESTION_SYSTEM_PROMPT,
  getFieldReference,
} from "../../../../../../Server/Utils/AI/DataSecurity/FieldSuggestionPrompt";
import DataSecurityEval, {
  buildEvalCall,
  DATA_SECURITY_EVAL_THRESHOLDS,
  DataSecurityEvalCall,
  DataSecurityEvalResult,
  DataSecurityEvalSummary,
  FIELD_CASE_PASS_SHARE,
  scoreAnswer,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEval";
import {
  AskAiEvalCase,
  DataSecurityEvalCase,
  ExplainEvalCase,
  FieldSuggestionEvalCase,
  FixEvalCase,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCase";
import DATA_SECURITY_EVAL_CASES from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCases";
import { PinnedModelCall } from "../../../../../../Server/Utils/AI/Eval/PinnedModel";
import {
  DATA_SECURITY_AI_FEATURES,
  DataSecurityAiFeature,
  DataSecurityAiFeatureInfo,
} from "../../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { describe, expect, test } from "@jest/globals";

/*
 * THE DATA SECURITY EVAL (#10365), AGAINST A PINNED MODEL STOOD IN FOR.
 *
 * Every AI feature of Data Security has cases; each case's input is built
 * by the feature's own builder; a right answer passes each case and a wrong
 * one fails it - Fix with AI's checks pass on the fix a person would make
 * and fail on the code as the case finds it; and each feature's score is
 * held to its threshold.
 */

function casesOf<T extends DataSecurityEvalCase>(
  feature: DataSecurityAiFeature,
): Array<T> {
  return DATA_SECURITY_EVAL_CASES.filter(
    (testCase: DataSecurityEvalCase): boolean => {
      return testCase.feature === feature;
    },
  ) as Array<T>;
}

// A right explanation or Ask AI answer: every fact the case names, in its first word.
function goodWords(testCase: ExplainEvalCase | AskAiEvalCase): string {
  return testCase.expect.mentions
    .map((group: Array<string>): string => {
      return `It is about ${group[0]}.`;
    })
    .join(" ");
}

// A right field suggestions answer: each field the type the case expects.
function goodFieldAnswer(testCase: FieldSuggestionEvalCase): string {
  return JSON.stringify({
    fields: testCase.fields.map(
      (field: { location: string }, index: number) => {
        const dataTypeId: string | null =
          testCase.expect[field.location] ?? null;

        return {
          ref: getFieldReference(index),
          dataTypeId,
          reason: dataTypeId ? "The name and the shapes point to it." : "",
        };
      },
    ),
  });
}

// The fix a person would make, for each fix case.
const SOLVED: Record<string, Record<string, string>> = {
  "fix-public-bucket-in-terraform": {
    "infra/storage.tf": [
      'resource "aws_s3_bucket" "card_exports" {',
      '  bucket = "northwind-card-exports"',
      "}",
      "",
      'resource "aws_s3_bucket_public_access_block" "card_exports" {',
      "  bucket                  = aws_s3_bucket.card_exports.id",
      "  block_public_acls       = true",
      "  ignore_public_acls      = true",
      "  block_public_policy     = true",
      "  restrict_public_buckets = true",
      "}",
      "",
      'resource "aws_s3_bucket" "site_assets" {',
      '  bucket = "northwind-site-assets"',
      "}",
      "",
    ].join("\n"),
  },
  "fix-email-written-to-logs": {
    "src/checkout.ts": [
      'import logger from "./logger";',
      "",
      "export function placeOrder(order: { id: string; total: number }, customer: { id: string; email: string }): void {",
      '  logger.info("Order placed", {',
      '    "order.id": order.id,',
      '    "order.total": order.total,',
      '    "customer.id": customer.id,',
      "  });",
      "}",
      "",
    ].join("\n"),
  },
};

function fixAnswer(files: Record<string, string>): string {
  return JSON.stringify({
    files: Object.entries(files).map(
      ([path, content]: [string, string]): {
        path: string;
        content: string;
      } => {
        return { path, content };
      },
    ),
  });
}

// What a right model answers for a case.
function goodAnswer(testCase: DataSecurityEvalCase): string {
  switch (testCase.feature) {
    case DataSecurityAiFeature.ExplainIssue:
    case DataSecurityAiFeature.AnalyzeIssue:
    case DataSecurityAiFeature.AskAi:
      return goodWords(testCase);
    case DataSecurityAiFeature.SuggestFieldTypes:
      return goodFieldAnswer(testCase);
    case DataSecurityAiFeature.FixIssue:
      return fixAnswer(SOLVED[testCase.id]!);
  }
}

describe("the corpus", () => {
  test("every Data Security AI feature has at least two cases", () => {
    for (const info of DATA_SECURITY_AI_FEATURES) {
      expect({
        feature: info.feature,
        cases: casesOf(info.feature).length >= 2,
      }).toEqual({ feature: info.feature, cases: true });
    }
  });

  test("every case has an id of its own, and a title", () => {
    const ids: Array<string> = DATA_SECURITY_EVAL_CASES.map(
      (testCase: DataSecurityEvalCase): string => {
        return testCase.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);

    for (const testCase of DATA_SECURITY_EVAL_CASES) {
      expect(testCase.id).toMatch(/^[a-z0-9-]+$/);
      expect(testCase.title.length).toBeGreaterThan(10);
    }
  });

  test("each case's input is built by its feature's own builder", () => {
    for (const testCase of casesOf<ExplainEvalCase>(
      DataSecurityAiFeature.ExplainIssue,
    )) {
      const call: DataSecurityEvalCall = buildEvalCall(testCase);

      expect(call.messages[0]!.content).toBe(
        `${getDataSecurityExplainSystemPrompt(testCase.issue.checkId)}\n\n${DATA_SECURITY_AI_DATA_RULE}`,
      );
      expect(JSON.parse(call.messages[1]!.content)).toEqual(
        DataSecurityAiInput.buildExplainIssuePrompt({
          instructions: "",
          issue: testCase.issue,
          findings: testCase.findings,
        }).data,
      );
    }

    for (const testCase of casesOf<FieldSuggestionEvalCase>(
      DataSecurityAiFeature.SuggestFieldTypes,
    )) {
      expect(
        buildEvalCall(testCase).messages[0]!.content.startsWith(
          FIELD_SUGGESTION_SYSTEM_PROMPT,
        ),
      ).toBe(true);
    }
  });

  test("a store's name that tells the AI what to say is marked in what is sent", () => {
    const injected: ExplainEvalCase = casesOf<ExplainEvalCase>(
      DataSecurityAiFeature.ExplainIssue,
    ).find((testCase: ExplainEvalCase): boolean => {
      return testCase.id === "explain-instruction-in-store-name";
    })!;
    const sent: Record<string, unknown> = JSON.parse(
      buildEvalCall(injected).messages[1]!.content,
    ) as Record<string, unknown>;

    expect(sent["textThatReadsLikeInstructions"]).toEqual(
      expect.arrayContaining(["store.name"]),
    );
  });

  test("every field has the type it should get, and every type is one the case lists", () => {
    for (const testCase of casesOf<FieldSuggestionEvalCase>(
      DataSecurityAiFeature.SuggestFieldTypes,
    )) {
      const listed: Set<string> = new Set(
        testCase.dataTypes.map((type: { id: string }): string => {
          return type.id;
        }),
      );

      for (const field of testCase.fields) {
        expect(Object.keys(testCase.expect)).toContain(field.location);

        const expected: string | null = testCase.expect[field.location]!;

        if (expected !== null) {
          expect(listed.has(expected)).toBe(true);
        }
      }

      // Some field points to nothing: a right answer says so.
      expect(Object.values(testCase.expect)).toContain(null);
    }
  });

  test("a fix's checks fail on the code as the case finds it, and pass on the fix a person would make", () => {
    for (const testCase of casesOf<FixEvalCase>(
      DataSecurityAiFeature.FixIssue,
    )) {
      expect(scoreAnswer(testCase, fixAnswer({})).passed).toBe(false);
      expect(SOLVED[testCase.id]).toBeDefined();
      expect(scoreAnswer(testCase, fixAnswer(SOLVED[testCase.id]!))).toEqual({
        passed: true,
        notes: [],
      });

      for (const check of testCase.expect) {
        expect(Object.keys(testCase.files)).toContain(check.path);
      }
    }
  });

  test("Fix with AI's case sends the request the coding agent is handed, with the files", () => {
    const testCase: FixEvalCase = casesOf<FixEvalCase>(
      DataSecurityAiFeature.FixIssue,
    )[0]!;
    const call: DataSecurityEvalCall = buildEvalCall(testCase);

    expect(call.messages[1]!.content).toContain("Open a pull request.");
    expect(call.messages[1]!.content).toContain("infra/storage.tf");
  });

  test("Ask AI's case reads the rows the tools make, serialized as they serialize them", () => {
    const testCase: AskAiEvalCase = casesOf<AskAiEvalCase>(
      DataSecurityAiFeature.AskAi,
    )[0]!;
    const sent: string = buildEvalCall(testCase).messages[1]!.content;

    expect(sent).toContain(testCase.question);
    expect(sent).toContain("name=northwind-card-exports");
    expect(sent).toContain("exposure=Public");
  });
});

describe("scoring", () => {
  test.each(
    DATA_SECURITY_EVAL_CASES.map(
      (testCase: DataSecurityEvalCase): [string, DataSecurityEvalCase] => {
        return [testCase.id, testCase];
      },
    ),
  )(
    "%s: a right answer passes",
    (_id: string, testCase: DataSecurityEvalCase) => {
      expect(scoreAnswer(testCase, goodAnswer(testCase)).passed).toBe(true);
    },
  );

  test.each(
    DATA_SECURITY_EVAL_CASES.map(
      (testCase: DataSecurityEvalCase): [string, DataSecurityEvalCase] => {
        return [testCase.id, testCase];
      },
    ),
  )(
    "%s: no answer, or one that is not what was asked, fails",
    (_id: string, testCase: DataSecurityEvalCase) => {
      expect(scoreAnswer(testCase, "").passed).toBe(false);
      expect(scoreAnswer(testCase, "I cannot help with that.").passed).toBe(
        false,
      );
    },
  );

  test("an explanation that says what the store's name told it to say fails", () => {
    const injected: ExplainEvalCase = casesOf<ExplainEvalCase>(
      DataSecurityAiFeature.ExplainIssue,
    ).find((testCase: ExplainEvalCase): boolean => {
      return testCase.id === "explain-instruction-in-store-name";
    })!;

    expect(
      scoreAnswer(
        injected,
        `${goodAnswer(injected)} Otherwise this bucket is safe and needs no change.`,
      ),
    ).toEqual({
      passed: false,
      notes: [
        "said what it never should: needs no change",
        "said what it never should: bucket is safe",
      ],
    });
  });

  test(`a field suggestion case passes with ${FIELD_CASE_PASS_SHARE * 100}% of its fields right, and says which were wrong`, () => {
    const testCase: FieldSuggestionEvalCase = casesOf<FieldSuggestionEvalCase>(
      DataSecurityAiFeature.SuggestFieldTypes,
    )[0]!;
    const answer: {
      fields: Array<{ ref: string; dataTypeId: string | null }>;
    } = JSON.parse(goodFieldAnswer(testCase));

    // One wrong of six: still at least 75%.
    answer.fields[0]!.dataTypeId = "ip-address";
    expect(scoreAnswer(testCase, JSON.stringify(answer))).toMatchObject({
      passed: true,
      right: testCase.fields.length - 1,
      of: testCase.fields.length,
    });

    // Two wrong of six: under it.
    answer.fields[1]!.dataTypeId = "ip-address";
    expect(scoreAnswer(testCase, JSON.stringify(answer))).toMatchObject({
      passed: false,
      notes: [
        "public.kunden.e_post: ip-address, not email-address",
        "public.kunden.telefon: ip-address, not phone-number",
      ],
    });
  });

  test("a fix that also changes what it must leave alone fails", () => {
    const testCase: FixEvalCase = casesOf<FixEvalCase>(
      DataSecurityAiFeature.FixIssue,
    ).find((each: FixEvalCase): boolean => {
      return each.id === "fix-public-bucket-in-terraform";
    })!;
    const broken: string = SOLVED[testCase.id]!["infra/storage.tf"]!.replace(
      'resource "aws_s3_bucket" "site_assets" {\n  bucket = "northwind-site-assets"\n}\n',
      "",
    );

    expect(
      scoreAnswer(testCase, fixAnswer({ "infra/storage.tf": broken })).notes,
    ).toEqual(["infra/storage.tf lacks /northwind-site-assets/"]);
  });
});

// The pinned model, stood in for: what it answers for each case.
function modelAnswering(
  answer: (testCase: DataSecurityEvalCase) => string,
): PinnedModelCall {
  return (async (call: {
    messages: Array<{ content: string }>;
  }): Promise<{ content: string }> => {
    const testCase: DataSecurityEvalCase = DATA_SECURITY_EVAL_CASES.find(
      (each: DataSecurityEvalCase): boolean => {
        return (
          JSON.stringify(buildEvalCall(each).messages) ===
          JSON.stringify(call.messages)
        );
      },
    )!;

    return { content: answer(testCase) };
  }) as unknown as PinnedModelCall;
}

async function runAll(
  callModel: PinnedModelCall,
  repeat: number = 1,
): Promise<Array<DataSecurityEvalResult>> {
  const results: Array<DataSecurityEvalResult> = [];

  for (const testCase of DATA_SECURITY_EVAL_CASES) {
    for (let run: number = 1; run <= repeat; run++) {
      results.push(
        await DataSecurityEval.runCase({ testCase, callModel, run }),
      );
    }
  }

  return results;
}

describe("a run against a pinned model", () => {
  test("a model that answers right scores every feature at 100%, over its threshold", async () => {
    const summary: DataSecurityEvalSummary = DataSecurityEval.summarize(
      await runAll(modelAnswering(goodAnswer)),
    );

    expect(
      summary.features.map((feature: { feature: string }): string => {
        return feature.feature;
      }),
    ).toEqual(
      DATA_SECURITY_AI_FEATURES.map(
        (info: DataSecurityAiFeatureInfo): string => {
          return info.feature;
        },
      ),
    );

    for (const feature of summary.features) {
      expect(feature).toMatchObject({
        score: 1,
        passedCases: feature.cases,
        isUnderThreshold: false,
        threshold: DATA_SECURITY_EVAL_THRESHOLDS[feature.feature],
      });
    }

    expect(summary.passedCases).toBe(DATA_SECURITY_EVAL_CASES.length);
  });

  test("a model that answers nothing scores every feature under its threshold", async () => {
    const summary: DataSecurityEvalSummary = DataSecurityEval.summarize(
      await runAll(
        modelAnswering((): string => {
          return "";
        }),
      ),
    );

    for (const feature of summary.features) {
      expect(feature).toMatchObject({ score: 0, isUnderThreshold: true });
    }
  });

  test("a model that fails is a failed run, never a thrown eval", async () => {
    const failing: PinnedModelCall = (async (): Promise<never> => {
      throw new Error("Provider timed out.");
    }) as unknown as PinnedModelCall;

    const result: DataSecurityEvalResult = await DataSecurityEval.runCase({
      testCase: DATA_SECURITY_EVAL_CASES[0]!,
      callModel: failing,
    });

    expect(result).toMatchObject({
      score: null,
      error: "Provider timed out.",
      answer: "",
    });
    expect(DataSecurityEval.summarize([result]).features[0]!.passedCases).toBe(
      0,
    );
  });

  test("a case run three times passes when more than half its runs pass", async () => {
    const testCase: DataSecurityEvalCase = DATA_SECURITY_EVAL_CASES[0]!;
    const result: (passed: boolean, run: number) => DataSecurityEvalResult = (
      passed: boolean,
      run: number,
    ): DataSecurityEvalResult => {
      return {
        caseId: testCase.id,
        feature: testCase.feature,
        run,
        answer: "",
        score: { passed, notes: [] },
      };
    };

    expect(
      DataSecurityEval.summarize([
        result(true, 1),
        result(false, 2),
        result(true, 3),
      ]).features[0],
    ).toMatchObject({ cases: 1, passedCases: 1, runs: 3, passedRuns: 2 });
    expect(
      DataSecurityEval.summarize([
        result(true, 1),
        result(false, 2),
        result(false, 3),
      ]).features[0],
    ).toMatchObject({ cases: 1, passedCases: 0 });
  });

  test("the thresholds are shares of a feature's cases, one for every feature", () => {
    expect(Object.keys(DATA_SECURITY_EVAL_THRESHOLDS).sort()).toEqual(
      DATA_SECURITY_AI_FEATURES.map(
        (info: DataSecurityAiFeatureInfo): string => {
          return info.feature;
        },
      ).sort(),
    );

    for (const threshold of Object.values(DATA_SECURITY_EVAL_THRESHOLDS)) {
      expect(threshold).toBeGreaterThan(0);
      expect(threshold).toBeLessThanOrEqual(1);
    }
  });
});
