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
import EvalJudge from "../EvalJudge";
import { PinnedModelCall } from "../PinnedModel";
import { BenchmarkFaultKind, BenchmarkScenario } from "./BenchmarkScenario";
import BenchmarkScorer, { BenchmarkScore } from "./BenchmarkScorer";
import ScenarioTools from "./ScenarioTools";

/*
 * The fault-injection benchmark (issue #6800): the real investigation loop -
 * today's persona and prompt, the toolbox's tool definitions, the loop's
 * limits and loop detection - run over made-up incidents whose cause we
 * planted (BenchmarkScenario), with the model under test, and scored on
 * whether the answer names the planted cause and cites the evidence for it
 * (BenchmarkScorer). Run it before and after a prompt or model change
 * (npm run ai-benchmark): same scenarios, same scoring, so the two pass
 * counts can be compared.
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
  plantedFault: string;
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

export interface BenchmarkSummary {
  scenarioCount: number;
  passedCount: number;
  // The judge said MATCH (or, with no judge, the root cause named the cause).
  foundCauseCount: number;
  namedCauseCount: number;
  citedKeyEvidenceCount: number;
  // Scenarios whose root cause named one of the planted wrong causes.
  namedDistractorCount: number;
  erroredCount: number;
  judged: boolean;
  totalTokens: number;
  toolCallCount: number;
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
    // Grades the answer against the planted cause; left out, scored by its words.
    judge?: PinnedModelCall | undefined;
    // In place of today's persona: a draft to try before it ships.
    persona?: string | undefined;
    runLimits?: AIAgentRunLimits | undefined;
  }): Promise<BenchmarkScenarioResult> {
    const { scenario } = data;
    const startedAtMs: number = Date.now();
    // No project's: the loop only names it in a stop note's link.
    const projectId: ObjectID = ObjectID.generate();

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
      plantedFault: scenario.plantedFault,
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
    let error: string | undefined = undefined;

    if (data.judge) {
      try {
        judgeGrade = await EvalJudge.grade({
          rootCause: scenario.expectation.rootCause,
          analysisMarkdown,
          callModel: data.judge,
        });
      } catch (judgeError) {
        judgeGrade = null;
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
      }),
      ...(error ? { error } : {}),
    };
  }

  public static summarize(
    results: Array<BenchmarkScenarioResult>,
  ): BenchmarkSummary {
    const summary: BenchmarkSummary = {
      scenarioCount: results.length,
      passedCount: 0,
      foundCauseCount: 0,
      namedCauseCount: 0,
      citedKeyEvidenceCount: 0,
      namedDistractorCount: 0,
      erroredCount: 0,
      judged: false,
      totalTokens: 0,
      toolCallCount: 0,
    };

    for (const result of results) {
      summary.totalTokens += result.totalTokens;
      summary.toolCallCount += result.toolCallCount;

      if (!result.score) {
        summary.erroredCount++;
        continue;
      }

      const score: BenchmarkScore = result.score;

      if (score.judgeGrade !== undefined) {
        summary.judged = true;
      }

      if (score.passed) {
        summary.passedCount++;
      }

      if (
        score.judgeGrade !== undefined
          ? score.judgeGrade === AIRunAutoGrade.Match
          : score.namesCause
      ) {
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

    return summary;
  }
}
