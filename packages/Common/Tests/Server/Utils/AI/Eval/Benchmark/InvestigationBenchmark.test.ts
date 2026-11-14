/*
 * RUNNING ONE BENCHMARK SCENARIO, AND SUMMING A RUN (issue #6800).
 *
 * runScenario runs the real investigation loop over a made-up incident:
 * today's persona and prompt, the toolbox's tool definitions less the two a
 * live investigation keeps from the model, the prompt's "now" at the
 * scenario's time, the loop's limits and loop detection - with every tool
 * call answered from the scenario and nothing read from a database. Under
 * test: what the model under test is given, how far a run may go, what a
 * failed run reports, what the result counts and the judge reads, and how
 * summarize adds the results up.
 */
import AIToolbox from "../../../../../../Server/Utils/AI/Toolbox/Index";
import InvestigationBenchmark, {
  BENCHMARK_EXCLUDED_TOOL_NAMES,
  BENCHMARK_RUN_LIMITS,
  BenchmarkScenarioResult,
  BenchmarkSummary,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/InvestigationBenchmark";
import {
  BenchmarkFaultKind,
  BenchmarkScenario,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenario";
import { BenchmarkScore } from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScorer";
import ScenarioTools from "../../../../../../Server/Utils/AI/Eval/Benchmark/ScenarioTools";
import { PinnedModelCall } from "../../../../../../Server/Utils/AI/Eval/PinnedModel";
import AIInvestigationEngine, {
  INVESTIGATION_MAX_OUTPUT_TOKENS,
  INVESTIGATION_PERSONA,
} from "../../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import InvestigationGrader from "../../../../../../Server/Utils/AI/SRE/InvestigationGrader";
import {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
} from "../../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIRunLimitsReader from "../../../../../../Server/Utils/AI/AIRunLimitsReader";
import AiContextReader from "../../../../../../Server/Utils/AI/AiContext/AiContextReader";
import AIService from "../../../../../../Server/Services/AIService";
import {
  LLMMessage,
  LLMToolDefinition,
} from "../../../../../../Server/Utils/LLM/LLMService";
import AIChatPermissionMode from "../../../../../../Types/AI/AIChatPermissionMode";
import { AIRunStopReason } from "../../../../../../Types/AI/AIAgentRunLimits";
import AIRunAutoGrade from "../../../../../../Types/AI/AIRunAutoGrade";
import { ScriptedModel, judgeSaying, scriptedModel } from "./ScriptedModel";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

// The tools a live investigation keeps from the model (AIInvestigationEngine).
const LIVE_EXCLUDED_TOOL_NAMES: Array<string> = [
  "get_ai_investigation",
  "start_investigation",
];

/*
 * A live investigation's room for a full report: AIInvestigationEngine's
 * INVESTIGATION_MAX_OUTPUT_TOKENS, which it passes the loop (and records,
 * so a replay passes it too). Written out, so a change to it is seen here.
 */
const LIVE_MAX_OUTPUT_TOKENS: number = 4096;

// The impact numbers' block, which a live run takes off the answer it posts.
const IMPACT_NUMBERS_BLOCK: string =
  '```impact-numbers\n{"users":{"count":120,"counted":"users"}}\n```';

const SCENARIO: BenchmarkScenario = {
  id: "benchmark-runner-test",
  title: "Checkout fails after a deploy",
  faultKind: BenchmarkFaultKind.BadDeploy,
  plantedFault: "checkout-service v2.14.0 throws on expired discount codes.",
  declaredAt: "2026-03-10T14:07:00.000Z",
  minutesSinceDeclared: 4,
  contextText:
    "# Incident\nTitle: Checkout failing for some customers\nSeverity: SEV-1",
  responses: [
    {
      toolName: "top_exceptions",
      citationLabel: "Top exceptions",
      isKeyEvidence: true,
      rows: [
        {
          message:
            "TypeError: Cannot read properties of undefined (reading 'percentOff')",
          occurrences: 1284,
        },
      ],
    },
    {
      toolName: "search_logs",
      citationLabel: "Logs",
      rows: [{ body: "POST /api/checkout 200 in 182ms" }],
    },
  ],
  expectation: {
    rootCause:
      "The checkout-service v2.14.0 deploy reads percentOff, which the promotions API leaves out for expired codes.",
    mustMention: [["v2.14.0"], ["percentOff"]],
    distractors: [{ name: "Redis latency", terms: ["redis"] }],
  },
};

function rightAnswer(citationId: string | null): string {
  return [
    "## Summary",
    "Checkout fails for expired discount codes.",
    "",
    "## Most likely root cause",
    `The v2.14.0 deploy reads percentOff, which expired codes leave out. [${citationId}]`,
  ].join("\n");
}

// Reads the key result, then answers right.
function rightModel(): ScriptedModel {
  return scriptedModel({
    rounds: [[{ toolName: "top_exceptions", arguments: {} }]],
    answer: ([citationId]: Array<string | null>): string => {
      return rightAnswer(citationId || null);
    },
  });
}

/*
 * Reads the key result, then keeps calling a tool with new arguments for
 * as long as it is offered tools, then answers right.
 */
function relentlessModel(): ScriptedModel {
  const calls: Array<ObservabilityAssistantModelCall> = [];

  return {
    calls,
    callModel: async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      calls.push(call);

      if (!call.tools) {
        return { content: rightAnswer("C1"), tokenCount: 10 };
      }

      return {
        content: "",
        toolCalls: [
          calls.length === 1
            ? { id: "call-1", name: "top_exceptions", arguments: {} }
            : {
                id: `call-${calls.length}`,
                name: "search_logs",
                arguments: { bodySearchText: `checkout ${calls.length}` },
              },
        ],
        tokenCount: 10,
      };
    },
  };
}

function systemPromptOf(call: ObservabilityAssistantModelCall): string {
  const message: LLMMessage | undefined = call.messages[0];

  expect(message?.role).toBe("system");

  return message?.content || "";
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the model under test investigates as a live investigation does", () => {
  test("it is offered the toolbox's read-only tools, less the two a live investigation keeps from it", async () => {
    const model: ScriptedModel = rightModel();

    await InvestigationBenchmark.runScenario({
      scenario: SCENARIO,
      callModel: model.callModel,
    });

    const toolbox: Array<string> = AIToolbox.getLlmToolDefinitions(
      AIChatPermissionMode.ReadOnly,
    ).map((definition: LLMToolDefinition): string => {
      return definition.name;
    });
    const offered: Array<string> = (model.calls[0]?.tools || []).map(
      (definition: LLMToolDefinition): string => {
        return definition.name;
      },
    );

    expect(BENCHMARK_EXCLUDED_TOOL_NAMES).toEqual(LIVE_EXCLUDED_TOOL_NAMES);

    for (const name of LIVE_EXCLUDED_TOOL_NAMES) {
      expect(AIToolbox.getToolByName(name)).toBeTruthy();
      expect(offered).not.toContain(name);
    }

    /*
     * get_ai_investigation reads, so a read-only run would offer it: only
     * the exclusion keeps it from the model (start_investigation writes,
     * which a read-only run never offers anyway).
     */
    expect(toolbox).toContain("get_ai_investigation");
    expect(offered).toEqual(
      toolbox.filter((name: string): boolean => {
        return !LIVE_EXCLUDED_TOOL_NAMES.includes(name);
      }),
    );
  });

  test("a call of a tool kept from it is refused, and the scenario is never asked", async () => {
    const answer: SpyInstance<typeof ScenarioTools.answer> = jest.spyOn(
      ScenarioTools,
      "answer",
    );
    const model: ScriptedModel = scriptedModel({
      rounds: [[{ toolName: "get_ai_investigation", arguments: {} }]],
      answer: (): string => {
        return rightAnswer(null);
      },
    });

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: model.callModel,
      });

    const refusal: LLMMessage | undefined = model.calls[1]?.messages.find(
      (message: LLMMessage): boolean => {
        return message.role === "tool";
      },
    );

    expect(answer).not.toHaveBeenCalled();
    expect(refusal?.content).toBe(
      "Error: get_ai_investigation is not available in this run. Answer with the data you already have.",
    );
    expect(result.citationCount).toBe(0);
  });

  test("its system prompt ends with today's investigation persona, as a live investigation's does in a project with no notes", async () => {
    const model: ScriptedModel = rightModel();

    await InvestigationBenchmark.runScenario({
      scenario: SCENARIO,
      callModel: model.callModel,
    });

    /*
     * With no notes (AI context) read, the persona is not followed by the
     * other languages' report headings (getSystemInstructions, hasAiContext).
     */
    expect(
      systemPromptOf(model.calls[0]!).endsWith(`\n\n${INVESTIGATION_PERSONA}`),
    ).toBe(true);
  });

  test("a persona to try replaces today's", async () => {
    const persona: string =
      "You are a draft investigation persona under test. Name the cause in one line.";
    const model: ScriptedModel = rightModel();

    await InvestigationBenchmark.runScenario({
      scenario: SCENARIO,
      callModel: model.callModel,
      persona,
    });

    const systemPrompt: string = systemPromptOf(model.calls[0]!);

    expect(systemPrompt).toContain(persona);
    expect(systemPrompt).not.toContain(INVESTIGATION_PERSONA);
  });

  test("it is asked about the scenario's context, in a live investigation's words", async () => {
    const model: ScriptedModel = rightModel();

    await InvestigationBenchmark.runScenario({
      scenario: SCENARIO,
      callModel: model.callModel,
    });

    expect(model.calls[0]?.messages[1]).toEqual({
      role: "user",
      content: AIInvestigationEngine.getQuestion({
        contextText: SCENARIO.contextText,
      }),
    });
    expect(
      model.calls[0]?.messages[1]?.content.endsWith(SCENARIO.contextText),
    ).toBe(true);
  });

  test("the prompt's now is the scenario's: minutesSinceDeclared after it was declared", async () => {
    const model: ScriptedModel = rightModel();

    await InvestigationBenchmark.runScenario({
      scenario: SCENARIO,
      callModel: model.callModel,
    });

    expect(InvestigationBenchmark.getPromptTime(SCENARIO).toISOString()).toBe(
      "2026-03-10T14:11:00.000Z",
    );
    expect(systemPromptOf(model.calls[0]!)).toContain(
      "The current time is 2026-03-10T14:11:00.000Z.",
    );
  });

  /*
   * A live investigation (and a replay of one) gives the model 4096 output
   * tokens; the loop's own default is 1500. With the default, an answer a
   * live run writes in one call would be cut off and continued here,
   * skewing pass counts and token totals.
   */
  test("the model has a live investigation's room for a full report, not the loop's default", async () => {
    const model: ScriptedModel = rightModel();

    await InvestigationBenchmark.runScenario({
      scenario: SCENARIO,
      callModel: model.callModel,
    });

    expect(INVESTIGATION_MAX_OUTPUT_TOKENS).toBe(LIVE_MAX_OUTPUT_TOKENS);
    expect(model.calls.length).toBeGreaterThan(0);
    for (const call of model.calls) {
      expect(call.maxTokens).toBe(LIVE_MAX_OUTPUT_TOKENS);
    }
  });
});

describe("a run goes no further than its limits", () => {
  test("a model that keeps calling tools stops at the run's model-call limit, and its answer is scored", async () => {
    const model: ScriptedModel = relentlessModel();

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: model.callModel,
        runLimits: { ...BENCHMARK_RUN_LIMITS, maxLlmCalls: 3 },
      });

    expect(result.stopReason).toBe(AIRunStopReason.ModelCalls);
    expect(result.llmCallCount).toBe(3);
    expect(model.calls[2]?.tools).toBeUndefined();
    expect(result.score?.passed).toBe(true);
  });

  test("a model that keeps calling tools stops at the run's tool-call limit", async () => {
    const model: ScriptedModel = relentlessModel();

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: model.callModel,
        runLimits: { ...BENCHMARK_RUN_LIMITS, maxToolCalls: 2 },
      });

    expect(result.stopReason).toBe(AIRunStopReason.ToolCalls);
    expect(result.toolCallCount).toBe(2);
    expect(result.score?.passed).toBe(true);
  });

  test("with no limits given, a run takes the benchmark's own", async () => {
    const model: ScriptedModel = relentlessModel();

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: model.callModel,
      });

    expect(BENCHMARK_RUN_LIMITS.maxLlmCalls).toBe(40);
    expect(result.stopReason).toBe(AIRunStopReason.ModelCalls);
    expect(result.llmCallCount).toBe(BENCHMARK_RUN_LIMITS.maxLlmCalls);
  });

  test("a model that goes in circles is stopped by loop detection", async () => {
    const model: ScriptedModel = scriptedModel({
      rounds: Array.from({ length: 20 }, () => {
        return [{ toolName: "top_exceptions", arguments: { limit: 10 } }];
      }),
      answer: (): string => {
        return rightAnswer("C1");
      },
    });

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: model.callModel,
      });

    expect(result.stopReason).toBe(AIRunStopReason.Loop);
    expect(result.llmCallCount).toBeLessThan(20);
    expect(result.score?.passed).toBe(true);
  });
});

describe("a run that fails ends with its error, and no score", () => {
  test("a model call that fails", async () => {
    const callModel: PinnedModelCall =
      async (): Promise<ObservabilityAssistantModelReply> => {
        throw new Error("The provider is down.");
      };

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel,
        judge: judgeSaying("MATCH").callModel,
      });

    expect(result).toEqual(
      expect.objectContaining({
        scenarioId: SCENARIO.id,
        title: SCENARIO.title,
        faultKind: SCENARIO.faultKind,
        plantedFault: SCENARIO.plantedFault,
        analysisMarkdown: "",
        citationCount: 0,
        llmCallCount: 0,
        toolCallCount: 0,
        totalTokens: 0,
        error: "The provider is down.",
      }),
    );
    expect(result.score).toBeUndefined();
  });

  test("a failure that is not an Error is kept as its text", async () => {
    const callModel: PinnedModelCall =
      async (): Promise<ObservabilityAssistantModelReply> => {
        throw "rate limited";
      };

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel,
      });

    expect(result.error).toBe("rate limited");
    expect(result.score).toBeUndefined();
  });
});

describe("the result says what the run did", () => {
  test("its counts, its tokens, and the answer as a live run posts it", async () => {
    const answer: string = rightAnswer("C1");
    const model: ScriptedModel = scriptedModel({
      rounds: [
        [
          { toolName: "top_exceptions", arguments: {} },
          {
            toolName: "search_logs",
            arguments: { bodySearchText: "checkout" },
          },
        ],
      ],
      answer: (): string => {
        return `\n${answer}\n\n${IMPACT_NUMBERS_BLOCK}\n`;
      },
      tokenCount: 700,
    });

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: model.callModel,
      });

    expect(result).toEqual(
      expect.objectContaining({
        scenarioId: SCENARIO.id,
        title: SCENARIO.title,
        faultKind: SCENARIO.faultKind,
        plantedFault: SCENARIO.plantedFault,
        analysisMarkdown: answer,
        citationCount: 2,
        llmCallCount: 2,
        toolCallCount: 2,
        totalTokens: 1400,
      }),
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
    expect(result.stopReason).toBeUndefined();
    expect(result.score?.passed).toBe(true);
  });

  test("the judge grades the answer as a live run posts it, its impact numbers taken off", async () => {
    const answer: string = rightAnswer("C1");
    const judge: ScriptedModel = judgeSaying("MATCH");

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: scriptedModel({
          rounds: [[{ toolName: "top_exceptions", arguments: {} }]],
          answer: (): string => {
            return `\n${answer}\n\n${IMPACT_NUMBERS_BLOCK}\n`;
          },
        }).callModel,
        judge: judge.callModel,
      });

    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]?.messages).toEqual(
      InvestigationGrader.getGradingMessages({
        rootCause: SCENARIO.expectation.rootCause,
        analysisMarkdown: answer,
      }),
    );
    expect(JSON.stringify(judge.calls[0]?.messages)).not.toContain(
      "impact-numbers",
    );
    expect(result.analysisMarkdown).toBe(answer);
    expect(result.score?.judgeGrade).toBe(AIRunAutoGrade.Match);
  });

  test("a judge whose answer cannot be read leaves no grade, and is no error", async () => {
    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: rightModel().callModel,
        judge: judgeSaying("Probably right, I think.").callModel,
      });

    expect(result.error).toBeUndefined();
    expect(result.score?.judgeGrade).toBeNull();
    expect(result.score?.passed).toBe(false);
  });

  test("an answer with nothing in it is never sent to the judge, and fails", async () => {
    const judge: ScriptedModel = judgeSaying("MATCH");

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: scriptedModel({
          rounds: [],
          answer: (): string => {
            return "  ";
          },
        }).callModel,
        judge: judge.callModel,
      });

    expect(judge.calls).toHaveLength(0);
    expect(result.analysisMarkdown).toBe("");
    expect(result.score?.judgeGrade).toBeNull();
    expect(result.score?.passed).toBe(false);
  });
});

describe("nothing is read from a database", () => {
  test("a judged scenario reads no run limits, no AI context, no tool and no project's model", async () => {
    const refuse: () => never = (): never => {
      throw new Error("A benchmark never reads a database.");
    };
    const readRunLimits: SpyInstance<typeof AIRunLimitsReader.read> = jest
      .spyOn(AIRunLimitsReader, "read")
      .mockImplementation(refuse);
    const readAiContext: SpyInstance<typeof AiContextReader.read> = jest
      .spyOn(AiContextReader, "read")
      .mockImplementation(refuse);
    const executeTool: SpyInstance<typeof AIToolbox.executeTool> = jest
      .spyOn(AIToolbox, "executeTool")
      .mockImplementation(refuse);
    const callProjectModel: SpyInstance<typeof AIService.executeWithLogging> =
      jest.spyOn(AIService, "executeWithLogging").mockImplementation(refuse);

    const result: BenchmarkScenarioResult =
      await InvestigationBenchmark.runScenario({
        scenario: SCENARIO,
        callModel: rightModel().callModel,
        judge: judgeSaying("MATCH").callModel,
      });

    expect(readRunLimits).not.toHaveBeenCalled();
    expect(readAiContext).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    expect(callProjectModel).not.toHaveBeenCalled();
    expect(result.error).toBeUndefined();
    expect(result.score?.passed).toBe(true);
  });
});

function scoreWith(overrides: Partial<BenchmarkScore>): BenchmarkScore {
  return {
    rootCauseText: "",
    hasRootCauseSection: true,
    namesCause: false,
    missingTerms: [],
    namedDistractors: [],
    citesKeyEvidence: false,
    passed: false,
    ...overrides,
  };
}

function resultWith(
  score: BenchmarkScore | undefined,
  counts: { totalTokens: number; toolCallCount: number },
): BenchmarkScenarioResult {
  return {
    scenarioId: "a-scenario",
    title: "A scenario",
    faultKind: BenchmarkFaultKind.BadDeploy,
    plantedFault: "A planted fault.",
    analysisMarkdown: "",
    citationCount: 0,
    llmCallCount: 1,
    durationMs: 1,
    ...counts,
    ...(score ? { score } : { error: "The provider is down." }),
  };
}

describe("a run's summary adds its scenarios up", () => {
  test("passed, found, named, cited, fooled and failed scenarios, tokens and tool calls", () => {
    const summary: BenchmarkSummary = InvestigationBenchmark.summarize([
      // Named and cited: passed by its words.
      resultWith(
        scoreWith({ namesCause: true, citesKeyEvidence: true, passed: true }),
        { totalTokens: 100, toolCallCount: 2 },
      ),
      // In other words, but the judge said MATCH.
      resultWith(
        scoreWith({
          citesKeyEvidence: true,
          judgeGrade: AIRunAutoGrade.Match,
          passed: true,
        }),
        { totalTokens: 200, toolCallCount: 3 },
      ),
      // The right words, a distractor too, and the judge said MISMATCH.
      resultWith(
        scoreWith({
          namesCause: true,
          citesKeyEvidence: true,
          namedDistractors: ["Redis latency"],
          judgeGrade: AIRunAutoGrade.Mismatch,
        }),
        { totalTokens: 300, toolCallCount: 4 },
      ),
      // Failed: no score, but its tokens and calls were spent.
      resultWith(undefined, { totalTokens: 50, toolCallCount: 1 }),
      // The right words, uncited, and a judge that could not be read.
      resultWith(scoreWith({ namesCause: true, judgeGrade: null }), {
        totalTokens: 400,
        toolCallCount: 5,
      }),
      // Two distractors, one scenario.
      resultWith(scoreWith({ namedDistractors: ["Redis latency", "flag"] }), {
        totalTokens: 0,
        toolCallCount: 0,
      }),
    ]);

    expect(summary).toEqual({
      scenarioCount: 6,
      passedCount: 2,
      foundCauseCount: 2,
      namedCauseCount: 3,
      citedKeyEvidenceCount: 3,
      namedDistractorCount: 2,
      erroredCount: 1,
      judged: true,
      totalTokens: 1050,
      toolCallCount: 15,
    });
  });

  test("a run no judge graded is not judged, and with no judge the cause is found by its words", () => {
    const summary: BenchmarkSummary = InvestigationBenchmark.summarize([
      resultWith(scoreWith({ namesCause: true }), {
        totalTokens: 10,
        toolCallCount: 1,
      }),
      resultWith(undefined, { totalTokens: 5, toolCallCount: 0 }),
    ]);

    expect(summary.judged).toBe(false);
    expect(summary.foundCauseCount).toBe(1);
    expect(summary.erroredCount).toBe(1);
  });

  test("an empty run counts nothing", () => {
    expect(InvestigationBenchmark.summarize([])).toEqual({
      scenarioCount: 0,
      passedCount: 0,
      foundCauseCount: 0,
      namedCauseCount: 0,
      citedKeyEvidenceCount: 0,
      namedDistractorCount: 0,
      erroredCount: 0,
      judged: false,
      totalTokens: 0,
      toolCallCount: 0,
    });
  });
});
