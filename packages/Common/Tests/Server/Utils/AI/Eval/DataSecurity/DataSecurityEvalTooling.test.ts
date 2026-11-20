import DataSecurityEval, {
  DataSecurityEvalResult,
  DataSecurityEvalSummary,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEval";
import DATA_SECURITY_EVAL_CASES from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCases";
import { DataSecurityEvalCase } from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCase";
import DataSecurityEvalCommandLine, {
  getEvalTriggerPaths,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCommandLine";
import DataSecurityEvalLabels, {
  CUSTOM_DATA_TYPE_LABEL,
  DataSecurityEvalLabel,
  DataSecurityEvalVerdict,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalLabels";
import DataSecurityEvalReport, {
  DataSecurityEvalReportInput,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalReport";
import { EvalUsageError } from "../../../../../../Server/Utils/AI/Eval/EvalCommandLine";
import { DataSecurityAiFeature } from "../../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { DataStoreKind } from "../../../../../../Types/DataSecurity/DataStoreKind";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";

/*
 * THE DATA SECURITY EVAL'S TOOLING (#10365): which features a pull
 * request's changes run, the options the command takes, the report a CI
 * job's summary reads, and the labels people's verdicts become - with no
 * customer's input in them.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "../../../../../../../..",
);
const WORKFLOW: string = ".github/workflows/data-security-ai-eval.yml";

const ALL: Array<DataSecurityAiFeature> = Object.values(DataSecurityAiFeature);

describe("which features a pull request's changes run", () => {
  test.each([
    [
      "packages/Common/Server/Utils/AI/DataSecurity/FieldSuggestionPrompt.ts",
      [DataSecurityAiFeature.SuggestFieldTypes],
    ],
    [
      "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt.ts",
      [
        DataSecurityAiFeature.ExplainIssue,
        DataSecurityAiFeature.AnalyzeIssue,
        DataSecurityAiFeature.FixIssue,
      ],
    ],
    [
      "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysis.ts",
      [DataSecurityAiFeature.AnalyzeIssue],
    ],
    [
      "packages/Common/Server/Utils/AI/Toolbox/DataSecurityTools.ts",
      [DataSecurityAiFeature.AskAi],
    ],
    [
      "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityAiInput.ts",
      ALL,
    ],
    [
      "packages/Common/Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCases.ts",
      ALL,
    ],
    ["packages/Common/Server/Utils/LLM/LLMService.ts", ALL],
    ["./Scripts/AI/RunDataSecurityEval.ts", ALL],
  ])("%s runs its features", (file: string, features: Array<string>) => {
    expect(DataSecurityEvalCommandLine.featuresForChangedFiles([file])).toEqual(
      features,
    );
  });

  test("a change no feature reads runs none", () => {
    expect(
      DataSecurityEvalCommandLine.featuresForChangedFiles([
        "README.md",
        "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityCodeTask.ts",
        "packages/App/FeatureSet/Dashboard/src/Pages/DataSecurity/Overview.tsx",
        "",
      ]),
    ).toEqual([]);
  });

  test("several changes run what each changes, once, in the catalog's order", () => {
    expect(
      DataSecurityEvalCommandLine.featuresForChangedFiles([
        "packages/Common/Server/Utils/AI/Toolbox/DataSecurityTools.ts",
        "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt.ts",
        "packages/Common/Server/Utils/AI/Toolbox/DataSecurityTools.ts",
      ]),
    ).toEqual([
      DataSecurityAiFeature.ExplainIssue,
      DataSecurityAiFeature.AnalyzeIssue,
      DataSecurityAiFeature.FixIssue,
      DataSecurityAiFeature.AskAi,
    ]);
  });

  test("every file that runs a feature is in the repository", () => {
    for (const pattern of getEvalTriggerPaths()) {
      const target: string = pattern.endsWith("/**")
        ? pattern.slice(0, -3)
        : pattern;

      expect({
        pattern,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, target)),
      }).toEqual({ pattern, exists: true });
    }
  });

  test("the workflow runs on a pull request that changes any of them, and no other", () => {
    const workflow: Record<string, unknown> = yaml.load(
      fs.readFileSync(path.join(REPOSITORY_ROOT, WORKFLOW), "utf8"),
    ) as Record<string, unknown>;
    const on: Record<string, { paths?: Array<string> }> = (workflow["on"] ||
      workflow["true"]) as Record<string, { paths?: Array<string> }>;

    expect([...(on["pull_request"]!.paths || [])].sort()).toEqual(
      getEvalTriggerPaths().sort(),
    );
  });
});

describe("the command line", () => {
  test("--feature names features in any case; every feature without it", () => {
    expect(DataSecurityEvalCommandLine.readFeatures([])).toEqual(ALL);
    expect(
      DataSecurityEvalCommandLine.readFeatures([
        "--feature=explainissue, AskAi",
      ]),
    ).toEqual([
      DataSecurityAiFeature.ExplainIssue,
      DataSecurityAiFeature.AskAi,
    ]);
    expect(DataSecurityEvalCommandLine.readFeatures(["--feature="])).toEqual(
      ALL,
    );
    expect(() => {
      return DataSecurityEvalCommandLine.readFeatures(["--feature=Summaries"]);
    }).toThrow(EvalUsageError);
  });

  test("--case picks cases of the features asked for, and refuses one that is not a case", () => {
    const picked: Array<DataSecurityEvalCase> =
      DataSecurityEvalCommandLine.pickCases({
        argv: [
          "--case=explain-emails-in-logs,ask-who-outside-can-reach-a-store",
        ],
        cases: DATA_SECURITY_EVAL_CASES,
        features: [DataSecurityAiFeature.ExplainIssue],
      });

    expect(
      picked.map((testCase: DataSecurityEvalCase): string => {
        return testCase.id;
      }),
    ).toEqual(["explain-emails-in-logs"]);
    expect(() => {
      return DataSecurityEvalCommandLine.pickCases({
        argv: ["--case=no-such-case"],
        cases: DATA_SECURITY_EVAL_CASES,
        features: ALL,
      });
    }).toThrow("Unknown case(s): no-such-case.");
  });

  test("with no feature, no case runs", () => {
    expect(
      DataSecurityEvalCommandLine.pickCases({
        argv: [],
        cases: DATA_SECURITY_EVAL_CASES,
        features: [],
      }),
    ).toEqual([]);
  });

  test("--changed-files needs a file", () => {
    expect(
      DataSecurityEvalCommandLine.readChangedFilesPath([]),
    ).toBeUndefined();
    expect(
      DataSecurityEvalCommandLine.readChangedFilesPath([
        "--changed-files=changed-files.txt",
      ]),
    ).toBe("changed-files.txt");
    expect(() => {
      return DataSecurityEvalCommandLine.readChangedFilesPath([
        "--changed-files=",
      ]);
    }).toThrow(EvalUsageError);
  });
});

function resultOf(
  testCase: DataSecurityEvalCase,
  passed: boolean,
  notes: Array<string> = [],
): DataSecurityEvalResult {
  return {
    caseId: testCase.id,
    feature: testCase.feature,
    run: 1,
    answer: "",
    score: { passed, notes },
  };
}

describe("the report", () => {
  const results: Array<DataSecurityEvalResult> = DATA_SECURITY_EVAL_CASES.map(
    (testCase: DataSecurityEvalCase): DataSecurityEvalResult => {
      return resultOf(
        testCase,
        testCase.feature !== DataSecurityAiFeature.FixIssue,
        testCase.feature === DataSecurityAiFeature.FixIssue
          ? ["src/checkout.ts still has /x/"]
          : [],
      );
    },
  );
  const summary: DataSecurityEvalSummary = DataSecurityEval.summarize(results);
  const input: DataSecurityEvalReportInput = {
    model: "Anthropic claude-opus-5-5",
    repeat: 1,
    results,
    summary,
    areThresholdsEnforced: true,
    outputPath: "./ai-data-security-eval-results.json",
  };

  test("a line a feature: its cases passed, its score and its threshold", () => {
    const text: string =
      DataSecurityEvalReport.buildTextReport(input).join("\n");

    expect(text).toContain(
      "Explain with AI: 4 of 4 cases (100%), threshold 50%: met",
    );
    expect(text).toContain(
      "Fix with AI: 0 of 2 cases (0%), threshold 50%: under",
    );
    expect(text).toContain("A feature scored under its threshold.");
    expect(text).toContain(
      "fix-email-written-to-logs: FAIL src/checkout.ts still has /x/",
    );
  });

  test("the same in Markdown for the job's summary, each case folded away", () => {
    const markdown: string = DataSecurityEvalReport.buildMarkdownReport(input);

    expect(markdown).toContain("## Data Security AI eval");
    expect(markdown).toContain("| Fix with AI | 0 of 2 | 0% | 50% | under |");
    expect(markdown).toContain("<details><summary>Each case</summary>");
    expect(DataSecurityEvalReport.isUnderAThreshold(summary)).toBe(true);
  });

  test("a run that could not reach the model says so", () => {
    expect(
      DataSecurityEvalReport.describeResult({
        ...resultOf(DATA_SECURITY_EVAL_CASES[0]!, false),
        score: null,
        error: "Provider timed out.",
      }),
    ).toBe("ERROR Provider timed out.");
  });
});

describe("people's verdicts, as labels with no customer's input (#10364)", () => {
  const AT: Date = new Date("2026-11-20T10:00:00.000Z");

  test("keep only what OneUptime's catalogs name", () => {
    expect(
      DataSecurityEvalLabels.fromVerdict({
        feature: DataSecurityAiFeature.ExplainIssue,
        verdict: DataSecurityEvalVerdict.Dismissed,
        checkId: "public-read",
        dataTypeIds: [
          "credit-card-number",
          "custom:0192f1a0-0000-7000-8000-00000000c0de",
          "custom:0192f1a0-0000-7000-8000-00000000c0df",
          "Loyalty card of Jane Doe",
          42,
        ],
        storeKind: DataStoreKind.AwsS3Bucket,
        locationKind: "Column",
        at: AT,
      }),
    ).toEqual({
      feature: DataSecurityAiFeature.ExplainIssue,
      verdict: DataSecurityEvalVerdict.Dismissed,
      checkId: "public-read",
      dataTypes: ["credit-card-number", CUSTOM_DATA_TYPE_LABEL],
      storeKind: DataStoreKind.AwsS3Bucket,
      locationKind: "Column",
      at: "2026-11-20T10:00:00.000Z",
    });
  });

  test("a store's name, a field's name, evidence or a check that is not one never reaches a label", () => {
    const label: DataSecurityEvalLabel | null =
      DataSecurityEvalLabels.fromVerdict({
        feature: DataSecurityAiFeature.SuggestFieldTypes,
        verdict: DataSecurityEvalVerdict.Approved,
        checkId: "acme-card-exports is public",
        dataTypeIds: "email-address",
        storeKind: "acme-card-exports",
        locationKind: "public.customers.email",
        at: AT,
      });

    expect(label).toEqual({
      feature: DataSecurityAiFeature.SuggestFieldTypes,
      verdict: DataSecurityEvalVerdict.Approved,
      dataTypes: [],
      at: "2026-11-20T10:00:00.000Z",
    });
    expect(JSON.stringify(label)).not.toContain("acme");
    expect(JSON.stringify(label)).not.toContain("customers");
  });

  test("a verdict on no feature, or no verdict, is no label", () => {
    expect(
      DataSecurityEvalLabels.fromVerdict({
        feature: "Summaries",
        verdict: DataSecurityEvalVerdict.Approved,
        at: AT,
      }),
    ).toBeNull();
    expect(
      DataSecurityEvalLabels.fromVerdict({
        feature: DataSecurityAiFeature.FixIssue,
        verdict: "maybe",
        at: AT,
      }),
    ).toBeNull();
  });

  test("are counted by feature and check, the most dismissed first", () => {
    const label: (
      checkId: string,
      verdict: DataSecurityEvalVerdict,
    ) => DataSecurityEvalLabel = (
      checkId: string,
      verdict: DataSecurityEvalVerdict,
    ): DataSecurityEvalLabel => {
      return DataSecurityEvalLabels.fromVerdict({
        feature: DataSecurityAiFeature.ExplainIssue,
        verdict,
        checkId,
        at: AT,
      })!;
    };

    expect(
      DataSecurityEvalLabels.tally([
        label("public-read", DataSecurityEvalVerdict.Approved),
        label("public-read", DataSecurityEvalVerdict.Approved),
        label("open-to-all-addresses", DataSecurityEvalVerdict.Dismissed),
        label("public-read", DataSecurityEvalVerdict.Dismissed),
        label("open-to-all-addresses", DataSecurityEvalVerdict.Dismissed),
      ]),
    ).toEqual([
      {
        feature: DataSecurityAiFeature.ExplainIssue,
        checkId: "open-to-all-addresses",
        approved: 0,
        dismissed: 2,
      },
      {
        feature: DataSecurityAiFeature.ExplainIssue,
        checkId: "public-read",
        approved: 2,
        dismissed: 1,
      },
    ]);
  });
});
