import ScenarioTools from "../../../../../../Server/Utils/AI/Eval/Benchmark/ScenarioTools";
import {
  BenchmarkFaultKind,
  BenchmarkScenario,
  BenchmarkToolResponse,
} from "../../../../../../Server/Utils/AI/Eval/Benchmark/BenchmarkScenario";
import { ToolCallOutcome } from "../../../../../../Server/Utils/AI/Toolbox/Index";
import Serializer from "../../../../../../Server/Utils/AI/Toolbox/Serializer";
import { JSONObject } from "../../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A BENCHMARK SCENARIO ANSWERS THE MODEL'S TOOL CALLS (issue #6800).
 *
 * Nothing in the benchmark reads a database: every tool call is answered
 * from the scenario's scripted responses, in the toolbox's own format.
 * Under test: which response answers a call (its arguments found in the
 * call's, ignoring case, in a string's text or one item of a list; the
 * first response that matches; one with no arguments for any call; none,
 * for no rows), how the answer reads (rows and text as the serializer
 * writes them, the response's citation label), and which answers are the
 * planted fault's own evidence.
 */

function scenarioWith(
  responses: Array<BenchmarkToolResponse>,
): BenchmarkScenario {
  return {
    id: "scenario-tools-test",
    title: "Scenario tools test",
    faultKind: BenchmarkFaultKind.BadDeploy,
    plantedFault: "A planted fault.",
    declaredAt: "2026-03-10T14:07:00.000Z",
    minutesSinceDeclared: 4,
    contextText: "# Incident\nTitle: Scenario tools test",
    responses,
    expectation: {
      rootCause: "A planted fault.",
      mustMention: [["planted"]],
      distractors: [],
    },
  };
}

function waitingFor(
  whenArguments: { [argumentName: string]: string },
  label: string = "Waiting",
): BenchmarkScenario {
  return scenarioWith([
    {
      toolName: "search_logs",
      whenArguments,
      citationLabel: label,
      rows: [{ body: "matched" }],
    },
  ]);
}

function labelFor(
  scenario: BenchmarkScenario,
  toolName: string,
  toolArguments: JSONObject | undefined,
): string | null {
  return (
    ScenarioTools.findResponse(scenario, toolName, toolArguments)
      ?.citationLabel || null
  );
}

describe("a response answers the calls that carry its arguments", () => {
  test("a string argument holds the value anywhere in its text, ignoring case", () => {
    const scenario: BenchmarkScenario = waitingFor({
      bodySearchText: "PercentOff",
    });

    expect(
      labelFor(scenario, "search_logs", {
        bodySearchText: "why is percentoff undefined",
      }),
    ).toBe("Waiting");
    expect(
      labelFor(scenario, "search_logs", { bodySearchText: "PERCENTOFF" }),
    ).toBe("Waiting");
    expect(
      labelFor(scenario, "search_logs", { bodySearchText: "percent off" }),
    ).toBeNull();
  });

  test("a list argument holds the value in one of its items", () => {
    const scenario: BenchmarkScenario = waitingFor({ severityTexts: "error" });

    expect(
      labelFor(scenario, "search_logs", { severityTexts: ["WARN", "ERROR"] }),
    ).toBe("Waiting");
    expect(
      labelFor(scenario, "search_logs", { severityTexts: ["WARN", "INFO"] }),
    ).toBeNull();
    expect(labelFor(scenario, "search_logs", { severityTexts: [] })).toBeNull();
  });

  test("an object argument holds the value in its keys or values", () => {
    const scenario: BenchmarkScenario = waitingFor({ attributes: "worker-3" });

    expect(
      labelFor(scenario, "search_logs", {
        attributes: { "k8s.node.name": "WORKER-3" },
      }),
    ).toBe("Waiting");
    expect(
      labelFor(scenario, "search_logs", {
        attributes: { "k8s.node.name": "worker-7" },
      }),
    ).toBeNull();
  });

  test("a number or a flag is read as it is written", () => {
    expect(
      labelFor(waitingFor({ limit: "50" }), "search_logs", { limit: 50 }),
    ).toBe("Waiting");
    expect(
      labelFor(waitingFor({ hasException: "true" }), "search_logs", {
        hasException: true,
      }),
    ).toBe("Waiting");
  });

  test("a missing, null or undefined argument holds nothing", () => {
    const scenario: BenchmarkScenario = waitingFor({ serviceId: "svc-a" });

    expect(labelFor(scenario, "search_logs", {})).toBeNull();
    expect(labelFor(scenario, "search_logs", undefined)).toBeNull();
    expect(labelFor(scenario, "search_logs", { serviceId: null })).toBeNull();
    expect(
      labelFor(scenario, "search_logs", { bodySearchText: "svc-a" }),
    ).toBeNull();
  });

  test("an empty value asks only that the call passes the argument", () => {
    const scenario: BenchmarkScenario = waitingFor({ serviceId: "" });

    expect(labelFor(scenario, "search_logs", { serviceId: "svc-a" })).toBe(
      "Waiting",
    );
    expect(labelFor(scenario, "search_logs", { serviceId: 0 })).toBe("Waiting");
    expect(labelFor(scenario, "search_logs", {})).toBeNull();
    expect(labelFor(scenario, "search_logs", { serviceId: null })).toBeNull();
  });

  test("every argument a response names must hold, not just one", () => {
    const scenario: BenchmarkScenario = waitingFor({
      serviceId: "svc-a",
      bodySearchText: "timeout",
    });

    expect(
      labelFor(scenario, "search_logs", { serviceId: "svc-a" }),
    ).toBeNull();
    expect(
      labelFor(scenario, "search_logs", { bodySearchText: "timeout" }),
    ).toBeNull();
    expect(
      labelFor(scenario, "search_logs", {
        serviceId: "svc-a",
        bodySearchText: "Timeout after 5 s",
        limit: 25,
      }),
    ).toBe("Waiting");
  });

  test("a response answers its own tool only", () => {
    expect(
      labelFor(waitingFor({ serviceId: "svc-a" }), "query_traces", {
        serviceId: "svc-a",
      }),
    ).toBeNull();
  });
});

describe("the first response that matches answers", () => {
  const POOL: BenchmarkToolResponse = {
    toolName: "search_logs",
    whenArguments: { bodySearchText: "pool" },
    citationLabel: "Logs matching pool",
  };
  const POOL_EXHAUSTED: BenchmarkToolResponse = {
    toolName: "search_logs",
    whenArguments: { bodySearchText: "pool exhausted" },
    citationLabel: "Logs matching pool exhausted",
  };
  const ANY_LOGS: BenchmarkToolResponse = {
    toolName: "search_logs",
    citationLabel: "Logs",
  };

  test("of two that match, the one written first", () => {
    const broadFirst: BenchmarkScenario = scenarioWith([POOL, POOL_EXHAUSTED]);
    const narrowFirst: BenchmarkScenario = scenarioWith([POOL_EXHAUSTED, POOL]);

    expect(
      ScenarioTools.findResponse(broadFirst, "search_logs", {
        bodySearchText: "pool exhausted",
      }),
    ).toBe(POOL);
    expect(
      ScenarioTools.findResponse(narrowFirst, "search_logs", {
        bodySearchText: "pool exhausted",
      }),
    ).toBe(POOL_EXHAUSTED);
    expect(
      ScenarioTools.findResponse(narrowFirst, "search_logs", {
        bodySearchText: "pool",
      }),
    ).toBe(POOL);
  });

  test("a response with no arguments answers any call of its tool, after the ones before it", () => {
    const scenario: BenchmarkScenario = scenarioWith([POOL, ANY_LOGS]);

    expect(
      ScenarioTools.findResponse(scenario, "search_logs", {
        bodySearchText: "pool",
      }),
    ).toBe(POOL);
    expect(
      ScenarioTools.findResponse(scenario, "search_logs", {
        bodySearchText: "disk",
      }),
    ).toBe(ANY_LOGS);
    expect(ScenarioTools.findResponse(scenario, "search_logs", {})).toBe(
      ANY_LOGS,
    );
    expect(ScenarioTools.findResponse(scenario, "search_logs", undefined)).toBe(
      ANY_LOGS,
    );
  });

  test("a response with no arguments written first answers every call of its tool", () => {
    const scenario: BenchmarkScenario = scenarioWith([ANY_LOGS, POOL]);

    expect(
      ScenarioTools.findResponse(scenario, "search_logs", {
        bodySearchText: "pool",
      }),
    ).toBe(ANY_LOGS);
  });
});

describe("an answer reads as the toolbox writes it", () => {
  test("rows are written one a line, as key=value pairs", () => {
    const outcome: ToolCallOutcome = ScenarioTools.answer(
      scenarioWith([
        {
          toolName: "query_traces",
          citationLabel: "Spans",
          rows: [
            { service: "checkout-service", count: 4120, errorCount: 1277 },
            { service: "search-service", count: 15410, errorCount: 21 },
          ],
        },
      ]),
      "query_traces",
      { serviceId: "anything" },
    );

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toBe(
      [
        "- service=checkout-service | count=4120 | errorCount=1277",
        "- service=search-service | count=15410 | errorCount=21",
      ].join("\n"),
    );
    expect(outcome.result?.dataForLlm).toBe(outcome.textForLlm);
    expect(outcome.result?.rowCount).toBe(2);
    expect(outcome.result?.isTruncated).toBe(false);
  });

  test("rows go through the toolbox's own serializer, redaction included", () => {
    const rows: Array<JSONObject> = [
      {
        body: "POST /login 429 client=203.0.113.77 user_agent=python-requests/2.31",
      },
    ];
    const outcome: ToolCallOutcome = ScenarioTools.answer(
      scenarioWith([{ toolName: "search_logs", rows }]),
      "search_logs",
      {},
    );

    expect(outcome.textForLlm).toBe(Serializer.serializeRows(rows).text);
    expect(outcome.textForLlm).toContain("[redacted-ip]");
    expect(outcome.textForLlm).not.toContain("203.0.113.77");
  });

  test("text is handed over as written, counted as one row", () => {
    const text: string =
      "Change chg-1: Deploy checkout-service v2.14.0 (v2.13.2 → v2.14.0).";
    const outcome: ToolCallOutcome = ScenarioTools.answer(
      scenarioWith([{ toolName: "get_change_details", text }]),
      "get_change_details",
      { changeId: "chg-1" },
    );

    expect(outcome.textForLlm).toBe(text);
    expect(outcome.result?.rowCount).toBe(1);
  });

  test("a response with both text and rows hands over its text, counted by its rows", () => {
    const outcome: ToolCallOutcome = ScenarioTools.answer(
      scenarioWith([
        {
          toolName: "get_trace",
          text: "POST /api/orders 5.0 s ERROR",
          rows: [{ span: "a" }, { span: "b" }, { span: "c" }],
        },
      ]),
      "get_trace",
      { traceId: "abc" },
    );

    expect(outcome.textForLlm).toBe("POST /api/orders 5.0 s ERROR");
    expect(outcome.result?.rowCount).toBe(3);
  });

  test("a call no response answers gets no rows, as a real tool with nothing to show", () => {
    const scenario: BenchmarkScenario = waitingFor({ serviceId: "svc-a" });
    const empty: string = Serializer.serializeRows([]).text;

    for (const [toolName, toolArguments] of [
      ["search_logs", { serviceId: "svc-b" }],
      ["query_metrics", { metricName: "cpu" }],
    ] as Array<[string, JSONObject]>) {
      const outcome: ToolCallOutcome = ScenarioTools.answer(
        scenario,
        toolName,
        toolArguments,
      );

      expect(outcome.success).toBe(true);
      expect(outcome.textForLlm).toBe(empty);
      expect(outcome.textForLlm).toBe("(no rows found)");
      expect(outcome.result?.rowCount).toBe(0);
      expect(outcome.result?.citationLabel).toBe(toolName);
    }
  });

  test("an answer's citation is labelled as its response says, else by its tool", () => {
    const scenario: BenchmarkScenario = scenarioWith([
      {
        toolName: "search_logs",
        whenArguments: { serviceId: "svc-a" },
        citationLabel: "checkout-service logs",
        rows: [{ body: "a" }],
      },
      { toolName: "search_logs", rows: [{ body: "b" }] },
    ]);

    expect(
      ScenarioTools.answer(scenario, "search_logs", { serviceId: "svc-a" })
        .result?.citationLabel,
    ).toBe("checkout-service logs");
    expect(
      ScenarioTools.answer(scenario, "search_logs", { serviceId: "svc-b" })
        .result?.citationLabel,
    ).toBe("search_logs");
  });

  test("the same call always gets the same answer", () => {
    const scenario: BenchmarkScenario = waitingFor({ serviceId: "svc-a" });

    expect(
      ScenarioTools.answer(scenario, "search_logs", { serviceId: "svc-a" }),
    ).toEqual(
      ScenarioTools.answer(scenario, "search_logs", { serviceId: "svc-a" }),
    );
  });
});

describe("only the answer of a key response is key evidence", () => {
  const KEY_LOGS: BenchmarkToolResponse = {
    toolName: "search_logs",
    whenArguments: { serviceId: "svc-a" },
    citationLabel: "checkout-service logs",
    isKeyEvidence: true,
  };
  const OTHER_LOGS: BenchmarkToolResponse = {
    toolName: "search_logs",
    citationLabel: "Logs",
  };

  test("a call the key response answers is key evidence, any other call of the tool is not", () => {
    const scenario: BenchmarkScenario = scenarioWith([KEY_LOGS, OTHER_LOGS]);

    expect(
      ScenarioTools.isKeyEvidence(scenario, "search_logs", {
        serviceId: "SVC-A",
      }),
    ).toBe(true);
    expect(
      ScenarioTools.isKeyEvidence(scenario, "search_logs", {
        serviceId: "svc-b",
      }),
    ).toBe(false);
    expect(ScenarioTools.isKeyEvidence(scenario, "search_logs", {})).toBe(
      false,
    );
  });

  test("a call no response answers is not key evidence", () => {
    const scenario: BenchmarkScenario = scenarioWith([KEY_LOGS]);

    expect(
      ScenarioTools.isKeyEvidence(scenario, "query_traces", {
        serviceId: "svc-a",
      }),
    ).toBe(false);
    expect(
      ScenarioTools.isKeyEvidence(scenario, "search_logs", {
        serviceId: "svc-b",
      }),
    ).toBe(false);
  });

  test("a key response with no arguments makes every call of its tool key evidence", () => {
    const scenario: BenchmarkScenario = scenarioWith([
      {
        toolName: "query_alerts",
        citationLabel: "Alerts",
        isKeyEvidence: true,
      },
    ]);

    expect(ScenarioTools.isKeyEvidence(scenario, "query_alerts", {})).toBe(
      true,
    );
    expect(
      ScenarioTools.isKeyEvidence(scenario, "query_alerts", {
        state: "active",
      }),
    ).toBe(true);
  });

  test("a key response an earlier one answers for is never reached, so never key evidence", () => {
    const scenario: BenchmarkScenario = scenarioWith([OTHER_LOGS, KEY_LOGS]);

    expect(
      ScenarioTools.isKeyEvidence(scenario, "search_logs", {
        serviceId: "svc-a",
      }),
    ).toBe(false);
  });
});
