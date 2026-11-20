import { AIChatCitation } from "../../../../../Types/AI/AIChatTypes";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import {
  getCitationMarkerRegex,
  parseInvestigationReport,
  ParsedInvestigationReport,
} from "../../../../../Utils/AI/InvestigationReport";
import { ConfidenceClassificationToken } from "../../SRE/ConfidenceSignal";
import {
  BenchmarkExpectationKind,
  BenchmarkScenario,
  getScenarioExpectationKind,
} from "./BenchmarkScenario";
import ScenarioTools from "./ScenarioTools";

/*
 * How a benchmark answer is scored against its scenario's planted fault.
 * Deterministic, so a score can be checked by hand and held by tests:
 *
 *  - namesCause: the answer's "Most likely root cause" holds every group of
 *    the scenario's mustMention words (any one word of each group);
 *  - citesKeyEvidence: the answer cites ([C#]) a result the scenario marks
 *    as the fault's own evidence - the cause is grounded, not guessed;
 *  - namedDistractors: the planted wrong causes the root cause names, for
 *    the report (naming one is not by itself a failure: "not the deploy"
 *    names it too).
 *
 * A judge model may also grade the answer against the scenario's root cause
 * in the production grader's words (InvestigationGrader); when one did, the
 * scenario passes on its MATCH and cited key evidence, and otherwise on
 * namesCause and cited key evidence.
 *
 * A scenario whose evidence names no cause (BenchmarkExpectationKind.
 * Inconclusive, #7766) is passed by an answer that says so and cites what
 * it checked: its root cause holds the words an answer that could not tell
 * uses (INCONCLUSIVE_WORDS) or, with a judge, production's confidence
 * classifier reads it as INCONCLUSIVE. A confident answer fails, whatever it
 * names. A planted wrong cause the root cause names is reported, as for any
 * scenario, but does not fail the answer: an honest one often rules the
 * distractors out right there ("the only deploy touched another service"),
 * and words cannot tell that from a hedged guess - a judge reads which it is.
 */

/*
 * What an answer that could not tell the cause says, in the persona's own
 * words ("If the evidence is inconclusive, say so plainly", "If you could
 * not determine it, say so plainly and explain what is missing") and the
 * usual ways of saying it. The words of a scenario whose evidence names no
 * cause: its mustMention is [INCONCLUSIVE_WORDS].
 */
export const INCONCLUSIVE_WORDS: Array<string> = [
  "inconclusive",
  "could not determine",
  "could not be determined",
  "cannot determine",
  "cannot be determined",
  "can't determine",
  "can’t determine",
  "couldn't determine",
  "couldn’t determine",
  "unable to determine",
  "could not identify",
  "cannot identify",
  "unable to identify",
  "not enough evidence",
  "insufficient evidence",
  "not enough data",
  "insufficient data",
  "undetermined",
];

export interface BenchmarkScore {
  // The "Most likely root cause" section, or the whole answer when it has none.
  rootCauseText: string;
  hasRootCauseSection: boolean;
  /*
   * The root cause holds a word of every group of the scenario's words: it
   * names the planted cause - or, where the evidence names none, says it
   * could not tell.
   */
  namesCause: boolean;
  // The first word of each mustMention group the root cause does not hold.
  missingTerms: Array<string>;
  namedDistractors: Array<string>;
  citesKeyEvidence: boolean;
  /*
   * It found what was planted: the cause (its words, or the judge's MATCH),
   * or - where the evidence names no cause - that it could not tell.
   */
  foundCause: boolean;
  // Undefined: no judge ran. Null: the judge's answer could not be read.
  judgeGrade?: AIRunAutoGrade | null | undefined;
  /*
   * For a scenario whose evidence names no cause: how the judge, with
   * production's confidence classifier, read the answer. Undefined: no
   * judge ran. Null: its answer could not be read.
   */
  judgeClassification?: ConfidenceClassificationToken | null | undefined;
  passed: boolean;
}

export default class BenchmarkScorer {
  public static score(data: {
    scenario: BenchmarkScenario;
    analysisMarkdown: string;
    citations: Array<AIChatCitation>;
    judgeGrade?: AIRunAutoGrade | null | undefined;
    judgeClassification?: ConfidenceClassificationToken | null | undefined;
  }): BenchmarkScore {
    const { scenario } = data;
    const analysis: string = data.analysisMarkdown || "";
    const kind: BenchmarkExpectationKind = getScenarioExpectationKind(scenario);

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

    // The judge's reading of the answer, for the kind it reads.
    const judgeReading: Pick<
      BenchmarkScore,
      "judgeGrade" | "judgeClassification"
    > =
      kind === BenchmarkExpectationKind.Inconclusive
        ? data.judgeClassification !== undefined
          ? { judgeClassification: data.judgeClassification }
          : {}
        : data.judgeGrade !== undefined
          ? { judgeGrade: data.judgeGrade }
          : {};

    const foundCause: boolean = this.findsWhatWasPlanted({
      kind,
      namesCause,
      ...judgeReading,
    });

    return {
      rootCauseText,
      hasRootCauseSection,
      namesCause,
      missingTerms,
      namedDistractors,
      citesKeyEvidence,
      foundCause,
      ...judgeReading,
      passed: foundCause && citesKeyEvidence,
    };
  }

  /*
   * Whether the answer found what was planted. A judge's reading, when one
   * read it, outranks the words: its MATCH for a planted cause; its
   * INCONCLUSIVE where the evidence names none. With no judge: every group
   * of the words.
   */
  public static findsWhatWasPlanted(data: {
    kind: BenchmarkExpectationKind;
    namesCause: boolean;
    judgeGrade?: AIRunAutoGrade | null | undefined;
    judgeClassification?: ConfidenceClassificationToken | null | undefined;
  }): boolean {
    if (data.kind === BenchmarkExpectationKind.Inconclusive) {
      if (data.judgeClassification !== undefined) {
        return data.judgeClassification === "INCONCLUSIVE";
      }

      return data.namesCause;
    }

    if (data.judgeGrade !== undefined) {
      return data.judgeGrade === AIRunAutoGrade.Match;
    }

    return data.namesCause;
  }

  // Whether a judge read the answer: a grade, or a classification.
  public static isJudged(score: BenchmarkScore): boolean {
    return (
      score.judgeGrade !== undefined || score.judgeClassification !== undefined
    );
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
