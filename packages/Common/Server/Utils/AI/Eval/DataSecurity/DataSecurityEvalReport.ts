import { getDataSecurityAiFeatureInfo } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { markdownTableCell } from "../../../../../Utils/Markdown/MarkdownTableCell";
import {
  DataSecurityEvalFeatureSummary,
  DataSecurityEvalResult,
  DataSecurityEvalSummary,
} from "./DataSecurityEval";

/*
 * WHAT A RUN OF THE DATA SECURITY EVAL REPORTS (#10365): a score per
 * feature against its threshold, then each case's run with why it passed or
 * failed - as lines to print, and in Markdown for a CI job's summary
 * (--report-markdown). Pure, so a test reads exactly what a person reads.
 */

export interface DataSecurityEvalReportInput {
  // The model under test, as describeModelOptions names it: never its key.
  model: string;
  repeat: number;
  results: Array<DataSecurityEvalResult>;
  summary: DataSecurityEvalSummary;
  // Whether a feature under its threshold fails the run.
  areThresholdsEnforced: boolean;
  outputPath: string;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function featureName(summary: DataSecurityEvalFeatureSummary): string {
  return getDataSecurityAiFeatureInfo(summary.feature).title;
}

export default class DataSecurityEvalReport {
  // One run in a line: "PASS" or "FAIL missing: scrub; said what it never should: is safe".
  public static describeResult(result: DataSecurityEvalResult): string {
    if (!result.score) {
      return `ERROR ${result.error || "unknown error"}`;
    }

    const notes: Array<string> = [...result.score.notes];

    if (result.score.of !== undefined) {
      notes.unshift(`${result.score.right} of ${result.score.of} fields`);
    }

    return `${result.score.passed ? "PASS" : "FAIL"}${
      notes.length > 0 ? ` ${notes.join("; ")}` : ""
    }`;
  }

  // "Explain with AI: 3 of 4 cases (75%), threshold 50%: met".
  public static describeFeature(
    summary: DataSecurityEvalFeatureSummary,
  ): string {
    return `${featureName(summary)}: ${summary.passedCases} of ${summary.cases} cases (${percent(
      summary.score,
    )}), threshold ${percent(summary.threshold)}: ${
      summary.isUnderThreshold ? "under" : "met"
    }`;
  }

  public static buildTextReport(
    input: DataSecurityEvalReportInput,
  ): Array<string> {
    const lines: Array<string> = [
      "",
      `Data Security eval, with ${input.model}${
        input.repeat > 1 ? `, ${input.repeat} runs a case` : ""
      }:`,
    ];

    for (const feature of input.summary.features) {
      lines.push(`  ${this.describeFeature(feature)}`);
    }

    lines.push("");

    for (const result of input.results) {
      lines.push(
        `  ${result.caseId}${input.repeat > 1 ? ` (run ${result.run})` : ""}: ${this.describeResult(result)}`,
      );
    }

    lines.push("", `Every answer and score: ${input.outputPath}`);

    if (input.areThresholdsEnforced && this.isUnderAThreshold(input.summary)) {
      lines.push("A feature scored under its threshold.");
    }

    return lines;
  }

  public static buildMarkdownReport(
    input: DataSecurityEvalReportInput,
  ): string {
    const rows: Array<string> = input.summary.features.map(
      (feature: DataSecurityEvalFeatureSummary): string => {
        return `| ${featureName(feature)} | ${feature.passedCases} of ${feature.cases} | ${percent(
          feature.score,
        )} | ${percent(feature.threshold)} | ${
          feature.isUnderThreshold ? "under" : "met"
        } |`;
      },
    );
    const cases: Array<string> = input.results.map(
      (result: DataSecurityEvalResult): string => {
        return `| \`${result.caseId}\`${
          input.repeat > 1 ? ` (run ${result.run})` : ""
        } | ${markdownTableCell(this.describeResult(result))} |`;
      },
    );

    return [
      "## Data Security AI eval",
      "",
      `With ${input.model}${input.repeat > 1 ? `, ${input.repeat} runs a case` : ""}.`,
      "",
      "| Feature | Cases passed | Score | Threshold | |",
      "| --- | --- | --- | --- | --- |",
      ...rows,
      "",
      "<details><summary>Each case</summary>",
      "",
      "| Case | Result |",
      "| --- | --- |",
      ...cases,
      "",
      "</details>",
      "",
    ].join("\n");
  }

  public static isUnderAThreshold(summary: DataSecurityEvalSummary): boolean {
    return summary.features.some(
      (feature: DataSecurityEvalFeatureSummary): boolean => {
        return feature.isUnderThreshold;
      },
    );
  }
}
