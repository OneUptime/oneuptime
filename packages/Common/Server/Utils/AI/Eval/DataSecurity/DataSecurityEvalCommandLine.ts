import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { EvalUsageError, getArgValue } from "../EvalCommandLine";
import { DataSecurityEvalCase } from "./DataSecurityEvalCase";

/*
 * THE DATA SECURITY EVAL'S OWN OPTIONS (npm run ai-data-security-eval),
 * beside the model options every eval takes (EvalCommandLine) and the
 * benchmark's --repeat and --report-markdown (BenchmarkCommandLine):
 *
 *   --feature=<id>[,<id>]   run only these features' cases: ExplainIssue,
 *                           AnalyzeIssue, FixIssue, SuggestFieldTypes, AskAi
 *                           (any case)
 *   --case=<id>[,<id>]      run only these cases
 *   --changed-files=<path>  run only the features the files listed in it
 *                           (one path a line) change: what a pull request
 *                           that changes one feature's prompt runs
 *   --enforce-thresholds    exit 1 when a feature scores under its
 *                           threshold (DATA_SECURITY_EVAL_THRESHOLDS)
 *   --list                  list the cases and stop
 *
 * A value the eval cannot run with is a usage error: the command prints its
 * message alone, before any model is called.
 */

/*
 * Which features a changed file can change, by its path from the
 * repository's root. A file every feature reads changes them all; a file
 * no feature reads changes none.
 */
const ALL_FEATURES: ReadonlyArray<DataSecurityAiFeature> = Object.values(
  DataSecurityAiFeature,
);

const FEATURES_OF_FILE: ReadonlyArray<{
  path: string;
  features: ReadonlyArray<DataSecurityAiFeature>;
}> = [
  // What every feature's input is built with, sent by, or read with.
  {
    path: "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityAiInput.ts",
    features: ALL_FEATURES,
  },
  {
    path: "packages/Common/Server/Utils/AI/DataSecurity/StrictAnswer.ts",
    features: ALL_FEATURES,
  },
  {
    path: "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityAiCall.ts",
    features: ALL_FEATURES,
  },
  {
    path: "packages/Common/Server/Utils/AI/Eval/DataSecurity/",
    features: ALL_FEATURES,
  },
  {
    path: "packages/Common/Server/Utils/AI/Eval/PinnedModel.ts",
    features: ALL_FEATURES,
  },
  { path: "packages/Common/Server/Utils/LLM/", features: ALL_FEATURES },
  { path: "Scripts/AI/RunDataSecurityEval.ts", features: ALL_FEATURES },
  {
    path: ".github/workflows/data-security-ai-eval.yml",
    features: ALL_FEATURES,
  },
  // One feature's own words.
  {
    path: "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt.ts",
    features: [
      DataSecurityAiFeature.ExplainIssue,
      DataSecurityAiFeature.AnalyzeIssue,
      DataSecurityAiFeature.FixIssue,
    ],
  },
  {
    path: "packages/Common/Server/Utils/AI/DataSecurity/DataSecurityIssueAnalysis.ts",
    features: [
      DataSecurityAiFeature.ExplainIssue,
      DataSecurityAiFeature.AnalyzeIssue,
    ],
  },
  // How an analysis's answer is held to its facts (#10369).
  {
    path: "packages/Common/Types/DataSecurity/DataSecurityIssueAnalysis.ts",
    features: [
      DataSecurityAiFeature.ExplainIssue,
      DataSecurityAiFeature.AnalyzeIssue,
    ],
  },
  {
    path: "packages/Common/Server/Utils/AI/DataSecurity/FieldSuggestionPrompt.ts",
    features: [DataSecurityAiFeature.SuggestFieldTypes],
  },
  {
    path: "packages/Common/Server/Utils/AI/DataSecurity/FieldSuggestion.ts",
    features: [DataSecurityAiFeature.SuggestFieldTypes],
  },
  {
    path: "packages/Common/Server/Utils/AI/Toolbox/DataSecurityTools.ts",
    features: [DataSecurityAiFeature.AskAi],
  },
  {
    path: "packages/Common/Server/Utils/AI/Toolbox/Serializer.ts",
    features: [DataSecurityAiFeature.AskAi],
  },
  {
    path: "packages/Common/Types/DataSecurity/DataSecurityCheckCatalog.ts",
    features: [
      DataSecurityAiFeature.ExplainIssue,
      DataSecurityAiFeature.AnalyzeIssue,
      DataSecurityAiFeature.FixIssue,
    ],
  },
];

// The workflow's own paths: every file above, as GitHub's filter writes it.
export function getEvalTriggerPaths(): Array<string> {
  return FEATURES_OF_FILE.map((entry: { path: string }): string => {
    return entry.path.endsWith("/") ? `${entry.path}**` : entry.path;
  });
}

function parseList(value: string | undefined): Array<string> {
  return (value || "")
    .split(",")
    .map((item: string): string => {
      return item.trim();
    })
    .filter(Boolean);
}

export default class DataSecurityEvalCommandLine {
  // The features the changed files change, in the catalog's order.
  public static featuresForChangedFiles(
    files: ReadonlyArray<string>,
  ): Array<DataSecurityAiFeature> {
    const changed: Set<DataSecurityAiFeature> = new Set();

    for (const file of files) {
      const normalized: string = file.trim().replace(/^\.\//, "");

      for (const entry of FEATURES_OF_FILE) {
        const isMatch: boolean = entry.path.endsWith("/")
          ? normalized.startsWith(entry.path)
          : normalized === entry.path;

        if (isMatch) {
          for (const feature of entry.features) {
            changed.add(feature);
          }
        }
      }
    }

    return ALL_FEATURES.filter((feature: DataSecurityAiFeature): boolean => {
      return changed.has(feature);
    });
  }

  // --feature's features, by their ids in any case; every feature without it.
  public static readFeatures(
    argv: ReadonlyArray<string>,
  ): Array<DataSecurityAiFeature> {
    const asked: Array<string> = parseList(getArgValue(argv, "feature"));

    if (asked.length === 0) {
      return [...ALL_FEATURES];
    }

    return asked.map((value: string): DataSecurityAiFeature => {
      const feature: DataSecurityAiFeature | undefined = ALL_FEATURES.find(
        (candidate: DataSecurityAiFeature): boolean => {
          return candidate.toLowerCase() === value.toLowerCase();
        },
      );

      if (!feature) {
        throw new EvalUsageError(
          `Unknown feature "${value}". Use one of: ${ALL_FEATURES.join(", ")}.`,
        );
      }

      return feature;
    });
  }

  /*
   * The cases to run: of the features asked for, those --case names, or
   * all of them. A case --case names that is not one is a usage error.
   */
  public static pickCases(data: {
    argv: ReadonlyArray<string>;
    cases: ReadonlyArray<DataSecurityEvalCase>;
    features: ReadonlyArray<DataSecurityAiFeature>;
  }): Array<DataSecurityEvalCase> {
    const ids: Array<string> = parseList(getArgValue(data.argv, "case"));
    const unknown: Array<string> = ids.filter((id: string): boolean => {
      return !data.cases.some((testCase: DataSecurityEvalCase): boolean => {
        return testCase.id === id;
      });
    });

    if (unknown.length > 0) {
      throw new EvalUsageError(
        `Unknown case(s): ${unknown.join(", ")}. Run with --list to see them.`,
      );
    }

    return data.cases.filter((testCase: DataSecurityEvalCase): boolean => {
      return (
        data.features.includes(testCase.feature) &&
        (ids.length === 0 || ids.includes(testCase.id))
      );
    });
  }

  // --changed-files' path, or undefined without it.
  public static readChangedFilesPath(
    argv: ReadonlyArray<string>,
  ): string | undefined {
    const value: string | undefined = getArgValue(argv, "changed-files");

    if (value === undefined) {
      return undefined;
    }

    if (!value.trim()) {
      throw new EvalUsageError(
        "--changed-files needs the file that lists the changed paths, one a line.",
      );
    }

    return value.trim();
  }
}
