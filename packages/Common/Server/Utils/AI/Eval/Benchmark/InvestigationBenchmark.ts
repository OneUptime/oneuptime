import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import OneUptimeDate from "../../../../../Types/Date";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
} from "../../../../../Types/AI/AIAgentRunLimits";
import { takeInvestigationImpactNumbers } from "../../../../../Utils/AI/InvestigationImpactNumbers";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../Toolbox/Index";
import AIInvestigationEngine, {
  INVESTIGATION_MAX_OUTPUT_TOKENS,
  INVESTIGATION_PERSONA,
} from "../../SRE/AIInvestigationEngine";
import { ConfidenceClassificationToken } from "../../SRE/ConfidenceSignal";
import EvalJudge from "../EvalJudge";
import { PinnedModelCall } from "../PinnedModel";
import {
  BenchmarkExpectationKind,
  BenchmarkFaultKind,
  BenchmarkScenario,
  BenchmarkSubjectKind,
  getScenarioExpectationKind,
  getScenarioSubjectKind,
} from "./BenchmarkScenario";
import BenchmarkScorer, { BenchmarkScore } from "./BenchmarkScorer";
import ScenarioTools from "./ScenarioTools";

/*
 * The fault-injection benchmark (issue #6800): the real investigation loop -
 * today's persona and prompt, the toolbox's tool definitions, the loop's
 * limits and loop detection - run over made-up incidents and alerts whose
 * cause we planted (BenchmarkScenario), with the model under test, and
 * scored on whether the answer names the planted cause and cites the
 * evidence for it (BenchmarkScorer). Run it before and after a prompt or
 * model change (npm run ai-benchmark): same scenarios, same scoring, so the
 * two pass counts can be compared.
 *
 * A model's answers vary from run to run, so one run of a scenario can pass
 * or fail with no change at all. A scenario can be run several times
 * (--repeat, #7766): the summary gives each scenario's pass rate, and a
 * scenario passes when more than half its runs did.
 *
 * Nothing here reads a database or a project's telemetry: every tool call
 * is answered from the scenario (ScenarioTools).
 */

export const BENCHMARK_FEATURE: string = "AI Investigation Benchmark";

/*
 * How far one scenario may go: room for a thorough investigation, and a
 * stop for a model that goes in circles, so one scenario cannot hold up the
 * run or spend without end.
 */
export const BENCHMARK_RUN_LIMITS: AIAgentRunLimits = {
  maxLlmCalls: 40,
  maxToolCalls: 60,
  maxTokens: undefined,
  maxWallClockMs: 15 * 60 * 1000,
  timeLimitSource: AIRunTimeLimitSource.Default,
};

// The toolbox's tools a live investigation keeps from the model, kept here too.
export const BENCHMARK_EXCLUDED_TOOL_NAMES: Array<string> = [
  "get_ai_investigation",
  "start_investigation",
];

export interface BenchmarkScenarioResult {
  scenarioId: string;
  title: string;
  faultKind: BenchmarkFaultKind;
  subjectKind: BenchmarkSubjectKind;
  // Name the planted cause, or say the evidence names none.
  expectationKind: BenchmarkExpectationKind;
  plantedFault: string;
  // Which run of the scenario this was: 1, or up to --repeat.
  run: number;
  // The answer, its impact numbers taken off, as a live run posts it.
  analysisMarkdown: string;
  citationCount: number;
  llmCallCount: number;
  toolCallCount: number;
  totalTokens: number;
  durationMs: number;
  stopReason?: AIRunStopReason | undefined;
  // Undefined when the scenario did not finish (see error).
  score?: BenchmarkScore | undefined;
  error?: string | undefined;
}

// One scenario's runs, added up.
export interface BenchmarkScenarioSummary {
  scenarioId: string;
  title: string;
  faultKind: BenchmarkFaultKind;
  subjectKind: BenchmarkSubjectKind;
  expectationKind: BenchmarkExpectationKind;
  runCount: number;
  passedRunCount: number;
  // Runs that ended with no score (see each run's error).
  erroredRunCount: number;
  // passedRunCount of runCount, from 0 to 1.
  passRate: number;
  // It passed in more than half its runs: one run's luck is not a pass.
  passed: boolean;
}

export interface BenchmarkSummary {
  // The scenarios run, and their runs: each scenario once, or --repeat times.
  scenarioCount: number;
  runCount: number;
  // Scenarios that passed in more than half their runs: what --fail-under counts.
  passedCount: number;
  // Runs that passed, and their share of all the runs, from 0 to 1.
  passedRunCount: number;
  passRate: number;
  /*
   * Runs whose answer found what was planted: the judge said MATCH (or,
   * with no judge, the root cause named the cause) - or, where the evidence
   * names no cause, it said it could not tell.
   */
  foundCauseCount: number;
  namedCauseCount: number;
  citedKeyEvidenceCount: number;
  // Runs whose root cause named one of the planted wrong causes.
  namedDistractorCount: number;
  erroredCount: number;
  judged: boolean;
  totalTokens: number;
  toolCallCount: number;
  // Each scenario's runs added up, in the order the run first took them.
  scenarios: Array<BenchmarkScenarioSummary>;
}

export default class InvestigationBenchmark {
  public static getPromptTime(scenario: BenchmarkScenario): Date {
    return OneUptimeDate.addRemoveMinutes(
      new Date(scenario.declaredAt),
      scenario.minutesSinceDeclared,
    );
  }

  public static async runScenario(data: {
    scenario: BenchmarkScenario;
    callModel: PinnedModelCall;
    /*
     * Grades the answer against the planted cause (or, where the evidence
     * names none, reads it as production's confidence classifier does);
     * left out, the answer is scored by its words.
     */
    judge?: PinnedModelCall | undefined;
    // In place of today's persona: a draft to try before it ships.
    persona?: string | undefined;
    runLimits?: AIAgentRunLimits | undefined;
    // Which run of the scenario this is, for the results: 1 when left out.
    run?: number | undefined;
  }): Promise<BenchmarkScenarioResult> {
    const { scenario } = data;
    const startedAtMs: number = Date.now();
    // No project's: the loop only names it in a stop note's link.
    const projectId: ObjectID = ObjectID.generate();
    const expectationKind: BenchmarkExpectationKind =
      getScenarioExpectationKind(scenario);

    const base: Omit<
      BenchmarkScenarioResult,
      | "analysisMarkdown"
      | "citationCount"
      | "llmCallCount"
      | "toolCallCount"
      | "totalTokens"
      | "durationMs"
    > = {
      scenarioId: scenario.id,
      title: scenario.title,
      faultKind: scenario.faultKind,
      subjectKind: getScenarioSubjectKind(scenario),
      expectationKind,
      plantedFault: scenario.plantedFault,
      run: data.run ?? 1,
    };

    let result: ObservabilityAssistantResult;

    try {
      result = await ObservabilityAssistant.answerQuestion({
        projectId,
        props: { isRoot: true, tenantId: projectId },
        feature: BENCHMARK_FEATURE,
        aiContext: null,
        systemInstructions: AIInvestigationEngine.getSystemInstructions({
          persona: data.persona ?? INVESTIGATION_PERSONA,
          hasAiContext: false,
        }),
        question: AIInvestigationEngine.getQuestion({
          contextText: scenario.contextText,
        }),
        currentTime: this.getPromptTime(scenario),
        runLimits: data.runLimits ?? BENCHMARK_RUN_LIMITS,
        // A live investigation's room for a full report, not the loop's default.
        maxOutputTokens: INVESTIGATION_MAX_OUTPUT_TOKENS,
        excludeToolNames: BENCHMARK_EXCLUDED_TOOL_NAMES,
        transport: {
          callModel: data.callModel,
          executeTool: async (call: {
            name: string;
            arguments: JSONObject;
          }): Promise<ToolCallOutcome> => {
            return ScenarioTools.answer(scenario, call.name, call.arguments);
          },
        },
      });
    } catch (error) {
      return {
        ...base,
        analysisMarkdown: "",
        citationCount: 0,
        llmCallCount: 0,
        toolCallCount: 0,
        totalTokens: 0,
        durationMs: Date.now() - startedAtMs,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const analysisMarkdown: string = takeInvestigationImpactNumbers(
      (result.contentInMarkdown || "").trim(),
    ).markdown.trim();

    let judgeGrade: AIRunAutoGrade | null | undefined = undefined;
    let judgeClassification: ConfidenceClassificationToken | null | undefined =
      undefined;
    let error: string | undefined = undefined;

    if (data.judge) {
      try {
        if (expectationKind === BenchmarkExpectationKind.Inconclusive) {
          judgeClassification = await EvalJudge.classify({
            analysisMarkdown,
            callModel: data.judge,
          });
        } else {
          judgeGrade = await EvalJudge.grade({
            rootCause: scenario.expectation.rootCause,
            analysisMarkdown,
            callModel: data.judge,
          });
        }
      } catch (judgeError) {
        if (expectationKind === BenchmarkExpectationKind.Inconclusive) {
          judgeClassification = null;
        } else {
          judgeGrade = null;
        }

        error = `The judge could not grade the answer: ${
          judgeError instanceof Error ? judgeError.message : String(judgeError)
        }`;
      }
    }

    return {
      ...base,
      analysisMarkdown,
      citationCount: result.citations.length,
      llmCallCount: result.llmCallCount,
      toolCallCount: result.toolCallCount,
      totalTokens: result.totalTokens,
      durationMs: Date.now() - startedAtMs,
      ...(result.stopReason ? { stopReason: result.stopReason } : {}),
      score: BenchmarkScorer.score({
        scenario,
        analysisMarkdown,
        citations: result.citations,
        judgeGrade,
        judgeClassification,
      }),
      ...(error ? { error } : {}),
    };
  }

  // Whether a scenario that ran `runCount` times passed `passedRunCount` of them by majority.
  public static passesByMajority(
    passedRunCount: number,
    runCount: number,
  ): boolean {
    return runCount > 0 && passedRunCount * 2 > runCount;
  }

  public static summarize(
    results: Array<BenchmarkScenarioResult>,
  ): BenchmarkSummary {
    const summary: BenchmarkSummary = {
      scenarioCount: 0,
      runCount: results.length,
      passedCount: 0,
      passedRunCount: 0,
      passRate: 0,
      foundCauseCount: 0,
      namedCauseCount: 0,
      citedKeyEvidenceCount: 0,
      namedDistractorCount: 0,
      erroredCount: 0,
      judged: false,
      totalTokens: 0,
      toolCallCount: 0,
      scenarios: [],
    };

    const byScenario: Map<string, BenchmarkScenarioSummary> = new Map();

    for (const result of results) {
      summary.totalTokens += result.totalTokens;
      summary.toolCallCount += result.toolCallCount;

      let scenario: BenchmarkScenarioSummary | undefined = byScenario.get(
        result.scenarioId,
      );

      if (!scenario) {
        scenario = {
          scenarioId: result.scenarioId,
          title: result.title,
          faultKind: result.faultKind,
          subjectKind: result.subjectKind,
          expectationKind: result.expectationKind,
          runCount: 0,
          passedRunCount: 0,
          erroredRunCount: 0,
          passRate: 0,
          passed: false,
        };
        byScenario.set(result.scenarioId, scenario);
        summary.scenarios.push(scenario);
      }

      scenario.runCount++;

      if (!result.score) {
        summary.erroredCount++;
        scenario.erroredRunCount++;
        continue;
      }

      const score: BenchmarkScore = result.score;

      if (BenchmarkScorer.isJudged(score)) {
        summary.judged = true;
      }

      if (score.passed) {
        summary.passedRunCount++;
        scenario.passedRunCount++;
      }

      if (score.foundCause) {
        summary.foundCauseCount++;
      }

      if (score.namesCause) {
        summary.namedCauseCount++;
      }

      if (score.citesKeyEvidence) {
        summary.citedKeyEvidenceCount++;
      }

      if (score.namedDistractors.length > 0) {
        summary.namedDistractorCount++;
      }
    }

    for (const scenario of summary.scenarios) {
      scenario.passRate = scenario.passedRunCount / scenario.runCount;
      scenario.passed = this.passesByMajority(
        scenario.passedRunCount,
        scenario.runCount,
      );

      if (scenario.passed) {
        summary.passedCount++;
      }
    }

    summary.scenarioCount = summary.scenarios.length;
    summary.passRate =
      summary.runCount > 0 ? summary.passedRunCount / summary.runCount : 0;

    return summary;
  }
}
