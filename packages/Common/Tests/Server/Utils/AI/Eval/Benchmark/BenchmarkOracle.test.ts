/*
 * EVERY SCENARIO, PLAYED THROUGH THE REAL LOOP BY A MODEL THAT KNOWS THE
 * ANSWER (issue #6800).
 *
 * A benchmark is only as good as its scoring: a right answer must pass, and
 * a wrong one must fail, in every scenario. Here a scripted model plays
 * each scenario through the real investigation loop (runScenario, with the
 * scenario's own tools and citations) and answers as an oracle would:
 *
 *  - right: it reads one of the fault's own results, names the planted root
 *    cause, and cites what it read - for every key result of every scenario;
 *  - fooled: it names a planted distractor, citing evidence that is not the
 *    fault's or even the fault's own - it fails either way;
 *  - ungrounded: it names the cause but cites only evidence that is not the
 *    fault's - it fails;
 *  - judged: a judge's MATCH passes it (in other words too), a MISMATCH
 *    fails it however right its words, and a judge that fails leaves no
 *    grade and says why, without failing the run.
 *
 * Which results are the fault's own evidence is a reviewed list
 * (KEY_EVIDENCE): changing a scenario's key evidence changes what its
 * answers are scored on, so it changes the list too.
 */
import AIToolbox from "../../../../../../Server/Utils/AI/Toolbox/Index";
import InvestigationBenchmark, {
  BenchmarkScenarioResult,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/InvestigationBenchmark";
import BENCHMARK_SCENARIOS from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenarios";
import {
  BenchmarkScenario,
  BenchmarkToolResponse,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenario";
import BenchmarkScorer, {
  BenchmarkScore,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScorer";
import ScenarioTools from "../../../../../../Server/Utils/AI/Eval/Benchmark/ScenarioTools";
import { ObservabilityAssistantModelCall } from "../../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import InvestigationGrader, {
  GRADING_MAX_TOKENS,
} from "../../../../../../Server/Utils/AI/SRE/InvestigationGrader";
import { LLMToolDefinition } from "../../../../../../Server/Utils/LLM/LLMService";
import AIChatPermissionMode from "../../../../../../Types/AI/AIChatPermissionMode";
import AIRunAutoGrade from "../../../../../../Types/AI/AIRunAutoGrade";
import { JSONObject, JSONValue } from "../../../../../../Types/JSON";
import {
  PlannedToolCall,
  ScriptedModel,
  judgeFailingWith,
  judgeSaying,
  scriptedModel,
} from "./ScriptedModel";
import { describe, expect, test } from "@jest/globals";

/*
 * What each scenario counts as the planted fault's own evidence, by
 * citation label, reviewed: a result that shows the fault itself, not a
 * symptom every cause would share.
 */
const KEY_EVIDENCE: { [scenarioId: string]: Array<string> } = {
  "checkout-deploy-breaks-discounts": [
    "Top exceptions",
    "checkout-service logs",
    "Logs matching percentOff",
    "checkout-service spans",
    "Deploy checkout-service v2.14.0",
  ],
  "orders-db-pool-exhausted": [
    "Top exceptions",
    "orders-api logs",
    "Logs matching pool",
    "Logs matching report",
    "orders-postgres logs",
    "orders-api spans",
    "Trace 5e0c7a9d2b8f4e61a3c4d7f9b1e2a608",
    "orders-api connection pool",
    "Pool pending requests vs baseline",
  ],
  "payments-upstream-gateway-503": [
    "Top exceptions",
    "payments-api logs",
    "Logs matching PayGate",
    "Logs matching 503",
    "Logs matching unavailable",
    "Logs matching gateway",
    "payments-api spans",
    "Trace 9b1f6d2e8a4c4b7f9e3d5a1c7b2e4f60",
    "payments-api outbound requests",
    "Outbound errors vs baseline",
    "Alerts",
    "Monitors",
  ],
  "api-certificate-expired": [
    "Top exceptions",
    "api-edge logs",
    "Logs matching certificate",
    "Logs matching handshake",
    "Logs matching SSL",
    "mobile-app-android logs",
    "mobile-app-ios logs",
    "api-edge TLS handshakes",
    "TLS handshake failures vs baseline",
    "Alerts",
    "Monitors",
  ],
  "node-disk-pressure-evictions": [
    "Kubernetes events and node logs",
    "Logs of node worker-3",
    "Logs matching evict",
    "Logs matching disk",
    "Logs matching pressure",
    "Logs matching worker-3",
    "Logs matching backup",
    "Node filesystem usage",
    "Node DiskPressure condition",
    "Kubernetes clusters",
    "prod-eu-1 node filesystem usage",
    "prod-eu-1 DiskPressure condition",
    "Alerts",
  ],
  "search-config-points-to-staging": [
    "Top exceptions",
    "search-service logs",
    "Logs matching index_not_found",
    "Logs matching staging",
    "Logs matching Elasticsearch",
    "Logs matching config",
    "search-service spans",
    "Trace c41e7a2d9f3b4e8a8d1c6f5b2a9e7d31",
    "Config release cfg-7731",
  ],
  "login-credential-stuffing-traffic": [
    "api-gateway logs",
    "auth-service logs",
    "Logs matching python-requests",
    "Logs matching AS64500",
    "Logs matching 429",
    "Logs matching rate limit",
    "Logs matching login",
    "api-gateway spans",
    "auth-service spans",
    "Gateway requests on POST /login",
    "HTTP server requests",
    "Login requests vs baseline",
    "Security events",
  ],
  "invoice-worker-poison-message": [
    "Top exceptions",
    "invoice-worker logs",
    "billing-api logs",
    "Logs of message inv-88123",
    "Logs matching inv-88123",
    "Logs matching JSON",
    "Logs matching offset 4410212",
    "Logs matching truncated",
    "invoice-worker spans",
    "invoice-worker consumer group",
    "Consumer lag vs baseline",
  ],
};

type ScenarioCase = [string, BenchmarkScenario];
type KeyCase = [string, string, BenchmarkScenario, BenchmarkToolResponse];
type Distractor = { name: string; terms: Array<string> };
type DistractorCase = [string, string, BenchmarkScenario, Distractor];

const SCENARIO_CASES: Array<ScenarioCase> = BENCHMARK_SCENARIOS.map(
  (scenario: BenchmarkScenario): ScenarioCase => {
    return [scenario.id, scenario];
  },
);

function isKey(response: BenchmarkToolResponse): boolean {
  return response.isKeyEvidence === true;
}

const KEY_CASES: Array<KeyCase> = BENCHMARK_SCENARIOS.flatMap(
  (scenario: BenchmarkScenario): Array<KeyCase> => {
    return scenario.responses
      .filter(isKey)
      .map((response: BenchmarkToolResponse): KeyCase => {
        return [scenario.id, response.citationLabel || "", scenario, response];
      });
  },
);

const DISTRACTOR_CASES: Array<DistractorCase> = BENCHMARK_SCENARIOS.flatMap(
  (scenario: BenchmarkScenario): Array<DistractorCase> => {
    return scenario.expectation.distractors.map(
      (distractor: Distractor): DistractorCase => {
        return [scenario.id, distractor.name, scenario, distractor];
      },
    );
  },
);

const TOOL_SCHEMAS: Map<string, JSONObject> = new Map(
  AIToolbox.getLlmToolDefinitions(AIChatPermissionMode.ReadOnly).map(
    (definition: LLMToolDefinition): [string, JSONObject] => {
      return [definition.name, definition.inputSchema];
    },
  ),
);

/*
 * The call a model makes to read a response: its arguments, shaped as the
 * tool's schema takes them (a list as a list, attributes as an object).
 */
function callFor(response: BenchmarkToolResponse): PlannedToolCall {
  const properties: JSONObject =
    (TOOL_SCHEMAS.get(response.toolName)?.["properties"] as JSONObject) || {};
  const callArguments: JSONObject = {};

  for (const [name, value] of Object.entries(response.whenArguments || {})) {
    const type: JSONValue | undefined = (
      properties[name] as JSONObject | undefined
    )?.["type"];

    if (type === "array") {
      callArguments[name] = [value];
    } else if (type === "object") {
      callArguments[name] = { value };
    } else {
      callArguments[name] = value;
    }
  }

  return { toolName: response.toolName, arguments: callArguments };
}

function firstWords(scenario: BenchmarkScenario): Array<string> {
  return scenario.expectation.mustMention.map(
    (group: Array<string>): string => {
      return group[0] || "";
    },
  );
}

function report(rootCause: string, citationId: string | null): string {
  return [
    "## Summary",
    "What happened, in a sentence.",
    "",
    "## Most likely root cause",
    `${rootCause} [${citationId}]`,
    "",
    "## Evidence",
    `- What shows it [${citationId}]`,
  ].join("\n");
}

// The planted root cause, and a word of each group the scorer looks for.
function rightAnswer(
  scenario: BenchmarkScenario,
  citationId: string | null,
): string {
  return report(
    `${scenario.expectation.rootCause} In short: ${firstWords(scenario).join(", ")}.`,
    citationId,
  );
}

function distractorAnswer(
  distractor: Distractor,
  citationId: string | null,
): string {
  return report(
    `The ${distractor.name} caused this incident (${distractor.terms.join(", ")}).`,
    citationId,
  );
}

const OTHER_WORDS_ANSWER: string =
  "What we planted, said in other words than the scenario's.";

function keyResponseOf(scenario: BenchmarkScenario): BenchmarkToolResponse {
  return scenario.responses.find(isKey)!;
}

// A result that is not the fault's: one that shows the distractor, if any does.
function otherResponseOf(
  scenario: BenchmarkScenario,
  distractor?: Distractor | undefined,
): BenchmarkToolResponse {
  const others: Array<BenchmarkToolResponse> = scenario.responses.filter(
    (response: BenchmarkToolResponse): boolean => {
      return !isKey(response);
    },
  );
  const showingDistractor: BenchmarkToolResponse | undefined = distractor
    ? others.find((response: BenchmarkToolResponse): boolean => {
        return BenchmarkScorer.holdsAny(
          ScenarioTools.answer(
            scenario,
            response.toolName,
            response.whenArguments || {},
          ).textForLlm,
          distractor.terms,
        );
      })
    : undefined;

  return showingDistractor || others[0]!;
}

// One round reading `responses`, then the answer written from their citations.
async function play(data: {
  scenario: BenchmarkScenario;
  responses: Array<BenchmarkToolResponse>;
  answer: (citationIds: Array<string | null>) => string;
  judge?: ScriptedModel | undefined;
}): Promise<BenchmarkScenarioResult> {
  const model: ScriptedModel = scriptedModel({
    rounds: [data.responses.map(callFor)],
    answer: data.answer,
  });

  const result: BenchmarkScenarioResult =
    await InvestigationBenchmark.runScenario({
      scenario: data.scenario,
      callModel: model.callModel,
      judge: data.judge?.callModel,
    });

  // The loop read every planned call, minted each a citation, then asked for the answer.
  expect(model.calls).toHaveLength(2);
  expect(result.toolCallCount).toBe(data.responses.length);
  expect(result.citationCount).toBe(data.responses.length);

  return result;
}

describe("every scenario's key evidence is the reviewed list", () => {
  test("the list names every scenario, and only those", () => {
    expect(Object.keys(KEY_EVIDENCE).sort()).toEqual(
      BENCHMARK_SCENARIOS.map((scenario: BenchmarkScenario): string => {
        return scenario.id;
      }).sort(),
    );
  });

  test.each(SCENARIO_CASES)("%s", (id: string, scenario: BenchmarkScenario) => {
    expect(
      scenario.responses
        .filter(isKey)
        .map((response: BenchmarkToolResponse): string => {
          return response.citationLabel || "";
        }),
    ).toEqual(KEY_EVIDENCE[id]);
  });
});

describe("a right answer passes, whichever of the fault's results it cites", () => {
  test.each(KEY_CASES)(
    "%s, citing %s",
    async (
      _id: string,
      _label: string,
      scenario: BenchmarkScenario,
      response: BenchmarkToolResponse,
    ) => {
      const result: BenchmarkScenarioResult = await play({
        scenario,
        responses: [response],
        answer: ([citationId]: Array<string | null>): string => {
          return rightAnswer(scenario, citationId || null);
        },
      });

      expect(result.error).toBeUndefined();
      expect(result.stopReason).toBeUndefined();
      expect(result.score).toEqual(
        expect.objectContaining({
          hasRootCauseSection: true,
          namesCause: true,
          missingTerms: [],
          namedDistractors: [],
          citesKeyEvidence: true,
          passed: true,
        }),
      );
      expect("judgeGrade" in result.score!).toBe(false);
    },
  );
});

describe("a distractor's answer fails, whatever it cites", () => {
  test.each(DISTRACTOR_CASES)(
    "%s: the %s",
    async (
      _id: string,
      _name: string,
      scenario: BenchmarkScenario,
      distractor: Distractor,
    ) => {
      const read: Array<BenchmarkToolResponse> = [
        otherResponseOf(scenario, distractor),
        keyResponseOf(scenario),
      ];

      for (const [cited, citesKey] of [
        [0, false],
        [1, true],
      ] as Array<[number, boolean]>) {
        const score: BenchmarkScore | undefined = (
          await play({
            scenario,
            responses: read,
            answer: (citationIds: Array<string | null>): string => {
              return distractorAnswer(distractor, citationIds[cited] || null);
            },
          })
        ).score;

        expect(score).toEqual(
          expect.objectContaining({
            namesCause: false,
            // No word of any group: the distractor's words name none of the cause.
            missingTerms: firstWords(scenario),
            namedDistractors: [distractor.name],
            citesKeyEvidence: citesKey,
            passed: false,
          }),
        );
      }
    },
  );
});

describe("naming the cause on evidence that is not the fault's fails", () => {
  test.each(SCENARIO_CASES)(
    "%s",
    async (_id: string, scenario: BenchmarkScenario) => {
      const result: BenchmarkScenarioResult = await play({
        scenario,
        responses: [otherResponseOf(scenario)],
        answer: ([citationId]: Array<string | null>): string => {
          return rightAnswer(scenario, citationId || null);
        },
      });

      expect(result.score).toEqual(
        expect.objectContaining({
          namesCause: true,
          citesKeyEvidence: false,
          passed: false,
        }),
      );
    },
  );
});

describe("a judge grades the answer against the planted cause", () => {
  test.each(SCENARIO_CASES)(
    "%s: a MATCH on cited key evidence passes, and the judge read the planted cause and the answer",
    async (_id: string, scenario: BenchmarkScenario) => {
      const judge: ScriptedModel = judgeSaying("MATCH");
      const result: BenchmarkScenarioResult = await play({
        scenario,
        responses: [keyResponseOf(scenario)],
        answer: ([citationId]: Array<string | null>): string => {
          return rightAnswer(scenario, citationId || null);
        },
        judge,
      });

      expect(result.error).toBeUndefined();
      expect(result.score?.judgeGrade).toBe(AIRunAutoGrade.Match);
      expect(result.score?.passed).toBe(true);
      expect(judge.calls).toHaveLength(1);

      const call: ObservabilityAssistantModelCall = judge.calls[0]!;

      expect(call.tools).toBeUndefined();
      expect(call.maxTokens).toBe(GRADING_MAX_TOKENS);
      expect(call.temperature).toBe(0);
      // The production grader's own words, the planted root cause as the humans' one.
      expect(call.messages).toEqual(
        InvestigationGrader.getGradingMessages({
          rootCause: scenario.expectation.rootCause,
          analysisMarkdown: result.analysisMarkdown,
        }),
      );
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: a MATCH passes an answer that names the cause in other words",
    async (_id: string, scenario: BenchmarkScenario) => {
      const score: BenchmarkScore | undefined = (
        await play({
          scenario,
          responses: [keyResponseOf(scenario)],
          answer: ([citationId]: Array<string | null>): string => {
            return report(OTHER_WORDS_ANSWER, citationId || null);
          },
          judge: judgeSaying("MATCH"),
        })
      ).score;

      expect(score).toEqual(
        expect.objectContaining({
          namesCause: false,
          judgeGrade: AIRunAutoGrade.Match,
          passed: true,
        }),
      );
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: a MISMATCH fails the answer, however right its words",
    async (_id: string, scenario: BenchmarkScenario) => {
      const score: BenchmarkScore | undefined = (
        await play({
          scenario,
          responses: [keyResponseOf(scenario)],
          answer: ([citationId]: Array<string | null>): string => {
            return rightAnswer(scenario, citationId || null);
          },
          judge: judgeSaying("MISMATCH"),
        })
      ).score;

      expect(score).toEqual(
        expect.objectContaining({
          namesCause: true,
          citesKeyEvidence: true,
          judgeGrade: AIRunAutoGrade.Mismatch,
          passed: false,
        }),
      );
    },
  );

  test.each(SCENARIO_CASES)(
    "%s: a judge that fails leaves no grade, says why, and the run still ends with a score",
    async (_id: string, scenario: BenchmarkScenario) => {
      const result: BenchmarkScenarioResult = await play({
        scenario,
        responses: [keyResponseOf(scenario)],
        answer: ([citationId]: Array<string | null>): string => {
          return rightAnswer(scenario, citationId || null);
        },
        judge: judgeFailingWith("the judge's provider is down"),
      });

      expect(result.error).toBe(
        "The judge could not grade the answer: the judge's provider is down",
      );
      expect(result.score).toEqual(
        expect.objectContaining({
          namesCause: true,
          citesKeyEvidence: true,
          judgeGrade: null,
          passed: false,
        }),
      );
    },
  );
});
