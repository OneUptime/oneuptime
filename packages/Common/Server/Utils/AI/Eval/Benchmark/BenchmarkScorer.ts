import { AIChatCitation } from "../../../../../Types/AI/AIChatTypes";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import {
  getCitationMarkerRegex,
  parseInvestigationReport,
  ParsedInvestigationReport,
} from "../../../../../Utils/AI/InvestigationReport";
import { BenchmarkScenario } from "./BenchmarkScenario";
import ScenarioTools from "./ScenarioTools";

/*
 * How a benchmark answer is scored against its scenario's planted fault.
 * Deterministic, so a score can be checked by hand and held by tests:
 *
 *  - namesCause: the answer's "Most likely root cause" holds every group of
 *    the scenario's mustMention words (any one word of each group).
 *  - citesKeyEvidence: the answer cites ([C#]) a result the scenario marks
 *    as the fault's own evidence - the cause is grounded, not guessed.
 *  - namedDistractors: the planted wrong causes the root cause names, for
 *    the report (naming one is not by itself a failure: "not the deploy"
 *    names it too).
 *
 * A judge model may also grade the answer against the scenario's root cause
 * in the production grader's words (InvestigationGrader); when one did, the
 * scenario passes on its MATCH and cited key evidence, and otherwise on
 * namesCause and cited key evidence.
 */

export interface BenchmarkScore {
  // The "Most likely root cause" section, or the whole answer when it has none.
  rootCauseText: string;
  hasRootCauseSection: boolean;
  namesCause: boolean;
  // The first word of each mustMention group the root cause does not hold.
  missingTerms: Array<string>;
  namedDistractors: Array<string>;
  citesKeyEvidence: boolean;
  // Undefined: no judge ran. Null: the judge's answer could not be read.
  judgeGrade?: AIRunAutoGrade | null | undefined;
  passed: boolean;
}

export default class BenchmarkScorer {
  public static score(data: {
    scenario: BenchmarkScenario;
    analysisMarkdown: string;
    citations: Array<AIChatCitation>;
    judgeGrade?: AIRunAutoGrade | null | undefined;
  }): BenchmarkScore {
    const { scenario } = data;
    const analysis: string = data.analysisMarkdown || "";

    const report: ParsedInvestigationReport =
      parseInvestigationReport(analysis);
    const hasRootCauseSection: boolean = Boolean(report.rootCause?.trim());
    const rootCauseText: string = hasRootCauseSection
      ? report.rootCause!.trim()
      : analysis.trim();

    const missingTerms: Array<string> = [];

    for (const group of scenario.expectation.mustMention) {
      if (!this.holdsAny(rootCauseText, group)) {
        missingTerms.push(group[0] || "");
      }
    }

    const namedDistractors: Array<string> = scenario.expectation.distractors
      .filter((distractor: { name: string; terms: Array<string> }) => {
        return this.holdsAny(rootCauseText, distractor.terms);
      })
      .map((distractor: { name: string; terms: Array<string> }) => {
        return distractor.name;
      });

    const citesKeyEvidence: boolean = this.citesKeyEvidence({
      scenario,
      analysisMarkdown: analysis,
      citations: data.citations,
    });

    const namesCause: boolean =
      analysis.trim().length > 0 && missingTerms.length === 0;

    const foundCause: boolean =
      data.judgeGrade !== undefined
        ? data.judgeGrade === AIRunAutoGrade.Match
        : namesCause;

    return {
      rootCauseText,
      hasRootCauseSection,
      namesCause,
      missingTerms,
      namedDistractors,
      citesKeyEvidence,
      ...(data.judgeGrade !== undefined ? { judgeGrade: data.judgeGrade } : {}),
      passed: foundCause && citesKeyEvidence,
    };
  }

  // Whether the text holds any of the words, ignoring case and spacing.
  public static holdsAny(text: string, words: Array<string>): boolean {
    const haystack: string = this.normalise(text);

    return words.some((word: string) => {
      const needle: string = this.normalise(word);
      return needle.length > 0 && haystack.includes(needle);
    });
  }

  public static citesKeyEvidence(data: {
    scenario: BenchmarkScenario;
    analysisMarkdown: string;
    citations: Array<AIChatCitation>;
  }): boolean {
    const citedIds: Set<string> = new Set();

    for (const match of data.analysisMarkdown.matchAll(
      getCitationMarkerRegex(),
    )) {
      if (match[1]) {
        citedIds.add(match[1]);
      }
    }

    return data.citations.some((citation: AIChatCitation) => {
      return (
        citedIds.has(citation.id) &&
        ScenarioTools.isKeyEvidence(
          data.scenario,
          citation.toolName,
          citation.queryArguments,
        )
      );
    });
  }

  private static normalise(text: string): string {
    return text
      .toLowerCase()
      .replace(/[\s_-]+/g, " ")
      .trim();
  }
}
